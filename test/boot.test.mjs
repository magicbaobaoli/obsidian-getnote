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
import { mkdtemp, copyFile } from 'node:fs/promises'
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
const BASE = 'C:/fake-vault'

function makeAdapter() {
  /** rel path -> { text } | { bin } | { dir: true } */
  const nodes = new Map([['', { dir: true }]])
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
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
    async write(p, data) { const rel = norm(p); ensureParents(rel); nodes.set(rel, { text: String(data) }) },
    async writeBinary(p, data) { const rel = norm(p); ensureParents(rel); nodes.set(rel, { bin: Buffer.from(data) }) },
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
    async mkdir(p) { const rel = norm(p); ensureParents(rel); nodes.set(rel, { dir: true }) },
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
  vault: { adapter, configDir: '.obsidian' },
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
  const call = async (path, init) => {
    const res = await fetch(origin + '/getnote' + path, init)
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
})

test('onunload 会关掉本地服务', async () => {
  const origin = plugin.server.origin
  plugin.onunload()
  assert.equal(plugin.server, null)
  let failed = false
  try {
    await fetch(origin + '/getnote/status')
  } catch {
    failed = true
  }
  assert.equal(failed, true, '服务应该已经关了')
})
