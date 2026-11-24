// Static reconstruction of the build-280100 legacy Android board renderer.
// Provenance and limits: research/android-mobile/NATIVE_MOTION_RECONSTRUCTION.md.
// Keep these Android helpers separate from the desktop renderer's timing.
export const NATIVE_DYNAMIC = Object.freeze({
  travelMs: 145,
  tiltMs: 116,
  counterTiltMs: 29,
  landingMs: 100,
  durationMs: 245,
  scale: 1.1,
  pivot: "50% 10%",
  travelEasing: "cubic-bezier(0, 0.55, 0.45, 1)",
  // A separate 50ms ValueAnimator uses this curve. Its effect on the View
  // is unproven; the visible scale belongs to the 145ms ObjectAnimator.
  detachedScaleAnimatorMs: 50,
  detachedScaleEasing: "cubic-bezier(0.16, 1, 0.3, 1)",
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, progress) => from + (to - from) * progress;

// Android's default ValueAnimator AccelerateDecelerateInterpolator. CSS ease
// is a different function, so samples use the cosine directly.
export function androidAccelerateDecelerate(progress) {
  const p = clamp(progress, 0, 1);
  return p === 0 || p === 1 ? p : (1 - Math.cos(Math.PI * p)) / 2;
}

// Invert Bezier x before evaluating y, as required by PathInterpolator.
// The iteration count controls numerical precision, not animation timing.
export function nativeTravelProgress(progress) {
  const x = clamp(progress, 0, 1);
  if (x === 0 || x === 1) return x;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 48; i++) {
    const t = (low + high) / 2;
    const curveX = 3 * (1 - t) * t * t * 0.45 + t * t * t;
    if (curveX < x) low = t;
    else high = t;
  }
  const t = (low + high) / 2;
  return 3 * (1 - t) ** 2 * t * 0.55 + 3 * (1 - t) * t * t + t ** 3;
}

function checkedMove({ deltaX, deltaY, squareSize }) {
  if (![deltaX, deltaY, squareSize].every(Number.isFinite) || squareSize <= 0) {
    throw new TypeError(
      "Native motion requires finite deltas and a positive squareSize",
    );
  }
  return { deltaX, deltaY, squareSize };
}

// deltaX/Y are destination minus source, in screen pixels. The DOM piece is
// already laid out at the destination, so the initial transform is -delta.
// 'tilt' is screen-space degrees; compose any board-facing rotation separately.
export function sampleNativeDynamic(timeMs, move) {
  const { deltaX, deltaY, squareSize } = checkedMove(move);
  if (!Number.isFinite(timeMs)) throw new TypeError("timeMs must be finite");
  const t = clamp(timeMs, 0, NATIVE_DYNAMIC.durationMs);
  const tiltTarget = (4 * deltaX) / squareSize;
  const travel = nativeTravelProgress(t / NATIVE_DYNAMIC.travelMs);
  let tilt;
  if (t <= NATIVE_DYNAMIC.tiltMs) {
    tilt = tiltTarget * nativeTravelProgress(t / NATIVE_DYNAMIC.tiltMs);
  } else if (t <= NATIVE_DYNAMIC.travelMs) {
    tilt = lerp(
      tiltTarget,
      -tiltTarget,
      androidAccelerateDecelerate(
        (t - NATIVE_DYNAMIC.tiltMs) / NATIVE_DYNAMIC.counterTiltMs,
      ),
    );
  } else {
    tilt = lerp(
      -tiltTarget,
      0,
      androidAccelerateDecelerate(
        (t - NATIVE_DYNAMIC.travelMs) / NATIVE_DYNAMIC.landingMs,
      ),
    );
  }
  const scale =
    t <= NATIVE_DYNAMIC.travelMs
      ? lerp(1, NATIVE_DYNAMIC.scale, travel)
      : lerp(
          NATIVE_DYNAMIC.scale,
          1,
          androidAccelerateDecelerate(
            (t - NATIVE_DYNAMIC.travelMs) / NATIVE_DYNAMIC.landingMs,
          ),
        );
  return {
    x: t >= NATIVE_DYNAMIC.travelMs ? 0 : -deltaX * (1 - travel),
    y: t >= NATIVE_DYNAMIC.travelMs ? 0 : -deltaY * (1 - travel),
    scale,
    tilt,
  };
}

// Sample interval is an explicit renderer choice, not a native source constant.
// Include all source stage boundaries even when a frame grid misses them.
export function nativeDynamicFrames(move, { frameIntervalMs } = {}) {
  checkedMove(move);
  if (!Number.isFinite(frameIntervalMs) || frameIntervalMs <= 0) {
    throw new TypeError(
      "Specify a positive frameIntervalMs for browser sampling",
    );
  }
  if (NATIVE_DYNAMIC.durationMs / frameIntervalMs > 10000) {
    throw new RangeError(
      "frameIntervalMs would create more than 10000 samples",
    );
  }
  const times = new Set([0, 116, 145, 245]);
  for (
    let t = frameIntervalMs;
    t < NATIVE_DYNAMIC.durationMs;
    t += frameIntervalMs
  ) {
    times.add(t);
  }
  return [...times]
    .sort((a, b) => a - b)
    .map((t) => {
      const { x, y, scale, tilt } = sampleNativeDynamic(t, move);
      return {
        offset: t / NATIVE_DYNAMIC.durationMs,
        transform: `translate(${x}px, ${y}px) rotate(${tilt}deg) scale(${scale})`,
      };
    });
}

export function nativeDynamicMotion(move, sampling) {
  checkedMove(move);
  return {
    duration: NATIVE_DYNAMIC.durationMs,
    easing: "linear",
    pivot: NATIVE_DYNAMIC.pivot,
    frames: nativeDynamicFrames(move, sampling),
  };
}

// Verified parameters only. A fixed duration would require the native spring
// minimum-visible-change/velocity thresholds, which have not been established.
export function nativeSpringSpec(type) {
  const stiffness = new Map([
    ["FAST", 10000],
    ["SIMPLE", 2000],
  ]).get(type);
  if (stiffness === undefined) return null;
  return Object.freeze({
    stiffness,
    dampingRatio: 1,
    duration: null,
    settlingThreshold: null,
  });
}

// These are obfuscated LegacyBoardAnimationType field bindings, not durations.
export function nativeLegacyBinding(matchLengthType) {
  if (matchLengthType == null) return "b";
  return (
    new Map([
      ["DAILY", "a"],
      ["BULLET", "d"],
      ["RAPID", "b"],
      ["BLITZ", "b"],
    ]).get(matchLengthType) ?? null
  );
}
