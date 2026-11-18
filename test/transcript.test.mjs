/*
 * transcript.test.mjs —— 逐字稿与音频的联动验收
 *
 * 两件事：时间戳能不能解析成秒、点一下能不能让播放器跳过去。
 * 都跑在 jsdom 里：jsdom 的 HTMLMediaElement 没有真解码能力，但 currentTime
 * 是可写的（play() 会打一条 not implemented，我们的代码已经接住了返回 undefined）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'app://obsidian.md/',
  pretendToBeVisual: true,
})

const g = globalThis
g.window = dom.window
g.document = dom.window.document
g.HTMLElement = dom.window.HTMLElement
g.Node = dom.window.Node
g.Event = dom.window.Event
g.MouseEvent = dom.window.MouseEvent
g.KeyboardEvent = dom.window.KeyboardEvent
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
g.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0)
g.cancelAnimationFrame = (id) => clearTimeout(id)
g.IS_REACT_ACT_ENVIRONMENT = false

const React = await import('preact/compat')
const { createRoot } = await import('preact/compat/client')
const panel = await import('../src/view/panel.js')
const { parseTranscript, stampToSeconds, activeTranscriptIndex, TranscriptBlock, AudioPlayer } = panel.__internals

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function mount(element) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(element)
  await sleep(60)
  return { host, root }
}

const SCRIPT = ['说话人A [00:03] 我们先从这个问题开始。', '说话人B [01:05] 好的。', '[01:20] 补充一句。'].join('\n')

test('逐字稿解析：说话人、时间戳、正文拆开，续行并回上一段', () => {
  const entries = parseTranscript(SCRIPT + '\n这一行没有时间戳，应该并到上一段。')
  assert.equal(entries.length, 3)
  assert.deepEqual(entries[0], { speaker: '说话人A', stamp: '00:03', body: '我们先从这个问题开始。' })
  assert.equal(entries[2].speaker, '')
  assert.ok(entries[2].body.includes('补充一句'))
  assert.ok(entries[2].body.includes('这一行没有时间戳'), '续行要并进上一段，实际 ' + entries[2].body)
})

test('时间戳换算成秒，认不出的返回 null', () => {
  assert.equal(stampToSeconds('00:03'), 3)
  assert.equal(stampToSeconds('01:05'), 65)
  assert.equal(stampToSeconds('1:02:03'), 3723)
  assert.equal(stampToSeconds(''), null)
  assert.equal(stampToSeconds('乱写'), null)
})

test('播放到哪一秒就落在哪一段上', () => {
  const entries = parseTranscript(SCRIPT)
  assert.equal(activeTranscriptIndex(entries, 0), -1, '还没开始播时不该高亮任何一段')
  assert.equal(activeTranscriptIndex(entries, 5), 0)
  assert.equal(activeTranscriptIndex(entries, 65), 1)
  assert.equal(activeTranscriptIndex(entries, 999), 2)
})

test('点时间戳把秒数交给上层', async () => {
  const seeks = []
  const { host, root } = await mount(
    React.createElement(TranscriptBlock, { text: SCRIPT, onSeek: (seconds) => seeks.push(seconds) }),
  )
  const buttons = host.querySelectorAll('.dshgn_tsBtn')
  assert.equal(buttons.length, 3, '三个时间戳都该是可点的按钮')
  buttons[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  assert.deepEqual(seeks, [65])
  root.unmount()
  host.remove()
})

test('正在播的那一段被标出来，换一段跟着换', async () => {
  const first = await mount(React.createElement(TranscriptBlock, { text: SCRIPT, activeSeconds: 5 }))
  assert.equal(first.host.querySelectorAll('p.dshgn_tpOn').length, 1)
  assert.ok(first.host.querySelectorAll('p')[0].className.includes('dshgn_tpOn'))
  assert.ok(first.host.querySelectorAll('.dshgn_ts')[0].className.includes('dshgn_tsOn'))
  first.root.unmount()
  first.host.remove()

  const second = await mount(React.createElement(TranscriptBlock, { text: SCRIPT, activeSeconds: 70 }))
  assert.ok(second.host.querySelectorAll('p')[1].className.includes('dshgn_tpOn'))
  second.root.unmount()
  second.host.remove()
})

test('给播放器一个跳转请求，它就跳到那一秒', async () => {
  const track = { url: '/getnote/asset?path=abc.mp3', duration: 300, kind: 'local', title: '录音' }
  const { host, root } = await mount(
    React.createElement(AudioPlayer, { t: (key) => key, track, seekRequest: { time: 65, index: 0, at: 1 } }),
  )
  const audio = host.querySelector('audio')
  assert.ok(audio !== null, '要渲染出 audio 元素')
  assert.equal(Math.round(audio.currentTime), 65)
  assert.ok(host.textContent.includes('01:05'), '时间显示要跟着走，实际 ' + host.textContent)
  root.unmount()
  host.remove()
})

test('跳转请求是给别的音轨的，这一条播放器不动', async () => {
  const track = { url: '/getnote/asset?path=abc.mp3', duration: 300, kind: 'local', title: '录音' }
  const { host, root } = await mount(
    React.createElement(AudioPlayer, { t: (key) => key, track, trackIndex: 1, seekRequest: { time: 65, index: 0, at: 1 } }),
  )
  const audio = host.querySelector('audio')
  assert.equal(Math.round(audio.currentTime), 0)
  root.unmount()
  host.remove()
})

test('没有音轨时时间戳不做成按钮，免得按了没反应', async () => {
  const { host, root } = await mount(React.createElement(TranscriptBlock, { text: SCRIPT, onSeek: null }))
  assert.equal(host.querySelectorAll('.dshgn_tsBtn').length, 0, '没有 onSeek 时不该出现可点按钮')
  assert.equal(host.querySelectorAll('.dshgn_ts').length, 3, '时间戳本身还要显示')
  root.unmount()
  host.remove()
})
