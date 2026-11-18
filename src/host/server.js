/**
 * host/server.js —— 本地回环服务
 *
 * DSH 版把 /getnote 挂在宿主自带的 webServer 上；Obsidian 没有那个宿主服务，
 * 所以这里自己起一个**只监听 127.0.0.1** 的 http 服务，把 service.js 的
 * handler 直接当 requestListener 用。
 *
 * 为什么不走 Electron 主进程 IPC / 自定义 protocol：
 *   - 面板里的 <img src="/getnote/asset?..."> 和 <audio src="/getnote/audio?...">
 *     是浏览器原生资源加载，IPC 和 protocol 都接不住这种写法，而 http 天生就接得住；
 *   - OAuth 回调需要系统浏览器能直接访问一个 http 地址，回环端口正好；
 *   - service.js 里 100+ 个 handler 的契约（req/res）一行都不用改。
 *
 * 只绑 127.0.0.1 不绑 0.0.0.0：局域网里别的机器不该能读你的笔记库。
 *
 * 关于令牌（token）：
 *   CORS 头是 `*`，因为渲染进程的源是 `app://obsidian.md`，我们没法预知它。
 *   但 `*` 意味着**任何**本机网页都能 fetch 这个端口——浏览器里随便一个
 *   evil 页面就能读走整个笔记库。所以每个请求必须带一个每次启动随机生成的
 *   令牌：普通接口走 `x-getnote-token` 头；`<img>`/`<audio>` 这种没法加头的
 *   资源请求走 `?t=` 查询参数（令牌只在回环地址上暴露，且每次启动都换）。
 *   OAuth 回调是系统浏览器整页跳过来的，带不了头，那条路径单独放行。
 */

import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { createRouter } from '../core/service.js'

const HOST = '127.0.0.1'
const FALLBACK_PORTS = 12
/** 放行名单：系统浏览器整页跳转过来的 OAuth 回调带不了自定义头。 */
const TOKEN_EXEMPT = new Set(['oauth'])

/**
 * 渲染进程的源是 `app://obsidian.md`，对本机 http 端口发 fetch 属于跨源，
 * 必须回 CORS 头，否则面板里每个 api() 都会失败在浏览器层。
 * 只允许无凭证的简单请求（不带 cookie），真正的门禁是令牌，不是 CORS。
 */
function applyCors(res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader(
    'access-control-allow-headers',
    'content-type, range, x-getnote-import-mode, x-getnote-token',
  )
  res.setHeader(
    'access-control-expose-headers',
    'content-type, content-length, content-range, accept-ranges',
  )
  res.setHeader('access-control-max-age', '600')
  // Chromium 的 Private Network Access：从 app://obsidian.md 这类非公网源访问
  // 127.0.0.1 时，预检会多带一个 access-control-request-private-network，
  // 不回这个头浏览器会直接拦掉请求（面板里表现为所有接口 CORS 失败）。
  res.setHeader('access-control-allow-private-network', 'true')
}

/**
 * 从请求里取令牌。头优先，其次是 `?t=`（给 img/audio 用）。
 *
 * 用 `timingSafeEqual` 之外的朴素比较是可以接受的：令牌每次启动随机生成、
 * 只在本机回环端口上，攻击者拿不到大量样本做时序分析；但长度不等要直接拒，
 * 免得比较函数抛错。
 */
function tokenOf(req, url) {
  const header = req.headers['x-getnote-token']
  if (typeof header === 'string' && header !== '') return header
  const fromQuery = url.searchParams.get('t')
  return typeof fromQuery === 'string' ? fromQuery : ''
}

function listenOn(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, HOST)
  })
}

/**
 * 起服务。`preferredPort` 优先（端口稳定 → OAuth 的 redirect_uri 稳定），
 * 被占用时退回系统分配的空闲端口。
 *
 * 返回值里带 `token` 与 `portFallback`：
 *   - token 由 main.js 注入给面板，面板每个请求都要带；
 *   - portFallback 为真说明用户设想的端口没抢到，值得提示一句（OAuth 的
 *     redirect_uri 会变，服务端按 redirect_uri 注册的 client 可能要重注册）。
 */
export async function startLocalServer({ vaultPath = '', preferredPort = 0, token = '' } = {}) {
  let origin = ''
  const handler = createRouter({ vaultPath, getOrigin: () => origin })
  const secret = typeof token === 'string' && token !== '' ? token : randomBytes(24).toString('hex')

  const server = createServer((req, res) => {
    applyCors(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    let url
    try {
      url = new URL(req.url || '/', 'http://127.0.0.1')
    } catch {
      url = new URL('http://127.0.0.1/')
    }
    // 路径第一段是 ROUTE_PREFIX（/getnote），第二段才是 action
    const parts = url.pathname.split('/').filter(Boolean)
    const action = parts[1] || 'status'
    if (!TOKEN_EXEMPT.has(action) && tokenOf(req, url) !== secret) {
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'unauthorized', hint: '请求缺少或带错了本机服务令牌' }))
      return
    }
    Promise.resolve(handler(req, res)).catch((error) => {
      // handler 内部已经把业务错误变成 JSON 了，走到这里说明是没兜住的异常。
      // 必须给客户端一个响应，否则面板会一直挂在 pending 上。
      const message = error && error.message ? error.message : String(error)
      try {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: message }))
        } else {
          res.end()
        }
      } catch {
        // 连接已经断了，没什么可做的
      }
    })
  })

  const candidates = []
  const wanted = Number.isInteger(preferredPort) && preferredPort > 0 && preferredPort < 65536
  if (wanted) candidates.push(preferredPort)
  candidates.push(0)

  let lastError = null
  let usedFallback = false
  for (const port of candidates) {
    try {
      await listenOn(server, port)
      usedFallback = wanted && port === 0
      lastError = null
      break
    } catch (error) {
      lastError = error
      if (port === 0) throw error
    }
  }
  if (lastError) throw lastError

  const address = server.address()
  const actualPort = address && typeof address === 'object' ? address.port : 0
  origin = `http://${HOST}:${actualPort}`

  return {
    origin,
    port: actualPort,
    token: secret,
    portFallback: usedFallback,
    /** 停止监听，插件 unload 时调。 */
    close() {
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

export { HOST as SERVER_HOST, FALLBACK_PORTS, TOKEN_EXEMPT }
