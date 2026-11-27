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
    // 面板挂载的那个容器（= contentEl）。
    //
    // 千万不能叫 containerEl：那是 Obsidian 自己的字段，宿主就是靠它把视图
    // 挂进叶子的。以前这里写 this.containerEl = null / = contentEl，等于把宿主
    // 挂视图用的那个节点换掉/清空——视图确实画了，画在一个没人挂到屏幕上的
    // 元素里，用户看到的永远是整片黑。这是「全黑」真正的根因。
    this.panelEl = null
    this.heartbeat = null
    // injectCss() 返回的清理函数：样式挂在 document 上，React 卸载带不走。
    this.removeCss = null
    // onOpen 只会生效一次：宿主偶尔会把视图挂上却不调 onOpen，插件这边会自己补一次，
    // 之后宿主再调一次时这个标记把第二次挡掉，免得同一棵树被画两遍。
    this.opened = false
    // 构造函数跑没跑，是「视图工厂根本没被调」和「onOpen 里炸了」之间唯一的分界。
    // 两件事在屏幕上都是空白，但修法完全不同，所以这里也留一行。
    try {
      if (plugin && typeof plugin.probe === 'function') plugin.probe('视图构造函数已跑')
    } catch {
      // 诊断失败不影响渲染
    }
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

  /**
   * 渲染失败时把原因摆到屏幕上，而不是留一片空白。
   *
   * 面板是 React 树，onOpen 里任何一步抛错（样式注入、createRoot、首帧渲染）
   * 都会让这个叶子只剩一个空容器——用户看到的就是「全黑、什么都没有」，
   * 既不知道出了什么事，也没法把错误贴给我们。这里把异常接住，用内联样式
   * 画一段可读的报错（不依赖面板自己的 CSS，因为它可能正是没注入成功的那一环），
   * 同时照常打到控制台，方便复制完整栈。
   */
  renderFatal(container, error) {
    this.note(`renderFatal：${error && error.message ? error.message : error}`)
    const message = String((error && error.message) || error || '未知错误')
    const stack = String((error && error.stack) || '')
      .split('\n')
      .slice(0, 8)
      .join('\n')
    console.error('得到大脑：面板打开失败', error)
    // 同时落一份到插件目录：用户不一定愿意去翻控制台，而这一份文件
    // 下次排查时能直接读到，不用来回问「屏幕上写了什么」。
    try {
      const adapter = this.app && this.app.vault ? this.app.vault.adapter : null
      const dir = this.app && this.app.vault ? this.app.vault.configDir : '.obsidian'
      if (adapter && typeof adapter.write === 'function') {
        const body = ['[得到大脑] 面板打开失败', new Date().toISOString(), message, '', stack, ''].join('\n')
        void adapter.write(`${dir}/plugins/getnote-brain/panel-error.txt`, body).catch(() => {})
      }
    } catch {
      // 写不进去（只读库、权限）不影响屏幕上那份
    }
    try {
      // 占位那行「正在打开…」先撤掉：报错下面还挂着一句「正在打开」会把用户带偏。
      const boot = container.querySelector('.dshgn_boot')
      if (boot && boot.parentNode) boot.parentNode.removeChild(boot)
      const box = container.createDiv({ cls: 'dshgn_fatal' })
      box.setAttribute(
        'style',
        [
          'box-sizing:border-box',
          'padding:18px 20px',
          'font:13px/1.6 var(--font-interface,sans-serif)',
          'color:var(--text-normal,#ddd)',
          'background:var(--background-primary,#1e1e1e)',
          'overflow:auto',
          'height:100%',
        ].join(';'),
      )
      box.createDiv({
        text: '得到大脑面板没能打开',
        attr: { style: 'font-size:15px;font-weight:600;margin-bottom:8px' },
      })
      box.createDiv({ text: message, attr: { style: 'margin-bottom:10px;word-break:break-word' } })
      if (stack !== '') {
        box.createEl('pre', {
          text: stack,
          attr: {
            style:
              'margin:0;padding:10px;border-radius:6px;background:var(--background-secondary,#2a2a2a);' +
              'font:11px/1.5 var(--font-monospace,monospace);white-space:pre-wrap;word-break:break-word',
          },
        })
      }
      box.createDiv({
        text: '把上面这段文字发给开发者，或者按 Ctrl+Shift+I 打开控制台看完整报错。',
        attr: { style: 'margin-top:10px;opacity:.7' },
      })
    } catch {
      // 连兜底都画不出来（容器已经被移除），至少控制台里有记录
    }
  }

  /** 往插件的 boot.txt 追加一行；插件没提供就静默跳过（测试里没有）。 */
  note(line) {
    try {
      if (this.plugin && typeof this.plugin.probe === 'function') this.plugin.probe(line)
    } catch {
      // 诊断失败不影响渲染
    }
  }

  /**
   * 在面板位置上先摆一行字，纯内联样式、零依赖。
   *
   * 这一行存在的唯一理由：面板没画出来时，用户看到的必须是「一句话」而不是「一片黑」。
   * 一片黑没法区分「插件没加载」「视图没挂上」「首帧卡住」，而这三件事的修法完全不同。
   */
  placeholder(container) {
    try {
      const box = container.createDiv({ cls: 'dshgn_boot' })
      box.setAttribute(
        'style',
        [
          'box-sizing:border-box',
          'height:100%',
          'padding:28px 32px',
          'font:13px/1.7 system-ui,sans-serif',
          'color:var(--text-normal,#ddd)',
          'background:var(--background-primary,#1e1e1e)',
          'overflow:auto',
        ].join(';'),
      )
      box.createDiv({ text: '得到大脑正在打开…' })
      const tip = box.createDiv({
        text: '这行字两秒内不消失，就说明面板卡在启动里了。稍等之后还是一片空白的话，把 .obsidian/plugins/getnote-brain/boot.txt 发给开发者。',
      })
      tip.setAttribute('style', 'margin-top:8px;font-size:12px;opacity:.72')
      return box
    } catch {
      return null
    }
  }

  /** 把渲染进程里的未捕获异常写进 boot.txt —— 那些错误不会走到我们的 try/catch 里。 */
  watchWindowErrors(container) {
    try {
      const win = container.ownerDocument && container.ownerDocument.defaultView
      if (!win || typeof win.addEventListener !== 'function') return
      this.errorHandler = (event) => {
        const err = event && (event.error || event.reason)
        const text = err && err.stack ? err.stack : String((event && event.message) || err || '未知错误')
        this.note(`未捕获异常：${text.split('\n').slice(0, 3).join(' | ')}`)
      }
      win.addEventListener('error', this.errorHandler)
      win.addEventListener('unhandledrejection', this.errorHandler)
      this.errorWindow = win
    } catch {
      // 诊断失败不影响渲染
    }
  }

  async onOpen() {
    this.note('视图 onOpen 被调用')
    // 宿主偶尔把视图挂上就不再管了：构造函数跑了、onOpen 一次都没调，屏幕上是一片黑
    // （用户库里真的出现过，boot.txt 里只有「视图构造函数已跑」没有「onOpen」）。
    // 那种情况下插件会自己补调一次 onOpen，这里靠标记保证只画一次。
    if (this.opened) return
    this.opened = true
    const container = this.contentEl
    try {
      await this.openPanel(container)
    } catch (error) {
      this.renderFatal(container, error)
    }
  }

  /** 真正的挂载流程；异常交给 onOpen 兜住并画到屏幕上。 */
  async openPanel(container) {
    // 样式表挂在 document 上，不属于这棵 React 树，所以清理函数得自己收着，
    // 关视图时调用——不然 <style id="dshgn-style"> 会一直留在宿主窗口里。
    if (this.removeCss !== null && this.removeCss !== undefined) this.removeCss()
    this.removeCss = injectCss()

    // 正文交给 Obsidian 自己的渲染器：callout、公式、Mermaid、脚注、嵌入块、
    // 双链、以及 Dataview/Bases 的查询块才能出得来。渲染器要在 'obsidian'
    // 模块上，而面板的离线测试跑在纯 Node 里没有它，所以从这里注入。
    setMarkdownHost({ app: this.app, component: this.plugin, MarkdownRenderer })

    // 视图容器的默认样式（padding、overflow）会把面板的三栏布局挤变形，
    // 这里自己接管滚动与内边距，让面板贴满整个叶子。
    container.empty()
    container.addClass('dshgn_view')
    this.panelEl = container

    const mount = container.createDiv({ cls: 'dshgn_mount' })
    // 先铺一层纯内联样式的占位字。它不依赖任何 CSS、不依赖 React、也不等数据：
    // 面板首帧真要挂住（异步分支卡死、渲染进程报错被吞），用户至少看得见一句话，
    // 而不是对着一片黑猜「是不是插件没装上」。面板一画出来就把它删掉。
    this.placeholder(container)
    this.note('容器已就绪，开始首帧渲染')
    this.root = createRoot(mount)
    this.root.render(React.createElement(PanelRoot, { plugin: this.plugin }))
    // 「画了」和「画在屏幕上」是两件事：容器要是没被宿主挂进文档，
    // 渲染照样成功、DOM 里节点齐全，用户看到的却是一片黑。这一行就是分界。
    this.note('首帧渲染调用已返回' + (container.isConnected === false ? '（容器不在文档里）' : ''))
    // 渲染进程里的未捕获异常/未处理拒绝：Obsidian 的控制台用户不会去看，
    // 但这两类错误正是「界面一片空白且什么都没抛到我们手里」的常见来源。
    // 挂一次，把消息写进 boot.txt，重开面板时就能看到上一次死在哪。
    this.watchWindowErrors(container)

    // 「仅前台同步」靠这个心跳判断背后还有没有人在看。视图不可见时
    // Obsidian 不会调 onResize 之类的事件，所以用一个便宜的定时器，
    // 每 20 秒补一次；面板自己也会在交互时上报。
    const beat = () => {
      if (!this.panelEl || !this.panelEl.isShown()) return
      this.plugin.markPanelVisible()
    }
    beat()
    this.heartbeat = window.setInterval(beat, 20000)
    this.registerInterval(this.heartbeat)

    // 看门狗：渲染调用不抛错，不等于面板真的画出来了。
    //
    // 要分清的三种「全黑」：
    //   ① 容器根本没被挂进文档 —— 渲染全对、DOM 齐全，画在屏幕外；
    //   ② 根节点没出现 —— 首帧被某个异步分支吞掉；
    //   ③ 根节点在、高度 0 —— 渲染成功，是布局把它压扁了。
    // 三件事在屏幕上长得一模一样，修法完全不同，所以报错要分开写。
    //
    // 每 400ms 回看一次、最多 5 秒：容器的 isConnected 会晚于 onOpen 成立
    // （宿主先把视图摆上去，再把节点挂进叶子），一上来就判定「屏幕外」
    // 会把正常挂载误报成故障。等到真的画出来就停。
    let tries = 0
    const watchdog = () => {
      if (this.panelEl !== container) return
      tries += 1
      const root = container.querySelector('.dshgn_root')
      const live = container.isConnected !== false
      if (root !== null && live) {
        this.note(`看门狗：根节点在，高度 ${root.clientHeight}`)
        const boot = container.querySelector('.dshgn_boot')
        if (boot && boot.parentNode) boot.parentNode.removeChild(boot)
        if (root.clientHeight === 0) {
          this.renderFatal(
            container,
            new Error(`面板根节点高度为 0（容器高度 ${container.clientHeight}px）—— 布局没有撑开`),
          )
        }
        return
      }
      if (tries < 12) {
        window.setTimeout(watchdog, 400)
        return
      }
      if (!live) {
        this.note('看门狗：容器没被挂进文档，面板画在屏幕外')
        this.renderFatal(container, new Error('面板容器没有挂进宿主窗口（画在屏幕外了）'))
        return
      }
      this.note('看门狗：根节点没出现')
      this.renderFatal(container, new Error('面板根节点没有出现（首帧没有渲染完成）'))
    }
    window.setTimeout(watchdog, 400)
  }

  async onClose() {
    // 叶子被复用时（Obsidian 会重开同一个视图对象）得允许再画一次。
    this.opened = false
    clearMarkdownHost()
    // 样式是我们自己注进 document 的，React 卸载不会带走它，得手动摘。
    if (this.removeCss !== null && this.removeCss !== undefined) {
      this.removeCss()
      this.removeCss = null
    }
    // 占位那行字是 onOpen 自己摆的，不属于 React 树：视图关掉时它得跟着走，
    // 否则叶子被复用时上一次的「正在打开…」会留在新面板底下。
    try {
      const boot = this.panelEl ? this.panelEl.querySelector('.dshgn_boot') : null
      if (boot && boot.parentNode) boot.parentNode.removeChild(boot)
    } catch {
      // 容器已经没了，占位字跟着一起没
    }
    try {
      if (this.errorWindow && this.errorHandler) {
        this.errorWindow.removeEventListener('error', this.errorHandler)
        this.errorWindow.removeEventListener('unhandledrejection', this.errorHandler)
      }
    } catch {
      // 窗口已经没了，监听跟着一起没，不必管
    }
    this.errorWindow = null
    this.errorHandler = null
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
