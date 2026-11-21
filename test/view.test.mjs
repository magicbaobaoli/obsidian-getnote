/**
 * 视图层验收：把打包后的 main.js 拉起来，用 jsdom 当 DOM，真的 new 一个
 * ItemView 并调 onOpen，确认 8000 行的 React 面板能挂进 Obsidian 的 contentEl。
 *
 * 和 panel.test.mjs 的区别：那个测的是「面板组件本身能不能渲染」，这个测的是
 * 「Obsidian 的 ItemView 外壳能不能把它接上」——contentEl、injectCss、心跳、
 * onClose 卸载，任何一环断了，用户看到的就是一个空白页签。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { createRequire } from 'node:module'
import { mkdtemp, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'app://obsidian.md/',
  pretendToBeVisual: true,
})
const { window } = dom

// React 18 的 createRoot 需要这些全局；Obsidian 的渲染进程本来就有。
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  if (window[key] !== undefined) globalThis[key] = window[key]
}
// navigator 在 Node 24 里是只读 getter，得用 defineProperty 盖过去
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = false
window.HTMLElement.prototype.scrollTo = function scrollTo() {}
window.HTMLElement.prototype.isShown = function isShown() { return true }
Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async () => undefined }, configurable: true })

// ── 假 obsidian 模块：ItemView 要给 contentEl 一套 Obsidian 的 DOM 扩展 ──────
const calls = { views: [], ribbons: [], commands: [], settings: [], intervals: [], timeouts: [], statusBar: [] }

function extendEl(el) {
  el.empty = () => {
    while (el.firstChild) el.removeChild(el.firstChild)
  }
  el.addClass = (c) => el.classList.add(c)
  el.removeClass = (c) => el.classList.remove(c)
  // Obsidian 的 createEl/createDiv 不只认 cls，还认 text 与 attr —— 兜底报错块
  // 全靠这两样把原因写到屏幕上，桩里缺了它们就会测成「什么都没画」。
  el.createEl = (tag, opts = {}) => {
    const child = el.ownerDocument.createElement(tag)
    if (opts.cls) child.className = opts.cls
    if (opts.text !== undefined) child.textContent = opts.text
    if (opts.attr) {
      for (const [key, value] of Object.entries(opts.attr)) child.setAttribute(key, String(value))
    }
    el.appendChild(child)
    return extendEl(child)
  }
  el.createDiv = (opts = {}) => el.createEl('div', opts)
  el.isShown = () => true
  return el
}

class Plugin {
  constructor(app, manifest) { this.app = app; this.manifest = manifest }
  registerView(type, factory) { calls.views.push({ type, factory }) }
  addRibbonIcon(icon, title, cb) { calls.ribbons.push({ icon, title, cb }); return { addClass() {} } }
  addCommand(cmd) { calls.commands.push(cmd); return cmd }
  addSettingTab(tab) { calls.settings.push(tab) }
  registerInterval(id) { calls.intervals.push(id); return id }
  register(fn) { return fn }
  registerEvent(ref) { return ref }
  registerDomEvent(el, type, handler) { return { el, type, handler } }
  addStatusBarItem() {
    const el = { text: '', title: '', addClass() {}, setText(t) { el.text = t }, addEventListener() {} }
    calls.statusBar.push(el)
    return el
  }
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = null } }
class Setting {
  constructor(el) { this.el = el }
  setName() { return this } setDesc() { return this } addText() { return this }
  addButton() { return this } addToggle() { return this } setButtonText() { return this } setCta() { return this }
  onClick() { return this } setPlaceholder() { return this } setValue() { return this } onChange() { return this }
}
class ItemView {
  constructor(leaf) {
    this.leaf = leaf
    this.contentEl = extendEl(window.document.createElement('div'))
    this.containerEl = this.contentEl
  }
  registerInterval(id) { calls.intervals.push(id); return id }
}
class Notice { constructor(message) { (calls.notices = calls.notices || []).push(message) } }

// 原生确认框：真宿主是 Obsidian 的 Modal。这里只要 open() 建出 contentEl、
// close() 走 onClose，测试就能模拟「点确定 / 点取消 / 按 Esc」三条路。
function extendModalEl(el) {
  el.empty = () => { while (el.firstChild) el.removeChild(el.firstChild) }
  el.createEl = (tag, opts = {}) => {
    const child = el.ownerDocument.createElement(tag)
    if (opts.text !== undefined) child.textContent = opts.text
    if (opts.cls) child.className = opts.cls
    el.appendChild(child)
    return child
  }
  el.createDiv = (opts = {}) => extendModalEl(el.createEl('div', opts))
  return el
}
class Modal {
  constructor(app) { this.app = app; this.contentEl = null; this.closed = false }
  open() {
    this.contentEl = extendModalEl(window.document.createElement('div'))
    if (typeof this.onOpen === 'function') this.onOpen()
    return this
  }
  close() {
    if (this.closed) return
    this.closed = true
    if (typeof this.onClose === 'function') this.onClose()
  }
}

// 快速切换器：真宿主是一个弹窗 + 输入框 + 候选列表，这里只留「能被子类化、
// 能拿到 getItems 的结果」这一层——测试真正要验的是「候选从库里来」和
// 「选中之后把路径投给面板」。
class FuzzySuggestModal {
  constructor(app) {
    this.app = app
    this.placeholder = ''
    this.opened = false
  }

  setPlaceholder(text) {
    this.placeholder = text
    return this
  }

  getItems() {
    return []
  }

  getItemText(item) {
    return String((item && item.title) || '')
  }

  onChooseItem() {}

  open() {
    this.opened = true
  }

  close() {
    this.opened = false
  }
}

class Menu {
  constructor() { this.items = [] }
  addItem(build) {
    const entry = {
      title: '',
      icon: '',
      handler: null,
      setTitle(v) { entry.title = v; return entry },
      setIcon(v) { entry.icon = v; return entry },
      onClick(fn) { entry.handler = fn; return entry },
    }
    build(entry)
    this.items.push(entry)
    return this
  }
  showAtMouseEvent() {}
}

const obsidianStub = { FuzzySuggestModal, Menu, Modal, Plugin, PluginSettingTab, Setting, ItemView, Notice, WorkspaceLeaf: class {} }

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'obsidian') return obsidianStub
  return originalLoad.call(this, request, parent, isMain)
}

// package.json 是 type:module，而 main.js 是 CJS 产物 —— 复制成 .cjs 再 require
const bundleDir = await mkdtemp(join(tmpdir(), 'dshgn-view-bundle-'))
const bundlePath = join(bundleDir, 'main.cjs')
await copyFile(new URL('../main.js', import.meta.url), bundlePath)
const require = createRequire(import.meta.url)
const GetnotePlugin = require(bundlePath).default

const BASE = (await mkdtemp(join(tmpdir(), 'dshgn 视图 库-'))).replace(/\\/g, '/')

const nodes = new Map([['', { dir: true }]])
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const adapter = {
  getBasePath: () => BASE,
  async exists(p) { return nodes.has(norm(p)) },
  async list(p) {
    const rel = norm(p)
    const prefix = rel === '' ? '' : rel + '/'
    const folders = []
    const files = []
    for (const key of nodes.keys()) {
      if (key === rel || !key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      if (rest.includes('/')) continue
      if (nodes.get(key).dir) folders.push(rest)
      else files.push(rest)
    }
    return { folders, files }
  },
  async read(p) { const n = nodes.get(norm(p)); if (!n || n.dir) throw new Error('ENOENT ' + p); return n.text ?? '' },
  async readBinary(p) { return new TextEncoder().encode(await this.read(p)).buffer },
  async stat(p) { const n = nodes.get(norm(p)); if (!n) return null; return { type: n.dir ? 'folder' : 'file', size: 0, mtime: Date.now(), ctime: Date.now() } },
  async mkdir(p) { const rel = norm(p); const par = parentOf(rel); if (par && !nodes.has(par)) throw new Error('ENOENT parent ' + par); nodes.set(rel, { dir: true }) },
  async write(p, data) { nodes.set(norm(p), { text: String(data) }) },
  async writeBinary(p, data) { nodes.set(norm(p), { bin: Buffer.from(data) }) },
  async append(p, data) { const rel = norm(p); const n = nodes.get(rel); nodes.set(rel, { text: (n && n.text ? n.text : '') + String(data) }) },
  async appendBinary(p, data) { await this.append(p, data) },
  async remove(p) { nodes.delete(norm(p)) },
  async rmdir(p) { nodes.delete(norm(p)) },
  async rename(a, b) { const n = nodes.get(norm(a)); nodes.delete(norm(a)); nodes.set(norm(b), n) },
  async copy(a, b) { nodes.set(norm(b), nodes.get(norm(a))) },
}

const app = {
  vault: {
    adapter,
    configDir: '.obsidian',
    on() { return {} },
    getAbstractFileByPath(path) {
      const rel = String(path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
      if (rel === '') return null
      return nodes.has(rel) ? { path: rel } : null
    },
  },
  workspace: {
    on() { return {} },
    getLeavesOfType: () => [],
    revealLeaf: () => undefined,
    getLeaf: () => ({ setViewState: async () => undefined }),
    openPopoutLeaf: () => ({ setViewState: async () => undefined }),
  },
}

const plugin = new GetnotePlugin(app, { id: 'getnote-brain', version: '0.1.0' })
await plugin.onload()

test('视图工厂能被注册出来', () => {
  assert.equal(calls.views.length, 1)
  assert.equal(calls.views[0].type, 'getnote-brain-view')
})

test('onOpen 把面板挂进 contentEl，并注入样式', async () => {
  const { factory } = calls.views[0]
  const view = factory({})
  await view.onOpen()

  // 挂载点存在
  const mount = view.contentEl.querySelector('.dshgn_mount')
  assert.ok(mount, '应该有 .dshgn_mount 挂载点')
  assert.ok(view.contentEl.classList.contains('dshgn_view'), 'contentEl 应该带上 dshgn_view')

  // injectCss 注入了样式表（STYLE_ID 去重，只该有一份）
  const styles = window.document.querySelectorAll('style#dshgn-style')
  assert.equal(styles.length, 1, '样式只该注入一次')
  assert.ok(styles[0].textContent.includes('.dshgn_root'), '样式表里应该有面板的根选择器')

  // 等 React 首次提交，面板真的渲染出来（不是空白）
  await new Promise((resolve) => window.setTimeout(resolve, 1200))
  const text = view.contentEl.textContent || ''
  assert.ok(text.length > 0, '面板不该是空白')
  assert.ok(!text.includes('面板渲染出错'), '不该掉进错误边界：' + text.slice(0, 200))

  // 心跳注册了定时器，且是 registerInterval 注册的（Obsidian 会在卸载时统一清）
  assert.ok(calls.intervals.length >= 1, '应该注册了心跳定时器')

  await view.onClose()
})

test('onClose 会把 React 树卸载干净，不给叶子留残余节点', async () => {
  const { factory } = calls.views[0]
  const view = factory({})
  await view.onOpen()
  await new Promise((resolve) => window.setTimeout(resolve, 500))
  assert.ok((view.contentEl.textContent || '').length > 0, '卸载前面板应该是有内容的')

  await view.onClose()
  await new Promise((resolve) => window.setTimeout(resolve, 300))
  // React 18 的 unmount 会把自己渲染的节点全部撤走。如果这里还剩内容，说明
  // onClose 里那次 setTimeout(() => root.unmount(), 0) 没跑到，叶子关掉之后
  // 面板的定时器/请求还在后台跑。
  assert.equal((view.contentEl.textContent || '').length, 0, '卸载后面板内容应该被清空')
  assert.ok(!window.document.querySelector('.dshgn_root'), 'DOM 里不该留下面板根节点')
})

test('渲染失败时把原因画到屏幕上，而不是留一片黑', async () => {
  const { factory } = calls.views[0]
  const view = factory({})
  // 真宿主里 ItemView 自带 app；测试桩只给了 contentEl，这里补上，
  // 好让「顺手落一份到插件目录」那条路也走一遍。
  view.app = app
  view.renderFatal(view.contentEl, new Error('测试用的渲染错误'))

  const fatal = view.contentEl.querySelector('.dshgn_fatal')
  assert.ok(fatal, '应该画出兜底报错块，而不是留一个空容器')
  const text = fatal.textContent || ''
  assert.ok(text.includes('得到大脑面板没能打开'), '应该有标题：' + text.slice(0, 120))
  assert.ok(text.includes('测试用的渲染错误'), '应该写出具体原因：' + text.slice(0, 200))
  assert.ok(fatal.querySelector('pre') !== null, '应该把堆栈也摊出来')

  // 兜底块不能依赖面板自己的 CSS —— 没画出来的原因很可能正是样式没注入成功
  const style = fatal.getAttribute('style') || ''
  assert.ok(style.includes('height:100%'), '兜底块要自带内联尺寸：' + style)

  // 同时落一份到插件目录，用户不用去翻控制台
  await new Promise((resolve) => window.setTimeout(resolve, 60))
  const saved = nodes.get('.obsidian/plugins/getnote-brain/panel-error.txt')
  assert.ok(saved && typeof saved.text === 'string', '应该把错误写进插件目录的 panel-error.txt')
  assert.ok(saved.text.includes('测试用的渲染错误'), '落盘内容要有原因：' + String(saved.text).slice(0, 160))
})

test('首帧没画出来时看门狗自己报出来，而不是让用户对着一片黑', async () => {
  const { factory } = calls.views[0]
  const view = factory({})
  // 看门狗要求容器真的在文档里（isConnected），否则它按「叶子已经关了」处理
  window.document.body.appendChild(view.contentEl)
  try {
    await view.onOpen()
    assert.ok(view.contentEl.querySelector('.dshgn_root') !== null, '正常渲染时根节点应该出现')
    // 模拟「渲染调用没抛错、但根节点不见了」：看门狗 2 秒后应该发现
    const root = view.contentEl.querySelector('.dshgn_root')
    root.parentNode.removeChild(root)
    await new Promise((resolve) => window.setTimeout(resolve, 2300))
    const fatal = view.contentEl.querySelector('.dshgn_fatal')
    assert.ok(fatal, '根节点不见了就该画出兜底报错')
    assert.ok(
      (fatal.textContent || '').includes('面板根节点没有出现'),
      '要报「没画出来」这件事本身：' + (fatal.textContent || '').slice(0, 160),
    )
  } finally {
    await view.onClose()
    if (view.contentEl.parentNode) view.contentEl.parentNode.removeChild(view.contentEl)
  }
})


test('启动轨迹落在 boot.txt 里：插件加载、服务就绪、视图挂载各留一行', async () => {
  // 「全黑、一个字都没有」最难的不是修，是先分清坏在哪一层。boot.txt 就是
  // 给这个用的：用户重开插件后，我们直接读文件就知道走到第几步。
  const bootPath = '.obsidian/plugins/getnote-brain/boot.txt'
  const { factory } = calls.views[0]
  const view = factory({})
  await view.onOpen()
  await new Promise((resolve) => window.setTimeout(resolve, 300))

  const saved = nodes.get(bootPath)
  assert.ok(saved && typeof saved.text === 'string', '应该把启动轨迹写进插件目录的 boot.txt')
  const text = String(saved.text)
  assert.ok(text.includes('onload 开始'), '要记下插件本体加载了：' + text)
  assert.ok(text.includes('视图已注册'), '要记下视图注册这一步：' + text)
  assert.ok(text.includes('视图 onOpen 被调用'), '要记下面板真的被挂载了：' + text)

  // 只记关键节点，不该把每帧渲染都刷进去
  assert.ok(text.split('\n').filter((line) => line.trim() !== '').length < 40, '轨迹不该刷屏：' + text)

  await view.onClose()
})
test('宿主把视图挂上却不调 onOpen 时，插件自己补一次，面板照样画出来', async () => {
  // 用户库里真的卡成这样过：setViewState 回来了、视图构造函数也跑了，boot.txt 里
  // 就是没有「视图 onOpen 被调用」——宿主把视图挂上就再也不管了，屏幕上一片黑。
  const { factory } = calls.views[0]
  const view = factory({})
  let opened = 0
  const realOnOpen = view.onOpen.bind(view)
  view.onOpen = async () => { opened += 1; return realOnOpen() }

  const realGetLeaf = app.workspace.getLeaf
  const leaf = { view, setViewState: async () => undefined, detach() {} }
  app.workspace.getLeaf = () => leaf
  // 服务得在，否则 activateView 会先去弹「本地服务还没就绪」然后回头
  const realServer = plugin.server
  if (!plugin.server) plugin.server = { origin: 'http://127.0.0.1:1' }
  try {
    await plugin.activateView()
    assert.equal(opened, 0, '这一轮宿主自己没调 onOpen')

    await new Promise((resolve) => window.setTimeout(resolve, 1900))
    assert.equal(opened, 1, '等了一会儿没人调，插件该自己补一次 onOpen')
    assert.ok(view.contentEl.querySelector('.dshgn_mount') !== null, '补调之后面板要真的挂上，而不是只有一行轨迹')

    // 宿主晚一步又想调一次：同一棵树不该被画两遍
    await view.onOpen()
    assert.equal(
      view.contentEl.querySelectorAll('.dshgn_mount').length,
      1,
      '补调过之后再被调一次，不该再铺一层挂载点',
    )
  } finally {
    app.workspace.getLeaf = realGetLeaf
    plugin.server = realServer
    await view.onClose()
  }
})

test('收尾：卸载插件，别把临时目录和监听留着', async () => {
  plugin.onunload()
  await rm(BASE, { recursive: true, force: true })
  await rm(bundleDir, { recursive: true, force: true })
})
