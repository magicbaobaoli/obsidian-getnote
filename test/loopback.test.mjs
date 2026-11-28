/**
 * loopback.test.mjs —— 本地回环服务的两道门
 *
 * server.js 上挂着两层校验：
 *   1. 令牌（每次启动随机生成）：挡住「本机任意网页都能 fetch 这个端口」；
 *   2. 来源：挡住「令牌从 ?t= 泄露出去之后被别处拿去用」。
 *
 * 这一层单独测，是因为 boot.test.mjs 里的 fetch 被统一补了来源头——那里测的是
 * 「面板打得通」，而这里测的是「不是面板就该被挡住」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { startLocalServer, TOKEN_EXEMPT } from '../src/host/server.js'

const server = await startLocalServer({ preferredPort: 0 })
const base = server.origin
const rawFetch = globalThis.fetch

const get = (path, headers = {}) => rawFetch(base + path, { headers })
const token = { 'x-getnote-token': server.token }

test('放行名单只有 OAuth 回调一条', () => {
  // 每多一条就多一条「外部网页能直接打进来」的路，所以这里钉死数量。
  assert.equal(TOKEN_EXEMPT.size, 1)
  assert.ok(TOKEN_EXEMPT.has('oauth'))
})

test('没有令牌：401', async () => {
  const res = await get('/getnote/status')
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.equal(body.error, 'unauthorized')
})

test('令牌错了：401，不能因为带了头就放行', async () => {
  const res = await get('/getnote/status', { 'x-getnote-token': 'nope' })
  assert.equal(res.status, 401)
})

test('令牌对、来源不对：403', async () => {
  const res = await get('/getnote/status', token)
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.equal(body.error, 'forbidden')
})

test('来源是外部网页：403，即使令牌是对的', async () => {
  const res = await get('/getnote/status', {
    ...token,
    origin: 'https://evil.example',
    referer: 'https://evil.example/x',
    'sec-fetch-site': 'cross-site',
  })
  assert.equal(res.status, 403)
})

test('Origin 是 app://obsidian.md：放行', async () => {
  const res = await get('/getnote/status', { ...token, origin: 'app://obsidian.md' })
  assert.equal(res.status, 200)
})

test('Referer 是 app://obsidian.md：放行', async () => {
  const res = await get('/getnote/status', { ...token, referer: 'app://obsidian.md/index.html' })
  assert.equal(res.status, 200)
})

test('sec-fetch-site 是 same-origin：放行', async () => {
  const res = await get('/getnote/status', { ...token, 'sec-fetch-site': 'same-origin' })
  assert.equal(res.status, 200)
})

test('sec-fetch-site 是 none（用户直接打开）：放行', async () => {
  const res = await get('/getnote/status', { ...token, 'sec-fetch-site': 'none' })
  assert.equal(res.status, 200)
})

test('进程内请求带内部标记：放行，且错的值不放行', async () => {
  const ok = await get('/getnote/status', { ...token, 'x-getnote-internal': server.internalKey })
  assert.equal(ok.status, 200)
  const bad = await get('/getnote/status', { ...token, 'x-getnote-internal': 'guess' })
  assert.equal(bad.status, 403)
})

test('浏览器原生资源加载（img/audio）不按来源拦，只认令牌', async () => {
  // 这两条路径浏览器带不了自定义头也不带 Origin，只能靠 ?t=；若按来源拦，
  // 面板里所有图片和录音都会裂。没有令牌时仍然是 401。
  const asset = await rawFetch(base + '/getnote/asset?path=' + encodeURIComponent('nope.png') + '&t=' + encodeURIComponent(server.token))
  assert.notEqual(asset.status, 403, 'asset 不该被来源门挡住')
  assert.notEqual(asset.status, 401, '带对了令牌就不该是 401')
  const naked = await rawFetch(base + '/getnote/asset?path=nope.png')
  assert.equal(naked.status, 401, '没有令牌仍然是 401')
})

test('OAuth 回调两道门都免：系统浏览器整页跳过来带不了令牌和来源', async () => {
  const res = await get('/getnote/oauth/callback?code=x&state=y')
  assert.notEqual(res.status, 401, 'OAuth 回调不该被令牌门挡住')
  assert.notEqual(res.status, 403, 'OAuth 回调不该被来源门挡住')
})

test('预检 OPTIONS 不经过两道门', async () => {
  const res = await rawFetch(base + '/getnote/status', {
    method: 'OPTIONS',
    headers: { origin: 'app://obsidian.md', 'access-control-request-private-network': 'true' },
  })
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
})

test('收尾：关掉服务', async () => {
  await server.close()
})
