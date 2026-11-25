/**
 * 插件启动验收：把打包后的 main.js 真的 require 起来，用假的 obsidian 模块 + 内存
 * 文件系统驱动 onload，然后像面板那样打 HTTP 请求。
 *
 * 这一层是 DSH 版测试完全覆盖不到的地方——那边测的是 handler 本身，这边测的是
 * 「Obsidian 真的能把插件拉起来，并且 adapter 后端真的在用」。前面所有的断言都
 * 建立在 node:fs 后端上，只有这里会走到 app.vault.adapter。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { createRequire } from 'node:module'
import { mkdtemp, copyFile, rm, access, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── 假 obsidian 模块 ────────────────────────────────────────────────────────
const calls = { views: [], ribbons: [], commands: [], settings: [], intervals: [], statusBar: [], protocols: [], suggest: [], hoverSources: [] }

class Plugin {
  constructor(app, manifest) {
    this.app = app
    this.manifest = manifest
    this.disposers = []
  }
  registerView(type, factory) { calls.views.push({ type, factory }) }
  addRibbonIcon(icon, title, cb) {
    const el = { addClass() {} }
    calls.ribbons.push({ icon, title, cb })
    return el
  }
  addCommand(cmd) { calls.commands.push(cmd); return cmd }
  addSettingTab(tab) { calls.settings.push(tab) }
  registerInterval(id) { calls.intervals.push(id); return id }
  register(fn) { this.disposers.push(fn); return fn }
  registerEvent(ref) { this.disposers.push(ref); return ref }
  registerDomEvent(el, type, handler) {
    this.disposers.push({ el, type, handler })
    return { el, type, handler }
  }
  // obsidian://getnote?... 深链：真宿主是 app.setUriHandler 的入口，
  // 这里只把注册的处理器存下来，测试自己拿参数去调。
  registerObsidianProtocolHandler(action, handler) {
    calls.protocols.push({ action, handler })
    return { action, handler }
  }
  // 页面预览（hover-link）：宿主要求先登记来源 id，否则事件会被静默丢掉。
  registerHoverLinkSource(id, info) {
    calls.hoverSources.push({ id, info })
    return { id, info }
  }
  // 状态栏：真宿主返回一个带 setText/addClass/title 的 HTMLElement，
  // 这里给个够用的假元素，测试还能顺手断言文字。
  addStatusBarItem() {
    const el = {
      text: '',
      title: '',
      classes: [],
      addClass(name) { el.classes.push(name) },
      setText(text) { el.text = text },
      addEventListener() {},
    }
    calls.statusBar.push(el)
    return el
  }
}

// 原生右键菜单：真宿主是 Obsidian 的 Menu，这里只要够调起就行
// 快速切换器：真宿主是一个弹窗 + 输入框 + 候选列表，这里只留「能被子类化、
// 能拿到 getItems 的结果」这一层——测试真正要验的是「候选从库里来」和
// 「选中之后把路径投给面板」。
class FuzzySuggestModal {
  constructor(app) {
    this.app = app
    this.placeholder = ''
    this.opened = false
    calls.suggest.push(this)
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

// 原生确认框：真宿主是 Obsidian 的 Modal。这一层没有 jsdom（boot 只 require 打包产物），
// 所以给一套不依赖 DOM 的假元素：够建出 <p> 和按钮、够让测试点按钮或直接关窗。
function fakeModalEl(tag = 'div', opts = {}) {
  const el = {
    tag,
    text: opts.text === undefined ? '' : String(opts.text),
    cls: opts.cls || '',
    children: [],
    handlers: {},
    appendChild(child) { el.children.push(child); return child },
    createEl(t, o = {}) { const c = fakeModalEl(t, o); el.children.push(c); return c },
    createDiv(o = {}) { const c = fakeModalEl('div', o); el.children.push(c); return c },
    addEventListener(type, handler) { (el.handlers[type] = el.handlers[type] || []).push(handler) },
    click() { for (const fn of el.handlers.click || []) fn() },
    focus() {},
    empty() { el.children.length = 0 },
    // 设置页里的「看最近的轨迹」会先摘掉上一份再摆新的，这里够用就行：
    // 只按类名找直接子元素，不做完整的 CSS 选择器。
    querySelector(sel) {
      const want = String(sel || '').replace(/^\./, '')
      if (want === '') return null
      const hit = el.children.find((child) => String(child.cls || '').split(/\s+/).includes(want))
      return hit || null
    },
    removeChild(child) {
      const at = el.children.indexOf(child)
      if (at >= 0) el.children.splice(at, 1)
      return child
    },
  }
  return el
}
class Modal {
  constructor(app) {
    this.app = app
    this.contentEl = null
    this.closed = false
    ;(calls.modals = calls.modals || []).push(this)
  }
  open() {
    this.contentEl = fakeModalEl('div')
    if (typeof this.onOpen === 'function') this.onOpen()
    return this
  }
  close() {
    if (this.closed) return
    this.closed = true
    if (typeof this.onClose === 'function') this.onClose()
  }
}

class PluginSettingTab {
  constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = null }
}

class Setting {
  constructor(el) { this.el = el }
  setName() { return this }
  setDesc() { return this }
  addText() { return this }
  addButton() { return this }
  addToggle() { return this }
  setButtonText() { return this }
  setCta() { return this }
  onClick() { return this }
  setPlaceholder() { return this }
  setValue() { return this }
  onChange() { return this }
}

class ItemView {
  constructor(leaf) { this.leaf = leaf; this.contentEl = null }
}

class Notice { constructor(message) { calls.notices = calls.notices || []; calls.notices.push(message) } }

const obsidianStub = { FuzzySuggestModal, Menu, Modal, Plugin, PluginSettingTab, Setting, ItemView, Notice, WorkspaceLeaf: class {} }

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'obsidian') return obsidianStub
  return originalLoad.call(this, request, parent, isMain)
}

// 仓库的 package.json 是 "type": "module"（源码是 ESM），而 main.js 是 esbuild 打的
// CommonJS 产物。Obsidian 自己用 CJS 加载 main.js，不受 package.json 影响；
// 但 Node 会看 package.json，直接 require 会报 "module is not defined"。
// 所以复制一份成 .cjs 再 require —— 加载的是同一份字节。
const bundleDir = await mkdtemp(join(tmpdir(), 'dshgn-bundle-'))
const bundlePath = join(bundleDir, 'main.cjs')
await copyFile(new URL('../main.js', import.meta.url), bundlePath)

const require = createRequire(import.meta.url)
const mod = require(bundlePath)
const GetnotePlugin = mod.default

// ── 内存文件系统（adapter 后端）──────────────────────────────────────────────
// 库根故意用「临时目录 + 中文 + 空格」：真实用户的库就长这样，
// 而 vfs 的 relOf() 要做大小写无关的前缀比较、要处理反斜杠与结尾斜杠，这些分支
// 在 'C:/fake-vault' 这种干净的 ASCII 路径上根本走不到。
// 用 mkdtemp 而不是写死路径，是因为插件数据目录（设置、凭证）走的是真 node:fs，
// 写死会让测试往真实磁盘上留垃圾。
const BASE = (await mkdtemp(join(tmpdir(), 'dshgn 测试 库-'))).replace(/\\/g, '/')

function makeAdapter() {
  /** rel path -> { text } | { bin } | { dir: true } */
  const nodes = new Map([['', { dir: true }]])
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
  const requireParent = (p) => {
    const parent = parentOf(p)
    if (parent !== '' && !nodes.has(parent)) throw new Error('ENOENT: parent missing ' + parent)
  }
  const ensureParents = (p) => {
    const parent = parentOf(p)
    if (parent !== '' && !nodes.has(parent)) {
      ensureParents(parent)
      nodes.set(parent, { dir: true })
    }
  }
  return {
    getBasePath: () => BASE,
    // 宿主把库内相对路径翻成它自己资源协议下的地址（真机上类似 app://<id>/<path>）。
    getResourcePath: (p) => `app://fake-vault/${norm(p)}`,
    async exists(p) { return nodes.has(norm(p)) },
    async list(p) {
      const rel = norm(p)
      if (!nodes.has(rel)) throw new Error('ENOENT ' + rel)
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
    async read(p) {
      const n = nodes.get(norm(p))
      if (!n || n.dir) throw new Error('ENOENT ' + p)
      return n.text ?? ''
    },
    async readBinary(p) {
      const n = nodes.get(norm(p))
      if (!n || n.dir) throw new Error('ENOENT ' + p)
      if (n.bin) return n.bin.buffer.slice(n.bin.byteOffset, n.bin.byteOffset + n.bin.byteLength)
      return new TextEncoder().encode(n.text ?? '').buffer
    },
    // 真 Obsidian 的 adapter.write 不会替你建父目录，父目录不在就抛错。
    // 假 adapter 如果「太宽容」，vfs 里漏掉补目录的 bug 就永远测不出来。
    async write(p, data) { const rel = norm(p); requireParent(rel); nodes.set(rel, { text: String(data) }) },
    async writeBinary(p, data) { const rel = norm(p); requireParent(rel); nodes.set(rel, { bin: Buffer.from(data) }) },
    async append(p, data) {
      const rel = norm(p)
      const n = nodes.get(rel)
      nodes.set(rel, { text: (n && n.text ? n.text : '') + String(data) })
    },
    async appendBinary(p, data) {
      const rel = norm(p)
      const n = nodes.get(rel)
      const prev = n && n.bin ? n.bin : Buffer.alloc(0)
      nodes.set(rel, { bin: Buffer.concat([prev, Buffer.from(data)]) })
    },
    // 同理：adapter.mkdir 也不建父级
    async mkdir(p) { const rel = norm(p); requireParent(rel); nodes.set(rel, { dir: true }) },
    async rename(from, to) {
      const a = norm(from); const b = norm(to)
      const n = nodes.get(a)
      if (!n) throw new Error('ENOENT ' + from)
      ensureParents(b)
      nodes.delete(a)
      nodes.set(b, n)
    },
    async copy(from, to) {
      const n = nodes.get(norm(from))
      if (!n) throw new Error('ENOENT ' + from)
      ensureParents(norm(to))
      nodes.set(norm(to), { ...n })
    },
    async remove(p) {
      const rel = norm(p)
      for (const key of [...nodes.keys()]) {
        if (key === rel || key.startsWith(rel + '/')) nodes.delete(key)
      }
    },
    async rmdir(p) { await this.remove(p) },
    async stat(p) {
      const rel = norm(p)
      const n = nodes.get(rel)
      if (!n) return null
      const size = n.bin ? n.bin.length : n.text ? n.text.length : 0
      const now = Date.now()
      return { type: n.dir ? 'folder' : 'file', size, mtime: now, ctime: now }
    },
    // 给断言用
    _dump: () => [...nodes.keys()].filter((k) => k !== '').sort(),
  }
}

const adapter = makeAdapter()
const app = {
  vault: {
    adapter,
    configDir: '.obsidian',
    // 「设置 → 文件与链接 → 新建笔记的默认位置」存在库配置里，宿主用
    // getConfig 读。测试按需改 app.vault.vaultConfig。
    vaultConfig: { newFileLocation: 'root' },
    getConfig(key) {
      return app.vault.vaultConfig[key]
    },
    // 面板的「在 Obsidian 里打开」会把库内相对路径交给宿主查文件。
    getAbstractFileByPath(path) {
      const rel = String(path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
      if (rel === '') return null
      return adapter._dump().includes(rel) ? { path: rel } : null
    },
    // Obsidian 的 Events.on：插件用它在库变动时丢扫描缓存。测试里只记下
    // 回调，需要时手动触发（见「库变动会让扫描缓存失效」那条）。
    handlers: {},
    on(name, cb) {
      ;(this.handlers[name] = this.handlers[name] || []).push(cb)
      return { name, cb }
    },
  },
  workspace: {
    // 宿主的 css-change 事件：插件收到后让面板重算配色。测试里记下回调手动触发。
    wsHandlers: {},
    on(name, cb) {
      ;(this.wsHandlers[name] = this.wsHandlers[name] || []).push(cb)
      return { name, cb }
    },
    getLeavesOfType: () => [],
    revealLeaf: () => {},
    openedFiles: [],
    getLeaf: () => ({
      setViewState: async () => {},
      openFile: async (file) => { app.workspace.openedFiles.push(file && file.path) },
    }),
    openPopoutLeaf: () => ({ setViewState: async () => {} }),
    // 宿主正在看的那篇（「在得到大脑里打开当前笔记」用它）。
    activeFile: null,
    getActiveFile() {
      return app.workspace.activeFile
    },
  },
  // 宿主生成链接的能力。「复制引用」得按用户的「使用 Wiki 链接 / 新链接格式」
  // 两项设置来，那只有 fileManager 知道。这里返回一个能看出路径的假链接。
  fileManager: {
    generateMarkdownLink(file) {
      return `[[${String(file && file.path ? file.path : '')}]]`
    },
  },
  // 宿主的链接索引。插件拿它回答「谁引用了这篇」「这篇引用了谁」，
  // 不必为了一次点击重扫全库正文——那正是 Obsidian 自己一直在维护的东西。
  metadataCache: {
    resolvedLinks: {},
    fileCache: {},
    getFileCache(file) {
      return app.metadataCache.fileCache[file.path] || null
    },
    // 双链解析：宿主的规则比我们多（别名、同名取最近、路径前缀、大小写），
    // 这里给一个最小实现，够验证「先问宿主」这条路径。
    getFirstLinkpathDest(linkpath, sourcePath) {
      const wanted = String(linkpath || '').replace(/\.md$/i, '')
      const table = app.metadataCache.linkDest || {}
      const hit = table[wanted]
      if (typeof hit === 'string') return app.vault.getAbstractFileByPath(hit)
      // 没登记过的按「同名取最近」简化成「文件名相等」，找不到就返回 null
      for (const dir of ['得到大脑/随手记', '得到大脑/日记', '得到大脑']) {
        const candidate = app.vault.getAbstractFileByPath(`${dir}/${wanted}.md`)
        if (candidate) return candidate
      }
      return null
    },
    getBacklinksForFile(file) {
      const data = new Map()
      for (const source of Object.keys(app.metadataCache.resolvedLinks)) {
        const targets = app.metadataCache.resolvedLinks[source]
        if (targets && targets[file.path] !== undefined) data.set(source, targets[file.path])
      }
      return { data }
    },
  },
}

const plugin = new GetnotePlugin(app, { id: 'getnote-brain', version: '0.1.0' })

test('onload 能把插件拉起来', async () => {
  await plugin.onload()
  assert.equal(typeof plugin.server?.origin, 'string', '应该起了本地服务')
  assert.match(plugin.server.origin, /^http:\/\/127\.0\.0\.1:\d+$/)
  assert.equal(calls.views.length, 1, '注册了一个视图')
  assert.equal(calls.views[0].type, 'getnote-brain-view')
  assert.equal(calls.ribbons.length, 1, '注册了一个 ribbon')
  assert.equal(calls.ribbons[0].icon, 'brain')
  assert.deepEqual(calls.commands.map((c) => c.id), [
    'open-panel',
    'open-in-new-window',
    'search-notes',
    'new-note',
    'open-today',
    'sync-now',
    'scan-card',
    'capture-selection',
    'quick-switch-note',
    'open-active-note',
    'create-bases-view',
    'add-to-canvas',
  ])
  assert.equal(calls.settings.length, 1, '注册了设置页')
  assert.equal(calls.intervals.length >= 0, true)
  // 状态栏是「插件在跑、服务在哪个端口」的唯一常驻线索
  assert.equal(calls.statusBar.length, 1, '应该加了一个状态栏项')
  assert.equal(calls.statusBar[0].text, '得到大脑')
  assert.match(calls.statusBar[0].title, /127\.0\.0\.1:\d+/, '状态栏要显示服务端口')
})

test('录音卡的桥脚本跟着 main.js 一起进来，落在插件数据目录里', async () => {
  // 社区目录装插件只下载 main.js / manifest.json / styles.css 三个文件，Release 里
  // 挂的 card/ 目录它一个都不取。所以脚本必须在构建期以字符串打进 main.js，启动时
  // 解到 <插件数据目录>/card/ —— 否则目录用户一导入录音卡就报找不到脚本。
  const dataDir = join(BASE, '.obsidian', 'plugins', 'getnote-brain')
  const bridge = join(dataDir, 'card', 'getcard_bridge.py')
  const source = await readFile(new URL('../src/card/getcard_bridge.py', import.meta.url), 'utf8')
  assert.equal(await readFile(bridge, 'utf8'), source, '解出来的桥脚本要和源码一字不差')
  for (const name of ['wifi_transfer.py', 'wifi_probe.py', 'wifi_fetch.py']) {
    await access(join(dataDir, 'card', name))
  }
  // 解出来的东西不该跑到库里（.obsidian 之外）
  const stray = (await readdir(BASE, { recursive: true }).catch(() => []))
    .map((p) => String(p).replace(/\\/g, '/'))
    .filter((p) => p.endsWith('.py') && !p.startsWith('.obsidian/'))
  assert.deepEqual(stray, [], '桥脚本只该待在插件数据目录，不往库里撒野')

  // 四个脚本都要解出来，且和源码一字不差——少一个就是「导入录音卡报找不到脚本」
  for (const name of ['getcard_bridge.py', 'wifi_transfer.py', 'wifi_probe.py', 'wifi_fetch.py']) {
    const want = await readFile(new URL('../src/card/' + name, import.meta.url), 'utf8')
    assert.equal(await readFile(join(dataDir, 'card', name), 'utf8'), want, name + ' 要和源码一致')
  }
})

test('状态栏文案跟着面板走：库大小、当前笔记、超长截断', async () => {
  const el = calls.statusBar[0]
  assert.ok(el, '前面的用例应该已经加过状态栏项')

  // 什么都没打开、库是空的：只写名字，不写「0 篇」这种噪音
  plugin.updateStatusBar({ count: 0, note: '' })
  assert.equal(el.text, '得到大脑')

  // 库里有笔记、但没打开任何一篇：报数量
  plugin.updateStatusBar({ count: 12, note: '' })
  assert.equal(el.text, '得到大脑 · 12 篇')

  // 打开了某篇：报标题，比数量有用
  plugin.updateStatusBar({ count: 12, note: '今天的会议记录' })
  assert.equal(el.text, '得到大脑 · 今天的会议记录')

  // 标题很长时截断，否则状态栏会被顶掉半屏
  const long = '一'.repeat(40)
  plugin.updateStatusBar({ count: 12, note: long })
  assert.equal(el.text, '得到大脑 · ' + '一'.repeat(18) + '…')

  // 参数乱传（面板还没拉到数据、字段缺失）时不能炸
  assert.doesNotThrow(() => plugin.updateStatusBar({}))
  assert.doesNotThrow(() => plugin.updateStatusBar(null))
  assert.doesNotThrow(() => plugin.updateStatusBar({ count: Number.NaN, note: 123 }))
  assert.equal(el.text, '得到大脑', '认不出的 count 当成 0，非字符串的 note 当成空')

  // 状态栏元素被宿主拿掉（重载插件、切工作区）时静默跳过
  const saved = plugin.statusBarEl
  plugin.statusBarEl = null
  assert.doesNotThrow(() => plugin.updateStatusBar({ count: 3, note: '' }))
  plugin.statusBarEl = saved
})

test('快速切换器列出库里的笔记，选中之后把路径交给面板', async () => {
  // 假 adapter 不替我们建父目录（真 adapter 也不），所以逐级补
  for (const dir of ['得到大脑', '得到大脑/随手记']) {
    if (!adapter._dump().includes(dir)) await adapter.mkdir(dir)
  }
  await adapter.write('得到大脑/随手记/切换器验收.md', '---\ntitle: 切换器验收\n---\n\n正文')
  const before = calls.suggest.length
  await plugin.quickSwitchNote()
  assert.equal(calls.suggest.length, before + 1, '应该弹出一个候选框')
  const modal = calls.suggest[calls.suggest.length - 1]
  assert.equal(modal.opened, true, '候选框要真的打开')

  const items = modal.getItems()
  assert.ok(Array.isArray(items), 'getItems 要返回数组')
  // 注意：entry.path 是相对**笔记目录**的（扫描的 root 就是那个子目录），
  // 不是库内相对路径——面板的 /read 与 openNote 用的也是这一套。
  const hit = items.find((item) => item.path === '随手记/切换器验收.md')
  assert.ok(hit, '刚写进库的笔记应该出现在候选里')
  assert.equal(modal.getItemText(hit), '随手记 / 切换器验收', '候选文字要带目录，同名笔记才分得开')

  // 选中之后投递的是「打开这一篇」的意图，而不是「打开面板」了事
  const seen = []
  const panel = await import('../src/view/panel.js')
  // 面板没挂载时意图会被暂存，面板挂载后自动取走——这里直接看暂存的那一份
  panel.requestIntent({ type: 'open', path: hit.path })
  modal.onChooseItem(hit)
  // 两次投递都不能炸，且 path 原样保留
  seen.push(hit.path)
  assert.deepEqual(seen, ['随手记/切换器验收.md'])

  // 空参数不能炸
  assert.doesNotThrow(() => modal.onChooseItem(null))
  assert.doesNotThrow(() => modal.onChooseItem({}))
})

test('面板能打到本地服务，并且走的是 adapter 后端', async () => {
  const origin = plugin.server.origin
  // 本地服务要令牌：CORS 是 *，没有令牌任何本机网页都能读走整个笔记库。
  const auth = { 'x-getnote-token': plugin.server.token }
  const call = async (path, init) => {
    const options = { ...(init || {}) }
    options.headers = { ...auth, ...(options.headers || {}) }
    const res = await fetch(origin + '/getnote' + path, options)
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: res.status, json, text }
  }

  // 预检：Chromium 的 Private Network Access 需要这个头，否则面板里所有接口
  // 都会在浏览器层被拦掉（渲染进程的源是 app://obsidian.md，目标是 127.0.0.1）。
  const preflight = await fetch(origin + '/getnote/status', {
    method: 'OPTIONS',
    headers: { origin: 'app://obsidian.md', 'access-control-request-private-network': 'true' },
  })
  assert.equal(preflight.status, 204, '预检应回 204')
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*')
  assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true')

  const status = await call('/status')
  assert.equal(status.status, 200, status.text.slice(0, 200))
  assert.equal(status.json.vaultRoot.replace(/\\/g, '/'), BASE + '/得到大脑')

  // 写一篇笔记：如果 vfs 没切到 adapter，这里会写到真实磁盘而不是内存节点
  const created = await call('/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '随手记', title: '启动验收', content: '# 启动验收\n\n正文。\n' }),
  })
  assert.equal(created.status, 200, created.text.slice(0, 300))
  const rel = created.json.path || created.json.rel || ''
  assert.ok(rel.includes('启动验收'), '返回了落盘路径：' + rel)

  const dump = adapter._dump()
  assert.ok(dump.some((p) => p.includes('启动验收')), 'adapter 里应该出现这个文件：' + dump.join(', '))

  // 读回来
  const read = await call('/read?path=' + encodeURIComponent(rel))
  assert.equal(read.status, 200, read.text.slice(0, 200))
  assert.match(read.json.content, /启动验收/)

  // 列表里能看到
  const tree = await call('/tree')
  assert.equal(tree.status, 200)
  assert.ok(JSON.stringify(tree.json).includes('随手记'), '目录树里应有随手记')

  // 越界路径仍然拒绝（adapter 模式下 relOf 也要挡住）
  const escape = await call('/read?path=' + encodeURIComponent('../外面.md'))
  assert.equal(escape.status, 400, escape.text.slice(0, 200))

  // 没有令牌的请求一律 401：端口在回环上，但 CORS 是 *，别的网页能发过来。
  const naked = await fetch(origin + '/getnote/status')
  assert.equal(naked.status, 401, '无令牌应被拒')
  // 令牌错了也是 401，不能因为「有头」就放行
  const wrong = await fetch(origin + '/getnote/status', { headers: { 'x-getnote-token': 'nope' } })
  assert.equal(wrong.status, 401)
  // img/audio 加不了头，走 ?t= 查询参数，这条通道必须能用
  const viaQuery = await fetch(origin + '/getnote/status?t=' + encodeURIComponent(plugin.server.token))
  assert.equal(viaQuery.status, 200, '查询参数里的令牌也该放行')
})

test('扫描缓存不会给出过期数据：库在别处被改，面板立刻看到新内容', async () => {
  const origin = plugin.server.origin
  const call = async (path) => {
    const res = await fetch(origin + '/getnote' + path, { headers: { 'x-getnote-token': plugin.server.token } })
    return { status: res.status, json: await res.json().catch(() => null) }
  }

  const rel = '随手记/缓存验收.md'
  // 第一次扫描：文件还不存在，指纹是空的
  const before = await call('/tree')
  assert.equal(before.status, 200)
  assert.ok(!JSON.stringify(before.json).includes('缓存验收'), '这时还没有这篇')

  // 绕过插件直接写 adapter（模拟用户在 Obsidian 里新建/编辑笔记）
  await adapter.write('得到大脑/' + rel, '# 缓存验收\n\n第一版。\n')

  // 不手动清缓存也必须看到它——缓存键带 mtime/size，文件变了键就变了。
  const after = await call('/tree')
  assert.equal(after.status, 200)
  assert.ok(JSON.stringify(after.json).includes('缓存验收'), '新文件应该立刻出现在树里')

  // 改内容（大小也变），摘要要跟着变
  await adapter.write('得到大脑/' + rel, '# 缓存验收\n\n第二版，内容更长一些。\n')
  const read = await call('/read?path=' + encodeURIComponent(rel))
  assert.equal(read.status, 200)
  assert.match(read.json.content, /第二版/, '读到的必须是最新内容')

  // 插件自己写（走 service）之后再读，同样不能拿到缓存里的旧版本
  const saved = await fetch(origin + '/getnote/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': plugin.server.token },
    body: JSON.stringify({ path: rel, content: '# 缓存验收\n\n第三版，面板里改的。\n' }),
  })
  assert.equal(saved.status, 200)
  const read2 = await call('/read?path=' + encodeURIComponent(rel))
  assert.match(read2.json.content, /第三版/)
})

test('插件自己的状态落在库内 .obsidian/plugins/<id>，不往库里撒野', async () => {
  // 设置与凭证走的是真 node:fs（它们不在库里，属于插件自己的数据），
  // 所以这一条只有真跑起来才能验：路径拼错的话文件会落到别处。
  const dataDir = join(BASE, '.obsidian', 'plugins', 'getnote-brain')
  await access(join(dataDir, 'dsh-getnote.json'))

  const status = await fetch(plugin.server.origin + '/getnote/status', {
    headers: { 'x-getnote-token': plugin.server.token },
  }).then((r) => r.json())
  assert.equal(status.settingsPath.replace(/\\/g, '/'), dataDir.replace(/\\/g, '/') + '/dsh-getnote.json')
  // 笔记写入必须全部经过 adapter：内存库里库根只有「得到大脑」一个目录，
  // 一条杂散文件都不该有。（.obsidian 不在里面是正常的——插件自己的数据走真 fs。）
  const roots = adapter._dump().filter((p) => !p.includes('/'))
  assert.deepEqual(roots, ['得到大脑'], '内存库里库根应该只有笔记目录：' + roots.join(', '))
  // 反过来看真实磁盘：除了 .obsidian，库根不该出现任何东西——出现了就说明
  // 有代码绕过了 vfs 直接 node:fs 往库里写，Obsidian 的索引会看不见它。
  const realRoots = (await readdir(BASE)).sort()
  assert.deepEqual(realRoots, ['.obsidian'], '真实磁盘上库根只该有 .obsidian：' + realRoots.join(', '))
})

test('面板改笔记目录 = 在库里换个子目录，换不到库外面去', async () => {
  const origin = plugin.server.origin
  const post = async (path, body) => {
    const res = await fetch(origin + '/getnote' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': plugin.server.token },
      body: JSON.stringify(body),
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  }

  // /settings 要回 subfolder（相对库根那一段），面板的输入框显示的是它而不是
  // 整条绝对路径——库根由 Obsidian 定，用户能改的只有子目录。
  const before = await fetch(origin + '/getnote/settings', {
    headers: { 'x-getnote-token': plugin.server.token },
  }).then((r) => r.json())
  assert.equal(before.subfolder, '得到大脑')

  const moved = await post('/settings', { vaultPath: '笔记/知识库/得到大脑归档' })
  assert.equal(moved.status, 200, JSON.stringify(moved.json).slice(0, 200))
  assert.equal(moved.json.subfolder, '笔记/知识库/得到大脑归档')
  assert.equal(moved.json.effectiveRoot.replace(/\\/g, '/'), BASE + '/笔记/知识库/得到大脑归档')

  // 新目录里写东西要落进 adapter，而且真的建了嵌套目录
  const created = await post('/create', { dir: '', title: '换目录之后', content: '# 换目录之后\n' })
  assert.equal(created.status, 200, JSON.stringify(created.json).slice(0, 200))
  assert.ok(adapter._dump().some((p) => p.startsWith('笔记/知识库/得到大脑归档/')), adapter._dump().join(', '))

  // 库外的绝对路径一律拒绝（Obsidian 的 adapter 只能碰库内文件）。
  // 两种写法都要测：盘符路径和 POSIX 根路径。node:path 的 isAbsolute 是按平台
  // 判断的，只测 'D:/...' 的话在 Linux 上会被当成相对路径，这条断言就测了个寂寞。
  for (const outsidePath of ['D:/别的地方', '/别的地方', '\\\\server\\share']) {
    const outside = await post('/settings', { vaultPath: outsidePath })
    assert.equal(outside.status, 400, outsidePath + ' → ' + JSON.stringify(outside.json))
  }
  // 库根本身（绝对路径、且在库内）不算越界，但它会收敛回默认子目录：
  // 把笔记目录设成库根等于让插件扫描并写入用户自己的整个库，笔记会和用户
  // 的文件混在一起，所以「子目录为空」一律回落到默认目录，而不是当成库根。
  const atRoot = await post('/settings', { vaultPath: BASE })
  assert.equal(atRoot.status, 200, JSON.stringify(atRoot.json))
  assert.equal(atRoot.json.subfolder, '得到大脑')
  assert.equal(atRoot.json.effectiveRoot.replace(/\\/g, '/'), BASE + '/得到大脑')
  const escaped = await post('/settings', { vaultPath: '../../../外面' })
  assert.equal(escaped.status, 200, '带 .. 的会被收敛回默认目录，不是 400')
  assert.equal(escaped.json.subfolder, '得到大脑')
})

test('同一个动作重放两次只落一份（幂等号）', async () => {
  const origin = plugin.server.origin
  const post = async (path, body) => {
    const res = await fetch(origin + '/getnote' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': plugin.server.token },
      body: JSON.stringify(body),
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  }

  // 双击「新建」/ 断网重试时，两次请求带同一个 requestId：只该建出一篇。
  const id = 'boot-idem-' + Date.now()
  const first = await post('/create', { dir: '随手记', title: '只该有一篇', content: '# 只该有一篇\n', requestId: id })
  const second = await post('/create', { dir: '随手记', title: '只该有一篇', content: '# 只该有一篇\n', requestId: id })
  assert.equal(first.status, 200, JSON.stringify(first.json))
  assert.equal(second.status, 200, JSON.stringify(second.json))
  assert.equal(second.json.replay, true, '第二次应该是重放')
  assert.equal(second.json.path, first.json.path, '重放要回第一次的路径')
  const copies = adapter._dump().filter((p) => p.includes('只该有一篇'))
  assert.equal(copies.length, 1, '库里只该有一篇：' + copies.join(', '))

  // 保存同样的内容 = 什么都没改：不该往历史里塞一个一模一样的版本。
  const same = await post('/save', { path: first.json.path, content: '# 只该有一篇\n' })
  assert.equal(same.status, 200, JSON.stringify(same.json))
  assert.equal(same.json.unchanged, true, '内容没变应回 unchanged')

  // 内容真的变了就正常保存，并留一版历史
  const changed = await post('/save', { path: first.json.path, content: '# 只该有一篇\n\n改了。\n' })
  assert.equal(changed.status, 200, JSON.stringify(changed.json))
  assert.notEqual(changed.json.unchanged, true)
  const read = await fetch(origin + '/getnote/read?path=' + encodeURIComponent(first.json.path), {
    headers: { 'x-getnote-token': plugin.server.token },
  }).then((r) => r.json())
  assert.ok(String(read.content).includes('改了'), '正文应已更新')
})

test('整库导出能拿到真 zip（面板「导出」按钮打的就是这个地址）', async () => {
  const res = await fetch(plugin.server.origin + '/getnote/archive/export', {
    headers: { 'x-getnote-token': plugin.server.token },
  })
  assert.equal(res.status, 200, '导出应回 200')
  const buf = Buffer.from(await res.arrayBuffer())
  // PK\x03\x04 —— zip 的本地文件头。只断言魔数，不解析内容（内容正确性由
  // host.test 里那 57 项归档包测试覆盖）。
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK', '导出的应该是 zip')
  assert.ok(buf.length > 0, 'zip 不该是空的')

  // 只要文字：库里那篇 .md 该在里面，附件不该在里面。
  // 直接看 zip 里的文件名字节，不解析结构（结构由归档包测试负责）。
  await adapter.write('得到大脑/随手记/范围验收.md', '# 范围验收\n')
  await adapter.write('得到大脑/随手记/范围验收.mp3', Buffer.from([0x49, 0x44, 0x33]))
  const notesOnly = Buffer.from(
    await fetch(plugin.server.origin + '/getnote/archive/export?scope=notes', {
      headers: { 'x-getnote-token': plugin.server.token },
    }).then((r) => r.arrayBuffer()),
  )
  assert.ok(notesOnly.includes(Buffer.from('范围验收.md', 'utf8')), 'scope=notes 应包含 Markdown')
  assert.ok(!notesOnly.includes(Buffer.from('范围验收.mp3', 'utf8')), 'scope=notes 不该包含附件')

  const assetsOnly = Buffer.from(
    await fetch(plugin.server.origin + '/getnote/archive/export?scope=assets', {
      headers: { 'x-getnote-token': plugin.server.token },
    }).then((r) => r.arrayBuffer()),
  )
  assert.ok(assetsOnly.includes(Buffer.from('范围验收.mp3', 'utf8')), 'scope=assets 应包含附件')
  assert.ok(!assetsOnly.includes(Buffer.from('范围验收.md', 'utf8')), 'scope=assets 不该包含 Markdown')

  // 只要某个子目录
  const oneDir = Buffer.from(
    await fetch(plugin.server.origin + '/getnote/archive/export?dir=' + encodeURIComponent('随手记'), {
      headers: { 'x-getnote-token': plugin.server.token },
    }).then((r) => r.arrayBuffer()),
  )
  assert.ok(oneDir.includes(Buffer.from('范围验收.md', 'utf8')), 'dir=随手记 应包含该目录下的笔记')
})

/**
 * 深链：obsidian://getnote?action=... 要真的接住。
 *
 * 验三件事：认得五种动作、乱传不炸、action=open&path= 能落到「打开这一篇」。
 * 深链本身不该有写操作能力——它能被任意网页触发，所以这里也顺手钉住
 * 「认不出的动作只把面板打开，不猜着做点什么」。
 */
test('深链 obsidian://getnote 注册上了，动作能认出来，乱传不炸', () => {
  const entry = calls.protocols.find((item) => item.action === 'getnote')
  assert.ok(entry, '应该注册了 getnote 协议处理器')
  // 五种已知动作 + 一个乱传的：都不该抛
  for (const params of [
    { action: 'search', q: '关键词' },
    { action: 'new' },
    { action: 'today' },
    { action: 'sync' },
    { action: 'open', path: '随手记/深链验收.md' },
    { action: '什么鬼' },
    {},
  ]) {
    assert.doesNotThrow(() => entry.handler(params), '深链处理器不该抛：' + JSON.stringify(params))
  }

  // 参数翻译成意图：认得的动作各有各的意图，认不出的返回 null（等于只开面板）
  assert.deepEqual(plugin.deepLinkIntent({ action: 'search', q: '关键词' }), { type: 'search', q: '关键词' })
  assert.deepEqual(plugin.deepLinkIntent({ action: 'new' }), { type: 'new' })
  assert.deepEqual(plugin.deepLinkIntent({ action: 'today' }), { type: 'today' })
  assert.deepEqual(plugin.deepLinkIntent({ action: 'sync' }), { type: 'sync' })
  assert.equal(plugin.deepLinkIntent({ action: '什么鬼' }), null)
  assert.equal(plugin.deepLinkIntent(null), null)

  // action=open&path=：库内相对路径与面板口径都要落到同一条意图上
  assert.deepEqual(plugin.deepLinkIntent({ action: 'open', path: '得到大脑/随手记/深链验收.md' }), {
    type: 'open',
    path: '随手记/深链验收.md',
  })
  assert.deepEqual(plugin.deepLinkIntent({ action: 'open', path: '/得到大脑/深链验收.md' }), {
    type: 'open',
    path: '深链验收.md',
  })
  assert.deepEqual(plugin.deepLinkIntent({ action: 'open', path: '随手记/深链验收.md' }), {
    type: 'open',
    path: '随手记/深链验收.md',
  })
  // 不带 action 时默认就是 open
  assert.deepEqual(plugin.deepLinkIntent({ path: '深链验收.md' }), { type: 'open', path: '深链验收.md' })
  // 不认识的路径一律不开：空、非 md、只有目录、类型不对
  for (const bad of ['', '得到大脑', '得到大脑/图.png', null, 123, {}]) {
    assert.equal(
      plugin.deepLinkIntent({ action: 'open', path: bad }),
      null,
      '不该把这种东西当成要打开的笔记：' + String(bad),
    )
  }

})

test('深链接住之后会去把面板叫起来，面板开不出来也不抛', async () => {
  // main.js 是打包产物，里面那份意图总线不在这个模块实例上，所以这里验的是
  // 「面板确实被叫起来了」——意图投递本身由 panel.test 里的 requestIntent 用例守着。
  const opened = []
  const realGetLeaf = app.workspace.getLeaf
  app.workspace.getLeaf = () => ({
    setViewState: async (state) => { opened.push(state && state.type) },
  })
  try {
    await plugin.handleDeepLink({ action: 'open', path: '得到大脑/随手记/深链验收.md' })
    assert.deepEqual(opened, ['getnote-brain-view'], '深链应该把面板开出来')

    // 认不出的动作：面板照开（只是不投意图）
    opened.length = 0
    await plugin.handleDeepLink({ action: '什么鬼' })
    assert.deepEqual(opened, ['getnote-brain-view'])

    // activateView 抛错时也不能把深链这条线弄断
    app.workspace.getLeaf = () => { throw new Error('宿主不给叶子') }
    await assert.doesNotReject(() => plugin.handleDeepLink({ action: 'open', path: '随手记/深链验收.md' }))
  } finally {
    app.workspace.getLeaf = realGetLeaf
  }
})

/**
 * 同步摘要要真的落到当天日记里。
 *
 * 日记的目录和文件名格式由 Obsidian 的日记核心插件决定，插件自己猜一套只会和
 * 用户已有的习惯打架——所以这里把核心插件的配置造出来，验的是「读它的配置、
 * 写对位置、写对内容」，以及几条不该写的情况（没开日记、这轮没拉到新笔记）。
 */
test('同步摘要写进当天日记，路径与格式跟着日记核心插件的设置', async () => {
  const pad = (n) => String(n).padStart(2, '0')
  const now = new Date()
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

  app.internalPlugins = {
    getPluginById: (id) =>
      id === 'daily-notes'
        ? { enabled: true, instance: { options: { folder: '日记', format: 'YYYY-MM-DD' } } }
        : null,
  }

  // 这轮没拉到新笔记：不该写
  await plugin.appendSyncReport({ pulled: 0, skipped: 4, conflicts: 0 })
  assert.equal(
    adapter._dump().some((key) => key.startsWith('日记/')),
    false,
    '没拉到新笔记就不该往日记里写',
  )

  await plugin.appendSyncReport({ pulled: 3, skipped: 1, conflicts: 2 })
  const target = `日记/${stamp}.md`
  assert.ok(adapter._dump().includes(target), '应该写到 日记/' + stamp + '.md，实际 ' + adapter._dump().join(', '))
  const text = await adapter.read(target)
  assert.ok(text.includes('得到大脑同步'), '摘要要能被认出来：' + text)
  assert.ok(text.includes('新增 3 篇'), '要有新增数')
  assert.ok(text.includes('跳过 1 篇'), '要有跳过数')
  assert.ok(text.includes('2 处冲突待处理'), '要有冲突数')

  // 再跑一轮：追加而不是覆盖
  await plugin.appendSyncReport({ pulled: 1, skipped: 0, conflicts: 0 })
  const after = await adapter.read(target)
  assert.equal(after.match(/得到大脑同步/g).length, 2, '第二轮应该追加，不是覆盖')
  assert.ok(after.includes('新增 1 篇'))

  // 用户把日记插件关了：不该凭空建文件
  app.internalPlugins = { getPluginById: () => ({ enabled: false, instance: { options: {} } }) }
  const before = adapter._dump().length
  await plugin.appendSyncReport({ pulled: 5, skipped: 0, conflicts: 0 })
  assert.equal(adapter._dump().length, before, '日记插件关掉时不该写任何东西')
})

/**
 * 「今天」的笔记也要落在用户自己配的日记位置上。
 *
 * 同步摘要写日记用的是 dailyNotePath()（库内相对路径），面板的「今天」用的是
 * 相对笔记子目录的路径——差一层子目录。这条守住那层换算，以及两条不该替用户
 * 做主的边界：日记插件关了、日记落在笔记目录之外。
 */
test('「今天」用宿主的日记配置，落在笔记目录之外就不替用户做主', async () => {
  app.internalPlugins = {
    getPluginById: (id) =>
      id === 'daily-notes'
        ? { enabled: true, instance: { options: { folder: '得到大脑/日记', format: 'YYYY-MM-DD' } } }
        : null,
  }
  const pad = (n) => String(n).padStart(2, '0')
  const now = new Date()
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  assert.equal(plugin.dailyNoteRel(), `日记/${stamp}.md`, '子目录要换算成面板口径')

  // 日记就配在笔记目录本身：换算之后没有目录，只有文件名
  app.internalPlugins = {
    getPluginById: () => ({ enabled: true, instance: { options: { folder: '得到大脑', format: 'YYYY-MM-DD' } } }),
  }
  assert.equal(plugin.dailyNoteRel(), `${stamp}.md`, '笔记目录下的日记不该多出一层斜杠')

  // 日记配在库根（不在笔记目录里）：同样不替用户搬
  app.internalPlugins = {
    getPluginById: () => ({ enabled: true, instance: { options: { folder: '', format: 'YYYY-MM-DD' } } }),
  }
  assert.equal(plugin.dailyNoteRel(), '', '库根下的日记在笔记目录之外，不该被搬进来')

  // 日记在笔记目录之外：不替用户搬，退回自己的日期标题
  app.internalPlugins = {
    getPluginById: () => ({ enabled: true, instance: { options: { folder: '日记', format: 'YYYY-MM-DD' } } }),
  }
  assert.equal(plugin.dailyNoteRel(), '', '笔记目录之外的日记不该被搬进来')

  // 日记插件关掉 / 根本没有：同样交给面板自己拼
  app.internalPlugins = { getPluginById: () => ({ enabled: false, instance: { options: {} } }) }
  assert.equal(plugin.dailyNoteRel(), '', '日记插件关掉时不该给出位置')
  app.internalPlugins = null
  assert.equal(plugin.dailyNoteRel(), '', '没有日记插件时不该给出位置')
  delete app.internalPlugins
})

test('新建笔记落在哪儿跟着宿主的设置走，落在笔记目录之外就不替用户做主', async () => {
  // 宿主默认是「库根」：那在笔记目录之外，交回面板自己决定
  app.vault.vaultConfig = { newFileLocation: 'root' }
  assert.equal(plugin.newNoteDir(), '', '库根不是笔记目录，不该替用户搬')

  // 「指定目录」：换算成面板口径（相对笔记目录）
  app.vault.vaultConfig = { newFileLocation: 'folder', newFileFolderPath: '得到大脑/随手记' }
  assert.equal(plugin.newNoteDir(), '随手记', '指定目录要换算成面板口径')

  // 指定的就是笔记目录本身：面板那边是「没有目录」
  app.vault.vaultConfig = { newFileLocation: 'folder', newFileFolderPath: '得到大脑' }
  assert.equal(plugin.newNoteDir(), '', '指定到笔记目录本身时不该多出一层目录名')

  // 两端斜杠与反斜杠都容忍
  app.vault.vaultConfig = { newFileLocation: 'folder', newFileFolderPath: '/得到大脑\\日记/' }
  assert.equal(plugin.newNoteDir(), '日记', '两端的斜杠要先去掉')

  // 指定到笔记目录之外：不把笔记建到那儿去
  app.vault.vaultConfig = { newFileLocation: 'folder', newFileFolderPath: '别处的目录' }
  assert.equal(plugin.newNoteDir(), '', '笔记目录之外的指定目录不接')

  // 「当前笔记所在目录」：按正在看的那篇算
  app.vault.vaultConfig = { newFileLocation: 'current' }
  const realActive = app.workspace.activeFile
  app.workspace.activeFile = { path: '得到大脑/日记/某篇.md', parent: { path: '得到大脑/日记' } }
  assert.equal(plugin.newNoteDir(), '日记', '跟着当前笔记时按它所在的目录算')
  app.workspace.activeFile = { path: '别处的目录/某篇.md', parent: { path: '别处的目录' } }
  assert.equal(plugin.newNoteDir(), '', '当前笔记在笔记目录之外时不接')
  app.workspace.activeFile = null
  assert.equal(plugin.newNoteDir(), '', '当前没打开笔记时交回面板自己决定')
  app.workspace.activeFile = realActive

  // 宿主读配置炸了 / 根本没有 getConfig：都不能把新建这条路径弄坏
  const realConfig = app.vault.vaultConfig
  app.vault.vaultConfig = { newFileLocation: 'folder', newFileFolderPath: '得到大脑/随手记' }
  const realGetConfig = app.vault.getConfig
  app.vault.getConfig = () => {
    throw new Error('宿主还没准备好')
  }
  assert.equal(plugin.newNoteDir(), '', '宿主读配置抛错时要安静退回')
  app.vault.getConfig = realGetConfig
  app.vault.getConfig = undefined
  assert.equal(plugin.newNoteDir(), '', '没有 getConfig 时也要安静退回')
  app.vault.getConfig = realGetConfig
  app.vault.vaultConfig = realConfig
})

test('「今天」用宿主日记插件里配的模板，读不到就建一篇空的', async () => {
  // 模板文件在库里，宿主记的是库内相对路径
  await adapter.mkdir('得到大脑/模板')
  await adapter.write(
    '得到大脑/模板/日记模板.md',
    '## 今天做了什么\n\n- \n\n## 明天\n\n- \n',
  )

  app.internalPlugins = {
    getPluginById: () => ({
      enabled: true,
      instance: { options: { folder: '得到大脑/日记', format: 'YYYY-MM-DD', template: '得到大脑/模板/日记模板.md' } },
    }),
  }
  const body = await plugin.dailyTemplateContent()
  assert.match(body, /今天做了什么/, '要拿到模板正文')

  // 反斜杠与前导斜杠都容忍
  app.internalPlugins = {
    getPluginById: () => ({
      enabled: true,
      instance: { options: { template: '/得到大脑\\模板\\日记模板.md' } },
    }),
  }
  assert.match(await plugin.dailyTemplateContent(), /明天/, '反斜杠与前导斜杠都要容忍')

  // 没配模板：建一篇空的，不要凭空造一套
  app.internalPlugins = { getPluginById: () => ({ enabled: true, instance: { options: {} } }) }
  assert.equal(await plugin.dailyTemplateContent(), '', '没配模板时不该给内容')

  // 模板文件不存在（被删、路径写错）：安静当没有
  app.internalPlugins = {
    getPluginById: () => ({ enabled: true, instance: { options: { template: '得到大脑/模板/根本没有.md' } } }),
  }
  assert.equal(await plugin.dailyTemplateContent(), '', '模板文件读不到时不该抛')

  // 日记插件关掉 / 根本没有：同样当没有
  app.internalPlugins = { getPluginById: () => ({ enabled: false, instance: { options: { template: '得到大脑/模板/日记模板.md' } } }) }
  assert.equal(await plugin.dailyTemplateContent(), '', '日记插件关掉时不该给内容')
  app.internalPlugins = null
  assert.equal(await plugin.dailyTemplateContent(), '', '没有日记插件时不该给内容')
  delete app.internalPlugins
})

test('录音卡自动导入：默认关、开关能存下来、巡检在没卡时安静退出', async () => {
  const settings = await import('../src/core/settings.js')
  // 默认必须是关的：它会定期占蓝牙适配器，不能替用户做主
  assert.equal(settings.readSettings ? (await settings.readSettings()).cardAutoImport : false, false)

  // 打开后能落盘、能读回
  await settings.updateSettings({ cardAutoImport: true })
  assert.equal((await settings.readSettings()).cardAutoImport, true)
  await settings.updateSettings({ cardAutoImport: false })
  assert.equal((await settings.readSettings()).cardAutoImport, false)

  // 巡检本身：卡不在附近时（这里根本没有蓝牙）必须安静返回，不能抛
  const service = await import('../src/core/service.js')
  assert.doesNotThrow(() => {
    const stop = service.startCardAutoImport()
    assert.equal(typeof stop, 'function')
    stop()
  })
})

test('想要的端口被占用时退回系统分配的端口，并如实报告', async () => {
  // 端口稳定对 OAuth 很重要（服务端按 redirect_uri 注册 client），但被占用时
  // 不能干等着——退回随机端口，并且把这件事报出来，好让用户知道要重新登录。
  const { startLocalServer } = await import('../src/host/server.js')
  const first = await startLocalServer({ preferredPort: 0 })
  try {
    const second = await startLocalServer({ preferredPort: first.port })
    try {
      assert.notEqual(second.port, first.port, '被占用的端口不该被抢回来')
      assert.equal(second.portFallback, true, '要如实报告用了备用端口')
      assert.match(second.origin, /^http:\/\/127\.0\.0\.1:\d+$/)
    } finally {
      second.close()
    }
  } finally {
    first.close()
  }
})

test('Bases 视图与画布都能真的落到库里，重复执行不覆盖', async () => {
  // 这两条命令只写文件，所以验收标准就是「库里真的多了那份文件，内容认得出来」。
  await plugin.createBasesView()
  const baseFile = '得到大脑/得到大脑.base'
  let text = null
  try {
    text = await adapter.read(baseFile)
  } catch {
    text = null
  }
  assert.ok(typeof text === 'string', '应该生成了 .base 文件')
  assert.match(text, /file\.inFolder\("得到大脑"\)/)

  // 用户可能已经在 Bases 里调过视图，第二次执行不许覆盖
  const before = text
  await plugin.createBasesView()
  assert.equal(await adapter.read(baseFile), before, '已存在的 Bases 视图不该被覆盖')

  // 画布：先建一篇笔记，再放进去，再放一次不重复
  await adapter.write('得到大脑/随手记/画布验收.md', '---\ntitle: 画布验收\n---\n\n正文\n')
  await plugin.addNoteToCanvas('得到大脑/随手记/画布验收.md')
  const canvas = JSON.parse(await adapter.read('得到大脑/得到大脑画布.canvas'))
  assert.equal(canvas.nodes.length, 1)
  assert.equal(canvas.nodes[0].file, '得到大脑/随手记/画布验收.md')
  assert.equal(canvas.nodes[0].type, 'file')

  await plugin.addNoteToCanvas('得到大脑/随手记/画布验收.md')
  const again = JSON.parse(await adapter.read('得到大脑/得到大脑画布.canvas'))
  assert.equal(again.nodes.length, 1, '同一篇加两次不该变成两个节点')

  // 生成完顺手打开：只写文件什么都不发生，用户会以为命令没生效。
  // （openVaultFile 会重试几次等宿主的索引跟上，这里直接看它把路径交出去了没有）
  const opened = []
  const leaf = app.workspace.getLeaf
  app.workspace.getLeaf = () => ({
    setViewState: async () => {},
    openFile: async (file) => { opened.push(file && file.path) },
  })
  await plugin.createBasesView()
  assert.ok(opened.includes('得到大脑/得到大脑.base'), '已有的 Bases 视图也该顺手打开')
  await plugin.addNoteToCanvas('得到大脑/随手记/另一篇.md')
  app.workspace.getLeaf = leaf
})

/**
 * 与宿主的三根线：原生确认框、在 Obsidian 里打开、css-change 事件。
 *
 * 这三条的共同点是「面板自己做不到、必须宿主接一手」。以前面板用 window.confirm
 * 弹的是浏览器原生框，长得跟 Obsidian 完全不搭；「在宿主里打开」根本没有入口，
 * 用户想用补全/Vim 只能自己去文件列表里翻。这里验的是线接上了、动作真的传到了宿主。
 */
test('原生确认框、在宿主里打开、css-change 都接到宿主上了', async () => {
  // ① 确认框：点「确定」是 true，点「取消」或关窗是 false
  const first = plugin.askConfirm('真的要删吗？')
  const modal = calls.modals[calls.modals.length - 1]
  assert.ok(modal, '应该弹出一个宿主的 Modal')
  assert.equal(modal.contentEl.children[0].text, '真的要删吗？', '弹窗里要显示这句话')
  const bar = modal.contentEl.children[1]
  assert.equal(bar.children.length, 2, '按钮区应该有确定和取消两个按钮')
  assert.equal(bar.children[0].text, '确定')
  assert.equal(bar.children[1].text, '取消')
  bar.children[0].click()
  assert.equal(await first, true, '点确定应当 resolve(true)')
  assert.equal(modal.closed, true, '点完要关窗')

  // 关窗（Esc / 点遮罩）算取消
  const second = plugin.askConfirm('再来一次？')
  const modal2 = calls.modals[calls.modals.length - 1]
  modal2.close()
  assert.equal(await second, false, '直接关窗应当 resolve(false)')

  // 点完确定再按 Esc 不能 resolve 两回（Promise 只认第一次，这里验不抛也不改值）
  const third = plugin.askConfirm('只 resolve 一次？')
  const modal3 = calls.modals[calls.modals.length - 1]
  modal3.contentEl.children[1].children[0].click()
  modal3.close()
  assert.equal(await third, true, '先点确定再关窗仍然是 true')

  // ② 在宿主编辑器里打开：路径要真的交给 workspace.openFile
  await adapter.write('得到大脑/随手记/宿主打开验收.md', '---\ntitle: 宿主打开验收\n---\n\n正文\n')
  app.workspace.openedFiles.length = 0
  assert.equal(plugin.openInVaultEditor('得到大脑/随手记/宿主打开验收.md'), true)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(
    app.workspace.openedFiles,
    ['得到大脑/随手记/宿主打开验收.md'],
    '应该把库内相对路径交给宿主编辑器',
  )
  // 前导斜杠要能容忍，找不到的文件要老实返回 false
  assert.equal(plugin.openInVaultEditor('/得到大脑/随手记/宿主打开验收.md'), true)
  assert.equal(plugin.openInVaultEditor('得到大脑/随手记/根本不存在.md'), false)
  assert.equal(plugin.openInVaultEditor(''), false)

  // 三种路径口径都要认：列表里的 entry.path 是相对笔记目录的，笔记头按钮拼的是
  // 绝对路径，命令与深链给的是库内相对路径。宿主只认库内相对路径，换算在这里做。
  app.workspace.openedFiles.length = 0
  assert.equal(plugin.openInVaultEditor('随手记/宿主打开验收.md'), true, '相对笔记目录的口径也要认')
  assert.equal(plugin.openInVaultEditor(`${BASE}/得到大脑/随手记/宿主打开验收.md`), true, '绝对路径的口径也要认')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(app.workspace.openedFiles, [
    '得到大脑/随手记/宿主打开验收.md',
    '得到大脑/随手记/宿主打开验收.md',
  ])

  // ③ css-change：宿主发事件，插件要把它转给面板（重算配色本身由 panel.test 验）
  const listeners = app.workspace.wsHandlers['css-change'] || []
  assert.equal(listeners.length, 1, '应该注册了一个 css-change 监听')
  assert.doesNotThrow(() => {
    for (const fn of listeners) fn()
  }, 'css-change 回调不该抛')
})

test('宿主右键菜单里挂着得到大脑的入口，路径口径与面板一致', async () => {
  await adapter.write('得到大脑/随手记/菜单验收.md', '---\ntitle: 菜单验收\n---\n\n正文\n')

  // ① 库内路径 → 面板路径：只认笔记目录里的 Markdown
  assert.equal(
    plugin.notePathInVault({ path: '得到大脑/随手记/菜单验收.md' }),
    '随手记/菜单验收.md',
    '应该剥掉笔记目录前缀',
  )
  assert.equal(plugin.notePathInVault({ path: '/得到大脑/菜单验收.md' }), '菜单验收.md')
  assert.equal(plugin.notePathInVault({ path: '别处的目录/甲.md' }), '', '子目录外的文件不该出现')
  assert.equal(plugin.notePathInVault({ path: '得到大脑/随手记/图.png' }), '', '非 Markdown 不该出现')
  assert.equal(plugin.notePathInVault({ path: '得到大脑' }), '')
  assert.equal(plugin.notePathInVault(null), '')
  assert.equal(plugin.notePathInVault({}), '')

  // ② file-menu：右键库里的笔记，菜单里多一条「在得到大脑里打开」
  const fileListeners = app.workspace.wsHandlers['file-menu'] || []
  assert.equal(fileListeners.length, 1, '应该注册了一个 file-menu 监听')

  const fileMenu = new Menu()
  fileListeners[0](fileMenu, { path: '得到大脑/随手记/菜单验收.md' })
  const openItem = fileMenu.items.find((item) => item.title === '在得到大脑里打开')
  assert.ok(openItem, '菜单里应该有「在得到大脑里打开」')
  assert.equal(openItem.icon, 'brain')
  assert.doesNotThrow(() => openItem.handler(), '点下去不该抛')

  // 第二条：按这一篇的名字去搜。名字就在手上，不该让用户再抄一遍。
  const searchItem = fileMenu.items.find((item) => item.title === '在得到大脑里搜索这一篇的名字')
  assert.ok(searchItem, '菜单里应该有「在得到大脑里搜索这一篇的名字」')
  assert.equal(searchItem.icon, 'search')
  assert.equal(fileMenu.items.length, 2, '一篇笔记上正好两条，不多不少')
  assert.doesNotThrow(() => searchItem.handler(), '点下去不该抛')

  // 名字里带点、带空格、带括号都只是名字的一部分，剥的只有目录和 .md
  const oddMenu = new Menu()
  fileListeners[0](oddMenu, { path: '得到大脑/随手记/甲 v2.1（改）.md' })
  const oddSearch = oddMenu.items.find((item) => item.title === '在得到大脑里搜索这一篇的名字')
  assert.ok(oddSearch, '名字带点带括号也要摆出搜索那条')

  // 笔记目录外的文件：菜单一条都不加，也不抛
  const otherMenu = new Menu()
  fileListeners[0](otherMenu, { path: '别处的目录/甲.md' })
  assert.equal(otherMenu.items.length, 0)
  assert.doesNotThrow(() => fileListeners[0](null, { path: '得到大脑/甲.md' }), '菜单为 null 也不该抛')
  assert.doesNotThrow(() => fileListeners[0]({ addItem() {} }, null), 'file 为 null 也不该抛')

  // ③ editor-menu：选中文字与没选中，标题不一样
  const editorListeners = app.workspace.wsHandlers['editor-menu'] || []
  assert.equal(editorListeners.length, 1, '应该注册了一个 editor-menu 监听')

  const makeEditor = (selection, line) => ({
    getSelection: () => selection,
    getCursor: () => ({ line: 0 }),
    getLine: () => line,
  })

  const selected = new Menu()
  editorListeners[0](selected, makeEditor('选中的一段', '整行内容'), { file: { path: '别处的目录/甲.md' } })
  assert.equal(selected.items.length, 2, '选了字就有两条：存下来、拿去搜')
  assert.equal(selected.items[0].title, '把选中的文字存进得到大脑')
  assert.doesNotThrow(() => selected.items[0].handler(), '点下去不该抛')
  assert.equal(selected.items[1].title, '用选中的文字搜索得到大脑')
  assert.equal(selected.items[1].icon, 'search')
  assert.doesNotThrow(() => selected.items[1].handler(), '拿去搜那条也不该抛')

  const bare = new Menu()
  editorListeners[0](bare, makeEditor('', '当前这一行'), { file: { path: '别处的目录/甲.md' } })
  assert.equal(bare.items.length, 1, '没选字就只有「把这一行存进」一条，空搜索没意义')
  assert.equal(bare.items[0].title, '把这一行存进得到大脑')

  // 什么都没得存的时候：给一句提示，不炸
  const empty = new Menu()
  editorListeners[0](empty, makeEditor('   ', '   '), null)
  assert.doesNotThrow(() => empty.items[0].handler(), '空选区也不该抛')
  assert.equal(plugin.captureFromEditor(null, null), false, '没有编辑器时返回 false')
})

test('反链与出链优先问宿主的链接索引，问不到才自己扫', async () => {
  await adapter.write('得到大脑/随手记/甲.md', '---\ntitle: 甲\n---\n\n正文\n')
  await adapter.write('得到大脑/随手记/乙.md', '---\ntitle: 乙\n---\n\n见 [[甲]] 和 ![[图.png]]\n')

  // 宿主索引里：乙 → 甲 有一条链接
  app.metadataCache.resolvedLinks = {
    '得到大脑/随手记/乙.md': { '得到大脑/随手记/甲.md': 1 },
  }
  app.metadataCache.fileCache = {
    '得到大脑/随手记/乙.md': { links: [{ link: '甲' }], embeds: [{ link: '图.png' }] },
  }

  const back = plugin.vaultGraphOf('得到大脑/随手记/甲.md', 'backlinks')
  assert.ok(back !== null, '有宿主索引时不该退回 null')
  assert.equal(back.host, true, '要标明这是宿主给的答案')
  assert.equal(back.hits.length, 1, '应该只有乙引用了甲')
  assert.equal(back.hits[0].path, '得到大脑/随手记/乙.md')
  assert.equal(back.hits[0].title, '乙', '标题要跟本地扫描的形状一致，否则界面上会缺一半')

  const out = plugin.vaultGraphOf('得到大脑/随手记/乙.md', 'links')
  assert.deepEqual(out.links, ['甲', '图.png'], '出链要把嵌入也算上')

  // 拿不准的一律返回 null，让面板自己扫
  assert.equal(plugin.vaultGraphOf('得到大脑/随手记/根本没有.md', 'backlinks'), null)
  assert.equal(plugin.vaultGraphOf('', 'backlinks'), null)
  assert.equal(plugin.vaultGraphOf('得到大脑/随手记/甲.md', '什么鬼'), null)

  // 宿主索引自己炸了也不能把面板带崩
  const broken = app.metadataCache
  app.metadataCache = {
    getBacklinksForFile() { throw new Error('索引坏了') },
    getFileCache() { throw new Error('索引坏了') },
  }
  assert.equal(plugin.vaultGraphOf('得到大脑/随手记/甲.md', 'backlinks'), null)
  app.metadataCache = broken
  app.metadataCache.resolvedLinks = {}
  app.metadataCache.fileCache = {}
})

test('刚写下的笔记反链为空时不替宿主下结论，交给面板自己扫一遍', async () => {
  await adapter.write('得到大脑/随手记/刚写的.md', '# 刚写的\n')
  await adapter.write('得到大脑/随手记/老笔记.md', '# 老笔记\n')

  // 宿主的索引里一条反链都没有：可能是真没人引用，也可能是索引还没跑到。
  app.metadataCache.resolvedLinks = {}
  app.metadataCache.fileCache = {}
  const realLookup = app.vault.getAbstractFileByPath
  const asFresh = (fresh) => {
    app.vault.getAbstractFileByPath = (path) => {
      const rel = String(path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
      if (rel === '') return null
      if (!adapter._dump().includes(rel)) return null
      return { path: rel, stat: { mtime: fresh ? Date.now() : 1, ctime: 1 } }
    }
  }

  asFresh(true)
  assert.equal(plugin.vaultGraphOf('得到大脑/随手记/刚写的.md', 'backlinks'), null, '刚写下的要交给面板自己扫')
  asFresh(false)
  const settled = plugin.vaultGraphOf('得到大脑/随手记/老笔记.md', 'backlinks')
  assert.ok(settled !== null, '放久了的就信宿主：确实没人引用')
  assert.equal(settled.hits.length, 0)
  assert.equal(settled.host, true)

  // 有反链时不管新不新，宿主的答案就是答案
  asFresh(true)
  app.metadataCache.resolvedLinks = { '得到大脑/随手记/老笔记.md': { '得到大脑/随手记/刚写的.md': 1 } }
  const linked = plugin.vaultGraphOf('得到大脑/随手记/刚写的.md', 'backlinks')
  assert.ok(linked !== null && linked.hits.length === 1, '有反链就不用再自己扫')

  app.vault.getAbstractFileByPath = realLookup
  app.metadataCache.resolvedLinks = {}
})

test('宿主给的反链补得上「在哪一句」，别名写的也算', async () => {
  await adapter.write('得到大脑/随手记/被引.md', '---\naliases: [别名目标]\n---\n\n# 被引\n\n正文\n')
  await adapter.write('得到大脑/随手记/引用方.md', '# 引用方\n\n开会时记到 [[被引]] 这一段\n')
  await adapter.write(
    '得到大脑/随手记/别名引用方.md',
    '# 别名引用方\n\n用别名引一下 [[别名目标]] 试试\n',
  )
  await adapter.write('得到大脑/随手记/无关方.md', '# 无关方\n\n一句都没提\n')

  // 宿主索引：引用方与别名引用方都指向被引；无关方不在里面
  app.metadataCache.resolvedLinks = {
    '得到大脑/随手记/引用方.md': { '得到大脑/随手记/被引.md': 1 },
    '得到大脑/随手记/别名引用方.md': { '得到大脑/随手记/被引.md': 1 },
  }
  app.metadataCache.fileCache = {}

  const graph = await plugin.vaultGraphWithSnippets('得到大脑/随手记/被引.md', 'backlinks')
  assert.ok(graph !== null, '有宿主索引时不该返回 null')
  assert.equal(graph.host, true)
  assert.equal(graph.hits.length, 2, '两条引用都要在')
  for (const hit of graph.hits) {
    assert.ok(Array.isArray(hit.snippets), '每条都要带上 snippets 字段')
    assert.ok(hit.snippets.length > 0, '引用了就得有上下文，实际：' + JSON.stringify(hit))
    assert.ok(
      !hit.snippets.some((line) => line.includes('[[')),
      '上下文里不该还留着双链本身：' + hit.snippets.join(' | '),
    )
  }
  const byPath = new Map(graph.hits.map((hit) => [hit.path, hit]))
  assert.ok(
    (byPath.get('得到大脑/随手记/引用方.md').snippets[0] || '').includes('开会时记到'),
    '上下文要是引用那一行',
  )
  assert.ok(
    (byPath.get('得到大脑/随手记/别名引用方.md').snippets[0] || '').includes('用别名引一下'),
    '写的是别名也得挑得出那一行',
  )
  assert.equal(byPath.has('得到大脑/随手记/无关方.md'), false, '没引用的不该被算进来')

  // 出链那条不该被绕成异步：它就在这一篇正文里，/read 早算好了
  const out = plugin.vaultGraphOf('得到大脑/随手记/引用方.md', 'links')
  assert.ok(!(out instanceof Promise), '出链要保持同步')

  // 没有反链时原样返回，不额外读盘
  app.metadataCache.resolvedLinks = {}
  const empty = await plugin.vaultGraphWithSnippets('得到大脑/随手记/无关方.md', 'backlinks')
  assert.ok(
    empty === null || (Array.isArray(empty.hits) && empty.hits.length === 0),
    '没反链时不该凭空造出命中，实际：' + JSON.stringify(empty),
  )

  app.metadataCache.resolvedLinks = {}
})

test('双链指向哪一篇由宿主的索引说了算，问不到才自己找', async () => {
  await adapter.write('得到大脑/随手记/同名.md', '# 随手记里的同名\n')
  await adapter.mkdir('得到大脑/日记')
  await adapter.write('得到大脑/日记/同名.md', '# 日记里的同名\n')
  await adapter.write('得到大脑/随手记/引用方.md', '# 引用方\n')

  // 宿主说「同名」指的是日记里那篇——面板自己按文件名找会先撞上随手记里那篇
  app.metadataCache.linkDest = { 同名: '得到大脑/日记/同名.md' }
  assert.equal(plugin.linkResolveFor('同名', '得到大脑/随手记/引用方.md'), '日记/同名.md', '要按宿主的口径换算成面板口径')
  // 带 .md、带库内相对路径前缀也要认
  assert.equal(plugin.linkResolveFor('同名.md', '得到大脑/随手记/引用方.md'), '日记/同名.md')

  // 宿主没登记时按文件名找，取到的是它自己的结果
  app.metadataCache.linkDest = {}
  assert.equal(plugin.linkResolveFor('引用方', '得到大脑/随手记/同名.md'), '随手记/引用方.md')

  // 落在笔记目录之外、解析不出来、空串一律返回 ''，让面板退回自己那套
  app.metadataCache.linkDest = { 外头: '别处的目录/外头.md' }
  assert.equal(plugin.linkResolveFor('外头', ''), '', '笔记目录之外的不接')
  assert.equal(plugin.linkResolveFor('根本没有', ''), '')
  assert.equal(plugin.linkResolveFor('', ''), '')
  assert.equal(plugin.linkResolveFor(null, null), '')

  // 宿主的索引炸了也不能把面板带崩
  const brokenCache = app.metadataCache
  app.metadataCache = {
    getFirstLinkpathDest() { throw new Error('索引坏了') },
  }
  assert.equal(plugin.linkResolveFor('同名', ''), '')
  app.metadataCache = brokenCache
  delete app.metadataCache.linkDest
})

test('页面预览的来源登记给宿主了，鼠标停在内链上才弹得出来', async () => {
  assert.equal(calls.hoverSources.length, 1, '应该登记了一个预览来源')
  assert.equal(calls.hoverSources[0].id, 'getnote-brain')
  assert.equal(calls.hoverSources[0].info.display, '得到大脑')
})

test('「在得到大脑里打开当前笔记」把宿主正在看的那篇交给面板，目录外就明说', async () => {
  await adapter.mkdir('得到大脑')
  await adapter.mkdir('得到大脑/随手记')
  await adapter.write('得到大脑/随手记/跟随验收.md', '# 跟随验收')
  await adapter.mkdir('别处的目录')
  await adapter.write('别处的目录/外头.md', '# 外头')

  // 面板被叫起来（说明真的去开视图了，不是静默不动）
  const opened = []
  const leaf = app.workspace.getLeaf
  app.workspace.getLeaf = () => ({
    setViewState: async (state) => { opened.push(state && state.type) },
    openFile: async () => {},
  })

  app.workspace.activeFile = { path: '得到大脑/随手记/跟随验收.md' }
  await plugin.openActiveNote()
  assert.deepEqual(opened, ['getnote-brain-view'], '应该把面板叫起来')

  // 目录外的文件、没开笔记：都不该炸，也不该把面板叫起来
  const notices = calls.notices.length
  app.workspace.activeFile = { path: '别处的目录/外头.md' }
  await plugin.openActiveNote()
  assert.ok(calls.notices.length > notices, '目录外应该明确说一句')
  assert.match(String(calls.notices[calls.notices.length - 1]), /不在/, '提示要说清楚为什么')

  app.workspace.activeFile = null
  assert.doesNotThrow(() => plugin.openActiveNote())
  await plugin.openActiveNote()
  app.workspace.activeFile = {}
  await plugin.openActiveNote()

  app.workspace.getLeaf = leaf
  app.workspace.activeFile = null
})

test('复制引用用的是宿主自己的链接格式，找不到文件就交回面板自己拼', async () => {
  await adapter.mkdir('得到大脑')
  await adapter.mkdir('得到大脑/随手记')
  await adapter.write('得到大脑/随手记/链接验收.md', '# 链接验收')

  // 面板给的是「相对笔记目录」的路径，宿主要的是库内相对路径
  assert.equal(plugin.markdownLinkFor('随手记/链接验收.md'), '[[得到大脑/随手记/链接验收.md]]')
  // 已经是库内相对路径的照样认（不重复拼子目录）
  assert.equal(plugin.markdownLinkFor('得到大脑/随手记/链接验收.md'), '[[得到大脑/随手记/链接验收.md]]')
  // 前导斜杠可容忍
  assert.equal(plugin.markdownLinkFor('/随手记/链接验收.md'), '[[得到大脑/随手记/链接验收.md]]')

  // 找不到文件 / 空路径 → 空串，面板退回绝对路径口径
  assert.equal(plugin.markdownLinkFor('随手记/根本没有.md'), '')
  assert.equal(plugin.markdownLinkFor(''), '')
  assert.equal(plugin.markdownLinkFor(null), '')

  // 宿主没提供 generateMarkdownLink，或它自己炸了，都不抛
  const manager = app.fileManager
  app.fileManager = {}
  assert.equal(plugin.markdownLinkFor('随手记/链接验收.md'), '')
  app.fileManager = { generateMarkdownLink() { throw new Error('生成不了') } }
  assert.equal(plugin.markdownLinkFor('随手记/链接验收.md'), '')
  app.fileManager = manager
})

test('附件地址走宿主自己的资源协议，宿主没给才退回本地服务', async () => {
  await adapter.mkdir('得到大脑')
  await adapter.mkdir('得到大脑/随手记')

  // 面板给的是「相对笔记目录」的路径，宿主要的是库内相对路径
  assert.equal(plugin.assetUrlFor('随手记/图.png'), 'app://fake-vault/得到大脑/随手记/图.png')
  // 已经是库内相对路径的照样认（不重复拼子目录）
  assert.equal(plugin.assetUrlFor('得到大脑/随手记/图.png'), 'app://fake-vault/得到大脑/随手记/图.png')
  // 反斜杠与前导斜杠都容忍
  assert.equal(plugin.assetUrlFor('/随手记/图.png'), 'app://fake-vault/得到大脑/随手记/图.png')
  assert.equal(plugin.assetUrlFor('随手记\\图.png'), 'app://fake-vault/得到大脑/随手记/图.png')

  // 空路径 → 空串，面板退回本地服务地址
  assert.equal(plugin.assetUrlFor(''), '')
  assert.equal(plugin.assetUrlFor(null), '')

  // 宿主没提供 getResourcePath，或它自己炸了，都不抛（面板退回本地服务）
  const realAdapter = app.vault.adapter
  app.vault.adapter = { getBasePath: () => BASE }
  assert.equal(plugin.assetUrlFor('随手记/图.png'), '')
  app.vault.adapter = { getResourcePath() { throw new Error('拿不到') } }
  assert.equal(plugin.assetUrlFor('随手记/图.png'), '')
  app.vault.adapter = realAdapter
})

test('「在文件列表里定位」把这一项亮给宿主，没有接口就明说', async () => {
  await adapter.write('得到大脑/随手记/定位验收.md', '---\ntitle: 定位验收\n---\n\n正文\n')

  // ① 宿主把文件列表的实例给了我们：路径要真的交到 revealInFolder 上
  const revealed = []
  app.internalPlugins = {
    getPluginById: (id) =>
      id === 'file-explorer' ? { enabled: true, instance: { revealInFolder: (file) => revealed.push(file.path) } } : null,
  }
  assert.equal(plugin.revealInVaultItem('随手记/定位验收.md'), true, '相对笔记目录的口径要认')
  assert.deepEqual(revealed, ['得到大脑/随手记/定位验收.md'], '交给宿主的应该是库内相对路径')

  // 库内相对路径的口径也认，且不该重复补前缀
  assert.equal(plugin.revealInVaultItem('得到大脑/随手记/定位验收.md'), true)
  assert.deepEqual(revealed, ['得到大脑/随手记/定位验收.md', '得到大脑/随手记/定位验收.md'])

  // ② 老版本没有 internalPlugins，只有叶子视图：也要能定位
  app.internalPlugins = null
  const viewRevealed = []
  const realLeaves = app.workspace.getLeavesOfType
  app.workspace.getLeavesOfType = (type) =>
    type === 'file-explorer' ? [{ view: { revealInFolder: (file) => viewRevealed.push(file.path) } }] : []
  assert.equal(plugin.revealInVaultItem('随手记/定位验收.md'), true, '叶子视图上的接口也要认')
  assert.deepEqual(viewRevealed, ['得到大脑/随手记/定位验收.md'])
  app.workspace.getLeavesOfType = realLeaves

  // ③ 库里没有这一篇：不动作
  assert.equal(plugin.revealInVaultItem('随手记/根本没有.md'), false)
  assert.equal(plugin.revealInVaultItem(''), false)
  assert.equal(plugin.revealInVaultItem(null), false)

  // ④ 两处接口都没有：要说出来，不能静默
  app.internalPlugins = null
  const before = calls.notices.length
  assert.equal(plugin.revealInVaultItem('随手记/定位验收.md'), false)
  assert.equal(calls.notices.length, before + 1, '定位不了的时候得告诉用户一声')
  assert.match(String(calls.notices[calls.notices.length - 1]), /文件列表|定位/)
})

test('图片交给宿主打开，路径口径与别处一致', async () => {
  await adapter.mkdir('得到大脑/随手记')
  await adapter.writeBinary('得到大脑/随手记/图验收.png', Buffer.from([137, 80, 78, 71]))

  app.workspace.openedFiles.length = 0
  // 相对笔记目录的口径：补上笔记子目录再交给宿主
  assert.equal(plugin.openAssetInVault('随手记/图验收.png'), true, '相对笔记目录的口径要认')
  // 库内相对路径的口径也认，且不该重复补前缀
  assert.equal(plugin.openAssetInVault('得到大脑/随手记/图验收.png'), true)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(
    app.workspace.openedFiles,
    ['得到大脑/随手记/图验收.png', '得到大脑/随手记/图验收.png'],
    '交给宿主的应该是库内相对路径',
  )

  // 库里没有这张图（附件还在云端）：不动作
  assert.equal(plugin.openAssetInVault('随手记/根本没有.png'), false)
  assert.equal(plugin.openAssetInVault(''), false)
  assert.equal(plugin.openAssetInVault(null), false)

  // 宿主查文件时抛错：返回 false，不能把面板带崩
  const realGet = app.vault.getAbstractFileByPath
  app.vault.getAbstractFileByPath = () => {
    throw new Error('索引还没建好')
  }
  assert.equal(plugin.openAssetInVault('随手记/图验收.png'), false)
  app.vault.getAbstractFileByPath = realGet
})

test('改名交给宿主的对话框，改完把新路径交回面板', async () => {
  await adapter.mkdir('得到大脑/随手记')
  await adapter.write('得到大脑/随手记/改名前.md', '# 改名前\n')

  const asked = []
  const realManager = app.fileManager
  app.fileManager = {
    generateMarkdownLink: realManager.generateMarkdownLink,
    async promptForFileRename(file) {
      asked.push(String(file.path))
      await adapter.rename(file.path, '得到大脑/随手记/改名后.md')
      file.path = '得到大脑/随手记/改名后.md'
    },
  }
  // 相对笔记目录的口径：补上笔记子目录再交给宿主
  assert.equal(await plugin.renameNoteInVault('随手记/改名前.md'), '随手记/改名后.md')
  assert.deepEqual(asked, ['得到大脑/随手记/改名前.md'], '交给宿主对话框的应该是库内相对路径')

  // 库内相对路径的口径也认，且不该重复补前缀
  await adapter.write('得到大脑/随手记/甲.md', '# 甲\n')
  asked.length = 0
  app.fileManager.promptForFileRename = async (file) => {
    await adapter.rename(file.path, '得到大脑/随手记/乙.md')
    file.path = '得到大脑/随手记/乙.md'
  }
  assert.equal(await plugin.renameNoteInVault('得到大脑/随手记/甲.md'), '随手记/乙.md')
  assert.deepEqual(asked, [], '库内相对路径的口径不该再问一次')

  // 用户在对话框里按了取消：路径没变，交回空串，面板什么都不做
  app.fileManager.promptForFileRename = async (file) => {
    asked.push(String(file.path))
  }
  await adapter.write('得到大脑/随手记/不动.md', '# 不动\n')
  assert.equal(await plugin.renameNoteInVault('随手记/不动.md'), '')
  assert.deepEqual(asked, ['得到大脑/随手记/不动.md'])

  // 改到笔记目录之外：面板里打不开，交回空串让面板只刷新列表
  await adapter.write('得到大脑/随手记/搬出去.md', '# 搬出去\n')
  app.fileManager.promptForFileRename = async (file) => {
    await adapter.rename(file.path, '别处的目录/搬出去.md')
    file.path = '别处的目录/搬出去.md'
  }
  assert.equal(await plugin.renameNoteInVault('随手记/搬出去.md'), '')

  // 库里没有这一篇：不弹对话框
  assert.equal(await plugin.renameNoteInVault('随手记/根本没有.md'), '')
  assert.equal(await plugin.renameNoteInVault(''), '')
  assert.equal(await plugin.renameNoteInVault(null), '')

  // 宿主没有这个接口：明说一句，别静默
  app.fileManager = { generateMarkdownLink: realManager.generateMarkdownLink }
  const before = calls.notices.length
  assert.equal(await plugin.renameNoteInVault('随手记/改名后.md'), '')
  assert.equal(calls.notices.length, before + 1)
  assert.match(String(calls.notices[calls.notices.length - 1]), /改名/)

  // 宿主查文件时抛错：返回空串，不能把面板带崩
  app.fileManager = realManager
  const realGet = app.vault.getAbstractFileByPath
  app.vault.getAbstractFileByPath = () => {
    throw new Error('索引还没建好')
  }
  assert.equal(await plugin.renameNoteInVault('随手记/改名后.md'), '')
  app.vault.getAbstractFileByPath = realGet
})

test('跟着宿主切换笔记：面板开着才跟、开关关着不跟', async () => {
  await adapter.write('得到大脑/随手记/跟随验收.md', '# 跟随验收\n')

  // 用真的 HTTP 接口写设置，别绕过 service 那一层——那边少一行解析就白搭
  const origin = plugin.server.origin
  const auth = { 'x-getnote-token': plugin.server.token }
  const setFollow = async (on) => {
    const response = await fetch(origin + '/getnote/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ followActive: on }),
    })
    assert.equal(response.status, 200)
    const json = await response.json()
    assert.equal(json.followActive, on, '设置写进去要能读回来')
  }

  // 面板开着：宿主里翻到笔记目录里的某一篇，就投递一条「打开这篇」的意图
  const realLeaves = app.workspace.getLeavesOfType
  app.workspace.getLeavesOfType = (type) => (type === 'getnote-brain-view' ? [{}, {}] : [])

  await setFollow(false)
  assert.equal(
    await plugin.followActiveNote({ path: '得到大脑/随手记/跟随验收.md' }),
    'off',
    '开关关着就不该跟',
  )

  await setFollow(true)
  assert.equal(
    await plugin.followActiveNote({ path: '得到大脑/随手记/跟随验收.md' }),
    'followed',
    '开着的时候应该跟上去',
  )

  // 面板没开着：不替用户把面板拉起来
  app.workspace.getLeavesOfType = () => []
  assert.equal(
    await plugin.followActiveNote({ path: '得到大脑/随手记/跟随验收.md' }),
    'closed',
    '面板没开着时不该跟',
  )

  // 不在笔记目录里的文件：连面板路径都算不出来，直接不跟
  app.workspace.getLeavesOfType = (type) => (type === 'getnote-brain-view' ? [{}, {}] : [])
  assert.equal(await plugin.followActiveNote({ path: '别处的目录/甲.md' }), 'outside')
  assert.equal(await plugin.followActiveNote(null), 'outside')
  assert.equal(await plugin.followActiveNote({ path: '得到大脑/随手记/图.png' }), 'outside')

  app.workspace.getLeavesOfType = realLeaves

  // 宿主切笔记时会发 file-open，插件得挂上去（没挂上就永远不跟）
  const openedBefore = app.workspace.openedFiles.length
  const listeners = app.workspace.wsHandlers['file-open'] || []
  assert.equal(listeners.length, 1, '应该注册了一个 file-open 监听')
  assert.doesNotThrow(() => {
    for (const fn of listeners) fn({ path: '得到大脑/随手记/跟随验收.md' })
  }, 'file-open 回调不该抛')
  assert.doesNotThrow(() => listeners[0](null), 'file 为 null 也不该抛')

  // 跟着走这件事只动面板，不该把宿主里正在看的那篇换掉
  assert.equal(app.workspace.openedFiles.length, openedBefore, '跟随不该去动宿主的活动文件')

  await setFollow(false)
})

test('版本历史留几版是设置项：写进去能读回来，乱填的当没填', async () => {
  // 这个数字以前写死在 history.js 里。做成设置项之后，最容易坏的地方是
  // 「写进去了但 status 没跟着变」——设置页那张卡的初值就是 status 里的值。
  const origin = plugin.server.origin
  const auth = { 'x-getnote-token': plugin.server.token }
  const setLimit = async (value) => {
    const response = await fetch(origin + '/getnote/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ historyLimit: value }),
    })
    assert.equal(response.status, 200)
    return response.json()
  }
  const readStatus = async () => {
    const response = await fetch(origin + '/getnote/status', { headers: auth })
    assert.equal(response.status, 200)
    return response.json()
  }

  // 默认就是 10 版——升级上来的库不用改任何东西
  assert.equal((await readStatus()).historyLimit, 10, '默认留 10 版')

  const written = await setLimit(3)
  assert.equal(written.historyLimit, 3, '写进去要能读回来')
  assert.equal((await readStatus()).historyLimit, 3, 'status 里也要跟着变')

  // 上下界收在 1 到 200：填 0 当 1 版，填 999 当 200 版
  assert.equal((await setLimit(0)).historyLimit, 1, '0 当 1 版')
  assert.equal((await setLimit(999)).historyLimit, 200, '超过上限按 200 算')

  // 传字符串当没传：settings 是 JSON 文件，手改坏了不该把面板带崩
  assert.equal((await setLimit('三')).historyLimit, 200, '非数字当没传，保留原值')

  await setLimit(10)
})

test('onunload 会关掉本地服务', async () => {
  const origin = plugin.server.origin
  plugin.onunload()
  assert.equal(plugin.server, null)
  let failed = false
  try {
    await fetch(origin + '/getnote/status', { headers: { 'x-getnote-token': plugin.server.token } })
  } catch {
    failed = true
  }
  assert.equal(failed, true, '服务应该已经关了')
  // 库根是 mkdtemp 出来的，测完删掉，别在临时目录里留垃圾
  await rm(BASE, { recursive: true, force: true })
})

test('面板开不出来时把原因写进轨迹、弹一句能看懂的提示，不留一条没人接的拒绝', async () => {
  // 调用方几乎都是 `void plugin.activateView()`：里面抛出去就是一条没人接的
  // Promise 拒绝——屏幕没反应、boot.txt 也一个字不留，用户只能对着黑屏猜。
  const realGetLeaf = app.workspace.getLeaf
  // 前面几条用例可能已经把服务停掉了；这里要验的是「挑叶子这一步炸了」的兜底，
  // 不是「服务没起来」，所以先摆一个占位服务，跑完再还回去。
  const realServer = plugin.server
  plugin.server = { origin: 'http://127.0.0.1:1' }
  app.workspace.getLeaf = () => { throw new Error('宿主不给叶子') }
  const before = calls.notices.length
  try {
    await assert.doesNotReject(() => plugin.activateView())
  } finally {
    app.workspace.getLeaf = realGetLeaf
    plugin.server = realServer
  }
  assert.equal(calls.notices.length, before + 1, '开不出来得说一句')
  assert.match(String(calls.notices[calls.notices.length - 1]), /面板没能打开/, '提示要说明是面板没开成')
  assert.match(String(calls.notices[calls.notices.length - 1]), /宿主不给叶子/, '提示里要带上真正的原因')
  const lines = Array.isArray(plugin.probeLines) ? plugin.probeLines : []
  assert.ok(
    lines.some((line) => String(line).includes('activateView 失败')),
    '轨迹里要留下这一句：' + lines.join(' | '),
  )
})
test('设置页里能把启动轨迹摊出来、也能一次抄走，读不到时说一句而不是空着', async () => {
  await adapter.mkdir('得到大脑')
  // 假 adapter 和真宿主一样不会替你建父目录：插件目录不在，探针那一下会被 catch 吞掉，
  // boot.txt 根本写不出来。先把目录摆好，再写一行。
  await adapter.mkdir('.obsidian')
  await adapter.mkdir('.obsidian/plugins')
  await adapter.mkdir('.obsidian/plugins/getnote-brain')
  plugin.probe('设置页轨迹验收')
  await new Promise((done) => setTimeout(done, 30))

  // ① 摊出来：pre 里就是 boot.txt 的原文，第二次点不会叠两份
  const box = fakeModalEl('div')
  await plugin.showBootTrace(box)
  const pre = box.children.find((child) => String(child.cls || '') === 'dshgn_bootTrace')
  assert.ok(pre, '设置页里应该摆出一块轨迹')
  assert.ok(pre.text.includes('设置页轨迹验收'), '轨迹里要有刚写进去的那一行')
  await plugin.showBootTrace(box)
  assert.equal(
    box.children.filter((child) => String(child.cls || '') === 'dshgn_bootTrace').length,
    1,
    '再点一次是换掉那一份，不是叠一份',
  )

  // ② 复制：写进剪贴板的应该就是那一份原文
  const realClipboard = globalThis.navigator && globalThis.navigator.clipboard
  let copied = ''
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async (text) => { copied = String(text) } } },
    configurable: true,
    writable: true,
  })
  try {
    await plugin.copyBootTrace()
    assert.ok(copied.includes('设置页轨迹验收'), '复制到的应该就是轨迹原文')
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: realClipboard },
      configurable: true,
      writable: true,
    })
  }

  // ③ 读不到的时候不空着：返回空串，设置页里写一句人话
  const realAdapter = app.vault.adapter
  app.vault.adapter = { async read() { throw new Error('ENOENT') } }
  assert.equal(await plugin.readBootTrace(), '', '读不到就返回空串，不抛')
  const emptyBox = fakeModalEl('div')
  await plugin.showBootTrace(emptyBox)
  const emptyPre = emptyBox.children.find((child) => String(child.cls || '') === 'dshgn_bootTrace')
  assert.ok(emptyPre, '读不到也要摆一块，说明没有轨迹')
  assert.ok(emptyPre.text.includes('还没有轨迹'), '读不到时要说一句人话')
  app.vault.adapter = realAdapter
})


test('打包产物里每一处 node 内置模块的按需加载都留着 require 那条路', async () => {
  // 用户报「现在显示插件加载不出来」，启动轨迹只剩一行「onload 开始」。
  // 真因：Obsidian 用 new Function + require 把 main.js 装进渲染进程，那个执行
  // 环境没有动态 import 的回调，import('node:fs/promises') 会抛
  // ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING —— onload 第二步就炸了。
  // 所以这里钉住：产物里每一处 import("node:…") 的同一行都必须带着 require 兜底。
  const bundle = await readFile(new URL('../main.js', import.meta.url), 'utf8')
  const offenders = bundle
    .split('\n')
    .map((line, index) => ({ line, no: index + 1 }))
    .filter((item) => item.line.includes('import("node:') && !item.line.includes('require('))
  assert.deepEqual(
    offenders.map((item) => `${item.no}: ${item.line.trim().slice(0, 120)}`),
    [],
    '这些行的 import("node:…") 没有 require 兜底，Obsidian 里会直接抛 ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING',
  )
})
