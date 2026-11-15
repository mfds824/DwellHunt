// Shared with the existing DwellHunt Cloudinary uploader. No server secrets.
export const CLOUDINARY_UPLOAD_URL = 'https://api.cloudinary.com/v1_1/xx8yy8mw/image/upload';
export const CLOUDINARY_UPLOAD_PRESET = 'dwellhunt_properties';
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export function validatePropertyFile(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Choose a JPG, PNG or WebP image.';
  if (!file.size || file.size > MAX_UPLOAD_BYTES) return 'Choose an image between 1 byte and 5 MB.';
  return '';
}
export function uploadPropertyFile(file, { onProgress = () => {}, signal, xhrFactory = () => new XMLHttpRequest() } = {}) {
  const error = validatePropertyFile(file);
  if (error) return Promise.reject(new Error(error));
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = message => { cleanup(); reject(new Error(message)); };
    const abort = () => xhr.abort();
    xhr.open('POST', CLOUDINARY_UPLOAD_URL); xhr.timeout = 120000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => fail('Upload could not connect. Your entered information is still here; try again.');
    xhr.ontimeout = () => fail('Upload timed out. Your entered information is still here; try again.');
    xhr.onabort = () => fail('Upload cancelled. Choose the file again to retry.');
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText), url = new URL(result.secure_url);
        if (xhr.status < 200 || xhr.status >= 300 || url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') throw new Error();
        cleanup(); resolve({ url: url.href, publicId: String(result.public_id || '') });
      } catch { fail('The photo service did not confirm an upload. Please retry.'); }
    };
    if (signal?.aborted) { fail('Upload cancelled.'); return; }
    signal?.addEventListener('abort', abort, { once: true });
    const form = new FormData(); form.append('file', file); form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    xhr.send(form);
  });
}
