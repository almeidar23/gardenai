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
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function toInputDate(iso) { return iso ? iso.slice(0,10) : ''; }

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
  // Precompute all thumb URLs in parallel
  const thumbUrls = await Promise.all(pots.map((pot, i) => {
    const photos = photosArr[i];
    return (photos.length > 0 && (photos[0].blob || photos[0].storageUrl || photos[0].imageData))
      ? getPhotoURL(photos[0]) : Promise.resolve(null);
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
    potsHtml += `<div class="glass-card pot-card" data-navigate="pot/${pot.id}" id="pot-card-${pot.id}">
      <div class="pot-top-bar">${statusHtml}<div class="pot-count">${photos.length} foto${photos.length!==1?'s':''}</div></div>
      ${thumbHtml}
      <div class="pot-name">${escapeHtml(pot.name)}</div>${plantTypeHtml}
    </div>`;
  }
  potsHtml += `<div class="glass-card pot-card pot-card-add" data-action="addPot" id="add-pot-btn"><div class="pot-icon">＋</div><div class="pot-name">Agregar</div></div>`;
  return `<div class="flex items-center justify-between mb-8"><div class="section-title">Mis Macetas</div><button class="btn btn-icon btn-secondary" data-action="enterPotSelectMode" id="pot-select-mode-btn" title="Seleccionar macetas">✅</button></div>
    <div class="section-subtitle">${pots.length} maceta${pots.length!==1?'s':''}</div>
    <div class="pots-grid" id="pots-grid">${potsHtml}</div>`;
}

// ===== POT DETAIL VIEW =====
export async function renderPot(potId) {
  const pot = await DB.getPot(Number(potId));
  if (!pot) return '<div class="empty-state"><div class="empty-icon">❓</div><p>Maceta no encontrada</p></div>';
  const photos = await DB.getPhotosByPot(pot.id);
  const analyses = await DB.getAnalysesByPot(pot.id);
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
  if (photos.length === 0) {
    content = `<div class="empty-state"><div class="empty-icon">📷</div><p>Aún no hay fotos. Toma una foto de tu planta o del analizador de suelo.</p></div>`;
  } else {
    // Fetch all photo URLs and analyses in parallel
    const [photoUrls, photoAnalyses] = await Promise.all([
      Promise.all(photos.map(p => getPhotoURL(p))),
      Promise.all(photos.map(p => DB.getAnalysisByPhoto(p.id)))
    ]);
    const photoMap = {};
    photos.forEach((p, i) => { photoMap[p.id] = { url: photoUrls[i], analysis: photoAnalyses[i] }; });
    const groups = {};
    for (const p of photos) { const k = dateKey(p.createdAt); if(!groups[k]) groups[k]=[]; groups[k].push(p); }
    for (const date of Object.keys(groups).sort((a,b)=>b.localeCompare(a))) {
      const dp = groups[date];
      content += `<div class="timeline-date">${formatDate(dp[0].createdAt)}</div><div class="photos-grid">`;
      for (const photo of dp) {
        const { url, analysis } = photoMap[photo.id];
        let bc = photo.type==='analyzer'?'badge-analyzer':'badge-plant';
        let bt = photo.type==='analyzer'?'📊 Suelo':'🌿 Planta';
        if (!analysis && photo.type!=='analyzer') { bc='badge-pending'; bt='⏳ Pendiente'; }
        content += `<div class="photo-thumb" data-action="viewPhoto" data-photo-id="${photo.id}" id="photo-${photo.id}"><img src="${url}" alt="Foto" loading="lazy"><span class="photo-badge ${bc}">${bt}</span></div>`;
      }
      content += '</div>';
    }
  }
  const plantTypes = (pot.plantTypes || (pot.plantType ? [pot.plantType] : [])).map(cleanPlantName).filter(Boolean);
  const plantSubtitle = plantTypes.length
    ? `🌸 ${escapeHtml(plantTypes.join(', '))}${pot.description ? ' · ' + escapeHtml(pot.description) : ''}`
    : escapeHtml(pot.description || 'Sin descripción');
  return `<div class="flex items-center justify-between mb-16"><div><div class="section-title">${pot.emoji||'🪴'} ${escapeHtml(pot.name)}</div><div class="section-subtitle">${plantSubtitle}</div></div><div class="flex gap-8"><button class="btn btn-icon btn-secondary" data-action="openPotSchedule" data-pot-id="${pot.id}" id="schedule-pot-btn" title="Cronograma">📅</button><button class="btn btn-icon btn-secondary" data-action="editPot" data-pot-id="${pot.id}" id="edit-pot-btn" title="Editar">✏️</button><button class="btn btn-icon btn-secondary" data-action="enterSelectMode" id="select-mode-btn" title="Seleccionar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#16a34a" stroke-width="2"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></div>${summaryHtml}${content}<button class="fab" data-action="addPhoto" data-pot-id="${pot.id}" id="add-photo-fab" title="Agregar foto">📷</button>`;
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
  const reanalyzeBtns = `<div class="btn-group" style="margin-top:12px"><button class="btn btn-primary btn-block" data-action="analyzePhoto" data-photo-id="${photo.id}" id="analyze-btn">🔄 Re-analizar ${analyzeLabel}</button><button class="btn btn-secondary btn-block" data-action="switchPhotoType" data-photo-id="${photo.id}" data-new-type="${switchType}">${switchLabel} y re-analizar</button></div>`;
  if (analysis && analysis.result) {
    analysisHtml = (photo.type==='analyzer' ? renderSoilAnalysis(analysis.result) : renderPlantAnalysis(analysis.result)) + reanalyzeBtns;
  } else {
    analysisHtml = `<div class="analysis-card glass-card"><div class="analysis-header"><span class="ai-icon">🤖</span><h3>Análisis IA</h3></div><div class="btn-group"><button class="btn btn-primary btn-block" data-action="analyzePhoto" data-photo-id="${photo.id}" id="analyze-btn">✨ Analizar ${analyzeLabel}</button><button class="btn btn-secondary btn-block" data-action="switchPhotoType" data-photo-id="${photo.id}" data-new-type="${switchType}">${switchLabel} y analizar</button></div></div>`;
  }
  
  const navHtml = `
    <div class="photo-gallery-nav glass-card">
      ${prevPhoto ? `<button class="nav-arrow" data-navigate="pot/${photo.potId}/photo/${prevPhoto.id}">‹</button>` : '<div class="nav-spacer"></div>'}
      <div class="nav-date">
        <div class="date-main">${formatDate(photo.createdAt)}</div>
        <div class="date-sub">${formatTime(photo.createdAt)} • ${photo.type==='analyzer'?'📊 Analizador':'🌿 Planta'}</div>
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
    ${analysisHtml}
    <div class="photo-actions-row"><button class="btn btn-secondary btn-sm" data-action="editPhoto" data-photo-id="${photo.id}" id="edit-photo-btn">✏️ Editar</button><button class="btn btn-danger btn-sm" data-action="deletePhoto" data-photo-id="${photo.id}" id="delete-photo-btn">🗑️ Eliminar</button></div>`;
}

function renderPlantAnalysis(r) {
  const sc = { healthy:'var(--success)', warning:'var(--warning)', danger:'var(--danger)' };
  const sl = { healthy:'🟢 Saludable', warning:'🟡 Atención', danger:'🔴 Problema' };
  let issues = '';
  if (r.issues?.length) { issues = '<div class="mt-8"><strong>Problemas:</strong></div><ul style="margin:6px 0 0 18px;font-size:0.8rem;color:var(--text-secondary)">'; for(const i of r.issues) issues+=`<li><strong>${escapeHtml(i.name||i.type)}</strong>: ${escapeHtml(i.description)} <em>(${i.severity})</em></li>`; issues+='</ul>'; }
  let recs = '';
  if (r.recommendations?.length) { recs = '<div class="mt-8"><strong>Recomendaciones:</strong></div><ul style="margin:6px 0 0 18px;font-size:0.8rem;color:var(--text-secondary)">'; for(const rc of r.recommendations) recs+=`<li>${escapeHtml(rc)}</li>`; recs+='</ul>'; }
  return `<div class="analysis-card glass-card"><div class="analysis-header"><span class="ai-icon">🤖</span><h3>Análisis de Planta</h3></div><div class="analysis-body">${r.plantType?`<div><strong>Planta:</strong> ${escapeHtml(cleanPlantName(r.plantType))}</div>`:''}<div style="margin:8px 0;display:flex;align-items:center;gap:8px"><span style="color:${escapeHtml(sc[r.healthStatus]||'var(--text-secondary)')}">${escapeHtml(sl[r.healthStatus]||r.healthStatus)}</span>${r.healthScore?`<span style="font-size:0.75rem;color:var(--text-muted)">Puntuación: ${escapeHtml(r.healthScore)}/10</span>`:''}</div>${r.summary?`<p>${escapeHtml(r.summary)}</p>`:''}${r.sunRequirements?`<div class="mt-8"><strong>☀️ Sol:</strong> ${escapeHtml(r.sunRequirements)}</div>`:''}${r.waterRequirements?`<div><strong>💧 Riego:</strong> ${escapeHtml(r.waterRequirements)}</div>`:''}${issues}${recs}</div></div>`;
}

function renderSoilAnalysis(r) {
  const params = [{key:'fertility',label:'Fertilidad',unit:'µ/cm²',icon:'🌱'},{key:'humidity',label:'Humedad Suelo',unit:'%',icon:'💧'},{key:'ph',label:'pH',unit:'',icon:'⚗️'},{key:'temperature',label:'Temperatura',unit:'°C',icon:'🌡️'},{key:'sunlight',label:'Luz Solar',unit:'',icon:'☀️'},{key:'ambientHumidity',label:'Humedad Amb.',unit:'%',icon:'🌫️'}];
  let ph = '<div class="soil-params">';
  for (const p of params) { const v=r[p.key]??'N/A'; ph+=`<div class="soil-param"><div class="param-label">${escapeHtml(p.icon)} ${escapeHtml(p.label)}</div><div class="param-value">${escapeHtml(v)}</div>${p.unit?`<div class="param-unit">${escapeHtml(p.unit)}</div>`:''}</div>`; }
  ph += '</div>';
  return `<div class="analysis-card glass-card"><div class="analysis-header"><span class="ai-icon">📊</span><h3>Datos del Suelo</h3></div>${ph}${r.confidence?`<div class="mt-8" style="font-size:0.75rem;color:var(--text-muted)">Confianza: ${escapeHtml(r.confidence)}</div>`:''}${r.notes?`<div style="font-size:0.78rem;color:var(--text-secondary);margin-top:6px">${escapeHtml(r.notes)}</div>`:''}</div>`;
}

function mapIssuesToProducts(issues, soilData) {
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

function computeTaskStatus(pot, product, allLogs) {
  const freq = pot.scheduleOverrides?.[product.slug] || product.defaultFrequencyDays;
  const potLogs = allLogs.filter(l => l.potId === Number(pot.id) && l.productSlug === product.slug);
  if (!potLogs.length) return { status: 'danger', label: 'Nunca aplicado', freq };
  const last = potLogs.sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt))[0];
  const diffDays = Math.floor((new Date() - new Date(last.appliedAt)) / 86400000);
  const rem = freq - diffDays;
  if (rem > 1)  return { status: 'healthy', label: `Faltan ${rem} días`, freq };
  if (rem === 1) return { status: 'healthy', label: 'Falta 1 día', freq };
  if (rem === 0) return { status: 'warning', label: 'Hoy toca aplicar', freq };
  const ov = Math.abs(rem);
  return { status: 'danger', label: `${ov} día${ov>1?'s':''} de atraso`, freq };
}

// ===== TASKS VIEW =====
export async function renderTasks() {
  const [pots, products, analyses] = await Promise.all([
    DB.getAllPots(),
    DB.getAllProducts(),
    Promise.all((await DB.getAllPots()).map(p => DB.getAnalysesByPot(p.id)))
  ]);
  products.sort((a, b) => a.name.localeCompare(b.name));

  const header = `<div class="flex items-center justify-between mb-8"><div class="section-title" style="margin-bottom:0">📋 Tareas</div><div class="flex gap-8"><button class="btn btn-secondary" style="padding:6px 12px;font-size:0.75rem" data-action="enterPotSelectModeTask" id="pot-select-task-btn" title="Seleccionar">✅</button><button class="btn btn-secondary" style="padding:6px 12px;font-size:0.75rem" data-navigate="products">🧴 Productos</button></div></div><div class="section-subtitle">Pendientes de tu jardín</div>`;

  if (pots.length === 0) return header + `<div class="empty-state"><div class="empty-icon">🪴</div><p>Agrega macetas primero para ver las tareas pendientes.</p></div>`;

  const allLogs = await DB.getTaskLogsByPots(pots.map(p => Number(p.id)));
  let html = '';

  for (let i = 0; i < pots.length; i++) {
    const pot = pots[i];
    const potAnalyses = analyses[i] || [];
    const recommended = mapIssuesToProducts(potAnalyses.filter(a => a.type === 'plant').flatMap(a => a.result?.issues || []), null);
    const activeProductSlugs = pot.activeProducts || recommended.map(p => p.slug);
    const activeProducts = products.filter(p => activeProductSlugs.includes(p.slug));

    let rows = '';
    for (const prod of activeProducts) {
      const ts = computeTaskStatus(pot, prod, allLogs);
      rows += `<div class="task-row"><span class="task-icon">${escapeHtml(prod.icon)}</span><span class="task-name">${escapeHtml(prod.name)}</span><span class="task-status-badge status-${ts.status}">${escapeHtml(ts.label)}</span><button class="btn-apply" data-action="applyProduct" data-pot-id="${pot.id}" data-product-slug="${escapeHtml(prod.slug)}">✅</button></div>`;
    }

    const checkmark = `<input type="checkbox" class="task-pot-checkbox" data-pot-id="${pot.id}" style="width:18px;height:18px;cursor:pointer">`;
    html += `<div class="glass-card task-pot-card" id="task-pot-${pot.id}" style="animation-delay:${i*0.06}s"><div class="task-pot-header">${checkmark}<span class="pot-emoji">${pot.emoji||'🪴'}</span><span class="pot-name">${escapeHtml(pot.name)}</span><button class="btn-icon" data-action="editPotProducts" data-pot-id="${pot.id}" style="margin-left:auto;padding:4px;opacity:0.7">⚙️</button></div>${rows}</div>`;
  }

  return header + html;
}

// ===== PRODUCTS VIEW =====
export async function renderProducts() {
  const products = await DB.getAllProducts();
  products.sort((a, b) => a.name.localeCompare(b.name));
  let list = '';
  for (const p of products) {
    list += `<div class="glass-card product-card" data-navigate="product/${p.slug}" id="product-${p.slug}"><div class="product-icon">${escapeHtml(p.icon)}</div><div class="product-info"><div class="product-name">${escapeHtml(p.name)}</div><div class="product-freq">Cada ${escapeHtml(p.defaultFrequencyDays)} días</div></div><span class="product-arrow">›</span></div>`;
  }
  return `<div class="section-title">🧴 Productos</div><div class="section-subtitle">Toca un producto para editar · usa ➕ para agregar</div><div class="product-list">${list}</div><button class="fab" data-action="addProduct" title="Nuevo producto">➕</button>`;
}

// ===== PRODUCT DETAIL VIEW =====
export async function renderProductDetail(slug) {
  const product = await DB.getProduct(slug);
  if (!product) return '<div class="empty-state"><p>Producto no encontrado</p></div>';
  let photosHtml = '';
  if (product.photos?.length) {
    for (let i = 0; i < product.photos.length; i++) {
      const dataUrl = typeof product.photos[i] === 'string' ? product.photos[i] : await blobToDataURL(product.photos[i]);
      photosHtml += `<div class="product-photo-thumb"><img src="${dataUrl}" alt="${product.name}"><button class="delete-x" data-action="deleteProductPhoto" data-slug="${slug}" data-index="${i}">✕</button></div>`;
    }
  }
  return `<div class="flex items-center justify-between mb-16"><div><div class="section-title">${escapeHtml(product.icon)} ${escapeHtml(product.name)}</div><div class="section-subtitle">Cada ${escapeHtml(product.defaultFrequencyDays)} días${product.notes ? ' · ' + escapeHtml(product.notes.slice(0,40)) : ''}</div></div><button class="btn btn-secondary btn-icon" data-action="editProductModal" data-slug="${slug}" title="Editar">✏️</button></div>
    <div class="glass-card" style="margin-bottom:16px"><div class="form-group"><label class="form-label">Frecuencia global (días)</label><input class="form-input" type="number" id="product-freq" min="1" max="365" value="${product.defaultFrequencyDays}"></div><div class="form-group"><label class="form-label">Notas</label><textarea class="form-input" id="product-notes" placeholder="Notas sobre este producto...">${escapeHtml(product.notes||'')}</textarea></div><button class="btn btn-primary btn-block" data-action="saveProduct" data-slug="${slug}" id="save-product-btn">💾 Guardar</button></div>
    <div class="glass-card"><div class="form-label">Fotos del producto</div><div class="product-photos">${photosHtml}<button class="btn btn-secondary btn-sm" data-action="addProductPhoto" data-slug="${slug}" id="add-product-photo-btn">➕ Foto</button></div></div>`;
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
    <div class="modal-content" onclick="event.stopPropagation()">
      <div class="modal-handle"></div>
      <div class="modal-title">📋 Productos para ${escapeHtml(pot.name)}</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;max-height:60vh;overflow-y:auto">${checkboxes}</div>
      <button class="btn btn-primary btn-block" data-action="savePotProducts" data-pot-id="${potId}">✅ Guardar</button>
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
  return `<div class="modal-overlay" data-action="closeModal" id="photo-modal"><div class="modal-content"><div class="modal-handle"></div><div class="modal-title">¿Qué vas a fotografiar?</div><div class="flex flex-col gap-8" style="margin-top:8px"><button class="btn btn-secondary btn-block" data-action="selectPhotoType" data-pot-id="${potId}" data-photo-type="plant">🌿 Planta</button><button class="btn btn-secondary btn-block" data-action="selectPhotoType" data-pot-id="${potId}" data-photo-type="analyzer">📊 Analizador de suelo</button></div></div></div>`;
}

export function renderPhotoSourceModal(potId, photoType) {
  const label = photoType === 'analyzer' ? 'Analizador de suelo' : 'Planta';
  return `<div class="modal-overlay" data-action="closeModal" id="photo-modal"><div class="modal-content"><div class="modal-handle"></div><div class="modal-title">📷 ${label}</div><div class="flex flex-col gap-8" style="margin-top:8px"><button class="btn btn-secondary btn-block" data-action="capturePhoto" data-pot-id="${potId}" data-photo-type="${photoType}" id="capture-btn">📸 Tomar Foto</button><button class="btn btn-secondary btn-block" data-action="uploadPhoto" data-pot-id="${potId}" data-photo-type="${photoType}" id="upload-btn">🖼️ Subir desde el dispositivo</button></div></div></div>`;
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
  const [providerRaw, geminiKeyRaw, groqKeyRaw, currentThemeRaw] = await Promise.all([
    DB.getSetting('aiProvider'),
    DB.getSetting('geminiApiKey'),
    DB.getSetting('groqApiKey'),
    DB.getSetting('theme')
  ]);
  const provider = providerRaw || 'gemini';
  const geminiKey = geminiKeyRaw || '';
  const groqKey = groqKeyRaw || '';

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
    adminSection = `<div class="settings-section"><h3>🛡️ Administrador</h3><div class="glass-card">
      <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:12px">${profiles.length} usuario${profiles.length!==1?'s':''} registrado${profiles.length!==1?'s':''}</div>
      ${rows || '<div style="color:var(--text-muted);font-size:0.85rem">No hay otros usuarios registrados aún.</div>'}
      <button class="btn btn-secondary btn-block" style="margin-top:14px" data-action="reloadAdminUsers">↻ Actualizar lista</button>
    </div></div>`;
  }

  const aiSection = isAdmin ? `
    <div class="settings-section"><h3>🤖 Inteligencia Artificial</h3><div class="glass-card">
      <div class="form-group"><label class="form-label" for="ai-provider">Proveedor</label>
        <select class="form-input" id="ai-provider" style="background:var(--bg-primary);border:1px solid var(--border-glass);color:var(--text-primary);padding:10px;border-radius:8px">
          <option value="gemini" ${provider==='gemini'?'selected':''}>Google Gemini (1.5 Flash)</option>
          <option value="groq" ${provider==='groq'?'selected':''}>Groq (Llama 3.2 Vision) - GRATIS</option>
        </select>
      </div>
      <div id="gemini-settings" style="display:${provider==='gemini'?'block':'none'};margin-top:16px;padding-top:16px;border-top:1px solid var(--border-glass)">
        <div class="form-group"><label class="form-label" for="gemini-key-input">API Key de Google Gemini</label><input class="form-input" type="password" id="gemini-key-input" placeholder="Ingresa tu API key" value="${escapeHtml(geminiKey)}">${gMask?`<div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px">Actual: ${gMask}</div>`:''}</div>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:10px;line-height:1.5;margin-bottom:12px">Obtén tu API key en <a href="https://aistudio.google.com/apikey" target="_blank" style="color:var(--accent)">Google AI Studio</a>.</div>
      </div>
      <div id="groq-settings" style="display:${provider==='groq'?'block':'none'};margin-top:16px;padding-top:16px;border-top:1px solid var(--border-glass)">
        <div class="form-group"><label class="form-label" for="groq-key-input">API Key de Groq</label><input class="form-input" type="password" id="groq-key-input" placeholder="Ingresa tu API key" value="${escapeHtml(groqKey)}">${rqMask?`<div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px">Actual: ${rqMask}</div>`:''}</div>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:10px;line-height:1.5;margin-bottom:12px">Obtén tu API key gratuita en <a href="https://console.groq.com/keys" target="_blank" style="color:var(--accent)">Groq Cloud</a>. No requiere tarjeta.</div>
      </div>
      <button class="btn btn-primary btn-block" data-action="saveAiSettings" id="save-ai-btn">💾 Guardar Configuración IA</button>
    </div></div>` : '';

  const currentTheme = currentThemeRaw || 'dark';

  return `<div class="section-title">⚙️ Configuración</div><div class="section-subtitle">Ajustes de la aplicación</div>
    <div class="settings-section"><h3>🎨 Apariencia</h3><div class="glass-card">
      <div class="theme-picker">
        <button class="theme-option ${currentTheme==='dark'?'active':''}" data-action="setTheme" data-theme="dark">
          <div class="theme-preview theme-preview-dark"></div>
          <span>Jardín Nocturno</span>
        </button>
        <button class="theme-option ${currentTheme==='botanical'?'active':''}" data-action="setTheme" data-theme="botanical">
          <div class="theme-preview theme-preview-botanical"></div>
          <span>Botanical</span>
        </button>
        <button class="theme-option ${currentTheme==='tropical'?'active':''}" data-action="setTheme" data-theme="tropical">
          <div class="theme-preview theme-preview-tropical"></div>
          <span>Jardín Vivo</span>
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
const PRODUCT_EMOJIS = ['💧','🧪','🟡','🟠','⚗️','🔶','🌿','💊','🧴','🔬','🌱','☘️','🍃','🌾','🫧','🧫','⚡','🪣','🫙','🔩','🧂','🪴','💦','🌊','🌡️','☀️'];

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
      <div class="flex flex-col gap-8">${list}</div>
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

// ===== TOAST =====
export function showToast(message, duration = 3000) {
  let toast = document.getElementById('app-toast');
  if (!toast) { toast = document.createElement('div'); toast.id = 'app-toast'; toast.className = 'toast'; document.body.appendChild(toast); }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), duration);
}
