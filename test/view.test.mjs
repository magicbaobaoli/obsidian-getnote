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
const calls = { views: [], ribbons: [], commands: [], settings: [], intervals: [], timeouts: [] }

function extendEl(el) {
  el.empty = () => {
    while (el.firstChild) el.removeChild(el.firstChild)
  }
  el.addClass = (c) => el.classList.add(c)
  el.removeClass = (c) => el.classList.remove(c)
  el.createDiv = (opts = {}) => {
    const child = el.ownerDocument.createElement('div')
    if (opts.cls) child.className = opts.cls
    el.appendChild(child)
    return extendEl(child)
  }
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
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = null } }
class Setting {
  constructor(el) { this.el = el }
  setName() { return this } setDesc() { return this } addText() { return this }
  addButton() { return this } setButtonText() { return this } setCta() { return this }
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

const obsidianStub = { Plugin, PluginSettingTab, Setting, ItemView, Notice, WorkspaceLeaf: class {} }

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
  vault: { adapter, configDir: '.obsidian', on() { return {} } },
  workspace: {
    getLeavesOfType: () => [],
    revealLeaf: () => undefined,
    getLeaf: () => ({ setViewState: async () => undefined }),
    openPopoutLeaf: () => ({ setViewState: async () => undefined }),
  },
}

const plugin = new GetnotePlugin(app, { id: 'getnote-obsidian', version: '0.1.0' })
await plugin.onload()

test('视图工厂能被注册出来', () => {
  assert.equal(calls.views.length, 1)
  assert.equal(calls.views[0].type, 'getnote-obsidian-view')
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

test('收尾：卸载插件，别把临时目录和监听留着', async () => {
  plugin.onunload()
  await rm(BASE, { recursive: true, force: true })
  await rm(bundleDir, { recursive: true, force: true })
})
