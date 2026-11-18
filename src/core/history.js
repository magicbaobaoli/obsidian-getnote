/**
 * dsh-getnote — 笔记版本历史（覆盖前留快照）
 *
 * 为什么需要这一层：面板里「编辑后保存」和「同步覆盖」都会写正本文件，用户一次手滑
 * 或者一次不想要的同步，正文就没了。vault.js 的 `.bak` 只能留**上一版**，且下一次
 * 保存就被顶掉，救不了「上午还在、下午发现丢了」。这里给每篇笔记一个独立的快照目录
 * `<库根>/.history/<key>/`，保留最近 N 版，让「覆盖」这件事变成可回看的。
 *
 * 设计上的三个约束：
 * 1. 快照必须是**普通 .md 文件**：用户能直接拿 Obsidian / 记事本打开看，不需要本插件。
 * 2. 文件名必须**跨平台安全**：Windows 文件名不允许 `:`，所以时间戳不能照抄 ISO 8601，
 *    冒号一律换成 `-`（`YYYY-MM-DDTHH-mm-ss-SSSZ`）。
 * 3. 目录名必须**限长**：笔记的相对路径可以很长（中文目录 + 日期前缀 + 长标题），
 *    直接拿来当目录名会撞上 Windows 的 260 字符路径限制，导致快照静默写失败。
 *    所以超过 120 字符时用内容哈希替换尾部——既保住可读前缀，又保住唯一性。
 */
import { readdir, readFile, writeFile, rename, mkdir, stat, rm } from './vfs.js'
import { dirname, join, resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

/** 快照根目录名（在笔记库根下）。 */
export const HISTORY_DIR = '.history'
/** 每篇笔记默认保留多少版（含刚存进去的那一版）。 */
export const HISTORY_LIMIT = 10

/** 单篇快照上限：和 vault.js 的 MAX_READ/MAX_WRITE 保持一致，2MB。 */
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
/** historyKeyFor 的输出长度上限（字符数，不是字节数）。 */
const KEY_MAX = 120
/** 超长时保留的 sha1 前缀位数。 */
const KEY_HASH_LEN = 16
/** Windows 非法文件名字符 + 控制字符。注意 `\` 也要去掉。 */
const ILLEGAL_NAME = /[<>:"\\|?*\u0000-\u001f\u007f]/g
/** `2026-11-13T10-20-30-123Z` 前缀（不带 .md，允许后面跟 `-2` 这类去重后缀）。 */
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/

function sha1(text) {
  return createHash('sha1').update(String(text), 'utf8').digest('hex')
}

function badInput(message) {
  return Object.assign(new Error(message || '非法的路径'), { status: 400 })
}

function notFound() {
  return Object.assign(new Error('这一版快照不在了'), { status: 404 })
}

function isMissing(error) {
  return Boolean(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

/** limit 归一化：至少留 1 版，非法值回落到默认值。 */
function clampLimit(limit) {
  const n = Number(limit)
  if (!Number.isFinite(n)) return HISTORY_LIMIT
  return Math.max(1, Math.floor(n))
}

/**
 * 库内相对路径 → 分段数组。拒绝空路径、`..` 逃逸和 Windows 盘符开头，
 * 这样 `resolve(root, ...parts)` 的结果一定还在库根里（不依赖外部模块，history.js 可单独测试）。
 */
function splitRel(relPath) {
  if (typeof relPath !== 'string' || relPath.trim() === '') throw badInput('笔记路径不能为空')
  const parts = relPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.')
  if (parts.length === 0) throw badInput('笔记路径不能为空')
  if (parts.some((seg) => seg === '..')) throw badInput('path escapes vault root')
  if (/^[a-zA-Z]:$/.test(parts[0])) throw badInput('笔记路径必须是库内相对路径')
  return parts
}

/**
 * 相对路径 → 安全的快照目录名。
 *
 * 规则：`/` → `__`（目录层级压平成一层，避免跟着笔记目录一起被移动/删除），
 * 再删掉 Windows 非法字符与控制字符。中文原样保留——用户要能在文件管理器里
 * 认出这是哪篇笔记的快照。
 *
 * 长度上限 120：Windows 的路径总长限制很紧（传统 260），库根本身已经很长，
 * 再叠一层中文长标题就会超。超长时保留前 103 个字符 + `-` + sha1 前 16 位，
 * 正好 120；哈希取的是**完整** key，所以前 103 字相同的两篇不会撞目录。
 */
export function historyKeyFor(relPath) {
  const parts = String(relPath == null ? '' : relPath)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.' && seg !== '..')
  // 先拼（`/` → `__`），再删非法字符：顺序反了的话 `/` 已经被当成分隔符切过了。
  let key = parts.join('__')
  const before = key
  key = key.replace(ILLEGAL_NAME, '')
  if (key === '' || /^\.+$/.test(key)) {
    // 整条路径都是非法字符（或只有点）时兜底，绝不让 key 变成 `.`/`..` 这样的目录名。
    key = `note-${sha1(before)}`.slice(0, KEY_MAX)
  }
  // Windows 不允许文件名以点或空格结尾，顺手剪掉。
  key = key.replace(/[. ]+$/, '')
  if (key === '') key = `note-${sha1(before)}`

  const chars = Array.from(key) // 按码点计数，避免把 emoji 的代理对切成半个
  if (chars.length > KEY_MAX) {
    const head = chars.slice(0, KEY_MAX - KEY_HASH_LEN - 1).join('')
    key = `${head}-${sha1(key).slice(0, KEY_HASH_LEN)}`
  }
  return key
}

/** 现在 → 文件名时间戳 `YYYY-MM-DDTHH-mm-ss-SSSZ`（UTC，冒号换成 `-`）。 */
function stampLabel(now) {
  const ms = now instanceof Date ? now.getTime() : Number(now)
  const t = Number.isFinite(ms) ? ms : Date.now()
  // toISOString 一定带毫秒：2026-11-13T10:20:30.123Z → 2026-11-13T10-20-30-123Z
  // 冒号和点都不能出现在 Windows 文件名里，所以两种都换成 `-`。
  return new Date(t).toISOString().replace(/[:.]/g, '-')
}

/** 文件名 → { ms, iso }；不是本模块写出的名字就返回 null（由调用方回落到 mtime）。 */
function parseStamp(name) {
  const m = STAMP_RE.exec(name)
  if (!m) return null
  const [, y, mo, d, h, mi, s, ms] = m
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return { ms: t, iso }
}

/** 同一毫秒的去重后缀 `-2` / `-3` → 序号，用于让「后来写的那版」排在前面。 */
function seqOf(name) {
  const m = /Z-(\d+)\.md$/i.exec(name)
  return m ? Number(m[1]) : 1
}

/** 读一个快照目录，按时间倒序返回（目录不存在返回空数组）。 */
async function readSnapshots(dirAbs) {
  let names
  try {
    names = await readdir(dirAbs)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
  const items = []
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.md')) continue
    let st
    try {
      st = await stat(join(dirAbs, name))
    } catch {
      continue
    }
    if (!st.isFile()) continue
    const stamp = parseStamp(name)
    items.push({
      name,
      bytes: st.size,
      mtimeMs: st.mtimeMs,
      savedAt: stamp ? stamp.iso : new Date(st.mtimeMs).toISOString(),
      _ms: stamp ? stamp.ms : st.mtimeMs,
      _seq: seqOf(name),
    })
  }
  items.sort((a, b) => b._ms - a._ms || b._seq - a._seq || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
  return items
}

/** 把目录裁到最多 keep 版，返回 { pruned, kept }。 */
async function pruneDir(dirAbs, keep) {
  const items = await readSnapshots(dirAbs)
  const survivors = items.slice(0, keep)
  let pruned = 0
  for (const item of items.slice(keep)) {
    try {
      await rm(join(dirAbs, item.name), { force: true })
      pruned += 1
    } catch {
      // 删失败（被占用/权限）不该让整个快照流程失败，下一轮 pruneHistory 会再试。
    }
  }
  return { pruned, kept: survivors.length }
}

/**
 * 在覆盖一篇笔记**之前**调用：把当前内容复制成 `<root>/.history/<key>/<时间戳>.md`。
 *
 * - 文件不存在 → `{ saved: false, reason: 'missing' }`（新建笔记没有「上一版」）
 * - 超过 2MB → `{ saved: false, reason: 'too-large' }`（和读写上限一致，快照会拖慢保存）
 * - 成功后按 limit 清理旧版，`limit` 包含刚存进去的这一版
 *
 * `now` 只影响文件名，不参与内容判断——测试要能确定性地断言文件名。
 */
export async function snapshotNote(root, relPath, { now = Date.now(), limit = HISTORY_LIMIT } = {}) {
  const parts = splitRel(relPath)
  const abs = resolve(root, ...parts)

  let st
  try {
    st = await stat(abs)
  } catch (error) {
    if (isMissing(error)) return { saved: false, reason: 'missing' }
    throw error
  }
  if (!st.isFile()) return { saved: false, reason: 'missing' }
  if (st.size > MAX_SNAPSHOT_BYTES) return { saved: false, reason: 'too-large' }

  // 按字节读、按字节写：快照要的是「原样」，不经过 utf8 重新编码。
  const buf = await readFile(abs)
  if (buf.length > MAX_SNAPSHOT_BYTES) return { saved: false, reason: 'too-large' }

  const key = historyKeyFor(parts.join('/'))
  const dirAbs = join(root, HISTORY_DIR, key)
  await mkdir(dirAbs, { recursive: true })

  const base = stampLabel(now)
  let name = ''
  for (let i = 1; i <= 999; i += 1) {
    const candidate = i === 1 ? `${base}.md` : `${base}-${i}.md`
    try {
      // 'wx'：文件已存在就报 EEXIST。同一毫秒调两次不会互相覆盖——这正是加 -2 后缀的时机。
      await writeFile(join(dirAbs, candidate), buf, { flag: 'wx' })
      name = candidate
      break
    } catch (error) {
      if (error && error.code === 'EEXIST') continue
      throw error
    }
  }
  if (name === '') throw Object.assign(new Error('同一毫秒的快照过多'), { status: 409 })

  await pruneDir(dirAbs, clampLimit(limit))
  return { saved: true, path: `${HISTORY_DIR}/${key}/${name}`, bytes: buf.length }
}

/**
 * 列出一篇笔记的版本，最新的在前。
 * `savedAt` 从文件名解析（解析不出就用 mtime），这样即使用户拷来拷去、mtime 被打乱，
 * 界面上的排序仍然是「什么时候存的那一版」。
 */
export async function listHistory(root, relPath, { limit = 50 } = {}) {
  const parts = splitRel(relPath)
  const key = historyKeyFor(parts.join('/'))
  const dirAbs = join(root, HISTORY_DIR, key)
  const items = await readSnapshots(dirAbs)
  const cap = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 50
  return items.slice(0, cap).map((item) => ({
    name: item.name,
    path: `${HISTORY_DIR}/${key}/${item.name}`,
    bytes: item.bytes,
    mtimeMs: item.mtimeMs,
    savedAt: item.savedAt,
  }))
}

/**
 * 读某一版的内容。
 *
 * `name` 直接来自 listHistory，但它是从 HTTP 请求里回传的，所以必须当成不可信输入校验：
 * 含 `/`、`\`、`..` 的一律拒绝——否则一个 `../../随手记/x.md` 就能读到库外文件。
 */
export async function readHistoryEntry(root, relPath, name) {
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..') {
    throw badInput('非法的快照名')
  }
  if (name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\u0000')) {
    throw badInput('非法的快照名')
  }
  const parts = splitRel(relPath)
  const key = historyKeyFor(parts.join('/'))
  const abs = join(root, HISTORY_DIR, key, name)
  let st
  try {
    st = await stat(abs)
  } catch (error) {
    if (isMissing(error)) throw notFound()
    throw error
  }
  if (!st.isFile()) throw notFound()
  let buf
  try {
    buf = await readFile(abs)
  } catch (error) {
    if (isMissing(error)) throw notFound()
    throw error
  }
  const stamp = parseStamp(name)
  return {
    name,
    path: `${HISTORY_DIR}/${key}/${name}`,
    content: buf.toString('utf8'),
    bytes: buf.length,
    savedAt: stamp ? stamp.iso : new Date(st.mtimeMs).toISOString(),
  }
}

/** 先写同目录临时文件再 rename：读者（和同步逻辑）永远看不到「写了一半」的正文。 */
async function atomicWrite(abs, content) {
  // 随机后缀而不是毫秒时间戳：同一毫秒里两篇笔记同时存历史时，
  // 只用 Date.now 会算出同一个临时文件名，互相截断。
  const tmp = `${abs}.${process.pid}.${Date.now().toString(36)}.${randomBytes(3).toString('hex')}.tmp`
  await writeFile(tmp, content, 'utf8')
  try {
    await rename(tmp, abs)
    return
  } catch (first) {
    // Windows 上目标被别的进程（Obsidian 编辑器）短暂占用时 rename 会失败：
    // 先删目标再改名兜底一次，仍失败才把错误抛出去，同时清掉临时文件。
    try {
      await rm(abs, { force: true })
      await rename(tmp, abs)
      return
    } catch {
      await rm(tmp, { force: true }).catch(() => {})
      throw first
    }
  }
}

/**
 * 把某一版内容恢复到笔记正本。
 *
 * **为什么恢复前还要再存一版**：恢复本身也是一次覆盖。如果用户点错版本，或者点到
 * 「恢复」之后发现现在这一版其实更好，没有这一步的话，当前正文就被永久丢掉了——
 * 而用户此刻是来「找回东西」的，不该再丢一次。所以 keepCurrent !== false 时先
 * snapshotNote 当前正本，让恢复这个动作本身也可撤销。
 *
 * 恢复后**不删**任何快照：用户常常在几版之间反复横跳对比，删掉就意味着只能恢复一次。
 */
export async function restoreHistoryEntry(root, relPath, name, { keepCurrent = true } = {}) {
  // 先确认这一版真的读得出来，再动正本：避免「快照坏了 + 正文已被覆盖」的双重损失。
  const entry = await readHistoryEntry(root, relPath, name)
  const parts = splitRel(relPath)
  const abs = resolve(root, ...parts)

  let hadSnapshot = false
  if (keepCurrent !== false) {
    // 注意：这里也要传 relPath 而不是 abs，snapshotNote 只接受库内相对路径。
    const snap = await snapshotNote(root, parts.join('/'))
    hadSnapshot = snap.saved === true
  }

  await mkdir(dirname(abs), { recursive: true })
  await atomicWrite(abs, entry.content)
  return { restored: true, path: parts.join('/'), from: name, hadSnapshot }
}

/**
 * 全库清理：每个笔记的 history 目录只留最近 limit 版。
 * 返回 { pruned, kept } 都是**快照条数**（不是目录数），方便面板显示「清掉了 N 版」。
 */
export async function pruneHistory(root, { limit = HISTORY_LIMIT } = {}) {
  const keep = clampLimit(limit)
  const base = join(root, HISTORY_DIR)
  let entries
  try {
    entries = await readdir(base, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) return { pruned: 0, kept: 0 }
    throw error
  }
  let pruned = 0
  let kept = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const result = await pruneDir(join(base, entry.name), keep)
    pruned += result.pruned
    kept += result.kept
  }
  return { pruned, kept }
}
