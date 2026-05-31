// js/ui.js — UI components and rendering for GardenAI v2

import DB from './db.js';
import { blobToDataURL } from './camera.js';

// ===== HELPERS =====
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
function formatDateShort(iso) {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}
function dateKey(iso) { return new Date(iso).toISOString().slice(0, 10); }
export function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
export function toInputDate(iso) { return iso ? iso.slice(0,10) : ''; }

const POT_EMOJIS = ['🪴','🌿','🌱','🌵','🌺','🌻','🌷','🍀','🌾','🌳','🌲','🌸','🍃','🎋','🪻','🌹','💐','🪷'];

function cleanPlantName(name) {
  if (!name) return '';
  return name
    .replace(/\(estimaci[oó]n\)/gi, '')
    .replace(/\(estimated?\)/gi, '')
    .replace(/\(aproximado\)/gi, '')
    .replace(/^estimaci[oó]n:\s*/i, '')
    .replace(/^probablemente\s+/i, '')
    .replace(/^possibly\s+/i, '')
    .split('(')[0]
    .trim();
}

// ===== PHOTO URL CACHE =====
const photoURLCache = new Map();
export async function getPhotoURL(photo) {
  if (photoURLCache.has(photo.id)) return photoURLCache.get(photo.id);
  let url;
  if (photo.storageUrl) {
    url = photo.storageUrl;
  } else if (photo.imageData) {
    url = photo.imageData;
  } else if (photo.blob) {
    url = await blobToDataURL(photo.blob);
  }
  if (url) photoURLCache.set(photo.id, url);
  return url;
}
export function clearPhotoCache() { photoURLCache.clear(); }

// ===== HOME VIEW =====
export async function renderHome() {
  const pots = await DB.getAllPots();
  const [photosArr, analysesArr] = await Promise.all([
    Promise.all(pots.map(p => DB.getPhotosByPot(p.id))),
    Promise.all(pots.map(p => DB.getAnalysesByPot(p.id)))
  ]);
  // Precompute all thumb URLs in parallel — prefer mainPhotoId if set
  const thumbUrls = await Promise.all(pots.map((pot, i) => {
    const photos = photosArr[i];
    if (!photos.length) return Promise.resolve(null);
    const main = pot.mainPhotoId
      ? (photos.find(p => p.id === pot.mainPhotoId) || photos[0])
      : photos[0];
    return (main.blob || main.storageUrl || main.imageData) ? getPhotoURL(main) : Promise.resolve(null);
  }));
  let potsHtml = '';
  for (let i = 0; i < pots.length; i++) {
    const pot = pots[i];
    const photos = photosArr[i];
    const analyses = analysesArr[i];
    const thumbUrl = thumbUrls[i];
    let thumbHtml = thumbUrl
      ? `<img class="pot-thumb" src="${thumbUrl}" alt="${escapeHtml(pot.name)}">`
      : `<div class="pot-icon">${pot.emoji || '🪴'}</div>`;
    let statusHtml = '';
    if (analyses.length > 0) {
      const latest = analyses.sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt))[0];
      const st = latest.result?.healthStatus || 'healthy';
      const lb = { healthy:'Sana', warning:'Atención', danger:'Problema' };
      statusHtml = `<span class="pot-status status-${st}">${lb[st]||st}</span>`;
    }
    const plantTypes = (pot.plantTypes || (pot.plantType ? [pot.plantType] : [])).map(cleanPlantName).filter(Boolean);
    const plantTypeHtml = plantTypes.length ? `<div class="pot-plant-type">${escapeHtml(plantTypes.join(', '))}</div>` : '';
    potsHtml += `<div class="glass-card pot-card" data-navigate="pot/${pot.id}" data-pot-id="${pot.id}" id="pot-card-${pot.id}">
      <div class="drag-handle" title="Arrastrar para reordenar"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" opacity="0.5"><circle cx="5" cy="4" r="1.3"/><circle cx="11" cy="4" r="1.3"/><circle cx="5" cy="8" r="1.3"/><circle cx="11" cy="8" r="1.3"/><circle cx="5" cy="12" r="1.3"/><circle cx="11" cy="12" r="1.3"/></svg></div>
      <div class="pot-top-bar">
        ${statusHtml || '<span></span>'}
        <span class="pot-count-badge">${photos.length} foto${photos.length!==1?'s':''}</span>
      </div>
      ${thumbHtml}
      <div class="pot-name">${escapeHtml(pot.name)}</div>${plantTypeHtml}
    </div>`;
  }
  return `<div class="flex items-center justify-between mb-6" style="gap:8px">
    <div class="section-subtitle">${pots.length} maceta${pots.length!==1?'s':''}</div>
    <div style="display:flex;align-items:center;gap:6px">
      <button class="btn btn-icon btn-secondary home-action-btn" data-action="addPlant" id="add-plant-btn" title="Nueva Planta">
        <span style="font-size:1.1rem">🌱</span>
      </button>
      <button class="btn btn-icon btn-secondary home-action-btn" data-action="addPot" id="add-pot-btn" title="Nueva Maceta">
        <span style="font-size:1.1rem">🪴</span>
      </button>
      <button class="btn btn-icon btn-secondary" data-action="togglePotModeMenu" id="pot-select-mode-btn" title="Opciones">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#16a34a" stroke-width="2"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  </div>
    <div class="pots-grid" id="pots-grid">${potsHtml}</div>`;
}

// ===== POT DETAIL VIEW =====
export async function renderPot(potId) {
  const pot = await DB.getPot(Number(potId));
  if (!pot) return '<div class="empty-state"><div class="empty-icon">❓</div><p>Maceta no encontrada</p></div>';
  const [photos, notes, analyses, taskLogs, allProducts] = await Promise.all([
    DB.getPhotosByPot(pot.id),
    DB.getNotesByPot(pot.id),
    DB.getAnalysesByPot(pot.id),
    DB.getTaskLogsByPot(pot.id),
    DB.getAllProducts()
  ]);
  const productMap = {};
  for (const p of allProducts) productMap[p.slug] = p;
  let summaryHtml = '';
  if (analyses && analyses.length > 0) {
    analyses.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    const latestDate = new Date(analyses[0].createdAt).toISOString().slice(0,10);
    const todayAnalyses = analyses.filter(a => a.createdAt.startsWith(latestDate));
    
    let worstStatus = 'healthy';
    let totalScore = 0;
    let scoreCount = 0;
    const allIssues = [];
    const todayPlantAnalyses = todayAnalyses.filter(a => a.type === 'plant' && a.result);
    
    todayPlantAnalyses.forEach(a => {
      const r = a.result;
      if (r.healthStatus === 'danger') worstStatus = 'danger';
      else if (r.healthStatus === 'warning' && worstStatus !== 'danger') worstStatus = 'warning';
      
      if (r.healthScore) { totalScore += Number(r.healthScore); scoreCount++; }
      if (r.issues) allIssues.push(...r.issues);
    });
    
    const uniqueIssues = [];
    const seenIssueNames = new Set();
    for (const issue of allIssues) {
      const name = (issue.name || issue.type).toLowerCase();
      if (!seenIssueNames.has(name)) { uniqueIssues.push(issue); seenIssueNames.add(name); }
    }
    
    const avgScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : null;
    const latestSoil = todayAnalyses.find(a => a.type === 'analyzer');

    if (todayPlantAnalyses.length > 0 || latestSoil) {
      summaryHtml = `<div class="glass-card mb-16 pot-summary"><div class="summary-title" style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">Resumen Consolidado (${formatDateShort(latestDate)})</div><div style="display:flex;flex-wrap:wrap;gap:8px;font-size:0.85rem">`;
      if (todayPlantAnalyses.length > 0) {
        const sl = { healthy:'🟢 Sana', warning:'🟡 Atención', danger:'🔴 Problema' };
        summaryHtml += `<div style="background:var(--bg-secondary);padding:6px 12px;border-radius:12px;border:1px solid var(--border-glass)"><strong>🌿 Planta:</strong> ${escapeHtml(sl[worstStatus]||worstStatus)}</div>`;
        if (avgScore) summaryHtml += `<div style="background:var(--bg-secondary);padding:6px 12px;border-radius:12px;border:1px solid var(--border-glass)"><strong>⭐ Promedio:</strong> ${escapeHtml(avgScore)}/10</div>`;
      }
      if (latestSoil && latestSoil.result) {
        const r = latestSoil.result;
        if (r.humidity && r.humidity !== 'N/A') summaryHtml += `<div style="background:var(--bg-secondary);padding:6px 12px;border-radius:12px;border:1px solid var(--border-glass)"><strong>💧 Humedad:</strong> ${escapeHtml(r.humidity)}%</div>`;
        if (r.ph && r.ph !== 'N/A') summaryHtml += `<div style="background:var(--bg-secondary);padding:6px 12px;border-radius:12px;border:1px solid var(--border-glass)"><strong>⚗️ pH:</strong> ${escapeHtml(r.ph)}</div>`;
        if (r.temperature && r.temperature !== 'N/A') summaryHtml += `<div style="background:var(--bg-secondary);padding:6px 12px;border-radius:12px;border:1px solid var(--border-glass)"><strong>🌡️ Temp:</strong> ${escapeHtml(r.temperature)}</div>`;
      }
      summaryHtml += `</div>`;

      const recommendedProducts = mapIssuesToProducts(uniqueIssues, latestSoil?.result);

      if (uniqueIssues.length > 0 || recommendedProducts.length > 0) {
        summaryHtml += `<div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:12px">`;

        if (uniqueIssues.length > 0) {
          summaryHtml += `<div style="font-size:0.8rem;background:rgba(255,100,100,0.1);padding:8px;border-radius:8px;border:1px solid rgba(255,100,100,0.2)"><strong>🚨 Problemas:</strong><ul style="margin:4px 0 0 16px;padding:0;font-size:0.75rem">`;
          for (const issue of uniqueIssues) { summaryHtml += `<li style="margin-bottom:2px">${escapeHtml(issue.name||issue.type)}<br><em style="opacity:0.6;font-size:0.7rem">${escapeHtml(issue.severity)}</em></li>`; }
          summaryHtml += `</ul></div>`;
        }

        if (recommendedProducts.length > 0) {
          summaryHtml += `<div style="font-size:0.8rem;background:rgba(100,200,100,0.1);padding:8px;border-radius:8px;border:1px solid rgba(100,200,100,0.2)"><strong>✅ Recomendado:</strong><ul style="margin:4px 0 0 16px;padding:0;font-size:0.75rem">`;
          for (const prod of recommendedProducts) { summaryHtml += `<li style="margin-bottom:4px;cursor:pointer" data-action="applyProduct" data-pot-id="${pot.id}" data-product-slug="${escapeHtml(prod.slug)}">${escapeHtml(prod.icon)} ${escapeHtml(prod.name)}</li>`; }
          summaryHtml += `</ul></div>`;
        }

        summaryHtml += `</div>`;
      }
      summaryHtml += `</div>`;
    }
  }
  let content = '';
  if (photos.length === 0 && notes.length === 0 && taskLogs.length === 0) {
    content = `<div class="empty-state"><div class="empty-icon">📷</div><p>Aún no hay fotos ni notas. Toma una foto o escribe una nota sobre tu planta.</p></div>`;
  } else {
    // Fetch all photo URLs and analyses in parallel
    const [photoUrls, photoAnalyses] = await Promise.all([
      Promise.all(photos.map(p => getPhotoURL(p))),
      Promise.all(photos.map(p => DB.getAnalysisByPhoto(p.id)))
    ]);
    const photoMap = {};
    photos.forEach((p, i) => { photoMap[p.id] = { url: photoUrls[i], analysis: photoAnalyses[i] }; });

    // Combine photos, notes, analyses and task logs into a single timeline
    const allItems = [];
    for (const p of photos) { allItems.push({ type: 'photo', data: p }); }
    for (const n of notes) { allItems.push({ type: 'note', data: n }); }
    for (const a of analyses) { allItems.push({ type: 'analysis', data: a }); }
    for (const l of taskLogs) { allItems.push({ type: 'tasklog', data: { ...l, createdAt: l.appliedAt } }); }
    allItems.sort((a, b) => new Date(b.data.createdAt) - new Date(a.data.createdAt));

    const groups = {};
    for (const item of allItems) {
      const k = dateKey(item.data.createdAt);
      if(!groups[k]) groups[k]=[];
      groups[k].push(item);
    }

    for (const date of Object.keys(groups).sort((a,b)=>b.localeCompare(a))) {
      const dateItems = groups[date];

      let photosHtml = '';
      let notesHtml = '';
      let analysisText = '';

      // Get photos for this date
      const photosInDate = dateItems.filter(i => i.type === 'photo');
      for (const item of photosInDate) {
        const photo = item.data;
        const { url, analysis } = photoMap[photo.id];

        photosHtml += `<div style="display:flex;flex-direction:column;align-items:center"><img src="${url}" alt="Foto" style="width:80px;height:80px;border-radius:8px;object-fit:cover;cursor:pointer;border:1px solid var(--border-glass)" data-action="viewPhoto" data-photo-id="${photo.id}"></div>`;

        // Render full userNotes text as a readable block (like standalone notes)
        if (photo.userNotes) {
          notesHtml += `<div style="background:var(--bg-secondary);padding:8px 12px;border-radius:12px;border:1px solid var(--border-glass);font-size:0.8rem;color:var(--text-primary);margin-bottom:8px"><div style="white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;line-height:1.55">📝 ${escapeHtml(photo.userNotes)}</div></div>`;
        }

        // Extract analysis text from first photo analysis
        if (analysis && analysis.result && !analysisText) {
          const r = analysis.result;
          let parts = [];

          if (r.healthStatus) {
            const statusEmoji = { healthy: '🟢', warning: '🟡', danger: '🔴' };
            const statusLabel = { healthy: 'Sana', warning: 'Atención', danger: 'Problema' };
            const e = statusEmoji[r.healthStatus] || '⚪';
            const l = statusLabel[r.healthStatus] || r.healthStatus;
            parts.push(`${e} ${l}${r.healthScore ? ' (' + r.healthScore + '/10)' : ''}`);

            if (r.issues && r.issues.length > 0) {
              parts.push('⚠️ ' + r.issues.map(i => escapeHtml(i.name || i.type)).join(', '));
            }
          }

          if (r.humidity && r.humidity !== 'N/A') {
            parts.push(`💧 Humedad: ${escapeHtml(r.humidity)}%`);
          }
          if (r.ph && r.ph !== 'N/A') {
            parts.push(`⚗️ pH: ${escapeHtml(r.ph)}`);
          }
          if (r.temperature && r.temperature !== 'N/A') {
            parts.push(`🌡️ ${escapeHtml(r.temperature)}`);
          }
          if (r.notes) {
            parts.push(`📌 ${escapeHtml(r.notes.substring(0, 40))}`);
          }

          analysisText = parts.join(' · ');
        }
      }

      // Get notes for this date
      const notesInDate = dateItems.filter(i => i.type === 'note');
      for (const item of notesInDate) {
        const note = item.data;
        notesHtml += `<div style="background:var(--bg-secondary);padding:8px 12px;border-radius:12px;border:1px solid var(--border-glass);font-size:0.8rem;color:var(--text-primary);margin-bottom:8px"><div style="white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;line-height:1.55">📝 ${escapeHtml(note.text)}</div></div>`;
      }

      // Get task logs for this date
      const tasklogsInDate = dateItems.filter(i => i.type === 'tasklog');
      let tasklogsHtml = '';
      if (tasklogsInDate.length > 0) {
        const seenSlugs = new Set();
        const productNames = [];
        for (const item of tasklogsInDate) {
          const slug = item.data.productSlug;
          if (!seenSlugs.has(slug)) {
            seenSlugs.add(slug);
            const prod = productMap[slug];
            productNames.push(prod ? `${escapeHtml(prod.icon)} ${escapeHtml(prod.name)}` : escapeHtml(slug));
          }
        }
        tasklogsHtml = `<div style="background:rgba(45,212,168,0.08);padding:8px 12px;border-radius:12px;border:1px solid rgba(45,212,168,0.25);font-size:0.8rem;color:var(--text-primary)">✅ Aplicado: ${productNames.join(' · ')}</div>`;
      }

      // Show if there are photos, notes, or task logs
      if (photosInDate.length > 0 || notesInDate.length > 0 || tasklogsInDate.length > 0) {
        const hasEditable = photosInDate.length > 0 || notesInDate.length > 0;
        // Photos row + edit button (only when photos exist)
        const photosRow = photosHtml ? `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;margin-bottom:${analysisText||notesHtml||tasklogsHtml?'8px':'0'}">${photosHtml}${hasEditable ? `<button class="btn btn-icon btn-secondary" data-action="editDayItems" data-date="${date}" style="margin-left:auto;align-self:flex-start">✏️</button>` : ''}</div>${analysisText ? `<div style="background:var(--bg-secondary);padding:8px 12px;border-radius:12px;border:1px solid var(--border-glass);font-size:0.8rem;color:var(--text-primary);word-break:break-word;margin-bottom:8px">${analysisText}</div>` : ''}` : (hasEditable ? `<div style="display:flex;justify-content:flex-end;margin-bottom:4px"><button class="btn btn-icon btn-secondary" data-action="editDayItems" data-date="${date}">✏️</button></div>` : '');
        content += `<div class="glass-card mb-16" style="padding:12px">
          <div class="summary-title" style="font-size:0.8rem;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px">${formatDate(dateItems[0].data.createdAt)}</div>
          ${photosRow}
          ${notesHtml}
          ${tasklogsHtml}
        </div>`;
      }
    }
  }
  const plantTypes = (pot.plantTypes || (pot.plantType ? [pot.plantType] : [])).map(cleanPlantName).filter(Boolean);
  const plantSubtitle = plantTypes.length
    ? `🌸 ${escapeHtml(plantTypes.join(', '))}${pot.description ? ' · ' + escapeHtml(pot.description) : ''}`
    : escapeHtml(pot.description || 'Sin descripción');
  return `<div class="flex items-center justify-between mb-6" style="gap:8px"><div class="section-subtitle">${plantSubtitle}</div><div class="flex gap-8"><button class="btn btn-icon btn-secondary" data-action="openPotSchedule" data-pot-id="${pot.id}" id="schedule-pot-btn" title="Cronograma">📅</button><button class="btn btn-icon btn-secondary" data-action="editPot" data-pot-id="${pot.id}" id="edit-pot-btn" title="Editar">✏️</button><button class="btn btn-icon btn-secondary" data-action="enterSelectMode" id="select-mode-btn" title="Seleccionar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#16a34a" stroke-width="2"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></div>${summaryHtml}${content}<button class="fab" data-action="addPhoto" data-pot-id="${pot.id}" id="add-photo-fab" title="Agregar foto">📷</button>`;
}

// ===== PHOTO DETAIL VIEW =====
export async function renderPhotoDetail(photoId) {
  const photo = await DB.getPhoto(Number(photoId));
  if (!photo) return '<div class="empty-state"><p>Foto no encontrada</p></div>';

  const potPhotos = await DB.getPhotosByPot(photo.potId);
  potPhotos.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  const currentIndex = potPhotos.findIndex(p => p.id === photo.id);
  const nextPhoto = currentIndex > 0 ? potPhotos[currentIndex - 1] : null;
  const prevPhoto = currentIndex < potPhotos.length - 1 ? potPhotos[currentIndex + 1] : null;

  const url = await getPhotoURL(photo);
  const analysis = await DB.getAnalysisByPhoto(photo.id);
  let analysisHtml = '';
  const switchType = photo.type === 'analyzer' ? 'plant' : 'analyzer';
  const switchLabel = photo.type === 'analyzer' ? '🌿 Cambiar a Planta' : '📊 Cambiar a Analizador';
  const analyzeLabel = photo.type === 'analyzer' ? 'Medidor' : 'Planta';
  if (analysis && analysis.result) {
    analysisHtml = photo.type==='analyzer'
      ? renderSoilAnalysis(analysis.result, photo.id, switchType, switchLabel)
      : renderPlantAnalysis(analysis.result, photo.id, switchType, switchLabel);
  } else {
    analysisHtml = `<div class="analysis-card glass-card"><div class="analysis-header"><span class="ai-icon">🤖</span><h3>Análisis IA</h3><button class="analysis-menu-btn" data-action="openAnalysisMenu" data-photo-id="${photo.id}" data-switch-type="${switchType}" data-switch-label="${escapeHtml(switchLabel)}">✏️</button></div><button class="btn btn-primary btn-block" style="margin-top:4px" data-action="analyzePhoto" data-photo-id="${photo.id}" id="analyze-btn">✨ Analizar ${analyzeLabel}</button></div>`;
  }
  
  const navHtml = `
    <div class="photo-gallery-nav glass-card">
      ${prevPhoto ? `<button class="nav-arrow" data-navigate="pot/${photo.potId}/photo/${prevPhoto.id}">‹</button>` : '<div class="nav-spacer"></div>'}
      <div class="nav-date">
        <div class="date-main">${formatDate(photo.createdAt)}</div>
        <div class="date-sub">${formatTime(photo.createdAt)} • ${photo.type==='analyzer'?'📊 Analizador':'🌿 Planta'} ${potPhotos.length > 1 ? `• ${currentIndex+1}/${potPhotos.length}` : ''}</div>
      </div>
      ${nextPhoto ? `<button class="nav-arrow" data-navigate="pot/${photo.potId}/photo/${nextPhoto.id}">›</button>` : '<div class="nav-spacer"></div>'}
    </div>
  `;

  const notesText = photo.userNotes ? escapeHtml(photo.userNotes).replace(/\n/g, '<br>') : '';
  const notesHtml = notesText
    ? `<div class="user-notes-section"><div class="user-notes-label">📝 Notas</div><div class="user-notes-text">${notesText}</div></div>`
    : '';
  return `${navHtml}
    <img class="photo-detail-img" src="${url}" alt="Foto detalle">
    ${notesHtml}
    ${analysisHtml}`;
}

function renderPlantAnalysis(r, photoId, switchType, switchLabel) {
  const sc = { healthy:'var(--success)', warning:'var(--warning)', danger:'var(--danger)' };
  const sl = { healthy:'🟢 Saludable', warning:'🟡 Atención', danger:'🔴 Problema' };
  let issues = '';
  if (r.issues?.length) { issues = '<div class="mt-8"><strong>Problemas:</strong></div><ul style="margin:6px 0 0 18px;font-size:0.8rem;color:var(--text-secondary)">'; for(const i of r.issues) issues+=`<li><strong>${escapeHtml(i.name||i.type)}</strong>: ${escapeHtml(i.description)} <em>(${i.severity})</em></li>`; issues+='</ul>'; }
  let recs = '';
  if (r.recommendations?.length) { recs = '<div class="mt-8"><strong>Recomendaciones:</strong></div><ul style="margin:6px 0 0 18px;font-size:0.8rem;color:var(--text-secondary)">'; for(const rc of r.recommendations) recs+=`<li>${escapeHtml(rc)}</li>`; recs+='</ul>'; }
  const menuBtn = photoId ? `<button class="analysis-menu-btn" data-action="openAnalysisMenu" data-photo-id="${photoId}" data-switch-type="${switchType}" data-switch-label="${escapeHtml(switchLabel||'')}">✏️</button>` : '';
  return `<div class="analysis-card glass-card"><div class="analysis-header"><span class="ai-icon">🤖</span><h3>Análisis de Planta</h3>${menuBtn}</div><div class="analysis-body">${r.plantType?`<div><strong>Planta:</strong> ${escapeHtml(cleanPlantName(r.plantType))}</div>`:''}<div style="margin:8px 0;display:flex;align-items:center;gap:8px"><span style="color:${escapeHtml(sc[r.healthStatus]||'var(--text-secondary)')}">${escapeHtml(sl[r.healthStatus]||r.healthStatus)}</span>${r.healthScore?`<span style="font-size:0.75rem;color:var(--text-muted)">Puntuación: ${escapeHtml(r.healthScore)}/10</span>`:''}</div>${r.summary?`<p>${escapeHtml(r.summary)}</p>`:''}${r.sunRequirements?`<div class="mt-8"><strong>☀️ Sol:</strong> ${escapeHtml(r.sunRequirements)}</div>`:''}${r.waterRequirements?`<div><strong>💧 Riego:</strong> ${escapeHtml(r.waterRequirements)}</div>`:''}${issues}${recs}</div></div>`;
}

function renderSoilAnalysis(r, photoId, switchType, switchLabel) {
  const params = [{key:'fertility',label:'Fertilidad',unit:'µ/cm²',icon:'🌱'},{key:'humidity',label:'Humedad Suelo',unit:'%',icon:'💧'},{key:'ph',label:'pH',unit:'',icon:'⚗️'},{key:'temperature',label:'Temperatura',unit:'°C',icon:'🌡️'},{key:'sunlight',label:'Luz Solar',unit:'',icon:'☀️'},{key:'ambientHumidity',label:'Humedad Amb.',unit:'%',icon:'🌫️'}];
  let ph = '<div class="soil-params">';
  for (const p of params) { const v=r[p.key]??'N/A'; ph+=`<div class="soil-param"><div class="param-label">${escapeHtml(p.icon)} ${escapeHtml(p.label)}</div><div class="param-value">${escapeHtml(v)}</div>${p.unit?`<div class="param-unit">${escapeHtml(p.unit)}</div>`:''}</div>`; }
  ph += '</div>';
  const menuBtn = photoId ? `<button class="analysis-menu-btn" data-action="openAnalysisMenu" data-photo-id="${photoId}" data-switch-type="${switchType}" data-switch-label="${escapeHtml(switchLabel||'')}">✏️</button>` : '';
  return `<div class="analysis-card glass-card"><div class="analysis-header"><span class="ai-icon">📊</span><h3>Datos del Suelo</h3>${menuBtn}</div>${ph}${r.confidence?`<div class="mt-8" style="font-size:0.75rem;color:var(--text-muted)">Confianza: ${escapeHtml(r.confidence)}</div>`:''}${r.notes?`<div style="font-size:0.78rem;color:var(--text-secondary);margin-top:6px">${escapeHtml(r.notes)}</div>`:''}</div>`;
}

export function renderAnalysisActionsModal(photoId, switchType, switchLabel, isMainPhoto = false) {
  return `<div class="modal-overlay" data-action="closeModal">
    <div class="modal-content">
      <div class="modal-handle"></div>
      <div class="modal-title">Opciones</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-secondary btn-block" data-action="analyzePhoto" data-photo-id="${photoId}">🔄 Re-analizar</button>
        <button class="btn btn-secondary btn-block" data-action="switchPhotoType" data-photo-id="${photoId}" data-new-type="${switchType}">${escapeHtml(switchLabel)} y analizar</button>
        <button class="btn ${isMainPhoto ? 'btn-primary' : 'btn-secondary'} btn-block" data-action="setMainPhoto" data-photo-id="${photoId}">${isMainPhoto ? '⭐ Foto principal (activa)' : '⭐ Usar como foto principal'}</button>
        <button class="btn btn-secondary btn-block" data-action="editPhoto" data-photo-id="${photoId}">✏️ Editar</button>
        <button class="btn btn-danger btn-block" data-action="deletePhoto" data-photo-id="${photoId}">🗑️ Eliminar</button>
      </div>
    </div>
  </div>`;
}

export function mapIssuesToProducts(issues, soilData) {
  const recommendations = new Map();
  const keywordMap = {
    water: { keywords: ['agua', 'seca', 'riego', 'humedad baja', 'sequedad'], slug: 'water', name: 'Agua', icon: '💧' },
    fertilizer: { keywords: ['fertilidad', 'nutriente', 'nitrógeno', 'fósforo', 'carencia', 'deficiencia nutri'], slug: 'fertilizer', name: 'Abono', icon: '🧪' },
    potassium: { keywords: ['potasio', 'deficiencia de potasio'], slug: 'potassium', name: 'Potasio', icon: '🟡' },
    sulfur: { keywords: ['hongo', 'enfermedad', 'moho', 'mildiu', 'oidio'], slug: 'sulfur', name: 'Azufre', icon: '🟠' },
    copper: { keywords: ['plaga', 'insecto', 'ácaros', 'cochinilla', 'escama'], slug: 'copper', name: 'Cobre', icon: '🔶' },
    acid: { keywords: ['ph bajo', 'ácido', 'acidez'], slug: 'acid', name: 'Ácido Cítrico', icon: '⚗️' }
  };

  if (issues && issues.length > 0) {
    for (const issue of issues) {
      const text = (issue.name + ' ' + (issue.description || '')).toLowerCase();
      for (const [key, mapping] of Object.entries(keywordMap)) {
        if (mapping.keywords.some(kw => text.includes(kw)) && !recommendations.has(mapping.slug)) {
          recommendations.set(mapping.slug, mapping);
          break;
        }
      }
    }
  }

  if (soilData) {
    if (soilData.humidity && soilData.humidity !== 'N/A' && Number(soilData.humidity) < 30) {
      if (!recommendations.has('water')) {
        recommendations.set('water', { slug: 'water', name: 'Agua', icon: '💧' });
      }
    }
    if (soilData.ph && soilData.ph !== 'N/A') {
      const ph = Number(soilData.ph);
      if (ph < 6 && !recommendations.has('acid')) {
        recommendations.set('acid', { slug: 'acid', name: 'Ácido Cítrico', icon: '⚗️' });
      }
    }
    if (soilData.fertility && soilData.fertility !== 'N/A' && Number(soilData.fertility) < 300) {
      if (!recommendations.has('fertilizer')) {
        recommendations.set('fertilizer', { slug: 'fertilizer', name: 'Abono', icon: '🧪' });
      }
    }
  }

  return Array.from(recommendations.values());
}

function computeTaskStatus(pot, product, allLogs, isRecommended = false) {
  const freq = pot.scheduleOverrides?.[product.slug] || product.defaultFrequencyDays;
  const potLogs = allLogs.filter(l => l.potId === Number(pot.id) && l.productSlug === product.slug);
  if (!potLogs.length) {
    const label = isRecommended ? 'Recomendado' : 'Pendiente';
    return { status: 'warning', label, freq };
  }
  const sorted = potLogs.sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));
  const last = sorted[0];
  const diffDays = Math.floor((new Date() - new Date(last.appliedAt)) / 86400000);

  if (diffDays < 0) {
    const daysUntil = Math.abs(diffDays);
    if (daysUntil > 1) return { status: 'healthy', label: `Faltan ${daysUntil} días`, freq };
    if (daysUntil === 1) return { status: 'healthy', label: 'Falta 1 día', freq };
    return { status: 'warning', label: 'Hoy toca aplicar', freq };
  }

  const rem = freq - diffDays;
  if (rem > 1)  return { status: 'healthy', label: `Faltan ${rem} días`, freq };
  if (rem === 1) return { status: 'healthy', label: 'Falta 1 día', freq };
  if (rem === 0) return { status: 'warning', label: 'Hoy toca aplicar', freq };
  const ov = Math.abs(rem);
  return { status: 'danger', label: `${ov} día${ov>1?'s':''} de atraso`, freq };
}

// ===== TASKS VIEW =====
export async function renderTasks(filter = 'all') {
  const [pots, products, analyses] = await Promise.all([
    DB.getAllPots(),
    DB.getAllProducts(),
    Promise.all((await DB.getAllPots()).map(p => DB.getAnalysesByPot(p.id)))
  ]);
  products.sort((a, b) => a.name.localeCompare(b.name));

  const filterChips = `<div class="task-filter-bar">
    <button class="task-filter-chip${filter==='all'?' active':''}" data-action="setTaskFilter" data-filter="all">🔍 Todos</button>
    <button class="task-filter-chip${filter==='pending'?' active':''}" data-action="setTaskFilter" data-filter="pending">⚠️ Pendientes</button>
    <button class="task-filter-chip${filter==='soon'?' active':''}" data-action="setTaskFilter" data-filter="soon">📅 Próximos 3 días</button>
    <button class="task-filter-chip${filter==='ai'?' active':''}" data-action="setTaskFilter" data-filter="ai">🤖 IA Recomendado</button>
  </div>`;

  if (pots.length === 0) return `<div class="flex items-center justify-between mb-6"><div class="section-subtitle">Pendientes de tu jardín</div><button class="btn btn-secondary" style="padding:6px 12px;font-size:0.75rem" data-action="enterPotSelectModeTask" id="pot-select-task-btn" title="Seleccionar macetas"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#16a34a" stroke-width="2"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>${filterChips}<div class="empty-state"><div class="empty-icon">🪴</div><p>Agrega macetas primero para ver las tareas pendientes.</p></div>`;

  const allLogs = await DB.getTaskLogsByPots(pots.map(p => Number(p.id)));
  let html = '';
  let anyVisible = false;

  for (let i = 0; i < pots.length; i++) {
    const pot = pots[i];
    const potAnalyses = analyses[i] || [];
    const recommended = mapIssuesToProducts(potAnalyses.filter(a => a.type === 'plant').flatMap(a => a.result?.issues || []), null);
    const recommendedSlugs = recommended.map(p => p.slug);
    const activeProductSlugs = [...new Set([...(pot.activeProducts || []), ...recommendedSlugs])];
    const activeProducts = products.filter(p => activeProductSlugs.includes(p.slug));

    let rows = '';
    for (const prod of activeProducts) {
      const isRecommended = recommendedSlugs.includes(prod.slug);
      const ts = computeTaskStatus(pot, prod, allLogs, isRecommended);

      // Apply filter
      if (filter === 'pending' && ts.status === 'healthy') continue;
      if (filter === 'soon') {
        // Show only overdue or due within 3 days
        const rem = (() => {
          const freq = pot.scheduleOverrides?.[prod.slug] || prod.defaultFrequencyDays;
          const potLogs = allLogs.filter(l => l.potId === Number(pot.id) && l.productSlug === prod.slug);
          if (!potLogs.length) return 0; // treat as due
          const sorted = potLogs.sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));
          const diffDays = Math.floor((new Date() - new Date(sorted[0].appliedAt)) / 86400000);
          return freq - diffDays;
        })();
        if (rem > 3) continue;
      }
      if (filter === 'ai' && !isRecommended) continue;

      const recommendedLabel = (isRecommended && ts.label !== 'Pendiente' && ts.label !== 'Recomendado') ? `<span style="color:var(--text-muted);font-size:0.8rem;font-weight:500;margin-right:8px">💡 IA</span>` : '';
      rows += `<div class="task-row"><span class="task-icon">${escapeHtml(prod.icon)}</span><span class="task-name">${escapeHtml(prod.name)}</span><div style="margin-left:auto;display:flex;align-items:center;gap:8px">${recommendedLabel}<button class="btn-status" data-action="openProductMenu" data-pot-id="${pot.id}" data-product-slug="${prod.slug}"><span class="status-badge status-${ts.status}">${escapeHtml(ts.label)}</span></button></div></div>`;
    }

    if (!rows) continue; // skip pot if no tasks pass filter
    anyVisible = true;
    html += `<div class="glass-card task-pot-card" id="task-pot-${pot.id}" data-toggle-select="task" data-pot-id="${pot.id}" style="animation-delay:${i*0.06}s;cursor:pointer"><div class="pot-select-check"></div><div class="task-pot-header"><span class="pot-emoji">${pot.emoji||'🪴'}</span><span class="pot-name">${escapeHtml(pot.name)}</span></div>${rows}</div>`;
  }

  if (!anyVisible && filter !== 'all') {
    const filterLabel = { pending: 'tareas pendientes', soon: 'tareas en los próximos 3 días', ai: 'recomendaciones de IA' };
    html = `<div class="empty-state"><div class="empty-icon">✅</div><p>No hay ${filterLabel[filter] || 'tareas'} ahora mismo.</p></div>`;
  }

  return `<div class="flex items-center justify-between mb-6"><div class="section-subtitle">Pendientes de tu jardín</div><button class="btn btn-secondary" style="padding:6px 12px;font-size:0.75rem" data-action="enterPotSelectModeTask" id="pot-select-task-btn" title="Seleccionar macetas"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#16a34a" stroke-width="2"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>${filterChips}${html}`;
}

// ===== PRODUCTS VIEW =====
const PRODUCT_EMOJIS = ['💧','🧪','🟡','🟠','⚗️','🔶','🌿','💊','🧴','🔬','🌱','☘️','🍃','🌾','🫧','🧫','⚡','🪣','🫙','🔩','🧂','🪴','💦','🌊','🌡️','☀️'];

export async function renderProducts() {
  const products = await DB.getAllProducts();
  products.sort((a, b) => a.name.localeCompare(b.name));
  let list = '';
  for (const p of products) {
    const notesLine = p.notes ? `<div class="product-notes">${escapeHtml(p.notes)}</div>` : '';
    list += `<div class="glass-card product-card" data-navigate="product/${p.slug}" id="product-${p.slug}"><div class="product-icon">${escapeHtml(p.icon)}</div><div class="product-info"><div class="product-name">${escapeHtml(p.name)} <span class="product-freq-inline">· ${escapeHtml(String(p.defaultFrequencyDays))} días</span></div>${notesLine}</div><span class="product-arrow">›</span></div>`;
  }
  return `<div class="section-subtitle" style="margin-bottom:16px">Toca un producto para editar · usa ➕ para agregar</div><div class="product-list">${list}</div><button class="fab" data-action="addProduct" title="Nuevo producto">➕</button>`;
}

// ===== PRODUCT DETAIL VIEW =====
export async function renderProductDetail(slug) {
  const product = await DB.getProduct(slug);
  if (!product) return '<div class="empty-state"><p>Producto no encontrado</p></div>';

  // Icon picker
  let ep = '<div class="emoji-grid" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">';
  for (const e of PRODUCT_EMOJIS) {
    const sel = e === product.icon ? 'border-color:var(--accent);background:var(--accent-glow)' : '';
    ep += `<button type="button" class="emoji-pick-detail" data-emoji="${e}" style="font-size:1.4rem;padding:6px;border-radius:8px;border:2px solid var(--border-glass);${sel};cursor:pointer;background:var(--bg-secondary)">${e}</button>`;
  }
  ep += '</div>';

  // Photos
  let photosHtml = '';
  if (product.photos?.length) {
    for (let i = 0; i < product.photos.length; i++) {
      const dataUrl = typeof product.photos[i] === 'string' ? product.photos[i] : await blobToDataURL(product.photos[i]);
      photosHtml += `<div class="product-photo-thumb"><img src="${dataUrl}" alt="${escapeHtml(product.name)}"><button type="button" class="delete-x" data-action="deleteProductPhoto" data-slug="${slug}" data-index="${i}">✕</button></div>`;
    }
  }

  return `<form id="product-detail-form" data-slug="${slug}">
    <div class="glass-card" style="margin-bottom:16px">
      <div class="form-group"><label class="form-label">Icono</label>${ep}<input type="hidden" id="product-detail-icon" value="${escapeHtml(product.icon)}"></div>
      <div class="form-group"><label class="form-label">Nombre</label><input class="form-input" type="text" id="product-detail-name" value="${escapeHtml(product.name)}" placeholder="Ej: Fungicida" required></div>
      <div class="form-group"><label class="form-label">Frecuencia global (días)</label><input class="form-input" type="number" id="product-detail-freq" min="1" max="365" value="${product.defaultFrequencyDays}"></div>
      <div class="form-group"><label class="form-label">Notas</label><textarea class="form-input" id="product-detail-notes" placeholder="Descripción, dosis, observaciones...">${escapeHtml(product.notes||'')}</textarea></div>
      <div class="btn-group" style="margin-top:8px">
        <button type="submit" class="btn btn-primary btn-block" id="save-product-btn">💾 Guardar</button>
        <button type="button" class="btn btn-secondary" data-action="cancelProduct">Cancelar</button>
      </div>
    </div>
    <div class="glass-card" style="margin-bottom:16px">
      <div class="form-label" style="margin-bottom:10px">Fotos del producto</div>
      <div class="product-photos">${photosHtml}<button type="button" class="btn btn-secondary btn-sm" data-action="addProductPhoto" data-slug="${slug}" id="add-product-photo-btn">➕ Foto</button></div>
    </div>
    <div class="glass-card">
      <button type="button" class="btn btn-danger btn-block" data-action="deleteProduct" data-slug="${slug}" id="delete-product-btn">🗑️ Eliminar Producto</button>
    </div>
  </form>`;
}

// ===== MODALS =====
export async function renderEditPotProductsModal(potId) {
  const pot = await DB.getPot(Number(potId));
  const products = await DB.getAllProducts();
  const activeProductSlugs = pot?.activeProducts || [];

  let checkboxes = '';
  for (const prod of products) {
    const checked = activeProductSlugs.includes(prod.slug) ? 'checked' : '';
    checkboxes += `<label style="display:flex;align-items:center;gap:8px;padding:10px;cursor:pointer"><input type="checkbox" class="product-checkbox" data-slug="${prod.slug}" ${checked}><span>${escapeHtml(prod.icon)} ${escapeHtml(prod.name)}</span></label>`;
  }

  return `<div class="modal-overlay" data-action="closeModal">
    <div class="modal-content">
      <div class="modal-handle"></div>
      <div class="modal-title">📋 Productos para ${escapeHtml(pot.name)}</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;max-height:60vh;overflow-y:auto">${checkboxes}</div>
      <button class="btn btn-primary btn-block" data-action="savePotProducts" data-pot-id="${potId}">✅ Guardar</button>
    </div>
  </div>`;
}

export async function renderProductMenu(potId, productSlug) {
  const pot = await DB.getPot(Number(potId));
  const product = await DB.getProduct(productSlug);
  if (!pot || !product) return '';

  return `<div class="modal-overlay" data-action="closeModal">
    <div class="modal-content">
      <div class="modal-handle"></div>
      <div class="modal-title">${escapeHtml(product.icon)} ${escapeHtml(product.name)}</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px">
        <button class="btn btn-secondary btn-block" data-action="changeProductDate" data-pot-id="${potId}" data-product-slug="${productSlug}">📅 Cambiar fecha</button>
        <button class="btn btn-secondary btn-block" data-action="markProductDone" data-pot-id="${potId}" data-product-slug="${productSlug}">✅ Aplicado</button>
        <button class="btn btn-danger btn-block" data-action="deleteProductFromPot" data-pot-id="${potId}" data-product-slug="${productSlug}">🗑️ Eliminar</button>
      </div>
    </div>
  </div>`;
}

export function renderPotModeModal() {
  return `<div class="modal-overlay" data-action="closeModal" id="pot-mode-modal">
    <div class="modal-content">
      <div class="modal-handle"></div>
      <div class="modal-title">🪴 Mis Macetas</div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px">
        <button class="btn btn-secondary btn-block" data-action="openApplyTask" style="justify-content:flex-start;gap:12px;font-size:0.95rem">
          📋 Aplicar tarea
        </button>
        <button class="btn btn-secondary btn-block" data-action="enterReorderMode" style="justify-content:flex-start;gap:12px;font-size:0.95rem">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="4" cy="8" r="1.5" fill="currentColor"/><circle cx="12" cy="8" r="1.5" fill="currentColor"/><circle cx="20" cy="8" r="1.5" fill="currentColor"/><circle cx="4" cy="16" r="1.5" fill="currentColor"/><circle cx="12" cy="16" r="1.5" fill="currentColor"/><circle cx="20" cy="16" r="1.5" fill="currentColor"/></svg>
          Mover macetas
        </button>
      </div>
    </div>
  </div>`;
}

export function renderApplyTaskModal(products, pots) {
  const productButtons = products.map(p =>
    `<button type="button" class="apply-product-btn btn btn-secondary" data-slug="${escapeHtml(p.slug)}" style="justify-content:flex-start;gap:10px;padding:10px 14px;width:100%">
      <span style="font-size:1.2rem">${escapeHtml(p.icon)}</span>
      <span style="flex:1;text-align:left">${escapeHtml(p.name)}</span>
      <span style="color:var(--text-muted);font-size:0.72rem">c/${escapeHtml(String(p.defaultFrequencyDays))}d</span>
    </button>`
  ).join('');

  const potRows = pots.map(p =>
    `<label style="display:flex;align-items:center;gap:10px;padding:8px 6px;cursor:pointer;border-radius:8px">
      <input type="checkbox" class="apply-pot-check" data-pot-id="${p.id}" checked style="width:18px;height:18px;flex-shrink:0;accent-color:var(--accent)">
      <span style="font-size:1.1rem">${escapeHtml(p.emoji||'🪴')}</span>
      <span style="font-size:0.9rem">${escapeHtml(p.name)}</span>
    </label>`
  ).join('');

  return `<div class="modal-overlay" data-action="closeModal" id="apply-task-modal">
    <div class="modal-content">
      <div class="modal-handle"></div>
      <div class="modal-title">📋 Aplicar Tarea</div>
      <input type="hidden" id="apply-task-slug" value="">
      <div class="form-label" style="margin-bottom:8px">¿Qué aplicaste?</div>
      <div style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto;margin-bottom:16px">${productButtons}</div>
      <div class="form-label" style="margin-bottom:6px">¿A cuáles macetas?</div>
      <div style="display:flex;flex-direction:column;max-height:180px;overflow-y:auto;margin-bottom:16px;border:1px solid var(--border-glass);border-radius:10px;padding:4px 8px">${potRows}</div>
      <button class="btn btn-primary btn-block" data-action="confirmApplyTask" id="confirm-apply-task-btn">✅ Aplicar</button>
    </div>
  </div>`;
}

export function renderPotModal(pot = null) {
  const isEdit = !!pot;
  const emoji = pot?.emoji || POT_EMOJIS[Math.floor(Math.random()*POT_EMOJIS.length)];
  let ep = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">';
  for (const e of POT_EMOJIS) { const sel = e===emoji?'border-color:var(--accent);background:var(--accent-glow)':''; ep+=`<button class="emoji-pick" data-emoji="${e}" style="font-size:1.4rem;padding:6px;border-radius:8px;border:2px solid var(--border-glass);${sel};cursor:pointer;background:var(--bg-secondary)">${e}</button>`; }
  ep += '</div>';
  return `<div class="modal-overlay" data-action="closeModal" id="pot-modal"><div class="modal-content"><div class="modal-handle"></div><div class="modal-title">${isEdit?'Editar Maceta':'Nueva Maceta'}</div><form id="pot-form" data-pot-id="${pot?.id||''}"><div class="form-group"><label class="form-label">Icono</label>${ep}<input type="hidden" id="pot-emoji" value="${emoji}"></div><div class="form-group"><label class="form-label" for="pot-name">Nombre</label><input class="form-input" type="text" id="pot-name" placeholder="Ej: Maceta del balcón" value="${escapeHtml(pot?.name||'')}" required></div><div class="form-group"><label class="form-label" for="pot-desc">Descripción (opcional)</label><textarea class="form-input" id="pot-desc" placeholder="Ej: Tomates cherry">${escapeHtml(pot?.description||'')}</textarea></div><div class="btn-group"><button type="submit" class="btn btn-primary btn-block" id="save-pot-btn">${isEdit?'💾 Guardar':'➕ Crear Maceta'}</button>${isEdit?`<button type="button" class="btn btn-danger" data-action="deletePot" data-pot-id="${pot.id}" id="delete-pot-btn">🗑️</button>`:''}</div></form></div></div>`;
}

export function renderPhotoModal(potId) {
  return `<div class="modal-overlay" data-action="closeModal" id="photo-modal"><div class="modal-content"><div class="modal-handle"></div><div class="modal-title">¿Qué vas a fotografiar?</div><div class="flex flex-col gap-8" style="margin-top:8px"><button class="btn btn-secondary btn-block" data-action="selectPhotoType" data-pot-id="${potId}" data-photo-type="plant">🌿 Planta</button><button class="btn btn-secondary btn-block" data-action="selectPhotoType" data-pot-id="${potId}" data-photo-type="analyzer">📊 Analizador de suelo</button><button class="btn btn-secondary btn-block" data-action="openNotesModal" data-pot-id="${potId}">📝 Notas</button></div></div></div>`;
}

export function renderPhotoSourceModal(potId, photoType) {
  const label = photoType === 'analyzer' ? 'Analizador de suelo' : 'Planta';
  return `<div class="modal-overlay" data-action="closeModal" id="photo-modal"><div class="modal-content"><div class="modal-handle"></div><div class="modal-title">📷 ${label}</div><div class="flex flex-col gap-8" style="margin-top:8px"><button class="btn btn-secondary btn-block" data-action="capturePhoto" data-pot-id="${potId}" data-photo-type="${photoType}" id="capture-btn">📸 Tomar Foto</button><button class="btn btn-secondary btn-block" data-action="uploadPhoto" data-pot-id="${potId}" data-photo-type="${photoType}" id="upload-btn">🖼️ Subir desde el dispositivo</button></div></div></div>`;
}

export function renderNotesModal(potId) {
  return `<div class="modal-overlay" data-action="closeModal" id="notes-modal"><div class="modal-content"><div class="modal-handle"></div><div class="modal-title">📝 Agregar Nota</div><div class="form-group" style="margin-top:16px"><textarea class="form-input" id="new-note-text" placeholder="Escribe tus observaciones sobre el jardín..." style="min-height:120px"></textarea></div><div class="flex gap-8"><button class="btn btn-secondary btn-block" data-action="closeModal">Cancelar</button><button class="btn btn-primary btn-block" data-action="saveNote" data-pot-id="${potId}" id="save-note-btn">💾 Guardar Nota</button></div></div></div>`;
}

export async function renderEditNoteModal(noteId) {
  const note = await DB.getNote(noteId);
  if (!note) return '';
  return `<div class="modal-overlay" data-action="closeModal" id="edit-note-modal"><div class="modal-content"><div class="modal-handle"></div><div class="modal-title">✏️ Editar Nota</div><form id="edit-note-form" data-note-id="${note.id}"><div class="form-group"><label class="form-label">Fecha</label><input class="form-input" type="datetime-local" id="edit-note-date" value="${note.createdAt.slice(0,16)}"></div><div class="form-group"><label class="form-label">Nota</label><textarea class="form-input" id="edit-note-text" style="min-height:120px">${escapeHtml(note.text)}</textarea></div><div class="flex gap-8"><button type="button" class="btn btn-danger btn-block" data-action="deleteNote" data-note-id="${note.id}" id="delete-note-btn">🗑️ Eliminar</button><button type="submit" class="btn btn-primary btn-block" id="save-note-edit-btn">💾 Guardar Cambios</button></form></div></div></div>`;
}

export async function renderEditAnalysisModal(analysisId) {
  const analysis = await DB.getAnalysis(Number(analysisId));
  if (!analysis) return '';
  const result = analysis.result || {};
  const analysisText = JSON.stringify(result, null, 2);
  const typeMap = { plant: 'Análisis Planta', analyzer: 'Análisis Suelo', soil: 'Análisis Suelo' };
  const typeName = typeMap[analysis.type] || 'Análisis';
  return `<div class="modal-overlay" data-action="closeModal" id="edit-analysis-modal"><div class="modal-content"><div class="modal-handle"></div><div class="modal-title">✏️ Editar ${typeName}</div><form id="edit-analysis-form" data-analysis-id="${analysis.id}"><div class="form-group"><label class="form-label">Fecha</label><input class="form-input" type="datetime-local" id="edit-analysis-date" value="${analysis.createdAt.slice(0,16)}"></div><div class="form-group"><label class="form-label">Datos del Análisis (JSON)</label><textarea class="form-input" id="edit-analysis-data" style="min-height:200px;font-family:monospace;font-size:0.75rem">${escapeHtml(analysisText)}</textarea></div><div class="flex gap-8"><button type="button" class="btn btn-danger btn-block" data-action="deleteAnalysis" data-analysis-id="${analysis.id}" id="delete-analysis-btn">🗑️ Eliminar</button><button type="submit" class="btn btn-primary btn-block" id="save-analysis-edit-btn">💾 Guardar Cambios</button></form></div></div></div>`;
}

export async function renderEditDayModal(potId, dateKey) {
  const pot = await DB.getPot(Number(potId));
  const photos = await DB.getPhotosByPot(potId);
  const notes = await DB.getNotesByPot(potId);
  const analyses = await DB.getAnalysesByPot(potId);

  // Filter by date
  const dateStr = dateKey;
  const photosInDate = photos.filter(p => p.createdAt.startsWith(dateStr));
  const notesInDate = notes.filter(n => n.createdAt.startsWith(dateStr));
  const analysesInDate = analyses.filter(a => a.createdAt.startsWith(dateStr));

  let itemsHtml = '';

  // Photos
  for (const photo of photosInDate) {
    const url = await getPhotoURL(photo);
    itemsHtml += `<div style="background:var(--bg-secondary);padding:10px;border-radius:8px;border:1px solid var(--border-glass);margin-bottom:8px">
      <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:6px">📷 Foto - ${photo.type === 'analyzer' ? 'Suelo' : 'Planta'}</div>
      <img src="${url}" alt="Foto" style="width:100%;max-width:200px;border-radius:6px;margin-bottom:6px">
      <button type="button" class="btn btn-secondary btn-sm" data-action="editPhoto" data-photo-id="${photo.id}" onclick="event.preventDefault()">✏️ Editar</button>
    </div>`;
  }

  // Notes
  for (const note of notesInDate) {
    itemsHtml += `<div style="background:var(--bg-secondary);padding:10px;border-radius:8px;border:1px solid var(--border-glass);margin-bottom:8px">
      <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:6px">📝 Nota</div>
      <div style="font-size:0.85rem;color:var(--text-primary);margin-bottom:6px">${escapeHtml(note.text)}</div>
      <button type="button" class="btn btn-secondary btn-sm" data-action="editNote" data-note-id="${note.id}" onclick="event.preventDefault()">✏️ Editar</button>
    </div>`;
  }

  // Analyses
  for (const analysis of analysesInDate) {
    const r = analysis.result || {};
    let analysisInfo = `<div style="font-size:0.85rem;color:var(--text-primary);margin-bottom:6px">`;
    if (r.healthStatus) {
      const statusLabel = { healthy: 'Sana', warning: 'Atención', danger: 'Problema' };
      analysisInfo += `${statusLabel[r.healthStatus] || r.healthStatus}${r.healthScore ? ' (' + r.healthScore + '/10)' : ''}`;
    } else {
      analysisInfo += 'Análisis de Suelo';
    }
    analysisInfo += `</div>`;

    itemsHtml += `<div style="background:var(--bg-secondary);padding:10px;border-radius:8px;border:1px solid var(--border-glass);margin-bottom:8px">
      <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:6px">${analysis.type === 'plant' ? '🌿' : '📊'} Análisis</div>
      ${analysisInfo}
      <button type="button" class="btn btn-secondary btn-sm" data-action="editAnalysis" data-analysis-id="${analysis.id}" onclick="event.preventDefault()">✏️ Editar</button>
    </div>`;
  }

  return `<div class="modal-overlay" data-action="closeModal" id="edit-day-modal"><div class="modal-content" style="max-height:80vh;overflow-y:auto"><div class="modal-handle"></div><div class="modal-title">✏️ Editar ${formatDate(photosInDate[0]?.createdAt || notesInDate[0]?.createdAt || analysesInDate[0]?.createdAt)}</div>${itemsHtml || '<div class="empty-state">Sin items en este día</div>'}</div></div>`;
}

export async function renderEditPhotoModal(photoId) {
  const photo = await DB.getPhoto(Number(photoId));
  if (!photo) return '';
  const analysis = await DB.getAnalysisByPhoto(photo.id);
  const analysisText = analysis?.result ? JSON.stringify(analysis.result, null, 2) : '';
  return `<div class="modal-overlay" data-action="closeModal" id="edit-photo-modal"><div class="modal-content"><div class="modal-handle"></div><div class="modal-title">✏️ Editar Entrada</div><form id="edit-photo-form" data-photo-id="${photo.id}" data-analysis-id="${analysis?.id||''}"><div class="form-group"><label class="form-label">Fecha</label><input class="form-input" type="date" id="edit-date" value="${toInputDate(photo.createdAt)}"></div><div class="form-group"><label class="form-label">Notas del usuario</label><textarea class="form-input" id="edit-user-notes" placeholder="Tus observaciones...">${escapeHtml(photo.userNotes||'')}</textarea></div>${analysisText?`<div class="form-group"><label class="form-label">Análisis IA (editable)</label><textarea class="form-input" id="edit-analysis" style="min-height:160px;font-size:0.75rem;font-family:monospace">${escapeHtml(analysisText)}</textarea></div>`:''}<button type="submit" class="btn btn-primary btn-block" id="save-photo-edit-btn">💾 Guardar Cambios</button></form></div></div>`;
}

export async function renderPotScheduleModal(potId) {
  const pot = await DB.getPot(Number(potId));
  if (!pot) return '';
  const products = await DB.getAllProducts();
  const overrides = pot.scheduleOverrides || {};
  let rows = '';
  for (const p of products) {
    const val = overrides[p.slug] || '';
    rows += `<div class="schedule-row"><span class="schedule-icon">${escapeHtml(p.icon)}</span><span class="schedule-name">${escapeHtml(p.name)}</span><input class="schedule-input" type="number" min="1" max="365" placeholder="${escapeHtml(p.defaultFrequencyDays)}" value="${escapeHtml(val)}" data-slug="${escapeHtml(p.slug)}"><span class="schedule-unit">días</span></div>`;
  }
  return `<div class="modal-overlay" data-action="closeModal" id="schedule-modal"><div class="modal-content"><div class="modal-handle"></div><div class="modal-title">📅 Cronograma — ${pot.emoji||'🪴'} ${escapeHtml(pot.name)}</div><div class="section-subtitle">Deja vacío para usar la frecuencia global</div><form id="schedule-form" data-pot-id="${pot.id}">${rows}<button type="submit" class="btn btn-primary btn-block mt-16" id="save-schedule-btn">💾 Guardar</button></form></div></div>`;
}

// ===== LOGIN VIEW =====
export function renderLogin() {
  return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh;gap:20px;padding:32px;text-align:center">
    <div style="font-size:4rem">🌱</div>
    <h2 style="color:var(--text-primary);margin:0">GardenAI</h2>
    <p style="color:var(--text-muted);max-width:280px;margin:0;line-height:1.6;font-size:0.9rem">Tu jardín inteligente. Monitorea y analiza tus plantas con IA.</p>
    <div style="display:flex;flex-direction:column;gap:10px;width:100%;max-width:300px">
      <button class="btn btn-primary" data-action="login" style="padding:13px 28px;font-size:0.95rem">🔑 Continuar con Google</button>
      <div style="display:flex;align-items:center;gap:10px;color:var(--text-muted);font-size:0.75rem"><div style="flex:1;height:1px;background:var(--border-glass)"></div>o<div style="flex:1;height:1px;background:var(--border-glass)"></div></div>
      <button class="btn btn-secondary" data-action="showEmailLogin" style="padding:13px 28px;font-size:0.95rem">📧 Entrar con email</button>
      <button class="btn btn-secondary" data-action="showRegister" style="padding:13px 28px;font-size:0.95rem">✨ Crear cuenta nueva</button>
    </div>
  </div>`;
}

export function renderEmailLogin() {
  return `<div class="modal-overlay" data-action="closeModal" id="email-login-modal"><div class="modal-content"><div class="modal-handle"></div>
    <div class="modal-title">Iniciar sesión</div>
    <form id="email-login-form">
      <div class="form-group"><label class="form-label">Email</label><input class="form-input" type="email" id="login-email" placeholder="tu@email.com" required autocomplete="email"></div>
      <div class="form-group"><label class="form-label">Contraseña</label><input class="form-input" type="password" id="login-password" placeholder="Tu contraseña" required autocomplete="current-password"></div>
      <button type="submit" class="btn btn-primary btn-block" id="do-login-btn">Entrar</button>
      <button type="button" class="btn btn-secondary btn-block" style="margin-top:8px" data-action="forgotPassword">¿Olvidaste tu contraseña?</button>
      <button type="button" class="btn btn-secondary btn-block" style="margin-top:4px" data-action="showRegister">¿No tienes cuenta? Crear una</button>
    </form>
  </div></div>`;
}

export function renderRegister() {
  return `<div class="modal-overlay" data-action="closeModal" id="register-modal"><div class="modal-content"><div class="modal-handle"></div>
    <div class="modal-title">Crear cuenta</div>
    <form id="register-form">
      <div class="form-group"><label class="form-label">Nombre</label><input class="form-input" type="text" id="reg-name" placeholder="Tu nombre" autocomplete="name"></div>
      <div class="form-group"><label class="form-label">Email</label><input class="form-input" type="email" id="reg-email" placeholder="tu@email.com" required autocomplete="email"></div>
      <div class="form-group"><label class="form-label">Contraseña <span style="color:var(--text-muted);font-size:0.7rem">(mínimo 6 caracteres)</span></label><input class="form-input" type="password" id="reg-password" placeholder="Crea una contraseña" required minlength="6" autocomplete="new-password"></div>
      <div class="form-group"><label class="form-label">Confirmar contraseña</label><input class="form-input" type="password" id="reg-confirm" placeholder="Repite la contraseña" required autocomplete="new-password"></div>
      <button type="submit" class="btn btn-primary btn-block" id="do-register-btn">Crear cuenta</button>
      <button type="button" class="btn btn-secondary btn-block" style="margin-top:8px" data-action="showEmailLogin">¿Ya tienes cuenta? Entrar</button>
    </form>
  </div></div>`;
}

export function renderVerifyEmail(email) {
  return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh;gap:20px;padding:32px;text-align:center">
    <div style="font-size:4rem">📧</div>
    <h2 style="color:var(--text-primary);margin:0">Verifica tu email</h2>
    <div style="background:var(--bg-card);border:1px solid var(--border-glass);border-radius:var(--radius-lg);padding:20px;max-width:320px">
      <p style="color:var(--text-secondary);line-height:1.6;margin:0 0 8px;font-size:0.9rem">Enviamos un enlace de verificación a:</p>
      <p style="color:var(--accent);font-weight:600;margin:0;font-size:0.9rem">${escapeHtml(email)}</p>
    </div>
    <p style="color:var(--text-muted);font-size:0.8rem;max-width:280px;margin:0;line-height:1.5">Haz clic en el enlace del email para activar tu cuenta. Revisa también la carpeta de <strong>spam</strong>.</p>
    <div style="display:flex;flex-direction:column;gap:10px;width:100%;max-width:300px">
      <button class="btn btn-primary" data-action="checkVerification">✅ Ya verifiqué mi email</button>
      <button class="btn btn-secondary" data-action="resendVerification">📤 Reenviar email</button>
      <button class="btn btn-secondary" data-action="logout" style="margin-top:4px;color:var(--text-muted)">← Volver al inicio</button>
    </div>
  </div>`;
}

const ADMIN_UID = 'BagrWk9uOOWw7ywxbiUyjLlxN8s2'; // almeidar23@gmail.com

// ===== SETTINGS VIEW =====
export async function renderSettings() {
  const user = DB.getUser();
  const isAdmin = user?.uid === ADMIN_UID;
  const [providerRaw, geminiKeyRaw, groqKeyRaw, currentThemeRaw, globalCfg] = await Promise.all([
    DB.getSetting('aiProvider'),
    DB.getSetting('geminiApiKey'),
    DB.getSetting('groqApiKey'),
    DB.getSetting('theme'),
    isAdmin ? DB.getGlobalConfig() : Promise.resolve({})
  ]);
  const provider = providerRaw || 'gemini';
  const geminiKey = geminiKeyRaw || '';
  const groqKey = groqKeyRaw || '';
  const globalGroqKey = globalCfg.groqApiKey || '';
  const globalGeminiKey = globalCfg.geminiApiKey || '';

  const gMask = geminiKey ? geminiKey.slice(0,8)+'••••••••' : '';
  const rqMask = groqKey ? groqKey.slice(0,8)+'••••••••' : '';

  let adminSection = '';
  if (isAdmin) {
    const profiles = await DB.getAllUserProfiles();
    const rows = profiles.map(p => {
      const isMe = p.uid === ADMIN_UID;
      const lastLogin = new Date(p.lastLogin).toLocaleDateString('es', { day:'2-digit', month:'short', year:'numeric' });
      const providerIcon = p.provider === 'google.com' ? '🔵 Google' : '✉️ Email';
      return `<div class="admin-user-row">
        <div class="admin-user-info">
          <div class="admin-user-name">${escapeHtml(p.displayName || '(sin nombre)')} ${isMe ? '<span class="admin-badge">Admin</span>' : ''}</div>
          <div class="admin-user-email">${escapeHtml(p.email)}</div>
          <div class="admin-user-meta">${providerIcon} · Último acceso: ${lastLogin}</div>
        </div>
        ${!isMe ? `<button class="btn-icon-danger" data-action="adminDeleteUser" data-uid="${p.uid}" data-email="${escapeHtml(p.email)}" title="Borrar usuario">🗑️</button>` : ''}
      </div>`;
    }).join('');
    const gGMask = globalGeminiKey ? globalGeminiKey.slice(0,8)+'••••••••' : 'No configurada';
    const gRMask = globalGroqKey   ? globalGroqKey.slice(0,8)+'••••••••'   : 'No configurada';
    adminSection = `<div class="settings-section"><h3>🛡️ Administrador</h3>
      <div class="glass-card" style="margin-bottom:12px">
        <div style="font-size:0.85rem;font-weight:600;margin-bottom:10px">🌐 Claves globales (fallback para todos los usuarios)</div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:12px">Si un usuario no tiene su propia clave, se usa la clave global.</div>
        <div class="form-group"><label class="form-label" style="font-size:0.75rem">Groq API Key global <span style="color:var(--text-muted)">(actual: ${escapeHtml(gRMask)})</span></label>
          <input class="form-input" type="password" id="global-groq-key" placeholder="gsk_..." style="font-size:0.8rem"></div>
        <div class="form-group" style="margin-top:8px"><label class="form-label" style="font-size:0.75rem">Gemini API Key global <span style="color:var(--text-muted)">(actual: ${escapeHtml(gGMask)})</span></label>
          <input class="form-input" type="password" id="global-gemini-key" placeholder="AIzaSy..." style="font-size:0.8rem"></div>
        <button class="btn btn-primary btn-block" style="margin-top:8px" data-action="saveGlobalConfig">💾 Guardar claves globales</button>
      </div>
      <div class="glass-card">
        <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:12px">${profiles.length} usuario${profiles.length!==1?'s':''} registrado${profiles.length!==1?'s':''}</div>
        ${rows || '<div style="color:var(--text-muted);font-size:0.85rem">No hay otros usuarios registrados aún.</div>'}
        <button class="btn btn-secondary btn-block" style="margin-top:14px" data-action="reloadAdminUsers">↻ Actualizar lista</button>
      </div>
    </div>`;
  }

  // All users see at minimum a Groq key field; admin also sees provider + Gemini
  const aiSection = `
    <div class="settings-section"><h3>🤖 Inteligencia Artificial</h3><div class="glass-card">
      ${isAdmin ? `
      <div class="form-group"><label class="form-label" for="ai-provider">Proveedor</label>
        <select class="form-input" id="ai-provider" style="background:var(--bg-primary);border:1px solid var(--border-glass);color:var(--text-primary);padding:10px;border-radius:8px">
          <option value="gemini" ${provider==='gemini'?'selected':''}>Google Gemini (1.5 Flash)</option>
          <option value="groq" ${provider==='groq'?'selected':''}>Groq (Llama 3.2 Vision) - GRATIS</option>
        </select>
      </div>
      <div id="gemini-settings" style="display:${provider==='gemini'?'block':'none'};margin-top:16px;padding-top:16px;border-top:1px solid var(--border-glass)">
        <div class="form-group"><label class="form-label" for="gemini-key-input">API Key de Google Gemini</label><input class="form-input" type="password" id="gemini-key-input" placeholder="Ingresa tu API key" value="${escapeHtml(geminiKey)}">${gMask?`<div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px">Actual: ${gMask}</div>`:''}</div>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:10px;line-height:1.5;margin-bottom:12px">Obtén tu API key en <a href="https://aistudio.google.com/apikey" target="_blank" style="color:var(--accent)">Google AI Studio</a>.</div>
      </div>` : ''}
      <div id="groq-settings" style="${isAdmin?`display:${provider==='groq'?'block':'none'};`:''}margin-top:${isAdmin?'16':'0'}px;${isAdmin?'padding-top:16px;border-top:1px solid var(--border-glass)':''}">
        <div class="form-group"><label class="form-label" for="groq-key-input">API Key de Groq${!isAdmin?' (tu clave personal)':''}</label><input class="form-input" type="password" id="groq-key-input" placeholder="gsk_..." value="${escapeHtml(groqKey)}">${rqMask?`<div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px">Actual: ${rqMask} <button data-action="clearGroqKey" style="background:none;border:none;color:var(--text-danger,#ef4444);cursor:pointer;font-size:0.7rem;padding:0 4px;vertical-align:middle">✕ Borrar</button></div>`:''}</div>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:6px;line-height:1.5;margin-bottom:12px">Gratis en <a href="https://console.groq.com/keys" target="_blank" style="color:var(--accent)">console.groq.com/keys</a>. No requiere tarjeta.</div>
      </div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="btn btn-primary" style="flex:1" data-action="saveAiSettings" id="save-ai-btn">💾 Guardar</button>
        <button class="btn btn-secondary" style="flex:1" data-action="testAiKey" id="test-ai-btn">🔍 Probar clave</button>
      </div>
      <div id="ai-test-result" style="margin-top:10px;font-size:0.75rem;display:none"></div>
    </div></div>`;

  const currentTheme = currentThemeRaw || 'dark';

  return `<div class="settings-section"><div class="glass-card" style="margin-top:0">
      <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:10px">🎨 Tema actual</div>
      <div class="theme-picker">
        <button class="theme-option ${currentTheme==='dark'?'active':''}" data-action="setTheme" data-theme="dark">
          <span class="theme-dot theme-dot-dark"></span>
          <span>Nocturno</span>
        </button>
        <button class="theme-option ${currentTheme==='botanical'?'active':''}" data-action="setTheme" data-theme="botanical">
          <span class="theme-dot theme-dot-botanical"></span>
          <span>Botanical</span>
        </button>
        <button class="theme-option ${currentTheme==='tropical'?'active':''}" data-action="setTheme" data-theme="tropical">
          <span class="theme-dot theme-dot-tropical"></span>
          <span>Tropical</span>
        </button>
        <button class="theme-option ${currentTheme==='wellness'?'active':''}" data-action="setTheme" data-theme="wellness">
          <span class="theme-dot theme-dot-wellness"></span>
          <span>Wellness</span>
        </button>
      </div>
    </div></div>
    ${aiSection}
    <div class="settings-section"><h3>📦 Datos</h3><div class="glass-card"><div class="btn-group" style="flex-direction:column"><button class="btn btn-secondary btn-block" data-action="exportData" id="export-data-btn">📤 Exportar Datos</button><label class="btn btn-secondary btn-block" style="cursor:pointer;text-align:center;margin:0">📥 Importar Datos<input type="file" id="import-file-input" accept=".json" style="display:none"></label><button class="btn btn-danger btn-block" data-action="clearData" id="clear-data-btn">🗑️ Borrar Todos los Datos</button></div></div></div>
    ${adminSection}
    <div class="settings-section"><h3>👤 Cuenta</h3><div class="glass-card"><div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px">${escapeHtml(user?.displayName || '')} <span style="color:var(--text-muted)">${escapeHtml(user?.email || '')}</span></div><button class="btn btn-danger btn-block" data-action="logout" id="logout-btn">Cerrar sesión</button></div></div>
    <div class="settings-section"><h3>ℹ️ Acerca de</h3><div class="glass-card"><div style="font-size:0.8rem;color:var(--text-secondary);line-height:1.6"><strong>GardenAI</strong> v2.0<br>Gestión inteligente de tu jardín con IA.<br>Datos sincronizados en la nube.</div></div></div>`;
}

// ===== PRODUCT MODAL =====
export function renderProductModal(product = null) {
  const isEdit = !!product;
  const icon = product?.icon || '🌿';
  let ep = '<div class="emoji-grid" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">';
  for (const e of PRODUCT_EMOJIS) {
    const sel = e === icon ? 'border-color:var(--accent);background:var(--accent-glow)' : '';
    ep += `<button type="button" class="emoji-pick" data-emoji="${e}" style="font-size:1.4rem;padding:6px;border-radius:8px;border:2px solid var(--border-glass);${sel};cursor:pointer;background:var(--bg-secondary)">${e}</button>`;
  }
  ep += '</div>';
  return `<div class="modal-overlay" data-action="closeModal" id="product-modal">
    <div class="modal-content">
      <div class="modal-handle"></div>
      <div class="modal-title">${isEdit ? 'Editar Producto' : 'Nuevo Producto'}</div>
      <form id="product-modal-form" data-slug="${product?.slug || ''}">
        <div class="form-group"><label class="form-label">Icono</label>${ep}<input type="hidden" id="product-modal-icon" value="${icon}"></div>
        <div class="form-group"><label class="form-label">Nombre</label><input class="form-input" type="text" id="product-modal-name" value="${escapeHtml(product?.name||'')}" placeholder="Ej: Fungicida" required></div>
        <div class="form-group"><label class="form-label">Frecuencia global (días)</label><input class="form-input" type="number" id="product-modal-freq" min="1" max="365" value="${product?.defaultFrequencyDays||7}"></div>
        <div class="form-group"><label class="form-label">Notas</label><textarea class="form-input" id="product-modal-notes" placeholder="Descripción, dosis, observaciones...">${escapeHtml(product?.notes||'')}</textarea></div>
        <div class="btn-group">
          <button type="submit" class="btn btn-primary btn-block" id="save-product-modal-btn">${isEdit ? '💾 Guardar' : '➕ Crear'}</button>
          ${isEdit ? `<button type="button" class="btn btn-danger" data-action="deleteProductFromModal" data-slug="${product.slug}" id="delete-product-modal-btn">🗑️</button>` : ''}
        </div>
      </form>
    </div>
  </div>`;
}

export function renderBulkPotTaskModal(products, potCount) {
  let list = '';
  for (const p of products) {
    list += `<button class="btn btn-secondary btn-block" data-action="confirmBulkPotTask" data-slug="${escapeHtml(p.slug)}" style="justify-content:flex-start;gap:12px">
      <span style="font-size:1.3rem">${escapeHtml(p.icon)}</span>
      <span style="flex:1;text-align:left">${escapeHtml(p.name)}</span>
      <span style="color:var(--text-muted);font-size:0.72rem">c/${escapeHtml(p.defaultFrequencyDays)} días</span>
    </button>`;
  }
  return `<div class="modal-overlay" data-action="closeModal" id="bulk-pot-task-modal">
    <div class="modal-content">
      <div class="modal-handle"></div>
      <div class="modal-title">📋 Aplicar a ${potCount} maceta${potCount!==1?'s':''}</div>
      <div class="section-subtitle">¿Qué aplicaste hoy?</div>
      <button class="btn btn-secondary btn-block" data-action="bulkPotNote" style="justify-content:flex-start;gap:12px;margin-bottom:4px;border-color:rgba(45,212,168,0.35)">
        <span style="font-size:1.3rem">📝</span>
        <span style="flex:1;text-align:left">Agregar Nota</span>
      </button>
      <div style="border-top:1px solid var(--border-glass);margin:8px 0"></div>
      <div class="flex flex-col gap-8">${list}</div>
    </div>
  </div>`;
}

export function renderBulkApplyProductModal(products, potCount, recommendedSlugs = [], mode = 'recommend') {
  const isExecute = mode === 'execute';
  const confirmAction = isExecute ? 'confirmBulkExecuteProduct' : 'confirmBulkRecommendProduct';
  const title = isExecute ? '⚡ Ejecutar producto' : '⭐ Recomendar producto';
  const subtitle = isExecute
    ? `Aplicar hoy a ${potCount} maceta${potCount!==1?'s':''} — el contador de próxima vez empieza desde hoy`
    : `Recomendar producto a ${potCount} maceta${potCount!==1?'s':''}`;
  let list = '';
  if (products.length === 0) {
    list = `<div style="color:var(--text-muted);padding:20px;text-align:center;font-size:0.85rem">No hay productos disponibles. <a href="#products" style="color:var(--accent)">Crear uno</a></div>`;
  } else {
    for (const p of products) {
      const isRecommended = recommendedSlugs.includes(p.slug);
      const recommendedLabel = isRecommended ? `<span style="color:var(--text-muted);font-size:0.72rem;font-weight:500">Recomendado</span>` : '';
      list += `<button class="btn btn-secondary btn-block" data-action="${confirmAction}" data-product-slug="${escapeHtml(p.slug)}" style="justify-content:flex-start;gap:12px">
        <span style="font-size:1.3rem">${escapeHtml(p.icon)}</span>
        <span style="flex:1;text-align:left">
          <div>${escapeHtml(p.name)}</div>
          ${recommendedLabel}
        </span>
        <span style="color:var(--text-muted);font-size:0.72rem">c/${escapeHtml(p.defaultFrequencyDays)} días</span>
      </button>`;
    }
  }
  return `<div class="modal-overlay" data-action="closeModal" id="bulk-apply-product-modal">
    <div class="modal-content">
      <div class="modal-handle"></div>
      <div class="modal-title">${title}</div>
      <div class="section-subtitle">${subtitle}</div>
      <div style="display:flex;flex-direction:column;gap:8px">${list}</div>
    </div>
  </div>`;
}

// ===== BULK MODALS =====
export function renderBulkDateModal(count) {
  const today = new Date().toISOString().slice(0,10);
  return `<div class="modal-overlay" data-action="closeModal" id="bulk-date-modal"><div class="modal-content"><div class="modal-handle"></div><div class="modal-title">📅 Cambiar Fecha</div><div class="section-subtitle">Se aplicará a ${count} foto${count!==1?'s':''} seleccionada${count!==1?'s':''}</div><div class="form-group"><label class="form-label">Nueva fecha</label><input class="form-input" type="date" id="bulk-date-input" value="${today}"></div><button class="btn btn-primary btn-block" data-action="confirmBulkDate" id="confirm-bulk-date-btn">✅ Aplicar</button></div></div>`;
}

export function renderBulkNotesModal(count) {
  return `<div class="modal-overlay" data-action="closeModal" id="bulk-notes-modal"><div class="modal-content"><div class="modal-handle"></div><div class="modal-title">📝 Agregar Notas</div><div class="section-subtitle">Se aplicará a ${count} foto${count!==1?'s':''} seleccionada${count!==1?'s':''}</div><div class="form-group"><label class="form-label">Notas</label><textarea class="form-input" id="bulk-notes-input" placeholder="Tus observaciones..." style="min-height:100px"></textarea></div><button class="btn btn-primary btn-block" data-action="confirmBulkNotes" id="confirm-bulk-notes-btn">✅ Aplicar</button></div></div>`;
}

export function renderBulkPotNoteModal(potCount) {
  return `<div class="modal-overlay" data-action="closeModal" id="bulk-pot-note-modal"><div class="modal-content"><div class="modal-handle"></div><div class="modal-title">📝 Agregar Nota</div><div class="section-subtitle">Se guardará en ${potCount} maceta${potCount!==1?'s':''} seleccionada${potCount!==1?'s':''}</div><div class="form-group" style="margin-top:12px"><textarea class="form-input" id="bulk-pot-note-input" placeholder="Escribe tus observaciones..." style="min-height:120px"></textarea></div><div class="flex gap-8"><button class="btn btn-secondary btn-block" data-action="closeModal">Cancelar</button><button class="btn btn-primary btn-block" data-action="confirmBulkPotNote" id="confirm-bulk-pot-note-btn">💾 Guardar</button></div></div></div>`;
}

// ===== CALENDAR =====
export function generateMonthlyCalendar(initialDate) {
  const date = new Date(initialDate + 'T12:00:00');
  const year = date.getFullYear();
  const month = date.getMonth();
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const selectedKey = initialDate;

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  let html = `<div class="calendar-wrapper" data-year="${year}" data-month="${month}">`;
  html += `<div class="calendar-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px">`;
  html += `<button class="btn btn-sm" data-action="calendarPrevMonth" style="flex:0;padding:4px 8px;font-size:0.8rem">←</button>`;
  html += `<div style="flex:1;text-align:center;font-weight:600">${monthNames[month]} ${year}</div>`;
  html += `<button class="btn btn-sm" data-action="calendarNextMonth" style="flex:0;padding:4px 8px;font-size:0.8rem">→</button>`;
  html += `</div>`;

  html += `<div class="calendar-weekdays" style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:8px">`;
  for (let i = 0; i < 7; i++) {
    html += `<div style="text-align:center;font-size:0.75rem;font-weight:600;color:var(--text-muted);padding:4px">${dayNames[i]}</div>`;
  }
  html += `</div>`;

  html += `<div class="calendar-days" style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">`;

  for (let i = 0; i < startingDayOfWeek; i++) {
    html += `<div style="padding:8px"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dayDate = new Date(year, month, day);
    const dayKey = dayDate.toISOString().slice(0, 10);
    const isSelected = dayKey === selectedKey;
    const isToday = dayKey === todayKey;
    const bgColor = isSelected ? 'var(--accent)' : 'transparent';
    const textColor = isSelected ? '#fff' : 'var(--text-primary)';
    const decoration = isToday && !isSelected ? '2px solid var(--accent)' : 'none';

    html += `<button class="calendar-day" data-action="selectCalendarDay" data-date="${dayKey}"
      style="padding:8px;border-radius:4px;background-color:${bgColor};color:${textColor};border:${decoration};cursor:pointer;font-weight:${isSelected?'600':'400'};font-size:0.9rem">${day}</button>`;
  }

  html += `</div>`;
  html += `<input type="hidden" id="selected-date" value="${selectedKey}">`;
  html += `</div>`;
  return html;
}

export function renderProductDateModal(potId, productSlug, lastDate) {
  return `<div class="modal-overlay" data-action="closeModal">
    <div class="modal-content">
      <div class="modal-handle"></div>
      <div class="modal-title">📅 Cambiar fecha de aplicación</div>
      <div class="section-subtitle" style="margin-bottom:12px">La frecuencia se mantiene, cambia el día base</div>
      <div style="overflow-y:auto;max-height:60vh;padding-right:8px">
        ${generateMonthlyCalendar(lastDate)}
      </div>
      <button class="btn btn-primary btn-block" data-action="saveProductDate" data-pot-id="${potId}" data-product-slug="${productSlug}" style="margin-top:12px">💾 Guardar</button>
    </div>
  </div>`;
}

// ===== STATS VIEW =====
// ---- shared stats data builder ----
async function buildStatsData() {
  const pots = await DB.getAllPots();
  const potMap = {};
  pots.forEach(pot => { potMap[pot.id] = pot; });

  const [photosArr, notesArr, analysesArr, taskLogs, products] = await Promise.all([
    Promise.all(pots.map(p => DB.getPhotosByPot(p.id))),
    Promise.all(pots.map(p => DB.getNotesByPot(p.id))),
    Promise.all(pots.map(p => DB.getAnalysesByPot(p.id))),
    DB.getTaskLogsByPots(pots.map(p => p.id)),
    DB.getAllProducts()
  ]);

  const productMap = {};
  products.forEach(pr => { productMap[pr.slug] = pr; });

  const allItems = [];
  photosArr.forEach((photos, i) => photos.forEach(p => allItems.push({ type: 'photo',   date: p.createdAt,  potId: pots[i].id, data: p })));
  notesArr.forEach((notes, i)   => notes.forEach(n  => allItems.push({ type: 'note',    date: n.createdAt,  potId: pots[i].id, data: n })));
  analysesArr.forEach((anals,i) => anals.forEach(a  => allItems.push({ type: 'analysis',date: a.createdAt,  potId: pots[i].id, data: a })));
  taskLogs.forEach(tl => allItems.push({ type: 'tasklog', date: tl.appliedAt, potId: tl.potId, data: tl }));

  const groups = {};
  for (const item of allItems) {
    const k = dateKey(item.date);
    if (!groups[k]) groups[k] = [];
    groups[k].push(item);
  }
  return { pots, potMap, productMap, groups };
}

function taskIcon(slug, productName) {
  const s = (slug + ' ' + productName).toLowerCase();
  if (/riego|agua|water|reg/.test(s))        return { icon: '💧', label: 'Riego',       color: '#3b82f6' };
  if (/tierra|remuev|afloj|soil/.test(s))    return { icon: '🌱', label: 'Tierra',      color: '#a16207' };
  if (/fertiliz|abono|nutri|fertil/.test(s)) return { icon: '🌿', label: 'Fertilizante',color: '#16a34a' };
  if (/poda|prune|recort/.test(s))           return { icon: '✂️', label: 'Poda',         color: '#9333ea' };
  if (/pesticid|plaga|insect|fungic/.test(s))return { icon: '🐛', label: 'Tratamiento', color: '#dc2626' };
  return { icon: '✅', label: 'Tarea', color: '#64748b' };
}

export async function renderStats() {
  const { pots, potMap, productMap, groups } = await buildStatsData();
  if (!pots.length) return `<div class="empty-state"><div class="empty-icon">📊</div><p>Agrega macetas para ver las estadísticas de tu jardín.</p></div>`;

  // Preload thumbnails for pots
  const allPotsPhotos = await Promise.all(pots.map(p => DB.getPhotosByPot(p.id)));
  const potThumb = {};
  await Promise.all(pots.map(async (pot, i) => {
    const photos = allPotsPhotos[i];
    if (!photos.length) return;
    const main = pot.mainPhotoId ? (photos.find(p => p.id === pot.mainPhotoId) || photos[0]) : photos[0];
    if (main.blob || main.storageUrl || main.imageData) {
      potThumb[pot.id] = await getPhotoURL(main);
    }
  }));

  const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
  let content = '';

  for (const dk of sortedDates) {
    const dayItems = groups[dk];

    // --- collect data per category ---
    const healthPots  = { healthy: new Set(), warning: new Set(), danger: new Set() };
    const taskPots    = {};
    const photoPotIds = new Set();
    const notePotIds  = new Set();
    const activePotIds = new Set();

    for (const item of dayItems) {
      activePotIds.add(item.potId);
      if (item.type === 'photo') photoPotIds.add(item.potId);
      if (item.type === 'note')  notePotIds.add(item.potId);
      if (item.type === 'analysis' && item.data.type === 'plant') {
        const hs = item.data.result?.healthStatus;
        if (hs === 'healthy') healthPots.healthy.add(item.potId);
        else if (hs === 'warning') healthPots.warning.add(item.potId);
        else if (hs === 'danger')  healthPots.danger.add(item.potId);
      }
      if (item.type === 'tasklog') {
        const slug = item.data.productSlug;
        const t = taskIcon(slug, productMap[slug]?.name || slug);
        if (!taskPots[t.icon]) taskPots[t.icon] = { ...t, potIds: new Set() };
        taskPots[t.icon].potIds.add(item.potId);
      }
    }

    // --- unified tile builder ---
    // Action tile (modal on tap)
    function actionTile(icon, label, color, potIds) {
      const ids   = [...potIds].join(',');
      const count = potIds.size;
      return `<button class="stats-tile" style="--tile-color:${color}"
          data-action="statsChipDetail"
          data-icon="${escapeHtml(icon)}"
          data-label="${escapeHtml(label)}"
          data-color="${escapeHtml(color)}"
          data-pot-ids="${ids}">
        <div class="stats-tile-box">
          <span class="stats-tile-icon">${icon}</span>
          <span class="stats-tile-count">×${count}</span>
        </div>
        <span class="stats-tile-name">${escapeHtml(label)}</span>
      </button>`;
    }

    // Pot tile (navigate on tap)
    function potTile(pid) {
      const pot   = potMap[pid];
      if (!pot) return '';
      const thumb = potThumb[pid];
      const inner = thumb
        ? `<div class="stats-tile-box stats-tile-photo" style="background-image:url('${thumb}')"></div>`
        : `<div class="stats-tile-box" style="--tile-color:#2dd4a8"><span class="stats-tile-icon">${pot.emoji || '🪴'}</span></div>`;
      return `<button class="stats-tile" data-navigate="pot/${pid}">
        ${inner}
        <span class="stats-tile-name">${escapeHtml(pot.name)}</span>
      </button>`;
    }

    // Build grid: health → tasks → photos/notes → pots
    let tilesHtml = '';
    if (healthPots.healthy.size) tilesHtml += actionTile('🟢', 'Sanas',     '#16a34a', healthPots.healthy);
    if (healthPots.warning.size) tilesHtml += actionTile('🟡', 'Atención',  '#ca8a04', healthPots.warning);
    if (healthPots.danger.size)  tilesHtml += actionTile('🔴', 'Problema',  '#dc2626', healthPots.danger);
    for (const t of Object.values(taskPots)) tilesHtml += actionTile(t.icon, t.label, t.color, t.potIds);
    if (photoPotIds.size) tilesHtml += actionTile('📷', 'Fotos',  '#6366f1', photoPotIds);
    if (notePotIds.size)  tilesHtml += actionTile('📝', 'Notas',  '#0891b2', notePotIds);
    for (const pid of activePotIds) tilesHtml += potTile(pid);

    // --- date label ---
    const d = new Date(dk + 'T12:00:00');
    const weekday = d.toLocaleDateString('es', { weekday: 'short' }).replace('.','');
    const dayNum  = d.getDate();
    const month   = d.toLocaleDateString('es', { month: 'short' }).replace('.','');

    content += `
    <div class="stats-day-row">
      <div class="stats-day-date">
        <span class="stats-day-weekday">${weekday}</span>
        <span class="stats-day-num">${dayNum}</span>
        <span class="stats-day-month">${month}</span>
      </div>
      <div class="stats-day-dot"></div>
      <div class="stats-day-body glass-card">
        <div class="stats-tile-grid">${tilesHtml}</div>
        <button class="stats-day-detail-btn" data-navigate="stats-day/${dk}">Ver detalle →</button>
      </div>
    </div>`;
  }

  const timelineHtml = content
    ? `<div class="stats-timeline">${content}</div>`
    : `<div class="empty-state"><p>No hay actividad aún. ¡Comenzá a documentar tu jardín!</p></div>`;

  return `<div class="flex items-center justify-between mb-6"><div class="section-subtitle">${sortedDates.length} día${sortedDates.length !== 1 ? 's' : ''} con actividad</div></div>${timelineHtml}`;
}

export async function renderStatsDayDetail(dateKey) {
  const { pots, potMap, productMap, groups } = await buildStatsData();
  const dayItems = groups[dateKey] || [];
  if (!dayItems.length) return `<div class="empty-state"><p>Sin actividad este día.</p></div>`;

  // Group items by pot
  const byPot = {};
  for (const item of dayItems) {
    if (!byPot[item.potId]) byPot[item.potId] = [];
    byPot[item.potId].push(item);
  }

  // Pot thumbnails
  const allPhotos = await Promise.all(pots.map(p => DB.getPhotosByPot(p.id)));
  const potThumb = {};
  await Promise.all(pots.map(async (pot, i) => {
    const photos = allPhotos[i];
    if (!photos.length) return;
    const main = pot.mainPhotoId ? (photos.find(p => p.id === pot.mainPhotoId) || photos[0]) : photos[0];
    if (main.blob || main.storageUrl || main.imageData) potThumb[pot.id] = await getPhotoURL(main);
  }));

  let content = '';
  for (const [potId, items] of Object.entries(byPot)) {
    const pot = potMap[potId];
    if (!pot) continue;
    const thumb = potThumb[potId];
    const avatarHtml = thumb
      ? `<img class="stats-detail-pot-thumb" src="${thumb}" alt="">`
      : `<div class="stats-detail-pot-thumb stats-detail-pot-emoji">${pot.emoji || '🪴'}</div>`;

    let rows = '';
    for (const item of items) {
      if (item.type === 'photo') {
        const url = item.data.blob || item.data.storageUrl || item.data.imageData ? await getPhotoURL(item.data) : null;
        if (url) rows += `<img class="stats-detail-photo" src="${url}" alt="foto">`;
      }
      if (item.type === 'analysis' && item.data.type === 'plant' && item.data.result) {
        const r = item.data.result;
        const hs = r.healthStatus;
        const badge = hs === 'healthy' ? '🟢 Sana' : hs === 'warning' ? '🟡 Atención' : '🔴 Problema';
        const score = r.healthScore ? ` · ${r.healthScore}/10` : '';
        rows += `<div class="stats-detail-analysis"><span class="stats-detail-badge">${badge}${score}</span>${r.summary ? `<p class="stats-detail-summary">${escapeHtml(r.summary)}</p>` : ''}</div>`;
      }
      if (item.type === 'tasklog') {
        const t = taskIcon(item.data.productSlug, productMap[item.data.productSlug]?.name || item.data.productSlug);
        const prodName = productMap[item.data.productSlug]?.name || item.data.productSlug;
        rows += `<div class="stats-detail-task"><span>${t.icon}</span><span>${escapeHtml(prodName)}</span></div>`;
      }
      if (item.type === 'note') {
        rows += `<div class="stats-detail-note">📝 <span>${escapeHtml(item.data.text)}</span></div>`;
      }
    }

    content += `<div class="glass-card stats-detail-pot-card">
      <div class="stats-detail-pot-header">
        ${avatarHtml}
        <span class="stats-detail-pot-name">${escapeHtml(pot.name)}</span>
        <button class="btn btn-sm btn-secondary" data-navigate="pot/${pot.id}" style="margin-left:auto;font-size:0.75rem;padding:4px 10px">Ver maceta →</button>
      </div>
      <div class="stats-detail-rows">${rows}</div>
    </div>`;
  }

  return content || `<div class="empty-state"><p>Sin actividad este día.</p></div>`;
}

// ===== STATS CHIP MODAL =====
export async function renderStatsChipModal(icon, label, color, potIds) {
  const pots = await DB.getAllPots();
  const potMap = {};
  pots.forEach(p => { potMap[p.id] = p; });

  // load thumbnails
  const thumbMap = {};
  await Promise.all(potIds.map(async id => {
    const pot = potMap[id];
    if (!pot) return;
    const photos = await DB.getPhotosByPot(id);
    if (!photos.length) return;
    const main = pot.mainPhotoId ? (photos.find(p => p.id === pot.mainPhotoId) || photos[0]) : photos[0];
    if (main.blob || main.storageUrl || main.imageData) thumbMap[id] = await getPhotoURL(main);
  }));

  const rows = potIds.map(id => {
    const pot = potMap[id];
    if (!pot) return '';
    const thumb = thumbMap[id];
    const avatar = thumb
      ? `<img style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid var(--border-glass);flex-shrink:0" src="${thumb}" alt="">`
      : `<div style="width:44px;height:44px;border-radius:50%;background:var(--bg-secondary);border:2px solid var(--border-glass);display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0">${pot.emoji || '🪴'}</div>`;
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border-glass)" data-navigate="pot/${pot.id}">
      ${avatar}
      <span style="font-weight:600;font-size:0.95rem;flex:1;color:var(--text-primary)">${escapeHtml(pot.name)}</span>
      <span style="font-size:0.8rem;color:var(--accent);font-weight:600">Ver →</span>
    </div>`;
  }).join('');

  return `<div class="modal-overlay" data-action="closeModal" id="chip-detail-modal">
    <div class="modal-content">
      <div class="modal-handle"></div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <span style="font-size:2rem">${icon}</span>
        <div>
          <div style="font-weight:700;font-size:1.1rem;color:var(--text-primary)">${escapeHtml(label)}</div>
          <div style="font-size:0.8rem;color:var(--text-muted)">${potIds.length} maceta${potIds.length !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <div style="margin-bottom:16px">${rows}</div>
      <button class="btn btn-secondary btn-block" data-action="closeModal">Cerrar</button>
    </div>
  </div>`;
}

// ===== AGREGAR PLANTA =====

export function renderAddPlantSourceModal() {
  return `<div class="modal-overlay" data-action="closeModal" id="add-plant-modal"><div class="modal-content"><div class="modal-handle"></div><div class="modal-title">🌱 Nueva Planta</div><div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:16px;text-align:center">Tomá una foto para que la IA identifique la planta y recomiende la mejor maceta</div><div class="flex flex-col gap-8" style="margin-top:4px"><button class="btn btn-secondary btn-block" data-action="captureNewPlant">📸 Tomar Foto</button><button class="btn btn-secondary btn-block" data-action="uploadNewPlant">🖼️ Subir desde el dispositivo</button></div></div></div>`;
}

export function renderPlantLoadingModal(message) {
  return `<div class="modal-overlay" id="plant-loading-modal"><div class="modal-content" style="text-align:center;padding:32px 24px"><div style="font-size:2.5rem;margin-bottom:16px;animation:pulse 1.4s ease-in-out infinite">🌿</div><div style="font-weight:600;font-size:1rem;color:var(--text-primary);margin-bottom:8px">${escapeHtml(message)}</div><div style="font-size:0.8rem;color:var(--text-muted)">Esto puede tomar unos segundos...</div></div></div>`;
}

export function renderPlantRecommendationsModal(plant, recs, pots) {
  const plantName = plant.plantType || 'Planta identificada';
  const labelColor = { 'Excelente': '#16a34a', 'Buena': '#65a30d', 'Aceptable': '#ca8a04', 'No recomendada': '#dc2626' };

  // Key requirements as chips
  const reqChips = [];
  if (plant.sunRequirements)   reqChips.push(`☀️ ${plant.sunRequirements}`);
  if (plant.waterRequirements) reqChips.push(`💧 ${plant.waterRequirements}`);
  const reqHtml = reqChips.map(r =>
    `<span style="background:var(--bg-secondary);border:1px solid var(--border-glass);border-radius:20px;padding:4px 10px;font-size:0.75rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${escapeHtml(r)}</span>`
  ).join('');

  // Top pick (#1)
  const top = recs[0];
  const topPot = top ? pots[top.potIndex] : null;
  const topColor = top ? (labelColor[top.label] || '#16a34a') : '#16a34a';
  const topHtml = topPot ? `
    <div style="background:color-mix(in srgb,${topColor} 10%,var(--bg-secondary));border:2px solid color-mix(in srgb,${topColor} 40%,transparent);border-radius:16px;padding:16px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:1.4rem">${escapeHtml(topPot.emoji||'🪴')}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:1rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(topPot.name)}</div>
          <div style="font-size:0.72rem;font-weight:700;color:${topColor}">${escapeHtml(top.label||'')} · ${top.score}/10</div>
        </div>
      </div>
      <p style="font-size:0.82rem;color:var(--text-muted);line-height:1.5;margin:0 0 14px;word-break:break-word">${escapeHtml(top.reason||'')}</p>
      <button class="btn btn-primary btn-block" data-action="plantInPot" data-pot-id="${topPot.id}" style="font-size:0.9rem">🌱 Plantar aquí</button>
    </div>` : '';

  // Rest (compact rows, no reason text)
  const restHtml = recs.slice(1).map(rec => {
    const pot = pots[rec.potIndex];
    if (!pot) return '';
    const color = labelColor[rec.label] || 'var(--text-muted)';
    return `<button class="btn btn-secondary btn-block" data-action="plantInPot" data-pot-id="${pot.id}"
      style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:12px;text-align:left">
      <span style="font-size:1.1rem;flex-shrink:0">${escapeHtml(pot.emoji||'🪴')}</span>
      <span style="font-weight:600;font-size:0.88rem;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-primary)">${escapeHtml(pot.name)}</span>
      <span style="font-size:0.72rem;font-weight:700;color:${color};white-space:nowrap;flex-shrink:0">${escapeHtml(rec.label||'')}</span>
    </button>`;
  }).join('');

  const moreSection = restHtml ? `
    <details style="margin-bottom:8px">
      <summary style="font-size:0.8rem;color:var(--accent);font-weight:600;cursor:pointer;list-style:none;padding:6px 0">
        ＋ Más opciones
      </summary>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">${restHtml}</div>
    </details>` : '';

  const tip = plant._tip ? `<div style="background:var(--bg-secondary);border:1px solid var(--border-glass);border-radius:12px;padding:10px 14px;font-size:0.8rem;color:var(--text-muted);word-break:break-word">💡 ${escapeHtml(plant._tip)}</div>` : '';

  return `<div class="modal-overlay" data-action="closeModal" id="plant-recs-modal">
  <div class="modal-content" style="max-height:88vh;overflow-y:auto">
    <div class="modal-handle"></div>
    <div class="modal-title" style="margin-bottom:8px">🌱 ${escapeHtml(plantName)}</div>
    ${reqHtml ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">${reqHtml}</div>` : ''}
    <div style="font-size:0.72rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:10px">Mejor maceta</div>
    ${topHtml}
    ${moreSection}
    ${tip}
    <button class="btn btn-secondary btn-block" data-action="closeModal" style="margin-top:10px">Cancelar</button>
  </div></div>`;
}

// ===== TOAST =====
export function showToast(message, duration = 3000) {
  let toast = document.getElementById('app-toast');
  if (!toast) { toast = document.createElement('div'); toast.id = 'app-toast'; toast.className = 'toast'; document.body.appendChild(toast); }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), duration);
}
