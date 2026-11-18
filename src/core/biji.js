/**
 * dsh-getnote — 得到大脑（Get笔记）云端客户端（host 侧）
 *
 * 这一层是**可选的一次性通道**，不是插件的主体。它只在用户主动点「登录并导入」
 * 时被唤醒，做三件事：
 *   1. 走标准 MCP OAuth（动态注册 + PKCE S256）拿一个访问令牌；
 *   2. 连上 https://openapi.biji.com/mcp，把笔记全量读下来；
 *   3. 交给 sync.js 落成本地 Markdown。
 *
 * 之后无论会员是否续费、云端是否可达，本地库都完整可用——这正是用户要的
 * 「不用会员相关的绑定，找个比较本地的方式」。
 *
 * 令牌与 client 注册信息保存在 $DSH_HOME/dsh-getnote/auth.json（0600），
 * 不写进浏览器、不进 localStorage；退出登录即清空。
 */
import { createHash, randomBytes } from 'node:crypto'
import { netFetch } from './net.js'

const ISSUER = 'https://openapi.biji.com'
const MCP_URL = `${ISSUER}/mcp`
const SCOPES = [
  'note.content.read',
  'note.recall.read',
  'note.tag.read',
  'note.topic.read',
  'note.topic.recall.read',
  'topic.read',
].join(' ')

const REQUEST_TIMEOUT = 45_000

/** 统一的远端错误：把 HTTP 状态与响应体前缀带出来，方便面板直接显示。 */
function remoteError(what, status, body) {
  const snippet = String(body || '').replace(/\s+/g, ' ').slice(0, 300)
  const error = new Error(`${what} 失败（HTTP ${status}）${snippet ? `：${snippet}` : ''}`)
  error.status = status
  return error
}

async function httpJson(url, init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init.timeout || REQUEST_TIMEOUT)
  try {
    const res = await netFetch(url, { ...init, signal: controller.signal })
    const text = await res.text()
    return { res, text }
  } finally {
    clearTimeout(timer)
  }
}

// ── OAuth ────────────────────────────────────────────────────────────────────

/** PKCE：S256 challenge。verifier 用 base64url(32 字节随机)，长度落在规范区间内。 */
export function createPkce() {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

/**
 * 动态客户端注册（RFC 7591）。服务端会按本机回调地址登记一个 client_id。
 * 注册是无害的幂等动作，但每次都注册会在服务端留下废弃 client，所以调用方
 * 应该先复用 auth.json 里已有的 clientId。
 */
export async function registerClient(redirectUri) {
  const payload = {
    client_name: 'DSH 得到大脑面板',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: SCOPES,
  }
  const { res, text } = await httpJson(`${ISSUER}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw remoteError('客户端注册', res.status, text)
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw remoteError('客户端注册', res.status, text)
  }
  if (!data || typeof data.client_id !== 'string') {
    throw new Error('客户端注册响应缺少 client_id')
  }
  return { clientId: data.client_id, clientSecret: typeof data.client_secret === 'string' ? data.client_secret : null }
}

/** 拼授权 URL（PKCE S256，无 client secret）。 */
export function buildAuthorizeUrl({ clientId, redirectUri, state, challenge }) {
  const url = new URL(`${ISSUER}/oauth/authorize`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('resource', MCP_URL)
  return url.toString()
}

/** 授权码换令牌。 */
export async function exchangeCode({ clientId, code, redirectUri, verifier }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  })
  const { res, text } = await httpJson(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  })
  if (!res.ok) throw remoteError('换取访问令牌', res.status, text)
  return normalizeTokenResponse(JSON.parse(text), clientId, redirectUri)
}

/** 用 refresh_token 续期。 */
export async function refreshToken({ clientId, refreshToken: rt }) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: rt,
    client_id: clientId,
  })
  const { res, text } = await httpJson(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  })
  if (!res.ok) throw remoteError('刷新访问令牌', res.status, text)
  return normalizeTokenResponse(JSON.parse(text), clientId, null)
}

function normalizeTokenResponse(data, clientId, redirectUri) {
  const accessToken = data && typeof data.access_token === 'string' ? data.access_token : null
  if (!accessToken) throw new Error('令牌响应缺少 access_token')
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
  return {
    accessToken,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
    expiresAt: Date.now() + expiresIn * 1000,
    clientId,
    redirectUri: redirectUri || null,
    obtainedAt: new Date().toISOString(),
  }
}

/** 撤销令牌（尽力而为：服务端不支持时静默忽略，本地凭证照删）。 */
export async function revokeToken(token) {
  try {
    await httpJson(`${ISSUER}/oauth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, token_type_hint: 'access_token' }).toString(),
      timeout: 10_000,
    })
  } catch {
    // 撤销失败不影响本地退出登录
  }
}

// ── MCP（streamable HTTP transport）──────────────────────────────────────────

/**
 * 一个会话内的 MCP 客户端。
 *
 * streamable HTTP 的两种响应形态都要认：普通 JSON，以及 `text/event-stream`
 * （服务端在长任务里会回 SSE，只读最后一个 data 帧的 JSON-RPC 响应）。
 */
export class McpClient {
  constructor(accessToken, { url = MCP_URL } = {}) {
    this.url = url
    this.accessToken = accessToken
    this.sessionId = null
    this.nextId = 1
    this.protocolVersion = '2025-06-18'
    this.serverInfo = null
  }

  headers() {
    const h = {
      authorization: `Bearer ${this.accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    }
    if (this.sessionId) h['mcp-session-id'] = this.sessionId
    return h
  }

  async post(payload) {
    const { res, text } = await httpJson(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
      timeout: 120_000,
    })
    const session = res.headers.get('mcp-session-id')
    if (session) this.sessionId = session
    if (!res.ok) throw remoteError(`MCP ${payload.method || 'request'}`, res.status, text)
    return { res, text }
  }

  /** 把一次响应体解析成 JSON-RPC 结果（兼容 SSE）。 */
  parseBody(text, contentType) {
    const raw = String(text || '').trim()
    if (raw === '') return null
    if (String(contentType || '').includes('text/event-stream')) {
      // 取最后一个带 "data:" 的帧里的 JSON-RPC 消息
      const chunks = raw.split(/\r?\n\r?\n/)
      let found = null
      for (const chunk of chunks) {
        const dataLines = chunk
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
        if (dataLines.length === 0) continue
        try {
          const message = JSON.parse(dataLines.join('\n'))
          if (message && (message.result !== undefined || message.error !== undefined)) found = message
        } catch {
          // 非 JSON 的 data 帧（心跳等）忽略
        }
      }
      return found
    }
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  async initialize() {
    const id = this.nextId++
    const { res, text } = await this.post({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: {
        protocolVersion: this.protocolVersion,
        capabilities: {},
        clientInfo: { name: 'dsh-getnote', version: '0.1.0' },
      },
    })
    const message = this.parseBody(text, res.headers.get('content-type'))
    if (!message || message.error) {
      throw new Error(`MCP initialize 失败：${message && message.error ? JSON.stringify(message.error).slice(0, 200) : '无有效响应'}`)
    }
    this.serverInfo = message.result && message.result.serverInfo ? message.result.serverInfo : null
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    return this.serverInfo
  }

  async listTools() {
    const id = this.nextId++
    const { res, text } = await this.post({ jsonrpc: '2.0', id, method: 'tools/list', params: {} })
    const message = this.parseBody(text, res.headers.get('content-type'))
    if (!message || message.error) throw new Error('MCP tools/list 失败')
    return (message.result && message.result.tools) || []
  }

  /**
   * 调一个工具。
   *
   * 得到大脑的工具把结构化结果放在 `content[0].text` 里（是 JSON 字符串），
   * 这里统一解开；解不开就把原文当字符串返回，绝不让「格式不认识」变成数据丢失。
   */
  async callTool(name, args = {}) {
    const id = this.nextId++
    const { res, text } = await this.post({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    })
    const message = this.parseBody(text, res.headers.get('content-type'))
    if (!message) throw new Error(`MCP ${name} 无有效响应`)
    if (message.error) {
      const err = new Error(`MCP ${name} 错误：${message.error.message || JSON.stringify(message.error)}`)
      err.mcpError = message.error
      throw err
    }
    const result = message.result || {}
    const parts = Array.isArray(result.content) ? result.content : []
    const textPart = parts.find((p) => p && p.type === 'text' && typeof p.text === 'string')
    if (!textPart) return result.structuredContent ?? result
    const raw = textPart.text
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
}

export { ISSUER, MCP_URL, SCOPES }
