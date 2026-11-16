# 大肥鱼 3.0 · 场景化工作台

一类活一个场景：**顶部场景标签栏 + 网格面板 + 一条常驻 AI**。
切场景就是换一块工作面——文件、预览、网页、定位卡、会话都跟着换。

旧版的「项目台账 / 站点 / 协作档案 / 总览 / 周报月报」整套下线，只留版本页用于升级与回滚。

## 两个模块

- **场景**（主界面）：顶部标签栏，一个场景一份 JSON，网格里放六种面板。
- **版本**（右上「版本」）：当前版本、变更日志、GitHub 提交记录、历史快照与回滚。

## 六种面板

| type | 作用 |
| --- | --- |
| `harness` | 常驻 AI 会话：@ 引文件、/ 命令、模型与思考档位、只读 / 标准 / 完全权限，一键「认领身份」 |
| `file` | 文件树：场景 `root` 下的目录，点文件送到 `view` 面板 |
| `view` | 预览 / 就地编辑：Markdown、文本（停手 1.2 秒自动保存）、图片、PDF、Office 分页位图 |
| `web` | 内嵌网页：缩放、刷新、外部打开；被 X-Frame-Options 挡住时给提示 |
| `note` | 定位卡 / 场景记忆：直接在面板里写，自动保存到 `<数据目录>/scenes/<id>/` |
| `reserved` | 预留位：想换网页 / 清单 / 图表时改这块的 `type` 就行 |

## 一个场景 = 一份 JSON

放 `<数据目录>\scenarios\<id>.json`（文件名必须等于 id），或直接用插件包里的 `scenarios\` 模板。
在面板里点「编辑场景」也能改——改完保存即生效，不用重新安装。

```json
{
  "id": "logistics-206",
  "name": "物流商城 206",
  "description": "内网测试环境那套",
  "root": "D:\\蓝宝\\01_福利商城",
  "cols": 4,
  "panels": [
    { "id": "p-doc",  "title": "文档", "type": "view",    "col": 1, "row": 1, "w": 3, "h": 3 },
    { "id": "p-file", "title": "文件", "type": "file",    "col": 4, "row": 1, "w": 1, "h": 3 },
    { "id": "p-note", "title": "记忆", "type": "note",    "source": "memory", "col": 1, "row": 4, "w": 2, "h": 2 },
    { "id": "p-ai",   "title": "AI",   "type": "harness", "col": 3, "row": 4, "w": 2, "h": 2 }
  ]
}
```

硬规矩：文件名 = id；`type` 拼错会显示成预留位（不报错）；面板 `id` 是持久化身份，改了它等于换了一块面板。

## 场景三件套

| 文件 | 作用 |
| --- | --- |
| `scenes\<id>\定位卡.md` | 这个场景是干什么的、资产在哪、什么话能触发它、铁律 |
| `scenes\<id>\场景记忆.md` | §〇 交接（进度 / 下一步 / 卡点）+ 长期决策与坑 |
| `scenes\身份索引.md` | 面板 ↔ 会话的对应表，绑会话时自动更新 |

AI 面板右上角「认领身份」会把「读定位卡 → 读 §〇 → 回报进度」这三步直接发给会话。

## 装在哪

| 东西 | 位置 |
| --- | --- |
| 插件本体 | `C:\Users\lenovo\.dsh\profiles\desktop\node_modules\@local\dafeiyu\` |
| 数据（场景 / 定位卡 / 预览缓存 / 版本快照） | `C:\Users\lenovo\.dsh\dafeiyu\` |
| 你自己的场景 | `C:\Users\lenovo\.dsh\dafeiyu\scenarios\` |

内置两个场景模板：`layout-doc`（文档 + 文件 + 记忆 + AI）、`work`（文件 + 预览 + AI）。

## 升级与回滚

- 换新包：先卸载再装（同版本重装会被挡）——
  `plugin_manager` 里先 `remove_bundle @local/dafeiyu`，再 `install_bundle target=...tgz`。
- 版本面板里可以「留一个快照」、看历史快照、点「回滚」。回滚只覆盖插件源码，不动数据目录。

## 已知边界

- 内嵌网页可能被对方 `X-Frame-Options` / `CSP` 挡住，这时用「浏览器打开」。
- Office 预览靠 DSH 自带的 LibreOffice 引擎；引擎起不来就用「外部打开」。
- 提交记录只读：能看 GitHub 公开仓库或本地 `git log`，私有仓库要设 `GITHUB_TOKEN`。
- AI 面板的对话只是轻量文本视图，完整工具过程请回到主工作区看。

## 开发与打包

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-tgz.ps1
```

产物在上层目录（`dafeiyu-<version>.tgz`），同时把最近的 `git log` 写进 `gitlog.json` 一起打包，装好后版本面板离线也能看提交记录。
