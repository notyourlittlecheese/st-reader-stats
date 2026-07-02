import { analyzeChat } from './statsCore.js';

self.addEventListener('message', event => {
  const { id, chat, options } = event.data || {};
  try {
    const stats = analyzeChat(chat, options);
    self.postMessage({ id, stats });
  } catch (error) {
    self.postMessage({
      id,
      error: error?.message || String(error),
    });
  }
});
