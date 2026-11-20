var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn2, res) => function __init() {
  return fn2 && (res = (0, fn2[__getOwnPropNames(fn2)[0]])(fn2 = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/core/vfs.js
function configure(options = {}) {
  adapter = options.adapter || null;
  basePath = String(options.basePath || "").replace(/\\/g, "/").replace(/\/+$/, "");
}
function enoent(p3) {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${p3}'`), { code: "ENOENT", path: p3 });
}
function eexist(p3) {
  return Object.assign(new Error(`EEXIST: file already exists, '${p3}'`), { code: "EEXIST", path: p3 });
}
function relOf(abs) {
  const raw = String(abs == null ? "" : abs).replace(/\\/g, "/");
  if (basePath === "") return raw.replace(/^\/+/, "");
  if (raw === basePath) return "";
  if (raw.toLowerCase().startsWith(basePath.toLowerCase() + "/")) return raw.slice(basePath.length + 1);
  if (basePath === "/" && raw.startsWith("/")) return raw.slice(1);
  throw Object.assign(new Error(`path escapes vault root: ${abs}`), { status: 400 });
}
function dirent(name, isDir) {
  return {
    name,
    parentPath: "",
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false
  };
}
function wrapStat(st, p3) {
  const isDir = st.type === "folder";
  return {
    size: Number(st.size || 0),
    mtime: new Date(Number(st.mtime || 0)),
    mtimeMs: Number(st.mtime || 0),
    ctime: new Date(Number(st.ctime || 0)),
    ctimeMs: Number(st.ctime || 0),
    atime: new Date(Number(st.mtime || 0)),
    birthtime: new Date(Number(st.ctime || 0)),
    mode: 420,
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
    path: p3
  };
}
async function adapterExists(rel) {
  try {
    return await adapter.exists(rel);
  } catch {
    return false;
  }
}
function entryName(entry) {
  const raw = String(entry == null ? "" : entry).replace(/\\/g, "/").replace(/\/+$/, "");
  const cut = raw.lastIndexOf("/");
  return cut >= 0 ? raw.slice(cut + 1) : raw;
}
async function readdir2(dir, options = {}) {
  if (!adapter) return nodefs.readdir(dir, options);
  const rel = relOf(dir);
  if (rel !== "" && !await adapterExists(rel)) throw enoent(dir);
  const listed = await adapter.list(rel);
  const folders = (Array.isArray(listed.folders) ? listed.folders : []).map(entryName).filter(Boolean);
  const files = (Array.isArray(listed.files) ? listed.files : []).map(entryName).filter(Boolean);
  if (options && options.withFileTypes) {
    return [...folders.map((name) => dirent(name, true)), ...files.map((name) => dirent(name, false))];
  }
  return [...folders, ...files];
}
async function readFile2(file, encoding) {
  if (!adapter) return encoding ? nodefs.readFile(file, encoding) : nodefs.readFile(file);
  const rel = relOf(file);
  if (!await adapterExists(rel)) throw enoent(file);
  if (encoding) return adapter.read(rel);
  const buf = await adapter.readBinary(rel);
  return Buffer.from(buf);
}
async function stat2(file) {
  if (!adapter) return nodefs.stat(file);
  const rel = relOf(file);
  const st = await adapter.stat(rel);
  if (!st) throw enoent(file);
  return wrapStat(st, file);
}
async function lstat2(file) {
  if (!adapter) return nodefs.lstat(file);
  return stat2(file);
}
async function access2(file) {
  if (!adapter) return nodefs.access(file);
  if (!await adapterExists(relOf(file))) throw enoent(file);
}
async function ensureDir(rel) {
  if (rel === "" || await adapterExists(rel)) return;
  const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
  await ensureDir(parent);
  await adapter.mkdir(rel);
}
async function mkdir2(dir, options = {}) {
  if (!adapter) return nodefs.mkdir(dir, options);
  const rel = relOf(dir);
  if (rel === "") return void 0;
  await ensureDir(rel);
  return void 0;
}
async function writeFile2(file, data, options) {
  if (!adapter) return nodefs.writeFile(file, data, options);
  const rel = relOf(file);
  const flags = typeof options === "string" ? "" : String(options && options.flag || "");
  if (flags.includes("x") && await adapterExists(rel)) throw eexist(file);
  await ensureDir(rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
  if (typeof data === "string") await adapter.write(rel, data);
  else await adapter.writeBinary(rel, data);
}
async function rename2(from, to) {
  if (!adapter) return nodefs.rename(from, to);
  const relFrom = relOf(from);
  const relTo = relOf(to);
  await ensureDir(relTo.includes("/") ? relTo.slice(0, relTo.lastIndexOf("/")) : "");
  if (typeof adapter.rename === "function") {
    await adapter.rename(relFrom, relTo);
    return;
  }
  const buf = await adapter.readBinary(relFrom);
  await adapter.writeBinary(relTo, buf);
  await adapter.remove(relFrom);
}
async function copyFile2(from, to) {
  if (!adapter) return nodefs.copyFile(from, to);
  const relFrom = relOf(from);
  const relTo = relOf(to);
  if (typeof adapter.copy === "function") {
    await adapter.copy(relFrom, relTo);
    return;
  }
  const buf = await adapter.readBinary(relFrom);
  await adapter.writeBinary(relTo, buf);
}
async function rm2(target, options = {}) {
  if (!adapter) return nodefs.rm(target, options);
  const rel = relOf(target);
  if (!await adapterExists(rel)) {
    if (options && options.force) return;
    throw enoent(target);
  }
  let isDir = false;
  if (typeof adapter.stat === "function") {
    try {
      const st = await adapter.stat(rel);
      isDir = !!(st && st.type === "folder");
    } catch {
      isDir = false;
    }
  }
  if (isDir) {
    if (typeof adapter.rmdir === "function") await adapter.rmdir(rel, true);
    else await adapter.remove(rel);
    return;
  }
  try {
    await adapter.remove(rel);
  } catch (err) {
    if (typeof adapter.rmdir === "function") {
      await adapter.rmdir(rel, true);
      return;
    }
    throw err;
  }
}
async function rmdir2(dir) {
  if (!adapter) return nodefs.rmdir(dir);
  const rel = relOf(dir);
  if (!await adapterExists(rel)) throw enoent(dir);
  await adapter.rmdir(rel, false);
}
var nodefs, adapter, basePath;
var init_vfs = __esm({
  "src/core/vfs.js"() {
    nodefs = __toESM(require("node:fs/promises"), 1);
    adapter = null;
    basePath = "";
  }
});

// src/core/history.js
function sha1(text) {
  return (0, import_node_crypto2.createHash)("sha1").update(String(text), "utf8").digest("hex");
}
function badInput(message) {
  return Object.assign(new Error(message || "\u975E\u6CD5\u7684\u8DEF\u5F84"), { status: 400 });
}
function notFound() {
  return Object.assign(new Error("\u8FD9\u4E00\u7248\u5FEB\u7167\u4E0D\u5728\u4E86"), { status: 404 });
}
function isMissing(error2) {
  return Boolean(error2) && (error2.code === "ENOENT" || error2.code === "ENOTDIR");
}
function clampLimit(limit) {
  const n2 = Number(limit);
  if (!Number.isFinite(n2)) return HISTORY_LIMIT;
  return Math.max(1, Math.floor(n2));
}
function splitRel(relPath) {
  if (typeof relPath !== "string" || relPath.trim() === "") throw badInput("\u7B14\u8BB0\u8DEF\u5F84\u4E0D\u80FD\u4E3A\u7A7A");
  const parts = relPath.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter((seg) => seg !== "" && seg !== ".");
  if (parts.length === 0) throw badInput("\u7B14\u8BB0\u8DEF\u5F84\u4E0D\u80FD\u4E3A\u7A7A");
  if (parts.some((seg) => seg === "..")) throw badInput("path escapes vault root");
  if (/^[a-zA-Z]:$/.test(parts[0])) throw badInput("\u7B14\u8BB0\u8DEF\u5F84\u5FC5\u987B\u662F\u5E93\u5185\u76F8\u5BF9\u8DEF\u5F84");
  return parts;
}
function historyKeyFor(relPath) {
  const parts = String(relPath == null ? "" : relPath).replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter((seg) => seg !== "" && seg !== "." && seg !== "..");
  let key = parts.join("__");
  const before = key;
  key = key.replace(ILLEGAL_NAME, "");
  if (key === "" || /^\.+$/.test(key)) {
    key = `note-${sha1(before)}`.slice(0, KEY_MAX);
  }
  key = key.replace(/[. ]+$/, "");
  if (key === "") key = `note-${sha1(before)}`;
  const chars = Array.from(key);
  if (chars.length > KEY_MAX) {
    const head = chars.slice(0, KEY_MAX - KEY_HASH_LEN - 1).join("");
    key = `${head}-${sha1(key).slice(0, KEY_HASH_LEN)}`;
  }
  return key;
}
function stampLabel(now) {
  const ms = now instanceof Date ? now.getTime() : Number(now);
  const t4 = Number.isFinite(ms) ? ms : Date.now();
  return new Date(t4).toISOString().replace(/[:.]/g, "-");
}
function parseStamp(name) {
  const m3 = STAMP_RE.exec(name);
  if (!m3) return null;
  const [, y3, mo, d3, h5, mi, s3, ms] = m3;
  const iso = `${y3}-${mo}-${d3}T${h5}:${mi}:${s3}.${ms}Z`;
  const t4 = Date.parse(iso);
  if (!Number.isFinite(t4)) return null;
  return { ms: t4, iso };
}
function seqOf(name) {
  const m3 = /Z-(\d+)\.md$/i.exec(name);
  return m3 ? Number(m3[1]) : 1;
}
async function readSnapshots(dirAbs) {
  let names;
  try {
    names = await readdir2(dirAbs);
  } catch (error2) {
    if (isMissing(error2)) return [];
    throw error2;
  }
  const items = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".md")) continue;
    let st;
    try {
      st = await stat2((0, import_node_path3.join)(dirAbs, name));
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const stamp = parseStamp(name);
    items.push({
      name,
      bytes: st.size,
      mtimeMs: st.mtimeMs,
      savedAt: stamp ? stamp.iso : new Date(st.mtimeMs).toISOString(),
      _ms: stamp ? stamp.ms : st.mtimeMs,
      _seq: seqOf(name)
    });
  }
  items.sort((a3, b3) => b3._ms - a3._ms || b3._seq - a3._seq || (a3.name < b3.name ? 1 : a3.name > b3.name ? -1 : 0));
  return items;
}
async function pruneDir(dirAbs, keep) {
  const items = await readSnapshots(dirAbs);
  const survivors = items.slice(0, keep);
  let pruned = 0;
  for (const item of items.slice(keep)) {
    try {
      await rm2((0, import_node_path3.join)(dirAbs, item.name), { force: true });
      pruned += 1;
    } catch {
    }
  }
  return { pruned, kept: survivors.length };
}
async function snapshotNote(root, relPath, { now = Date.now(), limit = HISTORY_LIMIT } = {}) {
  const parts = splitRel(relPath);
  const abs = (0, import_node_path3.resolve)(root, ...parts);
  let st;
  try {
    st = await stat2(abs);
  } catch (error2) {
    if (isMissing(error2)) return { saved: false, reason: "missing" };
    throw error2;
  }
  if (!st.isFile()) return { saved: false, reason: "missing" };
  if (st.size > MAX_SNAPSHOT_BYTES) return { saved: false, reason: "too-large" };
  const buf = await readFile2(abs);
  if (buf.length > MAX_SNAPSHOT_BYTES) return { saved: false, reason: "too-large" };
  const key = historyKeyFor(parts.join("/"));
  const dirAbs = (0, import_node_path3.join)(root, HISTORY_DIR, key);
  await mkdir2(dirAbs, { recursive: true });
  const base = stampLabel(now);
  let name = "";
  for (let i3 = 1; i3 <= 999; i3 += 1) {
    const candidate = i3 === 1 ? `${base}.md` : `${base}-${i3}.md`;
    try {
      await writeFile2((0, import_node_path3.join)(dirAbs, candidate), buf, { flag: "wx" });
      name = candidate;
      break;
    } catch (error2) {
      if (error2 && error2.code === "EEXIST") continue;
      throw error2;
    }
  }
  if (name === "") throw Object.assign(new Error("\u540C\u4E00\u6BEB\u79D2\u7684\u5FEB\u7167\u8FC7\u591A"), { status: 409 });
  await pruneDir(dirAbs, clampLimit(limit));
  return { saved: true, path: `${HISTORY_DIR}/${key}/${name}`, bytes: buf.length };
}
async function listHistory(root, relPath, { limit = 50 } = {}) {
  const parts = splitRel(relPath);
  const key = historyKeyFor(parts.join("/"));
  const dirAbs = (0, import_node_path3.join)(root, HISTORY_DIR, key);
  const items = await readSnapshots(dirAbs);
  const cap = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 50;
  return items.slice(0, cap).map((item) => ({
    name: item.name,
    path: `${HISTORY_DIR}/${key}/${item.name}`,
    bytes: item.bytes,
    mtimeMs: item.mtimeMs,
    savedAt: item.savedAt
  }));
}
async function moveHistoryEntries(root, fromRel, toRel) {
  const from = splitRel(fromRel).join("/");
  const to = splitRel(toRel).join("/");
  if (from === "" || to === "" || from === to) return 0;
  const base = (0, import_node_path3.join)(root, HISTORY_DIR);
  let names;
  try {
    names = await readdir2(base);
  } catch {
    return 0;
  }
  const fromKey = historyKeyFor(from);
  const toKey = historyKeyFor(to);
  const plan = [];
  for (const name of names) {
    if (name !== fromKey && !name.startsWith(`${fromKey}__`)) continue;
    const next = `${toKey}${name.slice(fromKey.length)}`;
    if (next === name) continue;
    plan.push({ from: name, to: next });
  }
  let moved = 0;
  for (const item of plan) {
    try {
      await rename2((0, import_node_path3.join)(base, item.from), (0, import_node_path3.join)(base, item.to));
      moved += 1;
    } catch {
    }
  }
  return moved;
}
async function readHistoryEntry(root, relPath, name) {
  if (typeof name !== "string" || name === "" || name === "." || name === "..") {
    throw badInput("\u975E\u6CD5\u7684\u5FEB\u7167\u540D");
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..") || name.includes("\0")) {
    throw badInput("\u975E\u6CD5\u7684\u5FEB\u7167\u540D");
  }
  const parts = splitRel(relPath);
  const key = historyKeyFor(parts.join("/"));
  const abs = (0, import_node_path3.join)(root, HISTORY_DIR, key, name);
  let st;
  try {
    st = await stat2(abs);
  } catch (error2) {
    if (isMissing(error2)) throw notFound();
    throw error2;
  }
  if (!st.isFile()) throw notFound();
  let buf;
  try {
    buf = await readFile2(abs);
  } catch (error2) {
    if (isMissing(error2)) throw notFound();
    throw error2;
  }
  const stamp = parseStamp(name);
  return {
    name,
    path: `${HISTORY_DIR}/${key}/${name}`,
    content: buf.toString("utf8"),
    bytes: buf.length,
    savedAt: stamp ? stamp.iso : new Date(st.mtimeMs).toISOString()
  };
}
async function atomicWrite(abs, content) {
  const tmp = `${abs}.${process.pid}.${Date.now().toString(36)}.${(0, import_node_crypto2.randomBytes)(3).toString("hex")}.tmp`;
  await writeFile2(tmp, content, "utf8");
  try {
    await rename2(tmp, abs);
    return;
  } catch (first) {
    try {
      await rm2(abs, { force: true });
      await rename2(tmp, abs);
      return;
    } catch {
      await rm2(tmp, { force: true }).catch(() => {
      });
      throw first;
    }
  }
}
async function restoreHistoryEntry(root, relPath, name, { keepCurrent = true } = {}) {
  const entry = await readHistoryEntry(root, relPath, name);
  const parts = splitRel(relPath);
  const abs = (0, import_node_path3.resolve)(root, ...parts);
  let hadSnapshot = false;
  if (keepCurrent !== false) {
    const snap = await snapshotNote(root, parts.join("/"));
    hadSnapshot = snap.saved === true;
  }
  await mkdir2((0, import_node_path3.dirname)(abs), { recursive: true });
  await atomicWrite(abs, entry.content);
  return { restored: true, path: parts.join("/"), from: name, hadSnapshot };
}
var import_node_path3, import_node_crypto2, HISTORY_DIR, HISTORY_LIMIT, MAX_SNAPSHOT_BYTES, KEY_MAX, KEY_HASH_LEN, ILLEGAL_NAME, STAMP_RE;
var init_history = __esm({
  "src/core/history.js"() {
    init_vfs();
    import_node_path3 = require("node:path");
    import_node_crypto2 = require("node:crypto");
    HISTORY_DIR = ".history";
    HISTORY_LIMIT = 10;
    MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
    KEY_MAX = 120;
    KEY_HASH_LEN = 16;
    ILLEGAL_NAME = /[<>:"\\|?*\u0000-\u001f\u007f]/g;
    STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/;
  }
});

// src/core/vault.js
var vault_exports = {};
__export(vault_exports, {
  MAX_READ: () => MAX_READ,
  MAX_WRITE: () => MAX_WRITE,
  NOTE_EXT: () => NOTE_EXT,
  applyInlineTagEdit: () => applyInlineTagEdit,
  backlinkSnippets: () => backlinkSnippets,
  buildTree: () => buildTree,
  conflictArchiveName: () => conflictArchiveName,
  createDir: () => createDir,
  createNote: () => createNote,
  deriveDate: () => deriveDate,
  deriveTitle: () => deriveTitle,
  excerptOf: () => excerptOf,
  extractInlineTags: () => extractInlineTags,
  extractWikiLinks: () => extractWikiLinks,
  findBacklinks: () => findBacklinks,
  findBrokenLinks: () => findBrokenLinks,
  heatmapOf: () => heatmapOf,
  invalidateScan: () => invalidateScan,
  linkNamesOf: () => linkNamesOf,
  listAssets: () => listAssets,
  listConflicts: () => listConflicts,
  listDirs: () => listDirs,
  listOpenTodos: () => listOpenTodos,
  listTrash: () => listTrash,
  mergeTags: () => mergeTags,
  normalizeAliases: () => normalizeAliases,
  normalizeRel: () => normalizeRel,
  normalizeTags: () => normalizeTags,
  outlineOf: () => outlineOf,
  parseFrontmatter: () => parseFrontmatter,
  parseSearchQuery: () => parseSearchQuery,
  parseTrashName: () => parseTrashName,
  purgeTrash: () => purgeTrash,
  readConflict: () => readConflict,
  readNote: () => readNote,
  readTags: () => readTags,
  removeDir: () => removeDir,
  removeTag: () => removeTag,
  renameDir: () => renameDir,
  renameTag: () => renameTag,
  resolveConflict: () => resolveConflict,
  resolveInside: () => resolveInside,
  restoreNote: () => restoreNote,
  rewriteTags: () => rewriteTags,
  safeFilename: () => safeFilename,
  saveAsset: () => saveAsset,
  scanVault: () => scanVault,
  searchNotes: () => searchNotes,
  stripComments: () => stripComments,
  toPosix: () => toPosix,
  toggleTodo: () => toggleTodo,
  trashNote: () => trashNote,
  unresolveConflict: () => unresolveConflict,
  vaultStats: () => vaultStats,
  writeNote: () => writeNote
});
function toPosix(p3) {
  return p3.split(import_node_path4.sep).join("/");
}
function normalizeRel(input) {
  if (typeof input !== "string") return "";
  const raw = input.replace(/\\/g, "/").replace(/^\/+/, "");
  const normalized = import_node_path4.posix.normalize(raw);
  if (normalized === "." || normalized === "./") return "";
  if (normalized.startsWith("../") || normalized === "..") {
    throw Object.assign(new Error("path escapes vault root"), { status: 400 });
  }
  return normalized;
}
function resolveInside(root, rel, { create = false } = {}) {
  const normalized = normalizeRel(rel);
  const abs = normalized === "" ? (0, import_node_path4.resolve)(root) : (0, import_node_path4.resolve)(root, normalized.split("/").join(import_node_path4.sep));
  const relCheck = (0, import_node_path4.relative)((0, import_node_path4.resolve)(root), abs);
  if (relCheck.startsWith("..") || relCheck !== "" && (0, import_node_path4.resolve)(root, relCheck) !== abs) {
    throw Object.assign(new Error("path escapes vault root"), { status: 400 });
  }
  return { abs, rel: normalized, create };
}
function parseFrontmatter(text) {
  const src = typeof text === "string" ? text : "";
  if (!src.startsWith("---")) return { data: {}, body: src, raw: null };
  const lines = src.split(/\r?\n/);
  let end = -1;
  for (let i3 = 1; i3 < lines.length; i3 += 1) {
    if (lines[i3].trim() === "---") {
      end = i3;
      break;
    }
  }
  if (end < 0) return { data: {}, body: src, raw: null };
  const raw = lines.slice(1, end).join("\n");
  const data = {};
  let lastKey = null;
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const indented = /^\s+\S/.test(line);
    if (indented && lastKey) {
      const item = line.trim().replace(/^-\s*/, "");
      data[lastKey] = Array.isArray(data[lastKey]) ? [...data[lastKey], unquote(item)] : [data[lastKey], unquote(item)];
      continue;
    }
    const m3 = /^([A-Za-z0-9_\u4e00-\u9fa5.-]+)\s*:\s*(.*)$/.exec(line);
    if (!m3) continue;
    lastKey = m3[1];
    const value = m3[2].trim();
    if (value === "") {
      data[lastKey] = [];
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      data[lastKey] = value.slice(1, -1).split(",").map((s3) => unquote(s3.trim())).filter((s3) => s3 !== "");
      continue;
    }
    data[lastKey] = unquote(value);
  }
  return { data, body: lines.slice(end + 1).join("\n"), raw };
}
function unquote(s3) {
  const t4 = String(s3).trim();
  if (t4.length >= 2 && (t4.startsWith('"') && t4.endsWith('"') || t4.startsWith("'") && t4.endsWith("'"))) {
    return t4.slice(1, -1);
  }
  return t4;
}
function deriveTitle(body, relPath) {
  const m3 = /^#{1,3}\s+(.+)$/m.exec(body || "");
  if (m3) return m3[1].trim();
  const base = import_node_path4.posix.basename(relPath || "", NOTE_EXT);
  const stripped = base.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  return stripped || base || "\u672A\u547D\u540D";
}
function deriveDate(relPath, data, statMs) {
  const base = import_node_path4.posix.basename(relPath || "", NOTE_EXT);
  const m3 = /^(\d{4}-\d{2}-\d{2})/.exec(base);
  if (m3) return m3[1];
  for (const key of ["\u5F52\u6863", "\u65E5\u671F", "date", "created", "\u521B\u5EFA\u65F6\u95F4"]) {
    const v3 = data && data[key];
    const s3 = Array.isArray(v3) ? v3[0] : v3;
    const dm = typeof s3 === "string" ? /^(\d{4}-\d{2}-\d{2})/.exec(s3.trim()) : null;
    if (dm) return dm[1];
  }
  if (statMs) {
    const d3 = new Date(statMs);
    if (!Number.isNaN(d3.getTime())) {
      const pad2 = (n2) => String(n2).padStart(2, "0");
      return `${d3.getFullYear()}-${pad2(d3.getMonth() + 1)}-${pad2(d3.getDate())}`;
    }
  }
  return null;
}
function stripComments(text) {
  return String(text == null ? "" : text).replace(/%%[\s\S]*?%%/g, " ");
}
function maskComments(text) {
  return String(text == null ? "" : text).replace(/%%[\s\S]*?%%/g, (all) => all.replace(/[^\n]/g, " "));
}
function excerptOf(body, limit = 140) {
  const text = stripComments(body).replace(/^---[\s\S]*?\n---\s*\n?/, "").replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/[*_`>]/g, "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}\u2026` : text;
}
function invalidateScan(root) {
  if (typeof root !== "string" || root === "") entryMemo.clear();
  if (typeof root === "string" && root !== "") {
    for (const key of [...scanCache.keys()]) {
      if (key === root || key.startsWith(root)) scanCache.delete(key);
    }
    return;
  }
  scanCache.clear();
}
async function fingerprintVault(root) {
  const parts = [];
  async function walk(dir, relDir, depth) {
    if (depth > MAX_DEPTH) return;
    let dirents;
    try {
      dirents = await readdir2(dir, { withFileTypes: true });
    } catch {
      parts.push(`!${relDir}`);
      return;
    }
    const names = [];
    for (const dirent2 of dirents) {
      const name = dirent2.name;
      if (dirent2.isDirectory()) {
        if (IGNORED_DIRS.has(name)) continue;
        await walk((0, import_node_path4.join)(dir, name), relDir === "" ? name : `${relDir}/${name}`, depth + 1);
        continue;
      }
      if (!dirent2.isFile()) continue;
      if ((0, import_node_path4.extname)(name).toLowerCase() !== NOTE_EXT) continue;
      const rel = relDir === "" ? name : `${relDir}/${name}`;
      try {
        const st = await stat2((0, import_node_path4.join)(dir, name));
        names.push(`${rel}:${st.mtimeMs}:${st.size}`);
      } catch {
        names.push(`${rel}:?`);
      }
    }
    names.sort();
    parts.push(`${relDir}|${names.join(",")}`);
  }
  await walk(root, "", 0);
  return parts.join("\n");
}
async function scanVault(root, options = {}) {
  const fresh = options !== null && typeof options === "object" && options.fresh === true;
  let key = null;
  if (!fresh) {
    try {
      key = `${root}\0${await fingerprintVault(root)}`;
      const hit = scanCache.get(key);
      if (hit !== void 0) return hit;
    } catch {
      key = null;
    }
  }
  const entries = [];
  const errors = [];
  let truncated = false;
  async function walk(dir, relDir, depth) {
    if (depth > MAX_DEPTH || truncated) return;
    let dirents;
    try {
      dirents = await readdir2(dir, { withFileTypes: true });
    } catch (error2) {
      errors.push({ path: relDir || ".", message: String(error2 && error2.message ? error2.message : error2) });
      return;
    }
    for (const dirent2 of dirents) {
      if (entries.length >= MAX_SCAN) {
        truncated = true;
        return;
      }
      const name = dirent2.name;
      if (dirent2.isDirectory()) {
        if (IGNORED_DIRS.has(name)) continue;
        await walk((0, import_node_path4.join)(dir, name), relDir === "" ? name : `${relDir}/${name}`, depth + 1);
        continue;
      }
      if (!dirent2.isFile()) continue;
      if ((0, import_node_path4.extname)(name).toLowerCase() !== NOTE_EXT) continue;
      const rel = relDir === "" ? name : `${relDir}/${name}`;
      const abs = (0, import_node_path4.join)(dir, name);
      try {
        const st = await stat2(abs);
        if (st.size > MAX_READ) {
          errors.push({ path: rel, message: `\u6587\u4EF6\u8D85\u8FC7 ${Math.round(MAX_READ / 1024 / 1024)}MB\uFF0C\u5DF2\u8DF3\u8FC7` });
          continue;
        }
        const memoKey = `${abs}\0${st.mtimeMs}\0${st.size}`;
        const memo = entryMemo.get(memoKey);
        if (memo !== void 0) {
          entries.push({ ...memo, path: rel, name, dir: relDir });
          continue;
        }
        const text = await readFile2(abs, "utf8");
        const { data, body } = parseFrontmatter(text);
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
          aliases: normalizeAliases(data.aliases !== void 0 ? data.aliases : data.alias !== void 0 ? data.alias : data["\u522B\u540D"]),
          noteId: data.note_id ? String(data.note_id) : null,
          noteUrl: data.note_url ? String(data.note_url) : null,
          bytes: st.size,
          mtimeMs: st.mtimeMs,
          excerpt: excerptOf(body)
        };
        entries.push(entry);
        entryMemo.set(memoKey, entry);
        if (entryMemo.size > ENTRY_MEMO_MAX) {
          const oldest = entryMemo.keys().next();
          if (!oldest.done) entryMemo.delete(oldest.value);
        }
      } catch (error2) {
        errors.push({ path: rel, message: String(error2 && error2.message ? error2.message : error2) });
      }
    }
  }
  await walk(root, "", 0);
  entries.sort((a3, b3) => {
    const da = a3.date || "";
    const db = b3.date || "";
    if (da !== db) return db.localeCompare(da);
    return b3.mtimeMs - a3.mtimeMs;
  });
  const result = { entries, errors, truncated };
  if (key !== null) {
    if (errors.length === 0 && !truncated) {
      scanCache.set(key, result);
      if (scanCache.size > SCAN_CACHE_MAX) {
        const oldest = scanCache.keys().next();
        if (!oldest.done) scanCache.delete(oldest.value);
      }
    }
  }
  return result;
}
function buildTree(entries) {
  const root = { name: "", path: "", kind: "dir", children: [], count: 0 };
  const dirMap = /* @__PURE__ */ new Map([["", root]]);
  for (const entry of entries) {
    const segments = entry.path.split("/").slice(0, -1);
    let cursor = root;
    let acc = "";
    for (const segment of segments) {
      acc = acc === "" ? segment : `${acc}/${segment}`;
      let node = dirMap.get(acc);
      if (!node) {
        node = { name: segment, path: acc, kind: "dir", children: [], count: 0 };
        dirMap.set(acc, node);
        cursor.children.push(node);
      }
      cursor = node;
    }
    cursor.children.push({ name: entry.name, path: entry.path, kind: "file", entry });
  }
  const countAll = (node) => {
    let n2 = 0;
    for (const child of node.children) {
      if (child.kind === "file") n2 += 1;
      else n2 += countAll(child);
    }
    node.count = n2;
    node.children.sort((a3, b3) => {
      if (a3.kind !== b3.kind) return a3.kind === "dir" ? -1 : 1;
      if (a3.kind === "dir") return a3.name.localeCompare(b3.name, "zh");
      const da = a3.entry && a3.entry.date || "";
      const db = b3.entry && b3.entry.date || "";
      if (da !== db) return db.localeCompare(da);
      return a3.name.localeCompare(b3.name, "zh");
    });
    return n2;
  };
  countAll(root);
  return root;
}
async function readNote(root, rel) {
  const { abs, rel: normalized } = resolveInside(root, rel);
  if (!normalized.toLowerCase().endsWith(NOTE_EXT)) {
    throw Object.assign(new Error("\u53EA\u80FD\u8BFB\u53D6 .md \u6587\u4EF6"), { status: 400 });
  }
  const st = await stat2(abs);
  if (!st.isFile()) throw Object.assign(new Error("\u4E0D\u662F\u6587\u4EF6"), { status: 400 });
  if (st.size > MAX_READ) throw Object.assign(new Error("\u6587\u4EF6\u8FC7\u5927"), { status: 413 });
  const content = await readFile2(abs, "utf8");
  const { data, body } = parseFrontmatter(content);
  return {
    path: normalized,
    content,
    body,
    frontmatter: data,
    title: deriveTitle(body, normalized),
    tags: mergeTags(normalizeTags(data.tags), extractInlineTags(body)),
    aliases: normalizeAliases(data.aliases !== void 0 ? data.aliases : data.alias !== void 0 ? data.alias : data["\u522B\u540D"]),
    bytes: st.size,
    mtimeMs: st.mtimeMs,
    readOnly: false
  };
}
async function listAssets(root, rel, noteId = "") {
  const { abs, rel: normalized } = resolveInside(root, rel);
  const dir = import_node_path4.posix.dirname(normalized);
  const stem = import_node_path4.posix.basename(normalized, NOTE_EXT);
  const assetRel = dir === "." || dir === "" ? "asset" : `${dir}/asset`;
  const assetAbs = resolveInside(root, assetRel).abs;
  let names;
  try {
    names = await readdir2(assetAbs);
  } catch {
    return [];
  }
  const candidates = [];
  if (stem !== "") candidates.push(stem);
  const undated = stem.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  if (undated !== "" && undated !== stem) candidates.push(undated);
  const id = String(noteId || "").trim();
  const out = [];
  for (const name of names) {
    if (name.endsWith(".bak")) continue;
    const lower = name.toLowerCase();
    const isAudio = /\.(mp3|ogg|m4a|wav|aac|flac)$/.test(lower);
    const isTranscript = lower.endsWith(".md");
    const isImage = /\.(png|jpe?g|gif|webp)$/.test(lower);
    if (!isAudio && !isTranscript && !isImage) continue;
    const owned = candidates.some((prefix) => name.startsWith(prefix)) || id !== "" && name.includes(id);
    if (!owned) continue;
    const relPath = `${assetRel}/${name}`;
    try {
      const st = await stat2(resolveInside(root, relPath).abs);
      if (!st.isFile()) continue;
      out.push({
        name,
        path: relPath,
        bytes: st.size,
        mtimeMs: st.mtimeMs,
        kind: isAudio ? "audio" : isTranscript ? "transcript" : "image"
      });
    } catch {
    }
  }
  out.sort((a3, b3) => a3.name.localeCompare(b3.name, "zh"));
  return out;
}
async function saveAsset(root, relNote, name, data) {
  const { rel: normalized } = resolveInside(root, relNote);
  if (!normalized.toLowerCase().endsWith(NOTE_EXT)) {
    throw Object.assign(new Error("\u53EA\u80FD\u7ED9 .md \u7B14\u8BB0\u5B58\u9644\u4EF6"), { status: 400 });
  }
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw Object.assign(new Error("\u6587\u4EF6\u662F\u7A7A\u7684"), { status: 400 });
  }
  const dir = import_node_path4.posix.dirname(normalized);
  const stem = import_node_path4.posix.basename(normalized, NOTE_EXT);
  const assetRel = dir === "." || dir === "" ? "asset" : `${dir}/asset`;
  const raw = String(name || "").replace(/\\/g, "/");
  const base = raw.slice(raw.lastIndexOf("/") + 1);
  const cleaned = base.replace(/[\\/:*?"<>|\r\n\t]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  const safe = (cleaned === "" ? "file" : cleaned).slice(0, 80);
  const prefix = stem === "" ? "" : `${stem}_`;
  const wanted = prefix !== "" && safe.startsWith(prefix) ? safe : `${prefix}${safe}`;
  const dot = wanted.lastIndexOf(".");
  const head = dot > 0 ? wanted.slice(0, dot) : wanted;
  const ext = dot > 0 ? wanted.slice(dot) : "";
  const assetAbs = resolveInside(root, assetRel).abs;
  await mkdir2(assetAbs, { recursive: true });
  for (let counter = 1; counter <= 99; counter += 1) {
    const candidate = counter === 1 ? wanted : `${head}-${counter}${ext}`;
    const relPath = `${assetRel}/${candidate}`;
    const abs = resolveInside(root, relPath).abs;
    let exists = false;
    try {
      await stat2(abs);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists) continue;
    await writeFile2(abs, data);
    invalidateScan(root);
    return { name: candidate, path: relPath, bytes: data.length };
  }
  throw Object.assign(new Error("\u540C\u540D\u9644\u4EF6\u8FC7\u591A"), { status: 409 });
}
async function writeNote(root, rel, content, options = {}) {
  const backup = options.backup !== false;
  const { abs, rel: normalized } = resolveInside(root, rel);
  if (!normalized.toLowerCase().endsWith(NOTE_EXT)) {
    throw Object.assign(new Error("\u53EA\u80FD\u5199\u5165 .md \u6587\u4EF6"), { status: 400 });
  }
  if (typeof content !== "string") throw Object.assign(new Error("content \u5FC5\u987B\u662F\u5B57\u7B26\u4E32"), { status: 400 });
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE) {
    throw Object.assign(new Error("\u5185\u5BB9\u8D85\u8FC7 2MB \u4E0A\u9650"), { status: 413 });
  }
  await mkdir2((0, import_node_path4.dirname)(abs), { recursive: true });
  if (backup) {
    try {
      await copyFile2(abs, `${abs}.bak`);
    } catch {
    }
  }
  const tmp = `${abs}.${process.pid}.${(0, import_node_crypto3.randomBytes)(4).toString("hex")}.tmp`;
  await writeFile2(tmp, content, "utf8");
  await rename2(tmp, abs);
  const st = await stat2(abs);
  invalidateScan(root);
  return { path: normalized, bytes: st.size, mtimeMs: st.mtimeMs };
}
function safeFilename(title, fallback = "\u672A\u547D\u540D") {
  const cleaned = String(title || "").replace(/[\\/:*?"<>|\r\n\t]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "").slice(0, 80);
  return cleaned === "" ? fallback : cleaned;
}
async function createNote(root, { dir = "", title = "", content = "", date, withDatePrefix = true } = {}) {
  const safeDir = normalizeRel(dir);
  const pad2 = (n2) => String(n2).padStart(2, "0");
  const now = /* @__PURE__ */ new Date();
  const day = date || `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const baseName = safeFilename(title);
  const fileName = `${withDatePrefix ? `${day}-` : ""}${baseName}${NOTE_EXT}`;
  const rel = safeDir === "" ? fileName : `${safeDir}/${fileName}`;
  let candidate = rel;
  let counter = 2;
  for (; ; ) {
    const { abs } = resolveInside(root, candidate);
    try {
      await stat2(abs);
      const stem = candidate.slice(0, -NOTE_EXT.length);
      candidate = `${stem}-${counter}${NOTE_EXT}`;
      counter += 1;
      if (counter > 99) throw Object.assign(new Error("\u540C\u540D\u7B14\u8BB0\u8FC7\u591A"), { status: 409 });
    } catch (error2) {
      if (error2 && error2.status === 409) throw error2;
      break;
    }
  }
  const body = content !== "" ? content : `# ${baseName}

`;
  await writeNote(root, candidate, body);
  return { path: candidate };
}
async function trashNote(root, rel) {
  const { abs, rel: normalized } = resolveInside(root, rel);
  if (normalized === "") throw Object.assign(new Error("\u4E0D\u80FD\u5220\u9664\u5E93\u6839"), { status: 400 });
  const trashDir = (0, import_node_path4.join)(root, ".trash");
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const target = (0, import_node_path4.join)(trashDir, `${stamp}__${(0, import_node_path4.basename)(abs)}`);
  await mkdir2(trashDir, { recursive: true });
  await rename2(abs, target);
  invalidateScan(root);
  return { path: normalized, trashedTo: toPosix((0, import_node_path4.relative)(root, target)) };
}
function parseTrashName(name) {
  const m3 = TRASH_NAME_RE.exec(String(name || ""));
  if (m3 === null) return { trashedAt: null, originalName: String(name || "") };
  const iso = `${m3[1]}T${m3[2]}:${m3[3]}:${m3[4]}.${m3[5]}Z`;
  const at = Date.parse(iso);
  return {
    trashedAt: Number.isNaN(at) ? null : new Date(at).toISOString(),
    originalName: m3[6]
  };
}
async function listTrash(root) {
  const trashDir = (0, import_node_path4.join)(root, TRASH_DIR);
  let dirents;
  try {
    dirents = await readdir2(trashDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const items = [];
  for (const dirent2 of dirents) {
    if (!dirent2.isFile()) continue;
    if ((0, import_node_path4.extname)(dirent2.name).toLowerCase() !== NOTE_EXT) continue;
    const abs = (0, import_node_path4.join)(trashDir, dirent2.name);
    let st;
    try {
      st = await stat2(abs);
    } catch {
      continue;
    }
    const meta = parseTrashName(dirent2.name);
    items.push({
      name: dirent2.name,
      path: toPosix((0, import_node_path4.join)(TRASH_DIR, dirent2.name)),
      originalName: meta.originalName,
      title: meta.originalName.replace(/\.md$/i, "").replace(/^\d{4}-\d{2}-\d{2}-/, ""),
      trashedAt: meta.trashedAt,
      bytes: st.size,
      mtimeMs: st.mtimeMs
    });
  }
  items.sort((a3, b3) => {
    const ta = a3.trashedAt === null ? 0 : Date.parse(a3.trashedAt);
    const tb = b3.trashedAt === null ? 0 : Date.parse(b3.trashedAt);
    return tb - ta;
  });
  return items;
}
async function restoreNote(root, trashPath, targetRel) {
  const { abs: absTrash, rel: trashRel } = resolveInside(root, trashPath);
  if (!trashRel.startsWith(`${TRASH_DIR}/`)) {
    throw Object.assign(new Error("\u53EA\u80FD\u4ECE .trash \u76EE\u5F55\u6062\u590D"), { status: 400 });
  }
  let st;
  try {
    st = await stat2(absTrash);
  } catch {
    throw Object.assign(new Error("\u56DE\u6536\u7AD9\u91CC\u6CA1\u6709\u8FD9\u4E2A\u6587\u4EF6"), { status: 404 });
  }
  if (!st.isFile()) throw Object.assign(new Error("\u4E0D\u662F\u6587\u4EF6"), { status: 400 });
  const meta = parseTrashName((0, import_node_path4.basename)(absTrash));
  const wanted = typeof targetRel === "string" && targetRel.trim() !== "" ? normalizeRel(targetRel.trim()) : "";
  const rel = wanted === "" ? meta.originalName : wanted;
  if (rel === "" || rel.endsWith("/")) {
    throw Object.assign(new Error("\u76EE\u6807\u8DEF\u5F84\u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
  }
  const { abs: absTarget } = resolveInside(root, rel, { create: true });
  let candidate = rel;
  let counter = 1;
  for (; ; ) {
    try {
      await stat2(resolveInside(root, candidate).abs);
      counter += 1;
      if (counter > 99) throw Object.assign(new Error("\u540C\u540D\u7B14\u8BB0\u8FC7\u591A"), { status: 409 });
      const dir = import_node_path4.posix.dirname(rel);
      const stem = (0, import_node_path4.basename)(rel, (0, import_node_path4.extname)(rel));
      const ext = (0, import_node_path4.extname)(rel);
      const next = `${stem}-${counter}${ext}`;
      candidate = dir === "." || dir === "" ? next : import_node_path4.posix.join(dir, next);
    } catch (error2) {
      if (error2 && error2.status === 409) throw error2;
      break;
    }
  }
  const { abs: absFinal } = resolveInside(root, candidate, { create: true });
  await mkdir2((0, import_node_path4.dirname)(absFinal), { recursive: true });
  await rename2(absTrash, absFinal);
  invalidateScan(root);
  return { path: candidate, restoredFrom: trashRel, title: meta.originalName };
}
async function purgeTrash(root, trashPath) {
  const trashDir = (0, import_node_path4.join)(root, TRASH_DIR);
  if (typeof trashPath === "string" && trashPath.trim() !== "") {
    const { abs, rel } = resolveInside(root, trashPath);
    if (!rel.startsWith(`${TRASH_DIR}/`)) {
      throw Object.assign(new Error("\u53EA\u80FD\u6E05\u7A7A .trash \u91CC\u7684\u6587\u4EF6"), { status: 400 });
    }
    await rm2(abs, { force: true });
    return { purged: [rel] };
  }
  let dirents;
  try {
    dirents = await readdir2(trashDir, { withFileTypes: true });
  } catch {
    return { purged: [] };
  }
  const purged = [];
  for (const dirent2 of dirents) {
    if (!dirent2.isFile()) continue;
    await rm2((0, import_node_path4.join)(trashDir, dirent2.name), { force: true });
    purged.push(toPosix((0, import_node_path4.join)(TRASH_DIR, dirent2.name)));
  }
  if (purged.length > 0) invalidateScan(root);
  return { purged };
}
function parseSearchQuery(input) {
  const raw = String(input || "").trim();
  const tags = [];
  const dirs = [];
  const terms = [];
  const nots = [];
  const re = /(?:^|\s)(tag|dir):("[^"]*"|\S+)/gi;
  let rest = raw;
  let m3;
  while ((m3 = re.exec(raw)) !== null) {
    const kind = m3[1].toLowerCase();
    const value = m3[2].replace(/^"|"$/g, "").trim();
    if (value === "") continue;
    if (kind === "tag") tags.push(value);
    else dirs.push(value);
  }
  rest = rest.replace(re, " ");
  rest = rest.replace(/(?:^|\s)#([^\s#]+)/g, (_3, name) => {
    tags.push(name);
    return " ";
  });
  const tokenRe = /(-?)"([^"]*)"|(-?)(\S+)/g;
  let t4;
  while ((t4 = tokenRe.exec(rest)) !== null) {
    const neg = (t4[1] !== void 0 ? t4[1] : t4[3]) === "-";
    const value = (t4[2] !== void 0 ? t4[2] : t4[4]).trim();
    if (value === "") continue;
    if (neg) nots.push(value);
    else terms.push(value);
  }
  return { raw, tags, dirs, terms, nots };
}
async function searchNotes(root, query, { limit = 60, perFile = 3, sort = "relevance" } = {}) {
  const parsed = parseSearchQuery(query);
  if (parsed.tags.length === 0 && parsed.dirs.length === 0 && parsed.terms.length === 0) {
    return { query: parsed.raw, parsed, hits: [], scanned: 0, truncated: false };
  }
  const needles = parsed.terms.map((t4) => t4.toLowerCase());
  const notNeedles = parsed.nots.map((t4) => t4.toLowerCase());
  const tagNeedles = parsed.tags.map((t4) => t4.toLowerCase());
  const dirNeedles = parsed.dirs.map((d3) => d3.toLowerCase().replace(/^\.?\//, ""));
  const hits = [];
  let scanned = 0;
  let truncated = false;
  async function walk(dir, relDir, depth) {
    if (depth > MAX_DEPTH || truncated) return;
    let dirents;
    try {
      dirents = await readdir2(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent2 of dirents) {
      if (hits.length >= limit) {
        truncated = true;
        return;
      }
      const name = dirent2.name;
      if (dirent2.isDirectory()) {
        if (IGNORED_DIRS.has(name) || name === ".trash") continue;
        await walk((0, import_node_path4.join)(dir, name), relDir === "" ? name : `${relDir}/${name}`, depth + 1);
        continue;
      }
      if (!dirent2.isFile() || (0, import_node_path4.extname)(name).toLowerCase() !== NOTE_EXT) continue;
      const rel = relDir === "" ? name : `${relDir}/${name}`;
      if (dirNeedles.length > 0) {
        const relLower = rel.toLowerCase();
        let dirOk = false;
        for (const d3 of dirNeedles) {
          if (relLower.startsWith(`${d3}/`) || relLower.includes(`/${d3}/`)) {
            dirOk = true;
            break;
          }
        }
        if (!dirOk) continue;
      }
      scanned += 1;
      let text;
      try {
        text = await readFile2((0, import_node_path4.join)(dir, name), "utf8");
      } catch {
        continue;
      }
      const { data, body } = parseFrontmatter(text);
      if (notNeedles.length > 0) {
        const allLower = text.toLowerCase();
        let excluded = false;
        for (const bad of notNeedles) {
          if (allLower.includes(bad)) {
            excluded = true;
            break;
          }
        }
        if (excluded) continue;
      }
      const fileTags = mergeTags(normalizeTags(data.tags), extractInlineTags(body)).map((t4) => t4.toLowerCase());
      if (tagNeedles.length > 0) {
        let tagOk = true;
        for (const want of tagNeedles) {
          if (!fileTags.some((t4) => t4 === want || t4.includes(want))) {
            tagOk = false;
            break;
          }
        }
        if (!tagOk) continue;
      }
      const lines = text.split(/\r?\n/);
      const matches = [];
      let matchCount = 0;
      const seen = /* @__PURE__ */ new Set();
      for (let i3 = 0; i3 < lines.length; i3 += 1) {
        const lower = lines[i3].toLowerCase();
        let lineHit = false;
        for (let n2 = 0; n2 < needles.length; n2 += 1) {
          if (lower.includes(needles[n2])) {
            lineHit = true;
            if (!seen.has(n2)) seen.add(n2);
          }
        }
        if (!lineHit) continue;
        matchCount += 1;
        if (matches.length < perFile) {
          matches.push({ line: i3 + 1, text: lines[i3].trim().slice(0, 240) });
        }
      }
      const titleHit = needles.length > 0 && needles.every((n2) => name.toLowerCase().includes(n2));
      if (titleHit) {
        for (let n2 = 0; n2 < needles.length; n2 += 1) seen.add(n2);
      }
      const allTermsFound = needles.length === 0 || seen.size === needles.length;
      if (!allTermsFound) continue;
      if (matches.length === 0 && !titleHit && needles.length > 0) continue;
      const title = deriveTitle(body, rel);
      hits.push({
        path: rel,
        title,
        date: deriveDate(rel, data, null),
        tags: mergeTags(normalizeTags(data.tags), extractInlineTags(body)),
        aliases: normalizeAliases(data.aliases !== void 0 ? data.aliases : data.alias !== void 0 ? data.alias : data["\u522B\u540D"]),
        matches,
        titleHit,
        matchCount,
        // 这一篇引用了谁。搜索结果原来只给命中次数，用户还得点进去才知道它提到
        // 的是哪几篇；正文本来就已经读进来了，顺手抽一下不额外读盘。
        links: extractWikiLinks(body)
      });
    }
  }
  await walk(root, "", 0);
  if (sort !== "path") {
    hits.sort((a3, b3) => {
      const score = (h5) => h5.matchCount + (h5.titleHit ? 3 : 0);
      const diff = score(b3) - score(a3);
      if (diff !== 0) return diff;
      return a3.path.localeCompare(b3.path, "zh");
    });
  }
  return { query: parsed.raw, parsed, hits, scanned, truncated };
}
function extractWikiLinks(text) {
  const out = /* @__PURE__ */ new Set();
  const src = maskComments(text);
  const re = /\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g;
  let m3;
  while ((m3 = re.exec(src)) !== null) {
    const target = m3[1].trim();
    if (target !== "") out.add(target);
  }
  return [...out];
}
function snippetOfLine(line, width = 60) {
  const text = String(line || "").replace(/\[\[[^\]\n]*\]\]/g, " ").replace(/^\s*#+\s*/, "").replace(/^\s*[-*+]\s+/, "").replace(/\s+/g, " ").trim();
  if (text.length <= width) return text;
  return `${text.slice(0, width - 1).trim()}\u2026`;
}
function linkHitsInText(text, wantedLower) {
  const src = maskComments(text);
  const re = /\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g;
  const counts = /* @__PURE__ */ new Map();
  const snippets = [];
  const seenLines = /* @__PURE__ */ new Set();
  let m3;
  while ((m3 = re.exec(src)) !== null) {
    const target = m3[1].trim();
    if (target === "") continue;
    const noExt = target.replace(/\.md$/i, "");
    const base = noExt.split("/").pop() || noExt;
    if (!wantedLower.has(target.toLowerCase()) && !wantedLower.has(noExt.toLowerCase()) && !wantedLower.has(base.toLowerCase())) continue;
    counts.set(target, (counts.get(target) || 0) + 1);
    const lineStart = src.lastIndexOf("\n", m3.index) + 1;
    if (seenLines.has(lineStart)) continue;
    seenLines.add(lineStart);
    const lineEndRaw = src.indexOf("\n", m3.index);
    const lineEnd = lineEndRaw < 0 ? src.length : lineEndRaw;
    const line = snippetOfLine(src.slice(lineStart, lineEnd));
    if (line !== "") snippets.push(line);
  }
  let count = 0;
  for (const times of counts.values()) count += times;
  return { links: [...counts.keys()], count, snippets };
}
async function findBacklinks(root, target, entries) {
  const raw = String(target || "").trim().replace(/\\/g, "/");
  if (raw === "") return { target: raw, hits: [] };
  const stripExt = (p3) => p3.replace(/\.md$/i, "");
  const rawNoExt = stripExt(raw);
  const rawBase = stripExt(raw.split("/").pop() || raw);
  const rawLower = raw.toLowerCase();
  const baseLower = rawBase.toLowerCase();
  const list = Array.isArray(entries) ? entries : (await scanVault(root)).entries;
  const wantedPaths = /* @__PURE__ */ new Set();
  for (const entry of list) {
    const noExt = stripExt(entry.path);
    const base = stripExt(entry.path.split("/").pop() || entry.path);
    const title = String(entry.title || "").toLowerCase();
    if (noExt.toLowerCase() === rawNoExt.toLowerCase() || base.toLowerCase() === baseLower || title === rawLower || title === baseLower) {
      wantedPaths.add(entry.path);
      wantedPaths.add(noExt);
      wantedPaths.add(base);
    }
  }
  wantedPaths.add(raw);
  wantedPaths.add(rawNoExt);
  wantedPaths.add(rawBase);
  const wantedLower = new Set([...wantedPaths].map((p3) => p3.toLowerCase()));
  const hits = [];
  for (const entry of list) {
    if (entry.path === raw) continue;
    let text;
    try {
      text = await readFile2(resolveInside(root, entry.path).abs, "utf8");
    } catch {
      continue;
    }
    const found = linkHitsInText(text, wantedLower);
    if (found.links.length === 0) continue;
    hits.push({
      path: entry.path,
      title: entry.title,
      date: entry.date,
      links: found.links,
      // 这一篇里一共提了几次。反复提到同一篇的，通常比只提一次的更值得先看。
      count: found.count,
      // 每一处引用各自带上它所在的上下文：一篇笔记里可能三处都提到这一篇，
      // 只给「它引用了我」和路径的话，用户还得自己点进去、再在正文里搜一遍。
      // 这一行不用额外读盘——正文本来就已经读进来了。最多三条，再多就成了
      // 把对方正文抄过来。
      snippets: found.snippets.slice(0, 3)
    });
  }
  hits.sort((a3, b3) => (Number(b3.count) || 1) - (Number(a3.count) || 1) || a3.title.localeCompare(b3.title, "zh"));
  return { target: raw, hits };
}
function backlinkSnippets(text, names, limit = 3) {
  const wanted = /* @__PURE__ */ new Set();
  const list = names instanceof Set ? [...names] : Array.isArray(names) ? names : [];
  for (const value of list) {
    const name = String(value === null || value === void 0 ? "" : value).trim().toLowerCase();
    if (name !== "") wanted.add(name);
  }
  if (wanted.size === 0) return [];
  const found = linkHitsInText(String(text || ""), wanted);
  return found.snippets.slice(0, Math.max(0, limit));
}
function knownLinkNames(entries) {
  const known = /* @__PURE__ */ new Set();
  const add = (value) => {
    const name = String(value || "").trim().toLowerCase();
    if (name !== "") known.add(name);
  };
  for (const entry of entries) {
    const noExt = String(entry.path || "").replace(/\.md$/i, "");
    add(entry.path);
    add(noExt);
    add(noExt.split("/").pop() || noExt);
    add(entry.title);
    for (const alias of Array.isArray(entry.aliases) ? entry.aliases : []) add(alias);
  }
  return known;
}
function linkResolves(target, known) {
  const raw = String(target || "").trim().toLowerCase();
  if (raw === "") return true;
  const noExt = raw.replace(/\.md$/i, "");
  const base = noExt.split("/").pop() || noExt;
  return known.has(raw) || known.has(noExt) || known.has(base);
}
function lineContext(line, width = 80) {
  const text = String(line || "").replace(/^\s*#+\s*/, "").replace(/\s+/g, " ").trim();
  if (text.length <= width) return text;
  return `${text.slice(0, width - 1).trim()}\u2026`;
}
async function findBrokenLinks(root, entries) {
  const list = Array.isArray(entries) ? entries : (await scanVault(root)).entries;
  const known = knownLinkNames(list);
  const hits = [];
  const MAX_HITS = 500;
  for (const entry of list) {
    let text;
    try {
      text = await readFile2(resolveInside(root, entry.path).abs, "utf8");
    } catch {
      continue;
    }
    const lines = maskComments(text).split(/\r?\n/);
    let inFence = false;
    for (let i3 = 0; i3 < lines.length; i3 += 1) {
      const line = lines[i3];
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const re = /\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g;
      let m3;
      while ((m3 = re.exec(line)) !== null) {
        const rawTarget = m3[1].trim();
        if (rawTarget === "") continue;
        const hash = rawTarget.indexOf("#");
        const target = (hash === -1 ? rawTarget : rawTarget.slice(0, hash)).trim();
        if (target === "") continue;
        if (/\.(?!md$)[a-z0-9]{1,6}$/i.test(target)) continue;
        if (linkResolves(target, known)) continue;
        hits.push({
          path: entry.path,
          title: entry.title,
          line: i3 + 1,
          target,
          text: lineContext(line)
        });
        if (hits.length >= MAX_HITS) break;
      }
      if (hits.length >= MAX_HITS) break;
    }
    if (hits.length >= MAX_HITS) break;
  }
  hits.sort((a3, b3) => {
    const byPath = String(a3.path).localeCompare(String(b3.path), "zh");
    if (byPath !== 0) return byPath;
    return a3.line - b3.line;
  });
  return { hits, scanned: list.length, truncated: hits.length >= MAX_HITS };
}
function outlineOf(body) {
  const lines = String(body || "").split(/\r?\n/);
  const items = [];
  let inFence = false;
  for (let i3 = 0; i3 < lines.length; i3 += 1) {
    const line = lines[i3];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m3 = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m3 === null) continue;
    const level = m3[1].length;
    const text = m3[2].trim();
    if (text === "") continue;
    items.push({ level, text, line: i3 + 1 });
  }
  return items;
}
function conflictPathHash(relPath) {
  return (0, import_node_crypto3.createHash)("sha1").update(String(relPath || "")).digest("hex").slice(0, 6);
}
function conflictArchiveName(relPath, options = {}) {
  const rel = normalizeRel(relPath);
  const when = options.at === void 0 ? /* @__PURE__ */ new Date() : new Date(options.at);
  const stamp = (Number.isNaN(when.getTime()) ? /* @__PURE__ */ new Date() : when).toISOString().replace(/[:.]/g, "-");
  const name = (0, import_node_path4.basename)(rel) || "note.md";
  return `${CONFLICT_DIR}/${stamp}__${conflictPathHash(rel)}__${options.cloud === true ? "cloud-" : ""}${name}`;
}
async function readConflictState(root) {
  try {
    const text = await readFile2((0, import_node_path4.join)(root, CONFLICT_DIR, CONFLICT_STATE_FILE), "utf8");
    const data = JSON.parse(text);
    if (data === null || typeof data !== "object" || Array.isArray(data)) return {};
    return data;
  } catch {
    return {};
  }
}
async function writeConflictState(root, state) {
  const dir = (0, import_node_path4.join)(root, CONFLICT_DIR);
  await mkdir2(dir, { recursive: true });
  const target = (0, import_node_path4.join)(dir, CONFLICT_STATE_FILE);
  const tmp = `${target}.${(0, import_node_crypto3.randomBytes)(4).toString("hex")}.tmp`;
  await writeFile2(tmp, JSON.stringify(state, null, 2), "utf8");
  await rename2(tmp, target);
}
function parseConflictName(name) {
  const m3 = CONFLICT_NAME_RE.exec(name);
  if (m3 === null) return { savedAt: null, originalName: name, cloudMarked: false, pathHash: "" };
  const ms = m3[5] === void 0 ? "000" : m3[5];
  const cloudMarked = /__cloud-/.test(name);
  return {
    savedAt: `${m3[1]}T${m3[2]}:${m3[3]}:${m3[4]}.${ms}Z`,
    originalName: m3[7],
    cloudMarked,
    // 老留档没有这一段，给空串，调用方据此退回「按文件名找正本」的老办法
    pathHash: m3[6] || ""
  };
}
async function listConflicts(root) {
  const dir = (0, import_node_path4.join)(root, CONFLICT_DIR);
  let names;
  try {
    names = await readdir2(dir);
  } catch {
    return [];
  }
  const state = await readConflictState(root);
  const items = [];
  for (const name of names) {
    if ((0, import_node_path4.extname)(name).toLowerCase() !== NOTE_EXT) continue;
    if (name.endsWith(".bak")) continue;
    let st;
    try {
      st = await stat2((0, import_node_path4.join)(dir, name));
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const parsed = parseConflictName(name);
    const mark = state[name];
    items.push({
      name,
      path: `${CONFLICT_DIR}/${name}`,
      originalName: parsed.originalName,
      savedAt: parsed.savedAt,
      pathHash: parsed.pathHash,
      archiveIsCloud: parsed.cloudMarked === true,
      bytes: st.size,
      mtimeMs: st.mtimeMs,
      resolved: mark !== void 0 && mark !== null,
      resolvedAt: mark !== void 0 && mark !== null ? mark.at || null : null,
      keptLocal: mark !== void 0 && mark !== null ? mark.keepLocal === true : null
    });
  }
  items.sort((a3, b3) => {
    const av = a3.savedAt || new Date(a3.mtimeMs).toISOString();
    const bv = b3.savedAt || new Date(b3.mtimeMs).toISOString();
    return bv.localeCompare(av);
  });
  return items;
}
async function readConflict(root, conflictPath) {
  const rel = normalizeRel(conflictPath);
  if (!rel.startsWith(`${CONFLICT_DIR}/`)) {
    throw Object.assign(new Error("\u4E0D\u662F\u51B2\u7A81\u7559\u6863\u8DEF\u5F84"), { status: 400 });
  }
  const { abs } = resolveInside(root, rel);
  const text = await readFile2(abs, "utf8");
  const base = rel.slice(CONFLICT_DIR.length + 1);
  const parsed = parseConflictName(base);
  const { data, body } = parseFrontmatter(text);
  const { entries } = await scanVault(root);
  const hashed = parsed.pathHash === "" ? [] : entries.filter((e3) => conflictPathHash(e3.path) === parsed.pathHash);
  const candidates = hashed.length > 0 ? hashed : entries.filter((e3) => {
    const name = e3.path.split("/").pop() || e3.path;
    return name === parsed.originalName;
  });
  const state = await readConflictState(root);
  const mark = state[base];
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
    candidates: candidates.map((e3) => ({ path: e3.path, title: e3.title, noteId: e3.noteId || "" })),
    resolved: mark !== void 0 && mark !== null,
    resolvedAt: mark !== void 0 && mark !== null ? mark.at || null : null,
    keptLocal: mark !== void 0 && mark !== null ? mark.keepLocal === true : null
  };
}
async function resolveConflict(root, conflictPath, { keepLocal = false, snapshot = null } = {}) {
  const detail = await readConflict(root, conflictPath);
  const target = detail.candidates.length > 0 ? detail.candidates[0].path : detail.originalName;
  const base = detail.path.slice(CONFLICT_DIR.length + 1);
  const state = await readConflictState(root);
  state[base] = { at: (/* @__PURE__ */ new Date()).toISOString(), keepLocal: keepLocal === true };
  await writeConflictState(root, state);
  let liveContent = null;
  if (detail.candidates.length > 0) {
    try {
      const live = await readNote(root, target);
      liveContent = live.content;
    } catch {
      liveContent = null;
    }
  }
  const archiveIsCloud = detail.archiveIsCloud === true;
  const localContent = archiveIsCloud ? liveContent : detail.content;
  const cloudContent = archiveIsCloud ? detail.content : liveContent;
  const wanted = keepLocal === true ? localContent : cloudContent;
  if (wanted === null) {
    throw Object.assign(
      new Error(
        keepLocal === true ? "\u627E\u4E0D\u5230\u8FD9\u6761\u51B2\u7A81\u5BF9\u5E94\u7684\u6B63\u672C\u7B14\u8BB0\uFF0C\u53D6\u4E0D\u5230\u672C\u5730\u7248\u5185\u5BB9\uFF1B\u7559\u6863\u4ECD\u7136\u4FDD\u7559\uFF0C\u53EF\u4EE5\u76F4\u63A5\u6253\u5F00\u5BF9\u7167" : "\u8FD9\u6761\u7559\u6863\u91CC\u6CA1\u6709\u4E91\u7AEF\u7248\u6B63\u6587\uFF0C\u53D6\u4E0D\u5230\u4E91\u7AEF\u7248\u672C\uFF1B\u7559\u6863\u4ECD\u7136\u4FDD\u7559\uFF0C\u53EF\u4EE5\u76F4\u63A5\u6253\u5F00\u5BF9\u7167"
      ),
      { status: 404 }
    );
  }
  if (typeof snapshot === "function" && liveContent !== null) {
    await snapshot(target);
  }
  await writeNote(root, target, wanted, { backup: false });
  return {
    action: keepLocal === true ? "kept-local" : "took-cloud",
    path: target,
    from: detail.path,
    keepLocal: keepLocal === true,
    archiveIsCloud
  };
}
async function unresolveConflict(root, conflictPath) {
  const rel = normalizeRel(conflictPath);
  if (!rel.startsWith(`${CONFLICT_DIR}/`)) {
    throw Object.assign(new Error("\u4E0D\u662F\u51B2\u7A81\u7559\u6863\u8DEF\u5F84"), { status: 400 });
  }
  const base = rel.slice(CONFLICT_DIR.length + 1);
  const state = await readConflictState(root);
  if (state[base] !== void 0) {
    delete state[base];
    await writeConflictState(root, state);
  }
  return { ok: true, path: rel };
}
async function createDir(root, dirInput) {
  const rel = normalizeRel(dirInput);
  if (rel === "") throw Object.assign(new Error("\u76EE\u5F55\u540D\u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
  for (const segment of rel.split("/")) {
    if (IGNORED_DIRS.has(segment)) {
      throw Object.assign(new Error(`\u300C${segment}\u300D\u662F\u63D2\u4EF6\u4FDD\u7559\u7684\u76EE\u5F55\u540D\uFF0C\u6362\u4E00\u4E2A`), { status: 400 });
    }
  }
  const { abs } = resolveInside(root, rel, { create: true });
  try {
    await mkdir2(abs, { recursive: true });
  } catch (error2) {
    throw Object.assign(new Error(`\u5EFA\u76EE\u5F55\u5931\u8D25\uFF1A${error2 && error2.message ? error2.message : error2}`), { status: 500 });
  }
  invalidateScan(root);
  return { ok: true, path: rel };
}
async function removeDir(root, dirInput) {
  const rel = normalizeRel(dirInput);
  if (rel === "") throw Object.assign(new Error("\u4E0D\u80FD\u5220\u9664\u5E93\u6839"), { status: 400 });
  const { abs } = resolveInside(root, rel);
  let dirents;
  try {
    dirents = await readdir2(abs, { withFileTypes: true });
  } catch {
    throw Object.assign(new Error("\u8FD9\u4E2A\u76EE\u5F55\u4E0D\u5B58\u5728"), { status: 404 });
  }
  const notes = dirents.filter((d3) => d3.isFile() && (0, import_node_path4.extname)(d3.name).toLowerCase() === NOTE_EXT);
  if (notes.length > 0) {
    throw Object.assign(new Error(`\u8FD9\u4E2A\u76EE\u5F55\u91CC\u8FD8\u6709 ${notes.length} \u7BC7\u7B14\u8BB0\uFF0C\u5148\u628A\u5B83\u4EEC\u79FB\u8D70\u518D\u5220\u76EE\u5F55`), {
      status: 409,
      notes: notes.length
    });
  }
  const subdirs = dirents.filter((d3) => d3.isDirectory());
  if (subdirs.length > 0) {
    throw Object.assign(new Error(`\u8FD9\u4E2A\u76EE\u5F55\u91CC\u8FD8\u6709 ${subdirs.length} \u4E2A\u5B50\u76EE\u5F55\uFF0C\u5148\u6E05\u7A7A\u518D\u5220`), {
      status: 409,
      dirs: subdirs.length
    });
  }
  try {
    await rmdir2(abs);
  } catch (error2) {
    throw Object.assign(new Error(`\u5220\u76EE\u5F55\u5931\u8D25\uFF1A${error2 && error2.message ? error2.message : error2}`), { status: 500 });
  }
  invalidateScan(root);
  return { ok: true, path: rel };
}
async function renameDir(root, fromInput, toInput) {
  const from = normalizeRel(fromInput);
  const to = normalizeRel(toInput);
  if (from === "") throw Object.assign(new Error("\u8981\u6539\u540D\u7684\u76EE\u5F55\u4E0D\u80FD\u662F\u5E93\u6839"), { status: 400 });
  if (to === "") throw Object.assign(new Error("\u65B0\u76EE\u5F55\u540D\u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
  if (from === to) return { ok: true, from, to, unchanged: true };
  for (const segment of to.split("/")) {
    if (IGNORED_DIRS.has(segment)) {
      throw Object.assign(new Error(`\u300C${segment}\u300D\u662F\u63D2\u4EF6\u4FDD\u7559\u7684\u76EE\u5F55\u540D\uFF0C\u6362\u4E00\u4E2A`), { status: 400 });
    }
  }
  const { abs: srcAbs } = resolveInside(root, from);
  let srcStat;
  try {
    srcStat = await stat2(srcAbs);
  } catch {
    throw Object.assign(new Error("\u8FD9\u4E2A\u76EE\u5F55\u4E0D\u5B58\u5728"), { status: 404 });
  }
  if (!srcStat.isDirectory()) throw Object.assign(new Error("\u8FD9\u4E0D\u662F\u4E00\u4E2A\u76EE\u5F55"), { status: 400 });
  const { abs: dstAbs, rel: dstRel } = resolveInside(root, to, { create: true });
  try {
    await stat2(dstAbs);
    throw Object.assign(new Error(`\u300C${dstRel}\u300D\u5DF2\u7ECF\u5B58\u5728\uFF0C\u6362\u4E00\u4E2A\u540D\u5B57`), { status: 409 });
  } catch (error2) {
    if (error2 && error2.status === 409) throw error2;
  }
  try {
    await mkdir2((0, import_node_path4.dirname)(dstAbs), { recursive: true });
    await rename2(srcAbs, dstAbs);
  } catch (error2) {
    throw Object.assign(new Error(`\u6539\u76EE\u5F55\u540D\u5931\u8D25\uFF1A${error2 && error2.message ? error2.message : error2}`), {
      status: 500
    });
  }
  await moveHistoryEntries(root, from, to);
  invalidateScan(root);
  return { ok: true, from, to };
}
function rewriteTags(text, tags) {
  const list = Array.isArray(tags) ? tags.map((tag) => String(tag).trim()).filter((tag) => tag !== "") : [];
  const replacement = list.length > 0 ? `tags: [${list.join(", ")}]` : "tags: []";
  const source = String(text == null ? "" : text);
  if (!/^---\r?\n/.test(source)) return `---
${replacement}
---
${source}`;
  const end = source.indexOf("\n---", 4);
  if (end === -1) return `---
${replacement}
---
${source}`;
  const head = source.slice(0, end);
  const rest = source.slice(end);
  const lines = head.split("\n");
  const start = lines.findIndex((line) => /^tags\s*:/.test(line));
  if (start === -1) {
    return `${head}
${replacement}${rest}`;
  }
  let stop = start + 1;
  if (!/^tags\s*:.*\S/.test(lines[start])) {
    while (stop < lines.length && /^\s+-\s*/.test(lines[stop])) stop += 1;
  }
  const next = [...lines.slice(0, start), replacement, ...lines.slice(stop)];
  return `${next.join("\n")}${rest}`;
}
function readTags(text) {
  const source = String(text == null ? "" : text);
  if (!/^---\r?\n/.test(source)) return [];
  const end = source.indexOf("\n---", 4);
  if (end === -1) return [];
  const lines = source.slice(0, end).split("\n");
  const start = lines.findIndex((line) => /^tags\s*:/.test(line));
  if (start === -1) return [];
  const inline = lines[start].replace(/^tags\s*:\s*/, "").trim();
  if (inline.startsWith("[")) {
    return inline.replace(/^\[/, "").replace(/\]$/, "").split(",").map((tag) => tag.trim().replace(/^['"]|['"]$/g, "")).filter((tag) => tag !== "");
  }
  if (inline !== "") return [inline.replace(/^['"]|['"]$/g, "")];
  const out = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const item = /^\s+-\s*(.+)$/.exec(lines[index]);
    if (!item) break;
    const tag = item[1].trim().replace(/^['"]|['"]$/g, "");
    if (tag !== "") out.push(tag);
  }
  return out;
}
async function removeTag(root, tagInput, entries, options = {}) {
  const tag = String(tagInput || "").trim();
  if (tag === "") throw Object.assign(new Error("\u6807\u7B7E\u540D\u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
  const snapshot = typeof options.snapshot === "function" ? options.snapshot : null;
  let changed = 0;
  const failed = [];
  for (const entry of entries) {
    const current = Array.isArray(entry.tags) ? entry.tags : [];
    if (!current.includes(tag)) continue;
    try {
      const note = await readNote(root, entry.path);
      const text = note.content;
      const actual = readTags(text);
      const inlineSet = new Set(extractInlineTags(note.body));
      const base = (actual.length > 0 ? actual : current).filter((t4) => !inlineSet.has(t4));
      const withHead = rewriteTags(text, base.filter((t4) => t4 !== tag));
      const updated = applyInlineTagEdit(withHead, tag, "");
      if (updated === text) continue;
      if (snapshot) {
        try {
          await snapshot(entry.path);
        } catch {
        }
      }
      await writeNote(root, entry.path, updated, { backup: snapshot === null });
      changed += 1;
    } catch (error2) {
      failed.push({ path: entry.path, error: error2 && error2.message ? error2.message : String(error2) });
    }
  }
  return { ok: true, changed, failed, total: entries.length, tag };
}
async function renameTag(root, fromInput, toInput, entries, options = {}) {
  const from = String(fromInput || "").trim();
  const to = String(toInput || "").trim();
  if (from === "") throw Object.assign(new Error("\u8981\u6539\u540D\u7684\u6807\u7B7E\u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
  if (to === "") throw Object.assign(new Error("\u65B0\u6807\u7B7E\u540D\u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
  if (from === to) return { ok: true, changed: 0, failed: [], total: entries.length, from, to };
  const snapshot = typeof options.snapshot === "function" ? options.snapshot : null;
  let changed = 0;
  const failed = [];
  for (const entry of entries) {
    const current = Array.isArray(entry.tags) ? entry.tags : [];
    if (!current.includes(from)) continue;
    try {
      const note = await readNote(root, entry.path);
      const text = note.content;
      const actual = readTags(text);
      const inlineSet = new Set(extractInlineTags(note.body));
      const base = (actual.length > 0 ? actual : current).filter((t4) => !inlineSet.has(t4));
      const next = [];
      for (const tag of base) {
        const value = tag === from ? to : tag;
        if (!next.includes(value)) next.push(value);
      }
      const updated = applyInlineTagEdit(rewriteTags(text, next), from, to);
      if (updated === text) continue;
      if (snapshot) {
        try {
          await snapshot(entry.path);
        } catch {
        }
      }
      await writeNote(root, entry.path, updated, { backup: snapshot === null });
      changed += 1;
    } catch (error2) {
      failed.push({ path: entry.path, error: error2 && error2.message ? error2.message : String(error2) });
    }
  }
  return { ok: true, changed, failed, total: entries.length, from, to };
}
function heatmapOf(entries, { weeks = 26, today = null } = {}) {
  const span = Math.max(4, Math.min(104, Number(weeks) || 26));
  const counts = /* @__PURE__ */ new Map();
  for (const entry of entries || []) {
    const date = entry && typeof entry.date === "string" ? entry.date : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    counts.set(date, (counts.get(date) || 0) + 1);
  }
  const base = today instanceof Date ? new Date(today.getTime()) : /* @__PURE__ */ new Date();
  base.setHours(0, 0, 0, 0);
  const pad2 = (n2) => String(n2).padStart(2, "0");
  const key = (d3) => `${d3.getFullYear()}-${pad2(d3.getMonth() + 1)}-${pad2(d3.getDate())}`;
  const end = new Date(base.getTime());
  end.setDate(end.getDate() + (6 - end.getDay()));
  const days = [];
  let total = 0;
  let best = 0;
  for (let i3 = span * 7 - 1; i3 >= 0; i3 -= 1) {
    const d3 = new Date(end.getTime());
    d3.setDate(d3.getDate() - i3);
    const date = key(d3);
    const count = counts.get(date) || 0;
    days.push({ date, count, future: d3.getTime() > base.getTime() });
    if (count > 0 && d3.getTime() <= base.getTime()) {
      total += count;
      if (count > best) best = count;
    }
  }
  let streak = 0;
  for (let i3 = days.length - 1; i3 >= 0; i3 -= 1) {
    const day = days[i3];
    if (day.future) continue;
    if (day.count > 0) streak += 1;
    else if (day.date === key(base)) continue;
    else break;
  }
  return { days, total, streak, best, weeks: span };
}
async function toggleTodo(root, rel, index, options = {}) {
  const position = Number(index);
  if (!Number.isInteger(position) || position < 0) {
    throw Object.assign(new Error("\u5F85\u529E\u5E8F\u53F7\u4E0D\u5BF9"), { status: 400 });
  }
  const note = await readNote(root, rel);
  const content = note.content;
  const lines = content.split("\n");
  let fmEnd = 0;
  if (lines.length > 0 && lines[0].trim() === "---") {
    for (let i3 = 1; i3 < lines.length; i3 += 1) {
      if (lines[i3].trim() === "---") {
        fmEnd = i3 + 1;
        break;
      }
    }
  }
  const TASK = /^(\s*)([-*+])\s+\[( |x|X)\]\s+(.*)$/;
  let seen = -1;
  let inFence = false;
  let fenceMarker = "";
  let targetLine = -1;
  let targetMatch = null;
  for (let i3 = fmEnd; i3 < lines.length; i3 += 1) {
    const line = lines[i3];
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1];
      } else if (line.trim().startsWith(fenceMarker)) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    const match = TASK.exec(line);
    if (!match) continue;
    seen += 1;
    if (seen === position) {
      targetLine = i3;
      targetMatch = match;
      break;
    }
  }
  if (targetLine < 0 || targetMatch === null) {
    throw Object.assign(new Error("\u8FD9\u7BC7\u7B14\u8BB0\u91CC\u6CA1\u6709\u8FD9\u4E00\u6761\u5F85\u529E"), { status: 404 });
  }
  const wasDone = targetMatch[3].toLowerCase() === "x";
  const indent = targetMatch[1];
  const bullet = targetMatch[2];
  const text = targetMatch[4];
  lines[targetLine] = `${indent}${bullet} [${wasDone ? " " : "x"}] ${text}`;
  const updated = lines.join("\n");
  const snapshot = typeof options.snapshot === "function" ? options.snapshot : null;
  if (snapshot) {
    try {
      await snapshot(rel);
    } catch {
    }
  }
  await writeNote(root, rel, updated, { backup: snapshot === null });
  return { ok: true, path: note.path, index: position, done: !wasDone };
}
async function listOpenTodos(root, entries) {
  const list = Array.isArray(entries) ? entries : (await scanVault(root)).entries;
  const items = [];
  const MAX_ITEMS = 500;
  for (const entry of list) {
    let text;
    try {
      text = await readFile2(resolveInside(root, entry.path).abs, "utf8");
    } catch {
      continue;
    }
    const lines = maskComments(text).split(/\r?\n/);
    let inFence = false;
    let index = -1;
    for (let i3 = 0; i3 < lines.length; i3 += 1) {
      const line = lines[i3];
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const m3 = /^(\s*)([-*+]) \[( |x|X)\]\s+(.*)$/.exec(line);
      if (m3 === null) continue;
      index += 1;
      if (m3[3].toLowerCase() === "x") continue;
      const content = m3[4].trim();
      items.push({
        path: entry.path,
        title: entry.title,
        line: i3 + 1,
        index,
        text: content,
        // 行尾的标签单独挑出来当胶囊：待办列表里最常问的是「这是哪一类的」
        tags: extractInlineTags(content)
      });
      if (items.length >= MAX_ITEMS) break;
    }
    if (items.length >= MAX_ITEMS) break;
  }
  items.sort((a3, b3) => {
    const byPath = String(a3.path).localeCompare(String(b3.path), "zh");
    if (byPath !== 0) return byPath;
    return a3.line - b3.line;
  });
  return { items, scanned: list.length, truncated: items.length >= MAX_ITEMS };
}
function isTagBody(value) {
  const body = String(value || "");
  if (body === "") return false;
  if (!/^[\w\u4e00-\u9fa5/-]+$/.test(body)) return false;
  if (/^[\d/]+$/.test(body)) return false;
  if (body.endsWith("/")) return false;
  return true;
}
function extractInlineTags(text) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  let inFence = false;
  for (const rawLine of maskComments(text).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const line = rawLine.replace(/`[^`\n]*`/g, " ");
    TAG_TOKEN_RE.lastIndex = 0;
    let m3;
    while ((m3 = TAG_TOKEN_RE.exec(line)) !== null) {
      const body = m3[2];
      if (!isTagBody(body)) continue;
      if (seen.has(body)) continue;
      seen.add(body);
      out.push(body);
    }
  }
  return out;
}
function splitFrontmatterText(text) {
  const src = String(text == null ? "" : text);
  if (!/^---\r?\n/.test(src)) return { head: "", body: src };
  const end = src.indexOf("\n---", 4);
  if (end === -1) return { head: "", body: src };
  const close = src.indexOf("\n", end + 1);
  if (close === -1) return { head: src, body: "" };
  return { head: src.slice(0, close + 1), body: src.slice(close + 1) };
}
function applyInlineTagEdit(text, from, to) {
  const fromTag = String(from || "").trim();
  if (fromTag === "") return String(text == null ? "" : text);
  const nextTag = String(to == null ? "" : to).trim();
  const { head, body } = splitFrontmatterText(text);
  let inFence = false;
  const lines = body.split("\n").map((rawLine) => {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      return rawLine;
    }
    if (inFence) return rawLine;
    return rawLine.replace(TAG_TOKEN_RE, (whole, lead, bodyText) => {
      if (!isTagBody(bodyText) || bodyText !== fromTag) return whole;
      if (nextTag === "") return lead;
      return `${lead}#${nextTag}`;
    });
  });
  return head + lines.join("\n");
}
function mergeTags(head, inline) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const tag of [...Array.isArray(head) ? head : [], ...Array.isArray(inline) ? inline : []]) {
    const value = String(tag || "").trim();
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
function normalizeTags(value) {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter((tag) => tag !== "");
  if (value === void 0 || value === null) return [];
  const single = String(value).trim();
  return single === "" ? [] : [single];
}
function normalizeAliases(value) {
  if (value === void 0 || value === null) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item === null || item === void 0 ? "" : item).trim()).filter((item) => item !== "");
  }
  const single = String(value).trim();
  return single === "" ? [] : [single];
}
function linkNamesOf(entry) {
  const path = String(entry && entry.path || "").trim();
  if (path === "") return [];
  const noExt = path.replace(/\.md$/i, "");
  const base = noExt.split("/").pop() || noExt;
  const names = [path, noExt, base];
  const title = String(entry && entry.title || "").trim();
  if (title !== "") names.push(title);
  for (const alias of normalizeAliases(entry && entry.aliases)) names.push(alias);
  return names;
}
async function vaultStats(root, entries) {
  let bytes = 0;
  const dirs = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    bytes += entry.bytes || 0;
    const d3 = import_node_path4.posix.dirname(entry.path);
    if (d3 !== "." && d3 !== "") dirs.add(d3);
  }
  return { notes: entries.length, dirs: dirs.size, bytes };
}
function listDirs(entries) {
  const dirs = /* @__PURE__ */ new Set([""]);
  for (const entry of entries) {
    const segments = entry.path.split("/").slice(0, -1);
    let acc = "";
    for (const segment of segments) {
      acc = acc === "" ? segment : `${acc}/${segment}`;
      dirs.add(acc);
    }
  }
  return [...dirs].sort((a3, b3) => a3.localeCompare(b3, "zh"));
}
var import_node_crypto3, import_node_path4, NOTE_EXT, MAX_READ, MAX_WRITE, MAX_SCAN, MAX_DEPTH, IGNORED_DIRS, scanCache, SCAN_CACHE_MAX, entryMemo, ENTRY_MEMO_MAX, TRASH_DIR, TRASH_NAME_RE, CONFLICT_DIR, CONFLICT_NAME_RE, CONFLICT_STATE_FILE, TAG_TOKEN_RE;
var init_vault = __esm({
  "src/core/vault.js"() {
    init_vfs();
    import_node_crypto3 = require("node:crypto");
    init_history();
    import_node_path4 = require("node:path");
    NOTE_EXT = ".md";
    MAX_READ = 2 * 1024 * 1024;
    MAX_WRITE = 2 * 1024 * 1024;
    MAX_SCAN = 8e3;
    MAX_DEPTH = 8;
    IGNORED_DIRS = /* @__PURE__ */ new Set([
      ".git",
      "node_modules",
      ".obsidian",
      ".trash",
      ".conflicts",
      ".history",
      ".dsh",
      "$RECYCLE.BIN",
      "__MACOSX",
      ".DS_Store",
      ".venv",
      "asset"
    ]);
    scanCache = /* @__PURE__ */ new Map();
    SCAN_CACHE_MAX = 4;
    entryMemo = /* @__PURE__ */ new Map();
    ENTRY_MEMO_MAX = 2e4;
    TRASH_DIR = ".trash";
    TRASH_NAME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z__(.+)$/;
    CONFLICT_DIR = ".conflicts";
    CONFLICT_NAME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z?__(?:([0-9a-f]{6})__)?(?:cloud-)?(.+)$/;
    CONFLICT_STATE_FILE = ".resolved.json";
    TAG_TOKEN_RE = /(^|[\s([{>（【，、；：])#([^\s#`]+)/g;
  }
});

// src/core/net.js
function headerBag(raw) {
  const store = /* @__PURE__ */ new Map();
  for (const [key, value] of Object.entries(raw || {})) {
    if (value === void 0 || value === null) continue;
    store.set(key.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value));
  }
  return {
    get(name) {
      const found = store.get(String(name).toLowerCase());
      return found === void 0 ? null : found;
    },
    has(name) {
      return store.has(String(name).toLowerCase());
    },
    forEach(fn2) {
      for (const [key, value] of store) fn2(value, key);
    }
  };
}
function makeResponse(status, rawHeaders, buffer) {
  const headers = headerBag(rawHeaders);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers,
    // service.js 里用 `if (!upstream.body) return res.end()` 判断有没有响应体；
    // 这里整块读完了才返回，所以只要状态码不是 204/304 就给一个真值占位。
    body: status === 204 || status === 304 ? null : {},
    async text() {
      return buffer.toString("utf8");
    },
    async json() {
      return JSON.parse(buffer.toString("utf8"));
    },
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
  };
}
function bodyToBuffer(body) {
  if (body === void 0 || body === null) return null;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  return Buffer.from(String(body), "utf8");
}
function once(url, init, redirectsLeft) {
  return new Promise((resolve5, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(Object.assign(new Error(`\u65E0\u6548\u7684\u5730\u5740\uFF1A${url}`), { status: 400 }));
      return;
    }
    const isHttps = target.protocol === "https:";
    const send2 = isHttps ? import_node_https.request : import_node_http.request;
    const headers = {};
    for (const [key, value] of Object.entries(init.headers || {})) {
      if (value === void 0 || value === null) continue;
      headers[key] = String(value);
    }
    const payload = bodyToBuffer(init.body);
    if (payload !== null && headers["content-length"] === void 0) {
      headers["content-length"] = String(payload.length);
    }
    const req = send2(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: (init.method || "GET").toUpperCase(),
        headers
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        const follow = init.redirect === "follow" || init.redirect === void 0;
        if (follow && status >= 300 && status < 400 && location && redirectsLeft > 0) {
          res.resume();
          const next = new URL(location, target).toString();
          resolve5(once(next, init, redirectsLeft - 1));
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve5(makeResponse(status, res.headers, Buffer.concat(chunks))));
        res.on("error", reject);
      }
    );
    req.on("error", (cause) => {
      const error2 = new Error(`\u8FDE\u4E0D\u4E0A ${target.hostname}\uFF08${cause && cause.message ? cause.message : "\u7F51\u7EDC\u9519\u8BEF"}\uFF09`);
      error2.status = 502;
      error2.cause = cause;
      reject(error2);
    });
    const signal = init.signal;
    if (signal) {
      if (signal.aborted) {
        req.destroy(new Error("aborted"));
        return;
      }
      signal.addEventListener("abort", () => {
        req.destroy(Object.assign(new Error("\u8BF7\u6C42\u8D85\u65F6"), { name: "TimeoutError" }));
      });
    }
    if (payload !== null) req.write(payload);
    req.end();
  });
}
async function netFetch(url, init = {}) {
  return once(url, init, MAX_REDIRECTS);
}
var import_node_http, import_node_https, MAX_REDIRECTS;
var init_net = __esm({
  "src/core/net.js"() {
    import_node_http = require("node:http");
    import_node_https = require("node:https");
    MAX_REDIRECTS = 5;
  }
});

// src/core/biji.js
var biji_exports = {};
__export(biji_exports, {
  ISSUER: () => ISSUER,
  MCP_URL: () => MCP_URL,
  McpClient: () => McpClient,
  SCOPES: () => SCOPES,
  buildAuthorizeUrl: () => buildAuthorizeUrl,
  createPkce: () => createPkce,
  exchangeCode: () => exchangeCode,
  refreshToken: () => refreshToken,
  registerClient: () => registerClient,
  revokeToken: () => revokeToken
});
function remoteError(what, status, body) {
  const snippet = String(body || "").replace(/\s+/g, " ").slice(0, 300);
  const error2 = new Error(`${what} \u5931\u8D25\uFF08HTTP ${status}\uFF09${snippet ? `\uFF1A${snippet}` : ""}`);
  error2.status = status;
  return error2;
}
async function httpJson(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeout || REQUEST_TIMEOUT);
  try {
    const res = await netFetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { res, text };
  } finally {
    clearTimeout(timer);
  }
}
function createPkce() {
  const verifier = (0, import_node_crypto4.randomBytes)(48).toString("base64url");
  const challenge = (0, import_node_crypto4.createHash)("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
async function registerClient(redirectUri) {
  const payload = {
    client_name: "DSH \u5F97\u5230\u5927\u8111\u9762\u677F",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: SCOPES
  };
  const { res, text } = await httpJson(`${ISSUER}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw remoteError("\u5BA2\u6237\u7AEF\u6CE8\u518C", res.status, text);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw remoteError("\u5BA2\u6237\u7AEF\u6CE8\u518C", res.status, text);
  }
  if (!data || typeof data.client_id !== "string") {
    throw new Error("\u5BA2\u6237\u7AEF\u6CE8\u518C\u54CD\u5E94\u7F3A\u5C11 client_id");
  }
  return { clientId: data.client_id, clientSecret: typeof data.client_secret === "string" ? data.client_secret : null };
}
function buildAuthorizeUrl({ clientId, redirectUri, state, challenge }) {
  const url = new URL(`${ISSUER}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", MCP_URL);
  return url.toString();
}
async function exchangeCode({ clientId, code, redirectUri, verifier }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier
  });
  const { res, text } = await httpJson(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString()
  });
  if (!res.ok) throw remoteError("\u6362\u53D6\u8BBF\u95EE\u4EE4\u724C", res.status, text);
  return normalizeTokenResponse(JSON.parse(text), clientId, redirectUri);
}
async function refreshToken({ clientId, refreshToken: rt }) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: rt,
    client_id: clientId
  });
  const { res, text } = await httpJson(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString()
  });
  if (!res.ok) throw remoteError("\u5237\u65B0\u8BBF\u95EE\u4EE4\u724C", res.status, text);
  return normalizeTokenResponse(JSON.parse(text), clientId, null);
}
function normalizeTokenResponse(data, clientId, redirectUri) {
  const accessToken = data && typeof data.access_token === "string" ? data.access_token : null;
  if (!accessToken) throw new Error("\u4EE4\u724C\u54CD\u5E94\u7F3A\u5C11 access_token");
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return {
    accessToken,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresAt: Date.now() + expiresIn * 1e3,
    clientId,
    redirectUri: redirectUri || null,
    obtainedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function revokeToken(token) {
  try {
    await httpJson(`${ISSUER}/oauth/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, token_type_hint: "access_token" }).toString(),
      timeout: 1e4
    });
  } catch {
  }
}
var import_node_crypto4, ISSUER, MCP_URL, SCOPES, REQUEST_TIMEOUT, McpClient;
var init_biji = __esm({
  "src/core/biji.js"() {
    import_node_crypto4 = require("node:crypto");
    init_net();
    ISSUER = "https://openapi.biji.com";
    MCP_URL = `${ISSUER}/mcp`;
    SCOPES = [
      "note.content.read",
      "note.recall.read",
      "note.tag.read",
      "note.topic.read",
      "note.topic.recall.read",
      "topic.read"
    ].join(" ");
    REQUEST_TIMEOUT = 45e3;
    McpClient = class {
      constructor(accessToken, { url = MCP_URL } = {}) {
        this.url = url;
        this.accessToken = accessToken;
        this.sessionId = null;
        this.nextId = 1;
        this.protocolVersion = "2025-06-18";
        this.serverInfo = null;
      }
      headers() {
        const h5 = {
          authorization: `Bearer ${this.accessToken}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream"
        };
        if (this.sessionId) h5["mcp-session-id"] = this.sessionId;
        return h5;
      }
      async post(payload) {
        const { res, text } = await httpJson(this.url, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(payload),
          timeout: 12e4
        });
        const session = res.headers.get("mcp-session-id");
        if (session) this.sessionId = session;
        if (!res.ok) throw remoteError(`MCP ${payload.method || "request"}`, res.status, text);
        return { res, text };
      }
      /** 把一次响应体解析成 JSON-RPC 结果（兼容 SSE）。 */
      parseBody(text, contentType) {
        const raw = String(text || "").trim();
        if (raw === "") return null;
        if (String(contentType || "").includes("text/event-stream")) {
          const chunks = raw.split(/\r?\n\r?\n/);
          let found = null;
          for (const chunk of chunks) {
            const dataLines = chunk.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
            if (dataLines.length === 0) continue;
            try {
              const message = JSON.parse(dataLines.join("\n"));
              if (message && (message.result !== void 0 || message.error !== void 0)) found = message;
            } catch {
            }
          }
          return found;
        }
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      async initialize() {
        const id = this.nextId++;
        const { res, text } = await this.post({
          jsonrpc: "2.0",
          id,
          method: "initialize",
          params: {
            protocolVersion: this.protocolVersion,
            capabilities: {},
            clientInfo: { name: "dsh-getnote", version: "0.1.0" }
          }
        });
        const message = this.parseBody(text, res.headers.get("content-type"));
        if (!message || message.error) {
          throw new Error(`MCP initialize \u5931\u8D25\uFF1A${message && message.error ? JSON.stringify(message.error).slice(0, 200) : "\u65E0\u6709\u6548\u54CD\u5E94"}`);
        }
        this.serverInfo = message.result && message.result.serverInfo ? message.result.serverInfo : null;
        await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
        return this.serverInfo;
      }
      async listTools() {
        const id = this.nextId++;
        const { res, text } = await this.post({ jsonrpc: "2.0", id, method: "tools/list", params: {} });
        const message = this.parseBody(text, res.headers.get("content-type"));
        if (!message || message.error) throw new Error("MCP tools/list \u5931\u8D25");
        return message.result && message.result.tools || [];
      }
      /**
       * 调一个工具。
       *
       * 得到大脑的工具把结构化结果放在 `content[0].text` 里（是 JSON 字符串），
       * 这里统一解开；解不开就把原文当字符串返回，绝不让「格式不认识」变成数据丢失。
       */
      async callTool(name, args = {}) {
        const id = this.nextId++;
        const { res, text } = await this.post({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name, arguments: args }
        });
        const message = this.parseBody(text, res.headers.get("content-type"));
        if (!message) throw new Error(`MCP ${name} \u65E0\u6709\u6548\u54CD\u5E94`);
        if (message.error) {
          const err = new Error(`MCP ${name} \u9519\u8BEF\uFF1A${message.error.message || JSON.stringify(message.error)}`);
          err.mcpError = message.error;
          throw err;
        }
        const result = message.result || {};
        const parts = Array.isArray(result.content) ? result.content : [];
        const textPart = parts.find((p3) => p3 && p3.type === "text" && typeof p3.text === "string");
        if (!textPart) return result.structuredContent ?? result;
        const raw = textPart.text;
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      }
    };
  }
});

// src/main.js
var main_exports = {};
__export(main_exports, {
  PanelIcon: () => PanelIcon,
  default: () => GetnoteObsidianPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");
var import_promises2 = require("node:fs/promises");
var import_node_os2 = require("node:os");
var import_node_path7 = require("node:path");

// src/core/settings.js
var import_promises = require("node:fs/promises");
init_vfs();
var import_node_crypto = require("node:crypto");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var SETTINGS_FILENAME = "dsh-getnote.json";
var AUTH_FILENAME = "dsh-getnote/auth.json";
var CLOUD_FILENAME = "dsh-getnote/cloud.json";
var SYNC_FILENAME = "dsh-getnote/state.json";
var runtime = {
  dataDir: "",
  vaultBase: "",
  subfolder: "\u5F97\u5230\u5927\u8111"
};
function configure2(options = {}) {
  if (typeof options.dataDir === "string" && options.dataDir !== "") runtime.dataDir = options.dataDir;
  if (typeof options.vaultBase === "string" && options.vaultBase !== "") runtime.vaultBase = options.vaultBase;
  if (typeof options.subfolder === "string" && options.subfolder.trim() !== "") runtime.subfolder = options.subfolder.trim();
  return { ...runtime };
}
function getRuntime() {
  return { ...runtime };
}
function dshHome() {
  if (runtime.dataDir !== "") return runtime.dataDir;
  const env = process.env.DSH_HOME;
  return env && env.trim() !== "" ? env : (0, import_node_path.join)((0, import_node_os.homedir)(), ".dsh");
}
function settingsPath() {
  return (0, import_node_path.join)(dshHome(), SETTINGS_FILENAME);
}
function authPath() {
  return (0, import_node_path.join)(dshHome(), AUTH_FILENAME);
}
function defaultVaultRoot() {
  const base = runtime.vaultBase;
  if (base === "") return (0, import_node_path.join)((0, import_node_os.homedir)(), "\u5F97\u5230\u5927\u8111");
  return (0, import_node_path.join)(base, runtime.subfolder);
}
function toSubfolder(input) {
  const raw = String(input == null ? "" : input).replace(/\\/g, "/").trim();
  if (raw === "") return "\u5F97\u5230\u5927\u8111";
  const base = runtime.vaultBase.replace(/\\/g, "/");
  let rel = raw;
  if (base !== "" && raw.toLowerCase().startsWith(base.toLowerCase())) rel = raw.slice(base.length);
  rel = rel.replace(/^\/+/, "").replace(/\/+$/, "");
  if (rel === "") return "\u5F97\u5230\u5927\u8111";
  if (rel.split("/").includes("..")) return "\u5F97\u5230\u5927\u8111";
  return rel;
}
function knownVaultCandidates() {
  const list = [];
  if (runtime.vaultBase !== "") list.push((0, import_node_path.join)(runtime.vaultBase, runtime.subfolder));
  const fromEnv = process.env.DSH_GETNOTE_VAULT;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") list.unshift(fromEnv.trim());
  return list;
}
async function readJson(path) {
  try {
    const parsed = JSON.parse(await (0, import_promises.readFile)(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
async function writeJsonAtomic(path, value, mode) {
  await (0, import_promises.mkdir)((0, import_node_path.dirname)(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${(0, import_node_crypto.randomBytes)(4).toString("hex")}.tmp`;
  await (0, import_promises.writeFile)(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  if (mode) {
    try {
      await (0, import_promises.chmod)(tmp, mode);
    } catch {
    }
  }
  await (0, import_promises.rename)(tmp, path);
}
function normalizeThemeColor(input) {
  if (typeof input !== "string") return null;
  const raw = input.trim().toLowerCase();
  if (raw === "") return null;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(raw);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/.test(raw) ? raw : null;
}
function normalizeLocale(input) {
  if (typeof input !== "string") return null;
  const raw = input.trim().toLowerCase();
  if (raw === "") return null;
  if (raw === "zh" || raw.startsWith("zh-")) return "zh";
  if (raw === "en" || raw.startsWith("en-")) return "en";
  if (raw === "nl" || raw.startsWith("nl-")) return "nl";
  return null;
}
async function readSettings() {
  const data = await readJson(settingsPath());
  const auto = normalizeAutoSync({
    autoSync: data.autoSync,
    autoSyncMinutes: data.autoSyncMinutes,
    autoSyncIncremental: data.autoSyncIncremental,
    autoSyncForegroundOnly: data.autoSyncForegroundOnly
  });
  return {
    vaultRoot: typeof data.vaultRoot === "string" && data.vaultRoot.trim() !== "" ? data.vaultRoot : null,
    lastSyncAt: typeof data.lastSyncAt === "string" ? data.lastSyncAt : null,
    syncImages: data.syncImages === true,
    autoSync: auto.enabled,
    autoSyncMinutes: auto.intervalMinutes,
    autoSyncIncremental: auto.incremental,
    autoSyncForegroundOnly: auto.foregroundOnly,
    themeColor: normalizeThemeColor(data.themeColor),
    uiLocale: normalizeLocale(data.uiLocale),
    templates: normalizeTemplates(data.templates),
    subfolder: typeof data.subfolder === "string" && data.subfolder.trim() !== "" ? data.subfolder.trim() : null,
    // Obsidian 版专有：本地回环服务的端口。固定端口才能让 OAuth 的
    // redirect_uri 跨会话稳定，不必每次登录都重新动态注册一个 client。
    localPort: Number.isInteger(data.localPort) && data.localPort > 0 && data.localPort < 65536 ? data.localPort : null,
    // 详细日志默认关：控制台里挤着几十个插件，刷屏的输出用户反而不看。
    debugLogging: data.debugLogging === true,
    // 录音卡插上就导：默认关。它要定期用蓝牙连一次卡片看有没有新录音，
    // 占着适配器、也耗电，得用户自己说「我要」才开。
    cardAutoImport: data.cardAutoImport === true,
    // 跟着宿主切换笔记：默认关。开着时用户在 Obsidian 里翻到哪一篇，面板就跟着
    // 打开同一篇。默认关是因为「面板自己动」这件事得用户点头——他可能正开着
    // 一篇对照着看，不希望一切换标签页就被顶掉。
    followActive: data.followActive === true
  };
}
async function updateSettings(patch = {}) {
  const cur = await readSettings();
  const next = {
    ...patch.vaultRoot !== void 0 ? { vaultRoot: patch.vaultRoot } : cur.vaultRoot ? { vaultRoot: cur.vaultRoot } : {},
    lastSyncAt: patch.lastSyncAt !== void 0 ? patch.lastSyncAt : cur.lastSyncAt,
    syncImages: patch.syncImages !== void 0 ? patch.syncImages : cur.syncImages,
    autoSync: patch.autoSync !== void 0 ? patch.autoSync === true : cur.autoSync,
    autoSyncMinutes: patch.autoSyncMinutes !== void 0 ? normalizeAutoSync({ autoSyncMinutes: patch.autoSyncMinutes }).intervalMinutes : cur.autoSyncMinutes,
    autoSyncIncremental: patch.autoSyncIncremental !== void 0 ? patch.autoSyncIncremental !== false : cur.autoSyncIncremental,
    autoSyncForegroundOnly: patch.autoSyncForegroundOnly !== void 0 ? patch.autoSyncForegroundOnly === true : cur.autoSyncForegroundOnly,
    themeColor: "themeColor" in patch ? normalizeThemeColor(patch.themeColor) : cur.themeColor,
    uiLocale: "uiLocale" in patch ? normalizeLocale(patch.uiLocale) : cur.uiLocale,
    templates: "templates" in patch ? normalizeTemplates(patch.templates) : cur.templates,
    subfolder: patch.subfolder !== void 0 ? toSubfolder(patch.subfolder) : cur.subfolder,
    localPort: patch.localPort !== void 0 ? patch.localPort : cur.localPort,
    debugLogging: patch.debugLogging !== void 0 ? patch.debugLogging === true : cur.debugLogging,
    cardAutoImport: patch.cardAutoImport !== void 0 ? patch.cardAutoImport === true : cur.cardAutoImport,
    followActive: patch.followActive !== void 0 ? patch.followActive === true : cur.followActive
  };
  await writeJsonAtomic(settingsPath(), next);
  return readSettings();
}
function expandHome(input) {
  if (typeof input !== "string") return input;
  const trimmed = input.trim();
  if (trimmed === "~") return (0, import_node_os.homedir)();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return (0, import_node_path.join)((0, import_node_os.homedir)(), trimmed.slice(2));
  return trimmed;
}
async function setVaultRoot(input) {
  const expanded = expandHome(input);
  if (typeof expanded !== "string" || expanded.trim() === "") {
    throw Object.assign(new Error("\u76EE\u5F55\u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
  }
  if ((0, import_node_path.isAbsolute)(expanded) || /^[A-Za-z]:[\\/]/.test(expanded) || /^[\\/]{2}/.test(expanded)) {
    const base = runtime.vaultBase.replace(/\\/g, "/").toLowerCase();
    const normalized = expanded.replace(/\\/g, "/").toLowerCase();
    const inside = base !== "" && (normalized === base || normalized.startsWith(base + "/"));
    if (!inside) {
      throw Object.assign(new Error("\u53EA\u80FD\u4F7F\u7528\u5F53\u524D\u5E93\u5185\u7684\u76EE\u5F55"), { status: 400 });
    }
  }
  const sub = toSubfolder(expanded);
  runtime.subfolder = sub;
  await updateSettings({ subfolder: sub });
  const target = defaultVaultRoot();
  await mkdir2(target, { recursive: true });
  return target;
}
async function resolveVaultRoot(configured) {
  const sub = typeof configured === "string" && configured.trim() !== "" ? toSubfolder(configured) : runtime.subfolder;
  if (sub !== runtime.subfolder) runtime.subfolder = sub;
  const root = defaultVaultRoot();
  try {
    const st = await stat2(root);
    if (st.isDirectory()) return { root, missing: null };
  } catch {
    return { root, missing: root };
  }
  return { root, missing: null };
}
async function readAuth() {
  const data = await readJson(authPath());
  if (!data || typeof data !== "object") return null;
  if (typeof data.accessToken !== "string" || data.accessToken === "") return null;
  return {
    accessToken: data.accessToken,
    refreshToken: typeof data.refreshToken === "string" ? data.refreshToken : null,
    expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : 0,
    clientId: typeof data.clientId === "string" ? data.clientId : null,
    redirectUri: typeof data.redirectUri === "string" ? data.redirectUri : null,
    obtainedAt: typeof data.obtainedAt === "string" ? data.obtainedAt : null
  };
}
async function writeAuth(auth) {
  await writeJsonAtomic(authPath(), auth, 384);
}
async function clearAuth() {
  await writeJsonAtomic(authPath(), {}, 384);
}
async function readClient() {
  const data = await readJson(authPath());
  if (typeof data.clientId !== "string" || data.clientId === "") return null;
  return { clientId: data.clientId, redirectUri: typeof data.redirectUri === "string" ? data.redirectUri : null };
}
function cloudPath() {
  return (0, import_node_path.join)(dshHome(), CLOUD_FILENAME);
}
async function readCloud() {
  const data = await readJson(cloudPath());
  const apiKey = typeof data.apiKey === "string" ? data.apiKey.trim() : "";
  const clientId = typeof data.clientId === "string" ? data.clientId.trim() : "";
  if (apiKey === "" && clientId === "") return null;
  return {
    apiKey,
    clientId,
    grantId: typeof data.grantId === "string" ? data.grantId.trim() : "",
    savedAt: typeof data.savedAt === "string" ? data.savedAt : null
  };
}
async function writeCloud({ apiKey, clientId, grantId }) {
  const next = {
    apiKey: typeof apiKey === "string" ? apiKey.trim() : "",
    clientId: typeof clientId === "string" ? clientId.trim() : "",
    grantId: typeof grantId === "string" ? grantId.trim() : "",
    savedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (next.apiKey === "" && next.clientId === "") {
    await writeJsonAtomic(cloudPath(), {}, 384);
    return null;
  }
  await writeJsonAtomic(cloudPath(), next, 384);
  return next;
}
async function clearCloud() {
  await writeJsonAtomic(cloudPath(), {}, 384);
}
function maskSecret(value) {
  if (typeof value !== "string" || value === "") return "";
  if (value.length <= 16) return value.slice(0, 4) + "\u2026";
  return `${value.slice(0, 12)}\u2026${value.slice(-4)}`;
}
function syncStatePath() {
  return (0, import_node_path.join)(dshHome(), SYNC_FILENAME);
}
async function readSyncState() {
  const data = await readJson(syncStatePath());
  const notes = data && typeof data.notes === "object" && data.notes !== null ? data.notes : {};
  return {
    notes,
    lastRunAt: typeof data.lastRunAt === "string" ? data.lastRunAt : null,
    lastCursor: typeof data.lastCursor === "string" ? data.lastCursor : null
  };
}
async function writeSyncState(state) {
  await writeJsonAtomic(syncStatePath(), {
    notes: state && typeof state.notes === "object" ? state.notes : {},
    lastRunAt: state?.lastRunAt ?? null,
    lastCursor: state?.lastCursor ?? null
  });
}
var MAX_TEMPLATES = 12;
var TEMPLATE_NAME_MAX = 24;
var TEMPLATE_BODY_MAX = 4e3;
function normalizeTemplates(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of input) {
    if (out.length >= MAX_TEMPLATES) break;
    if (item === null || typeof item !== "object") continue;
    const name = typeof item.name === "string" ? item.name.trim().slice(0, TEMPLATE_NAME_MAX) : "";
    if (name === "") continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const body = typeof item.body === "string" ? item.body.slice(0, TEMPLATE_BODY_MAX) : "";
    out.push({ name, body });
  }
  return out;
}
function normalizeAutoSync(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  const minutes = Number(cfg.autoSyncMinutes);
  return {
    enabled: cfg.autoSync === true,
    intervalMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(Math.max(Math.round(minutes), 5), 720) : 15,
    incremental: cfg.autoSyncIncremental !== false,
    foregroundOnly: cfg.autoSyncForegroundOnly === true
  };
}

// src/main.js
init_vfs();

// src/core/card.js
var import_node_child_process = require("node:child_process");
init_vfs();
var import_node_path2 = require("node:path");
var scriptDir = process.cwd();
function configureCardScripts({ baseDir } = {}) {
  if (typeof baseDir === "string" && baseDir !== "") scriptDir = baseDir;
}
var BRIDGE = () => (0, import_node_path2.join)(scriptDir, "card", "getcard_bridge.py");
var WIFI = () => (0, import_node_path2.join)(scriptDir, "card", "wifi_transfer.py");
var PYTHON_CANDIDATES = ["python", "python3", "py"];
function pythonCandidates() {
  const override = typeof process.env.DSH_GETNOTE_PYTHON === "string" ? process.env.DSH_GETNOTE_PYTHON.trim() : "";
  return override === "" ? PYTHON_CANDIDATES : [override];
}
var DEFAULT_TIMEOUT_MS = 120 * 1e3;
var PULL_TIMEOUT_MS = 15 * 60 * 1e3;
function runBridge(args, { timeoutMs = DEFAULT_TIMEOUT_MS, python = null, script = null } = {}) {
  script = script || BRIDGE();
  const interpreters = python === null ? pythonCandidates() : [python];
  return new Promise((resolve5, reject) => {
    let settled = false;
    const finish = (fn2, value) => {
      if (settled) return;
      settled = true;
      fn2(value);
    };
    const attempt = (index) => {
      if (index >= interpreters.length) {
        finish(
          reject,
          Object.assign(
            new Error(
              "\u6CA1\u627E\u5230\u53EF\u7528\u7684 Python\u3002\u5F55\u97F3\u5361\u76F4\u8FDE\u9700\u8981 Python 3.10+ \u548C bleak \u5305\uFF08pip install bleak\uFF09\u3002"
            ),
            { status: 503, reason: "no-python" }
          )
        );
        return;
      }
      const bin = interpreters[index];
      const child = (0, import_node_child_process.spawn)(bin, [script, ...args], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONIOENCODING: "utf-8" }
      });
      let out = "";
      let err = "";
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        try {
          child.kill();
        } catch {
        }
      }, timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        out += chunk;
      });
      child.stderr.on("data", (chunk) => {
        err += chunk;
      });
      child.on("error", (error2) => {
        clearTimeout(timer);
        if (error2 && error2.code === "ENOENT") {
          attempt(index + 1);
          return;
        }
        finish(reject, Object.assign(error2, { status: 502 }));
      });
      child.on("close", () => {
        clearTimeout(timer);
        if (killed) {
          finish(
            reject,
            Object.assign(new Error("\u5F55\u97F3\u5361\u64CD\u4F5C\u8D85\u65F6\u4E86\uFF08\u5361\u7247\u53EF\u80FD\u4F11\u7720\u6216\u79BB\u5F97\u592A\u8FDC\uFF09"), {
              status: 504,
              reason: "timeout"
            })
          );
          return;
        }
        const text = out.trim();
        if (text === "") {
          finish(
            reject,
            Object.assign(new Error(`\u5F55\u97F3\u5361\u6865\u6CA1\u6709\u8F93\u51FA\u7ED3\u679C\u3002${err.trim().slice(0, 400)}`), {
              status: 502,
              reason: "no-output",
              stderr: err
            })
          );
          return;
        }
        let payload;
        try {
          const lines = text.split("\n").filter((line) => line.trim() !== "");
          payload = JSON.parse(lines[lines.length - 1]);
        } catch {
          finish(
            reject,
            Object.assign(new Error(`\u5F55\u97F3\u5361\u6865\u7684\u8F93\u51FA\u4E0D\u662F JSON\uFF1A${text.slice(0, 300)}`), {
              status: 502,
              reason: "bad-json"
            })
          );
          return;
        }
        if (payload && payload.ok === false) {
          finish(
            reject,
            Object.assign(new Error(payload.error || "\u5F55\u97F3\u5361\u64CD\u4F5C\u5931\u8D25"), {
              status: 502,
              reason: "bridge-error",
              bridge: payload
            })
          );
          return;
        }
        finish(resolve5, payload);
      });
    };
    attempt(0);
  });
}
async function checkCardEnvironment() {
  try {
    const info = await runBridge(["doctor"], { timeoutMs: 20 * 1e3 });
    return {
      ready: info.bleakReady === true,
      python: info.python || null,
      bleak: info.bleak || null,
      bridge: BRIDGE(),
      error: info.bleakReady === true ? null : info.bleakError || "\u7F3A\u5C11 bleak"
    };
  } catch (error2) {
    return {
      ready: false,
      python: null,
      bleak: null,
      bridge: BRIDGE(),
      error: error2 && error2.message ? error2.message : String(error2)
    };
  }
}
async function scanCard(timeoutSeconds = 8) {
  const payload = await runBridge(["scan", "--timeout", String(timeoutSeconds)], {
    timeoutMs: (timeoutSeconds + 20) * 1e3
  });
  return { cards: payload.cards || [], devices: payload.devices || [] };
}
async function cardInfo() {
  return runBridge(["info"]);
}
async function listCardFiles() {
  const payload = await runBridge(["list"]);
  return payload.files || [];
}
function dateOfCardFile(name) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(name || ""));
  return match === null ? null : `${match[1]}-${match[2]}-${match[3]}`;
}
function titleOfCardFile(name) {
  const base = String(name || "").replace(/\.[a-z0-9]+$/i, "");
  const match = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/.exec(base);
  if (match === null) return base || "\u5F55\u97F3\u5361\u5F55\u97F3";
  return `\u5F55\u97F3 ${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}
function posix(rel) {
  return String(rel).split("\\").join("/");
}
async function importedCardFiles(root) {
  const seen = /* @__PURE__ */ new Map();
  const walk = async (dir, depth) => {
    if (depth > 6) return;
    let items;
    try {
      items = await readdir2(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (item.name.startsWith(".")) continue;
      const abs = (0, import_node_path2.join)(dir, item.name);
      if (item.isDirectory()) {
        if (item.name === "asset") {
          let files;
          try {
            files = await readdir2(abs, { withFileTypes: true });
          } catch {
            continue;
          }
          for (const file of files) {
            if (!file.isFile()) continue;
            const match = /^(.+?\.ogg)_\d+\.ogg$/i.exec(file.name);
            const key = match === null ? file.name : match[1];
            if (!seen.has(key)) seen.set(key, (0, import_node_path2.join)(abs, file.name));
          }
          continue;
        }
        await walk(abs, depth + 1);
      }
    }
  };
  await walk(root, 0);
  return seen;
}
function emptySummary() {
  return { downloaded: 0, skipped: 0, failed: 0, items: [] };
}
async function importCardRecordings(root, options = {}) {
  const { all = true, names = "", deleteAfter = false, dir = "\u5F55\u97F3\u5361", log = () => {
  } } = options;
  const summary = emptySummary();
  const already = await importedCardFiles(root);
  const args = ["pull", "--out", (0, import_node_path2.join)(root, ".card-inbox")];
  if (all) args.push("--all");
  else if (names !== "") args.push("--names", names);
  if (deleteAfter) args.push("--delete-after");
  args.push("--force");
  log("\u6B63\u5728\u8FDE\u63A5\u5F55\u97F3\u5361\u2026");
  const payload = await runBridge(args, { timeoutMs: PULL_TIMEOUT_MS });
  const downloaded = payload.downloaded || [];
  const skipped = payload.skipped || [];
  for (const item of skipped) {
    summary.skipped += 1;
    summary.items.push({ name: item.name, status: "skipped", reason: item.reason });
  }
  const targetDir = dir === "" ? "" : dir;
  await mkdir2(targetDir === "" ? root : (0, import_node_path2.join)(root, targetDir), { recursive: true }).catch(() => {
  });
  for (const item of downloaded) {
    const sourceName = String(item.name || "");
    if (already.has(sourceName)) {
      summary.skipped += 1;
      summary.items.push({ name: sourceName, status: "skipped", reason: "already-imported" });
      continue;
    }
    try {
      const stamp = Date.now();
      const assetName = `${sourceName}_${stamp}.ogg`;
      const assetRel = posix(targetDir === "" ? `asset/${assetName}` : `${targetDir}/asset/${assetName}`);
      const assetAbs = (0, import_node_path2.join)(root, assetRel);
      await mkdir2((0, import_node_path2.dirname)(assetAbs), { recursive: true });
      const { rename: rename4 } = await import("node:fs/promises");
      await rename4(item.path, assetAbs);
      const title = titleOfCardFile(sourceName);
      const date = dateOfCardFile(sourceName);
      const minutes = Math.max(1, Math.round((item.duration || 0) / 60));
      const body = [
        `# ${title}`,
        "",
        `> \u6765\u81EA\u5F97\u5230\u5F55\u97F3\u5361\uFF08\u76F4\u8FDE\u5BFC\u5165\uFF0C\u672A\u7ECF\u4E91\u7AEF\uFF09\u3002\u65F6\u957F\u7EA6 ${minutes} \u5206\u949F\u3002`,
        "",
        `## \u97F3\u9891`,
        "",
        `[\u64AD\u653E\u672C\u5730\u5F55\u97F3](<${assetRel}>)`,
        "",
        `## \u9010\u5B57\u7A3F`,
        "",
        "> \u8FD9\u7BC7\u662F\u4ECE\u5F55\u97F3\u5361\u76F4\u63A5\u62C9\u4E0B\u6765\u7684\u539F\u59CB\u97F3\u9891\uFF0C\u8FD8\u6CA1\u6709\u8F6C\u5199\u3002",
        "> \u8F6C\u5199\u53EF\u4EE5\u5728\u8BBE\u7F6E\u91CC\u63A5\u4E0A\u672C\u5730\u6216\u4E91\u7AEF\u7684\u8BED\u97F3\u8BC6\u522B\uFF0C\u4E5F\u53EF\u4EE5\u5148\u628A\u97F3\u9891\u62D6\u8FDB\u4EFB\u610F\u8F6C\u5199\u5DE5\u5177\u3002",
        "",
        "---",
        "",
        `\uFF08\u6E90\u81EA\u5F97\u5230\u5F55\u97F3\u5361 \xB7 \u6587\u4EF6 ${sourceName} \xB7 \u5BFC\u5165\u4E8E ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}\uFF09`,
        ""
      ].join("\n");
      const { createNote: createNote2 } = await import("../vault.js");
      const created = await createNote2(root, {
        dir: targetDir,
        title,
        content: body,
        date: date || void 0,
        withDatePrefix: true
      });
      summary.downloaded += 1;
      summary.items.push({
        name: sourceName,
        status: "imported",
        path: created.path,
        asset: assetRel,
        bytes: item.bytes,
        duration: item.duration,
        deletedOnCard: item.deletedOnCard === true
      });
      log(`\u5DF2\u5BFC\u5165\uFF1A${created.path}`);
    } catch (error2) {
      summary.failed += 1;
      summary.items.push({
        name: sourceName,
        status: "failed",
        error: error2 && error2.message ? error2.message : String(error2)
      });
      log(`\u5BFC\u5165\u5931\u8D25\uFF1A${sourceName} \u2014 ${error2 && error2.message ? error2.message : error2}`);
    }
  }
  return summary;
}
async function deleteCardFiles(names) {
  const list = String(names || "").split(",").map((item) => item.trim()).filter((item) => item !== "");
  if (list.length === 0) {
    throw Object.assign(new Error("\u6CA1\u6709\u6307\u5B9A\u8981\u5220\u9664\u7684\u6587\u4EF6"), { status: 400 });
  }
  const payload = await runBridge(["pull", "--out", (0, import_node_path2.join)(process.cwd(), ".card-trash"), "--names", list.join(","), "--all", "--force", "--delete-after"]);
  return { deleted: (payload.downloaded || []).map((item) => item.name) };
}
async function cardPendingCount() {
  try {
    const files = await listCardFiles();
    return { count: files.length, files: files.map((f3) => ({ name: f3.name, time: f3.time, size: f3.size })) };
  } catch (error2) {
    return { count: 0, files: [], error: error2 && error2.message ? error2.message : String(error2) };
  }
}
async function wifiScan() {
  return runBridge(["scan"], { script: WIFI(), timeoutMs: 60 * 1e3 });
}
async function wifiActivate({ cmd = null, body = null, join: join8 = true, keep = false, wait = 3 } = {}) {
  const args = ["activate"];
  if (cmd) args.push("--cmd", String(cmd));
  if (body) args.push("--body", String(body));
  if (join8) args.push("--join");
  if (keep) args.push("--keep");
  if (wait) args.push("--wait", String(wait));
  return runBridge(args, { script: WIFI(), timeoutMs: 4 * 60 * 1e3 });
}
async function wifiJoin({ ssid, password = null, keep = false, timeout = 30 } = {}) {
  if (typeof ssid !== "string" || ssid.trim() === "") {
    throw Object.assign(new Error("\u8981\u8FDE\u54EA\u4E2A\u70ED\u70B9\uFF1Fssid \u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
  }
  const args = ["join", "--ssid", ssid, "--timeout", String(timeout)];
  if (password) args.push("--password", password);
  if (keep) args.push("--keep");
  return runBridge(args, { script: WIFI(), timeoutMs: 3 * 60 * 1e3 });
}
async function wifiLeave() {
  return runBridge(["leave"], { script: WIFI(), timeoutMs: 60 * 1e3 });
}

// src/core/log.js
var debugEnabled = false;
function setDebugLogging(enabled) {
  debugEnabled = enabled === true;
}
function emit(level, args) {
  const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  const fn2 = typeof console !== "undefined" ? console[method] : null;
  if (typeof fn2 !== "function") return;
  try {
    fn2.apply(console, ["[\u5F97\u5230\u5927\u8111]", ...args]);
  } catch {
  }
}
function error(...args) {
  emit("error", args);
}

// src/main.js
init_vault();

// src/core/integrations.js
function basesTemplate({ subfolder = "\u5F97\u5230\u5927\u8111" } = {}) {
  const dir = String(subfolder || "\u5F97\u5230\u5927\u8111").replace(/^\/+|\/+$/g, "") || "\u5F97\u5230\u5927\u8111";
  return [
    "filters:",
    "  and:",
    `    - file.inFolder("${dir}")`,
    "views:",
    "  - type: table",
    "    name: \u5168\u90E8",
    "    order:",
    "      - file.name",
    "      - note.date",
    "      - note.tags",
    "  - type: table",
    "    name: \u6309\u6807\u7B7E",
    "    groupBy:",
    "      property: note.tags",
    "      direction: ASC",
    "    order:",
    "      - file.name",
    "      - note.date",
    "  - type: table",
    "    name: \u6309\u65E5\u671F",
    "    sort:",
    "      - property: note.date",
    "        direction: DESC",
    "    order:",
    "      - file.name",
    "      - note.date",
    ""
  ].join("\n");
}
function emptyCanvas() {
  return { nodes: [], edges: [] };
}
function randomId() {
  const bytes = new Uint8Array(8);
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") cryptoObj.getRandomValues(bytes);
  else for (let i3 = 0; i3 < bytes.length; i3 += 1) bytes[i3] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b3) => b3.toString(16).padStart(2, "0")).join("");
}
function addFileNode(canvas, { file, x: x4 = 0, y: y3 = 0, width = 400, height = 400 } = {}) {
  const source = canvas && typeof canvas === "object" ? canvas : emptyCanvas();
  const nodes = Array.isArray(source.nodes) ? source.nodes.slice() : [];
  const edges = Array.isArray(source.edges) ? source.edges.slice() : [];
  const path = String(file || "").replace(/^\/+/, "");
  if (path === "") throw Object.assign(new Error("\u753B\u5E03\u8282\u70B9\u9700\u8981\u4E00\u4E2A\u6587\u4EF6\u8DEF\u5F84"), { status: 400 });
  const existing = nodes.find((node) => node && node.type === "file" && node.file === path);
  if (existing) return { canvas: { nodes, edges }, added: false, id: existing.id };
  const id = randomId();
  nodes.push({ id, type: "file", file: path, x: x4, y: y3, width, height });
  return { canvas: { nodes, edges }, added: true, id };
}
function parseCanvas(text) {
  try {
    const parsed = JSON.parse(String(text || ""));
    if (!parsed || typeof parsed !== "object") return emptyCanvas();
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : []
    };
  } catch {
    return emptyCanvas();
  }
}
function serializeCanvas(canvas) {
  const source = canvas && typeof canvas === "object" ? canvas : emptyCanvas();
  return JSON.stringify({
    nodes: Array.isArray(source.nodes) ? source.nodes : [],
    edges: Array.isArray(source.edges) ? source.edges : []
  }, null, "	");
}

// src/core/service.js
init_vfs();
var import_node_path6 = require("node:path");
init_vault();
init_history();

// src/core/archive.js
init_vfs();
var import_node_path5 = require("node:path");
var import_node_zlib = require("node:zlib");
var import_node_buffer = require("node:buffer");
init_vault();
var SIG_LOCAL = 67324752;
var SIG_CENTRAL = 33639248;
var SIG_EOCD = 101010256;
var FLAG_UTF8 = 2048;
var METHOD_STORE = 0;
var METHOD_DEFLATE = 8;
var ZIP64_MARK = 4294967295;
var MAX_ENTRIES = 65535;
var EOCD_MAX_SCAN = 65557;
var CRC_TABLE_SIZE = 256;
var IGNORED_DIRS2 = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  ".obsidian",
  ".trash",
  ".conflicts",
  ".history",
  ".dsh",
  "$RECYCLE.BIN",
  "__MACOSX",
  ".venv"
]);
var ALLOWED_ASSET_EXT = /* @__PURE__ */ new Set([
  "mp3",
  "ogg",
  "m4a",
  "wav",
  "aac",
  "flac",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "svg",
  "bmp",
  "pdf",
  "txt",
  "json"
]);
var MB = 1024 * 1024;
var INDEX_NOTE_MAX = 2 * MB;
var MAX_INDEX_DEPTH = 12;
function fail(status, message) {
  return Object.assign(new Error(message), { status });
}
function formatBytes(n2) {
  if (n2 >= MB) {
    const mb = Math.round(n2 / MB * 10) / 10;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`;
  }
  if (n2 >= 1024) return `${Math.round(n2 / 1024 * 10) / 10}KB`;
  return `${n2} \u5B57\u8282`;
}
var crcTableCache = null;
function crcTable() {
  if (crcTableCache) return crcTableCache;
  const table = new Uint32Array(CRC_TABLE_SIZE);
  for (let i3 = 0; i3 < CRC_TABLE_SIZE; i3 += 1) {
    let c3 = i3;
    for (let k4 = 0; k4 < 8; k4 += 1) c3 = c3 & 1 ? 3988292384 ^ c3 >>> 1 : c3 >>> 1;
    table[i3] = c3 >>> 0;
  }
  crcTableCache = table;
  return crcTableCache;
}
function crc32(buf) {
  const table = crcTable();
  let c3 = 4294967295;
  for (let i3 = 0; i3 < buf.length; i3 += 1) c3 = table[(c3 ^ buf[i3]) & 255] ^ c3 >>> 8;
  return (c3 ^ 4294967295) >>> 0;
}
function dosDateTime(when) {
  const d3 = when instanceof Date && !Number.isNaN(when.getTime()) ? when : /* @__PURE__ */ new Date();
  const year = d3.getFullYear();
  const y3 = Math.max(0, Math.min(127, year - 1980));
  return {
    time: d3.getHours() << 11 | d3.getMinutes() << 5 | Math.floor(d3.getSeconds() / 2) & 31,
    date: y3 << 9 | d3.getMonth() + 1 << 5 | d3.getDate()
  };
}
function assertFits32(value, what) {
  if (value > ZIP64_MARK) {
    throw fail(413, `${what} \u8D85\u8FC7 4GB\uFF0C\u6682\u4E0D\u652F\u6301 zip64\uFF0C\u8BF7\u5206\u6279\u5BFC\u51FA`);
  }
}
function packEntry(file) {
  const data = import_node_buffer.Buffer.isBuffer(file?.data) ? file.data : file.data instanceof Uint8Array ? import_node_buffer.Buffer.from(file.data) : import_node_buffer.Buffer.from(String(file?.data ?? ""), "utf8");
  const forced = file?.method;
  if (forced === METHOD_STORE || forced === "store") {
    return { data, crc: crc32(data), method: METHOD_STORE, body: data };
  }
  if (forced === METHOD_DEFLATE || forced === "deflate") {
    return {
      data,
      crc: crc32(data),
      method: METHOD_DEFLATE,
      body: data.length === 0 ? data : (0, import_node_zlib.deflateRawSync)(data, { level: 6 })
    };
  }
  const deflated = data.length === 0 ? data : (0, import_node_zlib.deflateRawSync)(data, { level: 6 });
  return deflated.length < data.length ? { data, crc: crc32(data), method: METHOD_DEFLATE, body: deflated } : { data, crc: crc32(data), method: METHOD_STORE, body: data };
}
function encodeZip(files) {
  if (!Array.isArray(files)) throw fail(400, "files \u5FC5\u987B\u662F\u6570\u7EC4");
  if (files.length > MAX_ENTRIES) {
    throw fail(413, `\u6761\u76EE\u8D85\u8FC7 ${MAX_ENTRIES} \u4E2A\uFF0C\u6682\u4E0D\u652F\u6301 zip64\uFF0C\u8BF7\u5206\u6279\u5BFC\u51FA`);
  }
  const chunks = [];
  const records = [];
  let offset = 0;
  for (const file of files) {
    const name = String(file?.path ?? file?.name ?? "").replace(/\\/g, "/");
    if (name === "") throw fail(400, "zip \u6761\u76EE\u7F3A\u5C11\u6587\u4EF6\u540D");
    const nameBuf = import_node_buffer.Buffer.from(name, "utf8");
    if (nameBuf.length > 65535) throw fail(400, `\u6587\u4EF6\u540D\u8FC7\u957F\uFF1A${name}`);
    const { data, crc, method, body } = packEntry(file);
    const { time, date } = dosDateTime(file.mtime);
    assertFits32(offset, "\u5F52\u6863\u504F\u79FB");
    assertFits32(body.length, "\u538B\u7F29\u540E\u5927\u5C0F");
    const local = import_node_buffer.Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, body);
    records.push({
      name,
      nameBuf,
      method,
      crc,
      time,
      date,
      compressedSize: body.length,
      uncompressedSize: data.length,
      localOffset: offset
    });
    offset += 30 + nameBuf.length + body.length;
  }
  const centralChunks = [];
  let cdSize = 0;
  for (const rec of records) {
    const cd = import_node_buffer.Buffer.alloc(46);
    cd.writeUInt32LE(SIG_CENTRAL, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(FLAG_UTF8, 8);
    cd.writeUInt16LE(rec.method, 10);
    cd.writeUInt16LE(rec.time, 12);
    cd.writeUInt16LE(rec.date, 14);
    cd.writeUInt32LE(rec.crc, 16);
    cd.writeUInt32LE(rec.compressedSize, 20);
    cd.writeUInt32LE(rec.uncompressedSize, 24);
    cd.writeUInt16LE(rec.nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(rec.localOffset, 42);
    centralChunks.push(cd, rec.nameBuf);
    cdSize += 46 + rec.nameBuf.length;
  }
  assertFits32(offset, "\u4E2D\u592E\u76EE\u5F55\u504F\u79FB");
  assertFits32(cdSize, "\u4E2D\u592E\u76EE\u5F55\u5927\u5C0F");
  const eocd = import_node_buffer.Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(records.length, 8);
  eocd.writeUInt16LE(records.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return {
    buffer: import_node_buffer.Buffer.concat([...chunks, ...centralChunks, eocd]),
    entries: records.map((r3) => ({
      path: r3.name,
      bytes: r3.uncompressedSize,
      compressedBytes: r3.compressedSize,
      method: r3.method,
      crc: r3.crc
    }))
  };
}
function findEocd(buffer) {
  const min = Math.max(0, buffer.length - EOCD_MAX_SCAN);
  for (let i3 = buffer.length - 22; i3 >= min; i3 -= 1) {
    if (buffer.readUInt32LE(i3) !== SIG_EOCD) continue;
    const commentLen = buffer.readUInt16LE(i3 + 20);
    if (i3 + 22 + commentLen === buffer.length) return i3;
  }
  return -1;
}
function readZipIndex(buffer) {
  if (!import_node_buffer.Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw fail(400, "\u5F52\u6863\u635F\u574F\uFF1A\u4E0D\u662F\u6709\u6548\u7684 zip \u6587\u4EF6");
  }
  const eocd = findEocd(buffer);
  if (eocd < 0) throw fail(400, "\u5F52\u6863\u635F\u574F\uFF1A\u627E\u4E0D\u5230 zip \u76EE\u5F55\u5C3E");
  const total = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (total === 65535 || cdSize === ZIP64_MARK || cdOffset === ZIP64_MARK) {
    throw fail(400, "\u6682\u4E0D\u652F\u6301 zip64 \u5F52\u6863\uFF08\u8D85\u8FC7 4GB\uFF09");
  }
  if (cdOffset + cdSize > buffer.length) throw fail(400, "\u5F52\u6863\u635F\u574F\uFF1A\u4E2D\u592E\u76EE\u5F55\u8D8A\u754C");
  const out = [];
  let pos = cdOffset;
  for (let i3 = 0; i3 < total; i3 += 1) {
    if (pos + 46 > buffer.length) throw fail(400, "\u5F52\u6863\u635F\u574F\uFF1A\u4E2D\u592E\u76EE\u5F55\u88AB\u622A\u65AD");
    if (buffer.readUInt32LE(pos) !== SIG_CENTRAL) throw fail(400, "\u5F52\u6863\u635F\u574F\uFF1A\u4E2D\u592E\u76EE\u5F55\u7B7E\u540D\u4E0D\u5BF9");
    const method = buffer.readUInt16LE(pos + 10);
    const crc = buffer.readUInt32LE(pos + 16);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const uncompressedSize = buffer.readUInt32LE(pos + 24);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    if (pos + 46 + nameLen + extraLen + commentLen > buffer.length) {
      throw fail(400, "\u5F52\u6863\u635F\u574F\uFF1A\u4E2D\u592E\u76EE\u5F55\u6761\u76EE\u8D8A\u754C");
    }
    const name = buffer.toString("utf8", pos + 46, pos + 46 + nameLen);
    out.push({ name, method, crc, compressedSize, uncompressedSize, localOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
function readEntryData(buffer, entry, maxBytes) {
  const base = entry.localOffset;
  if (base + 30 > buffer.length) throw fail(400, `\u5F52\u6863\u635F\u574F\uFF1A${entry.name} \u672C\u5730\u5934\u8D8A\u754C`);
  if (buffer.readUInt32LE(base) !== SIG_LOCAL) {
    throw fail(400, `\u5F52\u6863\u635F\u574F\uFF1A${entry.name} \u672C\u5730\u5934\u7B7E\u540D\u4E0D\u5BF9`);
  }
  const nameLen = buffer.readUInt16LE(base + 26);
  const extraLen = buffer.readUInt16LE(base + 28);
  const start = base + 30 + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (end > buffer.length) throw fail(400, `\u5F52\u6863\u635F\u574F\uFF1A${entry.name} \u6570\u636E\u88AB\u622A\u65AD`);
  const raw = buffer.subarray(start, end);
  let data;
  if (entry.method === METHOD_STORE) {
    data = import_node_buffer.Buffer.from(raw);
  } else if (entry.method === METHOD_DEFLATE) {
    try {
      data = (0, import_node_zlib.inflateRawSync)(raw);
    } catch {
      throw fail(400, `\u5F52\u6863\u635F\u574F\uFF1A${entry.name} \u89E3\u538B\u5931\u8D25`);
    }
  } else {
    throw fail(400, `\u6682\u4E0D\u652F\u6301\u538B\u7F29\u65B9\u5F0F ${entry.method}\uFF1A${entry.name}`);
  }
  if (data.length > maxBytes) throw fail(413, `\u5F52\u6863\u5185\u6587\u4EF6\u8FC7\u5927\uFF1A${entry.name}`);
  if (crc32(data) !== entry.crc) throw fail(400, `\u5F52\u6863\u635F\u574F\uFF1A${entry.name} \u6821\u9A8C\u5931\u8D25`);
  return data;
}
function safeEntryRel(name) {
  let raw = String(name ?? "");
  if (raw === "" || raw.includes("\0")) return null;
  raw = raw.replace(/\\/g, "/");
  if (raw.startsWith("/")) return null;
  if (/^[A-Za-z]:/.test(raw)) return null;
  const parts = raw.split("/").filter((p3) => p3 !== "" && p3 !== ".");
  if (parts.length === 0) return null;
  if (parts.some((p3) => p3 === "..")) return null;
  return parts.join("/");
}
function isAllowedEntry(rel) {
  const lower = rel.toLowerCase();
  if (lower.endsWith(".md")) return true;
  if (!/(^|\/)asset\//.test(lower)) return false;
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return ALLOWED_ASSET_EXT.has(lower.slice(dot + 1));
}
function absInside(absRoot, rel) {
  const abs = (0, import_node_path5.resolve)(absRoot, rel.split("/").join(import_node_path5.sep));
  const back = (0, import_node_path5.relative)(absRoot, abs);
  if (back === "" || back.startsWith("..") || (0, import_node_path5.isAbsolute)(back)) return null;
  return abs;
}
async function existsAt(abs) {
  try {
    await lstat2(abs);
    return true;
  } catch {
    return false;
  }
}
async function writeNoClobber(abs, data) {
  try {
    await writeFile2(abs, data, { flag: "wx" });
    return true;
  } catch (err) {
    if (err?.code === "EEXIST") return false;
    if (err?.code === "EISDIR" || err?.code === "ENOTDIR") return false;
    throw err;
  }
}
function renameCandidates(rel) {
  const slash = rel.lastIndexOf("/");
  const dir = slash === -1 ? "" : rel.slice(0, slash);
  const base = slash === -1 ? rel : rel.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  const out = [];
  for (let i3 = 2; i3 <= 99; i3 += 1) out.push(dir === "" ? `${stem}-${i3}${ext}` : `${dir}/${stem}-${i3}${ext}`);
  return out;
}
async function indexNoteIds(absRoot) {
  const ids = /* @__PURE__ */ new Set();
  const walk = async (dirAbs, depth) => {
    if (depth > MAX_INDEX_DEPTH) return;
    let items;
    try {
      items = await readdir2(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (item.isDirectory()) {
        if (IGNORED_DIRS2.has(item.name)) continue;
        await walk((0, import_node_path5.join)(dirAbs, item.name), depth + 1);
        continue;
      }
      if (!item.isFile() || !item.name.toLowerCase().endsWith(".md")) continue;
      const abs = (0, import_node_path5.join)(dirAbs, item.name);
      try {
        const st = await lstat2(abs);
        if (!st.isFile() || st.size > INDEX_NOTE_MAX) continue;
        const text = await readFile2(abs, "utf8");
        const id = String(parseFrontmatter(text).data?.note_id ?? "").trim();
        if (id !== "") ids.add(id);
      } catch {
      }
    }
  };
  await walk(absRoot, 0);
  return ids;
}
async function exportVaultToZip(root, options = {}) {
  const scope = options.scope === "notes" || options.scope === "assets" ? options.scope : "all";
  const onlyDir = typeof options.dir === "string" ? options.dir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") : "";
  const maxBytes = options.maxBytes ?? 512 * MB;
  const maxFileBytes = options.maxFileBytes ?? 64 * MB;
  const maxTotalBytes = options.maxTotalBytes ?? 512 * MB;
  const fileLimit = Math.min(maxBytes, maxFileBytes);
  const absRoot = (0, import_node_path5.resolve)(root);
  const found = [];
  const walk = async (dirAbs, relDir) => {
    let items;
    try {
      items = await readdir2(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    items.sort((a3, b3) => a3.name.localeCompare(b3.name, "en"));
    for (const item of items) {
      const rel = relDir === "" ? item.name : `${relDir}/${item.name}`;
      if (onlyDir !== "" && !(rel === onlyDir || rel.startsWith(onlyDir + "/"))) continue;
      if (item.isDirectory()) {
        if (IGNORED_DIRS2.has(item.name)) continue;
        await walk((0, import_node_path5.join)(dirAbs, item.name), rel);
        continue;
      }
      if (!item.isFile()) continue;
      if (item.name.endsWith(".bak")) continue;
      if (scope === "notes" && !item.name.endsWith(".md")) continue;
      if (scope === "assets" && item.name.endsWith(".md")) continue;
      let st;
      try {
        st = await lstat2((0, import_node_path5.join)(dirAbs, item.name));
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      if (st.size > fileLimit) continue;
      found.push({ rel, abs: (0, import_node_path5.join)(dirAbs, item.name), size: st.size, mtime: st.mtime });
    }
  };
  await walk(absRoot, "");
  const totalSize = found.reduce((sum, f3) => sum + f3.size, 0);
  if (totalSize > maxTotalBytes) {
    throw fail(413, `\u5F52\u6863\u8D85\u8FC7 ${formatBytes(maxTotalBytes)}\uFF0C\u8BF7\u5206\u6279\u5BFC\u51FA`);
  }
  const files = [];
  for (const f3 of found) {
    let data;
    try {
      data = await readFile2(f3.abs);
    } catch {
      continue;
    }
    files.push({ path: f3.rel, data, mtime: f3.mtime });
  }
  const { buffer, entries } = encodeZip(files);
  return {
    buffer,
    entries,
    bytes: buffer.length,
    sourceBytes: files.reduce((sum, f3) => sum + f3.data.length, 0)
  };
}
async function importZipToVault(root, buffer, options = {}) {
  const mode = options.mode === "skip" ? "skip" : "rename";
  const maxFileBytes = options.maxFileBytes ?? 64 * MB;
  const zip = import_node_buffer.Buffer.isBuffer(buffer) ? buffer : buffer instanceof Uint8Array ? import_node_buffer.Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength) : null;
  if (zip === null) throw fail(400, "\u5F52\u6863\u5185\u5BB9\u5FC5\u987B\u662F\u4E8C\u8FDB\u5236 Buffer");
  const absRoot = (0, import_node_path5.resolve)(root);
  const index = readZipIndex(zip);
  await mkdir2(absRoot, { recursive: true });
  const knownIds = await indexNoteIds(absRoot);
  const used = /* @__PURE__ */ new Set();
  const entries = [];
  const warnings = [];
  let written = 0;
  let skipped = 0;
  let conflicts = 0;
  for (const item of index) {
    const declaredBytes = item.uncompressedSize;
    const rel = safeEntryRel(item.name);
    if (rel === null) {
      skipped += 1;
      warnings.push(`\u8DF3\u8FC7\u4E0D\u5B89\u5168\u7684\u5F52\u6863\u8DEF\u5F84\uFF1A${item.name}`);
      entries.push({ path: item.name, bytes: declaredBytes, action: "skipped" });
      continue;
    }
    if (!isAllowedEntry(rel)) {
      skipped += 1;
      entries.push({ path: rel, bytes: declaredBytes, action: "skipped" });
      continue;
    }
    if (declaredBytes > maxFileBytes) {
      skipped += 1;
      warnings.push(`\u8DF3\u8FC7\u5927\u6587\u4EF6\uFF1A${rel}\uFF08${declaredBytes} \u5B57\u8282\uFF09`);
      entries.push({ path: rel, bytes: declaredBytes, action: "skipped" });
      continue;
    }
    const data = readEntryData(zip, item, maxFileBytes);
    const absTarget = absInside(absRoot, rel);
    if (absTarget === null) {
      skipped += 1;
      warnings.push(`\u8DF3\u8FC7\u4E0D\u5B89\u5168\u7684\u5F52\u6863\u8DEF\u5F84\uFF1A${item.name}`);
      entries.push({ path: rel, bytes: data.length, action: "skipped" });
      continue;
    }
    let noteId = "";
    if (rel.toLowerCase().endsWith(".md")) {
      noteId = String(parseFrontmatter(data.toString("utf8")).data?.note_id ?? "").trim();
    }
    const pathTaken = used.has(rel) || await existsAt(absTarget);
    const conflict = pathTaken || noteId !== "" && knownIds.has(noteId);
    if (conflict) conflicts += 1;
    if (conflict && mode === "skip") {
      skipped += 1;
      entries.push({ path: rel, bytes: data.length, action: "skipped" });
      continue;
    }
    const candidates = conflict ? renameCandidates(rel) : [rel];
    let finalRel = null;
    let action = null;
    for (const cand of candidates) {
      if (used.has(cand)) continue;
      const abs = absInside(absRoot, cand);
      if (abs === null) continue;
      try {
        await mkdir2((0, import_node_path5.dirname)(abs), { recursive: true });
      } catch {
        continue;
      }
      if (await writeNoClobber(abs, data)) {
        finalRel = cand;
        action = cand === rel ? "written" : "renamed";
        break;
      }
    }
    if (finalRel === null) {
      skipped += 1;
      entries.push({ path: rel, bytes: data.length, action: "skipped" });
      continue;
    }
    used.add(finalRel);
    if (noteId !== "") knownIds.add(noteId);
    written += 1;
    entries.push({ path: finalRel, bytes: data.length, action });
  }
  return { written, skipped, conflicts, entries, warnings };
}

// src/core/service.js
init_biji();

// src/core/sync.js
init_vfs();
init_vault();
var NOTE_PAGE_SIZE = 50;
var TOOL_DELAY_MS = 350;
var MAX_NOTES_PER_RUN = 5e3;
var MAX_TOPICS = 200;
var sleep = (ms) => new Promise((done) => setTimeout(done, ms));
function pad(n2) {
  return String(n2).padStart(2, "0");
}
function todayString() {
  const now = /* @__PURE__ */ new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
function dateOf(value) {
  if (value === null || value === void 0 || value === "") return null;
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1e3;
    const d4 = new Date(ms);
    if (Number.isNaN(d4.getTime())) return null;
    return `${d4.getFullYear()}-${pad(d4.getMonth() + 1)}-${pad(d4.getDate())}`;
  }
  const s3 = String(value).trim();
  const m3 = /^(\d{4})-(\d{2})-(\d{2})/.exec(s3);
  if (m3) return `${m3[1]}-${m3[2]}-${m3[3]}`;
  const d3 = new Date(s3);
  if (Number.isNaN(d3.getTime())) return null;
  return `${d3.getFullYear()}-${pad(d3.getMonth() + 1)}-${pad(d3.getDate())}`;
}
function titleOf(note) {
  const candidates = [note.title, note.name, note.subject, note.headline, note.summary_title];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim();
  }
  const body = typeof note.content === "string" ? note.content : "";
  const m3 = /^#{1,3}\s+(.+)$/m.exec(body);
  if (m3) return m3[1].trim();
  const firstLine = body.split(/\r?\n/).find((line) => line.trim() !== "");
  if (firstLine) return firstLine.trim().slice(0, 60);
  return "\u672A\u547D\u540D\u7B14\u8BB0";
}
function dateOfNote(note) {
  return dateOf(note.created_at) || dateOf(note.createdAt) || dateOf(note.create_time) || dateOf(note.created_time) || dateOf(note.created) || dateOf(note.edit_time) || dateOf(note.updated_at);
}
function urlOfNote(note) {
  if (typeof note.url === "string" && note.url !== "") return note.url;
  if (typeof note.note_url === "string" && note.note_url !== "") return note.note_url;
  const id = note.note_id || note.id;
  return id ? `https://www.biji.com/note/${id}` : null;
}
function idOfNote(note) {
  const id = note.note_id ?? note.id ?? note.noteId;
  return id === null || id === void 0 ? null : String(id);
}
function tagsOfNote(note) {
  const raw = note.tags ?? note.tag_list ?? note.tagList;
  if (Array.isArray(raw)) {
    return raw.map((tag) => typeof tag === "string" ? tag : tag && (tag.name || tag.title || tag.tag_name)).filter((tag) => typeof tag === "string" && tag.trim() !== "").map((tag) => tag.trim());
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    return raw.split(/[,，]/).map((t4) => t4.trim()).filter(Boolean);
  }
  return [];
}
function renderNoteMarkdown(note, { topicName, archiveDate }) {
  const title = titleOf(note);
  const noteId = idOfNote(note);
  const url = urlOfNote(note);
  const date = dateOfNote(note);
  const tags = tagsOfNote(note);
  const allTags = [.../* @__PURE__ */ new Set([...tags, "\u5F97\u5230\u5927\u8111"])];
  const refContent = typeof note.ref_content === "string" ? note.ref_content.trim() : "";
  const ownContent = typeof note.content === "string" ? note.content.trim() : "";
  const bodyParts = [];
  if (refContent !== "") bodyParts.push(refContent);
  if (ownContent !== "" && ownContent !== refContent) {
    if (bodyParts.length > 0) bodyParts.push("\n---\n");
    bodyParts.push(ownContent);
  }
  if (bodyParts.length === 0) bodyParts.push("_\uFF08\u8FD9\u6761\u7B14\u8BB0\u6CA1\u6709\u6B63\u6587\uFF09_");
  const head = [
    "---",
    `tags: [${allTags.join(", ")}]`,
    noteId ? `note_id: "${noteId}"` : null,
    url ? `note_url: ${url}` : null,
    topicName ? `\u77E5\u8BC6\u5E93: ${topicName}` : null,
    date ? `\u521B\u5EFA: ${date}` : null,
    `\u5F52\u6863: ${archiveDate}`,
    "---",
    "",
    `# ${title}`,
    ""
  ].filter((line) => line !== null);
  const footer = ["", "---", "", url ? `\uFF08\u6E90\u81EA\u5F97\u5230\u5927\u8111 \xB7 [\u539F\u7B14\u8BB0](${url}) \xB7 \u5F52\u6863\u4E8E ${archiveDate}\uFF09` : `\uFF08\u6E90\u81EA\u5F97\u5230\u5927\u8111 \xB7 \u5F52\u6863\u4E8E ${archiveDate}\uFF09`, ""];
  return [...head, ...bodyParts, ...footer].join("\n");
}
async function existingNoteIds(root) {
  const ids = /* @__PURE__ */ new Set();
  const byTitle = /* @__PURE__ */ new Set();
  const { entries } = await scanVault(root);
  for (const entry of entries) {
    if (entry.noteId) ids.add(String(entry.noteId));
    byTitle.add(`${entry.name}`);
  }
  return { ids, byTitle };
}
async function listTopics(client, log) {
  const topics = [];
  let page = 1;
  for (; ; ) {
    let result;
    try {
      result = await client.callTool("list_topics", { page, page_size: 50 });
    } catch (error2) {
      log(`\u8BFB\u53D6\u77E5\u8BC6\u5E93\u5217\u8868\u5931\u8D25\uFF08\u7EE7\u7EED\u6309\u5168\u90E8\u7B14\u8BB0\u5BFC\u5165\uFF09\uFF1A${error2.message}`);
      break;
    }
    const items = Array.isArray(result) ? result : result && Array.isArray(result.topics) ? result.topics : result && Array.isArray(result.list) ? result.list : [];
    for (const item of items) {
      const id = item.topic_id || item.id;
      if (!id) continue;
      topics.push({ id: String(id), name: String(item.name || item.title || id) });
    }
    const hasMore = result && (result.has_more === true || result.next_page !== void 0 || result.hasMore === true);
    if (!hasMore || items.length === 0 || topics.length >= MAX_TOPICS) break;
    page = result && (result.next_page || result.nextPage) || page + 1;
    await sleep(TOOL_DELAY_MS);
  }
  return topics;
}
async function fetchAllNotes(client, topics, log) {
  const notes = [];
  const seen = /* @__PURE__ */ new Set();
  const absorb = (items, topic) => {
    for (const item of items) {
      const id = idOfNote(item);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      notes.push({ note: item, topicName: topic ? topic.name : null });
    }
  };
  let page = 1;
  let routeA = true;
  while (routeA && notes.length < MAX_NOTES_PER_RUN) {
    let result;
    try {
      result = await client.callTool("list_notes", { page, page_size: NOTE_PAGE_SIZE });
    } catch (error2) {
      log(`\u5168\u5C40\u5217\u8868\u4E0D\u53EF\u7528\uFF0C\u6539\u4E3A\u9010\u77E5\u8BC6\u5E93\u8BFB\u53D6\uFF1A${error2.message}`);
      routeA = false;
      break;
    }
    const items = Array.isArray(result) ? result : result && Array.isArray(result.notes) ? result.notes : result && Array.isArray(result.list) ? result.list : [];
    absorb(items, null);
    log(`\u5DF2\u8BFB\u53D6 ${notes.length} \u6761\u2026`);
    const hasMore = result && (result.has_more === true || result.hasMore === true);
    if (!hasMore || items.length === 0) break;
    page = result && (result.next_page || result.nextPage) || page + 1;
    await sleep(TOOL_DELAY_MS);
  }
  const needTopicPass = notes.length === 0 || notes.some((item) => !item.topicName);
  if (needTopicPass && topics.length > 0) {
    for (const topic of topics) {
      if (notes.length >= MAX_NOTES_PER_RUN) break;
      let pageNo = 1;
      for (; ; ) {
        let result;
        try {
          result = await client.callTool("list_topic_notes", { topic_id: topic.id, page: pageNo, page_size: NOTE_PAGE_SIZE });
        } catch (error2) {
          log(`\u77E5\u8BC6\u5E93\u300C${topic.name}\u300D\u8BFB\u53D6\u5931\u8D25\uFF1A${error2.message}`);
          break;
        }
        const items = Array.isArray(result) ? result : result && Array.isArray(result.notes) ? result.notes : result && Array.isArray(result.list) ? result.list : [];
        for (const item of items) {
          const id = idOfNote(item);
          if (!id) continue;
          const existing = notes.find((slot) => idOfNote(slot.note) === id);
          if (existing) {
            if (!existing.topicName) existing.topicName = topic.name;
          } else if (!seen.has(id)) {
            seen.add(id);
            notes.push({ note: item, topicName: topic.name });
          }
        }
        log(`\u300C${topic.name}\u300D\u5DF2\u8BFB\u53D6 ${items.length} \u6761\uFF08\u7D2F\u8BA1 ${notes.length}\uFF09`);
        const hasMore = result && (result.has_more === true || result.hasMore === true);
        if (!hasMore || items.length === 0) break;
        pageNo = result && (result.next_page || result.nextPage) || pageNo + 1;
        await sleep(TOOL_DELAY_MS);
      }
    }
  }
  return notes;
}
async function enrichNote(client, note) {
  const hasBody = typeof note.content === "string" && note.content.trim() !== "";
  const hasRef = typeof note.ref_content === "string" && note.ref_content.trim() !== "";
  if (hasBody || hasRef) return note;
  const id = idOfNote(note);
  if (!id) return note;
  try {
    const detail = await client.callTool("get_note", { id });
    const payload = detail && detail.note ? detail.note : detail;
    if (payload && typeof payload === "object") return { ...note, ...payload };
  } catch {
  }
  return note;
}
async function importAllNotes(client, root, { log = () => {
}, maxNotes = MAX_NOTES_PER_RUN } = {}) {
  const startedAt = Date.now();
  const archiveDate = todayString();
  log("\u6B63\u5728\u8BFB\u53D6\u77E5\u8BC6\u5E93\u5217\u8868\u2026");
  const topics = await listTopics(client, log);
  log(topics.length > 0 ? `\u53D1\u73B0 ${topics.length} \u4E2A\u77E5\u8BC6\u5E93` : "\u672A\u8BFB\u5230\u77E5\u8BC6\u5E93\u5217\u8868\uFF0C\u6309\u5168\u90E8\u7B14\u8BB0\u5BFC\u5165");
  const notes = await fetchAllNotes(client, topics, log);
  log(`\u4E91\u7AEF\u5171 ${notes.length} \u6761\u7B14\u8BB0\uFF0C\u5F00\u59CB\u5199\u5165\u672C\u5730\u5E93\u2026`);
  const { ids } = await existingNoteIds(root);
  const stats = { total: notes.length, created: 0, skipped: 0, failed: 0, notes: [] };
  let processed = 0;
  for (const item of notes) {
    if (processed >= maxNotes) {
      stats.truncated = true;
      break;
    }
    processed += 1;
    const note = item.note;
    const id = idOfNote(note);
    if (id && ids.has(id)) {
      stats.skipped += 1;
      continue;
    }
    try {
      const full = await enrichNote(client, note);
      const title = titleOf(full);
      const date = dateOfNote(full) || archiveDate;
      const dir = item.topicName ? safeFilename(item.topicName, "\u672A\u5206\u7C7B") : "\u672A\u5206\u7C7B";
      const markdown = renderNoteMarkdown(full, { topicName: item.topicName, archiveDate });
      const created = await createNote(root, { dir, title, content: markdown, date });
      stats.created += 1;
      if (id) ids.add(id);
      stats.notes.push({ noteId: id, title, path: created.path });
      if (stats.created % 20 === 0) log(`\u5DF2\u5199\u5165 ${stats.created} \u7BC7\u2026`);
    } catch (error2) {
      stats.failed += 1;
      stats.notes.push({ noteId: id, title: titleOf(note), error: String(error2 && error2.message ? error2.message : error2) });
    }
  }
  stats.durationMs = Date.now() - startedAt;
  stats.topics = topics;
  log(`\u5BFC\u5165\u5B8C\u6210\uFF1A\u65B0\u589E ${stats.created}\uFF0C\u8DF3\u8FC7 ${stats.skipped}\uFF08\u672C\u5730\u5DF2\u6709\uFF09\uFF0C\u5931\u8D25 ${stats.failed}`);
  return stats;
}
async function probeAccessToken(accessToken) {
  const { McpClient: McpClient2 } = await Promise.resolve().then(() => (init_biji(), biji_exports));
  const client = new McpClient2(accessToken);
  try {
    const info = await client.initialize();
    return { ok: true, serverInfo: info };
  } catch (error2) {
    return { ok: false, error: String(error2 && error2.message ? error2.message : error2) };
  }
}

// src/core/openapi.js
var import_node_crypto5 = require("node:crypto");
var API_BASE = "https://openapi.biji.com/open/api/v1";
var ERROR_HINTS = {
  quota_day: "\u4ECA\u5929\u7684\u8BFB/\u5199\u914D\u989D\u7528\u5B8C\u4E86\uFF0C\u660E\u5929\u6062\u590D\uFF08\u6216\u5347\u7EA7\u4F1A\u5458\uFF09\u3002\u672C\u5730\u5E93\u4E0D\u53D7\u5F71\u54CD\u3002",
  quota_month: "\u8FD9\u4E2A\u6708\u7684\u914D\u989D\u7528\u5B8C\u4E86\uFF0C\u4E0B\u4E2A\u6708\u6062\u590D\uFF08\u6216\u5347\u7EA7\u4F1A\u5458\uFF09\u3002\u672C\u5730\u5E93\u4E0D\u53D7\u5F71\u54CD\u3002",
  rate_limit: "\u8BF7\u6C42\u592A\u9891\u7E41\uFF0C\u7A0D\u7B49\u51E0\u79D2\u518D\u8BD5\u3002",
  invalid_api_key: "API Key \u4E0D\u5BF9\uFF0C\u53BB\u5F97\u5230\u5927\u8111\u63A7\u5236\u53F0\u91CD\u65B0\u751F\u6210\u4E00\u4E2A\u3002",
  grant_expired: "\u6388\u6743\u5DF2\u8FC7\u671F\uFF0C\u9700\u8981\u91CD\u65B0\u6388\u6743\u3002",
  grant_not_valid: "\u6388\u6743\u5DF2\u88AB\u64A4\u9500\uFF0C\u9700\u8981\u91CD\u65B0\u6388\u6743\u3002"
};
function toError(status, payload, what) {
  const err = payload && typeof payload === "object" && payload.error ? payload.error : {};
  const reason = typeof err.reason === "string" ? err.reason : "";
  const message = typeof err.message === "string" && err.message !== "" ? err.message : "";
  const hint = ERROR_HINTS[reason] || "";
  const parts = [`${what}\u5931\u8D25`];
  if (message) parts.push(message);
  if (status) parts.push(`HTTP ${status}`);
  if (hint) parts.push(hint);
  const e3 = new Error(parts.join("\uFF1A").replace(/(：)+/g, "\uFF1A"));
  e3.status = status || 502;
  e3.code = typeof err.code === "number" ? err.code : null;
  e3.reason = reason || null;
  e3.requestId = payload && typeof payload === "object" ? payload.request_id || null : null;
  e3.partial = payload;
  return e3;
}
var ID_KEY = /(^|_)(id|ids|cursor)$/i;
function reviver(key, value) {
  if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) {
    return String(value);
  }
  if (typeof value === "number" && ID_KEY.test(key) && Math.abs(value) > 1e15) {
    return String(value);
  }
  return value;
}
function parseJson(text) {
  try {
    return JSON.parse(text, reviver);
  } catch {
    return null;
  }
}
function unwrap(payload, status, what) {
  if (!payload || typeof payload !== "object") {
    throw toError(status, null, what);
  }
  if (payload.success === false) {
    throw toError(status, payload, what);
  }
  return payload.data;
}
function createClient({ apiKey, clientId, grantId, baseUrl = API_BASE, fetchImpl = globalThis.fetch, timeoutMs = 3e4 } = {}) {
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw Object.assign(new Error("\u8FD8\u6CA1\u6709 API Key\uFF1A\u53BB\u5F97\u5230\u5927\u8111\u63A7\u5236\u53F0\u300CAPI Key\u300D\u9875\u521B\u5EFA\u4E00\u4E2A\uFF08\u5F62\u5982 gk_live_xxx\uFF09\uFF0C\u7C98\u5230\u9762\u677F\u7684\u300C\u8BBE\u7F6E \u2192 \u4E91\u7AEF\u63A5\u5165\u300D\u91CC\u3002"), { status: 401 });
  }
  if (typeof clientId !== "string" || clientId.trim() === "") {
    throw Object.assign(new Error("\u8FD8\u6CA1\u6709 Client ID\uFF1A\u53BB\u5F97\u5230\u5927\u8111\u63A7\u5236\u53F0\u300C\u5E94\u7528\u7BA1\u7406\u300D\u9875\u521B\u5EFA\u4E2A\u4EBA\u5F00\u53D1\u5E94\u7528\uFF0C\u590D\u5236 Client ID\uFF08\u5F62\u5982 cli_xxx\uFF09\u3002"), { status: 401 });
  }
  if (typeof fetchImpl !== "function") {
    throw Object.assign(new Error("\u8FD0\u884C\u73AF\u5883\u6CA1\u6709 fetch\uFF0C\u65E0\u6CD5\u8BBF\u95EE\u5F97\u5230\u5927\u8111\u4E91\u7AEF"), { status: 500 });
  }
  const headers = {
    Authorization: apiKey.trim(),
    "X-Client-ID": clientId.trim(),
    Accept: "application/json"
  };
  if (typeof grantId === "string" && grantId.trim() !== "") {
    headers["X-Grant-ID"] = grantId.trim();
  }
  async function request(method, path, { query, body } = {}) {
    let url = `${baseUrl.replace(/\/+$/, "")}${path}`;
    if (query && Object.keys(query).length > 0) {
      const qs = new URLSearchParams();
      for (const [k4, v3] of Object.entries(query)) {
        if (v3 === void 0 || v3 === null || v3 === "") continue;
        qs.set(k4, String(v3));
      }
      const s3 = qs.toString();
      if (s3) url += `?${s3}`;
    }
    const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(timeoutMs) };
    if (body !== void 0) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetchImpl(url, init);
    } catch (cause) {
      const e3 = new Error(`\u8FDE\u4E0D\u4E0A\u5F97\u5230\u5927\u8111\uFF08${cause && cause.name === "TimeoutError" ? "\u8BF7\u6C42\u8D85\u65F6" : cause && cause.message || "\u7F51\u7EDC\u9519\u8BEF"}\uFF09\u3002\u68C0\u67E5\u7F51\u7EDC\u6216\u4EE3\u7406\u3002`);
      e3.status = 502;
      throw e3;
    }
    const text = await res.text().catch(() => "");
    const payload = parseJson(text);
    if (!res.ok) throw toError(res.status, payload, path);
    return unwrap(payload, res.status, path);
  }
  const get = (path, query) => request("GET", path, { query });
  const post = (path, body) => request("POST", path, { body });
  async function listNotes({ cursor, limit } = {}) {
    const data = await get("/resource/note/list", { cursor, limit });
    return {
      notes: Array.isArray(data?.notes) ? data.notes : [],
      hasMore: data?.has_more === true,
      cursor: data?.cursor ?? data?.next_cursor ?? null,
      total: typeof data?.total === "number" ? data.total : null
    };
  }
  async function getNote(noteId) {
    const data = await get("/resource/note/detail", { id: String(noteId) });
    return data?.note ?? null;
  }
  async function listRecorderNotes({ sinceId = 0, limit = 20 } = {}) {
    const data = await get("/resource/note/recorder/list", { since_id: sinceId, limit });
    return {
      notes: Array.isArray(data?.notes) ? data.notes : [],
      hasMore: data?.has_more === true,
      nextCursor: data?.next_cursor ?? null,
      total: typeof data?.total === "number" ? data.total : null
    };
  }
  async function getRecorderNote(noteId) {
    const data = await get("/resource/note/recorder/detail", { id: String(noteId) });
    return data?.note ?? null;
  }
  async function createNote2({ noteType = "plain_text", title, content, linkUrl, imageUrls, tags, topicId, parentId, clientRequestId } = {}) {
    const body = { note_type: noteType };
    if (title !== void 0) body.title = title;
    if (content !== void 0) body.content = content;
    if (linkUrl !== void 0) body.link_url = linkUrl;
    if (imageUrls !== void 0) body.image_urls = imageUrls;
    if (tags !== void 0) body.tags = tags;
    if (topicId !== void 0) body.topic_id = topicId;
    if (parentId !== void 0) body.parent_id = String(parentId);
    body.client_request_id = clientRequestId || `dsh-${Date.now()}-${(0, import_node_crypto5.randomBytes)(4).toString("hex")}`;
    const data = await post("/resource/note/save", body);
    return {
      noteId: data?.note_id ?? null,
      tasks: Array.isArray(data?.tasks) ? data.tasks : []
    };
  }
  async function updateNote({ noteId, title, content, tags } = {}) {
    if (title === void 0 && content === void 0 && tags === void 0) {
      throw Object.assign(new Error("\u66F4\u65B0\u7B14\u8BB0\u81F3\u5C11\u8981\u6539\u6807\u9898\u3001\u5185\u5BB9\u6216\u6807\u7B7E\u4E4B\u4E00"), { status: 400 });
    }
    const body = { note_id: String(noteId) };
    if (title !== void 0) body.title = title;
    if (content !== void 0) body.content = content;
    if (tags !== void 0) body.tags = tags;
    await post("/resource/note/update", body);
    return true;
  }
  async function deleteNote(noteId) {
    await post("/resource/note/delete", { note_id: String(noteId) });
    return true;
  }
  async function taskProgress(taskId) {
    return await post("/resource/note/task/progress", { task_id: String(taskId) });
  }
  async function addTags(noteId, tags) {
    await post("/resource/note/tags/add", { note_id: String(noteId), tags: Array.isArray(tags) ? tags : [tags] });
    return true;
  }
  async function deleteTag(noteId, tagId) {
    await post("/resource/note/tags/delete", { note_id: String(noteId), tag_id: String(tagId) });
    return true;
  }
  async function listTopics2(page = 1) {
    const data = await get("/resource/knowledge/list", { page });
    const list = Array.isArray(data?.topics) ? data.topics : Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : [];
    return {
      topics: list.map((t4) => ({
        id: String(t4?.topic_id ?? t4?.id ?? ""),
        name: String(t4?.name ?? t4?.title ?? "\u672A\u547D\u540D\u77E5\u8BC6\u5E93"),
        type: t4?.type ?? null
      })).filter((t4) => t4.id !== ""),
      hasMore: data?.has_more === true,
      total: typeof data?.total === "number" ? data.total : null
    };
  }
  async function createTopic({ name, description } = {}) {
    if (!name) throw Object.assign(new Error("\u77E5\u8BC6\u5E93\u8981\u6709\u540D\u5B57"), { status: 400 });
    const data = await post("/resource/knowledge/create", { name, description });
    return { id: String(data?.topic_id ?? data?.id ?? ""), name };
  }
  async function listTopicNotes({ topicId, page = 1 } = {}) {
    const data = await get("/resource/knowledge/notes", { topic_id: topicId, page });
    return {
      notes: Array.isArray(data?.notes) ? data.notes : [],
      hasMore: data?.has_more === true,
      total: typeof data?.total === "number" ? data.total : null
    };
  }
  async function browseTopic({ topicId, directoryId } = {}) {
    const data = await get("/resource/knowledge/directories", { topic_id: topicId, directory_id: directoryId });
    return {
      directories: Array.isArray(data?.directories) ? data.directories : [],
      resources: Array.isArray(data?.resources) ? data.resources : []
    };
  }
  async function addNotesToTopic({ topicId, noteIds }) {
    await post("/resource/knowledge/note/batch-add", { topic_id: topicId, note_ids: noteIds.map(String) });
    return true;
  }
  async function removeNotesFromTopic({ topicId, noteIds }) {
    await post("/resource/knowledge/note/remove", { topic_id: topicId, note_ids: noteIds.map(String) });
    return true;
  }
  async function recall(query, topK = 5) {
    const data = await post("/resource/recall", { query, top_k: Math.min(Math.max(topK, 1), 10) });
    const list = Array.isArray(data?.results) ? data.results : Array.isArray(data?.notes) ? data.notes : [];
    return list;
  }
  async function recallInTopic({ topicId, query, topK = 5 } = {}) {
    const data = await post("/resource/recall/knowledge", { topic_id: topicId, query, top_k: Math.min(Math.max(topK, 1), 10) });
    return Array.isArray(data?.results) ? data.results : Array.isArray(data?.notes) ? data.notes : [];
  }
  async function createShareLink({ noteId, excludeAudio = false } = {}) {
    const data = await post("/resource/note/sharing", { note_id: String(noteId), share_exclude_audio: excludeAudio === true });
    return data?.share_url ?? data?.url ?? null;
  }
  return {
    // 笔记
    listNotes,
    getNote,
    listRecorderNotes,
    getRecorderNote,
    createNote: createNote2,
    updateNote,
    deleteNote,
    taskProgress,
    // 标签
    addTags,
    deleteTag,
    // 知识库
    listTopics: listTopics2,
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
    headers
  };
}
function extractAudio(note) {
  if (!note || typeof note !== "object") return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (url, duration, kind, title) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    const key = url.split("#")[0];
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url, duration: typeof duration === "number" && duration > 0 ? duration : null, kind, title: title || null });
  };
  if (note.audio && typeof note.audio === "object") {
    push(note.audio.play_url, note.audio.duration, "primary", note.title);
  }
  if (Array.isArray(note.attachments)) {
    for (const a3 of note.attachments) {
      if (a3 && (a3.type === "audio" || /\.(mp3|m4a|wav|aac|ogg)$/i.test(String(a3.url || "")))) {
        const raw = a3.duration;
        const seconds = typeof raw === "number" && raw > 1e3 ? Math.round(raw / 1e3) : raw;
        push(a3.url, seconds, "attachment", a3.title);
      }
    }
  }
  if (note.timeline && Array.isArray(note.timeline.resources)) {
    for (const r3 of note.timeline.resources) {
      if (r3 && r3.type === "audio") push(r3.url, null, "timeline", null);
    }
  }
  return out;
}
function extractOriginal(note) {
  if (!note || typeof note !== "object") return "";
  if (note.audio && typeof note.audio.original === "string" && note.audio.original.trim() !== "") {
    return note.audio.original;
  }
  if (note.web_page && typeof note.web_page.content === "string" && note.web_page.content.trim() !== "") {
    return note.web_page.content;
  }
  return typeof note.content === "string" ? note.content : "";
}
function normalizeNote(raw, { topicName } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const noteId = String(raw.note_id ?? raw.noteId ?? raw.id ?? "");
  if (noteId === "") return null;
  const tags = Array.isArray(raw.tags) ? raw.tags.map((t4) => typeof t4 === "string" ? { id: null, name: t4, type: "manual" } : { id: t4?.id != null ? String(t4.id) : null, name: String(t4?.name ?? ""), type: t4?.type ?? "manual" }).filter((t4) => t4.name !== "") : [];
  const topics = Array.isArray(raw.topics) ? raw.topics.map((t4) => ({ id: String(t4?.id ?? ""), name: String(t4?.name ?? "") })).filter((t4) => t4.id !== "") : [];
  const audio = extractAudio(raw);
  const original = extractOriginal(raw);
  const moments = raw.timeline && Array.isArray(raw.timeline.moments) ? raw.timeline.moments.map((m3) => ({
    startMs: typeof m3?.start_ms === "number" ? m3.start_ms : 0,
    endMs: typeof m3?.end_ms === "number" ? m3.end_ms : 0,
    text: String(m3?.text ?? "")
  })).filter((m3) => m3.text !== "") : [];
  const todos = raw.meeting_todos && Array.isArray(raw.meeting_todos.items) ? raw.meeting_todos.items.map((t4) => ({ text: String(t4?.text ?? ""), completed: t4?.completed === true })).filter((t4) => t4.text !== "") : [];
  return {
    noteId,
    title: String(raw.title ?? "").trim(),
    content: typeof raw.content === "string" ? raw.content : "",
    refContent: typeof raw.ref_content === "string" ? raw.ref_content : "",
    noteType: String(raw.note_type ?? "NOTE"),
    source: raw.source ?? null,
    entryType: raw.entry_type ?? null,
    tags,
    topics: topics.length > 0 ? topics : topicName ? [{ id: "", name: topicName }] : [],
    childrenIds: Array.isArray(raw.children_ids) ? raw.children_ids.map(String) : [],
    childrenCount: typeof raw.children_count === "number" ? raw.children_count : 0,
    quickNote: typeof raw.quick_note === "string" ? raw.quick_note : "",
    audio,
    hasAudio: audio.length > 0,
    original,
    hasTranscript: original !== "",
    moments,
    todos,
    recorderSn: raw.recorder_sn ?? null,
    version: typeof raw.version === "number" ? raw.version : null,
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
    // 内容指纹：同步时用来判断「云端真的改过吗」，避免每次刷新都重写文件
    fingerprint: fingerprintOf({ title: raw.title, content: original, updatedAt: raw.updated_at, tags: tags.map((t4) => t4.name) })
  };
}
function fingerprintOf(parts) {
  const h5 = (0, import_node_crypto5.createHash)("sha1");
  h5.update(JSON.stringify({
    title: parts?.title ?? "",
    content: parts?.content ?? "",
    updatedAt: parts?.updatedAt ?? "",
    tags: Array.isArray(parts?.tags) ? parts.tags : []
  }));
  return h5.digest("hex").slice(0, 16);
}

// src/core/service.js
init_net();

// src/core/mcp-cloud.js
init_biji();
function wrapError(what, error2) {
  const message = error2 && error2.message ? error2.message : String(error2);
  const e3 = new Error(`\u5F97\u5230\u5927\u8111 ${what} \u5931\u8D25\uFF1A${message}`);
  e3.status = /401|unauthorized|no bearer token/i.test(message) ? 401 : 502;
  e3.cause = error2;
  return e3;
}
function bridgeAudio(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const attachments = Array.isArray(raw.attachments) ? raw.attachments : [];
  const primary = attachments.find((a3) => a3 && a3.type === "audio" && typeof a3.url === "string");
  if (!primary) return raw;
  const audio = raw.audio && typeof raw.audio === "object" ? { ...raw.audio } : {};
  if (!audio.play_url) audio.play_url = primary.url;
  if (audio.duration === void 0 && typeof primary.duration === "number") {
    audio.duration = primary.duration > 1e3 ? Math.round(primary.duration / 1e3) : primary.duration;
  }
  return { ...raw, audio };
}
function createMcpCloudClient({ accessToken, url } = {}) {
  const mcp = new McpClient(accessToken, url ? { url } : void 0);
  let ready = null;
  function ensureReady() {
    if (ready === null) {
      ready = mcp.initialize().catch((error2) => {
        ready = null;
        throw wrapError("\u63E1\u624B", error2);
      });
    }
    return ready;
  }
  async function tool(name, args) {
    await ensureReady();
    try {
      return await mcp.callTool(name, args);
    } catch (error2) {
      throw wrapError(name, error2);
    }
  }
  async function listNotes({ cursor, limit } = {}) {
    const pageSize = typeof limit === "number" && limit > 0 ? Math.min(limit, 100) : 20;
    const args = { page_size: pageSize };
    if (cursor) args.cursor = String(cursor);
    const data = await tool("list_notes", args);
    const notes = Array.isArray(data?.notes) ? data.notes : [];
    return {
      notes,
      hasMore: data?.has_more === true,
      cursor: data?.cursor ?? data?.pagination?.next_cursor ?? null,
      total: typeof data?.total === "number" ? data.total : null
    };
  }
  async function getNote(noteId) {
    const data = await tool("get_note", { id: String(noteId) });
    const note = data?.note ?? data;
    return bridgeAudio(note) ?? null;
  }
  async function listRecorderNotes({ sinceId = 0, limit = 20 } = {}) {
    const data = await tool("list_notes", { note_type: "recorder_audio", page_size: Math.min(limit, 100), ...sinceId ? {} : {} });
    const notes = Array.isArray(data?.notes) ? data.notes : [];
    return { notes, hasMore: data?.has_more === true, nextCursor: data?.cursor ?? null, total: data?.total ?? null };
  }
  const getRecorderNote = getNote;
  async function createNote2({ noteType, title, content, linkUrl, imageUrls, tags, topicId, parentId, clientRequestId } = {}) {
    const args = {};
    if (title !== void 0) args.title = String(title);
    if (content !== void 0) args.content = String(content);
    if (noteType !== void 0) args.note_type = noteType;
    if (Array.isArray(tags)) args.tags = tags.map(String);
    if (topicId !== void 0) args.topic_id = String(topicId);
    if (parentId !== void 0) args.parent_id = String(parentId);
    if (linkUrl !== void 0) args.link_url = String(linkUrl);
    if (Array.isArray(imageUrls)) args.image_urls = imageUrls.map(String);
    if (clientRequestId !== void 0) args.client_request_id = String(clientRequestId);
    const data = await tool("save_note", args);
    return { noteId: data?.note_id != null ? String(data.note_id) : null, tasks: data?.tasks ?? null, raw: data };
  }
  async function updateNote({ noteId, title, content, tags } = {}) {
    const args = { note_id: String(noteId) };
    if (title !== void 0) args.title = String(title);
    if (content !== void 0) args.content = String(content);
    if (Array.isArray(tags)) args.tags = tags.map(String);
    return tool("update_note", args);
  }
  async function deleteNote(noteId) {
    return tool("delete_note", { note_id: String(noteId) });
  }
  async function taskProgress(taskId) {
    return tool("get_note_task_progress", { task_id: String(taskId) });
  }
  async function addTags(noteId, tags) {
    return tool("add_note_tags", { note_id: String(noteId), tags: (tags || []).map(String) });
  }
  async function deleteTag(noteId, tagId) {
    return tool("delete_note_tag", { note_id: String(noteId), tag_id: String(tagId) });
  }
  async function listTopics2(page = 1) {
    const data = await tool("list_topics", { page: Math.max(1, Number(page) || 1), page_size: 20 });
    const topics = Array.isArray(data?.topics) ? data.topics : [];
    return { topics, hasMore: data?.has_more === true, total: typeof data?.total === "number" ? data.total : null };
  }
  async function createTopic({ name, description } = {}) {
    return tool("create_topic", { name: String(name), ...description ? { description: String(description) } : {} });
  }
  async function listTopicNotes({ topicId, page = 1 } = {}) {
    const data = await tool("list_topic_notes", { topic_id: String(topicId), page: Math.max(1, Number(page) || 1), page_size: 20 });
    const notes = Array.isArray(data?.notes) ? data.notes : [];
    return { notes, hasMore: data?.has_more === true, total: typeof data?.total === "number" ? data.total : null };
  }
  async function browseTopic({ topicId, directoryId } = {}) {
    const data = await tool("list_topic_notes", { topic_id: String(topicId), page: 1, page_size: 20 });
    return { notes: Array.isArray(data?.notes) ? data.notes : [], directories: [], topicId, directoryId };
  }
  async function addNotesToTopic({ topicId, noteIds } = {}) {
    return tool("batch_add_notes_to_topic", { topic_id: String(topicId), note_ids: (noteIds || []).map(String) });
  }
  async function removeNotesFromTopic({ topicId, noteIds } = {}) {
    const results = [];
    for (const id of noteIds || []) {
      results.push(await tool("remove_note_from_topic", { topic_id: String(topicId), note_id: String(id) }));
    }
    return results;
  }
  async function recall(query, topK = 5) {
    const data = await tool("recall", { query: String(query), top_k: Math.max(1, Math.min(Number(topK) || 5, 20)) });
    const results = Array.isArray(data?.results) ? data.results : [];
    return { results: results.map((r3) => ({ ...bridgeAudio(r3.note ?? r3), score: r3.score, snippet: r3.snippet ?? null, noteId: r3.note_id ?? r3.note?.note_id ?? null })), raw: data };
  }
  async function recallInTopic({ topicId, query, topK = 5 } = {}) {
    const data = await tool("recall_knowledge", { topic_id: String(topicId), query: String(query), top_k: Math.max(1, Math.min(Number(topK) || 5, 20)) });
    const results = Array.isArray(data?.results) ? data.results : [];
    return { results: results.map((r3) => ({ ...bridgeAudio(r3.note ?? r3), score: r3.score, snippet: r3.snippet ?? null, noteId: r3.note_id ?? r3.note?.note_id ?? null })), raw: data };
  }
  async function createShareLink({ noteId, excludeAudio } = {}) {
    const args = { note_id: String(noteId) };
    if (excludeAudio === true) args.share_exclude_audio = true;
    const data = await tool("share_note", args);
    return data?.share_url ?? data?.url ?? data;
  }
  async function getTranscript(noteId) {
    return tool("get_note_transcript", { id: String(noteId) });
  }
  async function getChapters(noteId) {
    return tool("get_note_chapters", { id: String(noteId) });
  }
  async function getTimeline(noteId) {
    return tool("get_note_timeline", { id: String(noteId) });
  }
  async function getTodos(noteId) {
    return tool("get_note_todos", { id: String(noteId) });
  }
  async function getAttachments(noteId) {
    return tool("get_note_attachments", { id: String(noteId) });
  }
  async function getQuota() {
    return tool("get_quota", {});
  }
  return {
    // 标记当前通道，供 /status 与日志区分
    transport: "mcp",
    listNotes,
    getNote,
    listRecorderNotes,
    getRecorderNote,
    createNote: createNote2,
    updateNote,
    deleteNote,
    taskProgress,
    addTags,
    deleteTag,
    listTopics: listTopics2,
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
    tool
  };
}

// src/core/cloud-sync.js
var import_node_crypto6 = require("node:crypto");
init_vfs();
init_vault();
var PAGE_SIZE = 20;
var EARLY_STOP_PAGES = 2;
var MAX_NOTES_PER_RUN2 = 2e3;
var MAX_PAGES = 200;
function contentFingerprint({ title, content, tags }) {
  const h5 = (0, import_node_crypto6.createHash)("sha1");
  h5.update(String(title ?? ""));
  h5.update("\0");
  h5.update(String(content ?? ""));
  h5.update("\0");
  h5.update(Array.isArray(tags) ? tags.join("") : "");
  return h5.digest("hex").slice(0, 16);
}
async function localFingerprintOf(path) {
  try {
    const text = await readFile2(path, "utf8");
    const { data, body } = parseFrontmatter(text);
    const tags = Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : [];
    const title = String(data.title ?? "") || firstHeading(body);
    return contentFingerprint({ title, content: stripSourceFooter(body).trim(), tags });
  } catch {
    return null;
  }
}
function firstHeading(body) {
  const m3 = /^#\s+(.+)$/m.exec(String(body || ""));
  return m3 ? m3[1].trim() : "";
}
function stripSourceFooter(body) {
  return String(body || "").replace(/^[ \t]*（源自得到大脑[^\n]*）[ \t]*\n?/gm, "").replace(/\n+(?:-[ \t]*-[ \t]*-[ \t]*\n*)+$/, "\n");
}
function renderNote({ note, topicName, archiveDate }) {
  const tags = note.tags.map((t4) => t4.name).filter(Boolean);
  const allTags = ["\u5F97\u5230\u5927\u8111", ...topicName ? [topicName] : [], ...tags];
  const uniq = [...new Set(allTags)];
  const fm = [
    "---",
    `title: ${yamlString(note.title)}`,
    `tags: [${uniq.map(yamlBare).join(", ")}]`,
    `note_id: "${note.noteId}"`
  ];
  if (note.noteType) fm.push(`note_type: ${note.noteType}`);
  if (topicName) fm.push(`\u77E5\u8BC6\u5E93: ${yamlString(topicName)}`);
  if (note.recorderSn) fm.push(`\u5F55\u97F3\u5361: ${note.recorderSn}`);
  if (note.createdAt) fm.push(`\u521B\u5EFA: ${yamlString(note.createdAt)}`);
  if (note.updatedAt) fm.push(`\u66F4\u65B0: ${yamlString(note.updatedAt)}`);
  fm.push(`\u5F52\u6863: ${archiveDate}`);
  fm.push("---", "");
  const parts = [fm.join("\n")];
  parts.push(`# ${note.title || "\u672A\u547D\u540D\u7B14\u8BB0"}`, "");
  if (note.refContent) {
    parts.push(...note.refContent.split("\n").map((l3) => `> ${l3}`), "");
  }
  if (note.quickNote) {
    parts.push("## \u73B0\u573A\u901F\u8BB0", "", note.quickNote, "");
  }
  if (note.content) {
    parts.push(stripDuplicateHeading(note.content, note.title), "");
  }
  if (note.hasTranscript && extractOriginal({ audio: { original: note.original } }) !== note.content) {
    parts.push("## \u9010\u5B57\u7A3F", "", "```", note.original, "```", "");
  }
  if (note.moments.length > 0) {
    parts.push("## \u65F6\u95F4\u8F74", "", "| \u65F6\u95F4 | \u5185\u5BB9 |", "| --- | --- |");
    for (const m3 of note.moments) {
      parts.push(`| ${fmtMs(m3.startMs)} | ${escapeCell(m3.text)} |`);
    }
    parts.push("");
  }
  if (note.todos.length > 0) {
    parts.push("## \u5F85\u529E", "");
    for (const t4 of note.todos) parts.push(`- [${t4.completed ? "x" : " "}] ${t4.text}`);
    parts.push("");
  }
  if (note.audio.length > 0) {
    parts.push("## \u97F3\u9891", "");
    for (const a3 of note.audio) {
      const label = a3.kind === "primary" ? "\u5F55\u97F3" : a3.kind === "attachment" ? "\u9644\u4EF6\u97F3\u9891" : "\u65F6\u95F4\u7EBF\u97F3\u9891";
      const dur = a3.duration ? ` \xB7 ${fmtSeconds(a3.duration)}` : "";
      parts.push(`- ${label}${dur}\uFF1A[\u64AD\u653E](${a3.url})`);
    }
    parts.push("");
  }
  parts.push("---", "");
  const share = `https://www.biji.com/note/${note.noteId}`;
  parts.push(`\uFF08\u6E90\u81EA\u5F97\u5230\u5927\u8111 \xB7 [\u539F\u7B14\u8BB0](${share}) \xB7 \u5F52\u6863\u4E8E ${archiveDate}\uFF09`);
  return parts.join("\n");
}
function stripDuplicateHeading(content, title) {
  const text = String(content || "");
  const name = String(title || "").trim();
  if (name === "") return text;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*#\\s+${escaped}\\s*\\n+`);
  return text.replace(re, "");
}
function yamlString(v3) {
  const s3 = String(v3 ?? "");
  if (s3 === "") return '""';
  if (/[:#\[\]{}",\n]/.test(s3) || /^\s|\s$/.test(s3)) return JSON.stringify(s3);
  return s3;
}
function yamlBare(v3) {
  const s3 = String(v3 ?? "");
  if (s3 === "") return '""';
  if (/[\[\]{},:#"]/.test(s3) || /^\s|\s$/.test(s3)) return JSON.stringify(s3);
  return s3;
}
function escapeCell(v3) {
  return String(v3 ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}
function fmtMs(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1e3));
  const h5 = Math.floor(total / 3600);
  const m3 = Math.floor(total % 3600 / 60);
  const s3 = total % 60;
  const pad2 = (n2) => String(n2).padStart(2, "0");
  return h5 > 0 ? `${pad2(h5)}:${pad2(m3)}:${pad2(s3)}` : `${pad2(m3)}:${pad2(s3)}`;
}
function fmtSeconds(sec) {
  return fmtMs(sec * 1e3);
}
var UNFILED_DIR = "\u672A\u5F52\u7C7B";
function safeDirName(name) {
  const cleaned = String(name ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned === "" || cleaned === "." || cleaned === "..") return "";
  return cleaned;
}
function dateOf2(note) {
  const raw = note.updatedAt || note.createdAt || "";
  const m3 = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw));
  if (m3) return `${m3[1]}-${m3[2]}-${m3[3]}`;
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function pathForNote({ note, topicName, state, index }) {
  const known = state.notes[note.noteId];
  if (known && typeof known.path === "string" && known.path !== "") return migrateOldUnfiled(known.path);
  const byId = index.get(String(note.noteId));
  if (byId) return migrateOldUnfiled(byId);
  const dir = safeDirName(topicName || "") || UNFILED_DIR;
  const base = safeFilenameLocal(`${dateOf2(note)}-${note.title || note.noteId}`);
  return `${dir}/${base}.md`;
}
function migrateOldUnfiled(rel) {
  if (typeof rel !== "string") return rel;
  if (!rel.startsWith("_/")) return rel;
  return `${UNFILED_DIR}/${rel.slice(2)}`;
}
function safeFilenameLocal(name) {
  const cleaned = String(name ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  const trimmed = cleaned.slice(0, 120) || "note";
  return trimmed.replace(/[. ]+$/, "") || "note";
}
async function buildIndex(root) {
  const index = /* @__PURE__ */ new Map();
  try {
    const scan = await scanVault(root);
    for (const entry of scan.entries) {
      if (entry.noteId) index.set(String(entry.noteId), entry.path);
    }
  } catch {
  }
  return index;
}
async function runSync({ client, root, state, full = false, log = () => {
}, index = null, maxNotes = MAX_NOTES_PER_RUN2, topicNames = {} } = {}) {
  const prev = state && typeof state === "object" && state.notes ? state.notes : {};
  const next = {};
  const errors = [];
  let pulled = 0;
  let skipped = 0;
  let adopted = 0;
  let conflicts = 0;
  let scanned = 0;
  let cursor = null;
  let pages = 0;
  let stalePages = 0;
  let hasMore = true;
  const seenIds = /* @__PURE__ */ new Set();
  const archiveDate = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const noteIndex = index instanceof Map ? index : await buildIndex(root);
  while (hasMore && pages < MAX_PAGES && scanned < maxNotes) {
    let page;
    try {
      page = await client.listNotes({ cursor, limit: PAGE_SIZE });
    } catch (err) {
      errors.push({ stage: "list", message: err.message, reason: err.reason ?? null });
      break;
    }
    pages += 1;
    if (page.notes.length === 0 && !page.hasMore) break;
    let pageHadChange = false;
    for (const raw of page.notes) {
      if (scanned >= maxNotes) break;
      scanned += 1;
      const summary = normalizeNote(raw);
      if (!summary) continue;
      seenIds.add(summary.noteId);
      const known = prev[summary.noteId];
      const listFp = contentFingerprint({
        title: summary.title,
        content: extractOriginal(raw) || summary.content,
        tags: summary.tags.map((t4) => t4.name)
      });
      if (known && known.listFp === listFp) {
        next[summary.noteId] = known;
        skipped += 1;
        continue;
      }
      pageHadChange = true;
      const relPath = pathForNote({ note: summary, topicName: topicNameFor(summary, topicNames), state: { notes: { ...prev, ...next } }, index: noteIndex });
      try {
        const outcome = await pullNote({
          client,
          root,
          note: summary,
          relPath,
          known,
          log,
          archiveDate,
          topicName: topicNameFor(summary, topicNames)
        });
        next[summary.noteId] = {
          path: outcome.path,
          listFp,
          cloudFp: outcome.cloudFp,
          localFp: outcome.localFp,
          updatedAt: summary.updatedAt,
          syncedAt: (/* @__PURE__ */ new Date()).toISOString(),
          // adopt 标记必须继承下来：它代表「这个文件是用户自己的，别覆盖」，
          // 漏了它下一轮就会被当成本地未改而覆盖掉。
          ...outcome.adopted === true ? { adopted: true } : {}
        };
        if (outcome.action === "pulled") pulled += 1;
        else if (outcome.action === "adopted") {
          adopted += 1;
          skipped += 1;
        } else if (outcome.action === "conflict") {
          conflicts += 1;
          pulled += 1;
        } else skipped += 1;
      } catch (err) {
        errors.push({ stage: "pull", noteId: summary.noteId, title: summary.title, message: err.message, reason: err.reason ?? null });
        if (known) next[summary.noteId] = known;
      }
    }
    if (!full) {
      stalePages = pageHadChange ? 0 : stalePages + 1;
      if (stalePages >= EARLY_STOP_PAGES) break;
    }
    hasMore = page.hasMore;
    cursor = page.cursor;
    if (!cursor) break;
  }
  let deleted = 0;
  if (full) {
    for (const [noteId, rec] of Object.entries(prev)) {
      if (seenIds.has(noteId)) continue;
      if (next[noteId]) continue;
      if (!rec || typeof rec.path !== "string") continue;
      try {
        const { abs } = resolveInside(root, rec.path);
        const localFp = await localFingerprintOf(abs);
        if (localFp !== null && rec.localFp && localFp !== rec.localFp) {
          log(`\u4FDD\u7559\u672C\u5730\u4FEE\u6539\uFF08\u4E91\u7AEF\u5DF2\u5220\u9664\uFF09\uFF1A${rec.path}`);
          next[noteId] = { ...rec, cloudDeleted: true };
          conflicts += 1;
          continue;
        }
        const { trashNote: trashNote2 } = await Promise.resolve().then(() => (init_vault(), vault_exports));
        await trashNote2(root, rec.path);
        deleted += 1;
        log(`\u4E91\u7AEF\u5DF2\u5220\u9664\uFF0C\u79FB\u5165\u56DE\u6536\u7AD9\uFF1A${rec.path}`);
      } catch (err) {
        errors.push({ stage: "delete", noteId, message: err.message });
      }
    }
  }
  return { pulled, skipped, adopted, conflicts, deleted, errors, notes: next, scanned, pages, full };
}
function topicNameFor(note, topicNames) {
  const first = note.topics && note.topics[0];
  if (!first) return "";
  if (first.name) return first.name;
  return topicNames[first.id] || "";
}
async function pullNote({ client, root, note, relPath, known, log, archiveDate, topicName }) {
  let detail = null;
  const typeText = String(note.noteType || "").toLowerCase();
  const needsDetail = typeText.includes("recorder") || typeText.includes("meeting") || typeText.includes("audio") || !note.content;
  if (needsDetail) {
    try {
      detail = await client.getNote(note.noteId);
    } catch (err) {
      if (note.content) {
        log(`\u8BE6\u60C5\u62C9\u53D6\u5931\u8D25\uFF0C\u7528\u5217\u8868\u6570\u636E\uFF1A${note.title}\uFF08${err.message}\uFF09`);
      } else {
        throw err;
      }
    }
  }
  const full = detail ? normalizeNote(detail) : note;
  const cloudFp = contentFingerprint({ title: full.title, content: full.original || full.content, tags: full.tags.map((t4) => t4.name) });
  const { abs } = resolveInside(root, relPath);
  const localFp = await localFingerprintOf(abs);
  const rendered = renderNote({ note: full, topicName: topicName || topicNameFor(full, {}), archiveDate });
  if (localFp === null) {
    await writeNote(root, relPath, rendered, { backup: false });
    return { action: "pulled", path: relPath, cloudFp, localFp: await localFingerprintOf(abs) };
  }
  if (!known) {
    log(`\u672C\u5730\u5DF2\u6709\u540C\u540D\u7B14\u8BB0\uFF0C\u4FDD\u7559\u539F\u6837\uFF08\u4E0D\u6539\u5199\uFF09\uFF1A${relPath}`);
    return { action: "adopted", path: relPath, cloudFp, localFp, adopted: true };
  }
  if (known.adopted === true && cloudFp !== known.cloudFp) {
    const altPath = conflictArchiveName(relPath, { cloud: true });
    try {
      await writeNote(root, altPath, rendered, { backup: false });
      log(`\u4E91\u7AEF\u6709\u65B0\u7248\u672C\uFF0C\u53E6\u5B58\u4E3A\uFF1A${altPath}\uFF08\u4F60\u7684\u672C\u5730\u7248\u4FDD\u6301\u4E0D\u52A8\uFF09`);
    } catch (err) {
      log(`\u4E91\u7AEF\u65B0\u7248\u672C\u53E6\u5B58\u5931\u8D25\uFF1A${err.message}`);
    }
    return { action: "kept-local", path: relPath, cloudFp, localFp, adopted: true };
  }
  const localChanged = Boolean(known.localFp && localFp !== known.localFp);
  const cloudChanged = Boolean(!known || !known.cloudFp || cloudFp !== known.cloudFp);
  if (!localChanged) {
    await writeNote(root, relPath, rendered, { backup: false });
    return { action: "pulled", path: relPath, cloudFp, localFp: cloudFp };
  }
  if (localChanged && !cloudChanged) {
    log(`\u4FDD\u7559\u672C\u5730\u4FEE\u6539\uFF1A${relPath}`);
    return { action: "kept-local", path: relPath, cloudFp, localFp };
  }
  const conflictPath = conflictArchiveName(relPath);
  let backedUp = false;
  try {
    const original = await readNote(root, relPath);
    await writeNote(root, conflictPath, original.content, { backup: false });
    backedUp = true;
    log(`\u68C0\u6D4B\u5230\u51B2\u7A81\uFF0C\u672C\u5730\u7248\u672C\u53E6\u5B58\uFF1A${conflictPath}`);
  } catch (err) {
    log(`\u51B2\u7A81\u7248\u672C\u53E6\u5B58\u5931\u8D25\uFF1A${err.message}`);
  }
  if (!backedUp) {
    log(`\u4FDD\u7559\u672C\u5730\u539F\u6587\u4E0D\u52A8\uFF08\u5907\u4EFD\u5931\u8D25\uFF0C\u4E0D\u6562\u8986\u76D6\uFF09\uFF1A${relPath}`);
    return { action: "kept-local", path: relPath, cloudFp, localFp };
  }
  await writeNote(root, relPath, rendered, { backup: false });
  return { action: "conflict", path: relPath, cloudFp, localFp: cloudFp, conflictPath };
}
async function syncSingleNote({ client, root, state, noteId, log = () => {
}, index = null, topicNames = {} } = {}) {
  const prev = state && state.notes ? state.notes : {};
  const raw = await client.getNote(noteId);
  if (!raw) throw Object.assign(new Error("\u4E91\u7AEF\u6CA1\u6709\u8FD9\u7BC7\u7B14\u8BB0\uFF08\u53EF\u80FD\u5DF2\u88AB\u5220\u9664\uFF09"), { status: 404 });
  const note = normalizeNote(raw);
  if (!note) throw Object.assign(new Error("\u4E91\u7AEF\u8FD4\u56DE\u7684\u7B14\u8BB0\u89E3\u6790\u5931\u8D25"), { status: 502 });
  const known = prev[noteId];
  const relPath = pathForNote({
    note,
    topicName: topicNameFor(note, topicNames),
    state,
    index: index instanceof Map ? index : await buildIndex(root)
  });
  const archiveDate = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const outcome = await pullNote({ client, root, note, relPath, known, log, archiveDate, topicName: topicNameFor(note, topicNames) });
  const listFp = contentFingerprint({ title: note.title, content: note.original || note.content, tags: note.tags.map((t4) => t4.name) });
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
      syncedAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...outcome.adopted === true ? { adopted: true } : {}
    }
  };
}
function pushPayloadOf(fileText) {
  const { data, body } = parseFrontmatter(fileText);
  const noteId = typeof data.note_id === "string" ? data.note_id.replace(/^"|"$/g, "") : null;
  const title = (typeof data.title === "string" ? data.title : firstHeading(body)) || "";
  const content = stripSourceFooter(body).replace(/^\s+/, "").replace(/^#\s+.+\n+/, "").trim();
  const tags = Array.isArray(data.tags) ? data.tags.map(String).filter((t4) => t4 !== "\u5F97\u5230\u5927\u8111") : void 0;
  return { noteId, title, content, tags };
}
async function pushNote({ client, root, relPath, noteId } = {}) {
  const { content: fileText } = await readNote(root, relPath);
  const payload = pushPayloadOf(fileText);
  const id = noteId || payload.noteId;
  if (payload.content === "") {
    throw Object.assign(new Error("\u8FD9\u7BC7\u7B14\u8BB0\u6CA1\u6709\u6B63\u6587\uFF0C\u4E0D\u80FD\u63A8\u5230\u4E91\u7AEF\uFF08\u4F1A\u6E05\u7A7A\u4E91\u7AEF\u5185\u5BB9\uFF09"), { status: 400 });
  }
  if (!id) {
    const created = await client.createNote({
      title: payload.title || "\u6765\u81EA DSH \u7684\u7B14\u8BB0",
      content: payload.content,
      tags: payload.tags
    });
    return { action: "created", noteId: created.noteId };
  }
  await client.updateNote({ noteId: id, title: payload.title || void 0, content: payload.content });
  return { action: "updated", noteId: id };
}

// src/core/service.js
var ROUTE_PREFIX = "/getnote";
var pendingAuthorizations = /* @__PURE__ */ new Map();
var importState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  lines: [],
  result: null,
  error: null
};
var AUTH_TTL_MS = 15 * 60 * 1e3;
var MAX_BODY = 2 * 1024 * 1024 + 64 * 1024;
var MAX_UPLOAD = 100 * 1024 * 1024;
var cardState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  lines: [],
  result: null,
  error: null
};
var CARD_MAX_LINES = 300;
function startCardImport(root, options) {
  cardState.running = true;
  cardState.startedAt = (/* @__PURE__ */ new Date()).toISOString();
  cardState.finishedAt = null;
  cardState.lines = [];
  cardState.result = null;
  cardState.error = null;
  const push = (line) => {
    cardState.lines.push(String(line));
    if (cardState.lines.length > CARD_MAX_LINES) cardState.lines.shift();
  };
  void (async () => {
    try {
      const result = await importCardRecordings(root, options);
      cardState.result = result;
      if (result.failed > 0) {
        cardState.error = `${result.failed} \u4E2A\u6587\u4EF6\u5BFC\u5165\u5931\u8D25\uFF0C\u8BE6\u60C5\u770B\u65E5\u5FD7`;
      }
    } catch (error2) {
      cardState.error = error2 && error2.message ? error2.message : String(error2);
      push(`\u51FA\u9519\uFF1A${cardState.error}`);
    } finally {
      cardState.running = false;
      cardState.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
  })();
  return cardState.startedAt;
}
var syncState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  lastResult: null,
  lastError: null,
  /** 自动同步的调度句柄：timer 服务返回的 disposer。 */
  timerDispose: null,
  /** 上一轮开跑的时间戳，用于跳过重叠触发。 */
  lastAttemptAt: 0,
  // 面板最近一次「我在看」的心跳。仅前台运行模式下，超过
  // PANEL_VISIBLE_MS 没收到心跳就当作没人在看，不再自动同步。
  lastPanelSeenAt: 0
};
var SYNC_MIN_GAP_MS = 60 * 1e3;
var PANEL_VISIBLE_MS = 3 * 60 * 1e3;
var AUDIO_HOST_ALLOWLIST = ["biji.com", "umiwi.com", "luojilab.com", "trytalks.com"];
function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(text);
}
function sendHtml(res, status, html) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(html);
}
function readBody(req, cap) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > cap) {
        req.pause();
        rejectBody(Object.assign(new Error("request body too large"), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", (error2) => rejectBody(error2));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
  });
}
function readBufferBody(req, cap) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > cap) {
        req.pause();
        rejectBody(Object.assign(new Error("request body too large"), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", (error2) => rejectBody(error2));
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
  });
}
async function readJsonBody(req, cap = 256 * 1024) {
  const text = await readBody(req, cap);
  if (text.trim() === "") return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw Object.assign(new Error("body must be valid JSON"), { status: 400 });
  }
}
function sweepPending() {
  const now = Date.now();
  for (const [state, entry] of pendingAuthorizations) {
    if (now - entry.createdAt > AUTH_TTL_MS) pendingAuthorizations.delete(state);
  }
}
function fail2(res, error2) {
  const status = error2 && typeof error2.status === "number" ? error2.status : 500;
  const message = error2 && error2.message ? error2.message : "internal error";
  send(res, status, { error: message });
}
async function ensureAccessToken({ allowRefresh = true } = {}) {
  const auth = await readAuth();
  if (!auth) return null;
  const stillValid = auth.expiresAt > Date.now() + 6e4;
  if (stillValid) return auth.accessToken;
  if (!allowRefresh || !auth.refreshToken || !auth.clientId) return null;
  try {
    const renewed = await refreshToken({ clientId: auth.clientId, refreshToken: auth.refreshToken });
    const merged = {
      ...auth,
      ...renewed,
      refreshToken: renewed.refreshToken || auth.refreshToken,
      redirectUri: renewed.redirectUri || auth.redirectUri
    };
    await writeAuth(merged);
    return merged.accessToken;
  } catch {
    return null;
  }
}
async function openClient() {
  const token = await ensureAccessToken();
  if (!token) {
    throw Object.assign(new Error("\u5C1A\u672A\u767B\u5F55\u5F97\u5230\u5927\u8111\uFF08\u6216\u6388\u6743\u5DF2\u8FC7\u671F\uFF09\uFF0C\u5148\u5728\u9762\u677F\u91CC\u70B9\u300C\u767B\u5F55\u5E76\u5BFC\u5165\u300D"), { status: 401 });
  }
  const client = new McpClient(token);
  await client.initialize();
  return client;
}
var cloudClientFactory = null;
async function openCloudClient() {
  if (cloudClientFactory !== null) return cloudClientFactory();
  const cloud = await readCloud();
  const keyReady = cloud && cloud.apiKey !== "" && cloud.clientId !== "";
  const token = await ensureAccessToken();
  if (keyReady && !openApiRejected) {
    const openapi = createClient({ apiKey: cloud.apiKey, clientId: cloud.clientId, grantId: cloud.grantId, fetchImpl: netFetch });
    if (!token) return openapi;
    return guardOpenApi(openapi, () => createMcpCloudClient({ accessToken: token }));
  }
  if (token) return createMcpCloudClient({ accessToken: token });
  if (keyReady) {
    return createClient({ apiKey: cloud.apiKey, clientId: cloud.clientId, grantId: cloud.grantId, fetchImpl: netFetch });
  }
  throw Object.assign(
    new Error("\u8FD8\u6CA1\u6709\u63A5\u5165\u5F97\u5230\u5927\u8111\u3002\u6700\u7701\u4E8B\u7684\u662F\u53BB\u300C\u540C\u6B65\u300D\u9875\u70B9\u300C\u767B\u5F55\u5F97\u5230\u5927\u8111\u300D\uFF08\u4E00\u6B21\u6388\u6743\uFF0C\u4E4B\u540E\u81EA\u52A8\u540C\u6B65\uFF09\uFF1B\u4E5F\u53EF\u4EE5\u5728\u300C\u8BBE\u7F6E \u2192 \u4E91\u7AEF\u63A5\u5165\u300D\u586B API Key \u4E0E Client ID\uFF08\u5728 openapi.biji.com \u63A7\u5236\u53F0\u521B\u5EFA\uFF09\u3002"),
    { status: 401, reason: "no_credentials" }
  );
}
var lastKeyError = null;
var openApiRejected = false;
function resetKeyRejection() {
  openApiRejected = false;
  lastKeyError = null;
}
function guardOpenApi(openapi, makeFallback) {
  const state = { client: openapi, decided: false, fallbackMade: false };
  const wrap = (name) => async (...args) => {
    if (state.decided) return state.client[name](...args);
    try {
      const result = await state.client[name](...args);
      state.decided = true;
      return result;
    } catch (error2) {
      const denied = error2 && (error2.status === 401 || error2.reason === "invalid_api_key");
      if (!denied) {
        state.decided = true;
        throw error2;
      }
      openApiRejected = true;
      lastKeyError = error2.message || "API Key \u88AB\u62D2\u7EDD";
      if (!state.fallbackMade) {
        state.fallbackMade = true;
        state.client = makeFallback();
      }
      state.decided = true;
      return state.client[name](...args);
    }
  };
  const out = { transport: "openapi" };
  for (const name of ["listNotes", "getNote", "listRecorderNotes", "getRecorderNote", "createNote", "updateNote", "deleteNote", "taskProgress", "addTags", "deleteTag", "listTopics", "createTopic", "listTopicNotes", "browseTopic", "addNotesToTopic", "removeNotesFromTopic", "recall", "recallInTopic", "createShareLink", "getTranscript", "getChapters", "getTimeline", "getTodos", "getAttachments", "getQuota", "tool", "request", "headers"]) {
    if (typeof openapi[name] === "function") out[name] = wrap(name);
    else if (openapi[name] !== void 0) out[name] = openapi[name];
  }
  return out;
}
async function cloudReadiness() {
  const cloud = await readCloud();
  const keyReady = cloud && cloud.apiKey !== "" && cloud.clientId !== "";
  const auth = await readAuth();
  const tokenAlive = !!auth && typeof auth.expiresAt === "number" && auth.expiresAt > Date.now() + 6e4;
  const canRefresh = !!auth && !!auth.refreshToken && !!auth.clientId;
  const loginReady = tokenAlive || canRefresh;
  if (keyReady) {
    const rejected = lastKeyError !== null;
    return {
      configured: true,
      // transport = 用户配置的通道；effective = 实际在用的通道。
      // Key 被拒后 guardOpenApi 会静默换到 MCP，面板要能看出这个差别。
      transport: "openapi",
      effectiveTransport: rejected && loginReady ? "mcp" : "openapi",
      apiKeyMasked: maskSecret(cloud.apiKey),
      clientIdMasked: maskSecret(cloud.clientId),
      hasGrantId: cloud.grantId !== "",
      savedAt: cloud.savedAt || null,
      // Key 填了但被服务端拒过：面板要能把这句话显示出来，否则用户只会看到「接入成功」却满屏报错
      keyRejected: rejected,
      keyError: lastKeyError,
      fallbackAvailable: loginReady
    };
  }
  if (loginReady) {
    return { configured: true, transport: "mcp", effectiveTransport: "mcp", apiKeyMasked: null, clientIdMasked: null, hasGrantId: false, savedAt: auth.obtainedAt || null, viaLogin: true, tokenAlive, keyRejected: false, keyError: null, fallbackAvailable: false };
  }
  return { configured: false, transport: null, effectiveTransport: null, apiKeyMasked: null, clientIdMasked: null, hasGrantId: false, savedAt: null, keyRejected: false, keyError: null, fallbackAvailable: false };
}
function createHandler(config) {
  const writeJournal = /* @__PURE__ */ new Map();
  const WRITE_JOURNAL_MAX = 80;
  function requestIdOf(req, body) {
    const header = req.headers["x-getnote-request-id"];
    if (typeof header === "string" && header !== "") return header.slice(0, 120);
    if (body !== null && typeof body === "object" && typeof body.requestId === "string") {
      return body.requestId.slice(0, 120);
    }
    return "";
  }
  async function once2(requestId2, run) {
    if (requestId2 === "") return await run();
    const hit = writeJournal.get(requestId2);
    if (hit !== void 0) return { ...hit, replay: true };
    const result = await run();
    writeJournal.set(requestId2, result);
    if (writeJournal.size > WRITE_JOURNAL_MAX) {
      const oldest = writeJournal.keys().next();
      if (!oldest.done) writeJournal.delete(oldest.value);
    }
    return result;
  }
  async function currentRoot() {
    const settings = await readSettings();
    const configured = settings.vaultRoot || config.vaultPath || null;
    return { ...await resolveVaultRoot(configured), settings };
  }
  async function handleStatus(res) {
    const { root, missing, settings } = await currentRoot();
    let entries = [];
    let errors = [];
    let truncated = false;
    if (!missing) {
      try {
        const scan = await scanVault(root);
        entries = scan.entries;
        errors = scan.errors;
        truncated = scan.truncated;
      } catch (error2) {
        errors = [{ path: ".", message: String(error2 && error2.message ? error2.message : error2) }];
      }
    }
    const stats = await vaultStats(root, entries);
    const auth = await readAuth();
    const syncLog = await readSyncState();
    const readiness = await cloudReadiness();
    let suggestions = [];
    if (entries.length === 0 && !settings.vaultRoot) {
      for (const candidate of knownVaultCandidates()) {
        try {
          const st = await stat2(candidate);
          if (!st.isDirectory()) continue;
          const scan = await scanVault(candidate);
          if (scan.entries.length > 0) suggestions.push({ path: candidate, notes: scan.entries.length });
        } catch {
        }
      }
    }
    const trashItems = missing ? [] : await listTrash(root);
    let conflictCount = 0;
    if (!missing) {
      try {
        const all = await listConflicts(root);
        conflictCount = all.filter((item) => item.resolved !== true).length;
      } catch {
        conflictCount = 0;
      }
    }
    send(res, 200, {
      vaultRoot: root,
      vaultMissing: missing,
      settingsPath: settingsPath(),
      authPath: authPath(),
      notes: stats.notes,
      dirs: stats.dirs,
      bytes: stats.bytes,
      lastSyncAt: settings.lastSyncAt,
      // 面板主题色（null = 内置蓝）。放 status 里而不是单独开一个路由：
      // 面板每次刷新都要它，多一次请求只会让首屏闪一下默认色。
      themeColor: settings.themeColor,
      // 界面语言（null = 自动跟随宿主）。同样放 status：面板首屏就要定稿文案，
      // 晚一拍拿到的语言会让界面先中文后英文闪一下。
      uiLocale: settings.uiLocale,
      // 库内相对路径。面板首屏就要拿它拼 wiki 链接的跳转目标（库里是
      // 「得到大脑/随手记/a.md」，而 status.vaultRoot 是绝对路径）。
      subfolder: getRuntime().subfolder,
      // 跟着宿主切换笔记：面板首屏就要知道这个开关是开是关——设置页那张卡的
      // 勾选状态来自这里，晚一拍拿到会让勾选框先空着再自己勾上。
      followActive: settings.followActive === true,
      // 自定义笔记模板。跟 status 一起发：点「+」时菜单要立刻列出模板，
      // 再多一次请求会让菜单先空着再长出几项。
      templates: settings.templates,
      truncated,
      errors,
      suggestions,
      // 写作热力图。跟 status 一起发，是因为面板首屏就要画它——单独一个路由
      // 会让热力图在首屏之后才「啪」地出现，看起来像加载失败重试。
      // 26 周 = 半年，格子数 182，JSON 也就几 KB，不值得再拆。
      heatmap: missing ? null : heatmapOf(entries, { weeks: 26 }),
      // 云端通道状态：configured 表示「现在点一下就能用」，transport 说明走哪条路
      api: {
        configured: readiness.configured,
        transport: readiness.transport,
        effectiveTransport: readiness.effectiveTransport || readiness.transport,
        viaLogin: readiness.viaLogin === true,
        apiKeyMasked: readiness.apiKeyMasked || "",
        clientIdMasked: readiness.clientIdMasked || "",
        hasGrantId: readiness.hasGrantId === true,
        // 填了 Key 但服务端拒过：一定要报出来，否则用户看到「已接入」却满屏失败
        keyRejected: readiness.keyRejected === true,
        keyError: readiness.keyError || null,
        fallbackAvailable: readiness.fallbackAvailable === true,
        credentialsPath: cloudPath(),
        statePath: syncStatePath(),
        trackedNotes: Object.keys(syncLog.notes).length,
        lastRunAt: syncLog.lastRunAt
      },
      autoSync: {
        enabled: settings.autoSync,
        minutes: settings.autoSyncMinutes,
        incremental: settings.autoSyncIncremental,
        foregroundOnly: settings.autoSyncForegroundOnly,
        panelVisible: Date.now() - (syncState.lastPanelSeenAt || 0) <= PANEL_VISIBLE_MS,
        running: syncState.running,
        startedAt: syncState.startedAt,
        finishedAt: syncState.finishedAt,
        lastError: syncState.lastError,
        lastResult: syncState.lastResult
      },
      // 旧的 OAuth 通道：保留只是为了兼容历史一次性导入，新功能不用它
      cloud: {
        loggedIn: auth !== null,
        expiresAt: auth ? auth.expiresAt : null,
        expired: auth ? auth.expiresAt <= Date.now() : false,
        issuer: ISSUER
      },
      // 回收站条数：面板要在「笔记」页签上直接显示「回收站 N」，用户才知道有东西可救。
      trash: trashItems.length,
      // 冲突留档条数：同步页的「冲突」入口靠它显示待处理数量
      conflicts: conflictCount
    });
  }
  async function handleTree(res) {
    const { root, missing } = await currentRoot();
    if (missing) return send(res, 200, { root, tree: { name: "", path: "", kind: "dir", children: [], count: 0 }, entries: [] });
    const { entries, errors, truncated } = await scanVault(root);
    send(res, 200, { root, tree: buildTree(entries), entries, dirs: listDirs(entries), errors, truncated });
  }
  async function handleList(res, url) {
    const { root, missing } = await currentRoot();
    if (missing) return send(res, 200, { entries: [], total: 0 });
    const { entries } = await scanVault(root);
    const q4 = (url.searchParams.get("q") || "").trim().toLowerCase();
    const dir = url.searchParams.get("dir") || "";
    const tag = (url.searchParams.get("tag") || "").trim();
    let filtered = entries;
    if (dir !== "") filtered = filtered.filter((e3) => e3.dir === dir || e3.path.startsWith(`${dir}/`));
    if (tag !== "") filtered = filtered.filter((e3) => e3.tags.some((t4) => t4 === tag));
    if (q4 !== "") {
      filtered = filtered.filter(
        (e3) => e3.title.toLowerCase().includes(q4) || e3.path.toLowerCase().includes(q4) || (e3.excerpt || "").toLowerCase().includes(q4) || e3.tags.some((t4) => t4.toLowerCase().includes(q4))
      );
    }
    const limit = Math.min(Number(url.searchParams.get("limit")) || 300, 2e3);
    send(res, 200, { entries: filtered.slice(0, limit), total: filtered.length });
  }
  async function handleRead(res, url) {
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const path = url.searchParams.get("path") || "";
    const note = await readNote(root, path);
    let assets = [];
    try {
      const noteId = note.frontmatter && note.frontmatter.note_id ? note.frontmatter.note_id : "";
      assets = await listAssets(root, note.path, noteId);
    } catch {
    }
    let outline = [];
    let links = [];
    try {
      outline = outlineOf(note.body !== void 0 && note.body !== null ? note.body : note.content);
      links = extractWikiLinks(note.content);
    } catch {
    }
    send(res, 200, { ...note, assets, outline, links });
  }
  async function handleBacklinks(res, url) {
    const { root, missing } = await currentRoot();
    const target = url.searchParams.get("path") || "";
    if (missing) return send(res, 200, { target, hits: [] });
    const result = await findBacklinks(root, target);
    send(res, 200, result);
  }
  async function handleBrokenLinks(res) {
    const { root, missing } = await currentRoot();
    if (missing) return send(res, 200, { hits: [], scanned: 0, truncated: false });
    const result = await findBrokenLinks(root);
    send(res, 200, result);
  }
  async function handleOpenTodos(res) {
    const { root, missing } = await currentRoot();
    if (missing) return send(res, 200, { items: [], scanned: 0, truncated: false });
    send(res, 200, await listOpenTodos(root));
  }
  async function handleConflictList(res) {
    const { root, missing } = await currentRoot();
    if (missing) return send(res, 200, { items: [], count: 0, pending: 0, resolved: 0 });
    const items = await listConflicts(root);
    const pending = items.filter((item) => item.resolved !== true).length;
    send(res, 200, { items, count: items.length, pending, resolved: items.length - pending });
  }
  async function handleConflictRead(res, url) {
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const path = url.searchParams.get("path") || "";
    const detail = await readConflict(root, path);
    let local = null;
    if (detail.candidates.length > 0) {
      try {
        const note = await readNote(root, detail.candidates[0].path);
        local = { path: note.path, content: note.content, title: note.title, body: note.body };
      } catch {
        local = null;
      }
    }
    send(res, 200, { ...detail, local });
  }
  async function handleConflictResolve(req, res) {
    const body = await readJsonBody(req);
    const path = String(body.path || "").trim();
    if (path === "") throw Object.assign(new Error("\u9700\u8981 path"), { status: 400 });
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const keepLocal = body.keepLocal === true;
    const snapshot = keepLocal ? null : async (rel) => {
      try {
        await snapshotNote(root, rel);
      } catch {
      }
    };
    const result = await resolveConflict(root, path, { keepLocal, snapshot });
    send(res, 200, { ok: true, ...result });
  }
  async function handleConflictUnresolve(req, res) {
    const body = await readJsonBody(req);
    const path = String(body.path || "").trim();
    if (path === "") throw Object.assign(new Error("\u9700\u8981 path"), { status: 400 });
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const result = await unresolveConflict(root, path);
    send(res, 200, { ok: true, ...result });
  }
  async function handleCreateDir(req, res) {
    const body = await readJsonBody(req);
    const dir = String(body.dir || body.path || "").trim();
    if (dir === "") throw Object.assign(new Error("\u76EE\u5F55\u540D\u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const result = await createDir(root, dir);
    send(res, 200, { ok: true, empty: true, ...result });
  }
  async function handleRenameDir(req, res) {
    const body = await readJsonBody(req);
    const from = String(body.from || body.dir || body.path || "").trim();
    const to = String(body.to || body.name || "").trim();
    if (from === "") throw Object.assign(new Error("\u9700\u8981 from\uFF08\u539F\u76EE\u5F55\u8DEF\u5F84\uFF09"), { status: 400 });
    if (to === "") throw Object.assign(new Error("\u65B0\u76EE\u5F55\u540D\u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const result = await renameDir(root, from, to);
    send(res, 200, { ok: true, ...result });
  }
  async function handleDeleteDir(req, res) {
    const body = await readJsonBody(req);
    const dir = String(body.dir || body.path || "").trim();
    if (dir === "") throw Object.assign(new Error("\u9700\u8981 dir"), { status: 400 });
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const result = await removeDir(root, dir);
    send(res, 200, { ok: true, ...result });
  }
  async function handleDeleteTag(req, res) {
    const body = await readJsonBody(req);
    const tag = String(body.tag || "").trim();
    if (tag === "") throw Object.assign(new Error("\u9700\u8981 tag"), { status: 400 });
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const { entries } = await scanVault(root);
    const result = await removeTag(root, tag, entries, {
      snapshot: async (rel) => {
        await snapshotNote(root, rel);
      }
    });
    send(res, 200, result);
  }
  async function handleRenameTag(req, res) {
    const body = await readJsonBody(req);
    const from = String(body.from || body.tag || "").trim();
    const to = String(body.to || body.name || "").trim();
    if (from === "") throw Object.assign(new Error("\u9700\u8981 from\uFF08\u539F\u6807\u7B7E\u540D\uFF09"), { status: 400 });
    if (to === "") throw Object.assign(new Error("\u65B0\u6807\u7B7E\u540D\u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const { entries } = await scanVault(root);
    const result = await renameTag(root, from, to, entries, {
      snapshot: async (rel) => {
        await snapshotNote(root, rel);
      }
    });
    send(res, 200, result);
  }
  async function handleToggleTodo(req, res) {
    const body = await readJsonBody(req);
    const path = String(body.path || "").trim();
    if (path === "") throw Object.assign(new Error("\u9700\u8981 path\uFF08\u7B14\u8BB0\u8DEF\u5F84\uFF09"), { status: 400 });
    const index = Number(body.index);
    if (!Number.isInteger(index) || index < 0) {
      throw Object.assign(new Error("\u9700\u8981 index\uFF08\u7B2C\u51E0\u4E2A\u5F85\u529E\uFF0C\u4ECE 0 \u5F00\u59CB\uFF09"), { status: 400 });
    }
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const result = await toggleTodo(root, path, index, {
      snapshot: async (rel) => {
        await snapshotNote(root, rel);
      }
    });
    send(res, 200, result);
  }
  async function handleHistoryList(res, url) {
    const { root, missing } = await currentRoot();
    const path = url.searchParams.get("path") || "";
    if (missing || path === "") return send(res, 200, { path, items: [], count: 0 });
    const items = await listHistory(root, path);
    send(res, 200, { path, items, count: items.length });
  }
  async function handleHistoryRead(res, url) {
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const path = url.searchParams.get("path") || "";
    const name = url.searchParams.get("name") || "";
    const entry = await readHistoryEntry(root, path, name);
    send(res, 200, entry);
  }
  async function handleHistoryRestore(req, res) {
    const body = await readJsonBody(req);
    const path = String(body.path || "").trim();
    const name = String(body.name || "").trim();
    if (path === "" || name === "") throw Object.assign(new Error("\u9700\u8981 path \u4E0E name"), { status: 400 });
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const result = await restoreHistoryEntry(root, path, name, { keepCurrent: body.keepCurrent !== false });
    send(res, 200, { ok: true, ...result });
  }
  async function handleArchiveExport(req, res, url) {
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const result = await exportVaultToZip(root, {
      scope: url?.searchParams.get("scope") || "all",
      dir: url?.searchParams.get("dir") || ""
    });
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    res.writeHead(200, {
      "content-type": "application/zip",
      "content-length": String(result.buffer.length),
      // 用 attachment 让浏览器直接落盘；文件名带时间戳，重复导出不会互相覆盖
      "content-disposition": `attachment; filename="getnote-vault-${stamp}.zip"; filename*=UTF-8''getnote-vault-${stamp}.zip`,
      "cache-control": "no-store",
      "x-getnote-entries": String(result.entries.length)
    });
    res.end(result.buffer);
  }
  async function handleArchiveInfo(res) {
    const { root, missing } = await currentRoot();
    if (missing) return send(res, 200, { notes: 0, bytes: 0, files: 0 });
    const { entries } = await scanVault(root);
    let bytes = 0;
    for (const entry of entries) bytes += entry.bytes || 0;
    let assetBytes = 0;
    let assetCount = 0;
    try {
      const dirs = /* @__PURE__ */ new Set();
      for (const entry of entries) {
        const dir = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";
        dirs.add(dir === "" ? "asset" : `${dir}/asset`);
      }
      for (const dir of dirs) {
        const { abs } = resolveInside(root, `${dir}/.`, { create: false });
        let names;
        try {
          names = await readdir2(abs);
        } catch {
          continue;
        }
        for (const name of names) {
          try {
            const st = await stat2((0, import_node_path6.join)(abs, name));
            if (st.isFile()) {
              assetBytes += st.size;
              assetCount += 1;
            }
          } catch {
          }
        }
      }
    } catch {
    }
    send(res, 200, { notes: entries.length, bytes, files: entries.length + assetCount, assetBytes, assetCount });
  }
  async function handleArchiveImport(req, res) {
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const buffer = await readBufferBody(req, 512 * 1024 * 1024);
    const mode = req.headers["x-getnote-import-mode"] === "skip" ? "skip" : "rename";
    const result = await importZipToVault(root, buffer, { mode });
    send(res, 200, { ok: true, ...result });
  }
  const assetCache = /* @__PURE__ */ new Map();
  const ASSET_CACHE_MAX = 24;
  const ASSET_CACHE_BYTES = 64 * 1024 * 1024;
  let assetCacheBytes = 0;
  async function readAssetCached(abs, st) {
    const key = `${abs}\0${st.mtimeMs}\0${st.size}`;
    const hit = assetCache.get(key);
    if (hit !== void 0) {
      assetCache.delete(key);
      assetCache.set(key, hit);
      return hit;
    }
    const buffer = await readFile2(abs);
    if (buffer.length <= ASSET_CACHE_BYTES) {
      assetCache.set(key, buffer);
      assetCacheBytes += buffer.length;
      while (assetCache.size > ASSET_CACHE_MAX || assetCacheBytes > ASSET_CACHE_BYTES) {
        const oldest = assetCache.keys().next();
        if (oldest.done === true) break;
        const evicted = assetCache.get(oldest.value);
        assetCache.delete(oldest.value);
        assetCacheBytes -= evicted === void 0 ? 0 : evicted.length;
      }
    }
    return buffer;
  }
  async function handleAsset(req, res, url) {
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const rel = url.searchParams.get("path") || "";
    if (rel === "") throw Object.assign(new Error("path \u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    const lower = rel.toLowerCase();
    const type = /\.(mp3)$/.test(lower) ? "audio/mpeg" : /\.(ogg)$/.test(lower) ? "audio/ogg" : /\.(m4a|aac)$/.test(lower) ? "audio/mp4" : /\.(wav)$/.test(lower) ? "audio/wav" : /\.(flac)$/.test(lower) ? "audio/flac" : /\.(png)$/.test(lower) ? "image/png" : /\.(jpe?g)$/.test(lower) ? "image/jpeg" : /\.(gif)$/.test(lower) ? "image/gif" : /\.(webp)$/.test(lower) ? "image/webp" : /\.(md)$/.test(lower) ? "text/markdown; charset=utf-8" : null;
    if (type === null) throw Object.assign(new Error("\u4E0D\u652F\u6301\u7684\u6587\u4EF6\u7C7B\u578B"), { status: 400 });
    const { abs } = resolveInside(root, rel);
    const st = await stat2(abs);
    if (!st.isFile()) throw Object.assign(new Error("\u4E0D\u662F\u6587\u4EF6"), { status: 400 });
    const headers = {
      "content-type": type,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=60"
    };
    const range = req.headers.range;
    if (typeof range === "string" && /^bytes=\d*-\d*$/.test(range)) {
      const [, startText, endText] = /^bytes=(\d*)-(\d*)$/.exec(range);
      let start = startText === "" ? null : Number(startText);
      let end = endText === "" ? null : Number(endText);
      if (start === null && end !== null) {
        start = Math.max(0, st.size - end);
        end = st.size - 1;
      }
      if (start !== null) {
        if (end === null || end >= st.size) end = st.size - 1;
        if (start > end || start >= st.size) {
          res.writeHead(416, { "content-range": `bytes */${st.size}` });
          return res.end();
        }
        headers["content-range"] = `bytes ${start}-${end}/${st.size}`;
        headers["content-length"] = String(end - start + 1);
        res.writeHead(206, headers);
        const whole = await readAssetCached(abs, st);
        return res.end(whole.subarray(start, end + 1));
      }
    }
    headers["content-length"] = String(st.size);
    res.writeHead(200, headers);
    return res.end(await readAssetCached(abs, st));
  }
  async function handleAssetUpload(req, res, url) {
    const { root } = await currentRoot();
    const note = url.searchParams.get("path") || "";
    if (note === "") throw Object.assign(new Error("path \u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    const header = req.headers["x-getnote-filename"];
    const name = typeof header === "string" ? decodeURIComponent(header) : "";
    if (name === "") throw Object.assign(new Error("\u6587\u4EF6\u540D\u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    const data = await readBufferBody(req, MAX_UPLOAD);
    if (data.length === 0) throw Object.assign(new Error("\u6587\u4EF6\u662F\u7A7A\u7684"), { status: 400 });
    const saved = await saveAsset(root, note, name, data);
    return send(res, 200, { ok: true, ...saved });
  }
  async function handleSave(req, res) {
    const body = await readJsonBody(req, MAX_BODY);
    const { root } = await currentRoot();
    const path = typeof body.path === "string" ? body.path : "";
    const content = typeof body.content === "string" ? body.content : "";
    if (path === "") throw Object.assign(new Error("path \u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    try {
      const before = await readNote(root, path);
      if (before.content === content) {
        return send(res, 200, { ok: true, path, unchanged: true });
      }
    } catch {
    }
    try {
      await snapshotNote(root, path);
    } catch {
    }
    const saved = await writeNote(root, path, content, { backup: false });
    send(res, 200, { ok: true, ...saved });
  }
  async function handleBatch(req, res) {
    const body = await readJsonBody(req, MAX_BODY);
    const action = String(body.action || "");
    const paths = Array.isArray(body.paths) ? body.paths.filter((p3) => typeof p3 === "string" && p3 !== "") : [];
    if (paths.length === 0) throw Object.assign(new Error("\u9700\u8981 paths"), { status: 400 });
    if (action !== "tag" && action !== "untag" && action !== "move" && action !== "delete") {
      throw Object.assign(new Error("action \u53EA\u80FD\u662F tag / untag / move / delete"), { status: 400 });
    }
    const tag = typeof body.tag === "string" ? body.tag.trim() : "";
    const dir = typeof body.dir === "string" ? body.dir.trim() : "";
    if ((action === "tag" || action === "untag") && tag === "") throw Object.assign(new Error("\u9700\u8981 tag"), { status: 400 });
    if (action === "move" && dir === "") throw Object.assign(new Error("\u9700\u8981 dir"), { status: 400 });
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    let changed = 0;
    const failed = [];
    const moved = [];
    for (const path of paths) {
      try {
        if (action === "delete") {
          try {
            await snapshotNote(root, path);
          } catch {
          }
          await trashNote(root, path);
          changed += 1;
          continue;
        }
        const note = await readNote(root, path);
        if (action === "tag") {
          const meta = note.frontmatter || {};
          const text = note.content;
          const actual = readTags(text);
          const current = actual.length > 0 ? actual : normalizeTags(meta.tags);
          if (current.includes(tag)) {
            changed += 1;
            continue;
          }
          const updated = rewriteTags(text, [...current, tag]);
          try {
            await snapshotNote(root, path);
          } catch {
          }
          await writeNote(root, path, updated, { backup: false });
          changed += 1;
        } else if (action === "untag") {
          const meta = note.frontmatter || {};
          const text = note.content;
          const actual = readTags(text);
          const current = actual.length > 0 ? actual : normalizeTags(meta.tags);
          const inlineSet = new Set(extractInlineTags(note.body));
          const base = current.filter((item) => !inlineSet.has(item));
          const withHead = rewriteTags(text, base.filter((item) => item !== tag));
          const updated = applyInlineTagEdit(withHead, tag, "");
          if (updated === text) {
            changed += 1;
            continue;
          }
          try {
            await snapshotNote(root, path);
          } catch {
          }
          await writeNote(root, path, updated, { backup: false });
          changed += 1;
        } else {
          const base = path.split("/").pop();
          if (dir + "/" + base === path) {
            changed += 1;
            continue;
          }
          const { abs: srcAbs } = resolveInside(root, path);
          let finalName = base;
          let targetAbs = resolveInside(root, `${dir}/${base}`, { create: true }).abs;
          await mkdir2((0, import_node_path6.dirname)(targetAbs), { recursive: true });
          let suffix = 2;
          for (; ; ) {
            try {
              await access2(targetAbs);
              finalName = base.replace(/(\.md)$/i, `-${suffix}$1`);
              targetAbs = resolveInside(root, `${dir}/${finalName}`, { create: true }).abs;
              suffix += 1;
            } catch {
              break;
            }
          }
          await rename2(srcAbs, targetAbs);
          moved.push({ from: path, to: `${dir}/${finalName}` });
          changed += 1;
        }
      } catch (err) {
        failed.push({ path, error: err && err.message ? err.message : String(err) });
      }
    }
    send(res, 200, { ok: true, changed, failed, moved, total: paths.length });
  }
  async function handleCreate(req, res) {
    const body = await readJsonBody(req, MAX_BODY);
    const { root } = await currentRoot();
    const created = await once2(
      requestIdOf(req, body),
      () => createNote(root, {
        dir: typeof body.dir === "string" ? body.dir : "",
        title: typeof body.title === "string" ? body.title : "",
        content: typeof body.content === "string" ? body.content : "",
        date: typeof body.date === "string" ? body.date : void 0,
        // 日记这类「名字本身就是日期」的笔记不该再被加一遍日期前缀，
        // 否则宿主的日记插件和我们都认不出这是同一天。
        withDatePrefix: body.withDatePrefix !== false
      })
    );
    send(res, 200, { ok: true, ...created });
  }
  async function handleDelete(req, res) {
    const body = await readJsonBody(req);
    const { root } = await currentRoot();
    const path = typeof body.path === "string" ? body.path : "";
    if (path === "") throw Object.assign(new Error("path \u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    try {
      await snapshotNote(root, path);
    } catch {
    }
    const result = await trashNote(root, path);
    send(res, 200, { ok: true, ...result });
  }
  async function handleTrashList(res) {
    const { root, missing } = await currentRoot();
    if (missing) return send(res, 200, { items: [], vaultMissing: true });
    const items = await listTrash(root);
    send(res, 200, { items, count: items.length });
  }
  async function handleTrashRestore(req, res) {
    const body = await readJsonBody(req);
    const { root } = await currentRoot();
    const path = typeof body.path === "string" ? body.path.trim() : "";
    if (path === "") throw Object.assign(new Error("path \u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    const target = typeof body.target === "string" ? body.target : "";
    const result = await restoreNote(root, path, target);
    send(res, 200, { ok: true, ...result });
  }
  async function handleTrashPurge(req, res) {
    const body = await readJsonBody(req);
    const { root } = await currentRoot();
    const path = typeof body.path === "string" ? body.path.trim() : "";
    const result = await purgeTrash(root, path);
    send(res, 200, { ok: true, ...result });
  }
  async function handleSearch(res, url) {
    const { root, missing } = await currentRoot();
    const q4 = url.searchParams.get("q") || "";
    if (missing) return send(res, 200, { query: q4, hits: [], scanned: 0, truncated: false });
    const result = await searchNotes(root, q4, { limit: Math.min(Number(url.searchParams.get("limit")) || 60, 300) });
    send(res, 200, result);
  }
  async function handleSyncPullOne(req, res) {
    const body = await readJsonBody(req);
    const path = String(body.path || "").trim();
    const noteId = String(body.noteId || "").trim();
    if (path === "" && noteId === "") {
      throw Object.assign(new Error("\u9700\u8981 path \u6216 noteId"), { status: 400 });
    }
    const settings = await readSettings();
    const { root, missing } = await resolveVaultRoot(settings.vaultRoot || config.vaultPath || null);
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const client = await openCloudClient();
    const state = await readSyncState();
    const id = noteId !== "" ? noteId : await noteIdOfPath(root, path, state);
    if (id === "") throw Object.assign(new Error("\u8FD9\u7BC7\u7B14\u8BB0\u6CA1\u6709 note_id\uFF0C\u65E0\u4ECE\u5237\u65B0"), { status: 400 });
    const outcome = await syncSingleNote({ client, root, state, noteId: id });
    await writeSyncState(state);
    let note = null;
    try {
      note = await readNote(root, outcome.path || path);
    } catch {
      note = null;
    }
    send(res, 200, { ok: true, outcome, note, noteId: id });
  }
  async function handleSyncPushOne(req, res) {
    const body = await readJsonBody(req);
    const path = String(body.path || "").trim();
    if (path === "") throw Object.assign(new Error("\u9700\u8981 path"), { status: 400 });
    const settings = await readSettings();
    const { root, missing } = await resolveVaultRoot(settings.vaultRoot || config.vaultPath || null);
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const client = await openCloudClient();
    const result = await pushNote({ client, root, relPath: path });
    if (result.noteId) {
      const state = await readSyncState();
      const key = String(result.noteId);
      const prev = state.notes && state.notes[key] ? state.notes[key] : {};
      let localFp = prev.localFp;
      let cloudFp = prev.cloudFp;
      try {
        localFp = await localFingerprintOf(resolveInside(root, path).abs);
        const fresh = await client.getNote(key);
        if (fresh) cloudFp = contentFingerprint(fresh);
      } catch {
      }
      state.notes = state.notes || {};
      state.notes[key] = { ...prev, path, localFp, cloudFp };
      await writeSyncState(state);
    }
    send(res, 200, { ok: true, result });
  }
  async function handleSyncPushAll(req, res) {
    const body = await readJsonBody(req);
    if (syncState.running) throw Object.assign(new Error("\u6B63\u5728\u8DD1\u4E00\u8F6E\u540C\u6B65\uFF0C\u7B49\u5B83\u7ED3\u675F\u518D\u63A8"), { status: 409 });
    const dir = typeof body.dir === "string" ? body.dir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") : "";
    const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 500);
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const client = await openCloudClient();
    const scan = await scanVault(root);
    const state = await readSyncState();
    state.notes = state.notes && typeof state.notes === "object" ? state.notes : {};
    const idByPath = /* @__PURE__ */ new Map();
    for (const [id, record] of Object.entries(state.notes)) {
      if (record && typeof record.path === "string" && record.path !== "") idByPath.set(record.path, String(id));
    }
    const report = { pushed: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [], truncated: false, dir };
    const targets = scan.entries.filter((entry) => dir === "" || entry.path === dir || entry.path.startsWith(dir + "/"));
    for (const entry of targets) {
      if (report.pushed + report.failed >= limit) {
        report.truncated = true;
        break;
      }
      const noteId = idByPath.get(entry.path) || (entry.noteId ? String(entry.noteId) : "");
      let localFp = null;
      try {
        localFp = await localFingerprintOf(resolveInside(root, entry.path).abs);
      } catch {
        localFp = null;
      }
      const record = noteId !== "" ? state.notes[noteId] : null;
      if (record && localFp !== null && record.localFp === localFp) {
        report.skipped += 1;
        continue;
      }
      try {
        const result = await pushNote({ client, root, relPath: entry.path, noteId: noteId || void 0 });
        const key = String(result.noteId || "");
        if (result.action === "created") report.created += 1;
        else report.updated += 1;
        report.pushed += 1;
        if (key !== "") {
          let cloudFp;
          try {
            const fresh = await client.getNote(key);
            if (fresh) cloudFp = contentFingerprint(fresh);
          } catch {
            cloudFp = void 0;
          }
          state.notes[key] = { ...state.notes[key] || {}, path: entry.path, localFp: localFp || void 0, cloudFp };
        }
      } catch (error2) {
        report.failed += 1;
        report.errors.push({ path: entry.path, message: String(error2 && error2.message ? error2.message : error2) });
      }
    }
    if (report.pushed > 0) await writeSyncState(state);
    send(res, 200, { ok: true, ...report });
  }
  async function noteIdOfPath(root, path, state) {
    if (path === "") return "";
    const notes = state && state.notes ? state.notes : {};
    for (const [id, record] of Object.entries(notes)) {
      if (record && record.path === path) return String(id);
    }
    try {
      const note = await readNote(root, path);
      const fm = note.frontmatter || {};
      if (fm.note_id !== void 0 && fm.note_id !== null) return String(fm.note_id);
    } catch {
    }
    return "";
  }
  async function handleGetSettings(res) {
    const settings = await readSettings();
    const { root, missing } = await resolveVaultRoot(settings.vaultRoot || config.vaultPath || null);
    send(res, 200, { ...settings, vaultRoot: settings.vaultRoot, effectiveRoot: root, missing, subfolder: getRuntime().subfolder });
  }
  async function handleSetSettings(req, res) {
    const body = await readJsonBody(req);
    const patch = {};
    if (typeof body.vaultPath === "string") {
      const real = await setVaultRoot(body.vaultPath);
      patch.vaultRoot = real;
    }
    if (typeof body.syncImages === "boolean") patch.syncImages = body.syncImages;
    if ("themeColor" in body) patch.themeColor = body.themeColor;
    if ("uiLocale" in body) patch.uiLocale = body.uiLocale;
    if ("templates" in body) patch.templates = body.templates;
    if (typeof body.followActive === "boolean") patch.followActive = body.followActive;
    if (Object.keys(patch).length > 0) await updateSettings(patch);
    const settings = await readSettings();
    const { root } = await resolveVaultRoot(settings.vaultRoot || config.vaultPath || null);
    send(res, 200, { ok: true, ...settings, effectiveRoot: root });
  }
  function redirectUriFor(origin) {
    return `${origin}${ROUTE_PREFIX}/oauth/callback`;
  }
  async function handleAuthStart(req, res) {
    const origin = config.getOrigin();
    if (!origin) throw Object.assign(new Error("\u65E0\u6CD5\u786E\u5B9A DSH Web \u7684\u8BBF\u95EE\u5730\u5740"), { status: 503 });
    const redirectUri = redirectUriFor(origin);
    const registered = await readClient();
    const reusable = registered && registered.clientId && registered.redirectUri === redirectUri;
    let clientId = reusable ? registered.clientId : null;
    if (!clientId) {
      const created = await registerClient(redirectUri);
      clientId = created.clientId;
    }
    sweepPending();
    const state = createPkceState();
    const pkce = createPkce();
    pendingAuthorizations.set(state, { verifier: pkce.verifier, redirectUri, clientId, createdAt: Date.now() });
    const url = buildAuthorizeUrl({ clientId, redirectUri, state, challenge: pkce.challenge });
    send(res, 200, { ok: true, url, redirectUri });
  }
  async function handleAuthCallback(res, url) {
    const error2 = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") || "";
    const pending = pendingAuthorizations.get(state);
    pendingAuthorizations.delete(state);
    if (error2) return sendHtml(res, 400, callbackPage("\u6388\u6743\u88AB\u62D2\u7EDD", `\u5F97\u5230\u5927\u8111\u8FD4\u56DE\uFF1A${escapeHtml(error2)}`, false));
    if (!code) return sendHtml(res, 400, callbackPage("\u6388\u6743\u5931\u8D25", "\u56DE\u8C03\u91CC\u6CA1\u6709 code \u53C2\u6570\u3002", false));
    if (!pending) return sendHtml(res, 400, callbackPage("\u6388\u6743\u5DF2\u8FC7\u671F", "\u8FD9\u6B21\u767B\u5F55\u8BF7\u6C42\u5DF2\u8D85\u65F6\u6216\u88AB\u91CD\u590D\u4F7F\u7528\uFF0C\u8BF7\u56DE\u5230\u9762\u677F\u91CD\u65B0\u70B9\u300C\u767B\u5F55\u300D\u3002", false));
    try {
      const token = await exchangeCode({
        clientId: pending.clientId,
        code,
        redirectUri: pending.redirectUri,
        verifier: pending.verifier
      });
      await writeAuth({
        ...token,
        clientId: pending.clientId,
        redirectUri: pending.redirectUri
      });
      sendHtml(res, 200, callbackPage("\u5DF2\u8FDE\u63A5\u5F97\u5230\u5927\u8111", "\u56DE\u5230 DSH \u9762\u677F\u5373\u53EF\u5F00\u59CB\u5BFC\u5165\u7B14\u8BB0\u3002\u73B0\u5728\u5C31\u53EF\u4EE5\u5173\u6389\u8FD9\u4E2A\u9875\u9762\u3002", true));
    } catch (err) {
      sendHtml(res, 502, callbackPage("\u6362\u53D6\u4EE4\u724C\u5931\u8D25", escapeHtml(String(err && err.message ? err.message : err)), false));
    }
  }
  async function handleAuthStatus(res) {
    const auth = await readAuth();
    if (!auth) return send(res, 200, { loggedIn: false });
    const probe = await probeAccessToken(auth.accessToken);
    send(res, 200, {
      loggedIn: true,
      expiresAt: auth.expiresAt,
      expired: auth.expiresAt <= Date.now(),
      valid: probe.ok,
      serverInfo: probe.ok ? probe.serverInfo : null,
      error: probe.ok ? null : probe.error,
      hasRefreshToken: auth.refreshToken !== null
    });
  }
  async function handleLogout(res) {
    const auth = await readAuth();
    if (auth) await revokeToken(auth.accessToken);
    await clearAuth();
    send(res, 200, { ok: true });
  }
  async function handleImport(req, res) {
    const body = await readJsonBody(req);
    if (importState.running) {
      return send(res, 200, { ok: false, running: true, error: "\u5DF2\u6709\u4E00\u4E2A\u5BFC\u5165\u4EFB\u52A1\u5728\u8DD1\uFF0C\u7B49\u5B83\u7ED3\u675F\u518D\u8BD5" });
    }
    const { root } = await currentRoot();
    let client;
    try {
      client = await openClient();
    } catch (error2) {
      return send(res, error2.status === 401 ? 401 : 502, { ok: false, error: error2.message });
    }
    importState.running = true;
    importState.startedAt = (/* @__PURE__ */ new Date()).toISOString();
    importState.finishedAt = null;
    importState.lines = [];
    importState.result = null;
    importState.error = null;
    const push = (line) => {
      importState.lines.push({ at: (/* @__PURE__ */ new Date()).toISOString(), text: line });
      if (importState.lines.length > 500) importState.lines.shift();
    };
    void (async () => {
      try {
        const stats = await importAllNotes(client, root, {
          log: push,
          maxNotes: Number(body.maxNotes) > 0 ? Math.min(Number(body.maxNotes), 5e3) : void 0
        });
        await updateSettings({ lastSyncAt: (/* @__PURE__ */ new Date()).toISOString() });
        importState.result = { root, ...stats };
      } catch (error2) {
        importState.error = String(error2 && error2.message ? error2.message : error2);
        push(`\u5BFC\u5165\u4E2D\u65AD\uFF1A${importState.error}`);
      } finally {
        importState.running = false;
        importState.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
    })();
    send(res, 200, { ok: true, running: true, startedAt: importState.startedAt });
  }
  function handleImportStatus(res) {
    send(res, 200, {
      running: importState.running,
      startedAt: importState.startedAt,
      finishedAt: importState.finishedAt,
      lines: importState.lines,
      result: importState.result,
      error: importState.error
    });
  }
  async function handleProbe(req, res) {
    try {
      const client = await openClient();
      const tools = await client.listTools();
      let topics = null;
      try {
        topics = await client.callTool("list_topics", { page: 1, page_size: 50 });
      } catch {
      }
      send(res, 200, { ok: true, serverInfo: client.serverInfo, toolCount: tools.length, topics });
    } catch (error2) {
      send(res, 200, { ok: false, error: String(error2 && error2.message ? error2.message : error2) });
    }
  }
  async function handleSetCloud(req, res) {
    const body = await readJsonBody(req);
    const patch = {};
    if (typeof body.apiKey === "string") patch.apiKey = body.apiKey.trim();
    if (typeof body.clientId === "string") patch.clientId = body.clientId.trim();
    if (typeof body.grantId === "string") patch.grantId = body.grantId.trim();
    const current = await readCloud() || { apiKey: "", clientId: "", grantId: "" };
    const next = {
      apiKey: patch.apiKey !== void 0 ? patch.apiKey : current.apiKey,
      clientId: patch.clientId !== void 0 ? patch.clientId : current.clientId,
      grantId: patch.grantId !== void 0 ? patch.grantId : current.grantId
    };
    await writeCloud(next);
    resetKeyRejection();
    const saved = await readCloud();
    const ready = saved !== null && saved.apiKey !== "" && saved.clientId !== "";
    send(res, 200, {
      ok: true,
      ready,
      apiKeyMasked: saved ? maskSecret(saved.apiKey) : "",
      clientIdMasked: saved ? maskSecret(saved.clientId) : "",
      hasGrantId: Boolean(saved && saved.grantId),
      missing: ready ? [] : [!saved || saved.apiKey === "" ? "API Key" : null, !saved || saved.clientId === "" ? "Client ID" : null].filter(Boolean)
    });
  }
  async function handleClearCloud(res) {
    await clearCloud();
    resetKeyRejection();
    send(res, 200, { ok: true });
  }
  async function handleCloudProbe(res) {
    let client;
    try {
      client = await openCloudClient();
    } catch (error2) {
      return send(res, 200, { ok: false, configured: false, error: error2.message });
    }
    try {
      const page = await client.listNotes({ limit: 1 });
      send(res, 200, {
        ok: true,
        configured: true,
        reachable: true,
        sampleCount: page.notes.length,
        hasMore: page.hasMore
      });
    } catch (error2) {
      send(res, 200, {
        ok: false,
        configured: true,
        reachable: error2.status !== 502,
        status: error2.status ?? null,
        reason: error2.reason ?? null,
        requestId: error2.requestId ?? null,
        error: error2.message
      });
    }
  }
  async function handleCloudList(res, url) {
    const client = await openCloudClient();
    const cursor = url.searchParams.get("cursor") || void 0;
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 50);
    const page = await client.listNotes({ cursor, limit });
    send(res, 200, {
      notes: page.notes.map((n2) => normalizeNote(n2)).filter(Boolean),
      hasMore: page.hasMore,
      cursor: page.cursor,
      total: page.total
    });
  }
  async function handleCloudRead(res, url) {
    const client = await openCloudClient();
    const noteId = url.searchParams.get("id") || "";
    if (noteId === "") throw Object.assign(new Error("id \u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    const raw = await client.getNote(noteId);
    if (!raw) throw Object.assign(new Error("\u4E91\u7AEF\u6CA1\u6709\u8FD9\u7BC7\u7B14\u8BB0\uFF08\u53EF\u80FD\u5DF2\u88AB\u5220\u9664\uFF09"), { status: 404 });
    const state = await readSyncState();
    const record = state.notes[String(noteId)];
    send(res, 200, {
      note: normalizeNote(raw),
      raw,
      localPath: record && typeof record.path === "string" ? record.path : ""
    });
  }
  async function handleCloudCreate(req, res) {
    const body = await readJsonBody(req, MAX_BODY);
    const client = await openCloudClient();
    const created = await client.createNote({
      noteType: typeof body.noteType === "string" ? body.noteType : "plain_text",
      title: typeof body.title === "string" ? body.title : "",
      content: typeof body.content === "string" ? body.content : "",
      tags: Array.isArray(body.tags) ? body.tags.map(String) : void 0,
      topicId: typeof body.topicId === "string" && body.topicId !== "" ? body.topicId : void 0,
      clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : void 0
    });
    send(res, 200, { ok: true, ...created });
  }
  async function handleCloudUpdate(req, res) {
    const body = await readJsonBody(req, MAX_BODY);
    const client = await openCloudClient();
    const noteId = typeof body.noteId === "string" ? body.noteId : "";
    if (noteId === "") throw Object.assign(new Error("noteId \u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    await client.updateNote({
      noteId,
      title: typeof body.title === "string" ? body.title : void 0,
      content: typeof body.content === "string" ? body.content : void 0,
      tags: Array.isArray(body.tags) ? body.tags.map(String) : void 0
    });
    let local = null;
    try {
      local = await syncOne(noteId);
    } catch (error2) {
      local = { error: error2.message };
    }
    send(res, 200, { ok: true, local });
  }
  async function handleCloudDelete(req, res) {
    const body = await readJsonBody(req);
    const client = await openCloudClient();
    const noteId = typeof body.noteId === "string" ? body.noteId : "";
    if (noteId === "") throw Object.assign(new Error("noteId \u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    await client.deleteNote(noteId);
    let local = null;
    try {
      const state = await readSyncState();
      const rec = state.notes[noteId];
      if (rec && rec.path) {
        const { root } = await currentRoot();
        await trashNote(root, rec.path);
        delete state.notes[noteId];
        await writeSyncState(state);
        local = { trashed: rec.path };
      }
    } catch (error2) {
      local = { error: error2.message };
    }
    send(res, 200, { ok: true, local });
  }
  async function handleCloudTagsAdd(req, res) {
    const body = await readJsonBody(req);
    const client = await openCloudClient();
    const noteId = typeof body.noteId === "string" ? body.noteId : "";
    const tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
    if (noteId === "" || tags.length === 0) throw Object.assign(new Error("noteId \u4E0E tags \u90FD\u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    await client.addTags(noteId, tags);
    send(res, 200, { ok: true });
  }
  async function handleCloudTagsDelete(req, res) {
    const body = await readJsonBody(req);
    const client = await openCloudClient();
    const noteId = typeof body.noteId === "string" ? body.noteId : "";
    const tagId = typeof body.tagId === "string" ? body.tagId : "";
    if (noteId === "" || tagId === "") throw Object.assign(new Error("noteId \u4E0E tagId \u90FD\u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    await client.deleteTag(noteId, tagId);
    send(res, 200, { ok: true });
  }
  async function handleCloudTopics(res, url) {
    const client = await openCloudClient();
    const page = Number(url.searchParams.get("page")) || 1;
    const result = await client.listTopics(page);
    send(res, 200, result);
  }
  async function handleCloudTopicNotes(res, url) {
    const client = await openCloudClient();
    const topicId = url.searchParams.get("topicId") || "";
    if (topicId === "") throw Object.assign(new Error("topicId \u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    const page = Number(url.searchParams.get("page")) || 1;
    const result = await client.listTopicNotes({ topicId, page });
    send(res, 200, { ...result, notes: result.notes.map((n2) => normalizeNote(n2, { topicName: "" })).filter(Boolean) });
  }
  async function handleCloudRecall(req, res) {
    const body = await readJsonBody(req);
    const client = await openCloudClient();
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (query === "") throw Object.assign(new Error("query \u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    const topK = Number(body.topK) > 0 ? Math.min(Number(body.topK), 10) : 5;
    const results = body.topicId ? await client.recallInTopic({ topicId: body.topicId, query, topK }) : await client.recall(query, topK);
    send(res, 200, {
      query,
      results: results.map((r3) => {
        const n2 = normalizeNote(r3.note ?? r3, {});
        return n2 ? { ...n2, score: typeof r3.score === "number" ? r3.score : null } : null;
      }).filter(Boolean)
    });
  }
  async function handleCloudShare(req, res) {
    const body = await readJsonBody(req);
    const client = await openCloudClient();
    const noteId = typeof body.noteId === "string" ? body.noteId : "";
    if (noteId === "") throw Object.assign(new Error("noteId \u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    const url = await client.createShareLink({ noteId, excludeAudio: body.excludeAudio === true });
    send(res, 200, { ok: true, url });
  }
  async function handleAudioProxy(req, res, url) {
    const target = url.searchParams.get("url") || "";
    if (target === "") throw Object.assign(new Error("url \u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      throw Object.assign(new Error("url \u4E0D\u662F\u5408\u6CD5\u5730\u5740"), { status: 400 });
    }
    if (!/^https?:$/.test(parsed.protocol)) throw Object.assign(new Error("\u53EA\u652F\u6301 http/https"), { status: 400 });
    const host = parsed.hostname.toLowerCase();
    if (!AUDIO_HOST_ALLOWLIST.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
      throw Object.assign(new Error(`\u4E0D\u5141\u8BB8\u4EE3\u7406\u8FD9\u4E2A\u57DF\u540D\uFF1A${host}`), { status: 403 });
    }
    const range = req.headers.range;
    const upstream = await fetch(target, {
      headers: {
        // 支持 Range：音频拖动进度条要靠它，否则每次都要从头下整个文件
        ...typeof range === "string" ? { Range: range } : {},
        // 有些 CDN 要求带 Referer 才给音频
        Referer: "https://www.biji.com/",
        "User-Agent": "Mozilla/5.0 (dsh-getnote)"
      },
      redirect: "follow"
    });
    const headers = { "cache-control": "private, max-age=300", "accept-ranges": "bytes" };
    for (const key of ["content-type", "content-length", "content-range"]) {
      const v3 = upstream.headers.get(key);
      if (v3) headers[key] = v3;
    }
    if (!headers["content-type"]) headers["content-type"] = "audio/mpeg";
    res.writeHead(upstream.status, headers);
    if (!upstream.body) return res.end();
    try {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.end(buffer);
    } catch {
      res.end();
    }
  }
  async function performSync(opts = {}) {
    return performSyncImpl({ ...opts, config });
  }
  async function syncOne(noteId) {
    const client = await openCloudClient();
    const { root } = await currentRoot();
    const state = await readSyncState();
    const scan = await scanVault(root);
    const index = /* @__PURE__ */ new Map();
    for (const entry of scan.entries) {
      if (entry.noteId) index.set(String(entry.noteId), entry.path);
    }
    const result = await syncSingleNote({ client, root, state, noteId, index });
    if (result.note) {
      const notes = { ...state.notes, [noteId]: result.note };
      await writeSyncState({ notes, lastRunAt: (/* @__PURE__ */ new Date()).toISOString(), lastCursor: state.lastCursor });
    }
    return { path: result.path, action: result.action };
  }
  async function handleSyncStart(req, res) {
    const body = await readJsonBody(req);
    if (syncState.running) return send(res, 200, { ok: false, running: true, error: "\u5DF2\u7ECF\u6709\u4E00\u8F6E\u540C\u6B65\u5728\u8DD1\u4E86" });
    const full = body.full === true;
    try {
      await openCloudClient();
    } catch (error2) {
      return send(res, error2.status === 401 ? 401 : 502, { ok: false, error: error2.message });
    }
    void (async () => {
      const result = await performSync({ full, reason: "manual" });
      syncState.lastResult = { ...syncState.lastResult || {}, ...result.ok === false ? { failed: result.error } : {} };
    })();
    send(res, 200, { ok: true, running: true, startedAt: syncState.startedAt });
  }
  async function handleCardEnv(res) {
    const env = await checkCardEnvironment();
    return send(res, 200, { ok: true, ...env, running: cardState.running });
  }
  async function handleCardScan(res, url) {
    const timeout = Number(url.searchParams.get("timeout") || 8);
    const safeTimeout = Number.isFinite(timeout) ? Math.min(20, Math.max(4, Math.round(timeout))) : 8;
    const found = await scanCard(safeTimeout);
    return send(res, 200, { ok: true, ...found });
  }
  async function handleCardInfo(res) {
    const info = await cardInfo();
    return send(res, 200, { ok: true, ...info });
  }
  async function handleCardList(res) {
    const files = await listCardFiles();
    return send(res, 200, { ok: true, files, count: files.length });
  }
  function handleCardStatus(res) {
    return send(res, 200, {
      ok: true,
      running: cardState.running,
      startedAt: cardState.startedAt,
      finishedAt: cardState.finishedAt,
      lines: cardState.lines,
      result: cardState.result,
      error: cardState.error
    });
  }
  async function handleCardImport(req, res) {
    if (cardState.running) {
      return send(res, 200, {
        ok: false,
        running: true,
        error: "\u5DF2\u7ECF\u6709\u4E00\u4E2A\u5F55\u97F3\u5361\u5BFC\u5165\u5728\u8DD1\u4E86\uFF0C\u7B49\u5B83\u7ED3\u675F\u518D\u8BD5"
      });
    }
    const body = await readJsonBody(req);
    const settings = await readSettings();
    const { root, missing } = await resolveVaultRoot(settings.vaultRoot || config.vaultPath || null);
    if (missing || root === null) {
      throw Object.assign(new Error("\u7B14\u8BB0\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF0C\u5148\u53BB\u8BBE\u7F6E\u91CC\u9009\u4E00\u4E2A\u76EE\u5F55"), { status: 400 });
    }
    const env = await checkCardEnvironment();
    if (!env.ready) {
      throw Object.assign(
        new Error(
          env.error || "\u5F55\u97F3\u5361\u76F4\u8FDE\u9700\u8981 Python 3.10+ \u548C bleak\u3002\u88C5\u4E00\u4E0B\uFF1Apip install bleak"
        ),
        { status: 503, reason: "no-python" }
      );
    }
    const options = {
      all: body.all !== false,
      names: typeof body.names === "string" ? body.names : "",
      deleteAfter: body.deleteAfter === true,
      dir: typeof body.dir === "string" && body.dir.trim() !== "" ? body.dir.trim() : "\u5F55\u97F3\u5361"
    };
    const startedAt = startCardImport(root, options);
    return send(res, 200, { ok: true, running: true, startedAt });
  }
  async function handleCardDelete(req, res) {
    const body = await readJsonBody(req);
    if (typeof body.names !== "string" || body.names.trim() === "") {
      throw Object.assign(new Error("\u8981\u5220\u54EA\u4E2A\u6587\u4EF6\uFF1Fnames \u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    }
    const result = await deleteCardFiles(body.names);
    return send(res, 200, { ok: true, ...result });
  }
  async function handleCardWifiScan(res) {
    const result = await wifiScan();
    return send(res, 200, result);
  }
  async function handleCardWifiActivate(req, res) {
    const body = await readJsonBody(req);
    const cmd = typeof body.cmd === "string" && body.cmd.trim() !== "" ? body.cmd.trim() : null;
    const bodyHex = typeof body.body === "string" && body.body.trim() !== "" ? body.body.trim() : null;
    const join8 = body.join !== false;
    const keep = body.keep === true;
    const wait = Number.isFinite(Number(body.wait)) ? Number(body.wait) : 3;
    const result = await wifiActivate({ cmd, body: bodyHex, join: join8, keep, wait });
    return send(res, 200, result);
  }
  async function handleCardWifiJoin(req, res) {
    const body = await readJsonBody(req);
    const ssid = typeof body.ssid === "string" ? body.ssid.trim() : "";
    if (ssid === "") throw Object.assign(new Error("\u8981\u8FDE\u54EA\u4E2A\u70ED\u70B9\uFF1Fssid \u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    const password = typeof body.password === "string" && body.password !== "" ? body.password : null;
    const keep = body.keep === true;
    const timeout = Number.isFinite(Number(body.timeout)) ? Number(body.timeout) : 30;
    const result = await wifiJoin({ ssid, password, keep, timeout });
    return send(res, 200, result);
  }
  async function handleCardWifiLeave(req, res) {
    const result = await wifiLeave();
    return send(res, 200, result);
  }
  function handleSyncStatus(res) {
    send(res, 200, {
      running: syncState.running,
      startedAt: syncState.startedAt,
      finishedAt: syncState.finishedAt,
      lastResult: syncState.lastResult,
      lastError: syncState.lastError
    });
  }
  async function handleSyncPush(req, res) {
    const body = await readJsonBody(req, MAX_BODY);
    const client = await openCloudClient();
    const { root } = await currentRoot();
    const relPath = typeof body.path === "string" ? body.path : "";
    if (relPath === "") throw Object.assign(new Error("path \u4E0D\u80FD\u4E3A\u7A7A"), { status: 400 });
    const result = await pushNote({ client, root, relPath, noteId: typeof body.noteId === "string" ? body.noteId : void 0 });
    send(res, 200, { ok: true, ...result });
  }
  async function handleAutoSyncSettings(req, res) {
    const body = await readJsonBody(req);
    const patch = {};
    if (typeof body.enabled === "boolean") patch.autoSync = body.enabled;
    if (body.minutes !== void 0) patch.autoSyncMinutes = normalizeAutoSync({ autoSyncMinutes: body.minutes }).intervalMinutes;
    if (typeof body.incremental === "boolean") patch.autoSyncIncremental = body.incremental;
    if (typeof body.foregroundOnly === "boolean") patch.autoSyncForegroundOnly = body.foregroundOnly;
    if (body.ping === true) {
      syncState.lastPanelSeenAt = Date.now();
      return send(res, 200, { ok: true, pong: true, foregroundOnly: (await readSettings()).autoSyncForegroundOnly });
    }
    const settings = await updateSettings(patch);
    send(res, 200, {
      ok: true,
      enabled: settings.autoSync,
      minutes: settings.autoSyncMinutes,
      incremental: settings.autoSyncIncremental,
      foregroundOnly: settings.autoSyncForegroundOnly
    });
  }
  return async function handler(req, res) {
    let url;
    try {
      url = new URL(req.url ?? "/", "http://internal");
    } catch {
      return send(res, 400, { error: "bad url" });
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 0 || `/${parts[0]}` !== ROUTE_PREFIX) return send(res, 404, { error: "not found" });
    const action = parts[1] || "status";
    const method = (req.method || "GET").toUpperCase();
    try {
      if (action === "oauth" && parts[2] === "callback") {
        if (method !== "GET") return send(res, 405, { error: "method not allowed" });
        return await handleAuthCallback(res, url);
      }
      if (action === "oauth" && parts[2] === "start") return await handleAuthStart(req, res);
      if (action === "oauth" && parts[2] === "status") return await handleAuthStatus(res);
      if (action === "logout") return await handleLogout(res);
      if (action === "audio") {
        if (method !== "GET") return send(res, 405, { error: "method not allowed" });
        return await handleAudioProxy(req, res, url);
      }
      if (action === "asset" && parts[2] === "upload") {
        if (method !== "POST") return send(res, 405, { error: "method not allowed" });
        return await handleAssetUpload(req, res, url);
      }
      if (action === "asset") {
        if (method !== "GET") return send(res, 405, { error: "method not allowed" });
        return await handleAsset(req, res, url);
      }
      if (method === "GET") {
        if (action === "status") return await handleStatus(res);
        if (action === "tree") return await handleTree(res);
        if (action === "list") return await handleList(res, url);
        if (action === "trash" && parts[2] === "list") return await handleTrashList(res);
        if (action === "read") return await handleRead(res, url);
        if (action === "search") return await handleSearch(res, url);
        if (action === "backlinks") return await handleBacklinks(res, url);
        if (action === "broken") return await handleBrokenLinks(res);
        if (action === "todos") return await handleOpenTodos(res);
        if (action === "settings") return await handleGetSettings(res);
        if (action === "probe") return await handleProbe(req, res);
        if (action === "import" && parts[2] === "status") return handleImportStatus(res);
        if (action === "conflict" && parts[2] === "list") return await handleConflictList(res);
        if (action === "conflict" && parts[2] === "read") return await handleConflictRead(res, url);
        if (action === "history" && parts[2] === "list") return await handleHistoryList(res, url);
        if (action === "history" && parts[2] === "read") return await handleHistoryRead(res, url);
        if (action === "archive" && parts[2] === "export") return await handleArchiveExport(req, res, url);
        if (action === "archive" && parts[2] === "info") return await handleArchiveInfo(res);
        if (action === "api" && parts[2] === "probe") return await handleCloudProbe(res);
        if (action === "cloud" && parts[2] === "list") return await handleCloudList(res, url);
        if (action === "cloud" && parts[2] === "read") return await handleCloudRead(res, url);
        if (action === "cloud" && parts[2] === "topics") return await handleCloudTopics(res, url);
        if (action === "cloud" && parts[2] === "topic-notes") return await handleCloudTopicNotes(res, url);
        if (action === "sync" && parts[2] === "status") return handleSyncStatus(res);
        if (action === "card" && parts[2] === "env") return await handleCardEnv(res);
        if (action === "card" && parts[2] === "scan") return await handleCardScan(res, url);
        if (action === "card" && parts[2] === "info") return await handleCardInfo(res);
        if (action === "card" && parts[2] === "list") return await handleCardList(res);
        if (action === "card" && parts[2] === "status") return handleCardStatus(res);
        if (action === "card" && parts[2] === "wifi-scan") return await handleCardWifiScan(res);
      }
      if (method === "POST") {
        if (action === "save") return await handleSave(req, res);
        if (action === "batch") return await handleBatch(req, res);
        if (action === "create") return await handleCreate(req, res);
        if (action === "delete") return await handleDelete(req, res);
        if (action === "dir" && parts[2] === "create") return await handleCreateDir(req, res);
        if (action === "dir" && parts[2] === "delete") return await handleDeleteDir(req, res);
        if (action === "dir" && parts[2] === "rename") return await handleRenameDir(req, res);
        if (action === "tag" && parts[2] === "delete") return await handleDeleteTag(req, res);
        if (action === "tag" && parts[2] === "rename") return await handleRenameTag(req, res);
        if (action === "todo" && parts[2] === "toggle") return await handleToggleTodo(req, res);
        if (action === "trash" && parts[2] === "restore") return await handleTrashRestore(req, res);
        if (action === "trash" && parts[2] === "purge") return await handleTrashPurge(req, res);
        if (action === "settings") return await handleSetSettings(req, res);
        if (action === "import") return await handleImport(req, res);
        if (action === "conflict" && parts[2] === "resolve") return await handleConflictResolve(req, res);
        if (action === "conflict" && parts[2] === "unresolve") return await handleConflictUnresolve(req, res);
        if (action === "history" && parts[2] === "restore") return await handleHistoryRestore(req, res);
        if (action === "archive" && parts[2] === "import") return await handleArchiveImport(req, res);
        if (action === "card" && parts[2] === "import") return await handleCardImport(req, res);
        if (action === "card" && parts[2] === "delete") return await handleCardDelete(req, res);
        if (action === "card" && parts[2] === "wifi-activate") return await handleCardWifiActivate(req, res);
        if (action === "card" && parts[2] === "wifi-join") return await handleCardWifiJoin(req, res);
        if (action === "card" && parts[2] === "wifi-leave") return await handleCardWifiLeave(req, res);
        if (action === "sync" && parts[2] === "pull-one") return await handleSyncPullOne(req, res);
        if (action === "sync" && parts[2] === "push-one") return await handleSyncPushOne(req, res);
        if (action === "sync" && parts[2] === "push-all") return await handleSyncPushAll(req, res);
        if (action === "api" && parts[2] === "credentials") return await handleSetCloud(req, res);
        if (action === "api" && parts[2] === "clear") return await handleClearCloud(res);
        if (action === "cloud" && parts[2] === "create") return await handleCloudCreate(req, res);
        if (action === "cloud" && parts[2] === "update") return await handleCloudUpdate(req, res);
        if (action === "cloud" && parts[2] === "delete") return await handleCloudDelete(req, res);
        if (action === "cloud" && parts[2] === "tags-add") return await handleCloudTagsAdd(req, res);
        if (action === "cloud" && parts[2] === "tags-delete") return await handleCloudTagsDelete(req, res);
        if (action === "cloud" && parts[2] === "recall") return await handleCloudRecall(req, res);
        if (action === "cloud" && parts[2] === "share") return await handleCloudShare(req, res);
        if (action === "sync" && parts[2] === "start") return await handleSyncStart(req, res);
        if (action === "sync" && parts[2] === "push") return await handleSyncPush(req, res);
        if (action === "sync" && parts[2] === "auto") return await handleAutoSyncSettings(req, res);
      }
      return send(res, 404, { error: `unknown action: ${action}` });
    } catch (error2) {
      return fail2(res, error2);
    }
  };
}
async function performSyncImpl({ full = false, reason = "manual", config = {} } = {}) {
  if (syncState.running) return { ok: false, running: true, error: "\u5DF2\u7ECF\u6709\u4E00\u8F6E\u540C\u6B65\u5728\u8DD1\u4E86" };
  const now = Date.now();
  if (reason === "auto" && now - syncState.lastAttemptAt < SYNC_MIN_GAP_MS) {
    return { ok: false, skipped: true, error: "\u8DDD\u4E0A\u6B21\u540C\u6B65\u592A\u8FD1\uFF0C\u8DF3\u8FC7\u8FD9\u4E00\u8F6E" };
  }
  syncState.lastAttemptAt = now;
  syncState.running = true;
  syncState.startedAt = (/* @__PURE__ */ new Date()).toISOString();
  syncState.lastError = null;
  const lines = [];
  const log = (text) => {
    lines.push({ at: (/* @__PURE__ */ new Date()).toISOString(), text });
    if (lines.length > 400) lines.shift();
  };
  try {
    const client = await openCloudClient();
    const settings = await readSettings();
    const configured = settings.vaultRoot || config.vaultPath || null;
    const { root, missing } = await resolveVaultRoot(configured);
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const state = await readSyncState();
    const scan = await scanVault(root);
    const index = /* @__PURE__ */ new Map();
    for (const entry of scan.entries) {
      if (entry.noteId) index.set(String(entry.noteId), entry.path);
    }
    const result = await runSync({ client, root, state, full, log, index });
    const nextState = { notes: result.notes, lastRunAt: (/* @__PURE__ */ new Date()).toISOString(), lastCursor: state.lastCursor };
    await writeSyncState(nextState);
    await updateSettings({ lastSyncAt: nextState.lastRunAt });
    syncState.lastResult = {
      pulled: result.pulled,
      skipped: result.skipped,
      adopted: result.adopted,
      conflicts: result.conflicts,
      deleted: result.deleted,
      errors: result.errors.length,
      scanned: result.scanned,
      pages: result.pages,
      full: result.full,
      reason,
      at: (/* @__PURE__ */ new Date()).toISOString()
    };
    syncState.lastError = result.errors.length > 0 ? result.errors[0].message : null;
    for (const e3 of result.errors) log(`\u5931\u8D25\uFF1A${e3.title || e3.noteId || e3.stage} \u2014 ${e3.message}`);
    return { ok: true, ...syncState.lastResult, lines };
  } catch (error2) {
    syncState.lastError = String(error2 && error2.message ? error2.message : error2);
    log(`\u540C\u6B65\u4E2D\u65AD\uFF1A${syncState.lastError}`);
    return { ok: false, error: syncState.lastError, lines, status: error2.status ?? null };
  } finally {
    syncState.running = false;
    syncState.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
}
function createPkceState() {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
function callbackPage(title, message, ok) {
  const accent = ok ? "var(--ok, #3b8a5a)" : "var(--err, #b4433a)";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:-apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;
background:Canvas;color:CanvasText}
.card{max-width:420px;padding:32px 28px;text-align:center;border-radius:16px;
border:1px solid color-mix(in srgb,CanvasText 14%,transparent);background:Canvas}
h1{margin:0 0 12px;font-size:18px;font-weight:600;color:${accent}}
p{margin:0;font-size:13px;line-height:1.7;color:color-mix(in srgb,CanvasText 72%,transparent)}
.tip{margin-top:18px;font-size:12px;color:color-mix(in srgb,CanvasText 50%,transparent)}
</style></head><body><div class="card"><h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p><p class="tip">dsh-getnote \xB7 \u5F97\u5230\u5927\u8111</p></div></body></html>`;
}
function normalizeConfig(config) {
  const raw = config && typeof config === "object" ? config : {};
  return {
    vaultPath: typeof raw.vaultPath === "string" ? raw.vaultPath.trim() : ""
  };
}
function createRouter({ vaultPath = "", getOrigin = () => null } = {}) {
  const merged = normalizeConfig({ vaultPath });
  merged.getOrigin = () => {
    const origin = getOrigin();
    return typeof origin === "string" && origin !== "" ? origin.replace(/\/+$/, "") : null;
  };
  return createHandler(merged);
}
function startAutoSync() {
  let autoTimer = null;
  let autoRunning = false;
  const tick = async () => {
    if (autoRunning) return;
    autoRunning = true;
    try {
      const settings = await readSettings();
      if (!settings.autoSync) return;
      const readiness = await cloudReadiness();
      if (!readiness.configured) return;
      if (settings.autoSyncForegroundOnly) {
        const seen = syncState.lastPanelSeenAt || 0;
        if (Date.now() - seen > PANEL_VISIBLE_MS) return;
      }
      const state = await readSyncState();
      const intervalMs = Math.max(settings.autoSyncMinutes, 5) * 60 * 1e3;
      const last = state.lastRunAt ? Date.parse(state.lastRunAt) : 0;
      const due = !Number.isFinite(last) || last === 0 || Date.now() - last >= intervalMs;
      if (!due) return;
      if (syncState.running) return;
      void performSyncImpl({ full: false, reason: "auto" });
    } catch {
    } finally {
      autoRunning = false;
    }
  };
  const kickoff = setTimeout(() => {
    void tick();
  }, 2e4);
  autoTimer = setInterval(() => {
    void tick();
  }, 60 * 1e3);
  if (autoTimer && typeof autoTimer.unref === "function") autoTimer.unref();
  if (kickoff && typeof kickoff.unref === "function") kickoff.unref();
  return () => {
    clearTimeout(kickoff);
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = null;
  };
}
function startCardAutoImport() {
  let timer = null;
  let checking = false;
  const tick = async () => {
    if (checking) return;
    checking = true;
    try {
      const settings = await readSettings();
      if (settings.cardAutoImport !== true) return;
      if (cardState.running) return;
      const pending = await cardPendingCount();
      if (!pending || pending.error || !(pending.count > 0)) return;
      const { root, missing } = await resolveVaultRoot(settings.vaultRoot || null);
      if (missing || root === null) return;
      startCardImport(root, { all: true, names: "", deleteAfter: false, dir: "\u5F55\u97F3\u5361" });
    } catch {
    } finally {
      checking = false;
    }
  };
  const kickoff = setTimeout(() => {
    void tick();
  }, 45e3);
  timer = setInterval(() => {
    void tick();
  }, 5 * 60 * 1e3);
  if (timer && typeof timer.unref === "function") timer.unref();
  if (kickoff && typeof kickoff.unref === "function") kickoff.unref();
  return () => {
    clearTimeout(kickoff);
    if (timer) clearInterval(timer);
    timer = null;
  };
}
function markPanelVisible() {
  syncState.lastPanelSeenAt = Date.now();
}

// src/host/server.js
var import_node_http2 = require("node:http");
var import_node_crypto7 = require("node:crypto");
var HOST = "127.0.0.1";
var TOKEN_EXEMPT = /* @__PURE__ */ new Set(["oauth"]);
function applyCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader(
    "access-control-allow-headers",
    "content-type, range, x-getnote-import-mode, x-getnote-token"
  );
  res.setHeader(
    "access-control-expose-headers",
    "content-type, content-length, content-range, accept-ranges"
  );
  res.setHeader("access-control-max-age", "600");
  res.setHeader("access-control-allow-private-network", "true");
}
function tokenOf(req, url) {
  const header = req.headers["x-getnote-token"];
  if (typeof header === "string" && header !== "") return header;
  const fromQuery = url.searchParams.get("t");
  return typeof fromQuery === "string" ? fromQuery : "";
}
function listenOn(server, port) {
  return new Promise((resolve5, reject) => {
    const onError = (error2) => {
      server.removeListener("listening", onListening);
      reject(error2);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve5();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, HOST);
  });
}
async function startLocalServer({ vaultPath = "", preferredPort = 0, token = "" } = {}) {
  let origin = "";
  const handler = createRouter({ vaultPath, getOrigin: () => origin });
  const secret = typeof token === "string" && token !== "" ? token : (0, import_node_crypto7.randomBytes)(24).toString("hex");
  const server = (0, import_node_http2.createServer)((req, res) => {
    applyCors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    let url;
    try {
      url = new URL(req.url || "/", "http://127.0.0.1");
    } catch {
      url = new URL("http://127.0.0.1/");
    }
    const parts = url.pathname.split("/").filter(Boolean);
    const action = parts[1] || "status";
    if (!TOKEN_EXEMPT.has(action) && tokenOf(req, url) !== secret) {
      res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "unauthorized", hint: "\u8BF7\u6C42\u7F3A\u5C11\u6216\u5E26\u9519\u4E86\u672C\u673A\u670D\u52A1\u4EE4\u724C" }));
      return;
    }
    Promise.resolve(handler(req, res)).catch((error2) => {
      const message = error2 && error2.message ? error2.message : String(error2);
      try {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: message }));
        } else {
          res.end();
        }
      } catch {
      }
    });
  });
  const candidates = [];
  const wanted = Number.isInteger(preferredPort) && preferredPort > 0 && preferredPort < 65536;
  if (wanted) candidates.push(preferredPort);
  candidates.push(0);
  let lastError = null;
  let usedFallback = false;
  for (const port of candidates) {
    try {
      await listenOn(server, port);
      usedFallback = wanted && port === 0;
      lastError = null;
      break;
    } catch (error2) {
      lastError = error2;
      if (port === 0) throw error2;
    }
  }
  if (lastError) throw lastError;
  const address = server.address();
  const actualPort = address && typeof address === "object" ? address.port : 0;
  origin = `http://${HOST}:${actualPort}`;
  return {
    origin,
    port: actualPort,
    token: secret,
    portFallback: usedFallback,
    /** 停止监听，插件 unload 时调。 */
    close() {
      return new Promise((resolve5) => server.close(() => resolve5()));
    }
  };
}

// node_modules/preact/compat/dist/compat.mjs
var compat_exports = {};
__export(compat_exports, {
  Children: () => L2,
  Component: () => k,
  Fragment: () => b,
  PureComponent: () => I2,
  StrictMode: () => En,
  Suspense: () => W,
  SuspenseList: () => z3,
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: () => sn,
  cloneElement: () => yn,
  createContext: () => G,
  createElement: () => _,
  createFactory: () => vn,
  createPortal: () => Y,
  createRef: () => m,
  default: () => xn,
  findDOMNode: () => bn,
  flushSync: () => gn,
  forwardRef: () => A3,
  hydrate: () => nn,
  isElement: () => Cn,
  isFragment: () => pn,
  isMemo: () => mn,
  isValidElement: () => dn,
  lazy: () => j3,
  memo: () => N2,
  render: () => X,
  startTransition: () => x3,
  unmountComponentAtNode: () => _n,
  unstable_batchedUpdates: () => Sn,
  useCallback: () => q2,
  useContext: () => x2,
  useDebugValue: () => P2,
  useDeferredValue: () => R,
  useEffect: () => y2,
  useErrorBoundary: () => b2,
  useId: () => g2,
  useImperativeHandle: () => F2,
  useInsertionEffect: () => k3,
  useLayoutEffect: () => _2,
  useMemo: () => T2,
  useReducer: () => p2,
  useRef: () => A2,
  useState: () => h2,
  useSyncExternalStore: () => E2,
  useTransition: () => w3,
  version: () => hn
});

// node_modules/preact/dist/preact.mjs
var n;
var l;
var u;
var t2;
var i;
var o;
var r;
var f;
var e;
var c;
var s;
var a;
var h = {};
var v = [];
var p = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
var y = Array.isArray;
function d(n2, l3) {
  for (var u3 in l3) n2[u3] = l3[u3];
  return n2;
}
function w(n2) {
  n2 && n2.parentNode && n2.parentNode.removeChild(n2);
}
function _(l3, u3, t4) {
  var i3, o3, r3, f3 = {};
  for (r3 in u3) "key" == r3 ? i3 = u3[r3] : "ref" == r3 ? o3 = u3[r3] : f3[r3] = u3[r3];
  if (arguments.length > 2 && (f3.children = arguments.length > 3 ? n.call(arguments, 2) : t4), "function" == typeof l3 && null != l3.defaultProps) for (r3 in l3.defaultProps) void 0 === f3[r3] && (f3[r3] = l3.defaultProps[r3]);
  return g(l3, f3, i3, o3, null);
}
function g(n2, t4, i3, o3, r3) {
  var f3 = { type: n2, props: t4, key: i3, ref: o3, __k: null, __: null, __b: 0, __e: null, __d: void 0, __c: null, constructor: void 0, __v: null == r3 ? ++u : r3, __i: -1, __u: 0 };
  return null == r3 && null != l.vnode && l.vnode(f3), f3;
}
function m() {
  return { current: null };
}
function b(n2) {
  return n2.children;
}
function k(n2, l3) {
  this.props = n2, this.context = l3;
}
function x(n2, l3) {
  if (null == l3) return n2.__ ? x(n2.__, n2.__i + 1) : null;
  for (var u3; l3 < n2.__k.length; l3++) if (null != (u3 = n2.__k[l3]) && null != u3.__e) return u3.__e;
  return "function" == typeof n2.type ? x(n2) : null;
}
function C(n2) {
  var l3, u3;
  if (null != (n2 = n2.__) && null != n2.__c) {
    for (n2.__e = n2.__c.base = null, l3 = 0; l3 < n2.__k.length; l3++) if (null != (u3 = n2.__k[l3]) && null != u3.__e) {
      n2.__e = n2.__c.base = u3.__e;
      break;
    }
    return C(n2);
  }
}
function S(n2) {
  (!n2.__d && (n2.__d = true) && i.push(n2) && !M.__r++ || o !== l.debounceRendering) && ((o = l.debounceRendering) || r)(M);
}
function M() {
  var n2, u3, t4, o3, r3, e3, c3, s3;
  for (i.sort(f); n2 = i.shift(); ) n2.__d && (u3 = i.length, o3 = void 0, e3 = (r3 = (t4 = n2).__v).__e, c3 = [], s3 = [], t4.__P && ((o3 = d({}, r3)).__v = r3.__v + 1, l.vnode && l.vnode(o3), O(t4.__P, o3, r3, t4.__n, t4.__P.namespaceURI, 32 & r3.__u ? [e3] : null, c3, null == e3 ? x(r3) : e3, !!(32 & r3.__u), s3), o3.__v = r3.__v, o3.__.__k[o3.__i] = o3, j(c3, o3, s3), o3.__e != e3 && C(o3)), i.length > u3 && i.sort(f));
  M.__r = 0;
}
function P(n2, l3, u3, t4, i3, o3, r3, f3, e3, c3, s3) {
  var a3, p3, y3, d3, w4, _3 = t4 && t4.__k || v, g4 = l3.length;
  for (u3.__d = e3, $(u3, l3, _3), e3 = u3.__d, a3 = 0; a3 < g4; a3++) null != (y3 = u3.__k[a3]) && (p3 = -1 === y3.__i ? h : _3[y3.__i] || h, y3.__i = a3, O(n2, y3, p3, i3, o3, r3, f3, e3, c3, s3), d3 = y3.__e, y3.ref && p3.ref != y3.ref && (p3.ref && E(p3.ref, null, y3), s3.push(y3.ref, y3.__c || d3, y3)), null == w4 && null != d3 && (w4 = d3), 65536 & y3.__u || p3.__k === y3.__k ? e3 = I(y3, e3, n2) : "function" == typeof y3.type && void 0 !== y3.__d ? e3 = y3.__d : d3 && (e3 = d3.nextSibling), y3.__d = void 0, y3.__u &= -196609);
  u3.__d = e3, u3.__e = w4;
}
function $(n2, l3, u3) {
  var t4, i3, o3, r3, f3, e3 = l3.length, c3 = u3.length, s3 = c3, a3 = 0;
  for (n2.__k = [], t4 = 0; t4 < e3; t4++) null != (i3 = l3[t4]) && "boolean" != typeof i3 && "function" != typeof i3 ? (r3 = t4 + a3, (i3 = n2.__k[t4] = "string" == typeof i3 || "number" == typeof i3 || "bigint" == typeof i3 || i3.constructor == String ? g(null, i3, null, null, null) : y(i3) ? g(b, { children: i3 }, null, null, null) : void 0 === i3.constructor && i3.__b > 0 ? g(i3.type, i3.props, i3.key, i3.ref ? i3.ref : null, i3.__v) : i3).__ = n2, i3.__b = n2.__b + 1, o3 = null, -1 !== (f3 = i3.__i = L(i3, u3, r3, s3)) && (s3--, (o3 = u3[f3]) && (o3.__u |= 131072)), null == o3 || null === o3.__v ? (-1 == f3 && a3--, "function" != typeof i3.type && (i3.__u |= 65536)) : f3 !== r3 && (f3 == r3 - 1 ? a3-- : f3 == r3 + 1 ? a3++ : (f3 > r3 ? a3-- : a3++, i3.__u |= 65536))) : i3 = n2.__k[t4] = null;
  if (s3) for (t4 = 0; t4 < c3; t4++) null != (o3 = u3[t4]) && 0 == (131072 & o3.__u) && (o3.__e == n2.__d && (n2.__d = x(o3)), N(o3, o3));
}
function I(n2, l3, u3) {
  var t4, i3;
  if ("function" == typeof n2.type) {
    for (t4 = n2.__k, i3 = 0; t4 && i3 < t4.length; i3++) t4[i3] && (t4[i3].__ = n2, l3 = I(t4[i3], l3, u3));
    return l3;
  }
  n2.__e != l3 && (l3 && n2.type && !u3.contains(l3) && (l3 = x(n2)), u3.insertBefore(n2.__e, l3 || null), l3 = n2.__e);
  do {
    l3 = l3 && l3.nextSibling;
  } while (null != l3 && 8 === l3.nodeType);
  return l3;
}
function H(n2, l3) {
  return l3 = l3 || [], null == n2 || "boolean" == typeof n2 || (y(n2) ? n2.some(function(n3) {
    H(n3, l3);
  }) : l3.push(n2)), l3;
}
function L(n2, l3, u3, t4) {
  var i3 = n2.key, o3 = n2.type, r3 = u3 - 1, f3 = u3 + 1, e3 = l3[u3];
  if (null === e3 || e3 && i3 == e3.key && o3 === e3.type && 0 == (131072 & e3.__u)) return u3;
  if (("function" != typeof o3 || o3 === b || i3) && t4 > (null != e3 && 0 == (131072 & e3.__u) ? 1 : 0)) for (; r3 >= 0 || f3 < l3.length; ) {
    if (r3 >= 0) {
      if ((e3 = l3[r3]) && 0 == (131072 & e3.__u) && i3 == e3.key && o3 === e3.type) return r3;
      r3--;
    }
    if (f3 < l3.length) {
      if ((e3 = l3[f3]) && 0 == (131072 & e3.__u) && i3 == e3.key && o3 === e3.type) return f3;
      f3++;
    }
  }
  return -1;
}
function T(n2, l3, u3) {
  "-" === l3[0] ? n2.setProperty(l3, null == u3 ? "" : u3) : n2[l3] = null == u3 ? "" : "number" != typeof u3 || p.test(l3) ? u3 : u3 + "px";
}
function A(n2, l3, u3, t4, i3) {
  var o3;
  n: if ("style" === l3) if ("string" == typeof u3) n2.style.cssText = u3;
  else {
    if ("string" == typeof t4 && (n2.style.cssText = t4 = ""), t4) for (l3 in t4) u3 && l3 in u3 || T(n2.style, l3, "");
    if (u3) for (l3 in u3) t4 && u3[l3] === t4[l3] || T(n2.style, l3, u3[l3]);
  }
  else if ("o" === l3[0] && "n" === l3[1]) o3 = l3 !== (l3 = l3.replace(/(PointerCapture)$|Capture$/i, "$1")), l3 = l3.toLowerCase() in n2 || "onFocusOut" === l3 || "onFocusIn" === l3 ? l3.toLowerCase().slice(2) : l3.slice(2), n2.l || (n2.l = {}), n2.l[l3 + o3] = u3, u3 ? t4 ? u3.u = t4.u : (u3.u = e, n2.addEventListener(l3, o3 ? s : c, o3)) : n2.removeEventListener(l3, o3 ? s : c, o3);
  else {
    if ("http://www.w3.org/2000/svg" == i3) l3 = l3.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
    else if ("width" != l3 && "height" != l3 && "href" != l3 && "list" != l3 && "form" != l3 && "tabIndex" != l3 && "download" != l3 && "rowSpan" != l3 && "colSpan" != l3 && "role" != l3 && "popover" != l3 && l3 in n2) try {
      n2[l3] = null == u3 ? "" : u3;
      break n;
    } catch (n3) {
    }
    "function" == typeof u3 || (null == u3 || false === u3 && "-" !== l3[4] ? n2.removeAttribute(l3) : n2.setAttribute(l3, "popover" == l3 && 1 == u3 ? "" : u3));
  }
}
function F(n2) {
  return function(u3) {
    if (this.l) {
      var t4 = this.l[u3.type + n2];
      if (null == u3.t) u3.t = e++;
      else if (u3.t < t4.u) return;
      return l.event && (u3 = l.event(u3)), "handleEvent" in t4 ? t4.handleEvent(u3) : t4(u3);
    }
  };
}
function O(n2, u3, t4, i3, o3, r3, f3, e3, c3, s3) {
  var a3, h5, v3, p3, w4, _3, g4, m3, x4, C4, S2, M3, $3, I3, H3, L3, T4 = u3.type;
  if (void 0 !== u3.constructor) return null;
  128 & t4.__u && (c3 = !!(32 & t4.__u), r3 = [e3 = u3.__e = t4.__e]), (a3 = l.__b) && a3(u3);
  n: if ("function" == typeof T4) try {
    if (m3 = u3.props, x4 = "prototype" in T4 && T4.prototype.render, C4 = (a3 = T4.contextType) && i3[a3.__c], S2 = a3 ? C4 ? C4.props.value : a3.__ : i3, t4.__c ? g4 = (h5 = u3.__c = t4.__c).__ = h5.__E : (x4 ? u3.__c = h5 = new T4(m3, S2) : (u3.__c = h5 = new k(m3, S2), h5.constructor = T4, h5.render = V), C4 && C4.sub(h5), h5.props = m3, h5.state || (h5.state = {}), h5.context = S2, h5.__n = i3, v3 = h5.__d = true, h5.__h = [], h5._sb = []), x4 && null == h5.__s && (h5.__s = h5.state), x4 && null != T4.getDerivedStateFromProps && (h5.__s == h5.state && (h5.__s = d({}, h5.__s)), d(h5.__s, T4.getDerivedStateFromProps(m3, h5.__s))), p3 = h5.props, w4 = h5.state, h5.__v = u3, v3) x4 && null == T4.getDerivedStateFromProps && null != h5.componentWillMount && h5.componentWillMount(), x4 && null != h5.componentDidMount && h5.__h.push(h5.componentDidMount);
    else {
      if (x4 && null == T4.getDerivedStateFromProps && m3 !== p3 && null != h5.componentWillReceiveProps && h5.componentWillReceiveProps(m3, S2), !h5.__e && (null != h5.shouldComponentUpdate && false === h5.shouldComponentUpdate(m3, h5.__s, S2) || u3.__v === t4.__v)) {
        for (u3.__v !== t4.__v && (h5.props = m3, h5.state = h5.__s, h5.__d = false), u3.__e = t4.__e, u3.__k = t4.__k, u3.__k.some(function(n3) {
          n3 && (n3.__ = u3);
        }), M3 = 0; M3 < h5._sb.length; M3++) h5.__h.push(h5._sb[M3]);
        h5._sb = [], h5.__h.length && f3.push(h5);
        break n;
      }
      null != h5.componentWillUpdate && h5.componentWillUpdate(m3, h5.__s, S2), x4 && null != h5.componentDidUpdate && h5.__h.push(function() {
        h5.componentDidUpdate(p3, w4, _3);
      });
    }
    if (h5.context = S2, h5.props = m3, h5.__P = n2, h5.__e = false, $3 = l.__r, I3 = 0, x4) {
      for (h5.state = h5.__s, h5.__d = false, $3 && $3(u3), a3 = h5.render(h5.props, h5.state, h5.context), H3 = 0; H3 < h5._sb.length; H3++) h5.__h.push(h5._sb[H3]);
      h5._sb = [];
    } else do {
      h5.__d = false, $3 && $3(u3), a3 = h5.render(h5.props, h5.state, h5.context), h5.state = h5.__s;
    } while (h5.__d && ++I3 < 25);
    h5.state = h5.__s, null != h5.getChildContext && (i3 = d(d({}, i3), h5.getChildContext())), x4 && !v3 && null != h5.getSnapshotBeforeUpdate && (_3 = h5.getSnapshotBeforeUpdate(p3, w4)), P(n2, y(L3 = null != a3 && a3.type === b && null == a3.key ? a3.props.children : a3) ? L3 : [L3], u3, t4, i3, o3, r3, f3, e3, c3, s3), h5.base = u3.__e, u3.__u &= -161, h5.__h.length && f3.push(h5), g4 && (h5.__E = h5.__ = null);
  } catch (n3) {
    if (u3.__v = null, c3 || null != r3) {
      for (u3.__u |= c3 ? 160 : 128; e3 && 8 === e3.nodeType && e3.nextSibling; ) e3 = e3.nextSibling;
      r3[r3.indexOf(e3)] = null, u3.__e = e3;
    } else u3.__e = t4.__e, u3.__k = t4.__k;
    l.__e(n3, u3, t4);
  }
  else null == r3 && u3.__v === t4.__v ? (u3.__k = t4.__k, u3.__e = t4.__e) : u3.__e = z(t4.__e, u3, t4, i3, o3, r3, f3, c3, s3);
  (a3 = l.diffed) && a3(u3);
}
function j(n2, u3, t4) {
  u3.__d = void 0;
  for (var i3 = 0; i3 < t4.length; i3++) E(t4[i3], t4[++i3], t4[++i3]);
  l.__c && l.__c(u3, n2), n2.some(function(u4) {
    try {
      n2 = u4.__h, u4.__h = [], n2.some(function(n3) {
        n3.call(u4);
      });
    } catch (n3) {
      l.__e(n3, u4.__v);
    }
  });
}
function z(u3, t4, i3, o3, r3, f3, e3, c3, s3) {
  var a3, v3, p3, d3, _3, g4, m3, b3 = i3.props, k4 = t4.props, C4 = t4.type;
  if ("svg" === C4 ? r3 = "http://www.w3.org/2000/svg" : "math" === C4 ? r3 = "http://www.w3.org/1998/Math/MathML" : r3 || (r3 = "http://www.w3.org/1999/xhtml"), null != f3) {
    for (a3 = 0; a3 < f3.length; a3++) if ((_3 = f3[a3]) && "setAttribute" in _3 == !!C4 && (C4 ? _3.localName === C4 : 3 === _3.nodeType)) {
      u3 = _3, f3[a3] = null;
      break;
    }
  }
  if (null == u3) {
    if (null === C4) return document.createTextNode(k4);
    u3 = document.createElementNS(r3, C4, k4.is && k4), c3 && (l.__m && l.__m(t4, f3), c3 = false), f3 = null;
  }
  if (null === C4) b3 === k4 || c3 && u3.data === k4 || (u3.data = k4);
  else {
    if (f3 = f3 && n.call(u3.childNodes), b3 = i3.props || h, !c3 && null != f3) for (b3 = {}, a3 = 0; a3 < u3.attributes.length; a3++) b3[(_3 = u3.attributes[a3]).name] = _3.value;
    for (a3 in b3) if (_3 = b3[a3], "children" == a3) ;
    else if ("dangerouslySetInnerHTML" == a3) p3 = _3;
    else if (!(a3 in k4)) {
      if ("value" == a3 && "defaultValue" in k4 || "checked" == a3 && "defaultChecked" in k4) continue;
      A(u3, a3, null, _3, r3);
    }
    for (a3 in k4) _3 = k4[a3], "children" == a3 ? d3 = _3 : "dangerouslySetInnerHTML" == a3 ? v3 = _3 : "value" == a3 ? g4 = _3 : "checked" == a3 ? m3 = _3 : c3 && "function" != typeof _3 || b3[a3] === _3 || A(u3, a3, _3, b3[a3], r3);
    if (v3) c3 || p3 && (v3.__html === p3.__html || v3.__html === u3.innerHTML) || (u3.innerHTML = v3.__html), t4.__k = [];
    else if (p3 && (u3.innerHTML = ""), P(u3, y(d3) ? d3 : [d3], t4, i3, o3, "foreignObject" === C4 ? "http://www.w3.org/1999/xhtml" : r3, f3, e3, f3 ? f3[0] : i3.__k && x(i3, 0), c3, s3), null != f3) for (a3 = f3.length; a3--; ) w(f3[a3]);
    c3 || (a3 = "value", "progress" === C4 && null == g4 ? u3.removeAttribute("value") : void 0 !== g4 && (g4 !== u3[a3] || "progress" === C4 && !g4 || "option" === C4 && g4 !== b3[a3]) && A(u3, a3, g4, b3[a3], r3), a3 = "checked", void 0 !== m3 && m3 !== u3[a3] && A(u3, a3, m3, b3[a3], r3));
  }
  return u3;
}
function E(n2, u3, t4) {
  try {
    if ("function" == typeof n2) {
      var i3 = "function" == typeof n2.__u;
      i3 && n2.__u(), i3 && null == u3 || (n2.__u = n2(u3));
    } else n2.current = u3;
  } catch (n3) {
    l.__e(n3, t4);
  }
}
function N(n2, u3, t4) {
  var i3, o3;
  if (l.unmount && l.unmount(n2), (i3 = n2.ref) && (i3.current && i3.current !== n2.__e || E(i3, null, u3)), null != (i3 = n2.__c)) {
    if (i3.componentWillUnmount) try {
      i3.componentWillUnmount();
    } catch (n3) {
      l.__e(n3, u3);
    }
    i3.base = i3.__P = null;
  }
  if (i3 = n2.__k) for (o3 = 0; o3 < i3.length; o3++) i3[o3] && N(i3[o3], u3, t4 || "function" != typeof n2.type);
  t4 || w(n2.__e), n2.__c = n2.__ = n2.__e = n2.__d = void 0;
}
function V(n2, l3, u3) {
  return this.constructor(n2, u3);
}
function q(u3, t4, i3) {
  var o3, r3, f3, e3;
  l.__ && l.__(u3, t4), r3 = (o3 = "function" == typeof i3) ? null : i3 && i3.__k || t4.__k, f3 = [], e3 = [], O(t4, u3 = (!o3 && i3 || t4).__k = _(b, null, [u3]), r3 || h, h, t4.namespaceURI, !o3 && i3 ? [i3] : r3 ? null : t4.firstChild ? n.call(t4.childNodes) : null, f3, !o3 && i3 ? i3 : r3 ? r3.__e : t4.firstChild, o3, e3), j(f3, u3, e3);
}
function B(n2, l3) {
  q(n2, l3, B);
}
function D(l3, u3, t4) {
  var i3, o3, r3, f3, e3 = d({}, l3.props);
  for (r3 in l3.type && l3.type.defaultProps && (f3 = l3.type.defaultProps), u3) "key" == r3 ? i3 = u3[r3] : "ref" == r3 ? o3 = u3[r3] : e3[r3] = void 0 === u3[r3] && void 0 !== f3 ? f3[r3] : u3[r3];
  return arguments.length > 2 && (e3.children = arguments.length > 3 ? n.call(arguments, 2) : t4), g(l3.type, e3, i3 || l3.key, o3 || l3.ref, null);
}
function G(n2, l3) {
  var u3 = { __c: l3 = "__cC" + a++, __: n2, Consumer: function(n3, l4) {
    return n3.children(l4);
  }, Provider: function(n3) {
    var u4, t4;
    return this.getChildContext || (u4 = /* @__PURE__ */ new Set(), (t4 = {})[l3] = this, this.getChildContext = function() {
      return t4;
    }, this.componentWillUnmount = function() {
      u4 = null;
    }, this.shouldComponentUpdate = function(n4) {
      this.props.value !== n4.value && u4.forEach(function(n5) {
        n5.__e = true, S(n5);
      });
    }, this.sub = function(n4) {
      u4.add(n4);
      var l4 = n4.componentWillUnmount;
      n4.componentWillUnmount = function() {
        u4 && u4.delete(n4), l4 && l4.call(n4);
      };
    }), n3.children;
  } };
  return u3.Provider.__ = u3.Consumer.contextType = u3;
}
n = v.slice, l = { __e: function(n2, l3, u3, t4) {
  for (var i3, o3, r3; l3 = l3.__; ) if ((i3 = l3.__c) && !i3.__) try {
    if ((o3 = i3.constructor) && null != o3.getDerivedStateFromError && (i3.setState(o3.getDerivedStateFromError(n2)), r3 = i3.__d), null != i3.componentDidCatch && (i3.componentDidCatch(n2, t4 || {}), r3 = i3.__d), r3) return i3.__E = i3;
  } catch (l4) {
    n2 = l4;
  }
  throw n2;
} }, u = 0, t2 = function(n2) {
  return null != n2 && null == n2.constructor;
}, k.prototype.setState = function(n2, l3) {
  var u3;
  u3 = null != this.__s && this.__s !== this.state ? this.__s : this.__s = d({}, this.state), "function" == typeof n2 && (n2 = n2(d({}, u3), this.props)), n2 && d(u3, n2), null != n2 && this.__v && (l3 && this._sb.push(l3), S(this));
}, k.prototype.forceUpdate = function(n2) {
  this.__v && (this.__e = true, n2 && this.__h.push(n2), S(this));
}, k.prototype.render = b, i = [], r = "function" == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, f = function(n2, l3) {
  return n2.__v.__b - l3.__v.__b;
}, M.__r = 0, e = 0, c = F(false), s = F(true), a = 0;

// node_modules/preact/hooks/dist/hooks.mjs
var t3;
var r2;
var u2;
var i2;
var o2 = 0;
var f2 = [];
var c2 = l;
var e2 = c2.__b;
var a2 = c2.__r;
var v2 = c2.diffed;
var l2 = c2.__c;
var m2 = c2.unmount;
var s2 = c2.__;
function d2(n2, t4) {
  c2.__h && c2.__h(r2, n2, o2 || t4), o2 = 0;
  var u3 = r2.__H || (r2.__H = { __: [], __h: [] });
  return n2 >= u3.__.length && u3.__.push({}), u3.__[n2];
}
function h2(n2) {
  return o2 = 1, p2(D2, n2);
}
function p2(n2, u3, i3) {
  var o3 = d2(t3++, 2);
  if (o3.t = n2, !o3.__c && (o3.__ = [i3 ? i3(u3) : D2(void 0, u3), function(n3) {
    var t4 = o3.__N ? o3.__N[0] : o3.__[0], r3 = o3.t(t4, n3);
    t4 !== r3 && (o3.__N = [r3, o3.__[1]], o3.__c.setState({}));
  }], o3.__c = r2, !r2.u)) {
    var f3 = function(n3, t4, r3) {
      if (!o3.__c.__H) return true;
      var u4 = o3.__c.__H.__.filter(function(n4) {
        return !!n4.__c;
      });
      if (u4.every(function(n4) {
        return !n4.__N;
      })) return !c3 || c3.call(this, n3, t4, r3);
      var i4 = o3.__c.props !== n3;
      return u4.forEach(function(n4) {
        if (n4.__N) {
          var t5 = n4.__[0];
          n4.__ = n4.__N, n4.__N = void 0, t5 !== n4.__[0] && (i4 = true);
        }
      }), c3 && c3.call(this, n3, t4, r3) || i4;
    };
    r2.u = true;
    var c3 = r2.shouldComponentUpdate, e3 = r2.componentWillUpdate;
    r2.componentWillUpdate = function(n3, t4, r3) {
      if (this.__e) {
        var u4 = c3;
        c3 = void 0, f3(n3, t4, r3), c3 = u4;
      }
      e3 && e3.call(this, n3, t4, r3);
    }, r2.shouldComponentUpdate = f3;
  }
  return o3.__N || o3.__;
}
function y2(n2, u3) {
  var i3 = d2(t3++, 3);
  !c2.__s && C2(i3.__H, u3) && (i3.__ = n2, i3.i = u3, r2.__H.__h.push(i3));
}
function _2(n2, u3) {
  var i3 = d2(t3++, 4);
  !c2.__s && C2(i3.__H, u3) && (i3.__ = n2, i3.i = u3, r2.__h.push(i3));
}
function A2(n2) {
  return o2 = 5, T2(function() {
    return { current: n2 };
  }, []);
}
function F2(n2, t4, r3) {
  o2 = 6, _2(function() {
    return "function" == typeof n2 ? (n2(t4()), function() {
      return n2(null);
    }) : n2 ? (n2.current = t4(), function() {
      return n2.current = null;
    }) : void 0;
  }, null == r3 ? r3 : r3.concat(n2));
}
function T2(n2, r3) {
  var u3 = d2(t3++, 7);
  return C2(u3.__H, r3) && (u3.__ = n2(), u3.__H = r3, u3.__h = n2), u3.__;
}
function q2(n2, t4) {
  return o2 = 8, T2(function() {
    return n2;
  }, t4);
}
function x2(n2) {
  var u3 = r2.context[n2.__c], i3 = d2(t3++, 9);
  return i3.c = n2, u3 ? (null == i3.__ && (i3.__ = true, u3.sub(r2)), u3.props.value) : n2.__;
}
function P2(n2, t4) {
  c2.useDebugValue && c2.useDebugValue(t4 ? t4(n2) : n2);
}
function b2(n2) {
  var u3 = d2(t3++, 10), i3 = h2();
  return u3.__ = n2, r2.componentDidCatch || (r2.componentDidCatch = function(n3, t4) {
    u3.__ && u3.__(n3, t4), i3[1](n3);
  }), [i3[0], function() {
    i3[1](void 0);
  }];
}
function g2() {
  var n2 = d2(t3++, 11);
  if (!n2.__) {
    for (var u3 = r2.__v; null !== u3 && !u3.__m && null !== u3.__; ) u3 = u3.__;
    var i3 = u3.__m || (u3.__m = [0, 0]);
    n2.__ = "P" + i3[0] + "-" + i3[1]++;
  }
  return n2.__;
}
function j2() {
  for (var n2; n2 = f2.shift(); ) if (n2.__P && n2.__H) try {
    n2.__H.__h.forEach(z2), n2.__H.__h.forEach(B2), n2.__H.__h = [];
  } catch (t4) {
    n2.__H.__h = [], c2.__e(t4, n2.__v);
  }
}
c2.__b = function(n2) {
  r2 = null, e2 && e2(n2);
}, c2.__ = function(n2, t4) {
  n2 && t4.__k && t4.__k.__m && (n2.__m = t4.__k.__m), s2 && s2(n2, t4);
}, c2.__r = function(n2) {
  a2 && a2(n2), t3 = 0;
  var i3 = (r2 = n2.__c).__H;
  i3 && (u2 === r2 ? (i3.__h = [], r2.__h = [], i3.__.forEach(function(n3) {
    n3.__N && (n3.__ = n3.__N), n3.i = n3.__N = void 0;
  })) : (i3.__h.forEach(z2), i3.__h.forEach(B2), i3.__h = [], t3 = 0)), u2 = r2;
}, c2.diffed = function(n2) {
  v2 && v2(n2);
  var t4 = n2.__c;
  t4 && t4.__H && (t4.__H.__h.length && (1 !== f2.push(t4) && i2 === c2.requestAnimationFrame || ((i2 = c2.requestAnimationFrame) || w2)(j2)), t4.__H.__.forEach(function(n3) {
    n3.i && (n3.__H = n3.i), n3.i = void 0;
  })), u2 = r2 = null;
}, c2.__c = function(n2, t4) {
  t4.some(function(n3) {
    try {
      n3.__h.forEach(z2), n3.__h = n3.__h.filter(function(n4) {
        return !n4.__ || B2(n4);
      });
    } catch (r3) {
      t4.some(function(n4) {
        n4.__h && (n4.__h = []);
      }), t4 = [], c2.__e(r3, n3.__v);
    }
  }), l2 && l2(n2, t4);
}, c2.unmount = function(n2) {
  m2 && m2(n2);
  var t4, r3 = n2.__c;
  r3 && r3.__H && (r3.__H.__.forEach(function(n3) {
    try {
      z2(n3);
    } catch (n4) {
      t4 = n4;
    }
  }), r3.__H = void 0, t4 && c2.__e(t4, r3.__v));
};
var k2 = "function" == typeof requestAnimationFrame;
function w2(n2) {
  var t4, r3 = function() {
    clearTimeout(u3), k2 && cancelAnimationFrame(t4), setTimeout(n2);
  }, u3 = setTimeout(r3, 100);
  k2 && (t4 = requestAnimationFrame(r3));
}
function z2(n2) {
  var t4 = r2, u3 = n2.__c;
  "function" == typeof u3 && (n2.__c = void 0, u3()), r2 = t4;
}
function B2(n2) {
  var t4 = r2;
  n2.__c = n2.__(), r2 = t4;
}
function C2(n2, t4) {
  return !n2 || n2.length !== t4.length || t4.some(function(t5, r3) {
    return t5 !== n2[r3];
  });
}
function D2(n2, t4) {
  return "function" == typeof t4 ? t4(n2) : t4;
}

// node_modules/preact/compat/dist/compat.mjs
function g3(n2, t4) {
  for (var e3 in n2) if ("__source" !== e3 && !(e3 in t4)) return true;
  for (var r3 in t4) if ("__source" !== r3 && n2[r3] !== t4[r3]) return true;
  return false;
}
function E2(n2, t4) {
  var e3 = t4(), r3 = h2({ t: { __: e3, u: t4 } }), u3 = r3[0].t, o3 = r3[1];
  return _2(function() {
    u3.__ = e3, u3.u = t4, C3(u3) && o3({ t: u3 });
  }, [n2, e3, t4]), y2(function() {
    return C3(u3) && o3({ t: u3 }), n2(function() {
      C3(u3) && o3({ t: u3 });
    });
  }, [n2]), e3;
}
function C3(n2) {
  var t4, e3, r3 = n2.u, u3 = n2.__;
  try {
    var o3 = r3();
    return !((t4 = u3) === (e3 = o3) && (0 !== t4 || 1 / t4 == 1 / e3) || t4 != t4 && e3 != e3);
  } catch (n3) {
    return true;
  }
}
function x3(n2) {
  n2();
}
function R(n2) {
  return n2;
}
function w3() {
  return [false, x3];
}
var k3 = _2;
function I2(n2, t4) {
  this.props = n2, this.context = t4;
}
function N2(n2, e3) {
  function r3(n3) {
    var t4 = this.props.ref, r4 = t4 == n3.ref;
    return !r4 && t4 && (t4.call ? t4(null) : t4.current = null), e3 ? !e3(this.props, n3) || !r4 : g3(this.props, n3);
  }
  function u3(e4) {
    return this.shouldComponentUpdate = r3, _(n2, e4);
  }
  return u3.displayName = "Memo(" + (n2.displayName || n2.name) + ")", u3.prototype.isReactComponent = true, u3.__f = true, u3;
}
(I2.prototype = new k()).isPureReactComponent = true, I2.prototype.shouldComponentUpdate = function(n2, t4) {
  return g3(this.props, n2) || g3(this.state, t4);
};
var M2 = l.__b;
l.__b = function(n2) {
  n2.type && n2.type.__f && n2.ref && (n2.props.ref = n2.ref, n2.ref = null), M2 && M2(n2);
};
var T3 = "undefined" != typeof Symbol && Symbol.for && Symbol.for("react.forward_ref") || 3911;
function A3(n2) {
  function t4(t5) {
    if (!("ref" in t5)) return n2(t5, null);
    var e3 = t5.ref;
    delete t5.ref;
    var r3 = n2(t5, e3);
    return t5.ref = e3, r3;
  }
  return t4.$$typeof = T3, t4.render = t4, t4.prototype.isReactComponent = t4.__f = true, t4.displayName = "ForwardRef(" + (n2.displayName || n2.name) + ")", t4;
}
var D3 = function(n2, t4) {
  return null == n2 ? null : H(H(n2).map(t4));
};
var L2 = { map: D3, forEach: D3, count: function(n2) {
  return n2 ? H(n2).length : 0;
}, only: function(n2) {
  var t4 = H(n2);
  if (1 !== t4.length) throw "Children.only";
  return t4[0];
}, toArray: H };
var O2 = l.__e;
l.__e = function(n2, t4, e3, r3) {
  if (n2.then) {
    for (var u3, o3 = t4; o3 = o3.__; ) if ((u3 = o3.__c) && u3.__c) return null == t4.__e && (t4.__e = e3.__e, t4.__k = e3.__k), u3.__c(n2, t4);
  }
  O2(n2, t4, e3, r3);
};
var F3 = l.unmount;
function U(n2, t4, e3) {
  return n2 && (n2.__c && n2.__c.__H && (n2.__c.__H.__.forEach(function(n3) {
    "function" == typeof n3.__c && n3.__c();
  }), n2.__c.__H = null), null != (n2 = (function(n3, t5) {
    for (var e4 in t5) n3[e4] = t5[e4];
    return n3;
  })({}, n2)).__c && (n2.__c.__P === e3 && (n2.__c.__P = t4), n2.__c = null), n2.__k = n2.__k && n2.__k.map(function(n3) {
    return U(n3, t4, e3);
  })), n2;
}
function V2(n2, t4, e3) {
  return n2 && e3 && (n2.__v = null, n2.__k = n2.__k && n2.__k.map(function(n3) {
    return V2(n3, t4, e3);
  }), n2.__c && n2.__c.__P === t4 && (n2.__e && e3.appendChild(n2.__e), n2.__c.__e = true, n2.__c.__P = e3)), n2;
}
function W() {
  this.__u = 0, this.o = null, this.__b = null;
}
function P3(n2) {
  var t4 = n2.__.__c;
  return t4 && t4.__a && t4.__a(n2);
}
function j3(n2) {
  var e3, r3, u3;
  function o3(o4) {
    if (e3 || (e3 = n2()).then(function(n3) {
      r3 = n3.default || n3;
    }, function(n3) {
      u3 = n3;
    }), u3) throw u3;
    if (!r3) throw e3;
    return _(r3, o4);
  }
  return o3.displayName = "Lazy", o3.__f = true, o3;
}
function z3() {
  this.i = null, this.l = null;
}
l.unmount = function(n2) {
  var t4 = n2.__c;
  t4 && t4.__R && t4.__R(), t4 && 32 & n2.__u && (n2.type = null), F3 && F3(n2);
}, (W.prototype = new k()).__c = function(n2, t4) {
  var e3 = t4.__c, r3 = this;
  null == r3.o && (r3.o = []), r3.o.push(e3);
  var u3 = P3(r3.__v), o3 = false, i3 = function() {
    o3 || (o3 = true, e3.__R = null, u3 ? u3(c3) : c3());
  };
  e3.__R = i3;
  var c3 = function() {
    if (!--r3.__u) {
      if (r3.state.__a) {
        var n3 = r3.state.__a;
        r3.__v.__k[0] = V2(n3, n3.__c.__P, n3.__c.__O);
      }
      var t5;
      for (r3.setState({ __a: r3.__b = null }); t5 = r3.o.pop(); ) t5.forceUpdate();
    }
  };
  r3.__u++ || 32 & t4.__u || r3.setState({ __a: r3.__b = r3.__v.__k[0] }), n2.then(i3, i3);
}, W.prototype.componentWillUnmount = function() {
  this.o = [];
}, W.prototype.render = function(n2, e3) {
  if (this.__b) {
    if (this.__v.__k) {
      var r3 = document.createElement("div"), o3 = this.__v.__k[0].__c;
      this.__v.__k[0] = U(this.__b, r3, o3.__O = o3.__P);
    }
    this.__b = null;
  }
  var i3 = e3.__a && _(b, null, n2.fallback);
  return i3 && (i3.__u &= -33), [_(b, null, e3.__a ? null : n2.children), i3];
};
var B3 = function(n2, t4, e3) {
  if (++e3[1] === e3[0] && n2.l.delete(t4), n2.props.revealOrder && ("t" !== n2.props.revealOrder[0] || !n2.l.size)) for (e3 = n2.i; e3; ) {
    for (; e3.length > 3; ) e3.pop()();
    if (e3[1] < e3[0]) break;
    n2.i = e3 = e3[2];
  }
};
function H2(n2) {
  return this.getChildContext = function() {
    return n2.context;
  }, n2.children;
}
function Z(n2) {
  var e3 = this, r3 = n2.h;
  e3.componentWillUnmount = function() {
    q(null, e3.v), e3.v = null, e3.h = null;
  }, e3.h && e3.h !== r3 && e3.componentWillUnmount(), e3.v || (e3.h = r3, e3.v = { nodeType: 1, parentNode: r3, childNodes: [], contains: function() {
    return true;
  }, appendChild: function(n3) {
    this.childNodes.push(n3), e3.h.appendChild(n3);
  }, insertBefore: function(n3, t4) {
    this.childNodes.push(n3), e3.h.appendChild(n3);
  }, removeChild: function(n3) {
    this.childNodes.splice(this.childNodes.indexOf(n3) >>> 1, 1), e3.h.removeChild(n3);
  } }), q(_(H2, { context: e3.context }, n2.__v), e3.v);
}
function Y(n2, e3) {
  var r3 = _(Z, { __v: n2, h: e3 });
  return r3.containerInfo = e3, r3;
}
(z3.prototype = new k()).__a = function(n2) {
  var t4 = this, e3 = P3(t4.__v), r3 = t4.l.get(n2);
  return r3[0]++, function(u3) {
    var o3 = function() {
      t4.props.revealOrder ? (r3.push(u3), B3(t4, n2, r3)) : u3();
    };
    e3 ? e3(o3) : o3();
  };
}, z3.prototype.render = function(n2) {
  this.i = null, this.l = /* @__PURE__ */ new Map();
  var t4 = H(n2.children);
  n2.revealOrder && "b" === n2.revealOrder[0] && t4.reverse();
  for (var e3 = t4.length; e3--; ) this.l.set(t4[e3], this.i = [1, 0, this.i]);
  return n2.children;
}, z3.prototype.componentDidUpdate = z3.prototype.componentDidMount = function() {
  var n2 = this;
  this.l.forEach(function(t4, e3) {
    B3(n2, e3, t4);
  });
};
var $2 = "undefined" != typeof Symbol && Symbol.for && Symbol.for("react.element") || 60103;
var q3 = /^(?:accent|alignment|arabic|baseline|cap|clip(?!PathU)|color|dominant|fill|flood|font|glyph(?!R)|horiz|image(!S)|letter|lighting|marker(?!H|W|U)|overline|paint|pointer|shape|stop|strikethrough|stroke|text(?!L)|transform|underline|unicode|units|v|vector|vert|word|writing|x(?!C))[A-Z]/;
var G2 = /^on(Ani|Tra|Tou|BeforeInp|Compo)/;
var J = /[A-Z0-9]/g;
var K = "undefined" != typeof document;
var Q = function(n2) {
  return ("undefined" != typeof Symbol && "symbol" == typeof Symbol() ? /fil|che|rad/ : /fil|che|ra/).test(n2);
};
function X(n2, t4, e3) {
  return null == t4.__k && (t4.textContent = ""), q(n2, t4), "function" == typeof e3 && e3(), n2 ? n2.__c : null;
}
function nn(n2, t4, e3) {
  return B(n2, t4), "function" == typeof e3 && e3(), n2 ? n2.__c : null;
}
k.prototype.isReactComponent = {}, ["componentWillMount", "componentWillReceiveProps", "componentWillUpdate"].forEach(function(t4) {
  Object.defineProperty(k.prototype, t4, { configurable: true, get: function() {
    return this["UNSAFE_" + t4];
  }, set: function(n2) {
    Object.defineProperty(this, t4, { configurable: true, writable: true, value: n2 });
  } });
});
var tn = l.event;
function en() {
}
function rn() {
  return this.cancelBubble;
}
function un() {
  return this.defaultPrevented;
}
l.event = function(n2) {
  return tn && (n2 = tn(n2)), n2.persist = en, n2.isPropagationStopped = rn, n2.isDefaultPrevented = un, n2.nativeEvent = n2;
};
var on;
var cn = { enumerable: false, configurable: true, get: function() {
  return this.class;
} };
var fn = l.vnode;
l.vnode = function(n2) {
  "string" == typeof n2.type && (function(n3) {
    var t4 = n3.props, e3 = n3.type, u3 = {}, o3 = -1 === e3.indexOf("-");
    for (var i3 in t4) {
      var c3 = t4[i3];
      if (!("value" === i3 && "defaultValue" in t4 && null == c3 || K && "children" === i3 && "noscript" === e3 || "class" === i3 || "className" === i3)) {
        var f3 = i3.toLowerCase();
        "defaultValue" === i3 && "value" in t4 && null == t4.value ? i3 = "value" : "download" === i3 && true === c3 ? c3 = "" : "translate" === f3 && "no" === c3 ? c3 = false : "o" === f3[0] && "n" === f3[1] ? "ondoubleclick" === f3 ? i3 = "ondblclick" : "onchange" !== f3 || "input" !== e3 && "textarea" !== e3 || Q(t4.type) ? "onfocus" === f3 ? i3 = "onfocusin" : "onblur" === f3 ? i3 = "onfocusout" : G2.test(i3) && (i3 = f3) : f3 = i3 = "oninput" : o3 && q3.test(i3) ? i3 = i3.replace(J, "-$&").toLowerCase() : null === c3 && (c3 = void 0), "oninput" === f3 && u3[i3 = f3] && (i3 = "oninputCapture"), u3[i3] = c3;
      }
    }
    "select" == e3 && u3.multiple && Array.isArray(u3.value) && (u3.value = H(t4.children).forEach(function(n4) {
      n4.props.selected = -1 != u3.value.indexOf(n4.props.value);
    })), "select" == e3 && null != u3.defaultValue && (u3.value = H(t4.children).forEach(function(n4) {
      n4.props.selected = u3.multiple ? -1 != u3.defaultValue.indexOf(n4.props.value) : u3.defaultValue == n4.props.value;
    })), t4.class && !t4.className ? (u3.class = t4.class, Object.defineProperty(u3, "className", cn)) : (t4.className && !t4.class || t4.class && t4.className) && (u3.class = u3.className = t4.className), n3.props = u3;
  })(n2), n2.$$typeof = $2, fn && fn(n2);
};
var ln = l.__r;
l.__r = function(n2) {
  ln && ln(n2), on = n2.__c;
};
var an = l.diffed;
l.diffed = function(n2) {
  an && an(n2);
  var t4 = n2.props, e3 = n2.__e;
  null != e3 && "textarea" === n2.type && "value" in t4 && t4.value !== e3.value && (e3.value = null == t4.value ? "" : t4.value), on = null;
};
var sn = { ReactCurrentDispatcher: { current: { readContext: function(n2) {
  return on.__n[n2.__c].props.value;
}, useCallback: q2, useContext: x2, useDebugValue: P2, useDeferredValue: R, useEffect: y2, useId: g2, useImperativeHandle: F2, useInsertionEffect: k3, useLayoutEffect: _2, useMemo: T2, useReducer: p2, useRef: A2, useState: h2, useSyncExternalStore: E2, useTransition: w3 } } };
var hn = "18.3.1";
function vn(n2) {
  return _.bind(null, n2);
}
function dn(n2) {
  return !!n2 && n2.$$typeof === $2;
}
function pn(n2) {
  return dn(n2) && n2.type === b;
}
function mn(n2) {
  return !!n2 && !!n2.displayName && ("string" == typeof n2.displayName || n2.displayName instanceof String) && n2.displayName.startsWith("Memo(");
}
function yn(n2) {
  return dn(n2) ? D.apply(null, arguments) : n2;
}
function _n(n2) {
  return !!n2.__k && (q(null, n2), true);
}
function bn(n2) {
  return n2 && (n2.base || 1 === n2.nodeType && n2) || null;
}
var Sn = function(n2, t4) {
  return n2(t4);
};
var gn = function(n2, t4) {
  return n2(t4);
};
var En = b;
var Cn = dn;
var xn = { useState: h2, useId: g2, useReducer: p2, useEffect: y2, useLayoutEffect: _2, useInsertionEffect: k3, useTransition: w3, useDeferredValue: R, useSyncExternalStore: E2, startTransition: x3, useRef: A2, useImperativeHandle: F2, useMemo: T2, useCallback: q2, useContext: x2, useDebugValue: P2, version: "18.3.1", Children: L2, render: X, hydrate: nn, unmountComponentAtNode: _n, createPortal: Y, createElement: _, createContext: G, createFactory: vn, cloneElement: yn, createRef: m, Fragment: b, isValidElement: dn, isElement: Cn, isFragment: pn, isMemo: mn, findDOMNode: bn, Component: k, PureComponent: I2, memo: N2, forwardRef: A3, flushSync: gn, unstable_batchedUpdates: Sn, StrictMode: En, Suspense: W, SuspenseList: z3, lazy: j3, __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: sn };

// src/view/markdown.js
var h3 = _;
var hostApp = null;
var hostComponent = null;
var hostRenderer = null;
var hoverSource = "";
function setMarkdownHost(host) {
  const value = host && typeof host === "object" ? host : null;
  hostApp = value && value.app ? value.app : null;
  hostComponent = value && value.component ? value.component : null;
  hostRenderer = value && value.MarkdownRenderer ? value.MarkdownRenderer : null;
}
function clearMarkdownHost() {
  hostApp = null;
  hostComponent = null;
  hostRenderer = null;
}
function setHoverSource(id) {
  hoverSource = typeof id === "string" ? id : "";
}
function hoverLink(event, targetEl, href, sourcePath) {
  if (hostApp === null || !hostApp.workspace || typeof hostApp.workspace.trigger !== "function") return false;
  if (hoverSource === "") return false;
  try {
    hostApp.workspace.trigger("hover-link", {
      event,
      source: hoverSource,
      hoverParent: hostComponent,
      targetEl,
      linktext: String(href || ""),
      sourcePath: String(sourcePath || "")
    });
    return true;
  } catch {
    return false;
  }
}
function hasMarkdownHost() {
  return hostApp !== null && hostRenderer !== null;
}
function openLinkInVault(href, sourcePath) {
  if (hostApp === null || !hostApp.workspace || typeof hostApp.workspace.openLinkText !== "function") {
    return false;
  }
  try {
    hostApp.workspace.openLinkText(String(href || ""), String(sourcePath || ""), false);
    return true;
  } catch {
    return false;
  }
}
function closestOf(node, selector) {
  let current = node;
  while (current) {
    if (typeof current.closest === "function") {
      const hit = current.closest(selector);
      if (hit) return hit;
    }
    current = current.parentNode;
  }
  return null;
}
function openExternalUrl(url) {
  try {
    window.open(url, "_blank", "noopener");
  } catch {
  }
}
function MarkdownView(props) {
  const { markdown, sourcePath, className, onOpenLink, onToggleTodo } = props;
  const ref = A2(null);
  y2(() => {
    const el = ref.current;
    if (!el) return void 0;
    let disposed = false;
    const target = el.ownerDocument.createElement("div");
    target.className = "dshgn_mdBody";
    el.textContent = "";
    el.appendChild(target);
    if (!hasMarkdownHost()) {
      target.textContent = String(markdown || "");
      return () => {
        disposed = true;
        if (target.parentNode) target.parentNode.removeChild(target);
      };
    }
    Promise.resolve(hostRenderer.render(hostApp, String(markdown || ""), target, sourcePath || "", hostComponent)).catch(() => {
      if (!disposed) target.textContent = String(markdown || "");
    });
    return () => {
      disposed = true;
      if (target.parentNode) target.parentNode.removeChild(target);
    };
  }, [markdown, sourcePath]);
  const onClick = q2(
    (event) => {
      const anchor = closestOf(event.target, "a");
      if (!anchor) return;
      const href = anchor.getAttribute("data-href") || anchor.getAttribute("href") || "";
      if (href === "") return;
      const internal = anchor.classList.contains("internal-link");
      if (internal) {
        event.preventDefault();
        event.stopPropagation();
        const inEditor = event.ctrlKey || event.metaKey;
        if (typeof onOpenLink === "function" && !inEditor) {
          onOpenLink(href);
          return;
        }
        if (hostApp && hostApp.workspace && typeof hostApp.workspace.openLinkText === "function") {
          hostApp.workspace.openLinkText(href, sourcePath || "", inEditor);
        }
        return;
      }
      if (/^https?:/i.test(href)) {
        event.preventDefault();
        event.stopPropagation();
        openExternalUrl(href);
      }
    },
    [onOpenLink, sourcePath]
  );
  const onMouseOver = q2(
    (event) => {
      const anchor = closestOf(event.target, "a.internal-link");
      if (!anchor) return;
      const href = anchor.getAttribute("data-href") || anchor.getAttribute("href") || "";
      if (href === "") return;
      hoverLink(event, anchor, href, sourcePath);
    },
    [sourcePath]
  );
  const onCheckbox = q2(
    (event) => {
      if (typeof onToggleTodo !== "function") return;
      const box = closestOf(event.target, "input.task-list-item-checkbox");
      if (!box) return;
      if (closestOf(box, "blockquote")) return;
      const container = ref.current;
      if (!container) return;
      const all = Array.from(container.querySelectorAll("input.task-list-item-checkbox"));
      const usable = all.filter((item) => !closestOf(item, "blockquote"));
      const index = usable.indexOf(box);
      if (index < 0) return;
      event.preventDefault();
      onToggleTodo(index);
    },
    [onToggleTodo]
  );
  return h3("div", { ref, className, onClick, onMouseDown: onCheckbox, onMouseOver });
}

// src/view/panel.js
var __apiBase = "";
function setApiOrigin(origin) {
  __apiBase = String(origin || "").replace(/\/+$/, "");
}
function apiOrigin() {
  return __apiBase;
}
var DRAG_MIME = "application/x-getnote-path";
function dragCarriesNote(dataTransfer) {
  if (dataTransfer === null || dataTransfer === void 0) return false;
  const types = dataTransfer.types;
  if (types === null || types === void 0) return false;
  if (typeof types.contains === "function") return types.contains(DRAG_MIME) === true;
  try {
    return Array.prototype.indexOf.call(types, DRAG_MIME) !== -1;
  } catch {
    return false;
  }
}
var __apiToken = "";
function setApiToken(token) {
  __apiToken = String(token || "");
}
function withToken(url) {
  if (__apiToken === "") return url;
  const text = String(url || "");
  if (text === "") return text;
  const sep4 = text.includes("?") ? "&" : "?";
  return `${text}${sep4}t=${encodeURIComponent(__apiToken)}`;
}
var __openExternal = null;
function setOpenExternal(fn2) {
  __openExternal = typeof fn2 === "function" ? fn2 : null;
}
function openExternal(url) {
  if (__openExternal !== null) {
    try {
      if (__openExternal(url) === true) return;
    } catch {
    }
  }
  window.open(url, "_blank", "noopener,width=520,height=760");
}
var __pendingIntent = null;
var __intentListeners = /* @__PURE__ */ new Set();
function requestIntent(intent) {
  if (intent === null || typeof intent !== "object") return;
  if (__intentListeners.size === 0) {
    __pendingIntent = intent;
    return;
  }
  for (const listener of Array.from(__intentListeners)) {
    try {
      listener(intent);
    } catch {
    }
  }
}
function subscribeIntent(listener) {
  __intentListeners.add(listener);
  if (__pendingIntent !== null) {
    const pending = __pendingIntent;
    __pendingIntent = null;
    try {
      listener(pending);
    } catch {
    }
  }
  return () => {
    __intentListeners.delete(listener);
  };
}
var __syncReport = null;
function setSyncReport(fn2) {
  __syncReport = typeof fn2 === "function" ? fn2 : null;
}
function reportSync(result) {
  if (__syncReport === null) return;
  try {
    __syncReport(result);
  } catch {
  }
}
var __saveFile = null;
function setSaveFile(fn2) {
  __saveFile = typeof fn2 === "function" ? fn2 : null;
}
async function saveFile(url, filename) {
  if (__saveFile !== null) {
    try {
      const saved = await __saveFile(url, filename);
      if (saved) return true;
    } catch {
    }
  }
  return false;
}
var __noteMenu = null;
function setNoteMenu(fn2) {
  __noteMenu = typeof fn2 === "function" ? fn2 : null;
}
function showNoteMenu(anchor, items) {
  if (__noteMenu === null) return false;
  try {
    return __noteMenu(anchor, items) !== false;
  } catch {
    return false;
  }
}
var __confirm = null;
function setConfirmDialog(fn2) {
  __confirm = typeof fn2 === "function" ? fn2 : null;
}
function confirmDialog(message) {
  if (__confirm !== null) {
    try {
      return Promise.resolve(__confirm(String(message))).then(
        (value) => value === true,
        () => window.confirm(String(message))
      );
    } catch {
    }
  }
  try {
    return Promise.resolve(window.confirm(String(message)) === true);
  } catch {
    return Promise.resolve(false);
  }
}
var __openInEditor = null;
function setOpenInEditor(fn2) {
  __openInEditor = typeof fn2 === "function" ? fn2 : null;
}
function hasOpenInEditor() {
  return __openInEditor !== null;
}
function openInEditor(path) {
  if (__openInEditor === null) return false;
  try {
    return __openInEditor(String(path || "")) === true;
  } catch {
    return false;
  }
}
var __markdownLink = null;
function setMarkdownLink(fn2) {
  __markdownLink = typeof fn2 === "function" ? fn2 : null;
}
function markdownLinkOf(path, subpath) {
  if (__markdownLink === null) return "";
  try {
    const text = __markdownLink(String(path || ""), String(subpath || ""));
    return typeof text === "string" ? text : "";
  } catch {
    return "";
  }
}
var __assetUrl = null;
function setAssetUrl(fn2) {
  __assetUrl = typeof fn2 === "function" ? fn2 : null;
}
function assetUrlOf(path) {
  if (__assetUrl === null) return "";
  try {
    const url = __assetUrl(String(path || ""));
    return typeof url === "string" ? url : "";
  } catch {
    return "";
  }
}
var __revealInVault = null;
function setRevealInVault(fn2) {
  __revealInVault = typeof fn2 === "function" ? fn2 : null;
}
function hasRevealInVault() {
  return __revealInVault !== null;
}
function revealInVault(path) {
  if (__revealInVault === null) return false;
  try {
    return __revealInVault(String(path || "")) === true;
  } catch {
    return false;
  }
}
var __dailyNote = null;
function setDailyNote(fn2) {
  __dailyNote = typeof fn2 === "function" ? fn2 : null;
}
function dailyNoteOf() {
  if (__dailyNote === null) return null;
  let raw = "";
  try {
    const answer = __dailyNote();
    raw = typeof answer === "string" ? answer : "";
  } catch {
    return null;
  }
  const clean = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (clean === "") return null;
  const cut = clean.lastIndexOf("/");
  const title = clean.slice(cut + 1).replace(/\.md$/i, "");
  if (title === "") return null;
  return { dir: cut < 0 ? "" : clean.slice(0, cut), title };
}
var __linkResolve = null;
function setLinkResolve(fn2) {
  __linkResolve = typeof fn2 === "function" ? fn2 : null;
}
function resolveViaHost(linkpath, sourcePath) {
  if (__linkResolve === null) return "";
  try {
    const answer = __linkResolve(String(linkpath || ""), String(sourcePath || ""));
    return typeof answer === "string" ? answer : "";
  } catch {
    return "";
  }
}
var __newNotePlacement = null;
function setNewNotePlacement(fn2) {
  __newNotePlacement = typeof fn2 === "function" ? fn2 : null;
}
function newNotePlacementOf() {
  if (__newNotePlacement === null) return "";
  try {
    const answer = __newNotePlacement();
    return typeof answer === "string" ? answer.replace(/^\/+|\/+$/g, "") : "";
  } catch {
    return "";
  }
}
var __dailyTemplate = null;
function setDailyTemplate(fn2) {
  __dailyTemplate = typeof fn2 === "function" ? fn2 : null;
}
async function dailyTemplateOf() {
  if (__dailyTemplate === null) return "";
  try {
    const answer = await __dailyTemplate();
    return typeof answer === "string" ? answer : "";
  } catch {
    return "";
  }
}
var __openAsset = null;
function setOpenAsset(fn2) {
  __openAsset = typeof fn2 === "function" ? fn2 : null;
}
function hasOpenAsset() {
  return __openAsset !== null;
}
function openAssetInHost(path) {
  if (__openAsset === null) return false;
  try {
    return __openAsset(String(path || "")) === true;
  } catch {
    return false;
  }
}
var __renameNote = null;
function setRenameNote(fn2) {
  __renameNote = typeof fn2 === "function" ? fn2 : null;
}
function hasRenameNote() {
  return __renameNote !== null;
}
async function renameNoteInHost(path) {
  if (__renameNote === null) return "";
  try {
    const answer = await __renameNote(String(path || ""));
    return typeof answer === "string" ? answer : "";
  } catch {
    return "";
  }
}
var __cssListeners = /* @__PURE__ */ new Set();
function notifyCssChange() {
  for (const listener of Array.from(__cssListeners)) {
    try {
      listener();
    } catch {
    }
  }
}
function subscribeCssChange(listener) {
  __cssListeners.add(listener);
  return () => __cssListeners.delete(listener);
}
var __vaultListeners = /* @__PURE__ */ new Set();
function notifyVaultChange(change) {
  for (const listener of Array.from(__vaultListeners)) {
    try {
      listener(change);
    } catch {
    }
  }
}
function subscribeVaultChange(listener) {
  if (typeof listener !== "function") return () => {
  };
  __vaultListeners.add(listener);
  return () => __vaultListeners.delete(listener);
}
var __statusReport = null;
function setStatusReport(fn2) {
  __statusReport = typeof fn2 === "function" ? fn2 : null;
}
function reportStatus(info) {
  if (__statusReport === null) return;
  try {
    __statusReport(info);
  } catch {
  }
}
var __graph = null;
function setVaultGraph(fn2) {
  __graph = typeof fn2 === "function" ? fn2 : null;
}
function backlinksViaHost(path) {
  if (__graph === null) return null;
  try {
    const result = __graph(String(path || ""), "backlinks");
    return result === void 0 || result === null ? null : result;
  } catch {
    return null;
  }
}
function linksViaHost(path) {
  if (__graph === null) return null;
  try {
    const result = __graph(String(path || ""), "links");
    if (result !== null && typeof result === "object" && typeof result.then === "function") return null;
    return result === void 0 || result === null ? null : result;
  } catch {
    return null;
  }
}
var h4 = _;
var NS = "dsh-getnote";
var STYLE_ID = "dshgn-style";
var LEX = {
  zh: {
    "panel.title": "\u5F97\u5230\u5927\u8111",
    "panel.toggleTree": "\u76EE\u5F55\u9762\u677F",
    "panel.hint": "\u672C\u5730\u7B14\u8BB0\u5E93",
    "tab.notes": "\u7B14\u8BB0",
    "tab.import": "\u5BFC\u5165",
    "tab.settings": "\u8BBE\u7F6E",
    "action.refresh": "\u5237\u65B0",
    "action.new": "\u65B0\u5EFA",
    "action.save": "\u4FDD\u5B58",
    "action.cancel": "\u53D6\u6D88",
    "action.edit": "\u7F16\u8F91",
    "action.openInEditor": "\u5728 Obsidian \u91CC\u6253\u5F00",
    "action.delete": "\u5220\u9664",
    "action.copyRef": "\u590D\u5236\u5F15\u7528",
    "action.copy": "\u590D\u5236",
    "note.copyBlock": "\u590D\u5236\u8FD9\u4E00\u6BB5",
    "action.rename": "\u91CD\u547D\u540D",
    "action.renamed": "\u6539\u597D\u4E86",
    "note.duplicate": "\u590D\u5236\u8FD9\u4E00\u7BC7",
    "note.duplicated": "\u5DF2\u590D\u5236\u4E00\u4EFD",
    "note.renameUnsaved": "\u5148\u4FDD\u5B58\u518D\u6539\u540D\uFF0C\u522B\u628A\u521A\u5199\u7684\u4E22\u4E86",
    "action.copied": "\u5DF2\u590D\u5236",
    "action.retry": "\u91CD\u8BD5",
    "search.placeholder": "\u641C\u7D22\u6807\u9898\u3001\u6B63\u6587\u3001\u6807\u7B7E\u2026",
    "search.hint": "\u53EF\u4EE5\u52A0\u9650\u5B9A\uFF1Atag:\u5F55\u97F3\u5361 \xB7 dir:\u968F\u624B\u8BB0 \xB7 #\u79C1\u5BC6\u3002\u591A\u4E2A\u8BCD\u8981\u540C\u65F6\u547D\u4E2D\uFF1B\u5F15\u53F7\u5305\u4F4F\u7684\u4E00\u4E32\u8981\u8FDE\u7740\u51FA\u73B0\uFF0C\u524D\u9762\u52A0\u51CF\u53F7\u5C31\u662F\u4E0D\u8981\u5B83\u3002",
    "search.jumpToLine": "\u8DF3\u5230\u8FD9\u4E00\u884C",
    "batch.pick": "\u9009\u62E9\u8FD9\u7BC7",
    "batch.picked": "\u7BC7\u5DF2\u9009",
    "batch.actions": "\u6279\u91CF\u64CD\u4F5C",
    "batch.clear": "\u53D6\u6D88\u9009\u62E9",
    "batch.tagPlaceholder": "\u8981\u6DFB\u52A0\u7684\u6807\u7B7E",
    "batch.addTag": "\u52A0\u6807\u7B7E",
    "batch.removeTag": "\u53BB\u6807\u7B7E",
    "batch.tagRemovePlaceholder": "\u8981\u53BB\u6389\u7684\u6807\u7B7E",
    "batch.dirPlaceholder": "\u76EE\u6807\u76EE\u5F55",
    "batch.tagPick": "\u586B\u8FDB\u6807\u7B7E\u6846",
    "batch.dirPick": "\u586B\u8FDB\u76EE\u6807\u76EE\u5F55",
    "batch.move": "\u79FB\u52A8",
    "batch.delete": "\u79FB\u5230\u56DE\u6536\u7AD9",
    "batch.confirmDelete": "\u786E\u5B9A\u628A\u8FD9 \u7BC7\u79FB\u5230\u56DE\u6536\u7AD9\uFF1F",
    "drop.pickDirFirst": "\u5148\u5728\u5DE6\u8FB9\u9009\u4E00\u4E2A\u76EE\u5F55\uFF0C\u518D\u5F80\u91CC\u62D6",
    "drop.moved": "\u5DF2\u7ECF\u632A\u8FDB\u8FD9\u4E2A\u76EE\u5F55",
    "batch.done": "\u5DF2\u5904\u7406",
    "search.searching": "\u641C\u7D22\u4E2D\u2026",
    "search.clear": "\u6E05\u7A7A",
    "tree.all": "\u5168\u90E8\u7B14\u8BB0",
    "tree.dirs": "\u76EE\u5F55",
    "tree.tags": "\u6807\u7B7E",
    // 左栏排序：三种视角，用户的库越大越依赖这个
    "tree.sort": "\u6392\u5E8F",
    "tree.sortTime": "\u6309\u4FEE\u6539\u65F6\u95F4",
    "tree.sortName": "\u6309\u540D\u79F0",
    "tree.sortCount": "\u6309\u6761\u6570",
    // 中栏列表的排序：只有「最近改的」和「名字好找」两档
    "list.sort": "\u6392\u5E8F",
    "list.sortTime": "\u6700\u8FD1\u6539\u7684\u5728\u524D",
    "list.sortName": "\u6309\u540D\u79F0",
    // 筛选条：左栏点了目录或标签之后，中栏得说清「现在筛的是什么」
    "filter.clear": "\u53BB\u6389\u8FD9\u4E2A\u7B5B\u9009",
    // 快捷键速查表：面板里能按的键散在编辑区提示、按钮 title 里，
    // 谁也不会一个个去发现，得有一张能随时翻开的表
    "help.open": "\u952E\u76D8\u5FEB\u6377\u952E",
    "help.title": "\u952E\u76D8\u5FEB\u6377\u952E",
    "help.hint": "\u9762\u677F\u91CC\u7684\u952E\u90FD\u80FD\u7528 Ctrl\uFF0CMac \u4E0A\u6362\u6210 Cmd\u3002",
    "help.search": "\u805A\u7126\u641C\u7D22\u6846",
    "help.searchEnter": "\u5728\u641C\u7D22\u7ED3\u679C\u4E0A\u56DE\u8F66\u5C31\u6253\u5F00\u7B2C\u4E00\u7BC7\uFF0CEsc \u9000\u56DE\u6574\u4EFD\u5217\u8868",
    "help.new": "\u65B0\u5EFA\u7B14\u8BB0",
    "help.move": "\u4E0A\u4E0B\u4E00\u7BC7",
    "help.nav": "\u56DE\u4E0A\u4E00\u7BC7 / \u53BB\u4E0B\u4E00\u7BC7",
    "help.find": "\u5C31\u5730\u67E5\u627E",
    "help.edit": "\u8FDB\u7F16\u8F91 / \u5B58\u597D\u9000\u51FA",
    "help.save": "\u4FDD\u5B58",
    "help.esc": "\u53D6\u6D88\u7F16\u8F91\u3001\u6536\u8D77\u67E5\u627E\u6761",
    "help.format": "\u52A0\u7C97 / \u659C\u4F53 / \u5220\u9664\u7EBF",
    "help.pick": "\u628A\u8FD9\u4E00\u7BC7\u9009\u8FDB\u6279\u91CF\u64CD\u4F5C\uFF08Esc \u53D6\u6D88\u9009\u62E9\uFF09",
    "help.indent": "\u6E05\u5355\u7F29\u8FDB",
    "help.complete": "\u53CC\u94FE\u3001\u6807\u7B7E\u8865\u5168",
    "help.help": "\u6253\u5F00\u8FD9\u5F20\u8868",
    // 三栏拖拽手柄的无障碍名字（视觉上是一条发丝线，读屏要能说出它是什么）
    "col.treeWidth": "\u8C03\u6574\u5DE6\u680F\u5BBD\u5EA6",
    "col.listWidth": "\u8C03\u6574\u4E2D\u680F\u5BBD\u5EA6",
    // 目录 / 标签的增删
    "tree.newDir": "\u65B0\u5EFA\u76EE\u5F55",
    "tree.newDirHint": "\u8F93\u5165\u76EE\u5F55\u540D\uFF0C\u591A\u5C42\u7528 / \u5206\u9694",
    "tree.newTag": "\u65B0\u5EFA\u6807\u7B7E",
    "tree.newTagHint": "\u8F93\u5165\u6807\u7B7E\u540D\uFF0C\u56DE\u8F66\u521B\u5EFA",
    "tree.deleteDir": "\u5220\u9664\u76EE\u5F55",
    "tree.deleteTag": "\u5220\u9664\u6807\u7B7E",
    "tree.deleteDirConfirm": "\u786E\u5B9A\u5220\u9664\u76EE\u5F55\u300C{name}\u300D\uFF1F\u76EE\u5F55\u91CC\u5FC5\u987B\u6CA1\u6709\u7B14\u8BB0\u548C\u5B50\u76EE\u5F55\u3002",
    "tree.deleteTagConfirm": "\u786E\u5B9A\u5220\u9664\u6807\u7B7E\u300C{name}\u300D\uFF1F\u4F1A\u4ECE\u6240\u6709\u7B14\u8BB0\u91CC\u79FB\u9664\u8FD9\u4E2A\u6807\u7B7E\uFF0C\u7B14\u8BB0\u672C\u8EAB\u4E0D\u52A8\u3002",
    "tree.deletedDir": "\u76EE\u5F55\u5DF2\u5220\u9664",
    "tree.deletedTag": "\u6807\u7B7E\u5DF2\u79FB\u9664",
    "tree.dirNotEmpty": "\u8FD9\u4E2A\u76EE\u5F55\u91CC\u8FD8\u6709\u7B14\u8BB0\uFF0C\u5148\u628A\u5B83\u4EEC\u79FB\u8D70",
    "tree.fold": "\u6536\u8D77\u5B50\u76EE\u5F55",
    "tree.unfold": "\u5C55\u5F00\u5B50\u76EE\u5F55",
    "tree.dirCreated": "\u76EE\u5F55\u5DF2\u521B\u5EFA\uFF08\u7A7A\u76EE\u5F55\u6682\u65F6\u4E0D\u663E\u793A\u5728\u5217\u8868\u91CC\uFF09",
    "tree.movedTo": "\u5DF2\u632A\u5230 {dir}",
    "tree.tagCreated": "\u6807\u7B7E\u5DF2\u6DFB\u52A0\u5230\u5F53\u524D\u7B14\u8BB0",
    "tree.tagNeedNote": "\u5148\u6253\u5F00\u4E00\u7BC7\u7B14\u8BB0\u518D\u5EFA\u6807\u7B7E",
    "tree.menuDelete": "\u5220\u9664",
    "tree.menuCancel": "\u53D6\u6D88",
    "tree.menuRename": "\u6539\u540D",
    "tree.menuReveal": "\u5728\u6587\u4EF6\u5217\u8868\u91CC\u5B9A\u4F4D",
    "tree.tagRenamed": "\u6807\u7B7E\u5DF2\u6539\u540D",
    "tree.dirRenamed": "\u76EE\u5F55\u5DF2\u6539\u540D",
    "todo.toggle": "\u70B9\u4E00\u4E0B\u52FE\u6389",
    "todo.done": "\u5DF2\u52FE\u6389",
    "todo.undone": "\u5DF2\u53D6\u6D88\u52FE\u9009",
    "heat.title": "\u5199\u4F5C\u70ED\u529B\u56FE",
    "heat.streak": "\u5929\u8FDE\u7EED",
    "heat.unit": "\u7BC7",
    "heat.totalHint": "\u7BC7\uFF08\u8FD1\u534A\u5E74\uFF09",
    "empty.noVault": "\u8FD8\u6CA1\u6709\u672C\u5730\u7B14\u8BB0\u5E93",
    "empty.noVaultDesc": "\u5148\u5728\u300C\u8BBE\u7F6E\u300D\u91CC\u6307\u5B9A\u4E00\u4E2A\u76EE\u5F55\uFF0C\u6216\u8005\u70B9\u300C\u5BFC\u5165\u300D\u628A\u5F97\u5230\u5927\u8111\u7684\u7B14\u8BB0\u6293\u4E0B\u6765\u3002",
    "empty.noNotes": "\u8FD9\u4E2A\u76EE\u5F55\u8FD8\u6CA1\u6709\u7B14\u8BB0",
    "list.more": "\u663E\u793A\u66F4\u591A",
    "empty.select": "\u9009\u4E00\u7BC7\u7B14\u8BB0\u5F00\u59CB\u9605\u8BFB",
    "empty.selectDesc": "\u5DE6\u680F\u662F\u76EE\u5F55\uFF0C\u4E2D\u95F4\u662F\u7B14\u8BB0\u5217\u8868\u3002\u4E5F\u53EF\u4EE5\u70B9\u300C\u65B0\u5EFA\u300D\u5199\u4E00\u7BC7\u3002",
    "empty.search": "\u6CA1\u6709\u5339\u914D\u7684\u7B14\u8BB0",
    "meta.notes": "\u7BC7",
    "meta.dirs": "\u4E2A\u76EE\u5F55",
    "reader.missing": "\u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u79FB\u52A8",
    "reader.frontmatter": "\u5C5E\u6027",
    "reader.words": "{n} \u5B57",
    "reader.minutes": "\u7EA6 {n} \u5206\u949F\u8BFB\u5B8C",
    "import.title": "\u4E00\u6B21\u6027\u5BFC\u5165",
    "import.desc": "\u8D81\u5F97\u5230\u5927\u8111\u4F1A\u5458\u8FD8\u6709\u6548\uFF0C\u628A\u4E91\u7AEF\u7B14\u8BB0\u5168\u91CF\u6293\u6210\u672C\u5730 Markdown\u3002\u4E4B\u540E\u4F1A\u5458\u5230\u671F\u3001\u65AD\u7F51\u3001\u751A\u81F3\u670D\u52A1\u4E0B\u7EBF\uFF0C\u8FD9\u91CC\u7684\u7B14\u8BB0\u90FD\u7167\u5E38\u80FD\u8BFB\u80FD\u6539 \u2014\u2014 \u5BFC\u5165\u662F\u672C\u63D2\u4EF6\u552F\u4E00\u4F1A\u8054\u7F51\u7684\u52A8\u4F5C\u3002",
    "import.loggedIn": "\u5DF2\u8FDE\u63A5\u5F97\u5230\u5927\u8111",
    "import.notLoggedIn": "\u672A\u8FDE\u63A5",
    "import.login": "\u767B\u5F55\u5F97\u5230\u5927\u8111",
    "import.loginHint": "\u4F1A\u6253\u5F00\u6D4F\u89C8\u5668\u5B8C\u6210\u6388\u6743\uFF0C\u5B8C\u6210\u540E\u56DE\u5230\u8FD9\u4E2A\u9762\u677F\u5373\u53EF\u3002",
    "import.start": "\u5F00\u59CB\u5BFC\u5165",
    "import.running": "\u6B63\u5728\u5BFC\u5165\u2026",
    "import.logout": "\u9000\u51FA\u767B\u5F55",
    "import.result": "\u5BFC\u5165\u7ED3\u679C",
    "import.lastSync": "\u4E0A\u6B21\u5BFC\u5165",
    "import.never": "\u4ECE\u672A\u5BFC\u5165",
    "import.done": "\u5B8C\u6210",
    "import.newNotes": "\u65B0\u589E",
    "import.skipped": "\u5DF2\u5B58\u5728\u8DF3\u8FC7",
    "import.failed": "\u5931\u8D25",
    "import.authorizeWait": "\u7B49\u5F85\u6D4F\u89C8\u5668\u6388\u6743\u2026",
    "import.openLink": "\u5982\u679C\u6CA1\u6709\u81EA\u52A8\u6253\u5F00\uFF0C\u70B9\u8FD9\u91CC\u624B\u52A8\u6388\u6743",
    "import.needLogin": "\u5148\u767B\u5F55\u5F97\u5230\u5927\u8111\uFF0C\u624D\u80FD\u8BFB\u53D6\u4E91\u7AEF\u7B14\u8BB0\u3002",
    "import.cloudHint": "\u8FD9\u4E00\u6B65\u4E4B\u540E\u5C31\u4E0D\u518D\u9700\u8981\u4F1A\u5458\u4E86\u3002",
    "settings.vault": "\u7B14\u8BB0\u76EE\u5F55",
    "settings.vaultHint": "\u76F8\u5BF9\u5E93\u6839\u7684\u76EE\u5F55\u540D\uFF0C\u6BD4\u5982\u300C\u5F97\u5230\u5927\u8111\u300D\u6216\u300C\u7B14\u8BB0/\u77E5\u8BC6\u5E93/\u5F97\u5230\u5927\u8111\u5F52\u6863\u300D\u3002\u53EA\u80FD\u9009\u5E93\u5185\u7684\u76EE\u5F55\uFF0C\u63D2\u4EF6\u4E0D\u4F1A\u5199\u5230\u5E93\u5916\u9762\u53BB\u3002",
    "settings.save": "\u4FDD\u5B58\u76EE\u5F55",
    "settings.saved": "\u5DF2\u4FDD\u5B58",
    "settings.suggest": "\u5728\u8FD9\u4E2A\u4F4D\u7F6E\u53D1\u73B0\u4E86\u5DF2\u6709\u7B14\u8BB0",
    "settings.use": "\u7528\u8FD9\u4E2A",
    "settings.authFile": "\u51ED\u8BC1\u6587\u4EF6",
    "settings.loggedIn": "\u5DF2\u767B\u5F55",
    "settings.loggedOut": "\u672A\u767B\u5F55",
    "settings.loginExpired": "\u767B\u5F55\u5DF2\u8FC7\u671F",
    "settings.storeHint": "\u767B\u5F55\u51ED\u8BC1\u53EA\u4FDD\u5B58\u5728\u672C\u673A DSH \u914D\u7F6E\u76EE\u5F55\uFF0C\u4E0D\u51FA\u73B0\u5728\u6D4F\u89C8\u5668\u91CC\u3002",
    "theme.title": "\u9762\u677F\u4E3B\u9898\u8272",
    "theme.desc": "\u9009\u4E00\u4E2A\u989C\u8272\uFF0C\u5DE6\u680F\u6700\u6DF1\u3001\u4E2D\u680F\u6D45\u4E00\u70B9\u3001\u53F3\u680F\u63A5\u8FD1\u767D\uFF0C\u5C42\u6B21\u4F1A\u81EA\u52A8\u7B97\u597D\u3002\u6539\u5B8C\u70B9\u300C\u5E94\u7528\u300D\u624D\u4F1A\u4FDD\u5B58\u3002",
    "theme.custom": "\u81EA\u5B9A\u4E49\u989C\u8272",
    "theme.preset": "\u7528\u9884\u8BBE\u8272",
    "theme.apply": "\u5E94\u7528",
    "theme.reset": "\u6062\u590D\u9ED8\u8BA4\u84DD",
    "theme.saved": "\u4E3B\u9898\u8272\u5DF2\u4FDD\u5B58",
    "theme.previewLeft": "\u5DE6\u680F",
    "theme.previewMid": "\u4E2D\u680F",
    "theme.previewRight": "\u53F3\u680F",
    "error.prefix": "\u51FA\u9519\u4E86",
    "capture.title": "\u901F\u8BB0",
    "capture.saved": "\u5DF2\u5B58\u4E3A\u7B14\u8BB0",
    "note.created": "\u5DF2\u65B0\u5EFA",
    "note.saved": "\u5DF2\u4FDD\u5B58",
    "note.deleted": "\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9",
    "note.unsaved": "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539",
    // 没存完的草稿救回来时用的三句。{when} 换成「几月几号几点」。
    "draft.found": "\u4E0A\u6B21\u5199\u5230\u4E00\u534A\u6CA1\u5B58\uFF08{when}\uFF09",
    "draft.resume": "\u63A5\u7740\u5199",
    "draft.discard": "\u4E22\u6389",
    "draft.discarded": "\u8349\u7A3F\u5DF2\u4E22\u6389",
    "note.menuOpen": "\u6253\u5F00\u8FD9\u7BC7",
    "note.localAudio": "\u672C\u5730\u5F55\u97F3",
    "note.outline": "\u672C\u6587\u5927\u7EB2",
    "note.copyHeadingLink": "\u590D\u5236\u6307\u5411\u8FD9\u4E00\u8282\u7684\u94FE\u63A5",
    "note.openImage": "\u5728 Obsidian \u91CC\u6253\u5F00\u8FD9\u5F20\u56FE",
    "note.zoomImage": "\u70B9\u5F00\u770B\u5927\u56FE",
    "zoom.prev": "\u4E0A\u4E00\u5F20",
    "zoom.next": "\u4E0B\u4E00\u5F20",
    "zoom.count": "{n} / {total}",
    "note.navBack": "\u56DE\u4E0A\u4E00\u7BC7",
    "note.navForward": "\u53BB\u4E0B\u4E00\u7BC7",
    "note.find": "\u5728\u8FD9\u7BC7\u91CC\u627E",
    "note.findPlaceholder": "\u627E\u4EC0\u4E48\u2026",
    "note.findInEditor": "\u5728\u6B63\u6587\u91CC\u627E\u4EC0\u4E48\u2026",
    "note.findNext": "\u627E\u4E0B\u4E00\u5904",
    "note.findPrev": "\u627E\u4E0A\u4E00\u5904",
    "note.findMiss": "\u8FD9\u7BC7\u91CC\u6CA1\u6709\u300C{text}\u300D",
    "note.findEnd": "\u5DF2\u7ECF\u5230\u5934\u4E86",
    "note.attach": "\u63D2\u5165\u9644\u4EF6",
    "attach.added": "\u9644\u4EF6\u5DF2\u63D2\u5165",
    "attach.failed": "\u6709\u51E0\u4E2A\u9644\u4EF6\u6CA1\u4F20\u4E0A\u53BB",
    "attach.needNote": "\u5148\u6253\u5F00\u4E00\u7BC7\u7B14\u8BB0\uFF0C\u518D\u5F80\u91CC\u653E\u6587\u4EF6",
    "note.backlinks": "\u5F15\u7528\u4E86\u8FD9\u7BC7\u7684\u7B14\u8BB0",
    "note.backlinkJump": "\u53BB\u8FD9\u4E00\u53E5",
    "sel.newNote": "\u5B58\u6210\u65B0\u7B14\u8BB0",
    "note.outlinks": "\u8FD9\u7BC7\u5F15\u7528\u4E86",
    "note.fontSize": "\u5B57\u53F7",
    "panel.loading": "\u6B63\u5728\u8BFB\u53D6\u7B14\u8BB0\u5E93\u2026",
    "sync.pushOne": "\u628A\u8FD9\u7BC7\u63A8\u5230\u4E91\u7AEF",
    "sync.pullOne": "\u4ECE\u4E91\u7AEF\u62C9\u8FD9\u7BC7",
    "sync.pushedOne": "\u5DF2\u63A8\u5230\u4E91\u7AEF",
    "sync.pulledOne": "\u5DF2\u4ECE\u4E91\u7AEF\u66F4\u65B0",
    "new.template": "\u65B0\u5EFA\u4EC0\u4E48",
    "new.pickDir": "\u5EFA\u5230\u54EA\u4E2A\u76EE\u5F55",
    "new.dirPick": "\u5EFA\u5230\u8FD9\u4E2A\u76EE\u5F55",
    "new.daily": "\u65E5\u8BB0",
    "new.dailyHint": "\u4ECA\u5929\u53D1\u751F\u4E86\u4EC0\u4E48",
    "new.book": "\u8BFB\u4E66\u7B14\u8BB0",
    "new.bookHint": "\u4E66\u540D\u4E0E\u611F\u60F3",
    "new.meeting": "\u4F1A\u8BAE\u8BB0\u5F55",
    "new.meetingHint": "\u8BA8\u8BBA\u4E0E\u7ED3\u8BBA",
    "new.note": "\u968F\u624B\u8BB0",
    "new.noteHint": "\u53EA\u6709\u6807\u9898",
    "new.customHint": "\u7528\u4F60\u81EA\u5DF1\u5199\u7684\u9AA8\u67B6",
    "settings.templateTitle": "\u7B14\u8BB0\u6A21\u677F",
    "settings.templateDesc": "\u81EA\u5DF1\u6512\u51E0\u4E2A\u5E38\u7528\u7684\u9AA8\u67B6\uFF0C\u65B0\u5EFA\u65F6\u76F4\u63A5\u9009\u3002\u5185\u7F6E\u7684\u65E5\u8BB0 / \u8BFB\u4E66 / \u4F1A\u8BAE / \u968F\u624B\u8BB0\u4E00\u76F4\u5728\u3002",
    "settings.templateName": "\u6A21\u677F\u540D",
    "settings.templateNameHint": "\u65B0\u5EFA\u65F6\u83DC\u5355\u91CC\u663E\u793A\u8FD9\u4E2A\u540D\u5B57",
    "settings.templateBody": "\u9AA8\u67B6\u6B63\u6587",
    "settings.templateBodyHint": "\u7559\u7A7A\u5C31\u662F\u53EA\u6709\u6807\u9898\uFF1B\u652F\u6301 Markdown",
    "settings.templateAdd": "\u52A0\u4E00\u4E2A\u6A21\u677F",
    "settings.templateSave": "\u4FDD\u5B58\u6A21\u677F",
    "settings.templateSaved": "\u6A21\u677F\u5DF2\u4FDD\u5B58",
    "settings.templateEmpty": "\u8FD8\u6CA1\u6709\u81EA\u5B9A\u4E49\u6A21\u677F",
    "settings.templateLimit": "\u6700\u591A 12 \u4E2A",
    "settings.templateRemove": "\u5220\u6389",
    "settings.followTitle": "\u8DDF\u7740\u5BBF\u4E3B\u5207\u6362\u7B14\u8BB0",
    "settings.followDesc": "\u4F60\u5728 Obsidian \u91CC\u7FFB\u5230\u54EA\u4E00\u7BC7\uFF0C\u5F00\u7740\u7684\u9762\u677F\u5C31\u8DDF\u7740\u6253\u5F00\u540C\u4E00\u7BC7\uFF0C\u53CD\u94FE\u548C\u540C\u6B65\u72B6\u6001\u7ACB\u523B\u8DDF\u4E0A\u3002\u9762\u677F\u6CA1\u5F00\u7740\u65F6\u4E0D\u4F1A\u66FF\u4F60\u6253\u5F00\u5B83\uFF1B\u4E0D\u5728\u300C\u5F97\u5230\u5927\u8111\u300D\u76EE\u5F55\u91CC\u7684\u7B14\u8BB0\u4E5F\u4E0D\u4F1A\u8DDF\u3002",
    "settings.followToggle": "\u9762\u677F\u8DDF\u7740\u6211\u7FFB",
    "settings.followSaved": "\u8DDF\u968F\u8BBE\u7F6E\u5DF2\u4FDD\u5B58",
    "new.bookTitle": "\u8BFB\u4E66\u7B14\u8BB0",
    "new.meetingTitle": "\u4F1A\u8BAE\u8BB0\u5F55",
    "note.fontSize.s": "\u5C0F\u5B57",
    "note.fontSize.m": "\u6807\u51C6",
    "note.fontSize.l": "\u5927\u5B57",
    "note.wikilinkMissing": "\u5E93\u91CC\u627E\u4E0D\u5230\u300C{name}\u300D\u8FD9\u7BC7\u7B14\u8BB0",
    "note.anchorMissing": "\u8FD9\u4E00\u7BC7\u91CC\u6CA1\u6709\u300C{name}\u300D\u8FD9\u4E00\u8282",
    "note.blockRef": "\u672C\u9875\u67D0\u4E00\u6BB5",
    "note.pickTag": "\u7B5B\u8FD9\u4E2A\u6807\u7B7E",
    "note.footnote": "\u8DF3\u5230\u8FD9\u6761\u811A\u6CE8",
    "note.footnoteBack": "\u56DE\u5230\u5F15\u7528\u5B83\u7684\u5730\u65B9",
    "note.openEmbed": "\u6253\u5F00\u8FD9\u4E00\u7BC7",
    "note.embedBroken": "\u8FD9\u4E00\u7BC7\u6CA1\u8BFB\u51FA\u6765",
    "callout.expand": "\u5C55\u5F00",
    "editor.words": "{n} \u5B57",
    "editor.saveHint": "Ctrl+S \u4FDD\u5B58 \xB7 Ctrl+E \u5B58\u597D\u9000\u51FA \xB7 Esc \u53D6\u6D88 \xB7 Ctrl+B \u52A0\u7C97 \xB7 Ctrl+I \u659C\u4F53 \xB7 Ctrl+F \u67E5\u627E",
    "callout.collapse": "\u6536\u8D77",
    "note.image": "\u56FE\u7247",
    "action.close": "\u5173\u95ED",
    "action.back": "\u8FD4\u56DE\u5217\u8868",
    "history.title": "\u7248\u672C\u5386\u53F2",
    "history.restore": "\u6062\u590D\u8FD9\u4E00\u7248",
    "history.empty": "\u8FD8\u6CA1\u6709\u5386\u53F2\u7248\u672C",
    "history.emptyHint": "\u4FDD\u5B58\u6216\u5220\u9664\u7B14\u8BB0\u65F6\u63D2\u4EF6\u4F1A\u81EA\u52A8\u7559\u4E00\u7248\u5FEB\u7167\uFF0C\u6700\u591A\u7559\u6700\u8FD1 10 \u7248\u3002",
    "archive.title": "\u6574\u5E93\u5907\u4EFD",
    "archive.desc": "\u5BFC\u51FA\u6210\u4E00\u4E2A zip\uFF08\u542B\u9644\u4EF6\uFF09\uFF0C\u6362\u7535\u8111\u6216\u91CD\u88C5\u65F6\u5BFC\u56DE\u6765\u3002\u5BFC\u5165\u9010\u7BC7\u5408\u5E76\uFF0C\u4E0D\u8986\u76D6\u4F60\u5DF2\u6709\u7684\u7B14\u8BB0\u3002",
    "archive.export": "\u5BFC\u51FA zip",
    "archive.import": "\u5BFC\u5165 zip",
    "archive.exporting": "\u6B63\u5728\u5BFC\u51FA\u2026",
    "archive.exported": "\u5DF2\u5BFC\u51FA\u5F52\u6863\u5305",
    "archive.scope": "\u5BFC\u51FA\u8303\u56F4",
    "archive.scopeAll": "\u6574\u5E93",
    "archive.scopeNotes": "\u53EA\u8981\u6587\u5B57",
    "archive.scopeAssets": "\u53EA\u8981\u9644\u4EF6",
    "archive.imported": "\u5BFC\u5165\u5B8C\u6210\uFF1A\u65B0\u589E/\u8DF3\u8FC7",
    "archive.importMode": "\u540C\u540D\u65F6",
    "archive.mode.rename": "\u53E6\u5B58\u4E00\u4EFD",
    "archive.mode.skip": "\u8DF3\u8FC7",
    "tab.conflict": "\u51B2\u7A81",
    "conflict.desc": "\u540C\u6B65\u65F6\u5982\u679C\u4E91\u7AEF\u548C\u672C\u5730\u90FD\u6539\u8FC7\u540C\u4E00\u7BC7\uFF0C\u672C\u5730\u7248\u4F1A\u53E6\u5B58\u5230 .conflicts/\uFF0C\u6B63\u6587\u7528\u4E91\u7AEF\u7248\u3002\u8FD9\u91CC\u53EF\u4EE5\u5E76\u6392\u6BD4\u5BF9\u3001\u4E00\u952E\u91C7\u7EB3\u4EFB\u610F\u4E00\u8FB9\u3002\u91C7\u7EB3\u540E\u7559\u6863\u4E0D\u4F1A\u5220\uFF0C\u968F\u65F6\u53EF\u4EE5\u518D\u6362\u3002",
    "conflict.compare": "\u6BD4\u5BF9",
    "conflict.keepLocal": "\u7528\u6211\u7684\u672C\u5730\u7248",
    "conflict.takeCloud": "\u7528\u4E91\u7AEF\u7248",
    "conflict.back": "\u8FD4\u56DE",
    "conflict.keptLocal": "\u5DF2\u91C7\u7EB3\u672C\u5730\u7248",
    "conflict.tookCloud": "\u5DF2\u91C7\u7EB3\u4E91\u7AEF\u7248",
    "conflict.sideLocal": "\u6211\u7684\u672C\u5730\u7248\uFF08\u51B2\u7A81\u65F6\u5B58\u6863\uFF09",
    "conflict.sideCloud": "\u4E91\u7AEF\u7248\uFF08\u5DF2\u540C\u6B65\u5230\u6B63\u672C\uFF09",
    "conflict.noLocal": "\u8FD9\u4EFD\u7559\u6863\u6CA1\u6709\u6B63\u6587\u3002",
    "conflict.noCloud": "\u5E93\u91CC\u5DF2\u7ECF\u627E\u4E0D\u5230\u8FD9\u7BC7\u7684\u6B63\u672C\u4E86\uFF08\u53EF\u80FD\u88AB\u6539\u540D\u6216\u5220\u6389\u4E86\uFF09\u3002",
    "conflict.savedAt": "\u7559\u6863\u4E8E",
    "conflict.modeRendered": "\u6E32\u67D3",
    "conflict.modeRaw": "\u539F\u6587",
    "conflict.empty": "\u6CA1\u6709\u5F85\u5904\u7406\u7684\u51B2\u7A81",
    "conflict.emptyHint": "\u540C\u6B65\u65F6\u53EA\u6709\u300C\u4E24\u8FB9\u90FD\u6539\u8FC7\u540C\u4E00\u7BC7\u300D\u624D\u4F1A\u4EA7\u751F\u51B2\u7A81\u3002\u73B0\u5728\u6CA1\u6709\uFF0C\u8BF4\u660E\u90FD\u5BF9\u9F50\u4E86\u3002",
    "conflict.resolvedSection": "\u5DF2\u5904\u7406",
    "conflict.review": "\u67E5\u770B",
    "conflict.pickedLocal": "\u5F53\u521D\u9009\u4E86\u672C\u5730\u7248",
    "conflict.pickedCloud": "\u5F53\u521D\u9009\u4E86\u4E91\u7AEF\u7248",
    "conflict.undo": "\u9000\u56DE\u672A\u5904\u7406",
    "conflict.undone": "\u5DF2\u9000\u56DE\u672A\u5904\u7406",
    "tab.trash": "\u56DE\u6536\u7AD9",
    "tab.broken": "\u65AD\u94FE",
    "broken.desc": "\u8FD9\u91CC\u5217\u51FA\u5168\u5E93\u300C\u5199\u4E86\u53CC\u94FE\u3001\u4F46\u5E93\u91CC\u6CA1\u6709\u8FD9\u4E00\u7BC7\u300D\u7684\u5730\u65B9\u3002\u70B9\u4E00\u884C\u5C31\u6253\u5F00\u51FA\u95EE\u9898\u7684\u90A3\u4E00\u7BC7\uFF0C\u6539\u6389\u90A3\u4E2A\u540D\u5B57\u5C31\u597D\u3002",
    "broken.empty": "\u6CA1\u6709\u65AD\u94FE",
    "broken.emptyHint": "\u5E93\u91CC\u6BCF\u4E00\u6761\u53CC\u94FE\u90FD\u6307\u5F97\u5230\u4E1C\u897F\u3002\u5199\u5B8C\u65B0\u94FE\u63A5\u987A\u624B\u56DE\u6765\u770B\u4E00\u773C\u5C31\u884C\u3002",
    "broken.found": "\u626B\u4E86 {scanned} \u7BC7\uFF0C\u6709 {n} \u5904\u6307\u4E0D\u5230\u3002",
    "broken.truncated": "\u592A\u591A\u4E86\uFF0C\u53EA\u5217\u524D 500 \u5904\u3002\u5148\u4FEE\u6389\u4E00\u4E9B\u518D\u5237\u65B0\u3002",
    "broken.line": "\u7B2C",
    "broken.jump": "\u53BB\u8FD9\u4E00\u53E5",
    "todo.jump": "\u53BB\u8FD9\u4E00\u6761",
    "todo.copyAll": "\u590D\u5236\u8FD9\u4EFD\u6E05\u5355",
    "todo.copied": "\u5DF2\u590D\u5236 {n} \u6761\u5F85\u529E",
    "tab.todos": "\u5F85\u529E",
    "todos.desc": "\u5168\u5E93\u8FD8\u6CA1\u52FE\u6389\u7684\u65B9\u6846\u90FD\u5728\u8FD9\u91CC\u3002\u70B9\u65B9\u6846\u5F53\u573A\u52FE\u6389\uFF0C\u70B9\u6587\u5B57\u6253\u5F00\u90A3\u4E00\u7BC7\u3002",
    "todos.empty": "\u6CA1\u6709\u5F85\u529E",
    "todos.emptyHint": "\u5E93\u91CC\u6BCF\u4E00\u6761\u5F85\u529E\u90FD\u505A\u5B8C\u4E86\u3002\u65B0\u7684\u5F85\u529E\u5199\u8FDB\u7B14\u8BB0\u91CC\uFF0C\u56DE\u6765\u770B\u4E00\u773C\u5C31\u884C\u3002",
    "todos.found": "\u626B\u4E86 {scanned} \u7BC7\uFF0C\u8FD8\u5269 {n} \u6761\u6CA1\u505A\u3002",
    "todos.truncated": "\u592A\u591A\u4E86\uFF0C\u53EA\u5217\u524D 500 \u6761\u3002\u5148\u52FE\u6389\u4E00\u4E9B\u518D\u5237\u65B0\u3002",
    "trash.desc": "\u5220\u6389\u7684\u7B14\u8BB0\u5148\u653E\u8FD9\u91CC\uFF0C\u968F\u65F6\u53EF\u4EE5\u6062\u590D\u3002\u6062\u590D\u53EA\u662F\u628A\u6587\u4EF6\u642C\u56DE\u5E93\u91CC\uFF0C\u4E0D\u78B0\u5185\u5BB9\u3002",
    "trash.empty": "\u56DE\u6536\u7AD9\u662F\u7A7A\u7684",
    "trash.emptyHint": "\u5728\u7B14\u8BB0\u5217\u8868\u91CC\u70B9\u5220\u9664\uFF0C\u6587\u4EF6\u4F1A\u5148\u5230\u8FD9\u91CC\u3002\u6E05\u7A7A\u624D\u4F1A\u771F\u7684\u5220\u3002",
    "trash.deletedAt": "\u5220\u9664\u4E8E",
    "trash.restore": "\u6062\u590D",
    "trash.restored": "\u5DF2\u6062\u590D\u5230\u5E93\u91CC",
    "trash.purgeOne": "\u6C38\u4E45\u5220\u9664",
    "trash.purgeAll": "\u6E05\u7A7A\u56DE\u6536\u7AD9",
    "trash.purgeConfirm": "\u6E05\u7A7A\u56DE\u6536\u7AD9\u4F1A\u771F\u7684\u5220\u6389\u8FD9\u4E9B\u6587\u4EF6\uFF0C\u65E0\u6CD5\u64A4\u9500\u3002\u7EE7\u7EED\uFF1F",
    "trash.purgeOneConfirm": "\u6C38\u4E45\u5220\u9664\u8FD9\u4E2A\u6587\u4EF6\uFF0C\u65E0\u6CD5\u64A4\u9500\u3002\u7EE7\u7EED\uFF1F",
    "trash.purged": "\u5DF2\u6E05\u7406",
    "trash.originalName": "\u539F\u6587\u4EF6",
    "cloud.newNote": "\u65B0\u5EFA\u4E91\u7AEF\u7B14\u8BB0",
    "cloud.newNoteTitle": "\u6807\u9898",
    "cloud.newNoteBody": "\u6B63\u6587",
    "cloud.create": "\u521B\u5EFA",
    "cloud.created": "\u5DF2\u521B\u5EFA",
    "cloud.addTagHint": "\u8F93\u5165\u6807\u7B7E\uFF0C\u56DE\u8F66\u6216\u70B9\u52A0\u53F7",
    "cloud.tagAdded": "\u5DF2\u52A0\u6807\u7B7E",
    "cloud.tagRemoved": "\u5DF2\u5220\u6807\u7B7E",
    "cloud.removeTag": "\u5220\u6389\u8FD9\u4E2A\u6807\u7B7E",
    "cloud.shareLink": "\u5206\u4EAB\u94FE\u63A5",
    "cloud.shareCreated": "\u5206\u4EAB\u94FE\u63A5\u5DF2\u751F\u6210",
    "cloud.shareExcludeAudio": "\u4E0D\u542B\u5F55\u97F3",
    "cloud.copyLink": "\u590D\u5236\u94FE\u63A5",
    "cloud.copied": "\u5DF2\u590D\u5236",
    "cloud.topics": "\u77E5\u8BC6\u5E93",
    "cloud.allTopics": "\u5168\u90E8\u4E91\u7AEF\u7B14\u8BB0",
    "cloud.topicNotes": "\u77E5\u8BC6\u5E93\u5185\u7684\u7B14\u8BB0",
    "cloud.pushLocal": "\u63A8\u9001\u672C\u5730\u6539\u52A8\u5230\u4E91\u7AEF",
    "cloud.pushHint": "\u628A\u8FD9\u7BC7\u672C\u5730\u7B14\u8BB0\u7684\u6807\u9898\u548C\u6B63\u6587\u8986\u76D6\u5230\u4E91\u7AEF\u3002\u4F1A\u6539\u52A8\u4E91\u7AEF\u5185\u5BB9\uFF0C\u8BF7\u786E\u8BA4\u3002",
    "cloud.pushed": "\u5DF2\u63A8\u9001\u5230\u4E91\u7AEF",
    // ── 云端（Open API）──
    "tab.cloud": "\u4E91\u7AEF",
    "cloud.title": "\u4E91\u7AEF\u7B14\u8BB0",
    "cloud.desc": "\u76F4\u63A5\u8BFB\u5F97\u5230\u5927\u8111\u91CC\u7684\u5185\u5BB9\uFF0C\u53EF\u4EE5\u64AD\u653E\u5F55\u97F3\u3001\u6539\u6807\u9898\u6B63\u6587\u3001\u52A0\u6807\u7B7E\u3001\u5220\u5230\u56DE\u6536\u7AD9\u3002",
    "cloud.notConfigured": "\u8FD8\u6CA1\u63A5\u5165\u5F97\u5230\u5927\u8111",
    "cloud.notConfiguredDesc": "\u53BB\u300C\u8BBE\u7F6E \u2192 \u4E91\u7AEF\u63A5\u5165\u300D\u586B API Key \u4E0E Client ID\u3002\u5728 openapi.biji.com \u63A7\u5236\u53F0\u521B\u5EFA\u4E2A\u4EBA\u5F00\u53D1\u5E94\u7528\u5C31\u80FD\u62FF\u5230\u8FD9\u4E24\u4E2A\u503C\u3002",
    "cloud.loading": "\u6B63\u5728\u8BFB\u53D6\u4E91\u7AEF\u2026",
    "cloud.empty": "\u4E91\u7AEF\u8FD8\u6CA1\u6709\u7B14\u8BB0",
    "cloud.loadMore": "\u52A0\u8F7D\u66F4\u591A",
    "cloud.audio": "\u5F55\u97F3",
    "cloud.play": "\u64AD\u653E",
    "cloud.pause": "\u6682\u505C",
    "cloud.transcript": "\u9010\u5B57\u7A3F",
    "cloud.seekTo": "\u8DF3\u5230\u8FD9\u91CC\u64AD\u653E",
    "cloud.moments": "\u65F6\u95F4\u8F74",
    "cloud.todos": "\u5F85\u529E",
    "cloud.tags": "\u6807\u7B7E",
    "cloud.editTitle": "\u6807\u9898",
    "cloud.editBody": "\u6B63\u6587",
    "cloud.saveCloud": "\u4FDD\u5B58\u5230\u4E91\u7AEF",
    "cloud.savedCloud": "\u5DF2\u4FDD\u5B58\u5230\u4E91\u7AEF\uFF0C\u672C\u5730\u955C\u50CF\u4E5F\u5237\u65B0\u4E86",
    "cloud.deleteCloud": "\u5220\u9664\uFF08\u8FDB\u56DE\u6536\u7AD9\uFF09",
    "cloud.deletedCloud": "\u5DF2\u4ECE\u4E91\u7AEF\u5220\u9664",
    "cloud.addTag": "\u52A0\u6807\u7B7E",
    "cloud.share": "\u751F\u6210\u5206\u4EAB\u94FE\u63A5",
    "cloud.polling": "\u4E91\u7AEF\u8BE6\u60C5\u52A0\u8F7D\u4E2D\u2026",
    "cloud.localCopy": "\u672C\u5730\u526F\u672C",
    "cloud.noLocalCopy": "\u672C\u5730\u8FD8\u6CA1\u6709\u8FD9\u4E00\u7BC7",
    "cloud.pullOne": "\u62C9\u5230\u672C\u5730",
    // ── 同步 ──
    "sync.title": "\u81EA\u52A8\u540C\u6B65",
    "sync.desc": "\u6253\u5F00\u540E\u6BCF\u9694\u4E00\u6BB5\u65F6\u95F4\u81EA\u52A8\u628A\u4E91\u7AEF\u65B0\u589E\u548C\u4FEE\u6539\u7684\u7B14\u8BB0\u62C9\u5230\u672C\u5730\uFF0C\u4E0D\u9700\u8981\u624B\u52A8\u70B9\u3002\u672C\u5730\u6539\u8FC7\u7684\u7B14\u8BB0\u4E0D\u4F1A\u88AB\u8986\u76D6\uFF1B\u4E24\u8FB9\u90FD\u6539\u8FC7\u4F1A\u53E6\u5B58\u4E00\u4EFD\u5230 .conflicts \u76EE\u5F55\u3002",
    "sync.enabled": "\u5F00\u542F\u81EA\u52A8\u540C\u6B65",
    "sync.interval": "\u540C\u6B65\u95F4\u9694",
    "sync.minutes": "\u5206\u949F",
    "sync.incremental": "\u53EA\u540C\u6B65\u6709\u53D8\u5316\u7684\uFF08\u7701\u914D\u989D\uFF09",
    "sync.foregroundOnly": "\u53EA\u5728\u9762\u677F\u6253\u5F00\u65F6\u540C\u6B65",
    "sync.foregroundHint": "\u5173\u6389\u9762\u677F\u6216\u5408\u4E0A\u7535\u8111\u540E\u4E0D\u518D\u81EA\u52A8\u540C\u6B65\uFF0C\u7701\u4E91\u7AEF\u914D\u989D\u3002\u4E0B\u6B21\u6253\u5F00\u9762\u677F\u4F1A\u8865\u4E0A\u3002",
    "sync.now": "\u7ACB\u5373\u540C\u6B65",
    "sync.running": "\u6B63\u5728\u540C\u6B65\u2026",
    "sync.pushAll": "\u628A\u672C\u5730\u6539\u52A8\u63A8\u4E0A\u53BB",
    "sync.pushAllHint": "\u53EA\u63A8\u672C\u5730\u6539\u8FC7\u3001\u8FD8\u6CA1\u540C\u6B65\u4E0A\u53BB\u7684\u7B14\u8BB0\u3002\u4E91\u7AEF\u7684\u540C\u540D\u7B14\u8BB0\u6B63\u6587\u4F1A\u88AB\u8986\u76D6\uFF0C\u8BF7\u786E\u8BA4\u90A3\u4E9B\u6539\u52A8\u786E\u5B9E\u662F\u4F60\u5199\u7684\u3002",
    "sync.pushAllDone": "\u63A8\u9001\u5B8C\u6210",
    "sync.pushAllPushed": "\u5DF2\u63A8",
    "sync.pushAllSkipped": "\u6CA1\u6539\u52A8",
    "sync.pushAllFailed": "\u5931\u8D25",
    "sync.pushAllTruncated": "\u4E00\u6B21\u6700\u591A 200 \u7BC7\uFF0C\u5269\u4E0B\u7684\u518D\u70B9\u4E00\u6B21",
    "sync.lastRun": "\u4E0A\u6B21\u540C\u6B65",
    "sync.never": "\u4ECE\u672A\u540C\u6B65",
    "sync.result": "\u540C\u6B65\u7ED3\u679C",
    "sync.pulled": "\u62C9\u53D6",
    "sync.skipped": "\u672A\u53D8\u5316",
    "sync.adopted": "\u4FDD\u7559\u672C\u5730",
    "sync.conflicts": "\u51B2\u7A81",
    "sync.deleted": "\u5DF2\u5220\u9664",
    "sync.errors": "\u5931\u8D25",
    "sync.fullScan": "\u5168\u91CF\u626B\u63CF\uFF08\u80FD\u53D1\u73B0\u4E91\u7AEF\u5220\u9664\uFF0C\u6162\u4E14\u8D39\u914D\u989D\uFF09",
    "sync.quotaHint": "\u5B98\u65B9\u914D\u989D\uFF1A\u8BFB 1000 \u6B21/\u5929\u3001\u5199 200 \u6B21/\u5929\u3002\u9ED8\u8BA4 15 \u5206\u949F\u4E00\u8F6E\u3001\u53EA\u62C9\u6709\u53D8\u5316\u7684\uFF0C\u5168\u5929\u4E5F\u5C31\u7528\u6389\u51E0\u5341\u6B21\u3002",
    "sync.legacy": "\u65E7\u7684\u4E00\u6B21\u6027\u5BFC\u5165",
    "sync.legacyHint": "OAuth \u901A\u9053\uFF0C\u53EA\u5728\u6CA1\u914D API Key \u65F6\u515C\u5E95\u7528\u3002",
    // ── 云端凭证 ──
    "api.title": "\u4E91\u7AEF\u63A5\u5165",
    "api.desc": "\u586B\u81EA\u5DF1\u7684 API Key \u4E0E Client ID\uFF0C\u63D2\u4EF6\u5C31\u80FD\u76F4\u63A5\u64CD\u4F5C\u5F97\u5230\u5927\u8111\uFF08\u8BFB\u7B14\u8BB0\u3001\u64AD\u5F55\u97F3\u3001\u6539\u5185\u5BB9\u3001\u81EA\u52A8\u540C\u6B65\uFF09\u3002",
    "api.apiKey": "API Key",
    "api.clientId": "Client ID",
    "api.grantId": "\u6388\u6743 ID\uFF08\u53EF\u9009\uFF0C\u4F01\u4E1A\u4EE3\u6388\u6743\u624D\u9700\u8981\uFF09",
    "api.keyPlaceholder": "gk_live_...",
    "api.idPlaceholder": "cli_...",
    "api.grantPlaceholder": "grt_...\uFF08\u7559\u7A7A\u5373\u53EF\uFF09",
    "api.save": "\u4FDD\u5B58\u51ED\u8BC1",
    "api.saved": "\u51ED\u8BC1\u5DF2\u4FDD\u5B58",
    "api.test": "\u6D4B\u8BD5\u8FDE\u63A5",
    "api.testing": "\u6D4B\u8BD5\u4E2D\u2026",
    "api.ok": "\u8FDE\u63A5\u6B63\u5E38",
    "api.clear": "\u6E05\u9664\u51ED\u8BC1",
    "api.cleared": "\u51ED\u8BC1\u5DF2\u6E05\u9664",
    "api.ready": "\u5DF2\u63A5\u5165",
    "api.notReady": "\u672A\u63A5\u5165",
    "api.missing": "\u8FD8\u7F3A",
    "api.file": "\u51ED\u8BC1\u6587\u4EF6",
    "api.consoleHint": "\u53BB openapi.biji.com \u2192 \u63A7\u5236\u53F0 \u2192 \u521B\u5EFA\u4E2A\u4EBA\u5F00\u53D1\u5E94\u7528\uFF0C\u62FF\u5230 Client ID\uFF1B\u518D\u5728 API Key \u9875\u751F\u6210\u4E00\u4E2A Key\u3002",
    "api.neverEcho": "Key \u53EA\u4FDD\u5B58\u5728\u672C\u673A\uFF0C\u4FDD\u5B58\u540E\u4E0D\u4F1A\u518D\u663E\u793A\u5B8C\u6574\u5185\u5BB9\u3002",
    "api.needKey": "API Key \u4E0E Client ID \u90FD\u8981\u586B\u624D\u80FD\u7528\u3002",
    "api.keyRejected": "\u8FD9\u4E2A API Key \u88AB\u670D\u52A1\u7AEF\u62D2\u7EDD\u4E86",
    "api.usingFallback": "\u8FD8\u597D\u4F60\u767B\u5F55\u8FC7\u5F97\u5230\u5927\u8111\uFF0C\u73B0\u5728\u81EA\u52A8\u6539\u7528\u767B\u5F55\u901A\u9053\uFF0C\u529F\u80FD\u90FD\u6B63\u5E38\u3002\u8981\u4FEE\u597D Key\uFF0C\u53BB\u63A7\u5236\u53F0\u786E\u8BA4\u5B83\u5DF2\u6FC0\u6D3B\u3001\u4E14\u5E94\u7528\u6709\u5BF9\u5E94\u6743\u9650\u3002",
    "api.viaLogin": "\u5F53\u524D\u7528\u7684\u662F\u300C\u767B\u5F55\u5F97\u5230\u5927\u8111\u300D\u8FD9\u6761\u901A\u9053\uFF0C\u4E0D\u9700\u8981 API Key\u3002",
    "lang.title": "\u8BED\u8A00",
    "lang.desc": "\u9009\u9762\u677F\u663E\u793A\u7684\u8BED\u8A00\u3002\u300C\u81EA\u52A8\u300D\u8DDF\u968F DeepSeek Harness \u7684\u8BED\u8A00\u3002",
    "lang.auto": "\u81EA\u52A8",
    "lang.saved": "\u8BED\u8A00\u5DF2\u4FDD\u5B58",
    "tab.card": "\u5F55\u97F3\u5361",
    "card.title": "\u5F55\u97F3\u5361\u76F4\u8FDE",
    "card.desc": "\u7ED5\u8FC7\u4E91\u7AEF\uFF0C\u76F4\u63A5\u901A\u8FC7\u84DD\u7259\u4ECE\u5F55\u97F3\u5361\u4E0A\u628A\u97F3\u9891\u62C9\u8FDB\u7B14\u8BB0\u5E93\u3002\u5361\u7247\u8981\u5F00\u673A\u3001\u5728 3 \u7C73\u5185\uFF0C\u5E76\u4E14\u624B\u673A App \u5148\u65AD\u5F00\uFF08\u5173\u6389\u624B\u673A\u84DD\u7259\u5373\u53EF\uFF0C\u4E0D\u7528\u89E3\u7ED1\uFF09\u3002",
    "card.envOk": "\u73AF\u5883\u5C31\u7EEA",
    "card.envMissing": "\u7F3A\u5C11\u8FD0\u884C\u73AF\u5883",
    "card.envHint": "\u5F55\u97F3\u5361\u76F4\u8FDE\u9700\u8981\u7535\u8111\u4E0A\u6709 Python 3.10+ \u548C bleak \u5305\u3002\u88C5\u4E00\u4E0B\uFF1Apip install bleak",
    "card.envBridge": "\u534F\u8BAE\u6865",
    "card.scan": "\u626B\u63CF\u5F55\u97F3\u5361",
    "card.scanning": "\u6B63\u5728\u626B\u63CF\u2026",
    "card.scanFound": "\u627E\u5230\u5361\u7247",
    "card.scanNone": "\u6CA1\u626B\u5230\u5361\u7247\u3002\u786E\u8BA4\u5361\u7247\u5DF2\u5F00\u673A\u3001\u79BB\u7535\u8111\u8FD1\u4E00\u70B9\u3001\u624B\u673A\u84DD\u7259\u5DF2\u5173\u3002",
    "card.pending": "\u5F85\u5BFC\u5165",
    "card.refresh": "\u5237\u65B0\u5361\u7247",
    "card.none": "\u5361\u7247\u4E0A\u6CA1\u6709\u5F55\u97F3\u3002",
    "card.dir": "\u653E\u8FDB\u54EA\u4E2A\u76EE\u5F55",
    "card.dirHint": "\u7559\u7A7A\u5C31\u653E\u5E93\u91CC\u5DF2\u6709\u7684\u300C\u5F55\u97F3\u5361\u300D\u76EE\u5F55\u3002",
    "card.deleteAfter": "\u5BFC\u5165\u540E\u4ECE\u5361\u7247\u4E0A\u5220\u6389\u539F\u4EF6",
    "card.deleteAfterHint": "\u9ED8\u8BA4\u4E0D\u52A8\u5361\u7247\u3002\u6253\u5F00\u540E\u5BFC\u5165\u6210\u529F\u7684\u6587\u4EF6\u4F1A\u88AB\u6C38\u4E45\u5220\u9664\uFF0C\u4E0D\u80FD\u6062\u590D\u3002",
    "card.wifiTitle": "\u70ED\u70B9\u5FEB\u4F20",
    "card.wifiDesc": "\u8BA9\u5361\u7247\u81EA\u5DF1\u5F00\u4E00\u4E2A\u70ED\u70B9\uFF0C\u7535\u8111\u8FDE\u4E0A\u53BB\u76F4\u63A5\u4E0B\u8F7D\u3002\u540C\u6837\u7684\u6587\u4EF6\uFF0C\u84DD\u7259\u8981\u51E0\u5341\u5206\u949F\uFF0C\u8D70\u70ED\u70B9\u901A\u5E38\u4E00\u4E24\u5206\u949F\u3002\u5361\u7247\u70ED\u70B9\u6CA1\u6709\u4E92\u8054\u7F51\uFF0C\u4F20\u5B8C\u8BB0\u5F97\u70B9\u300C\u9000\u51FA\u70ED\u70B9\u300D\u628A\u7F51\u7EDC\u8FD8\u56DE\u53BB\u3002",
    "card.wifiAvailable": "\u626B\u5230\u50CF\u5F55\u97F3\u5361\u7684\u70ED\u70B9",
    "card.wifiGo": "\u5F00\u70ED\u70B9\u5E76\u8FDE\u63A5",
    "card.wifiBusy": "\u6B63\u5728\u5904\u7406\u2026",
    "card.wifiRescan": "\u5237\u65B0\u7F51\u7EDC",
    "card.wifiOff": "\u9000\u51FA\u70ED\u70B9",
    "card.wifiSsid": "\u70ED\u70B9\u540D\uFF08\u624B\u52A8\uFF09",
    "card.wifiPassword": "\u5BC6\u7801\uFF08\u6CA1\u6709\u5C31\u7559\u7A7A\uFF09",
    "card.wifiJoin": "\u8FDE\u8FD9\u4E2A\u70ED\u70B9",
    "card.wifiHotspot": "\u5DF2\u8FDE\u70ED\u70B9",
    "card.wifiPorts": "\u5F00\u653E\u7AEF\u53E3",
    "card.wifiOn": "\u5DF2\u8FDE\u4E0A\u5361\u7247\u70ED\u70B9",
    "card.wifiLeft": "\u5DF2\u9000\u51FA\u5361\u7247\u70ED\u70B9",
    "card.wifiNoHotspot": "\u5361\u7247\u6CA1\u6709\u62A5\u51FA\u70ED\u70B9\u540D\u3002\u53EF\u80FD\u8FD9\u4E2A\u56FA\u4EF6\u7248\u672C\u4E0D\u652F\u6301\u70ED\u70B9\u5FEB\u4F20\uFF0C\u6216\u8005\u547D\u4EE4\u7801\u8FD8\u6CA1\u5BF9\u4E0A\u3002",
    "card.wifiFail": "\u70ED\u70B9\u5FEB\u4F20\u6CA1\u6210\u529F",
    "card.wifiNeedSsid": "\u5148\u586B\u4E00\u4E2A\u70ED\u70B9\u540D",
    "card.import": "\u5BFC\u5165\u5168\u90E8\u5F55\u97F3",
    "card.importing": "\u6B63\u5728\u5BFC\u5165\u2026",
    "card.imported": "\u5BFC\u5165\u5B8C\u6210",
    "card.log": "\u8FDB\u5EA6",
    "card.downloaded": "\u5DF2\u5BFC\u5165",
    "card.skipped": "\u5DF2\u5B58\u5728",
    "card.failed": "\u5931\u8D25",
    "card.alreadyRunning": "\u5DF2\u7ECF\u6709\u4E00\u4E2A\u5BFC\u5165\u5728\u8DD1\u4E86\u3002",
    "card.needPython": "\u5148\u88C5\u597D Python \u548C bleak \u624D\u80FD\u7528\u3002"
  },
  en: {
    "panel.title": "Get\u7B14\u8BB0",
    "panel.hint": "Local note vault",
    "panel.toggleTree": "Folder panel",
    "tab.notes": "Notes",
    "tab.import": "Import",
    "tab.settings": "Settings",
    "action.refresh": "Refresh",
    "action.new": "New",
    "action.save": "Save",
    "action.cancel": "Cancel",
    "action.edit": "Edit",
    "action.openInEditor": "Open in Obsidian",
    "action.delete": "Delete",
    "action.copyRef": "Copy reference",
    "action.copy": "Copy",
    "note.copyBlock": "Copy this block",
    "action.rename": "Rename",
    "action.renamed": "Renamed",
    "note.duplicate": "Duplicate this note",
    "note.duplicated": "Duplicated",
    "note.renameUnsaved": "Save first, then rename",
    "action.copied": "Copied",
    "action.retry": "Retry",
    "search.placeholder": "Search title, body, tags\u2026",
    "search.hint": "Narrow it down: tag:voice \xB7 dir:notes \xB7 #private. All words must match; quote a phrase to keep it together, put - in front to exclude it.",
    "search.jumpToLine": "Jump to this line",
    "batch.pick": "Select this note",
    "batch.picked": "selected",
    "batch.actions": "Batch actions",
    "batch.clear": "Clear selection",
    "batch.tagPlaceholder": "Tag to add",
    "batch.addTag": "Add tag",
    "batch.removeTag": "Remove tag",
    "batch.tagRemovePlaceholder": "Tag to remove",
    "batch.dirPlaceholder": "Target folder",
    "batch.tagPick": "Use this tag",
    "batch.dirPick": "Use this folder",
    "batch.move": "Move",
    "batch.delete": "Move to trash",
    "batch.confirmDelete": "Move these notes to trash?",
    "drop.pickDirFirst": "Pick a folder on the left first, then drop",
    "drop.moved": "Moved into this folder",
    "batch.done": "Processed",
    "search.searching": "Searching\u2026",
    "search.clear": "Clear",
    "tree.all": "All notes",
    "tree.dirs": "Folders",
    "tree.tags": "Tags",
    "tree.sort": "Sort",
    "tree.sortTime": "By modified",
    "tree.sortName": "By name",
    "tree.sortCount": "By count",
    "list.sort": "Sort",
    "list.sortTime": "Recently edited first",
    "list.sortName": "By name",
    "filter.clear": "Remove this filter",
    "help.open": "Keyboard shortcuts",
    "help.title": "Keyboard shortcuts",
    "help.hint": "Ctrl works everywhere; on a Mac use Cmd.",
    "help.search": "Focus the search box",
    "help.searchEnter": "Enter opens the first hit, Esc goes back to the whole list",
    "help.new": "New note",
    "help.move": "Next / previous note in the list",
    "help.nav": "Back / forward between notes",
    "help.find": "Find in the note",
    "help.edit": "Start editing / save and leave",
    "help.save": "Save",
    "help.esc": "Cancel editing, close the find bar",
    "help.format": "Bold / italic / strikethrough",
    "help.pick": "Add this note to the batch selection (Esc clears it)",
    "help.indent": "Indent list lines",
    "help.complete": "Complete links and tags",
    "help.help": "Open this sheet",
    "col.treeWidth": "Resize left column",
    "col.listWidth": "Resize middle column",
    "tree.newDir": "New folder",
    "tree.newDirHint": "Folder name; use / for nesting",
    "tree.newTag": "New tag",
    "tree.newTagHint": "Tag name, press Enter",
    "tree.deleteDir": "Delete folder",
    "tree.deleteTag": "Delete tag",
    "tree.deleteDirConfirm": "Delete folder \u201C{name}\u201D? It must be empty first.",
    "tree.deleteTagConfirm": "Delete tag \u201C{name}\u201D? It is removed from every note; notes stay.",
    "tree.deletedDir": "Folder deleted",
    "tree.deletedTag": "Tag removed",
    "tree.dirNotEmpty": "This folder still has notes \u2014 move them out first",
    "tree.fold": "Collapse subfolders",
    "tree.unfold": "Expand subfolders",
    "tree.dirCreated": "Folder created (empty folders stay hidden)",
    "tree.movedTo": "Moved to {dir}",
    "tree.tagCreated": "Tag added to the open note",
    "tree.tagNeedNote": "Open a note first to add a tag",
    "tree.menuDelete": "Delete",
    "tree.menuCancel": "Cancel",
    "tree.menuRename": "Rename",
    "tree.menuReveal": "Reveal in file explorer",
    "tree.tagRenamed": "Tag renamed",
    "tree.dirRenamed": "Folder renamed",
    "todo.toggle": "Click to tick off",
    "todo.done": "Ticked off",
    "todo.undone": "Unchecked",
    "heat.title": "Writing streak",
    "heat.streak": "day streak",
    "heat.unit": "notes",
    "heat.totalHint": "notes (last 6 months)",
    "empty.noVault": "No local vault yet",
    "empty.noVaultDesc": "Pick a folder in Settings, or press Import to pull your notes down.",
    "empty.noNotes": "No notes in this folder",
    "list.more": "Show more",
    "empty.select": "Pick a note to read",
    "empty.selectDesc": "Folders on the left, notes in the middle. Or press New.",
    "empty.search": "No matching notes",
    "meta.notes": "notes",
    "meta.dirs": "folders",
    "reader.missing": "File is missing or was moved",
    "reader.frontmatter": "Properties",
    "reader.words": "{n} words",
    "reader.minutes": "About {n} min read",
    "import.title": "One-time import",
    "import.desc": "While your subscription still works, pull every cloud note down as local Markdown. Afterwards the notes stay readable and editable \u2014 this is the only action in the plugin that touches the network.",
    "import.loggedIn": "Connected",
    "import.notLoggedIn": "Not connected",
    "import.login": "Sign in",
    "import.loginHint": "A browser window opens for authorization; come back here when done.",
    "import.start": "Start import",
    "import.running": "Importing\u2026",
    "import.logout": "Sign out",
    "import.result": "Result",
    "import.lastSync": "Last import",
    "import.never": "never",
    "import.done": "Done",
    "import.newNotes": "new",
    "import.skipped": "skipped",
    "import.failed": "failed",
    "import.authorizeWait": "Waiting for authorization\u2026",
    "import.openLink": "If no window opened, authorize manually here",
    "import.needLogin": "Sign in first to read cloud notes.",
    "import.cloudHint": "After this you no longer need the subscription.",
    "settings.vault": "Vault folder",
    "settings.vaultHint": 'A folder inside this vault, e.g. "Getnote" or "Notes/Getnote". Only paths inside the vault are allowed.',
    "settings.save": "Save folder",
    "settings.saved": "Saved",
    "settings.suggest": "Found existing notes here",
    "settings.use": "Use it",
    "settings.authFile": "Credential file",
    "settings.loggedIn": "Signed in",
    "settings.loggedOut": "Not signed in",
    "settings.loginExpired": "Sign-in expired",
    "settings.storeHint": "Credentials stay in the local DSH config dir, never in the browser.",
    "theme.title": "Panel theme color",
    "theme.desc": "Pick one color \u2014 the left pane stays darkest, the middle lighter, the reading pane near white. Depth is derived for you. Click Apply to save.",
    "theme.custom": "Custom color",
    "theme.preset": "Use presets",
    "theme.apply": "Apply",
    "theme.reset": "Reset to default blue",
    "theme.saved": "Theme color saved",
    "theme.previewLeft": "Left",
    "theme.previewMid": "Middle",
    "theme.previewRight": "Right",
    "error.prefix": "Error",
    "capture.title": "Clipping",
    "capture.saved": "Saved as a note",
    "note.created": "Created",
    "note.saved": "Saved",
    "note.deleted": "Moved to trash",
    "note.unsaved": "Unsaved changes",
    "draft.found": "Unfinished draft from {when}",
    "draft.resume": "Keep writing",
    "draft.discard": "Discard",
    "draft.discarded": "Draft discarded",
    "note.menuOpen": "Open this note",
    "note.localAudio": "Local recording",
    "note.outline": "Outline",
    "note.copyHeadingLink": "Copy a link to this section",
    "note.openImage": "Open this image in Obsidian",
    "note.zoomImage": "Click to enlarge",
    "zoom.prev": "Previous image",
    "zoom.next": "Next image",
    "zoom.count": "{n} / {total}",
    "note.navBack": "Previous note",
    "note.navForward": "Next note",
    "note.find": "Find in this note",
    "note.findPlaceholder": "Find\u2026",
    "note.findInEditor": "Find in the text\u2026",
    "note.findNext": "Find next",
    "note.findPrev": "Find previous",
    "note.findMiss": 'No "{text}" in this note',
    "note.findEnd": "No more matches",
    "note.attach": "Attach a file",
    "attach.added": "Attachment inserted",
    "attach.failed": "Some files could not be uploaded",
    "attach.needNote": "Open a note first, then drop files into it",
    "note.backlinks": "Notes linking here",
    "note.backlinkJump": "Jump to this line",
    "sel.newNote": "Save as a new note",
    "note.outlinks": "Links from this note",
    "note.fontSize": "Text size",
    "panel.loading": "Loading vault\u2026",
    "sync.pushOne": "Push this note",
    "sync.pullOne": "Pull this note",
    "sync.pushedOne": "Pushed to cloud",
    "sync.pulledOne": "Updated from cloud",
    "new.template": "Start a new",
    "new.pickDir": "Create in",
    "new.dirPick": "Create in this folder",
    "new.daily": "Daily note",
    "new.dailyHint": "What happened today",
    "new.book": "Book notes",
    "new.bookHint": "Title and takeaways",
    "new.meeting": "Meeting",
    "new.meetingHint": "Discussion and decisions",
    "new.note": "Quick note",
    "new.noteHint": "Just a title",
    "new.customHint": "uses your own skeleton",
    "settings.templateTitle": "Note templates",
    "settings.templateDesc": "Save the skeletons you reuse and pick them when creating a note. Daily / Book / Meeting / Quick note are always available.",
    "settings.templateName": "Template name",
    "settings.templateNameHint": "Shown in the create menu",
    "settings.templateBody": "Skeleton body",
    "settings.templateBodyHint": "Leave empty for a title-only note; Markdown works",
    "settings.templateAdd": "Add a template",
    "settings.templateSave": "Save templates",
    "settings.templateSaved": "Templates saved",
    "settings.templateEmpty": "No custom templates yet",
    "settings.templateLimit": "up to 12",
    "settings.templateRemove": "Remove",
    "settings.followTitle": "Follow what you open in Obsidian",
    "settings.followDesc": "Open a note in Obsidian and the panel switches to the same one, with its backlinks and sync state right behind it. The panel will not open itself for you, and notes outside the Get\u7B14\u8BB0 folder are ignored.",
    "settings.followToggle": "Keep the panel on the note I open",
    "settings.followSaved": "Follow setting saved",
    "new.bookTitle": "Book notes",
    "new.meetingTitle": "Meeting",
    "note.fontSize.s": "Small",
    "note.fontSize.m": "Normal",
    "note.fontSize.l": "Large",
    "note.wikilinkMissing": 'No note named "{name}" in this vault',
    "note.anchorMissing": 'No section called "{name}" in this note',
    "note.blockRef": "A paragraph on this page",
    "note.pickTag": "Filter by this tag",
    "note.footnote": "Jump to this footnote",
    "note.footnoteBack": "Back to where it is cited",
    "note.openEmbed": "Open this note",
    "note.embedBroken": "Could not read this note",
    "callout.expand": "Expand",
    "editor.words": "{n} words",
    "editor.saveHint": "Ctrl+S to save \xB7 Ctrl+E to save and leave \xB7 Esc to cancel \xB7 Ctrl+B bold \xB7 Ctrl+I italic \xB7 Ctrl+F find",
    "callout.collapse": "Collapse",
    "note.image": "Image",
    "action.close": "Close",
    "action.back": "Back to list",
    "history.title": "Version history",
    "history.restore": "Restore this version",
    "history.empty": "No versions yet",
    "history.emptyHint": "A snapshot is saved automatically each time you save or delete a note, keeping the latest 10.",
    "archive.title": "Whole-vault backup",
    "archive.desc": "Exports one zip (attachments included) so you can restore on another machine. Import merges note by note and never overwrites what you already have.",
    "archive.export": "Export zip",
    "archive.import": "Import zip",
    "archive.exporting": "Exporting\u2026",
    "archive.exported": "Archive exported",
    "archive.scope": "Export range",
    "archive.scopeAll": "Whole vault",
    "archive.scopeNotes": "Notes only",
    "archive.scopeAssets": "Attachments only",
    "archive.imported": "Import done \u2014 added/skipped",
    "archive.importMode": "On name clash",
    "archive.mode.rename": "Keep both",
    "archive.mode.skip": "Skip",
    "tab.conflict": "Conflicts",
    "conflict.desc": "When both sides changed the same note, the local copy is kept in .conflicts/ and the note body takes the cloud version. Compare them here and adopt either side in one click. The archive is never deleted, so you can switch again later.",
    "conflict.compare": "Compare",
    "conflict.keepLocal": "Use my local copy",
    "conflict.takeCloud": "Use cloud copy",
    "conflict.back": "Back",
    "conflict.keptLocal": "Adopted local copy",
    "conflict.tookCloud": "Adopted cloud copy",
    "conflict.sideLocal": "My local version (archived at conflict)",
    "conflict.sideCloud": "Cloud version (now in the live note)",
    "conflict.noLocal": "This archived copy has no body.",
    "conflict.noCloud": "The live note is gone from the vault (renamed or deleted).",
    "conflict.savedAt": "Archived at",
    "conflict.modeRendered": "Rendered",
    "conflict.modeRaw": "Raw",
    "conflict.empty": "No conflicts to resolve",
    "conflict.emptyHint": "Conflicts only appear when both sides changed the same note. None right now.",
    "conflict.resolvedSection": "Resolved",
    "conflict.review": "Review",
    "conflict.pickedLocal": "you kept local",
    "conflict.pickedCloud": "you took cloud",
    "conflict.undo": "Mark unresolved",
    "conflict.undone": "Marked unresolved",
    "tab.trash": "Trash",
    "tab.broken": "Broken links",
    "broken.desc": "Every place where a note links to something that is not in the vault. Click a row to open the note and fix the name.",
    "broken.empty": "No broken links",
    "broken.emptyHint": "Every link in the vault resolves. Check back after writing new ones.",
    "broken.found": "Scanned {scanned} notes, {n} links go nowhere.",
    "broken.truncated": "That is a lot \u2014 only the first 500 are listed. Fix some and refresh.",
    "broken.line": "line",
    "broken.jump": "Jump to this line",
    "todo.jump": "Jump to this item",
    "todo.copyAll": "Copy this list",
    "todo.copied": "Copied {n} to-dos",
    "tab.todos": "To-dos",
    "todos.desc": "Every unticked box in the vault. Click a box to tick it off, click the text to open the note.",
    "todos.empty": "Nothing to do",
    "todos.emptyHint": "Every to-do in the vault is done. Write new ones into notes and check back.",
    "todos.found": "Scanned {scanned} notes, {n} still open.",
    "todos.truncated": "That is a lot \u2014 only the first 500 are listed. Tick some off and refresh.",
    "trash.desc": "Deleted notes wait here and can be restored. Restoring just moves the file back.",
    "trash.empty": "Trash is empty",
    "trash.emptyHint": "Deleting a note moves it here first. Only purging really deletes it.",
    "trash.deletedAt": "Deleted",
    "trash.restore": "Restore",
    "trash.restored": "Restored into the vault",
    "trash.purgeOne": "Delete forever",
    "trash.purgeAll": "Empty trash",
    "trash.purgeConfirm": "Emptying the trash really deletes these files. Continue?",
    "trash.purgeOneConfirm": "Delete this file forever. Continue?",
    "trash.purged": "Purged",
    "trash.originalName": "Original file",
    "cloud.newNote": "New cloud note",
    "cloud.newNoteTitle": "Title",
    "cloud.newNoteBody": "Body",
    "cloud.create": "Create",
    "cloud.created": "Created",
    "cloud.addTagHint": "Type a tag, press Enter or plus",
    "cloud.tagAdded": "Tag added",
    "cloud.tagRemoved": "Tag removed",
    "cloud.removeTag": "Remove this tag",
    "cloud.shareLink": "Share link",
    "cloud.shareCreated": "Share link created",
    "cloud.shareExcludeAudio": "Exclude audio",
    "cloud.copyLink": "Copy link",
    "cloud.copied": "Copied",
    "cloud.topics": "Knowledge bases",
    "cloud.allTopics": "All cloud notes",
    "cloud.topicNotes": "Notes in this knowledge base",
    "cloud.pushLocal": "Push local changes to cloud",
    "cloud.pushHint": "Overwrite the cloud title and body with this local note. This changes cloud content.",
    "cloud.pushed": "Pushed to cloud",
    // ── Cloud (Open API) ──
    "tab.cloud": "Cloud",
    "cloud.title": "Cloud notes",
    "cloud.desc": "Read Get\u7B14\u8BB0 directly, play recordings, edit text, add tags, delete to trash.",
    "cloud.notConfigured": "Not connected to Get\u7B14\u8BB0",
    "cloud.notConfiguredDesc": "Add your API Key and Client ID under Settings \u2192 Cloud access. Create a personal app at openapi.biji.com to get both.",
    "cloud.loading": "Loading cloud notes\u2026",
    "cloud.empty": "No cloud notes yet",
    "cloud.loadMore": "Load more",
    "cloud.audio": "Recording",
    "cloud.play": "Play",
    "cloud.pause": "Pause",
    "cloud.transcript": "Transcript",
    "cloud.seekTo": "Play from here",
    "cloud.moments": "Timeline",
    "cloud.todos": "To-dos",
    "cloud.tags": "Tags",
    "cloud.editTitle": "Title",
    "cloud.editBody": "Body",
    "cloud.saveCloud": "Save to cloud",
    "cloud.savedCloud": "Saved to cloud; local copy refreshed too",
    "cloud.deleteCloud": "Delete (to trash)",
    "cloud.deletedCloud": "Deleted from cloud",
    "cloud.addTag": "Add tag",
    "cloud.share": "Create share link",
    "cloud.polling": "Loading cloud note\u2026",
    "cloud.localCopy": "Local copy",
    "cloud.noLocalCopy": "No local copy yet",
    "cloud.pullOne": "Pull to local",
    // ── Sync ──
    "sync.title": "Auto sync",
    "sync.desc": "When on, new and changed cloud notes are pulled to the local vault on a timer, with no clicking. Locally edited notes are never overwritten; when both sides changed, a copy goes to .conflicts.",
    "sync.enabled": "Enable auto sync",
    "sync.interval": "Interval",
    "sync.minutes": "min",
    "sync.incremental": "Only sync changes (saves quota)",
    "sync.foregroundOnly": "Only sync while the panel is open",
    "sync.foregroundHint": "Stops auto-sync when the panel is closed or the machine sleeps, saving cloud quota. Catches up next time you open it.",
    "sync.now": "Sync now",
    "sync.running": "Syncing\u2026",
    "sync.pushAll": "Push local changes",
    "sync.pushAllHint": "Only notes you edited locally and have not synced yet are pushed. The cloud copy of the same note will be overwritten \u2014 make sure those edits are really yours.",
    "sync.pushAllDone": "Push finished",
    "sync.pushAllPushed": "pushed",
    "sync.pushAllSkipped": "unchanged",
    "sync.pushAllFailed": "failed",
    "sync.pushAllTruncated": "200 per run at most, click again for the rest",
    "sync.lastRun": "Last sync",
    "sync.never": "never",
    "sync.result": "Result",
    "sync.pulled": "pulled",
    "sync.skipped": "unchanged",
    "sync.adopted": "kept local",
    "sync.conflicts": "conflicts",
    "sync.deleted": "deleted",
    "sync.errors": "failed",
    "sync.fullScan": "Full scan (detects cloud deletions; slower, uses more quota)",
    "sync.quotaHint": "Official quota: 1000 reads/day, 200 writes/day. The default 15-minute incremental run uses only dozens.",
    "sync.legacy": "Legacy one-time import",
    "sync.legacyHint": "OAuth channel, kept only as a fallback when no API key is set.",
    // ── Cloud credentials ──
    "api.title": "Cloud access",
    "api.desc": "Add your own API Key and Client ID so the plugin can drive Get\u7B14\u8BB0: read notes, play audio, edit, auto-sync.",
    "api.apiKey": "API Key",
    "api.clientId": "Client ID",
    "api.grantId": "Grant ID (optional, enterprise only)",
    "api.keyPlaceholder": "gk_live_...",
    "api.idPlaceholder": "cli_...",
    "api.grantPlaceholder": "grt_... (leave empty)",
    "api.save": "Save credentials",
    "api.saved": "Credentials saved",
    "api.test": "Test connection",
    "api.testing": "Testing\u2026",
    "api.ok": "Connection OK",
    "api.clear": "Clear credentials",
    "api.cleared": "Credentials cleared",
    "api.ready": "Connected",
    "api.notReady": "Not connected",
    "api.missing": "missing",
    "api.file": "Credential file",
    "api.consoleHint": "Create a personal app at openapi.biji.com \u2192 console \u2192 get the Client ID, then generate a key on the API Key page.",
    "api.neverEcho": "The key stays on this machine and is never echoed back in full.",
    "api.needKey": "Both API Key and Client ID are required.",
    "api.keyRejected": "This API key was rejected by the server",
    "api.usingFallback": "Your Get\u7B14\u8BB0 login still works, so the plugin switched to that channel automatically. To fix the key, check in the console that it is active and the app has the right scopes.",
    "api.viaLogin": 'Currently using the "sign in to Get\u7B14\u8BB0" channel \u2014 no API key needed.',
    "lang.title": "Language",
    "lang.desc": "Choose the language for this panel. Automatic follows DeepSeek Harness.",
    "lang.auto": "Automatic",
    "lang.saved": "Language saved",
    "tab.card": "Recorder",
    "card.title": "Recorder card (direct)",
    "card.desc": "Skip the cloud \u2014 pull audio straight off the recorder card over Bluetooth. The card must be on, within about 3 metres, and the phone app disconnected (just turn off phone Bluetooth; no need to unbind).",
    "card.envOk": "Ready",
    "card.envMissing": "Runtime missing",
    "card.envHint": "Direct card access needs Python 3.10+ and the bleak package on this computer. Install with: pip install bleak",
    "card.envBridge": "Protocol bridge",
    "card.scan": "Scan for card",
    "card.scanning": "Scanning\u2026",
    "card.scanFound": "Card found",
    "card.scanNone": "No card found. Make sure it is powered on, close to the computer, and phone Bluetooth is off.",
    "card.pending": "Waiting",
    "card.refresh": "Refresh card",
    "card.none": "No recordings on the card.",
    "card.dir": "Import into folder",
    "card.dirHint": 'Leave empty to use the existing "Recorder" folder in the vault.',
    "card.deleteAfter": "Delete originals from the card after import",
    "card.deleteAfterHint": "The card is left untouched by default. When enabled, imported files are deleted permanently.",
    "card.wifiTitle": "Wi-Fi transfer",
    "card.wifiDesc": 'Let the card start its own hotspot and download over it. The same files take tens of minutes over Bluetooth and one or two minutes over Wi-Fi. The card hotspot has no internet \u2014 tap "Leave hotspot" when you are done.',
    "card.wifiAvailable": "Hotspots that look like the card",
    "card.wifiGo": "Start hotspot and connect",
    "card.wifiBusy": "Working\u2026",
    "card.wifiRescan": "Refresh network",
    "card.wifiOff": "Leave hotspot",
    "card.wifiSsid": "Hotspot name (manual)",
    "card.wifiPassword": "Password (blank if none)",
    "card.wifiJoin": "Join this hotspot",
    "card.wifiHotspot": "Connected to",
    "card.wifiPorts": "Open ports",
    "card.wifiOn": "Connected to the card hotspot",
    "card.wifiLeft": "Left the card hotspot",
    "card.wifiNoHotspot": "The card did not report a hotspot. This firmware may not support it, or the command code is not matched yet.",
    "card.wifiFail": "Wi-Fi transfer did not start",
    "card.wifiNeedSsid": "Enter a hotspot name first",
    "card.import": "Import all recordings",
    "card.importing": "Importing\u2026",
    "card.imported": "Import finished",
    "card.log": "Progress",
    "card.downloaded": "Imported",
    "card.skipped": "Already there",
    "card.failed": "Failed",
    "card.alreadyRunning": "An import is already running.",
    "card.needPython": "Install Python and bleak first."
  },
  nl: {
    "panel.title": "Get\u7B14\u8BB0",
    "panel.hint": "Lokale notitiemap",
    "panel.toggleTree": "Mappenpaneel",
    "tab.notes": "Notities",
    "tab.import": "Importeren",
    "tab.settings": "Instellingen",
    "action.refresh": "Vernieuwen",
    "action.new": "Nieuw",
    "action.save": "Opslaan",
    "action.cancel": "Annuleren",
    "action.edit": "Bewerken",
    "action.openInEditor": "Openen in Obsidian",
    "action.delete": "Verwijderen",
    "action.copyRef": "Referentie kopi\xEBren",
    "action.copy": "Kopi\xEBren",
    "note.copyBlock": "Dit blok kopi\xEBren",
    "action.rename": "Naam wijzigen",
    "action.renamed": "Naam gewijzigd",
    "note.duplicate": "Deze notitie dupliceren",
    "note.duplicated": "Gedupliceerd",
    "note.renameUnsaved": "Sla eerst op en wijzig dan de naam",
    "action.copied": "Gekopieerd",
    "action.retry": "Opnieuw",
    "search.placeholder": "Zoek titel, tekst, tags\u2026",
    "search.hint": "Verfijn: tag:spraak \xB7 dir:notities \xB7 #priv\xE9. Alle woorden moeten voorkomen; zet een frase tussen quotes, en - ervoor om hem uit te sluiten.",
    "search.jumpToLine": "Naar deze regel",
    "batch.pick": "Deze notitie selecteren",
    "batch.picked": "geselecteerd",
    "batch.actions": "Bulkacties",
    "batch.clear": "Selectie wissen",
    "batch.tagPlaceholder": "Tag om toe te voegen",
    "batch.addTag": "Tag toevoegen",
    "batch.removeTag": "Tag verwijderen",
    "batch.tagRemovePlaceholder": "Tag om te verwijderen",
    "batch.dirPlaceholder": "Doelmap",
    "batch.tagPick": "Deze tag gebruiken",
    "batch.dirPick": "Deze map gebruiken",
    "batch.move": "Verplaatsen",
    "batch.delete": "Naar prullenbak",
    "batch.confirmDelete": "Deze notities naar de prullenbak verplaatsen?",
    "drop.pickDirFirst": "Kies eerst links een map en sleep dan hierheen",
    "drop.moved": "Naar deze map verplaatst",
    "batch.done": "Verwerkt",
    "search.searching": "Zoeken\u2026",
    "search.clear": "Wissen",
    "tree.all": "Alle notities",
    "tree.dirs": "Mappen",
    "tree.tags": "Tags",
    "tree.sort": "Sorteren",
    "tree.sortTime": "Op gewijzigd",
    "tree.sortName": "Op naam",
    "tree.sortCount": "Op aantal",
    "list.sort": "Sorteren",
    "list.sortTime": "Recentst gewijzigd eerst",
    "list.sortName": "Op naam",
    "filter.clear": "Deze filter weghalen",
    "help.open": "Sneltoetsen",
    "help.title": "Sneltoetsen",
    "help.hint": "Ctrl werkt overal; gebruik op een Mac Cmd.",
    "help.search": "Zoekvak focus geven",
    "help.searchEnter": "Enter opent de eerste treffer, Esc gaat terug naar de hele lijst",
    "help.new": "Nieuwe notitie",
    "help.move": "Volgende / vorige notitie in de lijst",
    "help.nav": "Terug / vooruit tussen notities",
    "help.find": "Zoeken in de notitie",
    "help.edit": "Bewerken starten / opslaan en verlaten",
    "help.save": "Opslaan",
    "help.esc": "Bewerken annuleren, zoekbalk sluiten",
    "help.format": "Vet / cursief / doorhalen",
    "help.pick": "Deze notitie aan de bulkselectie toevoegen (Esc wist het)",
    "help.indent": "Lijstregels inspringen",
    "help.complete": "Links en tags aanvullen",
    "help.help": "Dit overzicht openen",
    "col.treeWidth": "Linkerkolom breder of smaller maken",
    "col.listWidth": "Middenkolom breder of smaller maken",
    "tree.newDir": "Nieuwe map",
    "tree.newDirHint": "Mapnaam; gebruik / voor submappen",
    "tree.newTag": "Nieuwe tag",
    "tree.newTagHint": "Tagnaam, druk op Enter",
    "tree.deleteDir": "Map verwijderen",
    "tree.deleteTag": "Tag verwijderen",
    "tree.deleteDirConfirm": "Map \u2018{name}\u2019 verwijderen? De map moet eerst leeg zijn.",
    "tree.deleteTagConfirm": "Tag \u2018{name}\u2019 verwijderen? Hij verdwijnt uit elke notitie; de notities blijven.",
    "tree.deletedDir": "Map verwijderd",
    "tree.deletedTag": "Tag verwijderd",
    "tree.dirNotEmpty": "Er staan nog notities in deze map \u2014 verplaats ze eerst",
    "tree.fold": "Submappen inklappen",
    "tree.unfold": "Submappen uitklappen",
    "tree.dirCreated": "Map aangemaakt (lege mappen blijven verborgen)",
    "tree.movedTo": "Verplaatst naar {dir}",
    "tree.tagCreated": "Tag toegevoegd aan de geopende notitie",
    "tree.tagNeedNote": "Open eerst een notitie om een tag toe te voegen",
    "tree.menuDelete": "Verwijderen",
    "tree.menuCancel": "Annuleren",
    "tree.menuRename": "Naam wijzigen",
    "tree.menuReveal": "Toon in bestandsverkenner",
    "tree.tagRenamed": "Tag hernoemd",
    "tree.dirRenamed": "Map hernoemd",
    "todo.toggle": "Klik om af te vinken",
    "todo.done": "Afgevinkt",
    "todo.undone": "Vinkje verwijderd",
    "heat.title": "Schrijfritme",
    "heat.streak": "dagen op rij",
    "heat.unit": "notities",
    "heat.totalHint": "notities (afgelopen half jaar)",
    "empty.noVault": "Nog geen lokale map",
    "empty.noVaultDesc": "Kies een map bij Instellingen, of druk op Importeren om je notities op te halen.",
    "empty.noNotes": "Geen notities in deze map",
    "list.more": "Meer tonen",
    "empty.select": "Kies een notitie om te lezen",
    "empty.selectDesc": "Mappen links, notities in het midden. Of druk op Nieuw.",
    "empty.search": "Geen passende notities",
    "meta.notes": "notities",
    "meta.dirs": "mappen",
    "reader.missing": "Bestand ontbreekt of is verplaatst",
    "reader.frontmatter": "Eigenschappen",
    "reader.words": "{n} woorden",
    "reader.minutes": "Ongeveer {n} min leestijd",
    "import.title": "Eenmalige import",
    "import.desc": "Zolang je abonnement loopt, haal je elke cloudnotitie als lokale Markdown binnen. Daarna blijven de notities leesbaar en bewerkbaar \u2014 dit is de enige actie in de plug-in die het netwerk gebruikt.",
    "import.loggedIn": "Verbonden",
    "import.notLoggedIn": "Niet verbonden",
    "import.login": "Inloggen",
    "import.loginHint": "Er opent een browservenster voor de autorisatie; kom daarna hier terug.",
    "import.start": "Import starten",
    "import.running": "Importeren\u2026",
    "import.logout": "Uitloggen",
    "import.result": "Resultaat",
    "import.lastSync": "Laatste import",
    "import.never": "nooit",
    "import.done": "Klaar",
    "import.newNotes": "nieuw",
    "import.skipped": "overgeslagen",
    "import.failed": "mislukt",
    "import.authorizeWait": "Wachten op autorisatie\u2026",
    "import.openLink": "Is er geen venster geopend? Autoriseer dan hier handmatig",
    "import.needLogin": "Log eerst in om cloudnotities te lezen.",
    "import.cloudHint": "Hierna heb je het abonnement niet meer nodig.",
    "settings.vault": "Notitiemap",
    "settings.vaultHint": 'Een map binnen deze vault, bijvoorbeeld "Getnote" of "Notities/Getnote". Alleen paden binnen de vault zijn toegestaan.',
    "settings.save": "Map opslaan",
    "settings.saved": "Opgeslagen",
    "settings.suggest": "Hier zijn bestaande notities gevonden",
    "settings.use": "Gebruiken",
    "settings.authFile": "Inloggegevens",
    "settings.loggedIn": "Ingelogd",
    "settings.loggedOut": "Niet ingelogd",
    "settings.loginExpired": "Inlog verlopen",
    "settings.storeHint": "Inloggegevens blijven in de lokale DSH-configuratiemap, nooit in de browser.",
    "theme.title": "Themakleur van het paneel",
    "theme.desc": "Kies \xE9\xE9n kleur \u2014 het linkerpaneel blijft het donkerst, het midden lichter, het leespaneel bijna wit. De diepte wordt voor je berekend. Klik op Toepassen om op te slaan.",
    "theme.custom": "Eigen kleur",
    "theme.preset": "Voorinstellingen",
    "theme.apply": "Toepassen",
    "theme.reset": "Terug naar standaardblauw",
    "theme.saved": "Themakleur opgeslagen",
    "theme.previewLeft": "Links",
    "theme.previewMid": "Midden",
    "theme.previewRight": "Rechts",
    "error.prefix": "Fout",
    "capture.title": "Knipsel",
    "capture.saved": "Opgeslagen als notitie",
    "note.created": "Aangemaakt",
    "note.saved": "Opgeslagen",
    "note.deleted": "Naar prullenbak",
    "note.unsaved": "Niet-opgeslagen wijzigingen",
    "draft.found": "Onvoltooide tekst van {when}",
    "draft.resume": "Verder schrijven",
    "draft.discard": "Weggooien",
    "draft.discarded": "Tekst weggegooid",
    "note.menuOpen": "Deze notitie openen",
    "note.localAudio": "Lokale opname",
    "note.outline": "Overzicht",
    "note.copyHeadingLink": "Kopieer een link naar dit kopje",
    "note.openImage": "Open deze afbeelding in Obsidian",
    "note.zoomImage": "Klik om te vergroten",
    "zoom.prev": "Vorige afbeelding",
    "zoom.next": "Volgende afbeelding",
    "zoom.count": "{n} / {total}",
    "note.navBack": "Vorige notitie",
    "note.navForward": "Volgende notitie",
    "note.find": "Zoek in deze notitie",
    "note.findPlaceholder": "Zoeken\u2026",
    "note.findInEditor": "Zoeken in de tekst\u2026",
    "note.findNext": "Volgende",
    "note.findPrev": "Vorige",
    "note.findMiss": 'Geen "{text}" in deze notitie',
    "note.findEnd": "Geen verdere treffers",
    "note.attach": "Bestand toevoegen",
    "attach.added": "Bijlage ingevoegd",
    "attach.failed": "Sommige bestanden zijn niet ge\xFCpload",
    "attach.needNote": "Open eerst een notitie en zet daar bestanden in",
    "note.backlinks": "Notities die hierheen linken",
    "note.backlinkJump": "Naar deze regel",
    "sel.newNote": "Als nieuwe notitie opslaan",
    "note.outlinks": "Links uit deze notitie",
    "note.fontSize": "Tekstgrootte",
    "panel.loading": "Notitiemap laden\u2026",
    "sync.pushOne": "Deze notitie pushen",
    "sync.pullOne": "Deze notitie ophalen",
    "sync.pushedOne": "Naar de cloud gepusht",
    "sync.pulledOne": "Bijgewerkt vanuit de cloud",
    "new.template": "Begin met een",
    "new.pickDir": "Aanmaken in",
    "new.dirPick": "In deze map aanmaken",
    "new.daily": "Dagnotitie",
    "new.dailyHint": "Wat er vandaag gebeurde",
    "new.book": "Boeknotities",
    "new.bookHint": "Titel en inzichten",
    "new.meeting": "Vergadering",
    "new.meetingHint": "Overleg en besluiten",
    "new.note": "Snelnotitie",
    "new.noteHint": "Alleen een titel",
    "new.customHint": "gebruikt je eigen skelet",
    "settings.templateTitle": "Notitiesjablonen",
    "settings.templateDesc": "Bewaar skeletten die je vaker gebruikt en kies ze bij het aanmaken. Dagboek / Boek / Vergadering / Losse notitie staan er altijd.",
    "settings.templateName": "Sjabloonnaam",
    "settings.templateNameHint": "Deze naam zie je in het aanmaakmenu",
    "settings.templateBody": "Skeletinhoud",
    "settings.templateBodyHint": "Leeg laten = alleen een titel; Markdown werkt",
    "settings.templateAdd": "Sjabloon toevoegen",
    "settings.templateSave": "Sjablonen opslaan",
    "settings.templateSaved": "Sjablonen opgeslagen",
    "settings.templateEmpty": "Nog geen eigen sjablonen",
    "settings.templateLimit": "maximaal 12",
    "settings.templateRemove": "Verwijderen",
    "settings.followTitle": "Volg wat je in Obsidian opent",
    "settings.followDesc": "Open je een notitie in Obsidian, dan springt het paneel naar dezelfde, met de verwijzingen en de synchronisatiestatus erachteraan. Het paneel opent zichzelf niet en notities buiten de map Get\u7B14\u8BB0 worden genegeerd.",
    "settings.followToggle": "Laat het paneel mijn notitie volgen",
    "settings.followSaved": "Volginstelling opgeslagen",
    "new.bookTitle": "Boeknotities",
    "new.meetingTitle": "Vergadering",
    "note.fontSize.s": "Klein",
    "note.fontSize.m": "Normaal",
    "note.fontSize.l": "Groot",
    "note.wikilinkMissing": "Geen notitie met de naam \u2018{name}\u2019 in deze map",
    "note.anchorMissing": "Geen kop met de naam \u2018{name}\u2019 in deze notitie",
    "note.blockRef": "Een alinea op deze pagina",
    "note.pickTag": "Filter op deze tag",
    "note.footnote": "Naar deze voetnoot",
    "note.footnoteBack": "Terug naar de verwijzing",
    "note.openEmbed": "Open deze notitie",
    "note.embedBroken": "Deze notitie kon niet gelezen worden",
    "callout.expand": "Uitvouwen",
    "editor.words": "{n} woorden",
    "editor.saveHint": "Ctrl+S om op te slaan \xB7 Ctrl+E om op te slaan en te verlaten \xB7 Esc om te annuleren \xB7 Ctrl+B vet \xB7 Ctrl+I cursief \xB7 Ctrl+F zoeken",
    "callout.collapse": "Invouwen",
    "note.image": "Afbeelding",
    "action.close": "Sluiten",
    "action.back": "Terug naar lijst",
    "history.title": "Versiegeschiedenis",
    "history.restore": "Deze versie herstellen",
    "history.empty": "Nog geen versies",
    "history.emptyHint": "Bij elke keer opslaan of verwijderen wordt automatisch een momentopname bewaard; de laatste 10 blijven staan.",
    "archive.title": "Volledige back-up van de map",
    "archive.desc": "Exporteert \xE9\xE9n zip (bijlagen inbegrepen) zodat je op een andere machine kunt herstellen. Importeren voegt notitie voor notitie samen en overschrijft nooit wat je al hebt.",
    "archive.export": "Zip exporteren",
    "archive.import": "Zip importeren",
    "archive.exporting": "Exporteren\u2026",
    "archive.exported": "Archief ge\xEBxporteerd",
    "archive.scope": "Exportbereik",
    "archive.scopeAll": "Hele kluis",
    "archive.scopeNotes": "Alleen notities",
    "archive.scopeAssets": "Alleen bijlagen",
    "archive.imported": "Import klaar \u2014 toegevoegd/overgeslagen",
    "archive.importMode": "Bij naamconflict",
    "archive.mode.rename": "Beide houden",
    "archive.mode.skip": "Overslaan",
    "tab.conflict": "Conflicten",
    "conflict.desc": "Als beide kanten dezelfde notitie hebben gewijzigd, blijft de lokale kopie in .conflicts/ staan en krijgt de notitie zelf de cloudversie. Vergelijk ze hier en neem met \xE9\xE9n klik een kant over. Het archief wordt nooit verwijderd, dus je kunt later opnieuw kiezen.",
    "conflict.compare": "Vergelijken",
    "conflict.keepLocal": "Mijn lokale kopie gebruiken",
    "conflict.takeCloud": "Cloudversie gebruiken",
    "conflict.back": "Terug",
    "conflict.keptLocal": "Lokale kopie overgenomen",
    "conflict.tookCloud": "Cloudversie overgenomen",
    "conflict.sideLocal": "Mijn lokale versie (gearchiveerd bij conflict)",
    "conflict.sideCloud": "Cloudversie (staat nu in de notitie)",
    "conflict.noLocal": "Deze gearchiveerde kopie heeft geen tekst.",
    "conflict.noCloud": "De notitie zelf is uit de map verdwenen (hernoemd of verwijderd).",
    "conflict.savedAt": "Gearchiveerd op",
    "conflict.modeRendered": "Weergegeven",
    "conflict.modeRaw": "Ruw",
    "conflict.empty": "Geen conflicten om op te lossen",
    "conflict.emptyHint": "Conflicten ontstaan alleen als beide kanten dezelfde notitie wijzigen. Nu geen.",
    "conflict.resolvedSection": "Afgehandeld",
    "conflict.review": "Bekijken",
    "conflict.pickedLocal": "je koos lokaal",
    "conflict.pickedCloud": "je koos cloud",
    "conflict.undo": "Terugzetten op onafgehandeld",
    "conflict.undone": "Teruggezet op onafgehandeld",
    "tab.trash": "Prullenbak",
    "tab.broken": "Dode links",
    "broken.desc": "Elke plek waar een notitie naar iets linkt dat niet in de map staat. Klik op een regel om de notitie te openen en de naam te herstellen.",
    "broken.empty": "Geen dode links",
    "broken.emptyHint": "Elke link in de map wijst ergens naar. Kom later terug na nieuwe links.",
    "broken.found": "{scanned} notities gescand, {n} links wijzen nergens heen.",
    "broken.truncated": "Dat zijn er veel \u2014 alleen de eerste 500 staan er. Herstel er een paar en vernieuw.",
    "broken.line": "regel",
    "broken.jump": "Naar deze regel",
    "todo.jump": "Naar dit punt",
    "todo.copyAll": "Deze lijst kopi\xEBren",
    "todo.copied": "{n} taken gekopieerd",
    "tab.todos": "Taken",
    "todos.desc": "Elk niet-aangevinkt vakje in de map. Klik op een vakje om af te vinken, klik op de tekst om de notitie te openen.",
    "todos.empty": "Niets te doen",
    "todos.emptyHint": "Elke taak in de map is af. Schrijf nieuwe in notities en kom later terug.",
    "todos.found": "{scanned} notities gescand, {n} nog open.",
    "todos.truncated": "Dat zijn er veel \u2014 alleen de eerste 500 staan er. Vink er een paar af en vernieuw.",
    "trash.desc": "Verwijderde notities wachten hier en kunnen worden hersteld. Herstellen zet het bestand gewoon terug.",
    "trash.empty": "De prullenbak is leeg",
    "trash.emptyHint": "Een notitie verwijderen verplaatst hem eerst hierheen. Pas leegmaken verwijdert echt.",
    "trash.deletedAt": "Verwijderd",
    "trash.restore": "Herstellen",
    "trash.restored": "Teruggezet in de map",
    "trash.purgeOne": "Voorgoed verwijderen",
    "trash.purgeAll": "Prullenbak leegmaken",
    "trash.purgeConfirm": "Leegmaken verwijdert deze bestanden echt. Doorgaan?",
    "trash.purgeOneConfirm": "Dit bestand voorgoed verwijderen. Doorgaan?",
    "trash.purged": "Verwijderd",
    "trash.originalName": "Oorspronkelijk bestand",
    "cloud.newNote": "Nieuwe cloudnotitie",
    "cloud.newNoteTitle": "Titel",
    "cloud.newNoteBody": "Tekst",
    "cloud.create": "Aanmaken",
    "cloud.created": "Aangemaakt",
    "cloud.tags": "Tags",
    "cloud.addTagHint": "Typ een tag, druk op Enter of plus",
    "cloud.tagAdded": "Tag toegevoegd",
    "cloud.tagRemoved": "Tag verwijderd",
    "cloud.removeTag": "Deze tag verwijderen",
    "cloud.shareLink": "Deellink",
    "cloud.shareCreated": "Deellink aangemaakt",
    "cloud.shareExcludeAudio": "Audio uitsluiten",
    "cloud.copyLink": "Link kopi\xEBren",
    "cloud.copied": "Gekopieerd",
    "cloud.topics": "Kennisbanken",
    "cloud.allTopics": "Alle cloudnotities",
    "cloud.topicNotes": "Notities in deze kennisbank",
    "cloud.pushLocal": "Lokale wijzigingen naar de cloud pushen",
    "cloud.pushHint": "Overschrijft de cloudtitel en -tekst met deze lokale notitie. Dit wijzigt cloudinhoud.",
    "cloud.pushed": "Naar de cloud gepusht",
    "tab.cloud": "Cloud",
    "cloud.title": "Cloudnotities",
    "cloud.desc": "Lees Get\u7B14\u8BB0 direct, speel opnames af, bewerk tekst, voeg tags toe, verwijder naar de prullenbak.",
    "cloud.notConfigured": "Niet verbonden met Get\u7B14\u8BB0",
    "cloud.notConfiguredDesc": "Voeg je API Key en Client ID toe onder Instellingen \u2192 Cloudtoegang. Maak een persoonlijke app op openapi.biji.com om beide te krijgen.",
    "cloud.loading": "Cloudnotities laden\u2026",
    "cloud.empty": "Nog geen cloudnotities",
    "cloud.loadMore": "Meer laden",
    "cloud.audio": "Opname",
    "cloud.play": "Afspelen",
    "cloud.pause": "Pauzeren",
    "cloud.transcript": "Transcript",
    "cloud.seekTo": "Speel vanaf hier",
    "cloud.moments": "Tijdlijn",
    "cloud.todos": "Taken",
    "cloud.editTitle": "Titel",
    "cloud.editBody": "Tekst",
    "cloud.saveCloud": "Naar de cloud opslaan",
    "cloud.savedCloud": "Naar de cloud opgeslagen; lokale kopie bijgewerkt",
    "cloud.deleteCloud": "Verwijderen (naar prullenbak)",
    "cloud.deletedCloud": "Uit de cloud verwijderd",
    "cloud.addTag": "Tag toevoegen",
    "cloud.share": "Deellink aanmaken",
    "cloud.polling": "Cloudnotitie laden\u2026",
    "cloud.localCopy": "Lokale kopie",
    "cloud.noLocalCopy": "Nog geen lokale kopie",
    "cloud.pullOne": "Lokaal ophalen",
    "sync.title": "Automatisch synchroniseren",
    "sync.desc": "Als dit aan staat, worden nieuwe en gewijzigde cloudnotities volgens een schema naar de lokale map gehaald, zonder klikken. Lokaal bewerkte notities worden nooit overschreven; als beide kanten zijn gewijzigd, gaat er een kopie naar .conflicts.",
    "sync.enabled": "Automatisch synchroniseren aanzetten",
    "sync.interval": "Interval",
    "sync.minutes": "min",
    "sync.incremental": "Alleen wijzigingen (bespaart quotum)",
    "sync.foregroundOnly": "Alleen synchroniseren als het paneel open is",
    "sync.foregroundHint": "Stopt met automatisch synchroniseren als het paneel dicht is of de machine slaapt, wat cloudquotum bespaart. De volgende keer wordt het ingehaald.",
    "sync.now": "Nu synchroniseren",
    "sync.running": "Synchroniseren\u2026",
    "sync.pushAll": "Lokale wijzigingen pushen",
    "sync.pushAllHint": "Alleen notities die je lokaal hebt gewijzigd en nog niet gesynchroniseerd zijn worden gepusht. De cloudversie van dezelfde notitie wordt overschreven \u2014 controleer of die wijzigingen echt van jou zijn.",
    "sync.pushAllDone": "Push voltooid",
    "sync.pushAllPushed": "gepusht",
    "sync.pushAllSkipped": "onveranderd",
    "sync.pushAllFailed": "mislukt",
    "sync.pushAllTruncated": "maximaal 200 per keer, klik nog eens voor de rest",
    "sync.lastRun": "Laatste sync",
    "sync.never": "nooit",
    "sync.result": "Resultaat",
    "sync.pulled": "opgehaald",
    "sync.skipped": "onveranderd",
    "sync.adopted": "lokaal gehouden",
    "sync.conflicts": "conflicten",
    "sync.deleted": "verwijderd",
    "sync.errors": "mislukt",
    "sync.fullScan": "Volledige scan (vindt cloudverwijderingen; langzamer, meer quotum)",
    "sync.quotaHint": "Officieel quotum: 1000 leesacties per dag, 200 schrijfacties per dag. De standaard run elke 15 minuten gebruikt er maar tientallen.",
    "sync.legacy": "Oude eenmalige import",
    "sync.legacyHint": "OAuth-kanaal, alleen bewaard als terugvaloptie wanneer er geen API-sleutel is ingesteld.",
    "api.title": "Cloudtoegang",
    "api.desc": "Voeg je eigen API Key en Client ID toe zodat de plug-in Get\u7B14\u8BB0 kan aansturen: notities lezen, audio afspelen, bewerken, automatisch synchroniseren.",
    "api.apiKey": "API Key",
    "api.clientId": "Client ID",
    "api.grantId": "Grant ID (optioneel, alleen enterprise)",
    "api.keyPlaceholder": "gk_live_...",
    "api.idPlaceholder": "cli_...",
    "api.grantPlaceholder": "grt_... (leeg laten)",
    "api.save": "Inloggegevens opslaan",
    "api.saved": "Inloggegevens opgeslagen",
    "api.test": "Verbinding testen",
    "api.testing": "Testen\u2026",
    "api.ok": "Verbinding ok\xE9",
    "api.clear": "Inloggegevens wissen",
    "api.cleared": "Inloggegevens gewist",
    "api.ready": "Verbonden",
    "api.notReady": "Niet verbonden",
    "api.missing": "ontbreekt",
    "api.file": "Bestand met inloggegevens",
    "api.consoleHint": "Maak een persoonlijke app op openapi.biji.com \u2192 console \u2192 haal de Client ID op en genereer daarna een sleutel op de API Key-pagina.",
    "api.neverEcho": "De sleutel blijft op deze machine en wordt nooit volledig teruggegeven.",
    "api.needKey": "Zowel API Key als Client ID zijn verplicht.",
    "api.keyRejected": "Deze API-sleutel is door de server geweigerd",
    "api.usingFallback": "Je Get\u7B14\u8BB0-login werkt nog, dus de plug-in is automatisch op dat kanaal overgestapt. Controleer in de console of de sleutel actief is en de app de juiste scopes heeft.",
    "api.viaLogin": "Je gebruikt nu het kanaal \u2018inloggen bij Get\u7B14\u8BB0\u2019 \u2014 geen API-sleutel nodig.",
    "lang.title": "Taal",
    "lang.desc": "Kies de taal van het paneel. Automatisch volgt de taal van DeepSeek Harness.",
    "lang.auto": "Automatisch",
    "lang.saved": "Taal opgeslagen",
    "tab.card": "Recordercard",
    "card.title": "Recordercard (direct)",
    "card.desc": "Sla de cloud over \u2014 haal audio rechtstreeks via bluetooth van de recordercard. De kaart moet aan staan, binnen ongeveer 3 meter, en de telefoon-app moet losgekoppeld zijn (zet gewoon bluetooth op je telefoon uit; ontkoppelen is niet nodig).",
    "card.envOk": "Klaar voor gebruik",
    "card.envMissing": "Runtime ontbreekt",
    "card.envHint": "Directe toegang tot de kaart vereist Python 3.10+ en het bleak-pakket op deze computer. Installeren met: pip install bleak",
    "card.envBridge": "Protocolbrug",
    "card.scan": "Kaart zoeken",
    "card.scanning": "Bezig met zoeken\u2026",
    "card.scanFound": "Kaart gevonden",
    "card.scanNone": "Geen kaart gevonden. Controleer of hij aan staat, dichtbij is en bluetooth op je telefoon uit staat.",
    "card.pending": "Te importeren",
    "card.refresh": "Kaart verversen",
    "card.none": "Geen opnames op de kaart.",
    "card.dir": "Importeer in map",
    "card.dirHint": "Laat leeg om de bestaande map \u201CRecordercard\u201D in de kluis te gebruiken.",
    "card.deleteAfter": "Verwijder originelen van de kaart na import",
    "card.deleteAfterHint": "De kaart blijft standaard ongemoeid. Ingeschakeld worden ge\xEFmporteerde bestanden permanent verwijderd.",
    "card.wifiTitle": "Wifi-overdracht",
    "card.wifiDesc": 'Laat de kaart zijn eigen hotspot starten en download eroverheen. Dezelfde bestanden kosten tientallen minuten via Bluetooth en een paar minuten via wifi. De hotspot heeft geen internet \u2014 tik op "Hotspot verlaten" als je klaar bent.',
    "card.wifiAvailable": "Hotspots die op de kaart lijken",
    "card.wifiGo": "Hotspot starten en verbinden",
    "card.wifiBusy": "Bezig\u2026",
    "card.wifiRescan": "Netwerk verversen",
    "card.wifiOff": "Hotspot verlaten",
    "card.wifiSsid": "Hotspotnaam (handmatig)",
    "card.wifiPassword": "Wachtwoord (leeg als er geen is)",
    "card.wifiJoin": "Met deze hotspot verbinden",
    "card.wifiHotspot": "Verbonden met",
    "card.wifiPorts": "Open poorten",
    "card.wifiOn": "Verbonden met de kaarthotspot",
    "card.wifiLeft": "Kaarthotspot verlaten",
    "card.wifiNoHotspot": "De kaart meldde geen hotspot. Deze firmware ondersteunt het misschien niet, of de commandocode klopt nog niet.",
    "card.wifiFail": "Wifi-overdracht startte niet",
    "card.wifiNeedSsid": "Vul eerst een hotspotnaam in",
    "card.import": "Alle opnames importeren",
    "card.importing": "Bezig met importeren\u2026",
    "card.imported": "Import voltooid",
    "card.log": "Voortgang",
    "card.downloaded": "Ge\xEFmporteerd",
    "card.skipped": "Al aanwezig",
    "card.failed": "Mislukt",
    "card.alreadyRunning": "Er loopt al een import.",
    "card.needPython": "Installeer eerst Python en bleak."
  }
};
var uiLocale = null;
var hostLocale = null;
function setHostLocale(value) {
  const raw = typeof value === "string" ? value.toLowerCase().split(/[-_]/)[0] : "";
  hostLocale = raw === "zh" || raw === "en" || raw === "nl" ? raw : null;
}
function setUiLocale(value) {
  uiLocale = value === "zh" || value === "en" || value === "nl" ? value : null;
}
function activeUiLocale() {
  return uiLocale;
}
function resolveLocale() {
  if (uiLocale !== null) return uiLocale;
  if (hostLocale !== null) return hostLocale;
  return null;
}
var boundCtx = null;
function makeT(ctx) {
  const bound = () => {
    const host = ctx || boundCtx;
    if (!host || !host.locale || typeof host.locale.bind !== "function") return null;
    try {
      return host.locale.bind(NS);
    } catch {
      return null;
    }
  };
  return (key) => {
    const picked = resolveLocale();
    if (picked !== null) {
      const dict = LEX[picked];
      if (dict && typeof dict[key] === "string") return dict[key];
    }
    const translate = bound();
    if (translate) {
      try {
        const text = translate(key);
        if (typeof text === "string" && text !== key && text !== "") return text;
      } catch {
      }
    }
    return LEX.zh[key] || key;
  };
}
var panelT = null;
function getT() {
  if (panelT === null) panelT = makeT(void 0);
  return panelT;
}
var inflight = /* @__PURE__ */ new Map();
function requestId() {
  const bytes = new Uint8Array(8);
  const crypto = typeof window !== "undefined" ? window.crypto : void 0;
  if (crypto && typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
  else for (let i3 = 0; i3 < bytes.length; i3 += 1) bytes[i3] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b3) => b3.toString(16).padStart(2, "0")).join("");
}
var RETRY_DELAYS = [180, 520];
function sleep2(ms) {
  return new Promise((resolve5) => window.setTimeout(resolve5, ms));
}
async function api(path, init) {
  const options = { ...init || {} };
  const method = String(options.method || "GET").toUpperCase();
  const idempotent = method === "GET";
  const group = String(path).split("?")[0];
  let signal = options.signal;
  if (idempotent) {
    const previous = inflight.get(group);
    if (previous !== void 0 && typeof previous.abort === "function") previous.abort();
    const controller = new AbortController();
    inflight.set(group, controller);
    signal = controller.signal;
  }
  const headers = { ...options.headers || {} };
  if (__apiToken !== "") headers["x-getnote-token"] = __apiToken;
  let attempt = 0;
  for (; ; ) {
    try {
      const res = await fetch(`${apiOrigin()}/getnote${path}`, {
        ...options,
        headers,
        signal
      });
      let json = {};
      try {
        json = await res.json();
      } catch {
      }
      if (!res.ok) {
        const err = new Error(json && json.error || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return json;
    } catch (error2) {
      const aborted = error2 !== null && typeof error2 === "object" && (error2.name === "AbortError" || signal.aborted);
      if (aborted) throw error2;
      const hasStatus = error2 !== null && typeof error2 === "object" && typeof error2.status === "number";
      const retryable = idempotent && !hasStatus && attempt < RETRY_DELAYS.length;
      if (!retryable) throw error2;
      await sleep2(RETRY_DELAYS[attempt]);
      attempt += 1;
    }
  }
}
async function uploadAsset(notePath, file) {
  const name = String(file && file.name || "") || "file";
  const buffer = await file.arrayBuffer();
  const response = await fetch(
    `${apiOrigin()}/getnote/asset/upload?path=${encodeURIComponent(String(notePath || ""))}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        // 头里只能放 ASCII，中文文件名得先编码，服务端那边再解回来
        "x-getnote-filename": encodeURIComponent(name),
        ...__apiToken === "" ? {} : { "x-getnote-token": __apiToken }
      },
      body: buffer
    }
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json && json.error || `HTTP ${response.status}`);
  return json;
}
function formatBytes2(bytes) {
  const n2 = Number(bytes) || 0;
  if (n2 < 1024) return `${n2} B`;
  if (n2 < 1024 * 1024) return `${(n2 / 1024).toFixed(1)} KB`;
  return `${(n2 / (1024 * 1024)).toFixed(1)} MB`;
}
function assetLabel(name) {
  const raw = String(name || "");
  if (raw === "") return "";
  const ext = (/\.([a-z0-9]+)$/i.exec(raw) || [])[1] || "";
  let stem = ext === "" ? raw : raw.slice(0, -(ext.length + 1));
  for (let i3 = 0; i3 < 4; i3 += 1) {
    const next = stem.replace(/_\d{10,}$/, "").replace(/_(audio|transcript|image|video)$/i, "");
    if (next === stem) break;
    stem = next;
  }
  return ext === "" ? stem : `${stem}.${ext}`;
}
function parseHex(input) {
  if (typeof input !== "string") return null;
  const raw = input.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(raw);
  if (short) return { r: parseInt(short[1] + short[1], 16), g: parseInt(short[2] + short[2], 16), b: parseInt(short[3] + short[3], 16) };
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(raw);
  if (long) return { r: parseInt(long[1], 16), g: parseInt(long[2], 16), b: parseInt(long[3], 16) };
  return null;
}
function rgbToHsl(r3, g4, b3) {
  const rn2 = r3 / 255;
  const gn2 = g4 / 255;
  const bn2 = b3 / 255;
  const max = Math.max(rn2, gn2, bn2);
  const min = Math.min(rn2, gn2, bn2);
  const l3 = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l3 };
  const d3 = max - min;
  const s3 = l3 > 0.5 ? d3 / (2 - max - min) : d3 / (max + min);
  let h5;
  if (max === rn2) h5 = ((gn2 - bn2) / d3 + (gn2 < bn2 ? 6 : 0)) / 6;
  else if (max === gn2) h5 = ((bn2 - rn2) / d3 + 2) / 6;
  else h5 = ((rn2 - gn2) / d3 + 4) / 6;
  return { h: h5, s: s3, l: l3 };
}
function hslToHex(h5, s3, l3) {
  const hue = (h5 % 1 + 1) % 1;
  const sat = Math.min(1, Math.max(0, s3));
  const lig = Math.min(1, Math.max(0, l3));
  if (sat === 0) {
    const v3 = Math.round(lig * 255);
    const hex = v3.toString(16).padStart(2, "0");
    return `#${hex}${hex}${hex}`;
  }
  const q4 = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
  const p3 = 2 * lig - q4;
  const channel = (t4) => {
    let tt = t4;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    let value;
    if (tt < 1 / 6) value = p3 + (q4 - p3) * 6 * tt;
    else if (tt < 1 / 2) value = q4;
    else if (tt < 2 / 3) value = p3 + (q4 - p3) * (2 / 3 - tt) * 6;
    else value = p3;
    return Math.round(value * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(hue + 1 / 3)}${channel(hue)}${channel(hue - 1 / 3)}`;
}
var DEFAULT_THEME_COLOR = "#0a2a52";
var panelRoots = /* @__PURE__ */ new Set();
function rootsOf(doc) {
  const list = [];
  for (const el of panelRoots) {
    if (!el || el.isConnected === false) continue;
    if (doc === void 0 || el.ownerDocument === doc) list.push(el);
  }
  return list;
}
function panelDocuments() {
  const docs = [];
  for (const el of rootsOf()) {
    const doc = el.ownerDocument;
    if (doc && docs.indexOf(doc) === -1) docs.push(doc);
  }
  if (docs.length === 0 && typeof document !== "undefined") docs.push(document);
  return docs;
}
function panelDocument() {
  const docs = panelDocuments();
  return docs.length === 0 ? null : docs[0];
}
function panelWindows() {
  const wins = [];
  for (const doc of panelDocuments()) {
    const win = doc.defaultView;
    if (win && wins.indexOf(win) === -1) wins.push(win);
  }
  return wins;
}
function docOfEvent(event) {
  const target = event ? event.target : null;
  if (!target) return void 0;
  if (target.ownerDocument) return target.ownerDocument;
  if (target.document) return target.document;
  return void 0;
}
function inPanel(event) {
  const target = event ? event.target : null;
  if (!target || typeof target !== "object") return false;
  for (const root of rootsOf(docOfEvent(event))) {
    if (typeof root.contains === "function" && root.contains(target)) return true;
  }
  return false;
}
function findInPanel(selector, doc) {
  const groups = doc ? [rootsOf(doc), rootsOf()] : [rootsOf()];
  for (const group of groups) {
    for (const el of group) {
      if (typeof el.querySelector !== "function") continue;
      const hit = el.querySelector(selector);
      if (hit) return hit;
    }
  }
  return null;
}
function isDarkTheme() {
  const doc = panelDocument();
  if (doc === null || !doc.body) return false;
  return doc.body.classList.contains("theme-dark");
}
function themeVars(input, dark = false) {
  const rgb = parseHex(input) || (dark === true ? parseHex(DEFAULT_THEME_COLOR) : null);
  if (rgb === null) return null;
  const base = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const hue = base.h;
  const sat = base.s;
  const tint = (min, max) => sat < 0.12 ? Math.min(sat, 0.06) : Math.min(max, Math.max(min, sat));
  if (dark === true) {
    return {
      "--dshgn-deep": hslToHex(hue, tint(0.3, 0.56), 0.075),
      "--dshgn-deep2": hslToHex(hue, tint(0.32, 0.6), 0.045),
      "--dshgn-deepFg": "#ffffff",
      "--dshgn-deepFg2": "rgba(255,255,255,.86)",
      "--dshgn-deepFg3": "rgba(255,255,255,.62)",
      "--dshgn-mid": hslToHex(hue, tint(0.24, 0.44), 0.125),
      "--dshgn-mid2": hslToHex(hue, tint(0.26, 0.48), 0.095),
      "--dshgn-midFg": "rgba(255,255,255,.92)",
      "--dshgn-midFg2": "rgba(255,255,255,.72)",
      "--dshgn-midFg3": "rgba(255,255,255,.52)",
      "--dshgn-light": hslToHex(hue, tint(0.18, 0.36), 0.155),
      "--dshgn-light2": hslToHex(hue, tint(0.2, 0.4), 0.185),
      "--dshgn-lightFg": "rgba(255,255,255,.94)",
      "--dshgn-lightFg2": "rgba(255,255,255,.74)",
      "--dshgn-lightFg3": "rgba(255,255,255,.54)",
      "--dshgn-accentOnDark": hslToHex(hue, 0.86, 0.8),
      "--dshgn-accentOnLight": hslToHex(hue, 0.82, 0.68),
      "--dshgn-tintRgb": `${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)}`,
      "--dshgn-btnFill": hslToHex(hue, 0.68, 0.5),
      "--dshgn-btnHover": hslToHex(hue, 0.7, 0.58),
      "--dshgn-btnFillSoft": hslToHex(hue, 0.44, 0.42),
      "--dshgn-btnHoverSoft": hslToHex(hue, 0.48, 0.5),
      "--dshgn-btnFillPale": hslToHex(hue, 0.34, 0.32),
      "--dshgn-btnHoverPale": hslToHex(hue, 0.38, 0.38)
    };
  }
  return {
    // 左栏：深，但要保证白字对比度足够（明度 15% 配 93% 的字够 WCAG AA）
    "--dshgn-deep": hslToHex(hue, tint(0.42, 0.82), 0.15),
    "--dshgn-deep2": hslToHex(hue, tint(0.46, 0.86), 0.09),
    "--dshgn-deepFg": "#ffffff",
    "--dshgn-deepFg2": "rgba(255,255,255,.86)",
    "--dshgn-deepFg3": "rgba(255,255,255,.66)",
    // 中栏：浅
    "--dshgn-mid": hslToHex(hue, tint(0.46, 0.88), 0.855),
    "--dshgn-mid2": hslToHex(hue, tint(0.48, 0.88), 0.815),
    "--dshgn-midFg": hslToHex(hue, 0.6, 0.16),
    "--dshgn-midFg2": hslToHex(hue, 0.42, 0.36),
    "--dshgn-midFg3": hslToHex(hue, 0.32, 0.52),
    // 右栏：极浅近白。故意留一点点色相，纯白会让三栏看起来断成两块。
    "--dshgn-light": hslToHex(hue, tint(0.3, 0.7), 0.985),
    "--dshgn-light2": hslToHex(hue, tint(0.34, 0.74), 0.955),
    "--dshgn-lightFg": hslToHex(hue, 0.4, 0.17),
    "--dshgn-lightFg2": hslToHex(hue, 0.25, 0.34),
    "--dshgn-lightFg3": hslToHex(hue, 0.18, 0.5),
    // 强调色：深底上要够亮，浅底上要够沉，否则链接/选中态会糊掉
    "--dshgn-accentOnDark": hslToHex(hue, 0.92, 0.74),
    "--dshgn-accentOnLight": hslToHex(hue, 0.8, 0.38),
    // 所有半透明描边/阴影统一由这一个分量推导。
    // 原来 17 处硬编码 rgba(var(--dshgn-tintRgb),…) 散在 CSS 里，换主题色时它们不会跟着变，
    // 界面就会「底色换了、线条还是旧的蓝」。
    "--dshgn-tintRgb": `${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)}`,
    "--dshgn-btnFill": hslToHex(hue, 0.72, 0.48),
    "--dshgn-btnHover": hslToHex(hue, 0.75, 0.56),
    // 次要强调按钮（冲突比对里的「用我的本地版」这类）：比主按钮淡一档。
    // 同样由色相推导而不是写死蓝——换主题色后它还必须是「淡的那一版」，
    // 写死的话在墨绿/酒红主题下会突然跳出一块亮蓝，比不淡更难看。
    "--dshgn-btnFillSoft": hslToHex(hue, 0.52, 0.62),
    "--dshgn-btnHoverSoft": hslToHex(hue, 0.56, 0.55),
    // 冲突页采纳按钮的「已选中」填充色。比 btnFillSoft 更浅一档——那个色
    // 用在主操作上刚好，但冲突页三个按钮并排，太饱和会让人以为哪个是
    // 主按钮；这里要表达的是「我选过这个」，不是「点这个」。
    "--dshgn-btnFillPale": hslToHex(hue, 0.44, 0.74),
    "--dshgn-btnHoverPale": hslToHex(hue, 0.48, 0.68)
  };
}
function formatTime(iso) {
  if (!iso) return "";
  const d3 = new Date(iso);
  if (Number.isNaN(d3.getTime())) return "";
  const pad2 = (n2) => String(n2).padStart(2, "0");
  return `${d3.getFullYear()}-${pad2(d3.getMonth() + 1)}-${pad2(d3.getDate())} ${pad2(d3.getHours())}:${pad2(d3.getMinutes())}`;
}
var ICONS = {
  brain: "M9.2 3.4A5.2 5.2 0 0 0 4 8.6c0 1 .3 1.9.8 2.7A3.9 3.9 0 0 0 3.6 14a4 4 0 0 0 2.3 3.6A4.3 4.3 0 0 0 9.6 21c.9 0 1.7-.3 2.4-.8.7.5 1.5.8 2.4.8a4.3 4.3 0 0 0 3.7-3.4A4 4 0 0 0 20.4 14a3.9 3.9 0 0 0-1.2-2.7c.5-.8.8-1.7.8-2.7a5.2 5.2 0 0 0-5.2-5.2c-.9 0-1.7.2-2.4.6a4.6 4.6 0 0 0-2.4-.6Z M12 6.4v13.2 M12 12.2 8.6 9.6 M12 15.4l3.4-2.6",
  folder: "M3 7.5A2.5 2.5 0 0 1 5.5 5h3l2 2h8A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5Z",
  file: "M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9Zm0 0v6h6",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z M16.5 16.5 21 21",
  plus: "M12 5v14 M5 12h14",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13",
  edit: "M4 20h4l10-10-4-4L4 16Z M14 6l4 4",
  cloud: "M7 18a4 4 0 0 1 .6-7.96A5.5 5.5 0 0 1 18 10.5a3.5 3.5 0 0 1-.5 7.5Z",
  check: "M4 12.5 9.5 18 20 6.5",
  gear: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.56-1.03 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
  up: "M12 19V5 M5 12l7-7 7 7",
  close: "M6 6l12 12 M18 6 6 18",
  link: "M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 1 0-5-5l-1.2 1.2 M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 1 0 5 5l1.2-1.2",
  play: "M8 5.5v13l11-6.5Z",
  pause: "M9 5v14 M15 5v14",
  audio: "M4 13v-2a8 8 0 0 1 16 0v2 M4 13h2.5v5H5a1 1 0 0 1-1-1Z M20 13h-2.5v5H19a1 1 0 0 0 1-1Z",
  sync: "M4 9a8 8 0 0 1 13.7-3.3L20 8 M20 4v4h-4 M20 15a8 8 0 0 1-13.7 3.3L4 16 M4 20v-4h4",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 7v5l3.5 2",
  book: "M4 5.5A1.5 1.5 0 0 1 5.5 4H19v16H5.5A1.5 1.5 0 0 1 4 18.5Z M8 4v16",
  chevron: "M9 6l6 6-6 6",
  calendar: "M4 7h16v13H4Z M4 11h16 M8 4v5 M16 4v5",
  note: "M5 4h9l5 5v11H5Z M14 4v5h5 M8 13h8 M8 17h5",
  "external-link": "M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  rename: "M9 4h6 M12 4v16 M9 20h6",
  attach: "M14 3.5a4.5 4.5 0 0 1 6.4 6.4l-8.5 8.5a3 3 0 0 1-4.2-4.2l7.8-7.8",
  warn: "M12 4 3.5 19.5h17Z M12 10v4 M12 17h.01",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 11v5 M12 8h.01",
  down: "M12 5v14 M5 12l7 7 7-7",
  left: "M19 12H5 M12 5l-7 7 7 7",
  right: "M5 12h14 M12 5l7 7-7 7",
  hash: "M9.5 4 7.5 20 M16.5 4l-2 16 M4 9.5h16 M3.5 14.5h16",
  copy: "M9 9h11v11H9Z M15 9V4H4v11h5"
};
function Icon(props) {
  const size = props && typeof props.size === "number" ? props.size : 16;
  const name = props && props.name ? props.name : "brain";
  const path = ICONS[name] || ICONS.brain;
  return h4(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.7,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      className: props && props.className ? props.className : void 0
    },
    path.split(" M").map(
      (segment, index) => h4("path", { key: index, d: index === 0 ? segment : `M${segment}` })
    )
  );
}
function markdownLinkTarget(href) {
  const raw = String(href || "").trim();
  if (raw === "") return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  if (raw.startsWith("#")) {
    const anchor2 = raw.slice(1).trim();
    return anchor2 === "" ? null : { target: "", anchor: anchor2 };
  }
  const hashAt = raw.indexOf("#");
  const pathPart = (hashAt === -1 ? raw : raw.slice(0, hashAt)).replace(/^\.\//, "").replace(/^\/+/, "");
  const anchor = hashAt === -1 ? "" : raw.slice(hashAt + 1).trim();
  if (pathPart === "") return anchor === "" ? null : { target: "", anchor };
  if (/\.(?!md$)[a-z0-9]{1,6}$/i.test(pathPart)) return null;
  const target = pathPart.replace(/\.md$/i, "");
  if (target === "") return null;
  return { target, anchor };
}
function renderInline(text, keyPrefix, options) {
  const opts = options || {};
  const nodes = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(~~[^~\n]+~~)|(==[^=\n]+==)|(%%[\s\S]*?%%)|(!?\[\[[^\]\n]+\]\])|(\[[^\]\n]*\]\([^)\s]+\))|(https?:\/\/[^\s)]+)|(\[\^[^\]\n]+\])|(#[^\s#`]+)/g;
  let last = 0;
  let match;
  let seq = 0;
  const deadLink = (name) => {
    const wanted = String(name || "").trim();
    if (wanted === "") return false;
    if (typeof opts.resolveNote !== "function") return false;
    try {
      return opts.resolveNote(wanted) === "";
    } catch {
      return false;
    }
  };
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${seq++}`;
    if (token.startsWith("`")) {
      nodes.push(h4("code", { key, className: "dshgn_code" }, token.slice(1, -1)));
    } else if (token.startsWith("**")) {
      nodes.push(h4("strong", { key }, token.slice(2, -2)));
    } else if (token.startsWith("*")) {
      nodes.push(h4("em", { key }, token.slice(1, -1)));
    } else if (token.startsWith("~~")) {
      nodes.push(h4("del", { key, className: "dshgn_del" }, token.slice(2, -2)));
    } else if (token.startsWith("==")) {
      nodes.push(h4("mark", { key, className: "dshgn_mark" }, token.slice(2, -2)));
    } else if (token.startsWith("%%")) {
    } else if (token.startsWith("[[") || token.startsWith("![[")) {
      const embed = token.startsWith("!");
      const inner = token.slice(embed ? 3 : 2, -2);
      const pipe = inner.indexOf("|");
      const linkText = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
      const label = pipe === -1 ? "" : inner.slice(pipe + 1).trim();
      const hash = linkText.indexOf("#");
      const target = (hash === -1 ? linkText : linkText.slice(0, hash)).trim();
      const anchor = hash === -1 ? "" : linkText.slice(hash + 1).trim();
      if (embed) {
        if (target === "" && anchor !== "") {
          nodes.push(
            h4(
              "button",
              {
                key,
                type: "button",
                className: "dshgn_wikilink",
                onClick: () => {
                  if (typeof opts.onOpenWikiLink === "function") opts.onOpenWikiLink("", anchor);
                }
              },
              label || anchor
            )
          );
          last = match.index + token.length;
          continue;
        }
        const embedded = renderEmbed(target, key, Object.assign({}, opts, { anchor, label }));
        const blockLevel = embedded !== null && embedded !== void 0 && embedded.type === NoteEmbed;
        nodes.push(blockLevel ? embedded : h4("span", { key, className: "dshgn_embed" }, embedded));
      } else {
        const dead = deadLink(target);
        nodes.push(
          h4(
            "button",
            {
              key,
              type: "button",
              className: "dshgn_wikilink" + (dead ? " dshgn_wikilinkDead" : ""),
              title: dead ? getT()("note.wikilinkMissing").replace("{name}", target) : void 0,
              // 双链在 Obsidian 里是跳转。这里没有 Obsidian 的解析器，尽力而为：
              // 有完整路径就按路径打开，只写标题就在当前库里按标题/文件名找。
              onClick: () => {
                if (typeof opts.onOpenWikiLink === "function") opts.onOpenWikiLink(target, anchor);
              }
            },
            // 带小节时显示「笔记 › 小节」：只显示笔记名的话，同一篇被链到
            // 不同小节看起来一模一样，点进去落在哪儿全靠猜。
            // 块引用那一串 `^abc123` 对人没有意义，不摆在链接上：
            // 有笔记名就只显示笔记名，只有块 id 时显示「本页某一段」。
            label || (isBlockAnchor(anchor) ? target === "" ? t("note.blockRef") : target : target === "" ? anchor : anchor === "" ? target : `${target} \u203A ${anchor}`)
          )
        );
      }
    } else if (token.startsWith("[^")) {
      const footId = token.slice(2, -1).trim();
      nodes.push(
        h4(
          "sup",
          {
            key,
            className: "dshgn_footRef",
            "data-footnote-ref": footId,
            title: getT()("note.footnote"),
            onClick: (event) => {
              const box = event && event.currentTarget ? event.currentTarget.closest(".dshgn_md") : null;
              if (box) scrollToFootnote(box, footId);
            }
          },
          footId
        )
      );
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      const inner = typeof opts.onOpenWikiLink === "function" ? markdownLinkTarget(href) : null;
      if (inner !== null) {
        const dead = deadLink(inner.target);
        nodes.push(
          h4(
            "button",
            {
              key,
              type: "button",
              className: "dshgn_wikilink" + (dead ? " dshgn_wikilinkDead" : ""),
              title: dead ? getT()("note.wikilinkMissing").replace("{name}", inner.target) : void 0,
              onClick: () => opts.onOpenWikiLink(inner.target, inner.anchor)
            },
            label === "" ? inner.anchor === "" ? inner.target : inner.anchor : label
          )
        );
      } else {
        nodes.push(
          h4(
            "a",
            { key, href, target: "_blank", rel: "noreferrer noopener", className: "dshgn_link" },
            label
          )
        );
      }
    } else if (token.startsWith("#")) {
      const body = token.slice(1);
      if (!tagBodyOf(body)) {
        nodes.push(token);
      } else {
        const before = match.index > 0 ? text[match.index - 1] : "";
        const lead = before === "" || /[\s([{>（【，、；：]/.test(before);
        if (!lead) {
          nodes.push(token);
        } else if (typeof opts.onPickTag === "function") {
          nodes.push(
            h4(
              "button",
              {
                key,
                type: "button",
                className: "dshgn_inlineTag",
                title: getT()("note.pickTag"),
                onClick: () => opts.onPickTag(body)
              },
              `#${body}`
            )
          );
        } else {
          nodes.push(h4("span", { key, className: "dshgn_inlineTag" }, `#${body}`));
        }
      }
    } else {
      nodes.push(
        h4("a", { key, href: token, target: "_blank", rel: "noreferrer noopener", className: "dshgn_link" }, token)
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
function normalizeHeading(text) {
  return String(text || "").replace(/^#+\s*/, "").replace(/\s+#+\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
}
var BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9-]{1,64})\s*$/;
function isBlockAnchor(text) {
  return /^\^\s*[A-Za-z0-9-]{1,64}$/.test(String(text || "").trim());
}
function blockIdIn(text) {
  const hit = BLOCK_ID_RE.exec(String(text || ""));
  return hit === null ? "" : hit[1];
}
function stripBlockId(text) {
  return String(text || "").replace(BLOCK_ID_RE, "").trim();
}
function headingNodes(host) {
  if (!host) return [];
  const own = host.querySelectorAll(".dshgn_h");
  if (own.length > 0) return Array.from(own);
  return Array.from(host.querySelectorAll("h1, h2, h3, h4, h5, h6"));
}
function frontmatterText(value) {
  if (value === null || value === void 0) return "";
  if (Array.isArray(value)) {
    return value.map((item) => frontmatterText(item)).filter((text) => text !== "").join(" \xB7 ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value).trim();
}
function aliasesOf(entry) {
  const data = entry !== null && entry !== void 0 && typeof entry === "object" ? entry.aliases : null;
  if (!Array.isArray(data)) return [];
  return data.map((item) => String(item === null || item === void 0 ? "" : item).trim()).filter((item) => item !== "");
}
function tagBodyOf(value) {
  const body = String(value === null || value === void 0 ? "" : value);
  if (body === "") return false;
  if (!/^[\w\u4e00-\u9fa5/-]+$/.test(body)) return false;
  if (/^[\d/]+$/.test(body)) return false;
  if (body.endsWith("/")) return false;
  return true;
}
function isTagKey(key) {
  const name = String(key || "").trim().toLowerCase();
  return name === "tags" || name === "tag" || name === "\u6807\u7B7E" || name === "\u6807\u7B7E\u9875";
}
function scrollToHeading(box, text) {
  if (!box) return false;
  const want = normalizeHeading(text);
  if (want === "") return false;
  const heads = headingNodes(box);
  let hit = null;
  for (let i3 = 0; i3 < heads.length; i3 += 1) {
    if (normalizeHeading(heads[i3].textContent) === want) {
      hit = heads[i3];
      break;
    }
  }
  const host = scrollHostOf(box);
  if (!host) return false;
  scrollHostTo(host, hit);
  return true;
}
function blockTextOf(body, id) {
  const want = String(id === void 0 || id === null ? "" : id).trim().replace(/^\^/, "");
  if (want === "") return "";
  const lines = String(body === void 0 || body === null ? "" : body).split("\n");
  let inFence = false;
  for (let i3 = 0; i3 < lines.length; i3 += 1) {
    const line = lines[i3];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (blockIdIn(line) !== want) continue;
    let start = i3;
    const isList = /^\s*([-*+]|\d+[.)])\s+/.test(line);
    if (!isList) {
      while (start > 0 && lines[start - 1].trim() !== "" && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[start - 1]) && !/^#{1,6}\s/.test(lines[start - 1])) {
        start -= 1;
      }
    }
    let end = i3;
    if (!isList) {
      while (end + 1 < lines.length && lines[end + 1].trim() !== "" && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[end + 1]) && !/^#{1,6}\s/.test(lines[end + 1])) {
        end += 1;
      }
    }
    const picked = lines.slice(start, end + 1);
    picked[picked.length - 1] = stripBlockId(picked[picked.length - 1]);
    return picked.join("\n").trim();
  }
  return "";
}
function scrollToBlock(box, id) {
  const want = String(id || "").trim().replace(/^\^/, "");
  if (want === "") return false;
  const host = scrollHostOf(box);
  if (!host) return false;
  let hit = null;
  try {
    hit = host.querySelector('[data-block-id="' + want + '"]');
  } catch (error2) {
    hit = null;
  }
  if (!hit) return false;
  return scrollHostTo(host, hit);
}
function scrollToFootnote(box, id) {
  const want = String(id || "").trim();
  if (want === "") return false;
  const host = scrollHostOf(box);
  if (!host) return false;
  let hit = null;
  try {
    hit = host.querySelector('[data-footnote-id="' + want + '"]');
  } catch (error2) {
    hit = null;
  }
  if (!hit) return false;
  return scrollHostTo(host, hit);
}
function scrollToFootnoteRef(box, id) {
  const want = String(id || "").trim();
  if (want === "") return false;
  const host = scrollHostOf(box);
  if (!host) return false;
  let hit = null;
  try {
    hit = host.querySelector('[data-footnote-ref="' + want + '"]');
  } catch (error2) {
    hit = null;
  }
  if (!hit) return false;
  return scrollHostTo(host, hit);
}
function scrollHostOf(box) {
  if (!box) return null;
  if (box.classList && box.classList.contains("dshgn_scroll")) return box;
  let host = box.parentElement;
  while (host && !(host.classList && host.classList.contains("dshgn_scroll"))) host = host.parentElement;
  return host || null;
}
function scrollHostTo(host, hit) {
  if (!host || !hit) return false;
  const offset = hit.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop - 8;
  host.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
  return true;
}
function lineNeedle(text) {
  let line = String(text || "");
  line = line.replace(/^\s*(?:>\s*)+/, "");
  line = line.replace(/^\s*#{1,6}\s*/, "");
  line = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
  line = line.replace(/^\s*\[[ xX]\]\s+/, "");
  line = line.replace(/!?\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (all, target, label) => label || target || "");
  line = line.replace(/\[([^\]\n]*)\]\([^)\s]+\)/g, "$1");
  line = line.replace(/[*_`~]+/g, "");
  line = line.replace(/\s+/g, " ").trim();
  return line.slice(0, 40);
}
function splitByTerms(text, terms) {
  const line = String(text || "");
  const list = (Array.isArray(terms) ? terms : []).map((term) => String(term || "").trim()).filter((term) => term !== "").sort((a3, b3) => b3.length - a3.length);
  if (line === "" || list.length === 0) return [{ hit: false, text: line }];
  const escaped = list.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp("(" + escaped.join("|") + ")", "gi");
  const parts = [];
  let last = 0;
  let m3;
  while ((m3 = re.exec(line)) !== null) {
    if (m3.index > last) parts.push({ hit: false, text: line.slice(last, m3.index) });
    parts.push({ hit: true, text: m3[0] });
    last = m3.index + m3[0].length;
    if (m3[0] === "") re.lastIndex += 1;
  }
  if (last < line.length) parts.push({ hit: false, text: line.slice(last) });
  return parts.length > 0 ? parts : [{ hit: false, text: line }];
}
function searchSuggestAt(text, caret) {
  const source = String(text === null || text === void 0 ? "" : text);
  const at = Number.isInteger(caret) ? caret : source.length;
  if (at < 0 || at > source.length) return null;
  const before = source.slice(0, at);
  let start = at;
  while (start > 0 && !/[ \t\n]/.test(before.charAt(start - 1))) start -= 1;
  const word = before.slice(start);
  if (word === "") return null;
  const kind = word.startsWith("dir:") ? "dir" : word.startsWith("#") || word.startsWith("tag:") ? "tag" : "both";
  const query = word.replace(/^(dir:|tag:|#)/, "");
  return { kind, query, start: start + word.length - query.length, wordStart: start };
}
function searchSuggestions(dirs, tags, kind, query, limit = 6) {
  const q4 = String(query || "").trim().toLowerCase();
  const out = [];
  const push = (value, tag) => {
    const text = String(value || "").trim();
    if (text === "") return;
    if (q4 !== "" && !text.toLowerCase().includes(q4)) return;
    out.push({ value: text, kind: tag });
  };
  if (kind === "dir" || kind === "both") for (const dir of dirs || []) push(dir, "dir");
  if (kind === "tag" || kind === "both") for (const tag of tags || []) push(tag, "tag");
  out.sort((a3, b3) => {
    const sa = a3.value.toLowerCase().startsWith(q4) ? 0 : 1;
    const sb = b3.value.toLowerCase().startsWith(q4) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return a3.value.localeCompare(b3.value, "zh");
  });
  return out.slice(0, limit);
}
function searchTermsOf(query) {
  const rest = String(query || "").replace(/(?:^|\s)(?:tag|dir):(?:"[^"]*"|\S+)/gi, " ").replace(/(?:^|\s)#([^\s#]+)/g, " ");
  const terms = [];
  const re = /(-?)"([^"]*)"|(-?)(\S+)/g;
  let m3;
  while ((m3 = re.exec(rest)) !== null) {
    const neg = (m3[1] !== void 0 ? m3[1] : m3[3]) === "-";
    const value = (m3[2] !== void 0 ? m3[2] : m3[4]).trim();
    if (value === "" || neg) continue;
    terms.push(value);
  }
  return terms;
}
function highlightTerms(text, terms) {
  const parts = splitByTerms(text, terms);
  if (parts.length === 1 && !parts[0].hit) return parts[0].text;
  return parts.map(
    (part, index) => part.hit ? h4("span", { key: `hit-${index}`, className: "dshgn_matchHit" }, part.text) : part.text
  );
}
function textHasParts(hay, needle) {
  if (hay === "" || needle === "") return false;
  if (hay.includes(needle)) return true;
  const parts = needle.split(" ").filter((part) => part !== "");
  if (parts.length < 2) return false;
  let at = 0;
  for (let i3 = 0; i3 < parts.length; i3 += 1) {
    const found = hay.indexOf(parts[i3], at);
    if (found === -1) return false;
    at = found + parts[i3].length;
  }
  return true;
}
function scrollToText(box, text) {
  const needle = lineNeedle(text);
  if (needle === "") return false;
  const host = scrollHostOf(box);
  if (!host) return false;
  const blocks = host.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th");
  for (let i3 = 0; i3 < blocks.length; i3 += 1) {
    const node = blocks[i3];
    if (node.querySelector("p, li, blockquote, pre")) continue;
    if (textHasParts(String(node.textContent || "").replace(/\s+/g, " "), needle)) return scrollHostTo(host, node);
  }
  return false;
}
function findInBodyMatch(box, text, forward = true) {
  const needle = lineNeedle(text);
  if (needle === "") return null;
  const host = scrollHostOf(box);
  if (!host) return null;
  const blocks = host.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th");
  const matches = [];
  for (let i3 = 0; i3 < blocks.length; i3 += 1) {
    const node = blocks[i3];
    if (node.querySelector("p, li, blockquote, pre")) continue;
    if (String(node.textContent || "").replace(/\s+/g, " ").includes(needle)) matches.push(node);
  }
  if (matches.length === 0) return null;
  const top = host.getBoundingClientRect().top;
  const offsetOf = (node) => node.getBoundingClientRect().top - top;
  return forward ? matches.find((node) => offsetOf(node) > 12) || null : [...matches].reverse().find((node) => offsetOf(node) < -12) || null;
}
function findInBody(box, text, forward = true) {
  const target = findInBodyMatch(box, text, forward);
  if (!target) return null;
  const host = scrollHostOf(box);
  if (!host) return null;
  return scrollHostTo(host, target) ? target : null;
}
function findAllBodyMatches(box, text) {
  const needle = lineNeedle(text);
  if (needle === "") return [];
  const host = scrollHostOf(box);
  if (!host) return [];
  const blocks = host.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th");
  const out = [];
  for (let i3 = 0; i3 < blocks.length; i3 += 1) {
    const node = blocks[i3];
    if (node.querySelector("p, li, blockquote, pre")) continue;
    if (String(node.textContent || "").replace(/\s+/g, " ").includes(needle)) out.push(node);
  }
  return out;
}
function countTextMatches(text, needle) {
  const src = String(text || "").toLowerCase();
  const want = String(needle || "").trim().toLowerCase();
  if (want === "") return 0;
  let count = 0;
  let at = src.indexOf(want);
  while (at !== -1) {
    count += 1;
    at = src.indexOf(want, at + want.length);
  }
  return count;
}
function findInText(text, needle, start, end, forward = true) {
  const src = String(text || "");
  const want = String(needle || "").trim();
  if (want === "") return null;
  const lower = src.toLowerCase();
  const target = want.toLowerCase();
  if (forward) {
    const from = Math.max(0, Math.min(lower.length, typeof end === "number" && end > start ? end : start));
    const at2 = lower.indexOf(target, from);
    if (at2 === -1) return null;
    return { start: at2, end: at2 + target.length };
  }
  const before = Math.max(0, Math.min(lower.length, typeof start === "number" ? start : 0));
  const at = lower.lastIndexOf(target, before - 1);
  if (at === -1) return null;
  return { start: at, end: at + target.length };
}
var IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;
var FILE_EXT_RE = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|tar|gz|mp3|wav|m4a|aac|ogg|flac|mp4|mov|webm|mkv|canvas|excalidraw|txt|csv|tsv|json|html?|js|css)$/i;
function NoteEmbed(props) {
  const path = String(props.path || "");
  const [note, setNote] = h2(null);
  const [failed, setFailed] = h2(false);
  const boxRef = A2(null);
  y2(() => {
    if (path === "") return void 0;
    let alive = true;
    setNote(null);
    setFailed(false);
    void api(`/read?path=${encodeURIComponent(path)}`).then((json) => {
      if (alive) setNote(json);
    }).catch(() => {
      if (alive) setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [path]);
  const t4 = typeof props.t === "function" ? props.t : getT();
  const title = typeof props.label === "string" && props.label.trim() !== "" ? props.label.trim() : note !== null && typeof note.title === "string" ? note.title : path;
  const open = () => {
    if (typeof props.onOpen === "function") props.onOpen(path);
  };
  const anchor = typeof props.anchor === "string" ? props.anchor : "";
  y2(() => {
    if (anchor === "" || note === null) return;
    if (isBlockAnchor(anchor)) {
      scrollToBlock(boxRef.current, anchor);
      return;
    }
    scrollToHeading(boxRef.current, anchor);
  }, [anchor, note]);
  let body;
  if (failed) {
    body = h4("div", { className: "dshgn_embedEmpty" }, t4("note.embedBroken"));
  } else if (note === null) {
    body = h4("div", { className: "dshgn_embedEmpty" }, t4("panel.loading"));
  } else {
    const fullBody = note.body !== void 0 && note.body !== null ? note.body : note.content;
    const excerpt = isBlockAnchor(anchor) ? blockTextOf(fullBody, anchor) : "";
    body = h4(
      "div",
      { className: "dshgn_embedBody" },
      renderMarkdown(excerpt === "" ? fullBody : excerpt, {
        assets: Array.isArray(note.assets) ? note.assets : [],
        sourcePath: "",
        // 嵌进来的正文里再点双链：交回面板自己那套（宿主编辑器不该被
        // 一个「看引用」的动作拉起来）
        onOpenWikiLink: open,
        onToggleTodo: void 0,
        // 再往下一层不再嵌笔记：两篇互相嵌入时递归没有尽头
        embedDepth: props.depth,
        resolveNote: props.resolveNote,
        onPreviewImage: props.onPreviewImage,
        t: t4
      })
    );
  }
  return h4(
    "div",
    { className: "dshgn_noteEmbed", ref: boxRef },
    h4(
      "div",
      { className: "dshgn_embedHead" },
      h4(Icon, { name: "file", size: 12 }),
      h4("button", { type: "button", className: "dshgn_embedTitle", title: t4("note.openEmbed"), onClick: open }, title)
    ),
    body
  );
}
function parseImageSize(label) {
  const text = String(label === void 0 || label === null ? "" : label).trim();
  const hit = /^(\d{1,4})(?:\s*[xX×]\s*(\d{1,4}))?$/.exec(text);
  if (hit === null) return null;
  const width = Number(hit[1]);
  const height = hit[2] === void 0 ? 0 : Number(hit[2]);
  if (!Number.isFinite(width) || width <= 0) return null;
  return { width, height: Number.isFinite(height) && height > 0 ? height : 0 };
}
function renderEmbed(target, key, options) {
  const opts = options || {};
  const clean = String(target || "").trim();
  if (clean === "") return null;
  const assets = Array.isArray(opts.assets) ? opts.assets : [];
  const base = clean.split("/").pop();
  const hit = assets.find((a3) => a3.name === clean || a3.name === base);
  const path = hit && hit.path || clean;
  const notePath = hit === void 0 && !IMAGE_EXT_RE.test(path) && !FILE_EXT_RE.test(path) && typeof opts.resolveNote === "function" ? opts.resolveNote(clean) : "";
  const depth = typeof opts.embedDepth === "number" ? opts.embedDepth : 0;
  if (notePath !== "" && depth < 1) {
    return h4(NoteEmbed, {
      key,
      path: notePath,
      label: base.replace(/\.md$/i, ""),
      depth: depth + 1,
      anchor: typeof opts.anchor === "string" ? opts.anchor : "",
      onOpen: opts.onOpenWikiLink,
      resolveNote: opts.resolveNote,
      // 嵌进来的那篇里的图也能点开看：放大这件事属于面板，不属于某一层
      onPreviewImage: opts.onPreviewImage,
      t: opts.t
    });
  }
  if (IMAGE_EXT_RE.test(path)) {
    const hosted = assetUrlOf(path);
    const src = hosted !== "" ? hosted : withToken(`${apiOrigin()}/getnote/asset?path=${encodeURIComponent(path)}`);
    const preview = typeof opts.onPreviewImage === "function";
    const openable = preview || hasOpenAsset();
    const size = parseImageSize(opts.label);
    const sized = size === null ? {} : {
      width: `${size.width}px`,
      height: size.height > 0 ? `${size.height}px` : "auto",
      maxHeight: "none"
    };
    return h4("img", {
      key,
      className: "dshgn_img" + (openable ? " dshgn_imgOpen" : "") + (size === null ? "" : " dshgn_imgSized"),
      style: sized,
      src,
      alt: base,
      loading: "lazy",
      title: preview ? getT()("note.zoomImage") : openable ? getT()("note.openImage") : void 0,
      onClick: openable ? (event) => {
        if (event && typeof event.stopPropagation === "function") event.stopPropagation();
        if (preview) {
          opts.onPreviewImage({ src, name: base });
          return;
        }
        openAssetInHost(path);
      } : void 0
    });
  }
  return h4("span", { key, className: "dshgn_embedFile" }, base);
}
function parseTable(lines, start) {
  const headerCells = splitRow(lines[start]);
  if (headerCells === null) return null;
  if (start + 1 >= lines.length) return null;
  if (!/^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[start + 1])) return null;
  const aligns = splitRow(lines[start + 1]) || [];
  const alignOf = (index2) => {
    const cell = String(aligns[index2] === void 0 ? "" : aligns[index2]).trim();
    if (!cell.includes(":")) return "";
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  };
  const rows = [];
  let index = start + 2;
  while (index < lines.length && lines[index].trim().startsWith("|")) {
    const cells = splitRow(lines[index]);
    if (cells === null) break;
    rows.push(cells);
    index += 1;
  }
  return { header: headerCells, rows, alignOf, consumed: index - start };
}
function splitRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((cell) => cell.trim());
}
function stripLeadingHeading(markdown, title) {
  const text = String(markdown || "");
  const name = String(title || "").trim();
  if (name === "") return text;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`^\\s*#\\s+${escaped}\\s*\\n+`), "");
}
var CALLOUT_TONES = {
  note: { icon: "note", tone: "" },
  info: { icon: "info", tone: "info" },
  todo: { icon: "check", tone: "info" },
  abstract: { icon: "note", tone: "info" },
  summary: { icon: "note", tone: "info" },
  tldr: { icon: "note", tone: "info" },
  tip: { icon: "brain", tone: "success" },
  hint: { icon: "brain", tone: "success" },
  important: { icon: "warn", tone: "success" },
  success: { icon: "check", tone: "success" },
  check: { icon: "check", tone: "success" },
  done: { icon: "check", tone: "success" },
  question: { icon: "info", tone: "warn" },
  help: { icon: "info", tone: "warn" },
  faq: { icon: "info", tone: "warn" },
  warning: { icon: "warn", tone: "warn" },
  caution: { icon: "warn", tone: "warn" },
  attention: { icon: "warn", tone: "warn" },
  failure: { icon: "close", tone: "error" },
  fail: { icon: "close", tone: "error" },
  missing: { icon: "close", tone: "error" },
  danger: { icon: "warn", tone: "error" },
  error: { icon: "warn", tone: "error" },
  bug: { icon: "warn", tone: "error" },
  example: { icon: "file", tone: "" },
  quote: { icon: "note", tone: "" },
  cite: { icon: "note", tone: "" }
};
function CalloutBlock(props) {
  const type = String(props.type || "").toLowerCase();
  const spec = CALLOUT_TONES[type] || { icon: "note", tone: "" };
  const t4 = getT();
  const title = String(props.title || "").trim();
  const foldable = props.fold === "-" || props.fold === "+";
  const [open, setOpen] = h2(props.fold !== "-");
  const bodyLines = Array.isArray(props.lines) ? props.lines : [];
  const hasBody = bodyLines.some((line) => String(line || "").trim() !== "");
  return h4(
    "div",
    {
      className: "dshgn_callout" + (spec.tone === "" ? "" : " dshgn_callout-" + spec.tone),
      "data-type": type
    },
    h4(
      foldable ? "button" : "div",
      {
        type: foldable ? "button" : void 0,
        className: "dshgn_calloutHead" + (foldable ? " dshgn_calloutFold" : ""),
        onClick: foldable ? () => {
          setOpen((prev) => !prev);
        } : void 0,
        title: foldable ? t4(open ? "callout.collapse" : "callout.expand") : void 0
      },
      h4(Icon, { name: spec.icon, size: 13, className: "dshgn_calloutIcon" }),
      h4("span", { className: "dshgn_calloutTitle" }, title !== "" ? title : type),
      foldable ? h4(Icon, { name: open ? "up" : "down", size: 12 }) : null
    ),
    open && hasBody ? h4("div", { className: "dshgn_calloutBody" }, renderBlocks(bodyLines.join("\n"), props.opts)) : null
  );
}
function renderMarkdown(markdown, options) {
  const opts = options || {};
  if (hasMarkdownHost()) {
    return h4(MarkdownView, {
      markdown,
      sourcePath: opts.sourcePath || "",
      onOpenLink: opts.onOpenLink,
      onToggleTodo: opts.onToggleTodo
    });
  }
  return renderBlocks(markdown, opts);
}
function countWords(text) {
  const source = String(text === null || text === void 0 ? "" : text);
  const cjk = source.match(/[\u4e00-\u9fa5]/g);
  const latin = source.match(/[A-Za-z0-9_'-]+/g);
  return (cjk === null ? 0 : cjk.length) + (latin === null ? 0 : latin.length);
}
function readingMinutes(words) {
  const n2 = Number(words);
  if (!Number.isFinite(n2) || n2 <= 0) return 0;
  return Math.max(1, Math.round(n2 / 300));
}
function continueListLine(text, caret) {
  const source = String(text === null || text === void 0 ? "" : text);
  const at = Number.isInteger(caret) ? caret : source.length;
  if (at < 0 || at > source.length) return null;
  const lineStart = source.lastIndexOf("\n", at - 1) + 1;
  const lineEndRaw = source.indexOf("\n", at);
  const lineEnd = lineEndRaw === -1 ? source.length : lineEndRaw;
  if (at !== lineEnd) return null;
  const line = source.slice(lineStart, lineEnd);
  const lead = /^\s*/.exec(line)[0];
  let body = line.slice(lead.length);
  let quotePrefix = "";
  for (; ; ) {
    const quoted = /^>\s?/.exec(body);
    if (quoted === null) break;
    quotePrefix += quoted[0];
    body = body.slice(quoted[0].length);
  }
  const task = /^([-*+])(\s+)\[( |x|X)\](\s+)(.*)$/.exec(body);
  const bullet = task === null ? /^([-*+])(\s+)(.*)$/.exec(body) : null;
  const ordered = task === null && bullet === null ? /^(\d+)([.)])(\s+)(.*)$/.exec(body) : null;
  const drop = () => {
    const nextLine = lead + quotePrefix;
    return {
      text: source.slice(0, lineStart) + nextLine + source.slice(lineEnd),
      caret: lineStart + nextLine.length
    };
  };
  const next = (marker) => {
    const nextLine = lead + quotePrefix + marker;
    return {
      text: source.slice(0, lineEnd) + "\n" + nextLine + source.slice(lineEnd),
      caret: lineEnd + 1 + nextLine.length
    };
  };
  if (task !== null) return task[5] === "" ? drop() : next(`${task[1]} [ ] `);
  if (bullet !== null) return bullet[3] === "" ? drop() : next(`${bullet[1]} `);
  if (ordered !== null) {
    return ordered[4] === "" ? drop() : next(`${String(Number(ordered[1]) + 1)}${ordered[2]} `);
  }
  if (quotePrefix !== "") return body === "" ? drop() : next("");
  return null;
}
function indentLines(text, start, end, outdent) {
  const source = String(text === null || text === void 0 ? "" : text);
  const from = Number.isInteger(start) ? Math.max(0, Math.min(start, source.length)) : 0;
  const to = Number.isInteger(end) ? Math.max(from, Math.min(end, source.length)) : from;
  const lineStart = source.lastIndexOf("\n", from - 1) + 1;
  const nextBreak = source.indexOf("\n", to);
  const lineEnd = nextBreak === -1 ? source.length : nextBreak;
  const lines = source.slice(lineStart, lineEnd).split("\n");
  let delta = 0;
  let firstDelta = 0;
  const shifted = lines.map((line, index) => {
    if (outdent) {
      const lead = /^[ \t]{1,2}/.exec(line);
      if (lead === null) return line;
      const removed = lead[0].length;
      delta -= removed;
      if (index === 0) firstDelta = -removed;
      return line.slice(removed);
    }
    if (line.trim() === "") return line;
    delta += 2;
    if (index === 0) firstDelta = 2;
    return "  " + line;
  });
  return {
    text: source.slice(0, lineStart) + shifted.join("\n") + source.slice(lineEnd),
    start: Math.max(lineStart, from + firstDelta),
    end: Math.max(lineStart, to + delta)
  };
}
function wrapInline(text, start, end, marker) {
  const source = String(text === null || text === void 0 ? "" : text);
  const mark = String(marker === null || marker === void 0 ? "" : marker);
  if (mark === "") return { text: source, start, end };
  const clamp = (value) => {
    const n2 = Number.isInteger(value) ? value : source.length;
    return Math.max(0, Math.min(source.length, n2));
  };
  let from = clamp(start);
  let to = clamp(end);
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  const size = mark.length;
  if (from >= size && source.slice(from - size, from) === mark && source.slice(to, to + size) === mark) {
    return {
      text: source.slice(0, from - size) + source.slice(from, to) + source.slice(to + size),
      start: from - size,
      end: to - size
    };
  }
  const picked = source.slice(from, to);
  if (picked.length >= size * 2 && picked.startsWith(mark) && picked.endsWith(mark)) {
    return {
      text: source.slice(0, from) + picked.slice(size, picked.length - size) + source.slice(to),
      start: from,
      end: to - size * 2
    };
  }
  return {
    text: source.slice(0, from) + mark + picked + mark + source.slice(to),
    start: from + size,
    end: to + size
  };
}
function linkPaste(text, start, end, clip) {
  const source = String(text === null || text === void 0 ? "" : text);
  const raw = String(clip === null || clip === void 0 ? "" : clip).trim();
  if (!/^https?:\/\/\S+$/i.test(raw)) return null;
  const clamp = (value) => {
    const n2 = Number.isInteger(value) ? value : source.length;
    return Math.max(0, Math.min(source.length, n2));
  };
  let from = clamp(start);
  let to = clamp(end);
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  if (from === to) return null;
  const picked = source.slice(from, to);
  if (picked.trim() === "") return null;
  if (/\[[^\]\n]*\]\([^)\n]*\)/.test(picked)) return null;
  if (/[\]\n]/.test(picked)) return null;
  const link = `[${picked}](${raw})`;
  return {
    text: source.slice(0, from) + link + source.slice(to),
    start: from + 1,
    end: from + 1 + picked.length
  };
}
function wikilinkQueryAt(text, caret) {
  const source = String(text === null || text === void 0 ? "" : text);
  const at = Number.isInteger(caret) ? caret : source.length;
  if (at < 0 || at > source.length) return null;
  const before = source.slice(0, at);
  const open = before.lastIndexOf("[[");
  if (open === -1) return null;
  const between = before.slice(open + 2);
  if (between.indexOf("]]") !== -1 || between.indexOf("\n") !== -1) return null;
  return { query: between, start: open + 2 };
}
function wikilinkMatches(names, query, limit = 8) {
  const list = Array.isArray(names) ? names : [];
  const q4 = String(query === null || query === void 0 ? "" : query).trim().toLowerCase();
  const all = [];
  for (const raw of list) {
    const path = String(raw === null || raw === void 0 ? "" : raw).replace(/^\/+/, "");
    if (path === "") continue;
    const base = path.split("/").pop().replace(/\.md$/i, "");
    if (base === "") continue;
    all.push({ path, name: base });
  }
  const counts = /* @__PURE__ */ new Map();
  for (const item of all) counts.set(item.name, (counts.get(item.name) || 0) + 1);
  const matchOf = (item, usePath) => {
    if (q4 === "") return true;
    const nameLower = item.name.toLowerCase();
    if (nameLower.indexOf(q4) !== -1) return true;
    return usePath && item.path.toLowerCase().indexOf(q4) !== -1;
  };
  const nameHits = all.filter((item) => matchOf(item, false));
  const picked = nameHits.length > 0 ? nameHits : all.filter((item) => matchOf(item, true));
  const hits = [];
  for (const item of picked) {
    const nameLower = item.name.toLowerCase();
    const insert = counts.get(item.name) > 1 ? item.path.replace(/\.md$/i, "") : item.name;
    hits.push({
      path: item.path,
      name: item.name,
      insert,
      label: insert,
      rank: q4 !== "" && nameLower.startsWith(q4) ? 0 : 1
    });
  }
  hits.sort((a3, b3) => a3.rank - b3.rank || a3.label.localeCompare(b3.label, "zh"));
  return hits.slice(0, Math.max(0, limit));
}
function tagQueryAt(text, caret) {
  const source = String(text === null || text === void 0 ? "" : text);
  const at = Number.isInteger(caret) ? caret : source.length;
  if (at < 0 || at > source.length) return null;
  const before = source.slice(0, at);
  const hash = before.lastIndexOf("#");
  if (hash === -1) return null;
  const prev = hash === 0 ? "" : before[hash - 1];
  if (prev !== "" && !/\s/.test(prev)) return null;
  const between = before.slice(hash + 1);
  if (between === "") return null;
  if (/[\s#\[\]]/.test(between)) return null;
  const open = before.lastIndexOf("[[");
  if (open !== -1 && open > hash) return null;
  return { query: between, start: hash + 1 };
}
function tagMatches(tags, query, limit = 8) {
  const list = Array.isArray(tags) ? tags : [];
  const q4 = String(query === null || query === void 0 ? "" : query).trim().toLowerCase();
  const hits = [];
  for (const raw of list) {
    const tag = String(raw === null || raw === void 0 ? "" : raw).replace(/^#+/, "").trim();
    if (tag === "") continue;
    const lower = tag.toLowerCase();
    if (q4 !== "" && lower.indexOf(q4) === -1) continue;
    hits.push({
      path: tag,
      name: tag,
      insert: tag,
      label: `#${tag}`,
      close: "",
      rank: q4 !== "" && lower.startsWith(q4) ? 0 : 1
    });
  }
  hits.sort((a3, b3) => a3.rank - b3.rank || a3.label.localeCompare(b3.label, "zh"));
  return hits.slice(0, Math.max(0, limit));
}
function renderParagraph(text, keyPrefix, options) {
  const lines = String(text === void 0 || text === null ? "" : text).split("\n");
  const nodes = [];
  lines.forEach((line, index) => {
    const hard = /(\\|\s{2,})$/.test(line);
    const content = hard ? line.replace(/(\\|\s{2,})$/, "") : line;
    const parts = renderInline(content.trim(), `${keyPrefix}l${index}`, options);
    parts.forEach((part) => nodes.push(part));
    if (index === lines.length - 1) return;
    if (hard) nodes.push(h4("br", { key: `${keyPrefix}br${index}` }));
    else nodes.push(" ");
  });
  return nodes;
}
function renderBlocks(markdown, options) {
  const opts = options || {};
  const lines = String(markdown || "").split(/\r?\n/);
  const blocks = [];
  let index = 0;
  let key = 0;
  const todoCounter = typeof opts.onToggleTodo === "function" ? { n: 0 } : null;
  const footnotes = [];
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === "") {
      index += 1;
      continue;
    }
    const fence = /^(```|~~~)\s*(\S*)\s*$/.exec(trimmed);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2] || "";
      const body = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(marker)) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      const fenceText = body.join("\n");
      blocks.push(
        looksLikeTranscript(fenceText) ? h4(TranscriptBlock, { key: `b${key++}`, text: fenceText }) : h4(
          "pre",
          { key: `b${key++}`, className: "dshgn_pre" },
          lang ? h4("span", { className: "dshgn_preLang" }, lang) : null,
          // 复制这一整段。读笔记时想把示例代码、命令、报错原文搬走，
          // 鼠标划选一屏之外的内容很难选全，还会带上旁边的行号与缩进。
          // 没接去处（卡片摘要、嵌进来的正文）时不给这个按钮。
          typeof opts.onCopyText === "function" ? h4(
            "button",
            {
              type: "button",
              className: "dshgn_preCopy",
              title: getT()("note.copyBlock"),
              onClick: (event) => {
                event.stopPropagation();
                opts.onCopyText(fenceText);
              }
            },
            getT()("action.copy")
          ) : null,
          h4("code", null, fenceText)
        )
      );
      continue;
    }
    if (trimmed === "%%") {
      index += 1;
      while (index < lines.length && lines[index].trim() !== "%%") index += 1;
      index += 1;
      continue;
    }
    const footDef = /^\[\^([^\]\n]+)\]:\s?(.*)$/.exec(trimmed);
    if (footDef) {
      const footId = footDef[1].trim();
      const footBody = [footDef[2]];
      index += 1;
      while (index < lines.length && /^\s{2,}\S/.test(lines[index])) {
        footBody.push(lines[index].trim());
        index += 1;
      }
      footnotes.push({ id: footId, text: footBody.join(" ").trim() });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      const headingId = blockIdIn(heading[2]);
      blocks.push(
        h4(
          `h${Math.min(level + 0, 6)}`,
          {
            key: `b${key++}`,
            className: `dshgn_h dshgn_h${level}`,
            "data-block-id": headingId === "" ? void 0 : headingId
          },
          renderInline(stripBlockId(heading[2]), `b${key}`, opts)
        )
      );
      index += 1;
      continue;
    }
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(h4("hr", { key: `b${key++}`, className: "dshgn_hr" }));
      index += 1;
      continue;
    }
    if (trimmed.startsWith("|")) {
      const table = parseTable(lines, index);
      if (table) {
        blocks.push(
          h4(
            "div",
            {
              key: `b${key++}`,
              // 长表格（比如一张对照表、一份词表）在正文里会拖出好几屏，读到下面
              // 早就忘了哪一列是什么；超过这个行数就单独给一块可滚区域并钉住表头。
              // 短表格不钉：它本来一屏就看得完，多一层滚动反而更别扭。
              className: table.rows.length >= 8 ? "dshgn_tableWrap dshgn_tableTall" : "dshgn_tableWrap"
            },
            h4(
              "table",
              { className: "dshgn_table" },
              h4(
                "thead",
                null,
                h4(
                  "tr",
                  null,
                  table.header.map(
                    (cell, i3) => h4(
                      "th",
                      { key: i3, style: table.alignOf(i3) === "" ? void 0 : { textAlign: table.alignOf(i3) } },
                      renderInline(cell, `th${i3}`, opts)
                    )
                  )
                )
              ),
              h4(
                "tbody",
                null,
                table.rows.map(
                  (row, rowIndex) => h4(
                    "tr",
                    { key: rowIndex },
                    row.map(
                      (cell, cellIndex) => h4(
                        "td",
                        {
                          key: cellIndex,
                          style: table.alignOf(cellIndex) === "" ? void 0 : { textAlign: table.alignOf(cellIndex) }
                        },
                        renderInline(cell, `td${rowIndex}-${cellIndex}`, opts)
                      )
                    )
                  )
                )
              )
            )
          )
        );
        index += table.consumed;
        continue;
      }
    }
    if (trimmed.startsWith(">")) {
      const body = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        body.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      const callout = /^\[!([^\]\n]+?)\]([+-]?)\s*(.*)$/.exec(body[0].trim());
      if (callout) {
        blocks.push(
          h4(CalloutBlock, {
            key: `b${key++}`,
            type: callout[1],
            fold: callout[2],
            title: callout[3],
            lines: body.slice(1),
            // 提示框里的待办**不能**吃待办序号：宿主那边 toggleTodo 逐行扫，
            // 提示框里那几行开头是 `>`，匹配不上 `^(\s*)([-*+])\s+\[`，所以
            // 在宿主里它们压根不算第几个。原样传下去的话，用户勾的是提示框里
            // 那一条，落到盘上改的却是正文里另一条。
            opts: Object.assign({}, opts, { onToggleTodo: void 0 })
          })
        );
        continue;
      }
      blocks.push(
        h4(
          "blockquote",
          { key: `b${key++}`, className: "dshgn_quote" },
          renderBlocks(body.join("\n"))
        )
      );
      continue;
    }
    const listMatch = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[2]);
      const items = [];
      while (index < lines.length) {
        const current = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[index]);
        if (!current) {
          const loneId = /^\s*\^([A-Za-z0-9-]{1,64})\s*$/.exec(lines[index]);
          if (loneId && items.length > 0) {
            items[items.length - 1].blockId = loneId[1];
            index += 1;
            continue;
          }
          if (lines[index].trim() !== "" && items.length > 0 && /^\s{2,}\S/.test(lines[index])) {
            items[items.length - 1].continuation.push(lines[index].trim());
            index += 1;
            continue;
          }
          break;
        }
        items.push({ text: current[3], ordered: /\d/.test(current[2]), continuation: [], blockId: "" });
        index += 1;
      }
      blocks.push(
        h4(
          ordered ? "ol" : "ul",
          { key: `b${key++}`, className: "dshgn_mdList" },
          items.map((item, itemIndex) => {
            const task = /^\[( |x|X)\]\s+(.*)$/.exec(item.text);
            const tailId = blockIdIn(task ? task[2] : item.text);
            const content = stripBlockId(task ? task[2] : item.text);
            const itemId = item.blockId !== "" ? item.blockId : tailId;
            let todoIndex = -1;
            if (task && todoCounter !== null) {
              todoIndex = todoCounter.n;
              todoCounter.n += 1;
            }
            const done = task !== null && task[1].toLowerCase() === "x";
            return h4(
              "li",
              {
                key: itemIndex,
                className: task ? "dshgn_li dshgn_task" : "dshgn_li",
                "data-block-id": itemId === "" ? void 0 : itemId
              },
              task ? h4("span", {
                className: "dshgn_check" + (done ? " dshgn_checkOn" : "") + (todoIndex >= 0 ? " dshgn_checkHit" : ""),
                "aria-hidden": "true",
                role: todoIndex >= 0 ? "checkbox" : void 0,
                "aria-checked": todoIndex >= 0 ? done ? "true" : "false" : void 0,
                title: todoIndex >= 0 ? getT()("todo.toggle") : void 0,
                onClick: todoIndex >= 0 ? (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  opts.onToggleTodo(todoIndex, !done);
                } : void 0
              }) : null,
              renderInline(content, `li${itemIndex}`, opts),
              item.continuation.length > 0 ? h4("div", { className: "dshgn_liCont" }, renderInline(item.continuation.join(" "), `lc${itemIndex}`, opts)) : null
            );
          })
        )
      );
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() !== "" && !/^\s*(#{1,6}\s|```|~~~|>|[-*+]\s|\d+[.)]\s|\|)/.test(lines[index]) && !/^(\*{3,}|-{3,}|_{3,})$/.test(lines[index].trim())) {
      paragraph.push(lines[index]);
      index += 1;
    }
    const paraText = paragraph.join("\n");
    const paraId = blockIdIn(paraText);
    blocks.push(
      h4(
        "p",
        { key: `b${key++}`, className: "dshgn_p", "data-block-id": paraId === "" ? void 0 : paraId },
        renderParagraph(stripBlockId(paraText), `p${key}`, opts)
      )
    );
  }
  if (footnotes.length > 0) {
    blocks.push(
      h4(
        "div",
        { key: `b${key++}`, className: "dshgn_footnotes" },
        footnotes.map(
          (foot) => h4(
            "div",
            {
              key: foot.id,
              className: "dshgn_footnote",
              "data-footnote-id": foot.id,
              role: "button",
              tabIndex: 0,
              title: getT()("note.footnoteBack"),
              // 点回正文里那个上标。脚注正文里自己也有能点的东西（双链、链接），
              // 那些点了要按它们自己的意思走，别被这一行截走。
              onClick: (event) => {
                const inner = event && event.target && typeof event.target.closest === "function" ? event.target.closest("button, a") : null;
                if (inner !== null) return;
                const box = event && event.currentTarget ? event.currentTarget.closest(".dshgn_md") : null;
                if (box) scrollToFootnoteRef(box, foot.id);
              },
              onKeyDown: (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                const box = event.currentTarget ? event.currentTarget.closest(".dshgn_md") : null;
                if (box) scrollToFootnoteRef(box, foot.id);
              }
            },
            h4("span", { className: "dshgn_footnoteNo" }, foot.id),
            h4("span", { className: "dshgn_footnoteText" }, renderInline(foot.text, `fn-${foot.id}`, opts))
          )
        )
      )
    );
  }
  return blocks;
}
var CSS = `
.dshgn_root{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;
  background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary);
  font-family:var(--font-interface,var(--dsw-font-sans,inherit));font-size:var(--font-ui-small,13px)}
.dshgn_head{flex:none;display:flex;align-items:center;gap:10px;padding:10px 14px;
  border-bottom:0.5px solid var(--dsw-alias-border-l2)}
.dshgn_headMain{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.dshgn_title{font-size:13px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary)}
.dshgn_sub{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.dshgn_tabs{display:flex;gap:2px;padding:3px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_tab{appearance:none;border:0;height:24px;padding:0 10px;border-radius:7px;background:transparent;
  color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;line-height:24px;
  display:inline-flex;align-items:center;gap:5px}
.dshgn_tab:hover{color:var(--dsw-alias-label-primary)}
.dshgn_tab[data-on="true"]{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}
/* \u9875\u7B7E\u4E0A\u7684\u6570\u5B57\u5C0F\u6807\uFF1A\u8DDF\u6587\u5B57\u540C\u4E00\u884C\u3001\u6392\u5728\u53F3\u8FB9\u3002\u7528 pill \u800C\u4E0D\u662F\u53F3\u4E0A\u89D2\u89D2\u6807\uFF0C
   \u662F\u56E0\u4E3A\u89D2\u6807\u8981\u7EDD\u5BF9\u5B9A\u4F4D\uFF0C\u4F1A\u628A\u300C\u51B2\u7A81\u300D\u4E24\u4E2A\u5B57\u7684\u53F3\u5185\u8FB9\u8DDD\u5403\u6389\u3001\u8DDF\u540E\u9762\u9875\u7B7E\u6324\u5728\u4E00\u8D77\u3002 */
.dshgn_tabLabel{display:inline-block}
.dshgn_tabBadge{display:inline-flex;align-items:center;justify-content:center;
  min-width:16px;height:16px;padding:0 5px;border-radius:8px;
  background:var(--dsw-alias-state-error-primary);color:#fff;
  font-size:10px;font-weight:600;line-height:16px;letter-spacing:0;
  font-variant-numeric:tabular-nums}
.dshgn_actions{display:flex;align-items:center;gap:4px;flex:none}
/* \u5207\u6362\u9875\u7B7E\u7684\u5165\u573A\u52A8\u753B\uFF1A\u6DE1\u5165 + \u8F7B\u5FAE\u4E0A\u6D6E\u3002180ms \u662F\u4ECE\u300C\u80FD\u611F\u89C9\u5230\u300D\u5230\u300C\u4E0D\u6321\u624B\u300D\u4E4B\u95F4\u7684
   \u7ECF\u9A8C\u503C\u2014\u2014\u518D\u6162\u5C31\u6709\u62D6\u6C93\u611F\uFF0C\u518D\u5FEB\u5C31\u770B\u4E0D\u51FA\u6765\u3002\u53EA\u505A opacity/transform\uFF0C\u8D70 GPU \u5408\u6210\uFF0C
   \u4E0D\u89E6\u53D1\u91CD\u6392\uFF0C\u9762\u677F\u91CC\u540C\u65F6\u6709\u5217\u8868\u548C\u6B63\u6587\u4E5F\u4E0D\u4F1A\u6389\u5E27\u3002 */
/* \u5207\u9875\u7B7E\u65F6\u7ED9\u5185\u5BB9\u4E00\u4E2A\u6DE1\u5165\u4E0A\u79FB\u3002\u8FD9\u91CC\u53EA\u52A0\u52A8\u753B\uFF0C\u4E0D\u8981\u91CD\u5199 display/flex-direction\uFF1A
   \u4E09\u680F\u6A2A\u6392\u7684\u5E03\u5C40\u7531\u540E\u9762\u90A3\u6761 .dshgn_body{flex:1;display:flex;min-height:0} \u51B3\u5B9A\uFF0C
   \u5728\u8FD9\u91CC\u5199 flex-direction:column \u4F1A\u628A\u5B83\u9876\u6210\u7AD6\u6392\uFF0C\u4E09\u680F\u5C31\u53E0\u6210\u4E00\u5217\u4E86\u3002 */
.dshgn_body{animation:dshgn_tabIn 180ms cubic-bezier(.22,.61,.36,1)}
/* \u4ECE\u5DE6\u5230\u53F3\u6ED1\u5165\uFF1A\u6A2A\u6392\u4E09\u680F\u7684\u9605\u8BFB\u65B9\u5411\u662F\u6A2A\u5411\u7684\uFF0C\u5DE6\u53F3\u4F4D\u79FB\u6BD4\u4E0A\u4E0B\u4F4D\u79FB\u66F4\u8D34\u5408
   \u300C\u7FFB\u5230\u4E0B\u4E00\u9875\u300D\u7684\u611F\u89C9\uFF1B\u4E0A\u4E0B\u4F4D\u79FB\u5728\u5BBD\u9762\u677F\u91CC\u4F1A\u663E\u5F97\u50CF\u6574\u5757\u5F80\u4E0B\u6389\u3002
   \u523B\u610F\u4E0D\u505A\u900F\u660E\u5EA6\u6E10\u53D8\uFF1A\u5DE6\u680F\u662F\u6DF1\u84DD\u5E95\uFF0C\u4ECE opacity:0 \u6DE1\u5165\u65F6\u900F\u51FA\u7684\u662F\u63A5\u8FD1\u767D\u7684\u9762\u677F
   \u5E95\u8272\uFF0C\u770B\u8D77\u6765\u5C31\u662F\u300C\u6DF1\u8272\u90A3\u4E00\u680F\u5148\u767D\u95EA\u4E00\u4E0B\u518D\u53D8\u6DF1\u300D\u3002\u53EA\u505A\u4F4D\u79FB\u6CA1\u6709\u8FD9\u4E2A\u95EE\u9898\uFF0C
   \u4F4D\u79FB\u672C\u8EAB\u5DF2\u7ECF\u8DB3\u591F\u8BA9\u4EBA\u611F\u5230\u300C\u6362\u4E86\u4E00\u9875\u300D\u3002 */
@keyframes dshgn_tabIn{
  from{transform:translateX(-16px)}
  to{transform:translateX(0)}
}
/* \u7528\u6237\u7CFB\u7EDF\u91CC\u5F00\u4E86\u300C\u51CF\u5C11\u52A8\u6548\u300D\u5C31\u5B8C\u5168\u522B\u52A8\uFF1A\u8FD9\u7C7B\u524D\u5EAD\u654F\u611F\u7684\u7528\u6237\u770B\u5230\u4F4D\u79FB\u4F1A\u4E0D\u9002\uFF0C
   \u800C\u4E14\u4ED6\u4EEC\u5F00\u8FD9\u4E2A\u5F00\u5173\u672C\u6765\u5C31\u662F\u4E3A\u4E86\u8BA9\u754C\u9762\u522B\u52A8\u3002 */
@media (prefers-reduced-motion:reduce){
  .dshgn_body{animation:none}
  .dshgn_root *{transition-duration:0ms !important}
}
/* \u4E3B\u9898\u8272\u8272\u677F\uFF1A8 \u4E2A\u5706\u5F62\u8272\u5757 + \u4E00\u4E2A\u300C\u81EA\u5B9A\u4E49\u300D\u6309\u94AE\u3002
   \u8272\u5757\u672C\u8EAB\u7528\u5185\u8054 background\uFF08\u6BCF\u4E2A\u989C\u8272\u4E0D\u4E00\u6837\uFF09\uFF0C\u6240\u4EE5\u8FD9\u91CC\u53EA\u7BA1\u5F62\u72B6\u4E0E\u9009\u4E2D\u73AF\u3002 */
.dshgn_themeRow{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:4px}
.dshgn_swatch{appearance:none;width:26px;height:26px;border-radius:50%;cursor:pointer;
  border:0;padding:0;box-shadow:inset 0 0 0 1px rgba(255,255,255,.22);
  transition:transform 120ms ease,box-shadow 120ms ease}
.dshgn_swatch:hover{transform:scale(1.08)}
/* \u9009\u4E2D\u73AF\u7528\u5916\u53D1\u5149\u800C\u4E0D\u662F border\uFF1Aborder \u4F1A\u628A\u8272\u5757\u6491\u5927 2px\uFF0C\u4E00\u6392\u5706\u70B9\u5C31\u5927\u5C0F\u4E0D\u4E00\u4E86 */
.dshgn_swatchOn{box-shadow:inset 0 0 0 1px rgba(255,255,255,.22),0 0 0 2px var(--dshgn-accentOnLight),
  0 0 0 4px var(--dshgn-light)}
.dshgn_colorInput{width:44px;height:28px;padding:2px;border-radius:7px;cursor:pointer;
  border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay)}
/* \u4E09\u680F\u6548\u679C\u9884\u89C8\u6761\uFF1A\u4E09\u683C\u6309\u771F\u5B9E\u5C42\u6B21\u6392\u5F00\uFF0C\u8BA9\u7528\u6237\u5728\u8BBE\u7F6E\u9875\u91CC\u5C31\u80FD\u770B\u51FA\u300C\u5DE6\u6DF1\u4E2D\u6D45\u53F3\u767D\u300D\u3002
   \u9AD8 30px \u662F\u56E0\u4E3A\u8981\u653E\u5F97\u4E0B 11px \u7684\u5B57\uFF0C\u518D\u77EE\u6587\u5B57\u4F1A\u88AB\u6324\u6210\u4E00\u6761\u7EBF\u3002 */
.dshgn_previewBar{display:flex;gap:0;margin-top:10px;border-radius:8px;overflow:hidden;
  border:0.5px solid var(--dsw-alias-border-l2)}
.dshgn_previewCell{flex:1;height:30px;display:flex;align-items:center;justify-content:center;
  font-size:11px;letter-spacing:.02em}
.dshgn_iconBtn{appearance:none;display:inline-flex;align-items:center;justify-content:center;
  width:28px;height:28px;border:0;border-radius:8px;background:transparent;
  color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshgn_iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshgn_iconBtn:disabled{opacity:.45;cursor:default}
.dshgn_iconBtn[data-on="true"]{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-brand-primary)}
/* \u5237\u65B0\u53CD\u9988\uFF1A\u987A\u65F6\u9488\u8F6C 5 \u5708 = \u300C\u6536\u5230\u4E86\u300D\uFF0C\u53D8\u7EFF/\u53D8\u7EA2 = \u300C\u6210\u6CA1\u6210\u300D\uFF0C5 \u79D2\u540E\u56DE\u5230\u4E2D\u6027\u7070\u3002
   \u6B63\u89D2\u5EA6 = \u987A\u65F6\u9488\u3002
   \u7F13\u52A8\u6545\u610F\u7528 ease-out \u800C\u4E0D\u662F linear\uFF1A\u5148\u5FEB\u540E\u6162\u624D\u50CF\u300C\u8F6C\u8D77\u6765\u518D\u505C\u4E0B\u300D\uFF0C
   \u5300\u901F\u8F6C\u4F1A\u8BA9\u4EBA\u4EE5\u4E3A\u5B83\u4F1A\u4E00\u76F4\u8F6C\u4E0B\u53BB\u3002 */
.dshgn_refreshSpin{display:inline-flex;align-items:center;justify-content:center}
.dshgn_refreshSpinOn{animation:dshgn_spin 1400ms cubic-bezier(.16,.84,.24,1) 1 both}
@keyframes dshgn_spin{
  from{transform:rotate(0deg)}
  to{transform:rotate(1800deg)}
}
/* \u6210\u529F/\u5931\u8D25\u7528\u989C\u8272\u8BF4\u8BDD\uFF0C\u4E0D\u5F39 toast\uFF1A\u7528\u6237\u89C6\u7EBF\u5C31\u5728\u90A3\u4E2A\u5C0F\u56FE\u6807\u4E0A\uFF0C\u5192\u51FA\u6765\u7684\u63D0\u793A
   \u53CD\u800C\u4F1A\u8BA9\u4ED6\u53BB\u627E\u300C\u521A\u624D\u53D1\u751F\u4E86\u4EC0\u4E48\u300D\u3002
   \u5E73\u65F6\u662F\u4E2D\u6027\u7070\uFF08\u548C\u300C+\u300D\u540C\u4E00\u4E2A\u989C\u8272\uFF09\uFF0C\u53EA\u6709\u7ED3\u679C\u63ED\u6653\u7684\u90A3 5 \u79D2\u624D\u7740\u8272\u3002 */
.dshgn_iconBtnOk{color:var(--dsw-alias-state-success-primary)}
.dshgn_iconBtnFail{color:var(--dsw-alias-state-error-primary)}
/* \u300C+\u300D\u548C\u300C\u5237\u65B0\u300D\u5FC5\u987B\u540C\u8272\uFF1A\u4E24\u4E2A\u5E76\u6392\u7684\u56FE\u6807\u6309\u94AE\u4E00\u65E6\u4E00\u4E2A\u7070\u4E00\u4E2A\u84DD\uFF0C
   \u7528\u6237\u4F1A\u4EE5\u4E3A\u84DD\u8272\u7684\u90A3\u4E2A\u662F\u4E3B\u64CD\u4F5C\u3001\u7070\u8272\u90A3\u4E2A\u4E0D\u53EF\u7528\u3002 */
.dshgn_head .dshgn_iconBtn{color:var(--dsw-alias-label-tertiary)}
.dshgn_head .dshgn_iconBtn:hover{color:var(--dsw-alias-label-primary)}
.dshgn_head .dshgn_iconBtn.dshgn_iconBtnOk{color:var(--dsw-alias-state-success-primary)}
.dshgn_head .dshgn_iconBtn.dshgn_iconBtnFail{color:var(--dsw-alias-state-error-primary)}
/* \u5927\u7EB2\uFF1A\u8D34\u7740\u9605\u8BFB\u533A\u9876\u90E8\u7684\u4E00\u6761\u53EF\u6298\u53E0\u76EE\u5F55\u3002\u5C42\u7EA7\u9760\u5DE6\u5185\u8FB9\u8DDD\u533A\u5206\uFF0C\u4E0D\u505A\u7AD6\u7EBF\u6811\u72B6\uFF0C
   \u56E0\u4E3A\u9605\u8BFB\u533A\u672C\u6765\u5C31\u7A84\uFF0C\u753B\u6811\u7EBF\u4F1A\u628A\u6807\u9898\u6587\u5B57\u6324\u5230\u5F88\u77ED\u3002 */
.dshgn_outline{margin:0 0 10px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;
  background:var(--dsw-alias-interactive-bg-hover);overflow:hidden}
.dshgn_outlineToggle{appearance:none;display:flex;align-items:center;gap:6px;width:100%;
  padding:7px 10px;border:0;background:transparent;font:inherit;font-size:11px;
  color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left}
.dshgn_outlineToggle:hover{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-primary)}
.dshgn_outlineCount{margin-left:auto;min-width:16px;text-align:center;padding:0 4px;border-radius:7px;
  background:rgba(var(--dshgn-tintRgb),.1);font-size:10px;line-height:15px;
  color:var(--dsw-alias-label-tertiary)}
.dshgn_outlineList{padding:0 0 5px;max-height:220px;overflow-y:auto}
/* \u4E00\u884C = \u6807\u9898 + \u4E00\u9897\u300C\u6284\u94FE\u63A5\u300D\u7684\u5C0F\u6309\u94AE\u3002\u6309\u94AE\u5E73\u65F6\u4E0D\u663E\u5F62\uFF0C\u9F20\u6807\u505C\u5728\u90A3\u4E00\u884C
   \u6216\u8005\u7528\u952E\u76D8\u805A\u7126\u5230\u5B83\u624D\u51FA\u73B0\u2014\u2014\u5927\u7EB2\u672C\u6765\u5C31\u662F\u4E00\u5217\u7EAF\u6587\u5B57\uFF0C\u591A\u5341\u51E0\u9897\u56FE\u6807\u4F1A\u628A
   \u300C\u8BFB\u6807\u9898\u300D\u8FD9\u4EF6\u4E8B\u6405\u4E71\u3002 */
.dshgn_outlineRow{display:flex;align-items:center;gap:2px}
.dshgn_outlineItem{appearance:none;display:block;flex:1;min-width:0;padding:3px 10px;border:0;
  background:transparent;font:inherit;font-size:12px;line-height:1.5;
  color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshgn_outlineCopy{appearance:none;flex:none;display:inline-flex;align-items:center;
  justify-content:center;width:20px;height:20px;margin-right:4px;padding:0;border:0;
  border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);
  cursor:pointer;opacity:0;transition:opacity .12s}
.dshgn_outlineRow:hover .dshgn_outlineCopy,
.dshgn_outlineCopy:focus-visible{opacity:1}
.dshgn_outlineCopy:hover{background:var(--dsw-alias-interactive-bg-hover-accent);
  color:var(--dsw-alias-brand-primary)}
.dshgn_outlineCopy:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dshgn_outlineItem:hover{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-brand-primary)}
/* \u6B63\u5728\u8BFB\u7684\u90A3\u4E00\u8282\uFF1A\u5DE6\u4FA7\u4E00\u9053\u7AD6\u7EBF + \u4E3B\u8272\u6587\u5B57\u3002\u53EA\u52A0\u7C97\u4E0A\u8272\u4E0D\u52A8\u80CC\u666F\uFF0C
   \u5426\u5219\u548C\u300C\u60AC\u505C\u300D\u62A2\u89C6\u89C9\uFF0C\u7528\u6237\u5206\u4E0D\u6E05\u300C\u6211\u70B9\u8FC7\u300D\u548C\u300C\u9F20\u6807\u6B63\u505C\u5728\u8FD9\u300D\u3002 */
.dshgn_outlineItem[data-on='true']{color:var(--dsw-alias-brand-primary);font-weight:600;
  box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
/* \u5C5E\u6027\u533A\uFF1A\u7B14\u8BB0\u5934\u90E8\u90A3\u4E9B\u952E\u503C\uFF08tags / aliases / \u81EA\u5B9A\u4E49\u5B57\u6BB5\uFF09\u3002
   \u653E\u5728\u6B63\u6587\u4E0A\u65B9\u3001\u6BD4\u5927\u7EB2\u66F4\u6DE1\u2014\u2014\u5B83\u662F\u300C\u8FD9\u7BC7\u662F\u4EC0\u4E48\u300D\uFF0C\u4E0D\u662F\u300C\u8FD9\u7BC7\u5199\u4E86\u4EC0\u4E48\u300D\uFF0C
   \u8BFB\u6B63\u6587\u65F6\u5B83\u5E94\u8BE5\u9000\u5230\u80CC\u666F\u91CC\uFF0C\u4F46\u8981\u4E00\u773C\u80FD\u626B\u5230\u3002 */
.dshgn_props{margin:0 0 12px;border:0.5px solid var(--dsw-alias-border-l1);
  border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden;font-size:11.5px}
.dshgn_propsBody{padding:0 10px 7px}
.dshgn_propRow{display:flex;align-items:flex-start;gap:8px;padding:2px 0;line-height:1.6}
.dshgn_propKey{flex:0 0 auto;min-width:52px;max-width:110px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_propVal{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);
  word-break:break-word;white-space:pre-wrap}
.dshgn_propTag{appearance:none;border:0;border-radius:9px;padding:1px 7px;margin:0 4px 4px 0;
  background:rgba(var(--dshgn-tintRgb),.1);font:inherit;font-size:11px;
  color:var(--dsw-alias-brand-primary);cursor:pointer}
.dshgn_propTag:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}
/* \u5173\u8054\u7B14\u8BB0\uFF1A\u6B63\u6587\u8BFB\u5B8C\u624D\u51FA\u73B0\uFF0C\u6240\u4EE5\u6837\u5F0F\u6BD4\u5927\u7EB2\u66F4\u8F7B\u2014\u2014\u5B83\u662F\u4E00\u6761\u8865\u5145\u4FE1\u606F\uFF0C\u4E0D\u8BE5\u62A2\u6B63\u6587\u89C6\u7EBF\u3002 */
/* \u65AD\u94FE\u6E05\u5355\uFF1A\u4E00\u884C\u4E00\u5904\u3002\u76EE\u6807\u540D\u5B57\u7528\u9519\u8BEF\u8272\uFF0C\u56E0\u4E3A\u8FD9\u4E00\u884C\u672C\u8EAB\u5C31\u662F\u300C\u8FD9\u91CC\u6709\u95EE\u9898\u300D\uFF1B
   \u5E95\u4E0B\u7684\u4F4D\u7F6E\u4E0E\u4E0A\u4E0B\u6587\u7528\u6DE1\u8272\uFF0C\u626B\u4E00\u773C\u5C31\u80FD\u8DF3\u8FC7\u6B63\u5E38\u7684\u90A3\u4E9B\u3002 */
.dshgn_brokenRow{appearance:none;display:flex;flex-direction:column;gap:3px;width:100%;
  text-align:left;padding:8px 10px;border:0.5px solid var(--dsw-alias-border-l1);
  border-radius:8px;background:transparent;font:inherit;cursor:pointer}
.dshgn_brokenRow:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.dshgn_brokenTarget{font-size:12px;font-weight:600;color:var(--dsw-alias-state-error-primary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_brokenWhere{font-size:10.5px;color:var(--dsw-alias-label-dimmed);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_brokenSnip{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* \u4E00\u884C\u65AD\u94FE = \u4E3B\u4F53\uFF08\u70B9\u4E86\u6253\u5F00\u90A3\u4E00\u7BC7\uFF09+ \u4E00\u9897\u300C\u53BB\u8FD9\u4E00\u53E5\u300D\u3002\u62C6\u6210\u4E24\u4E2A\u53EF\u70B9\u533A\u57DF\u662F\u56E0\u4E3A
   \u300C\u6253\u5F00\u8FD9\u7BC7\u300D\u548C\u300C\u6EDA\u5230\u90A3\u4E00\u884C\u300D\u662F\u4E24\u4E2A\u52A8\u4F5C\uFF0C\u800C\u6309\u94AE\u91CC\u518D\u5957\u6309\u94AE\u4E0D\u662F\u5408\u6CD5\u7ED3\u6784\u3002 */
.dshgn_brokenLine{display:flex;align-items:stretch;gap:6px;width:100%}
.dshgn_brokenLine .dshgn_brokenRow{flex:1 1 auto;min-width:0}
.dshgn_brokenJump{flex:none;align-self:center;appearance:none;padding:2px 8px;
  border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;
  color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;line-height:1.7;
  white-space:nowrap;cursor:pointer}
.dshgn_brokenJump:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dshgn_brokenJump:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:1px}
/* \u5F85\u529E\u6E05\u5355\uFF1A\u4E00\u884C\u4E00\u6761\u3002\u65B9\u6846\u590D\u7528\u9605\u8BFB\u533A\u90A3\u4E2A\uFF08\u540C\u6837\u5927\u5C0F\u3001\u540C\u6837\u80FD\u70B9\uFF09\uFF0C\u53F3\u8FB9\u662F\u6B63\u6587\u4E0E\u51FA\u5904\u3002
   \u65B9\u6846\u5916\u9762\u5957\u4E00\u5C42\u900F\u660E\u6309\u94AE\uFF0C\u662F\u4E3A\u4E86\u8BA9\u6574\u5757\u65B9\u6846\u8FDE\u5468\u8FB9\u7684\u70B9\u51FB\u70ED\u533A\u4E00\u8D77\u53EF\u70B9\u2014\u201412px \u7684\u65B9\u6846
   \u76F4\u63A5\u70B9\u5F88\u96BE\u70B9\u4E2D\uFF0C\u624B\u673A\u4E0A\u5C24\u5176\u3002 */
.dshgn_todoRow{display:flex;align-items:flex-start;gap:8px;padding:7px 10px;
  border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent}
.dshgn_todoRow:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.dshgn_todoRow .dshgn_check{margin-top:3px}
/* \u5F85\u529E\u90A3\u884C\u91CC\u7684\u6587\u5B57\u4E0E\u300C\u53BB\u8FD9\u4E00\u6761\u300D\u5E76\u6392\uFF1A\u6587\u5B57\u81EA\u5DF1\u662F\u4E2A\u6309\u94AE\uFF0C\u4E0D\u80FD\u628A\u6309\u94AE\u5957\u8FDB\u6309\u94AE\u3002 */
.dshgn_todoLine{display:flex;align-items:center;gap:6px;flex:1;min-width:0}
.dshgn_todoBusy{opacity:.45}
.dshgn_todoText{appearance:none;display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;
  text-align:left;padding:0;border:0;background:transparent;font:inherit;cursor:pointer;color:inherit}
.dshgn_todoTitle{font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-primary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_backlinks{margin-top:18px;padding-top:12px;border-top:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_backlinksHead{display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:11px;
  color:var(--dsw-alias-label-tertiary)}
.dshgn_backlinkItem{appearance:none;display:flex;flex-direction:column;gap:2px;width:100%;
  padding:6px 9px;margin-bottom:3px;border:0;border-radius:7px;
  background:var(--dsw-alias-interactive-bg-hover);font:inherit;cursor:pointer;text-align:left}
.dshgn_backlinkItem:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}
.dshgn_backlinkTitle{font-size:12px;color:var(--dsw-alias-brand-primary);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshgn_backlinkSnip{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* \u4E0A\u4E0B\u6587\u90A3\u4E00\u884C\u70B9\u5F97\u52A8\uFF1A\u865A\u7EBF\u4E0B\u5212\u7EBF\u662F\u300C\u8FD9\u91CC\u80FD\u70B9\u300D\u91CC\u6700\u4E0D\u5435\u7684\u4E00\u79CD\uFF0C\u4E0D\u52A8\u5B57\u53F7\u4E0D\u52A8\u8272 */
.dshgn_backlinkSnipLink{cursor:pointer;text-decoration:underline;text-decoration-style:dotted;
  text-underline-offset:2px}
.dshgn_backlinkSnipLink:hover{color:var(--dsw-alias-brand-primary)}
.dshgn_backlinkSnipLink:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);
  outline-offset:1px;border-radius:3px}
.dshgn_backlinkPath{font-size:10px;color:var(--dsw-alias-label-dimmed);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* \u51FA\u94FE\uFF1A\u8FD9\u7BC7\u81EA\u5DF1\u5F15\u7528\u4E86\u8C01\u3002\u4E00\u6761\u6761\u7AD6\u6392\u592A\u5360\u5730\u65B9\uFF08\u51FA\u94FE\u5E38\u5E38\u5341\u51E0\u6761\uFF09\uFF0C\u6392\u6210\u4E00\u884C\u80F6\u56CA\u3002 */
.dshgn_outlinks{margin-top:14px;padding-top:10px;border-top:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_outlinksHead{display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:11px;
  color:var(--dsw-alias-label-tertiary)}
.dshgn_outlinkRow{display:flex;flex-wrap:wrap;gap:4px}
.dshgn_outlinkChip{appearance:none;border:0;border-radius:6px;padding:3px 8px;font:inherit;font-size:11px;
  max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;
  background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}
.dshgn_outlinkChip:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}
/* \u51FA\u94FE\u91CC\u6307\u5411\u8FD8\u4E0D\u5B58\u5728\u7684\u7B14\u8BB0\uFF1A\u548C\u6B63\u6587\u91CC\u7684\u6B7B\u94FE\u540C\u4E00\u5957\u89C2\u611F\uFF08\u7070\u4E0B\u53BB\u3001\u8FB9\u6846\u865A\u7EBF\uFF09\uFF0C
   \u800C\u4E0D\u662F\u6574\u6761\u85CF\u8D77\u6765\u2014\u2014\u300C\u6211\u60F3\u5199\u4F46\u8FD8\u6CA1\u5199\u300D\u672C\u8EAB\u5C31\u662F\u8981\u770B\u89C1\u7684\u4FE1\u606F\u3002 */
.dshgn_outlinkDead{background:transparent;color:var(--dsw-alias-label-tertiary);
  box-shadow:inset 0 0 0 0.5px var(--dsw-alias-border-l2)}
.dshgn_outlinkDead:hover{background:var(--dsw-alias-interactive-bg-hover);
  color:var(--dsw-alias-label-secondary)}
/* \u641C\u7D22\u589E\u5F3A\uFF1A\u547D\u4E2D\u6B21\u6570\u7528\u4E00\u4E2A\u5C0F\u80F6\u56CA\u6807\u5728\u6807\u9898\u53F3\u8FB9\uFF0C\u547D\u4E2D\u884C\u5E26\u884C\u53F7\u2014\u2014
   \u7528\u6237\u5224\u65AD\u300C\u8FD9\u7BC7\u662F\u4E0D\u662F\u6211\u8981\u7684\u300D\u9760\u7684\u5C31\u662F\u8FD9\u4E24\u6837\u4E1C\u897F\u3002 */
.dshgn_pickBox{flex:none;width:14px;height:14px;border-radius:4px;display:flex;
  align-items:center;justify-content:center;cursor:pointer;opacity:0;
  border:1px solid var(--dsw-alias-border-l2);background:transparent;
  transition:opacity 120ms ease,background 120ms ease}
.dshgn_card:hover .dshgn_pickBox,.dshgn_pickBoxOn{opacity:1}
.dshgn_pickBoxOn{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-label-primary-foreground)}
.dshgn_batchBar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 8px;
  border-bottom:0.5px solid rgba(var(--dshgn-tintRgb),.14);background:rgba(var(--dshgn-tintRgb),.07)}
.dshgn_batchCount{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dshgn_batchBtn{appearance:none;border:0;background:transparent;cursor:pointer;
  font:inherit;font-size:11px;padding:2px 6px;border-radius:5px;
  color:var(--dsw-alias-label-secondary)}
.dshgn_batchBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_batchMenu{flex-basis:100%;display:flex;flex-direction:column;gap:6px;
  padding:8px;margin-top:2px;border-radius:8px;background:var(--dshgn-surface);
  box-shadow:0 2px 10px rgba(var(--dshgn-tintRgb),.14)}
.dshgn_batchRow{display:flex;gap:6px;align-items:center}
.dshgn_batchInput{flex:1;min-width:0;height:26px;font-size:12px}
.dshgn_cardTitleRow{display:flex;align-items:center;gap:6px}
.dshgn_cardTitleRow .dshgn_cardTitle{flex:1;min-width:0}
/* \u4E2D\u680F\u7B14\u8BB0\u5361\uFF1A\u52FE\u9009\u6846\u4ECE\u884C\u5185\u632A\u5230\u5DE6\u4FA7\u7559\u767D\u91CC\u3002
   \u539F\u6765\u5B83\u5360\u7740\u6807\u9898\u884C\u9996\u7684\u4F4D\u7F6E\uFF0C\u628A\u6807\u9898\u6587\u5B57\u5F80\u53F3\u63A8\u4E86 20px\uFF0C\u800C\u4E0B\u9762\u7684\u65E5\u671F\u4E0E\u6B63\u6587
   \u76F4\u63A5\u4ECE\u5361\u7247\u5185\u8FB9\u8DDD\u8D77\u2014\u2014\u4E09\u884C\u5DE6\u8FB9\u7F18\u5BF9\u4E0D\u9F50\uFF0C\u770B\u7740\u50CF\u7F29\u8FDB\u9519\u4E71\u3002\u73B0\u5728\u6574\u5F20\u5361\u7EDF\u4E00
   \u591A\u7559 20px \u5DE6\u5185\u8FB9\u8DDD\uFF0C\u52FE\u9009\u6846\u7EDD\u5BF9\u5B9A\u4F4D\u505C\u5728\u7559\u767D\u91CC\uFF0C\u6807\u9898/\u65E5\u671F/\u6B63\u6587\u5DE6\u7AEF\u4E00\u81F4\u3002 */
.dshgn_card[data-pick="true"]{position:relative;padding-left:28px}
.dshgn_card[data-pick="true"] .dshgn_pickBox{position:absolute;left:8px;top:9px}
.dshgn_hitCount{flex:none;min-width:17px;text-align:center;padding:0 4px;border-radius:7px;
  background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);
  font-size:10px;line-height:15px;font-weight:600}
.dshgn_cardMatches{margin-top:3px;display:flex;flex-direction:column;gap:2px}
.dshgn_matchLine{display:flex;gap:5px;align-items:baseline;width:100%;appearance:none;border:0;background:transparent;padding:1px 3px;margin:0 -3px;border-radius:4px;font:inherit;font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer}
.dshgn_matchLine:hover{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-primary)}
.dshgn_matchNo{flex:none;min-width:18px;text-align:right;font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-dimmed);font-size:10px;padding-top:1px}
.dshgn_matchText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_matchHit{padding:0 1px;border-radius:3px;background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-primary);font-weight:600}
.dshgn_cardLinks{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.dshgn_cardLinkChip{appearance:none;border:0;background:rgba(var(--dshgn-tintRgb),.08);
  color:var(--dsw-alias-brand-primary);border-radius:6px;padding:1px 6px;font-size:10px;
  cursor:pointer;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_cardLinkChip:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}
.dshgn_cardLinkMore{font-size:10px;color:var(--dsw-alias-label-dimmed);align-self:center}
.dshgn_searchHint{padding:0 10px 7px;font-size:10px;line-height:1.5;
  color:var(--dsw-alias-label-dimmed)}
/* \u641C\u7D22\u8865\u5168\u5019\u9009\uFF1A\u628A\u5E93\u91CC\u5DF2\u6709\u7684\u76EE\u5F55\u540D\u4E0E\u6807\u7B7E\u540D\u6446\u51FA\u6765\uFF0C\u7701\u5F97\u51ED\u8BB0\u5FC6\u731C\u62FC\u5199\u3002
   \u6446\u5728\u641C\u7D22\u884C\u6B63\u4E0B\u65B9\u3001\u4E0E\u641C\u7D22\u6846\u540C\u5BBD\uFF0C\u548C\u5217\u8868\u5361\u7247\u533A\u5206\u5F00\uFF08\u4E0D\u5360\u5361\u7247\u7684\u4F4D\u7F6E\u611F\uFF09\u3002 */
.dshgn_suggest{flex:none;display:flex;flex-wrap:wrap;gap:4px;padding:0 10px 7px}
.dshgn_suggestItem{appearance:none;display:inline-flex;align-items:center;gap:3px;
  max-width:100%;padding:1px 7px;border:0.5px solid var(--dsw-alias-border-l2);
  border-radius:999px;background:rgba(var(--dshgn-tintRgb),.06);
  color:var(--dsw-alias-label-secondary);font:inherit;font-size:10px;line-height:1.7;
  cursor:pointer}
.dshgn_suggestItem:hover{background:var(--dsw-alias-interactive-bg-hover);
  color:var(--dsw-alias-brand-primary)}
.dshgn_suggestItem[data-on="true"]{border-color:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-brand-primary)}
.dshgn_suggestItem:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);
  outline-offset:1px}
.dshgn_suggestName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_searching{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary)}
/* \u7B5B\u9009\u6761\uFF1A\u5DE6\u680F\u70B9\u4E86\u76EE\u5F55/\u6807\u7B7E\u4E4B\u540E\uFF0C\u4E2D\u680F\u5F97\u8BF4\u6E05\u300C\u73B0\u5728\u7B5B\u7684\u662F\u4EC0\u4E48\u3001\u600E\u4E48\u9000\u51FA\u53BB\u300D\u3002
   \u4EE5\u524D\u53EA\u662F\u5361\u7247\u6084\u6084\u5C11\u4E86\uFF0C\u6362\u8FC7\u76EE\u5F55\u518D\u56DE\u6765\u7684\u4EBA\u4F1A\u4EE5\u4E3A\u7B14\u8BB0\u4E22\u4E86\u3002 */
.dshgn_filterBar{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:4px;
  padding:0 10px 7px}
.dshgn_filterChip{appearance:none;display:inline-flex;align-items:center;gap:3px;
  max-width:100%;padding:1px 4px 1px 6px;border:0.5px solid var(--dsw-alias-border-l2);
  border-radius:999px;background:rgba(var(--dshgn-tintRgb),.08);
  color:var(--dsw-alias-label-secondary);font:inherit;font-size:10px;line-height:1.6;
  cursor:pointer}
.dshgn_filterChip:hover{background:var(--dsw-alias-interactive-bg-hover);
  color:var(--dsw-alias-label-primary)}
.dshgn_filterChip:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dshgn_filterChip[data-kind="tag"]{color:var(--dsw-alias-brand-primary)}
.dshgn_filterChipName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_filterChipX{flex:none;display:inline-flex;align-items:center}

/* \u5B57\u53F7\u4E09\u6863\uFF1A\u53EA\u6539 .dshgn_md \u7684\u5B57\u53F7\u4E0E\u884C\u8DDD\uFF0C\u6807\u9898\u548C\u4EE3\u7801\u5757\u7528 em \u76F8\u5BF9\u653E\u5927\uFF0C
   \u6574\u7BC7\u6BD4\u4F8B\u4FDD\u6301\u4E00\u81F4\u2014\u2014\u5982\u679C\u6807\u9898\u5199\u6B7B px\uFF0C\u653E\u5927\u6B63\u6587\u5B57\u53F7\u540E\u6807\u9898\u4F1A\u663E\u5F97\u6BD4\u6B63\u6587\u8FD8\u5C0F\u3002 */
.dshgn_scaleGroup{display:inline-flex;align-items:center;gap:1px;margin-left:auto;
  padding:1px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_scaleBtn{appearance:none;display:inline-flex;align-items:flex-end;justify-content:center;
  width:20px;height:20px;border:0;border-radius:5px;background:transparent;
  color:var(--dsw-alias-label-tertiary);cursor:pointer;font-family:inherit;padding-bottom:2px}
.dshgn_scaleBtn:hover{color:var(--dsw-alias-label-primary)}
.dshgn_scaleBtnOn{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-brand-primary);
  box-shadow:0 1px 2px rgba(var(--dshgn-tintRgb),.14)}
/* \u65B0\u5EFA\u6A21\u677F\u83DC\u5355\uFF1A\u70B9\u300C+\u300D\u5F39\u4E00\u5C42\u5C0F\u83DC\u5355\u3002\u906E\u7F69\u7528\u900F\u660E div \u800C\u4E0D\u662F\u76D1\u542C document \u70B9\u51FB\uFF0C
   \u56E0\u4E3A\u9762\u677F\u662F slot \u91CC\u7684\u5B50\u6811\uFF0Cdocument \u7EA7\u76D1\u542C\u5728 React \u5378\u8F7D\u65F6\u5BB9\u6613\u6F0F\u6458\u3002 */
.dshgn_newWrap{position:relative;display:inline-flex}
.dshgn_menuMask{position:fixed;inset:0;z-index:40;background:transparent}
.dshgn_menu{position:absolute;top:32px;left:0;z-index:41;min-width:190px;padding:5px;
  border-radius:9px;background:var(--dsw-alias-bg-overlay);
  border:0.5px solid var(--dsw-alias-border-l2);box-shadow:0 6px 20px rgba(var(--dshgn-tintRgb),.18)}
.dshgn_menuTitle{padding:4px 8px 6px;font-size:10px;letter-spacing:.04em;
  color:var(--dsw-alias-label-dimmed)}
.dshgn_menuItem{appearance:none;display:flex;align-items:center;gap:8px;width:100%;
  padding:6px 8px;border:0;border-radius:6px;background:transparent;font:inherit;
  font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}
.dshgn_menuItem:hover{background:var(--dsw-alias-interactive-bg-hover-accent);
  color:var(--dsw-alias-brand-primary)}
.dshgn_menuHint{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-dimmed)}
/* \u83DC\u5355\u91CC\u7684\u8F93\u5165\u884C\u4E0E\u5019\u9009\u6761\uFF1A\u83DC\u5355\u81EA\u5E26 5px \u5185\u8FB9\u8DDD\uFF0C\u8FD9\u91CC\u4E0D\u518D\u5404\u52A0\u4E00\u5708\uFF0C\u53EA\u628A
   \u5DE6\u53F3\u5BF9\u9F50\u5230\u6807\u9898\u6587\u5B57\u7684 8px \u8D77\u3002 */
.dshgn_menuRow{display:flex;padding:0 3px 5px}
.dshgn_menu .dshgn_suggest{padding:0 3px 5px}
.dshgn_menu .dshgn_input{height:26px;font-size:12px}
/* \u9AA8\u67B6\u5C4F\uFF1A\u7528\u4E00\u6761\u8109\u52A8\u7684\u6D45\u8272\u5757\u5360\u4F4D\u3002\u52A8\u753B\u53EA\u6539 opacity\uFF0C\u4E0D\u6539\u5C3A\u5BF8\u2014\u2014
   \u6539\u5C3A\u5BF8\u4F1A\u89E6\u53D1\u91CD\u6392\uFF0C\u4E09\u680F\u9AA8\u67B6\u4E00\u8D77\u6296\u770B\u7740\u50CF\u5361\u4F4F\u3002 */
.dshgn_skTree,.dshgn_skList,.dshgn_skNote{padding:14px 12px;gap:9px}
.dshgn_skTree{display:flex;flex-direction:column}
.dshgn_skList{display:flex;flex-direction:column;gap:10px}
.dshgn_skNote{display:flex;flex-direction:column;gap:11px}
.dshgn_skCard{display:flex;flex-direction:column;gap:7px;padding:10px 11px;border-radius:8px;
  background:rgba(var(--dshgn-tintRgb),.10)}
.dshgn_skRow{border-radius:5px;background:var(--dsw-alias-interactive-bg-hover);
  animation:dshgn_skPulse 1.4s ease-in-out infinite}
.dshgn_skTree .dshgn_skRow{background:rgba(var(--dshgn-tintRgb),.07)}
@keyframes dshgn_skPulse{
  0%,100%{opacity:.55}
  50%{opacity:1}
}
@media (prefers-reduced-motion:reduce){
  .dshgn_skRow{animation:none;opacity:.7}
}
/* \u51B2\u7A81\u6BD4\u5BF9\uFF1A\u5DE6\u53F3\u4E24\u5217\u5404\u81EA\u6EDA\u52A8\u3002\u9ED8\u8BA4\u8D70 Markdown \u6E32\u67D3\uFF08.dshgn_diffMd\uFF09\uFF0C
   \u548C\u300C\u7B14\u8BB0\u300D\u300C\u4E91\u7AEF\u300D\u9875\u8BFB\u8D77\u6765\u4E00\u81F4\uFF1B\u5207\u5230\u300C\u539F\u6587\u300D\u65F6\u624D\u7528 .dshgn_diffBody \u7684\u7B49\u5BBD pre\uFF0C
   \u90A3\u79CD\u6A21\u5F0F\u662F\u4E3A\u62A0\u7A7A\u683C/\u6362\u884C\u5DEE\u5F02\u51C6\u5907\u7684\u3002 */
.dshgn_diffRow{display:flex;gap:10px;flex:1;min-height:0;overflow:hidden}
.dshgn_diffCol{flex:1;min-width:0;display:flex;flex-direction:column;
  border:0.5px solid var(--dsw-alias-border-l2);border-radius:9px;overflow:hidden;
  background:var(--dsw-alias-bg-overlay)}
.dshgn_diffHead{flex:none;padding:6px 10px;font-size:11px;font-weight:600;
  background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);
  border-bottom:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_diffBody{flex:1;min-height:0;margin:0;padding:10px 12px;overflow:auto;
  font-family:var(--font-monospace,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:11.5px;
  line-height:1.65;white-space:pre-wrap;word-break:break-word;
  color:var(--dsw-alias-label-primary)}
/* \u6E32\u67D3\u6A21\u5F0F\uFF1A\u6CBF\u7528 .dshgn_md \u7684\u6392\u7248\u89C4\u5219\uFF08\u6807\u9898\u5C42\u7EA7/\u8868\u683C/\u5F15\u7528/\u56F4\u680F\uFF09\uFF0C
   \u4F46\u53BB\u6389 max-width \u5C45\u4E2D\u2014\u2014\u4E24\u5217\u5404\u5360\u4E00\u534A\u5BBD\u5EA6\uFF0C\u5C45\u4E2D\u4F1A\u8BA9\u6B63\u6587\u7F29\u5728\u4E2D\u95F4\u4E00\u7A84\u6761\u3002 */
.dshgn_diffMd{font-family:inherit;font-size:12.5px;line-height:1.7;white-space:normal}
.dshgn_diffMd .dshgn_md{max-width:none;margin:0;font-size:inherit}
.dshgn_diffMd .dshgn_h{margin:12px 0 6px}
.dshgn_diffMd .dshgn_h1{font-size:1.3em}
.dshgn_diffMd .dshgn_h2{font-size:1.15em}
.dshgn_diffMd .dshgn_h3{font-size:1.02em}
.dshgn_diffEmpty{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;
  padding:20px;font-size:12px;line-height:1.7;text-align:center;
  color:var(--dsw-alias-label-tertiary)}
.dshgn_dot{color:var(--dsw-alias-label-dimmed)}
/* \u7248\u672C\u5386\u53F2\uFF1A\u5360\u6EE1\u9605\u8BFB\u533A\uFF0C\u7528\u5217\u8868 + \u9884\u89C8\u4E24\u6BB5\u5F0F\u3002\u65F6\u95F4\u7528\u7B49\u5BBD\u6570\u5B57\u5BF9\u9F50\uFF0C
   \u4E00\u5217\u626B\u4E0B\u6765\u80FD\u7ACB\u523B\u770B\u51FA\u300C\u54EA\u4E2A\u662F\u6211\u8981\u7684\u90A3\u6B21\u4FDD\u5B58\u300D\u3002 */
.dshgn_historyPane{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.dshgn_historyHead{flex:none;display:flex;align-items:center;gap:6px;padding:8px 12px;
  font-size:12px;color:var(--dsw-alias-label-secondary);
  border-bottom:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_historyList{flex:1;min-height:0;overflow-y:auto;padding:8px 12px}
.dshgn_historyItem{appearance:none;display:flex;align-items:center;gap:10px;width:100%;
  padding:8px 10px;margin-bottom:4px;border:0;border-radius:7px;
  background:var(--dsw-alias-interactive-bg-hover);font:inherit;cursor:pointer;text-align:left}
.dshgn_historyItem:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}
.dshgn_historyTime{flex:1;min-width:0;font-size:12px;font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-primary)}
.dshgn_historyMeta{flex:none;font-size:11px;color:var(--dsw-alias-label-dimmed)}
.dshgn_mdS{font-size:12px;line-height:1.7}
.dshgn_mdL{font-size:15px;line-height:1.9}
/* \u7528 !important \u662F\u4E3A\u4E86\u76D6\u8FC7 .dshgn_note .dshgn_md \u7684 13.5px \u2014\u2014 \u90A3\u6761\u89C4\u5219
   \u591A\u4E00\u5C42\u9009\u62E9\u5668\uFF0C\u666E\u901A\u5199\u6CD5\u538B\u4E0D\u4F4F\u5B83\uFF0C\u6863\u4F4D\u4F1A\u300C\u70B9\u4E86\u6CA1\u53CD\u5E94\u300D\u3002
   \uFF08CSS \u6CE8\u91CA\u91CC\u4E0D\u80FD\u5199\u53CD\u5F15\u53F7\uFF1A\u6574\u4E2A\u6837\u5F0F\u8868\u662F\u4E00\u4E2A JS \u6A21\u677F\u5B57\u7B26\u4E32\uFF0C\u53CD\u5F15\u53F7\u4F1A\u63D0\u524D\u6536\u5C3E\u3002\uFF09 */
.dshgn_note .dshgn_md.dshgn_mdS{font-size:12px !important;line-height:1.7}
.dshgn_note .dshgn_md.dshgn_mdL{font-size:15px !important;line-height:1.9}
.dshgn_btn{appearance:none;display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 11px;
  border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;
  color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;white-space:nowrap}
.dshgn_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_btn:disabled{opacity:.5;cursor:default}
.dshgn_btnPrimary{border:0;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.dshgn_btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dshgn_btnDanger{color:var(--dsw-alias-state-error-primary)}
/* overflow:hidden \u662F\u627F\u91CD\u7684\uFF1A\u4E09\u680F\u5404\u81EA\u5185\u90E8\u6EDA\u52A8\uFF0C\u5916\u5C42\u7EDD\u4E0D\u80FD\u6EDA\u3002
   \u5C11\u4E86\u5B83\uFF0C\u6B63\u6587\u91CC\u4E00\u5757\u8D85\u5BBD\u7684\u4EE3\u7801\u8868\u683C\u4F1A\u628A\u6574\u4E2A .dshgn_body \u6491\u51FA\u6A2A\u5411\u6EDA\u52A8\u6761\uFF0C
   \u70B9\u5927\u7EB2\u8DF3\u8F6C\u65F6\u6D4F\u89C8\u5668\u628A\u5916\u5C42\u7684\u6A2A\u5411\u6EDA\u52A8\u4E00\u8D77\u5E26\u8D70\uFF0C\u770B\u8D77\u6765\u5C31\u662F\u300C\u6574\u4E2A\u63D2\u4EF6\u5F80\u5DE6\u79FB\u3001\u53D8\u5F62\u300D\u3002 */
.dshgn_body{flex:1;display:flex;min-height:0;min-width:0;overflow:hidden}
.dshgn_tree{flex:none;width:var(--dshgn-treeW,204px);display:flex;flex-direction:column;min-height:0;
  border-right:0.5px solid var(--dsw-alias-border-l2);overflow-y:auto;overflow-x:hidden;padding:8px 6px}
.dshgn_treeHead{display:flex;align-items:center;justify-content:space-between;gap:6px;
  padding:4px 6px;font-size:11px;color:var(--dsw-alias-label-tertiary);user-select:none}
.dshgn_treeRow{display:flex;align-items:center;gap:6px;height:26px;padding:0 7px;border-radius:7px;
  color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;user-select:none}
.dshgn_treeRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_treeRow[data-on="true"]{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-primary)}
/* \u5361\u7247\u6B63\u62D6\u5230\u8FD9\u4E00\u884C\u4E0A\u9762\uFF1A\u865A\u7EBF\u6846 + \u54C1\u724C\u8272\uFF0C\u548C\u300C\u5F53\u524D\u9009\u4E2D\u7684\u76EE\u5F55\u300D\u90A3\u79CD\u5B9E\u5E95\u533A\u5206\u5F00\uFF0C
   \u5426\u5219\u62D6\u5230\u5DF2\u9009\u4E2D\u7684\u76EE\u5F55\u4E0A\u4F1A\u770B\u4E0D\u51FA\u6709\u6CA1\u6709\u63A5\u4F4F\u3002 */
.dshgn_treeFold{appearance:none;flex:none;display:inline-flex;align-items:center;justify-content:center;width:12px;height:16px;margin-left:-12px;padding:0;border:0;border-radius:3px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dshgn_treeFold:hover{color:var(--dsw-alias-label-primary);background:rgba(var(--dshgn-tintRgb),.10)}
.dshgn_treeFold:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dshgn_treeFold svg{transform:rotate(90deg);transition:transform .12s ease}
.dshgn_treeFold[data-folded="true"] svg{transform:rotate(0deg)}
.dshgn_treeFoldGap{flex:none;display:inline-block;width:12px;margin-left:-12px}
.dshgn_treeRow[data-drop="true"]{background:rgba(var(--dshgn-tintRgb),.10);color:var(--dsw-alias-brand-primary);
  box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}
.dshgn_treeName{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;font-size:12px}
.dshgn_treeCount{flex:none;font-size:10px;color:var(--dsw-alias-label-dimmed)}
/* max-width + \u7701\u7565\u53F7\u662F\u627F\u91CD\u7684\uFF1A\u6807\u7B7E\u540D\u662F\u7528\u6237\u968F\u624B\u8D77\u7684\uFF0C\u4E00\u4E2A\u957F\u6807\u7B7E\u5728 190px \u7684\u5DE6\u680F\u91CC
   \u4F1A\u628A\u80F6\u56CA\u6491\u5F97\u6BD4\u680F\u8FD8\u5BBD\uFF0C\u800C .dshgn_tree \u53EA\u8BBE\u4E86 overflow-y\uFF0C\u6A2A\u5411\u5C31\u6EA2\u5230\u680F\u5916\u9762\u53BB\u4E86
   \u2014\u2014\u770B\u8D77\u6765\u5C31\u662F\u300C\u5B57\u8DD1\u5230\u6807\u7B7E\u5708\u5916\u9762\u300D\u3002\u80F6\u56CA\u81EA\u5DF1\u622A\u65AD\uFF0C\u5BBD\u5EA6\u6C38\u8FDC\u4E0D\u8D85\u8FC7\u6240\u5728\u884C\u3002 */
.dshgn_tagRow{display:inline-flex;align-items:center;gap:4px;height:22px;margin:0 4px 4px 0;padding:0 8px;
  border-radius:11px;border:0.5px solid var(--dsw-alias-border-l2);background:transparent;
  color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11px;
  max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_tagRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_tagRow[data-on="true"]{border-color:transparent;background:var(--dsw-alias-interactive-bg-hover-accent);
  color:var(--dsw-alias-brand-primary)}
.dshgn_treeTags{display:flex;flex-wrap:wrap;padding:2px 4px}
/* \u5D4C\u5957\u6807\u7B7E\u644A\u5E73\u540E\uFF0C\u5B50\u6807\u7B7E\u7684\u80F6\u56CA\u53EA\u5199\u6700\u540E\u4E00\u6BB5\uFF0C\u9760\u7F29\u8FDB\u8868\u793A\u5C42\u7EA7 */
.dshgn_treeTags .dshgn_tagRow[data-nest="true"]{border-style:dashed}
/* \u5199\u4F5C\u70ED\u529B\u56FE\uFF1A16 \u5468 \xD7 7 \u5929\u7684\u5C0F\u65B9\u683C\u3002\u683C\u5B50\u7528 grid-auto-flow:column \u6309\u5217\u94FA\uFF0C
   \u6240\u4EE5 DOM \u987A\u5E8F\u662F\u300C\u4E00\u5929\u63A5\u4E00\u5929\u300D\uFF0C\u89C6\u89C9\u4E0A\u662F\u300C\u4E00\u5468\u4E00\u5217\u300D\u2014\u2014\u987A\u5E8F\u5BF9\u4E86\u4E0D\u7528\u91CD\u6392\u3002 */
.dshgn_heat{flex:none;margin:6px 6px 8px;padding:8px 8px 6px;border-radius:8px;
  background:rgba(255,255,255,.05)}
.dshgn_heatHead{display:flex;align-items:baseline;justify-content:space-between;gap:6px;
  margin-bottom:6px}
.dshgn_heatTitle{font-size:10px;letter-spacing:.04em;text-transform:uppercase;
  color:var(--dsw-alias-label-tertiary)}
.dshgn_heatStat{font-size:10px;font-weight:600;color:var(--dsw-alias-label-secondary);
  font-variant-numeric:tabular-nums}
.dshgn_heatGrid{display:grid;grid-auto-flow:column;gap:2px}
.dshgn_heatCell{width:7px;height:7px;border-radius:2px;background:rgba(255,255,255,.08)}
.dshgn_heatCell[data-lv="1"]{background:rgba(255,255,255,.28)}
.dshgn_heatCell[data-lv="2"]{background:rgba(255,255,255,.46)}
.dshgn_heatCell[data-lv="3"]{background:rgba(255,255,255,.66)}
.dshgn_heatCell[data-lv="4"]{background:rgba(255,255,255,.88)}
/* \u672A\u6765\u65E5\u671F\u753B\u6210\u865A\u7EBF\u7A7A\u6846\uFF1A\u5B9E\u5FC3\u7A7A\u6846\u4F1A\u88AB\u8BEF\u8BFB\u6210\u300C\u90A3\u5929\u5199 0 \u7BC7\u300D */
.dshgn_heatCell[data-future="true"]{background:transparent;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
.dshgn_list{flex:none;width:var(--dshgn-listW,260px);display:flex;flex-direction:column;min-height:0;
  border-right:0.5px solid var(--dsw-alias-border-l2)}
/* \u4E09\u680F\u4E4B\u95F4\u7684\u62D6\u62FD\u624B\u67C4\uFF1A\u5E38\u6001\u662F\u4E00\u6761 1px \u7684\u53D1\u4E1D\u7EBF\uFF0C\u60AC\u505C/\u62D6\u52A8\u65F6\u624D\u4EAE\u8D77\u6765\u3002
   \u5BBD\u5EA6 5px \u800C\u4E0D\u662F 1px\u2014\u20141px \u7684\u76EE\u6807\u5728\u89E6\u63A7\u677F\u4E0A\u51E0\u4E4E\u6293\u4E0D\u4F4F\u3002 */
.dshgn_splitter{flex:none;width:5px;margin:0 -2px;cursor:col-resize;position:relative;z-index:2;
  background:transparent;border:0;padding:0}
.dshgn_splitter::after{content:"";position:absolute;top:0;bottom:0;left:2px;width:1px;
  background:var(--dsw-alias-border-l2);transition:background .12s}
.dshgn_splitter:hover::after,.dshgn_splitterOn::after{background:var(--dsw-alias-brand-primary)}
.dshgn_splitter:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
/* \u7A84\u7A97\u53E3\uFF1AObsidian \u7684\u4FA7\u680F\u53EF\u4EE5\u53EA\u6709\u4E24\u4E09\u767E\u50CF\u7D20\u5BBD\uFF0Cpopout \u7A97\u53E3\u4E5F\u80FD\u968F\u4FBF\u62C9\u3002
   \u89C6\u53E3\u5BBD\u5EA6\u5224\u65AD\u4E0D\u4E86\u8FD9\u4EF6\u4E8B\u2014\u2014\u7A97\u53E3\u5F88\u5BBD\u3001\u4FA7\u680F\u5F88\u7A84\u662F\u5E38\u6001\uFF0C\u6240\u4EE5\u7528\u5BB9\u5668\u67E5\u8BE2\u76EF
   \u9762\u677F\u6839\u8282\u70B9\u7684**\u5B9E\u9645\u5BBD\u5EA6**\uFF1A\u5DE6\u680F\u6536\u6210\u62BD\u5C49\uFF0C\u518D\u7A84\u5C31\u628A\u4E2D\u680F\u4E5F\u8BA9\u51FA\u6765\u3002 */
.dshgn_treeToggle,.dshgn_noteBack{display:none}
@container dshgn (max-width:760px){
  .dshgn_treeToggle{display:inline-flex}
  .dshgn_splitter{display:none}
  /* \u5DE6\u680F\u6539\u6210\u6D6E\u5728\u5217\u8868\u4E0A\u7684\u62BD\u5C49\uFF1A\u5BBD\u5EA6\u56FA\u5B9A\uFF0C\u70B9\u5B8C\u76EE\u5F55\u5C31\u81EA\u5DF1\u6536\u56DE\u53BB */
  .dshgn_body{position:relative}
  .dshgn_tree{position:absolute;left:0;top:0;bottom:0;z-index:20;display:none;
    width:min(240px,72%);box-shadow:0 8px 28px rgba(0,0,0,.28)}
  .dshgn_root[data-narrow-tree="true"] .dshgn_tree{display:flex}
}
@container dshgn (max-width:560px){
  /* \u4E00\u7BC7\u7B14\u8BB0\u5F00\u7740\u7684\u65F6\u5019\uFF0C\u5217\u8868\u8BA9\u4F4D\uFF1A\u4E24\u680F\u6324\u5728\u4E00\u8D77\u8C01\u90FD\u8BFB\u4E0D\u4E86 */
  .dshgn_noteBack{display:inline-flex}
  .dshgn_root[data-has-note="true"] .dshgn_list{display:none}
  .dshgn_head{padding:8px 10px;gap:6px}
  .dshgn_sub{display:none}
  .dshgn_tabs{overflow-x:auto;scrollbar-width:none}
  .dshgn_tabs::-webkit-scrollbar{display:none}
}
.dshgn_searchWrap{flex:none;display:flex;align-items:center;gap:6px;padding:8px 10px;
  border-bottom:0.5px solid var(--dsw-alias-border-l2)}
.dshgn_search{flex:1;min-width:0;height:26px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l2);
  border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;
  font-size:12px;outline:none}
.dshgn_search:focus{border-color:var(--dsw-alias-brand-primary)}
/* \u6D4F\u89C8\u5668\u81EA\u5E26\u7684\u90A3\u4E2A \xD7 \u5404\u5BB6\u957F\u5F97\u4E0D\u4E00\u6837\u3001\u4F4D\u7F6E\u4E5F\u4E0D\u53D7\u63A7\uFF0C\u6211\u4EEC\u81EA\u5DF1\u6446\u4E00\u9897\uFF0C\u628A\u5B83\u85CF\u6389 */
.dshgn_search::-webkit-search-cancel-button{display:none}
/* \u641C\u7D22\u6846\u5DE6\u4FA7\u7684\u653E\u5927\u955C\uFF1A\u4EE5\u524D\u6CA1\u6709\u89C4\u5219\uFF0C\u56FE\u6807\u4F1A\u88AB input \u7684 flex:1 \u6324\u5230\u8D34\u8FB9 */
.dshgn_searchIcon{flex:none;color:var(--dsw-alias-label-tertiary);pointer-events:none}
/* \u6E05\u7A7A\uFF1A\u6709\u5B57\u624D\u6446\u3002\u641C\u7D22\u6846\u91CC\u90A3\u70B9\u4E1C\u897F\u5220\u8D77\u6765\u770B\u7740\u5BB9\u6613\uFF0C\u771F\u5220\u8FC7\u4E00\u6574\u53E5\u624D\u77E5\u9053\u8D39\u52B2\u3002 */
.dshgn_searchClear{flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;margin-left:-2px;padding:0;border:0;border-radius:50%;
  background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dshgn_searchClear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshgn_searchClear:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:1px}
/* \u5217\u8868\u6392\u5E8F\u5F00\u5173\uFF1A\u4E0E\u5DE6\u680F\u90A3\u4E24\u9897\u540C\u6B3E\u5C0F\u65B9\u94AE\uFF0C\u4F46\u5217\u8868\u5E95\u8272\u662F\u6D45\u7684\uFF0C\u6240\u4EE5\u989C\u8272\u8D70\u522B\u540D */
.dshgn_listSort{flex:none;display:inline-flex;align-items:center;justify-content:center;
  height:20px;min-width:20px;padding:0 4px;border:0;border-radius:5px;background:transparent;
  color:var(--dsw-alias-label-tertiary);font:inherit;font-size:9px;line-height:1;cursor:pointer;
  letter-spacing:0;text-transform:none}
.dshgn_listSort:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshgn_listSort:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:1px}
/* \u4FA7\u680F\u5165\u53E3\u56FE\u6807\uFF08ownerProps.size \u51B3\u5B9A\u5C3A\u5BF8\uFF0C\u8FD9\u91CC\u53EA\u4FDD\u8BC1\u5757\u7EA7\u5BF9\u9F50\uFF09 */
.dshgn_sideIcon{display:block;flex:none}
.dshgn_listBody{flex:1;overflow-y:auto;padding:6px}
.dshgn_moreBtn{display:block;width:100%;margin:6px 0 2px;justify-content:center}
.dshgn_card{display:flex;flex-direction:column;gap:2px;padding:7px 8px;border-radius:8px;cursor:pointer;
  border-left:2px solid transparent;user-select:none}
.dshgn_card:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_card[data-on="true"]{background:var(--dsw-alias-interactive-bg-hover-accent);
  border-left-color:var(--dsw-alias-brand-primary)}
.dshgn_cardTitle{font-size:12px;line-height:17px;color:var(--dsw-alias-label-primary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_cardMeta{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;white-space:nowrap}
/* \u5361\u7247\u4E0A\u7684\u6807\u7B7E\uFF1A\u548C\u65E5\u671F\u3001\u76EE\u5F55\u6324\u5728\u540C\u4E00\u884C\uFF0C\u6240\u4EE5\u53EA\u7ED9\u5230\u80FD\u770B\u6E05\u7684\u6700\u5C0F\u5C3A\u5BF8\uFF1B
   \u591A\u4E86\u5C31\u6536\u6210 +N\uFF0C\u5B81\u53EF\u4E0D\u663E\u793A\u4E5F\u4E0D\u8BA9\u76EE\u5F55\u88AB\u6324\u6389\u3002 */
.dshgn_cardTags{display:inline-flex;align-items:center;gap:3px;min-width:0;overflow:hidden}
.dshgn_cardTag{appearance:none;max-width:88px;padding:0 5px;border:0.5px solid var(--dsw-alias-border-l2);
  border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:9px;
  line-height:1.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
.dshgn_cardTag:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dshgn_cardTag:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dshgn_cardTagMore{flex:none;color:var(--dsw-alias-label-tertiary)}
.dshgn_cardExcerpt{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_note{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
.dshgn_noteHead{flex:none;display:flex;align-items:center;gap:8px;padding:8px 14px;
  border-bottom:0.5px solid var(--dsw-alias-border-l2)}
.dshgn_notePath{flex:1;min-width:0;font-size:11px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* \u80FD\u70B9\u7684\u90A3\u4E00\u7248\uFF1A\u4E0B\u5212\u865A\u7EBF\u662F\u300C\u8FD9\u91CC\u53EF\u4EE5\u70B9\u300D\u7684\u6700\u5C0F\u4EE3\u4EF7\uFF0C\u4E0D\u5360\u5BBD\u5EA6\u4E5F\u4E0D\u6539\u5B57\u53F7 */
.dshgn_notePathLink{cursor:pointer;text-decoration:underline;text-decoration-style:dotted;
  text-underline-offset:2px}
.dshgn_notePathLink:hover{color:var(--dsw-alias-brand-primary)}
.dshgn_notePathLink:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);
  outline-offset:1px;border-radius:3px}
.dshgn_scroll{flex:1;overflow-y:auto;padding:16px clamp(16px,3vw,32px) 48px}
.dshgn_md{max-width:760px;margin:0 auto;color:var(--dsw-alias-label-primary);
  font-family:var(--font-text,var(--dsw-font-sans,inherit));font-size:var(--font-text-size,13px);
  line-height:var(--line-height-normal,1.75)}
.dshgn_h{font-size:1em;margin:18px 0 8px;line-height:1.4;font-weight:600;color:var(--dsw-alias-label-primary)}
/* \u6807\u9898\u7528 em \u800C\u4E0D\u662F px\uFF1A\u5B57\u53F7\u4E09\u6863\u53EA\u6539 .dshgn_md \u7684\u57FA\u51C6\u5B57\u53F7\uFF0C\u6807\u9898\u6309\u6BD4\u4F8B\u8DDF\u7740\u653E\u5927\uFF0C
   \u6574\u7BC7\u5C42\u7EA7\u5173\u7CFB\u4E0D\u53D8\u3002\u5199\u6B7B px \u7684\u8BDD\u628A\u6B63\u6587\u8C03\u5230 15px\uFF0C\u4E8C\u7EA7\u6807\u9898\u53CD\u800C\u6BD4\u6B63\u6587\u8FD8\u5C0F\u3002 */
.dshgn_h1{font-size:1.48em;margin-top:0}
.dshgn_h2{font-size:1.19em;padding-bottom:5px;border-bottom:0.5px solid var(--dsw-alias-border-l2)}
.dshgn_h3{font-size:1.05em}
.dshgn_h4,.dshgn_h5,.dshgn_h6{font-size:.96em}
.dshgn_p{margin:8px 0;white-space:normal;word-break:break-word}
.dshgn_hr{border:0;border-top:0.5px solid var(--dsw-alias-border-l2);margin:16px 0}
.dshgn_link{color:var(--dsw-alias-brand-primary);text-decoration:none}
.dshgn_link:hover{text-decoration:underline}
/* \u5916\u94FE\u6309\u94AE\uFF1A\u5916\u89C2\u7167\u94FE\u63A5\u8D70\uFF0C\u884C\u4E3A\u662F\u6309\u94AE\uFF08\u907F\u514D\u81EA\u5B9A\u4E49\u89C6\u56FE\u91CC\u70B9\u5916\u94FE\u628A\u5E94\u7528\u5BFC\u822A\u8D70\uFF09 */
.dshgn_linkBtn{background:none;border:0;padding:0;font:inherit;cursor:pointer;text-align:left}
.dshgn_del{text-decoration:line-through;opacity:.72}
.dshgn_mark{padding:0 2px;border-radius:3px;background:rgba(255,208,0,.34);color:inherit}
.dshgn_code{padding:1px 5px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover);
  font-family:var(--font-monospace,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:12px}
.dshgn_pre{position:relative;margin:10px 0;padding:11px 12px;border-radius:9px;overflow-x:auto;
  background:var(--dsw-alias-interactive-bg-hover);border:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_pre code{font-family:var(--font-monospace,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:12px;
  line-height:1.65;white-space:pre;color:var(--dsw-alias-label-primary)}
.dshgn_preLang{position:absolute;top:4px;right:8px;font-size:10px;color:var(--dsw-alias-label-dimmed)}
/* \u6709\u300C\u590D\u5236\u300D\u6309\u94AE\u65F6\u628A\u8BED\u8A00\u6807\u7B7E\u8BA9\u5F00\u4E00\u70B9\uFF0C\u4E24\u4E2A\u90FD\u6324\u5728\u53F3\u4E0A\u89D2\u4F1A\u53E0\u5728\u4E00\u8D77 */
.dshgn_pre:has(.dshgn_preCopy) .dshgn_preLang{right:58px}
.dshgn_preCopy{position:absolute;top:4px;right:8px;appearance:none;padding:1px 7px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-primary);font:inherit;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary);cursor:pointer;opacity:.7}
.dshgn_preCopy:hover{opacity:1;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
/* \u9010\u5B57\u7A3F\u5355\u72EC\u4E00\u5957\u6392\u7248\uFF1A\u5B83\u662F\u4E00\u6BB5\u6BB5\u4E2D\u6587\u53E3\u8BED\uFF0C\u4E0D\u662F\u4EE3\u7801\u3002
   \u4EE5\u524D\u590D\u7528 .dshgn_pre \u7684\u7B49\u5BBD\u5B57\u4F53\uFF0C\u4E2D\u6587\u5168\u90E8\u56DE\u843D\u5230\u5B8B\u4F53/\u96C5\u9ED1\uFF0C\u7B49\u5BBD\u5BF9\u4E2D\u6587\u6BEB\u65E0\u4F5C\u7528\uFF0C
   \u52A0\u4E0A white-space:pre \u4E0D\u6298\u884C\uFF0C\u957F\u53E5\u5728\u7A84\u680F\u91CC\u88AB\u6A2A\u5411\u88C1\u6389\uFF0C\u53EA\u80FD\u62D6\u6EDA\u52A8\u6761\u770B\u2014\u2014\u8FD9\u5C31\u662F\u300C\u5B57\u4F53\u592A\u4E11\u300D\u7684\u7531\u6765\u3002
   \u73B0\u5728\u6362\u6210\u6B63\u6587\u5B57\u4F53\u6808\u3001\u653E\u5927\u5B57\u53F7\u3001\u653E\u5BBD\u884C\u8DDD\uFF0C\u5E76\u5141\u8BB8\u81EA\u52A8\u6298\u884C\uFF1B\u6BCF\u6BB5\u4E4B\u95F4\u7528\u7EC6\u5206\u9694\u7EBF\uFF0C
   \u65B9\u4FBF\u5BF9\u7740\u65F6\u95F4\u6233\u627E\u4F4D\u7F6E\u3002 */
.dshgn_transcript{margin:10px 0;padding:2px 0 2px 0;border:0;background:transparent;
  font-family:var(--dsw-font-sans,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",system-ui,-apple-system,"Segoe UI",sans-serif);
  font-size:13px;line-height:1.9;color:var(--dsw-alias-label-primary);white-space:pre-wrap;
  word-break:break-word;overflow-wrap:anywhere}
.dshgn_transcript p{margin:0;padding:5px 0;border-bottom:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_transcript p:last-child{border-bottom:0}
.dshgn_transcript .dshgn_ts{display:inline-block;min-width:56px;margin-right:8px;
  font-family:var(--dsw-font-mono,var(--font-monospace,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace));
  font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);
  user-select:none}
.dshgn_transcript .dshgn_speaker{color:var(--dsw-alias-brand-primary);font-weight:600;margin-right:6px}
/* \u65F6\u95F4\u6233\u505A\u6210\u6309\u94AE\uFF1A\u70B9\u4E00\u4E0B\u8DF3\u5230\u90A3\u53E5\u8BDD\u3002\u4EE5\u524D\u5B83\u53EA\u662F\u4E2A span\uFF0C\u7528\u6237\u770B\u7740\u65F6\u95F4\u6233
   \u5374\u53EA\u80FD\u81EA\u5DF1\u62D6\u8FDB\u5EA6\u6761\u53BB\u627E\u4F4D\u7F6E\u3002\u6837\u5F0F\u4E0A\u4ECD\u4FDD\u6301\u300C\u4E00\u5217\u5C0F\u5B57\u300D\u7684\u89C2\u611F\uFF0C\u53EA\u5728\u60AC\u505C
   \u548C\u805A\u7126\u65F6\u9732\u51FA\u53EF\u70B9\u7684\u7EBF\u7D22\uFF0C\u514D\u5F97\u6574\u6BB5\u9010\u5B57\u7A3F\u53D8\u6210\u4E00\u7247\u84DD\u8272\u6309\u94AE\u3002 */
.dshgn_transcript .dshgn_tsBtn{background:none;border:0;padding:1px 4px;margin-left:-4px;border-radius:4px;
  font:inherit;font-family:var(--dsw-font-mono,var(--font-monospace,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace));
  font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);
  cursor:pointer;text-align:left;user-select:none}
.dshgn_transcript .dshgn_tsBtn:hover{background:var(--dsw-alias-interactive-bg-hover);
  color:var(--dsw-alias-brand-primary)}
.dshgn_transcript .dshgn_tsBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
/* \u6B63\u5728\u64AD\u653E\u7684\u90A3\u4E00\u53E5\uFF1A\u65F6\u95F4\u6233\u52A0\u91CD\u3001\u6574\u6BB5\u5DE6\u4FA7\u7559\u4E00\u9053\u7AD6\u7EBF\uFF0C\u626B\u8BFB\u65F6\u89C6\u7EBF\u4E0D\u4F1A\u8DD1\u4E22 */
.dshgn_transcript .dshgn_tsOn{color:var(--dsw-alias-brand-primary);font-weight:600}
.dshgn_transcript p.dshgn_tpOn{background:rgba(var(--dshgn-tintRgb),.06);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary);
  padding-left:8px;margin-left:-8px}
.dshgn_quote{margin:10px 0;padding:2px 0 2px 12px;border-left:2px solid var(--dsw-alias-border-l2);
  color:var(--dsw-alias-label-secondary)}
/* \u811A\u6CE8\uFF1A\u6B63\u6587\u91CC\u7559\u4E00\u4E2A\u4E0A\u6807\uFF0C\u5B9A\u4E49\u6536\u5728\u7BC7\u5C3E\u4E00\u5C0F\u5757\u91CC\u3002
   \u5B9A\u4E49\u884C\u539F\u6837\u663E\u793A\u7684\u8BDD\uFF0C\u8BFB\u8005\u4F1A\u770B\u5230\u4E00\u4E32 [^1]: ... \u6DF7\u5728\u6B63\u6587\u4E2D\u95F4\u3002 */
.dshgn_footRef{font-size:9px;line-height:1;vertical-align:super;color:var(--dsw-alias-brand-primary);cursor:pointer;padding:0 1px}
.dshgn_footRef:hover{text-decoration:underline}
.dshgn_footnotes{margin:14px 0 0;padding-top:8px;border-top:0.5px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:4px}
.dshgn_footnote{display:flex;gap:6px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:4px;margin:0 -3px;padding:1px 3px}
.dshgn_footnote:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_footnote:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dshgn_footnoteNo{flex:0 0 auto;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dshgn_footnoteText{flex:1 1 auto;min-width:0;word-break:break-word}
/* callout\uFF1A\u8DDF\u5BBF\u4E3B\u4E00\u6837\u300C\u5DE6\u7AD6\u7EBF + \u6DE1\u5E95 + \u4E00\u884C\u6807\u9898\u300D\u3002\u7C7B\u578B\u53EA\u5F71\u54CD\u7AD6\u7EBF\u4E0E\u6807\u9898\u7684\u989C\u8272\uFF0C
   \u6B63\u6587\u4E00\u5F8B\u7528\u5E38\u89C4\u8272\u2014\u2014\u6574\u5757\u67D3\u6210\u8B66\u544A\u8272\u4F1A\u8BA9\u4EBA\u4EE5\u4E3A\u7B14\u8BB0\u672C\u8EAB\u51FA\u9519\u4E86\u3002 */
.dshgn_callout{margin:10px 0;padding:7px 11px;border-radius:0 8px 8px 0;
  border-left:2.5px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_callout-info{border-left-color:var(--dsw-alias-brand-primary)}
.dshgn_callout-success{border-left-color:var(--dsw-alias-state-success-primary)}
.dshgn_callout-warn{border-left-color:var(--dsw-alias-state-warn-primary)}
.dshgn_callout-error{border-left-color:var(--dsw-alias-state-error-primary)}
.dshgn_calloutHead{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;
  color:var(--dsw-alias-label-primary);line-height:17px}
.dshgn_callout-info .dshgn_calloutHead{color:var(--dsw-alias-brand-primary)}
.dshgn_callout-success .dshgn_calloutHead{color:var(--dsw-alias-state-success-primary)}
.dshgn_callout-warn .dshgn_calloutHead{color:var(--dsw-alias-state-warn-primary)}
.dshgn_callout-error .dshgn_calloutHead{color:var(--dsw-alias-state-error-primary)}
/* \u53EF\u6298\u53E0\u65F6\u6807\u9898\u662F\u6309\u94AE\uFF1A\u53BB\u6389\u6309\u94AE\u9ED8\u8BA4\u6837\u5F0F\uFF0C\u53EA\u7559 hover \u7684\u4E00\u70B9\u5E95\u8272\uFF0C
   \u8BA9\u4EBA\u80FD\u770B\u51FA\u8FD9\u4E00\u884C\u80FD\u70B9\u3002 */
.dshgn_calloutFold{appearance:none;border:0;background:transparent;padding:0;margin:0;
  width:100%;font:inherit;font-size:12px;font-weight:600;text-align:left;cursor:pointer;
  border-radius:5px}
.dshgn_calloutFold:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}
.dshgn_calloutIcon{flex:none}
.dshgn_calloutTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_calloutBody{margin-top:5px;color:var(--dsw-alias-label-secondary);font-size:12.5px}
.dshgn_calloutBody .dshgn_p:first-child{margin-top:0}
.dshgn_calloutBody .dshgn_p:last-child{margin-bottom:0}
.dshgn_mdList{margin:8px 0;padding-left:22px}
.dshgn_li{margin:3px 0;line-height:1.7}
.dshgn_liCont{color:var(--dsw-alias-label-secondary)}
.dshgn_task{list-style:none;margin-left:-18px;display:flex;align-items:flex-start;gap:6px}
.dshgn_check{flex:none;width:12px;height:12px;margin-top:5px;border-radius:3px;
  border:1.5px solid var(--dsw-alias-border-l2);display:inline-block}
.dshgn_checkOn{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
/* \u53EF\u70B9\u7684\u5F85\u529E\u65B9\u6846\uFF1A12px \u7684\u65B9\u5757\u5728\u684C\u9762\u4E0A\u592A\u96BE\u70B9\u4E2D\uFF0C\u7528\u900F\u660E outline \u628A\u547D\u4E2D\u533A\u6491\u5230 26px\uFF0C
   \u89C6\u89C9\u4E0A\u8FD8\u662F\u4E00\u4E2A 12px \u7684\u6846\u3002cursor \u4E0E hover \u662F\u552F\u4E00\u80FD\u544A\u8BC9\u7528\u6237\u300C\u8FD9\u4E2A\u80FD\u70B9\u300D\u7684\u4FE1\u53F7\u3002 */
.dshgn_checkHit{cursor:pointer;position:relative;transition:background .12s ease,border-color .12s ease}
.dshgn_checkHit:hover{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_checkHit.dshgn_checkOn:hover{background:var(--dsw-alias-button-primary-hover)}
.dshgn_checkHit::after{content:'';position:absolute;inset:-7px}
.dshgn_tableWrap{overflow-x:auto;margin:10px 0}
/* \u957F\u8868\u683C\u5355\u72EC\u6EDA\uFF0C\u8868\u5934\u9489\u5728\u9876\u4E0A\uFF1A\u8BFB\u5230\u7B2C 30 \u884C\u8FD8\u77E5\u9053\u8FD9\u4E00\u5217\u662F\u4EC0\u4E48\u3002 */
.dshgn_tableTall{max-height:min(70vh,520px);overflow-y:auto}
.dshgn_tableTall .dshgn_table th{position:sticky;top:0;z-index:1}
.dshgn_table{border-collapse:collapse;font-size:12px;min-width:100%}
.dshgn_table th,.dshgn_table td{padding:6px 10px;text-align:left;
  border-bottom:0.5px solid var(--dsw-alias-border-l2);vertical-align:top}
.dshgn_table th{color:var(--dsw-alias-label-secondary);font-weight:600;
  background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_editor{flex:1;width:100%;box-sizing:border-box;resize:none;border:0;outline:none;padding:16px clamp(16px,3vw,32px);
  background:transparent;color:var(--dsw-alias-label-primary);
  font-family:var(--font-text,var(--dsw-font-sans,inherit));font-size:var(--font-text-size,13px);
  line-height:var(--line-height-normal,1.7)}
.dshgn_editorFoot{display:flex;align-items:center;gap:10px;padding:5px clamp(16px,3vw,32px);
  border-top:0.5px solid var(--dsw-alias-border-l1);font-size:10.5px;
  color:var(--dsw-alias-label-tertiary);flex:0 0 auto}
.dshgn_editorHint{margin-left:auto;opacity:.75}
.dshgn_readFoot{color:var(--dsw-alias-label-tertiary)}

.dshgn_linkPick{display:flex;flex-wrap:wrap;gap:6px;padding:6px clamp(16px,3vw,32px);border-top:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-secondary);max-height:112px;overflow-y:auto}
.dshgn_linkPickItem{display:inline-flex;align-items:center;gap:5px;appearance:none;max-width:100%;padding:2px 9px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-primary);font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshgn_linkPickItem:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.dshgn_linkPickItem[data-on='true']{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-primary)}
.dshgn_linkPickName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_findBar{display:flex;align-items:center;gap:6px;padding:5px clamp(16px,3vw,32px);
  border-bottom:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-secondary);
  color:var(--dsw-alias-label-tertiary);flex:0 0 auto}
.dshgn_findInput{flex:1;min-width:0;box-sizing:border-box;padding:3px 8px;border:0.5px solid var(--dsw-alias-border-l1);
  border-radius:6px;outline:none;background:var(--dsw-alias-bg-primary);font:inherit;font-size:12px;
  color:var(--dsw-alias-label-primary)}
.dshgn_findInput:focus{border-color:var(--dsw-alias-brand-primary)}
/* \u300C\u7B2C\u51E0\u5904 / \u5171\u51E0\u5904\u300D\uFF1A\u7B49\u5BBD\u6570\u5B57\uFF0C\u6309\u56DE\u8F66\u65F6\u8FD9\u4E00\u4E32\u4E0D\u8DDF\u7740\u5DE6\u53F3\u8DF3 */
.dshgn_findCount{flex:none;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary);
  font-variant-numeric:tabular-nums;white-space:nowrap}
/* \u6551\u56DE\u6765\u7684\u8349\u7A3F\u63D0\u793A\u6761\uFF1A\u6BD4\u67E5\u627E\u6761\u66F4\u300C\u5B89\u9759\u300D\uFF0C\u5B83\u53EA\u662F\u63D0\u4E00\u53E5\uFF0C\u4E0D\u8BE5\u62A2\u9605\u8BFB\u7684\u6CE8\u610F\u529B */
.dshgn_draftBar{display:flex;align-items:center;gap:8px;padding:5px clamp(16px,3vw,32px);
  border-bottom:0.5px solid var(--dsw-alias-border-l1);
  background:rgba(var(--dshgn-tintRgb),.06);color:var(--dsw-alias-label-secondary);flex:0 0 auto}
.dshgn_draftText{flex:1;min-width:0;font-size:11.5px;line-height:1.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_draftBtn{flex:none;appearance:none;padding:1px 9px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;
  background:var(--dsw-alias-bg-primary);font:inherit;font-size:11px;line-height:1.7;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshgn_draftBtn:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.dshgn_draftBtn:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:1px}
/* \u5212\u9009\u6B63\u6587\u65F6\u5F39\u51FA\u6765\u7684\u5C0F\u6761\uFF1A\u4F4D\u7F6E\u6309\u89C6\u53E3\u5750\u6807\u9489\u4F4F\uFF08\u677E\u624B\u90A3\u4E00\u523B\u7B97\u597D\u7684\uFF09\uFF0C
   \u4E0D\u53C2\u4E0E\u6392\u7248\uFF0C\u6240\u4EE5\u6D6E\u5728\u6B63\u6587\u4E0A\u65B9\u4E00\u5C42\uFF0C\u4E14\u4E0D\u8BE5\u88AB\u6B63\u6587\u7684 overflow \u88C1\u6389 */
.dshgn_selPop{position:fixed;z-index:60;display:flex;align-items:center;gap:2px;
  padding:2px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;
  background:var(--dsw-alias-bg-primary);box-shadow:0 4px 14px rgba(0,0,0,.16);
  transform:translate(-50%,-100%) translateY(-6px)}
.dshgn_selPopBtn{appearance:none;display:inline-flex;align-items:center;gap:4px;padding:2px 8px;
  border:0;border-radius:6px;background:transparent;font:inherit;font-size:11px;line-height:1.7;
  color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.dshgn_selPopBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshgn_selPopBtn:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dshgn_empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:8px;padding:32px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.dshgn_emptyTitle{font-size:13px;color:var(--dsw-alias-label-secondary)}
.dshgn_emptyDesc{font-size:12px;line-height:1.7;max-width:340px}
.dshgn_pane{flex:1;overflow-y:auto;padding:18px clamp(16px,3vw,28px) 40px}
.dshgn_cardBox{max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.dshgn_section{display:flex;flex-direction:column;gap:8px;padding:14px 15px;border-radius:10px;
  border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay)}
.dshgn_sectionTitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
/* \u5361\u7247\u6807\u9898\u884C\uFF1A\u6807\u9898 + \u53F3\u4FA7\u72B6\u6001\u5FBD\u7AE0\u3002\u4EE5\u524D\u5FBD\u7AE0\u53EA\u80FD\u6302\u5728\u4E0B\u4E00\u884C\uFF0C\u8BFB\u8D77\u6765\u50CF\u4E24\u4E2A\u72EC\u7ACB\u4FE1\u606F\u3002 */
.dshgn_sectionHead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px}
.dshgn_sectionDesc{font-size:11.5px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.dshgn_rowLine{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshgn_input{flex:1;min-width:180px;height:28px;padding:0 9px;border:0.5px solid var(--dsw-alias-border-l2);
  border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;
  font-size:12px;outline:none}
.dshgn_input:focus{border-color:var(--dsw-alias-brand-primary)}
/* \u5DE5\u5177\u680F\u91CC\u7684\u5C0F\u4E0B\u62C9\uFF1A\u4E0D\u8BE5\u50CF\u6B63\u6587\u8F93\u5165\u6846\u90A3\u6837\u62A2\u8D70\u534A\u884C\u5BBD\u5EA6 */
.dshgn_selectSm{flex:none;min-width:0;width:auto;height:24px;padding:0 6px;font-size:11.5px;cursor:pointer}
.dshgn_badge{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:10px;
  font-size:10.5px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dshgn_badgeOk{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-brand-primary)}
.dshgn_badgeWarn{background:transparent;color:var(--dsw-alias-state-warn-primary);
  box-shadow:inset 0 0 0 0.5px var(--dsw-alias-state-warn-primary)}
.dshgn_badgeErr{color:var(--dsw-alias-state-error-primary)}
.dshgn_log{max-height:220px;overflow-y:auto;padding:8px 10px;border-radius:8px;
  background:var(--dsw-alias-interactive-bg-hover);font-family:var(--font-monospace,ui-monospace,SFMono-Regular,Menlo,monospace);
  font-size:11px;line-height:1.7;color:var(--dsw-alias-label-secondary);white-space:pre-wrap}
.dshgn_error{padding:8px 10px;border-radius:8px;font-size:11.5px;line-height:1.6;
  color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_toast{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:20;
  display:flex;align-items:center;gap:6px;padding:7px 13px;border-radius:9px;
  background:var(--dsw-alias-toast-bg);color:var(--dsw-alias-toast-label);
  font-size:12px;box-shadow:0 6px 22px rgba(0,0,0,.16)}
.dshgn_rel{position:relative;height:100%;container-type:inline-size;container-name:dshgn}
.dshgn_spin{display:inline-block;width:12px;height:12px;border-radius:50%;
  border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);
  animation:dshgn-spin .8s linear infinite}
@keyframes dshgn-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.dshgn_spin{animation:none}}
.dshgn_emptyState{display:flex;align-items:center;justify-content:center;height:100%;
  color:var(--dsw-alias-label-tertiary);font-size:12px}
/* \u9519\u8BEF\u8FB9\u754C\uFF1A\u6E32\u67D3\u5F02\u5E38\u65F6\u7684\u964D\u7EA7\u754C\u9762\u3002\u4E0D\u505A\u6210\u5C45\u4E2D\u7A7A\u72B6\u6001\u2014\u2014\u7528\u6237\u9700\u8981\u4E00\u773C\u770B\u51FA\u8FD9\u662F
   \u300C\u574F\u4E86\u300D\u800C\u4E0D\u662F\u300C\u6CA1\u6709\u5185\u5BB9\u300D\uFF0C\u6240\u4EE5\u5DE6\u5BF9\u9F50\u3001\u7559\u767D\u6536\u7D27\u3001\u9519\u8BEF\u539F\u6587\u7528\u7B49\u5BBD\u5B57\u4F53\u53EF\u9009\u4E2D\u3002 */
.dshgn_boundary{display:flex;flex-direction:column;gap:10px;padding:28px 32px;
  align-items:flex-start;justify-content:flex-start;overflow:auto}
.dshgn_boundaryTitle{font-size:14px;font-weight:600;
  color:var(--dsw-alias-state-error-primary)}
.dshgn_boundaryMsg{font-size:13px;line-height:1.7;color:var(--dsw-alias-label-primary);
  word-break:break-word;max-width:100%}
.dshgn_boundaryStack{margin:0;padding:10px 12px;border-radius:8px;max-width:100%;
  overflow:auto;background:var(--dsw-alias-interactive-bg-hover);
  border:0.5px solid var(--dsw-alias-border-l1);font-size:11.5px;line-height:1.6;
  color:var(--dsw-alias-label-secondary);
  font-family:var(--font-monospace,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);white-space:pre-wrap}
/* \u2500\u2500 \u97F3\u9891\u64AD\u653E\u5668 \u2500\u2500 */
.dshgn_audioCard{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-radius:10px;
  border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay)}
.dshgn_audioBar{display:flex;align-items:center;gap:10px}
.dshgn_audioBtn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;
  border-radius:50%;border:0;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);
  cursor:pointer;padding:0}
.dshgn_audioBtn:hover{background:var(--dsw-alias-button-primary-hover)}
.dshgn_audioBtn:disabled{opacity:.5;cursor:default}
/* \u8FDB\u5EA6\u6761\u6539\u6210\u81EA\u7ED8\u7684 div\uFF0C\u4E0D\u518D\u7528 <input type=range>\u3002
   \u539F\u56E0\uFF1A\u539F\u751F range \u5728\u8FD9\u5957\u9762\u677F\u91CC\u5B9E\u6D4B\u300C\u600E\u4E48\u62D6\u90FD\u6CA1\u53CD\u5E94\u300D\u2014\u2014\u5143\u7D20\u53EA\u6709 4px \u9AD8\u65F6\u9F20\u6807\u6293\u4E0D\u4F4F\u62C7\u6307\uFF1B
   \u628A\u9AD8\u5EA6\u6491\u5230 18px \u4E5F\u53EA\u662F\u63D0\u9AD8\u4E86\u547D\u4E2D\u7387\uFF0C\u53D7\u63A7 value \u8FD8\u4F1A\u88AB timeupdate \u6253\u56DE\u539F\u4F4D\u3002
   \u81EA\u7ED8\u4E4B\u540E\u6574\u6761 18px \u90FD\u662F\u547D\u4E2D\u533A\uFF0C\u6309\u4E0B\u5C31\u80FD\u6293\uFF0CsetPointerCapture \u4FDD\u8BC1\u62D6\u51FA\u5143\u7D20\u4E5F\u4E0D\u4E22\u4E8B\u4EF6\u3002
   touch-action:none \u662F\u5FC5\u987B\u7684\uFF1A\u4E0D\u5199\u7684\u8BDD\u89E6\u6478/\u89E6\u63A7\u677F\u624B\u52BF\u4F1A\u62A2\u8D70 pointermove\uFF0C
   \u8868\u73B0\u540C\u6837\u662F\u300C\u62D6\u4E0D\u52A8\u300D\u3002 */
.dshgn_audioSeek{position:relative;flex:1;min-width:0;height:18px;display:flex;align-items:center;
  cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none;outline:none;
  border-radius:9px}
.dshgn_audioSeek:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary)}
.dshgn_audioTrack{position:relative;width:100%;height:4px;border-radius:2px;
  background:var(--dsw-alias-border-l2);overflow:visible}
.dshgn_audioFill{position:absolute;left:0;top:0;height:100%;border-radius:2px;
  background:var(--dsw-alias-brand-primary)}
.dshgn_audioThumb{position:absolute;top:50%;width:13px;height:13px;border-radius:50%;
  background:var(--dsw-alias-brand-primary);border:2px solid var(--dsw-alias-bg-overlay);
  box-shadow:0 1px 3px rgba(var(--dshgn-tintRgb),.28);transform:translate(-50%,-50%);pointer-events:none}
.dshgn_audioSeek:hover .dshgn_audioThumb{transform:translate(-50%,-50%) scale(1.12)}
.dshgn_audioTime{flex:none;font-size:11px;font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-tertiary)}
.dshgn_audioLabel{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
/* \u2500\u2500 \u5F00\u5173 \u2500\u2500 */
.dshgn_toggle{position:relative;flex:none;width:34px;height:19px;border-radius:10px;border:0;padding:0;
  background:var(--dsw-alias-border-l2);cursor:pointer;transition:background .15s}
.dshgn_toggle[data-on="true"]{background:var(--dsw-alias-brand-primary)}
.dshgn_toggle::after{content:"";position:absolute;top:2.5px;left:2.5px;width:14px;height:14px;
  border-radius:50%;background:Canvas;transition:transform .15s}
.dshgn_toggle[data-on="true"]::after{transform:translateX(15px)}
.dshgn_toggleRow{display:flex;align-items:center;gap:10px;justify-content:space-between}
.dshgn_toggleLabel{display:flex;flex-direction:column;gap:2px;min-width:0}
.dshgn_toggleTitle{font-size:12px;color:var(--dsw-alias-label-primary)}
.dshgn_toggleDesc{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
/* \u2500\u2500 \u8868\u5355\u5B57\u6BB5 \u2500\u2500 */
.dshgn_field{display:flex;flex-direction:column;gap:5px}
.dshgn_fieldLabel{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.dshgn_fieldHint{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
/* \u81EA\u5B9A\u4E49\u6A21\u677F\u5217\u8868\uFF1A\u6A21\u677F\u540D\u4E00\u884C\u3001\u9AA8\u67B6\u9884\u89C8\u4E24\u884C\u622A\u65AD\u3002\u9884\u89C8\u8981\u622A\u65AD\u662F\u56E0\u4E3A\u9AA8\u67B6\u53EF\u80FD\u6709\u51E0\u5341\u884C\uFF0C
   \u6574\u6BB5\u94FA\u5F00\u4F1A\u628A\u8BBE\u7F6E\u9875\u6491\u5F97\u8001\u957F\uFF0C\u800C\u7528\u6237\u5728\u8FD9\u4E00\u5C4F\u53EA\u9700\u8981\u8BA4\u51FA\u300C\u8FD9\u662F\u54EA\u4E2A\u6A21\u677F\u300D\u3002 */
.dshgn_sectionHint{font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary);margin-left:auto}
.dshgn_emptyRow{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:6px 0}
.dshgn_tplList{display:flex;flex-direction:column;gap:6px}
.dshgn_tplRow{display:flex;align-items:flex-start;gap:8px;padding:7px 9px;border-radius:7px;
  background:var(--dsw-alias-interactive-bg-hover);border:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_tplMain{flex:1;min-width:0}
.dshgn_tplName{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dshgn_tplBody{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary);margin-top:2px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}
.dshgn_tplForm{display:flex;flex-direction:column;gap:6px}
.dshgn_btnRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshgn_textarea{width:100%;box-sizing:border-box;min-height:180px;resize:vertical;padding:9px 10px;
  border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;
  color:var(--dsw-alias-label-primary);font-family:var(--font-monospace,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);
  font-size:12px;line-height:1.65;outline:none}
.dshgn_textarea:focus{border-color:var(--dsw-alias-brand-primary)}
.dshgn_btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 11px;border-radius:7px;
  border:0.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);
  font:inherit;font-size:12px;cursor:pointer}
.dshgn_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_btn:disabled{opacity:.5;cursor:default}
.dshgn_btnPri{border-color:transparent;background:var(--dsw-alias-button-primary-fill);
  color:var(--dsw-alias-label-primary-foreground)}
.dshgn_btnPri:hover{background:var(--dsw-alias-button-primary-hover)}
/* \u6DE1\u4E00\u6863\u7684\u5F3A\u8C03\u6309\u94AE\uFF1A\u7ED9\u300C\u7528\u6211\u7684\u672C\u5730\u7248 / \u7528\u4E91\u7AEF\u7248\u300D\u8FD9\u79CD\u4E8C\u9009\u4E00\u7528\u3002
   \u6EE1\u9971\u548C\u7684\u4E3B\u8272\u5728\u8FD9\u4E24\u4E2A\u6309\u94AE\u4E0A\u4F1A\u62A2\u6389\u6BD4\u5BF9\u6B63\u6587\u7684\u6CE8\u610F\u529B\u2014\u2014\u7528\u6237\u662F\u6765\u8BFB\u5DEE\u5F02\u7684\uFF0C
   \u4E0D\u662F\u6765\u770B\u6309\u94AE\u7684\u3002\u8FD9\u91CC\u6539\u7528\u67D4\u548C\u7684\u586B\u5145 + \u540C\u8272\u7CFB\u6DF1\u5B57\uFF0C\u9009\u4E2D\u611F\u8FD8\u5728\u4F46\u4E0D\u523A\u773C\u3002 */
.dshgn_btnSoft{border-color:transparent;background:var(--dshgn-btnFillSoft);
  color:var(--dsw-alias-label-primary-foreground)}
.dshgn_btnSoft:hover:not(:disabled){background:var(--dshgn-btnHoverSoft)}
/* \u51B2\u7A81\u9875\u7684\u91C7\u7EB3\u6309\u94AE\uFF1A\u672A\u5904\u7406\u65F6\u7528\u7EA2\u8272\u63CF\u8FB9\u63D0\u9192\u300C\u8FD9\u91CC\u9700\u8981\u4F60\u505A\u4E2A\u51B3\u5B9A\u300D\uFF0C
   \u4E24\u4E2A\u6309\u94AE\u90FD\u7EA2\uFF0C\u8C01\u90FD\u4E0D\u50CF\u9ED8\u8BA4\u9009\u9879\uFF1B\u9009\u8FC7\u4E4B\u540E\u7EA2\u6846\u6D88\u5931\u3001\u586B\u6210\u6D45\u8272\uFF0C
   \u586B\u5145\u672C\u8EAB\u5C31\u662F\u300C\u6211\u5F53\u521D\u9009\u4E86\u8FD9\u4E00\u8FB9\u300D\u7684\u8BB0\u53F7\u3002 */
.dshgn_btnWarn{border-color:var(--dsw-alias-state-error-primary);
  color:var(--dsw-alias-state-error-primary);background:transparent}
.dshgn_btnWarn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_btnPale{border-color:transparent;background:var(--dshgn-btnFillPale);
  color:var(--dsw-alias-label-primary-foreground)}
.dshgn_btnPale:hover:not(:disabled){background:var(--dshgn-btnHoverPale)}
/* \u5DF2\u5904\u7406\u533A\u7684\u6298\u53E0\u6807\u9898\u884C\uFF1A\u6574\u884C\u53EF\u70B9\uFF0C\u7BAD\u5934\u8DDF\u7740\u5F00\u5408\u8F6C 90\xB0\u3002 */
.dshgn_foldHead{display:flex;align-items:center;gap:6px;padding:8px 2px;cursor:pointer;
  border:0;background:transparent;font:inherit;font-size:12px;width:100%;text-align:left;
  color:var(--dsw-alias-label-secondary)}
.dshgn_foldHead:hover{color:var(--dsw-alias-label-primary)}
.dshgn_foldArrow{display:inline-flex;transition:transform 140ms ease}
.dshgn_foldArrow[data-open="true"]{transform:rotate(90deg)}
.dshgn_foldCount{font-size:11px;color:var(--dsw-alias-label-dimmed);
  font-variant-numeric:tabular-nums}
.dshgn_btnDanger{color:var(--dsw-alias-state-error-primary)}
/* \u5F55\u97F3\u5361\u9762\u677F\uFF1A\u5361\u7247\u4E0A\u7684\u6587\u4EF6\u5217\u8868\u4E0E\u5371\u9669\u5F00\u5173\u3002
   \u300C\u5BFC\u5165\u540E\u5220\u539F\u4EF6\u300D\u90A3\u4E00\u884C\u523B\u610F\u505A\u6210\u666E\u901A checkbox \u800C\u4E0D\u662F\u82B1\u54E8\u5F00\u5173\u2014\u2014\u5B83\u65C1\u8FB9\u5199\u7740
   \u300C\u6C38\u4E45\u5220\u9664\u300D\uFF0C\u8D8A\u6734\u7D20\u8D8A\u597D\uFF0C\u522B\u8BA9\u4EBA\u8BEF\u4EE5\u4E3A\u662F\u67D0\u79CD\u63A8\u8350\u8BBE\u7F6E\u3002 */
.dshgn_paneInner{display:flex;flex-direction:column;gap:12px;padding:18px 20px;max-width:720px;overflow-y:auto}
.dshgn_paneDesc{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-tertiary)}
.dshgn_row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px}
.dshgn_fileList{display:flex;flex-direction:column;gap:2px;margin-top:8px;max-height:260px;overflow-y:auto}
.dshgn_fileRow{display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:5px 8px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);
  font-size:11.5px;font-variant-numeric:tabular-nums}
.dshgn_fileName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--dsw-alias-label-primary)}
.dshgn_fileMeta{flex:none;color:var(--dsw-alias-label-tertiary)}
.dshgn_checkRow{display:flex;align-items:center;gap:7px;margin-top:10px;font-size:12px;
  color:var(--dsw-alias-label-primary);cursor:pointer}
.dshgn_checkRow input{width:13px;height:13px;margin:0;cursor:pointer}
/* \u80F6\u56CA/\u9884\u8BBE\u6309\u94AE\uFF1A\u5FC5\u987B\u663E\u5F0F\u6E05\u6389 UA \u7684\u6309\u94AE\u5E95\u8272\u4E0E\u5B57\u4F53\uFF0C
   \u5426\u5219\u5728\u6DF1\u8272\u4E3B\u9898\u91CC\u4F1A\u753B\u6210\u4E00\u5757\u7070\u5E95\uFF08\u6587\u5B57\u662F\u4E3B\u9898\u8272\uFF0C\u5E95\u662F\u6D4F\u89C8\u5668\u9ED8\u8BA4\u7070\uFF09\u3002 */
.dshgn_chip{display:inline-flex;align-items:center;gap:4px;height:21px;padding:0 9px;border-radius:11px;
  border:0.5px solid var(--dsw-alias-border-l2);background:transparent;font:inherit;
  font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.dshgn_chip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);
  color:var(--dsw-alias-label-primary)}
.dshgn_chip:disabled{opacity:.5;cursor:default}
.dshgn_chipOn{border-color:transparent;background:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-label-primary-foreground);font-weight:500}
.dshgn_chipOn:hover:not(:disabled){background:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-label-primary-foreground)}
/* \u53EA\u8BFB\u7684\u6807\u7B7E\u80F6\u56CA\uFF08\u4E91\u7AEF\u8BE6\u60C5\u91CC\u7684\u6807\u7B7E\uFF09\uFF1A\u5F62\u72B6\u540C chip\uFF0C\u4F46\u4E0D\u5047\u88C5\u53EF\u70B9 */
/* \u8BED\u8A00\u9009\u62E9\u884C\uFF1A\u56DB\u4E2A\u80F6\u56CA\u6A2A\u6392\uFF0C\u7A84\u9762\u677F\u65F6\u81EA\u52A8\u6298\u884C\uFF08Nederlands \u6BD4\u4E2D\u6587\u957F\u5F97\u591A\uFF09 */
.dshgn_langRow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px}
.dshgn_tagPill{display:inline-flex;align-items:center;height:21px;padding:0 9px;border-radius:11px;
  border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);
  font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
/* \u6807\u7B7E\u80F6\u56CA\u4E0A\u7684\u300C\xD7\u300D\uFF1A\u53EA\u8BA9\u90A3\u4E2A\u53C9\u53EF\u70B9\uFF0C\u6574\u5757\u80F6\u56CA\u4E0D\u54CD\u5E94\u70B9\u51FB\u2014\u2014\u5426\u5219\u60F3\u70B9\u6807\u7B7E\u770B\u8BE6\u60C5\u7684\u4EBA
   \u4F1A\u4E00\u4E0D\u5C0F\u5FC3\u628A\u6807\u7B7E\u5220\u6389\u3002 */
.dshgn_tagX{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;
  margin-left:5px;border:0;border-radius:50%;padding:0;cursor:pointer;font-size:11px;
  line-height:1;background:transparent;color:var(--dsw-alias-label-tertiary);font-family:inherit}
.dshgn_tagX:hover{background:var(--dsw-alias-state-error-primary);color:#fff}
/* \u4E91\u7AEF\u77E5\u8BC6\u5E93\u7B5B\u9009\u884C\uFF1A\u6A2A\u5411\u53EF\u6EDA\uFF0C\u4E0D\u6362\u884C\u2014\u2014\u77E5\u8BC6\u5E93\u591A\u7684\u8D26\u53F7\u6362\u884C\u540E\u4F1A\u5360\u6389\u534A\u5C4F\u3002
   \u5DE6\u5185\u8FB9\u8DDD\u5BF9\u9F50\u7B14\u8BB0\u5361\u6807\u9898\u7684\u9996\u5B57\uFF1A\u5361\u7247\u662F listBody 6px + \u5361\u7247\u5DE6\u8FB9\u6846 2px + \u5361\u7247\u5185\u8FB9\u8DDD 8px
   = 16px\uFF0C\u7B5B\u9009\u884C\u4E0D\u8865\u8FD9\u4E2A\u503C\u5C31\u4F1A\u6BD4\u4E0B\u9762\u7684\u6807\u9898\u5F80\u5DE6\u51F8\u51FA 16px\uFF0C\u770B\u8D77\u6765\u50CF\u6CA1\u5BF9\u9F50\u7684\u60AC\u6302\u7F29\u8FDB\u3002 */
.dshgn_topicRow{display:flex;gap:6px;overflow-x:auto;padding:2px 10px 6px 16px;flex:none}
.dshgn_topicChip{display:inline-flex;align-items:center;height:22px;padding:0 10px;border-radius:11px;
  border:0.5px solid var(--dsw-alias-border-l2);background:transparent;font:inherit;font-size:11px;
  color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;flex:none}
.dshgn_topicChip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshgn_topicChip[data-on="true"]{border-color:transparent;background:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-label-primary-foreground);font-weight:500}
/* \u56FE\u7247\u9644\u4EF6\uFF1A\u4E00\u884C\u6A2A\u5411\u6392\uFF0C\u5355\u5F20\u6700\u9AD8 200px\uFF0C\u907F\u514D\u4E00\u5F20\u7AD6\u6784\u56FE\u624B\u673A\u622A\u56FE\u628A\u6574\u7BC7\u6587\u7AE0\u63A8\u5230\u5C4F\u5E55\u5916\u3002 */
.dshgn_imgRow{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.dshgn_imgOpen{cursor:zoom-in}
/* \u5199\u4E86\u5C3A\u5BF8\u7684\u56FE\u6309\u5199\u7684\u6765\uFF1Aobject-fit \u4FDD\u6301\u6BD4\u4F8B\uFF0C\u4E0D\u8981\u88AB\u7F29\u7565\u56FE\u90A3\u6761 max-height \u538B\u6241\u3002 */
.dshgn_imgSized{object-fit:contain}
    .dshgn_img{max-width:100%;max-height:200px;border-radius:8px;object-fit:contain;
  border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-interactive-bg-hover)}
/* \u653E\u5927\u67E5\u770B\uFF1A\u906E\u7F69\u538B\u6697\u5230\u63A5\u8FD1\u5168\u9ED1\uFF0C\u8BA9\u56FE\u672C\u8EAB\u6210\u4E3A\u552F\u4E00\u4EAE\u7684\u4E1C\u897F\u3002
   z-index \u6BD4\u4E8C\u6B21\u786E\u8BA4\u5F39\u7A97\uFF0870\uFF09\u9AD8\u4E00\u6863\u2014\u2014\u7528\u6237\u662F\u5728\u770B\u56FE\u7684\u9014\u4E2D\uFF0C\u4E0D\u8BE5\u88AB\u9762\u677F\u81EA\u5DF1\u7684
   \u6D6E\u5C42\u76D6\u4F4F\uFF1B\u540C\u65F6\u6BD4 toast\uFF0820\uFF09\u9AD8\uFF0C\u907F\u514D\u300C\u5DF2\u590D\u5236\u300D\u8FD9\u7C7B\u63D0\u793A\u98D8\u5728\u56FE\u4E0A\u3002 */
.dshgn_zoomMask{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;
  padding:24px;background:rgba(6,10,18,.82);cursor:zoom-out}
.dshgn_zoomImg{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;cursor:default;
  background:var(--dshgn-surface);box-shadow:0 12px 40px rgba(0,0,0,.45)}
.dshgn_zoomClose{position:absolute;top:14px;right:14px;display:inline-flex;align-items:center;justify-content:center;
  width:28px;height:28px;border:0;border-radius:8px;background:rgba(255,255,255,.14);
  color:#fff;cursor:pointer}
.dshgn_zoomClose:hover{background:rgba(255,255,255,.26)}
/* \u5927\u56FE\u4E4B\u95F4\u5DE6\u53F3\u8D70\uFF1A\u4E00\u7BC7\u7B14\u8BB0\u91CC\u5E38\u6709\u597D\u51E0\u5F20\u56FE\uFF0C\u770B\u5B8C\u4E00\u5F20\u60F3\u63A5\u7740\u770B\u4E0B\u4E00\u5F20\u65F6\u4E0D\u8BE5
   \u5148\u5173\u6389\u3001\u518D\u56DE\u6B63\u6587\u91CC\u627E\u90A3\u5F20\u7F29\u7565\u56FE\u70B9\u5F00\u3002\u8BA1\u6570\u653E\u5728\u6309\u94AE\u4E2D\u95F4\uFF0C\u7528\u6237\u5F97\u77E5\u9053\u8FD8\u5269\u51E0\u5F20\u3002 */
.dshgn_zoomBar{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);
  display:flex;align-items:center;gap:10px;padding:4px 8px;border-radius:999px;
  background:rgba(255,255,255,.14);color:#fff}
.dshgn_zoomStep{appearance:none;display:inline-flex;align-items:center;justify-content:center;
  width:26px;height:26px;border:0;border-radius:50%;background:rgba(255,255,255,.10);
  color:#fff;cursor:pointer}
.dshgn_zoomStep:hover{background:rgba(255,255,255,.26)}
.dshgn_zoomStep:focus-visible{outline:1px solid #fff;outline-offset:1px}
.dshgn_zoomCount{font-size:11px;line-height:1.6;font-variant-numeric:tabular-nums;white-space:nowrap}
/* Obsidian \u53CC\u94FE\uFF1A\u5916\u89C2\u8981\u50CF\u94FE\u63A5\u4F46\u4E0D\u80FD\u771F\u8DF3\uFF08\u5E93\u5185\u8DF3\u8F6C\u7531 JS \u5904\u7406\uFF09\uFF0C\u6240\u4EE5\u7528 button \u800C\u4E0D\u662F a\u3002 */
.dshgn_wikilink{display:inline;padding:0;margin:0;border:0;background:transparent;font:inherit;
  color:var(--dsw-alias-brand-primary);cursor:pointer;text-decoration:none;
  border-bottom:0.5px solid currentColor}
.dshgn_wikilink:hover{color:var(--dsw-alias-brand-primary);border-bottom-color:transparent}
/* \u6307\u5411\u8FD8\u4E0D\u5B58\u5728\u7684\u7B14\u8BB0\uFF1A\u5BBF\u4E3B\u91CC\u4E5F\u662F\u6697\u4E00\u6863 + \u865A\u4E0B\u5212\u7EBF\uFF0C\u4E00\u773C\u5206\u5F97\u51FA\u54EA\u4E9B\u8FD8\u6CA1\u5199\u3002
   \u53EA\u6539\u5916\u89C2\uFF0C\u70B9\u4E86\u4ECD\u4F1A\u8D70\u539F\u6765\u90A3\u6761\u8DEF\u62A5\u4E00\u53E5\u300C\u5E93\u91CC\u627E\u4E0D\u5230\u300D\u3002 */
.dshgn_wikilinkDead{color:var(--dsw-alias-label-tertiary);border-bottom-style:dashed}
.dshgn_wikilinkDead:hover{color:var(--dsw-alias-label-secondary);border-bottom-color:currentColor}
/* \u6B63\u6587\u91CC\u7684 #\u6807\u7B7E\uFF1A\u5F62\u72B6\u8DDF\u7B14\u8BB0\u5934\u5C5E\u6027\u533A\u90A3\u51E0\u9897\u80F6\u56CA\u4E00\u81F4\uFF0C\u8BA9\u4EBA\u4E00\u773C\u770B\u51FA\u300C\u8FD9\u662F\u6807\u7B7E\uFF0C
   \u4E0D\u662F\u6B63\u6587\u91CC\u7684\u4E00\u4E2A\u4E95\u53F7\u300D\u3002span \u4E0E button \u5171\u7528\u8FD9\u5957\u6837\u5F0F\uFF0C\u524D\u8005\u53EA\u4E0A\u8272\u3002 */
.dshgn_inlineTag{display:inline;padding:0 4px;margin:0 1px;border:0;border-radius:6px;
  background:rgba(var(--dshgn-tintRgb),.1);font:inherit;font-size:.94em;
  color:var(--dsw-alias-brand-primary);text-decoration:none;white-space:nowrap}
button.dshgn_inlineTag{cursor:pointer}
button.dshgn_inlineTag:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}
/* \u5D4C\u5165\u7684\u975E\u56FE\u7247\u9644\u4EF6\uFF08![[x.pdf]] \u8FD9\u7C7B\uFF09\uFF1A\u53EA\u663E\u793A\u6210\u4E00\u9897\u6587\u4EF6\u540D\u80F6\u56CA\uFF0C\u70B9\u4E0D\u5F00\u4E5F\u4E0D\u5047\u88C5\u80FD\u70B9\u3002 */
.dshgn_embed{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;
  border-radius:10px;border:0.5px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-interactive-bg-hover);font-size:11px;
  color:var(--dsw-alias-label-secondary);white-space:nowrap;vertical-align:middle}
.dshgn_embedFile{font-size:11px;color:var(--dsw-alias-label-tertiary)}
/* \u5D4C\u5165\u7684\u53E6\u4E00\u7BC7\u7B14\u8BB0\uFF1A\u5DE6\u8FB9\u4E00\u9053\u7AD6\u7EBF\u628A\u5B83\u548C\u8FD9\u4E00\u7BC7\u7684\u6B63\u6587\u5206\u5F00\uFF0C\u770B\u8D77\u6765\u50CF\u300C\u5F15\u7528\u4E86\u4E00\u6BB5\u300D\u3002 */
.dshgn_noteEmbed{display:block;margin:8px 0;padding:6px 10px;border-left:2px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-interactive-bg-hover);border-radius:0 8px 8px 0}
.dshgn_embedHead{display:flex;align-items:center;gap:5px;margin-bottom:4px;
  color:var(--dsw-alias-label-tertiary)}
.dshgn_embedTitle{appearance:none;border:0;background:transparent;padding:0;font:inherit;
  font-size:11px;font-weight:600;color:var(--dsw-alias-brand-primary);cursor:pointer;
  max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_embedTitle:hover{text-decoration:underline}
.dshgn_embedBody{font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.dshgn_embedEmpty{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dshgn_noteDrop{position:relative}
.dshgn_statGrid{display:flex;flex-wrap:wrap;gap:8px}
.dshgn_stat{display:flex;flex-direction:column;gap:1px;padding:7px 11px;border-radius:8px;
  background:var(--dsw-alias-interactive-bg-hover);min-width:66px}
.dshgn_statNum{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);
  font-variant-numeric:tabular-nums}
.dshgn_statLabel{font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.dshgn_moment{display:flex;gap:10px;padding:5px 0;font-size:12px;line-height:1.65;
  border-bottom:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_moment:last-child{border-bottom:0}
.dshgn_momentAt{flex:none;width:44px;font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-brand-primary);cursor:pointer;font-size:11px}
.dshgn_momentAt:hover{text-decoration:underline}
.dshgn_banner{display:flex;flex-direction:column;gap:8px;padding:14px;border-radius:10px;
  border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);text-align:center;
  align-items:center}
/* \u8B66\u544A\u578B\u6A2A\u5E45\uFF1A\u5DE6\u5BF9\u9F50\u3001\u5E26\u8272\u8FB9\u3002\u7528\u4E8E\u300CKey \u88AB\u62D2\u300D\u8FD9\u7C7B\u8981\u7528\u6237\u52A8\u624B\u5904\u7406\u7684\u63D0\u793A\uFF0C
   \u5C45\u4E2D\u7684\u7A7A\u72B6\u6001\u6837\u5F0F\u4F1A\u8BA9\u5B83\u770B\u8D77\u6765\u50CF\u666E\u901A\u8BF4\u660E\u6587\u5B57\u800C\u88AB\u5212\u8FC7\u53BB\u3002 */
.dshgn_bannerWarn{align-items:stretch;text-align:left;
  border-left:3px solid var(--dsw-alias-state-warn-primary)}
.dshgn_bannerTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dshgn_bannerWarn .dshgn_bannerTitle{color:var(--dsw-alias-state-warn-primary)}
.dshgn_bannerDesc{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}

/* \u2550\u2550 \u4E09\u680F\u914D\u8272\uFF1A\u6DF1\u84DD \u2192 \u6D45\u84DD \u2192 \u6781\u6D45\u8FD1\u767D\u84DD \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   \u505A\u6CD5\uFF1A\u4E0D\u6539\u6BCF\u4E2A\u7EC4\u4EF6\u91CC\u7684 token \u7528\u6CD5\uFF0C\u800C\u662F\u5728\u5404\u680F\u5BB9\u5668\u4E0A**\u5C40\u90E8\u91CD\u5B9A\u4E49** --dsw-alias-*
   \u53D8\u91CF\u3002\u81EA\u5B9A\u4E49\u5C5E\u6027\u6CBF DOM \u7EE7\u627F\uFF0C\u4E8E\u662F\u8FD9\u4E00\u680F\u91CC\u6240\u6709\u7528 token \u7684\u5B57\u8272/\u5E95\u8272/\u8FB9\u6846\u8272\u4F1A
   \u81EA\u52A8\u8DDF\u7740\u53D8\uFF0C\u53EA\u6709\u771F\u6B63\u9700\u8981\u300C\u6362\u4E00\u79CD\u989C\u8272\u300D\u7684\u5730\u65B9\u624D\u5199\u663E\u5F0F\u89C4\u5219\u3002
   \u597D\u5904\uFF1A\u4EE5\u540E\u8C03\u8272\u53EA\u6539\u8FD9\u91CC\u4E00\u7EC4\u53D8\u91CF\uFF0C\u4E0D\u4F1A\u6F0F\u6389\u67D0\u4E2A\u8FD8\u5728\u7528\u65E7 token \u7684\u89D2\u843D\u3002 */
.dshgn_root{
  /* \u5DE6\u680F\uFF08\u76EE\u5F55\u6811\uFF09\uFF1A\u5F88\u6DF1\u7684\u84DD */
  --dshgn-deep:#0a2a52;
  --dshgn-deep2:#071d3b;
  /* \u6DF1\u84DD\u533A\u4E00\u5F8B\u767D\u5B57\uFF1A\u7528\u6237\u660E\u786E\u8981\u6C42\u300C\u6240\u6709\u8FD9\u79CD\u6DF1\u5EA6\u7684\u84DD\u8272\u533A\u57DF\u5185\u7684\u5B57\u4F53\u989C\u8272\u90FD\u6539\u4E3A\u767D\u8272\u300D\u3002
     \u4E4B\u524D\u7528 hslToHex(hue,\u2026) \u63A8\u5BFC\u6D45\u8272\u5B57\uFF0C\u6362\u4E3B\u9898\u8272\u65F6\u4F1A\u504F\u6210\u6DE1\u7EFF/\u6DE1\u7C89\uFF0C\u767D\u5B57\u6700\u7A33\u3002 */
  --dshgn-deepFg:#ffffff;
  --dshgn-deepFg2:rgba(255,255,255,.86);
  --dshgn-deepFg3:rgba(255,255,255,.66);
  /* \u4E2D\u680F\uFF08\u7B14\u8BB0\u5217\u8868\uFF09\uFF1A\u6D45\u4E00\u70B9\u7684\u84DD */
  --dshgn-mid:#c5daf3;
  --dshgn-mid2:#b6cfee;
  --dshgn-midFg:#102a45;
  --dshgn-midFg2:#3d5c7e;
  --dshgn-midFg3:#5d7c9d;
  /* \u53F3\u680F\uFF08\u9605\u8BFB\u533A\uFF09\uFF1A\u5F88\u6D45\u5F88\u6D45\u3001\u63A5\u8FD1\u767D\u7684\u84DD */
  --dshgn-light:#f7fbff;
  --dshgn-light2:#eef6ff;
  --dshgn-lightFg:#16283c;
  --dshgn-lightFg2:#40586f;
  --dshgn-lightFg3:#6b8298;
  /* \u5F3A\u8C03\u8272\uFF1A\u6DF1\u680F\u4E0A\u8981\u591F\u4EAE\uFF0C\u6D45\u680F\u4E0A\u8981\u591F\u6C89 */
  --dshgn-accentOnDark:#7fb8ff;
  --dshgn-accentOnLight:#1f6fb8;
  --dshgn-lineOnDark:rgba(255,255,255,.13);
  --dshgn-lineOnLight:rgba(var(--dshgn-tintRgb),.13);
  /* \u9ED8\u8BA4\u4E3B\u9898\u8272\u7684 RGB \u5206\u91CF\u3002\u6240\u6709\u534A\u900F\u660E\u63CF\u8FB9/\u9634\u5F71/\u60AC\u6D6E\u5E95\u8272\u90FD\u7531\u5B83\u63A8\u5BFC\uFF0C
     \u8FD9\u6837\u300C\u81EA\u5B9A\u4E49\u4E3B\u9898\u8272\u300D\u53EA\u9700\u8981\u8986\u76D6\u8FD9\u4E00\u4E2A\u503C + \u4E0A\u9762\u90A3\u6279\u8272\u677F\uFF0C
     \u6563\u843D\u5728 18 \u5904\u7684 rgba(10,42,82,\u2026) \u4F1A\u81EA\u52A8\u8DDF\u7740\u53D8\u3002 */
  --dshgn-tintRgb:10,42,82;
  --dshgn-btnFill:#2f7fd4;
  --dshgn-btnHover:#3d90e8;
  --dshgn-btnFillSoft:#7fa9d0;
  --dshgn-btnHoverSoft:#6b99c4;
  --dshgn-btnFillPale:#a8c6e4;
  --dshgn-btnHoverPale:#96badd;
  /* \u5361\u7247/\u5F39\u5C42/\u8F93\u5165\u6846\u7684\u5B9E\u5E95\u8272\u3002\u6D45\u8272\u662F\u7EAF\u767D\uFF0C\u6DF1\u8272\u7531 themeVars \u6362\u6210\u6DF1\u7070\u3002 */
  --dshgn-surface:#ffffff;
  --dshgn-surfaceStrong:#ffffff;
  --dshgn-overlayMask:rgba(4,12,24,.42);
}

/* \u2500\u2500 \u9876\u680F\uFF1A\u4E0E\u53F3\u680F\u540C\u8272\u7CFB\uFF0C\u538B\u4E00\u6761\u6D45\u84DD\u5206\u9694 \u2500\u2500 */
.dshgn_head{
  background:linear-gradient(180deg,var(--dshgn-light) 0%,var(--dshgn-light2) 100%);
  border-bottom:1px solid var(--dshgn-lineOnLight);
  color:var(--dshgn-lightFg);
  --dsw-alias-label-primary:var(--dshgn-lightFg);
  --dsw-alias-label-secondary:var(--dshgn-lightFg2);
  --dsw-alias-label-tertiary:var(--dshgn-lightFg3);
  --dsw-alias-label-dimmed:var(--dshgn-lightFg3);
  --dsw-alias-border-l2:var(--dshgn-lineOnLight);
  --dsw-alias-interactive-bg-hover:rgba(var(--dshgn-tintRgb),.07);
  --dsw-alias-interactive-bg-hover-accent:rgba(31,111,184,.16);
  --dsw-alias-bg-overlay:var(--dshgn-surface);
  --dsw-alias-brand-primary:var(--dshgn-accentOnLight);
}
.dshgn_tabs{background:rgba(var(--dshgn-tintRgb),.07);border-radius:10px}
.dshgn_tab[data-on="true"]{background:var(--dshgn-surface);box-shadow:0 1px 3px rgba(var(--dshgn-tintRgb),.14)}

/* \u2500\u2500 \u5DE6\u680F\uFF1A\u6DF1\u84DD\u3002\u6574\u680F\u7528\u4E0A\u6DF1\u4E0B\u66F4\u6DF1\u7684\u6E10\u53D8\uFF0C\u8FB9\u754C\u9760\u4E00\u6761\u4EAE\u7EBF\u6536\u4F4F \u2500\u2500 */
.dshgn_tree{
  width:var(--dshgn-treeW,204px);
  background:linear-gradient(180deg,var(--dshgn-deep) 0%,var(--dshgn-deep2) 100%);
  color:var(--dshgn-deepFg);
  border-right:1px solid rgba(0,0,0,.28);
  box-shadow:inset -1px 0 0 rgba(255,255,255,.06);
  scrollbar-color:rgba(255,255,255,.24) transparent;
  /* \u5C40\u90E8\u628A\u4E3B\u9898 token \u7FFB\u6210\u300C\u6DF1\u5E95\u6D45\u5B57\u300D\uFF0C\u680F\u5185\u4E00\u5207 token \u7528\u6CD5\u81EA\u52A8\u8DDF\u968F */
  --dsw-alias-label-primary:var(--dshgn-deepFg);
  --dsw-alias-label-secondary:var(--dshgn-deepFg2);
  --dsw-alias-label-tertiary:var(--dshgn-deepFg3);
  --dsw-alias-label-dimmed:var(--dshgn-deepFg3);
  --dsw-alias-label-primary-foreground:#08182c;
  --dsw-alias-border-l1:var(--dshgn-lineOnDark);
  --dsw-alias-border-l2:var(--dshgn-lineOnDark);
  --dsw-alias-interactive-bg-hover:rgba(255,255,255,.09);
  --dsw-alias-interactive-bg-hover-accent:rgba(255,255,255,.17);
  --dsw-alias-interactive-bg-active:rgba(255,255,255,.22);
  --dsw-alias-brand-primary:var(--dshgn-accentOnDark);
  --dsw-alias-button-primary-fill:var(--dshgn-btnFill);
  --dsw-alias-button-primary-hover:var(--dshgn-btnHover);
}
/* \u680F\u5185\u5C0F\u6807\u9898\uFF08\u76EE\u5F55/\u6807\u7B7E\uFF09\uFF1A\u52A0\u5B57\u8DDD\uFF0C\u50CF\u4FA7\u8FB9\u680F\u5206\u7EC4 */
.dshgn_tree .dshgn_treeHead{
  margin-top:6px;padding-top:9px;border-top:1px solid rgba(255,255,255,.09);
  letter-spacing:.06em;text-transform:uppercase;font-size:10px;
}
.dshgn_tree .dshgn_treeRow[data-on="true"]{box-shadow:inset 2px 0 0 var(--dshgn-accentOnDark)}
.dshgn_tree .dshgn_treeCount{
  min-width:18px;text-align:center;padding:0 4px;border-radius:8px;
  background:rgba(255,255,255,.11);font-size:10px;line-height:15px;
}
.dshgn_tree .dshgn_tagRow{
  background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.12);
}
.dshgn_tree .dshgn_tagRow:hover{background:rgba(255,255,255,.15)}
.dshgn_tree .dshgn_tagRow[data-on="true"]{
  background:var(--dshgn-accentOnDark);border-color:transparent;color:#08182c;font-weight:600;
}
/* \u6807\u9898\u884C\u53F3\u4FA7\u7684\u52A8\u4F5C\u7EC4\uFF1A\u6392\u5E8F + \u300C+\u300D\u3002
   \u7528 flex:1 \u7684 spacer \u628A\u52A8\u4F5C\u63A8\u5230\u6700\u53F3\uFF0C\u4E0E\u6807\u9898\u6587\u5B57\u4E4B\u95F4\u7559\u51FA\u8DDD\u79BB\u2014\u2014\u7D27\u8D34\u6807\u9898
   \u4F1A\u8BA9\u5B83\u770B\u8D77\u6765\u50CF\u6807\u9898\u7684\u4E00\u90E8\u5206\uFF0C\u7528\u6237\u4E0D\u4F1A\u60F3\u5230\u90A3\u662F\u4E2A\u6309\u94AE\u3002 */
.dshgn_treeHeadRight{display:flex;align-items:center;gap:2px;flex:none;margin-left:auto}
.dshgn_treeHeadTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.dshgn_treeSort,
.dshgn_treeAdd{
  display:inline-flex;align-items:center;justify-content:center;
  height:18px;min-width:18px;padding:0 4px;border:0;border-radius:5px;
  background:transparent;color:var(--dsw-alias-label-tertiary);
  font:inherit;font-size:9px;line-height:1;cursor:pointer;
  letter-spacing:0;text-transform:none;
}
.dshgn_treeSort:hover,
.dshgn_treeAdd:hover{background:rgba(255,255,255,.14);color:var(--dsw-alias-label-primary)}
.dshgn_treeSort:focus-visible,
.dshgn_treeAdd:focus-visible{outline:1px solid var(--dshgn-accentOnDark);outline-offset:1px}
/* \u65B0\u5EFA\u76EE\u5F55 / \u6807\u7B7E\u7684\u8F93\u5165\u884C */
.dshgn_treeNew{display:flex;align-items:center;gap:3px;padding:2px 4px 4px}
.dshgn_treeNewInput{
  flex:1;min-width:0;height:22px;padding:0 6px;border-radius:6px;
  border:0.5px solid var(--dsw-alias-border-l2);background:rgba(0,0,0,.22);
  color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;outline:none;
}
.dshgn_treeNewInput::placeholder{color:var(--dsw-alias-label-dimmed)}
.dshgn_treeNewInput:focus{border-color:var(--dshgn-accentOnDark)}
.dshgn_treeNewOk,
.dshgn_treeNewCancel{
  display:inline-flex;align-items:center;justify-content:center;flex:none;
  width:20px;height:22px;border:0;border-radius:6px;background:transparent;
  color:var(--dsw-alias-label-tertiary);cursor:pointer;
}
.dshgn_treeNewOk:hover{background:rgba(255,255,255,.16);color:var(--dsw-alias-label-primary)}
.dshgn_treeNewCancel:hover{background:rgba(255,255,255,.16);color:var(--dsw-alias-state-error-primary)}
/* \u884C\u5185\u5220\u9664/\u53D6\u6D88\uFF1A\u753B\u5728\u88AB\u53F3\u952E\u7684\u90A3\u4E00\u884C\u91CC\u63A5\u66FF\u8BA1\u6570\u5FBD\u7AE0\u7684\u4F4D\u7F6E\u3002
   \u4E0D\u518D\u7528 position:fixed \u7684\u6D6E\u5C42\u2014\u2014.dshgn_body \u6302\u7740 animation ... both\uFF0C
   \u52A8\u753B\u64AD\u5B8C\u540E transform \u4ECD\u7559\u7740\uFF0C\u5E26 transform \u7684\u7956\u5148\u4F1A\u6210\u4E3A fixed \u7684\u5305\u542B\u5757\uFF0C
   \u83DC\u5355\u7684\u5750\u6807\u57FA\u51C6\u4ECE\u89C6\u53E3\u53D8\u6210 .dshgn_body \u7684\u5DE6\u4E0A\u89D2\uFF0C\u4E8E\u662F\u98D8\u5230\u5F88\u8FDC\u7684\u5730\u65B9\u3002 */
.dshgn_rowMenu{display:inline-flex;align-items:center;gap:2px;flex:none}
.dshgn_rowBtn{
  display:inline-flex;align-items:center;gap:3px;height:18px;padding:0 5px;
  border:0;border-radius:5px;background:transparent;font:inherit;font-size:10px;
  line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer;
}
.dshgn_rowBtn:hover{background:rgba(255,255,255,.18);color:var(--dsw-alias-label-primary)}
.dshgn_rowBtnDanger{color:var(--dsw-alias-state-error-primary)}
.dshgn_rowBtnDanger:hover{background:rgba(255,255,255,.18);color:var(--dsw-alias-state-error-primary)}
/* \u6807\u7B7E\u9879\u5916\u5C42\uFF1A\u7ED9\u884C\u5185\u83DC\u5355\u7559\u4F4D\u7F6E\uFF0C\u540C\u65F6\u907F\u514D button \u5957 button */
.dshgn_tagWrap{display:inline-flex;align-items:center;gap:2px;max-width:100%;min-width:0}
/* \u6807\u7B7E\u533A\u662F flex-wrap \u5BB9\u5668\uFF0C\u6539\u540D\u8F93\u5165\u884C\u5FC5\u987B\u81EA\u5DF1\u5360\u6EE1\u4E00\u6574\u884C\uFF0C
   \u5426\u5219\u5B83\u4F1A\u6324\u5728\u4E0A\u4E00\u4E2A\u6807\u7B7E\u53F3\u8FB9\uFF0C\u8F93\u5165\u6846\u88AB\u538B\u6210\u51E0\u5341\u50CF\u7D20\u5BBD\u3002 */
.dshgn_treeTags .dshgn_treeNew{width:100%;margin:0 0 4px;box-sizing:border-box}
/* \u4E8C\u6B21\u786E\u8BA4\u5F39\u7A97\uFF1A\u906E\u4F4F\u6574\u4E2A\u9762\u677F\uFF0C\u907F\u514D\u7528\u6237\u8BEF\u70B9\u80CC\u540E\u7684\u4E1C\u897F */
.dshgn_modalMask{
  position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;
  padding:24px;background:var(--dshgn-overlayMask);
}
.dshgn_modal{
  width:100%;max-width:320px;padding:16px 18px;border-radius:12px;
  border:0.5px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-overlay);box-shadow:var(--dsw-alias-elevation-prominent);
  display:flex;flex-direction:column;gap:10px;
}
.dshgn_modalTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dshgn_modalBody{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary);word-break:break-word}
.dshgn_modalActions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}
/* \u5FEB\u6377\u952E\u901F\u67E5\u8868\uFF1A\u4E24\u5217\uFF08\u952E\u4F4D + \u5E72\u4EC0\u4E48\uFF09\uFF0C\u952E\u4F4D\u7528\u7B49\u5BBD\u5B57\u5BF9\u9F50\uFF0C\u626B\u4E00\u773C\u5C31\u627E\u5F97\u5230 */
.dshgn_helpModal{width:100%;max-width:420px;max-height:min(70vh,520px);overflow:auto}
.dshgn_helpHint{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.dshgn_helpList{display:flex;flex-direction:column;gap:2px}
.dshgn_helpRow{display:flex;align-items:baseline;gap:10px;padding:3px 0}
.dshgn_helpKeys{flex:none;min-width:104px;display:inline-flex;flex-wrap:wrap;gap:3px}
.dshgn_helpKey{display:inline-block;padding:0 5px;border:0.5px solid var(--dsw-alias-border-l2);
  border-radius:4px;background:var(--dsw-alias-interactive-bg-hover);
  font-family:var(--font-monospace,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);
  font-size:10px;line-height:1.7;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dshgn_helpWhat{min-width:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}

/* \u2500\u2500 \u4E2D\u680F\uFF1A\u6D45\u84DD\u3002\u7559\u4E00\u6761\u7A0D\u6DF1\u7684\u53F3\u8FB9\u7EBF\u628A\u5B83\u548C\u9605\u8BFB\u533A\u533A\u5206\u5F00 \u2500\u2500 */
.dshgn_list{
  width:272px;
  background:linear-gradient(180deg,var(--dshgn-mid) 0%,var(--dshgn-mid2) 100%);
  color:var(--dshgn-midFg);
  border-right:1px solid rgba(var(--dshgn-tintRgb),.16);
  scrollbar-color:rgba(var(--dshgn-tintRgb),.26) transparent;
  --dsw-alias-label-primary:var(--dshgn-midFg);
  --dsw-alias-label-secondary:var(--dshgn-midFg2);
  --dsw-alias-label-tertiary:var(--dshgn-midFg3);
  --dsw-alias-label-dimmed:var(--dshgn-midFg3);
  --dsw-alias-label-primary-foreground:#ffffff;
  --dsw-alias-border-l1:var(--dshgn-lineOnLight);
  --dsw-alias-border-l2:var(--dshgn-lineOnLight);
  --dsw-alias-interactive-bg-hover:rgba(var(--dshgn-tintRgb),.09);
  --dsw-alias-interactive-bg-hover-accent:rgba(var(--dshgn-tintRgb),.16);
  --dsw-alias-bg-overlay:var(--dshgn-surface);
  --dsw-alias-brand-primary:var(--dshgn-accentOnLight);
  --dsw-alias-button-primary-fill:var(--dshgn-btnFill);
  --dsw-alias-button-primary-hover:var(--dshgn-btnHover);
}
.dshgn_list .dshgn_searchWrap{border-bottom-color:rgba(var(--dshgn-tintRgb),.14)}
.dshgn_list .dshgn_search{
  background:var(--dshgn-surfaceStrong);border-color:rgba(var(--dshgn-tintRgb),.16);
}
.dshgn_list .dshgn_search::placeholder{color:var(--dshgn-midFg3)}
.dshgn_list .dshgn_card{border-radius:9px;margin-bottom:2px}
.dshgn_list .dshgn_card[data-on="true"]{
  background:var(--dshgn-surface);box-shadow:0 1px 4px rgba(var(--dshgn-tintRgb),.14);
  border-left-color:var(--dshgn-accentOnLight);
}
.dshgn_list .dshgn_cardTitle{font-weight:500}

/* \u2500\u2500 \u53F3\u680F\uFF1A\u6781\u6D45\u8FD1\u767D\u84DD \u2500\u2500 */
.dshgn_note{
  background:var(--dshgn-light);
  color:var(--dshgn-lightFg);
  --dsw-alias-label-primary:var(--dshgn-lightFg);
  --dsw-alias-label-secondary:var(--dshgn-lightFg2);
  --dsw-alias-label-tertiary:var(--dshgn-lightFg3);
  --dsw-alias-label-dimmed:var(--dshgn-lightFg3);
  /* \u540C .dshgn_pane\uFF1A\u64AD\u653E\u6309\u94AE\u3001\u4E3B\u6309\u94AE\u8FD9\u7C7B\u6DF1\u84DD\u586B\u5145\u4E0A\u7684\u5B57\u5FC5\u987B\u662F\u767D\u7684\u3002 */
  --dsw-alias-label-primary-foreground:#ffffff;
  --dsw-alias-border-l1:var(--dshgn-lineOnLight);
  --dsw-alias-border-l2:var(--dshgn-lineOnLight);
  --dsw-alias-interactive-bg-hover:rgba(var(--dshgn-tintRgb),.055);
  --dsw-alias-interactive-bg-hover-accent:rgba(var(--dshgn-tintRgb),.14);
  --dsw-alias-bg-overlay:var(--dshgn-surface);
  --dsw-alias-brand-primary:var(--dshgn-accentOnLight);
  --dsw-alias-button-primary-fill:var(--dshgn-btnFill);
  --dsw-alias-button-primary-hover:var(--dshgn-btnHover);
  scrollbar-color:rgba(var(--dshgn-tintRgb),.22) transparent;
}
.dshgn_note .dshgn_noteHead{background:var(--dshgn-light2)}
.dshgn_note .dshgn_md{font-size:13.5px;line-height:1.8}
.dshgn_note .dshgn_md .dshgn_pre{background:rgba(var(--dshgn-tintRgb),.08)}
.dshgn_note .dshgn_md .dshgn_table th{background:rgba(var(--dshgn-tintRgb),.10)}
.dshgn_note .dshgn_md .dshgn_h2{border-bottom-color:rgba(var(--dshgn-tintRgb),.14)}

/* \u2500\u2500 \u5176\u5B83\u9875\u7B7E\uFF08\u4E91\u7AEF/\u540C\u6B65/\u8BBE\u7F6E\uFF09\uFF1A\u6574\u9875\u7528\u6781\u6D45\u84DD\uFF0C\u5361\u7247\u7EAF\u767D \u2500\u2500 */
.dshgn_pane{
  background:linear-gradient(180deg,var(--dshgn-light) 0%,var(--dshgn-light2) 100%);
  color:var(--dshgn-lightFg);
  --dsw-alias-label-primary:var(--dshgn-lightFg);
  --dsw-alias-label-secondary:var(--dshgn-lightFg2);
  --dsw-alias-label-tertiary:var(--dshgn-lightFg3);
  --dsw-alias-label-dimmed:var(--dshgn-lightFg3);
  /* \u6DF1\u84DD\u586B\u5145\u4E0A\u7684\u5B57\u4E00\u5F8B\u767D\uFF1A\u4E3B\u6309\u94AE\u3001\u9009\u4E2D\u7684 chip\u3001\u9009\u4E2D\u7684\u77E5\u8BC6\u5E93\u90FD\u662F\u6DF1\u8272\u5E95\uFF0C
     \u6CA1\u8FD9\u4E00\u884C\u5B83\u4EEC\u5C31\u843D\u5230\u5E94\u7528\u9ED8\u8BA4\u7684\u6DF1\u8272\u524D\u666F\u8272\u4E0A\u2014\u2014\u767D\u5E95\u9875\u9762\u91CC\u770B\u7740\u8FD8\u51D1\u5408\uFF0C
     \u4E00\u65E6\u6309\u94AE\u88AB\u586B\u6210\u6DF1\u84DD\u5C31\u53D8\u6210\u300C\u6DF1\u5B57\u538B\u6DF1\u5E95\u300D\uFF0C\u51E0\u4E4E\u8BFB\u4E0D\u51FA\u6765\u3002 */
  --dsw-alias-label-primary-foreground:#ffffff;
  --dsw-alias-border-l1:var(--dshgn-lineOnLight);
  --dsw-alias-border-l2:var(--dshgn-lineOnLight);
  --dsw-alias-interactive-bg-hover:rgba(var(--dshgn-tintRgb),.055);
  --dsw-alias-interactive-bg-hover-accent:rgba(var(--dshgn-tintRgb),.14);
  --dsw-alias-bg-overlay:var(--dshgn-surface);
  --dsw-alias-brand-primary:var(--dshgn-accentOnLight);
  --dsw-alias-button-primary-fill:var(--dshgn-btnFill);
  --dsw-alias-button-primary-hover:var(--dshgn-btnHover);
}
.dshgn_pane .dshgn_section{box-shadow:0 1px 2px rgba(var(--dshgn-tintRgb),.06)}
.dshgn_pane .dshgn_input,.dshgn_pane .dshgn_textarea{background:var(--dshgn-surface)}
.dshgn_pane .dshgn_log{background:rgba(var(--dshgn-tintRgb),.06)}
.dshgn_pane .dshgn_stat{background:rgba(var(--dshgn-tintRgb),.08)}
.dshgn_root{background:var(--dshgn-light)}

/* \u6DF1\u8272\u680F\u91CC\u7684\u6EDA\u52A8\u6761\uFF08WebKit \u4E0D\u8BA4 scrollbar-color\uFF09 */
.dshgn_tree::-webkit-scrollbar,.dshgn_list::-webkit-scrollbar,
.dshgn_note .dshgn_scroll::-webkit-scrollbar,.dshgn_pane::-webkit-scrollbar{width:9px;height:9px}
.dshgn_tree::-webkit-scrollbar-thumb{background:rgba(255,255,255,.22);border-radius:5px}
.dshgn_list::-webkit-scrollbar-thumb{background:rgba(var(--dshgn-tintRgb),.24);border-radius:5px}
.dshgn_note .dshgn_scroll::-webkit-scrollbar-thumb,
.dshgn_pane::-webkit-scrollbar-thumb{background:rgba(var(--dshgn-tintRgb),.18);border-radius:5px}
.dshgn_tree::-webkit-scrollbar-track,.dshgn_list::-webkit-scrollbar-track,
.dshgn_note .dshgn_scroll::-webkit-scrollbar-track,.dshgn_pane::-webkit-scrollbar-track{background:transparent}
`;
function injectCssInto(doc) {
  if (!doc || doc.getElementById(STYLE_ID) !== null) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(style);
}
function injectCss() {
  for (const doc of panelDocuments()) injectCssInto(doc);
  return () => {
  };
}
var pendingAttach = /* @__PURE__ */ new Set();
var pendingSync = /* @__PURE__ */ new Set();
function attachOnPanelWindows(type, fn2, capture) {
  const done = /* @__PURE__ */ new Set();
  const apply = () => {
    for (const win of panelWindows()) {
      if (done.has(win)) continue;
      done.add(win);
      win.addEventListener(type, fn2, capture);
    }
  };
  apply();
  pendingAttach.add(apply);
  return () => {
    pendingAttach.delete(apply);
    for (const win of done) win.removeEventListener(type, fn2, capture);
    done.clear();
  };
}
function registerPanelRoot(el) {
  if (!el) return;
  panelRoots.add(el);
  injectCssInto(el.ownerDocument);
  for (const apply of Array.from(pendingAttach)) apply();
  for (const sync of Array.from(pendingSync)) sync();
}
function PanelIcon(props) {
  const size = props && typeof props.size === "number" ? props.size : 18;
  const active = props && props.active === true;
  return h4(Icon, { name: "brain", size, className: active ? "dshgn_sideIcon dshgn_sideIconOn" : "dshgn_sideIcon" });
}
function GetnotePage() {
  const [locale, setLocale] = h2(() => activeUiLocale());
  setUiLocale(locale);
  const t4 = T2(() => makeT(), [locale]);
  const [bootSession] = h2(() => readSession());
  const [tab, setTab] = h2(bootSession.tab === "" ? "notes" : bootSession.tab);
  const [status, setStatus] = h2(null);
  const [tree, setTree] = h2(null);
  const [entries, setEntries] = h2([]);
  const [dirs, setDirs] = h2([]);
  const [query, setQuery] = h2("");
  const [activeDir, setActiveDir] = h2(bootSession.dir);
  const [activeTag, setActiveTag] = h2(bootSession.tag);
  const makeSortPref = (key) => {
    const read = () => {
      try {
        const saved = window.localStorage.getItem(key);
        if (saved === "name" || saved === "count" || saved === "time") return saved;
      } catch {
      }
      return "time";
    };
    const write = (next) => {
      try {
        window.localStorage.setItem(key, next);
      } catch {
      }
    };
    return { read, write };
  };
  const [dirSort, setDirSort] = h2(() => makeSortPref("dshgn.sortDir").read());
  const [tagSort, setTagSort] = h2(() => makeSortPref("dshgn.sortTag").read());
  const [listSort, setListSort] = h2(() => makeSortPref("dshgn.listSort").read());
  const [colWidths, setColWidths] = h2(() => readColWidths());
  const [treeOpen, setTreeOpen] = h2(false);
  const [listLimit, setListLimit] = h2(LIST_PAGE_SIZE);
  const [current, setCurrent] = h2(null);
  const openSeq = A2(0);
  const selfSavedRef = A2(null);
  const [draft, setDraft] = h2(null);
  const [busy, setBusy] = h2(false);
  const [toast, setToast] = h2(null);
  const [error2, setError] = h2(null);
  const [pendingAnchor, setPendingAnchor] = h2(null);
  const anchorSeq = A2(0);
  const [refreshState, setRefreshState] = h2("idle");
  const refreshTimer = A2(null);
  const refreshSpinTimer = A2(null);
  const refreshOutcome = A2(null);
  const SPIN_MS = 1400;
  const [themePreview, setThemePreview] = h2(null);
  const [darkTheme, setDarkTheme] = h2(() => isDarkTheme());
  y2(() => {
    const Observer = typeof MutationObserver !== "undefined" ? MutationObserver : typeof window !== "undefined" ? window.MutationObserver : void 0;
    if (typeof Observer !== "function") return void 0;
    const sync = () => setDarkTheme(isDarkTheme());
    const observer = new Observer(sync);
    const observed = /* @__PURE__ */ new Set();
    const attach = () => {
      for (const doc of panelDocuments()) {
        if (!doc || !doc.body || observed.has(doc.body)) continue;
        observed.add(doc.body);
        observer.observe(doc.body, { attributes: true, attributeFilter: ["class"] });
      }
      sync();
    };
    attach();
    pendingSync.add(attach);
    const unsubscribe = subscribeCssChange(sync);
    return () => {
      pendingSync.delete(attach);
      observer.disconnect();
      unsubscribe();
    };
  }, []);
  y2(() => {
    reportStatus({
      count: Array.isArray(entries) ? entries.length : 0,
      note: current !== null ? String(current.title || current.path || "") : ""
    });
  }, [entries, current]);
  const [templatesOpen, setTemplatesOpen] = h2(false);
  const [newDir, setNewDir] = h2("");
  const [newDirAt, setNewDirAt] = h2(null);
  const [newDirIndex, setNewDirIndex] = h2(null);
  const [helpOpen, setHelpOpen] = h2(false);
  const helpOpenRef = A2(false);
  helpOpenRef.current = helpOpen;
  const showToast = q2((text) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 2400);
  }, []);
  const refresh = q2(async () => {
    setError(null);
    setRefreshState("spinning");
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
    if (refreshSpinTimer.current !== null) {
      window.clearTimeout(refreshSpinTimer.current);
      refreshSpinTimer.current = null;
    }
    refreshOutcome.current = null;
    try {
      const [statusJson, treeJson] = await Promise.all([api("/status"), api("/tree")]);
      setStatus(statusJson);
      if ("uiLocale" in statusJson) setLocale(statusJson.uiLocale || null);
      setTree(treeJson.tree || null);
      setEntries(Array.isArray(treeJson.entries) ? treeJson.entries : []);
      setDirs(Array.isArray(treeJson.dirs) ? treeJson.dirs : []);
      refreshOutcome.current = "ok";
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
      refreshOutcome.current = "fail";
    } finally {
      refreshSpinTimer.current = window.setTimeout(() => {
        refreshSpinTimer.current = null;
        const outcome = refreshOutcome.current === "fail" ? "fail" : "ok";
        setRefreshState(outcome);
        refreshTimer.current = window.setTimeout(() => {
          setRefreshState("idle");
          refreshTimer.current = null;
        }, 5e3);
      }, SPIN_MS);
    }
  }, []);
  y2(() => {
    void refresh();
  }, [refresh]);
  y2(() => {
    let alive = true;
    const ping = () => {
      void api("/sync/auto", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ping: true })
      }).catch(() => {
      });
    };
    ping();
    const timer = window.setInterval(() => {
      if (alive) ping();
    }, 2e4);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  const tagCounts = T2(() => {
    const counts = /* @__PURE__ */ new Map();
    for (const entry of entries) {
      for (const tag of entry.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts.entries()].sort((a3, b3) => b3[1] - a3[1]).slice(0, 24);
  }, [entries]);
  const visible = T2(() => {
    const needle = query.trim().toLowerCase();
    const kept = entries.filter((entry) => {
      if (activeDir !== "") {
        if (entry.dir !== activeDir && !entry.path.startsWith(`${activeDir}/`)) return false;
      }
      if (activeTag !== "" && !(entry.tags || []).some((tag) => tag === activeTag || tag.startsWith(`${activeTag}/`))) {
        return false;
      }
      if (needle === "") return true;
      return entry.title.toLowerCase().includes(needle) || entry.path.toLowerCase().includes(needle) || (entry.excerpt || "").toLowerCase().includes(needle) || (entry.tags || []).some((tag) => tag.toLowerCase().includes(needle));
    });
    if (listSort !== "name") return kept;
    return kept.sort((a3, b3) => a3.title.localeCompare(b3.title, "zh"));
  }, [entries, query, activeDir, activeTag, listSort]);
  const [hits, setHits] = h2(null);
  const [searching, setSearching] = h2(false);
  y2(() => {
    const raw = query.trim();
    if (raw === "") {
      setHits(null);
      setSearching(false);
      return void 0;
    }
    setSearching(true);
    let alive = true;
    const timer = window.setTimeout(() => {
      void api(`/search?q=${encodeURIComponent(raw)}&limit=40`).then((json) => {
        if (!alive) return;
        setHits(Array.isArray(json.hits) ? json.hits : []);
        setSearching(false);
      }).catch(() => {
        if (alive) {
          setHits(null);
          setSearching(false);
        }
      });
    }, 220);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);
  const searchMode = query.trim() !== "" && hits !== null;
  const searchTerms = T2(() => searchTermsOf(query), [query]);
  const [suggestAt, setSuggestAt] = h2(null);
  const [suggestIndex, setSuggestIndex] = h2(null);
  const searchTags = T2(() => [...new Set(entries.flatMap((entry) => entry.tags || []))], [entries]);
  const suggestions = T2(() => {
    if (suggestAt === null) return [];
    return searchSuggestions(dirs, searchTags, suggestAt.kind, suggestAt.query);
  }, [dirs, searchTags, suggestAt]);
  const applySuggestion = q2(
    (item) => {
      if (item === null || item === void 0) return;
      const box = findInPanel(".dshgn_search");
      const caret = box !== null && Number.isInteger(box.selectionStart) ? box.selectionStart : query.length;
      const spot = searchSuggestAt(query, caret);
      if (spot === null) return;
      const insert = item.kind === "tag" ? `#${item.value}` : `dir:${item.value}`;
      const head2 = query.slice(0, spot.wordStart);
      const tail = query.slice(caret);
      const next = `${head2}${insert}${tail === "" || tail.startsWith(" ") ? " " : ""}${tail}`;
      setQuery(next);
      setSuggestAt(null);
      setSuggestIndex(null);
    },
    [query]
  );
  const shown = searchMode ? hits : visible;
  const filterKey = `${query}\0${activeDir}\0${activeTag}`;
  const [lastFilterKey, setLastFilterKey] = h2(filterKey);
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey);
    setListLimit(LIST_PAGE_SIZE);
  }
  const shownSlice = shown.length > listLimit ? shown.slice(0, listLimit) : shown;
  const onListScroll = q2(
    (event) => {
      const el = event && event.currentTarget;
      if (!el) return;
      if (el.scrollTop + el.clientHeight < el.scrollHeight - 120) return;
      setListLimit((prev) => prev >= shown.length ? prev : prev + LIST_PAGE_SIZE);
    },
    [shown.length]
  );
  const navRef = A2({ stack: [], index: -1 });
  const navJumpRef = A2(false);
  const [navState, setNavState] = h2({ canBack: false, canForward: false });
  const syncNav = q2(() => {
    const nav = navRef.current;
    setNavState({
      canBack: nav.index > 0,
      canForward: nav.index >= 0 && nav.index < nav.stack.length - 1
    });
  }, []);
  const pushNav = q2(
    (path) => {
      const target = String(path || "");
      if (target === "") return;
      const nav = navRef.current;
      if (nav.index >= 0 && nav.stack[nav.index] === target) {
        syncNav();
        return;
      }
      const stack = nav.stack.slice(0, nav.index + 1);
      stack.push(target);
      const kept = stack.length > NAV_LIMIT ? stack.slice(stack.length - NAV_LIMIT) : stack;
      navRef.current = { stack: kept, index: kept.length - 1 };
      syncNav();
    },
    [syncNav]
  );
  const openNote = q2(
    async (path, toggle = false, reload = false) => {
      const seq = openSeq.current + 1;
      openSeq.current = seq;
      if (!reload && toggle && current !== null && current.path === path) {
        setCurrent(null);
        setDraft(null);
        setError(null);
        return;
      }
      setError(null);
      try {
        const note = await api(`/read?path=${encodeURIComponent(path)}`);
        if (openSeq.current !== seq) return;
        setCurrent(note);
        setDraft(note.content);
        if (navJumpRef.current) navJumpRef.current = false;
        else pushNav(note.path);
      } catch (err) {
        if (openSeq.current !== seq) return;
        setCurrent(null);
        setDraft(null);
        setError(err && err.message ? err.message : String(err));
      }
    },
    [current, pushNav]
  );
  const liveRef = A2({ current: null, draft: null });
  liveRef.current = { current, draft };
  const reloadRef = A2({ path: "", at: 0 });
  y2(() => {
    return subscribeVaultChange((change) => {
      if (change === null || typeof change !== "object") return;
      const path = String(change.path || "");
      if (path === "") return;
      const live = liveRef.current;
      const open = live.current;
      if (open === null || open.path !== path) return;
      if (change.kind === "delete" || change.kind === "rename") {
        openSeq.current += 1;
        setCurrent(null);
        setDraft(null);
        setError(null);
        return;
      }
      const saved = selfSavedRef.current;
      if (saved !== null && saved.path === path) {
        selfSavedRef.current = null;
        return;
      }
      if (live.draft !== null && live.draft !== open.content) return;
      const now = Date.now();
      const last = reloadRef.current;
      if (last.path === path && now - last.at < 1e3) return;
      reloadRef.current = { path, at: now };
      void openNote(path, false, true);
    });
  }, [openNote]);
  const restoredRef = A2(false);
  y2(() => {
    if (restoredRef.current) return;
    if (bootSession.path === "") {
      restoredRef.current = true;
      return;
    }
    if (!Array.isArray(entries) || entries.length === 0) return;
    restoredRef.current = true;
    const hit = entries.find((entry) => entry.path === bootSession.path);
    if (hit !== void 0) void openNote(hit.path);
  }, [bootSession.path, entries, openNote]);
  y2(() => {
    writeSession({ tab, dir: activeDir, tag: activeTag });
  }, [tab, activeDir, activeTag]);
  y2(() => {
    if (!restoredRef.current) return;
    writeSession({ path: current !== null ? String(current.path || "") : "" });
  }, [current]);
  const requestAnchor = q2((text, path, kind) => {
    const clean = String(text || "").trim();
    if (clean === "") return;
    anchorSeq.current += 1;
    setPendingAnchor({
      text: clean,
      path: String(path || ""),
      // 'heading' 是「跳到某一节」，'line' 是「跳到正文里写着这行字的地方」。
      // 搜索卡片上的命中行走后者：那一行往往是普通段落，不是标题。
      kind: kind === "line" ? "line" : kind === "block" ? "block" : "heading",
      seq: anchorSeq.current
    });
  }, []);
  const openWikiLink = q2(
    (target, anchor) => {
      const raw = String(target || "").trim();
      const section = typeof anchor === "string" ? anchor.trim() : "";
      const anchorKind = isBlockAnchor(section) ? "block" : "heading";
      if (raw === "") {
        if (section !== "") requestAnchor(section, current !== null ? current.path : "", anchorKind);
        return;
      }
      const sub = status !== null && typeof status.subfolder === "string" ? status.subfolder.replace(/^\/+|\/+$/g, "") : "";
      const rel = current !== null && typeof current.path === "string" ? current.path : "";
      const sourceRel = rel === "" ? sub : sub === "" ? rel : `${sub}/${rel}`;
      const hosted = resolveViaHost(raw, sourceRel);
      if (hosted !== "") {
        if (section !== "") requestAnchor(section, hosted, anchorKind);
        void openNote(hosted);
        return;
      }
      const wanted = raw.replace(/\.md$/i, "");
      const list = entries || [];
      const direct = list.find((entry) => entry.path === raw || entry.path === `${wanted}.md`);
      if (direct !== void 0) {
        if (section !== "") requestAnchor(section, direct.path, anchorKind);
        void openNote(direct.path);
        return;
      }
      const byName = list.find((entry) => {
        const name = entry.path.split("/").pop().replace(/\.md$/i, "");
        return name === wanted;
      });
      if (byName !== void 0) {
        if (section !== "") requestAnchor(section, byName.path, anchorKind);
        void openNote(byName.path);
        return;
      }
      const lowered = wanted.toLowerCase();
      const byTitle = list.find((entry) => String(entry.title || "").toLowerCase() === lowered);
      if (byTitle !== void 0) {
        if (section !== "") requestAnchor(section, byTitle.path, anchorKind);
        void openNote(byTitle.path);
        return;
      }
      const byAlias = list.find(
        (entry) => aliasesOf(entry).some((alias) => alias.toLowerCase() === lowered)
      );
      if (byAlias !== void 0) {
        if (section !== "") requestAnchor(section, byAlias.path, anchorKind);
        void openNote(byAlias.path);
        return;
      }
      setError(t4("note.wikilinkMissing").replace("{name}", wanted));
    },
    [current, entries, openNote, requestAnchor, status, t4]
  );
  const resolveNotePath = q2(
    (target) => {
      const raw = String(target || "").trim();
      if (raw === "") return "";
      const sub = status !== null && typeof status.subfolder === "string" ? status.subfolder.replace(/^\/+|\/+$/g, "") : "";
      const rel = current !== null && typeof current.path === "string" ? current.path : "";
      const sourceRel = rel === "" ? sub : sub === "" ? rel : `${sub}/${rel}`;
      const hosted = resolveViaHost(raw, sourceRel);
      if (hosted !== "") return hosted;
      const wanted = raw.replace(/\.md$/i, "");
      const list = entries || [];
      const direct = list.find((entry) => entry.path === raw || entry.path === `${wanted}.md`);
      if (direct !== void 0) return direct.path;
      const byName = list.find((entry) => entry.path.split("/").pop().replace(/\.md$/i, "") === wanted);
      if (byName !== void 0) return byName.path;
      const lowered = wanted.toLowerCase();
      const byTitle = list.find((entry) => String(entry.title || "").toLowerCase() === lowered);
      if (byTitle !== void 0) return byTitle.path;
      const byAlias = list.find(
        (entry) => aliasesOf(entry).some((alias) => alias.toLowerCase() === lowered)
      );
      if (byAlias !== void 0) return byAlias.path;
      return "";
    },
    [current, entries, status]
  );
  const dirty = current !== null && draft !== null && draft !== current.content;
  const navTo = q2(
    (delta) => {
      const nav = navRef.current;
      const next = nav.index + delta;
      if (next < 0 || next >= nav.stack.length) return;
      const path = nav.stack[next];
      const go = () => {
        navRef.current = { stack: nav.stack, index: next };
        syncNav();
        navJumpRef.current = true;
        void openNote(path);
      };
      if (!dirty) {
        go();
        return;
      }
      void confirmDialog(t4("note.unsaved")).then((ok) => {
        if (ok) go();
      });
    },
    [dirty, openNote, syncNav, t4]
  );
  const navBack = q2(() => navTo(-1), [navTo]);
  const navForward = q2(() => navTo(1), [navTo]);
  const jumpToMatch = q2(
    (path, match) => {
      const target = String(path || "");
      const text = match !== null && match !== void 0 ? String(match.text || "") : "";
      if (target === "" || text.trim() === "") return;
      const go = () => {
        requestAnchor(text, target, "line");
        void openNote(target);
      };
      if (!dirty) {
        go();
        return;
      }
      void confirmDialog(t4("note.unsaved")).then((ok) => {
        if (ok) go();
      });
    },
    [dirty, openNote, requestAnchor, t4]
  );
  const saveNote = q2(async () => {
    if (current === null || draft === null) return;
    setBusy(true);
    selfSavedRef.current = { path: current.path };
    try {
      await api("/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: current.path, content: draft, requestId: requestId() })
      });
      setCurrent({ ...current, content: draft });
      dropDraft(current.path);
      showToast(t4("note.saved"));
      void refresh();
    } catch (err) {
      selfSavedRef.current = null;
      setError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [current, draft, refresh, showToast, t4]);
  const customTemplates = T2(() => {
    const list = status !== null && Array.isArray(status.templates) ? status.templates : [];
    return list.filter((item) => item !== null && typeof item === "object" && typeof item.name === "string" && item.name.trim() !== "");
  }, [status]);
  const templateContent = q2((id) => {
    const now = /* @__PURE__ */ new Date();
    const pad2 = (n2) => String(n2).padStart(2, "0");
    const day = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    const hm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    const weekday = ["\u65E5", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D"][now.getDay()];
    if (typeof id === "string" && id.startsWith("custom:")) {
      const name = id.slice("custom:".length);
      const found = customTemplates.find((item) => item.name === name);
      return { title: name, content: found && typeof found.body === "string" ? found.body : "" };
    }
    if (id === "daily") {
      return {
        title: `${day} \u65E5\u8BB0`,
        content: `
## \u4ECA\u5929\u53D1\u751F\u4E86\u4EC0\u4E48


## \u60F3\u6CD5


## \u660E\u5929\u8981\u505A

`
      };
    }
    if (id === "book") {
      return {
        title: t4("new.bookTitle"),
        content: `
## \u8FD9\u672C\u4E66\u5728\u8BB2\u4EC0\u4E48


## \u8BA9\u6211\u6709\u53CD\u5E94\u7684\u5730\u65B9

> 

## \u6211\u4F1A\u600E\u4E48\u7528

`
      };
    }
    if (id === "meeting") {
      return {
        title: `${day} ${t4("new.meetingTitle")}`,
        content: `
- \u65F6\u95F4\uFF1A${day} ${hm}
- \u53C2\u4E0E\uFF1A

## \u8BA8\u8BBA\u4E86\u4EC0\u4E48


## \u7ED3\u8BBA


## \u6211\u8981\u8DDF\u8FDB\u7684

- [ ] 
`
      };
    }
    return { title: `${day} ${weekday} \u968F\u624B\u8BB0`, content: "" };
  }, [customTemplates, t4]);
  const newTemplates = T2(() => {
    const builtin = [
      { id: "daily", icon: "calendar" },
      { id: "book", icon: "book" },
      { id: "meeting", icon: "clock" },
      { id: "note", icon: "note" }
    ];
    const mine = customTemplates.map((item) => ({ id: `custom:${item.name}`, icon: "edit", custom: true }));
    return builtin.concat(mine);
  }, [customTemplates]);
  const newDirHits = T2(
    () => newDirAt === null ? [] : searchSuggestions(dirs, [], "dir", newDirAt),
    [dirs, newDirAt]
  );
  const applyNewDir = q2((item) => {
    if (item === null || item === void 0) return;
    setNewDir(String(item.value || ""));
    setNewDirAt(null);
    setNewDirIndex(null);
  }, []);
  const newNote = q2(
    async (templateId) => {
      const spec = typeof templateId === "string" ? templateContent(templateId) : { title: t4("action.new"), content: "" };
      setTemplatesOpen(false);
      setBusy(true);
      const typed = newDir.trim().replace(/^\/+|\/+$/g, "");
      const dir = typed !== "" ? typed : activeDir !== "" ? activeDir : newNotePlacementOf();
      try {
        const created = await api("/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dir,
            title: spec.title,
            content: spec.content,
            requestId: requestId()
          })
        });
        showToast(t4("note.created"));
        await refresh();
        await openNote(created.path);
      } catch (err) {
        setError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [activeDir, newDir, openNote, refresh, showToast, t4, templateContent]
  );
  const waitForSync = q2(async () => {
    const deadline = Date.now() + 5 * 60 * 1e3;
    await new Promise((done) => window.setTimeout(done, 600));
    for (; ; ) {
      if (Date.now() > deadline) return null;
      let json;
      try {
        json = await api("/sync/status");
      } catch {
        return null;
      }
      if (json && json.running !== true) {
        if (json.lastResult) reportSync(json.lastResult);
        return json.lastResult || null;
      }
      await new Promise((done) => window.setTimeout(done, 2e3));
    }
  }, []);
  y2(
    () => subscribeIntent((intent) => {
      const kind = intent && intent.type;
      if (kind === "search") {
        setTab("notes");
        if (typeof intent.q === "string" && intent.q !== "") setQuery(intent.q);
        window.setTimeout(() => {
          const input = findInPanel(".dshgn_search");
          if (input) {
            input.focus();
            input.select();
          }
        }, 30);
        return;
      }
      if (kind === "open") {
        const path = typeof intent.path === "string" ? intent.path : "";
        if (path === "") return;
        setTab("notes");
        void openNote(path);
        return;
      }
      if (kind === "new") {
        setTab("notes");
        if (status !== null && !status.vaultMissing) void newNote();
        return;
      }
      if (kind === "today") {
        const now = /* @__PURE__ */ new Date();
        const pad2 = (n2) => String(n2).padStart(2, "0");
        const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
        const hosted = dailyNoteOf();
        const todayDir = hosted !== null ? hosted.dir : "";
        const todayTitle = hosted !== null ? hosted.title : stamp;
        const todayPath = todayDir === "" ? `${todayTitle}.md` : `${todayDir}/${todayTitle}.md`;
        setTab("notes");
        const hit = (entries || []).find((entry) => entry.path === todayPath) || (hosted !== null ? (entries || []).find(
          (entry) => String(entry.title || "").trim() === todayTitle
        ) : (entries || []).find(
          (entry) => entry.date === stamp || String(entry.title || "").trim() === stamp
        ));
        if (hit !== void 0) {
          void openNote(hit.path);
          return;
        }
        if (status === null || status.vaultMissing) return;
        setBusy(true);
        void dailyTemplateOf().then(
          (template) => api("/create", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              dir: hosted !== null ? todayDir : activeDir,
              title: todayTitle,
              content: template,
              // 宿主的日记名可能本身就是日期，别再叠一层日期前缀
              withDatePrefix: hosted === null,
              requestId: requestId()
            })
          })
        ).then(async (created) => {
          showToast(t4("note.created"));
          await refresh();
          await openNote(created.path);
        }).catch((err) => setError(err && err.message ? err.message : String(err))).finally(() => setBusy(false));
        return;
      }
      if (kind === "capture") {
        const text = typeof intent.text === "string" ? intent.text.trim() : "";
        if (text === "") return;
        setTab("notes");
        if (status === null || status.vaultMissing) return;
        const firstLine = text.split("\n").map((line) => line.trim()).filter((line) => line !== "")[0] || t4("capture.title");
        const title = firstLine.length > 40 ? `${firstLine.slice(0, 40)}\u2026` : firstLine;
        const quoted = text.split("\n").map((line) => line === "" ? ">" : `> ${line}`).join("\n");
        const from = typeof intent.source === "string" && intent.source !== "" ? `

\u2014\u2014 \u6458\u81EA ${intent.source}` : "";
        setBusy(true);
        void api("/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dir: activeDir,
            title,
            content: `${quoted}${from}
`,
            requestId: requestId()
          })
        }).then(async (created) => {
          showToast(t4("capture.saved"));
          await refresh();
          await openNote(created.path);
        }).catch((err) => setError(err && err.message ? err.message : String(err))).finally(() => setBusy(false));
        return;
      }
      if (kind === "sync") {
        setTab("settings");
        setBusy(true);
        void api("/sync/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ full: false })
        }).then(() => {
          showToast(t4("sync.running"));
          return waitForSync();
        }).catch((err) => setError(err && err.message ? err.message : String(err))).finally(() => setBusy(false));
        return;
      }
      if (kind === "card") {
        setTab("card");
        setBusy(true);
        void api("/card/scan?timeout=8").then((json) => {
          const count = Array.isArray(json && json.cards) ? json.cards.length : 0;
          showToast(count > 0 ? `${t4("card.scanFound")}\uFF1A${count}` : t4("card.scanNone"));
        }).catch((err) => setError(err && err.message ? err.message : String(err))).finally(() => setBusy(false));
      }
    }),
    [activeDir, entries, newNote, openNote, refresh, showToast, status, t4]
  );
  const attachFiles = q2(
    async (fileList) => {
      const files = Array.from(fileList || []).filter((file) => file !== null && typeof file === "object");
      if (files.length === 0) return;
      if (current === null) {
        showToast(t4("attach.needNote"));
        return;
      }
      setBusy(true);
      try {
        const names = [];
        let failed = 0;
        for (const file of files) {
          try {
            const saved = await uploadAsset(current.path, file);
            if (saved && typeof saved.name === "string" && saved.name !== "") names.push(saved.name);
          } catch {
            failed += 1;
          }
        }
        if (names.length === 0) {
          showToast(t4("attach.failed"));
          return;
        }
        const base = draft !== null ? draft : current.content;
        const insert = names.map((name) => `![[${name}]]`).join("\n");
        const next = base.trim() === "" ? `${insert}
` : `${base.replace(/\s*$/, "")}

${insert}
`;
        const unsaved = draft !== null && draft !== current.content;
        if (unsaved) {
          setDraft(next);
        } else {
          await api("/save", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: current.path, content: next, requestId: requestId() })
          });
          await openNote(current.path);
        }
        showToast(failed > 0 ? t4("attach.failed") : t4("attach.added"));
      } catch (err) {
        setError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [current, draft, openNote, setDraft, showToast, t4]
  );
  const renameNote = q2(
    async (path) => {
      const target = String(path || "");
      if (target === "") return;
      if (current !== null && current.path === target && draft !== null && draft !== current.content) {
        showToast(t4("note.renameUnsaved"));
        return;
      }
      const next = await renameNoteInHost(target);
      if (next === "") return;
      showToast(t4("action.renamed"));
      await refresh();
      await openNote(next);
    },
    [current, draft, openNote, refresh, showToast, t4]
  );
  const deleteNote = q2(async () => {
    if (current === null) return;
    setBusy(true);
    try {
      await api("/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: current.path, requestId: requestId() })
      });
      setCurrent(null);
      setDraft(null);
      showToast(t4("note.deleted"));
      void refresh();
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [current, refresh, showToast, t4]);
  const copyReference = q2(async () => {
    if (current === null || status === null) return;
    const hosted = markdownLinkOf(current.path);
    let text = hosted;
    if (text === "") {
      const abs = `${status.vaultRoot}${status.vaultRoot.endsWith("/") || status.vaultRoot.endsWith("\\") ? "" : "/"}${current.path}`;
      text = /[\s"]/.test(abs) ? `@"${abs}"` : `@${abs}`;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast(t4("action.copied"));
    } catch {
      showToast(text);
    }
  }, [current, status, showToast, t4]);
  const copyHeadingLink = q2(
    async (heading) => {
      if (current === null) return;
      const name = typeof heading === "string" ? heading.trim() : "";
      if (name === "") return;
      const hosted = markdownLinkOf(current.path, name);
      const text = hosted !== "" ? hosted : `[[${current.path}#${name}]]`;
      try {
        await navigator.clipboard.writeText(text);
        showToast(t4("action.copied"));
      } catch {
        showToast(text);
      }
    },
    [current, showToast, t4]
  );
  const copyText = q2(
    async (text) => {
      const body2 = typeof text === "string" ? text : "";
      if (body2 === "") return;
      try {
        await navigator.clipboard.writeText(body2);
        showToast(t4("action.copied"));
      } catch {
        showToast(body2);
      }
    },
    [showToast, t4]
  );
  const createFromText = q2(
    async (text) => {
      const body2 = typeof text === "string" ? text.trim() : "";
      if (body2 === "") return;
      setBusy(true);
      try {
        const firstLine = body2.split("\n").find((line) => line.trim() !== "") || body2;
        const title = lineNeedle(firstLine).slice(0, 30) || t4("action.new");
        const dir = activeDir !== "" ? activeDir : newNotePlacementOf();
        const created = await api("/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dir,
            title,
            // 末尾补一个换行：摘出来的是一段话，不是一整篇，
            // 用户打开后多半要接着往下写
            content: `${body2}
`,
            requestId: requestId()
          })
        });
        showToast(t4("note.created"));
        await refresh();
        await openNote(created.path);
      } catch (err) {
        setError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [activeDir, openNote, refresh, showToast, t4]
  );
  const duplicateNote = q2(
    async (path) => {
      const target = String(path || "");
      if (target === "") return;
      setBusy(true);
      try {
        const note = await api(`/read?path=${encodeURIComponent(target)}`);
        const body2 = String(note.content || "");
        const slash = target.lastIndexOf("/");
        const dir = slash === -1 ? "" : target.slice(0, slash);
        const file = slash === -1 ? target : target.slice(slash + 1);
        const stem = file.replace(/\.md$/i, "");
        const created = await api("/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dir,
            title: `${stem} \u526F\u672C`,
            content: body2,
            // 副本照抄原篇的名字，不再叠一个今天的日期：原标题带日期前缀的
            // （「2026-11-15-周报」）该叫「2026-11-15-周报 副本」，
            // 不带前缀的也不该凭空多出「2026-11-21-」——用户认的是原来那个名字。
            withDatePrefix: false,
            requestId: requestId()
          })
        });
        showToast(t4("note.duplicated"));
        await refresh();
        await openNote(created.path);
      } catch (err) {
        setError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [openNote, refresh, showToast, t4]
  );
  const syncCurrent = q2(
    async (direction) => {
      if (current === null) return;
      setBusy(true);
      try {
        const json = await api(direction === "push" ? "/sync/push-one" : "/sync/pull-one", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: current.path })
        });
        showToast(direction === "push" ? t4("sync.pushedOne") : t4("sync.pulledOne"));
        await refresh();
        await openNote(current.path);
        return json;
      } catch (err) {
        setError(err && err.message ? err.message : String(err));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [current, openNote, refresh, setBusy, showToast, t4]
  );
  const [picked, setPicked] = h2(() => /* @__PURE__ */ new Set());
  const [batchTag, setBatchTag] = h2("");
  const [batchDir, setBatchDir] = h2("");
  const [batchDirAt, setBatchDirAt] = h2(null);
  const [batchDirIndex, setBatchDirIndex] = h2(null);
  const [batchTagAt, setBatchTagAt] = h2(null);
  const [batchTagIndex, setBatchTagIndex] = h2(null);
  const [batchOpen, setBatchOpen] = h2(false);
  const pickedCount = picked.size;
  const togglePick = q2((path) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  const clearPicked = q2(() => {
    setPicked(/* @__PURE__ */ new Set());
    setBatchOpen(false);
  }, []);
  const previewCard = q2((event, path) => {
    const target = event.currentTarget;
    if (!target) return;
    hoverLink(event, target, path, "");
  }, []);
  const batchDirHits = T2(
    () => batchDirAt === null ? [] : searchSuggestions(dirs, [], "dir", batchDirAt),
    [dirs, batchDirAt]
  );
  const batchTagHits = T2(
    () => batchTagAt === null ? [] : searchSuggestions([], searchTags, "tag", batchTagAt),
    [searchTags, batchTagAt]
  );
  const applyBatchDir = q2((item) => {
    if (item === null || item === void 0) return;
    setBatchDir(String(item.value || ""));
    setBatchDirAt(null);
    setBatchDirIndex(null);
  }, []);
  const applyBatchTag = q2((item) => {
    if (item === null || item === void 0) return;
    setBatchTag(String(item.value || ""));
    setBatchTagAt(null);
    setBatchTagIndex(null);
  }, []);
  const runBatch = q2(
    async (kind) => {
      if (picked.size === 0) return;
      setBusy(true);
      try {
        const json = await api("/batch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: kind,
            paths: Array.from(picked),
            tag: kind === "tag" || kind === "untag" ? batchTag.trim() : void 0,
            dir: kind === "move" ? batchDir.trim() : void 0
          })
        });
        showToast(`${t4("batch.done")} ${json.changed || 0}`);
        clearPicked();
        await refresh();
        if (current !== null && picked.has(current.path)) setCurrent(null);
      } catch (err) {
        setError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [batchDir, batchTag, clearPicked, current, picked, refresh, setBusy, setError, showToast, t4]
  );
  const dropIntoDir = q2(
    async (rawPaths) => {
      const target = activeDir;
      if (target === "") {
        showToast(t4("drop.pickDirFirst"));
        return;
      }
      const sub = status !== null && typeof status.subfolder === "string" ? status.subfolder.replace(/^\/+|\/+$/g, "") : "";
      const paths = [];
      for (const raw of rawPaths) {
        const rel = String(raw || "").replace(/\\/g, "/").replace(/^\/+/, "");
        if (rel === "") continue;
        if (sub !== "" && !rel.startsWith(`${sub}/`)) continue;
        const inner = sub !== "" ? rel.slice(sub.length + 1) : rel;
        if (!/\.md$/i.test(inner)) continue;
        paths.push(inner);
      }
      if (paths.length === 0) return;
      setBusy(true);
      try {
        const json = await api("/batch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "move", paths, dir: target })
        });
        showToast(`${t4("batch.done")} ${json.changed || 0}`);
        await refresh();
      } catch (err) {
        setError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [activeDir, refresh, setBusy, setError, showToast, status, t4]
  );
  const moveNoteTo = q2(
    async (path, dir) => {
      const from = typeof path === "string" ? path : "";
      const target = typeof dir === "string" ? dir : "";
      if (from === "" || target === "") return;
      const slash = from.lastIndexOf("/");
      const fromDir = slash === -1 ? "" : from.slice(0, slash);
      if (fromDir === target) return;
      setBusy(true);
      try {
        const json = await api("/batch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "move", paths: [from], dir: target })
        });
        const changed = Number(json.changed) || 0;
        showToast(changed > 0 ? t4("tree.movedTo").replace("{dir}", target) : `${t4("batch.done")} 0`);
        const list = Array.isArray(json.moved) ? json.moved : [];
        const hit = list.find((item) => item !== null && item !== void 0 && item.from === from);
        const landed = hit !== void 0 && hit !== null && typeof hit.to === "string" ? hit.to : "";
        await refresh();
        if (landed !== "" && current !== null && current !== void 0 && current.path === from) {
          setCurrent({ ...current, path: landed });
        }
      } catch (err) {
        setError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [current, refresh, setBusy, setError, showToast, t4]
  );
  const vaultReady = status !== null && !status.vaultMissing;
  y2(() => {
    const onKey = (event) => {
      const target = event.target;
      const tag = target && target.tagName ? String(target.tagName).toLowerCase() : "";
      const typing = tag === "input" || tag === "textarea" || tag === "select" || target && target.isContentEditable === true;
      if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        if (event.key === "ArrowLeft") navBack();
        else navForward();
        return;
      }
      if (event.key === "Escape") {
        setTemplatesOpen(false);
        if (helpOpenRef.current) {
          setHelpOpen(false);
          return;
        }
        if (pickedCount > 0) {
          clearPicked();
          return;
        }
        return;
      }
      if (typing) return;
      if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setHelpOpen((prev) => !prev);
        return;
      }
      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const input = findInPanel(".dshgn_search", docOfEvent(event));
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }
      if (meta && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (vaultReady) void newNote();
        return;
      }
      if (tab !== "notes") return;
      if (event.key === "x" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        const targetPath = current !== null && current !== void 0 ? String(current.path || "") : "";
        const first = shown.length > 0 ? shown[0] : null;
        const pickPath = targetPath !== "" ? targetPath : first === null ? "" : String(first.path || "");
        if (pickPath === "") return;
        event.preventDefault();
        togglePick(pickPath);
        return;
      }
      if (event.key === "j" || event.key === "k") {
        if (shown.length === 0) return;
        const index = current === null ? -1 : shown.findIndex((entry) => entry.path === current.path);
        const next = event.key === "j" ? Math.min(shown.length - 1, index + 1) : Math.max(0, index - 1);
        const target2 = shown[next];
        if (target2 && target2.path !== (current !== null ? current.path : null)) {
          event.preventDefault();
          void openNote(target2.path);
        }
      }
    };
    return attachOnPanelWindows("keydown", onKey);
  }, [clearPicked, current, navBack, navForward, newNote, openNote, pickedCount, shown, tab, togglePick, vaultReady]);
  y2(() => {
    const onDragOver = (event) => {
      if (!inPanel(event)) return;
      event.preventDefault();
      if (dragCarriesNote(event.dataTransfer)) return;
      if (event.dataTransfer) {
        try {
          event.dataTransfer.dropEffect = "copy";
        } catch {
        }
      }
    };
    return attachOnPanelWindows("dragover", onDragOver);
  }, []);
  const helpRows = [
    { keys: ["Ctrl", "K"], what: "help.search" },
    // 搜索框里的两个键：回车打开排在最前面的那篇，Esc 退回整份列表
    { keys: ["Enter"], what: "help.searchEnter" },
    { keys: ["Ctrl", "N"], what: "help.new" },
    { keys: ["J", "K"], what: "help.move" },
    { keys: ["X"], what: "help.pick" },
    { keys: ["Alt", "\u2190"], what: "help.nav" },
    { keys: ["Ctrl", "F"], what: "help.find" },
    { keys: ["Ctrl", "E"], what: "help.edit" },
    { keys: ["Ctrl", "S"], what: "help.save" },
    { keys: ["Esc"], what: "help.esc" },
    { keys: ["Ctrl", "B"], what: "help.format" },
    { keys: ["Tab"], what: "help.indent" },
    { keys: ["[["], what: "help.complete" },
    { keys: ["?"], what: "help.help" }
  ];
  const tabButton = (id, label, badge) => h4(
    "button",
    { type: "button", className: "dshgn_tab", "data-on": tab === id ? "true" : "false", onClick: () => setTab(id) },
    h4("span", { className: "dshgn_tabLabel" }, label),
    badge === void 0 || badge === null ? null : h4("span", { className: "dshgn_tabBadge" }, String(badge))
  );
  const head = h4(
    "div",
    { className: "dshgn_head" },
    // 窄窗口里左栏是抽屉，没有这个按钮就再也打不开了。
    // 宽窗口下 display:none，不占位。
    tab === "notes" ? h4(
      "button",
      {
        type: "button",
        className: "dshgn_iconBtn dshgn_treeToggle",
        title: t4("panel.toggleTree"),
        "aria-expanded": treeOpen ? "true" : "false",
        onClick: () => setTreeOpen((prev) => !prev)
      },
      h4(Icon, { name: "folder", size: 15 })
    ) : null,
    h4(
      "div",
      { className: "dshgn_headMain" },
      h4("div", { className: "dshgn_title" }, t4("panel.title")),
      h4(
        "div",
        { className: "dshgn_sub", title: status ? status.vaultRoot : "" },
        status === null ? "" : status.vaultMissing ? t4("empty.noVault") : status.vaultRoot
      )
    ),
    // 动作按钮放在页签**左边**：页签是「去哪」（导航），按钮是「对当前页做什么」（动作）。
    // 动作紧贴内容更有因果关系，也避免鼠标为了点刷新横穿整条顶栏。
    h4(
      "div",
      { className: "dshgn_actions" },
      tab === "notes" || tab === "cloud" ? h4(
        b,
        null,
        h4(
          "div",
          { className: "dshgn_newWrap" },
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_iconBtn",
              title: t4("action.new"),
              onClick: () => setTemplatesOpen((prev) => !prev),
              disabled: busy || !vaultReady,
              "data-on": templatesOpen ? "true" : "false"
            },
            h4(Icon, { name: "plus" })
          ),
          // 模板菜单：直接点「+」会建一篇空笔记，用户还得自己写标题和标签。
          // 常写的几类（日记/读书/会议/随手记）日期和结构都是固定的，
          // 让用户选一次比每次重复劳动好。
          templatesOpen ? h4(
            b,
            null,
            h4("div", { className: "dshgn_menuMask", onClick: () => setTemplatesOpen(false) }),
            h4(
              "div",
              { className: "dshgn_menu", role: "menu" },
              // 建到哪个目录：菜单里选好再挑模板，建完就是最终位置。
              // 留空表示照旧（面板里选中的目录，或宿主的默认位置）。
              h4("div", { className: "dshgn_menuTitle" }, t4("new.pickDir")),
              h4(
                "div",
                { className: "dshgn_menuRow" },
                h4("input", {
                  type: "text",
                  className: "dshgn_input dshgn_batchInput",
                  placeholder: activeDir !== "" ? activeDir : t4("new.pickDir"),
                  value: newDir,
                  onChange: (event) => {
                    const value = event.target.value;
                    setNewDir(value);
                    setNewDirAt(value.trim() === "" ? null : value);
                    setNewDirIndex(null);
                  },
                  onKeyDown: (event) => {
                    if (newDirHits.length === 0) return;
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      setNewDirAt(null);
                      setNewDirIndex(null);
                      return;
                    }
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      const down = event.key === "ArrowDown";
                      setNewDirIndex(
                        (prev) => prev === null ? down ? 0 : newDirHits.length - 1 : (prev + (down ? 1 : newDirHits.length - 1)) % newDirHits.length
                      );
                      return;
                    }
                    if (event.key === "Enter" && newDirIndex !== null) {
                      event.preventDefault();
                      event.stopPropagation();
                      applyNewDir(newDirHits[newDirIndex]);
                    }
                  }
                })
              ),
              newDirHits.length === 0 ? null : h4(
                "div",
                { className: "dshgn_suggest", role: "listbox" },
                newDirHits.map(
                  (item, index) => h4(
                    "button",
                    {
                      key: item.value,
                      type: "button",
                      className: "dshgn_suggestItem",
                      "data-kind": "dir",
                      "data-on": newDirIndex === index ? "true" : "false",
                      role: "option",
                      "aria-selected": newDirIndex === index ? "true" : "false",
                      title: t4("new.dirPick"),
                      onMouseDown: (event) => {
                        event.preventDefault();
                        applyNewDir(item);
                      }
                    },
                    h4(Icon, { name: "folder", size: 11 }),
                    h4("span", { className: "dshgn_suggestName" }, item.value)
                  )
                )
              ),
              h4("div", { className: "dshgn_menuTitle" }, t4("new.template")),
              newTemplates.map(
                (item) => h4(
                  "button",
                  {
                    key: item.id,
                    type: "button",
                    className: "dshgn_menuItem",
                    role: "menuitem",
                    onClick: () => void newNote(item.id)
                  },
                  h4(Icon, { name: item.icon, size: 13 }),
                  // 自定义模板直接显示模板名（用户自己起的，没有译文可查），
                  // 提示行说明它带的是自己写的骨架，而不是空白。
                  h4("span", null, item.custom ? item.id.slice("custom:".length) : t4(`new.${item.id}`)),
                  h4(
                    "span",
                    { className: "dshgn_menuHint" },
                    item.custom ? t4("new.customHint") : t4(`new.${item.id}Hint`)
                  )
                )
              )
            )
          ) : null
        ),
        h4(
          "button",
          {
            type: "button",
            className: "dshgn_iconBtn" + (refreshState === "ok" ? " dshgn_iconBtnOk" : refreshState === "fail" ? " dshgn_iconBtnFail" : ""),
            title: t4("action.refresh"),
            onClick: refresh,
            disabled: busy
          },
          h4("span", { className: "dshgn_refreshSpin" + (refreshState === "spinning" ? " dshgn_refreshSpinOn" : "") }, h4(Icon, { name: "refresh" }))
        )
      ) : null
    ),
    h4(
      "div",
      { className: "dshgn_tabs" },
      tabButton("notes", t4("tab.notes")),
      tabButton("cloud", t4("tab.cloud")),
      // 「同步」不再单独占一个页签，收进了设置页。自动同步本质上是「设置」：
      // 设一次间隔就不管了，不是每天要看的东西，占一个一级入口反而挤掉了
      // 真正要翻的笔记/云端。
      // 冲突页签常驻。早先是「有冲突才出现」，但页签凭空消失会让人以为功能
      // 被删了，而且处理过的留档也想随时翻回去看。所以入口一直在，
      // 只有未处理的数量挂在旁边当角标——数字没了就说明手头清干净了。
      tabButton(
        "conflict",
        t4("tab.conflict"),
        status !== null && status.conflicts > 0 ? status.conflicts : void 0
      ),
      tabButton("card", t4("tab.card")),
      tabButton("broken", t4("tab.broken")),
      tabButton("todos", t4("tab.todos")),
      tabButton("settings", t4("tab.settings")),
      tabButton("trash", t4("tab.trash"))
    ),
    // 速查表入口。放在页签右边而不是挤进动作区：动作是「对当前这页做什么」，
    // 这张表是全局面板都一样的，跟在哪一页无关。
    h4(
      "button",
      {
        type: "button",
        className: "dshgn_iconBtn dshgn_helpBtn",
        title: `${t4("help.open")}\uFF08?\uFF09`,
        "aria-keyshortcuts": "Shift+Slash",
        onClick: () => setHelpOpen((prev) => !prev),
        "data-on": helpOpen ? "true" : "false"
      },
      h4(Icon, { name: "info", size: 15 })
    )
  );
  let body;
  if (tab === "cloud") {
    body = h4(CloudPane, {
      t: t4,
      status,
      showToast,
      onError: (message) => setError(message),
      onSynced: () => {
        void refresh();
      }
    });
  } else if (tab === "settings") {
    body = h4(SettingsPane, {
      t: t4,
      status,
      onSaved: async (message) => {
        showToast(message);
        await refresh();
      },
      onError: (message) => setError(message),
      showToast,
      onThemePreview: setThemePreview,
      locale,
      onLocaleChange: setLocale,
      // 同步卡里的改动只需要静默刷新状态，不要弹 toast——用户点一下开关
      // 就弹一条提示，反而像在催他。
      onSyncChanged: async () => {
        await refresh();
      }
    });
  } else if (tab === "card") {
    body = h4(CardPane, {
      t: t4,
      status,
      showToast,
      onError: (message) => setError(message),
      onChanged: async () => {
        await refresh();
      }
    });
  } else if (tab === "conflict") {
    body = h4(ConflictPane, {
      t: t4,
      status,
      onChanged: async () => {
        await refresh();
      },
      onError: (message) => setError(message),
      showToast
    });
  } else if (tab === "broken") {
    body = h4(BrokenPane, {
      t: t4,
      status,
      onError: (message) => setError(message),
      onOpen: (path) => {
        setTab("notes");
        void openNote(path);
      },
      // 断链清单最常用的动作是「去把那个名字改掉」，而名字在长笔记的第 40 行。
      // 只打开篇首等于让用户自己在整篇里再找一遍；上下文末尾可能带省略号，
      // 拿它比对不上正文，先削掉再当锚点。
      onOpenLine: (path, text) => {
        setTab("notes");
        jumpToMatch(path, { text: String(text || "").replace(/…$/, "") });
      }
    });
  } else if (tab === "todos") {
    body = h4(TodoPane, {
      t: t4,
      status,
      onError: (message) => setError(message),
      showToast,
      onOpen: (path) => {
        setTab("notes");
        void openNote(path);
      },
      onOpenLine: (path, text) => {
        setTab("notes");
        jumpToMatch(path, { text: String(text || "").replace(/…$/, "") });
      },
      // 勾完之后状态里那个「还有几条」的角标要跟着变，所以顺手刷新一下
      onChanged: async () => {
        await refresh();
      }
    });
  } else if (tab === "trash") {
    body = h4(TrashPane, {
      t: t4,
      status,
      onChanged: async () => {
        await refresh();
      },
      onError: (message) => setError(message),
      showToast
    });
  } else if (status === null) {
    body = h4(SkeletonPane, { t: t4 });
  } else {
    body = h4(
      "div",
      { className: "dshgn_body" },
      h4(TreePane, {
        t: t4,
        tree,
        // 窄窗口抽屉里点完目录要自己收回去，否则它还盖在列表上
        onNarrowPick: () => setTreeOpen(false),
        dirs,
        entries,
        activeDir,
        activeTag,
        tagCounts,
        dirSort,
        tagSort,
        onDirSortChange: (next) => {
          setDirSort(next);
          makeSortPref("dshgn.sortDir").write(next);
        },
        onTagSortChange: (next) => {
          setTagSort(next);
          makeSortPref("dshgn.sortTag").write(next);
        },
        onPickDir: (dir) => {
          setActiveDir(dir);
          setActiveTag("");
        },
        onPickTag: (tag) => {
          setActiveTag(tag);
          setActiveDir("");
        },
        onMoveNoteTo: (path, dir) => {
          void moveNoteTo(path, dir);
        },
        onCreateDir: async (name) => {
          try {
            await api("/dir/create", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ dir: name })
            });
            showToast(t4("tree.dirCreated"));
            await refresh();
          } catch (err) {
            setError(err && err.message ? err.message : String(err));
          }
        },
        onDeleteDir: async (name) => {
          try {
            await api("/dir/delete", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ dir: name })
            });
            showToast(t4("tree.deletedDir"));
            if (activeDir === name) setActiveDir("");
            await refresh();
          } catch (err) {
            const message = err && err.message ? err.message : String(err);
            setError(/还有|not empty|409/.test(message) ? t4("tree.dirNotEmpty") : message);
          }
        },
        onDeleteTag: async (name) => {
          try {
            await api("/tag/delete", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ tag: name })
            });
            showToast(t4("tree.deletedTag"));
            if (activeTag === name) setActiveTag("");
            await refresh();
          } catch (err) {
            setError(err && err.message ? err.message : String(err));
          }
        },
        onCreateTag: async (name) => {
          if (current === null || current.path === void 0) {
            showToast(t4("tree.tagNeedNote"));
            return;
          }
          try {
            await api("/batch", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "tag", paths: [current.path], tag: name })
            });
            showToast(t4("tree.tagCreated"));
            await refresh();
          } catch (err) {
            setError(err && err.message ? err.message : String(err));
          }
        },
        onRenameTag: async (from, to) => {
          try {
            const json = await api("/tag/rename", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ from, to })
            });
            if (activeTag === from) setActiveTag(to);
            const changed = json && typeof json.changed === "number" ? json.changed : 0;
            showToast(`${t4("tree.tagRenamed")} \xB7 ${changed}`);
            await refresh();
          } catch (err) {
            setError(err && err.message ? err.message : String(err));
          }
        },
        onRenameDir: async (from, to) => {
          try {
            const json = await api("/dir/rename", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ from, to })
            });
            if (activeDir === from) setActiveDir(to);
            const currentPath = current !== null && current !== void 0 ? String(current.path || "") : "";
            if (currentPath === from || currentPath.startsWith(`${from}/`)) {
              setCurrent({ ...current, path: `${to}${currentPath.slice(from.length)}` });
            }
            showToast(t4("tree.dirRenamed"));
            await refresh();
          } catch (err) {
            setError(err && err.message ? err.message : String(err));
          }
        },
        currentNoteId: current !== null && current.noteId ? current.noteId : null,
        heatmap: status !== null && status.heatmap ? status.heatmap : null
      }),
      h4(ColSplitter, {
        label: t4("col.treeWidth"),
        value: colWidths.tree,
        min: TREE_MIN_W,
        max: TREE_MAX_W,
        onChange: (next) => setColWidths((prev) => ({ ...prev, tree: next }))
      }),
      h4(
        "div",
        { className: "dshgn_list" },
        h4(
          "div",
          { className: "dshgn_searchWrap" },
          h4(Icon, { name: "search", size: 14, className: "dshgn_searchIcon" }),
          h4("input", {
            className: "dshgn_search",
            type: "search",
            value: query,
            placeholder: t4("search.placeholder"),
            onChange: (event) => {
              const value = event.target.value;
              setQuery(value);
              const caret = Number.isInteger(event.target.selectionStart) ? event.target.selectionStart : value.length;
              const spot = value.trim() === "" ? null : searchSuggestAt(value, caret);
              setSuggestAt(spot);
              setSuggestIndex(null);
            },
            // 搜完还要把鼠标挪到第一张卡上点一下，是搜索这条路上最后一段体力活。
            // 回车就打开排在最前面的那一篇（相关度排的，就是最该看的那篇），
            // Esc 把搜索框清空退回整份列表。
            onKeyDown: (event) => {
              if (event.nativeEvent && event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                if (suggestions.length > 0) {
                  event.preventDefault();
                  setSuggestAt(null);
                  setSuggestIndex(null);
                  return;
                }
                if (query === "") return;
                event.preventDefault();
                setQuery("");
                return;
              }
              if (suggestions.length > 0) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setSuggestIndex((prev) => {
                    const from = prev === null ? step > 0 ? -1 : 0 : prev;
                    const next = from + step;
                    if (next < 0) return suggestions.length - 1;
                    if (next >= suggestions.length) return 0;
                    return next;
                  });
                  return;
                }
                if (event.key === "Enter" && suggestIndex !== null) {
                  event.preventDefault();
                  applySuggestion(suggestions[suggestIndex]);
                  return;
                }
              }
              if (event.key !== "Enter") return;
              if (query.trim() === "") return;
              const first = shown.length > 0 ? shown[0] : null;
              if (first === null) return;
              event.preventDefault();
              if (!dirty) {
                void openNote(first.path, true);
                return;
              }
              void confirmDialog(t4("note.unsaved")).then((ok) => {
                if (ok) void openNote(first.path, true);
              });
            }
          }),
          searching ? h4("span", { className: "dshgn_searching" }, t4("search.searching")) : null,
          // 清空那颗 ×：搜索框里打了半截才发现想搜的是另一件事，以前得把
          // 光标挪回去、按住退格一路删，或者按 Esc——而 Esc 在候选摆着时
          // 只收候选，两下才清得掉。有字才摆，空框上不留一颗按了没反应的按钮。
          query === "" ? null : h4(
            "button",
            {
              type: "button",
              className: "dshgn_searchClear",
              title: t4("search.clear"),
              "aria-label": t4("search.clear"),
              onClick: () => {
                setQuery("");
                setSuggestAt(null);
                setSuggestIndex(null);
                const box = findInPanel(".dshgn_search");
                if (box !== null) box.focus();
              }
            },
            h4(Icon, { name: "close", size: 11 })
          ),
          // 排序开关。搜索态不显示：那边的顺序是相关度排的，换成本地排序
          // 反而把最该看的那篇挤下去。
          searchMode ? null : h4(
            "button",
            {
              type: "button",
              className: "dshgn_listSort",
              title: `${t4("list.sort")}\uFF1A${t4(listSort === "name" ? "list.sortName" : "list.sortTime")}`,
              "aria-label": t4(listSort === "name" ? "list.sortName" : "list.sortTime"),
              onClick: () => {
                const next = listSort === "name" ? "time" : "name";
                setListSort(next);
                makeSortPref("dshgn.listSort").write(next);
              }
            },
            listSort === "name" ? "A\u2192Z" : "\u23F1"
          )
        ),
        // 搜索框的补全候选：把库里已有的目录名与标签名摆出来。
        // 只补正在敲的那一个词，敲完加了空白就不再提示。
        suggestions.length > 0 ? h4(
          "div",
          { className: "dshgn_suggest", role: "listbox" },
          suggestions.map(
            (item, index) => h4(
              "button",
              {
                key: `${item.kind}-${item.value}`,
                type: "button",
                className: "dshgn_suggestItem",
                "data-kind": item.kind,
                "data-on": suggestIndex === index ? "true" : "false",
                role: "option",
                "aria-selected": suggestIndex === index ? "true" : "false",
                // 用 mousedown 而不是 click：click 要等鼠标松开，
                // 那时输入框已经失焦、光标位置也拿不到了。
                onMouseDown: (event) => {
                  event.preventDefault();
                  applySuggestion(item);
                }
              },
              h4(Icon, { name: item.kind === "dir" ? "folder" : "hash", size: 11 }),
              h4("span", { className: "dshgn_suggestName" }, item.value)
            )
          )
        ) : null,
        // 限定语法提示：`tag:` / `dir:` 是隐藏功能，不提示没人会知道。
        // 只在输入框有内容时出现，平时不占位置。
        query.trim() !== "" ? h4("div", { className: "dshgn_searchHint" }, t4("search.hint")) : null,
        // 筛选条：左栏点了目录或标签之后，中栏只剩一部分卡片，但界面上一直
        // 没有任何「现在筛的是什么」的痕迹——换个目录再回来，人只会以为
        // 笔记丢了。这里把当前的筛选摆成两颗能点掉的胶囊，全清掉就整条消失。
        activeDir !== "" || activeTag !== "" ? h4(
          "div",
          { className: "dshgn_filterBar" },
          activeDir !== "" ? h4(
            "button",
            {
              type: "button",
              className: "dshgn_filterChip",
              "data-kind": "dir",
              title: `${t4("filter.clear")}\uFF1A${activeDir}`,
              onClick: () => setActiveDir("")
            },
            h4(Icon, { name: "folder", size: 10 }),
            h4("span", { className: "dshgn_filterChipName" }, activeDir),
            h4("span", { className: "dshgn_filterChipX" }, h4(Icon, { name: "close", size: 9 }))
          ) : null,
          activeTag !== "" ? h4(
            "button",
            {
              type: "button",
              className: "dshgn_filterChip",
              "data-kind": "tag",
              title: `${t4("filter.clear")}\uFF1A#${activeTag}`,
              onClick: () => setActiveTag("")
            },
            h4(Icon, { name: "hash", size: 10 }),
            h4("span", { className: "dshgn_filterChipName" }, activeTag),
            h4("span", { className: "dshgn_filterChipX" }, h4(Icon, { name: "close", size: 9 }))
          ) : null
        ) : null,
        // D2 批量工具栏：只在有选中时出现，不占常态空间。
        pickedCount > 0 ? h4(
          "div",
          { className: "dshgn_batchBar" },
          h4("span", { className: "dshgn_batchCount" }, `${pickedCount} ${t4("batch.picked")}`),
          h4(
            "button",
            { type: "button", className: "dshgn_batchBtn", onClick: () => setBatchOpen(!batchOpen) },
            t4("batch.actions")
          ),
          h4("button", { type: "button", className: "dshgn_batchBtn", onClick: clearPicked }, t4("batch.clear")),
          batchOpen ? h4(
            "div",
            { className: "dshgn_batchMenu" },
            h4(
              "div",
              { className: "dshgn_batchRow" },
              h4("input", {
                className: "dshgn_input dshgn_batchInput",
                type: "text",
                value: batchTag,
                placeholder: t4("batch.tagPlaceholder"),
                onChange: (event) => {
                  const value = event.target.value;
                  setBatchTag(value);
                  setBatchTagAt(value.trim() === "" ? null : value);
                  setBatchTagIndex(null);
                },
                onKeyDown: (event) => {
                  if (batchTagHits.length === 0) return;
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setBatchTagAt(null);
                    setBatchTagIndex(null);
                    return;
                  }
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const down = event.key === "ArrowDown";
                    setBatchTagIndex((prev) => {
                      if (prev === null) return down ? 0 : batchTagHits.length - 1;
                      const next = down ? prev + 1 : prev - 1;
                      if (next < 0) return batchTagHits.length - 1;
                      if (next >= batchTagHits.length) return 0;
                      return next;
                    });
                    return;
                  }
                  if (event.key === "Enter" && batchTagIndex !== null) {
                    event.preventDefault();
                    applyBatchTag(batchTagHits[batchTagIndex]);
                  }
                }
              }),
              h4(
                "button",
                {
                  type: "button",
                  className: "dshgn_btn dshgn_btnPrimary",
                  disabled: busy || batchTag.trim() === "",
                  onClick: () => void runBatch("tag")
                },
                t4("batch.addTag")
              ),
              // 去标签和加标签共用同一个输入框：想改归类时往往就是
              // 「把旧的去掉、换成新的」，敲一次名字点两下，比开两个框省事。
              h4(
                "button",
                {
                  type: "button",
                  className: "dshgn_btn",
                  title: t4("batch.removeTag"),
                  disabled: busy || batchTag.trim() === "",
                  onClick: () => void runBatch("untag")
                },
                t4("batch.removeTag")
              )
            ),
            // 标签候选：和搜索框、目录框同一套纯函数，挑一条只填名字，
            // 加/去还是要再点一下那颗按钮。
            batchTagHits.length === 0 ? null : h4(
              "div",
              { className: "dshgn_suggest", role: "listbox" },
              batchTagHits.map(
                (item, index) => h4(
                  "button",
                  {
                    key: item.value,
                    type: "button",
                    className: "dshgn_suggestItem",
                    "data-kind": "tag",
                    "data-on": batchTagIndex === index ? "true" : "false",
                    role: "option",
                    "aria-selected": batchTagIndex === index ? "true" : "false",
                    title: t4("batch.tagPick"),
                    onMouseDown: (event) => {
                      event.preventDefault();
                      applyBatchTag(item);
                    }
                  },
                  h4(Icon, { name: "hash", size: 11 }),
                  h4("span", { className: "dshgn_suggestName" }, item.value)
                )
              )
            ),
            h4(
              "div",
              { className: "dshgn_batchRow" },
              h4("input", {
                className: "dshgn_input dshgn_batchInput",
                type: "text",
                value: batchDir,
                placeholder: t4("batch.dirPlaceholder"),
                onChange: (event) => {
                  const value = event.target.value;
                  setBatchDir(value);
                  setBatchDirAt(value.trim() === "" ? null : value);
                  setBatchDirIndex(null);
                },
                onKeyDown: (event) => {
                  if (batchDirHits.length === 0) return;
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setBatchDirAt(null);
                    setBatchDirIndex(null);
                    return;
                  }
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const down = event.key === "ArrowDown";
                    setBatchDirIndex((prev) => {
                      if (prev === null) return down ? 0 : batchDirHits.length - 1;
                      const next = down ? prev + 1 : prev - 1;
                      if (next < 0) return batchDirHits.length - 1;
                      if (next >= batchDirHits.length) return 0;
                      return next;
                    });
                    return;
                  }
                  if (event.key === "Enter" && batchDirIndex !== null) {
                    event.preventDefault();
                    applyBatchDir(batchDirHits[batchDirIndex]);
                  }
                }
              }),
              h4(
                "button",
                {
                  type: "button",
                  className: "dshgn_btn",
                  disabled: busy || batchDir.trim() === "",
                  onClick: () => void runBatch("move")
                },
                t4("batch.move")
              )
            ),
            // 目录候选：和搜索框那套同一个纯函数，挑一条就填进输入框，
            // 再按「移动」才真的动文件——点一下就挪走太容易手滑。
            batchDirHits.length === 0 ? null : h4(
              "div",
              { className: "dshgn_suggest", role: "listbox" },
              batchDirHits.map(
                (item, index) => h4(
                  "button",
                  {
                    key: item.value,
                    type: "button",
                    className: "dshgn_suggestItem",
                    "data-kind": "dir",
                    "data-on": batchDirIndex === index ? "true" : "false",
                    role: "option",
                    "aria-selected": batchDirIndex === index ? "true" : "false",
                    title: t4("batch.dirPick"),
                    // 用 onMouseDown 不用 onClick：click 要等鼠标松开，
                    // 那时输入框已经失焦，光标和候选都对不上了。
                    onMouseDown: (event) => {
                      event.preventDefault();
                      applyBatchDir(item);
                    }
                  },
                  h4(Icon, { name: "folder", size: 11 }),
                  h4("span", { className: "dshgn_suggestName" }, item.value)
                )
              )
            ),
            h4(
              "button",
              {
                type: "button",
                className: "dshgn_btn dshgn_btnDanger",
                disabled: busy,
                onClick: () => {
                  void confirmDialog(`${t4("batch.confirmDelete")} ${pickedCount}`).then((ok) => {
                    if (ok) void runBatch("delete");
                  });
                }
              },
              t4("batch.delete")
            )
          ) : null
        ) : null,
        h4(
          "div",
          {
            className: "dshgn_listBody",
            onScroll: onListScroll,
            // 宿主的文件拖到列表里 = 把它挪进当前筛的这个目录。
            // 从宿主文件树拖进来的是宿主自己的路径口径，交给 onDropNote 去认。
            onDrop: (event) => {
              const files = event && event.dataTransfer ? event.dataTransfer.files : null;
              if (!files || files.length === 0) return;
              event.preventDefault();
              const paths = [];
              for (const file of Array.from(files)) {
                const path = file && typeof file.path === "string" ? file.path : "";
                if (path !== "") paths.push(path);
              }
              if (paths.length > 0) void dropIntoDir(paths);
            }
          },
          visible.length === 0 && !searchMode ? h4(
            "div",
            { className: "dshgn_empty", style: { padding: "24px 12px" } },
            h4("div", { className: "dshgn_emptyTitle" }, query.trim() !== "" ? t4("empty.search") : t4("empty.noNotes")),
            // 空列表最需要的不是一句「没有笔记」，而是一个能马上动手的按钮
            query.trim() === "" && vaultReady ? h4(
              "button",
              { type: "button", className: "dshgn_btn dshgn_btnPrimary", style: { marginTop: 10 }, onClick: () => void newNote() },
              h4(Icon, { name: "plus", size: 13 }),
              t4("action.new")
            ) : null
          ) : [
            shownSlice.map(
              (entry) => h4(
                "div",
                {
                  key: entry.path,
                  className: "dshgn_card",
                  "data-on": current !== null && current.path === entry.path ? "true" : "false",
                  // 勾选框需要左侧留白停靠（见 .dshgn_card[data-pick]），
                  // 其他列表（云端/冲突/回收站）没有勾选框就不用留这个空
                  "data-pick": "true",
                  // 拖到宿主的编辑器里就是一条链接。用户在列表里扫到一篇、
                  // 想把它引到正在写的那篇里时，拖过去比复制引用再粘更顺手；
                  // 拖出去的内容用宿主自己的链接格式（跟「复制引用」同一套），
                  // 粘进笔记里才认得出是双链。
                  draggable: true,
                  onDragStart: (event) => {
                    const link = markdownLinkOf(entry.path);
                    const text = link !== "" ? link : entry.path;
                    if (event.dataTransfer === null || event.dataTransfer === void 0) return;
                    try {
                      event.dataTransfer.setData("text/plain", text);
                      event.dataTransfer.setData(DRAG_MIME, entry.path);
                      event.dataTransfer.effectAllowed = "copyMove";
                    } catch {
                    }
                  },
                  // 停一下就把这一篇预览出来。用 mouseenter 而不是 mouseover：
                  // 卡片里还有勾选框、命中行这些子元素，mouseover 在它们之间
                  // 挪一下就会重发一次，宿主那边一卡一顿的。
                  onMouseEnter: (event) => previewCard(event, entry.path),
                  onClick: (event) => {
                    if (!dirty) {
                      void openNote(entry.path, true);
                      return;
                    }
                    void confirmDialog(t4("note.unsaved")).then((ok) => {
                      if (ok) void openNote(entry.path, true);
                    });
                  },
                  // 右键：把这一篇能做的事一次列出来。先把它设为当前笔记，
                  // 因为下面的动作（复制引用、单篇同步、删除）都作用在 current 上。
                  onContextMenu: (event) => {
                    event.preventDefault();
                    const items = [
                      {
                        id: "open",
                        label: t4("note.menuOpen"),
                        run: () => {
                          if (!dirty) {
                            void openNote(entry.path, true);
                            return;
                          }
                          void confirmDialog(t4("note.unsaved")).then((ok) => {
                            if (ok) void openNote(entry.path, true);
                          });
                        }
                      },
                      // 右键菜单也要有「在 Obsidian 里打开」：用户常常是在列表里
                      // 扫到一篇、想拿宿主的补全/Vim 去改，而不是先点开再找按钮。
                      hasOpenInEditor() ? {
                        id: "open-in-editor",
                        label: t4("action.openInEditor"),
                        run: () => {
                          openInEditor(entry.path);
                        }
                      } : null,
                      hasRevealInVault() ? {
                        id: "reveal-in-vault",
                        label: t4("tree.menuReveal"),
                        run: () => {
                          revealInVault(entry.path);
                        }
                      } : null,
                      hasRenameNote() ? {
                        id: "rename",
                        label: t4("action.rename"),
                        run: () => {
                          void renameNote(entry.path);
                        }
                      } : null,
                      {
                        id: "copy-ref",
                        label: t4("action.copyRef"),
                        run: () => {
                          void openNote(entry.path, true).then(() => copyReference());
                        }
                      },
                      // 复制这一篇：不动原文件，另建一篇「原标题 副本」。
                      // 放在「复制引用」后面——两者都是「拿这一篇去用」，
                      // 一个拿走的是链接，一个拿走的是整篇正文。
                      {
                        id: "duplicate",
                        label: t4("note.duplicate"),
                        run: () => {
                          void duplicateNote(entry.path);
                        }
                      },
                      {
                        id: "push-one",
                        label: t4("sync.pushOne"),
                        run: () => {
                          void openNote(entry.path, true).then(() => syncCurrent("push"));
                        }
                      },
                      {
                        id: "pull-one",
                        label: t4("sync.pullOne"),
                        run: () => {
                          void openNote(entry.path, true).then(() => syncCurrent("pull"));
                        }
                      },
                      {
                        id: "delete",
                        label: t4("action.delete"),
                        danger: true,
                        // 不二次确认：删除是进回收站，可还原，和面板里的删除按钮一致
                        run: () => {
                          void openNote(entry.path, true).then(() => deleteNote());
                        }
                      }
                    ];
                    showNoteMenu(event, items.filter((item) => item !== null));
                  },
                  title: entry.path
                },
                h4(
                  "div",
                  { className: "dshgn_cardTitleRow" },
                  // 勾选框只在「已有选中」或「鼠标悬停」时可见：常态下列表
                  // 干净，一旦开始多选就全部显形，不用先去某个按钮开多选模式。
                  h4(
                    "span",
                    {
                      className: "dshgn_pickBox" + (picked.has(entry.path) ? " dshgn_pickBoxOn" : ""),
                      role: "checkbox",
                      "aria-checked": picked.has(entry.path) ? "true" : "false",
                      "aria-label": t4("batch.pick"),
                      onClick: (event) => {
                        event.stopPropagation();
                        togglePick(entry.path);
                      },
                      onKeyDown: (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          togglePick(entry.path);
                        }
                      },
                      tabIndex: 0
                    },
                    picked.has(entry.path) ? h4(Icon, { name: "check", size: 11 }) : null
                  ),
                  h4("div", { className: "dshgn_cardTitle" }, entry.title),
                  // 正文命中次数：用户能一眼看出哪篇是「真在讲这个」，
                  // 哪篇只是顺口提了一句。
                  searchMode && entry.matchCount > 0 ? h4("span", { className: "dshgn_hitCount" }, `${entry.matchCount}`) : null
                ),
                h4(
                  "div",
                  { className: "dshgn_cardMeta" },
                  entry.date ? h4("span", null, entry.date) : null,
                  entry.dir ? h4("span", null, entry.dir) : null,
                  // 标签摆在卡片上：光看标题和目录，常常想不起这篇属于哪一摊事。
                  // 点一颗就按它筛——和左栏标签区、属性区里那几颗是同一个动作。
                  // 最多三颗，多出来的收成「+N」，否则标签多的一行会把目录挤没。
                  Array.isArray(entry.tags) && entry.tags.length > 0 ? h4(
                    "span",
                    { className: "dshgn_cardTags" },
                    entry.tags.slice(0, 3).map(
                      (tag) => h4(
                        "button",
                        {
                          key: tag,
                          type: "button",
                          className: "dshgn_cardTag",
                          title: `${t4("note.pickTag")}\uFF1A${tag}`,
                          onClick: (event) => {
                            event.stopPropagation();
                            setActiveTag(tag);
                            setActiveDir("");
                          }
                        },
                        tag
                      )
                    ),
                    entry.tags.length > 3 ? h4("span", { className: "dshgn_cardTagMore" }, `+${entry.tags.length - 3}`) : null
                  ) : null
                ),
                // 搜索态优先显示正文命中行（带行号），比摘要更能说明为什么它被搜出来
                searchMode && Array.isArray(entry.matches) && entry.matches.length > 0 ? h4(
                  "div",
                  { className: "dshgn_cardMatches" },
                  entry.matches.slice(0, 2).map(
                    (match, index) => h4(
                      "button",
                      {
                        key: `${index}-${match.line}`,
                        type: "button",
                        className: "dshgn_matchLine",
                        title: t4("search.jumpToLine"),
                        onClick: (event) => {
                          event.stopPropagation();
                          jumpToMatch(entry.path, match);
                        }
                      },
                      h4("span", { className: "dshgn_matchNo" }, String(match.line)),
                      h4("span", { className: "dshgn_matchText" }, highlightTerms(match.text, searchTerms))
                    )
                  )
                ) : entry.excerpt ? h4("div", { className: "dshgn_cardExcerpt" }, highlightTerms(entry.excerpt, searchTerms)) : null,
                // 搜索态再补一行「它引用了谁」：只给命中次数的话，用户还得点进去
                // 才知道这篇讲的是哪几篇。点胶囊直接跳过去。
                searchMode && Array.isArray(entry.links) && entry.links.length > 0 ? h4(
                  "div",
                  { className: "dshgn_cardLinks" },
                  entry.links.slice(0, 4).map(
                    (link) => h4(
                      "button",
                      {
                        key: `l-${link}`,
                        type: "button",
                        className: "dshgn_cardLinkChip",
                        title: link,
                        onClick: (event) => {
                          event.stopPropagation();
                          onOpenWikiLink(link);
                        }
                      },
                      link
                    )
                  ),
                  entry.links.length > 4 ? h4("span", { className: "dshgn_cardLinkMore" }, `+${entry.links.length - 4}`) : null
                ) : null
              )
            ),
            // 还没渲染完就放一个按钮：滚动续载之外再给个明确出口，
            // 用户知道下面确实还有东西，而不是以为列表就到这儿了。
            shown.length > shownSlice.length ? h4(
              "button",
              {
                key: "__more",
                type: "button",
                className: "dshgn_btn dshgn_moreBtn",
                onClick: () => setListLimit((prev) => prev + LIST_PAGE_SIZE)
              },
              `${t4("list.more")}\uFF08${shown.length - shownSlice.length}\uFF09`
            ) : null
          ]
        )
      ),
      h4(ColSplitter, {
        label: t4("col.listWidth"),
        value: colWidths.list,
        min: LIST_MIN_W,
        max: LIST_MAX_W,
        onChange: (next) => setColWidths((prev) => ({ ...prev, list: next }))
      }),
      h4(NotePane, {
        t: t4,
        status,
        current,
        draft,
        setDraft,
        dirty,
        busy,
        // 窄窗口里「返回列表」用：把当前笔记收起，中栏就回来了。
        // 有没保存的草稿时先问一句——收起来之后草稿就没了，而用户往往
        // 只是想看一眼列表，不是想丢掉刚写的半句。
        onClose: () => {
          if (dirty) {
            void confirmDialog(t4("note.unsaved")).then((ok) => {
              if (!ok) return;
              openSeq.current += 1;
              setCurrent(null);
              setDraft(null);
            });
            return;
          }
          openSeq.current += 1;
          setCurrent(null);
          setDraft(null);
        },
        onSave: saveNote,
        onDelete: deleteNote,
        onRename: renameNote,
        onCopyReference: copyReference,
        onDuplicate: () => duplicateNote(current === null ? "" : current.path),
        onCopyText: copyText,
        // 大纲里那一节 → 抄一条指向它的链接
        onCopyHeadingLink: copyHeadingLink,
        // 正文里划选一段 → 存成新笔记（摘抄/摘录单独立篇）
        onCreateFromText: createFromText,
        // 就地查找「到头了 / 没有这个词」要说一声：静默不动的话，
        // 用户会以为是自己敲错了词，接着反复按回车。
        showToast,
        onOpenWikiLink: openWikiLink,
        onSyncOne: syncCurrent,
        onRestored: async () => {
          await openNote(current.path);
        },
        anchor: pendingAnchor,
        onAnchorDone: () => setPendingAnchor(null),
        resolveNote: resolveNotePath,
        // 反链底下那句上下文点一下就去那一句：jumpToMatch 收的是
        // 「{ text }」这样的命中行，这里把一行字包成那个形状递过去。
        // 上下文那一行末尾可能带省略号（snippetOfLine 把过长的截断了），
        // 拿它去正文里比对是比不上的，先削掉。
        onJumpToLine: (path, line) => jumpToMatch(path, { text: String(line || "").replace(/…$/, "") }),
        // 笔记头的前进/后退。两个布尔决定按钮灰不灰，回调只管挪。
        canBack: navState.canBack,
        canForward: navState.canForward,
        onNavBack: navBack,
        onNavForward: navForward,
        // 双链补全要「库里有哪些笔记」：名字打一半时从这上面挑
        noteNames: entries.map((entry) => entry.path),
        // 标签补全要「库里已经有哪些标签」：只补用过的，凭空敲新词时没有候选。
        // 这里不走 tagCounts——那个只留前 24 个热门标签，补全时缺的正是
        // 那些不常用、用户更记不住的。
        tagNames: [...new Set(entries.flatMap((entry) => entry.tags || []))],
        onAttach: attachFiles,
        // 属性区里的标签胶囊：与左栏标签区同一个动作（筛这个标签）
        onPickTag: (tag) => {
          setActiveTag(tag);
          setActiveDir("");
          setTab("notes");
        },
        onError: (message) => setError(message),
        // 勾待办直接落盘再重读：本地文件已经变了，只改前端状态的话
        // 下次保存草稿会把旧内容写回去，把刚勾的那一下冲掉。
        onToggleTodo: async (index, done) => {
          if (current === null) return;
          try {
            await api("/todo/toggle", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ path: current.path, index })
            });
            await openNote(current.path);
            showToast(`${done ? t4("todo.done") : t4("todo.undone")}`);
          } catch (err) {
            setError(err && err.message ? err.message : String(err));
          }
        }
      })
    );
  }
  y2(() => {
    writeColWidths(colWidths);
  }, [colWidths]);
  const themeStyle = themeVars(
    themePreview !== null ? themePreview : status !== null ? status.themeColor : null,
    darkTheme
  );
  const rootStyle = {
    ...themeStyle === null ? {} : themeStyle,
    "--dshgn-treeW": `${colWidths.tree}px`,
    "--dshgn-listW": `${colWidths.list}px`
  };
  return h4(
    "div",
    { className: "dshgn_rel", ref: registerPanelRoot },
    h4(
      "div",
      {
        className: "dshgn_root",
        style: rootStyle,
        // 窄窗口的两条状态：抽屉开没开、当前有没有打开笔记。
        // 挂在根节点上而不是每个组件里判断，容器查询只负责显示/隐藏。
        "data-narrow-tree": treeOpen ? "true" : "false",
        "data-has-note": current !== null ? "true" : "false"
      },
      head,
      error2 !== null ? h4("div", { className: "dshgn_error", role: "alert" }, `${t4("error.prefix")}: ${error2}`) : null,
      // key 用 tab：切换页签时 React 会换掉整个节点，动画才会从头播一遍。
      // 不加 key 的话 React 复用同一个 DOM，transition 没有「变化」可播，
      // 表现就是切页签时内容硬跳一下。
      h4("div", { key: tab, className: "dshgn_body" }, body)
    ),
    toast !== null ? h4("div", { className: "dshgn_toast" }, h4(Icon, { name: "check", size: 13 }), toast) : null,
    // 快捷键速查表。点遮罩、按 Esc、或者再按一次 ? 都收起来。
    helpOpen ? h4(
      "div",
      { className: "dshgn_modalMask", onClick: () => setHelpOpen(false) },
      h4(
        "div",
        { className: "dshgn_modal dshgn_helpModal", role: "dialog", "aria-modal": "true", onClick: (event) => event.stopPropagation() },
        h4("div", { className: "dshgn_modalTitle" }, t4("help.title")),
        h4("div", { className: "dshgn_helpHint" }, t4("help.hint")),
        h4(
          "div",
          { className: "dshgn_helpList" },
          helpRows.map(
            (row) => h4(
              "div",
              { key: row.what, className: "dshgn_helpRow" },
              h4(
                "span",
                { className: "dshgn_helpKeys" },
                row.keys.map((key) => h4("kbd", { key, className: "dshgn_helpKey" }, key))
              ),
              h4("span", { className: "dshgn_helpWhat" }, t4(row.what))
            )
          )
        ),
        h4(
          "div",
          { className: "dshgn_modalActions" },
          h4(
            "button",
            { type: "button", className: "dshgn_btn dshgn_btnPrimary", onClick: () => setHelpOpen(false) },
            t4("action.close")
          )
        )
      )
    ) : null
  );
}
function AudioPlayer(props) {
  const { t: t4, track, onTimeChange, seekRequest, trackIndex } = props;
  const audioRef = A2(null);
  const [playing, setPlaying] = h2(false);
  const [current, setCurrent] = h2(0);
  const [duration, setDuration] = h2(track && track.duration ? track.duration : 0);
  const [failed, setFailed] = h2(false);
  const [dragging, setDragging] = h2(false);
  const [dragValue, setDragValue] = h2(0);
  const src = track ? track.url.startsWith(`${apiOrigin()}/getnote/`) ? track.url : withToken(`${apiOrigin()}/getnote/audio?url=${encodeURIComponent(track.url)}`) : null;
  y2(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(track && track.duration ? track.duration : 0);
    setFailed(false);
    const el = audioRef.current;
    if (el) {
      try {
        el.pause();
        el.currentTime = 0;
      } catch {
      }
    }
  }, [src]);
  y2(() => {
    if (!seekRequest || typeof seekRequest.time !== "number") return;
    if (typeof seekRequest.index === "number" && seekRequest.index !== (trackIndex || 0)) return;
    const el = audioRef.current;
    if (!el) return;
    const value = Math.max(0, seekRequest.time);
    try {
      el.currentTime = value;
    } catch {
    }
    setCurrent(value);
    setDragValue(value);
    const p3 = el.play();
    if (p3 && typeof p3.catch === "function") p3.catch(() => void 0);
  }, [seekRequest, trackIndex]);
  const toggle = q2(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      const p3 = el.play();
      if (p3 && typeof p3.catch === "function") p3.catch(() => setFailed(true));
    } else {
      el.pause();
    }
  }, []);
  const barRef = A2(null);
  const valueFromPointer = q2(
    (clientX) => {
      const el = barRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      if (!rect.width) return 0;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(ratio * Math.max(1, Math.round(duration)));
    },
    [duration]
  );
  const commitSeek = q2((target) => {
    const value = Math.max(0, Number(target) || 0);
    const el = audioRef.current;
    if (el) {
      try {
        el.currentTime = value;
      } catch {
      }
    }
    setCurrent(value);
  }, []);
  const onSeekDown = q2(
    (event) => {
      if (typeof event.button === "number" && event.button !== 0) return;
      const target = valueFromPointer(event.clientX);
      setDragging(true);
      setDragValue(target);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
      }
    },
    [valueFromPointer]
  );
  const onSeekMove = q2(
    (event) => {
      if (!dragging) return;
      setDragValue(valueFromPointer(event.clientX));
    },
    [dragging, valueFromPointer]
  );
  const onSeekUp = q2(
    (event) => {
      if (!dragging) return;
      const target = valueFromPointer(event.clientX);
      setDragging(false);
      setDragValue(target);
      commitSeek(target);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
      }
    },
    [dragging, valueFromPointer, commitSeek]
  );
  const onSeekKey = q2(
    (event) => {
      const max = Math.max(1, Math.round(duration));
      const base = dragging ? dragValue : current;
      let next = null;
      if (event.key === "ArrowLeft") next = Math.max(0, base - 5);
      else if (event.key === "ArrowRight") next = Math.min(max, base + 5);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = max;
      if (next === null) return;
      event.preventDefault();
      setDragValue(next);
      commitSeek(next);
    },
    [dragging, dragValue, current, duration, commitSeek]
  );
  const mmss = (sec) => {
    const s3 = Math.max(0, Math.floor(Number(sec) || 0));
    const m3 = Math.floor(s3 / 60);
    const r3 = s3 % 60;
    return `${String(m3).padStart(2, "0")}:${String(r3).padStart(2, "0")}`;
  };
  if (!track) return null;
  const maxValue = Math.max(1, Math.round(duration));
  const shown = Math.min(Math.round(dragging ? dragValue : current), maxValue);
  const percent = maxValue > 0 ? Math.max(0, Math.min(100, shown / maxValue * 100)) : 0;
  return h4(
    "div",
    { className: "dshgn_audioCard" },
    h4(
      "div",
      { className: "dshgn_audioLabel" },
      h4(Icon, { name: "audio", size: 13 }),
      h4("span", null, track.kind === "local" ? t4("note.localAudio") : t4("cloud.audio")),
      track.title ? h4("span", { className: "dshgn_treeCount" }, track.title) : null
    ),
    h4(
      "div",
      { className: "dshgn_audioBar" },
      h4(
        "button",
        {
          type: "button",
          className: "dshgn_audioBtn",
          onClick: toggle,
          title: playing ? t4("cloud.pause") : t4("cloud.play"),
          "aria-label": playing ? t4("cloud.pause") : t4("cloud.play")
        },
        h4(Icon, { name: playing ? "pause" : "play", size: 14 })
      ),
      h4(
        "div",
        {
          ref: barRef,
          className: "dshgn_audioSeek",
          role: "slider",
          tabIndex: 0,
          "aria-label": t4("cloud.audio"),
          "aria-valuemin": 0,
          "aria-valuemax": Math.max(1, Math.round(duration)),
          "aria-valuenow": Math.round(dragging ? dragValue : current),
          onPointerDown: onSeekDown,
          onPointerMove: onSeekMove,
          onPointerUp: onSeekUp,
          onPointerCancel: onSeekUp,
          onKeyDown: onSeekKey
        },
        h4(
          "div",
          { className: "dshgn_audioTrack" },
          h4("div", { className: "dshgn_audioFill", style: { width: `${percent}%` } }),
          h4("div", { className: "dshgn_audioThumb", style: { left: `${percent}%` } })
        )
      ),
      h4("span", { className: "dshgn_audioTime" }, `${mmss(dragging ? dragValue : current)} / ${mmss(duration)}`)
    ),
    failed ? h4("div", { className: "dshgn_fieldHint", style: { color: "var(--dsw-alias-state-warn-primary)" } }, track.url) : null,
    h4("audio", {
      ref: audioRef,
      src,
      preload: "metadata",
      style: { display: "none" },
      onPlay: () => setPlaying(true),
      onPause: () => setPlaying(false),
      onEnded: () => {
        setPlaying(false);
        setCurrent(0);
      },
      onError: () => setFailed(true),
      onLoadedMetadata: (event) => {
        const d3 = event.target.duration;
        if (Number.isFinite(d3) && d3 > 0) setDuration(d3);
      },
      onTimeUpdate: (event) => {
        const c3 = event.target.currentTime;
        setCurrent(c3);
        if (typeof onTimeChange === "function") onTimeChange(c3);
      }
    })
  );
}
function CloudPane(props) {
  const { t: t4, status, showToast, onError, onSynced } = props;
  const configured = status !== null && status.api !== void 0 && status.api.configured === true;
  const [list, setList] = h2([]);
  const [cursor, setCursor] = h2(null);
  const [hasMore, setHasMore] = h2(false);
  const [loading, setLoading] = h2(false);
  const [query, setQuery] = h2("");
  const [selected, setSelected] = h2(null);
  const [detail, setDetail] = h2(null);
  const [detailLoading, setDetailLoading] = h2(false);
  const [editing, setEditing] = h2(false);
  const [draftTitle, setDraftTitle] = h2("");
  const [draftBody, setDraftBody] = h2("");
  const [busy, setBusy] = h2(false);
  const [recallHits, setRecallHits] = h2(null);
  const [recalling, setRecalling] = h2(false);
  const [shareUrl, setShareUrl] = h2(null);
  const [tagDraft, setTagDraft] = h2("");
  const [topics, setTopics] = h2(null);
  const [activeTopic, setActiveTopic] = h2(null);
  const [composing, setComposing] = h2(false);
  const [newTitle, setNewTitle] = h2("");
  const [newBody, setNewBody] = h2("");
  const [playhead, setPlayhead] = h2(0);
  const [seekRequest, setSeekRequest] = h2(null);
  const loadFirst = q2(async () => {
    if (!configured) return;
    setLoading(true);
    onError(null);
    try {
      const page = await api("/cloud/list?limit=20");
      setList(Array.isArray(page.notes) ? page.notes : []);
      setCursor(page.cursor ?? null);
      setHasMore(page.hasMore === true);
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [configured, onError]);
  const loadMore = q2(async () => {
    if (!hasMore || loading) return;
    setLoading(true);
    try {
      const q4 = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const page = await api(`/cloud/list?limit=20${q4}`);
      setList((prev) => [...prev, ...Array.isArray(page.notes) ? page.notes : []]);
      setCursor(page.cursor ?? null);
      setHasMore(page.hasMore === true);
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cursor, hasMore, loading, onError]);
  y2(() => {
    void loadFirst();
  }, [loadFirst]);
  y2(() => {
    if (!configured) return void 0;
    let alive = true;
    void (async () => {
      try {
        const result = await api("/cloud/topics");
        if (alive) setTopics(Array.isArray(result.topics) ? result.topics : []);
      } catch {
      }
    })();
    return () => {
      alive = false;
    };
  }, [configured]);
  const pickTopic = q2(
    async (topic) => {
      setActiveTopic(topic);
      setRecallHits(null);
      if (topic === null) {
        await loadFirst();
        return;
      }
      setLoading(true);
      onError(null);
      try {
        const page = await api(`/cloud/topic-notes?topicId=${encodeURIComponent(topic.topicId || topic.id)}&page=1`);
        setList(Array.isArray(page.notes) ? page.notes : []);
        setCursor(null);
        setHasMore(false);
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [loadFirst, onError]
  );
  const createCloudNote = q2(async () => {
    const title = newTitle.trim();
    if (title === "") return;
    setBusy(true);
    onError(null);
    try {
      const result = await api("/cloud/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          content: newBody,
          topicId: activeTopic !== null ? activeTopic.topicId || activeTopic.id : void 0
        })
      });
      showToast(t4("cloud.created"));
      setComposing(false);
      setNewTitle("");
      setNewBody("");
      await loadFirst();
      if (result && result.noteId) {
        await openCloudNote({ noteId: String(result.noteId), title });
      }
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeTopic, loadFirst, newBody, newTitle, onError, showToast, t4]);
  const openCloudNote = q2(
    async (note, toggle = false) => {
      if (toggle && selected !== null && selected.noteId === note.noteId) {
        setSelected(null);
        setDetail(null);
        setEditing(false);
        setDetailLoading(false);
        onError(null);
        return;
      }
      setSelected(note);
      setDetail(null);
      setEditing(false);
      setDetailLoading(true);
      onError(null);
      try {
        const result = await api(`/cloud/read?id=${encodeURIComponent(note.noteId)}`);
        setDetail({ ...result.note, localPath: result.localPath || "" });
        setDraftTitle(result.note.title || "");
        setDraftBody(result.note.content || result.note.original || "");
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setDetailLoading(false);
      }
    },
    [onError, selected]
  );
  const saveCloud = q2(async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await api("/cloud/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noteId: detail.noteId, title: draftTitle, content: draftBody })
      });
      showToast(t4("cloud.savedCloud"));
      setEditing(false);
      await openCloudNote(detail);
      if (typeof onSynced === "function") onSynced();
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [detail, draftTitle, draftBody, openCloudNote, onError, onSynced, showToast, t4]);
  const deleteCloud = q2(async () => {
    if (!detail) return;
    if (!await confirmDialog(`${t4("cloud.deleteCloud")}\uFF1A${detail.title || detail.noteId}\uFF1F`)) return;
    setBusy(true);
    try {
      await api("/cloud/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noteId: detail.noteId })
      });
      showToast(t4("cloud.deletedCloud"));
      setSelected(null);
      setDetail(null);
      await loadFirst();
      if (typeof onSynced === "function") onSynced();
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [detail, loadFirst, onError, onSynced, showToast, t4]);
  const pullOne = q2(async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await api("/cloud/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noteId: detail.noteId, title: detail.title, content: detail.content || detail.original || "" })
      });
      showToast(result.local && result.local.path ? result.local.path : t4("cloud.localCopy"));
      if (typeof onSynced === "function") onSynced();
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [detail, onError, onSynced, showToast, t4]);
  const doRecall = q2(async () => {
    const q4 = query.trim();
    if (q4 === "") return;
    setRecalling(true);
    onError(null);
    try {
      const result = await api("/cloud/recall", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q4, topK: 8 })
      });
      setRecallHits(Array.isArray(result.results) ? result.results : []);
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setRecalling(false);
    }
  }, [query, onError]);
  const addCloudTag = q2(
    async (tag) => {
      const name = String(tag || "").trim();
      if (name === "" || !detail) return;
      setBusy(true);
      try {
        await api("/cloud/tags-add", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ noteId: detail.noteId, tags: [name] })
        });
        showToast(t4("cloud.tagAdded"));
        await openCloudNote(detail);
        await loadFirst();
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [detail, loadFirst, onError, openCloudNote, showToast, t4]
  );
  const removeCloudTag = q2(
    async (tag) => {
      if (!detail || !tag) return;
      const tagId = tag.id !== void 0 && tag.id !== null ? tag.id : tag.name;
      setBusy(true);
      try {
        await api("/cloud/tags-delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ noteId: detail.noteId, tagId })
        });
        showToast(t4("cloud.tagRemoved"));
        await openCloudNote(detail);
        await loadFirst();
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [detail, loadFirst, onError, openCloudNote, showToast, t4]
  );
  const shareCloud = q2(
    async (excludeAudio) => {
      if (!detail) return;
      setBusy(true);
      try {
        const result = await api("/cloud/share", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ noteId: detail.noteId, excludeAudio: excludeAudio === true })
        });
        const url = String(result.url || "");
        if (url !== "") {
          setShareUrl(url);
          try {
            await navigator.clipboard.writeText(url);
            showToast(t4("cloud.copied"));
          } catch {
            showToast(t4("cloud.shareCreated"));
          }
        } else {
          showToast(t4("cloud.shareCreated"));
        }
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [detail, onError, showToast, t4]
  );
  const pushLocalOne = q2(async () => {
    if (!detail) return;
    const localPath = detail.localPath || "";
    if (localPath === "") {
      onError(t4("cloud.noLocalCopy"));
      return;
    }
    if (!await confirmDialog(`${t4("cloud.pushLocal")}

${t4("cloud.pushHint")}`)) return;
    setBusy(true);
    try {
      await api("/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: localPath })
      });
      showToast(t4("cloud.pushed"));
      await openCloudNote(detail);
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [detail, onError, openCloudNote, showToast, t4]);
  if (!configured) {
    return h4(
      "div",
      { className: "dshgn_pane" },
      h4(
        "div",
        { className: "dshgn_banner" },
        h4(Icon, { name: "cloud", size: 26 }),
        h4("div", { className: "dshgn_emptyTitle" }, t4("cloud.notConfigured")),
        h4("div", { className: "dshgn_emptyDesc" }, t4("cloud.notConfiguredDesc"))
      )
    );
  }
  const shown = recallHits !== null ? recallHits : list;
  const listPane = h4(
    "div",
    { className: "dshgn_list" },
    h4(
      "div",
      { className: "dshgn_searchWrap" },
      h4(Icon, { name: "search", size: 14, className: "dshgn_searchIcon" }),
      h4("input", {
        className: "dshgn_search",
        type: "search",
        value: query,
        placeholder: t4("search.placeholder"),
        onChange: (event) => {
          setQuery(event.target.value);
          if (event.target.value.trim() === "") setRecallHits(null);
        },
        onKeyDown: (event) => {
          if (event.key === "Enter") void doRecall();
        }
      })
    ),
    // 知识库筛选：云端笔记是按知识库归档的，不提供筛选就只能一路翻页找
    topics !== null && topics.length > 0 ? h4(
      "div",
      { className: "dshgn_topicRow" },
      h4(
        "button",
        {
          type: "button",
          className: "dshgn_chip" + (activeTopic === null ? " dshgn_chipOn" : ""),
          onClick: () => void pickTopic(null)
        },
        t4("cloud.allTopics")
      ),
      topics.map(
        (topic) => h4(
          "button",
          {
            key: topic.topicId || topic.id,
            type: "button",
            className: "dshgn_chip" + (activeTopic !== null && (activeTopic.topicId || activeTopic.id) === (topic.topicId || topic.id) ? " dshgn_chipOn" : ""),
            onClick: () => void pickTopic(topic),
            title: topic.description || topic.name
          },
          topic.name
        )
      )
    ) : null,
    h4(
      "div",
      { className: "dshgn_rowLine", style: { padding: "4px 10px 8px" } },
      h4(
        "button",
        { type: "button", className: "dshgn_btn", onClick: doRecall, disabled: recalling || query.trim() === "" },
        recalling ? h4("span", { className: "dshgn_spin" }) : h4(Icon, { name: "search", size: 12 }),
        recallHits !== null ? `\u8BED\u4E49\u641C\u7D22 (${recallHits.length})` : "\u8BED\u4E49\u641C\u7D22"
      ),
      h4(
        "button",
        { type: "button", className: "dshgn_btn", onClick: () => setComposing(true), disabled: busy },
        h4(Icon, { name: "plus", size: 12 }),
        t4("cloud.newNote")
      ),
      recallHits !== null ? h4(
        "button",
        {
          type: "button",
          className: "dshgn_btn",
          onClick: () => {
            setRecallHits(null);
            void loadFirst();
          }
        },
        t4("action.cancel")
      ) : null
    ),
    h4(
      "div",
      { className: "dshgn_listBody" },
      loading && shown.length === 0 ? h4("div", { className: "dshgn_empty" }, h4("span", { className: "dshgn_spin" }), h4("span", null, t4("cloud.loading"))) : shown.length === 0 ? h4("div", { className: "dshgn_empty" }, h4("div", { className: "dshgn_emptyTitle" }, t4("cloud.empty"))) : shown.map(
        (note) => h4(
          "div",
          {
            key: note.noteId,
            className: "dshgn_card",
            "data-on": selected !== null && selected.noteId === note.noteId ? "true" : "false",
            onClick: () => void openCloudNote(note, true),
            title: note.noteId
          },
          h4(
            "div",
            { className: "dshgn_cardTitle" },
            note.hasAudio ? h4(Icon, { name: "audio", size: 11 }) : null,
            note.title || "(\u65E0\u6807\u9898)"
          ),
          h4(
            "div",
            { className: "dshgn_cardMeta" },
            note.updatedAt || note.createdAt ? h4("span", null, String(note.updatedAt || note.createdAt).slice(0, 10)) : null,
            note.topics && note.topics[0] ? h4("span", null, note.topics[0].name) : null,
            typeof note.score === "number" ? h4("span", null, note.score.toFixed(2)) : null
          ),
          note.tags.length > 0 ? h4("div", { className: "dshgn_cardExcerpt" }, note.tags.map((x4) => x4.name).join(" \xB7 ")) : null
        )
      )
    ),
    hasMore && recallHits === null ? h4(
      "div",
      { style: { padding: "6px 10px 10px" } },
      h4("button", { type: "button", className: "dshgn_btn", onClick: loadMore, disabled: loading }, loading ? h4("span", { className: "dshgn_spin" }) : null, t4("cloud.loadMore"))
    ) : null
  );
  const readerPane = h4(
    "div",
    { className: "dshgn_note" },
    composing ? h4(
      "div",
      { className: "dshgn_pane" },
      h4(
        "div",
        { className: "dshgn_cardBox" },
        h4(
          "div",
          { className: "dshgn_sectionHead" },
          h4("span", { className: "dshgn_sectionTitle" }, t4("cloud.newNote")),
          activeTopic !== null ? h4("span", { className: "dshgn_badge" }, activeTopic.name) : null
        ),
        h4(
          "div",
          { className: "dshgn_field" },
          h4("span", { className: "dshgn_fieldLabel" }, t4("cloud.newNoteTitle")),
          h4("input", {
            className: "dshgn_input",
            value: newTitle,
            autoFocus: true,
            onChange: (event) => setNewTitle(event.target.value)
          })
        ),
        h4(
          "div",
          { className: "dshgn_field" },
          h4("span", { className: "dshgn_fieldLabel" }, t4("cloud.newNoteBody")),
          h4("textarea", {
            className: "dshgn_textarea",
            value: newBody,
            onChange: (event) => setNewBody(event.target.value)
          })
        ),
        h4(
          "div",
          { className: "dshgn_rowLine" },
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_btn dshgn_btnPri",
              onClick: createCloudNote,
              disabled: busy || newTitle.trim() === ""
            },
            busy ? h4("span", { className: "dshgn_spin" }) : h4(Icon, { name: "check", size: 12 }),
            t4("cloud.create")
          ),
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_btn",
              onClick: () => {
                setComposing(false);
                setNewTitle("");
                setNewBody("");
              },
              disabled: busy
            },
            t4("action.cancel")
          )
        )
      )
    ) : selected === null ? h4("div", { className: "dshgn_empty" }, h4(Icon, { name: "cloud", size: 26 }), h4("div", { className: "dshgn_emptyTitle" }, t4("cloud.title")), h4("div", { className: "dshgn_emptyDesc" }, t4("cloud.desc"))) : h4(
      b,
      null,
      h4(
        "div",
        { className: "dshgn_noteHead" },
        h4("div", { className: "dshgn_notePath" }, selected.title || selected.noteId),
        detail !== null && !editing ? h4(
          b,
          null,
          h4("button", { type: "button", className: "dshgn_iconBtn", title: t4("action.edit"), onClick: () => setEditing(true), disabled: busy }, h4(Icon, { name: "edit" })),
          h4("button", { type: "button", className: "dshgn_iconBtn", title: t4("cloud.pullOne"), onClick: pullOne, disabled: busy }, h4(Icon, { name: "up" })),
          // 把本地改动推到云端：以前只能单向「云端 → 本地」，用户在本地
          // 改完笔记就没有任何办法把它送回云端，只能去得到大脑里重写一遍。
          h4("button", { type: "button", className: "dshgn_iconBtn", title: t4("cloud.pushLocal"), onClick: pushLocalOne, disabled: busy }, h4(Icon, { name: "cloud" })),
          h4("button", { type: "button", className: "dshgn_iconBtn", title: t4("cloud.deleteCloud"), onClick: deleteCloud, disabled: busy }, h4(Icon, { name: "trash" }))
        ) : null
      ),
      detailLoading ? h4("div", { className: "dshgn_emptyState" }, h4("span", { className: "dshgn_spin" }), h4("span", { style: { marginLeft: 8 } }, t4("cloud.polling"))) : detail === null ? h4("div", { className: "dshgn_emptyState" }, t4("cloud.polling")) : editing ? h4(
        "div",
        { className: "dshgn_pane" },
        h4(
          "div",
          { className: "dshgn_cardBox" },
          h4(
            "div",
            { className: "dshgn_field" },
            h4("span", { className: "dshgn_fieldLabel" }, t4("cloud.editTitle")),
            h4("input", { className: "dshgn_input", value: draftTitle, onChange: (e3) => setDraftTitle(e3.target.value) })
          ),
          h4(
            "div",
            { className: "dshgn_field" },
            h4("span", { className: "dshgn_fieldLabel" }, t4("cloud.editBody")),
            h4("textarea", { className: "dshgn_textarea", value: draftBody, onChange: (e3) => setDraftBody(e3.target.value) })
          ),
          h4(
            "div",
            { className: "dshgn_rowLine" },
            h4("button", { type: "button", className: "dshgn_btn dshgn_btnPri", onClick: saveCloud, disabled: busy }, busy ? h4("span", { className: "dshgn_spin" }) : h4(Icon, { name: "check", size: 12 }), t4("cloud.saveCloud")),
            h4("button", { type: "button", className: "dshgn_btn", onClick: () => setEditing(false), disabled: busy }, t4("action.cancel"))
          )
        )
      ) : h4(
        "div",
        { className: "dshgn_scroll" },
        h4(
          "div",
          { className: "dshgn_md" },
          h4("h1", { className: "dshgn_h dshgn_h1" }, detail.title || "(\u65E0\u6807\u9898)"),
          detail.tags.length > 0 ? h4(
            "div",
            { className: "dshgn_rowLine", style: { gap: 6, marginBottom: 12 } },
            detail.tags.map(
              (tag) => h4(
                "span",
                { key: tag.name || tag.id, className: "dshgn_tagPill" },
                tag.name,
                // 云端标签可删：用一个极小的 × 而不是整块可点，
                // 否则用户想选文字复制时会被误删掉标签。
                h4(
                  "button",
                  {
                    type: "button",
                    className: "dshgn_tagX",
                    title: t4("cloud.removeTag"),
                    disabled: busy,
                    onClick: () => void removeCloudTag(tag)
                  },
                  "\xD7"
                )
              )
            )
          ) : null,
          // 加标签：输入框 + 回车。标签是云端的一等数据，能加不能删很别扭，
          // 所以两个动作都要有。
          h4(
            "div",
            { className: "dshgn_rowLine", style: { gap: 6, marginBottom: 12 } },
            h4("input", {
              className: "dshgn_input",
              style: { maxWidth: 180, height: 26 },
              value: tagDraft,
              placeholder: t4("cloud.addTagHint"),
              onChange: (event) => setTagDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  const value = tagDraft;
                  setTagDraft("");
                  void addCloudTag(value);
                }
              }
            }),
            h4(
              "button",
              {
                type: "button",
                className: "dshgn_btn",
                disabled: busy || tagDraft.trim() === "",
                onClick: () => {
                  const value = tagDraft;
                  setTagDraft("");
                  void addCloudTag(value);
                }
              },
              h4(Icon, { name: "plus", size: 12 }),
              t4("cloud.tags")
            ),
            h4(
              "button",
              {
                type: "button",
                className: "dshgn_btn",
                disabled: busy,
                onClick: () => void shareCloud(false)
              },
              h4(Icon, { name: "link", size: 12 }),
              t4("cloud.shareLink")
            )
          ),
          // 分享出来的链接直接显示出来，用户能选中复制（剪贴板可能被拒）
          shareUrl !== null ? h4(
            "div",
            { className: "dshgn_section", style: { marginBottom: 12 } },
            h4("div", { className: "dshgn_sectionTitle" }, t4("cloud.shareCreated")),
            h4(
              "div",
              { className: "dshgn_rowLine", style: { gap: 6 } },
              h4("code", { className: "dshgn_code", style: { wordBreak: "break-all" } }, shareUrl),
              h4(
                "button",
                {
                  type: "button",
                  className: "dshgn_btn",
                  onClick: () => {
                    void navigator.clipboard.writeText(shareUrl).then(
                      () => showToast(t4("cloud.copied")),
                      () => showToast(t4("cloud.shareCreated"))
                    );
                  }
                },
                t4("cloud.copyLink")
              )
            )
          ) : null,
          // 录音优先：用户要的就是「听原声」，所以放在正文之前
          detail.audio.length > 0 ? detail.audio.map(
            (track, index) => h4(AudioPlayer, {
              key: `${track.url}-${index}`,
              t: t4,
              track,
              trackIndex: index,
              seekRequest,
              onTimeChange: (seconds) => setPlayhead(seconds)
            })
          ) : null,
          detail.audio.length > 0 ? h4("div", { style: { height: 12 } }) : null,
          detail.moments.length > 0 ? h4(
            "div",
            { className: "dshgn_section", style: { marginTop: 12 } },
            h4("div", { className: "dshgn_sectionTitle" }, t4("cloud.moments")),
            h4(
              "div",
              null,
              detail.moments.map(
                (moment, index) => h4(
                  "div",
                  { key: `m-${index}`, className: "dshgn_moment" },
                  h4("span", { className: "dshgn_momentAt" }, formatMoment(moment.startMs)),
                  h4("span", null, moment.text)
                )
              )
            )
          ) : null,
          detail.todos.length > 0 ? h4(
            "div",
            { className: "dshgn_section", style: { marginTop: 12 } },
            h4("div", { className: "dshgn_sectionTitle" }, t4("cloud.todos")),
            h4(
              "ul",
              { className: "dshgn_mdList" },
              detail.todos.map(
                (todo, index) => h4(
                  "li",
                  { key: `t-${index}`, className: "dshgn_li" },
                  h4("span", { className: "dshgn_check" + (todo.completed ? " dshgn_checkOn" : ""), style: { marginRight: 6 } }),
                  todo.text
                )
              )
            )
          ) : null,
          h4("div", { style: { height: 12 } }),
          // 云端正文常常自己就以 `# 同一个标题` 开头，上面已经渲染过 h1 了，
          // 留着就是「# 时间线」两行一样的大标题。
          detail.content ? renderMarkdown(stripLeadingHeading(detail.content, detail.title)) : null,
          detail.hasTranscript && detail.original !== detail.content ? h4(
            b,
            null,
            h4("h2", { className: "dshgn_h dshgn_h2" }, t4("cloud.transcript")),
            h4(TranscriptBlock, {
              text: detail.original,
              activeSeconds: detail.audio.length > 0 ? playhead : null,
              // 没有音轨就没有可跳的目标，别把时间戳做成按了没反应的按钮
              onSeek: detail.audio.length > 0 ? (seconds) => setSeekRequest({ time: seconds, index: 0, at: Date.now() }) : null
            })
          ) : null
        )
      )
    )
  );
  return h4("div", { className: "dshgn_body" }, listPane, readerPane);
}
function parseTranscript(text) {
  const source = String(text || "");
  const entries = [];
  for (const raw of source.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim() === "") continue;
    const match = /^([^\[]*?)\s*\[([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)\]\s*(.*)$/.exec(line);
    if (match) {
      entries.push({ speaker: match[1].trim(), stamp: match[2], body: match[3] });
      continue;
    }
    const last = entries.length > 0 ? entries[entries.length - 1] : null;
    if (last !== null && last.stamp !== null) {
      last.body = last.body === "" ? line : `${last.body} ${line}`;
    } else {
      entries.push({ speaker: "", stamp: null, body: line });
    }
  }
  return entries;
}
function stampToSeconds(stamp) {
  const parts = String(stamp || "").split(":").map((piece) => Number(piece));
  if (parts.length < 2 || parts.some((value) => !Number.isFinite(value))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}
function activeTranscriptIndex(entries, seconds) {
  if (!Array.isArray(entries) || entries.length === 0) return -1;
  if (!Number.isFinite(seconds) || seconds <= 0) return -1;
  let found = -1;
  for (let index = 0; index < entries.length; index += 1) {
    const start = stampToSeconds(entries[index].stamp);
    if (start === null) continue;
    if (start <= seconds + 0.25) found = index;
    else break;
  }
  return found;
}
function TranscriptBlock(props) {
  const text = String(props && props.text || "");
  if (text.trim() === "") return null;
  const entries = parseTranscript(text);
  if (entries.length === 0) return null;
  const onSeek = props && typeof props.onSeek === "function" ? props.onSeek : null;
  const activeSeconds = props && Number.isFinite(props.activeSeconds) ? props.activeSeconds : null;
  const activeIndex = activeSeconds === null ? -1 : activeTranscriptIndex(entries, activeSeconds);
  const t4 = getT();
  const children = entries.map((entry, index) => {
    const seconds = stampToSeconds(entry.stamp);
    const stampClass = "dshgn_ts" + (index === activeIndex ? " dshgn_tsOn" : "");
    const clickable = onSeek !== null && seconds !== null;
    const stamp = entry.stamp === null ? h4("span", { className: stampClass }) : !clickable ? h4("span", { className: stampClass }, entry.stamp) : h4(
      "button",
      {
        type: "button",
        className: stampClass + " dshgn_tsBtn",
        title: t4("cloud.seekTo"),
        "aria-label": `${t4("cloud.seekTo")} ${entry.stamp}`,
        onClick: () => {
          if (onSeek !== null && seconds !== null) onSeek(seconds);
        }
      },
      entry.stamp
    );
    return h4(
      "p",
      { key: `t${index}`, className: index === activeIndex ? "dshgn_tpOn" : void 0 },
      stamp,
      entry.speaker === "" ? null : h4("span", { className: "dshgn_speaker" }, entry.speaker),
      entry.body
    );
  });
  return h4("div", { className: "dshgn_transcript" }, children);
}
function looksLikeTranscript(text) {
  const hits = String(text || "").match(/^\s*[^\[]*\[[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\]/gm);
  return hits !== null && hits.length >= 2;
}
function formatMoment(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1e3));
  const m3 = Math.floor(total / 60);
  const s3 = total % 60;
  return `${String(m3).padStart(2, "0")}:${String(s3).padStart(2, "0")}`;
}
function LanguageCard(props) {
  const { t: t4, locale, onSaved, onError, onLocaleChange } = props;
  const [busy, setBusy] = h2(false);
  const options = [
    { id: null, label: t4("lang.auto") },
    { id: "zh", label: "\u4E2D\u6587" },
    { id: "en", label: "English" },
    { id: "nl", label: "Nederlands" }
  ];
  const pick = q2(
    async (next) => {
      if (busy) return;
      setBusy(true);
      try {
        await api("/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uiLocale: next })
        });
        onLocaleChange(next);
        await onSaved(t4("lang.saved"));
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, onError, onLocaleChange, onSaved, t4]
  );
  return h4(
    "div",
    { className: "dshgn_section" },
    h4("div", { className: "dshgn_sectionHead" }, h4("span", null, t4("lang.title"))),
    h4("div", { className: "dshgn_sectionDesc" }, t4("lang.desc")),
    h4(
      "div",
      { className: "dshgn_langRow" },
      options.map(
        (option) => h4(
          "button",
          {
            key: option.id === null ? "auto" : option.id,
            type: "button",
            className: "dshgn_chip" + (locale === option.id ? " dshgn_chipOn" : ""),
            onClick: () => void pick(option.id),
            disabled: busy
          },
          option.label
        )
      )
    )
  );
}
function FollowCard(props) {
  const { t: t4, status, onSaved, onError } = props;
  const [busy, setBusy] = h2(false);
  const on2 = status !== null && status.followActive === true;
  const flip = q2(
    async (next) => {
      if (busy) return;
      setBusy(true);
      try {
        await api("/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ followActive: next })
        });
        await onSaved(t4("settings.followSaved"));
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, onError, onSaved, t4]
  );
  return h4(
    "div",
    { className: "dshgn_section" },
    h4("div", { className: "dshgn_sectionHead" }, h4("span", null, t4("settings.followTitle"))),
    h4("div", { className: "dshgn_sectionDesc" }, t4("settings.followDesc")),
    h4(
      "label",
      { className: "dshgn_rowLine", style: { fontSize: 11.5, color: "var(--dsw-alias-label-secondary)" } },
      h4("input", {
        type: "checkbox",
        checked: on2,
        disabled: busy || status === null,
        onChange: (event) => void flip(event.target.checked === true)
      }),
      t4("settings.followToggle")
    )
  );
}
function TemplateCard(props) {
  const { t: t4, status, onSaved, onError } = props;
  const [draft, setDraft] = h2(null);
  const [busy, setBusy] = h2(false);
  const [adding, setAdding] = h2(false);
  const [name, setName] = h2("");
  const [body, setBody] = h2("");
  const saved = T2(() => {
    const list2 = status !== null && Array.isArray(status.templates) ? status.templates : [];
    return list2.filter((item) => item !== null && typeof item === "object" && typeof item.name === "string");
  }, [status]);
  const list = draft !== null ? draft : saved;
  const dirty = draft !== null;
  const add = q2(() => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    const next = list.filter((item) => item.name !== trimmed).concat([{ name: trimmed, body }]);
    setDraft(next.slice(0, 12));
    setAdding(false);
    setName("");
    setBody("");
  }, [body, list, name]);
  const remove = q2(
    (target) => {
      setDraft(list.filter((item) => item.name !== target));
    },
    [list]
  );
  const save = q2(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api("/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templates: draft !== null ? draft : [] })
      });
      setDraft(null);
      await onSaved(t4("settings.templateSaved"));
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, draft, onError, onSaved, t4]);
  return h4(
    "div",
    { className: "dshgn_section" },
    h4(
      "div",
      { className: "dshgn_sectionHead" },
      h4("span", null, t4("settings.templateTitle")),
      h4("span", { className: "dshgn_sectionHint" }, `${list.length} / 12`)
    ),
    h4("div", { className: "dshgn_sectionDesc" }, t4("settings.templateDesc")),
    list.length === 0 ? h4("div", { className: "dshgn_emptyRow" }, t4("settings.templateEmpty")) : h4(
      "div",
      { className: "dshgn_tplList" },
      list.map(
        (item) => h4(
          "div",
          { key: item.name, className: "dshgn_tplRow" },
          h4(
            "div",
            { className: "dshgn_tplMain" },
            h4("div", { className: "dshgn_tplName" }, item.name),
            h4("div", { className: "dshgn_tplBody" }, item.body || "\u2014")
          ),
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_rowBtn dshgn_rowBtnDanger",
              onClick: () => remove(item.name)
            },
            t4("settings.templateRemove")
          )
        )
      )
    ),
    adding ? h4(
      "div",
      { className: "dshgn_tplForm" },
      h4("input", {
        className: "dshgn_input",
        value: name,
        placeholder: t4("settings.templateName"),
        maxLength: 24,
        onChange: (event) => setName(event.target.value),
        onKeyDown: (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          } else if (event.key === "Escape") {
            setAdding(false);
          }
        }
      }),
      h4("div", { className: "dshgn_fieldHint" }, t4("settings.templateNameHint")),
      h4("textarea", {
        className: "dshgn_textarea",
        value: body,
        placeholder: t4("settings.templateBody"),
        rows: 5,
        maxLength: 4e3,
        onChange: (event) => setBody(event.target.value)
      }),
      h4("div", { className: "dshgn_fieldHint" }, t4("settings.templateBodyHint")),
      h4(
        "div",
        { className: "dshgn_btnRow" },
        h4(
          "button",
          { type: "button", className: "dshgn_btn dshgn_btnPri", onClick: add, disabled: name.trim() === "" },
          t4("settings.templateAdd")
        ),
        h4(
          "button",
          { type: "button", className: "dshgn_btn", onClick: () => setAdding(false) },
          t4("action.cancel")
        )
      )
    ) : h4(
      "div",
      { className: "dshgn_btnRow" },
      h4(
        "button",
        { type: "button", className: "dshgn_btn", onClick: () => setAdding(true), disabled: list.length >= 12 },
        t4("settings.templateAdd")
      ),
      h4(
        "button",
        { type: "button", className: "dshgn_btn dshgn_btnPri", onClick: () => void save(), disabled: busy || !dirty },
        t4("settings.templateSave")
      )
    )
  );
}
function CardPane(props) {
  const { t: t4, status, showToast, onError, onChanged } = props;
  const [env, setEnv] = h2(null);
  const [envBusy, setEnvBusy] = h2(false);
  const [scanning, setScanning] = h2(false);
  const [found, setFound] = h2(null);
  const [files, setFiles] = h2(null);
  const [listBusy, setListBusy] = h2(false);
  const [dir, setDir] = h2("");
  const [deleteAfter, setDeleteAfter] = h2(false);
  const [run, setRun] = h2(null);
  const timerRef = A2(null);
  const [wifiNet, setWifiNet] = h2(null);
  const [wifiBusy, setWifiBusy] = h2(false);
  const [wifiHot, setWifiHot] = h2(null);
  const [wifiManual, setWifiManual] = h2({ ssid: "", password: "" });
  const checkEnv = q2(async () => {
    setEnvBusy(true);
    try {
      const json = await api("/card/env");
      setEnv(json);
      return json;
    } catch (err) {
      setEnv({ ready: false, error: err && err.message ? err.message : String(err) });
      return null;
    } finally {
      setEnvBusy(false);
    }
  }, []);
  y2(() => {
    void checkEnv();
  }, [checkEnv]);
  y2(() => {
    if (run === null || run.running !== true) {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return void 0;
    }
    if (timerRef.current !== null) return void 0;
    timerRef.current = window.setInterval(() => {
      void api("/card/status").then((json) => {
        setRun(json);
        if (json.running !== true) {
          if (json.error) onError(json.error);
          else if (json.result) {
            showToast(`${t4("card.imported")}\uFF1A${json.result.downloaded}`);
            void onChanged();
          }
        }
      }).catch(() => {
      });
    }, 1200);
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [run, onChanged, onError, showToast, t4]);
  const doScan = q2(async () => {
    setScanning(true);
    setFound(null);
    try {
      const json = await api("/card/scan?timeout=8");
      setFound(json);
      if (Array.isArray(json.cards) && json.cards.length > 0) {
        showToast(`${t4("card.scanFound")}\uFF1A${json.cards.length}`);
        void checkEnv();
      } else {
        onError(t4("card.scanNone"));
      }
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }, [checkEnv, onError, showToast, t4]);
  const loadList = q2(async () => {
    setListBusy(true);
    try {
      const json = await api("/card/list");
      setFiles(Array.isArray(json.files) ? json.files : []);
    } catch (err) {
      setFiles([]);
      onError(err && err.message ? err.message : String(err));
    } finally {
      setListBusy(false);
    }
  }, [onError]);
  const startImport = q2(async () => {
    if (deleteAfter) {
      const ok = await confirmDialog(
        "\u5BFC\u5165\u6210\u529F\u540E\u4F1A\u628A\u5361\u7247\u4E0A\u7684\u539F\u4EF6\u6C38\u4E45\u5220\u6389\uFF0C\u4E0D\u80FD\u6062\u590D\u3002\u786E\u5B9A\u8981\u8FD9\u6837\u5417\uFF1F"
      );
      if (!ok) return;
    }
    try {
      const json = await api("/card/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true, dir, deleteAfter })
      });
      if (json.ok !== true) {
        onError(json.error || t4("card.alreadyRunning"));
        return;
      }
      setRun({ running: true, lines: [] });
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    }
  }, [deleteAfter, dir, onError, t4]);
  const wifiRefresh = q2(async () => {
    try {
      const json = await api("/card/wifi-scan");
      setWifiNet(json);
      return json;
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
      return null;
    }
  }, [onError]);
  y2(() => {
    void wifiRefresh();
  }, [wifiRefresh]);
  const wifiGo = q2(async () => {
    setWifiBusy(true);
    setWifiHot(null);
    try {
      const json = await api("/card/wifi-activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ join: true })
      });
      setWifiHot(json);
      if (json && json.ok === true && json.hotspot) {
        showToast(`${t4("card.wifiOn")}\uFF1A${json.hotspot}`);
      } else if (json && json.ok === true) {
        onError(t4("card.wifiNoHotspot"));
      } else {
        onError(json && json.error || t4("card.wifiFail"));
      }
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setWifiBusy(false);
      void wifiRefresh();
    }
  }, [onError, showToast, t4, wifiRefresh]);
  const wifiJoinManual = q2(async () => {
    const ssid = wifiManual.ssid.trim();
    if (ssid === "") {
      onError(t4("card.wifiNeedSsid"));
      return;
    }
    setWifiBusy(true);
    setWifiHot(null);
    try {
      const json = await api("/card/wifi-join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ssid,
          password: wifiManual.password === "" ? null : wifiManual.password,
          // 手动连接时留着热点：用户是主动在试，连完可能还要再点一次。
          keep: true
        })
      });
      setWifiHot(json);
      if (json && json.ok === true) showToast(`${t4("card.wifiOn")}\uFF1A${ssid}`);
      else onError(json && json.error || t4("card.wifiFail"));
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setWifiBusy(false);
      void wifiRefresh();
    }
  }, [onError, showToast, t4, wifiManual, wifiRefresh]);
  const wifiOff = q2(async () => {
    setWifiBusy(true);
    try {
      const json = await api("/card/wifi-leave", { method: "POST" });
      setWifiHot(null);
      if (json && json.ok === true) showToast(t4("card.wifiLeft"));
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setWifiBusy(false);
      void wifiRefresh();
    }
  }, [onError, showToast, t4, wifiRefresh]);
  const ready = env !== null && env.ready === true;
  const running = run !== null && run.running === true;
  const result = run !== null ? run.result : null;
  const lines = run !== null && Array.isArray(run.lines) ? run.lines : [];
  return h4(
    "div",
    { className: "dshgn_pane" },
    h4(
      "div",
      { className: "dshgn_paneInner" },
      h4("h2", { className: "dshgn_h dshgn_h2" }, t4("card.title")),
      h4("div", { className: "dshgn_paneDesc" }, t4("card.desc")),
      // ── 环境自检 ──
      h4(
        "div",
        { className: "dshgn_section" },
        h4(
          "div",
          { className: "dshgn_sectionHead" },
          h4("span", null, t4("card.envBridge")),
          h4(
            "span",
            {
              className: "dshgn_badge " + (ready ? "dshgn_badgeOk" : "dshgn_badgeWarn")
            },
            ready ? t4("card.envOk") : t4("card.envMissing")
          )
        ),
        env === null ? h4("div", { className: "dshgn_sectionDesc" }, "\u2026") : h4(
          "div",
          { className: "dshgn_sectionDesc" },
          ready ? `Python ${env.python || "?"} \xB7 bleak ${env.bleak || "?"}` : t4("card.envHint")
        ),
        !ready && env !== null && env.error ? h4("pre", { className: "dshgn_log" }, String(env.error)) : null,
        h4(
          "div",
          { className: "dshgn_row" },
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_btn",
              onClick: () => void checkEnv(),
              disabled: envBusy
            },
            t4("card.envBridge")
          ),
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_btn",
              onClick: () => void doScan(),
              disabled: scanning || !ready
            },
            scanning ? t4("card.scanning") : t4("card.scan")
          ),
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_btn",
              onClick: () => void loadList(),
              disabled: listBusy || !ready
            },
            t4("card.refresh")
          )
        ),
        found !== null && Array.isArray(found.cards) ? h4(
          "div",
          { className: "dshgn_sectionDesc" },
          found.cards.length === 0 ? t4("card.scanNone") : found.cards.map((card) => `${card.name || "?"} (${card.address || ""})`).join("  \xB7  ")
        ) : null
      ),
      // ── 热点快传 ──
      //
      // 放在「卡片上的录音」前面：传一小时录音，BLE 要四十多分钟，走热点
      // 通常一两分钟。先让人看到这条快路，再去纠结导哪几个文件。
      h4(
        "div",
        { className: "dshgn_section" },
        h4(
          "div",
          { className: "dshgn_sectionHead" },
          h4("span", null, t4("card.wifiTitle")),
          wifiNet !== null && wifiNet.current ? h4("span", { className: "dshgn_badge" }, wifiNet.current) : null
        ),
        h4("div", { className: "dshgn_sectionDesc" }, t4("card.wifiDesc")),
        // 连上之后必须一眼看到「现在挂在卡片热点上」——不然用户会以为断网。
        wifiNet !== null && wifiNet.cardLike && wifiNet.cardLike.length > 0 ? h4(
          "div",
          { className: "dshgn_sectionDesc" },
          `${t4("card.wifiAvailable")}\uFF1A${wifiNet.cardLike.join("  \xB7  ")}`
        ) : null,
        h4(
          "div",
          { className: "dshgn_row" },
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_btn dshgn_btnPri",
              onClick: () => void wifiGo(),
              disabled: wifiBusy || !ready
            },
            wifiBusy ? t4("card.wifiBusy") : t4("card.wifiGo")
          ),
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_btn",
              onClick: () => void wifiRefresh(),
              disabled: wifiBusy
            },
            t4("card.wifiRescan")
          ),
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_btn",
              onClick: () => void wifiOff(),
              disabled: wifiBusy
            },
            t4("card.wifiOff")
          )
        ),
        // 连上了但没找到服务，或者卡片热点名/密码拿不到时，手输是最后一条路。
        h4(
          "div",
          { className: "dshgn_row" },
          h4("input", {
            className: "dshgn_input",
            value: wifiManual.ssid,
            placeholder: t4("card.wifiSsid"),
            onChange: (event) => setWifiManual({ ssid: event.target.value, password: wifiManual.password })
          }),
          h4("input", {
            className: "dshgn_input",
            value: wifiManual.password,
            placeholder: t4("card.wifiPassword"),
            onChange: (event) => setWifiManual({ ssid: wifiManual.ssid, password: event.target.value })
          }),
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_btn",
              onClick: () => void wifiJoinManual(),
              disabled: wifiBusy || !ready
            },
            t4("card.wifiJoin")
          )
        ),
        wifiHot !== null && wifiHot.ok === true ? h4(
          "div",
          { className: "dshgn_sectionDesc" },
          [
            wifiHot.hotspot ? `${t4("card.wifiHotspot")}\uFF1A${wifiHot.hotspot}` : null,
            wifiHot.ip ? `IP ${wifiHot.ip}` : null,
            Array.isArray(wifiHot.openPorts) && wifiHot.openPorts.length > 0 ? `${t4("card.wifiPorts")}\uFF1A${wifiHot.openPorts.join(", ")}` : null
          ].filter(Boolean).join("  \xB7  ") || "\u2014"
        ) : null,
        // 探测到的传输服务：面板不给下载按钮（协议还没对上），但把路径摊开，
        // 让人能自己去 curl 一下看是什么。
        wifiHot !== null && Array.isArray(wifiHot.hits) && wifiHot.hits.length > 0 ? h4(
          "div",
          { className: "dshgn_fileList" },
          wifiHot.hits.map(
            (hit, index) => h4(
              "div",
              { key: `${hit.path || index}`, className: "dshgn_fileRow" },
              h4("span", { className: "dshgn_fileName" }, hit.path || "?"),
              h4(
                "span",
                { className: "dshgn_fileMeta" },
                `${hit.status || "?"} \xB7 ${formatBytes2(hit.bytes || 0)}`
              )
            )
          )
        ) : null
      ),
      // ── 卡片上的录音 ──
      h4(
        "div",
        { className: "dshgn_section" },
        h4(
          "div",
          { className: "dshgn_sectionHead" },
          h4("span", null, t4("card.pending")),
          files === null ? null : h4("span", { className: "dshgn_badge" }, String(files.length))
        ),
        files === null ? h4("div", { className: "dshgn_sectionDesc" }, "\u2014") : files.length === 0 ? h4("div", { className: "dshgn_sectionDesc" }, t4("card.none")) : h4(
          "div",
          { className: "dshgn_fileList" },
          files.map(
            (file, index) => h4(
              "div",
              { key: `${file.name || index}`, className: "dshgn_fileRow" },
              h4("span", { className: "dshgn_fileName" }, file.name || "?"),
              h4("span", { className: "dshgn_fileMeta" }, formatBytes2(file.size || 0))
            )
          )
        )
      ),
      // ── 导入 ──
      h4(
        "div",
        { className: "dshgn_section" },
        h4("div", { className: "dshgn_sectionHead" }, h4("span", null, t4("card.import"))),
        h4(
          "div",
          { className: "dshgn_field" },
          h4("div", { className: "dshgn_fieldLabel" }, t4("card.dir")),
          h4("input", {
            className: "dshgn_input",
            value: dir,
            placeholder: "\u5F55\u97F3\u5361",
            onChange: (event) => setDir(event.target.value)
          }),
          h4("div", { className: "dshgn_fieldHint" }, t4("card.dirHint"))
        ),
        // 删原件是唯一不可逆的操作，所以单独一行、默认关、开关旁写清后果。
        h4(
          "label",
          { className: "dshgn_checkRow" },
          h4("input", {
            type: "checkbox",
            checked: deleteAfter,
            onChange: (event) => setDeleteAfter(event.target.checked)
          }),
          h4("span", null, t4("card.deleteAfter"))
        ),
        h4("div", { className: "dshgn_fieldHint" }, t4("card.deleteAfterHint")),
        h4(
          "div",
          { className: "dshgn_row" },
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_btn dshgn_btnPri",
              onClick: () => void startImport(),
              disabled: running || !ready
            },
            running ? t4("card.importing") : t4("card.import")
          )
        ),
        lines.length > 0 ? h4("pre", { className: "dshgn_log" }, lines.join("\n")) : null,
        result !== null ? h4(
          "div",
          { className: "dshgn_statGrid" },
          h4(
            "div",
            { className: "dshgn_stat" },
            h4("div", { className: "dshgn_statNum" }, String(result.downloaded || 0)),
            h4("div", { className: "dshgn_statLabel" }, t4("card.downloaded"))
          ),
          h4(
            "div",
            { className: "dshgn_stat" },
            h4("div", { className: "dshgn_statNum" }, String(result.skipped || 0)),
            h4("div", { className: "dshgn_statLabel" }, t4("card.skipped"))
          ),
          h4(
            "div",
            { className: "dshgn_stat" },
            h4("div", { className: "dshgn_statNum" }, String(result.failed || 0)),
            h4("div", { className: "dshgn_statLabel" }, t4("card.failed"))
          )
        ) : null
      )
    )
  );
}
function ArchiveCard(props) {
  const { t: t4, status, onChanged, onError, showToast } = props;
  const [info, setInfo] = h2(null);
  const [busy, setBusy] = h2(false);
  const [importMode, setImportMode] = h2("rename");
  const [exportScope, setExportScope] = h2("all");
  const fileRef = A2(null);
  y2(() => {
    let alive = true;
    void api("/archive/info").then((json) => {
      if (alive) setInfo(json);
    }).catch(() => {
    });
    return () => {
      alive = false;
    };
  }, []);
  const exportZip = q2(async () => {
    setBusy(true);
    try {
      const suffix = exportScope === "notes" ? "-\u6587\u5B57" : exportScope === "assets" ? "-\u9644\u4EF6" : "";
      const url = withToken(`${apiOrigin()}/getnote/archive/export?scope=${encodeURIComponent(exportScope)}`);
      const name = "\u5F97\u5230\u5927\u8111\u5F52\u6863" + suffix + "-" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".zip";
      const saved = await saveFile(url, name);
      if (saved) {
        showToast(t4("archive.exported"));
        return;
      }
      const doc = panelDocument();
      if (doc === null || !doc.body) return;
      const anchor = doc.createElement("a");
      anchor.href = url;
      anchor.download = name;
      doc.body.appendChild(anchor);
      anchor.click();
      doc.body.removeChild(anchor);
      showToast(t4("archive.exporting"));
    } finally {
      window.setTimeout(() => setBusy(false), 1200);
    }
  }, [exportScope, showToast, t4]);
  const doImport = q2(
    async (file) => {
      if (!file) return;
      setBusy(true);
      try {
        const buffer = await file.arrayBuffer();
        const response = await fetch(`${apiOrigin()}/getnote/archive/import`, {
          method: "POST",
          headers: {
            "content-type": "application/zip",
            "x-getnote-import-mode": importMode,
            ...__apiToken === "" ? {} : { "x-getnote-token": __apiToken }
          },
          body: buffer
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
        showToast(`${t4("archive.imported")} ${json.written || 0} / ${json.skipped || 0}`);
        if (typeof onChanged === "function") await onChanged();
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [importMode, onChanged, onError, showToast, t4]
  );
  return h4(
    "div",
    { className: "dshgn_section" },
    h4(
      "div",
      { className: "dshgn_sectionHead" },
      h4("div", { className: "dshgn_sectionTitle" }, t4("archive.title")),
      h4(
        "div",
        { className: "dshgn_rowLine", style: { gap: 6 } },
        h4(
          "select",
          {
            className: "dshgn_input dshgn_selectSm",
            value: exportScope,
            title: t4("archive.scope"),
            "aria-label": t4("archive.scope"),
            onChange: (event) => setExportScope(event.target.value),
            disabled: busy
          },
          h4("option", { value: "all" }, t4("archive.scopeAll")),
          h4("option", { value: "notes" }, t4("archive.scopeNotes")),
          h4("option", { value: "assets" }, t4("archive.scopeAssets"))
        ),
        h4(
          "button",
          { type: "button", className: "dshgn_btn dshgn_btnPri", onClick: exportZip, disabled: busy },
          h4(Icon, { name: "up", size: 12 }),
          t4("archive.export")
        ),
        h4(
          "button",
          { type: "button", className: "dshgn_btn", onClick: () => fileRef.current && fileRef.current.click(), disabled: busy },
          h4(Icon, { name: "folder", size: 12 }),
          t4("archive.import")
        ),
        h4("input", {
          ref: fileRef,
          type: "file",
          accept: ".zip,application/zip",
          style: { display: "none" },
          onChange: (event) => void doImport(event.target.files && event.target.files[0])
        })
      )
    ),
    h4("div", { className: "dshgn_sectionDesc" }, t4("archive.desc")),
    info !== null ? h4(
      "div",
      { className: "dshgn_fieldHint" },
      `${info.notes} \u7BC7 \xB7 ${formatBytes2(info.bytes)}${info.assetCount > 0 ? ` \xB7 \u9644\u4EF6 ${info.assetCount} \u4E2A ${formatBytes2(info.assetBytes)}` : ""}`
    ) : null,
    h4(
      "label",
      { className: "dshgn_rowLine", style: { fontSize: 11.5, color: "var(--dsw-alias-label-secondary)" } },
      t4("archive.importMode"),
      ["rename", "skip"].map(
        (mode) => h4(
          "button",
          {
            key: mode,
            type: "button",
            className: "dshgn_chip" + (importMode === mode ? " dshgn_chipOn" : ""),
            onClick: () => setImportMode(mode),
            disabled: busy
          },
          t4(`archive.mode.${mode}`)
        )
      )
    )
  );
}
function ConflictPane(props) {
  const { t: t4, status, onChanged, onError, showToast } = props;
  const [items, setItems] = h2(null);
  const [loading, setLoading] = h2(false);
  const [busy, setBusy] = h2(false);
  const [detail, setDetail] = h2(null);
  const [diffMode, setDiffMode] = h2("rendered");
  const [resolvedOpen, setResolvedOpen] = h2(false);
  const load = q2(async () => {
    setLoading(true);
    try {
      const result = await api("/conflict/list");
      setItems(Array.isArray(result.items) ? result.items : []);
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [onError]);
  y2(() => {
    void load();
  }, [load]);
  const openDetail = q2(
    async (item) => {
      setBusy(true);
      try {
        const result = await api(`/conflict/read?path=${encodeURIComponent(item.path)}`);
        setDetail(result);
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [onError]
  );
  const resolve5 = q2(
    async (keepLocal) => {
      if (detail === null) return;
      setBusy(true);
      try {
        const result = await api("/conflict/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: detail.path, keepLocal })
        });
        showToast(keepLocal ? t4("conflict.keptLocal") : t4("conflict.tookCloud"));
        setDetail(null);
        await load();
        if (typeof onChanged === "function") await onChanged();
        return result;
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [detail, load, onChanged, onError, showToast, t4]
  );
  const undo = q2(async () => {
    if (detail === null) return;
    setBusy(true);
    try {
      await api("/conflict/unresolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: detail.path })
      });
      showToast(t4("conflict.undone"));
      try {
        const fresh = await api(`/conflict/read?path=${encodeURIComponent(detail.path)}`);
        setDetail(fresh);
      } catch {
        setDetail(null);
      }
      await load();
      if (typeof onChanged === "function") await onChanged();
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [detail, load, onChanged, onError, showToast, t4]);
  const list = items === null ? [] : items;
  const pendingItems = list.filter((item) => item.resolved !== true);
  const resolvedItems = list.filter((item) => item.resolved === true);
  const renderRow = (item) => h4(
    "div",
    {
      key: item.path,
      className: "dshgn_rowLine",
      style: {
        justifyContent: "space-between",
        padding: "7px 0",
        borderBottom: "0.5px solid var(--dsw-alias-border-l1)"
      }
    },
    h4(
      "div",
      { style: { minWidth: 0 } },
      h4(
        "div",
        { className: "dshgn_cardTitle", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
        item.originalName
      ),
      h4(
        "div",
        { className: "dshgn_cardMeta" },
        `${formatTime(item.savedAt)} \xB7 ${formatBytes2(item.bytes)}` + (item.resolved === true ? ` \xB7 ${item.keptLocal === true ? t4("conflict.pickedLocal") : t4("conflict.pickedCloud")}` : "")
      )
    ),
    h4(
      "button",
      { type: "button", className: "dshgn_btn dshgn_btnPri", onClick: () => void openDetail(item), disabled: busy },
      item.resolved === true ? t4("conflict.review") : t4("conflict.compare")
    )
  );
  if (detail !== null) {
    const archiveText = detail.body !== void 0 && detail.body !== null ? detail.body : detail.content;
    const liveText = detail.local === null || detail.local === void 0 ? null : detail.local.body !== void 0 && detail.local.body !== null ? detail.local.body : detail.local.content;
    const archiveIsCloud = detail.archiveIsCloud === true;
    const localBody = archiveIsCloud ? liveText : archiveText;
    const cloudBody = archiveIsCloud ? archiveText : liveText;
    const sideBlock = (body, emptyText) => body === null ? h4("div", { className: "dshgn_diffEmpty" }, emptyText) : diffMode === "raw" ? h4("pre", { className: "dshgn_diffBody" }, body) : h4("div", { className: "dshgn_diffBody dshgn_diffMd" }, renderBlocks(body, { assets: [] }));
    return h4(
      "div",
      { className: "dshgn_pane" },
      h4(
        "div",
        { className: "dshgn_section" },
        h4(
          "div",
          { className: "dshgn_sectionHead" },
          h4("div", { className: "dshgn_sectionTitle" }, t4("conflict.compare")),
          h4(
            "div",
            { className: "dshgn_rowLine", style: { gap: 6 } },
            // 三个按钮统一用浅色系：比对页的主角是左右两栏正文，按钮太饱和
            // 会抢注意力。未处理时两个采纳按钮都是红描边（提醒要决定），
            // 已经选过哪边就填成浅色——这个填充是「当初选了谁」的持久记号，
            // 重新打开这条冲突时依然在。
            h4(
              "button",
              {
                type: "button",
                className: "dshgn_btn " + (detail.keptLocal === true ? "dshgn_btnPale" : detail.keptLocal === false ? "dshgn_btnWarn" : "dshgn_btnWarn"),
                onClick: () => void resolve5(true),
                disabled: busy
              },
              t4("conflict.keepLocal")
            ),
            h4(
              "button",
              {
                type: "button",
                className: "dshgn_btn " + (detail.keptLocal === false ? "dshgn_btnPale" : "dshgn_btnWarn"),
                onClick: () => void resolve5(false),
                disabled: busy
              },
              t4("conflict.takeCloud")
            ),
            h4("button", { type: "button", className: "dshgn_btn", onClick: () => setDetail(null), disabled: busy }, t4("conflict.back")),
            // 已处理的条目给一个「退回未处理」：改主意是这个功能最正常的
            // 用法，没有它就只能去文件系统删 .resolved.json。
            detail.resolved === true && h4(
              "button",
              { type: "button", className: "dshgn_btn", onClick: () => void undo(), disabled: busy },
              t4("conflict.undo")
            )
          )
        ),
        h4(
          "div",
          { className: "dshgn_sectionDesc", style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
          h4("span", null, detail.originalName),
          h4("span", { className: "dshgn_dot" }, "\xB7"),
          h4("span", null, t4("conflict.savedAt")),
          h4("span", null, formatTime(detail.savedAt)),
          h4(
            "div",
            { className: "dshgn_rowLine", style: { gap: 4, marginLeft: "auto" } },
            h4(
              "button",
              {
                type: "button",
                className: "dshgn_chip" + (diffMode === "rendered" ? " dshgn_chipOn" : ""),
                onClick: () => setDiffMode("rendered")
              },
              t4("conflict.modeRendered")
            ),
            h4(
              "button",
              {
                type: "button",
                className: "dshgn_chip" + (diffMode === "raw" ? " dshgn_chipOn" : ""),
                onClick: () => setDiffMode("raw")
              },
              t4("conflict.modeRaw")
            )
          )
        )
      ),
      h4(
        "div",
        { className: "dshgn_diffRow" },
        h4(
          "div",
          { className: "dshgn_diffCol" },
          h4("div", { className: "dshgn_diffHead" }, t4("conflict.sideLocal")),
          sideBlock(localBody, t4("conflict.noLocal"))
        ),
        h4(
          "div",
          { className: "dshgn_diffCol" },
          h4("div", { className: "dshgn_diffHead" }, t4("conflict.sideCloud")),
          sideBlock(cloudBody, t4("conflict.noCloud"))
        )
      )
    );
  }
  return h4(
    "div",
    { className: "dshgn_pane" },
    h4(
      "div",
      { className: "dshgn_section" },
      h4(
        "div",
        { className: "dshgn_sectionHead" },
        h4("div", { className: "dshgn_sectionTitle" }, t4("tab.conflict")),
        h4(
          "button",
          { type: "button", className: "dshgn_btn", onClick: () => void load(), disabled: loading || busy },
          loading ? h4("span", { className: "dshgn_spin" }) : h4(Icon, { name: "refresh", size: 12 }),
          t4("action.refresh")
        )
      ),
      h4("div", { className: "dshgn_sectionDesc" }, t4("conflict.desc"))
    ),
    loading && list.length === 0 ? h4("div", { className: "dshgn_emptyState" }, h4("span", { className: "dshgn_spin" })) : list.length === 0 ? h4(
      "div",
      { className: "dshgn_empty" },
      h4(Icon, { name: "check", size: 24 }),
      h4("div", { className: "dshgn_emptyTitle" }, t4("conflict.empty")),
      h4("div", { className: "dshgn_emptyDesc" }, t4("conflict.emptyHint"))
    ) : h4(
      "div",
      { className: "dshgn_cardBox" },
      // 未处理区：直接铺开，这就是用户进来要看的东西。
      pendingItems.length === 0 ? h4(
        "div",
        { className: "dshgn_empty" },
        h4(Icon, { name: "check", size: 24 }),
        h4("div", { className: "dshgn_emptyTitle" }, t4("conflict.empty")),
        h4("div", { className: "dshgn_emptyDesc" }, t4("conflict.emptyHint"))
      ) : pendingItems.map(renderRow),
      // 已处理区：默认折叠。这些是「已经决定过」的归档，留着是为了
      // 能反悔和复查，不该占据一进页面就能看到的视觉重心。
      resolvedItems.length > 0 && h4(
        "div",
        null,
        h4(
          "button",
          {
            type: "button",
            className: "dshgn_foldHead",
            onClick: () => setResolvedOpen((prev) => !prev)
          },
          h4(
            "span",
            { className: "dshgn_foldArrow", "data-open": resolvedOpen ? "true" : "false" },
            h4(Icon, { name: "chevron", size: 12 })
          ),
          h4("span", null, t4("conflict.resolvedSection")),
          h4("span", { className: "dshgn_foldCount" }, String(resolvedItems.length))
        ),
        resolvedOpen && resolvedItems.map(renderRow)
      )
    )
  );
}
function BrokenPane(props) {
  const { t: t4, status, onError, onOpen, onOpenLine } = props;
  const [hits, setHits] = h2(null);
  const [scanned, setScanned] = h2(0);
  const [truncated, setTruncated] = h2(false);
  const [loading, setLoading] = h2(false);
  const load = q2(async () => {
    setLoading(true);
    try {
      const result = await api("/broken");
      setHits(Array.isArray(result.hits) ? result.hits : []);
      setScanned(Number(result.scanned) || 0);
      setTruncated(result.truncated === true);
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [onError]);
  y2(() => {
    void load();
  }, [load]);
  const list = hits === null ? [] : hits;
  const summary = t4("broken.found").replace("{n}", String(list.length)).replace("{scanned}", String(scanned));
  return h4(
    "div",
    { className: "dshgn_pane" },
    h4(
      "div",
      { className: "dshgn_section" },
      h4(
        "div",
        { className: "dshgn_sectionHead" },
        h4("div", { className: "dshgn_sectionTitle" }, t4("tab.broken")),
        h4(
          "button",
          { type: "button", className: "dshgn_btn", onClick: () => void load(), disabled: loading },
          loading ? h4("span", { className: "dshgn_spin" }) : h4(Icon, { name: "refresh", size: 12 }),
          t4("action.refresh")
        )
      ),
      h4("div", { className: "dshgn_sectionDesc" }, t4("broken.desc")),
      hits !== null && list.length > 0 ? h4("div", { className: "dshgn_sectionDesc" }, summary) : null,
      truncated ? h4("div", { className: "dshgn_sectionDesc" }, t4("broken.truncated")) : null
    ),
    loading && list.length === 0 ? h4("div", { className: "dshgn_emptyState" }, h4("span", { className: "dshgn_spin" })) : list.length === 0 ? h4(
      "div",
      { className: "dshgn_empty" },
      h4(Icon, { name: "check", size: 24 }),
      h4("div", { className: "dshgn_emptyTitle" }, t4("broken.empty")),
      h4("div", { className: "dshgn_emptyDesc" }, t4("broken.emptyHint"))
    ) : h4(
      "div",
      { className: "dshgn_cardBox" },
      list.map(
        (hit) => h4(
          "div",
          { key: `${hit.path}#${hit.line}#${hit.target}`, className: "dshgn_brokenLine" },
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_brokenRow",
              title: hit.path,
              onClick: () => {
                if (typeof onOpen === "function") onOpen(hit.path);
              }
            },
            h4("span", { className: "dshgn_brokenTarget" }, hit.target),
            h4("span", { className: "dshgn_brokenWhere" }, `${hit.title || hit.path} \xB7 ${t4("broken.line")} ${hit.line}`),
            hit.text === "" ? null : h4("span", { className: "dshgn_brokenSnip" }, hit.text)
          ),
          typeof onOpenLine === "function" && hit.text !== "" ? h4(
            "button",
            {
              type: "button",
              className: "dshgn_brokenJump",
              title: t4("broken.jump"),
              onClick: () => onOpenLine(hit.path, hit.text)
            },
            t4("broken.jump")
          ) : null
        )
      )
    )
  );
}
function TodoPane(props) {
  const { t: t4, status, onError, onOpen, onOpenLine, onChanged, showToast } = props;
  const [items, setItems] = h2(null);
  const [scanned, setScanned] = h2(0);
  const [truncated, setTruncated] = h2(false);
  const [loading, setLoading] = h2(false);
  const [busy, setBusy] = h2("");
  const load = q2(async () => {
    setLoading(true);
    try {
      const result = await api("/todos");
      setItems(Array.isArray(result.items) ? result.items : []);
      setScanned(Number(result.scanned) || 0);
      setTruncated(result.truncated === true);
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [onError]);
  y2(() => {
    void load();
  }, [load]);
  const tick = q2(
    async (item) => {
      const key = `${item.path}#${item.index}`;
      setBusy(key);
      try {
        await api("/todo/toggle", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: item.path, index: item.index })
        });
        setItems((prev) => prev === null ? prev : prev.filter((one) => `${one.path}#${one.index}` !== key));
        if (typeof showToast === "function") showToast(t4("todo.done"));
        if (typeof onChanged === "function") await onChanged();
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy("");
      }
    },
    [onChanged, onError, showToast, t4]
  );
  const copyAll = q2(async () => {
    const rows = items === null ? [] : items;
    if (rows.length === 0) return;
    const byNote = /* @__PURE__ */ new Map();
    for (const item of rows) {
      const key = item.path;
      if (!byNote.has(key)) byNote.set(key, []);
      byNote.get(key).push(item);
    }
    const lines = [];
    for (const [path, group] of byNote) {
      const first = group[0];
      lines.push(`## ${first.title || path}`);
      for (const item of group) lines.push(`- [ ] ${item.text}`);
      lines.push("");
    }
    const text = lines.join("\n").trim();
    try {
      await navigator.clipboard.writeText(text);
      if (typeof showToast === "function") showToast(t4("todo.copied").replace("{n}", String(rows.length)));
    } catch {
      if (typeof showToast === "function") showToast(text);
    }
  }, [items, showToast, t4]);
  const list = items === null ? [] : items;
  const summary = t4("todos.found").replace("{n}", String(list.length)).replace("{scanned}", String(scanned));
  return h4(
    "div",
    { className: "dshgn_pane" },
    h4(
      "div",
      { className: "dshgn_section" },
      h4(
        "div",
        { className: "dshgn_sectionHead" },
        h4("div", { className: "dshgn_sectionTitle" }, t4("tab.todos")),
        // 这一整份清单经常要抄去别处（周报、群里同步、贴进另一个工具）。
        // 一条条复制等于重新抄一遍，这里按屏幕上这个顺序整份抄走。
        list.length === 0 ? null : h4(
          "button",
          { type: "button", className: "dshgn_btn", title: t4("todo.copyAll"), onClick: () => void copyAll() },
          h4(Icon, { name: "copy", size: 12 }),
          t4("todo.copyAll")
        ),
        h4(
          "button",
          { type: "button", className: "dshgn_btn", onClick: () => void load(), disabled: loading },
          loading ? h4("span", { className: "dshgn_spin" }) : h4(Icon, { name: "refresh", size: 12 }),
          t4("action.refresh")
        )
      ),
      h4("div", { className: "dshgn_sectionDesc" }, t4("todos.desc")),
      items !== null && list.length > 0 ? h4("div", { className: "dshgn_sectionDesc" }, summary) : null,
      truncated ? h4("div", { className: "dshgn_sectionDesc" }, t4("todos.truncated")) : null
    ),
    loading && list.length === 0 ? h4("div", { className: "dshgn_emptyState" }, h4("span", { className: "dshgn_spin" })) : list.length === 0 ? h4(
      "div",
      { className: "dshgn_empty" },
      h4(Icon, { name: "check", size: 24 }),
      h4("div", { className: "dshgn_emptyTitle" }, t4("todos.empty")),
      h4("div", { className: "dshgn_emptyDesc" }, t4("todos.emptyHint"))
    ) : h4(
      "div",
      { className: "dshgn_cardBox" },
      list.map((item) => {
        const key = `${item.path}#${item.index}`;
        return h4(
          "div",
          { key, className: "dshgn_todoRow" },
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_check dshgn_checkHit" + (busy === key ? " dshgn_todoBusy" : ""),
              "aria-label": t4("todo.toggle"),
              title: t4("todo.toggle"),
              disabled: busy === key,
              onClick: () => void tick(item)
            },
            null
          ),
          // 一条待办摊开来看是「哪一篇的第几行」，可这句话在原文里可能
          // 埋在几十行之后。跟断链那边一样分两个可点区域：点文字去那一篇，
          // 点「去这一条」直接落到写着这条待办的那一行。
          h4(
            "div",
            { className: "dshgn_todoLine" },
            h4(
              "button",
              {
                type: "button",
                className: "dshgn_todoText",
                title: item.path,
                onClick: () => {
                  if (typeof onOpen === "function") onOpen(item.path);
                }
              },
              h4("span", { className: "dshgn_todoTitle" }, item.text),
              h4(
                "span",
                { className: "dshgn_brokenWhere" },
                `${item.title || item.path} \xB7 ${t4("broken.line")} ${item.line}`
              )
            ),
            typeof onOpenLine === "function" && String(item.text || "") !== "" ? h4(
              "button",
              {
                type: "button",
                className: "dshgn_brokenJump",
                title: t4("todo.jump"),
                onClick: () => onOpenLine(item.path, item.text)
              },
              t4("todo.jump")
            ) : null
          )
        );
      })
    )
  );
}
function TrashPane(props) {
  const { t: t4, status, onChanged, onError, showToast } = props;
  const [items, setItems] = h2(null);
  const [loading, setLoading] = h2(false);
  const [busy, setBusy] = h2(false);
  const load = q2(async () => {
    setLoading(true);
    try {
      const result = await api("/trash/list");
      setItems(Array.isArray(result.items) ? result.items : []);
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [onError]);
  y2(() => {
    void load();
  }, [load]);
  const restore = q2(
    async (item) => {
      setBusy(true);
      try {
        const result = await api("/trash/restore", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: item.path })
        });
        showToast(`${t4("trash.restored")}${result && result.path ? "\uFF1A" + result.path : ""}`);
        await load();
        if (typeof onChanged === "function") await onChanged();
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [load, onChanged, onError, showToast, t4]
  );
  const purgeOne = q2(
    async (item) => {
      if (!await confirmDialog(t4("trash.purgeOneConfirm"))) return;
      setBusy(true);
      try {
        await api("/trash/purge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: item.path })
        });
        showToast(t4("trash.purged"));
        await load();
        if (typeof onChanged === "function") await onChanged();
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [load, onChanged, onError, showToast, t4]
  );
  const purgeAll = q2(async () => {
    if (!await confirmDialog(t4("trash.purgeConfirm"))) return;
    setBusy(true);
    try {
      await api("/trash/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      showToast(t4("trash.purged"));
      await load();
      if (typeof onChanged === "function") await onChanged();
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [load, onChanged, onError, showToast, t4]);
  const list = items === null ? [] : items;
  return h4(
    "div",
    { className: "dshgn_pane" },
    h4(
      "div",
      { className: "dshgn_section" },
      h4(
        "div",
        { className: "dshgn_sectionHead" },
        h4("div", { className: "dshgn_sectionTitle" }, t4("tab.trash")),
        h4(
          "div",
          { className: "dshgn_rowLine", style: { gap: 6 } },
          h4(
            "button",
            { type: "button", className: "dshgn_btn", onClick: () => void load(), disabled: loading || busy },
            loading ? h4("span", { className: "dshgn_spin" }) : h4(Icon, { name: "refresh", size: 12 }),
            t4("action.refresh")
          ),
          h4(
            "button",
            { type: "button", className: "dshgn_btn dshgn_btnDanger", onClick: purgeAll, disabled: busy || list.length === 0 },
            h4(Icon, { name: "trash", size: 12 }),
            t4("trash.purgeAll")
          )
        )
      ),
      h4("div", { className: "dshgn_sectionDesc" }, t4("trash.desc"))
    ),
    loading && list.length === 0 ? h4("div", { className: "dshgn_emptyState" }, h4("span", { className: "dshgn_spin" })) : list.length === 0 ? h4(
      "div",
      { className: "dshgn_empty" },
      h4(Icon, { name: "trash", size: 24 }),
      h4("div", { className: "dshgn_emptyTitle" }, t4("trash.empty")),
      h4("div", { className: "dshgn_emptyDesc" }, t4("trash.emptyHint"))
    ) : h4(
      "div",
      { className: "dshgn_cardBox" },
      list.map(
        (item) => h4(
          "div",
          { key: item.path, className: "dshgn_rowLine", style: { justifyContent: "space-between", padding: "7px 0", borderBottom: "0.5px solid var(--dsw-alias-border-l1)" } },
          h4(
            "div",
            { style: { minWidth: 0 } },
            h4("div", { className: "dshgn_cardTitle", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, item.title || item.originalName),
            h4(
              "div",
              { className: "dshgn_cardMeta" },
              `${t4("trash.deletedAt")} ${formatTime(item.trashedAt)} \xB7 ${formatBytes2(item.bytes)}`
            )
          ),
          h4(
            "div",
            { className: "dshgn_rowLine", style: { gap: 6, flex: "none" } },
            h4(
              "button",
              { type: "button", className: "dshgn_btn dshgn_btnPri", onClick: () => void restore(item), disabled: busy },
              h4(Icon, { name: "up", size: 12 }),
              t4("trash.restore")
            ),
            h4(
              "button",
              { type: "button", className: "dshgn_btn dshgn_btnDanger", onClick: () => void purgeOne(item), disabled: busy },
              t4("trash.purgeOne")
            )
          )
        )
      )
    )
  );
}
function SyncPane(props) {
  const { t: t4, status, onChanged, onError, showToast } = props;
  const configured = status !== null && status.api !== void 0 && status.api.configured === true;
  const auto = status !== null && status.autoSync ? status.autoSync : { enabled: false, minutes: 15, incremental: true };
  const [enabled, setEnabled] = h2(auto.enabled === true);
  const [minutes, setMinutes] = h2(auto.minutes || 15);
  const [incremental, setIncremental] = h2(auto.incremental !== false);
  const [foregroundOnly, setForegroundOnly] = h2(auto.foregroundOnly === true);
  const [fullScan, setFullScan] = h2(false);
  const [running, setRunning] = h2(auto.running === true);
  const [lastResult, setLastResult] = h2(auto.lastResult || null);
  const [lastError, setLastError] = h2(auto.lastError || null);
  const [busy, setBusy] = h2(false);
  y2(() => {
    if (!running) return void 0;
    const timer = window.setInterval(async () => {
      try {
        const state = await api("/sync/status");
        if (state.running !== true) {
          setRunning(false);
          setLastResult(state.lastResult || null);
          setLastError(state.lastError || null);
          if (typeof onChanged === "function") await onChanged();
        }
      } catch {
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [running, onChanged]);
  const persist = q2(
    async (next) => {
      try {
        await api("/sync/auto", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next)
        });
        if (typeof onChanged === "function") await onChanged();
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      }
    },
    [onChanged, onError]
  );
  const toggle = q2(() => {
    const next = !enabled;
    setEnabled(next);
    void persist({ enabled: next, minutes, incremental });
    showToast(next ? `${t4("sync.enabled")} \xB7 ${minutes}${t4("sync.minutes")}` : t4("sync.enabled"));
  }, [enabled, minutes, incremental, persist, showToast, t4]);
  const changeMinutes = q2(
    (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      const clamped = Math.min(Math.max(Math.round(parsed), 5), 720);
      setMinutes(clamped);
      if (enabled) void persist({ enabled: true, minutes: clamped, incremental });
    },
    [enabled, incremental, persist]
  );
  const runNow = q2(async () => {
    setBusy(true);
    setLastError(null);
    try {
      await api("/sync/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ full: fullScan })
      });
      setRunning(true);
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [fullScan, onError]);
  const [pushReport, setPushReport] = h2(null);
  const pushAll = q2(async () => {
    if (!await confirmDialog(`${t4("sync.pushAll")}

${t4("sync.pushAllHint")}`)) return;
    setBusy(true);
    setLastError(null);
    try {
      const json = await api("/sync/push-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dir: "", limit: 200 })
      });
      setPushReport(json);
      showToast(`${t4("sync.pushAllDone")}\uFF1A${json.pushed}`);
      if (typeof onChanged === "function") await onChanged();
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [onChanged, onError, showToast, t4]);
  const resultStats = lastResult ? [
    { label: t4("sync.pulled"), num: lastResult.pulled ?? 0 },
    { label: t4("sync.skipped"), num: lastResult.skipped ?? 0 },
    { label: t4("sync.adopted"), num: lastResult.adopted ?? 0 },
    { label: t4("sync.conflicts"), num: lastResult.conflicts ?? 0 },
    { label: t4("sync.deleted"), num: lastResult.deleted ?? 0 },
    { label: t4("sync.errors"), num: lastResult.errors ?? 0 }
  ] : [];
  return h4(
    b,
    null,
    h4(
      "div",
      { className: "dshgn_section" },
      h4("div", { className: "dshgn_sectionTitle" }, t4("sync.title")),
      h4("div", { className: "dshgn_sectionDesc" }, t4("sync.desc")),
      h4(
        "div",
        { className: "dshgn_toggleRow" },
        h4(
          "div",
          { className: "dshgn_toggleLabel" },
          h4("span", { className: "dshgn_toggleTitle" }, t4("sync.enabled")),
          h4(
            "span",
            { className: "dshgn_toggleDesc" },
            status !== null && status.api && status.api.lastRunAt ? `${t4("sync.lastRun")}: ${formatTime(status.api.lastRunAt)}` : `${t4("sync.lastRun")}: ${t4("sync.never")}`
          )
        ),
        h4("button", {
          type: "button",
          className: "dshgn_toggle",
          "data-on": enabled ? "true" : "false",
          onClick: toggle,
          disabled: !configured,
          "aria-label": t4("sync.enabled")
        })
      ),
      h4(
        "div",
        { className: "dshgn_rowLine" },
        h4("span", { className: "dshgn_fieldLabel" }, t4("sync.interval")),
        h4("input", {
          className: "dshgn_input",
          style: { flex: "none", width: 76 },
          type: "number",
          min: 5,
          max: 720,
          step: 5,
          value: minutes,
          onChange: (e3) => changeMinutes(e3.target.value),
          disabled: !configured
        }),
        h4("span", { className: "dshgn_fieldHint" }, t4("sync.minutes")),
        [5, 15, 60].map(
          (preset) => h4(
            "button",
            {
              key: preset,
              type: "button",
              className: "dshgn_chip" + (minutes === preset ? " dshgn_chipOn" : ""),
              onClick: () => changeMinutes(preset),
              disabled: !configured
            },
            `${preset}${t4("sync.minutes")}`
          )
        )
      ),
      h4(
        "label",
        { className: "dshgn_rowLine", style: { fontSize: 11.5, color: "var(--dsw-alias-label-secondary)" } },
        h4("input", {
          type: "checkbox",
          checked: incremental,
          onChange: (e3) => {
            setIncremental(e3.target.checked);
            void persist({ enabled, minutes, incremental: e3.target.checked });
          },
          disabled: !configured
        }),
        t4("sync.incremental")
      ),
      h4(
        "label",
        { className: "dshgn_rowLine", style: { fontSize: 11.5, color: "var(--dsw-alias-label-secondary)" } },
        h4("input", {
          type: "checkbox",
          checked: foregroundOnly,
          onChange: (e3) => {
            setForegroundOnly(e3.target.checked);
            void persist({ enabled, minutes, incremental, foregroundOnly: e3.target.checked });
          },
          disabled: !configured
        }),
        t4("sync.foregroundOnly")
      ),
      h4("div", { className: "dshgn_fieldHint" }, t4("sync.foregroundHint")),
      h4("div", { className: "dshgn_fieldHint" }, t4("sync.quotaHint"))
    ),
    h4(
      "div",
      { className: "dshgn_section" },
      h4(
        "div",
        { className: "dshgn_rowLine" },
        h4("button", { type: "button", className: "dshgn_btn dshgn_btnPri", onClick: runNow, disabled: busy || running || !configured }, running ? h4("span", { className: "dshgn_spin" }) : h4(Icon, { name: "sync", size: 12 }), running ? t4("sync.running") : t4("sync.now")),
        h4("button", { type: "button", className: "dshgn_btn", onClick: pushAll, disabled: busy || running || !configured, title: t4("sync.pushAllHint") }, t4("sync.pushAll")),
        h4(
          "label",
          { className: "dshgn_rowLine", style: { fontSize: 11.5, color: "var(--dsw-alias-label-secondary)" } },
          h4("input", { type: "checkbox", checked: fullScan, onChange: (e3) => setFullScan(e3.target.checked), disabled: !configured }),
          t4("sync.fullScan")
        )
      ),
      !configured ? h4("div", { className: "dshgn_fieldHint" }, t4("cloud.notConfiguredDesc")) : null,
      lastError !== null ? h4("div", { className: "dshgn_error" }, lastError) : null,
      resultStats.length > 0 ? h4("div", { className: "dshgn_statGrid" }, resultStats.map((s3) => h4("div", { key: s3.label, className: "dshgn_stat" }, h4("span", { className: "dshgn_statNum" }, String(s3.num)), h4("span", { className: "dshgn_statLabel" }, s3.label)))) : null,
      pushReport !== null ? h4(
        "div",
        { className: "dshgn_fieldHint" },
        `${t4("sync.pushAllDone")}\uFF1A${t4("sync.pushAllPushed")} ${pushReport.pushed}\uFF0C${t4("sync.pushAllSkipped")} ${pushReport.skipped}${pushReport.failed > 0 ? `\uFF0C${t4("sync.pushAllFailed")} ${pushReport.failed}` : ""}${pushReport.truncated ? `\uFF08${t4("sync.pushAllTruncated")}\uFF09` : ""}`
      ) : null,
      lastResult !== null && lastResult.at ? h4("div", { className: "dshgn_fieldHint" }, `${t4("sync.result")}: ${formatTime(lastResult.at)}`) : null
    ),
    h4(LegacyImport)
  );
  function LegacyImport() {
    const [open, setOpen] = h2(false);
    if (configured || !open) {
      return h4(
        "div",
        { className: "dshgn_rowLine", style: { justifyContent: "center" } },
        h4("button", { type: "button", className: "dshgn_btn", onClick: () => setOpen(true) }, t4("sync.legacy")),
        h4("span", { className: "dshgn_fieldHint" }, t4("sync.legacyHint"))
      );
    }
    return h4(ImportPane, {
      t: t4,
      status,
      onRefresh: async () => {
        if (typeof onChanged === "function") await onChanged();
      },
      onDone: () => {
        if (typeof onChanged === "function") void onChanged();
      }
    });
  }
}
function SkeletonPane(props) {
  const { t: t4 } = props;
  const row = (width, height) => h4("div", { className: "dshgn_skRow", style: { width, height } });
  return h4(
    "div",
    { className: "dshgn_body", "aria-busy": "true", "aria-label": t4("panel.loading") },
    h4(
      "div",
      { className: "dshgn_tree dshgn_skTree" },
      row("60%", "10px"),
      row("82%", "10px"),
      row("70%", "10px"),
      row("76%", "10px"),
      row("54%", "10px")
    ),
    h4(
      "div",
      { className: "dshgn_list dshgn_skList" },
      h4(
        "div",
        { className: "dshgn_skCard" },
        row("72%", "12px"),
        row("40%", "9px"),
        row("92%", "9px")
      ),
      h4(
        "div",
        { className: "dshgn_skCard" },
        row("58%", "12px"),
        row("34%", "9px"),
        row("86%", "9px")
      ),
      h4(
        "div",
        { className: "dshgn_skCard" },
        row("66%", "12px"),
        row("46%", "9px"),
        row("80%", "9px")
      )
    ),
    h4(
      "section",
      { className: "dshgn_note dshgn_skNote" },
      row("46%", "18px"),
      row("100%", "10px"),
      row("96%", "10px"),
      row("88%", "10px"),
      row("100%", "10px"),
      row("72%", "10px")
    )
  );
}
function HeatmapStrip(props) {
  const { t: t4, heatmap } = props;
  if (heatmap === null || heatmap === void 0 || !Array.isArray(heatmap.days) || heatmap.days.length === 0) {
    return null;
  }
  const WEEKS = 16;
  const days = heatmap.days.slice(-(WEEKS * 7));
  const level = (count) => {
    if (count <= 0) return 0;
    if (count === 1) return 1;
    if (count === 2) return 2;
    if (count <= 4) return 3;
    return 4;
  };
  return h4(
    "div",
    { className: "dshgn_heat" },
    h4(
      "div",
      { className: "dshgn_heatHead" },
      h4("span", { className: "dshgn_heatTitle" }, t4("heat.title")),
      h4(
        "span",
        { className: "dshgn_heatStat", title: `${heatmap.total} ${t4("heat.totalHint")}` },
        `${heatmap.streak} ${t4("heat.streak")}`
      )
    ),
    h4(
      "div",
      { className: "dshgn_heatGrid", style: { gridTemplateRows: "repeat(7, 1fr)", gridAutoFlow: "column" } },
      days.map(
        (day) => h4("span", {
          key: day.date,
          className: "dshgn_heatCell",
          "data-lv": String(level(day.count)),
          "data-future": day.future === true ? "true" : "false",
          title: `${day.date} \xB7 ${day.count} ${t4("heat.unit")}`
        })
      )
    )
  );
}
var LIST_PAGE_SIZE = 60;
var NAV_LIMIT = 40;
var TREE_MIN_W = 150;
var TREE_MAX_W = 360;
var LIST_MIN_W = 200;
var LIST_MAX_W = 520;
var COL_WIDTH_KEY = "dshgn.colWidths";
function readColWidths() {
  const fallback = { tree: 204, list: 260 };
  try {
    const raw = window.localStorage.getItem(COL_WIDTH_KEY);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    const num = (value, min, max, def) => {
      const n2 = Number(value);
      return Number.isFinite(n2) && n2 >= min && n2 <= max ? Math.round(n2) : def;
    };
    return {
      tree: num(parsed && parsed.tree, TREE_MIN_W, TREE_MAX_W, fallback.tree),
      list: num(parsed && parsed.list, LIST_MIN_W, LIST_MAX_W, fallback.list)
    };
  } catch {
    return fallback;
  }
}
function writeColWidths(widths) {
  try {
    window.localStorage.setItem(COL_WIDTH_KEY, JSON.stringify(widths));
  } catch {
  }
}
var SESSION_KEY = "dshgn.session";
var SESSION_TABS = ["notes", "cloud", "settings", "card", "conflict", "broken", "todos", "trash"];
function readSession() {
  const empty = { tab: "", dir: "", tag: "", path: "" };
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (raw === null) return empty;
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return empty;
    const str = (value) => typeof value === "string" ? value : "";
    const tab = str(parsed.tab);
    return {
      tab: SESSION_TABS.includes(tab) ? tab : "",
      dir: str(parsed.dir),
      tag: str(parsed.tag),
      path: str(parsed.path)
    };
  } catch {
    return empty;
  }
}
function writeSession(patch) {
  try {
    const prev = readSession();
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ ...prev, ...patch }));
  } catch {
  }
}
var SCROLL_KEY = "dshgn.scroll";
var SCROLL_KEEP = 40;
function readScrollMarks() {
  try {
    const raw = window.localStorage.getItem(SCROLL_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item !== null && typeof item === "object" && typeof item.path === "string" && typeof item.top === "number" && item.top >= 0).slice(0, SCROLL_KEEP);
  } catch {
    return [];
  }
}
function scrollMarkOf(path) {
  const rel = typeof path === "string" ? path : "";
  if (rel === "") return 0;
  const hit = readScrollMarks().find((item) => item.path === rel);
  return hit === void 0 ? 0 : hit.top;
}
function writeScrollMark(path, top) {
  const rel = typeof path === "string" ? path : "";
  if (rel === "") return;
  const value = Math.max(0, Math.round(Number(top) || 0));
  try {
    const rest = readScrollMarks().filter((item) => item.path !== rel);
    window.localStorage.setItem(SCROLL_KEY, JSON.stringify([{ path: rel, top: value }, ...rest].slice(0, SCROLL_KEEP)));
  } catch {
  }
}
var DRAFT_KEY = "dshgn.drafts";
var DRAFT_KEEP = 5;
var DRAFT_MAX = 2e5;
function readDrafts() {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item !== null && typeof item === "object" && typeof item.path === "string" && typeof item.content === "string").slice(0, DRAFT_KEEP);
  } catch {
    return [];
  }
}
function draftOf(path) {
  const rel = typeof path === "string" ? path : "";
  if (rel === "") return null;
  const hit = readDrafts().find((item) => item.path === rel);
  return hit === void 0 ? null : hit;
}
function writeDraft(path, content) {
  const rel = typeof path === "string" ? path : "";
  if (rel === "" || typeof content !== "string") return;
  if (content.length > DRAFT_MAX) return;
  try {
    const rest = readDrafts().filter((item) => item.path !== rel);
    const next = [{ path: rel, content, at: Date.now() }, ...rest].slice(0, DRAFT_KEEP);
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  } catch {
  }
}
function dropDraft(path) {
  const rel = typeof path === "string" ? path : "";
  if (rel === "") return;
  try {
    const rest = readDrafts().filter((item) => item.path !== rel);
    if (rest.length === 0) window.localStorage.removeItem(DRAFT_KEY);
    else window.localStorage.setItem(DRAFT_KEY, JSON.stringify(rest));
  } catch {
  }
}
function ColSplitter(props) {
  const { label, value, min, max, onChange } = props;
  const clamp = (n2) => Math.max(min, Math.min(max, Math.round(n2)));
  const onPointerDown = (event) => {
    if (typeof event.button === "number" && event.button !== 0) return;
    const startX = event.clientX;
    const base = value;
    const el = event.currentTarget;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
    }
    el.classList.add("dshgn_splitterOn");
    const move = (moveEvent) => onChange(clamp(base + (moveEvent.clientX - startX)));
    const stop = () => {
      el.classList.remove("dshgn_splitterOn");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", stop);
      el.removeEventListener("pointercancel", stop);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
    event.preventDefault();
  };
  const onKeyDown = (event) => {
    const step = event.shiftKey ? 32 : 8;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onChange(clamp(value - step));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onChange(clamp(value + step));
    }
  };
  return h4("button", {
    type: "button",
    className: "dshgn_splitter",
    "aria-label": label,
    "aria-orientation": "vertical",
    title: label,
    onPointerDown,
    onKeyDown
  });
}
function TreePane(props) {
  const {
    t: t4,
    tree,
    dirs,
    entries,
    activeDir,
    activeTag,
    tagCounts,
    dirSort,
    tagSort,
    onDirSortChange,
    onTagSortChange,
    onPickDir,
    onPickTag,
    onCreateDir,
    onDeleteDir,
    onDeleteTag,
    onCreateTag,
    onRenameTag,
    onRenameDir,
    heatmap,
    currentNoteId,
    onNarrowPick,
    onMoveNoteTo
  } = props;
  const total = Array.isArray(entries) ? entries.length : 0;
  const picked = (fn2) => (arg) => {
    fn2(arg);
    if (typeof onNarrowPick === "function") onNarrowPick();
  };
  const [menu, setMenu] = h2(null);
  const [confirm, setConfirm] = h2(null);
  const [creating, setCreating] = h2(null);
  const [draft, setDraft] = h2("");
  const [busy, setBusy] = h2(false);
  const [renaming, setRenaming] = h2(null);
  const [dropOn, setDropOn] = h2("");
  const [folded, setFolded] = h2(() => /* @__PURE__ */ new Set());
  const toggleFold = (path) => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  y2(() => {
    if (menu === null) return void 0;
    const close = () => setMenu(null);
    const offClick = attachOnPanelWindows("click", close);
    const offScroll = attachOnPanelWindows("scroll", close, true);
    return () => {
      offClick();
      offScroll();
    };
  }, [menu]);
  const openMenu = (event, kind, name) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ kind, name });
  };
  const flat = T2(() => {
    const latest = (path) => {
      let max = 0;
      for (const entry of entries) {
        if (entry.path === path || entry.path.startsWith(`${path}/`)) {
          if (entry.mtimeMs > max) max = entry.mtimeMs;
        }
      }
      return max;
    };
    const compare = (a3, b3) => {
      if (dirSort === "name") return a3.name.localeCompare(b3.name, "zh");
      if (dirSort === "count") return b3.count - a3.count || a3.name.localeCompare(b3.name, "zh");
      return latest(b3.path) - latest(a3.path) || a3.name.localeCompare(b3.name, "zh");
    };
    const list = [];
    const walk = (node, depth) => {
      const dirsOnly = (node.children || []).filter((child) => child.kind === "dir");
      dirsOnly.sort(compare);
      for (const child of dirsOnly) {
        const kids = (child.children || []).filter((one) => one.kind === "dir");
        list.push({ path: child.path, name: child.name, depth, count: child.count, hasKids: kids.length > 0 });
        if (kids.length > 0 && folded.has(child.path)) continue;
        walk(child, depth + 1);
      }
    };
    if (tree) walk(tree, 0);
    if (list.length === 0 && Array.isArray(dirs)) {
      const fallback = [];
      for (const dir of dirs) {
        if (dir === "") continue;
        fallback.push({ path: dir, name: dir, depth: 0, count: entries.filter((e3) => e3.path.startsWith(`${dir}/`)).length });
      }
      fallback.sort(compare);
      list.push(...fallback);
    }
    return list;
  }, [tree, dirs, entries, dirSort, folded]);
  const sortedTags = T2(() => {
    const copy = [...tagCounts];
    if (tagSort === "name") {
      copy.sort((a3, b3) => a3[0].localeCompare(b3[0], "zh"));
    } else if (tagSort === "count") {
      copy.sort((a3, b3) => b3[1] - a3[1] || a3[0].localeCompare(b3[0], "zh"));
    } else {
      const latest = (tag) => {
        let max = 0;
        for (const entry of entries) {
          if ((entry.tags || []).includes(tag) && entry.mtimeMs > max) max = entry.mtimeMs;
        }
        return max;
      };
      copy.sort((a3, b3) => latest(b3[0]) - latest(a3[0]) || a3[0].localeCompare(b3[0], "zh"));
    }
    return copy;
  }, [tagCounts, entries, tagSort]);
  const tagTree = T2(() => {
    const root = { children: /* @__PURE__ */ new Map() };
    const ensure = (segments) => {
      let node = root;
      for (const segment of segments) {
        if (!node.children.has(segment)) {
          node.children.set(segment, { name: segment, children: /* @__PURE__ */ new Map() });
        }
        node = node.children.get(segment);
      }
      return node;
    };
    for (const [tag, count] of tagCounts) ensure(String(tag).split("/")).count = count;
    const latest = (path) => {
      let max = 0;
      for (const entry of entries) {
        const tags = entry.tags || [];
        if (tags.includes(path) && entry.mtimeMs > max) max = entry.mtimeMs;
      }
      return max;
    };
    const rows = [];
    const walk = (node, prefix, depth) => {
      const items = [...node.children.values()];
      items.sort((a3, b3) => {
        const pa = prefix === "" ? a3.name : `${prefix}/${a3.name}`;
        const pb = prefix === "" ? b3.name : `${prefix}/${b3.name}`;
        if (tagSort === "name") return pa.localeCompare(pb, "zh");
        if (tagSort === "count") return (b3.count || 0) - (a3.count || 0) || pa.localeCompare(pb, "zh");
        return latest(pb) - latest(pa) || pa.localeCompare(pb, "zh");
      });
      for (const item of items) {
        const path = prefix === "" ? item.name : `${prefix}/${item.name}`;
        let sum = item.count || 0;
        const total2 = (node2) => {
          for (const child of node2.children.values()) {
            sum += child.count || 0;
            total2(child);
          }
        };
        total2(item);
        rows.push({ path, label: item.name, depth, count: sum });
        walk(item, path, depth + 1);
      }
    };
    walk(root, "", 0);
    return rows;
  }, [tagCounts, entries, tagSort]);
  const runCreate = async () => {
    const name = draft.trim();
    if (name === "") {
      setCreating(null);
      return;
    }
    setBusy(true);
    try {
      if (creating === "dir") await onCreateDir(name);
      else await onCreateTag(name);
      setCreating(null);
      setDraft("");
    } finally {
      setBusy(false);
    }
  };
  const runDelete = async () => {
    if (confirm === null) return;
    setBusy(true);
    try {
      if (confirm.kind === "dir") await onDeleteDir(confirm.name);
      else await onDeleteTag(confirm.name);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };
  const runRename = async () => {
    if (renaming === null) return;
    const to = String(renaming.to || "").trim();
    if (to === "" || to === renaming.from) {
      setRenaming(null);
      return;
    }
    setBusy(true);
    try {
      if (renaming.kind === "dir") {
        if (typeof onRenameDir === "function") await onRenameDir(renaming.from, to);
      } else if (typeof onRenameTag === "function") {
        await onRenameTag(renaming.from, to);
      }
      setRenaming(null);
    } finally {
      setBusy(false);
    }
  };
  const rowMenu = () => {
    const target = menu;
    if (target === null) return null;
    return h4(
      "span",
      { className: "dshgn_rowMenu", onClick: (event) => event.stopPropagation() },
      // 「改名」两种行都有：标签改名是改几十篇的 frontmatter，目录改名是搬一整棵
      // 子树（连同底下的笔记、子目录、版本历史），后端各有一条路，界面同一颗按钮。
      target.kind === "tag" && typeof onRenameTag === "function" || target.kind === "dir" && typeof onRenameDir === "function" ? h4(
        "button",
        {
          type: "button",
          className: "dshgn_rowBtn",
          title: t4("tree.menuRename"),
          onClick: () => {
            setRenaming({ kind: target.kind, from: target.name, to: target.name });
            setMenu(null);
          }
        },
        h4(Icon, { name: "edit", size: 11 }),
        h4("span", null, t4("tree.menuRename"))
      ) : null,
      // 「在文件列表里定位」：面板的列表是平的，用户想知道这个目录在库里
      // 的哪儿、旁边还有什么时，把它交给宿主的文件列表比自己解释路径直观。
      // 只给目录：标签不是文件，宿主那边没有可定位的东西。
      target.kind === "dir" && hasRevealInVault() ? h4(
        "button",
        {
          type: "button",
          className: "dshgn_rowBtn",
          title: t4("tree.menuReveal"),
          onClick: () => {
            revealInVault(target.name);
            setMenu(null);
          }
        },
        h4(Icon, { name: "external-link", size: 11 }),
        h4("span", null, t4("tree.menuReveal"))
      ) : null,
      h4(
        "button",
        {
          type: "button",
          className: "dshgn_rowBtn dshgn_rowBtnDanger",
          title: target.kind === "dir" ? t4("tree.deleteDir") : t4("tree.deleteTag"),
          onClick: () => {
            setConfirm({ kind: target.kind, name: target.name });
            setMenu(null);
          }
        },
        h4(Icon, { name: "trash", size: 11 }),
        h4("span", null, t4("tree.menuDelete"))
      ),
      h4(
        "button",
        {
          type: "button",
          className: "dshgn_rowBtn",
          title: t4("tree.menuCancel"),
          onClick: () => setMenu(null)
        },
        h4(Icon, { name: "close", size: 11 }),
        h4("span", null, t4("tree.menuCancel"))
      )
    );
  };
  const headActions = (kind, label, canCreate) => {
    const mode = kind === "dir" ? dirSort : tagSort;
    const setMode = kind === "dir" ? onDirSortChange : onTagSortChange;
    const nextMode = mode === "time" ? "name" : mode === "name" ? "count" : "time";
    return h4(
      "div",
      { className: "dshgn_treeHeadRight" },
      h4(
        "button",
        {
          type: "button",
          className: "dshgn_treeSort",
          title: `${t4("tree.sort")}\uFF1A${t4(`tree.sort${mode === "time" ? "Time" : mode === "name" ? "Name" : "Count"}`)}`,
          onClick: () => setMode(nextMode)
        },
        mode === "time" ? "\u23F1" : mode === "name" ? "A\u2192Z" : "#"
      ),
      canCreate ? h4(
        "button",
        {
          type: "button",
          className: "dshgn_treeAdd",
          title: label,
          "aria-label": label,
          onClick: () => {
            setCreating(kind);
            setDraft("");
          }
        },
        h4(Icon, { name: "plus", size: 12 })
      ) : null
    );
  };
  return h4(
    "aside",
    { className: "dshgn_tree" },
    h4(
      "div",
      {
        className: "dshgn_treeRow",
        "data-on": activeDir === "" && activeTag === "" ? "true" : "false",
        onClick: picked(() => onPickDir(""))
      },
      h4(Icon, { name: "brain", size: 14 }),
      h4("span", { className: "dshgn_treeName" }, t4("tree.all")),
      h4("span", { className: "dshgn_treeCount" }, String(total))
    ),
    // 热力图放在「全部笔记」正下方：它是「这个库整体在长」的视角，
    // 跟下面按目录/标签切分是两种维度，夹在中间会让人以为它属于某个目录。
    h4(HeatmapStrip, { t: t4, heatmap }),
    // 目录区
    h4(
      "div",
      { className: "dshgn_treeHead" },
      h4("span", { className: "dshgn_treeHeadTitle" }, t4("tree.dirs")),
      headActions("dir", t4("tree.newDir"), true)
    ),
    creating === "dir" ? h4(
      "div",
      { className: "dshgn_treeNew" },
      h4("input", {
        className: "dshgn_treeNewInput",
        type: "text",
        autoFocus: true,
        value: draft,
        placeholder: t4("tree.newDirHint"),
        onChange: (event) => setDraft(event.target.value),
        onKeyDown: (event) => {
          if (event.key === "Enter") void runCreate();
          if (event.key === "Escape") setCreating(null);
        }
      }),
      h4(
        "button",
        { type: "button", className: "dshgn_treeNewOk", onClick: () => void runCreate(), disabled: busy },
        h4(Icon, { name: "check", size: 12 })
      ),
      h4(
        "button",
        { type: "button", className: "dshgn_treeNewCancel", onClick: () => setCreating(null), disabled: busy },
        h4(Icon, { name: "close", size: 12 })
      )
    ) : null,
    flat.map(
      (node) => (
        // 正在改名的那一行整行换成输入框：和标签那边同一套做法——名字就写在
        // 它原来待的位置，用户不用在「哪一行」和「输入框在哪」之间对一次眼。
        renaming !== null && renaming.kind === "dir" && renaming.from === node.path ? h4(
          "span",
          { key: node.path, className: "dshgn_treeNew" },
          h4("input", {
            className: "dshgn_treeNewInput",
            type: "text",
            autoFocus: true,
            value: renaming.to,
            placeholder: node.name,
            onChange: (event) => setRenaming({ kind: "dir", from: node.path, to: event.target.value }),
            onKeyDown: (event) => {
              if (event.key === "Enter") void runRename();
              if (event.key === "Escape") setRenaming(null);
            }
          }),
          h4(
            "button",
            { type: "button", className: "dshgn_treeNewOk", onClick: () => void runRename(), disabled: busy },
            h4(Icon, { name: "check", size: 12 })
          ),
          h4(
            "button",
            { type: "button", className: "dshgn_treeNewCancel", onClick: () => setRenaming(null), disabled: busy },
            h4(Icon, { name: "close", size: 12 })
          )
        ) : h4(
          "div",
          {
            key: node.path,
            className: "dshgn_treeRow",
            "data-on": activeDir === node.path ? "true" : "false",
            "data-drop": dropOn === node.path ? "true" : "false",
            // 折叠箭头占 12px：同一层的名字必须对齐，所以没有子目录的行也
            // 留出这段空位（摆一个等宽的占位 span），而不是让它往前挪一格。
            style: { paddingLeft: `${7 + node.depth * 11 + 12}px` },
            onClick: picked(() => onPickDir(node.path)),
            onContextMenu: (event) => openMenu(event, "dir", node.path),
            // 卡片拖到这一行上就把它挪进这个目录。只认面板自己带的私有类型：
            // 从宿主文件树拖过来的文件也走 dragover，但那是「导入」，不是「挪」。
            onDragOver: (event) => {
              if (typeof onMoveNoteTo !== "function") return;
              if (!dragCarriesNote(event.dataTransfer)) return;
              event.preventDefault();
              event.stopPropagation();
              try {
                event.dataTransfer.dropEffect = "move";
              } catch {
              }
              if (dropOn !== node.path) setDropOn(node.path);
            },
            onDragLeave: () => {
              if (dropOn === node.path) setDropOn("");
            },
            onDrop: (event) => {
              setDropOn("");
              if (typeof onMoveNoteTo !== "function") return;
              if (!dragCarriesNote(event.dataTransfer)) return;
              event.preventDefault();
              event.stopPropagation();
              let dragged = "";
              try {
                dragged = String(event.dataTransfer.getData(DRAG_MIME) || "");
              } catch {
              }
              if (dragged === "") return;
              onMoveNoteTo(dragged, node.path);
            },
            title: `${node.path}
${t4("tree.menuDelete")}\uFF1A\u53F3\u952E`
          },
          // 折叠箭头：只有底下还有目录的行才摆。按钮里不能套按钮，
          // 所以它自己是一颗 button，点它只折叠、不选目录（stopPropagation）。
          node.hasKids ? h4(
            "button",
            {
              type: "button",
              className: "dshgn_treeFold",
              title: folded.has(node.path) ? t4("tree.unfold") : t4("tree.fold"),
              "aria-label": folded.has(node.path) ? t4("tree.unfold") : t4("tree.fold"),
              "aria-expanded": folded.has(node.path) ? "false" : "true",
              "data-folded": folded.has(node.path) ? "true" : "false",
              onClick: (event) => {
                event.stopPropagation();
                toggleFold(node.path);
              },
              onContextMenu: (event) => {
                openMenu(event, "dir", node.path);
              }
            },
            h4(Icon, { name: "chevron", size: 11 })
          ) : h4("span", { className: "dshgn_treeFoldGap" }),
          h4(Icon, { name: "folder", size: 13 }),
          h4("span", { className: "dshgn_treeName" }, node.name),
          menu !== null && menu.kind === "dir" && menu.name === node.path ? rowMenu() : h4("span", { className: "dshgn_treeCount" }, String(node.count))
        )
      )
    ),
    // 标签区
    h4(
      "div",
      { className: "dshgn_treeHead" },
      h4("span", { className: "dshgn_treeHeadTitle" }, t4("tree.tags")),
      headActions("tag", t4("tree.newTag"), true)
    ),
    creating === "tag" ? h4(
      "div",
      { className: "dshgn_treeNew" },
      h4("input", {
        className: "dshgn_treeNewInput",
        type: "text",
        autoFocus: true,
        value: draft,
        placeholder: t4("tree.newTagHint"),
        onChange: (event) => setDraft(event.target.value),
        onKeyDown: (event) => {
          if (event.key === "Enter") void runCreate();
          if (event.key === "Escape") setCreating(null);
        }
      }),
      h4(
        "button",
        { type: "button", className: "dshgn_treeNewOk", onClick: () => void runCreate(), disabled: busy },
        h4(Icon, { name: "check", size: 12 })
      ),
      h4(
        "button",
        { type: "button", className: "dshgn_treeNewCancel", onClick: () => setCreating(null), disabled: busy },
        h4(Icon, { name: "close", size: 12 })
      )
    ) : null,
    tagTree.length > 0 ? h4(
      "div",
      { className: "dshgn_treeTags" },
      // 标签项外面包一层 span：行内菜单里也是按钮，button 不能套 button
      // （HTML 非法，React 会警告，点击也会被外层吞掉）。
      tagTree.map(
        ({ path: tag, label, depth, count }) => renaming !== null && renaming.from === tag ? h4(
          "span",
          { key: tag, className: "dshgn_treeNew" },
          h4("input", {
            className: "dshgn_treeNewInput",
            type: "text",
            autoFocus: true,
            value: renaming.to,
            placeholder: tag,
            onChange: (event) => setRenaming({ from: tag, to: event.target.value }),
            onKeyDown: (event) => {
              if (event.key === "Enter") void runRename();
              if (event.key === "Escape") setRenaming(null);
            }
          }),
          h4(
            "button",
            { type: "button", className: "dshgn_treeNewOk", onClick: () => void runRename(), disabled: busy },
            h4(Icon, { name: "check", size: 12 })
          ),
          h4(
            "button",
            { type: "button", className: "dshgn_treeNewCancel", onClick: () => setRenaming(null), disabled: busy },
            h4(Icon, { name: "close", size: 12 })
          )
        ) : h4(
          "span",
          { key: tag, className: "dshgn_tagWrap" },
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_tagRow",
              // 缩进用 padding 而不是 margin：胶囊自己会截断宽度，
              // 用 margin 缩进时右边留给省略号的空间跟着变窄，长标签
              // 在不同层级里被切掉的字数不一样，看着很乱。
              style: depth > 0 ? { paddingLeft: `${8 + depth * 8}px` } : void 0,
              "data-nest": depth > 0 ? "true" : void 0,
              "data-on": activeTag === tag ? "true" : "false",
              // 摊平之后只看得到最后一段，「读书/摘抄」显示成「摘抄」，
              // 悬停要能看出它到底属于哪一条。
              title: tag,
              onClick: picked(() => onPickTag(activeTag === tag ? "" : tag)),
              onContextMenu: (event) => openMenu(event, "tag", tag)
            },
            `${label} ${count}`
          ),
          menu !== null && menu.kind === "tag" && menu.name === tag ? rowMenu() : null
        )
      )
    ) : null,
    // 二次确认
    confirm !== null ? h4(
      "div",
      { className: "dshgn_modalMask", onClick: () => setConfirm(null) },
      h4(
        "div",
        { className: "dshgn_modal", onClick: (event) => event.stopPropagation() },
        h4(
          "div",
          { className: "dshgn_modalTitle" },
          confirm.kind === "dir" ? t4("tree.deleteDir") : t4("tree.deleteTag")
        ),
        h4(
          "div",
          { className: "dshgn_modalBody" },
          (confirm.kind === "dir" ? t4("tree.deleteDirConfirm") : t4("tree.deleteTagConfirm")).replace(
            "{name}",
            confirm.name
          )
        ),
        h4(
          "div",
          { className: "dshgn_modalActions" },
          h4(
            "button",
            { type: "button", className: "dshgn_btn", onClick: () => setConfirm(null), disabled: busy },
            t4("action.cancel")
          ),
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_btn dshgn_btnDanger",
              onClick: () => void runDelete(),
              disabled: busy
            },
            t4("action.delete")
          )
        )
      )
    ) : null
  );
}
function NotePane(props) {
  const { t: t4, status, current, draft, setDraft, dirty, busy, onSave, onRename, onDelete, onCopyReference, onCopyText, onOpenWikiLink: onOpenWikiLink2, onSyncOne, onRestored, onError, onToggleTodo, onClose, onAttach, showToast } = props;
  const canBack = props.canBack === true;
  const canForward = props.canForward === true;
  const onNavBack = typeof props.onNavBack === "function" ? props.onNavBack : null;
  const onNavForward = typeof props.onNavForward === "function" ? props.onNavForward : null;
  const onJumpToLine = typeof props.onJumpToLine === "function" ? props.onJumpToLine : null;
  const onCreateFromText = typeof props.onCreateFromText === "function" ? props.onCreateFromText : null;
  const onDuplicate = typeof props.onDuplicate === "function" ? props.onDuplicate : null;
  const onCopyHeadingLink = typeof props.onCopyHeadingLink === "function" ? props.onCopyHeadingLink : null;
  const anchorRequest = props.anchor;
  const onAnchorDone = props.onAnchorDone;
  const resolveNote = props.resolveNote;
  const onPickTag = props.onPickTag;
  const noteNames = Array.isArray(props.noteNames) ? props.noteNames : [];
  const tagNames = Array.isArray(props.tagNames) ? props.tagNames : [];
  const subfolder = status !== null && typeof status.subfolder === "string" ? status.subfolder.replace(/^\/+|\/+$/g, "") : "";
  const vaultPathOf = (note) => {
    const rel = note !== null && typeof note.path === "string" ? note.path : "";
    if (rel === "") return subfolder;
    return subfolder === "" ? rel : `${subfolder}/${rel}`;
  };
  const [editing, setEditing] = h2(false);
  const [showOutline, setShowOutline] = h2(true);
  const [showProps, setShowProps] = h2(true);
  const [backlinks, setBacklinks] = h2(null);
  const [outlinks, setOutlinks] = h2(null);
  const scrollRef = A2(null);
  const [textScale, setTextScale] = h2(() => {
    try {
      const saved = window.localStorage.getItem("dshgn.textScale");
      return saved === "s" || saved === "l" ? saved : "m";
    } catch {
      return "m";
    }
  });
  const [historyOpen, setHistoryOpen] = h2(false);
  const [historyItems, setHistoryItems] = h2(null);
  const [historyPreview, setHistoryPreview] = h2(null);
  const [historyBusy, setHistoryBusy] = h2(false);
  const attachRef = A2(null);
  const [zoom, setZoom] = h2(null);
  const zoomRef = A2(null);
  const stepZoomRef = A2(() => {
  });
  const editorRef = A2(null);
  const [linkPick, setLinkPick] = h2(null);
  const linkHits = linkPick === null ? [] : wikilinkMatches(noteNames, linkPick.query);
  const [tagPick, setTagPick] = h2(null);
  const tagHits = tagPick === null ? [] : tagMatches(tagNames, tagPick.query);
  const pickHits = linkPick !== null && linkHits.length > 0 ? linkHits : tagHits;
  const pickActive = linkPick !== null && linkHits.length > 0 ? linkPick.active : tagPick === null ? 0 : tagPick.active;
  const [findOpen, setFindOpen] = h2(false);
  const [findText, setFindText] = h2("");
  const [findHit, setFindHit] = h2(null);
  const findInputRef = A2(null);
  const findOpenRef = A2(false);
  findOpenRef.current = findOpen;
  const closeFind = q2(() => {
    setFindOpen(false);
    setFindHit(null);
    if (!editingRef.current) return;
    const live = editorRef.current;
    if (live === null || live === void 0) return;
    try {
      live.focus();
    } catch {
    }
  }, []);
  const canAttach = typeof onAttach === "function";
  const closeZoom = q2(() => setZoom(null), []);
  const [zoomList, setZoomList] = h2([]);
  const openZoom = q2((item) => {
    const host = scrollRef.current;
    const all = [];
    if (host !== null && host !== void 0 && typeof host.querySelectorAll === "function") {
      const nodes = host.querySelectorAll("img");
      for (let i3 = 0; i3 < nodes.length; i3 += 1) {
        const node = nodes[i3];
        const src = String(node.getAttribute("src") || "");
        if (src === "") continue;
        if (all.some((one) => one.src === src)) continue;
        all.push({ src, name: String(node.getAttribute("alt") || "") });
      }
    }
    const wanted = item !== null && item !== void 0 && typeof item.src === "string" ? item.src : "";
    setZoomList(wanted === "" ? [] : all);
    setZoom(item);
  }, []);
  const zoomIndex = zoom === null ? -1 : zoomList.findIndex((one) => one.src === zoom.src);
  const stepZoom = q2((delta) => {
    setZoom((live) => {
      if (live === null) return null;
      const at = zoomList.findIndex((one) => one.src === live.src);
      if (at === -1 || zoomList.length < 2) return live;
      const next = (at + delta + zoomList.length) % zoomList.length;
      return { ...zoomList[next], path: live.path };
    });
  }, [zoomList]);
  stepZoomRef.current = stepZoom;
  const placeCaret = q2((start, end) => {
    const place = () => {
      const live = editorRef.current;
      if (live === null || live === void 0) return;
      try {
        live.setSelectionRange(start, end);
      } catch {
      }
    };
    place();
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(place);
  }, []);
  const applyLinkPick = q2((hit) => {
    const live = editorRef.current;
    if (live === null || live === void 0 || hit === null || hit === void 0) return;
    const source = linkPick !== null && linkHits.length > 0 ? linkPick : tagPick;
    if (source === null || source === void 0) return;
    const caret = typeof live.selectionStart === "number" ? live.selectionStart : live.value.length;
    const head = live.value.slice(0, source.start);
    const tail = live.value.slice(caret);
    const inserted = `${hit.insert}${typeof hit.close === "string" ? hit.close : "]]"}`;
    setDraft(head + inserted + tail);
    placeCaret(head.length + inserted.length, head.length + inserted.length);
    setLinkPick(null);
    setTagPick(null);
  }, [linkHits.length, linkPick, placeCaret, setDraft, tagPick]);
  const runFind = q2((forward) => {
    const text = findText.trim();
    if (text === "") return;
    if (editingRef.current) {
      const live = editorRef.current;
      if (live === null || live === void 0) return;
      const caret = typeof live.selectionStart === "number" ? live.selectionStart : 0;
      const selEnd = typeof live.selectionEnd === "number" ? live.selectionEnd : caret;
      const found = findInText(live.value, text, caret, selEnd, forward);
      if (found === null) {
        const any = live.value.toLowerCase().indexOf(text.toLowerCase()) !== -1;
        showToast(any ? t4("note.findEnd") : t4("note.findMiss").replace("{text}", text));
        setFindHit(null);
        return;
      }
      live.focus();
      try {
        live.setSelectionRange(found.start, found.end);
      } catch {
      }
      const line = live.value.slice(0, found.start).split("\n").length - 1;
      const style = typeof window.getComputedStyle === "function" ? window.getComputedStyle(live) : null;
      const lineHeight = style === null ? 0 : Number.parseFloat(style.lineHeight);
      const step = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 20;
      live.scrollTop = Math.max(0, line * step - live.clientHeight / 2);
      setFindHit({
        index: countTextMatches(live.value.slice(0, found.start), text) + 1,
        total: countTextMatches(live.value, text)
      });
      return;
    }
    const matches = findAllBodyMatches(scrollRef.current, text);
    const hit = findInBody(scrollRef.current, text, forward);
    if (hit === null) {
      const any = findInBodyMatch(scrollRef.current, text, true) !== null || findInBodyMatch(scrollRef.current, text, false) !== null;
      showToast(any ? t4("note.findEnd") : t4("note.findMiss").replace("{text}", text));
      setFindHit(matches.length === 0 ? null : { index: matches.length, total: matches.length });
      return;
    }
    const at = matches.indexOf(hit);
    setFindHit({ index: at === -1 ? 1 : at + 1, total: matches.length });
  }, [findText, showToast, t4]);
  y2(() => {
    if (!findOpen) return void 0;
    const focus = () => {
      const live = findInputRef.current;
      if (live !== null && live !== void 0) live.focus();
    };
    focus();
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(focus);
    return void 0;
  }, [findOpen]);
  const editingRef = A2(false);
  editingRef.current = editing;
  y2(() => {
    const onKey = (event) => {
      const lower = String(event.key || "").toLowerCase();
      if (lower !== "f" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (editingRef.current) return;
      const target = event.target;
      const tag = target !== null && target !== void 0 && typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (target !== null && target !== void 0 && target.isContentEditable === true) return;
      event.preventDefault();
      setFindOpen(true);
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
          const live = findInputRef.current;
          if (live !== null && live !== void 0) live.focus();
        });
      }
    };
    return attachOnPanelWindows("keydown", onKey);
  }, []);
  y2(() => {
    const onKey = (event) => {
      if (zoomRef.current === null) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        setZoom(null);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        stepZoomRef.current(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    return attachOnPanelWindows("keydown", onKey);
  }, []);
  const currentPathOf = current === null || current === void 0 ? "" : String(current.path || "");
  zoomRef.current = zoom !== null && zoom.path === currentPathOf ? zoom : null;
  const findPathRef = A2(currentPathOf);
  y2(() => {
    const prev = findPathRef.current;
    findPathRef.current = currentPathOf;
    if (prev === "" || prev === currentPathOf) return;
    setFindOpen(false);
    setFindText("");
  }, [currentPathOf]);
  const [selPop, setSelPop] = h2(null);
  y2(() => {
    if (editing || currentPathOf === "") {
      setSelPop(null);
      return void 0;
    }
    const clear = () => setSelPop(null);
    const onUp = (event) => {
      const node = event && event.target;
      if (node && typeof node.closest === "function" && node.closest(".dshgn_selPop") !== null) return;
      const sel = typeof window.getSelection === "function" ? window.getSelection() : null;
      const text = sel === null || sel === void 0 ? "" : String(sel.toString() || "").trim();
      if (text === "") {
        setSelPop(null);
        return;
      }
      const host = scrollRef.current;
      if (!host) {
        setSelPop(null);
        return;
      }
      const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      const holder = range === null ? null : range.commonAncestorContainer;
      if (holder === null || holder === void 0 || !host.contains(holder)) {
        setSelPop(null);
        return;
      }
      let x4 = typeof event.clientX === "number" ? event.clientX : 0;
      let y3 = typeof event.clientY === "number" ? event.clientY : 0;
      if (typeof range.getBoundingClientRect === "function") {
        const box = range.getBoundingClientRect();
        if (box && (box.width > 0 || box.height > 0)) {
          x4 = box.left + box.width / 2;
          y3 = box.top;
        }
      }
      setSelPop({ text, x: Math.max(8, Math.round(x4)), y: Math.max(8, Math.round(y3)) });
    };
    const offUp = attachOnPanelWindows("mouseup", onUp);
    const offScroll = attachOnPanelWindows("scroll", clear, true);
    return () => {
      offUp();
      offScroll();
    };
  }, [currentPathOf, editing]);
  const [stashFound, setStashFound] = h2(null);
  const [stashHandled, setStashHandled] = h2("");
  y2(() => {
    const path = currentPathOf;
    if (path === "") return void 0;
    const timer = window.setTimeout(() => {
      if (stashHandled === path) return;
      const stashed = draftOf(path);
      const onDisk = current !== null ? String(current.content || "") : "";
      if (stashed === null || stashed.content === onDisk) {
        setStashFound(null);
        return;
      }
      setStashFound({ path, content: stashed.content, at: Number(stashed.at) || 0 });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [currentPathOf, current, stashHandled]);
  y2(() => {
    if (!editing) return void 0;
    const path = currentPathOf;
    if (path === "" || draft === null) return void 0;
    const timer = window.setTimeout(() => {
      const onDisk = current !== null ? String(current.content || "") : "";
      if (draft === onDisk) dropDraft(path);
      else writeDraft(path, draft);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [currentPathOf, current, draft, editing]);
  const [activeHeading, setActiveHeading] = h2(-1);
  const restoringRef = A2(false);
  const scrollTopRef = A2(0);
  const saveTimerRef = A2(0);
  const zoomed = zoom !== null && zoom.path === currentPathOf ? zoom : null;
  const loadHistory = q2(async (path) => {
    if (path === null || path === "") {
      setHistoryItems(null);
      return;
    }
    try {
      const json = await api(`/history/list?path=${encodeURIComponent(path)}`);
      setHistoryItems(Array.isArray(json.items) ? json.items : []);
    } catch {
      setHistoryItems([]);
    }
  }, []);
  const previewHistory = q2(
    async (name) => {
      if (current === null) return;
      setHistoryBusy(true);
      try {
        const json = await api(`/history/read?path=${encodeURIComponent(current.path)}&name=${encodeURIComponent(name)}`);
        setHistoryPreview(json);
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setHistoryBusy(false);
      }
    },
    [current, onError]
  );
  const restoreHistory = q2(
    async (name) => {
      if (current === null) return;
      setHistoryBusy(true);
      try {
        await api("/history/restore", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: current.path, name, keepCurrent: true })
        });
        setHistoryPreview(null);
        setHistoryOpen(false);
        await loadHistory(current.path);
        if (typeof onRestored === "function") await onRestored();
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setHistoryBusy(false);
      }
    },
    [current, loadHistory, onError, onRestored]
  );
  const pickScale = q2((next) => {
    setTextScale(next);
    try {
      window.localStorage.setItem("dshgn.textScale", next);
    } catch {
    }
  }, []);
  y2(() => {
    if (!editing) return void 0;
    const onKey = (event) => {
      const meta = event.ctrlKey || event.metaKey;
      if (meta && String(event.key).toLowerCase() === "s") {
        event.preventDefault();
        if (!busy && dirty) void onSave();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDraft(current !== null ? current.content : null);
        setEditing(false);
        dropDraft(current !== null ? String(current.path || "") : "");
      }
    };
    return attachOnPanelWindows("keydown", onKey);
  }, [busy, current, dirty, editing, onSave, setDraft]);
  y2(() => {
    const onKey = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (String(event.key).toLowerCase() !== "e") return;
      if (current === null) return;
      event.preventDefault();
      if (!editing) {
        setEditing(true);
        return;
      }
      const leave = () => setEditing(false);
      if (dirty && !busy) void Promise.resolve(onSave()).then(leave, leave);
      else leave();
    };
    return attachOnPanelWindows("keydown", onKey);
  }, [busy, current, dirty, editing, onSave]);
  const pathKey = current !== null ? current.path : null;
  const [lastPathKey, setLastPathKey] = h2(pathKey);
  if (lastPathKey !== pathKey) {
    setLastPathKey(pathKey);
    setEditing(false);
    setHistoryOpen(false);
    setHistoryItems(null);
    setHistoryPreview(null);
  }
  const currentPath = current !== null ? current.path : null;
  y2(() => {
    if (currentPath === null) {
      setBacklinks(null);
      return void 0;
    }
    let alive = true;
    setBacklinks(null);
    const scanLocally = () => {
      void api(`/backlinks?path=${encodeURIComponent(currentPath)}`).then((json) => {
        if (alive) setBacklinks(json);
      }).catch(() => {
        if (alive) setBacklinks({ hits: [] });
      });
    };
    const hosted = backlinksViaHost(currentPath);
    if (hosted !== null) {
      if (typeof hosted.then === "function") {
        void hosted.then((json) => {
          if (!alive) return;
          if (json === null || json === void 0) scanLocally();
          else setBacklinks(json);
        }).catch(() => {
          if (alive) scanLocally();
        });
      } else {
        setBacklinks(hosted);
      }
      return () => {
        alive = false;
      };
    }
    scanLocally();
    return () => {
      alive = false;
    };
  }, [currentPath]);
  y2(() => {
    if (currentPath === null) {
      setOutlinks(null);
      return void 0;
    }
    const hosted = linksViaHost(currentPath);
    if (hosted !== null && Array.isArray(hosted.links)) {
      setOutlinks(hosted.links);
      return void 0;
    }
    setOutlinks(Array.isArray(current.links) ? current.links : []);
    return void 0;
  }, [current, currentPath]);
  const outlinkChips = T2(() => {
    const list = Array.isArray(outlinks) ? outlinks : [];
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const raw of list) {
      const text = String(raw === null || raw === void 0 ? "" : raw).trim();
      if (text === "" || seen.has(text)) continue;
      seen.add(text);
      const dead = typeof resolveNote === "function" ? resolveNote(text) === "" : false;
      out.push({ text, dead });
    }
    return out;
  }, [outlinks, resolveNote]);
  const propRows = T2(() => {
    const data = current !== null && current.frontmatter !== null && typeof current.frontmatter === "object" ? current.frontmatter : {};
    const rows = [];
    for (const key of Object.keys(data)) {
      const raw = data[key];
      const text = frontmatterText(raw);
      if (text === "") continue;
      let tags = null;
      if (isTagKey(key)) {
        const list = Array.isArray(raw) ? raw : String(raw === null || raw === void 0 ? "" : raw).split(/[,，\s]+/);
        tags = list.map((item) => String(item === null || item === void 0 ? "" : item).trim()).filter((item) => item !== "");
        if (tags.length === 0) tags = null;
      }
      rows.push({ key, text, tags });
    }
    return rows;
  }, [current]);
  const readWords = T2(() => {
    if (current === null || current === void 0) return 0;
    const body = current.body !== void 0 && current.body !== null ? current.body : current.content;
    return countWords(body);
  }, [current]);
  const jumpToHeading = q2((index) => {
    const host = scrollRef.current;
    if (!host) return;
    const heads = headingNodes(host);
    const target = heads[index];
    if (!target) return;
    setActiveHeading(index);
    const offset = target.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop - 8;
    host.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
  }, []);
  y2(() => {
    const host = scrollRef.current;
    if (!host || currentPathOf === "") return void 0;
    const want = scrollMarkOf(currentPathOf);
    scrollTopRef.current = want;
    if (want <= 0) {
      host.scrollTop = 0;
      return void 0;
    }
    restoringRef.current = true;
    host.scrollTop = want;
    const frame = window.requestAnimationFrame(() => {
      const live = scrollRef.current;
      if (live) live.scrollTop = want;
      restoringRef.current = false;
    });
    return () => {
      window.cancelAnimationFrame(frame);
      restoringRef.current = false;
    };
  }, [currentPathOf]);
  y2(() => {
    const host = scrollRef.current;
    if (!host || currentPathOf === "") return void 0;
    const flush = () => writeScrollMark(currentPathOf, scrollTopRef.current);
    const onScroll = () => {
      if (restoringRef.current) return;
      scrollTopRef.current = host.scrollTop;
      if (saveTimerRef.current !== 0) return;
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = 0;
        flush();
      }, 400);
    };
    host.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      host.removeEventListener("scroll", onScroll);
      if (saveTimerRef.current !== 0) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = 0;
      }
      flush();
    };
  }, [currentPathOf]);
  y2(() => {
    const host = scrollRef.current;
    if (!host) return void 0;
    let frame = 0;
    const sync = () => {
      frame = 0;
      const heads = headingNodes(host);
      if (heads.length === 0) return;
      const top = host.getBoundingClientRect().top;
      let found = -1;
      for (let i3 = 0; i3 < heads.length; i3 += 1) {
        if (heads[i3].getBoundingClientRect().top - top <= 24) found = i3;
        else break;
      }
      setActiveHeading((prev) => prev === found ? prev : found);
    };
    const onScroll = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(sync);
    };
    sync();
    host.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      host.removeEventListener("scroll", onScroll);
    };
  }, [currentPathOf]);
  y2(() => {
    if (anchorRequest === null || anchorRequest === void 0) return;
    if (String(anchorRequest.path || "") !== "" && String(anchorRequest.path) !== String(currentPath || "")) return;
    if (anchorRequest.kind === "line") {
      const lineHost = scrollRef.current;
      if (lineHost) scrollToText(lineHost, anchorRequest.text);
      if (typeof onAnchorDone === "function") onAnchorDone();
      return;
    }
    if (anchorRequest.kind === "block" || isBlockAnchor(anchorRequest.text)) {
      const blockHost = scrollRef.current;
      if (blockHost) scrollToBlock(blockHost, anchorRequest.text);
      if (typeof onAnchorDone === "function") onAnchorDone();
      return;
    }
    const want = normalizeHeading(anchorRequest.text);
    const host = scrollRef.current;
    if (want !== "" && host) {
      const heads = headingNodes(host);
      let hit = null;
      for (let i3 = 0; i3 < heads.length; i3 += 1) {
        if (normalizeHeading(heads[i3].textContent) === want) {
          hit = heads[i3];
          break;
        }
      }
      if (hit !== null) {
        const offset = hit.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop - 8;
        host.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
      } else if (typeof onError === "function") {
        onError(t4("note.anchorMissing").replace("{name}", anchorRequest.text));
      }
    }
    if (typeof onAnchorDone === "function") onAnchorDone();
  }, [anchorRequest, currentPath, onAnchorDone, onError, t4]);
  if (current === null) {
    return h4(
      "section",
      { className: "dshgn_note" },
      h4(
        "div",
        { className: "dshgn_empty" },
        h4(Icon, { name: "brain", size: 26 }),
        h4("div", { className: "dshgn_emptyTitle" }, t4("empty.select")),
        h4("div", { className: "dshgn_emptyDesc" }, t4("empty.selectDesc"))
      )
    );
  }
  const absolute = status !== null ? `${status.vaultRoot}/${current.path}` : current.path;
  return h4(
    "section",
    {
      className: "dshgn_note" + (canAttach ? " dshgn_noteDrop" : ""),
      // 把文件拖进笔记正文就插进来。列表那边的 drop 是「挪目录」，
      // 这里同一个手势是「存成附件」——落点不同、意思不同，跟宿主一致。
      onDrop: canAttach ? (event) => {
        const files = event.dataTransfer && event.dataTransfer.files;
        if (!files || files.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        void onAttach(files);
      } : void 0
    },
    h4(
      "div",
      { className: "dshgn_noteHead" },
      // 窄窗口里中栏被笔记让掉了（两栏挤在一起谁都读不了），
      // 没有这个按钮就回不到列表。宽窗口下 CSS 把它藏起来。
      h4(
        "button",
        {
          type: "button",
          className: "dshgn_iconBtn dshgn_noteBack",
          title: t4("action.back"),
          onClick: () => {
            if (typeof onClose === "function") onClose();
          }
        },
        // chevron 是朝右的，翻过来当「返回」用，省一个图标
        h4("span", { style: { display: "inline-flex", transform: "rotate(180deg)" } }, h4(Icon, { name: "chevron", size: 15 }))
      ),
      // 前进/后退：刚才是从哪篇点过来的，往回走一步不用再去列表里找。
      // 放在路径左边（和返回按钮挨着），三个键一组，读起来是「回列表 /
      // 回上一篇 / 去下一篇」。
      h4(
        "button",
        {
          type: "button",
          className: "dshgn_iconBtn dshgn_navBtn",
          title: t4("note.navBack"),
          "aria-keyshortcuts": "Alt+ArrowLeft",
          disabled: !canBack || onNavBack === null,
          onClick: () => {
            if (onNavBack !== null) onNavBack();
          }
        },
        h4("span", { style: { display: "inline-flex", transform: "rotate(180deg)" } }, h4(Icon, { name: "chevron", size: 15 }))
      ),
      h4(
        "button",
        {
          type: "button",
          className: "dshgn_iconBtn dshgn_navBtn",
          title: t4("note.navForward"),
          "aria-keyshortcuts": "Alt+ArrowRight",
          disabled: !canForward || onNavForward === null,
          onClick: () => {
            if (onNavForward !== null) onNavForward();
          }
        },
        h4(Icon, { name: "chevron", size: 15 })
      ),
      // 路径这一行顺手也能点：读到一半想知道「这一篇在库里的哪儿、旁边还有哪些」，
      // 跑到右键菜单里找「在文件列表里定位」是绕远路。宿主没这个接口时退回纯文字，
      // 不留一个点了没反应的可点外观。
      h4(
        "div",
        {
          className: hasRevealInVault() ? "dshgn_notePath dshgn_notePathLink" : "dshgn_notePath",
          title: hasRevealInVault() ? `${absolute}
${t4("tree.menuReveal")}` : absolute,
          role: hasRevealInVault() ? "button" : void 0,
          tabIndex: hasRevealInVault() ? 0 : void 0,
          onClick: hasRevealInVault() ? () => {
            revealInVault(current.path);
          } : void 0,
          onKeyDown: hasRevealInVault() ? (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            revealInVault(current.path);
          } : void 0
        },
        current.path
      ),
      // 字号三档。放在笔记头而不是设置页：用户是在「读这篇字太小」的那一刻
      // 想调它，跑到设置页去调完再回来，会打断阅读。
      h4(
        "div",
        { className: "dshgn_scaleGroup", role: "group", title: t4("note.fontSize") },
        ["s", "m", "l"].map(
          (size) => h4(
            "button",
            {
              key: size,
              type: "button",
              className: "dshgn_scaleBtn" + (textScale === size ? " dshgn_scaleBtnOn" : ""),
              onClick: () => pickScale(size),
              title: t4(`note.fontSize.${size}`)
            },
            // 三个 A 用不同字号画，比写「小/中/大」省位置，也比图标直观
            h4("span", { style: { fontSize: size === "s" ? 10 : size === "m" ? 12 : 14, lineHeight: 1 } }, "A")
          )
        )
      ),
      dirty ? h4("span", { className: "dshgn_badge" }, t4("note.unsaved")) : null,
      editing ? h4(
        b,
        null,
        h4(
          "button",
          { type: "button", className: "dshgn_btn dshgn_btnPrimary", onClick: onSave, disabled: busy || !dirty },
          h4(Icon, { name: "check", size: 13 }),
          t4("action.save")
        ),
        h4(
          "button",
          {
            type: "button",
            className: "dshgn_btn",
            onClick: () => {
              setDraft(current.content);
              setEditing(false);
              dropDraft(currentPathOf);
            },
            disabled: busy
          },
          t4("action.cancel")
        )
      ) : h4(
        b,
        null,
        h4(
          "button",
          {
            type: "button",
            className: "dshgn_iconBtn",
            title: t4("action.edit"),
            // 宿主里 Ctrl/Cmd+E 就是这个动作，悬停时让浏览器把它显出来
            "aria-keyshortcuts": "Control+E Meta+E",
            onClick: () => {
              setStashHandled(currentPathOf);
              setEditing(true);
            }
          },
          h4(Icon, { name: "edit", size: 15 })
        ),
        // 就地查找：读长笔记时想找一句话，翻回搜索框再搜一遍太重。
        // 再点一次收起（与历史那个按钮同一个手势），省得找不到关的地方。
        h4(
          "button",
          {
            type: "button",
            className: "dshgn_iconBtn",
            title: t4("note.find"),
            "data-on": findOpen ? "true" : "false",
            // 告诉浏览器这个按钮有快捷键，鼠标悬停时它会自己显示出来
            "aria-keyshortcuts": "Control+F Meta+F",
            onClick: () => findOpen ? closeFind() : setFindOpen(true)
          },
          h4(Icon, { name: "search", size: 15 })
        ),
        // 改名走宿主的对话框：它会把全库双链一起改掉，自己改文件就会留死链。
        hasRenameNote() ? h4(
          "button",
          {
            type: "button",
            className: "dshgn_iconBtn",
            title: t4("action.rename"),
            onClick: () => {
              if (typeof onRename === "function") onRename(current.path);
            }
          },
          h4(Icon, { name: "rename", size: 15 })
        ) : null,
        h4(
          "button",
          { type: "button", className: "dshgn_iconBtn", title: t4("action.copyRef"), onClick: onCopyReference },
          h4(Icon, { name: "link", size: 15 })
        ),
        // 复制这一篇：写周报时拿上周那篇当骨架、做实验时留着原稿再改，
        // 以前得「复制引用 → 新建 → 粘贴正文 → 自己补标题」四步。
        // 没接上这个去处时不摆按钮，点了没反应比没有更糟。
        onDuplicate === null ? null : h4(
          "button",
          { type: "button", className: "dshgn_iconBtn", title: t4("note.duplicate"), onClick: onDuplicate },
          h4(Icon, { name: "file", size: 15 })
        ),
        // B1：单篇推云端 / 单篇拉云端。只有这篇确实在云端有 note_id 时
        // 才有意义，所以没 note_id 就不显示——点了会报「这篇还没同步过」，
        // 那还不如不给这个按钮。
        current.noteId ? h4(
          "button",
          { type: "button", className: "dshgn_iconBtn", title: t4("sync.pushOne"), onClick: () => onSyncOne("push"), disabled: busy },
          h4(Icon, { name: "cloud", size: 15 })
        ) : null,
        current.noteId ? h4(
          "button",
          { type: "button", className: "dshgn_iconBtn", title: t4("sync.pullOne"), onClick: () => onSyncOne("pull"), disabled: busy },
          h4(Icon, { name: "sync", size: 15 })
        ) : null,
        h4(
          "button",
          {
            type: "button",
            className: "dshgn_iconBtn",
            title: t4("history.title"),
            "data-on": historyOpen ? "true" : "false",
            onClick: () => {
              const next = !historyOpen;
              setHistoryOpen(next);
              if (next) void loadHistory(current.path);
            }
          },
          h4(Icon, { name: "clock", size: 15 })
        ),
        // 去宿主编辑器里改：补全、Vim、插件命令都在那边。
        // 宿主没注入时（离线测试）不显示，免得点了没反应。
        hasOpenInEditor() ? h4(
          "button",
          {
            type: "button",
            className: "dshgn_iconBtn",
            title: t4("action.openInEditor"),
            onClick: () => openInEditor(absolute)
          },
          h4(Icon, { name: "external-link", size: 15 })
        ) : null,
        canAttach ? h4(
          b,
          null,
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_iconBtn",
              title: t4("note.attach"),
              onClick: () => {
                if (attachRef.current) attachRef.current.click();
              },
              disabled: busy
            },
            h4(Icon, { name: "attach", size: 15 })
          ),
          // 藏起来的 file input：宿主里插图走的是同一个系统选择器，
          // 面板没必要自造一套。
          h4("input", {
            ref: attachRef,
            type: "file",
            multiple: true,
            style: { display: "none" },
            onChange: (event) => {
              const files = event.target.files;
              if (files && files.length > 0) void onAttach(files);
              event.target.value = "";
            }
          })
        ) : null,
        h4(
          "button",
          { type: "button", className: "dshgn_iconBtn", title: t4("action.delete"), onClick: onDelete, disabled: busy },
          h4(Icon, { name: "trash", size: 15 })
        )
      )
    ),
    // 就地查找的输入条：用户点开了才出现。
    // 回车找下一处、Shift+回车找上一处、Esc 收起——与浏览器/宿主的查找框
    // 同一套手感，用户不用再学一遍。
    //
    // 编辑态也摆：那边 Ctrl+F 由 textarea 自己接（面板级监听会把输入框里的
    // 按键放走），没有这条就没处可开。只是编辑态不去滚动正文——那时候正文
    // 根本没渲染，用户要的是「在这个框里找下一处」，走的是光标。
    findOpen ? h4(
      "div",
      { className: "dshgn_findBar" },
      h4(Icon, { name: "search", size: 13 }),
      h4("input", {
        ref: findInputRef,
        type: "text",
        className: "dshgn_findInput",
        value: findText,
        placeholder: t4(editing ? "note.findInEditor" : "note.findPlaceholder"),
        spellCheck: false,
        onChange: (event) => {
          setFindText(event.target.value);
          setFindHit(null);
        },
        onKeyDown: (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeFind();
            return;
          }
          if (event.key !== "Enter") return;
          event.preventDefault();
          runFind(!event.shiftKey);
        }
      }),
      // 只有真找过才报数：刚打开、还没敲字时摆一个「0/0」只是噪音
      findHit === null ? null : h4("span", { className: "dshgn_findCount" }, `${findHit.index}/${findHit.total}`),
      h4(
        "button",
        {
          type: "button",
          className: "dshgn_iconBtn",
          title: t4("note.findPrev"),
          onClick: () => runFind(false)
        },
        h4("span", { style: { display: "inline-flex", transform: "rotate(180deg)" } }, h4(Icon, { name: "chevron", size: 13 }))
      ),
      h4(
        "button",
        {
          type: "button",
          className: "dshgn_iconBtn",
          title: t4("note.findNext"),
          onClick: () => runFind(true)
        },
        h4(Icon, { name: "chevron", size: 13 })
      ),
      h4(
        "button",
        {
          type: "button",
          className: "dshgn_iconBtn",
          title: t4("action.close"),
          onClick: () => closeFind()
        },
        h4(Icon, { name: "close", size: 13 })
      )
    ) : null,
    // 上次写到一半没存：切页签、关窗口、宿主重载插件都会把草稿一起带走，
    // 所以边写边在 localStorage 里留了一份。打开这篇时如果磁盘上的正文和
    // 那份不一样，就在这儿提一句——接着写会把草稿填回编辑区，丢掉就清掉。
    // 只在阅读态摆：编辑态已经在写了，再提一句只是噪音。
    !editing && stashFound !== null && stashFound.path === currentPathOf ? h4(
      "div",
      { className: "dshgn_draftBar" },
      h4(Icon, { name: "clock", size: 12 }),
      h4(
        "span",
        { className: "dshgn_draftText" },
        // 借 formatTime 那套「年-月-日 时:分」，用户一眼看得出是刚才还是昨天
        t4("draft.found").replace("{when}", formatTime(new Date(stashFound.at).toISOString()))
      ),
      h4(
        "button",
        {
          type: "button",
          className: "dshgn_draftBtn",
          onClick: () => {
            setDraft(stashFound.content);
            setStashHandled(currentPathOf);
            setStashFound(null);
            setEditing(true);
          }
        },
        t4("draft.resume")
      ),
      h4(
        "button",
        {
          type: "button",
          className: "dshgn_draftBtn",
          onClick: () => {
            dropDraft(currentPathOf);
            setStashHandled(currentPathOf);
            setStashFound(null);
            showToast(t4("draft.discarded"));
          }
        },
        t4("draft.discard")
      )
    ) : null,
    // 划选一段：原地弹一颗小条，复制或存成新笔记。
    // mousedown 拦一下：不拦的话按下按钮的瞬间选区就被取消了，
    // 等 click 触发时已经拿不到那段字。
    selPop !== null ? h4(
      "div",
      {
        className: "dshgn_selPop",
        style: { left: `${selPop.x}px`, top: `${selPop.y}px` },
        onMouseDown: (event) => event.preventDefault()
      },
      h4(
        "button",
        {
          type: "button",
          className: "dshgn_selPopBtn",
          title: t4("action.copy"),
          onClick: () => {
            void onCopyText(selPop.text);
            setSelPop(null);
          }
        },
        h4(Icon, { name: "file", size: 11 }),
        t4("action.copy")
      ),
      onCreateFromText === null ? null : h4(
        "button",
        {
          type: "button",
          className: "dshgn_selPopBtn",
          title: t4("sel.newNote"),
          onClick: () => {
            void onCreateFromText(selPop.text);
            setSelPop(null);
          }
        },
        h4(Icon, { name: "note", size: 11 }),
        t4("sel.newNote")
      )
    ) : null,
    editing ? h4(
      b,
      null,
      h4("textarea", {
        ref: editorRef,
        className: "dshgn_editor",
        value: draft === null ? "" : draft,
        spellCheck: false,
        onChange: (event) => {
          const value = event.target.value;
          setDraft(value);
          const at = typeof event.target.selectionStart === "number" ? event.target.selectionStart : value.length;
          const open = wikilinkQueryAt(value, at);
          setLinkPick(open === null ? null : { query: open.query, start: open.start, active: 0 });
          const tagOpen = open === null ? tagQueryAt(value, at) : null;
          setTagPick(tagOpen === null ? null : { query: tagOpen.query, start: tagOpen.start, active: 0 });
        },
        // 在清单行末尾按回车，接着写下一行（有序列表自动加一）。
        // 只认行尾，行中间的回车仍然是「把这行拆成两条」，交给浏览器自己处理。
        onKeyDown: (event) => {
          if (pickHits.length > 0) {
            const picker = linkPick !== null && linkHits.length > 0 ? "link" : "tag";
            const setPicker = picker === "link" ? setLinkPick : setTagPick;
            const currentPick = picker === "link" ? linkPick : tagPick;
            if (event.key === "Escape") {
              event.preventDefault();
              setPicker(null);
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setPicker({ ...currentPick, active: Math.min(pickHits.length - 1, pickActive + 1) });
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setPicker({ ...currentPick, active: Math.max(0, pickActive - 1) });
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              applyLinkPick(pickHits[Math.min(pickActive, pickHits.length - 1)]);
              return;
            }
          }
          const mod = (event.ctrlKey || event.metaKey) && !event.altKey;
          if (mod && String(event.key || "").toLowerCase() === "f" && !event.shiftKey) {
            event.preventDefault();
            setFindOpen(true);
            if (typeof window.requestAnimationFrame === "function") {
              window.requestAnimationFrame(() => {
                const live = findInputRef.current;
                if (live !== null && live !== void 0) live.focus();
              });
            }
            return;
          }
          if (mod) {
            const lower = String(event.key || "").toLowerCase();
            const mark = lower === "b" && !event.shiftKey ? "**" : lower === "i" && !event.shiftKey ? "*" : lower === "x" && event.shiftKey ? "~~" : "";
            if (mark !== "") {
              const live = editorRef.current;
              if (live !== null && live !== void 0) {
                event.preventDefault();
                const caret2 = typeof live.selectionStart === "number" ? live.selectionStart : 0;
                const selEnd2 = typeof live.selectionEnd === "number" ? live.selectionEnd : caret2;
                const wrapped = wrapInline(live.value, caret2, selEnd2, mark);
                setDraft(wrapped.text);
                placeCaret(wrapped.start, wrapped.end);
              }
              return;
            }
          }
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          const node = editorRef.current;
          if (node === null || node === void 0) return;
          if (event.isComposing || event.keyCode === 229) return;
          const caret = typeof node.selectionStart === "number" ? node.selectionStart : null;
          const selEnd = typeof node.selectionEnd === "number" ? node.selectionEnd : caret;
          if (event.key === "Enter" && !event.shiftKey) {
            const next = continueListLine(node.value, caret);
            if (next === null) return;
            event.preventDefault();
            setDraft(next.text);
            placeCaret(next.caret, next.caret);
            return;
          }
          if (event.key === "Tab") {
            const shifted = indentLines(node.value, caret, selEnd, event.shiftKey);
            event.preventDefault();
            setDraft(shifted.text);
            placeCaret(shifted.start, shifted.end);
          }
        },
        // 截图之后 Ctrl+V 是最顺手的插图方式。宿主接住了，面板以前什么都不做，
        // 剪贴板里的图就悄悄没了。
        // 粘贴两种：剪贴板里是文件就存成附件（截图后 Ctrl+V 是最顺手的插图
        // 方式）；是网址而正文里又选了一段字，就把它变成 [选中的字](网址)
        // ——宿主里这是默认行为，裸 textarea 会把选好的那段话整个换成网址。
        onPaste: (event) => {
          const files = event.clipboardData && event.clipboardData.files;
          if (files && files.length > 0) {
            if (!canAttach) return;
            event.preventDefault();
            void onAttach(files);
            return;
          }
          const node = editorRef.current;
          if (node === null || node === void 0) return;
          const clip = event.clipboardData && typeof event.clipboardData.getData === "function" ? event.clipboardData.getData("text/plain") : "";
          const caret = typeof node.selectionStart === "number" ? node.selectionStart : 0;
          const selEnd = typeof node.selectionEnd === "number" ? node.selectionEnd : caret;
          const linked = linkPaste(node.value, caret, selEnd, clip);
          if (linked === null) return;
          event.preventDefault();
          setDraft(linked.text);
          placeCaret(linked.start, linked.end);
        }
      }),
      // 双链候选：紧贴编辑区下沿摆一排，鼠标点也行、键盘上下+回车也行。
      // 一条候选都没搜到时整块不出现——弹一个空盒子比不弹更让人困惑。
      pickHits.length === 0 ? null : h4(
        "div",
        { className: "dshgn_linkPick" },
        pickHits.map(
          (hit, index) => h4(
            "button",
            {
              key: hit.path,
              type: "button",
              className: "dshgn_linkPickItem",
              "data-on": index === Math.min(pickActive, pickHits.length - 1) ? "true" : "false",
              title: hit.path,
              // 别让按钮抢走焦点：焦点一离开 textarea，光标位置就没了，
              // 接下来的输入会落到别处。
              onMouseDown: (event) => event.preventDefault(),
              onClick: () => applyLinkPick(hit)
            },
            h4(Icon, { name: hit.close === "" ? "hash" : "link", size: 12 }),
            h4("span", { className: "dshgn_linkPickName" }, hit.label)
          )
        )
      ),
      // 编辑时脚下那一条：字数 + 快捷键提示。原来编辑态一个字的反馈都没有，
      // 用户不知道按什么保存、也不知道自己写了多少。
      h4(
        "div",
        { className: "dshgn_editorFoot" },
        h4("span", null, t4("editor.words").replace("{n}", String(countWords(draft)))),
        h4("span", { className: "dshgn_editorHint" }, t4("editor.saveHint"))
      )
    ) : historyOpen ? h4(
      "div",
      { className: "dshgn_historyPane" },
      h4(
        "div",
        { className: "dshgn_historyHead" },
        h4(Icon, { name: "clock", size: 13 }),
        h4("span", null, t4("history.title")),
        h4("span", { className: "dshgn_outlineCount" }, historyItems === null ? "\u2026" : String(historyItems.length)),
        h4(
          "button",
          { type: "button", className: "dshgn_btn", style: { marginLeft: "auto" }, onClick: () => {
            setHistoryOpen(false);
            setHistoryPreview(null);
          } },
          t4("action.close")
        )
      ),
      historyPreview !== null ? h4(
        b,
        null,
        h4(
          "div",
          { className: "dshgn_rowLine", style: { padding: "6px 12px", gap: 8 } },
          h4("span", { className: "dshgn_fieldHint" }, formatTime(historyPreview.savedAt)),
          h4(
            "button",
            { type: "button", className: "dshgn_btn dshgn_btnPri", style: { marginLeft: "auto" }, onClick: () => void restoreHistory(historyPreview.name), disabled: historyBusy },
            t4("history.restore")
          ),
          h4("button", { type: "button", className: "dshgn_btn", onClick: () => setHistoryPreview(null), disabled: historyBusy }, t4("action.back"))
        ),
        h4("pre", { className: "dshgn_diffBody", style: { flex: 1, minHeight: 0 } }, historyPreview.content)
      ) : historyItems === null ? h4("div", { className: "dshgn_emptyState" }, h4("span", { className: "dshgn_spin" })) : historyItems.length === 0 ? h4(
        "div",
        { className: "dshgn_empty" },
        h4(Icon, { name: "clock", size: 22 }),
        h4("div", { className: "dshgn_emptyTitle" }, t4("history.empty")),
        h4("div", { className: "dshgn_emptyDesc" }, t4("history.emptyHint"))
      ) : h4(
        "div",
        { className: "dshgn_historyList" },
        historyItems.map(
          (item) => h4(
            "button",
            {
              key: item.name,
              type: "button",
              className: "dshgn_historyItem",
              onClick: () => void previewHistory(item.name),
              disabled: historyBusy
            },
            h4("span", { className: "dshgn_historyTime" }, formatTime(item.savedAt)),
            h4("span", { className: "dshgn_historyMeta" }, formatBytes2(item.bytes))
          )
        )
      )
    ) : h4(
      "div",
      { className: "dshgn_scroll", ref: scrollRef },
      // 属性区：笔记头部那几行（tags / aliases / 自定义字段）。
      // 放在正文上方、大纲之上——它回答「这篇是什么」，读正文之前先有个背景。
      // 没有头部时 propRows 是空数组，这一整块不出现。
      propRows.length > 0 ? h4(
        "div",
        { className: "dshgn_props" },
        h4(
          "button",
          {
            type: "button",
            className: "dshgn_outlineToggle",
            onClick: () => setShowProps((prev) => !prev),
            title: t4("reader.frontmatter")
          },
          h4(Icon, { name: showProps ? "up" : "file", size: 12 }),
          t4("reader.frontmatter"),
          h4("span", { className: "dshgn_outlineCount" }, String(propRows.length))
        ),
        showProps ? h4(
          "div",
          { className: "dshgn_propsBody" },
          propRows.map(
            (row) => h4(
              "div",
              { key: row.key, className: "dshgn_propRow" },
              h4("span", { className: "dshgn_propKey", title: row.key }, row.key),
              h4(
                "span",
                { className: "dshgn_propVal" },
                // 标签做成可点的胶囊：点一下等于在左栏筛这个标签。
                // 其余的值原样列出来（数组在 frontmatterText 里已经用 · 连好）。
                row.tags !== null && typeof onPickTag === "function" ? row.tags.map(
                  (tag, index) => h4(
                    "button",
                    {
                      key: `${index}-${tag}`,
                      type: "button",
                      className: "dshgn_propTag",
                      title: tag,
                      onClick: () => onPickTag(tag)
                    },
                    tag
                  )
                ) : row.text
              )
            )
          )
        ) : null
      ) : null,
      // 大纲：长笔记（尤其逐字稿那种几千字）靠滚动找「金句在哪一节」非常费劲，
      // 给一排可点的标题省掉这个过程。默认展开，但可以收起——有些用户
      // 只想一口气读完，多一行都是干扰。
      Array.isArray(current.outline) && current.outline.length > 1 ? h4(
        "div",
        { className: "dshgn_outline" },
        h4(
          "button",
          {
            type: "button",
            className: "dshgn_outlineToggle",
            onClick: () => setShowOutline((prev) => !prev),
            title: t4("note.outline")
          },
          h4(Icon, { name: showOutline ? "up" : "file", size: 12 }),
          t4("note.outline"),
          h4("span", { className: "dshgn_outlineCount" }, String(current.outline.length))
        ),
        showOutline ? h4(
          "div",
          { className: "dshgn_outlineList" },
          current.outline.map(
            (item, index) => (
              // 一行两件事：点标题跳过去，点右边那颗抄一条指向这一节的
              // 链接。以前想引用某一节得自己拼 [[笔记#小节]]，拼错了
              // 不报错，只是变成一条点了没反应的死链。
              h4(
                "div",
                { key: `${index}-${item.text}`, className: "dshgn_outlineRow" },
                h4(
                  "button",
                  {
                    type: "button",
                    className: "dshgn_outlineItem",
                    // 缩进跟着标题层级走，三级标题比一级多缩进两格，
                    // 结构一眼能看出来，不用读文字判断谁是谁的子节。
                    style: { paddingLeft: 8 + Math.max(0, item.level - 1) * 12 },
                    // 现在读到哪一节：长笔记滚到一半时，用户会想确认
                    // 「我看的是第几节」，亮着的那一条就是答案。
                    "data-on": activeHeading === index ? "true" : "false",
                    "aria-current": activeHeading === index ? "true" : void 0,
                    title: item.text,
                    onClick: () => jumpToHeading(index)
                  },
                  item.text
                ),
                onCopyHeadingLink === null ? null : h4(
                  "button",
                  {
                    type: "button",
                    className: "dshgn_outlineCopy",
                    title: t4("note.copyHeadingLink"),
                    "aria-label": t4("note.copyHeadingLink"),
                    onClick: () => {
                      void onCopyHeadingLink(item.text);
                    }
                  },
                  h4(Icon, { name: "link", size: 11 })
                )
              )
            )
          )
        ) : null
      ) : null,
      // 附件里的录音直接放播放器：合并两套体系时把这些 mp3 搬进来了，
      // 如果只留 markdown 里那条外链，用户还得跳浏览器才能听。
      (current.assets || []).filter((asset) => asset.kind === "audio").map(
        (asset, index) => h4(AudioPlayer, {
          key: `${asset.path}-${index}`,
          t: t4,
          track: {
            // 宿主给了资源地址就用它（Range、缓存都归宿主管），否则退回本地服务
            url: assetUrlOf(asset.path) !== "" ? assetUrlOf(asset.path) : withToken(`${apiOrigin()}/getnote/asset?path=${encodeURIComponent(asset.path)}`),
            duration: 0,
            kind: "local",
            title: assetLabel(asset.name)
          }
        })
      ),
      // 附件里的图片也画出来。以前只筛 audio，`kind:'image'` 的附件在面板里
      // 完全看不见——用户明明存了图，却以为没同步下来。
      (current.assets || []).some((asset) => asset.kind === "image") ? h4(
        "div",
        { className: "dshgn_imgRow" },
        (current.assets || []).filter((asset) => asset.kind === "image").map((asset, index) => {
          const assetSrc = assetUrlOf(asset.path) !== "" ? assetUrlOf(asset.path) : withToken(`${apiOrigin()}/getnote/asset?path=${encodeURIComponent(asset.path)}`);
          return h4("img", {
            key: `${asset.path}-${index}`,
            className: "dshgn_img dshgn_imgOpen",
            src: assetSrc,
            alt: asset.name,
            title: `${t4("note.zoomImage")} \xB7 ${asset.name}`,
            loading: "lazy",
            onClick: (event) => {
              if (event && typeof event.stopPropagation === "function") event.stopPropagation();
              openZoom({ src: assetSrc, name: asset.name, path: currentPathOf });
            }
          });
        })
      ) : null,
      // 阅读时只渲染正文：`content` 带 YAML frontmatter，直接 renderBlocks 会把
      // `title: xxx` / `note_id: "..."` 当成正文段落一条条铺出来。编辑时仍用
      // `content`，这样保存不会把 frontmatter 丢掉。
      h4(
        "div",
        { className: "dshgn_md" + (textScale === "s" ? " dshgn_mdS" : textScale === "l" ? " dshgn_mdL" : "") },
        renderMarkdown(
          current.body !== void 0 && current.body !== null ? current.body : current.content,
          // 编辑态不给 onToggleTodo：那时显示的是可编辑 textarea，正文里的
          // 方框根本不该响应点击（改内容要走保存）。只有阅读态才可点。
          {
            assets: current.assets || [],
            sourcePath: vaultPathOf(current),
            // 点 [[双链]]：先交给 Obsidian 在编辑器里打开（这是 Obsidian
            // 用户的直觉），没注入宿主时退回面板自己的「在面板里打开」。
            onOpenLink: (target) => {
              if (openLinkInVault(target, vaultPathOf(current))) return;
              onOpenWikiLink2(target);
            },
            onOpenWikiLink: onOpenWikiLink2,
            onToggleTodo: editing ? void 0 : onToggleTodo,
            // ![[另一篇笔记]]：把那一篇的正文嵌进来。解析口径与点双链
            // 共用一套，否则会出现「点得过去、嵌不进来」。
            resolveNote,
            embedDepth: 0,
            // 正文里的 #标签：点一下就在左栏筛这个标签，与笔记头属性区
            // 那几颗胶囊同一个动作。卡片摘要那边不给，那里点了会跳走。
            onPickTag,
            // 代码块右上角的「复制」：只给阅读态，编辑态看到的本来就是原文
            onCopyText: editing ? void 0 : onCopyText,
            // 图片点一下放大：面板里只有 200px 高的缩略图，扫描件看不清楚。
            // 编辑态不给——那时看到的是原文，点图也不该盖住编辑区。
            onPreviewImage: editing ? void 0 : (item) => openZoom({ ...item, path: currentPathOf }),
            t: t4
          }
        )
      ),
      // 关联笔记（反向链接）：用户写了很多 [[双链]]，但双链只有「点进去」
      // 一个方向；想看「谁提到了我这篇」只能靠这个面板。
      backlinks !== null && Array.isArray(backlinks.hits) && backlinks.hits.length > 0 ? h4(
        "div",
        { className: "dshgn_backlinks" },
        h4("div", { className: "dshgn_backlinksHead" }, h4(Icon, { name: "link", size: 12 }), t4("note.backlinks"), h4("span", { className: "dshgn_outlineCount" }, String(backlinks.hits.length))),
        backlinks.hits.map(
          (hit) => h4(
            "button",
            {
              key: hit.path,
              type: "button",
              className: "dshgn_backlinkItem",
              title: hit.path,
              onClick: () => onOpenWikiLink2(hit.path)
            },
            h4("span", { className: "dshgn_backlinkTitle" }, hit.title || hit.path),
            // 一篇笔记里提到这一篇好几次时标个次数：三条反链里那条提了 5 次
            // 的，通常比只提一次的更值得先看。
            Number(hit.count) > 1 ? h4("span", { className: "dshgn_outlineCount", style: { marginLeft: 6 } }, String(hit.count)) : null,
            // 上下文：引用那一行剩下的字。没有（宿主索引那份不带）就不占行，
            // 免得每条反链底下都空一格。最多三条——再多就是把人家的正文
            // 整段抄过来了。
            //
            // 这一行本身也能点：点标题是「去那一篇」，点这句话是「去那一句」。
            // 反链最常见的用法就是「我记得在哪儿提过，是哪一段来着」——
            // 只把人送到篇首，用户还得自己在一整篇里再找一遍那句话。
            (Array.isArray(hit.snippets) ? hit.snippets : []).filter((line) => typeof line === "string" && line !== "").slice(0, 3).map(
              (line, index) => h4(
                "span",
                {
                  key: `${hit.path}-s${index}`,
                  className: onJumpToLine === null ? "dshgn_backlinkSnip" : "dshgn_backlinkSnip dshgn_backlinkSnipLink",
                  title: onJumpToLine === null ? void 0 : t4("note.backlinkJump"),
                  role: onJumpToLine === null ? void 0 : "button",
                  tabIndex: onJumpToLine === null ? void 0 : 0,
                  onClick: onJumpToLine === null ? void 0 : (event) => {
                    event.stopPropagation();
                    onJumpToLine(hit.path, line);
                  },
                  onKeyDown: onJumpToLine === null ? void 0 : (event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    onJumpToLine(hit.path, line);
                  }
                },
                line
              )
            ),
            h4("span", { className: "dshgn_backlinkPath" }, hit.path)
          )
        )
      ) : null,
      // 出链：这篇引用了谁。反链回答「谁提到我」，出链回答「我提到过谁」，
      // 两个方向合起来才是用户脑子里的那张网。
      outlinkChips.length > 0 ? h4(
        "div",
        { className: "dshgn_outlinks" },
        h4("div", { className: "dshgn_outlinksHead" }, h4(Icon, { name: "link", size: 12 }), t4("note.outlinks"), h4("span", { className: "dshgn_outlineCount" }, String(outlinkChips.length))),
        h4(
          "div",
          { className: "dshgn_outlinkRow" },
          outlinkChips.map(
            (link) => h4(
              "button",
              {
                key: link.text,
                type: "button",
                className: link.dead ? "dshgn_outlinkChip dshgn_outlinkDead" : "dshgn_outlinkChip",
                title: link.dead ? t4("note.wikilinkMissing").replace("{name}", link.text) : link.text,
                onClick: () => onOpenWikiLink2(link.text)
              },
              link.text
            )
          )
        )
      ) : null,
      // 阅读态脚下那一条：这一篇多少字、大概读多久。长逐字稿常常几千字，
      // 读之前想知道「现在有没有时间读」，读的时候想知道「还剩多少」。
      // 编辑态有自己那条（草稿字数 + 保存提示），两者不同时出现。
      editing ? null : h4(
        "div",
        { className: "dshgn_editorFoot dshgn_readFoot" },
        h4("span", null, t4("reader.words").replace("{n}", String(readWords))),
        h4(
          "span",
          { className: "dshgn_editorHint" },
          readWords > 0 ? t4("reader.minutes").replace("{n}", String(readingMinutes(readWords))) : ""
        )
      )
    ),
    // 放大查看的遮罩。点空白处关掉（图片自己 stopPropagation，点图不关），
    // 右上角那颗 × 是给「不知道该按 Esc」的人留的。
    zoomed !== null ? h4(ZoomOverlay, {
      src: zoomed.src,
      name: zoomed.name,
      onClose: closeZoom,
      index: zoomIndex,
      total: zoomList.length,
      onStep: stepZoom
    }) : null
  );
}
function ZoomOverlay(props) {
  const { src, name, onClose, index, total, onStep } = props;
  const t4 = getT();
  const close = typeof onClose === "function" ? onClose : () => {
  };
  const step = typeof onStep === "function" ? onStep : null;
  const count = Number(total) || 0;
  const at = Number(index);
  const many = step !== null && count > 1;
  const stop = (event) => {
    if (event && typeof event.stopPropagation === "function") event.stopPropagation();
  };
  return h4(
    "div",
    { className: "dshgn_zoomMask", onClick: close },
    h4("img", {
      className: "dshgn_zoomImg",
      src,
      alt: typeof name === "string" ? name : "",
      onClick: stop
    }),
    many ? h4(
      "div",
      { className: "dshgn_zoomBar", onClick: stop },
      h4(
        "button",
        {
          type: "button",
          className: "dshgn_zoomStep",
          title: t4("zoom.prev"),
          "aria-label": t4("zoom.prev"),
          onClick: (event) => {
            stop(event);
            step(-1);
          }
        },
        h4(Icon, { name: "left", size: 13 })
      ),
      h4(
        "span",
        { className: "dshgn_zoomCount" },
        t4("zoom.count").replace("{n}", String(at + 1)).replace("{total}", String(count))
      ),
      h4(
        "button",
        {
          type: "button",
          className: "dshgn_zoomStep",
          title: t4("zoom.next"),
          "aria-label": t4("zoom.next"),
          onClick: (event) => {
            stop(event);
            step(1);
          }
        },
        h4(Icon, { name: "right", size: 13 })
      )
    ) : null,
    h4(
      "button",
      {
        type: "button",
        className: "dshgn_zoomClose",
        title: t4("action.close"),
        onClick: (event) => {
          stop(event);
          close();
        }
      },
      h4(Icon, { name: "close", size: 14 })
    )
  );
}
function ImportPane(props) {
  const { t: t4, status, onRefresh, onDone } = props;
  const [state, setState] = h2(null);
  const [authUrl, setAuthUrl] = h2(null);
  const [waiting, setWaiting] = h2(false);
  const [error2, setError] = h2(null);
  const [busy, setBusy] = h2(false);
  const loadStatus = q2(async () => {
    try {
      const json = await api("/import/status");
      setState(json);
      return json;
    } catch {
      return null;
    }
  }, []);
  y2(() => {
    void loadStatus();
  }, [loadStatus]);
  const running = state !== null && state.running === true;
  y2(() => {
    if (!running) return void 0;
    const timer = window.setInterval(() => {
      void loadStatus().then((json) => {
        if (json && json.running === false) onDone();
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [running, loadStatus, onDone]);
  const loggedIn = status !== null && status.cloud !== null && status.cloud.loggedIn === true;
  const startLogin = q2(async () => {
    setBusy(true);
    setError(null);
    try {
      const json = await api("/oauth/start", { method: "POST" });
      setAuthUrl(json.url);
      setWaiting(true);
      try {
        openExternal(json.url);
      } catch {
      }
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);
  y2(() => {
    if (!waiting) return void 0;
    const timer = window.setInterval(async () => {
      try {
        const json = await api("/oauth/status");
        if (json && json.loggedIn === true) {
          setWaiting(false);
          setAuthUrl(null);
          await onRefresh();
        }
      } catch {
      }
    }, 2e3);
    return () => window.clearInterval(timer);
  }, [waiting, onRefresh]);
  const startImport = q2(async () => {
    setBusy(true);
    setError(null);
    try {
      const json = await api("/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      if (json && json.ok === false) setError(json.error || "import failed");
      setState((previous) => ({ ...previous || {}, running: json.ok === true }));
      await loadStatus();
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [loadStatus]);
  const logout = q2(async () => {
    setBusy(true);
    try {
      await api("/logout", { method: "POST" });
      await onRefresh();
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [onRefresh]);
  const lines = state !== null && Array.isArray(state.lines) ? state.lines : [];
  const result = state !== null ? state.result : null;
  return h4(
    "div",
    { className: "dshgn_pane" },
    h4(
      "div",
      { className: "dshgn_cardBox" },
      h4(
        "div",
        { className: "dshgn_section" },
        h4("div", { className: "dshgn_sectionTitle" }, t4("import.title")),
        h4("div", { className: "dshgn_sectionDesc" }, t4("import.desc")),
        h4(
          "div",
          { className: "dshgn_rowLine" },
          h4(
            "span",
            { className: loggedIn ? "dshgn_badge dshgn_badgeOk" : "dshgn_badge" },
            h4(Icon, { name: "cloud", size: 11 }),
            loggedIn ? t4("import.loggedIn") : t4("import.notLoggedIn")
          ),
          status !== null && status.lastSyncAt ? h4("span", { className: "dshgn_badge" }, `${t4("import.lastSync")}: ${formatTime(status.lastSyncAt)}`) : h4("span", { className: "dshgn_badge" }, `${t4("import.lastSync")}: ${t4("import.never")}`),
          status !== null && status.notes > 0 ? h4("span", { className: "dshgn_badge" }, `${status.notes} ${t4("meta.notes")}`) : null
        ),
        h4(
          "div",
          { className: "dshgn_rowLine" },
          loggedIn ? h4(
            b,
            null,
            h4(
              "button",
              { type: "button", className: "dshgn_btn dshgn_btnPrimary", onClick: startImport, disabled: busy || running },
              running ? h4("span", { className: "dshgn_spin" }) : h4(Icon, { name: "cloud", size: 13 }),
              running ? t4("import.running") : t4("import.start")
            ),
            h4("button", { type: "button", className: "dshgn_btn", onClick: logout, disabled: busy || running }, t4("import.logout"))
          ) : h4(
            b,
            null,
            h4(
              "button",
              { type: "button", className: "dshgn_btn dshgn_btnPrimary", onClick: startLogin, disabled: busy },
              h4(Icon, { name: "cloud", size: 13 }),
              t4("import.login")
            ),
            h4("span", { className: "dshgn_sectionDesc" }, t4("import.loginHint"))
          )
        ),
        !loggedIn ? h4("div", { className: "dshgn_sectionDesc" }, t4("import.cloudHint")) : null,
        authUrl !== null ? h4(
          "div",
          { className: "dshgn_sectionDesc" },
          waiting ? `${t4("import.authorizeWait")} ` : "",
          // 用按钮而不是 a[target=_blank]：Obsidian 的自定义视图里点外链
          // 有时会把整个应用导航走，比打开浏览器难收拾得多。
          h4(
            "button",
            {
              type: "button",
              className: "dshgn_link dshgn_linkBtn",
              onClick: () => openExternal(authUrl)
            },
            t4("import.openLink")
          )
        ) : null
      ),
      error2 !== null ? h4("div", { className: "dshgn_error", role: "alert" }, error2) : null,
      result !== null ? h4(
        "div",
        { className: "dshgn_section" },
        h4("div", { className: "dshgn_sectionTitle" }, t4("import.result")),
        h4(
          "div",
          { className: "dshgn_rowLine" },
          h4("span", { className: "dshgn_badge dshgn_badgeOk" }, `${t4("import.newNotes")} ${result.created}`),
          h4("span", { className: "dshgn_badge" }, `${t4("import.skipped")} ${result.skipped}`),
          h4("span", { className: "dshgn_badge" }, `${t4("import.failed")} ${result.failed}`),
          h4("span", { className: "dshgn_badge" }, `${Math.round((result.durationMs || 0) / 1e3)}s`)
        ),
        h4("div", { className: "dshgn_sectionDesc" }, result.root)
      ) : null,
      lines.length > 0 ? h4("div", { className: "dshgn_log" }, lines.map((line, index) => h4("div", { key: index }, `${formatTime(line.at)}  ${line.text}`))) : null
    )
  );
}
function SettingsPane(props) {
  const { t: t4, status, onSaved, onError, onThemePreview, showToast, locale, onLocaleChange, onSyncChanged } = props;
  const [input, setInput] = h2("");
  const [busy, setBusy] = h2(false);
  const [touched, setTouched] = h2(false);
  y2(() => {
    if (!touched && status !== null) setInput(status.subfolder || "");
  }, [status, touched]);
  const save = q2(
    async (path) => {
      setBusy(true);
      try {
        await api("/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vaultPath: path })
        });
        setTouched(false);
        await onSaved(t4("settings.saved"));
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [onError, onSaved, t4]
  );
  const suggestions = status !== null && Array.isArray(status.suggestions) ? status.suggestions : [];
  const cloudApi = status !== null && status.api ? status.api : null;
  const loginState = status === null || status.cloud === null || status.cloud.loggedIn !== true ? "none" : status.cloud.expired === true ? "expired" : "ok";
  return h4(
    "div",
    { className: "dshgn_pane" },
    h4(
      "div",
      { className: "dshgn_cardBox" },
      h4(
        "div",
        { className: "dshgn_section" },
        h4("div", { className: "dshgn_sectionTitle" }, t4("settings.vault")),
        h4("div", { className: "dshgn_sectionDesc" }, t4("settings.vaultHint")),
        h4(
          "div",
          { className: "dshgn_rowLine" },
          h4("input", {
            className: "dshgn_input",
            value: input,
            spellCheck: false,
            placeholder: status !== null ? status.vaultRoot : "",
            onChange: (event) => {
              setTouched(true);
              setInput(event.target.value);
            }
          }),
          h4("button", { type: "button", className: "dshgn_btn dshgn_btnPrimary", onClick: () => save(input), disabled: busy }, t4("settings.save"))
        ),
        status !== null && status.vaultMissing ? h4("div", { className: "dshgn_error" }, `\u2715 ${status.vaultMissing}`) : null,
        status !== null ? h4("div", { className: "dshgn_sectionDesc" }, `${status.notes} ${t4("meta.notes")} \xB7 ${status.dirs} ${t4("meta.dirs")} \xB7 ${formatBytes2(status.bytes)}`) : null
      ),
      suggestions.length > 0 ? h4(
        "div",
        { className: "dshgn_section" },
        h4("div", { className: "dshgn_sectionTitle" }, t4("settings.suggest")),
        suggestions.map(
          (item) => h4(
            "div",
            { key: item.path, className: "dshgn_rowLine" },
            h4("div", { className: "dshgn_sectionDesc", style: { flex: 1, minWidth: 0, wordBreak: "break-all" } }, `${item.path} \u2014 ${item.notes} ${t4("meta.notes")}`),
            h4("button", { type: "button", className: "dshgn_btn", onClick: () => save(item.path), disabled: busy }, t4("settings.use"))
          )
        )
      ) : null,
      h4(CloudCredCard, { t: t4, api: cloudApi, onSaved, onError }),
      // 自动同步紧跟在云端接入卡后面：它俩是同一件事的两半——上面说「用哪条
      // 通道连云端」，这里说「多久自动拉一次」。中间隔着主题色/语言会让这层
      // 关系看不出来。
      h4(SyncPane, { t: t4, status, onChanged: onSyncChanged, onError, showToast }),
      h4(ThemeCard, { t: t4, themeColor: status !== null ? status.themeColor : null, onSaved, onError, onPreview: onThemePreview }),
      h4(LanguageCard, { t: t4, locale, onSaved, onError, onLocaleChange }),
      // 跟随卡片紧跟在语言之后：它和「面板长什么样」属于同一类设置（怎么跟
      // 宿主配合），而不是「库里有什么」。
      h4(FollowCard, { t: t4, status, onSaved, onError }),
      // 模板卡放在语言之后、备份之前：它属于「写作习惯」这一类，跟主题色/语言
      // 挨着；备份是整库操作，应该留在最后。
      h4(TemplateCard, { t: t4, status, onSaved, onError }),
      h4(ArchiveCard, { t: t4, status, onChanged: onSaved, onError, showToast }),
      h4(
        "div",
        { className: "dshgn_section" },
        h4(
          "div",
          { className: "dshgn_sectionHead" },
          h4("div", { className: "dshgn_sectionTitle" }, t4("settings.authFile")),
          h4(
            "span",
            {
              // auth.json 存在只说明「登录过」，令牌过期后它还在文件里。
              // 这时仍显示「已登录」会骗人：用户以为登录有效，其实云端操作
              // 走的是 API Key 那条通道。所以按 expiresAt 分三态。
              className: "dshgn_badge" + (loginState === "ok" ? " dshgn_badgeOk" : loginState === "expired" ? " dshgn_badgeWarn" : "")
            },
            loginState === "ok" ? t4("settings.loggedIn") : loginState === "expired" ? t4("settings.loginExpired") : t4("settings.loggedOut")
          )
        ),
        h4("div", { className: "dshgn_sectionDesc" }, status !== null ? status.authPath : ""),
        h4("div", { className: "dshgn_sectionDesc" }, t4("settings.storeHint"))
      )
    )
  );
}
function ThemeCard(props) {
  const { t: t4, themeColor, onSaved, onError, onPreview } = props;
  const [draft, setDraft] = h2(null);
  const [busy, setBusy] = h2(false);
  const [custom, setCustom] = h2(false);
  const active = draft === null ? themeColor : draft;
  y2(() => {
    if (typeof onPreview === "function") onPreview(draft);
    return () => {
      if (typeof onPreview === "function") onPreview(null);
    };
  }, [draft, onPreview]);
  const save = q2(
    async (value) => {
      setBusy(true);
      try {
        await api("/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ themeColor: value })
        });
        await onSaved(t4("theme.saved"));
        setDraft(null);
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [onError, onSaved, t4]
  );
  const presets = ["#0a2a52", "#14342b", "#4a2036", "#3b2d5c", "#5c3a1e", "#22434f", "#40202c", "#333333"];
  return h4(
    "div",
    { className: "dshgn_section" },
    h4("div", { className: "dshgn_sectionTitle" }, t4("theme.title")),
    h4("div", { className: "dshgn_sectionDesc" }, t4("theme.desc")),
    h4(
      "div",
      { className: "dshgn_themeRow" },
      presets.map(
        (hex) => h4("button", {
          key: hex,
          type: "button",
          className: "dshgn_swatch" + (active === hex ? " dshgn_swatchOn" : ""),
          title: hex,
          "aria-label": hex,
          style: { background: hex },
          onClick: () => setDraft(hex)
        })
      ),
      h4(
        "button",
        { type: "button", className: "dshgn_btn", onClick: () => setCustom(!custom) },
        custom ? t4("theme.preset") : t4("theme.custom")
      )
    ),
    custom ? h4(
      "div",
      { className: "dshgn_rowLine", style: { marginTop: 8 } },
      h4("input", {
        type: "color",
        className: "dshgn_colorInput",
        value: active === null ? "#0a2a52" : active,
        onChange: (event) => setDraft(event.target.value)
      }),
      h4("input", {
        className: "dshgn_input",
        value: active === null ? "" : active,
        spellCheck: false,
        placeholder: "#0a2a52",
        onChange: (event) => setDraft(event.target.value)
      })
    ) : null,
    // 三栏效果预览条：设置页主体是白卡片，用户在这儿看不到目录树/列表/正文，
    // 光靠点色块没法判断「左深中浅右白」到底长什么样，所以直接画一条出来。
    (() => {
      const preview = themeVars(active, isDarkTheme());
      if (preview === null) return null;
      return h4(
        "div",
        { className: "dshgn_previewBar", "aria-hidden": "true" },
        h4("div", { className: "dshgn_previewCell", style: { background: preview["--dshgn-deep"], color: preview["--dshgn-deepFg"] } }, t4("theme.previewLeft")),
        h4("div", { className: "dshgn_previewCell", style: { background: preview["--dshgn-mid"], color: preview["--dshgn-midFg"] } }, t4("theme.previewMid")),
        h4("div", { className: "dshgn_previewCell", style: { background: preview["--dshgn-light"], color: preview["--dshgn-lightFg"] } }, t4("theme.previewRight"))
      );
    })(),
    h4(
      "div",
      { className: "dshgn_rowLine", style: { marginTop: 10 } },
      h4("button", { type: "button", className: "dshgn_btn dshgn_btnPrimary", onClick: () => save(active), disabled: busy || draft === null }, t4("theme.apply")),
      h4("button", { type: "button", className: "dshgn_btn", onClick: () => save(null), disabled: busy }, t4("theme.reset"))
    )
  );
}
function CloudCredCard(props) {
  const { t: t4, api: apiInfo, onSaved, onError } = props;
  const configured = apiInfo !== null && apiInfo.configured === true;
  const [apiKey, setApiKey] = h2("");
  const [clientId, setClientId] = h2("");
  const [grantId, setGrantId] = h2("");
  const [busy, setBusy] = h2(false);
  const [testing, setTesting] = h2(false);
  const [probe, setProbe] = h2(null);
  const save = q2(async () => {
    if (apiKey.trim() === "" || clientId.trim() === "") {
      onError(t4("api.needKey"));
      return;
    }
    setBusy(true);
    setProbe(null);
    try {
      await api("/api/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim(), clientId: clientId.trim(), grantId: grantId.trim() })
      });
      setApiKey("");
      setClientId("");
      setGrantId("");
      await onSaved(t4("api.saved"));
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [apiKey, clientId, grantId, onSaved, onError, t4]);
  const test = q2(async () => {
    setTesting(true);
    setProbe(null);
    try {
      const result = await api("/api/probe");
      setProbe({ ok: true, text: `${t4("api.ok")}${result.total !== void 0 ? ` \xB7 ${result.total}` : ""}` });
    } catch (err) {
      setProbe({ ok: false, text: err && err.message ? err.message : String(err) });
      onError(err && err.message ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }, [onError, t4]);
  const clear = q2(async () => {
    if (!await confirmDialog(t4("api.clear"))) return;
    setBusy(true);
    setProbe(null);
    try {
      await api("/api/clear", { method: "POST" });
      await onSaved(t4("api.cleared"));
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [onSaved, onError, t4]);
  return h4(
    "div",
    { className: "dshgn_section" },
    h4(
      "div",
      { className: "dshgn_rowLine" },
      h4("div", { className: "dshgn_sectionTitle" }, t4("api.title")),
      h4("span", { className: "dshgn_badge" + (configured ? " dshgn_badgeOk" : "") }, configured ? t4("api.ready") : t4("api.notReady")),
      configured && apiInfo.apiKeyMasked ? h4("span", { className: "dshgn_treeCount" }, `${apiInfo.apiKeyMasked} \xB7 ${apiInfo.clientIdMasked || ""}`) : null
    ),
    h4("div", { className: "dshgn_sectionDesc" }, t4("api.desc")),
    // Key 被服务端拒过：这条必须显眼。用户填完 Key 看到「已接入」，然后云端每个
    // 操作都失败，却不知道为什么——那是这个插件最糟的体验。
    apiInfo !== null && apiInfo.keyRejected === true ? h4(
      "div",
      { className: "dshgn_banner dshgn_bannerWarn" },
      h4("div", { className: "dshgn_bannerTitle" }, t4("api.keyRejected")),
      h4("div", { className: "dshgn_bannerDesc" }, apiInfo.keyError || ""),
      apiInfo.fallbackAvailable === true ? h4("div", { className: "dshgn_bannerDesc" }, t4("api.usingFallback")) : null
    ) : null,
    // 走的是登录通道（不是 Key）：说明清楚，省得用户以为 Key 没存住
    apiInfo !== null && apiInfo.effectiveTransport === "mcp" && apiInfo.keyRejected !== true ? h4("div", { className: "dshgn_fieldHint" }, t4("api.viaLogin")) : null,
    h4(
      "div",
      { className: "dshgn_field" },
      h4("span", { className: "dshgn_fieldLabel" }, t4("api.apiKey")),
      h4("input", {
        className: "dshgn_input",
        type: "password",
        autoComplete: "off",
        spellCheck: false,
        value: apiKey,
        placeholder: configured ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\uFF08\u5DF2\u4FDD\u5B58\uFF0C\u91CD\u65B0\u586B\u53EF\u66FF\u6362\uFF09" : t4("api.keyPlaceholder"),
        onChange: (event) => setApiKey(event.target.value)
      })
    ),
    h4(
      "div",
      { className: "dshgn_field" },
      h4("span", { className: "dshgn_fieldLabel" }, t4("api.clientId")),
      h4("input", {
        className: "dshgn_input",
        spellCheck: false,
        value: clientId,
        placeholder: configured ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\uFF08\u5DF2\u4FDD\u5B58\uFF0C\u91CD\u65B0\u586B\u53EF\u66FF\u6362\uFF09" : t4("api.idPlaceholder"),
        onChange: (event) => setClientId(event.target.value)
      })
    ),
    h4(
      "div",
      { className: "dshgn_field" },
      h4("span", { className: "dshgn_fieldLabel" }, t4("api.grantId")),
      h4("input", {
        className: "dshgn_input",
        spellCheck: false,
        value: grantId,
        placeholder: configured && apiInfo.hasGrantId ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : t4("api.grantPlaceholder"),
        onChange: (event) => setGrantId(event.target.value)
      })
    ),
    h4(
      "div",
      { className: "dshgn_rowLine" },
      h4("button", { type: "button", className: "dshgn_btn dshgn_btnPrimary", onClick: save, disabled: busy }, busy ? h4("span", { className: "dshgn_spin" }) : h4(Icon, { name: "check", size: 12 }), t4("api.save")),
      configured ? h4("button", { type: "button", className: "dshgn_btn", onClick: test, disabled: testing }, testing ? h4("span", { className: "dshgn_spin" }) : null, testing ? t4("api.testing") : t4("api.test")) : null,
      configured ? h4("button", { type: "button", className: "dshgn_btn dshgn_btnDanger", onClick: clear, disabled: busy }, t4("api.clear")) : null
    ),
    probe !== null ? h4("div", { className: probe.ok ? "dshgn_fieldHint" : "dshgn_error", style: probe.ok ? { color: "var(--dsw-alias-state-success-primary)" } : void 0 }, `${probe.ok ? "\u2713" : "\u2715"} ${probe.text}`) : null,
    h4("div", { className: "dshgn_fieldHint" }, t4("api.consoleHint")),
    h4("div", { className: "dshgn_fieldHint" }, t4("api.neverEcho")),
    apiInfo !== null && apiInfo.credentialsPath ? h4("div", { className: "dshgn_fieldHint" }, `${t4("api.file")}: ${apiInfo.credentialsPath}`) : null
  );
}
var ErrorBoundaryBase = typeof compat_exports !== "undefined" && compat_exports && k ? k : class {
  constructor(props) {
    this.props = props || {};
    this.state = { error: null };
  }
};
var PanelBoundary = class extends ErrorBoundaryBase {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.retry = this.retry.bind(this);
  }
  static getDerivedStateFromError(error2) {
    return { error: error2 || new Error("\u6E32\u67D3\u5F02\u5E38") };
  }
  componentDidCatch(error2, info) {
    error("\u9762\u677F\u6E32\u67D3\u5F02\u5E38\uFF0C\u5DF2\u964D\u7EA7\u663E\u793A\uFF1A", error2, info && info.componentStack);
  }
  retry() {
    this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      const message = String(this.state.error && this.state.error.message || this.state.error);
      const stack = String(this.state.error && this.state.error.stack || "").split("\n").slice(0, 6).join("\n");
      return h4(
        "div",
        { className: "dshgn_root dshgn_boundary", role: "alert" },
        h4("div", { className: "dshgn_boundaryTitle" }, "\u5F97\u5230\u5927\u8111\u9762\u677F\u6E32\u67D3\u51FA\u9519"),
        h4("div", { className: "dshgn_boundaryMsg" }, message),
        h4("pre", { className: "dshgn_boundaryStack" }, stack),
        h4(
          "button",
          { type: "button", className: "dshgn_btn dshgn_btnPrimary", onClick: this.retry },
          "\u91CD\u8BD5"
        )
      );
    }
    return this.props.children;
  }
};
function PanelRoot(props) {
  return h4(PanelBoundary, null, h4(GetnotePage, props));
}

// src/view/view.js
var import_obsidian = require("obsidian");

// node_modules/preact/compat/client.mjs
function createRoot(container) {
  return {
    // eslint-disable-next-line
    render: function(children) {
      X(children, container);
    },
    // eslint-disable-next-line
    unmount: function() {
      _n(container);
    }
  };
}

// src/view/view.js
var VIEW_TYPE_GETNOTE = "getnote-brain-view";
var GetnoteView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.root = null;
    this.containerEl = null;
    this.heartbeat = null;
  }
  getViewType() {
    return VIEW_TYPE_GETNOTE;
  }
  getDisplayText() {
    return "\u5F97\u5230\u5927\u8111";
  }
  getIcon() {
    return "brain";
  }
  async onOpen() {
    injectCss();
    setMarkdownHost({ app: this.app, component: this.plugin, MarkdownRenderer: import_obsidian.MarkdownRenderer });
    const container = this.contentEl;
    container.empty();
    container.addClass("dshgn_view");
    this.containerEl = container;
    const mount = container.createDiv({ cls: "dshgn_mount" });
    this.root = createRoot(mount);
    this.root.render(_(PanelRoot, { plugin: this.plugin }));
    const beat = () => {
      if (!this.containerEl || !this.containerEl.isShown()) return;
      this.plugin.markPanelVisible();
    };
    beat();
    this.heartbeat = window.setInterval(beat, 2e4);
    this.registerInterval(this.heartbeat);
  }
  async onClose() {
    clearMarkdownHost();
    if (this.heartbeat !== null) {
      window.clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    const root = this.root;
    this.root = null;
    if (root) {
      window.setTimeout(() => {
        try {
          root.unmount();
        } catch {
        }
      }, 0);
    }
  }
};

// src/main.js
var DEFAULT_SUBFOLDER = "\u5F97\u5230\u5927\u8111";
var FRESH_INDEX_MS = 3e4;
var GetnoteObsidianPlugin = class extends import_obsidian2.Plugin {
  async onload() {
    const adapter2 = this.app.vault.adapter;
    const basePath2 = typeof adapter2.getBasePath === "function" ? adapter2.getBasePath() : "";
    const dataDir = this.resolveDataDir(basePath2);
    try {
      const moment = typeof require === "function" ? require("moment") : null;
      setHostLocale(moment && typeof moment.locale === "function" ? moment.locale() : null);
    } catch {
      setHostLocale(null);
    }
    configure2({ dataDir, vaultBase: basePath2, subfolder: DEFAULT_SUBFOLDER });
    configure({ adapter: adapter2, basePath: basePath2 });
    configureCardScripts({ baseDir: dataDir });
    setOpenExternal((url) => {
      try {
        const electron = typeof require === "function" ? require("electron") : null;
        if (electron && electron.shell && typeof electron.shell.openExternal === "function") {
          void electron.shell.openExternal(url);
          return true;
        }
      } catch {
      }
      return false;
    });
    setSaveFile(async (url, filename) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`\u5BFC\u51FA\u5931\u8D25\uFF1AHTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      const dir = (0, import_node_path7.join)((0, import_node_os2.tmpdir)(), "getnote-export");
      await (0, import_promises2.mkdir)(dir, { recursive: true });
      const target = (0, import_node_path7.join)(dir, filename);
      await (0, import_promises2.writeFile)(target, bytes);
      try {
        const electron = typeof require === "function" ? require("electron") : null;
        if (electron && electron.shell && typeof electron.shell.showItemInFolder === "function") {
          electron.shell.showItemInFolder(target);
        }
      } catch {
      }
      new import_obsidian2.Notice(`\u5F97\u5230\u5927\u8111\uFF1A\u5F52\u6863\u5305\u5DF2\u5BFC\u51FA\u5230 ${target}`);
      return true;
    });
    setNoteMenu((event, items) => {
      if (typeof import_obsidian2.Menu !== "function") return false;
      const menu = new import_obsidian2.Menu();
      for (const item of items) {
        menu.addItem((entry) => {
          entry.setTitle(item.label);
          if (item.danger === true) entry.setIcon("trash");
          entry.onClick(() => {
            item.run();
          });
        });
      }
      menu.showAtMouseEvent(event);
      return true;
    });
    setConfirmDialog((message) => this.askConfirm(message));
    setOpenInEditor((path) => this.openInVaultEditor(path));
    setMarkdownLink((path) => this.markdownLinkFor(path));
    setAssetUrl((path) => this.assetUrlFor(path));
    setRevealInVault((path) => this.revealInVaultItem(path));
    setDailyNote(() => this.dailyNoteRel());
    setLinkResolve((linkpath, sourcePath) => this.linkResolveFor(linkpath, sourcePath));
    setNewNotePlacement(() => this.newNoteDir());
    setOpenAsset((path) => this.openAssetInVault(path));
    setDailyTemplate(() => this.dailyTemplateContent());
    setRenameNote((path) => this.renameNoteInVault(path));
    setVaultGraph(
      (path, kind) => kind === "backlinks" ? this.vaultGraphWithSnippets(path, kind) : this.vaultGraphOf(path, kind)
    );
    setStatusReport((info) => this.updateStatusBar(info));
    const stored = await readSettings();
    this.debugLogging = stored.debugLogging === true;
    setDebugLogging(this.debugLogging);
    this.cardAutoImport = stored.cardAutoImport === true;
    this.followActive = stored.followActive === true;
    if (stored.subfolder && stored.subfolder !== DEFAULT_SUBFOLDER) {
      configure2({ subfolder: stored.subfolder });
    }
    const vaultRoot = resolveVaultRoot().root;
    try {
      await mkdir2(vaultRoot, { recursive: true });
    } catch (error2) {
      new import_obsidian2.Notice(`\u5F97\u5230\u5927\u8111\uFF1A\u7B14\u8BB0\u76EE\u5F55\u5EFA\u4E0D\u51FA\u6765 \u2014\u2014 ${error2 && error2.message ? error2.message : error2}`);
    }
    const preferredPort = Number(stored.localPort) > 0 ? Number(stored.localPort) : 0;
    try {
      this.server = await startLocalServer({ preferredPort });
      setApiOrigin(this.server.origin);
      setApiToken(this.server.token);
      this.localPort = this.server.port;
      this.portFallback = this.server.portFallback === true;
      if (this.portFallback) {
        new import_obsidian2.Notice(
          `\u5F97\u5230\u5927\u8111\uFF1A\u7AEF\u53E3 ${preferredPort} \u88AB\u522B\u7684\u7A0B\u5E8F\u5360\u7740\uFF0C\u8FD9\u6B21\u6539\u7528 ${this.server.port}\u3002\u4E91\u7AEF\u6388\u6743\uFF08OAuth\uFF09\u7684\u56DE\u8C03\u5730\u5740\u8DDF\u7740\u53D8\u4E86\uFF0C\u53EF\u80FD\u9700\u8981\u91CD\u65B0\u767B\u5F55\u4E00\u6B21\u3002`,
          8e3
        );
      }
      if (this.localPort !== preferredPort) {
        await this.saveLocalPort(this.localPort);
      }
    } catch (error2) {
      this.server = null;
      this.localPort = 0;
      this.portFallback = false;
      new import_obsidian2.Notice(`\u5F97\u5230\u5927\u8111\uFF1A\u672C\u5730\u670D\u52A1\u542F\u52A8\u5931\u8D25 \u2014\u2014 ${error2 && error2.message ? error2.message : error2}`);
    }
    this.registerView(VIEW_TYPE_GETNOTE, (leaf) => new GetnoteView(leaf, this));
    const ribbon = this.addRibbonIcon("brain", "\u5F97\u5230\u5927\u8111", () => {
      void this.activateView();
    });
    ribbon.addClass("dshgn_ribbon");
    this.addCommand({
      id: "open-panel",
      name: "\u6253\u5F00\u5F97\u5230\u5927\u8111\u9762\u677F",
      callback: () => {
        void this.activateView();
      }
    });
    this.addCommand({
      id: "open-in-new-window",
      name: "\u5728\u65B0\u7A97\u53E3\u6253\u5F00\u5F97\u5230\u5927\u8111",
      callback: () => {
        void this.activateView(true);
      }
    });
    const intentCommand = (id, name, intent) => {
      this.addCommand({
        id,
        name,
        callback: () => {
          void this.activateView().then(() => requestIntent(intent));
        }
      });
    };
    intentCommand("search-notes", "\u641C\u7D22\u5F97\u5230\u5927\u8111\u7B14\u8BB0", { type: "search" });
    intentCommand("new-note", "\u65B0\u5EFA\u5F97\u5230\u5927\u8111\u7B14\u8BB0", { type: "new" });
    intentCommand("open-today", "\u6253\u5F00\u4ECA\u5929\u7684\u7B14\u8BB0", { type: "today" });
    intentCommand("sync-now", "\u7ACB\u5373\u540C\u6B65\u5F97\u5230\u5927\u8111", { type: "sync" });
    intentCommand("scan-card", "\u626B\u63CF\u5F55\u97F3\u5361", { type: "card" });
    this.addCommand({
      id: "capture-selection",
      name: "\u628A\u9009\u4E2D\u7684\u6587\u5B57\u5B58\u8FDB\u5F97\u5230\u5927\u8111",
      editorCallback: (editor, view) => {
        this.captureFromEditor(editor, view);
      }
    });
    this.addCommand({
      id: "quick-switch-note",
      name: "\u5FEB\u901F\u5207\u6362\uFF1A\u6253\u5F00\u5F97\u5230\u5927\u8111\u7B14\u8BB0",
      callback: () => {
        void this.quickSwitchNote();
      }
    });
    this.addCommand({
      id: "open-active-note",
      name: "\u5728\u5F97\u5230\u5927\u8111\u91CC\u6253\u5F00\u5F53\u524D\u7B14\u8BB0",
      callback: () => {
        void this.openActiveNote();
      }
    });
    this.addCommand({
      id: "create-bases-view",
      name: "\u5728\u7B14\u8BB0\u76EE\u5F55\u91CC\u751F\u6210\u4E00\u4E2A Bases \u89C6\u56FE",
      callback: () => {
        void this.createBasesView();
      }
    });
    this.addCommand({
      id: "add-to-canvas",
      name: "\u628A\u5F53\u524D\u7B14\u8BB0\u653E\u8FDB\u5F97\u5230\u5927\u8111\u753B\u5E03",
      editorCallback: (editor, view) => {
        const path = view && view.file && typeof view.file.path === "string" ? view.file.path : "";
        if (path === "") {
          new import_obsidian2.Notice("\u5F97\u5230\u5927\u8111\uFF1A\u5148\u6253\u5F00\u4E00\u7BC7\u7B14\u8BB0");
          return;
        }
        void this.addNoteToCanvas(path);
      }
    });
    if (typeof this.registerObsidianProtocolHandler === "function") {
      this.registerObsidianProtocolHandler("getnote", (params) => {
        void this.handleDeepLink(params);
      });
    }
    if (typeof this.registerHoverLinkSource === "function") {
      try {
        this.registerHoverLinkSource("getnote-brain", { display: "\u5F97\u5230\u5927\u8111", defaultMod: false });
        setHoverSource("getnote-brain");
      } catch {
      }
    }
    if (this.server) {
      this.statusBarEl = this.addStatusBarItem();
      this.statusBarEl.addClass("dshgn_status");
      this.statusBarEl.setText("\u5F97\u5230\u5927\u8111");
      this.statusBarEl.title = `\u672C\u5730\u670D\u52A1 http://127.0.0.1:${this.localPort}${this.portFallback ? "\uFF08\u60F3\u8981\u7684\u7AEF\u53E3\u88AB\u5360\u7528\uFF0C\u8FD9\u6B21\u662F\u7CFB\u7EDF\u5206\u914D\u7684\uFF09" : ""}`;
      this.registerDomEvent(this.statusBarEl, "click", () => {
        void this.activateView();
      });
    }
    this.addSettingTab(new GetnoteSettingTab(this.app, this));
    const bump = () => invalidateScan();
    this.registerEvent(this.app.vault.on("modify", bump));
    this.registerEvent(this.app.vault.on("create", bump));
    this.registerEvent(this.app.vault.on("delete", bump));
    this.registerEvent(this.app.vault.on("rename", bump));
    const tellPanel = (kind) => (file, oldPath) => {
      const path = this.notePathInVault(file);
      if (path === "") return;
      notifyVaultChange({ kind, path, oldPath: typeof oldPath === "string" ? oldPath : "" });
    };
    this.registerEvent(this.app.vault.on("modify", tellPanel("modify")));
    this.registerEvent(this.app.vault.on("create", tellPanel("create")));
    this.registerEvent(this.app.vault.on("delete", tellPanel("delete")));
    this.registerEvent(this.app.vault.on("rename", tellPanel("rename")));
    this.registerEvent(this.app.workspace.on("css-change", () => notifyCssChange()));
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        void this.followActiveNote(file);
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!menu || typeof menu.addItem !== "function") return;
        const rel = this.notePathInVault(file);
        if (rel === "") return;
        menu.addItem((item) => {
          item.setTitle("\u5728\u5F97\u5230\u5927\u8111\u91CC\u6253\u5F00");
          item.setIcon("brain");
          item.onClick(() => {
            void this.activateView().then(() => requestIntent({ type: "open", path: rel }));
          });
        });
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        if (!menu || typeof menu.addItem !== "function" || !editor) return;
        const selection = typeof editor.getSelection === "function" ? String(editor.getSelection() || "") : "";
        menu.addItem((item) => {
          item.setTitle(
            selection.trim() === "" ? "\u628A\u8FD9\u4E00\u884C\u5B58\u8FDB\u5F97\u5230\u5927\u8111" : "\u628A\u9009\u4E2D\u7684\u6587\u5B57\u5B58\u8FDB\u5F97\u5230\u5927\u8111"
          );
          item.setIcon("brain");
          item.onClick(() => {
            this.captureFromEditor(editor, view);
          });
        });
      })
    );
    setSyncReport((result) => {
      void this.appendSyncReport(result);
    });
    this.stopAutoSync = startAutoSync();
    this.stopCardAutoImport = startCardAutoImport();
  }
  /**
   * 把 obsidian://getnote?... 的参数翻成一条面板意图。
   *
   * 认得的只有「导航」，没有「写」：深链可以被任意网页、聊天窗口里的链接触发，
   * 一个能被别人一点就删笔记的 URL 是不能接受的。所以这里只有 open / search /
   * new / today / sync 五种，其余一律返回 null（等于「只把面板打开」）。
   *
   * path 两种写法都收：库内相对路径（`得到大脑/随手记/甲.md`，从别的笔记里复制
   * 出来的就是这种）和面板口径（`随手记/甲.md`）。后者本来就不以笔记目录开头，
   * 剥前缀那一步碰不到它，所以不用先判断是哪一种。
   */
  deepLinkIntent(params) {
    const action = params && typeof params.action === "string" ? params.action : "open";
    const query = params && typeof params.q === "string" ? params.q : "";
    if (action === "search") return { type: "search", q: query };
    if (action === "new") return { type: "new" };
    if (action === "today") return { type: "today" };
    if (action === "sync") return { type: "sync" };
    if (action !== "open") return null;
    const raw = params && typeof params.path === "string" ? params.path.replace(/\\/g, "/").replace(/^\/+/, "") : "";
    if (raw === "" || !raw.toLowerCase().endsWith(".md")) return null;
    const runtime2 = getRuntime();
    const sub = String(runtime2.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, "");
    const path = sub !== "" && raw.startsWith(sub + "/") ? raw.slice(sub.length + 1) : raw;
    if (path === "") return null;
    return { type: "open", path };
  }
  /**
   * 接住一条深链：先把面板叫起来，再把意图投过去。
   *
   * 顺序不能反：意图总线在没有监听者时会暂存，但面板挂载时取走的那一份只有一条，
   * 而 activateView 期间用户可能已经点了别的动作——先开面板再投递，投递的这份
   * 一定落在活着的监听者手里。
   */
  async handleDeepLink(params) {
    const intent = this.deepLinkIntent(params);
    try {
      await this.activateView();
    } catch {
    }
    if (intent !== null) requestIntent(intent);
  }
  /**
   * 把宿主的库内路径翻成面板里的笔记路径（相对笔记子目录）。
   *
   * 宿主的 file.path 是库内相对路径（`得到大脑/随手记/甲.md`），而面板的
   * entry.path 相对的是笔记目录本身。不在笔记目录里的文件一律返回空串——
   * 右键菜单不该对无关文件冒出我们这一条。
   */
  notePathInVault(file) {
    const raw = file && typeof file.path === "string" ? file.path.replace(/^\/+/, "") : "";
    if (raw === "" || !raw.toLowerCase().endsWith(".md")) return "";
    const runtime2 = getRuntime();
    const sub = String(runtime2.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, "");
    if (sub === "") return raw;
    if (raw === sub) return "";
    if (!raw.startsWith(`${sub}/`)) return "";
    return raw.slice(sub.length + 1);
  }
  /**
   * 把编辑器里选中的文字（没选就是当前行）存成一篇笔记。
   *
   * 命令面板的「把选中的文字存进得到大脑」和编辑器右键菜单走的是同一条路，
   * 所以抽出来一份——两边行为不一致的话，用户会以为右键那条是坏的。
   */
  captureFromEditor(editor, view) {
    if (!editor) return false;
    const selection = typeof editor.getSelection === "function" ? String(editor.getSelection() || "") : "";
    const cursor = typeof editor.getCursor === "function" ? editor.getCursor() : null;
    const text = selection.trim() !== "" ? selection : cursor !== null && typeof editor.getLine === "function" ? String(editor.getLine(cursor.line) || "") : "";
    if (text.trim() === "") {
      new import_obsidian2.Notice("\u5F97\u5230\u5927\u8111\uFF1A\u5148\u9009\u4E2D\u8981\u6458\u7684\u6587\u5B57");
      return false;
    }
    const source = view && view.file && typeof view.file.path === "string" ? view.file.path : "";
    void this.activateView().then(() => requestIntent({ type: "capture", text, source }));
    return true;
  }
  /**
   * 快速切换器里挑一篇得到大脑的笔记。
   *
   * 用宿主自己的 SuggestModal 而不是我们面板里的搜索框：用户按 Ctrl/Cmd+O 是
   * 想「去那一篇」，不是「打开面板再搜一次」。搜索本身交给面板已有的
   * /search（它认得 tag:/dir:/裸标签这些写法），这里只负责把候选列出来。
   */
  async quickSwitchNote() {
    const plugin = this;
    const Suggest = typeof import_obsidian2.FuzzySuggestModal === "function" ? import_obsidian2.FuzzySuggestModal : null;
    if (Suggest === null) {
      void this.activateView().then(() => requestIntent({ type: "search" }));
      return;
    }
    let items = [];
    try {
      const root = (await resolveVaultRoot()).root;
      const result = await scanVault(root);
      items = result.entries;
    } catch {
      new import_obsidian2.Notice("\u5F97\u5230\u5927\u8111\uFF1A\u5E93\u8FD8\u6CA1\u51C6\u5907\u597D\uFF0C\u5148\u6253\u5F00\u9762\u677F\u770B\u4E00\u773C");
      return;
    }
    const modal = new class extends Suggest {
      getItems() {
        return items;
      }
      getItemText(item) {
        const dir = item.dir === "" ? "" : `${item.dir} / `;
        return `${dir}${item.title || item.path}`;
      }
      onChooseItem(item) {
        if (!item || typeof item.path !== "string") return;
        void plugin.activateView().then(() => requestIntent({ type: "open", path: item.path }));
      }
    }(this.app);
    modal.setPlaceholder("\u641C\u7D22\u5F97\u5230\u5927\u8111\u91CC\u7684\u7B14\u8BB0");
    modal.open();
  }
  /**
   * 在宿主里打开库内的某个文件（不只是 .md）。
   *
   * `openInVaultEditor` 走的是同一套入口，但它被设计成同步返回布尔值，用在
   * 面板的按钮回调里。刚写完的文件在宿主的文件表里可能还没登记（写入与索引
   * 是两条路），所以这里带几次重试：写完立刻打开，失败就等一会儿再试。
   */
  async openVaultFile(relPath, attempts = 4) {
    const rel = String(relPath || "").replace(/^\/+/, "");
    if (rel === "") return false;
    for (let i3 = 0; i3 < attempts; i3 += 1) {
      const file = this.app.vault.getAbstractFileByPath ? this.app.vault.getAbstractFileByPath(rel) : null;
      if (file) {
        try {
          await this.app.workspace.getLeaf("tab").openFile(file);
          return true;
        } catch {
          return false;
        }
      }
      await new Promise((resolve5) => setTimeout(resolve5, 80));
    }
    return false;
  }
  /**
   * 在笔记目录里写一份 `.base`：Obsidian 1.9 的 Bases 视图能直接打开它。
   *
   * 有了它，用户可以在 Bases 里按标签/日期分组、写自己的公式，而不用回到我们
   * 这个面板——同一个笔记库，两套视图各有各的顺手处。
   */
  async createBasesView() {
    try {
      const runtime2 = getRuntime();
      const subfolder = String(runtime2.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, "");
      const target = subfolder === "" ? "\u5F97\u5230\u5927\u8111.base" : `${subfolder}/\u5F97\u5230\u5927\u8111.base`;
      const abs = (0, import_node_path7.join)(runtime2.vaultBase, target);
      let already = false;
      try {
        await access2(abs);
        already = true;
      } catch {
        already = false;
      }
      if (already) {
        new import_obsidian2.Notice("\u5F97\u5230\u5927\u8111\uFF1A\u8FD9\u4E2A Bases \u89C6\u56FE\u5DF2\u7ECF\u5B58\u5728\u4E86");
        await this.openVaultFile(target);
        return;
      }
      await writeFile2(abs, basesTemplate({ subfolder: subfolder || DEFAULT_SUBFOLDER }));
      invalidateScan();
      if (await this.openVaultFile(target)) new import_obsidian2.Notice(`\u5F97\u5230\u5927\u8111\uFF1A\u5DF2\u751F\u6210\u5E76\u6253\u5F00 ${target}`);
      else new import_obsidian2.Notice(`\u5F97\u5230\u5927\u8111\uFF1A\u5DF2\u751F\u6210 ${target}`);
    } catch (error2) {
      new import_obsidian2.Notice(`\u5F97\u5230\u5927\u8111\uFF1A\u751F\u6210 Bases \u89C6\u56FE\u5931\u8D25 \u2014\u2014 ${error2 && error2.message ? error2.message : error2}`);
    }
  }
  /**
   * 把一篇笔记放进「得到大脑画布」：没有就建一张，有就加一个文件节点。
   *
   * 画布是 .canvas（JSON），节点只是 {type:'file', file: 相对路径}。这样用户在
   * 画布里拖动、连线之后，我们的命令下次只负责补节点，不会重排他摆好的布局。
   */
  async addNoteToCanvas(notePath) {
    try {
      const runtime2 = getRuntime();
      const subfolder = String(runtime2.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, "");
      const canvasRel = subfolder === "" ? "\u5F97\u5230\u5927\u8111\u753B\u5E03.canvas" : `${subfolder}/\u5F97\u5230\u5927\u8111\u753B\u5E03.canvas`;
      const canvasAbs = (0, import_node_path7.join)(runtime2.vaultBase, canvasRel);
      const fileRel = String(notePath).replace(/^\/+/, "");
      let canvas = parseCanvas("");
      try {
        canvas = parseCanvas(await readFile2(canvasAbs, "utf8"));
      } catch {
      }
      const { canvas: next, added } = addFileNode(canvas, { file: fileRel });
      if (!added) {
        new import_obsidian2.Notice("\u5F97\u5230\u5927\u8111\uFF1A\u8FD9\u7BC7\u5DF2\u7ECF\u5728\u753B\u5E03\u91CC\u4E86");
        return;
      }
      await writeFile2(canvasAbs, serializeCanvas(next));
      invalidateScan();
      if (await this.openVaultFile(canvasRel)) new import_obsidian2.Notice(`\u5F97\u5230\u5927\u8111\uFF1A\u5DF2\u653E\u8FDB ${canvasRel}`);
      else new import_obsidian2.Notice(`\u5F97\u5230\u5927\u8111\uFF1A\u5DF2\u653E\u8FDB ${canvasRel}\uFF08\u6253\u5F00\u753B\u5E03\u5C31\u80FD\u770B\u5230\uFF09`);
    } catch (error2) {
      new import_obsidian2.Notice(`\u5F97\u5230\u5927\u8111\uFF1A\u653E\u8FDB\u753B\u5E03\u5931\u8D25 \u2014\u2014 ${error2 && error2.message ? error2.message : error2}`);
    }
  }
  onunload() {
    if (typeof this.stopCardAutoImport === "function") {
      this.stopCardAutoImport();
      this.stopCardAutoImport = null;
    }
    if (typeof this.stopAutoSync === "function") {
      this.stopAutoSync();
      this.stopAutoSync = null;
    }
    if (this.server) {
      void this.server.close();
      this.server = null;
    }
    setApiOrigin("");
    setApiToken("");
  }
  /**
   * 当天日记的库内路径；用户没开「日记」核心插件时返回空串。
   *
   * 直接读核心插件的配置而不是自己猜格式：那里的 folder / format 是用户调过的
   * （很多人是 `日记/YYYY/YYYY-MM-DD`），插件另起一套只会把摘要写到没人看的地方。
   * 内部 API 拿不到时按最常见的 `YYYY-MM-DD` 放在库根。
   */
  dailyNotePath() {
    const pad2 = (n2) => String(n2).padStart(2, "0");
    const now = /* @__PURE__ */ new Date();
    let folder = "";
    let format = "YYYY-MM-DD";
    try {
      const plugins = this.app.internalPlugins;
      const daily = plugins && typeof plugins.getPluginById === "function" ? plugins.getPluginById("daily-notes") : null;
      const options = daily && daily.instance && daily.instance.options ? daily.instance.options : null;
      if (daily && daily.enabled === false) return "";
      if (options) {
        if (typeof options.folder === "string") folder = options.folder;
        if (typeof options.format === "string" && options.format !== "") format = options.format;
      } else if (!daily) {
        return "";
      }
    } catch {
      return "";
    }
    const name = format.replace(/YYYY/g, String(now.getFullYear())).replace(/MM/g, pad2(now.getMonth() + 1)).replace(/DD/g, pad2(now.getDate()));
    const rel = folder.trim() === "" ? name : `${folder.replace(/\\/g, "/").replace(/\/+$/, "")}/${name}`;
    return `${rel}.md`;
  }
  /**
   * 今天的日记，按面板的路径口径给（相对笔记子目录，没有子目录时就是库内相对路径）。
   *
   * dailyNotePath() 给的是库内相对路径，面板的 entry.path / /create 的 dir 都按
   * 笔记子目录算，两者差一层子目录，这里补上。日记落在笔记目录之外时返回 ''，
   * 面板据此退回自己的日期标题——我们不替用户把日记搬进笔记目录。
   */
  dailyNoteRel() {
    const full = this.dailyNotePath();
    if (full === "") return "";
    const runtime2 = getRuntime();
    const sub = String(runtime2.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, "");
    if (sub === "") return full;
    if (!full.startsWith(`${sub}/`)) return "";
    return full.slice(sub.length + 1);
  }
  /**
   * 宿主日记插件里配好的模板正文；没配或读不到就返回空串。
   *
   * 「设置 → 核心插件 → 日记 → 模板文件」指向一篇库里的笔记，新建日记时会把它
   * 整个填进去（标题骨架、几个提问、常用标签）。我们这边如果建一篇空的，用户
   * 在同一个库里就有两种「今天的日记」——一种有骨架，一种光秃秃。
   *
   * 读文件用 vfs，走宿主的 adapter；读不到（文件被删、路径写错、模板在库外）
   * 一律当没有，不让新建失败。
   */
  async dailyTemplateContent() {
    try {
      const plugins = this.app.internalPlugins;
      const daily = plugins && typeof plugins.getPluginById === "function" ? plugins.getPluginById("daily-notes") : null;
      if (!daily || daily.enabled === false) return "";
      const options = daily.instance && daily.instance.options ? daily.instance.options : null;
      if (!options || typeof options.template !== "string") return "";
      const rel = options.template.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      if (rel === "") return "";
      const base = String(getRuntime().vaultBase || "").replace(/\\/g, "/").replace(/\/+$/, "");
      const abs = base === "" ? rel : `${base}/${rel}`;
      const text = await readFile2(abs, "utf8");
      return typeof text === "string" ? text : "";
    } catch {
      return "";
    }
  }
  /**
   * 新建的笔记该落在哪个目录（面板口径），按宿主的设置来。
   *
   * 「设置 → 文件与链接 → 新建笔记的默认位置」有三档：库根 / 当前笔记所在目录 /
   * 指定目录。面板原来固定丢在笔记目录根，用户在别处点「新建笔记」看到的却是
   * 另一个位置，同一个库里于是有两套「新建落在哪」。宿主的设置存在 vault 配置里
   * （getConfig 的 newFileLocation / newFileFolderPath），这里换算成面板口径。
   *
   * 落在笔记目录之外、或宿主要求跟着当前笔记但当前没有打开的文件，返回空串，
   * 面板退回自己的做法——不替用户把笔记建到笔记目录外面去。
   */
  newNoteDir() {
    try {
      const vault = this.app.vault;
      if (!vault || typeof vault.getConfig !== "function") return "";
      const where = String(vault.getConfig("newFileLocation") || "");
      let target = "";
      if (where === "folder") {
        target = String(vault.getConfig("newFileFolderPath") || "");
      } else if (where === "current") {
        const active = this.app.workspace.getActiveFile ? this.app.workspace.getActiveFile() : null;
        if (!active || !active.parent || typeof active.parent.path !== "string") return "";
        target = active.parent.path;
      } else {
        return "";
      }
      const rel = target.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      const runtime2 = getRuntime();
      const sub = String(runtime2.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, "");
      if (sub === "") return rel;
      if (rel === "" || rel === sub) return "";
      if (!rel.startsWith(`${sub}/`)) return "";
      return rel.slice(sub.length + 1);
    } catch {
      return "";
    }
  }
  /**
   * 一个双链该指向哪一篇，交给宿主的索引去解析。
   *
   * getFirstLinkpathDest 是 Obsidian 自己用的那套规则：别名、不带扩展名的路径
   * 前缀、同名笔记取离 sourcePath 最近的一篇、大小写按库里实际文件名。面板自己
   * 在 entries 里三级退让能应付常见的 [[笔记名]]，但同名笔记一多就会指错，而
   * 「点进去是另一篇」这种错用户很难察觉。
   *
   * 返回面板口径（相对笔记子目录）的路径；解析不出来、或结果落在笔记目录之外，
   * 返回空串让面板退回自己那套。
   */
  linkResolveFor(linkpath, sourcePath) {
    try {
      const wanted = String(linkpath || "").trim();
      if (wanted === "") return "";
      const cache = this.app.metadataCache;
      if (!cache || typeof cache.getFirstLinkpathDest !== "function") return "";
      const source = String(sourcePath || "").replace(/^\/+/, "");
      const dest = cache.getFirstLinkpathDest(wanted, source);
      if (!dest || typeof dest.path !== "string") return "";
      return this.notePathInVault(dest);
    } catch {
      return "";
    }
  }
  /**
   * 把一轮同步的结果追加到当天的日记里。
   *
   * 用 Obsidian 的日常笔记配置（设置 → 日记）找文件：那里已经定义好了目录、
   * 文件名格式和模板，插件再自己猜一套只会和用户已有的习惯打架。找不到配置
   * 或者文件不存在就直接跳过——多数用户没开日常笔记，这不是错误。
   */
  async appendSyncReport(result) {
    if (result === null || typeof result !== "object") return;
    const pulled = Number(result.pulled) || 0;
    if (pulled <= 0) return;
    const path = this.dailyNotePath();
    if (path === "") return;
    const stamp = /* @__PURE__ */ new Date();
    const pad2 = (n2) => String(n2).padStart(2, "0");
    const hm = `${pad2(stamp.getHours())}:${pad2(stamp.getMinutes())}`;
    const line = `
- ${hm} \u5F97\u5230\u5927\u8111\u540C\u6B65\uFF1A\u65B0\u589E ${pulled} \u7BC7${Number(result.skipped) > 0 ? `\uFF0C\u8DF3\u8FC7 ${result.skipped} \u7BC7` : ""}${Number(result.conflicts) > 0 ? `\uFF0C${result.conflicts} \u5904\u51B2\u7A81\u5F85\u5904\u7406` : ""}
`;
    const adapter2 = this.app.vault.adapter;
    const basePath2 = typeof adapter2.getBasePath === "function" ? adapter2.getBasePath() : "";
    if (basePath2 === "") return;
    const abs = `${basePath2.replace(/\\/g, "/").replace(/\/+$/, "")}/${path}`;
    let before = "";
    try {
      before = String(await readFile2(abs, "utf8"));
    } catch {
      before = "";
    }
    try {
      await writeFile2(abs, before === "" ? line.replace(/^\n/, "") : `${before.replace(/\s*$/, "")}${line}`, "utf8");
    } catch {
    }
  }
  /**
   * 插件数据目录的绝对路径。
   *
   * 凭证（OAuth token / API Key）写在插件自己的目录里而不是 localStorage：
   * 库被同步或分享出去时不该带上它们，而且明文塞 localStorage 更容易被别的
   * 插件读到。settings.js 用的是 node:fs，所以要绝对路径。
   */
  resolveDataDir(basePath2) {
    const configDir = this.app.vault.configDir || ".obsidian";
    const rel = `${configDir}/plugins/${this.manifest.id}`;
    if (basePath2 === "") return rel;
    return `${basePath2.replace(/\\/g, "/").replace(/\/+$/, "")}/${rel}`;
  }
  markPanelVisible() {
    markPanelVisible();
  }
  /** 打开（或聚焦）面板；`newWindow` 用 Obsidian 的独立窗口打开。 */
  async activateView(newWindow = false) {
    if (!this.server) {
      new import_obsidian2.Notice("\u5F97\u5230\u5927\u8111\uFF1A\u672C\u5730\u670D\u52A1\u8FD8\u6CA1\u5C31\u7EEA\uFF0C\u5148\u770B\u4E00\u773C\u8BBE\u7F6E\u9875\u91CC\u7684\u63D0\u793A\u3002");
      return;
    }
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_GETNOTE);
    if (existing.length > 0 && !newWindow) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = newWindow ? this.app.workspace.openPopoutLeaf({ size: { width: 1100, height: 780 } }) : this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_GETNOTE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  /**
   * 状态栏文案跟着面板里的实际情况走。
   *
   * 只写「得到大脑」四个字太浪费：状态栏是用户唯一一直看得见我们的地方，
   * 库里有几篇、当前开着哪一篇，写在这里用户扫一眼就知道。面板每次
   * 库或当前笔记变化都会调过来，这里只做字符串拼接，不做任何 IO。
   */
  updateStatusBar(info) {
    const el = this.statusBarEl;
    if (!el || typeof el.setText !== "function") return;
    const count = info && Number.isFinite(info.count) ? Math.max(0, info.count) : 0;
    const note = info && typeof info.note === "string" ? info.note.trim() : "";
    if (note !== "") {
      const short = note.length > 18 ? `${note.slice(0, 18)}\u2026` : note;
      el.setText(`\u5F97\u5230\u5927\u8111 \xB7 ${short}`);
      return;
    }
    el.setText(count > 0 ? `\u5F97\u5230\u5927\u8111 \xB7 ${count} \u7BC7` : "\u5F97\u5230\u5927\u8111");
  }
  /**
   * 面板里的确认框。
   *
   * 面板原来用 window.confirm：Electron 里能用，但长得跟宿主完全不搭，移动端
   * WebView 还可能根本不弹——删除、清空这种不可逆的动作就等于没有二次确认。
   * Modal 由宿主渲染，遮罩、焦点、Esc 都归 Obsidian 管。
   *
   * 返回 Promise<boolean>，用户点「确定」才是 true；关窗（Esc、点遮罩）算取消。
   */
  askConfirm(message) {
    if (typeof import_obsidian2.Modal !== "function") return Promise.resolve(false);
    return new Promise((resolve5) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve5(value);
      };
      class ConfirmModal extends import_obsidian2.Modal {
        onOpen() {
          const { contentEl } = this;
          contentEl.createEl("p", { text: String(message) });
          const bar = contentEl.createDiv({ cls: "modal-button-container" });
          const ok = bar.createEl("button", { text: "\u786E\u5B9A", cls: "mod-cta" });
          ok.addEventListener("click", () => {
            finish(true);
            this.close();
          });
          const cancel = bar.createEl("button", { text: "\u53D6\u6D88" });
          cancel.addEventListener("click", () => {
            finish(false);
            this.close();
          });
          if (typeof cancel.focus === "function") cancel.focus();
        }
        onClose() {
          finish(false);
          if (this.contentEl && typeof this.contentEl.empty === "function") this.contentEl.empty();
        }
      }
      new ConfirmModal(this.app).open();
    });
  }
  /**
   * 宿主文件列表的接口（能「在文件夹里亮出这一项」的那个）。
   *
   * Obsidian 没把这件事做成公开 API：老版本挂在 internalPlugins 的
   * file-explorer 实例上，新版本也可能只有叶子视图上有。两处都试一遍，
   * 都拿不到就返回 null，让调用方明说「定位不了」而不是静默失败。
   */
  fileExplorerApi() {
    try {
      const internal = this.app.internalPlugins;
      const plugin = internal && typeof internal.getPluginById === "function" ? internal.getPluginById("file-explorer") : null;
      const instance = plugin && plugin.instance ? plugin.instance : null;
      if (instance && typeof instance.revealInFolder === "function") return instance;
      const leaves = this.app.workspace.getLeavesOfType ? this.app.workspace.getLeavesOfType("file-explorer") : [];
      const view = leaves && leaves.length > 0 && leaves[0].view ? leaves[0].view : null;
      if (view && typeof view.revealInFolder === "function") return view;
      return null;
    } catch {
      return null;
    }
  }
  /**
   * 把这一项在宿主的文件列表里亮出来。
   *
   * 面板传的可能是相对笔记目录的路径（列表里 entry.path 就是这种），也可能
   * 是库内相对路径，两种都认。
   */
  revealInVaultItem(path) {
    try {
      const raw = String(path || "").replace(/\\/g, "/").replace(/^\/+/, "");
      if (raw === "") return false;
      const runtime2 = getRuntime();
      const sub = String(runtime2.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, "");
      const candidates = [raw];
      if (sub !== "" && !raw.startsWith(sub + "/")) candidates.push(`${sub}/${raw}`);
      let file = null;
      for (const candidate of candidates) {
        const hit = this.app.vault.getAbstractFileByPath(candidate);
        if (hit) {
          file = hit;
          break;
        }
      }
      if (file === null) return false;
      const explorer = this.fileExplorerApi();
      if (explorer === null) {
        new import_obsidian2.Notice("\u5F97\u5230\u5927\u8111\uFF1A\u8FD9\u4E2A\u7248\u672C\u7684 Obsidian \u6CA1\u6709\u6587\u4EF6\u5217\u8868\u63A5\u53E3\uFF0C\u5B9A\u4F4D\u4E0D\u4E86");
        return false;
      }
      try {
        const leaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
        if (leaf && typeof this.app.workspace.revealLeaf === "function") this.app.workspace.revealLeaf(leaf);
      } catch {
      }
      explorer.revealInFolder(file);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * 把一张图片交给宿主打开。
   *
   * 面板里的图片是拿资源地址直接画出来的，点了本来什么都不会发生。宿主自己
   * 有图片视图（滚轮缩放、左右翻页、能拖出去），交给它比在面板里再写一个
   * 全屏浮层更省事，也更符合用户在 Obsidian 里的习惯。
   *
   * 路径口径与面板别处一致：可以是相对笔记目录的，也可以是库内相对的。
   * 找不到（附件还在云端、或者路径带错）返回 false，面板据此不提示。
   */
  openAssetInVault(path) {
    try {
      const raw = String(path || "").replace(/\\/g, "/");
      if (raw === "") return false;
      const runtime2 = getRuntime();
      const base = String(runtime2.vaultBase || "").replace(/\\/g, "/").replace(/\/+$/, "");
      const sub = String(runtime2.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, "");
      let rel = raw.replace(/^\/+/, "");
      const baseBare = base.replace(/^\/+/, "");
      if (baseBare !== "" && rel.startsWith(baseBare + "/")) rel = rel.slice(baseBare.length + 1);
      const candidates = [rel];
      if (sub !== "" && !rel.startsWith(sub + "/")) candidates.push(`${sub}/${rel}`);
      for (const candidate of candidates) {
        const file = this.app.vault.getAbstractFileByPath(candidate);
        if (file) {
          void this.app.workspace.getLeaf("tab").openFile(file);
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }
  /**
   * 把库内相对路径交给宿主编辑器打开。
   *
   * 面板自己的编辑器只能改正文：没有补全、没有 Vim、没有别的插件挂上来的命令。
   * 找不到这个文件（刚被删、路径带错）返回 false，面板据此决定要不要提示。
   */
  openInVaultEditor(path) {
    try {
      const raw = String(path || "").replace(/\\/g, "/");
      if (raw === "") return false;
      const runtime2 = getRuntime();
      const base = String(runtime2.vaultBase || "").replace(/\\/g, "/").replace(/\/+$/, "");
      const sub = String(runtime2.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, "");
      let rel = raw.replace(/^\/+/, "");
      const baseBare = base.replace(/^\/+/, "");
      if (baseBare !== "" && rel.startsWith(baseBare + "/")) rel = rel.slice(baseBare.length + 1);
      const candidates = [rel];
      if (sub !== "" && !rel.startsWith(sub + "/")) candidates.push(`${sub}/${rel}`);
      for (const candidate of candidates) {
        const file = this.app.vault.getAbstractFileByPath(candidate);
        if (!file) continue;
        void this.app.workspace.getLeaf("tab").openFile(file);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  /**
   * 让宿主弹它自己的改名对话框，改完把新路径交回面板。
   *
   * 为什么不自己 rename 文件：宿主改名时会同步重写全库的 [[双链]] 与 Markdown
   * 链接。我们绕过它直接改文件名，别的笔记里的引用就成了死链，而且没有任何
   * 提示——用户往往几个月后才在某篇笔记里发现一串点不开的链接。
   *
   * 用 promptForFileRename 而不是 renameFile：前者是用户熟悉的那个对话框，
   * 预填原名、回车确认、自动避开重名；后者要我们自己做输入界面，还得自己
   * 处理「名字里有斜杠」「已存在」这些边界。用户取消（对话框关掉）时路径
   * 没变，返回空串，面板据此什么都不做。
   */
  async renameNoteInVault(path) {
    try {
      const raw = String(path || "").replace(/\\/g, "/");
      if (raw === "") return "";
      const runtime2 = getRuntime();
      const base = String(runtime2.vaultBase || "").replace(/\\/g, "/").replace(/\/+$/, "");
      const sub = String(runtime2.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, "");
      let rel = raw.replace(/^\/+/, "");
      const baseBare = base.replace(/^\/+/, "");
      if (baseBare !== "" && rel.startsWith(baseBare + "/")) rel = rel.slice(baseBare.length + 1);
      const candidates = [rel];
      if (sub !== "" && !rel.startsWith(sub + "/")) candidates.push(`${sub}/${rel}`);
      let file = null;
      for (const candidate of candidates) {
        const hit = this.app.vault.getAbstractFileByPath(candidate);
        if (hit) {
          file = hit;
          break;
        }
      }
      if (!file) return "";
      const manager = this.app.fileManager;
      if (!manager || typeof manager.promptForFileRename !== "function") {
        new import_obsidian2.Notice("\u5F97\u5230\u5927\u8111\uFF1A\u8FD9\u4E2A\u7248\u672C\u7684 Obsidian \u6CA1\u6709\u6539\u540D\u5BF9\u8BDD\u6846\uFF0C\u6539\u4E0D\u4E86");
        return "";
      }
      const before = String(file.path || "");
      await manager.promptForFileRename(file);
      const after = String(file.path || "");
      if (after === "" || after === before) return "";
      return this.notePathInVault(file);
    } catch {
      return "";
    }
  }
  /**
   * 把面板切到「当前正在看的这篇」。
   *
   * 用户在 Obsidian 里读或改一篇笔记时，最想要的是「它在得到大脑里长什么样」：
   * 谁引用了它、同步过没有、有没有历史版本、附件齐不齐。这些都在面板里，
   * 但面板不会自己跟着宿主的活动笔记走（那会让面板在用户切来切去时乱跳）。
   * 所以给一条命令，用户想跟的时候按一下。
   *
   * 当前笔记不在笔记目录里（或者没开笔记）时给出明确提示，而不是静默不动——
   * 静默不动会被当成命令坏了。
   */
  async openActiveNote() {
    const file = this.app.workspace.getActiveFile ? this.app.workspace.getActiveFile() : null;
    const rel = this.notePathInVault(file);
    if (rel === "") {
      const sub = String(getRuntime().subfolder || DEFAULT_SUBFOLDER);
      new import_obsidian2.Notice(`\u5F97\u5230\u5927\u8111\uFF1A\u5F53\u524D\u7B14\u8BB0\u4E0D\u5728\u300C${sub}\u300D\u76EE\u5F55\u91CC`);
      return;
    }
    try {
      await this.activateView();
    } catch {
    }
    requestIntent({ type: "open", path: rel });
  }
  /**
   * 跟着宿主切换：当前笔记变了就把面板切到同一篇。
   *
   * 三件事按这个顺序挡在前面，每一件都是「不做」比「做了」好：
   *   1. 这篇不在笔记目录里 —— 用户在库根翻 README 时不该被拽进「得到大脑」；
   *   2. 面板没开着 —— 只是翻笔记却被弹出一个面板，是最烦人的那种「贴心」；
   *   3. 开关关着 —— 默认就是关的，用户点头才跟。
   *
   * 开关现读一遍而不是信 onload 的快照：面板的设置页也能改它，改完不该等重启。
   * 设置文件读不出来时按「关」处理——跟随是「面板自己动」，出问题时宁可不跟，
   * 也不要凭空把用户正在看的笔记顶掉。
   *
   * 返回一句话说明这次为什么跟/没跟，方便自测和排查；真正干活的是投递那条意图。
   */
  async followActiveNote(file) {
    const rel = this.notePathInVault(file);
    if (rel === "") return "outside";
    const leaves = this.app.workspace.getLeavesOfType ? this.app.workspace.getLeavesOfType(VIEW_TYPE_GETNOTE) : [];
    if (!Array.isArray(leaves) || leaves.length === 0) return "closed";
    let on2 = this.followActive === true;
    try {
      const settings = await readSettings();
      on2 = settings.followActive === true;
      this.followActive = on2;
    } catch {
    }
    if (!on2) return "off";
    requestIntent({ type: "open", path: rel });
    return "followed";
  }
  /**
   * 生成一条指向这篇笔记的链接，格式按用户的 Obsidian 设置来。
   *
   * `app.fileManager.generateMarkdownLink` 会读「使用 Wiki 链接」与「新链接格式」
   * 两项设置，给出 `[[随手记/甲|甲]]` 或 `[甲](随手记/甲.md)`。面板的「复制引用」
   * 拿它当首选——用户复制引用是为了粘进另一篇笔记，不是喂给外部工具。
   *
   * 面板传进来的是「相对笔记目录」的路径，宿主要的是库内相对路径，这里补上子目录。
   * 拿不到文件或宿主没提供这个方法时返回空串，面板退回原来的绝对路径口径。
   */
  markdownLinkFor(path, subpath) {
    try {
      const rel = String(path || "").replace(/^\/+/, "");
      if (rel === "") return "";
      const runtime2 = getRuntime();
      const sub = String(runtime2.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, "");
      const inVault = sub === "" || rel.startsWith(sub + "/") ? rel : `${sub}/${rel}`;
      const file = this.app.vault.getAbstractFileByPath(inVault);
      if (!file) return "";
      const manager = this.app.fileManager;
      if (!manager || typeof manager.generateMarkdownLink !== "function") return "";
      const link = manager.generateMarkdownLink(file, "", typeof subpath === "string" ? subpath : "");
      return typeof link === "string" ? link : "";
    } catch {
      return "";
    }
  }
  /**
   * 附件的地址交给宿主。
   *
   * 面板里 `<img>` / `<audio>` 的 src 原来是本地服务的
   * `/getnote/asset?path=...&t=令牌`：端口会变、令牌每次启动都换，而且每张图都要
   * 绕一圈本机 HTTP。`adapter.getResourcePath()` 给的是宿主资源协议下的地址，
   * 浏览器直接能加载，也能吃到宿主的缓存与 Range 处理（录音拖进度条要靠它）。
   *
   * 面板传进来的是「相对笔记目录」的路径，宿主只认库内相对路径，这里补子目录。
   * 拿不到（旧版宿主没这个方法、文件还没进索引）返回空串，面板退回本地服务地址。
   */
  assetUrlFor(path) {
    try {
      const raw = String(path || "").replace(/\\/g, "/").replace(/^\/+/, "");
      if (raw === "") return "";
      const runtime2 = getRuntime();
      const sub = String(runtime2.subfolder || DEFAULT_SUBFOLDER).replace(/^\/+|\/+$/g, "");
      const inVault = sub === "" || raw.startsWith(sub + "/") ? raw : `${sub}/${raw}`;
      const adapter2 = this.app.vault.adapter;
      if (!adapter2 || typeof adapter2.getResourcePath !== "function") return "";
      const url = adapter2.getResourcePath(inVault);
      return typeof url === "string" ? url : "";
    } catch {
      return "";
    }
  }
  /**
   * 用宿主的 metadataCache 回答「谁引用了这篇」与「这篇引用了谁」。
   *
   * 只读宿主的索引，不碰磁盘：resolvedLinks 是 Obsidian 维护的
   * 「源文件 → 目标文件 → 次数」表，getFileCache 给的是单篇的 links/embeds。
   * 两者都可能还没收录刚写下的文件，所以拿不到就返回 null，由面板退回自己的扫描。
   *
   * 返回形状要和面板里那份本地扫描一致（hits 里每项带 path/title/links），
   * 否则界面上一半有标题一半没有，看着像坏了。
   */
  vaultGraphOf(path, kind) {
    try {
      const rel = String(path || "").replace(/^\/+/, "");
      if (rel === "") return null;
      const file = this.app.vault.getAbstractFileByPath(rel);
      if (!file) return null;
      const cache = this.app.metadataCache;
      if (!cache) return null;
      const titleOf2 = (p3) => String(p3).split("/").pop().replace(/\.md$/i, "");
      if (kind === "backlinks") {
        const hits = [];
        if (typeof cache.getBacklinksForFile === "function") {
          const result = cache.getBacklinksForFile(file);
          const data = result && result.data ? result.data : null;
          if (data && typeof data.forEach === "function") {
            data.forEach((count, sourcePath) => {
              const times = Number(count);
              hits.push({
                path: sourcePath,
                title: titleOf2(sourcePath),
                date: "",
                links: [rel],
                count: Number.isFinite(times) && times > 0 ? times : 1
              });
            });
          }
        } else if (cache.resolvedLinks && typeof cache.resolvedLinks === "object") {
          for (const sourcePath of Object.keys(cache.resolvedLinks)) {
            if (sourcePath === rel) continue;
            const targets = cache.resolvedLinks[sourcePath];
            if (!targets || targets[rel] === void 0) continue;
            hits.push({ path: sourcePath, title: titleOf2(sourcePath), date: "", links: [rel], count: 1 });
          }
        }
        if (hits.length === 0) {
          const mtime = Number(file.stat && file.stat.mtime) || 0;
          if (mtime > 0 && Date.now() - mtime < FRESH_INDEX_MS) return null;
        }
        hits.sort((a3, b3) => (Number(b3.count) || 1) - (Number(a3.count) || 1) || a3.title.localeCompare(b3.title, "zh"));
        return { target: rel, hits, host: true };
      }
      if (kind === "links") {
        const info = typeof cache.getFileCache === "function" ? cache.getFileCache(file) : null;
        if (!info) return null;
        const links = [];
        for (const item of [...info.links || [], ...info.embeds || []]) {
          const link = item && item.link ? String(item.link) : "";
          if (link !== "" && !links.includes(link)) links.push(link);
        }
        return { target: rel, links, host: true };
      }
      return null;
    } catch {
      return null;
    }
  }
  /**
   * 反链的「上下文」在宿主这条路补上。
   *
   * vaultGraphOf 只读 metadataCache，拿得到「谁引用了我」「引了几次」，拿不到
   * 引用那一行剩下的字——宿主的索引存的是链接位置，不是上下文。于是面板接上
   * 宿主时反链底下空着一行，同一篇笔记接不接宿主长得不一样。
   *
   * 这里把那一行补回来：只读**引用了这篇的那几篇**的正文，不是全库。挑行用的是
   * vault.js 里同一个函数（backlinkSnippets），判定口径与面板本地扫描一致，
   * 所以不会出现「本地三条、接上宿主两条」。
   *
   * 命中特别多的笔记（被几十篇引用）只给前几十条补上下文：再多就是为了一屏之外
   * 的条目把磁盘读穿，而用户根本还没滚到那儿。
   */
  async vaultGraphWithSnippets(path, kind) {
    const base = this.vaultGraphOf(path, kind);
    if (base === null) return null;
    if (kind !== "backlinks") return base;
    if (!Array.isArray(base.hits) || base.hits.length === 0) return base;
    const rel = String(path || "").replace(/^\/+/, "");
    if (rel === "") return base;
    const runtime2 = getRuntime();
    const basePath2 = String(runtime2.vaultBase || "");
    if (basePath2 === "") return base;
    const names = linkNamesOf({ path: rel, title: rel.split("/").pop().replace(/\.md$/i, "") });
    try {
      const own = await readFile2((0, import_node_path7.join)(basePath2, rel), "utf8");
      const head = parseFrontmatter(own).data || {};
      const aliases = head.aliases !== void 0 ? head.aliases : head.alias !== void 0 ? head.alias : head["\u522B\u540D"];
      for (const alias of normalizeAliases(aliases)) names.push(alias);
    } catch {
    }
    const wanted = new Set(names.map((name) => String(name).toLowerCase()));
    const budget = 40;
    await Promise.all(
      base.hits.slice(0, budget).map(async (hit) => {
        try {
          const text = await readFile2((0, import_node_path7.join)(basePath2, hit.path), "utf8");
          hit.snippets = backlinkSnippets(text, wanted, 3);
        } catch {
          hit.snippets = [];
        }
      })
    );
    return base;
  }
  async saveLocalPort(port) {
    await updateSettings({ localPort: port });
  }
};
var GetnoteSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "\u5F97\u5230\u5927\u8111" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "\u7B14\u8BB0\u843D\u5728\u5E93\u5185\u7684\u4E00\u4E2A\u5B50\u76EE\u5F55\u91CC\uFF0C\u9ED8\u8BA4\u300C\u5F97\u5230\u5927\u8111\u300D\u3002\u9762\u677F\u91CC\u80FD\u6539\u7684\u5176\u5B83\u8BBE\u7F6E\uFF08\u4E3B\u9898\u8272\u3001\u8BED\u8A00\u3001\u81EA\u52A8\u540C\u6B65\u95F4\u9694\u3001\u4E91\u7AEF\u63A5\u5165\uFF09\u90FD\u4F1A\u5B58\u5230\u63D2\u4EF6\u81EA\u5DF1\u7684\u8BBE\u7F6E\u6587\u4EF6\u91CC\u3002"
    });
    new import_obsidian2.Setting(containerEl).setName("\u7B14\u8BB0\u5B50\u76EE\u5F55").setDesc("\u76F8\u5BF9\u5E93\u6839\u7684\u5B50\u76EE\u5F55\u540D\u3002\u6539\u540D\u540E\u5DF2\u6709\u7684\u7B14\u8BB0\u4E0D\u4F1A\u88AB\u79FB\u52A8\uFF0C\u63D2\u4EF6\u4F1A\u8BFB\u65B0\u76EE\u5F55\u3002").addText((text) => {
      text.setPlaceholder(DEFAULT_SUBFOLDER).setValue(getRuntime().subfolder).onChange(async (value) => {
        const trimmed = value.trim();
        if (trimmed === "") return;
        try {
          await setVaultRoot(trimmed);
          new import_obsidian2.Notice(`\u5F97\u5230\u5927\u8111\uFF1A\u7B14\u8BB0\u76EE\u5F55\u5DF2\u6539\u4E3A\u300C${trimmed}\u300D`);
        } catch (error2) {
          new import_obsidian2.Notice(`\u5F97\u5230\u5927\u8111\uFF1A${error2 && error2.message ? error2.message : error2}`);
        }
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\u672C\u5730\u670D\u52A1").setDesc(
      this.plugin.localPort ? `\u8FD0\u884C\u4E2D\uFF1Ahttp://127.0.0.1:${this.plugin.localPort}${this.plugin.portFallback ? "\uFF08\u4F60\u6307\u5B9A\u7684\u7AEF\u53E3\u88AB\u5360\u7528\uFF0C\u8FD9\u6B21\u7528\u4E86\u7CFB\u7EDF\u5206\u914D\u7684\uFF1B\u4E91\u7AEF\u6388\u6743\u53EF\u80FD\u9700\u8981\u91CD\u65B0\u767B\u5F55\u4E00\u6B21\uFF09" : ""}` : "\u672A\u8FD0\u884C\u3002\u91CD\u542F Obsidian \u6216\u770B\u63A7\u5236\u53F0\u91CC\u7684\u62A5\u9519\u3002"
    );
    new import_obsidian2.Setting(containerEl).setName("\u5F55\u97F3\u5361\u63D2\u4E0A\u5C31\u5BFC").setDesc(
      "\u6BCF 5 \u5206\u949F\u8FDE\u4E00\u6B21\u5F55\u97F3\u5361\uFF0C\u53D1\u73B0\u8FD8\u6CA1\u5BFC\u8FC7\u7684\u5F55\u97F3\u5C31\u81EA\u52A8\u5BFC\u8FDB\u300C\u5F55\u97F3\u5361\u300D\u76EE\u5F55\u3002\u5361\u7247\u4E0D\u5728\u9644\u8FD1\u65F6\u8FD9\u6B21\u5C1D\u8BD5\u4F1A\u5B89\u9759\u5931\u8D25\uFF0C\u4E0D\u5F71\u54CD\u522B\u7684\u4E8B\uFF1B\u6C38\u8FDC\u4E0D\u5220\u5361\u4E0A\u7684\u6587\u4EF6\u3002\u9700\u8981 Python 3.10+ \u548C bleak\u3002"
    ).addToggle((toggle) => {
      toggle.setValue(this.plugin.cardAutoImport === true).onChange(async (value) => {
        this.plugin.cardAutoImport = value === true;
        await updateSettings({ cardAutoImport: this.plugin.cardAutoImport });
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\u8DDF\u7740\u5BBF\u4E3B\u5207\u6362\u7B14\u8BB0").setDesc(
      "\u4F60\u5728 Obsidian \u91CC\u7FFB\u5230\u54EA\u4E00\u7BC7\uFF0C\u5F00\u7740\u7684\u9762\u677F\u5C31\u8DDF\u7740\u6253\u5F00\u540C\u4E00\u7BC7\uFF08\u53CD\u94FE\u3001\u540C\u6B65\u72B6\u6001\u3001\u5386\u53F2\u7248\u672C\u7ACB\u523B\u8DDF\u4E0A\uFF09\u3002\u9762\u677F\u6CA1\u5F00\u7740\u65F6\u4E0D\u4F1A\u66FF\u4F60\u6253\u5F00\u5B83\uFF1B\u4E0D\u5728\u300C\u5F97\u5230\u5927\u8111\u300D\u76EE\u5F55\u91CC\u7684\u7B14\u8BB0\u4E5F\u4E0D\u4F1A\u8DDF\u3002"
    ).addToggle((toggle) => {
      toggle.setValue(this.plugin.followActive === true).onChange(async (value) => {
        this.plugin.followActive = value === true;
        await updateSettings({ followActive: this.plugin.followActive });
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\u8BE6\u7EC6\u65E5\u5FD7").setDesc("\u628A\u9762\u677F\u4E0E\u540C\u6B65\u7684\u6BCF\u4E00\u6B65\u6253\u8FDB\u5F00\u53D1\u8005\u63A7\u5236\u53F0\uFF08Ctrl+Shift+I\uFF09\u3002\u6392\u67E5\u95EE\u9898\u65F6\u6253\u5F00\uFF0C\u5E73\u65F6\u5173\u7740\u2014\u2014\u63A7\u5236\u53F0\u91CC\u6324\u7740\u51E0\u5341\u4E2A\u63D2\u4EF6\uFF0C\u5237\u5C4F\u7684\u8F93\u51FA\u53CD\u800C\u6CA1\u4EBA\u770B\u3002").addToggle((toggle) => {
      toggle.setValue(this.plugin.debugLogging === true).onChange(async (value) => {
        this.plugin.debugLogging = value === true;
        setDebugLogging(this.plugin.debugLogging);
        await updateSettings({ debugLogging: this.plugin.debugLogging });
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\u6253\u5F00\u9762\u677F").setDesc("\u4E5F\u53EF\u4EE5\u7528\u5DE6\u4FA7\u680F\u7684\u5927\u8111\u56FE\u6807\uFF0C\u6216\u547D\u4EE4\u9762\u677F\u91CC\u7684\u300C\u6253\u5F00\u5F97\u5230\u5927\u8111\u9762\u677F\u300D\u3002").addButton((button) => {
      button.setButtonText("\u6253\u5F00").setCta().onClick(() => {
        void this.plugin.activateView();
      });
    });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PanelIcon
});
