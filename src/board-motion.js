// Keep visual identities across legal moves, captures, castling and promotion.
// Position loads with many changes start a new visual scene.
export function reconcilePieces(previous, current, nextId) {
  const used = new Set(),
    pending = [];
  const result = current.map((p) => {
    const old = previous.find(
      (o) => o.square === p.square && o.color === p.color && o.type === p.type,
    );
    if (old) {
      used.add(old.id);
      return { ...p, id: old.id };
    }
    const entry = { ...p };
    pending.push(entry);
    return entry;
  });
  const reset =
    pending.length > 4 || Math.abs(previous.length - current.length) > 2;
  for (const p of pending) {
    const candidates = reset
      ? []
      : previous.filter(
          (o) =>
            !used.has(o.id) &&
            o.color === p.color &&
            (o.type === p.type ||
              (o.type === "p" &&
                p.type !== "p" &&
                p.square[1] === (p.color === "w" ? "8" : "1"))),
        );
    candidates.sort(
      (a, b) => distance(a.square, p.square) - distance(b.square, p.square),
    );
    const old = candidates[0];
    p.id = old?.id ?? nextId();
    if (old) used.add(old.id);
  }
  return result;
}
function distance(a, b) {
  return Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) + Math.abs(+a[1] - +b[1]);
}

// Delivered default-renderer Rx/A_e: fixed speeds, floor(duration / 16) frames.
// Natural/Arcade use other reference renderers; no invented spring is applied.
export function movementDuration(speed) {
  return { slow: 500, medium: 180, fast: 100, none: 0 }[speed] ?? 180;
}
export function movementEasing(speed) {
  return `steps(${Math.max(1, Math.floor(movementDuration(speed) / 16))}, jump-start)`;
}
export function captureFrames(speed) {
  const steps = Math.max(1, Math.floor(movementDuration(speed) / 16));
  return Array.from({ length: steps + 1 }, (_, i) => ({
    offset: i / steps,
    opacity: Math.min(1, 2.86 * (1 - i / steps)),
  }));
}
