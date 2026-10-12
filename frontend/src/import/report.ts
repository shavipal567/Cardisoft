export const REPORT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.bmp,application/pdf,image/png,image/jpeg,image/webp,image/bmp';
export const MAX_REPORT_BYTES = 15 * 1024 * 1024;

export interface ImportOptions {
  signal: AbortSignal;
  onProgress: (message: string) => void;
}

export function reportKind(file: Pick<File, 'name' | 'type' | 'size'>): 'pdf' | 'image' {
  if (!file.size) throw new Error('This file is empty. Choose a PDF or report image.');
  if (file.size > MAX_REPORT_BYTES) throw new Error('Choose a file smaller than 15 MB.');
  const mime = file.type.toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/x-ms-bmp'].includes(mime)) return 'image';
  // Some cameras/file pickers do not provide a MIME type.
  if (!mime || mime === 'application/octet-stream') {
    if (/\.pdf$/i.test(file.name)) return 'pdf';
    if (/\.(png|jpe?g|webp|bmp)$/i.test(file.name)) return 'image';
  }
  throw new Error('Unsupported file. Choose a PDF, PNG, JPEG, WebP or BMP report.');
}

export async function extractReport(file: File, options: ImportOptions) {
  const kind = reportKind(file);
  options.signal.throwIfAborted();
  if (kind === 'pdf') {
    options.onProgress('Reading PDF text…');
    const { extractPdfText } = await import('../pdf/extractText');
    const result = await extractPdfText(await file.arrayBuffer(), options.signal);
    return { ...result, kind };
  }
  options.onProgress('Preparing report image…');
  const { extractImageText } = await import('./imageText');
  const text = await extractImageText(file, options);
  return { text, pages: 1, truncated: false, kind };
}
