#!/usr/bin/env node
/* 从已有的批改报告里汇总易错词，供生成“错词文章”使用。
 *
 * 用法：
 *   node tools/error-words.mjs
 *   node tools/error-words.mjs --json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const feedbackDir = path.join(root, 'feedback');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  if (!fs.existsSync(feedbackDir)) {
    console.error('没有 feedback 目录');
    process.exit(1);
  }

  const files = fs
    .readdirSync(feedbackDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const wordRows = [];
  const grammarRows = [];
  const itemRows = [];

  for (const file of files) {
    const data = readJson(path.join(feedbackDir, file));
    if (!data) continue;
    const submissionId = data.submissionId || file.replace(/\.json$/, '');
    for (const w of data.wordAnnotations || []) {
      if (!w || w.verdict === '正确' || w.verdict === '未注') continue;
      wordRows.push({
        submissionId,
        word: w.word,
        written: w.written,
        verdict: w.verdict,
        comment: w.comment,
      });
    }
    for (const g of data.grammarNotes || []) {
      if (!g || g.verdict === '正确') continue;
      grammarRows.push({
        submissionId,
        number: g.number,
        written: g.written,
        verdict: g.verdict,
        comment: g.comment,
      });
    }
    for (const it of data.items || []) {
      if (!it || it.ok !== false) continue;
      itemRows.push({
        submissionId,
        number: it.number,
        student: it.student,
        correct: it.correct,
        comment: it.comment,
      });
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    feedbackFiles: files,
    errorWordAnnotations: wordRows,
    errorGrammarNotes: grammarRows,
    wrongItems: itemRows,
    suggestedWords: [
      ...new Set(
        wordRows
          .map((r) => String(r.word || '').replace(/^[A-O]\)\s*/, '').trim())
          .filter(Boolean),
      ),
    ],
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`# 易错词汇总（${files.length} 份报告）\n`);
  if (wordRows.length) {
    console.log('## 词义注解错误 / 部分正确\n');
    console.log('| 提交 | 词 | 你写的 | 判定 | 说明 |');
    console.log('|---|---|---|---|---|');
    for (const r of wordRows) {
      console.log(`| ${r.submissionId} | ${r.word} | ${r.written} | ${r.verdict} | ${r.comment || ''} |`);
    }
    console.log('');
  }
  if (grammarRows.length) {
    console.log('## 语法 / 词性笔记需要修正\n');
    console.log('| 提交 | 题号 | 你写的 | 判定 | 说明 |');
    console.log('|---|---|---|---|---|');
    for (const r of grammarRows) {
      console.log(`| ${r.submissionId} | ${r.number} | ${r.written} | ${r.verdict} | ${r.comment || ''} |`);
    }
    console.log('');
  }
  if (itemRows.length) {
    console.log('## 客观题错题\n');
    console.log('| 提交 | 题号 | 你写 | 正确 | 说明 |');
    console.log('|---|---|---|---|---|');
    for (const r of itemRows) {
      console.log(`| ${r.submissionId} | ${r.number} | ${r.student} | ${r.correct} | ${r.comment || ''} |`);
    }
    console.log('');
  }
  console.log('## 建议候选词');
  console.log(output.suggestedWords.length ? output.suggestedWords.join(', ') : '（无）');
}

main();
