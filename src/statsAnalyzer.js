import { analyzeChat } from './statsCore.js';

let nextRequestId = 1;
const WORKER_TIMEOUT_MS = 15000;

function nextPaint() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Runs chat analysis away from the UI thread. The fallback keeps compatibility
 * with browsers that disable module workers, while still yielding one paint
 * before doing the work so the loading panel appears immediately.
 */
export async function analyzeChatAsync(chat, options, { signal } = {}) {
  await nextPaint();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  if (typeof Worker === 'undefined') {
    return analyzeChat(chat, options);
  }

  return new Promise((resolve, reject) => {
    const id = nextRequestId++;
    let worker;
    let settled = false;
    let watchdog;

    const cleanup = () => {
      clearTimeout(watchdog);
      signal?.removeEventListener('abort', onAbort);
      worker?.terminate();
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const runFallback = async () => {
      if (settled) return;
      cleanup();
      await nextPaint();
      if (signal?.aborted) {
        onAbort();
        return;
      }
      settled = true;
      resolve(analyzeChat(chat, options));
    };

    try {
      worker = new Worker(new URL('./statsWorker.js', import.meta.url), {
        type: 'module',
        name: 'st-reader-stats-analyzer',
      });
    } catch (error) {
      runFallback().catch(reject);
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    // Some mobile WebViews construct module workers successfully but never
    // dispatch a message or an error. Do not leave the dashboard spinning.
    watchdog = setTimeout(() => {
      runFallback().catch(reject);
    }, WORKER_TIMEOUT_MS);
    worker.addEventListener('message', event => {
      if (event.data?.id !== id) return;
      if (settled) return;
      settled = true;
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.stats);
    });
    worker.addEventListener('error', () => {
      runFallback().catch(reject);
    });
    try {
      worker.postMessage({ id, chat, options });
    } catch {
      runFallback().catch(reject);
    }
  });
}
