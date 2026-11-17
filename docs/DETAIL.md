# 大肥鱼 3.2 · 详细说明

面向要改它、或在它上面加东西的人。

## 面板结构

```text
┌──────────────────────────────────────────────────────────────┐
│ 大肥鱼 v3.0.0   [场景1] [场景2] [＋]        ⟳刷新  编辑场景  版本 │
├──────────────────────────────────────────────────────────────┤
│  网格：按场景 JSON 的 cols × panels(col/row/w/h) 摆放           │
│  ┌────────────────────────┬──────────┐                      │
│  │ view（预览 / 编辑）      │ file     │                      │
│  ├────────────────────────┴──────────┤                      │
│  │ note（定位卡 / 记忆）   │ harness（常驻 AI）                │
│  └────────────────────────────────────┘                      │
└──────────────────────────────────────────────────────────────┘
```

- 切场景：写 `settings.lastScene`，只换网格，不动会话。
- 面板尺寸：CSS grid，`gridColumn: col / span w`、`gridRow: row / span h`；`rows` 由设备自动推算。
- 没有场景时显示空态，点右上「＋」建第一个。

## 场景

### 文件与来源

- 插件包：`<插件目录>\scenarios\*.json`（内置模板）。
- 数据目录：`<数据目录>\scenarios\*.json`（用户自建或覆盖）。
- 同名 id 时数据目录优先；改完点「⟳ 刷新」即重新读取，不用重装。

### 字段

| 字段 | 说明 |
| --- | --- |
| `id` | 必填，文件名必须等于 id（正则 `[^\w.\-]` 会被替换成 `-`） |
| `name` | 标签栏显示的名字 |
| `description` | 悬停提示 |
| `root` | 文件 / 预览面板的根目录；空则这两个面板显示空态 |
| `cols` | 列数，1..12；不填按面板右边界推算 |
| `panels[]` | 最多 24 块 |

### 面板字段

公共：`id`、`title`、`type`、`sub`、`col`、`row`、`w`、`h`。
按类型追加：`web.url`、`note.source`（`context` / `memory`）、`file`/`view` 的 `root`、`home`、`viewPanel`、`filesPanel`、`harness.sessionTitle`、`harness.sessionId`。

### 三件套

`ensureSceneDocs` 在保存场景、打开场景时自动补齐：

- `<数据目录>\scenes\<id>\定位卡.md`：职责 / 资产 / 触发词 / 铁律 / 上次进度。
- `<数据目录>\scenes\<id>\场景记忆.md`：`## §〇 交接` + 长期决策。
- `<数据目录>\scenes\身份索引.md`：绑会话时 `updateSceneIndex` 重写该面板那一行。

「认领身份」= 把定位卡全文 + 记忆前 24 行拼成一条消息发给会话，让 AI 自己进入角色。

## 面板

### file

`GET /tree?sceneId&panelId&path` 逐层读目录（`SKIP_DIRS` 跳过 `.git`/`node_modules` 等），返回
`{path,name,dir,kind,size,mtimeMs}`；点文件把 `{panelId,path,name,kind}` 交给 `view` 面板。
空态与错误态分开显示（没设 root / 目录空 / 读取失败）。

### view

`GET /file` 读内容（文本 1 MB 上限，UTF-8 失败回退 GB18030）。
文本：`textarea` + 停手 1.2 秒自动保存（工具栏可切手动，选择记在 `localStorage` 的 `dafeiyu.view.autosave`）；
`Ctrl+S` 立即保存，保存前比对 `baseMtimeMs`，不一致报 `MTIME_CONFLICT`（提示重新读取，避免覆盖 AI 的改动）。
Markdown 可切「看」走本地渲染。
图片走 `/raw`；PDF 用 iframe；Office 走 `/preview` 分页位图。

### harness

- 绑会话：面板右上「会话」→ 选一个已有会话，或「＋ 新建会话」（`sessionController.create`）。
  绑定的会话 id 写 `settings.sessions["<sceneId>/<panelId>"]`，并更新身份索引。
- 对话：`GET /chat/messages` 每 2.5 秒轮询，`POST /chat/send` 走 `sessionController.prompt`（`mode:'queue'`）。
- 输入框：`＋ 文件` / 输入 `@` 拉项目文件（`GET /mentions`）；`/` 拉命令（`commands.list`），以 `/` 开头的整条消息走 `POST /command`；
  模型下拉（`GET /composer` 的 `models`，写入走 `POST /composer/model` → `sessionController.selectModel`，扁平入参 `{sessionId,provider,model,reasoningEffort}`）；
  档位按钮循环 `off/low/high/max`；权限按钮三档（`POST /composer/permission` → `/permission <preset>` 命令）。
- 未绑会话时发送、换模型、改权限都会收到 409 `NO_SESSION`，界面提示先绑会话。

### web

iframe + 缩放（0.6–1.8，`transform:scale` 配合 `width/height:100/zoom%`）。
8 秒内没触发 `onLoad` 视为「不让嵌」，给 X-Frame-Options / CSP 解释与「用系统浏览器打开」（`POST /openlink`）。

### note

`GET /scene/notes?id` 读两份文档，`POST /scene/note` 写；停手 1.2 秒自动保存。

### layers（3.1.0）

四个页签：场景（定位卡 + 场景记忆）、宪法（`<数据目录>\宪法\*.md`）、共享层（`<数据目录>\共享层\*.md`）、项目记忆（`scenes\<id>\项目记忆\*.md`）。

`GET /layers?id=<场景>` 一次读齐五组文档（`docs` / `constitution` / `shared` / `projects`），每份带 `kind, name, path, rel, text, size, mtimeMs`；单份超过 60 KB 会截断并注明。
`POST /layer/save` 写回磁盘（超过 1 MB 抛 413）；`POST /layer/create` 新建（同名 409，名字为空 400）。
面板右侧 textarea 停手 1.2 秒自动保存，与 AI 会话读写的是同一份文件，不存在「面板里的副本」。

### reserved

占位卡：显示标题、说明、场景与面板 id。想把这块换成网页 / 清单 / 图表，改场景 JSON 的 `type` 即可。

## 版本

- `GET /version`：`version.json`（display / version / releasedAt / changelog）+ 快照历史 + 提交记录。
- 提交记录优先级：本地 `.git` → 数据目录里的仓库地址 → `version.json` 的 `repository.url` → 打包时生成的 `gitlog.json`（附 `liveError` 说明为什么用兜底）。
- `POST /version/snapshot`：把 6 个源码文件复制到 `<数据目录>\versions\<version>-<时间戳>\`，最多留 200 条。
- `POST /version/rollback`：先给当前版本留一份 `pre-rollback` 快照，再覆盖源码；数据目录不动。
- `POST /version/repository`：存 GitHub 地址到 `settings.repositoryUrl`；非 GitHub 或不是 http(s) 一律 400。私有仓库要设 `GITHUB_TOKEN` / `GH_TOKEN`。
- 源码改动后要 Ctrl+R 刷新面板才生效（Host 会热加载，客户端不会）。

## HTTP 接口（前缀 `/dafeiyu/api`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/state` | 场景列表 + settings + 版本号 + 数据目录 |
| GET | `/scene?id` | 单个场景 + 两份文档 |
| POST | `/scene/save` | 写 `<数据目录>\scenarios\<id>.json` 并补齐三件套 |
| POST | `/scene/delete` | 只删数据目录里的场景（内置模板删不掉） |
| GET/POST | `/scene/notes`、`/scene/note` | 读 / 写定位卡与场景记忆 |
| GET | `/layers?id` | 记忆层：场景 / 宪法 / 共享层 / 项目记忆 五组文档 |
| POST | `/layer/save`、`/layer/create` | 写回 / 新建记忆层文件 |
| POST | `/settings/update` | `lastScene`、`repositoryUrl` |
| GET | `/tree` | 列目录 |
| GET | `/file` | 读文件信息（文本含内容） |
| GET | `/raw` | 原始字节（图片 / PDF） |
| POST | `/file/save` | 保存文本，带 mtime 冲突校验 |
| POST | `/file/mkdir` | 建目录 |
| POST | `/preview`、GET `/preview/tile` | Office 分页渲染与贴图 |
| POST | `/open`、`/openlink` | 用系统程序打开文件 / 用浏览器打开网址 |
| GET | `/sessions` | 可绑定的会话列表（带人话 `title` 与 `cwd`，已绑场景的排前面） |
| POST | `/session/bind`、`/session/new` | 绑会话 / 新建会话（新建时自动把标题改成「场景名 · 面板名」） |
| POST | `/session/rename` | 改会话标题，列表里显示的就是这个名字 |
| GET | `/chat/messages`、`/chat/state` | 对话内容与运行状态 |
| POST | `/chat/send` | 发消息 |
| POST | `/claim` | 认领身份（把定位卡与 §〇 发给会话） |
| GET | `/composer`、`/mentions` | 模型 / 权限 / 命令、@ 文件候选 |
| POST | `/composer/model`、`/composer/permission`、`/command` | 换模型 / 换权限 / 跑命令 |
| GET | `/version` | 版本 + 快照 + 提交记录 |
| POST | `/version/snapshot`、`/version/rollback`、`/version/repository` | 留档 / 回滚 / 存仓库地址 |

所有接口只接受本机回环访问；`connection.requestRejection` 或非回环地址直接 403。

## 数据与边界

- 数据目录：`DAFEIYU_HOME` > `PM_WORKBENCH_HOME` > `$DSH_HOME|~/.dsh` + `dafeiyu`。
- `state.json`：`{version:3, settings:{lastScene, repositoryUrl, sessions, models}}`，原子写（tmp + rename）。
- `preview/`：Office 位图缓存，键 = 绝对路径 + 大小 + mtime + dpi，14 天未用自动清。
- `versions/`：版本快照；`scenes/`：身份三件套（定位卡、场景记忆、`项目记忆/`）。
- `宪法/`、`共享层/`：跨场景的 L0 / L1 记忆，记忆层面板直接读写。
- 首次启动会从旧的 `pm-workbench` 数据目录复制一份（只复制，不删除）。
- 桌面端 Node 没有浏览器沙箱：内嵌网页只受对方站点策略限制，插件不做注入。
