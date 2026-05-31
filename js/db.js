// js/db.js — Firebase Firestore backend for GardenAI (photos stored as compressed base64)

import { auth, firestoreDb } from './firebase-config.js';
import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc, query, where
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const DEFAULT_PRODUCTS = [
  { slug: 'water',      name: 'Agua',    icon: '💧', defaultFrequencyDays: 7,  notes: '', photos: [] },
  { slug: 'fertilizer', name: 'Abono',   icon: '🧪', defaultFrequencyDays: 14, notes: '', photos: [] },
  { slug: 'potassium',  name: 'Potasio', icon: '🟡', defaultFrequencyDays: 21, notes: '', photos: [] },
  { slug: 'sulfur',     name: 'Azufre',  icon: '🟠', defaultFrequencyDays: 30, notes: '', photos: [] },
  { slug: 'acid',       name: 'Ácido',   icon: '⚗️', defaultFrequencyDays: 30, notes: '', photos: [] },
  { slug: 'copper',     name: 'Cobre',   icon: '🔶', defaultFrequencyDays: 21, notes: '', photos: [] }
];

let uid = null;

function generateId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function col(name) {
  return collection(firestoreDb, `users/${uid}/${name}`);
}

function docRef(name, id) {
  return doc(firestoreDb, `users/${uid}/${name}`, String(id));
}

// Compress a Blob to a base64 JPEG data URL (max 800px, quality 0.55) for storage only
function compressImage(blob) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 800;
      let { naturalWidth: w, naturalHeight: h } = img;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else       { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.55));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// Reconstruct a Blob from a base64 data URL
function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const DB = {

  // ===== POTS =====
  async createPot(pot) {
    const id = generateId();
    const data = {
      ...pot,
      id,
      createdAt: pot.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scheduleOverrides: pot.scheduleOverrides || {}
    };
    await setDoc(docRef('pots', id), data);
    return data;
  },

  async updatePot(pot) {
    pot.updatedAt = new Date().toISOString();
    await setDoc(docRef('pots', pot.id), pot);
    return pot;
  },

  async getPot(id) {
    const snap = await getDoc(docRef('pots', id));
    return snap.exists() ? snap.data() : undefined;
  },

  async getAllPots() {
    const snap = await getDocs(col('pots'));
    const pots = snap.docs.map(d => d.data());
    return pots.sort((a, b) => {
      if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
      if (a.sortOrder != null) return -1;
      if (b.sortOrder != null) return 1;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
  },

  async savePotOrder(potIds) {
    await Promise.all(potIds.map((id, index) =>
      setDoc(docRef('pots', String(id)), { sortOrder: index }, { merge: true })
    ));
  },

  async deletePot(id) {
    const photos = await this.getPhotosByPot(id);
    for (const photo of photos) await this.deletePhoto(photo.id);
    const [as, ls] = await Promise.all([
      getDocs(query(col('analyses'), where('potId', '==', Number(id)))),
      getDocs(query(col('taskLogs'), where('potId', '==', Number(id))))
    ]);
    await Promise.all([
      ...as.docs.map(d => deleteDoc(d.ref)),
      ...ls.docs.map(d => deleteDoc(d.ref)),
      deleteDoc(docRef('pots', id))
    ]);
  },

  // ===== PHOTOS =====
  async addPhoto(photo) {
    const id = generateId();
    const imageData = await compressImage(photo.blob);
    const data = {
      id,
      potId: Number(photo.potId),
      type: photo.type,
      createdAt: photo.createdAt || new Date().toISOString(),
      userNotes: photo.userNotes || '',
      imageData
    };
    await setDoc(docRef('photos', id), data);
    return { ...data, blob: photo.blob };
  },

  async getPhoto(id) {
    const snap = await getDoc(docRef('photos', Number(id)));
    if (!snap.exists()) return undefined;
    const data = snap.data();
    const blob = data.imageData ? dataUrlToBlob(data.imageData) : null;
    return { ...data, blob };
  },

  async updatePhoto(photo) {
    const { blob, ...data } = photo;
    await setDoc(docRef('photos', photo.id), data);
    return photo;
  },

  async getPhotosByPot(potId) {
    const snap = await getDocs(query(col('photos'), where('potId', '==', Number(potId))));
    return snap.docs.map(d => d.data()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async deletePhoto(id) {
    const snap = await getDocs(query(col('analyses'), where('photoId', '==', Number(id))));
    await Promise.all([
      ...snap.docs.map(d => deleteDoc(d.ref)),
      deleteDoc(docRef('photos', id))
    ]);
  },

  // ===== ANALYSES =====
  async addAnalysis(analysis) {
    const id = generateId();
    const data = {
      ...analysis,
      id,
      photoId: Number(analysis.photoId),
      potId: Number(analysis.potId),
      createdAt: analysis.createdAt || new Date().toISOString(),
      userNotes: analysis.userNotes || ''
    };
    await setDoc(docRef('analyses', id), data);
    return data;
  },

  async getAnalysisByPhoto(photoId) {
    const snap = await getDocs(query(col('analyses'), where('photoId', '==', Number(photoId))));
    if (snap.empty) return null;
    return snap.docs.map(d => d.data()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  },

  async getAnalysis(id) {
    const snap = await getDoc(docRef('analyses', Number(id)));
    if (!snap.exists()) return undefined;
    return snap.data();
  },

  async updateAnalysis(analysis) {
    await setDoc(docRef('analyses', analysis.id), analysis);
    return analysis;
  },

  async deleteAnalysis(id) {
    await deleteDoc(docRef('analyses', Number(id)));
  },

  async getAnalysesByPot(potId) {
    const snap = await getDocs(query(col('analyses'), where('potId', '==', Number(potId))));
    return snap.docs.map(d => d.data());
  },

  // ===== PRODUCTS =====
  async getAllProducts() {
    const snap = await getDocs(col('products'));
    return snap.docs.map(d => d.data());
  },

  async getProduct(slug) {
    const snap = await getDoc(docRef('products', slug));
    return snap.exists() ? snap.data() : undefined;
  },

  async updateProduct(product) {
    product.updatedAt = new Date().toISOString();
    await setDoc(docRef('products', product.slug), product);
    return product;
  },

  async createProduct(product) {
    const slug = product.name
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 30) + '_' + Date.now().toString(36);
    const data = {
      slug,
      name: product.name,
      icon: product.icon || '🌿',
      defaultFrequencyDays: Number(product.defaultFrequencyDays) || 7,
      notes: product.notes || '',
      photos: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await setDoc(docRef('products', slug), data);
    return data;
  },

  async deleteProduct(slug) {
    const logs = await getDocs(query(col('taskLogs'), where('productSlug', '==', slug)));
    await Promise.all([...logs.docs.map(d => deleteDoc(d.ref)), deleteDoc(docRef('products', slug))]);
  },

  // ===== TASK LOGS =====
  async addTaskLog(log) {
    const id = generateId();
    const data = {
      ...log,
      id,
      potId: Number(log.potId),
      appliedAt: log.appliedAt || new Date().toISOString()
    };
    await setDoc(docRef('taskLogs', id), data);
    return data;
  },

  async getLastTaskLog(potId, productSlug) {
    const snap = await getDocs(query(
      col('taskLogs'),
      where('potId', '==', Number(potId)),
      where('productSlug', '==', productSlug)
    ));
    if (snap.empty) return null;
    return snap.docs.map(d => d.data()).sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt))[0];
  },

  async getTaskLogsByPot(potId) {
    const snap = await getDocs(query(col('taskLogs'), where('potId', '==', Number(potId))));
    return snap.docs.map(d => d.data());
  },

  async getTaskLogsByPots(potIds) {
    if (!potIds.length) return [];
    const snap = await getDocs(query(col('taskLogs'), where('potId', 'in', potIds.map(Number))));
    return snap.docs.map(d => d.data());
  },

  async deleteTaskLogsByProductAndPot(potId, productSlug) {
    const snap = await getDocs(query(
      col('taskLogs'),
      where('potId', '==', Number(potId)),
      where('productSlug', '==', productSlug)
    ));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  },

  // ===== NOTES =====
  async addNote(note) {
    const id = generateId();
    const data = {
      id,
      potId: Number(note.potId),
      text: note.text,
      createdAt: note.createdAt || new Date().toISOString()
    };
    await setDoc(docRef('notes', id), data);
    return data;
  },

  async getNote(id) {
    const snap = await getDoc(docRef('notes', Number(id)));
    if (!snap.exists()) return undefined;
    return snap.data();
  },

  async getNotesByPot(potId) {
    const snap = await getDocs(query(col('notes'), where('potId', '==', Number(potId))));
    return snap.docs.map(d => d.data()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async getAllNotes() {
    const snap = await getDocs(query(col('notes')));
    return snap.docs.map(d => d.data()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async updateNote(note) {
    await setDoc(docRef('notes', note.id), note);
    return note;
  },

  async deleteNote(id) {
    await deleteDoc(docRef('notes', id));
  },

  // ===== TASK STATUS HELPER =====
  async getTaskStatus(potId, product) {
    const pot = await this.getPot(Number(potId));
    const freq = pot?.scheduleOverrides?.[product.slug] || product.defaultFrequencyDays;
    const lastLog = await this.getLastTaskLog(potId, product.slug);
    if (!lastLog) return { status: 'danger', days: null, label: 'Nunca aplicado', freq };
    const diffDays = Math.floor((new Date() - new Date(lastLog.appliedAt)) / 86400000);
    const remaining = freq - diffDays;
    if (remaining > 1) return { status: 'healthy', days: remaining, label: `Faltan ${remaining} días`, freq };
    if (remaining === 1) return { status: 'healthy', days: 1, label: 'Falta 1 día', freq };
    if (remaining === 0) return { status: 'warning', days: 0, label: 'Hoy toca aplicar', freq };
    const overdue = Math.abs(remaining);
    return { status: 'danger', days: -overdue, label: `${overdue} día${overdue > 1 ? 's' : ''} de atraso`, freq };
  },

  // ===== SETTINGS =====
  async getSetting(key) {
    const snap = await getDoc(docRef('settings', key));
    return snap.exists() ? snap.data().value : null;
  },

  async setSetting(key, value) {
    await setDoc(docRef('settings', key), { key, value });
  },

  async deleteSetting(key) {
    await deleteDoc(docRef('settings', key));
  },

  // ===== CLEAR ALL =====
  async clearAllData() {
    for (const c of ['pots', 'photos', 'analyses', 'taskLogs', 'settings', 'products', 'notes']) {
      const snap = await getDocs(col(c));
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    }
  },

  // ===== INIT =====
  async init(userId) {
    uid = userId;
    await this._seedProducts();
  },

  async _seedProducts() {
    // Skip the Firestore check if we already confirmed products exist this session
    if (sessionStorage.getItem('gardenai-seeded')) return;
    const snap = await getDocs(col('products'));
    if (snap.empty) {
      await Promise.all(DEFAULT_PRODUCTS.map(p =>
        setDoc(docRef('products', p.slug), { ...p, createdAt: new Date().toISOString() })
      ));
    }
    sessionStorage.setItem('gardenai-seeded', '1');
  },

  async getGlobalConfig() {
    try {
      const snap = await getDoc(doc(firestoreDb, 'global', 'config'));
      return snap.exists() ? snap.data() : {};
    } catch { return {}; }
  },

  async setGlobalConfig(data) {
    await setDoc(doc(firestoreDb, 'global', 'config'), data, { merge: true });
  },

  // ===== GLOBAL USER REGISTRY (admin use) =====
  async registerUserProfile(user) {
    try {
      await setDoc(doc(firestoreDb, 'userProfiles', user.uid), {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || '',
        provider: user.providerData?.[0]?.providerId || 'unknown',
        createdAt: user.metadata?.creationTime || new Date().toISOString(),
        lastLogin: new Date().toISOString()
      }, { merge: true });
    } catch(e) { /* non-critical */ }
  },

  async getAllUserProfiles() {
    try {
      const snap = await getDocs(collection(firestoreDb, 'userProfiles'));
      return snap.docs.map(d => d.data()).sort((a, b) => new Date(b.lastLogin) - new Date(a.lastLogin));
    } catch(e) { console.error('getAllUserProfiles error:', e); return []; }
  },

  async deleteUserData(targetUid) {
    for (const c of ['pots', 'photos', 'analyses', 'taskLogs', 'settings', 'products']) {
      const snap = await getDocs(collection(firestoreDb, `users/${targetUid}/${c}`));
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    }
    try { await deleteDoc(doc(firestoreDb, 'userProfiles', targetUid)); } catch {}
  },

  getUser() { return auth.currentUser; }
};

export default DB;
