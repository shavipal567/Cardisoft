import type { Worker } from 'tesseract.js';
import type { ImportOptions } from './report';

/** Run OCR locally; worker, WASM and language data all come from the app origin. */
export async function recognizeImage(image: HTMLCanvasElement, { signal, onProgress }: ImportOptions): Promise<string> {
  signal.throwIfAborted();
  const { createWorker } = await import('tesseract.js');
  signal.throwIfAborted();
  const assetRoot = new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href;
  let worker: Worker | undefined;
  let finished = false;
  let rejectStopped: (reason: unknown) => void = () => {};
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
  const abort = () => rejectStopped(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => rejectStopped(new Error('Image reading timed out. Try a smaller, clearer image.')), 120_000);
  onProgress('Loading image text reader…');
  const pending = createWorker('eng', 1, {
    workerPath: `${assetRoot}worker.min.js`,
    corePath: `${assetRoot}core`,
    langPath: `${assetRoot}lang`,
    workerBlobURL: false,
    errorHandler: () => rejectStopped(new Error('The image text reader could not load or process this report. Reload the page and try again.')),
    logger: (message) => {
      if (finished || signal.aborted) return;
      if (message.status === 'recognizing text') {
        onProgress(`Reading image text… ${Math.round(message.progress * 100)}%`);
      }
    },
  });
  // If cancelled while the engine loads, dispose of it as soon as it is ready.
  void pending.then((created) => {
    if (finished) void created.terminate();
    else worker = created;
  }, () => {});
  try {
    worker = await Promise.race([pending, stopped]);
    const { data } = await Promise.race([worker.recognize(image, { rotateAuto: true }), stopped]);
    if (!data.text.trim()) throw new Error('No readable text found. Try a clear, upright photo of the printed report.');
    return data.text.slice(0, 200_000);
  } finally {
    finished = true;
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    await worker?.terminate();
  }
}

export async function extractImageText(file: File, options: ImportOptions): Promise<string> {
  options.signal.throwIfAborted();
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This image could not be opened. Save it as PNG or JPEG and try again.');
  }
  const canvas = document.createElement('canvas');
  try {
    options.signal.throwIfAborted();
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error('This image is too large. Resize it below 40 megapixels and try again.');
    const scale = Math.min(1, 3500 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image reading is unavailable in this browser.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await recognizeImage(canvas, options);
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}
