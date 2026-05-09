// js/camera.js — Photo capture and compression for GardenAI

const MAX_WIDTH = 1024;
const MAX_HEIGHT = 1024;
const JPEG_QUALITY = 0.82;

/**
 * Open the device camera and capture a photo.
 * Returns a Blob (JPEG).
 */
export function captureFromCamera() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.style.position = 'absolute';
    input.style.top = '-9999px';
    input.style.opacity = '0';
    document.body.appendChild(input);
    
    input.onchange = async (e) => {
      const file = e.target.files[0];
      document.body.removeChild(input);
      if (!file) return reject(new Error('No se tomó ninguna foto'));
      try {
        const blob = await compressImage(file);
        resolve(blob);
      } catch (err) {
        reject(err);
      }
    };
    
    window.addEventListener('focus', () => {
      setTimeout(() => { if (input.parentNode) document.body.removeChild(input); }, 1000);
    }, { once: true });
    
    input.click();
  });
}

export function uploadFromGallery() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.position = 'absolute';
    input.style.top = '-9999px';
    input.style.opacity = '0';
    document.body.appendChild(input);
    
    input.onchange = async (e) => {
      const file = e.target.files[0];
      document.body.removeChild(input);
      if (!file) return reject(new Error('No se seleccionó ninguna foto'));
      try {
        const blob = await compressImage(file);
        resolve(blob);
      } catch (err) {
        reject(err);
      }
    };
    
    window.addEventListener('focus', () => {
      setTimeout(() => { if (input.parentNode) document.body.removeChild(input); }, 1000);
    }, { once: true });
    
    input.click();
  });
}

/**
 * Compress and resize an image file to JPEG.
 * @param {File|Blob} file
 * @returns {Promise<Blob>}
 */
export function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;

      // Scale down if needed
      if (width > MAX_WIDTH || height > MAX_HEIGHT) {
        const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Error al comprimir imagen'));
        },
        'image/jpeg',
        JPEG_QUALITY
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Error al cargar imagen'));
    };
    img.src = url;
  });
}

/**
 * Convert a Blob to a base64 data URL.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert a Blob to a base64 string (without the data URL prefix).
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function blobToBase64(blob) {
  const dataUrl = await blobToDataURL(blob);
  return dataUrl.split(',')[1];
}
