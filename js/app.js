// js/app.js — Main router and logic for GardenAI v2

import DB from './db.js';
import {
  onAuthChange, loginWithGoogle, logout,
  registerWithEmail, loginWithEmail, resendVerification,
  resetPassword, reloadUser, authErrorMessage,
  handlePendingRedirect
} from './firebase-config.js';
import { captureFromCamera, uploadFromGallery, uploadMultipleFromGallery, blobToDataURL } from './camera.js';
import { analyzePlant, readAnalyzer, detectPhotoType, isConfigured, aiRetryAt, recommendPotForPlant } from './ai.js';
import {
  renderHome, renderPot, renderPhotoDetail, renderSettings, renderTasks,
  renderProducts, renderProductDetail, renderPotModal, renderPhotoModal, renderPhotoSourceModal, renderNotesModal, renderEditNoteModal, renderEditAnalysisModal, renderEditDayModal,
  renderEditPhotoModal, renderPotScheduleModal, renderLogin, renderStats, renderStatsDayDetail,
  renderBulkDateModal, renderBulkNotesModal,
  renderProductModal, renderBulkPotTaskModal, renderBulkApplyProductModal, renderBulkPotNoteModal, renderProductMenu, renderProductDateModal,
  renderEmailLogin, renderRegister, renderVerifyEmail,
  showToast, clearPhotoCache, getPhotoURL, escapeHtml, toInputDate, mapIssuesToProducts,
  renderAnalysisActionsModal, renderPotModeModal, renderApplyTaskModal,
  renderAddPlantSourceModal, renderPlantLoadingModal, renderPlantRecommendationsModal,
  renderStatsChipModal
} from './ui.js';
import { runMigration } from './migration.js';

const mainEl = () => document.getElementById('main-content');

function applyTheme(theme) {
  const validThemes = ['botanical', 'tropical', 'wellness'];
  document.documentElement.setAttribute('data-theme', validThemes.includes(theme) ? theme : '');
}
const modalsEl = () => document.getElementById('modals');
let currentRoute = '';
let selectedPhotos = new Set();
let photoSelectMode = false;
let selectedPotsTask = new Set();
let taskSelectMode = false;
let taskFilter = 'all';
let reorderMode = false;
let reorderPotIds = [];
let _drag = null;
let pendingPlantBlob = null;
let pendingPlantProfile = null;

function togglePhotoSelection(photoId) {
  const id = String(photoId);
  // Support both id-based thumbs (photo detail grid) and data-photo-id elements (pot timeline)
  const thumb = document.getElementById(`photo-${id}`) ||
    document.querySelector(`[data-action="viewPhoto"][data-photo-id="${id}"]`);
  if (selectedPhotos.has(id)) {
    selectedPhotos.delete(id); thumb?.classList.remove('selected');
  } else {
    selectedPhotos.add(id); thumb?.classList.add('selected');
  }
  if (selectedPhotos.size > 0) updateBulkBar();
  else document.getElementById('bulk-action-bar')?.remove();
  updatePhotoSelectBtn();
}

function getAllPotPhotoIds() {
  return [...document.querySelectorAll('[data-action="viewPhoto"][data-photo-id]')]
    .map(el => el.dataset.photoId).filter(Boolean);
}

function updatePhotoSelectBtn() {
  const btn = document.getElementById('select-mode-btn');
  if (!btn) return;
  const allIds = getAllPotPhotoIds();
  const allSelected = photoSelectMode && allIds.length > 0 && allIds.every(id => selectedPhotos.has(id));
  const svgOutlined = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#16a34a" stroke-width="2"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const svgFilled = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#16a34a"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  btn.innerHTML = photoSelectMode ? svgFilled : svgOutlined;
  btn.classList.toggle('select-mode-active', photoSelectMode && !allSelected);
  btn.classList.toggle('select-all-active', allSelected);
}

function clearPhotoSelection() {
  photoSelectMode = false;
  selectedPhotos.clear();
  document.querySelectorAll('.photo-thumb.selected, [data-action="viewPhoto"].selected')
    .forEach(el => el.classList.remove('selected'));
  document.getElementById('bulk-action-bar')?.remove();
  updatePhotoSelectBtn();
}

function updateBulkBar() {
  let bar = document.getElementById('bulk-action-bar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'bulk-action-bar'; bar.className = 'bulk-action-bar'; document.body.appendChild(bar); }
  const n = selectedPhotos.size;
  bar.innerHTML = `
    <div class="bulk-count">${n} foto${n!==1?'s':''} seleccionada${n!==1?'s':''}</div>
    <div class="bulk-actions">
      <button class="bulk-btn" data-action="bulkAnalyze">🤖 Analizar</button>
      <button class="bulk-btn" data-action="bulkDate">📅 Fecha</button>
      <button class="bulk-btn" data-action="bulkNotes">📝 Notas</button>
      <button class="bulk-btn bulk-btn-danger" data-action="bulkDelete">🗑️ Borrar</button>
      <button class="bulk-btn bulk-btn-cancel" data-action="clearPhotoSelection">✕</button>
    </div>`;
}

// ===== ROUTER =====
let _navigating = false;
let _navToken = 0; // incremented on each navigate call to cancel stale renders

async function navigate(hash) {
  const token = ++_navToken;
  if (_navigating) {
    // Already navigating — just record latest destination, current render will restart after
    _navigating = false; // allow re-entry for the new hash
  }
  _navigating = true;
  clearPhotoSelection();
  clearPotSelection();
  photoSelectMode = false;
  if (reorderMode && hash !== '#home' && hash !== '#' && hash !== '') cancelReorderMode();

  const stale = () => token !== _navToken; // true if a newer navigate() started

  let html = '';
  let newRoute = currentRoute;
  let headerHtml = null;
  const escapeHtml = (s) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  if (!hash || hash === '#' || hash === '#home') {
    newRoute = 'home';
    headerHtml = '🪴 Mis Macetas';
    html = await renderHome();
  } else if (hash === '#tasks') {
    newRoute = 'tasks';
    headerHtml = '📋 Tareas';
    html = await renderTasks(taskFilter);
  } else if (hash === '#products') {
    newRoute = 'products';
    headerHtml = '<button class="header-back" data-navigate="home">←</button> 🧴 Productos';
    html = await renderProducts();
  } else if (hash.startsWith('#product/')) {
    newRoute = 'product';
    const slug = hash.split('/')[1];
    const prod = await DB.getProduct(slug);
    headerHtml = `<button class="header-back" data-navigate="products">←</button> ${escapeHtml(prod?.icon||'🧴')} ${escapeHtml(prod?.name||'Producto')}`;
    html = await renderProductDetail(slug);
  } else if (hash.startsWith('#pot/')) {
    const parts = hash.split('/');
    if (parts.length > 2 && parts[2] === 'photo') {
      newRoute = 'photo';
      const [photoPot, photoHtml] = await Promise.all([
        DB.getPot(Number(parts[1])),
        renderPhotoDetail(parts[3])
      ]);
      headerHtml = `<button class="header-back header-back-photo" data-navigate="pot/${parts[1]}">←</button> Foto · ${escapeHtml(photoPot?.emoji||'🪴')} ${escapeHtml(photoPot?.name||'Maceta')}`;
      html = photoHtml;
    } else {
      newRoute = 'pot';
      const [pot, potHtml] = await Promise.all([
        DB.getPot(Number(parts[1])),
        renderPot(parts[1])
      ]);
      headerHtml = `<button class="header-back" data-navigate="home">←</button> ${escapeHtml(pot?.emoji||'🪴')} ${escapeHtml(pot?.name||'Maceta')}`;
      html = potHtml;
    }
  } else if (hash.startsWith('#stats-day/')) {
    const dk = hash.split('/')[1];
    newRoute = 'stats-day';
    const d = new Date(dk + 'T12:00:00');
    const label = d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^\w/, c => c.toUpperCase());
    headerHtml = `<button class="header-back" data-navigate="stats">←</button> ${label}`;
    html = await renderStatsDayDetail(dk);
  } else if (hash === '#stats') {
    newRoute = 'stats';
    headerHtml = '📊 Estadísticas';
    html = await renderStats();
  } else if (hash === '#settings') {
    newRoute = 'settings';
    const currentThemeRaw = await DB.getSetting('theme');
    const currentTheme = currentThemeRaw || 'dark';
    headerHtml = `<div style="flex:1"><div style="font-size:0.9rem;font-weight:500">⚙️ Configuración</div><div style="font-size:0.75rem;color:var(--text-muted)">Ajustes de la aplicación</div></div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm" style="padding:4px 8px;font-size:0.7rem;opacity:${currentTheme==='dark'?'1':'0.4'}" data-action="setTheme" data-theme="dark" title="Jardín Nocturno">🌙</button>
        <button class="btn btn-sm" style="padding:4px 8px;font-size:0.7rem;opacity:${currentTheme==='botanical'?'1':'0.4'}" data-action="setTheme" data-theme="botanical" title="Botanical">🌿</button>
        <button class="btn btn-sm" style="padding:4px 8px;font-size:0.7rem;opacity:${currentTheme==='tropical'?'1':'0.4'}" data-action="setTheme" data-theme="tropical" title="Jardín Vivo">🌺</button>
        <button class="btn btn-sm" style="padding:4px 8px;font-size:0.7rem;opacity:${currentTheme==='wellness'?'1':'0.4'}" data-action="setTheme" data-theme="wellness" title="Wellness">🫚</button>
      </div>`;
    html = await renderSettings();
  }

  // If a newer navigation started while we were loading, abort — don't update DOM
  if (stale()) { _navigating = false; return; }

  currentRoute = newRoute;
  document.documentElement.setAttribute('data-route', newRoute);
  // Hide home toolbar when leaving home
  if (newRoute !== 'home') {
    const tb = document.getElementById('home-toolbar');
    if (tb) tb.style.display = 'none';
  }
  if (headerHtml) {
    document.getElementById('header-title').innerHTML = headerHtml;
  } else {
    document.getElementById('header-title').innerHTML = '';
  }
  mainEl().innerHTML = html;
  if (hash.startsWith('#pot/') && hash.includes('/photo/')) initPhotoZoom();
  if (newRoute === 'product') setupProductDetailForm();
  if (window.location.hash !== hash) history.pushState(null, '', hash);
  updateNav();
  window.scrollTo(0, 0);
  _navigating = false;
}

function updateNav() {
  document.querySelectorAll('.nav-item').forEach(el => {
    const t = el.dataset.nav;
    el.classList.toggle('active',
      (t==='home' && currentRoute==='home') ||
      (t==='tasks' && currentRoute==='tasks') ||
      (t==='products' && (currentRoute==='products'||currentRoute==='product')) ||
      (t==='settings' && currentRoute==='settings') ||
      (t==='stats' && (currentRoute==='stats'||currentRoute==='stats-day'))
    );
  });
}

async function runAddPlantFlow(blob) {
  try {
    modalsEl().innerHTML = renderPlantLoadingModal('Identificando planta...');
    const profile = await analyzePlant(blob);

    modalsEl().innerHTML = renderPlantLoadingModal('Buscando la mejor maceta...');
    const pots = await DB.getAllPots();
    if (!pots.length) {
      closeModal();
      showToast('Primero agrega una maceta en Home');
      return;
    }

    const analysesPerPot = await Promise.all(pots.map(p => DB.getAnalysesByPot(p.id)));
    const potsData = pots.map((pot, i) => {
      const analyses = analysesPerPot[i]
        .filter(a => a.type === 'plant' && a.result)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const latest = analyses[0]?.result;
      const plantTypes = (pot.plantTypes || (pot.plantType ? [pot.plantType] : []));
      return {
        id: pot.id,
        name: pot.name,
        emoji: pot.emoji || '🪴',
        plantTypes,
        lastSun:   latest?.sunRequirements  || null,
        lastWater: latest?.waterRequirements || null,
      };
    });

    const { recommendations, tip } = await recommendPotForPlant(blob, profile, potsData);

    pendingPlantBlob    = blob;
    pendingPlantProfile = profile;
    if (tip) profile._tip = tip;

    modalsEl().innerHTML = renderPlantRecommendationsModal(profile, recommendations || [], pots);
  } catch (e) {
    closeModal();
    showToast('Error: ' + e.message);
  }
}

// ===== ACTIONS =====
function closeModal() { modalsEl().innerHTML = ''; }

function showLoading() {
  mainEl().innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:40vh"><div class="spinner" style="width:32px;height:32px;border:3px solid var(--border-glass);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite"></div></div>';
}

async function handleAction(action, target) {
  switch (action) {
    case 'enterSelectMode': {
      if (!photoSelectMode) {
        photoSelectMode = true;
        updatePhotoSelectBtn();
        showToast('Toca fotos para seleccionar');
      } else {
        const allIds = getAllPotPhotoIds();
        const allSelected = allIds.length > 0 && allIds.every(id => selectedPhotos.has(id));
        if (allSelected) {
          clearPhotoSelection();
          showToast('Selección eliminada');
        } else {
          for (const id of allIds) {
            if (!selectedPhotos.has(id)) {
              selectedPhotos.add(id);
              document.querySelector(`[data-action="viewPhoto"][data-photo-id="${id}"]`)?.classList.add('selected');
            }
          }
          updateBulkBar();
          showToast(`✅ ${allIds.length} foto${allIds.length !== 1 ? 's' : ''} seleccionada${allIds.length !== 1 ? 's' : ''}`);
        }
        updatePhotoSelectBtn();
      }
      break;
    }
    case 'togglePotModeMenu': {
      if (reorderMode) { await saveReorderMode(); break; }
      if (document.getElementById('pot-mode-modal') || document.getElementById('apply-task-modal')) { closeModal(); break; }
      modalsEl().innerHTML = renderPotModeModal();
      break;
    }
    case 'openApplyTask': {
      const [products, pots] = await Promise.all([DB.getAllProducts(), DB.getAllPots()]);
      products.sort((a,b) => a.name.localeCompare(b.name));
      modalsEl().innerHTML = renderApplyTaskModal(products, pots);
      // Wire up product highlight
      modalsEl().querySelectorAll('.apply-product-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          modalsEl().querySelectorAll('.apply-product-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); b.style.borderColor=''; });
          btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');
          document.getElementById('apply-task-slug').value = btn.dataset.slug;
        });
      });
      break;
    }
    case 'confirmApplyTask': {
      const slug = document.getElementById('apply-task-slug')?.value;
      if (!slug) { showToast('Selecciona un producto primero'); break; }
      const checkedPots = [...modalsEl().querySelectorAll('.apply-pot-check:checked')].map(el => el.dataset.potId);
      if (!checkedPots.length) { showToast('Selecciona al menos una maceta'); break; }
      for (const potId of checkedPots) await DB.addTaskLog({ potId: Number(potId), productSlug: slug });
      closeModal();
      showToast(`✅ Aplicado a ${checkedPots.length} maceta${checkedPots.length!==1?'s':''}`);
      break;
    }
    case 'enterPotSelectMode': {
      // No longer used — kept so old references don't crash
      closeModal();
      break;
    }
    case 'enterReorderMode': {
      closeModal();
      if (!reorderMode) {
        startReorderMode();
      } else {
        await saveReorderMode();
      }
      break;
    }
    case 'enterPotSelectModeTask': {
      if (!taskSelectMode) {
        // Primer click: entrar en modo selección
        taskSelectMode = true;
        showToast('Toca macetas para seleccionar');
        updateTaskSelectAllBtn();
      } else {
        const allIds = getAllTaskPotIds();
        const allSelected = allIds.length > 0 && allIds.every(id => selectedPotsTask.has(id));
        const noneSelected = selectedPotsTask.size === 0;

        if (allSelected || noneSelected) {
          // Todo seleccionado o nada seleccionado → salir del modo
          taskSelectMode = false;
          clearTaskPotSelection();
          showToast('Selección cancelada');
        } else {
          // Selección parcial → seleccionar todo
          for (const id of allIds) {
            if (!selectedPotsTask.has(id)) {
              selectedPotsTask.add(id);
              const card = document.querySelector(`[data-toggle-select="task"][data-pot-id="${id}"]`);
              card?.classList.add('pot-selected');
              card?.querySelector('.pot-select-check')?.classList.add('checked');
            }
          }
          updateTaskBulkBar();
          showToast(`✅ ${allIds.length} maceta${allIds.length !== 1 ? 's' : ''} seleccionada${allIds.length !== 1 ? 's' : ''}`);
        }
        updateTaskSelectAllBtn();
      }
      break;
    }
    case 'clearTaskSelection': { taskSelectMode = false; clearTaskPotSelection(); break; }
    case 'setTaskFilter': {
      taskFilter = target.dataset.filter || 'all';
      mainEl().innerHTML = await renderTasks(taskFilter);
      break;
    }
    case 'bulkRecommendProduct':
    case 'bulkExecuteProduct': {
      const execMode = action === 'bulkExecuteProduct' ? 'execute' : 'recommend';
      const products = await DB.getAllProducts();
      products.sort((a, b) => a.name.localeCompare(b.name));

      // Get recommended products from selected pots
      const recommendedSet = new Set();
      for (const potId of [...selectedPotsTask]) {
        const analyses = await DB.getAnalysesByPot(Number(potId));
        const recommended = mapIssuesToProducts(analyses.filter(a => a.type === 'plant').flatMap(a => a.result?.issues || []), null);
        recommended.forEach(p => recommendedSet.add(p.slug));
      }

      modalsEl().innerHTML = renderBulkApplyProductModal(products, selectedPotsTask.size, [...recommendedSet], execMode);
      break;
    }
    case 'confirmBulkRecommendProduct': {
      const slug = target.dataset.productSlug;
      const ids = [...selectedPotsTask];

      for (const potId of ids) {
        const pot = await DB.getPot(Number(potId));
        if (pot) {
          if (!pot.activeProducts || pot.activeProducts.length === 0) {
            pot.activeProducts = [slug];
          } else if (!pot.activeProducts.includes(slug)) {
            pot.activeProducts.push(slug);
          }
          await DB.updatePot(pot);
          await DB.deleteTaskLogsByProductAndPot(Number(potId), slug);
        }
      }
      closeModal(); clearTaskPotSelection();
      showToast(`⭐ Producto recomendado en ${ids.length} maceta${ids.length!==1?'s':''}`);
      await new Promise(r => setTimeout(r, 500));
      mainEl().innerHTML = await renderTasks(taskFilter);
      break;
    }
    case 'confirmBulkExecuteProduct': {
      const slug = target.dataset.productSlug;
      const ids = [...selectedPotsTask];
      const now = new Date().toISOString();

      for (const potId of ids) {
        const pot = await DB.getPot(Number(potId));
        if (pot) {
          if (!pot.activeProducts || pot.activeProducts.length === 0) {
            pot.activeProducts = [slug];
          } else if (!pot.activeProducts.includes(slug)) {
            pot.activeProducts.push(slug);
          }
          await DB.updatePot(pot);
          // Delete old logs for this product+pot, then add a new one for today
          await DB.deleteTaskLogsByProductAndPot(Number(potId), slug);
          await DB.addTaskLog({ potId: Number(potId), productSlug: slug, appliedAt: now });
        }
      }
      closeModal(); clearTaskPotSelection();
      showToast(`⚡ Ejecutado en ${ids.length} maceta${ids.length!==1?'s':''} — próxima vez calculada`);
      await new Promise(r => setTimeout(r, 500));
      mainEl().innerHTML = await renderTasks(taskFilter);
      break;
    }
    case 'editPotProducts': {
      const potId = target.dataset.potId;
      modalsEl().innerHTML = await renderEditPotProductsModal(potId);
      break;
    }
    case 'savePotProducts': {
      const potId = target.dataset.potId;
      const pot = await DB.getPot(Number(potId));
      const selected = [];
      document.querySelectorAll('.product-checkbox:checked').forEach(cb => selected.push(cb.dataset.slug));
      pot.activeProducts = selected;
      await DB.updatePot(pot);
      closeModal(); showToast('Productos guardados ✓');
      mainEl().innerHTML = await renderTasks(taskFilter);
      break;
    }
    case 'removeProductFromPot': {
      const potId = Number(target.dataset.potId);
      const productSlug = target.dataset.productSlug;
      const pot = await DB.getPot(potId);
      if (pot.activeProducts) {
        pot.activeProducts = pot.activeProducts.filter(s => s !== productSlug);
        await DB.updatePot(pot);
        showToast('Producto removido ✓');
        mainEl().innerHTML = await renderTasks(taskFilter);
      }
      break;
    }
    case 'addPot': { modalsEl().innerHTML = renderPotModal(); setupPotForm(); break; }
    case 'editPot': { const pot = await DB.getPot(Number(target.dataset.potId)); modalsEl().innerHTML = renderPotModal(pot); setupPotForm(); break; }
    case 'deletePot': {
      if (confirm('¿Eliminar esta maceta y todas sus fotos?')) {
        await DB.deletePot(Number(target.dataset.potId)); closeModal(); clearPhotoCache();
        window.location.hash = '#home'; showToast('Maceta eliminada');
      } break;
    }
    case 'statsChipDetail': {
      const icon   = target.dataset.icon;
      const label  = target.dataset.label;
      const color  = target.dataset.color;
      const potIds = (target.dataset.potIds || '').split(',').map(Number).filter(Boolean);
      modalsEl().innerHTML = await renderStatsChipModal(icon, label, color, potIds);
      break;
    }
    case 'addPlant': {
      try {
        const blob = await uploadFromGallery();
        await runAddPlantFlow(blob);
      } catch (e) {
        if (e.message !== 'No se seleccionó ninguna foto') showToast('Error: ' + e.message);
      }
      break;
    }
    case 'plantInPot': {
      const potId = Number(target.dataset.potId);
      const blob  = pendingPlantBlob;
      const profile = pendingPlantProfile;
      pendingPlantBlob    = null;
      pendingPlantProfile = null;
      closeModal();
      if (!blob) { showToast('Error: no hay foto pendiente'); break; }
      showToast('Guardando planta...');
      try {
        const photo = await DB.addPhoto({ potId, type: 'plant', blob, createdAt: new Date().toISOString() });
        clearPhotoCache();
        if (profile) {
          await DB.addAnalysis({ photoId: photo.id, potId, type: 'plant', result: profile, createdAt: new Date().toISOString() });
        }
        await navigate(`#pot/${potId}`);
        showToast('🌱 Planta agregada ✅');
      } catch (e) {
        showToast('Error al guardar: ' + e.message);
      }
      break;
    }
    case 'addPhoto': { modalsEl().innerHTML = renderPhotoModal(target.dataset.potId); break; }
    case 'selectPhotoType': {
      modalsEl().innerHTML = renderPhotoSourceModal(target.dataset.potId, target.dataset.photoType);
      break;
    }
    case 'openNotesModal': {
      const potId = target.dataset.potId;
      modalsEl().innerHTML = renderNotesModal(potId);
      break;
    }
    case 'saveNote': {
      const potId = target.dataset.potId;
      const noteText = document.getElementById('new-note-text')?.value || '';
      if (!noteText.trim()) {
        showToast('Escribe algo antes de guardar');
        break;
      }
      try {
        await DB.addNote({
          potId: Number(potId),
          text: noteText,
          createdAt: new Date().toISOString()
        });
        closeModal();
        showToast('Nota guardada ✅');
        await navigate(`#pot/${potId}`);
      } catch(e) {
        showToast('Error al guardar: ' + e.message);
      }
      break;
    }
    case 'editNote': {
      const noteId = target.dataset.noteId;
      modalsEl().innerHTML = await renderEditNoteModal(noteId);
      const form = document.getElementById('edit-note-form');
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const noteText = document.getElementById('edit-note-text')?.value || '';
          const noteDate = document.getElementById('edit-note-date')?.value || '';
          if (!noteText.trim()) {
            showToast('Escribe algo antes de guardar');
            return;
          }
          try {
            const note = await DB.getNote(Number(noteId));
            note.text = noteText;
            note.createdAt = noteDate ? new Date(noteDate).toISOString() : note.createdAt;
            await DB.updateNote(note);
            closeModal();
            showToast('Nota actualizada ✅');
            await navigate(`#pot/${note.potId}`);
          } catch(e) {
            showToast('Error al guardar: ' + e.message);
          }
        });
      }
      break;
    }
    case 'deleteNote': {
      const noteId = target.dataset.noteId;
      if (!confirm('¿Eliminar esta nota?')) break;
      try {
        const note = await DB.getNote(Number(noteId));
        await DB.deleteNote(noteId);
        closeModal();
        showToast('Nota eliminada ✅');
        await navigate(`#pot/${note.potId}`);
      } catch(e) {
        showToast('Error al eliminar: ' + e.message);
      }
      break;
    }
    case 'editAnalysis': {
      const analysisId = target.dataset.analysisId;
      modalsEl().innerHTML = await renderEditAnalysisModal(analysisId);
      const form = document.getElementById('edit-analysis-form');
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const analysisDate = document.getElementById('edit-analysis-date')?.value || '';
          const analysisDataStr = document.getElementById('edit-analysis-data')?.value || '{}';
          try {
            const analysis = await DB.getAnalysis(Number(analysisId));
            analysis.createdAt = analysisDate ? new Date(analysisDate).toISOString() : analysis.createdAt;
            try {
              analysis.result = JSON.parse(analysisDataStr);
            } catch(e) {
              showToast('JSON inválido en datos del análisis');
              return;
            }
            await DB.updateAnalysis(analysis);
            closeModal();
            showToast('Análisis actualizado ✅');
            await navigate(`#pot/${analysis.potId}`);
          } catch(e) {
            showToast('Error al guardar: ' + e.message);
          }
        });
      }
      break;
    }
    case 'deleteAnalysis': {
      const analysisId = target.dataset.analysisId;
      if (!confirm('¿Eliminar este análisis?')) break;
      try {
        const analysis = await DB.getAnalysis(Number(analysisId));
        await DB.deleteAnalysis(analysisId);
        closeModal();
        showToast('Análisis eliminado ✅');
        await navigate(`#pot/${analysis.potId}`);
      } catch(e) {
        showToast('Error al eliminar: ' + e.message);
      }
      break;
    }
    case 'editDayItems': {
      const dateKey = target.dataset.date;
      // Need to get potId from current route
      const hashMatch = window.location.hash.match(/#pot\/(\d+)/);
      if (!hashMatch) break;
      const potId = hashMatch[1];

      // Get first item of the day and open its edit modal directly
      const pot = await DB.getPot(Number(potId));
      const photos = await DB.getPhotosByPot(potId);
      const notes = await DB.getNotesByPot(potId);
      const analyses = await DB.getAnalysesByPot(potId);

      const photosInDate = photos.filter(p => p.createdAt.startsWith(dateKey));
      const notesInDate = notes.filter(n => n.createdAt.startsWith(dateKey));
      const analysesInDate = analyses.filter(a => a.createdAt.startsWith(dateKey));

      // Open edit modal for first item found
      if (photosInDate.length > 0) {
        modalsEl().innerHTML = await renderEditPhotoModal(photosInDate[0].id);
        setupEditPhotoForm();
      } else if (notesInDate.length > 0) {
        modalsEl().innerHTML = await renderEditNoteModal(notesInDate[0].id);
        const form = document.getElementById('edit-note-form');
        if (form) {
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const noteText = document.getElementById('edit-note-text')?.value || '';
            const noteDate = document.getElementById('edit-note-date')?.value || '';
            if (!noteText.trim()) {
              showToast('Escribe algo antes de guardar');
              return;
            }
            try {
              const note = await DB.getNote(Number(notesInDate[0].id));
              note.text = noteText;
              note.createdAt = noteDate ? new Date(noteDate).toISOString() : note.createdAt;
              await DB.updateNote(note);
              closeModal();
              showToast('Nota actualizada ✅');
              await navigate(`#pot/${note.potId}`);
            } catch(e) {
              showToast('Error al guardar: ' + e.message);
            }
          });
        }
      } else if (analysesInDate.length > 0) {
        modalsEl().innerHTML = await renderEditAnalysisModal(analysesInDate[0].id);
        const form = document.getElementById('edit-analysis-form');
        if (form) {
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const analysisDate = document.getElementById('edit-analysis-date')?.value || '';
            const analysisDataStr = document.getElementById('edit-analysis-data')?.value || '{}';
            try {
              const analysis = await DB.getAnalysis(Number(analysesInDate[0].id));
              analysis.createdAt = analysisDate ? new Date(analysisDate).toISOString() : analysis.createdAt;
              try {
                analysis.result = JSON.parse(analysisDataStr);
              } catch(e) {
                showToast('JSON inválido en datos del análisis');
                return;
              }
              await DB.updateAnalysis(analysis);
              closeModal();
              showToast('Análisis actualizado ✅');
              await navigate(`#pot/${analysis.potId}`);
            } catch(e) {
              showToast('Error al guardar: ' + e.message);
            }
          });
        }
      }
      break;
    }
    case 'capturePhoto': {
      const potId = target.dataset.potId;
      const photoType = target.dataset.photoType || 'plant';
      closeModal();
      await captureMultiplePhotos(potId, photoType);
      break;
    }
    case 'uploadPhoto': {
      const potId = target.dataset.potId;
      const photoType = target.dataset.photoType || 'plant';
      closeModal();
      try {
        const blobs = await uploadMultipleFromGallery();
        if (!blobs.length) break;
        showToast(`⏳ Guardando ${blobs.length} foto${blobs.length > 1 ? 's' : ''}...`, 30000);
        for (let i = 0; i < blobs.length; i++) {
          if (blobs.length > 1) showToast(`⏳ Guardando foto ${i + 1} de ${blobs.length}...`, 10000);
          await savePhotoQuiet(potId, blobs[i], photoType);
        }
        clearPhotoCache();
        await navigate(`#pot/${potId}`);
        showToast(`✅ ${blobs.length} foto${blobs.length > 1 ? 's' : ''} guardada${blobs.length > 1 ? 's' : ''}`);
      } catch(e) {
        if (e.message !== 'No se seleccionaron fotos') showToast('Error: ' + e.message);
      }
      break;
    }
    case 'viewPhoto': {
      const pid = target.dataset.photoId || target.closest('[data-photo-id]')?.dataset.photoId;
      if (!pid) break;
      const p = await DB.getPhoto(Number(pid));
      if (p) navigate(`#pot/${p.potId}/photo/${pid}`);
      break;
    }
    case 'clearPhotoSelection': { clearPhotoSelection(); break; }
    case 'bulkPotTask': {
      // Legacy — redirect to new combined modal
      const [products2, pots2] = await Promise.all([DB.getAllProducts(), DB.getAllPots()]);
      products2.sort((a,b) => a.name.localeCompare(b.name));
      modalsEl().innerHTML = renderApplyTaskModal(products2, pots2);
      modalsEl().querySelectorAll('.apply-product-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          modalsEl().querySelectorAll('.apply-product-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
          btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');
          document.getElementById('apply-task-slug').value = btn.dataset.slug;
        });
      });
      break;
    }
    case 'confirmBulkPotTask': {
      // Legacy slug-based confirm still works for tasks view
      const slug = target.dataset.slug;
      const ids = [...selectedPotsTask];
      for (const potId of ids) await DB.addTaskLog({ potId: Number(potId), productSlug: slug });
      closeModal(); clearTaskSelection();
      showToast(`✅ Aplicado a ${ids.length} maceta${ids.length!==1?'s':''}`);
      break;
    }
    case 'bulkPotNote': {
      closeModal();
      modalsEl().innerHTML = renderBulkPotNoteModal(selectedPotsTask.size);
      break;
    }
    case 'confirmBulkPotNote': {
      const noteText = document.getElementById('bulk-pot-note-input')?.value || '';
      if (!noteText.trim()) { showToast('Escribe algo antes de guardar'); break; }
      const ids = [...selectedPotsTask];
      const now = new Date().toISOString();
      for (const potId of ids) {
        await DB.addNote({ potId: Number(potId), text: noteText, createdAt: now });
      }
      closeModal(); clearTaskSelection();
      showToast(`📝 Nota guardada en ${ids.length} maceta${ids.length!==1?'s':''}`);
      break;
    }
    case 'addProduct': {
      modalsEl().innerHTML = renderProductModal();
      setupProductModalForm();
      break;
    }
    case 'deleteProductFromModal': {
      const slug = target.dataset.slug;
      if (!confirm('¿Eliminar este producto? Se borrarán también sus registros de tareas.')) break;
      await DB.deleteProduct(slug);
      closeModal(); showToast('Producto eliminado');
      mainEl().innerHTML = await renderProducts();
      break;
    }
    case 'bulkAnalyze': {
      const ids = [...selectedPhotos];
      clearPhotoSelection();
      showToast(`Analizando ${ids.length} foto${ids.length!==1?'s':''}...`, 4000);
      for (let i = 0; i < ids.length; i++) {
        showToast(`Analizando ${i+1}/${ids.length}...`, 3000);
        await runAnalysis(Number(ids[i]));
      }
      showToast('✅ Análisis completado');
      break;
    }
    case 'bulkDate': {
      modalsEl().innerHTML = renderBulkDateModal(selectedPhotos.size);
      break;
    }
    case 'confirmBulkDate': {
      const dateVal = document.getElementById('bulk-date-input')?.value;
      if (!dateVal) { showToast('Selecciona una fecha'); break; }
      const ids = [...selectedPhotos];
      for (const id of ids) {
        const photo = await DB.getPhoto(Number(id));
        if (!photo) continue;
        const old = new Date(photo.createdAt);
        const nd = new Date(dateVal);
        nd.setHours(old.getHours(), old.getMinutes(), old.getSeconds());
        photo.createdAt = nd.toISOString();
        await DB.updatePhoto(photo);
      }
      closeModal(); clearPhotoSelection(); clearPhotoCache();
      showToast(`Fecha actualizada en ${ids.length} foto${ids.length!==1?'s':''} ✓`);
      navigate(window.location.hash);
      break;
    }
    case 'bulkNotes': {
      modalsEl().innerHTML = renderBulkNotesModal(selectedPhotos.size);
      break;
    }
    case 'confirmBulkNotes': {
      const notes = document.getElementById('bulk-notes-input')?.value || '';
      const ids = [...selectedPhotos];
      for (const id of ids) {
        const photo = await DB.getPhoto(Number(id));
        if (!photo) continue;
        photo.userNotes = notes;
        await DB.updatePhoto(photo);
      }
      closeModal(); clearPhotoSelection();
      showToast(`Notas aplicadas a ${ids.length} foto${ids.length!==1?'s':''} ✓`);
      break;
    }
    case 'bulkDelete': {
      const ids = [...selectedPhotos];
      if (!confirm(`¿Eliminar ${ids.length} foto${ids.length!==1?'s':''}? Esta acción no se puede deshacer.`)) break;
      for (const id of ids) await DB.deletePhoto(Number(id));
      clearPhotoSelection(); clearPhotoCache();
      showToast(`${ids.length} foto${ids.length!==1?'s':''} eliminada${ids.length!==1?'s':''} ✓`);
      navigate(window.location.hash);
      break;
    }
    case 'openAnalysisMenu': {
      const photoId = Number(target.dataset.photoId);
      const switchType = target.dataset.switchType;
      const switchLabel = target.dataset.switchLabel;
      const photo = await DB.getPhoto(photoId);
      const pot = photo ? await DB.getPot(photo.potId) : null;
      const isMain = pot?.mainPhotoId === photoId;
      modalsEl().innerHTML = renderAnalysisActionsModal(photoId, switchType, switchLabel, isMain);
      break;
    }
    case 'setMainPhoto': {
      closeModal();
      const photoId = Number(target.dataset.photoId);
      const photo = await DB.getPhoto(photoId);
      if (!photo) { showToast('Error: foto no encontrada'); break; }
      const pot = await DB.getPot(photo.potId);
      if (!pot) break;
      await DB.updatePot({ ...pot, mainPhotoId: photoId });
      clearPhotoCache();
      showToast('⭐ Foto principal guardada — se verá en Mis Macetas');
      break;
    }
    case 'analyzePhoto': { closeModal(); await runAnalysis(Number(target.dataset.photoId)); break; }
    case 'switchPhotoType': {
      const pid = Number(target.dataset.photoId);
      const newType = target.dataset.newType;
      const photoToUpdate = await DB.getPhoto(pid);
      if (photoToUpdate) await DB.updatePhoto({ ...photoToUpdate, type: newType });
      await runAnalysis(pid);
      break;
    }
    case 'deletePhoto': {
      if (confirm('¿Eliminar esta foto?')) {
        const p = await DB.getPhoto(Number(target.dataset.photoId));
        await DB.deletePhoto(Number(target.dataset.photoId)); clearPhotoCache();
        showToast('Foto eliminada'); window.location.hash = `#pot/${p.potId}`;
      } break;
    }
    case 'editPhoto': {
      modalsEl().innerHTML = await renderEditPhotoModal(target.dataset.photoId);
      setupEditPhotoForm();
      break;
    }
    case 'applyProduct': {
      const potId = target.dataset.potId, slug = target.dataset.productSlug;
      await DB.addTaskLog({ potId: Number(potId), productSlug: slug });
      showToast('✅ Producto aplicado');
      mainEl().innerHTML = await renderTasks(taskFilter);
      break;
    }
    case 'openProductMenu': {
      const potId = target.dataset.potId, slug = target.dataset.productSlug;
      modalsEl().innerHTML = await renderProductMenu(potId, slug);
      break;
    }
    case 'changeProductDate': {
      const potId = target.dataset.potId, slug = target.dataset.productSlug;
      const allLogs = await DB.getTaskLogsByPot(Number(potId));
      const logs = allLogs.filter(l => l.productSlug === slug);
      const lastLog = logs.length > 0 ? logs.sort((a,b) => new Date(b.appliedAt) - new Date(a.appliedAt))[0] : null;
      const lastDate = lastLog ? toInputDate(lastLog.appliedAt) : new Date().toISOString().slice(0, 10);
      modalsEl().innerHTML = renderProductDateModal(potId, slug, lastDate);
      setupProductDateCalendar();
      break;
    }
    case 'saveProductDate': {
      const potId = Number(target.dataset.potId);
      const slug = target.dataset.productSlug;
      const selectedDate = document.getElementById('selected-date')?.value;
      if (selectedDate) {
        const date = new Date(selectedDate + 'T12:00:00');
        await DB.addTaskLog({ potId, productSlug: slug, appliedAt: date.toISOString() });
        closeModal();
        showToast('✅ Fecha actualizada');
        await new Promise(r => setTimeout(r, 500));
        mainEl().innerHTML = await renderTasks(taskFilter);
      }
      break;
    }
    case 'markProductDone': {
      const potId = Number(target.dataset.potId);
      const slug = target.dataset.productSlug;
      console.log('markProductDone:', potId, slug);
      const newLog = await DB.addTaskLog({ potId, productSlug: slug });
      console.log('New log created:', newLog);
      closeModal();
      showToast('✅ Producto marcado como aplicado');
      await new Promise(r => setTimeout(r, 500));
      const allLogs = await DB.getTaskLogsByPot(potId);
      console.log('All logs after add:', allLogs);
      mainEl().innerHTML = await renderTasks(taskFilter);
      break;
    }
    case 'deleteProductFromPot': {
      const potId = Number(target.dataset.potId);
      const slug = target.dataset.productSlug;
      const pot = await DB.getPot(potId);
      if (!pot) break;
      pot.activeProducts = (pot.activeProducts || []).filter(s => s !== slug);
      await DB.updatePot(pot);
      await DB.deleteTaskLogsByProductAndPot(potId, slug);
      closeModal();
      showToast('🗑️ Producto eliminado');
      await new Promise(r => setTimeout(r, 100));
      mainEl().innerHTML = await renderTasks(taskFilter);
      break;
    }
    case 'selectCalendarDay': {
      const dateStr = target.dataset.date;
      const selectedInput = document.getElementById('selected-date');
      if (selectedInput) selectedInput.value = dateStr;
      document.querySelectorAll('.calendar-day').forEach(btn => {
        const btnDate = btn.dataset.date;
        if (btnDate === dateStr) {
          btn.style.backgroundColor = 'var(--accent)';
          btn.style.color = '#fff';
          btn.style.fontWeight = '600';
        } else {
          btn.style.backgroundColor = 'transparent';
          btn.style.color = 'var(--text-primary)';
          btn.style.fontWeight = '400';
        }
      });
      break;
    }
    case 'calendarPrevMonth':
    case 'calendarNextMonth': {
      const wrapper = document.querySelector('.calendar-wrapper');
      if (!wrapper) break;
      let year = parseInt(wrapper.dataset.year);
      let month = parseInt(wrapper.dataset.month);
      if (action === 'calendarNextMonth') {
        month++;
        if (month > 11) { month = 0; year++; }
      } else {
        month--;
        if (month < 0) { month = 11; year--; }
      }
      const selectedDate = document.getElementById('selected-date')?.value || new Date().toISOString().slice(0, 10);
      const { generateMonthlyCalendar } = await import('./ui.js');
      wrapper.innerHTML = generateMonthlyCalendar(selectedDate);
      wrapper.dataset.year = year;
      wrapper.dataset.month = month;
      break;
    }
    case 'openPotSchedule': {
      modalsEl().innerHTML = await renderPotScheduleModal(target.dataset.potId);
      setupScheduleForm();
      break;
    }
    case 'saveProduct': {
      // Handled by form submit in setupProductDetailForm — this is a no-op fallback
      break;
    }
    case 'cancelProduct': {
      navigate('#products');
      break;
    }
    case 'deleteProduct': {
      const slug = target.dataset.slug;
      if (!confirm('¿Eliminar este producto? Se borrarán también sus registros de tareas.')) break;
      await DB.deleteProduct(slug);
      showToast('Producto eliminado');
      navigate('#products');
      break;
    }
    case 'editProductModal': {
      // Legacy — no longer used from product detail; kept for safety
      const slug = target.dataset.slug;
      const product = await DB.getProduct(slug);
      modalsEl().innerHTML = renderProductModal(product);
      setupProductModalForm();
      break;
    }
    case 'addProductPhoto': {
      const slug = target.dataset.slug;
      try {
        const blob = await uploadFromGallery();
        const dataUrl = await blobToDataURL(blob);
        const product = await DB.getProduct(slug);
        if (!product.photos) product.photos = [];
        product.photos.push(dataUrl);
        await DB.updateProduct(product);
        showToast('Foto agregada ✓');
        mainEl().innerHTML = await renderProductDetail(slug);
        setupProductDetailForm();
      } catch(e) { /* cancelled */ }
      break;
    }
    case 'deleteProductPhoto': {
      const slug = target.dataset.slug, idx = Number(target.dataset.index);
      const product = await DB.getProduct(slug);
      product.photos.splice(idx, 1);
      await DB.updateProduct(product);
      showToast('Foto eliminada');
      mainEl().innerHTML = await renderProductDetail(slug);
      setupProductDetailForm();
      break;
    }
    case 'testAiKey': {
      const resultEl = document.getElementById('ai-test-result');
      const testBtn = document.getElementById('test-ai-btn');
      if (!resultEl || !testBtn) break;
      resultEl.style.display = 'block';
      resultEl.style.color = 'var(--text-muted)';
      resultEl.textContent = '⏳ Probando...';
      testBtn.disabled = true;
      const show = (color, msg) => { resultEl.style.color = color; resultEl.textContent = msg; };
      (async () => {
        try {
          // For non-admin there's no provider select — infer from which field exists
          const providerSelect = document.getElementById('ai-provider');
          const groqInput = document.getElementById('groq-key-input');
          const provider = providerSelect?.value || (groqInput ? 'groq' : 'gemini');
          const inputKey = provider === 'groq'
            ? groqInput?.value?.trim()
            : document.getElementById('gemini-key-input')?.value?.trim();
          const savedKey = await DB.getSetting(provider === 'groq' ? 'groqApiKey' : 'geminiApiKey');
          const key = inputKey || savedKey;
          if (!key) { show('#f59e0b', '⚠️ No hay clave guardada. Ingresa y guarda primero.'); return; }
          if (provider !== 'gemini') {
            // Test Groq with a minimal text call
            const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
              body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: 'Reply with only: OK' }], max_tokens: 5 })
            }).catch(() => null);
            if (!groqResp) { show('#ef4444', '❌ Error de red. Verifica tu conexión a internet.'); return; }
            if (groqResp.status === 401) { show('#ef4444', '❌ Clave inválida (401). Verifica que la copiaste completa.'); return; }
            if (groqResp.status === 429) { show('#f59e0b', '⚠️ Límite de Groq alcanzado. Espera un momento.'); return; }
            if (!groqResp.ok) { show('#ef4444', `❌ Error ${groqResp.status}`); return; }
            show('#16a34a', '✅ ¡Clave de Groq válida y funciona! Ya puedes analizar fotos.');
            return;
          }
          const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with only: OK' }] }], generationConfig: { maxOutputTokens: 5 } })
          });
          const data = await resp.json();
          if (resp.status === 401) { show('#ef4444', '❌ Clave inválida (401). Verifica que la copiaste completa y sin espacios.'); return; }
          if (resp.status === 429) { const detail = data?.error?.message || data?.error?.status || ''; show('#f59e0b', `⚠️ 429: ${detail || 'cuota agotada'}. Crea otra clave en AI Studio.`); return; }
          if (resp.status === 403) { show('#ef4444', '❌ Acceso denegado (403). La clave tiene restricciones — en AI Studio verifica que no tenga limitación de IP/referrer.'); return; }
          if (!resp.ok) { show('#ef4444', `❌ Error ${resp.status}: ${data?.error?.message || 'desconocido'}`); return; }
          show('#16a34a', `✅ ¡Clave válida y funciona! Ya puedes analizar fotos.`);
        } catch(e) {
          show('#ef4444', `❌ Error de red: ${e.message}`);
        } finally {
          testBtn.disabled = false;
        }
      })();
      break;
    }
    case 'saveAiSettings': {
      const providerEl = document.getElementById('ai-provider');
      const geminiKey = document.getElementById('gemini-key-input')?.value?.trim();
      const groqKey = document.getElementById('groq-key-input')?.value?.trim();

      // Warn if keys look swapped
      if (groqKey && groqKey.startsWith('AIzaSy')) {
        showToast('⚠️ Esa parece una clave de Gemini (AIzaSy...). Pégala en el campo de Gemini, no en Groq.', 6000);
        break;
      }
      if (geminiKey && geminiKey.startsWith('gsk_')) {
        showToast('⚠️ Esa parece una clave de Groq (gsk_...). Pégala en el campo de Groq, no en Gemini.', 6000);
        break;
      }

      if (providerEl) {
        await DB.setSetting('aiProvider', providerEl.value);
      } else if (groqKey) {
        // Non-admin saved a Groq key — make sure Groq is the active provider
        await DB.setSetting('aiProvider', 'groq');
      }
      if (geminiKey) await DB.setSetting('geminiApiKey', geminiKey);
      if (groqKey) await DB.setSetting('groqApiKey', groqKey);

      if (!groqKey && !geminiKey) { showToast('Escribe una clave antes de guardar'); break; }
      showToast('✅ Configuración guardada');
      break;
    }
    case 'clearGroqKey': {
      await DB.deleteSetting('groqApiKey');
      showToast('✅ Clave personal eliminada. Se usará la clave global del sistema.');
      mainEl().innerHTML = await renderSettings();
      break;
    }
    case 'saveGlobalConfig': {
      const gGroqKey   = document.getElementById('global-groq-key')?.value?.trim();
      const gGeminiKey = document.getElementById('global-gemini-key')?.value?.trim();
      if (gGroqKey && gGroqKey.startsWith('AIzaSy')) {
        showToast('⚠️ Eso parece una clave de Gemini. Ponla en el campo de Gemini.', 5000); break;
      }
      if (gGeminiKey && gGeminiKey.startsWith('gsk_')) {
        showToast('⚠️ Eso parece una clave de Groq. Ponla en el campo de Groq.', 5000); break;
      }
      const update = {};
      if (gGroqKey)   update.groqApiKey   = gGroqKey;
      if (gGeminiKey) update.geminiApiKey = gGeminiKey;
      if (!Object.keys(update).length) { showToast('Escribe al menos una clave para guardar'); break; }
      try {
        await DB.setGlobalConfig(update);
        showToast('✅ Claves globales guardadas');
        mainEl().innerHTML = await renderSettings();
      } catch(e) {
        console.error('saveGlobalConfig error:', e);
        if (e.code === 'permission-denied' || e.message?.includes('permission')) {
          showToast('❌ Sin permiso para escribir. Ve a Firebase Console → Firestore → global/config y añade la clave manualmente.', 10000);
        } else {
          showToast('❌ Error al guardar: ' + e.message, 8000);
        }
      }
      break;
    }
    case 'adminDeleteUser': {
      const uid = target.dataset.uid;
      const email = target.dataset.email;
      if (!confirm(`¿Borrar todos los datos de "${email}"?\n\nEsto elimina sus macetas, fotos y análisis. No se puede deshacer.`)) break;
      showToast('Borrando datos del usuario...', 10000);
      await DB.deleteUserData(uid);
      showToast(`✅ Datos de ${email} eliminados`);
      mainEl().innerHTML = await renderSettings();
      break;
    }
    case 'reloadAdminUsers': {
      mainEl().innerHTML = await renderSettings();
      break;
    }
    case 'setTheme': {
      const theme = target.dataset.theme;
      await DB.setSetting('theme', theme);
      localStorage.setItem('gardenai-theme', theme);
      applyTheme(theme);
      mainEl().innerHTML = await renderSettings();
      break;
    }
    case 'exportData': { await exportAllData(); break; }
    case 'clearData': {
      if (confirm('⚠️ ¿Borrar TODOS los datos? Esta acción no se puede deshacer.')) {
        await DB.clearAllData();
        clearPhotoCache(); showToast('Datos borrados'); setTimeout(()=>location.reload(),1000);
      } break;
    }
    case 'login': {
      try { await loginWithGoogle(); }
      catch(e) { if (e.code !== 'auth/popup-closed-by-user') showToast('Error al iniciar sesión: ' + e.message); }
      break;
    }
    case 'showEmailLogin': {
      mainEl().innerHTML = renderEmailLogin();
      setupEmailLoginForm();
      break;
    }
    case 'showRegister': {
      mainEl().innerHTML = renderRegister();
      setupRegisterForm();
      break;
    }
    case 'showLogin': {
      mainEl().innerHTML = renderLogin();
      break;
    }
    case 'forgotPassword': {
      const email = document.getElementById('login-email')?.value?.trim();
      if (!email) { showToast('Ingresa tu email primero'); break; }
      try {
        await resetPassword(email);
        showToast('✉️ Email de recuperación enviado');
      } catch(e) { showToast(authErrorMessage(e.code)); }
      break;
    }
    case 'checkVerification': {
      try {
        await reloadUser();
        const user = (await import('./firebase-config.js')).auth.currentUser;
        if (user?.emailVerified) {
          showToast('✅ Email verificado');
          await DB.init(user.uid);
          navigate(window.location.hash || '#home');
        } else {
          showToast('Aún no verificado. Revisa tu bandeja de entrada.');
        }
      } catch(e) { showToast('Error: ' + e.message); }
      break;
    }
    case 'resendVerification': {
      try {
        await resendVerification();
        showToast('✉️ Email reenviado');
      } catch(e) { showToast(authErrorMessage(e.code)); }
      break;
    }
    case 'logout': {
      if (confirm('¿Cerrar sesión?')) { await logout(); }
      break;
    }
    case 'closeModal': { closeModal(); break; }
    case 'back': { window.history.back(); break; }
  }
}

async function savePhoto(potId, blob, type = 'plant') {
  const configured = await isConfigured();
  const photo = await DB.addPhoto({ potId: Number(potId), type, blob, createdAt: new Date().toISOString() });
  clearPhotoCache();
  await navigate(`#pot/${potId}`);
  if (configured && type === 'analyzer') {
    showToast('Leyendo analizador...');
    setTimeout(() => runAnalysis(photo.id, blob), 500);
  } else {
    showToast('Foto de planta guardada ✓');
  }
}

// Save a photo without navigating (used when saving multiple)
async function savePhotoQuiet(potId, blob, type = 'plant') {
  return DB.addPhoto({ potId: Number(potId), type, blob, createdAt: new Date().toISOString() });
}

// Loop: capture → save → ask "¿Otra?"
async function captureMultiplePhotos(potId, photoType) {
  let count = 0;
  while (true) {
    try {
      showToast('Abriendo cámara...');
      const blob = await captureFromCamera();
      await savePhotoQuiet(potId, blob, photoType);
      count++;
      clearPhotoCache();

      // Show "take another?" overlay
      const takeAnother = await new Promise(resolve => {
        const el = document.createElement('div');
        el.style.cssText = `position:fixed;bottom:calc(var(--nav-height,72px) + 8px);left:12px;right:12px;z-index:500;
          background:var(--bg-card);border:1px solid var(--border-glass);border-radius:16px;
          padding:16px;display:flex;flex-direction:column;gap:10px;
          box-shadow:0 8px 24px rgba(0,0,0,0.3);backdrop-filter:blur(12px);`;
        el.innerHTML = `
          <div style="font-weight:600;font-size:0.95rem;color:var(--text-primary)">
            📸 ${count} foto${count > 1 ? 's' : ''} guardada${count > 1 ? 's' : ''}
          </div>
          <div style="display:flex;gap:8px">
            <button id="_cam-more" class="btn btn-primary" style="flex:1">📸 Tomar otra</button>
            <button id="_cam-done" class="btn btn-secondary" style="flex:1">✅ Listo</button>
          </div>`;
        document.body.appendChild(el);
        el.querySelector('#_cam-more').onclick = () => { el.remove(); resolve(true); };
        el.querySelector('#_cam-done').onclick = () => { el.remove(); resolve(false); };
      });

      if (!takeAnother) break;
    } catch(e) {
      if (e.message !== 'No se tomó ninguna foto') showToast('Error: ' + e.message);
      break;
    }
  }
  if (count > 0) {
    await navigate(`#pot/${potId}`);
    showToast(`✅ ${count} foto${count > 1 ? 's' : ''} guardada${count > 1 ? 's' : ''}`);
  }
}

async function runAnalysis(photoId, originalBlob = null) {
  const photo = await DB.getPhoto(photoId);
  if (!photo) { showToast('Error: foto no encontrada', 4000); return; }
  const blobForAI = originalBlob || photo.imageData || photo.blob;
  if (!blobForAI) { showToast('Error: imagen no disponible', 4000); return; }

  const btn = document.getElementById('analyze-btn');
  const hasBtn = !!btn;
  const spinner = '<div class="spinner" style="width:16px;height:16px;border:2px solid var(--border-glass);border-top-color:var(--bg-primary);border-radius:50%;animation:spin 0.8s linear infinite;display:inline-block"></div>';
  const setBtn = (html) => { if (btn) { btn.disabled = true; btn.innerHTML = html; } };

  // Always show immediate toast feedback (critical for re-analyze where btn is hidden)
  showToast('⏳ Analizando con IA...', 60000);
  setBtn(`${spinner} Analizando...`);

  const onCountdown = (secs) => {
    showToast(`⏳ Reintentando en ${secs}s...`, 1500);
    setBtn(`⏳ Reintentando en ${secs}s...`);
  };

  try {
    let result;
    if (photo.type === 'analyzer') {
      result = await readAnalyzer(blobForAI, onCountdown);
    } else {
      const photos = await DB.getPhotosByPot(photo.potId);
      const photoDate = new Date(photo.createdAt).toISOString().slice(0,10);
      let soilData = null;
      for (const p of photos) {
        if (p.type==='analyzer' && new Date(p.createdAt).toISOString().slice(0,10)===photoDate) {
          const sa = await DB.getAnalysisByPhoto(p.id);
          if (sa?.result) { soilData = sa.result; break; }
        }
      }
      result = await analyzePlant(blobForAI, soilData, onCountdown);
    }
    await DB.addAnalysis({ photoId: photo.id, potId: photo.potId, type: photo.type, result, createdAt: new Date().toISOString() });
    if (photo.type === 'plant' && result.plantType) {
      const pot = await DB.getPot(photo.potId);
      if (pot) {
        const types = pot.plantTypes || (pot.plantType ? [pot.plantType] : []);
        const newName = result.plantType.split('(')[0].trim();
        if (newName && !types.some(t => t.toLowerCase() === newName.toLowerCase())) {
          pot.plantTypes = [...types, newName];
          delete pot.plantType;
          await DB.updatePot(pot);
        }
      }
    }
    showToast('✅ Análisis completado');
    if (window.location.hash.includes(`photo/${photoId}`)) {
      mainEl().innerHTML = await renderPhotoDetail(photoId);
      initPhotoZoom();
    } else if (window.location.hash === `#pot/${photo.potId}`) {
      mainEl().innerHTML = await renderPot(photo.potId);
    }
  } catch (err) {
    console.error('[runAnalysis] error:', err);
    const m = err.message || '';
    let msg;
    if (m === 'API_KEY_MISSING') {
      msg = '⚠️ No hay API Key configurada. Ve a Ajustes → IA.';
    } else if (m.toLowerCase().includes('api key') || m.toLowerCase().includes('authentication') || m.toLowerCase().includes('invalid key')) {
      msg = '❌ API Key de Groq inválida. Ve a Ajustes → IA y verifica tu clave.';
    } else {
      msg = '❌ ' + m;
    }
    showToast(msg, 9000);
    if (btn) { btn.disabled = false; btn.innerHTML = `✨ Analizar ${photo.type==='analyzer'?'Medidor':'Planta'}`; }
  }
}

function setupPotForm() {
  const form = document.getElementById('pot-form');
  if (!form) return;
  document.querySelectorAll('.emoji-pick').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.emoji-pick').forEach(b => { b.style.borderColor='var(--border-glass)'; b.style.background='var(--bg-secondary)'; });
      btn.style.borderColor='var(--accent)'; btn.style.background='var(--accent-glow)';
      document.getElementById('pot-emoji').value = btn.dataset.emoji;
    });
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('pot-name').value.trim();
    const description = document.getElementById('pot-desc').value.trim();
    const emoji = document.getElementById('pot-emoji').value;
    const potId = form.dataset.potId;
    if (!name) { showToast('Ingresa un nombre'); return; }
    if (potId) { const pot = await DB.getPot(Number(potId)); await DB.updatePot({...pot, name, description, emoji}); showToast('Maceta actualizada ✓'); }
    else { await DB.createPot({name, description, emoji}); showToast('Maceta creada ✓'); }
    closeModal(); clearPhotoCache(); navigate(window.location.hash || '#home');
  });
}

function setupEditPhotoForm() {
  const form = document.getElementById('edit-photo-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const photoId = Number(form.dataset.photoId);
    const analysisId = form.dataset.analysisId;
    const photo = await DB.getPhoto(photoId);
    if (!photo) return;
    // Update date
    const newDate = document.getElementById('edit-date').value;
    if (newDate) {
      const oldDate = new Date(photo.createdAt);
      const nd = new Date(newDate);
      nd.setHours(oldDate.getHours(), oldDate.getMinutes(), oldDate.getSeconds());
      photo.createdAt = nd.toISOString();
    }
    // Update user notes
    photo.userNotes = document.getElementById('edit-user-notes').value;
    await DB.updatePhoto(photo);
    // Update analysis if edited
    const analysisTextarea = document.getElementById('edit-analysis');
    if (analysisTextarea && analysisId) {
      try {
        const newResult = JSON.parse(analysisTextarea.value);
        const analysis = await DB.getAnalysisByPhoto(photoId);
        if (analysis) { analysis.result = newResult; await DB.updateAnalysis(analysis); }
      } catch(err) { showToast('JSON de análisis inválido'); return; }
    }
    closeModal(); clearPhotoCache(); showToast('Cambios guardados ✓');
    if (currentRoute === 'photo') {
      mainEl().innerHTML = await renderPhotoDetail(photoId);
      initPhotoZoom();
    } else {
      mainEl().innerHTML = await renderPot(photo.potId);
    }
  });
}

function setupProductModalForm() {
  document.querySelectorAll('#product-modal-form .emoji-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#product-modal-form .emoji-pick').forEach(b => { b.style.borderColor='var(--border-glass)'; b.style.background='var(--bg-secondary)'; });
      btn.style.borderColor='var(--accent)'; btn.style.background='var(--accent-glow)';
      document.getElementById('product-modal-icon').value = btn.dataset.emoji;
    });
  });
  document.getElementById('product-modal-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const slug = e.target.dataset.slug;
    const name = document.getElementById('product-modal-name').value.trim();
    const icon = document.getElementById('product-modal-icon').value;
    const freq = parseInt(document.getElementById('product-modal-freq').value) || 7;
    const notes = document.getElementById('product-modal-notes').value;
    if (!name) { showToast('Ingresa un nombre'); return; }
    if (slug) {
      const product = await DB.getProduct(slug);
      await DB.updateProduct({ ...product, name, icon, defaultFrequencyDays: freq, notes });
      showToast('Producto guardado ✓');
    } else {
      await DB.createProduct({ name, icon, defaultFrequencyDays: freq, notes });
      showToast('Producto creado ✓');
    }
    closeModal();
    if (currentRoute === 'products') mainEl().innerHTML = await renderProducts();
    else if (currentRoute === 'product') navigate(window.location.hash);
  });
}

function setupProductDetailForm() {
  document.querySelectorAll('#product-detail-form .emoji-pick-detail').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#product-detail-form .emoji-pick-detail').forEach(b => { b.style.borderColor='var(--border-glass)'; b.style.background='var(--bg-secondary)'; });
      btn.style.borderColor='var(--accent)'; btn.style.background='var(--accent-glow)';
      document.getElementById('product-detail-icon').value = btn.dataset.emoji;
    });
  });
  document.getElementById('product-detail-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const slug = e.target.dataset.slug;
    const name = document.getElementById('product-detail-name').value.trim();
    const icon = document.getElementById('product-detail-icon').value;
    const freq = parseInt(document.getElementById('product-detail-freq').value) || 7;
    const notes = document.getElementById('product-detail-notes').value;
    if (!name) { showToast('Ingresa un nombre'); return; }
    const product = await DB.getProduct(slug);
    await DB.updateProduct({ ...product, name, icon, defaultFrequencyDays: freq, notes });
    showToast('Producto guardado ✓');
    navigate('#products');
  });
}

function setupScheduleForm() {
  const form = document.getElementById('schedule-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const potId = Number(form.dataset.potId);
    const pot = await DB.getPot(potId);
    if (!pot) return;
    const overrides = {};
    form.querySelectorAll('.schedule-input').forEach(input => {
      const v = parseInt(input.value);
      if (v > 0) overrides[input.dataset.slug] = v;
    });
    pot.scheduleOverrides = overrides;
    await DB.updatePot(pot);
    closeModal(); showToast('Cronograma guardado ✓');
  });
}

function setupProductDateCalendar() {
  const wrapper = document.querySelector('.calendar-wrapper');
  if (!wrapper) return;

  wrapper.querySelectorAll('[data-action="selectCalendarDay"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const selectedDate = btn.dataset.date;
      const selectedInput = document.getElementById('selected-date');
      if (selectedInput) selectedInput.value = selectedDate;
      wrapper.querySelectorAll('[data-action="selectCalendarDay"]').forEach(b => {
        if (b.dataset.date === selectedDate) {
          b.style.backgroundColor = 'var(--accent)';
          b.style.color = '#fff';
          b.style.fontWeight = '600';
        } else {
          b.style.backgroundColor = 'transparent';
          b.style.color = 'var(--text-primary)';
          b.style.fontWeight = '400';
        }
      });
    });
  });

  wrapper.querySelectorAll('[data-action="calendarPrevMonth"], [data-action="calendarNextMonth"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      await handleAction(btn.dataset.action, btn);
      setupProductDateCalendar();
    });
  });
}

async function importData(jsonText) {
  let data;
  try { data = JSON.parse(jsonText); } catch { showToast('Archivo inválido'); return; }
  if (!data.pots || !Array.isArray(data.pots)) { showToast('Formato incorrecto'); return; }

  showToast('Importando datos...', 60000);
  let potsOk = 0, photosOk = 0;

  for (const potData of data.pots) {
    const { photos, ...potFields } = potData;
    // Create pot without old id so DB generates a new one
    delete potFields.id;
    const newPot = await DB.createPot(potFields);
    potsOk++;

    for (const photoData of (photos || [])) {
      try {
        // Convert base64 data URL back to Blob
        const resp = await fetch(photoData.imageDataUrl);
        const blob = await resp.blob();
        const newPhoto = await DB.addPhoto({
          potId: newPot.id,
          type: photoData.type || 'plant',
          blob,
          createdAt: photoData.createdAt || new Date().toISOString(),
          userNotes: photoData.userNotes || ''
        });
        photosOk++;
        if (photoData.analysis) {
          await DB.addAnalysis({
            photoId: newPhoto.id,
            potId: newPot.id,
            type: newPhoto.type,
            result: photoData.analysis,
            createdAt: newPhoto.createdAt
          });
        }
      } catch(e) { console.warn('Error importando foto:', e); }
    }
  }

  clearPhotoCache();
  showToast(`✅ Importado: ${potsOk} maceta${potsOk!==1?'s':''}, ${photosOk} foto${photosOk!==1?'s':''}`);
  navigate('#home');
}

async function exportAllData() {
  try {
    const pots = await DB.getAllPots();
    const exportData = { pots: [], exportDate: new Date().toISOString() };
    for (const pot of pots) {
      const photos = await DB.getPhotosByPot(pot.id);
      const potData = { ...pot, photos: [] };
      for (const photo of photos) {
        const analysis = await DB.getAnalysisByPhoto(photo.id);
        const url = await getPhotoURL(photo);
        potData.photos.push({ type: photo.type, createdAt: photo.createdAt, userNotes: photo.userNotes, imageDataUrl: url, analysis: analysis?.result || null });
      }
      exportData.pots.push(potData);
    }
    const blob = new Blob([JSON.stringify(exportData,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`gardenai-export-${new Date().toISOString().slice(0,10)}.json`; a.click();
    URL.revokeObjectURL(url); showToast('Datos exportados ✓');
  } catch(e) { showToast('Error: '+e.message); }
}

// ===== TASK POT SELECTION =====

function getAllTaskPotIds() {
  return [...document.querySelectorAll('[data-toggle-select="task"]')].map(el => el.dataset.potId);
}

function updateTaskSelectAllBtn() {
  const btn = document.getElementById('pot-select-task-btn');
  if (!btn) return;
  const allIds = getAllTaskPotIds();
  const allSelected = taskSelectMode && allIds.length > 0 && allIds.every(id => selectedPotsTask.has(id));
  const svgOutlined = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#16a34a" stroke-width="2"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const svgFilled  = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#16a34a"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  btn.innerHTML = taskSelectMode ? svgFilled : svgOutlined;
  btn.classList.toggle('select-mode-active', taskSelectMode && !allSelected);
  btn.classList.toggle('select-all-active', allSelected);
}

function toggleTaskPotSelection(potId) {
  const id = String(potId);
  const card = document.querySelector(`[data-toggle-select="task"][data-pot-id="${id}"]`);
  const check = card?.querySelector('.pot-select-check');
  if (selectedPotsTask.has(id)) {
    selectedPotsTask.delete(id);
    card?.classList.remove('pot-selected');
    if (check) check.classList.remove('checked');
  } else {
    selectedPotsTask.add(id);
    card?.classList.add('pot-selected');
    if (check) check.classList.add('checked');
  }
  if (selectedPotsTask.size > 0) updateTaskBulkBar();
  else document.getElementById('task-bulk-bar')?.remove();
  updateTaskSelectAllBtn();
}

function clearTaskPotSelection() {
  selectedPotsTask.clear();
  document.querySelectorAll('[data-toggle-select="task"].pot-selected').forEach(el => {
    el.classList.remove('pot-selected');
    el.querySelector('.pot-select-check')?.classList.remove('checked');
  });
  document.getElementById('task-bulk-bar')?.remove();
  updateTaskSelectAllBtn();
}

function updateTaskBulkBar() {
  let bar = document.getElementById('task-bulk-bar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'task-bulk-bar'; bar.className = 'bulk-action-bar'; document.body.appendChild(bar); }
  const n = selectedPotsTask.size;
  bar.innerHTML = `
    <div class="bulk-count">${n} maceta${n!==1?'s':''} seleccionada${n!==1?'s':''}</div>
    <div class="bulk-actions">
      <button class="bulk-btn" data-action="bulkRecommendProduct">⭐ Recomendar</button>
      <button class="bulk-btn bulk-btn-execute" data-action="bulkExecuteProduct">⚡ Ejecutar</button>
      <button class="bulk-btn bulk-btn-cancel" data-action="clearTaskSelection">✕ Cancelar</button>
    </div>`;
}

function getAllHomePotIds() {
  return [...document.querySelectorAll('.pot-card[data-navigate^="pot/"]')]
    .map(el => el.dataset.navigate.split('/')[1])
    .filter(Boolean);
}

// ===== POT REORDER MODE =====
function updateReorderBtn(active) {
  const btn = document.getElementById('pot-reorder-btn');
  if (!btn) return;
  if (active) {
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="rgba(22,163,74,0.2)" stroke="#16a34a" stroke-width="2"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    btn.style.background = 'rgba(22,163,74,0.15)';
    btn.style.borderColor = '#16a34a';
    btn.title = 'Guardar orden';
  } else {
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#16a34a" stroke-width="2"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    btn.style.background = '';
    btn.style.borderColor = '';
    btn.title = 'Reordenar macetas';
  }
}

function onTwoFingerTouchStart(e) {
  if (e.touches.length < 2) return;
  // Cancel any active drag
  if (_drag) onDragPointerUp();
  // Temporarily allow scroll with 2 fingers
  const grid = document.getElementById('pots-grid');
  if (!grid) return;
  grid.style.touchAction = 'pan-y';
  const restore = () => {
    grid.style.touchAction = '';
    document.removeEventListener('touchend', restore);
    document.removeEventListener('touchcancel', restore);
  };
  document.addEventListener('touchend', restore, { once: true });
  document.addEventListener('touchcancel', restore, { once: true });
}

function startReorderMode() {
  reorderMode = true;
  const grid = document.getElementById('pots-grid');
  if (!grid) return;
  grid.classList.add('reorder-mode');
  reorderPotIds = [...grid.querySelectorAll('.pot-card[data-pot-id]')].map(el => el.dataset.potId);
  updateReorderBtn(true);
  grid.addEventListener('pointerdown', onDragPointerDown);
  grid.addEventListener('touchstart', onTwoFingerTouchStart, { passive: true });
  showToast('Arrastra • 2 dedos para scroll • ✅ para guardar');
}

async function saveReorderMode() {
  cancelReorderMode();
  if (reorderPotIds.length > 0) {
    try {
      await DB.savePotOrder(reorderPotIds);
      showToast('✅ Orden guardado');
    } catch(e) { showToast('Error al guardar orden'); }
  }
}

function cancelReorderMode() {
  if (!reorderMode) return;
  reorderMode = false;
  reorderPotIds = [];
  if (_drag) { _drag.clone?.remove(); if (_drag.card) _drag.card.style.opacity = ''; _drag = null; }
  const grid = document.getElementById('pots-grid');
  if (grid) {
    grid.classList.remove('reorder-mode');
    grid.style.touchAction = '';
    grid.removeEventListener('pointerdown', onDragPointerDown);
    grid.removeEventListener('touchstart', onTwoFingerTouchStart);
  }
  updateReorderBtn(false);
}

function onDragPointerDown(e) {
  if (!reorderMode) return;
  // Two-finger = scroll, not drag
  if (e.isPrimary === false) { if (_drag) onDragPointerUp(e); return; }
  const card = e.target.closest('.pot-card[data-pot-id]');
  if (!card || card.classList.contains('pot-card-add')) return;
  e.preventDefault();

  const rect = card.getBoundingClientRect();
  const clone = card.cloneNode(true);
  Object.assign(clone.style, {
    position: 'fixed', top: rect.top + 'px', left: rect.left + 'px',
    width: rect.width + 'px', height: rect.height + 'px',
    pointerEvents: 'none', zIndex: '9999', opacity: '0.92',
    transform: 'scale(1.05) rotate(1.5deg)',
    boxShadow: '0 12px 32px rgba(0,0,0,0.35)', transition: 'none',
    margin: '0'
  });
  document.body.appendChild(clone);
  card.style.opacity = '0.25';
  card.classList.add('dragging');

  _drag = { card, clone, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };

  document.addEventListener('pointermove', onDragPointerMove, { passive: false });
  document.addEventListener('pointerup', onDragPointerUp);
  document.addEventListener('pointercancel', onDragPointerUp);
}

function onDragPointerMove(e) {
  if (!_drag) return;
  e.preventDefault();
  const { clone, offsetX, offsetY, card } = _drag;
  clone.style.left = (e.clientX - offsetX) + 'px';
  clone.style.top  = (e.clientY - offsetY) + 'px';

  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pot-card[data-pot-id]');
  if (target && target !== card && !target.classList.contains('pot-card-add')) {
    const grid = document.getElementById('pots-grid');
    const cards = [...grid.querySelectorAll('.pot-card[data-pot-id]')];
    const fromIdx = cards.indexOf(card);
    const toIdx   = cards.indexOf(target);
    if (fromIdx !== -1 && toIdx !== -1) {
      grid.insertBefore(card, fromIdx < toIdx ? target.nextSibling : target);
      reorderPotIds = [...grid.querySelectorAll('.pot-card[data-pot-id]')].map(el => el.dataset.potId);
    }
  }
}

function onDragPointerUp() {
  if (!_drag) return;
  _drag.clone.remove();
  _drag.card.style.opacity = '';
  _drag.card.classList.remove('dragging');
  document.removeEventListener('pointermove', onDragPointerMove);
  document.removeEventListener('pointerup', onDragPointerUp);
  document.removeEventListener('pointercancel', onDragPointerUp);
  _drag = null;
}

function clearPotSelection() {
  closeModal();
}

// ===== PHOTO ZOOM (fullscreen overlay) =====
function initPhotoZoom() {
  const img = document.querySelector('.photo-detail-img');
  if (!img) return;

  img.style.cursor = 'zoom-in';
  img.addEventListener('click', () => openPhotoFullscreen(img.src));
}

function openPhotoFullscreen(src) {
  const overlay = document.createElement('div');
  overlay.className = 'photo-fullscreen';

  const imgEl = document.createElement('img');
  imgEl.src = src;
  imgEl.className = 'photo-fullscreen-img';
  overlay.appendChild(imgEl);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'photo-fullscreen-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => overlay.remove());
  overlay.appendChild(closeBtn);

  document.body.appendChild(overlay);

  // Zoom/pan state
  let scale = 1, tx = 0, ty = 0;
  let startScale = 1, startTx = 0, startTy = 0, startDist = 0;
  let isPanning = false, panStartX = 0, panStartY = 0;
  let lastTap = 0;

  function touchDist(t) {
    const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx*dx + dy*dy);
  }

  function apply(s, x, y) {
    scale = Math.min(5, Math.max(1, s));
    if (scale <= 1) { tx = 0; ty = 0; }
    else {
      const maxX = (overlay.clientWidth * (scale - 1)) / 2;
      const maxY = (overlay.clientHeight * (scale - 1)) / 2;
      tx = Math.max(-maxX, Math.min(maxX, x));
      ty = Math.max(-maxY, Math.min(maxY, y));
    }
    imgEl.style.transform = `scale(${scale}) translate(${tx/scale}px, ${ty/scale}px)`;
  }

  overlay.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      startDist = touchDist(e.touches);
      startScale = scale; startTx = tx; startTy = ty;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTap < 280) {
        apply(scale > 1 ? 1 : 2.5, 0, 0);
        lastTap = 0;
      } else {
        lastTap = now;
        if (scale > 1) {
          isPanning = true;
          panStartX = e.touches[0].clientX - tx;
          panStartY = e.touches[0].clientY - ty;
        }
      }
    }
  }, { passive: false });

  overlay.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 2) {
      apply(startScale * touchDist(e.touches) / startDist, startTx, startTy);
    } else if (e.touches.length === 1 && isPanning) {
      apply(scale, e.touches[0].clientX - panStartX, e.touches[0].clientY - panStartY);
    }
  }, { passive: false });

  overlay.addEventListener('touchend', () => { isPanning = false; });

  overlay.addEventListener('wheel', (e) => {
    e.preventDefault();
    apply(scale * (e.deltaY > 0 ? 0.85 : 1.18), tx, ty);
  }, { passive: false });

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === closeBtn) return;
    if (scale > 1) { isPanning = true; panStartX = e.clientX - tx; panStartY = e.clientY - ty; }
  });
  window.addEventListener('mousemove', (e) => { if (isPanning) apply(scale, e.clientX - panStartX, e.clientY - panStartY); });
  window.addEventListener('mouseup', () => { isPanning = false; });
}

function setupEmailLoginForm() {
  document.getElementById('email-login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Entrando...';
    try {
      await loginWithEmail(email, password);
    } catch(err) {
      showToast(authErrorMessage(err.code));
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  });
}

function setupRegisterForm() {
  document.getElementById('register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirm = document.getElementById('reg-confirm').value;
    if (password !== confirm) { showToast('Las contraseñas no coinciden'); return; }
    if (password.length < 6) { showToast('La contraseña debe tener al menos 6 caracteres'); return; }
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Creando cuenta...';
    try {
      const user = await registerWithEmail(email, password, name);
      DB.registerUserProfile(user);
    } catch(err) {
      showToast(authErrorMessage(err.code));
      btn.disabled = false; btn.textContent = 'Crear cuenta';
    }
  });
}

// ===== GLOBAL EVENT DELEGATION =====
document.addEventListener('click', (e) => {

  const ts = e.target.closest('[data-toggle-select="task"]');
  if (ts && !e.target.closest('[data-action]')) {
    e.preventDefault();
    const potId = ts.dataset.potId;
    if (!potId) return;
    if (taskSelectMode) {
      toggleTaskPotSelection(potId);
    } else {
      navigate(`#pot/${potId}`);
    }
    return;
  }

  const at = e.target.closest('[data-action]');
  if (at) {
    if (at.dataset.action === 'closeModal' && e.target !== at) return;
    if (photoSelectMode && at.dataset.action === 'viewPhoto') {
      e.preventDefault();
      const pid = at.dataset.photoId;
      if (pid) togglePhotoSelection(pid);
      return;
    }
    e.preventDefault();
    handleAction(at.dataset.action, at);
    return;
  }
  const nt = e.target.closest('[data-navigate]');
  if (nt) {
    e.preventDefault();
    const nav = nt.dataset.navigate;
    if (reorderMode && nav.startsWith('pot/') && !nav.includes('/photo/')) return;
    showLoading();
    navigate('#' + nav);
    return;
  }
  const ni = e.target.closest('[data-nav]');
  if (ni) {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    ni.classList.add('active');
    showLoading();
    navigate('#' + ni.dataset.nav);
  }
});

// ===== DYNAMIC UI EVENTS =====
document.addEventListener('change', (e) => {
  if (e.target.id === 'ai-provider') {
    const val = e.target.value;
    const gSet = document.getElementById('gemini-settings');
    const rqSet = document.getElementById('groq-settings');
    if (gSet) gSet.style.display = val === 'gemini' ? 'block' : 'none';
    if (rqSet) rqSet.style.display = val === 'groq' ? 'block' : 'none';
  }
  if (e.target.id === 'import-file-input') {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm(`¿Importar "${file.name}"? Se agregarán las macetas y fotos a tu cuenta actual.`)) return;
    const reader = new FileReader();
    reader.onload = (ev) => importData(ev.target.result);
    reader.readAsText(file);
  }
});

// ===== LONG PRESS → REORDER MODE =====
(function setupLongPress() {
  let _lp = null; // { timer, card }

  function cancelLP() {
    if (_lp) { clearTimeout(_lp.timer); _lp = null; }
  }

  document.addEventListener('pointerdown', (e) => {
    if (reorderMode) return;
    const card = e.target.closest('.pot-card[data-pot-id]:not(.pot-card-add)');
    if (!card || currentRoute !== 'home') return;
    cancelLP();
    _lp = {
      card,
      timer: setTimeout(() => {
        _lp = null;
        // Haptic feedback (iOS)
        if (navigator.vibrate) navigator.vibrate(30);
        closeModal();
        startReorderMode();
      }, 500)
    };
  });

  document.addEventListener('pointermove', (e) => {
    if (!_lp) return;
    const dx = e.movementX ?? 0, dy = e.movementY ?? 0;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) cancelLP();
  });

  document.addEventListener('pointerup',     cancelLP);
  document.addEventListener('pointercancel', cancelLP);
})();

// ===== INIT =====
window.addEventListener('hashchange', () => navigate(window.location.hash));
window.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
      // When a new SW activates, show a toast — do NOT force-reload mid-session
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type === 'SW_UPDATED') {
          console.log('[SW] New version available:', e.data?.version);
          showToast('🌿 Nueva versión disponible — cerrá y volvé a abrir para actualizar', 6000);
        }
      });
    } catch(e) {}
  }

  // Complete any pending Google redirect sign-in (iOS PWA flow)
  await handlePendingRedirect();

  let lastUserId = null;
  onAuthChange(async (user) => {
    const userId = user?.uid || null;

    // Ignore token refresh events — only react to actual user changes
    if (userId === lastUserId) return;
    lastUserId = userId;

    clearPhotoCache();
    if (user) {
      // Apply theme from localStorage immediately — no flash
      const cachedTheme = localStorage.getItem('gardenai-theme') || 'dark';
      applyTheme(cachedTheme);

      // Only await DB.init (sets uid) — everything else runs in background
      await DB.init(user.uid);
      DB.registerUserProfile(user);
      navigate(window.location.hash || '#home');

      // Confirm theme from Firestore in background — updates if different
      DB.getSetting('theme').then(savedTheme => {
        const theme = savedTheme || 'dark';
        localStorage.setItem('gardenai-theme', theme);
        if (theme !== cachedTheme) applyTheme(theme);
      });

      // Migration in background — never blocks initial render
      runMigration().then(migrated => {
        if (migrated) showToast('🚀 ¡Datos locales migrados a la nube!', 5000);
      });
    } else {
      currentRoute = '';
      mainEl().innerHTML = renderLogin();
    }
  });
});
