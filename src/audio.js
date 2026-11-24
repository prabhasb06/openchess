/** Local sound samples from the observed Chess.com default theme. See research/audio-provenance.md. */
export const SOUND_ASSETS = Object.freeze(Object.fromEntries([
  'move-self', 'move-opponent', 'capture', 'move-check', 'move-self-check',
  'move-opponent-check', 'castle', 'promote', 'illegal', 'correct', 'incorrect',
  'puzzle-correct', 'puzzle-correct-2', 'puzzle-wrong', 'game-start', 'game-end',
  'game-win-long', 'game-lose', 'game-lose-long', 'game-draw', 'tenseconds',
  'premove', 'lesson-fail', 'notify',
].map(name => [name, `/sounds/${name}.mp3`])));

const ALIASES = Object.freeze({
  move: 'move-self', check: 'move-check', promotion: 'promote', win: 'game-win-long',
  lose: 'game-lose', draw: 'game-draw', 'time-warning': 'tenseconds',
  'lesson-pass': 'correct', 'lesson-fail': 'lesson-fail', 'game-win': 'game-win-long',
});

/**
 * Select one event for a chess.js Move or equivalent plain object.
 * gameOver suppresses the ordinary move sound; the caller can play win/lose/draw instead.
 * Priority is a local design choice: end > check > promotion > castle > capture > move.
 */
export function selectMoveSound(move, gameOver = false, opponent = false) {
  if (gameOver) return 'game-end';
  if (!move) return 'illegal';
  const flags = typeof move.flags === 'string' ? move.flags : '';
  const san = typeof move.san === 'string' ? move.san : '';
  if (/[+#]$/.test(san) || move.check === true) return 'check';
  if (move.promotion || flags.includes('p')) return 'promotion';
  if (/[kq]/.test(flags) || (typeof move.isKingsideCastle === 'function' && move.isKingsideCastle()) || (typeof move.isQueensideCastle === 'function' && move.isQueensideCastle())) return 'castle';
  if (move.captured || /[ce]/.test(flags) || (typeof move.isCapture === 'function' && move.isCapture()) || (typeof move.isEnPassant === 'function' && move.isEnPassant())) return 'capture';
  return opponent ? 'move-opponent' : 'move-self';
}

/** One persistent context and master gain. Dependency injection keeps browser lifecycle testable. */
export function createSoundController({
  assets = SOUND_ASSETS,
  createContext = () => {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    return AudioContextClass ? new AudioContextClass({ latencyHint: 'interactive' }) : null;
  },
  fetchAsset = (...args) => globalThis.fetch(...args),
  maxVoices = 8,
} = {}) {
  let context = null, gain = null, resumePromise = null;
  let enabled = true, volume = 0.8, generation = 0, played = 0;
  let activeAssets = { ...assets }, theme = 'default';
  const bytes = new Map(), buffers = new Map(), voices = new Set(), failures = new Set();
  const resolveEvent = event => Object.hasOwn(assets, event) ? event : ALIASES[event];

  function ensureContext() {
    if (context) return context;
    try {
      context = createContext();
      if (!context) return null;
      gain = context.createGain();
      gain.gain.value = enabled ? volume : 0;
      gain.connect(context.destination);
      return context;
    } catch {
      context = null;
      return null;
    }
  }

  function unlock() {
    if (!enabled) return Promise.resolve(false);
    const current = ensureContext();
    if (!current || current.state === 'closed') return Promise.resolve(false);
    if (current.state === 'running') return Promise.resolve(true);
    if (resumePromise) return resumePromise;
    try {
      // Invoke synchronously inside the gesture, before any network/decode awaits.
      resumePromise = Promise.resolve(current.resume())
        .then(() => current.state === 'running')
        .catch(() => false)
        .finally(() => { resumePromise = null; });
      return resumePromise;
    } catch { return Promise.resolve(false); }
  }

  function loadBytes(event) {
    const url = activeAssets[event];
    if (!url) return Promise.reject(new Error('Unknown sound event.'));
    if (!bytes.has(url)) {
      const pending = Promise.resolve().then(() => fetchAsset(url, { cache: 'force-cache' }))
        .then(response => {
          if (!response.ok) throw new Error(`Sound asset unavailable (${response.status}).`);
          return response.arrayBuffer();
        })
        .catch(error => { bytes.delete(url); failures.add(event); throw error; });
      bytes.set(url, pending);
    }
    return bytes.get(url);
  }

  function loadBuffer(event) {
    const url = activeAssets[event];
    if (!buffers.has(url)) {
      const pending = loadBytes(event).then(data => context.decodeAudioData(data.slice(0)))
        .then(buffer => { failures.delete(event); return buffer; })
        .catch(error => { buffers.delete(url); failures.add(event); throw error; });
      buffers.set(url, pending);
    }
    return buffers.get(url);
  }

  async function preload(events = Object.keys(assets)) {
    const selected = [...new Set(events.map(resolveEvent).filter(event => event && assets[event]))];
    const settled = await Promise.allSettled(selected.map(event => context ? loadBuffer(event) : loadBytes(event)));
    return {
      loaded: selected.filter((_, i) => settled[i].status === 'fulfilled'),
      failed: selected.filter((_, i) => settled[i].status === 'rejected'),
    };
  }

  function stop() {
    generation++;
    for (const source of voices) {
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
    }
    voices.clear();
  }

  function setPreferences(preferences = {}) {
    if (preferences.theme !== undefined || preferences.themeAssets !== undefined) {
      const overrides = preferences.themeAssets || {};
      const selectedAssets = { ...assets };
      for (const [event, url] of Object.entries(overrides)) {
        const selected = resolveEvent(event);
        if (selected && Object.hasOwn(assets, selected) && typeof url === 'string' && url)
          selectedAssets[selected] = url;
      }
      // Several observed themes have one move sample shared by both players.
      if (overrides['move-self'] && !overrides['move-opponent'])
        selectedAssets['move-opponent'] = selectedAssets['move-self'];
      if (Object.keys(assets).some(event => activeAssets[event] !== selectedAssets[event])) {
        stop(); // Never finish playing an old theme's pending decode after a switch.
        activeAssets = selectedAssets;
      }
      theme = typeof preferences.theme === 'string' ? preferences.theme : 'default';
    }
    if (typeof preferences.enabled === 'boolean') enabled = preferences.enabled;
    if (typeof preferences.volume === 'number' && Number.isFinite(preferences.volume)) volume = Math.max(0, Math.min(1, preferences.volume));
    if (gain) gain.gain.value = enabled ? volume : 0;
    if (!enabled || volume === 0) stop();
    return { enabled, volume };
  }

  async function play(event) {
    const selected = resolveEvent(event);
    if (!enabled || volume === 0 || !selected || !assets[selected] || !context) return false;
    const currentGeneration = generation;
    // A play invoked by the same gesture as unlock can share its resume operation.
    if (context.state !== 'running' && resumePromise) {
      let timeout;
      await Promise.race([resumePromise, new Promise(resolve => { timeout = setTimeout(resolve, 1000); })]);
      clearTimeout(timeout);
    }
    if (context.state !== 'running') return false;
    try {
      const buffer = await loadBuffer(selected);
      if (!enabled || volume === 0 || generation !== currentGeneration || context.state !== 'running') return false;
      if (voices.size >= maxVoices) {
        const oldest = voices.values().next().value;
        voices.delete(oldest);
        try { oldest.stop(); oldest.disconnect(); } catch {}
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      voices.add(source);
      source.onended = () => { voices.delete(source); try { source.disconnect(); } catch {} };
      source.start();
      played++;
      return true;
    } catch { return false; }
  }

  function attachGestureListeners(target = globalThis.document) {
    if (!target?.addEventListener) return () => {};
    const activate = () => { void unlock(); void preload(); };
    target.addEventListener('pointerdown', activate, { passive: true });
    target.addEventListener('keydown', activate, { passive: true });
    return () => {
      target.removeEventListener('pointerdown', activate);
      target.removeEventListener('keydown', activate);
    };
  }

  return Object.freeze({
    play, unlock, preload, stop, setPreferences, attachGestureListeners,
    getDiagnostics: () => ({ enabled, volume, theme, contextState: context?.state ?? 'uninitialized',
      loadedAssets: bytes.size, decodedAssets: buffers.size, activeVoices: voices.size, played,
      failures: [...failures] }),
  });
}

export const sound = createSoundController();
// Also catches the gesture preceding an asynchronous Stockfish response.
sound.attachGestureListeners();
export default sound;
