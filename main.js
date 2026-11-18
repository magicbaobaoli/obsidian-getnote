var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
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
function enoent(p) {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${p}'`), { code: "ENOENT", path: p });
}
function eexist(p) {
  return Object.assign(new Error(`EEXIST: file already exists, '${p}'`), { code: "EEXIST", path: p });
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
function wrapStat(st, p) {
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
    path: p
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

// src/core/vault.js
var vault_exports = {};
__export(vault_exports, {
  MAX_READ: () => MAX_READ,
  MAX_WRITE: () => MAX_WRITE,
  NOTE_EXT: () => NOTE_EXT,
  buildTree: () => buildTree,
  createDir: () => createDir,
  createNote: () => createNote,
  deriveDate: () => deriveDate,
  deriveTitle: () => deriveTitle,
  excerptOf: () => excerptOf,
  extractWikiLinks: () => extractWikiLinks,
  findBacklinks: () => findBacklinks,
  heatmapOf: () => heatmapOf,
  invalidateScan: () => invalidateScan,
  listAssets: () => listAssets,
  listConflicts: () => listConflicts,
  listDirs: () => listDirs,
  listTrash: () => listTrash,
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
  renameTag: () => renameTag,
  resolveConflict: () => resolveConflict,
  resolveInside: () => resolveInside,
  restoreNote: () => restoreNote,
  rewriteTags: () => rewriteTags,
  safeFilename: () => safeFilename,
  scanVault: () => scanVault,
  searchNotes: () => searchNotes,
  toPosix: () => toPosix,
  toggleTodo: () => toggleTodo,
  trashNote: () => trashNote,
  unresolveConflict: () => unresolveConflict,
  vaultStats: () => vaultStats,
  writeNote: () => writeNote
});
function toPosix(p) {
  return p.split(import_node_path3.sep).join("/");
}
function normalizeRel(input) {
  if (typeof input !== "string") return "";
  const raw = input.replace(/\\/g, "/").replace(/^\/+/, "");
  const normalized = import_node_path3.posix.normalize(raw);
  if (normalized === "." || normalized === "./") return "";
  if (normalized.startsWith("../") || normalized === "..") {
    throw Object.assign(new Error("path escapes vault root"), { status: 400 });
  }
  return normalized;
}
function resolveInside(root, rel, { create = false } = {}) {
  const normalized = normalizeRel(rel);
  const abs = normalized === "" ? (0, import_node_path3.resolve)(root) : (0, import_node_path3.resolve)(root, normalized.split("/").join(import_node_path3.sep));
  const relCheck = (0, import_node_path3.relative)((0, import_node_path3.resolve)(root), abs);
  if (relCheck.startsWith("..") || relCheck !== "" && (0, import_node_path3.resolve)(root, relCheck) !== abs) {
    throw Object.assign(new Error("path escapes vault root"), { status: 400 });
  }
  return { abs, rel: normalized, create };
}
function parseFrontmatter(text) {
  const src = typeof text === "string" ? text : "";
  if (!src.startsWith("---")) return { data: {}, body: src, raw: null };
  const lines = src.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      end = i;
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
    const m = /^([A-Za-z0-9_\u4e00-\u9fa5.-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    lastKey = m[1];
    const value = m[2].trim();
    if (value === "") {
      data[lastKey] = [];
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      data[lastKey] = value.slice(1, -1).split(",").map((s) => unquote(s.trim())).filter((s) => s !== "");
      continue;
    }
    data[lastKey] = unquote(value);
  }
  return { data, body: lines.slice(end + 1).join("\n"), raw };
}
function unquote(s) {
  const t = String(s).trim();
  if (t.length >= 2 && (t.startsWith('"') && t.endsWith('"') || t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}
function deriveTitle(body, relPath) {
  const m = /^#{1,3}\s+(.+)$/m.exec(body || "");
  if (m) return m[1].trim();
  const base = import_node_path3.posix.basename(relPath || "", NOTE_EXT);
  const stripped = base.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  return stripped || base || "\u672A\u547D\u540D";
}
function deriveDate(relPath, data, statMs) {
  const base = import_node_path3.posix.basename(relPath || "", NOTE_EXT);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(base);
  if (m) return m[1];
  for (const key of ["\u5F52\u6863", "\u65E5\u671F", "date", "created", "\u521B\u5EFA\u65F6\u95F4"]) {
    const v = data && data[key];
    const s = Array.isArray(v) ? v[0] : v;
    const dm = typeof s === "string" ? /^(\d{4}-\d{2}-\d{2})/.exec(s.trim()) : null;
    if (dm) return dm[1];
  }
  if (statMs) {
    const d = new Date(statMs);
    if (!Number.isNaN(d.getTime())) {
      const pad2 = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }
  }
  return null;
}
function excerptOf(body, limit = 140) {
  const text = String(body || "").replace(/^---[\s\S]*?\n---\s*\n?/, "").replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/[*_`>]/g, "").replace(/\s+/g, " ").trim();
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
        await walk((0, import_node_path3.join)(dir, name), relDir === "" ? name : `${relDir}/${name}`, depth + 1);
        continue;
      }
      if (!dirent2.isFile()) continue;
      if ((0, import_node_path3.extname)(name).toLowerCase() !== NOTE_EXT) continue;
      const rel = relDir === "" ? name : `${relDir}/${name}`;
      try {
        const st = await stat2((0, import_node_path3.join)(dir, name));
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
    } catch (error) {
      errors.push({ path: relDir || ".", message: String(error && error.message ? error.message : error) });
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
        await walk((0, import_node_path3.join)(dir, name), relDir === "" ? name : `${relDir}/${name}`, depth + 1);
        continue;
      }
      if (!dirent2.isFile()) continue;
      if ((0, import_node_path3.extname)(name).toLowerCase() !== NOTE_EXT) continue;
      const rel = relDir === "" ? name : `${relDir}/${name}`;
      const abs = (0, import_node_path3.join)(dir, name);
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
          tags: normalizeTags(data.tags),
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
      } catch (error) {
        errors.push({ path: rel, message: String(error && error.message ? error.message : error) });
      }
    }
  }
  await walk(root, "", 0);
  entries.sort((a, b) => {
    const da = a.date || "";
    const db = b.date || "";
    if (da !== db) return db.localeCompare(da);
    return b.mtimeMs - a.mtimeMs;
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
    let n = 0;
    for (const child of node.children) {
      if (child.kind === "file") n += 1;
      else n += countAll(child);
    }
    node.count = n;
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      if (a.kind === "dir") return a.name.localeCompare(b.name, "zh");
      const da = a.entry && a.entry.date || "";
      const db = b.entry && b.entry.date || "";
      if (da !== db) return db.localeCompare(da);
      return a.name.localeCompare(b.name, "zh");
    });
    return n;
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
    tags: normalizeTags(data.tags),
    bytes: st.size,
    mtimeMs: st.mtimeMs,
    readOnly: false
  };
}
async function listAssets(root, rel, noteId = "") {
  const { abs, rel: normalized } = resolveInside(root, rel);
  const dir = import_node_path3.posix.dirname(normalized);
  const stem = import_node_path3.posix.basename(normalized, NOTE_EXT);
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
  out.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  return out;
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
  await mkdir2((0, import_node_path3.dirname)(abs), { recursive: true });
  if (backup) {
    try {
      await copyFile2(abs, `${abs}.bak`);
    } catch {
    }
  }
  const tmp = `${abs}.${process.pid}.${(0, import_node_crypto2.randomBytes)(4).toString("hex")}.tmp`;
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
  const pad2 = (n) => String(n).padStart(2, "0");
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
    } catch (error) {
      if (error && error.status === 409) throw error;
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
  const trashDir = (0, import_node_path3.join)(root, ".trash");
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const target = (0, import_node_path3.join)(trashDir, `${stamp}__${(0, import_node_path3.basename)(abs)}`);
  await mkdir2(trashDir, { recursive: true });
  await rename2(abs, target);
  invalidateScan(root);
  return { path: normalized, trashedTo: toPosix((0, import_node_path3.relative)(root, target)) };
}
function parseTrashName(name) {
  const m = TRASH_NAME_RE.exec(String(name || ""));
  if (m === null) return { trashedAt: null, originalName: String(name || "") };
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
  const at = Date.parse(iso);
  return {
    trashedAt: Number.isNaN(at) ? null : new Date(at).toISOString(),
    originalName: m[6]
  };
}
async function listTrash(root) {
  const trashDir = (0, import_node_path3.join)(root, TRASH_DIR);
  let dirents;
  try {
    dirents = await readdir2(trashDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const items = [];
  for (const dirent2 of dirents) {
    if (!dirent2.isFile()) continue;
    if ((0, import_node_path3.extname)(dirent2.name).toLowerCase() !== NOTE_EXT) continue;
    const abs = (0, import_node_path3.join)(trashDir, dirent2.name);
    let st;
    try {
      st = await stat2(abs);
    } catch {
      continue;
    }
    const meta = parseTrashName(dirent2.name);
    items.push({
      name: dirent2.name,
      path: toPosix((0, import_node_path3.join)(TRASH_DIR, dirent2.name)),
      originalName: meta.originalName,
      title: meta.originalName.replace(/\.md$/i, "").replace(/^\d{4}-\d{2}-\d{2}-/, ""),
      trashedAt: meta.trashedAt,
      bytes: st.size,
      mtimeMs: st.mtimeMs
    });
  }
  items.sort((a, b) => {
    const ta = a.trashedAt === null ? 0 : Date.parse(a.trashedAt);
    const tb = b.trashedAt === null ? 0 : Date.parse(b.trashedAt);
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
  const meta = parseTrashName((0, import_node_path3.basename)(absTrash));
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
      const dir = import_node_path3.posix.dirname(rel);
      const stem = (0, import_node_path3.basename)(rel, (0, import_node_path3.extname)(rel));
      const ext = (0, import_node_path3.extname)(rel);
      const next = `${stem}-${counter}${ext}`;
      candidate = dir === "." || dir === "" ? next : import_node_path3.posix.join(dir, next);
    } catch (error) {
      if (error && error.status === 409) throw error;
      break;
    }
  }
  const { abs: absFinal } = resolveInside(root, candidate, { create: true });
  await mkdir2((0, import_node_path3.dirname)(absFinal), { recursive: true });
  await rename2(absTrash, absFinal);
  invalidateScan(root);
  return { path: candidate, restoredFrom: trashRel, title: meta.originalName };
}
async function purgeTrash(root, trashPath) {
  const trashDir = (0, import_node_path3.join)(root, TRASH_DIR);
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
    await rm2((0, import_node_path3.join)(trashDir, dirent2.name), { force: true });
    purged.push(toPosix((0, import_node_path3.join)(TRASH_DIR, dirent2.name)));
  }
  if (purged.length > 0) invalidateScan(root);
  return { purged };
}
function parseSearchQuery(input) {
  const raw = String(input || "").trim();
  const tags = [];
  const dirs = [];
  const terms = [];
  const re = /(?:^|\s)(tag|dir):("[^"]*"|\S+)/gi;
  let rest = raw;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const kind = m[1].toLowerCase();
    const value = m[2].replace(/^"|"$/g, "").trim();
    if (value === "") continue;
    if (kind === "tag") tags.push(value);
    else dirs.push(value);
  }
  rest = rest.replace(re, " ");
  rest = rest.replace(/(?:^|\s)#([^\s#]+)/g, (_, name) => {
    tags.push(name);
    return " ";
  });
  for (const token of rest.split(/\s+/)) {
    if (token !== "") terms.push(token);
  }
  return { raw, tags, dirs, terms };
}
async function searchNotes(root, query, { limit = 60, perFile = 3, sort = "relevance" } = {}) {
  const parsed = parseSearchQuery(query);
  if (parsed.tags.length === 0 && parsed.dirs.length === 0 && parsed.terms.length === 0) {
    return { query: parsed.raw, parsed, hits: [], scanned: 0, truncated: false };
  }
  const needles = parsed.terms.map((t) => t.toLowerCase());
  const tagNeedles = parsed.tags.map((t) => t.toLowerCase());
  const dirNeedles = parsed.dirs.map((d) => d.toLowerCase().replace(/^\.?\//, ""));
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
        await walk((0, import_node_path3.join)(dir, name), relDir === "" ? name : `${relDir}/${name}`, depth + 1);
        continue;
      }
      if (!dirent2.isFile() || (0, import_node_path3.extname)(name).toLowerCase() !== NOTE_EXT) continue;
      const rel = relDir === "" ? name : `${relDir}/${name}`;
      if (dirNeedles.length > 0) {
        const relLower = rel.toLowerCase();
        let dirOk = false;
        for (const d of dirNeedles) {
          if (relLower.startsWith(`${d}/`) || relLower.includes(`/${d}/`)) {
            dirOk = true;
            break;
          }
        }
        if (!dirOk) continue;
      }
      scanned += 1;
      let text;
      try {
        text = await readFile2((0, import_node_path3.join)(dir, name), "utf8");
      } catch {
        continue;
      }
      const { data, body } = parseFrontmatter(text);
      const fileTags = normalizeTags(data.tags).map((t) => t.toLowerCase());
      if (tagNeedles.length > 0) {
        let tagOk = true;
        for (const want of tagNeedles) {
          if (!fileTags.some((t) => t === want || t.includes(want))) {
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
      for (let i = 0; i < lines.length; i += 1) {
        const lower = lines[i].toLowerCase();
        let lineHit = false;
        for (let n = 0; n < needles.length; n += 1) {
          if (lower.includes(needles[n])) {
            lineHit = true;
            if (!seen.has(n)) seen.add(n);
          }
        }
        if (!lineHit) continue;
        matchCount += 1;
        if (matches.length < perFile) {
          matches.push({ line: i + 1, text: lines[i].trim().slice(0, 240) });
        }
      }
      const titleHit = needles.length > 0 && needles.every((n) => name.toLowerCase().includes(n));
      if (titleHit) {
        for (let n = 0; n < needles.length; n += 1) seen.add(n);
      }
      const allTermsFound = needles.length === 0 || seen.size === needles.length;
      if (!allTermsFound) continue;
      if (matches.length === 0 && !titleHit && needles.length > 0) continue;
      const title = deriveTitle(body, rel);
      hits.push({
        path: rel,
        title,
        date: deriveDate(rel, data, null),
        tags: normalizeTags(data.tags),
        matches,
        titleHit,
        matchCount
      });
    }
  }
  await walk(root, "", 0);
  if (sort !== "path") {
    hits.sort((a, b) => {
      const score = (h2) => h2.matchCount + (h2.titleHit ? 3 : 0);
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      return a.path.localeCompare(b.path, "zh");
    });
  }
  return { query: parsed.raw, parsed, hits, scanned, truncated };
}
function extractWikiLinks(text) {
  const out = /* @__PURE__ */ new Set();
  const src = String(text || "");
  const re = /\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const target = m[1].trim();
    if (target !== "") out.add(target);
  }
  return [...out];
}
async function findBacklinks(root, target, entries) {
  const raw = String(target || "").trim().replace(/\\/g, "/");
  if (raw === "") return { target: raw, hits: [] };
  const stripExt = (p) => p.replace(/\.md$/i, "");
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
  const wantedLower = new Set([...wantedPaths].map((p) => p.toLowerCase()));
  const hits = [];
  for (const entry of list) {
    if (entry.path === raw) continue;
    let text;
    try {
      text = await readFile2(resolveInside(root, entry.path).abs, "utf8");
    } catch {
      continue;
    }
    const links = extractWikiLinks(text);
    const matched = links.filter((link) => {
      const noExt = stripExt(link);
      const base = stripExt(link.split("/").pop() || link);
      return wantedLower.has(link.toLowerCase()) || wantedLower.has(noExt.toLowerCase()) || wantedLower.has(base.toLowerCase());
    });
    if (matched.length === 0) continue;
    hits.push({
      path: entry.path,
      title: entry.title,
      date: entry.date,
      links: matched
    });
  }
  hits.sort((a, b) => a.title.localeCompare(b.title, "zh"));
  return { target: raw, hits };
}
function outlineOf(body) {
  const lines = String(body || "").split(/\r?\n/);
  const items = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m === null) continue;
    const level = m[1].length;
    const text = m[2].trim();
    if (text === "") continue;
    items.push({ level, text, line: i + 1 });
  }
  return items;
}
async function readConflictState(root) {
  try {
    const text = await readFile2((0, import_node_path3.join)(root, CONFLICT_DIR, CONFLICT_STATE_FILE), "utf8");
    const data = JSON.parse(text);
    if (data === null || typeof data !== "object" || Array.isArray(data)) return {};
    return data;
  } catch {
    return {};
  }
}
async function writeConflictState(root, state) {
  const dir = (0, import_node_path3.join)(root, CONFLICT_DIR);
  await mkdir2(dir, { recursive: true });
  const target = (0, import_node_path3.join)(dir, CONFLICT_STATE_FILE);
  const tmp = `${target}.${(0, import_node_crypto2.randomBytes)(4).toString("hex")}.tmp`;
  await writeFile2(tmp, JSON.stringify(state, null, 2), "utf8");
  await rename2(tmp, target);
}
function parseConflictName(name) {
  const m = CONFLICT_NAME_RE.exec(name);
  if (m === null) return { savedAt: null, originalName: name, cloudMarked: false };
  const ms = m[5] === void 0 ? "000" : m[5];
  const cloudMarked = /__cloud-/.test(name);
  return { savedAt: `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${ms}Z`, originalName: m[6], cloudMarked };
}
async function listConflicts(root) {
  const dir = (0, import_node_path3.join)(root, CONFLICT_DIR);
  let names;
  try {
    names = await readdir2(dir);
  } catch {
    return [];
  }
  const state = await readConflictState(root);
  const items = [];
  for (const name of names) {
    if ((0, import_node_path3.extname)(name).toLowerCase() !== NOTE_EXT) continue;
    if (name.endsWith(".bak")) continue;
    let st;
    try {
      st = await stat2((0, import_node_path3.join)(dir, name));
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
      archiveIsCloud: parsed.cloudMarked === true,
      bytes: st.size,
      mtimeMs: st.mtimeMs,
      resolved: mark !== void 0 && mark !== null,
      resolvedAt: mark !== void 0 && mark !== null ? mark.at || null : null,
      keptLocal: mark !== void 0 && mark !== null ? mark.keepLocal === true : null
    });
  }
  items.sort((a, b) => {
    const av = a.savedAt || new Date(a.mtimeMs).toISOString();
    const bv = b.savedAt || new Date(b.mtimeMs).toISOString();
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
  const candidates = entries.filter((e) => {
    const name = e.path.split("/").pop() || e.path;
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
    // 这份留档里装的是哪一边：true = 云端版（文件名带 cloud- 前缀的旧留档），false = 本地版。
    // 面板和 resolveConflict 都必须按这一位决定「本地版/云端版」各自去哪，
    // 而不是假定「留档一定是本地版」——历史里两种都真实存在过。
    archiveIsCloud: parsed.cloudMarked === true,
    candidates: candidates.map((e) => ({ path: e.path, title: e.title, noteId: e.noteId || "" })),
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
  } catch (error) {
    throw Object.assign(new Error(`\u5EFA\u76EE\u5F55\u5931\u8D25\uFF1A${error && error.message ? error.message : error}`), { status: 500 });
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
  const notes = dirents.filter((d) => d.isFile() && (0, import_node_path3.extname)(d.name).toLowerCase() === NOTE_EXT);
  if (notes.length > 0) {
    throw Object.assign(new Error(`\u8FD9\u4E2A\u76EE\u5F55\u91CC\u8FD8\u6709 ${notes.length} \u7BC7\u7B14\u8BB0\uFF0C\u5148\u628A\u5B83\u4EEC\u79FB\u8D70\u518D\u5220\u76EE\u5F55`), {
      status: 409,
      notes: notes.length
    });
  }
  const subdirs = dirents.filter((d) => d.isDirectory());
  if (subdirs.length > 0) {
    throw Object.assign(new Error(`\u8FD9\u4E2A\u76EE\u5F55\u91CC\u8FD8\u6709 ${subdirs.length} \u4E2A\u5B50\u76EE\u5F55\uFF0C\u5148\u6E05\u7A7A\u518D\u5220`), {
      status: 409,
      dirs: subdirs.length
    });
  }
  try {
    await rmdir2(abs);
  } catch (error) {
    throw Object.assign(new Error(`\u5220\u76EE\u5F55\u5931\u8D25\uFF1A${error && error.message ? error.message : error}`), { status: 500 });
  }
  invalidateScan(root);
  return { ok: true, path: rel };
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
      const next = current.filter((t) => t !== tag);
      const text = note.content;
      const actual = readTags(text);
      const base = actual.length > 0 ? actual : current;
      const updated = rewriteTags(text, base.filter((t) => t !== tag));
      if (updated === text) continue;
      if (snapshot) {
        try {
          await snapshot(entry.path);
        } catch {
        }
      }
      await writeNote(root, entry.path, updated, { backup: snapshot === null });
      changed += 1;
    } catch (error) {
      failed.push({ path: entry.path, error: error && error.message ? error.message : String(error) });
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
      const base = actual.length > 0 ? actual : current;
      const next = [];
      for (const tag of base) {
        const value = tag === from ? to : tag;
        if (!next.includes(value)) next.push(value);
      }
      const updated = rewriteTags(text, next);
      if (updated === text) continue;
      if (snapshot) {
        try {
          await snapshot(entry.path);
        } catch {
        }
      }
      await writeNote(root, entry.path, updated, { backup: snapshot === null });
      changed += 1;
    } catch (error) {
      failed.push({ path: entry.path, error: error && error.message ? error.message : String(error) });
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
  const pad2 = (n) => String(n).padStart(2, "0");
  const key = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const end = new Date(base.getTime());
  end.setDate(end.getDate() + (6 - end.getDay()));
  const days = [];
  let total = 0;
  let best = 0;
  for (let i = span * 7 - 1; i >= 0; i -= 1) {
    const d = new Date(end.getTime());
    d.setDate(d.getDate() - i);
    const date = key(d);
    const count = counts.get(date) || 0;
    days.push({ date, count, future: d.getTime() > base.getTime() });
    if (count > 0 && d.getTime() <= base.getTime()) {
      total += count;
      if (count > best) best = count;
    }
  }
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    const day = days[i];
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
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === "---") {
        fmEnd = i + 1;
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
  for (let i = fmEnd; i < lines.length; i += 1) {
    const line = lines[i];
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
      targetLine = i;
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
function normalizeTags(value) {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter((tag) => tag !== "");
  if (value === void 0 || value === null) return [];
  const single = String(value).trim();
  return single === "" ? [] : [single];
}
async function vaultStats(root, entries) {
  let bytes = 0;
  const dirs = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    bytes += entry.bytes || 0;
    const d = import_node_path3.posix.dirname(entry.path);
    if (d !== "." && d !== "") dirs.add(d);
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
  return [...dirs].sort((a, b) => a.localeCompare(b, "zh"));
}
var import_node_crypto2, import_node_path3, NOTE_EXT, MAX_READ, MAX_WRITE, MAX_SCAN, MAX_DEPTH, IGNORED_DIRS, scanCache, SCAN_CACHE_MAX, entryMemo, ENTRY_MEMO_MAX, TRASH_DIR, TRASH_NAME_RE, CONFLICT_DIR, CONFLICT_NAME_RE, CONFLICT_STATE_FILE;
var init_vault = __esm({
  "src/core/vault.js"() {
    init_vfs();
    import_node_crypto2 = require("node:crypto");
    import_node_path3 = require("node:path");
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
    CONFLICT_NAME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z?__(?:cloud-)?(.+)$/;
    CONFLICT_STATE_FILE = ".resolved.json";
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
    forEach(fn) {
      for (const [key, value] of store) fn(value, key);
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
      const error = new Error(`\u8FDE\u4E0D\u4E0A ${target.hostname}\uFF08${cause && cause.message ? cause.message : "\u7F51\u7EDC\u9519\u8BEF"}\uFF09`);
      error.status = 502;
      error.cause = cause;
      reject(error);
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
  const error = new Error(`${what} \u5931\u8D25\uFF08HTTP ${status}\uFF09${snippet ? `\uFF1A${snippet}` : ""}`);
  error.status = status;
  return error;
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
        const h2 = {
          authorization: `Bearer ${this.accessToken}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream"
        };
        if (this.sessionId) h2["mcp-session-id"] = this.sessionId;
        return h2;
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
        const textPart = parts.find((p) => p && p.type === "text" && typeof p.text === "string");
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

// node_modules/react/cjs/react.production.min.js
var require_react_production_min = __commonJS({
  "node_modules/react/cjs/react.production.min.js"(exports2) {
    "use strict";
    var l = Symbol.for("react.element");
    var n = Symbol.for("react.portal");
    var p = Symbol.for("react.fragment");
    var q = Symbol.for("react.strict_mode");
    var r = Symbol.for("react.profiler");
    var t = Symbol.for("react.provider");
    var u = Symbol.for("react.context");
    var v = Symbol.for("react.forward_ref");
    var w = Symbol.for("react.suspense");
    var x = Symbol.for("react.memo");
    var y = Symbol.for("react.lazy");
    var z = Symbol.iterator;
    function A(a) {
      if (null === a || "object" !== typeof a) return null;
      a = z && a[z] || a["@@iterator"];
      return "function" === typeof a ? a : null;
    }
    var B = { isMounted: function() {
      return false;
    }, enqueueForceUpdate: function() {
    }, enqueueReplaceState: function() {
    }, enqueueSetState: function() {
    } };
    var C = Object.assign;
    var D = {};
    function E(a, b, e) {
      this.props = a;
      this.context = b;
      this.refs = D;
      this.updater = e || B;
    }
    E.prototype.isReactComponent = {};
    E.prototype.setState = function(a, b) {
      if ("object" !== typeof a && "function" !== typeof a && null != a) throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");
      this.updater.enqueueSetState(this, a, b, "setState");
    };
    E.prototype.forceUpdate = function(a) {
      this.updater.enqueueForceUpdate(this, a, "forceUpdate");
    };
    function F() {
    }
    F.prototype = E.prototype;
    function G(a, b, e) {
      this.props = a;
      this.context = b;
      this.refs = D;
      this.updater = e || B;
    }
    var H = G.prototype = new F();
    H.constructor = G;
    C(H, E.prototype);
    H.isPureReactComponent = true;
    var I = Array.isArray;
    var J = Object.prototype.hasOwnProperty;
    var K = { current: null };
    var L = { key: true, ref: true, __self: true, __source: true };
    function M(a, b, e) {
      var d, c = {}, k = null, h2 = null;
      if (null != b) for (d in void 0 !== b.ref && (h2 = b.ref), void 0 !== b.key && (k = "" + b.key), b) J.call(b, d) && !L.hasOwnProperty(d) && (c[d] = b[d]);
      var g = arguments.length - 2;
      if (1 === g) c.children = e;
      else if (1 < g) {
        for (var f = Array(g), m = 0; m < g; m++) f[m] = arguments[m + 2];
        c.children = f;
      }
      if (a && a.defaultProps) for (d in g = a.defaultProps, g) void 0 === c[d] && (c[d] = g[d]);
      return { $$typeof: l, type: a, key: k, ref: h2, props: c, _owner: K.current };
    }
    function N(a, b) {
      return { $$typeof: l, type: a.type, key: b, ref: a.ref, props: a.props, _owner: a._owner };
    }
    function O(a) {
      return "object" === typeof a && null !== a && a.$$typeof === l;
    }
    function escape(a) {
      var b = { "=": "=0", ":": "=2" };
      return "$" + a.replace(/[=:]/g, function(a2) {
        return b[a2];
      });
    }
    var P = /\/+/g;
    function Q(a, b) {
      return "object" === typeof a && null !== a && null != a.key ? escape("" + a.key) : b.toString(36);
    }
    function R(a, b, e, d, c) {
      var k = typeof a;
      if ("undefined" === k || "boolean" === k) a = null;
      var h2 = false;
      if (null === a) h2 = true;
      else switch (k) {
        case "string":
        case "number":
          h2 = true;
          break;
        case "object":
          switch (a.$$typeof) {
            case l:
            case n:
              h2 = true;
          }
      }
      if (h2) return h2 = a, c = c(h2), a = "" === d ? "." + Q(h2, 0) : d, I(c) ? (e = "", null != a && (e = a.replace(P, "$&/") + "/"), R(c, b, e, "", function(a2) {
        return a2;
      })) : null != c && (O(c) && (c = N(c, e + (!c.key || h2 && h2.key === c.key ? "" : ("" + c.key).replace(P, "$&/") + "/") + a)), b.push(c)), 1;
      h2 = 0;
      d = "" === d ? "." : d + ":";
      if (I(a)) for (var g = 0; g < a.length; g++) {
        k = a[g];
        var f = d + Q(k, g);
        h2 += R(k, b, e, f, c);
      }
      else if (f = A(a), "function" === typeof f) for (a = f.call(a), g = 0; !(k = a.next()).done; ) k = k.value, f = d + Q(k, g++), h2 += R(k, b, e, f, c);
      else if ("object" === k) throw b = String(a), Error("Objects are not valid as a React child (found: " + ("[object Object]" === b ? "object with keys {" + Object.keys(a).join(", ") + "}" : b) + "). If you meant to render a collection of children, use an array instead.");
      return h2;
    }
    function S(a, b, e) {
      if (null == a) return a;
      var d = [], c = 0;
      R(a, d, "", "", function(a2) {
        return b.call(e, a2, c++);
      });
      return d;
    }
    function T(a) {
      if (-1 === a._status) {
        var b = a._result;
        b = b();
        b.then(function(b2) {
          if (0 === a._status || -1 === a._status) a._status = 1, a._result = b2;
        }, function(b2) {
          if (0 === a._status || -1 === a._status) a._status = 2, a._result = b2;
        });
        -1 === a._status && (a._status = 0, a._result = b);
      }
      if (1 === a._status) return a._result.default;
      throw a._result;
    }
    var U = { current: null };
    var V = { transition: null };
    var W = { ReactCurrentDispatcher: U, ReactCurrentBatchConfig: V, ReactCurrentOwner: K };
    function X() {
      throw Error("act(...) is not supported in production builds of React.");
    }
    exports2.Children = { map: S, forEach: function(a, b, e) {
      S(a, function() {
        b.apply(this, arguments);
      }, e);
    }, count: function(a) {
      var b = 0;
      S(a, function() {
        b++;
      });
      return b;
    }, toArray: function(a) {
      return S(a, function(a2) {
        return a2;
      }) || [];
    }, only: function(a) {
      if (!O(a)) throw Error("React.Children.only expected to receive a single React element child.");
      return a;
    } };
    exports2.Component = E;
    exports2.Fragment = p;
    exports2.Profiler = r;
    exports2.PureComponent = G;
    exports2.StrictMode = q;
    exports2.Suspense = w;
    exports2.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = W;
    exports2.act = X;
    exports2.cloneElement = function(a, b, e) {
      if (null === a || void 0 === a) throw Error("React.cloneElement(...): The argument must be a React element, but you passed " + a + ".");
      var d = C({}, a.props), c = a.key, k = a.ref, h2 = a._owner;
      if (null != b) {
        void 0 !== b.ref && (k = b.ref, h2 = K.current);
        void 0 !== b.key && (c = "" + b.key);
        if (a.type && a.type.defaultProps) var g = a.type.defaultProps;
        for (f in b) J.call(b, f) && !L.hasOwnProperty(f) && (d[f] = void 0 === b[f] && void 0 !== g ? g[f] : b[f]);
      }
      var f = arguments.length - 2;
      if (1 === f) d.children = e;
      else if (1 < f) {
        g = Array(f);
        for (var m = 0; m < f; m++) g[m] = arguments[m + 2];
        d.children = g;
      }
      return { $$typeof: l, type: a.type, key: c, ref: k, props: d, _owner: h2 };
    };
    exports2.createContext = function(a) {
      a = { $$typeof: u, _currentValue: a, _currentValue2: a, _threadCount: 0, Provider: null, Consumer: null, _defaultValue: null, _globalName: null };
      a.Provider = { $$typeof: t, _context: a };
      return a.Consumer = a;
    };
    exports2.createElement = M;
    exports2.createFactory = function(a) {
      var b = M.bind(null, a);
      b.type = a;
      return b;
    };
    exports2.createRef = function() {
      return { current: null };
    };
    exports2.forwardRef = function(a) {
      return { $$typeof: v, render: a };
    };
    exports2.isValidElement = O;
    exports2.lazy = function(a) {
      return { $$typeof: y, _payload: { _status: -1, _result: a }, _init: T };
    };
    exports2.memo = function(a, b) {
      return { $$typeof: x, type: a, compare: void 0 === b ? null : b };
    };
    exports2.startTransition = function(a) {
      var b = V.transition;
      V.transition = {};
      try {
        a();
      } finally {
        V.transition = b;
      }
    };
    exports2.unstable_act = X;
    exports2.useCallback = function(a, b) {
      return U.current.useCallback(a, b);
    };
    exports2.useContext = function(a) {
      return U.current.useContext(a);
    };
    exports2.useDebugValue = function() {
    };
    exports2.useDeferredValue = function(a) {
      return U.current.useDeferredValue(a);
    };
    exports2.useEffect = function(a, b) {
      return U.current.useEffect(a, b);
    };
    exports2.useId = function() {
      return U.current.useId();
    };
    exports2.useImperativeHandle = function(a, b, e) {
      return U.current.useImperativeHandle(a, b, e);
    };
    exports2.useInsertionEffect = function(a, b) {
      return U.current.useInsertionEffect(a, b);
    };
    exports2.useLayoutEffect = function(a, b) {
      return U.current.useLayoutEffect(a, b);
    };
    exports2.useMemo = function(a, b) {
      return U.current.useMemo(a, b);
    };
    exports2.useReducer = function(a, b, e) {
      return U.current.useReducer(a, b, e);
    };
    exports2.useRef = function(a) {
      return U.current.useRef(a);
    };
    exports2.useState = function(a) {
      return U.current.useState(a);
    };
    exports2.useSyncExternalStore = function(a, b, e) {
      return U.current.useSyncExternalStore(a, b, e);
    };
    exports2.useTransition = function() {
      return U.current.useTransition();
    };
    exports2.version = "18.3.1";
  }
});

// node_modules/react/index.js
var require_react = __commonJS({
  "node_modules/react/index.js"(exports2, module2) {
    "use strict";
    if (true) {
      module2.exports = require_react_production_min();
    } else {
      module2.exports = null;
    }
  }
});

// node_modules/scheduler/cjs/scheduler.production.min.js
var require_scheduler_production_min = __commonJS({
  "node_modules/scheduler/cjs/scheduler.production.min.js"(exports2) {
    "use strict";
    function f(a, b) {
      var c = a.length;
      a.push(b);
      a: for (; 0 < c; ) {
        var d = c - 1 >>> 1, e = a[d];
        if (0 < g(e, b)) a[d] = b, a[c] = e, c = d;
        else break a;
      }
    }
    function h2(a) {
      return 0 === a.length ? null : a[0];
    }
    function k(a) {
      if (0 === a.length) return null;
      var b = a[0], c = a.pop();
      if (c !== b) {
        a[0] = c;
        a: for (var d = 0, e = a.length, w = e >>> 1; d < w; ) {
          var m = 2 * (d + 1) - 1, C = a[m], n = m + 1, x = a[n];
          if (0 > g(C, c)) n < e && 0 > g(x, C) ? (a[d] = x, a[n] = c, d = n) : (a[d] = C, a[m] = c, d = m);
          else if (n < e && 0 > g(x, c)) a[d] = x, a[n] = c, d = n;
          else break a;
        }
      }
      return b;
    }
    function g(a, b) {
      var c = a.sortIndex - b.sortIndex;
      return 0 !== c ? c : a.id - b.id;
    }
    if ("object" === typeof performance && "function" === typeof performance.now) {
      l = performance;
      exports2.unstable_now = function() {
        return l.now();
      };
    } else {
      p = Date, q = p.now();
      exports2.unstable_now = function() {
        return p.now() - q;
      };
    }
    var l;
    var p;
    var q;
    var r = [];
    var t = [];
    var u = 1;
    var v = null;
    var y = 3;
    var z = false;
    var A = false;
    var B = false;
    var D = "function" === typeof setTimeout ? setTimeout : null;
    var E = "function" === typeof clearTimeout ? clearTimeout : null;
    var F = "undefined" !== typeof setImmediate ? setImmediate : null;
    "undefined" !== typeof navigator && void 0 !== navigator.scheduling && void 0 !== navigator.scheduling.isInputPending && navigator.scheduling.isInputPending.bind(navigator.scheduling);
    function G(a) {
      for (var b = h2(t); null !== b; ) {
        if (null === b.callback) k(t);
        else if (b.startTime <= a) k(t), b.sortIndex = b.expirationTime, f(r, b);
        else break;
        b = h2(t);
      }
    }
    function H(a) {
      B = false;
      G(a);
      if (!A) if (null !== h2(r)) A = true, I(J);
      else {
        var b = h2(t);
        null !== b && K(H, b.startTime - a);
      }
    }
    function J(a, b) {
      A = false;
      B && (B = false, E(L), L = -1);
      z = true;
      var c = y;
      try {
        G(b);
        for (v = h2(r); null !== v && (!(v.expirationTime > b) || a && !M()); ) {
          var d = v.callback;
          if ("function" === typeof d) {
            v.callback = null;
            y = v.priorityLevel;
            var e = d(v.expirationTime <= b);
            b = exports2.unstable_now();
            "function" === typeof e ? v.callback = e : v === h2(r) && k(r);
            G(b);
          } else k(r);
          v = h2(r);
        }
        if (null !== v) var w = true;
        else {
          var m = h2(t);
          null !== m && K(H, m.startTime - b);
          w = false;
        }
        return w;
      } finally {
        v = null, y = c, z = false;
      }
    }
    var N = false;
    var O = null;
    var L = -1;
    var P = 5;
    var Q = -1;
    function M() {
      return exports2.unstable_now() - Q < P ? false : true;
    }
    function R() {
      if (null !== O) {
        var a = exports2.unstable_now();
        Q = a;
        var b = true;
        try {
          b = O(true, a);
        } finally {
          b ? S() : (N = false, O = null);
        }
      } else N = false;
    }
    var S;
    if ("function" === typeof F) S = function() {
      F(R);
    };
    else if ("undefined" !== typeof MessageChannel) {
      T = new MessageChannel(), U = T.port2;
      T.port1.onmessage = R;
      S = function() {
        U.postMessage(null);
      };
    } else S = function() {
      D(R, 0);
    };
    var T;
    var U;
    function I(a) {
      O = a;
      N || (N = true, S());
    }
    function K(a, b) {
      L = D(function() {
        a(exports2.unstable_now());
      }, b);
    }
    exports2.unstable_IdlePriority = 5;
    exports2.unstable_ImmediatePriority = 1;
    exports2.unstable_LowPriority = 4;
    exports2.unstable_NormalPriority = 3;
    exports2.unstable_Profiling = null;
    exports2.unstable_UserBlockingPriority = 2;
    exports2.unstable_cancelCallback = function(a) {
      a.callback = null;
    };
    exports2.unstable_continueExecution = function() {
      A || z || (A = true, I(J));
    };
    exports2.unstable_forceFrameRate = function(a) {
      0 > a || 125 < a ? console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported") : P = 0 < a ? Math.floor(1e3 / a) : 5;
    };
    exports2.unstable_getCurrentPriorityLevel = function() {
      return y;
    };
    exports2.unstable_getFirstCallbackNode = function() {
      return h2(r);
    };
    exports2.unstable_next = function(a) {
      switch (y) {
        case 1:
        case 2:
        case 3:
          var b = 3;
          break;
        default:
          b = y;
      }
      var c = y;
      y = b;
      try {
        return a();
      } finally {
        y = c;
      }
    };
    exports2.unstable_pauseExecution = function() {
    };
    exports2.unstable_requestPaint = function() {
    };
    exports2.unstable_runWithPriority = function(a, b) {
      switch (a) {
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
          break;
        default:
          a = 3;
      }
      var c = y;
      y = a;
      try {
        return b();
      } finally {
        y = c;
      }
    };
    exports2.unstable_scheduleCallback = function(a, b, c) {
      var d = exports2.unstable_now();
      "object" === typeof c && null !== c ? (c = c.delay, c = "number" === typeof c && 0 < c ? d + c : d) : c = d;
      switch (a) {
        case 1:
          var e = -1;
          break;
        case 2:
          e = 250;
          break;
        case 5:
          e = 1073741823;
          break;
        case 4:
          e = 1e4;
          break;
        default:
          e = 5e3;
      }
      e = c + e;
      a = { id: u++, callback: b, priorityLevel: a, startTime: c, expirationTime: e, sortIndex: -1 };
      c > d ? (a.sortIndex = c, f(t, a), null === h2(r) && a === h2(t) && (B ? (E(L), L = -1) : B = true, K(H, c - d))) : (a.sortIndex = e, f(r, a), A || z || (A = true, I(J)));
      return a;
    };
    exports2.unstable_shouldYield = M;
    exports2.unstable_wrapCallback = function(a) {
      var b = y;
      return function() {
        var c = y;
        y = b;
        try {
          return a.apply(this, arguments);
        } finally {
          y = c;
        }
      };
    };
  }
});

// node_modules/scheduler/index.js
var require_scheduler = __commonJS({
  "node_modules/scheduler/index.js"(exports2, module2) {
    "use strict";
    if (true) {
      module2.exports = require_scheduler_production_min();
    } else {
      module2.exports = null;
    }
  }
});

// node_modules/react-dom/cjs/react-dom.production.min.js
var require_react_dom_production_min = __commonJS({
  "node_modules/react-dom/cjs/react-dom.production.min.js"(exports2) {
    "use strict";
    var aa = require_react();
    var ca = require_scheduler();
    function p(a) {
      for (var b = "https://reactjs.org/docs/error-decoder.html?invariant=" + a, c = 1; c < arguments.length; c++) b += "&args[]=" + encodeURIComponent(arguments[c]);
      return "Minified React error #" + a + "; visit " + b + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
    }
    var da = /* @__PURE__ */ new Set();
    var ea = {};
    function fa(a, b) {
      ha(a, b);
      ha(a + "Capture", b);
    }
    function ha(a, b) {
      ea[a] = b;
      for (a = 0; a < b.length; a++) da.add(b[a]);
    }
    var ia = !("undefined" === typeof window || "undefined" === typeof window.document || "undefined" === typeof window.document.createElement);
    var ja = Object.prototype.hasOwnProperty;
    var ka = /^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/;
    var la = {};
    var ma = {};
    function oa(a) {
      if (ja.call(ma, a)) return true;
      if (ja.call(la, a)) return false;
      if (ka.test(a)) return ma[a] = true;
      la[a] = true;
      return false;
    }
    function pa(a, b, c, d) {
      if (null !== c && 0 === c.type) return false;
      switch (typeof b) {
        case "function":
        case "symbol":
          return true;
        case "boolean":
          if (d) return false;
          if (null !== c) return !c.acceptsBooleans;
          a = a.toLowerCase().slice(0, 5);
          return "data-" !== a && "aria-" !== a;
        default:
          return false;
      }
    }
    function qa(a, b, c, d) {
      if (null === b || "undefined" === typeof b || pa(a, b, c, d)) return true;
      if (d) return false;
      if (null !== c) switch (c.type) {
        case 3:
          return !b;
        case 4:
          return false === b;
        case 5:
          return isNaN(b);
        case 6:
          return isNaN(b) || 1 > b;
      }
      return false;
    }
    function v(a, b, c, d, e, f, g) {
      this.acceptsBooleans = 2 === b || 3 === b || 4 === b;
      this.attributeName = d;
      this.attributeNamespace = e;
      this.mustUseProperty = c;
      this.propertyName = a;
      this.type = b;
      this.sanitizeURL = f;
      this.removeEmptyString = g;
    }
    var z = {};
    "children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(a) {
      z[a] = new v(a, 0, false, a, null, false, false);
    });
    [["acceptCharset", "accept-charset"], ["className", "class"], ["htmlFor", "for"], ["httpEquiv", "http-equiv"]].forEach(function(a) {
      var b = a[0];
      z[b] = new v(b, 1, false, a[1], null, false, false);
    });
    ["contentEditable", "draggable", "spellCheck", "value"].forEach(function(a) {
      z[a] = new v(a, 2, false, a.toLowerCase(), null, false, false);
    });
    ["autoReverse", "externalResourcesRequired", "focusable", "preserveAlpha"].forEach(function(a) {
      z[a] = new v(a, 2, false, a, null, false, false);
    });
    "allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(a) {
      z[a] = new v(a, 3, false, a.toLowerCase(), null, false, false);
    });
    ["checked", "multiple", "muted", "selected"].forEach(function(a) {
      z[a] = new v(a, 3, true, a, null, false, false);
    });
    ["capture", "download"].forEach(function(a) {
      z[a] = new v(a, 4, false, a, null, false, false);
    });
    ["cols", "rows", "size", "span"].forEach(function(a) {
      z[a] = new v(a, 6, false, a, null, false, false);
    });
    ["rowSpan", "start"].forEach(function(a) {
      z[a] = new v(a, 5, false, a.toLowerCase(), null, false, false);
    });
    var ra = /[\-:]([a-z])/g;
    function sa(a) {
      return a[1].toUpperCase();
    }
    "accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(a) {
      var b = a.replace(
        ra,
        sa
      );
      z[b] = new v(b, 1, false, a, null, false, false);
    });
    "xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(a) {
      var b = a.replace(ra, sa);
      z[b] = new v(b, 1, false, a, "http://www.w3.org/1999/xlink", false, false);
    });
    ["xml:base", "xml:lang", "xml:space"].forEach(function(a) {
      var b = a.replace(ra, sa);
      z[b] = new v(b, 1, false, a, "http://www.w3.org/XML/1998/namespace", false, false);
    });
    ["tabIndex", "crossOrigin"].forEach(function(a) {
      z[a] = new v(a, 1, false, a.toLowerCase(), null, false, false);
    });
    z.xlinkHref = new v("xlinkHref", 1, false, "xlink:href", "http://www.w3.org/1999/xlink", true, false);
    ["src", "href", "action", "formAction"].forEach(function(a) {
      z[a] = new v(a, 1, false, a.toLowerCase(), null, true, true);
    });
    function ta(a, b, c, d) {
      var e = z.hasOwnProperty(b) ? z[b] : null;
      if (null !== e ? 0 !== e.type : d || !(2 < b.length) || "o" !== b[0] && "O" !== b[0] || "n" !== b[1] && "N" !== b[1]) qa(b, c, e, d) && (c = null), d || null === e ? oa(b) && (null === c ? a.removeAttribute(b) : a.setAttribute(b, "" + c)) : e.mustUseProperty ? a[e.propertyName] = null === c ? 3 === e.type ? false : "" : c : (b = e.attributeName, d = e.attributeNamespace, null === c ? a.removeAttribute(b) : (e = e.type, c = 3 === e || 4 === e && true === c ? "" : "" + c, d ? a.setAttributeNS(d, b, c) : a.setAttribute(b, c)));
    }
    var ua = aa.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    var va = Symbol.for("react.element");
    var wa = Symbol.for("react.portal");
    var ya = Symbol.for("react.fragment");
    var za = Symbol.for("react.strict_mode");
    var Aa = Symbol.for("react.profiler");
    var Ba = Symbol.for("react.provider");
    var Ca = Symbol.for("react.context");
    var Da = Symbol.for("react.forward_ref");
    var Ea = Symbol.for("react.suspense");
    var Fa = Symbol.for("react.suspense_list");
    var Ga = Symbol.for("react.memo");
    var Ha = Symbol.for("react.lazy");
    Symbol.for("react.scope");
    Symbol.for("react.debug_trace_mode");
    var Ia = Symbol.for("react.offscreen");
    Symbol.for("react.legacy_hidden");
    Symbol.for("react.cache");
    Symbol.for("react.tracing_marker");
    var Ja = Symbol.iterator;
    function Ka(a) {
      if (null === a || "object" !== typeof a) return null;
      a = Ja && a[Ja] || a["@@iterator"];
      return "function" === typeof a ? a : null;
    }
    var A = Object.assign;
    var La;
    function Ma(a) {
      if (void 0 === La) try {
        throw Error();
      } catch (c) {
        var b = c.stack.trim().match(/\n( *(at )?)/);
        La = b && b[1] || "";
      }
      return "\n" + La + a;
    }
    var Na = false;
    function Oa(a, b) {
      if (!a || Na) return "";
      Na = true;
      var c = Error.prepareStackTrace;
      Error.prepareStackTrace = void 0;
      try {
        if (b) if (b = function() {
          throw Error();
        }, Object.defineProperty(b.prototype, "props", { set: function() {
          throw Error();
        } }), "object" === typeof Reflect && Reflect.construct) {
          try {
            Reflect.construct(b, []);
          } catch (l) {
            var d = l;
          }
          Reflect.construct(a, [], b);
        } else {
          try {
            b.call();
          } catch (l) {
            d = l;
          }
          a.call(b.prototype);
        }
        else {
          try {
            throw Error();
          } catch (l) {
            d = l;
          }
          a();
        }
      } catch (l) {
        if (l && d && "string" === typeof l.stack) {
          for (var e = l.stack.split("\n"), f = d.stack.split("\n"), g = e.length - 1, h2 = f.length - 1; 1 <= g && 0 <= h2 && e[g] !== f[h2]; ) h2--;
          for (; 1 <= g && 0 <= h2; g--, h2--) if (e[g] !== f[h2]) {
            if (1 !== g || 1 !== h2) {
              do
                if (g--, h2--, 0 > h2 || e[g] !== f[h2]) {
                  var k = "\n" + e[g].replace(" at new ", " at ");
                  a.displayName && k.includes("<anonymous>") && (k = k.replace("<anonymous>", a.displayName));
                  return k;
                }
              while (1 <= g && 0 <= h2);
            }
            break;
          }
        }
      } finally {
        Na = false, Error.prepareStackTrace = c;
      }
      return (a = a ? a.displayName || a.name : "") ? Ma(a) : "";
    }
    function Pa(a) {
      switch (a.tag) {
        case 5:
          return Ma(a.type);
        case 16:
          return Ma("Lazy");
        case 13:
          return Ma("Suspense");
        case 19:
          return Ma("SuspenseList");
        case 0:
        case 2:
        case 15:
          return a = Oa(a.type, false), a;
        case 11:
          return a = Oa(a.type.render, false), a;
        case 1:
          return a = Oa(a.type, true), a;
        default:
          return "";
      }
    }
    function Qa(a) {
      if (null == a) return null;
      if ("function" === typeof a) return a.displayName || a.name || null;
      if ("string" === typeof a) return a;
      switch (a) {
        case ya:
          return "Fragment";
        case wa:
          return "Portal";
        case Aa:
          return "Profiler";
        case za:
          return "StrictMode";
        case Ea:
          return "Suspense";
        case Fa:
          return "SuspenseList";
      }
      if ("object" === typeof a) switch (a.$$typeof) {
        case Ca:
          return (a.displayName || "Context") + ".Consumer";
        case Ba:
          return (a._context.displayName || "Context") + ".Provider";
        case Da:
          var b = a.render;
          a = a.displayName;
          a || (a = b.displayName || b.name || "", a = "" !== a ? "ForwardRef(" + a + ")" : "ForwardRef");
          return a;
        case Ga:
          return b = a.displayName || null, null !== b ? b : Qa(a.type) || "Memo";
        case Ha:
          b = a._payload;
          a = a._init;
          try {
            return Qa(a(b));
          } catch (c) {
          }
      }
      return null;
    }
    function Ra(a) {
      var b = a.type;
      switch (a.tag) {
        case 24:
          return "Cache";
        case 9:
          return (b.displayName || "Context") + ".Consumer";
        case 10:
          return (b._context.displayName || "Context") + ".Provider";
        case 18:
          return "DehydratedFragment";
        case 11:
          return a = b.render, a = a.displayName || a.name || "", b.displayName || ("" !== a ? "ForwardRef(" + a + ")" : "ForwardRef");
        case 7:
          return "Fragment";
        case 5:
          return b;
        case 4:
          return "Portal";
        case 3:
          return "Root";
        case 6:
          return "Text";
        case 16:
          return Qa(b);
        case 8:
          return b === za ? "StrictMode" : "Mode";
        case 22:
          return "Offscreen";
        case 12:
          return "Profiler";
        case 21:
          return "Scope";
        case 13:
          return "Suspense";
        case 19:
          return "SuspenseList";
        case 25:
          return "TracingMarker";
        case 1:
        case 0:
        case 17:
        case 2:
        case 14:
        case 15:
          if ("function" === typeof b) return b.displayName || b.name || null;
          if ("string" === typeof b) return b;
      }
      return null;
    }
    function Sa(a) {
      switch (typeof a) {
        case "boolean":
        case "number":
        case "string":
        case "undefined":
          return a;
        case "object":
          return a;
        default:
          return "";
      }
    }
    function Ta(a) {
      var b = a.type;
      return (a = a.nodeName) && "input" === a.toLowerCase() && ("checkbox" === b || "radio" === b);
    }
    function Ua(a) {
      var b = Ta(a) ? "checked" : "value", c = Object.getOwnPropertyDescriptor(a.constructor.prototype, b), d = "" + a[b];
      if (!a.hasOwnProperty(b) && "undefined" !== typeof c && "function" === typeof c.get && "function" === typeof c.set) {
        var e = c.get, f = c.set;
        Object.defineProperty(a, b, { configurable: true, get: function() {
          return e.call(this);
        }, set: function(a2) {
          d = "" + a2;
          f.call(this, a2);
        } });
        Object.defineProperty(a, b, { enumerable: c.enumerable });
        return { getValue: function() {
          return d;
        }, setValue: function(a2) {
          d = "" + a2;
        }, stopTracking: function() {
          a._valueTracker = null;
          delete a[b];
        } };
      }
    }
    function Va(a) {
      a._valueTracker || (a._valueTracker = Ua(a));
    }
    function Wa(a) {
      if (!a) return false;
      var b = a._valueTracker;
      if (!b) return true;
      var c = b.getValue();
      var d = "";
      a && (d = Ta(a) ? a.checked ? "true" : "false" : a.value);
      a = d;
      return a !== c ? (b.setValue(a), true) : false;
    }
    function Xa(a) {
      a = a || ("undefined" !== typeof document ? document : void 0);
      if ("undefined" === typeof a) return null;
      try {
        return a.activeElement || a.body;
      } catch (b) {
        return a.body;
      }
    }
    function Ya(a, b) {
      var c = b.checked;
      return A({}, b, { defaultChecked: void 0, defaultValue: void 0, value: void 0, checked: null != c ? c : a._wrapperState.initialChecked });
    }
    function Za(a, b) {
      var c = null == b.defaultValue ? "" : b.defaultValue, d = null != b.checked ? b.checked : b.defaultChecked;
      c = Sa(null != b.value ? b.value : c);
      a._wrapperState = { initialChecked: d, initialValue: c, controlled: "checkbox" === b.type || "radio" === b.type ? null != b.checked : null != b.value };
    }
    function ab(a, b) {
      b = b.checked;
      null != b && ta(a, "checked", b, false);
    }
    function bb(a, b) {
      ab(a, b);
      var c = Sa(b.value), d = b.type;
      if (null != c) if ("number" === d) {
        if (0 === c && "" === a.value || a.value != c) a.value = "" + c;
      } else a.value !== "" + c && (a.value = "" + c);
      else if ("submit" === d || "reset" === d) {
        a.removeAttribute("value");
        return;
      }
      b.hasOwnProperty("value") ? cb(a, b.type, c) : b.hasOwnProperty("defaultValue") && cb(a, b.type, Sa(b.defaultValue));
      null == b.checked && null != b.defaultChecked && (a.defaultChecked = !!b.defaultChecked);
    }
    function db(a, b, c) {
      if (b.hasOwnProperty("value") || b.hasOwnProperty("defaultValue")) {
        var d = b.type;
        if (!("submit" !== d && "reset" !== d || void 0 !== b.value && null !== b.value)) return;
        b = "" + a._wrapperState.initialValue;
        c || b === a.value || (a.value = b);
        a.defaultValue = b;
      }
      c = a.name;
      "" !== c && (a.name = "");
      a.defaultChecked = !!a._wrapperState.initialChecked;
      "" !== c && (a.name = c);
    }
    function cb(a, b, c) {
      if ("number" !== b || Xa(a.ownerDocument) !== a) null == c ? a.defaultValue = "" + a._wrapperState.initialValue : a.defaultValue !== "" + c && (a.defaultValue = "" + c);
    }
    var eb = Array.isArray;
    function fb(a, b, c, d) {
      a = a.options;
      if (b) {
        b = {};
        for (var e = 0; e < c.length; e++) b["$" + c[e]] = true;
        for (c = 0; c < a.length; c++) e = b.hasOwnProperty("$" + a[c].value), a[c].selected !== e && (a[c].selected = e), e && d && (a[c].defaultSelected = true);
      } else {
        c = "" + Sa(c);
        b = null;
        for (e = 0; e < a.length; e++) {
          if (a[e].value === c) {
            a[e].selected = true;
            d && (a[e].defaultSelected = true);
            return;
          }
          null !== b || a[e].disabled || (b = a[e]);
        }
        null !== b && (b.selected = true);
      }
    }
    function gb(a, b) {
      if (null != b.dangerouslySetInnerHTML) throw Error(p(91));
      return A({}, b, { value: void 0, defaultValue: void 0, children: "" + a._wrapperState.initialValue });
    }
    function hb(a, b) {
      var c = b.value;
      if (null == c) {
        c = b.children;
        b = b.defaultValue;
        if (null != c) {
          if (null != b) throw Error(p(92));
          if (eb(c)) {
            if (1 < c.length) throw Error(p(93));
            c = c[0];
          }
          b = c;
        }
        null == b && (b = "");
        c = b;
      }
      a._wrapperState = { initialValue: Sa(c) };
    }
    function ib(a, b) {
      var c = Sa(b.value), d = Sa(b.defaultValue);
      null != c && (c = "" + c, c !== a.value && (a.value = c), null == b.defaultValue && a.defaultValue !== c && (a.defaultValue = c));
      null != d && (a.defaultValue = "" + d);
    }
    function jb(a) {
      var b = a.textContent;
      b === a._wrapperState.initialValue && "" !== b && null !== b && (a.value = b);
    }
    function kb(a) {
      switch (a) {
        case "svg":
          return "http://www.w3.org/2000/svg";
        case "math":
          return "http://www.w3.org/1998/Math/MathML";
        default:
          return "http://www.w3.org/1999/xhtml";
      }
    }
    function lb(a, b) {
      return null == a || "http://www.w3.org/1999/xhtml" === a ? kb(b) : "http://www.w3.org/2000/svg" === a && "foreignObject" === b ? "http://www.w3.org/1999/xhtml" : a;
    }
    var mb;
    var nb = (function(a) {
      return "undefined" !== typeof MSApp && MSApp.execUnsafeLocalFunction ? function(b, c, d, e) {
        MSApp.execUnsafeLocalFunction(function() {
          return a(b, c, d, e);
        });
      } : a;
    })(function(a, b) {
      if ("http://www.w3.org/2000/svg" !== a.namespaceURI || "innerHTML" in a) a.innerHTML = b;
      else {
        mb = mb || document.createElement("div");
        mb.innerHTML = "<svg>" + b.valueOf().toString() + "</svg>";
        for (b = mb.firstChild; a.firstChild; ) a.removeChild(a.firstChild);
        for (; b.firstChild; ) a.appendChild(b.firstChild);
      }
    });
    function ob(a, b) {
      if (b) {
        var c = a.firstChild;
        if (c && c === a.lastChild && 3 === c.nodeType) {
          c.nodeValue = b;
          return;
        }
      }
      a.textContent = b;
    }
    var pb = {
      animationIterationCount: true,
      aspectRatio: true,
      borderImageOutset: true,
      borderImageSlice: true,
      borderImageWidth: true,
      boxFlex: true,
      boxFlexGroup: true,
      boxOrdinalGroup: true,
      columnCount: true,
      columns: true,
      flex: true,
      flexGrow: true,
      flexPositive: true,
      flexShrink: true,
      flexNegative: true,
      flexOrder: true,
      gridArea: true,
      gridRow: true,
      gridRowEnd: true,
      gridRowSpan: true,
      gridRowStart: true,
      gridColumn: true,
      gridColumnEnd: true,
      gridColumnSpan: true,
      gridColumnStart: true,
      fontWeight: true,
      lineClamp: true,
      lineHeight: true,
      opacity: true,
      order: true,
      orphans: true,
      tabSize: true,
      widows: true,
      zIndex: true,
      zoom: true,
      fillOpacity: true,
      floodOpacity: true,
      stopOpacity: true,
      strokeDasharray: true,
      strokeDashoffset: true,
      strokeMiterlimit: true,
      strokeOpacity: true,
      strokeWidth: true
    };
    var qb = ["Webkit", "ms", "Moz", "O"];
    Object.keys(pb).forEach(function(a) {
      qb.forEach(function(b) {
        b = b + a.charAt(0).toUpperCase() + a.substring(1);
        pb[b] = pb[a];
      });
    });
    function rb(a, b, c) {
      return null == b || "boolean" === typeof b || "" === b ? "" : c || "number" !== typeof b || 0 === b || pb.hasOwnProperty(a) && pb[a] ? ("" + b).trim() : b + "px";
    }
    function sb(a, b) {
      a = a.style;
      for (var c in b) if (b.hasOwnProperty(c)) {
        var d = 0 === c.indexOf("--"), e = rb(c, b[c], d);
        "float" === c && (c = "cssFloat");
        d ? a.setProperty(c, e) : a[c] = e;
      }
    }
    var tb = A({ menuitem: true }, { area: true, base: true, br: true, col: true, embed: true, hr: true, img: true, input: true, keygen: true, link: true, meta: true, param: true, source: true, track: true, wbr: true });
    function ub(a, b) {
      if (b) {
        if (tb[a] && (null != b.children || null != b.dangerouslySetInnerHTML)) throw Error(p(137, a));
        if (null != b.dangerouslySetInnerHTML) {
          if (null != b.children) throw Error(p(60));
          if ("object" !== typeof b.dangerouslySetInnerHTML || !("__html" in b.dangerouslySetInnerHTML)) throw Error(p(61));
        }
        if (null != b.style && "object" !== typeof b.style) throw Error(p(62));
      }
    }
    function vb(a, b) {
      if (-1 === a.indexOf("-")) return "string" === typeof b.is;
      switch (a) {
        case "annotation-xml":
        case "color-profile":
        case "font-face":
        case "font-face-src":
        case "font-face-uri":
        case "font-face-format":
        case "font-face-name":
        case "missing-glyph":
          return false;
        default:
          return true;
      }
    }
    var wb = null;
    function xb(a) {
      a = a.target || a.srcElement || window;
      a.correspondingUseElement && (a = a.correspondingUseElement);
      return 3 === a.nodeType ? a.parentNode : a;
    }
    var yb = null;
    var zb = null;
    var Ab = null;
    function Bb(a) {
      if (a = Cb(a)) {
        if ("function" !== typeof yb) throw Error(p(280));
        var b = a.stateNode;
        b && (b = Db(b), yb(a.stateNode, a.type, b));
      }
    }
    function Eb(a) {
      zb ? Ab ? Ab.push(a) : Ab = [a] : zb = a;
    }
    function Fb() {
      if (zb) {
        var a = zb, b = Ab;
        Ab = zb = null;
        Bb(a);
        if (b) for (a = 0; a < b.length; a++) Bb(b[a]);
      }
    }
    function Gb(a, b) {
      return a(b);
    }
    function Hb() {
    }
    var Ib = false;
    function Jb(a, b, c) {
      if (Ib) return a(b, c);
      Ib = true;
      try {
        return Gb(a, b, c);
      } finally {
        if (Ib = false, null !== zb || null !== Ab) Hb(), Fb();
      }
    }
    function Kb(a, b) {
      var c = a.stateNode;
      if (null === c) return null;
      var d = Db(c);
      if (null === d) return null;
      c = d[b];
      a: switch (b) {
        case "onClick":
        case "onClickCapture":
        case "onDoubleClick":
        case "onDoubleClickCapture":
        case "onMouseDown":
        case "onMouseDownCapture":
        case "onMouseMove":
        case "onMouseMoveCapture":
        case "onMouseUp":
        case "onMouseUpCapture":
        case "onMouseEnter":
          (d = !d.disabled) || (a = a.type, d = !("button" === a || "input" === a || "select" === a || "textarea" === a));
          a = !d;
          break a;
        default:
          a = false;
      }
      if (a) return null;
      if (c && "function" !== typeof c) throw Error(p(231, b, typeof c));
      return c;
    }
    var Lb = false;
    if (ia) try {
      Mb = {};
      Object.defineProperty(Mb, "passive", { get: function() {
        Lb = true;
      } });
      window.addEventListener("test", Mb, Mb);
      window.removeEventListener("test", Mb, Mb);
    } catch (a) {
      Lb = false;
    }
    var Mb;
    function Nb(a, b, c, d, e, f, g, h2, k) {
      var l = Array.prototype.slice.call(arguments, 3);
      try {
        b.apply(c, l);
      } catch (m) {
        this.onError(m);
      }
    }
    var Ob = false;
    var Pb = null;
    var Qb = false;
    var Rb = null;
    var Sb = { onError: function(a) {
      Ob = true;
      Pb = a;
    } };
    function Tb(a, b, c, d, e, f, g, h2, k) {
      Ob = false;
      Pb = null;
      Nb.apply(Sb, arguments);
    }
    function Ub(a, b, c, d, e, f, g, h2, k) {
      Tb.apply(this, arguments);
      if (Ob) {
        if (Ob) {
          var l = Pb;
          Ob = false;
          Pb = null;
        } else throw Error(p(198));
        Qb || (Qb = true, Rb = l);
      }
    }
    function Vb(a) {
      var b = a, c = a;
      if (a.alternate) for (; b.return; ) b = b.return;
      else {
        a = b;
        do
          b = a, 0 !== (b.flags & 4098) && (c = b.return), a = b.return;
        while (a);
      }
      return 3 === b.tag ? c : null;
    }
    function Wb(a) {
      if (13 === a.tag) {
        var b = a.memoizedState;
        null === b && (a = a.alternate, null !== a && (b = a.memoizedState));
        if (null !== b) return b.dehydrated;
      }
      return null;
    }
    function Xb(a) {
      if (Vb(a) !== a) throw Error(p(188));
    }
    function Yb(a) {
      var b = a.alternate;
      if (!b) {
        b = Vb(a);
        if (null === b) throw Error(p(188));
        return b !== a ? null : a;
      }
      for (var c = a, d = b; ; ) {
        var e = c.return;
        if (null === e) break;
        var f = e.alternate;
        if (null === f) {
          d = e.return;
          if (null !== d) {
            c = d;
            continue;
          }
          break;
        }
        if (e.child === f.child) {
          for (f = e.child; f; ) {
            if (f === c) return Xb(e), a;
            if (f === d) return Xb(e), b;
            f = f.sibling;
          }
          throw Error(p(188));
        }
        if (c.return !== d.return) c = e, d = f;
        else {
          for (var g = false, h2 = e.child; h2; ) {
            if (h2 === c) {
              g = true;
              c = e;
              d = f;
              break;
            }
            if (h2 === d) {
              g = true;
              d = e;
              c = f;
              break;
            }
            h2 = h2.sibling;
          }
          if (!g) {
            for (h2 = f.child; h2; ) {
              if (h2 === c) {
                g = true;
                c = f;
                d = e;
                break;
              }
              if (h2 === d) {
                g = true;
                d = f;
                c = e;
                break;
              }
              h2 = h2.sibling;
            }
            if (!g) throw Error(p(189));
          }
        }
        if (c.alternate !== d) throw Error(p(190));
      }
      if (3 !== c.tag) throw Error(p(188));
      return c.stateNode.current === c ? a : b;
    }
    function Zb(a) {
      a = Yb(a);
      return null !== a ? $b(a) : null;
    }
    function $b(a) {
      if (5 === a.tag || 6 === a.tag) return a;
      for (a = a.child; null !== a; ) {
        var b = $b(a);
        if (null !== b) return b;
        a = a.sibling;
      }
      return null;
    }
    var ac = ca.unstable_scheduleCallback;
    var bc = ca.unstable_cancelCallback;
    var cc = ca.unstable_shouldYield;
    var dc = ca.unstable_requestPaint;
    var B = ca.unstable_now;
    var ec = ca.unstable_getCurrentPriorityLevel;
    var fc = ca.unstable_ImmediatePriority;
    var gc = ca.unstable_UserBlockingPriority;
    var hc = ca.unstable_NormalPriority;
    var ic = ca.unstable_LowPriority;
    var jc = ca.unstable_IdlePriority;
    var kc = null;
    var lc = null;
    function mc(a) {
      if (lc && "function" === typeof lc.onCommitFiberRoot) try {
        lc.onCommitFiberRoot(kc, a, void 0, 128 === (a.current.flags & 128));
      } catch (b) {
      }
    }
    var oc = Math.clz32 ? Math.clz32 : nc;
    var pc = Math.log;
    var qc = Math.LN2;
    function nc(a) {
      a >>>= 0;
      return 0 === a ? 32 : 31 - (pc(a) / qc | 0) | 0;
    }
    var rc = 64;
    var sc = 4194304;
    function tc(a) {
      switch (a & -a) {
        case 1:
          return 1;
        case 2:
          return 2;
        case 4:
          return 4;
        case 8:
          return 8;
        case 16:
          return 16;
        case 32:
          return 32;
        case 64:
        case 128:
        case 256:
        case 512:
        case 1024:
        case 2048:
        case 4096:
        case 8192:
        case 16384:
        case 32768:
        case 65536:
        case 131072:
        case 262144:
        case 524288:
        case 1048576:
        case 2097152:
          return a & 4194240;
        case 4194304:
        case 8388608:
        case 16777216:
        case 33554432:
        case 67108864:
          return a & 130023424;
        case 134217728:
          return 134217728;
        case 268435456:
          return 268435456;
        case 536870912:
          return 536870912;
        case 1073741824:
          return 1073741824;
        default:
          return a;
      }
    }
    function uc(a, b) {
      var c = a.pendingLanes;
      if (0 === c) return 0;
      var d = 0, e = a.suspendedLanes, f = a.pingedLanes, g = c & 268435455;
      if (0 !== g) {
        var h2 = g & ~e;
        0 !== h2 ? d = tc(h2) : (f &= g, 0 !== f && (d = tc(f)));
      } else g = c & ~e, 0 !== g ? d = tc(g) : 0 !== f && (d = tc(f));
      if (0 === d) return 0;
      if (0 !== b && b !== d && 0 === (b & e) && (e = d & -d, f = b & -b, e >= f || 16 === e && 0 !== (f & 4194240))) return b;
      0 !== (d & 4) && (d |= c & 16);
      b = a.entangledLanes;
      if (0 !== b) for (a = a.entanglements, b &= d; 0 < b; ) c = 31 - oc(b), e = 1 << c, d |= a[c], b &= ~e;
      return d;
    }
    function vc(a, b) {
      switch (a) {
        case 1:
        case 2:
        case 4:
          return b + 250;
        case 8:
        case 16:
        case 32:
        case 64:
        case 128:
        case 256:
        case 512:
        case 1024:
        case 2048:
        case 4096:
        case 8192:
        case 16384:
        case 32768:
        case 65536:
        case 131072:
        case 262144:
        case 524288:
        case 1048576:
        case 2097152:
          return b + 5e3;
        case 4194304:
        case 8388608:
        case 16777216:
        case 33554432:
        case 67108864:
          return -1;
        case 134217728:
        case 268435456:
        case 536870912:
        case 1073741824:
          return -1;
        default:
          return -1;
      }
    }
    function wc(a, b) {
      for (var c = a.suspendedLanes, d = a.pingedLanes, e = a.expirationTimes, f = a.pendingLanes; 0 < f; ) {
        var g = 31 - oc(f), h2 = 1 << g, k = e[g];
        if (-1 === k) {
          if (0 === (h2 & c) || 0 !== (h2 & d)) e[g] = vc(h2, b);
        } else k <= b && (a.expiredLanes |= h2);
        f &= ~h2;
      }
    }
    function xc(a) {
      a = a.pendingLanes & -1073741825;
      return 0 !== a ? a : a & 1073741824 ? 1073741824 : 0;
    }
    function yc() {
      var a = rc;
      rc <<= 1;
      0 === (rc & 4194240) && (rc = 64);
      return a;
    }
    function zc(a) {
      for (var b = [], c = 0; 31 > c; c++) b.push(a);
      return b;
    }
    function Ac(a, b, c) {
      a.pendingLanes |= b;
      536870912 !== b && (a.suspendedLanes = 0, a.pingedLanes = 0);
      a = a.eventTimes;
      b = 31 - oc(b);
      a[b] = c;
    }
    function Bc(a, b) {
      var c = a.pendingLanes & ~b;
      a.pendingLanes = b;
      a.suspendedLanes = 0;
      a.pingedLanes = 0;
      a.expiredLanes &= b;
      a.mutableReadLanes &= b;
      a.entangledLanes &= b;
      b = a.entanglements;
      var d = a.eventTimes;
      for (a = a.expirationTimes; 0 < c; ) {
        var e = 31 - oc(c), f = 1 << e;
        b[e] = 0;
        d[e] = -1;
        a[e] = -1;
        c &= ~f;
      }
    }
    function Cc(a, b) {
      var c = a.entangledLanes |= b;
      for (a = a.entanglements; c; ) {
        var d = 31 - oc(c), e = 1 << d;
        e & b | a[d] & b && (a[d] |= b);
        c &= ~e;
      }
    }
    var C = 0;
    function Dc(a) {
      a &= -a;
      return 1 < a ? 4 < a ? 0 !== (a & 268435455) ? 16 : 536870912 : 4 : 1;
    }
    var Ec;
    var Fc;
    var Gc;
    var Hc;
    var Ic;
    var Jc = false;
    var Kc = [];
    var Lc = null;
    var Mc = null;
    var Nc = null;
    var Oc = /* @__PURE__ */ new Map();
    var Pc = /* @__PURE__ */ new Map();
    var Qc = [];
    var Rc = "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");
    function Sc(a, b) {
      switch (a) {
        case "focusin":
        case "focusout":
          Lc = null;
          break;
        case "dragenter":
        case "dragleave":
          Mc = null;
          break;
        case "mouseover":
        case "mouseout":
          Nc = null;
          break;
        case "pointerover":
        case "pointerout":
          Oc.delete(b.pointerId);
          break;
        case "gotpointercapture":
        case "lostpointercapture":
          Pc.delete(b.pointerId);
      }
    }
    function Tc(a, b, c, d, e, f) {
      if (null === a || a.nativeEvent !== f) return a = { blockedOn: b, domEventName: c, eventSystemFlags: d, nativeEvent: f, targetContainers: [e] }, null !== b && (b = Cb(b), null !== b && Fc(b)), a;
      a.eventSystemFlags |= d;
      b = a.targetContainers;
      null !== e && -1 === b.indexOf(e) && b.push(e);
      return a;
    }
    function Uc(a, b, c, d, e) {
      switch (b) {
        case "focusin":
          return Lc = Tc(Lc, a, b, c, d, e), true;
        case "dragenter":
          return Mc = Tc(Mc, a, b, c, d, e), true;
        case "mouseover":
          return Nc = Tc(Nc, a, b, c, d, e), true;
        case "pointerover":
          var f = e.pointerId;
          Oc.set(f, Tc(Oc.get(f) || null, a, b, c, d, e));
          return true;
        case "gotpointercapture":
          return f = e.pointerId, Pc.set(f, Tc(Pc.get(f) || null, a, b, c, d, e)), true;
      }
      return false;
    }
    function Vc(a) {
      var b = Wc(a.target);
      if (null !== b) {
        var c = Vb(b);
        if (null !== c) {
          if (b = c.tag, 13 === b) {
            if (b = Wb(c), null !== b) {
              a.blockedOn = b;
              Ic(a.priority, function() {
                Gc(c);
              });
              return;
            }
          } else if (3 === b && c.stateNode.current.memoizedState.isDehydrated) {
            a.blockedOn = 3 === c.tag ? c.stateNode.containerInfo : null;
            return;
          }
        }
      }
      a.blockedOn = null;
    }
    function Xc(a) {
      if (null !== a.blockedOn) return false;
      for (var b = a.targetContainers; 0 < b.length; ) {
        var c = Yc(a.domEventName, a.eventSystemFlags, b[0], a.nativeEvent);
        if (null === c) {
          c = a.nativeEvent;
          var d = new c.constructor(c.type, c);
          wb = d;
          c.target.dispatchEvent(d);
          wb = null;
        } else return b = Cb(c), null !== b && Fc(b), a.blockedOn = c, false;
        b.shift();
      }
      return true;
    }
    function Zc(a, b, c) {
      Xc(a) && c.delete(b);
    }
    function $c() {
      Jc = false;
      null !== Lc && Xc(Lc) && (Lc = null);
      null !== Mc && Xc(Mc) && (Mc = null);
      null !== Nc && Xc(Nc) && (Nc = null);
      Oc.forEach(Zc);
      Pc.forEach(Zc);
    }
    function ad(a, b) {
      a.blockedOn === b && (a.blockedOn = null, Jc || (Jc = true, ca.unstable_scheduleCallback(ca.unstable_NormalPriority, $c)));
    }
    function bd(a) {
      function b(b2) {
        return ad(b2, a);
      }
      if (0 < Kc.length) {
        ad(Kc[0], a);
        for (var c = 1; c < Kc.length; c++) {
          var d = Kc[c];
          d.blockedOn === a && (d.blockedOn = null);
        }
      }
      null !== Lc && ad(Lc, a);
      null !== Mc && ad(Mc, a);
      null !== Nc && ad(Nc, a);
      Oc.forEach(b);
      Pc.forEach(b);
      for (c = 0; c < Qc.length; c++) d = Qc[c], d.blockedOn === a && (d.blockedOn = null);
      for (; 0 < Qc.length && (c = Qc[0], null === c.blockedOn); ) Vc(c), null === c.blockedOn && Qc.shift();
    }
    var cd = ua.ReactCurrentBatchConfig;
    var dd = true;
    function ed(a, b, c, d) {
      var e = C, f = cd.transition;
      cd.transition = null;
      try {
        C = 1, fd(a, b, c, d);
      } finally {
        C = e, cd.transition = f;
      }
    }
    function gd(a, b, c, d) {
      var e = C, f = cd.transition;
      cd.transition = null;
      try {
        C = 4, fd(a, b, c, d);
      } finally {
        C = e, cd.transition = f;
      }
    }
    function fd(a, b, c, d) {
      if (dd) {
        var e = Yc(a, b, c, d);
        if (null === e) hd(a, b, d, id, c), Sc(a, d);
        else if (Uc(e, a, b, c, d)) d.stopPropagation();
        else if (Sc(a, d), b & 4 && -1 < Rc.indexOf(a)) {
          for (; null !== e; ) {
            var f = Cb(e);
            null !== f && Ec(f);
            f = Yc(a, b, c, d);
            null === f && hd(a, b, d, id, c);
            if (f === e) break;
            e = f;
          }
          null !== e && d.stopPropagation();
        } else hd(a, b, d, null, c);
      }
    }
    var id = null;
    function Yc(a, b, c, d) {
      id = null;
      a = xb(d);
      a = Wc(a);
      if (null !== a) if (b = Vb(a), null === b) a = null;
      else if (c = b.tag, 13 === c) {
        a = Wb(b);
        if (null !== a) return a;
        a = null;
      } else if (3 === c) {
        if (b.stateNode.current.memoizedState.isDehydrated) return 3 === b.tag ? b.stateNode.containerInfo : null;
        a = null;
      } else b !== a && (a = null);
      id = a;
      return null;
    }
    function jd(a) {
      switch (a) {
        case "cancel":
        case "click":
        case "close":
        case "contextmenu":
        case "copy":
        case "cut":
        case "auxclick":
        case "dblclick":
        case "dragend":
        case "dragstart":
        case "drop":
        case "focusin":
        case "focusout":
        case "input":
        case "invalid":
        case "keydown":
        case "keypress":
        case "keyup":
        case "mousedown":
        case "mouseup":
        case "paste":
        case "pause":
        case "play":
        case "pointercancel":
        case "pointerdown":
        case "pointerup":
        case "ratechange":
        case "reset":
        case "resize":
        case "seeked":
        case "submit":
        case "touchcancel":
        case "touchend":
        case "touchstart":
        case "volumechange":
        case "change":
        case "selectionchange":
        case "textInput":
        case "compositionstart":
        case "compositionend":
        case "compositionupdate":
        case "beforeblur":
        case "afterblur":
        case "beforeinput":
        case "blur":
        case "fullscreenchange":
        case "focus":
        case "hashchange":
        case "popstate":
        case "select":
        case "selectstart":
          return 1;
        case "drag":
        case "dragenter":
        case "dragexit":
        case "dragleave":
        case "dragover":
        case "mousemove":
        case "mouseout":
        case "mouseover":
        case "pointermove":
        case "pointerout":
        case "pointerover":
        case "scroll":
        case "toggle":
        case "touchmove":
        case "wheel":
        case "mouseenter":
        case "mouseleave":
        case "pointerenter":
        case "pointerleave":
          return 4;
        case "message":
          switch (ec()) {
            case fc:
              return 1;
            case gc:
              return 4;
            case hc:
            case ic:
              return 16;
            case jc:
              return 536870912;
            default:
              return 16;
          }
        default:
          return 16;
      }
    }
    var kd = null;
    var ld = null;
    var md = null;
    function nd() {
      if (md) return md;
      var a, b = ld, c = b.length, d, e = "value" in kd ? kd.value : kd.textContent, f = e.length;
      for (a = 0; a < c && b[a] === e[a]; a++) ;
      var g = c - a;
      for (d = 1; d <= g && b[c - d] === e[f - d]; d++) ;
      return md = e.slice(a, 1 < d ? 1 - d : void 0);
    }
    function od(a) {
      var b = a.keyCode;
      "charCode" in a ? (a = a.charCode, 0 === a && 13 === b && (a = 13)) : a = b;
      10 === a && (a = 13);
      return 32 <= a || 13 === a ? a : 0;
    }
    function pd() {
      return true;
    }
    function qd() {
      return false;
    }
    function rd(a) {
      function b(b2, d, e, f, g) {
        this._reactName = b2;
        this._targetInst = e;
        this.type = d;
        this.nativeEvent = f;
        this.target = g;
        this.currentTarget = null;
        for (var c in a) a.hasOwnProperty(c) && (b2 = a[c], this[c] = b2 ? b2(f) : f[c]);
        this.isDefaultPrevented = (null != f.defaultPrevented ? f.defaultPrevented : false === f.returnValue) ? pd : qd;
        this.isPropagationStopped = qd;
        return this;
      }
      A(b.prototype, { preventDefault: function() {
        this.defaultPrevented = true;
        var a2 = this.nativeEvent;
        a2 && (a2.preventDefault ? a2.preventDefault() : "unknown" !== typeof a2.returnValue && (a2.returnValue = false), this.isDefaultPrevented = pd);
      }, stopPropagation: function() {
        var a2 = this.nativeEvent;
        a2 && (a2.stopPropagation ? a2.stopPropagation() : "unknown" !== typeof a2.cancelBubble && (a2.cancelBubble = true), this.isPropagationStopped = pd);
      }, persist: function() {
      }, isPersistent: pd });
      return b;
    }
    var sd = { eventPhase: 0, bubbles: 0, cancelable: 0, timeStamp: function(a) {
      return a.timeStamp || Date.now();
    }, defaultPrevented: 0, isTrusted: 0 };
    var td = rd(sd);
    var ud = A({}, sd, { view: 0, detail: 0 });
    var vd = rd(ud);
    var wd;
    var xd;
    var yd;
    var Ad = A({}, ud, { screenX: 0, screenY: 0, clientX: 0, clientY: 0, pageX: 0, pageY: 0, ctrlKey: 0, shiftKey: 0, altKey: 0, metaKey: 0, getModifierState: zd, button: 0, buttons: 0, relatedTarget: function(a) {
      return void 0 === a.relatedTarget ? a.fromElement === a.srcElement ? a.toElement : a.fromElement : a.relatedTarget;
    }, movementX: function(a) {
      if ("movementX" in a) return a.movementX;
      a !== yd && (yd && "mousemove" === a.type ? (wd = a.screenX - yd.screenX, xd = a.screenY - yd.screenY) : xd = wd = 0, yd = a);
      return wd;
    }, movementY: function(a) {
      return "movementY" in a ? a.movementY : xd;
    } });
    var Bd = rd(Ad);
    var Cd = A({}, Ad, { dataTransfer: 0 });
    var Dd = rd(Cd);
    var Ed = A({}, ud, { relatedTarget: 0 });
    var Fd = rd(Ed);
    var Gd = A({}, sd, { animationName: 0, elapsedTime: 0, pseudoElement: 0 });
    var Hd = rd(Gd);
    var Id = A({}, sd, { clipboardData: function(a) {
      return "clipboardData" in a ? a.clipboardData : window.clipboardData;
    } });
    var Jd = rd(Id);
    var Kd = A({}, sd, { data: 0 });
    var Ld = rd(Kd);
    var Md = {
      Esc: "Escape",
      Spacebar: " ",
      Left: "ArrowLeft",
      Up: "ArrowUp",
      Right: "ArrowRight",
      Down: "ArrowDown",
      Del: "Delete",
      Win: "OS",
      Menu: "ContextMenu",
      Apps: "ContextMenu",
      Scroll: "ScrollLock",
      MozPrintableKey: "Unidentified"
    };
    var Nd = {
      8: "Backspace",
      9: "Tab",
      12: "Clear",
      13: "Enter",
      16: "Shift",
      17: "Control",
      18: "Alt",
      19: "Pause",
      20: "CapsLock",
      27: "Escape",
      32: " ",
      33: "PageUp",
      34: "PageDown",
      35: "End",
      36: "Home",
      37: "ArrowLeft",
      38: "ArrowUp",
      39: "ArrowRight",
      40: "ArrowDown",
      45: "Insert",
      46: "Delete",
      112: "F1",
      113: "F2",
      114: "F3",
      115: "F4",
      116: "F5",
      117: "F6",
      118: "F7",
      119: "F8",
      120: "F9",
      121: "F10",
      122: "F11",
      123: "F12",
      144: "NumLock",
      145: "ScrollLock",
      224: "Meta"
    };
    var Od = { Alt: "altKey", Control: "ctrlKey", Meta: "metaKey", Shift: "shiftKey" };
    function Pd(a) {
      var b = this.nativeEvent;
      return b.getModifierState ? b.getModifierState(a) : (a = Od[a]) ? !!b[a] : false;
    }
    function zd() {
      return Pd;
    }
    var Qd = A({}, ud, { key: function(a) {
      if (a.key) {
        var b = Md[a.key] || a.key;
        if ("Unidentified" !== b) return b;
      }
      return "keypress" === a.type ? (a = od(a), 13 === a ? "Enter" : String.fromCharCode(a)) : "keydown" === a.type || "keyup" === a.type ? Nd[a.keyCode] || "Unidentified" : "";
    }, code: 0, location: 0, ctrlKey: 0, shiftKey: 0, altKey: 0, metaKey: 0, repeat: 0, locale: 0, getModifierState: zd, charCode: function(a) {
      return "keypress" === a.type ? od(a) : 0;
    }, keyCode: function(a) {
      return "keydown" === a.type || "keyup" === a.type ? a.keyCode : 0;
    }, which: function(a) {
      return "keypress" === a.type ? od(a) : "keydown" === a.type || "keyup" === a.type ? a.keyCode : 0;
    } });
    var Rd = rd(Qd);
    var Sd = A({}, Ad, { pointerId: 0, width: 0, height: 0, pressure: 0, tangentialPressure: 0, tiltX: 0, tiltY: 0, twist: 0, pointerType: 0, isPrimary: 0 });
    var Td = rd(Sd);
    var Ud = A({}, ud, { touches: 0, targetTouches: 0, changedTouches: 0, altKey: 0, metaKey: 0, ctrlKey: 0, shiftKey: 0, getModifierState: zd });
    var Vd = rd(Ud);
    var Wd = A({}, sd, { propertyName: 0, elapsedTime: 0, pseudoElement: 0 });
    var Xd = rd(Wd);
    var Yd = A({}, Ad, {
      deltaX: function(a) {
        return "deltaX" in a ? a.deltaX : "wheelDeltaX" in a ? -a.wheelDeltaX : 0;
      },
      deltaY: function(a) {
        return "deltaY" in a ? a.deltaY : "wheelDeltaY" in a ? -a.wheelDeltaY : "wheelDelta" in a ? -a.wheelDelta : 0;
      },
      deltaZ: 0,
      deltaMode: 0
    });
    var Zd = rd(Yd);
    var $d = [9, 13, 27, 32];
    var ae = ia && "CompositionEvent" in window;
    var be = null;
    ia && "documentMode" in document && (be = document.documentMode);
    var ce = ia && "TextEvent" in window && !be;
    var de = ia && (!ae || be && 8 < be && 11 >= be);
    var ee = String.fromCharCode(32);
    var fe = false;
    function ge(a, b) {
      switch (a) {
        case "keyup":
          return -1 !== $d.indexOf(b.keyCode);
        case "keydown":
          return 229 !== b.keyCode;
        case "keypress":
        case "mousedown":
        case "focusout":
          return true;
        default:
          return false;
      }
    }
    function he(a) {
      a = a.detail;
      return "object" === typeof a && "data" in a ? a.data : null;
    }
    var ie = false;
    function je(a, b) {
      switch (a) {
        case "compositionend":
          return he(b);
        case "keypress":
          if (32 !== b.which) return null;
          fe = true;
          return ee;
        case "textInput":
          return a = b.data, a === ee && fe ? null : a;
        default:
          return null;
      }
    }
    function ke(a, b) {
      if (ie) return "compositionend" === a || !ae && ge(a, b) ? (a = nd(), md = ld = kd = null, ie = false, a) : null;
      switch (a) {
        case "paste":
          return null;
        case "keypress":
          if (!(b.ctrlKey || b.altKey || b.metaKey) || b.ctrlKey && b.altKey) {
            if (b.char && 1 < b.char.length) return b.char;
            if (b.which) return String.fromCharCode(b.which);
          }
          return null;
        case "compositionend":
          return de && "ko" !== b.locale ? null : b.data;
        default:
          return null;
      }
    }
    var le = { color: true, date: true, datetime: true, "datetime-local": true, email: true, month: true, number: true, password: true, range: true, search: true, tel: true, text: true, time: true, url: true, week: true };
    function me(a) {
      var b = a && a.nodeName && a.nodeName.toLowerCase();
      return "input" === b ? !!le[a.type] : "textarea" === b ? true : false;
    }
    function ne(a, b, c, d) {
      Eb(d);
      b = oe(b, "onChange");
      0 < b.length && (c = new td("onChange", "change", null, c, d), a.push({ event: c, listeners: b }));
    }
    var pe = null;
    var qe = null;
    function re(a) {
      se(a, 0);
    }
    function te(a) {
      var b = ue(a);
      if (Wa(b)) return a;
    }
    function ve(a, b) {
      if ("change" === a) return b;
    }
    var we = false;
    if (ia) {
      if (ia) {
        ye = "oninput" in document;
        if (!ye) {
          ze = document.createElement("div");
          ze.setAttribute("oninput", "return;");
          ye = "function" === typeof ze.oninput;
        }
        xe = ye;
      } else xe = false;
      we = xe && (!document.documentMode || 9 < document.documentMode);
    }
    var xe;
    var ye;
    var ze;
    function Ae() {
      pe && (pe.detachEvent("onpropertychange", Be), qe = pe = null);
    }
    function Be(a) {
      if ("value" === a.propertyName && te(qe)) {
        var b = [];
        ne(b, qe, a, xb(a));
        Jb(re, b);
      }
    }
    function Ce(a, b, c) {
      "focusin" === a ? (Ae(), pe = b, qe = c, pe.attachEvent("onpropertychange", Be)) : "focusout" === a && Ae();
    }
    function De(a) {
      if ("selectionchange" === a || "keyup" === a || "keydown" === a) return te(qe);
    }
    function Ee(a, b) {
      if ("click" === a) return te(b);
    }
    function Fe(a, b) {
      if ("input" === a || "change" === a) return te(b);
    }
    function Ge(a, b) {
      return a === b && (0 !== a || 1 / a === 1 / b) || a !== a && b !== b;
    }
    var He = "function" === typeof Object.is ? Object.is : Ge;
    function Ie(a, b) {
      if (He(a, b)) return true;
      if ("object" !== typeof a || null === a || "object" !== typeof b || null === b) return false;
      var c = Object.keys(a), d = Object.keys(b);
      if (c.length !== d.length) return false;
      for (d = 0; d < c.length; d++) {
        var e = c[d];
        if (!ja.call(b, e) || !He(a[e], b[e])) return false;
      }
      return true;
    }
    function Je(a) {
      for (; a && a.firstChild; ) a = a.firstChild;
      return a;
    }
    function Ke(a, b) {
      var c = Je(a);
      a = 0;
      for (var d; c; ) {
        if (3 === c.nodeType) {
          d = a + c.textContent.length;
          if (a <= b && d >= b) return { node: c, offset: b - a };
          a = d;
        }
        a: {
          for (; c; ) {
            if (c.nextSibling) {
              c = c.nextSibling;
              break a;
            }
            c = c.parentNode;
          }
          c = void 0;
        }
        c = Je(c);
      }
    }
    function Le(a, b) {
      return a && b ? a === b ? true : a && 3 === a.nodeType ? false : b && 3 === b.nodeType ? Le(a, b.parentNode) : "contains" in a ? a.contains(b) : a.compareDocumentPosition ? !!(a.compareDocumentPosition(b) & 16) : false : false;
    }
    function Me() {
      for (var a = window, b = Xa(); b instanceof a.HTMLIFrameElement; ) {
        try {
          var c = "string" === typeof b.contentWindow.location.href;
        } catch (d) {
          c = false;
        }
        if (c) a = b.contentWindow;
        else break;
        b = Xa(a.document);
      }
      return b;
    }
    function Ne(a) {
      var b = a && a.nodeName && a.nodeName.toLowerCase();
      return b && ("input" === b && ("text" === a.type || "search" === a.type || "tel" === a.type || "url" === a.type || "password" === a.type) || "textarea" === b || "true" === a.contentEditable);
    }
    function Oe(a) {
      var b = Me(), c = a.focusedElem, d = a.selectionRange;
      if (b !== c && c && c.ownerDocument && Le(c.ownerDocument.documentElement, c)) {
        if (null !== d && Ne(c)) {
          if (b = d.start, a = d.end, void 0 === a && (a = b), "selectionStart" in c) c.selectionStart = b, c.selectionEnd = Math.min(a, c.value.length);
          else if (a = (b = c.ownerDocument || document) && b.defaultView || window, a.getSelection) {
            a = a.getSelection();
            var e = c.textContent.length, f = Math.min(d.start, e);
            d = void 0 === d.end ? f : Math.min(d.end, e);
            !a.extend && f > d && (e = d, d = f, f = e);
            e = Ke(c, f);
            var g = Ke(
              c,
              d
            );
            e && g && (1 !== a.rangeCount || a.anchorNode !== e.node || a.anchorOffset !== e.offset || a.focusNode !== g.node || a.focusOffset !== g.offset) && (b = b.createRange(), b.setStart(e.node, e.offset), a.removeAllRanges(), f > d ? (a.addRange(b), a.extend(g.node, g.offset)) : (b.setEnd(g.node, g.offset), a.addRange(b)));
          }
        }
        b = [];
        for (a = c; a = a.parentNode; ) 1 === a.nodeType && b.push({ element: a, left: a.scrollLeft, top: a.scrollTop });
        "function" === typeof c.focus && c.focus();
        for (c = 0; c < b.length; c++) a = b[c], a.element.scrollLeft = a.left, a.element.scrollTop = a.top;
      }
    }
    var Pe = ia && "documentMode" in document && 11 >= document.documentMode;
    var Qe = null;
    var Re = null;
    var Se = null;
    var Te = false;
    function Ue(a, b, c) {
      var d = c.window === c ? c.document : 9 === c.nodeType ? c : c.ownerDocument;
      Te || null == Qe || Qe !== Xa(d) || (d = Qe, "selectionStart" in d && Ne(d) ? d = { start: d.selectionStart, end: d.selectionEnd } : (d = (d.ownerDocument && d.ownerDocument.defaultView || window).getSelection(), d = { anchorNode: d.anchorNode, anchorOffset: d.anchorOffset, focusNode: d.focusNode, focusOffset: d.focusOffset }), Se && Ie(Se, d) || (Se = d, d = oe(Re, "onSelect"), 0 < d.length && (b = new td("onSelect", "select", null, b, c), a.push({ event: b, listeners: d }), b.target = Qe)));
    }
    function Ve(a, b) {
      var c = {};
      c[a.toLowerCase()] = b.toLowerCase();
      c["Webkit" + a] = "webkit" + b;
      c["Moz" + a] = "moz" + b;
      return c;
    }
    var We = { animationend: Ve("Animation", "AnimationEnd"), animationiteration: Ve("Animation", "AnimationIteration"), animationstart: Ve("Animation", "AnimationStart"), transitionend: Ve("Transition", "TransitionEnd") };
    var Xe = {};
    var Ye = {};
    ia && (Ye = document.createElement("div").style, "AnimationEvent" in window || (delete We.animationend.animation, delete We.animationiteration.animation, delete We.animationstart.animation), "TransitionEvent" in window || delete We.transitionend.transition);
    function Ze(a) {
      if (Xe[a]) return Xe[a];
      if (!We[a]) return a;
      var b = We[a], c;
      for (c in b) if (b.hasOwnProperty(c) && c in Ye) return Xe[a] = b[c];
      return a;
    }
    var $e = Ze("animationend");
    var af = Ze("animationiteration");
    var bf = Ze("animationstart");
    var cf = Ze("transitionend");
    var df = /* @__PURE__ */ new Map();
    var ef = "abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");
    function ff(a, b) {
      df.set(a, b);
      fa(b, [a]);
    }
    for (gf = 0; gf < ef.length; gf++) {
      hf = ef[gf], jf = hf.toLowerCase(), kf = hf[0].toUpperCase() + hf.slice(1);
      ff(jf, "on" + kf);
    }
    var hf;
    var jf;
    var kf;
    var gf;
    ff($e, "onAnimationEnd");
    ff(af, "onAnimationIteration");
    ff(bf, "onAnimationStart");
    ff("dblclick", "onDoubleClick");
    ff("focusin", "onFocus");
    ff("focusout", "onBlur");
    ff(cf, "onTransitionEnd");
    ha("onMouseEnter", ["mouseout", "mouseover"]);
    ha("onMouseLeave", ["mouseout", "mouseover"]);
    ha("onPointerEnter", ["pointerout", "pointerover"]);
    ha("onPointerLeave", ["pointerout", "pointerover"]);
    fa("onChange", "change click focusin focusout input keydown keyup selectionchange".split(" "));
    fa("onSelect", "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));
    fa("onBeforeInput", ["compositionend", "keypress", "textInput", "paste"]);
    fa("onCompositionEnd", "compositionend focusout keydown keypress keyup mousedown".split(" "));
    fa("onCompositionStart", "compositionstart focusout keydown keypress keyup mousedown".split(" "));
    fa("onCompositionUpdate", "compositionupdate focusout keydown keypress keyup mousedown".split(" "));
    var lf = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" ");
    var mf = new Set("cancel close invalid load scroll toggle".split(" ").concat(lf));
    function nf(a, b, c) {
      var d = a.type || "unknown-event";
      a.currentTarget = c;
      Ub(d, b, void 0, a);
      a.currentTarget = null;
    }
    function se(a, b) {
      b = 0 !== (b & 4);
      for (var c = 0; c < a.length; c++) {
        var d = a[c], e = d.event;
        d = d.listeners;
        a: {
          var f = void 0;
          if (b) for (var g = d.length - 1; 0 <= g; g--) {
            var h2 = d[g], k = h2.instance, l = h2.currentTarget;
            h2 = h2.listener;
            if (k !== f && e.isPropagationStopped()) break a;
            nf(e, h2, l);
            f = k;
          }
          else for (g = 0; g < d.length; g++) {
            h2 = d[g];
            k = h2.instance;
            l = h2.currentTarget;
            h2 = h2.listener;
            if (k !== f && e.isPropagationStopped()) break a;
            nf(e, h2, l);
            f = k;
          }
        }
      }
      if (Qb) throw a = Rb, Qb = false, Rb = null, a;
    }
    function D(a, b) {
      var c = b[of];
      void 0 === c && (c = b[of] = /* @__PURE__ */ new Set());
      var d = a + "__bubble";
      c.has(d) || (pf(b, a, 2, false), c.add(d));
    }
    function qf(a, b, c) {
      var d = 0;
      b && (d |= 4);
      pf(c, a, d, b);
    }
    var rf = "_reactListening" + Math.random().toString(36).slice(2);
    function sf(a) {
      if (!a[rf]) {
        a[rf] = true;
        da.forEach(function(b2) {
          "selectionchange" !== b2 && (mf.has(b2) || qf(b2, false, a), qf(b2, true, a));
        });
        var b = 9 === a.nodeType ? a : a.ownerDocument;
        null === b || b[rf] || (b[rf] = true, qf("selectionchange", false, b));
      }
    }
    function pf(a, b, c, d) {
      switch (jd(b)) {
        case 1:
          var e = ed;
          break;
        case 4:
          e = gd;
          break;
        default:
          e = fd;
      }
      c = e.bind(null, b, c, a);
      e = void 0;
      !Lb || "touchstart" !== b && "touchmove" !== b && "wheel" !== b || (e = true);
      d ? void 0 !== e ? a.addEventListener(b, c, { capture: true, passive: e }) : a.addEventListener(b, c, true) : void 0 !== e ? a.addEventListener(b, c, { passive: e }) : a.addEventListener(b, c, false);
    }
    function hd(a, b, c, d, e) {
      var f = d;
      if (0 === (b & 1) && 0 === (b & 2) && null !== d) a: for (; ; ) {
        if (null === d) return;
        var g = d.tag;
        if (3 === g || 4 === g) {
          var h2 = d.stateNode.containerInfo;
          if (h2 === e || 8 === h2.nodeType && h2.parentNode === e) break;
          if (4 === g) for (g = d.return; null !== g; ) {
            var k = g.tag;
            if (3 === k || 4 === k) {
              if (k = g.stateNode.containerInfo, k === e || 8 === k.nodeType && k.parentNode === e) return;
            }
            g = g.return;
          }
          for (; null !== h2; ) {
            g = Wc(h2);
            if (null === g) return;
            k = g.tag;
            if (5 === k || 6 === k) {
              d = f = g;
              continue a;
            }
            h2 = h2.parentNode;
          }
        }
        d = d.return;
      }
      Jb(function() {
        var d2 = f, e2 = xb(c), g2 = [];
        a: {
          var h3 = df.get(a);
          if (void 0 !== h3) {
            var k2 = td, n = a;
            switch (a) {
              case "keypress":
                if (0 === od(c)) break a;
              case "keydown":
              case "keyup":
                k2 = Rd;
                break;
              case "focusin":
                n = "focus";
                k2 = Fd;
                break;
              case "focusout":
                n = "blur";
                k2 = Fd;
                break;
              case "beforeblur":
              case "afterblur":
                k2 = Fd;
                break;
              case "click":
                if (2 === c.button) break a;
              case "auxclick":
              case "dblclick":
              case "mousedown":
              case "mousemove":
              case "mouseup":
              case "mouseout":
              case "mouseover":
              case "contextmenu":
                k2 = Bd;
                break;
              case "drag":
              case "dragend":
              case "dragenter":
              case "dragexit":
              case "dragleave":
              case "dragover":
              case "dragstart":
              case "drop":
                k2 = Dd;
                break;
              case "touchcancel":
              case "touchend":
              case "touchmove":
              case "touchstart":
                k2 = Vd;
                break;
              case $e:
              case af:
              case bf:
                k2 = Hd;
                break;
              case cf:
                k2 = Xd;
                break;
              case "scroll":
                k2 = vd;
                break;
              case "wheel":
                k2 = Zd;
                break;
              case "copy":
              case "cut":
              case "paste":
                k2 = Jd;
                break;
              case "gotpointercapture":
              case "lostpointercapture":
              case "pointercancel":
              case "pointerdown":
              case "pointermove":
              case "pointerout":
              case "pointerover":
              case "pointerup":
                k2 = Td;
            }
            var t = 0 !== (b & 4), J = !t && "scroll" === a, x = t ? null !== h3 ? h3 + "Capture" : null : h3;
            t = [];
            for (var w = d2, u; null !== w; ) {
              u = w;
              var F = u.stateNode;
              5 === u.tag && null !== F && (u = F, null !== x && (F = Kb(w, x), null != F && t.push(tf(w, F, u))));
              if (J) break;
              w = w.return;
            }
            0 < t.length && (h3 = new k2(h3, n, null, c, e2), g2.push({ event: h3, listeners: t }));
          }
        }
        if (0 === (b & 7)) {
          a: {
            h3 = "mouseover" === a || "pointerover" === a;
            k2 = "mouseout" === a || "pointerout" === a;
            if (h3 && c !== wb && (n = c.relatedTarget || c.fromElement) && (Wc(n) || n[uf])) break a;
            if (k2 || h3) {
              h3 = e2.window === e2 ? e2 : (h3 = e2.ownerDocument) ? h3.defaultView || h3.parentWindow : window;
              if (k2) {
                if (n = c.relatedTarget || c.toElement, k2 = d2, n = n ? Wc(n) : null, null !== n && (J = Vb(n), n !== J || 5 !== n.tag && 6 !== n.tag)) n = null;
              } else k2 = null, n = d2;
              if (k2 !== n) {
                t = Bd;
                F = "onMouseLeave";
                x = "onMouseEnter";
                w = "mouse";
                if ("pointerout" === a || "pointerover" === a) t = Td, F = "onPointerLeave", x = "onPointerEnter", w = "pointer";
                J = null == k2 ? h3 : ue(k2);
                u = null == n ? h3 : ue(n);
                h3 = new t(F, w + "leave", k2, c, e2);
                h3.target = J;
                h3.relatedTarget = u;
                F = null;
                Wc(e2) === d2 && (t = new t(x, w + "enter", n, c, e2), t.target = u, t.relatedTarget = J, F = t);
                J = F;
                if (k2 && n) b: {
                  t = k2;
                  x = n;
                  w = 0;
                  for (u = t; u; u = vf(u)) w++;
                  u = 0;
                  for (F = x; F; F = vf(F)) u++;
                  for (; 0 < w - u; ) t = vf(t), w--;
                  for (; 0 < u - w; ) x = vf(x), u--;
                  for (; w--; ) {
                    if (t === x || null !== x && t === x.alternate) break b;
                    t = vf(t);
                    x = vf(x);
                  }
                  t = null;
                }
                else t = null;
                null !== k2 && wf(g2, h3, k2, t, false);
                null !== n && null !== J && wf(g2, J, n, t, true);
              }
            }
          }
          a: {
            h3 = d2 ? ue(d2) : window;
            k2 = h3.nodeName && h3.nodeName.toLowerCase();
            if ("select" === k2 || "input" === k2 && "file" === h3.type) var na = ve;
            else if (me(h3)) if (we) na = Fe;
            else {
              na = De;
              var xa = Ce;
            }
            else (k2 = h3.nodeName) && "input" === k2.toLowerCase() && ("checkbox" === h3.type || "radio" === h3.type) && (na = Ee);
            if (na && (na = na(a, d2))) {
              ne(g2, na, c, e2);
              break a;
            }
            xa && xa(a, h3, d2);
            "focusout" === a && (xa = h3._wrapperState) && xa.controlled && "number" === h3.type && cb(h3, "number", h3.value);
          }
          xa = d2 ? ue(d2) : window;
          switch (a) {
            case "focusin":
              if (me(xa) || "true" === xa.contentEditable) Qe = xa, Re = d2, Se = null;
              break;
            case "focusout":
              Se = Re = Qe = null;
              break;
            case "mousedown":
              Te = true;
              break;
            case "contextmenu":
            case "mouseup":
            case "dragend":
              Te = false;
              Ue(g2, c, e2);
              break;
            case "selectionchange":
              if (Pe) break;
            case "keydown":
            case "keyup":
              Ue(g2, c, e2);
          }
          var $a;
          if (ae) b: {
            switch (a) {
              case "compositionstart":
                var ba = "onCompositionStart";
                break b;
              case "compositionend":
                ba = "onCompositionEnd";
                break b;
              case "compositionupdate":
                ba = "onCompositionUpdate";
                break b;
            }
            ba = void 0;
          }
          else ie ? ge(a, c) && (ba = "onCompositionEnd") : "keydown" === a && 229 === c.keyCode && (ba = "onCompositionStart");
          ba && (de && "ko" !== c.locale && (ie || "onCompositionStart" !== ba ? "onCompositionEnd" === ba && ie && ($a = nd()) : (kd = e2, ld = "value" in kd ? kd.value : kd.textContent, ie = true)), xa = oe(d2, ba), 0 < xa.length && (ba = new Ld(ba, a, null, c, e2), g2.push({ event: ba, listeners: xa }), $a ? ba.data = $a : ($a = he(c), null !== $a && (ba.data = $a))));
          if ($a = ce ? je(a, c) : ke(a, c)) d2 = oe(d2, "onBeforeInput"), 0 < d2.length && (e2 = new Ld("onBeforeInput", "beforeinput", null, c, e2), g2.push({ event: e2, listeners: d2 }), e2.data = $a);
        }
        se(g2, b);
      });
    }
    function tf(a, b, c) {
      return { instance: a, listener: b, currentTarget: c };
    }
    function oe(a, b) {
      for (var c = b + "Capture", d = []; null !== a; ) {
        var e = a, f = e.stateNode;
        5 === e.tag && null !== f && (e = f, f = Kb(a, c), null != f && d.unshift(tf(a, f, e)), f = Kb(a, b), null != f && d.push(tf(a, f, e)));
        a = a.return;
      }
      return d;
    }
    function vf(a) {
      if (null === a) return null;
      do
        a = a.return;
      while (a && 5 !== a.tag);
      return a ? a : null;
    }
    function wf(a, b, c, d, e) {
      for (var f = b._reactName, g = []; null !== c && c !== d; ) {
        var h2 = c, k = h2.alternate, l = h2.stateNode;
        if (null !== k && k === d) break;
        5 === h2.tag && null !== l && (h2 = l, e ? (k = Kb(c, f), null != k && g.unshift(tf(c, k, h2))) : e || (k = Kb(c, f), null != k && g.push(tf(c, k, h2))));
        c = c.return;
      }
      0 !== g.length && a.push({ event: b, listeners: g });
    }
    var xf = /\r\n?/g;
    var yf = /\u0000|\uFFFD/g;
    function zf(a) {
      return ("string" === typeof a ? a : "" + a).replace(xf, "\n").replace(yf, "");
    }
    function Af(a, b, c) {
      b = zf(b);
      if (zf(a) !== b && c) throw Error(p(425));
    }
    function Bf() {
    }
    var Cf = null;
    var Df = null;
    function Ef(a, b) {
      return "textarea" === a || "noscript" === a || "string" === typeof b.children || "number" === typeof b.children || "object" === typeof b.dangerouslySetInnerHTML && null !== b.dangerouslySetInnerHTML && null != b.dangerouslySetInnerHTML.__html;
    }
    var Ff = "function" === typeof setTimeout ? setTimeout : void 0;
    var Gf = "function" === typeof clearTimeout ? clearTimeout : void 0;
    var Hf = "function" === typeof Promise ? Promise : void 0;
    var Jf = "function" === typeof queueMicrotask ? queueMicrotask : "undefined" !== typeof Hf ? function(a) {
      return Hf.resolve(null).then(a).catch(If);
    } : Ff;
    function If(a) {
      setTimeout(function() {
        throw a;
      });
    }
    function Kf(a, b) {
      var c = b, d = 0;
      do {
        var e = c.nextSibling;
        a.removeChild(c);
        if (e && 8 === e.nodeType) if (c = e.data, "/$" === c) {
          if (0 === d) {
            a.removeChild(e);
            bd(b);
            return;
          }
          d--;
        } else "$" !== c && "$?" !== c && "$!" !== c || d++;
        c = e;
      } while (c);
      bd(b);
    }
    function Lf(a) {
      for (; null != a; a = a.nextSibling) {
        var b = a.nodeType;
        if (1 === b || 3 === b) break;
        if (8 === b) {
          b = a.data;
          if ("$" === b || "$!" === b || "$?" === b) break;
          if ("/$" === b) return null;
        }
      }
      return a;
    }
    function Mf(a) {
      a = a.previousSibling;
      for (var b = 0; a; ) {
        if (8 === a.nodeType) {
          var c = a.data;
          if ("$" === c || "$!" === c || "$?" === c) {
            if (0 === b) return a;
            b--;
          } else "/$" === c && b++;
        }
        a = a.previousSibling;
      }
      return null;
    }
    var Nf = Math.random().toString(36).slice(2);
    var Of = "__reactFiber$" + Nf;
    var Pf = "__reactProps$" + Nf;
    var uf = "__reactContainer$" + Nf;
    var of = "__reactEvents$" + Nf;
    var Qf = "__reactListeners$" + Nf;
    var Rf = "__reactHandles$" + Nf;
    function Wc(a) {
      var b = a[Of];
      if (b) return b;
      for (var c = a.parentNode; c; ) {
        if (b = c[uf] || c[Of]) {
          c = b.alternate;
          if (null !== b.child || null !== c && null !== c.child) for (a = Mf(a); null !== a; ) {
            if (c = a[Of]) return c;
            a = Mf(a);
          }
          return b;
        }
        a = c;
        c = a.parentNode;
      }
      return null;
    }
    function Cb(a) {
      a = a[Of] || a[uf];
      return !a || 5 !== a.tag && 6 !== a.tag && 13 !== a.tag && 3 !== a.tag ? null : a;
    }
    function ue(a) {
      if (5 === a.tag || 6 === a.tag) return a.stateNode;
      throw Error(p(33));
    }
    function Db(a) {
      return a[Pf] || null;
    }
    var Sf = [];
    var Tf = -1;
    function Uf(a) {
      return { current: a };
    }
    function E(a) {
      0 > Tf || (a.current = Sf[Tf], Sf[Tf] = null, Tf--);
    }
    function G(a, b) {
      Tf++;
      Sf[Tf] = a.current;
      a.current = b;
    }
    var Vf = {};
    var H = Uf(Vf);
    var Wf = Uf(false);
    var Xf = Vf;
    function Yf(a, b) {
      var c = a.type.contextTypes;
      if (!c) return Vf;
      var d = a.stateNode;
      if (d && d.__reactInternalMemoizedUnmaskedChildContext === b) return d.__reactInternalMemoizedMaskedChildContext;
      var e = {}, f;
      for (f in c) e[f] = b[f];
      d && (a = a.stateNode, a.__reactInternalMemoizedUnmaskedChildContext = b, a.__reactInternalMemoizedMaskedChildContext = e);
      return e;
    }
    function Zf(a) {
      a = a.childContextTypes;
      return null !== a && void 0 !== a;
    }
    function $f() {
      E(Wf);
      E(H);
    }
    function ag(a, b, c) {
      if (H.current !== Vf) throw Error(p(168));
      G(H, b);
      G(Wf, c);
    }
    function bg(a, b, c) {
      var d = a.stateNode;
      b = b.childContextTypes;
      if ("function" !== typeof d.getChildContext) return c;
      d = d.getChildContext();
      for (var e in d) if (!(e in b)) throw Error(p(108, Ra(a) || "Unknown", e));
      return A({}, c, d);
    }
    function cg(a) {
      a = (a = a.stateNode) && a.__reactInternalMemoizedMergedChildContext || Vf;
      Xf = H.current;
      G(H, a);
      G(Wf, Wf.current);
      return true;
    }
    function dg(a, b, c) {
      var d = a.stateNode;
      if (!d) throw Error(p(169));
      c ? (a = bg(a, b, Xf), d.__reactInternalMemoizedMergedChildContext = a, E(Wf), E(H), G(H, a)) : E(Wf);
      G(Wf, c);
    }
    var eg = null;
    var fg = false;
    var gg = false;
    function hg(a) {
      null === eg ? eg = [a] : eg.push(a);
    }
    function ig(a) {
      fg = true;
      hg(a);
    }
    function jg() {
      if (!gg && null !== eg) {
        gg = true;
        var a = 0, b = C;
        try {
          var c = eg;
          for (C = 1; a < c.length; a++) {
            var d = c[a];
            do
              d = d(true);
            while (null !== d);
          }
          eg = null;
          fg = false;
        } catch (e) {
          throw null !== eg && (eg = eg.slice(a + 1)), ac(fc, jg), e;
        } finally {
          C = b, gg = false;
        }
      }
      return null;
    }
    var kg = [];
    var lg = 0;
    var mg = null;
    var ng = 0;
    var og = [];
    var pg = 0;
    var qg = null;
    var rg = 1;
    var sg = "";
    function tg(a, b) {
      kg[lg++] = ng;
      kg[lg++] = mg;
      mg = a;
      ng = b;
    }
    function ug(a, b, c) {
      og[pg++] = rg;
      og[pg++] = sg;
      og[pg++] = qg;
      qg = a;
      var d = rg;
      a = sg;
      var e = 32 - oc(d) - 1;
      d &= ~(1 << e);
      c += 1;
      var f = 32 - oc(b) + e;
      if (30 < f) {
        var g = e - e % 5;
        f = (d & (1 << g) - 1).toString(32);
        d >>= g;
        e -= g;
        rg = 1 << 32 - oc(b) + e | c << e | d;
        sg = f + a;
      } else rg = 1 << f | c << e | d, sg = a;
    }
    function vg(a) {
      null !== a.return && (tg(a, 1), ug(a, 1, 0));
    }
    function wg(a) {
      for (; a === mg; ) mg = kg[--lg], kg[lg] = null, ng = kg[--lg], kg[lg] = null;
      for (; a === qg; ) qg = og[--pg], og[pg] = null, sg = og[--pg], og[pg] = null, rg = og[--pg], og[pg] = null;
    }
    var xg = null;
    var yg = null;
    var I = false;
    var zg = null;
    function Ag(a, b) {
      var c = Bg(5, null, null, 0);
      c.elementType = "DELETED";
      c.stateNode = b;
      c.return = a;
      b = a.deletions;
      null === b ? (a.deletions = [c], a.flags |= 16) : b.push(c);
    }
    function Cg(a, b) {
      switch (a.tag) {
        case 5:
          var c = a.type;
          b = 1 !== b.nodeType || c.toLowerCase() !== b.nodeName.toLowerCase() ? null : b;
          return null !== b ? (a.stateNode = b, xg = a, yg = Lf(b.firstChild), true) : false;
        case 6:
          return b = "" === a.pendingProps || 3 !== b.nodeType ? null : b, null !== b ? (a.stateNode = b, xg = a, yg = null, true) : false;
        case 13:
          return b = 8 !== b.nodeType ? null : b, null !== b ? (c = null !== qg ? { id: rg, overflow: sg } : null, a.memoizedState = { dehydrated: b, treeContext: c, retryLane: 1073741824 }, c = Bg(18, null, null, 0), c.stateNode = b, c.return = a, a.child = c, xg = a, yg = null, true) : false;
        default:
          return false;
      }
    }
    function Dg(a) {
      return 0 !== (a.mode & 1) && 0 === (a.flags & 128);
    }
    function Eg(a) {
      if (I) {
        var b = yg;
        if (b) {
          var c = b;
          if (!Cg(a, b)) {
            if (Dg(a)) throw Error(p(418));
            b = Lf(c.nextSibling);
            var d = xg;
            b && Cg(a, b) ? Ag(d, c) : (a.flags = a.flags & -4097 | 2, I = false, xg = a);
          }
        } else {
          if (Dg(a)) throw Error(p(418));
          a.flags = a.flags & -4097 | 2;
          I = false;
          xg = a;
        }
      }
    }
    function Fg(a) {
      for (a = a.return; null !== a && 5 !== a.tag && 3 !== a.tag && 13 !== a.tag; ) a = a.return;
      xg = a;
    }
    function Gg(a) {
      if (a !== xg) return false;
      if (!I) return Fg(a), I = true, false;
      var b;
      (b = 3 !== a.tag) && !(b = 5 !== a.tag) && (b = a.type, b = "head" !== b && "body" !== b && !Ef(a.type, a.memoizedProps));
      if (b && (b = yg)) {
        if (Dg(a)) throw Hg(), Error(p(418));
        for (; b; ) Ag(a, b), b = Lf(b.nextSibling);
      }
      Fg(a);
      if (13 === a.tag) {
        a = a.memoizedState;
        a = null !== a ? a.dehydrated : null;
        if (!a) throw Error(p(317));
        a: {
          a = a.nextSibling;
          for (b = 0; a; ) {
            if (8 === a.nodeType) {
              var c = a.data;
              if ("/$" === c) {
                if (0 === b) {
                  yg = Lf(a.nextSibling);
                  break a;
                }
                b--;
              } else "$" !== c && "$!" !== c && "$?" !== c || b++;
            }
            a = a.nextSibling;
          }
          yg = null;
        }
      } else yg = xg ? Lf(a.stateNode.nextSibling) : null;
      return true;
    }
    function Hg() {
      for (var a = yg; a; ) a = Lf(a.nextSibling);
    }
    function Ig() {
      yg = xg = null;
      I = false;
    }
    function Jg(a) {
      null === zg ? zg = [a] : zg.push(a);
    }
    var Kg = ua.ReactCurrentBatchConfig;
    function Lg(a, b, c) {
      a = c.ref;
      if (null !== a && "function" !== typeof a && "object" !== typeof a) {
        if (c._owner) {
          c = c._owner;
          if (c) {
            if (1 !== c.tag) throw Error(p(309));
            var d = c.stateNode;
          }
          if (!d) throw Error(p(147, a));
          var e = d, f = "" + a;
          if (null !== b && null !== b.ref && "function" === typeof b.ref && b.ref._stringRef === f) return b.ref;
          b = function(a2) {
            var b2 = e.refs;
            null === a2 ? delete b2[f] : b2[f] = a2;
          };
          b._stringRef = f;
          return b;
        }
        if ("string" !== typeof a) throw Error(p(284));
        if (!c._owner) throw Error(p(290, a));
      }
      return a;
    }
    function Mg(a, b) {
      a = Object.prototype.toString.call(b);
      throw Error(p(31, "[object Object]" === a ? "object with keys {" + Object.keys(b).join(", ") + "}" : a));
    }
    function Ng(a) {
      var b = a._init;
      return b(a._payload);
    }
    function Og(a) {
      function b(b2, c2) {
        if (a) {
          var d2 = b2.deletions;
          null === d2 ? (b2.deletions = [c2], b2.flags |= 16) : d2.push(c2);
        }
      }
      function c(c2, d2) {
        if (!a) return null;
        for (; null !== d2; ) b(c2, d2), d2 = d2.sibling;
        return null;
      }
      function d(a2, b2) {
        for (a2 = /* @__PURE__ */ new Map(); null !== b2; ) null !== b2.key ? a2.set(b2.key, b2) : a2.set(b2.index, b2), b2 = b2.sibling;
        return a2;
      }
      function e(a2, b2) {
        a2 = Pg(a2, b2);
        a2.index = 0;
        a2.sibling = null;
        return a2;
      }
      function f(b2, c2, d2) {
        b2.index = d2;
        if (!a) return b2.flags |= 1048576, c2;
        d2 = b2.alternate;
        if (null !== d2) return d2 = d2.index, d2 < c2 ? (b2.flags |= 2, c2) : d2;
        b2.flags |= 2;
        return c2;
      }
      function g(b2) {
        a && null === b2.alternate && (b2.flags |= 2);
        return b2;
      }
      function h2(a2, b2, c2, d2) {
        if (null === b2 || 6 !== b2.tag) return b2 = Qg(c2, a2.mode, d2), b2.return = a2, b2;
        b2 = e(b2, c2);
        b2.return = a2;
        return b2;
      }
      function k(a2, b2, c2, d2) {
        var f2 = c2.type;
        if (f2 === ya) return m(a2, b2, c2.props.children, d2, c2.key);
        if (null !== b2 && (b2.elementType === f2 || "object" === typeof f2 && null !== f2 && f2.$$typeof === Ha && Ng(f2) === b2.type)) return d2 = e(b2, c2.props), d2.ref = Lg(a2, b2, c2), d2.return = a2, d2;
        d2 = Rg(c2.type, c2.key, c2.props, null, a2.mode, d2);
        d2.ref = Lg(a2, b2, c2);
        d2.return = a2;
        return d2;
      }
      function l(a2, b2, c2, d2) {
        if (null === b2 || 4 !== b2.tag || b2.stateNode.containerInfo !== c2.containerInfo || b2.stateNode.implementation !== c2.implementation) return b2 = Sg(c2, a2.mode, d2), b2.return = a2, b2;
        b2 = e(b2, c2.children || []);
        b2.return = a2;
        return b2;
      }
      function m(a2, b2, c2, d2, f2) {
        if (null === b2 || 7 !== b2.tag) return b2 = Tg(c2, a2.mode, d2, f2), b2.return = a2, b2;
        b2 = e(b2, c2);
        b2.return = a2;
        return b2;
      }
      function q(a2, b2, c2) {
        if ("string" === typeof b2 && "" !== b2 || "number" === typeof b2) return b2 = Qg("" + b2, a2.mode, c2), b2.return = a2, b2;
        if ("object" === typeof b2 && null !== b2) {
          switch (b2.$$typeof) {
            case va:
              return c2 = Rg(b2.type, b2.key, b2.props, null, a2.mode, c2), c2.ref = Lg(a2, null, b2), c2.return = a2, c2;
            case wa:
              return b2 = Sg(b2, a2.mode, c2), b2.return = a2, b2;
            case Ha:
              var d2 = b2._init;
              return q(a2, d2(b2._payload), c2);
          }
          if (eb(b2) || Ka(b2)) return b2 = Tg(b2, a2.mode, c2, null), b2.return = a2, b2;
          Mg(a2, b2);
        }
        return null;
      }
      function r(a2, b2, c2, d2) {
        var e2 = null !== b2 ? b2.key : null;
        if ("string" === typeof c2 && "" !== c2 || "number" === typeof c2) return null !== e2 ? null : h2(a2, b2, "" + c2, d2);
        if ("object" === typeof c2 && null !== c2) {
          switch (c2.$$typeof) {
            case va:
              return c2.key === e2 ? k(a2, b2, c2, d2) : null;
            case wa:
              return c2.key === e2 ? l(a2, b2, c2, d2) : null;
            case Ha:
              return e2 = c2._init, r(
                a2,
                b2,
                e2(c2._payload),
                d2
              );
          }
          if (eb(c2) || Ka(c2)) return null !== e2 ? null : m(a2, b2, c2, d2, null);
          Mg(a2, c2);
        }
        return null;
      }
      function y(a2, b2, c2, d2, e2) {
        if ("string" === typeof d2 && "" !== d2 || "number" === typeof d2) return a2 = a2.get(c2) || null, h2(b2, a2, "" + d2, e2);
        if ("object" === typeof d2 && null !== d2) {
          switch (d2.$$typeof) {
            case va:
              return a2 = a2.get(null === d2.key ? c2 : d2.key) || null, k(b2, a2, d2, e2);
            case wa:
              return a2 = a2.get(null === d2.key ? c2 : d2.key) || null, l(b2, a2, d2, e2);
            case Ha:
              var f2 = d2._init;
              return y(a2, b2, c2, f2(d2._payload), e2);
          }
          if (eb(d2) || Ka(d2)) return a2 = a2.get(c2) || null, m(b2, a2, d2, e2, null);
          Mg(b2, d2);
        }
        return null;
      }
      function n(e2, g2, h3, k2) {
        for (var l2 = null, m2 = null, u = g2, w = g2 = 0, x = null; null !== u && w < h3.length; w++) {
          u.index > w ? (x = u, u = null) : x = u.sibling;
          var n2 = r(e2, u, h3[w], k2);
          if (null === n2) {
            null === u && (u = x);
            break;
          }
          a && u && null === n2.alternate && b(e2, u);
          g2 = f(n2, g2, w);
          null === m2 ? l2 = n2 : m2.sibling = n2;
          m2 = n2;
          u = x;
        }
        if (w === h3.length) return c(e2, u), I && tg(e2, w), l2;
        if (null === u) {
          for (; w < h3.length; w++) u = q(e2, h3[w], k2), null !== u && (g2 = f(u, g2, w), null === m2 ? l2 = u : m2.sibling = u, m2 = u);
          I && tg(e2, w);
          return l2;
        }
        for (u = d(e2, u); w < h3.length; w++) x = y(u, e2, w, h3[w], k2), null !== x && (a && null !== x.alternate && u.delete(null === x.key ? w : x.key), g2 = f(x, g2, w), null === m2 ? l2 = x : m2.sibling = x, m2 = x);
        a && u.forEach(function(a2) {
          return b(e2, a2);
        });
        I && tg(e2, w);
        return l2;
      }
      function t(e2, g2, h3, k2) {
        var l2 = Ka(h3);
        if ("function" !== typeof l2) throw Error(p(150));
        h3 = l2.call(h3);
        if (null == h3) throw Error(p(151));
        for (var u = l2 = null, m2 = g2, w = g2 = 0, x = null, n2 = h3.next(); null !== m2 && !n2.done; w++, n2 = h3.next()) {
          m2.index > w ? (x = m2, m2 = null) : x = m2.sibling;
          var t2 = r(e2, m2, n2.value, k2);
          if (null === t2) {
            null === m2 && (m2 = x);
            break;
          }
          a && m2 && null === t2.alternate && b(e2, m2);
          g2 = f(t2, g2, w);
          null === u ? l2 = t2 : u.sibling = t2;
          u = t2;
          m2 = x;
        }
        if (n2.done) return c(
          e2,
          m2
        ), I && tg(e2, w), l2;
        if (null === m2) {
          for (; !n2.done; w++, n2 = h3.next()) n2 = q(e2, n2.value, k2), null !== n2 && (g2 = f(n2, g2, w), null === u ? l2 = n2 : u.sibling = n2, u = n2);
          I && tg(e2, w);
          return l2;
        }
        for (m2 = d(e2, m2); !n2.done; w++, n2 = h3.next()) n2 = y(m2, e2, w, n2.value, k2), null !== n2 && (a && null !== n2.alternate && m2.delete(null === n2.key ? w : n2.key), g2 = f(n2, g2, w), null === u ? l2 = n2 : u.sibling = n2, u = n2);
        a && m2.forEach(function(a2) {
          return b(e2, a2);
        });
        I && tg(e2, w);
        return l2;
      }
      function J(a2, d2, f2, h3) {
        "object" === typeof f2 && null !== f2 && f2.type === ya && null === f2.key && (f2 = f2.props.children);
        if ("object" === typeof f2 && null !== f2) {
          switch (f2.$$typeof) {
            case va:
              a: {
                for (var k2 = f2.key, l2 = d2; null !== l2; ) {
                  if (l2.key === k2) {
                    k2 = f2.type;
                    if (k2 === ya) {
                      if (7 === l2.tag) {
                        c(a2, l2.sibling);
                        d2 = e(l2, f2.props.children);
                        d2.return = a2;
                        a2 = d2;
                        break a;
                      }
                    } else if (l2.elementType === k2 || "object" === typeof k2 && null !== k2 && k2.$$typeof === Ha && Ng(k2) === l2.type) {
                      c(a2, l2.sibling);
                      d2 = e(l2, f2.props);
                      d2.ref = Lg(a2, l2, f2);
                      d2.return = a2;
                      a2 = d2;
                      break a;
                    }
                    c(a2, l2);
                    break;
                  } else b(a2, l2);
                  l2 = l2.sibling;
                }
                f2.type === ya ? (d2 = Tg(f2.props.children, a2.mode, h3, f2.key), d2.return = a2, a2 = d2) : (h3 = Rg(f2.type, f2.key, f2.props, null, a2.mode, h3), h3.ref = Lg(a2, d2, f2), h3.return = a2, a2 = h3);
              }
              return g(a2);
            case wa:
              a: {
                for (l2 = f2.key; null !== d2; ) {
                  if (d2.key === l2) if (4 === d2.tag && d2.stateNode.containerInfo === f2.containerInfo && d2.stateNode.implementation === f2.implementation) {
                    c(a2, d2.sibling);
                    d2 = e(d2, f2.children || []);
                    d2.return = a2;
                    a2 = d2;
                    break a;
                  } else {
                    c(a2, d2);
                    break;
                  }
                  else b(a2, d2);
                  d2 = d2.sibling;
                }
                d2 = Sg(f2, a2.mode, h3);
                d2.return = a2;
                a2 = d2;
              }
              return g(a2);
            case Ha:
              return l2 = f2._init, J(a2, d2, l2(f2._payload), h3);
          }
          if (eb(f2)) return n(a2, d2, f2, h3);
          if (Ka(f2)) return t(a2, d2, f2, h3);
          Mg(a2, f2);
        }
        return "string" === typeof f2 && "" !== f2 || "number" === typeof f2 ? (f2 = "" + f2, null !== d2 && 6 === d2.tag ? (c(a2, d2.sibling), d2 = e(d2, f2), d2.return = a2, a2 = d2) : (c(a2, d2), d2 = Qg(f2, a2.mode, h3), d2.return = a2, a2 = d2), g(a2)) : c(a2, d2);
      }
      return J;
    }
    var Ug = Og(true);
    var Vg = Og(false);
    var Wg = Uf(null);
    var Xg = null;
    var Yg = null;
    var Zg = null;
    function $g() {
      Zg = Yg = Xg = null;
    }
    function ah(a) {
      var b = Wg.current;
      E(Wg);
      a._currentValue = b;
    }
    function bh(a, b, c) {
      for (; null !== a; ) {
        var d = a.alternate;
        (a.childLanes & b) !== b ? (a.childLanes |= b, null !== d && (d.childLanes |= b)) : null !== d && (d.childLanes & b) !== b && (d.childLanes |= b);
        if (a === c) break;
        a = a.return;
      }
    }
    function ch(a, b) {
      Xg = a;
      Zg = Yg = null;
      a = a.dependencies;
      null !== a && null !== a.firstContext && (0 !== (a.lanes & b) && (dh = true), a.firstContext = null);
    }
    function eh(a) {
      var b = a._currentValue;
      if (Zg !== a) if (a = { context: a, memoizedValue: b, next: null }, null === Yg) {
        if (null === Xg) throw Error(p(308));
        Yg = a;
        Xg.dependencies = { lanes: 0, firstContext: a };
      } else Yg = Yg.next = a;
      return b;
    }
    var fh = null;
    function gh(a) {
      null === fh ? fh = [a] : fh.push(a);
    }
    function hh(a, b, c, d) {
      var e = b.interleaved;
      null === e ? (c.next = c, gh(b)) : (c.next = e.next, e.next = c);
      b.interleaved = c;
      return ih(a, d);
    }
    function ih(a, b) {
      a.lanes |= b;
      var c = a.alternate;
      null !== c && (c.lanes |= b);
      c = a;
      for (a = a.return; null !== a; ) a.childLanes |= b, c = a.alternate, null !== c && (c.childLanes |= b), c = a, a = a.return;
      return 3 === c.tag ? c.stateNode : null;
    }
    var jh = false;
    function kh(a) {
      a.updateQueue = { baseState: a.memoizedState, firstBaseUpdate: null, lastBaseUpdate: null, shared: { pending: null, interleaved: null, lanes: 0 }, effects: null };
    }
    function lh(a, b) {
      a = a.updateQueue;
      b.updateQueue === a && (b.updateQueue = { baseState: a.baseState, firstBaseUpdate: a.firstBaseUpdate, lastBaseUpdate: a.lastBaseUpdate, shared: a.shared, effects: a.effects });
    }
    function mh(a, b) {
      return { eventTime: a, lane: b, tag: 0, payload: null, callback: null, next: null };
    }
    function nh(a, b, c) {
      var d = a.updateQueue;
      if (null === d) return null;
      d = d.shared;
      if (0 !== (K & 2)) {
        var e = d.pending;
        null === e ? b.next = b : (b.next = e.next, e.next = b);
        d.pending = b;
        return ih(a, c);
      }
      e = d.interleaved;
      null === e ? (b.next = b, gh(d)) : (b.next = e.next, e.next = b);
      d.interleaved = b;
      return ih(a, c);
    }
    function oh(a, b, c) {
      b = b.updateQueue;
      if (null !== b && (b = b.shared, 0 !== (c & 4194240))) {
        var d = b.lanes;
        d &= a.pendingLanes;
        c |= d;
        b.lanes = c;
        Cc(a, c);
      }
    }
    function ph(a, b) {
      var c = a.updateQueue, d = a.alternate;
      if (null !== d && (d = d.updateQueue, c === d)) {
        var e = null, f = null;
        c = c.firstBaseUpdate;
        if (null !== c) {
          do {
            var g = { eventTime: c.eventTime, lane: c.lane, tag: c.tag, payload: c.payload, callback: c.callback, next: null };
            null === f ? e = f = g : f = f.next = g;
            c = c.next;
          } while (null !== c);
          null === f ? e = f = b : f = f.next = b;
        } else e = f = b;
        c = { baseState: d.baseState, firstBaseUpdate: e, lastBaseUpdate: f, shared: d.shared, effects: d.effects };
        a.updateQueue = c;
        return;
      }
      a = c.lastBaseUpdate;
      null === a ? c.firstBaseUpdate = b : a.next = b;
      c.lastBaseUpdate = b;
    }
    function qh(a, b, c, d) {
      var e = a.updateQueue;
      jh = false;
      var f = e.firstBaseUpdate, g = e.lastBaseUpdate, h2 = e.shared.pending;
      if (null !== h2) {
        e.shared.pending = null;
        var k = h2, l = k.next;
        k.next = null;
        null === g ? f = l : g.next = l;
        g = k;
        var m = a.alternate;
        null !== m && (m = m.updateQueue, h2 = m.lastBaseUpdate, h2 !== g && (null === h2 ? m.firstBaseUpdate = l : h2.next = l, m.lastBaseUpdate = k));
      }
      if (null !== f) {
        var q = e.baseState;
        g = 0;
        m = l = k = null;
        h2 = f;
        do {
          var r = h2.lane, y = h2.eventTime;
          if ((d & r) === r) {
            null !== m && (m = m.next = {
              eventTime: y,
              lane: 0,
              tag: h2.tag,
              payload: h2.payload,
              callback: h2.callback,
              next: null
            });
            a: {
              var n = a, t = h2;
              r = b;
              y = c;
              switch (t.tag) {
                case 1:
                  n = t.payload;
                  if ("function" === typeof n) {
                    q = n.call(y, q, r);
                    break a;
                  }
                  q = n;
                  break a;
                case 3:
                  n.flags = n.flags & -65537 | 128;
                case 0:
                  n = t.payload;
                  r = "function" === typeof n ? n.call(y, q, r) : n;
                  if (null === r || void 0 === r) break a;
                  q = A({}, q, r);
                  break a;
                case 2:
                  jh = true;
              }
            }
            null !== h2.callback && 0 !== h2.lane && (a.flags |= 64, r = e.effects, null === r ? e.effects = [h2] : r.push(h2));
          } else y = { eventTime: y, lane: r, tag: h2.tag, payload: h2.payload, callback: h2.callback, next: null }, null === m ? (l = m = y, k = q) : m = m.next = y, g |= r;
          h2 = h2.next;
          if (null === h2) if (h2 = e.shared.pending, null === h2) break;
          else r = h2, h2 = r.next, r.next = null, e.lastBaseUpdate = r, e.shared.pending = null;
        } while (1);
        null === m && (k = q);
        e.baseState = k;
        e.firstBaseUpdate = l;
        e.lastBaseUpdate = m;
        b = e.shared.interleaved;
        if (null !== b) {
          e = b;
          do
            g |= e.lane, e = e.next;
          while (e !== b);
        } else null === f && (e.shared.lanes = 0);
        rh |= g;
        a.lanes = g;
        a.memoizedState = q;
      }
    }
    function sh(a, b, c) {
      a = b.effects;
      b.effects = null;
      if (null !== a) for (b = 0; b < a.length; b++) {
        var d = a[b], e = d.callback;
        if (null !== e) {
          d.callback = null;
          d = c;
          if ("function" !== typeof e) throw Error(p(191, e));
          e.call(d);
        }
      }
    }
    var th = {};
    var uh = Uf(th);
    var vh = Uf(th);
    var wh = Uf(th);
    function xh(a) {
      if (a === th) throw Error(p(174));
      return a;
    }
    function yh(a, b) {
      G(wh, b);
      G(vh, a);
      G(uh, th);
      a = b.nodeType;
      switch (a) {
        case 9:
        case 11:
          b = (b = b.documentElement) ? b.namespaceURI : lb(null, "");
          break;
        default:
          a = 8 === a ? b.parentNode : b, b = a.namespaceURI || null, a = a.tagName, b = lb(b, a);
      }
      E(uh);
      G(uh, b);
    }
    function zh() {
      E(uh);
      E(vh);
      E(wh);
    }
    function Ah(a) {
      xh(wh.current);
      var b = xh(uh.current);
      var c = lb(b, a.type);
      b !== c && (G(vh, a), G(uh, c));
    }
    function Bh(a) {
      vh.current === a && (E(uh), E(vh));
    }
    var L = Uf(0);
    function Ch(a) {
      for (var b = a; null !== b; ) {
        if (13 === b.tag) {
          var c = b.memoizedState;
          if (null !== c && (c = c.dehydrated, null === c || "$?" === c.data || "$!" === c.data)) return b;
        } else if (19 === b.tag && void 0 !== b.memoizedProps.revealOrder) {
          if (0 !== (b.flags & 128)) return b;
        } else if (null !== b.child) {
          b.child.return = b;
          b = b.child;
          continue;
        }
        if (b === a) break;
        for (; null === b.sibling; ) {
          if (null === b.return || b.return === a) return null;
          b = b.return;
        }
        b.sibling.return = b.return;
        b = b.sibling;
      }
      return null;
    }
    var Dh = [];
    function Eh() {
      for (var a = 0; a < Dh.length; a++) Dh[a]._workInProgressVersionPrimary = null;
      Dh.length = 0;
    }
    var Fh = ua.ReactCurrentDispatcher;
    var Gh = ua.ReactCurrentBatchConfig;
    var Hh = 0;
    var M = null;
    var N = null;
    var O = null;
    var Ih = false;
    var Jh = false;
    var Kh = 0;
    var Lh = 0;
    function P() {
      throw Error(p(321));
    }
    function Mh(a, b) {
      if (null === b) return false;
      for (var c = 0; c < b.length && c < a.length; c++) if (!He(a[c], b[c])) return false;
      return true;
    }
    function Nh(a, b, c, d, e, f) {
      Hh = f;
      M = b;
      b.memoizedState = null;
      b.updateQueue = null;
      b.lanes = 0;
      Fh.current = null === a || null === a.memoizedState ? Oh : Ph;
      a = c(d, e);
      if (Jh) {
        f = 0;
        do {
          Jh = false;
          Kh = 0;
          if (25 <= f) throw Error(p(301));
          f += 1;
          O = N = null;
          b.updateQueue = null;
          Fh.current = Qh;
          a = c(d, e);
        } while (Jh);
      }
      Fh.current = Rh;
      b = null !== N && null !== N.next;
      Hh = 0;
      O = N = M = null;
      Ih = false;
      if (b) throw Error(p(300));
      return a;
    }
    function Sh() {
      var a = 0 !== Kh;
      Kh = 0;
      return a;
    }
    function Th() {
      var a = { memoizedState: null, baseState: null, baseQueue: null, queue: null, next: null };
      null === O ? M.memoizedState = O = a : O = O.next = a;
      return O;
    }
    function Uh() {
      if (null === N) {
        var a = M.alternate;
        a = null !== a ? a.memoizedState : null;
      } else a = N.next;
      var b = null === O ? M.memoizedState : O.next;
      if (null !== b) O = b, N = a;
      else {
        if (null === a) throw Error(p(310));
        N = a;
        a = { memoizedState: N.memoizedState, baseState: N.baseState, baseQueue: N.baseQueue, queue: N.queue, next: null };
        null === O ? M.memoizedState = O = a : O = O.next = a;
      }
      return O;
    }
    function Vh(a, b) {
      return "function" === typeof b ? b(a) : b;
    }
    function Wh(a) {
      var b = Uh(), c = b.queue;
      if (null === c) throw Error(p(311));
      c.lastRenderedReducer = a;
      var d = N, e = d.baseQueue, f = c.pending;
      if (null !== f) {
        if (null !== e) {
          var g = e.next;
          e.next = f.next;
          f.next = g;
        }
        d.baseQueue = e = f;
        c.pending = null;
      }
      if (null !== e) {
        f = e.next;
        d = d.baseState;
        var h2 = g = null, k = null, l = f;
        do {
          var m = l.lane;
          if ((Hh & m) === m) null !== k && (k = k.next = { lane: 0, action: l.action, hasEagerState: l.hasEagerState, eagerState: l.eagerState, next: null }), d = l.hasEagerState ? l.eagerState : a(d, l.action);
          else {
            var q = {
              lane: m,
              action: l.action,
              hasEagerState: l.hasEagerState,
              eagerState: l.eagerState,
              next: null
            };
            null === k ? (h2 = k = q, g = d) : k = k.next = q;
            M.lanes |= m;
            rh |= m;
          }
          l = l.next;
        } while (null !== l && l !== f);
        null === k ? g = d : k.next = h2;
        He(d, b.memoizedState) || (dh = true);
        b.memoizedState = d;
        b.baseState = g;
        b.baseQueue = k;
        c.lastRenderedState = d;
      }
      a = c.interleaved;
      if (null !== a) {
        e = a;
        do
          f = e.lane, M.lanes |= f, rh |= f, e = e.next;
        while (e !== a);
      } else null === e && (c.lanes = 0);
      return [b.memoizedState, c.dispatch];
    }
    function Xh(a) {
      var b = Uh(), c = b.queue;
      if (null === c) throw Error(p(311));
      c.lastRenderedReducer = a;
      var d = c.dispatch, e = c.pending, f = b.memoizedState;
      if (null !== e) {
        c.pending = null;
        var g = e = e.next;
        do
          f = a(f, g.action), g = g.next;
        while (g !== e);
        He(f, b.memoizedState) || (dh = true);
        b.memoizedState = f;
        null === b.baseQueue && (b.baseState = f);
        c.lastRenderedState = f;
      }
      return [f, d];
    }
    function Yh() {
    }
    function Zh(a, b) {
      var c = M, d = Uh(), e = b(), f = !He(d.memoizedState, e);
      f && (d.memoizedState = e, dh = true);
      d = d.queue;
      $h(ai.bind(null, c, d, a), [a]);
      if (d.getSnapshot !== b || f || null !== O && O.memoizedState.tag & 1) {
        c.flags |= 2048;
        bi(9, ci.bind(null, c, d, e, b), void 0, null);
        if (null === Q) throw Error(p(349));
        0 !== (Hh & 30) || di(c, b, e);
      }
      return e;
    }
    function di(a, b, c) {
      a.flags |= 16384;
      a = { getSnapshot: b, value: c };
      b = M.updateQueue;
      null === b ? (b = { lastEffect: null, stores: null }, M.updateQueue = b, b.stores = [a]) : (c = b.stores, null === c ? b.stores = [a] : c.push(a));
    }
    function ci(a, b, c, d) {
      b.value = c;
      b.getSnapshot = d;
      ei(b) && fi(a);
    }
    function ai(a, b, c) {
      return c(function() {
        ei(b) && fi(a);
      });
    }
    function ei(a) {
      var b = a.getSnapshot;
      a = a.value;
      try {
        var c = b();
        return !He(a, c);
      } catch (d) {
        return true;
      }
    }
    function fi(a) {
      var b = ih(a, 1);
      null !== b && gi(b, a, 1, -1);
    }
    function hi(a) {
      var b = Th();
      "function" === typeof a && (a = a());
      b.memoizedState = b.baseState = a;
      a = { pending: null, interleaved: null, lanes: 0, dispatch: null, lastRenderedReducer: Vh, lastRenderedState: a };
      b.queue = a;
      a = a.dispatch = ii.bind(null, M, a);
      return [b.memoizedState, a];
    }
    function bi(a, b, c, d) {
      a = { tag: a, create: b, destroy: c, deps: d, next: null };
      b = M.updateQueue;
      null === b ? (b = { lastEffect: null, stores: null }, M.updateQueue = b, b.lastEffect = a.next = a) : (c = b.lastEffect, null === c ? b.lastEffect = a.next = a : (d = c.next, c.next = a, a.next = d, b.lastEffect = a));
      return a;
    }
    function ji() {
      return Uh().memoizedState;
    }
    function ki(a, b, c, d) {
      var e = Th();
      M.flags |= a;
      e.memoizedState = bi(1 | b, c, void 0, void 0 === d ? null : d);
    }
    function li(a, b, c, d) {
      var e = Uh();
      d = void 0 === d ? null : d;
      var f = void 0;
      if (null !== N) {
        var g = N.memoizedState;
        f = g.destroy;
        if (null !== d && Mh(d, g.deps)) {
          e.memoizedState = bi(b, c, f, d);
          return;
        }
      }
      M.flags |= a;
      e.memoizedState = bi(1 | b, c, f, d);
    }
    function mi(a, b) {
      return ki(8390656, 8, a, b);
    }
    function $h(a, b) {
      return li(2048, 8, a, b);
    }
    function ni(a, b) {
      return li(4, 2, a, b);
    }
    function oi(a, b) {
      return li(4, 4, a, b);
    }
    function pi(a, b) {
      if ("function" === typeof b) return a = a(), b(a), function() {
        b(null);
      };
      if (null !== b && void 0 !== b) return a = a(), b.current = a, function() {
        b.current = null;
      };
    }
    function qi(a, b, c) {
      c = null !== c && void 0 !== c ? c.concat([a]) : null;
      return li(4, 4, pi.bind(null, b, a), c);
    }
    function ri() {
    }
    function si(a, b) {
      var c = Uh();
      b = void 0 === b ? null : b;
      var d = c.memoizedState;
      if (null !== d && null !== b && Mh(b, d[1])) return d[0];
      c.memoizedState = [a, b];
      return a;
    }
    function ti(a, b) {
      var c = Uh();
      b = void 0 === b ? null : b;
      var d = c.memoizedState;
      if (null !== d && null !== b && Mh(b, d[1])) return d[0];
      a = a();
      c.memoizedState = [a, b];
      return a;
    }
    function ui(a, b, c) {
      if (0 === (Hh & 21)) return a.baseState && (a.baseState = false, dh = true), a.memoizedState = c;
      He(c, b) || (c = yc(), M.lanes |= c, rh |= c, a.baseState = true);
      return b;
    }
    function vi(a, b) {
      var c = C;
      C = 0 !== c && 4 > c ? c : 4;
      a(true);
      var d = Gh.transition;
      Gh.transition = {};
      try {
        a(false), b();
      } finally {
        C = c, Gh.transition = d;
      }
    }
    function wi() {
      return Uh().memoizedState;
    }
    function xi(a, b, c) {
      var d = yi(a);
      c = { lane: d, action: c, hasEagerState: false, eagerState: null, next: null };
      if (zi(a)) Ai(b, c);
      else if (c = hh(a, b, c, d), null !== c) {
        var e = R();
        gi(c, a, d, e);
        Bi(c, b, d);
      }
    }
    function ii(a, b, c) {
      var d = yi(a), e = { lane: d, action: c, hasEagerState: false, eagerState: null, next: null };
      if (zi(a)) Ai(b, e);
      else {
        var f = a.alternate;
        if (0 === a.lanes && (null === f || 0 === f.lanes) && (f = b.lastRenderedReducer, null !== f)) try {
          var g = b.lastRenderedState, h2 = f(g, c);
          e.hasEagerState = true;
          e.eagerState = h2;
          if (He(h2, g)) {
            var k = b.interleaved;
            null === k ? (e.next = e, gh(b)) : (e.next = k.next, k.next = e);
            b.interleaved = e;
            return;
          }
        } catch (l) {
        } finally {
        }
        c = hh(a, b, e, d);
        null !== c && (e = R(), gi(c, a, d, e), Bi(c, b, d));
      }
    }
    function zi(a) {
      var b = a.alternate;
      return a === M || null !== b && b === M;
    }
    function Ai(a, b) {
      Jh = Ih = true;
      var c = a.pending;
      null === c ? b.next = b : (b.next = c.next, c.next = b);
      a.pending = b;
    }
    function Bi(a, b, c) {
      if (0 !== (c & 4194240)) {
        var d = b.lanes;
        d &= a.pendingLanes;
        c |= d;
        b.lanes = c;
        Cc(a, c);
      }
    }
    var Rh = { readContext: eh, useCallback: P, useContext: P, useEffect: P, useImperativeHandle: P, useInsertionEffect: P, useLayoutEffect: P, useMemo: P, useReducer: P, useRef: P, useState: P, useDebugValue: P, useDeferredValue: P, useTransition: P, useMutableSource: P, useSyncExternalStore: P, useId: P, unstable_isNewReconciler: false };
    var Oh = { readContext: eh, useCallback: function(a, b) {
      Th().memoizedState = [a, void 0 === b ? null : b];
      return a;
    }, useContext: eh, useEffect: mi, useImperativeHandle: function(a, b, c) {
      c = null !== c && void 0 !== c ? c.concat([a]) : null;
      return ki(
        4194308,
        4,
        pi.bind(null, b, a),
        c
      );
    }, useLayoutEffect: function(a, b) {
      return ki(4194308, 4, a, b);
    }, useInsertionEffect: function(a, b) {
      return ki(4, 2, a, b);
    }, useMemo: function(a, b) {
      var c = Th();
      b = void 0 === b ? null : b;
      a = a();
      c.memoizedState = [a, b];
      return a;
    }, useReducer: function(a, b, c) {
      var d = Th();
      b = void 0 !== c ? c(b) : b;
      d.memoizedState = d.baseState = b;
      a = { pending: null, interleaved: null, lanes: 0, dispatch: null, lastRenderedReducer: a, lastRenderedState: b };
      d.queue = a;
      a = a.dispatch = xi.bind(null, M, a);
      return [d.memoizedState, a];
    }, useRef: function(a) {
      var b = Th();
      a = { current: a };
      return b.memoizedState = a;
    }, useState: hi, useDebugValue: ri, useDeferredValue: function(a) {
      return Th().memoizedState = a;
    }, useTransition: function() {
      var a = hi(false), b = a[0];
      a = vi.bind(null, a[1]);
      Th().memoizedState = a;
      return [b, a];
    }, useMutableSource: function() {
    }, useSyncExternalStore: function(a, b, c) {
      var d = M, e = Th();
      if (I) {
        if (void 0 === c) throw Error(p(407));
        c = c();
      } else {
        c = b();
        if (null === Q) throw Error(p(349));
        0 !== (Hh & 30) || di(d, b, c);
      }
      e.memoizedState = c;
      var f = { value: c, getSnapshot: b };
      e.queue = f;
      mi(ai.bind(
        null,
        d,
        f,
        a
      ), [a]);
      d.flags |= 2048;
      bi(9, ci.bind(null, d, f, c, b), void 0, null);
      return c;
    }, useId: function() {
      var a = Th(), b = Q.identifierPrefix;
      if (I) {
        var c = sg;
        var d = rg;
        c = (d & ~(1 << 32 - oc(d) - 1)).toString(32) + c;
        b = ":" + b + "R" + c;
        c = Kh++;
        0 < c && (b += "H" + c.toString(32));
        b += ":";
      } else c = Lh++, b = ":" + b + "r" + c.toString(32) + ":";
      return a.memoizedState = b;
    }, unstable_isNewReconciler: false };
    var Ph = {
      readContext: eh,
      useCallback: si,
      useContext: eh,
      useEffect: $h,
      useImperativeHandle: qi,
      useInsertionEffect: ni,
      useLayoutEffect: oi,
      useMemo: ti,
      useReducer: Wh,
      useRef: ji,
      useState: function() {
        return Wh(Vh);
      },
      useDebugValue: ri,
      useDeferredValue: function(a) {
        var b = Uh();
        return ui(b, N.memoizedState, a);
      },
      useTransition: function() {
        var a = Wh(Vh)[0], b = Uh().memoizedState;
        return [a, b];
      },
      useMutableSource: Yh,
      useSyncExternalStore: Zh,
      useId: wi,
      unstable_isNewReconciler: false
    };
    var Qh = { readContext: eh, useCallback: si, useContext: eh, useEffect: $h, useImperativeHandle: qi, useInsertionEffect: ni, useLayoutEffect: oi, useMemo: ti, useReducer: Xh, useRef: ji, useState: function() {
      return Xh(Vh);
    }, useDebugValue: ri, useDeferredValue: function(a) {
      var b = Uh();
      return null === N ? b.memoizedState = a : ui(b, N.memoizedState, a);
    }, useTransition: function() {
      var a = Xh(Vh)[0], b = Uh().memoizedState;
      return [a, b];
    }, useMutableSource: Yh, useSyncExternalStore: Zh, useId: wi, unstable_isNewReconciler: false };
    function Ci(a, b) {
      if (a && a.defaultProps) {
        b = A({}, b);
        a = a.defaultProps;
        for (var c in a) void 0 === b[c] && (b[c] = a[c]);
        return b;
      }
      return b;
    }
    function Di(a, b, c, d) {
      b = a.memoizedState;
      c = c(d, b);
      c = null === c || void 0 === c ? b : A({}, b, c);
      a.memoizedState = c;
      0 === a.lanes && (a.updateQueue.baseState = c);
    }
    var Ei = { isMounted: function(a) {
      return (a = a._reactInternals) ? Vb(a) === a : false;
    }, enqueueSetState: function(a, b, c) {
      a = a._reactInternals;
      var d = R(), e = yi(a), f = mh(d, e);
      f.payload = b;
      void 0 !== c && null !== c && (f.callback = c);
      b = nh(a, f, e);
      null !== b && (gi(b, a, e, d), oh(b, a, e));
    }, enqueueReplaceState: function(a, b, c) {
      a = a._reactInternals;
      var d = R(), e = yi(a), f = mh(d, e);
      f.tag = 1;
      f.payload = b;
      void 0 !== c && null !== c && (f.callback = c);
      b = nh(a, f, e);
      null !== b && (gi(b, a, e, d), oh(b, a, e));
    }, enqueueForceUpdate: function(a, b) {
      a = a._reactInternals;
      var c = R(), d = yi(a), e = mh(c, d);
      e.tag = 2;
      void 0 !== b && null !== b && (e.callback = b);
      b = nh(a, e, d);
      null !== b && (gi(b, a, d, c), oh(b, a, d));
    } };
    function Fi(a, b, c, d, e, f, g) {
      a = a.stateNode;
      return "function" === typeof a.shouldComponentUpdate ? a.shouldComponentUpdate(d, f, g) : b.prototype && b.prototype.isPureReactComponent ? !Ie(c, d) || !Ie(e, f) : true;
    }
    function Gi(a, b, c) {
      var d = false, e = Vf;
      var f = b.contextType;
      "object" === typeof f && null !== f ? f = eh(f) : (e = Zf(b) ? Xf : H.current, d = b.contextTypes, f = (d = null !== d && void 0 !== d) ? Yf(a, e) : Vf);
      b = new b(c, f);
      a.memoizedState = null !== b.state && void 0 !== b.state ? b.state : null;
      b.updater = Ei;
      a.stateNode = b;
      b._reactInternals = a;
      d && (a = a.stateNode, a.__reactInternalMemoizedUnmaskedChildContext = e, a.__reactInternalMemoizedMaskedChildContext = f);
      return b;
    }
    function Hi(a, b, c, d) {
      a = b.state;
      "function" === typeof b.componentWillReceiveProps && b.componentWillReceiveProps(c, d);
      "function" === typeof b.UNSAFE_componentWillReceiveProps && b.UNSAFE_componentWillReceiveProps(c, d);
      b.state !== a && Ei.enqueueReplaceState(b, b.state, null);
    }
    function Ii(a, b, c, d) {
      var e = a.stateNode;
      e.props = c;
      e.state = a.memoizedState;
      e.refs = {};
      kh(a);
      var f = b.contextType;
      "object" === typeof f && null !== f ? e.context = eh(f) : (f = Zf(b) ? Xf : H.current, e.context = Yf(a, f));
      e.state = a.memoizedState;
      f = b.getDerivedStateFromProps;
      "function" === typeof f && (Di(a, b, f, c), e.state = a.memoizedState);
      "function" === typeof b.getDerivedStateFromProps || "function" === typeof e.getSnapshotBeforeUpdate || "function" !== typeof e.UNSAFE_componentWillMount && "function" !== typeof e.componentWillMount || (b = e.state, "function" === typeof e.componentWillMount && e.componentWillMount(), "function" === typeof e.UNSAFE_componentWillMount && e.UNSAFE_componentWillMount(), b !== e.state && Ei.enqueueReplaceState(e, e.state, null), qh(a, c, e, d), e.state = a.memoizedState);
      "function" === typeof e.componentDidMount && (a.flags |= 4194308);
    }
    function Ji(a, b) {
      try {
        var c = "", d = b;
        do
          c += Pa(d), d = d.return;
        while (d);
        var e = c;
      } catch (f) {
        e = "\nError generating stack: " + f.message + "\n" + f.stack;
      }
      return { value: a, source: b, stack: e, digest: null };
    }
    function Ki(a, b, c) {
      return { value: a, source: null, stack: null != c ? c : null, digest: null != b ? b : null };
    }
    function Li(a, b) {
      try {
        console.error(b.value);
      } catch (c) {
        setTimeout(function() {
          throw c;
        });
      }
    }
    var Mi = "function" === typeof WeakMap ? WeakMap : Map;
    function Ni(a, b, c) {
      c = mh(-1, c);
      c.tag = 3;
      c.payload = { element: null };
      var d = b.value;
      c.callback = function() {
        Oi || (Oi = true, Pi = d);
        Li(a, b);
      };
      return c;
    }
    function Qi(a, b, c) {
      c = mh(-1, c);
      c.tag = 3;
      var d = a.type.getDerivedStateFromError;
      if ("function" === typeof d) {
        var e = b.value;
        c.payload = function() {
          return d(e);
        };
        c.callback = function() {
          Li(a, b);
        };
      }
      var f = a.stateNode;
      null !== f && "function" === typeof f.componentDidCatch && (c.callback = function() {
        Li(a, b);
        "function" !== typeof d && (null === Ri ? Ri = /* @__PURE__ */ new Set([this]) : Ri.add(this));
        var c2 = b.stack;
        this.componentDidCatch(b.value, { componentStack: null !== c2 ? c2 : "" });
      });
      return c;
    }
    function Si(a, b, c) {
      var d = a.pingCache;
      if (null === d) {
        d = a.pingCache = new Mi();
        var e = /* @__PURE__ */ new Set();
        d.set(b, e);
      } else e = d.get(b), void 0 === e && (e = /* @__PURE__ */ new Set(), d.set(b, e));
      e.has(c) || (e.add(c), a = Ti.bind(null, a, b, c), b.then(a, a));
    }
    function Ui(a) {
      do {
        var b;
        if (b = 13 === a.tag) b = a.memoizedState, b = null !== b ? null !== b.dehydrated ? true : false : true;
        if (b) return a;
        a = a.return;
      } while (null !== a);
      return null;
    }
    function Vi(a, b, c, d, e) {
      if (0 === (a.mode & 1)) return a === b ? a.flags |= 65536 : (a.flags |= 128, c.flags |= 131072, c.flags &= -52805, 1 === c.tag && (null === c.alternate ? c.tag = 17 : (b = mh(-1, 1), b.tag = 2, nh(c, b, 1))), c.lanes |= 1), a;
      a.flags |= 65536;
      a.lanes = e;
      return a;
    }
    var Wi = ua.ReactCurrentOwner;
    var dh = false;
    function Xi(a, b, c, d) {
      b.child = null === a ? Vg(b, null, c, d) : Ug(b, a.child, c, d);
    }
    function Yi(a, b, c, d, e) {
      c = c.render;
      var f = b.ref;
      ch(b, e);
      d = Nh(a, b, c, d, f, e);
      c = Sh();
      if (null !== a && !dh) return b.updateQueue = a.updateQueue, b.flags &= -2053, a.lanes &= ~e, Zi(a, b, e);
      I && c && vg(b);
      b.flags |= 1;
      Xi(a, b, d, e);
      return b.child;
    }
    function $i(a, b, c, d, e) {
      if (null === a) {
        var f = c.type;
        if ("function" === typeof f && !aj(f) && void 0 === f.defaultProps && null === c.compare && void 0 === c.defaultProps) return b.tag = 15, b.type = f, bj(a, b, f, d, e);
        a = Rg(c.type, null, d, b, b.mode, e);
        a.ref = b.ref;
        a.return = b;
        return b.child = a;
      }
      f = a.child;
      if (0 === (a.lanes & e)) {
        var g = f.memoizedProps;
        c = c.compare;
        c = null !== c ? c : Ie;
        if (c(g, d) && a.ref === b.ref) return Zi(a, b, e);
      }
      b.flags |= 1;
      a = Pg(f, d);
      a.ref = b.ref;
      a.return = b;
      return b.child = a;
    }
    function bj(a, b, c, d, e) {
      if (null !== a) {
        var f = a.memoizedProps;
        if (Ie(f, d) && a.ref === b.ref) if (dh = false, b.pendingProps = d = f, 0 !== (a.lanes & e)) 0 !== (a.flags & 131072) && (dh = true);
        else return b.lanes = a.lanes, Zi(a, b, e);
      }
      return cj(a, b, c, d, e);
    }
    function dj(a, b, c) {
      var d = b.pendingProps, e = d.children, f = null !== a ? a.memoizedState : null;
      if ("hidden" === d.mode) if (0 === (b.mode & 1)) b.memoizedState = { baseLanes: 0, cachePool: null, transitions: null }, G(ej, fj), fj |= c;
      else {
        if (0 === (c & 1073741824)) return a = null !== f ? f.baseLanes | c : c, b.lanes = b.childLanes = 1073741824, b.memoizedState = { baseLanes: a, cachePool: null, transitions: null }, b.updateQueue = null, G(ej, fj), fj |= a, null;
        b.memoizedState = { baseLanes: 0, cachePool: null, transitions: null };
        d = null !== f ? f.baseLanes : c;
        G(ej, fj);
        fj |= d;
      }
      else null !== f ? (d = f.baseLanes | c, b.memoizedState = null) : d = c, G(ej, fj), fj |= d;
      Xi(a, b, e, c);
      return b.child;
    }
    function gj(a, b) {
      var c = b.ref;
      if (null === a && null !== c || null !== a && a.ref !== c) b.flags |= 512, b.flags |= 2097152;
    }
    function cj(a, b, c, d, e) {
      var f = Zf(c) ? Xf : H.current;
      f = Yf(b, f);
      ch(b, e);
      c = Nh(a, b, c, d, f, e);
      d = Sh();
      if (null !== a && !dh) return b.updateQueue = a.updateQueue, b.flags &= -2053, a.lanes &= ~e, Zi(a, b, e);
      I && d && vg(b);
      b.flags |= 1;
      Xi(a, b, c, e);
      return b.child;
    }
    function hj(a, b, c, d, e) {
      if (Zf(c)) {
        var f = true;
        cg(b);
      } else f = false;
      ch(b, e);
      if (null === b.stateNode) ij(a, b), Gi(b, c, d), Ii(b, c, d, e), d = true;
      else if (null === a) {
        var g = b.stateNode, h2 = b.memoizedProps;
        g.props = h2;
        var k = g.context, l = c.contextType;
        "object" === typeof l && null !== l ? l = eh(l) : (l = Zf(c) ? Xf : H.current, l = Yf(b, l));
        var m = c.getDerivedStateFromProps, q = "function" === typeof m || "function" === typeof g.getSnapshotBeforeUpdate;
        q || "function" !== typeof g.UNSAFE_componentWillReceiveProps && "function" !== typeof g.componentWillReceiveProps || (h2 !== d || k !== l) && Hi(b, g, d, l);
        jh = false;
        var r = b.memoizedState;
        g.state = r;
        qh(b, d, g, e);
        k = b.memoizedState;
        h2 !== d || r !== k || Wf.current || jh ? ("function" === typeof m && (Di(b, c, m, d), k = b.memoizedState), (h2 = jh || Fi(b, c, h2, d, r, k, l)) ? (q || "function" !== typeof g.UNSAFE_componentWillMount && "function" !== typeof g.componentWillMount || ("function" === typeof g.componentWillMount && g.componentWillMount(), "function" === typeof g.UNSAFE_componentWillMount && g.UNSAFE_componentWillMount()), "function" === typeof g.componentDidMount && (b.flags |= 4194308)) : ("function" === typeof g.componentDidMount && (b.flags |= 4194308), b.memoizedProps = d, b.memoizedState = k), g.props = d, g.state = k, g.context = l, d = h2) : ("function" === typeof g.componentDidMount && (b.flags |= 4194308), d = false);
      } else {
        g = b.stateNode;
        lh(a, b);
        h2 = b.memoizedProps;
        l = b.type === b.elementType ? h2 : Ci(b.type, h2);
        g.props = l;
        q = b.pendingProps;
        r = g.context;
        k = c.contextType;
        "object" === typeof k && null !== k ? k = eh(k) : (k = Zf(c) ? Xf : H.current, k = Yf(b, k));
        var y = c.getDerivedStateFromProps;
        (m = "function" === typeof y || "function" === typeof g.getSnapshotBeforeUpdate) || "function" !== typeof g.UNSAFE_componentWillReceiveProps && "function" !== typeof g.componentWillReceiveProps || (h2 !== q || r !== k) && Hi(b, g, d, k);
        jh = false;
        r = b.memoizedState;
        g.state = r;
        qh(b, d, g, e);
        var n = b.memoizedState;
        h2 !== q || r !== n || Wf.current || jh ? ("function" === typeof y && (Di(b, c, y, d), n = b.memoizedState), (l = jh || Fi(b, c, l, d, r, n, k) || false) ? (m || "function" !== typeof g.UNSAFE_componentWillUpdate && "function" !== typeof g.componentWillUpdate || ("function" === typeof g.componentWillUpdate && g.componentWillUpdate(d, n, k), "function" === typeof g.UNSAFE_componentWillUpdate && g.UNSAFE_componentWillUpdate(d, n, k)), "function" === typeof g.componentDidUpdate && (b.flags |= 4), "function" === typeof g.getSnapshotBeforeUpdate && (b.flags |= 1024)) : ("function" !== typeof g.componentDidUpdate || h2 === a.memoizedProps && r === a.memoizedState || (b.flags |= 4), "function" !== typeof g.getSnapshotBeforeUpdate || h2 === a.memoizedProps && r === a.memoizedState || (b.flags |= 1024), b.memoizedProps = d, b.memoizedState = n), g.props = d, g.state = n, g.context = k, d = l) : ("function" !== typeof g.componentDidUpdate || h2 === a.memoizedProps && r === a.memoizedState || (b.flags |= 4), "function" !== typeof g.getSnapshotBeforeUpdate || h2 === a.memoizedProps && r === a.memoizedState || (b.flags |= 1024), d = false);
      }
      return jj(a, b, c, d, f, e);
    }
    function jj(a, b, c, d, e, f) {
      gj(a, b);
      var g = 0 !== (b.flags & 128);
      if (!d && !g) return e && dg(b, c, false), Zi(a, b, f);
      d = b.stateNode;
      Wi.current = b;
      var h2 = g && "function" !== typeof c.getDerivedStateFromError ? null : d.render();
      b.flags |= 1;
      null !== a && g ? (b.child = Ug(b, a.child, null, f), b.child = Ug(b, null, h2, f)) : Xi(a, b, h2, f);
      b.memoizedState = d.state;
      e && dg(b, c, true);
      return b.child;
    }
    function kj(a) {
      var b = a.stateNode;
      b.pendingContext ? ag(a, b.pendingContext, b.pendingContext !== b.context) : b.context && ag(a, b.context, false);
      yh(a, b.containerInfo);
    }
    function lj(a, b, c, d, e) {
      Ig();
      Jg(e);
      b.flags |= 256;
      Xi(a, b, c, d);
      return b.child;
    }
    var mj = { dehydrated: null, treeContext: null, retryLane: 0 };
    function nj(a) {
      return { baseLanes: a, cachePool: null, transitions: null };
    }
    function oj(a, b, c) {
      var d = b.pendingProps, e = L.current, f = false, g = 0 !== (b.flags & 128), h2;
      (h2 = g) || (h2 = null !== a && null === a.memoizedState ? false : 0 !== (e & 2));
      if (h2) f = true, b.flags &= -129;
      else if (null === a || null !== a.memoizedState) e |= 1;
      G(L, e & 1);
      if (null === a) {
        Eg(b);
        a = b.memoizedState;
        if (null !== a && (a = a.dehydrated, null !== a)) return 0 === (b.mode & 1) ? b.lanes = 1 : "$!" === a.data ? b.lanes = 8 : b.lanes = 1073741824, null;
        g = d.children;
        a = d.fallback;
        return f ? (d = b.mode, f = b.child, g = { mode: "hidden", children: g }, 0 === (d & 1) && null !== f ? (f.childLanes = 0, f.pendingProps = g) : f = pj(g, d, 0, null), a = Tg(a, d, c, null), f.return = b, a.return = b, f.sibling = a, b.child = f, b.child.memoizedState = nj(c), b.memoizedState = mj, a) : qj(b, g);
      }
      e = a.memoizedState;
      if (null !== e && (h2 = e.dehydrated, null !== h2)) return rj(a, b, g, d, h2, e, c);
      if (f) {
        f = d.fallback;
        g = b.mode;
        e = a.child;
        h2 = e.sibling;
        var k = { mode: "hidden", children: d.children };
        0 === (g & 1) && b.child !== e ? (d = b.child, d.childLanes = 0, d.pendingProps = k, b.deletions = null) : (d = Pg(e, k), d.subtreeFlags = e.subtreeFlags & 14680064);
        null !== h2 ? f = Pg(h2, f) : (f = Tg(f, g, c, null), f.flags |= 2);
        f.return = b;
        d.return = b;
        d.sibling = f;
        b.child = d;
        d = f;
        f = b.child;
        g = a.child.memoizedState;
        g = null === g ? nj(c) : { baseLanes: g.baseLanes | c, cachePool: null, transitions: g.transitions };
        f.memoizedState = g;
        f.childLanes = a.childLanes & ~c;
        b.memoizedState = mj;
        return d;
      }
      f = a.child;
      a = f.sibling;
      d = Pg(f, { mode: "visible", children: d.children });
      0 === (b.mode & 1) && (d.lanes = c);
      d.return = b;
      d.sibling = null;
      null !== a && (c = b.deletions, null === c ? (b.deletions = [a], b.flags |= 16) : c.push(a));
      b.child = d;
      b.memoizedState = null;
      return d;
    }
    function qj(a, b) {
      b = pj({ mode: "visible", children: b }, a.mode, 0, null);
      b.return = a;
      return a.child = b;
    }
    function sj(a, b, c, d) {
      null !== d && Jg(d);
      Ug(b, a.child, null, c);
      a = qj(b, b.pendingProps.children);
      a.flags |= 2;
      b.memoizedState = null;
      return a;
    }
    function rj(a, b, c, d, e, f, g) {
      if (c) {
        if (b.flags & 256) return b.flags &= -257, d = Ki(Error(p(422))), sj(a, b, g, d);
        if (null !== b.memoizedState) return b.child = a.child, b.flags |= 128, null;
        f = d.fallback;
        e = b.mode;
        d = pj({ mode: "visible", children: d.children }, e, 0, null);
        f = Tg(f, e, g, null);
        f.flags |= 2;
        d.return = b;
        f.return = b;
        d.sibling = f;
        b.child = d;
        0 !== (b.mode & 1) && Ug(b, a.child, null, g);
        b.child.memoizedState = nj(g);
        b.memoizedState = mj;
        return f;
      }
      if (0 === (b.mode & 1)) return sj(a, b, g, null);
      if ("$!" === e.data) {
        d = e.nextSibling && e.nextSibling.dataset;
        if (d) var h2 = d.dgst;
        d = h2;
        f = Error(p(419));
        d = Ki(f, d, void 0);
        return sj(a, b, g, d);
      }
      h2 = 0 !== (g & a.childLanes);
      if (dh || h2) {
        d = Q;
        if (null !== d) {
          switch (g & -g) {
            case 4:
              e = 2;
              break;
            case 16:
              e = 8;
              break;
            case 64:
            case 128:
            case 256:
            case 512:
            case 1024:
            case 2048:
            case 4096:
            case 8192:
            case 16384:
            case 32768:
            case 65536:
            case 131072:
            case 262144:
            case 524288:
            case 1048576:
            case 2097152:
            case 4194304:
            case 8388608:
            case 16777216:
            case 33554432:
            case 67108864:
              e = 32;
              break;
            case 536870912:
              e = 268435456;
              break;
            default:
              e = 0;
          }
          e = 0 !== (e & (d.suspendedLanes | g)) ? 0 : e;
          0 !== e && e !== f.retryLane && (f.retryLane = e, ih(a, e), gi(d, a, e, -1));
        }
        tj();
        d = Ki(Error(p(421)));
        return sj(a, b, g, d);
      }
      if ("$?" === e.data) return b.flags |= 128, b.child = a.child, b = uj.bind(null, a), e._reactRetry = b, null;
      a = f.treeContext;
      yg = Lf(e.nextSibling);
      xg = b;
      I = true;
      zg = null;
      null !== a && (og[pg++] = rg, og[pg++] = sg, og[pg++] = qg, rg = a.id, sg = a.overflow, qg = b);
      b = qj(b, d.children);
      b.flags |= 4096;
      return b;
    }
    function vj(a, b, c) {
      a.lanes |= b;
      var d = a.alternate;
      null !== d && (d.lanes |= b);
      bh(a.return, b, c);
    }
    function wj(a, b, c, d, e) {
      var f = a.memoizedState;
      null === f ? a.memoizedState = { isBackwards: b, rendering: null, renderingStartTime: 0, last: d, tail: c, tailMode: e } : (f.isBackwards = b, f.rendering = null, f.renderingStartTime = 0, f.last = d, f.tail = c, f.tailMode = e);
    }
    function xj(a, b, c) {
      var d = b.pendingProps, e = d.revealOrder, f = d.tail;
      Xi(a, b, d.children, c);
      d = L.current;
      if (0 !== (d & 2)) d = d & 1 | 2, b.flags |= 128;
      else {
        if (null !== a && 0 !== (a.flags & 128)) a: for (a = b.child; null !== a; ) {
          if (13 === a.tag) null !== a.memoizedState && vj(a, c, b);
          else if (19 === a.tag) vj(a, c, b);
          else if (null !== a.child) {
            a.child.return = a;
            a = a.child;
            continue;
          }
          if (a === b) break a;
          for (; null === a.sibling; ) {
            if (null === a.return || a.return === b) break a;
            a = a.return;
          }
          a.sibling.return = a.return;
          a = a.sibling;
        }
        d &= 1;
      }
      G(L, d);
      if (0 === (b.mode & 1)) b.memoizedState = null;
      else switch (e) {
        case "forwards":
          c = b.child;
          for (e = null; null !== c; ) a = c.alternate, null !== a && null === Ch(a) && (e = c), c = c.sibling;
          c = e;
          null === c ? (e = b.child, b.child = null) : (e = c.sibling, c.sibling = null);
          wj(b, false, e, c, f);
          break;
        case "backwards":
          c = null;
          e = b.child;
          for (b.child = null; null !== e; ) {
            a = e.alternate;
            if (null !== a && null === Ch(a)) {
              b.child = e;
              break;
            }
            a = e.sibling;
            e.sibling = c;
            c = e;
            e = a;
          }
          wj(b, true, c, null, f);
          break;
        case "together":
          wj(b, false, null, null, void 0);
          break;
        default:
          b.memoizedState = null;
      }
      return b.child;
    }
    function ij(a, b) {
      0 === (b.mode & 1) && null !== a && (a.alternate = null, b.alternate = null, b.flags |= 2);
    }
    function Zi(a, b, c) {
      null !== a && (b.dependencies = a.dependencies);
      rh |= b.lanes;
      if (0 === (c & b.childLanes)) return null;
      if (null !== a && b.child !== a.child) throw Error(p(153));
      if (null !== b.child) {
        a = b.child;
        c = Pg(a, a.pendingProps);
        b.child = c;
        for (c.return = b; null !== a.sibling; ) a = a.sibling, c = c.sibling = Pg(a, a.pendingProps), c.return = b;
        c.sibling = null;
      }
      return b.child;
    }
    function yj(a, b, c) {
      switch (b.tag) {
        case 3:
          kj(b);
          Ig();
          break;
        case 5:
          Ah(b);
          break;
        case 1:
          Zf(b.type) && cg(b);
          break;
        case 4:
          yh(b, b.stateNode.containerInfo);
          break;
        case 10:
          var d = b.type._context, e = b.memoizedProps.value;
          G(Wg, d._currentValue);
          d._currentValue = e;
          break;
        case 13:
          d = b.memoizedState;
          if (null !== d) {
            if (null !== d.dehydrated) return G(L, L.current & 1), b.flags |= 128, null;
            if (0 !== (c & b.child.childLanes)) return oj(a, b, c);
            G(L, L.current & 1);
            a = Zi(a, b, c);
            return null !== a ? a.sibling : null;
          }
          G(L, L.current & 1);
          break;
        case 19:
          d = 0 !== (c & b.childLanes);
          if (0 !== (a.flags & 128)) {
            if (d) return xj(a, b, c);
            b.flags |= 128;
          }
          e = b.memoizedState;
          null !== e && (e.rendering = null, e.tail = null, e.lastEffect = null);
          G(L, L.current);
          if (d) break;
          else return null;
        case 22:
        case 23:
          return b.lanes = 0, dj(a, b, c);
      }
      return Zi(a, b, c);
    }
    var zj;
    var Aj;
    var Bj;
    var Cj;
    zj = function(a, b) {
      for (var c = b.child; null !== c; ) {
        if (5 === c.tag || 6 === c.tag) a.appendChild(c.stateNode);
        else if (4 !== c.tag && null !== c.child) {
          c.child.return = c;
          c = c.child;
          continue;
        }
        if (c === b) break;
        for (; null === c.sibling; ) {
          if (null === c.return || c.return === b) return;
          c = c.return;
        }
        c.sibling.return = c.return;
        c = c.sibling;
      }
    };
    Aj = function() {
    };
    Bj = function(a, b, c, d) {
      var e = a.memoizedProps;
      if (e !== d) {
        a = b.stateNode;
        xh(uh.current);
        var f = null;
        switch (c) {
          case "input":
            e = Ya(a, e);
            d = Ya(a, d);
            f = [];
            break;
          case "select":
            e = A({}, e, { value: void 0 });
            d = A({}, d, { value: void 0 });
            f = [];
            break;
          case "textarea":
            e = gb(a, e);
            d = gb(a, d);
            f = [];
            break;
          default:
            "function" !== typeof e.onClick && "function" === typeof d.onClick && (a.onclick = Bf);
        }
        ub(c, d);
        var g;
        c = null;
        for (l in e) if (!d.hasOwnProperty(l) && e.hasOwnProperty(l) && null != e[l]) if ("style" === l) {
          var h2 = e[l];
          for (g in h2) h2.hasOwnProperty(g) && (c || (c = {}), c[g] = "");
        } else "dangerouslySetInnerHTML" !== l && "children" !== l && "suppressContentEditableWarning" !== l && "suppressHydrationWarning" !== l && "autoFocus" !== l && (ea.hasOwnProperty(l) ? f || (f = []) : (f = f || []).push(l, null));
        for (l in d) {
          var k = d[l];
          h2 = null != e ? e[l] : void 0;
          if (d.hasOwnProperty(l) && k !== h2 && (null != k || null != h2)) if ("style" === l) if (h2) {
            for (g in h2) !h2.hasOwnProperty(g) || k && k.hasOwnProperty(g) || (c || (c = {}), c[g] = "");
            for (g in k) k.hasOwnProperty(g) && h2[g] !== k[g] && (c || (c = {}), c[g] = k[g]);
          } else c || (f || (f = []), f.push(
            l,
            c
          )), c = k;
          else "dangerouslySetInnerHTML" === l ? (k = k ? k.__html : void 0, h2 = h2 ? h2.__html : void 0, null != k && h2 !== k && (f = f || []).push(l, k)) : "children" === l ? "string" !== typeof k && "number" !== typeof k || (f = f || []).push(l, "" + k) : "suppressContentEditableWarning" !== l && "suppressHydrationWarning" !== l && (ea.hasOwnProperty(l) ? (null != k && "onScroll" === l && D("scroll", a), f || h2 === k || (f = [])) : (f = f || []).push(l, k));
        }
        c && (f = f || []).push("style", c);
        var l = f;
        if (b.updateQueue = l) b.flags |= 4;
      }
    };
    Cj = function(a, b, c, d) {
      c !== d && (b.flags |= 4);
    };
    function Dj(a, b) {
      if (!I) switch (a.tailMode) {
        case "hidden":
          b = a.tail;
          for (var c = null; null !== b; ) null !== b.alternate && (c = b), b = b.sibling;
          null === c ? a.tail = null : c.sibling = null;
          break;
        case "collapsed":
          c = a.tail;
          for (var d = null; null !== c; ) null !== c.alternate && (d = c), c = c.sibling;
          null === d ? b || null === a.tail ? a.tail = null : a.tail.sibling = null : d.sibling = null;
      }
    }
    function S(a) {
      var b = null !== a.alternate && a.alternate.child === a.child, c = 0, d = 0;
      if (b) for (var e = a.child; null !== e; ) c |= e.lanes | e.childLanes, d |= e.subtreeFlags & 14680064, d |= e.flags & 14680064, e.return = a, e = e.sibling;
      else for (e = a.child; null !== e; ) c |= e.lanes | e.childLanes, d |= e.subtreeFlags, d |= e.flags, e.return = a, e = e.sibling;
      a.subtreeFlags |= d;
      a.childLanes = c;
      return b;
    }
    function Ej(a, b, c) {
      var d = b.pendingProps;
      wg(b);
      switch (b.tag) {
        case 2:
        case 16:
        case 15:
        case 0:
        case 11:
        case 7:
        case 8:
        case 12:
        case 9:
        case 14:
          return S(b), null;
        case 1:
          return Zf(b.type) && $f(), S(b), null;
        case 3:
          d = b.stateNode;
          zh();
          E(Wf);
          E(H);
          Eh();
          d.pendingContext && (d.context = d.pendingContext, d.pendingContext = null);
          if (null === a || null === a.child) Gg(b) ? b.flags |= 4 : null === a || a.memoizedState.isDehydrated && 0 === (b.flags & 256) || (b.flags |= 1024, null !== zg && (Fj(zg), zg = null));
          Aj(a, b);
          S(b);
          return null;
        case 5:
          Bh(b);
          var e = xh(wh.current);
          c = b.type;
          if (null !== a && null != b.stateNode) Bj(a, b, c, d, e), a.ref !== b.ref && (b.flags |= 512, b.flags |= 2097152);
          else {
            if (!d) {
              if (null === b.stateNode) throw Error(p(166));
              S(b);
              return null;
            }
            a = xh(uh.current);
            if (Gg(b)) {
              d = b.stateNode;
              c = b.type;
              var f = b.memoizedProps;
              d[Of] = b;
              d[Pf] = f;
              a = 0 !== (b.mode & 1);
              switch (c) {
                case "dialog":
                  D("cancel", d);
                  D("close", d);
                  break;
                case "iframe":
                case "object":
                case "embed":
                  D("load", d);
                  break;
                case "video":
                case "audio":
                  for (e = 0; e < lf.length; e++) D(lf[e], d);
                  break;
                case "source":
                  D("error", d);
                  break;
                case "img":
                case "image":
                case "link":
                  D(
                    "error",
                    d
                  );
                  D("load", d);
                  break;
                case "details":
                  D("toggle", d);
                  break;
                case "input":
                  Za(d, f);
                  D("invalid", d);
                  break;
                case "select":
                  d._wrapperState = { wasMultiple: !!f.multiple };
                  D("invalid", d);
                  break;
                case "textarea":
                  hb(d, f), D("invalid", d);
              }
              ub(c, f);
              e = null;
              for (var g in f) if (f.hasOwnProperty(g)) {
                var h2 = f[g];
                "children" === g ? "string" === typeof h2 ? d.textContent !== h2 && (true !== f.suppressHydrationWarning && Af(d.textContent, h2, a), e = ["children", h2]) : "number" === typeof h2 && d.textContent !== "" + h2 && (true !== f.suppressHydrationWarning && Af(
                  d.textContent,
                  h2,
                  a
                ), e = ["children", "" + h2]) : ea.hasOwnProperty(g) && null != h2 && "onScroll" === g && D("scroll", d);
              }
              switch (c) {
                case "input":
                  Va(d);
                  db(d, f, true);
                  break;
                case "textarea":
                  Va(d);
                  jb(d);
                  break;
                case "select":
                case "option":
                  break;
                default:
                  "function" === typeof f.onClick && (d.onclick = Bf);
              }
              d = e;
              b.updateQueue = d;
              null !== d && (b.flags |= 4);
            } else {
              g = 9 === e.nodeType ? e : e.ownerDocument;
              "http://www.w3.org/1999/xhtml" === a && (a = kb(c));
              "http://www.w3.org/1999/xhtml" === a ? "script" === c ? (a = g.createElement("div"), a.innerHTML = "<script></script>", a = a.removeChild(a.firstChild)) : "string" === typeof d.is ? a = g.createElement(c, { is: d.is }) : (a = g.createElement(c), "select" === c && (g = a, d.multiple ? g.multiple = true : d.size && (g.size = d.size))) : a = g.createElementNS(a, c);
              a[Of] = b;
              a[Pf] = d;
              zj(a, b, false, false);
              b.stateNode = a;
              a: {
                g = vb(c, d);
                switch (c) {
                  case "dialog":
                    D("cancel", a);
                    D("close", a);
                    e = d;
                    break;
                  case "iframe":
                  case "object":
                  case "embed":
                    D("load", a);
                    e = d;
                    break;
                  case "video":
                  case "audio":
                    for (e = 0; e < lf.length; e++) D(lf[e], a);
                    e = d;
                    break;
                  case "source":
                    D("error", a);
                    e = d;
                    break;
                  case "img":
                  case "image":
                  case "link":
                    D(
                      "error",
                      a
                    );
                    D("load", a);
                    e = d;
                    break;
                  case "details":
                    D("toggle", a);
                    e = d;
                    break;
                  case "input":
                    Za(a, d);
                    e = Ya(a, d);
                    D("invalid", a);
                    break;
                  case "option":
                    e = d;
                    break;
                  case "select":
                    a._wrapperState = { wasMultiple: !!d.multiple };
                    e = A({}, d, { value: void 0 });
                    D("invalid", a);
                    break;
                  case "textarea":
                    hb(a, d);
                    e = gb(a, d);
                    D("invalid", a);
                    break;
                  default:
                    e = d;
                }
                ub(c, e);
                h2 = e;
                for (f in h2) if (h2.hasOwnProperty(f)) {
                  var k = h2[f];
                  "style" === f ? sb(a, k) : "dangerouslySetInnerHTML" === f ? (k = k ? k.__html : void 0, null != k && nb(a, k)) : "children" === f ? "string" === typeof k ? ("textarea" !== c || "" !== k) && ob(a, k) : "number" === typeof k && ob(a, "" + k) : "suppressContentEditableWarning" !== f && "suppressHydrationWarning" !== f && "autoFocus" !== f && (ea.hasOwnProperty(f) ? null != k && "onScroll" === f && D("scroll", a) : null != k && ta(a, f, k, g));
                }
                switch (c) {
                  case "input":
                    Va(a);
                    db(a, d, false);
                    break;
                  case "textarea":
                    Va(a);
                    jb(a);
                    break;
                  case "option":
                    null != d.value && a.setAttribute("value", "" + Sa(d.value));
                    break;
                  case "select":
                    a.multiple = !!d.multiple;
                    f = d.value;
                    null != f ? fb(a, !!d.multiple, f, false) : null != d.defaultValue && fb(
                      a,
                      !!d.multiple,
                      d.defaultValue,
                      true
                    );
                    break;
                  default:
                    "function" === typeof e.onClick && (a.onclick = Bf);
                }
                switch (c) {
                  case "button":
                  case "input":
                  case "select":
                  case "textarea":
                    d = !!d.autoFocus;
                    break a;
                  case "img":
                    d = true;
                    break a;
                  default:
                    d = false;
                }
              }
              d && (b.flags |= 4);
            }
            null !== b.ref && (b.flags |= 512, b.flags |= 2097152);
          }
          S(b);
          return null;
        case 6:
          if (a && null != b.stateNode) Cj(a, b, a.memoizedProps, d);
          else {
            if ("string" !== typeof d && null === b.stateNode) throw Error(p(166));
            c = xh(wh.current);
            xh(uh.current);
            if (Gg(b)) {
              d = b.stateNode;
              c = b.memoizedProps;
              d[Of] = b;
              if (f = d.nodeValue !== c) {
                if (a = xg, null !== a) switch (a.tag) {
                  case 3:
                    Af(d.nodeValue, c, 0 !== (a.mode & 1));
                    break;
                  case 5:
                    true !== a.memoizedProps.suppressHydrationWarning && Af(d.nodeValue, c, 0 !== (a.mode & 1));
                }
              }
              f && (b.flags |= 4);
            } else d = (9 === c.nodeType ? c : c.ownerDocument).createTextNode(d), d[Of] = b, b.stateNode = d;
          }
          S(b);
          return null;
        case 13:
          E(L);
          d = b.memoizedState;
          if (null === a || null !== a.memoizedState && null !== a.memoizedState.dehydrated) {
            if (I && null !== yg && 0 !== (b.mode & 1) && 0 === (b.flags & 128)) Hg(), Ig(), b.flags |= 98560, f = false;
            else if (f = Gg(b), null !== d && null !== d.dehydrated) {
              if (null === a) {
                if (!f) throw Error(p(318));
                f = b.memoizedState;
                f = null !== f ? f.dehydrated : null;
                if (!f) throw Error(p(317));
                f[Of] = b;
              } else Ig(), 0 === (b.flags & 128) && (b.memoizedState = null), b.flags |= 4;
              S(b);
              f = false;
            } else null !== zg && (Fj(zg), zg = null), f = true;
            if (!f) return b.flags & 65536 ? b : null;
          }
          if (0 !== (b.flags & 128)) return b.lanes = c, b;
          d = null !== d;
          d !== (null !== a && null !== a.memoizedState) && d && (b.child.flags |= 8192, 0 !== (b.mode & 1) && (null === a || 0 !== (L.current & 1) ? 0 === T && (T = 3) : tj()));
          null !== b.updateQueue && (b.flags |= 4);
          S(b);
          return null;
        case 4:
          return zh(), Aj(a, b), null === a && sf(b.stateNode.containerInfo), S(b), null;
        case 10:
          return ah(b.type._context), S(b), null;
        case 17:
          return Zf(b.type) && $f(), S(b), null;
        case 19:
          E(L);
          f = b.memoizedState;
          if (null === f) return S(b), null;
          d = 0 !== (b.flags & 128);
          g = f.rendering;
          if (null === g) if (d) Dj(f, false);
          else {
            if (0 !== T || null !== a && 0 !== (a.flags & 128)) for (a = b.child; null !== a; ) {
              g = Ch(a);
              if (null !== g) {
                b.flags |= 128;
                Dj(f, false);
                d = g.updateQueue;
                null !== d && (b.updateQueue = d, b.flags |= 4);
                b.subtreeFlags = 0;
                d = c;
                for (c = b.child; null !== c; ) f = c, a = d, f.flags &= 14680066, g = f.alternate, null === g ? (f.childLanes = 0, f.lanes = a, f.child = null, f.subtreeFlags = 0, f.memoizedProps = null, f.memoizedState = null, f.updateQueue = null, f.dependencies = null, f.stateNode = null) : (f.childLanes = g.childLanes, f.lanes = g.lanes, f.child = g.child, f.subtreeFlags = 0, f.deletions = null, f.memoizedProps = g.memoizedProps, f.memoizedState = g.memoizedState, f.updateQueue = g.updateQueue, f.type = g.type, a = g.dependencies, f.dependencies = null === a ? null : { lanes: a.lanes, firstContext: a.firstContext }), c = c.sibling;
                G(L, L.current & 1 | 2);
                return b.child;
              }
              a = a.sibling;
            }
            null !== f.tail && B() > Gj && (b.flags |= 128, d = true, Dj(f, false), b.lanes = 4194304);
          }
          else {
            if (!d) if (a = Ch(g), null !== a) {
              if (b.flags |= 128, d = true, c = a.updateQueue, null !== c && (b.updateQueue = c, b.flags |= 4), Dj(f, true), null === f.tail && "hidden" === f.tailMode && !g.alternate && !I) return S(b), null;
            } else 2 * B() - f.renderingStartTime > Gj && 1073741824 !== c && (b.flags |= 128, d = true, Dj(f, false), b.lanes = 4194304);
            f.isBackwards ? (g.sibling = b.child, b.child = g) : (c = f.last, null !== c ? c.sibling = g : b.child = g, f.last = g);
          }
          if (null !== f.tail) return b = f.tail, f.rendering = b, f.tail = b.sibling, f.renderingStartTime = B(), b.sibling = null, c = L.current, G(L, d ? c & 1 | 2 : c & 1), b;
          S(b);
          return null;
        case 22:
        case 23:
          return Hj(), d = null !== b.memoizedState, null !== a && null !== a.memoizedState !== d && (b.flags |= 8192), d && 0 !== (b.mode & 1) ? 0 !== (fj & 1073741824) && (S(b), b.subtreeFlags & 6 && (b.flags |= 8192)) : S(b), null;
        case 24:
          return null;
        case 25:
          return null;
      }
      throw Error(p(156, b.tag));
    }
    function Ij(a, b) {
      wg(b);
      switch (b.tag) {
        case 1:
          return Zf(b.type) && $f(), a = b.flags, a & 65536 ? (b.flags = a & -65537 | 128, b) : null;
        case 3:
          return zh(), E(Wf), E(H), Eh(), a = b.flags, 0 !== (a & 65536) && 0 === (a & 128) ? (b.flags = a & -65537 | 128, b) : null;
        case 5:
          return Bh(b), null;
        case 13:
          E(L);
          a = b.memoizedState;
          if (null !== a && null !== a.dehydrated) {
            if (null === b.alternate) throw Error(p(340));
            Ig();
          }
          a = b.flags;
          return a & 65536 ? (b.flags = a & -65537 | 128, b) : null;
        case 19:
          return E(L), null;
        case 4:
          return zh(), null;
        case 10:
          return ah(b.type._context), null;
        case 22:
        case 23:
          return Hj(), null;
        case 24:
          return null;
        default:
          return null;
      }
    }
    var Jj = false;
    var U = false;
    var Kj = "function" === typeof WeakSet ? WeakSet : Set;
    var V = null;
    function Lj(a, b) {
      var c = a.ref;
      if (null !== c) if ("function" === typeof c) try {
        c(null);
      } catch (d) {
        W(a, b, d);
      }
      else c.current = null;
    }
    function Mj(a, b, c) {
      try {
        c();
      } catch (d) {
        W(a, b, d);
      }
    }
    var Nj = false;
    function Oj(a, b) {
      Cf = dd;
      a = Me();
      if (Ne(a)) {
        if ("selectionStart" in a) var c = { start: a.selectionStart, end: a.selectionEnd };
        else a: {
          c = (c = a.ownerDocument) && c.defaultView || window;
          var d = c.getSelection && c.getSelection();
          if (d && 0 !== d.rangeCount) {
            c = d.anchorNode;
            var e = d.anchorOffset, f = d.focusNode;
            d = d.focusOffset;
            try {
              c.nodeType, f.nodeType;
            } catch (F) {
              c = null;
              break a;
            }
            var g = 0, h2 = -1, k = -1, l = 0, m = 0, q = a, r = null;
            b: for (; ; ) {
              for (var y; ; ) {
                q !== c || 0 !== e && 3 !== q.nodeType || (h2 = g + e);
                q !== f || 0 !== d && 3 !== q.nodeType || (k = g + d);
                3 === q.nodeType && (g += q.nodeValue.length);
                if (null === (y = q.firstChild)) break;
                r = q;
                q = y;
              }
              for (; ; ) {
                if (q === a) break b;
                r === c && ++l === e && (h2 = g);
                r === f && ++m === d && (k = g);
                if (null !== (y = q.nextSibling)) break;
                q = r;
                r = q.parentNode;
              }
              q = y;
            }
            c = -1 === h2 || -1 === k ? null : { start: h2, end: k };
          } else c = null;
        }
        c = c || { start: 0, end: 0 };
      } else c = null;
      Df = { focusedElem: a, selectionRange: c };
      dd = false;
      for (V = b; null !== V; ) if (b = V, a = b.child, 0 !== (b.subtreeFlags & 1028) && null !== a) a.return = b, V = a;
      else for (; null !== V; ) {
        b = V;
        try {
          var n = b.alternate;
          if (0 !== (b.flags & 1024)) switch (b.tag) {
            case 0:
            case 11:
            case 15:
              break;
            case 1:
              if (null !== n) {
                var t = n.memoizedProps, J = n.memoizedState, x = b.stateNode, w = x.getSnapshotBeforeUpdate(b.elementType === b.type ? t : Ci(b.type, t), J);
                x.__reactInternalSnapshotBeforeUpdate = w;
              }
              break;
            case 3:
              var u = b.stateNode.containerInfo;
              1 === u.nodeType ? u.textContent = "" : 9 === u.nodeType && u.documentElement && u.removeChild(u.documentElement);
              break;
            case 5:
            case 6:
            case 4:
            case 17:
              break;
            default:
              throw Error(p(163));
          }
        } catch (F) {
          W(b, b.return, F);
        }
        a = b.sibling;
        if (null !== a) {
          a.return = b.return;
          V = a;
          break;
        }
        V = b.return;
      }
      n = Nj;
      Nj = false;
      return n;
    }
    function Pj(a, b, c) {
      var d = b.updateQueue;
      d = null !== d ? d.lastEffect : null;
      if (null !== d) {
        var e = d = d.next;
        do {
          if ((e.tag & a) === a) {
            var f = e.destroy;
            e.destroy = void 0;
            void 0 !== f && Mj(b, c, f);
          }
          e = e.next;
        } while (e !== d);
      }
    }
    function Qj(a, b) {
      b = b.updateQueue;
      b = null !== b ? b.lastEffect : null;
      if (null !== b) {
        var c = b = b.next;
        do {
          if ((c.tag & a) === a) {
            var d = c.create;
            c.destroy = d();
          }
          c = c.next;
        } while (c !== b);
      }
    }
    function Rj(a) {
      var b = a.ref;
      if (null !== b) {
        var c = a.stateNode;
        switch (a.tag) {
          case 5:
            a = c;
            break;
          default:
            a = c;
        }
        "function" === typeof b ? b(a) : b.current = a;
      }
    }
    function Sj(a) {
      var b = a.alternate;
      null !== b && (a.alternate = null, Sj(b));
      a.child = null;
      a.deletions = null;
      a.sibling = null;
      5 === a.tag && (b = a.stateNode, null !== b && (delete b[Of], delete b[Pf], delete b[of], delete b[Qf], delete b[Rf]));
      a.stateNode = null;
      a.return = null;
      a.dependencies = null;
      a.memoizedProps = null;
      a.memoizedState = null;
      a.pendingProps = null;
      a.stateNode = null;
      a.updateQueue = null;
    }
    function Tj(a) {
      return 5 === a.tag || 3 === a.tag || 4 === a.tag;
    }
    function Uj(a) {
      a: for (; ; ) {
        for (; null === a.sibling; ) {
          if (null === a.return || Tj(a.return)) return null;
          a = a.return;
        }
        a.sibling.return = a.return;
        for (a = a.sibling; 5 !== a.tag && 6 !== a.tag && 18 !== a.tag; ) {
          if (a.flags & 2) continue a;
          if (null === a.child || 4 === a.tag) continue a;
          else a.child.return = a, a = a.child;
        }
        if (!(a.flags & 2)) return a.stateNode;
      }
    }
    function Vj(a, b, c) {
      var d = a.tag;
      if (5 === d || 6 === d) a = a.stateNode, b ? 8 === c.nodeType ? c.parentNode.insertBefore(a, b) : c.insertBefore(a, b) : (8 === c.nodeType ? (b = c.parentNode, b.insertBefore(a, c)) : (b = c, b.appendChild(a)), c = c._reactRootContainer, null !== c && void 0 !== c || null !== b.onclick || (b.onclick = Bf));
      else if (4 !== d && (a = a.child, null !== a)) for (Vj(a, b, c), a = a.sibling; null !== a; ) Vj(a, b, c), a = a.sibling;
    }
    function Wj(a, b, c) {
      var d = a.tag;
      if (5 === d || 6 === d) a = a.stateNode, b ? c.insertBefore(a, b) : c.appendChild(a);
      else if (4 !== d && (a = a.child, null !== a)) for (Wj(a, b, c), a = a.sibling; null !== a; ) Wj(a, b, c), a = a.sibling;
    }
    var X = null;
    var Xj = false;
    function Yj(a, b, c) {
      for (c = c.child; null !== c; ) Zj(a, b, c), c = c.sibling;
    }
    function Zj(a, b, c) {
      if (lc && "function" === typeof lc.onCommitFiberUnmount) try {
        lc.onCommitFiberUnmount(kc, c);
      } catch (h2) {
      }
      switch (c.tag) {
        case 5:
          U || Lj(c, b);
        case 6:
          var d = X, e = Xj;
          X = null;
          Yj(a, b, c);
          X = d;
          Xj = e;
          null !== X && (Xj ? (a = X, c = c.stateNode, 8 === a.nodeType ? a.parentNode.removeChild(c) : a.removeChild(c)) : X.removeChild(c.stateNode));
          break;
        case 18:
          null !== X && (Xj ? (a = X, c = c.stateNode, 8 === a.nodeType ? Kf(a.parentNode, c) : 1 === a.nodeType && Kf(a, c), bd(a)) : Kf(X, c.stateNode));
          break;
        case 4:
          d = X;
          e = Xj;
          X = c.stateNode.containerInfo;
          Xj = true;
          Yj(a, b, c);
          X = d;
          Xj = e;
          break;
        case 0:
        case 11:
        case 14:
        case 15:
          if (!U && (d = c.updateQueue, null !== d && (d = d.lastEffect, null !== d))) {
            e = d = d.next;
            do {
              var f = e, g = f.destroy;
              f = f.tag;
              void 0 !== g && (0 !== (f & 2) ? Mj(c, b, g) : 0 !== (f & 4) && Mj(c, b, g));
              e = e.next;
            } while (e !== d);
          }
          Yj(a, b, c);
          break;
        case 1:
          if (!U && (Lj(c, b), d = c.stateNode, "function" === typeof d.componentWillUnmount)) try {
            d.props = c.memoizedProps, d.state = c.memoizedState, d.componentWillUnmount();
          } catch (h2) {
            W(c, b, h2);
          }
          Yj(a, b, c);
          break;
        case 21:
          Yj(a, b, c);
          break;
        case 22:
          c.mode & 1 ? (U = (d = U) || null !== c.memoizedState, Yj(a, b, c), U = d) : Yj(a, b, c);
          break;
        default:
          Yj(a, b, c);
      }
    }
    function ak(a) {
      var b = a.updateQueue;
      if (null !== b) {
        a.updateQueue = null;
        var c = a.stateNode;
        null === c && (c = a.stateNode = new Kj());
        b.forEach(function(b2) {
          var d = bk.bind(null, a, b2);
          c.has(b2) || (c.add(b2), b2.then(d, d));
        });
      }
    }
    function ck(a, b) {
      var c = b.deletions;
      if (null !== c) for (var d = 0; d < c.length; d++) {
        var e = c[d];
        try {
          var f = a, g = b, h2 = g;
          a: for (; null !== h2; ) {
            switch (h2.tag) {
              case 5:
                X = h2.stateNode;
                Xj = false;
                break a;
              case 3:
                X = h2.stateNode.containerInfo;
                Xj = true;
                break a;
              case 4:
                X = h2.stateNode.containerInfo;
                Xj = true;
                break a;
            }
            h2 = h2.return;
          }
          if (null === X) throw Error(p(160));
          Zj(f, g, e);
          X = null;
          Xj = false;
          var k = e.alternate;
          null !== k && (k.return = null);
          e.return = null;
        } catch (l) {
          W(e, b, l);
        }
      }
      if (b.subtreeFlags & 12854) for (b = b.child; null !== b; ) dk(b, a), b = b.sibling;
    }
    function dk(a, b) {
      var c = a.alternate, d = a.flags;
      switch (a.tag) {
        case 0:
        case 11:
        case 14:
        case 15:
          ck(b, a);
          ek(a);
          if (d & 4) {
            try {
              Pj(3, a, a.return), Qj(3, a);
            } catch (t) {
              W(a, a.return, t);
            }
            try {
              Pj(5, a, a.return);
            } catch (t) {
              W(a, a.return, t);
            }
          }
          break;
        case 1:
          ck(b, a);
          ek(a);
          d & 512 && null !== c && Lj(c, c.return);
          break;
        case 5:
          ck(b, a);
          ek(a);
          d & 512 && null !== c && Lj(c, c.return);
          if (a.flags & 32) {
            var e = a.stateNode;
            try {
              ob(e, "");
            } catch (t) {
              W(a, a.return, t);
            }
          }
          if (d & 4 && (e = a.stateNode, null != e)) {
            var f = a.memoizedProps, g = null !== c ? c.memoizedProps : f, h2 = a.type, k = a.updateQueue;
            a.updateQueue = null;
            if (null !== k) try {
              "input" === h2 && "radio" === f.type && null != f.name && ab(e, f);
              vb(h2, g);
              var l = vb(h2, f);
              for (g = 0; g < k.length; g += 2) {
                var m = k[g], q = k[g + 1];
                "style" === m ? sb(e, q) : "dangerouslySetInnerHTML" === m ? nb(e, q) : "children" === m ? ob(e, q) : ta(e, m, q, l);
              }
              switch (h2) {
                case "input":
                  bb(e, f);
                  break;
                case "textarea":
                  ib(e, f);
                  break;
                case "select":
                  var r = e._wrapperState.wasMultiple;
                  e._wrapperState.wasMultiple = !!f.multiple;
                  var y = f.value;
                  null != y ? fb(e, !!f.multiple, y, false) : r !== !!f.multiple && (null != f.defaultValue ? fb(
                    e,
                    !!f.multiple,
                    f.defaultValue,
                    true
                  ) : fb(e, !!f.multiple, f.multiple ? [] : "", false));
              }
              e[Pf] = f;
            } catch (t) {
              W(a, a.return, t);
            }
          }
          break;
        case 6:
          ck(b, a);
          ek(a);
          if (d & 4) {
            if (null === a.stateNode) throw Error(p(162));
            e = a.stateNode;
            f = a.memoizedProps;
            try {
              e.nodeValue = f;
            } catch (t) {
              W(a, a.return, t);
            }
          }
          break;
        case 3:
          ck(b, a);
          ek(a);
          if (d & 4 && null !== c && c.memoizedState.isDehydrated) try {
            bd(b.containerInfo);
          } catch (t) {
            W(a, a.return, t);
          }
          break;
        case 4:
          ck(b, a);
          ek(a);
          break;
        case 13:
          ck(b, a);
          ek(a);
          e = a.child;
          e.flags & 8192 && (f = null !== e.memoizedState, e.stateNode.isHidden = f, !f || null !== e.alternate && null !== e.alternate.memoizedState || (fk = B()));
          d & 4 && ak(a);
          break;
        case 22:
          m = null !== c && null !== c.memoizedState;
          a.mode & 1 ? (U = (l = U) || m, ck(b, a), U = l) : ck(b, a);
          ek(a);
          if (d & 8192) {
            l = null !== a.memoizedState;
            if ((a.stateNode.isHidden = l) && !m && 0 !== (a.mode & 1)) for (V = a, m = a.child; null !== m; ) {
              for (q = V = m; null !== V; ) {
                r = V;
                y = r.child;
                switch (r.tag) {
                  case 0:
                  case 11:
                  case 14:
                  case 15:
                    Pj(4, r, r.return);
                    break;
                  case 1:
                    Lj(r, r.return);
                    var n = r.stateNode;
                    if ("function" === typeof n.componentWillUnmount) {
                      d = r;
                      c = r.return;
                      try {
                        b = d, n.props = b.memoizedProps, n.state = b.memoizedState, n.componentWillUnmount();
                      } catch (t) {
                        W(d, c, t);
                      }
                    }
                    break;
                  case 5:
                    Lj(r, r.return);
                    break;
                  case 22:
                    if (null !== r.memoizedState) {
                      gk(q);
                      continue;
                    }
                }
                null !== y ? (y.return = r, V = y) : gk(q);
              }
              m = m.sibling;
            }
            a: for (m = null, q = a; ; ) {
              if (5 === q.tag) {
                if (null === m) {
                  m = q;
                  try {
                    e = q.stateNode, l ? (f = e.style, "function" === typeof f.setProperty ? f.setProperty("display", "none", "important") : f.display = "none") : (h2 = q.stateNode, k = q.memoizedProps.style, g = void 0 !== k && null !== k && k.hasOwnProperty("display") ? k.display : null, h2.style.display = rb("display", g));
                  } catch (t) {
                    W(a, a.return, t);
                  }
                }
              } else if (6 === q.tag) {
                if (null === m) try {
                  q.stateNode.nodeValue = l ? "" : q.memoizedProps;
                } catch (t) {
                  W(a, a.return, t);
                }
              } else if ((22 !== q.tag && 23 !== q.tag || null === q.memoizedState || q === a) && null !== q.child) {
                q.child.return = q;
                q = q.child;
                continue;
              }
              if (q === a) break a;
              for (; null === q.sibling; ) {
                if (null === q.return || q.return === a) break a;
                m === q && (m = null);
                q = q.return;
              }
              m === q && (m = null);
              q.sibling.return = q.return;
              q = q.sibling;
            }
          }
          break;
        case 19:
          ck(b, a);
          ek(a);
          d & 4 && ak(a);
          break;
        case 21:
          break;
        default:
          ck(
            b,
            a
          ), ek(a);
      }
    }
    function ek(a) {
      var b = a.flags;
      if (b & 2) {
        try {
          a: {
            for (var c = a.return; null !== c; ) {
              if (Tj(c)) {
                var d = c;
                break a;
              }
              c = c.return;
            }
            throw Error(p(160));
          }
          switch (d.tag) {
            case 5:
              var e = d.stateNode;
              d.flags & 32 && (ob(e, ""), d.flags &= -33);
              var f = Uj(a);
              Wj(a, f, e);
              break;
            case 3:
            case 4:
              var g = d.stateNode.containerInfo, h2 = Uj(a);
              Vj(a, h2, g);
              break;
            default:
              throw Error(p(161));
          }
        } catch (k) {
          W(a, a.return, k);
        }
        a.flags &= -3;
      }
      b & 4096 && (a.flags &= -4097);
    }
    function hk(a, b, c) {
      V = a;
      ik(a, b, c);
    }
    function ik(a, b, c) {
      for (var d = 0 !== (a.mode & 1); null !== V; ) {
        var e = V, f = e.child;
        if (22 === e.tag && d) {
          var g = null !== e.memoizedState || Jj;
          if (!g) {
            var h2 = e.alternate, k = null !== h2 && null !== h2.memoizedState || U;
            h2 = Jj;
            var l = U;
            Jj = g;
            if ((U = k) && !l) for (V = e; null !== V; ) g = V, k = g.child, 22 === g.tag && null !== g.memoizedState ? jk(e) : null !== k ? (k.return = g, V = k) : jk(e);
            for (; null !== f; ) V = f, ik(f, b, c), f = f.sibling;
            V = e;
            Jj = h2;
            U = l;
          }
          kk(a, b, c);
        } else 0 !== (e.subtreeFlags & 8772) && null !== f ? (f.return = e, V = f) : kk(a, b, c);
      }
    }
    function kk(a) {
      for (; null !== V; ) {
        var b = V;
        if (0 !== (b.flags & 8772)) {
          var c = b.alternate;
          try {
            if (0 !== (b.flags & 8772)) switch (b.tag) {
              case 0:
              case 11:
              case 15:
                U || Qj(5, b);
                break;
              case 1:
                var d = b.stateNode;
                if (b.flags & 4 && !U) if (null === c) d.componentDidMount();
                else {
                  var e = b.elementType === b.type ? c.memoizedProps : Ci(b.type, c.memoizedProps);
                  d.componentDidUpdate(e, c.memoizedState, d.__reactInternalSnapshotBeforeUpdate);
                }
                var f = b.updateQueue;
                null !== f && sh(b, f, d);
                break;
              case 3:
                var g = b.updateQueue;
                if (null !== g) {
                  c = null;
                  if (null !== b.child) switch (b.child.tag) {
                    case 5:
                      c = b.child.stateNode;
                      break;
                    case 1:
                      c = b.child.stateNode;
                  }
                  sh(b, g, c);
                }
                break;
              case 5:
                var h2 = b.stateNode;
                if (null === c && b.flags & 4) {
                  c = h2;
                  var k = b.memoizedProps;
                  switch (b.type) {
                    case "button":
                    case "input":
                    case "select":
                    case "textarea":
                      k.autoFocus && c.focus();
                      break;
                    case "img":
                      k.src && (c.src = k.src);
                  }
                }
                break;
              case 6:
                break;
              case 4:
                break;
              case 12:
                break;
              case 13:
                if (null === b.memoizedState) {
                  var l = b.alternate;
                  if (null !== l) {
                    var m = l.memoizedState;
                    if (null !== m) {
                      var q = m.dehydrated;
                      null !== q && bd(q);
                    }
                  }
                }
                break;
              case 19:
              case 17:
              case 21:
              case 22:
              case 23:
              case 25:
                break;
              default:
                throw Error(p(163));
            }
            U || b.flags & 512 && Rj(b);
          } catch (r) {
            W(b, b.return, r);
          }
        }
        if (b === a) {
          V = null;
          break;
        }
        c = b.sibling;
        if (null !== c) {
          c.return = b.return;
          V = c;
          break;
        }
        V = b.return;
      }
    }
    function gk(a) {
      for (; null !== V; ) {
        var b = V;
        if (b === a) {
          V = null;
          break;
        }
        var c = b.sibling;
        if (null !== c) {
          c.return = b.return;
          V = c;
          break;
        }
        V = b.return;
      }
    }
    function jk(a) {
      for (; null !== V; ) {
        var b = V;
        try {
          switch (b.tag) {
            case 0:
            case 11:
            case 15:
              var c = b.return;
              try {
                Qj(4, b);
              } catch (k) {
                W(b, c, k);
              }
              break;
            case 1:
              var d = b.stateNode;
              if ("function" === typeof d.componentDidMount) {
                var e = b.return;
                try {
                  d.componentDidMount();
                } catch (k) {
                  W(b, e, k);
                }
              }
              var f = b.return;
              try {
                Rj(b);
              } catch (k) {
                W(b, f, k);
              }
              break;
            case 5:
              var g = b.return;
              try {
                Rj(b);
              } catch (k) {
                W(b, g, k);
              }
          }
        } catch (k) {
          W(b, b.return, k);
        }
        if (b === a) {
          V = null;
          break;
        }
        var h2 = b.sibling;
        if (null !== h2) {
          h2.return = b.return;
          V = h2;
          break;
        }
        V = b.return;
      }
    }
    var lk = Math.ceil;
    var mk = ua.ReactCurrentDispatcher;
    var nk = ua.ReactCurrentOwner;
    var ok = ua.ReactCurrentBatchConfig;
    var K = 0;
    var Q = null;
    var Y = null;
    var Z = 0;
    var fj = 0;
    var ej = Uf(0);
    var T = 0;
    var pk = null;
    var rh = 0;
    var qk = 0;
    var rk = 0;
    var sk = null;
    var tk = null;
    var fk = 0;
    var Gj = Infinity;
    var uk = null;
    var Oi = false;
    var Pi = null;
    var Ri = null;
    var vk = false;
    var wk = null;
    var xk = 0;
    var yk = 0;
    var zk = null;
    var Ak = -1;
    var Bk = 0;
    function R() {
      return 0 !== (K & 6) ? B() : -1 !== Ak ? Ak : Ak = B();
    }
    function yi(a) {
      if (0 === (a.mode & 1)) return 1;
      if (0 !== (K & 2) && 0 !== Z) return Z & -Z;
      if (null !== Kg.transition) return 0 === Bk && (Bk = yc()), Bk;
      a = C;
      if (0 !== a) return a;
      a = window.event;
      a = void 0 === a ? 16 : jd(a.type);
      return a;
    }
    function gi(a, b, c, d) {
      if (50 < yk) throw yk = 0, zk = null, Error(p(185));
      Ac(a, c, d);
      if (0 === (K & 2) || a !== Q) a === Q && (0 === (K & 2) && (qk |= c), 4 === T && Ck(a, Z)), Dk(a, d), 1 === c && 0 === K && 0 === (b.mode & 1) && (Gj = B() + 500, fg && jg());
    }
    function Dk(a, b) {
      var c = a.callbackNode;
      wc(a, b);
      var d = uc(a, a === Q ? Z : 0);
      if (0 === d) null !== c && bc(c), a.callbackNode = null, a.callbackPriority = 0;
      else if (b = d & -d, a.callbackPriority !== b) {
        null != c && bc(c);
        if (1 === b) 0 === a.tag ? ig(Ek.bind(null, a)) : hg(Ek.bind(null, a)), Jf(function() {
          0 === (K & 6) && jg();
        }), c = null;
        else {
          switch (Dc(d)) {
            case 1:
              c = fc;
              break;
            case 4:
              c = gc;
              break;
            case 16:
              c = hc;
              break;
            case 536870912:
              c = jc;
              break;
            default:
              c = hc;
          }
          c = Fk(c, Gk.bind(null, a));
        }
        a.callbackPriority = b;
        a.callbackNode = c;
      }
    }
    function Gk(a, b) {
      Ak = -1;
      Bk = 0;
      if (0 !== (K & 6)) throw Error(p(327));
      var c = a.callbackNode;
      if (Hk() && a.callbackNode !== c) return null;
      var d = uc(a, a === Q ? Z : 0);
      if (0 === d) return null;
      if (0 !== (d & 30) || 0 !== (d & a.expiredLanes) || b) b = Ik(a, d);
      else {
        b = d;
        var e = K;
        K |= 2;
        var f = Jk();
        if (Q !== a || Z !== b) uk = null, Gj = B() + 500, Kk(a, b);
        do
          try {
            Lk();
            break;
          } catch (h2) {
            Mk(a, h2);
          }
        while (1);
        $g();
        mk.current = f;
        K = e;
        null !== Y ? b = 0 : (Q = null, Z = 0, b = T);
      }
      if (0 !== b) {
        2 === b && (e = xc(a), 0 !== e && (d = e, b = Nk(a, e)));
        if (1 === b) throw c = pk, Kk(a, 0), Ck(a, d), Dk(a, B()), c;
        if (6 === b) Ck(a, d);
        else {
          e = a.current.alternate;
          if (0 === (d & 30) && !Ok(e) && (b = Ik(a, d), 2 === b && (f = xc(a), 0 !== f && (d = f, b = Nk(a, f))), 1 === b)) throw c = pk, Kk(a, 0), Ck(a, d), Dk(a, B()), c;
          a.finishedWork = e;
          a.finishedLanes = d;
          switch (b) {
            case 0:
            case 1:
              throw Error(p(345));
            case 2:
              Pk(a, tk, uk);
              break;
            case 3:
              Ck(a, d);
              if ((d & 130023424) === d && (b = fk + 500 - B(), 10 < b)) {
                if (0 !== uc(a, 0)) break;
                e = a.suspendedLanes;
                if ((e & d) !== d) {
                  R();
                  a.pingedLanes |= a.suspendedLanes & e;
                  break;
                }
                a.timeoutHandle = Ff(Pk.bind(null, a, tk, uk), b);
                break;
              }
              Pk(a, tk, uk);
              break;
            case 4:
              Ck(a, d);
              if ((d & 4194240) === d) break;
              b = a.eventTimes;
              for (e = -1; 0 < d; ) {
                var g = 31 - oc(d);
                f = 1 << g;
                g = b[g];
                g > e && (e = g);
                d &= ~f;
              }
              d = e;
              d = B() - d;
              d = (120 > d ? 120 : 480 > d ? 480 : 1080 > d ? 1080 : 1920 > d ? 1920 : 3e3 > d ? 3e3 : 4320 > d ? 4320 : 1960 * lk(d / 1960)) - d;
              if (10 < d) {
                a.timeoutHandle = Ff(Pk.bind(null, a, tk, uk), d);
                break;
              }
              Pk(a, tk, uk);
              break;
            case 5:
              Pk(a, tk, uk);
              break;
            default:
              throw Error(p(329));
          }
        }
      }
      Dk(a, B());
      return a.callbackNode === c ? Gk.bind(null, a) : null;
    }
    function Nk(a, b) {
      var c = sk;
      a.current.memoizedState.isDehydrated && (Kk(a, b).flags |= 256);
      a = Ik(a, b);
      2 !== a && (b = tk, tk = c, null !== b && Fj(b));
      return a;
    }
    function Fj(a) {
      null === tk ? tk = a : tk.push.apply(tk, a);
    }
    function Ok(a) {
      for (var b = a; ; ) {
        if (b.flags & 16384) {
          var c = b.updateQueue;
          if (null !== c && (c = c.stores, null !== c)) for (var d = 0; d < c.length; d++) {
            var e = c[d], f = e.getSnapshot;
            e = e.value;
            try {
              if (!He(f(), e)) return false;
            } catch (g) {
              return false;
            }
          }
        }
        c = b.child;
        if (b.subtreeFlags & 16384 && null !== c) c.return = b, b = c;
        else {
          if (b === a) break;
          for (; null === b.sibling; ) {
            if (null === b.return || b.return === a) return true;
            b = b.return;
          }
          b.sibling.return = b.return;
          b = b.sibling;
        }
      }
      return true;
    }
    function Ck(a, b) {
      b &= ~rk;
      b &= ~qk;
      a.suspendedLanes |= b;
      a.pingedLanes &= ~b;
      for (a = a.expirationTimes; 0 < b; ) {
        var c = 31 - oc(b), d = 1 << c;
        a[c] = -1;
        b &= ~d;
      }
    }
    function Ek(a) {
      if (0 !== (K & 6)) throw Error(p(327));
      Hk();
      var b = uc(a, 0);
      if (0 === (b & 1)) return Dk(a, B()), null;
      var c = Ik(a, b);
      if (0 !== a.tag && 2 === c) {
        var d = xc(a);
        0 !== d && (b = d, c = Nk(a, d));
      }
      if (1 === c) throw c = pk, Kk(a, 0), Ck(a, b), Dk(a, B()), c;
      if (6 === c) throw Error(p(345));
      a.finishedWork = a.current.alternate;
      a.finishedLanes = b;
      Pk(a, tk, uk);
      Dk(a, B());
      return null;
    }
    function Qk(a, b) {
      var c = K;
      K |= 1;
      try {
        return a(b);
      } finally {
        K = c, 0 === K && (Gj = B() + 500, fg && jg());
      }
    }
    function Rk(a) {
      null !== wk && 0 === wk.tag && 0 === (K & 6) && Hk();
      var b = K;
      K |= 1;
      var c = ok.transition, d = C;
      try {
        if (ok.transition = null, C = 1, a) return a();
      } finally {
        C = d, ok.transition = c, K = b, 0 === (K & 6) && jg();
      }
    }
    function Hj() {
      fj = ej.current;
      E(ej);
    }
    function Kk(a, b) {
      a.finishedWork = null;
      a.finishedLanes = 0;
      var c = a.timeoutHandle;
      -1 !== c && (a.timeoutHandle = -1, Gf(c));
      if (null !== Y) for (c = Y.return; null !== c; ) {
        var d = c;
        wg(d);
        switch (d.tag) {
          case 1:
            d = d.type.childContextTypes;
            null !== d && void 0 !== d && $f();
            break;
          case 3:
            zh();
            E(Wf);
            E(H);
            Eh();
            break;
          case 5:
            Bh(d);
            break;
          case 4:
            zh();
            break;
          case 13:
            E(L);
            break;
          case 19:
            E(L);
            break;
          case 10:
            ah(d.type._context);
            break;
          case 22:
          case 23:
            Hj();
        }
        c = c.return;
      }
      Q = a;
      Y = a = Pg(a.current, null);
      Z = fj = b;
      T = 0;
      pk = null;
      rk = qk = rh = 0;
      tk = sk = null;
      if (null !== fh) {
        for (b = 0; b < fh.length; b++) if (c = fh[b], d = c.interleaved, null !== d) {
          c.interleaved = null;
          var e = d.next, f = c.pending;
          if (null !== f) {
            var g = f.next;
            f.next = e;
            d.next = g;
          }
          c.pending = d;
        }
        fh = null;
      }
      return a;
    }
    function Mk(a, b) {
      do {
        var c = Y;
        try {
          $g();
          Fh.current = Rh;
          if (Ih) {
            for (var d = M.memoizedState; null !== d; ) {
              var e = d.queue;
              null !== e && (e.pending = null);
              d = d.next;
            }
            Ih = false;
          }
          Hh = 0;
          O = N = M = null;
          Jh = false;
          Kh = 0;
          nk.current = null;
          if (null === c || null === c.return) {
            T = 1;
            pk = b;
            Y = null;
            break;
          }
          a: {
            var f = a, g = c.return, h2 = c, k = b;
            b = Z;
            h2.flags |= 32768;
            if (null !== k && "object" === typeof k && "function" === typeof k.then) {
              var l = k, m = h2, q = m.tag;
              if (0 === (m.mode & 1) && (0 === q || 11 === q || 15 === q)) {
                var r = m.alternate;
                r ? (m.updateQueue = r.updateQueue, m.memoizedState = r.memoizedState, m.lanes = r.lanes) : (m.updateQueue = null, m.memoizedState = null);
              }
              var y = Ui(g);
              if (null !== y) {
                y.flags &= -257;
                Vi(y, g, h2, f, b);
                y.mode & 1 && Si(f, l, b);
                b = y;
                k = l;
                var n = b.updateQueue;
                if (null === n) {
                  var t = /* @__PURE__ */ new Set();
                  t.add(k);
                  b.updateQueue = t;
                } else n.add(k);
                break a;
              } else {
                if (0 === (b & 1)) {
                  Si(f, l, b);
                  tj();
                  break a;
                }
                k = Error(p(426));
              }
            } else if (I && h2.mode & 1) {
              var J = Ui(g);
              if (null !== J) {
                0 === (J.flags & 65536) && (J.flags |= 256);
                Vi(J, g, h2, f, b);
                Jg(Ji(k, h2));
                break a;
              }
            }
            f = k = Ji(k, h2);
            4 !== T && (T = 2);
            null === sk ? sk = [f] : sk.push(f);
            f = g;
            do {
              switch (f.tag) {
                case 3:
                  f.flags |= 65536;
                  b &= -b;
                  f.lanes |= b;
                  var x = Ni(f, k, b);
                  ph(f, x);
                  break a;
                case 1:
                  h2 = k;
                  var w = f.type, u = f.stateNode;
                  if (0 === (f.flags & 128) && ("function" === typeof w.getDerivedStateFromError || null !== u && "function" === typeof u.componentDidCatch && (null === Ri || !Ri.has(u)))) {
                    f.flags |= 65536;
                    b &= -b;
                    f.lanes |= b;
                    var F = Qi(f, h2, b);
                    ph(f, F);
                    break a;
                  }
              }
              f = f.return;
            } while (null !== f);
          }
          Sk(c);
        } catch (na) {
          b = na;
          Y === c && null !== c && (Y = c = c.return);
          continue;
        }
        break;
      } while (1);
    }
    function Jk() {
      var a = mk.current;
      mk.current = Rh;
      return null === a ? Rh : a;
    }
    function tj() {
      if (0 === T || 3 === T || 2 === T) T = 4;
      null === Q || 0 === (rh & 268435455) && 0 === (qk & 268435455) || Ck(Q, Z);
    }
    function Ik(a, b) {
      var c = K;
      K |= 2;
      var d = Jk();
      if (Q !== a || Z !== b) uk = null, Kk(a, b);
      do
        try {
          Tk();
          break;
        } catch (e) {
          Mk(a, e);
        }
      while (1);
      $g();
      K = c;
      mk.current = d;
      if (null !== Y) throw Error(p(261));
      Q = null;
      Z = 0;
      return T;
    }
    function Tk() {
      for (; null !== Y; ) Uk(Y);
    }
    function Lk() {
      for (; null !== Y && !cc(); ) Uk(Y);
    }
    function Uk(a) {
      var b = Vk(a.alternate, a, fj);
      a.memoizedProps = a.pendingProps;
      null === b ? Sk(a) : Y = b;
      nk.current = null;
    }
    function Sk(a) {
      var b = a;
      do {
        var c = b.alternate;
        a = b.return;
        if (0 === (b.flags & 32768)) {
          if (c = Ej(c, b, fj), null !== c) {
            Y = c;
            return;
          }
        } else {
          c = Ij(c, b);
          if (null !== c) {
            c.flags &= 32767;
            Y = c;
            return;
          }
          if (null !== a) a.flags |= 32768, a.subtreeFlags = 0, a.deletions = null;
          else {
            T = 6;
            Y = null;
            return;
          }
        }
        b = b.sibling;
        if (null !== b) {
          Y = b;
          return;
        }
        Y = b = a;
      } while (null !== b);
      0 === T && (T = 5);
    }
    function Pk(a, b, c) {
      var d = C, e = ok.transition;
      try {
        ok.transition = null, C = 1, Wk(a, b, c, d);
      } finally {
        ok.transition = e, C = d;
      }
      return null;
    }
    function Wk(a, b, c, d) {
      do
        Hk();
      while (null !== wk);
      if (0 !== (K & 6)) throw Error(p(327));
      c = a.finishedWork;
      var e = a.finishedLanes;
      if (null === c) return null;
      a.finishedWork = null;
      a.finishedLanes = 0;
      if (c === a.current) throw Error(p(177));
      a.callbackNode = null;
      a.callbackPriority = 0;
      var f = c.lanes | c.childLanes;
      Bc(a, f);
      a === Q && (Y = Q = null, Z = 0);
      0 === (c.subtreeFlags & 2064) && 0 === (c.flags & 2064) || vk || (vk = true, Fk(hc, function() {
        Hk();
        return null;
      }));
      f = 0 !== (c.flags & 15990);
      if (0 !== (c.subtreeFlags & 15990) || f) {
        f = ok.transition;
        ok.transition = null;
        var g = C;
        C = 1;
        var h2 = K;
        K |= 4;
        nk.current = null;
        Oj(a, c);
        dk(c, a);
        Oe(Df);
        dd = !!Cf;
        Df = Cf = null;
        a.current = c;
        hk(c, a, e);
        dc();
        K = h2;
        C = g;
        ok.transition = f;
      } else a.current = c;
      vk && (vk = false, wk = a, xk = e);
      f = a.pendingLanes;
      0 === f && (Ri = null);
      mc(c.stateNode, d);
      Dk(a, B());
      if (null !== b) for (d = a.onRecoverableError, c = 0; c < b.length; c++) e = b[c], d(e.value, { componentStack: e.stack, digest: e.digest });
      if (Oi) throw Oi = false, a = Pi, Pi = null, a;
      0 !== (xk & 1) && 0 !== a.tag && Hk();
      f = a.pendingLanes;
      0 !== (f & 1) ? a === zk ? yk++ : (yk = 0, zk = a) : yk = 0;
      jg();
      return null;
    }
    function Hk() {
      if (null !== wk) {
        var a = Dc(xk), b = ok.transition, c = C;
        try {
          ok.transition = null;
          C = 16 > a ? 16 : a;
          if (null === wk) var d = false;
          else {
            a = wk;
            wk = null;
            xk = 0;
            if (0 !== (K & 6)) throw Error(p(331));
            var e = K;
            K |= 4;
            for (V = a.current; null !== V; ) {
              var f = V, g = f.child;
              if (0 !== (V.flags & 16)) {
                var h2 = f.deletions;
                if (null !== h2) {
                  for (var k = 0; k < h2.length; k++) {
                    var l = h2[k];
                    for (V = l; null !== V; ) {
                      var m = V;
                      switch (m.tag) {
                        case 0:
                        case 11:
                        case 15:
                          Pj(8, m, f);
                      }
                      var q = m.child;
                      if (null !== q) q.return = m, V = q;
                      else for (; null !== V; ) {
                        m = V;
                        var r = m.sibling, y = m.return;
                        Sj(m);
                        if (m === l) {
                          V = null;
                          break;
                        }
                        if (null !== r) {
                          r.return = y;
                          V = r;
                          break;
                        }
                        V = y;
                      }
                    }
                  }
                  var n = f.alternate;
                  if (null !== n) {
                    var t = n.child;
                    if (null !== t) {
                      n.child = null;
                      do {
                        var J = t.sibling;
                        t.sibling = null;
                        t = J;
                      } while (null !== t);
                    }
                  }
                  V = f;
                }
              }
              if (0 !== (f.subtreeFlags & 2064) && null !== g) g.return = f, V = g;
              else b: for (; null !== V; ) {
                f = V;
                if (0 !== (f.flags & 2048)) switch (f.tag) {
                  case 0:
                  case 11:
                  case 15:
                    Pj(9, f, f.return);
                }
                var x = f.sibling;
                if (null !== x) {
                  x.return = f.return;
                  V = x;
                  break b;
                }
                V = f.return;
              }
            }
            var w = a.current;
            for (V = w; null !== V; ) {
              g = V;
              var u = g.child;
              if (0 !== (g.subtreeFlags & 2064) && null !== u) u.return = g, V = u;
              else b: for (g = w; null !== V; ) {
                h2 = V;
                if (0 !== (h2.flags & 2048)) try {
                  switch (h2.tag) {
                    case 0:
                    case 11:
                    case 15:
                      Qj(9, h2);
                  }
                } catch (na) {
                  W(h2, h2.return, na);
                }
                if (h2 === g) {
                  V = null;
                  break b;
                }
                var F = h2.sibling;
                if (null !== F) {
                  F.return = h2.return;
                  V = F;
                  break b;
                }
                V = h2.return;
              }
            }
            K = e;
            jg();
            if (lc && "function" === typeof lc.onPostCommitFiberRoot) try {
              lc.onPostCommitFiberRoot(kc, a);
            } catch (na) {
            }
            d = true;
          }
          return d;
        } finally {
          C = c, ok.transition = b;
        }
      }
      return false;
    }
    function Xk(a, b, c) {
      b = Ji(c, b);
      b = Ni(a, b, 1);
      a = nh(a, b, 1);
      b = R();
      null !== a && (Ac(a, 1, b), Dk(a, b));
    }
    function W(a, b, c) {
      if (3 === a.tag) Xk(a, a, c);
      else for (; null !== b; ) {
        if (3 === b.tag) {
          Xk(b, a, c);
          break;
        } else if (1 === b.tag) {
          var d = b.stateNode;
          if ("function" === typeof b.type.getDerivedStateFromError || "function" === typeof d.componentDidCatch && (null === Ri || !Ri.has(d))) {
            a = Ji(c, a);
            a = Qi(b, a, 1);
            b = nh(b, a, 1);
            a = R();
            null !== b && (Ac(b, 1, a), Dk(b, a));
            break;
          }
        }
        b = b.return;
      }
    }
    function Ti(a, b, c) {
      var d = a.pingCache;
      null !== d && d.delete(b);
      b = R();
      a.pingedLanes |= a.suspendedLanes & c;
      Q === a && (Z & c) === c && (4 === T || 3 === T && (Z & 130023424) === Z && 500 > B() - fk ? Kk(a, 0) : rk |= c);
      Dk(a, b);
    }
    function Yk(a, b) {
      0 === b && (0 === (a.mode & 1) ? b = 1 : (b = sc, sc <<= 1, 0 === (sc & 130023424) && (sc = 4194304)));
      var c = R();
      a = ih(a, b);
      null !== a && (Ac(a, b, c), Dk(a, c));
    }
    function uj(a) {
      var b = a.memoizedState, c = 0;
      null !== b && (c = b.retryLane);
      Yk(a, c);
    }
    function bk(a, b) {
      var c = 0;
      switch (a.tag) {
        case 13:
          var d = a.stateNode;
          var e = a.memoizedState;
          null !== e && (c = e.retryLane);
          break;
        case 19:
          d = a.stateNode;
          break;
        default:
          throw Error(p(314));
      }
      null !== d && d.delete(b);
      Yk(a, c);
    }
    var Vk;
    Vk = function(a, b, c) {
      if (null !== a) if (a.memoizedProps !== b.pendingProps || Wf.current) dh = true;
      else {
        if (0 === (a.lanes & c) && 0 === (b.flags & 128)) return dh = false, yj(a, b, c);
        dh = 0 !== (a.flags & 131072) ? true : false;
      }
      else dh = false, I && 0 !== (b.flags & 1048576) && ug(b, ng, b.index);
      b.lanes = 0;
      switch (b.tag) {
        case 2:
          var d = b.type;
          ij(a, b);
          a = b.pendingProps;
          var e = Yf(b, H.current);
          ch(b, c);
          e = Nh(null, b, d, a, e, c);
          var f = Sh();
          b.flags |= 1;
          "object" === typeof e && null !== e && "function" === typeof e.render && void 0 === e.$$typeof ? (b.tag = 1, b.memoizedState = null, b.updateQueue = null, Zf(d) ? (f = true, cg(b)) : f = false, b.memoizedState = null !== e.state && void 0 !== e.state ? e.state : null, kh(b), e.updater = Ei, b.stateNode = e, e._reactInternals = b, Ii(b, d, a, c), b = jj(null, b, d, true, f, c)) : (b.tag = 0, I && f && vg(b), Xi(null, b, e, c), b = b.child);
          return b;
        case 16:
          d = b.elementType;
          a: {
            ij(a, b);
            a = b.pendingProps;
            e = d._init;
            d = e(d._payload);
            b.type = d;
            e = b.tag = Zk(d);
            a = Ci(d, a);
            switch (e) {
              case 0:
                b = cj(null, b, d, a, c);
                break a;
              case 1:
                b = hj(null, b, d, a, c);
                break a;
              case 11:
                b = Yi(null, b, d, a, c);
                break a;
              case 14:
                b = $i(null, b, d, Ci(d.type, a), c);
                break a;
            }
            throw Error(p(
              306,
              d,
              ""
            ));
          }
          return b;
        case 0:
          return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), cj(a, b, d, e, c);
        case 1:
          return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), hj(a, b, d, e, c);
        case 3:
          a: {
            kj(b);
            if (null === a) throw Error(p(387));
            d = b.pendingProps;
            f = b.memoizedState;
            e = f.element;
            lh(a, b);
            qh(b, d, null, c);
            var g = b.memoizedState;
            d = g.element;
            if (f.isDehydrated) if (f = { element: d, isDehydrated: false, cache: g.cache, pendingSuspenseBoundaries: g.pendingSuspenseBoundaries, transitions: g.transitions }, b.updateQueue.baseState = f, b.memoizedState = f, b.flags & 256) {
              e = Ji(Error(p(423)), b);
              b = lj(a, b, d, c, e);
              break a;
            } else if (d !== e) {
              e = Ji(Error(p(424)), b);
              b = lj(a, b, d, c, e);
              break a;
            } else for (yg = Lf(b.stateNode.containerInfo.firstChild), xg = b, I = true, zg = null, c = Vg(b, null, d, c), b.child = c; c; ) c.flags = c.flags & -3 | 4096, c = c.sibling;
            else {
              Ig();
              if (d === e) {
                b = Zi(a, b, c);
                break a;
              }
              Xi(a, b, d, c);
            }
            b = b.child;
          }
          return b;
        case 5:
          return Ah(b), null === a && Eg(b), d = b.type, e = b.pendingProps, f = null !== a ? a.memoizedProps : null, g = e.children, Ef(d, e) ? g = null : null !== f && Ef(d, f) && (b.flags |= 32), gj(a, b), Xi(a, b, g, c), b.child;
        case 6:
          return null === a && Eg(b), null;
        case 13:
          return oj(a, b, c);
        case 4:
          return yh(b, b.stateNode.containerInfo), d = b.pendingProps, null === a ? b.child = Ug(b, null, d, c) : Xi(a, b, d, c), b.child;
        case 11:
          return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), Yi(a, b, d, e, c);
        case 7:
          return Xi(a, b, b.pendingProps, c), b.child;
        case 8:
          return Xi(a, b, b.pendingProps.children, c), b.child;
        case 12:
          return Xi(a, b, b.pendingProps.children, c), b.child;
        case 10:
          a: {
            d = b.type._context;
            e = b.pendingProps;
            f = b.memoizedProps;
            g = e.value;
            G(Wg, d._currentValue);
            d._currentValue = g;
            if (null !== f) if (He(f.value, g)) {
              if (f.children === e.children && !Wf.current) {
                b = Zi(a, b, c);
                break a;
              }
            } else for (f = b.child, null !== f && (f.return = b); null !== f; ) {
              var h2 = f.dependencies;
              if (null !== h2) {
                g = f.child;
                for (var k = h2.firstContext; null !== k; ) {
                  if (k.context === d) {
                    if (1 === f.tag) {
                      k = mh(-1, c & -c);
                      k.tag = 2;
                      var l = f.updateQueue;
                      if (null !== l) {
                        l = l.shared;
                        var m = l.pending;
                        null === m ? k.next = k : (k.next = m.next, m.next = k);
                        l.pending = k;
                      }
                    }
                    f.lanes |= c;
                    k = f.alternate;
                    null !== k && (k.lanes |= c);
                    bh(
                      f.return,
                      c,
                      b
                    );
                    h2.lanes |= c;
                    break;
                  }
                  k = k.next;
                }
              } else if (10 === f.tag) g = f.type === b.type ? null : f.child;
              else if (18 === f.tag) {
                g = f.return;
                if (null === g) throw Error(p(341));
                g.lanes |= c;
                h2 = g.alternate;
                null !== h2 && (h2.lanes |= c);
                bh(g, c, b);
                g = f.sibling;
              } else g = f.child;
              if (null !== g) g.return = f;
              else for (g = f; null !== g; ) {
                if (g === b) {
                  g = null;
                  break;
                }
                f = g.sibling;
                if (null !== f) {
                  f.return = g.return;
                  g = f;
                  break;
                }
                g = g.return;
              }
              f = g;
            }
            Xi(a, b, e.children, c);
            b = b.child;
          }
          return b;
        case 9:
          return e = b.type, d = b.pendingProps.children, ch(b, c), e = eh(e), d = d(e), b.flags |= 1, Xi(a, b, d, c), b.child;
        case 14:
          return d = b.type, e = Ci(d, b.pendingProps), e = Ci(d.type, e), $i(a, b, d, e, c);
        case 15:
          return bj(a, b, b.type, b.pendingProps, c);
        case 17:
          return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), ij(a, b), b.tag = 1, Zf(d) ? (a = true, cg(b)) : a = false, ch(b, c), Gi(b, d, e), Ii(b, d, e, c), jj(null, b, d, true, a, c);
        case 19:
          return xj(a, b, c);
        case 22:
          return dj(a, b, c);
      }
      throw Error(p(156, b.tag));
    };
    function Fk(a, b) {
      return ac(a, b);
    }
    function $k(a, b, c, d) {
      this.tag = a;
      this.key = c;
      this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null;
      this.index = 0;
      this.ref = null;
      this.pendingProps = b;
      this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null;
      this.mode = d;
      this.subtreeFlags = this.flags = 0;
      this.deletions = null;
      this.childLanes = this.lanes = 0;
      this.alternate = null;
    }
    function Bg(a, b, c, d) {
      return new $k(a, b, c, d);
    }
    function aj(a) {
      a = a.prototype;
      return !(!a || !a.isReactComponent);
    }
    function Zk(a) {
      if ("function" === typeof a) return aj(a) ? 1 : 0;
      if (void 0 !== a && null !== a) {
        a = a.$$typeof;
        if (a === Da) return 11;
        if (a === Ga) return 14;
      }
      return 2;
    }
    function Pg(a, b) {
      var c = a.alternate;
      null === c ? (c = Bg(a.tag, b, a.key, a.mode), c.elementType = a.elementType, c.type = a.type, c.stateNode = a.stateNode, c.alternate = a, a.alternate = c) : (c.pendingProps = b, c.type = a.type, c.flags = 0, c.subtreeFlags = 0, c.deletions = null);
      c.flags = a.flags & 14680064;
      c.childLanes = a.childLanes;
      c.lanes = a.lanes;
      c.child = a.child;
      c.memoizedProps = a.memoizedProps;
      c.memoizedState = a.memoizedState;
      c.updateQueue = a.updateQueue;
      b = a.dependencies;
      c.dependencies = null === b ? null : { lanes: b.lanes, firstContext: b.firstContext };
      c.sibling = a.sibling;
      c.index = a.index;
      c.ref = a.ref;
      return c;
    }
    function Rg(a, b, c, d, e, f) {
      var g = 2;
      d = a;
      if ("function" === typeof a) aj(a) && (g = 1);
      else if ("string" === typeof a) g = 5;
      else a: switch (a) {
        case ya:
          return Tg(c.children, e, f, b);
        case za:
          g = 8;
          e |= 8;
          break;
        case Aa:
          return a = Bg(12, c, b, e | 2), a.elementType = Aa, a.lanes = f, a;
        case Ea:
          return a = Bg(13, c, b, e), a.elementType = Ea, a.lanes = f, a;
        case Fa:
          return a = Bg(19, c, b, e), a.elementType = Fa, a.lanes = f, a;
        case Ia:
          return pj(c, e, f, b);
        default:
          if ("object" === typeof a && null !== a) switch (a.$$typeof) {
            case Ba:
              g = 10;
              break a;
            case Ca:
              g = 9;
              break a;
            case Da:
              g = 11;
              break a;
            case Ga:
              g = 14;
              break a;
            case Ha:
              g = 16;
              d = null;
              break a;
          }
          throw Error(p(130, null == a ? a : typeof a, ""));
      }
      b = Bg(g, c, b, e);
      b.elementType = a;
      b.type = d;
      b.lanes = f;
      return b;
    }
    function Tg(a, b, c, d) {
      a = Bg(7, a, d, b);
      a.lanes = c;
      return a;
    }
    function pj(a, b, c, d) {
      a = Bg(22, a, d, b);
      a.elementType = Ia;
      a.lanes = c;
      a.stateNode = { isHidden: false };
      return a;
    }
    function Qg(a, b, c) {
      a = Bg(6, a, null, b);
      a.lanes = c;
      return a;
    }
    function Sg(a, b, c) {
      b = Bg(4, null !== a.children ? a.children : [], a.key, b);
      b.lanes = c;
      b.stateNode = { containerInfo: a.containerInfo, pendingChildren: null, implementation: a.implementation };
      return b;
    }
    function al(a, b, c, d, e) {
      this.tag = b;
      this.containerInfo = a;
      this.finishedWork = this.pingCache = this.current = this.pendingChildren = null;
      this.timeoutHandle = -1;
      this.callbackNode = this.pendingContext = this.context = null;
      this.callbackPriority = 0;
      this.eventTimes = zc(0);
      this.expirationTimes = zc(-1);
      this.entangledLanes = this.finishedLanes = this.mutableReadLanes = this.expiredLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0;
      this.entanglements = zc(0);
      this.identifierPrefix = d;
      this.onRecoverableError = e;
      this.mutableSourceEagerHydrationData = null;
    }
    function bl(a, b, c, d, e, f, g, h2, k) {
      a = new al(a, b, c, h2, k);
      1 === b ? (b = 1, true === f && (b |= 8)) : b = 0;
      f = Bg(3, null, null, b);
      a.current = f;
      f.stateNode = a;
      f.memoizedState = { element: d, isDehydrated: c, cache: null, transitions: null, pendingSuspenseBoundaries: null };
      kh(f);
      return a;
    }
    function cl(a, b, c) {
      var d = 3 < arguments.length && void 0 !== arguments[3] ? arguments[3] : null;
      return { $$typeof: wa, key: null == d ? null : "" + d, children: a, containerInfo: b, implementation: c };
    }
    function dl(a) {
      if (!a) return Vf;
      a = a._reactInternals;
      a: {
        if (Vb(a) !== a || 1 !== a.tag) throw Error(p(170));
        var b = a;
        do {
          switch (b.tag) {
            case 3:
              b = b.stateNode.context;
              break a;
            case 1:
              if (Zf(b.type)) {
                b = b.stateNode.__reactInternalMemoizedMergedChildContext;
                break a;
              }
          }
          b = b.return;
        } while (null !== b);
        throw Error(p(171));
      }
      if (1 === a.tag) {
        var c = a.type;
        if (Zf(c)) return bg(a, c, b);
      }
      return b;
    }
    function el(a, b, c, d, e, f, g, h2, k) {
      a = bl(c, d, true, a, e, f, g, h2, k);
      a.context = dl(null);
      c = a.current;
      d = R();
      e = yi(c);
      f = mh(d, e);
      f.callback = void 0 !== b && null !== b ? b : null;
      nh(c, f, e);
      a.current.lanes = e;
      Ac(a, e, d);
      Dk(a, d);
      return a;
    }
    function fl(a, b, c, d) {
      var e = b.current, f = R(), g = yi(e);
      c = dl(c);
      null === b.context ? b.context = c : b.pendingContext = c;
      b = mh(f, g);
      b.payload = { element: a };
      d = void 0 === d ? null : d;
      null !== d && (b.callback = d);
      a = nh(e, b, g);
      null !== a && (gi(a, e, g, f), oh(a, e, g));
      return g;
    }
    function gl(a) {
      a = a.current;
      if (!a.child) return null;
      switch (a.child.tag) {
        case 5:
          return a.child.stateNode;
        default:
          return a.child.stateNode;
      }
    }
    function hl(a, b) {
      a = a.memoizedState;
      if (null !== a && null !== a.dehydrated) {
        var c = a.retryLane;
        a.retryLane = 0 !== c && c < b ? c : b;
      }
    }
    function il(a, b) {
      hl(a, b);
      (a = a.alternate) && hl(a, b);
    }
    function jl() {
      return null;
    }
    var kl = "function" === typeof reportError ? reportError : function(a) {
      console.error(a);
    };
    function ll(a) {
      this._internalRoot = a;
    }
    ml.prototype.render = ll.prototype.render = function(a) {
      var b = this._internalRoot;
      if (null === b) throw Error(p(409));
      fl(a, b, null, null);
    };
    ml.prototype.unmount = ll.prototype.unmount = function() {
      var a = this._internalRoot;
      if (null !== a) {
        this._internalRoot = null;
        var b = a.containerInfo;
        Rk(function() {
          fl(null, a, null, null);
        });
        b[uf] = null;
      }
    };
    function ml(a) {
      this._internalRoot = a;
    }
    ml.prototype.unstable_scheduleHydration = function(a) {
      if (a) {
        var b = Hc();
        a = { blockedOn: null, target: a, priority: b };
        for (var c = 0; c < Qc.length && 0 !== b && b < Qc[c].priority; c++) ;
        Qc.splice(c, 0, a);
        0 === c && Vc(a);
      }
    };
    function nl(a) {
      return !(!a || 1 !== a.nodeType && 9 !== a.nodeType && 11 !== a.nodeType);
    }
    function ol(a) {
      return !(!a || 1 !== a.nodeType && 9 !== a.nodeType && 11 !== a.nodeType && (8 !== a.nodeType || " react-mount-point-unstable " !== a.nodeValue));
    }
    function pl() {
    }
    function ql(a, b, c, d, e) {
      if (e) {
        if ("function" === typeof d) {
          var f = d;
          d = function() {
            var a2 = gl(g);
            f.call(a2);
          };
        }
        var g = el(b, d, a, 0, null, false, false, "", pl);
        a._reactRootContainer = g;
        a[uf] = g.current;
        sf(8 === a.nodeType ? a.parentNode : a);
        Rk();
        return g;
      }
      for (; e = a.lastChild; ) a.removeChild(e);
      if ("function" === typeof d) {
        var h2 = d;
        d = function() {
          var a2 = gl(k);
          h2.call(a2);
        };
      }
      var k = bl(a, 0, false, null, null, false, false, "", pl);
      a._reactRootContainer = k;
      a[uf] = k.current;
      sf(8 === a.nodeType ? a.parentNode : a);
      Rk(function() {
        fl(b, k, c, d);
      });
      return k;
    }
    function rl(a, b, c, d, e) {
      var f = c._reactRootContainer;
      if (f) {
        var g = f;
        if ("function" === typeof e) {
          var h2 = e;
          e = function() {
            var a2 = gl(g);
            h2.call(a2);
          };
        }
        fl(b, g, a, e);
      } else g = ql(c, b, a, e, d);
      return gl(g);
    }
    Ec = function(a) {
      switch (a.tag) {
        case 3:
          var b = a.stateNode;
          if (b.current.memoizedState.isDehydrated) {
            var c = tc(b.pendingLanes);
            0 !== c && (Cc(b, c | 1), Dk(b, B()), 0 === (K & 6) && (Gj = B() + 500, jg()));
          }
          break;
        case 13:
          Rk(function() {
            var b2 = ih(a, 1);
            if (null !== b2) {
              var c2 = R();
              gi(b2, a, 1, c2);
            }
          }), il(a, 1);
      }
    };
    Fc = function(a) {
      if (13 === a.tag) {
        var b = ih(a, 134217728);
        if (null !== b) {
          var c = R();
          gi(b, a, 134217728, c);
        }
        il(a, 134217728);
      }
    };
    Gc = function(a) {
      if (13 === a.tag) {
        var b = yi(a), c = ih(a, b);
        if (null !== c) {
          var d = R();
          gi(c, a, b, d);
        }
        il(a, b);
      }
    };
    Hc = function() {
      return C;
    };
    Ic = function(a, b) {
      var c = C;
      try {
        return C = a, b();
      } finally {
        C = c;
      }
    };
    yb = function(a, b, c) {
      switch (b) {
        case "input":
          bb(a, c);
          b = c.name;
          if ("radio" === c.type && null != b) {
            for (c = a; c.parentNode; ) c = c.parentNode;
            c = c.querySelectorAll("input[name=" + JSON.stringify("" + b) + '][type="radio"]');
            for (b = 0; b < c.length; b++) {
              var d = c[b];
              if (d !== a && d.form === a.form) {
                var e = Db(d);
                if (!e) throw Error(p(90));
                Wa(d);
                bb(d, e);
              }
            }
          }
          break;
        case "textarea":
          ib(a, c);
          break;
        case "select":
          b = c.value, null != b && fb(a, !!c.multiple, b, false);
      }
    };
    Gb = Qk;
    Hb = Rk;
    var sl = { usingClientEntryPoint: false, Events: [Cb, ue, Db, Eb, Fb, Qk] };
    var tl = { findFiberByHostInstance: Wc, bundleType: 0, version: "18.3.1", rendererPackageName: "react-dom" };
    var ul = { bundleType: tl.bundleType, version: tl.version, rendererPackageName: tl.rendererPackageName, rendererConfig: tl.rendererConfig, overrideHookState: null, overrideHookStateDeletePath: null, overrideHookStateRenamePath: null, overrideProps: null, overridePropsDeletePath: null, overridePropsRenamePath: null, setErrorHandler: null, setSuspenseHandler: null, scheduleUpdate: null, currentDispatcherRef: ua.ReactCurrentDispatcher, findHostInstanceByFiber: function(a) {
      a = Zb(a);
      return null === a ? null : a.stateNode;
    }, findFiberByHostInstance: tl.findFiberByHostInstance || jl, findHostInstancesForRefresh: null, scheduleRefresh: null, scheduleRoot: null, setRefreshHandler: null, getCurrentFiber: null, reconcilerVersion: "18.3.1-next-f1338f8080-20240426" };
    if ("undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__) {
      vl = __REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (!vl.isDisabled && vl.supportsFiber) try {
        kc = vl.inject(ul), lc = vl;
      } catch (a) {
      }
    }
    var vl;
    exports2.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = sl;
    exports2.createPortal = function(a, b) {
      var c = 2 < arguments.length && void 0 !== arguments[2] ? arguments[2] : null;
      if (!nl(b)) throw Error(p(200));
      return cl(a, b, null, c);
    };
    exports2.createRoot = function(a, b) {
      if (!nl(a)) throw Error(p(299));
      var c = false, d = "", e = kl;
      null !== b && void 0 !== b && (true === b.unstable_strictMode && (c = true), void 0 !== b.identifierPrefix && (d = b.identifierPrefix), void 0 !== b.onRecoverableError && (e = b.onRecoverableError));
      b = bl(a, 1, false, null, null, c, false, d, e);
      a[uf] = b.current;
      sf(8 === a.nodeType ? a.parentNode : a);
      return new ll(b);
    };
    exports2.findDOMNode = function(a) {
      if (null == a) return null;
      if (1 === a.nodeType) return a;
      var b = a._reactInternals;
      if (void 0 === b) {
        if ("function" === typeof a.render) throw Error(p(188));
        a = Object.keys(a).join(",");
        throw Error(p(268, a));
      }
      a = Zb(b);
      a = null === a ? null : a.stateNode;
      return a;
    };
    exports2.flushSync = function(a) {
      return Rk(a);
    };
    exports2.hydrate = function(a, b, c) {
      if (!ol(b)) throw Error(p(200));
      return rl(null, a, b, true, c);
    };
    exports2.hydrateRoot = function(a, b, c) {
      if (!nl(a)) throw Error(p(405));
      var d = null != c && c.hydratedSources || null, e = false, f = "", g = kl;
      null !== c && void 0 !== c && (true === c.unstable_strictMode && (e = true), void 0 !== c.identifierPrefix && (f = c.identifierPrefix), void 0 !== c.onRecoverableError && (g = c.onRecoverableError));
      b = el(b, null, a, 1, null != c ? c : null, e, false, f, g);
      a[uf] = b.current;
      sf(a);
      if (d) for (a = 0; a < d.length; a++) c = d[a], e = c._getVersion, e = e(c._source), null == b.mutableSourceEagerHydrationData ? b.mutableSourceEagerHydrationData = [c, e] : b.mutableSourceEagerHydrationData.push(
        c,
        e
      );
      return new ml(b);
    };
    exports2.render = function(a, b, c) {
      if (!ol(b)) throw Error(p(200));
      return rl(null, a, b, false, c);
    };
    exports2.unmountComponentAtNode = function(a) {
      if (!ol(a)) throw Error(p(40));
      return a._reactRootContainer ? (Rk(function() {
        rl(null, null, a, false, function() {
          a._reactRootContainer = null;
          a[uf] = null;
        });
      }), true) : false;
    };
    exports2.unstable_batchedUpdates = Qk;
    exports2.unstable_renderSubtreeIntoContainer = function(a, b, c, d) {
      if (!ol(c)) throw Error(p(200));
      if (null == a || void 0 === a._reactInternals) throw Error(p(38));
      return rl(a, b, c, false, d);
    };
    exports2.version = "18.3.1-next-f1338f8080-20240426";
  }
});

// node_modules/react-dom/index.js
var require_react_dom = __commonJS({
  "node_modules/react-dom/index.js"(exports2, module2) {
    "use strict";
    function checkDCE() {
      if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === "undefined" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== "function") {
        return;
      }
      if (false) {
        throw new Error("^_^");
      }
      try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(checkDCE);
      } catch (err) {
        console.error(err);
      }
    }
    if (true) {
      checkDCE();
      module2.exports = require_react_dom_production_min();
    } else {
      module2.exports = null;
    }
  }
});

// node_modules/react-dom/client.js
var require_client = __commonJS({
  "node_modules/react-dom/client.js"(exports2) {
    "use strict";
    var m = require_react_dom();
    if (true) {
      exports2.createRoot = m.createRoot;
      exports2.hydrateRoot = m.hydrateRoot;
    } else {
      i = m.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
      exports2.createRoot = function(c, o) {
        i.usingClientEntryPoint = true;
        try {
          return m.createRoot(c, o);
        } finally {
          i.usingClientEntryPoint = false;
        }
      };
      exports2.hydrateRoot = function(c, h2, o) {
        i.usingClientEntryPoint = true;
        try {
          return m.hydrateRoot(c, h2, o);
        } finally {
          i.usingClientEntryPoint = false;
        }
      };
    }
    var i;
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
    localPort: Number.isInteger(data.localPort) && data.localPort > 0 && data.localPort < 65536 ? data.localPort : null
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
    localPort: patch.localPort !== void 0 ? patch.localPort : cur.localPort
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
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
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
      child.on("error", (error) => {
        clearTimeout(timer);
        if (error && error.code === "ENOENT") {
          attempt(index + 1);
          return;
        }
        finish(reject, Object.assign(error, { status: 502 }));
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
  } catch (error) {
    return {
      ready: false,
      python: null,
      bleak: null,
      bridge: BRIDGE(),
      error: error && error.message ? error.message : String(error)
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
    } catch (error) {
      summary.failed += 1;
      summary.items.push({
        name: sourceName,
        status: "failed",
        error: error && error.message ? error.message : String(error)
      });
      log(`\u5BFC\u5165\u5931\u8D25\uFF1A${sourceName} \u2014 ${error && error.message ? error.message : error}`);
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

// src/main.js
init_vault();

// src/core/service.js
init_vfs();
var import_node_path6 = require("node:path");
init_vault();

// src/core/history.js
init_vfs();
var import_node_path4 = require("node:path");
var import_node_crypto3 = require("node:crypto");
var HISTORY_DIR = ".history";
var HISTORY_LIMIT = 10;
var MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
var KEY_MAX = 120;
var KEY_HASH_LEN = 16;
var ILLEGAL_NAME = /[<>:"\\|?*\u0000-\u001f\u007f]/g;
var STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/;
function sha1(text) {
  return (0, import_node_crypto3.createHash)("sha1").update(String(text), "utf8").digest("hex");
}
function badInput(message) {
  return Object.assign(new Error(message || "\u975E\u6CD5\u7684\u8DEF\u5F84"), { status: 400 });
}
function notFound() {
  return Object.assign(new Error("\u8FD9\u4E00\u7248\u5FEB\u7167\u4E0D\u5728\u4E86"), { status: 404 });
}
function isMissing(error) {
  return Boolean(error) && (error.code === "ENOENT" || error.code === "ENOTDIR");
}
function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n)) return HISTORY_LIMIT;
  return Math.max(1, Math.floor(n));
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
  const t = Number.isFinite(ms) ? ms : Date.now();
  return new Date(t).toISOString().replace(/[:.]/g, "-");
}
function parseStamp(name) {
  const m = STAMP_RE.exec(name);
  if (!m) return null;
  const [, y, mo, d, h2, mi, s, ms] = m;
  const iso = `${y}-${mo}-${d}T${h2}:${mi}:${s}.${ms}Z`;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return { ms: t, iso };
}
function seqOf(name) {
  const m = /Z-(\d+)\.md$/i.exec(name);
  return m ? Number(m[1]) : 1;
}
async function readSnapshots(dirAbs) {
  let names;
  try {
    names = await readdir2(dirAbs);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const items = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".md")) continue;
    let st;
    try {
      st = await stat2((0, import_node_path4.join)(dirAbs, name));
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
  items.sort((a, b) => b._ms - a._ms || b._seq - a._seq || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return items;
}
async function pruneDir(dirAbs, keep) {
  const items = await readSnapshots(dirAbs);
  const survivors = items.slice(0, keep);
  let pruned = 0;
  for (const item of items.slice(keep)) {
    try {
      await rm2((0, import_node_path4.join)(dirAbs, item.name), { force: true });
      pruned += 1;
    } catch {
    }
  }
  return { pruned, kept: survivors.length };
}
async function snapshotNote(root, relPath, { now = Date.now(), limit = HISTORY_LIMIT } = {}) {
  const parts = splitRel(relPath);
  const abs = (0, import_node_path4.resolve)(root, ...parts);
  let st;
  try {
    st = await stat2(abs);
  } catch (error) {
    if (isMissing(error)) return { saved: false, reason: "missing" };
    throw error;
  }
  if (!st.isFile()) return { saved: false, reason: "missing" };
  if (st.size > MAX_SNAPSHOT_BYTES) return { saved: false, reason: "too-large" };
  const buf = await readFile2(abs);
  if (buf.length > MAX_SNAPSHOT_BYTES) return { saved: false, reason: "too-large" };
  const key = historyKeyFor(parts.join("/"));
  const dirAbs = (0, import_node_path4.join)(root, HISTORY_DIR, key);
  await mkdir2(dirAbs, { recursive: true });
  const base = stampLabel(now);
  let name = "";
  for (let i = 1; i <= 999; i += 1) {
    const candidate = i === 1 ? `${base}.md` : `${base}-${i}.md`;
    try {
      await writeFile2((0, import_node_path4.join)(dirAbs, candidate), buf, { flag: "wx" });
      name = candidate;
      break;
    } catch (error) {
      if (error && error.code === "EEXIST") continue;
      throw error;
    }
  }
  if (name === "") throw Object.assign(new Error("\u540C\u4E00\u6BEB\u79D2\u7684\u5FEB\u7167\u8FC7\u591A"), { status: 409 });
  await pruneDir(dirAbs, clampLimit(limit));
  return { saved: true, path: `${HISTORY_DIR}/${key}/${name}`, bytes: buf.length };
}
async function listHistory(root, relPath, { limit = 50 } = {}) {
  const parts = splitRel(relPath);
  const key = historyKeyFor(parts.join("/"));
  const dirAbs = (0, import_node_path4.join)(root, HISTORY_DIR, key);
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
async function readHistoryEntry(root, relPath, name) {
  if (typeof name !== "string" || name === "" || name === "." || name === "..") {
    throw badInput("\u975E\u6CD5\u7684\u5FEB\u7167\u540D");
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..") || name.includes("\0")) {
    throw badInput("\u975E\u6CD5\u7684\u5FEB\u7167\u540D");
  }
  const parts = splitRel(relPath);
  const key = historyKeyFor(parts.join("/"));
  const abs = (0, import_node_path4.join)(root, HISTORY_DIR, key, name);
  let st;
  try {
    st = await stat2(abs);
  } catch (error) {
    if (isMissing(error)) throw notFound();
    throw error;
  }
  if (!st.isFile()) throw notFound();
  let buf;
  try {
    buf = await readFile2(abs);
  } catch (error) {
    if (isMissing(error)) throw notFound();
    throw error;
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
  const tmp = `${abs}.${process.pid}.${Date.now().toString(36)}.${(0, import_node_crypto3.randomBytes)(3).toString("hex")}.tmp`;
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
  const abs = (0, import_node_path4.resolve)(root, ...parts);
  let hadSnapshot = false;
  if (keepCurrent !== false) {
    const snap = await snapshotNote(root, parts.join("/"));
    hadSnapshot = snap.saved === true;
  }
  await mkdir2((0, import_node_path4.dirname)(abs), { recursive: true });
  await atomicWrite(abs, entry.content);
  return { restored: true, path: parts.join("/"), from: name, hadSnapshot };
}

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
function formatBytes(n) {
  if (n >= MB) {
    const mb = Math.round(n / MB * 10) / 10;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`;
  }
  if (n >= 1024) return `${Math.round(n / 1024 * 10) / 10}KB`;
  return `${n} \u5B57\u8282`;
}
var crcTableCache = null;
function crcTable() {
  if (crcTableCache) return crcTableCache;
  const table = new Uint32Array(CRC_TABLE_SIZE);
  for (let i = 0; i < CRC_TABLE_SIZE; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    table[i] = c >>> 0;
  }
  crcTableCache = table;
  return crcTableCache;
}
function crc32(buf) {
  const table = crcTable();
  let c = 4294967295;
  for (let i = 0; i < buf.length; i += 1) c = table[(c ^ buf[i]) & 255] ^ c >>> 8;
  return (c ^ 4294967295) >>> 0;
}
function dosDateTime(when) {
  const d = when instanceof Date && !Number.isNaN(when.getTime()) ? when : /* @__PURE__ */ new Date();
  const year = d.getFullYear();
  const y = Math.max(0, Math.min(127, year - 1980));
  return {
    time: d.getHours() << 11 | d.getMinutes() << 5 | Math.floor(d.getSeconds() / 2) & 31,
    date: y << 9 | d.getMonth() + 1 << 5 | d.getDate()
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
    entries: records.map((r) => ({
      path: r.name,
      bytes: r.uncompressedSize,
      compressedBytes: r.compressedSize,
      method: r.method,
      crc: r.crc
    }))
  };
}
function findEocd(buffer) {
  const min = Math.max(0, buffer.length - EOCD_MAX_SCAN);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) !== SIG_EOCD) continue;
    const commentLen = buffer.readUInt16LE(i + 20);
    if (i + 22 + commentLen === buffer.length) return i;
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
  for (let i = 0; i < total; i += 1) {
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
  const parts = raw.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length === 0) return null;
  if (parts.some((p) => p === "..")) return null;
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
  for (let i = 2; i <= 99; i += 1) out.push(dir === "" ? `${stem}-${i}${ext}` : `${dir}/${stem}-${i}${ext}`);
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
    items.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const item of items) {
      const rel = relDir === "" ? item.name : `${relDir}/${item.name}`;
      if (item.isDirectory()) {
        if (IGNORED_DIRS2.has(item.name)) continue;
        await walk((0, import_node_path5.join)(dirAbs, item.name), rel);
        continue;
      }
      if (!item.isFile()) continue;
      if (item.name.endsWith(".bak")) continue;
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
  const totalSize = found.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > maxTotalBytes) {
    throw fail(413, `\u5F52\u6863\u8D85\u8FC7 ${formatBytes(maxTotalBytes)}\uFF0C\u8BF7\u5206\u6279\u5BFC\u51FA`);
  }
  const files = [];
  for (const f of found) {
    let data;
    try {
      data = await readFile2(f.abs);
    } catch {
      continue;
    }
    files.push({ path: f.rel, data, mtime: f.mtime });
  }
  const { buffer, entries } = encodeZip(files);
  return {
    buffer,
    entries,
    bytes: buffer.length,
    sourceBytes: files.reduce((sum, f) => sum + f.data.length, 0)
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
function pad(n) {
  return String(n).padStart(2, "0");
}
function todayString() {
  const now = /* @__PURE__ */ new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
function dateOf(value) {
  if (value === null || value === void 0 || value === "") return null;
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1e3;
    const d2 = new Date(ms);
    if (Number.isNaN(d2.getTime())) return null;
    return `${d2.getFullYear()}-${pad(d2.getMonth() + 1)}-${pad(d2.getDate())}`;
  }
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function titleOf(note) {
  const candidates = [note.title, note.name, note.subject, note.headline, note.summary_title];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim();
  }
  const body = typeof note.content === "string" ? note.content : "";
  const m = /^#{1,3}\s+(.+)$/m.exec(body);
  if (m) return m[1].trim();
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
    return raw.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
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
    } catch (error) {
      log(`\u8BFB\u53D6\u77E5\u8BC6\u5E93\u5217\u8868\u5931\u8D25\uFF08\u7EE7\u7EED\u6309\u5168\u90E8\u7B14\u8BB0\u5BFC\u5165\uFF09\uFF1A${error.message}`);
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
    } catch (error) {
      log(`\u5168\u5C40\u5217\u8868\u4E0D\u53EF\u7528\uFF0C\u6539\u4E3A\u9010\u77E5\u8BC6\u5E93\u8BFB\u53D6\uFF1A${error.message}`);
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
        } catch (error) {
          log(`\u77E5\u8BC6\u5E93\u300C${topic.name}\u300D\u8BFB\u53D6\u5931\u8D25\uFF1A${error.message}`);
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
    } catch (error) {
      stats.failed += 1;
      stats.notes.push({ noteId: id, title: titleOf(note), error: String(error && error.message ? error.message : error) });
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
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
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
  const e = new Error(parts.join("\uFF1A").replace(/(：)+/g, "\uFF1A"));
  e.status = status || 502;
  e.code = typeof err.code === "number" ? err.code : null;
  e.reason = reason || null;
  e.requestId = payload && typeof payload === "object" ? payload.request_id || null : null;
  e.partial = payload;
  return e;
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
      for (const [k, v] of Object.entries(query)) {
        if (v === void 0 || v === null || v === "") continue;
        qs.set(k, String(v));
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
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
      const e = new Error(`\u8FDE\u4E0D\u4E0A\u5F97\u5230\u5927\u8111\uFF08${cause && cause.name === "TimeoutError" ? "\u8BF7\u6C42\u8D85\u65F6" : cause && cause.message || "\u7F51\u7EDC\u9519\u8BEF"}\uFF09\u3002\u68C0\u67E5\u7F51\u7EDC\u6216\u4EE3\u7406\u3002`);
      e.status = 502;
      throw e;
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
      topics: list.map((t) => ({
        id: String(t?.topic_id ?? t?.id ?? ""),
        name: String(t?.name ?? t?.title ?? "\u672A\u547D\u540D\u77E5\u8BC6\u5E93"),
        type: t?.type ?? null
      })).filter((t) => t.id !== ""),
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
    for (const a of note.attachments) {
      if (a && (a.type === "audio" || /\.(mp3|m4a|wav|aac|ogg)$/i.test(String(a.url || "")))) {
        const raw = a.duration;
        const seconds = typeof raw === "number" && raw > 1e3 ? Math.round(raw / 1e3) : raw;
        push(a.url, seconds, "attachment", a.title);
      }
    }
  }
  if (note.timeline && Array.isArray(note.timeline.resources)) {
    for (const r of note.timeline.resources) {
      if (r && r.type === "audio") push(r.url, null, "timeline", null);
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
  const tags = Array.isArray(raw.tags) ? raw.tags.map((t) => typeof t === "string" ? { id: null, name: t, type: "manual" } : { id: t?.id != null ? String(t.id) : null, name: String(t?.name ?? ""), type: t?.type ?? "manual" }).filter((t) => t.name !== "") : [];
  const topics = Array.isArray(raw.topics) ? raw.topics.map((t) => ({ id: String(t?.id ?? ""), name: String(t?.name ?? "") })).filter((t) => t.id !== "") : [];
  const audio = extractAudio(raw);
  const original = extractOriginal(raw);
  const moments = raw.timeline && Array.isArray(raw.timeline.moments) ? raw.timeline.moments.map((m) => ({
    startMs: typeof m?.start_ms === "number" ? m.start_ms : 0,
    endMs: typeof m?.end_ms === "number" ? m.end_ms : 0,
    text: String(m?.text ?? "")
  })).filter((m) => m.text !== "") : [];
  const todos = raw.meeting_todos && Array.isArray(raw.meeting_todos.items) ? raw.meeting_todos.items.map((t) => ({ text: String(t?.text ?? ""), completed: t?.completed === true })).filter((t) => t.text !== "") : [];
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
    fingerprint: fingerprintOf({ title: raw.title, content: original, updatedAt: raw.updated_at, tags: tags.map((t) => t.name) })
  };
}
function fingerprintOf(parts) {
  const h2 = (0, import_node_crypto5.createHash)("sha1");
  h2.update(JSON.stringify({
    title: parts?.title ?? "",
    content: parts?.content ?? "",
    updatedAt: parts?.updatedAt ?? "",
    tags: Array.isArray(parts?.tags) ? parts.tags : []
  }));
  return h2.digest("hex").slice(0, 16);
}

// src/core/service.js
init_net();

// src/core/mcp-cloud.js
init_biji();
function wrapError(what, error) {
  const message = error && error.message ? error.message : String(error);
  const e = new Error(`\u5F97\u5230\u5927\u8111 ${what} \u5931\u8D25\uFF1A${message}`);
  e.status = /401|unauthorized|no bearer token/i.test(message) ? 401 : 502;
  e.cause = error;
  return e;
}
function bridgeAudio(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const attachments = Array.isArray(raw.attachments) ? raw.attachments : [];
  const primary = attachments.find((a) => a && a.type === "audio" && typeof a.url === "string");
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
      ready = mcp.initialize().catch((error) => {
        ready = null;
        throw wrapError("\u63E1\u624B", error);
      });
    }
    return ready;
  }
  async function tool(name, args) {
    await ensureReady();
    try {
      return await mcp.callTool(name, args);
    } catch (error) {
      throw wrapError(name, error);
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
    return { results: results.map((r) => ({ ...bridgeAudio(r.note ?? r), score: r.score, snippet: r.snippet ?? null, noteId: r.note_id ?? r.note?.note_id ?? null })), raw: data };
  }
  async function recallInTopic({ topicId, query, topK = 5 } = {}) {
    const data = await tool("recall_knowledge", { topic_id: String(topicId), query: String(query), top_k: Math.max(1, Math.min(Number(topK) || 5, 20)) });
    const results = Array.isArray(data?.results) ? data.results : [];
    return { results: results.map((r) => ({ ...bridgeAudio(r.note ?? r), score: r.score, snippet: r.snippet ?? null, noteId: r.note_id ?? r.note?.note_id ?? null })), raw: data };
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
  const h2 = (0, import_node_crypto6.createHash)("sha1");
  h2.update(String(title ?? ""));
  h2.update("\0");
  h2.update(String(content ?? ""));
  h2.update("\0");
  h2.update(Array.isArray(tags) ? tags.join("") : "");
  return h2.digest("hex").slice(0, 16);
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
  const m = /^#\s+(.+)$/m.exec(String(body || ""));
  return m ? m[1].trim() : "";
}
function stripSourceFooter(body) {
  return String(body || "").replace(/^[ \t]*（源自得到大脑[^\n]*）[ \t]*\n?/gm, "").replace(/\n+(?:-[ \t]*-[ \t]*-[ \t]*\n*)+$/, "\n");
}
function renderNote({ note, topicName, archiveDate }) {
  const tags = note.tags.map((t) => t.name).filter(Boolean);
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
    parts.push(...note.refContent.split("\n").map((l) => `> ${l}`), "");
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
    for (const m of note.moments) {
      parts.push(`| ${fmtMs(m.startMs)} | ${escapeCell(m.text)} |`);
    }
    parts.push("");
  }
  if (note.todos.length > 0) {
    parts.push("## \u5F85\u529E", "");
    for (const t of note.todos) parts.push(`- [${t.completed ? "x" : " "}] ${t.text}`);
    parts.push("");
  }
  if (note.audio.length > 0) {
    parts.push("## \u97F3\u9891", "");
    for (const a of note.audio) {
      const label = a.kind === "primary" ? "\u5F55\u97F3" : a.kind === "attachment" ? "\u9644\u4EF6\u97F3\u9891" : "\u65F6\u95F4\u7EBF\u97F3\u9891";
      const dur = a.duration ? ` \xB7 ${fmtSeconds(a.duration)}` : "";
      parts.push(`- ${label}${dur}\uFF1A[\u64AD\u653E](${a.url})`);
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
function yamlString(v) {
  const s = String(v ?? "");
  if (s === "") return '""';
  if (/[:#\[\]{}",\n]/.test(s) || /^\s|\s$/.test(s)) return JSON.stringify(s);
  return s;
}
function yamlBare(v) {
  const s = String(v ?? "");
  if (s === "") return '""';
  if (/[\[\]{},:#"]/.test(s) || /^\s|\s$/.test(s)) return JSON.stringify(s);
  return s;
}
function escapeCell(v) {
  return String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}
function fmtMs(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1e3));
  const h2 = Math.floor(total / 3600);
  const m = Math.floor(total % 3600 / 60);
  const s = total % 60;
  const pad2 = (n) => String(n).padStart(2, "0");
  return h2 > 0 ? `${pad2(h2)}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
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
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw));
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
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
        tags: summary.tags.map((t) => t.name)
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
  const cloudFp = contentFingerprint({ title: full.title, content: full.original || full.content, tags: full.tags.map((t) => t.name) });
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
    const stamp2 = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const altPath = `.conflicts/${stamp2}__cloud-${relPath.split("/").pop() || "note.md"}`;
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
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const conflictPath = `.conflicts/${stamp}__${relPath.split("/").pop() || "note.md"}`;
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
  const listFp = contentFingerprint({ title: note.title, content: note.original || note.content, tags: note.tags.map((t) => t.name) });
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
async function pushNote({ client, root, relPath, noteId } = {}) {
  const { content: fileText } = await readNote(root, relPath);
  const { data, body } = parseFrontmatter(fileText);
  const id = noteId || (typeof data.note_id === "string" ? data.note_id.replace(/^"|"$/g, "") : null);
  const title = (typeof data.title === "string" ? data.title : firstHeading(body)) || "";
  const content = stripSourceFooter(body).replace(/^\s+/, "").replace(/^#\s+.+\n+/, "").trim();
  if (content === "") {
    throw Object.assign(new Error("\u8FD9\u7BC7\u7B14\u8BB0\u6CA1\u6709\u6B63\u6587\uFF0C\u4E0D\u80FD\u63A8\u5230\u4E91\u7AEF\uFF08\u4F1A\u6E05\u7A7A\u4E91\u7AEF\u5185\u5BB9\uFF09"), { status: 400 });
  }
  if (!id) {
    const created = await client.createNote({
      title: title || "\u6765\u81EA DSH \u7684\u7B14\u8BB0",
      content,
      tags: Array.isArray(data.tags) ? data.tags.map(String).filter((t) => t !== "\u5F97\u5230\u5927\u8111") : void 0
    });
    return { action: "created", noteId: created.noteId };
  }
  await client.updateNote({ noteId: id, title: title || void 0, content });
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
var cardState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  lines: [],
  result: null,
  error: null
};
var CARD_MAX_LINES = 300;
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
    req.on("error", (error) => rejectBody(error));
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
    req.on("error", (error) => rejectBody(error));
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
function fail2(res, error) {
  const status = error && typeof error.status === "number" ? error.status : 500;
  const message = error && error.message ? error.message : "internal error";
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
async function openCloudClient() {
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
    } catch (error) {
      const denied = error && (error.status === 401 || error.reason === "invalid_api_key");
      if (!denied) {
        state.decided = true;
        throw error;
      }
      openApiRejected = true;
      lastKeyError = error.message || "API Key \u88AB\u62D2\u7EDD";
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
      } catch (error) {
        errors = [{ path: ".", message: String(error && error.message ? error.message : error) }];
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
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const dir = url.searchParams.get("dir") || "";
    const tag = (url.searchParams.get("tag") || "").trim();
    let filtered = entries;
    if (dir !== "") filtered = filtered.filter((e) => e.dir === dir || e.path.startsWith(`${dir}/`));
    if (tag !== "") filtered = filtered.filter((e) => e.tags.some((t) => t === tag));
    if (q !== "") {
      filtered = filtered.filter(
        (e) => e.title.toLowerCase().includes(q) || e.path.toLowerCase().includes(q) || (e.excerpt || "").toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q))
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
  async function handleArchiveExport(req, res) {
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    const result = await exportVaultToZip(root);
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
        const whole = await readFile2(abs);
        return res.end(whole.subarray(start, end + 1));
      }
    }
    headers["content-length"] = String(st.size);
    res.writeHead(200, headers);
    return res.end(await readFile2(abs));
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
    const paths = Array.isArray(body.paths) ? body.paths.filter((p) => typeof p === "string" && p !== "") : [];
    if (paths.length === 0) throw Object.assign(new Error("\u9700\u8981 paths"), { status: 400 });
    if (action !== "tag" && action !== "move" && action !== "delete") {
      throw Object.assign(new Error("action \u53EA\u80FD\u662F tag / move / delete"), { status: 400 });
    }
    const tag = typeof body.tag === "string" ? body.tag.trim() : "";
    const dir = typeof body.dir === "string" ? body.dir.trim() : "";
    if (action === "tag" && tag === "") throw Object.assign(new Error("\u9700\u8981 tag"), { status: 400 });
    if (action === "move" && dir === "") throw Object.assign(new Error("\u9700\u8981 dir"), { status: 400 });
    const { root, missing } = await currentRoot();
    if (missing) throw Object.assign(new Error(`\u672C\u5730\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${missing}`), { status: 404 });
    let changed = 0;
    const failed = [];
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
          changed += 1;
        }
      } catch (err) {
        failed.push({ path, error: err && err.message ? err.message : String(err) });
      }
    }
    send(res, 200, { ok: true, changed, failed, total: paths.length });
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
        date: typeof body.date === "string" ? body.date : void 0
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
    const q = url.searchParams.get("q") || "";
    if (missing) return send(res, 200, { query: q, hits: [], scanned: 0, truncated: false });
    const result = await searchNotes(root, q, { limit: Math.min(Number(url.searchParams.get("limit")) || 60, 300) });
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
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") || "";
    const pending = pendingAuthorizations.get(state);
    pendingAuthorizations.delete(state);
    if (error) return sendHtml(res, 400, callbackPage("\u6388\u6743\u88AB\u62D2\u7EDD", `\u5F97\u5230\u5927\u8111\u8FD4\u56DE\uFF1A${escapeHtml(error)}`, false));
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
    } catch (error) {
      return send(res, error.status === 401 ? 401 : 502, { ok: false, error: error.message });
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
      } catch (error) {
        importState.error = String(error && error.message ? error.message : error);
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
    } catch (error) {
      send(res, 200, { ok: false, error: String(error && error.message ? error.message : error) });
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
    } catch (error) {
      return send(res, 200, { ok: false, configured: false, error: error.message });
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
    } catch (error) {
      send(res, 200, {
        ok: false,
        configured: true,
        reachable: error.status !== 502,
        status: error.status ?? null,
        reason: error.reason ?? null,
        requestId: error.requestId ?? null,
        error: error.message
      });
    }
  }
  async function handleCloudList(res, url) {
    const client = await openCloudClient();
    const cursor = url.searchParams.get("cursor") || void 0;
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 50);
    const page = await client.listNotes({ cursor, limit });
    send(res, 200, {
      notes: page.notes.map((n) => normalizeNote(n)).filter(Boolean),
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
    } catch (error) {
      local = { error: error.message };
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
    } catch (error) {
      local = { error: error.message };
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
    send(res, 200, { ...result, notes: result.notes.map((n) => normalizeNote(n, { topicName: "" })).filter(Boolean) });
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
      results: results.map((r) => {
        const n = normalizeNote(r.note ?? r, {});
        return n ? { ...n, score: typeof r.score === "number" ? r.score : null } : null;
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
      const v = upstream.headers.get(key);
      if (v) headers[key] = v;
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
    } catch (error) {
      return send(res, error.status === 401 ? 401 : 502, { ok: false, error: error.message });
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
    const options = {
      all: body.all !== false,
      names: typeof body.names === "string" ? body.names : "",
      deleteAfter: body.deleteAfter === true,
      dir: typeof body.dir === "string" && body.dir.trim() !== "" ? body.dir.trim() : "\u5F55\u97F3\u5361",
      log: push
    };
    void (async () => {
      try {
        const result = await importCardRecordings(root, options);
        cardState.result = result;
        if (result.failed > 0) {
          cardState.error = `${result.failed} \u4E2A\u6587\u4EF6\u5BFC\u5165\u5931\u8D25\uFF0C\u8BE6\u60C5\u770B\u65E5\u5FD7`;
        }
      } catch (error) {
        cardState.error = error && error.message ? error.message : String(error);
        push(`\u51FA\u9519\uFF1A${cardState.error}`);
      } finally {
        cardState.running = false;
        cardState.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
    })();
    return send(res, 200, { ok: true, running: true, startedAt: cardState.startedAt });
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
        if (action === "settings") return await handleGetSettings(res);
        if (action === "probe") return await handleProbe(req, res);
        if (action === "import" && parts[2] === "status") return handleImportStatus(res);
        if (action === "conflict" && parts[2] === "list") return await handleConflictList(res);
        if (action === "conflict" && parts[2] === "read") return await handleConflictRead(res, url);
        if (action === "history" && parts[2] === "list") return await handleHistoryList(res, url);
        if (action === "history" && parts[2] === "read") return await handleHistoryRead(res, url);
        if (action === "archive" && parts[2] === "export") return await handleArchiveExport(req, res);
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
    } catch (error) {
      return fail2(res, error);
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
    for (const e of result.errors) log(`\u5931\u8D25\uFF1A${e.title || e.noteId || e.stage} \u2014 ${e.message}`);
    return { ok: true, ...syncState.lastResult, lines };
  } catch (error) {
    syncState.lastError = String(error && error.message ? error.message : error);
    log(`\u540C\u6B65\u4E2D\u65AD\uFF1A${syncState.lastError}`);
    return { ok: false, error: syncState.lastError, lines, status: error.status ?? null };
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
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error);
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
    Promise.resolve(handler(req, res)).catch((error) => {
      const message = error && error.message ? error.message : String(error);
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
    } catch (error) {
      lastError = error;
      if (port === 0) throw error;
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

// src/view/panel.js
var React = __toESM(require_react(), 1);
var __apiBase = "";
function setApiOrigin(origin) {
  __apiBase = String(origin || "").replace(/\/+$/, "");
}
function apiOrigin() {
  return __apiBase;
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
function setOpenExternal(fn) {
  __openExternal = typeof fn === "function" ? fn : null;
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
var __saveFile = null;
function setSaveFile(fn) {
  __saveFile = typeof fn === "function" ? fn : null;
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
var h = React.createElement;
var NS = "dsh-getnote";
var STYLE_ID = "dshgn-style";
var LEX = {
  zh: {
    "panel.title": "\u5F97\u5230\u5927\u8111",
    "panel.hint": "\u672C\u5730\u7B14\u8BB0\u5E93",
    "tab.notes": "\u7B14\u8BB0",
    "tab.import": "\u5BFC\u5165",
    "tab.settings": "\u8BBE\u7F6E",
    "action.refresh": "\u5237\u65B0",
    "action.new": "\u65B0\u5EFA",
    "action.save": "\u4FDD\u5B58",
    "action.cancel": "\u53D6\u6D88",
    "action.edit": "\u7F16\u8F91",
    "action.delete": "\u5220\u9664",
    "action.copyRef": "\u590D\u5236\u5F15\u7528",
    "action.copied": "\u5DF2\u590D\u5236",
    "action.retry": "\u91CD\u8BD5",
    "search.placeholder": "\u641C\u7D22\u6807\u9898\u3001\u6B63\u6587\u3001\u6807\u7B7E\u2026",
    "search.hint": "\u53EF\u4EE5\u52A0\u9650\u5B9A\uFF1Atag:\u5F55\u97F3\u5361 \xB7 dir:\u968F\u624B\u8BB0 \xB7 #\u79C1\u5BC6\u3002\u591A\u4E2A\u8BCD\u8981\u540C\u65F6\u547D\u4E2D\u3002",
    "batch.pick": "\u9009\u62E9\u8FD9\u7BC7",
    "batch.picked": "\u7BC7\u5DF2\u9009",
    "batch.actions": "\u6279\u91CF\u64CD\u4F5C",
    "batch.clear": "\u53D6\u6D88\u9009\u62E9",
    "batch.tagPlaceholder": "\u8981\u6DFB\u52A0\u7684\u6807\u7B7E",
    "batch.addTag": "\u52A0\u6807\u7B7E",
    "batch.dirPlaceholder": "\u76EE\u6807\u76EE\u5F55",
    "batch.move": "\u79FB\u52A8",
    "batch.delete": "\u79FB\u5230\u56DE\u6536\u7AD9",
    "batch.confirmDelete": "\u786E\u5B9A\u628A\u8FD9 \u7BC7\u79FB\u5230\u56DE\u6536\u7AD9\uFF1F",
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
    "tree.dirCreated": "\u76EE\u5F55\u5DF2\u521B\u5EFA\uFF08\u7A7A\u76EE\u5F55\u6682\u65F6\u4E0D\u663E\u793A\u5728\u5217\u8868\u91CC\uFF09",
    "tree.tagCreated": "\u6807\u7B7E\u5DF2\u6DFB\u52A0\u5230\u5F53\u524D\u7B14\u8BB0",
    "tree.tagNeedNote": "\u5148\u6253\u5F00\u4E00\u7BC7\u7B14\u8BB0\u518D\u5EFA\u6807\u7B7E",
    "tree.menuDelete": "\u5220\u9664",
    "tree.menuCancel": "\u53D6\u6D88",
    "tree.menuRename": "\u6539\u540D",
    "tree.tagRenamed": "\u6807\u7B7E\u5DF2\u6539\u540D",
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
    "empty.select": "\u9009\u4E00\u7BC7\u7B14\u8BB0\u5F00\u59CB\u9605\u8BFB",
    "empty.selectDesc": "\u5DE6\u680F\u662F\u76EE\u5F55\uFF0C\u4E2D\u95F4\u662F\u7B14\u8BB0\u5217\u8868\u3002\u4E5F\u53EF\u4EE5\u70B9\u300C\u65B0\u5EFA\u300D\u5199\u4E00\u7BC7\u3002",
    "empty.search": "\u6CA1\u6709\u5339\u914D\u7684\u7B14\u8BB0",
    "meta.notes": "\u7BC7",
    "meta.dirs": "\u4E2A\u76EE\u5F55",
    "reader.missing": "\u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u79FB\u52A8",
    "reader.frontmatter": "\u5C5E\u6027",
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
    "settings.vaultHint": "\u76F8\u5BF9\u5E93\u6839\u7684\u76EE\u5F55\u540D\uFF0C\u6BD4\u5982\u300C\u5F97\u5230\u5927\u8111\u300D\u6216\u300C\u674E\u6B23\u9880/\u77E5\u8BC6\u5E93/\u5F97\u5230\u5927\u8111\u5F52\u6863\u300D\u3002\u53EA\u80FD\u9009\u5E93\u5185\u7684\u76EE\u5F55\uFF0C\u63D2\u4EF6\u4E0D\u4F1A\u5199\u5230\u5E93\u5916\u9762\u53BB\u3002",
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
    "note.created": "\u5DF2\u65B0\u5EFA",
    "note.saved": "\u5DF2\u4FDD\u5B58",
    "note.deleted": "\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9",
    "note.unsaved": "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539",
    "note.localAudio": "\u672C\u5730\u5F55\u97F3",
    "note.outline": "\u672C\u6587\u5927\u7EB2",
    "note.backlinks": "\u5F15\u7528\u4E86\u8FD9\u7BC7\u7684\u7B14\u8BB0",
    "note.fontSize": "\u5B57\u53F7",
    "panel.loading": "\u6B63\u5728\u8BFB\u53D6\u7B14\u8BB0\u5E93\u2026",
    "sync.pushOne": "\u628A\u8FD9\u7BC7\u63A8\u5230\u4E91\u7AEF",
    "sync.pullOne": "\u4ECE\u4E91\u7AEF\u62C9\u8FD9\u7BC7",
    "sync.pushedOne": "\u5DF2\u63A8\u5230\u4E91\u7AEF",
    "sync.pulledOne": "\u5DF2\u4ECE\u4E91\u7AEF\u66F4\u65B0",
    "new.template": "\u65B0\u5EFA\u4EC0\u4E48",
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
    "new.bookTitle": "\u8BFB\u4E66\u7B14\u8BB0",
    "new.meetingTitle": "\u4F1A\u8BAE\u8BB0\u5F55",
    "note.fontSize.s": "\u5C0F\u5B57",
    "note.fontSize.m": "\u6807\u51C6",
    "note.fontSize.l": "\u5927\u5B57",
    "note.wikilinkMissing": "\u5E93\u91CC\u627E\u4E0D\u5230\u300C{name}\u300D\u8FD9\u7BC7\u7B14\u8BB0",
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
    "tab.notes": "Notes",
    "tab.import": "Import",
    "tab.settings": "Settings",
    "action.refresh": "Refresh",
    "action.new": "New",
    "action.save": "Save",
    "action.cancel": "Cancel",
    "action.edit": "Edit",
    "action.delete": "Delete",
    "action.copyRef": "Copy reference",
    "action.copied": "Copied",
    "action.retry": "Retry",
    "search.placeholder": "Search title, body, tags\u2026",
    "search.hint": "Narrow it down: tag:voice \xB7 dir:notes \xB7 #private. All words must match.",
    "batch.pick": "Select this note",
    "batch.picked": "selected",
    "batch.actions": "Batch actions",
    "batch.clear": "Clear selection",
    "batch.tagPlaceholder": "Tag to add",
    "batch.addTag": "Add tag",
    "batch.dirPlaceholder": "Target folder",
    "batch.move": "Move",
    "batch.delete": "Move to trash",
    "batch.confirmDelete": "Move these notes to trash?",
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
    "tree.dirCreated": "Folder created (empty folders stay hidden)",
    "tree.tagCreated": "Tag added to the open note",
    "tree.tagNeedNote": "Open a note first to add a tag",
    "tree.menuDelete": "Delete",
    "tree.menuCancel": "Cancel",
    "tree.menuRename": "Rename",
    "tree.tagRenamed": "Tag renamed",
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
    "empty.select": "Pick a note to read",
    "empty.selectDesc": "Folders on the left, notes in the middle. Or press New.",
    "empty.search": "No matching notes",
    "meta.notes": "notes",
    "meta.dirs": "folders",
    "reader.missing": "File is missing or was moved",
    "reader.frontmatter": "Properties",
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
    "note.created": "Created",
    "note.saved": "Saved",
    "note.deleted": "Moved to trash",
    "note.unsaved": "Unsaved changes",
    "note.localAudio": "Local recording",
    "note.outline": "Outline",
    "note.backlinks": "Notes linking here",
    "note.fontSize": "Text size",
    "panel.loading": "Loading vault\u2026",
    "sync.pushOne": "Push this note",
    "sync.pullOne": "Pull this note",
    "sync.pushedOne": "Pushed to cloud",
    "sync.pulledOne": "Updated from cloud",
    "new.template": "Start a new",
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
    "new.bookTitle": "Book notes",
    "new.meetingTitle": "Meeting",
    "note.fontSize.s": "Small",
    "note.fontSize.m": "Normal",
    "note.fontSize.l": "Large",
    "note.wikilinkMissing": 'No note named "{name}" in this vault',
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
    "tab.notes": "Notities",
    "tab.import": "Importeren",
    "tab.settings": "Instellingen",
    "action.refresh": "Vernieuwen",
    "action.new": "Nieuw",
    "action.save": "Opslaan",
    "action.cancel": "Annuleren",
    "action.edit": "Bewerken",
    "action.delete": "Verwijderen",
    "action.copyRef": "Referentie kopi\xEBren",
    "action.copied": "Gekopieerd",
    "action.retry": "Opnieuw",
    "search.placeholder": "Zoek titel, tekst, tags\u2026",
    "search.hint": "Verfijn: tag:spraak \xB7 dir:notities \xB7 #priv\xE9. Alle woorden moeten voorkomen.",
    "batch.pick": "Deze notitie selecteren",
    "batch.picked": "geselecteerd",
    "batch.actions": "Bulkacties",
    "batch.clear": "Selectie wissen",
    "batch.tagPlaceholder": "Tag om toe te voegen",
    "batch.addTag": "Tag toevoegen",
    "batch.dirPlaceholder": "Doelmap",
    "batch.move": "Verplaatsen",
    "batch.delete": "Naar prullenbak",
    "batch.confirmDelete": "Deze notities naar de prullenbak verplaatsen?",
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
    "tree.dirCreated": "Map aangemaakt (lege mappen blijven verborgen)",
    "tree.tagCreated": "Tag toegevoegd aan de geopende notitie",
    "tree.tagNeedNote": "Open eerst een notitie om een tag toe te voegen",
    "tree.menuDelete": "Verwijderen",
    "tree.menuCancel": "Annuleren",
    "tree.menuRename": "Naam wijzigen",
    "tree.tagRenamed": "Tag hernoemd",
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
    "empty.select": "Kies een notitie om te lezen",
    "empty.selectDesc": "Mappen links, notities in het midden. Of druk op Nieuw.",
    "empty.search": "Geen passende notities",
    "meta.notes": "notities",
    "meta.dirs": "mappen",
    "reader.missing": "Bestand ontbreekt of is verplaatst",
    "reader.frontmatter": "Eigenschappen",
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
    "note.created": "Aangemaakt",
    "note.saved": "Opgeslagen",
    "note.deleted": "Naar prullenbak",
    "note.unsaved": "Niet-opgeslagen wijzigingen",
    "note.localAudio": "Lokale opname",
    "note.outline": "Overzicht",
    "note.backlinks": "Notities die hierheen linken",
    "note.fontSize": "Tekstgrootte",
    "panel.loading": "Notitiemap laden\u2026",
    "sync.pushOne": "Deze notitie pushen",
    "sync.pullOne": "Deze notitie ophalen",
    "sync.pushedOne": "Naar de cloud gepusht",
    "sync.pulledOne": "Bijgewerkt vanuit de cloud",
    "new.template": "Begin met een",
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
    "new.bookTitle": "Boeknotities",
    "new.meetingTitle": "Vergadering",
    "note.fontSize.s": "Klein",
    "note.fontSize.m": "Normaal",
    "note.fontSize.l": "Groot",
    "note.wikilinkMissing": "Geen notitie met de naam \u2018{name}\u2019 in deze map",
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
function setUiLocale(value) {
  uiLocale = value === "zh" || value === "en" || value === "nl" ? value : null;
}
function activeUiLocale() {
  return uiLocale;
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
    if (uiLocale !== null) {
      const dict = LEX[uiLocale];
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
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
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
    } catch (error) {
      const aborted = error !== null && typeof error === "object" && (error.name === "AbortError" || signal.aborted);
      if (aborted) throw error;
      const hasStatus = error !== null && typeof error === "object" && typeof error.status === "number";
      const retryable = idempotent && !hasStatus && attempt < RETRY_DELAYS.length;
      if (!retryable) throw error;
      await sleep2(RETRY_DELAYS[attempt]);
      attempt += 1;
    }
  }
}
function formatBytes2(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function assetLabel(name) {
  const raw = String(name || "");
  if (raw === "") return "";
  const ext = (/\.([a-z0-9]+)$/i.exec(raw) || [])[1] || "";
  let stem = ext === "" ? raw : raw.slice(0, -(ext.length + 1));
  for (let i = 0; i < 4; i += 1) {
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
function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h2;
  if (max === rn) h2 = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h2 = ((bn - rn) / d + 2) / 6;
  else h2 = ((rn - gn) / d + 4) / 6;
  return { h: h2, s, l };
}
function hslToHex(h2, s, l) {
  const hue = (h2 % 1 + 1) % 1;
  const sat = Math.min(1, Math.max(0, s));
  const lig = Math.min(1, Math.max(0, l));
  if (sat === 0) {
    const v = Math.round(lig * 255);
    const hex = v.toString(16).padStart(2, "0");
    return `#${hex}${hex}${hex}`;
  }
  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
  const p = 2 * lig - q;
  const channel = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    let value;
    if (tt < 1 / 6) value = p + (q - p) * 6 * tt;
    else if (tt < 1 / 2) value = q;
    else if (tt < 2 / 3) value = p + (q - p) * (2 / 3 - tt) * 6;
    else value = p;
    return Math.round(value * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(hue + 1 / 3)}${channel(hue)}${channel(hue - 1 / 3)}`;
}
function themeVars(input) {
  const rgb = parseHex(input);
  if (rgb === null) return null;
  const base = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const hue = base.h;
  const sat = base.s;
  const tint = (min, max) => sat < 0.12 ? Math.min(sat, 0.06) : Math.min(max, Math.max(min, sat));
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
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
  note: "M5 4h9l5 5v11H5Z M14 4v5h5 M8 13h8 M8 17h5"
};
function Icon(props) {
  const size = props && typeof props.size === "number" ? props.size : 16;
  const name = props && props.name ? props.name : "brain";
  const path = ICONS[name] || ICONS.brain;
  return h(
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
      (segment, index) => h("path", { key: index, d: index === 0 ? segment : `M${segment}` })
    )
  );
}
function renderInline(text, keyPrefix, options) {
  const opts = options || {};
  const nodes = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(!?\[\[[^\]\n]+\]\])|(\[[^\]\n]*\]\([^)\s]+\))|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let match;
  let seq = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${seq++}`;
    if (token.startsWith("`")) {
      nodes.push(h("code", { key, className: "dshgn_code" }, token.slice(1, -1)));
    } else if (token.startsWith("**")) {
      nodes.push(h("strong", { key }, token.slice(2, -2)));
    } else if (token.startsWith("*")) {
      nodes.push(h("em", { key }, token.slice(1, -1)));
    } else if (token.startsWith("[[") || token.startsWith("![[")) {
      const embed = token.startsWith("!");
      const inner = token.slice(embed ? 3 : 2, -2);
      const pipe = inner.indexOf("|");
      const target = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
      const label = (pipe === -1 ? inner : inner.slice(pipe + 1)).trim();
      if (embed) {
        nodes.push(h("span", { key, className: "dshgn_embed" }, renderEmbed(target, key, opts)));
      } else {
        nodes.push(
          h(
            "button",
            {
              key,
              type: "button",
              className: "dshgn_wikilink",
              // 双链在 Obsidian 里是跳转。这里没有 Obsidian 的解析器，尽力而为：
              // 有完整路径就按路径打开，只写标题就在当前库里按标题/文件名找。
              onClick: () => {
                if (typeof opts.onOpenWikiLink === "function") opts.onOpenWikiLink(target);
              }
            },
            label || target
          )
        );
      }
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      nodes.push(
        h(
          "a",
          { key, href, target: "_blank", rel: "noreferrer noopener", className: "dshgn_link" },
          label
        )
      );
    } else {
      nodes.push(
        h("a", { key, href: token, target: "_blank", rel: "noreferrer noopener", className: "dshgn_link" }, token)
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
var IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;
function renderEmbed(target, key, options) {
  const opts = options || {};
  const clean = String(target || "").trim();
  if (clean === "") return null;
  const assets = Array.isArray(opts.assets) ? opts.assets : [];
  const base = clean.split("/").pop();
  const hit = assets.find((a) => a.name === clean || a.name === base);
  const path = hit && hit.path || clean;
  if (IMAGE_EXT_RE.test(path)) {
    return h("img", {
      key,
      className: "dshgn_img",
      src: withToken(`${apiOrigin()}/getnote/asset?path=${encodeURIComponent(path)}`),
      alt: base,
      loading: "lazy"
    });
  }
  return h("span", { key, className: "dshgn_embedFile" }, base);
}
function parseTable(lines, start) {
  const headerCells = splitRow(lines[start]);
  if (headerCells === null) return null;
  if (start + 1 >= lines.length) return null;
  if (!/^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[start + 1])) return null;
  const rows = [];
  let index = start + 2;
  while (index < lines.length && lines[index].trim().startsWith("|")) {
    const cells = splitRow(lines[index]);
    if (cells === null) break;
    rows.push(cells);
    index += 1;
  }
  return { header: headerCells, rows, consumed: index - start };
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
function renderBlocks(markdown, options) {
  const opts = options || {};
  const lines = String(markdown || "").split(/\r?\n/);
  const blocks = [];
  let index = 0;
  let key = 0;
  const todoCounter = typeof opts.onToggleTodo === "function" ? { n: 0 } : null;
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
        looksLikeTranscript(fenceText) ? h(TranscriptBlock, { key: `b${key++}`, text: fenceText }) : h(
          "pre",
          { key: `b${key++}`, className: "dshgn_pre" },
          lang ? h("span", { className: "dshgn_preLang" }, lang) : null,
          h("code", null, fenceText)
        )
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      blocks.push(
        h(
          `h${Math.min(level + 0, 6)}`,
          { key: `b${key++}`, className: `dshgn_h dshgn_h${level}` },
          renderInline(heading[2], `b${key}`, opts)
        )
      );
      index += 1;
      continue;
    }
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(h("hr", { key: `b${key++}`, className: "dshgn_hr" }));
      index += 1;
      continue;
    }
    if (trimmed.startsWith("|")) {
      const table = parseTable(lines, index);
      if (table) {
        blocks.push(
          h(
            "div",
            { key: `b${key++}`, className: "dshgn_tableWrap" },
            h(
              "table",
              { className: "dshgn_table" },
              h(
                "thead",
                null,
                h(
                  "tr",
                  null,
                  table.header.map((cell, i) => h("th", { key: i }, renderInline(cell, `th${i}`, opts)))
                )
              ),
              h(
                "tbody",
                null,
                table.rows.map(
                  (row, rowIndex) => h(
                    "tr",
                    { key: rowIndex },
                    row.map(
                      (cell, cellIndex) => h("td", { key: cellIndex }, renderInline(cell, `td${rowIndex}-${cellIndex}`, opts))
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
      blocks.push(
        h(
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
          if (lines[index].trim() !== "" && items.length > 0 && /^\s{2,}\S/.test(lines[index])) {
            items[items.length - 1].continuation.push(lines[index].trim());
            index += 1;
            continue;
          }
          break;
        }
        items.push({ text: current[3], ordered: /\d/.test(current[2]), continuation: [] });
        index += 1;
      }
      blocks.push(
        h(
          ordered ? "ol" : "ul",
          { key: `b${key++}`, className: "dshgn_mdList" },
          items.map((item, itemIndex) => {
            const task = /^\[( |x|X)\]\s+(.*)$/.exec(item.text);
            const content = task ? task[2] : item.text;
            let todoIndex = -1;
            if (task && todoCounter !== null) {
              todoIndex = todoCounter.n;
              todoCounter.n += 1;
            }
            const done = task !== null && task[1].toLowerCase() === "x";
            return h(
              "li",
              { key: itemIndex, className: task ? "dshgn_li dshgn_task" : "dshgn_li" },
              task ? h("span", {
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
              item.continuation.length > 0 ? h("div", { className: "dshgn_liCont" }, renderInline(item.continuation.join(" "), `lc${itemIndex}`, opts)) : null
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
    blocks.push(
      h("p", { key: `b${key++}`, className: "dshgn_p" }, renderInline(paragraph.join("\n"), `p${key}`, opts))
    );
  }
  return blocks;
}
var CSS = `
.dshgn_root{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;
  background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary);font-size:13px}
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
.dshgn_outlineItem{appearance:none;display:block;width:100%;padding:3px 10px;border:0;
  background:transparent;font:inherit;font-size:12px;line-height:1.5;
  color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshgn_outlineItem:hover{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-brand-primary)}
/* \u5173\u8054\u7B14\u8BB0\uFF1A\u6B63\u6587\u8BFB\u5B8C\u624D\u51FA\u73B0\uFF0C\u6240\u4EE5\u6837\u5F0F\u6BD4\u5927\u7EB2\u66F4\u8F7B\u2014\u2014\u5B83\u662F\u4E00\u6761\u8865\u5145\u4FE1\u606F\uFF0C\u4E0D\u8BE5\u62A2\u6B63\u6587\u89C6\u7EBF\u3002 */
.dshgn_backlinks{margin-top:18px;padding-top:12px;border-top:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_backlinksHead{display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:11px;
  color:var(--dsw-alias-label-tertiary)}
.dshgn_backlinkItem{appearance:none;display:flex;flex-direction:column;gap:2px;width:100%;
  padding:6px 9px;margin-bottom:3px;border:0;border-radius:7px;
  background:var(--dsw-alias-interactive-bg-hover);font:inherit;cursor:pointer;text-align:left}
.dshgn_backlinkItem:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}
.dshgn_backlinkTitle{font-size:12px;color:var(--dsw-alias-brand-primary);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshgn_backlinkPath{font-size:10px;color:var(--dsw-alias-label-dimmed);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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
  border-bottom:0.5px solid rgba(var(--dshgn-tintRgb),.14);background:rgba(255,255,255,.5)}
.dshgn_batchCount{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dshgn_batchBtn{appearance:none;border:0;background:transparent;cursor:pointer;
  font:inherit;font-size:11px;padding:2px 6px;border-radius:5px;
  color:var(--dsw-alias-label-secondary)}
.dshgn_batchBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_batchMenu{flex-basis:100%;display:flex;flex-direction:column;gap:6px;
  padding:8px;margin-top:2px;border-radius:8px;background:#fff;
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
.dshgn_matchLine{display:flex;gap:5px;font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary)}
.dshgn_matchNo{flex:none;min-width:18px;text-align:right;font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-dimmed);font-size:10px;padding-top:1px}
.dshgn_matchText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_searchHint{padding:0 10px 7px;font-size:10px;line-height:1.5;
  color:var(--dsw-alias-label-dimmed)}
.dshgn_searching{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary)}
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
/* \u9AA8\u67B6\u5C4F\uFF1A\u7528\u4E00\u6761\u8109\u52A8\u7684\u6D45\u8272\u5757\u5360\u4F4D\u3002\u52A8\u753B\u53EA\u6539 opacity\uFF0C\u4E0D\u6539\u5C3A\u5BF8\u2014\u2014
   \u6539\u5C3A\u5BF8\u4F1A\u89E6\u53D1\u91CD\u6392\uFF0C\u4E09\u680F\u9AA8\u67B6\u4E00\u8D77\u6296\u770B\u7740\u50CF\u5361\u4F4F\u3002 */
.dshgn_skTree,.dshgn_skList,.dshgn_skNote{padding:14px 12px;gap:9px}
.dshgn_skTree{display:flex;flex-direction:column}
.dshgn_skList{display:flex;flex-direction:column;gap:10px}
.dshgn_skNote{display:flex;flex-direction:column;gap:11px}
.dshgn_skCard{display:flex;flex-direction:column;gap:7px;padding:10px 11px;border-radius:8px;
  background:rgba(255,255,255,.42)}
.dshgn_skRow{border-radius:5px;background:var(--dsw-alias-interactive-bg-hover);
  animation:dshgn_skPulse 1.4s ease-in-out infinite}
.dshgn_skTree .dshgn_skRow{background:rgba(255,255,255,.16)}
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
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;
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
.dshgn_tree{flex:none;width:190px;display:flex;flex-direction:column;min-height:0;
  border-right:0.5px solid var(--dsw-alias-border-l2);overflow-y:auto;overflow-x:hidden;padding:8px 6px}
.dshgn_treeHead{display:flex;align-items:center;justify-content:space-between;gap:6px;
  padding:4px 6px;font-size:11px;color:var(--dsw-alias-label-tertiary);user-select:none}
.dshgn_treeRow{display:flex;align-items:center;gap:6px;height:26px;padding:0 7px;border-radius:7px;
  color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;user-select:none}
.dshgn_treeRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_treeRow[data-on="true"]{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-primary)}
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
.dshgn_list{flex:none;width:260px;display:flex;flex-direction:column;min-height:0;
  border-right:0.5px solid var(--dsw-alias-border-l2)}
.dshgn_searchWrap{flex:none;display:flex;align-items:center;gap:6px;padding:8px 10px;
  border-bottom:0.5px solid var(--dsw-alias-border-l2)}
.dshgn_search{flex:1;min-width:0;height:26px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l2);
  border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;
  font-size:12px;outline:none}
.dshgn_search:focus{border-color:var(--dsw-alias-brand-primary)}
/* \u641C\u7D22\u6846\u5DE6\u4FA7\u7684\u653E\u5927\u955C\uFF1A\u4EE5\u524D\u6CA1\u6709\u89C4\u5219\uFF0C\u56FE\u6807\u4F1A\u88AB input \u7684 flex:1 \u6324\u5230\u8D34\u8FB9 */
.dshgn_searchIcon{flex:none;color:var(--dsw-alias-label-tertiary);pointer-events:none}
/* \u4FA7\u680F\u5165\u53E3\u56FE\u6807\uFF08ownerProps.size \u51B3\u5B9A\u5C3A\u5BF8\uFF0C\u8FD9\u91CC\u53EA\u4FDD\u8BC1\u5757\u7EA7\u5BF9\u9F50\uFF09 */
.dshgn_sideIcon{display:block;flex:none}
.dshgn_listBody{flex:1;overflow-y:auto;padding:6px}
.dshgn_card{display:flex;flex-direction:column;gap:2px;padding:7px 8px;border-radius:8px;cursor:pointer;
  border-left:2px solid transparent;user-select:none}
.dshgn_card:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_card[data-on="true"]{background:var(--dsw-alias-interactive-bg-hover-accent);
  border-left-color:var(--dsw-alias-brand-primary)}
.dshgn_cardTitle{font-size:12px;line-height:17px;color:var(--dsw-alias-label-primary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_cardMeta{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;white-space:nowrap}
.dshgn_cardExcerpt{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_note{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
.dshgn_noteHead{flex:none;display:flex;align-items:center;gap:8px;padding:8px 14px;
  border-bottom:0.5px solid var(--dsw-alias-border-l2)}
.dshgn_notePath{flex:1;min-width:0;font-size:11px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_scroll{flex:1;overflow-y:auto;padding:16px clamp(16px,3vw,32px) 48px}
.dshgn_md{max-width:760px;margin:0 auto;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.75}
.dshgn_h{font-size:1em;margin:18px 0 8px;line-height:1.4;font-weight:600;color:var(--dsw-alias-label-primary)}
/* \u6807\u9898\u7528 em \u800C\u4E0D\u662F px\uFF1A\u5B57\u53F7\u4E09\u6863\u53EA\u6539 .dshgn_md \u7684\u57FA\u51C6\u5B57\u53F7\uFF0C\u6807\u9898\u6309\u6BD4\u4F8B\u8DDF\u7740\u653E\u5927\uFF0C
   \u6574\u7BC7\u5C42\u7EA7\u5173\u7CFB\u4E0D\u53D8\u3002\u5199\u6B7B px \u7684\u8BDD\u628A\u6B63\u6587\u8C03\u5230 15px\uFF0C\u4E8C\u7EA7\u6807\u9898\u53CD\u800C\u6BD4\u6B63\u6587\u8FD8\u5C0F\u3002 */
.dshgn_h1{font-size:1.48em;margin-top:0}
.dshgn_h2{font-size:1.19em;padding-bottom:5px;border-bottom:0.5px solid var(--dsw-alias-border-l2)}
.dshgn_h3{font-size:1.05em}
.dshgn_h4,.dshgn_h5,.dshgn_h6{font-size:.96em}
.dshgn_p{margin:8px 0;white-space:pre-wrap;word-break:break-word}
.dshgn_hr{border:0;border-top:0.5px solid var(--dsw-alias-border-l2);margin:16px 0}
.dshgn_link{color:var(--dsw-alias-brand-primary);text-decoration:none}
.dshgn_link:hover{text-decoration:underline}
/* \u5916\u94FE\u6309\u94AE\uFF1A\u5916\u89C2\u7167\u94FE\u63A5\u8D70\uFF0C\u884C\u4E3A\u662F\u6309\u94AE\uFF08\u907F\u514D\u81EA\u5B9A\u4E49\u89C6\u56FE\u91CC\u70B9\u5916\u94FE\u628A\u5E94\u7528\u5BFC\u822A\u8D70\uFF09 */
.dshgn_linkBtn{background:none;border:0;padding:0;font:inherit;cursor:pointer;text-align:left}
.dshgn_code{padding:1px 5px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover);
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.dshgn_pre{position:relative;margin:10px 0;padding:11px 12px;border-radius:9px;overflow-x:auto;
  background:var(--dsw-alias-interactive-bg-hover);border:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_pre code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;
  line-height:1.65;white-space:pre;color:var(--dsw-alias-label-primary)}
.dshgn_preLang{position:absolute;top:4px;right:8px;font-size:10px;color:var(--dsw-alias-label-dimmed)}
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
  font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);
  font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);
  user-select:none}
.dshgn_transcript .dshgn_speaker{color:var(--dsw-alias-brand-primary);font-weight:600;margin-right:6px}
.dshgn_quote{margin:10px 0;padding:2px 0 2px 12px;border-left:2px solid var(--dsw-alias-border-l2);
  color:var(--dsw-alias-label-secondary)}
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
.dshgn_table{border-collapse:collapse;font-size:12px;min-width:100%}
.dshgn_table th,.dshgn_table td{padding:6px 10px;text-align:left;
  border-bottom:0.5px solid var(--dsw-alias-border-l2);vertical-align:top}
.dshgn_table th{color:var(--dsw-alias-label-secondary);font-weight:600;
  background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_editor{flex:1;width:100%;box-sizing:border-box;resize:none;border:0;outline:none;padding:16px clamp(16px,3vw,32px);
  background:transparent;color:var(--dsw-alias-label-primary);
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.7}
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
.dshgn_badge{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:10px;
  font-size:10.5px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dshgn_badgeOk{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-brand-primary)}
.dshgn_badgeWarn{background:transparent;color:var(--dsw-alias-state-warn-primary);
  box-shadow:inset 0 0 0 0.5px var(--dsw-alias-state-warn-primary)}
.dshgn_badgeErr{color:var(--dsw-alias-state-error-primary)}
.dshgn_log{max-height:220px;overflow-y:auto;padding:8px 10px;border-radius:8px;
  background:var(--dsw-alias-interactive-bg-hover);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:11px;line-height:1.7;color:var(--dsw-alias-label-secondary);white-space:pre-wrap}
.dshgn_error{padding:8px 10px;border-radius:8px;font-size:11.5px;line-height:1.6;
  color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_toast{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:20;
  display:flex;align-items:center;gap:6px;padding:7px 13px;border-radius:9px;
  background:var(--dsw-alias-toast-bg);color:var(--dsw-alias-toast-label);
  font-size:12px;box-shadow:0 6px 22px rgba(0,0,0,.16)}
.dshgn_rel{position:relative;height:100%}
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
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap}
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
  color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
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
.dshgn_img{max-width:100%;max-height:200px;border-radius:8px;object-fit:contain;
  border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-interactive-bg-hover)}
/* Obsidian \u53CC\u94FE\uFF1A\u5916\u89C2\u8981\u50CF\u94FE\u63A5\u4F46\u4E0D\u80FD\u771F\u8DF3\uFF08\u5E93\u5185\u8DF3\u8F6C\u7531 JS \u5904\u7406\uFF09\uFF0C\u6240\u4EE5\u7528 button \u800C\u4E0D\u662F a\u3002 */
.dshgn_wikilink{display:inline;padding:0;margin:0;border:0;background:transparent;font:inherit;
  color:var(--dsw-alias-brand-primary);cursor:pointer;text-decoration:none;
  border-bottom:0.5px solid currentColor}
.dshgn_wikilink:hover{color:var(--dsw-alias-brand-primary);border-bottom-color:transparent}
/* \u5D4C\u5165\u7684\u975E\u56FE\u7247\u9644\u4EF6\uFF08![[x.pdf]] \u8FD9\u7C7B\uFF09\uFF1A\u53EA\u663E\u793A\u6210\u4E00\u9897\u6587\u4EF6\u540D\u80F6\u56CA\uFF0C\u70B9\u4E0D\u5F00\u4E5F\u4E0D\u5047\u88C5\u80FD\u70B9\u3002 */
.dshgn_embed{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;
  border-radius:10px;border:0.5px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-interactive-bg-hover);font-size:11px;
  color:var(--dsw-alias-label-secondary);white-space:nowrap;vertical-align:middle}
.dshgn_embedFile{font-size:11px;color:var(--dsw-alias-label-tertiary)}
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
  --dsw-alias-bg-overlay:#ffffff;
  --dsw-alias-brand-primary:var(--dshgn-accentOnLight);
}
.dshgn_tabs{background:rgba(var(--dshgn-tintRgb),.07);border-radius:10px}
.dshgn_tab[data-on="true"]{background:#ffffff;box-shadow:0 1px 3px rgba(var(--dshgn-tintRgb),.14)}

/* \u2500\u2500 \u5DE6\u680F\uFF1A\u6DF1\u84DD\u3002\u6574\u680F\u7528\u4E0A\u6DF1\u4E0B\u66F4\u6DF1\u7684\u6E10\u53D8\uFF0C\u8FB9\u754C\u9760\u4E00\u6761\u4EAE\u7EBF\u6536\u4F4F \u2500\u2500 */
.dshgn_tree{
  width:204px;
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
  padding:24px;background:rgba(4,12,24,.42);
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
  --dsw-alias-interactive-bg-hover:rgba(255,255,255,.42);
  --dsw-alias-interactive-bg-hover-accent:rgba(255,255,255,.72);
  --dsw-alias-bg-overlay:#ffffff;
  --dsw-alias-brand-primary:var(--dshgn-accentOnLight);
  --dsw-alias-button-primary-fill:var(--dshgn-btnFill);
  --dsw-alias-button-primary-hover:var(--dshgn-btnHover);
}
.dshgn_list .dshgn_searchWrap{border-bottom-color:rgba(var(--dshgn-tintRgb),.14)}
.dshgn_list .dshgn_search{
  background:rgba(255,255,255,.72);border-color:rgba(var(--dshgn-tintRgb),.16);
}
.dshgn_list .dshgn_search::placeholder{color:var(--dshgn-midFg3)}
.dshgn_list .dshgn_card{border-radius:9px;margin-bottom:2px}
.dshgn_list .dshgn_card[data-on="true"]{
  background:#ffffff;box-shadow:0 1px 4px rgba(var(--dshgn-tintRgb),.14);
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
  --dsw-alias-interactive-bg-hover-accent:rgba(31,111,184,.12);
  --dsw-alias-bg-overlay:#ffffff;
  --dsw-alias-brand-primary:var(--dshgn-accentOnLight);
  --dsw-alias-button-primary-fill:var(--dshgn-btnFill);
  --dsw-alias-button-primary-hover:var(--dshgn-btnHover);
  scrollbar-color:rgba(var(--dshgn-tintRgb),.22) transparent;
}
.dshgn_note .dshgn_noteHead{background:var(--dshgn-light2)}
.dshgn_note .dshgn_md{font-size:13.5px;line-height:1.8}
.dshgn_note .dshgn_md .dshgn_pre{background:#eaf2fb}
.dshgn_note .dshgn_md .dshgn_table th{background:#e9f2fc}
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
  --dsw-alias-interactive-bg-hover-accent:rgba(31,111,184,.12);
  --dsw-alias-bg-overlay:#ffffff;
  --dsw-alias-brand-primary:var(--dshgn-accentOnLight);
  --dsw-alias-button-primary-fill:var(--dshgn-btnFill);
  --dsw-alias-button-primary-hover:var(--dshgn-btnHover);
}
.dshgn_pane .dshgn_section{box-shadow:0 1px 2px rgba(var(--dshgn-tintRgb),.06)}
.dshgn_pane .dshgn_input,.dshgn_pane .dshgn_textarea{background:#ffffff}
.dshgn_pane .dshgn_log{background:#eef5fd}
.dshgn_pane .dshgn_stat{background:#eaf2fc}
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
function injectCss() {
  if (typeof document === "undefined") return () => {
  };
  if (document.getElementById(STYLE_ID) !== null) return () => {
  };
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
  return () => {
    try {
      style.remove();
    } catch {
    }
  };
}
function PanelIcon(props) {
  const size = props && typeof props.size === "number" ? props.size : 18;
  const active = props && props.active === true;
  return h(Icon, { name: "brain", size, className: active ? "dshgn_sideIcon dshgn_sideIconOn" : "dshgn_sideIcon" });
}
function GetnotePage() {
  const [locale, setLocale] = React.useState(() => activeUiLocale());
  setUiLocale(locale);
  const t = React.useMemo(() => makeT(), [locale]);
  const [tab, setTab] = React.useState("notes");
  const [status, setStatus] = React.useState(null);
  const [tree, setTree] = React.useState(null);
  const [entries, setEntries] = React.useState([]);
  const [dirs, setDirs] = React.useState([]);
  const [query, setQuery] = React.useState("");
  const [activeDir, setActiveDir] = React.useState("");
  const [activeTag, setActiveTag] = React.useState("");
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
  const [dirSort, setDirSort] = React.useState(() => makeSortPref("dshgn.sortDir").read());
  const [tagSort, setTagSort] = React.useState(() => makeSortPref("dshgn.sortTag").read());
  const [current, setCurrent] = React.useState(null);
  const [draft, setDraft] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [refreshState, setRefreshState] = React.useState("idle");
  const refreshTimer = React.useRef(null);
  const refreshSpinTimer = React.useRef(null);
  const refreshOutcome = React.useRef(null);
  const SPIN_MS = 1400;
  const [themePreview, setThemePreview] = React.useState(null);
  const [templatesOpen, setTemplatesOpen] = React.useState(false);
  const showToast = React.useCallback((text) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 2400);
  }, []);
  const refresh = React.useCallback(async () => {
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
  React.useEffect(() => {
    void refresh();
  }, [refresh]);
  React.useEffect(() => {
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
  const tagCounts = React.useMemo(() => {
    const counts = /* @__PURE__ */ new Map();
    for (const entry of entries) {
      for (const tag of entry.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
  }, [entries]);
  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (activeDir !== "") {
        if (entry.dir !== activeDir && !entry.path.startsWith(`${activeDir}/`)) return false;
      }
      if (activeTag !== "" && !(entry.tags || []).includes(activeTag)) return false;
      if (needle === "") return true;
      return entry.title.toLowerCase().includes(needle) || entry.path.toLowerCase().includes(needle) || (entry.excerpt || "").toLowerCase().includes(needle) || (entry.tags || []).some((tag) => tag.toLowerCase().includes(needle));
    });
  }, [entries, query, activeDir, activeTag]);
  const [hits, setHits] = React.useState(null);
  const [searching, setSearching] = React.useState(false);
  React.useEffect(() => {
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
  const shown = searchMode ? hits : visible;
  const openNote = React.useCallback(
    async (path, toggle = false) => {
      if (toggle && current !== null && current.path === path) {
        setCurrent(null);
        setDraft(null);
        setError(null);
        return;
      }
      setError(null);
      try {
        const note = await api(`/read?path=${encodeURIComponent(path)}`);
        setCurrent(note);
        setDraft(note.content);
      } catch (err) {
        setCurrent(null);
        setDraft(null);
        setError(err && err.message ? err.message : String(err));
      }
    },
    [current]
  );
  const openWikiLink = React.useCallback(
    (target) => {
      const raw = String(target || "").trim();
      if (raw === "") return;
      const wanted = raw.replace(/\.md$/i, "");
      const list = entries || [];
      const direct = list.find((entry) => entry.path === raw || entry.path === `${wanted}.md`);
      if (direct !== void 0) {
        void openNote(direct.path);
        return;
      }
      const byName = list.find((entry) => {
        const name = entry.path.split("/").pop().replace(/\.md$/i, "");
        return name === wanted;
      });
      if (byName !== void 0) {
        void openNote(byName.path);
        return;
      }
      const lowered = wanted.toLowerCase();
      const byTitle = list.find((entry) => String(entry.title || "").toLowerCase() === lowered);
      if (byTitle !== void 0) {
        void openNote(byTitle.path);
        return;
      }
      setError(t("note.wikilinkMissing").replace("{name}", wanted));
    },
    [entries, openNote, t]
  );
  const dirty = current !== null && draft !== null && draft !== current.content;
  const saveNote = React.useCallback(async () => {
    if (current === null || draft === null) return;
    setBusy(true);
    try {
      await api("/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: current.path, content: draft, requestId: requestId() })
      });
      setCurrent({ ...current, content: draft });
      showToast(t("note.saved"));
      void refresh();
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [current, draft, refresh, showToast, t]);
  const customTemplates = React.useMemo(() => {
    const list = status !== null && Array.isArray(status.templates) ? status.templates : [];
    return list.filter((item) => item !== null && typeof item === "object" && typeof item.name === "string" && item.name.trim() !== "");
  }, [status]);
  const templateContent = React.useCallback((id) => {
    const now = /* @__PURE__ */ new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
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
        title: t("new.bookTitle"),
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
        title: `${day} ${t("new.meetingTitle")}`,
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
  }, [customTemplates, t]);
  const newTemplates = React.useMemo(() => {
    const builtin = [
      { id: "daily", icon: "calendar" },
      { id: "book", icon: "book" },
      { id: "meeting", icon: "clock" },
      { id: "note", icon: "note" }
    ];
    const mine = customTemplates.map((item) => ({ id: `custom:${item.name}`, icon: "edit", custom: true }));
    return builtin.concat(mine);
  }, [customTemplates]);
  const newNote = React.useCallback(
    async (templateId) => {
      const spec = typeof templateId === "string" ? templateContent(templateId) : { title: t("action.new"), content: "" };
      setTemplatesOpen(false);
      setBusy(true);
      try {
        const created = await api("/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dir: activeDir,
            title: spec.title,
            content: spec.content,
            requestId: requestId()
          })
        });
        showToast(t("note.created"));
        await refresh();
        await openNote(created.path);
      } catch (err) {
        setError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [activeDir, openNote, refresh, showToast, t, templateContent]
  );
  const deleteNote = React.useCallback(async () => {
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
      showToast(t("note.deleted"));
      void refresh();
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [current, refresh, showToast, t]);
  const copyReference = React.useCallback(async () => {
    if (current === null || status === null) return;
    const abs = `${status.vaultRoot}${status.vaultRoot.endsWith("/") || status.vaultRoot.endsWith("\\") ? "" : "/"}${current.path}`;
    const text = /[\s"]/.test(abs) ? `@"${abs}"` : `@${abs}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast(t("action.copied"));
    } catch {
      showToast(text);
    }
  }, [current, status, showToast, t]);
  const syncCurrent = React.useCallback(
    async (direction) => {
      if (current === null) return;
      setBusy(true);
      try {
        const json = await api(direction === "push" ? "/sync/push-one" : "/sync/pull-one", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: current.path })
        });
        showToast(direction === "push" ? t("sync.pushedOne") : t("sync.pulledOne"));
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
    [current, openNote, refresh, setBusy, showToast, t]
  );
  const [picked, setPicked] = React.useState(() => /* @__PURE__ */ new Set());
  const [batchTag, setBatchTag] = React.useState("");
  const [batchDir, setBatchDir] = React.useState("");
  const [batchOpen, setBatchOpen] = React.useState(false);
  const pickedCount = picked.size;
  const togglePick = React.useCallback((path) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  const clearPicked = React.useCallback(() => {
    setPicked(/* @__PURE__ */ new Set());
    setBatchOpen(false);
  }, []);
  const runBatch = React.useCallback(
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
            tag: kind === "tag" ? batchTag.trim() : void 0,
            dir: kind === "move" ? batchDir.trim() : void 0
          })
        });
        showToast(`${t("batch.done")} ${json.changed || 0}`);
        clearPicked();
        await refresh();
        if (current !== null && picked.has(current.path)) setCurrent(null);
      } catch (err) {
        setError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [batchDir, batchTag, clearPicked, current, picked, refresh, setBusy, setError, showToast, t]
  );
  const vaultReady = status !== null && !status.vaultMissing;
  React.useEffect(() => {
    const onKey = (event) => {
      const target = event.target;
      const tag = target && target.tagName ? String(target.tagName).toLowerCase() : "";
      const typing = tag === "input" || tag === "textarea" || tag === "select" || target && target.isContentEditable === true;
      if (event.key === "Escape") {
        setTemplatesOpen(false);
        return;
      }
      if (typing) return;
      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const input = document.querySelector(".dshgn_search");
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, newNote, openNote, shown, tab, vaultReady]);
  const tabButton = (id, label, badge) => h(
    "button",
    { type: "button", className: "dshgn_tab", "data-on": tab === id ? "true" : "false", onClick: () => setTab(id) },
    h("span", { className: "dshgn_tabLabel" }, label),
    badge === void 0 || badge === null ? null : h("span", { className: "dshgn_tabBadge" }, String(badge))
  );
  const head = h(
    "div",
    { className: "dshgn_head" },
    h(
      "div",
      { className: "dshgn_headMain" },
      h("div", { className: "dshgn_title" }, t("panel.title")),
      h(
        "div",
        { className: "dshgn_sub", title: status ? status.vaultRoot : "" },
        status === null ? "" : status.vaultMissing ? t("empty.noVault") : status.vaultRoot
      )
    ),
    // 动作按钮放在页签**左边**：页签是「去哪」（导航），按钮是「对当前页做什么」（动作）。
    // 动作紧贴内容更有因果关系，也避免鼠标为了点刷新横穿整条顶栏。
    h(
      "div",
      { className: "dshgn_actions" },
      tab === "notes" || tab === "cloud" ? h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "dshgn_newWrap" },
          h(
            "button",
            {
              type: "button",
              className: "dshgn_iconBtn",
              title: t("action.new"),
              onClick: () => setTemplatesOpen((prev) => !prev),
              disabled: busy || !vaultReady,
              "data-on": templatesOpen ? "true" : "false"
            },
            h(Icon, { name: "plus" })
          ),
          // 模板菜单：直接点「+」会建一篇空笔记，用户还得自己写标题和标签。
          // 常写的几类（日记/读书/会议/随手记）日期和结构都是固定的，
          // 让用户选一次比每次重复劳动好。
          templatesOpen ? h(
            React.Fragment,
            null,
            h("div", { className: "dshgn_menuMask", onClick: () => setTemplatesOpen(false) }),
            h(
              "div",
              { className: "dshgn_menu", role: "menu" },
              h("div", { className: "dshgn_menuTitle" }, t("new.template")),
              newTemplates.map(
                (item) => h(
                  "button",
                  {
                    key: item.id,
                    type: "button",
                    className: "dshgn_menuItem",
                    role: "menuitem",
                    onClick: () => void newNote(item.id)
                  },
                  h(Icon, { name: item.icon, size: 13 }),
                  // 自定义模板直接显示模板名（用户自己起的，没有译文可查），
                  // 提示行说明它带的是自己写的骨架，而不是空白。
                  h("span", null, item.custom ? item.id.slice("custom:".length) : t(`new.${item.id}`)),
                  h(
                    "span",
                    { className: "dshgn_menuHint" },
                    item.custom ? t("new.customHint") : t(`new.${item.id}Hint`)
                  )
                )
              )
            )
          ) : null
        ),
        h(
          "button",
          {
            type: "button",
            className: "dshgn_iconBtn" + (refreshState === "ok" ? " dshgn_iconBtnOk" : refreshState === "fail" ? " dshgn_iconBtnFail" : ""),
            title: t("action.refresh"),
            onClick: refresh,
            disabled: busy
          },
          h("span", { className: "dshgn_refreshSpin" + (refreshState === "spinning" ? " dshgn_refreshSpinOn" : "") }, h(Icon, { name: "refresh" }))
        )
      ) : null
    ),
    h(
      "div",
      { className: "dshgn_tabs" },
      tabButton("notes", t("tab.notes")),
      tabButton("cloud", t("tab.cloud")),
      // 「同步」不再单独占一个页签，收进了设置页。自动同步本质上是「设置」：
      // 设一次间隔就不管了，不是每天要看的东西，占一个一级入口反而挤掉了
      // 真正要翻的笔记/云端。
      // 冲突页签常驻。早先是「有冲突才出现」，但页签凭空消失会让人以为功能
      // 被删了，而且处理过的留档也想随时翻回去看。所以入口一直在，
      // 只有未处理的数量挂在旁边当角标——数字没了就说明手头清干净了。
      tabButton(
        "conflict",
        t("tab.conflict"),
        status !== null && status.conflicts > 0 ? status.conflicts : void 0
      ),
      tabButton("card", t("tab.card")),
      tabButton("settings", t("tab.settings")),
      tabButton("trash", t("tab.trash"))
    )
  );
  let body;
  if (tab === "cloud") {
    body = h(CloudPane, {
      t,
      status,
      showToast,
      onError: (message) => setError(message),
      onSynced: () => {
        void refresh();
      }
    });
  } else if (tab === "settings") {
    body = h(SettingsPane, {
      t,
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
    body = h(CardPane, {
      t,
      status,
      showToast,
      onError: (message) => setError(message),
      onChanged: async () => {
        await refresh();
      }
    });
  } else if (tab === "conflict") {
    body = h(ConflictPane, {
      t,
      status,
      onChanged: async () => {
        await refresh();
      },
      onError: (message) => setError(message),
      showToast
    });
  } else if (tab === "trash") {
    body = h(TrashPane, {
      t,
      status,
      onChanged: async () => {
        await refresh();
      },
      onError: (message) => setError(message),
      showToast
    });
  } else if (status === null) {
    body = h(SkeletonPane, { t });
  } else {
    body = h(
      "div",
      { className: "dshgn_body" },
      h(TreePane, {
        t,
        tree,
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
        onCreateDir: async (name) => {
          try {
            await api("/dir/create", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ dir: name })
            });
            showToast(t("tree.dirCreated"));
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
            showToast(t("tree.deletedDir"));
            if (activeDir === name) setActiveDir("");
            await refresh();
          } catch (err) {
            const message = err && err.message ? err.message : String(err);
            setError(/还有|not empty|409/.test(message) ? t("tree.dirNotEmpty") : message);
          }
        },
        onDeleteTag: async (name) => {
          try {
            await api("/tag/delete", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ tag: name })
            });
            showToast(t("tree.deletedTag"));
            if (activeTag === name) setActiveTag("");
            await refresh();
          } catch (err) {
            setError(err && err.message ? err.message : String(err));
          }
        },
        onCreateTag: async (name) => {
          if (current === null || current.path === void 0) {
            showToast(t("tree.tagNeedNote"));
            return;
          }
          try {
            await api("/batch", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "tag", paths: [current.path], tag: name })
            });
            showToast(t("tree.tagCreated"));
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
            showToast(`${t("tree.tagRenamed")} \xB7 ${changed}`);
            await refresh();
          } catch (err) {
            setError(err && err.message ? err.message : String(err));
          }
        },
        currentNoteId: current !== null && current.noteId ? current.noteId : null,
        heatmap: status !== null && status.heatmap ? status.heatmap : null
      }),
      h(
        "div",
        { className: "dshgn_list" },
        h(
          "div",
          { className: "dshgn_searchWrap" },
          h(Icon, { name: "search", size: 14, className: "dshgn_searchIcon" }),
          h("input", {
            className: "dshgn_search",
            type: "search",
            value: query,
            placeholder: t("search.placeholder"),
            onChange: (event) => setQuery(event.target.value)
          }),
          searching ? h("span", { className: "dshgn_searching" }, t("search.searching")) : null
        ),
        // 限定语法提示：`tag:` / `dir:` 是隐藏功能，不提示没人会知道。
        // 只在输入框有内容时出现，平时不占位置。
        query.trim() !== "" ? h("div", { className: "dshgn_searchHint" }, t("search.hint")) : null,
        // D2 批量工具栏：只在有选中时出现，不占常态空间。
        pickedCount > 0 ? h(
          "div",
          { className: "dshgn_batchBar" },
          h("span", { className: "dshgn_batchCount" }, `${pickedCount} ${t("batch.picked")}`),
          h(
            "button",
            { type: "button", className: "dshgn_batchBtn", onClick: () => setBatchOpen(!batchOpen) },
            t("batch.actions")
          ),
          h("button", { type: "button", className: "dshgn_batchBtn", onClick: clearPicked }, t("batch.clear")),
          batchOpen ? h(
            "div",
            { className: "dshgn_batchMenu" },
            h(
              "div",
              { className: "dshgn_batchRow" },
              h("input", {
                className: "dshgn_input dshgn_batchInput",
                type: "text",
                value: batchTag,
                placeholder: t("batch.tagPlaceholder"),
                onChange: (event) => setBatchTag(event.target.value)
              }),
              h(
                "button",
                {
                  type: "button",
                  className: "dshgn_btn dshgn_btnPrimary",
                  disabled: busy || batchTag.trim() === "",
                  onClick: () => void runBatch("tag")
                },
                t("batch.addTag")
              )
            ),
            h(
              "div",
              { className: "dshgn_batchRow" },
              h("input", {
                className: "dshgn_input dshgn_batchInput",
                type: "text",
                value: batchDir,
                placeholder: t("batch.dirPlaceholder"),
                onChange: (event) => setBatchDir(event.target.value)
              }),
              h(
                "button",
                {
                  type: "button",
                  className: "dshgn_btn",
                  disabled: busy || batchDir.trim() === "",
                  onClick: () => void runBatch("move")
                },
                t("batch.move")
              )
            ),
            h(
              "button",
              {
                type: "button",
                className: "dshgn_btn dshgn_btnDanger",
                disabled: busy,
                onClick: () => {
                  if (!window.confirm(`${t("batch.confirmDelete")} ${pickedCount}`)) return;
                  void runBatch("delete");
                }
              },
              t("batch.delete")
            )
          ) : null
        ) : null,
        h(
          "div",
          { className: "dshgn_listBody" },
          visible.length === 0 && !searchMode ? h(
            "div",
            { className: "dshgn_empty", style: { padding: "24px 12px" } },
            h("div", { className: "dshgn_emptyTitle" }, query.trim() !== "" ? t("empty.search") : t("empty.noNotes")),
            // 空列表最需要的不是一句「没有笔记」，而是一个能马上动手的按钮
            query.trim() === "" && vaultReady ? h(
              "button",
              { type: "button", className: "dshgn_btn dshgn_btnPrimary", style: { marginTop: 10 }, onClick: () => void newNote() },
              h(Icon, { name: "plus", size: 13 }),
              t("action.new")
            ) : null
          ) : shown.map(
            (entry) => h(
              "div",
              {
                key: entry.path,
                className: "dshgn_card",
                "data-on": current !== null && current.path === entry.path ? "true" : "false",
                // 勾选框需要左侧留白停靠（见 .dshgn_card[data-pick]），
                // 其他列表（云端/冲突/回收站）没有勾选框就不用留这个空
                "data-pick": "true",
                onClick: () => {
                  if (dirty && !window.confirm(t("note.unsaved"))) return;
                  void openNote(entry.path, true);
                },
                title: entry.path
              },
              h(
                "div",
                { className: "dshgn_cardTitleRow" },
                // 勾选框只在「已有选中」或「鼠标悬停」时可见：常态下列表
                // 干净，一旦开始多选就全部显形，不用先去某个按钮开多选模式。
                h(
                  "span",
                  {
                    className: "dshgn_pickBox" + (picked.has(entry.path) ? " dshgn_pickBoxOn" : ""),
                    role: "checkbox",
                    "aria-checked": picked.has(entry.path) ? "true" : "false",
                    "aria-label": t("batch.pick"),
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
                  picked.has(entry.path) ? h(Icon, { name: "check", size: 11 }) : null
                ),
                h("div", { className: "dshgn_cardTitle" }, entry.title),
                // 正文命中次数：用户能一眼看出哪篇是「真在讲这个」，
                // 哪篇只是顺口提了一句。
                searchMode && entry.matchCount > 0 ? h("span", { className: "dshgn_hitCount" }, `${entry.matchCount}`) : null
              ),
              h(
                "div",
                { className: "dshgn_cardMeta" },
                entry.date ? h("span", null, entry.date) : null,
                entry.dir ? h("span", null, entry.dir) : null
              ),
              // 搜索态优先显示正文命中行（带行号），比摘要更能说明为什么它被搜出来
              searchMode && Array.isArray(entry.matches) && entry.matches.length > 0 ? h(
                "div",
                { className: "dshgn_cardMatches" },
                entry.matches.slice(0, 2).map(
                  (match, index) => h(
                    "div",
                    { key: `${index}-${match.line}`, className: "dshgn_matchLine" },
                    h("span", { className: "dshgn_matchNo" }, String(match.line)),
                    h("span", { className: "dshgn_matchText" }, match.text)
                  )
                )
              ) : entry.excerpt ? h("div", { className: "dshgn_cardExcerpt" }, entry.excerpt) : null
            )
          )
        )
      ),
      h(NotePane, {
        t,
        status,
        current,
        draft,
        setDraft,
        dirty,
        busy,
        onSave: saveNote,
        onDelete: deleteNote,
        onCopyReference: copyReference,
        onOpenWikiLink: openWikiLink,
        onSyncOne: syncCurrent,
        onRestored: async () => {
          await openNote(current.path);
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
            showToast(`${done ? t("todo.done") : t("todo.undone")}`);
          } catch (err) {
            setError(err && err.message ? err.message : String(err));
          }
        }
      })
    );
  }
  const themeStyle = themeVars(themePreview !== null ? themePreview : status !== null ? status.themeColor : null);
  return h(
    "div",
    { className: "dshgn_rel" },
    h(
      "div",
      { className: "dshgn_root", style: themeStyle === null ? void 0 : themeStyle },
      head,
      error !== null ? h("div", { className: "dshgn_error", role: "alert" }, `${t("error.prefix")}: ${error}`) : null,
      // key 用 tab：切换页签时 React 会换掉整个节点，动画才会从头播一遍。
      // 不加 key 的话 React 复用同一个 DOM，transition 没有「变化」可播，
      // 表现就是切页签时内容硬跳一下。
      h("div", { key: tab, className: "dshgn_body" }, body)
    ),
    toast !== null ? h("div", { className: "dshgn_toast" }, h(Icon, { name: "check", size: 13 }), toast) : null
  );
}
function AudioPlayer(props) {
  const { t, track, onTimeChange } = props;
  const audioRef = React.useRef(null);
  const [playing, setPlaying] = React.useState(false);
  const [current, setCurrent] = React.useState(0);
  const [duration, setDuration] = React.useState(track && track.duration ? track.duration : 0);
  const [failed, setFailed] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [dragValue, setDragValue] = React.useState(0);
  const src = track ? track.url.startsWith(`${apiOrigin()}/getnote/`) ? track.url : withToken(`${apiOrigin()}/getnote/audio?url=${encodeURIComponent(track.url)}`) : null;
  React.useEffect(() => {
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
  const toggle = React.useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => setFailed(true));
    } else {
      el.pause();
    }
  }, []);
  const barRef = React.useRef(null);
  const valueFromPointer = React.useCallback(
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
  const commitSeek = React.useCallback((target) => {
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
  const onSeekDown = React.useCallback(
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
  const onSeekMove = React.useCallback(
    (event) => {
      if (!dragging) return;
      setDragValue(valueFromPointer(event.clientX));
    },
    [dragging, valueFromPointer]
  );
  const onSeekUp = React.useCallback(
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
  const onSeekKey = React.useCallback(
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
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  };
  if (!track) return null;
  const maxValue = Math.max(1, Math.round(duration));
  const shown = Math.min(Math.round(dragging ? dragValue : current), maxValue);
  const percent = maxValue > 0 ? Math.max(0, Math.min(100, shown / maxValue * 100)) : 0;
  return h(
    "div",
    { className: "dshgn_audioCard" },
    h(
      "div",
      { className: "dshgn_audioLabel" },
      h(Icon, { name: "audio", size: 13 }),
      h("span", null, track.kind === "local" ? t("note.localAudio") : t("cloud.audio")),
      track.title ? h("span", { className: "dshgn_treeCount" }, track.title) : null
    ),
    h(
      "div",
      { className: "dshgn_audioBar" },
      h(
        "button",
        {
          type: "button",
          className: "dshgn_audioBtn",
          onClick: toggle,
          title: playing ? t("cloud.pause") : t("cloud.play"),
          "aria-label": playing ? t("cloud.pause") : t("cloud.play")
        },
        h(Icon, { name: playing ? "pause" : "play", size: 14 })
      ),
      h(
        "div",
        {
          ref: barRef,
          className: "dshgn_audioSeek",
          role: "slider",
          tabIndex: 0,
          "aria-label": t("cloud.audio"),
          "aria-valuemin": 0,
          "aria-valuemax": Math.max(1, Math.round(duration)),
          "aria-valuenow": Math.round(dragging ? dragValue : current),
          onPointerDown: onSeekDown,
          onPointerMove: onSeekMove,
          onPointerUp: onSeekUp,
          onPointerCancel: onSeekUp,
          onKeyDown: onSeekKey
        },
        h(
          "div",
          { className: "dshgn_audioTrack" },
          h("div", { className: "dshgn_audioFill", style: { width: `${percent}%` } }),
          h("div", { className: "dshgn_audioThumb", style: { left: `${percent}%` } })
        )
      ),
      h("span", { className: "dshgn_audioTime" }, `${mmss(dragging ? dragValue : current)} / ${mmss(duration)}`)
    ),
    failed ? h("div", { className: "dshgn_fieldHint", style: { color: "var(--dsw-alias-state-warn-primary)" } }, track.url) : null,
    h("audio", {
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
        const d = event.target.duration;
        if (Number.isFinite(d) && d > 0) setDuration(d);
      },
      onTimeUpdate: (event) => {
        const c = event.target.currentTime;
        setCurrent(c);
        if (typeof onTimeChange === "function") onTimeChange(c);
      }
    })
  );
}
function CloudPane(props) {
  const { t, status, showToast, onError, onSynced } = props;
  const configured = status !== null && status.api !== void 0 && status.api.configured === true;
  const [list, setList] = React.useState([]);
  const [cursor, setCursor] = React.useState(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState(null);
  const [detail, setDetail] = React.useState(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState("");
  const [draftBody, setDraftBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [recallHits, setRecallHits] = React.useState(null);
  const [recalling, setRecalling] = React.useState(false);
  const [shareUrl, setShareUrl] = React.useState(null);
  const [tagDraft, setTagDraft] = React.useState("");
  const [topics, setTopics] = React.useState(null);
  const [activeTopic, setActiveTopic] = React.useState(null);
  const [composing, setComposing] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState("");
  const [newBody, setNewBody] = React.useState("");
  const loadFirst = React.useCallback(async () => {
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
  const loadMore = React.useCallback(async () => {
    if (!hasMore || loading) return;
    setLoading(true);
    try {
      const q = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const page = await api(`/cloud/list?limit=20${q}`);
      setList((prev) => [...prev, ...Array.isArray(page.notes) ? page.notes : []]);
      setCursor(page.cursor ?? null);
      setHasMore(page.hasMore === true);
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cursor, hasMore, loading, onError]);
  React.useEffect(() => {
    void loadFirst();
  }, [loadFirst]);
  React.useEffect(() => {
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
  const pickTopic = React.useCallback(
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
  const createCloudNote = React.useCallback(async () => {
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
      showToast(t("cloud.created"));
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
  }, [activeTopic, loadFirst, newBody, newTitle, onError, showToast, t]);
  const openCloudNote = React.useCallback(
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
  const saveCloud = React.useCallback(async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await api("/cloud/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noteId: detail.noteId, title: draftTitle, content: draftBody })
      });
      showToast(t("cloud.savedCloud"));
      setEditing(false);
      await openCloudNote(detail);
      if (typeof onSynced === "function") onSynced();
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [detail, draftTitle, draftBody, openCloudNote, onError, onSynced, showToast, t]);
  const deleteCloud = React.useCallback(async () => {
    if (!detail) return;
    if (!window.confirm(`${t("cloud.deleteCloud")}\uFF1A${detail.title || detail.noteId}\uFF1F`)) return;
    setBusy(true);
    try {
      await api("/cloud/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noteId: detail.noteId })
      });
      showToast(t("cloud.deletedCloud"));
      setSelected(null);
      setDetail(null);
      await loadFirst();
      if (typeof onSynced === "function") onSynced();
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [detail, loadFirst, onError, onSynced, showToast, t]);
  const pullOne = React.useCallback(async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await api("/cloud/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noteId: detail.noteId, title: detail.title, content: detail.content || detail.original || "" })
      });
      showToast(result.local && result.local.path ? result.local.path : t("cloud.localCopy"));
      if (typeof onSynced === "function") onSynced();
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [detail, onError, onSynced, showToast, t]);
  const doRecall = React.useCallback(async () => {
    const q = query.trim();
    if (q === "") return;
    setRecalling(true);
    onError(null);
    try {
      const result = await api("/cloud/recall", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q, topK: 8 })
      });
      setRecallHits(Array.isArray(result.results) ? result.results : []);
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setRecalling(false);
    }
  }, [query, onError]);
  const addCloudTag = React.useCallback(
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
        showToast(t("cloud.tagAdded"));
        await openCloudNote(detail);
        await loadFirst();
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [detail, loadFirst, onError, openCloudNote, showToast, t]
  );
  const removeCloudTag = React.useCallback(
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
        showToast(t("cloud.tagRemoved"));
        await openCloudNote(detail);
        await loadFirst();
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [detail, loadFirst, onError, openCloudNote, showToast, t]
  );
  const shareCloud = React.useCallback(
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
            showToast(t("cloud.copied"));
          } catch {
            showToast(t("cloud.shareCreated"));
          }
        } else {
          showToast(t("cloud.shareCreated"));
        }
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [detail, onError, showToast, t]
  );
  const pushLocalOne = React.useCallback(async () => {
    if (!detail) return;
    const localPath = detail.localPath || "";
    if (localPath === "") {
      onError(t("cloud.noLocalCopy"));
      return;
    }
    if (!window.confirm(`${t("cloud.pushLocal")}

${t("cloud.pushHint")}`)) return;
    setBusy(true);
    try {
      await api("/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: localPath })
      });
      showToast(t("cloud.pushed"));
      await openCloudNote(detail);
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [detail, onError, openCloudNote, showToast, t]);
  if (!configured) {
    return h(
      "div",
      { className: "dshgn_pane" },
      h(
        "div",
        { className: "dshgn_banner" },
        h(Icon, { name: "cloud", size: 26 }),
        h("div", { className: "dshgn_emptyTitle" }, t("cloud.notConfigured")),
        h("div", { className: "dshgn_emptyDesc" }, t("cloud.notConfiguredDesc"))
      )
    );
  }
  const shown = recallHits !== null ? recallHits : list;
  const listPane = h(
    "div",
    { className: "dshgn_list" },
    h(
      "div",
      { className: "dshgn_searchWrap" },
      h(Icon, { name: "search", size: 14, className: "dshgn_searchIcon" }),
      h("input", {
        className: "dshgn_search",
        type: "search",
        value: query,
        placeholder: t("search.placeholder"),
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
    topics !== null && topics.length > 0 ? h(
      "div",
      { className: "dshgn_topicRow" },
      h(
        "button",
        {
          type: "button",
          className: "dshgn_chip" + (activeTopic === null ? " dshgn_chipOn" : ""),
          onClick: () => void pickTopic(null)
        },
        t("cloud.allTopics")
      ),
      topics.map(
        (topic) => h(
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
    h(
      "div",
      { className: "dshgn_rowLine", style: { padding: "4px 10px 8px" } },
      h(
        "button",
        { type: "button", className: "dshgn_btn", onClick: doRecall, disabled: recalling || query.trim() === "" },
        recalling ? h("span", { className: "dshgn_spin" }) : h(Icon, { name: "search", size: 12 }),
        recallHits !== null ? `\u8BED\u4E49\u641C\u7D22 (${recallHits.length})` : "\u8BED\u4E49\u641C\u7D22"
      ),
      h(
        "button",
        { type: "button", className: "dshgn_btn", onClick: () => setComposing(true), disabled: busy },
        h(Icon, { name: "plus", size: 12 }),
        t("cloud.newNote")
      ),
      recallHits !== null ? h(
        "button",
        {
          type: "button",
          className: "dshgn_btn",
          onClick: () => {
            setRecallHits(null);
            void loadFirst();
          }
        },
        t("action.cancel")
      ) : null
    ),
    h(
      "div",
      { className: "dshgn_listBody" },
      loading && shown.length === 0 ? h("div", { className: "dshgn_empty" }, h("span", { className: "dshgn_spin" }), h("span", null, t("cloud.loading"))) : shown.length === 0 ? h("div", { className: "dshgn_empty" }, h("div", { className: "dshgn_emptyTitle" }, t("cloud.empty"))) : shown.map(
        (note) => h(
          "div",
          {
            key: note.noteId,
            className: "dshgn_card",
            "data-on": selected !== null && selected.noteId === note.noteId ? "true" : "false",
            onClick: () => void openCloudNote(note, true),
            title: note.noteId
          },
          h(
            "div",
            { className: "dshgn_cardTitle" },
            note.hasAudio ? h(Icon, { name: "audio", size: 11 }) : null,
            note.title || "(\u65E0\u6807\u9898)"
          ),
          h(
            "div",
            { className: "dshgn_cardMeta" },
            note.updatedAt || note.createdAt ? h("span", null, String(note.updatedAt || note.createdAt).slice(0, 10)) : null,
            note.topics && note.topics[0] ? h("span", null, note.topics[0].name) : null,
            typeof note.score === "number" ? h("span", null, note.score.toFixed(2)) : null
          ),
          note.tags.length > 0 ? h("div", { className: "dshgn_cardExcerpt" }, note.tags.map((x) => x.name).join(" \xB7 ")) : null
        )
      )
    ),
    hasMore && recallHits === null ? h(
      "div",
      { style: { padding: "6px 10px 10px" } },
      h("button", { type: "button", className: "dshgn_btn", onClick: loadMore, disabled: loading }, loading ? h("span", { className: "dshgn_spin" }) : null, t("cloud.loadMore"))
    ) : null
  );
  const readerPane = h(
    "div",
    { className: "dshgn_note" },
    composing ? h(
      "div",
      { className: "dshgn_pane" },
      h(
        "div",
        { className: "dshgn_cardBox" },
        h(
          "div",
          { className: "dshgn_sectionHead" },
          h("span", { className: "dshgn_sectionTitle" }, t("cloud.newNote")),
          activeTopic !== null ? h("span", { className: "dshgn_badge" }, activeTopic.name) : null
        ),
        h(
          "div",
          { className: "dshgn_field" },
          h("span", { className: "dshgn_fieldLabel" }, t("cloud.newNoteTitle")),
          h("input", {
            className: "dshgn_input",
            value: newTitle,
            autoFocus: true,
            onChange: (event) => setNewTitle(event.target.value)
          })
        ),
        h(
          "div",
          { className: "dshgn_field" },
          h("span", { className: "dshgn_fieldLabel" }, t("cloud.newNoteBody")),
          h("textarea", {
            className: "dshgn_textarea",
            value: newBody,
            onChange: (event) => setNewBody(event.target.value)
          })
        ),
        h(
          "div",
          { className: "dshgn_rowLine" },
          h(
            "button",
            {
              type: "button",
              className: "dshgn_btn dshgn_btnPri",
              onClick: createCloudNote,
              disabled: busy || newTitle.trim() === ""
            },
            busy ? h("span", { className: "dshgn_spin" }) : h(Icon, { name: "check", size: 12 }),
            t("cloud.create")
          ),
          h(
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
            t("action.cancel")
          )
        )
      )
    ) : selected === null ? h("div", { className: "dshgn_empty" }, h(Icon, { name: "cloud", size: 26 }), h("div", { className: "dshgn_emptyTitle" }, t("cloud.title")), h("div", { className: "dshgn_emptyDesc" }, t("cloud.desc"))) : h(
      React.Fragment,
      null,
      h(
        "div",
        { className: "dshgn_noteHead" },
        h("div", { className: "dshgn_notePath" }, selected.title || selected.noteId),
        detail !== null && !editing ? h(
          React.Fragment,
          null,
          h("button", { type: "button", className: "dshgn_iconBtn", title: t("action.edit"), onClick: () => setEditing(true), disabled: busy }, h(Icon, { name: "edit" })),
          h("button", { type: "button", className: "dshgn_iconBtn", title: t("cloud.pullOne"), onClick: pullOne, disabled: busy }, h(Icon, { name: "up" })),
          // 把本地改动推到云端：以前只能单向「云端 → 本地」，用户在本地
          // 改完笔记就没有任何办法把它送回云端，只能去得到大脑里重写一遍。
          h("button", { type: "button", className: "dshgn_iconBtn", title: t("cloud.pushLocal"), onClick: pushLocalOne, disabled: busy }, h(Icon, { name: "cloud" })),
          h("button", { type: "button", className: "dshgn_iconBtn", title: t("cloud.deleteCloud"), onClick: deleteCloud, disabled: busy }, h(Icon, { name: "trash" }))
        ) : null
      ),
      detailLoading ? h("div", { className: "dshgn_emptyState" }, h("span", { className: "dshgn_spin" }), h("span", { style: { marginLeft: 8 } }, t("cloud.polling"))) : detail === null ? h("div", { className: "dshgn_emptyState" }, t("cloud.polling")) : editing ? h(
        "div",
        { className: "dshgn_pane" },
        h(
          "div",
          { className: "dshgn_cardBox" },
          h(
            "div",
            { className: "dshgn_field" },
            h("span", { className: "dshgn_fieldLabel" }, t("cloud.editTitle")),
            h("input", { className: "dshgn_input", value: draftTitle, onChange: (e) => setDraftTitle(e.target.value) })
          ),
          h(
            "div",
            { className: "dshgn_field" },
            h("span", { className: "dshgn_fieldLabel" }, t("cloud.editBody")),
            h("textarea", { className: "dshgn_textarea", value: draftBody, onChange: (e) => setDraftBody(e.target.value) })
          ),
          h(
            "div",
            { className: "dshgn_rowLine" },
            h("button", { type: "button", className: "dshgn_btn dshgn_btnPri", onClick: saveCloud, disabled: busy }, busy ? h("span", { className: "dshgn_spin" }) : h(Icon, { name: "check", size: 12 }), t("cloud.saveCloud")),
            h("button", { type: "button", className: "dshgn_btn", onClick: () => setEditing(false), disabled: busy }, t("action.cancel"))
          )
        )
      ) : h(
        "div",
        { className: "dshgn_scroll" },
        h(
          "div",
          { className: "dshgn_md" },
          h("h1", { className: "dshgn_h dshgn_h1" }, detail.title || "(\u65E0\u6807\u9898)"),
          detail.tags.length > 0 ? h(
            "div",
            { className: "dshgn_rowLine", style: { gap: 6, marginBottom: 12 } },
            detail.tags.map(
              (tag) => h(
                "span",
                { key: tag.name || tag.id, className: "dshgn_tagPill" },
                tag.name,
                // 云端标签可删：用一个极小的 × 而不是整块可点，
                // 否则用户想选文字复制时会被误删掉标签。
                h(
                  "button",
                  {
                    type: "button",
                    className: "dshgn_tagX",
                    title: t("cloud.removeTag"),
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
          h(
            "div",
            { className: "dshgn_rowLine", style: { gap: 6, marginBottom: 12 } },
            h("input", {
              className: "dshgn_input",
              style: { maxWidth: 180, height: 26 },
              value: tagDraft,
              placeholder: t("cloud.addTagHint"),
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
            h(
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
              h(Icon, { name: "plus", size: 12 }),
              t("cloud.tags")
            ),
            h(
              "button",
              {
                type: "button",
                className: "dshgn_btn",
                disabled: busy,
                onClick: () => void shareCloud(false)
              },
              h(Icon, { name: "link", size: 12 }),
              t("cloud.shareLink")
            )
          ),
          // 分享出来的链接直接显示出来，用户能选中复制（剪贴板可能被拒）
          shareUrl !== null ? h(
            "div",
            { className: "dshgn_section", style: { marginBottom: 12 } },
            h("div", { className: "dshgn_sectionTitle" }, t("cloud.shareCreated")),
            h(
              "div",
              { className: "dshgn_rowLine", style: { gap: 6 } },
              h("code", { className: "dshgn_code", style: { wordBreak: "break-all" } }, shareUrl),
              h(
                "button",
                {
                  type: "button",
                  className: "dshgn_btn",
                  onClick: () => {
                    void navigator.clipboard.writeText(shareUrl).then(
                      () => showToast(t("cloud.copied")),
                      () => showToast(t("cloud.shareCreated"))
                    );
                  }
                },
                t("cloud.copyLink")
              )
            )
          ) : null,
          // 录音优先：用户要的就是「听原声」，所以放在正文之前
          detail.audio.length > 0 ? detail.audio.map((track, index) => h(AudioPlayer, { key: `${track.url}-${index}`, t, track })) : null,
          detail.audio.length > 0 ? h("div", { style: { height: 12 } }) : null,
          detail.moments.length > 0 ? h(
            "div",
            { className: "dshgn_section", style: { marginTop: 12 } },
            h("div", { className: "dshgn_sectionTitle" }, t("cloud.moments")),
            h(
              "div",
              null,
              detail.moments.map(
                (moment, index) => h(
                  "div",
                  { key: `m-${index}`, className: "dshgn_moment" },
                  h("span", { className: "dshgn_momentAt" }, formatMoment(moment.startMs)),
                  h("span", null, moment.text)
                )
              )
            )
          ) : null,
          detail.todos.length > 0 ? h(
            "div",
            { className: "dshgn_section", style: { marginTop: 12 } },
            h("div", { className: "dshgn_sectionTitle" }, t("cloud.todos")),
            h(
              "ul",
              { className: "dshgn_mdList" },
              detail.todos.map(
                (todo, index) => h(
                  "li",
                  { key: `t-${index}`, className: "dshgn_li" },
                  h("span", { className: "dshgn_check" + (todo.completed ? " dshgn_checkOn" : ""), style: { marginRight: 6 } }),
                  todo.text
                )
              )
            )
          ) : null,
          h("div", { style: { height: 12 } }),
          // 云端正文常常自己就以 `# 同一个标题` 开头，上面已经渲染过 h1 了，
          // 留着就是「# 时间线」两行一样的大标题。
          detail.content ? renderBlocks(stripLeadingHeading(detail.content, detail.title)) : null,
          detail.hasTranscript && detail.original !== detail.content ? h(
            React.Fragment,
            null,
            h("h2", { className: "dshgn_h dshgn_h2" }, t("cloud.transcript")),
            h(TranscriptBlock, { text: detail.original })
          ) : null
        )
      )
    )
  );
  return h("div", { className: "dshgn_body" }, listPane, readerPane);
}
function TranscriptBlock(props) {
  const text = String(props && props.text || "");
  if (text.trim() === "") return null;
  const entries = [];
  for (const raw of text.split("\n")) {
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
  if (entries.length === 0) return null;
  const children = entries.map(
    (entry, index) => h(
      "p",
      { key: `t${index}` },
      h("span", { className: "dshgn_ts" }, entry.stamp === null ? "" : entry.stamp),
      entry.speaker === "" ? null : h("span", { className: "dshgn_speaker" }, entry.speaker),
      entry.body
    )
  );
  return h("div", { className: "dshgn_transcript" }, children);
}
function looksLikeTranscript(text) {
  const hits = String(text || "").match(/^\s*[^\[]*\[[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\]/gm);
  return hits !== null && hits.length >= 2;
}
function formatMoment(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1e3));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function LanguageCard(props) {
  const { t, locale, onSaved, onError, onLocaleChange } = props;
  const [busy, setBusy] = React.useState(false);
  const options = [
    { id: null, label: t("lang.auto") },
    { id: "zh", label: "\u4E2D\u6587" },
    { id: "en", label: "English" },
    { id: "nl", label: "Nederlands" }
  ];
  const pick = React.useCallback(
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
        await onSaved(t("lang.saved"));
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, onError, onLocaleChange, onSaved, t]
  );
  return h(
    "div",
    { className: "dshgn_section" },
    h("div", { className: "dshgn_sectionHead" }, h("span", null, t("lang.title"))),
    h("div", { className: "dshgn_sectionDesc" }, t("lang.desc")),
    h(
      "div",
      { className: "dshgn_langRow" },
      options.map(
        (option) => h(
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
function TemplateCard(props) {
  const { t, status, onSaved, onError } = props;
  const [draft, setDraft] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState("");
  const [body, setBody] = React.useState("");
  const saved = React.useMemo(() => {
    const list2 = status !== null && Array.isArray(status.templates) ? status.templates : [];
    return list2.filter((item) => item !== null && typeof item === "object" && typeof item.name === "string");
  }, [status]);
  const list = draft !== null ? draft : saved;
  const dirty = draft !== null;
  const add = React.useCallback(() => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    const next = list.filter((item) => item.name !== trimmed).concat([{ name: trimmed, body }]);
    setDraft(next.slice(0, 12));
    setAdding(false);
    setName("");
    setBody("");
  }, [body, list, name]);
  const remove = React.useCallback(
    (target) => {
      setDraft(list.filter((item) => item.name !== target));
    },
    [list]
  );
  const save = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api("/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templates: draft !== null ? draft : [] })
      });
      setDraft(null);
      await onSaved(t("settings.templateSaved"));
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, draft, onError, onSaved, t]);
  return h(
    "div",
    { className: "dshgn_section" },
    h(
      "div",
      { className: "dshgn_sectionHead" },
      h("span", null, t("settings.templateTitle")),
      h("span", { className: "dshgn_sectionHint" }, `${list.length} / 12`)
    ),
    h("div", { className: "dshgn_sectionDesc" }, t("settings.templateDesc")),
    list.length === 0 ? h("div", { className: "dshgn_emptyRow" }, t("settings.templateEmpty")) : h(
      "div",
      { className: "dshgn_tplList" },
      list.map(
        (item) => h(
          "div",
          { key: item.name, className: "dshgn_tplRow" },
          h(
            "div",
            { className: "dshgn_tplMain" },
            h("div", { className: "dshgn_tplName" }, item.name),
            h("div", { className: "dshgn_tplBody" }, item.body || "\u2014")
          ),
          h(
            "button",
            {
              type: "button",
              className: "dshgn_rowBtn dshgn_rowBtnDanger",
              onClick: () => remove(item.name)
            },
            t("settings.templateRemove")
          )
        )
      )
    ),
    adding ? h(
      "div",
      { className: "dshgn_tplForm" },
      h("input", {
        className: "dshgn_input",
        value: name,
        placeholder: t("settings.templateName"),
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
      h("div", { className: "dshgn_fieldHint" }, t("settings.templateNameHint")),
      h("textarea", {
        className: "dshgn_textarea",
        value: body,
        placeholder: t("settings.templateBody"),
        rows: 5,
        maxLength: 4e3,
        onChange: (event) => setBody(event.target.value)
      }),
      h("div", { className: "dshgn_fieldHint" }, t("settings.templateBodyHint")),
      h(
        "div",
        { className: "dshgn_btnRow" },
        h(
          "button",
          { type: "button", className: "dshgn_btn dshgn_btnPri", onClick: add, disabled: name.trim() === "" },
          t("settings.templateAdd")
        ),
        h(
          "button",
          { type: "button", className: "dshgn_btn", onClick: () => setAdding(false) },
          t("action.cancel")
        )
      )
    ) : h(
      "div",
      { className: "dshgn_btnRow" },
      h(
        "button",
        { type: "button", className: "dshgn_btn", onClick: () => setAdding(true), disabled: list.length >= 12 },
        t("settings.templateAdd")
      ),
      h(
        "button",
        { type: "button", className: "dshgn_btn dshgn_btnPri", onClick: () => void save(), disabled: busy || !dirty },
        t("settings.templateSave")
      )
    )
  );
}
function CardPane(props) {
  const { t, status, showToast, onError, onChanged } = props;
  const [env, setEnv] = React.useState(null);
  const [envBusy, setEnvBusy] = React.useState(false);
  const [scanning, setScanning] = React.useState(false);
  const [found, setFound] = React.useState(null);
  const [files, setFiles] = React.useState(null);
  const [listBusy, setListBusy] = React.useState(false);
  const [dir, setDir] = React.useState("");
  const [deleteAfter, setDeleteAfter] = React.useState(false);
  const [run, setRun] = React.useState(null);
  const timerRef = React.useRef(null);
  const [wifiNet, setWifiNet] = React.useState(null);
  const [wifiBusy, setWifiBusy] = React.useState(false);
  const [wifiHot, setWifiHot] = React.useState(null);
  const [wifiManual, setWifiManual] = React.useState({ ssid: "", password: "" });
  const checkEnv = React.useCallback(async () => {
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
  React.useEffect(() => {
    void checkEnv();
  }, [checkEnv]);
  React.useEffect(() => {
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
            showToast(`${t("card.imported")}\uFF1A${json.result.downloaded}`);
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
  }, [run, onChanged, onError, showToast, t]);
  const doScan = React.useCallback(async () => {
    setScanning(true);
    setFound(null);
    try {
      const json = await api("/card/scan?timeout=8");
      setFound(json);
      if (Array.isArray(json.cards) && json.cards.length > 0) {
        showToast(`${t("card.scanFound")}\uFF1A${json.cards.length}`);
        void checkEnv();
      } else {
        onError(t("card.scanNone"));
      }
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }, [checkEnv, onError, showToast, t]);
  const loadList = React.useCallback(async () => {
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
  const startImport = React.useCallback(async () => {
    if (deleteAfter) {
      const ok = window.confirm(
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
        onError(json.error || t("card.alreadyRunning"));
        return;
      }
      setRun({ running: true, lines: [] });
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    }
  }, [deleteAfter, dir, onError, t]);
  const wifiRefresh = React.useCallback(async () => {
    try {
      const json = await api("/card/wifi-scan");
      setWifiNet(json);
      return json;
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
      return null;
    }
  }, [onError]);
  React.useEffect(() => {
    void wifiRefresh();
  }, [wifiRefresh]);
  const wifiGo = React.useCallback(async () => {
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
        showToast(`${t("card.wifiOn")}\uFF1A${json.hotspot}`);
      } else if (json && json.ok === true) {
        onError(t("card.wifiNoHotspot"));
      } else {
        onError(json && json.error || t("card.wifiFail"));
      }
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setWifiBusy(false);
      void wifiRefresh();
    }
  }, [onError, showToast, t, wifiRefresh]);
  const wifiJoinManual = React.useCallback(async () => {
    const ssid = wifiManual.ssid.trim();
    if (ssid === "") {
      onError(t("card.wifiNeedSsid"));
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
      if (json && json.ok === true) showToast(`${t("card.wifiOn")}\uFF1A${ssid}`);
      else onError(json && json.error || t("card.wifiFail"));
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setWifiBusy(false);
      void wifiRefresh();
    }
  }, [onError, showToast, t, wifiManual, wifiRefresh]);
  const wifiOff = React.useCallback(async () => {
    setWifiBusy(true);
    try {
      const json = await api("/card/wifi-leave", { method: "POST" });
      setWifiHot(null);
      if (json && json.ok === true) showToast(t("card.wifiLeft"));
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setWifiBusy(false);
      void wifiRefresh();
    }
  }, [onError, showToast, t, wifiRefresh]);
  const ready = env !== null && env.ready === true;
  const running = run !== null && run.running === true;
  const result = run !== null ? run.result : null;
  const lines = run !== null && Array.isArray(run.lines) ? run.lines : [];
  return h(
    "div",
    { className: "dshgn_pane" },
    h(
      "div",
      { className: "dshgn_paneInner" },
      h("h2", { className: "dshgn_h dshgn_h2" }, t("card.title")),
      h("div", { className: "dshgn_paneDesc" }, t("card.desc")),
      // ── 环境自检 ──
      h(
        "div",
        { className: "dshgn_section" },
        h(
          "div",
          { className: "dshgn_sectionHead" },
          h("span", null, t("card.envBridge")),
          h(
            "span",
            {
              className: "dshgn_badge " + (ready ? "dshgn_badgeOk" : "dshgn_badgeWarn")
            },
            ready ? t("card.envOk") : t("card.envMissing")
          )
        ),
        env === null ? h("div", { className: "dshgn_sectionDesc" }, "\u2026") : h(
          "div",
          { className: "dshgn_sectionDesc" },
          ready ? `Python ${env.python || "?"} \xB7 bleak ${env.bleak || "?"}` : t("card.envHint")
        ),
        !ready && env !== null && env.error ? h("pre", { className: "dshgn_log" }, String(env.error)) : null,
        h(
          "div",
          { className: "dshgn_row" },
          h(
            "button",
            {
              type: "button",
              className: "dshgn_btn",
              onClick: () => void checkEnv(),
              disabled: envBusy
            },
            t("card.envBridge")
          ),
          h(
            "button",
            {
              type: "button",
              className: "dshgn_btn",
              onClick: () => void doScan(),
              disabled: scanning || !ready
            },
            scanning ? t("card.scanning") : t("card.scan")
          ),
          h(
            "button",
            {
              type: "button",
              className: "dshgn_btn",
              onClick: () => void loadList(),
              disabled: listBusy || !ready
            },
            t("card.refresh")
          )
        ),
        found !== null && Array.isArray(found.cards) ? h(
          "div",
          { className: "dshgn_sectionDesc" },
          found.cards.length === 0 ? t("card.scanNone") : found.cards.map((card) => `${card.name || "?"} (${card.address || ""})`).join("  \xB7  ")
        ) : null
      ),
      // ── 热点快传 ──
      //
      // 放在「卡片上的录音」前面：传一小时录音，BLE 要四十多分钟，走热点
      // 通常一两分钟。先让人看到这条快路，再去纠结导哪几个文件。
      h(
        "div",
        { className: "dshgn_section" },
        h(
          "div",
          { className: "dshgn_sectionHead" },
          h("span", null, t("card.wifiTitle")),
          wifiNet !== null && wifiNet.current ? h("span", { className: "dshgn_badge" }, wifiNet.current) : null
        ),
        h("div", { className: "dshgn_sectionDesc" }, t("card.wifiDesc")),
        // 连上之后必须一眼看到「现在挂在卡片热点上」——不然用户会以为断网。
        wifiNet !== null && wifiNet.cardLike && wifiNet.cardLike.length > 0 ? h(
          "div",
          { className: "dshgn_sectionDesc" },
          `${t("card.wifiAvailable")}\uFF1A${wifiNet.cardLike.join("  \xB7  ")}`
        ) : null,
        h(
          "div",
          { className: "dshgn_row" },
          h(
            "button",
            {
              type: "button",
              className: "dshgn_btn dshgn_btnPri",
              onClick: () => void wifiGo(),
              disabled: wifiBusy || !ready
            },
            wifiBusy ? t("card.wifiBusy") : t("card.wifiGo")
          ),
          h(
            "button",
            {
              type: "button",
              className: "dshgn_btn",
              onClick: () => void wifiRefresh(),
              disabled: wifiBusy
            },
            t("card.wifiRescan")
          ),
          h(
            "button",
            {
              type: "button",
              className: "dshgn_btn",
              onClick: () => void wifiOff(),
              disabled: wifiBusy
            },
            t("card.wifiOff")
          )
        ),
        // 连上了但没找到服务，或者卡片热点名/密码拿不到时，手输是最后一条路。
        h(
          "div",
          { className: "dshgn_row" },
          h("input", {
            className: "dshgn_input",
            value: wifiManual.ssid,
            placeholder: t("card.wifiSsid"),
            onChange: (event) => setWifiManual({ ssid: event.target.value, password: wifiManual.password })
          }),
          h("input", {
            className: "dshgn_input",
            value: wifiManual.password,
            placeholder: t("card.wifiPassword"),
            onChange: (event) => setWifiManual({ ssid: wifiManual.ssid, password: event.target.value })
          }),
          h(
            "button",
            {
              type: "button",
              className: "dshgn_btn",
              onClick: () => void wifiJoinManual(),
              disabled: wifiBusy || !ready
            },
            t("card.wifiJoin")
          )
        ),
        wifiHot !== null && wifiHot.ok === true ? h(
          "div",
          { className: "dshgn_sectionDesc" },
          [
            wifiHot.hotspot ? `${t("card.wifiHotspot")}\uFF1A${wifiHot.hotspot}` : null,
            wifiHot.ip ? `IP ${wifiHot.ip}` : null,
            Array.isArray(wifiHot.openPorts) && wifiHot.openPorts.length > 0 ? `${t("card.wifiPorts")}\uFF1A${wifiHot.openPorts.join(", ")}` : null
          ].filter(Boolean).join("  \xB7  ") || "\u2014"
        ) : null,
        // 探测到的传输服务：面板不给下载按钮（协议还没对上），但把路径摊开，
        // 让人能自己去 curl 一下看是什么。
        wifiHot !== null && Array.isArray(wifiHot.hits) && wifiHot.hits.length > 0 ? h(
          "div",
          { className: "dshgn_fileList" },
          wifiHot.hits.map(
            (hit, index) => h(
              "div",
              { key: `${hit.path || index}`, className: "dshgn_fileRow" },
              h("span", { className: "dshgn_fileName" }, hit.path || "?"),
              h(
                "span",
                { className: "dshgn_fileMeta" },
                `${hit.status || "?"} \xB7 ${formatBytes2(hit.bytes || 0)}`
              )
            )
          )
        ) : null
      ),
      // ── 卡片上的录音 ──
      h(
        "div",
        { className: "dshgn_section" },
        h(
          "div",
          { className: "dshgn_sectionHead" },
          h("span", null, t("card.pending")),
          files === null ? null : h("span", { className: "dshgn_badge" }, String(files.length))
        ),
        files === null ? h("div", { className: "dshgn_sectionDesc" }, "\u2014") : files.length === 0 ? h("div", { className: "dshgn_sectionDesc" }, t("card.none")) : h(
          "div",
          { className: "dshgn_fileList" },
          files.map(
            (file, index) => h(
              "div",
              { key: `${file.name || index}`, className: "dshgn_fileRow" },
              h("span", { className: "dshgn_fileName" }, file.name || "?"),
              h("span", { className: "dshgn_fileMeta" }, formatBytes2(file.size || 0))
            )
          )
        )
      ),
      // ── 导入 ──
      h(
        "div",
        { className: "dshgn_section" },
        h("div", { className: "dshgn_sectionHead" }, h("span", null, t("card.import"))),
        h(
          "div",
          { className: "dshgn_field" },
          h("div", { className: "dshgn_fieldLabel" }, t("card.dir")),
          h("input", {
            className: "dshgn_input",
            value: dir,
            placeholder: "\u5F55\u97F3\u5361",
            onChange: (event) => setDir(event.target.value)
          }),
          h("div", { className: "dshgn_fieldHint" }, t("card.dirHint"))
        ),
        // 删原件是唯一不可逆的操作，所以单独一行、默认关、开关旁写清后果。
        h(
          "label",
          { className: "dshgn_checkRow" },
          h("input", {
            type: "checkbox",
            checked: deleteAfter,
            onChange: (event) => setDeleteAfter(event.target.checked)
          }),
          h("span", null, t("card.deleteAfter"))
        ),
        h("div", { className: "dshgn_fieldHint" }, t("card.deleteAfterHint")),
        h(
          "div",
          { className: "dshgn_row" },
          h(
            "button",
            {
              type: "button",
              className: "dshgn_btn dshgn_btnPri",
              onClick: () => void startImport(),
              disabled: running || !ready
            },
            running ? t("card.importing") : t("card.import")
          )
        ),
        lines.length > 0 ? h("pre", { className: "dshgn_log" }, lines.join("\n")) : null,
        result !== null ? h(
          "div",
          { className: "dshgn_statGrid" },
          h(
            "div",
            { className: "dshgn_stat" },
            h("div", { className: "dshgn_statNum" }, String(result.downloaded || 0)),
            h("div", { className: "dshgn_statLabel" }, t("card.downloaded"))
          ),
          h(
            "div",
            { className: "dshgn_stat" },
            h("div", { className: "dshgn_statNum" }, String(result.skipped || 0)),
            h("div", { className: "dshgn_statLabel" }, t("card.skipped"))
          ),
          h(
            "div",
            { className: "dshgn_stat" },
            h("div", { className: "dshgn_statNum" }, String(result.failed || 0)),
            h("div", { className: "dshgn_statLabel" }, t("card.failed"))
          )
        ) : null
      )
    )
  );
}
function ArchiveCard(props) {
  const { t, status, onChanged, onError, showToast } = props;
  const [info, setInfo] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [importMode, setImportMode] = React.useState("rename");
  const fileRef = React.useRef(null);
  React.useEffect(() => {
    let alive = true;
    void api("/archive/info").then((json) => {
      if (alive) setInfo(json);
    }).catch(() => {
    });
    return () => {
      alive = false;
    };
  }, []);
  const exportZip = React.useCallback(async () => {
    setBusy(true);
    try {
      const url = withToken(`${apiOrigin()}/getnote/archive/export`);
      const name = "\u5F97\u5230\u5927\u8111\u5F52\u6863-" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".zip";
      const saved = await saveFile(url, name);
      if (saved) {
        showToast(t("archive.exported"));
        return;
      }
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      showToast(t("archive.exporting"));
    } finally {
      window.setTimeout(() => setBusy(false), 1200);
    }
  }, [showToast, t]);
  const doImport = React.useCallback(
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
        showToast(`${t("archive.imported")} ${json.written || 0} / ${json.skipped || 0}`);
        if (typeof onChanged === "function") await onChanged();
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [importMode, onChanged, onError, showToast, t]
  );
  return h(
    "div",
    { className: "dshgn_section" },
    h(
      "div",
      { className: "dshgn_sectionHead" },
      h("div", { className: "dshgn_sectionTitle" }, t("archive.title")),
      h(
        "div",
        { className: "dshgn_rowLine", style: { gap: 6 } },
        h(
          "button",
          { type: "button", className: "dshgn_btn dshgn_btnPri", onClick: exportZip, disabled: busy },
          h(Icon, { name: "up", size: 12 }),
          t("archive.export")
        ),
        h(
          "button",
          { type: "button", className: "dshgn_btn", onClick: () => fileRef.current && fileRef.current.click(), disabled: busy },
          h(Icon, { name: "folder", size: 12 }),
          t("archive.import")
        ),
        h("input", {
          ref: fileRef,
          type: "file",
          accept: ".zip,application/zip",
          style: { display: "none" },
          onChange: (event) => void doImport(event.target.files && event.target.files[0])
        })
      )
    ),
    h("div", { className: "dshgn_sectionDesc" }, t("archive.desc")),
    info !== null ? h(
      "div",
      { className: "dshgn_fieldHint" },
      `${info.notes} \u7BC7 \xB7 ${formatBytes2(info.bytes)}${info.assetCount > 0 ? ` \xB7 \u9644\u4EF6 ${info.assetCount} \u4E2A ${formatBytes2(info.assetBytes)}` : ""}`
    ) : null,
    h(
      "label",
      { className: "dshgn_rowLine", style: { fontSize: 11.5, color: "var(--dsw-alias-label-secondary)" } },
      t("archive.importMode"),
      ["rename", "skip"].map(
        (mode) => h(
          "button",
          {
            key: mode,
            type: "button",
            className: "dshgn_chip" + (importMode === mode ? " dshgn_chipOn" : ""),
            onClick: () => setImportMode(mode),
            disabled: busy
          },
          t(`archive.mode.${mode}`)
        )
      )
    )
  );
}
function ConflictPane(props) {
  const { t, status, onChanged, onError, showToast } = props;
  const [items, setItems] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [detail, setDetail] = React.useState(null);
  const [diffMode, setDiffMode] = React.useState("rendered");
  const [resolvedOpen, setResolvedOpen] = React.useState(false);
  const load = React.useCallback(async () => {
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
  React.useEffect(() => {
    void load();
  }, [load]);
  const openDetail = React.useCallback(
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
  const resolve5 = React.useCallback(
    async (keepLocal) => {
      if (detail === null) return;
      setBusy(true);
      try {
        const result = await api("/conflict/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: detail.path, keepLocal })
        });
        showToast(keepLocal ? t("conflict.keptLocal") : t("conflict.tookCloud"));
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
    [detail, load, onChanged, onError, showToast, t]
  );
  const undo = React.useCallback(async () => {
    if (detail === null) return;
    setBusy(true);
    try {
      await api("/conflict/unresolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: detail.path })
      });
      showToast(t("conflict.undone"));
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
  }, [detail, load, onChanged, onError, showToast, t]);
  const list = items === null ? [] : items;
  const pendingItems = list.filter((item) => item.resolved !== true);
  const resolvedItems = list.filter((item) => item.resolved === true);
  const renderRow = (item) => h(
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
    h(
      "div",
      { style: { minWidth: 0 } },
      h(
        "div",
        { className: "dshgn_cardTitle", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
        item.originalName
      ),
      h(
        "div",
        { className: "dshgn_cardMeta" },
        `${formatTime(item.savedAt)} \xB7 ${formatBytes2(item.bytes)}` + (item.resolved === true ? ` \xB7 ${item.keptLocal === true ? t("conflict.pickedLocal") : t("conflict.pickedCloud")}` : "")
      )
    ),
    h(
      "button",
      { type: "button", className: "dshgn_btn dshgn_btnPri", onClick: () => void openDetail(item), disabled: busy },
      item.resolved === true ? t("conflict.review") : t("conflict.compare")
    )
  );
  if (detail !== null) {
    const archiveText = detail.body !== void 0 && detail.body !== null ? detail.body : detail.content;
    const liveText = detail.local === null || detail.local === void 0 ? null : detail.local.body !== void 0 && detail.local.body !== null ? detail.local.body : detail.local.content;
    const archiveIsCloud = detail.archiveIsCloud === true;
    const localBody = archiveIsCloud ? liveText : archiveText;
    const cloudBody = archiveIsCloud ? archiveText : liveText;
    const sideBlock = (body, emptyText) => body === null ? h("div", { className: "dshgn_diffEmpty" }, emptyText) : diffMode === "raw" ? h("pre", { className: "dshgn_diffBody" }, body) : h("div", { className: "dshgn_diffBody dshgn_diffMd" }, renderBlocks(body, { assets: [] }));
    return h(
      "div",
      { className: "dshgn_pane" },
      h(
        "div",
        { className: "dshgn_section" },
        h(
          "div",
          { className: "dshgn_sectionHead" },
          h("div", { className: "dshgn_sectionTitle" }, t("conflict.compare")),
          h(
            "div",
            { className: "dshgn_rowLine", style: { gap: 6 } },
            // 三个按钮统一用浅色系：比对页的主角是左右两栏正文，按钮太饱和
            // 会抢注意力。未处理时两个采纳按钮都是红描边（提醒要决定），
            // 已经选过哪边就填成浅色——这个填充是「当初选了谁」的持久记号，
            // 重新打开这条冲突时依然在。
            h(
              "button",
              {
                type: "button",
                className: "dshgn_btn " + (detail.keptLocal === true ? "dshgn_btnPale" : detail.keptLocal === false ? "dshgn_btnWarn" : "dshgn_btnWarn"),
                onClick: () => void resolve5(true),
                disabled: busy
              },
              t("conflict.keepLocal")
            ),
            h(
              "button",
              {
                type: "button",
                className: "dshgn_btn " + (detail.keptLocal === false ? "dshgn_btnPale" : "dshgn_btnWarn"),
                onClick: () => void resolve5(false),
                disabled: busy
              },
              t("conflict.takeCloud")
            ),
            h("button", { type: "button", className: "dshgn_btn", onClick: () => setDetail(null), disabled: busy }, t("conflict.back")),
            // 已处理的条目给一个「退回未处理」：改主意是这个功能最正常的
            // 用法，没有它就只能去文件系统删 .resolved.json。
            detail.resolved === true && h(
              "button",
              { type: "button", className: "dshgn_btn", onClick: () => void undo(), disabled: busy },
              t("conflict.undo")
            )
          )
        ),
        h(
          "div",
          { className: "dshgn_sectionDesc", style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
          h("span", null, detail.originalName),
          h("span", { className: "dshgn_dot" }, "\xB7"),
          h("span", null, t("conflict.savedAt")),
          h("span", null, formatTime(detail.savedAt)),
          h(
            "div",
            { className: "dshgn_rowLine", style: { gap: 4, marginLeft: "auto" } },
            h(
              "button",
              {
                type: "button",
                className: "dshgn_chip" + (diffMode === "rendered" ? " dshgn_chipOn" : ""),
                onClick: () => setDiffMode("rendered")
              },
              t("conflict.modeRendered")
            ),
            h(
              "button",
              {
                type: "button",
                className: "dshgn_chip" + (diffMode === "raw" ? " dshgn_chipOn" : ""),
                onClick: () => setDiffMode("raw")
              },
              t("conflict.modeRaw")
            )
          )
        )
      ),
      h(
        "div",
        { className: "dshgn_diffRow" },
        h(
          "div",
          { className: "dshgn_diffCol" },
          h("div", { className: "dshgn_diffHead" }, t("conflict.sideLocal")),
          sideBlock(localBody, t("conflict.noLocal"))
        ),
        h(
          "div",
          { className: "dshgn_diffCol" },
          h("div", { className: "dshgn_diffHead" }, t("conflict.sideCloud")),
          sideBlock(cloudBody, t("conflict.noCloud"))
        )
      )
    );
  }
  return h(
    "div",
    { className: "dshgn_pane" },
    h(
      "div",
      { className: "dshgn_section" },
      h(
        "div",
        { className: "dshgn_sectionHead" },
        h("div", { className: "dshgn_sectionTitle" }, t("tab.conflict")),
        h(
          "button",
          { type: "button", className: "dshgn_btn", onClick: () => void load(), disabled: loading || busy },
          loading ? h("span", { className: "dshgn_spin" }) : h(Icon, { name: "refresh", size: 12 }),
          t("action.refresh")
        )
      ),
      h("div", { className: "dshgn_sectionDesc" }, t("conflict.desc"))
    ),
    loading && list.length === 0 ? h("div", { className: "dshgn_emptyState" }, h("span", { className: "dshgn_spin" })) : list.length === 0 ? h(
      "div",
      { className: "dshgn_empty" },
      h(Icon, { name: "check", size: 24 }),
      h("div", { className: "dshgn_emptyTitle" }, t("conflict.empty")),
      h("div", { className: "dshgn_emptyDesc" }, t("conflict.emptyHint"))
    ) : h(
      "div",
      { className: "dshgn_cardBox" },
      // 未处理区：直接铺开，这就是用户进来要看的东西。
      pendingItems.length === 0 ? h(
        "div",
        { className: "dshgn_empty" },
        h(Icon, { name: "check", size: 24 }),
        h("div", { className: "dshgn_emptyTitle" }, t("conflict.empty")),
        h("div", { className: "dshgn_emptyDesc" }, t("conflict.emptyHint"))
      ) : pendingItems.map(renderRow),
      // 已处理区：默认折叠。这些是「已经决定过」的归档，留着是为了
      // 能反悔和复查，不该占据一进页面就能看到的视觉重心。
      resolvedItems.length > 0 && h(
        "div",
        null,
        h(
          "button",
          {
            type: "button",
            className: "dshgn_foldHead",
            onClick: () => setResolvedOpen((prev) => !prev)
          },
          h(
            "span",
            { className: "dshgn_foldArrow", "data-open": resolvedOpen ? "true" : "false" },
            h(Icon, { name: "chevron", size: 12 })
          ),
          h("span", null, t("conflict.resolvedSection")),
          h("span", { className: "dshgn_foldCount" }, String(resolvedItems.length))
        ),
        resolvedOpen && resolvedItems.map(renderRow)
      )
    )
  );
}
function TrashPane(props) {
  const { t, status, onChanged, onError, showToast } = props;
  const [items, setItems] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
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
  React.useEffect(() => {
    void load();
  }, [load]);
  const restore = React.useCallback(
    async (item) => {
      setBusy(true);
      try {
        const result = await api("/trash/restore", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: item.path })
        });
        showToast(`${t("trash.restored")}${result && result.path ? "\uFF1A" + result.path : ""}`);
        await load();
        if (typeof onChanged === "function") await onChanged();
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [load, onChanged, onError, showToast, t]
  );
  const purgeOne = React.useCallback(
    async (item) => {
      if (!window.confirm(t("trash.purgeOneConfirm"))) return;
      setBusy(true);
      try {
        await api("/trash/purge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: item.path })
        });
        showToast(t("trash.purged"));
        await load();
        if (typeof onChanged === "function") await onChanged();
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [load, onChanged, onError, showToast, t]
  );
  const purgeAll = React.useCallback(async () => {
    if (!window.confirm(t("trash.purgeConfirm"))) return;
    setBusy(true);
    try {
      await api("/trash/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      showToast(t("trash.purged"));
      await load();
      if (typeof onChanged === "function") await onChanged();
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [load, onChanged, onError, showToast, t]);
  const list = items === null ? [] : items;
  return h(
    "div",
    { className: "dshgn_pane" },
    h(
      "div",
      { className: "dshgn_section" },
      h(
        "div",
        { className: "dshgn_sectionHead" },
        h("div", { className: "dshgn_sectionTitle" }, t("tab.trash")),
        h(
          "div",
          { className: "dshgn_rowLine", style: { gap: 6 } },
          h(
            "button",
            { type: "button", className: "dshgn_btn", onClick: () => void load(), disabled: loading || busy },
            loading ? h("span", { className: "dshgn_spin" }) : h(Icon, { name: "refresh", size: 12 }),
            t("action.refresh")
          ),
          h(
            "button",
            { type: "button", className: "dshgn_btn dshgn_btnDanger", onClick: purgeAll, disabled: busy || list.length === 0 },
            h(Icon, { name: "trash", size: 12 }),
            t("trash.purgeAll")
          )
        )
      ),
      h("div", { className: "dshgn_sectionDesc" }, t("trash.desc"))
    ),
    loading && list.length === 0 ? h("div", { className: "dshgn_emptyState" }, h("span", { className: "dshgn_spin" })) : list.length === 0 ? h(
      "div",
      { className: "dshgn_empty" },
      h(Icon, { name: "trash", size: 24 }),
      h("div", { className: "dshgn_emptyTitle" }, t("trash.empty")),
      h("div", { className: "dshgn_emptyDesc" }, t("trash.emptyHint"))
    ) : h(
      "div",
      { className: "dshgn_cardBox" },
      list.map(
        (item) => h(
          "div",
          { key: item.path, className: "dshgn_rowLine", style: { justifyContent: "space-between", padding: "7px 0", borderBottom: "0.5px solid var(--dsw-alias-border-l1)" } },
          h(
            "div",
            { style: { minWidth: 0 } },
            h("div", { className: "dshgn_cardTitle", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, item.title || item.originalName),
            h(
              "div",
              { className: "dshgn_cardMeta" },
              `${t("trash.deletedAt")} ${formatTime(item.trashedAt)} \xB7 ${formatBytes2(item.bytes)}`
            )
          ),
          h(
            "div",
            { className: "dshgn_rowLine", style: { gap: 6, flex: "none" } },
            h(
              "button",
              { type: "button", className: "dshgn_btn dshgn_btnPri", onClick: () => void restore(item), disabled: busy },
              h(Icon, { name: "up", size: 12 }),
              t("trash.restore")
            ),
            h(
              "button",
              { type: "button", className: "dshgn_btn dshgn_btnDanger", onClick: () => void purgeOne(item), disabled: busy },
              t("trash.purgeOne")
            )
          )
        )
      )
    )
  );
}
function SyncPane(props) {
  const { t, status, onChanged, onError, showToast } = props;
  const configured = status !== null && status.api !== void 0 && status.api.configured === true;
  const auto = status !== null && status.autoSync ? status.autoSync : { enabled: false, minutes: 15, incremental: true };
  const [enabled, setEnabled] = React.useState(auto.enabled === true);
  const [minutes, setMinutes] = React.useState(auto.minutes || 15);
  const [incremental, setIncremental] = React.useState(auto.incremental !== false);
  const [foregroundOnly, setForegroundOnly] = React.useState(auto.foregroundOnly === true);
  const [fullScan, setFullScan] = React.useState(false);
  const [running, setRunning] = React.useState(auto.running === true);
  const [lastResult, setLastResult] = React.useState(auto.lastResult || null);
  const [lastError, setLastError] = React.useState(auto.lastError || null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
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
  const persist = React.useCallback(
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
  const toggle = React.useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    void persist({ enabled: next, minutes, incremental });
    showToast(next ? `${t("sync.enabled")} \xB7 ${minutes}${t("sync.minutes")}` : t("sync.enabled"));
  }, [enabled, minutes, incremental, persist, showToast, t]);
  const changeMinutes = React.useCallback(
    (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      const clamped = Math.min(Math.max(Math.round(parsed), 5), 720);
      setMinutes(clamped);
      if (enabled) void persist({ enabled: true, minutes: clamped, incremental });
    },
    [enabled, incremental, persist]
  );
  const runNow = React.useCallback(async () => {
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
  const resultStats = lastResult ? [
    { label: t("sync.pulled"), num: lastResult.pulled ?? 0 },
    { label: t("sync.skipped"), num: lastResult.skipped ?? 0 },
    { label: t("sync.adopted"), num: lastResult.adopted ?? 0 },
    { label: t("sync.conflicts"), num: lastResult.conflicts ?? 0 },
    { label: t("sync.deleted"), num: lastResult.deleted ?? 0 },
    { label: t("sync.errors"), num: lastResult.errors ?? 0 }
  ] : [];
  return h(
    React.Fragment,
    null,
    h(
      "div",
      { className: "dshgn_section" },
      h("div", { className: "dshgn_sectionTitle" }, t("sync.title")),
      h("div", { className: "dshgn_sectionDesc" }, t("sync.desc")),
      h(
        "div",
        { className: "dshgn_toggleRow" },
        h(
          "div",
          { className: "dshgn_toggleLabel" },
          h("span", { className: "dshgn_toggleTitle" }, t("sync.enabled")),
          h(
            "span",
            { className: "dshgn_toggleDesc" },
            status !== null && status.api && status.api.lastRunAt ? `${t("sync.lastRun")}: ${formatTime(status.api.lastRunAt)}` : `${t("sync.lastRun")}: ${t("sync.never")}`
          )
        ),
        h("button", {
          type: "button",
          className: "dshgn_toggle",
          "data-on": enabled ? "true" : "false",
          onClick: toggle,
          disabled: !configured,
          "aria-label": t("sync.enabled")
        })
      ),
      h(
        "div",
        { className: "dshgn_rowLine" },
        h("span", { className: "dshgn_fieldLabel" }, t("sync.interval")),
        h("input", {
          className: "dshgn_input",
          style: { flex: "none", width: 76 },
          type: "number",
          min: 5,
          max: 720,
          step: 5,
          value: minutes,
          onChange: (e) => changeMinutes(e.target.value),
          disabled: !configured
        }),
        h("span", { className: "dshgn_fieldHint" }, t("sync.minutes")),
        [5, 15, 60].map(
          (preset) => h(
            "button",
            {
              key: preset,
              type: "button",
              className: "dshgn_chip" + (minutes === preset ? " dshgn_chipOn" : ""),
              onClick: () => changeMinutes(preset),
              disabled: !configured
            },
            `${preset}${t("sync.minutes")}`
          )
        )
      ),
      h(
        "label",
        { className: "dshgn_rowLine", style: { fontSize: 11.5, color: "var(--dsw-alias-label-secondary)" } },
        h("input", {
          type: "checkbox",
          checked: incremental,
          onChange: (e) => {
            setIncremental(e.target.checked);
            void persist({ enabled, minutes, incremental: e.target.checked });
          },
          disabled: !configured
        }),
        t("sync.incremental")
      ),
      h(
        "label",
        { className: "dshgn_rowLine", style: { fontSize: 11.5, color: "var(--dsw-alias-label-secondary)" } },
        h("input", {
          type: "checkbox",
          checked: foregroundOnly,
          onChange: (e) => {
            setForegroundOnly(e.target.checked);
            void persist({ enabled, minutes, incremental, foregroundOnly: e.target.checked });
          },
          disabled: !configured
        }),
        t("sync.foregroundOnly")
      ),
      h("div", { className: "dshgn_fieldHint" }, t("sync.foregroundHint")),
      h("div", { className: "dshgn_fieldHint" }, t("sync.quotaHint"))
    ),
    h(
      "div",
      { className: "dshgn_section" },
      h(
        "div",
        { className: "dshgn_rowLine" },
        h("button", { type: "button", className: "dshgn_btn dshgn_btnPri", onClick: runNow, disabled: busy || running || !configured }, running ? h("span", { className: "dshgn_spin" }) : h(Icon, { name: "sync", size: 12 }), running ? t("sync.running") : t("sync.now")),
        h(
          "label",
          { className: "dshgn_rowLine", style: { fontSize: 11.5, color: "var(--dsw-alias-label-secondary)" } },
          h("input", { type: "checkbox", checked: fullScan, onChange: (e) => setFullScan(e.target.checked), disabled: !configured }),
          t("sync.fullScan")
        )
      ),
      !configured ? h("div", { className: "dshgn_fieldHint" }, t("cloud.notConfiguredDesc")) : null,
      lastError !== null ? h("div", { className: "dshgn_error" }, lastError) : null,
      resultStats.length > 0 ? h("div", { className: "dshgn_statGrid" }, resultStats.map((s) => h("div", { key: s.label, className: "dshgn_stat" }, h("span", { className: "dshgn_statNum" }, String(s.num)), h("span", { className: "dshgn_statLabel" }, s.label)))) : null,
      lastResult !== null && lastResult.at ? h("div", { className: "dshgn_fieldHint" }, `${t("sync.result")}: ${formatTime(lastResult.at)}`) : null
    ),
    h(LegacyImport)
  );
  function LegacyImport() {
    const [open, setOpen] = React.useState(false);
    if (configured || !open) {
      return h(
        "div",
        { className: "dshgn_rowLine", style: { justifyContent: "center" } },
        h("button", { type: "button", className: "dshgn_btn", onClick: () => setOpen(true) }, t("sync.legacy")),
        h("span", { className: "dshgn_fieldHint" }, t("sync.legacyHint"))
      );
    }
    return h(ImportPane, {
      t,
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
  const { t } = props;
  const row = (width, height) => h("div", { className: "dshgn_skRow", style: { width, height } });
  return h(
    "div",
    { className: "dshgn_body", "aria-busy": "true", "aria-label": t("panel.loading") },
    h(
      "div",
      { className: "dshgn_tree dshgn_skTree" },
      row("60%", "10px"),
      row("82%", "10px"),
      row("70%", "10px"),
      row("76%", "10px"),
      row("54%", "10px")
    ),
    h(
      "div",
      { className: "dshgn_list dshgn_skList" },
      h(
        "div",
        { className: "dshgn_skCard" },
        row("72%", "12px"),
        row("40%", "9px"),
        row("92%", "9px")
      ),
      h(
        "div",
        { className: "dshgn_skCard" },
        row("58%", "12px"),
        row("34%", "9px"),
        row("86%", "9px")
      ),
      h(
        "div",
        { className: "dshgn_skCard" },
        row("66%", "12px"),
        row("46%", "9px"),
        row("80%", "9px")
      )
    ),
    h(
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
  const { t, heatmap } = props;
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
  return h(
    "div",
    { className: "dshgn_heat" },
    h(
      "div",
      { className: "dshgn_heatHead" },
      h("span", { className: "dshgn_heatTitle" }, t("heat.title")),
      h(
        "span",
        { className: "dshgn_heatStat", title: `${heatmap.total} ${t("heat.totalHint")}` },
        `${heatmap.streak} ${t("heat.streak")}`
      )
    ),
    h(
      "div",
      { className: "dshgn_heatGrid", style: { gridTemplateRows: "repeat(7, 1fr)", gridAutoFlow: "column" } },
      days.map(
        (day) => h("span", {
          key: day.date,
          className: "dshgn_heatCell",
          "data-lv": String(level(day.count)),
          "data-future": day.future === true ? "true" : "false",
          title: `${day.date} \xB7 ${day.count} ${t("heat.unit")}`
        })
      )
    )
  );
}
function TreePane(props) {
  const {
    t,
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
    heatmap,
    currentNoteId
  } = props;
  const total = Array.isArray(entries) ? entries.length : 0;
  const [menu, setMenu] = React.useState(null);
  const [confirm, setConfirm] = React.useState(null);
  const [creating, setCreating] = React.useState(null);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [renaming, setRenaming] = React.useState(null);
  React.useEffect(() => {
    if (menu === null) return void 0;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);
  const openMenu = (event, kind, name) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ kind, name });
  };
  const flat = React.useMemo(() => {
    const latest = (path) => {
      let max = 0;
      for (const entry of entries) {
        if (entry.path === path || entry.path.startsWith(`${path}/`)) {
          if (entry.mtimeMs > max) max = entry.mtimeMs;
        }
      }
      return max;
    };
    const compare = (a, b) => {
      if (dirSort === "name") return a.name.localeCompare(b.name, "zh");
      if (dirSort === "count") return b.count - a.count || a.name.localeCompare(b.name, "zh");
      return latest(b.path) - latest(a.path) || a.name.localeCompare(b.name, "zh");
    };
    const list = [];
    const walk = (node, depth) => {
      const dirsOnly = (node.children || []).filter((child) => child.kind === "dir");
      dirsOnly.sort(compare);
      for (const child of dirsOnly) {
        list.push({ path: child.path, name: child.name, depth, count: child.count });
        walk(child, depth + 1);
      }
    };
    if (tree) walk(tree, 0);
    if (list.length === 0 && Array.isArray(dirs)) {
      const fallback = [];
      for (const dir of dirs) {
        if (dir === "") continue;
        fallback.push({ path: dir, name: dir, depth: 0, count: entries.filter((e) => e.path.startsWith(`${dir}/`)).length });
      }
      fallback.sort(compare);
      list.push(...fallback);
    }
    return list;
  }, [tree, dirs, entries, dirSort]);
  const sortedTags = React.useMemo(() => {
    const copy = [...tagCounts];
    if (tagSort === "name") {
      copy.sort((a, b) => a[0].localeCompare(b[0], "zh"));
    } else if (tagSort === "count") {
      copy.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"));
    } else {
      const latest = (tag) => {
        let max = 0;
        for (const entry of entries) {
          if ((entry.tags || []).includes(tag) && entry.mtimeMs > max) max = entry.mtimeMs;
        }
        return max;
      };
      copy.sort((a, b) => latest(b[0]) - latest(a[0]) || a[0].localeCompare(b[0], "zh"));
    }
    return copy;
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
      if (typeof onRenameTag === "function") await onRenameTag(renaming.from, to);
      setRenaming(null);
    } finally {
      setBusy(false);
    }
  };
  const rowMenu = () => {
    const target = menu;
    if (target === null) return null;
    return h(
      "span",
      { className: "dshgn_rowMenu", onClick: (event) => event.stopPropagation() },
      // 标签多一个「改名」。目录不需要：目录名就是磁盘上的文件夹名，
      // 改名等于移动文件，风险比改个标签大得多，那是另一个功能。
      target.kind === "tag" && typeof onRenameTag === "function" ? h(
        "button",
        {
          type: "button",
          className: "dshgn_rowBtn",
          title: t("tree.menuRename"),
          onClick: () => {
            setRenaming({ from: target.name, to: target.name });
            setMenu(null);
          }
        },
        h(Icon, { name: "edit", size: 11 }),
        h("span", null, t("tree.menuRename"))
      ) : null,
      h(
        "button",
        {
          type: "button",
          className: "dshgn_rowBtn dshgn_rowBtnDanger",
          title: target.kind === "dir" ? t("tree.deleteDir") : t("tree.deleteTag"),
          onClick: () => {
            setConfirm({ kind: target.kind, name: target.name });
            setMenu(null);
          }
        },
        h(Icon, { name: "trash", size: 11 }),
        h("span", null, t("tree.menuDelete"))
      ),
      h(
        "button",
        {
          type: "button",
          className: "dshgn_rowBtn",
          title: t("tree.menuCancel"),
          onClick: () => setMenu(null)
        },
        h(Icon, { name: "close", size: 11 }),
        h("span", null, t("tree.menuCancel"))
      )
    );
  };
  const headActions = (kind, label, canCreate) => {
    const mode = kind === "dir" ? dirSort : tagSort;
    const setMode = kind === "dir" ? onDirSortChange : onTagSortChange;
    const nextMode = mode === "time" ? "name" : mode === "name" ? "count" : "time";
    return h(
      "div",
      { className: "dshgn_treeHeadRight" },
      h(
        "button",
        {
          type: "button",
          className: "dshgn_treeSort",
          title: `${t("tree.sort")}\uFF1A${t(`tree.sort${mode === "time" ? "Time" : mode === "name" ? "Name" : "Count"}`)}`,
          onClick: () => setMode(nextMode)
        },
        mode === "time" ? "\u23F1" : mode === "name" ? "A\u2192Z" : "#"
      ),
      canCreate ? h(
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
        h(Icon, { name: "plus", size: 12 })
      ) : null
    );
  };
  return h(
    "aside",
    { className: "dshgn_tree" },
    h(
      "div",
      {
        className: "dshgn_treeRow",
        "data-on": activeDir === "" && activeTag === "" ? "true" : "false",
        onClick: () => onPickDir("")
      },
      h(Icon, { name: "brain", size: 14 }),
      h("span", { className: "dshgn_treeName" }, t("tree.all")),
      h("span", { className: "dshgn_treeCount" }, String(total))
    ),
    // 热力图放在「全部笔记」正下方：它是「这个库整体在长」的视角，
    // 跟下面按目录/标签切分是两种维度，夹在中间会让人以为它属于某个目录。
    h(HeatmapStrip, { t, heatmap }),
    // 目录区
    h(
      "div",
      { className: "dshgn_treeHead" },
      h("span", { className: "dshgn_treeHeadTitle" }, t("tree.dirs")),
      headActions("dir", t("tree.newDir"), true)
    ),
    creating === "dir" ? h(
      "div",
      { className: "dshgn_treeNew" },
      h("input", {
        className: "dshgn_treeNewInput",
        type: "text",
        autoFocus: true,
        value: draft,
        placeholder: t("tree.newDirHint"),
        onChange: (event) => setDraft(event.target.value),
        onKeyDown: (event) => {
          if (event.key === "Enter") void runCreate();
          if (event.key === "Escape") setCreating(null);
        }
      }),
      h(
        "button",
        { type: "button", className: "dshgn_treeNewOk", onClick: () => void runCreate(), disabled: busy },
        h(Icon, { name: "check", size: 12 })
      ),
      h(
        "button",
        { type: "button", className: "dshgn_treeNewCancel", onClick: () => setCreating(null), disabled: busy },
        h(Icon, { name: "close", size: 12 })
      )
    ) : null,
    flat.map(
      (node) => h(
        "div",
        {
          key: node.path,
          className: "dshgn_treeRow",
          "data-on": activeDir === node.path ? "true" : "false",
          style: { paddingLeft: `${7 + node.depth * 11}px` },
          onClick: () => onPickDir(node.path),
          onContextMenu: (event) => openMenu(event, "dir", node.path),
          title: `${node.path}
${t("tree.menuDelete")}\uFF1A\u53F3\u952E`
        },
        h(Icon, { name: "folder", size: 13 }),
        h("span", { className: "dshgn_treeName" }, node.name),
        menu !== null && menu.kind === "dir" && menu.name === node.path ? rowMenu() : h("span", { className: "dshgn_treeCount" }, String(node.count))
      )
    ),
    // 标签区
    h(
      "div",
      { className: "dshgn_treeHead" },
      h("span", { className: "dshgn_treeHeadTitle" }, t("tree.tags")),
      headActions("tag", t("tree.newTag"), true)
    ),
    creating === "tag" ? h(
      "div",
      { className: "dshgn_treeNew" },
      h("input", {
        className: "dshgn_treeNewInput",
        type: "text",
        autoFocus: true,
        value: draft,
        placeholder: t("tree.newTagHint"),
        onChange: (event) => setDraft(event.target.value),
        onKeyDown: (event) => {
          if (event.key === "Enter") void runCreate();
          if (event.key === "Escape") setCreating(null);
        }
      }),
      h(
        "button",
        { type: "button", className: "dshgn_treeNewOk", onClick: () => void runCreate(), disabled: busy },
        h(Icon, { name: "check", size: 12 })
      ),
      h(
        "button",
        { type: "button", className: "dshgn_treeNewCancel", onClick: () => setCreating(null), disabled: busy },
        h(Icon, { name: "close", size: 12 })
      )
    ) : null,
    sortedTags.length > 0 ? h(
      "div",
      { className: "dshgn_treeTags" },
      // 标签项外面包一层 span：行内菜单里也是按钮，button 不能套 button
      // （HTML 非法，React 会警告，点击也会被外层吞掉）。
      sortedTags.map(
        ([tag, count]) => renaming !== null && renaming.from === tag ? h(
          "span",
          { key: tag, className: "dshgn_treeNew" },
          h("input", {
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
          h(
            "button",
            { type: "button", className: "dshgn_treeNewOk", onClick: () => void runRename(), disabled: busy },
            h(Icon, { name: "check", size: 12 })
          ),
          h(
            "button",
            { type: "button", className: "dshgn_treeNewCancel", onClick: () => setRenaming(null), disabled: busy },
            h(Icon, { name: "close", size: 12 })
          )
        ) : h(
          "span",
          { key: tag, className: "dshgn_tagWrap" },
          h(
            "button",
            {
              type: "button",
              className: "dshgn_tagRow",
              "data-on": activeTag === tag ? "true" : "false",
              onClick: () => onPickTag(activeTag === tag ? "" : tag),
              onContextMenu: (event) => openMenu(event, "tag", tag)
            },
            `${tag} ${count}`
          ),
          menu !== null && menu.kind === "tag" && menu.name === tag ? rowMenu() : null
        )
      )
    ) : null,
    // 二次确认
    confirm !== null ? h(
      "div",
      { className: "dshgn_modalMask", onClick: () => setConfirm(null) },
      h(
        "div",
        { className: "dshgn_modal", onClick: (event) => event.stopPropagation() },
        h(
          "div",
          { className: "dshgn_modalTitle" },
          confirm.kind === "dir" ? t("tree.deleteDir") : t("tree.deleteTag")
        ),
        h(
          "div",
          { className: "dshgn_modalBody" },
          (confirm.kind === "dir" ? t("tree.deleteDirConfirm") : t("tree.deleteTagConfirm")).replace(
            "{name}",
            confirm.name
          )
        ),
        h(
          "div",
          { className: "dshgn_modalActions" },
          h(
            "button",
            { type: "button", className: "dshgn_btn", onClick: () => setConfirm(null), disabled: busy },
            t("action.cancel")
          ),
          h(
            "button",
            {
              type: "button",
              className: "dshgn_btn dshgn_btnDanger",
              onClick: () => void runDelete(),
              disabled: busy
            },
            t("action.delete")
          )
        )
      )
    ) : null
  );
}
function NotePane(props) {
  const { t, status, current, draft, setDraft, dirty, busy, onSave, onDelete, onCopyReference, onOpenWikiLink, onSyncOne, onRestored, onError, onToggleTodo } = props;
  const [editing, setEditing] = React.useState(false);
  const [showOutline, setShowOutline] = React.useState(true);
  const [backlinks, setBacklinks] = React.useState(null);
  const scrollRef = React.useRef(null);
  const [textScale, setTextScale] = React.useState(() => {
    try {
      const saved = window.localStorage.getItem("dshgn.textScale");
      return saved === "s" || saved === "l" ? saved : "m";
    } catch {
      return "m";
    }
  });
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyItems, setHistoryItems] = React.useState(null);
  const [historyPreview, setHistoryPreview] = React.useState(null);
  const [historyBusy, setHistoryBusy] = React.useState(false);
  const loadHistory = React.useCallback(async (path) => {
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
  const previewHistory = React.useCallback(
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
  const restoreHistory = React.useCallback(
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
  const pickScale = React.useCallback((next) => {
    setTextScale(next);
    try {
      window.localStorage.setItem("dshgn.textScale", next);
    } catch {
    }
  }, []);
  React.useEffect(() => {
    setEditing(false);
    setHistoryOpen(false);
    setHistoryItems(null);
    setHistoryPreview(null);
  }, [current !== null ? current.path : null]);
  const currentPath = current !== null ? current.path : null;
  React.useEffect(() => {
    if (currentPath === null) {
      setBacklinks(null);
      return void 0;
    }
    let alive = true;
    setBacklinks(null);
    void api(`/backlinks?path=${encodeURIComponent(currentPath)}`).then((json) => {
      if (alive) setBacklinks(json);
    }).catch(() => {
      if (alive) setBacklinks({ hits: [] });
    });
    return () => {
      alive = false;
    };
  }, [currentPath]);
  const jumpToHeading = React.useCallback((index) => {
    const host = scrollRef.current;
    if (!host) return;
    const heads = host.querySelectorAll(".dshgn_h");
    const target = heads[index];
    if (!target) return;
    const offset = target.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop - 8;
    host.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
  }, []);
  if (current === null) {
    return h(
      "section",
      { className: "dshgn_note" },
      h(
        "div",
        { className: "dshgn_empty" },
        h(Icon, { name: "brain", size: 26 }),
        h("div", { className: "dshgn_emptyTitle" }, t("empty.select")),
        h("div", { className: "dshgn_emptyDesc" }, t("empty.selectDesc"))
      )
    );
  }
  const absolute = status !== null ? `${status.vaultRoot}/${current.path}` : current.path;
  return h(
    "section",
    { className: "dshgn_note" },
    h(
      "div",
      { className: "dshgn_noteHead" },
      h("div", { className: "dshgn_notePath", title: absolute }, current.path),
      // 字号三档。放在笔记头而不是设置页：用户是在「读这篇字太小」的那一刻
      // 想调它，跑到设置页去调完再回来，会打断阅读。
      h(
        "div",
        { className: "dshgn_scaleGroup", role: "group", title: t("note.fontSize") },
        ["s", "m", "l"].map(
          (size) => h(
            "button",
            {
              key: size,
              type: "button",
              className: "dshgn_scaleBtn" + (textScale === size ? " dshgn_scaleBtnOn" : ""),
              onClick: () => pickScale(size),
              title: t(`note.fontSize.${size}`)
            },
            // 三个 A 用不同字号画，比写「小/中/大」省位置，也比图标直观
            h("span", { style: { fontSize: size === "s" ? 10 : size === "m" ? 12 : 14, lineHeight: 1 } }, "A")
          )
        )
      ),
      dirty ? h("span", { className: "dshgn_badge" }, t("note.unsaved")) : null,
      editing ? h(
        React.Fragment,
        null,
        h(
          "button",
          { type: "button", className: "dshgn_btn dshgn_btnPrimary", onClick: onSave, disabled: busy || !dirty },
          h(Icon, { name: "check", size: 13 }),
          t("action.save")
        ),
        h(
          "button",
          { type: "button", className: "dshgn_btn", onClick: () => {
            setDraft(current.content);
            setEditing(false);
          }, disabled: busy },
          t("action.cancel")
        )
      ) : h(
        React.Fragment,
        null,
        h(
          "button",
          { type: "button", className: "dshgn_iconBtn", title: t("action.edit"), onClick: () => setEditing(true) },
          h(Icon, { name: "edit", size: 15 })
        ),
        h(
          "button",
          { type: "button", className: "dshgn_iconBtn", title: t("action.copyRef"), onClick: onCopyReference },
          h(Icon, { name: "link", size: 15 })
        ),
        // B1：单篇推云端 / 单篇拉云端。只有这篇确实在云端有 note_id 时
        // 才有意义，所以没 note_id 就不显示——点了会报「这篇还没同步过」，
        // 那还不如不给这个按钮。
        current.noteId ? h(
          "button",
          { type: "button", className: "dshgn_iconBtn", title: t("sync.pushOne"), onClick: () => onSyncOne("push"), disabled: busy },
          h(Icon, { name: "cloud", size: 15 })
        ) : null,
        current.noteId ? h(
          "button",
          { type: "button", className: "dshgn_iconBtn", title: t("sync.pullOne"), onClick: () => onSyncOne("pull"), disabled: busy },
          h(Icon, { name: "sync", size: 15 })
        ) : null,
        h(
          "button",
          {
            type: "button",
            className: "dshgn_iconBtn",
            title: t("history.title"),
            "data-on": historyOpen ? "true" : "false",
            onClick: () => {
              const next = !historyOpen;
              setHistoryOpen(next);
              if (next) void loadHistory(current.path);
            }
          },
          h(Icon, { name: "clock", size: 15 })
        ),
        h(
          "button",
          { type: "button", className: "dshgn_iconBtn", title: t("action.delete"), onClick: onDelete, disabled: busy },
          h(Icon, { name: "trash", size: 15 })
        )
      )
    ),
    editing ? h("textarea", {
      className: "dshgn_editor",
      value: draft === null ? "" : draft,
      spellCheck: false,
      onChange: (event) => setDraft(event.target.value)
    }) : historyOpen ? h(
      "div",
      { className: "dshgn_historyPane" },
      h(
        "div",
        { className: "dshgn_historyHead" },
        h(Icon, { name: "clock", size: 13 }),
        h("span", null, t("history.title")),
        h("span", { className: "dshgn_outlineCount" }, historyItems === null ? "\u2026" : String(historyItems.length)),
        h(
          "button",
          { type: "button", className: "dshgn_btn", style: { marginLeft: "auto" }, onClick: () => {
            setHistoryOpen(false);
            setHistoryPreview(null);
          } },
          t("action.close")
        )
      ),
      historyPreview !== null ? h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "dshgn_rowLine", style: { padding: "6px 12px", gap: 8 } },
          h("span", { className: "dshgn_fieldHint" }, formatTime(historyPreview.savedAt)),
          h(
            "button",
            { type: "button", className: "dshgn_btn dshgn_btnPri", style: { marginLeft: "auto" }, onClick: () => void restoreHistory(historyPreview.name), disabled: historyBusy },
            t("history.restore")
          ),
          h("button", { type: "button", className: "dshgn_btn", onClick: () => setHistoryPreview(null), disabled: historyBusy }, t("action.back"))
        ),
        h("pre", { className: "dshgn_diffBody", style: { flex: 1, minHeight: 0 } }, historyPreview.content)
      ) : historyItems === null ? h("div", { className: "dshgn_emptyState" }, h("span", { className: "dshgn_spin" })) : historyItems.length === 0 ? h(
        "div",
        { className: "dshgn_empty" },
        h(Icon, { name: "clock", size: 22 }),
        h("div", { className: "dshgn_emptyTitle" }, t("history.empty")),
        h("div", { className: "dshgn_emptyDesc" }, t("history.emptyHint"))
      ) : h(
        "div",
        { className: "dshgn_historyList" },
        historyItems.map(
          (item) => h(
            "button",
            {
              key: item.name,
              type: "button",
              className: "dshgn_historyItem",
              onClick: () => void previewHistory(item.name),
              disabled: historyBusy
            },
            h("span", { className: "dshgn_historyTime" }, formatTime(item.savedAt)),
            h("span", { className: "dshgn_historyMeta" }, formatBytes2(item.bytes))
          )
        )
      )
    ) : h(
      "div",
      { className: "dshgn_scroll", ref: scrollRef },
      // 大纲：长笔记（尤其逐字稿那种几千字）靠滚动找「金句在哪一节」非常费劲，
      // 给一排可点的标题省掉这个过程。默认展开，但可以收起——有些用户
      // 只想一口气读完，多一行都是干扰。
      Array.isArray(current.outline) && current.outline.length > 1 ? h(
        "div",
        { className: "dshgn_outline" },
        h(
          "button",
          {
            type: "button",
            className: "dshgn_outlineToggle",
            onClick: () => setShowOutline((prev) => !prev),
            title: t("note.outline")
          },
          h(Icon, { name: showOutline ? "up" : "file", size: 12 }),
          t("note.outline"),
          h("span", { className: "dshgn_outlineCount" }, String(current.outline.length))
        ),
        showOutline ? h(
          "div",
          { className: "dshgn_outlineList" },
          current.outline.map(
            (item, index) => h(
              "button",
              {
                key: `${index}-${item.text}`,
                type: "button",
                className: "dshgn_outlineItem",
                // 缩进跟着标题层级走，三级标题比一级多缩进两格，
                // 结构一眼能看出来，不用读文字判断谁是谁的子节。
                style: { paddingLeft: 8 + Math.max(0, item.level - 1) * 12 },
                onClick: () => jumpToHeading(index)
              },
              item.text
            )
          )
        ) : null
      ) : null,
      // 附件里的录音直接放播放器：合并两套体系时把这些 mp3 搬进来了，
      // 如果只留 markdown 里那条外链，用户还得跳浏览器才能听。
      (current.assets || []).filter((asset) => asset.kind === "audio").map(
        (asset, index) => h(AudioPlayer, {
          key: `${asset.path}-${index}`,
          t,
          track: {
            url: withToken(`${apiOrigin()}/getnote/asset?path=${encodeURIComponent(asset.path)}`),
            duration: 0,
            kind: "local",
            title: assetLabel(asset.name)
          }
        })
      ),
      // 附件里的图片也画出来。以前只筛 audio，`kind:'image'` 的附件在面板里
      // 完全看不见——用户明明存了图，却以为没同步下来。
      (current.assets || []).some((asset) => asset.kind === "image") ? h(
        "div",
        { className: "dshgn_imgRow" },
        (current.assets || []).filter((asset) => asset.kind === "image").map(
          (asset, index) => h("img", {
            key: `${asset.path}-${index}`,
            className: "dshgn_img",
            src: withToken(`${apiOrigin()}/getnote/asset?path=${encodeURIComponent(asset.path)}`),
            alt: asset.name,
            title: asset.name,
            loading: "lazy"
          })
        )
      ) : null,
      // 阅读时只渲染正文：`content` 带 YAML frontmatter，直接 renderBlocks 会把
      // `title: xxx` / `note_id: "..."` 当成正文段落一条条铺出来。编辑时仍用
      // `content`，这样保存不会把 frontmatter 丢掉。
      h(
        "div",
        { className: "dshgn_md" + (textScale === "s" ? " dshgn_mdS" : textScale === "l" ? " dshgn_mdL" : "") },
        renderBlocks(
          current.body !== void 0 && current.body !== null ? current.body : current.content,
          // 编辑态不给 onToggleTodo：那时显示的是可编辑 textarea，正文里的
          // 方框根本不该响应点击（改内容要走保存）。只有阅读态才可点。
          { assets: current.assets || [], onOpenWikiLink, onToggleTodo: editing ? void 0 : onToggleTodo }
        )
      ),
      // 关联笔记（反向链接）：用户写了很多 [[双链]]，但双链只有「点进去」
      // 一个方向；想看「谁提到了我这篇」只能靠这个面板。
      backlinks !== null && Array.isArray(backlinks.hits) && backlinks.hits.length > 0 ? h(
        "div",
        { className: "dshgn_backlinks" },
        h("div", { className: "dshgn_backlinksHead" }, h(Icon, { name: "link", size: 12 }), t("note.backlinks"), h("span", { className: "dshgn_outlineCount" }, String(backlinks.hits.length))),
        backlinks.hits.map(
          (hit) => h(
            "button",
            {
              key: hit.path,
              type: "button",
              className: "dshgn_backlinkItem",
              title: hit.path,
              onClick: () => onOpenWikiLink(hit.path)
            },
            h("span", { className: "dshgn_backlinkTitle" }, hit.title || hit.path),
            h("span", { className: "dshgn_backlinkPath" }, hit.path)
          )
        )
      ) : null
    )
  );
}
function ImportPane(props) {
  const { t, status, onRefresh, onDone } = props;
  const [state, setState] = React.useState(null);
  const [authUrl, setAuthUrl] = React.useState(null);
  const [waiting, setWaiting] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const loadStatus = React.useCallback(async () => {
    try {
      const json = await api("/import/status");
      setState(json);
      return json;
    } catch {
      return null;
    }
  }, []);
  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);
  const running = state !== null && state.running === true;
  React.useEffect(() => {
    if (!running) return void 0;
    const timer = window.setInterval(() => {
      void loadStatus().then((json) => {
        if (json && json.running === false) onDone();
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [running, loadStatus, onDone]);
  const loggedIn = status !== null && status.cloud !== null && status.cloud.loggedIn === true;
  const startLogin = React.useCallback(async () => {
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
  React.useEffect(() => {
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
  const startImport = React.useCallback(async () => {
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
  const logout = React.useCallback(async () => {
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
  return h(
    "div",
    { className: "dshgn_pane" },
    h(
      "div",
      { className: "dshgn_cardBox" },
      h(
        "div",
        { className: "dshgn_section" },
        h("div", { className: "dshgn_sectionTitle" }, t("import.title")),
        h("div", { className: "dshgn_sectionDesc" }, t("import.desc")),
        h(
          "div",
          { className: "dshgn_rowLine" },
          h(
            "span",
            { className: loggedIn ? "dshgn_badge dshgn_badgeOk" : "dshgn_badge" },
            h(Icon, { name: "cloud", size: 11 }),
            loggedIn ? t("import.loggedIn") : t("import.notLoggedIn")
          ),
          status !== null && status.lastSyncAt ? h("span", { className: "dshgn_badge" }, `${t("import.lastSync")}: ${formatTime(status.lastSyncAt)}`) : h("span", { className: "dshgn_badge" }, `${t("import.lastSync")}: ${t("import.never")}`),
          status !== null && status.notes > 0 ? h("span", { className: "dshgn_badge" }, `${status.notes} ${t("meta.notes")}`) : null
        ),
        h(
          "div",
          { className: "dshgn_rowLine" },
          loggedIn ? h(
            React.Fragment,
            null,
            h(
              "button",
              { type: "button", className: "dshgn_btn dshgn_btnPrimary", onClick: startImport, disabled: busy || running },
              running ? h("span", { className: "dshgn_spin" }) : h(Icon, { name: "cloud", size: 13 }),
              running ? t("import.running") : t("import.start")
            ),
            h("button", { type: "button", className: "dshgn_btn", onClick: logout, disabled: busy || running }, t("import.logout"))
          ) : h(
            React.Fragment,
            null,
            h(
              "button",
              { type: "button", className: "dshgn_btn dshgn_btnPrimary", onClick: startLogin, disabled: busy },
              h(Icon, { name: "cloud", size: 13 }),
              t("import.login")
            ),
            h("span", { className: "dshgn_sectionDesc" }, t("import.loginHint"))
          )
        ),
        !loggedIn ? h("div", { className: "dshgn_sectionDesc" }, t("import.cloudHint")) : null,
        authUrl !== null ? h(
          "div",
          { className: "dshgn_sectionDesc" },
          waiting ? `${t("import.authorizeWait")} ` : "",
          // 用按钮而不是 a[target=_blank]：Obsidian 的自定义视图里点外链
          // 有时会把整个应用导航走，比打开浏览器难收拾得多。
          h(
            "button",
            {
              type: "button",
              className: "dshgn_link dshgn_linkBtn",
              onClick: () => openExternal(authUrl)
            },
            t("import.openLink")
          )
        ) : null
      ),
      error !== null ? h("div", { className: "dshgn_error", role: "alert" }, error) : null,
      result !== null ? h(
        "div",
        { className: "dshgn_section" },
        h("div", { className: "dshgn_sectionTitle" }, t("import.result")),
        h(
          "div",
          { className: "dshgn_rowLine" },
          h("span", { className: "dshgn_badge dshgn_badgeOk" }, `${t("import.newNotes")} ${result.created}`),
          h("span", { className: "dshgn_badge" }, `${t("import.skipped")} ${result.skipped}`),
          h("span", { className: "dshgn_badge" }, `${t("import.failed")} ${result.failed}`),
          h("span", { className: "dshgn_badge" }, `${Math.round((result.durationMs || 0) / 1e3)}s`)
        ),
        h("div", { className: "dshgn_sectionDesc" }, result.root)
      ) : null,
      lines.length > 0 ? h("div", { className: "dshgn_log" }, lines.map((line, index) => h("div", { key: index }, `${formatTime(line.at)}  ${line.text}`))) : null
    )
  );
}
function SettingsPane(props) {
  const { t, status, onSaved, onError, onThemePreview, showToast, locale, onLocaleChange, onSyncChanged } = props;
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => {
    if (!touched && status !== null) setInput(status.subfolder || "");
  }, [status, touched]);
  const save = React.useCallback(
    async (path) => {
      setBusy(true);
      try {
        await api("/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vaultPath: path })
        });
        setTouched(false);
        await onSaved(t("settings.saved"));
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [onError, onSaved, t]
  );
  const suggestions = status !== null && Array.isArray(status.suggestions) ? status.suggestions : [];
  const cloudApi = status !== null && status.api ? status.api : null;
  const loginState = status === null || status.cloud === null || status.cloud.loggedIn !== true ? "none" : status.cloud.expired === true ? "expired" : "ok";
  return h(
    "div",
    { className: "dshgn_pane" },
    h(
      "div",
      { className: "dshgn_cardBox" },
      h(
        "div",
        { className: "dshgn_section" },
        h("div", { className: "dshgn_sectionTitle" }, t("settings.vault")),
        h("div", { className: "dshgn_sectionDesc" }, t("settings.vaultHint")),
        h(
          "div",
          { className: "dshgn_rowLine" },
          h("input", {
            className: "dshgn_input",
            value: input,
            spellCheck: false,
            placeholder: status !== null ? status.vaultRoot : "",
            onChange: (event) => {
              setTouched(true);
              setInput(event.target.value);
            }
          }),
          h("button", { type: "button", className: "dshgn_btn dshgn_btnPrimary", onClick: () => save(input), disabled: busy }, t("settings.save"))
        ),
        status !== null && status.vaultMissing ? h("div", { className: "dshgn_error" }, `\u2715 ${status.vaultMissing}`) : null,
        status !== null ? h("div", { className: "dshgn_sectionDesc" }, `${status.notes} ${t("meta.notes")} \xB7 ${status.dirs} ${t("meta.dirs")} \xB7 ${formatBytes2(status.bytes)}`) : null
      ),
      suggestions.length > 0 ? h(
        "div",
        { className: "dshgn_section" },
        h("div", { className: "dshgn_sectionTitle" }, t("settings.suggest")),
        suggestions.map(
          (item) => h(
            "div",
            { key: item.path, className: "dshgn_rowLine" },
            h("div", { className: "dshgn_sectionDesc", style: { flex: 1, minWidth: 0, wordBreak: "break-all" } }, `${item.path} \u2014 ${item.notes} ${t("meta.notes")}`),
            h("button", { type: "button", className: "dshgn_btn", onClick: () => save(item.path), disabled: busy }, t("settings.use"))
          )
        )
      ) : null,
      h(CloudCredCard, { t, api: cloudApi, onSaved, onError }),
      // 自动同步紧跟在云端接入卡后面：它俩是同一件事的两半——上面说「用哪条
      // 通道连云端」，这里说「多久自动拉一次」。中间隔着主题色/语言会让这层
      // 关系看不出来。
      h(SyncPane, { t, status, onChanged: onSyncChanged, onError, showToast }),
      h(ThemeCard, { t, themeColor: status !== null ? status.themeColor : null, onSaved, onError, onPreview: onThemePreview }),
      h(LanguageCard, { t, locale, onSaved, onError, onLocaleChange }),
      // 模板卡放在语言之后、备份之前：它属于「写作习惯」这一类，跟主题色/语言
      // 挨着；备份是整库操作，应该留在最后。
      h(TemplateCard, { t, status, onSaved, onError }),
      h(ArchiveCard, { t, status, onChanged: onSaved, onError, showToast }),
      h(
        "div",
        { className: "dshgn_section" },
        h(
          "div",
          { className: "dshgn_sectionHead" },
          h("div", { className: "dshgn_sectionTitle" }, t("settings.authFile")),
          h(
            "span",
            {
              // auth.json 存在只说明「登录过」，令牌过期后它还在文件里。
              // 这时仍显示「已登录」会骗人：用户以为登录有效，其实云端操作
              // 走的是 API Key 那条通道。所以按 expiresAt 分三态。
              className: "dshgn_badge" + (loginState === "ok" ? " dshgn_badgeOk" : loginState === "expired" ? " dshgn_badgeWarn" : "")
            },
            loginState === "ok" ? t("settings.loggedIn") : loginState === "expired" ? t("settings.loginExpired") : t("settings.loggedOut")
          )
        ),
        h("div", { className: "dshgn_sectionDesc" }, status !== null ? status.authPath : ""),
        h("div", { className: "dshgn_sectionDesc" }, t("settings.storeHint"))
      )
    )
  );
}
function ThemeCard(props) {
  const { t, themeColor, onSaved, onError, onPreview } = props;
  const [draft, setDraft] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [custom, setCustom] = React.useState(false);
  const active = draft === null ? themeColor : draft;
  React.useEffect(() => {
    if (typeof onPreview === "function") onPreview(draft);
    return () => {
      if (typeof onPreview === "function") onPreview(null);
    };
  }, [draft, onPreview]);
  const save = React.useCallback(
    async (value) => {
      setBusy(true);
      try {
        await api("/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ themeColor: value })
        });
        await onSaved(t("theme.saved"));
        setDraft(null);
      } catch (err) {
        onError(err && err.message ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [onError, onSaved, t]
  );
  const presets = ["#0a2a52", "#14342b", "#4a2036", "#3b2d5c", "#5c3a1e", "#22434f", "#40202c", "#333333"];
  return h(
    "div",
    { className: "dshgn_section" },
    h("div", { className: "dshgn_sectionTitle" }, t("theme.title")),
    h("div", { className: "dshgn_sectionDesc" }, t("theme.desc")),
    h(
      "div",
      { className: "dshgn_themeRow" },
      presets.map(
        (hex) => h("button", {
          key: hex,
          type: "button",
          className: "dshgn_swatch" + (active === hex ? " dshgn_swatchOn" : ""),
          title: hex,
          "aria-label": hex,
          style: { background: hex },
          onClick: () => setDraft(hex)
        })
      ),
      h(
        "button",
        { type: "button", className: "dshgn_btn", onClick: () => setCustom(!custom) },
        custom ? t("theme.preset") : t("theme.custom")
      )
    ),
    custom ? h(
      "div",
      { className: "dshgn_rowLine", style: { marginTop: 8 } },
      h("input", {
        type: "color",
        className: "dshgn_colorInput",
        value: active === null ? "#0a2a52" : active,
        onChange: (event) => setDraft(event.target.value)
      }),
      h("input", {
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
      const preview = themeVars(active);
      if (preview === null) return null;
      return h(
        "div",
        { className: "dshgn_previewBar", "aria-hidden": "true" },
        h("div", { className: "dshgn_previewCell", style: { background: preview["--dshgn-deep"], color: preview["--dshgn-deepFg"] } }, t("theme.previewLeft")),
        h("div", { className: "dshgn_previewCell", style: { background: preview["--dshgn-mid"], color: preview["--dshgn-midFg"] } }, t("theme.previewMid")),
        h("div", { className: "dshgn_previewCell", style: { background: preview["--dshgn-light"], color: preview["--dshgn-lightFg"] } }, t("theme.previewRight"))
      );
    })(),
    h(
      "div",
      { className: "dshgn_rowLine", style: { marginTop: 10 } },
      h("button", { type: "button", className: "dshgn_btn dshgn_btnPrimary", onClick: () => save(active), disabled: busy || draft === null }, t("theme.apply")),
      h("button", { type: "button", className: "dshgn_btn", onClick: () => save(null), disabled: busy }, t("theme.reset"))
    )
  );
}
function CloudCredCard(props) {
  const { t, api: apiInfo, onSaved, onError } = props;
  const configured = apiInfo !== null && apiInfo.configured === true;
  const [apiKey, setApiKey] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [grantId, setGrantId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [probe, setProbe] = React.useState(null);
  const save = React.useCallback(async () => {
    if (apiKey.trim() === "" || clientId.trim() === "") {
      onError(t("api.needKey"));
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
      await onSaved(t("api.saved"));
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [apiKey, clientId, grantId, onSaved, onError, t]);
  const test = React.useCallback(async () => {
    setTesting(true);
    setProbe(null);
    try {
      const result = await api("/api/probe");
      setProbe({ ok: true, text: `${t("api.ok")}${result.total !== void 0 ? ` \xB7 ${result.total}` : ""}` });
    } catch (err) {
      setProbe({ ok: false, text: err && err.message ? err.message : String(err) });
      onError(err && err.message ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }, [onError, t]);
  const clear = React.useCallback(async () => {
    if (!window.confirm(t("api.clear"))) return;
    setBusy(true);
    setProbe(null);
    try {
      await api("/api/clear", { method: "POST" });
      await onSaved(t("api.cleared"));
    } catch (err) {
      onError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [onSaved, onError, t]);
  return h(
    "div",
    { className: "dshgn_section" },
    h(
      "div",
      { className: "dshgn_rowLine" },
      h("div", { className: "dshgn_sectionTitle" }, t("api.title")),
      h("span", { className: "dshgn_badge" + (configured ? " dshgn_badgeOk" : "") }, configured ? t("api.ready") : t("api.notReady")),
      configured && apiInfo.apiKeyMasked ? h("span", { className: "dshgn_treeCount" }, `${apiInfo.apiKeyMasked} \xB7 ${apiInfo.clientIdMasked || ""}`) : null
    ),
    h("div", { className: "dshgn_sectionDesc" }, t("api.desc")),
    // Key 被服务端拒过：这条必须显眼。用户填完 Key 看到「已接入」，然后云端每个
    // 操作都失败，却不知道为什么——那是这个插件最糟的体验。
    apiInfo !== null && apiInfo.keyRejected === true ? h(
      "div",
      { className: "dshgn_banner dshgn_bannerWarn" },
      h("div", { className: "dshgn_bannerTitle" }, t("api.keyRejected")),
      h("div", { className: "dshgn_bannerDesc" }, apiInfo.keyError || ""),
      apiInfo.fallbackAvailable === true ? h("div", { className: "dshgn_bannerDesc" }, t("api.usingFallback")) : null
    ) : null,
    // 走的是登录通道（不是 Key）：说明清楚，省得用户以为 Key 没存住
    apiInfo !== null && apiInfo.effectiveTransport === "mcp" && apiInfo.keyRejected !== true ? h("div", { className: "dshgn_fieldHint" }, t("api.viaLogin")) : null,
    h(
      "div",
      { className: "dshgn_field" },
      h("span", { className: "dshgn_fieldLabel" }, t("api.apiKey")),
      h("input", {
        className: "dshgn_input",
        type: "password",
        autoComplete: "off",
        spellCheck: false,
        value: apiKey,
        placeholder: configured ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\uFF08\u5DF2\u4FDD\u5B58\uFF0C\u91CD\u65B0\u586B\u53EF\u66FF\u6362\uFF09" : t("api.keyPlaceholder"),
        onChange: (event) => setApiKey(event.target.value)
      })
    ),
    h(
      "div",
      { className: "dshgn_field" },
      h("span", { className: "dshgn_fieldLabel" }, t("api.clientId")),
      h("input", {
        className: "dshgn_input",
        spellCheck: false,
        value: clientId,
        placeholder: configured ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\uFF08\u5DF2\u4FDD\u5B58\uFF0C\u91CD\u65B0\u586B\u53EF\u66FF\u6362\uFF09" : t("api.idPlaceholder"),
        onChange: (event) => setClientId(event.target.value)
      })
    ),
    h(
      "div",
      { className: "dshgn_field" },
      h("span", { className: "dshgn_fieldLabel" }, t("api.grantId")),
      h("input", {
        className: "dshgn_input",
        spellCheck: false,
        value: grantId,
        placeholder: configured && apiInfo.hasGrantId ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : t("api.grantPlaceholder"),
        onChange: (event) => setGrantId(event.target.value)
      })
    ),
    h(
      "div",
      { className: "dshgn_rowLine" },
      h("button", { type: "button", className: "dshgn_btn dshgn_btnPrimary", onClick: save, disabled: busy }, busy ? h("span", { className: "dshgn_spin" }) : h(Icon, { name: "check", size: 12 }), t("api.save")),
      configured ? h("button", { type: "button", className: "dshgn_btn", onClick: test, disabled: testing }, testing ? h("span", { className: "dshgn_spin" }) : null, testing ? t("api.testing") : t("api.test")) : null,
      configured ? h("button", { type: "button", className: "dshgn_btn dshgn_btnDanger", onClick: clear, disabled: busy }, t("api.clear")) : null
    ),
    probe !== null ? h("div", { className: probe.ok ? "dshgn_fieldHint" : "dshgn_error", style: probe.ok ? { color: "var(--dsw-alias-state-success-primary)" } : void 0 }, `${probe.ok ? "\u2713" : "\u2715"} ${probe.text}`) : null,
    h("div", { className: "dshgn_fieldHint" }, t("api.consoleHint")),
    h("div", { className: "dshgn_fieldHint" }, t("api.neverEcho")),
    apiInfo !== null && apiInfo.credentialsPath ? h("div", { className: "dshgn_fieldHint" }, `${t("api.file")}: ${apiInfo.credentialsPath}`) : null
  );
}
var ErrorBoundaryBase = typeof React !== "undefined" && React && React.Component ? React.Component : class {
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
  static getDerivedStateFromError(error) {
    return { error: error || new Error("\u6E32\u67D3\u5F02\u5E38") };
  }
  componentDidCatch(error, info) {
    console.error("[dsh-getnote] \u9762\u677F\u6E32\u67D3\u5F02\u5E38\uFF0C\u5DF2\u964D\u7EA7\u663E\u793A\uFF1A", error, info && info.componentStack);
  }
  retry() {
    this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      const message = String(this.state.error && this.state.error.message || this.state.error);
      const stack = String(this.state.error && this.state.error.stack || "").split("\n").slice(0, 6).join("\n");
      return h(
        "div",
        { className: "dshgn_root dshgn_boundary", role: "alert" },
        h("div", { className: "dshgn_boundaryTitle" }, "\u5F97\u5230\u5927\u8111\u9762\u677F\u6E32\u67D3\u51FA\u9519"),
        h("div", { className: "dshgn_boundaryMsg" }, message),
        h("pre", { className: "dshgn_boundaryStack" }, stack),
        h(
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
  return h(PanelBoundary, null, h(GetnotePage, props));
}

// src/view/view.js
var import_obsidian = require("obsidian");
var React2 = __toESM(require_react(), 1);
var import_client = __toESM(require_client(), 1);
var VIEW_TYPE_GETNOTE = "getnote-obsidian-view";
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
    const container = this.contentEl;
    container.empty();
    container.addClass("dshgn_view");
    this.containerEl = container;
    const mount = container.createDiv({ cls: "dshgn_mount" });
    this.root = (0, import_client.createRoot)(mount);
    this.root.render(React2.createElement(PanelRoot, { plugin: this.plugin }));
    const beat = () => {
      if (!this.containerEl || !this.containerEl.isShown()) return;
      this.plugin.markPanelVisible();
    };
    beat();
    this.heartbeat = window.setInterval(beat, 2e4);
    this.registerInterval(this.heartbeat);
  }
  async onClose() {
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
var GetnoteObsidianPlugin = class extends import_obsidian2.Plugin {
  async onload() {
    const adapter2 = this.app.vault.adapter;
    const basePath2 = typeof adapter2.getBasePath === "function" ? adapter2.getBasePath() : "";
    const dataDir = this.resolveDataDir(basePath2);
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
    const stored = await readSettings();
    if (stored.subfolder && stored.subfolder !== DEFAULT_SUBFOLDER) {
      configure2({ subfolder: stored.subfolder });
    }
    const vaultRoot = resolveVaultRoot().root;
    try {
      await mkdir2(vaultRoot, { recursive: true });
    } catch (error) {
      new import_obsidian2.Notice(`\u5F97\u5230\u5927\u8111\uFF1A\u7B14\u8BB0\u76EE\u5F55\u5EFA\u4E0D\u51FA\u6765 \u2014\u2014 ${error && error.message ? error.message : error}`);
    }
    const preferredPort = Number(stored.localPort) > 0 ? Number(stored.localPort) : 0;
    try {
      this.server = await startLocalServer({ preferredPort });
      setApiOrigin(this.server.origin);
      setApiToken(this.server.token);
      this.localPort = this.server.port;
      this.portFallback = this.server.portFallback === true;
      if (this.localPort !== preferredPort) {
        await this.saveLocalPort(this.localPort);
      }
    } catch (error) {
      this.server = null;
      this.localPort = 0;
      this.portFallback = false;
      new import_obsidian2.Notice(`\u5F97\u5230\u5927\u8111\uFF1A\u672C\u5730\u670D\u52A1\u542F\u52A8\u5931\u8D25 \u2014\u2014 ${error && error.message ? error.message : error}`);
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
    this.addSettingTab(new GetnoteSettingTab(this.app, this));
    const bump = () => invalidateScan();
    this.registerEvent(this.app.vault.on("modify", bump));
    this.registerEvent(this.app.vault.on("create", bump));
    this.registerEvent(this.app.vault.on("delete", bump));
    this.registerEvent(this.app.vault.on("rename", bump));
    this.stopAutoSync = startAutoSync();
  }
  onunload() {
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
        } catch (error) {
          new import_obsidian2.Notice(`\u5F97\u5230\u5927\u8111\uFF1A${error && error.message ? error.message : error}`);
        }
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\u672C\u5730\u670D\u52A1").setDesc(
      this.plugin.localPort ? `\u8FD0\u884C\u4E2D\uFF1Ahttp://127.0.0.1:${this.plugin.localPort}${this.plugin.portFallback ? "\uFF08\u4F60\u6307\u5B9A\u7684\u7AEF\u53E3\u88AB\u5360\u7528\uFF0C\u8FD9\u6B21\u7528\u4E86\u7CFB\u7EDF\u5206\u914D\u7684\uFF1B\u4E91\u7AEF\u6388\u6743\u53EF\u80FD\u9700\u8981\u91CD\u65B0\u767B\u5F55\u4E00\u6B21\uFF09" : ""}` : "\u672A\u8FD0\u884C\u3002\u91CD\u542F Obsidian \u6216\u770B\u63A7\u5236\u53F0\u91CC\u7684\u62A5\u9519\u3002"
    );
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
/*! Bundled license information:

react/cjs/react.production.min.js:
  (**
   * @license React
   * react.production.min.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

scheduler/cjs/scheduler.production.min.js:
  (**
   * @license React
   * scheduler.production.min.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react-dom/cjs/react-dom.production.min.js:
  (**
   * @license React
   * react-dom.production.min.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
