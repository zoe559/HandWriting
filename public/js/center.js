/* 学习中心：提交历史 / 批改报告、错词本、试卷库与导入。 */
import { api } from './api.js';

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"]/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  }[ch]));
}

function inlineMd(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,，。]|$)/g, '$1<em>$2</em>');
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
  );
  return html;
}

function renderMarkdown(markdown) {
  const root = document.createElement('div');
  root.className = 'report';
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  const addInline = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    node.innerHTML = inlineMd(text);
    root.appendChild(node);
    return node;
  };

  const splitRow = (line) => {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((cell) => cell.trim());
  };

  const isTableSep = (line) => /^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/.test(line);

  const isSpecial = (line) => {
    const t = line.trim();
    return (
      !t ||
      /^#{1,4}\s+/.test(t) ||
      /^```/.test(t) ||
      /^---+$/.test(t) ||
      /^>\s?/.test(t) ||
      /^[-*]\s+/.test(t) ||
      /^\d+\.\s+/.test(t) ||
      t.startsWith('|')
    );
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      i++;
      const pre = document.createElement('pre');
      const codeEl = document.createElement('code');
      codeEl.textContent = code.join('\n');
      pre.appendChild(codeEl);
      root.appendChild(pre);
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = Math.min(4, heading[1].length + 1); // # -> h2, ## -> h3
      addInline(`h${level}`, heading[2]);
      i++;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      root.appendChild(document.createElement('hr'));
      i++;
      continue;
    }

    if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const cell of header) {
        const th = document.createElement('th');
        th.innerHTML = inlineMd(cell);
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (const row of rows) {
        const tr = document.createElement('tr');
        for (let c = 0; c < header.length; c++) {
          const td = document.createElement('td');
          td.innerHTML = inlineMd(row[c] || '');
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      root.appendChild(table);
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      const quote = document.createElement('blockquote');
      quote.innerHTML = quoteLines.map(inlineMd).join('<br>');
      root.appendChild(quote);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const ul = document.createElement('ul');
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        const li = document.createElement('li');
        li.innerHTML = inlineMd(lines[i].trim().replace(/^[-*]\s+/, ''));
        ul.appendChild(li);
        i++;
      }
      root.appendChild(ul);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const ol = document.createElement('ol');
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        const li = document.createElement('li');
        li.innerHTML = inlineMd(lines[i].trim().replace(/^\d+\.\s+/, ''));
        ol.appendChild(li);
        i++;
      }
      root.appendChild(ol);
      continue;
    }

    const paragraph = [];
    while (i < lines.length && !isSpecial(lines[i])) {
      paragraph.push(lines[i].trim());
      i++;
    }
    addInline('p', paragraph.join(' '));
  }

  return root;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm} 分 ${String(ss).padStart(2, '0')} 秒`;
}

function scoreText(meta) {
  const scores = meta && meta.scores;
  if (!scores) return '';
  if (Number.isFinite(Number(scores.vocabCorrect))) {
    return `词汇 ${scores.vocabCorrect}/${scores.vocabTotal}`;
  }
  if (Number.isFinite(Number(scores.clozeCorrect))) {
    return `选词 ${scores.clozeCorrect}/${scores.clozeTotal}`;
  }
  if (Number.isFinite(Number(scores.objective))) {
    return `客观 ${scores.objective}/${scores.objectiveTotal || 30}`;
  }
  return '';
}

function shortId(meta) {
  return meta.shortId || String(meta.id || '').slice(-11);
}

function copyText(text) {
  if (!navigator.clipboard) return Promise.reject(new Error('浏览器不支持剪贴板'));
  return navigator.clipboard.writeText(text);
}

function openLightbox(src, alt) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  const image = document.createElement('img');
  image.src = src;
  image.alt = alt || '';
  const close = document.createElement('button');
  close.className = 'lightbox-close';
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', '关闭图片');
  overlay.append(image, close);
  document.body.appendChild(overlay);
  const dismiss = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') dismiss();
  };
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) dismiss();
  });
  close.addEventListener('click', dismiss);
  document.addEventListener('keydown', onKey);
}

const SAMPLE_PAYLOAD = {
  paper: {
    id: 'my-paper-01',
    title: '我的练习卷 01',
    kind: 'exam',
    durationMinutes: 30,
    sections: [
      {
        id: 'reading',
        heading: 'Part I  Reading',
        instructions: 'Directions: Read the passage and choose the best answer.',
        blocks: [
          {
            type: 'passage',
            text:
              'This is a sample passage. Replace it with your own text. The quick brown fox jumps over the lazy dog.',
          },
          {
            type: 'mcq',
            items: [
              {
                number: 1,
                stem: 'What is the main idea of the passage?',
                options: ['A) Sample option one.', 'B) Sample option two.', 'C) Sample option three.', 'D) Sample option four.'],
              },
            ],
          },
        ],
      },
    ],
  },
  keys: {
    paperId: 'my-paper-01',
    objective: { '1': 'B' },
    explanations: { '1': '示例解析：把这里换成你的解释。' },
  },
};

export function createLearningCenter(ctx) {
  const { state, h, toast, openModal, closeModal, loadPaper, refreshPapers, setWide } = ctx;
  let tab = 'history';
  let active = false;

  const history = {
    rows: null,
    loading: false,
    error: '',
    selected: null,
    filter: 'all',
    feedback: new Map(),
    feedbackLoading: new Set(),
  };

  const errors = {
    data: null,
    loading: false,
    error: '',
    selected: new Set(),
    initialized: false,
  };

  const library = {
    mode: 'list',
    loading: false,
    error: '',
    status: '',
    text: '',
    overwrite: false,
    importing: false,
  };

  function close() {
    active = false;
    setWide(false);
    closeModal();
  }

  function open(initialTab = 'history') {
    const normalized =
      initialTab === 'errors' || initialTab === 'library' || initialTab === 'import'
        ? initialTab
        : 'history';
    if (normalized === 'import') {
      tab = 'library';
      library.mode = 'import';
    } else {
      tab = normalized;
    }
    active = true;
    // 先让 modal 可见，再走统一的 render；这样异步加载回来时不会把已关闭的窗口重新打开。
    openModal(h('div', { class: 'center-empty' }, '加载中…'));
    setWide(true);
    render();
  }

  function setTab(next) {
    if (!active) return;
    tab = next;
    render();
  }

  function render() {
    if (!active) return;
    if (ctx.isOpen && !ctx.isOpen()) {
      active = false;
      return;
    }
    const tabs = [
      ['history', '提交历史'],
      ['errors', '错词本'],
      ['library', '试卷库'],
    ];
    const body = h('div', { class: 'center-body' });
    if (tab === 'history') renderHistory(body);
    else if (tab === 'errors') renderErrors(body);
    else renderLibrary(body);

    const content = h(
      'div',
      { class: 'center' },
      h(
        'div',
        { class: 'center-head' },
        h(
          'div',
          {},
          h('h2', {}, '学习中心'),
          h('p', { class: 'muted' }, '提交历史、错词本与试卷库'),
        ),
        h(
          'div',
          { class: 'center-tabs' },
          ...tabs.map(([value, label]) =>
            h(
              'button',
              {
                class: `center-tab${tab === value ? ' active' : ''}`,
                type: 'button',
                onclick: () => setTab(value),
              },
              label,
            ),
          ),
        ),
      ),
      body,
    );
    openModal(content);
    setWide(true);
  }

  /* ---------------- 历史提交 / 批改报告 ---------------- */

  async function loadHistory(force = false) {
    if (history.loading) return;
    if (history.rows && !force) return;
    history.loading = true;
    history.error = '';
    render();
    try {
      const data = await api.submissions();
      history.rows = Array.isArray(data.submissions) ? data.submissions : [];
      if (!history.selected && history.rows.length) history.selected = history.rows[0].id;
      if (history.selected && !history.rows.some((row) => row.id === history.selected)) {
        history.selected = history.rows[0] ? history.rows[0].id : null;
      }
    } catch (err) {
      history.error = err.message;
      history.rows = [];
    } finally {
      history.loading = false;
      render();
    }
  }

  async function ensureFeedback(id) {
    if (!id || history.feedback.has(id) || history.feedbackLoading.has(id)) return;
    const row = (history.rows || []).find((item) => item.id === id);
    if (!row || row.status !== 'graded') return;
    history.feedbackLoading.add(id);
    try {
      const data = await api.feedback(id);
      history.feedback.set(id, data);
    } catch (err) {
      history.feedback.set(id, { error: err.message });
    } finally {
      history.feedbackLoading.delete(id);
      render();
    }
  }

  function historyRows() {
    const rows = history.rows || [];
    if (history.filter === 'current') {
      return rows.filter((row) => state.paper && row.paperId === state.paper.id);
    }
    if (history.filter === 'graded') return rows.filter((row) => row.status === 'graded');
    if (history.filter === 'submitted') return rows.filter((row) => row.status !== 'graded');
    return rows;
  }

  function renderHistory(body) {
    if (!history.rows && !history.loading) {
      loadHistory();
    }
    const toolbar = h(
      'div',
      { class: 'center-toolbar' },
      h(
        'div',
        { class: 'filter-row' },
        ...[
          ['all', '全部'],
          ['current', '当前卷'],
          ['graded', '已批改'],
          ['submitted', '待批改'],
        ].map(([value, label]) =>
          h(
            'button',
            {
              class: `chip${history.filter === value ? ' active' : ''}`,
              type: 'button',
              onclick: () => {
                history.filter = value;
                render();
              },
            },
            label,
          ),
        ),
      ),
      h(
        'button',
        { class: 'btn', type: 'button', onclick: () => loadHistory(true) },
        '刷新',
      ),
    );

    if (history.loading && !history.rows) {
      body.append(toolbar, h('div', { class: 'center-empty' }, '正在读取提交记录…'));
      return;
    }
    if (history.error) {
      body.append(
        toolbar,
        h(
          'div',
          { class: 'center-empty error-text' },
          history.error,
          h('button', { class: 'btn', type: 'button', onclick: () => loadHistory(true) }, '重试'),
        ),
      );
      return;
    }

    const rows = historyRows();
    if (!rows.length) {
      body.append(
        toolbar,
        h('div', { class: 'center-empty' }, '还没有提交。做完题点“提交批改”后会出现在这里。'),
      );
      return;
    }

    const list = h('div', { class: 'history-list' });
    for (const row of rows) {
      const selected = history.selected === row.id;
      const card = h(
        'button',
        {
          class: `history-card${selected ? ' selected' : ''}`,
          type: 'button',
          onclick: () => {
            history.selected = row.id;
            render();
            ensureFeedback(row.id);
          },
        },
        h(
          'div',
          { class: 'history-card-head' },
          h('strong', {}, row.paperTitle || row.paperId),
          h(
            'span',
            { class: `badge ${row.status === 'graded' ? 'badge-ok' : 'badge-wait'}` },
            row.status === 'graded' ? '已批改' : '待批改',
          ),
        ),
        h('div', { class: 'history-card-meta' }, `${shortId(row)} · ${formatDate(row.createdAt)}`),
        h(
          'div',
          { class: 'history-card-bottom' },
          h('span', {}, scoreText(row) || '—'),
          h('span', {}, formatDuration(row.timeSpentSec)),
        ),
      );
      list.appendChild(card);
    }

    const detail = h('div', { class: 'history-detail' });
    const row = rows.find((item) => item.id === history.selected) || rows[0];
    if (!row) {
      detail.append(h('div', { class: 'center-empty' }, '选择左侧的一条提交。'));
    } else {
      if (history.selected !== row.id) history.selected = row.id;
      renderHistoryDetail(detail, row);
    }

    body.append(toolbar, h('div', { class: 'history-layout' }, list, detail));
  }

  function renderHistoryDetail(container, row) {
    const head = h(
      'div',
      { class: 'detail-head' },
      h('div', {}, h('h3', {}, row.paperTitle || row.paperId), h('p', { class: 'muted' }, `${shortId(row)} · ${formatDate(row.createdAt)} · ${formatDuration(row.timeSpentSec)}`)),
      h(
        'span',
        { class: `badge ${row.status === 'graded' ? 'badge-ok' : 'badge-wait'}` },
        row.status === 'graded' ? '已批改' : '待批改',
      ),
    );
    container.appendChild(head);

    const summary = h('div', { class: 'detail-summary' });
    if (scoreText(row)) summary.appendChild(h('span', { class: 'summary-pill' }, scoreText(row)));
    if (row.note) summary.appendChild(h('span', { class: 'summary-note' }, `备注：${row.note}`));
    if (!summary.childNodes.length) summary.appendChild(h('span', { class: 'muted' }, '没有额外备注。'));
    container.appendChild(summary);

    if (Array.isArray(row.pages) && row.pages.length) {
      const gallery = h('div', { class: 'thumb-grid' });
      for (const page of row.pages) {
        const src = `/submissions/${encodeURIComponent(row.id)}/${encodeURIComponent(page.file)}`;
        const img = h('img', {
          src,
          alt: `第 ${page.index} 页`,
          loading: 'lazy',
          title: `第 ${page.index} 页（点击放大）`,
        });
        img.addEventListener('click', () => openLightbox(src, `第 ${page.index} 页`));
        gallery.appendChild(h('div', { class: 'thumb' }, img, h('span', {}, `第 ${page.index} 页`)));
      }
      container.appendChild(gallery);
    }

    if (row.status !== 'graded') {
      container.appendChild(
        h(
          'div',
          { class: 'detail-wait' },
          `这份提交还没有批改。回到对话发送 “批改 ${shortId(row)}”，或让 AI 读取 submissions/${row.id}/。`,
        ),
      );
      return;
    }

    const reportBox = h('div', { class: 'report-box' });
    container.appendChild(reportBox);
    const cached = history.feedback.get(row.id);
    if (history.feedbackLoading.has(row.id)) {
      reportBox.appendChild(h('div', { class: 'center-empty' }, '正在读取批改报告…'));
      return;
    }
    if (!cached) {
      reportBox.appendChild(h('div', { class: 'center-empty' }, '批改报告尚未加载。'));
      ensureFeedback(row.id);
      return;
    }
    if (cached.error) {
      reportBox.append(
        h(
          'div',
          { class: 'center-empty error-text' },
          `报告读取失败：${cached.error}`,
          h('button', { class: 'btn', type: 'button', onclick: () => { history.feedback.delete(row.id); ensureFeedback(row.id); render(); } }, '重试'),
        ),
      );
      return;
    }

    const reportHead = h(
      'div',
      { class: 'report-head' },
      h('strong', {}, '批改报告'),
      h(
        'div',
        { class: 'report-actions' },
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: () => {
              copyText(cached.markdown || '')
                .then(() => toast('报告 Markdown 已复制。'))
                .catch((err) => toast(`复制失败：${err.message}`));
            },
          },
          '复制报告',
        ),
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: () => {
              history.feedback.delete(row.id);
              render();
              ensureFeedback(row.id);
            },
          },
          '刷新报告',
        ),
      ),
    );
    reportBox.append(reportHead, renderMarkdown(cached.markdown || '（报告为空）'));
    reportBox.appendChild(
      h('div', { class: 'report-path' }, `文件：feedback/${row.id}.md`),
    );
  }

  /* ---------------- 错词本 ---------------- */

  async function loadErrorWords(force = false) {
    if (errors.loading) return;
    if (errors.data && !force) return;
    errors.loading = true;
    errors.error = '';
    render();
    try {
      const data = await api.errorWords();
      errors.data = data;
      if (!errors.initialized) {
        for (const row of data.words || []) errors.selected.add(row.word);
        errors.initialized = true;
      }
    } catch (err) {
      errors.error = err.message;
    } finally {
      errors.loading = false;
      render();
    }
  }

  function errorPrompt(words) {
    const list = words.join(', ');
    return `请根据以下易错词，生成一套“词汇巩固文章”：
- 目标词：${list}
- 文章 250–350 词，CET-6 风格，每个词在语境中出现一次；标题自拟。
- 使用 vocabArticle + pageBreak + vocabTable 三个 block，paper.kind 设为 "vocab"。
- 把新卷追加到 data/papers.json，并在 data/keys.json 写 paperId 和 items（每个词的语境可接受义项、note）。
- 新卷 id 用 vocab-errors-02（如果已存在则顺延）。
- 生成后告诉我新卷标题和直接打开链接。`;
  }

  function renderErrors(body) {
    if (!errors.data && !errors.loading) loadErrorWords();
    const toolbar = h(
      'div',
      { class: 'center-toolbar' },
      h(
        'div',
        { class: 'filter-row' },
        h('span', { class: 'muted' }, errors.data ? `${errors.data.reportCount} 份报告 · ${errors.data.words.length} 个错词` : '正在汇总…'),
      ),
      h('button', { class: 'btn', type: 'button', onclick: () => loadErrorWords(true) }, '刷新'),
    );

    if (errors.loading && !errors.data) {
      body.append(toolbar, h('div', { class: 'center-empty' }, '正在汇总错词…'));
      return;
    }
    if (errors.error) {
      body.append(toolbar, h('div', { class: 'center-empty error-text' }, errors.error));
      return;
    }
    if (!errors.data || !errors.data.words.length) {
      body.append(
        toolbar,
        h('div', { class: 'center-empty' }, '还没有可汇总的错词。完成几份批改后再来看。'),
      );
      return;
    }

    const selectedWords = errors.data.words
      .filter((row) => errors.selected.has(row.word))
      .map((row) => row.word);
    const actions = h(
      'div',
      { class: 'error-actions' },
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: () => {
            errors.selected = new Set(errors.data.words.map((row) => row.word));
            render();
          },
        },
        '全选',
      ),
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: () => {
            errors.selected = new Set();
            render();
          },
        },
        '清空',
      ),
      h(
        'button',
        {
          class: 'btn primary',
          type: 'button',
          disabled: selectedWords.length === 0,
          onclick: () => {
            copyText(errorPrompt(selectedWords))
              .then(() => toast('生成请求已复制，去对话里粘贴发送即可。'))
              .catch((err) => toast(`复制失败：${err.message}`));
          },
        },
        `复制生成请求（${selectedWords.length} 词）`,
      ),
    );

    const table = h('table', { class: 'error-table' });
    const thead = h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', {}, ''),
        h('th', {}, '词'),
        h('th', {}, '次数'),
        h('th', {}, '判定'),
        h('th', {}, '来源'),
        h('th', {}, '说明'),
      ),
    );
    const tbody = h('tbody');
    for (const row of errors.data.words) {
      const check = h('input', { type: 'checkbox' });
      check.checked = errors.selected.has(row.word);
      check.addEventListener('change', () => {
        if (check.checked) errors.selected.add(row.word);
        else errors.selected.delete(row.word);
        render();
      });
      const verdicts = Object.entries(row.verdicts || {})
        .map(([key, count]) => `${key}×${count}`)
        .join(' / ');
      tbody.appendChild(
        h(
          'tr',
          {},
          h('td', {}, check),
          h('td', {}, h('strong', {}, row.word)),
          h('td', {}, String(row.count)),
          h('td', {}, verdicts),
          h('td', { class: 'small' }, (row.sources || []).map((id) => id.slice(-11)).join(', ')),
          h('td', { class: 'small' }, (row.comments || []).join('；')),
        ),
      );
    }
    table.append(thead, tbody);

    const vocabPapers = (state.papers || []).filter((paper) => paper.kind === 'vocab');
    const existing = h(
      'div',
      { class: 'vocab-papers' },
      h('h3', {}, '已有错词文章'),
      ...(vocabPapers.length
        ? vocabPapers.map((paper) =>
            h(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: () => {
                  loadPaper(paper.id).catch((err) => toast(`打开失败：${err.message}`));
                },
              },
              `打开：${paper.title}`,
            ),
          )
        : [h('span', { class: 'muted' }, '还没有错词文章；复制上面的请求让 AI 生成一篇。')]),
    );

    body.append(toolbar, actions, table);
    if (errors.data.grammarNotes && errors.data.grammarNotes.length) {
      const notes = h('div', { class: 'grammar-notes' }, h('h3', {}, '词性 / 语法笔记需要修正'));
      for (const note of errors.data.grammarNotes) {
        notes.appendChild(
          h(
            'div',
            { class: 'grammar-note' },
            h('strong', {}, `第 ${note.number} 题`),
            h('span', {}, ` ${note.written || ''} · ${note.verdict || ''}`),
            h('p', {}, note.comment || ''),
          ),
        );
      }
      body.appendChild(notes);
    }
    body.appendChild(existing);
  }

  /* ---------------- 试卷库 / 导入 ---------------- */

  async function loadLibrary(force = false) {
    if (library.loading) return;
    library.loading = true;
    library.error = '';
    render();
    try {
      await refreshPapers();
    } catch (err) {
      library.error = err.message;
    } finally {
      library.loading = false;
      render();
    }
  }

  function renderLibrary(body) {
    if (library.mode === 'import') {
      renderImport(body);
      return;
    }
    if (!state.papers || !state.papers.length) {
      loadLibrary();
    }
    const toolbar = h(
      'div',
      { class: 'center-toolbar' },
      h('span', { class: 'muted' }, `${(state.papers || []).length} 套卷`),
      h(
        'div',
        { class: 'filter-row' },
        h(
          'button',
          {
            class: 'btn primary',
            type: 'button',
            onclick: () => {
              library.mode = 'import';
              library.status = '';
              render();
            },
          },
          '导入新卷',
        ),
        h('button', { class: 'btn', type: 'button', onclick: () => loadLibrary(true) }, '刷新'),
      ),
    );

    if (library.error) {
      body.append(toolbar, h('div', { class: 'center-empty error-text' }, library.error));
      return;
    }

    const list = h('div', { class: 'paper-list' });
    for (const paper of state.papers || []) {
      const current = state.paper && state.paper.id === paper.id;
      list.appendChild(
        h(
          'div',
          { class: `paper-row${current ? ' current' : ''}` },
          h(
            'div',
            { class: 'paper-row-main' },
            h('div', {}, h('strong', {}, paper.title), current ? h('span', { class: 'badge badge-ok' }, '当前') : null),
            h('p', { class: 'muted' }, paper.subtitle || ''),
            h(
              'p',
              { class: 'paper-meta' },
              `${paper.kind === 'vocab' ? '词汇巩固' : '考试卷'} · ${paper.itemCount} 题 · ${paper.durationMinutes || 0} 分钟`,
            ),
          ),
          h(
            'div',
            { class: 'paper-row-actions' },
            h(
              'button',
              {
                class: 'btn primary',
                type: 'button',
                onclick: () => {
                  loadPaper(paper.id).catch((err) => toast(`打开失败：${err.message}`));
                },
              },
              current ? '继续' : '打开',
            ),
          ),
        ),
      );
    }
    body.append(
      toolbar,
      list,
      h(
        'p',
        { class: 'muted library-hint' },
        '题库文件：data/papers.json；答案键：data/keys.json。导入会写回这两个文件；刷新页面即可看到新卷。',
      ),
    );
  }

  function renderImport(body) {
    const textarea = h('textarea', {
      class: 'import-text',
      placeholder: '把 JSON 粘贴到这里，或选择 .json 文件。格式：{ "paper": {...}, "keys": {...} }',
      rows: '14',
      spellcheck: 'false',
    });
    textarea.value = library.text || '';
    textarea.addEventListener('input', () => {
      library.text = textarea.value;
    });

    const file = h('input', { type: 'file', accept: '.json,application/json', class: 'import-file' });
    file.addEventListener('change', () => {
      const selected = file.files && file.files[0];
      if (!selected) return;
      selected
        .text()
        .then((text) => {
          library.text = text;
          textarea.value = text;
          toast(`已读入 ${selected.name}`);
        })
        .catch((err) => toast(`读取文件失败：${err.message}`));
    });

    const overwrite = h('input', { type: 'checkbox' });
    overwrite.checked = Boolean(library.overwrite);
    overwrite.addEventListener('change', () => {
      library.overwrite = overwrite.checked;
    });

    const status = h('div', { class: 'import-status' });
    if (library.status) status.textContent = library.status;

    const sampleBtn = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: () => {
          library.text = JSON.stringify(SAMPLE_PAYLOAD, null, 2);
          textarea.value = library.text;
          library.status = '';
          status.textContent = '';
        },
      },
      '填入示例',
    );

    const importBtn = h(
      'button',
      { class: 'btn primary', type: 'button', disabled: library.importing },
      library.importing ? '导入中…' : '验证并导入',
    );
    importBtn.addEventListener('click', async () => {
      if (library.importing) return;
      let payload;
      try {
        payload = JSON.parse(textarea.value || '');
      } catch (err) {
        library.status = `JSON 解析失败：${err.message}`;
        status.textContent = library.status;
        return;
      }
      if (!payload || !payload.paper || typeof payload.paper !== 'object') {
        library.status = '缺少 paper 对象。';
        status.textContent = library.status;
        return;
      }
      library.importing = true;
      importBtn.disabled = true;
      importBtn.textContent = '导入中…';
      library.status = '正在验证并写入…';
      status.textContent = library.status;
      try {
        const result = await api.importPaper({
          paper: payload.paper,
          keys: payload.keys,
          overwrite: Boolean(library.overwrite),
        });
        toast(`已导入：${result.paper.title}${result.keysImported ? '' : '（未导入答案键）'}`);
        library.importing = false;
        library.mode = 'list';
        library.text = '';
        library.status = '';
        await refreshPapers();
        await loadPaper(result.paper.id);
      } catch (err) {
        library.importing = false;
        importBtn.disabled = false;
        importBtn.textContent = '验证并导入';
        library.status = `导入失败：${err.message}`;
        status.textContent = library.status;
      }
    });

    const back = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: () => {
          library.mode = 'list';
          library.status = '';
          render();
        },
      },
      '返回试卷列表',
    );

    body.append(
      h('div', { class: 'import-head' }, h('h3', {}, '导入新卷'), h('p', { class: 'muted' }, '支持单个 paper 对象 + 可选 keys；导入后会写回 data/papers.json 和 data/keys.json。')),
      h(
        'div',
        { class: 'import-tools' },
        file,
        sampleBtn,
        h('label', { class: 'check-label' }, overwrite, ' 覆盖同 id 的已有试卷'),
      ),
      textarea,
      status,
      h('div', { class: 'modal-actions' }, back, importBtn),
    );
  }

  return { open, close, setTab };
}
