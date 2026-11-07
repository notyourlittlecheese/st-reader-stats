import { groupRecords, recordKey, annualStats } from './collections.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = value => Number(value || 0).toLocaleString('zh-CN');
const field = (label, value, attrs = '') => `<label>${label}<input class="text_pole" type="text" maxlength="500" value="${esc(value)}" ${attrs}></label>`;

export function renderCollections(dashboard, records) {
  const prefs = dashboard.settings.collections || { cards: {}, chats: {}, notes: {} };
  const cards = new Map();
  records.forEach(record => {
    if (!cards.has(record.characterAvatar)) cards.set(record.characterAvatar, []);
    cards.get(record.characterAvatar).push(record);
  });
  const entries = [...cards];
  dashboard.content().innerHTML = `<section class="st-reader-stats-section st-reader-stats-editor">
    <h3>我的统计分组</h3>
    <div class="srs-group-save"><button type="button" data-save>保存分组与备注</button><span role="status" data-status></span></div>
    <p>多张卡填同一个组名即可合并；存档组名优先于角色卡组名，留空则继承。独立统计优先于组名。分组只改变展示，不修改聊天文件。</p>
    <p>不同卡的对话分别计数；同一卡的分支历史继续去重。拆开的组分别展示，全局仍对共享历史去重，组别数字相加可能大于全局。</p>
    <p>设置保存在当前浏览器，清空索引不会删除。可导出备份，在手机导入。</p>
    <button type="button" data-export>导出分组备份</button> <label>导入备份 <input type="file" accept="application/json" data-import></label>
    ${entries.map(([avatar, chats], i) => `<details><summary>${esc(chats[0].characterName)} · ${chats.length} 个存档</summary>
      ${field('整卡归入哪个组（同名即合并）', prefs.cards?.[avatar]?.group, `data-card="${i}"`)}
      ${chats.map((record, j) => { const rule = prefs.chats?.[recordKey(record)] || {}; return `<div class="st-reader-stats-rule" data-rule="${i}:${j}">
        <strong>${esc(record.fileName)}</strong>
        ${field('此存档单独归组（留空跟随整卡）', rule.group, 'data-group')}
        <label><input type="checkbox" data-separate ${rule.separate ? 'checked' : ''}> 此存档独立统计</label>
        ${field('存档备注', rule.note, 'data-note')}
      </div>`; }).join('')}</details>`).join('')}
    <h3>统计组备注与热力图</h3><div data-group-list></div>
  </section>`;
  const host = dashboard.content();
  const status = text => { host.querySelector('[data-status]').textContent = text; };
  const savePrefs = next => {
    const previous = dashboard.settings.collections;
    dashboard.settings.collections = next;
    try { dashboard.saveSettings(); } catch (error) { dashboard.settings.collections = previous; throw error; }
  };
  host.querySelector('[data-save]').onclick = () => {
    const next = JSON.parse(JSON.stringify(prefs));
    next.cards ||= {}; next.chats ||= {}; next.notes ||= {};
    entries.forEach(([avatar, chats], i) => {
      next.cards[avatar] = { group: host.querySelector(`[data-card="${i}"]`).value.trim() };
      chats.forEach((record, j) => {
        const row = host.querySelector(`[data-rule="${i}:${j}"]`);
        next.chats[recordKey(record)] = { group: row.querySelector('[data-group]').value.trim(), separate: row.querySelector('[data-separate]').checked, note: row.querySelector('[data-note]').value };
      });
    });
    try { savePrefs(next); renderCollections(dashboard, records); dashboard.content().querySelector('[data-status]').textContent = '已保存，下次打开会沿用。'; }
    catch (error) { status(`保存失败：${error.message}`); }
  };
  const groups = groupRecords(records, prefs);
  host.querySelector('[data-group-list]').innerHTML = groups.map((group, i) => `<div class="st-reader-stats-rule"><h4>${esc(group.name)}</h4>
    <p>${num(group.stats.selectedHan)} 字 · ${num(group.stats.countedMessageCount)} 条</p>
    ${field('统计组备注（修改后自动保存）', prefs.notes?.[group.key], `data-group-note="${i}"`)}
    <button type="button" data-view="${i}">查看本组热力图</button></div>`).join('');
  host.querySelectorAll('[data-group-note]').forEach(input => { input.onchange = () => {
    const next = JSON.parse(JSON.stringify(dashboard.settings.collections || prefs)); next.notes ||= {};
    next.notes[groups[Number(input.dataset.groupNote)].key] = input.value;
    try { savePrefs(next); prefs.notes = next.notes; status('组备注已保存'); } catch (error) { status(`保存失败：${error.message}`); }
  }; });
  host.querySelectorAll('[data-view]').forEach(button => { button.onclick = () => {
    const group = groups[Number(button.dataset.view)];
    host.innerHTML = '<button type="button" data-back>返回分组</button>' + dashboard.statsView(group.name, group.stats, { showChats: true }) + dashboard.chatListView(group.records);
    host.querySelector('[data-back]').onclick = () => renderCollections(dashboard, records);
    dashboard.bindMetricToggle();
    host.querySelector('.st-reader-stats-reindex')?.remove();
  }; });
  host.querySelector('[data-export]').onclick = () => {
    const blob = new Blob([JSON.stringify({ version: 1, collections: dashboard.settings.collections || prefs }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'reader-stats-groups.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  host.querySelector('[data-import]').onchange = async event => {
    try {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 2000000) throw new Error('备份文件过大');
      const data = JSON.parse(await file.text());
      if (data.version !== 1 || !data.collections) throw new Error('不支持的备份格式');
      const safe = { cards: {}, chats: {}, notes: {} };
      for (const kind of ['cards', 'chats', 'notes']) {
        for (const [key, value] of Object.entries(data.collections[kind] || {})) {
          if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
          safe[kind][key] = kind === 'notes' ? String(value).slice(0, 500) : { group: String(value?.group || '').slice(0, 500), note: String(value?.note || '').slice(0, 500), separate: value?.separate === true };
        }
      }
      if (!globalThis.confirm('导入将替换当前浏览器的分组与备注，继续吗？')) return;
      savePrefs(safe); renderCollections(dashboard, records);
    } catch (error) { status(`导入失败：${error.message}`); }
  };
}

export function renderAnnual(dashboard, records, year = new Date().getFullYear()) {
  const years = [...new Set([String(year), ...records.flatMap(record => Object.keys(record.stats.dateBuckets || {}).map(day => day.slice(0, 4)))])].sort().reverse();
  const stats = annualStats(records, year);
  const groups = groupRecords(stats.records, dashboard.settings.collections).map(group => ({ ...group, annual: annualStats(group.records, year) }));
  const favorite = [...groups].sort((a, b) => b.annual.selectedHan - a.annual.selectedHan)[0];
  const night = [...groups].sort((a, b) => b.annual.nightMessages - a.annual.nightMessages)[0];
  const peakGroup = stats.peak && [...groups].sort((a, b) => (b.annual.dateBuckets[stats.peak[0]]?.messages || 0) - (a.annual.dateBuckets[stats.peak[0]]?.messages || 0))[0];
  const card = (title, main, detail) => `<article class="st-reader-stats-section"><p>${esc(title)}</p><h2>${esc(main)}</h2><p>${esc(detail)}</p></article>`;
  dashboard.content().innerHTML = `<section class="st-reader-stats-section"><h3>我的 ${esc(year)} · 年度阅读手记</h3>
    <label>选择年份 <select data-annual-year>${years.map(value => `<option ${Number(value) === Number(year) ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
    <p>按当前分组展示；使用聊天记录的日期和本设备时区，缺少日期的消息不进入年度统计。消息包含双方，凌晨指 00:00–04:59，不代表在线时长。可在“分组与备注”调整归属。</p></section>
    <div class="st-reader-stats-year-grid">
    ${card('这一年，你留下了', `${num(stats.selectedHan)} 字`, `${num(stats.countedMessageCount)} 条消息 · ${stats.activeDays} 个活跃日 · ${groups.length} 个统计组`)}
    ${card('年度偏爱 · 按选中汉字', favorite?.name || '还没有记录', favorite ? `${num(favorite.annual.selectedHan)} 字，${favorite.annual.activeDays} 天有过对话` : '这一年暂无可用日期')}
    ${card('最热闹的一天', stats.peak?.[1].messages ? stats.peak[0] : '还没有记录', stats.peak?.[1].messages ? `${num(stats.peak[1].messages)} 条消息，当天聊得最多：${peakGroup?.name || ''}` : '')}
    ${card('深夜同伴 · 按凌晨消息数', night?.annual.nightMessages ? night.name : '暂无凌晨记录', night?.annual.nightMessages ? `${num(night.annual.nightMessages)} 条凌晨消息` : '不会把只有日期的旧记录当成午夜')}
    ${card('最长连续陪伴', `${stats.longest} 天`, '按有消息的自然日计算')}
    </div>`;
  dashboard.content().querySelector('[data-annual-year]').onchange = event => renderAnnual(dashboard, records, Number(event.target.value));
}
