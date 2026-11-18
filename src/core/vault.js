/**
 * dsh-getnote — 本地笔记库（host 侧文件层）
 *
 * 这是插件的**本体**：一个普通目录里的普通 Markdown 文件。没有数据库、没有索引
 * 缓存文件、没有私有格式。用户可以随时用 Obsidian / VS Code / 记事本打开、
 * 编辑、移动、删除这些文件，本插件下次扫描就会看到——插件不拥有数据，只读它。
 *
 * 所有对外路径都用 POSIX 分隔符（`a/b/c.md`）的**相对库根**形式，跨平台一致；
 * 落地读写前统一过 resolveInside() 做包含性校验，防止 `../` 逃逸出库根。
 */
import { readdir, readFile, writeFile, rename, mkdir, stat, rm, rmdir, realpath, copyFile } from './vfs.js'
import { randomBytes } from 'node:crypto'
import { basename, dirname, extname, join, posix, relative, resolve, sep } from 'node:path'

const NOTE_EXT = '.md'
const MAX_READ = 2 * 1024 * 1024        // 单篇读取上限 2MB
const MAX_WRITE = 2 * 1024 * 1024       // 单篇写入上限 2MB
const MAX_SCAN = 8000                   // 扫描文件数上限（防病态目录）
const MAX_DEPTH = 8
// 扫描时一律跳过的目录。
// `.conflicts` 是本插件自己的冲突留档：里面的文件带着**同一份 note_id**（是从云端
// 版本复制出来的），如果参与扫描，buildIndex 建的 note_id → 路径 索引就可能指向
// 冲突副本，于是下一轮同步会把云端正文写进留档文件、而不是写进正本。这里排除掉，
// 顺带也让面板的目录树和笔记列表不再把「.conflicts」当成一个正常目录显示。
// `asset` 是笔记的附件目录（录音 mp3、转写 md、图片）。它里面的 `_transcript.md`
// 看起来也是一篇 markdown，于是会被当成独立笔记混进列表——用户点「收到录音卡的
// 首次录音感言」，打开的是那份转写而不是笔记本身，非常迷惑。附件由 listAssets
// 单独读取（它直接读目录，不经过这里），所以排除掉不影响播放。
const IGNORED_DIRS = new Set([
  '.git', 'node_modules', '.obsidian', '.trash', '.conflicts', '.history', '.dsh', '$RECYCLE.BIN',
  '__MACOSX', '.DS_Store', '.venv', 'asset',
])

/** 相对路径转 POSIX 形式（Windows 上反斜杠统一成 /）。 */
export function toPosix(p) {
  return p.split(sep).join('/')
}

/** 库内相对路径钳制：拒绝绝对路径与 `..` 逃逸，返回归一化后的 POSIX 相对路径。 */
export function normalizeRel(input) {
  if (typeof input !== 'string') return ''
  const raw = input.replace(/\\/g, '/').replace(/^\/+/, '')
  const normalized = posix.normalize(raw)
  if (normalized === '.' || normalized === './') return ''
  if (normalized.startsWith('../') || normalized === '..') {
    throw Object.assign(new Error('path escapes vault root'), { status: 400 })
  }
  return normalized
}

/**
 * 把库内相对路径解析成绝对路径，并确认结果仍在库根内。
 * 注意：库根本身必须已经 realpath 过（调用方保证），否则符号链接会绕出去。
 */
export function resolveInside(root, rel, { create = false } = {}) {
  const normalized = normalizeRel(rel)
  const abs = normalized === '' ? resolve(root) : resolve(root, normalized.split('/').join(sep))
  const relCheck = relative(resolve(root), abs)
  if (relCheck.startsWith('..') || (relCheck !== '' && resolve(root, relCheck) !== abs)) {
    throw Object.assign(new Error('path escapes vault root'), { status: 400 })
  }
  return { abs, rel: normalized, create }
}

// ── frontmatter ──────────────────────────────────────────────────────────────

/**
 * 解析 YAML frontmatter 的**有限子集**（本项目归档文件里实际用到的写法）：
 * `key: value`、`key: [a, b]`、缩进续行、引号包裹的字符串。
 *
 * 刻意不引第三方 YAML 库：只要认识自己写出去的那几种形状，外加容忍用户手改，
 * 解析失败就当作没有 frontmatter——正文永远优先，绝不因为头部格式问题拒绝打开。
 */
export function parseFrontmatter(text) {
  const src = typeof text === 'string' ? text : ''
  if (!src.startsWith('---')) return { data: {}, body: src, raw: null }
  const lines = src.split(/\r?\n/)
  let end = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  if (end < 0) return { data: {}, body: src, raw: null }
  const raw = lines.slice(1, end).join('\n')
  const data = {}
  let lastKey = null
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const indented = /^\s+\S/.test(line)
    if (indented && lastKey) {
      // 列表续行：`- item` 或纯文本续行
      const item = line.trim().replace(/^-\s*/, '')
      data[lastKey] = Array.isArray(data[lastKey]) ? [...data[lastKey], unquote(item)] : [data[lastKey], unquote(item)]
      continue
    }
    const m = /^([A-Za-z0-9_\u4e00-\u9fa5.-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    lastKey = m[1]
    const value = m[2].trim()
    if (value === '') {
      data[lastKey] = []
      continue
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      data[lastKey] = value
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter((s) => s !== '')
      continue
    }
    data[lastKey] = unquote(value)
  }
  return { data, body: lines.slice(end + 1).join('\n'), raw }
}

function unquote(s) {
  const t = String(s).trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1)
  }
  return t
}

/** 正文里第一个 `# 标题`，或文件名（去掉日期前缀与扩展名）。 */
export function deriveTitle(body, relPath) {
  const m = /^#{1,3}\s+(.+)$/m.exec(body || '')
  if (m) return m[1].trim()
  const base = posix.basename(relPath || '', NOTE_EXT)
  const stripped = base.replace(/^\d{4}-\d{2}-\d{2}-/, '')
  return stripped || base || '未命名'
}

/** 从文件名/正文推出一个日期（用于排序与分组，取不到就 null）。 */
export function deriveDate(relPath, data, statMs) {
  const base = posix.basename(relPath || '', NOTE_EXT)
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(base)
  if (m) return m[1]
  for (const key of ['归档', '日期', 'date', 'created', '创建时间']) {
    const v = data && data[key]
    const s = Array.isArray(v) ? v[0] : v
    const dm = typeof s === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(s.trim()) : null
    if (dm) return dm[1]
  }
  if (statMs) {
    const d = new Date(statMs)
    if (!Number.isNaN(d.getTime())) {
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }
  }
  return null
}

/** 正文摘录：压掉空行与 Markdown 噪声，取前面一段做列表副标题。 */
export function excerptOf(body, limit = 140) {
  const text = String(body || '')
    .replace(/^---[\s\S]*?\n---\s*\n?/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text
}

// ── 扫描 ─────────────────────────────────────────────────────────────────────

/**
 * 扫描整库，返回扁平条目数组。
 *
 * 一次性读每个文件的头部（frontmatter + 前 2400 字符）来算标题/标签/日期/摘录，
 * 不建任何持久索引：笔记数量在几千级以内时够快，而且永远不会出现「索引和文件
 * 不一致」这种最让人焦虑的问题——文件就是唯一真相。
 */
export async function scanVault(root) {
  const entries = []
  const errors = []
  let truncated = false

  async function walk(dir, relDir, depth) {
    if (depth > MAX_DEPTH || truncated) return
    let dirents
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      errors.push({ path: relDir || '.', message: String(error && error.message ? error.message : error) })
      return
    }
    for (const dirent of dirents) {
      if (entries.length >= MAX_SCAN) {
        truncated = true
        return
      }
      const name = dirent.name
      if (dirent.isDirectory()) {
        if (IGNORED_DIRS.has(name)) continue
        await walk(join(dir, name), relDir === '' ? name : `${relDir}/${name}`, depth + 1)
        continue
      }
      if (!dirent.isFile()) continue
      if (extname(name).toLowerCase() !== NOTE_EXT) continue
      const rel = relDir === '' ? name : `${relDir}/${name}`
      const abs = join(dir, name)
      try {
        const st = await stat(abs)
        if (st.size > MAX_READ) {
          errors.push({ path: rel, message: `文件超过 ${Math.round(MAX_READ / 1024 / 1024)}MB，已跳过` })
          continue
        }
        const text = await readFile(abs, 'utf8')
        const { data, body } = parseFrontmatter(text)
        entries.push({
          path: rel,
          name,
          dir: relDir,
          title: deriveTitle(body, rel),
          date: deriveDate(rel, data, st.mtimeMs),
          tags: normalizeTags(data.tags),
          noteId: data.note_id ? String(data.note_id) : null,
          noteUrl: data.note_url ? String(data.note_url) : null,
          bytes: st.size,
          mtimeMs: st.mtimeMs,
          excerpt: excerptOf(body),
        })
      } catch (error) {
        errors.push({ path: rel, message: String(error && error.message ? error.message : error) })
      }
    }
  }

  await walk(root, '', 0)
  entries.sort((a, b) => {
    const da = a.date || ''
    const db = b.date || ''
    if (da !== db) return db.localeCompare(da)
    return b.mtimeMs - a.mtimeMs
  })
  return { entries, errors, truncated }
}

/** 由扁平条目建目录树（只含真正有笔记的目录，空目录不显示）。 */
export function buildTree(entries) {
  const root = { name: '', path: '', kind: 'dir', children: [], count: 0 }
  const dirMap = new Map([['', root]])
  for (const entry of entries) {
    const segments = entry.path.split('/').slice(0, -1)
    let cursor = root
    let acc = ''
    for (const segment of segments) {
      acc = acc === '' ? segment : `${acc}/${segment}`
      let node = dirMap.get(acc)
      if (!node) {
        node = { name: segment, path: acc, kind: 'dir', children: [], count: 0 }
        dirMap.set(acc, node)
        cursor.children.push(node)
      }
      cursor = node
    }
    cursor.children.push({ name: entry.name, path: entry.path, kind: 'file', entry })
  }
  // 统计每个目录（含子孙）的笔记数，并把目录排前面、同类按名称排
  const countAll = (node) => {
    let n = 0
    for (const child of node.children) {
      if (child.kind === 'file') n += 1
      else n += countAll(child)
    }
    node.count = n
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      if (a.kind === 'dir') return a.name.localeCompare(b.name, 'zh')
      const da = (a.entry && a.entry.date) || ''
      const db = (b.entry && b.entry.date) || ''
      if (da !== db) return db.localeCompare(da)
      return a.name.localeCompare(b.name, 'zh')
    })
    return n
  }
  countAll(root)
  return root
}

// ── 读写 ─────────────────────────────────────────────────────────────────────

export async function readNote(root, rel) {
  const { abs, rel: normalized } = resolveInside(root, rel)
  if (!normalized.toLowerCase().endsWith(NOTE_EXT)) {
    throw Object.assign(new Error('只能读取 .md 文件'), { status: 400 })
  }
  const st = await stat(abs)
  if (!st.isFile()) throw Object.assign(new Error('不是文件'), { status: 400 })
  if (st.size > MAX_READ) throw Object.assign(new Error('文件过大'), { status: 413 })
  const content = await readFile(abs, 'utf8')
  const { data, body } = parseFrontmatter(content)
  return {
    path: normalized,
    content,
    body,
    frontmatter: data,
    title: deriveTitle(body, normalized),
    tags: normalizeTags(data.tags),
    bytes: st.size,
    mtimeMs: st.mtimeMs,
    readOnly: false,
  }
}

/**
 * 找一篇笔记自己的附件（录音 mp3 / 转写 md / 图片）。
 *
 * 约定是 `<笔记所在目录>/asset/<笔记文件名主干>_<note_id>_audio.mp3` 这种形状——
 * 这是 Obsidian 端插件留下的命名，合并两套体系时原样搬进来的，所以不能改。
 * 除了「主干 + note_id」精确匹配，还认「只带 note_id」的形式，因为 note_id 是唯一键，
 * 用户手动改名后主干会变但 note_id 不变。
 *
 * 找不到就返回空数组：大多数笔记本来就没有附件，这不是错误。
 */
export async function listAssets(root, rel, noteId = '') {
  const { abs, rel: normalized } = resolveInside(root, rel)
  const dir = posix.dirname(normalized)
  const stem = posix.basename(normalized, NOTE_EXT)
  const assetRel = dir === '.' || dir === '' ? 'asset' : `${dir}/asset`
  const assetAbs = resolveInside(root, assetRel).abs
  let names
  try {
    names = await readdir(assetAbs)
  } catch {
    return []
  }
  // 归属判断，三条路任一命中即算这篇的附件：
  //   1. 文件名以笔记主干开头；
  //   2. 以去掉 `YYYY-MM-DD-` 日期前缀的标题开头（本插件写笔记会加日期前缀，
  //      而附件名是 Obsidian 端插件按「标题_note_id_audio.mp3」生成的）；
  //   3. 文件名里含这篇笔记的 note_id —— 标题被用户改过时（实测就有：本地标题
  //      与云端标题并不相同）前两条都对不上，只有 note_id 是稳的。
  const candidates = []
  if (stem !== '') candidates.push(stem)
  const undated = stem.replace(/^\d{4}-\d{2}-\d{2}-/, '')
  if (undated !== '' && undated !== stem) candidates.push(undated)
  const id = String(noteId || '').trim()
  const out = []
  for (const name of names) {
    if (name.endsWith('.bak')) continue
    const lower = name.toLowerCase()
    const isAudio = /\.(mp3|ogg|m4a|wav|aac|flac)$/.test(lower)
    const isTranscript = lower.endsWith('.md')
    const isImage = /\.(png|jpe?g|gif|webp)$/.test(lower)
    if (!isAudio && !isTranscript && !isImage) continue
    const owned = candidates.some((prefix) => name.startsWith(prefix)) || (id !== '' && name.includes(id))
    if (!owned) continue
    const relPath = `${assetRel}/${name}`
    try {
      const st = await stat(resolveInside(root, relPath).abs)
      if (!st.isFile()) continue
      out.push({
        name,
        path: relPath,
        bytes: st.size,
        mtimeMs: st.mtimeMs,
        kind: isAudio ? 'audio' : isTranscript ? 'transcript' : 'image',
      })
    } catch {
      // 读到一半被删：跳过
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return out
}

/**
 * 保存笔记：内容整篇覆盖（面板是全量编辑，不走行级 diff）。
 *
 * `options.backup` 默认 true。同步镜像云端内容时要传 false：那时本地文件本来就
 * 没被用户动过（指纹一致），留 .bak 只会让库里堆满看不见的副本；而用户在面板里
 * 手动改完保存时必须留，否则一次误操作就找不回来了。
 */
export async function writeNote(root, rel, content, options = {}) {
  const backup = options.backup !== false
  const { abs, rel: normalized } = resolveInside(root, rel)
  if (!normalized.toLowerCase().endsWith(NOTE_EXT)) {
    throw Object.assign(new Error('只能写入 .md 文件'), { status: 400 })
  }
  if (typeof content !== 'string') throw Object.assign(new Error('content 必须是字符串'), { status: 400 })
  if (Buffer.byteLength(content, 'utf8') > MAX_WRITE) {
    throw Object.assign(new Error('内容超过 2MB 上限'), { status: 413 })
  }
  await mkdir(dirname(abs), { recursive: true })
  if (backup) {
    // 原文件存在时保留一份 .bak（一次就够，避免用户误覆盖后无法回退）
    try {
      await copyFile(abs, `${abs}.bak`)
    } catch {
      // 新文件：没有可备份的内容
    }
  }
  // 临时文件名带随机后缀：同一进程里两个请求同时保存同一篇时，
  // 只用 pid 会让它们抢同一个 tmp 路径，后写的把先写的截断，落盘内容半新半旧。
  const tmp = `${abs}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, abs)
  const st = await stat(abs)
  return { path: normalized, bytes: st.size, mtimeMs: st.mtimeMs }
}

/** 文件名清洗：去掉 Windows 非法字符、压缩空白、限长；保留中文。 */
export function safeFilename(title, fallback = '未命名') {
  const cleaned = String(title || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
  return cleaned === '' ? fallback : cleaned
}

/**
 * 新建笔记。默认文件名 `YYYY-MM-DD-<标题>.md`，与用户已有归档库的命名约定一致
 * （这样本插件建的笔记和他手写的归档混在同一个目录里也不会显得突兀）。
 */
export async function createNote(root, { dir = '', title = '', content = '', date, withDatePrefix = true } = {}) {
  const safeDir = normalizeRel(dir)
  const pad = (n) => String(n).padStart(2, '0')
  const now = new Date()
  const day = date || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const baseName = safeFilename(title)
  const fileName = `${withDatePrefix ? `${day}-` : ''}${baseName}${NOTE_EXT}`
  const rel = safeDir === '' ? fileName : `${safeDir}/${fileName}`

  // 同名冲突：追加 -2 / -3，绝不覆盖用户已有笔记
  let candidate = rel
  let counter = 2
  for (;;) {
    const { abs } = resolveInside(root, candidate)
    try {
      await stat(abs)
      const stem = candidate.slice(0, -NOTE_EXT.length)
      candidate = `${stem}-${counter}${NOTE_EXT}`
      counter += 1
      if (counter > 99) throw Object.assign(new Error('同名笔记过多'), { status: 409 })
    } catch (error) {
      if (error && error.status === 409) throw error
      break
    }
  }

  const body = content !== '' ? content : `# ${baseName}\n\n`
  await writeNote(root, candidate, body)
  return { path: candidate }
}

/** 删除笔记：移进库内 `.trash/`（可恢复），不真删。 */
export async function trashNote(root, rel) {
  const { abs, rel: normalized } = resolveInside(root, rel)
  if (normalized === '') throw Object.assign(new Error('不能删除库根'), { status: 400 })
  const trashDir = join(root, '.trash')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(trashDir, `${stamp}__${basename(abs)}`)
  await mkdir(trashDir, { recursive: true })
  await rename(abs, target)
  return { path: normalized, trashedTo: toPosix(relative(root, target)) }
}

// ── 回收站 ───────────────────────────────────────────────────────────────────
//
// 回收站就是一个普通目录 `.trash/`，文件名是 `<ISO时间戳>__<原文件名>`。
// 用文件名而不是一个索引文件来记「原来在哪」，是因为这里还有个更重要的事实：
// **用户可能在 Obsidian 里直接把这些文件拖回去**。索引文件会和现实脱节，
// 文件名不会。所以恢复时以文件名里的时间戳和名字为准，原目录尽力推断。

const TRASH_DIR = '.trash'
const TRASH_NAME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z__(.+)$/

/** 从 `.trash/xxx__name.md` 里拆出删除时间与原始文件名。 */
export function parseTrashName(name) {
  const m = TRASH_NAME_RE.exec(String(name || ''))
  if (m === null) return { trashedAt: null, originalName: String(name || '') }
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`
  const at = Date.parse(iso)
  return {
    trashedAt: Number.isNaN(at) ? null : new Date(at).toISOString(),
    originalName: m[6],
  }
}

/**
 * 列出回收站里的笔记（按删除时间倒序，最新的在最前）。
 *
 * 只收 `.md`：回收站里也可能有用户自己丢进去的图片或附件，那些不是「可恢复的笔记」，
 * 列出来只会让人困惑。恢复按钮只对笔记有意义。
 */
export async function listTrash(root) {
  const trashDir = join(root, TRASH_DIR)
  let dirents
  try {
    dirents = await readdir(trashDir, { withFileTypes: true })
  } catch {
    return []
  }
  const items = []
  for (const dirent of dirents) {
    if (!dirent.isFile()) continue
    if (extname(dirent.name).toLowerCase() !== NOTE_EXT) continue
    const abs = join(trashDir, dirent.name)
    let st
    try {
      st = await stat(abs)
    } catch {
      continue
    }
    const meta = parseTrashName(dirent.name)
    items.push({
      name: dirent.name,
      path: toPosix(join(TRASH_DIR, dirent.name)),
      originalName: meta.originalName,
      title: meta.originalName.replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''),
      trashedAt: meta.trashedAt,
      bytes: st.size,
      mtimeMs: st.mtimeMs,
    })
  }
  items.sort((a, b) => {
    const ta = a.trashedAt === null ? 0 : Date.parse(a.trashedAt)
    const tb = b.trashedAt === null ? 0 : Date.parse(b.trashedAt)
    return tb - ta
  })
  return items
}

/**
 * 从回收站恢复一篇笔记。
 *
 * `targetRel` 不给时恢复到库根——因为文件名里只留了原文件名、没留原目录。想让用户
 * 选目录时，调用方把目标路径传进来即可。
 *
 * 目标已存在时**不覆盖**，而是加 `-2`/`-3` 后缀：恢复这个动作本身是在救文件，
 * 为了救它而毁掉另一个同名文件是说不通的。
 */
export async function restoreNote(root, trashPath, targetRel) {
  const { abs: absTrash, rel: trashRel } = resolveInside(root, trashPath)
  if (!trashRel.startsWith(`${TRASH_DIR}/`)) {
    throw Object.assign(new Error('只能从 .trash 目录恢复'), { status: 400 })
  }
  let st
  try {
    st = await stat(absTrash)
  } catch {
    throw Object.assign(new Error('回收站里没有这个文件'), { status: 404 })
  }
  if (!st.isFile()) throw Object.assign(new Error('不是文件'), { status: 400 })

  const meta = parseTrashName(basename(absTrash))
  const wanted = typeof targetRel === 'string' && targetRel.trim() !== ''
    ? normalizeRel(targetRel.trim())
    : ''
  const rel = wanted === '' ? meta.originalName : wanted
  if (rel === '' || rel.endsWith('/')) {
    throw Object.assign(new Error('目标路径不能为空'), { status: 400 })
  }
  const { abs: absTarget } = resolveInside(root, rel, { create: true })

  // 同名冲突时加后缀，绝不覆盖
  let candidate = rel
  let counter = 1
  for (;;) {
    try {
      await stat(resolveInside(root, candidate).abs)
      counter += 1
      if (counter > 99) throw Object.assign(new Error('同名笔记过多'), { status: 409 })
      const dir = posix.dirname(rel)
      const stem = basename(rel, extname(rel))
      const ext = extname(rel)
      const next = `${stem}-${counter}${ext}`
      candidate = dir === '.' || dir === '' ? next : posix.join(dir, next)
    } catch (error) {
      if (error && error.status === 409) throw error
      break
    }
  }

  const { abs: absFinal } = resolveInside(root, candidate, { create: true })
  await mkdir(dirname(absFinal), { recursive: true })
  await rename(absTrash, absFinal)
  return { path: candidate, restoredFrom: trashRel, title: meta.originalName }
}

/** 清空回收站（真删）。默认只在用户明确要求时调用。 */
export async function purgeTrash(root, trashPath) {
  const trashDir = join(root, TRASH_DIR)
  if (typeof trashPath === 'string' && trashPath.trim() !== '') {
    const { abs, rel } = resolveInside(root, trashPath)
    if (!rel.startsWith(`${TRASH_DIR}/`)) {
      throw Object.assign(new Error('只能清空 .trash 里的文件'), { status: 400 })
    }
    await rm(abs, { force: true })
    return { purged: [rel] }
  }
  let dirents
  try {
    dirents = await readdir(trashDir, { withFileTypes: true })
  } catch {
    return { purged: [] }
  }
  const purged = []
  for (const dirent of dirents) {
    if (!dirent.isFile()) continue
    await rm(join(trashDir, dirent.name), { force: true })
    purged.push(toPosix(join(TRASH_DIR, dirent.name)))
  }
  return { purged }
}

// ── 搜索 ─────────────────────────────────────────────────────────────────────

/**
 * 全库全文搜索（大小写不敏感的子串匹配，逐行给上下文）。
 *
 * 为什么不用正则/分词：这是给自己笔记用的，用户输入的往往就是一个词、一个人名。
 * 把输入当纯文本处理，避免 `(`、`[` 之类符号把搜索搞崩是最重要的。
 */
/**
 * 把「tag:xxx dir:yyy 正文关键词」这种查询串拆成结构化条件。
 *
 * 为什么要在服务端拆而不是让前端拆：面板的搜索框只有一行，用户会直接
 * 把限定词和关键词混在一起敲（「tag:录音卡 会议」）。拆解规则放在这里，
 * 前端就只是一个把整串原样传过来的输入框，不必在两边各维护一份语法。
 *
 * 认得的限定词：
 *   tag:xxx / #xxx  → 按 frontmatter tags 过滤（支持多个，全部命中才算）
 *   dir:xxx         → 路径前缀过滤（不区分大小写）
 * 其余词就是正文关键词，空格分隔的多个关键词要**全部**命中。
 */
export function parseSearchQuery(input) {
  const raw = String(input || '').trim()
  const tags = []
  const dirs = []
  const terms = []
  // 用正则整体扫描而不是 split(' ')：`dir:随手记` 里如果目录名本身带空格
  // （用户的库确实有这种），用空格切会把目录名截断成两半。
  const re = /(?:^|\s)(tag|dir):("[^"]*"|\S+)/gi
  let rest = raw
  let m
  while ((m = re.exec(raw)) !== null) {
    const kind = m[1].toLowerCase()
    const value = m[2].replace(/^"|"$/g, '').trim()
    if (value === '') continue
    if (kind === 'tag') tags.push(value)
    else dirs.push(value)
  }
  rest = rest.replace(re, ' ')
  // 裸 #标签 也当 tag: 处理——写笔记的人习惯直接敲 #录音卡
  rest = rest.replace(/(?:^|\s)#([^\s#]+)/g, (_, name) => {
    tags.push(name)
    return ' '
  })
  for (const token of rest.split(/\s+/)) {
    if (token !== '') terms.push(token)
  }
  return { raw, tags, dirs, terms }
}

export async function searchNotes(root, query, { limit = 60, perFile = 3, sort = 'relevance' } = {}) {
  const parsed = parseSearchQuery(query)
  if (parsed.tags.length === 0 && parsed.dirs.length === 0 && parsed.terms.length === 0) {
    return { query: parsed.raw, parsed, hits: [], scanned: 0, truncated: false }
  }
  const needles = parsed.terms.map((t) => t.toLowerCase())
  const tagNeedles = parsed.tags.map((t) => t.toLowerCase())
  const dirNeedles = parsed.dirs.map((d) => d.toLowerCase().replace(/^\.?\//, ''))
  const hits = []
  let scanned = 0
  let truncated = false

  async function walk(dir, relDir, depth) {
    if (depth > MAX_DEPTH || truncated) return
    let dirents
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const dirent of dirents) {
      if (hits.length >= limit) {
        truncated = true
        return
      }
      const name = dirent.name
      if (dirent.isDirectory()) {
        if (IGNORED_DIRS.has(name) || name === '.trash') continue
        await walk(join(dir, name), relDir === '' ? name : `${relDir}/${name}`, depth + 1)
        continue
      }
      if (!dirent.isFile() || extname(name).toLowerCase() !== NOTE_EXT) continue
      const rel = relDir === '' ? name : `${relDir}/${name}`
      // dir: 过滤放在读文件之前：命中不了目录就没必要把整篇读进内存。
      if (dirNeedles.length > 0) {
        const relLower = rel.toLowerCase()
        let dirOk = false
        for (const d of dirNeedles) {
          if (relLower.startsWith(`${d}/`) || relLower.includes(`/${d}/`)) {
            dirOk = true
            break
          }
        }
        if (!dirOk) continue
      }
      scanned += 1
      let text
      try {
        text = await readFile(join(dir, name), 'utf8')
      } catch {
        continue
      }
      const { data, body } = parseFrontmatter(text)
      const fileTags = normalizeTags(data.tags).map((t) => t.toLowerCase())
      if (tagNeedles.length > 0) {
        let tagOk = true
        for (const want of tagNeedles) {
          if (!fileTags.some((t) => t === want || t.includes(want))) {
            tagOk = false
            break
          }
        }
        if (!tagOk) continue
      }
      const lines = text.split(/\r?\n/)
      const matches = []
      let matchCount = 0
      // 多关键词取交集：任何一个词没出现就整篇不算命中，否则
      // 「会议 录音」会退化成「会议 或 录音」，结果反而更吵。
      const seen = new Set()
      for (let i = 0; i < lines.length; i += 1) {
        const lower = lines[i].toLowerCase()
        let lineHit = false
        for (let n = 0; n < needles.length; n += 1) {
          if (lower.includes(needles[n])) {
            lineHit = true
            if (!seen.has(n)) seen.add(n)
          }
        }
        if (!lineHit) continue
        matchCount += 1
        if (matches.length < perFile) {
          matches.push({ line: i + 1, text: lines[i].trim().slice(0, 240) })
        }
      }
      const titleHit = needles.length > 0 && needles.every((n) => name.toLowerCase().includes(n))
      // 标题命中也要算进「这个词出现过」：只写「全部词都在正文出现过」的话，
      // 一篇只有标题含关键词的笔记永远搜不出来——用户明明看得见那个标题。
      if (titleHit) {
        for (let n = 0; n < needles.length; n += 1) seen.add(n)
      }
      const allTermsFound = needles.length === 0 || seen.size === needles.length
      if (!allTermsFound) continue
      if (matches.length === 0 && !titleHit && needles.length > 0) continue
      const title = deriveTitle(body, rel)
      hits.push({
        path: rel,
        title,
        date: deriveDate(rel, data, null),
        tags: normalizeTags(data.tags),
        matches,
        titleHit,
        matchCount,
      })
    }
  }

  await walk(root, '', 0)
  // 按命中密度排序：正文里被提到 20 次的那篇，比只在标题里蹭到一次的更该排前面。
  // 标题命中给一点加权，但不足以压过高密度正文。
  if (sort !== 'path') {
    hits.sort((a, b) => {
      const score = (h) => h.matchCount + (h.titleHit ? 3 : 0)
      const diff = score(b) - score(a)
      if (diff !== 0) return diff
      return a.path.localeCompare(b.path, 'zh')
    })
  }
  return { query: parsed.raw, parsed, hits, scanned, truncated }
}

/**
 * 从 Markdown 里抽出所有 Outgoing 双链目标（`[[目标]]` / `[[目标|别名]]`）。
 * 嵌入（`![[图.png]]`）也算链接——用户在实践中很需要知道「哪篇笔记引用了这张图」。
 */
export function extractWikiLinks(text) {
  const out = new Set()
  const src = String(text || '')
  const re = /\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g
  let m
  while ((m = re.exec(src)) !== null) {
    const target = m[1].trim()
    if (target !== '') out.add(target)
  }
  return [...out]
}

/**
 * 反查：哪些笔记引用了 `target`。
 *
 * 匹配刻意做得宽松——双链不像文件路径那样严格，Obsidian 里 `[[我的笔记]]`
 * 和 `[[随手记/我的笔记]]`、`[[我的笔记.md]]` 都被认为是同一篇。所以依次
 * 比对「完整路径相等 → 路径去扩展名相等 → 文件名去扩展名相等 → 标题相等」，
 * 只要命中任一层就算。松一点会多出几条弱关联，紧一点会让用户明明写了双链
 * 却查不到，两者相比后者更让人困惑。
 */
export async function findBacklinks(root, target, entries) {
  const raw = String(target || '').trim().replace(/\\/g, '/')
  if (raw === '') return { target: raw, hits: [] }
  const stripExt = (p) => p.replace(/\.md$/i, '')
  const rawNoExt = stripExt(raw)
  const rawBase = stripExt(raw.split('/').pop() || raw)
  const rawLower = raw.toLowerCase()
  const baseLower = rawBase.toLowerCase()

  const list = Array.isArray(entries) ? entries : (await scanVault(root)).entries
  // 目标可能是一个不带路径的短名，先算出所有可能指向它的路径集合。
  const wantedPaths = new Set()
  for (const entry of list) {
    const noExt = stripExt(entry.path)
    const base = stripExt(entry.path.split('/').pop() || entry.path)
    const title = String(entry.title || '').toLowerCase()
    if (
      noExt.toLowerCase() === rawNoExt.toLowerCase() ||
      base.toLowerCase() === baseLower ||
      title === rawLower ||
      title === baseLower
    ) {
      wantedPaths.add(entry.path)
      wantedPaths.add(noExt)
      wantedPaths.add(base)
    }
  }
  // 用户给的就是完整路径时也加进去，避免「目标还不存在于库里」时一条都查不到。
  wantedPaths.add(raw)
  wantedPaths.add(rawNoExt)
  wantedPaths.add(rawBase)
  const wantedLower = new Set([...wantedPaths].map((p) => p.toLowerCase()))

  const hits = []
  for (const entry of list) {
    if (entry.path === raw) continue
    let text
    try {
      text = await readFile(resolveInside(root, entry.path).abs, 'utf8')
    } catch {
      continue
    }
    const links = extractWikiLinks(text)
    const matched = links.filter((link) => {
      const noExt = stripExt(link)
      const base = stripExt(link.split('/').pop() || link)
      return wantedLower.has(link.toLowerCase()) || wantedLower.has(noExt.toLowerCase()) || wantedLower.has(base.toLowerCase())
    })
    if (matched.length === 0) continue
    hits.push({
      path: entry.path,
      title: entry.title,
      date: entry.date,
      links: matched,
    })
  }
  hits.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  return { target: raw, hits }
}

/**
 * 抽 Markdown 大纲（标题树），供阅读区旁的大纲导航用。
 *
 * 跳过代码围栏里的 `#`——逐字稿那种围栏里经常有以 # 开头的行，
 * 把它们当标题列进大纲会冒出一堆点不动的假条目。
 */
export function outlineOf(body) {
  const lines = String(body || '').split(/\r?\n/)
  const items = []
  let inFence = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m === null) continue
    const level = m[1].length
    const text = m[2].trim()
    if (text === '') continue
    items.push({ level, text, line: i + 1 })
  }
  return items
}

const CONFLICT_DIR = '.conflicts'

/**
 * 冲突留档的文件名有两种历史格式：
 *   `YYYY-MM-DDTHH-MM-SS-SSSZ__cloud-<原名>`  ← 同步引擎写的（带毫秒）
 *   `YYYY-MM-DDTHH-MM-SS__cloud-<原名>`      ← 早期手工留档留下的（不带毫秒）
 * 一定要都认，否则旧留档会整片变成「解析不出时间」的哑条目，用户看到一片
 * 空白的时间列，会以为是文件坏了。
 */
const CONFLICT_NAME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z?__(?:cloud-)?(.+)$/

/**
 * 已处理冲突的记录文件。
 *
 * 为什么需要它：采纳之后**留档不删**（删了就再也没法反悔，而「改主意」是这个
 * 功能最正常的用法）。于是 `.conflicts/` 里的文件数永远不减，面板角标上的数字
 * 就永远下不去——用户处理完一条看到数字没动，会以为点击根本没生效。
 *
 * 所以「是否已处理」不能靠文件在不在判断，得单独记。放在 `.conflicts/` 里而不是
 * `$DSH_HOME`，是为了整库 zip 导出时这份状态跟着走：换台机器恢复库，处理过的
 * 冲突仍然显示为已处理，不会又冒出一堆要重新确认的角标。
 */
const CONFLICT_STATE_FILE = '.resolved.json'

async function readConflictState(root) {
  try {
    const text = await readFile(join(root, CONFLICT_DIR, CONFLICT_STATE_FILE), 'utf8')
    const data = JSON.parse(text)
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return {}
    return data
  } catch {
    // 文件不存在、JSON 坏了都当成「全都还没处理」——宁可多显示几条待办，
    // 也不能因为一个状态文件读不出来就把待处理的冲突藏起来。
    return {}
  }
}

async function writeConflictState(root, state) {
  const dir = join(root, CONFLICT_DIR)
  await mkdir(dir, { recursive: true })
  const target = join(dir, CONFLICT_STATE_FILE)
  // 同样带随机后缀：两个请求同时处理不同冲突时都写这个状态文件，
  // 共用 `${target}.tmp` 会互相截断，落盘变成半截 JSON 直接读不出来。
  const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
  await rename(tmp, target)
}

function parseConflictName(name) {
  const m = CONFLICT_NAME_RE.exec(name)
  if (m === null) return { savedAt: null, originalName: name, cloudMarked: false }
  const ms = m[5] === undefined ? '000' : m[5]
  // 文件名里带 `cloud-` 前缀的留档，装的是**云端版**；不带的是**本地版**。
  // 两种在历史里都真实存在（同步引擎只写本地版，早期手工抢救时存过云端版），
  // 所以解析时必须把这一位带出来，否则「哪边是本地」就会看反。
  const cloudMarked = /__cloud-/.test(name)
  return { savedAt: `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${ms}Z`, originalName: m[6], cloudMarked }
}

/**
 * 列出冲突留档。
 *
 * 留档装的是哪一边看文件名：不带 `cloud-` 前缀的是**用户本地版**（同步引擎覆盖
 * 前另存的），带 `cloud-` 前缀的是**云端版**（早期手工抢救副本）。每种留档在
 * `listConflicts` 里都带 `archiveIsCloud`，面板据此决定左右两列各自取哪边。
 */
export async function listConflicts(root) {
  const dir = join(root, CONFLICT_DIR)
  let names
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const state = await readConflictState(root)
  const items = []
  for (const name of names) {
    if (extname(name).toLowerCase() !== NOTE_EXT) continue
    if (name.endsWith('.bak')) continue
    let st
    try {
      st = await stat(join(dir, name))
    } catch {
      continue
    }
    if (!st.isFile()) continue
    const parsed = parseConflictName(name)
    // resolved 决定它出现在「未处理」还是「已处理」区。keepLocal 记下用户当初
    // 采纳了哪一边，下次打开时那个按钮仍是填充态——不然用户会怀疑自己到底
    // 选过没有。
    const mark = state[name]
    items.push({
      name,
      path: `${CONFLICT_DIR}/${name}`,
      originalName: parsed.originalName,
      savedAt: parsed.savedAt,
      archiveIsCloud: parsed.cloudMarked === true,
      bytes: st.size,
      mtimeMs: st.mtimeMs,
      resolved: mark !== undefined && mark !== null,
      resolvedAt: mark !== undefined && mark !== null ? mark.at || null : null,
      keptLocal: mark !== undefined && mark !== null ? mark.keepLocal === true : null,
    })
  }
  items.sort((a, b) => {
    const av = a.savedAt || new Date(a.mtimeMs).toISOString()
    const bv = b.savedAt || new Date(b.mtimeMs).toISOString()
    return bv.localeCompare(av)
  })
  return items
}

/**
 * 读一份冲突留档，并**猜它对应库里哪一篇正本**。
 *
 * 猜的思路：留档名尾巴（`cloud-` 之后）就是原文件名，先去同名位置找；
 * 找不到就按「文件名相同但不在 .conflicts 里」全库找。猜错的代价只是
 * 面板默认选错目标，用户还能手动改，所以宁可给出一个候选也不要留空。
 */
export async function readConflict(root, conflictPath) {
  const rel = normalizeRel(conflictPath)
  if (!rel.startsWith(`${CONFLICT_DIR}/`)) {
    throw Object.assign(new Error('不是冲突留档路径'), { status: 400 })
  }
  const { abs } = resolveInside(root, rel)
  const text = await readFile(abs, 'utf8')
  const base = rel.slice(CONFLICT_DIR.length + 1)
  const parsed = parseConflictName(base)
  const { data, body } = parseFrontmatter(text)
  const { entries } = await scanVault(root)
  const candidates = entries.filter((e) => {
    const name = e.path.split('/').pop() || e.path
    return name === parsed.originalName
  })
  const state = await readConflictState(root)
  const mark = state[base]
  return {
    path: rel,
    originalName: parsed.originalName,
    content: text,
    body,
    frontmatter: data,
    savedAt: parsed.savedAt,
    // 这份留档里装的是哪一边：true = 云端版（文件名带 cloud- 前缀的旧留档），false = 本地版。
    // 面板和 resolveConflict 都必须按这一位决定「本地版/云端版」各自去哪，
    // 而不是假定「留档一定是本地版」——历史里两种都真实存在过。
    archiveIsCloud: parsed.cloudMarked === true,
    candidates: candidates.map((e) => ({ path: e.path, title: e.title, noteId: e.noteId || '' })),
    resolved: mark !== undefined && mark !== null,
    resolvedAt: mark !== undefined && mark !== null ? mark.at || null : null,
    keptLocal: mark !== undefined && mark !== null ? mark.keepLocal === true : null,
  }
}

/**
 * 把一份冲突留档「采纳」成正本。
 *
 * 关键前提：**留档里装的是哪一边，由文件名决定，不能假定**。
 *   · `<stamp>__<原名>`            → 装的是**用户本地版**（同步引擎覆盖前另存的）
 *   · `<stamp>__cloud-<原名>`      → 装的是**云端版**（早期手工抢救被覆盖的云端副本时存的）
 * 两种情况在真实库里都存在，`readConflict` 用 `archiveIsCloud` 把这一位带出来。
 *
 * 于是「本地版」和「云端版」两份内容分别是：
 *   本地版 = archiveIsCloud ? 正本当前内容 : 留档内容
 *   云端版 = archiveIsCloud ? 留档内容 : 正本当前内容
 *
 * `keepLocal`：
 *   true  → 「用我的本地版」：把本地版写回正本（云端版那份先进版本历史）
 *   false → 「用云端版」：把云端版写回正本（本地版那份先进版本历史）
 * 两种都**不删留档**，之后统一由用户清，删了就没法反悔。
 *
 * 曾经这里有两次错：先是两个分支写反（点「用我的本地版」反而把云端版留在正本，
 * 手写内容被丢）；再是假定「留档一定是本地版」，遇到 `cloud-` 前缀的旧留档又会反向。
 * 现在两边都由 archiveIsCloud 决定，并有测试双向锁死。
 */
export async function resolveConflict(root, conflictPath, { keepLocal = false, snapshot = null } = {}) {
  const detail = await readConflict(root, conflictPath)
  const target = detail.candidates.length > 0 ? detail.candidates[0].path : detail.originalName
  // 处理完就记一笔：留档仍然留着（能反悔），但面板据此把它归到「已处理」，
  // 角标数字跟着减。这一步要在真正动手之前写，否则下面写文件抛错时用户会
  // 看到「点了没反应、数字也不动」，比报错更让人困惑。
  const base = detail.path.slice(CONFLICT_DIR.length + 1)
  const state = await readConflictState(root)
  state[base] = { at: new Date().toISOString(), keepLocal: keepLocal === true }
  await writeConflictState(root, state)

  // 只有留档这一侧的边可能存在；正本那一侧必须真的读到文件才知道内容。
  let liveContent = null
  if (detail.candidates.length > 0) {
    try {
      const live = await readNote(root, target)
      liveContent = live.content
    } catch {
      liveContent = null
    }
  }
  const archiveIsCloud = detail.archiveIsCloud === true
  const localContent = archiveIsCloud ? liveContent : detail.content
  const cloudContent = archiveIsCloud ? detail.content : liveContent
  const wanted = keepLocal === true ? localContent : cloudContent

  // 想要的那一边拿不到（例如正本已被删除，而留档存的是本地版，云端版就无从取回），
  // 就如实报错。拿另一边硬顶上等于把用户的内容伪装成另一版，比失败更糟。
  if (wanted === null) {
    throw Object.assign(
      new Error(
        keepLocal === true
          ? '找不到这条冲突对应的正本笔记，取不到本地版内容；留档仍然保留，可以直接打开对照'
          : '这条留档里没有云端版正文，取不到云端版本；留档仍然保留，可以直接打开对照',
      ),
      { status: 404 },
    )
  }

  // 写回正本前，把正本当前内容存进版本历史，两份内容都不会凭空消失。
  if (typeof snapshot === 'function' && liveContent !== null) {
    await snapshot(target)
  }
  await writeNote(root, target, wanted, { backup: false })
  return {
    action: keepLocal === true ? 'kept-local' : 'took-cloud',
    path: target,
    from: detail.path,
    keepLocal: keepLocal === true,
    archiveIsCloud,
  }
}

/**
 * 把一条冲突退回「未处理」。
 *
 * 用途：用户采纳完又改主意，或者只是想重新看一遍。不提供这个的话，一次误点
 * 就把这条永久归档进折叠区，只能去文件系统里删状态文件才能恢复。
 */
export async function unresolveConflict(root, conflictPath) {
  const rel = normalizeRel(conflictPath)
  if (!rel.startsWith(`${CONFLICT_DIR}/`)) {
    throw Object.assign(new Error('不是冲突留档路径'), { status: 400 })
  }
  const base = rel.slice(CONFLICT_DIR.length + 1)
  const state = await readConflictState(root)
  if (state[base] !== undefined) {
    delete state[base]
    await writeConflictState(root, state)
  }
  return { ok: true, path: rel }
}

/**
 * 新建一个空目录。
 *
 * 面板左栏「目录」那一行右侧有个「+」，用户可以直接建目录再往里放笔记。
 * 空目录不会被 scanVault 收进条目（它只收 .md），所以返回后要提醒前端
 * 「这个目录暂时还是空的，树上看不见」——这是真实的观感落差，不能怪用户没建成功。
 */
export async function createDir(root, dirInput) {
  const rel = normalizeRel(dirInput)
  if (rel === '') throw Object.assign(new Error('目录名不能为空'), { status: 400 })
  // 逐级校验：normalizeRel 已经拒绝 `..`，这里再确认没有混进保留目录名，
  // 否则用户建一个叫 `.trash` 的目录会把自己的回收站搞乱。
  for (const segment of rel.split('/')) {
    if (IGNORED_DIRS.has(segment)) {
      throw Object.assign(new Error(`「${segment}」是插件保留的目录名，换一个`), { status: 400 })
    }
  }
  const { abs } = resolveInside(root, rel, { create: true })
  try {
    await mkdir(abs, { recursive: true })
  } catch (error) {
    throw Object.assign(new Error(`建目录失败：${error && error.message ? error.message : error}`), { status: 500 })
  }
  return { ok: true, path: rel }
}

/**
 * 删除一个目录。
 *
 * 只有**空目录**才允许真删；里面有笔记时把笔记连同目录一起删掉是灾难性的
 * （用户点一下左栏的垃圾桶，几十篇笔记就进了回收站）。所以这里数一下 md 数量，
 * 非空就报 409 并回数量，让前端提示「这个目录里还有 N 篇，先把它们移走」。
 * 前端还有一道二次确认，两道一起才算安全。
 */
export async function removeDir(root, dirInput) {
  const rel = normalizeRel(dirInput)
  if (rel === '') throw Object.assign(new Error('不能删除库根'), { status: 400 })
  const { abs } = resolveInside(root, rel)
  let dirents
  try {
    dirents = await readdir(abs, { withFileTypes: true })
  } catch {
    throw Object.assign(new Error('这个目录不存在'), { status: 404 })
  }
  const notes = dirents.filter((d) => d.isFile() && extname(d.name).toLowerCase() === NOTE_EXT)
  if (notes.length > 0) {
    throw Object.assign(new Error(`这个目录里还有 ${notes.length} 篇笔记，先把它们移走再删目录`), {
      status: 409,
      notes: notes.length,
    })
  }
  // 子目录也拦一下：删父目录会连带删掉子目录，同样容易误伤
  const subdirs = dirents.filter((d) => d.isDirectory())
  if (subdirs.length > 0) {
    throw Object.assign(new Error(`这个目录里还有 ${subdirs.length} 个子目录，先清空再删`), {
      status: 409,
      dirs: subdirs.length,
    })
  }
  try {
    // 必须用 rmdir：fs.rm 在 recursive:false 时对目录抛 EISDIR（它只删文件）。
    // 这里故意不用 recursive:true —— 上面已经确认过是空目录，递归删等于把
    // 「万一是空目录」这个判断也一起放行了，真出 bug 时会连带删掉子内容。
    await rmdir(abs)
  } catch (error) {
    throw Object.assign(new Error(`删目录失败：${error && error.message ? error.message : error}`), { status: 500 })
  }
  return { ok: true, path: rel }
}

/**
 * 从全库笔记里彻底去掉一个标签。
 *
 * 标签不是独立实体，它就写在每篇笔记 frontmatter 的 `tags:` 里，所以「删标签」
 * 等于「把这批文件里的这个名字抹掉」。用文本级改写而不是重排 YAML：重排会丢掉
 * 用户手写的注释和字段顺序（同一理由见 handleBatch 的加标签）。
 *
 * 返回改了几篇，面板据此提示「已从 N 篇里移除」。一篇都没命中不报错——用户可能
 * 只是看着标签云手滑，静默成功比弹红字更符合预期。
 */
/**
 * 把 frontmatter 里的 tags 换成给定数组，原地改写而**不重排整个 YAML**。
 *
 * 为什么必须专门处理：tags 在 Markdown 里有两种合法写法——
 *   tags: [甲, 乙]        （行内流式）
 *   tags:                 （块列表）
 *     - 甲
 *     - 乙
 * 只替换 `tags:` 那一行的话，块列表的 `- 甲` 会原封不动留在下面，
 * 文件就变成「新标签 + 一堆悬空列表项」，下次解析把悬空项当垃圾，
 * 用户看着是标签删了但文件里还留着残渣。所以这里把整个 tags 段落
 * （行内的话只有那一行，块列表的话连同后续 `- xxx` 行）一起换掉。
 */
export function rewriteTags(text, tags) {
  const list = Array.isArray(tags) ? tags.map((tag) => String(tag).trim()).filter((tag) => tag !== '') : []
  const replacement = list.length > 0 ? `tags: [${list.join(', ')}]` : 'tags: []'
  const source = String(text == null ? '' : text)
  if (!/^---\r?\n/.test(source)) return `---\n${replacement}\n---\n${source}`
  const end = source.indexOf('\n---', 4)
  if (end === -1) return `---\n${replacement}\n---\n${source}`

  const head = source.slice(0, end)
  const rest = source.slice(end)
  const lines = head.split('\n')
  const start = lines.findIndex((line) => /^tags\s*:/.test(line))
  if (start === -1) {
    // 没有 tags 字段：插到 frontmatter 末尾，保持原有字段顺序不动
    return `${head}\n${replacement}${rest}`
  }
  let stop = start + 1
  // 行内写法（`tags: [甲, 乙]` 或 `tags: 甲`）只占一行；
  // 只写了 `tags:` 的要继续吃掉后续的 `  - 甲` 块列表项
  if (!/^tags\s*:.*\S/.test(lines[start])) {
    while (stop < lines.length && /^\s+-\s*/.test(lines[stop])) stop += 1
  }
  const next = [...lines.slice(0, start), replacement, ...lines.slice(stop)]
  return `${next.join('\n')}${rest}`
}

/**
 * 从 Markdown 全文里读出 tags 数组（行内与块列表两种写法都认）。
 * 面板与批量操作都要「先知道现在有哪些标签再算新集合」，统一走这里。
 */
export function readTags(text) {
  const source = String(text == null ? '' : text)
  if (!/^---\r?\n/.test(source)) return []
  const end = source.indexOf('\n---', 4)
  if (end === -1) return []
  const lines = source.slice(0, end).split('\n')
  const start = lines.findIndex((line) => /^tags\s*:/.test(line))
  if (start === -1) return []
  const inline = lines[start].replace(/^tags\s*:\s*/, '').trim()
  if (inline.startsWith('[')) {
    return inline
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(',')
      .map((tag) => tag.trim().replace(/^['"]|['"]$/g, ''))
      .filter((tag) => tag !== '')
  }
  if (inline !== '') return [inline.replace(/^['"]|['"]$/g, '')]
  const out = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const item = /^\s+-\s*(.+)$/.exec(lines[index])
    if (!item) break
    const tag = item[1].trim().replace(/^['"]|['"]$/g, '')
    if (tag !== '') out.push(tag)
  }
  return out
}

/**
 * 从所有笔记里移除一个标签。
 *
 * options.snapshot：可选的历史快照回调（(relPath) => Promise）。给了就走历史，
 * 不留 `.bak`——批量删标签会一次改几十篇，留下几十个 `.bak` 满库都是副本，
 * 而 `.history/` 本来就是为此设计的（每篇最多 10 版、藏在隐藏目录里）。
 */
export async function removeTag(root, tagInput, entries, options = {}) {
  const tag = String(tagInput || '').trim()
  if (tag === '') throw Object.assign(new Error('标签名不能为空'), { status: 400 })
  const snapshot = typeof options.snapshot === 'function' ? options.snapshot : null
  let changed = 0
  const failed = []
  for (const entry of entries) {
    const current = Array.isArray(entry.tags) ? entry.tags : []
    if (!current.includes(tag)) continue
    try {
      const note = await readNote(root, entry.path)
      const next = current.filter((t) => t !== tag)
      const text = note.content
      // 用 readTags 读真实标签而不是信 entry.tags：entry 是扫描时的快照，
      // 而块列表写法下两者可能不一致，按快照算会把残留项留在文件里。
      const actual = readTags(text)
      const base = actual.length > 0 ? actual : current
      const updated = rewriteTags(text, base.filter((t) => t !== tag))
      if (updated === text) continue
      if (snapshot) {
        // 历史存不下不该阻塞改名本身：丢了撤销点比改不动更可接受
        try {
          await snapshot(entry.path)
        } catch {
          /* 忽略 */
        }
      }
      await writeNote(root, entry.path, updated, { backup: snapshot === null })
      changed += 1
    } catch (error) {
      failed.push({ path: entry.path, error: error && error.message ? error.message : String(error) })
    }
  }
  return { ok: true, changed, failed, total: entries.length, tag }
}

/**
 * 把一个标签改名（所有带这个标签的笔记一起改）。
 *
 * 为什么需要：标签不是独立实体，只存在每篇笔记的 frontmatter 里。没有改名的话，
 * 用户想改一个错字只能「先删再建」——删的那一步会把所有引用抹掉，等于把几十篇
 * 笔记的归类一起丢了。改名是纯文本替换，语义上是同一件事的另一种写法。
 *
 * 目标标签已经存在时按「合并」处理：两边的笔记都归到新名字下，不会出现重复项。
 * options.snapshot 同 removeTag：给了就走版本历史，不留 `.bak`。
 */
export async function renameTag(root, fromInput, toInput, entries, options = {}) {
  const from = String(fromInput || '').trim()
  const to = String(toInput || '').trim()
  if (from === '') throw Object.assign(new Error('要改名的标签不能为空'), { status: 400 })
  if (to === '') throw Object.assign(new Error('新标签名不能为空'), { status: 400 })
  if (from === to) return { ok: true, changed: 0, failed: [], total: entries.length, from, to }
  const snapshot = typeof options.snapshot === 'function' ? options.snapshot : null
  let changed = 0
  const failed = []
  for (const entry of entries) {
    const current = Array.isArray(entry.tags) ? entry.tags : []
    if (!current.includes(from)) continue
    try {
      const note = await readNote(root, entry.path)
      const text = note.content
      // 同 removeTag：信文件里的真实标签，不信扫描快照——块列表写法下两者可能不一致，
      // 按快照算会把改名后的残渣留在文件里。
      const actual = readTags(text)
      const base = actual.length > 0 ? actual : current
      const next = []
      for (const tag of base) {
        const value = tag === from ? to : tag
        // 目标标签本来就在这篇里时不要写两遍
        if (!next.includes(value)) next.push(value)
      }
      const updated = rewriteTags(text, next)
      if (updated === text) continue
      if (snapshot) {
        try {
          await snapshot(entry.path)
        } catch {
          /* 历史存不下不该阻塞改名本身 */
        }
      }
      await writeNote(root, entry.path, updated, { backup: snapshot === null })
      changed += 1
    } catch (error) {
      failed.push({ path: entry.path, error: error && error.message ? error.message : String(error) })
    }
  }
  return { ok: true, changed, failed, total: entries.length, from, to }
}

/**
 * 按天统计笔记数量，用来画写作热力图。
 *
 * 移动端首页有一张热力图，它靠云端接口 `/notes/heatmap/day_notes` 算。本地库
 * 不需要联网也能算同一件事——每篇笔记的日期本来就在文件名或 frontmatter 里，
 * 扫描一次就有。会员到期之后这张图照样能画，这正是「本地优先」该有的样子。
 *
 * 返回：
 *   days    最近 weeks 周逐日计数（含 0），按日期升序，`{date, count}` 数组
 *   total   区间内笔记总数
 *   streak  截至今天的连续写作天数
 *   best    区间内单日最多几篇
 */
export function heatmapOf(entries, { weeks = 26, today = null } = {}) {
  const span = Math.max(4, Math.min(104, Number(weeks) || 26))
  const counts = new Map()
  for (const entry of entries || []) {
    const date = entry && typeof entry.date === 'string' ? entry.date : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    counts.set(date, (counts.get(date) || 0) + 1)
  }

  // 以「今天」为最后一列。用本地日期而不是 UTC：用户看到的日期是本地日期，
  // 用 UTC 算会让晚上写的笔记落到第二天格子里。
  const base = today instanceof Date ? new Date(today.getTime()) : new Date()
  base.setHours(0, 0, 0, 0)
  const pad = (n) => String(n).padStart(2, '0')
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

  // 网格从「今天所在那一周的周日」开始，往前推 span-1 周，保证每一列是完整一周
  const end = new Date(base.getTime())
  end.setDate(end.getDate() + (6 - end.getDay()))
  const days = []
  let total = 0
  let best = 0
  for (let i = (span * 7) - 1; i >= 0; i -= 1) {
    const d = new Date(end.getTime())
    d.setDate(d.getDate() - i)
    const date = key(d)
    const count = counts.get(date) || 0
    days.push({ date, count, future: d.getTime() > base.getTime() })
    if (count > 0 && d.getTime() <= base.getTime()) {
      total += count
      if (count > best) best = count
    }
  }

  // 连续天数：从今天往回数，遇到空日就停。今天还没写不算断——很多人是晚上写，
  // 早上打开面板看到「0 天」会莫名其妙。
  let streak = 0
  for (let i = days.length - 1; i >= 0; i -= 1) {
    const day = days[i]
    if (day.future) continue
    if (day.count > 0) streak += 1
    else if (day.date === key(base)) continue
    else break
  }

  return { days, total, streak, best, weeks: span }
}

/**
 * 勾掉（或取消勾掉）正文里第 index 个待办项。
 *
 * 为什么需要：面板读笔记时 `- [ ]` / `- [x]` 只画成一个方框，点不动。手机上勾待办
 * 是随手动作，桌面上却要切到编辑模式、找到那一行、手动把空格改成 x——用户会干脆
 * 不用待办。
 *
 * 为什么按「第几个」而不是按文本匹配：同一篇里经常有两条一模一样的待办（「喝水」
 * 出现两次），按文本改会一次改两行。
 *
 * 为什么只改正文：frontmatter 里不会有待办，但正文里可能嵌代码围栏，围栏里的
 * `- [ ]` 是示例代码不是待办。所以行号要跳过围栏，与 renderBlocks / outlineOf
 * 保持同一套口径。
 */
export async function toggleTodo(root, rel, index, options = {}) {
  const position = Number(index)
  if (!Number.isInteger(position) || position < 0) {
    throw Object.assign(new Error('待办序号不对'), { status: 400 })
  }
  const note = await readNote(root, rel)
  const content = note.content
  const lines = content.split('\n')

  // frontmatter 占开头若干行，正文从 fmEnd 开始。用 parseFrontmatter 拿不到行数，
  // 所以自己数一遍 --- 分隔符，口径与它一致（开头就是 --- 才算 frontmatter）。
  let fmEnd = 0
  if (lines.length > 0 && lines[0].trim() === '---') {
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === '---') {
        fmEnd = i + 1
        break
      }
    }
  }

  const TASK = /^(\s*)([-*+])\s+\[( |x|X)\]\s+(.*)$/
  let seen = -1
  let inFence = false
  let fenceMarker = ''
  let targetLine = -1
  let targetMatch = null

  for (let i = fmEnd; i < lines.length; i += 1) {
    const line = lines[i]
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1]
      } else if (line.trim().startsWith(fenceMarker)) {
        inFence = false
      }
      continue
    }
    if (inFence) continue
    const match = TASK.exec(line)
    if (!match) continue
    seen += 1
    if (seen === position) {
      targetLine = i
      targetMatch = match
      break
    }
  }

  if (targetLine < 0 || targetMatch === null) {
    throw Object.assign(new Error('这篇笔记里没有这一条待办'), { status: 404 })
  }

  const wasDone = targetMatch[3].toLowerCase() === 'x'
  const indent = targetMatch[1]
  const bullet = targetMatch[2]
  const text = targetMatch[4]
  // 只翻方框里那一个字符，其余（缩进、bullet 样式、正文）原样保留——用户可能
  // 写 `- [x] 买牛奶  #生活`，整行重建会把这些细节丢掉。
  lines[targetLine] = `${indent}${bullet} [${wasDone ? ' ' : 'x'}] ${text}`

  const updated = lines.join('\n')
  const snapshot = typeof options.snapshot === 'function' ? options.snapshot : null
  if (snapshot) {
    try {
      await snapshot(rel)
    } catch {
      /* 历史存不下不该阻塞勾选 */
    }
  }
  await writeNote(root, rel, updated, { backup: snapshot === null })
  return { ok: true, path: note.path, index: position, done: !wasDone }
}

/**
 * 把 frontmatter 里读出来的 tags 统一成字符串数组。
 *
 * 为什么需要：`tags: 甲` 是合法的 YAML（单个标签不写方括号），而 `tags: [甲, 乙]`
 * 是数组。手写笔记里两种都会出现，如果各处直接 `Array.isArray(data.tags)` 判断，
 * 单值写法就会被当成「没有标签」——最典型的后果是 `tag:甲` 搜不到那篇笔记，
 * 用户明明看着标签在那儿却搜不出来。
 */
export function normalizeTags(value) {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter((tag) => tag !== '')
  if (value === undefined || value === null) return []
  const single = String(value).trim()
  return single === '' ? [] : [single]
}

/** 库统计：面板顶部显示「几篇笔记 / 几个目录 / 多大」。 */
export async function vaultStats(root, entries) {
  let bytes = 0
  const dirs = new Set()
  for (const entry of entries) {
    bytes += entry.bytes || 0
    const d = posix.dirname(entry.path)
    if (d !== '.' && d !== '') dirs.add(d)
  }
  return { notes: entries.length, dirs: dirs.size, bytes }
}

/** 库内目录列表（用于新建笔记时的目标目录下拉）。 */
export function listDirs(entries) {
  const dirs = new Set([''])
  for (const entry of entries) {
    const segments = entry.path.split('/').slice(0, -1)
    let acc = ''
    for (const segment of segments) {
      acc = acc === '' ? segment : `${acc}/${segment}`
      dirs.add(acc)
    }
  }
  return [...dirs].sort((a, b) => a.localeCompare(b, 'zh'))
}

export { NOTE_EXT, MAX_READ, MAX_WRITE }
