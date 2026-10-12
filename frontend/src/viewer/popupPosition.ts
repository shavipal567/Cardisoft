type Rect = { left: number; top: number; width: number; height: number };

export function popupPosition(width: number, height: number, panel: { width: number; height: number }, anchor: Rect, obstacles: Rect[]) {
  const margin = 10, top = 44, bottom = 66, gap = 14;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));
  const candidates = [
    { left: anchor.left + anchor.width + gap, top: anchor.top + anchor.height / 2 - panel.height / 2 },
    { left: anchor.left - panel.width - gap, top: anchor.top + anchor.height / 2 - panel.height / 2 },
    { left: anchor.left + anchor.width / 2 - panel.width / 2, top: anchor.top - panel.height - gap },
    { left: anchor.left + anchor.width / 2 - panel.width / 2, top: anchor.top + anchor.height + gap },
    // Prefer the canvas edges when there is room beside the central anatomy.
    { left: margin, top: anchor.top + anchor.height / 2 - panel.height / 2 },
    { left: width - panel.width - margin, top: anchor.top + anchor.height / 2 - panel.height / 2 },
    { left: margin, top },
    { left: width - panel.width - margin, top },
    { left: margin, top: height - panel.height - bottom },
    { left: width - panel.width - margin, top: height - panel.height - bottom },
  ].map((point) => ({
    left: clamp(point.left, margin, width - panel.width - margin),
    top: clamp(point.top, top, height - panel.height - bottom),
  }));
  const overlap = (point: { left: number; top: number }, rect: Rect) => {
    const overlapX = Math.max(0, Math.min(point.left + panel.width, rect.left + rect.width + gap) - Math.max(point.left, rect.left - gap));
    const overlapY = Math.max(0, Math.min(point.top + panel.height, rect.top + rect.height + gap) - Math.max(point.top, rect.top - gap));
    return overlapX * overlapY;
  };
  // A soft central exclusion zone preserves anatomy where the layout permits;
  // artery/anatomy labels retain priority over this approximate heart footprint.
  const anatomy = { left: width * .32, top: height * .2, width: width * .36, height: height * .6 };
  const score = (point: { left: number; top: number }) =>
    obstacles.reduce((sum, rect) => sum + overlap(point, rect), 0) * 4
    + overlap(point, anchor) * 20 + overlap(point, anatomy) * 3;
  return candidates.reduce((best, point) => score(point) < score(best) ? point : best);
}
