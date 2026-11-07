import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChat } from '../src/statsCore.js';
import { groupRecords, recordKey, annualStats } from '../src/collections.js';

const record = (avatar, file, messages) => ({ characterAvatar: avatar, characterName: avatar, fileName: file, stats: analyzeChat(messages, { ignoreOpeningMessage: false }) });
test('merge cards, override one save and split another without mutating records', () => {
  const a = record('a', 'one', [{ mes: '你好', is_user: true, send_date: '2026-01-01' }]);
  const b = record('b', 'two', [{ mes: '你好', is_user: true, send_date: '2026-01-01' }]);
  const c = record('a', 'three', []);
  const prefs = { cards: { a: { group: '一起' }, b: { group: '一起' } }, chats: {} };
  assert.equal(groupRecords([a, b], prefs)[0].stats.countedMessageCount, 2);
  prefs.chats[recordKey(b)] = { separate: true };
  prefs.chats[recordKey(c)] = { group: '世界线' };
  assert.equal(groupRecords([a, b, c], prefs).length, 3);
  assert.equal(a.characterAvatar, 'a');
  delete prefs.chats[recordKey(b)];
  assert.equal(groupRecords([a, b], prefs).length, 1);
});
test('independent chats use custom titles and notes without merging equal names', () => {
  const a = record('a', 'one', []), b = record('a', 'two', []);
  const prefs = { cards: { a: { group: '整卡组' } }, chats: {
    [recordKey(a)]: { separate: true, group: ' 同一个标题 ', note: '我的存档备注' },
    [recordKey(b)]: { separate: true, group: '同一个标题' },
  } };
  const before = structuredClone(prefs);
  const groups = groupRecords([a, b], prefs);
  assert.equal(groups.length, 2);
  assert.notEqual(groups[0].key, groups[1].key);
  assert.equal(groups[0].name, '同一个标题');
  assert.equal(groups[1].name, '同一个标题');
  assert.equal(groups[0].note, '我的存档备注');
  assert.deepEqual(prefs, before);
  prefs.chats[recordKey(a)].group = '   ';
  const fallback = groupRecords([a], prefs)[0];
  assert.equal(fallback.name, 'one');
  assert.equal(fallback.key, groups[0].key);
  assert.equal(fallback.note, '我的存档备注');
});

test('year boundaries, branch dedupe, peak day and leap-day streak', () => {
  const messages = [
    { mes: '去年', is_user: true, send_date: '2023-12-31T23:59:00' },
    { mes: '你好', is_user: true, send_date: '2024-02-28T01:00:00' },
    { mes: '你好', is_user: true, send_date: '2024-02-29T02:00:00' },
    { mes: '你好', is_user: true, send_date: '2024-03-01' },
  ];
  const a = record('a', 'one', messages), b = record('a', 'branch', messages);
  const stats = annualStats([a, b], 2024);
  assert.equal(stats.selectedHan, 6);
  assert.equal(stats.countedMessageCount, 3);
  assert.equal(stats.nightMessages, 2);
  assert.equal(stats.longest, 3);
  assert.equal(stats.peak[0], '2024-02-28');
  assert.equal(annualStats([a], 2025).countedMessageCount, 0);
});
test('a later-year swipe adds generated characters but no sent message', () => {
  const a = record('a', 'one', [{ mes: '你好', is_user: false, send_date: '2025-12-31', swipes: ['你好', '世界'], swipe_info: [{ send_date: '2025-12-31' }, { send_date: '2026-01-01' }] }]);
  const stats = annualStats([a], 2026);
  assert.equal(stats.countedMessageCount, 0);
  assert.equal(stats.selectedHan, 0);
  assert.equal(stats.uniqueSwipeHan, 2);
});
