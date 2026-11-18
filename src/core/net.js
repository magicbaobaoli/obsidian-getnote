/**
 * net.js —— 出网请求（fetch 兼容的最小实现）
 *
 * 为什么要自己写一个：Obsidian 插件跑在渲染进程里，直接用 window.fetch 访问
 * https://openapi.biji.com 会被 CORS 拦住（服务端不认 app://obsidian.md 这个源），
 * 而且 fetch 也不允许设置 Referer —— 而音频代理恰恰需要它。
 *
 * 插件进程里有完整的 Node，所以这里直接用 node:https 发请求：没有 CORS、
 * 头可以随便设、也不需要主进程配合。对外暴露成 fetch 的形状，让 biji.js /
 * openapi.js / service.js 里的调用点一行都不用改。
 */

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

const MAX_REDIRECTS = 5

function headerBag(raw) {
  const store = new Map()
  for (const [key, value] of Object.entries(raw || {})) {
    if (value === undefined || value === null) continue
    store.set(key.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value))
  }
  return {
    get(name) {
      const found = store.get(String(name).toLowerCase())
      return found === undefined ? null : found
    },
    has(name) {
      return store.has(String(name).toLowerCase())
    },
    forEach(fn) {
      for (const [key, value] of store) fn(value, key)
    },
  }
}

function makeResponse(status, rawHeaders, buffer) {
  const headers = headerBag(rawHeaders)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers,
    // service.js 里用 `if (!upstream.body) return res.end()` 判断有没有响应体；
    // 这里整块读完了才返回，所以只要状态码不是 204/304 就给一个真值占位。
    body: status === 204 || status === 304 ? null : {},
    async text() {
      return buffer.toString('utf8')
    },
    async json() {
      return JSON.parse(buffer.toString('utf8'))
    },
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    },
  }
}

function bodyToBuffer(body) {
  if (body === undefined || body === null) return null
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  if (Buffer.isBuffer(body)) return body
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  return Buffer.from(String(body), 'utf8')
}

function once(url, init, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let target
    try {
      target = new URL(url)
    } catch {
      reject(Object.assign(new Error(`无效的地址：${url}`), { status: 400 }))
      return
    }
    const isHttps = target.protocol === 'https:'
    const send = isHttps ? httpsRequest : httpRequest

    const headers = {}
    for (const [key, value] of Object.entries(init.headers || {})) {
      if (value === undefined || value === null) continue
      headers[key] = String(value)
    }
    const payload = bodyToBuffer(init.body)
    if (payload !== null && headers['content-length'] === undefined) {
      headers['content-length'] = String(payload.length)
    }

    const req = send(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: (init.method || 'GET').toUpperCase(),
        headers,
      },
      (res) => {
        const status = res.statusCode || 0
        const location = res.headers.location
        const follow = init.redirect === 'follow' || init.redirect === undefined
        if (follow && status >= 300 && status < 400 && location && redirectsLeft > 0) {
          // 把响应体读干净再发下一跳，否则连接不会释放
          res.resume()
          const next = new URL(location, target).toString()
          resolve(once(next, init, redirectsLeft - 1))
          return
        }
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve(makeResponse(status, res.headers, Buffer.concat(chunks))))
        res.on('error', reject)
      },
    )

    req.on('error', (cause) => {
      const error = new Error(`连不上 ${target.hostname}（${cause && cause.message ? cause.message : '网络错误'}）`)
      error.status = 502
      error.cause = cause
      reject(error)
    })

    const signal = init.signal
    if (signal) {
      if (signal.aborted) {
        req.destroy(new Error('aborted'))
        return
      }
      signal.addEventListener('abort', () => {
        req.destroy(Object.assign(new Error('请求超时'), { name: 'TimeoutError' }))
      })
    }

    if (payload !== null) req.write(payload)
    req.end()
  })
}

/** fetch 兼容入口：biji.js / openapi.js / service.js 都用它出网。 */
export async function netFetch(url, init = {}) {
  return once(url, init, MAX_REDIRECTS)
}

export default netFetch
