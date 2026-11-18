# 得到大脑 Get笔记 · Obsidian 插件

把「得到大脑（Get笔记）」搬进 Obsidian。**本地优先**：笔记就是你自己库里的 Markdown 文件，
浏览、搜索、编辑、删除全部离线可用；云端同步、录音卡导入是需要时再打开的增强项。

> 这是 [dsh-getnote](https://github.com/magicbaobaoli/dsh-getnote)（DeepSeek Harness 版）的 Obsidian 移植。
> 功能对齐，但宿主不同：那边挂在 DSH 的 webServer 上，这边是一个标准 Obsidian 插件。

---

## 功能

### 本地笔记库

- **三栏面板**：目录树 / 笔记列表 / 正文，支持按目录、标签、关键词过滤，两种排序。
- **Markdown 原样渲染**：标题、列表、表格、引用、代码块、任务清单、内嵌图片与音频。
- **编辑与保存**：面板内直接改正文并保存；每次保存前自动在 `.history/` 留一份快照，可回滚。
- **新建 / 删除**：新建可指定目录与日期前缀；删除进 `.trash/`，可还原、可彻底清除。
- **搜索**：全文搜索，支持 `tag:` 与 `path:` 限定语法，结果带上下文片段。
- **反链与大纲**：`[[wikilink]]` 反链、标题大纲、冲突文件（`.conflicts/`）识别与解决。
- **标签**：重命名、删除、批量改写，标签面板带计数。
- **热力图**：按天统计的写作/导入活动。

### 云端同步（可选）

两条通道，任选其一或自动回退：

| 通道 | 凭证 | 说明 |
| --- | --- | --- |
| **Open API** | API Key + Client ID + Grant ID | 直接调 `openapi.biji.com`，最省事 |
| **MCP / OAuth** | 浏览器授权（PKCE） | 走 RFC 7591 动态注册，不需要手动申请 Key |

- 单向拉取（云端 → 本地）与逐条推送（本地 → 云端）。
- 图片可选一起下载到 `asset/`。
- 定时自动同步：可设间隔（5–720 分钟）、增量模式、仅面板可见时同步。
- 首次调用失败会自动从 Open API 回退到 MCP 通道，并在状态里标注失败原因。

### 录音卡导入（可选，需 Python）

- **蓝牙直连**：扫描、读取信息、按文件列表导入、按需删除卡内文件。
- **Wi-Fi 传输**：让卡开热点或连你的路由器，走 HTTP 拉取，比蓝牙快得多。
- 导入后自动按日期与标题命名，写进库并生成 Markdown 笔记；可配置「导入后删卡内文件」。

> 录音卡直连需要 **Python 3.10+** 和 `bleak` 包（`pip install bleak`）。
> 插件会在设置页检测环境，缺什么会直接告诉你。蓝牙是**只读**的：
> 默认永不发送「清理已传输文件」指令，只在你显式勾选「导入后删除」时按文件名删除。

### 其它

- **归档包**：整库导出为 zip、从 zip 导入（可选合并/覆盖模式）。
- **模板**：保存常用正文模板，新建时一键套用（最多 12 个）。
- **多语言**：中文 / English / Nederlands。
- **主题**：跟随 Obsidian 主题，深浅色自动适配。

---

## 安装

### 手动安装（推荐，暂未上架社区市场）

1. 下载 `main.js`、`manifest.json`、`styles.css`，以及 `card/`、`locale/` 两个目录。
2. 放进 `<你的库>/.obsidian/plugins/getnote-obsidian/`。
3. Obsidian 设置 → 第三方插件 → 关闭安全模式 → 启用「得到大脑 Get笔记」。

> `card/` 是录音卡用的 Python 桥脚本，`locale/` 是界面文案。**这两个目录必须一起放**，
> 缺了不影响本地笔记功能，但录音卡与多语言会不可用。

### 从源码构建

```bash
npm install
npm run build      # 产出 main.js，并把 card/ 与 locale/ 复制到插件根
npm test           # 538 项离线测试
```

开发时用 `npm run dev` 进入 watch 模式。

---

## 使用

启用后左侧边栏出现大脑图标，点开即面板；也可以用命令面板：

- `得到大脑：打开面板` —— 在当前工作区打开。
- `得到大脑：在新窗口打开` —— 弹独立窗口，适合双屏。

**第一次用请先设置笔记目录**（设置 → 得到大脑）。默认是库根下的 `得到大脑/`，
你可以改成库内任意目录，插件会自己建。

### 关于本地服务

面板里的图片与音频是浏览器原生资源加载（`<img>` / `<audio>`），
需要真实的 HTTP 地址才能支持 Range 拖动播放，所以插件启动时会在
`127.0.0.1` 上开一个**只绑回环地址**的小服务（端口由系统分配，会记住上次的）。

- 它只监听 `127.0.0.1`，局域网内其它机器访问不到。
- 关闭插件即关闭服务。
- OAuth 登录的回调也走这个地址，所以授权时浏览器要能访问本机。

---

## 与 DSH 版的差异

| | DSH 版 | Obsidian 版 |
| --- | --- | --- |
| 宿主 | 挂在 DSH `webServer` 的 `/getnote` 前缀路由 | 自带 `127.0.0.1` 回环服务 |
| 库的选择 | 可指向任意绝对路径 | 只能选当前库内的子目录（写入走 `app.vault.adapter`） |
| 界面 | React 三栏，注册进 DSH 的 slot 系统 | 同一个 React 面板，装进 Obsidian `ItemView` |
| 主题 | `--dsw-alias-*` 变量 | 同一批变量映射到 Obsidian 的 `--background-primary` 等 |
| 录音卡 | 同 | 同，但必须 `isDesktopOnly`（要起子进程） |

之所以「不能直接复制」，主要就在这几层接线；核心逻辑（vault / archive / history /
cloud-sync / openapi / biji / card 与 Python 桥）是同一份代码，测试也是同一套。

---

## 目录结构

```
src/
  main.js            插件入口：加载设置、起服务、注册视图与命令
  host/server.js     127.0.0.1 回环 HTTP 服务（CORS + Range）
  core/
    service.js       /getnote/* 全部路由（从 DSH 版原样搬来）
    vfs.js           文件系统适配层：绝对路径 → app.vault.adapter
    vault.js         笔记库算法（扫描、搜索、冲突、历史、标签……）
    settings.js      设置读写（存插件数据目录，不进库）
    net.js           用 node:http 实现的 fetch 兼容层（绕开渲染进程 CORS）
    openapi.js  biji.js  mcp-cloud.js  cloud-sync.js  sync.js
    archive.js  history.js  card.js
  view/
    panel.js         React 面板（从 DSH 版机械移植）
    view.js          ItemView 外壳
  card/*.py          录音卡 Python 桥（蓝牙 / Wi-Fi）
  locale/*.json      界面文案
```

---

## 测试

```bash
npm test
```

覆盖：vault 算法（110 项）、归档包（57 项）、历史快照（46 项）、同步合并（66 项）、
**9 项文件系统适配层验收**（`app.vault.adapter` 与 `node:fs` 的语义差异：`list()` 回裸文件名
还是完整路径都得吃得住、`mkdir` 不建父目录要自己逐级补齐、删目录得走 `rmdir(recursive)`
而不是 `remove`）、**236 项 HTTP 路由验收**（真起服务、真打请求、真读文件，含 Range 206/416、路径逃逸拒绝、
凭证打码、定时同步边界、录音卡环境探测等）、**6 项启动验收**——把打包后的 `main.js`
真的 `require` 起来，用假的 `obsidian` 模块与内存 adapter 驱动 `onload`（库根故意用
带中文和空格的临时目录，跟真实用户路径一致），确认视图/命令/服务都注册成功、
写入真的走 `app.vault.adapter` 而不是直接落盘、插件状态只落在
`.obsidian/plugins/<id>` 里——
**4 项面板渲染验收**：用 jsdom 造浏览器环境，把 8000 行的 React 面板真渲染出来，
确认它不掉进错误边界、发出的请求全部指向本地服务、六个标签页逐个切换都不炸——
以及 **4 项视图层验收**：同样在 jsdom 里 new 一个真的 `ItemView` 并调 `onOpen`，
确认面板确实挂进了 Obsidian 的 `contentEl`、样式只注入一份、心跳注册上了，
关掉叶子时 React 树被卸载干净、不留残余节点。

全部离线，不碰网络也不碰你的真实库。

---

## 已知限制

- **仅桌面端**：录音卡要起 Python 子进程，移动端不可用。
- **录音卡导入依赖系统 Python**，且 `bleak` 版本需支持你的系统蓝牙栈。
- Wi-Fi 传输的 IP 探测依赖 `netsh`（Windows），其它平台回退到系统路由表。
- 云端接口是「得到大脑」的非公开 API，可能随对方调整而变化；凭证只存在本地。

## 许可

MIT
