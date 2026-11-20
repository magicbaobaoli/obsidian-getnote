#!/usr/bin/env node
/**
 * 上架前自检：把社区目录会拦的硬性条件在本地先过一遍。
 *
 * 为什么要放在仓库里而不是记在文档里：目录的校验规则不写在任何一个地方
 * （官方只给了几条散文式的说明），改 id、改 description 之后很容易忘掉
 * 另一条，等提上去被驳回、再改、再等一轮，一来一回就是一两周。这些规则
 * 都是纯静态检查，本地几毫秒就能跑完，没道理让它去线上试。
 *
 * 用法：
 *   node scripts/check-market.mjs
 *   npm run check:market
 *
 * 只读本地文件，不联网、不写盘，退出码非 0 表示有硬性项没过。
 */
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

async function readJson(rel) {
  return JSON.parse(await readFile(join(ROOT, rel), 'utf8'))
}

// ── manifest 的四条硬性规则 ────────────────────────────────────────────
// 社区目录不接受 id 里带 obsidian（会和宿主自己混），也不接受 name 与
// description 里出现 Obsidian：插件一旦被看成「宿主的一部分」，搜索与
// 归属都会乱。description 还要求以标点收尾——目录页会把描述当一句话排版。
const manifest = await readJson('manifest.json')
const id = String(manifest.id || '')
const name = String(manifest.name || '')
const description = String(manifest.description || '')

check('id 只含小写字母数字与 - _', /^[a-z0-9_-]+$/.test(id), id)
check('id 不含 obsidian', !/obsidian/i.test(id), id)
check('id 不以 plugin 结尾', !/plugin$/i.test(id), id)
check('name 不含 Obsidian', !/obsidian/i.test(name), name)
check('name 不以 Plugin 结尾', !/plugin$/i.test(name), name)
check('name 不以 Obsi 开头、不以 dian 结尾', !/^obsi/i.test(name) && !/dian$/i.test(name), name)
check('description 不含 Obsidian', !/obsidian/i.test(description))
check(
  'description 不以「This plugin」这类空话开头',
  !/^(this (is )?(a )?plugin|this plugin (allows|lets|adds))/i.test(description.trim()),
)
check('description 以标点收尾', /[.?!)]$/.test(description.trim()), `结尾「${description.trim().slice(-1)}」`)
check('description 不超过 250 字符', description.length <= 250, `${description.length} 字符`)
check('author 非空', String(manifest.author || '').trim() !== '', String(manifest.author || ''))

// 版本三处必须一致：manifest 决定「最新版本」，versions.json 决定
// 「宿主版本不够时装哪一版」，package.json 是打包与 CI 的版本来源。
const version = String(manifest.version || '')
const minApp = String(manifest.minAppVersion || '')
const pkg = await readJson('package.json')
const versions = await readJson('versions.json')
check('manifest.version 形如 x.y.z', /^\d+\.\d+\.\d+$/.test(version), version)
check('package.json 与 manifest 版本一致', String(pkg.version) === version, `${pkg.version} vs ${version}`)
check('versions.json 里有这一版且指向当前 minAppVersion', versions[version] === minApp, `${version} → ${versions[version]}`)

// ── 仓库里该有的文件 ──────────────────────────────────────────────────
// LICENSE 是目录审核的硬性要求；main.js / manifest.json / styles.css 是
// Obsidian 装插件时按 tag 从 Release 里抓的三件套。
const required = ['main.js', 'manifest.json', 'styles.css', 'README.md', 'LICENSE']
for (const file of required) {
  let ok = true
  try {
    await readFile(join(ROOT, file))
  } catch {
    ok = false
  }
  check(`仓库根有 ${file}`, ok)
}

// ── 隐私扫描 ──────────────────────────────────────────────────────────
// 这些是历史上真被带进来过的个人信息片段。故意拆成两半再拼起来：
// 检查脚本本身也是公开仓库的一部分，把完整串写进来等于又泄露一次。
const PRIVATE_FRAGMENTS = [
  ['李欣', '颀'],
  ['xin', 'qi'],
  ['嘿', '嘿'],
  ['方睿', '谊'],
  ['1926908101', '354884680'],
  ['1926964245', '166830656'],
  ['GET26DD', '14408'],
]
const needles = PRIVATE_FRAGMENTS.map((parts) => parts.join(''))

// API Key 不能按字面查：`gk_live_xxx`、`gk_live_...`、`gk_live_TESTKEY` 都是
// 文档与测试里的占位符，写死一个完整串反而会把占位符判成泄露。这里只看
// 「像真钥匙的」——前缀后面跟着一长串随机字符。同理 Client ID 与 Grant ID。
const SECRET_PATTERNS = [
  { label: 'API Key', re: /gk_live_(?![.x]|TEST)[A-Za-z0-9_-]{8,}/ },
  { label: 'Client ID', re: /cli_(?![.x]|TEST)[A-Za-z0-9_-]{8,}/ },
  { label: 'Grant ID', re: /grt_(?![.x]|TEST)[A-Za-z0-9_-]{8,}/ },
]

const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.zip', '.ogg', '.mp3'])
// 连还没 git add 的新文件一起扫：只扫已跟踪的话，本地跑一遍全绿、提交上去
// CI 才红（新写的测试文件里正好有一把「像真的」钥匙就是这么漏的）。
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f !== '' && !SKIP_EXT.has(f.slice(f.lastIndexOf('.'))))
const leaks = []
for (const file of files) {
  let text
  try {
    text = await readFile(join(ROOT, file), 'utf8')
  } catch {
    continue
  }
  const lineOf = (at) => text.slice(0, at).split('\n').length
  for (const needle of needles) {
    const at = text.indexOf(needle)
    if (at !== -1) leaks.push(`${file}:${lineOf(at)} 个人片段`)
  }
  for (const { label, re } of SECRET_PATTERNS) {
    const hit = re.exec(text)
    if (hit !== null) leaks.push(`${file}:${lineOf(hit.index)} 像真的${label}`)
  }
}
check('没有个人信息与真凭证留在仓库里', leaks.length === 0, leaks.slice(0, 6).join('；'))

// 插件状态文件里有令牌与云盘凭据，任何一个被提交上去都是事故。
for (const file of ['cloud.json', 'auth.json', 'state.json']) {
  check(`没有提交 ${file}`, !files.includes(file))
}

const failed = results.filter((r) => !r.ok)
console.log('')
console.log(`${results.length - failed.length}/${results.length} 项通过`)
if (failed.length > 0) {
  console.log('没过：')
  for (const item of failed) console.log(`  - ${item.name}${item.detail ? `（${item.detail}）` : ''}`)
  process.exit(1)
}
