import { test } from 'node:test'
import assert from 'node:assert/strict'

import { configure, reset, readdir, mkdir, writeFile, appendFile, rm } from '../src/core/vfs.js'

/**
 * 这一组测试针对「假 adapter」和「真 adapter」的语义差异。
 *
 * Obsidian 的 DataAdapter.list() 在官方类型里只写了 `files: string[]` /
 * `folders: string[]`，没说里面是裸文件名还是「相对库根的完整路径」。
 * vfs.readdir 必须两种都吃得住，否则 vault.js 的 scanVault 会把整条路径
 * 当文件名再拼一次，笔记扫描直接失效（而且只在真宿主里才复现）。
 */

function makeAdapter({ listReturnsFullPath }) {
  /** rel -> { dir: true } | { text } */
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
    getBasePath: () => '/vault',
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
        // 关键开关：真宿主有可能回完整路径，这里把它模拟出来
        const shown = listReturnsFullPath ? key : rest
        if (nodes.get(key).dir) folders.push(shown)
        else files.push(shown)
      }
      return { folders, files }
    },
    async read(p) { const n = nodes.get(norm(p)); if (!n || n.dir) throw new Error('ENOENT ' + p); return n.text ?? '' },
    async readBinary(p) { const n = nodes.get(norm(p)); if (!n || n.dir) throw new Error('ENOENT ' + p); return new TextEncoder().encode(n.text ?? '').buffer },
    async stat(p) { const n = nodes.get(norm(p)); if (!n) return null; return { type: n.dir ? 'folder' : 'file', size: (n.text || '').length, mtime: 1, ctime: 1 } },
    async mkdir(p) { const rel = norm(p); requireParent(rel); nodes.set(rel, { dir: true }) },
    async write(p, data) { const rel = norm(p); requireParent(rel); nodes.set(rel, { text: String(data) }) },
    async writeBinary(p, data) { const rel = norm(p); requireParent(rel); nodes.set(rel, { text: String(data) }) },
    async append(p, data) { const rel = norm(p); const n = nodes.get(rel); nodes.set(rel, { text: (n && n.text ? n.text : '') + String(data) }) },
    async appendBinary(p, data) { await this.append(p, data) },
    async remove(p) { nodes.delete(norm(p)) },
    async rmdir(p, recursive) {
      const rel = norm(p)
      // 真 adapter 的 rmdir(rel, true) 是递归删；不模拟这点，vfs.rm 的
      // 「目录走 rmdir 而不是 remove」就没法验证。
      if (recursive) {
        for (const key of [...nodes.keys()]) {
          if (key === rel || key.startsWith(rel + '/')) nodes.delete(key)
        }
        return
      }
      nodes.delete(rel)
    },
    async rename(a, b) { const rel = norm(a); const n = nodes.get(rel); nodes.delete(rel); ensureParents(norm(b)); nodes.set(norm(b), n) },
    async copy(a, b) { const n = nodes.get(norm(a)); ensureParents(norm(b)); nodes.set(norm(b), n) },
    _dump: () => [...nodes.keys()].filter(Boolean).sort(),
  }
}

async function withAdapter(opts, fn) {
  const adapter = makeAdapter(opts)
  configure({ adapter, basePath: '/vault' })
  try {
    await fn(adapter)
  } finally {
    reset()
  }
}

test('readdir：adapter.list 返回裸文件名时原样可用', async () => {
  await withAdapter({ listReturnsFullPath: false }, async (adapter) => {
    await mkdir('/vault/笔记/子目录', { recursive: true })
    await writeFile('/vault/笔记/a.md', '# a')
    await writeFile('/vault/笔记/子目录/b.md', '# b')

    const entries = await readdir('/vault/笔记')
    assert.deepEqual(entries.sort(), ['a.md', '子目录'])

    const dirents = await readdir('/vault/笔记', { withFileTypes: true })
    assert.deepEqual(dirents.map((d) => d.name).sort(), ['a.md', '子目录'])
    assert.equal(dirents.find((d) => d.name === '子目录').isDirectory(), true)
    assert.equal(dirents.find((d) => d.name === 'a.md').isFile(), true)
  })
})

test('readdir：adapter.list 返回完整路径时收敛成裸文件名', async () => {
  await withAdapter({ listReturnsFullPath: true }, async () => {
    await mkdir('/vault/笔记/子目录', { recursive: true })
    await writeFile('/vault/笔记/a.md', '# a')
    await writeFile('/vault/笔记/子目录/b.md', '# b')

    const entries = await readdir('/vault/笔记')
    // 如果这里回的是 '笔记/a.md'，vault.js 的 scanVault 就会拼成
    // '/vault/笔记/笔记/a.md'，笔记在真宿主里全部消失。
    assert.deepEqual(entries.sort(), ['a.md', '子目录'])

    const dirents = await readdir('/vault/笔记', { withFileTypes: true })
    assert.deepEqual(dirents.map((d) => d.name).sort(), ['a.md', '子目录'])
  })
})

test('mkdir 逐级补齐父目录（adapter 自己不建父级）', async () => {
  await withAdapter({ listReturnsFullPath: false }, async (adapter) => {
    // 笔记目录允许设成「李欣颀/知识库/得到大脑归档」这种多级路径
    await mkdir('/vault/李欣颀/知识库/得到大脑归档', { recursive: true })
    const dump = adapter._dump()
    assert.ok(dump.includes('李欣颀'), dump.join(','))
    assert.ok(dump.includes('李欣颀/知识库'), dump.join(','))
    assert.ok(dump.includes('李欣颀/知识库/得到大脑归档'), dump.join(','))
  })
})

test('writeFile 自动补齐父目录', async () => {
  await withAdapter({ listReturnsFullPath: false }, async (adapter) => {
    await writeFile('/vault/a/b/c.md', '# c')
    assert.ok(adapter._dump().includes('a/b/c.md'), adapter._dump().join(','))
  })
})

test('appendFile 也会补齐父目录', async () => {
  await withAdapter({ listReturnsFullPath: false }, async (adapter) => {
    await appendFile('/vault/日志/2026/11.md', '第一行\n')
    assert.ok(adapter._dump().includes('日志/2026/11.md'), adapter._dump().join(','))
    assert.equal(await adapter.read('日志/2026/11.md'), '第一行\n')
  })
})

test('rm 目录走 rmdir(recursive)，不会拿 remove 硬删目录', async () => {
  await withAdapter({ listReturnsFullPath: false }, async (adapter) => {
    await writeFile('/vault/待删/里面.md', '# x')
    await rm('/vault/待删', { recursive: true, force: true })
    assert.equal(adapter._dump().includes('待删/里面.md'), false, adapter._dump().join(','))
    // force 删不存在的路径不该抛
    await rm('/vault/根本不存在', { recursive: true, force: true })
  })
})

test('越界路径一律拒绝', async () => {
  await withAdapter({ listReturnsFullPath: false }, async () => {
    await assert.rejects(() => readdir('C:/Windows'), (err) => err.status === 400)
  })
})
