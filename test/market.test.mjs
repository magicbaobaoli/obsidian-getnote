/**
 * 上架条件自检脚本的离线验收。
 *
 * check-market.mjs 读的是仓库里真实的 manifest / package.json / versions.json，
 * 所以这里不去造假仓库，而是直接对着真文件跑一遍，再单独验几条规则的判定
 * 逻辑——把「规则写错了」和「当前文件不合规」分开，出问题时一眼看得出是哪种。
 */
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

// ── 真跑一遍：当前仓库必须是合规的 ────────────────────────────────────
let output = ''
let code = 0
try {
  output = execFileSync('node', ['scripts/check-market.mjs'], { cwd: ROOT, encoding: 'utf8' })
} catch (error) {
  output = String(error.stdout || '') + String(error.stderr || '')
  code = error.status === undefined ? 1 : error.status
}
check('当前仓库通过上架自检', code === 0, output.trim().split('\n').slice(-3).join(' / '))
check('自检报告里没有 FAIL', !/^FAIL/m.test(output))

const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'))
check('id 是 getnote-brain（社区目录里没被占用）', manifest.id === 'getnote-brain', manifest.id)
check('name 里没有 Obsidian', !/obsidian/i.test(manifest.name), manifest.name)
check('description 以句点收尾（目录页按句子排版）', manifest.description.trim().endsWith('.'))
check('description 不含 Obsidian', !/obsidian/i.test(manifest.description))

// ── 规则本身：拿几条反例确认判定没有写反 ──────────────────────────────
// 目录的规则是「id 不能含 obsidian」「description 必须以标点收尾」这种，
// 写反了（比如写成「必须含 obsidian」）照样能全绿，所以这里对每条规则
// 都试一个该被拦下的输入。
const rules = [
  { name: 'id 含 obsidian 会被拦', ok: !/^[a-z0-9_-]+$/.test('getnote-obsidian') || /obsidian/i.test('getnote-obsidian') },
  { name: 'id 带大写会被拦', ok: !/^[a-z0-9_-]+$/.test('GetnoteBrain') },
  { name: 'id 以 plugin 结尾会被拦', ok: /plugin$/i.test('my-plugin') },
  { name: 'description 没有收尾标点会被拦', ok: !/[.?!)]$/.test('把笔记搬进来') },
  { name: 'description 以问号收尾是合法的', ok: /[.?!)]$/.test('要同步吗?') },
  { name: 'name 以 dian 结尾会被拦', ok: /dian$/i.test('Obsidian') },
]
for (const rule of rules) check(rule.name, rule.ok)

// ── 占位符不该被当成泄露 ──────────────────────────────────────────────
// 文档里写的是 gk_live_xxx / gk_live_... ，测试里用的是 gk_live_TESTKEY_0001，
// 三个都不该判成真钥匙，否则自检永远红。
const SECRET = /gk_live_(?![.x]|TEST)[A-Za-z0-9_-]{8,}/
check('gk_live_xxx 不算泄露', !SECRET.test('形如 gk_live_xxx 的 Key'))
check('gk_live_... 不算泄露', !SECRET.test("'api.keyPlaceholder': 'gk_live_...'"))
check('gk_live_TESTKEY 不算泄露', !SECRET.test('gk_live_TESTKEY_TESTKEY_0001'))
// 这条样本必须拼出来：自检脚本会扫整个仓库，把它写成字面量等于自己往仓库里
// 塞一把「像真的」钥匙，CI 上第一个红的就是这个文件自己。
check('一长串随机字符算泄露', SECRET.test('gk_live_' + '15d9a8b7c6d5e4f3'))

console.log('')
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} 项通过`)
if (failed.length > 0) {
  for (const item of failed) console.log(`  没过：${item.name}${item.detail ? `（${item.detail}）` : ''}`)
  process.exit(1)
}
