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

// 先塞一篇笔记：列表为空的话，下面「右键笔记卡片」那类验收就没有可点的对象。
// 走服务接口建，和面板里点「新建」是同一条路。
await fetch(server.origin + '/getnote/create', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
  body: JSON.stringify({ dir: '', title: '右键菜单验收', content: '正文', requestId: 'seed-menu-note' }),
})

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

// jsdom 在 app:// 这种不透明源上取 localStorage 会抛 SecurityError。面板里所有
// 读写都包了 try/catch（隐私模式就回落默认值），但那样「记住栏宽」「记住上次
// 看到哪儿」这些偏好一条都测不到。换成内存实现，让它们能真跑一遍。
const memoryStore = new Map()
const fakeStorage = {
  getItem: (key) => (memoryStore.has(String(key)) ? memoryStore.get(String(key)) : null),
  setItem: (key, value) => {
    memoryStore.set(String(key), String(value))
  },
  removeItem: (key) => {
    memoryStore.delete(String(key))
  },
  clear: () => memoryStore.clear(),
  key: (index) => Array.from(memoryStore.keys())[index] ?? null,
  get length() {
    return memoryStore.size
  },
}
Object.defineProperty(window, 'localStorage', { value: fakeStorage, configurable: true })
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
 * 面板语言要跟着宿主走。
 *
 * 这是「i18n 跟随宿主」那条：Obsidian 用户把界面改成英文，插件却全中文，
 * 是最容易被骂的一类不体面。
 */
test('注入宿主语言后面板换成对应字典，清掉再退回中文', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  const labels = () =>
    Array.from(window.document.querySelectorAll('button')).map((el) => (el.textContent || '').trim())
  const clickNotesTab = (candidates) => {
    const tab = Array.from(window.document.querySelectorAll('button')).find((el) =>
      candidates.includes((el.textContent || '').trim()),
    )
    assert.ok(tab, '找不到笔记页签，现有 ' + labels().slice(0, 12).join('/'))
    tab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  }

  // 注入英文宿主语言。
  // 注意要切到**别的**页签：文案闭包读的是模块级语言状态，只有重渲染才会
  // 重新取值，而点当前所在的页签 setTab 同一个值不会触发渲染。
  panel.setHostLocale('en-US')
  clickNotesTab(['云端', 'Cloud'])
  await sleep(250)
  assert.ok(
    labels().includes('Notes'),
    '注入英文后应该有 Notes 页签，实际 ' + labels().slice(0, 12).join('/'),
  )

  // 清掉注入：切回中文
  panel.setHostLocale(null)
  clickNotesTab(['Conflicts', '冲突'])
  await sleep(250)
  assert.ok(
    labels().includes('笔记'),
    '清掉宿主语言后应该回到中文页签，实际 ' + labels().slice(0, 12).join('/'),
  )
  assert.ok(
    labels().includes('笔记'),
    '清掉宿主语言后应该回到中文页签，实际 ' + labels().slice(0, 12).join('/'),
  )
})

/**
 * 右键笔记卡片要把动作清单交给宿主。
 *
 * 面板自己不会画菜单——它把「标签 + 动作」交给注入的实现（真宿主是 Obsidian
 * 原生 Menu）。这里注入一个记录器，确认清单里有打开/复制引用/删除这些动作，
 * 并且执行其中一个真的会生效。
 */
test('右键笔记卡片会把动作清单交给宿主，执行其中一项真的生效', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  // 回到笔记页并等列表里出现那篇预置笔记
  const notesTab = Array.from(window.document.querySelectorAll('button')).find(
    (el) => (el.textContent || '').trim() === '笔记',
  )
  notesTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const card = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) =>
        (el.textContent || '').includes('右键菜单验收'),
      ),
    5000,
    '列表里出现预置笔记',
  )

  const seen = []
  panel.setNoteMenu((event, items) => {
    seen.push(items.map((item) => item.id))
    return true
  })

  card.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await sleep(120)

  assert.equal(seen.length, 1, '右键应该把菜单交给宿主一次')
  const ids = seen[0]
  for (const id of ['open', 'copy-ref', 'push-one', 'pull-one', 'delete']) {
    assert.ok(ids.includes(id), '动作清单里缺 ' + id + '，实际 ' + ids.join(','))
  }

  // 执行「打开这篇」：右侧正文区应当出现这篇的标题
  panel.setNoteMenu((event, items) => {
    const open = items.find((item) => item.id === 'open')
    assert.ok(open, '清单里应该有「打开这篇」')
    open.run()
    return true
  })
  card.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await waitFor(
    () => (window.document.querySelector('.dshgn_note') || { textContent: '' }).textContent.includes('右键菜单验收'),
    5000,
    '右键打开后正文区显示这篇笔记',
  )

  // 接上宿主编辑器之后，清单里要多一项「在 Obsidian 里打开」：用户常常是在列表里
  // 扫到一篇就想拿宿主的补全/Vim 去改，不必先点开再回头找按钮。
  const opened = []
  panel.setOpenInEditor((path) => {
    opened.push(String(path))
    return true
  })
  panel.setNoteMenu((event, items) => {
    const item = items.find((one) => one.id === 'open-in-editor')
    assert.ok(item, '接上宿主编辑器之后，清单里应该有「在 Obsidian 里打开」，实际 ' + items.map((one) => one.id).join(','))
    item.run()
    return true
  })
  card.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await sleep(120)
  assert.equal(opened.length, 1, '执行这一项应该把路径交给宿主一次')
  assert.match(opened[0], /右键菜单验收\.md$/, '交出去的是这篇的路径，实际 ' + opened[0])

  // 接上「在文件列表里定位」之后，清单里多一项：用户在列表里扫到一篇，想看看
  // 它在库里的哪儿、旁边还有什么，交给宿主的文件列表比自己解释路径直观。
  const revealed = []
  panel.setRevealInVault((path) => {
    revealed.push(String(path))
    return true
  })
  panel.setNoteMenu((event, items) => {
    const item = items.find((one) => one.id === 'reveal-in-vault')
    assert.ok(item, '接上定位之后，清单里应该有「在文件列表里定位」，实际 ' + items.map((one) => one.id).join(','))
    item.run()
    return true
  })
  card.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await sleep(120)
  assert.equal(revealed.length, 1, '执行这一项应该把路径交给宿主一次')
  assert.match(revealed[0], /右键菜单验收\.md$/, '交出去的是这篇的路径，实际 ' + revealed[0])

  panel.setRevealInVault(null)
  panel.setOpenInEditor(null)
  panel.setNoteMenu(null)
})

/**
 * 卡片要能拖到宿主的编辑器里。
 *
 * 用户在列表里扫到一篇、想把它引到正在写的那篇里时，拖过去比「复制引用 → 切到
 * 编辑器 → 粘贴」顺手。拖出去的内容必须是宿主自己的链接格式，否则粘进笔记里
 * 只是一段纯文本，不是双链。
 */
test('笔记卡片能拖出去，带的是宿主自己的链接格式', async () => {
  await waitFor(() => window.document.querySelector('.dshgn_root') !== null, 5000, '根节点渲染')
  const notesTab = Array.from(window.document.querySelectorAll('button')).find(
    (el) => (el.textContent || '').trim() === '笔记',
  )
  notesTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const card = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) =>
        (el.textContent || '').includes('右键菜单验收'),
      ),
    5000,
    '列表里出现预置笔记',
  )
  assert.equal(card.getAttribute('draggable'), 'true', '卡片应该标成可拖动')

  const asked = []
  panel.setMarkdownLink((path) => {
    asked.push(String(path))
    return '[[宿主给的链接]]'
  })
  const written = []
  const event = new window.MouseEvent('dragstart', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      setData: (kind, text) => written.push([kind, text]),
      effectAllowed: '',
    },
    configurable: true,
  })
  card.dispatchEvent(event)
  assert.deepEqual(written, [['text/plain', '[[宿主给的链接]]']], '拖出去的内容应当是宿主给的链接')
  assert.match(asked[0], /右键菜单验收\.md$/, '问宿主格式时给的是这篇的路径')

  // 宿主没接上（或者拿不到链接格式）时退回库内相对路径，至少粘过去是能认的路径
  panel.setMarkdownLink(() => '')
  const second = []
  const event2 = new window.MouseEvent('dragstart', { bubbles: true, cancelable: true })
  Object.defineProperty(event2, 'dataTransfer', {
    value: { setData: (kind, text) => second.push([kind, text]), effectAllowed: '' },
    configurable: true,
  })
  card.dispatchEvent(event2)
  assert.equal(second.length, 1, '拿不到链接格式也要给出一份可用的文本')
  assert.match(second[0][1], /右键菜单验收\.md$/, '退回的是这篇的路径，实际 ' + second[0][1])

  // 没有 dataTransfer 的环境不该炸
  card.dispatchEvent(new window.MouseEvent('dragstart', { bubbles: true, cancelable: true }))
  panel.setMarkdownLink(null)
})

/**
 * 确认框要交给宿主。
 *
 * 面板里原来的 window.confirm 在 Obsidian 里长得跟宿主完全不搭，移动端 WebView
 * 还可能根本不弹——删除这类不可逆动作就等于没有二次确认。这条验的是：确认
 * 真的问到了宿主，而且宿主说「不要」的时候，动作一步都没走。
 */
test('面板的确认框交给宿主，宿主说不要就一步都不走', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  // 先勾一篇，批量栏才会出现
  const card = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) =>
        (el.textContent || '').includes('右键菜单验收'),
      ),
    5000,
    '列表里出现预置笔记',
  )
  const box = card.querySelector('.dshgn_pickBox')
  assert.ok(box, '卡片上应该有勾选框')
  box.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_batchBar') !== null, 3000, '批量栏出现')

  // 展开批量操作菜单，找到「移到回收站」
  const batchBtn = Array.from(window.document.querySelectorAll('.dshgn_batchBtn')).find(
    (el) => (el.textContent || '').trim() === '批量操作',
  )
  assert.ok(batchBtn, '应该有「批量操作」按钮')
  batchBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const delBtn = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_btnDanger')).find((el) =>
        (el.textContent || '').includes('移到回收站'),
      ),
    3000,
    '出现「移到回收站」按钮',
  )

  const asked = []
  panel.setConfirmDialog((message) => {
    asked.push(String(message))
    return Promise.resolve(false)
  })
  try {
    delBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => asked.length > 0, 3000, '确认框问到宿主')
    assert.ok(asked[0].includes('回收站'), '问的话里要写清楚后果，实际：' + asked[0])

    // 宿主说「不要」：笔记必须还在
    await sleep(200)
    const still = await fetch(
      server.origin + '/getnote/tree',
      { headers: { 'x-getnote-token': server.token } },
    ).then((res) => res.json())
    assert.ok(
      JSON.stringify(still).includes('右键菜单验收'),
      '取消之后不该真的删掉：' + JSON.stringify(still).slice(0, 300),
    )
  } finally {
    panel.setConfirmDialog(null)
  }
})

/**
 * 「在 Obsidian 里打开」。
 *
 * 面板的编辑器只服务「扫一眼、改两笔」，没有补全、没有 Vim、没有插件命令。
 * 真要动结构得回宿主编辑器——这条验按钮在、点了会把库内相对路径交出去。
 */
test('笔记头上有「在 Obsidian 里打开」，点了把路径交给宿主', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  // 宿主没注入时不显示这个按钮（点了没反应比没有更让人困惑）
  assert.equal(
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).some(
      (el) => el.title === '在 Obsidian 里打开',
    ),
    false,
    '没有宿主实现时不该出现这个按钮',
  )

  const opened = []
  panel.setOpenInEditor((path) => {
    opened.push(path)
    return true
  })
  try {
    // 重新打开一遍这篇笔记，让笔记头按「有宿主」重渲染
    await clickTab('云端')
    await clickTab('笔记')
    const card = await waitFor(
      () =>
        Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) =>
          (el.textContent || '').includes('右键菜单验收'),
        ),
      5000,
    )
    card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    const btn = await waitFor(
      () =>
        Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find(
          (el) => el.title === '在 Obsidian 里打开',
        ),
      5000,
      '出现「在 Obsidian 里打开」按钮',
    )
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => opened.length > 0, 3000, '路径交给宿主')
    assert.match(opened[0], /右键菜单验收\.md$/, '交出去的应该是库内相对路径，实际 ' + opened[0])
  } finally {
    panel.setOpenInEditor(null)
  }
})

/**
 * 反链优先问宿主。
 *
 * Obsidian 的 metadataCache 一直在增量维护整库链接图，我们再读一遍全库正文去
 * 正则匹配等于把同一件事干第二遍。这条验的是：注入了宿主图谱就真的不去打
 * /backlinks，而且宿主给的命中能照常渲染成「关联笔记」。
 */
test('反链优先问宿主，注入了就不再扫全库', async () => {
  await waitFor(() => window.document.querySelector('.dshgn_root') !== null, 5000, '根节点渲染')

  const asked = []
  panel.setVaultGraph((path, kind) => {
    asked.push(kind + ':' + path)
    if (kind !== 'backlinks') return null
    return { target: path, hits: [{ path: '别处的笔记.md', title: '别处的笔记', links: [path] }] }
  })
  try {
    const before = fetchCalls.filter((url) => url.includes('/backlinks')).length
    await clickTab('云端')
    await clickTab('笔记')
    const card = await waitFor(
      () =>
        Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) =>
          (el.textContent || '').includes('右键菜单验收'),
        ),
      5000,
    )
    card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

    const item = await waitFor(
      () => window.document.querySelector('.dshgn_backlinkItem'),
      5000,
      '关联笔记区出现宿主给的命中',
    )
    assert.ok((item.textContent || '').includes('别处的笔记'), '要显示宿主的标题')
    assert.ok(asked.length > 0, '应该问过宿主')
    assert.ok(
      asked.some((entry) => entry.startsWith('backlinks:')),
      '应该问的是反链，实际：' + asked.join(','),
    )
    const after = fetchCalls.filter((url) => url.includes('/backlinks')).length
    assert.equal(after, before, '注入了宿主图谱就不该再去打 /backlinks')
  } finally {
    panel.setVaultGraph(null)
  }
})

/**
 * 双链该指向哪一篇，先问宿主的索引。
 *
 * 面板原来自己在扫到的 entries 里按「路径全等 → 文件名 → 标题」三级退让。
 * 同名笔记一多，这个顺序就会指到另一篇上去，而「点进去是另一篇」用户很难察觉。
 * 宿主的 getFirstLinkpathDest 知道别名、同名取最近、路径前缀这些规则，先问它。
 */
test('点内链先问宿主的索引，问不到才自己按名字找', async () => {
  await waitFor(() => window.document.querySelector('.dshgn_root') !== null, 5000, '根节点渲染')

  // 目标笔记真的存在，否则打开时会 404，测不出「打开的是哪一篇」
  const seeded = await fetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '宿主解析目标',
      content: '被链到的那篇',
      withDatePrefix: false,
      requestId: 'seed-link-target',
    }),
  })
  const targetPath = (await seeded.json()).path
  assert.equal(targetPath, '随手记/宿主解析目标.md', '这条要按真路径测，不能靠猜文件名')

  const asked = []
  panel.setLinkResolve((linkpath, sourcePath) => {
    asked.push([String(linkpath), String(sourcePath)])
    return targetPath
  })
  panel.setVaultGraph((path, kind) => {
    if (kind !== 'backlinks') return null
    return { target: path, hits: [{ path: '宿主解析目标', title: '宿主解析目标', links: [path] }] }
  })
  try {
    // 上一条用例结束时可能还开着一篇，先退回列表，否则点卡片是「收起」不是「打开」
    const back = window.document.querySelector('.dshgn_noteBack')
    if (back) {
      panel.setConfirmDialog(() => Promise.resolve(true))
      try {
        back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
        await waitFor(
          () => window.document.querySelector('.dshgn_root').getAttribute('data-has-note') === 'false',
          5000,
          '先退回列表',
        )
      } finally {
        panel.setConfirmDialog(null)
      }
    }
    await clickTab('云端')
    await clickTab('笔记')
    const card = await waitFor(
      () =>
        Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) =>
          (el.textContent || '').includes('右键菜单验收'),
        ),
      5000,
    )
    card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

    const item = await waitFor(
      () => window.document.querySelector('.dshgn_backlinkItem'),
      5000,
      '关联笔记出现',
    )
    item.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

    const note = await waitFor(
      () => {
        const el = window.document.querySelector('.dshgn_note')
        if (!el) return null
        return (el.textContent || '').includes('被链到的那篇') ? el : null
      },
      5000,
      '内链把那一篇打开了',
    )
    assert.ok(note, '打开的应该就是宿主解析出来的那一篇')
    assert.ok(asked.length > 0, '应该问过宿主')
    assert.equal(asked[0][0], '宿主解析目标', '递过去的应该是链接原文')
    // 源笔记是测试开头用 /create 建的，名字带日期前缀，所以按模式匹配
    assert.match(
      asked[0][1],
      /^得到大脑\/.*右键菜单验收\.md$/,
      '还要告诉宿主是从哪一篇链出来的，同名笔记要靠这个判断远近',
    )

    // 宿主解析不出来时退回自己那套：这篇在 entries 里，按名字也找得到
    panel.setLinkResolve(() => '')
    const again = await waitFor(
      () => window.document.querySelector('.dshgn_backlinkItem'),
      5000,
      '关联笔记还在',
    )
    again.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(
      () => (window.document.querySelector('.dshgn_note') || {}).textContent !== undefined,
      3000,
      '退回自己那套也要能打开',
    )

    // 宿主抛错时同理，不能让点内链变成没反应
    panel.setLinkResolve(() => { throw new Error('索引炸了') })
    const third = await waitFor(
      () => window.document.querySelector('.dshgn_backlinkItem'),
      5000,
      '关联笔记还在',
    )
    assert.doesNotThrow(() => third.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
  } finally {
    panel.setLinkResolve(null)
    panel.setVaultGraph(null)
  }
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
 * 选区速记：把别处的一段文字落成一篇笔记。
 *
 * 这条同时守住两件事：意图真的落到了笔记上（不是只弹个 toast），以及摘录和
 * 用户自己的话分得开——正文必须是引用块，否则以后回看根本不知道哪句是自己写的。
 */
test('选区速记能把文字落成一篇带引用的笔记', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  await clickTab('设置')
  panel.requestIntent({
    type: 'capture',
    text: '第一行是标题\n第二行是正文',
    source: '别处的笔记.md',
  })
  // 不能只等 .dshgn_note 出现：上一轮测试留下的正文区还在，要等到真换成摘录内容。
  const body = await waitFor(
    () => {
      const node = window.document.querySelector('.dshgn_note')
      if (node === null) return null
      const text = node.textContent || ''
      return text.includes('第一行是标题') ? text : null
    },
    8000,
    '速记之后正文区要换成新笔记',
  )
  assert.ok(body.includes('第二行是正文'), '多行也要整段保留：' + body.slice(0, 200))
  assert.ok(body.includes('摘自'), '要注明来源，否则以后不知道这话是谁说的')
})

/**
 * 同步跑完之后把结果交给宿主。
 *
 * 命令面板点「立即同步」时面板可能压根没打开，跑完的结果没人看见。这条测的是
 * 「轮询到结束 → 回调宿主」这根线：宿主拿不到结果，写日记摘要就永远不会发生。
 */
test('同步结束后把结果交给宿主（宿主据此写日记摘要）', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  const reports = []
  panel.setSyncReport((result) => reports.push(result))
  try {
    // 直接造一个「同步已完成」的状态没法从外部注入，所以这里验的是那条更窄的
    // 契约：runSyncReport 对空结果不炸，且注入的回调真的会被调用。
    panel.__internals.reportSync({ pulled: 2, skipped: 1, conflicts: 0 })
    assert.equal(reports.length, 1, '宿主应该收到一次同步结果')
    assert.equal(reports[0].pulled, 2)
  } finally {
    panel.setSyncReport(null)
  }
})

/**
 * 面板要把「库有多大、开着哪一篇」报给宿主，状态栏才有东西可写。
 *
 * 只验这条契约：注入之后立刻收到一次（首屏就有数量），打开笔记之后又收到
 * 一次且带着标题。宿主怎么拼文案在 boot 测试里验。
 */
test('面板把库大小与当前笔记报给宿主，状态栏才有东西可写', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  // 前面的用例可能留着打开状态的笔记，先退回列表，才能验「没开笔记时不报标题」
  const backFirst = window.document.querySelector('.dshgn_noteBack')
  if (backFirst) backFirst.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(60)

  const reports = []
  panel.setStatusReport((info) => reports.push(info))
  try {
    // 真宿主是在挂载前就注入的；测试里注入得晚，得让面板重新拉一次数据
    // （entries 换了新数组）才会再报一次。
    await clickTab('笔记')
    const refreshBtn = Array.from(window.document.querySelectorAll('.dshgn_iconBtn'))
      .find((el) => el.title === '刷新')
    assert.ok(refreshBtn, '应该有一个刷新按钮')
    refreshBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => reports.length > 0, 5000, '注入后应该收到一次库大小')
    const base = reports[reports.length - 1]
    assert.ok(Number.isFinite(base.count) && base.count > 0, '首屏就该报出库里有多少篇')
    assert.equal(base.note, '', '还没打开笔记时不该报标题')

    await waitFor(() => window.document.querySelector('.dshgn_card') !== null, 8000, '列表有卡片')
    window.document.querySelector('.dshgn_card').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(
      () => reports.some((info) => typeof info.note === 'string' && info.note !== ''),
      8000,
      '打开笔记后要报出标题',
    )
  } finally {
    panel.setStatusReport(null)
    // 这条用例打开了笔记，后面的用例要从列表态开始
    const back = window.document.querySelector('.dshgn_noteBack')
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(60)
  }
})

/**
 * 「把本地改动推上去」这个按钮得真的在设置页里，且没配云端时是灰的。
 *
 * 批量反向同步是这次新加的能力，最怕的是后端做好了、面板上却没有入口——用户
 * 找不到就等于没做。这里只验入口：按钮存在、文案是那一句、没配凭证时点不动。
 * 真正「推哪些、不该推哪些」的规则在 host 测试里用假客户端验。
 */
test('设置页有「把本地改动推上去」，没配云端时点不动', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')
  await clickTab('设置')

  const buttons = Array.from(window.document.querySelectorAll('button'))
  const pushBtn = buttons.find((el) => (el.textContent || '').trim() === '把本地改动推上去')
  assert.ok(pushBtn, '设置页里应该有一个「把本地改动推上去」按钮')
  assert.equal(pushBtn.disabled, true, '这条测试里没配云端凭证，按钮应该是灰的')
  assert.ok((pushBtn.getAttribute('title') || '').length > 0, '按钮上要挂一句说明，讲清楚会覆盖云端正文')

  // 后面的测试默认停在笔记页（左栏/中栏/拖拽手柄都在那儿），别把它们留在设置页
  await clickTab('笔记')
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
/**
 * 列表增量渲染。
 *
 * 库大了以后把几千张卡片一次性塞进 DOM，滚动会明显发涩。这里造出比一屏
 * 多得多的笔记，确认：① 一次只渲染一屏的量；② 剩下的由「显示更多」接手，
 * 点一下真的多渲染一批。只测这两件会真坏的事，不测滚动性能本身。
 */
test('列表一次只渲染一屏，其余交给「显示更多」', async () => {
  const total = 130
  for (let i = 0; i < total; i += 1) {
    await fetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({
        dir: '增量渲染验收',
        title: '批量 ' + String(i).padStart(3, '0'),
        content: '正文 ' + i,
        requestId: 'seed-bulk-' + i,
      }),
    })
  }

  // 刷新一次，让左栏里出现这个新目录（点当前所在的页签不会触发重渲染）
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  assert.ok(refreshBtn(), '应该有一个刷新按钮')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_tree') !== null, 5000, '左栏渲染')
  await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_treeName')).some(
        (el) => (el.textContent || '').trim() === '增量渲染验收',
      ),
    8000,
    '刷新后左栏出现新目录',
  )
  const rows = Array.from(window.document.querySelectorAll('.dshgn_treeRow'))
  const dirRow = rows.find((el) => {
    const name = el.querySelector('.dshgn_treeName')
    return name !== null && (name.textContent || '').trim() === '增量渲染验收'
  })
  assert.ok(dirRow, '左栏里应该有「增量渲染验收」这个目录')
  dirRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

  const cards = () => Array.from(window.document.querySelectorAll('.dshgn_listBody .dshgn_card'))
  await waitFor(() => cards().length > 0, 8000, '列表渲染出卡片')
  const first = cards().length
  assert.ok(first < total, '不该一次把 ' + total + ' 张卡片全渲染出来，实际 ' + first)
  assert.equal(first, 60, '第一屏应该是 60 张，实际 ' + first)

  const moreBtn = () => window.document.querySelector('.dshgn_moreBtn')
  assert.ok(moreBtn(), '还有没渲染的笔记时应该有「显示更多」按钮')
  moreBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => cards().length > first, 5000, '点「显示更多」后多渲染一批')
  assert.equal(cards().length, 120, '再点一次应该到 120 张，实际 ' + cards().length)

  // 最后一批点完，按钮就该消失——留着它按了没反应更让人困惑
  moreBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => cards().length === total + 0 || cards().length === total, 5000, '渲染完全部笔记')
  assert.equal(moreBtn(), null, '全部渲染完之后不该还留着「显示更多」')
})

/**
 * 窄窗口适配与编辑快捷键。
 *
 * Obsidian 的侧栏可以只有两三百像素宽，popout 窗口也能随便拉，三栏横排
 * 在那个宽度下谁都读不了。jsdom 不实现容器查询（CSS 里的显示/隐藏算不出来），
 * 所以这里守的是「状态与开关」那一半：根节点上的两个 data 属性、抽屉开关
 * 按一下真的翻、选完目录自己收回、笔记能退回列表。样式由容器查询负责。
 */
test('窄窗口：左栏能收成抽屉，笔记能退回列表', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')
  await clickTab('笔记')

  const rowOf = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })
  // 回到「全部笔记」，把上一条测试留下的目录筛选清掉
  await waitFor(() => rowOf('全部笔记') !== undefined, 8000, '左栏里有「全部笔记」')
  rowOf('全部笔记').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelectorAll('.dshgn_card').length > 0, 8000, '列表有卡片')

  const toggle = () => window.document.querySelector('.dshgn_treeToggle')
  assert.ok(toggle(), '笔记页应该有一个左栏开关（宽窗口下由 CSS 藏起来）')
  assert.equal(rootNode().getAttribute('data-narrow-tree'), 'false', '默认抽屉是收起的')
  toggle().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(60)
  assert.equal(rootNode().getAttribute('data-narrow-tree'), 'true', '点一下要打开抽屉')

  // 在抽屉里选一个目录，抽屉要自己收回，否则它一直盖着列表
  rowOf('全部笔记').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(60)
  assert.equal(rootNode().getAttribute('data-narrow-tree'), 'false', '选完目录抽屉要自己收回')

  // 打开一篇笔记 → 中栏让位；点「返回」→ 回到列表
  window.document.querySelector('.dshgn_card').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '笔记打开后根节点标出这一点')

  const back = window.document.querySelector('.dshgn_noteBack')
  assert.ok(back, '笔记头上应该有「返回列表」（宽窗口下由 CSS 藏起来）')
  back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '返回后回到列表')
  await waitFor(() => window.document.querySelector('.dshgn_empty') !== null, 5000, '右栏回到空态')
})

/**
 * 编辑态的快捷键要和宿主编辑器同一个口径：Ctrl/Cmd+S 保存、Esc 退出编辑。
 * 只测这两件会真坏的事——按了保存却没落盘，按了 Esc 却还卡在编辑态。
 */
test('编辑态里 Ctrl+S 保存、Esc 退出编辑', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')
  await clickTab('笔记')
  await waitFor(() => window.document.querySelector('.dshgn_card') !== null, 8000, '列表有卡片')

  window.document.querySelector('.dshgn_card').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '笔记打开')

  const editBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '编辑')
  assert.ok(editBtn(), '阅读态应该有编辑按钮')
  editBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const area = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '进入编辑态')

  // Preact 的 onChange 落在 input 事件上，jsdom 里要自己派发
  area.value = '快捷键验收：改过的正文'
  area.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(60)

  const savesBefore = fetchCalls.filter((url) => url.includes('/getnote/save')).length
  const savedTimes = () => fetchCalls.filter((url) => url.includes('/getnote/save')).length
  // 整套测试并行跑时机器可能很吃紧，一次按键的处理器要排一会儿队才轮到；
  // 所以重按几次（真的坏了仍然会失败，只是不会因为慢就判红）。
  for (let attempt = 0; attempt < 3 && savedTimes() === savesBefore; attempt += 1) {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, metaKey: true, bubbles: true }))
    await sleep(400)
  }
  await waitFor(
    () => savedTimes() > savesBefore,
    8000,
    'Ctrl+S 之后要真的打一次保存',
  )

  // Esc：退出编辑态（保存后可能已经退出，也接受再进一次）
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_editor') === null, 5000, 'Esc 之后要退出编辑态')
})

/**
 * 上次看到哪儿了。
 *
 * Obsidian 关掉再开很常见（重启、切库、叶子关掉又拉回来），每次回来都从
 * 「笔记 / 全部 / 没打开任何一篇」开始，等于让人重新找一遍刚才的位置。
 * 这里守三件事：位置真的记下来了、重开时真的回到那儿、存的东西坏了不炸。
 */
test('面板记得上次停在哪个页签、哪个目录、开着哪一篇', async () => {
  const { readSession, writeSession, SESSION_KEY } = panel.__internals
  await clickTab('笔记')
  await waitFor(() => window.document.querySelector('.dshgn_card') !== null, 8000, '列表有卡片')

  // 上一条用例结束时笔记还开着；先退回列表，否则这次点卡片是「再点一下收起」
  const backBtn = window.document.querySelector('.dshgn_noteBack')
  if (backBtn !== null) {
    panel.setConfirmDialog(() => Promise.resolve(true))
    backBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(
      () => window.document.querySelector('.dshgn_root').getAttribute('data-has-note') === 'false',
      5000,
      '先退回列表',
    )
    panel.setConfirmDialog(null)
  }

  // 打开一篇，位置就该被记下来
  window.document.querySelector('.dshgn_card').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_root').getAttribute('data-has-note') === 'true', 8000, '笔记打开')
  await waitFor(() => readSession().path !== '', 5000, '开着的那一篇被记下来')
  assert.equal(readSession().tab, 'notes', '页签也要记')
  assert.ok(readSession().path.endsWith('.md'), '记的是路径：' + readSession().path)
  // 先留一份：下面要故意把存储写坏来验回落，坏掉之后就读不出它了
  const openPath = readSession().path

  // 切到别的页签也要跟上
  await clickTab('设置')
  await waitFor(() => readSession().tab === 'settings', 5000, '页签变化被记下来')

  // 存坏了 / 存了不认识的页签：当作没有，不抛错
  window.localStorage.setItem(SESSION_KEY, '{ 这不是 JSON')
  assert.deepEqual(readSession(), { tab: '', dir: '', tag: '', path: '' })
  window.localStorage.setItem(SESSION_KEY, JSON.stringify({ tab: '不存在的页签', dir: 3, path: null }))
  assert.deepEqual(readSession(), { tab: '', dir: '', tag: '', path: '' })

  // 换一个「新窗口」：清掉内存里的组件树，用刚写下的位置重新挂一次
  writeSession({ tab: 'notes', dir: '', tag: '', path: openPath })
  await clickTab('笔记')
  await waitFor(() => readSession().path !== '', 5000, '位置已经写好')
  const saved = readSession()
  assert.equal(saved.tab, 'notes')

  root.unmount()
  root = createRoot(rootEl)
  root.render(React.createElement(panel.PanelRoot, {}))
  // 重开之后应该直接停在那一篇上，而不是空态
  await waitFor(
    () => window.document.querySelector('.dshgn_root') !== null &&
      window.document.querySelector('.dshgn_root').getAttribute('data-has-note') === 'true',
    10000,
    '重开之后回到上次开着的那一篇',
  )
})


/**
 * 别处改了库里那篇，面板要跟着变。
 *
 * 用户在 Obsidian 编辑器里改正文、或者把笔记删了，面板不能还端着旧内容——
 * 以前只有重新点一次卡片才重读，开着的那一篇等于停在过去。宿主那边由
 * vault 事件转成 notifyVaultChange 送进来，这里守三件事：正文跟着变、
 * 自己刚存过的那一下不重复读、被删掉之后退回空态。
 */
test('别处改了库里那篇，面板跟着变；自己刚存过的不重复读', async () => {
  const { readSession } = panel.__internals
  await clickTab('笔记')
  await waitFor(() => window.document.querySelector('.dshgn_card') !== null, 8000, '列表有卡片')

  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backBtn = window.document.querySelector('.dshgn_noteBack')
  if (backBtn !== null) {
    panel.setConfirmDialog(() => Promise.resolve(true))
    backBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '先退回列表')
    panel.setConfirmDialog(null)
  }

  window.document.querySelector('.dshgn_card').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '笔记打开')
  await waitFor(() => readSession().path !== '', 5000, '记下了开着的那一篇')
  const path = readSession().path

  // 在「别处」改这篇（走服务接口写盘，绕开面板自己的保存流程）
  const written = '外部改动验收：这一段是别处写进来的。'
  const res = await fetch(server.origin + '/getnote/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({ path, content: written }),
  })
  assert.equal(res.status, 200, '写盘应该成功')
  await sleep(80)

  panel.notifyVaultChange({ kind: 'modify', path })
  await waitFor(
    () => {
      const node = window.document.querySelector('.dshgn_note')
      return node !== null && (node.textContent || '').includes('外部改动验收')
    },
    8000,
    '面板要换成外部改动之后的正文',
  )

  // 自己刚保存过（正文没变）时不重复读：再送一次同样的通知，/read 次数不该涨
  const readsBefore = fetchCalls.filter((url) => url.includes('/getnote/read')).length
  panel.notifyVaultChange({ kind: 'modify', path })
  await sleep(200)
  assert.equal(
    fetchCalls.filter((url) => url.includes('/getnote/read')).length,
    readsBefore,
    '正文没变就不该重新读一遍',
  )

  // 乱传的通知不该炸
  assert.doesNotThrow(() => {
    panel.notifyVaultChange(null)
    panel.notifyVaultChange({})
    panel.notifyVaultChange({ kind: 'modify' })
  })

  // 被删掉：退回空态，而不是继续显示一篇不存在的笔记
  panel.notifyVaultChange({ kind: 'delete', path })
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '删掉之后退回空态')
})

/**
 * 复制引用要按宿主的链接格式来。
 *
 * 用户复制引用是为了粘进另一篇笔记，所以要的是 `[[甲]]` / `[甲](路径)`，
 * 而不是喂给外部工具的绝对路径。格式由宿主决定（Wiki 还是 Markdown、路径
 * 写全还是写短），面板只负责把路径递过去。
 */
test('复制引用先问宿主的链接格式，没注入才退回绝对路径', async () => {
  const { readSession } = panel.__internals
  await clickTab('笔记')
  await waitFor(() => window.document.querySelector('.dshgn_card') !== null, 8000, '列表有卡片')

  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backBtn = window.document.querySelector('.dshgn_noteBack')
  if (backBtn !== null) {
    panel.setConfirmDialog(() => Promise.resolve(true))
    backBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '先退回列表')
    panel.setConfirmDialog(null)
  }

  window.document.querySelector('.dshgn_card').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '笔记打开')
  await waitFor(() => readSession().path !== '', 5000, '记下了开着的那一篇')
  const path = readSession().path

  const written = []
  clipboard.writeText = async (text) => { written.push(String(text)) }
  const asked = []
  panel.setMarkdownLink((p) => {
    asked.push(String(p))
    return '[[宿主给的链接]]'
  })

  const copyBtn = () => window.document.querySelector('.dshgn_iconBtn[title="复制引用"]')
  await waitFor(() => copyBtn() !== null, 5000, '笔记头上有复制引用')
  copyBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => written.length > 0, 5000, '复制到剪贴板')
  assert.equal(written[0], '[[宿主给的链接]]', '应该用宿主生成的链接，实际 ' + written[0])
  assert.deepEqual(asked, [path], '递给宿主的应该是这篇笔记的路径')

  // 宿主给不出（返回空）时退回绝对路径口径，不能复制出一段空白
  panel.setMarkdownLink(() => '')
  copyBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => written.length > 1, 5000, '第二次复制')
  assert.ok(written[1].startsWith('@') || written[1].startsWith('@"'), '应该退回 @绝对路径，实际 ' + written[1])
  assert.ok(written[1].includes(path), '绝对路径里应该有这篇的相对路径')

  // 宿主实现炸了也不该把复制弄成空
  panel.setMarkdownLink(() => { throw new Error('宿主炸了') })
  copyBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => written.length > 2, 5000, '第三次复制')
  assert.ok(written[2].includes(path), '宿主炸了也要退回绝对路径，实际 ' + written[2])

  panel.setMarkdownLink(null)
})


/**
 * 图片、录音的地址要优先走宿主自己的资源协议。
 *
 * 面板原来把附件地址拼成本地服务的 `/getnote/asset?path=...&t=令牌`：端口会变、
 * 令牌每次启动都换，每张图还要绕一圈本机 HTTP。宿主给了 `getResourcePath`
 * 就用它的地址；没给或给不出来，才退回本地服务。
 */
test('附件地址先问宿主的资源协议，问不到才退回本地服务', async () => {
  const { renderEmbed } = panel.__internals
  const embed = () => renderEmbed('图.png', 'k', { assets: [{ name: '图.png', path: '随手记/asset/图.png' }] })

  // 没注入宿主：还是本地服务地址
  const plain = embed()
  assert.ok(String(plain.props.src).includes('/getnote/asset?path='), '应该退回本地服务，实际 ' + plain.props.src)

  const asked = []
  panel.setAssetUrl((path) => {
    asked.push(String(path))
    return 'app://vault/' + path
  })
  const hosted = embed()
  assert.equal(hosted.props.src, 'app://vault/随手记/asset/图.png')
  assert.deepEqual(asked, ['随手记/asset/图.png'], '递给宿主的应该是附件的库内相对路径')

  // 宿主给不出（空串 / 非字符串）时退回本地服务，不能渲染出没有 src 的图
  panel.setAssetUrl(() => '')
  assert.ok(String(embed().props.src).includes('/getnote/asset?path='), '空串要退回本地服务')
  panel.setAssetUrl(() => 42)
  assert.ok(String(embed().props.src).includes('/getnote/asset?path='), '非字符串要退回本地服务')

  // 宿主实现炸了也不能把图弄没
  panel.setAssetUrl(() => { throw new Error('宿主炸了') })
  assert.ok(String(embed().props.src).includes('/getnote/asset?path='), '宿主炸了也要退回本地服务')

  // 认不出来的附件仍然只给文件名，不假装能预览
  assert.equal(renderEmbed('说明.pdf', 'k', {}).props.className, 'dshgn_embedFile')

  panel.setAssetUrl(null)
})

/**
 * 在 popout 窗口里开面板时，样式与快捷键都要跟过去。
 *
 * 「在新窗口中打开」的窗口有**自己的 document**：样式表、Ctrl+K 聚焦、
 * 点空白关菜单如果都只在主窗口的 document/window 上做，新窗口里的面板就是
 * 一堆没有样式的裸元素，快捷键也按不动。这里造第二个 document 挂一个面板，
 * 断言那边也有样式、快捷键也在那边生效。
 */
test('popout 窗口里的面板有自己的一份样式，快捷键也跟着窗口走', async () => {
  const { JSDOM: JSDOM2 } = await import('jsdom')
  const popout = new JSDOM2('<!doctype html><html><body><div id="popout-root"></div></body></html>', {
    url: 'app://obsidian.md/',
    pretendToBeVisual: true,
  })
  const popWindow = popout.window
  popWindow.fetch = window.fetch
  popWindow.HTMLElement.prototype.scrollTo = function scrollTo() {}
  popWindow.HTMLElement.prototype.isShown = function isShown() { return true }
  Object.defineProperty(popWindow.navigator, 'clipboard', { value: clipboard, configurable: true })

  const mount = popWindow.document.getElementById('popout-root')
  const popRoot = createRoot(mount)
  try {
    popRoot.render(React.createElement(panel.PanelRoot, {}))
    await waitFor(
      () => mount.querySelector('.dshgn_root') !== null,
      8000,
      'popout 窗口里也把面板渲染出来了',
    )

    // 样式表要各注一份：主窗口那份在新窗口里不生效
    const style = popWindow.document.getElementById('dshgn-style')
    assert.ok(style !== null, 'popout 窗口里应该有自己的一份样式表')
    assert.ok((style.textContent || '').includes('.dshgn_root'), '样式表内容应该是面板那套 CSS')

    // Ctrl+K 聚焦的应该是**这个窗口**的搜索框（搜索框要等库数据回来才渲染）
    const ownSearch = await waitFor(
      () => mount.querySelector('.dshgn_search'),
      8000,
      'popout 窗口里出现搜索框',
    )
    assert.notEqual(ownSearch, window.document.querySelector('.dshgn_search'), '不该拿到主窗口那个')
    ownSearch.blur()
    popWindow.dispatchEvent(
      new popWindow.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
    )
    await waitFor(
      () => popWindow.document.activeElement === ownSearch,
      5000,
      'popout 窗口里按 Ctrl+K 应该聚焦它自己的搜索框',
    )
  } finally {
    popRoot.unmount()
    popWindow.close()
  }
})

/**
 * 从宿主的文件树里把笔记拖到列表上 = 挪进当前筛的这个目录。
 *
 * 用户最顺手的一条路是：在 Obsidian 左边文件树里按住一篇、拖到得到大脑的列表里。
 * 面板这时只知道「有文件被拖进来了」，认路径的活儿得自己做——拖进来的是宿主的
 * 库内相对路径（带笔记子目录前缀），/batch 认的是面板口径。
 */
test('从宿主文件树拖进来的笔记会挪进当前目录，没选目录就先说一声', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')
  await clickTab('笔记')

  const post = async (path, body) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res.json()
  }
  // 目标目录里先放一篇，列表才有这个目录可点；来源那篇放库根。
  // 建出来的文件名带日期前缀（2026-11-19-xxx.md），得用它返回的真路径。
  await post('/getnote/create', { dir: '拖入验收', title: '拖入验收-目标', content: '正文', requestId: 'seed-drop-target' })
  const source = await post('/getnote/create', { dir: '', title: '拖入验收-来源', content: '正文', requestId: 'seed-drop-source' })
  const sourcePath = String(source.path || '')
  assert.ok(sourcePath.endsWith('.md'), '预置的来源笔记应该建出来了，实际 ' + JSON.stringify(source))
  const sourceName = sourcePath.split('/').pop()

  const rowOf = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  assert.ok(refreshBtn(), '应该有一个刷新按钮')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowOf('拖入验收') !== undefined, 8000, '左栏里出现新目录')
  await waitFor(() => rowOf('全部笔记') !== undefined, 8000, '左栏里有「全部笔记」')

  const dropWith = (files) => {
    const body = window.document.querySelector('.dshgn_listBody')
    assert.ok(body, '列表容器应该在')
    const event = new window.Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { files }, configurable: true })
    body.dispatchEvent(event)
  }

  // ① 还没选目录：不能瞎猜一个地方放，得告诉用户先选
  rowOf('全部笔记').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(200)
  const toastText = () => (window.document.querySelector('.dshgn_toast') || { textContent: '' }).textContent
  dropWith([{ path: '得到大脑/' + sourcePath }])
  await waitFor(() => toastText().includes('选一个目录'), 5000, '没选目录时给出提示')

  // ② 选中目录后拖进来：真的走 /batch move，路径按面板口径交出去
  rowOf('拖入验收').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(200)
  const before = fetchCalls.length
  dropWith([{ path: '得到大脑/' + sourcePath }])
  await waitFor(
    () => fetchCalls.slice(before).some((url) => url.includes('/getnote/batch')),
    8000,
    '拖动之后应该打一次批量移动',
  )

  // 挪过去了：新位置能读到，原位置读不到（保留原文件名，别改成人不认识的）
  //
  // fetchCalls 是在请求**发出时**记的，挪动本身还在路上，所以这里要轮询到真的能读到。
  const readAt = async (rel) =>
    realFetch(server.origin + '/getnote/read?path=' + encodeURIComponent(rel), {
      headers: { 'x-getnote-token': server.token },
    })
  let moved = null
  for (let attempt = 0; attempt < 60 && moved === null; attempt += 1) {
    const res = await readAt('拖入验收/' + sourceName)
    if (res.status === 200) moved = res
    else await sleep(100)
  }
  assert.ok(moved !== null, '拖进来的笔记应该出现在目标目录里')
  const gone = await realFetch(
    server.origin + '/getnote/read?path=' + encodeURIComponent(sourcePath),
    { headers: { 'x-getnote-token': server.token } },
  )
  assert.notEqual(gone.status, 200, '原位置不该还留着一份')

  // ③ 目录外的文件、非 Markdown 一律不理，别把库搅乱
  const callsBefore = fetchCalls.filter((url) => url.includes('/getnote/batch')).length
  dropWith([{ path: '别处/不相干.md' }, { path: '得到大脑/图.png' }])
  await sleep(300)
  assert.equal(
    fetchCalls.filter((url) => url.includes('/getnote/batch')).length,
    callsBefore,
    '不该为目录外或非 Markdown 的文件发批量请求',
  )

  // ④ 没有 files 的拖放不该炸（拖进来一段文字、或者别的窗口拖来的东西）
  dropWith([])
  const empty = new window.Event('drop', { bubbles: true, cancelable: true })
  window.document.querySelector('.dshgn_listBody').dispatchEvent(empty)
})

/**
 * 命令里的「打开今天的笔记」要落在用户自己配的日记位置上。
 *
 * 很多人把日记配成「得到大脑/日记/YYYY-MM-DD」。如果面板自己拼一个
 * 「得到大脑/2026-11-19.md」，同一个库里就有两个「今天」——用户在宿主里点
 * 「打开今天的日记」看到的是另一个文件，这种分裂很难自己发现。
 */
test('「今天」按宿主的日记配置落位置，没配就退回自己的日期标题', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  const pad = (n) => String(n).padStart(2, '0')
  const now = new Date()
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

  const readsAt = (rel) =>
    fetchCalls.filter(
      (url) => url.includes('/getnote/read') && url.includes(encodeURIComponent(rel)),
    ).length

  // 先把「日记/<日期>.md」造出来（宿主的日记格式，不带日期前缀），
  // 这样「今天」该打开的就是它，而不是另建一个。
  const seeded = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '日记',
      title: stamp,
      content: '今天的日记',
      withDatePrefix: false,
      requestId: 'seed-daily-note',
    }),
  })
  const seededJson = await seeded.json()
  assert.equal(seededJson.path, `日记/${stamp}.md`, '日记文件名不该被叠上日期前缀')

  // ① 宿主说「今天在 日记/<日期>.md」：面板要打开的就是这一篇
  panel.setDailyNote(() => `日记/${stamp}.md`)
  try {
    await clickTab('笔记')
    const refreshBtn = () =>
      Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
    refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
    panel.requestIntent({ type: 'today' })
    await waitFor(
      () => readsAt(`日记/${stamp}.md`) > 0,
      8000,
      '按宿主的日记配置去找今天的笔记',
    )
  } finally {
    panel.setDailyNote(null)
  }

  // ② 没配日记（问不到位置）：退回自己的日期标题按日期找。
  // 这时已经有一篇标题就是今天的，按日期认得出来——不该再建一篇重复的。
  const readsBefore = readsAt(`日记/${stamp}.md`)
  const createsBefore = fetchCalls.filter((url) => url.includes('/getnote/create')).length
  panel.requestIntent({ type: 'today' })
  await waitFor(
    () => readsAt(`日记/${stamp}.md`) > readsBefore,
    8000,
    '没配日记时按日期找回今天那篇',
  )
  assert.equal(
    fetchCalls.filter((url) => url.includes('/getnote/create')).length,
    createsBefore,
    '已经有一篇日期笔记时不该再建一篇重复的',
  )
})

test('新建笔记落在宿主指定的目录里，没指定就还落在原来的地方', async () => {
  const { readSession } = panel.__internals
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  // 上一条用例可能还开着笔记：先退回空态，免得「新建」被草稿确认挡下
  const backBtn = window.document.querySelector('.dshgn_noteBack')
  if (backBtn) {
    panel.setConfirmDialog(() => Promise.resolve(true))
    try {
      backBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
    } finally {
      panel.setConfirmDialog(null)
    }
  }

  await clickTab('笔记')
  // 先把目录选到「全部笔记」：这条验的是「没在面板里选目录时」才跟宿主走
  const allRow = Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) =>
    (el.textContent || '').includes('全部笔记'),
  )
  assert.ok(allRow, '找不到「全部笔记」那一行')
  allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const pressNew = () => {
    window.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }),
    )
  }

  // ① 宿主说「新建放在 宿主新建」：新建出来的那篇要落在那儿
  panel.setNewNotePlacement(() => '宿主新建')
  try {
    const before = readSession().path
    pressNew()
    await waitFor(() => {
      const path = readSession().path
      return path !== '' && path !== before
    }, 8000, '新建之后打开了新的一篇')
    const opened = readSession().path
    assert.match(opened, /^宿主新建\//, '新建的笔记该落在宿主指定的目录里，实际：' + opened)
  } finally {
    panel.setNewNotePlacement(null)
  }

  // ② 问不到宿主的设置：退回原来的做法（面板没选目录就落在笔记根）
  const beforeSecond = readSession().path
  pressNew()
  await waitFor(() => {
    const path = readSession().path
    return path !== '' && path !== beforeSecond
  }, 8000, '没问到时也建得出来')
  const fallback = readSession().path
  assert.ok(
    !fallback.startsWith('宿主新建/'),
    '问不到宿主设置时不该还往那个目录里放，实际：' + fallback,
  )

  // ③ 宿主给的东西不像目录（空串 / 抛错）：都不能把新建弄坏
  panel.setNewNotePlacement(() => '')
  const beforeThird = readSession().path
  pressNew()
  await waitFor(() => {
    const path = readSession().path
    return path !== '' && path !== beforeThird
  }, 8000, '宿主给空串时也建得出来')

  panel.setNewNotePlacement(() => {
    throw new Error('宿主还没准备好')
  })
  const beforeFourth = readSession().path
  pressNew()
  await waitFor(() => {
    const path = readSession().path
    return path !== '' && path !== beforeFourth
  }, 8000, '宿主抛错时也建得出来')
  panel.setNewNotePlacement(null)
})

test('面板里的图片点了交给宿主打开，没接上宿主就不假装能点', async () => {
  const { renderEmbed } = panel.__internals
  assert.ok(typeof renderEmbed === 'function', 'renderEmbed 要能取到')

  // 没注入宿主：不给光标样式，也不挂一个点了什么都不会发生的处理器
  const plain = renderEmbed('随手记/图/点图验收.png', 'k1', {})
  assert.equal(plain.props.className, 'dshgn_img')
  assert.equal(plain.props.onClick, undefined, '没接上宿主时不该挂点击处理器')

  const opened = []
  panel.setOpenAsset((path) => {
    opened.push(String(path))
    return true
  })
  try {
    const live = renderEmbed('随手记/图/点图验收.png', 'k2', {})
    assert.equal(live.props.className, 'dshgn_img dshgn_imgOpen', '能点的时候要给个「可以点」的样子')
    assert.equal(typeof live.props.onClick, 'function')
    live.props.onClick({ stopPropagation() {} })
    assert.deepEqual(opened, ['随手记/图/点图验收.png'], '交出去的应该是面板自己的路径口径')

    // 正文里的 ![[图.png]] 只写了文件名：要交给附件里的真实路径
    const hosted = renderEmbed('图.png', 'k3', {
      assets: [{ name: '图.png', path: '随手记/asset/图.png' }],
    })
    hosted.props.onClick({})
    assert.deepEqual(opened, ['随手记/图/点图验收.png', '随手记/asset/图.png'])

    // 宿主那边炸了也不能把面板带崩（点一下没反应比白屏强）
    panel.setOpenAsset(() => {
      throw new Error('宿主还没准备好')
    })
    const thrown = renderEmbed('随手记/图/点图验收.png', 'k4', {})
    assert.doesNotThrow(() => thrown.props.onClick({}))
  } finally {
    panel.setOpenAsset(null)
  }

  // 认不出来的附件仍然只给文件名，不该变成一张图
  assert.equal(renderEmbed('说明.pdf', 'k5', {}).props.className, 'dshgn_embedFile')
})

/**
 * 宿主日记插件里配了「模板文件」：新建日记时那边会把整篇填进去（标题骨架、
 * 提问、常用标签）。我们建一篇空的，同一个库里就有两种「今天的日记」——
 * 用户在宿主里新建看到有骨架，在我们这儿新建是白纸，很难不觉得是坏了。
 */
test('「今天」新建时用宿主配的日记模板，问不到就建一篇空的', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  // 上一条用例可能还开着笔记：先退回空态
  const backBtn = window.document.querySelector('.dshgn_noteBack')
  if (backBtn) {
    panel.setConfirmDialog(() => Promise.resolve(true))
    try {
      backBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await waitFor(
        () => rootNode().getAttribute('data-has-note') === 'false',
        5000,
        '退回空态',
      )
    } finally {
      panel.setConfirmDialog(null)
    }
  }

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const readAt = async (rel) =>
    realFetch(server.origin + '/getnote/read?path=' + encodeURIComponent(rel), {
      headers: { 'x-getnote-token': server.token },
    })

  // 等到某一篇真的出现在库里，把正文交回来（新建是异步的，要自己轮询）
  const waitNote = async (rel) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const res = await readAt(rel)
      if (res.status === 200) return await res.json()
      await sleep(100)
    }
    return null
  }

  const stamp = String(Date.now())

  // ① 宿主给了模板：新建出来的日记要带上模板正文
  const withTemplate = `日记/模板验收-${stamp}.md`
  panel.setDailyNote(() => withTemplate)
  panel.setDailyTemplate(() => '## 模板验收\n\n- 骨架\n')
  try {
    panel.requestIntent({ type: 'today' })
    const note = await waitNote(withTemplate)
    assert.ok(note !== null, '配了模板时也该把今天的日记建出来')
    assert.match(
      String(note.body ?? note.content ?? ''),
      /骨架/,
      '新建的日记要带上宿主配的模板正文',
    )
  } finally {
    panel.setDailyNote(null)
    panel.setDailyTemplate(null)
  }

  // ② 问模板这条路坏了（宿主还没准备好）：日记照样建得出来，只是空的
  const noTemplate = `日记/模板验收-${stamp}-空.md`
  panel.setDailyNote(() => noTemplate)
  panel.setDailyTemplate(() => {
    throw new Error('宿主还没准备好')
  })
  try {
    panel.requestIntent({ type: 'today' })
    const note = await waitNote(noTemplate)
    assert.ok(note !== null, '问不到模板时也要把日记建出来')
    assert.doesNotMatch(
      String(note.body ?? note.content ?? ''),
      /骨架/,
      '问不到模板时不该凭空造一套',
    )
  } finally {
    panel.setDailyNote(null)
    panel.setDailyTemplate(null)
  }

  // ③ 没注入宿主时 dailyTemplateOf 安静返回空串，不抛
  assert.equal(await panel.__internals.dailyTemplateOf(), '', '没接上宿主时不该有模板正文')
})


