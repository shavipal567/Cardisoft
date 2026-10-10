import type { Vessel } from "../api";
import { VESSELS } from "../anatomy/coronary";
import { riskColor } from "../fields";

export function createHeartPng(viewport: HTMLElement, capture: () => HTMLCanvasElement,
  probabilities: Partial<Record<Vessel, number>>, caption: string) {
  const rect = viewport.getBoundingClientRect();
  const width = rect.width, height = rect.height;
  const output = document.createElement("canvas");
  output.width = Math.round(width * 2); output.height = Math.round((height + 240) * 2);
  const ctx = output.getContext("2d");
  if (!ctx) throw new Error("Image export is unavailable in this browser.");
  ctx.scale(2, 2);
  const style = getComputedStyle(viewport);
  const background = style.getPropertyValue("--canvas1").trim() || "#19293b";
  const centre = style.getPropertyValue("--canvas2").trim() || background;
  const gradient = ctx.createRadialGradient(width / 2, height * .45, 0, width / 2, height * .45, Math.max(width, height) * .7);
  gradient.addColorStop(0, centre); gradient.addColorStop(1, background);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  // Render and copy synchronously, before WebGL discards its drawing buffer.
  ctx.drawImage(capture(), 0, 0, width, height);
  for (const line of viewport.querySelectorAll<SVGLineElement>(".anatomy-overlay line")) {
    if (getComputedStyle(line).visibility === "hidden") continue;
    ctx.strokeStyle = "#9bb5c8"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Number(line.getAttribute("x1")), Number(line.getAttribute("y1")));
    ctx.lineTo(Number(line.getAttribute("x2")), Number(line.getAttribute("y2"))); ctx.stroke();
  }
  for (const label of viewport.querySelectorAll<HTMLElement>("[data-export-label]")) {
    const css = getComputedStyle(label);
    if (css.visibility === "hidden" || css.display === "none") continue;
    const box = label.getBoundingClientRect(), x = box.left - rect.left, y = box.top - rect.top;
    ctx.globalAlpha = Number(css.opacity);
    ctx.fillStyle = css.backgroundColor === "rgba(0, 0, 0, 0)" ? background : css.backgroundColor;
    ctx.beginPath(); ctx.roundRect(x, y, box.width, box.height, 6); ctx.fill();
    ctx.strokeStyle = css.borderTopColor; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = css.color; ctx.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    ctx.textBaseline = "middle";
    const text = Array.from(label.children).length ? Array.from(label.children).map((node) => node.textContent).join(" ") : label.textContent ?? "";
    ctx.fillText(text, x + 8, y + box.height / 2, Math.max(1, box.width - 16));
  }
  ctx.globalAlpha = 1; ctx.fillStyle = "#f4f7fa"; ctx.fillRect(0, height, width, 240);
  ctx.textBaseline = "top"; ctx.fillStyle = "#20394b"; ctx.font = "bold 13px sans-serif";
  ctx.fillText("Cardisoft · Stenosis probability", 14, height + 12);
  ctx.font = "11px sans-serif";
  let y = height + 34;
  const wrap = (text: string) => {
    let line = "";
    for (const word of text.split(" ")) {
      if (ctx.measureText(line + word).width > width - 28 && line) { ctx.fillText(line.trim(), 14, y); y += 15; line = ""; }
      line += `${word} `;
    }
    ctx.fillText(line.trim(), 14, y); y += 17;
  }
  wrap(caption);
  for (const [i, vessel] of VESSELS.entries()) {
    const p = probabilities[vessel], x = 14 + i * (width - 28) / 3;
    ctx.fillStyle = p === undefined ? "#94a3b8" : riskColor(p); ctx.fillRect(x, y, 8, 12);
    ctx.fillStyle = "#20394b"; ctx.fillText(`${vessel}: ${p === undefined ? "—" : `${(p * 100).toFixed(1)}%`}`, x + 13, y);
  }
  y += 24;
  const legend = ctx.createLinearGradient(14, 0, width - 14, 0);
  for (let i = 0; i <= 10; i++) legend.addColorStop(i / 10, riskColor(i / 10));
  ctx.fillStyle = legend; ctx.fillRect(14, y, width - 28, 7); y += 12;
  ctx.fillStyle = "#20394b"; ctx.font = "10px sans-serif";
  ctx.fillText("Lower model estimate", 14, y); ctx.textAlign = "right"; ctx.fillText("Higher model estimate", width - 14, y); ctx.textAlign = "left"; y += 20;
  wrap("Model-estimated probability of stenosis, not the percentage of artery narrowing. Illustrative anatomy; no lesion localization.");
  wrap("Heart: Pigcraft / Sketchfab · CC BY 4.0 · Adapted orientation and overlays.");
  return output;
}

export async function exportHeartPng(viewport: HTMLElement, capture: () => HTMLCanvasElement,
  probabilities: Partial<Record<Vessel, number>>, caption: string) {
  await document.fonts.ready;
  const output = createHeartPng(viewport, capture, probabilities, caption);
  const blob = await new Promise<Blob>((resolve, reject) => output.toBlob((value) => value ? resolve(value) : reject(new Error("Could not encode the image.")), "image/png"));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = `cardisoft-heart-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
