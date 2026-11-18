/**
 * dsh-getnote — 一次性全量导入（host 侧）
 *
 * 目标很具体：**在会员还有效的时候，把得到大脑里的笔记全部变成你硬盘上的
 * Markdown 文件**。之后会员到期、服务下线、账号注销，都不影响你继续读和写。
 *
 * 落盘格式沿用用户已有归档库的约定（README / 映射表 里那套）：
 *   · 目录        `<库根>/<知识库名>/`
 *   · 文件名      `YYYY-MM-DD-<标题>.md`
 *   · 幂等键      frontmatter `note_id`，已存在则跳过，**绝不覆盖本地修改**
 *   · 来源标记    文末 `（源自得到大脑 · [原笔记](url) · 归档于 YYYY-MM-DD）`
 *   · 隐私        tags 含「私密」时保持私密标记
 *
 * 「绝不覆盖」是这个模块最重要的性质：用户可能已经在本地给某篇笔记改了字、
 * 加了批注。同步只负责把**云端新出现的**笔记补进来；已经存在的文件原样保留，
 * 并把「因本地已有而跳过」如实报给用户。
 */
import { readdir, readFile, stat } from './vfs.js'
import { join } from 'node:path'
import { createNote, safeFilename, scanVault, writeNote } from './vault.js'

const NOTE_PAGE_SIZE = 50
const TOOL_DELAY_MS = 350            // 得到大脑写入/读取限速：约 3 次/秒，留余量
const MAX_NOTES_PER_RUN = 5000       // 单次导入上限（防跑飞）
const MAX_TOPICS = 200

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function pad(n) {
  return String(n).padStart(2, '0')
}

function todayString() {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** epoch 毫秒 / 秒 / RFC3339 字符串 → `YYYY-MM-DD`，取不到就 null。 */
function dateOf(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000
    const d = new Date(ms)
    if (Number.isNaN(d.getTime())) return null
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  const s = String(value).trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 从笔记对象里嗅出标题：字段名在服务端有几个变体，按可靠性排序。 */
function titleOf(note) {
  const candidates = [note.title, note.name, note.subject, note.headline, note.summary_title]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
  }
  const body = typeof note.content === 'string' ? note.content : ''
  const m = /^#{1,3}\s+(.+)$/m.exec(body)
  if (m) return m[1].trim()
  const firstLine = body.split(/\r?\n/).find((line) => line.trim() !== '')
  if (firstLine) return firstLine.trim().slice(0, 60)
  return '未命名笔记'
}

function dateOfNote(note) {
  return (
    dateOf(note.created_at) ||
    dateOf(note.createdAt) ||
    dateOf(note.create_time) ||
    dateOf(note.created_time) ||
    dateOf(note.created) ||
    dateOf(note.edit_time) ||
    dateOf(note.updated_at)
  )
}

function urlOfNote(note) {
  if (typeof note.url === 'string' && note.url !== '') return note.url
  if (typeof note.note_url === 'string' && note.note_url !== '') return note.note_url
  const id = note.note_id || note.id
  return id ? `https://www.biji.com/note/${id}` : null
}

function idOfNote(note) {
  const id = note.note_id ?? note.id ?? note.noteId
  return id === null || id === undefined ? null : String(id)
}

function tagsOfNote(note) {
  const raw = note.tags ?? note.tag_list ?? note.tagList
  if (Array.isArray(raw)) {
    return raw
      .map((tag) => (typeof tag === 'string' ? tag : tag && (tag.name || tag.title || tag.tag_name)))
      .filter((tag) => typeof tag === 'string' && tag.trim() !== '')
      .map((tag) => tag.trim())
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
  }
  return []
}

/**
 * 笔记 → Markdown 全文。
 *
 * 得到大脑的一条「笔记」在语义上有两块：`ref_content` 是被引用的原文（课程、
 * 链接、录音转写），`content` 是自己的评论。归档时原文在上、评论在下，中间
 * 用一条分隔线——这样读起来和 App 里的层次一致，也不会把两者混成一段。
 */
function renderNoteMarkdown(note, { topicName, archiveDate }) {
  const title = titleOf(note)
  const noteId = idOfNote(note)
  const url = urlOfNote(note)
  const date = dateOfNote(note)
  const tags = tagsOfNote(note)
  const allTags = [...new Set([...tags, '得到大脑'])]

  const refContent = typeof note.ref_content === 'string' ? note.ref_content.trim() : ''
  const ownContent = typeof note.content === 'string' ? note.content.trim() : ''
  const bodyParts = []
  if (refContent !== '') bodyParts.push(refContent)
  if (ownContent !== '' && ownContent !== refContent) {
    if (bodyParts.length > 0) bodyParts.push('\n---\n')
    bodyParts.push(ownContent)
  }
  if (bodyParts.length === 0) bodyParts.push('_（这条笔记没有正文）_')

  const head = [
    '---',
    `tags: [${allTags.join(', ')}]`,
    noteId ? `note_id: "${noteId}"` : null,
    url ? `note_url: ${url}` : null,
    topicName ? `知识库: ${topicName}` : null,
    date ? `创建: ${date}` : null,
    `归档: ${archiveDate}`,
    '---',
    '',
    `# ${title}`,
    '',
  ].filter((line) => line !== null)

  const footer = ['', '---', '', url
    ? `（源自得到大脑 · [原笔记](${url}) · 归档于 ${archiveDate}）`
    : `（源自得到大脑 · 归档于 ${archiveDate}）`, '']

  return [...head, ...bodyParts, ...footer].join('\n')
}

/** 从已有库里收出「已经归档过的 note_id」集合（幂等键）。 */
async function existingNoteIds(root) {
  const ids = new Set()
  const byTitle = new Set()
  const { entries } = await scanVault(root)
  for (const entry of entries) {
    if (entry.noteId) ids.add(String(entry.noteId))
    byTitle.add(`${entry.name}`)
  }
  return { ids, byTitle }
}

/**
 * 拉取所有知识库的 id + 名称。
 *
 * 拿到失败不致命：用户可能只授权了部分 scope。此时用「上次导入时记下的知识库
 * 列表」或空列表继续，让 list_notes（全局）仍然能跑。
 */
async function listTopics(client, log) {
  const topics = []
  let page = 1
  for (;;) {
    let result
    try {
      result = await client.callTool('list_topics', { page, page_size: 50 })
    } catch (error) {
      log(`读取知识库列表失败（继续按全部笔记导入）：${error.message}`)
      break
    }
    const items = Array.isArray(result) ? result : result && Array.isArray(result.topics) ? result.topics : result && Array.isArray(result.list) ? result.list : []
    for (const item of items) {
      const id = item.topic_id || item.id
      if (!id) continue
      topics.push({ id: String(id), name: String(item.name || item.title || id) })
    }
    const hasMore = result && (result.has_more === true || result.next_page !== undefined || result.hasMore === true)
    if (!hasMore || items.length === 0 || topics.length >= MAX_TOPICS) break
    page = (result && (result.next_page || result.nextPage)) || page + 1
    await sleep(TOOL_DELAY_MS)
  }
  return topics
}

/**
 * 分页把笔记读出来。
 *
 * 首选 `list_notes`（全局、带 topic 归属），失败再退回逐知识库 `list_topic_notes`。
 * 两条路都走不通就抛出——此时用户需要知道「是授权没了还是网络问题」。
 */
async function fetchAllNotes(client, topics, log) {
  const notes = []
  const seen = new Set()

  const absorb = (items, topic) => {
    for (const item of items) {
      const id = idOfNote(item)
      if (!id || seen.has(id)) continue
      seen.add(id)
      notes.push({ note: item, topicName: topic ? topic.name : null })
    }
  }

  // 路线 A：全局 list_notes
  let page = 1
  let routeA = true
  while (routeA && notes.length < MAX_NOTES_PER_RUN) {
    let result
    try {
      result = await client.callTool('list_notes', { page, page_size: NOTE_PAGE_SIZE })
    } catch (error) {
      log(`全局列表不可用，改为逐知识库读取：${error.message}`)
      routeA = false
      break
    }
    const items = Array.isArray(result) ? result : result && Array.isArray(result.notes) ? result.notes : result && Array.isArray(result.list) ? result.list : []
    absorb(items, null)
    log(`已读取 ${notes.length} 条…`)
    const hasMore = result && (result.has_more === true || result.hasMore === true)
    if (!hasMore || items.length === 0) break
    page = (result && (result.next_page || result.nextPage)) || page + 1
    await sleep(TOOL_DELAY_MS)
  }

  // 路线 B：逐知识库补齐（全局列表通常不带 topic 名，这里能补上归属）
  const needTopicPass = notes.length === 0 || notes.some((item) => !item.topicName)
  if (needTopicPass && topics.length > 0) {
    for (const topic of topics) {
      if (notes.length >= MAX_NOTES_PER_RUN) break
      let pageNo = 1
      for (;;) {
        let result
        try {
          result = await client.callTool('list_topic_notes', { topic_id: topic.id, page: pageNo, page_size: NOTE_PAGE_SIZE })
        } catch (error) {
          log(`知识库「${topic.name}」读取失败：${error.message}`)
          break
        }
        const items = Array.isArray(result) ? result : result && Array.isArray(result.notes) ? result.notes : result && Array.isArray(result.list) ? result.list : []
        // 已存在但缺 topic 名的条目补归属
        for (const item of items) {
          const id = idOfNote(item)
          if (!id) continue
          const existing = notes.find((slot) => idOfNote(slot.note) === id)
          if (existing) {
            if (!existing.topicName) existing.topicName = topic.name
          } else if (!seen.has(id)) {
            seen.add(id)
            notes.push({ note: item, topicName: topic.name })
          }
        }
        log(`「${topic.name}」已读取 ${items.length} 条（累计 ${notes.length}）`)
        const hasMore = result && (result.has_more === true || result.hasMore === true)
        if (!hasMore || items.length === 0) break
        pageNo = (result && (result.next_page || result.nextPage)) || pageNo + 1
        await sleep(TOOL_DELAY_MS)
      }
    }
  }

  return notes
}

/** 对列表里的精简笔记补全正文（列表接口通常不给完整 content）。 */
async function enrichNote(client, note) {
  const hasBody = typeof note.content === 'string' && note.content.trim() !== ''
  const hasRef = typeof note.ref_content === 'string' && note.ref_content.trim() !== ''
  if (hasBody || hasRef) return note
  const id = idOfNote(note)
  if (!id) return note
  try {
    const detail = await client.callTool('get_note', { id })
    const payload = detail && detail.note ? detail.note : detail
    if (payload && typeof payload === 'object') return { ...note, ...payload }
  } catch {
    // 单篇补全失败不该毁掉整次导入：保留列表里的元数据，正文留空由用户后续补
  }
  return note
}

/**
 * 主流程：登录态 + 本地库 → 一批新 Markdown 文件。
 *
 * @param client        已 initialize 的 McpClient
 * @param root          本地库根（绝对路径，已 realpath）
 * @param options.log   进度回调（字符串）
 */
export async function importAllNotes(client, root, { log = () => {}, maxNotes = MAX_NOTES_PER_RUN } = {}) {
  const startedAt = Date.now()
  const archiveDate = todayString()
  log('正在读取知识库列表…')
  const topics = await listTopics(client, log)
  log(topics.length > 0 ? `发现 ${topics.length} 个知识库` : '未读到知识库列表，按全部笔记导入')

  const notes = await fetchAllNotes(client, topics, log)
  log(`云端共 ${notes.length} 条笔记，开始写入本地库…`)

  const { ids } = await existingNoteIds(root)
  const stats = { total: notes.length, created: 0, skipped: 0, failed: 0, notes: [] }

  let processed = 0
  for (const item of notes) {
    if (processed >= maxNotes) {
      stats.truncated = true
      break
    }
    processed += 1
    const note = item.note
    const id = idOfNote(note)
    if (id && ids.has(id)) {
      stats.skipped += 1
      continue
    }
    try {
      const full = await enrichNote(client, note)
      const title = titleOf(full)
      const date = dateOfNote(full) || archiveDate
      const dir = item.topicName ? safeFilename(item.topicName, '未分类') : '未分类'
      const markdown = renderNoteMarkdown(full, { topicName: item.topicName, archiveDate })

      // 用 createNote 的统一命名（YYYY-MM-DD-标题.md）但先查重复，保持幂等
      const created = await createNote(root, { dir, title, content: markdown, date })
      stats.created += 1
      if (id) ids.add(id)
      stats.notes.push({ noteId: id, title, path: created.path })
      if (stats.created % 20 === 0) log(`已写入 ${stats.created} 篇…`)
    } catch (error) {
      stats.failed += 1
      stats.notes.push({ noteId: id, title: titleOf(note), error: String(error && error.message ? error.message : error) })
    }
  }

  stats.durationMs = Date.now() - startedAt
  stats.topics = topics
  log(`导入完成：新增 ${stats.created}，跳过 ${stats.skipped}（本地已有），失败 ${stats.failed}`)
  return stats
}

/** 从本地库反推知识库名清单（导入过一次之后，用作下次的目录建议）。 */
export async function localTopicNames(root) {
  try {
    const dirents = await readdir(root, { withFileTypes: true })
    return dirents.filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name)
  } catch {
    return []
  }
}

/** 探测令牌是否还有效（拿到 401 就说明会员/授权过期了）。 */
export async function probeAccessToken(accessToken) {
  const { McpClient } = await import('./biji.js')
  const client = new McpClient(accessToken)
  try {
    const info = await client.initialize()
    return { ok: true, serverInfo: info }
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) }
  }
}

export { renderNoteMarkdown, titleOf, dateOfNote, idOfNote, tagsOfNote }
