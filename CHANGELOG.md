# 更新日志

## 0.1.0

首个版本。功能对齐 DSH 版 `dsh-getnote` 0.6.8。

### 新增

- **本地笔记库面板**：目录树 / 列表 / 正文三栏，Markdown 渲染，编辑保存，新建删除，回收站还原。
- **搜索**：全文搜索，支持 `tag:` / `path:` 限定，结果带上下文。
- **反链 / 大纲 / 标签管理 / 热力图 / 冲突解决 / 历史快照回滚**。
- **归档包**：整库导出 zip、从 zip 导入（合并或覆盖）。
- **模板**：最多 12 个正文模板，新建时套用。
- **云端同步**：Open API 与 MCP/OAuth 双通道，自动回退；单向拉取 + 逐条推送；定时自动同步（5–720 分钟，可增量、可仅面板可见时）。
- **录音卡**：蓝牙扫描 / 信息 / 列表 / 导入 / 按名删除，Wi-Fi 热点激活与传输。
- **多语言**：中文 / English / Nederlands。
- **主题**：22 个主题变量映射到 Obsidian 原生配色，深浅色自动适配。

### 与 DSH 版的实现差异

- 宿主接线层重写：`ctx.slots` + `webServer` 前缀路由 → `ItemView` + 自带 `127.0.0.1` 回环服务。
- 新增 `src/core/vfs.js` 文件系统适配层，上层 API 不变，底层走 `app.vault.adapter`，让 Obsidian 感知写入。
- 新增 `src/core/net.js`，用 `node:http` 实现 fetch 兼容层，绕开渲染进程的 CORS 限制并支持自定义 `Referer`。
- 设置改为存插件数据目录（`data.json` 同级的 `dsh-getnote*.json`），不再写用户主目录。
- 「库根」改为「库内子目录」：Obsidian 不允许插件把笔记写到库外。
- OAuth 回调改为本机回环地址，端口变化时自动重新注册 client；端口会在首次启动后记进设置，之后优先复用，让 `redirect_uri` 跨会话稳定。
- 授权页改用系统浏览器打开（注入 `electron.shell.openExternal`），不再依赖渲染进程里的 `window.open`。
- 本地服务补 `Access-Control-Allow-Private-Network` 预检头：渲染进程的源是 `app://obsidian.md`，访问 `127.0.0.1` 属 Chromium 的 Private Network Access，缺这个头会让面板里所有接口在浏览器层被拦掉。
- 录音卡桥脚本路径改为可注入（`configureCardScripts`），不再依赖 `import.meta.url`。

### 测试

- 524 项离线测试：vault 算法 110 项、归档包 57 项、历史 46 项、同步 66 项、
  236 项 HTTP 路由验收、5 项启动验收（真加载打包产物 + 假 obsidian 模块 + 内存 adapter，
  库根用带中文与空格的临时目录，同时验「库内写入只走 adapter」与「插件状态只落插件目录」），
  以及 4 项面板渲染验收（jsdom 真渲染 React 面板）。
