import {
  aggregateStats,
  DEFAULT_OPTIONS,
} from './statsCore.js';
import { analyzeChatAsync } from './statsAnalyzer.js';

const SETTINGS_KEY = 'st-reader-stats.settings.v1';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatNumber(value) {
  return (Number(value) || 0).toLocaleString('zh-CN');
}

function mapLimit(items, limit, worker) {
  const queue = [...items];
  const results = [];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      results.push(await worker(item));
    }
  });
  return Promise.all(runners).then(() => results);
}

function bucketValue(bucket, metric) {
  return Number(bucket?.[metric]) || 0;
}

function heatLevel(value, max) {
  if (!value) return 0;
  const ratio = value / Math.max(1, max);
  if (ratio <= 0.15) return 1;
  if (ratio <= 0.4) return 2;
  if (ratio <= 0.7) return 3;
  return 4;
}

export class StatsDashboard {
  constructor({ adapter, cache }) {
    this.adapter = adapter;
    this.cache = cache;
    this.root = null;
    this.activeTab = 'current';
    this.currentDirty = true;
    this.currentStats = null;
    this.characterRecords = [];
    this.globalRecords = [];
    this.abortController = null;
    this.currentAnalysisController = null;
    this.currentAnalysisId = 0;
    this.dirtyChatIds = new Set();
    this.settings = this.loadSettings();
  }

  loadSettings() {
    try {
      return {
        ...DEFAULT_OPTIONS,
        ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'),
      };
    } catch {
      return { ...DEFAULT_OPTIONS };
    }
  }

  saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  mount() {
    this.addMenuButton();
    this.addSettingsPanel();
  }

  addMenuButton() {
    if (document.getElementById('st-reader-stats-menu-button')) return;
    const menu = document.querySelector('#extensionsMenu');
    if (!menu) {
      setTimeout(() => this.addMenuButton(), 1000);
      return;
    }

    const button = document.createElement('div');
    button.id = 'st-reader-stats-menu-button';
    button.className = 'list-group-item flex-container flexGap5 interactable';
    button.tabIndex = 0;
    button.innerHTML = `
      <i class="fa-solid fa-chart-simple"></i>
      <span>阅读统计</span>
    `;
    button.addEventListener('click', () => this.open('current'));
    button.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') this.open('current');
    });
    menu.append(button);
  }

  addSettingsPanel() {
    if (document.getElementById('st-reader-stats-settings')) return;
    const host = document.querySelector('#extensions_settings2');
    if (!host) return;

    const panel = document.createElement('div');
    panel.id = 'st-reader-stats-settings';
    panel.className = 'st-reader-stats-settings';
    panel.innerHTML = `
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>ST Reader Stats</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <p>当前聊天、角色与全局阅读统计；全部数据只保存在本机浏览器。</p>
          <label class="checkbox_label">
            <input id="st-reader-stats-ignore-opening" type="checkbox">
            <span>统计时忽略角色开场白</span>
          </label>
          <label for="st-reader-stats-window">Swipe 重复片段阈值</label>
          <input id="st-reader-stats-window" class="text_pole" type="number" min="6" max="40">
          <div class="st-reader-stats-settings-actions">
            <button id="st-reader-stats-open" class="menu_button">打开统计</button>
            <button id="st-reader-stats-clear" class="menu_button">清空索引</button>
          </div>
        </div>
      </div>
    `;
    host.append(panel);

    const ignore = panel.querySelector('#st-reader-stats-ignore-opening');
    const windowInput = panel.querySelector('#st-reader-stats-window');
    ignore.checked = this.settings.ignoreOpeningMessage;
    windowInput.value = this.settings.duplicateWindow;
    ignore.addEventListener('change', () => {
      this.settings.ignoreOpeningMessage = ignore.checked;
      this.saveSettings();
      this.invalidateAll();
    });
    windowInput.addEventListener('change', () => {
      this.settings.duplicateWindow = Math.max(6, Math.min(40, Number(windowInput.value) || 12));
      windowInput.value = this.settings.duplicateWindow;
      this.saveSettings();
      this.invalidateAll();
    });
    panel.querySelector('#st-reader-stats-open').addEventListener('click', () => this.open('current'));
    panel.querySelector('#st-reader-stats-clear').addEventListener('click', async () => {
      await this.cache.clear();
      this.globalRecords = [];
      this.characterRecords = [];
      globalThis.toastr?.success?.('统计索引已清空');
    });
  }

  invalidateAll() {
    this.currentDirty = true;
    this.currentStats = null;
    this.characterRecords = [];
    this.globalRecords = [];
    this.cache.clear().catch(console.error);
  }

  markCurrentChatDirty() {
    this.currentDirty = true;
    this.characterRecords = [];
    this.globalRecords = [];
    const identity = this.adapter.currentChatIdentity();
    if (identity) this.dirtyChatIds.add(identity);
    if (this.root && this.activeTab === 'current') this.renderCurrent();
  }

  handleChatChanged() {
    this.currentDirty = true;
    this.currentStats = null;
    this.characterRecords = [];
    if (this.root && !this.root.hidden) this.activate(this.activeTab);
  }

  open(tab = 'current') {
    this.activeTab = tab;
    if (!this.root) this.createOverlay();
    this.root.hidden = false;
    document.body.classList.add('st-reader-stats-open');
    this.renderShell();
    this.activate(tab);
  }

  close() {
    this.abortController?.abort();
    this.currentAnalysisController?.abort();
    if (this.root) this.root.hidden = true;
    document.body.classList.remove('st-reader-stats-open');
  }

  createOverlay() {
    this.root = document.createElement('div');
    this.root.id = 'st-reader-stats-root';
    this.root.className = 'st-reader-stats-overlay';
    this.root.addEventListener('click', event => {
      if (event.target === this.root) this.close();
      if (event.target.closest('[data-action="cancel-scan"]')) this.close();
    });
    document.body.append(this.root);
  }

  renderShell() {
    this.root.innerHTML = `
      <section class="st-reader-stats-dialog" role="dialog" aria-modal="true" aria-label="阅读统计">
        <header class="st-reader-stats-header">
          <div>
            <h2>阅读统计</h2>
            <p>选中内容与全部 Swipe 去重生成量分开计算</p>
          </div>
          <button class="st-reader-stats-icon-button" data-action="close" aria-label="关闭">×</button>
        </header>
        <nav class="st-reader-stats-tabs">
          <button data-tab="current">当前聊天</button>
          <button data-tab="character">当前角色</button>
          <button data-tab="global">全局总览</button>
        </nav>
        <main class="st-reader-stats-content"></main>
      </section>
    `;
    this.root.querySelector('[data-action="close"]').addEventListener('click', () => this.close());
    this.root.querySelectorAll('[data-tab]').forEach(button => {
      button.addEventListener('click', () => this.activate(button.dataset.tab));
    });
  }

  activate(tab) {
    this.activeTab = tab;
    this.root.querySelectorAll('[data-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.tab === tab);
    });
    if (tab === 'current') this.renderCurrent();
    if (tab === 'character') this.renderCharacter();
    if (tab === 'global') this.renderGlobal();
  }

  content() {
    return this.root.querySelector('.st-reader-stats-content');
  }

  async renderCurrent() {
    const character = this.adapter.currentCharacter();
    if (!this.currentDirty && this.currentStats) {
      this.content().innerHTML = this.statsView(
        character ? `${character.name} · 当前聊天` : '当前聊天',
        this.currentStats,
        { showChats: false },
      );
      this.bindMetricToggle();
      return;
    }

    const requestId = ++this.currentAnalysisId;
    this.currentAnalysisController?.abort();
    this.currentAnalysisController = new AbortController();
    this.content().innerHTML = this.loadingView('正在后台统计当前聊天…');

    try {
      const stats = await analyzeChatAsync(
        this.adapter.currentChat(),
        this.settings,
        { signal: this.currentAnalysisController.signal },
      );
      if (requestId !== this.currentAnalysisId || this.activeTab !== 'current') return;
      this.currentStats = stats;
      this.currentDirty = false;
      this.content().innerHTML = this.statsView(
        character ? `${character.name} · 当前聊天` : '当前聊天',
        stats,
        { showChats: false },
      );
      this.bindMetricToggle();
    } catch (error) {
      if (error.name !== 'AbortError' && requestId === this.currentAnalysisId) {
        this.renderError(error);
      }
    }
  }

  async renderCharacter() {
    const character = this.adapter.currentCharacter();
    if (!character) {
      this.content().innerHTML = this.emptyView('当前没有选中单人角色', '群聊暂不纳入角色级索引。');
      return;
    }

    this.content().innerHTML = this.loadingView(`正在检查 ${escapeHtml(character.name)} 的聊天索引…`);
    try {
      this.abortController?.abort();
      this.abortController = new AbortController();
      this.characterRecords = await this.scanCharacter(
        character,
        false,
        progress => this.updateProgress(progress),
        this.abortController.signal,
      );
      if (this.activeTab !== 'character') return;
      const total = aggregateStats(this.characterRecords);
      this.content().innerHTML = this.statsView(character.name, total, { showChats: true }) +
        this.chatListView(this.characterRecords);
      this.bindMetricToggle();
      this.bindReindex(() => this.forceCharacter(character));
    } catch (error) {
      if (error.name !== 'AbortError') this.renderError(error);
    }
  }

  async forceCharacter(character) {
    this.content().innerHTML = this.loadingView(`正在重新索引 ${escapeHtml(character.name)}…`);
    this.abortController?.abort();
    this.abortController = new AbortController();
    try {
      this.characterRecords = await this.scanCharacter(
        character,
        true,
        progress => this.updateProgress(progress),
        this.abortController.signal,
      );
      const total = aggregateStats(this.characterRecords);
      this.content().innerHTML = this.statsView(character.name, total, { showChats: true }) +
        this.chatListView(this.characterRecords);
      this.bindMetricToggle();
      this.bindReindex(() => this.forceCharacter(character));
    } catch (error) {
      if (error.name !== 'AbortError') this.renderError(error);
    }
  }

  async renderGlobal(force = false) {
    const characters = this.adapter.characters();
    if (!characters.length) {
      this.content().innerHTML = this.emptyView('还没有可统计的角色', '导入角色并创建聊天后再来看看。');
      return;
    }

    if (this.globalRecords.length && !force) {
      this.renderGlobalResults(this.globalRecords);
      return;
    }

    this.content().innerHTML = this.loadingView(`准备扫描 ${characters.length} 个角色…`);
    this.abortController?.abort();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const allRecords = [];
      for (let i = 0; i < characters.length; i++) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const character = characters[i];
        const records = await this.scanCharacter(character, force, progress => {
          this.updateProgress({
            label: `${character.name} · ${progress.label}`,
            current: i + (progress.current / Math.max(1, progress.total)),
            total: characters.length,
          });
        }, signal);
        allRecords.push(...records);
      }
      this.globalRecords = allRecords;
      if (this.activeTab === 'global') this.renderGlobalResults(allRecords);
    } catch (error) {
      if (error.name !== 'AbortError') this.renderError(error);
    }
  }

  renderGlobalResults(records) {
    const total = aggregateStats(records);
    const byCharacter = new Map();
    for (const record of records) {
      const key = record.characterAvatar;
      if (!byCharacter.has(key)) {
        byCharacter.set(key, {
          name: record.characterName,
          records: [],
        });
      }
      byCharacter.get(key).records.push(record);
    }

    const characterCards = Array.from(byCharacter.values())
      .map(group => ({ ...group, stats: aggregateStats(group.records) }))
      .sort((a, b) => b.stats.selectedHan - a.stats.selectedHan)
      .map(group => `
        <article class="st-reader-stats-character-card">
          <h4>${escapeHtml(group.name)}</h4>
          <span>${formatNumber(group.stats.chatCount)} 个聊天</span>
          <strong>${formatNumber(group.stats.selectedHan)} 字</strong>
          <small>去重生成 ${formatNumber(group.stats.uniqueSwipeHan)} 字</small>
        </article>
      `).join('');

    this.content().innerHTML = this.statsView(
      `全部角色 · ${byCharacter.size} 个角色`,
      total,
      { showChats: true },
    ) + `
      <section class="st-reader-stats-section">
        <div class="st-reader-stats-section-title">
          <h3>角色排行</h3>
        </div>
        <div class="st-reader-stats-character-grid">${characterCards || '<p>暂无聊天</p>'}</div>
      </section>
    `;
    this.bindMetricToggle();
    this.bindReindex(() => this.renderGlobal(true));
  }

  async scanCharacter(character, force, onProgress, signal) {
    const descriptors = await this.adapter.listCharacterChats(character, signal);
    const validIds = descriptors.map(item => this.cache.id(item));
    await this.cache.removeMissing(character.avatar, validIds);
    let completed = 0;

    const records = await mapLimit(descriptors, 2, async descriptor => {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const normalizedId = `${descriptor.characterAvatar}::${String(descriptor.fileName).replace(/\.jsonl$/i, '')}`;
      const locallyDirty = this.dirtyChatIds.has(normalizedId);
      const cached = force || locallyDirty ? null : await this.cache.get(descriptor);
      let record;
      if (
        cached &&
        cached.schemaVersion === 1 &&
        cached.fingerprint === descriptor.fingerprint
      ) {
        record = cached;
      } else {
        const chat = await this.adapter.loadChat(descriptor, signal);
        const stats = await analyzeChatAsync(chat, this.settings, { signal });
        record = await this.cache.put(descriptor, stats);
        this.dirtyChatIds.delete(normalizedId);
      }
      completed++;
      onProgress?.({
        label: cached ? '读取缓存' : '分析聊天',
        current: completed,
        total: descriptors.length,
      });
      return record;
    });

    return records.sort((a, b) =>
      String(b.lastMessage).localeCompare(String(a.lastMessage))
    );
  }

  updateProgress({ label, current, total }) {
    const progress = this.content().querySelector('.st-reader-stats-progress');
    const text = this.content().querySelector('.st-reader-stats-progress-text');
    if (progress) progress.value = total ? current / total : 0;
    if (text) text.textContent = `${label} · ${Math.floor(current)}/${total}`;
  }

  statsView(title, stats, { showChats }) {
    return `
      <section class="st-reader-stats-summary">
        <div class="st-reader-stats-title-row">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <p>${stats.firstDate || '暂无日期'} — ${stats.lastDate || '暂无日期'}</p>
          </div>
          ${showChats ? '<button class="menu_button st-reader-stats-reindex">重新索引</button>' : ''}
        </div>
        <div class="st-reader-stats-cards">
          ${showChats ? this.statCard('聊天', stats.chatCount, '份') : ''}
          ${this.statCard('消息', stats.countedMessageCount, '条')}
          ${this.statCard('选中内容', stats.selectedHan, '汉字', true)}
          ${this.statCard('Swipe 去重生成', stats.uniqueSwipeHan, '汉字')}
          ${this.statCard('Reroll', stats.rerollCount, '次')}
          ${this.statCard('活跃', stats.activeDays, '天')}
        </div>
        <div class="st-reader-stats-note">
          “选中内容”只计算每层当前采用的 swipe；“去重生成”会计算全部 swipe，
          连续重复片段不再次计数。
        </div>
      </section>
      ${this.heatmapView(stats)}
    `;
  }

  statCard(label, value, unit, featured = false) {
    return `
      <article class="st-reader-stats-card ${featured ? 'featured' : ''}">
        <span>${label}</span>
        <strong>${formatNumber(value)}</strong>
        <small>${unit}</small>
      </article>
    `;
  }

  heatmapView(stats) {
    const years = Array.from(new Set(
      Object.keys(stats.dateBuckets || {}).map(key => Number(key.slice(0, 4))),
    )).filter(Boolean).sort((a, b) => b - a);
    const currentYear = years[0] || new Date().getFullYear();
    return `
      <section class="st-reader-stats-section st-reader-stats-heatmap-section"
        data-buckets="${escapeHtml(JSON.stringify(stats.dateBuckets || {}))}"
        data-year="${currentYear}">
        <div class="st-reader-stats-section-title">
          <h3>全局热力图</h3>
          <div class="st-reader-stats-heatmap-controls">
            <select class="text_pole st-reader-stats-metric">
              <option value="selectedHan">选中内容汉字</option>
              <option value="uniqueSwipeHan">Swipe 去重生成</option>
              <option value="messages">消息数</option>
              <option value="rerolls">Reroll 次数</option>
            </select>
            <select class="text_pole st-reader-stats-year">
              ${(years.length ? years : [currentYear]).map(year =>
                `<option value="${year}">${year}</option>`
              ).join('')}
            </select>
          </div>
        </div>
        <div class="st-reader-stats-heatmap"></div>
        <div class="st-reader-stats-legend">
          <span>少</span><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>多</span>
        </div>
      </section>
    `;
  }

  drawHeatmap(container, buckets, year, metric) {
    const first = new Date(year, 0, 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    const end = new Date(year, 11, 31);
    const days = [];
    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const key = [
        cursor.getFullYear(),
        String(cursor.getMonth() + 1).padStart(2, '0'),
        String(cursor.getDate()).padStart(2, '0'),
      ].join('-');
      days.push({
        key,
        inYear: cursor.getFullYear() === Number(year),
        value: bucketValue(buckets[key], metric),
      });
    }
    while (days.length % 7) days.push({ key: '', inYear: false, value: 0 });
    const max = Math.max(0, ...days.map(day => day.value));
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

    container.innerHTML = `
      <div class="st-reader-stats-week-labels">
        <span>日</span><span></span><span>二</span><span></span><span>四</span><span></span><span>六</span>
      </div>
      <div class="st-reader-stats-weeks">
        ${weeks.map(week => `
          <div class="st-reader-stats-week">
            ${week.map(day => `
              <i class="level-${day.inYear ? heatLevel(day.value, max) : 'empty'}"
                title="${day.inYear ? `${day.key}：${formatNumber(day.value)}` : ''}"></i>
            `).join('')}
          </div>
        `).join('')}
      </div>
    `;
  }

  bindMetricToggle() {
    const section = this.content().querySelector('.st-reader-stats-heatmap-section');
    if (!section) return;
    const buckets = JSON.parse(section.dataset.buckets || '{}');
    const metric = section.querySelector('.st-reader-stats-metric');
    const year = section.querySelector('.st-reader-stats-year');
    const target = section.querySelector('.st-reader-stats-heatmap');
    const redraw = () => this.drawHeatmap(target, buckets, Number(year.value), metric.value);
    metric.addEventListener('change', redraw);
    year.addEventListener('change', redraw);
    redraw();
  }

  bindReindex(callback) {
    this.content().querySelector('.st-reader-stats-reindex')
      ?.addEventListener('click', callback);
  }

  chatListView(records) {
    const rows = records.map(record => `
      <tr>
        <td title="${escapeHtml(record.fileName)}">${escapeHtml(record.fileName)}</td>
        <td>${formatNumber(record.stats.countedMessageCount)}</td>
        <td>${formatNumber(record.stats.selectedHan)}</td>
        <td>${formatNumber(record.stats.uniqueSwipeHan)}</td>
        <td>${formatNumber(record.stats.rerollCount)}</td>
      </tr>
    `).join('');
    return `
      <section class="st-reader-stats-section">
        <div class="st-reader-stats-section-title"><h3>聊天明细</h3></div>
        <div class="st-reader-stats-table-wrap">
          <table>
            <thead><tr><th>聊天</th><th>消息</th><th>选中汉字</th><th>去重生成</th><th>Reroll</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5">暂无聊天</td></tr>'}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  loadingView(label) {
    return `
      <div class="st-reader-stats-loading">
        <div class="st-reader-stats-spinner"></div>
        <h3>${label}</h3>
        <progress class="st-reader-stats-progress" max="1" value="0"></progress>
        <p class="st-reader-stats-progress-text">正在读取聊天列表…</p>
        <button class="menu_button" data-action="cancel-scan">取消</button>
      </div>
    `;
  }

  emptyView(title, text) {
    return `<div class="st-reader-stats-empty"><h3>${title}</h3><p>${text}</p></div>`;
  }

  renderError(error) {
    console.error('[st-reader-stats]', error);
    this.content().innerHTML = `
      <div class="st-reader-stats-error">
        <h3>统计时出了点岔子</h3>
        <p>${escapeHtml(error?.message || error)}</p>
      </div>
    `;
  }
}
