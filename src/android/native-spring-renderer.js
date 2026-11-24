import {
  nativeSpringParameters,
  createNativeSpringAxis,
  advanceNativeSpringAxis,
  retargetNativeSpringAxis,
} from "./native-spring.js";

// Stateful adapter: keep positions in board coordinates while React relays out
// a destination. Retargeting therefore preserves velocity and the native
// half-frame pending-target behavior instead of restarting an ease animation.
export function startNativeSpringRenderer(
  node,
  {
    left,
    top,
    dx,
    dy,
    mode,
    pixelsPerCssPixel,
    onFinish,
    requestFrame = requestAnimationFrame,
    cancelFrame = cancelAnimationFrame,
    facing = () => 0,
  },
) {
  const ratio = pixelsPerCssPixel,
    parameters = nativeSpringParameters(mode, { pixelsPerCssPixel: ratio });
  let origin = { left, top },
    lastTime = null,
    frame = 0,
    cancelled = false;
  let x = createNativeSpringAxis({
    position: (left + dx) * ratio,
    target: left * ratio,
    stiffness: parameters.stiffness,
  });
  let y = createNativeSpringAxis({
    position: (top + dy) * ratio,
    target: top * ratio,
    stiffness: parameters.stiffness,
  });
  function paint() {
    node.style.transform = `translate(${x.position / ratio - origin.left}px, ${y.position / ratio - origin.top}px) rotate(${facing()}deg)`;
  }
  function clear() {
    node.style.transform = "";
    delete node.dataset.nativeSpring;
  }
  function tick(time) {
    if (cancelled) return;
    const clock = Math.trunc(time),
      delta = lastTime === null ? 0 : Math.max(0, clock - lastTime);
    lastTime = clock;
    x = advanceNativeSpringAxis(x, delta);
    y = advanceNativeSpringAxis(y, delta);
    paint();
    if (x.finished && y.finished) {
      cancelled = true;
      frame = 0;
      clear();
      onFinish?.();
    } else frame = requestFrame(tick);
  }
  const motion = {
    effect: { target: node },
    nativeSpring: true,
    mode,
    get offset() {
      return {
        x: x.position / ratio - origin.left,
        y: y.position / ratio - origin.top,
      };
    },
    get state() {
      return {
        x: { ...x },
        y: { ...y },
        origin: { ...origin },
        lastTime,
        cancelled,
      };
    },
    retarget(next) {
      origin = { left: next.left, top: next.top };
      x = retargetNativeSpringAxis(x, origin.left * ratio);
      y = retargetNativeSpringAxis(y, origin.top * ratio);
      paint();
    },
    cancel() {
      if (frame) cancelFrame(frame);
      frame = 0;
      cancelled = true;
      clear();
    },
  };
  node.dataset.nativeSpring = mode.toLowerCase();
  paint();
  frame = requestFrame(tick);
  return motion;
}
