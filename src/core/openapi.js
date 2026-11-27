/**
 * dsh-getnote — 得到大脑官方 Open API 客户端
 *
 * 为什么走 Open API 而不是 OAuth/MCP：
 *   · 官方 Open API（`https://openapi.biji.com/open/api/v1`）是给「个人开发者」的
 *     长期通道，用 API Key + Client ID 两个请求头鉴权，不需要浏览器回跳、不怕 token
 *     一小时过期、不需要代理进程。MCP 那条路（mcp-remote + OAuth）每次授权都要新
 *     建 client、refresh token 还会因为 replay 失效，不适合当底座。
 *   · 能力也比 MCP 全：录音笔记 `audio.play_url`（可直接播放的音频地址）与
 *     `audio.original`（逐字稿）、时间线 moments、待办、分享链接、知识库目录树。
 *
 * 鉴权（个人开发，只操作本人账号）：
 *   Authorization: <gk_live_xxx>      ← 自己的 API Key，无 Bearer 前缀
 *   X-Client-ID:   <cli_xxx>          ← 应用 Client ID
 *
 * 企业代授权在此之上再加 `X-Grant-ID: grt_xxx`。本插件两种都支持：设置里填了
 * grantId 就带上，没填就是个人开发模式。
 *
 * 边界（写在最前面，改代码前先读）：
 *   1. **64 位整数不要用 Number 装**。note_id / next_cursor 都是雪花 ID，JSON.parse
 *      会丢精度。这里统一用 JSON.parse 的 reviver 把整型字段转成字符串（见 parse）。
 *   2. **配额**：读 1000/天、写 200/天（会员账号）。自动同步必须做增量，不能每次
 *      全量拉。
 *   3. **fail-closed**：录音卡接口对非白名单笔记一律 403，不要当普通笔记兜底。
 *   4. 本模块**只做网络与数据整形**，不碰磁盘、不读设置——设置由 settings.js 管，
 *      落盘由 vault.js 管，编排由 cloud-sync.js 管。
 */
import { createHash, randomBytes } from 'node:crypto'

export const API_BASE = 'https://openapi.biji.com/open/api/v1'

/** 官方文档定义的错误码 → 中文可操作建议。 */
const ERROR_HINTS = {
  quota_day: '今天的读/写配额用完了，明天恢复（或升级会员）。本地库不受影响。',
  quota_month: '这个月的配额用完了，下个月恢复（或升级会员）。本地库不受影响。',
  rate_limit: '请求太频繁，稍等几秒再试。',
  invalid_api_key: 'API Key 不对，去得到大脑控制台重新生成一个。',
  grant_expired: '授权已过期，需要重新授权。',
  grant_not_valid: '授权已被撤销，需要重新授权。',
}

/** 把服务端错误整形成一句人话 + 可判定的 code/reason。 */
function toError(status, payload, what) {
  const err = payload && typeof payload === 'object' && payload.error ? payload.error : {}
  const reason = typeof err.reason === 'string' ? err.reason : ''
  const message = typeof err.message === 'string' && err.message !== '' ? err.message : ''
  const hint = ERROR_HINTS[reason] || ''
  const parts = [`${what}失败`]
  if (message) parts.push(message)
  if (status) parts.push(`HTTP ${status}`)
  if (hint) parts.push(hint)
  const e = /** @type {Error & {status?: number, code?: number|null, reason?: string|null, requestId?: string|null, partial?: object}} */ (
    new Error(parts.join('：').replace(/(：)+/g, '：'))
  )
  e.status = status || 502
  e.code = typeof err.code === 'number' ? err.code : null
  e.reason = reason || null
  e.requestId = payload && typeof payload === 'object' ? payload.request_id || null : null
  e.partial = payload
  return e
}

/**
 * 解析响应正文。
 *
 * 雪花 ID 全是 19 位十进制，超出 Number.MAX_SAFE_INTEGER（9007199254740991）。
 * 用一个 reviver 把「看起来像 ID 的键」的数值统一转成字符串，避免 note_id 变成
 * 1901297236063695800 这种静默错位——那种错位不会有任何异常，只会让后续请求
 * 404 或写到别人的笔记上。
 */
const ID_KEY = /(^|_)(id|ids|cursor)$/i
function reviver(key, value) {
  if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
    return String(value)
  }
  if (typeof value === 'number' && ID_KEY.test(key) && Math.abs(value) > 1e15) {
    return String(value)
  }
  return value
}

function parseJson(text) {
  try {
    return JSON.parse(text, reviver)
  } catch {
    return null
  }
}

/**
 * 从响应里取 data。
 *
 * 官方统一包 `{ success, data, error, meta, request_id }`。`success: false` 时即使
 * HTTP 200 也是失败（配额类错误就是这么回来的），必须判 success 而不是 status。
 */
function unwrap(payload, status, what) {
  if (!payload || typeof payload !== 'object') {
    throw toError(status, null, what)
  }
  if (payload.success === false) {
    throw toError(status, payload, what)
  }
  return payload.data
}

export class OpenApiError extends Error {}

/**
 * 得到大脑 Open API 客户端。
 *
 * 只依赖注入进来的 fetch ——这样测试里能塞一个假的，不打真网络。
 *
 * @param {object} [options]
 * @param {string} [options.apiKey]     个人 API Key（gk_live_xxx）
 * @param {string} [options.clientId]   应用 Client ID（cli_xxx）
 * @param {string} [options.grantId]    企业代授权的 Grant ID，可省
 * @param {string} [options.baseUrl]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 */
export function createClient({ apiKey, clientId, grantId, baseUrl = API_BASE, fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {}) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw Object.assign(new Error('还没有 API Key：去得到大脑控制台「API Key」页创建一个（形如 gk_live_xxx），粘到面板的「设置 → 云端接入」里。'), { status: 401 })
  }
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    throw Object.assign(new Error('还没有 Client ID：去得到大脑控制台「应用管理」页创建个人开发应用，复制 Client ID（形如 cli_xxx）。'), { status: 401 })
  }
  if (typeof fetchImpl !== 'function') {
    throw Object.assign(new Error('运行环境没有 fetch，无法访问得到大脑云端'), { status: 500 })
  }

  const headers = {
    Authorization: apiKey.trim(),
    'X-Client-ID': clientId.trim(),
    Accept: 'application/json',
  }
  if (typeof grantId === 'string' && grantId.trim() !== '') {
    headers['X-Grant-ID'] = grantId.trim()
  }

  /**
   * 发一个请求。
   *
   * 注意：官方错误里 `401` 和 `success:false` 都可能出现，两者都要转成人话错误，
   * 否则前端只能显示「HTTP 401」这种对用户没用的东西。
   *
   * @param {string} method
   * @param {string} path
   * @param {object} [options]
   * @param {object} [options.query]
   * @param {object} [options.body]
   */
  async function request(method, path, { query, body } = {}) {
    let url = `${baseUrl.replace(/\/+$/, '')}${path}`
    if (query && Object.keys(query).length > 0) {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue
        qs.set(k, String(v))
      }
      const s = qs.toString()
      if (s) url += `?${s}`
    }
    const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(timeoutMs) }
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    let res
    try {
      res = await fetchImpl(url, init)
    } catch (cause) {
      const e = /** @type {Error & {status?: number}} */ (
        new Error(`连不上得到大脑（${cause && cause.name === 'TimeoutError' ? '请求超时' : (cause && cause.message) || '网络错误'}）。检查网络或代理。`)
      )
      e.status = 502
      throw e
    }
    const text = await res.text().catch(() => '')
    const payload = parseJson(text)
    if (!res.ok) throw toError(res.status, payload, path)
    return unwrap(payload, res.status, path)
  }

  const get = (path, query) => request('GET', path, { query })
  const post = (path, body) => request('POST', path, { body })

  // ── 笔记 ──────────────────────────────────────────────────────────────────

  /**
   * 笔记列表（游标分页）。
   *
   * 首次不传 cursor，之后传上一页的 cursor，直到 has_more 为 false。
   * 不用 since_id：官方已标注「不推荐，请改用 cursor」。
   *
   * @param {object} [options]
   * @param {string} [options.cursor]
   * @param {number} [options.limit]
   */
  async function listNotes({ cursor, limit } = {}) {
    const data = await get('/resource/note/list', { cursor, limit })
    return {
      notes: Array.isArray(data?.notes) ? data.notes : [],
      hasMore: data?.has_more === true,
      cursor: data?.cursor ?? data?.next_cursor ?? null,
      total: typeof data?.total === 'number' ? data.total : null,
    }
  }

  /** 笔记详情。含 audio / timeline / attachments / meeting_todos 等完整字段。 */
  async function getNote(noteId) {
    const data = await get('/resource/note/detail', { id: String(noteId) })
    return data?.note ?? null
  }

  /**
   * 录音卡笔记列表（需 note.recorder.read + X-Grant-ID）。
   *
   * @param {object} [options]
   * @param {number} [options.sinceId]
   * @param {number} [options.limit]
   */
  async function listRecorderNotes({ sinceId = 0, limit = 20 } = {}) {
    const data = await get('/resource/note/recorder/list', { since_id: sinceId, limit })
    return {
      notes: Array.isArray(data?.notes) ? data.notes : [],
      hasMore: data?.has_more === true,
      nextCursor: data?.next_cursor ?? null,
      total: typeof data?.total === 'number' ? data.total : null,
    }
  }

  /** 录音卡笔记详情（含 audio.play_url / audio.original）。 */
  async function getRecorderNote(noteId) {
    const data = await get('/resource/note/recorder/detail', { id: String(noteId) })
    return data?.note ?? null
  }

  /**
   * 新建笔记。
   *
   * `clientRequestId` 是幂等键：重试同一个请求不会产生两条笔记。写操作一律带上，
   * 断网重试时尤其重要。
   *
   * @param {object} [options]
   * @param {string} [options.noteType]
   * @param {string} [options.title]
   * @param {string} [options.content]
   * @param {string} [options.linkUrl]
   * @param {string[]} [options.imageUrls]
   * @param {string[]} [options.tags]
   * @param {string} [options.topicId]
   * @param {string} [options.parentId]
   * @param {string} [options.clientRequestId]
   */
  async function createNote({ noteType = 'plain_text', title, content, linkUrl, imageUrls, tags, topicId, parentId, clientRequestId } = {}) {
    const body = { note_type: noteType }
    if (title !== undefined) body.title = title
    if (content !== undefined) body.content = content
    if (linkUrl !== undefined) body.link_url = linkUrl
    if (imageUrls !== undefined) body.image_urls = imageUrls
    if (tags !== undefined) body.tags = tags
    if (topicId !== undefined) body.topic_id = topicId
    if (parentId !== undefined) body.parent_id = String(parentId)
    body.client_request_id = clientRequestId || `dsh-${Date.now()}-${randomBytes(4).toString('hex')}`
    const data = await post('/resource/note/save', body)
    return {
      noteId: data?.note_id ?? null,
      tasks: Array.isArray(data?.tasks) ? data.tasks : [],
    }
  }

  /**
   * 更新笔记。title / content / tags 至少要给一个，且 tags 是完整替换。
   *
   * @param {object} [options]
   * @param {string} [options.noteId]
   * @param {string} [options.title]
   * @param {string} [options.content]
   * @param {string[]} [options.tags]
   */
  async function updateNote({ noteId, title, content, tags } = {}) {
    if (title === undefined && content === undefined && tags === undefined) {
      throw Object.assign(new Error('更新笔记至少要改标题、内容或标签之一'), { status: 400 })
    }
    const body = { note_id: String(noteId) }
    if (title !== undefined) body.title = title
    if (content !== undefined) body.content = content
    if (tags !== undefined) body.tags = tags
    await post('/resource/note/update', body)
    return true
  }

  /** 删除笔记（进回收站，可恢复）。 */
  async function deleteNote(noteId) {
    await post('/resource/note/delete', { note_id: String(noteId) })
    return true
  }

  /** 查询异步任务进度（创建链接/图片笔记会返回 task）。 */
  async function taskProgress(taskId) {
    return await post('/resource/note/task/progress', { task_id: String(taskId) })
  }

  // ── 标签 ──────────────────────────────────────────────────────────────────

  async function addTags(noteId, tags) {
    await post('/resource/note/tags/add', { note_id: String(noteId), tags: Array.isArray(tags) ? tags : [tags] })
    return true
  }

  async function deleteTag(noteId, tagId) {
    await post('/resource/note/tags/delete', { note_id: String(noteId), tag_id: String(tagId) })
    return true
  }

  // ── 知识库 ────────────────────────────────────────────────────────────────

  async function listTopics(page = 1) {
    const data = await get('/resource/knowledge/list', { page })
    const list = Array.isArray(data?.topics) ? data.topics : Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : []
    return {
      topics: list.map((t) => ({
        id: String(t?.topic_id ?? t?.id ?? ''),
        name: String(t?.name ?? t?.title ?? '未命名知识库'),
        type: t?.type ?? null,
      })).filter((t) => t.id !== ''),
      hasMore: data?.has_more === true,
      total: typeof data?.total === 'number' ? data.total : null,
    }
  }

  /**
   * 新建知识库。
   *
   * @param {object} [options]
   * @param {string} [options.name]
   * @param {string} [options.description]
   */
  async function createTopic({ name, description } = {}) {
    if (!name) throw Object.assign(new Error('知识库要有名字'), { status: 400 })
    const data = await post('/resource/knowledge/create', { name, description })
    return { id: String(data?.topic_id ?? data?.id ?? ''), name }
  }

  /**
   * 某知识库下的笔记（页码分页）。
   *
   * @param {object} [options]
   * @param {string} [options.topicId]
   * @param {number} [options.page]
   */
  async function listTopicNotes({ topicId, page = 1 } = {}) {
    const data = await get('/resource/knowledge/notes', { topic_id: topicId, page })
    return {
      notes: Array.isArray(data?.notes) ? data.notes : [],
      hasMore: data?.has_more === true,
      total: typeof data?.total === 'number' ? data.total : null,
    }
  }

  /**
   * 知识库目录树（逐层：传 directoryId 看下一层）。
   *
   * @param {object} [options]
   * @param {string} [options.topicId]
   * @param {string} [options.directoryId]
   */
  async function browseTopic({ topicId, directoryId } = {}) {
    const data = await get('/resource/knowledge/directories', { topic_id: topicId, directory_id: directoryId })
    return {
      directories: Array.isArray(data?.directories) ? data.directories : [],
      resources: Array.isArray(data?.resources) ? data.resources : [],
    }
  }

  /**
   * 把一批笔记加进知识库。
   *
   * @param {object} options
   * @param {string} options.topicId
   * @param {Array<string|number>} options.noteIds
   */
  async function addNotesToTopic({ topicId, noteIds }) {
    await post('/resource/knowledge/note/batch-add', { topic_id: topicId, note_ids: noteIds.map(String) })
    return true
  }

  /**
   * 把一批笔记从知识库移除。
   *
   * @param {object} options
   * @param {string} options.topicId
   * @param {Array<string|number>} options.noteIds
   */
  async function removeNotesFromTopic({ topicId, noteIds }) {
    await post('/resource/knowledge/note/remove', { topic_id: topicId, note_ids: noteIds.map(String) })
    return true
  }

  // ── 检索 ──────────────────────────────────────────────────────────────────

  /** 全局语义召回（不是关键词匹配，是向量检索）。 */
  async function recall(query, topK = 5) {
    const data = await post('/resource/recall', { query, top_k: Math.min(Math.max(topK, 1), 10) })
    const list = Array.isArray(data?.results) ? data.results : Array.isArray(data?.notes) ? data.notes : []
    return list
  }

  /**
   * 在某个知识库内做语义召回。
   *
   * @param {object} [options]
   * @param {string} [options.topicId]
   * @param {string} [options.query]
   * @param {number} [options.topK]
   */
  async function recallInTopic({ topicId, query, topK = 5 } = {}) {
    const data = await post('/resource/recall/knowledge', { topic_id: topicId, query, top_k: Math.min(Math.max(topK, 1), 10) })
    return Array.isArray(data?.results) ? data.results : Array.isArray(data?.notes) ? data.notes : []
  }

  // ── 分享 ──────────────────────────────────────────────────────────────────

  /**
   * 给一篇笔记建分享链接。
   *
   * @param {object} [options]
   * @param {string} [options.noteId]
   * @param {boolean} [options.excludeAudio]
   */
  async function createShareLink({ noteId, excludeAudio = false } = {}) {
    const data = await post('/resource/note/sharing', { note_id: String(noteId), share_exclude_audio: excludeAudio === true })
    return data?.share_url ?? data?.url ?? null
  }

  return {
    // 笔记
    listNotes,
    getNote,
    listRecorderNotes,
    getRecorderNote,
    createNote,
    updateNote,
    deleteNote,
    taskProgress,
    // 标签
    addTags,
    deleteTag,
    // 知识库
    listTopics,
    createTopic,
    listTopicNotes,
    browseTopic,
    addNotesToTopic,
    removeNotesFromTopic,
    // 检索
    recall,
    recallInTopic,
    // 分享
    createShareLink,
    // 底层（测试与逃生用）
    request,
    headers,
  }
}

/**
 * 从笔记对象里挖出所有「可播放的音频」。
 *
 * 官方字段分散在三处，都要收：
 *   · `note.audio.play_url` + `duration`      —— 录音/会议笔记的主音频（**秒**）
 *   · `note.attachments[].url`（type=audio）  —— 附件里的音频（**毫秒**）
 *   · `note.timeline.resources[].url`（type=audio）—— 时间线引用的音频（常与主音频同一份）
 *
 * 按 URL 去重，主音频排第一。返回 `[{url, duration, kind}]`，duration 统一成**秒**。
 *
 * 单位不统一是实测出来的坑：同一个录音笔记，`audio.duration` 给 18，而
 * `attachments[0].duration` 给 17860。把 17860 当秒渲染，播放器会显示
 * `00:00 / 297:40`——看着像文件坏了，其实只是单位错了。
 */
export function extractAudio(note) {
  if (!note || typeof note !== 'object') return []
  const out = []
  const seen = new Set()
  const push = (url, duration, kind, title) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return
    const key = url.split('#')[0]
    if (seen.has(key)) return
    seen.add(key)
    out.push({ url, duration: typeof duration === 'number' && duration > 0 ? duration : null, kind, title: title || null })
  }
  if (note.audio && typeof note.audio === 'object') {
    push(note.audio.play_url, note.audio.duration, 'primary', note.title)
  }
  if (Array.isArray(note.attachments)) {
    for (const a of note.attachments) {
      if (a && (a.type === 'audio' || /\.(mp3|m4a|wav|aac|ogg)$/i.test(String(a.url || '')))) {
        // 附件时长是毫秒；小于 1000 的当作已经是秒（很短的一两秒录音，两种单位都说得通，
        // 但按毫秒算是 0 秒，按秒算才对）
        const raw = a.duration
        const seconds = typeof raw === 'number' && raw > 1000 ? Math.round(raw / 1000) : raw
        push(a.url, seconds, 'attachment', a.title)
      }
    }
  }
  if (note.timeline && Array.isArray(note.timeline.resources)) {
    for (const r of note.timeline.resources) {
      if (r && r.type === 'audio') push(r.url, null, 'timeline', null)
    }
  }
  return out
}

/**
 * 从笔记里取「逐字稿/原文」。
 *
 * 不同类型取不同字段（官方文档明确要求这么取，不能一律读 content）：
 *   · 录音/会议 → audio.original
 *   · 链接笔记 → web_page.content
 *   · 纯文本  → content
 */
export function extractOriginal(note) {
  if (!note || typeof note !== 'object') return ''
  if (note.audio && typeof note.audio.original === 'string' && note.audio.original.trim() !== '') {
    return note.audio.original
  }
  if (note.web_page && typeof note.web_page.content === 'string' && note.web_page.content.trim() !== '') {
    return note.web_page.content
  }
  return typeof note.content === 'string' ? note.content : ''
}

/**
 * 归一化一条云端笔记。
 *
 * 列表接口和详情接口字段不完全一样（列表没有 audio/timeline），所以这里对每个
 * 字段都做回退，缺失就给安全默认值。**绝不为了好看编造字段**——前端会按
 * `hasAudio` / `hasTranscript` 决定显示什么，编一个空音频反而让人以为丢数据。
 *
 * @param {any} raw
 * @param {object} [options]
 * @param {string} [options.topicName]
 */
export function normalizeNote(raw, { topicName } = {}) {
  if (!raw || typeof raw !== 'object') return null
  const noteId = String(raw.note_id ?? raw.noteId ?? raw.id ?? '')
  if (noteId === '') return null
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((t) => (typeof t === 'string' ? { id: null, name: t, type: 'manual' } : { id: t?.id != null ? String(t.id) : null, name: String(t?.name ?? ''), type: t?.type ?? 'manual' })).filter((t) => t.name !== '')
    : []
  const topics = Array.isArray(raw.topics)
    ? raw.topics.map((t) => ({ id: String(t?.id ?? ''), name: String(t?.name ?? '') })).filter((t) => t.id !== '')
    : []
  const audio = extractAudio(raw)
  const original = extractOriginal(raw)
  const moments = raw.timeline && Array.isArray(raw.timeline.moments)
    ? raw.timeline.moments.map((m) => ({
        startMs: typeof m?.start_ms === 'number' ? m.start_ms : 0,
        endMs: typeof m?.end_ms === 'number' ? m.end_ms : 0,
        text: String(m?.text ?? ''),
      })).filter((m) => m.text !== '')
    : []
  const todos = raw.meeting_todos && Array.isArray(raw.meeting_todos.items)
    ? raw.meeting_todos.items.map((t) => ({ text: String(t?.text ?? ''), completed: t?.completed === true })).filter((t) => t.text !== '')
    : []
  return {
    noteId,
    title: String(raw.title ?? '').trim(),
    content: typeof raw.content === 'string' ? raw.content : '',
    refContent: typeof raw.ref_content === 'string' ? raw.ref_content : '',
    noteType: String(raw.note_type ?? 'NOTE'),
    source: raw.source ?? null,
    entryType: raw.entry_type ?? null,
    tags,
    topics: topics.length > 0 ? topics : (topicName ? [{ id: '', name: topicName }] : []),
    childrenIds: Array.isArray(raw.children_ids) ? raw.children_ids.map(String) : [],
    childrenCount: typeof raw.children_count === 'number' ? raw.children_count : 0,
    quickNote: typeof raw.quick_note === 'string' ? raw.quick_note : '',
    audio,
    hasAudio: audio.length > 0,
    original,
    hasTranscript: original !== '',
    moments,
    todos,
    recorderSn: raw.recorder_sn ?? null,
    version: typeof raw.version === 'number' ? raw.version : null,
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
    // 内容指纹：同步时用来判断「云端真的改过吗」，避免每次刷新都重写文件
    fingerprint: fingerprintOf({ title: raw.title, content: original, updatedAt: raw.updated_at, tags: tags.map((t) => t.name) }),
  }
}

/** 内容指纹：同一份内容永远得到同一个短哈希。 */
export function fingerprintOf(parts) {
  const h = createHash('sha1')
  h.update(JSON.stringify({
    title: parts?.title ?? '',
    content: parts?.content ?? '',
    updatedAt: parts?.updatedAt ?? '',
    tags: Array.isArray(parts?.tags) ? parts.tags : [],
  }))
  return h.digest('hex').slice(0, 16)
}
