// Kept separate from the disposable statistics index: clearing it must never
// remove the user's layouts, uploaded backgrounds, or fonts.
export async function artStore(mode, key, value) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('STReaderStatsArtwork', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('art');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('作品数据库被其他标签页占用，请关闭其他酒馆标签后重试'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('art', mode === 'get' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('art');
      const request = mode === 'get' ? store.get(key) : mode === 'delete' ? store.delete(key) : store.put(value, key);
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || request.error || new Error('保存失败'));
    });
  } finally { db.close(); }
}

export const FONT_SLOTS = { pingfang: '苹方', chio: '303', zhuzhi: '筑紫' };
export const FONT_FAMILIES = {
  system: '"PingFang SC", "Microsoft YaHei", sans-serif',
  serif: '"Songti SC", "SimSun", serif',
  pingfang: '"Reader-pingfang", "PingFang SC", sans-serif',
  chio: '"Reader-chio", serif',
  zhuzhi: '"Reader-zhuzhi", "Songti SC", serif',
};
const loadedFonts = new Map();
export async function loadArtFonts() {
  const result = {};
  for (const id of Object.keys(FONT_SLOTS)) {
    const blob = await artStore('get', `font:${id}`);
    if (blob) {
      try { await installFont(id, blob); result[id] = true; }
      catch (error) { console.warn(`[reader-stats] ${FONT_SLOTS[id]} 加载失败，请重新导入`, error); result[id] = false; }
    }
  }
  return result;
}
export async function installFont(id, blob) {
  if (!Object.hasOwn(FONT_SLOTS, id)) throw new Error('未知字体');
  const font = new FontFace(`Reader-${id}`, await blob.arrayBuffer());
  await font.load();
  const previous = loadedFonts.get(id);
  if (previous) document.fonts.delete(previous);
  document.fonts.add(font);
  loadedFonts.set(id, font);
}
