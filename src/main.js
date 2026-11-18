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

import { Notice, Plugin, PluginSettingTab, Setting } from 'obsidian'

import * as settingsStore from './core/settings.js'
import { configure as configureVfs } from './core/vfs.js'
import { configureCardScripts } from './core/card.js'
import { startAutoSync, markPanelVisible } from './core/service.js'
import { startLocalServer } from './host/server.js'
import { setApiOrigin } from './view/panel.js'
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

    const stored = await settingsStore.readSettings()
    if (stored.subfolder && stored.subfolder !== DEFAULT_SUBFOLDER) {
      settingsStore.configure({ subfolder: stored.subfolder })
    }

    // 端口优先固定，OAuth 的 redirect_uri 才能跨会话稳定；被占用时退回随机端口。
    const preferredPort = Number(stored.localPort) > 0 ? Number(stored.localPort) : 0
    try {
      this.server = await startLocalServer({ preferredPort })
      setApiOrigin(this.server.origin)
      this.localPort = this.server.port
    } catch (error) {
      // 起不来也不能让整个插件挂掉：面板会显示「服务未就绪」，其余功能（设置页）还能用。
      this.server = null
      this.localPort = 0
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

    this.addSettingTab(new GetnoteSettingTab(this.app, this))

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
          ? `运行中：http://127.0.0.1:${this.plugin.localPort}`
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
