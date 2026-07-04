const HAN_RE = /\p{Script=Han}/u;
const THINK_RE = /<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi;

export const DEFAULT_OPTIONS = Object.freeze({
  ignoreOpeningMessage: true,
  excludeThinking: true,
  duplicateWindow: 12,
});

export function cleanContent(value, options = DEFAULT_OPTIONS) {
  const text = String(value ?? '');
  return options.excludeThinking === false ? text : text.replace(THINK_RE, '');
}

export function countHan(value) {
  let count = 0;
  for (const char of String(value ?? '')) {
    if (HAN_RE.test(char)) count++;
  }
  return count;
}

export function parseDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'number') {
    const date = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return parseDate(Number(raw));

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const match = raw.match(
    /(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T,_-]+(\d{1,2})[:h](\d{1,2})(?::(\d{1,2}))?)?/i,
  );
  if (!match) return null;

  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] || 0),
    Number(match[5] || 0),
    Number(match[6] || 0),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateKey(value) {
  const date = parseDate(value);
  if (!date) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizedCharacters(value, options) {
  return Array.from(cleanContent(value, options).normalize('NFKC').toLowerCase())
    .filter(char => !/\s/u.test(char));
}

function shingles(chars, windowSize) {
  const result = new Set();
  if (chars.length < windowSize) return result;
  for (let i = 0; i <= chars.length - windowSize; i++) {
    result.add(chars.slice(i, i + windowSize).join(''));
  }
  return result;
}

/**
 * Counts the new Han characters contributed by every swipe.
 * Exact repeated normalized text contributes zero. Longer repeated runs are
 * detected with overlapping character shingles, so unchanged prefixes,
 * suffixes, and copied paragraphs are not counted again.
 */
export function countUniqueSwipeHan(swipes, options = DEFAULT_OPTIONS) {
  const windowSize = Math.max(6, Number(options.duplicateWindow) || 12);
  const seenWholeTexts = new Set();
  const seenShingles = new Set();
  const contributions = [];

  for (const rawSwipe of Array.isArray(swipes) ? swipes : []) {
    const chars = normalizedCharacters(rawSwipe, options);
    const normalized = chars.join('');

    if (!normalized || seenWholeTexts.has(normalized)) {
      contributions.push(0);
      continue;
    }

    const duplicateMask = new Uint8Array(chars.length);
    if (chars.length >= windowSize) {
      for (let i = 0; i <= chars.length - windowSize; i++) {
        const key = chars.slice(i, i + windowSize).join('');
        if (!seenShingles.has(key)) continue;
        duplicateMask.fill(1, i, i + windowSize);
      }
    }

    let novelHan = 0;
    for (let i = 0; i < chars.length; i++) {
      if (!duplicateMask[i] && HAN_RE.test(chars[i])) novelHan++;
    }
    contributions.push(novelHan);

    seenWholeTexts.add(normalized);
    for (const item of shingles(chars, windowSize)) seenShingles.add(item);
  }

  return {
    total: contributions.reduce((sum, value) => sum + value, 0),
    contributions,
  };
}

export function selectedSwipeText(message) {
  const swipes = Array.isArray(message?.swipes) ? message.swipes : [];
  if (!swipes.length) return String(message?.mes ?? '');
  const index = Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
  return String(swipes[index] ?? message?.mes ?? swipes[0] ?? '');
}

function hashString(value) {
  let hash = 0x811c9dc5;
  for (const char of String(value ?? '')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function messageNodeKey(message, messageIndex) {
  const role = message.is_user ? 'user' : message.is_system ? 'system' : 'assistant';
  const sentAt = parseDate(message.send_date)?.getTime() ?? String(message.send_date ?? '');
  const generatedAt = parseDate(message.gen_started)?.getTime() ?? String(message.gen_started ?? '');
  const stableIdentity = [
    role,
    messageIndex,
    sentAt,
    generatedAt,
  ].join('|');

  if (sentAt || generatedAt) return stableIdentity;

  return hashString([
    stableIdentity,
    message.mes ?? '',
    ...(Array.isArray(message.swipes) ? message.swipes : []),
  ].join('|'));
}

export function normalizeMessages(chat) {
  if (!Array.isArray(chat)) return [];
  return chat.filter(item =>
    item &&
    typeof item === 'object' &&
    (
      Object.hasOwn(item, 'mes') ||
      Array.isArray(item.swipes) ||
      Object.hasOwn(item, 'is_user')
    )
  );
}

function addBucket(buckets, key, patch) {
  if (!key) return;
  if (!buckets[key]) {
    buckets[key] = {
      messages: 0,
      selectedHan: 0,
      uniqueSwipeHan: 0,
      rerolls: 0,
    };
  }
  for (const [field, value] of Object.entries(patch)) {
    buckets[key][field] = (buckets[key][field] || 0) + (Number(value) || 0);
  }
}

export function analyzeChat(chat, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const messages = normalizeMessages(chat);
  const buckets = {};
  let selectedHan = 0;
  let uniqueSwipeHan = 0;
  let rerollCount = 0;
  let userMessages = 0;
  let assistantMessages = 0;
  const messageEntries = [];

  messages.forEach((message, messageIndex) => {
    const isOpening = config.ignoreOpeningMessage &&
      messageIndex === 0 &&
      !message.is_user;
    const selected = cleanContent(selectedSwipeText(message), config);
    const selectedCount = isOpening ? 0 : countHan(selected);
    const swipes = Array.isArray(message.swipes) && message.swipes.length
      ? message.swipes
      : [message.mes ?? ''];
    const unique = message.is_user
      ? { total: 0, contributions: swipes.map(() => 0) }
      : countUniqueSwipeHan(swipes, config);
    const rerolls = isOpening || message.is_user ? 0 : Math.max(0, swipes.length - 1);
    const messageDay = dateKey(message.send_date);
    const entryBuckets = {};

    if (message.is_user) userMessages++;
    else assistantMessages++;

    if (!isOpening) {
      selectedHan += selectedCount;
      uniqueSwipeHan += unique.total;
      rerollCount += rerolls;
      addBucket(buckets, messageDay, {
        messages: 1,
        selectedHan: selectedCount,
        rerolls,
      });
      addBucket(entryBuckets, messageDay, {
        messages: 1,
        selectedHan: selectedCount,
        rerolls,
      });

      unique.contributions.forEach((amount, swipeIndex) => {
        const swipeDay = dateKey(message.swipe_info?.[swipeIndex]?.send_date) || messageDay;
        addBucket(buckets, swipeDay, { uniqueSwipeHan: amount });
        addBucket(entryBuckets, swipeDay, { uniqueSwipeHan: amount });
      });

      messageEntries.push({
        nodeKey: messageNodeKey(message, messageIndex),
        messageIndex,
        isUser: Boolean(message.is_user),
        selectedHan: selectedCount,
        uniqueSwipeHan: unique.total,
        rerollCount: rerolls,
        dateBuckets: entryBuckets,
      });
    }
  });

  const activeDates = Object.keys(buckets).sort();
  return {
    messageCount: messages.length,
    countedMessageCount: Math.max(0, messages.length - (
      config.ignoreOpeningMessage && messages[0] && !messages[0].is_user ? 1 : 0
    )),
    userMessages,
    assistantMessages,
    selectedHan,
    uniqueSwipeHan,
    rerollCount,
    activeDays: activeDates.length,
    firstDate: activeDates[0] || null,
    lastDate: activeDates.at(-1) || null,
    dateBuckets: buckets,
    messageEntries,
  };
}

export function emptyStats() {
  return {
    chatCount: 0,
    messageCount: 0,
    countedMessageCount: 0,
    userMessages: 0,
    assistantMessages: 0,
    selectedHan: 0,
    uniqueSwipeHan: 0,
    rerollCount: 0,
    activeDays: 0,
    firstDate: null,
    lastDate: null,
    dateBuckets: {},
  };
}

export function aggregateStats(items) {
  const total = emptyStats();
  const dates = new Set();
  const uniqueEntries = new Map();
  const legacyItems = [];

  for (const item of items || []) {
    const stats = item?.stats || item;
    if (!stats) continue;
    total.chatCount++;

    if (!Array.isArray(stats.messageEntries)) {
      legacyItems.push(stats);
      continue;
    }

    const characterKey = item?.characterAvatar || item?.characterName || '';
    for (const entry of stats.messageEntries) {
      const key = `${characterKey}::${entry.nodeKey}`;
      const existing = uniqueEntries.get(key);
      const score = (Number(entry.selectedHan) || 0) +
        (Number(entry.uniqueSwipeHan) || 0) +
        (Number(entry.rerollCount) || 0);
      const existingScore = existing
        ? (Number(existing.selectedHan) || 0) +
          (Number(existing.uniqueSwipeHan) || 0) +
          (Number(existing.rerollCount) || 0)
        : -1;
      if (!existing || score > existingScore) uniqueEntries.set(key, entry);
    }
  }

  for (const entry of uniqueEntries.values()) {
    total.messageCount++;
    total.countedMessageCount++;
    if (entry.isUser) total.userMessages++;
    else total.assistantMessages++;
    total.selectedHan += Number(entry.selectedHan) || 0;
    total.uniqueSwipeHan += Number(entry.uniqueSwipeHan) || 0;
    total.rerollCount += Number(entry.rerollCount) || 0;
    for (const [key, bucket] of Object.entries(entry.dateBuckets || {})) {
      dates.add(key);
      addBucket(total.dateBuckets, key, bucket);
    }
  }

  for (const stats of legacyItems) {
    for (const field of [
      'messageCount',
      'countedMessageCount',
      'userMessages',
      'assistantMessages',
      'selectedHan',
      'uniqueSwipeHan',
      'rerollCount',
    ]) {
      total[field] += Number(stats[field]) || 0;
    }
    for (const [key, bucket] of Object.entries(stats.dateBuckets || {})) {
      dates.add(key);
      addBucket(total.dateBuckets, key, bucket);
    }
  }

  const sorted = Array.from(dates).sort();
  total.activeDays = sorted.length;
  total.firstDate = sorted[0] || null;
  total.lastDate = sorted.at(-1) || null;
  return total;
}
