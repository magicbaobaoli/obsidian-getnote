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
import { createHash, randomBytes } from 'node:crypto'
import { coreError } from './errors.js'
import { moveHistoryEntries } from './history.js'
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
    throw coreError("vault.pathEscapes", {}, { status: 400 })
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
    throw coreError("vault.pathEscapes", {}, { status: 400 })
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

/**
 * 抹掉 `%%…%%` 注释。
 *
 * 注释在宿主里是不显示的（不是灰字、不是折叠，是整段不存在）。列表摘录、
 * 正文标签、断链体检都要先过这一层：不抹的话，注释里随手写的 `#草稿`
 * 会冒进标签云，注释里那条「先别删」的旧双链会被报成断链。
 */
export function stripComments(text) {
  return String(text == null ? '' : text).replace(/%%[\s\S]*?%%/g, ' ')
}

/**
 * 与 stripComments 一样抹掉注释，但保留换行——行号必须对得上。
 *
 * 断链体检要报「第几行」，反链要按行取上下文，这两处都不能把行数改掉。
 * 注释里的双链在宿主里不算链接（点了也没反应），所以它们不该被算进反链，
 * 也不该被报成断链。
 */
function maskComments(text) {
  return String(text == null ? '' : text).replace(/%%[\s\S]*?%%/g, (all) => all.replace(/[^\n]/g, ' '))
}

/** 正文摘录：压掉空行与 Markdown 噪声，取前面一段做列表副标题。 */
export function excerptOf(body, limit = 140) {
  const text = stripComments(body)
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
// ── 扫描缓存 ─────────────────────────────────────────────────────────────────
//
// 面板一进来就打 /status + /tree，切目录、搜一次、点一篇笔记又各打一次；每次
// 都是全库 walk + 逐文件读 + 解析 frontmatter。8000 篇的库上单次能到几百毫秒，
// 而这些请求里绝大多数拿的是同一份数据。
//
// 缓存键是「库根 + 库内所有参与扫描的文件的 mtime/size 指纹」——不缓存时间，
// 而是每次花一次 readdir 拿目录树（比读文件便宜一个量级），指纹没变就直接
// 返回上一次的结果。这样即使有别的程序（Obsidian 自己、git、用户在资源管理器
// 里改名）改了文件，也不会读到过期数据；插件自己的写入还会主动 invalidate。
const scanCache = new Map()
const SCAN_CACHE_MAX = 4

// 失效纪元：宿主每报一次库内改动（modify/create/delete/rename）就把该库根的
// 纪元 +1。缓存键里带上它，于是「事件说变了」时不必再去算指纹就知道缓存不能用了。
// 这是把「有没有变」从「每次都问一遍磁盘」换成「事件告诉我们」。
const vaultEpoch = new Map()
// 每个库根连续命中缓存的次数。命中到上限就强制作废一次，重新问磁盘——
// 宿主事件漏报（外部工具改库、同步盘落地、git checkout）时靠它兜底。
const scanHits = new Map()
const SCAN_HIT_REFRESH = 50

/**
 * 把某个库根的失效纪元 +1，返回新纪元。
 *
 * 宿主侧的文件事件调它；离线测试（直调 core、不经过宿主）也用它手动制造
 * 「库变了」。传空串等于全清（换库、测试收尾）。
 */
export function bumpEpoch(root) {
  if (typeof root !== 'string' || root === '') {
    vaultEpoch.clear()
    scanHits.clear()
    return 0
  }
  const next = (vaultEpoch.get(root) || 0) + 1
  vaultEpoch.set(root, next)
  return next
}

// 逐文件记忆：指纹变了（库里改了一篇）时，整库只有那一篇需要重新读+解析。
// 键里带 mtime 和 size，所以任何真实的文件改动都会让它失效——这不是「缓存
// 多久」的问题，而是「这份文件还是不是那一份」的判断。
const entryMemo = new Map()
const ENTRY_MEMO_MAX = 20000

// 正文记忆：entryMemo 记住的是「解析后的条目」（标题/日期/标签/摘录），可搜索
// 要的是原文本身，于是同一批文件在扫库之后还要被搜索再读一遍。这里用同一套
// 键（绝对路径 + mtimeMs + size）记住原文，扫库与搜索共用。
//
// 必须另加字节闸：ENTRY_MEMO_MAX 限的是「条目数」，一篇 2MB 的笔记乘两万就是
// 40GB —— 条目数上限挡不住内存被正文撑爆。默认 64MB，按 LRU 淘汰。
const textMemo = new Map()
const TEXT_MEMO_MAX_BYTES = 64 * 1024 * 1024
let textMemoBytes = 0
let textMemoLimit = TEXT_MEMO_MAX_BYTES

/** 正文缓存当前占用（诊断与测试用）。 */
export function textMemoStats() {
  return { entries: textMemo.size, bytes: textMemoBytes, limit: textMemoLimit }
}

/**
 * 只给测试用：把正文缓存的字节上限调小，好在几百字节的库里验证 LRU 淘汰。
 * 传非数字或负数不生效，避免误调把缓存彻底关掉。
 */
export function setTextMemoLimit(bytes) {
  const next = Number(bytes)
  if (!Number.isFinite(next) || next < 0) return
  textMemoLimit = next
  trimTextMemo()
}

/** 从最久没用过的那头开始丢，直到占用回到上限以内。 */
function trimTextMemo() {
  while (textMemoBytes > textMemoLimit && textMemo.size > 0) {
    const oldest = textMemo.keys().next()
    if (oldest.done) break
    const record = textMemo.get(oldest.value)
    textMemoBytes -= record.bytes
    textMemo.delete(oldest.value)
  }
}

/**
 * 取一篇正文：先看正文缓存，未命中才读盘并回填。
 *
 * 命中时要把它挪到 Map 尾部 —— Map 的插入顺序就是 LRU 的「最近使用」顺序，
 * 不挪的话热门笔记会被冷门笔记按插入顺序挤出去。
 */
async function getEntryText(abs, mtimeMs, size) {
  const key = `${abs}\u0000${mtimeMs}\u0000${size}`
  const hit = textMemo.get(key)
  if (hit !== undefined) {
    textMemo.delete(key)
    textMemo.set(key, hit)
    return hit.text
  }
  const text = await readFile(abs, 'utf8')
  const bytes = Number(size) > 0 ? Number(size) : text.length
  textMemo.set(key, { text, bytes })
  textMemoBytes += bytes
  trimTextMemo()
  return text
}

/** 丢掉某个库根的扫描缓存；不传就全丢。插件写完文件后调它。 */
export function invalidateScan(root) {
  // 只丢「整库指纹 → 扫描结果」这一层。逐文件记忆不用清：它的键里带着
  // mtime 和 size，文件真变了自然就换键，没变的那些还留着省一次读盘+解析。
  // 不传 root 是彻底重置（换库、测试收尾时用）。
  if (typeof root !== 'string' || root === '') {
    entryMemo.clear()
    textMemo.clear()
    textMemoBytes = 0
  }
  if (typeof root === 'string' && root !== '') {
    // 纪元 +1：缓存键里带着它，所以「事件说这个库变了」之后，即使目录签名
    // 一个字符都没变（只改了正文），下一次 scanVault 也必然重新扫。
    bumpEpoch(root)
    scanHits.delete(root)
    for (const key of [...scanCache.keys()]) {
      if (key === root || key.startsWith(root)) scanCache.delete(key)
    }
    return
  }
  scanCache.clear()
  bumpEpoch('')
}

/**
 * 目录签名：整棵目录树的「每层有哪些 .md」。
 *
 * 以前这里连每个文件的 mtimeMs/size 都 stat 一遍，8000 篇的库等于每次
 * /status、/list 打 8000 次 stat。现在只列目录（readdir 比 stat 便宜一个
 * 量级，而且一次拿一整层）：
 *   · 新增 / 删除 / 改名会改变某一层的名单 → 签名变 → 缓存失效；
 *   · 正文被改（名单没变）由宿主事件（bumpEpoch）+ 逐文件 mtime 记忆兜底，
 *     再加上「连续命中 SCAN_HIT_REFRESH 次就强扫一次」，漏报也不会一直陈旧。
 * 换句话说：签名负责「有哪些文件」，纪元与事件负责「文件什么时候变了」。
 */
async function dirSignature(root) {
  const parts = []
  async function walk(dir, relDir, depth) {
    if (depth > MAX_DEPTH) return
    let dirents
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      parts.push(`!${relDir}`)
      return
    }
    const names = []
    for (const dirent of dirents) {
      const name = dirent.name
      if (dirent.isDirectory()) {
        if (IGNORED_DIRS.has(name)) continue
        await walk(join(dir, name), relDir === '' ? name : `${relDir}/${name}`, depth + 1)
        continue
      }
      if (!dirent.isFile()) continue
      if (extname(name).toLowerCase() !== NOTE_EXT) continue
      names.push(name)
    }
    names.sort()
    parts.push(`${relDir}|${names.join(',')}`)
  }
  await walk(root, '', 0)
  return parts.join('\n')
}

/**
 * 扫库（带缓存）。
 *
 * `options.fresh` 为真时跳过缓存重新扫：同步、归档这类「必须看到磁盘真相」的
 * 路径用它，避免拿着上一次的结果做覆盖写。
 */
export async function scanVault(root, options = {}) {
  const fresh = options !== null && typeof options === 'object' && options.fresh === true
  let key = null
  if (!fresh) {
    try {
      // 键 = 库根 + 失效纪元 + 目录签名。纪元由宿主事件推动（改一个字的正文也
      // 会 +1），签名由目录名单推动（新增/删除/改名）。两者都不动，才认为可以
      // 直接拿上次的结果。
      key = `${root}\u0000${vaultEpoch.get(root) || 0}\u0000${await dirSignature(root)}`
      const hit = scanCache.get(key)
      if (hit !== undefined) {
        const hits = (scanHits.get(root) || 0) + 1
        if (hits < SCAN_HIT_REFRESH) {
          scanHits.set(root, hits)
          return hit
        }
        // 连着命中太多次：宿主事件可能漏报（外部工具、同步盘、git checkout），
        // 这一轮不走缓存，真扫一遍把磁盘真相捞回来。
        scanCache.delete(key)
      }
    } catch {
      // 签名算不出来（库被删了之类）就走完整扫描，让它把错误报出来
      key = null
    }
  }

  const entries = []
  const errors = []
  // 有笔记的目录，以及所有目录（含空目录）。
  // 空目录原来是不进结果的——「只列有笔记的目录」读起来像省事，实际后果是
  // 用户刚在左栏建好一个目录、准备往里写，它却当场消失，看着像没建成。
  const filled = new Set([''])
  const allDirs = new Set([''])
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
        const childRel = relDir === '' ? name : `${relDir}/${name}`
        allDirs.add(childRel)
        await walk(join(dir, name), childRel, depth + 1)
        continue
      }
      if (!dirent.isFile()) continue
      if (extname(name).toLowerCase() !== NOTE_EXT) continue
      const rel = relDir === '' ? name : `${relDir}/${name}`
      filled.add(relDir)
      const abs = join(dir, name)
      try {
        const st = await stat(abs)
        if (st.size > MAX_READ) {
          errors.push({ path: rel, message: `文件超过 ${Math.round(MAX_READ / 1024 / 1024)}MB，已跳过` })
          continue
        }
        const memoKey = `${abs}\u0000${st.mtimeMs}\u0000${st.size}`
        const memo = entryMemo.get(memoKey)
        if (memo !== undefined) {
          // 同一个文件、同一个 mtime 和大小：内容必然一样，不必再读一遍。
          // 目录可能被改名，所以 path/dir/name 用这次的，其余沿用记忆。
          entries.push({ ...memo, path: rel, name, dir: relDir })
          continue
        }
        const text = await getEntryText(abs, st.mtimeMs, st.size)
        const { data, body } = parseFrontmatter(text)
        const entry = {
          path: rel,
          name,
          dir: relDir,
          title: deriveTitle(body, rel),
          date: deriveDate(rel, data, st.mtimeMs),
          // 头部标签 + 正文里的 `#标签`。宿主两个地方都认，面板只认头部的话，
          // 同一个标签写在正文里就既进不了标签云、也筛不出这一篇。
          tags: mergeTags(normalizeTags(data.tags), extractInlineTags(body)),
          // 别名也带出来：点双链时最后一级要比它（宿主按别名解析双链，
          // 面板只比标题的话，同一个链接一边点得开、一边报「找不到」）。
          aliases: normalizeAliases(data.aliases !== undefined ? data.aliases : data.alias !== undefined ? data.alias : data['别名']),
          noteId: data.note_id ? String(data.note_id) : null,
          noteUrl: data.note_url ? String(data.note_url) : null,
          bytes: st.size,
          mtimeMs: st.mtimeMs,
          excerpt: excerptOf(body),
        }
        entries.push(entry)
        entryMemo.set(memoKey, entry)
        if (entryMemo.size > ENTRY_MEMO_MAX) {
          // 简单的 FIFO 淘汰：Map 的插入顺序就是我们要的顺序
          const oldest = entryMemo.keys().next()
          if (!oldest.done) entryMemo.delete(oldest.value)
        }
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
  // 空目录单独带出去：它们既不是笔记、也不该被当成「有内容的目录」参与计数，
  // 但左栏要让用户看得见自己刚建的那个。
  const emptyDirs = [...allDirs].filter((dir) => !filled.has(dir))
  const result = { entries, errors, truncated, emptyDirs }
  if (key !== null) {
    // 真扫过一轮，命中计数归零（下一次重新开始数）。
    scanHits.set(root, 0)
    // 只缓存「扫得干净」的结果：有错误或截断时下一次应当重试，而不是把
    // 一次不完整的快照当成真相缓存下来。
    if (errors.length === 0 && !truncated) {
      scanCache.set(key, result)
      if (scanCache.size > SCAN_CACHE_MAX) {
        const oldest = scanCache.keys().next()
        if (!oldest.done) scanCache.delete(oldest.value)
      }
    }
  }
  return result
}

/**
 * 由扁平条目建目录树。
 *
 * `emptyDirs` 是「磁盘上有、但一篇笔记都没有」的目录：它们也要出现在树上，
 * 计数是 0。以前空目录一概不列，用户刚建好一个目录准备往里写，它却当场消失，
 * 看着像没建成；而建目录这个动作本身又提示「空目录暂时不显示」——那等于
 * 承认这个洞。
 */
export function buildTree(entries, emptyDirs = []) {
  const root = { name: '', path: '', kind: 'dir', children: [], count: 0 }
  const dirMap = new Map([['', root]])
  const ensure = (rel) => {
    let cursor = root
    let acc = ''
    for (const segment of rel.split('/')) {
      acc = acc === '' ? segment : `${acc}/${segment}`
      let node = dirMap.get(acc)
      if (!node) {
        node = { name: segment, path: acc, kind: 'dir', children: [], count: 0 }
        dirMap.set(acc, node)
        cursor.children.push(node)
      }
      cursor = node
    }
    return cursor
  }
  for (const entry of entries) {
    const segments = entry.path.split('/').slice(0, -1)
    let acc = ''
    for (const segment of segments) acc = acc === '' ? segment : `${acc}/${segment}`
    const cursor = acc === '' ? root : ensure(acc)
    cursor.children.push({ name: entry.name, path: entry.path, kind: 'file', entry })
  }
  for (const dir of emptyDirs) {
    if (typeof dir === 'string' && dir !== '') ensure(dir)
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
    throw coreError("vault.readMdOnly", {}, { status: 400 })
  }
  const st = await stat(abs)
  if (!st.isFile()) throw coreError("vault.notAFile", {}, { status: 400 })
  if (st.size > MAX_READ) throw coreError("vault.fileTooLarge", {}, { status: 413 })
  const content = await readFile(abs, 'utf8')
  const { data, body } = parseFrontmatter(content)
  return {
    path: normalized,
    content,
    body,
    frontmatter: data,
    title: deriveTitle(body, normalized),
    tags: mergeTags(normalizeTags(data.tags), extractInlineTags(body)),
    aliases: normalizeAliases(data.aliases !== undefined ? data.aliases : data.alias !== undefined ? data.alias : data['别名']),
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
 * 把本地文件存进这篇笔记的附件目录。
 *
 * 为什么文件名前面要加笔记主干：listAssets 认领附件的第一条就是「文件名以笔记
 * 主干开头」。不加这个前缀，用户拖进来的图确实落到了盘上，但面板的附件区看不见
 * 它——用户会以为没存进去，然后再拖一次，盘上就堆了两份。
 *
 * 重名不覆盖：加 -2 / -3 后缀。覆盖等于把用户上一次拖进来的同名文件悄悄吃掉。
 */
export async function saveAsset(root, relNote, name, data) {
  const { rel: normalized } = resolveInside(root, relNote)
  if (!normalized.toLowerCase().endsWith(NOTE_EXT)) {
    throw coreError("vault.assetMdOnly", {}, { status: 400 })
  }
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw coreError("vault.emptyFile", {}, { status: 400 })
  }
  const dir = posix.dirname(normalized)
  const stem = posix.basename(normalized, NOTE_EXT)
  const assetRel = dir === '.' || dir === '' ? 'asset' : `${dir}/asset`
  // 只取最后一段：拖进来的东西可能带着宿主的绝对路径，落盘时不能带目录
  const raw = String(name || '').replace(/\\/g, '/')
  const base = raw.slice(raw.lastIndexOf('/') + 1)
  const cleaned = base
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
  const safe = (cleaned === '' ? 'file' : cleaned).slice(0, 80)
  // 已经带笔记主干就不重复加（用户从库里又拖回来一次的情况）
  const prefix = stem === '' ? '' : `${stem}_`
  const wanted = prefix !== '' && safe.startsWith(prefix) ? safe : `${prefix}${safe}`
  const dot = wanted.lastIndexOf('.')
  const head = dot > 0 ? wanted.slice(0, dot) : wanted
  const ext = dot > 0 ? wanted.slice(dot) : ''
  const assetAbs = resolveInside(root, assetRel).abs
  await mkdir(assetAbs, { recursive: true })
  for (let counter = 1; counter <= 99; counter += 1) {
    const candidate = counter === 1 ? wanted : `${head}-${counter}${ext}`
    const relPath = `${assetRel}/${candidate}`
    const abs = resolveInside(root, relPath).abs
    let exists = false
    try {
      await stat(abs)
      exists = true
    } catch {
      exists = false
    }
    if (exists) continue
    await writeFile(abs, data)
    invalidateScan(root)
    return { name: candidate, path: relPath, bytes: data.length }
  }
  throw coreError("vault.tooManyAssets", {}, { status: 409 })
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
  // 「我读到的是这一版，才允许写」：面板开着的时候用户在宿主编辑器里也改了同一篇，
  // 后保存的那一份会把前一份悄悄盖掉，而且盖完没有任何痕迹（历史里倒是有，
  // 但用户不会知道要去看）。带上前一次读到的 mtimeMs，对不上就抛 409，
  // 让上面问一句「要用哪一版」，而不是闷头覆盖。
  // 不传 expectMtimeMs 就是「不管现状、直接写」——导入、同步、脚本都靠这条老路子。
  const expectMtimeMs = typeof options.expectMtimeMs === 'number' && Number.isFinite(options.expectMtimeMs)
    ? options.expectMtimeMs
    : null
  if (!normalized.toLowerCase().endsWith(NOTE_EXT)) {
    throw coreError("vault.writeMdOnly", {}, { status: 400 })
  }
  if (typeof content !== 'string') throw coreError("vault.contentNotString", {}, { status: 400 })
  if (Buffer.byteLength(content, 'utf8') > MAX_WRITE) {
    throw coreError("vault.contentTooLarge", {}, { status: 413 })
  }
  if (expectMtimeMs !== null) {
    let nowMs = null
    try {
      nowMs = (await stat(abs)).mtimeMs
    } catch {
      // 文件不在（新建 / 刚被删）：没有「被谁改过」可言，照写
      nowMs = null
    }
    if (nowMs !== null && nowMs !== expectMtimeMs) {
      throw coreError('vault.conflict', {}, { status: 409, path: normalized, mtimeMs: nowMs })
    }
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
  invalidateScan(root)
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
      if (counter > 99) throw coreError("vault.tooManyNotes", {}, { status: 409 })
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
  if (normalized === '') throw coreError("vault.cannotRemoveRoot", {}, { status: 400 })
  const trashDir = join(root, '.trash')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(trashDir, `${stamp}__${basename(abs)}`)
  await mkdir(trashDir, { recursive: true })
  await rename(abs, target)
  // 文件名里只留了名字，原来在哪个目录记在旁边的索引里：恢复时能默认放回原处，
  // 而不是一律丢回库根。索引只是锦上添花——它丢了照样能恢复，只是回到库根。
  const fromDir = posix.dirname(normalized)
  const originalDir = fromDir === '.' ? '' : fromDir
  await rememberTrashOrigin(root, basename(target), originalDir)
  invalidateScan(root)
  return { path: normalized, trashedTo: toPosix(relative(root, target)), originalDir }
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
 * 回收站旁边挂的一份「原目录」索引。
 *
 * 为什么不是把目录编进文件名：文件名是用户可能直接拖回库里的东西，编码进去之后
 * 拖回去得到的是个叫「随手记__某篇.md」的怪名字。所以权威仍是文件名，目录单独记；
 * 索引读不到、被删了、或者文件是用户自己拖进 .trash 的，都退回「放库根」——
 * 恢复这个动作不能因为少了一条辅助信息就失败。
 */
const TRASH_INDEX = '.origins.json'
const TRASH_INDEX_MAX = 5000

// 索引是「读-改-写」，两个删除同时进来会互相盖掉对方的条目。串成一条队列，
// 一次只让一个任务动它；任务自己失败也不堵后面的。
let trashIndexQueue = Promise.resolve()
function queueTrashIndex(task) {
  const next = trashIndexQueue.then(task, task)
  trashIndexQueue = next.then(() => undefined, () => undefined)
  return next
}

async function readTrashOrigins(root) {
  try {
    const text = await readFile(join(root, TRASH_DIR, TRASH_INDEX), 'utf8')
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch {
    return {}
  }
}

async function writeTrashOrigins(root, map) {
  const dir = join(root, TRASH_DIR)
  await mkdir(dir, { recursive: true })
  const keys = Object.keys(map).slice(-TRASH_INDEX_MAX)
  const trimmed = {}
  for (const key of keys) trimmed[key] = map[key]
  await writeFile(join(dir, TRASH_INDEX), JSON.stringify(trimmed), 'utf8')
}

/** 记一条「这个回收站文件原来在哪个目录」。失败不影响删除本身。 */
async function rememberTrashOrigin(root, trashName, dir) {
  const key = String(trashName || '')
  if (key === '') return
  try {
    await queueTrashIndex(async () => {
      const map = await readTrashOrigins(root)
      map[key] = { dir: String(dir || ''), at: new Date().toISOString() }
      await writeTrashOrigins(root, map)
    })
  } catch {
    // 索引写不进去只是少一条提示，删除已经成功了，不该因此报错
  }
}

/** 恢复/永久删掉之后把这一条抹掉，免得索引越攒越长。 */
async function forgetTrashOrigin(root, trashName) {
  const key = String(trashName || '')
  if (key === '') return
  try {
    await queueTrashIndex(async () => {
      const map = await readTrashOrigins(root)
      if (map[key] === undefined) return
      delete map[key]
      await writeTrashOrigins(root, map)
    })
  } catch {
    // 同上：抹不掉只是留一条过期记录，下次真没了会自动对不上
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
  const origins = await readTrashOrigins(root)
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
    // 原来在哪个目录：索引里有就用它，没有就是空串（= 放库根，和以前一样）。
    const remembered = origins[dirent.name]
    const originalDir = remembered !== null && typeof remembered === 'object' && typeof remembered.dir === 'string'
      ? remembered.dir
      : ''
    items.push({
      name: dirent.name,
      path: toPosix(join(TRASH_DIR, dirent.name)),
      originalName: meta.originalName,
      title: meta.originalName.replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''),
      trashedAt: meta.trashedAt,
      bytes: st.size,
      mtimeMs: st.mtimeMs,
      originalDir,
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
    throw coreError("vault.restoreTrashOnly", {}, { status: 400 })
  }
  let st
  try {
    st = await stat(absTrash)
  } catch {
    throw coreError("vault.trashMissing", {}, { status: 404 })
  }
  if (!st.isFile()) throw coreError("vault.notAFile", {}, { status: 400 })

  const meta = parseTrashName(basename(absTrash))
  const wanted = typeof targetRel === 'string' && targetRel.trim() !== ''
    ? normalizeRel(targetRel.trim())
    : ''
  // 调用方没说放回哪时，先看索引里记的原目录：删之前在哪，恢复就回哪。
  // 索引里没有（老版本删的、用户自己拖进来的）就退回库根，和以前一样。
  let rel = wanted
  if (rel === '') {
    const origins = await readTrashOrigins(root)
    const remembered = origins[basename(absTrash)]
    const dir = remembered !== null && typeof remembered === 'object' && typeof remembered.dir === 'string'
      ? normalizeRel(remembered.dir)
      : ''
    rel = dir === '' ? meta.originalName : `${dir}/${meta.originalName}`
  }
  if (rel === '' || rel.endsWith('/')) {
    throw coreError("vault.targetEmpty", {}, { status: 400 })
  }
  const { abs: absTarget } = resolveInside(root, rel, { create: true })

  // 同名冲突时加后缀，绝不覆盖
  let candidate = rel
  let counter = 1
  for (;;) {
    try {
      await stat(resolveInside(root, candidate).abs)
      counter += 1
      if (counter > 99) throw coreError("vault.tooManyNotes", {}, { status: 409 })
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
  await forgetTrashOrigin(root, basename(absTrash))
  invalidateScan(root)
  return { path: candidate, restoredFrom: trashRel, title: meta.originalName }
}

/**
 * 一次把几个回收站文件放回库里。
 *
 * 为什么不复用 restoreNote 的循环、也不在面板里逐个打请求：一行一行恢复时，
 * 同名冲突会被各自加 `-2` 后缀（文件其实还在原地），用户看不出「这两个
 * 原本是两篇不同的笔记」。这里先让第一个拿到原名，后面的才加后缀，
 * 结果和一篇篇手动恢复一致。
 *
 * 单个失败不连累其余：已经搬回去的照旧算恢复成功，失败的原样留在回收站。
 */
export async function restoreNotes(root, trashPaths, targetRel) {
  const wanted = Array.isArray(trashPaths) ? trashPaths : []
  const restored = []
  const failed = []
  const target = typeof targetRel === 'string' ? targetRel.trim() : ''
  for (const one of wanted) {
    const path = typeof one === 'string' ? one.trim() : ''
    if (path === '') continue
    try {
      // 串行恢复：restoreNote 每搬一个都会先 stat 目标、自己挑不冲突的名字，
      // 所以并行跑反而会让两篇抢同一个名字。慢一点，但结果确定。
      const result = await restoreNote(root, path, target)
      restored.push(result)
    } catch (error) {
      failed.push({ path, error: error && error.message ? error.message : String(error) })
    }
  }
  return { restored, failed, total: wanted.length }
}

/** 一次性永久删掉回收站里的几个文件（逐个真删，不是清空整个回收站）。 */
export async function purgeTrashMany(root, trashPaths) {
  const wanted = Array.isArray(trashPaths) ? trashPaths : []
  const purged = []
  const failed = []
  for (const one of wanted) {
    const path = typeof one === 'string' ? one.trim() : ''
    if (path === '') continue
    try {
      const result = await purgeTrash(root, path)
      purged.push(...(Array.isArray(result.purged) ? result.purged : []))
    } catch (error) {
      failed.push({ path, error: error && error.message ? error.message : String(error) })
    }
  }
  return { purged, failed, total: wanted.length }
}

/** 清空回收站（真删）。默认只在用户明确要求时调用。 */
export async function purgeTrash(root, trashPath) {
  const trashDir = join(root, TRASH_DIR)
  if (typeof trashPath === 'string' && trashPath.trim() !== '') {
    const { abs, rel } = resolveInside(root, trashPath)
    if (!rel.startsWith(`${TRASH_DIR}/`)) {
      throw coreError("vault.emptyTrashOnly", {}, { status: 400 })
    }
    await rm(abs, { force: true })
    await forgetTrashOrigin(root, basename(abs))
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
    // 索引文件不是回收站里的「东西」：清空时跟着一起清掉，但不能算进 purged，
    // 否则面板会报「已清理 N+1 个」。
    if (dirent.name === TRASH_INDEX) continue
    await rm(join(trashDir, dirent.name), { force: true })
    purged.push(toPosix(join(TRASH_DIR, dirent.name)))
  }
  if (purged.length > 0) {
    try {
      await rm(join(trashDir, TRASH_INDEX), { force: true })
    } catch {
      // 索引没了不影响什么
    }
    invalidateScan(root)
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
 *   "连着两个词"     → 当成一个词，要连着出现才算命中
 *   -词 / -"两个词"  → 排除：正文或标题里出现它就整篇不算
 * 其余词就是正文关键词，空格分隔的多个关键词要**全部**命中。
 */
export function parseSearchQuery(input) {
  const raw = String(input || '').trim()
  const tags = []
  const dirs = []
  const terms = []
  const nots = []
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
  // 引号把一串词包成「一个词」：搜「开会 记录」时两个词各自出现在篇里就行，
  // 想找那一次连着的会议就得写 "开会 记录"。前导的减号是排除——
  // 搜「会议 -录音」的人要的是开会记录，不是那堆录音转写。
  const tokenRe = /(-?)"([^"]*)"|(-?)(\S+)/g
  let t
  while ((t = tokenRe.exec(rest)) !== null) {
    const neg = (t[1] !== undefined ? t[1] : t[3]) === '-'
    const value = (t[2] !== undefined ? t[2] : t[4]).trim()
    if (value === '') continue
    if (neg) nots.push(value)
    else terms.push(value)
  }
  return { raw, tags, dirs, terms, nots }
}

export async function searchNotes(root, query, { limit = 60, perFile = 3, sort = 'relevance' } = {}) {
  const parsed = parseSearchQuery(query)
  if (parsed.tags.length === 0 && parsed.dirs.length === 0 && parsed.terms.length === 0) {
    return { query: parsed.raw, parsed, hits: [], scanned: 0, truncated: false }
  }
  const needles = parsed.terms.map((t) => t.toLowerCase())
  const notNeedles = parsed.nots.map((t) => t.toLowerCase())
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
        // 搜索只关心正文，和扫库共用同一份「正文记忆」：同样的查询连打两次、
        // 或者刚扫过库再搜，都不必再读一遍盘，只花一次 stat 确认文件没变。
        const abs = join(dir, name)
        const st = await stat(abs)
        text = await getEntryText(abs, st.mtimeMs, st.size)
      } catch {
        continue
      }
      const { data, body } = parseFrontmatter(text)
      // 排除词先过一遍：命中就不必再算正文行、算标签。整篇读进来的 text
      // 已经含标题与 frontmatter，所以「标题里有这个词」也算排除。
      if (notNeedles.length > 0) {
        const allLower = text.toLowerCase()
        let excluded = false
        for (const bad of notNeedles) {
          if (allLower.includes(bad)) {
            excluded = true
            break
          }
        }
        if (excluded) continue
      }
      const fileTags = mergeTags(normalizeTags(data.tags), extractInlineTags(body)).map((t) => t.toLowerCase())
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
        tags: mergeTags(normalizeTags(data.tags), extractInlineTags(body)),
        aliases: normalizeAliases(data.aliases !== undefined ? data.aliases : data.alias !== undefined ? data.alias : data['别名']),
        matches,
        titleHit,
        matchCount,
        // 这一篇引用了谁。搜索结果原来只给命中次数，用户还得点进去才知道它提到
        // 的是哪几篇；正文本来就已经读进来了，顺手抽一下不额外读盘。
        links: extractWikiLinks(body),
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
  const src = maskComments(text)
  const re = /\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g
  let m
  while ((m = re.exec(src)) !== null) {
    const target = m[1].trim()
    if (target !== '') out.add(target)
  }
  return [...out]
}

/**
 * 把引用那一行收拾成反链里的一行上下文。
 *
 * 双链在 Markdown 里基本不会跨行，所以上下文就是它所在的那一行。双链本身
 * 从行里削掉（留着的话一行上下文里全是 `[[`），行首的井号和列表符号也削掉，
 * 多余空白压平。太长就两头留一点、中间省略——反链区一行就十几号字，整段
 * 正文塞进去反而看不清。
 */
function snippetOfLine(line, width = 60) {
  const text = String(line || '')
    .replace(/\[\[[^\]\n]*\]\]/g, ' ')
    .replace(/^\s*#+\s*/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= width) return text
  return `${text.slice(0, width - 1).trim()}…`
}

/**
 * 数一遍正文里「指向目标」的双链各写了几次，顺带收下出现处的上下文。
 *
 * 两个用途：一是反链按次数排（一篇里提了五次的，比只提一次的更值得先看），
 * 二是同一行只留一条上下文——同一行里 `[[甲]] 和 [[甲]]` 写两遍，收两条
 * 一模一样的上下文只是噪音。判定口径与 findBacklinks 的匹配完全一致。
 */
function linkHitsInText(text, wantedLower) {
  const src = maskComments(text)
  const re = /\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g
  const counts = new Map()
  const snippets = []
  const seenLines = new Set()
  let m
  while ((m = re.exec(src)) !== null) {
    const target = m[1].trim()
    if (target === '') continue
    const noExt = target.replace(/\.md$/i, '')
    const base = noExt.split('/').pop() || noExt
    if (!wantedLower.has(target.toLowerCase()) && !wantedLower.has(noExt.toLowerCase()) && !wantedLower.has(base.toLowerCase())) continue
    counts.set(target, (counts.get(target) || 0) + 1)
    const lineStart = src.lastIndexOf('\n', m.index) + 1
    if (seenLines.has(lineStart)) continue
    seenLines.add(lineStart)
    const lineEndRaw = src.indexOf('\n', m.index)
    const lineEnd = lineEndRaw < 0 ? src.length : lineEndRaw
    const line = snippetOfLine(src.slice(lineStart, lineEnd))
    if (line !== '') snippets.push(line)
  }
  let count = 0
  for (const times of counts.values()) count += times
  return { links: [...counts.keys()], count, snippets }
}

/**
 * 一篇笔记对某个目标的反链命中（没有命中就返回 null）。
 *
 * 判定口径与 linkHitsInText 完全一致：完整目标 / 去扩展名 / 文件名三级宽松匹配，
 * 同一行只留一条上下文。区别只是它读的是缓存好的行，不再每换一个目标就把全库
 * 正文重新读一遍、重新切一次行。
 */
async function hitsInEntry(root, entry, wantedLower) {
  let parsed
  try {
    parsed = await linkLinesOf(root, entry)
  } catch {
    return null
  }
  const counts = new Map()
  const snippets = []
  for (const line of parsed.lines) {
    if (line.links.length === 0) continue
    let hitHere = false
    for (const target of line.links) {
      const noExt = target.replace(/\.md$/i, '')
      const base = noExt.split('/').pop() || noExt
      if (!wantedLower.has(target.toLowerCase()) && !wantedLower.has(noExt.toLowerCase()) && !wantedLower.has(base.toLowerCase())) continue
      counts.set(target, (counts.get(target) || 0) + 1)
      hitHere = true
    }
    if (!hitHere) continue
    // 同一行只留一条上下文——一行里写两遍同一个链接，收两条一样的只是噪音。
    const text = snippetOfLine(line.text)
    if (text !== '') snippets.push(text)
  }
  if (counts.size === 0) return null
  let count = 0
  for (const times of counts.values()) count += times
  return {
    path: entry.path,
    title: entry.title,
    date: entry.date,
    links: [...counts.keys()],
    // 这一篇里一共提了几次。反复提到同一篇的，通常比只提一次的更值得先看。
    count,
    // 每一处引用各自带上它所在的上下文：一篇笔记里可能三处都提到这一篇，
    // 只给「它引用了我」和路径的话，用户还得自己点进去、再在正文里搜一遍。
    // 最多三条，再多就成了把对方正文抄过来。
    snippets: snippets.slice(0, 3),
  }
}

/**
 * 一次算出「一批目标各自被谁提到」。
 *
 * 批量删除要问「这几篇里有没有被人引用」，一篇一篇调 findBacklinks 的话，
 * 选了十篇就是十遍全库读盘——而它们读的是同一批文件。这里只走一遍全库，
 * 把每一行的双链同时对十个目标比对，返回 目标 → 命中列表。
 *
 * 目标之间互不影响，所以结果与逐篇调用完全等价（排序口径也一样）。
 */
export async function findBacklinksMany(root, targets, entries) {
  const rawTargets = (Array.isArray(targets) ? targets : [])
    .map((t) => String(t === null || t === undefined ? '' : t).trim().replace(/\\/g, '/'))
    .filter((t) => t !== '')
  const out = new Map()
  for (const raw of rawTargets) out.set(raw, [])
  if (rawTargets.length === 0) return out
  const list = Array.isArray(entries) ? entries : (await scanVault(root)).entries

  const stripExt = (p) => p.replace(/\.md$/i, '')
  // 每个目标先算出「所有可能指向它的路径」，再展开成一个扁平集合——匹配时
  // 只要命中集合里任意一条就算，和 findBacklinks 的 wantedPaths 一个口径。
  const wantedByRaw = new Map()
  for (const raw of rawTargets) {
    const rawNoExt = stripExt(raw)
    const rawBase = stripExt(raw.split('/').pop() || raw)
    const rawLower = raw.toLowerCase()
    const baseLower = rawBase.toLowerCase()
    const wantedPaths = new Set()
    for (const entry of list) {
      const noExt = stripExt(entry.path)
      const base = stripExt(entry.path.split('/').pop() || entry.path)
      const title = String(entry.title || '').toLowerCase()
      if (noExt.toLowerCase() === rawNoExt.toLowerCase() || base.toLowerCase() === baseLower || title === rawLower || title === baseLower) {
        wantedPaths.add(entry.path)
        wantedPaths.add(noExt)
        wantedPaths.add(base)
      }
    }
    wantedPaths.add(raw)
    wantedPaths.add(rawNoExt)
    wantedPaths.add(rawBase)
    wantedByRaw.set(raw, new Set([...wantedPaths].map((p) => p.toLowerCase())))
  }

  for (const entry of list) {
    let parsed
    try {
      parsed = await linkLinesOf(root, entry)
    } catch {
      continue
    }
    // 这一篇里出现过的双链目标先收一遍：一篇正文通常只有几个链接，
    // 拿这几个去和 N 个目标比，比拿 N 个目标去扫每一行便宜得多。
    const seen = new Map()
    for (const line of parsed.lines) {
      for (const target of line.links) {
        const noExt = target.replace(/\.md$/i, '')
        const base = noExt.split('/').pop() || noExt
        seen.set(target, { noExt, base, line })
      }
    }
    if (seen.size === 0) continue
    for (const raw of rawTargets) {
      if (entry.path === raw) continue
      const wantedLower = wantedByRaw.get(raw)
      const counts = new Map()
      const snippets = []
      for (const [target, info] of seen) {
        if (!wantedLower.has(target.toLowerCase()) && !wantedLower.has(info.noExt.toLowerCase()) && !wantedLower.has(info.base.toLowerCase())) continue
        counts.set(target, (counts.get(target) || 0) + 1)
        const text = snippetOfLine(info.line.text)
        if (text !== '' && !snippets.includes(text)) snippets.push(text)
      }
      if (counts.size === 0) continue
      let count = 0
      for (const times of counts.values()) count += times
      out.get(raw).push({
        path: entry.path,
        title: entry.title,
        date: entry.date,
        links: [...counts.keys()],
        count,
        snippets: snippets.slice(0, 3),
      })
    }
  }
  for (const raw of rawTargets) {
    out.get(raw).sort((a, b) => (Number(b.count) || 1) - (Number(a.count) || 1) || a.title.localeCompare(b.title, 'zh'))
  }
  return out
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
    const found = await hitsInEntry(root, entry, wantedLower)
    if (found === null) continue
    hits.push(found)
  }
  // 提得多的排前面，次数相同再按标题。宿主那边（metadataCache）给的次数是同一
  // 个含义，两边排序口径必须一样，否则同一篇笔记接不接宿主会换个顺序。
  hits.sort((a, b) => (Number(b.count) || 1) - (Number(a.count) || 1) || a.title.localeCompare(b.title, 'zh'))
  return { target: raw, hits }
}

// 逐篇记忆「这篇正文里有哪些双链、各在哪些行」。
//
// 反查（谁提到我）、断链体检、待办清单都是同一件事的不同投影：都要把全库正文
// 读一遍、按行找 \[\[...\]\]。8000 篇的库上，点开一篇笔记的反链要把全库读一次；
// 换个目标再看，又整库读一次——同一批文件被反复读、反复切行。
//
// 键里带 mtimeMs 和 size，和 entryMemo 一个口径：文件真变了才换键，没变的
// 那几篇一直留着这份解析结果。缓存的是「每行原文 + 这一行里的双链目标」，
// 不含任何和目标有关的东西——所以同一份结果能喂给任意目标的匹配。
const linkMemo = new Map()
const LINK_MEMO_MAX = 20000

/**
 * 读一篇正文，取出「每个非空行 + 这一行里的双链目标」。
 *
 * 顺带把围栏代码块标出来：断链体检要跳过围栏里的 \[\[...\]\]（示例、粘贴的
 * 日志），而反查不跳（围栏里的引用也是引用）。同一份行数据带个 fenced 标记，
 * 两个用途各取所需，不必各自再切一遍行。
 */
async function linkLinesOf(root, entry) {
  const abs = resolveInside(root, entry.path).abs
  const key = `${abs}\u0000${entry.mtimeMs}\u0000${entry.bytes}`
  const hit = linkMemo.get(key)
  if (hit !== undefined) return hit
  const text = await readFile(abs, 'utf8')
  const src = maskComments(text)
  const rawLines = src.split(/\r?\n/)
  const lines = []
  let inFence = false
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i]
    const fence = /^\s*(```|~~~)/.test(line)
    if (fence) {
      inFence = !inFence
      lines.push({ no: i + 1, text: line, links: [], fenced: true })
      continue
    }
    const links = []
    const re = /\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g
    let m
    while ((m = re.exec(line)) !== null) {
      const target = m[1].trim()
      if (target !== '') links.push(target)
    }
    lines.push({ no: i + 1, text: line, links, fenced: inFence })
  }
  const value = { lines }
  linkMemo.set(key, value)
  if (linkMemo.size > LINK_MEMO_MAX) {
    const oldest = linkMemo.keys().next()
    if (!oldest.done) linkMemo.delete(oldest.value)
  }
  return value
}

/**
 * 只取「引用那一行」的上下文，不算次数、不排顺序。
 *
 * 给宿主那条路用：Obsidian 的 metadataCache 知道「谁引用了这一篇」和「引了几次」，
 * 但拿不到那一行剩下的字——它存的是链接的位置，不是上下文。面板接上宿主时反链
 * 底下就空着一行，同一篇笔记接不接宿主长得不一样。这里把「从一篇正文里挑出引用
 * 目标的那几行」单独开出来，宿主侧读一次正文就能补上，判定口径与本地扫描完全一致。
 *
 * 名字集合宽松一点没关系：多算一条上下文只是多一行字，少算才是「看着像丢了」。
 */
export function backlinkSnippets(text, names, limit = 3) {
  const wanted = new Set()
  const list = names instanceof Set ? [...names] : Array.isArray(names) ? names : []
  for (const value of list) {
    const name = String(value === null || value === undefined ? '' : value).trim().toLowerCase()
    if (name !== '') wanted.add(name)
  }
  if (wanted.size === 0) return []
  const found = linkHitsInText(String(text || ''), wanted)
  return found.snippets.slice(0, Math.max(0, limit))
}

/**
 * 把库里「可能被双链指到」的名字收成一个集合，用于断链判断。
 *
 * 双链的写法比文件路径松得多：`[[甲]]`、`[[随手记/甲]]`、`[[甲.md]]`、别名、
 * 以及标题与文件名不一致的情况，在 Obsidian 里都能指到同一篇。所以「有这一篇」
 * 不能只比路径——宁可放过，也不能把一条好好的链接报成断的（那样用户会去改一条
 * 本来没错的链接，越改越乱）。
 */
function knownLinkNames(entries) {
  const known = new Set()
  const add = (value) => {
    const name = String(value || '').trim().toLowerCase()
    if (name !== '') known.add(name)
  }
  for (const entry of entries) {
    const noExt = String(entry.path || '').replace(/\.md$/i, '')
    add(entry.path)
    add(noExt)
    add(noExt.split('/').pop() || noExt)
    add(entry.title)
    for (const alias of Array.isArray(entry.aliases) ? entry.aliases : []) add(alias)
  }
  return known
}

/** 链接目标在库里有没有对应的笔记（按路径 / 去扩展名 / 文件名 / 标题 / 别名任一层算）。 */
function linkResolves(target, known) {
  const raw = String(target || '').trim().toLowerCase()
  if (raw === '') return true
  const noExt = raw.replace(/\.md$/i, '')
  const base = noExt.split('/').pop() || noExt
  return known.has(raw) || known.has(noExt) || known.has(base)
}

/** 一行上下文：去掉标题井号、压平空白，太长两头留一点。双链本身留着，好认是哪一条。 */
function lineContext(line, width = 80) {
  const text = String(line || '').replace(/^\s*#+\s*/, '').replace(/\s+/g, ' ').trim()
  if (text.length <= width) return text
  return `${text.slice(0, width - 1).trim()}…`
}

/**
 * 断链体检：全库找「写了双链，但库里没有这一篇」的地方。
 *
 * 为什么值得单独做一遍：双链写错一个字的当时完全没感觉——点下去没反应，或者
 * 过几个月才发现有一堆死链。等发现时已经想不起来当初想指的是哪一篇了。所以
 * 除了「点的时候报错」，还要能一次性把全库的断链摊出来看。
 *
 * 跳过三类，免得报一堆假断链：
 *   · 围栏代码里的 `[[...]]`（示例、粘贴的日志）；
 *   · 指向附件 / 别的文件类型的（`![[图.png]]`、`![[说明.pdf]]`——库扫描只看 .md，
 *     但那些文件确实存在，不该被当成断链）；
 *   · `[[#小节]]`（指的是这一篇自己的某一节，没有别的笔记要指）。
 */
export async function findBrokenLinks(root, entries) {
  const list = Array.isArray(entries) ? entries : (await scanVault(root)).entries
  const known = knownLinkNames(list)
  const hits = []
  const MAX_HITS = 500
  for (const entry of list) {
    // 行数据走 linkLinesOf 那份逐篇记忆：断链体检和反查读的是同一批文件，
    // 换一个入口再看一遍全库时不该重新读盘、重新切行。围栏里的行它已经
    // 标成 fenced、双链也收成空的，这里跳过即可。
    let parsed
    try {
      parsed = await linkLinesOf(root, entry)
    } catch {
      continue
    }
    for (const line of parsed.lines) {
      if (line.fenced || line.links.length === 0) continue
      for (const rawTarget of line.links) {
        const hash = rawTarget.indexOf('#')
        const target = (hash === -1 ? rawTarget : rawTarget.slice(0, hash)).trim()
        if (target === '') continue
        // 带扩展名但不是 .md 的：那是附件或别的文件，不是笔记
        if (/\.(?!md$)[a-z0-9]{1,6}$/i.test(target)) continue
        if (linkResolves(target, known)) continue
        hits.push({
          path: entry.path,
          title: entry.title,
          line: line.no,
          target,
          text: lineContext(line.text),
        })
        if (hits.length >= MAX_HITS) break
      }
      if (hits.length >= MAX_HITS) break
    }
    if (hits.length >= MAX_HITS) break
  }
  hits.sort((a, b) => {
    const byPath = String(a.path).localeCompare(String(b.path), 'zh')
    if (byPath !== 0) return byPath
    return a.line - b.line
  })
  return { hits, scanned: list.length, truncated: hits.length >= MAX_HITS }
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
 *
 * 中间那一段 6 位十六进制是**原笔记相对路径的短哈希**（后加的）：只按文件名去重的话，
 * `随手记/甲.md` 和 `做过的项目/甲.md` 在同一毫秒撞车时会落到同一个留档名上，
 * 后写的把先写的覆盖掉——两份内容只剩一份。老名字没有这一段，所以它是可选的。
 */
const CONFLICT_NAME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z?__(?:([0-9a-f]{6})__)?(?:cloud-)?(.+)$/

/** 原笔记相对路径 → 6 位短哈希，用来区分「不同目录下同名」的两篇笔记。 */
function conflictPathHash(relPath) {
  return createHash('sha1').update(String(relPath || '')).digest('hex').slice(0, 6)
}

/**
 * 生成一份冲突留档的路径（库内相对路径）。
 *
 * 命名只在这里生成：同步引擎写本地版、以及未来任何需要留档的地方都调它，
 * 免得两处各写一套格式、解析侧再跟着改两遍。
 *
 * @param {string} relPath 正本的库内相对路径
 * @param {{cloud?: boolean, at?: Date|string|number}} [options] cloud 表示这份装的是云端版
 */
export function conflictArchiveName(relPath, options = {}) {
  const rel = normalizeRel(relPath)
  const when = options.at === undefined ? new Date() : new Date(options.at)
  // ISO 里的 : 和 . 在 Windows 上是非法文件名字符，换成 -
  const stamp = (Number.isNaN(when.getTime()) ? new Date() : when).toISOString().replace(/[:.]/g, '-')
  const name = basename(rel) || 'note.md'
  return `${CONFLICT_DIR}/${stamp}__${conflictPathHash(rel)}__${options.cloud === true ? 'cloud-' : ''}${name}`
}

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
  if (m === null) return { savedAt: null, originalName: name, cloudMarked: false, pathHash: '' }
  const ms = m[5] === undefined ? '000' : m[5]
  // 文件名里带 `cloud-` 前缀的留档，装的是**云端版**；不带的是**本地版**。
  // 两种在历史里都真实存在（同步引擎只写本地版，早期手工抢救时存过云端版），
  // 所以解析时必须把这一位带出来，否则「哪边是本地」就会看反。
  const cloudMarked = /__cloud-/.test(name)
  return {
    savedAt: `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${ms}Z`,
    originalName: m[7],
    cloudMarked,
    // 老留档没有这一段，给空串，调用方据此退回「按文件名找正本」的老办法
    pathHash: m[6] || '',
  }
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
      pathHash: parsed.pathHash,
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
    throw coreError("vault.notConflictPath", {}, { status: 400 })
  }
  const { abs } = resolveInside(root, rel)
  const text = await readFile(abs, 'utf8')
  const base = rel.slice(CONFLICT_DIR.length + 1)
  const parsed = parseConflictName(base)
  const { data, body } = parseFrontmatter(text)
  const { entries } = await scanVault(root)
  // 优先按「原路径短哈希」认回正本：同名不同目录的两篇笔记只有这一位能区分。
  // 老留档没有哈希，退回按文件名匹配（与旧行为一致）。
  const hashed = parsed.pathHash === '' ? [] : entries.filter((e) => conflictPathHash(e.path) === parsed.pathHash)
  const candidates = hashed.length > 0
    ? hashed
    : entries.filter((e) => {
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
    pathHash: parsed.pathHash,
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
    throw coreError(keepLocal === true ? "vault.conflictNoLocal" : "vault.conflictNoCloud", {}, { status: 404 })
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
    throw coreError("vault.notConflictPath", {}, { status: 400 })
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
  if (rel === '') throw coreError("vault.dirNameEmpty", {}, { status: 400 })
  // 逐级校验：normalizeRel 已经拒绝 `..`，这里再确认没有混进保留目录名，
  // 否则用户建一个叫 `.trash` 的目录会把自己的回收站搞乱。
  for (const segment of rel.split('/')) {
    if (IGNORED_DIRS.has(segment)) {
      throw coreError("vault.dirReserved", { segment }, { status: 400 })
    }
  }
  const { abs } = resolveInside(root, rel, { create: true })
  try {
    await mkdir(abs, { recursive: true })
  } catch (error) {
    throw coreError("vault.mkdirFailed", { detail: error && error.message ? error.message : error }, { status: 500 })
  }
  invalidateScan(root)
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
  if (rel === '') throw coreError("vault.cannotRemoveRoot", {}, { status: 400 })
  const { abs } = resolveInside(root, rel)
  let dirents
  try {
    dirents = await readdir(abs, { withFileTypes: true })
  } catch {
    throw coreError("vault.dirMissing", {}, { status: 404 })
  }
  const notes = dirents.filter((d) => d.isFile() && extname(d.name).toLowerCase() === NOTE_EXT)
  if (notes.length > 0) {
    throw coreError("vault.dirNotEmptyNotes", { notes: notes.length }, {
      status: 409,
      notes: notes.length,
    })
  }
  // 子目录也拦一下：删父目录会连带删掉子目录，同样容易误伤
  const subdirs = dirents.filter((d) => d.isDirectory())
  if (subdirs.length > 0) {
    throw coreError("vault.dirNotEmptyDirs", { dirs: subdirs.length }, {
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
    throw coreError("vault.rmdirFailed", { detail: error && error.message ? error.message : error }, { status: 500 })
  }
  invalidateScan(root)
  return { ok: true, path: rel }
}

/**
 * 删一个目录，连同里面的笔记一起。
 *
 * 和 removeDir 的区别：removeDir 只肯删空目录（点一下删掉几十篇是灾难），这条
 * 只在用户于确认框里明确选了「连里面的笔记一起删」之后才走。但「一起删」不等于
 * 「真删」：里面的每一篇笔记照旧先移进回收站，随时能恢复；只有目录本身（连同
 * 剩下的空子目录、附件之类非笔记文件）被真删。
 *
 * 有一篇移不进回收站就整个停下、目录留着——半个目录删掉、剩下几篇散在原地，
 * 比干脆不删更难收拾。
 */
export async function removeDirTree(root, dirInput) {
  const rel = normalizeRel(dirInput)
  if (rel === '') throw coreError("vault.cannotRemoveRoot", {}, { status: 400 })
  const { abs } = resolveInside(root, rel)
  let top
  try {
    top = await readdir(abs, { withFileTypes: true })
  } catch {
    throw coreError("vault.dirMissing", {}, { status: 404 })
  }
  // 先收集这个目录底下所有笔记（含子目录）。目录树的遍历走一遍就够了，
  // 后面 trashNote 只认文件、不依赖目录还在不在。
  const notes = []
  let dirCount = 0
  const walk = async (dirAbs, dirRel) => {
    let list
    try {
      list = await readdir(dirAbs, { withFileTypes: true })
    } catch {
      return
    }
    for (const dirent of list) {
      const childRel = dirRel === '' ? dirent.name : `${dirRel}/${dirent.name}`
      if (dirent.isDirectory()) {
        // 插件自己的保留目录（.trash/.history/...）不参与，也不计入子目录数
        if (IGNORED_DIRS.has(dirent.name)) continue
        dirCount += 1
        await walk(join(dirAbs, dirent.name), childRel)
        continue
      }
      if (!dirent.isFile()) continue
      if (extname(dirent.name).toLowerCase() !== NOTE_EXT) continue
      notes.push(childRel)
    }
  }
  await walk(abs, rel)
  const failed = []
  let trashed = 0
  for (const noteRel of notes) {
    try {
      await trashNote(root, noteRel)
      trashed += 1
    } catch (error) {
      failed.push({ path: noteRel, error: error && error.message ? error.message : String(error) })
    }
  }
  if (failed.length > 0) {
    invalidateScan(root)
    throw coreError("vault.trashMoveFailed", { failed: failed.length }, {
      status: 409,
      failed,
      notes: trashed,
    })
  }
  try {
    // 笔记都搬走了，剩下的是空子目录和附件之类的非笔记文件：这里才允许递归删。
    // removeDir 故意不用 recursive:true，是因为它删的是「已确认的空目录」；
    // 这条路径已经把该搬的都搬走了，剩下的内容不再有可恢复的价值。
    await rm(abs, { recursive: true, force: true })
  } catch (error) {
    throw coreError("vault.rmdirFailed", { detail: error && error.message ? error.message : error }, { status: 500 })
  }
  invalidateScan(root)
  return { ok: true, path: rel, notes: trashed, dirs: dirCount }
}

/**
 * 给一个目录改名（连同底下的笔记和子目录一起搬过去）。
 *
 * 目录名就是磁盘上的文件夹名，改名等于 `rename(旧, 新)`——一条系统调用搬走整棵子树，
 * 不用逐篇挪、也不会出现「搬了一半」的中间状态。三处要拦：
 * 1. 新名字为空、或和旧的一模一样：空名字没有意义，同名算成功但别白跑一趟。
 * 2. 新名字撞上已存在的目录/文件：rename 在 Windows 上会直接覆盖同名空目录，
 *    在别处会报 ENOTEMPTY，两种都不该由用户来猜，先 409 说清楚。
 * 3. 新名字混进插件保留目录名（`.trash`、`.history` 等）：和 createDir 同款校验。
 * 搬完把 `.history` 里对应的快照目录也搬过去，否则改完名字历史会像凭空消失。
 */
export async function renameDir(root, fromInput, toInput) {
  const from = normalizeRel(fromInput)
  const to = normalizeRel(toInput)
  if (from === '') throw coreError("vault.renameRoot", {}, { status: 400 })
  if (to === '') throw coreError("vault.newDirNameEmpty", {}, { status: 400 })
  if (from === to) return { ok: true, from, to, unchanged: true }
  for (const segment of to.split('/')) {
    if (IGNORED_DIRS.has(segment)) {
      throw coreError("vault.dirReserved", { segment }, { status: 400 })
    }
  }
  const { abs: srcAbs } = resolveInside(root, from)
  let srcStat
  try {
    srcStat = await stat(srcAbs)
  } catch {
    throw coreError("vault.dirMissing", {}, { status: 404 })
  }
  if (!srcStat.isDirectory()) throw coreError("vault.notADirectory", {}, { status: 400 })
  const { abs: dstAbs, rel: dstRel } = resolveInside(root, to, { create: true })
  try {
    await stat(dstAbs)
    throw coreError("vault.dirExists", { path: dstRel }, { status: 409 })
  } catch (error) {
    if (error && error.status === 409) throw error
  }
  try {
    await mkdir(dirname(dstAbs), { recursive: true })
    await rename(srcAbs, dstAbs)
  } catch (error) {
    throw coreError("vault.renameDirFailed", { detail: error && error.message ? error.message : error }, {
      status: 500,
    })
  }
  // 快照目录跟着走。搬不动不算失败（见 moveHistoryEntries 的注释）。
  await moveHistoryEntries(root, from, to)
  invalidateScan(root)
  return { ok: true, from, to }
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
  if (tag === '') throw coreError("vault.tagNameEmpty", {}, { status: 400 })
  const snapshot = typeof options.snapshot === 'function' ? options.snapshot : null
  let changed = 0
  const failed = []
  for (const entry of entries) {
    const current = Array.isArray(entry.tags) ? entry.tags : []
    if (!current.includes(tag)) continue
    try {
      const note = await readNote(root, entry.path)
      const text = note.content
      // 用 readTags 读真实标签而不是信 entry.tags：entry 是扫描时的快照，
      // 而块列表写法下两者可能不一致，按快照算会把残留项留在文件里。
      const actual = readTags(text)
      // 正文标签只归正文管：混进 base 的话，删掉正文那个标签时它会被写回头部，
      // 于是「删了」只是搬了个位置。
      const inlineSet = new Set(extractInlineTags(note.body))
      const base = (actual.length > 0 ? actual : current).filter((t) => !inlineSet.has(t))
      // 正文里那个 `#标签` 也要抹掉，不然头部删了、正文还留着，下次扫描它又冒出来。
      const withHead = rewriteTags(text, base.filter((t) => t !== tag))
      const updated = applyInlineTagEdit(withHead, tag, '')
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
  if (from === '') throw coreError("vault.fromTagEmpty", {}, { status: 400 })
  if (to === '') throw coreError("vault.newTagNameEmpty", {}, { status: 400 })
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
      // 同 removeTag：正文标签不混进头部那份，否则改个名会在头部多出一个副本。
      const inlineSet = new Set(extractInlineTags(note.body))
      const base = (actual.length > 0 ? actual : current).filter((t) => !inlineSet.has(t))
      const next = []
      for (const tag of base) {
        const value = tag === from ? to : tag
        // 目标标签本来就在这篇里时不要写两遍
        if (!next.includes(value)) next.push(value)
      }
      // 正文里的 `#旧名` 一起改成新名：只改头部的话，标签云里会同时出现新旧两个，
      // 而用户看到的「改名」应该是一处不落。
      const updated = applyInlineTagEdit(rewriteTags(text, next), from, to)
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
 * 把全库里指向 `from` 的双链，一起改成指向 `to`。
 *
 * 为什么需要：断链绝大多数是名字打错一个字。清单上那一组「指不到的名字」往往就是
 * 库里另一篇的错写，正确的做法是把那几处链接改对，而不是补一篇同名的空笔记——
 * 补出来之后库里就有两篇讲同一件事的了，而原来那篇还是没人引。
 *
 * 只改双链的**目标段**：`[[错名#小节]]` 里的小节、`[[错名|显示文字]]` 里的显示
 * 文字都原样留着，用户写下的那一句读起来不变。围栏代码里的 `[[...]]` 不动——
 * 断链体检本来就不把它们算进来，改了清单上也看不出来，只是白改。
 */
export async function rewriteLinkTarget(root, fromInput, toInput, entries, options = {}) {
  const from = String(fromInput || '').trim()
  const to = String(toInput || '').trim()
  if (from === '') throw coreError("vault.fromLinkEmpty", {}, { status: 400 })
  if (to === '') throw coreError("vault.toLinkEmpty", {}, { status: 400 })
  const list = Array.isArray(entries) ? entries : (await scanVault(root)).entries
  if (from === to) return { ok: true, changed: 0, failed: [], total: list.length, from, to, files: [] }
  const want = from.toLowerCase()
  const snapshot = typeof options.snapshot === 'function' ? options.snapshot : null
  let changed = 0
  const files = []
  const failed = []
  for (const entry of list) {
    let parsed
    try {
      parsed = await linkLinesOf(root, entry)
    } catch {
      continue
    }
    // 先拿缓存的行数据筛一遍：这一篇里根本没有这个名字就整篇跳过，不用读盘。
    const hasIt = parsed.lines.some((line) => {
      if (line.fenced) return false
      return line.links.some((raw) => {
        const hash = raw.indexOf('#')
        return (hash === -1 ? raw : raw.slice(0, hash)).trim().toLowerCase() === want
      })
    })
    if (!hasIt) continue
    try {
      const note = await readNote(root, entry.path)
      const fenced = new Set()
      for (const line of parsed.lines) if (line.fenced) fenced.add(line.no)
      // 换行风格跟着原文件走：整篇重写时把 CRLF 统一成 LF，会让这篇在 git 里
      // 显示成「全篇都改了」，而用户只改了一个名字。
      const sep = note.content.includes('\r\n') ? '\r\n' : '\n'
      const lines = note.content.split(/\r?\n/)
      let touched = false
      const next = lines.map((line, i) => {
        if (fenced.has(i + 1)) return line
        return line.replace(/\[\[([^\]\n|]*?)(\|[^\]\n]*)?\]\]/g, (all, rawTarget, label) => {
          const hash = rawTarget.indexOf('#')
          const head = (hash === -1 ? rawTarget : rawTarget.slice(0, hash)).trim()
          if (head.toLowerCase() !== want) return all
          touched = true
          const section = hash === -1 ? '' : rawTarget.slice(hash)
          return '[[' + to + section + (label === undefined ? '' : label) + ']]'
        })
      })
      if (!touched) continue
      const updated = next.join(sep)
      if (updated === note.content) continue
      if (snapshot) {
        try {
          await snapshot(entry.path)
        } catch {
          /* 历史存不下不该阻塞改写本身 */
        }
      }
      await writeNote(root, entry.path, updated, { backup: snapshot === null })
      changed += 1
      files.push(entry.path)
    } catch (error) {
      failed.push({ path: entry.path, error: error && error.message ? error.message : String(error) })
    }
  }
  return { ok: true, changed, failed, total: list.length, from, to, files }
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
    throw coreError("vault.todoIndexInvalid", {}, { status: 400 })
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
    throw coreError("vault.todoMissing", {}, { status: 404 })
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
 * 全库待办：把每一篇里还没勾掉的方框收成一张单子。
 *
 * 为什么值得单独做一遍：待办写在正文里，一篇一篇翻才能知道「还有哪些没做完」。
 * 宿主自己有「搜索 - [ ]」，但那要用户先知道这条语法；面板的待办页签是
 * 「打开就能看见还剩什么」，勾一下当场就翻。
 *
 * 跳过围栏里的方框（那是示例代码）、跳过注释里的（宿主里根本不显示）。
 * 已勾掉的不列——这一页的用处是「还剩什么」，做完的东西留在笔记里就好。
 */
export async function listOpenTodos(root, entries) {
  const list = Array.isArray(entries) ? entries : (await scanVault(root)).entries
  const items = []
  const MAX_ITEMS = 500
  for (const entry of list) {
    let text
    try {
      text = await readFile(resolveInside(root, entry.path).abs, 'utf8')
    } catch {
      continue
    }
    const lines = maskComments(text).split(/\r?\n/)
    let inFence = false
    let index = -1
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence
        continue
      }
      if (inFence) continue
      const m = /^(\s*)([-*+]) \[( |x|X)\]\s+(.*)$/.exec(line)
      if (m === null) continue
      // 序号必须与 toggleTodo 完全一致：它逐行数方框（已勾的也算），这里
      // 也不能把已勾的跳过——跳过了序号就会错位，点一下勾错的是别人那一行。
      index += 1
      if (m[3].toLowerCase() === 'x') continue
      const content = m[4].trim()
      items.push({
        path: entry.path,
        title: entry.title,
        line: i + 1,
        index,
        text: content,
        // 行尾的标签单独挑出来当胶囊：待办列表里最常问的是「这是哪一类的」
        tags: extractInlineTags(content),
      })
      if (items.length >= MAX_ITEMS) break
    }
    if (items.length >= MAX_ITEMS) break
  }
  items.sort((a, b) => {
    const byPath = String(a.path).localeCompare(String(b.path), 'zh')
    if (byPath !== 0) return byPath
    return a.line - b.line
  })
  return { items, scanned: list.length, truncated: items.length >= MAX_ITEMS }
}

/**
 * 正文里写的 `#标签` 也是标签。
 *
 * Obsidian 里标签有两个地方能写：frontmatter 的 `tags:`，以及正文里随手一个
 * `#生活`。宿主两个都认，面板原来只认前一个——用户明明在正文里打了标签，
 * 标签云里没有它、点它也筛不出这一篇，而同一个标签写在头部就一切正常。
 * 这种「一处能用一处不能」最难自查，所以正文里的也要收。
 *
 * 不认的几种：围栏代码块里的（那是代码）、行内代码里的、行首的 `# 标题`
 * （井号后面跟空格是标题）、`https://x/#section` 这种 URL 片段（井号前面
 * 是斜杠）、纯数字的（Obsidian 也不把 `#123` 当标签）。
 */
function isTagBody(value) {
  const body = String(value || '')
  if (body === '') return false
  if (!/^[\w\u4e00-\u9fa5/-]+$/.test(body)) return false
  // 纯数字不是标签；结尾挂个斜杠也不是（那是路径，不是嵌套标签）
  if (/^[\d/]+$/.test(body)) return false
  if (body.endsWith('/')) return false
  return true
}

const TAG_TOKEN_RE = /(^|[\s([{>（【，、；：])#([^\s#`]+)/g

export function extractInlineTags(text) {
  const out = []
  const seen = new Set()
  let inFence = false
  for (const rawLine of maskComments(text).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    // 行内代码里的井号是字面量，先整段抹掉再找
    const line = rawLine.replace(/`[^`\n]*`/g, ' ')
    TAG_TOKEN_RE.lastIndex = 0
    let m
    while ((m = TAG_TOKEN_RE.exec(line)) !== null) {
      const body = m[2]
      if (!isTagBody(body)) continue
      if (seen.has(body)) continue
      seen.add(body)
      out.push(body)
    }
  }
  return out
}

/** 把全文拆成「frontmatter 原文」与「正文」，用于只在正文里改东西。 */
function splitFrontmatterText(text) {
  const src = String(text == null ? '' : text)
  if (!/^---\r?\n/.test(src)) return { head: '', body: src }
  const end = src.indexOf('\n---', 4)
  if (end === -1) return { head: '', body: src }
  const close = src.indexOf('\n', end + 1)
  if (close === -1) return { head: src, body: '' }
  return { head: src.slice(0, close + 1), body: src.slice(close + 1) }
}

/**
 * 在正文里改一个正文标签：`to` 为空串就是删掉。
 *
 * 只碰正文，不碰 frontmatter——头部那份由 rewriteTags 负责，两边分开改才不会
 * 把用户手写的字段顺序和注释搅乱。围栏代码块与行内代码原样跳过。
 */
export function applyInlineTagEdit(text, from, to) {
  const fromTag = String(from || '').trim()
  if (fromTag === '') return String(text == null ? '' : text)
  const nextTag = String(to == null ? '' : to).trim()
  const { head, body } = splitFrontmatterText(text)
  let inFence = false
  const lines = body.split('\n').map((rawLine) => {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence
      return rawLine
    }
    if (inFence) return rawLine
    return rawLine.replace(TAG_TOKEN_RE, (whole, lead, bodyText) => {
      if (!isTagBody(bodyText) || bodyText !== fromTag) return whole
      if (nextTag === '') return lead
      return `${lead}#${nextTag}`
    })
  })
  return head + lines.join('\n')
}

/**
 * 把 frontmatter 里读出来的 tags 统一成字符串数组。
 *
 * 为什么需要：`tags: 甲` 是合法的 YAML（单个标签不写方括号），而 `tags: [甲, 乙]`
 * 是数组。手写笔记里两种都会出现，如果各处直接 `Array.isArray(data.tags)` 判断，
 * 单值写法就会被当成「没有标签」——最典型的后果是 `tag:甲` 搜不到那篇笔记，
 * 用户明明看着标签在那儿却搜不出来。
 */
/** 头部标签与正文标签合一份：保持头部顺序，正文里多出来的接在后面，去重。 */
export function mergeTags(head, inline) {
  const out = []
  const seen = new Set()
  for (const tag of [...(Array.isArray(head) ? head : []), ...(Array.isArray(inline) ? inline : [])]) {
    const value = String(tag || '').trim()
    if (value === '' || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

export function normalizeTags(value) {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter((tag) => tag !== '')
  if (value === undefined || value === null) return []
  const single = String(value).trim()
  return single === '' ? [] : [single]
}

/**
 * 把 frontmatter 里的别名统一成字符串数组。
 *
 * 宿主的约定是 `aliases`（手写笔记里也常见 `alias`、`别名`）。别名是「这篇
 * 笔记的另一个名字」：写了之后 `[[那个名字]]` 就该指到这一篇。这里只做归并，
 * 不判断谁优先——撞名时真实文件名/标题更该赢，那一步交给调用方。
 */
export function normalizeAliases(value) {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item === null || item === undefined ? '' : item).trim())
      .filter((item) => item !== '')
  }
  const single = String(value).trim()
  return single === '' ? [] : [single]
}

/**
 * 一篇笔记的正文里，有哪些「名字」会指向它。
 *
 * 双链的写法比文件路径松：`[[甲]]`、`[[随手记/甲]]`、`[[甲.md]]`、标题、
 * 以及头部里写的别名，在 Obsidian 里都指得到同一篇。所以「谁引用了这篇」不能只
 * 比路径。这里把这一篇的所有可能名字收成一个数组，交给 backlinkSnippets 去正文里
 * 挑行——两边（面板本地扫描、宿主侧补上下文）用同一份口径，才不会出现「本地能
 * 找到、接上宿主就少一条」。
 */
export function linkNamesOf(entry) {
  const path = String((entry && entry.path) || '').trim()
  if (path === '') return []
  const noExt = path.replace(/\.md$/i, '')
  const base = noExt.split('/').pop() || noExt
  const names = [path, noExt, base]
  const title = String((entry && entry.title) || '').trim()
  if (title !== '') names.push(title)
  for (const alias of normalizeAliases(entry && entry.aliases)) names.push(alias)
  return names
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

/**
 * 库内目录列表（用于新建笔记时的目标目录下拉）。
 *
 * 空目录也算：新建时最想挑的往往正是那个刚建好、还空着的目录。
 */
export function listDirs(entries, emptyDirs = []) {
  const dirs = new Set([''])
  for (const dir of emptyDirs) {
    if (typeof dir !== 'string' || dir === '') continue
    let acc = ''
    for (const segment of dir.split('/')) {
      acc = acc === '' ? segment : `${acc}/${segment}`
      dirs.add(acc)
    }
  }
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
