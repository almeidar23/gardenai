// js/ai.js — Gemini API integration for GardenAI

import DB from './db.js';
import { compressForAI } from './camera.js';

const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash'
];

/**
 * Get the stored API key.
 */
async function getApiKey(provider = 'gemini') {
  // Check user's own key first
  const keyField = provider === 'groq' ? 'groqApiKey' : 'geminiApiKey';
  const userKey = await DB.getSetting(keyField);
  if (userKey) return userKey;
  // Fall back to global admin key (no cache — always fresh)
  const global = await DB.getGlobalConfig();
  if (global[keyField]) return global[keyField];
  throw new Error('API_KEY_MISSING');
}

/**
 * Call Gemini Vision API with an image and text prompt.
 * @param {string} base64Image - base64-encoded image
 * @param {string} prompt - text prompt
 * @returns {Promise<string>} - response text
 */
async function callGemini(base64Image, prompt) {
  const apiKey = await getApiKey('gemini');
  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data: base64Image } }
      ]
    }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json'
    }
  };

  // Try models in order until one works
  let lastErr = new Error('No se pudo conectar a Gemini');
  for (const model of GEMINI_MODELS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      let resp;
      try {
        resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal }
        );
      } catch(netErr) {
        clearTimeout(timeout);
        if (netErr.name === 'AbortError') throw new Error('Gemini tardó demasiado. Intenta de nuevo.');
        throw new Error('Sin conexión a Gemini. Verifica tu internet.');
      }
      clearTimeout(timeout);
      if (resp.status === 404) { lastErr = new Error(`Modelo ${model} no disponible`); continue; }
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        if (resp.status === 401) throw new Error('API Key de Gemini inválida. Revisa en Ajustes.');
        if (resp.status === 429) throw new Error('Límite de Gemini alcanzado. Espera un momento.');
        throw new Error(err.error?.message || `Gemini error ${resp.status}`);
      }
      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Respuesta vacía de Gemini');
      return text;
    } catch(e) {
      if (!e.message.includes('no disponible')) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

// Groq vision model candidates in priority order
const GROQ_VISION_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'llama-3.2-90b-vision-preview',
  'llama-3.2-11b-vision-preview',
  'llava-v1.5-7b-4096-preview'
];

async function getGroqVisionModel(apiKey) {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 8000); // 8s max for model list
    const resp = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: ctrl.signal
    });
    if (!resp.ok) return GROQ_VISION_MODELS[0];
    const data = await resp.json();
    const available = new Set(data.data.map(m => m.id));
    for (const m of GROQ_VISION_MODELS) {
      if (available.has(m)) return m;
    }
    // Try any vision/scout model from the API
    const fallback = data.data.find(m => m.id.includes('vision') || m.id.includes('scout') || m.id.includes('llava'));
    if (fallback) return fallback.id;
  } catch(e) { /* ignore */ }
  return GROQ_VISION_MODELS[0];
}

async function callGroq(base64Image, prompt) {
  const apiKey = await getApiKey('groq');
  const modelName = await getGroqVisionModel(apiKey);

  const body = {
    model: modelName,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64," + base64Image } }
        ]
      }
    ],
    temperature: 0.3,
    max_completion_tokens: 2048,
    response_format: { type: "json_object" }
  };

  let resp;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000); // 45s timeout
    resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);
  } catch(netErr) {
    if (netErr.name === 'AbortError') throw new Error('Groq tardó demasiado (>45s). Intenta de nuevo o usa Gemini en Ajustes.');
    throw new Error(`Sin conexión a Groq. Verifica tu internet o cambia a Gemini en Ajustes.`);
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err.error?.message || '';
    if (resp.status === 401) throw new Error('API Key de Groq inválida. Revisa en Ajustes.');
    if (resp.status === 429) throw new Error('Límite de Groq alcanzado. Espera un momento.');
    if (msg.includes('model') || resp.status === 404) throw new Error(`Modelo Groq no disponible: ${modelName}`);
    throw new Error(msg || `Groq error ${resp.status}`);
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Respuesta vacía de Groq');
  return text;
}

/**
 * Call AI with automatic fallback between Gemini and Groq.
 * If the preferred provider fails with a rate limit or network error,
 * it automatically retries with the other provider.
 */
// Exported so app.js can show a countdown on the button
export let aiRetryAt = null; // timestamp when auto-retry will fire

async function callAI(base64Image, prompt, onRetryCountdown = null) {
  const provider = await DB.getSetting('aiProvider') || 'gemini';
  const primary   = provider === 'groq' ? callGroq   : callGemini;
  const secondary = provider === 'groq' ? callGemini : callGroq;

  async function tryCall(fn) {
    try { return await fn(base64Image, prompt); }
    catch(err) { return { error: err }; }
  }

  // First attempt: primary provider
  let res = await tryCall(primary);
  if (!res?.error) return res;
  const err1 = res.error;

  const isRateLimit = err1.message.includes('alcanzado') || err1.message.includes('429');
  const isNetwork   = err1.message.includes('conexión') || err1.message.includes('tardó');

  // Try secondary provider if primary failed with recoverable error
  if (isRateLimit || isNetwork) {
    const fallbackName = provider === 'groq' ? 'Gemini' : 'Groq';
    const res2 = await tryCall(secondary);
    if (!res2?.error) {
      console.warn(`[AI] Switched to ${fallbackName} (primary failed: ${err1.message})`);
      return res2;
    }
    const err2 = res2.error;

    // Both failed — if rate-limited, auto-retry primary after 62s
    if (isRateLimit) {
      const waitMs = 62000;
      aiRetryAt = Date.now() + waitMs;
      if (onRetryCountdown) onRetryCountdown(Math.ceil(waitMs / 1000));

      await new Promise(resolve => {
        let remaining = Math.ceil(waitMs / 1000);
        const tick = setInterval(() => {
          remaining--;
          if (onRetryCountdown) onRetryCountdown(remaining);
          if (remaining <= 0) { clearInterval(tick); resolve(); }
        }, 1000);
      });

      aiRetryAt = null;
      // Retry primary once more after waiting
      const res3 = await tryCall(primary);
      if (!res3?.error) return res3;
      // Also try secondary one more time (network issue may have been temporary)
      const res4 = await tryCall(secondary);
      if (!res4?.error) return res4;
      throw new Error('La cuota de la IA está agotada. Ve a Ajustes → IA y agrega tu propia API Key de Gemini (gratis en aistudio.google.com).');
    }

    throw new Error(`${err1.message} | Fallback ${fallbackName} también falló: ${err2.message}. Agrega tu propia API Key en Ajustes → IA.`);
  }

  throw err1;
}

/**
 * Analyze a plant photo.
 * @param {Blob} imageBlob
 * @param {object|null} soilData - optional soil analyzer data for combined analysis
 * @returns {Promise<object>} analysis result
 */
export async function analyzePlant(imageBlob, soilData = null, onRetryCountdown = null) {
  const base64 = await compressForAI(imageBlob);

  let soilContext = '';
  if (soilData) {
    soilContext = `
Además, se tienen los siguientes datos del suelo medidos el mismo día:
- Fertilidad: ${soilData.fertility} micro/cm²
- Humedad del suelo: ${soilData.humidity}%
- pH: ${soilData.ph}
- Temperatura: ${soilData.temperature}°C
- Luz solar: ${soilData.sunlight}
- Humedad ambiente: ${soilData.ambientHumidity}%
Incorpora estos datos en tu análisis y recomendaciones.`;
  }

  const prompt = `Eres un experto botánico y fitopatólogo. Analiza esta foto de una planta en una maceta y responde en formato JSON con la siguiente estructura:
{
  "plantType": "nombre común y científico de la planta (si se puede identificar)",
  "healthStatus": "healthy" | "warning" | "danger",
  "healthScore": número del 1 al 10,
  "summary": "resumen breve del estado general (1-2 oraciones)",
  "characteristics": ["lista de características observadas"],
  "sunRequirements": "requisitos de luz solar",
  "waterRequirements": "requisitos de riego",
  "issues": [
    {
      "type": "plaga" | "enfermedad" | "deficiencia" | "exceso" | "otro",
      "name": "nombre del problema",
      "description": "descripción del problema",
      "severity": "leve" | "moderada" | "severa"
    }
  ],
  "recommendations": ["lista de recomendaciones específicas"]
}
${soilContext}
Si no puedes identificar la planta con certeza, indica tu mejor estimación. Sé específico y práctico en las recomendaciones.`;

  const responseText = await callAI(base64, prompt, onRetryCountdown);
  try {
    return JSON.parse(responseText);
  } catch {
    const match = responseText.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return { summary: responseText, healthStatus: 'warning', healthScore: 5, issues: [], recommendations: [] };
  }
}

/**
 * Read soil analyzer values from a photo.
 * @param {Blob} imageBlob
 * @returns {Promise<object>} soil data with 6 parameters
 */
export async function readAnalyzer(imageBlob, onRetryCountdown = null) {
  const base64 = await compressForAI(imageBlob);

  const prompt = `Eres un sistema OCR especializado en leer medidores/analizadores de suelo para jardinería. Esta foto muestra un analizador de suelo con una pantalla o indicadores que muestran valores.

Lee y extrae los siguientes 6 parámetros del medidor. Si un parámetro no es visible, estima "N/A". Responde SOLO en formato JSON:
{
  "fertility": "valor de fertilidad en micro/cm² (número o N/A)",
  "humidity": "porcentaje de humedad del suelo (número 0-100 o N/A)",
  "ph": "valor de pH (número con decimales o N/A)",
  "temperature": "temperatura en °C (número o N/A)",
  "sunlight": "nivel de luz solar (descripción o valor numérico o N/A)",
  "ambientHumidity": "humedad del ambiente en porcentaje (número o N/A)",
  "confidence": "alta" | "media" | "baja",
  "notes": "cualquier observación adicional sobre la lectura"
}

Sé preciso al leer los números de la pantalla/indicadores.`;

  const responseText = await callAI(base64, prompt, onRetryCountdown);
  try {
    return JSON.parse(responseText);
  } catch {
    const match = responseText.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('No se pudieron leer los valores del analizador');
  }
}

/**
 * Vision call WITHOUT forced JSON mode — used for simple classification.
 */
async function callVisionFree(blobOrDataUrl, prompt) {
  const base64Image = await compressForAI(blobOrDataUrl);
  const provider = await DB.getSetting('aiProvider') || 'gemini';
  const apiKey = await getApiKey(provider);

  if (provider === 'groq') {
    const modelName = await getGroqVisionModel(apiKey);
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + base64Image } }] }],
        temperature: 0.1,
        max_completion_tokens: 20
      })
    });
    if (!resp.ok) throw new Error('Groq error');
    const d = await resp.json();
    return d.choices?.[0]?.message?.content || '';
  } else {
    const resp = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: base64Image } }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 20 }
      })
    });
    if (!resp.ok) throw new Error('Gemini error');
    const d = await resp.json();
    return d.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
}

/**
 * Detect if photo is an analyzer device or a plant.
 * @param {Blob} imageBlob
 * @returns {Promise<'analyzer'|'plant'>}
 */
export async function detectPhotoType(imageBlob) {
  const prompt = `Look at this image. Does it show a handheld soil meter or soil analyzer device with a digital display showing numerical readings (humidity, pH, fertility, temperature)? Answer with only one word: YES or NO.`;
  try {
    const text = await callVisionFree(imageBlob, prompt);
    return text.trim().toUpperCase().startsWith('YES') ? 'analyzer' : 'plant';
  } catch {
    return 'plant';
  }
}

/**
 * Check if API key is configured.
 */
export async function isConfigured() {
  try {
    const provider = await DB.getSetting('aiProvider') || 'gemini';
    await getApiKey(provider);
    return true;
  } catch {
    return false;
  }
}
