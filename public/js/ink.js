/* 手写层：Pointer Events + 压感/速度笔宽、整笔橡皮、撤销重做、按页重绘。 */
import { PAGE_W, PAGE_H } from './layout.js';

export const PEN_COLORS = ['#1a4fd6', '#d92d20', '#111111'];
export const PEN_WIDTHS = [2, 3.5, 5];

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function pointerPressure(e) {
  let p = Number(e.pressure);
  if (!Number.isFinite(p) || p <= 0) p = 0.55;
  if (e.pointerType === 'mouse') p = 0.62;
  return clamp(p, 0.05, 1);
}

function pressureFactor(p) {
  return clamp(0.38 + 1.15 * p, 0.3, 1.8);
}

function pointSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function strokeHit(stroke, x, y, radius) {
  const pts = stroke.points || [];
  const r = radius + (stroke.baseWidth || stroke.width || 3) * 0.6;
  if (!pts.length) return false;
  if (pts.length === 1) return Math.hypot(x - pts[0].x, y - pts[0].y) <= r;
  for (let i = 1; i < pts.length; i++) {
    if (pointSegmentDistance(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= r) return true;
  }
  return false;
}

function drawDot(ctx, pt, stroke) {
  const w = (stroke.width || 3) * pressureFactor(pt.p == null ? 0.55 : pt.p);
  ctx.beginPath();
  ctx.fillStyle = stroke.color;
  ctx.arc(pt.x, pt.y, Math.max(0.7, w / 2), 0, Math.PI * 2);
  ctx.fill();
}

function drawSegment(ctx, a, b, stroke) {
  const pa = a.p == null ? 0.55 : a.p;
  const pb = b.p == null ? 0.55 : b.p;
  const w = (stroke.width || 3) * pressureFactor((pa + pb) / 2);
  ctx.beginPath();
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = Math.max(0.7, w);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** 把一支笔迹画到逻辑坐标的 ctx（调用方负责 setTransform）。 */
export function drawStroke(ctx, stroke) {
  const pts = stroke.points || [];
  if (!pts.length) return;
  if (stroke.tool === 'highlighter') {
    ctx.save();
    ctx.globalAlpha = 0.3;
  }
  if (pts.length === 1) {
    drawDot(ctx, pts[0], stroke);
  } else {
    for (let i = 1; i < pts.length; i++) drawSegment(ctx, pts[i - 1], pts[i], stroke);
  }
  if (stroke.tool === 'highlighter') ctx.restore();
}

/** 导出用：把某一页的笔迹画到 canvas 上。 */
export function drawStrokes(ctx, strokes, pageIndex, scale = 1) {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  for (const s of strokes || []) {
    if (Number(s.page) === Number(pageIndex)) drawStroke(ctx, s);
  }
  ctx.restore();
}

export class InkBoard {
  constructor(options = {}) {
    this.pages = new Map();
    this.strokes = [];
    this.history = [];
    this.redoStack = [];
    this.tool = 'pen';
    this.color = PEN_COLORS[0];
    this.width = PEN_WIDTHS[1];
    this.reading = false;
    this.active = null;
    this.lastPenAt = 0;
    this.onChange = options.onChange || (() => {});
    this.onPointer = options.onPointer || (() => {});
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
  }

  mount(sheetEl, pageIndex) {
    const canvas = document.createElement('canvas');
    canvas.className = 'ink-canvas';
    canvas.dataset.page = String(pageIndex);
    canvas.width = Math.round(PAGE_W * this.dpr);
    canvas.height = Math.round(PAGE_H * this.dpr);
    canvas.style.touchAction = 'none';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    sheetEl.appendChild(canvas);

    const record = { page: pageIndex, canvas, ctx };
    this.pages.set(pageIndex, record);
    this.bindCanvas(record);
    this.redrawPage(pageIndex);
    return canvas;
  }

  bindCanvas(record) {
    const { canvas, page } = record;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e, record));
    canvas.addEventListener('pointermove', (e) => this.onMove(e, record));
    canvas.addEventListener('pointerup', (e) => this.onUp(e, record));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e, record));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  toPageCoords(e, record) {
    const rect = record.canvas.getBoundingClientRect();
    const x = clamp(((e.clientX - rect.left) / Math.max(1, rect.width)) * PAGE_W, 0, PAGE_W);
    const y = clamp(((e.clientY - rect.top) / Math.max(1, rect.height)) * PAGE_H, 0, PAGE_H);
    return { x, y };
  }

  isTouchRejected(e) {
    return e.pointerType === 'touch' && Date.now() - this.lastPenAt < 1500;
  }

  onDown(e, record) {
    if (this.reading) return;
    if (e.pointerType === 'pen') this.lastPenAt = Date.now();
    if (this.isTouchRejected(e)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      record.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const { x, y } = this.toPageCoords(e, record);
    this.onPointer({ type: 'down', pointerType: e.pointerType, pressure: e.pressure, x, y });
    if (this.tool === 'eraser') {
      this.active = { pointerId: e.pointerId, record, erasing: true, lastErase: Date.now() };
      this.eraseAt(record.page, x, y);
      return;
    }
    const stroke = {
      page: record.page,
      tool: 'pen',
      color: this.color,
      width: this.width,
      points: [{ x, y, p: pointerPressure(e), t: Date.now() }],
    };
    this.active = { pointerId: e.pointerId, record, stroke, lastDrawn: 1 };
    this.redrawPage(record.page);
    drawDot(record.ctx, stroke.points[0], stroke);
  }

  onMove(e) {
    if (!this.active || this.active.pointerId !== e.pointerId) return;
    e.preventDefault();
    let events;
    try {
      events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    } catch {
      events = [e];
    }
    if (!events || !events.length) events = [e];
    if (this.active.erasing) {
      for (const ev of events) {
        const { x, y } = this.toPageCoords(ev, this.active.record);
        this.eraseAt(this.active.record.page, x, y);
      }
      return;
    }
    const stroke = this.active.stroke;
    const ctx = this.active.record.ctx;
    for (const ev of events) {
      const { x, y } = this.toPageCoords(ev, this.active.record);
      const last = stroke.points[stroke.points.length - 1];
      if (last && Math.hypot(x - last.x, y - last.y) < 0.45) continue;
      const pt = { x, y, p: pointerPressure(ev), t: Date.now() };
      stroke.points.push(pt);
      this.onPointer({ type: 'move', pointerType: ev.pointerType, pressure: ev.pressure, x, y });
      if (stroke.points.length >= 2) {
        drawSegment(ctx, stroke.points[stroke.points.length - 2], pt, stroke);
        this.active.lastDrawn = stroke.points.length;
      }
    }
  }

  onUp(e, record) {
    if (!this.active || this.active.pointerId !== e.pointerId) return;
    try {
      record.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!this.active.erasing) {
      const stroke = this.active.stroke;
      if (stroke && stroke.points.length) {
        this.strokes.push(stroke);
        this.history.push({ type: 'add', page: record.page, stroke });
        if (this.history.length > 250) this.history.shift();
        this.redoStack = [];
        this.redrawPage(record.page);
        this.onChange();
      }
    }
    this.active = null;
  }

  eraseAt(page, x, y) {
    const removed = [];
    const kept = [];
    for (const s of this.strokes) {
      if (Number(s.page) === Number(page) && strokeHit(s, x, y, 9)) removed.push(s);
      else kept.push(s);
    }
    if (!removed.length) return;
    this.strokes = kept;
    this.history.push({ type: 'erase', page, strokes: removed });
    if (this.history.length > 250) this.history.shift();
    this.redoStack = [];
    this.redrawPage(page);
    this.onChange();
  }

  undo() {
    const action = this.history.pop();
    if (!action) return false;
    if (action.type === 'add') {
      this.strokes = this.strokes.filter((s) => s !== action.stroke);
    } else if (action.type === 'erase' || action.type === 'clear') {
      const current = new Set(this.strokes);
      for (const s of action.strokes) if (!current.has(s)) this.strokes.push(s);
    }
    this.redoStack.push(action);
    this.redrawPage(action.page);
    this.onChange();
    return true;
  }

  redo() {
    const action = this.redoStack.pop();
    if (!action) return false;
    if (action.type === 'add') {
      if (!this.strokes.includes(action.stroke)) this.strokes.push(action.stroke);
    } else if (action.type === 'erase' || action.type === 'clear') {
      const remove = new Set(action.strokes);
      this.strokes = this.strokes.filter((s) => !remove.has(s));
    }
    this.history.push(action);
    this.redrawPage(action.page);
    this.onChange();
    return true;
  }

  clearPage(page) {
    const removed = this.strokes.filter((s) => Number(s.page) === Number(page));
    if (!removed.length) return;
    this.strokes = this.strokes.filter((s) => Number(s.page) !== Number(page));
    this.history.push({ type: 'clear', page: Number(page), strokes: removed });
    this.redoStack = [];
    this.redrawPage(page);
    this.onChange();
  }

  clearAll() {
    if (!this.strokes.length) return;
    this.strokes = [];
    this.history = [];
    this.redoStack = [];
    this.redrawAll();
    this.onChange();
  }

  redrawPage(page) {
    const record = this.pages.get(Number(page));
    if (!record) return;
    const { ctx } = record;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, record.canvas.width, record.canvas.height);
    ctx.restore();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const s of this.strokes) {
      if (Number(s.page) === Number(page)) drawStroke(ctx, s);
    }
  }

  redrawAll() {
    for (const page of this.pages.keys()) this.redrawPage(page);
  }

  setTool(tool) {
    this.tool = tool === 'eraser' ? 'eraser' : 'pen';
    this.setCursor();
  }

  setColor(color) {
    this.color = color;
  }

  setWidth(width) {
    this.width = Number(width) || PEN_WIDTHS[1];
  }

  setReading(reading) {
    this.reading = Boolean(reading);
    for (const { canvas } of this.pages.values()) {
      canvas.style.pointerEvents = this.reading ? 'none' : 'auto';
      canvas.style.cursor = this.reading ? 'default' : this.tool === 'eraser' ? 'cell' : 'crosshair';
    }
    this.setCursor();
  }

  setCursor() {
    for (const { canvas } of this.pages.values()) {
      if (this.reading) continue;
      canvas.style.cursor = this.tool === 'eraser' ? 'cell' : 'crosshair';
    }
  }

  count() {
    return this.strokes.length;
  }

  countPage(page) {
    return this.strokes.filter((s) => Number(s.page) === Number(page)).length;
  }

  hasInk() {
    return this.strokes.length > 0;
  }

  getAll() {
    return this.strokes;
  }

  /** 提交用的轻量序列化。 */
  serialize() {
    return this.strokes.map((s) => ({
      page: Number(s.page),
      tool: s.tool || 'pen',
      color: s.color,
      width: s.width,
      points: (s.points || []).map((p) => ({
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        p: Math.round((p.p == null ? 0.55 : p.p) * 100) / 100,
      })),
    }));
  }

  load(strokes) {
    if (!Array.isArray(strokes)) return;
    this.strokes = strokes
      .filter((s) => s && Array.isArray(s.points) && s.points.length)
      .map((s) => ({
        page: Number(s.page) || 1,
        tool: s.tool === 'highlighter' ? 'highlighter' : 'pen',
        color: typeof s.color === 'string' ? s.color : PEN_COLORS[0],
        width: Number(s.width) || PEN_WIDTHS[1],
        points: s.points
          .filter((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
          .map((p) => ({
            x: Number(p.x),
            y: Number(p.y),
            p: p.p == null ? 0.55 : Number(p.p),
            t: Number(p.t) || 0,
          })),
      }))
      .filter((s) => s.points.length);
    this.history = [];
    this.redoStack = [];
    this.redrawAll();
  }

  destroy() {
    for (const { canvas } of this.pages.values()) canvas.remove();
    this.pages.clear();
    this.strokes = [];
    this.history = [];
    this.redoStack = [];
  }
}
