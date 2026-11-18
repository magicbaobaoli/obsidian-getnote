/**
 * vfs.js —— 文件系统适配层（本插件唯一的新基础设施）
 *
 * 为什么要这一层：
 *   DSH 版的所有文件操作都直接调 node:fs，路径是**绝对路径**。搬到 Obsidian 里，
 *   如果继续这么写，Obsidian 的文件索引、双链解析、metadataCache 都不会知道文件变了
 *   ——用户会看到「文件改了但侧栏还是旧的」。正确做法是走 app.vault.adapter。
 *
 * 但把 65KB 的 vault.js 从「绝对路径 + node:fs」改写成「相对路径 + adapter」是一次
 * 大面积重写，风险高、收益低。所以这里换一个方向：
 *
 *   保持上层 API 完全不变（还是绝对路径，还是 readdir/readFile/stat…），
 *   只在**这一层**把绝对路径翻译成 vault 相对路径，再交给 adapter。
 *
 * 好处：
 *   · vault.js / archive.js / history.js / cloud-sync.js / sync.js 的算法一行都不用改，
 *     原有的 1053 项离线测试可以原样继续跑（它们走 node 后端）。
 *   · 运行时走 adapter 后端，Obsidian 能感知到每一次写入。
 *   · 将来如果 Obsidian 的 adapter API 变了，只改这一个文件。
 *
 * 两个后端：
 *   · node 后端（默认）：直接 node:fs，测试用；
 *   · adapter 后端：configure({ adapter, basePath }) 之后启用，插件运行时用。
 */

import * as nodefs from 'node:fs/promises'
import { dirname as nodeDirname } from 'node:path'

let adapter = null
let basePath = ''

/** 切到 Obsidian adapter 后端。basePath 是库根的绝对路径（adapter.getBasePath()）。 */
export function configure(options = {}) {
  adapter = options.adapter || null
  basePath = String(options.basePath || '').replace(/\\/g, '/').replace(/\/+$/, '')
}

/** 回到 node 后端（测试与 Node 环境用）。 */
export function reset() {
  adapter = null
  basePath = ''
}

export function isAdapterMode() {
  return adapter !== null
}

function enoent(p) {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${p}'`), { code: 'ENOENT', path: p })
}

function eexist(p) {
  return Object.assign(new Error(`EEXIST: file already exists, '${p}'`), { code: 'EEXIST', path: p })
}

function enotdir(p) {
  return Object.assign(new Error(`ENOTDIR: not a directory, '${p}'`), { code: 'ENOTDIR', path: p })
}

/** 绝对路径 → 库内相对路径（POSIX）。越界直接抛 400，和 DSH 版的 resolveInside 同一套语义。 */
function relOf(abs) {
  const raw = String(abs == null ? '' : abs).replace(/\\/g, '/')
  if (basePath === '') return raw.replace(/^\/+/, '')
  if (raw === basePath) return ''
  if (raw.toLowerCase().startsWith(basePath.toLowerCase() + '/')) return raw.slice(basePath.length + 1)
  // 库根本身可能是 / 结尾（比如 D:\ 这种盘符根），再兜一次
  if (basePath === '/' && raw.startsWith('/')) return raw.slice(1)
  throw Object.assign(new Error(`path escapes vault root: ${abs}`), { status: 400 })
}

function dirent(name, isDir) {
  return {
    name,
    parentPath: '',
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  }
}

function wrapStat(st, p) {
  const isDir = st.type === 'folder'
  return {
    size: Number(st.size || 0),
    mtime: new Date(Number(st.mtime || 0)),
    mtimeMs: Number(st.mtime || 0),
    ctime: new Date(Number(st.ctime || 0)),
    ctimeMs: Number(st.ctime || 0),
    atime: new Date(Number(st.mtime || 0)),
    birthtime: new Date(Number(st.ctime || 0)),
    mode: 0o644,
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
    path: p,
  }
}

async function adapterExists(rel) {
  try {
    return await adapter.exists(rel)
  } catch {
    return false
  }
}

// ── 读 ───────────────────────────────────────────────────────────────────────

export async function readdir(dir, options = {}) {
  if (!adapter) return nodefs.readdir(dir, options)
  const rel = relOf(dir)
  if (!(await adapterExists(rel))) throw enoent(dir)
  const listed = await adapter.list(rel)
  const folders = Array.isArray(listed.folders) ? listed.folders : []
  const files = Array.isArray(listed.files) ? listed.files : []
  if (options && options.withFileTypes) {
    return [...folders.map((name) => dirent(name, true)), ...files.map((name) => dirent(name, false))]
  }
  return [...folders, ...files]
}

export async function readFile(file, encoding) {
  if (!adapter) return encoding ? nodefs.readFile(file, encoding) : nodefs.readFile(file)
  const rel = relOf(file)
  if (!(await adapterExists(rel))) throw enoent(file)
  if (encoding) return adapter.read(rel)
  const buf = await adapter.readBinary(rel)
  return Buffer.from(buf)
}

export async function stat(file) {
  if (!adapter) return nodefs.stat(file)
  const rel = relOf(file)
  const st = await adapter.stat(rel)
  if (!st) throw enoent(file)
  return wrapStat(st, file)
}

export async function lstat(file) {
  if (!adapter) return nodefs.lstat(file)
  return stat(file)
}

export async function realpath(file) {
  if (!adapter) return nodefs.realpath(file)
  // adapter 层面没有符号链接概念，原样返回即可
  return file
}

export async function access(file) {
  if (!adapter) return nodefs.access(file)
  if (!(await adapterExists(relOf(file)))) throw enoent(file)
}

// ── 写 ───────────────────────────────────────────────────────────────────────

export async function mkdir(dir, options = {}) {
  if (!adapter) return nodefs.mkdir(dir, options)
  const rel = relOf(dir)
  if (rel === '' || (await adapterExists(rel))) return undefined
  await adapter.mkdir(rel)
  return undefined
}

export async function writeFile(file, data, options) {
  if (!adapter) return nodefs.writeFile(file, data, options)
  const rel = relOf(file)
  const flags = typeof options === 'string' ? '' : String((options && options.flag) || '')
  if (flags.includes('x') && (await adapterExists(rel))) throw eexist(file)
  const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  if (parent !== '' && !(await adapterExists(parent))) await adapter.mkdir(parent)
  if (typeof data === 'string') await adapter.write(rel, data)
  else await adapter.writeBinary(rel, data)
}

export async function appendFile(file, data, options) {
  if (!adapter) return nodefs.appendFile(file, data, options)
  const rel = relOf(file)
  if (typeof data === 'string') await adapter.append(rel, data)
  else await adapter.appendBinary(rel, data)
}

export async function rename(from, to) {
  if (!adapter) return nodefs.rename(from, to)
  const relFrom = relOf(from)
  const relTo = relOf(to)
  const parent = relTo.includes('/') ? relTo.slice(0, relTo.lastIndexOf('/')) : ''
  if (parent !== '' && !(await adapterExists(parent))) await adapter.mkdir(parent)
  await adapter.rename(relFrom, relTo)
}

export async function copyFile(from, to) {
  if (!adapter) return nodefs.copyFile(from, to)
  const relFrom = relOf(from)
  const relTo = relOf(to)
  if (typeof adapter.copy === 'function') {
    await adapter.copy(relFrom, relTo)
    return
  }
  const buf = await adapter.readBinary(relFrom)
  await adapter.writeBinary(relTo, buf)
}

export async function rm(target, options = {}) {
  if (!adapter) return nodefs.rm(target, options)
  const rel = relOf(target)
  if (!(await adapterExists(rel))) {
    if (options && options.force) return
    throw enoent(target)
  }
  await adapter.remove(rel)
}

export async function rmdir(dir) {
  if (!adapter) return nodefs.rmdir(dir)
  const rel = relOf(dir)
  if (!(await adapterExists(rel))) throw enoent(dir)
  await adapter.rmdir(rel, false)
}

export async function unlink(file) {
  if (!adapter) return nodefs.unlink(file)
  const rel = relOf(file)
  if (!(await adapterExists(rel))) throw enoent(file)
  await adapter.remove(rel)
}

export async function chmod() {
  // Windows 上 chmod 本来就只影响只读位；adapter 没有这个能力，静默成功即可。
  return undefined
}

export async function utimes() {
  return undefined
}

/** 仅用于调试：当前后端名字。 */
export function backendName() {
  return adapter ? 'obsidian-adapter' : 'node-fs'
}

export { nodeDirname }
