# 工作台插件代码地图（@local/dsh-pm-workbench v1.2.0）

> 工程根：`F:\dsh\dafeiyu\v2`（从 `C:\Users\lenovo\.dsh\profiles\desktop\node_modules\@local\dsh-pm-workbench` 复制，去掉 node_modules 与 screenshot）
> 行号一律指**本次复制的这两份源码文件**（UTF-8、LF、无 BOM）：`index.js` = 1770 行，`client.js` = 1951 行。
> 注意：PowerShell 的 `Measure-Object -Line` 只数**非空行**，`(Get-Content).Count` 也会少算几行——别用它们核对行号。可靠做法：`[System.IO.File]::ReadAllText($p)` 按 `` `n `` 切分（末尾去掉最后一段），或直接用 read 工具。

---

## 0. 工程文件清单

| 文件 | 行数 | 字节 | 说明 |
| --- | --- | --- | --- |
| `index.js` | 1770 | 63115 | Host 半边：Cordis 插件，挂 HTTP 前缀路由 |
| `client.js` | 1951 | 96777 | Web 半边：`window.__ModuleLoader__` 动态客户端模块 |
| `package.json` | 36 | 918 | 包元数据 + `dsh` 字段 |
| `cordis.patch.yml` | 3 | 71 | bundle 插入一条插件条目 |
| `icon.svg` | 6 | 353 | 插件图标 |
| `README.md` | 66 | 4856 | 使用说明（含数据目录/限制说明） |
| `locale/zh.json` | 7 | 271 | 中文文案 |
| `locale/en.json` | 7 | 300 | 英文文案 |
| `docs/DETAIL.md` | 145 | 10172 | 渲染引擎/实现细节 |

**单文件自包含**：两个源码文件**零相对 import**（`from './…'` 匹配数为 0）；`client.js` 连一条 `import` / `export` 语句都没有（§4 验证），完全靠 loader 的 `require('react')` 和返回值注册。

---

## 1. index.js（Host 半边）

### 1.1 顶部 import（逐行）

| 行 | 语句 |
| --- | --- |
| 13 | `import { promises as fsp, existsSync } from 'node:fs';` |
| 14 | `import path from 'node:path';` |
| 15 | `import os from 'node:os';` |
| 16 | `import crypto from 'node:crypto';` |
| 17 | `import { pathToFileURL } from 'node:url';` |
| 18 | `import { spawn } from 'node:child_process';` |

全部是 Node 内建模块，没有任何第三方/相对依赖。

### 1.2 导出（3 个，无 default）

| 行 | 签名 | 作用 |
| --- | --- | --- |
| 20 | `export const name = 'pm-workbench'` | Cordis 插件名（也用于 `ctx.logger(name)`，见 1709/1694/1741/1769） |
| 21 | `export const inject = ['webServer']` | 只声明依赖 webServer 服务 |
| 1708 | `export function apply(ctx)` | 唯一入口：取数据目录、建 handler、挂路由、注册清理 effect、预读台账 |

### 1.3 顶层常量

| 行 | 名字 | 值/含义 |
| --- | --- | --- |
| 23 | `API_BASE` | `'/pm-workbench/api'`（Host 前缀 + 客户端同源基址） |
| 24–27 | `BODY_LIMIT` / `TEXT_LIMIT` / `TREE_LIMIT` / `STATS_TTL` | 4MB / 1MB / 900 项 / 15s |
| 30–37 | `PREVIEW_DPI` 110、`PREVIEW_MAX_PAGES` 20、`PREVIEW_TIMEOUT` 180000、`PREVIEW_MAX_AGE` 14 天、`PREVIEW_MAX_PIXELS` 16M、`PREVIEW_MAX_DIMENSION` 8192、`PREVIEW_MAX_BYTES` 24MB | office 预览参数 |
| 38–39 | `PREVIEW_EXT` / `SHEET_EXT` | 可预览扩展名；表格单独给高 dpi（`previewDpiFor` 41：表格 200，其余 110） |
| 45–49 | `SKIP_DIRS` | 遍历时跳过的目录（.git/node_modules/.venv/…） |
| 51–58 | `IMAGE_EXT` / `OFFICE_EXT` / `TEXT_EXT` | 文件类型分派依据（被 `kindOf` 227 使用） |
| 59–69 | `MIME` | `/raw` 的 content-type 表 |
| 71–107 | `MODULE_PRESETS` | 5 个模块预设（tech-plan / review / report / sheet / doc-ops），随 `/state`、`/presets` 下发 |
| 937 | `OVERVIEW_ID = 'overview'` | 会话目标的特殊值（总览智能体） |
| 1081 | `NOTE_EXT` | 检索可读文本的扩展名白名单 |
| 1147 | `RANGE_DAYS` | `{ week: 7, month: 30 }` |

### 1.4 注册的 Host 服务 / 事件 / 路由

只挂**一条**前缀路由，内部按 path 手写分派（不是一堆独立 route）：

| 行 | 调用 | 说明 |
| --- | --- | --- |
| 1750 | `ctx.webServer.register({ kind: 'prefix', path: API_BASE, handler })` | `handler` = 1719 的 `async (req,res)=>…` |
| 1752 | `ctx.effect(() => () => disposeRoute(), 'pm-workbench：注销工作台 API 路由')` | 卸载时注销路由 |
| 1753–1764 | `ctx.effect(...)` | 卸载时 dispose 文档渲染引擎（converterPromise/kitPromise） |
| 1767–1768 | `loadState(root)`、`prunePreviews(root)` | 启动时预读台账 + 清过期预览 |

`handler`（1719–1748）先做鉴权：`ctx.connection.requestRejection(req)`（1723）→ 401/403（1729–1733）；没有 connection 时退回 `isTrustedLoopback`（1734，实现在 598）→ 403。然后调 `handleApi`（1739）。

分派核心 `handleApi`（1674–1704）：`route = url.split('?')[0].slice(API_BASE.length)`（1676）、`method` 大写（1677）、`params = URLSearchParams`（1679）；GET→`handleGet`（1682），POST→`handlePost`（1686），其它 405（1689）；异常统一转 `{ok:false,error:{code,message}}`（1690–1703，≥500 才打 warn）。

### 1.5 路由表（method + path + 处理函数 + 行号）

GET（`handleGet`，1310 起）：

| method | path | 处理逻辑 | 行号 |
| --- | --- | --- | --- |
| GET | `/state` | 遍历项目 + `projectStats`，返回 `{projects, presets, settings}` | 1313 |
| GET | `/overview` | `overviewValue(state)` | 1322 |
| GET | `/search?q=&projects=` | `searchAll` | 1328 |
| GET | `/report?range=week\|month&projects=` | `reportValue` | 1336 |
| GET | `/chat/messages?target\|projectId=&limit=` | `readMessages` + `chatState` | 1344 |
| GET | `/chat/state?…` | 只有状态（客户端未使用，见 §3） | 1353 |
| GET | `/presets` | 只回 `MODULE_PRESETS`（客户端未使用，1318 已随 /state 给） | 1360 |
| GET | `/tree?projectId=&path=` | `listTree`（`needProject` 定义在 1365） | 1371 |
| GET | `/file?projectId=&path=` | `fileInfo`（含 text/editable/kind） | 1378 |
| GET | `/raw?projectId=&path=` | 直接回文件字节，`cache-control: no-store`，无 Range | 1385 |
| GET | `/preview/tile?projectId=&path=&tile=` | 校验 tile 名（1403，防穿越）后回 PNG，`max-age=600` | 1399 |

POST（`handlePost`，1435 起；1436 `readBody`，1446 `loadState`）：

| method | path | 行为 | 行号 |
| --- | --- | --- | --- |
| POST | `/project/create` | 目录必须存在（1458）、查重（1459），`unshift` + 保存 | 1448 |
| POST | `/project/update` | 逐字段打补丁（1482–1489），更新 `updatedAt` | 1478 |
| POST | `/project/delete` | 只删登记 + 清 statCache | 1496 |
| POST | `/file/save` | 带 `baseMtimeMs` 冲突检测（1521，409 CONFLICT）、tmp+rename 原子写（1525–1527） | 1507 |
| POST | `/file/mkdir` | 建目录（客户端未使用） | 1534 |
| POST | `/brief` | `writeBrief` 写 `_pm/` 协作档案 | 1548 |
| POST | `/open` | `openWithSystem` 用系统程序打开 | 1557 |
| POST | `/preview` | `renderPreview` 出分页图（`refresh` 强制重渲） | 1573 |
| POST | `/chat/new` | `controller.create({workspaceId|cwd})`，写回 `leadSessionId` / `settings.overviewSessionId` | 1581 |
| POST | `/chat/send` | `sendChat`（queue 模式，64KB 上限） | 1605 |
| POST | `/settings/update` | 只改 `overviewSessionId` | 1615 |
| POST | `/report/save` | 写 `<root>/reports/周报-YYYYMMDD.md` 或 `<项目>/_pm/…` | 1627 |
| POST | `/probe` | 探目录是否存在/条目数（客户端未使用，调试用） | 1646 |

未命中统一 404（GET 1432 / POST 1671）。**共 24 个端点：11 GET + 13 POST。**

### 1.6 数据层

| 行 | 函数 | 说明 |
| --- | --- | --- |
| 111 | `dataRoot()` | `process.env.PM_WORKBENCH_HOME` 优先，否则 `(DSH_HOME || ~/.dsh)/pm-workbench` |
| 118 | `stateFile(root)` | `<root>/state.json` |
| 122–123 | `cache` / `cacheRoot` | 进程内单例缓存（按 root 区分） |
| 125 | `loadState(root)` | 读 JSON → 逐条 `normalizeProject`；文件缺失/坏 JSON 时用默认值；命中缓存直接返回 |
| 152 | `saveState(root, state)` | `mkdir -p` → 写 `.tmp`（带 pid）→ `rename` 覆盖 → 更新缓存 |
| 163 | `normalizeProject(raw)` | 无 `root` 返回 null；补 id/name/color/workspaceId/leadSessionId/notes/lastRel/modules/时间戳 |
| 183 | `normalizeModule(raw)` | 无 `name` 返回 null；补 id/role/deliverables/instructions/enabled |
| 197 | `newId(prefix)` | `${prefix}_${6字节 hex}` |

state 结构（默认值即 134–138 的初始化 + 168–180 / 187–193 的字段合并）：

```jsonc
{
  "version": 1,
  "projects": [{
    "id": "p_…", "name": "…", "root": "D:\\…", "color": "",
    "workspaceId": null, "leadSessionId": null, "notes": "",
    "lastRel": "", "modules": [{ "id":"m_…","name":"","role":"","deliverables":"","instructions":"","enabled":true }],
    "createdAt": "", "updatedAt": ""
  }],
  "settings": { "overviewSessionId": null }
}
```

### 1.7 服务依赖

| 服务 / 能力 | 获取位置 | 是否必需 |
| --- | --- | --- |
| `webServer` | 21 `inject` + 1750 `.register()` | **必需**，缺了整个插件不工作 |
| `officeKit` | 731 `ctx.get('officeKit')`，用作 `service.renderImages` | 可选；不可用退回 `libreoffice-kit`（648/689/707） |
| `sessionController` | 942；`prompt`/`state`/`events`/`create` | 可选；缺了返回 501 NO_CONTROLLER（951） |
| `sessions` | 992；`session.get(id).deriveMessages()` | 可选；失败退回 `controller.events`（1009） |
| `ctx.connection` | 1714 `ctx.connection.requestRejection` | 可选；没有就只信 loopback（1734） |
| `ctx.logger` | 1709 | 可选；退回 `console` |

### 1.8 工具函数清单（按行号）

| 行 | 函数 | 一句话 |
| --- | --- | --- |
| 41 | `previewDpiFor(ext)` | 表格类 200dpi，其它 110 |
| 111 | `dataRoot()` | 解析数据目录（PM_WORKBENCH_HOME / DSH_HOME） |
| 118 | `stateFile(root)` | state.json 路径 |
| 125 | `loadState(root)` | 读+规范化+缓存台账 |
| 152 | `saveState(root, state)` | tmp+rename 原子落盘 |
| 163 | `normalizeProject(raw)` | 项目字段补全/校验 |
| 183 | `normalizeModule(raw)` | 模块字段补全/校验 |
| 197 | `newId(prefix)` | 随机 id |
| 201 | `findProject(state, id)` | 按 id 找项目 |
| 207 | `resolveInside(project, rel)` | 越界即抛 403 OUT_OF_ROOT（路径安全唯一入口） |
| 221 | `relOf(project, abs)` | 绝对路径转 `/` 分隔相对路径 |
| 227 | `kindOf(abs)` | image / pdf / office / text / unknown |
| 236 | `bucketOf(fileName)` | doc / ppt / xls / pdf / other |
| 247 | `decodeText(buffer)` | UTF-8 严格解码失败后试 gb18030 |
| 262 | `fileInfo(project, rel)` | 出 rel/size/mtime/kind/mime/editable/text/truncated |
| 302 | `readHead(abs, limit)` | 只读文件头 1MB（大文本截断） |
| 313 | `listTree(project, rel)` | 单层目录列表，最多 900 条，目录优先、中文数字序 |
| 364 | `projectStats(project)` | 递归统计分类数量，深度 3、上限 2 万文件、15s 缓存 |
| 402 | `invalidateStats(rootDir)` | 清 statCache 单条 |
| 408 | `slugify(text)` | 文件名安全化（非法字符转 `-`） |
| 417 | `moduleBrief(project, module)` | 生成单个模块的 markdown 简报 |
| 444 | `archiveDoc(project, stats)` | 生成 `_pm/项目档案.md` 全文 |
| 494 | `escapeCell(text)` | 表格单元格转义 |
| 498 | `taskBoard(project)` | 生成 `_pm/任务看板.md` 骨架 |
| 524 | `writeBrief(project)` | 一次写 `_pm/项目档案.md`+`任务看板.md`+`模块/*.md`，返回 `{dir,files}` |
| 544 | `openWithSystem(abs)` | win `cmd /c start`、mac `open`、linux `xdg-open`，detached |
| 571 | `sendJson(res, status, payload)` | JSON 响应（补 content-type/length） |
| 580 | `readBody(req)` | 读 body，超 BODY_LIMIT 返回 `{tooLarge:true}` |
| 598 | `isTrustedLoopback(req)` | 校验 Host/Origin 是否本机（无 connection 时的兜底鉴权） |
| 615 | `normalizeDispose(registered)` | 把 register 的返回值（函数/Promise/dispose）统一成 cleanup |
| 638 | `fail(status, code, message)` | 造带 status/code 的 Error |
| 648 | `engineEntry()` | 在 app.asar.unpacked / DSH_INSTALL_DIR 找 libreoffice-kit 入口 |
| 689 | `loadKit()` | 动态 import 引擎，缓存 Promise，失败可重试 |
| 707 | `getConverter()` | `kit.createConverter({timeoutMs})` 单例 |
| 720 | `previewBase(root)` | `<数据目录>/preview` |
| 728 | `renderWithOfficeKit(ctx,…)` | 优先走 officeKit 服务渲染并写 manifest，不可用返回 null |
| 790 | `previewKey(abs, stat, dpi)` | sha1(`abs|size|mtime|dpi|v2`) 取前 20 位 → 缓存目录名 |
| 798 | `readManifest(dir)` | 读缓存 manifest，坏文件返回 null |
| 806 | `describeEngineError(error)` | 把 spawn/EPIPE/timeout 翻译成人话 |
| 817 | `shapePreview(key, manifest, stat)` | manifest → 客户端 `{pageCount,tiles[],missingFonts…}` |
| 839 | `renderPreview(ctx, root, project, rel, refresh)` | 缓存命中→复用；并发同 key 共享 `previewFlight`（863/905） |
| 914 | `prunePreviews(root)` | 删超过 14 天的预览目录 |
| 939 | `sessionControllerOf(ctx)` | 取 sessionController 并校验 `prompt` |
| 949 | `requireController(ctx)` | 没有就抛 501 NO_CONTROLLER |
| 955 | `textFromPart(part)` | 从消息 part 里抽纯文本 |
| 965 | `textFromContent(content)` | part 数组拼文本 |
| 971 | `shapeMessages(raw)` | 归一成 `{role,text,time}`；过滤 system-reminder/时间戳注入，单条截 20000 字符 |
| 989 | `readMessages(ctx, sessionId, limit)` | 优先 `sessions.get().deriveMessages()`，退回 `controller.events` |
| 1024 | `chatState(ctx, sessionId)` | `controller.state()` → `{running,active,queued,pendingInput}` |
| 1040 | `sendChat(ctx, sessionId, text)` | `controller.prompt({mode:'queue', clientTimeZone:'Asia/Shanghai'})` |
| 1053 | `chatSessionId(state, params, payload)` | target=overview 取 settings，否则取项目 `leadSessionId`；未绑定抛 409 |
| 1070 | `optionalChatSessionId(state, params)` | 上面那个的"不报错"版本，未绑定返回 null |
| 1083 | `walkFiles(project, options)` | 递归收集文件 `{rel,name,size,mtimeMs,kind,bucket}`，默认深度 4 / 4000 条 |
| 1127 | `readBoard(project)` | 解析 `_pm/任务看板.md` 的 `- [ ]` / `- [x]`，统计 open/done |
| 1149 | `overviewValue(state)` | 总览聚合：每项目 stats/近 7 天改动/看板/最近文件 + totals |
| 1188 | `searchAll(state, query, projectIds)` | 文件名 + 文本内容（≤512KB、NOTE_EXT）双路检索，命中上限 120 |
| 1239 | `formatDate(ms)` | `YYYY-MM-DD` |
| 1245 | `stampName()` | `YYYYMMDD`（报告文件名） |
| 1251 | `reportValue(state, range, projectIds)` | 生成周报/月报 markdown（改动清单 + 未完成待办 + 模块名册） |
| 1300 | `bucketLabel(key)` | doc/ppt/xls/pdf/其它 → 中文 |

### 1.9 内嵌预览渲染链路（改造成本最高的一段）

`POST /preview` → `renderPreview`（839）
1. 校验扩展名（843）→ dpi（852）→ `previewKey`（853）→ 缓存目录（854）；
2. 非 refresh 且 manifest 有图 → 直接返回 `cached:true`（856–861）；
3. 同 key 并发合并（863–864）；
4. 先试 `officeKit` 服务（876，`renderWithOfficeKit` 728，自带排队/缓存/上限）；
5. 退回内置 `libreoffice-kit`：`getConverter().renderImages({inputPath,outputDir,dpi,maxPages})`（888）；
6. 无结果 → 502 RENDER_EMPTY（899）；错误 → `describeEngineError`（896）。
客户端拿 `tiles[]` 再逐张请求 `GET /preview/tile`（校验 tile 名 1403，`cache-control: private, max-age=600`）。

---

## 2. client.js（Web 半边）

### 2.1 加载方式（没有 import / export）

| 行 | 内容 |
| --- | --- |
| 7–9 | `window.__ModuleLoader__.load({ id: '@local/dsh-pm-workbench', factory(require) { … } })` |
| 10 | `const React = require('react')`（loader 注入的 require，非 ESM） |
| 11–12 | `const h = React.createElement`；`const { useState, useEffect, useCallback, useRef } = React` |
| 14 | `const PANEL_ID = 'pm-workbench'` |
| 15 | `const API = '/pm-workbench/api'` |
| 1917–1949 | `return { inject: ['slots'], apply(ctx) {…} }`（模块导出的对象） |
| 1950–1951 | factory 结束 + `load` 调用结束 |

**无 JSX**：全文件都是 `h(tag, props, ...children)`（README 也写了"动态客户端没有 JSX 变换"）。改 UI 时不能写标签。

### 2.2 注册入口 / Slot 挂载

| 行 | 调用 | key / 值 |
| --- | --- | --- |
| 1918 | `inject: ['slots']` | 只要 slots 服务 |
| 1921 | `styles.insert(CSS)`（try/catch 包裹） | ⚠ `styles` 在本文件里**没有任何声明**（全文件仅此一处出现），要么吃 loader 全局，要么每次都是被吞掉的 ReferenceError；真正生效的是 1592 的 `<style>` |
| 1925–1931 | 本地 `get(name)` | `ctx.get(name)` 包一层 |
| 1934 | `ctx.get('uiWorkspace')` | 可选的界面导航服务（打开会话 / 选目录） |
| 1938 | `const Entry = (props) => h(Workbench, {...props, get, workspaceNav})` | 主面板入口 |
| 1939–1940 | `ctx.slots.inject('main', () => ctx.slots.register({ name:'main', key: PANEL_ID }, Entry))` | 主区域面板（key = `pm-workbench`） |
| 1941–1947 | `ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name:'sidebar.panellist', id: PANEL_ID, order: 5, label: () => '工作台' }, PanelIcon))` | 侧栏面板列表项（顺序 5，图标 191） |

### 2.3 主要组件（按出现顺序）

| 行 | 组件 | 职责 |
| --- | --- | --- |
| 191 | `PanelIcon(props)` | 侧栏图标（`.pm-icon`，用 `--dsw-specific-sidebar-fill`） |
| 214 | `Spinner()` | 转圈 |
| 218 | `Toast(props)` | 右下角提示条 |
| 233 | `inlineNodes(text, keyPrefix)` | 行内 markdown（`**粗体**`/`` `code` `` 等）→ React 节点 |
| 255 | `renderMarkdown(text)` | 块级 markdown 渲染（标题/列表/代码块/表格），供 md 预览 |
| 364 | `ChatPane(props)` | 面板内对话：2.5s 轮询 `/chat/messages`、发送、新会话；`target='overview'` 时用总览会话 |
| 505 | `OverviewPane(props)` | 总览视图：统计卡、跨项目检索、周报/月报草稿与保存 |
| 676 | `AgentPane(props)` | 子智能体模块 CRUD + 预设 chip + 启动指令 + 在会话页打开 |
| 860 | `DocPreview(props)` | office 分页位图预览（loading/error/空/多页 img，缺字体提示） |
| 910 | `ProjectWindow(props)` | **最大的组件**（910–1432）：文件树 + 编辑器 + 预览 + 右栏对话/模块 |
| 1433 | `Workbench(props)` | 根组件：左栏项目列表、总览/项目切换、增删项目、toast/confirm、`<style>` 注入 |

### 2.4 状态管理（全是 useState，无 useReducer / 无全局 store）

| 组件 | 行 | 状态字段 |
| --- | --- | --- |
| ChatPane | 368–371 | `chat{loading,sessionId,items,status,error}`、`draft`、`sending`、`busy`（另有 `boxRef` 372 自动滚底） |
| OverviewPane | 507–514 | `data`、`error`、`query`、`search`、`busySearch`、`range`、`report`、`busyReport` |
| AgentPane | 679–680 | `form`（模块编辑表单）、`busyOpen` |
| DocPreview | — | 无自有状态（`doc` 由父组件传入） |
| ProjectWindow | 916–928 | `nodes{rel:{entries,loading,error}}`、`expanded:Set`、`sel{rel,info}`（当前文件）、`draft`、`dirty`、`saving`、`preview`（md 预览开关）、`doc`（office 预览结果）、`busyBrief`、`renaming`、`pendingRel`、`notesOpen`、`notesDraft`；`selRef` 930 给回调取最新值 |
| Workbench | 1435–1443 | `snapshot{projects,presets,settings}`、`activeId`、`loading`、`error`、`toast`、`manual`（手填路径弹窗）、`busy`、`askState`（确认弹窗 Promise）、`view`（`'project'` / `'overview'`） |

项目/文件/预览/对话相关的核心字段就是：`snapshot.projects[].stats`、`activeId`、`nodes`、`sel.info{kind,editable,text,mtimeMs}`、`doc{tiles}`、`chat.items/status`、`form`（模块）。

### 2.5 所有 fetch 调用（路径 + 组件 + 行号）

封装：`decodeJson` 101（解 `{ok,value}`）、`call(route, params)` 121（GET，URLSearchParams，`credentials:same-origin`）、`post(route, payload)` 130（JSON POST）。路径都拼 `API`（`/pm-workbench/api`）。

| 行 | 方法 + 路径 | 组件 / 函数 |
| --- | --- | --- |
| 378 | GET `/chat/messages?{target\|projectId}&limit=80` | ChatPane `load` |
| 409 | POST `/chat/new` | ChatPane 新建会话 |
| 431 | POST `/chat/send` | ChatPane 发送 |
| 519 | GET `/overview` | OverviewPane `load` |
| 538 | GET `/search?q=…` | OverviewPane 检索 |
| 549 | GET `/report?range=…` | OverviewPane 生成草稿 |
| 567 | POST `/report/save` | OverviewPane 保存 md |
| 893 | GET `/preview/tile?…`（`<img src>`） | DocPreview |
| 934 | POST `/project/update` | ProjectWindow `patch`（改名/notes/模块/lastRel/workspaceId 全走它） |
| 942 | GET `/tree?projectId&path` | ProjectWindow `loadDir` |
| 958 | GET `/file?projectId&path` | ProjectWindow `openFile` |
| 973 | POST `/preview`（`refresh`） | ProjectWindow `loadDoc` |
| 988 | POST `/preview` | ProjectWindow 选中 office 文件时的 effect |
| 1044 | POST `/file/save`（带 `baseMtimeMs`） | ProjectWindow `save`（Ctrl+S，1055 处理 CONFLICT） |
| 1064 | POST `/open` | ProjectWindow `openExternal` |
| 1073 | POST `/brief` | ProjectWindow `runBrief`（生成 `_pm/`） |
| 1374 / 1381 | GET `/raw?…`（`<img>` / `<iframe>`） | ProjectWindow 图片 / PDF 分支 |
| 1466 | GET `/state` | Workbench `refresh` |
| 1500 | POST `/project/create` | Workbench `createProject`（1503–1514 顺带建 workspace 并回写） |
| 1512 | POST `/project/update` `{workspaceId}` | Workbench `createProject` |
| 1550 | POST `/project/delete` | Workbench `removeProject` |

Host 有但客户端**没调**的端点：`/chat/state`、`/presets`、`/settings/update`、`/file/mkdir`、`/probe`（后两个完全是闲置能力，加"新建文件夹"UI 时可直接用）。

### 2.6 CSS 方案

- 全文件一份 CSS 字符串常量：`const CSS = [ … ].join('\n')`，**1716–1913**（约 197 行）。
- 注入方式：Workbench 渲染树里 `h('style', null, CSS)`（**1592**）——随组件挂载进 DOM；另有 1921 的 `styles.insert(CSS)` 兜底（`styles` 未声明，见 §2.2）。
- 命名：统一 `.pm-` 前缀（`.pm-root` `.pm-rail` `.pm-proj` `.pm-editor-*` `.pm-doc*` `.pm-ov-*` `.pm-chat*` `.pm-btn` `.pm-chip` …），共约 100+ 条规则；**没有 CSS module，没有 CSS-in-JS 库**。
- 主题：只用 DSH 设计变量，不写死颜色。常见：`--dsw-alias-bg-base` / `-bg-layer-2` / `-bg-overlay`、`--dsw-alias-border-l1` / `-l2`、`--dsw-alias-label-primary` / `-secondary` / `-caption`、`--dsw-alias-brand-primary`、`--dsw-specific-sidebar-fill`、`--dsh-frame-top-clearance`（1586 顶部安全区）。
- 少量内联 `style` 用于布局：根容器 1576–1590、左栏 1593–1595 等。动画 `@keyframes pm-spin`（1911）配 `.pm-spinner`（1911）。

### 2.7 文件类型分派（改"能不能预览"就动这里）

服务端先给 `info.kind`（index.js `kindOf` 227），客户端在 ProjectWindow 编辑器区按 kind 分支：

| 行 | 分支 | 渲染 |
| --- | --- | --- |
| 1346–1350 | 无选中 | 空态提示 |
| 1351–1368 | `kind === 'text'` | `preview` 为真且是 `.md/.markdown` → `renderMarkdown(draft)`（1353）；否则 `<textarea>`（1354），Ctrl+S 保存（1363–1366） |
| 1369–1375 | `kind === 'image'` | `<img src=API/raw>` |
| 1376–1382 | `kind === 'pdf'` | `<iframe src=API/raw>` |
| 1383–1391 | `kind === 'office'` | `<DocPreview>`（分页 PNG） |
| 1392–1396 | 其它（unknown/binary） | 空态 + "用系统程序打开" |
| 962 | md 预览开关 | `setPreview(info.kind==='text' && /\.(md|markdown)$/i)` |
| 1329–1342 | 工具栏 | 仅 office 出"外部打开"（1332） |

扩展名 → kind 的映射表在 index.js：`IMAGE_EXT` 51、`OFFICE_EXT` 52、`TEXT_EXT` 53–58，`kindOf` 227。

---

## 3. 其它

### 3.1 package.json 的 `dsh` 字段

| 行 | 键 | 含义 |
| --- | --- | --- |
| 23–26 | `dsh.bundle.patch` = `./cordis.patch.yml` | 装 bundle 时读这个 patch 把插件插进 Cordis 配置 |
| 27 | `dsh.client.platform` = `"web"` | 客户端半边只装进 Web 客户端（Electron 渲染进程同源） |
| 28 | `dsh.client.immediately` = `true` | 启动即加载客户端模块，不等用户打开面板 |
| 30–33 | `dsh.client.inject` = `["@deepseek-ai/dsh-client-ui-layout","@deepseek-ai/dsh-client-ui-sidebar"]` | 客户端模块的**前置依赖 UI 包**（用到 `main` / `sidebar.panellist` 两个 slot 的来源），不带这两个包 slot 不存在 |

另有：`"type": "module"`（5，Host 侧 ESM）、`exports`（7–13，`"."`→host、`"./client"`→web、locale/icon/package.json）、`files`（14–22，发布白名单）。

`cordis.patch.yml`（3 行）：
```
1: - insert:
2:     - id: pm-workbench
3:       name: '@local/dsh-pm-workbench'
```

### 3.2 改名 / 加模块时最可能要动的 10 个位置

| # | 文件:行 | 改什么 / 为什么 |
| --- | --- | --- |
| 1 | `package.json:2` | 包名 `@local/dsh-pm-workbench`；loader id、cordis patch 的 `name` 都要跟着一致 |
| 2 | `package.json:7–13` | `exports` 映射（host/client/locale/icon/package.json），加新入口文件必须加映射 |
| 3 | `package.json:14–22` | `files` 白名单：不加进去，打包/安装时新文件会丢（docs、locale 都在这） |
| 4 | `package.json:27–33` | `dsh.client`（platform/immediately/inject）：换挂载区域或依赖别的 UI 包时改这里 |
| 5 | `cordis.patch.yml:2–3` | bundle 条目 `id` + `name`，插件在 Cordis 里的身份；改名最容易漏 |
| 6 | `index.js:20` | `export const name = 'pm-workbench'`（Cordis 名 + 日志 tag 1694/1741/1769） |
| 7 | `index.js:23` + `1750` | `API_BASE` 与 `ctx.webServer.register` 的前缀挂载点；`handleApi:1676` 用它 slice，客户端 `client.js:15` 必须逐字一致 |
| 8 | `client.js:7–8` | `window.__ModuleLoader__.load({ id: '@local/dsh-pm-workbench' })`；动态客户端模块标识，与包名绑定 |
| 9 | `client.js:14` | `PANEL_ID = 'pm-workbench'`：slot key、侧栏面板 id、`main` slot 注册 key 全用它 |
| 10 | `client.js:1917–1947` | 模块导出对象：`inject`、`slots.register` 的 `name/order(5)/label('工作台')/PanelIcon`；改挂载位置或改面板名就在这 |

**联动点（不在 10 条内但改起来会疼）**：`client.js:1716` 的 `.pm-` 类名前缀（改名要全量替换 CSS + 所有 className）；`client.js:14/15` 之外还有 `index.js:1694/1741/1769` 的日志文本；`icon.svg`；`locale/zh.json`、`locale/en.json`；`README.md` 里的包名与命令。

**加一个新模块（例如"看板"标签页）的最小改动集**：Host 加端点 → `handleGet`（1310 区块内新增 `if (route === '/xxx')`）或 `handlePost`（1435 区块内），涉及 state 字段就在 `normalizeProject` 163 补字段；客户端加组件（放在 1433 之前）→ 在 ProjectWindow 工具栏 1329–1342 加按钮或在 Workbench 左栏 1593–1632 加视图项 → `client.js:15` 的 `API` 拼路径；新样式追加进 1716–1913 的 `CSS` 数组（记得 `.pm-` 前缀）。

### 3.3 额外确认

1. **是否单文件自包含**：是。
   - `Select-String -Pattern '^\s*import'` → `index.js` 只有 6 条 `node:*` 内建 import（13–18），`client.js` 0 条。
   - `Select-String -Pattern "from\s+['\"]\.{1,2}/"` → 两个文件都是 0 命中，没有任何 `./xxx.js` 相对 import。
   - `client.js` 也**没有 `export`**（`^\s*(import|export)\b` 命中数 = 0），它是 `window.__ModuleLoader__.load({id, factory})` 形式的动态客户端模块，只能靠 `require('react')` 和 `return {inject, apply}` 接入。
   - 结论：改名/搬运只能整份复制或改这里的注册字符串，拆文件必须先加打包/loader 能力。

2. **数据目录 `C:\Users\lenovo\.dsh\pm-workbench\`**：存在。
   - `state.json` 989 字节 / 34 行，`version:1`，2 个项目：
     - `p_a55d6bca72e9` 福利商城 → `D:\蓝宝\01_福利商城`（workspaceId 有值、`leadSessionId: null`、`modules: []`、lastRel 指到 `12_徐宁/…方案10.13.docx`）
     - `p_b4c10b972e07` AI智能客服 → `D:\蓝宝\04_AI智能客服`（同样未绑会话、无模块）
   - `settings.overviewSessionId: null` → 总览智能体也还没建会话。
   - `preview\` 下有两个缓存目录：`1093c900bb11f0a9fc6c`（12 张 page-*.png + manifest.json 3462B）、`75ef4483d6f0425e2c2d`（11 张 + manifest.json 3218B）。合计 23 张 PNG、约 5MB。
   - 没有 `reports\` 目录（说明还没点过"保存成 md"）。

3. **可疑/待确认点**
   - `client.js:1921` 的 `styles.insert(CSS)`：`styles` 在文件内无声明，CSS 实际靠 1592 的 `<style>` 生效；这段属于死代码或依赖 loader 全局，重构时可删。
   - `index.js:1385` `/raw` 一次性 `readFile` 全文件、无 Range/无大小上限，大 PDF/视频会吃内存；预览 PNG 走 `/preview/tile` 才带缓存头。
   - `POST /project/update` 里 `index.js:1489` 的 `if (… && !payload.id) project.root = patch.root` 是死条件（前面 1479 已按 `payload.id` 找到项目，走到这里 `payload.id` 必然为真），想支持改根目录得改这行。
   - `state.json` 里 `workspaceId` 有值但 `leadSessionId` 全为 null：说明客户端"添加项目"时建过 workspace（client.js 1503–1514），但没建过会话。
