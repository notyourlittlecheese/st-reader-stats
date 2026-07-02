const DB_NAME = 'STReaderStats';
const DB_VERSION = 1;
const STORE = 'chatStats';

export class StatsIndex {
  async database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        const db = request.result;
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('characterAvatar', 'characterAvatar', { unique: false });
      };
    });
  }

  async transaction(mode, callback) {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      try {
        result = callback(store);
      } catch (error) {
        db.close();
        reject(error);
        return;
      }
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error('IndexedDB transaction aborted'));
      };
    });
  }

  id(descriptor) {
    return `${descriptor.characterAvatar}::${descriptor.fileName}`;
  }

  async get(descriptor) {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(this.id(descriptor));
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  }

  async put(descriptor, stats) {
    const record = {
      ...descriptor,
      id: this.id(descriptor),
      stats,
      indexedAt: Date.now(),
      schemaVersion: 1,
    };
    await this.transaction('readwrite', store => store.put(record));
    return record;
  }

  async recordsForCharacter(characterAvatar) {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE)
        .index('characterAvatar')
        .getAll(characterAvatar);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  }

  async removeMissing(characterAvatar, validIds) {
    const existing = await this.recordsForCharacter(characterAvatar);
    const valid = new Set(validIds);
    const stale = existing.filter(record => !valid.has(record.id));
    if (!stale.length) return;
    await this.transaction('readwrite', store => {
      for (const record of stale) store.delete(record.id);
    });
  }

  async clear() {
    await this.transaction('readwrite', store => store.clear());
  }
}
