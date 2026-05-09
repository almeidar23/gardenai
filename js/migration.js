// js/migration.js — Migrate legacy IndexedDB data to Firebase Firestore

import DB from './db.js';

const DB_NAMES = ['GardenAI', 'GardenDB'];
const STORES = ['pots', 'photos', 'analyses', 'taskLogs', 'settings', 'products'];

export async function runMigration() {
  if (localStorage.getItem('gardenai_migration_complete')) {
    console.log('Migration already marked as complete.');
    return;
  }

  console.log('Starting migration check...');
  
  for (const dbName of DB_NAMES) {
    const hasLegacyDB = await checkLegacyDB(dbName);
    if (hasLegacyDB) {
      console.log(`Legacy data detected in ${dbName}! Starting migration...`);
      const success = await migrateFromDB(dbName);
      if (success) {
        localStorage.setItem('gardenai_migration_complete', 'true');
        return true;
      }
    }
  }

  console.log('No legacy data found in any known databases.');
  localStorage.setItem('gardenai_migration_complete', 'true');
  return false;
}

async function checkLegacyDB(dbName) {
  return new Promise((resolve) => {
    console.log(`Checking for database: ${dbName}`);
    const req = indexedDB.open(dbName);
    req.onsuccess = (e) => {
      const db = e.target.result;
      const storeCount = db.objectStoreNames.length;
      console.log(`Database ${dbName} opened. Stores:`, [...db.objectStoreNames]);
      db.close();
      resolve(storeCount > 0);
    };
    req.onupgradeneeded = (e) => {
      console.log(`Database ${dbName} doesn't exist (creating now, aborting).`);
      e.target.transaction.abort();
      resolve(false);
    };
    req.onerror = () => {
      console.log(`Error opening ${dbName}`);
      resolve(false);
    };
  });
}

async function migrateFromDB(dbName) {
  try {
    const legacyData = await readLegacyData(dbName);
    console.log(`Read stores from ${dbName}:`, Object.keys(legacyData).map(k => `${k}(${legacyData[k]?.length || 0})`));
    
    // Map to keep track of oldId -> newId
    const potIdMap = {};
    const photoIdMap = {};

    // 0. Cleanup Firestore first (with extra check)
    console.log('Cleaning up Cloud Data...');
    await DB.clearAllData();
    console.log('Cloud Data cleared.');

    // 1. Migrate Pots
    if (legacyData.pots && legacyData.pots.length > 0) {
      console.log(`Migrating ${legacyData.pots.length} pots...`);
      for (const pot of legacyData.pots) {
        const oldId = pot.id;
        const newPot = await DB.createPot({
          name: pot.name,
          description: pot.description,
          emoji: pot.emoji,
          createdAt: pot.createdAt,
          scheduleOverrides: pot.scheduleOverrides
        });
        potIdMap[oldId] = newPot.id;
        console.log(`Migrated Pot: ${pot.name} (${oldId} -> ${newPot.id})`);
      }
    }

    // 2. Migrate Photos
    if (legacyData.photos && legacyData.photos.length > 0) {
      console.log(`Migrating ${legacyData.photos.length} photos...`);
      let count = 0;
      for (const photo of legacyData.photos) {
        const oldPhotoId = photo.id;
        const newPotId = potIdMap[photo.potId];
        
        if (!newPotId) {
          console.warn(`Skipping photo ${oldPhotoId}: Pot ${photo.potId} not found in map.`);
          continue;
        }

        const photoToSave = { 
          potId: newPotId,
          type: photo.type,
          createdAt: photo.createdAt,
          userNotes: photo.userNotes || ''
        };

        // Get the blob (handle both legacy formats)
        let blob = photo.blob;
        if (!blob && photo.imageData) {
          try { blob = dataUrlToBlob(photo.imageData); } catch(e) {}
        }

        if (blob) {
          photoToSave.blob = blob;
          const newPhoto = await DB.addPhoto(photoToSave);
          photoIdMap[oldPhotoId] = newPhoto.id;
          count++;
          console.log(`Migrated Photo ${count}/${legacyData.photos.length}`);
        } else {
          console.warn(`Skipping photo ${oldPhotoId}: No image data found.`);
        }
      }
    }

    // 3. Migrate Analyses
    if (legacyData.analyses && legacyData.analyses.length > 0) {
      console.log(`Migrating ${legacyData.analyses.length} analyses...`);
      for (const analysis of legacyData.analyses) {
        const analysisToSave = { ...analysis };
        if (potIdMap[analysis.potId]) analysisToSave.potId = potIdMap[analysis.potId];
        if (photoIdMap[analysis.photoId]) analysisToSave.photoId = photoIdMap[analysis.photoId];
        await DB.addAnalysis(analysisToSave);
      }
    }

    // 4. Migrate Task Logs
    if (legacyData.taskLogs && legacyData.taskLogs.length > 0) {
      for (const log of legacyData.taskLogs) {
        await DB.addTaskLog(log);
      }
    }

    // 5. Migrate Settings
    if (legacyData.settings && legacyData.settings.length > 0) {
      for (const setting of legacyData.settings) {
        const current = await DB.getSetting(setting.key);
        if (!current) await DB.setSetting(setting.key, setting.value);
      }
    }

    return true;
  } catch (err) {
    console.error(`Migration from ${dbName} failed:`, err);
    return false;
  }
}

async function readLegacyData(dbName) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = async (e) => {
      const db = e.target.result;
      const data = {};
      
      for (const storeName of STORES) {
        if (db.objectStoreNames.contains(storeName)) {
          data[storeName] = await getAllFromStore(db, storeName);
        }
      }
      
      db.close();
      resolve(data);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

function getAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
