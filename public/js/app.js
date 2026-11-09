import { layoutPaper, measure, PAGE_W, PAGE_H } from './layout.js';
import { svgForPage } from './render.js';
import { InkBoard, PEN_COLORS, PEN_WIDTHS } from './ink.js';
import { api } from './api.js';
import { createLearningCenter } from './center.js';
import {
  buildSubmissionPayload,
  submitPayload,
  renderSinglePage,
  downloadBlob,
  copyBlob,
} from './submit.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const el = {
  paperSelect: $('#paperSelect'),
  timer: $('#timer'),
  saveState: $('#saveState'),
  centerBtn: $('#centerBtn'),
  helpBtn: $('#helpBtn'),
  deviceBtn: $('#deviceBtn'),
  pages: $('#pages'),
  inkCount: $('#inkCount'),
  pageLabel: $('#pageLabel'),
  prevBtn: $('#prevBtn'),
  nextBtn: $('#nextBtn'),
  submitBtn: $('#submitBtn'),
  penBtn: $('#penBtn'),
  eraserBtn: $('#eraserBtn'),
  undoBtn: $('#undoBtn'),
  redoBtn: $('#redoBtn'),
  clearBtn: $('#clearBtn'),
  readBtn: $('#readBtn'),
  zoomSelect: $('#zoomSelect'),
  modal: $('#modal'),
  modalBody: $('#modalBody'),
  modalClose: $('#modalClose'),
  toast: $('#toast'),
  debugPanel: $('#debugPanel'),
};

const state = {
  papers: [],
  paper: null,
  layout: null,
  board: null,
  startedAt: Date.now(),
  currentPage: 1,
  note: '',
  lastSubmitted: null,
  submitting: false,
  modalLocked: false,
  saveTimer: 0,
  toastTimer: 0,
  scrollRaf: 0,
  timerHandle: 0,
  zoom: 1,
  debug: false,
  debugInk: false,
  booted: false,
};

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset' && typeof value === 'object') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value') node.value = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function toast(message, ms = 2800) {
  clearTimeout(state.toastTimer);
  el.toast.textContent = message;
  el.toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, ms);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDuration(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return hh > 0 ? `${hh}:${pad2(mm)}:${pad2(ss)}` : `${pad2(mm)}:${pad2(ss)}`;
}

function elapsedSec() {
  return Math.floor((Date.now() - state.startedAt) / 1000);
}

function setSaveState(text, title = '') {
  el.saveState.textContent = text;
  el.saveState.title = title || text;
}

function draftKey(paperId) {
  return `cet6-practice:v1:${paperId}`;
}

function scheduleSave() {
  if (!state.paper || !state.board) return;
  setSaveState('保存中…');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveDraft(), 600);
}

function saveDraft() {
  if (!state.paper || !state.board) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = 0;
  try {
    const payload = {
      version: 1,
      paperId: state.paper.id,
      strokes: state.board.serialize(),
      note: state.note,
      startedAt: state.startedAt,
      savedAt: Date.now(),
      lastSubmitted: state.lastSubmitted,
    };
    localStorage.setItem(draftKey(state.paper.id), JSON.stringify(payload));
    const now = new Date();
    setSaveState(`已保存 ${pad2(now.getHours())}:${pad2(now.getMinutes())}`, '草稿保存在本机浏览器');
  } catch (err) {
    console.warn('保存草稿失败', err);
    setSaveState('保存失败');
    toast('本地草稿保存失败，可能是浏览器存储空间不足。');
  }
}

function restoreDraft() {
  const raw = localStorage.getItem(draftKey(state.paper.id));
  if (!raw) return;
  let draft = null;
  try {
    draft = JSON.parse(raw);
  } catch {
    return;
  }
  if (!draft || draft.paperId !== state.paper.id) return;
  const strokes = Array.isArray(draft.strokes) ? draft.strokes : [];
  if (strokes.length) {
    state.board.load(strokes);
    toast(`已恢复上次未提交的 ${strokes.length} 笔书写。`);
  }
  if (typeof draft.note === 'string') state.note = draft.note;
  if (draft.lastSubmitted) state.lastSubmitted = draft.lastSubmitted;
  if (Number.isFinite(draft.startedAt)) {
    const age = Date.now() - draft.startedAt;
    if (age >= 0 && age < 8 * 3600 * 1000) state.startedAt = draft.startedAt;
  }
  updateInkCount();
}

async function boot() {
  bindUI();
  initTimer();
  initDebug();
  try {
    const data = await api.papers();
    state.papers = Array.isArray(data.papers) ? data.papers : [];
    if (!state.papers.length) throw new Error('服务没有返回任何试卷，请检查 data/papers.json');
    fillPaperSelect();
    const wanted = new URLSearchParams(location.search).get('paper');
    const last = localStorage.getItem('cet6-practice:last-paper');
    const id =
      state.papers.find((p) => p.id === wanted)?.id ||
      state.papers.find((p) => p.id === last)?.id ||
      state.papers[0].id;
    await loadPaper(id);
    state.booted = true;
    const centerParam = new URLSearchParams(location.search).get('center');
    if (centerParam) setTimeout(() => center.open(centerParam), 80);
  } catch (err) {
    showBootError(err);
  }
}

function fillPaperSelect() {
  el.paperSelect.replaceChildren();
  for (const paper of state.papers) {
    el.paperSelect.append(
      h('option', { value: paper.id }, `${paper.title}（${paper.itemCount} 题）`),
    );
  }
}

async function refreshPapers() {
  const data = await api.papers();
  state.papers = Array.isArray(data.papers) ? data.papers : [];
  fillPaperSelect();
  if (state.paper) el.paperSelect.value = state.paper.id;
  return state.papers;
}

function showBootError(err) {
  el.pages.replaceChildren(
    h(
      'div',
      { class: 'error-box' },
      h('h3', {}, '无法加载练习台'),
      h('p', {}, err && err.message ? String(err.message) : '未知错误'),
      h('p', {}, '请确认本地服务仍在运行。可以双击 start.cmd 重新启动，然后刷新本页。'),
      h(
        'button',
        { class: 'btn', type: 'button', onclick: () => location.reload() },
        '刷新重试',
      ),
    ),
  );
  setSaveState('加载失败');
}

async function loadPaper(paperId) {
  setSaveState('加载中…');
  const data = await api.paper(paperId);
  if (!data || !data.paper) throw new Error('试卷数据为空');
  if (state.board) saveDraft();

  state.paper = data.paper;
  state.layout = layoutPaper(state.paper);
  state.currentPage = 1;
  state.note = '';
  state.lastSubmitted = null;
  state.startedAt = Date.now();
  state.submitting = false;
  state.modalLocked = false;

  renderPaper();
  restoreDraft();
  el.paperSelect.value = paperId;
  document.title = `${state.paper.title} · CET-6 手写练习台`;
  localStorage.setItem('cet6-practice:last-paper', paperId);

  applyZoom(state.zoom);
  updateInkCount();
  updatePageLabel();
  setSaveState('就绪');
  window.scrollTo({ top: 0, behavior: 'auto' });

  const params = new URLSearchParams(location.search);
  const pageParam = Number(params.get('page'));
  if (pageParam) requestAnimationFrame(() => scrollToPage(pageParam, false));
  if (state.debugInk) requestAnimationFrame(addDemoInk);
}

function renderPaper() {
  el.pages.replaceChildren();
  if (state.board) state.board.destroy();

  const board = new InkBoard({
    onChange: () => {
      scheduleSave();
      updateInkCount();
    },
  });
  state.board = board;

  for (const page of state.layout.pages) {
    const wrap = h('div', {
      class: 'sheet-wrap',
      id: `p${page.index}`,
      dataset: { page: String(page.index) },
    });
    const sheet = h('div', { class: 'sheet', dataset: { page: String(page.index) } });
    sheet.appendChild(svgForPage(page));
    wrap.appendChild(sheet);
    el.pages.appendChild(wrap);
    board.mount(sheet, page.index);
  }
  updateInkCount();
  updatePageLabel();
  debugLayout();
}

function applyZoom(zoom) {
  const z = Number(zoom) || 1;
  state.zoom = z;
  document.documentElement.style.setProperty('--sheet-scale', String(z));
  el.zoomSelect.value = String(z);
  localStorage.setItem('cet6-practice:zoom', String(z));
}

function scrollToPage(pageIndex, smooth = true) {
  const target = document.getElementById(`p${pageIndex}`);
  if (!target) return;
  state.currentPage = Number(pageIndex);
  target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  updatePageLabel();
  updateInkCount();
}

function updatePageLabel() {
  const total = state.layout ? state.layout.pages.length : 0;
  el.pageLabel.textContent = `${state.currentPage} / ${Math.max(1, total)}`;
  el.prevBtn.disabled = !state.layout || state.currentPage <= 1;
  el.nextBtn.disabled = !state.layout || state.currentPage >= total;
}

function updateInkCount() {
  if (!state.board) {
    el.inkCount.textContent = '笔迹 0';
    return;
  }
  el.inkCount.textContent = `笔迹 ${state.board.count()} · 本页 ${state.board.countPage(state.currentPage)}`;
}

function initTimer() {
  clearInterval(state.timerHandle);
  const tick = () => {
    el.timer.textContent = formatDuration(elapsedSec());
  };
  tick();
  state.timerHandle = setInterval(tick, 1000);
}

function onScroll() {
  if (state.scrollRaf) return;
  state.scrollRaf = requestAnimationFrame(() => {
    state.scrollRaf = 0;
    if (!state.layout) return;
    const vh = window.innerHeight;
    let best = state.currentPage;
    let bestArea = 0;
    for (const wrap of $$('.sheet-wrap', el.pages)) {
      const r = wrap.getBoundingClientRect();
      const visible = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 80));
      if (visible > bestArea) {
        bestArea = visible;
        best = Number(wrap.dataset.page) || best;
      }
    }
    if (best !== state.currentPage) {
      state.currentPage = best;
      updatePageLabel();
      updateInkCount();
    }
  });
}

function bindUI() {
  el.paperSelect.addEventListener('change', async (e) => {
    const next = e.target.value;
    if (!state.paper || next === state.paper.id) return;
    if (state.board && state.board.hasInk() && !confirm('切换试卷会保留当前草稿，确定切换吗？')) {
      el.paperSelect.value = state.paper.id;
      return;
    }
    try {
      saveDraft();
      await loadPaper(next);
    } catch (err) {
      toast(`切换试卷失败：${err.message}`);
      el.paperSelect.value = state.paper.id;
    }
  });

  for (const dot of $$('.color-dot')) {
    dot.addEventListener('click', () => {
      state.board?.setColor(dot.dataset.color);
      $$('.color-dot').forEach((d) => d.classList.toggle('selected', d === dot));
    });
  }

  for (const btn of $$('.width-btn')) {
    btn.addEventListener('click', () => {
      state.board?.setWidth(Number(btn.dataset.width));
      $$('.width-btn').forEach((b) => b.classList.toggle('selected', b === btn));
    });
  }

  el.penBtn.addEventListener('click', () => setTool('pen'));
  el.eraserBtn.addEventListener('click', () => setTool('eraser'));
  el.undoBtn.addEventListener('click', () => {
    state.board?.undo();
    updateInkCount();
  });
  el.redoBtn.addEventListener('click', () => {
    state.board?.redo();
    updateInkCount();
  });
  el.clearBtn.addEventListener('click', () => {
    if (!state.board) return;
    const n = state.board.countPage(state.currentPage);
    if (!n) {
      toast('本页还没有笔迹。');
      return;
    }
    if (!confirm(`确定清空第 ${state.currentPage} 页的 ${n} 笔书写吗？`)) return;
    state.board.clearPage(state.currentPage);
    updateInkCount();
  });
  el.readBtn.addEventListener('click', () => {
    if (!state.board) return;
    state.reading = !state.reading;
    state.board.setReading(state.reading);
    el.readBtn.classList.toggle('selected', state.reading);
    el.readBtn.textContent = state.reading ? '阅读模式：开' : '阅读模式';
    toast(state.reading ? '阅读模式：手写层暂时关闭，可选中/复制文字。' : '已回到手写模式。');
  });

  el.zoomSelect.addEventListener('change', () => applyZoom(Number(el.zoomSelect.value)));

  el.prevBtn.addEventListener('click', () => {
    if (state.currentPage > 1) scrollToPage(state.currentPage - 1);
  });
  el.nextBtn.addEventListener('click', () => {
    if (state.layout && state.currentPage < state.layout.pages.length) {
      scrollToPage(state.currentPage + 1);
    }
  });

  el.submitBtn.addEventListener('click', openSubmitModal);
  el.helpBtn.addEventListener('click', openHelp);
  el.deviceBtn.addEventListener('click', openDeviceTest);

  el.modalClose.addEventListener('click', closeModal);
  el.modal.addEventListener('click', (e) => {
    if (e.target === el.modal) closeModal();
  });

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    updatePageLabel();
    onScroll();
  });
  window.addEventListener('beforeunload', () => saveDraft());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveDraft();
  });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('hashchange', () => {
    const m = location.hash.match(/^#p(\d+)$/);
    if (m) scrollToPage(Number(m[1]), true);
  });

  const z = Number(localStorage.getItem('cet6-practice:zoom'));
  state.zoom = z === 1.15 || z === 1.3 ? z : 1;
  el.zoomSelect.value = String(state.zoom);
}

function setTool(tool) {
  state.board?.setTool(tool);
  el.penBtn.classList.toggle('selected', tool === 'pen');
  el.eraserBtn.classList.toggle('selected', tool === 'eraser');
}

function onKeyDown(e) {
  if (el.modal.hidden === false) {
    if (e.key === 'Escape') closeModal();
    return;
  }
  const tag = (e.target && e.target.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) state.board?.redo();
    else state.board?.undo();
    updateInkCount();
    return;
  }
  if (mod && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault();
    state.board?.redo();
    updateInkCount();
    return;
  }
  if (mod) return;
  if (e.key === 'b' || e.key === 'B' || e.key === 'p' || e.key === 'P') setTool('pen');
  else if (e.key === 'e' || e.key === 'E') setTool('eraser');
  else if (e.key === '[') {
    const idx = Math.max(0, PEN_WIDTHS.indexOf(state.board?.width) - 1);
    state.board?.setWidth(PEN_WIDTHS[idx]);
    $$('.width-btn').forEach((b) => b.classList.toggle('selected', Number(b.dataset.width) === PEN_WIDTHS[idx]));
  } else if (e.key === ']') {
    const idx = Math.min(PEN_WIDTHS.length - 1, PEN_WIDTHS.indexOf(state.board?.width) + 1);
    state.board?.setWidth(PEN_WIDTHS[idx]);
    $$('.width-btn').forEach((b) => b.classList.toggle('selected', Number(b.dataset.width) === PEN_WIDTHS[idx]));
  } else if (e.key >= '1' && e.key <= '3') {
    const idx = Number(e.key) - 1;
    const color = PEN_COLORS[idx];
    state.board?.setColor(color);
    $$('.color-dot').forEach((d) => d.classList.toggle('selected', d.dataset.color === color));
  } else if (e.key === 'r' || e.key === 'R') {
    el.readBtn.click();
  } else if (e.key === '?') {
    openHelp();
  }
}

function openModal(content) {
  el.modalBody.replaceChildren(content);
  el.modal.hidden = false;
  el.modal.classList.remove('wide');
  document.body.style.overflow = 'hidden';
  setTimeout(() => el.modalClose.focus(), 0);
}

function closeModal() {
  if (state.modalLocked) return;
  el.modal.hidden = true;
  el.modal.classList.remove('wide');
  el.modalBody.replaceChildren();
  document.body.style.overflow = '';
}

function openHelp() {
  openModal(
    h(
      'div',
      {},
      h('h2', {}, '使用说明'),
      h('h3', {}, '做题'),
      h(
        'ul',
        {},
        h('li', {}, '选择试卷后，用手绘板或触控笔直接在页面上书写。'),
        h('li', {}, '选择题/匹配题把字母写在每题右侧的「答」框里；选词填空写在文内横线处。'),
        h('li', {}, '翻译、写作直接写在横线上，可写到右侧留白。'),
        h('li', {}, '中文注解写在页面右侧留白，或写在英文行间；我会结合位置判断你注解的是哪个词。'),
        h('li', {}, '蓝色写答案，红色写注解/修改；写不清的地方可以在提交时用文字补充。'),
      ),
      h('h3', {}, '提交与批改'),
      h(
        'ul',
        {},
        h('li', {}, '点右下角「提交批改」会生成页面 PNG 并保存到本机 submissions/。'),
        h('li', {}, '提交成功后会显示一条指令，例如「批改 101500-ab12」。'),
        h('li', {}, '回到 AI 对话，把这条指令发给我，我就会读取页面和答案键批改。'),
        h('li', {}, '服务未启动或上传失败时，可以下载/复制页面图片，手动贴到对话里批改。'),
      ),
      h('h3', {}, '学习中心'),
      h(
        'p',
        {},
        '顶部「学习中心」可以看提交历史、直接渲染批改报告、汇总错词本，以及管理/导入试卷；不需要去翻  文件夹。',
      ),
      h('h3', {}, '快捷键'),
      h(
        'ul',
        {},
        h('li', {}, 'Ctrl+Z / Ctrl+Y：撤销 / 重做；B：笔；E：橡皮；R：阅读模式。'),
        h('li', {}, '1 / 2 / 3：蓝 / 红 / 黑；[ / ]：笔宽。'),
      ),
      h('h3', {}, '隐私'),
      h(
        'p',
        {},
        '所有页面、笔迹和报告都只保存在本机工作区  下，不会上传到外部服务。工作区若在 OneDrive 中，文件会被 OneDrive 同步。',
      ),
      h(
        'div',
        { class: 'modal-actions' },
        h(
          'button',
          {
            class: 'btn danger',
            type: 'button',
            onclick: () => {
              if (!state.board || !state.paper) return;
              if (!confirm('确定清除本卷的所有笔迹和本地草稿吗？此操作不能撤销。')) return;
              state.board.clearAll();
              try {
                localStorage.removeItem(draftKey(state.paper.id));
              } catch {
                /* ignore */
              }
              state.note = '';
              state.lastSubmitted = null;
              state.startedAt = Date.now();
              updateInkCount();
              setSaveState('已清除本卷草稿');
              closeModal();
              toast('本卷草稿已清除，计时重新开始。');
            },
          },
          '清除本卷草稿',
        ),
        h('button', { class: 'btn primary', type: 'button', onclick: closeModal }, '知道了'),
      ),
    ),
  );
}

function openDeviceTest() {
  const pad = h('canvas', { class: 'device-pad' });
  const info = h('div', { class: 'device-info' });
  const clear = h('button', { class: 'btn', type: 'button' }, '清空');
  const close = h('button', { class: 'btn primary', type: 'button' }, '关闭');
  close.addEventListener('click', closeModal);
  openModal(
    h(
      'div',
      {},
      h('h2', {}, '手绘板测试'),
      h(
        'p',
        {},
        '在下面这块小画板上试写几笔。这里会显示浏览器实际收到的 pointerType 和 pressure；如果 pressure 一直是 0.5 左右，说明驱动没有把压感传给浏览器，但仍可正常书写。',
      ),
      pad,
      info,
      h('div', { class: 'modal-actions' }, clear, close),
    ),
  );
  requestAnimationFrame(() => initDevicePad(pad, info, clear));
}

function initDevicePad(pad, info, clearBtn) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = pad.getBoundingClientRect();
  pad.width = Math.max(200, Math.round(rect.width * dpr));
  pad.height = Math.max(120, Math.round(rect.height * dpr));
  const ctx = pad.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const logicalW = pad.width / dpr;
  const logicalH = pad.height / dpr;
  const reset = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pad.width, pad.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fbfcfe';
    ctx.fillRect(0, 0, logicalW, logicalH);
  };
  reset();

  let drawing = false;
  let last = null;
  const show = (e, phase) => {
    info.replaceChildren(
      h('div', {}, h('span', {}, 'pointerType '), h('b', {}, e.pointerType || '-')),
      h('div', {}, h('span', {}, 'pressure '), h('b', {}, Number(e.pressure || 0).toFixed(2))),
      h('div', {}, h('span', {}, '阶段 '), h('b', {}, phase)),
      h('div', {}, h('span', {}, '坐标 '), h('b', {}, `${Math.round(e.offsetX)}, ${Math.round(e.offsetY)}`)),
    );
  };
  const point = (e) => ({ x: e.offsetX, y: e.offsetY, p: Number(e.pressure) || 0.55 });
  pad.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    drawing = true;
    last = point(e);
    pad.setPointerCapture?.(e.pointerId);
    show(e, '笔尖按下');
    drawDot(ctx, last);
  });
  pad.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    e.preventDefault();
    const pt = point(e);
    drawSeg(ctx, last, pt);
    last = pt;
    show(e, '书写中');
  });
  const stop = (e) => {
    if (!drawing) return;
    drawing = false;
    show(e, '抬起');
  };
  pad.addEventListener('pointerup', stop);
  pad.addEventListener('pointercancel', stop);
  clearBtn.addEventListener('click', reset);
  info.replaceChildren(h('div', {}, '在这里写一笔试试。'));

  function drawDot(c, pt) {
    c.beginPath();
    c.fillStyle = '#1a4fd6';
    c.arc(pt.x, pt.y, 1.8, 0, Math.PI * 2);
    c.fill();
  }
  function drawSeg(c, a, b) {
    c.beginPath();
    c.strokeStyle = '#1a4fd6';
    c.lineWidth = 1.6 + 2.6 * Math.max(0.2, Math.min(1, b.p));
    c.lineCap = 'round';
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
  }
}

function openSubmitModal() {
  if (!state.board || !state.layout) return;
  if (state.submitting) return;
  if (!state.board.hasInk() && !confirm('还没有书写痕迹，仍然提交吗？')) return;

  const note = h('textarea', {
    id: 'submitNote',
    placeholder: '可选：字迹难辨处、你的补充说明……',
    rows: '3',
  });
  note.value = state.note || '';
  note.addEventListener('input', () => {
    state.note = note.value;
  });

  const submit = h('button', { class: 'btn primary', type: 'button' }, '生成并提交');
  const cancel = h('button', { class: 'btn', type: 'button' }, '取消');
  cancel.addEventListener('click', closeModal);
  submit.addEventListener('click', () => {
    state.note = note.value;
    doSubmit(note.value);
  });

  openModal(
    h(
      'div',
      {},
      h('h2', {}, '提交批改'),
      h(
        'p',
        { class: 'muted' },
        '提交后会把每一页的文字和笔迹合成为 PNG，保存到本机 submissions/，然后给你一条批改指令。',
      ),
      h(
        'div',
        { class: 'summary' },
        h('div', {}, h('span', {}, '试卷'), h('b', {}, state.paper.title)),
        h('div', {}, h('span', {}, '页数'), h('b', {}, String(state.layout.pages.length))),
        h('div', {}, h('span', {}, '笔迹'), h('b', {}, String(state.board.count()))),
        h('div', {}, h('span', {}, '用时'), h('b', {}, formatDuration(elapsedSec()))),
      ),
      h('label', { class: 'modal-label', for: 'submitNote' }, '补充说明（可选）'),
      note,
      h('div', { class: 'modal-actions' }, cancel, submit),
    ),
  );
  note.focus();
}

function progressView(text) {
  const label = h('div', {}, text);
  const bar = h('span');
  const root = h(
    'div',
    {},
    h('h2', {}, '正在提交'),
    h('div', { class: 'progress' }, label, h('div', { class: 'progress-bar' }, bar)),
    h('p', { class: 'muted' }, '正在合成页面并保存到本机，请稍候，不要关闭页面。'),
  );
  openModal(root);
  return {
    set(text, pct) {
      label.textContent = text;
      bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    },
  };
}

async function doSubmit(note) {
  if (state.submitting) return;
  state.submitting = true;
  state.modalLocked = true;
  const view = progressView('准备合成…');
  try {
    const strokes = state.board.serialize();
    const payload = await buildSubmissionPayload({
      layout: state.layout,
      strokes,
      paperId: state.paper.id,
      timeSpentSec: elapsedSec(),
      note,
      onProgress: ({ phase, current, total }) => {
        if (phase === 'render') {
          view.set(`正在合成第 ${current} / ${total} 页…`, (current / Math.max(1, total)) * 82);
        } else {
          view.set('正在上传到本地服务…', 92);
        }
      },
    });
    const result = await submitPayload(payload);
    state.submitting = false;
    state.modalLocked = false;
    state.lastSubmitted = {
      id: result.id,
      shortId: result.shortId,
      at: Date.now(),
      dir: result.dir,
    };
    saveDraft();
    showSubmitSuccess(result);
  } catch (err) {
    console.warn('提交失败', err);
    state.submitting = false;
    state.modalLocked = false;
    showSubmitError(err, note);
  }
}

function showSubmitSuccess(result) {
  const instruction = result.instruction || `批改 ${result.shortId}`;
  setSaveState(`已提交 ${result.shortId}`, `回到对话框发送：${instruction}`);
  const code = h('code', { text: instruction });
  const copy = h('button', { class: 'btn', type: 'button' }, '复制指令');
  copy.addEventListener('click', () => copyText(instruction));
  const close = h('button', { class: 'btn primary', type: 'button' }, '关闭');
  close.addEventListener('click', closeModal);
  openModal(
    h(
      'div',
      {},
      h('h2', {}, '已提交，等待批改'),
      h('p', {}, '页面已经保存到本机。现在回到 AI 对话，发送下面这条指令：'),
      h(
        'div',
        { class: 'result-box' },
        h('div', { class: 'muted' }, `提交 ID：${result.id}`),
        h('div', { class: 'code' }, code, copy),
        h('div', { class: 'muted' }, `文件位置：${result.dir}/`),
      ),
      h(
        'p',
        {},
        '发送后，我会读取你的页面图片和答案键，逐题判断对错、核对中文注解，并给出翻译/写作反馈。',
      ),
      h('div', { class: 'modal-actions' }, close),
    ),
  );
}

function showSubmitError(err, note) {
  const message = err && err.message ? err.message : '未知错误';
  const retry = h('button', { class: 'btn primary', type: 'button' }, '重试提交');
  const all = h('button', { class: 'btn', type: 'button' }, '下载全部页面');
  const cur = h('button', { class: 'btn', type: 'button' }, '下载当前页');
  const copy = h('button', { class: 'btn', type: 'button' }, '复制当前页');
  const close = h('button', { class: 'btn', type: 'button' }, '关闭');
  close.addEventListener('click', closeModal);
  retry.addEventListener('click', () => doSubmit(note));
  all.addEventListener('click', () => downloadAllPages(all));
  cur.addEventListener('click', () => downloadCurrentPage(cur));
  copy.addEventListener('click', () => copyCurrentPage(copy));
  openModal(
    h(
      'div',
      {},
      h('h2', {}, '提交失败'),
      h('p', { class: 'error-line' }, message),
      h(
        'p',
        {},
        '本地服务可能已经停止。页面本身还在，你可以先把页面图片下载或复制出来，直接贴到 AI 对话里说「批改」。也可以双击 start.cmd 重启服务后点「重试提交」。',
      ),
      h('div', { class: 'fallback-list' }, all, cur, copy),
      h('div', { class: 'modal-actions' }, close, retry),
    ),
  );
}

async function downloadAllPages(btn) {
  if (!state.board || !state.layout) return;
  btn.disabled = true;
  try {
    const strokes = state.board.serialize();
    for (const page of state.layout.pages) {
      const blob = await renderSinglePage(state.layout, strokes, page.index);
      downloadBlob(blob, `${state.paper.id}-p${String(page.index).padStart(2, '0')}.png`);
      await new Promise((r) => setTimeout(r, 120));
    }
    toast('已逐页下载。若浏览器拦截多个下载，请允许后重试。');
  } catch (err) {
    toast(`导出失败：${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function downloadCurrentPage(btn) {
  if (!state.board || !state.layout) return;
  btn.disabled = true;
  try {
    const blob = await renderSinglePage(
      state.layout,
      state.board.serialize(),
      state.currentPage,
    );
    downloadBlob(blob, `${state.paper.id}-p${String(state.currentPage).padStart(2, '0')}.png`);
    toast('当前页已下载。');
  } catch (err) {
    toast(`导出失败：${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function copyCurrentPage(btn) {
  if (!state.board || !state.layout) return;
  btn.disabled = true;
  try {
    const blob = await renderSinglePage(
      state.layout,
      state.board.serialize(),
      state.currentPage,
    );
    await copyBlob(blob);
    toast('当前页已复制，可直接到对话里粘贴。');
  } catch (err) {
    toast(`复制失败：${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`已复制：${text}`);
  } catch {
    toast('复制失败，请手动选中指令文本。');
  }
}

function initDebug() {
  const params = new URLSearchParams(location.search);
  state.debug = params.has('debug');
  state.debugInk = params.get('debug') === 'ink';
  if (!state.debug && !state.debugInk) return;
  el.debugPanel.hidden = false;
  debugLog(`debug 启动；页面尺寸 ${PAGE_W}x${PAGE_H}`);
  window.addEventListener('error', (e) => {
    debugLog(`ERROR: ${e.message} @ ${e.filename}:${e.lineno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    debugLog(`REJECTION: ${e.reason && e.reason.message ? e.reason.message : e.reason}`);
  });
}

function debugLog(message) {
  if (el.debugPanel.hidden && !state.debug && !state.debugInk) return;
  el.debugPanel.hidden = false;
  const line = document.createTextNode(`${new Date().toLocaleTimeString()}  ${message}\n`);
  el.debugPanel.appendChild(line);
}

function debugLayout() {
  if (!state.debug && !state.debugInk) return;
  if (!state.layout) return;
  const warnings = [];
  let textOps = 0;
  for (const page of state.layout.pages) {
    for (const op of page.ops) {
      if (op.type === 'text') {
        textOps++;
        const w = measure(op.text, op.font);
        let left = op.x;
        if (op.anchor === 'end') left = op.x - w;
        else if (op.anchor === 'middle') left = op.x - w / 2;
        if (left < -0.5 || left + w > PAGE_W + 0.5) {
          warnings.push(`p${page.index} 文本越界 x=${op.x.toFixed(1)} w=${w.toFixed(1)} "${String(op.text).slice(0, 24)}"`);
        }
        if (op.y < 0 || op.y > PAGE_H) {
          warnings.push(`p${page.index} 文本 y 越界 y=${op.y.toFixed(1)}`);
        }
      }
      if (op.type === 'rect' || op.type === 'line') {
        const ys = op.type === 'rect' ? [op.y, op.y + op.h] : [op.y1, op.y2];
        const xs = op.type === 'rect' ? [op.x, op.x + op.w] : [op.x1, op.x2];
        if (Math.min(...xs) < 0 || Math.max(...xs) > PAGE_W + 0.5) {
          warnings.push(`p${page.index} 图形 x 越界`);
        }
        if (Math.min(...ys) < 0 || Math.max(...ys) > PAGE_H) {
          warnings.push(`p${page.index} 图形 y 越界`);
        }
      }
    }
    for (const item of page.items) {
      if (item.x < 0 || item.x + item.w > PAGE_W || item.y < 0 || item.y + item.h > PAGE_H) {
        warnings.push(`p${page.index} 锚点 ${item.number || item.kind} 越界`);
      }
    }
  }
  debugLog(
    `pages=${state.layout.pages.length} items=${state.layout.totalItems} textOps=${textOps} warnings=${warnings.length}`,
  );
  for (const warning of warnings.slice(0, 12)) debugLog(`WARN ${warning}`);
}

function addDemoInk() {
  if (!state.board || !state.layout) return;
  const page = state.layout.pages.find((p) => p.index === 2) || state.layout.pages[0];
  const n = page.index;
  const strokes = [
    {
      page: n,
      tool: 'pen',
      color: '#1a4fd6',
      width: 3.5,
      points: [
        { x: 120, y: 180, p: 0.4 },
        { x: 150, y: 135, p: 0.75 },
        { x: 185, y: 200, p: 0.5 },
        { x: 215, y: 165, p: 0.8 },
        { x: 260, y: 190, p: 0.35 },
      ],
    },
    {
      page: n,
      tool: 'pen',
      color: '#d92d20',
      width: 2.5,
      points: [
        { x: 690, y: 170, p: 0.5 },
        { x: 710, y: 200, p: 0.7 },
        { x: 690, y: 225, p: 0.4 },
        { x: 715, y: 250, p: 0.7 },
      ],
    },
    {
      page: n,
      tool: 'pen',
      color: '#1a4fd6',
      width: 3.5,
      points: [
        { x: 645, y: 230, p: 0.5 },
        { x: 670, y: 250, p: 0.9 },
        { x: 645, y: 275, p: 0.45 },
      ],
    },
  ];
  state.board.load(strokes);
  state.currentPage = n;
  const params = new URLSearchParams(location.search);
  if (params.get('scroll') !== '0') scrollToPage(n, false);
  updateInkCount();
  debugLog(`demo ink loaded on page ${n}`);
  if (params.get('autosubmit') === '1') {
    setTimeout(() => {
      debugLog('autosubmit: 开始提交测试');
      doSubmit('headless autosubmit');
    }, 500);
  }
}

const center = createLearningCenter({
  state,
  h,
  toast,
  openModal,
  closeModal,
  refreshPapers,
  loadPaper: async (paperId) => {
    closeModal();
    await loadPaper(paperId);
  },
  setWide: (wide) => el.modal.classList.toggle('wide', Boolean(wide)),
  isOpen: () => !el.modal.hidden,
});

el.centerBtn.addEventListener('click', () => {
  if (state.submitting) {
    toast('正在提交，请稍候再打开学习中心。');
    return;
  }
  center.open('history');
});

window.__practice = { state, el, center };

boot();
