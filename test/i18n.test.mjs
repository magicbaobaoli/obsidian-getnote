/*
 * i18n.test.mjs —— 三本字典必须对得上
 *
 * 面板的文案是手写的三块对象（zh / en / nl）。少一个键不会报错，
 * t() 会安静地落回中文，于是英文界面里冒出一句中文，没人会发现——
 * 这种漏翻攒了好几个版本才被看见。这里把三块钉死：
 * 键集合严格相等、值都是非空字符串、同一个键的占位符一致。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

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

test('中英荷三本字典的键必须一模一样，少一个就是漏翻', () => {
  const keys = {}
  for (const lang of LANGS) {
    assert.ok(LEX[lang], '缺了 ' + lang + ' 这本字典')
    keys[lang] = Object.keys(LEX[lang])
  }
  const zh = new Set(keys.zh)
  for (const lang of LANGS) {
    const here = new Set(keys[lang])
    const missing = [...zh].filter((key) => !here.has(key))
    const extra = [...here].filter((key) => !zh.has(key))
    assert.deepEqual(missing, [], lang + ' 少了这些键：' + missing.join(', '))
    assert.deepEqual(extra, [], lang + ' 多了这些中文里没有的键：' + extra.join(', '))
  }
  // 顺手钉一个下限：整个字典被误删成空对象时上面全过，这里不干
  assert.ok(keys.zh.length > 600, '中文键数不该掉到 600 以下，实际 ' + keys.zh.length)
})

test('每条文案都是非空字符串，不能是 undefined 也不能是 [object Object]', () => {
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(LEX[lang])) {
      assert.equal(typeof value, 'string', lang + ' 的 ' + key + ' 不是字符串：' + typeof value)
      assert.ok(value.trim() !== '', lang + ' 的 ' + key + ' 是空的')
      assert.ok(!value.includes('undefined'), lang + ' 的 ' + key + ' 里写了 undefined：' + value)
      assert.ok(!value.includes('[object Object]'), lang + ' 的 ' + key + ' 里是 [object Object]：' + value)
    }
  }
})

test('同一个键在三语里的占位符必须一致，否则 t() 会漏填', () => {
  const zhKeys = Object.keys(LEX.zh)
  for (const key of zhKeys) {
    const expected = placeholdersOf(LEX.zh[key])
    for (const lang of ['en', 'nl']) {
      const value = LEX[lang][key]
      if (typeof value !== 'string') continue
      assert.deepEqual(
        placeholdersOf(value),
        expected,
        lang + ' 的 ' + key + ' 占位符和中文对不上：' + value,
      )
    }
  }
})

test('英文与荷兰语的标题里不该还留着中文', () => {
  const cjk = /[\u3400-\u9fff]/
  assert.ok(cjk.test(LEX.zh['panel.title']), '中文标题本来就该是中文')
  for (const lang of ['en', 'nl']) {
    assert.ok(
      !cjk.test(LEX[lang]['panel.title']),
      lang + ' 的标题里还有中文：' + LEX[lang]['panel.title'],
    )
  }
})
