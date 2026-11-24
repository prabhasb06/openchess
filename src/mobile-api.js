// Android routes engine requests through its native bridge.
export const isAndroid =
  typeof window !== "undefined" && !!window.ChessLocalAndroid;
const pending = new Map();
let sequence = 0;
const requestPrefix = isAndroid ? Math.random().toString(36).slice(2) + ":" : "";
if (isAndroid) {
  window.__chessNativeResponse = (id, payload) => {
    const task = pending.get(id);
    if (!task) return;
    pending.delete(id);
    task.cleanup();
    task.resolve(
      new Response(payload.body, {
        status: payload.status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  window.__chessNativeConfigured = () =>
    window.dispatchEvent(new Event("chess-engine-configured"));
}
export function openMobileSettings() {
  window.ChessLocalAndroid?.configure();
}
export function mobileServer() {
  if (!isAndroid) return null;
  try {
    return JSON.parse(window.ChessLocalAndroid.getConfig());
  } catch {
    return null;
  }
}
export function saveMobileFile(name, text) {
  if (!isAndroid) return false;
  window.ChessLocalAndroid.saveFile(name, text);
  return true;
}
export async function copyMobileText(text) {
  if (isAndroid && window.ChessLocalAndroid.copyText) {
    window.ChessLocalAndroid.copyText(String(text));
    return true;
  }
  try {
    await navigator.clipboard.writeText(String(text));
    return true;
  } catch {
    return false;
  }
}
export function mobileHaptic() {
  window.ChessLocalAndroid?.haptic?.();
}
export function apiFetch(path, options = {}) {
  if (!isAndroid) return fetch(path, options);
  if (!["/api/health", "/api/engine"].includes(path))
    return Promise.reject(new Error("Unsupported mobile API endpoint"));
  const { signal } = options;
  if (signal?.aborted)
    return Promise.reject(new DOMException("Request cancelled", "AbortError"));
  return new Promise((resolve, reject) => {
    const id = requestPrefix + String(++sequence);
    const abort = () => {
      if (!pending.delete(id)) return;
      window.ChessLocalAndroid.cancel(id);
      cleanup();
      reject(new DOMException("Request cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      if (!pending.delete(id)) return;
      window.ChessLocalAndroid.cancel(id);
      cleanup();
      reject(
        new Error(
          "The engine request timed out. Check engine settings and retry.",
        ),
      );
    }, 125000);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    pending.set(id, { resolve, reject, cleanup });
    signal?.addEventListener("abort", abort, { once: true });
    try {
      window.ChessLocalAndroid.request(
        id,
        path,
        options.method || "GET",
        options.body || "",
      );
    } catch (error) {
      pending.delete(id);
      cleanup();
      reject(error);
    }
  });
}
