import { aggregateStats } from './statsCore.js';

export function recordKey(record) {
  return JSON.stringify([record.characterAvatar, record.fileName]);
}

export function groupRecords(records, preferences = {}) {
  const groups = new Map();
  for (const record of records) {
    const card = preferences.cards?.[record.characterAvatar] || {};
    const chat = preferences.chats?.[recordKey(record)] || {};
    const name = (chat.group || card.group || '').trim();
    const key = chat.separate ? `chat:${recordKey(record)}` : name ? `group:${name}` : `card:${record.characterAvatar}`;
    if (!groups.has(key)) groups.set(key, {
      key, name: chat.separate ? record.fileName : name || record.characterName,
      records: [],
    });
    groups.get(key).records.push(record);
  }
  return [...groups.values()].map(group => ({ ...group, stats: aggregateStats(group.records) }));
}

export function annualStats(records, year) {
  const prefix = `${year}-`;
  const filtered = records.map(record => ({ ...record, stats: {
    messageEntries: (record.stats.messageEntries || []).map(entry => {
      const dateBuckets = Object.fromEntries(Object.entries(entry.dateBuckets || {}).filter(([day]) => day.startsWith(prefix)));
      const values = Object.values(dateBuckets);
      return { ...entry, dateBuckets,
        selectedHan: values.reduce((n, b) => n + (b.selectedHan || 0), 0),
        uniqueSwipeHan: values.reduce((n, b) => n + (b.uniqueSwipeHan || 0), 0),
        rerollCount: values.reduce((n, b) => n + (b.rerolls || 0), 0),
      };
    }).filter(entry => Object.keys(entry.dateBuckets).length),
  } })).filter(record => record.stats.messageEntries.length);
  const stats = aggregateStats(filtered);
  // A swipe in a later year is generation activity, not another sent message.
  stats.countedMessageCount = Object.values(stats.dateBuckets).reduce((n, b) => n + b.messages, 0);
  const days = Object.keys(stats.dateBuckets).filter(day => stats.dateBuckets[day].messages > 0).sort();
  let longest = 0, run = 0, previous = null;
  for (const day of days) {
    const stamp = Date.parse(`${day}T00:00:00Z`);
    run = previous !== null && stamp - previous === 86400000 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = stamp;
  }
  const seen = new Set();
  let nightMessages = 0;
  for (const record of filtered) for (const entry of record.stats.messageEntries) {
    const key = JSON.stringify([record.characterAvatar, entry.nodeKey]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (entry.sentDay?.startsWith(prefix) && entry.sentHour !== null && entry.sentHour >= 0 && entry.sentHour < 5) nightMessages++;
  }
  const peak = Object.entries(stats.dateBuckets).sort((a, b) => b[1].messages - a[1].messages || a[0].localeCompare(b[0]))[0];
  return { ...stats, activeDays: days.length, longest, nightMessages, peak, records: filtered };
}
