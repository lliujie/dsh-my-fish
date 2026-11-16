# 大肥鱼（@local/dafeiyu）

面向技术部项目经理的 DSH 插件（前身「工作台」1.2.0）：把「一堆项目文件夹 + 文档产出 + 多智能体分工 + 跨项目汇报 + 插件自身版本 + 代码提交记录」收进一个面板。

> 当前版本 **2.5.0**：项目页多了一套**场景模板**——面板按网格自由排布，内置「文档 + 文件 + 保留位 + AI」（layout-doc）：左边一大块文档阅读区、右上竖条文件树、左下工具位、右下 AI。项目表头用「布局」下拉随时在三栏和场景之间切，按项目记住；`⟳ 场景` 重新读场景文件。场景文件可以自己加/改（包内 `scenarios/` 或数据目录 `scenarios/`），面板类型有 `view`（文档/编辑）、`file`（文件树）、`harness`（AI）、`reserved`（工具位占位）。2.4.0 起项目页右栏的主智能体对话区已对齐主工作区输入框——`@` 引用项目文件、`/` 斜杠命令、模型与思考档位切换、只读 / 标准 / 完全权限三档切换；2.3.0 起站点模块已整个移除，只剩 **项目 / 版本** 两个页签。界面按 DSH 设计规范统一（圆角 / 字号 / 聚焦环 / 滚动条 / 语义色都用官方 token）。项目页文件树 / AI 栏可一键收起，「专注」只留文档；版本页能看到 git / GitHub 的最近提交，仓库地址直接在面板里填。

## 两个模块页签：项目 / 版本

- **项目** —— 一个项目一个完整窗口：
  - 左栏：项目列表 + 总览入口；总览是跨项目视角（统计、项目卡、检索、周报月报草稿、总览智能体）。
  - 中栏：本地文件树；文本 / 代码 / Markdown 就地编辑（停手 1.2 秒自动保存，可切手动 / `Ctrl+S`，Markdown 带实时预览）；**docx / xlsx / pptx 内嵌分页预览**（内置 LibreOffice 引擎渲染，只读）；图片内嵌、PDF 内嵌阅读器、其余外部打开。
  - 右栏：**主智能体对话区**（面板内直接聊）+ 子智能体模块配置。输入框下面一条工具条：`＋` 引用项目文件（也可敲 `@`）、`/` 斜杠命令、当前权限模式、当前模型与思考档位、发送；跟主工作区的输入框一个用法。
  - 版面随时收：表头「文件树」「AI 栏」两个按钮可分别收起，「专注」一键只留文档；选择记在浏览器里，下次打开保持。
- **版本** —— 插件自己的版本中心：
  - 展示 `version.json` 里的版本号、发布日期、变更日志；
  - 每次 Host 启动自动快照（同一份代码指纹去重），也可手动「备份当前版本」；
  - 历史快照列表 + 一键回滚，回滚前会自动把当前版本再存一份，可来回滚；
  - 快照覆盖 `index.js / client.js / package.json / version.json / cordis.patch.yml / icon.svg`，最多 200 条；
  - **提交记录**：优先级 插件目录的 `.git` → 「提交记录」上方输入框里填的地址 → `version.json` 的 `repository.url` → 打包时写进 `gitlog.json` 的提交。前三种要联网（GitHub 公开 API）或在本地有仓库；最后一种**离线也能用**，联网失败时自动顶上。最近 20 条：短 hash、说明、日期、作者，旁边「逛仓库」直接开浏览器。

## 就地改文档，AI 随时接手

- 文本类文件在编辑器里直接改，默认停手 1.2 秒自动保存（工具栏可切「手动保存」，`Ctrl+S` 随时立即存）；保存前校验 mtime，被别的程序改过会提示冲突，点「重新读取」即可。
- 选中一段（或整篇不选）→ 点工具栏 `AI 润色` / `AI 精简`，选区连同项目、文件名、改造要求一起发进主智能体会话；改完点「重新读取」看结果。
- Office / PDF 仍只走「预览 + 外部打开 + 让 AI 改内容」，不在面板里做富文本编辑。

| 类型 | 行为 |
| --- | --- |
| 文本 / 代码 / Markdown / JSON / CSV | 就地编辑，自动保存（可切手动 / Ctrl+S） |
| Markdown | 可切「预览」看渲染结果 |
| 图片 png/jpg/gif/webp/svg | 内嵌预览 |
| PDF | 内嵌阅读器，不行就外部打开 |
| docx / doc / pptx / ppt / xlsx / xls | 内置引擎分页位图预览（只读） |
| 其它二进制 | 外部程序打开 |

## 面板里指挥智能体（2.4.0）

右栏对话区和主工作区的输入框一个用法：

- **@ 引文件**：点 `＋` 或在输入框敲 `@`，列项目里的文件（最多 30 条，按名字匹配优先），↑↓ 选、回车插入 `@相对路径`；主智能体的工作目录就是项目根，能直接读。
- **/ 命令**：敲 `/` 列出宿主提供的斜杠命令（`acp`、`goal`、`permission`、`plan`、`export`、`feedback`、`mnemon`…），回车即执行，结果以浅色提示条回显。
- **模型 / 思考档位**：右下角模型按钮列全部可路由模型；旁边的档位按钮在 `off / low / high / max` 间循环。选择按会话记住，重启仍在。
- **权限模式**：左下角 `只读 / 标准模式 / 完全权限`，切换立即生效（等价于 `/permission <preset>`）。
- 没建会话时按钮会提示「先发一句话建好会话」——第一条消息自动建会话并绑定到该项目。

## 场景布局（2.5.0）

项目页不必是三栏：表头「布局」下拉可在 **三栏（默认）** 和场景模板之间切，选择按项目记住（`state.json` 的 `project.layout`）。

- 内置场景 **「文档 + 文件 + 保留位 + AI」**（`layout-doc`）：4 列 × 5 行网格，文档区 `view` 占 3×3、右上 `file` 竖条 1×3、左下 `reserved` 工具位 2×2、右下 `harness`（AI）2×2。
- 面板类型：`view` = 文档 / 编辑器区（含预览、AI 润色）；`file` = 文件树；`harness` = 主智能体对话；`reserved` = 占位卡，把 JSON 里这块的 `type` 改掉就能换成别的东西（目前支持这四类）。
- 场景文件从两处读，同名以数据目录为准：插件包 `scenarios/*.json`、`<数据目录>/scenarios/*.json`。改完点表头 `⟳ 场景` 重新加载，不用重启。
- 自己加一个：复制包里的 `scenarios/layout-doc.json` 到 `<数据目录>/scenarios/`，改 `id` / `name` / `panels` 的 `col,row,w,h`（1 起算，最多 12 列 12 行）即可，会出现在「布局」下拉里。

```json
{
  "id": "layout_doc",
  "name": "文档 + 文件 + 保留位 + AI",
  "layout": "grid",
  "panels": [
    { "id": "dc-doc", "title": "文档", "type": "view", "col": 1, "row": 1, "w": 3, "h": 3 },
    { "id": "dc-file", "title": "文件", "type": "file", "col": 4, "row": 1, "w": 1, "h": 3 },
    { "id": "dc-extra", "title": "工具位", "type": "reserved", "col": 1, "row": 4, "w": 2, "h": 2 },
    { "id": "dc-ai", "title": "AI", "type": "harness", "col": 3, "row": 4, "w": 2, "h": 2 }
  ]
}
```

## 协作机制

「协作档案」会把项目与模块名册写进项目根目录的 `_pm/`：

```
_pm/
  项目档案.md     项目全貌、子智能体名册、主智能体工作约定
  任务看板.md     进行中 / 已完成 / 待确认
  模块/<模块>.md  每个子智能体的职责、交付物、边界
```

主智能体读到这些文件后按模块派单：一个模块一个子智能体。模块名册随时改，重新生成档案即可。「启动指令」把统筹文本放进剪贴板。

> 子智能体的能力边界由它自己的 agent preset 决定；本插件负责「分哪几个模块、每个模块干什么、产出入到哪个目录」。

## 三分钟上手

1. 侧栏点「大肥鱼」→「＋ 添加项目」选一个本地项目目录（也可以「手填路径」）。
2. 点「生成协作档案」，把 `_pm/` 名册写进项目目录。
3. 右栏对话区直接说需求（没会话会先建一个），或点「启动指令」复制统筹文本再粘贴。
4. 切「版本」页签，看一眼当前版本、变更日志与提交记录；改坏了就回滚。

## 安装、升级与数据

- 安装 / 升级：`plugin_manager` → `install_bundle` → 目标填 tgz 路径。客户端改动按 `Ctrl+R` 刷新；Host 侧（`index.js`）改动需要重启 DSH。
- 同版本重装会被「already installed」挡住，正确姿势是先 `remove_bundle` 再 `install_bundle`。
- 数据目录：`$DSH_HOME/dafeiyu/`（默认 `%USERPROFILE%\.dsh\dafeiyu\`），`DAFEIYU_HOME` 可覆盖。
- 从旧版升级：首次启动若新目录还没有 `state.json`，会把 `$DSH_HOME/pm-workbench/` 整体复制过来（项目台账、预览缓存都在），旧目录保留不删。
- 台账 `state.json` 含项目与 `settings.overviewSessionId` / `repositoryUrl`；版本快照在 `versions/`；预览缓存在 `preview/`；总览报告在 `reports/`。
- 所有文件读写都在项目根目录内，越界请求返回 403；移除项目只删登记，不删磁盘文件。

### 想让版本页显示 GitHub 提交记录

1. 在插件源码目录（`F:\dsh\dafeiyu\v2`）建仓并提交，推到你的 GitHub 仓库（仓库可以先用空的）：

   ```powershell
   cd F:\dsh\dafeiyu\v2
   git init
   git add -A
   git commit -m "大肥鱼 2.1.3"
   git remote add origin https://github.com/<你的账号>/dafeiyu.git
   git push -u origin main
   ```

2. 打开面板「版本」页签，在「提交记录」上方的输入框里粘上仓库地址（`https://github.com/<你的账号>/dafeiyu`），回车或点保存。地址存在数据目录的 `settings.repositoryUrl` 里，**不用改包、不用重装**，重装插件也不丢。

3. 之后版本页会读最近 20 条提交。优先级：本地 `.git` > 面板里填的地址 > `version.json` 的 `repository.url` > 打包时写进 `gitlog.json` 的提交（离线兜底，见下一节）。

> 本仓库的 `version.json` 已预置 `repository.url = https://github.com/lliujie/dsh-my-fish`，所以装上就能点「逛仓库」。

## 开发与打包

- 纯 ESM、零运行时依赖、无构建步骤：`index.js` 是 Host 半（`export const name / inject / apply`），`client.js` 是浏览器半（走 `window.__ModuleLoader__.load(...)`，不 import 任何包）。
- 改完先自检语法：`node --check index.js` 和 `node --check client.js`。
- 本地打包：`powershell -File scripts\build-tgz.ps1`（版本号取自 `version.json`，默认输出到仓库上一级目录，打印大小与 sha256）。脚本会把 `git log -n20` 的结果写进包里的 `gitlog.json`，所以装到配置档后**没有网也能显示提交记录**。
- 推 tag 自动发版：`.github/workflows/release.yml` 在 `v*` tag 上跑语法校验、打 tgz、上传产物并建 GitHub Release。
- 装进配置档：`plugin_manager remove_bundle @local/dafeiyu` → `plugin_manager install_bundle <tgz>`（同版本重装会被 already-installed 挡）。
- 本机推送注意：系统开着 WinINET 代理（`127.0.0.1:7892`）时 git 不会自动用它，直连 GitHub 会报 `OpenSSL SSL_read: Connection was reset`；`scripts/push-to-github.ps1` 会自动把系统代理写进仓库的 `http.proxy`。

## 已知边界

- 面板内对话是**轻量视图**：显示文本消息、2.5 秒轮询状态，不渲染工具调用卡片 / 图片 / 折叠块；要看完整轨迹点「在会话页打开」。
- Office 预览是**只读位图**（不做文字选择、不解析批注），一次最多 20 页 / 20 张工作表，超出请「外部打开」。
- 版本回滚只覆盖 6 个代码文件，不动数据目录，所以回滚不会丢项目台账。
- 提交记录只读：本地仓库读 `git log`，远端读 GitHub 公开 API。未登录时按出口 IP 限流（每小时 60 次），私有仓库读不到；设 `GITHUB_TOKEN` / `GH_TOKEN` 环境变量即可带上鉴权。限流或断网时自动退回包里的 `gitlog.json` 快照（那是打包那一刻的提交，不是实时的）。
- 渲染引擎优先用 DSH 自带的 `officeKit`，不可用时退回 `@deepseek-ai/libreoffice-kit`；两者都起不来时给「重试 / 用系统程序打开」退路（详见 [docs/DETAIL.md](docs/DETAIL.md)）。
