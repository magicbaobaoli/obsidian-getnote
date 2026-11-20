/*
 * view/view.js —— Obsidian 的 ItemView 外壳
 *
 * 面板本体是 panel.js 里那个从 DSH 版机械移植过来的 React 组件树，
 * 这里只做三件事：给 React 一个容器、在视图可见时上报心跳、卸载时清干净。
 */

import { ItemView, MarkdownRenderer, WorkspaceLeaf } from 'obsidian'
import * as React from 'preact/compat'
import { createRoot } from 'preact/compat/client'
import { PanelRoot, PanelIcon, injectCss } from './panel.js'
import { setMarkdownHost, clearMarkdownHost } from './markdown.js'

export const VIEW_TYPE_GETNOTE = 'getnote-brain-view'

export class GetnoteView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf)
    this.plugin = plugin
    this.root = null
    this.containerEl = null
    this.heartbeat = null
  }

  getViewType() {
    return VIEW_TYPE_GETNOTE
  }

  getDisplayText() {
    return '得到大脑'
  }

  getIcon() {
    return 'brain'
  }

  async onOpen() {
    injectCss()

    // 正文交给 Obsidian 自己的渲染器：callout、公式、Mermaid、脚注、嵌入块、
    // 双链、以及 Dataview/Bases 的查询块才能出得来。渲染器要在 'obsidian'
    // 模块上，而面板的离线测试跑在纯 Node 里没有它，所以从这里注入。
    setMarkdownHost({ app: this.app, component: this.plugin, MarkdownRenderer })

    // 视图容器的默认样式（padding、overflow）会把面板的三栏布局挤变形，
    // 这里自己接管滚动与内边距，让面板贴满整个叶子。
    const container = this.contentEl
    container.empty()
    container.addClass('dshgn_view')
    this.containerEl = container

    const mount = container.createDiv({ cls: 'dshgn_mount' })
    this.root = createRoot(mount)
    this.root.render(React.createElement(PanelRoot, { plugin: this.plugin }))

    // 「仅前台同步」靠这个心跳判断背后还有没有人在看。视图不可见时
    // Obsidian 不会调 onResize 之类的事件，所以用一个便宜的定时器，
    // 每 20 秒补一次；面板自己也会在交互时上报。
    const beat = () => {
      if (!this.containerEl || !this.containerEl.isShown()) return
      this.plugin.markPanelVisible()
    }
    beat()
    this.heartbeat = window.setInterval(beat, 20000)
    this.registerInterval(this.heartbeat)
  }

  async onClose() {
    clearMarkdownHost()
    if (this.heartbeat !== null) {
      window.clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    const root = this.root
    this.root = null
    // React 18 的 unmount 必须异步让出一帧，否则会和 Obsidian 移除 DOM 打架
    if (root) {
      window.setTimeout(() => {
        try {
          root.unmount()
        } catch {
          // 容器已经被移除了，忽略
        }
      }, 0)
    }
  }
}

export { PanelIcon, WorkspaceLeaf }
