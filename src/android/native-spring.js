// Shipped build 280100: critically damped translation springs.
// All axis-state values are native View pixels (velocity: pixels/second).
// Browser/CSS conversion and sampling are explicit; see NATIVE_SPRING_RECONSTRUCTION.md.
const f32 = Math.fround;
const FLOAT_MAX = f32(3.4028235e38);

function finite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

export function nativeSpringParameters(
  mode,
  { pixelsPerCssPixel, animatesDrag = false } = {},
) {
  finite(pixelsPerCssPixel, "pixelsPerCssPixel");
  if (pixelsPerCssPixel <= 0)
    throw new RangeError("pixelsPerCssPixel must be positive");
  const base = new Map([
    ["FAST", 10000],
    ["SIMPLE", 2000],
    ["SLOW", 400],
  ]).get(mode);
  if (!base) throw new TypeError("Unknown native spring mode");
  return Object.freeze({
    stiffness: base * (animatesDrag ? 8 : 1),
    dampingRatio: 1,
    minimumVisibleChange: 1,
    positionThreshold: 0.75,
    velocityThreshold: 46.875,
    pixelsPerCssPixel,
    cssPositionThreshold: 0.75 / pixelsPerCssPixel,
    cssVelocityThreshold: 46.875 / pixelsPerCssPixel,
  });
}

export function createNativeSpringAxis({
  position,
  target = 0,
  velocity = 0,
  stiffness,
}) {
  [position, target, velocity, stiffness].forEach((value) =>
    finite(value, "axis input"),
  );
  if (stiffness <= 0) throw new RangeError("stiffness must be positive");
  const axis = {
    position: f32(position),
    velocity: f32(velocity),
    target: f32(target),
    stiffness: f32(stiffness),
    pendingTarget: null,
    firstFrame: true,
    finished: false,
  };
  if (
    ![axis.position, axis.velocity, axis.target, axis.stiffness].every(
      Number.isFinite,
    )
  ) {
    throw new RangeError("Axis inputs must fit Android float properties");
  }
  return axis;
}

// nq6.c critical-damping branch; round each output back to Android float.
function integrate(axis, deltaMs) {
  const omega = Math.sqrt(axis.stiffness);
  const t = deltaMs / 1000;
  const displacement = axis.position - axis.target;
  const coefficient = omega * displacement + axis.velocity;
  const envelope = Math.exp(-omega * t);
  const polynomial = coefficient * t + displacement;
  return {
    ...axis,
    position: f32(envelope * polynomial + axis.target),
    velocity: f32(envelope * coefficient - omega * envelope * polynomial),
  };
}

export function retargetNativeSpringAxis(axis, target) {
  finite(target, "target");
  const next = f32(target);
  if (!Number.isFinite(next))
    throw new RangeError("target must fit an Android float");
  if (axis.finished) {
    return {
      ...axis,
      target: next,
      pendingTarget: null,
      firstFrame: true,
      finished: false,
    };
  }
  return { ...axis, pendingTarget: next };
}

// mq6.i/d(true): cancellation does not zero velocity or snap the View. A queued
// target is committed, and a later start reads the then-current View position.
export function cancelNativeSpringAxis(axis) {
  return {
    ...axis,
    target: axis.pendingTarget ?? axis.target,
    pendingTarget: null,
    firstFrame: true,
    finished: true,
  };
}

// deltaMs is the difference between consecutive integer native frame timestamps.
// The first callback echoes the initial value and performs no physics step.
export function advanceNativeSpringAxis(
  axis,
  deltaMs,
  { durationScale = 1, skipToEnd = false } = {},
) {
  finite(deltaMs, "deltaMs");
  finite(durationScale, "durationScale");
  if (deltaMs < 0 || !Number.isInteger(deltaMs) || durationScale < 0) {
    throw new RangeError(
      "Use nonnegative integer frame deltas and nonnegative durationScale",
    );
  }
  if (axis.finished) return axis;
  if (axis.firstFrame) return { ...axis, firstFrame: false };
  const nativeScale = f32(durationScale);
  if (!Number.isFinite(nativeScale))
    throw new RangeError("durationScale must fit an Android float");
  const scaledMs =
    nativeScale === 0
      ? 2147483647
      : Math.trunc(f32(f32(deltaMs) / nativeScale));
  const target = axis.pendingTarget ?? axis.target;
  if (skipToEnd) {
    return {
      ...axis,
      position: target,
      velocity: 0,
      target,
      pendingTarget: null,
      finished: true,
    };
  }
  let next;
  if (axis.pendingTarget !== null) {
    // Bundled cs1.a uses integer division: an odd millisecond is discarded.
    const half = Math.trunc(scaledMs / 2);
    const middle = integrate(axis, half);
    next = integrate({ ...middle, target, pendingTarget: null }, half);
  } else {
    next = integrate(axis, scaledMs);
  }
  next.position = Math.min(FLOAT_MAX, Math.max(-FLOAT_MAX, next.position));
  if (
    Math.abs(next.velocity) < 46.875 &&
    Math.abs(f32(next.position - next.target)) < 0.75
  ) {
    return { ...next, position: next.target, velocity: 0, finished: true };
  }
  return next;
}

// Browser adapter. delta means destination minus source in CSS pixels, matching
// native-motion.js. Optional velocities are CSS pixels/second. No fixed duration:
// stop only when both independent native axes satisfy the recovered thresholds.
export function nativeSpringMotion(
  move,
  {
    mode,
    pixelsPerCssPixel,
    frameIntervalMs,
    durationScale = 1,
    animatesDrag = false,
  } = {},
) {
  const parameters = nativeSpringParameters(mode, {
    pixelsPerCssPixel,
    animatesDrag,
  });
  finite(frameIntervalMs, "frameIntervalMs");
  if (frameIntervalMs < 1)
    throw new RangeError(
      "frameIntervalMs must be at least one native-clock millisecond",
    );
  const { deltaX, deltaY, velocityX = 0, velocityY = 0 } = move;
  const ratio = pixelsPerCssPixel;
  let x = createNativeSpringAxis({
    position: -deltaX * ratio,
    velocity: velocityX * ratio,
    stiffness: parameters.stiffness,
  });
  let y = createNativeSpringAxis({
    position: -deltaY * ratio,
    velocity: velocityY * ratio,
    stiffness: parameters.stiffness,
  });
  const samples = [];
  const record = (timeMs) =>
    samples.push({
      timeMs,
      x: x.position / ratio,
      y: y.position / ratio,
      velocityX: x.velocity / ratio,
      velocityY: y.velocity / ratio,
      finishedX: x.finished,
      finishedY: y.finished,
    });
  x = advanceNativeSpringAxis(x, 0, { durationScale });
  y = advanceNativeSpringAxis(y, 0, { durationScale });
  record(0);
  let previous = 0;
  // Resource guard only: throw instead of claiming a truncated spring settled.
  for (let frame = 1; ; frame++) {
    if (frame > 100000)
      throw new RangeError("Browser sampling exceeded 100000 frames");
    const timeMs = Math.floor(frame * frameIntervalMs);
    const delta = timeMs - previous;
    x = advanceNativeSpringAxis(x, delta, { durationScale });
    y = advanceNativeSpringAxis(y, delta, { durationScale });
    record(timeMs);
    previous = timeMs;
    if (x.finished && y.finished) break;
  }
  const duration = samples.at(-1).timeMs;
  return {
    duration,
    easing: "linear",
    parameters,
    samples,
    frames: samples.map(({ timeMs, x, y }) => ({
      offset: timeMs / duration,
      transform: `translate(${x}px, ${y}px)`,
    })),
  };
}

// Sample the explicit browser interpolation, including its current velocity
// estimate. This is not a replacement for native half-frame retarget semantics.
export function sampleNativeSpringMotion(timeMs, motion) {
  finite(timeMs, "timeMs");
  const samples = motion.samples;
  if (timeMs <= 0) return { ...samples[0] };
  if (timeMs >= motion.duration) return { ...samples.at(-1) };
  const index = samples.findIndex((sample) => sample.timeMs >= timeMs);
  const before = samples[index - 1];
  const after = samples[index];
  const progress = (timeMs - before.timeMs) / (after.timeMs - before.timeMs);
  const result = { timeMs };
  for (const key of ["x", "y", "velocityX", "velocityY"]) {
    result[key] = before[key] + (after[key] - before[key]) * progress;
  }
  return {
    ...result,
    finishedX: before.finishedX && after.finishedX,
    finishedY: before.finishedY && after.finishedY,
  };
}
