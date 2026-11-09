#!/usr/bin/env node
/* 静态检查：试卷/答案键结构、题号唯一性、词汇文章目标词、keys 覆盖。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const papersPath = path.join(root, 'data', 'papers.json');
const keysPath = path.join(root, 'data', 'keys.json');
const ALLOWED = new Set([
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

const errors = [];
const warnings = [];
const fail = (message) => errors.push(message);
const warn = (message) => warnings.push(message);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`${path.relative(root, file)}: ${err.message}`);
    return null;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function checkPaper(paper, keysData) {
  const label = paper && paper.id ? paper.id : '(no id)';
  if (!paper || typeof paper !== 'object') {
    fail('paper 不是对象');
    return;
  }
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(String(paper.id || ''))) {
    fail(`${label}: id 只能用小写字母、数字、连字符`);
  }
  if (typeof paper.title !== 'string' || !paper.title.trim()) {
    fail(`${label}: 缺少 title`);
  }
  if (!Array.isArray(paper.sections) || !paper.sections.length) {
    fail(`${label}: sections 必须是非空数组`);
    return;
  }

  const numbers = new Set();
  const addNumber = (value, where) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      fail(`${label} ${where}: 题号无效 ${value}`);
      return;
    }
    if (numbers.has(n)) fail(`${label} ${where}: 题号重复 ${n}`);
    numbers.add(n);
  };

  let hasVocabArticle = false;
  let hasVocabTable = false;
  const vocabTargets = [];
  const vocabTableWords = [];

  for (const [si, section] of paper.sections.entries()) {
    if (!section || typeof section !== 'object') {
      fail(`${label} section[${si}]: 不是对象`);
      continue;
    }
    if (!Array.isArray(section.blocks) || !section.blocks.length) {
      fail(`${label} section[${si}]: blocks 必须是非空数组`);
      continue;
    }
    for (const [bi, block] of section.blocks.entries()) {
      const where = `section[${si}].blocks[${bi}]`;
      if (!block || typeof block !== 'object' || !ALLOWED.has(block.type)) {
        fail(`${label} ${where}: 不支持的 type ${block && block.type}`);
        continue;
      }
      if (block.type === 'mcq' || block.type === 'matchingStatements') {
        if (!Array.isArray(block.items) || !block.items.length) {
          fail(`${label} ${where}: items 为空`);
          continue;
        }
        for (const item of block.items) {
          addNumber(item.number, where);
          if (block.type === 'mcq' && (!Array.isArray(item.options) || item.options.length < 2)) {
            fail(`${label} ${where}: mcq 题 ${item.number} 的 options 不足`);
          }
        }
      } else if (block.type === 'clozePassage') {
        if (typeof block.text !== 'string' || !block.text.trim()) {
          fail(`${label} ${where}: text 为空`);
        } else {
          for (const match of block.text.matchAll(/\[\[(\d+)\]\]/g)) addNumber(match[1], where);
        }
      } else if (block.type === 'vocabArticle') {
        hasVocabArticle = true;
        if (typeof block.text !== 'string' || !block.text.trim()) {
          fail(`${label} ${where}: text 为空`);
        }
        if (!Array.isArray(block.targets) || !block.targets.length) {
          fail(`${label} ${where}: targets 为空`);
        } else {
          for (const target of block.targets) {
            if (typeof target.word !== 'string' || !target.word.trim()) {
              fail(`${label} ${where}: target.word 为空`);
              continue;
            }
            vocabTargets.push(target.word.trim().toLowerCase());
            if (block.text) {
              const re = new RegExp(`\\b${escapeRegExp(target.word.trim())}\\b`, 'i');
              if (!re.test(block.text)) {
                fail(`${label} ${where}: 文章中没有找到目标词 ${target.word}`);
              }
            }
          }
        }
      } else if (block.type === 'vocabTable') {
        hasVocabTable = true;
        if (!Array.isArray(block.items) || !block.items.length) {
          fail(`${label} ${where}: items 为空`);
        } else {
          for (const item of block.items) {
            addNumber(item.number, where);
            if (typeof item.word !== 'string' || !item.word.trim()) {
              fail(`${label} ${where}: vocabTable 题 ${item.number} 缺少 word`);
            } else {
              vocabTableWords.push(item.word.trim().toLowerCase());
            }
          }
        }
      } else if (block.type === 'answerLines') {
        const count = Number(block.count);
        if (!Number.isFinite(count) || count < 1 || count > 60) {
          fail(`${label} ${where}: answerLines.count 必须是 1-60`);
        }
      } else if (block.type === 'wordBank') {
        if (!Array.isArray(block.items) || !block.items.length) {
          fail(`${label} ${where}: wordBank.items 为空`);
        }
      } else if (block.type !== 'pageBreak') {
        if (typeof block.text !== 'string' || !block.text.trim()) {
          fail(`${label} ${where}: text 为空`);
        }
      }
    }
  }

  if (paper.kind === 'vocab') {
    if (!hasVocabArticle) fail(`${label}: kind=vocab 但缺少 vocabArticle`);
    if (!hasVocabTable) fail(`${label}: kind=vocab 但缺少 vocabTable`);
    const missingWords = vocabTargets.filter((word) => !vocabTableWords.includes(word));
    if (missingWords.length) {
      warn(`${label}: vocabTable 缺少文章目标词: ${missingWords.join(', ')}`);
    }
    const extraWords = vocabTableWords.filter((word) => !vocabTargets.includes(word));
    if (extraWords.length) {
      warn(`${label}: vocabTable 有文章 target 之外词: ${extraWords.join(', ')}`);
    }
  }

  const key = keysData && keysData[paper.id];
  if (!key) {
    warn(`${label}: keys.json 中没有同名 key（批改/错词本会缺少答案）`);
    return;
  }
  if (key.paperId && key.paperId !== paper.id) {
    fail(`${label}: keys.paperId=${key.paperId} 与 paper.id 不一致`);
  }
  if (paper.kind === 'vocab') {
    if (!Array.isArray(key.items) || !key.items.length) {
      fail(`${label}: vocab keys 缺少 items`);
    } else if (key.items.length !== numbers.size) {
      warn(`${label}: vocab keys items=${key.items.length} 与表格题数=${numbers.size} 不一致`);
    }
  } else if (key.objective && typeof key.objective === 'object') {
    const keyNumbers = new Set(Object.keys(key.objective).map(Number));
    for (const number of numbers) {
      if (!keyNumbers.has(number)) warn(`${label}: 题号 ${number} 没有 objective 答案`);
    }
  }
}

const papersData = readJson(papersPath);
const keysData = readJson(keysPath) || {};
if (papersData) {
  if (!Array.isArray(papersData.papers) || !papersData.papers.length) {
    fail('papers.json: papers 必须是非空数组');
  } else {
    const seen = new Set();
    for (const paper of papersData.papers) {
      if (paper && seen.has(paper.id)) fail(`papers.json: 重复试卷 id ${paper.id}`);
      if (paper) seen.add(paper.id);
      checkPaper(paper, keysData);
    }
  }
}

for (const message of warnings) console.warn(`WARN  ${message}`);
for (const message of errors) console.error(`ERROR ${message}`);
if (errors.length) {
  console.error(`\n检查失败：${errors.length} 个错误，${warnings.length} 个警告。`);
  process.exit(1);
}
console.log(`检查通过：${(papersData && papersData.papers.length) || 0} 套卷，${warnings.length} 个警告。`);
