import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChat, sentMinute } from '../src/statsCore.js';
import { recapData, fillTokens, defaultPages, quoteCandidates, sampleQuotes, squarePage } from '../src/annualDesign.js';
import { exportLayout } from '../src/artRenderer.js';

test('grid and individual pages are square without stretching artwork', () => {
  const layout = exportLayout(6, 'grid');
  assert.equal(layout.width, 2256);
  assert.equal(layout.height, 2256);
  assert.deepEqual(layout.positions[1], { x: 768, y: 396 });
  assert.deepEqual(layout.positions[3], { x: 24, y: 1140 });
  assert.equal(exportLayout(5, 'grid').height, layout.height);
  assert.equal(exportLayout(6, 'long').height, 4320);
  assert.equal(exportLayout(1, 'single').width, 1440);
  assert.equal(exportLayout(1, 'single').height, 1440);
});

test('square migration preserves content and is idempotent', () => {
  const old = { nodes: [{ type: 'text', y: 900, size: 40, text: '我的文字', font: 'chio', width: 500 }] };
  const migrated = squarePage(old);
  assert.equal(migrated.nodes[0].text, '我的文字');
  assert.equal(migrated.nodes[0].font, 'chio');
  assert.equal(migrated.nodes[0].width, 500);
  assert.equal(old.nodes[0].y, 900);
  assert.deepEqual(squarePage(migrated), migrated);
  for (const template of ['crafted', 'poster', 'archive']) {
    assert.ok(defaultPages(template).every(page => page.format === 'square'));
  }
});

test('quote picker offers up to thirty unique candidates without changing source', () => {
  const candidates = Array.from({length: 40}, (_, i) => ({text: `候选摘录${i}`, day: '2026-01-01'}));
  const snapshot = structuredClone(candidates);
  const picked = sampleQuotes([...candidates, ...candidates], 'long', () => .5, 30);
  assert.equal(picked.length, 30);
  assert.equal(new Set(picked.map(q => q.text)).size, 30);
  assert.deepEqual(candidates, snapshot);
});

test('late-night time orders evening before morning and excludes date-only messages', () => {
  const stats = analyzeChat([
    { is_user: true, mes: '晚上', send_date: '2026-05-01T23:59:00' },
    { is_user: true, mes: '凌晨', send_date: '2026-05-02T03:47:00' },
    { is_user: true, mes: '早起', send_date: '2026-05-02T07:00:00' },
    { is_user: true, mes: '只有日期', send_date: '2026/05/02' },
  ], { ignoreOpeningMessage: false });
  const records = [{ characterAvatar: 'a', characterName: '角色', stats }];
  assert.equal(recapData(records, {}, 2026, 6).values.最晚时间, '03:47');
  assert.equal(recapData(records, {}, 2026, 8).values.最晚时间, '07:00');
  assert.equal(sentMinute('2026/05/02'), null);
  assert.equal(sentMinute('2026-05-02T00:00:00'), 0);
});
test('template text keeps dynamic values and user-authored unknown tokens', () => {
  assert.equal(fillTokens('一起 {活跃天数} 天。{自己的话}', { 活跃天数: 12 }), '一起 12 天。{自己的话}');
  const a = defaultPages('crafted'), b = defaultPages('poster'), c = defaultPages('archive');
  assert.equal(a.length, 6);
  assert.notDeepEqual(a, b); assert.notDeepEqual(b, c);
  a[0].nodes[0].text = '修改';
  assert.equal(defaultPages()[0].nodes[0].text, '{年份}');
});
test('quotes use selected assistant replies only, remove hidden text, and dedupe branches', () => {
  const reply = '窗外的雨还没有停，我们还有很长的时间。';
  const input = [
    { mes: '角色开场白不会作为摘录。', send_date: '2026-01-01' },
    { mes: '用户说的话不应当被选中。', is_user: true, send_date: '2026-01-01' },
    { mes: '旧版本的话不要入选。', swipes: ['旧版本的话不要入选。', `<think>隐藏推理内容不能出现。</think><style>隐藏样式内容不能出现。</style><b>${reply}</b>`], swipe_id: 1, send_date: '2026-01-02' },
    { mes: reply, send_date: '2025-01-01' },
  ];
  const candidates = quoteCandidates(input, 2026, 'short');
  assert.deepEqual(candidates, [{ text: reply, day: '2026-01-02' }]);
  assert.equal(sampleQuotes([...candidates, ...candidates], 'short').length, 1);
});
