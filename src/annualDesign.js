import { annualStats, groupRecords } from './collections.js';
import { cleanContent, selectedSwipeText, dateKey, normalizeMessages } from './statsCore.js';

export const TEMPLATES = { crafted: '精工 · 柔光手记', poster: '杂志 · 字体海报', archive: '档案 · 年度编年' };
export const PAGE_TITLES = ['年度序章', '年度偏爱', '舍不得晚安', '最热闹的一天', '连续陪伴', '留在这一年的话'];
export const TOKENS = ['年份', '活跃天数', '字数', '消息数', '角色数', '偏爱角色', '偏爱天数', '偏爱字数', '最晚时间', '最晚日期', '最晚角色', '峰值日期', '峰值消息', '峰值角色', '连续天数', '摘录'];
const format = n => Number(n || 0).toLocaleString('zh-CN');
export function fillTokens(text, values) {
  return String(text).replace(/\{([^{}]+)\}/g, (whole, key) => Object.hasOwn(values, key) ? String(values[key]) : whole);
}

export function recapData(records, preferences, year, nightEnd = 6) {
  const stats = annualStats(records, year);
  const groups = groupRecords(stats.records, preferences).map(group => ({ ...group, annual: annualStats(group.records, year) }));
  const favorite = [...groups].sort((a, b) => b.annual.selectedHan - a.annual.selectedHan)[0];
  const peak = stats.peak?.[1].messages ? stats.peak : null;
  const peakGroup = peak && [...groups].sort((a, b) => (b.annual.dateBuckets[peak[0]]?.messages || 0) - (a.annual.dateBuckets[peak[0]]?.messages || 0))[0];
  let latest = null;
  for (const group of groups) for (const record of group.records) for (const entry of record.stats.messageEntries || []) {
    if (!entry.sentDay?.startsWith(`${year}-`) || !Number.isInteger(entry.sentMinute)) continue;
    // Evening (18:00 onward) precedes the following morning in a night session.
    const minute = entry.sentMinute;
    if (minute >= nightEnd * 60 && minute < 18 * 60) continue;
    const rank = minute < nightEnd * 60 ? minute + 1440 : minute;
    if (!latest || rank > latest.rank || (rank === latest.rank && entry.sentDay > latest.day)) {
      latest = { rank, minute, day: entry.sentDay, name: group.name };
    }
  }
  const values = {
    年份: year, 活跃天数: stats.activeDays, 字数: format(stats.selectedHan), 消息数: format(stats.countedMessageCount), 角色数: groups.length,
    偏爱角色: favorite?.name || '尚无记录', 偏爱天数: favorite?.annual.activeDays || 0, 偏爱字数: format(favorite?.annual.selectedHan),
    最晚时间: latest ? `${String(Math.floor(latest.minute / 60)).padStart(2, '0')}:${String(latest.minute % 60).padStart(2, '0')}` : '—:—',
    最晚日期: latest?.day || '暂无带时间的记录', 最晚角色: latest?.name || '尚无记录',
    峰值日期: peak?.[0] || '暂无记录', 峰值消息: format(peak?.[1].messages), 峰值角色: peakGroup?.name || '尚无记录',
    连续天数: stats.longest, 摘录: '点击“换一组摘录”，从年度偏爱的真实聊天中拾起几句话。',
  };
  return { stats, groups, favorite, latest, values };
}

function text(id, value, x, y, size, width = 600, extra = {}) {
  return { id, type: 'text', text: value, x, y, size, width, lineHeight: 1.48, align: 'left', font: 'serif', ink: 'text', ...extra };
}
export function defaultPages(template = 'crafted') {
  const pages = [
    [text('year', '{年份}', 52, 130, 152, 620, { ink: 'accent' }), text('title', '这一年，\n故事没有散场。', 56, 350, 54), text('body', '{活跃天数} 个日子，我们在这里见面。\n{消息数} 条消息，{字数} 个字。', 58, 660, 27)],
    [text('label', '翻过很多故事，\n还是最常回到你。', 56, 150, 28), text('hero', '{偏爱角色}', 54, 345, 76, 590), text('number', '{偏爱天数}', 55, 590, 146, 420, { ink: 'accent' }), text('body', '天有过对话\n这一年，为你停留了 {偏爱字数} 字。', 58, 815, 25)],
    [text('clock', '{最晚时间}', 46, 160, 150, 630, { ink: 'accent' }), text('title', '已经这个点了，\n我们还在聊。', 60, 440, 52), text('body', '{最晚日期}\n{最晚角色} · 舍不得说晚安。', 60, 780, 26)],
    [text('date', '{峰值日期}', 56, 150, 55, 610, { ink: 'accent' }), text('title', '那一天，\n消息像雨一样落下。', 58, 330, 48), text('number', '{峰值消息}', 58, 590, 146, 605, { align: 'right', ink: 'accent' }), text('body', '条消息，留下同一天的回声。\n最常聊：{峰值角色}', 58, 835, 26)],
    [text('label', '把平凡的日子，连成故事。', 56, 160, 31), text('number', '{连续天数}', 56, 350, 200, 600, { ink: 'accent', align: 'center' }), text('body', '天，连续见面。\n不是约定，却成了习惯。', 58, 730, 31, 600, { align: 'center' })],
    [text('title', '有些话，\n想再读一次。', 56, 130, 47), text('quotes', '{摘录}', 60, 310, 25, 594, { font: 'system', lineHeight: 1.65 })],
  ];
  return pages.map((nodes, i) => {
    if (template === 'poster') {
      nodes.forEach(node => { node.font = 'system'; node.weight = '600'; });
      if (i === 0) { nodes[0].y = 740; nodes[0].size = 125; nodes[1].y = 170; nodes[1].size = 66; nodes[2].y = 495; }
      if (i === 1) { nodes[1].y = 315; nodes[1].size = 88; nodes[2].align = 'right'; nodes[2].width = 600; }
      if (i === 2) { nodes[0].y = 245; nodes[0].size = 145; nodes[1].y = 480; }
      if (i === 3) { nodes[0].size = 44; nodes[0].y = 115; nodes[2].y = 530; nodes[2].size = 180; }
    }
    if (template === 'archive') {
      nodes.forEach(node => { node.x = 140; node.width = Math.min(node.width, 510); node.size *= .82; });
      if (i === 0) { nodes[0].y = 145; nodes[0].size = 98; nodes[1].y = 345; }
      if (i === 2) { nodes[0].size = 112; }
      if (i === 5) { nodes[1].size = 23; nodes[1].y = 310; }
    }
    return { id: `page-${i}`, kind: i, title: PAGE_TITLES[i], background: null, blur: 0, veil: .2, cropX: 50, cropY: 50, nodes };
  });
}

export function quoteCandidates(chat, year, mode, options = {}) {
  const messages = normalizeMessages(chat);
  const result = [];
  messages.forEach((message, index) => {
    if (message.is_user || message.is_system || (index === 0 && options.ignoreOpeningMessage !== false)) return;
    const day = dateKey(message.send_date);
    if (!day?.startsWith(`${year}-`)) return;
    // Remove hidden reasoning and executable/style blocks before stripping tags.
    const content = cleanContent(selectedSwipeText(message), { excludeThinking: true })
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&(?:lt|gt|amp|quot|#39);/g, match => ({ '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'" }[match]))
      .trim();
    const pieces = mode === 'long' ? content.split(/\n\s*\n|\r?\n/) : content.match(/[^。！？!?\n]+[。！？!?]?/gu) || [];
    for (const raw of pieces) {
      const value = raw.trim();
      if (mode === 'long' ? value.length >= 65 && value.length <= 250 : value.length >= 8 && value.length <= 45) result.push({ text: value, day });
    }
  });
  return result;
}
export function sampleQuotes(candidates, mode, random = Math.random) {
  const unique = [...new Map(candidates.map(item => [item.text.replace(/\s/g, ''), item])).values()];
  for (let i = unique.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [unique[i], unique[j]] = [unique[j], unique[i]]; }
  return unique.slice(0, mode === 'long' ? 2 : 5);
}
