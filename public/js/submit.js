/* 把每页文字 + 笔迹合成为 PNG，提交到本地服务；服务不可用时兜底下载/复制。 */
import { renderPageToCanvas, canvasToBlob } from './render.js';
import { drawStrokes } from './ink.js';
import { api } from './api.js';

const EXPORT_SCALE = 2;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

export function slimLayout(layout) {
  return {
    pageWidth: layout.pageWidth,
    pageHeight: layout.pageHeight,
    paperId: layout.paperId,
    paperTitle: layout.paperTitle,
    pages: (layout.pages || []).map((p) => ({
      index: p.index,
      section: p.section,
      items: p.items || [],
      lines: (p.lines || []).map((l) => ({
        text: l.text,
        x: Math.round(l.x * 10) / 10,
        y: Math.round(l.y * 10) / 10,
        w: Math.round(l.w * 10) / 10,
      })),
    })),
  };
}

/** 逐页合成，返回提交 payload。 */
export async function buildSubmissionPayload({ layout, strokes, paperId, timeSpentSec, note, onProgress }) {
  const pages = [];
  const total = layout.pages.length;
  for (let i = 0; i < total; i++) {
    const page = layout.pages[i];
    onProgress?.({ phase: 'render', current: i + 1, total, page: page.index });
    const canvas = await renderPageToCanvas(page, EXPORT_SCALE);
    const ctx = canvas.getContext('2d');
    drawStrokes(ctx, strokes, page.index, EXPORT_SCALE);
    const blob = await canvasToBlob(canvas, 'image/png');
    const dataUrl = await blobToDataUrl(blob);
    pages.push({ index: page.index, dataUrl });
    // 给浏览器一次绘制/GC 的机会，避免长任务卡住
    await new Promise((r) => setTimeout(r, 0));
  }
  onProgress?.({ phase: 'upload', current: total, total });
  return {
    paperId,
    timeSpentSec: Math.max(0, Math.round(Number(timeSpentSec) || 0)),
    note: typeof note === 'string' ? note.slice(0, 4000) : '',
    pages,
    layout: slimLayout(layout),
    strokes,
    clientVersion: '1.0.0',
  };
}

export async function submitPayload(payload) {
  return api.submit(payload);
}

/** 单页导出（兜底下载/复制用）。 */
export async function renderSinglePage(layout, strokes, pageIndex) {
  const page = layout.pages.find((p) => Number(p.index) === Number(pageIndex));
  if (!page) throw new Error('页面不存在');
  const canvas = await renderPageToCanvas(page, EXPORT_SCALE);
  const ctx = canvas.getContext('2d');
  drawStrokes(ctx, strokes, page.index, EXPORT_SCALE);
  return canvasToBlob(canvas, 'image/png');
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyBlob(blob) {
  if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') {
    throw new Error('当前浏览器不支持复制图片到剪贴板');
  }
  await navigator.clipboard.write([new window.ClipboardItem({ [blob.type || 'image/png']: blob })]);
}
