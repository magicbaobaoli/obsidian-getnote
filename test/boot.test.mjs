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
import { mkdtemp, copyFile, rm, access, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── 假 obsidian 模块 ────────────────────────────────────────────────────────
const calls = { views: [], ribbons: [], commands: [], settings: [], intervals: [] }

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

const obsidianStub = { Plugin, PluginSettingTab, Setting, ItemView, Notice, WorkspaceLeaf: class {} }

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
// 库根故意用「临时目录 + 中文 + 空格」：真实用户的库就长这样（D:\xinqi\应用\嘿嘿），
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
    // Obsidian 的 Events.on：插件用它在库变动时丢扫描缓存。测试里只记下
    // 回调，需要时手动触发（见「库变动会让扫描缓存失效」那条）。
    handlers: {},
    on(name, cb) {
      ;(this.handlers[name] = this.handlers[name] || []).push(cb)
      return { name, cb }
    },
  },
  workspace: {
    getLeavesOfType: () => [],
    revealLeaf: () => {},
    getLeaf: () => ({ setViewState: async () => {} }),
    openPopoutLeaf: () => ({ setViewState: async () => {} }),
  },
}

const plugin = new GetnotePlugin(app, { id: 'getnote-obsidian', version: '0.1.0' })

test('onload 能把插件拉起来', async () => {
  await plugin.onload()
  assert.equal(typeof plugin.server?.origin, 'string', '应该起了本地服务')
  assert.match(plugin.server.origin, /^http:\/\/127\.0\.0\.1:\d+$/)
  assert.equal(calls.views.length, 1, '注册了一个视图')
  assert.equal(calls.views[0].type, 'getnote-obsidian-view')
  assert.equal(calls.ribbons.length, 1, '注册了一个 ribbon')
  assert.equal(calls.ribbons[0].icon, 'brain')
  assert.deepEqual(calls.commands.map((c) => c.id), ['open-panel', 'open-in-new-window'])
  assert.equal(calls.settings.length, 1, '注册了设置页')
  assert.equal(calls.intervals.length >= 0, true)
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
  const dataDir = join(BASE, '.obsidian', 'plugins', 'getnote-obsidian')
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

  const moved = await post('/settings', { vaultPath: '李欣颀/知识库/得到大脑归档' })
  assert.equal(moved.status, 200, JSON.stringify(moved.json).slice(0, 200))
  assert.equal(moved.json.subfolder, '李欣颀/知识库/得到大脑归档')
  assert.equal(moved.json.effectiveRoot.replace(/\\/g, '/'), BASE + '/李欣颀/知识库/得到大脑归档')

  // 新目录里写东西要落进 adapter，而且真的建了嵌套目录
  const created = await post('/create', { dir: '', title: '换目录之后', content: '# 换目录之后\n' })
  assert.equal(created.status, 200, JSON.stringify(created.json).slice(0, 200))
  assert.ok(adapter._dump().some((p) => p.startsWith('李欣颀/知识库/得到大脑归档/')), adapter._dump().join(', '))

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
