import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateStats,
  analyzeChat,
  countHan,
  countUniqueSwipeHan,
} from '../src/statsCore.js';

test('countHan counts Han characters only', () => {
  assert.equal(countHan('你好，world！123'), 2);
});

test('exact duplicate swipes contribute zero', () => {
  const result = countUniqueSwipeHan(['你好世界。', '你好世界。']);
  assert.deepEqual(result.contributions, [4, 0]);
  assert.equal(result.total, 4);
});

test('long repeated swipe prefix is not counted twice', () => {
  const common = '这是一个足够长而且会被完整重复计算的中文片段。';
  const result = countUniqueSwipeHan([
    `${common}第一种结尾。`,
    `${common}第二种结尾。`,
  ], { duplicateWindow: 8 });
  assert.ok(result.contributions[1] < countHan(`${common}第二种结尾。`));
  assert.ok(result.contributions[1] >= countHan('二种结尾'));
});

test('selected and all-swipe unique counts stay separate', () => {
  const common = '她抬起头看向窗外，夜色落在安静的街道上。';
  const stats = analyzeChat([
    { mes: '开场白', is_user: false, send_date: '2026-01-01' },
    { mes: '你好', is_user: true, send_date: '2026-01-02' },
    {
      mes: `${common}旧结尾。`,
      is_user: false,
      swipes: [`${common}旧结尾。`, `${common}新结尾。`],
      swipe_id: 1,
      send_date: '2026-01-02',
    },
  ], { duplicateWindow: 8 });

  assert.equal(stats.rerollCount, 1);
  assert.equal(stats.selectedHan, countHan('你好') + countHan(`${common}新结尾。`));
  assert.ok(stats.uniqueSwipeHan > stats.selectedHan - countHan('你好'));
  assert.ok(stats.uniqueSwipeHan < countHan(`${common}旧结尾。${common}新结尾。`));
  assert.equal(stats.dateBuckets['2026-01-02'].messages, 2);
});

test('aggregateStats merges date buckets', () => {
  const first = analyzeChat([
    { mes: '你好', is_user: true, send_date: '2026-02-01' },
  ], { ignoreOpeningMessage: false });
  const second = analyzeChat([
    { mes: '世界', is_user: true, send_date: '2026-02-01' },
  ], { ignoreOpeningMessage: false });
  const total = aggregateStats([first, second]);
  assert.equal(total.chatCount, 2);
  assert.equal(total.selectedHan, 4);
  assert.equal(total.activeDays, 1);
  assert.equal(total.dateBuckets['2026-02-01'].messages, 2);
});
