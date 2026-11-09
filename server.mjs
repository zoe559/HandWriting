import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const APP_ID = 'cet6-practice';
const APP_VERSION = '1.0.0';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const SUBS_DIR = path.join(__dirname, 'submissions');
const FEEDBACK_DIR = path.join(__dirname, 'feedback');
const PORT_START = Number(process.env.PRACTICE_PORT || 43110);
const PORT_TRIES = 10;
const MAX_BODY = 96 * 1024 * 1024;
const MAX_PAGES = 30;
const MAX_PIXELS = 16_000_000;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function fail(res, status, message, extra = {}) {
  json(res, status, { ok: false, error: message, ...extra });
}

async function readJson(file) {
  const text = await fsp.readFile(file, 'utf8');
  return JSON.parse(text);
}

async function writeJson(file, obj) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function makeId() {
  const d = new Date();
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${date}-${time}-${crypto.randomBytes(2).toString('hex')}`;
}

function pngInfo(buf) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('页面图片不是合法 PNG');
  }
  if (buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('PNG 缺少 IHDR 头');
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!width || !height || width > 5000 || height > 8000) {
    throw new Error(`页面尺寸超出限制: ${width}x${height}`);
  }
  if (width * height > MAX_PIXELS) {
    throw new Error(`页面像素超出限制: ${width}x${height}`);
  }
  return { width, height };
}

function decodePage(page) {
  let data = page && (page.png || page.dataUrl || page.base64);
  if (typeof data !== 'string' || !data) {
    throw new Error('页面缺少 PNG 数据');
  }
  data = data.replace(/^data:image\/png;base64,/i, '').replace(/\s+/g, '');
  const buf = Buffer.from(data, 'base64');
  if (!buf.length) throw new Error('页面 PNG 为空');
  pngInfo(buf);
  return buf;
}

function countItems(paper) {
  let n = 0;
  for (const section of paper.sections || []) {
    for (const block of section.blocks || []) {
      if (block.type === 'mcq' || block.type === 'matchingStatements' || block.type === 'vocabTable') {
        n += Array.isArray(block.items) ? block.items.length : 0;
      } else if (block.type === 'clozePassage') {
        n += (String(block.text || '').match(/\[\[\d+\]\]/g) || []).length;
      }
    }
  }
  return n;
}

function summarize(paper) {
  return {
    id: paper.id,
    title: paper.title,
    subtitle: paper.subtitle || '',
    kind: paper.kind || 'exam',
    durationMinutes: paper.durationMinutes || 0,
    sectionCount: (paper.sections || []).length,
    itemCount: countItems(paper),
  };
}

async function loadPapers() {
  const data = await readJson(path.join(DATA_DIR, 'papers.json'));
  return Array.isArray(data.papers) ? data.papers : [];
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体超过 96MB 限制'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function serveFile(res, abs, contentType) {
  try {
    const stat = await fsp.stat(abs);
    if (!stat.isFile()) return fail(res, 404, 'not found');
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': stat.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    fs.createReadStream(abs).pipe(res);
    return true;
  } catch {
    return fail(res, 404, 'not found');
  }
}

async function serveStatic(res, pathname) {
  let rel = pathname;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return fail(res, 400, 'bad path');
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel.includes('\0')) return fail(res, 400, 'bad path');
  const safe = path.normalize(rel).replace(/^([/\\])+/, '');
  const abs = path.resolve(PUBLIC_DIR, safe);
  if (abs !== PUBLIC_DIR && !abs.startsWith(PUBLIC_DIR + path.sep)) {
    return fail(res, 404, 'not found');
  }
  const ext = path.extname(abs).toLowerCase();
  if (!Object.hasOwn(MIME, ext)) return fail(res, 404, 'not found');
  return serveFile(res, abs, MIME[ext]);
}

async function listSubmissions(url) {
  const paperId = url.searchParams.get('paperId') || '';
  const status = url.searchParams.get('status') || '';
  let dirs = [];
  try {
    dirs = await fsp.readdir(SUBS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows = [];
  for (const dir of dirs) {
    if (!dir.isDirectory() || dir.name.startsWith('.')) continue;
    try {
      const meta = await readJson(path.join(SUBS_DIR, dir.name, 'meta.json'));
      if (paperId && meta.paperId !== paperId) continue;
      if (status && meta.status !== status) continue;
      rows.push(meta);
    } catch {
      /* ignore incomplete submissions */
    }
  }
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return rows.slice(0, 50);
}

const ALLOWED_BLOCKS = new Set([
  'prompt',
  'paragraph',
  'passage',
  'wordBank',
  'clozePassage',
  'matchingStatements',
  'mcq',
  'answerLines',
  'vocabArticle',
  'vocabTable',
  'pageBreak',
]);

function importError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function validateImportedPaper(paper) {
  if (!paper || typeof paper !== 'object' || Array.isArray(paper)) {
    throw importError('paper 必须是一个对象');
  }
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(String(paper.id || ''))) {
    throw importError('paper.id 只能用小写字母、数字、连字符，长度 2–61');
  }
  if (typeof paper.title !== 'string' || !paper.title.trim()) {
    throw importError('paper.title 不能为空');
  }
  if (!Array.isArray(paper.sections) || !paper.sections.length) {
    throw importError('paper.sections 必须是非空数组');
  }

  const numbers = new Set();
  const addNumber = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw importError(`题号无效: ${value}`);
    if (numbers.has(n)) throw importError(`题号重复: ${n}`);
    numbers.add(n);
  };

  for (const [si, section] of paper.sections.entries()) {
    if (!section || typeof section !== 'object') throw importError(`section[${si}] 必须是对象`);
    if (!Array.isArray(section.blocks) || !section.blocks.length) {
      throw importError(`section[${si}].blocks 必须是非空数组`);
    }
    for (const [bi, block] of section.blocks.entries()) {
      if (!block || typeof block !== 'object' || !ALLOWED_BLOCKS.has(block.type)) {
        throw importError(`section[${si}].blocks[${bi}] 的 type 不支持: ${block && block.type}`);
      }
      switch (block.type) {
        case 'mcq':
        case 'matchingStatements':
          if (!Array.isArray(block.items) || !block.items.length) {
            throw importError(`${block.type}.items 必须是非空数组`);
          }
          for (const item of block.items) {
            addNumber(item.number);
            if (block.type === 'mcq' && !Array.isArray(item.options)) {
              throw importError(`mcq 题 ${item.number} 缺少 options`);
            }
          }
          break;
        case 'clozePassage':
          if (typeof block.text !== 'string' || !block.text.trim()) {
            throw importError('clozePassage.text 不能为空');
          }
          for (const match of block.text.matchAll(/\[\[(\d+)\]\]/g)) addNumber(match[1]);
          break;
        case 'vocabTable':
          if (!Array.isArray(block.items) || !block.items.length) {
            throw importError('vocabTable.items 必须是非空数组');
          }
          for (const item of block.items) {
            addNumber(item.number);
            if (typeof item.word !== 'string' || !item.word.trim()) {
              throw importError(`vocabTable 题 ${item.number} 缺少 word`);
            }
          }
          break;
        case 'vocabArticle':
          if (typeof block.text !== 'string' || !block.text.trim()) {
            throw importError('vocabArticle.text 不能为空');
          }
          if (!Array.isArray(block.targets) || !block.targets.length) {
            throw importError('vocabArticle.targets 必须是非空数组');
          }
          for (const target of block.targets) {
            if (typeof target.word !== 'string' || !target.word.trim()) {
              throw importError('vocabArticle.targets[].word 不能为空');
            }
          }
          break;
        case 'answerLines': {
          const count = Number(block.count);
          if (!Number.isFinite(count) || count < 1 || count > 60) {
            throw importError('answerLines.count 必须是 1–60');
          }
          break;
        }
        case 'wordBank':
          if (!Array.isArray(block.items) || !block.items.length) {
            throw importError('wordBank.items 必须是非空数组');
          }
          break;
        case 'paragraph':
        case 'passage':
        case 'prompt':
          if (typeof block.text !== 'string' || !block.text.trim()) {
            throw importError(`${block.type}.text 不能为空`);
          }
          break;
        case 'pageBreak':
          break;
        default:
          throw importError(`不支持的 block 类型: ${block.type}`);
      }
    }
  }

  if (paper.kind === 'vocab') {
    const hasTable = paper.sections.some((section) =>
      (section.blocks || []).some((block) => block.type === 'vocabTable'),
    );
    if (!hasTable) throw importError('kind 为 vocab 的试卷需要至少一个 vocabTable');
  }
  return true;
}

function stripVocabPrefix(word) {
  return String(word || '').replace(/^[A-O]\)\s*/i, '').trim().toLowerCase();
}

async function collectErrorWords() {
  const papers = await loadPapers();
  const clozeIndex = new Map();
  for (const paper of papers) {
    const letters = new Map();
    const numbers = new Set();
    for (const section of paper.sections || []) {
      for (const block of section.blocks || []) {
        if (block.type === 'wordBank') {
          for (const item of block.items || []) {
            const match = String(item).match(/^([A-O])\)\s*(.+)$/i);
            if (match) letters.set(match[1].toUpperCase(), match[2].trim());
          }
        } else if (block.type === 'clozePassage') {
          for (const match of String(block.text || '').matchAll(/\[\[(\d+)\]\]/g)) {
            numbers.add(Number(match[1]));
          }
        }
      }
    }
    if (letters.size && numbers.size) clozeIndex.set(paper.id, { letters, numbers });
  }

  let files = [];
  try {
    files = (await fsp.readdir(FEEDBACK_DIR)).filter((file) => file.endsWith('.json'));
  } catch {
    files = [];
  }

  const wordMap = new Map();
  const grammarNotes = [];
  const addWord = (word, opts = {}) => {
    const clean = stripVocabPrefix(word);
    if (!clean) return;
    let row = wordMap.get(clean);
    if (!row) {
      row = { word: clean, count: 0, verdicts: {}, sources: [], comments: [], writings: [] };
      wordMap.set(clean, row);
    }
    row.count += 1;
    const verdict = opts.verdict || '错误';
    row.verdicts[verdict] = (row.verdicts[verdict] || 0) + 1;
    if (opts.submissionId && !row.sources.includes(opts.submissionId)) row.sources.push(opts.submissionId);
    if (opts.comment && !row.comments.includes(opts.comment)) row.comments.push(opts.comment);
    if (opts.written && !row.writings.includes(opts.written)) row.writings.push(opts.written);
  };

  for (const file of files) {
    let data;
    try {
      data = JSON.parse(await fsp.readFile(path.join(FEEDBACK_DIR, file), 'utf8'));
    } catch {
      continue;
    }
    const submissionId = data.submissionId || file.replace(/\.json$/, '');
    for (const annotation of data.wordAnnotations || []) {
      if (!annotation || annotation.verdict === '正确' || annotation.verdict === '未注') continue;
      addWord(annotation.word, {
        verdict: annotation.verdict,
        written: annotation.written,
        comment: annotation.comment,
        submissionId,
      });
    }
    for (const item of data.items || []) {
      if (!item) continue;
      if (item.word && item.verdict && item.verdict !== '正确') {
        addWord(item.word, {
          verdict: item.verdict,
          written: item.student,
          comment: item.comment,
          submissionId,
        });
      }
      if (item.ok === false && item.correct) {
        const index = clozeIndex.get(data.paperId);
        if (index && index.numbers.has(Number(item.number))) {
          const word = index.letters.get(String(item.correct).toUpperCase());
          if (word) {
            addWord(word, {
              verdict: '错误',
              written: item.student,
              comment: item.comment,
              submissionId,
            });
          }
        }
      }
    }
    for (const note of data.grammarNotes || []) {
      if (!note || note.verdict === '正确') continue;
      grammarNotes.push({
        submissionId,
        number: note.number,
        written: note.written,
        verdict: note.verdict,
        comment: note.comment,
      });
    }
  }

  const words = [...wordMap.values()].sort(
    (a, b) => b.count - a.count || a.word.localeCompare(b.word),
  );
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    reportCount: files.length,
    words,
    grammarNotes,
    suggestedWords: words.map((row) => row.word),
  };
}

async function handleImport(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return fail(res, err.status || 400, err.message);
  }
  if (body.length > 5 * 1024 * 1024) {
    return fail(res, 413, '导入内容超过 5MB 限制');
  }

  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return fail(res, 400, '导入内容不是合法 JSON');
  }

  const paper = payload && payload.paper;
  const keys = payload && payload.keys;
  try {
    validateImportedPaper(paper);
    if (keys != null) {
      if (typeof keys !== 'object' || Array.isArray(keys)) throw importError('keys 必须是对象');
      if (keys.paperId && keys.paperId !== paper.id) {
        throw importError(`keys.paperId (${keys.paperId}) 与 paper.id (${paper.id}) 不一致`);
      }
    }
  } catch (err) {
    return fail(res, err.status || 400, err.message);
  }

  const papersPath = path.join(DATA_DIR, 'papers.json');
  const keysPath = path.join(DATA_DIR, 'keys.json');
  let paperData;
  let keysData;
  try {
    paperData = await readJson(papersPath);
    keysData = await readJson(keysPath);
  } catch (err) {
    return fail(res, 500, `读取题库失败: ${err.message}`);
  }

  const papers = Array.isArray(paperData.papers) ? paperData.papers : [];
  const index = papers.findIndex((item) => item.id === paper.id);
  if (index >= 0 && !payload.overwrite) {
    return fail(res, 409, `试卷 ${paper.id} 已存在；如需替换请勾选“覆盖同 id”或换一个 id`);
  }
  if (index >= 0) papers[index] = paper;
  else papers.push(paper);
  paperData.papers = papers;

  try {
    await writeJson(papersPath, paperData);
    if (keys != null) {
      keysData[paper.id] = { ...keys, paperId: paper.id };
      await writeJson(keysPath, keysData);
    }
  } catch (err) {
    return fail(res, 500, `写入题库失败: ${err.message}`);
  }

  return json(res, 200, {
    ok: true,
    paper: summarize(paper),
    keysImported: keys != null,
    overwritten: index >= 0,
  });
}

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;

  if (pathname === '/health') {
    return json(res, 200, { ok: true, app: APP_ID, version: APP_VERSION, port: server.address()?.port });
  }

  if (pathname === '/api/papers/import' && req.method === 'POST') {
    return handleImport(req, res);
  }

  if (pathname === '/api/error-words' && req.method === 'GET') {
    try {
      return json(res, 200, await collectErrorWords());
    } catch (err) {
      console.error('[error-words] failed:', err);
      return fail(res, 500, `汇总错词失败: ${err.message}`);
    }
  }

  if (pathname === '/api/papers' && req.method === 'GET') {
    const papers = await loadPapers();
    return json(res, 200, { ok: true, papers: papers.map(summarize) });
  }

  const paperMatch = pathname.match(/^\/api\/papers\/([a-zA-Z0-9-]+)$/);
  if (paperMatch && req.method === 'GET') {
    const papers = await loadPapers();
    const paper = papers.find((p) => p.id === paperMatch[1]);
    if (!paper) return fail(res, 404, '试卷不存在');
    return json(res, 200, { ok: true, paper });
  }

  if (pathname === '/api/submissions' && req.method === 'POST') {
    return handleSubmit(req, res);
  }

  if (pathname === '/api/submissions' && req.method === 'GET') {
    try {
      const rows = await listSubmissions(url);
      return json(res, 200, { ok: true, submissions: rows });
    } catch (err) {
      return fail(res, 500, `读取提交失败: ${err.message}`);
    }
  }

  const subMatch = pathname.match(/^\/api\/submissions\/([a-z0-9-]+)$/);
  if (subMatch && req.method === 'GET') {
    try {
      const meta = await readJson(path.join(SUBS_DIR, subMatch[1], 'meta.json'));
      return json(res, 200, { ok: true, submission: meta });
    } catch {
      return fail(res, 404, '提交不存在');
    }
  }

  const fbMatch = pathname.match(/^\/api\/feedback\/([a-z0-9-]+)$/);
  if (fbMatch && req.method === 'GET') {
    const id = fbMatch[1];
    const result = { ok: true, id };
    let found = false;
    try {
      result.json = await readJson(path.join(FEEDBACK_DIR, `${id}.json`));
      found = true;
    } catch {
      /* no json */
    }
    try {
      result.markdown = await fsp.readFile(path.join(FEEDBACK_DIR, `${id}.md`), 'utf8');
      found = true;
    } catch {
      /* no md */
    }
    if (!found) return fail(res, 404, '批改报告尚未生成');
    return json(res, 200, result);
  }

  const pageMatch = pathname.match(/^\/submissions\/([a-z0-9-]+)\/page-(\d{2})\.png$/);
  if (pageMatch && req.method === 'GET') {
    const abs = path.join(SUBS_DIR, pageMatch[1], `page-${pageMatch[2]}.png`);
    return serveFile(res, abs, 'image/png');
  }

  return fail(res, 404, '接口不存在');
}

async function handleSubmit(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return fail(res, err.status || 400, err.message);
  }

  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return fail(res, 400, '请求不是合法 JSON');
  }

  const papers = await loadPapers();
  const paper = papers.find((p) => p.id === payload.paperId);
  if (!paper) return fail(res, 400, '试卷不存在');

  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  if (!pages.length) return fail(res, 400, '没有可提交的页面');
  if (pages.length > MAX_PAGES) return fail(res, 413, `页面数超过 ${MAX_PAGES} 页限制`);

  const id = makeId();
  const shortId = id.slice(9);
  const tempDir = path.join(SUBS_DIR, `.tmp-${id}`);
  const finalDir = path.join(SUBS_DIR, id);

  try {
    await fsp.mkdir(tempDir, { recursive: true });
    const pageMeta = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i] || {};
      const buf = decodePage(page);
      const info = pngInfo(buf);
      const index = Number(page.index) || i + 1;
      const fileName = `page-${String(index).padStart(2, '0')}.png`;
      await fsp.writeFile(path.join(tempDir, fileName), buf);
      pageMeta.push({ index, file: fileName, width: info.width, height: info.height });
    }

    const meta = {
      id,
      shortId,
      paperId: paper.id,
      paperTitle: paper.title,
      createdAt: new Date().toISOString(),
      timeSpentSec: Math.max(0, Number(payload.timeSpentSec) || 0),
      status: 'submitted',
      pageCount: pageMeta.length,
      pages: pageMeta,
      note: typeof payload.note === 'string' ? payload.note.slice(0, 4000) : '',
      clientVersion: String(payload.clientVersion || '').slice(0, 40),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    };

    await writeJson(path.join(tempDir, 'meta.json'), meta);
    await writeJson(path.join(tempDir, 'layout.json'), payload.layout || {});
    await writeJson(path.join(tempDir, 'strokes.json'), payload.strokes || []);
    await writeJson(path.join(tempDir, 'submission.json'), {
      paperId: paper.id,
      pageCount: pageMeta.length,
      layout: payload.layout || null,
      strokes: payload.strokes || [],
      note: meta.note,
    });

    try {
      await fsp.rename(tempDir, finalDir);
    } catch {
      await fsp.cp(tempDir, finalDir, { recursive: true });
      await fsp.rm(tempDir, { recursive: true, force: true });
    }

    console.log(`[submission] ${id} (${paper.id}) pages=${pageMeta.length} -> ${finalDir}`);
    return json(res, 200, {
      ok: true,
      id,
      shortId,
      paperId: paper.id,
      paperTitle: paper.title,
      pages: pageMeta.length,
      dir: path.relative(__dirname, finalDir).replace(/\\/g, '/'),
      instruction: `批改 ${shortId}`,
    });
  } catch (err) {
    try {
      await fsp.rm(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    console.error('[submission] failed:', err);
    return fail(res, 500, `保存提交失败: ${err.message}`);
  }
}

async function handler(req, res) {
  const url = new URL(req.url || '/', `http://127.0.0.1`);
  try {
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
      return await handleApi(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return fail(res, 405, 'method not allowed');
    }
    if (url.pathname.startsWith('/submissions/')) {
      const m = url.pathname.match(/^\/submissions\/([a-z0-9-]+)\/page-(\d{2})\.png$/);
      if (!m) return fail(res, 404, 'not found');
      return serveFile(res, path.join(SUBS_DIR, m[1], `page-${m[2]}.png`), 'image/png');
    }
    return await serveStatic(res, url.pathname);
  } catch (err) {
    console.error('[server] error:', err);
    if (!res.headersSent) fail(res, 500, '服务器内部错误');
  }
}

function openBrowser(url) {
  const platform = process.platform;
  const [command, args] =
    platform === 'win32'
      ? ['cmd.exe', ['/c', 'start', '', url]]
      : platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: platform === 'win32',
    });
    child.on('error', () => {
      console.error(`Could not open a browser automatically. Open ${url} manually.`);
    });
    child.unref();
  } catch {
    console.error(`Could not open a browser automatically. Open ${url} manually.`);
  }
}

function checkHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/health', timeout: 700 },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const obj = JSON.parse(data);
            resolve(obj && obj.app === APP_ID);
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

let server = null;
const wantOpen = process.argv.includes('--open');

async function main() {
  await fsp.mkdir(SUBS_DIR, { recursive: true });
  await fsp.mkdir(FEEDBACK_DIR, { recursive: true });

  // 如果端口范围内已有本服务，直接打开它，避免重复启动。
  for (let i = 0; i < PORT_TRIES; i++) {
    const port = PORT_START + i;
    if (await checkHealth(port)) {
      const url = `http://127.0.0.1:${port}`;
      console.log(`练习台已经在运行: ${url}`);
      await fsp.writeFile(path.join(__dirname, '.port'), `${url}\n`, 'utf8');
      if (wantOpen) openBrowser(url);
      process.exit(0);
    }
  }

  for (let i = 0; i < PORT_TRIES; i++) {
    const port = PORT_START + i;
    const s = http.createServer(handler);
    try {
      await new Promise((resolve, reject) => {
        s.once('error', reject);
        s.listen(port, '127.0.0.1', resolve);
      });
      server = s;
      break;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      if (await checkHealth(port)) {
        const url = `http://127.0.0.1:${port}`;
        console.log(`练习台已经在运行: ${url}`);
        await fsp.writeFile(path.join(__dirname, '.port'), `${url}\n`, 'utf8');
        if (wantOpen) openBrowser(url);
        process.exit(0);
      }
    }
  }

  if (!server) {
    console.error(`端口 ${PORT_START}-${PORT_START + PORT_TRIES - 1} 都被占用，未能启动。`);
    process.exit(1);
  }

  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;
  await fsp.writeFile(path.join(__dirname, '.port'), `${url}\n`, 'utf8');
  console.log('');
  console.log('  CET-6 手写练习台已启动');
  console.log(`  地址: ${url}`);
  console.log(`  提交目录: ${SUBS_DIR}`);
  console.log('  按 Ctrl+C 停止服务');
  console.log('');
  if (wantOpen) openBrowser(url);

  process.on('SIGINT', () => {
    console.log('\n正在停止服务…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
