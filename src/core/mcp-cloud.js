/**
 * dsh-getnote — 把「已登录的 MCP 通道」包装成和 openapi.js 一模一样的客户端
 *
 * 为什么要有这一层：
 *
 *   官方 Open API 需要用户自己去 openapi.biji.com 控制台建应用、拿 API Key。这是
 *   一条干净的路，但它把「装上插件立刻能用」变成了「先去注册」。
 *
 *   而面板里原本就有 OAuth 登录（一次性导入用），那个 access_token 还在有效期内，
 *   而且它背后的 MCP 端点提供了 49 个工具——比 Open API 的 33 个还多：录音附件
 *   （真实 mp3 地址）、逐字稿、章节时间线、待办，全都能拿到。
 *
 *   所以这里把 McpClient 包成和 openapi.js 的 createClient() **返回同一个接口**，
 *   上层 index.js 不用关心当前走的是哪条通道。选择顺序由 index.js 决定：
 *   有 API Key 用 Open API，没有就用这个。
 *
 * 两个通道的差异（必须在这里抹平，否则上层会出现「列表能翻页但详情没有音频」这种
 * 半残状态）：
 *
 *   · **参数名不同**：Open API 用 `limit` / `cursor`；MCP 用 `page_size` / `cursor`，
 *     而且 `list_notes` 的 schema 是 `additionalProperties:false`——传错字段是硬错误
 *     （实测报 `unexpected additional properties ["limit"]`），不是静默忽略。
 *   · **返回外壳不同**：Open API 是 `{success,data}`；MCP 是
 *     `{notes,has_more,cursor,pagination,total}` 直接平铺。
 *   · **音频字段不同**：Open API 在 `note.audio.play_url`；MCP 实测在
 *     `note.attachments[] = {type:'audio', url, duration}`，`note.audio` 里只有
 *     `original` 和 `sentences`（没有 play_url）。这是最容易漏的一处：
 *     只按 Open API 的字段取音频，录音笔记会在面板上「看起来没有音频」。
 *   · **时长单位不同**：MCP 的 `attachments[].duration` 是**毫秒**（实测 43620 = 43.6 秒，
 *     与归档里「43 秒」一致）；Open API 的 `audio.duration` 是秒。
 */
import { McpClient } from './biji.js'
import { extractAudio, extractOriginal, normalizeNote } from './openapi.js'

/** 把 MCP 的错误统一成带 status 的 Error，便于 index.js 的 fail() 分流。 */
function wrapError(what, error) {
  const message = error && error.message ? error.message : String(error)
  const e = new Error(`得到大脑 ${what} 失败：${message}`)
  // MCP 的 401 多半是令牌失效；其余当上游错误
  e.status = /401|unauthorized|no bearer token/i.test(message) ? 401 : 502
  e.cause = error
  return e
}

/**
 * 让 attachments 里的音频变成 `note.audio.play_url`。
 *
 * 上层的 normalizeNote / extractAudio 是按 Open API 的字段写的，这里补齐即可
 * 复用同一套归一化逻辑，避免两套并行的字段解释（那才是真正的维护灾难）。
 */
function bridgeAudio(raw) {
  if (!raw || typeof raw !== 'object') return raw
  const attachments = Array.isArray(raw.attachments) ? raw.attachments : []
  const primary = attachments.find((a) => a && a.type === 'audio' && typeof a.url === 'string')
  if (!primary) return raw
  const audio = raw.audio && typeof raw.audio === 'object' ? { ...raw.audio } : {}
  if (!audio.play_url) audio.play_url = primary.url
  // MCP 的 duration 是毫秒，Open API 约定是秒：>1000 的按毫秒折算
  if (audio.duration === undefined && typeof primary.duration === 'number') {
    audio.duration = primary.duration > 1000 ? Math.round(primary.duration / 1000) : primary.duration
  }
  return { ...raw, audio }
}

/**
 * 建一个「形如 Open API 客户端」的 MCP 客户端。
 *
 * 返回的方法名与 openapi.js createClient() 完全一致，index.js 无缝切换。
 */
export function createMcpCloudClient({ accessToken, url } = {}) {
  const mcp = new McpClient(accessToken, url ? { url } : undefined)
  let ready = null

  /** initialize 只做一次；失败也缓存，避免每个请求都重试一遍握手。 */
  function ensureReady() {
    if (ready === null) {
      ready = mcp.initialize().catch((error) => {
        ready = null
        throw wrapError('握手', error)
      })
    }
    return ready
  }

  async function tool(name, args) {
    await ensureReady()
    try {
      return await mcp.callTool(name, args)
    } catch (error) {
      throw wrapError(name, error)
    }
  }

  // ── 笔记 ────────────────────────────────────────────────────────────────

  async function listNotes({ cursor, limit } = {}) {
    const pageSize = typeof limit === 'number' && limit > 0 ? Math.min(limit, 100) : 20
    const args = { page_size: pageSize }
    if (cursor) args.cursor = String(cursor)
    const data = await tool('list_notes', args)
    const notes = Array.isArray(data?.notes) ? data.notes : []
    return {
      notes,
      hasMore: data?.has_more === true,
      cursor: data?.cursor ?? data?.pagination?.next_cursor ?? null,
      total: typeof data?.total === 'number' ? data.total : null,
    }
  }

  /**
   * 笔记详情。
   *
   * 录音/会议类笔记的音频在 attachments 里，这里统一桥接成 audio.play_url，
   * 让上层拿到和 Open API 一样的形状。
   */
  async function getNote(noteId) {
    const data = await tool('get_note', { id: String(noteId) })
    const note = data?.note ?? data
    return bridgeAudio(note) ?? null
  }

  async function listRecorderNotes({ sinceId = 0, limit = 20 } = {}) {
    // MCP 没有独立的「录音卡」列表：按 note_type 过滤即可拿到同一批数据
    const data = await tool('list_notes', { note_type: 'recorder_audio', page_size: Math.min(limit, 100), ...(sinceId ? {} : {}) })
    const notes = Array.isArray(data?.notes) ? data.notes : []
    return { notes, hasMore: data?.has_more === true, nextCursor: data?.cursor ?? null, total: data?.total ?? null }
  }

  const getRecorderNote = getNote

  async function createNote({ noteType, title, content, linkUrl, imageUrls, tags, topicId, parentId, clientRequestId } = {}) {
    const args = {}
    if (title !== undefined) args.title = String(title)
    if (content !== undefined) args.content = String(content)
    if (noteType !== undefined) args.note_type = noteType
    if (Array.isArray(tags)) args.tags = tags.map(String)
    if (topicId !== undefined) args.topic_id = String(topicId)
    if (parentId !== undefined) args.parent_id = String(parentId)
    if (linkUrl !== undefined) args.link_url = String(linkUrl)
    if (Array.isArray(imageUrls)) args.image_urls = imageUrls.map(String)
    if (clientRequestId !== undefined) args.client_request_id = String(clientRequestId)
    const data = await tool('save_note', args)
    return { noteId: data?.note_id != null ? String(data.note_id) : null, tasks: data?.tasks ?? null, raw: data }
  }

  async function updateNote({ noteId, title, content, tags } = {}) {
    const args = { note_id: String(noteId) }
    if (title !== undefined) args.title = String(title)
    if (content !== undefined) args.content = String(content)
    if (Array.isArray(tags)) args.tags = tags.map(String)
    return tool('update_note', args)
  }

  async function deleteNote(noteId) {
    return tool('delete_note', { note_id: String(noteId) })
  }

  async function taskProgress(taskId) {
    return tool('get_note_task_progress', { task_id: String(taskId) })
  }

  async function addTags(noteId, tags) {
    return tool('add_note_tags', { note_id: String(noteId), tags: (tags || []).map(String) })
  }

  async function deleteTag(noteId, tagId) {
    return tool('delete_note_tag', { note_id: String(noteId), tag_id: String(tagId) })
  }

  // ── 知识库 ──────────────────────────────────────────────────────────────

  async function listTopics(page = 1) {
    const data = await tool('list_topics', { page: Math.max(1, Number(page) || 1), page_size: 20 })
    const topics = Array.isArray(data?.topics) ? data.topics : []
    return { topics, hasMore: data?.has_more === true, total: typeof data?.total === 'number' ? data.total : null }
  }

  async function createTopic({ name, description } = {}) {
    return tool('create_topic', { name: String(name), ...(description ? { description: String(description) } : {}) })
  }

  async function listTopicNotes({ topicId, page = 1 } = {}) {
    const data = await tool('list_topic_notes', { topic_id: String(topicId), page: Math.max(1, Number(page) || 1), page_size: 20 })
    const notes = Array.isArray(data?.notes) ? data.notes : []
    return { notes, hasMore: data?.has_more === true, total: typeof data?.total === 'number' ? data.total : null }
  }

  async function browseTopic({ topicId, directoryId } = {}) {
    const data = await tool('list_topic_notes', { topic_id: String(topicId), page: 1, page_size: 20 })
    return { notes: Array.isArray(data?.notes) ? data.notes : [], directories: [], topicId, directoryId }
  }

  async function addNotesToTopic({ topicId, noteIds } = {}) {
    return tool('batch_add_notes_to_topic', { topic_id: String(topicId), note_ids: (noteIds || []).map(String) })
  }

  async function removeNotesFromTopic({ topicId, noteIds } = {}) {
    const results = []
    for (const id of noteIds || []) {
      results.push(await tool('remove_note_from_topic', { topic_id: String(topicId), note_id: String(id) }))
    }
    return results
  }

  // ── 检索 ────────────────────────────────────────────────────────────────

  async function recall(query, topK = 5) {
    const data = await tool('recall', { query: String(query), top_k: Math.max(1, Math.min(Number(topK) || 5, 20)) })
    const results = Array.isArray(data?.results) ? data.results : []
    return { results: results.map((r) => ({ ...bridgeAudio(r.note ?? r), score: r.score, snippet: r.snippet ?? null, noteId: r.note_id ?? r.note?.note_id ?? null })), raw: data }
  }

  async function recallInTopic({ topicId, query, topK = 5 } = {}) {
    const data = await tool('recall_knowledge', { topic_id: String(topicId), query: String(query), top_k: Math.max(1, Math.min(Number(topK) || 5, 20)) })
    const results = Array.isArray(data?.results) ? data.results : []
    return { results: results.map((r) => ({ ...bridgeAudio(r.note ?? r), score: r.score, snippet: r.snippet ?? null, noteId: r.note_id ?? r.note?.note_id ?? null })), raw: data }
  }

  // ── 分享 ────────────────────────────────────────────────────────────────

  async function createShareLink({ noteId, excludeAudio } = {}) {
    const args = { note_id: String(noteId) }
    if (excludeAudio === true) args.share_exclude_audio = true
    const data = await tool('share_note', args)
    return data?.share_url ?? data?.url ?? data
  }

  // ── 录音类专属（MCP 才有，Open API 只有部分）────────────────────────────

  async function getTranscript(noteId) {
    return tool('get_note_transcript', { id: String(noteId) })
  }

  async function getChapters(noteId) {
    return tool('get_note_chapters', { id: String(noteId) })
  }

  async function getTimeline(noteId) {
    return tool('get_note_timeline', { id: String(noteId) })
  }

  async function getTodos(noteId) {
    return tool('get_note_todos', { id: String(noteId) })
  }

  async function getAttachments(noteId) {
    return tool('get_note_attachments', { id: String(noteId) })
  }

  async function getQuota() {
    return tool('get_quota', {})
  }

  return {
    // 标记当前通道，供 /status 与日志区分
    transport: 'mcp',
    listNotes,
    getNote,
    listRecorderNotes,
    getRecorderNote,
    createNote,
    updateNote,
    deleteNote,
    taskProgress,
    addTags,
    deleteTag,
    listTopics,
    createTopic,
    listTopicNotes,
    browseTopic,
    addNotesToTopic,
    removeNotesFromTopic,
    recall,
    recallInTopic,
    createShareLink,
    getTranscript,
    getChapters,
    getTimeline,
    getTodos,
    getAttachments,
    getQuota,
    // 底层逃生
    tool,
  }
}

export { bridgeAudio, extractAudio, extractOriginal, normalizeNote }
