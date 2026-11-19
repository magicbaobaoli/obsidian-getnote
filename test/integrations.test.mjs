/**
 * 与 Bases / Canvas 的衔接：只测「生成的文本对不对」，不碰宿主。
 *
 * 这两样都是写文件的活，真正的验收在启动测试里（真跑命令、真看库里的文件）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  basesTemplate,
  emptyCanvas,
  addFileNode,
  parseCanvas,
  serializeCanvas,
} from '../src/core/integrations.js'

test('Bases 模板：限定在笔记目录里，带三个视图', () => {
  const text = basesTemplate({ subfolder: '得到大脑' })
  assert.match(text, /filters:/)
  assert.match(text, /file\.inFolder\("得到大脑"\)/)
  assert.match(text, /name: 全部/)
  assert.match(text, /name: 按标签/)
  assert.match(text, /name: 按日期/)
  // 目录名带斜杠时不能被当成路径分隔符之外的什么奇怪东西
  const nested = basesTemplate({ subfolder: '/李欣颀/知识库/得到大脑归档/' })
  assert.match(nested, /file\.inFolder\("李欣颀\/知识库\/得到大脑归档"\)/)
})

test('画布：空画布是合法 JSON，加节点不改原对象', () => {
  const empty = emptyCanvas()
  assert.deepEqual(empty, { nodes: [], edges: [] })
  assert.equal(JSON.parse(serializeCanvas(empty)).nodes.length, 0)

  const first = addFileNode(empty, { file: '得到大脑/随手记/甲.md', x: 10, y: 20 })
  assert.equal(first.added, true)
  assert.equal(first.canvas.nodes.length, 1)
  assert.equal(first.canvas.nodes[0].file, '得到大脑/随手记/甲.md')
  assert.equal(first.canvas.nodes[0].type, 'file')
  assert.equal(first.canvas.nodes[0].x, 10)
  // 原对象必须没被改：调用方还拿着它做对比
  assert.equal(empty.nodes.length, 0)
})

test('画布：同一篇加两次只留一个节点，路径前导斜杠会被去掉', () => {
  const once = addFileNode(emptyCanvas(), { file: '/得到大脑/甲.md' })
  assert.equal(once.canvas.nodes[0].file, '得到大脑/甲.md')
  const twice = addFileNode(once.canvas, { file: '得到大脑/甲.md' })
  assert.equal(twice.added, false)
  assert.equal(twice.canvas.nodes.length, 1)
  assert.equal(twice.id, once.id)
  assert.throws(() => addFileNode(emptyCanvas(), { file: '' }), /文件路径/)
})

test('画布：坏掉的 JSON 当成空画布，不抛错', () => {
  assert.deepEqual(parseCanvas('not json'), { nodes: [], edges: [] })
  assert.deepEqual(parseCanvas(''), { nodes: [], edges: [] })
  assert.deepEqual(parseCanvas('null'), { nodes: [], edges: [] })
  const good = parseCanvas(JSON.stringify({ nodes: [{ id: 'a', type: 'file', file: 'x.md' }] }))
  assert.equal(good.nodes.length, 1)
  assert.deepEqual(good.edges, [])
})
