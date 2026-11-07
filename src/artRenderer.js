import { FONT_FAMILIES } from './artStore.js';
import { fillTokens } from './annualDesign.js';

export const PAGE_WIDTH = 720, PAGE_HEIGHT = 1080;
export function exportLayout(count, mode) {
  const scale = mode === 'single' ? 2 : 1;
  const gap = mode === 'grid' ? 24 : 0;
  const columns = mode === 'grid' ? Math.min(2, count) : 1;
  const rows = Math.ceil(count / columns);
  return { scale, width: PAGE_WIDTH * scale * columns + gap * (columns + 1), height: PAGE_HEIGHT * scale * rows + gap * (rows + 1),
    positions: Array.from({ length: count }, (_, i) => ({ x: gap + (i % columns) * (PAGE_WIDTH * scale + gap), y: gap + Math.floor(i / columns) * (PAGE_HEIGHT * scale + gap) })) };
}
export function mixHex(hex, other, amount) {
  const parse = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  const a = parse(hex), b = parse(other);
  return '#' + a.map((v, i) => Math.round(v * (1 - amount) + b[i] * amount).toString(16).padStart(2, '0')).join('');
}
export function hexColor(value, fallback = '#8172b3') {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
}
function wrap(ctx, value, width) {
  const lines = [];
  for (const paragraph of value.split('\n')) {
    let line = '';
    for (const char of Array.from(paragraph)) {
      if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ''; }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}
function fitImage(ctx, image, x, y, width, height, cropX = 50, cropY = 50, contain = false) {
  const scale = (contain ? Math.min : Math.max)(width / image.width, height / image.height);
  const w = image.width * scale, h = image.height * scale;
  ctx.drawImage(image, x + (width - w) * cropX / 100, y + (height - h) * cropY / 100, w, h);
}
export function drawArtwork(canvas, page, template, values, { accent = '#8172b3', images = new Map(), selected = null, guides = false, scale = 1 } = {}) {
  canvas.width = PAGE_WIDTH * scale; canvas.height = PAGE_HEIGHT * scale;
  const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
  const dark = template === 'crafted' && page.kind === 2;
  const ink = dark ? '#faf6f1' : '#282831';
  const tint = dark ? mixHex(accent, '#ffffff', .65) : accent;
  const base = dark ? mixHex(accent, '#14151e', .65) : template === 'poster' ? mixHex(accent, '#ffffff', .72) : '#faf7f3';
  ctx.fillStyle = base; ctx.fillRect(0, 0, 720, 1080);
  if (page.background && images.has(page.background)) {
    ctx.save();
    if ('filter' in ctx) ctx.filter = `blur(${page.blur || 0}px)`;
    fitImage(ctx, images.get(page.background), -30, -30, 780, 1140, page.cropX, page.cropY);
    ctx.restore();
    ctx.fillStyle = dark ? `rgba(10,10,20,${page.veil})` : `rgba(255,255,255,${page.veil})`;
    ctx.fillRect(0, 0, 720, 1080);
  } else if (template === 'crafted') {
    const glow = ctx.createRadialGradient(650, 960, 10, 650, 960, 650);
    glow.addColorStop(0, mixHex(accent, dark ? '#222133' : '#ffffff', .35));
    glow.addColorStop(1, base);
    ctx.fillStyle = glow; ctx.fillRect(0, 300, 720, 780);
    ctx.save(); ctx.globalAlpha = .14; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(650, 925, 550, 130, -.6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  ctx.strokeStyle = tint; ctx.lineWidth = 1;
  ctx.fillStyle = ink; ctx.font = '13px sans-serif';
  ctx.fillText(`READER / ${values['年份']}     ·     ${page.title}`, 54, 57);
  ctx.beginPath(); ctx.moveTo(54, 80); ctx.lineTo(666, 80); ctx.stroke();
  if (template === 'poster') {
    ctx.font = 'italic 28px Georgia'; ctx.fillText('A year between the lines', 56, 1020);
    ctx.save(); ctx.translate(692, 180); ctx.rotate(Math.PI / 2); ctx.font = '13px sans-serif'; ctx.fillText('THE STORIES WE KEEP / READING ARCHIVE', 0, 0); ctx.restore();
    ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(40, 125); ctx.lineTo(40, 960); ctx.stroke();
  } else if (template === 'archive') {
    ctx.save(); ctx.globalAlpha = .24; ctx.font = '72px Georgia'; ctx.translate(105, 320); ctx.rotate(-Math.PI / 2); ctx.fillText(values['年份'], 0, 0); ctx.restore();
    ctx.fillStyle = tint; ctx.font = 'italic 48px Georgia'; ctx.fillText(String(page.kind + 1).padStart(2, '0'), 54, 435);
    ctx.beginPath(); ctx.moveTo(115, 125); ctx.lineTo(115, 970); ctx.stroke();
    ctx.font = '13px Georgia'; ctx.fillText('CHAPTER / PERSONAL CHRONICLE', 140, 105);
  }
  const boxes = [];
  for (const node of page.nodes) {
    ctx.save();
    const width = Math.max(40, Math.min(680, node.width || 600));
    let height;
    if (node.type === 'avatar') {
      const image = images.get(node.source);
      height = node.shape === 'original' && image ? width * image.height / image.width : width;
      height = Math.min(height, 900);
      ctx.beginPath();
      if (node.shape === 'circle') ctx.arc(node.x + width / 2, node.y + width / 2, width / 2, 0, Math.PI * 2);
      else if (ctx.roundRect) ctx.roundRect(node.x, node.y, width, height, node.shape === 'original' ? 0 : 20);
      else ctx.rect(node.x, node.y, width, height);
      ctx.clip();
      if (image) fitImage(ctx, image, node.x, node.y, width, height);
      else { ctx.fillStyle = mixHex(accent, '#ffffff', .65); ctx.fillRect(node.x, node.y, width, height); }
    } else {
      const value = fillTokens(node.text, values);
      let size = Math.max(12, Math.min(220, Number(node.size) || 28));
      const font = FONT_FAMILIES[node.font] || FONT_FAMILIES.serif;
      const nextY = page.nodes.filter(other => other.type === 'text' && other.y > node.y && other.x < node.x + width && other.x + other.width > node.x).reduce((min, other) => Math.min(min, other.y - 16), 985);
      const maxHeight = Math.max(25, nextY - node.y);
      const setFont = () => { ctx.font = `${node.weight || '400'} ${size}px ${font}`; };
      setFont(); let lines = wrap(ctx, value, width);
      while (lines.length * size * node.lineHeight > maxHeight && size > 12) { size -= 1; setFont(); lines = wrap(ctx, value, width); }
      height = Math.min(maxHeight, lines.length * size * node.lineHeight);
      ctx.fillStyle = node.ink === 'accent' ? tint : node.ink === 'text' ? ink : hexColor(node.ink, ink);
      ctx.textBaseline = 'top'; ctx.textAlign = node.align || 'left';
      const x = node.x + (node.align === 'center' ? width / 2 : node.align === 'right' ? width : 0);
      ctx.beginPath(); ctx.rect(node.x, node.y, width, maxHeight); ctx.clip();
      lines.forEach((line, i) => ctx.fillText(line, x, node.y + i * size * node.lineHeight));
      if (lines.length * size * node.lineHeight > maxHeight) {
        ctx.fillText('…', x, node.y + Math.max(0, maxHeight - size * node.lineHeight));
      }
    }
    ctx.restore();
    boxes.push({ id: node.id, x: node.x, y: node.y, width, height });
    if (selected === node.id) {
      ctx.save(); ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(node.x - 4, node.y - 4, width + 8, height + 8); ctx.restore();
    }
  }
  ctx.fillStyle = ink; ctx.font = '13px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${String(page.kind + 1).padStart(2, '0')} / ${page.title}`, 54, 1050);
  ctx.font = '11px sans-serif'; ctx.textAlign = 'right'; ctx.fillText('ST READER STATS · PERSONAL EDITION', 666, 1050);
  if (guides) { ctx.save(); ctx.strokeStyle = accent; ctx.setLineDash([3, 6]); ctx.beginPath(); ctx.moveTo(360, 90); ctx.lineTo(360, 990); ctx.stroke(); ctx.restore(); }
  return boxes;
}
