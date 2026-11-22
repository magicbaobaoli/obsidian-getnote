/**
 * settings.js —— 设置与凭证的持久化（Obsidian 版）
 *
 * 与 DSH 版的差异只有一处：状态文件不再是 $DSH_HOME 下的一组 JSON，而是插件
 * 自己的数据目录（.obsidian/plugins/<id>/）下的同一组 JSON。文件名与结构保持
 * 不变，所以 DSH 版的设置可以原样拷过来用。
 *
 * 仍然**不进 localStorage**：这些是数据，不是界面偏好；写进浏览器存储会跟着
 * 窗口走，换个窗口就丢。
 *
 * 设计前提没有变：会员可能到期、云端随时会断，这里保存的一切都只是**可选同步
 * 通道**的状态。删掉 auth.json 之后插件仍然完整可用——笔记的真身是库里的
 * Markdown 文件。
 */
import { readFile, writeFile, rename, mkdir, chmod, realpath } from 'node:fs/promises'
// 注意这里的分工：插件自己的数据目录（设置、凭证）用 node:fs 直接读写，
// 因为它不在库里；而**库内**的目录（笔记子目录）必须走 vfs，
// 否则 adapter 后端下 stat 会去查真实磁盘，明明建好了还说目录不存在。
import { stat as vfsStat, mkdir as vfsMkdir } from './vfs.js'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { HISTORY_LIMIT, HISTORY_LIMIT_MAX } from './history.js'

const SETTINGS_FILENAME = 'dsh-getnote.json'
const AUTH_FILENAME = 'dsh-getnote/auth.json'
const CLOUD_FILENAME = 'dsh-getnote/cloud.json'
const SYNC_FILENAME = 'dsh-getnote/state.json'

/**
 * 运行期配置（由 main.js 在 onload 时注入）。
 *
 *   dataDir   —— 插件数据目录的绝对路径（放设置与凭证）
 *   vaultBase —— Obsidian 库根的绝对路径（adapter.getBasePath()）
 *   subfolder —— 笔记落在库内的哪个子目录（默认「得到大脑」）
 */
let runtime = {
  dataDir: '',
  vaultBase: '',
  subfolder: '得到大脑',
}

export function configure(options = {}) {
  if (typeof options.dataDir === 'string' && options.dataDir !== '') runtime.dataDir = options.dataDir
  if (typeof options.vaultBase === 'string' && options.vaultBase !== '') runtime.vaultBase = options.vaultBase
  if (typeof options.subfolder === 'string' && options.subfolder.trim() !== '') runtime.subfolder = options.subfolder.trim()
  return { ...runtime }
}

export function getRuntime() {
  return { ...runtime }
}

/** 插件数据目录（替代 DSH 版的 $DSH_HOME）。 */
export function dshHome() {
  if (runtime.dataDir !== '') return runtime.dataDir
  const env = process.env.DSH_HOME
  return env && env.trim() !== '' ? env : join(homedir(), '.dsh')
}

export function settingsPath() {
  return join(dshHome(), SETTINGS_FILENAME)
}

export function authPath() {
  return join(dshHome(), AUTH_FILENAME)
}

/**
 * 默认笔记根：库根下的 <subfolder>。
 *
 * 和 DSH 版一样刻意**不在库根直接铺文件**：库根往往已经有用户自己的目录结构，
 * 插件往里撒笔记会让「我的库」变得难以整理。放进一个自己的子目录，用户可以
 * 随时改名、移动，插件下次启动会跟着设置走。
 */
export function defaultVaultRoot() {
  const base = runtime.vaultBase
  if (base === '') return join(homedir(), '得到大脑')
  return join(base, runtime.subfolder)
}

/** 把任意输入收敛成库内相对路径（去掉盘符/绝对路径，防越界）。 */
function toSubfolder(input) {
  const raw = String(input == null ? '' : input).replace(/\\/g, '/').trim()
  if (raw === '') return '得到大脑'
  // 用户可能贴进来一个绝对路径：截到库根之后的部分
  const base = runtime.vaultBase.replace(/\\/g, '/')
  let rel = raw
  if (base !== '' && raw.toLowerCase().startsWith(base.toLowerCase())) rel = raw.slice(base.length)
  rel = rel.replace(/^\/+/, '').replace(/\/+$/, '')
  // 收敛成空 = 用户指的正是库根本身。这里必须回落到默认子目录，而不是返回空串：
  // 空串会被 defaultVaultRoot 拼成「库根」，等于让插件把笔记铺进用户自己的库，
  // 而且 setVaultRoot 会把 runtime.subfolder 置空、却把 '得到大脑' 写进设置文件，
  // 内存与磁盘当场不一致（下一次 /status 报的目录和这次响应里的对不上）。
  if (rel === '') return '得到大脑'
  if (rel.split('/').includes('..')) return '得到大脑'
  return rel
}

/** 设置笔记子目录（会立刻生效，下一次请求就落到新目录）。 */
export function setSubfolder(input) {
  runtime.subfolder = toSubfolder(input)
  return runtime.subfolder
}

/**
 * 已知的「得到大脑归档」候选目录。
 *
 * 在 Obsidian 里候选只有两个：库内的同名子目录，以及库根自己（用户可能早就把
 * 归档铺在库根了）。仍然只是**建议**，不静默切换。
 */
export function knownVaultCandidates() {
  const list = []
  if (runtime.vaultBase !== '') list.push(join(runtime.vaultBase, runtime.subfolder))
  const fromEnv = process.env.DSH_GETNOTE_VAULT
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') list.unshift(fromEnv.trim())
  return list
}

async function readJson(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 原子写：临时文件 + rename（断电不会留半截 JSON）。 */
async function writeJsonAtomic(path, value, mode) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  if (mode) {
    try {
      await chmod(tmp, mode)
    } catch {
      // Windows 上 chmod 只影响只读位，失败不影响功能
    }
  }
  await rename(tmp, path)
}

/**
 * 规范化用户选的主题色。
 *
 * 只接受 `#rgb` / `#rrggbb`，一律回小写 `#rrggbb`；不合法回 null 表示「用默认配色」。
 * 只存一个色相，三层深浅由前端推导——理由见 DSH 版同名函数。
 */
export function normalizeThemeColor(input) {
  if (typeof input !== 'string') return null
  const raw = input.trim().toLowerCase()
  if (raw === '') return null
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(raw)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  return /^#[0-9a-f]{6}$/.test(raw) ? raw : null
}

/** 面板界面语言：只认这三本字典，其他一律当「自动」。 */
export const SUPPORTED_LOCALES = ['zh', 'en', 'nl']

export function normalizeLocale(input) {
  if (typeof input !== 'string') return null
  const raw = input.trim().toLowerCase()
  if (raw === '') return null
  if (raw === 'zh' || raw.startsWith('zh-')) return 'zh'
  if (raw === 'en' || raw.startsWith('en-')) return 'en'
  if (raw === 'nl' || raw.startsWith('nl-')) return 'nl'
  return null
}

/**
 * 版本历史每篇留几版。
 *
 * 上下界和 history.js 的 clampLimit 一致（1～200），但这里多一层意义：设置文件
 * 里存的必须是**整数**，因为面板上是一个数字输入框，用户可能敲进 10.5 或者
 * 空格。不合法就回落到默认的 10 版——那正是这个字段出现之前的行为。
 */
export function normalizeHistoryLimit(input) {
  const n = Number(input)
  if (!Number.isFinite(n)) return HISTORY_LIMIT
  return Math.min(HISTORY_LIMIT_MAX, Math.max(1, Math.floor(n)))
}

/**
 * 读设置。
 *
 * `vaultRoot` 在 Obsidian 里恒等于「库根 + 子目录」，但仍然保留这个字段：
 * 用户在设置里改过子目录时，它是那次修改的落点。
 */
export async function readSettings() {
  const data = await readJson(settingsPath())
  const auto = normalizeAutoSync({
    autoSync: data.autoSync,
    autoSyncMinutes: data.autoSyncMinutes,
    autoSyncIncremental: data.autoSyncIncremental,
    autoSyncForegroundOnly: data.autoSyncForegroundOnly,
  })
  return {
    vaultRoot: typeof data.vaultRoot === 'string' && data.vaultRoot.trim() !== '' ? data.vaultRoot : null,
    lastSyncAt: typeof data.lastSyncAt === 'string' ? data.lastSyncAt : null,
    syncImages: data.syncImages === true,
    autoSync: auto.enabled,
    autoSyncMinutes: auto.intervalMinutes,
    autoSyncIncremental: auto.incremental,
    autoSyncForegroundOnly: auto.foregroundOnly,
    themeColor: normalizeThemeColor(data.themeColor),
    uiLocale: normalizeLocale(data.uiLocale),
    templates: normalizeTemplates(data.templates),
    subfolder: typeof data.subfolder === 'string' && data.subfolder.trim() !== '' ? data.subfolder.trim() : null,
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
    followActive: data.followActive === true,
    // 版本历史每篇留几版。默认 10 版和以前写死的数字一致，老用户升级观感不变；
    // 这个值传进 snapshotNote 与 pruneHistory，两处都走同一份口径。
    historyLimit: normalizeHistoryLimit(data.historyLimit),
  }
}

/** 合并式写入：只覆盖 patch 里出现的字段。 */
export async function updateSettings(patch = {}) {
  const cur = await readSettings()
  const next = {
    ...(patch.vaultRoot !== undefined ? { vaultRoot: patch.vaultRoot } : cur.vaultRoot ? { vaultRoot: cur.vaultRoot } : {}),
    lastSyncAt: patch.lastSyncAt !== undefined ? patch.lastSyncAt : cur.lastSyncAt,
    syncImages: patch.syncImages !== undefined ? patch.syncImages : cur.syncImages,
    autoSync: patch.autoSync !== undefined ? patch.autoSync === true : cur.autoSync,
    autoSyncMinutes: patch.autoSyncMinutes !== undefined ? normalizeAutoSync({ autoSyncMinutes: patch.autoSyncMinutes }).intervalMinutes : cur.autoSyncMinutes,
    autoSyncIncremental: patch.autoSyncIncremental !== undefined ? patch.autoSyncIncremental !== false : cur.autoSyncIncremental,
    autoSyncForegroundOnly: patch.autoSyncForegroundOnly !== undefined ? patch.autoSyncForegroundOnly === true : cur.autoSyncForegroundOnly,
    themeColor: 'themeColor' in patch ? normalizeThemeColor(patch.themeColor) : cur.themeColor,
    uiLocale: 'uiLocale' in patch ? normalizeLocale(patch.uiLocale) : cur.uiLocale,
    templates: 'templates' in patch ? normalizeTemplates(patch.templates) : cur.templates,
    subfolder: patch.subfolder !== undefined ? toSubfolder(patch.subfolder) : cur.subfolder,
    localPort: patch.localPort !== undefined ? patch.localPort : cur.localPort,
    debugLogging: patch.debugLogging !== undefined ? patch.debugLogging === true : cur.debugLogging,
    cardAutoImport: patch.cardAutoImport !== undefined ? patch.cardAutoImport === true : cur.cardAutoImport,
    followActive: patch.followActive !== undefined ? patch.followActive === true : cur.followActive,
    historyLimit: patch.historyLimit !== undefined ? normalizeHistoryLimit(patch.historyLimit) : cur.historyLimit,
  }
  await writeJsonAtomic(settingsPath(), next)
  return readSettings()
}

/** 展开 `~` 前缀（Windows 上只有 ~ 也认）。 */
export function expandHome(input) {
  if (typeof input !== 'string') return input
  const trimmed = input.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return join(homedir(), trimmed.slice(2))
  return trimmed
}

/**
 * 保存笔记子目录。
 *
 * 和 DSH 版的 setVaultRoot 语义一致：不接受库外的目录（这里只接受库内相对路径），
 * 目录不存在就建。返回最终生效的绝对路径。
 */
export async function setVaultRoot(input) {
  const expanded = expandHome(input)
  if (typeof expanded !== 'string' || expanded.trim() === '') {
    throw Object.assign(new Error('目录不能为空'), { status: 400 })
  }
  // 绝对路径但不在库内 → 拒绝（Obsidian 的 adapter 只能操作库内文件）
  //
  // 这里不能只用 node:path 的 isAbsolute：它是**按当前平台**判断的，所以
  // 'D:/别的地方' 在 Windows 上算绝对路径、在 Linux/macOS 上算相对路径，
  // 同一条输入在两个平台会走出完全不同的分支（CI 上就撞到过：Linux 把它当
  // 子目录拼到库根后面，返回 200 而不是 400）。笔记库可能被同步到别的系统，
  // 盘符写法也常常是用户从 Windows 里复制过来的，所以显式认这两种形态：
  //   - 盘符：C:/x、d:\x
  //   - POSIX 根：/x
  if (isAbsolute(expanded) || /^[A-Za-z]:[\\/]/.test(expanded) || /^[\\/]{2}/.test(expanded)) {
    const base = runtime.vaultBase.replace(/\\/g, '/').toLowerCase()
    const normalized = expanded.replace(/\\/g, '/').toLowerCase()
    const inside = base !== '' && (normalized === base || normalized.startsWith(base + '/'))
    if (!inside) {
      throw Object.assign(new Error('只能使用当前库内的目录'), { status: 400 })
    }
  }
  const sub = toSubfolder(expanded)
  runtime.subfolder = sub
  await updateSettings({ subfolder: sub })
  const target = defaultVaultRoot()
  await vfsMkdir(target, { recursive: true })
  return target
}

/**
 * 解析当前生效的笔记根。
 *
 * Obsidian 版不会「换库」：库根由 Obsidian 决定，插件只在库里选一个子目录。
 * 仍然保留 missing 字段（目录被用户删掉时给出提示，而不是悄悄重建）。
 */
export async function resolveVaultRoot(configured) {
  const sub = typeof configured === 'string' && configured.trim() !== '' ? toSubfolder(configured) : runtime.subfolder
  if (sub !== runtime.subfolder) runtime.subfolder = sub
  const root = defaultVaultRoot()
  try {
    const st = await vfsStat(root)
    if (st.isDirectory()) return { root, missing: null }
  } catch {
    return { root, missing: root }
  }
  return { root, missing: null }
}

// ── OAuth 凭证 ───────────────────────────────────────────────────────────────

export async function readAuth() {
  const data = await readJson(authPath())
  if (!data || typeof data !== 'object') return null
  if (typeof data.accessToken !== 'string' || data.accessToken === '') return null
  return {
    accessToken: data.accessToken,
    refreshToken: typeof data.refreshToken === 'string' ? data.refreshToken : null,
    expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : 0,
    clientId: typeof data.clientId === 'string' ? data.clientId : null,
    redirectUri: typeof data.redirectUri === 'string' ? data.redirectUri : null,
    obtainedAt: typeof data.obtainedAt === 'string' ? data.obtainedAt : null,
  }
}

export async function writeAuth(auth) {
  await writeJsonAtomic(authPath(), auth, 0o600)
}

export async function clearAuth() {
  await writeJsonAtomic(authPath(), {}, 0o600)
}

/** 客户端注册信息（client_id / redirect_uri）单独存：掉 token 也不必重新注册。 */
export async function readClient() {
  const data = await readJson(authPath())
  if (typeof data.clientId !== 'string' || data.clientId === '') return null
  return { clientId: data.clientId, redirectUri: typeof data.redirectUri === 'string' ? data.redirectUri : null }
}

// ── Open API 凭证（API Key + Client ID [+ 企业 Grant ID]）────────────────────

export function cloudPath() {
  return join(dshHome(), CLOUD_FILENAME)
}

/**
 * 读云端接入凭证。返回 `{apiKey, clientId, grantId, savedAt}`；没配过返回 null。
 * **这是机密**：路由层只用 maskSecret 之后的形态对外暴露。
 */
export async function readCloud() {
  const data = await readJson(cloudPath())
  const apiKey = typeof data.apiKey === 'string' ? data.apiKey.trim() : ''
  const clientId = typeof data.clientId === 'string' ? data.clientId.trim() : ''
  if (apiKey === '' && clientId === '') return null
  return {
    apiKey,
    clientId,
    grantId: typeof data.grantId === 'string' ? data.grantId.trim() : '',
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : null,
  }
}

/** 写云端凭证（0600）。传空字符串即清除对应字段。 */
export async function writeCloud({ apiKey, clientId, grantId }) {
  const next = {
    apiKey: typeof apiKey === 'string' ? apiKey.trim() : '',
    clientId: typeof clientId === 'string' ? clientId.trim() : '',
    grantId: typeof grantId === 'string' ? grantId.trim() : '',
    savedAt: new Date().toISOString(),
  }
  if (next.apiKey === '' && next.clientId === '') {
    await writeJsonAtomic(cloudPath(), {}, 0o600)
    return null
  }
  await writeJsonAtomic(cloudPath(), next, 0o600)
  return next
}

export async function clearCloud() {
  await writeJsonAtomic(cloudPath(), {}, 0o600)
}

/**
 * 凭证的展示形态：只给能确认身份的部分（前 12 位 + 后 4 位）。
 */
export function maskSecret(value) {
  if (typeof value !== 'string' || value === '') return ''
  if (value.length <= 16) return value.slice(0, 4) + '…'
  return `${value.slice(0, 12)}…${value.slice(-4)}`
}

// ── 同步状态 ─────────────────────────────────────────────────────────────────

export function syncStatePath() {
  return join(dshHome(), SYNC_FILENAME)
}

export async function readSyncState() {
  const data = await readJson(syncStatePath())
  const notes = data && typeof data.notes === 'object' && data.notes !== null ? data.notes : {}
  return {
    notes,
    lastRunAt: typeof data.lastRunAt === 'string' ? data.lastRunAt : null,
    lastCursor: typeof data.lastCursor === 'string' ? data.lastCursor : null,
  }
}

export async function writeSyncState(state) {
  await writeJsonAtomic(syncStatePath(), {
    notes: state && typeof state.notes === 'object' ? state.notes : {},
    lastRunAt: state?.lastRunAt ?? null,
    lastCursor: state?.lastCursor ?? null,
  })
}

// ── 自定义模板 ───────────────────────────────────────────────────────────────

export const MAX_TEMPLATES = 12
const TEMPLATE_NAME_MAX = 24
const TEMPLATE_BODY_MAX = 4000

/** 把任意输入整理成可用的模板列表。坏数据一律丢掉，不抛错。 */
export function normalizeTemplates(input) {
  if (!Array.isArray(input)) return []
  const out = []
  const seen = new Set()
  for (const item of input) {
    if (out.length >= MAX_TEMPLATES) break
    if (item === null || typeof item !== 'object') continue
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, TEMPLATE_NAME_MAX) : ''
    if (name === '') continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const body = typeof item.body === 'string' ? item.body.slice(0, TEMPLATE_BODY_MAX) : ''
    out.push({ name, body })
  }
  return out
}

export function normalizeAutoSync(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {}
  const minutes = Number(cfg.autoSyncMinutes)
  return {
    enabled: cfg.autoSync === true,
    intervalMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(Math.max(Math.round(minutes), 5), 720) : 15,
    incremental: cfg.autoSyncIncremental !== false,
    foregroundOnly: cfg.autoSyncForegroundOnly === true,
  }
}
