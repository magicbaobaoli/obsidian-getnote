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

import { Menu, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as settingsStore from './core/settings.js'
import { configure as configureVfs, mkdir as vfsMkdir } from './core/vfs.js'
import { configureCardScripts } from './core/card.js'
import { invalidateScan } from './core/vault.js'
import { startAutoSync, markPanelVisible } from './core/service.js'
import { startLocalServer } from './host/server.js'
import { setApiOrigin, setApiToken, setOpenExternal, setSaveFile, setNoteMenu, requestIntent } from './view/panel.js'
import { GetnoteView, VIEW_TYPE_GETNOTE, PanelIcon } from './view/view.js'

const DEFAULT_SUBFOLDER = '得到大脑'

export default class GetnoteObsidianPlugin extends Plugin {
  async onload() {
    // 库根的绝对路径：vfs.js 靠它把「绝对路径」翻译成 adapter 认的库内相对路径。
    const adapter = this.app.vault.adapter
    const basePath = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : ''
    const dataDir = this.resolveDataDir(basePath)

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

    const stored = await settingsStore.readSettings()
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
      // 不弹 Notice 打扰，写进设置页的状态行里更合适。
      this.portFallback = this.server.portFallback === true
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

    // 状态栏：一个能看见「插件在跑、服务在哪个端口」的小字，点一下打开面板。
    // 没有它，用户遇到问题（比如端口被占）时完全没有线索。
    if (this.server) {
      this.statusBarEl = this.addStatusBarItem()
      this.statusBarEl.addClass('dshgn_status')
      this.statusBarEl.setText('得到大脑')
      this.statusBarEl.title = `本地服务 http://127.0.0.1:${this.localPort}`
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

    // 自动同步：DSH 版由 ctx.effect 托管，这里由 onunload 托管
    this.stopAutoSync = startAutoSync()
  }

  onunload() {
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
      .setName('打开面板')
      .setDesc('也可以用左侧栏的大脑图标，或命令面板里的「打开得到大脑面板」。')
      .addButton((button) => {
        button.setButtonText('打开').setCta().onClick(() => { void this.plugin.activateView() })
      })
  }
}

export { PanelIcon }
