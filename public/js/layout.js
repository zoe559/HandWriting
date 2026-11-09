/* 试卷排版：把 papers.json 的 section/block 变成按页的绘制指令和锚点。
 * 逻辑坐标 794x1123（A4 @96dpi）。所有文字先用 canvas measureText 断行，
 * 再由 render.js 用同一份坐标画成 SVG / canvas。 */

export const PAGE_W = 794;
export const PAGE_H = 1123;

const MARGIN_X = 50;
const CONTENT_TOP = 92;
const BOTTOM = 1042;
const FULL_W = 694; // 50 .. 744
const BODY_W = 560; // 50 .. 610
const ANSWER_BOX_X = 620;
const ANSWER_BOX_W = 40;
const ANSWER_BOX_H = 30;
const NOTE_LINE_X = 668;

const EN_FAMILY = 'Georgia, "Times New Roman", "Microsoft YaHei", "SimSun", serif';
const UI_FAMILY = '"Microsoft YaHei", "Segoe UI", Arial, sans-serif';

export const FONTS = {
  body: { size: 16, weight: 400, style: 'normal', family: EN_FAMILY, color: '#151515', lh: 31 },
  bodyBold: { size: 16, weight: 700, style: 'normal', family: EN_FAMILY, color: '#111111', lh: 31 },
  passage: { size: 16, weight: 400, style: 'normal', family: EN_FAMILY, color: '#151515', lh: 31 },
  option: { size: 15, weight: 400, style: 'normal', family: EN_FAMILY, color: '#1c1c1c', lh: 27 },
  prompt: { size: 15, weight: 400, style: 'normal', family: EN_FAMILY, color: '#222222', lh: 28 },
  cjk: { size: 16, weight: 400, style: 'normal', family: UI_FAMILY, color: '#151515', lh: 30 },
  small: { size: 13, weight: 400, style: 'normal', family: UI_FAMILY, color: '#555555', lh: 20 },
  smallItalic: { size: 13, weight: 400, style: 'italic', family: EN_FAMILY, color: '#555555', lh: 20 },
  heading: { size: 18, weight: 700, style: 'normal', family: UI_FAMILY, color: '#101010', lh: 26 },
  word: { size: 15, weight: 400, style: 'normal', family: EN_FAMILY, color: '#222222', lh: 24 },
  articleTitle: { size: 20, weight: 700, style: 'normal', family: UI_FAMILY, color: '#101010', lh: 30 },
  tableTitle: { size: 17, weight: 700, style: 'normal', family: UI_FAMILY, color: '#101010', lh: 24 },
  vocabNumber: { size: 11, weight: 700, style: 'normal', family: UI_FAMILY, color: '#1a4fd6', lh: 13 },
  footer: { size: 10.5, weight: 400, style: 'normal', family: UI_FAMILY, color: '#8a8f98', lh: 14 },
  lineNo: { size: 10, weight: 400, style: 'normal', family: UI_FAMILY, color: '#b0b4ba', lh: 12 },
  boxLabel: { size: 9, weight: 400, style: 'normal', family: UI_FAMILY, color: '#9aa0a8', lh: 10 },
};

let measureCtx = null;
function ctx2d() {
  if (!measureCtx) {
    const c = document.createElement('canvas');
    measureCtx = c.getContext('2d');
  }
  return measureCtx;
}

export function fontCss(font) {
  return `${font.style || 'normal'} ${font.weight || 400} ${font.size}px ${font.family}`;
}

export function measure(text, font) {
  const c = ctx2d();
  c.font = fontCss(font);
  return c.measureText(text).width;
}

function isCjk(ch) {
  return /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch);
}

function tokenize(text) {
  const out = [];
  let buf = '';
  for (const ch of text) {
    if (/\s/.test(ch)) {
      if (buf) {
        out.push(buf);
        buf = '';
      }
      out.push(' ');
    } else if (isCjk(ch)) {
      if (buf) {
        out.push(buf);
        buf = '';
      }
      out.push(ch);
    } else {
      buf += ch;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** 按宽度断行；英文按词、中文按字、长 token 强制按字符拆。 */
export function wrapText(text, font, maxWidth) {
  const source = String(text == null ? '' : text);
  const lines = [];
  for (const para of source.split('\n')) {
    if (!para) {
      lines.push('');
      continue;
    }
    const tokens = tokenize(para);
    let line = '';
    let width = 0;
    const push = () => {
      lines.push(line.replace(/\s+$/g, ''));
      line = '';
      width = 0;
    };
    for (const token of tokens) {
      if (token === ' ') {
        if (!line) continue;
        const sw = measure(' ', font);
        if (width + sw > maxWidth) {
          push();
          continue;
        }
        line += ' ';
        width += sw;
        continue;
      }
      const tw = measure(token, font);
      if (width + tw <= maxWidth) {
        line += token;
        width += tw;
        continue;
      }
      if (line) push();
      if (tw <= maxWidth) {
        line = token;
        width = tw;
        continue;
      }
      let chunk = '';
      let chunkW = 0;
      for (const ch of token) {
        const cw = measure(ch, font);
        if (chunkW + cw > maxWidth && chunk) {
          lines.push(chunk);
          chunk = '';
          chunkW = 0;
        }
        chunk += ch;
        chunkW += cw;
      }
      if (chunk) {
        line = chunk;
        width = chunkW;
      }
    }
    if (line) push();
  }
  return lines;
}

function hasCjk(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''));
}

function countCjk(text) {
  return (String(text || '').match(/[\u4e00-\u9fff]/g) || []).length;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];

function circledNumber(n) {
  return CIRCLED[Number(n) - 1] || `(${n})`;
}

/** 生成整卷的分页绘制数据。 */
export function layoutPaper(paper) {
  const pages = [];
  let page = null;
  let currentSection = '';
  let totalItems = 0;
  const itemIndex = new Map();

  function startPage(sectionTitle) {
    currentSection = sectionTitle || currentSection;
    page = {
      index: pages.length + 1,
      section: currentSection,
      ops: [],
      items: [],
      lines: [],
      y: CONTENT_TOP,
    };
    pages.push(page);
  }

  function ensure(height) {
    if (!page) startPage('');
    if (page.y + height > BOTTOM) {
      startPage(currentSection);
    }
  }

  function addText(text, x, baseline, font, anchor = 'start') {
    page.ops.push({ type: 'text', x, y: baseline, text, font, anchor });
  }

  function addRect(x, y, w, h, fill, stroke, lw = 1, rx = 0) {
    page.ops.push({ type: 'rect', x, y, w, h, fill, stroke, lw, rx });
  }

  function addLine(x1, y1, x2, y2, stroke, lw = 1, dash = null) {
    page.ops.push({ type: 'line', x1, y1, x2, y2, stroke, lw, dash });
  }

  function recordLine(text, x, baseline, font) {
    page.lines.push({ text, x, y: baseline, w: measure(text, font) });
  }

  function drawWrapped(lines, x, font, opts = {}) {
    const lineHeight = opts.lineHeight || font.lh || font.size * 1.6;
    const anchor = opts.anchor || 'start';
    const record = opts.record !== false;
    const out = [];
    for (const line of lines) {
      ensure(lineHeight);
      const baseline = page.y + font.size;
      addText(line, x, baseline, font, anchor);
      if (record) recordLine(line, x, baseline, font);
      page.y += lineHeight;
      out.push({ text: line, x, y: baseline });
    }
    return out;
  }

  function drawSection(section) {
    startPage(section.heading || section.id || '');
    page.y = CONTENT_TOP;
    const headingLines = wrapText(section.heading || '', FONTS.heading, FULL_W);
    drawWrapped(headingLines, MARGIN_X, FONTS.heading, { lineHeight: 26 });
    page.y += 3;
    if (section.instructions) {
      const ins = wrapText(section.instructions, FONTS.smallItalic, FULL_W);
      drawWrapped(ins, MARGIN_X, FONTS.smallItalic, { lineHeight: 19 });
    }
    page.y += 10;
    addLine(MARGIN_X, page.y, PAGE_W - MARGIN_X, page.y, '#d8dde3', 1);
    page.y += 14;
  }

  function drawBodyParagraph(text, opts = {}) {
    const font = opts.font || FONTS.body;
    const width = opts.width || BODY_W;
    const lines = wrapText(text, font, width);
    const gap = opts.gap == null ? 10 : opts.gap;
    if (!lines.length) return;
    ensure(Math.min(lines.length * font.lh, BOTTOM - CONTENT_TOP));
    drawWrapped(lines, opts.x || MARGIN_X, font, { lineHeight: font.lh, record: true });
    page.y += gap;
  }

  function drawPrompt(block) {
    const text = block.text || '';
    const font = hasCjk(text) && countCjk(text) > 8 ? FONTS.cjk : FONTS.prompt;
    const lines = wrapText(text, font, FULL_W);
    if (!lines.length) return;
    ensure(Math.min(lines.length * font.lh, BOTTOM - CONTENT_TOP));
    drawWrapped(lines, MARGIN_X, font, { lineHeight: font.lh });
    page.y += 14;
  }

  function drawParagraph(block) {
    const label = block.label ? String(block.label) : '';
    const text = block.text || '';
    const x = label ? 78 : MARGIN_X;
    const width = label ? 532 : BODY_W;
    const lines = wrapText(text, FONTS.body, width);
    if (!lines.length) return;
    ensure(Math.min(lines.length * FONTS.body.lh, BOTTOM - CONTENT_TOP));
    lines.forEach((line, idx) => {
      ensure(FONTS.body.lh);
      const baseline = page.y + FONTS.body.size;
      if (idx === 0 && label) {
        addText(label, MARGIN_X, baseline, FONTS.bodyBold);
      }
      addText(line, x, baseline, FONTS.body);
      recordLine((idx === 0 && label ? label + '  ' : '') + line, x, baseline, FONTS.body);
      page.y += FONTS.body.lh;
    });
    page.y += 12;
  }

  function drawPassage(block) {
    const paras = String(block.text || '').split(/\n\s*\n/);
    for (const para of paras) {
      if (!para.trim()) continue;
      drawBodyParagraph(para, { gap: 10 });
    }
    page.y += 4;
  }

  function drawWordBank(block) {
    const items = Array.isArray(block.items) ? block.items.flatMap((w) => String(w).split(/\s{2,}/)) : [];
    const words = items.length ? items : [];
    const cols = 3;
    const rows = Math.max(1, Math.ceil(words.length / cols));
    const cellW = FULL_W / cols;
    const rowH = 26;
    const boxH = rows * rowH + 22;
    ensure(boxH + 16);
    const top = page.y;
    addRect(MARGIN_X, top, FULL_W, boxH, '#fafbfc', '#dfe3e8', 1, 4);
    addText('Word Bank', MARGIN_X + 10, top + 13, FONTS.boxLabel);
    for (let i = 0; i < words.length; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = MARGIN_X + 12 + c * cellW;
      const y = top + 32 + r * rowH;
      addText(words[i], x, y, FONTS.word);
    }
    page.y = top + boxH + 12;
  }

  function drawCloze(block) {
    const raw = String(block.text || '').replace(/\[\[(\d+)\]\]/g, (_, n) => '_______(' + n + ')_______');
    const paras = raw.split(/\n\s*\n/);
    for (const para of paras) {
      if (!para.trim()) continue;
      const lines = wrapText(para, FONTS.body, BODY_W);
      ensure(Math.min(lines.length * FONTS.body.lh, BOTTOM - CONTENT_TOP));
      for (const line of lines) {
        ensure(FONTS.body.lh);
        const baseline = page.y + FONTS.body.size;
        addText(line, MARGIN_X, baseline, FONTS.body);
        recordLine(line, MARGIN_X, baseline, FONTS.body);
        for (const m of line.matchAll(/_{3,}\((\d+)\)_{3,}/g)) {
          const number = Number(m[1]);
          const bx = MARGIN_X + measure(line.slice(0, m.index || 0), FONTS.body);
          const bw = measure(m[0], FONTS.body);
          page.items.push({ number, kind: 'blank', x: bx, y: baseline - 18, w: bw, h: 24 });
          if (itemIndex.has(number)) console.warn('重复题号', number);
          itemIndex.set(number, { page: page.index, x: bx, y: baseline - 18, w: bw, h: 24 });
          totalItems++;
        }
        page.y += FONTS.body.lh;
      }
      page.y += 10;
    }
  }

  function drawAnswerQuestion(item, opts = {}) {
    const number = Number(item.number);
    const stem = String(item.stem || item.text || '');
    const stemFont = FONTS.body;
    const stemX = 86;
    const stemW = 610 - stemX;
    const stemLines = wrapText(stem, stemFont, stemW);
    const options = Array.isArray(item.options) ? item.options.map(String) : [];
    const optionLines = options.map((opt) => wrapText(opt, FONTS.option, 506));
    const optionHeight = optionLines.reduce((sum, lines) => sum + lines.length * FONTS.option.lh, 0);
    const height = stemLines.length * stemFont.lh + optionHeight + 16;
    const capacity = BOTTOM - CONTENT_TOP;
    if (height <= capacity) ensure(height);
    else ensure(stemFont.lh * 2);

    const top = page.y;
    const firstBaseline = top + stemFont.size;
    addText(String(number) + '.', 76, firstBaseline, FONTS.bodyBold, 'end');
    stemLines.forEach((line, idx) => {
      const baseline = firstBaseline + idx * stemFont.lh;
      addText(line, stemX, baseline, stemFont);
      recordLine(line, stemX, baseline, stemFont);
    });

    const boxY = firstBaseline - 22;
    addRect(ANSWER_BOX_X, boxY, ANSWER_BOX_W, ANSWER_BOX_H, '#ffffff', '#aeb5bf', 1, 3);
    addText('答', ANSWER_BOX_X + 5, boxY + 12, FONTS.boxLabel);
    page.items.push({
      number,
      kind: opts.kind || 'question',
      x: ANSWER_BOX_X,
      y: boxY,
      w: ANSWER_BOX_W,
      h: ANSWER_BOX_H,
    });
    if (itemIndex.has(number)) console.warn('重复题号', number);
    itemIndex.set(number, { page: page.index, x: ANSWER_BOX_X, y: boxY, w: ANSWER_BOX_W, h: ANSWER_BOX_H });
    totalItems++;

    let y = top + stemLines.length * stemFont.lh + 4;
    for (let i = 0; i < options.length; i++) {
      for (let j = 0; j < optionLines[i].length; j++) {
        const baseline = y + FONTS.option.size;
        const x = 104 + (j > 0 ? 16 : 0);
        addText(optionLines[i][j], x, baseline, FONTS.option);
        recordLine(optionLines[i][j], x, baseline, FONTS.option);
        y += FONTS.option.lh;
      }
      y += 1;
    }
    page.y = y + 8;
  }

  function questionHeight(item) {
    const stemLines = wrapText(String(item.stem || item.text || ''), FONTS.body, 610 - 86);
    const options = Array.isArray(item.options) ? item.options.map(String) : [];
    const optionLines = options.map((opt) => wrapText(opt, FONTS.option, 506));
    const optionHeight = optionLines.reduce(
      (sum, lines) => sum + lines.length * FONTS.option.lh + 1,
      0,
    );
    return stemLines.length * FONTS.body.lh + 4 + optionHeight + 8;
  }

  function drawMcq(block) {
    const items = block.items || [];
    const total = items.reduce((sum, item) => sum + questionHeight(item), 0);
    const capacity = BOTTOM - CONTENT_TOP;
    // 一组题能放入一页时，尽量整组放在同一页，避免最后一题被孤零零推到下一页。
    if (total <= capacity && page.y + total > BOTTOM) startPage(currentSection);
    for (const item of items) drawAnswerQuestion(item, { kind: 'mcq' });
  }

  function drawStatements(block) {
    // 把 10 条匹配题集中到独立一页，避免在页尾被拆成两页。
    startPage(currentSection);
    page.y = CONTENT_TOP + 4;
    addText('请将对应段落的字母写在每题右侧的「答」框内。', MARGIN_X, page.y + 11, FONTS.small);
    page.y += 24;
    for (const item of block.items || []) drawAnswerQuestion(item, { kind: 'match' });
  }

  function drawAnswerLines(block) {
    const count = Math.max(1, Number(block.count) || 8);
    const label = block.label || 'Answer';
    addText('答题区 · 请在横线上书写；中文注解可写行间或页面空白处', MARGIN_X, page.y + 11, FONTS.small);
    page.y += 18;
    let areaStart = null;
    let areaPage = null;

    const flushArea = () => {
      if (areaStart != null && areaPage) {
        areaPage.items.push({
          kind: 'answerArea',
          label,
          x: MARGIN_X,
          y: areaStart,
          w: FULL_W,
          h: Math.max(10, areaPage.y - areaStart),
        });
      }
      areaStart = null;
      areaPage = null;
    };

    for (let i = 1; i <= count; i++) {
      if (page.y + 38 > BOTTOM) {
        flushArea();
        startPage(currentSection);
        page.y = CONTENT_TOP;
        addText(label + '（续）', MARGIN_X, page.y + 11, FONTS.small);
        page.y += 18;
      }
      if (areaStart == null) {
        areaStart = page.y;
        areaPage = page;
      }
      const lineY = page.y + 28;
      addLine(MARGIN_X, lineY, PAGE_W - MARGIN_X, lineY, '#cfd5dc', 1);
      if (i % 5 === 0) {
        addText(String(i), MARGIN_X - 14, lineY - 4, FONTS.lineNo, 'end');
      }
      page.y += 38;
    }
    flushArea();
    page.y += 8;
  }

  function drawVocabArticle(block) {
    const title = block.title || '';
    const note = block.note || '';
    const targets = (block.targets || []).map((t, i) => ({
      number: Number(t.number) || i + 1,
      word: String(t.word || '').trim(),
    })).filter((t) => t.word);

    if (title) {
      ensure(30);
      addText(title, MARGIN_X, page.y + 18, FONTS.articleTitle);
      page.y += 32;
    }
    if (note) {
      const noteLines = wrapText(note, FONTS.small, FULL_W);
      ensure(noteLines.length * 19);
      drawWrapped(noteLines, MARGIN_X, FONTS.small, { lineHeight: 19 });
      page.y += 8;
    }

    const found = new Set();
    const paras = String(block.text || '').split(/\n\s*\n/);
    for (const para of paras) {
      if (!para.trim()) continue;
      const lines = wrapText(para, FONTS.body, BODY_W);
      if (!lines.length) continue;
      ensure(Math.min(lines.length * FONTS.body.lh, BOTTOM - CONTENT_TOP));
      for (const line of lines) {
        ensure(FONTS.body.lh);
        const baseline = page.y + FONTS.body.size;
        addText(line, MARGIN_X, baseline, FONTS.body);
        recordLine(line, MARGIN_X, baseline, FONTS.body);

        for (const target of targets) {
          const re = new RegExp(`\\b${escapeRegExp(target.word)}\\b`, 'gi');
          let match;
          while ((match = re.exec(line))) {
            found.add(target.word.toLowerCase());
            const x = MARGIN_X + measure(line.slice(0, match.index), FONTS.body);
            const wordWidth = measure(match[0], FONTS.body);
            // 浅蓝底 + 下划线 + 上方编号；编号不会挤到后面的单词。
            addRect(x - 1, baseline - 15, wordWidth + 2, 19, '#eef4ff', null, 0, 2);
            addText(match[0], x, baseline, FONTS.body);
            addLine(x, baseline + 3, x + wordWidth, baseline + 3, '#6f95ff', 1.5);
            addText(
              circledNumber(target.number),
              x + wordWidth / 2,
              baseline - 13,
              FONTS.vocabNumber,
              'middle',
            );
          }
        }
        page.y += FONTS.body.lh;
      }
      page.y += 12;
    }

    const missing = targets.filter((t) => !found.has(t.word.toLowerCase()));
    if (missing.length) {
      console.warn('vocabArticle 中没有找到目标词:', missing.map((t) => t.word).join(', '));
      addText('排版提示：有目标词未在文章中找到，请检查题目数据。', MARGIN_X, page.y + 11, FONTS.small);
      page.y += 20;
    }
    page.y += 4;
  }

  function drawVocabTable(block) {
    const items = block.items || [];
    const title = block.title || '中文注解表';
    ensure(60);
    addText(title, MARGIN_X, page.y + 18, FONTS.tableTitle);
    page.y += 28;
    addText('结合文章语境，写出下列单词的中文意思；也可以写在文章右侧留白。', MARGIN_X, page.y + 11, FONTS.small);
    page.y += 28;

    for (const item of items) {
      if (page.y + 46 > BOTTOM) {
        startPage(currentSection);
        page.y = CONTENT_TOP;
        addText(title + '（续）', MARGIN_X, page.y + 16, FONTS.tableTitle);
        page.y += 28;
      }
      const baseline = page.y + 22;
      const number = Number(item.number) || 0;
      addText(circledNumber(number), MARGIN_X, baseline, FONTS.vocabNumber);
      addText(String(item.word || ''), 86, baseline, FONTS.bodyBold);
      addLine(260, baseline + 2, PAGE_W - MARGIN_X, baseline + 2, '#c7ced8', 1);
      page.items.push({
        number,
        kind: 'vocab',
        x: 210,
        y: baseline - 18,
        w: PAGE_W - MARGIN_X - 210,
        h: 30,
      });
      if (itemIndex.has(number)) console.warn('重复题号', number);
      itemIndex.set(number, {
        page: page.index,
        x: 210,
        y: baseline - 18,
        w: PAGE_W - MARGIN_X - 210,
        h: 30,
      });
      totalItems++;
      page.y += 46;
    }
    page.y += 6;
  }

  function drawBlock(block) {
    switch (block.type) {
      case 'prompt':
        drawPrompt(block);
        break;
      case 'paragraph':
        drawParagraph(block);
        break;
      case 'passage':
        drawPassage(block);
        break;
      case 'wordBank':
        drawWordBank(block);
        break;
      case 'clozePassage':
        drawCloze(block);
        break;
      case 'matchingStatements':
        drawStatements(block);
        break;
      case 'mcq':
        drawMcq(block);
        break;
      case 'answerLines':
        drawAnswerLines(block);
        break;
      case 'vocabArticle':
        drawVocabArticle(block);
        break;
      case 'vocabTable':
        drawVocabTable(block);
        break;
      case 'pageBreak':
        startPage(currentSection);
        page.y = CONTENT_TOP;
        break;
      default:
        console.warn('未知 block 类型', block.type);
    }
  }

  for (const section of paper.sections || []) {
    drawSection(section);
    for (const block of section.blocks || []) drawBlock(block);
  }

  if (!pages.length) startPage('');

  for (const p of pages) {
    const isVocabPage = p.items.some((it) => it.kind === 'vocab');
    const isAnswerPage = p.items.some((it) => it.kind === 'answerArea') || isVocabPage;
    const header = [
      { type: 'rect', x: 0, y: 0, w: PAGE_W, h: PAGE_H, fill: '#ffffff' },
      { type: 'line', x1: MARGIN_X, y1: 52, x2: PAGE_W - MARGIN_X, y2: 52, stroke: '#eef0f2', lw: 1 },
      { type: 'text', x: MARGIN_X, y: 34, text: paper.title || '', font: FONTS.footer, anchor: 'start' },
      {
        type: 'text',
        x: PAGE_W - MARGIN_X,
        y: 34,
        text: paper.kind === 'vocab' ? 'CET-6 · 词汇巩固' : 'CET-6 · 文字部分',
        font: FONTS.footer,
        anchor: 'end',
      },
    ];
    if (!isAnswerPage) {
      header.push({
        type: 'line',
        x1: NOTE_LINE_X,
        y1: 78,
        x2: NOTE_LINE_X,
        y2: 1058,
        stroke: '#e7e9ec',
        lw: 1,
        dash: [2, 5],
      });
    }
    p.ops.unshift(...header);
    p.ops.push(
      { type: 'line', x1: MARGIN_X, y1: 1070, x2: PAGE_W - MARGIN_X, y2: 1070, stroke: '#e2e6ea', lw: 1 },
      { type: 'text', x: MARGIN_X, y: 1090, text: p.section || '', font: FONTS.footer, anchor: 'start' },
      {
        type: 'text',
        x: PAGE_W - MARGIN_X,
        y: 1090,
        text: isVocabPage
          ? `第 ${p.index} / ${pages.length} 页 · 请写出单词在语境中的中文义`
          : isAnswerPage
            ? `第 ${p.index} / ${pages.length} 页 · 中文注解可写行间或空白处`
            : `第 ${p.index} / ${pages.length} 页 · 右侧留白可写中文注解`,
        font: FONTS.footer,
        anchor: 'end',
      },
    );
  }

  return {
    pageWidth: PAGE_W,
    pageHeight: PAGE_H,
    pages,
    totalItems,
    itemIndex,
    paperId: paper.id,
    paperTitle: paper.title,
  };
}
