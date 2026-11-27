/**
 * 搜索复用已解析内容缓存（T3 验收）。
 *
 * 搜索原来每打一次就把全库 readFile 一遍，哪怕刚刚扫过库、哪怕同一个查询刚搜过。
 * 现在扫库与搜索共用一份「正文记忆」（键是绝对路径 + mtimeMs + size），所以：
 *   · 同一查询连打两次，第二次一次盘都不读；
 *   · 刚扫过库再搜，同样不读盘（扫库时已经把正文记下来了）；
 *   · 正文记忆另有字节上限，超了就按 LRU 淘汰，淘汰之后结果照样正确。
 *
 * 这里用计数型 fake adapter 走 vfs 的 adapter 后端，直接数 adapter.read 的调用次数
 * ——比给 fs 打桩更贴近真机（插件运行时走的就是这条路径）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { configure, reset } from '../src/core/vfs.js'
import { scanVault, searchNotes, invalidateScan, setTextMemoLimit, textMemoStats } from '../src/core/vault.js'

const BASE = '/vault'
const DEFAULT_LIMIT = 64 * 1024 * 1024

function makeAdapter(files) {
  /** rel path -> { text } | { dir: true } */
  const nodes = new Map([['', { dir: true }]])
  // 真宿主里目录是先建出来的；这里按文件路径把父目录补齐，省得每个用例都要
  // 手写一遍「目录也在 nodes 里」。
  const ensureParents = (rel) => {
    const parts = rel.split('/')
    parts.pop()
    let acc = ''
    for (const part of parts) {
      acc = acc === '' ? part : `${acc}/${part}`
      if (!nodes.has(acc)) nodes.set(acc, { dir: true })
    }
  }
  for (const rel of Object.keys(files)) {
    ensureParents(rel)
    nodes.set(rel, { text: files[rel] })
  }
  const counts = { read: 0, stat: 0, list: 0 }
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return {
    counts,
    getBasePath: () => BASE,
    getResourcePath: (p) => `app://fake/${norm(p)}`,
    async exists(p) { return nodes.has(norm(p)) },
    async list(p) {
      counts.list += 1
      const rel = norm(p)
      if (!nodes.has(rel)) throw new Error('ENOENT ' + rel)
      const prefix = rel === '' ? '' : rel + '/'
      const folders = []
      const out = []
      for (const key of nodes.keys()) {
        if (key === rel || !key.startsWith(prefix)) continue
        const rest = key.slice(prefix.length)
        if (rest.includes('/')) continue
        if (nodes.get(key).dir) folders.push(rest)
        else out.push(rest)
      }
      return { folders, files: out }
    },
    async read(p) {
      counts.read += 1
      const n = nodes.get(norm(p))
      if (!n || n.dir) throw new Error('ENOENT ' + p)
      return n.text ?? ''
    },
    async readBinary(p) {
      const text = await this.read(p)
      return new TextEncoder().encode(text).buffer
    },
    async stat(p) {
      counts.stat += 1
      const n = nodes.get(norm(p))
      if (!n) return null
      return { type: n.dir ? 'folder' : 'file', size: n.text ? n.text.length : 0, mtime: 1, ctime: 1 }
    },
    async write(p, data) { nodes.set(norm(p), { text: String(data) }) },
    async writeBinary(p, data) { nodes.set(norm(p), { text: Buffer.from(data).toString('utf8') }) },
    async append(p, data) {
      const rel = norm(p)
      const n = nodes.get(rel)
      nodes.set(rel, { text: (n && n.text ? n.text : '') + String(data) })
    },
    async appendBinary(p, data) { await this.append(p, data) },
    async mkdir(p) { nodes.set(norm(p), { dir: true }) },
    async remove(p) {
      const rel = norm(p)
      for (const key of [...nodes.keys()]) {
        if (key === rel || key.startsWith(rel + '/')) nodes.delete(key)
      }
    },
    async rmdir(p) { await this.remove(p) },
    async rename(a, b) { const n = nodes.get(norm(a)); nodes.delete(norm(a)); nodes.set(norm(b), n) },
    async copy(a, b) { nodes.set(norm(b), { ...nodes.get(norm(a)) }) },
  }
}

/** 每个用例都在干净的缓存上跑，收尾一律还原成默认上限。 */
async function withVault(files, fn) {
  const adapter = makeAdapter(files)
  configure({ adapter, basePath: BASE })
  invalidateScan()
  try {
    await fn(adapter)
  } finally {
    reset()
    invalidateScan()
    setTextMemoLimit(DEFAULT_LIMIT)
  }
}

const FILES = {
  '随手记/有菠萝蜜.md': '# 有菠萝蜜\n\n菠萝蜜是关键词。\n',
  '随手记/另一篇.md': '# 另一篇\n\n这里没有那个词。\n',
}

test('同一查询连打两次，第二次一次盘都不读', async () => {
  await withVault(FILES, async (adapter) => {
    const first = await searchNotes(BASE, '菠萝蜜')
    assert.ok(adapter.counts.read > 0, '第一次搜索总得读盘')
    assert.equal(first.hits.length, 1)
    assert.equal(first.hits[0].path, '随手记/有菠萝蜜.md')

    adapter.counts.read = 0
    const second = await searchNotes(BASE, '菠萝蜜')
    assert.equal(adapter.counts.read, 0, '第二次搜索不该再读盘')
    assert.deepEqual(second.hits.map((h) => h.path), first.hits.map((h) => h.path))
  })
})

test('刚扫过库再搜，正文不必再读一遍', async () => {
  await withVault(FILES, async (adapter) => {
    const scan = await scanVault(BASE)
    assert.equal(scan.entries.length, 2)
    adapter.counts.read = 0
    const found = await searchNotes(BASE, '菠萝蜜')
    assert.equal(adapter.counts.read, 0, '扫库时已经读过正文，搜索应当复用')
    assert.equal(found.hits.length, 1)
  })
})

test('正文缓存超字节上限时按 LRU 淘汰，淘汰后结果仍然正确', async () => {
  // 四篇各 60 字节上下：上限给 120，最多只装得下两篇，必然发生淘汰。
  const files = {}
  for (let i = 0; i < 4; i += 1) {
    files[`目录/第${i}篇.md`] = `# 第${i}篇\n\n菠萝蜜在这篇里出现。\n` + '填充'.repeat(8)
  }
  await withVault(files, async () => {
    setTextMemoLimit(120)
    const first = await searchNotes(BASE, '菠萝蜜')
    assert.equal(first.hits.length, 4, '四篇都该命中')
    const stats = textMemoStats()
    assert.ok(stats.bytes <= 120, `占用不该超上限，实际 ${stats.bytes}`)
    assert.ok(stats.entries > 0, '上限之内该留下东西，不能一超就全清')
    assert.ok(stats.entries < 4, `四篇装不进 120 字节，应当淘汰掉一些，实际 ${stats.entries}`)

    const second = await searchNotes(BASE, '菠萝蜜')
    assert.deepEqual(second.hits.map((h) => h.path).sort(), first.hits.map((h) => h.path).sort())
    assert.ok(textMemoStats().bytes <= 120)
  })
})

test('invalidateScan 不传库根时把正文缓存一起清掉', async () => {
  await withVault(FILES, async (adapter) => {
    await searchNotes(BASE, '菠萝蜜')
    assert.ok(textMemoStats().entries > 0)
    invalidateScan()
    assert.equal(textMemoStats().entries, 0)
    assert.equal(textMemoStats().bytes, 0)
    adapter.counts.read = 0
    await searchNotes(BASE, '菠萝蜜')
    assert.ok(adapter.counts.read > 0, '清掉之后必须重新读盘')
  })
})
