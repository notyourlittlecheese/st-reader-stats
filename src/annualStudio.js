import { artStore, FONT_SLOTS, loadArtFonts, installFont } from './artStore.js';
import { TEMPLATES, TOKENS, defaultPages, recapData, quoteCandidates, sampleQuotes } from './annualDesign.js';
import { drawArtwork, PAGE_WIDTH, PAGE_HEIGHT, hexColor, exportLayout } from './artRenderer.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const toBlob = canvas => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片导出失败')), 'image/png'));
const loadImage = source => new Promise((resolve, reject) => {
  const image = new Image();
  const timeout = setTimeout(() => { image.onload = image.onerror = null; image.src = ''; reject(new Error('图片读取超时，请检查角色头像后重试')); }, 15000);
  image.onload = () => { clearTimeout(timeout); resolve(image); };
  image.onerror = () => { clearTimeout(timeout); reject(new Error('图片加载失败')); };
  image.src = source;
});

export async function openAnnualStudio(dashboard, records) {
  dashboard.annualStudio?.dispose();
  const studio = new AnnualStudio(dashboard, records);
  dashboard.annualStudio = studio;
  try { await studio.init(); } catch (error) { if (!studio.disposed) dashboard.renderError(error); }
}

export class AnnualStudio {
  constructor(dashboard, records) {
    this.dashboard = dashboard; this.records = records; this.host = dashboard.content();
    this.year = new Date().getFullYear(); this.template = 'crafted'; this.index = 0;
    this.edit = false; this.selected = null; this.images = new Map(); this.undo = []; this.redo = [];
    this.view = 'grid';
    this.saveQueue = Promise.resolve(); this.quoteController = null; this.disposed = false; this.loadId = 0;
  }
  get page() { return this.doc.pages[this.index]; }
  get key() { return `layout:v1:${this.year}:${this.template}`; }
  async init() {
    this.host.innerHTML = this.dashboard.loadingView('正在打开年度排版…');
    this.fonts = await loadArtFonts();
    if (this.disposed) return;
    const last = await artStore('get', 'studio:last');
    if (last && Object.hasOwn(TEMPLATES, last.template)) this.template = last.template;
    if (Number.isInteger(last?.year)) this.year = last.year;
    await this.loadDocument();
  }
  async loadDocument() {
    const request = ++this.loadId;
    this.quoteController?.abort();
    await this.saveQueue;
    const saved = await artStore('get', this.key);
    if (this.disposed || request !== this.loadId) return;
    this.doc = saved?.version === 1 ? saved : { version: 1, pages: defaultPages(this.template), nightEnd: 6, quoteMode: 'long', quotes: [], quoteContext: '' };
    this.index = 0; this.selected = null; this.undo = []; this.redo = [];
    this.data = recapData(this.records, this.dashboard.settings.collections, this.year, this.doc.nightEnd);
    await this.loadImages();
    if (this.disposed || request !== this.loadId) return;
    this.render();
    await artStore('put', 'studio:last', { year: this.year, template: this.template });
  }
  async switchDocument(year, template) {
    if (this.transitioning) return;
    this.transitioning = true;
    const previous = { year: this.year, template: this.template, doc: this.doc, data: this.data, index: this.index };
    try {
      await this.saveQueue;
      this.year = year; this.template = template;
      this.host.innerHTML = this.dashboard.loadingView('正在切换年度排版…');
      await this.loadDocument();
    } catch (error) {
      Object.assign(this, previous);
      if (!this.disposed) { this.render(); this.status(`切换失败：${error.message}`); }
    } finally { this.transitioning = false; }
  }
  async image(key) {
    if (!key || this.images.has(key)) return;
    if (key.startsWith('avatar:')) {
      const avatar = key.slice(7);
      this.images.set(key, await loadImage(`/thumbnail?type=avatar&file=${encodeURIComponent(avatar)}`));
    } else {
      const blob = await artStore('get', key);
      if (!blob) throw new Error('找不到本地图片，请重新上传');
      const url = URL.createObjectURL(blob);
      try { this.images.set(key, await loadImage(url)); } finally { URL.revokeObjectURL(url); }
    }
  }
  async loadImages() {
    this.missingImages = 0;
    for (const page of this.doc.pages) {
      const keys = [page.background, ...page.nodes.filter(node => node.type === 'avatar').map(node => node.source)].filter(Boolean);
      for (const key of keys) { try { await this.image(key); } catch { this.missingImages++; } }
    }
  }
  values() {
    const favoriteKey = this.data.favorite?.key || '';
    const quotes = this.doc.quoteContext === `${this.year}:${favoriteKey}` ? this.doc.quotes : [];
    return { ...this.data.values, ...(quotes.length ? { 摘录: quotes.map(q => `“${q.text}”\n— ${q.day}`).join('\n\n') } : {}) };
  }
  status(text) { if (!this.disposed) { const node = this.host.querySelector('[data-art-status]'); if (node) node.textContent = text; } }
  remember() { this.undo.push(clone(this.doc)); if (this.undo.length > 30) this.undo.shift(); this.redo = []; }
  save() {
    const key = this.key, snapshot = clone(this.doc);
    this.status('正在保存…');
    this.saveQueue = this.saveQueue.catch(() => {}).then(() => artStore('put', key, snapshot));
    this.saveQueue.then(() => this.status('已自动保存到当前浏览器'), error => this.status(`未能保存：${error.message}。请勿刷新，释放存储空间后重试。`));
    return this.saveQueue;
  }
  change(fn, rerender = false) { this.remember(); fn(); this.save(); if (rerender) this.render(); else this.draw(); }
  render() {
    if (this.disposed) return;
    const years = [...new Set([String(this.year), String(new Date().getFullYear()), ...this.records.flatMap(record => Object.keys(record.stats.dateBuckets || {}).map(day => day.slice(0, 4)))])].sort().reverse();
    this.host.innerHTML = `<div class="srs-studio">
      <div class="srs-studio-toolbar">
        <label>年份 <select data-year>${years.map(y => `<option ${Number(y) === this.year ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
        <label>模板 <select data-template>${Object.entries(TEMPLATES).map(([key, name]) => `<option value="${key}" ${key === this.template ? 'selected' : ''}>${name}</option>`).join('')}</select></label>
        <button type="button" data-view-mode>${this.view === 'grid' ? '单页预览' : '宫格预览'}</button>
        <button type="button" data-edit>${this.edit ? '完成编辑' : '编辑排版'}</button>
        <button type="button" data-export-grid>导出宫格 PNG</button><button type="button" data-export-page>导出本页 PNG</button><button type="button" data-export-all>导出整份长图</button>
        <button type="button" data-save-art>保存</button>
      </div>
      <p class="srs-studio-status" data-art-status role="status">${this.missingImages ? '部分图片未能加载，请在编辑模式重新选择或上传。' : '布局和素材保存在当前浏览器；切换模板会保留各自排版。'}</p>
      <div class="srs-art-grid" ${this.view === 'grid' ? '' : 'hidden'}>${this.doc.pages.map((page, i) => `<button type="button" data-grid-page="${i}" aria-label="编辑第 ${i + 1} 页：${esc(page.title)}"><canvas data-grid-canvas="${i}"></canvas><span>${i + 1} / ${esc(page.title)} · 点按编辑</span></button>`).join('')}</div>
      <div class="srs-studio-layout ${this.edit ? 'is-editing' : ''}" ${this.view === 'grid' ? 'hidden' : ''}>
        <div class="srs-stage-wrap"><canvas class="srs-stage" aria-label="年度总结画布" tabindex="0"></canvas>
          <nav class="srs-page-nav"><button type="button" data-prev>上一页</button><select data-page>${this.doc.pages.map((p, i) => `<option value="${i}" ${i === this.index ? 'selected' : ''}>${i + 1}. ${esc(p.title)}</option>`).join('')}</select><button type="button" data-next>下一页</button></nav>
          <p class="srs-stage-help">${this.edit ? '点选文字或头像；手机长按后拖动。靠近中线自动对齐，也可在右侧/下方微调位置。' : '查看模式 · 点“编辑排版”修改文案、字体、背景和头像。'}</p>
        </div>
        <aside class="srs-inspector" ${this.edit ? '' : 'hidden'}>
          <div class="srs-art-actions"><button type="button" data-undo ${this.undo.length ? '' : 'disabled'}>撤销</button><button type="button" data-redo ${this.redo.length ? '' : 'disabled'}>重做</button><button type="button" data-reset>恢复本页模板</button><button type="button" data-copy>复制本页</button><button type="button" data-delete-page>删除本页</button></div>
          <label>本页名称 <input data-page-title maxlength="40" value="${esc(this.page.title)}"></label>
          <label>选中元素 <select data-node><option value="">请选择</option>${this.page.nodes.map(node => `<option value="${esc(node.id)}" ${node.id === this.selected ? 'selected' : ''}>${esc(node.type === 'avatar' ? '角色头像' : node.text.slice(0, 25))}</option>`).join('')}</select></label>
          <div data-node-fields></div>
          <button type="button" data-add-text>插入文字</button>
          <label>插入角色头像 <select data-avatar><option value="">选择角色卡（合并组可任选）</option>${this.dashboard.adapter.characters().map(c => `<option value="${esc(c.avatar)}">${esc(c.name)}</option>`).join('')}</select></label>
          <details><summary>本页背景</summary>
            <label>上传背景 <input data-background type="file" accept="image/png,image/jpeg,image/webp"></label><button type="button" data-remove-bg>移除本页背景</button>
            ${this.range('背景模糊', 'blur', 0, 30, this.page.blur)}${this.range('遮罩深浅', 'veil', 0, 100, this.page.veil * 100)}${this.range('背景水平位置', 'cropX', 0, 100, this.page.cropX)}${this.range('背景垂直位置', 'cropY', 0, 100, this.page.cropY)}
          </details>
          <details><summary>导入字体 · 本机保存</summary><p>选择对应 TTF / OTF 文件，导出的图片会保留字体效果。</p>
            ${Object.entries(FONT_SLOTS).map(([key, label]) => `<label>${label} ${this.fonts[key] ? '✓ 已导入' : ''}<input type="file" data-font-upload="${key}" accept=".ttf,.otf,.woff,.woff2"></label>`).join('')}
          </details>
        </aside>
      </div>
      <details class="srs-recap-options"><summary>摘录与统计口径</summary>
        <p>年度偏爱按选中汉字排序，沿用自定义分组。消息含双方；时间采用本设备时区，不代表在线时长。最晚聊天查找晚上 18 点至次日截止时间的记录。</p>
        <label>凌晨截止 <select data-night-end>${[3, 4, 5, 6, 7, 8].map(n => `<option value="${n}" ${n === this.doc.nightEnd ? 'selected' : ''}>${n}:00（不含）</option>`).join('')}</select></label>
        <label>摘录长度 <select data-quote-mode><option value="long" ${this.doc.quoteMode === 'long' ? 'selected' : ''}>长段 1—2 条</option><option value="short" ${this.doc.quoteMode === 'short' ? 'selected' : ''}>短句 4—5 条</option></select></label>
        <button type="button" data-quotes>换一组真实摘录</button>
        <p>仅在点击后读取年度偏爱组的聊天，取角色当前选中的回复、过滤重复片段。结果不足时显示实际条数；选中的摘录随本年度作品保存在本机。</p>
      </details>
    </div>`;
    const q = selector => this.host.querySelector(selector);
    const run = fn => () => Promise.resolve().then(fn).catch(error => this.status(error.message));
    q('[data-year]').onchange = event => this.switchDocument(Number(event.target.value), this.template);
    q('[data-template]').onchange = event => this.switchDocument(this.year, event.target.value);
    q('[data-edit]').onclick = () => { this.edit = !this.edit; this.view = this.edit ? 'single' : 'grid'; this.selected = null; this.render(); };
    q('[data-view-mode]').onclick = () => { this.view = this.view === 'grid' ? 'single' : 'grid'; this.edit = false; this.selected = null; this.render(); };
    this.host.querySelectorAll('[data-grid-page]').forEach(button => { button.onclick = () => { this.view = 'single'; this.edit = true; this.go(Number(button.dataset.gridPage)); }; });
    q('[data-save-art]').onclick = run(() => this.save());
    q('[data-export-page]').onclick = run(() => this.export(false)); q('[data-export-all]').onclick = run(() => this.export(true));
    q('[data-export-grid]').onclick = run(() => this.export('grid'));
    q('[data-page]').onchange = event => this.go(Number(event.target.value));
    q('[data-prev]').onclick = () => this.go(this.index - 1); q('[data-next]').onclick = () => this.go(this.index + 1);
    q('[data-prev]').disabled = this.index === 0; q('[data-next]').disabled = this.index === this.doc.pages.length - 1;
    q('[data-node]').onchange = event => { this.selected = event.target.value; this.renderNodeFields(); this.draw(); };
    q('[data-page-title]').onchange = event => this.change(() => { this.page.title = event.target.value; }, true);
    q('[data-undo]').onclick = () => this.history(false); q('[data-redo]').onclick = () => this.history(true);
    q('[data-reset]').onclick = () => {
      if (!confirm('恢复本页的默认排版和背景？其他页面保持不变，可撤销。')) return;
      this.change(() => { this.doc.pages[this.index] = { ...defaultPages(this.template)[this.page.kind], id: this.page.id }; this.selected = null; }, true);
    };
    q('[data-copy]').onclick = () => {
      if (this.doc.pages.length >= 12) return this.status('最多保存 12 页，请先删除不需要的复制页。');
      this.change(() => { this.doc.pages.splice(this.index + 1, 0, { ...clone(this.page), id: uid() }); this.index++; }, true);
    };
    q('[data-delete-page]').onclick = () => {
      if (this.doc.pages.length <= 1) return this.status('至少保留一页');
      if (!confirm('删除本页？可撤销。')) return;
      this.change(() => { this.doc.pages.splice(this.index, 1); this.index = Math.min(this.index, this.doc.pages.length - 1); this.selected = null; }, true);
    };
    q('[data-add-text]').onclick = () => this.change(() => { const id = uid(); this.page.nodes.push({ id, type: 'text', text: '在这里写下你的话', x: 60, y: 500, width: 590, size: 28, lineHeight: 1.5, align: 'left', font: 'system', ink: 'text' }); this.selected = id; }, true);
    q('[data-avatar]').onchange = run(async () => {
      const avatar = q('[data-avatar]').value; if (!avatar) return;
      const page = this.page, request = this.loadId;
      const source = `avatar:${avatar}`; await this.image(source); if (this.disposed || request !== this.loadId) return;
      this.change(() => { const id = uid(); page.nodes.push({ id, type: 'avatar', source, x: 510, y: 110, width: 140, shape: 'circle' }); if (page === this.page) this.selected = id; }, true);
    });
    q('[data-background]').onchange = run(async () => {
      const file = q('[data-background]').files[0]; if (!file) return;
      if (file.size > 25 * 1024 * 1024) throw new Error('背景请控制在 25 MB 内');
      const page = this.page, request = this.loadId;
      const url = URL.createObjectURL(file); let image;
      try { image = await loadImage(url); } finally { URL.revokeObjectURL(url); }
      const canvas = document.createElement('canvas'), factor = Math.min(1, 1800 / Math.max(image.width, image.height));
      canvas.width = image.width * factor; canvas.height = image.height * factor; canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await toBlob(canvas), key = `background:${uid()}`;
      await artStore('put', key, blob); await this.image(key);
      if (this.disposed || request !== this.loadId) return;
      this.change(() => { page.background = key; }, true);
    });
    q('[data-remove-bg]').onclick = () => this.change(() => { this.page.background = null; }, true);
    this.host.querySelectorAll('[data-bg-range]').forEach(input => { input.onchange = () => this.change(() => { this.page[input.dataset.bgRange] = Number(input.value) / (input.dataset.bgRange === 'veil' ? 100 : 1); }); });
    this.host.querySelectorAll('[data-font-upload]').forEach(input => { input.onchange = run(async () => {
      const file = input.files[0]; if (!file) return;
      if (file.size > 40 * 1024 * 1024) throw new Error('字体请控制在 40 MB 内');
      const slot = input.dataset.fontUpload;
      await installFont(slot, file); await artStore('put', `font:${slot}`, file); this.fonts[slot] = true;
      if (!this.disposed) { this.render(); this.status(`${FONT_SLOTS[slot]}已导入，可在元素字体中选择`); }
    }); });
    q('[data-night-end]').onchange = event => this.change(() => { this.doc.nightEnd = Number(event.target.value); this.data = recapData(this.records, this.dashboard.settings.collections, this.year, this.doc.nightEnd); });
    q('[data-quote-mode]').onchange = event => this.change(() => { this.doc.quoteMode = event.target.value; });
    q('[data-quotes]').onclick = run(() => this.refreshQuotes());
    this.renderNodeFields(); this.draw(); this.bindDrag();
  }
  range(label, key, min, max, value) { return `<label>${label}<input type="range" min="${min}" max="${max}" value="${value}" data-bg-range="${key}"></label>`; }
  go(index) { this.index = clamp(index, 0, this.doc.pages.length - 1); this.selected = null; this.render(); }
  history(forward) {
    const from = forward ? this.redo : this.undo, to = forward ? this.undo : this.redo;
    if (!from.length) return;
    to.push(clone(this.doc)); this.doc = from.pop(); this.index = Math.min(this.index, this.doc.pages.length - 1); this.selected = null;
    this.data = recapData(this.records, this.dashboard.settings.collections, this.year, this.doc.nightEnd);
    this.save(); this.render();
  }
  renderNodeFields() {
    const node = this.page.nodes.find(n => n.id === this.selected), fields = this.host.querySelector('[data-node-fields]');
    const chooser = this.host.querySelector('[data-node]'); if (chooser) chooser.value = this.selected || '';
    if (!node) { fields.innerHTML = '<p>先在画布上点选，或从上方选择元素。</p>'; return; }
    const number = (label, key, min, max, value) => `<label>${label}<input type="number" data-prop="${key}" min="${min}" max="${max}" value="${value}"></label>`;
    fields.innerHTML = `<div class="srs-node-fields">
      ${node.type === 'text' ? `<label>文案（数字占位符自动更新）<textarea data-copy-text rows="5" maxlength="4000">${esc(node.text)}</textarea></label>
        <label>插入统计数字 <select data-token><option value="">选择占位符</option>${TOKENS.map(t => `<option>${esc(t)}</option>`).join('')}</select></label>
        <label>字体 <select data-font><option value="system" ${node.font === 'system' ? 'selected' : ''}>系统黑体</option><option value="serif" ${node.font === 'serif' ? 'selected' : ''}>系统宋体</option>${Object.entries(FONT_SLOTS).map(([id, label]) => `<option value="${id}" ${node.font === id ? 'selected' : ''} ${this.fonts[id] ? '' : 'disabled'}>${label}${this.fonts[id] ? '' : '（先导入）'}</option>`).join('')}</select></label>
        ${number('字号（长文会自动缩小以免重叠）', 'size', 12, 220, node.size)}
        <label>对齐 <select data-align>${['left', 'center', 'right'].map((value, i) => `<option value="${value}" ${node.align === value ? 'selected' : ''}>${['左', '中', '右'][i]}</option>`).join('')}</select></label>
        <label>颜色 <select data-ink><option value="text" ${node.ink === 'text' ? 'selected' : ''}>正文色</option><option value="accent" ${node.ink === 'accent' ? 'selected' : ''}>主题色</option><option value="custom" ${!['text', 'accent'].includes(node.ink) ? 'selected' : ''}>自选</option></select><input type="color" data-ink-color value="${hexColor(node.ink, '#282831')}"></label>` : `<label>头像形状 <select data-shape>${['circle', 'rounded', 'original'].map((value, i) => `<option value="${value}" ${node.shape === value ? 'selected' : ''}>${['圆形', '圆角', '原比例'][i]}</option>`).join('')}</select></label>`}
      <div class="srs-position-fields">${number('横向位置', 'x', 0, 680, node.x)}${number('纵向位置', 'y', 90, 950, node.y)}${number('宽度', 'width', 40, 680, node.width)}</div>
      <div class="srs-art-actions"><button type="button" data-layer="back">下移一层</button><button type="button" data-layer="front">上移一层</button><button type="button" data-remove-node>删除元素</button></div>
    </div>`;
    const q = selector => fields.querySelector(selector);
    if (node.type === 'text') {
      q('[data-copy-text]').onchange = event => this.change(() => { node.text = event.target.value; });
      q('[data-token]').onchange = event => {
        if (!event.target.value) return;
        const input = q('[data-copy-text]'), token = `{${event.target.value}}`;
        const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start;
        this.change(() => { node.text = input.value.slice(0, start) + token + input.value.slice(end); });
        input.value = node.text; event.target.value = '';
      };
      q('[data-font]').onchange = event => this.change(() => { node.font = event.target.value; });
      q('[data-align]').onchange = event => this.change(() => { node.align = event.target.value; });
      q('[data-ink]').onchange = event => this.change(() => { node.ink = event.target.value === 'custom' ? q('[data-ink-color]').value : event.target.value; });
      q('[data-ink-color]').onchange = event => this.change(() => { node.ink = event.target.value; q('[data-ink]').value = 'custom'; });
    } else q('[data-shape]').onchange = event => this.change(() => { node.shape = event.target.value; });
    fields.querySelectorAll('[data-prop]').forEach(input => { input.onchange = () => {
      const value = clamp(Number(input.value) || Number(input.min), Number(input.min), Number(input.max));
      this.change(() => { node[input.dataset.prop] = value; }); input.value = value;
    }; });
    fields.querySelectorAll('[data-layer]').forEach(button => { button.onclick = () => this.change(() => {
      const from = this.page.nodes.indexOf(node), to = clamp(from + (button.dataset.layer === 'front' ? 1 : -1), 0, this.page.nodes.length - 1);
      this.page.nodes.splice(from, 1); this.page.nodes.splice(to, 0, node);
    }, true); });
    q('[data-remove-node]').onclick = () => this.change(() => { this.page.nodes = this.page.nodes.filter(n => n !== node); this.selected = null; }, true);
  }
  draw(guides = false) {
    if (this.disposed) return;
    const canvas = this.host.querySelector('.srs-stage'); if (!canvas) return;
    if (this.view === 'grid') {
      this.host.querySelectorAll('[data-grid-canvas]').forEach(preview => drawArtwork(preview, this.doc.pages[Number(preview.dataset.gridCanvas)], this.template, this.values(), { accent: hexColor(this.dashboard.settings.accent, '#ed4777'), images: this.images, scale: .5 }));
      return;
    }
    this.boxes = drawArtwork(canvas, this.page, this.template, this.values(), { accent: hexColor(this.dashboard.settings.accent, '#ed4777'), images: this.images, selected: this.edit ? this.selected : null, guides });
    this.host.querySelector('[data-undo]')?.toggleAttribute('disabled', !this.undo.length);
    this.host.querySelector('[data-redo]')?.toggleAttribute('disabled', !this.redo.length);
  }
  bindDrag() {
    const canvas = this.host.querySelector('.srs-stage'); let drag = null, timer;
    const point = event => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * PAGE_WIDTH / rect.width, y: (event.clientY - rect.top) * PAGE_HEIGHT / rect.height }; };
    canvas.onpointerdown = event => {
      if (!this.edit) return;
      const p = point(event), box = [...this.boxes].reverse().find(b => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height);
      if (!box) { this.selected = null; this.renderNodeFields(); this.draw(); return; }
      this.selected = box.id; this.renderNodeFields(); this.draw();
      const node = this.page.nodes.find(n => n.id === box.id);
      drag = { node, start: p, x: node.x, y: node.y, active: event.pointerType !== 'touch', moved: false };
      canvas.setPointerCapture(event.pointerId);
      timer = setTimeout(() => { if (drag) drag.active = true; }, 280);
    };
    canvas.onpointermove = event => {
      if (!drag?.active) return;
      const p = point(event), dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      if (!drag.moved) { this.remember(); drag.moved = true; }
      let x = clamp(drag.x + dx, 0, 720 - drag.node.width);
      const center = 360 - drag.node.width / 2, snap = Math.abs(x - center) < 9;
      if (snap) x = center;
      drag.node.x = Math.round(x); drag.node.y = Math.round(clamp(drag.y + dy, 90, 950));
      this.draw(snap);
    };
    const end = () => { clearTimeout(timer); if (drag?.moved) this.save(); drag = null; this.renderNodeFields(); this.draw(); };
    canvas.onpointerup = end; canvas.onpointercancel = end;
  }
  async refreshQuotes() {
    const favorite = this.data.favorite;
    if (!favorite) return this.status('这一年暂无可摘录的角色聊天');
    this.quoteController?.abort(); const controller = new AbortController(); this.quoteController = controller;
    const mode = this.doc.quoteMode, year = this.year, context = `${year}:${favorite.key}`;
    const candidates = []; let completed = 0, candidateCount = 0;
    this.status(`正在从 ${favorite.name} 的真实聊天中寻找摘录…`);
    for (const record of favorite.records) {
      if (controller.signal.aborted) return;
      const chat = await this.dashboard.adapter.loadChat(record, controller.signal);
      // Bound the sampling pool on large, swipe-heavy mobile libraries and
      // avoid spread's argument-count limit on very long chat files.
      for (const candidate of quoteCandidates(chat, year, mode, this.dashboard.settings)) {
        candidateCount++;
        if (candidates.length < 5000) candidates.push(candidate);
        else {
          const index = Math.floor(Math.random() * candidateCount);
          if (index < candidates.length) candidates[index] = candidate;
        }
      }
      this.status(`读取摘录 ${++completed}/${favorite.records.length}`);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (this.disposed || controller.signal.aborted) return;
    const picked = sampleQuotes(candidates, mode);
    if (!picked.length) return this.status('没有找到符合长度的真实摘录，可切换长段/短句重试。');
    this.change(() => { this.doc.quotes = picked; this.doc.quoteContext = context; });
    const index = this.doc.pages.findIndex(page => page.kind === 5); if (index >= 0) this.go(index);
    this.status(`已选取 ${picked.length} 条真实摘录，来自 ${favorite.name}`);
  }
  async export(all) {
    await this.saveQueue; await document.fonts.ready;
    await this.loadImages();
    if (this.missingImages) throw new Error('有图片未加载，请先重新选择或移除后再导出');
    this.status('正在生成图片…');
    const pages = all ? this.doc.pages : [this.page];
    const grid = all === 'grid';
    const layout = exportLayout(pages.length, grid ? 'grid' : all ? 'long' : 'single');
    const scale = layout.scale;
    const output = document.createElement('canvas'); output.width = layout.width; output.height = layout.height;
    const ctx = output.getContext('2d'), pageCanvas = document.createElement('canvas');
    if (grid) { ctx.fillStyle = '#faf7f3'; ctx.fillRect(0, 0, output.width, output.height); }
    for (let i = 0; i < pages.length; i++) {
      drawArtwork(pageCanvas, pages[i], this.template, this.values(), { accent: hexColor(this.dashboard.settings.accent, '#ed4777'), images: this.images, scale });
      ctx.drawImage(pageCanvas, layout.positions[i].x, layout.positions[i].y);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    download(await toBlob(output), `阅读手记-${this.year}-${this.template}-${grid ? '宫格' : all ? '长图' : this.index + 1}.png`);
    this.status('图片已生成；手机请在浏览器下载记录中查看');
  }
  dispose() { this.disposed = true; this.loadId++; this.quoteController?.abort(); }
}
