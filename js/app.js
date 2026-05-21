// js/app.js — Main router and logic for GardenAI v2

import DB from './db.js';
import {
  onAuthChange, loginWithGoogle, logout,
  registerWithEmail, loginWithEmail, resendVerification,
  resetPassword, reloadUser, authErrorMessage,
  handlePendingRedirect
} from './firebase-config.js';
import { captureFromCamera, uploadFromGallery, blobToDataURL } from './camera.js';
import { analyzePlant, readAnalyzer, detectPhotoType, isConfigured, aiRetryAt } from './ai.js';
import {
  renderHome, renderPot, renderPhotoDetail, renderSettings, renderTasks,
  renderProducts, renderProductDetail, renderPotModal, renderPhotoModal, renderPhotoSourceModal, renderNotesModal, renderEditNoteModal, renderEditAnalysisModal, renderEditDayModal,
  renderEditPhotoModal, renderPotScheduleModal, renderLogin, renderStats,
  renderBulkDateModal, renderBulkNotesModal,
  renderProductModal, renderBulkPotTaskModal, renderBulkApplyProductModal, renderBulkPotNoteModal, renderProductMenu, renderProductDateModal,
  renderEmailLogin, renderRegister, renderVerifyEmail,
  showToast, clearPhotoCache, getPhotoURL, escapeHtml, toInputDate, mapIssuesToProducts,
  renderAnalysisActionsModal
} from './ui.js';
import { runMigration } from './migration.js';

const mainEl = () => document.getElementById('main-content');

function applyTheme(theme) {
  const validThemes = ['botanical', 'tropical'];
  document.documentElement.setAttribute('data-theme', validThemes.includes(theme) ? theme : '');
}
const modalsEl = () => document.getElementById('modals');
let currentRoute = '';
let selectedPhotos = new Set();
let photoSelectMode = false;
let potSelectMode = false;
let selectedPotsTask = new Set();
let taskSelectMode = false;
let taskFilter = 'all';

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
  potSelectMode = false;

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
    headerHtml = '<button class="header-back" data-action="back">←</button> 🧴 Productos';
    html = await renderProducts();
  } else if (hash.startsWith('#product/')) {
    newRoute = 'product';
    const slug = hash.split('/')[1];
    const prod = await DB.getProduct(slug);
    headerHtml = `<button class="header-back" data-action="back">←</button> ${escapeHtml(prod?.icon||'🧴')} ${escapeHtml(prod?.name||'Producto')}`;
    html = await renderProductDetail(slug);
  } else if (hash.startsWith('#pot/')) {
    const parts = hash.split('/');
    if (parts.length > 2 && parts[2] === 'photo') {
      newRoute = 'photo';
      headerHtml = '<button class="header-back" data-action="back">←</button> Foto';
      html = await renderPhotoDetail(parts[3]);
    } else {
      newRoute = 'pot';
      const [pot, potHtml] = await Promise.all([
        DB.getPot(Number(parts[1])),
        renderPot(parts[1])
      ]);
      headerHtml = `<button class="header-back" data-action="back">←</button> ${escapeHtml(pot?.emoji||'🪴')} ${escapeHtml(pot?.name||'Maceta')}`;
      html = potHtml;
    }
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
      </div>`;
    html = await renderSettings();
  }

  // If a newer navigation started while we were loading, abort — don't update DOM
  if (stale()) { _navigating = false; return; }

  currentRoute = newRoute;
  if (headerHtml) {
    document.getElementById('header-title').innerHTML = headerHtml;
  } else {
    document.getElementById('header-title').innerHTML = '';
  }
  mainEl().innerHTML = html;
  if (hash.startsWith('#pot/') && hash.includes('/photo/')) initPhotoZoom();
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
      (t==='stats' && currentRoute==='stats')
    );
  });
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
    case 'enterPotSelectMode': {
      if (!potSelectMode) {
        // Enter select mode
        potSelectMode = true;
        document.getElementById('pots-grid')?.classList.add('select-mode');
        updatePotBulkBar();
        updatePotSelectAllBtn();
        showToast('Toca macetas para seleccionar');
      } else {
        // Already in mode — same button now exits
        clearPotSelection();
        showToast('Selección cancelada');
      }
      break;
    }
    case 'potSelectAll': {
      const allIds = getAllHomePotIds();
      for (const id of allIds) {
        if (!selectedPots.has(id)) {
          selectedPots.add(id);
          const card = document.getElementById(`pot-card-${id}`);
          card?.classList.add('pot-selected');
          card?.querySelector('.pot-select-check')?.classList.add('checked');
        }
      }
      updatePotBulkBar();
      updatePotSelectAllBtn();
      showToast(`✅ ${allIds.length} maceta${allIds.length !== 1 ? 's' : ''} seleccionada${allIds.length !== 1 ? 's' : ''}`);
      break;
    }
    case 'potSelectNone': {
      selectedPots.clear();
      document.querySelectorAll('.pot-card.pot-selected').forEach(el => {
        el.classList.remove('pot-selected');
        el.querySelector('.pot-select-check')?.classList.remove('checked');
      });
      updatePotBulkBar();
      updatePotSelectAllBtn();
      showToast('Selección eliminada');
      break;
    }
    case 'enterPotSelectModeTask': {
      if (!taskSelectMode) {
        // First click: enter selection mode
        taskSelectMode = true;
        showToast('Toca macetas para seleccionar');
        updateTaskSelectAllBtn();
      } else {
        // Already in select mode: toggle select-all / deselect-all
        const allIds = getAllTaskPotIds();
        const allSelected = allIds.length > 0 && allIds.every(id => selectedPotsTask.has(id));
        if (allSelected) {
          // Deselect all (stay in select mode)
          selectedPotsTask.clear();
          document.querySelectorAll('[data-toggle-select="task"].pot-selected').forEach(el => {
            el.classList.remove('pot-selected');
            el.querySelector('.pot-select-check')?.classList.remove('checked');
          });
          document.getElementById('task-bulk-bar')?.remove();
          showToast('Selección eliminada');
        } else {
          // Select all visible pots
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
      try {
        showToast('Abriendo cámara...');
        const blob = await captureFromCamera();
        closeModal();
        await savePhoto(potId, blob, photoType);
      } catch(e) {
        closeModal();
        if (e.message !== 'No se tomó ninguna foto') showToast('Error: ' + e.message);
      }
      break;
    }
    case 'uploadPhoto': {
      const potId = target.dataset.potId;
      const photoType = target.dataset.photoType || 'plant';
      try {
        const blob = await uploadFromGallery();
        closeModal();
        await savePhoto(potId, blob, photoType);
      } catch(e) {
        closeModal();
        if (e.message !== 'No se seleccionó ninguna foto') showToast('Error: ' + e.message);
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
    case 'togglePotSelect': {
      const potId = target.dataset.potId;
      if (potId) togglePotSelection(potId);
      break;
    }
    case 'clearPhotoSelection': { clearPhotoSelection(); break; }
    case 'clearPotSelection': { clearPotSelection(); break; }
    case 'bulkPotTask': {
      const products = await DB.getAllProducts();
      products.sort((a,b) => a.name.localeCompare(b.name));
      modalsEl().innerHTML = renderBulkPotTaskModal(products, selectedPots.size);
      break;
    }
    case 'confirmBulkPotTask': {
      const slug = target.dataset.slug;
      const ids = [...selectedPots];
      for (const potId of ids) await DB.addTaskLog({ potId: Number(potId), productSlug: slug });
      closeModal(); clearPotSelection();
      showToast(`✅ Aplicado a ${ids.length} maceta${ids.length!==1?'s':''}`);
      break;
    }
    case 'bulkPotNote': {
      closeModal();
      modalsEl().innerHTML = renderBulkPotNoteModal(selectedPots.size);
      break;
    }
    case 'confirmBulkPotNote': {
      const noteText = document.getElementById('bulk-pot-note-input')?.value || '';
      if (!noteText.trim()) { showToast('Escribe algo antes de guardar'); break; }
      const ids = [...selectedPots];
      const now = new Date().toISOString();
      for (const potId of ids) {
        await DB.addNote({ potId: Number(potId), text: noteText, createdAt: now });
      }
      closeModal(); clearPotSelection();
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
      const photoId = target.dataset.photoId;
      const switchType = target.dataset.switchType;
      const switchLabel = target.dataset.switchLabel;
      modalsEl().innerHTML = renderAnalysisActionsModal(photoId, switchType, switchLabel);
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
      const slug = target.dataset.slug;
      const product = await DB.getProduct(slug);
      product.defaultFrequencyDays = parseInt(document.getElementById('product-freq').value) || product.defaultFrequencyDays;
      product.notes = document.getElementById('product-notes').value;
      await DB.updateProduct(product);
      showToast('Producto guardado ✓');
      setTimeout(async () => { mainEl().innerHTML = await renderProductDetail(slug); }, 300);
      break;
    }
    case 'editProductModal': {
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
          const provider = document.getElementById('ai-provider')?.value || 'gemini';
          const inputKey = provider === 'gemini'
            ? document.getElementById('gemini-key-input')?.value?.trim()
            : document.getElementById('groq-key-input')?.value?.trim();
          const savedKey = await DB.getSetting(provider === 'gemini' ? 'geminiApiKey' : 'groqApiKey');
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
      const provider = document.getElementById('ai-provider').value;
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

      await DB.setSetting('aiProvider', provider);
      if (geminiKey) await DB.setSetting('geminiApiKey', geminiKey);
      if (groqKey) await DB.setSetting('groqApiKey', groqKey);

      showToast('Configuración guardada ✓');
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

async function runAnalysis(photoId, originalBlob = null) {
  const photo = await DB.getPhoto(photoId);
  if (!photo) return;
  const blobForAI = originalBlob || photo.imageData || photo.blob;
  const btn = document.getElementById('analyze-btn');
  const setBtn = (html) => { if (btn) { btn.disabled = true; btn.innerHTML = html; } };
  const spinner = '<div class="spinner" style="width:16px;height:16px;border:2px solid var(--border-glass);border-top-color:var(--bg-primary);border-radius:50%;animation:spin 0.8s linear infinite;display:inline-block"></div>';
  setBtn(`${spinner} Analizando...`);

  const onCountdown = (secs) => setBtn(`⏳ Límite alcanzado — reintentando en ${secs}s...`);

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
    showToast('Análisis completado ✓');
    if (window.location.hash.includes(`photo/${photoId}`)) {
      mainEl().innerHTML = await renderPhotoDetail(photoId);
      initPhotoZoom();
    } else if (window.location.hash === `#pot/${photo.potId}`) {
      mainEl().innerHTML = await renderPot(photo.potId);
    }
  } catch (err) {
    if (err.message==='API_KEY_MISSING') showToast('Configura tu API Key en Ajustes', 5000);
    else { showToast('Error: '+err.message, 8000); console.error(err); }
    if (btn) { btn.disabled=false; btn.innerHTML=`✨ Analizar ${photo.type==='analyzer'?'Medidor':'Planta'}`; }
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

// ===== POT SELECTION (HOME) =====
let selectedPots = new Set();

function togglePotSelection(potId) {
  const id = String(potId);
  const card = document.getElementById(`pot-card-${id}`);
  const check = card?.querySelector('.pot-select-check');
  if (selectedPots.has(id)) {
    selectedPots.delete(id); card?.classList.remove('pot-selected'); check?.classList.remove('checked');
  } else {
    selectedPots.add(id); card?.classList.add('pot-selected'); check?.classList.add('checked');
  }
  if (selectedPots.size > 0) updatePotBulkBar();
  else document.getElementById('pot-bulk-bar')?.remove();
  updatePotSelectAllBtn();
}

function getAllHomePotIds() {
  return [...document.querySelectorAll('.pot-card[data-navigate^="pot/"]')]
    .map(el => el.dataset.navigate.split('/')[1])
    .filter(Boolean);
}

function updatePotSelectAllBtn() {
  const btn = document.getElementById('pot-select-mode-btn');
  if (!btn) return;
  const svgOutlined = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#16a34a" stroke-width="2"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const svgCancel = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#dc2626"/><path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  btn.innerHTML = potSelectMode ? svgCancel : svgOutlined;
  btn.classList.toggle('select-mode-active', potSelectMode);
  btn.classList.remove('select-all-active');
}

function clearPotSelection() {
  potSelectMode = false;
  selectedPots.clear();
  document.querySelectorAll('.pot-card.pot-selected').forEach(el => {
    el.classList.remove('pot-selected');
    el.querySelector('.pot-select-check')?.classList.remove('checked');
  });
  document.getElementById('pot-bulk-bar')?.remove();
  const potsGrid = document.getElementById('pots-grid');
  if (potsGrid) potsGrid.classList.remove('select-mode');
  updatePotSelectAllBtn();
}

function updatePotBulkBar() {
  let bar = document.getElementById('pot-bulk-bar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'pot-bulk-bar'; bar.className = 'bulk-action-bar'; document.body.appendChild(bar); }
  const n = selectedPots.size;
  const allIds = getAllHomePotIds();
  const allSelected = allIds.length > 0 && allIds.every(id => selectedPots.has(id));
  const taskBtn = n > 0 ? `<button class="bulk-btn" data-action="bulkPotTask">📋 Aplicar tarea</button>` : '';
  const selectAllBtn = !allSelected ? `<button class="bulk-btn" data-action="potSelectAll">☑️ Todo</button>` : '';
  const clearBtn = n > 0 ? `<button class="bulk-btn" data-action="potSelectNone">○ Ninguna</button>` : '';
  bar.innerHTML = `
    <div class="bulk-count">${n} maceta${n!==1?'s':''} seleccionada${n!==1?'s':''}</div>
    <div class="bulk-actions">
      ${taskBtn}
      ${selectAllBtn}
      ${clearBtn}
      <button class="bulk-btn bulk-btn-cancel" data-action="clearPotSelection">✕ Cancelar</button>
    </div>`;
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
  if (ts && taskSelectMode && !e.target.closest('[data-action]')) {
    e.preventDefault();
    const potId = ts.dataset.potId;
    if (potId) toggleTaskPotSelection(potId);
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
    if (potSelectMode && nav.startsWith('pot/') && !nav.includes('/photo/')) {
      const potId = nav.split('/')[1];
      if (potId) togglePotSelection(potId);
      return;
    }
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

// ===== INIT =====
window.addEventListener('hashchange', () => navigate(window.location.hash));
window.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) { try { await navigator.serviceWorker.register('./sw.js'); } catch(e) {} }

  // Complete any pending Google redirect sign-in (iOS PWA flow)
  await handlePendingRedirect();

  onAuthChange(async (user) => {
    clearPhotoCache();
    if (user) {

      await DB.init(user.uid);
      DB.registerUserProfile(user);
      const savedTheme = await DB.getSetting('theme') || 'dark';
      localStorage.setItem('gardenai-theme', savedTheme);
      applyTheme(savedTheme);

      // Attempt to migrate legacy local data to Firestore
      const migrated = await runMigration();
      if (migrated) {
        showToast('🚀 ¡Datos locales migrados a la nube!', 5000);
      }

      navigate(window.location.hash || '#home');
    } else {
      currentRoute = '';
      mainEl().innerHTML = renderLogin();
    }
  });
});
