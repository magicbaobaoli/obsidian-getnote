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
import { invalidateScan, scanVault } from './core/vault.js'
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
  setVaultGraph,
  setStatusReport,
  notifyCssChange,
  notifyVaultChange,
} from './view/panel.js'
import { GetnoteView, VIEW_TYPE_GETNOTE, PanelIcon } from './view/view.js'

const DEFAULT_SUBFOLDER = '得到大脑'

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

    // 反链、出链交给宿主的 metadataCache。
    //
    // Obsidian 本来就在增量维护整库的链接图（它就是靠这个画关系图谱、做双链补全的），
    // 我们再读一遍全库正文去正则匹配 [[...]]，等于把同一件事干第二遍。库大了之后
    // 这个差别是「点一下立刻出」和「等一秒」的差别。问不到（链接还没被索引、文件
    // 刚写下去）时面板会自己退回本地扫描，所以这里拿不准就返回 null。
    setVaultGraph((path, kind) => this.vaultGraphOf(path, kind))

    // 状态栏文案跟着面板里的实际情况走：只有「得到大脑」四个字，用户既不知道
    // 库有多大，也不知道面板里开着哪一篇。状态栏是他唯一一直看得见我们的地方。
    setStatusReport((info) => this.updateStatusBar(info))

    const stored = await settingsStore.readSettings()
    // 详细日志默认关。设置里打开过就在 onload 就生效，不必等用户进设置页。
    this.debugLogging = stored.debugLogging === true
    setDebugLogging(this.debugLogging)
    this.cardAutoImport = stored.cardAutoImport === true
    if (stored.subfolder && stored.subfolder !== DEFAULT_SUBFOLDER) {
      settingsStore.configure({ subfolder: stored.subfolder })
    }

    // 笔记目录不存在时建出来。不建的话面板一进来就是「本地库目录不存在」，
    // 用户还得自己先去资源管理器建个文件夹——第一次用的体验会莫名其妙。
    // 用 vfs 而不是 node:fs，这样 Obsidian 的文件索引能立刻看到新目录。
    const vaultRoot = settingsStore.resolveVaultRoot().root
    try {
      await vfsMkdir(vaultRoot, { recursive: true })
    } catch (error) {
      new Notice(`得到大脑：笔记目录建不出来 —— ${error && error.message ? error.message : error}`)
    }

    // 端口优先固定，OAuth 的 redirect_uri 才能跨会话稳定；被占用时退回随机端口。
    const preferredPort = Number(stored.localPort) > 0 ? Number(stored.localPort) : 0
    try {
      this.server = await startLocalServer({ preferredPort })
      setApiOrigin(this.server.origin)
      // 令牌由服务自己随机生成（每次启动都换），面板每个请求都要带。
      setApiToken(this.server.token)
      this.localPort = this.server.port
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
      new Notice(`得到大脑：本地服务启动失败 —— ${error && error.message ? error.message : error}`)
    }

    this.registerView(VIEW_TYPE_GETNOTE, (leaf) => new GetnoteView(leaf, this))

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
        return
      }
      await vfsWrite(abs, basesTemplate({ subfolder: subfolder || DEFAULT_SUBFOLDER }))
      invalidateScan()
      new Notice(`得到大脑：已生成 ${target}`)
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
      new Notice(`得到大脑：已放进 ${canvasRel}`)
    } catch (error) {
      new Notice(`得到大脑：放进画布失败 —— ${error && error.message ? error.message : error}`)
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
   * 把库内相对路径交给宿主编辑器打开。
   *
   * 面板自己的编辑器只能改正文：没有补全、没有 Vim、没有别的插件挂上来的命令。
   * 找不到这个文件（刚被删、路径带错）返回 false，面板据此决定要不要提示。
   */
  openInVaultEditor(path) {
    try {
      const rel = String(path || '').replace(/^\/+/, '')
      if (rel === '') return false
      const file = this.app.vault.getAbstractFileByPath(rel)
      if (!file) return false
      void this.app.workspace.getLeaf('tab').openFile(file)
      return true
    } catch {
      return false
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
            data.forEach((_count, sourcePath) => {
              hits.push({ path: sourcePath, title: titleOf(sourcePath), date: '', links: [rel] })
            })
          }
        } else if (cache.resolvedLinks && typeof cache.resolvedLinks === 'object') {
          for (const sourcePath of Object.keys(cache.resolvedLinks)) {
            if (sourcePath === rel) continue
            const targets = cache.resolvedLinks[sourcePath]
            if (!targets || targets[rel] === undefined) continue
            hits.push({ path: sourcePath, title: titleOf(sourcePath), date: '', links: [rel] })
          }
        }
        hits.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
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
