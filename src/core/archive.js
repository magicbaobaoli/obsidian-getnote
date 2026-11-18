/**
 * dsh-getnote — 整库打包 / 解包（zip，零依赖）
 *
 * 为什么自己实现 ZIP：本插件对外的第一条承诺是「零外部依赖、装进任何 DSH 都能跑」。
 * 为了一个导出备份去引 archiver / jszip，会把安装体积、供应链风险和升级耦合一起
 * 推上去；而 zip 真正必需的东西只有两样——store/deflate 两种压缩方式 + CRC32，
 * 加起来是几百行可控代码，所以这里只用 node:zlib 的同步接口自己拼字节。
 *
 * 刻意**不支持 zip64**：超过 4GB 时直接报错。静默截断、或者写坏一个 4GB 归档，
 * 比在导出那一刻说「请分批」要糟得多——备份文件最不该在解包时才发现不对劲。
 *
 * 导出侧的选择：不跳 `asset/`（录音、图片就是用户要备份的东西），但跳过 `.bak`
 * （那是 writeNote 留下的历史副本，属于同一份数据的旧版本，打进去只会让归档翻倍）。
 */
import { readdir, readFile, writeFile, mkdir, lstat } from './vfs.js'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { Buffer } from 'node:buffer'
import { parseFrontmatter } from './vault.js'

// zip 的四个结构签名。读写两侧都靠它们定位，写错了解压器直接一句「归档已损坏」。
const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50

// general purpose bit 11：声明「文件名是 UTF-8」。
// 不设这一位时，解压方按 CP437 或本地代码页解释文件名，中文名进了 Windows 资源
// 管理器就是一串乱码；更实际的问题是文件名一变，附件（`标题_note_id_audio.mp3`）
// 就再也认不回自己的笔记了。所以打包时必须一直带着这一位。
const FLAG_UTF8 = 0x0800

const METHOD_STORE = 0
const METHOD_DEFLATE = 8

const ZIP64_MARK = 0xffffffff
const MAX_ENTRIES = 0xffff // 不写 zip64 时条目数上限就是 65535
const EOCD_MAX_SCAN = 65557 // EOCD(22) + 最长注释(65535)，从尾部往前最多扫这么多
const CRC_TABLE_SIZE = 256

/** 导出时整目录跳过的目录名（按名字匹配，任意层级都生效）。 */
const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.obsidian',
  '.trash',
  '.conflicts',
  '.history',
  '.dsh',
  '$RECYCLE.BIN',
  '__MACOSX',
  '.venv',
])

/**
 * 导入时允许落到 `asset/` 目录里的附件扩展名。
 * 收得很窄是故意的：归档是外部输入，别人塞一个 `.exe` / `.js` 进来，落到库目录里
 * 就变成了「用户双击就执行」的东西。只认笔记和媒体附件，其余一律跳过。
 */
const ALLOWED_ASSET_EXT = new Set([
  'mp3', 'ogg', 'm4a', 'wav', 'aac', 'flac',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp',
  'pdf', 'txt', 'json',
])

const MB = 1024 * 1024
const INDEX_NOTE_MAX = 2 * MB // 建 note_id 索引时单篇最多读这么多（正文头部足够）
const MAX_INDEX_DEPTH = 12

function fail(status, message) {
  return Object.assign(new Error(message), { status })
}

/** 人类可读的字节数。上限可能被调到小于 1MB，取整成「0MB」会写出不成立的文案。 */
function formatBytes(n) {
  if (n >= MB) {
    const mb = Math.round((n / MB) * 10) / 10
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`
  }
  if (n >= 1024) return `${Math.round((n / 1024) * 10) / 10}KB`
  return `${n} 字节`
}

// ── CRC32 ────────────────────────────────────────────────────────────────────

let crcTableCache = null

/**
 * CRC32 查表（IEEE 802.3 多项式 0xEDB88320，zip 规定的那个）。
 *
 * 必须自己算：几乎每个解压器——Windows 资源管理器、macOS 归档工具、unzip——都会
 * 拿 CRC 校验每个条目，写错一位整包就报「归档已损坏」。
 *
 * 表在首次调用时惰性生成：256 项、每项 8 次移位，一次性的成本可以忽略，而把表
 * 挂在模块顶层常量里会让「只是想 import 一下这个模块」也付这笔钱。
 */
function crcTable() {
  if (crcTableCache) return crcTableCache
  const table = new Uint32Array(CRC_TABLE_SIZE)
  for (let i = 0; i < CRC_TABLE_SIZE; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  crcTableCache = table
  return crcTableCache
}

/** 计算一段字节的 zip CRC32（无符号 32 位）。 */
export function crc32(buf) {
  const table = crcTable()
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ── zip 写入 ─────────────────────────────────────────────────────────────────

/** 文件时间 → DOS 时间/日期两个 16 位字段（zip 只认这个精度，2 秒一跳）。 */
function dosDateTime(when) {
  const d = when instanceof Date && !Number.isNaN(when.getTime()) ? when : new Date()
  const year = d.getFullYear()
  // DOS 年份从 1980 起算，7 位；更早的时间夹到 1980，否则会写出非法字段。
  const y = Math.max(0, Math.min(127, year - 1980))
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    date: (y << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

function assertFits32(value, what) {
  if (value > ZIP64_MARK) {
    throw fail(413, `${what} 超过 4GB，暂不支持 zip64，请分批导出`)
  }
}

/**
 * 决定一个条目怎么进归档，并真正压出字节。
 *
 * 单独抽出来是为了让「导出返回的 entries.method」和「写进包里的方法」出自同一次
 * 计算——否则两处各判一次，遇到边界（压缩后正好一样长）就会出现元信息骗人的情况。
 *
 * 默认策略：压不小就用 store。mp3/png 已经是压缩格式，硬 deflate 只会更慢更大。
 */
function packEntry(file) {
  const data = Buffer.isBuffer(file?.data)
    ? file.data
    : file.data instanceof Uint8Array
      ? Buffer.from(file.data)
      : Buffer.from(String(file?.data ?? ''), 'utf8')

  const forced = file?.method
  if (forced === METHOD_STORE || forced === 'store') {
    return { data, crc: crc32(data), method: METHOD_STORE, body: data }
  }
  if (forced === METHOD_DEFLATE || forced === 'deflate') {
    return {
      data,
      crc: crc32(data),
      method: METHOD_DEFLATE,
      body: data.length === 0 ? data : deflateRawSync(data, { level: 6 }),
    }
  }
  const deflated = data.length === 0 ? data : deflateRawSync(data, { level: 6 })
  return deflated.length < data.length
    ? { data, crc: crc32(data), method: METHOD_DEFLATE, body: deflated }
    : { data, crc: crc32(data), method: METHOD_STORE, body: data }
}

/**
 * 编码一个 zip：返回字节和每个条目的元信息（导出侧要用它回填 entries）。
 *
 * **不做任何过滤与路径校验**（导出用它打包、测试用它造故意畸形的归档）。
 * 真正的安全检查在 importZipToVault 里。
 */
function encodeZip(files) {
  if (!Array.isArray(files)) throw fail(400, 'files 必须是数组')
  if (files.length > MAX_ENTRIES) {
    throw fail(413, `条目超过 ${MAX_ENTRIES} 个，暂不支持 zip64，请分批导出`)
  }

  const chunks = []
  const records = []
  let offset = 0

  for (const file of files) {
    const name = String(file?.path ?? file?.name ?? '').replace(/\\/g, '/')
    if (name === '') throw fail(400, 'zip 条目缺少文件名')
    const nameBuf = Buffer.from(name, 'utf8')
    if (nameBuf.length > 0xffff) throw fail(400, `文件名过长：${name}`)

    const { data, crc, method, body } = packEntry(file)
    const { time, date } = dosDateTime(file.mtime)
    assertFits32(offset, '归档偏移')
    assertFits32(body.length, '压缩后大小')

    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4) // 解压所需版本 2.0（deflate 的最低要求）
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra 字段留空，不留任何厂商私有块

    chunks.push(local, nameBuf, body)
    records.push({
      name,
      nameBuf,
      method,
      crc,
      time,
      date,
      compressedSize: body.length,
      uncompressedSize: data.length,
      localOffset: offset,
    })
    offset += 30 + nameBuf.length + body.length
  }

  // 中央目录：解压器真正读的是这里，local header 只是数据定位用的壳。
  const centralChunks = []
  let cdSize = 0
  for (const rec of records) {
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(SIG_CENTRAL, 0)
    cd.writeUInt16LE(20, 4) // version made by
    cd.writeUInt16LE(20, 6) // version needed
    cd.writeUInt16LE(FLAG_UTF8, 8)
    cd.writeUInt16LE(rec.method, 10)
    cd.writeUInt16LE(rec.time, 12)
    cd.writeUInt16LE(rec.date, 14)
    cd.writeUInt32LE(rec.crc, 16)
    cd.writeUInt32LE(rec.compressedSize, 20)
    cd.writeUInt32LE(rec.uncompressedSize, 24)
    cd.writeUInt16LE(rec.nameBuf.length, 28)
    cd.writeUInt16LE(0, 30) // extra len
    cd.writeUInt16LE(0, 32) // comment len
    cd.writeUInt16LE(0, 34) // disk number start
    cd.writeUInt16LE(0, 36) // internal attrs
    cd.writeUInt32LE(0, 38) // external attrs
    cd.writeUInt32LE(rec.localOffset, 42)
    centralChunks.push(cd, rec.nameBuf)
    cdSize += 46 + rec.nameBuf.length
  }

  assertFits32(offset, '中央目录偏移')
  assertFits32(cdSize, '中央目录大小')

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(0, 4) // 本分卷号
  eocd.writeUInt16LE(0, 6) // 中央目录所在分卷号
  eocd.writeUInt16LE(records.length, 8) // 本分卷条目数
  eocd.writeUInt16LE(records.length, 10) // 总条目数
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20) // 注释长度：0

  return {
    buffer: Buffer.concat([...chunks, ...centralChunks, eocd]),
    entries: records.map((r) => ({
      path: r.name,
      bytes: r.uncompressedSize,
      compressedBytes: r.compressedSize,
      method: r.method,
      crc: r.crc,
    })),
  }
}

/** 把若干条目拼成一个 zip Buffer（测试造归档、以及内部打包都走它）。 */
export function buildZipBuffer(files) {
  return encodeZip(files).buffer
}

// ── zip 读取 ─────────────────────────────────────────────────────────────────

/** 从尾部往前找 EOCD。用注释长度自校验，避免命中文档数据里恰好出现的同样四字节。 */
function findEocd(buffer) {
  const min = Math.max(0, buffer.length - EOCD_MAX_SCAN)
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) !== SIG_EOCD) continue
    const commentLen = buffer.readUInt16LE(i + 20)
    if (i + 22 + commentLen === buffer.length) return i
  }
  return -1
}

/** 读中央目录，得到每个条目的元信息（不碰文件数据）。 */
function readZipIndex(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw fail(400, '归档损坏：不是有效的 zip 文件')
  }
  const eocd = findEocd(buffer)
  if (eocd < 0) throw fail(400, '归档损坏：找不到 zip 目录尾')

  const total = buffer.readUInt16LE(eocd + 10)
  const cdSize = buffer.readUInt32LE(eocd + 12)
  const cdOffset = buffer.readUInt32LE(eocd + 16)
  if (total === 0xffff || cdSize === ZIP64_MARK || cdOffset === ZIP64_MARK) {
    throw fail(400, '暂不支持 zip64 归档（超过 4GB）')
  }
  if (cdOffset + cdSize > buffer.length) throw fail(400, '归档损坏：中央目录越界')

  const out = []
  let pos = cdOffset
  for (let i = 0; i < total; i += 1) {
    if (pos + 46 > buffer.length) throw fail(400, '归档损坏：中央目录被截断')
    if (buffer.readUInt32LE(pos) !== SIG_CENTRAL) throw fail(400, '归档损坏：中央目录签名不对')

    const method = buffer.readUInt16LE(pos + 10)
    const crc = buffer.readUInt32LE(pos + 16)
    const compressedSize = buffer.readUInt32LE(pos + 20)
    const uncompressedSize = buffer.readUInt32LE(pos + 24)
    const nameLen = buffer.readUInt16LE(pos + 28)
    const extraLen = buffer.readUInt16LE(pos + 30)
    const commentLen = buffer.readUInt16LE(pos + 32)
    const localOffset = buffer.readUInt32LE(pos + 42)
    if (pos + 46 + nameLen + extraLen + commentLen > buffer.length) {
      throw fail(400, '归档损坏：中央目录条目越界')
    }
    // 文件名一律按 UTF-8 解：本插件写出去的包都带 bit 11，而现实中绝大多数工具
    // 也已经按 UTF-8 写中文名了；万一遇到老包（CP437），得到的是一串替换字符，
    // 后续的路径/扩展名白名单会把它挡掉，不会造成错误写入。
    const name = buffer.toString('utf8', pos + 46, pos + 46 + nameLen)
    out.push({ name, method, crc, compressedSize, uncompressedSize, localOffset })
    pos += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/**
 * 按中央目录给出的元信息，从 local header 算出数据起点并解压。
 * 解压后必须校验 CRC——归档可能是被截断、被改过、或者传输中坏掉的文件。
 */
function readEntryData(buffer, entry, maxBytes) {
  const base = entry.localOffset
  if (base + 30 > buffer.length) throw fail(400, `归档损坏：${entry.name} 本地头越界`)
  if (buffer.readUInt32LE(base) !== SIG_LOCAL) {
    throw fail(400, `归档损坏：${entry.name} 本地头签名不对`)
  }
  // local header 里的 nameLen/extraLen 可能与中央目录不同（扩展字段可以只写在这两处
  // 之一），所以偏移必须用 local header 自己的那两个值来算。
  const nameLen = buffer.readUInt16LE(base + 26)
  const extraLen = buffer.readUInt16LE(base + 28)
  const start = base + 30 + nameLen + extraLen
  const end = start + entry.compressedSize
  if (end > buffer.length) throw fail(400, `归档损坏：${entry.name} 数据被截断`)

  const raw = buffer.subarray(start, end)
  let data
  if (entry.method === METHOD_STORE) {
    data = Buffer.from(raw)
  } else if (entry.method === METHOD_DEFLATE) {
    try {
      data = inflateRawSync(raw)
    } catch {
      throw fail(400, `归档损坏：${entry.name} 解压失败`)
    }
  } else {
    throw fail(400, `暂不支持压缩方式 ${entry.method}：${entry.name}`)
  }

  // 防解压炸弹：中央目录声明的 size 可以撒谎，解压后的真实长度才算数。
  if (data.length > maxBytes) throw fail(413, `归档内文件过大：${entry.name}`)
  if (crc32(data) !== entry.crc) throw fail(400, `归档损坏：${entry.name} 校验失败`)
  return data
}

// ── 路径与类型判定 ───────────────────────────────────────────────────────────

/**
 * 把归档里的文件名归一化成库内相对路径；不安全就返回 null。
 *
 * 归档是外部输入，里面的 `../evil.md`、`/etc/x`、`C:\x` 都不能直接落到磁盘上——
 * 那等于让任何一份 zip 都能写到库外面去。
 */
function safeEntryRel(name) {
  let raw = String(name ?? '')
  if (raw === '' || raw.includes('\0')) return null
  raw = raw.replace(/\\/g, '/')
  if (raw.startsWith('/')) return null // POSIX 绝对路径
  if (/^[A-Za-z]:/.test(raw)) return null // Windows 盘符
  const parts = raw.split('/').filter((p) => p !== '' && p !== '.')
  if (parts.length === 0) return null
  if (parts.some((p) => p === '..')) return null
  return parts.join('/')
}

/** 只收 `.md` 和 `asset/` 下的媒体附件，其它一律拒绝（见 ALLOWED_ASSET_EXT 注释）。 */
function isAllowedEntry(rel) {
  const lower = rel.toLowerCase()
  if (lower.endsWith('.md')) return true
  if (!/(^|\/)asset\//.test(lower)) return false
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return false
  return ALLOWED_ASSET_EXT.has(lower.slice(dot + 1))
}

/** 相对库根解析绝对路径；解析结果跑出库根就返回 null。 */
function absInside(absRoot, rel) {
  const abs = resolve(absRoot, rel.split('/').join(sep))
  const back = relative(absRoot, abs)
  if (back === '' || back.startsWith('..') || isAbsolute(back)) return null
  return abs
}

async function existsAt(abs) {
  try {
    await lstat(abs)
    return true
  } catch {
    return false
  }
}

/**
 * 不覆盖式写入：`wx` 让「目标已存在」变成一个 EEXIST 错误而不是静默覆盖。
 * 这是最后一道保险——即使前面的 existsAt 检查被并发改文件骗过去，也不会毁数据。
 */
async function writeNoClobber(abs, data) {
  try {
    await writeFile(abs, data, { flag: 'wx' })
    return true
  } catch (err) {
    if (err?.code === 'EEXIST') return false
    if (err?.code === 'EISDIR' || err?.code === 'ENOTDIR') return false
    throw err
  }
}

/** 撞名后的候选名：`笔记.md` → `笔记-2.md`、`笔记-3.md`…（上限 99）。 */
function renameCandidates(rel) {
  const slash = rel.lastIndexOf('/')
  const dir = slash === -1 ? '' : rel.slice(0, slash)
  const base = slash === -1 ? rel : rel.slice(slash + 1)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  const out = []
  for (let i = 2; i <= 99; i += 1) out.push(dir === '' ? `${stem}-${i}${ext}` : `${dir}/${stem}-${i}${ext}`)
  return out
}

/** 扫库建 note_id 索引：判断「同一篇笔记已经在了吗」只能靠它。 */
async function indexNoteIds(absRoot) {
  const ids = new Set()
  const walk = async (dirAbs, depth) => {
    if (depth > MAX_INDEX_DEPTH) return
    let items
    try {
      items = await readdir(dirAbs, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of items) {
      if (item.isDirectory()) {
        if (IGNORED_DIRS.has(item.name)) continue
        await walk(join(dirAbs, item.name), depth + 1)
        continue
      }
      if (!item.isFile() || !item.name.toLowerCase().endsWith('.md')) continue
      const abs = join(dirAbs, item.name)
      try {
        const st = await lstat(abs)
        if (!st.isFile() || st.size > INDEX_NOTE_MAX) continue
        const text = await readFile(abs, 'utf8')
        const id = String(parseFrontmatter(text).data?.note_id ?? '').trim()
        if (id !== '') ids.add(id)
      } catch {
        // 读不到就当没有：索引只用于「多留一个 -2」的判定，不该让导入失败
      }
    }
  }
  await walk(absRoot, 0)
  return ids
}

// ── 导出 ─────────────────────────────────────────────────────────────────────

/**
 * 把库根目录下的所有文件打成一个 zip。
 *
 * @param {string} root 库根绝对路径
 * @param {{maxBytes?: number, maxFileBytes?: number, maxTotalBytes?: number}} [options]
 * @returns {Promise<{buffer: Buffer, entries: Array<{path: string, bytes: number, method: number, crc: number}>, bytes: number, sourceBytes: number}>}
 *          `bytes` 是归档本身的大小；`sourceBytes` 是被打进去的原始字节总数。
 */
export async function exportVaultToZip(root, options = {}) {
  // 导出范围：'all' 整库、'notes' 只要 Markdown、'assets' 只要附件。
  // 库里附件常常比笔记大两个数量级（录音、图片），只想备份文字的人没必要
  // 每次拖一个几百兆的包下来。
  const scope = options.scope === 'notes' || options.scope === 'assets' ? options.scope : 'all'
  // 只导出某个子目录（库内相对路径，空串表示整库）。
  const onlyDir = typeof options.dir === 'string' ? options.dir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : ''
  const maxBytes = options.maxBytes ?? 512 * MB
  const maxFileBytes = options.maxFileBytes ?? 64 * MB
  const maxTotalBytes = options.maxTotalBytes ?? 512 * MB
  // 两个都是单文件上限，取更严的那个：maxBytes 是「不许塞进来的大文件」，
  // maxFileBytes 是「单个文件最多读多少」，任一超了就跳过。
  const fileLimit = Math.min(maxBytes, maxFileBytes)
  const absRoot = resolve(root)

  const found = []
  const walk = async (dirAbs, relDir) => {
    let items
    try {
      items = await readdir(dirAbs, { withFileTypes: true })
    } catch {
      return
    }
    // 排序只为让同一份库每次导出的字节顺序稳定，便于比对与复现问题。
    items.sort((a, b) => a.name.localeCompare(b.name, 'en'))
    for (const item of items) {
      const rel = relDir === '' ? item.name : `${relDir}/${item.name}`
      // 指定了子目录：只在它下面走，别处的直接跳过（整棵子树都不进）。
      if (onlyDir !== '' && !(rel === onlyDir || rel.startsWith(onlyDir + '/'))) continue
      if (item.isDirectory()) {
        if (IGNORED_DIRS.has(item.name)) continue
        await walk(join(dirAbs, item.name), rel)
        continue
      }
      // 符号链接/设备文件一律不跟：跟出去可能读到库外，跟成环还可能转不出来。
      if (!item.isFile()) continue
      if (item.name.endsWith('.bak')) continue // 历史副本，不是用户要备份的内容
      if (scope === 'notes' && !item.name.endsWith('.md')) continue
      if (scope === 'assets' && item.name.endsWith('.md')) continue
      let st
      try {
        st = await lstat(join(dirAbs, item.name))
      } catch {
        continue
      }
      if (!st.isFile()) continue
      if (st.size > fileLimit) continue // 超大文件不进归档，也不记进 entries
      found.push({ rel, abs: join(dirAbs, item.name), size: st.size, mtime: st.mtime })
    }
  }
  await walk(absRoot, '')

  const totalSize = found.reduce((sum, f) => sum + f.size, 0)
  if (totalSize > maxTotalBytes) {
    throw fail(413, `归档超过 ${formatBytes(maxTotalBytes)}，请分批导出`)
  }

  const files = []
  for (const f of found) {
    let data
    try {
      data = await readFile(f.abs)
    } catch {
      continue // 扫完到读之间的窗口里被删/被锁：跳过，不因此让整个导出失败
    }
    files.push({ path: f.rel, data, mtime: f.mtime })
  }

  const { buffer, entries } = encodeZip(files)

  return {
    buffer,
    entries,
    bytes: buffer.length,
    sourceBytes: files.reduce((sum, f) => sum + f.data.length, 0),
  }
}

// ── 导入 ─────────────────────────────────────────────────────────────────────

/**
 * 把一个 zip 解到库根目录，**绝不覆盖已有文件**。
 *
 * 为什么不覆盖：导入是「把备份里的东西补回来」，不是同步。用户在面板里改过的正文
 * 一旦被一份旧归档盖掉就永久丢了，而多出一个 `-2` 文件最多是碍眼——两种失败的
 * 代价完全不对等，所以默认 `mode: 'rename'`（保住两边），想干净点可以传 `'skip'`。
 *
 * @param {string} root 库根绝对路径（不存在会自动创建）
 * @param {Buffer|Uint8Array} buffer zip 字节
 * @param {{mode?: 'rename'|'skip', maxFileBytes?: number}} [options]
 * @returns {Promise<{written: number, skipped: number, conflicts: number, entries: Array<{path: string, bytes: number, action: 'written'|'renamed'|'skipped'}>, warnings: string[]}>}
 */
export async function importZipToVault(root, buffer, options = {}) {
  const mode = options.mode === 'skip' ? 'skip' : 'rename'
  const maxFileBytes = options.maxFileBytes ?? 64 * MB
  // 请求体可能给的是 Uint8Array 而不是 Buffer，统一一下再往下走。
  const zip = Buffer.isBuffer(buffer)
    ? buffer
    : buffer instanceof Uint8Array
      ? Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : null
  if (zip === null) throw fail(400, '归档内容必须是二进制 Buffer')

  const absRoot = resolve(root)
  const index = readZipIndex(zip) // 结构坏了在这里就抛，不留半截写入
  await mkdir(absRoot, { recursive: true })

  const knownIds = await indexNoteIds(absRoot)
  const used = new Set() // 本次导入已占用的库内路径（zip 内同名条目要互相让步）
  const entries = []
  const warnings = []
  let written = 0
  let skipped = 0
  let conflicts = 0

  for (const item of index) {
    const declaredBytes = item.uncompressedSize
    const rel = safeEntryRel(item.name)
    if (rel === null) {
      skipped += 1
      warnings.push(`跳过不安全的归档路径：${item.name}`)
      entries.push({ path: item.name, bytes: declaredBytes, action: 'skipped' })
      continue
    }
    if (!isAllowedEntry(rel)) {
      skipped += 1
      entries.push({ path: rel, bytes: declaredBytes, action: 'skipped' })
      continue
    }
    if (declaredBytes > maxFileBytes) {
      skipped += 1
      warnings.push(`跳过大文件：${rel}（${declaredBytes} 字节）`)
      entries.push({ path: rel, bytes: declaredBytes, action: 'skipped' })
      continue
    }

    const data = readEntryData(zip, item, maxFileBytes)

    // 归一化之后还要再过一次绝对路径包含性校验。Windows 上 `a:b.md` 这种带冒号的
    // 名字会被 resolve 当成「盘符相对路径」解析到库外去，safeEntryRel 拦不住它，
    // 只能在真正落地前用 relative 再确认一次。宁可当不安全跳过，也不写出去。
    const absTarget = absInside(absRoot, rel)
    if (absTarget === null) {
      skipped += 1
      warnings.push(`跳过不安全的归档路径：${item.name}`)
      entries.push({ path: rel, bytes: data.length, action: 'skipped' })
      continue
    }

    // 同一篇笔记的判据是 frontmatter 里的 note_id，而不是文件名：用户改过标题、
    // 云端标题和本地标题不一致时（实测就是不一致），只有 note_id 是稳的。
    let noteId = ''
    if (rel.toLowerCase().endsWith('.md')) {
      noteId = String(parseFrontmatter(data.toString('utf8')).data?.note_id ?? '').trim()
    }

    const pathTaken = used.has(rel) || (await existsAt(absTarget))
    const conflict = pathTaken || (noteId !== '' && knownIds.has(noteId))
    if (conflict) conflicts += 1

    if (conflict && mode === 'skip') {
      skipped += 1
      entries.push({ path: rel, bytes: data.length, action: 'skipped' })
      continue
    }

    const candidates = conflict ? renameCandidates(rel) : [rel]
    let finalRel = null
    let action = null
    for (const cand of candidates) {
      if (used.has(cand)) continue
      const abs = absInside(absRoot, cand)
      if (abs === null) continue
      try {
        await mkdir(dirname(abs), { recursive: true }) // 每个目录自动 mkdir -p
      } catch {
        continue
      }
      if (await writeNoClobber(abs, data)) {
        finalRel = cand
        action = cand === rel ? 'written' : 'renamed'
        break
      }
    }

    if (finalRel === null) {
      // 99 个候选名都被占了（或者父路径是个文件）：认输并如实计入 skipped。
      skipped += 1
      entries.push({ path: rel, bytes: data.length, action: 'skipped' })
      continue
    }

    used.add(finalRel)
    if (noteId !== '') knownIds.add(noteId)
    written += 1
    entries.push({ path: finalRel, bytes: data.length, action })
  }

  return { written, skipped, conflicts, entries, warnings }
}
