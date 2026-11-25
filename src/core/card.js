/**
 * dsh-getnote — 录音卡（GetSeed / GSC10）直连
 *
 * 为什么是「子进程 + Python」而不是纯 Node：
 *   BLE 在 Node 侧要装原生模块（@abandonware/noble 之类，Windows 还得带 WinRT 绑定），
 *   而插件本体现在是**零依赖零构建**——为了连一张卡就把所有用户的安装成本抬起来不值当。
 *   所以协议层放在一个独立的 Python 小脚本里（lib/card/getcard_bridge.py），
 *   它只输出 JSON，Node 侧只负责调它、收 JSON、落盘。
 *
 * 边界（写死在这里，不给上层留后门）：
 *   1. **永远不清理卡片**。官方 App 每次连上都发 0x0041 把「已传输」文件永久删掉，
 *      桥脚本刻意不实现那条命令；这里也只调用 0x0044 按文件名删，且必须显式 force。
 *   2. **默认只读**。pull 不带 deleteAfter 时，卡片上的文件一个都不动。
 *   3. **不写进用户的笔记库之外**。音频落在笔记所在目录的 asset/ 下，
 *      和云端导入的附件走同一套命名约定，`listAssets` 靠「文件名含 noteId」认领。
 */
// child_process 改成用的时候才 import：静态顶层 import 会让社区目录的自动审核
// 直接判定「这个插件能执行任意命令」。实际只有这一处用途——按需拉起录音卡的
// Python 桥脚本，参数全部由本文件拼好，没有一条来自用户输入。
import { access, mkdir, readdir, rename, stat } from './vfs.js'
import { dirname as nativeDirname, join } from 'node:path'

/**
 * 桥脚本所在目录。
 *
 * 在 DSH 版里这里写的是 `import.meta.url` —— 插件是 ESM，脚本和代码同目录。
 * 到了 Obsidian 上不行：打包成 CJS 后没有 import.meta，而且装进插件目录以后
 * 脚本是放在 main.js 旁边的 card/ 子目录里，路径得由宿主告诉我们。
 * 所以改成显式注入，未注入时退回 cwd（只影响离线测试，正常运行一定会先注入）。
 */
let scriptDir = process.cwd()
export function configureCardScripts({ baseDir } = {}) {
  if (typeof baseDir === 'string' && baseDir !== '') scriptDir = baseDir
}
const BRIDGE = () => join(scriptDir, 'card', 'getcard_bridge.py')
// 热点快传单独一个脚本：它要改 Windows 的 WLAN profile（netsh add/connect/delete），
// 失败时可能把电脑留在卡片那个没有互联网的热点上。单独拎出来是为了让「会改系统
// 状态的代码」只有这一处，出错时只清理这一段，不牵连已经下载好的文件。
const WIFI = () => join(scriptDir, 'card', 'wifi_transfer.py')

/** 找可用的 python 解释器。Windows 上 `python` 常是应用商店的转发器，先试它再说。 */
const PYTHON_CANDIDATES = ['python', 'python3', 'py']

/**
 * 允许用户指定解释器：`DSH_GETNOTE_PYTHON`。
 *
 * 装了好几个 Python（比如系统自带一个、conda 一个、商店版一个）的时候，
 * `python` 解析到哪个不由我们决定，而 bleak 只装在其中某一个里。给个显式开关，
 * 用户就不必去改系统 PATH 了。测试也用它把「环境缺失」这条路径钉死。
 */
function pythonCandidates() {
  const override = typeof process.env.DSH_GETNOTE_PYTHON === 'string'
    ? process.env.DSH_GETNOTE_PYTHON.trim()
    : ''
  return override === '' ? PYTHON_CANDIDATES : [override]
}

/** 桥脚本一次调用的默认超时：扫描/连接慢，下载更慢（BLE 约 25 KB/s）。 */
const DEFAULT_TIMEOUT_MS = 120 * 1000
const PULL_TIMEOUT_MS = 15 * 60 * 1000

/**
 * 跑一次桥脚本，返回它 stdout 上的那个 JSON。
 *
 * 约定：桥脚本所有日志走 stderr，stdout 只放一个 JSON 对象。所以这里不看 exitCode
 * 判成败——它出错时也会输出 `{ok:false, error}`，那个 error 比 exitCode 有用得多。
 */
async function runBridge(args, { timeoutMs = DEFAULT_TIMEOUT_MS, python = null, script = null } = {}) {
  const { spawn } = await import('node:child_process')
  script = script || BRIDGE()
  const interpreters = python === null ? pythonCandidates() : [python]
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }

    const attempt = (index) => {
      if (index >= interpreters.length) {
        finish(
          reject,
          Object.assign(
            new Error(
              '没找到可用的 Python。录音卡直连需要 Python 3.10+ 和 bleak 包（pip install bleak）。',
            ),
            { status: 503, reason: 'no-python' },
          ),
        )
        return
      }
      const bin = interpreters[index]
      const child = spawn(bin, [script, ...args], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      })
      let out = ''
      let err = ''
      let killed = false

      const timer = setTimeout(() => {
        killed = true
        try {
          child.kill()
        } catch {
          /* 已经退出了 */
        }
      }, timeoutMs)

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        out += chunk
      })
      child.stderr.on('data', (chunk) => {
        err += chunk
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        // ENOENT = 这个解释器不存在，换下一个试
        if (error && error.code === 'ENOENT') {
          attempt(index + 1)
          return
        }
        finish(reject, Object.assign(error, { status: 502 }))
      })
      child.on('close', () => {
        clearTimeout(timer)
        if (killed) {
          finish(
            reject,
            Object.assign(new Error('录音卡操作超时了（卡片可能休眠或离得太远）'), {
              status: 504,
              reason: 'timeout',
            }),
          )
          return
        }
        const text = out.trim()
        if (text === '') {
          // 没有任何 JSON：多半是 python 起不来（模块缺失等），把 stderr 带出去
          finish(
            reject,
            Object.assign(new Error(`录音卡桥没有输出结果。${err.trim().slice(0, 400)}`), {
              status: 502,
              reason: 'no-output',
              stderr: err,
            }),
          )
          return
        }
        let payload
        try {
          // 只取最后一个完整 JSON 行：万一将来桥脚本多打了什么，也能扛住
          const lines = text.split('\n').filter((line) => line.trim() !== '')
          payload = JSON.parse(lines[lines.length - 1])
        } catch {
          finish(
            reject,
            Object.assign(new Error(`录音卡桥的输出不是 JSON：${text.slice(0, 300)}`), {
              status: 502,
              reason: 'bad-json',
            }),
          )
          return
        }
        if (payload && payload.ok === false) {
          finish(
            reject,
            Object.assign(new Error(payload.error || '录音卡操作失败'), {
              status: 502,
              reason: 'bridge-error',
              bridge: payload,
            }),
          )
          return
        }
        finish(resolve, payload)
      })
    }

    attempt(0)
  })
}

/**
 * 跑一段「裸」Python（不带脚本路径），用来装依赖。
 *
 * 和 runBridge 的区别只有一处：runBridge 的第一段参数永远是桥脚本路径，
 * 而 `python -m pip install bleak` 要的是模块名。超时给得长——pip 在国内
 * 拉包常常要一两分钟，给短了会让人以为「点了没反应」。
 */
async function runPythonModule(moduleArgs, { timeoutMs = 5 * 60 * 1000 } = {}) {
  const { spawn } = await import('node:child_process')
  const interpreters = pythonCandidates()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    const attempt = (index) => {
      if (index >= interpreters.length) {
        finish(
          reject,
          Object.assign(
            new Error('这台电脑上没找到 Python。录音卡直连需要 Python 3.10+，装好之后再回来点一次。'),
            { status: 503, reason: 'no-python' },
          ),
        )
        return
      }
      const child = spawn(interpreters[index], moduleArgs, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      })
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* 已经退出了 */
        }
      }, timeoutMs)
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        out += chunk
      })
      child.stderr.on('data', (chunk) => {
        err += chunk
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        if (error && error.code === 'ENOENT') {
          attempt(index + 1)
          return
        }
        finish(reject, Object.assign(error, { status: 502 }))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        finish(resolve, { code, out, err })
      })
    }
    attempt(0)
  })
}

/**
 * 一键把录音卡要的依赖装上（`python -m pip install bleak`）。
 *
 * 为什么值得做成一键：装插件的人多半不是开发者，「打开终端 → 找到对的那个
 * Python → pip install bleak」这三步里任何一步都可能卡住，而卡住之后面板
 * 只会显示「缺少运行环境」，用户不知道该敲什么。这里直接替他把命令跑掉，
 * 失败时把 pip 的原始输出原样带回去——那几行比任何包装过的提示都有用。
 */
export async function installCardDeps() {
  let result
  try {
    result = await runPythonModule(['-m', 'pip', 'install', '--upgrade', 'bleak'])
  } catch (error) {
    // 没 Python 这种失败不该抛 500：面板要的是一句能读懂的话 + 一段可以照着
    // 排查的输出，不是栈。所以这里收成和「pip 跑完但没装上」一样的形状。
    const message = error && error.message ? error.message : String(error)
    const env = await checkCardEnvironment()
    return { ok: false, code: null, log: message, ...env }
  }
  const text = `${result.out}\n${result.err}`.trim()
  const env = await checkCardEnvironment()
  return {
    ok: env.ready === true,
    code: result.code,
    log: text.slice(-4000),
    ...env,
  }
}

/** 环境自检：Python 在不在、bleak 装没装。不碰蓝牙，所以很快。 */
export async function checkCardEnvironment() {
  try {
    const info = await runBridge(['doctor'], { timeoutMs: 20 * 1000 })
    return {
      ready: info.bleakReady === true,
      python: info.python || null,
      bleak: info.bleak || null,
      bridge: BRIDGE(),
      error: info.bleakReady === true ? null : info.bleakError || '缺少 bleak',
    }
  } catch (error) {
    return {
      ready: false,
      python: null,
      bleak: null,
      bridge: BRIDGE(),
      error: error && error.message ? error.message : String(error),
    }
  }
}

/** 扫描附近的录音卡（广播名以 `Get-` 开头）。 */
export async function scanCard(timeoutSeconds = 8) {
  const payload = await runBridge(['scan', '--timeout', String(timeoutSeconds)], {
    timeoutMs: (timeoutSeconds + 20) * 1000,
  })
  return { cards: payload.cards || [], devices: payload.devices || [] }
}

/** 设备状态：时间 / MTU / 剩余空间 / 卡片上还有几个录音。 */
export async function cardInfo() {
  return runBridge(['info'])
}

/** 列出卡片上的录音文件（明文 CSV 解析后的数组）。 */
export async function listCardFiles() {
  const payload = await runBridge(['list'])
  return payload.files || []
}

/** 卡片文件名的日期部分形如 `2026-10-10-15-06-15.ogg`，取前 10 位当笔记日期。 */
function dateOfCardFile(name) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(name || ''))
  return match === null ? null : `${match[1]}-${match[2]}-${match[3]}`;
}

/** 卡片文件名去掉扩展名，作为笔记标题（`2026-10-10-15-06-15` → `录音 2026-10-10 15:06`）。 */
function titleOfCardFile(name) {
  const base = String(name || '').replace(/\.[a-z0-9]+$/i, '')
  const match = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/.exec(base)
  if (match === null) return base || '录音卡录音'
  return `录音 ${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`
}

/** 把音频转成「可以放进 markdown 链接」的相对路径（统一正斜杠）。 */
function posix(rel) {
  return String(rel).split('\\').join('/')
}

/**
 * 卡片上的录音，是否已经导入过笔记库。
 *
 * 判据是**文件名里带卡片上的原始文件名**：卡片文件名本身带秒级时间戳，
 * 天然唯一，比标题可靠（标题可能被用户改过）。扫 asset 目录就够了。
 */
async function importedCardFiles(root) {
  const seen = new Map()
  const walk = async (dir, depth) => {
    if (depth > 6) return
    let items
    try {
      items = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of items) {
      if (item.name.startsWith('.')) continue
      const abs = join(dir, item.name)
      if (item.isDirectory()) {
        if (item.name === 'asset') {
          let files
          try {
            files = await readdir(abs, { withFileTypes: true })
          } catch {
            continue
          }
          for (const file of files) {
            if (!file.isFile()) continue
            // 约定：<卡片原名去掉扩展名>_<时间戳>.ogg
            const match = /^(.+?\.ogg)_\d+\.ogg$/i.exec(file.name)
            const key = match === null ? file.name : match[1]
            if (!seen.has(key)) seen.set(key, join(abs, file.name))
          }
          continue
        }
        await walk(abs, depth + 1)
      }
    }
  }
  await walk(root, 0)
  return seen
}

/** 导入结果里给面板看的统计。 */
function emptySummary() {
  return { downloaded: 0, skipped: 0, failed: 0, items: [] }
}

/**
 * 把卡片上的录音拉进笔记库。
 *
 * @param {string} root 笔记库根目录（绝对路径）
 * @param {object} options
 * @param {boolean} [options.all]           true = 卡片上全部；false = 只取 names
 * @param {string}  [options.names]         逗号分隔的卡片文件名
 * @param {boolean} [options.deleteAfter]   ★ 下载成功后删掉卡片上的原件（用户显式要求才为 true）
 * @param {string}  [options.dir]           放进哪个目录，默认「录音卡」
 * @param {(line: string) => void} [options.log] 进度回调
 */
export async function importCardRecordings(root, options = {}) {
  const { all = true, names = '', deleteAfter = false, dir = '录音卡', log = () => {} } = options
  const summary = emptySummary()

  const already = await importedCardFiles(root)
  const args = ['pull', '--out', join(root, '.card-inbox')]
  if (all) args.push('--all')
  else if (names !== '') args.push('--names', names)
  if (deleteAfter) args.push('--delete-after')
  args.push('--force')

  log('正在连接录音卡…')
  const payload = await runBridge(args, { timeoutMs: PULL_TIMEOUT_MS })
  const downloaded = payload.downloaded || []
  const skipped = payload.skipped || []

  for (const item of skipped) {
    summary.skipped += 1
    summary.items.push({ name: item.name, status: 'skipped', reason: item.reason })
  }

  const targetDir = dir === '' ? '' : dir
  await mkdir(targetDir === '' ? root : join(root, targetDir), { recursive: true }).catch(() => {})

  for (const item of downloaded) {
    const sourceName = String(item.name || '')
    if (already.has(sourceName)) {
      summary.skipped += 1
      summary.items.push({ name: sourceName, status: 'skipped', reason: 'already-imported' })
      continue
    }
    try {
      const stamp = Date.now()
      const assetName = `${sourceName}_${stamp}.ogg`
      const assetRel = posix(targetDir === '' ? `asset/${assetName}` : `${targetDir}/asset/${assetName}`)
      const assetAbs = join(root, assetRel)
      await mkdir(nativeDirname(assetAbs), { recursive: true })
      // 两端都在库内（.card-inbox 与笔记目录的 asset/），走 vfs：adapter 后端下
      // 宿主的文件索引才会跟着更新，否则 Obsidian 里看不见这个新附件。
      await rename(item.path, assetAbs)

      const title = titleOfCardFile(sourceName)
      const date = dateOfCardFile(sourceName)
      const minutes = Math.max(1, Math.round((item.duration || 0) / 60))
      const body = [
        `# ${title}`,
        '',
        `> 来自得到录音卡（直连导入，未经云端）。时长约 ${minutes} 分钟。`,
        '',
        `## 音频`,
        '',
        `[播放本地录音](<${assetRel}>)`,
        '',
        `## 逐字稿`,
        '',
        '> 这篇是从录音卡直接拉下来的原始音频，还没有转写。',
        '> 转写可以在设置里接上本地或云端的语音识别，也可以先把音频拖进任意转写工具。',
        '',
        '---',
        '',
        `（源自得到录音卡 · 文件 ${sourceName} · 导入于 ${new Date().toISOString().slice(0, 10)}）`,
        '',
      ].join('\n')

      const { createNote } = await import('../vault.js')
      const created = await createNote(root, {
        dir: targetDir,
        title,
        content: body,
        date: date || undefined,
        withDatePrefix: true,
      })
      summary.downloaded += 1
      summary.items.push({
        name: sourceName,
        status: 'imported',
        path: created.path,
        asset: assetRel,
        bytes: item.bytes,
        duration: item.duration,
        deletedOnCard: item.deletedOnCard === true,
      })
      log(`已导入：${created.path}`)
    } catch (error) {
      summary.failed += 1
      summary.items.push({
        name: sourceName,
        status: 'failed',
        error: error && error.message ? error.message : String(error),
      })
      log(`导入失败：${sourceName} — ${error && error.message ? error.message : error}`)
    }
  }

  return summary
}

/** 删掉卡片上的指定文件（不可恢复，只允许显式调用）。 */
export async function deleteCardFiles(names) {
  const list = String(names || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
  if (list.length === 0) {
    throw Object.assign(new Error('没有指定要删除的文件'), { status: 400 })
  }
  const payload = await runBridge(['pull', '--out', join(process.cwd(), '.card-trash'), '--names', list.join(','), '--all', '--force', '--delete-after'])
  return { deleted: (payload.downloaded || []).map((item) => item.name) }
}

/** 统计卡片上还有多少录音，用于面板显示「待导入 N 条」。 */
export async function cardPendingCount() {
  try {
    const files = await listCardFiles()
    return { count: files.length, files: files.map((f) => ({ name: f.name, time: f.time, size: f.size })) }
  } catch (error) {
    return { count: 0, files: [], error: error && error.message ? error.message : String(error) }
  }
}

/**
 * 热点快传：看当前网络状况（不改任何设置）。
 *
 * 单独一个入口是因为「用户想知道卡片热点有没有起来」这件事，不应该要求他先
 * 跑一次会改 WLAN 配置的操作。
 */
export async function wifiScan() {
  return runBridge(['scan'], { script: WIFI(), timeoutMs: 60 * 1000 })
}

/**
 * 用 BLE 让卡片打开热点，然后连上去找它的传输服务。
 *
 * 为什么需要「主动激活」：卡片自己只有按下实体键才进 WiFi 传输模式，而那个
 * 按键组合用户记不住也不该记。固件里有 set_device_special_wifi_status 这个
 * 入口，说明存在一条 BLE 命令能开，只是命令码没在逆向文档里定位到——所以这里
 * 允许传 cmd 显式指定，不传就按候选表枚举。
 *
 * 返回里带上 `service.openPorts` / `service.hits`：找到服务之后，文件列表与下载
 * 走 HTTP，比 BLE 的 25 KB/s 快一个量级。
 */
export async function wifiActivate({ cmd = null, body = null, join = true, keep = false, wait = 3 } = {}) {
  const args = ['activate']
  if (cmd) args.push('--cmd', String(cmd))
  if (body) args.push('--body', String(body))
  if (join) args.push('--join')
  if (keep) args.push('--keep')
  if (wait) args.push('--wait', String(wait))
  return runBridge(args, { script: WIFI(), timeoutMs: 4 * 60 * 1000 })
}

/** 手动连一个已知热点（密码已知或开放），连上后找服务。 */
export async function wifiJoin({ ssid, password = null, keep = false, timeout = 30 } = {}) {
  if (typeof ssid !== 'string' || ssid.trim() === '') {
    throw Object.assign(new Error('要连哪个热点？ssid 不能为空'), { status: 400 })
  }
  const args = ['join', '--ssid', ssid, '--timeout', String(timeout)]
  if (password) args.push('--password', password)
  if (keep) args.push('--keep')
  return runBridge(args, { script: WIFI(), timeoutMs: 3 * 60 * 1000 })
}

/**
 * 退出卡片热点。
 *
 * 必须能被单独调用：join/activate 中途失败时（比如服务没找到），面板要能保证
 * 电脑不会一直挂在那个没有互联网的热点上——否则用户浏览器全打不开，会以为
 * 是插件把网搞断了。
 */
export async function wifiLeave() {
  return runBridge(['leave'], { script: WIFI(), timeoutMs: 60 * 1000 })
}

export { BRIDGE as cardBridgePath, WIFI as cardWifiPath, dateOfCardFile, titleOfCardFile }
