/**
 * dsh-getnote — 云端 ⇄ 本地自动同步引擎
 *
 * 定位：**云端是内容真身，本地是随时可离线的镜像**。
 *
 * 为什么是一等公民：
 *   用户的原话是要「自动去同步笔记，不需要人为去同步」。所以同步必须是后台常驻
 *   的、增量的、能自己从错误里恢复的——而不是一个需要点按钮的全量拉取。
 *
 * 三条硬规则（改这个文件前先读）：
 *
 *   1. **绝不覆盖用户的本地修改**。
 *      同步前先算本地文件的内容指纹，和上次同步时记下的指纹比：
 *        · 本地没动 + 云端变了   → 拉取覆盖（正常）
 *        · 本地动了 + 云端没变   → 保留本地，不拉（用户的编辑优先）
 *        · 两边都变了           → 冲突：本地内容另存到 `.conflicts/`，再拉云端
 *      这三条对应下面 pullNote 里的 decision 分支。
 *
 *   2. **增量优先，省配额**。
 *      官方读配额 1000/天。全量扫描 = 1 页/次 × N 页 + 每篇详情 1 次，几百篇笔记
 *      就能把一天的配额吃光。所以：
 *        · 列表分页里连续两页都是「已存在且指纹未变」就提前收工
 *        · 只有新笔记 / 指纹变了的笔记才去拉详情（详情是配额大头）
 *        · 删除检测只在全量扫描时做（增量提前收工会造成假阳性）
 *
 *   3. **失败要能自己恢复**。
 *      一次同步的任何一步失败都不能留在半截状态：state 只在整轮成功后落盘，
 *      失败的那一篇记进 errors 跳过，不影响其它笔记。
 */
import { createHash } from 'node:crypto'
import { readFile } from './vfs.js'
import { parseFrontmatter, readNote, resolveInside, scanVault, writeNote } from './vault.js'
import { extractOriginal, normalizeNote } from './openapi.js'

/** 每页条数，官方未文档化上限，20 是保守值。 */
const PAGE_SIZE = 20
/** 连续多少页「全是旧的」就提前结束增量扫描。 */
const EARLY_STOP_PAGES = 2
/** 单轮最多处理多少篇（防止配额失控）。 */
const MAX_NOTES_PER_RUN = 2000
/** 翻页硬上限，防服务端 cursor 死循环。 */
const MAX_PAGES = 200

/** 内容指纹：标题 + 正文 + 标签。不含时间戳——时间戳会因为服务端重算而抖动。 */
export function contentFingerprint({ title, content, tags }) {
  const h = createHash('sha1')
  h.update(String(title ?? ''))
  h.update('\u0000')
  h.update(String(content ?? ''))
  h.update('\u0000')
  h.update(Array.isArray(tags) ? tags.join('\u0001') : '')
  return h.digest('hex').slice(0, 16)
}

/** 读一个本地文件的内容指纹；文件没了返回 null。 */
export async function localFingerprintOf(path) {
  try {
    const text = await readFile(path, 'utf8')
    const { data, body } = parseFrontmatter(text)
    const tags = Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : []
    // 用正文 + 标题算，和云端指纹用同一套口径，才能比较
    const title = String(data.title ?? '') || firstHeading(body)
    return contentFingerprint({ title, content: stripSourceFooter(body).trim(), tags })
  } catch {
    return null
  }
}

function firstHeading(body) {
  const m = /^#\s+(.+)$/m.exec(String(body || ''))
  return m ? m[1].trim() : ''
}

/**
 * 去掉我们自己加的文末来源行，避免它污染指纹。
 *
 * 注意只删**那一行**，不能写成 `（源自得到大脑[\s\S]*$`——那样会把用户在来源行
 * 之后追加的任何内容一起吞掉，于是用户明明改了文件、指纹却和上一轮一模一样，
 * 同步就会把他追加的那段当成「本地没改」直接覆盖掉。
 */
function stripSourceFooter(body) {
  return String(body || '')
    .replace(/^[ \t]*（源自得到大脑[^\n]*）[ \t]*\n?/gm, '')
    // 顺手去掉来源行前面那条分隔线：它也是我们自己加的，留在指纹里会让
    // 「我们写的文件」和「云端正文字段」永远算不出同一个值。
    .replace(/\n+(?:-[ \t]*-[ \t]*-[ \t]*\n*)+$/, '\n')
}

/**
 * 把一篇云端笔记渲染成 Markdown。
 *
 * 结构刻意和用户已有归档保持一致（frontmatter + 正文 + 来源行），这样历史上手动
 * 归档的文件和新自动同步的文件长得一样，不会出现两套格式。
 */
export function renderNote({ note, topicName, archiveDate }) {
  const tags = note.tags.map((t) => t.name).filter(Boolean)
  const allTags = ['得到大脑', ...(topicName ? [topicName] : []), ...tags]
  const uniq = [...new Set(allTags)]
  const fm = [
    '---',
    `title: ${yamlString(note.title)}`,
    `tags: [${uniq.map(yamlBare).join(', ')}]`,
    `note_id: "${note.noteId}"`,
  ]
  if (note.noteType) fm.push(`note_type: ${note.noteType}`)
  if (topicName) fm.push(`知识库: ${yamlString(topicName)}`)
  if (note.recorderSn) fm.push(`录音卡: ${note.recorderSn}`)
  if (note.createdAt) fm.push(`创建: ${yamlString(note.createdAt)}`)
  if (note.updatedAt) fm.push(`更新: ${yamlString(note.updatedAt)}`)
  fm.push(`归档: ${archiveDate}`)
  fm.push('---', '')
  const parts = [fm.join('\n')]
  parts.push(`# ${note.title || '未命名笔记'}`, '')

  if (note.refContent) {
    parts.push(...note.refContent.split('\n').map((l) => `> ${l}`), '')
  }
  if (note.quickNote) {
    parts.push('## 现场速记', '', note.quickNote, '')
  }
  if (note.content) {
    // 云端的正文本身常常以 `# 同一个标题` 开头。不剥掉的话渲染出来就是
    // 「# 兴趣」紧接着又一个「# 兴趣」，读起来像复制粘贴事故。
    parts.push(stripDuplicateHeading(note.content, note.title), '')
  }
  // 录音类：逐字稿与原文分开呈现，避免和「AI 总结」混在一起看不清
  if (note.hasTranscript && extractOriginal({ audio: { original: note.original } }) !== note.content) {
    parts.push('## 逐字稿', '', '```', note.original, '```', '')
  }
  if (note.moments.length > 0) {
    parts.push('## 时间轴', '', '| 时间 | 内容 |', '| --- | --- |')
    for (const m of note.moments) {
      parts.push(`| ${fmtMs(m.startMs)} | ${escapeCell(m.text)} |`)
    }
    parts.push('')
  }
  if (note.todos.length > 0) {
    parts.push('## 待办', '')
    for (const t of note.todos) parts.push(`- [${t.completed ? 'x' : ' '}] ${t.text}`)
    parts.push('')
  }
  if (note.audio.length > 0) {
    parts.push('## 音频', '')
    for (const a of note.audio) {
      const label = a.kind === 'primary' ? '录音' : a.kind === 'attachment' ? '附件音频' : '时间线音频'
      const dur = a.duration ? ` · ${fmtSeconds(a.duration)}` : ''
      parts.push(`- ${label}${dur}：[播放](${a.url})`)
    }
    parts.push('')
  }
  parts.push('---', '')
  const share = `https://www.biji.com/note/${note.noteId}`
  parts.push(`（源自得到大脑 · [原笔记](${share}) · 归档于 ${archiveDate}）`)
  return parts.join('\n')
}

/**
 * 云端正文如果自己就以「同一个标题」开头，把它剥掉，因为渲染时我们已经写了一行 `# 标题`。
 * 只剥一级标题、且必须和标题同名，别的一概不动。
 */
function stripDuplicateHeading(content, title) {
  const text = String(content || '')
  const name = String(title || '').trim()
  if (name === '') return text
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^\\s*#\\s+${escaped}\\s*\\n+`)
  return text.replace(re, '')
}

function yamlString(v) {
  const s = String(v ?? '')
  if (s === '') return '""'
  if (/[:#\[\]{}",\n]/.test(s) || /^\s|\s$/.test(s)) return JSON.stringify(s)
  return s
}

function yamlBare(v) {
  const s = String(v ?? '')
  if (s === '') return '""'
  if (/[\[\]{},:#"]/.test(s) || /^\s|\s$/.test(s)) return JSON.stringify(s)
  return s
}

function escapeCell(v) {
  return String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function fmtMs(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

function fmtSeconds(sec) {
  return fmtMs(sec * 1000)
}

// 没有知识库归属的笔记该放哪。用 '_' 当目录名是错的：用户打开库看到一个叫 `_`
// 的文件夹，完全猜不到里面是什么，也不知道能不能改名。
const UNFILED_DIR = '未归类'

function safeDirName(name) {
  const cleaned = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return ''
  return cleaned
}

function dateOf(note) {
  const raw = note.updatedAt || note.createdAt || ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw))
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return new Date().toISOString().slice(0, 10)
}

/**
 * 在本地库里给一篇笔记找它该待的路径。
 *
 * 先按 note_id 在 state 里找上次的路径——**路径一旦定下就不改**，否则用户在
 * Obsidian 里改了文件名，下次同步又会多出一份。
 */
function pathForNote({ note, topicName, state, index }) {
  const known = state.notes[note.noteId]
  if (known && typeof known.path === 'string' && known.path !== '') return migrateOldUnfiled(known.path)
  const byId = index.get(String(note.noteId))
  if (byId) return migrateOldUnfiled(byId)
  const dir = safeDirName(topicName || '') || UNFILED_DIR
  const base = safeFilenameLocal(`${dateOf(note)}-${note.title || note.noteId}`)
  return `${dir}/${base}.md`
}

/**
 * 早期版本把无归属笔记放在 `_/` 目录下（safeDirName 拿空名字时返回 `_`）。
 * 那个名字对用户毫无意义，所以这里把旧路径改写成「未归类/」——
 * 注意只在路径**确实是旧约定**时改，用户在 Obsidian 里自己建的 `_` 目录不动。
 */
function migrateOldUnfiled(rel) {
  if (typeof rel !== 'string') return rel
  if (!rel.startsWith('_/')) return rel
  return `${UNFILED_DIR}/${rel.slice(2)}`
}

function safeFilenameLocal(name) {
  const cleaned = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
  const trimmed = cleaned.slice(0, 120) || 'note'
  return trimmed.replace(/[. ]+$/, '') || 'note'
}

/**
 * 按 frontmatter 里的 note_id 建「note_id → 相对路径」索引。
 *
 * 为什么必须建：`pathForNote` 靠它认出「库里已经有这篇笔记了」。没有索引时会退化成
 * 用日期+标题拼一个路径，一旦和用户自己的命名不完全一致（比如用户放在别的目录、
 * 或者标题被清理过），就会**另写一份重复文件**；如果恰好一致，就会**直接覆盖用户的
 * 手写归档**。两种情况都不可接受，所以不允许裸跑。
 */
async function buildIndex(root) {
  const index = new Map()
  try {
    const scan = await scanVault(root)
    for (const entry of scan.entries) {
      if (entry.noteId) index.set(String(entry.noteId), entry.path)
    }
  } catch {
    // 库读不了就让调用方按没有索引处理（后续 pullNote 仍会走 adopt 保护）
  }
  return index
}

/**
 * 跑一轮同步。
 *
 * @param {object} opts
 * @param {object} opts.client      openapi.js 的客户端
 * @param {string} opts.root        本地库根（绝对路径）
 * @param {object} opts.state       readSyncState() 的结果（不会被原地修改）
 * @param {boolean} opts.full       true = 全量扫描（能发现云端删除），false = 增量
 * @param {(line:string)=>void} opts.log
 * @param {Map<string,string>} opts.index  note_id → 相对路径。省略时自动扫描库建立
 * @returns {Promise<{pulled:number, skipped:number, adopted:number, conflicts:number, deleted:number, errors:Array, notes:object, scanned:number}>}
 */
export async function runSync({ client, root, state, full = false, log = () => {}, index = null, maxNotes = MAX_NOTES_PER_RUN, topicNames = {} } = {}) {
  const prev = state && typeof state === 'object' && state.notes ? state.notes : {}
  const next = {}
  const errors = []
  let pulled = 0
  let skipped = 0
  let adopted = 0
  let conflicts = 0
  let scanned = 0
  let cursor = null
  let pages = 0
  let stalePages = 0
  let hasMore = true
  const seenIds = new Set()
  const archiveDate = new Date().toISOString().slice(0, 10)
  const noteIndex = index instanceof Map ? index : await buildIndex(root)

  while (hasMore && pages < MAX_PAGES && scanned < maxNotes) {
    let page
    try {
      page = await client.listNotes({ cursor, limit: PAGE_SIZE })
    } catch (err) {
      errors.push({ stage: 'list', message: err.message, reason: err.reason ?? null })
      break
    }
    pages += 1
    if (page.notes.length === 0 && !page.hasMore) break

    let pageHadChange = false
    for (const raw of page.notes) {
      if (scanned >= maxNotes) break
      scanned += 1
      const summary = normalizeNote(raw)
      if (!summary) continue
      seenIds.add(summary.noteId)

      const known = prev[summary.noteId]
      // 列表里的字段够不够判断「没变」？够：列表就带 updated_at 与 content。
      // 这里先用列表内容算指纹；真拉详情后再用详情算一次覆盖。
      const listFp = contentFingerprint({
        title: summary.title,
        content: extractOriginal(raw) || summary.content,
        tags: summary.tags.map((t) => t.name),
      })
      if (known && known.listFp === listFp) {
        // 没变：继承上次记录，不动本地文件
        next[summary.noteId] = known
        skipped += 1
        continue
      }
      pageHadChange = true

      const relPath = pathForNote({ note: summary, topicName: topicNameFor(summary, topicNames), state: { notes: { ...prev, ...next } }, index: noteIndex })
      try {
        const outcome = await pullNote({
          client, root, note: summary, relPath, known, log, archiveDate,
          topicName: topicNameFor(summary, topicNames),
        })
        next[summary.noteId] = {
          path: outcome.path,
          listFp,
          cloudFp: outcome.cloudFp,
          localFp: outcome.localFp,
          updatedAt: summary.updatedAt,
          syncedAt: new Date().toISOString(),
          // adopt 标记必须继承下来：它代表「这个文件是用户自己的，别覆盖」，
          // 漏了它下一轮就会被当成本地未改而覆盖掉。
          ...(outcome.adopted === true ? { adopted: true } : {}),
        }
        if (outcome.action === 'pulled') pulled += 1
        else if (outcome.action === 'adopted') { adopted += 1; skipped += 1 }
        else if (outcome.action === 'conflict') { conflicts += 1; pulled += 1 }
        else skipped += 1
      } catch (err) {
        errors.push({ stage: 'pull', noteId: summary.noteId, title: summary.title, message: err.message, reason: err.reason ?? null })
        if (known) next[summary.noteId] = known
      }
    }

    // 增量模式：连续两页没有任何变化就提前收工，省配额
    if (!full) {
      stalePages = pageHadChange ? 0 : stalePages + 1
      if (stalePages >= EARLY_STOP_PAGES) break
    }
    hasMore = page.hasMore
    cursor = page.cursor
    if (!cursor) break
  }

  // 删除检测：只在全量扫描时可信（增量提前收工会把「没扫到的」误判成删除）
  let deleted = 0
  if (full) {
    for (const [noteId, rec] of Object.entries(prev)) {
      if (seenIds.has(noteId)) continue
      if (next[noteId]) continue
      if (!rec || typeof rec.path !== 'string') continue
      try {
        // 同上：resolveInside 返回对象，不解构就会让 localFingerprintOf 永远拿 null，
        // 于是「本地改过」判断失效，用户改过的笔记会被当成没改过而直接移进回收站。
        const { abs } = resolveInside(root, rec.path)
        const localFp = await localFingerprintOf(abs)
        // 本地改过就留给人处理，不替用户删
        if (localFp !== null && rec.localFp && localFp !== rec.localFp) {
          log(`保留本地修改（云端已删除）：${rec.path}`)
          next[noteId] = { ...rec, cloudDeleted: true }
          conflicts += 1
          continue
        }
        const { trashNote } = await import('./vault.js')
        await trashNote(root, rec.path)
        deleted += 1
        log(`云端已删除，移入回收站：${rec.path}`)
      } catch (err) {
        errors.push({ stage: 'delete', noteId, message: err.message })
      }
    }
  }

  return { pulled, skipped, adopted, conflicts, deleted, errors, notes: next, scanned, pages, full }
}

function topicNameFor(note, topicNames) {
  const first = note.topics && note.topics[0]
  if (!first) return ''
  if (first.name) return first.name
  return topicNames[first.id] || ''
}

/**
 * 把一篇云端笔记落到本地。
 *
 * 决策逻辑（这是整个同步最需要小心的地方）：
 *   · 本地没有文件            → 新建
 *   · 本地有文件且未改        → 覆盖成云端最新
 *   · 本地有文件且改过        → **保留本地**，只更新 state 里的云端指纹，不动文件
 *   · 本地改过 + 云端也改过    → 冲突：本地另存 `.conflicts/`，正文写云端版本
 */
async function pullNote({ client, root, note, relPath, known, log, archiveDate, topicName }) {
  // 列表接口没有 audio / timeline，录音类笔记必须拉详情才拿得到音频与逐字稿。
  // 只对「需要详情」的笔记拉，省配额。
  // 注意实际 note_type 是 `recorder_audio`（下划线），用 includes 而不是全等，
  // 免得服务端哪天又加个 `recorder_video` 之类的变体就静默丢音频。
  let detail = null
  const typeText = String(note.noteType || '').toLowerCase()
  const needsDetail =
    typeText.includes('recorder') ||
    typeText.includes('meeting') ||
    typeText.includes('audio') ||
    !note.content
  if (needsDetail) {
    try {
      detail = await client.getNote(note.noteId)
    } catch (err) {
      // 列表数据够用（有正文）就兜底：录音卡接口是 fail-closed 的，拿不到详情
      // 不代表笔记不存在，这时用列表字段照样能落一篇可读的笔记。
      if (note.content) {
        log(`详情拉取失败，用列表数据：${note.title}（${err.message}）`)
      } else {
        // 列表里没有正文、详情又拿不到 —— 落下去只会得到一篇空文件，
        // 还可能覆盖掉本地已有的好内容。这种情况如实报错，这篇留到下轮重试。
        throw err
      }
    }
  }
  const full = detail ? normalizeNote(detail) : note
  const cloudFp = contentFingerprint({ title: full.title, content: full.original || full.content, tags: full.tags.map((t) => t.name) })

  // resolveInside 返回的是 { abs, rel, create } 而不是字符串。直接把它当路径传下去
  // 会让 localFingerprintOf 里 readFile 抛错、返回 null，于是每篇笔记都被判成
  // 「本地没有 → 新建」，把用户已经存在的手写文件整篇覆盖掉。
  const { abs } = resolveInside(root, relPath)
  const localFp = await localFingerprintOf(abs)
  const rendered = renderNote({ note: full, topicName: topicName || topicNameFor(full, {}), archiveDate })

  // 本地不存在 → 直接写
  if (localFp === null) {
    await writeNote(root, relPath, rendered, { backup: false })
    // 记下**写完之后磁盘上那份文件**的指纹，不能拿 cloudFp 顶替：渲染出来的 Markdown
    // 带有标题行、引用、章节小标题，它的指纹和云端正文字段算出来的根本不同。用 cloudFp
    // 冒充的话，下一轮就会把「我们自己写下去的文件」当成「用户改过」而永久保留旧版。
    return { action: 'pulled', path: relPath, cloudFp, localFp: await localFingerprintOf(abs) }
  }

  /**
   * 首次遇到「本地已有这个 note_id 的文件」。
   *
   * 这是整个同步里最容易造成**数据损坏**的地方：state 里没有记录，我们就分不清
   * 这个文件是（a）上一轮我们自己写下去的，还是（b）用户按自己的归档规则手写／
   * 用别的方式存进来的。实测就撞到过 (b)——用户库里一篇手写归档带着
   * `类型 / 录音时间 / 设备` 这些手工整理过的字段，被同步直接覆盖掉了。
   *
   * 用户库自己的 README 写得很清楚：「幂等键 frontmatter note_id，已存在则跳过不覆盖」。
   * 所以这里一律按「用户的东西更重要」处理：**保住本地文件**，把云端指纹记进
   * state 当作基线，并标记 `adopted`。之后云端改了内容也只另存到 `.conflicts/`，
   * 不动用户的原文件。
   */
  if (!known) {
    log(`本地已有同名笔记，保留原样（不改写）：${relPath}`)
    return { action: 'adopted', path: relPath, cloudFp, localFp, adopted: true }
  }

  // 被 adopt 过的笔记：云端后续更新一律不覆盖本地，只把新版本另存一份供比对
  if (known.adopted === true && cloudFp !== known.cloudFp) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const altPath = `.conflicts/${stamp}__cloud-${(relPath.split('/').pop() || 'note.md')}`
    try {
      await writeNote(root, altPath, rendered, { backup: false })
      log(`云端有新版本，另存为：${altPath}（你的本地版保持不动）`)
    } catch (err) {
      log(`云端新版本另存失败：${err.message}`)
    }
    return { action: 'kept-local', path: relPath, cloudFp, localFp, adopted: true }
  }

  const localChanged = Boolean(known.localFp && localFp !== known.localFp)
  const cloudChanged = Boolean(!known || !known.cloudFp || cloudFp !== known.cloudFp)

  if (!localChanged) {
    // 最常规的路径：本地没动，跟着云端走。
    // 不留 .bak —— 本地内容就是上一轮我们从云端写下去的，没有任何用户编辑会丢；
    // 留了只会让库里堆满看不见的副本。
    await writeNote(root, relPath, rendered, { backup: false })
    return { action: 'pulled', path: relPath, cloudFp, localFp: cloudFp }
  }

  if (localChanged && !cloudChanged) {
    // 只有本地动了：保留本地，状态里记住本地指纹，下轮不再尝试覆盖
    log(`保留本地修改：${relPath}`)
    return { action: 'kept-local', path: relPath, cloudFp, localFp }
  }

  // 两边都动 → 冲突。本地版本另存，正文写云端版，两条都留给人挑
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const conflictPath = `.conflicts/${stamp}__${(relPath.split('/').pop() || 'note.md')}`
  // readNote 返回的是 { content, body, frontmatter, ... }，字段名是 content 不是 text。
  // 之前写成 original.text 会抛「content 必须是字符串」并落进 catch，
  // 于是本地版本**根本没被备份**、正文却照样被云端版覆盖——用户的手工编辑就丢了。
  let backedUp = false
  try {
    const original = await readNote(root, relPath)
    await writeNote(root, conflictPath, original.content, { backup: false })
    backedUp = true
    log(`检测到冲突，本地版本另存：${conflictPath}`)
  } catch (err) {
    log(`冲突版本另存失败：${err.message}`)
  }
  // 备份没成功就绝不覆盖：宁可这一篇留到下轮重试，也不能把用户唯一的副本冲掉。
  if (!backedUp) {
    log(`保留本地原文不动（备份失败，不敢覆盖）：${relPath}`)
    return { action: 'kept-local', path: relPath, cloudFp, localFp }
  }
  // 本地版本已经另存到 .conflicts/ 了，这里不用再留一份 .bak
  await writeNote(root, relPath, rendered, { backup: false })
  return { action: 'conflict', path: relPath, cloudFp, localFp: cloudFp, conflictPath }
}

// ── 本地 → 云端 ─────────────────────────────────────────────────────────────

/**
 * 只同步一篇（云端改完立刻刷本地，不等整轮）。
 *
 * 不能靠「跑一轮增量、只取第一篇」来糊弄：增量扫描是分页的，目标笔记可能在
 * 第五页，实际会把别的笔记也一起覆盖掉。这里直接拉这一篇的详情。
 */
export async function syncSingleNote({ client, root, state, noteId, log = () => {}, index = null, topicNames = {} } = {}) {
  const prev = state && state.notes ? state.notes : {}
  const raw = await client.getNote(noteId)
  if (!raw) throw Object.assign(new Error('云端没有这篇笔记（可能已被删除）'), { status: 404 })
  const note = normalizeNote(raw)
  if (!note) throw Object.assign(new Error('云端返回的笔记解析失败'), { status: 502 })
  const known = prev[noteId]
  const relPath = pathForNote({
    note,
    topicName: topicNameFor(note, topicNames),
    state,
    index: index instanceof Map ? index : await buildIndex(root),
  })
  const archiveDate = new Date().toISOString().slice(0, 10)
  const outcome = await pullNote({ client, root, note, relPath, known, log, archiveDate, topicName: topicNameFor(note, topicNames) })
  const listFp = contentFingerprint({ title: note.title, content: note.original || note.content, tags: note.tags.map((t) => t.name) })
  return {
    path: outcome.path,
    action: outcome.action,
    adopted: outcome.adopted === true,
    note: {
      path: outcome.path,
      listFp,
      cloudFp: outcome.cloudFp,
      localFp: outcome.localFp,
      updatedAt: note.updatedAt,
      syncedAt: new Date().toISOString(),
      ...(outcome.adopted === true ? { adopted: true } : {}),
    },
  }
}

/**
 * 把一篇本地 Markdown 推回云端。
 *
 * 只推「标题 + 正文」，**不推 frontmatter**（那是我们的簿记，不是用户内容），
 * 也去掉我们自己加的文末来源行，免得每推一次就把来源行叠一层。
 */
export async function pushNote({ client, root, relPath, noteId } = {}) {
  // readNote 返回 { content, body, frontmatter, title, ... }，没有 text 字段。
  // 解构成 text 会拿到 undefined，于是正文和 frontmatter 全是空，推上去等于把
  // 用户云端的笔记**清空**——这是最危险的一种静默失败。
  const { content: fileText } = await readNote(root, relPath)
  const { data, body } = parseFrontmatter(fileText)
  const id = noteId || (typeof data.note_id === 'string' ? data.note_id.replace(/^"|"$/g, '') : null)
  const title = (typeof data.title === 'string' ? data.title : firstHeading(body)) || ''
  const content = stripSourceFooter(body)
    // 先吃掉前导空行：body 通常是 `\n# 标题\n\n正文`，不先 trim 开头的话
    // `^#` 匹配不到标题（它在第 2 行），标题会被当成正文一起推上去重复一遍。
    .replace(/^\s+/, '')
    .replace(/^#\s+.+\n+/, '')
    .trim()
  if (content === '') {
    throw Object.assign(new Error('这篇笔记没有正文，不能推到云端（会清空云端内容）'), { status: 400 })
  }

  if (!id) {
    // 本地新建的笔记：当成新笔记推到云端
    const created = await client.createNote({
      title: title || '来自 DSH 的笔记',
      content,
      tags: Array.isArray(data.tags) ? data.tags.map(String).filter((t) => t !== '得到大脑') : undefined,
    })
    return { action: 'created', noteId: created.noteId }
  }
  await client.updateNote({ noteId: id, title: title || undefined, content })
  return { action: 'updated', noteId: id }
}

/** 给同步日志用的时间戳。 */
export function stamp() {
  return new Date().toISOString()
}

export { PAGE_SIZE, MAX_NOTES_PER_RUN, safeDirName }
