export interface ExtractedPdfText {
  text: string;
  pages: number;
  truncated: boolean;
}

const MAX_PAGES = 20;
const MAX_CHARS = 200_000;

/** Extract selectable text from a text-based PDF entirely in the browser. */
export async function extractPdfText(buf: ArrayBuffer): Promise<ExtractedPdfText> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default as string;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;

  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pages = Math.min(doc.numPages, MAX_PAGES);
  const parts: string[] = [];
  let chars = 0;
  let truncated = doc.numPages > MAX_PAGES;

  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = (content.items as Array<{ str?: string }>)
      .map((it) => it.str ?? "")
      .join(" ");
    parts.push(`--- page ${i} ---\n${line}`);
    chars += line.length;
    if (chars > MAX_CHARS) {
      truncated = true;
      break;
    }
    page.cleanup();
  }

  const text = parts.join("\n").slice(0, MAX_CHARS);
  if (text.replace(/--- page \d+ ---/g, "").trim().length < 20) {
    throw new Error(
      "No selectable text found — this looks like a scanned image. Export a text PDF or enter values manually."
    );
  }
  return { text, pages, truncated };
}
