/*
 * 得到大脑 · Obsidian 插件入口
 *
 * 与 DSH 版的关系：核心逻辑（vault / openapi / cloud-sync / card / archive …）
 * 是同一套代码，改的只有「宿主接线」这一层——
 *
 *   DSH 版                          Obsidian 版
 *   ─────────────────────────────   ────────────────────────────────
 *   ctx.slots.register 挂 React 面板   ItemView + ribbon + command
 *   webServer.register 挂 /getnote     自己起 127.0.0.1 回环服务（host/server.js）
 *   $DSH_HOME 存凭证                    插件数据目录（loadData/saveData 之外用文件）
 *   node:fs 直接读写笔记                app.vault.adapter（vfs.js 翻译路径）
 *   ctx.effect 清理                     onunload
 */

import { FuzzySuggestModal, Menu, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as settingsStore from './core/settings.js'
import {
  configure as configureVfs,
  access as vfsAccess,
  mkdir as vfsMkdir,
  readFile as vfsRead,
  writeFile as vfsWrite,
} from './core/vfs.js'
import { configureCardScripts } from './core/card.js'
import { setDebugLogging } from './core/log.js'
import {
  backlinkSnippets,
  invalidateScan,
  linkNamesOf,
  normalizeAliases,
  parseFrontmatter,
  scanVault,
} from './core/vault.js'
import { basesTemplate, parseCanvas, addFileNode, serializeCanvas } from './core/integrations.js'
import { startAutoSync, startCardAutoImport, markPanelVisible } from './core/service.js'
import { startLocalServer } from './host/server.js'
import {
  setApiOrigin,
  setApiToken,
  setOpenExternal,
  setSaveFile,
  setNoteMenu,
  setHostLocale,
  requestIntent,
  setSyncReport,
  setConfirmDialog,
  setOpenInEditor,
  setMarkdownLink,
  setAssetUrl,
  setRevealInVault,
  setDailyNote,
  setLinkResolve,
  setNewNotePlacement,
  setOpenAsset,
  setDailyTemplate,
  setRenameNote,
  setVaultGraph,
  setStatusReport,
  notifyCssChange,
  notifyVaultChange,
} from './view/panel.js'
import { GetnoteView, VIEW_TYPE_GETNOTE, PanelIcon } from './view/view.js'
import { setHoverSource } from './view/markdown.js'

const DEFAULT_SUBFOLDER = '得到大脑'

// 刚写下的文件，宿主的索引还没跑到它身上时，「没人引用」和「还没收录」看起来
// 一模一样。这段时间内宁可不替宿主下结论，让面板走一次本地扫描。
const FRESH_INDEX_MS = 30000

export default class GetnoteObsidianPlugin extends Plugin {
  async onload() {
    // 库根的绝对路径：vfs.js 靠它把「绝对路径」翻译成 adapter 认的库内相对路径。
    const adapter = this.app.vault.adapter
    const basePath = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : ''
    const dataDir = this.resolveDataDir(basePath)

    // 面板默认跟随宿主界面语言。用户在面板里显式选过语言就以他的为准，
    // 这里只是把「宿主现在说的是什么语言」告诉面板。
    try {
      // eslint-disable-next-line global-require
      const moment = typeof require === 'function' ? require('moment') : null
      setHostLocale(moment && typeof moment.locale === 'function' ? moment.locale() : null)
    } catch {
      setHostLocale(null)
    }

    settingsStore.configure({ dataDir, vaultBase: basePath, subfolder: DEFAULT_SUBFOLDER })
    configureVfs({ adapter, basePath })

    // 启动即落一份心跳文件。用户报「面板全黑、一个字都没有」时，最难的从来不是
    // 修，而是先分清问题在哪一层：插件根本没加载？加载了但视图没挂上？视图挂了
    // 但面板首帧没渲染？这三种在屏幕上长得一模一样，而渲染进程的控制台用户多半
    // 不会去翻。所以在最早能拿到 adapter 的地方写一行，之后每推进一层再追加一行。
    this.probe('onload 开始')

    // 录音卡的 Python 桥脚本跟 main.js 一起装在插件目录里（构建时复制到 card/）。
    configureCardScripts({ baseDir: dataDir })

    // OAuth 授权必须落到系统浏览器：渲染进程里的 window.open 在 Electron 里
    // 行为不可靠。Obsidian 桌面版能拿到 electron 的 shell，直接交给它。
    setOpenExternal((url) => {
      try {
        // eslint-disable-next-line global-require
        const electron = typeof require === 'function' ? require('electron') : null
        if (electron && electron.shell && typeof electron.shell.openExternal === 'function') {
          void electron.shell.openExternal(url)
          return true
        }
      } catch {
        // 拿不到 electron（比如测试环境）就返回 false，让面板退回 window.open
      }
      return false
    })

    // 整库导出：面板点「导出」时走这里。
    //
    // 为什么不用 a[download]：Electron 的下载管理器在 Obsidian 里没被接管，
    // 点了可能静默什么都不发生。渲染进程也拿不到 electron 的 dialog（那是主进程
    // 模块）。所以这里自己把 zip 拉下来写到临时目录，再在系统文件管理器里定位到
    // 它——用户拿到的是真文件，而不是一个可能没反应的下载动作。
    setSaveFile(async (url, filename) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`导出失败：HTTP ${res.status}`)
      const bytes = Buffer.from(await res.arrayBuffer())
      const dir = join(tmpdir(), 'getnote-export')
      await mkdir(dir, { recursive: true })
      const target = join(dir, filename)
      await writeFile(target, bytes)
      try {
        // eslint-disable-next-line global-require
        const electron = typeof require === 'function' ? require('electron') : null
        if (electron && electron.shell && typeof electron.shell.showItemInFolder === 'function') {
          electron.shell.showItemInFolder(target)
        }
      } catch {
        // 拿不到 electron 就只弹提示，路径照样给出去
      }
      new Notice(`得到大脑：归档包已导出到 ${target}`)
      return true
    })

    // 笔记卡片的右键菜单走 Obsidian 原生 Menu：位置、键盘导航、样式都由宿主负责，
    // 面板只需要给一份「标签 + 动作」的清单。拿不到 Menu（离线测试）就返回 false，
    // 面板会退回自己的简易菜单。
    setNoteMenu((event, items) => {
      if (typeof Menu !== 'function') return false
      const menu = new Menu()
      for (const item of items) {
        menu.addItem((entry) => {
          entry.setTitle(item.label)
          if (item.danger === true) entry.setIcon('trash')
          entry.onClick(() => {
            item.run()
          })
        })
      }
      menu.showAtMouseEvent(event)
      return true
    })

    // 确认框走 Obsidian 自己的 Modal。
    //
    // 面板里原本用 window.confirm：它在 Electron 里能用，但长得跟宿主完全不搭，
    // 移动端 WebView 还可能根本不弹——删除、清空这种不可逆的动作就没有二次确认了。
    // Modal 由宿主渲染，键盘焦点、遮罩、Esc 都由 Obsidian 管。
    setConfirmDialog((message) => this.askConfirm(message))

    // 「在 Obsidian 里打开」：面板的编辑器够用来看和改正文，但没有补全、没有
    // Vim、没有别的插件挂上来的命令。真要动结构的时候，得把用户送回宿主编辑器。
    setOpenInEditor((path) => this.openInVaultEditor(path))
    // 「复制引用」用宿主自己的链接格式：用户偏好 Wiki 链接还是 Markdown 链接、
    // 路径写全还是写短，只有 app.fileManager 知道。
    setMarkdownLink((path) => this.markdownLinkFor(path))
    // 图片、录音的地址交给宿主：adapter.getResourcePath() 给的是宿主资源协议下的
    // 地址，浏览器直接能加载，还吃宿主的缓存与 Range 处理。
    setAssetUrl((path) => this.assetUrlFor(path))
    // 「在文件列表里定位」：面板的列表是平的，用户想知道这一篇在库里挨着什么，
    // 只有宿主自己的文件列表说得清。
    setRevealInVault((path) => this.revealInVaultItem(path))
    // 「今天」落在哪一篇由宿主的日记核心插件决定：那边已经配好目录和文件名格式，
    // 我们再拼一套只会在同一个库里造出第二个「今天」。
    setDailyNote(() => this.dailyNoteRel())
    setLinkResolve((linkpath, sourcePath) => this.linkResolveFor(linkpath, sourcePath))
    setNewNotePlacement(() => this.newNoteDir())
    // 面板里的图片点了交给宿主：宿主有自己的图片视图（缩放、翻页），比在面板里
    // 再塞一个全屏浮层更符合 Obsidian 用户的习惯。
    setOpenAsset((path) => this.openAssetInVault(path))
    // 「今天」新建时填宿主配好的日记模板：那边已经有骨架了，再让用户在我们这儿
    // 配一遍，同一个库里就会出现两种「今天的日记」。
    setDailyTemplate(() => this.dailyTemplateContent())
    // 改名交给宿主：它改的时候会顺手把全库的双链、Markdown 链接一起改掉。
    // 我们自己 rename 文件的话，别的笔记里的 [[旧名字]] 会静默变成死链。
    setRenameNote((path) => this.renameNoteInVault(path))

    // 反链、出链交给宿主的 metadataCache。
    //
    // Obsidian 本来就在增量维护整库的链接图（它就是靠这个画关系图谱、做双链补全的），
    // 我们再读一遍全库正文去正则匹配 [[...]]，等于把同一件事干第二遍。库大了之后
    // 这个差别是「点一下立刻出」和「等一秒」的差别。问不到（链接还没被索引、文件
    // 刚写下去）时面板会自己退回本地扫描，所以这里拿不准就返回 null。
    // 反链底下那行上下文得读引用方的正文，所以反链这一条是异步的；面板那边拿到
    // Promise 会等它落地再渲染。出链不用（就在这一篇正文里，/read 早算好了），
    // 保持同步，免得为一行不需要的东西多绕一个微任务。
    setVaultGraph((path, kind) =>
      kind === 'backlinks' ? this.vaultGraphWithSnippets(path, kind) : this.vaultGraphOf(path, kind),
    )

    // 状态栏文案跟着面板里的实际情况走：只有「得到大脑」四个字，用户既不知道
    // 库有多大，也不知道面板里开着哪一篇。状态栏是他唯一一直看得见我们的地方。
    setStatusReport((info) => this.updateStatusBar(info))

    const stored = await settingsStore.readSettings()
    // 详细日志默认关。设置里打开过就在 onload 就生效，不必等用户进设置页。
    this.debugLogging = stored.debugLogging === true
    setDebugLogging(this.debugLogging)
    this.cardAutoImport = stored.cardAutoImport === true
    // 跟着宿主切换笔记：默认关。开着时用户在 Obsidian 里翻到哪一篇，面板就
    // 跟着打开同一篇（面板没开着就不去开它，免得用户只是翻笔记却被弹一个面板）。
    this.followActive = stored.followActive === true
    if (stored.subfolder && stored.subfolder !== DEFAULT_SUBFOLDER) {
      settingsStore.configure({ subfolder: stored.subfolder })
    }

    // 笔记目录不存在时建出来。不建的话面板一进来就是「本地库目录不存在」，
    // 用户还得自己先去资源管理器建个文件夹——第一次用的体验会莫名其妙。
    // 用 vfs 而不是 node:fs，这样 Obsidian 的文件索引能立刻看到新目录。
    // resolveVaultRoot 是 async 的：少一个 await，拿到的是 Promise，`.root` 于是是
    // undefined，vfs 的 relOf 会把它当「越界的绝对路径」直接抛错 —— 报出来的那句
    // 「笔记目录建不出来 —— path escapes vault root: undefined」看着像磁盘权限问题，
    // 其实只是这里少了一个 await。
    const vaultRoot = (await settingsStore.resolveVaultRoot()).root
    // 这两行是排障用的：库根是空串（宿主没给 getBasePath）时，下面 mkdir 会拿到
    // 一条绝对路径，adapter 只认库内相对路径，报出来的错和「磁盘没权限」长得一样。
    this.probe(`库根 ${basePath === '' ? '(空)' : basePath}，笔记目录 ${vaultRoot}`)
    try {
      await vfsMkdir(vaultRoot, { recursive: true })
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      this.probe(`笔记目录建不出来：${message}`)
      new Notice(`得到大脑：笔记目录建不出来 —— ${message}`)
    }

    // 端口优先固定，OAuth 的 redirect_uri 才能跨会话稳定；被占用时退回随机端口。
    const preferredPort = Number(stored.localPort) > 0 ? Number(stored.localPort) : 0
    try {
      this.server = await startLocalServer({ preferredPort })
      setApiOrigin(this.server.origin)
      // 令牌由服务自己随机生成（每次启动都换），面板每个请求都要带。
      setApiToken(this.server.token)
      this.localPort = this.server.port
      this.probe(`本地服务已就绪 http://127.0.0.1:${this.localPort}`)
      // 用户指定的端口没抢到：OAuth 的 redirect_uri 会跟着变，值得说一句。
      // 设置页的状态行里也写着，但用户不一定会去看设置页——第一次撞上时弹一次
      // Notice，让他知道「为什么云端要我重新登录」。
      this.portFallback = this.server.portFallback === true
      if (this.portFallback) {
        new Notice(
          `得到大脑：端口 ${preferredPort} 被别的程序占着，这次改用 ${this.server.port}。` +
            '云端授权（OAuth）的回调地址跟着变了，可能需要重新登录一次。',
          8000,
        )
      }
      // 记住这次真正用上的端口：下次启动优先复用它，OAuth 的 redirect_uri
      // 才能跨会话稳定（服务端是按 redirect_uri 注册的 client）。
      if (this.localPort !== preferredPort) {
        await this.saveLocalPort(this.localPort)
      }
    } catch (error) {
      // 起不来也不能让整个插件挂掉：面板会显示「服务未就绪」，其余功能（设置页）还能用。
      this.server = null
      this.localPort = 0
      this.portFallback = false
      this.probe(`本地服务启动失败：${error && error.message ? error.message : error}`)
      new Notice(`得到大脑：本地服务启动失败 —— ${error && error.message ? error.message : error}`)
    }

    this.registerView(VIEW_TYPE_GETNOTE, (leaf) => new GetnoteView(leaf, this))
    this.probe('视图已注册')

    const ribbon = this.addRibbonIcon('brain', '得到大脑', () => { void this.activateView() })
    ribbon.addClass('dshgn_ribbon')

    this.addCommand({
      id: 'open-panel',
      name: '打开得到大脑面板',
      callback: () => { void this.activateView() },
    })
    this.addCommand({
      id: 'open-in-new-window',
      name: '在新窗口打开得到大脑',
      callback: () => { void this.activateView(true) },
    })

    // 命令面板入口。面板里能干的事，不该只有「打开面板」一条路——
    // 用户想搜索时第一反应是 Ctrl+P 敲「搜索」，而不是先打开面板再点搜索框。
    // 这里的每个命令都只投递意图，真正的动作由面板自己完成（它才拿得到状态）。
    const intentCommand = (id, name, intent) => {
      this.addCommand({
        id,
        name,
        callback: () => {
          void this.activateView().then(() => requestIntent(intent))
        },
      })
    }
    intentCommand('search-notes', '搜索得到大脑笔记', { type: 'search' })
    intentCommand('new-note', '新建得到大脑笔记', { type: 'new' })
    intentCommand('open-today', '打开今天的笔记', { type: 'today' })
    intentCommand('sync-now', '立即同步得到大脑', { type: 'sync' })
    intentCommand('scan-card', '扫描录音卡', { type: 'card' })

    // 选区速记：编辑器里选中一段文字，命令面板敲「速记」就落成一篇笔记。
    // 没有选中时拿当前整行/整段——用户按下命令的那一刻总得有点东西可摘。
    this.addCommand({
      id: 'capture-selection',
      name: '把选中的文字存进得到大脑',
      editorCallback: (editor, view) => {
        this.captureFromEditor(editor, view)
      },
    })

    // 快速切换器（Ctrl/Cmd+O）里的「打开得到大脑笔记」。
    //
    // 这一条是这个插件在 Obsidian 里最容易被忽略的入口：用户找笔记的第一反应
    // 是快速切换器，而不是 ribbon 或者命令面板。把它接上，库里的笔记就跟宿主
    // 自己的笔记一样能被搜到、能一键跳进来。
    this.addCommand({
      id: 'quick-switch-note',
      name: '快速切换：打开得到大脑笔记',
      callback: () => { void this.quickSwitchNote() },
    })

    // 「跟随当前笔记」：正在 Obsidian 里读或改一篇，想看看它在得到大脑里的样子
    // （反链、同步状态、历史版本、附件），按一下就把面板切到同一篇。
    // 没有这条命令时，用户得自己回面板、翻目录、找到同名的那篇——笔记一多就找不着。
    this.addCommand({
      id: 'open-active-note',
      name: '在得到大脑里打开当前笔记',
      callback: () => { void this.openActiveNote() },
    })

    // 与 Bases / Canvas 的衔接：两者都只生成一份文件，不碰内部 API。
    this.addCommand({
      id: 'create-bases-view',
      name: '在笔记目录里生成一个 Bases 视图',
      callback: () => { void this.createBasesView() },
    })
    this.addCommand({
      id: 'add-to-canvas',
      name: '把当前笔记放进得到大脑画布',
      editorCallback: (editor, view) => {
        const path = view && view.file && typeof view.file.path === 'string' ? view.file.path : ''
        if (path === '') {
          new Notice('得到大脑：先打开一篇笔记')
          return
        }
        void this.addNoteToCanvas(path)
      },
    })

    // obsidian://getnote?... 深链：从浏览器、其他应用、快捷指令直接唤起面板。
    // 只做导航不做写操作——一个能被任意网页触发的 URL 不该有删笔记的能力。
    if (typeof this.registerObsidianProtocolHandler === 'function') {
      this.registerObsidianProtocolHandler('getnote', (params) => {
        void this.handleDeepLink(params)
      })
    }

    // 页面预览（hover-link）：鼠标停在面板正文里的 [[双链]] 上，让宿主弹预览卡片。
    // 宿主要求先登记一个来源 id，否则它不知道用哪套规则预览，事件会被静默丢掉。
    // 老版本宿主没有这个方法，跳过即可——面板照常能用，只是没有预览。
    if (typeof this.registerHoverLinkSource === 'function') {
      try {
        this.registerHoverLinkSource('getnote-brain', { display: '得到大脑', defaultMod: false })
        setHoverSource('getnote-brain')
      } catch {
        // 登记失败就当作没有预览
      }
    }

    // 状态栏：一个能看见「插件在跑、服务在哪个端口」的小字，点一下打开面板。
    // 没有它，用户遇到问题（比如端口被占）时完全没有线索。
    if (this.server) {
      this.statusBarEl = this.addStatusBarItem()
      this.statusBarEl.addClass('dshgn_status')
      this.statusBarEl.setText('得到大脑')
      // 文案与 tooltip 分开：文案随面板里的库大小变化（见 updateStatusBar），
      // tooltip 说明服务在哪个端口，两件事互不覆盖。
      this.statusBarEl.title = `本地服务 http://127.0.0.1:${this.localPort}${
        this.portFallback ? '（想要的端口被占用，这次是系统分配的）' : ''
      }`
      this.registerDomEvent(this.statusBarEl, 'click', () => { void this.activateView() })
    }

    this.addSettingTab(new GetnoteSettingTab(this.app, this))

    // 库变了就让扫描缓存失效。
    //
    // scanVault 的缓存键是「全库文件的 mtime + size 指纹」，所以它本来就不会
    // 给出过期的数据——但算指纹本身要遍历一遍目录。用户在 Obsidian 里正常
    // 编辑笔记（不走我们面板）时，文件事件会告诉我们「变了」，这时直接把整库
    // 那一层丢掉，下一次扫描只需重新读变过的那几篇（逐文件记忆还在）。
    // 这是纯优化：即使事件漏了，指纹比较仍然保证不会读到旧内容。
    const bump = () => invalidateScan()
    this.registerEvent(this.app.vault.on('modify', bump))
    this.registerEvent(this.app.vault.on('create', bump))
    this.registerEvent(this.app.vault.on('delete', bump))
    this.registerEvent(this.app.vault.on('rename', bump))

    // 同时把「哪一篇、什么动作」转给面板。
    //
    // 缓存失效解决的是「下一次扫描读到什么」，解决不了「屏幕上已经显示的旧正文」：
    // 用户在宿主编辑器里改了当前这篇，面板不重新读就一直停在上一个版本。
    // 面板自己保存的那一下也会走到这里，它会靠正文相同把这次重读跳过。
    const tellPanel = (kind) => (file, oldPath) => {
      const path = this.notePathInVault(file)
      if (path === '') return
      notifyVaultChange({ kind, path, oldPath: typeof oldPath === 'string' ? oldPath : '' })
    }
    this.registerEvent(this.app.vault.on('modify', tellPanel('modify')))
    this.registerEvent(this.app.vault.on('create', tellPanel('create')))
    this.registerEvent(this.app.vault.on('delete', tellPanel('delete')))
    this.registerEvent(this.app.vault.on('rename', tellPanel('rename')))

    // 宿主换主题（或改字体、字号、界面缩放）会发 css-change。面板的配色是按
    // 宿主的 CSS 变量现场推导的，收到就得重算一遍——比 MutationObserver 盯
    // body 的 class 更准：换字体、调字号这些不改 class 的情况也能收到。
    this.registerEvent(this.app.workspace.on('css-change', () => notifyCssChange()))

    // 跟着宿主切换笔记。
    //
    // 用 'file-open' 而不是 'active-leaf-change'：后者在切到一个空叶子、点开
    // 侧边栏、拖分栏时也会发，那些时刻根本没有「哪一篇」可跟，还得再判一次。
    // file-open 只在真的有一篇笔记成为当前笔记时发。
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        void this.followActiveNote(file)
      }),
    )

    // 宿主右键菜单里的入口。
    //
    // 用户在文件树里右键一篇笔记、在编辑器里选中一段文字时，顺手就能进得到大脑，
    // 不必先想起「那个面板在哪个按钮后面」。file-menu / editor-menu 是 Obsidian
    // 自己的事件，我们只往里加条目，不接管菜单本身——别的插件的条目照旧。
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!menu || typeof menu.addItem !== 'function') return
        const rel = this.notePathInVault(file)
        if (rel === '') return
        menu.addItem((item) => {
          item.setTitle('在得到大脑里打开')
          item.setIcon('brain')
          item.onClick(() => {
            void this.activateView().then(() => requestIntent({ type: 'open', path: rel }))
          })
        })
      }),
    )
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, view) => {
        if (!menu || typeof menu.addItem !== 'function' || !editor) return
        const selection =
          typeof editor.getSelection === 'function' ? String(editor.getSelection() || '') : ''
        menu.addItem((item) => {
          item.setTitle(
            selection.trim() === '' ? '把这一行存进得到大脑' : '把选中的文字存进得到大脑',
          )
          item.setIcon('brain')
          item.onClick(() => {
            this.captureFromEditor(editor, view)
          })
        })
      }),
    )

    // 一轮同步跑完之后，把「今天补进来几篇」写进当天的日记。
    //
    // 为什么放在宿主而不是面板：日记在哪、叫什么名字，是 Obsidian 的日常笔记
    // 配置说了算，面板不该去猜。写不进去（没有日常笔记插件、路径不存在）就
    // 安静跳过——同步本身已经完成了，不能因为摘要失败去打扰用户。
    setSyncReport((result) => {
      void this.appendSyncReport(result)
    })

    // 自动同步：DSH 版由 ctx.effect 托管，这里由 onunload 托管
    this.stopAutoSync = startAutoSync()
    // 录音卡插上就导。定时器一直转着，真正的开关在设置里（cardAutoImport），
    // 关着的时候每次 tick 只读一个 JSON 就返回，代价可以忽略。
    this.stopCardAutoImport = startCardAutoImport()
  }

  /**
   * 把 obsidian://getnote?... 的参数翻成一条面板意图。
   *
   * 认得的只有「导航」，没有「写」：深链可以被任意网页、聊天窗口里的链接触发，
   * 一个能被别人一点就删笔记的 URL 是不能接受的。所以这里只有 open / search /
   * new / today / sync 五种，其余一律返回 null（等于「只把面板打开」）。
   *
   * path 两种写法都收：库内相对路径（`得到大脑/随手记/甲.md`，从别的笔记里复制
   * 出来的就是这种）和面板口径（`随手记/甲.md`）。后者本来就不以笔记目录开头，
   * 剥前缀那一步碰不到它，所以不用先判断是哪一种。
   */
  deepLinkIntent(params) {
    const action = params && typeof params.action === 'string' ? params.action : 'open'
    const query = params && typeof params.q === 'string' ? params.q : ''
    if (action === 'search') return { type: 'search', q: query }
    if (action === 'new') return { type: 'new' }
    if (action === 'today') return { type: 'today' }
    if (action === 'sync') return { type: 'sync' }
    if (action !== 'open') return null
    const raw = params && typeof params.path === 'string' ? params.path.replace(/\\/g, '/').replace(/^\/+/, '') : ''
    if (raw === '' || !raw.toLowerCase().endsWith('.md')) return null
    const runtime = settingsStore.getRuntime()
    const sub = String(runtime.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, '')
    const path = sub !== '' && raw.startsWith(sub + '/') ? raw.slice(sub.length + 1) : raw
    if (path === '') return null
    return { type: 'open', path }
  }

  /**
   * 接住一条深链：先把面板叫起来，再把意图投过去。
   *
   * 顺序不能反：意图总线在没有监听者时会暂存，但面板挂载时取走的那一份只有一条，
   * 而 activateView 期间用户可能已经点了别的动作——先开面板再投递，投递的这份
   * 一定落在活着的监听者手里。
   */
  async handleDeepLink(params) {
    const intent = this.deepLinkIntent(params)
    try {
      await this.activateView()
    } catch {
      // 面板开不出来也要把意图留住：下次面板挂载时会取走
    }
    if (intent !== null) requestIntent(intent)
  }

  /**
   * 把宿主的库内路径翻成面板里的笔记路径（相对笔记子目录）。
   *
   * 宿主的 file.path 是库内相对路径（`得到大脑/随手记/甲.md`），而面板的
   * entry.path 相对的是笔记目录本身。不在笔记目录里的文件一律返回空串——
   * 右键菜单不该对无关文件冒出我们这一条。
   */
  notePathInVault(file) {
    const raw = file && typeof file.path === 'string' ? file.path.replace(/^\/+/, '') : ''
    if (raw === '' || !raw.toLowerCase().endsWith('.md')) return ''
    const runtime = settingsStore.getRuntime()
    const sub = String(runtime.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, '')
    if (sub === '') return raw
    if (raw === sub) return ''
    if (!raw.startsWith(`${sub}/`)) return ''
    return raw.slice(sub.length + 1)
  }

  /**
   * 把编辑器里选中的文字（没选就是当前行）存成一篇笔记。
   *
   * 命令面板的「把选中的文字存进得到大脑」和编辑器右键菜单走的是同一条路，
   * 所以抽出来一份——两边行为不一致的话，用户会以为右键那条是坏的。
   */
  captureFromEditor(editor, view) {
    if (!editor) return false
    const selection = typeof editor.getSelection === 'function' ? String(editor.getSelection() || '') : ''
    const cursor = typeof editor.getCursor === 'function' ? editor.getCursor() : null
    const text =
      selection.trim() !== ''
        ? selection
        : cursor !== null && typeof editor.getLine === 'function'
          ? String(editor.getLine(cursor.line) || '')
          : ''
    if (text.trim() === '') {
      new Notice('得到大脑：先选中要摘的文字')
      return false
    }
    const source =
      view && view.file && typeof view.file.path === 'string' ? view.file.path : ''
    void this.activateView().then(() => requestIntent({ type: 'capture', text, source }))
    return true
  }

  /**
   * 快速切换器里挑一篇得到大脑的笔记。
   *
   * 用宿主自己的 SuggestModal 而不是我们面板里的搜索框：用户按 Ctrl/Cmd+O 是
   * 想「去那一篇」，不是「打开面板再搜一次」。搜索本身交给面板已有的
   * /search（它认得 tag:/dir:/裸标签这些写法），这里只负责把候选列出来。
   */
  async quickSwitchNote() {
    const plugin = this
    const Suggest = typeof FuzzySuggestModal === 'function' ? FuzzySuggestModal : null
    if (Suggest === null) {
      // 宿主版本太老（没有 FuzzySuggestModal）：退回「打开面板 + 聚焦搜索框」，
      // 至少不会什么都不发生。
      void this.activateView().then(() => requestIntent({ type: 'search' }))
      return
    }
    let items = []
    try {
      // resolveVaultRoot 是 async 的：少一个 await 拿到的是 Promise，
      // scanVault 会拿着 "[object Promise]" 当目录名去遍历。
      const root = (await settingsStore.resolveVaultRoot()).root
      const result = await scanVault(root)
      items = result.entries
    } catch {
      new Notice('得到大脑：库还没准备好，先打开面板看一眼')
      return
    }
    // 先把候选准备好再弹窗：宿主第一次 getItems 拿到空数组就会显示「没有结果」，
    // 而扫描是异步的——先扫完再开，用户看到的第一帧就是完整的列表。
    const modal = new (class extends Suggest {
      getItems() {
        return items
      }

      getItemText(item) {
        const dir = item.dir === '' ? '' : `${item.dir} / `
        return `${dir}${item.title || item.path}`
      }

      onChooseItem(item) {
        if (!item || typeof item.path !== 'string') return
        void plugin.activateView().then(() => requestIntent({ type: 'open', path: item.path }))
      }
    })(this.app)
    modal.setPlaceholder('搜索得到大脑里的笔记')
    modal.open()
  }

  /**
   * 在宿主里打开库内的某个文件（不只是 .md）。
   *
   * `openInVaultEditor` 走的是同一套入口，但它被设计成同步返回布尔值，用在
   * 面板的按钮回调里。刚写完的文件在宿主的文件表里可能还没登记（写入与索引
   * 是两条路），所以这里带几次重试：写完立刻打开，失败就等一会儿再试。
   */
  async openVaultFile(relPath, attempts = 4) {
    const rel = String(relPath || '').replace(/^\/+/, '')
    if (rel === '') return false
    for (let i = 0; i < attempts; i += 1) {
      const file = this.app.vault.getAbstractFileByPath ? this.app.vault.getAbstractFileByPath(rel) : null
      if (file) {
        try {
          await this.app.workspace.getLeaf('tab').openFile(file)
          return true
        } catch {
          return false
        }
      }
      // 宿主的索引一般几十毫秒内就跟上，等一小会儿再查
      await new Promise((resolve) => setTimeout(resolve, 80))
    }
    return false
  }

  /**
   * 在笔记目录里写一份 `.base`：Obsidian 1.9 的 Bases 视图能直接打开它。
   *
   * 有了它，用户可以在 Bases 里按标签/日期分组、写自己的公式，而不用回到我们
   * 这个面板——同一个笔记库，两套视图各有各的顺手处。
   */
  async createBasesView() {
    try {
      const runtime = settingsStore.getRuntime()
      const subfolder = String(runtime.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, '')
      const target = subfolder === '' ? '得到大脑.base' : `${subfolder}/得到大脑.base`
      const abs = join(runtime.vaultBase, target)
      // 已存在就不覆盖：用户可能已经在里面调过视图，覆盖等于删他的工作。
      let already = false
      try {
        await vfsAccess(abs)
        already = true
      } catch {
        already = false
      }
      if (already) {
        new Notice('得到大脑：这个 Bases 视图已经存在了')
        // 已经存在就别重写（用户可能在里面调过视图），但顺手打开它——
        // 他要的就是「看一眼我的库按标签长什么样」。
        await this.openVaultFile(target)
        return
      }
      await vfsWrite(abs, basesTemplate({ subfolder: subfolder || DEFAULT_SUBFOLDER }))
      invalidateScan()
      // 生成完直接打开：只写一个文件、什么都不发生，用户会以为命令没生效。
      if (await this.openVaultFile(target)) new Notice(`得到大脑：已生成并打开 ${target}`)
      else new Notice(`得到大脑：已生成 ${target}`)
    } catch (error) {
      new Notice(`得到大脑：生成 Bases 视图失败 —— ${error && error.message ? error.message : error}`)
    }
  }

  /**
   * 把一篇笔记放进「得到大脑画布」：没有就建一张，有就加一个文件节点。
   *
   * 画布是 .canvas（JSON），节点只是 {type:'file', file: 相对路径}。这样用户在
   * 画布里拖动、连线之后，我们的命令下次只负责补节点，不会重排他摆好的布局。
   */
  async addNoteToCanvas(notePath) {
    try {
      const runtime = settingsStore.getRuntime()
      const subfolder = String(runtime.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, '')
      const canvasRel = subfolder === '' ? '得到大脑画布.canvas' : `${subfolder}/得到大脑画布.canvas`
      const canvasAbs = join(runtime.vaultBase, canvasRel)
      // 画布节点存的是**库内相对路径**（跟 Obsidian 的 file.path 同一套），
      // 不是相对笔记目录——所以这里原样用，别再剥一层子目录前缀，
      // 否则画布打开会指向一个不存在的文件。
      const fileRel = String(notePath).replace(/^\/+/, '')
      let canvas = parseCanvas('')
      try {
        canvas = parseCanvas(await vfsRead(canvasAbs, 'utf8'))
      } catch {
        // 画布还不存在：从空画布开始
      }
      const { canvas: next, added } = addFileNode(canvas, { file: fileRel })
      if (!added) {
        new Notice('得到大脑：这篇已经在画布里了')
        return
      }
      await vfsWrite(canvasAbs, serializeCanvas(next))
      invalidateScan()
      // 画布是拿来「摆」的：写完直接打开，用户才能接着拖、接着连。
      if (await this.openVaultFile(canvasRel)) new Notice(`得到大脑：已放进 ${canvasRel}`)
      else new Notice(`得到大脑：已放进 ${canvasRel}（打开画布就能看到）`)
    } catch (error) {
      new Notice(`得到大脑：放进画布失败 —— ${error && error.message ? error.message : error}`)
    }
  }

  /**
   * 往插件目录的 boot.txt 追加一行启动轨迹。
   *
   * 只写关键节点、每行带时间戳；出错也不抛——诊断代码自己把插件搞崩就本末倒置了。
   * 面板正常打开时这些行就是噪声，所以只保留最近一次启动（首次写入时截断）。
   */
  probe(line) {
    try {
      const adapter = this.app && this.app.vault ? this.app.vault.adapter : null
      const dir = this.app && this.app.vault ? this.app.vault.configDir : '.obsidian'
      if (!adapter || typeof adapter.write !== 'function') return
      // 攒在内存里再整份写。边读边追加看着更省，但启动那一串调用全是同步连着来的，
      // 读还没回来写就发出去了，几次写互相覆盖，最后只剩最后一行——正好丢掉
      // 最要紧的「插件本体加载了」那条。
      if (!Array.isArray(this.probeLines)) this.probeLines = []
      const stamp = new Date().toISOString().slice(11, 19)
      this.probeLines.push(`[${stamp}] ${line}`)
      if (this.probeLines.length > 200) this.probeLines = this.probeLines.slice(-200)
      const body = `${this.probeLines.join('\n')}\n`
      void adapter.write(`${dir}/plugins/getnote-brain/boot.txt`, body).catch(() => {})
    } catch {
      // 诊断失败不影响功能
    }
  }

  onunload() {
    if (typeof this.stopCardAutoImport === 'function') {
      this.stopCardAutoImport()
      this.stopCardAutoImport = null
    }
    if (typeof this.stopAutoSync === 'function') {
      this.stopAutoSync()
      this.stopAutoSync = null
    }
    if (this.server) {
      // 不 await：Obsidian 的 unload 是同步的，close 交给事件循环收尾即可
      void this.server.close()
      this.server = null
    }
    setApiOrigin('')
    setApiToken('')
  }

  /**
   * 当天日记的库内路径；用户没开「日记」核心插件时返回空串。
   *
   * 直接读核心插件的配置而不是自己猜格式：那里的 folder / format 是用户调过的
   * （很多人是 `日记/YYYY/YYYY-MM-DD`），插件另起一套只会把摘要写到没人看的地方。
   * 内部 API 拿不到时按最常见的 `YYYY-MM-DD` 放在库根。
   */
  dailyNotePath() {
    const pad = (n) => String(n).padStart(2, '0')
    const now = new Date()
    let folder = ''
    let format = 'YYYY-MM-DD'
    try {
      const plugins = this.app.internalPlugins
      const daily = plugins && typeof plugins.getPluginById === 'function' ? plugins.getPluginById('daily-notes') : null
      const options = daily && daily.instance && daily.instance.options ? daily.instance.options : null
      if (daily && daily.enabled === false) return ''
      if (options) {
        if (typeof options.folder === 'string') folder = options.folder
        if (typeof options.format === 'string' && options.format !== '') format = options.format
      } else if (!daily) {
        // 没有这个核心插件（或被裁剪过的发行版）：不写摘要，避免凭空建文件
        return ''
      }
    } catch {
      return ''
    }
    // 只支持 format 里的年月日占位，够覆盖绝大多数人的设置；认不出的占位原样留着，
    // 写不进去会在上层被吞掉，不会影响同步。
    const name = format
      .replace(/YYYY/g, String(now.getFullYear()))
      .replace(/MM/g, pad(now.getMonth() + 1))
      .replace(/DD/g, pad(now.getDate()))
    const rel = folder.trim() === '' ? name : `${folder.replace(/\\/g, '/').replace(/\/+$/, '')}/${name}`
    return `${rel}.md`
  }

  /**
   * 今天的日记，按面板的路径口径给（相对笔记子目录，没有子目录时就是库内相对路径）。
   *
   * dailyNotePath() 给的是库内相对路径，面板的 entry.path / /create 的 dir 都按
   * 笔记子目录算，两者差一层子目录，这里补上。日记落在笔记目录之外时返回 ''，
   * 面板据此退回自己的日期标题——我们不替用户把日记搬进笔记目录。
   */
  dailyNoteRel() {
    const full = this.dailyNotePath()
    if (full === '') return ''
    const runtime = settingsStore.getRuntime()
    const sub = String(runtime.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, '')
    if (sub === '') return full
    if (!full.startsWith(`${sub}/`)) return ''
    return full.slice(sub.length + 1)
  }

  /**
   * 宿主日记插件里配好的模板正文；没配或读不到就返回空串。
   *
   * 「设置 → 核心插件 → 日记 → 模板文件」指向一篇库里的笔记，新建日记时会把它
   * 整个填进去（标题骨架、几个提问、常用标签）。我们这边如果建一篇空的，用户
   * 在同一个库里就有两种「今天的日记」——一种有骨架，一种光秃秃。
   *
   * 读文件用 vfs，走宿主的 adapter；读不到（文件被删、路径写错、模板在库外）
   * 一律当没有，不让新建失败。
   */
  async dailyTemplateContent() {
    try {
      const plugins = this.app.internalPlugins
      const daily = plugins && typeof plugins.getPluginById === 'function' ? plugins.getPluginById('daily-notes') : null
      if (!daily || daily.enabled === false) return ''
      const options = daily.instance && daily.instance.options ? daily.instance.options : null
      if (!options || typeof options.template !== 'string') return ''
      // 宿主记的模板路径是**库内相对**的（相对库根，不是相对笔记目录）。
      // 拿笔记根去拼会变成「得到大脑/得到大脑/模板/…」，于是永远读不到。
      const rel = options.template.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
      if (rel === '') return ''
      const base = String(settingsStore.getRuntime().vaultBase || '')
        .replace(/\\/g, '/')
        .replace(/\/+$/, '')
      const abs = base === '' ? rel : `${base}/${rel}`
      const text = await vfsRead(abs, 'utf8')
      return typeof text === 'string' ? text : ''
    } catch {
      return ''
    }
  }

  /**
   * 新建的笔记该落在哪个目录（面板口径），按宿主的设置来。
   *
   * 「设置 → 文件与链接 → 新建笔记的默认位置」有三档：库根 / 当前笔记所在目录 /
   * 指定目录。面板原来固定丢在笔记目录根，用户在别处点「新建笔记」看到的却是
   * 另一个位置，同一个库里于是有两套「新建落在哪」。宿主的设置存在 vault 配置里
   * （getConfig 的 newFileLocation / newFileFolderPath），这里换算成面板口径。
   *
   * 落在笔记目录之外、或宿主要求跟着当前笔记但当前没有打开的文件，返回空串，
   * 面板退回自己的做法——不替用户把笔记建到笔记目录外面去。
   */
  newNoteDir() {
    try {
      const vault = this.app.vault
      if (!vault || typeof vault.getConfig !== 'function') return ''
      const where = String(vault.getConfig('newFileLocation') || '')
      let target = ''
      if (where === 'folder') {
        target = String(vault.getConfig('newFileFolderPath') || '')
      } else if (where === 'current') {
        const active = this.app.workspace.getActiveFile ? this.app.workspace.getActiveFile() : null
        if (!active || !active.parent || typeof active.parent.path !== 'string') return ''
        target = active.parent.path
      } else {
        return ''
      }
      const rel = target.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
      const runtime = settingsStore.getRuntime()
      const sub = String(runtime.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, '')
      if (sub === '') return rel
      if (rel === '' || rel === sub) return ''
      if (!rel.startsWith(`${sub}/`)) return ''
      return rel.slice(sub.length + 1)
    } catch {
      return ''
    }
  }

  /**
   * 一个双链该指向哪一篇，交给宿主的索引去解析。
   *
   * getFirstLinkpathDest 是 Obsidian 自己用的那套规则：别名、不带扩展名的路径
   * 前缀、同名笔记取离 sourcePath 最近的一篇、大小写按库里实际文件名。面板自己
   * 在 entries 里三级退让能应付常见的 [[笔记名]]，但同名笔记一多就会指错，而
   * 「点进去是另一篇」这种错用户很难察觉。
   *
   * 返回面板口径（相对笔记子目录）的路径；解析不出来、或结果落在笔记目录之外，
   * 返回空串让面板退回自己那套。
   */
  linkResolveFor(linkpath, sourcePath) {
    try {
      const wanted = String(linkpath || '').trim()
      if (wanted === '') return ''
      const cache = this.app.metadataCache
      if (!cache || typeof cache.getFirstLinkpathDest !== 'function') return ''
      const source = String(sourcePath || '').replace(/^\/+/, '')
      const dest = cache.getFirstLinkpathDest(wanted, source)
      if (!dest || typeof dest.path !== 'string') return ''
      return this.notePathInVault(dest)
    } catch {
      return ''
    }
  }

  /**
   * 把一轮同步的结果追加到当天的日记里。
   *
   * 用 Obsidian 的日常笔记配置（设置 → 日记）找文件：那里已经定义好了目录、
   * 文件名格式和模板，插件再自己猜一套只会和用户已有的习惯打架。找不到配置
   * 或者文件不存在就直接跳过——多数用户没开日常笔记，这不是错误。
   */
  async appendSyncReport(result) {
    if (result === null || typeof result !== 'object') return
    const pulled = Number(result.pulled) || 0
    if (pulled <= 0) return
    const path = this.dailyNotePath()
    if (path === '') return
    const stamp = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const hm = `${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`
    const line = `\n- ${hm} 得到大脑同步：新增 ${pulled} 篇${
      Number(result.skipped) > 0 ? `，跳过 ${result.skipped} 篇` : ''
    }${Number(result.conflicts) > 0 ? `，${result.conflicts} 处冲突待处理` : ''}\n`
    const adapter = this.app.vault.adapter
    const basePath = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : ''
    // 移动端拿不到库根的绝对路径；vfs 在这种情况下也没法把绝对路径翻译回去。
    if (basePath === '') return
    const abs = `${basePath.replace(/\\/g, '/').replace(/\/+$/, '')}/${path}`
    let before = ''
    try {
      before = String(await vfsRead(abs, 'utf8'))
    } catch {
      // 今天的日记还没建：这一行就是它的第一段内容，照写不误
      before = ''
    }
    try {
      await vfsWrite(abs, before === '' ? line.replace(/^\n/, '') : `${before.replace(/\s*$/, '')}${line}`, 'utf8')
    } catch {
      // 写不进去就算了，同步本身已经成功
    }
  }

  /**
   * 插件数据目录的绝对路径。
   *
   * 凭证（OAuth token / API Key）写在插件自己的目录里而不是 localStorage：
   * 库被同步或分享出去时不该带上它们，而且明文塞 localStorage 更容易被别的
   * 插件读到。settings.js 用的是 node:fs，所以要绝对路径。
   */
  resolveDataDir(basePath) {
    const configDir = this.app.vault.configDir || '.obsidian'
    const rel = `${configDir}/plugins/${this.manifest.id}`
    if (basePath === '') return rel
    return `${basePath.replace(/\\/g, '/').replace(/\/+$/, '')}/${rel}`
  }

  markPanelVisible() {
    markPanelVisible()
  }

  /** 打开（或聚焦）面板；`newWindow` 用 Obsidian 的独立窗口打开。 */
  async activateView(newWindow = false) {
    this.probe(`activateView（本地服务${this.server ? '在' : '不在'}）`)
    if (!this.server) {
      new Notice('得到大脑：本地服务还没就绪，先看一眼设置页里的提示。')
      return
    }
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_GETNOTE)
    if (existing.length > 0 && !newWindow) {
      this.app.workspace.revealLeaf(existing[0])
      return
    }
    const leaf = newWindow
      ? this.app.workspace.openPopoutLeaf({ size: { width: 1100, height: 780 } })
      : this.app.workspace.getLeaf(true)
    await leaf.setViewState({ type: VIEW_TYPE_GETNOTE, active: true })
    this.app.workspace.revealLeaf(leaf)
  }

  /**
   * 状态栏文案跟着面板里的实际情况走。
   *
   * 只写「得到大脑」四个字太浪费：状态栏是用户唯一一直看得见我们的地方，
   * 库里有几篇、当前开着哪一篇，写在这里用户扫一眼就知道。面板每次
   * 库或当前笔记变化都会调过来，这里只做字符串拼接，不做任何 IO。
   */
  updateStatusBar(info) {
    const el = this.statusBarEl
    if (!el || typeof el.setText !== 'function') return
    const count = info && Number.isFinite(info.count) ? Math.max(0, info.count) : 0
    const note = info && typeof info.note === 'string' ? info.note.trim() : ''
    if (note !== '') {
      const short = note.length > 18 ? `${note.slice(0, 18)}…` : note
      el.setText(`得到大脑 · ${short}`)
      return
    }
    el.setText(count > 0 ? `得到大脑 · ${count} 篇` : '得到大脑')
  }

  /**
   * 面板里的确认框。
   *
   * 面板原来用 window.confirm：Electron 里能用，但长得跟宿主完全不搭，移动端
   * WebView 还可能根本不弹——删除、清空这种不可逆的动作就等于没有二次确认。
   * Modal 由宿主渲染，遮罩、焦点、Esc 都归 Obsidian 管。
   *
   * 返回 Promise<boolean>，用户点「确定」才是 true；关窗（Esc、点遮罩）算取消。
   */
  askConfirm(message) {
    if (typeof Modal !== 'function') return Promise.resolve(false)
    return new Promise((resolve) => {
      // close() 会触发 onClose，点按钮和按 Esc 都走同一条路。用标记保证只
      // resolve 一次：否则「先点确定、再按 Esc」会 resolve 两回。
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      class ConfirmModal extends Modal {
        onOpen() {
          const { contentEl } = this
          contentEl.createEl('p', { text: String(message) })
          const bar = contentEl.createDiv({ cls: 'modal-button-container' })
          const ok = bar.createEl('button', { text: '确定', cls: 'mod-cta' })
          ok.addEventListener('click', () => {
            finish(true)
            this.close()
          })
          const cancel = bar.createEl('button', { text: '取消' })
          cancel.addEventListener('click', () => {
            finish(false)
            this.close()
          })
          // 默认焦点给「取消」：这种弹窗多数是拦误操作，回车不该直接把笔记删了。
          if (typeof cancel.focus === 'function') cancel.focus()
        }

        onClose() {
          finish(false)
          if (this.contentEl && typeof this.contentEl.empty === 'function') this.contentEl.empty()
        }
      }
      new ConfirmModal(this.app).open()
    })
  }

  /**
   * 宿主文件列表的接口（能「在文件夹里亮出这一项」的那个）。
   *
   * Obsidian 没把这件事做成公开 API：老版本挂在 internalPlugins 的
   * file-explorer 实例上，新版本也可能只有叶子视图上有。两处都试一遍，
   * 都拿不到就返回 null，让调用方明说「定位不了」而不是静默失败。
   */
  fileExplorerApi() {
    try {
      const internal = this.app.internalPlugins
      const plugin = internal && typeof internal.getPluginById === 'function' ? internal.getPluginById('file-explorer') : null
      const instance = plugin && plugin.instance ? plugin.instance : null
      if (instance && typeof instance.revealInFolder === 'function') return instance
      const leaves = this.app.workspace.getLeavesOfType ? this.app.workspace.getLeavesOfType('file-explorer') : []
      const view = leaves && leaves.length > 0 && leaves[0].view ? leaves[0].view : null
      if (view && typeof view.revealInFolder === 'function') return view
      return null
    } catch {
      return null
    }
  }

  /**
   * 把这一项在宿主的文件列表里亮出来。
   *
   * 面板传的可能是相对笔记目录的路径（列表里 entry.path 就是这种），也可能
   * 是库内相对路径，两种都认。
   */
  revealInVaultItem(path) {
    try {
      const raw = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '')
      if (raw === '') return false
      const runtime = settingsStore.getRuntime()
      const sub = String(runtime.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, '')
      const candidates = [raw]
      if (sub !== '' && !raw.startsWith(sub + '/')) candidates.push(`${sub}/${raw}`)
      let file = null
      for (const candidate of candidates) {
        const hit = this.app.vault.getAbstractFileByPath(candidate)
        if (hit) {
          file = hit
          break
        }
      }
      if (file === null) return false
      const explorer = this.fileExplorerApi()
      if (explorer === null) {
        new Notice('得到大脑：这个版本的 Obsidian 没有文件列表接口，定位不了')
        return false
      }
      // 先把文件列表所在的叶子亮出来：侧栏收起来时「定位」等于什么都没发生。
      try {
        const leaf = this.app.workspace.getLeavesOfType('file-explorer')[0]
        if (leaf && typeof this.app.workspace.revealLeaf === 'function') this.app.workspace.revealLeaf(leaf)
      } catch {
        // 亮不出来也还是能定位，别因此中断
      }
      explorer.revealInFolder(file)
      return true
    } catch {
      return false
    }
  }

  /**
   * 把一张图片交给宿主打开。
   *
   * 面板里的图片是拿资源地址直接画出来的，点了本来什么都不会发生。宿主自己
   * 有图片视图（滚轮缩放、左右翻页、能拖出去），交给它比在面板里再写一个
   * 全屏浮层更省事，也更符合用户在 Obsidian 里的习惯。
   *
   * 路径口径与面板别处一致：可以是相对笔记目录的，也可以是库内相对的。
   * 找不到（附件还在云端、或者路径带错）返回 false，面板据此不提示。
   */
  openAssetInVault(path) {
    try {
      const raw = String(path || '').replace(/\\/g, '/')
      if (raw === '') return false
      const runtime = settingsStore.getRuntime()
      const base = String(runtime.vaultBase || '').replace(/\\/g, '/').replace(/\/+$/, '')
      const sub = String(runtime.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, '')
      let rel = raw.replace(/^\/+/, '')
      const baseBare = base.replace(/^\/+/, '')
      if (baseBare !== '' && rel.startsWith(baseBare + '/')) rel = rel.slice(baseBare.length + 1)
      const candidates = [rel]
      if (sub !== '' && !rel.startsWith(sub + '/')) candidates.push(`${sub}/${rel}`)
      for (const candidate of candidates) {
        const file = this.app.vault.getAbstractFileByPath(candidate)
        if (file) {
          // 图片不走编辑器叶子：宿主会用图片视图打开它（缩放、翻页都在那边）。
          void this.app.workspace.getLeaf('tab').openFile(file)
          return true
        }
      }
      return false
    } catch {
      return false
    }
  }

  /**
   * 把库内相对路径交给宿主编辑器打开。
   *
   * 面板自己的编辑器只能改正文：没有补全、没有 Vim、没有别的插件挂上来的命令。
   * 找不到这个文件（刚被删、路径带错）返回 false，面板据此决定要不要提示。
   */
  openInVaultEditor(path) {
    try {
      const raw = String(path || '').replace(/\\/g, '/')
      if (raw === '') return false
      const runtime = settingsStore.getRuntime()
      const base = String(runtime.vaultBase || '').replace(/\\/g, '/').replace(/\/+$/, '')
      const sub = String(runtime.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, '')
      // 面板传过来的可能是三种口径：库内相对路径（得到大脑/随手记/甲.md）、
      // 相对笔记目录的路径（随手记/甲.md，列表里的 entry.path 就是这种）、
      // 或者拼好的绝对路径（笔记头按钮用的）。宿主只认第一种，所以这里统一。
      // 先去掉前导斜杠再比 base：Linux 上库根是 /tmp/xxx，去掉斜杠之后
      // 就成了 tmp/xxx，直接拿带斜杠的 base 比会永远比不中（CI 上就是这么红的）。
      let rel = raw.replace(/^\/+/, '')
      const baseBare = base.replace(/^\/+/, '')
      if (baseBare !== '' && rel.startsWith(baseBare + '/')) rel = rel.slice(baseBare.length + 1)
      const candidates = [rel]
      if (sub !== '' && !rel.startsWith(sub + '/')) candidates.push(`${sub}/${rel}`)
      for (const candidate of candidates) {
        const file = this.app.vault.getAbstractFileByPath(candidate)
        if (!file) continue
        void this.app.workspace.getLeaf('tab').openFile(file)
        return true
      }
      return false
    } catch {
      return false
    }
  }

  /**
   * 让宿主弹它自己的改名对话框，改完把新路径交回面板。
   *
   * 为什么不自己 rename 文件：宿主改名时会同步重写全库的 [[双链]] 与 Markdown
   * 链接。我们绕过它直接改文件名，别的笔记里的引用就成了死链，而且没有任何
   * 提示——用户往往几个月后才在某篇笔记里发现一串点不开的链接。
   *
   * 用 promptForFileRename 而不是 renameFile：前者是用户熟悉的那个对话框，
   * 预填原名、回车确认、自动避开重名；后者要我们自己做输入界面，还得自己
   * 处理「名字里有斜杠」「已存在」这些边界。用户取消（对话框关掉）时路径
   * 没变，返回空串，面板据此什么都不做。
   */
  async renameNoteInVault(path) {
    try {
      const raw = String(path || '').replace(/\\/g, '/')
      if (raw === '') return ''
      const runtime = settingsStore.getRuntime()
      const base = String(runtime.vaultBase || '').replace(/\\/g, '/').replace(/\/+$/, '')
      const sub = String(runtime.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, '')
      // 面板传三种口径（库内相对 / 相对笔记目录 / 绝对），宿主只认第一种。
      let rel = raw.replace(/^\/+/, '')
      const baseBare = base.replace(/^\/+/, '')
      if (baseBare !== '' && rel.startsWith(baseBare + '/')) rel = rel.slice(baseBare.length + 1)
      const candidates = [rel]
      if (sub !== '' && !rel.startsWith(sub + '/')) candidates.push(`${sub}/${rel}`)
      let file = null
      for (const candidate of candidates) {
        const hit = this.app.vault.getAbstractFileByPath(candidate)
        if (hit) {
          file = hit
          break
        }
      }
      if (!file) return ''
      const manager = this.app.fileManager
      if (!manager || typeof manager.promptForFileRename !== 'function') {
        // 静默不动会被当成按钮坏了，明说一句。
        new Notice('得到大脑：这个版本的 Obsidian 没有改名对话框，改不了')
        return ''
      }
      const before = String(file.path || '')
      await manager.promptForFileRename(file)
      const after = String(file.path || '')
      if (after === '' || after === before) return ''
      // 改到笔记目录之外就没法在面板里打开了，交回空串让面板只刷新列表。
      return this.notePathInVault(file)
    } catch {
      return ''
    }
  }

  /**
   * 把面板切到「当前正在看的这篇」。
   *
   * 用户在 Obsidian 里读或改一篇笔记时，最想要的是「它在得到大脑里长什么样」：
   * 谁引用了它、同步过没有、有没有历史版本、附件齐不齐。这些都在面板里，
   * 但面板不会自己跟着宿主的活动笔记走（那会让面板在用户切来切去时乱跳）。
   * 所以给一条命令，用户想跟的时候按一下。
   *
   * 当前笔记不在笔记目录里（或者没开笔记）时给出明确提示，而不是静默不动——
   * 静默不动会被当成命令坏了。
   */
  async openActiveNote() {
    const file = this.app.workspace.getActiveFile ? this.app.workspace.getActiveFile() : null
    const rel = this.notePathInVault(file)
    if (rel === '') {
      const sub = String(settingsStore.getRuntime().subfolder || DEFAULT_SUBFOLDER)
      new Notice(`得到大脑：当前笔记不在「${sub}」目录里`)
      return
    }
    try {
      await this.activateView()
    } catch {
      // 面板开不出来也照样投递，意图总线会暂存一条
    }
    requestIntent({ type: 'open', path: rel })
  }

  /**
   * 跟着宿主切换：当前笔记变了就把面板切到同一篇。
   *
   * 三件事按这个顺序挡在前面，每一件都是「不做」比「做了」好：
   *   1. 这篇不在笔记目录里 —— 用户在库根翻 README 时不该被拽进「得到大脑」；
   *   2. 面板没开着 —— 只是翻笔记却被弹出一个面板，是最烦人的那种「贴心」；
   *   3. 开关关着 —— 默认就是关的，用户点头才跟。
   *
   * 开关现读一遍而不是信 onload 的快照：面板的设置页也能改它，改完不该等重启。
   * 设置文件读不出来时按「关」处理——跟随是「面板自己动」，出问题时宁可不跟，
   * 也不要凭空把用户正在看的笔记顶掉。
   *
   * 返回一句话说明这次为什么跟/没跟，方便自测和排查；真正干活的是投递那条意图。
   */
  async followActiveNote(file) {
    const rel = this.notePathInVault(file)
    if (rel === '') return 'outside'
    const leaves = this.app.workspace.getLeavesOfType
      ? this.app.workspace.getLeavesOfType(VIEW_TYPE_GETNOTE)
      : []
    if (!Array.isArray(leaves) || leaves.length === 0) return 'closed'
    let on = this.followActive === true
    try {
      const settings = await settingsStore.readSettings()
      on = settings.followActive === true
      this.followActive = on
    } catch {
      // 读不到就沿用内存里的值
    }
    if (!on) return 'off'
    requestIntent({ type: 'open', path: rel })
    return 'followed'
  }

  /**
   * 生成一条指向这篇笔记的链接，格式按用户的 Obsidian 设置来。
   *
   * `app.fileManager.generateMarkdownLink` 会读「使用 Wiki 链接」与「新链接格式」
   * 两项设置，给出 `[[随手记/甲|甲]]` 或 `[甲](随手记/甲.md)`。面板的「复制引用」
   * 拿它当首选——用户复制引用是为了粘进另一篇笔记，不是喂给外部工具。
   *
   * 面板传进来的是「相对笔记目录」的路径，宿主要的是库内相对路径，这里补上子目录。
   * 拿不到文件或宿主没提供这个方法时返回空串，面板退回原来的绝对路径口径。
   */
  markdownLinkFor(path, subpath) {
    try {
      const rel = String(path || '').replace(/^\/+/, '')
      if (rel === '') return ''
      const runtime = settingsStore.getRuntime()
      const sub = String(runtime.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, '')
      const inVault = sub === '' || rel.startsWith(sub + '/') ? rel : `${sub}/${rel}`
      const file = this.app.vault.getAbstractFileByPath(inVault)
      if (!file) return ''
      const manager = this.app.fileManager
      if (!manager || typeof manager.generateMarkdownLink !== 'function') return ''
      const link = manager.generateMarkdownLink(file, '', typeof subpath === 'string' ? subpath : '')
      return typeof link === 'string' ? link : ''
    } catch {
      return ''
    }
  }

  /**
   * 附件的地址交给宿主。
   *
   * 面板里 `<img>` / `<audio>` 的 src 原来是本地服务的
   * `/getnote/asset?path=...&t=令牌`：端口会变、令牌每次启动都换，而且每张图都要
   * 绕一圈本机 HTTP。`adapter.getResourcePath()` 给的是宿主资源协议下的地址，
   * 浏览器直接能加载，也能吃到宿主的缓存与 Range 处理（录音拖进度条要靠它）。
   *
   * 面板传进来的是「相对笔记目录」的路径，宿主只认库内相对路径，这里补子目录。
   * 拿不到（旧版宿主没这个方法、文件还没进索引）返回空串，面板退回本地服务地址。
   */
  assetUrlFor(path) {
    try {
      const raw = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '')
      if (raw === '') return ''
      const runtime = settingsStore.getRuntime()
      const sub = String(runtime.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, '')
      const inVault = sub === '' || raw.startsWith(sub + '/') ? raw : `${sub}/${raw}`
      const adapter = this.app.vault.adapter
      if (!adapter || typeof adapter.getResourcePath !== 'function') return ''
      const url = adapter.getResourcePath(inVault)
      return typeof url === 'string' ? url : ''
    } catch {
      return ''
    }
  }

  /**
   * 用宿主的 metadataCache 回答「谁引用了这篇」与「这篇引用了谁」。
   *
   * 只读宿主的索引，不碰磁盘：resolvedLinks 是 Obsidian 维护的
   * 「源文件 → 目标文件 → 次数」表，getFileCache 给的是单篇的 links/embeds。
   * 两者都可能还没收录刚写下的文件，所以拿不到就返回 null，由面板退回自己的扫描。
   *
   * 返回形状要和面板里那份本地扫描一致（hits 里每项带 path/title/links），
   * 否则界面上一半有标题一半没有，看着像坏了。
   */
  vaultGraphOf(path, kind) {
    try {
      const rel = String(path || '').replace(/^\/+/, '')
      if (rel === '') return null
      const file = this.app.vault.getAbstractFileByPath(rel)
      if (!file) return null
      const cache = this.app.metadataCache
      if (!cache) return null
      const titleOf = (p) => String(p).split('/').pop().replace(/\.md$/i, '')
      if (kind === 'backlinks') {
        const hits = []
        if (typeof cache.getBacklinksForFile === 'function') {
          const result = cache.getBacklinksForFile(file)
          const data = result && result.data ? result.data : null
          if (data && typeof data.forEach === 'function') {
            // 宿主顺手给了「这一篇里提了几次」。一篇笔记里反复提到同一篇时，
            // 那条反链比只提一次的更值得先看——这个数字不额外读盘就能拿到。
            data.forEach((count, sourcePath) => {
              const times = Number(count)
              hits.push({
                path: sourcePath,
                title: titleOf(sourcePath),
                date: '',
                links: [rel],
                count: Number.isFinite(times) && times > 0 ? times : 1,
              })
            })
          }
        } else if (cache.resolvedLinks && typeof cache.resolvedLinks === 'object') {
          for (const sourcePath of Object.keys(cache.resolvedLinks)) {
            if (sourcePath === rel) continue
            const targets = cache.resolvedLinks[sourcePath]
            if (!targets || targets[rel] === undefined) continue
            hits.push({ path: sourcePath, title: titleOf(sourcePath), date: '', links: [rel], count: 1 })
          }
        }
        // 一条反向链接都没有，但这篇刚写下来：宿主的索引可能还没跑到它身上，
        // 「真的没人引用」和「还没来得及收录」在这里长得一模一样。这种情况下
        // 不替宿主下结论，返回 null 让面板走一次本地扫描。
        if (hits.length === 0) {
          const mtime = Number(file.stat && file.stat.mtime) || 0
          if (mtime > 0 && Date.now() - mtime < FRESH_INDEX_MS) return null
        }
        // 提得多的排前面，次数相同再按标题。面板那份本地扫描是同一个口径——
        // 两边排序不一致的话，同一篇笔记接不接宿主会换个顺序，用户会以为丢了东西。
        hits.sort((a, b) => (Number(b.count) || 1) - (Number(a.count) || 1) || a.title.localeCompare(b.title, 'zh'))
        return { target: rel, hits, host: true }
      }
      if (kind === 'links') {
        const info = typeof cache.getFileCache === 'function' ? cache.getFileCache(file) : null
        if (!info) return null
        const links = []
        for (const item of [...(info.links || []), ...(info.embeds || [])]) {
          const link = item && item.link ? String(item.link) : ''
          if (link !== '' && !links.includes(link)) links.push(link)
        }
        return { target: rel, links, host: true }
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * 反链的「上下文」在宿主这条路补上。
   *
   * vaultGraphOf 只读 metadataCache，拿得到「谁引用了我」「引了几次」，拿不到
   * 引用那一行剩下的字——宿主的索引存的是链接位置，不是上下文。于是面板接上
   * 宿主时反链底下空着一行，同一篇笔记接不接宿主长得不一样。
   *
   * 这里把那一行补回来：只读**引用了这篇的那几篇**的正文，不是全库。挑行用的是
   * vault.js 里同一个函数（backlinkSnippets），判定口径与面板本地扫描一致，
   * 所以不会出现「本地三条、接上宿主两条」。
   *
   * 命中特别多的笔记（被几十篇引用）只给前几十条补上下文：再多就是为了一屏之外
   * 的条目把磁盘读穿，而用户根本还没滚到那儿。
   */
  async vaultGraphWithSnippets(path, kind) {
    const base = this.vaultGraphOf(path, kind)
    if (base === null) return null
    if (kind !== 'backlinks') return base
    if (!Array.isArray(base.hits) || base.hits.length === 0) return base
    const rel = String(path || '').replace(/^\/+/, '')
    if (rel === '') return base
    const runtime = settingsStore.getRuntime()
    const basePath = String(runtime.vaultBase || '')
    if (basePath === '') return base
    // 目标那一篇的名字：路径、去扩展名、文件名、标题，再加头部里写的别名。
    // 别名要读一次目标自己的正文——只读一个文件，比让反链少一条划算。
    const names = linkNamesOf({ path: rel, title: rel.split('/').pop().replace(/\.md$/i, '') })
    try {
      const own = await vfsRead(join(basePath, rel), 'utf8')
      const head = parseFrontmatter(own).data || {}
      const aliases = head.aliases !== undefined ? head.aliases : head.alias !== undefined ? head.alias : head['别名']
      for (const alias of normalizeAliases(aliases)) names.push(alias)
    } catch {
      // 读不到就按没有别名算：少一条上下文，不影响反链本身
    }
    const wanted = new Set(names.map((name) => String(name).toLowerCase()))
    const budget = 40
    await Promise.all(
      base.hits.slice(0, budget).map(async (hit) => {
        try {
          const text = await vfsRead(join(basePath, hit.path), 'utf8')
          hit.snippets = backlinkSnippets(text, wanted, 3)
        } catch {
          hit.snippets = []
        }
      }),
    )
    return base
  }

  async saveLocalPort(port) {
    await settingsStore.updateSettings({ localPort: port })
  }
}

class GetnoteSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display() {
    const { containerEl } = this
    containerEl.empty()
    containerEl.createEl('h2', { text: '得到大脑' })

    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: '笔记落在库内的一个子目录里，默认「得到大脑」。面板里能改的其它设置（主题色、语言、自动同步间隔、云端接入）都会存到插件自己的设置文件里。',
    })

    new Setting(containerEl)
      .setName('笔记子目录')
      .setDesc('相对库根的子目录名。改名后已有的笔记不会被移动，插件会读新目录。')
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SUBFOLDER)
          .setValue(settingsStore.getRuntime().subfolder)
          .onChange(async (value) => {
            const trimmed = value.trim()
            if (trimmed === '') return
            try {
              await settingsStore.setVaultRoot(trimmed)
              new Notice(`得到大脑：笔记目录已改为「${trimmed}」`)
            } catch (error) {
              new Notice(`得到大脑：${error && error.message ? error.message : error}`)
            }
          })
      })

    new Setting(containerEl)
      .setName('本地服务')
      .setDesc(
        this.plugin.localPort
          ? `运行中：http://127.0.0.1:${this.plugin.localPort}${
              this.plugin.portFallback
                ? '（你指定的端口被占用，这次用了系统分配的；云端授权可能需要重新登录一次）'
                : ''
            }`
          : '未运行。重启 Obsidian 或看控制台里的报错。',
      )

    new Setting(containerEl)
      .setName('录音卡插上就导')
      .setDesc(
        '每 5 分钟连一次录音卡，发现还没导过的录音就自动导进「录音卡」目录。' +
          '卡片不在附近时这次尝试会安静失败，不影响别的事；永远不删卡上的文件。' +
          '需要 Python 3.10+ 和 bleak。',
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.cardAutoImport === true).onChange(async (value) => {
          this.plugin.cardAutoImport = value === true
          await settingsStore.updateSettings({ cardAutoImport: this.plugin.cardAutoImport })
        })
      })

    new Setting(containerEl)
      .setName('跟着宿主切换笔记')
      .setDesc(
        '你在 Obsidian 里翻到哪一篇，开着的面板就跟着打开同一篇（反链、同步状态、历史版本立刻跟上）。' +
          '面板没开着时不会替你打开它；不在「得到大脑」目录里的笔记也不会跟。',
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.followActive === true).onChange(async (value) => {
          this.plugin.followActive = value === true
          await settingsStore.updateSettings({ followActive: this.plugin.followActive })
        })
      })

    new Setting(containerEl)
      .setName('详细日志')
      .setDesc('把面板与同步的每一步打进开发者控制台（Ctrl+Shift+I）。排查问题时打开，平时关着——控制台里挤着几十个插件，刷屏的输出反而没人看。')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.debugLogging === true).onChange(async (value) => {
          this.plugin.debugLogging = value === true
          setDebugLogging(this.plugin.debugLogging)
          await settingsStore.updateSettings({ debugLogging: this.plugin.debugLogging })
        })
      })

    new Setting(containerEl)
      .setName('打开面板')
      .setDesc('也可以用左侧栏的大脑图标，或命令面板里的「打开得到大脑面板」。')
      .addButton((button) => {
        button.setButtonText('打开').setCta().onClick(() => { void this.plugin.activateView() })
      })
  }
}

export { PanelIcon }
