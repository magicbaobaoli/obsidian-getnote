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

const React = await import('react')
const { createRoot } = await import('react-dom/client')

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
