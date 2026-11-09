# 推送到 GitHub

这个目录是清理好的仓库副本：不含 `submissions/`、`feedback/`、`tmp/` 和个人运行数据。

## 0. 建议先移出 OneDrive

Git 在 OneDrive 同步目录里容易遇到文件锁/同步冲突。可以把整个目录复制到：

```
C:\Users\<you>\Projects\cet6-handwriting-practice
```

然后在新位置执行下面的命令。若留在 OneDrive，建议执行 git 操作时暂停同步。

## 1. 创建远程空仓库

GitHub → New repository：

- 名称例如 `cet6-handwriting-practice`
- Public 或 Private 均可
- **不要勾选** Add README / .gitignore / license（避免和本地冲突）

## 2. 本地初始化并提交

```powershell
cd C:\Users\<you>\Projects\cet6-handwriting-practice

git init -b main
git config user.name "Your Name"
git config user.email "you@example.com"

# 预检：不应出现 submissions / feedback / tmp / .port
git add -n .
git status --short

git add .
git commit -m "Initial commit: CET-6 handwriting practice"
```

确认没有个人数据：

```powershell
git ls-files | Select-String 'submissions|feedback|tmp|\.port'
```

应为空。若误加了：

```powershell
git rm -r --cached submissions feedback tmp .port
git commit --amend
```

## 3. 推送

```powershell
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

认证二选一：

- HTTPS：Git Credential Manager 登录，或使用 Personal Access Token；不要把 token 写进 remote URL / 文件。
- SSH：`git@github.com:<user>/<repo>.git`；先配置 SSH key。

如果仓库创建时带了 README/license，先：

```powershell
git pull --rebase origin main
```

再 push。

## 4. 验证

```powershell
git ls-files | Select-String 'submissions|feedback|tmp|\.port'
```

在 GitHub 网页浏览文件树，确认没有：

- `submissions/`
- `feedback/`
- `tmp/`
- `.port`
- `.env` / token

再在另一个目录 clone 一次：

```powershell
git clone https://github.com/<user>/<repo>.git "$env:TEMP\cet6-check"
cd "$env:TEMP\cet6-check"
npm start
```

打开 `http://127.0.0.1:43110`，确认试卷能显示；提交后 `submissions/` 会被自动创建，且 `git status` 仍然干净。

## 5. 容易踩的坑

- **不要从包含个人工具配置/日志的父目录 git init**：只把本项目目录作为仓库根。
- **不要提交手写数据**：`submissions/` 和 `feedback/` 是个人内容。
- **答案键公开**：`data/keys.json` 会随仓库公开；不想公开就用 Private 仓库。
- **服务器只适合本地**：无鉴权，不要直接暴露公网。
- **GitHub Pages 不可用**：这是 Node 服务，不是纯静态站。
- **Windows 换行**：`.gitattributes` 已处理 `start.sh` / `start.cmd`。
- **令牌安全**：不要提交 PAT、SSH 私钥或 `.env`。
- **已经推送了个人数据**：按“已暴露”处理，最好删除仓库重建，或 `git filter-repo` 重写历史后 force push；旧提交可能已被缓存/fork。

## 6. 可选

- 在 GitHub 仓库设置里加 Topics：`cet6`, `handwriting`, `canvas`, `education`, `local-first`, `nodejs`
- 打 tag：`git tag v1.0.0 && git push origin v1.0.0`
- 对 `start.sh` 设置可执行位：

```powershell
git update-index --chmod=+x start.sh
git commit -m "Make start.sh executable"
```
