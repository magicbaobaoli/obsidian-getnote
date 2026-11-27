/*
 * errors.test.mjs —— core 层错误的 code 与三语文案必须对得上
 *
 * vault.js / service.js 里原来散着一百多条中文错误串，面板只能拿 message，
 * 英文 / 荷兰文界面里照样冒中文。现在每条错误带 code（→ lexKey）与 params，
 * 面板按 lexKey 去 LEX 取译文。这里钉三件事：
 *
 *   1. core 层每个 code 在三本字典里都有对应的 'err.*' 键，反过来也不能多；
 *   2. 字典里的占位符与 ERROR_TEMPLATES 里的完全一致，否则 t() 会漏填；
 *   3. coreError / fillErrorTemplate 的行为（status 透传、params 只挂非空的）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ERROR_TEMPLATES, coreError, fillErrorTemplate } from '../src/core/errors.js'
const { LEX } = await import('../src/view/panel.js')

const LANGS = ['zh', 'en', 'nl']

/** 抽出一段文案里的 {name} 占位符，返回排好序的数组方便比较。 */
function placeholdersOf(text) {
  const found = new Set()
  const re = /\{([A-Za-z0-9_]+)\}/g
  let hit
  while ((hit = re.exec(text)) !== null) found.add(hit[1])
  return [...found].sort()
}

test('core 层每个错误 code 在三本字典里都有译文，字典里也不许多出没有来源的 err.*', () => {
  const codes = Object.keys(ERROR_TEMPLATES)
  assert.ok(codes.length > 70, '错误 code 数不该掉到 70 以下，实际 ' + codes.length)
  for (const lang of LANGS) {
    const dict = LEX[lang]
    const missing = codes.filter((code) => typeof dict['err.' + code] !== 'string')
    assert.deepEqual(missing, [], lang + ' 少了这些错误的译文：' + missing.join(', '))
    const errKeys = Object.keys(dict).filter((key) => key.startsWith('err.'))
    const extra = errKeys.filter((key) => !Object.prototype.hasOwnProperty.call(ERROR_TEMPLATES, key.slice(4)))
    assert.deepEqual(extra, [], lang + ' 多了这些没有对应 code 的 err.* 键：' + extra.join(', '))
    assert.equal(errKeys.length, codes.length, lang + ' 的 err.* 键数与 code 数不一致')
  }
})

test('每条错误译文的占位符要和中文模板一致，否则面板填不进去', () => {
  for (const [code, template] of Object.entries(ERROR_TEMPLATES)) {
    const expected = placeholdersOf(template)
    for (const lang of LANGS) {
      assert.deepEqual(
        placeholdersOf(LEX[lang]['err.' + code]),
        expected,
        lang + ' 的 err.' + code + ' 占位符和模板对不上',
      )
    }
  }
})

test('coreError 挂上 code / lexKey / params，status 等附加字段照旧透传', () => {
  const err = coreError('vault.dirNotEmptyNotes', { notes: 3 }, { status: 409, extra: 'x' })
  assert.ok(err instanceof Error)
  assert.equal(err.code, 'vault.dirNotEmptyNotes')
  assert.equal(err.lexKey, 'err.vault.dirNotEmptyNotes')
  assert.deepEqual(err.params, { notes: 3 })
  assert.equal(err.status, 409)
  assert.equal(err.extra, 'x')
  // message 仍是中文兜底，日志与老代码读 message 都不受影响
  assert.equal(err.message, '这个目录里还有 3 篇笔记，先把它们移走再删目录')
})

test('coreError 没传 params 时不留空 params，也没有占位符残留', () => {
  const err = coreError('vault.notAFile', {}, { status: 400 })
  assert.equal(err.message, '不是文件')
  assert.equal(Object.prototype.hasOwnProperty.call(err, 'params'), false)
  const withPath = coreError('service.vaultMissing', { path: '/x/y' })
  assert.equal(withPath.message, '本地库目录不存在：/x/y')
  assert.equal(withPath.status, undefined)
})

test('fillErrorTemplate 替换已知占位符，缺值原样留着便于发现漏传', () => {
  assert.equal(fillErrorTemplate('还有 {notes} 篇', { notes: 2 }), '还有 2 篇')
  assert.equal(fillErrorTemplate('还有 {notes} 篇', {}), '还有 {notes} 篇')
  assert.equal(fillErrorTemplate('还有 {notes} 篇', { notes: null }), '还有 {notes} 篇')
  assert.equal(fillErrorTemplate('没有占位符', { notes: 2 }), '没有占位符')
  assert.equal(fillErrorTemplate(null, {}), '')
})
