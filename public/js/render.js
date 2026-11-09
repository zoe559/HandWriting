/* 把 layout.js 的分页绘制指令渲染为 SVG（屏幕）或 canvas（导出）。 */
import { PAGE_W, PAGE_H, fontCss } from './layout.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function applyFont(el, font) {
  el.setAttribute('font-family', font.family);
  el.setAttribute('font-size', String(font.size));
  el.setAttribute('font-weight', String(font.weight || 400));
  el.setAttribute('font-style', font.style || 'normal');
  el.setAttribute('fill', font.color || '#111111');
}

/** 生成一页 SVG 元素（尚未挂载）。 */
export function svgForPage(page) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('viewBox', `0 0 ${PAGE_W} ${PAGE_H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('class', 'paper-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `第 ${page.index} 页`);

  for (const op of page.ops) {
    if (op.type === 'rect') {
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', String(op.x));
      r.setAttribute('y', String(op.y));
      r.setAttribute('width', String(op.w));
      r.setAttribute('height', String(op.h));
      r.setAttribute('fill', op.fill || 'none');
      if (op.stroke) {
        r.setAttribute('stroke', op.stroke);
        r.setAttribute('stroke-width', String(op.lw || 1));
      }
      if (op.rx) r.setAttribute('rx', String(op.rx));
      svg.appendChild(r);
    } else if (op.type === 'line') {
      const l = document.createElementNS(SVG_NS, 'line');
      l.setAttribute('x1', String(op.x1));
      l.setAttribute('y1', String(op.y1));
      l.setAttribute('x2', String(op.x2));
      l.setAttribute('y2', String(op.y2));
      l.setAttribute('stroke', op.stroke || '#cccccc');
      l.setAttribute('stroke-width', String(op.lw || 1));
      if (op.dash) l.setAttribute('stroke-dasharray', op.dash.join(' '));
      svg.appendChild(l);
    } else if (op.type === 'text') {
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', String(op.x));
      t.setAttribute('y', String(op.y));
      t.setAttribute('xml:space', 'preserve');
      if (op.anchor && op.anchor !== 'start') t.setAttribute('text-anchor', op.anchor);
      applyFont(t, op.font);
      t.textContent = op.text == null ? '' : String(op.text);
      svg.appendChild(t);
    }
  }
  return svg;
}

/** 纯 canvas 回退渲染（SVG 栅格化失败时使用）。 */
export function renderPageCanvas(ctx, page, scale = 1) {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.textBaseline = 'alphabetic';
  for (const op of page.ops) {
    if (op.type === 'rect') {
      if (op.fill && op.fill !== 'none') {
        ctx.fillStyle = op.fill;
        ctx.fillRect(op.x, op.y, op.w, op.h);
      }
      if (op.stroke) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.lw || 1;
        ctx.strokeRect(op.x, op.y, op.w, op.h);
      }
    } else if (op.type === 'line') {
      ctx.strokeStyle = op.stroke || '#cccccc';
      ctx.lineWidth = op.lw || 1;
      if (op.dash) ctx.setLineDash(op.dash);
      else ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1);
      ctx.lineTo(op.x2, op.y2);
      ctx.stroke();
    } else if (op.type === 'text') {
      ctx.font = fontCss(op.font);
      ctx.fillStyle = op.font.color || '#111111';
      ctx.textAlign = op.anchor === 'end' ? 'right' : op.anchor === 'middle' ? 'center' : 'left';
      ctx.fillText(op.text == null ? '' : String(op.text), op.x, op.y);
    }
  }
  ctx.restore();
}

/** 把一页渲染到离屏 canvas（2x 导出用）。 */
export async function renderPageToCanvas(page, scale = 2) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(PAGE_W * scale);
  canvas.height = Math.round(PAGE_H * scale);
  const ctx = canvas.getContext('2d');
  const svg = svgForPage(page);
  svg.setAttribute('width', String(canvas.width));
  svg.setAttribute('height', String(canvas.height));
  const xml = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  const img = new Image();
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  } catch (err) {
    console.warn('SVG 栅格化失败，回退到 canvas 渲染', err);
    renderPageCanvas(ctx, page, scale);
  } finally {
    URL.revokeObjectURL(url);
  }
  return canvas;
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob 返回空'));
    }, type, quality);
  });
}
