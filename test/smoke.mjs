/**
 * 冒烟测试：真的起一遍本地服务，按面板的方式打几个接口。
 *
 * 这里**不** mock 任何东西：service.js、vault.js、settings.js 都是线上跑的那份，
 * 只是把 settings 指到一个临时目录。面板走的就是这条链路（fetch → 127.0.0.1 →
 * service handler → vault），所以它通了，面板的读/写/搜索就基本通了。
 *
 * 断言里的字段名都是从 handler 里抄的，不是猜的：
 *   /status      → { vaultRoot, notes, dirs, bytes, ... }        （handleStatus）
 *   /tree        → { root, tree: {name,path,kind,children,count} }（handleTree）
 *   /create      → { ok, path, ... }                              （handleCreate）
 *   /save        → { ok, path, ... }，body 里必须有 path          （handleSave）
 *   /search      → { query, hits, scanned }                       （handleSearch）
 *   /settings    → 只认 vaultPath/syncImages/themeColor/uiLocale/templates（handleSetSettings）
 *   /api/probe   → { ok, configured, ... }                        （handleCloudProbe）
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as settings from '../src/core/settings.js'
import { startLocalServer } from '../src/host/server.js'

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const tmp = await mkdtemp(join(tmpdir(), 'getnote-smoke-'))
const vaultBase = join(tmp, 'vault')
const dataDir = join(tmp, 'data')
await mkdir(vaultBase, { recursive: true })
await mkdir(dataDir, { recursive: true })

settings.configure({ dataDir, vaultBase, subfolder: '得到大脑' })
const root = await settings.setVaultRoot('得到大脑')

const server = await startLocalServer({ preferredPort: 0 })
const base = server.origin
console.log('server:', base)
console.log('vault :', root)

// 本地服务有两道门：令牌（挡住拿不到令牌的本机网页）+ 来源（挡住令牌从 ?t=
// 泄露出去之后的滥用）。这里走的是面板那条路，所以照面板的方式带令牌；来源头
// 在真宿主里由 Electron 自动带，node 的 fetch 不会，得手动补。
const authHeaders = { 'x-getnote-token': server.token, 'sec-fetch-site': 'same-origin' }

async function api(path, init) {
  const options = { ...(init || {}) }
  options.headers = { ...authHeaders, ...(options.headers || {}) }
  const res = await fetch(base + '/getnote' + path, options)
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: res.status, json, text }
}

const post = (path, body) =>
  api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

try {
  // 1. 状态：空库也要能返回，而不是报错
  const status = await api('/status')
  check(
    'GET /status',
    status.status === 200 && status.json && typeof status.json.vaultRoot === 'string',
    `HTTP ${status.status}, notes=${status.json && status.json.notes}`,
  )

  // 2. 新建笔记（面板「新建」按钮走 POST /create）
  const created = await post('/create', { dir: '', title: '冒烟测试笔记', content: '# 冒烟\n\n正文内容。\n' })
  check('POST /create', created.status === 200 && created.json && created.json.ok === true, `HTTP ${created.status}`)
  const rel = created.json && typeof created.json.path === 'string' ? created.json.path : ''
  check('create 返回了路径', rel !== '', String(rel))

  // 3. 读回来
  const read = await api('/read?path=' + encodeURIComponent(rel))
  check(
    'GET /read',
    read.status === 200 && read.json && String(read.json.content || '').includes('冒烟'),
    `HTTP ${read.status}`,
  )

  // 4. 覆盖保存（面板编辑器保存走 POST /save，必须带 path）
  const saved = await post('/save', { path: rel, content: '# 冒烟\n\n改过的正文。\n' })
  check('POST /save', saved.status === 200 && saved.json && saved.json.ok === true, `HTTP ${saved.status}`)
  const reread = await api('/read?path=' + encodeURIComponent(rel))
  check(
    'save 之后内容真的变了',
    reread.status === 200 && String(reread.json.content || '').includes('改过的正文'),
    `HTTP ${reread.status}`,
  )

  // 5. 目录树
  const tree = await api('/tree')
  check(
    'GET /tree',
    tree.status === 200 && tree.json && tree.json.tree && typeof tree.json.tree === 'object',
    `HTTP ${tree.status}, count=${tree.json && tree.json.tree && tree.json.tree.count}`,
  )

  // 6. 搜索
  const search = await api('/search?q=' + encodeURIComponent('改过的正文'))
  const hits = (search.json && search.json.hits) || []
  check('GET /search', search.status === 200 && hits.length > 0, `HTTP ${search.status}, ${hits.length} 条`)

  // 7. 设置读写（/settings 只认这几个键）
  const set = await post('/settings', { uiLocale: 'zh', syncImages: true })
  check(
    'POST /settings',
    set.status === 200 && set.json && set.json.ok === true && set.json.uiLocale === 'zh' && set.json.syncImages === true,
    `HTTP ${set.status}`,
  )

  // 8. 附件直出（本地 asset）。面板只对白名单扩展名发这个请求。
  await mkdir(join(root, 'asset'), { recursive: true })
  const assetAbs = join(root, 'asset', 'smoke.md')
  await writeFile(assetAbs, 'hello-asset', 'utf8')
  const asset = await fetch(base + '/getnote/asset?path=' + encodeURIComponent(assetAbs), {
    headers: authHeaders,
  })
  const assetText = await asset.text()
  check('GET /asset', asset.status === 200 && assetText === 'hello-asset', `HTTP ${asset.status}`)

  // 9. 越界路径必须被挡住（adapter 只能碰库内文件）。
  // 令牌和来源都带对了，所以这条只能靠路径校验本身挡住：必须是 400，
  // 不能是 401/403（那样等于这道校验根本没被测到）。
  const escape = await fetch(base + '/getnote/asset?path=' + encodeURIComponent('C:/Windows/win.ini'), {
    headers: authHeaders,
  })
  check('GET /asset 越界被拒', escape.status === 400, `HTTP ${escape.status}`)

  // 10. 云端探活：没配凭证时要回「未配置」，而不是 500 或抛异常
  const probe = await api('/api/probe')
  check(
    'GET /api/probe',
    probe.status === 200 && probe.json && probe.json.configured === false,
    `HTTP ${probe.status}, ${JSON.stringify(probe.json).slice(0, 80)}`,
  )

  // 11. 录音卡环境探测：本机有没有 python/bleak 都要能返回结构化结果
  const cardEnv = await api('/card/env')
  check(
    'GET /card/env',
    cardEnv.status === 200 && cardEnv.json && typeof cardEnv.json.ready === 'boolean',
    `HTTP ${cardEnv.status}, ready=${cardEnv.json && cardEnv.json.ready}`,
  )
} finally {
  await server.close()
  await rm(tmp, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) {
  console.log('FAILED:', failed.map((f) => f.name).join(', '))
  process.exitCode = 1
}
