/*
 * panel.test.mjs —— 面板真的能渲染
 *
 * 前面的 host 测试只证明「HTTP 接口对」，但面板是 8000 行 React，
 * 一旦某个组件在 Obsidian 的 DOM 环境里炸了，接口再对用户也只看到白屏。
 * 这里用 jsdom 造一个浏览器环境，把 PanelRoot 真渲染出来，跑通
 * 「挂载 → 拉数据 → 切标签页 → 卸载」这条链路。
 *
 * 注意：panel.js 里的 fetch 打的是 main.js 写入的 origin，所以这里也要
 * 起一个真的本地服务（和 smoke.mjs 一样），不能 mock 掉。
 */

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'

const dataDir = await mkdtemp(join(tmpdir(), 'dshgn-panel-data-'))
const vaultBase = await mkdtemp(join(tmpdir(), 'dshgn-panel-vault-'))
process.env.DSH_HOME = dataDir

const settings = await import('../src/core/settings.js')
settings.configure({ dataDir, vaultBase, subfolder: '得到大脑' })
await settings.setVaultRoot('得到大脑')

const { startLocalServer } = await import('../src/host/server.js')
const panel = await import('../src/view/panel.js')

const server = await startLocalServer({ preferredPort: 0 })
panel.setApiOrigin(server.origin)
panel.setApiToken(server.token)

// ── 浏览器环境 ─────────────────────────────────────────────────────────────
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'app://obsidian.md/',
  pretendToBeVisual: true,
})

const { window } = dom
const realFetch = globalThis.fetch
const fetchCalls = []

// jsdom 没有 fetch，也没有 clipboard；面板两处都用到。
window.fetch = globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : String(input && input.url)
  fetchCalls.push(url)
  return realFetch(url, init)
}
const clipboard = { writeText: async () => undefined }
Object.defineProperty(window.navigator, 'clipboard', { value: clipboard, configurable: true })
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
globalThis.window = window
globalThis.document = window.document
globalThis.HTMLElement = window.HTMLElement
globalThis.Node = window.Node
globalThis.Event = window.Event
globalThis.MouseEvent = window.MouseEvent
globalThis.KeyboardEvent = window.KeyboardEvent
globalThis.getComputedStyle = window.getComputedStyle.bind(window)
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
// jsdom 没实现 scrollTo（面板跳大纲时用），补一个空实现
window.HTMLElement.prototype.scrollTo = function scrollTo() {}
globalThis.IS_REACT_ACT_ENVIRONMENT = false

const React = await import('preact/compat')
const { createRoot } = await import('preact/compat/client')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 等到条件成立（最多等 timeout 毫秒）。 */
async function waitFor(check, timeout = 5000, label = '条件') {
  const started = Date.now()
  for (;;) {
    const value = check()
    if (value) return value
    if (Date.now() - started > timeout) {
      throw new Error('等待超时：' + label)
    }
    await sleep(50)
  }
}

const rootEl = window.document.getElementById('root')
let root = null

after(async () => {
  if (root) {
    root.unmount()
    root = null
  }
  panel.setApiOrigin('')
  await server.close()
  await rm(dataDir, { recursive: true, force: true })
  await rm(vaultBase, { recursive: true, force: true })
  window.close()
})

test('面板挂载后不会掉进错误边界', async () => {
  root = createRoot(rootEl)
  root.render(React.createElement(panel.PanelRoot, {}))

  await waitFor(() => fetchCalls.length > 0, 5000, '面板发出第一个请求')

  // 错误边界一旦接住异常，会渲染这段标题；正常时它不该出现。
  await waitFor(
    () => !window.document.body.textContent.includes('面板渲染出错'),
    3000,
    '错误边界未触发',
  )
  assert.equal(
    window.document.body.textContent.includes('面板渲染出错'),
    false,
    '面板掉进了错误边界：' + window.document.body.textContent.slice(0, 500),
  )
})

test('面板拉到了库数据并渲染出界面', async () => {
  await waitFor(
    () => window.document.querySelector('.dshgn_root') !== null,
    5000,
    '根节点渲染',
  )

  const text = window.document.body.textContent
  // 六个标签页的文案是面板骨架，缺一个都说明渲染没走完
  for (const label of ['笔记', '云端', '冲突', '录音卡', '设置', '回收站']) {
    assert.ok(text.includes(label), '界面上没有「' + label + '」标签，实际文本：' + text.slice(0, 400))
  }
})

test('面板发出的请求全部指向本地服务', () => {
  assert.ok(fetchCalls.length > 0, '面板一个请求都没发')
  for (const url of fetchCalls) {
    assert.ok(
      url.startsWith(server.origin + '/getnote'),
      '请求没有打到本地服务：' + url,
    )
  }
  // 至少应该问过状态和目录树
  const paths = fetchCalls.map((url) => url.slice(server.origin.length))
  assert.ok(paths.some((path) => path.startsWith('/getnote/status')), '没有请求 /status')
})

/**
 * 点一个标签页。
 *
 * 不要求「一定发出请求」：云端/冲突这些页在没配凭证时是空态，本来就不打接口。
 * 要验的是切换过程本身不把 React 树打挂。
 */
async function clickTab(label) {
  const tabs = Array.from(window.document.querySelectorAll('button'))
  const tab = tabs.find((el) => (el.textContent || '').trim() === label)
  assert.ok(tab, '找不到「' + label + '」标签按钮')
  tab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)
  assert.equal(
    window.document.body.textContent.includes('面板渲染出错'),
    false,
    '切到「' + label + '」后掉进了错误边界：' + window.document.body.textContent.slice(0, 400),
  )
}

test('切换标签页逐个渲染都不炸', async () => {
  for (const label of ['云端', '冲突', '录音卡', '回收站', '设置', '笔记']) {
    await clickTab(label)
  }
})

/** `#rrggbb` → 0..1 的相对亮度（够用来判断「深」还是「浅」）。 */
function luminance(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim())
  if (!m) return null
  const [r, g, b] = [m[1], m[2], m[3]].map((part) => parseInt(part, 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

test('宿主切到深色主题时面板跟着变深，切回来还原', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  // 浅色：没选主题色时 themeVars 返回 null，不给行内 style，走 CSS 里那套浅色默认值
  assert.equal(
    rootNode().style.getPropertyValue('--dshgn-light').trim(),
    '',
    '浅色下不该写行内主题变量（应当回落 CSS 默认的浅色板）',
  )

  // Obsidian 切主题只改 body 上的类名，不通知视图；面板自己盯这个类名
  window.document.body.classList.add('theme-dark')
  await waitFor(
    () => rootNode().style.getPropertyValue('--dshgn-light').trim() !== '',
    3000,
    '深色下算出主题变量',
  )

  const darkLight = luminance(rootNode().style.getPropertyValue('--dshgn-light'))
  const darkDeep = luminance(rootNode().style.getPropertyValue('--dshgn-deep'))
  assert.ok(darkLight !== null && darkLight < 0.2, '深色下右栏底色应该很暗，实际亮度 ' + darkLight)
  assert.ok(darkDeep !== null && darkDeep < darkLight, '深色下左栏应该比右栏更暗')
  // 深色下正文色是浅色字，否则深底上会读不出来
  assert.ok(
    /rgba\(255,\s*255,\s*255/.test(rootNode().style.getPropertyValue('--dshgn-lightFg')),
    '深色下正文色应当是浅色，实际 ' + rootNode().style.getPropertyValue('--dshgn-lightFg'),
  )

  // 切回浅色：行内变量要撤掉，重新回落 CSS 默认的浅色板
  window.document.body.classList.remove('theme-dark')
  await waitFor(
    () => rootNode().style.getPropertyValue('--dshgn-light').trim() === '',
    3000,
    '切回浅色后撤掉行内变量',
  )
})

/**
 * 命令面板投递的意图要真的落到面板上。
 *
 * 命令面板触发时面板可能刚被创建、还没渲染完，所以意图是「投递」而不是直接
 * 调用——这条测的就是那根线通不通。
 */
test('命令面板的意图能被面板接住并执行', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  // 先切走，确认 search 意图会把页签切回「笔记」
  await clickTab('设置')
  panel.requestIntent({ type: 'search' })
  await sleep(150)

  const searchBox = window.document.querySelector('.dshgn_search')
  assert.ok(searchBox !== null, 'search 意图之后应该回到笔记页，搜索框要在')
  assert.equal(
    window.document.activeElement,
    searchBox,
    'search 意图要把焦点送进搜索框',
  )
})

/**
 * 三栏宽度可拖。
 *
 * 不测像素级外观，只测两件会真坏的事：拖完宽度真的落到根节点的 CSS 变量上
 * （三栏的 width 全读这个变量），以及手柄能被键盘调——纯鼠标实现的话
 * 键盘用户永远改不了栏宽。
 */
test('三栏之间的手柄能拖动，宽度落在根节点的 CSS 变量上', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  const splitters = Array.from(window.document.querySelectorAll('.dshgn_splitter'))
  assert.equal(splitters.length, 2, '左栏/中栏右侧各应有一个拖拽手柄')

  const before = rootNode().style.getPropertyValue('--dshgn-treeW').trim()
  assert.match(before, /^\d+px$/, '根节点上应该有左栏宽度变量，实际 ' + before)

  // 拖动：按下 → 移动 → 松手。jsdom 没有 PointerEvent，用 MouseEvent 代替，
  // 处理器只用到 clientX 与 pointerId，形状是够的。
  const handle = splitters[0]
  const startX = parseInt(before, 10)
  handle.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: startX, button: 0 }))
  handle.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: startX + 40 }))
  handle.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: startX + 40 }))
  // 状态更新是异步的（Preact 会把同一帧内的 setState 合批），要等一拍再读
  await sleep(60)

  const after = rootNode().style.getPropertyValue('--dshgn-treeW').trim()
  assert.equal(parseInt(after, 10), startX + 40, '拖 40px 后左栏应该宽 40px，实际 ' + after)

  // 键盘：方向键微调，Shift 加大步长
  handle.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }))
  await sleep(60)
  assert.equal(
    parseInt(rootNode().style.getPropertyValue('--dshgn-treeW'), 10),
    startX + 40 - 8,
    '按一次左方向键应该收窄 8px',
  )
  handle.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft', shiftKey: true }))
  await sleep(60)
  assert.equal(
    parseInt(rootNode().style.getPropertyValue('--dshgn-treeW'), 10),
    startX + 40 - 8 - 32,
    'Shift + 左方向键应该一次收窄 32px',
  )

  // 越界要夹住：拖到极左不能把左栏拖成负数或 0
  handle.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 200, button: 0 }))
  handle.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: -5000 }))
  handle.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: -5000 }))
  await sleep(60)
  const clamped = parseInt(rootNode().style.getPropertyValue('--dshgn-treeW'), 10)
  assert.ok(clamped >= 150, '左栏宽度有下限，实际 ' + clamped)
})
