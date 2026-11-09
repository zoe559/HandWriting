# 批改手册（给 AI 和未来的自己）

本文件说明：用户在练习台点“提交批改”后，如何根据页面图片、笔迹、答案键，完成逐题批改并写报告。

## 0. 一句话流程

找到 `submissions/<id>/` → 读 `meta.json` / `layout.json` / `data/keys.json` → 逐页看 PNG → 必要时裁图放大 → 判分 → 写 `feedback/<id>.md` 与 `.json` → 更新 `meta.json` → 在对话里回复摘要。

### 0.1 页面里的学习中心

- 批改完成后，学习中心会读取 `feedback/<id>.md` 直接渲染报告；`meta.report` 要指向它。
- 学习中心的“错词本”会汇总 `feedback/*.json` 里的 `wordAnnotations`、`items`（带 `word` 的）、`grammarNotes`；这些字段不要改名。
- `meta.scores` 会被学习中心用来显示分数：
  - 选词：`{ clozeCorrect, clozeTotal }`
  - 词汇：`{ vocabCorrect, vocabTotal, vocabPartial, vocabWrong }`
  - 整套：`{ objective, objectiveTotal, translation, writing, total, totalMax }`

## 1. 定位提交

用户通常发来：

```
批改 101500-ab12
```

或：

```
批改刚提交的
```

处理规则：

1. 先列 `submissions/` 下最近修改的目录（排除 `.tmp-*`）。
2. 如果用户给了 `shortId`（形如 `101500-ab12`），匹配 `meta.json` 的 `shortId` 或目录名后缀。
3. 如果用户说“刚提交的”，取 `status === "submitted"` 且 `createdAt` 最新的一份。
4. 如果最近 10 分钟有多份，先在回复里说明你选了哪一份；必要时问用户。
5. 如果该份已经 `status === "graded"`，用户又说“批改”，先问是重批还是看报告；不要默认覆盖。
6. 如果找不到，告诉用户当前最新提交的 shortId，并请其在对话里发 `批改 <shortId>`。

提交目录结构：

```
submissions/<id>/
├─ meta.json         # 卷、时间、状态、页数、note
├─ layout.json       # 每页的 items 锚点 + lines 文本行
├─ page-01.png ...   # 2x A4（1588x2246）
├─ strokes.json      # 原始笔迹（备用）
└─ submission.json   # 原始提交（排查用）
```

## 2. 读材料

必读：

- `meta.json`：确认卷子、页数、用时、`note`（用户可能写了“第 3 页那个字是……”）。
- `data/keys.json`：`mock-a` 的答案、解析、翻译参考、写作范文；`vocab-errors-01` 的 `items` 是词汇注解的可接受义项和语境。**答案键只从文件读，不要通过 HTTP 暴露。**
- `layout.json`：每页的题目锚点和文字行；用于裁图和定位注解。
- 页面 PNG：逐页 `read_image`。图片是 2x，正常阅读没问题；字小/密时裁切。

### 裁图工具

脚本：`tools/crop.py`，需要 Python 3 + Pillow：

```bash
python -m pip install pillow
```

常用命令（macOS/Linux 若命令是 `python3`，把 `python` 换成 `python3`）：

```bash
# 列出页与锚点
python tools/crop.py --latest --list

# 裁某题答案框（自动读 layout）
python tools/crop.py --latest --item 46 --padding 24

# 裁某页任意区域（逻辑坐标 794x1123）
python tools/crop.py --sub 20260101-000000-0000 --page 9 --box 640,180,120,100

# 裁右侧整条批注区
python tools/crop.py --latest --page 3 --right-margin
```

输出在 `tmp/`，脚本会打印绝对路径；随后 `read_image` 该路径即可。如果你在一个自带 Python/Pillow 的环境（例如 DeepSeek Harness）里工作，也可以直接用那个 Python 解释器运行同一脚本。

### 定位中文注解

- 页面右侧留白约 `x=668..744`；行间也有空隙。
- `layout.json` 的 `pages[].lines[]` 有每行文字、x/y/w；用垂直位置判断注解对应哪一行。
- 报告里用“第 3 页，'sustainable' 上方”这种描述，不要只写坐标。
- 如果注解在行间、指向不明确，先按最近的单词/短语判断，并在报告里注明“按位置判断”。

## 3. 判分口径

### 3.1 客观题（26–55，共 30 题）

- 答案键在 `keys.json` → `objective`。
- 大小写不敏感；`b` = `B`。
- 选词填空：如果用户在空白处写的是单词而不是字母，单词正确也视为正确，但报告里注明“写的是单词”。
- 如果答案框里同时出现两个字母、或字母像两个选项：先看笔画，仍不确定就标“字迹不确定”，请用户确认；**不要猜一个然后当成确定**。
- 匹配题：只接受段落字母 A–O；写在框外的答案也接受，但注明位置。
- 阅读题：只接受 A–D。

### 3.2 中文注解

逐条核对，四档：

| 判定 | 含义 |
|---|---|
| 正确 | 释义/语法说明准确，或与上下文一致 |
| 部分正确 | 大意对，但不够准确/漏了关键义项 |
| 错误 | 释义错误、词性错误、搭配错误 |
| 无法辨认 | 字迹看不清，或指代不明 |

要求：

- 一条注解一行；写清“第几页、附近英文、你写的内容、判定、说明”。
- 词汇注解要结合上下文义，不要只按词典第一义。
- 语法/搭配注解要指出具体问题，例如“这里不是被动，是系表结构”。
- 不把“字迹没看清”判成“错误”；用“无法辨认”并请用户确认。

### 3.3 翻译（15 分制练习分）

评分：

- 内容忠实 7 分：信息完整，无明显漏译/误译。
- 语言准确 5 分：语法、搭配、拼写。
- 流畅得体 3 分：衔接、语域、可读性。

报告里给出：

- 分数（如 11/15）和扣分点。
- 2–5 条具体修改（原句 → 建议句）。
- 参考译文（keys.json → `translation.reference`）。
- 采分点核对（keys.json → `translation.points`）。

### 3.4 写作（15 分制练习分）

评分：

- 任务回应 5 分：是否回应题目、观点是否清楚、字数是否达标。
- 组织 4 分：结构、段落、衔接。
- 语言 6 分：语法、词汇、句式；少量错误不严重影响理解可给较高分。

报告里给出：

- 分数（如 10/15）。
- 2–5 条具体修改（原句 → 建议句）。
- 范文/提纲（keys.json → `writing.sample` / `outline`）。
- 下一次最值得练的 2–3 点。

### 3.5 总分

练习口径：

```
客观题（30）+ 翻译（15）+ 写作（15）= 60
```

明确写“练习参考分，不是官方 CET-6 分数”。中文注解单独统计正确/部分/错误/无法辨认数量，不折算进 60 分。

### 3.6 词汇巩固文章（`vocab-errors-01` 一类）

这类卷子不是选择题，而是“读文章 + 写中文词义”：

- 页面 1 是文章，12 个目标词有浅蓝底、下划线和编号；页面 2 是编号表，每行一个词 + 横线。
- 学生可以写在编号表里，也可以写在文章右侧留白；两种都算作答。
- 答案键：`data/keys.json` → `vocab-errors-01.items[]`，每项有 `word` / `context` / `accepted` / `note`。
- 逐词判“正确 / 部分正确 / 错误 / 无法辨认”，按语境义，不按词典第一义：
  - `process` 写“过程”只算部分正确（此处动词“处理”）。
  - `genuinely` 写“真诚地”可算部分正确（此处“真正地/真心地”）。
  - `highlight` 写“高亮”算部分正确（此处“强调/突出”）。
  - `absorb` 写“到手”算错误（应为“吸收/理解”）。
  - `preserve` 写“坚持”算错误（应为“保持/保存”）。
- 评分：`vocabCorrect / vocabTotal`（如 9/12），不折成 60 分；另外统计部分正确/错误/无法辨认。
- 如果学生把词义写在文章里而不是编号表，用编号定位；编号表空不代表没作答。
- 生成新文章：见本文件第 7 节。

## 4. 写报告

路径：

```
feedback/<id>.md
feedback/<id>.json
```

### 4.1 Markdown 模板

```markdown
# 批改报告 · CET-6 模拟卷 A · 文字部分

- 提交：`<id>`（`<createdAt>`，用时 `<timeSpentSec>` 秒）
- 批改时间：`<ISO>`

## 总览

- 客观题：**<correct> / 30**
- 翻译：**<score> / 15**
- 写作：**<score> / 15**
- 练习总分：**<total> / 60**
- 中文注解：核对 <n> 处，正确 <n>，部分正确 <n>，错误 <n>，无法辨认 <n>

## 客观题逐题

| 题号 | 你的答案 | 正确答案 | 判定 | 说明 |
|---|---|---|---|---|
| 26 | C | C | ✅ | ... |
| ... | | | | |

## 中文注解核对

| 页 | 位置/附近文字 | 你写的 | 判定 | 说明 |
|---|---|---|---|---|
| 3 | `sustainable` 上方 | 可持续的 | ✅ 正确 | ... |

## 翻译

- 得分：<score> / 15（内容 <x>/7，语言 <x>/5，流畅 <x>/3）
- 扣分点：...
- 修改建议：...
- 参考译文：...

## 写作

- 得分：<score> / 15（任务 <x>/5，组织 <x>/4，语言 <x>/6）
- 优点：...
- 修改建议：...
- 下一步：...

## 优先改进

1. ...
2. ...
3. ...

## 字迹不确定 / 待确认

- 第 4 页第 33 题，字母像 B 也像 D：按 B 判，若实际是 D 请告诉我。
```

### 4.1b 词汇文章报告模板

```markdown
# 词汇巩固报告 · 错词文章 01

- 提交：`<id>`（用时 `<timeSec>` 秒）
- 范围：文章 + 中文注解表（12 个词）

## 总览

- 正确：**<correct> / 12**
- 部分正确：<n>；错误：<n>；无法辨认：<n>

## 逐词核对

| 编号 | 词 | 文章语境 | 你写的 | 判定 | 说明 |
|---|---|---|---|---|---|
| 1 | distraction | in a world full of distraction | 分心 | ✅ 正确 | ... |
| ... | | | | | |

## 需要再巩固的词

- ...

## 字迹不确定 / 待确认

- ...
```

### 4.2 JSON（给网页/后续工具用）

```json
{
  "submissionId": "20260101-000000-0000",
  "paperId": "mock-a",
  "gradedAt": "2026-11-09T08:00:00+08:00",
  "scores": {
    "objective": 24,
    "objectiveTotal": 30,
    "translation": 11,
    "writing": 10,
    "total": 45,
    "totalMax": 60
  },
  "annotations": {
    "checked": 8,
    "correct": 6,
    "partial": 1,
    "wrong": 1,
    "unreadable": 0
  },
  "items": [
    { "number": 26, "student": "C", "correct": "C", "ok": true, "comment": "" }
  ],
  "uncertain": ["第 4 页第 33 题字母像 B/D"],
  "summary": "客观题稳定，翻译漏译一处，写作结构清楚但词汇重复。"
}
```

## 5. 更新 meta.json

批改完成后，把 `<id>/meta.json` 更新为：

```json
{
  "status": "graded",
  "gradedAt": "2026-11-09T08:00:00+08:00",
  "scores": { "objective": 24, "translation": 11, "writing": 10, "total": 45, "totalMax": 60 },
  "report": "feedback/20260101-000000-0000.md"
}
```

保留原有字段（id、shortId、paperId、createdAt、pages、note 等），只增/改上述字段。用 Node 或 Python 读写 UTF-8；写入前先读原文件。

## 6. 对话里怎么回

先给结论，再给最值得看的细节：

```
批改完成：CET-6 模拟卷 A（101500-ab12）

客观题 24/30。错题：
- 28：你写 B，正确 I（memory）
- 41：你写 K，正确 L（小空间/口袋公园）
- 53：你写 A，正确 B（rebound effect）

翻译 11/15：整体准确，漏译“待客之道”，有两处搭配问题。
写作 10/15：结构清楚，但例子偏泛；给了 3 处修改建议。

中文注解核对 8 处：正确 6，部分正确 1，错误 1（详见报告）。
有 2 处字迹不确定，已在报告里标出，你确认后我可以改判。

报告：feedback/20260101-000000-0000.md
```

不要在对话里塞整份 30 行表格；报告里有。错题超过 8 个时，只列最典型的 5–8 个，其余指向报告。

## 7. 生成新的错词文章

用户说“根据我的易错词生成一篇文章”时：

1. 运行 `node tools/error-words.mjs`（或手动扫描 `feedback/*.json`）。
   - 重点看 `wordAnnotations` 里判定为“错误/部分正确”的词，以及 `items` 里错题对应的正确词。
   - 再补几个“虽然这次注对、但在错题里混淆过”的词（如 memory、constantly、crucial）。
2. 选 10–12 个目标词，写一篇 200–350 词的短文，让每个词在语境中出现一次；避免把文章写成词表。
3. 在 `data/papers.json` 加一套 `kind: "vocab"` 的卷子：
   - 一个 `vocabArticle` block（`title`、`note`、`text`、`targets`）。
   - 一个 `pageBreak`。
   - 一个 `vocabTable` block（`items` 按文章出现顺序编号）。
4. 在 `data/keys.json` 加同名 key，`kind: "vocab-annotation"`，每个词写 `accepted`（可接受中文义）和 `note`（语境提醒）。
5. 刷新网页即可选到新卷；不需要重启服务。
6. 告诉用户直接打开 `http://127.0.0.1:43110/?paper=<id>`。

写作要点：目标词要自然、语境要能区分词义（如 process 用动词、preserve 用“保持”、highlight 用“强调”），不要用生僻搭配。文章不要太长，一页读完最好。

## 8. 规则

- **不猜字迹**：不确定就标“？”，请用户确认。
- **不编答案**：`keys.json` 缺某题时，明确说“答案键缺失”，不要凭印象判。
- **不覆盖历史**：重批时保留旧报告为 `<id>.v1.md` 或先问用户。
- **不通过 HTTP 暴露 keys**：`data/keys.json` 只从文件读取；不要新增接口。
- **隐私**：页面和报告只写在本机项目目录下；不要上传到外部服务。
