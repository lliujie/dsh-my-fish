# 大肥鱼 · 详细说明

## 面板结构

顶部两个模块页签：**项目 / 版本**。

```
┌ 项目 ─┬─ 主区 ──────────────────────────────────────────────────┐
│ 总览  │ 项目视图：项目名 · 目录 · 计数          [打开文件夹]     │
│ A 项目│ ┌ 本地文件 ┬ 编辑器 / 预览 ────────┬ 智能体 ─────────┐ │
│ B 项目│ │ 文件树   │ 文本就地编辑 / 预览   │ 对话 + 模块     │ │
│ ＋添加│ │          │                       │ @//模型/权限    │ │
│       │ └──────────┴───────────────────────┴─────────────────┘ │
└───────┴──────────────────────────────────────────────────────────┘
┌ 版本 ───────────────────────────────────────────────────────────┐
│ 当前 v2.4.0 · 变更日志 · 提交记录（git / GitHub / 打包快照） │
│ 历史快照（每次启动/手动/回滚前自动记录）                          │
└──────────────────────────────────────────────────────────────────┘
```


## 总览

- 入口：左栏顶部「总览」；卡片显示项目数与未完成待办数。
- 统计条：项目数、文件数、近 7 天改动、未完成待办。
- 项目卡：名称 / 本地目录 / 文档·PPT·表格·PDF 数量 / 近 7 天改动 / 待办 / 模块数 / 最近改动的 3 个文件；点卡片进该项目。
- 跨项目检索：按文件名（`kind:name`）或文本文件内容（逐行，`kind:content`，带行号）搜，最多 120 条；可用 `projects=` 限定项目。
- 周报 / 月报：时间窗 7 天 / 30 天，汇总各项目「本期改动清单（最多 12 条/项目）+ 未完成看板项 + 模块名册 + 备注」，生成 Markdown；`复制` 贴给智能体润色，`保存成 md` 落到项目 `_pm/`（总览则落 `$DSH_HOME/dafeiyu/reports/`）。
- 右侧「总览智能体」：与项目视图同一套对话组件，绑定在 `settings.overviewSessionId`。

## 面板内对话

- Host 侧走 `ctx.get('sessionController')`（即 `ctx.remote.session` 的宿主实现）：`prompt({requestId, sessionId, mode:'queue', content:[{type:'text',text}], clientTimeZone}, signal)` 发消息，`state({sessionId}, signal)` 取运行状态，历史优先读 `sessions.get(id).deriveMessages()`，失败退 `controller.events({address:{kind:'session',sessionId}})`。
- 客户端每 2.5 秒轮询 `/chat/messages?...&limit=80`，只渲染 role=user/assistant 的文本段；`thinking` 等非文本段被过滤，system-reminder / 时间戳这类注入的 user 消息也被过滤。
- 新建会话即 `controller.create({workspaceId | cwd})`，并把 sessionId 写回项目 `leadSessionId` 或 `settings.overviewSessionId`。
- 面板只是轻量视图：不渲染工具卡片、图片、折叠块；要看完整轨迹点「在会话页打开」。

## 输入框（对齐主工作区）

对话输入框下面一条工具条，能力与主工作区对齐：

- **＋ 引用文件**：点 `＋` 或直接在输入框敲 `@`，弹出项目文件列表（`GET /mentions?projectId&q`，最多 30 条，按文件名命中优先、再按路径长度），↑↓ 选择、回车或点选插入 `@相对路径 `。插入的是相对项目根的路径，主智能体的工作目录就是项目根，能直接读。
- **/ 斜杠命令**：敲 `/` 弹出可用命令（来自宿主 `commands.list(agent)`：`acp`、`goal`、`permission`、`plan`、`export`、`feedback`、`mnemon` 等）。以 `/` 开头的输入不走发消息，而是 `POST /command` → `commands.execute(agent, line, [], signal)`，结果（`kind` / `text`）以浅色提示条回显在对话流里，最多保留 4 条。
- **模型**：右侧模型按钮显示当前模型；点击列出 `modelCatalog()` 里所有可路由模型（两级 provider → model 拍平），选择走 `POST /composer/model` → `controller.selectModel({sessionId, provider, model, reasoningEffort})`（**扁平入参**，传 `selection` 对象会报「Select an available model before sending a message」）。选中的模型按会话记在 `state.settings.models[sessionId]`，重启后仍在。
- **思考档位**：模型旁的档位按钮（当前 `off/low/high/max` 之一）点击循环切换，同样走 `/composer/model`。
- **权限模式**：左侧权限按钮显示 `只读 / 标准模式 / 完全权限`，切换走 `POST /composer/permission` → 执行 `/permission <preset>` 命令；当前值从会话日志里倒序找 `permission/preset` 事件得到。
- 未绑定会话（项目还没发过第一句话）时，模型与权限按钮点了会提示「先发一句话建好会话」——会话由第一条消息自动创建（`POST /chat/new`）。
- 总览页只有对话与权限/模型，`＋`（引用文件）在总览禁用：总览没有项目文件，去项目页里引用。

## 项目

- 添加：`＋ 添加项目` 调系统目录选择器；也可以用 `手填路径` 输入 `D:\项目\某某`。
- 项目列表右上角 `刷新` 重新读台账与统计（不会丢当前选中）。
- 每个项目在 DSH 侧自动建一个工作区（workspace），用于承载该项目的会话；已有同路径工作区时直接复用，不重复创建。
- 移除：`移除` 只删登记。删除前会二次确认，磁盘文件不受影响。
- 版面：项目视图表头三个按钮——`文件树` 收起/展开左栏、`AI 栏` 收起/展开右栏、`专注` 一次只留文档（再点恢复三栏）。偏好存在浏览器 `localStorage`：`dafeiyu.pane.files`、`dafeiyu.pane.agent`，值为 `on`/`off`；`.pm-body` 会带 `no-files` / `no-agent` 类切换栅格列数。

## 版本

- 版本号/发布日期/变更日志来自插件包里的 `version.json`，面板只读展示。
- 快照：每次 Host 启动自动记一份（同一份代码指纹去重）、手动 `备份当前版本`、回滚前自动再备份一份。
- 快照范围：`index.js`、`client.js`、`package.json`、`version.json`、`cordis.patch.yml`、`icon.svg`（不含 docs/截图，省空间）；历史最多 200 条。
- 回滚：选中一条 → 二次确认 → 用快照文件覆盖插件目录 → 记一条 `rollback` 记录。**客户端改动按 Ctrl+R 刷新即生效；Host 侧（index.js）需要重启 DSH**。回滚本身不丢版本：回滚前那份会被自动存下来，可以再回滚回去。
- 快照目录：`<数据目录>/versions/<版本号>-<时间戳>/`，索引 `versions/history.json`。
- 提交记录：GET `/version` 额外返回 `commits` 与 `repositoryUrl`。地址来源优先级：插件目录有 `.git` → 读本地（`git log -n20`、`remote get-url origin`、当前分支）；否则用 `state.settings.repositoryUrl`（面板里填的，存 `<数据目录>/state.json`）；再退到 `version.json` 的 `repository.url`。以上都拿不到时（或远端读取失败），回退到包内的 `gitlog.json`（`scripts/build-tgz.ps1` 打包时用 `git log -n20` 生成，字段 `generatedAt/remote/branch/commits`），返回 `source: "bundled"` 并附 `liveError` 说明联网失败原因。远端调 `https://api.github.com/repos/<owner>/<repo>/commits?per_page=20`（8 秒超时）；有 `GITHUB_TOKEN` / `GH_TOKEN` 环境变量就带 `Authorization: Bearer`。失败把原因放进 `commits.error`（404=仓库地址错或私有、403/429=限流），页面照常显示。

## 文件

| 类型 | 行为 |
| --- | --- |
| 文本 / 代码 / Markdown / JSON / CSV | 编辑器内直接改，默认停手 1.2 秒自动保存（工具栏「自动保存 / 手动保存」可切换，选择记在浏览器里）；`Ctrl+S` 立即保存；保存前校验 mtime，被其它程序改过会提示冲突 |
| Markdown | 可切「预览」看渲染结果（标题、列表、表格、代码块、引用、行内代码/加粗）；保存后回到实时渲染 |
| 图片 png/jpg/gif/webp/svg | 内嵌预览 |
| PDF | 内嵌阅读（Electron 自带阅读器），不行就外部打开 |
| docx / doc / pptx / ppt | **内嵌分页预览**：内置引擎渲染成 PNG，逐页滚动看，页脚标「第 n 页 / 总数」 |
| xlsx / xls | **内嵌分页预览**：每个工作表一张位图（按已用区域裁切，200 dpi），标「工作表 名称」 |
| 其它二进制 | 外部程序打开 |

Office 预览是只读位图：改内容请点「外部打开」用 Office 改，回面板点「重新生成」重新渲染。
首次渲染约 0.8–2 秒，之后命中缓存（键 = 路径 + 大小 + mtime + dpi）；文件一改，键变，自动重渲染。

就地改文档有两条 AI 捷径（文本类文件）：编辑器工具栏的 `AI 润色` / `AI 精简`。选中一段就只发选中内容（不选就整篇），连同文件名、项目名、改造要求一起塞进主智能体会话；改完主智能体会把结果写回文件，点「重新读取」即可看到。

AI（主智能体或子智能体）直接在磁盘上改同一个文件时，编辑框里留着的旧内容会在下次保存时报「文件已被其它程序改动」——这是故意的保护，点「重新读取」拿最新版本即可，不会把 AI 的改动覆盖掉。

隐藏与噪音目录（`.git`、`node_modules`、`.venv`、`__pycache__`、`.idea`、`.next` 等）不进树。

## 智能体

### 主智能体

- 面板内直接对话（见上节）。未绑定时点「开始对话」用项目目录建会话；「新会话」另起一个并重新绑定。
- 「在会话页打开」跳到原生会话页看完整轨迹。
- 「生成协作档案」写 `_pm/`；「启动指令」生成一段带模块名册的统筹指令（含派发方式、汇报与交付约定）。
- 确认类操作（移除项目、删除模块、换绑、放弃未保存修改）都在面板内弹出确认框，不调用系统对话框。

### 子智能体模块

每个模块四栏：名称、职责、交付物、补充要求。可套用预设、可停用（停用的模块不进档案、不派单）。

「复制简报」生成单模块的派单文本，形如：

```
你是「XX 项目」项目的子智能体，负责「技术方案」模块。
项目根目录：D:\项目\XX
模块简报：_pm/模块/技术方案.md
职责：…… 交付物：……
```

### 协作流程

1. 配好模块 → `生成协作档案`（写 `_pm/`）。
2. 右栏对话区直接说需求（或「启动指令」+ 粘贴）。
3. 主智能体读档案，按模块派子智能体；子智能体只写自己模块的产出。
4. 主智能体每轮更新 `_pm/任务看板.md`；阶段性汇报去「总览」生成周报草稿。

## HTTP 接口（Host 半边）

前缀 `/dafeiyu/api`，同源、带 DSH 连接鉴权（`connection.requestRejection`，回环兜底）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/state` | 项目台账 + 统计 + 模块预设 + 设置 |
| POST | `/project/create` | `{root, name?}` 登记项目（目录必须存在） |
| POST | `/project/update` | `{id, patch}` 改名称/说明/模块/绑定 |
| POST | `/project/delete` | `{id}` 移除登记 |
| GET | `/tree` | `?projectId&path` 列目录 |
| GET | `/file` | `?projectId&path` 读文件（文本带内容） |
| GET | `/raw` | 原始字节（图片 / PDF） |
| POST | `/preview` | `{projectId, path, refresh?}` 渲染/复用 Office 分页预览，返回 `{status, cached, pageCount, dpi, tiles[], missingFonts}` |
| GET | `/preview/tile` | `?projectId&path&tile=page-0001.png` 取预览图（只允许 `*.png`，挡路径穿越） |
| POST | `/file/save` | `{projectId, path, text, baseMtimeMs}` 原子保存 |
| POST | `/file/mkdir` | 新建目录 |
| POST | `/brief` | 生成 `_pm/` 协作档案 |
| POST | `/open` | 用系统默认程序打开 |
| POST | `/probe` | 探测目录是否存在 |
| GET | `/overview` | 跨项目汇总：`{projects[], totals, overviewSessionId, generatedAt}` |
| GET | `/search` | `?q=&projects=` 跨项目检索，返回 `{hits[], query}` |
| GET | `/report` | `?range=week\|month&projects=` 生成 Markdown 草稿，返回 `{range, label, markdown, since, projects}` |
| POST | `/report/save` | `{text, range, projectId?}` 落盘成 md |
| GET | `/chat/messages` | `?projectId \| target=overview&limit=` 拉历史（未绑会话时 `sessionId:null`、空列表） |
| GET | `/chat/state` | 同上，仅状态 `{running, active, queued}` |
| POST | `/chat/new` | `{projectId \| target:'overview'}` 建会话并绑定 |
| POST | `/chat/send` | `{projectId \| target, text}` 发消息（`mode:'queue'`） |
| GET | `/composer` | `?projectId \| target=overview` 输入框增强数据：`{sessionId, models[], defaultSelection, selection, permission{preset,presets}, commands[], bound}` |
| GET | `/mentions` | `?projectId&q=` 项目文件候选（最多 30 条 `{path, kind:'file'}`） |
| POST | `/composer/model` | `{projectId \| target, provider, model, reasoningEffort?}` 切换模型并记住 |
| POST | `/composer/permission` | `{projectId \| target, preset}` 切换权限模式（执行 `/permission <preset>`） |
| POST | `/command` | `{projectId \| target, line}` 执行斜杠命令（`line` 必须以 `/` 开头） |
| POST | `/settings/update` | `{patch}` 目前支持 `overviewSessionId` |
| POST | `/openlink` | `{url}` 用系统默认浏览器打开链接（版本页「逛仓库」用） |
| GET | `/version` | 当前版本 + 变更日志 + 代码指纹 + 数据目录 + 历史快照 + `repositoryUrl` + `commits`（本地 git / GitHub / 包内 gitlog.json，`source` 分别为 `git` / `github` / `bundled`） |
| POST | `/version/snapshot` | `{note?}` 手动备份当前代码 |
| POST | `/version/rollback` | `{id}` 回滚到指定快照（先自动备份当前版本） |
| POST | `/version/repository` | `{url}` 记住 GitHub 仓库地址（空串=清除），存在 `state.json` 的 `settings.repositoryUrl` |

## 数据与边界

- 台账：`$DSH_HOME/dafeiyu/state.json`（默认 `%USERPROFILE%\.dsh\dafeiyu\`），`DAFEIYU_HOME` 可覆盖目录。
- 迁移：首次启动时若新目录还没有 `state.json`，会把旧版 `$DSH_HOME/pm-workbench/` 整体复制过来（含 2 个项目台账与预览缓存），旧目录保留不删；也可用 `PM_WORKBENCH_HOME` 沿用旧变量。
- 预览缓存：`$DSH_HOME/dafeiyu/preview/<key>/`（`manifest.json` + `page-000N.png`），14 天未访问自动清理。
- 版本快照：`$DSH_HOME/dafeiyu/versions/<版本号>-<时间戳>/` + `versions/history.json`。
- 面板里填的仓库地址：`$DSH_HOME/dafeiyu/state.json` 的 `settings.repositoryUrl`（与项目台账同一个文件）。
- 面板里选的模型：同一个 `state.json` 的 `settings.models`，键是会话 id，值是 `{provider, model, reasoningEffort}`。
- 总览报告：`$DSH_HOME/dafeiyu/reports/`；项目内报告：`<项目>/_pm/`。
- 路径：所有文件操作都限制在项目根目录内（`path.relative` 校验，越界 403）。
- 文本上限 1 MB，超过只读预览；请求体上限 4 MB。
- 编码：UTF-8 严格解码失败时回退 GB18030，减少老 Windows 文档乱码。
- 对话依赖宿主 `sessionController` 服务；极旧版本没有该服务时返回 501 并提示升级。

## Office 预览引擎

- 首选 DSH 自带的 `officeKit` 宿主服务（`ctx.get('officeKit')`）：它自带排队、并发与结果缓存，并随 DSH 一起升级；
  单次请求带页数/像素/边长/字节上限（20 页、16 Mpx、8192px、24 MB）。
- 服务不存在或被禁用时，退回直接加载安装目录自带的 `@deepseek-ai/libreoffice-kit`（`resources/app.asar.unpacked/...`），
  探测顺序：`process.resourcesPath` → `path.dirname(process.execPath)/resources` → `$DSH_INSTALL_DIR` 推导；
  单例 `createConverter({timeoutMs:180000})`，插件停用时 `dispose()`。
- 相同文件的并发请求合并成一次渲染；同一文件再次打开直接读缓存（`manifest.json` 命中即 0 毫秒返回）。
- 页数上限 20 页、文档 110 dpi、表格 200 dpi（表格按已用区域裁切，太低会糊）。
- 引擎起不来时返回 502 + 可读原因，面板给「重试 / 用系统程序打开」降级路径。

### 若提示「内置渲染引擎启动失败」（EPIPE / 0xC0000005）

通常不是文档的问题，而是系统 VC++ 运行库太旧（`MSVCP140.dll` < 14.4x），`dsoffice.exe` 在 CRT 初始化就崩。
把新版运行库放到引擎 `bin\` 目录旁边即可（DLL 搜索优先于 System32），例如从 Edge 自带目录复制：

```powershell
# 路径按你的 DSH 安装位置调整（默认在 %LOCALAPPDATA%\Programs\DeepSeek Harness\resources\...）
$bin = 'E:\software\DeepSeek Harness\resources\app.asar.unpacked\dsh\node_modules\@deepseek-ai\libreoffice-kit-win32-x64\bin'
$src = 'C:\Program Files (x86)\Microsoft\EdgeCore\Optimized'
Get-ChildItem $src -Filter '*140*.dll' | Copy-Item -Destination $bin -Force
```
