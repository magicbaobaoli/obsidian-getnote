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

  // 接上「重命名」之后，清单里多一项：改名必须走宿主的对话框，它会把全库的
  // [[双链]] 一起改掉。我们自己 rename 文件的话，别的笔记里的引用会静默变成死链。
  const renamed = []
  panel.setRenameNote(async (path) => {
    renamed.push(String(path))
    return ''
  })
  panel.setNoteMenu((event, items) => {
    const item = items.find((one) => one.id === 'rename')
    assert.ok(item, '接上改名之后，清单里应该有「重命名」，实际 ' + items.map((one) => one.id).join(','))
    item.run()
    return true
  })
  card.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await sleep(120)
  assert.equal(renamed.length, 1, '执行这一项应该把路径交给宿主一次')
  assert.match(renamed[0], /右键菜单验收\.md$/, '交出去的是这篇的路径，实际 ' + renamed[0])

  panel.setRenameNote(null)
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
 * 宿主那条路是异步的：反链底下那行上下文要读引用方的正文，metadataCache 里没有。
 *
 * 所以面板得等它落地，而不是看见 Promise 就当「没有反链」。同时晚到的那份也得
 * 带上 snippets，否则接上宿主时反链底下永远空着一行，跟本地扫描那份长得不一样。
 */
test('宿主晚一步答的反链也落得下，答「没有」时照样退回自己扫', async () => {
  await waitFor(() => window.document.querySelector('.dshgn_root') !== null, 5000, '根节点渲染')

  // 宿主那边的 Promise 由测试攥着，想什么时候答就什么时候答。React 在开发构建里
  // 会把 effect 跑两遍（挂载 → 清理 → 再挂载），第二遍可能在我们放行之后才开始，
  // 所以放行之后改成立刻作答，否则后挂上去的那一次永远等不到答复。
  const pending = []
  let answerNow = false
  const payloadFor = (path) => ({
    target: path,
    host: true,
    hits: [
      {
        path: '别处的笔记.md',
        title: '别处的笔记',
        links: [path],
        count: 2,
        snippets: ['开会时记到这一段'],
      },
    ],
  })
  panel.setVaultGraph((path, kind) => {
    if (kind !== 'backlinks') return null
    if (answerNow) return Promise.resolve(payloadFor(path))
    return new Promise((resolve) => pending.push(() => resolve(payloadFor(path))))
  })
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    await clickTab('云端')
    await clickTab('笔记')
    const card = await waitFor(
      () =>
        Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) =>
          (el.textContent || '').includes('右键菜单验收'),
        ),
      5000,
    )
    // 前面几个用例可能把它开着，先退回空态，否则这一下点的是「收起」
    const close = window.document.querySelector('.dshgn_noteBack')
    if (close) close.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(
      () => window.document.querySelector('.dshgn_root').getAttribute('data-has-note') === 'false',
      5000,
      '先退回空态',
    )
    card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

    await waitFor(() => pending.length > 0, 5000, '面板应该向宿主问过反链')
    assert.equal(
      window.document.querySelector('.dshgn_backlinkItem'),
      null,
      '宿主还没答，就先别拿旧的反链顶上',
    )

    answerNow = true
    for (const answer of pending) answer()
    const item = await waitFor(
      () => window.document.querySelector('.dshgn_backlinkItem'),
      5000,
      '晚到的反链也要落下来',
    )
    assert.ok((item.textContent || '').includes('别处的笔记'), '要显示宿主给的标题')
    const snip = await waitFor(
      () => window.document.querySelector('.dshgn_backlinkSnip'),
      5000,
      '晚到的反链也要带上下文',
    )
    assert.ok((snip.textContent || '').includes('开会时记到'), '上下文要显示出来')

    // 宿主说「我这儿没有」时，跟问不到一样退回自己扫，不能因为异步就静默空白
    panel.setVaultGraph((path, kind) => (kind === 'backlinks' ? Promise.resolve(null) : null))
    const closeAgain = window.document.querySelector('.dshgn_noteBack')
    closeAgain.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(
      () => window.document.querySelector('.dshgn_root').getAttribute('data-has-note') === 'false',
      5000,
      '先收起这一篇',
    )
    const before = fetchCalls.filter((url) => url.includes('/backlinks')).length
    // 同一篇刚被收起又点开，effect 的依赖是路径，不一定重新跑——先换一篇再换回来
    await clickTab('云端')
    await clickTab('笔记')
    card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(
      () => fetchCalls.filter((url) => url.includes('/backlinks')).length > before,
      5000,
      '宿主给空时要退回自己扫',
    )
  } finally {
    panel.setVaultGraph(null)
    panel.setConfirmDialog(null)
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
 * 改名必须走宿主的对话框。
 *
 * 宿主改名时会顺手把全库的 [[双链]] 一起改掉；我们自己 rename 文件的话，
 * 别的笔记里的引用会静默变成死链，几个月后才有人发现。所以这里守两件事：
 * 笔记头那个按钮真的把路径交给宿主；有没保存的改动时先拦住，别让刚敲的
 * 那几句跟着旧文件一起没了。
 */
test('改名交给宿主的对话框，有没保存的改动就先拦住', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const toastText = () => (window.document.querySelector('.dshgn_toast') || { textContent: '' }).textContent
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')
  await clickTab('笔记')
  await waitFor(() => window.document.querySelector('.dshgn_card') !== null, 8000, '列表有卡片')

  // 上一条用例可能还开着笔记：先退回空态，再从卡片打开，路径才确定
  const back = window.document.querySelector('.dshgn_noteBack')
  if (back) {
    panel.setConfirmDialog(() => Promise.resolve(true))
    try {
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
    } finally {
      panel.setConfirmDialog(null)
    }
  }

  window.document.querySelector('.dshgn_card').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '笔记打开')
  // 卡片顺序会随排序变，所以不写死名字：改的就是当前开着的那一篇
  const { readSession } = panel.__internals
  await waitFor(() => readSession().path !== '', 5000, '打开之后要记下是哪一篇')
  const openPath = readSession().path

  const renamed = []
  // 笔记头那个按钮是渲染时按「有没有接上宿主」决定挂不挂的，所以要先接上、
  // 再让它重画一遍（切到别的页签再切回来）。真实插件里这一步在 onload 就做完了。
  panel.setRenameNote(async (path) => {
    renamed.push(String(path))
    // 返回空串：宿主那边取消了（或没接上），面板不该继续动
    return ''
  })
  try {
    await clickTab('设置')
    await sleep(120)
    await clickTab('笔记')
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '切回笔记后还是开着那篇')

    const renameBtn = () =>
      Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '重命名')
    assert.ok(renameBtn(), '接上宿主之后笔记头上应该有改名按钮')
    renameBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => renamed.length === 1, 5000, '改名按钮把路径交给宿主')
    assert.equal(renamed[0], openPath, '交出去的是当前开着那一篇的路径，实际 ' + renamed[0])

    // 有没保存的改动：先拦住，不再往宿主那边走。
    // 编辑态下笔记头只留保存/取消，所以这一下走列表里那张卡片的右键菜单。
    const editBtn = () =>
      Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '编辑')
    editBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    const area = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '进入编辑态')
    area.value = '改名验收：这段还没保存'
    area.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(80)

    const card = Array.from(window.document.querySelectorAll('.dshgn_card')).find(
      (el) => el.getAttribute('title') === openPath,
    )
    assert.ok(card, '列表里应该有当前开着那一篇的卡片，实际 ' + openPath)
    panel.setNoteMenu((event, items) => {
      const item = items.find((one) => one.id === 'rename')
      assert.ok(item, '接上改名之后清单里应该有「重命名」')
      item.run()
      return true
    })
    card.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await waitFor(() => /先保存/.test(toastText()), 5000, '有草稿时先提示保存')
    assert.equal(renamed.length, 1, '有没保存的改动时不该把路径交给宿主')
    panel.setNoteMenu(null)

    // 退出编辑态，别把草稿留给后面的用例
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await waitFor(() => window.document.querySelector('.dshgn_editor') === null, 5000, 'Esc 退出编辑态')
  } finally {
    panel.setRenameNote(null)
  }
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



/**
 * 双链可以带小节：`[[笔记#小节]]`、`[[#本页的小节]]`。宿主里点这种链接会直接
 * 滚到那一节；我们原来把整串 `笔记#小节` 当路径递过去，宿主找不到这一篇，于是
 * 无论点多准都只会得到「库里找不到」。这条把两种写法都走一遍。
 */
test('双链带小节时跳到那一节，找不到就明说', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

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

  const seed = async (title, content, requestId) => {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '随手记', title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    assert.equal(json.path, `随手记/${title}.md`, '这条要按真路径测，不能靠猜文件名')
    return json.path
  }

  const target = await seed('锚点目标', '## 乙节\n\n被跳到的地方\n', 'seed-anchor-target')
  const source = await seed(
    '锚点来源',
    '## 第一节\n\n开头\n\n## 第二节\n\n跳到 [[#第二节]]\n\n还有 [[锚点目标#乙节]]\n\n坏链 [[#没有这一节]]\n',
    'seed-anchor-source',
  )

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const card = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_card')).find(
        (el) => el.getAttribute('title') === source,
      ),
    5000,
    '来源笔记出现在列表里',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  // 空态里也有 .dshgn_note（写着「选一篇笔记开始阅读」），所以要等正文本身出现
  await waitFor(
    () => ((window.document.querySelector('.dshgn_note') || {}).textContent || '').includes('跳到'),
    5000,
    '来源笔记打开了',
  )

  // jsdom 的 scrollTo 是个空实现：换成能记账的版本，才看得出到底滚没滚
  const scrollCalls = []
  const originalScrollTo = window.HTMLElement.prototype.scrollTo
  window.HTMLElement.prototype.scrollTo = function scrollTo(options) {
    scrollCalls.push(options)
  }
  try {
    const wikilink = (text) =>
      Array.from(window.document.querySelectorAll('.dshgn_wikilink')).find(
        (el) => (el.textContent || '').trim() === text,
      )

    // ① 本节里的锚点：显示成「第二节」，点了要滚
    const sameNote = await waitFor(() => wikilink('第二节'), 5000, '本页小节的双链')
    sameNote.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => scrollCalls.length > 0, 3000, '滚到那一节')
    assert.equal(typeof scrollCalls[0].top, 'number', '滚的是一个具体位置，不是瞎滚')

    // ② 跨笔记的锚点：先打开那一篇，再滚过去
    const crossNote = await waitFor(() => wikilink('锚点目标 › 乙节'), 5000, '跨笔记小节的双链')
    const before = scrollCalls.length
    crossNote.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    const opened = await waitFor(
      () => {
        const el = window.document.querySelector('.dshgn_note')
        if (!el) return null
        return (el.textContent || '').includes('被跳到的地方') ? el : null
      },
      5000,
      '打开了被链到的那一篇',
    )
    assert.ok(opened, '跨笔记锚点要真的打开那一篇')
    await waitFor(() => scrollCalls.length > before, 3000, '打开之后再滚到那一节')

    // ③ 锚点写错了：明说这一节不存在，不要静默不动
    refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
    const backToSource = await waitFor(
      () =>
        Array.from(window.document.querySelectorAll('.dshgn_card')).find(
          (el) => el.getAttribute('title') === source,
        ),
      5000,
      '回到来源笔记',
    )
    backToSource.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    const bad = await waitFor(() => wikilink('没有这一节'), 5000, '坏链')
    bad.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    const alert = await waitFor(
      () => window.document.querySelector('.dshgn_error'),
      3000,
      '找不到这一节时说一声',
    )
    assert.match(alert.textContent || '', /没有这一节/, '提示里要说清是哪一节找不到')
  } finally {
    window.HTMLElement.prototype.scrollTo = originalScrollTo
    panel.setLinkResolve(null)
    panel.setVaultGraph(null)
  }
})

/**
 * 出链：这篇自己引用了谁。
 *
 * 反链区回答「谁提到我」，出链回答「我提到过谁」，两个方向合起来才是用户
 * 脑子里的那张网。出链优先问宿主的 metadataCache（它认得别名和竖线前那段），
 * 问不到就用 /read 载荷里那份本地正则的结果，重复项要合掉。
 */
test('这篇引用了谁也能看见，先问宿主的索引', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

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

  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '出链验收',
      content: '见 [[甲]] 和 [[甲]] 还有 [[乙|别名]]\n',
      withDatePrefix: false,
      requestId: 'seed-outlinks',
    }),
  })
  const json = await res.json()
  const notePath = json.path
  assert.equal(notePath, '随手记/出链验收.md', '这条要按真路径测，不能靠猜文件名')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const card = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_card')).find(
        (el) => el.getAttribute('title') === notePath,
      ),
    5000,
    '出链笔记出现在列表里',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => ((window.document.querySelector('.dshgn_note') || {}).textContent || '').includes('见'),
    5000,
    '出链笔记打开了',
  )

  const chipTexts = () =>
    Array.from(window.document.querySelectorAll('.dshgn_outlinkChip')).map((el) =>
      (el.textContent || '').trim(),
    )

  try {
    // ① 没接宿主：用 /read 载荷里那份本地正则的结果，重复项合掉
    const local = await waitFor(() => (chipTexts().length > 0 ? chipTexts() : null), 5000, '出链胶囊出现')
    assert.deepEqual(local, ['甲', '乙'], '同一篇写两遍要合掉，别名只留目标那一段，实际：' + local.join(','))
    assert.ok(
      (window.document.querySelector('.dshgn_outlinksHead') || {}).textContent.includes('2'),
      '标题上要标出条数',
    )

    // ② 接上宿主：以 metadataCache 为准（它认得别名与竖线前那段）
    const asked = []
    panel.setVaultGraph((path, kind) => {
      asked.push(kind + ':' + path)
      if (kind !== 'links') return null
      return { target: path, links: ['宿主说的这一篇'], host: true }
    })
    // 关掉再打开一次就够了：出链是在「打开一篇笔记」时算的，刷新按钮在列表
    // 头上，开着笔记的时候根本不在 DOM 里。
    const back = window.document.querySelector('.dshgn_noteBack')
    assert.ok(back, '笔记头上应该有返回列表的按钮')
    panel.setConfirmDialog(() => Promise.resolve(true))
    try {
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
    } finally {
      panel.setConfirmDialog(null)
    }
    const again = await waitFor(
      () =>
        Array.from(window.document.querySelectorAll('.dshgn_card')).find(
          (el) => el.getAttribute('title') === notePath,
        ),
      5000,
      '重新打开出链笔记',
    )
    again.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    const hosted = await waitFor(
      () => (chipTexts().includes('宿主说的这一篇') ? chipTexts() : null),
      5000,
      '出链以宿主给的为准',
    )
    assert.ok(hosted.includes('宿主说的这一篇'), '要显示宿主给的出链')
    assert.ok(asked.some((entry) => entry.startsWith('links:')), '应该问过宿主的出链')

    // ③ 点胶囊要能打开那一篇（这里让它解析失败，走的是同一套双链逻辑）
    const opened = []
    panel.setLinkResolve((linkpath) => {
      opened.push(linkpath)
      return ''
    })
    const chip = window.document.querySelector('.dshgn_outlinkChip')
    chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => opened.length > 0, 3000, '点胶囊走双链解析')
    assert.equal(opened[0], '宿主说的这一篇', '递过去的是链接原文')
  } finally {
    panel.setVaultGraph(null)
    panel.setLinkResolve(null)
  }
})

/**
 * 宿主会把 `![[另一篇笔记]]` 渲染成那一篇的正文（连标题一起）。我们原来只给
 * 一颗文件名胶囊——点了能跳过去，但「在这儿引用一段别处的内容」没做到，对比
 * 两篇得来回切。
 */
test('正文里嵌入的另一篇笔记真的把内容嵌进来，只嵌一层', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

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

  const seed = async (title, content, requestId) => {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '随手记', title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    assert.equal(json.path, '随手记/' + title + '.md', '这条要按真路径测，不能靠猜文件名')
    return json.path
  }

  await seed('嵌入更深', '不该出现的内容\n', 'seed-embed-deep')
  await seed('嵌入目标', '## 目标的小节\n\n目标里的正文\n\n![[嵌入更深]]\n', 'seed-embed-target')
  const sourcePath = await seed('嵌入来源', '开头\n\n![[嵌入目标]]\n\n![[说明.pdf]]\n\n结尾\n', 'seed-embed-source')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const card = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_card')).find(
        (el) => el.getAttribute('title') === sourcePath,
      ),
    5000,
    '来源笔记出现在列表里',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => ((window.document.querySelector('.dshgn_note') || {}).textContent || '').includes('开头'),
    5000,
    '来源笔记打开了',
  )

  // ① 嵌入框真的出现了，里面是那一篇的正文
  const embed = await waitFor(
    () => window.document.querySelector('.dshgn_noteEmbed'),
    5000,
    '嵌入框出现',
  )
  await waitFor(
    () => ((embed.querySelector('.dshgn_embedBody') || {}).textContent || '').includes('目标里的正文'),
    5000,
    '嵌入框里是那一篇的正文',
  )
  const head = embed.querySelector('.dshgn_embedTitle')
  assert.equal((head.textContent || '').trim(), '嵌入目标', '标题用那一篇的名字')
  assert.equal(head.getAttribute('title'), '打开这一篇', '标题按钮要说清点了会怎样')

  // ② 只嵌一层：嵌进来的那篇里再嵌一篇，只留文件名，不会一路读下去
  const bodyText = (embed.querySelector('.dshgn_embedBody') || {}).textContent || ''
  assert.ok(bodyText.includes('嵌入更深'), '再往下那一层要留成文件名')
  assert.ok(!bodyText.includes('不该出现'), '只嵌一层，别把整棵树都拉进来')
  assert.equal(
    window.document.querySelectorAll('.dshgn_noteEmbed').length,
    1,
    '整篇正文里只该有一个嵌入框',
  )

  // ③ 不是笔记的东西仍然只是文件名胶囊（![[说明.pdf]]）
  const fileName = Array.from(window.document.querySelectorAll('.dshgn_embedFile')).map((el) =>
    (el.textContent || '').trim(),
  )
  // 「嵌入更深」也在里面：那是第二层降级成的文件名胶囊（见上一条断言）
  assert.deepEqual(fileName, ['嵌入更深', '说明.pdf'], '附件不该被当成笔记去读，实际：' + fileName.join(','))

  // ④ 渲染器层面：解析得出路径才嵌，解析不出来还是文件名
  const { renderEmbed } = panel.__internals
  const embedded = renderEmbed('嵌入目标', 'k-embed', {
    resolveNote: () => '随手记/嵌入目标.md',
    embedDepth: 0,
  })
  assert.equal(typeof embedded.type, 'function', '解析得出路径时要换成嵌入组件')
  const unresolved = renderEmbed('没有这一篇', 'k-embed2', { resolveNote: () => '', embedDepth: 0 })
  assert.equal(unresolved.props.className, 'dshgn_embedFile', '解析不出来就还是文件名')
  const tooDeep = renderEmbed('嵌入更深', 'k-embed3', {
    resolveNote: () => '随手记/嵌入更深.md',
    embedDepth: 1,
  })
  assert.equal(tooDeep.props.className, 'dshgn_embedFile', '第二层不再嵌')
})

/**
 * 宿主里把文件拖进编辑器就存进附件目录、正文里多一行 ![[图.png]]；截图之后
 * Ctrl+V 也一样。面板以前什么都不做——用户以为图存进去了，其实盘上没有，
 * 正文里只有一串文件名。
 */
test('拖进来 / 粘进来的文件存成附件并在正文里留下引用', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

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

  const createRes = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '附件验收',
      content: '正文开头\n',
      withDatePrefix: false,
      requestId: 'seed-attach',
    }),
  })
  const created = await createRes.json()
  assert.equal(created.path, '随手记/附件验收.md')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const card = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_card')).find(
        (el) => el.getAttribute('title') === created.path,
      ),
    5000,
    '笔记出现在列表里',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => ((window.document.querySelector('.dshgn_note') || {}).textContent || '').includes('正文开头'),
    5000,
    '笔记打开了',
  )

  const readNote = async () => {
    const res = await realFetch(
      server.origin + '/getnote/read?path=' + encodeURIComponent(created.path),
      { headers: { 'x-getnote-token': server.token } },
    )
    return res.json()
  }

  // 造一个「拖进来的文件」：只用到 name 与 arrayBuffer，跟浏览器给的 File 同形
  const fakeFile = (name, bytes) => ({
    name,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  })
  const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])

  // ① 把文件拖到笔记正文上
  const note = window.document.querySelector('.dshgn_note')
  assert.ok(note.className.includes('dshgn_noteDrop'), '接上插入能力之后笔记区要认这个手势')
  const dropEvent = new window.Event('drop', { bubbles: true, cancelable: true })
  dropEvent.dataTransfer = { files: [fakeFile('截图.png', pngBytes)] }
  note.dispatchEvent(dropEvent)

  await waitFor(
    () => {
      const toast = window.document.querySelector('.dshgn_toast')
      return toast !== null && (toast.textContent || '').includes('附件已插入')
    },
    5000,
    '拖进来之后有提示',
  )

  // 等落盘：正文里出现 ![[...]]，附件也在列表里
  let savedNote = null
  for (let attempt = 0; attempt < 60 && savedNote === null; attempt += 1) {
    const json = await readNote()
    const assets = Array.isArray(json.assets) ? json.assets : []
    if (String(json.content || '').includes('![[') && assets.length > 0) savedNote = json
    else await sleep(100)
  }
  assert.ok(savedNote !== null, '拖进来的文件要真的落盘')
  assert.ok(
    savedNote.content.includes('![[附件验收_截图.png]]'),
    '正文里留的是带笔记主干前缀的附件名，实际：' + savedNote.content,
  )
  const imageAsset = (savedNote.assets || []).find((a) => a.kind === 'image')
  assert.ok(imageAsset !== undefined, '附件列表里要能看见它，否则用户会再拖一次')
  assert.equal(imageAsset.name, '附件验收_截图.png')

  // ② 截图之后直接 Ctrl+V：编辑态下的 textarea 接住剪贴板里的图
  const editBtn = Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find(
    (el) => el.title === '编辑',
  )
  assert.ok(editBtn !== undefined, '笔记头上要有编辑按钮')
  editBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const editor = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '进编辑态')

  const pasteEvent = new window.Event('paste', { bubbles: true, cancelable: true })
  pasteEvent.clipboardData = { files: [fakeFile('粘贴.png', pngBytes)] }
  editor.dispatchEvent(pasteEvent)

  await waitFor(
    () => ((window.document.querySelector('.dshgn_editor') || {}).value || '').includes('粘贴.png'),
    5000,
    '粘进来的图写进了草稿',
  )
  const draftText = window.document.querySelector('.dshgn_editor').value
  assert.ok(draftText.includes('![[附件验收_粘贴.png]]'), '草稿里是附件引用，实际：' + draftText)
  assert.ok(draftText.includes('正文开头'), '原有内容不能被冲掉')
  assert.equal(
    window.document.querySelector('.dshgn_root').getAttribute('data-has-note'),
    'true',
    '有没保存的草稿时不该把面板搞乱',
  )

  // 退出编辑态，别把草稿状态留给后面的用例
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(120)
})

/**
 * 嵌进来的那一篇也可以带小节：`![[笔记#小节]]`。宿主会把那一篇嵌进来并停在那一节，
 * 我们原来嵌是嵌了、但永远从第一行开始——用户想看的偏偏是中间那一段。
 * `![[#本节]]` 更极端：它压根没有「另一篇」可嵌，只有「滚到这一篇的这一节」。
 */
test('嵌进来的笔记能停在小节上，本节的小节直接滚过去', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

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

  const seed = async (title, content, requestId) => {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '随手记', title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    assert.equal(json.path, `随手记/${title}.md`, '这条要按真路径测，不能靠猜文件名')
    return json.path
  }

  await seed('嵌入锚点目标', '## 甲节\n\n甲里的正文\n\n## 乙节\n\n乙里的正文\n', 'seed-embed-anchor-target')
  const source = await seed(
    '嵌入锚点来源',
    '## 第一节\n\n本节开头\n\n跳到 ![[#第一节]]\n\n还有 ![[嵌入锚点目标#乙节]]\n',
    'seed-embed-anchor-source',
  )

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const card = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_card')).find(
        (el) => el.getAttribute('title') === source,
      ),
    5000,
    '来源笔记出现在列表里',
  )

  const scrollCalls = []
  const originalScrollTo = window.HTMLElement.prototype.scrollTo
  window.HTMLElement.prototype.scrollTo = function scrollTo(options) {
    scrollCalls.push(options)
  }
  try {
    card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(
      () => ((window.document.querySelector('.dshgn_note') || {}).textContent || '').includes('本节开头'),
      5000,
      '来源笔记打开了',
    )

    // ① 嵌进来的那一篇停在乙节上：嵌入框自己不是滚动容器，滚的是外面那层
    const embed = await waitFor(
      () => window.document.querySelector('.dshgn_noteEmbed'),
      5000,
      '嵌入框出现',
    )
    await waitFor(
      () => ((embed.querySelector('.dshgn_embedBody') || {}).textContent || '').includes('乙里的正文'),
      5000,
      '嵌入框里是那一篇的正文',
    )
    await waitFor(() => scrollCalls.length > 0, 3000, '嵌进来的那一篇也要滚到它那一节')
    assert.equal(typeof scrollCalls[0].top, 'number', '滚的是一个具体位置，不是瞎滚')

    // ② 本节的小节：没有另一篇可嵌，点一下就该滚过去
    const sameNote = await waitFor(
      () =>
        Array.from(window.document.querySelectorAll('.dshgn_wikilink')).find(
          (el) => (el.textContent || '').trim() === '第一节',
        ),
      5000,
      '本节小节的双链',
    )
    const before = scrollCalls.length
    sameNote.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => scrollCalls.length > before, 3000, '本节的小节也要滚过去')

    // ③ 渲染器层面：小节要一路递到嵌入组件上，不能半路丢掉
    const { renderEmbed } = panel.__internals
    const withAnchor = renderEmbed('嵌入锚点目标', 'k-anchor', {
      resolveNote: () => '随手记/嵌入锚点目标.md',
      embedDepth: 0,
      anchor: '乙节',
    })
    assert.equal(typeof withAnchor.type, 'function', '解析得出路径时要换成嵌入组件')
    assert.equal(withAnchor.props.anchor, '乙节', '小节要递给嵌入组件，否则它只会从头显示')
    const noAnchor = renderEmbed('嵌入锚点目标', 'k-anchor2', {
      resolveNote: () => '随手记/嵌入锚点目标.md',
      embedDepth: 0,
    })
    assert.equal(noAnchor.props.anchor, '', '没写小节就是空串，别拿 undefined 往下传')
  } finally {
    window.HTMLElement.prototype.scrollTo = originalScrollTo
    panel.setLinkResolve(null)
    panel.setVaultGraph(null)
  }
})


/**
 * 设置页里的「面板跟着我翻」。
 *
 * 这个开关默认是关的：面板自己动，得用户点头。所以这条守三件事——卡片真的
 * 在设置页里、勾上之后设置真的落盘（/settings 读回来是 true）、再点一下能关掉。
 * 光有卡片不写设置，等于给用户一个假开关。
 */
test('设置页里的跟随开关真的写进设置', async () => {
  await clickTab('设置')

  const followBox = await waitFor(
    () => {
      const labels = Array.from(window.document.querySelectorAll('label'))
      const row = labels.find((el) => (el.textContent || '').includes('面板跟着我翻'))
      return row ? row.querySelector('input[type="checkbox"]') : null
    },
    5000,
    '设置页里应该有跟随开关',
  )
  assert.equal(followBox.checked, false, '默认是关的，面板不该自己跟着动')

  followBox.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => followBox.checked === true, 5000, '点一下应该勾上')

  const readSettings = async () => {
    const res = await fetch(server.origin + '/getnote/settings', {
      headers: { 'x-getnote-token': server.token },
    })
    assert.equal(res.status, 200)
    return res.json()
  }
  let saved = null
  for (let i = 0; i < 60; i += 1) {
    saved = await readSettings()
    if (saved.followActive === true) break
    await sleep(50)
  }
  assert.equal(saved.followActive, true, '勾上之后设置里应该是 true')

  // 再点一下关掉：开关不能是单向的。
  // 等第一笔写完再点——保存途中 input 是 disabled 的，点下去等于没点。
  for (let i = 0; i < 60; i += 1) {
    if (followBox.disabled === false) break
    await sleep(50)
  }
  followBox.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  for (let i = 0; i < 120; i += 1) {
    saved = await readSettings()
    if (saved.followActive === false) break
    await sleep(50)
  }
  assert.equal(saved.followActive, false, '再点一下应该关掉')

  // 后面的用例默认停在笔记页
  await clickTab('笔记')
})

/**
 * 阅读态的属性区。
 *
 * 面板以前完全不显示 frontmatter——用户在 Obsidian 里写的 tags、aliases、
 * 自定义字段，回到面板里一眼都看不到，还以为没存上。这条守三件事：头部真的
 * 摊出来、标签做成可点的胶囊（点了去左栏筛这个标签）、没有头部的笔记不出现
 * 一个空框。
 */
test('笔记头部的属性摊在正文上方，标签点一下就去筛', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

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

  const seed = async (title, content, requestId) => {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '随手记', title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    assert.equal(json.path, '随手记/' + title + '.md')
    return json.path
  }

  // 有头部的一篇：tags 数组 + 自定义字段 + 空数组（空的那个不该占一行）
  const withProps = await seed(
    '属性验收',
    ['---', 'tags: [甲, 乙]', 'aliases: [别名一]', '来源: 得到大脑', '空着: []', '---', '', '# 属性验收', '', '正文在这里', ''].join('\n'),
    'seed-props',
  )
  // 没头部的一篇：整块属性区都不该出现
  const noProps = await seed('无属性验收', '# 无属性验收\n\n只有正文\n', 'seed-props-none')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const openCard = async (path, marker) => {
    const card = await waitFor(
      () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === path),
      5000,
      '笔记出现在列表里：' + path,
    )
    card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(
      () => ((window.document.querySelector('.dshgn_note') || {}).textContent || '').includes(marker),
      5000,
      '笔记打开了：' + path,
    )
  }

  await openCard(withProps, '正文在这里')

  // ① 属性区在，键值都摊出来了
  const props = await waitFor(() => window.document.querySelector('.dshgn_props'), 5000, '属性区出现')
  const keys = Array.from(props.querySelectorAll('.dshgn_propKey')).map((el) => (el.textContent || '').trim())
  assert.deepEqual(keys, ['tags', 'aliases', '来源'], '空值的键不该占一行')
  const propText = props.textContent || ''
  assert.ok(propText.includes('来源'), '自定义字段也要列出来')
  assert.ok(propText.includes('得到大脑'), '自定义字段的值要跟着列出来')
  assert.ok(!propText.includes('空着'), '空数组写了等于没写，不该占一行')

  // ② 标签是可点的胶囊，点一下就去左栏筛这个标签
  const tagButtons = Array.from(props.querySelectorAll('.dshgn_propTag')).map((el) => (el.textContent || '').trim())
  assert.deepEqual(tagButtons, ['甲', '乙'], '标签要拆成一颗颗胶囊')
  tagButtons.length = 0
  const firstTag = props.querySelector('.dshgn_propTag')
  firstTag.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => {
      const rows = Array.from(window.document.querySelectorAll('.dshgn_tagRow'))
      return rows.some((el) => el.getAttribute('data-on') === 'true' && (el.textContent || '').includes('甲'))
    },
    5000,
    '点标签应该去左栏筛这个标签',
  )

  // ③ 先把这个标签筛掉，否则列表里只剩带「甲」的那篇
  const tagRow = Array.from(window.document.querySelectorAll('.dshgn_tagRow')).find((el) =>
    (el.textContent || '').includes('甲'),
  )
  tagRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_tagRow')).every((el) => el.getAttribute('data-on') !== 'true'),
    5000,
    '再点一下应该把标签筛掉',
  )

  // ④ 没有头部的笔记：不出现一个空框
  await openCard(noProps, '只有正文')
  assert.equal(window.document.querySelector('.dshgn_props'), null, '没有头部就不该出现空的属性区')

  // ④ 渲染器层面：值的形状要认得全，别把数组渲染成 [object Object]
  const { frontmatterText, isTagKey } = panel.__internals
  assert.equal(frontmatterText(['甲', '乙']), '甲 · 乙', '数组用 · 连起来，和卡片摘要里标签的连法一致')
  assert.equal(frontmatterText(''), '', '空串就是空串，不该变成一行空白')
  assert.equal(frontmatterText(null), '')
  assert.equal(frontmatterText(undefined), '')
  assert.equal(frontmatterText(3), '3', '数字也要能显示')
  assert.ok(frontmatterText({ a: 1 }).includes('a'), '对象退成 JSON，别显示 [object Object]')
  assert.equal(isTagKey('tags'), true)
  assert.equal(isTagKey('Tags'), true, '大小写不该影响判断')
  assert.equal(isTagKey('来源'), false)
})

/**
 * 别名（`aliases: [读书笔记]`）。
 *
 * 宿主按别名解析双链：写了别名之后 `[[读书笔记]]` 就指到这一篇。面板以前只比
 * 文件名和标题，于是同一个链接在宿主里点得开、在面板里报「库里找不到」。
 * 这条守两件事：正文里 `![[别名]]` 嵌得进来、点双链跳得过去。
 */
test('双链写的是别名时也指得到那一篇', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

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

  const seed = async (title, content, requestId) => {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '随手记', title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    assert.equal(json.path, '随手记/' + title + '.md')
    return json.path
  }

  // 目标那篇：标题和文件名都不是「读书笔记」，只有别名是
  const target = await seed(
    '别名目标',
    ['---', 'aliases: [读书笔记]', '---', '', '# 别名目标', '', '别名指向的正文', ''].join('\n'),
    'seed-alias-target',
  )
  const source = await seed(
    '别名来源',
    ['# 别名来源', '', '见 [[读书笔记]]', '', '还有 ![[读书笔记]]', ''].join('\n'),
    'seed-alias-source',
  )

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const card = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === source),
    5000,
    '来源笔记出现在列表里',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => ((window.document.querySelector('.dshgn_note') || {}).textContent || '').includes('别名来源'),
    5000,
    '来源笔记打开了',
  )

  // ① 别名也嵌得进来
  await waitFor(
    () => {
      const box = window.document.querySelector('.dshgn_noteEmbed')
      return box !== null && ((box.querySelector('.dshgn_embedBody') || {}).textContent || '').includes('别名指向的正文')
    },
    5000,
    '别名也要能嵌进来',
  )

  // ② 点 [[读书笔记]] 跳到目标那篇
  const link = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_wikilink')).find(
        (el) => (el.textContent || '').trim() === '读书笔记',
      ),
    5000,
    '正文里的别名双链',
  )
  link.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  // 认「换没换到那一篇」要看笔记头上的路径：嵌入框里本来就有目标那篇的正文，
  // 拿正文当证据的话，链接没跳也会被嵌进来的那段文字骗过去。
  await waitFor(
    () => ((window.document.querySelector('.dshgn_notePath') || {}).textContent || '') === target,
    5000,
    '点别名应该打开目标那篇',
  )
  // 笔记头上写的就是当前打开的那一篇：嵌入框里本来就有目标那篇的正文，
  // 光看正文会被嵌进来的那段文字骗过去，得看笔记头。
  assert.equal(
    (window.document.querySelector('.dshgn_notePath') || {}).textContent,
    target,
    '打开的是别名指向的那一篇，不是别的同名笔记',
  )
})

/**
 * 「返回列表」不该悄悄扔掉草稿。
 *
 * 收起来之后草稿就没了，而用户往往只是想看一眼列表。这条守：有未保存改动时
 * 先问一句、说「不要」就一步都不走。
 */
test('有没保存的草稿时，返回列表先问一句', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

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

  const createRes = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '草稿拦截验收',
      content: '# 草稿拦截验收\n\n正文\n',
      withDatePrefix: false,
      requestId: 'seed-draft-guard',
    }),
  })
  const created = await createRes.json()
  assert.equal(created.path, '随手记/草稿拦截验收.md')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)
  const card = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === created.path),
    5000,
    '笔记出现在列表里',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => rootNode().getAttribute('data-has-note') === 'true',
    5000,
    '笔记打开了',
  )

  // 进编辑态改一个字，制造草稿。按钮要按所在的笔记头找——
  // 页面上别的地方也可能有一个 title 叫「编辑」的图标按钮。
  const editBtn = await waitFor(
    () => {
      const head = window.document.querySelector('.dshgn_noteHead')
      if (head === null) return null
      return Array.from(head.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '编辑') || null
    },
    5000,
    '笔记头上有编辑按钮',
  )
  editBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const editor = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '编辑区出现')
  const proto = window.HTMLTextAreaElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(editor, editor.value + '\n改了一笔')
  editor.dispatchEvent(new window.Event('input', { bubbles: true }))
  await waitFor(
    () => ((window.document.querySelector('.dshgn_note') || {}).textContent || '').includes('有未保存的修改'),
    5000,
    '草稿被认出来了',
  )

  // 问框说「不要」：笔记不该被收起来
  const asked = []
  panel.setConfirmDialog((message) => {
    asked.push(message)
    return Promise.resolve(false)
  })
  try {
    const back = await waitFor(() => window.document.querySelector('.dshgn_noteBack'), 5000, '返回列表按钮')
    back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => asked.length > 0, 5000, '有草稿时应该先问一句')
    assert.equal(rootNode().getAttribute('data-has-note'), 'true', '说了「不要」就不该收起来')
    // 说「要」才收起来
    panel.setConfirmDialog(() => Promise.resolve(true))
    back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '说了「要」就收起来')
  } finally {
    panel.setConfirmDialog(null)
  }
})
/**
 * 反链底下那一行上下文。
 *
 * 一篇笔记里可能三处都提到同一篇。只给「它引用了我」和路径的话，用户还得
 * 自己点进去、再在正文里搜一遍。这条守：/backlinks 给的 snippets 真的画出来。
 */
test('反链底下带上引用那一行的上下文', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

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

  const seed = async (title, content, requestId) => {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '随手记', title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    assert.equal(json.path, '随手记/' + title + '.md')
    return json.path
  }

  const target = await seed('反链上下文目标', '# 反链上下文目标\n\n正文\n', 'seed-bl-snip-target')
  await seed(
    '反链上下文来源',
    ['# 反链上下文来源', '', '开会时记到 [[反链上下文目标]] 这一段', ''].join('\n'),
    'seed-bl-snip-source',
  )

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)
  const card = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === target),
    5000,
    '目标笔记出现在列表里',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

  // 反链区是异步扫出来的，等它出现
  const snip = await waitFor(
    () => window.document.querySelector('.dshgn_backlinkSnip'),
    8000,
    '反链底下应该有上下文',
  )
  assert.ok((snip.textContent || '').includes('开会时记到'), '上下文是引用那一行剩下的字')
  assert.ok(!(snip.textContent || '').includes('[['), '双链本身不该出现在上下文里')

  // 提了几次就标几：反链按次数排，提了三遍的那篇该排在只提一遍的前面。
  await seed(
    '反链上下文反复',
    ['# 反链上下文反复', '', '第一处 [[反链上下文目标]]', '', '第二处 [[反链上下文目标]]', '', '第三处 [[反链上下文目标]]', ''].join('\n'),
    'seed-bl-snip-repeat',
  )
  const backBtn2 = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    backBtn2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const refreshBtn2 = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn2().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)
  const card2 = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === target),
    5000,
    '目标笔记又出现在列表里',
  )
  card2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

  const firstItem = await waitFor(() => {
    const items = Array.from(window.document.querySelectorAll('.dshgn_backlinkItem'))
    return items.find((el) => (el.textContent || '').includes('反链上下文反复')) || null
  }, 8000, '反复提到的那篇应该出现在反链里')
  const badge = Array.from(firstItem.querySelectorAll('.dshgn_outlineCount')).map((el) => el.textContent)
  assert.deepEqual(badge, ['3'], '反链上标出这一篇里提了几次')
  const order = Array.from(window.document.querySelectorAll('.dshgn_backlinkItem')).map((el) =>
    (el.querySelector('.dshgn_backlinkTitle') || {}).textContent,
  )
  assert.equal(order[0], '反链上下文反复', '提得多的排在前面，实际顺序：' + JSON.stringify(order))
})
/**
 * 搜索结果卡片上的「它引用了谁」。
 *
 * 以前搜索只给命中次数：用户知道这篇提到了关键词，却不知道它讲的是哪几篇，
 * 还得点进去翻。这一条守：/search 给的 links 真的画成胶囊，点了能跳过去。
 */
test('搜索结果卡片上列出这一篇引用了谁', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

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

  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '搜索出链验收',
      content: '# 搜索出链验收\n\n龙眼 记到 [[搜索出链甲]] 和 [[搜索出链乙]]\n',
      withDatePrefix: false,
      requestId: 'seed-search-links',
    }),
  })
  const created = await res.json()
  assert.equal(created.path, '随手记/搜索出链验收.md')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const box = await waitFor(() => window.document.querySelector('.dshgn_search'), 5000, '搜索框')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(box, '龙眼')
  box.dispatchEvent(new window.Event('input', { bubbles: true }))

  const chips = await waitFor(
    () => {
      const all = Array.from(window.document.querySelectorAll('.dshgn_cardLinkChip'))
      return all.length >= 2 ? all : null
    },
    8000,
    '搜索结果卡片上应该列出引用了谁',
  )
  const texts = chips.map((el) => el.textContent)
  assert.ok(texts.includes('搜索出链甲'), '胶囊上是链接原文：' + texts.join(','))
  assert.ok(texts.includes('搜索出链乙'), '两条都要有：' + texts.join(','))
})

test('断链页把全库指不到的双链摊出来，点一行就打开那一篇', async () => {
  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '断链验收',
      content: '好的 [[断链验收]]，坏的 [[这一篇根本不存在]]。\n',
      withDatePrefix: false,
      requestId: 'seed-broken',
    }),
  })
  const created = await res.json()
  assert.equal(created.path, '随手记/断链验收.md')

  await clickTab('断链')
  // 前面的用例在库里留下过别的断链（甲、乙那些），按目标名字挑我们这一条
  const row = await waitFor(
    () => {
      const all = Array.from(window.document.querySelectorAll('.dshgn_brokenRow'))
      return all.find((el) => {
        const name = el.querySelector('.dshgn_brokenTarget')
        return name !== null && name.textContent === '这一篇根本不存在'
      }) || null
    },
    8000,
    '断链页应该列出一条指不到的链接',
  )
  const target = row.querySelector('.dshgn_brokenTarget')
  assert.equal(target.textContent, '这一篇根本不存在')
  const where = row.querySelector('.dshgn_brokenWhere')
  assert.ok((where.textContent || '').includes('断链验收'), '位置要带上出自哪一篇：' + where.textContent)

  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => window.document.querySelector('.dshgn_root').getAttribute('data-has-note') === 'true',
    8000,
    '点断链那一行应该把出问题的那一篇打开',
  )
  const noteText = window.document.querySelector('.dshgn_note').textContent
  assert.ok(noteText.includes('这一篇根本不存在'), '打开的是出问题的那一篇：' + noteText.slice(0, 120))
})


test('正文里写的 #标签 也进标签云，点一下就能筛', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

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

  const seed = async (title, content, requestId) => {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '随手记', title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    assert.equal(json.path, '随手记/' + title + '.md')
    return json.path
  }

  // 上一个用例在搜索框里留了词：留着的话列表走的是搜索结果，标签筛选看不出效果
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  const target = await seed(
    '正文标签验收',
    ['# 正文标签验收', '', '今天出去走了走 #生活体验', '', '还看到一段 #读书/摘抄', ''].join('\n'),
    'seed-inline-tag',
  )

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  // 标签云里应该有正文里那个标签：只认头部 tags: 的话，它压根不出现
  const row = await waitFor(
    () => {
      const all = Array.from(window.document.querySelectorAll('.dshgn_tagRow'))
      return all.find((el) => (el.textContent || '').includes('生活体验')) || null
    },
    8000,
    '正文里写的标签也该出现在标签云里',
  )
  assert.ok((row.textContent || '').includes('读书/摘抄') === false, '一行一个标签')

  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_tagRow')).some(
        (el) => el.getAttribute('data-on') === 'true' && (el.textContent || '').includes('生活体验'),
      ),
    5000,
    '点正文标签也要能筛',
  )
  const cardTitles = () =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).map((el) => el.getAttribute('title'))
  await waitFor(() => cardTitles().includes(target), 5000, '筛出来应该有这一篇：' + JSON.stringify(cardTitles()))
  assert.equal(cardTitles().length, 1, '只有这一篇带这个标签：' + JSON.stringify(cardTitles()))

  // 收尾：把筛选清掉，别把状态留给后面的用例
  const onRow = Array.from(window.document.querySelectorAll('.dshgn_tagRow')).find(
    (el) => el.getAttribute('data-on') === 'true',
  )
  if (onRow) {
    onRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(
      () => Array.from(window.document.querySelectorAll('.dshgn_tagRow')).every((el) => el.getAttribute('data-on') !== 'true'),
      5000,
      '把标签筛选清掉',
    )
  }
})


test('引用块写成宿主那种 callout 时，图标标题正文各归各位', async () => {
  // 手写渲染器以前把 `> [!warning] 注意` 整块当普通引用，[!warning] 原样显示成
  // 一串字符。宿主渲染器本来就支持 callout，所以这条只在没有宿主渲染器时缺——
  // 而面板的离线测试跑的正好是手写那一套，popout 窗口和渲染器注入失败时也会退回来。
  const rootNode = () => window.document.querySelector('.dshgn_root')
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

  const seed = async (title, content, requestId) => {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '随手记', title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    assert.equal(json.path, '随手记/' + title + '.md')
    return json.path
  }

  const target = await seed(
    'callout 验收',
    [
      '# callout 验收',
      '',
      '> [!warning] 别在周五上线',
      '> 周五上线没人看着。',
      '',
      '> [!note]- 收起来的备注',
      '> 展开才看得到的一段。',
      '',
      '> [!自造类型] 认不出的也照样有标题',
      '> 类型名是自由的。',
      '',
      '普通引用块不该变成 callout。',
      '',
      '> 就是一段引用',
      '',
    ].join('\n'),
    'seed-callout',
  )

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)
  const card = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === target),
    5000,
    'callout 笔记出现在列表里',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

  const boxes = await waitFor(
    () => {
      const all = Array.from(window.document.querySelectorAll('.dshgn_callout'))
      return all.length >= 3 ? all : null
    },
    8000,
    '三个 callout 都该渲染成 callout',
  )
  assert.equal(boxes.length, 3, '普通引用块不该算进来')

  // ① 标题、正文各归各位，[!warning] 那串字符不该露在界面上
  const warnBox = boxes.find((el) => el.getAttribute('data-type') === 'warning')
  assert.ok(warnBox, '警告那块该在')
  assert.equal((warnBox.querySelector('.dshgn_calloutTitle').textContent || '').trim(), '别在周五上线')
  assert.ok((warnBox.querySelector('.dshgn_calloutBody').textContent || '').includes('没人看着'))
  const whole = window.document.querySelector('.dshgn_md').textContent || ''
  assert.ok(!whole.includes('[!warning]'), '类型标记不该原样露出来：' + whole.slice(0, 200))
  assert.ok(!whole.includes('[!自造类型]'), '认不出的类型也不该露标记')
  // 类型只影响配色，不该把标题吃掉：认不出的类型照样显示用户写的标题
  const customBox = boxes.find((el) => el.getAttribute('data-type') === '自造类型')
  assert.ok(customBox, '认不出的类型也该当 callout 渲染')
  assert.equal((customBox.querySelector('.dshgn_calloutTitle').textContent || '').trim(), '认不出的也照样有标题')

  // ② `[!note]-` 默认收起：正文不占地方，点一下标题才展开
  const foldBox = boxes.find((el) => el.getAttribute('data-type') === 'note')
  assert.ok(foldBox, '可折叠那块该在')
  assert.equal(foldBox.querySelector('.dshgn_calloutBody'), null, '带减号的默认收起，正文先不占地方')
  foldBox.querySelector('.dshgn_calloutFold').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => {
      const again = Array.from(window.document.querySelectorAll('.dshgn_callout')).find(
        (el) => el.getAttribute('data-type') === 'note',
      )
      return again && again.querySelector('.dshgn_calloutBody') !== null
    },
    5000,
    '点标题该展开',
  )

  // ③ 普通引用块还是普通引用块
  assert.equal(window.document.querySelectorAll('.dshgn_quote').length, 1, '只有那一块是普通引用')

  // ④ 渲染器层：类型与折叠标记按原样交给组件，认不出的类型有兜底
  const { renderBlocks, CalloutBlock, CALLOUT_TONES } = panel.__internals
  const rendered = renderBlocks('> [!tip] 试试\n> 正文\n', {})
  assert.equal(rendered.length, 1)
  assert.equal(rendered[0].type, CalloutBlock)
  assert.equal(rendered[0].props.type, 'tip')
  assert.equal(rendered[0].props.title, '试试')
  assert.equal(rendered[0].props.fold, '')
  const folded = renderBlocks('> [!warning]- 收着\n> 正文\n', {})
  assert.equal(folded[0].props.fold, '-')
  assert.equal(CALLOUT_TONES.tip.tone, 'success')
  assert.equal(CALLOUT_TONES.warning.tone, 'warn')
  assert.equal(CALLOUT_TONES.自造类型, undefined)
})


test('搜索结果点一行就跳到正文里那一行，不从头开始读', async () => {
  // 搜索卡片以前只把命中行列出来给人看，点下去等于点整张卡片——跳到篇首，
  // 用户还得自己在正文里再搜一遍那个词。宿主搜索是直接落到那一行的。
  const rootNode = () => window.document.querySelector('.dshgn_root')
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

  // 前一个用例可能在搜索框里留了词，先清空，否则下面的搜索看不出效果
  const box = await waitFor(() => window.document.querySelector('.dshgn_search'), 5000, '搜索框')
  const setInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setInput.call(box, '')
  box.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(260)

  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '命中行验收',
      content: '# 命中行验收\n\n开头一段，跟关键词无关。\n\n中间还有一段，也无关。\n\n## 小节\n\n这里写着 桂圆 两个字，它才是要跳过去的那一行。\n',
      withDatePrefix: false,
      requestId: 'seed-jump-line',
    }),
  })
  const created = await res.json()
  assert.equal(created.path, '随手记/命中行验收.md')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const searchBox = await waitFor(() => window.document.querySelector('.dshgn_search'), 5000, '搜索框')
  setInput.call(searchBox, '桂圆')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))

  // 命中行必须是能点的按钮，不是一段死文字
  const lineBtn = await waitFor(
    () => {
      const all = Array.from(window.document.querySelectorAll('.dshgn_matchLine'))
      return all.find((el) => el.tagName === 'BUTTON' && (el.textContent || '').includes('桂圆')) || null
    },
    8000,
    '搜索卡片上的命中行应该是一个按钮',
  )
  assert.equal(lineBtn.getAttribute('title'), '跳到这一行', '按钮上要说清点了会发生什么')

  // 命中行里那个词要标出来：整行灰字让用户自己在这一行里再找一遍，等于没搜
  const hitSpans = Array.from(lineBtn.querySelectorAll('.dshgn_matchHit'))
  assert.equal(hitSpans.length, 1, '一行里出现一次就只标一处')
  assert.equal(hitSpans[0].textContent, '桂圆', '标出来的必须正好是用户敲的那个词')

  // 记下滚动：jsdom 的 scrollTo 是空函数，不记就什么都验证不了
  const scrollCalls = []
  const proto = window.HTMLElement.prototype
  const original = proto.scrollTo
  proto.scrollTo = function scrollTo(arg) {
    scrollCalls.push(arg || {})
  }
  try {
    lineBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '点命中行应该打开那一篇')
    await waitFor(() => scrollCalls.length > 0, 8000, '点命中行应该滚到那一行')
    assert.equal(typeof scrollCalls[0].top, 'number', '滚的是纵向位置：' + JSON.stringify(scrollCalls[0]))
    // jsdom 里所有 getBoundingClientRect 都是 0，算出来的偏移也就恒为 0，
    // 靠位置分不出「滚到篇首」还是「滚到那一行」。改成直接问「那一行找得到吗」：
    // 找得到说明滚的是正文里那一块，而不是随手滚了一下容器。
    const { scrollToText } = panel.__internals
    const scroller = window.document.querySelector('.dshgn_scroll')
    assert.ok(scroller !== null, '正文外面应该有滚动容器')
    assert.equal(scrollToText(scroller, '这里写着 桂圆 两个字'), true, '按命中行文字应该找得到那一块')
    assert.equal(scrollToText(scroller, '正文里根本没有这句话'), false, '找不到时要老实返回 false')
  } finally {
    proto.scrollTo = original
  }

  const note = await waitFor(
    () => {
      const el = window.document.querySelector('.dshgn_note')
      return el !== null && (el.textContent || '').includes('桂圆') ? el : null
    },
    8000,
    '正文里应该有那一行',
  )
  assert.ok(note !== null)

  // 渲染器层：原始 Markdown 那一行要先削成能在正文里找到的几个字
  const { lineNeedle } = panel.__internals
  assert.equal(lineNeedle('## 小节'), '小节', '标题标记要削掉')
  assert.equal(lineNeedle('- [x] 买 桂圆'), '买 桂圆', '任务框要削掉')
  assert.equal(lineNeedle('见 [[另一篇|别名]] 那段'), '见 别名 那段', '双链要换成它的显示文字')
  assert.equal(lineNeedle('**加粗**的 _斜体_'), '加粗的 斜体', '强调标记要削掉')
  assert.equal(lineNeedle(''), '')
})

test('删除线、高亮和注释按宿主那套认，注释一个字都不露', async () => {
  // ~~划掉~~ 和 ==高亮== 是 Obsidian 自己的行内扩展，标准 Markdown 没有；
  // %%注释%% 更极端——宿主里它是整段不存在，不是小字也不是灰字。
  // 不认的话三种标记会连符号一起原样露在界面上，看起来像正文写错了。
  const rootNode = () => window.document.querySelector('.dshgn_root')
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

  const box = await waitFor(() => window.document.querySelector('.dshgn_search'), 5000, '搜索框')
  const setInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setInput.call(box, '')
  box.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(260)

  const body = [
    '# 行内标记验收',
    '',
    '这句有 ~~划掉的字~~ 和 ==高亮的字==，还有 %%藏起来的注释%% 结尾。',
    '',
    '%%',
    '这一整段都是注释，一个字都不该露出来。',
    '里面还写着 [[一段注释里的双链]]。',
    '%%',
    '',
    '注释后面还有正文。',
  ].join('\n')
  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({ dir: '随手记', title: '行内标记验收', content: body, withDatePrefix: false, requestId: 'seed-inline-marks' }),
  })
  assert.equal((await res.json()).path, '随手记/行内标记验收.md')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const card = await waitFor(
    () => {
      const all = Array.from(window.document.querySelectorAll('.dshgn_card'))
      return all.find((el) => (el.textContent || '').includes('行内标记验收')) || null
    },
    8000,
    '列表里应该有这一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const note = await waitFor(
    () => {
      const el = window.document.querySelector('.dshgn_note')
      return el !== null && (el.textContent || '').includes('高亮的字') ? el : null
    },
    8000,
    '正文里应该有高亮那句',
  )

  const del = note.querySelector('del.dshgn_del')
  const mark = note.querySelector('mark.dshgn_mark')
  assert.ok(del !== null, '删除线要渲染成 del')
  assert.equal(del.textContent, '划掉的字')
  assert.ok(mark !== null, '高亮要渲染成 mark')
  assert.equal(mark.textContent, '高亮的字')

  const text = note.textContent || ''
  assert.ok(!text.includes('~~'), '删除线的符号不该露出来：' + text.slice(0, 200))
  assert.ok(!text.includes('=='), '高亮的符号不该露出来：' + text.slice(0, 200))
  assert.ok(!text.includes('%%'), '注释的符号不该露出来：' + text.slice(0, 200))
  assert.ok(!text.includes('藏起来的注释'), '行内注释的内容一个字都不该露出来')
  assert.ok(!text.includes('一段注释里的双链'), '整段注释里的内容也不该露出来')
  assert.ok(text.includes('注释后面还有正文'), '注释前后的正文要照常在')
})

test('表格的对齐标记按宿主那套认，金额那一列不会全贴到左边', async () => {
  // 宿主认 :--- / :---: / ---: 三种对齐。面板原来一律靠左，一份「金额」右对齐的
  // 表格搬过来会全部贴到左边，数字位数不一就完全没法看。
  const { parseTable } = panel.__internals
  const linesIn = [
    '| 项目 | 金额 | 备注 |',
    '| :--- | ---: | :---: |',
    '| 房租 | 1200 | 每月 |',
    '| 水电 | 88 | 浮动 |',
  ]
  const table = parseTable(linesIn, 0)
  assert.ok(table !== null, '这张表应该解析得出来')
  assert.equal(table.alignOf(0), 'left')
  assert.equal(table.alignOf(1), 'right')
  assert.equal(table.alignOf(2), 'center')
  assert.equal(table.alignOf(9), '', '没写冒号就是默认，交给 CSS')

  const noAlign = parseTable(['| a | b |', '| --- | --- |', '| 1 | 2 |'], 0)
  assert.equal(noAlign.alignOf(0), '', '没写冒号时不该硬塞一个对齐方式')
})

test('编辑时脚下看得见字数和保存办法', async () => {
  // 编辑态原来一个字的反馈都没有：不知道按什么保存，也不知道写了多少。
  const rootNode = () => window.document.querySelector('.dshgn_root')
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

  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({ dir: '随手记', title: '字数验收', content: '# 字数验收\n\n开头\n', withDatePrefix: false, requestId: 'seed-wordcount' }),
  })
  assert.equal((await res.json()).path, '随手记/字数验收.md')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)
  const card = await waitFor(
    () => {
      const all = Array.from(window.document.querySelectorAll('.dshgn_card'))
      return all.find((el) => (el.textContent || '').includes('字数验收')) || null
    },
    8000,
    '列表里应该有这一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 5000, '笔记打开了')

  const editBtn = await waitFor(
    () => {
      const head = window.document.querySelector('.dshgn_noteHead')
      if (head === null) return null
      return Array.from(head.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '编辑') || null
    },
    5000,
    '笔记头上有编辑按钮',
  )
  editBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const editor = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '编辑区出现')

  // 脚下那一条：字数 + 快捷键提示
  const foot = await waitFor(() => window.document.querySelector('.dshgn_editorFoot'), 5000, '编辑区脚下有字数和提示')
  assert.ok((foot.textContent || '').includes('Ctrl+S'), '要告诉用户怎么保存')
  assert.ok((foot.textContent || '').includes('Esc'), '也要告诉用户怎么放弃')

  // 改几个字，字数要跟着走（不是进编辑态那一刻的死数字）
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(editor, '一二三四五六七八九十')
  editor.dispatchEvent(new window.Event('input', { bubbles: true }))
  await waitFor(
    () => ((window.document.querySelector('.dshgn_editorFoot') || {}).textContent || '').includes('10 字'),
    5000,
    '字数要跟着草稿走',
  )

  // 中英混排：中文按字、西文按词，别把两千字的中文报成八百
  const { countWords } = panel.__internals
  assert.equal(countWords('一二三'), 3)
  assert.equal(countWords('hello world'), 2)
  assert.equal(countWords('中文 hello 混排'), 5, '四个汉字 + 一个英文词')
  assert.equal(countWords(''), 0)
  assert.equal(countWords(null), 0)
  assert.equal(countWords(undefined), 0)
  assert.equal(countWords('123 456'), 2)

  // Esc 退出编辑态，别把这一篇留在编辑里影响后面的用例
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(120)
})
test('块引用指向的是一段而不是一节，记号也不露在正文里', async () => {
  // 宿主写法是「行尾一个 ^id」，双链写成 [[笔记#^id]]。以前我们把它当小节名去
  // 找标题，永远找不到，还会弹一句「这一篇里没有 ^abc 这一节」。
  const rootNode = () => window.document.querySelector('.dshgn_root')
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

  const body = [
    '# 块引用验收',
    '',
    '这一段挂了块 id，它才是要跳过去的那一段 ^para01',
    '',
    '- 列表里的第一项 ^item01',
    '- 列表里的第二项',
  ].join('\n')
  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({ dir: '随手记', title: '块引用验收', content: body, withDatePrefix: false, requestId: 'seed-blockref' }),
  })
  assert.equal((await res.json()).path, '随手记/块引用验收.md')

  await clickTab('笔记')
  Array.from(window.document.querySelectorAll('.dshgn_iconBtn'))
    .find((el) => el.title === '刷新')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)
  const card = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) =>
        (el.textContent || '').includes('块引用验收'),
      ) || null,
    8000,
    '列表里应该有这一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const note = await waitFor(
    () => {
      const el = window.document.querySelector('.dshgn_note')
      return el !== null && (el.textContent || '').includes('这一段挂了块 id') ? el : null
    },
    8000,
    '正文渲染出来',
  )

  // 记号本身不该露出来
  const text = note.textContent || ''
  assert.ok(!text.includes('^para01'), '段落末尾的块记号不该显示')
  assert.ok(!text.includes('^item01'), '列表项末尾的块记号也不该显示')

  // 但块要认得出来：挂着 data-block-id
  const para = note.querySelector('[data-block-id="para01"]')
  assert.ok(para !== null, '段落要挂上块 id')
  assert.ok((para.textContent || '').includes('这一段挂了块 id'))
  const item = note.querySelector('[data-block-id="item01"]')
  assert.ok(item !== null, '列表项也要挂上块 id')

  // 按 id 滚得过去；不存在的 id 老实返回 false
  const scroller = window.document.querySelector('.dshgn_scroll')
  const { scrollToBlock, isBlockAnchor, blockIdIn, stripBlockId } = panel.__internals
  assert.equal(scrollToBlock(scroller, '^para01'), true)
  assert.equal(scrollToBlock(scroller, 'para01'), true)
  assert.equal(scrollToBlock(scroller, '^没有这个'), false)
  assert.equal(scrollToBlock(scroller, ''), false)

  assert.equal(isBlockAnchor('^abc123'), true)
  assert.equal(isBlockAnchor('  ^abc123  '), true)
  assert.equal(isBlockAnchor('甲节'), false, '普通小节名不是块引用')
  assert.equal(blockIdIn('一段话 ^abc123'), 'abc123')
  assert.equal(blockIdIn('一段话'), '')
  assert.equal(stripBlockId('一段话 ^abc123'), '一段话')
  assert.equal(stripBlockId('一段话'), '一段话')
})

test('脚注正文里只留一个上标，注解收在篇尾', async () => {
  // 宿主把 [^1]: 注解 收在篇尾渲染成一小块注解列表，正文里只留上标。
  // 面板原来把定义行当普通段落原样显示，读者会看到一串 [^1]: ... 混在正文中间。
  const rootNode = () => window.document.querySelector('.dshgn_root')
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

  const body = [
    '# 脚注验收',
    '',
    '正文第一句，带一个脚注[^1]，后面还有字。',
    '',
    '第二条也带[^note-b]。',
    '',
    '[^1]: 这是第一条注解的内容。',
    '[^note-b]: 这是第二条注解，',
    '  换了一行还接着写。',
  ].join('\n')
  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({ dir: '随手记', title: '脚注验收', content: body, withDatePrefix: false, requestId: 'seed-footnote' }),
  })
  assert.equal((await res.json()).path, '随手记/脚注验收.md')

  await clickTab('笔记')
  Array.from(window.document.querySelectorAll('.dshgn_iconBtn'))
    .find((el) => el.title === '刷新')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)
  const card = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) =>
        (el.textContent || '').includes('脚注验收'),
      ) || null,
    8000,
    '列表里应该有这一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const note = await waitFor(
    () => {
      const el = window.document.querySelector('.dshgn_note')
      return el !== null && (el.textContent || '').includes('正文第一句') ? el : null
    },
    8000,
    '正文渲染出来',
  )

  const text = note.textContent || ''
  assert.ok(!text.includes('[^1]'), '引用记号本身不该露出来')
  assert.ok(!text.includes('[^note-b]'), '带名字的引用记号也不该露出来')

  const refs = Array.from(note.querySelectorAll('.dshgn_footRef'))
  assert.deepEqual(refs.map((el) => el.textContent), ['1', 'note-b'])
  assert.equal(refs[0].getAttribute('data-footnote-ref'), '1')

  const foots = Array.from(note.querySelectorAll('.dshgn_footnote'))
  assert.deepEqual(foots.map((el) => el.getAttribute('data-footnote-id')), ['1', 'note-b'])
  assert.ok((foots[0].textContent || '').includes('这是第一条注解的内容'))
  assert.ok(
    (foots[1].textContent || '').includes('换了一行还接着写'),
    '缩进的续行要接在注解后面：' + foots[1].textContent,
  )

  const scroller = window.document.querySelector('.dshgn_scroll')
  const { scrollToFootnote } = panel.__internals
  assert.equal(scrollToFootnote(scroller, '1'), true)
  assert.equal(scrollToFootnote(scroller, 'note-b'), true)
  assert.equal(scrollToFootnote(scroller, '没有这条'), false)
  assert.equal(scrollToFootnote(scroller, ''), false)
})

test('待办页签把全库没做的方框收成一张单子，勾一下当场划掉', async () => {
  // 待办写在正文里，一篇一篇翻才知道还剩什么。这一页打开就是「还剩哪些」，
  // 勾一下当场从单子上消失（不整页重查），点文字打开那一篇。
  const rootNode = () => window.document.querySelector('.dshgn_root')
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

  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '待办验收',
      content: '# 待办验收\n\n- [ ] 买桂圆回去煮汤\n- [x] 已经做过的\n',
      withDatePrefix: false,
      requestId: 'seed-todos-pane',
    }),
  })
  assert.equal((await res.json()).path, '随手记/待办验收.md')

  await clickTab('待办')
  const row = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_todoRow')).find((el) =>
        (el.textContent || '').includes('买桂圆回去煮汤'),
      ) || null,
    8000,
    '待办页签里应该有我们这一条',
  )
  assert.ok(!(row.textContent || '').includes('已经做过的'), '勾掉的不该出现在单子上')
  assert.ok((row.textContent || '').includes('待办验收'), '要标出这条待办在哪一篇：' + row.textContent)

  // 点方框：这一行当场消失（不整页重查），并且真的写进了笔记
  const box = row.querySelector('.dshgn_check')
  assert.ok(box !== null, '每条前面得有个能点的方框')
  assert.equal(box.title, '点一下勾掉')
  box.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () =>
      !Array.from(window.document.querySelectorAll('.dshgn_todoRow')).some((el) =>
        (el.textContent || '').includes('买桂圆回去煮汤'),
      ),
    8000,
    '勾掉之后这一行该从单子上消失',
  )
  const readBack = await realFetch(
    server.origin + '/getnote/read?path=' + encodeURIComponent('随手记/待办验收.md'),
    { headers: { 'x-getnote-token': server.token } },
  )
  const note = await readBack.json()
  assert.ok(note.content.includes('- [x] 买桂圆回去煮汤'), '笔记里那一行要真的被勾上：' + note.content)

  // 点文字：打开那一篇（另建一条没勾的，免得刚勾掉的这条已经不在单子上）
  await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '待办跳转验收',
      content: '# 待办跳转验收\n\n- [ ] 点我去那一篇\n',
      withDatePrefix: false,
      requestId: 'seed-todos-jump',
    }),
  })
  await clickTab('笔记')
  await clickTab('待办')
  const jumpRow = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_todoRow')).find((el) =>
        (el.textContent || '').includes('点我去那一篇'),
      ) || null,
    8000,
    '重新进待办页签要能看见新写的那一条',
  )
  jumpRow.querySelector('.dshgn_todoText').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  // 不能只等 data-has-note 变 true——上一个用例可能已经打开着别的笔记，
  // 要等到正文里真的出现这一条才说明跳到的是我们这一篇。
  const shown = await waitFor(
    () => {
      const el = window.document.querySelector('.dshgn_note')
      return el !== null && (el.textContent || '').includes('点我去那一篇') ? el : null
    },
    8000,
    '点文字应该打开那一篇',
  )
  assert.ok((shown.textContent || '').includes('待办跳转验收'))
})

test('嵌入图片后面写的尺寸真的按那个大小显示', async () => {
  // 宿主写法 `![[图.png|300]]`、`![[图.png|300x200]]`。不认的话用户写多少都
  // 被当成显示文字，图还是原样大小（还会被缩略图那条 max-height 压到 200）。
  const { parseImageSize, renderBlocks } = panel.__internals
  assert.deepEqual(parseImageSize('120'), { width: 120, height: 0 })
  assert.deepEqual(parseImageSize('300x200'), { width: 300, height: 200 })
  assert.deepEqual(parseImageSize(' 300 × 200 '), { width: 300, height: 200 })
  assert.equal(parseImageSize(''), null)
  assert.equal(parseImageSize(undefined), null)
  assert.equal(parseImageSize('示意图'), null, '显示文字不是尺寸')
  assert.equal(parseImageSize('0'), null)
  assert.equal(parseImageSize('-5'), null)

  const assets = [{ name: '示意图.png', path: '随手记/asset/示意图.png', kind: 'image' }]
  const opts = { assets, sourcePath: '随手记/图片尺寸验收.md' }
  // 行内嵌入会被包一层 span.dshgn_embed，图在它里面
  const imgIn = (nodes) => {
    for (const node of nodes) {
      if (node === null || node === undefined || typeof node !== 'object') continue
      if (node.type === 'img') return node
      const kids = node.props && node.props.children
      if (kids === undefined || kids === null) continue
      const found = imgIn(Array.isArray(kids) ? kids : [kids])
      if (found !== null) return found
    }
    return null
  }
  const sized = renderBlocks('![[示意图.png|120]]', opts)
  const img = imgIn(sized)
  assert.ok(img !== null, '应该渲染出图片')
  assert.equal(img.props.style.width, '120px')
  assert.equal(img.props.style.maxHeight, 'none', '写了尺寸就不该被缩略图的 max-height 压住')
  assert.ok(img.props.className.includes('dshgn_imgSized'))

  const both = renderBlocks('![[示意图.png|300x200]]', opts)
  const imgBoth = imgIn(both)
  assert.equal(imgBoth.props.style.width, '300px')
  assert.equal(imgBoth.props.style.height, '200px')

  const plain = renderBlocks('![[示意图.png]]', opts)
  const imgPlain = imgIn(plain)
  assert.deepEqual(imgPlain.props.style, {}, '没写尺寸就交给 CSS')
  assert.ok(!imgPlain.props.className.includes('dshgn_imgSized'))
})

test('段落里的换行按宿主的口径：软换行接成一句，两个空格才断行', async () => {
  // 原来段落整段交给 renderInline、靠 CSS 的 pre-wrap 显示，于是每个换行都断行。
  // 同一段在 Obsidian 里是一行话，在面板里被切成好几行，版式看着像两篇东西。
  const { renderParagraph, renderBlocks } = panel.__internals
  const flat = (nodes) =>
    nodes
      .map((node) => {
        if (typeof node === 'string') return node
        if (node === null || node === undefined) return ''
        if (node.type === 'br') return '\n'
        const kids = node.props && node.props.children
        if (kids === undefined || kids === null) return ''
        return flat(Array.isArray(kids) ? kids : [kids])
      })
      .join('')

  // 软换行：接成一句话，中间一个空格
  assert.equal(flat(renderParagraph('第一行\n第二行', 'k', {})), '第一行 第二行')
  // 硬换行：行尾两个空格真的断
  assert.equal(flat(renderParagraph('第一行  \n第二行', 'k', {})), '第一行\n第二行')
  // 行尾一个反斜杠也是硬换行
  assert.equal(flat(renderParagraph('第一行\\\n第二行', 'k', {})), '第一行\n第二行')

  // 整篇渲染时也走这条路：三个软换行合成一段一行话
  const blocks = renderBlocks('这是第一行\n这是第二行\n这是第三行', {})
  const para = blocks.find((node) => node && node.type === 'p')
  assert.ok(para !== undefined, '应该渲染出一个段落')
  assert.equal(flat([para]), '这是第一行 这是第二行 这是第三行')
  assert.equal(para.props.className, 'dshgn_p')
})

test('嵌进来的块引用只摆那一段，不是整篇嵌进来再滚过去', async () => {
  // 宿主里 ![[笔记#^abc123]] 嵌的是「那一段」。整篇嵌进来再滚过去，用户看到的
  // 还是一整篇，分不清哪一句是被引的那句。
  const { blockTextOf } = panel.__internals
  const body = [
    '# 块引用来源',
    '',
    '第一段，跟谁都没关系。',
    '',
    '第二段第一行，',
    '第二段第二行，这才是挂了 id 的那一段 ^want01',
    '',
    '第三段，也不该出现。',
    '',
    '- 列表项一 ^item01',
    '- 列表项二',
  ].join('\n')

  const para = blockTextOf(body, '^want01')
  assert.ok(para.includes('第二段第一行'), '段落要整段抠出来：' + para)
  assert.ok(para.includes('第二段第二行'))
  assert.ok(!para.includes('第一段'), '别的段落不该跟着来')
  assert.ok(!para.includes('第三段'))
  assert.ok(!para.includes('^want01'), '块记号本身要削掉')

  assert.equal(blockTextOf(body, 'item01'), '- 列表项一', '列表项只抠那一项')
  assert.equal(blockTextOf(body, '没有这个'), '', '找不到就返回空串，调用方退回整篇')
  assert.equal(blockTextOf(body, ''), '')
  assert.equal(blockTextOf('', 'want01'), '')

  // 围栏里的 ^id 不算（那是代码，不是块）
  const fenced = ['```', '代码里 ^fence01', '```', '', '真的 ^real01'].join('\n')
  assert.equal(blockTextOf(fenced, 'fence01'), '')
  assert.equal(blockTextOf(fenced, 'real01'), '真的')
})

test('写成 [文字](笔记.md) 的链接也往库里跳，不当外链开浏览器', async () => {
  // 宿主认 [文字](笔记.md) 和 [文字](#小节)，它们指向的仍是库里的东西。
  // 我们原来一律 target=_blank，点下去什么也不会发生。
  const { markdownLinkTarget, renderBlocks } = panel.__internals

  assert.deepEqual(markdownLinkTarget('随手记/会议.md'), { target: '随手记/会议', anchor: '' })
  assert.deepEqual(markdownLinkTarget('会议'), { target: '会议', anchor: '' })
  assert.deepEqual(markdownLinkTarget('./会议.md'), { target: '会议', anchor: '' })
  assert.deepEqual(markdownLinkTarget('随手记/会议.md#小结'), { target: '随手记/会议', anchor: '小结' })
  assert.deepEqual(markdownLinkTarget('#小结'), { target: '', anchor: '小结' })
  assert.equal(markdownLinkTarget('https://example.com/a.md'), null, '外站不碰')
  assert.equal(markdownLinkTarget('mailto:a@b.c'), null)
  assert.equal(markdownLinkTarget('file:///tmp/a.md'), null)
  assert.equal(markdownLinkTarget('随手记/图.png'), null, '附件不是笔记')
  assert.equal(markdownLinkTarget('随手记/说明.pdf'), null)
  assert.equal(markdownLinkTarget(''), null)
  assert.equal(markdownLinkTarget('#'), null)

  // 真渲染一遍：库内链接变按钮，外链还是 a
  const opened = []
  const nodes = renderBlocks('见 [会议纪要](随手记/会议.md) 与 [官网](https://example.com)', {
    onOpenWikiLink: (target, anchor) => opened.push([target, anchor]),
  })
  const walk = (list, out) => {
    list.forEach((node) => {
      if (node === null || typeof node !== 'object') return
      out.push(node)
      const kids = node.props && node.props.children
      if (Array.isArray(kids)) walk(kids, out)
      else if (kids) walk([kids], out)
    })
    return out
  }
  const flat = walk(nodes, [])
  const button = flat.find((node) => node.type === 'button' && (node.props.className || '').includes('dshgn_wikilink'))
  assert.ok(button !== undefined, '库内链接应该渲染成可点的按钮')
  button.props.onClick()
  assert.deepEqual(opened, [['随手记/会议', '']])
  const anchor = flat.find((node) => node.type === 'a')
  assert.ok(anchor !== undefined, '外链还是外链')
  assert.equal(anchor.props.href, 'https://example.com')
})

test('提示框里的待办不算序号，勾一下不会勾到正文里那条', async () => {
  // 宿主侧 toggleTodo 逐行扫、跳过围栏，提示框里的行开头是 `>`，匹配不上 `^(\s*)([-*+])\s+\[`，
  // 所以那一条在宿主里压根不算第几个。面板要是把序号也算进去，两边就错位了：
  // 用户勾的是提示框里的，落到盘上的却是正文里那一条。
  const { renderBlocks } = panel.__internals
  const clicked = []
  const markdown = [
    '> [!note] 注意事项',
    '> - [ ] 提示框里的待办',
    '',
    '- [ ] 正文第一条',
    '- [ ] 正文第二条',
  ].join('\n')
  const nodes = renderBlocks(markdown, {
    onToggleTodo: (index, done) => clicked.push([index, done]),
    onOpenWikiLink: () => {},
  })

  const boxes = []
  const walk = (list) => {
    list.forEach((node) => {
      if (node === null || typeof node !== 'object') return
      if (node.props && typeof node.props.className === 'string' && node.props.className.includes('dshgn_check')) {
        boxes.push(node)
      }
      const kids = node.props && node.props.children
      if (Array.isArray(kids)) walk(kids)
      else if (kids) walk([kids])
    })
  }
  walk(nodes)
  // 提示框是组件，元素上看到的是它的 props（真正的 DOM 要等 React 展开），
  // 所以这里断言它拿到的 opts 里没有 onToggleTodo——传下去了就会吃序号。
  const callout = nodes.find((node) => node && node.type === panel.__internals.CalloutBlock)
  assert.ok(callout !== undefined, '应该有一个提示框')
  assert.equal(callout.props.opts.onToggleTodo, undefined, '提示框里的待办不该吃序号')
  assert.equal(typeof callout.props.opts.onOpenWikiLink, 'function', '别的选项还得留着')

  assert.equal(boxes.length, 2, '正文里两条待办各一个方框')
  boxes[0].props.onClick({ preventDefault() {}, stopPropagation() {} })
  assert.deepEqual(clicked, [[0, true]], '正文第一条才是第 0 个')
  boxes[1].props.onClick({ preventDefault() {}, stopPropagation() {} })
  assert.deepEqual(clicked, [[0, true], [1, true]], '正文第二条是第 1 个')
})

test('正文里写到的 #标签 是个能点的胶囊，不像一串普通字', async () => {
  // 标签云里已经有这个标签了，正文里那串 #生活体验 却还是干巴巴的字，
  // 点也点不了——同一个东西在页面上长成两副样子，用户会以为是没渲染对。
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

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

  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  const seed = async (title, content, requestId) => {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '随手记', title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    assert.equal(json.path, '随手记/' + title + '.md')
    return json.path
  }

  const target = await seed(
    '正文胶囊验收',
    ['# 正文胶囊验收', '', '今天出去走了走 #生活体验', '', '编号 #123 不是标签，abc#def 也不是。', ''].join('\n'),
    'seed-inline-pill',
  )

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const card = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === target) || null,
    8000,
    '列表里应该有这一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 5000, '打开这一篇')

  const pill = await waitFor(
    () => {
      const all = Array.from(window.document.querySelectorAll('.dshgn_inlineTag'))
      return all.find((el) => (el.textContent || '').trim() === '#生活体验') || null
    },
    8000,
    '正文里的 #标签 该做成胶囊',
  )
  assert.equal(pill.tagName, 'BUTTON', '接得上筛标签的地方就该能点')

  const noteText = window.document.querySelector('.dshgn_note').textContent || ''
  assert.ok(noteText.includes('#123'), '纯数字不算标签，得原样留着：' + noteText.slice(0, 200))
  assert.ok(noteText.includes('abc#def'), '紧贴着字的井号不算标签，得原样留着')
  assert.equal(
    Array.from(window.document.querySelectorAll('.dshgn_inlineTag')).some(
      (el) => (el.textContent || '').trim() === '#123',
    ),
    false,
    '纯数字不该被做成胶囊',
  )

  pill.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_tagRow')).some(
        (el) => el.getAttribute('data-on') === 'true' && (el.textContent || '').includes('生活体验'),
      ),
    5000,
    '点正文里的胶囊就该去左栏筛这个标签',
  )

  // 收尾：清掉筛选，别把状态留给后面的用例
  const onRow = Array.from(window.document.querySelectorAll('.dshgn_tagRow')).find(
    (el) => el.getAttribute('data-on') === 'true',
  )
  if (onRow) {
    onRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(
      () => Array.from(window.document.querySelectorAll('.dshgn_tagRow')).every((el) => el.getAttribute('data-on') !== 'true'),
      5000,
      '把标签筛选清掉',
    )
  }

  // 渲染器层：口径与 vault 那边一致，不然后台认得、前台认不出
  const { renderInline, tagBodyOf } = panel.__internals
  const nodes = renderInline('看到 #标签 了', 'k', {})
  const span = nodes.find((node) => node && typeof node === 'object' && node.props && node.props.className === 'dshgn_inlineTag')
  assert.ok(span !== undefined, '没接筛标签的地方也要上色')
  assert.equal(span.type, 'span', '没有去处时不该是个按钮')
  assert.equal(span.props.children, '#标签')

  const plain = renderInline('#123', 'k', {})
  assert.equal(
    plain.some((node) => node && typeof node === 'object' && node.props && node.props.className === 'dshgn_inlineTag'),
    false,
    '纯数字不是标签',
  )

  assert.equal(tagBodyOf('生活'), true)
  assert.equal(tagBodyOf('读书/摘抄'), true)
  assert.equal(tagBodyOf('123'), false, '纯数字不算标签')
  assert.equal(tagBodyOf('a/'), false, '结尾挂斜杠的不算标签')
  assert.equal(tagBodyOf(''), false)
})
test('代码块右上角有个「复制」，点了搬走的是围栏里那一份原文', async () => {
  // 读笔记时想把一段示例命令搬走，鼠标划选很容易漏掉首尾、还会带上旁边的
  // 语言标签；这里给的是围栏里那一整段，一个字不多一个字不少。
  const { renderBlocks } = panel.__internals
  const markdown = ['先看这段：', '', '```bash', 'npm test -- --watch', '  echo "缩进也要留着"', '```', '', '后面还有话。'].join('\n')

  const picked = []
  const nodes = renderBlocks(markdown, { onCopyText: (text) => picked.push(text) })
  const pre = nodes.find((node) => node && typeof node === 'object' && node.props && node.props.className === 'dshgn_pre')
  assert.ok(pre !== undefined, '应该有一个代码块')
  const kids = Array.isArray(pre.props.children) ? pre.props.children : [pre.props.children]
  const button = kids.find((node) => node && typeof node === 'object' && node.props && node.props.className === 'dshgn_preCopy')
  assert.ok(button !== undefined, '代码块上应该有个复制按钮')
  assert.equal(button.type, 'button')
  assert.equal(button.props.title, '复制这一段')
  button.props.onClick({ stopPropagation() {} })
  assert.deepEqual(picked, ['npm test -- --watch\n  echo "缩进也要留着"'], '复制的是围栏里的原文，缩进与引号都得原样')

  // 没接去处时（卡片摘要、嵌进来的正文）不该摆一个点了没反应的按钮
  const plain = renderBlocks(markdown, {})
  const plainPre = plain.find((node) => node && typeof node === 'object' && node.props && node.props.className === 'dshgn_pre')
  const plainKids = Array.isArray(plainPre.props.children) ? plainPre.props.children : [plainPre.props.children]
  assert.equal(
    plainKids.some((node) => node && typeof node === 'object' && node.props && node.props.className === 'dshgn_preCopy'),
    false,
    '没有复制去处时不摆按钮',
  )
})
test('正文里的图片点一下先放大给自己看，不再非得交给编辑器', async () => {
  // 一张扫描件在面板里只有 200px 高，想看清上面的字就得把焦点交给 Obsidian，
  // 看完再切回来——为了读一行字来回切窗口。这里给自己一个放大。
  const { renderEmbed, ZoomOverlay } = panel.__internals

  const previews = []
  const live = renderEmbed('随手记/图/放大验收.png', 'k1', { onPreviewImage: (item) => previews.push(item) })
  assert.equal(live.props.className, 'dshgn_img dshgn_imgOpen', '能放大时也要给个「可以点」的样子')
  // 标题跟着宿主语言走（测试环境没注入语言时是英文），只断言「有话说」而不是某个具体译法
  assert.ok(typeof live.props.title === 'string' && live.props.title.length > 0, '该说明点了会放大')
  live.props.onClick({ stopPropagation() {} })
  assert.equal(previews.length, 1)
  assert.equal(previews[0].name, '放大验收.png')
  assert.ok(String(previews[0].src).includes('/getnote/asset?path='), '放大的得是同一张图：' + previews[0].src)

  // 既没有放大去处、也没接上宿主：不给光标、不挂处理器
  const bare = renderEmbed('随手记/图/放大验收.png', 'k2', {})
  assert.equal(bare.props.className, 'dshgn_img')
  assert.equal(bare.props.onClick, undefined)

  // 有放大去处时不走「交给宿主打开」那条路——否则点一下就把编辑器拉起来了
  const opened = []
  panel.setOpenAsset((path) => {
    opened.push(String(path))
    return true
  })
  try {
    const both = renderEmbed('随手记/图/放大验收.png', 'k3', { onPreviewImage: () => {} })
    both.props.onClick({ stopPropagation() {} })
    assert.deepEqual(opened, [], '面板自己能放大时不该再把焦点交给宿主')
  } finally {
    panel.setOpenAsset(null)
  }

  // 遮罩本身：点空白关、点图不关、右上角那颗 × 也关
  let closed = 0
  const overlay = ZoomOverlay({ src: 'http://x/a.png', name: 'a.png', onClose: () => { closed += 1 } })
  assert.equal(overlay.props.className, 'dshgn_zoomMask')
  const kids = Array.isArray(overlay.props.children) ? overlay.props.children : [overlay.props.children]
  const pic = kids.find((node) => node && typeof node === 'object' && node.props && node.props.className === 'dshgn_zoomImg')
  const cross = kids.find((node) => node && typeof node === 'object' && node.props && node.props.className === 'dshgn_zoomClose')
  assert.ok(pic !== undefined && cross !== undefined, '遮罩里该有图和一个关闭按钮')
  pic.props.onClick({ stopPropagation() {} })
  assert.equal(closed, 0, '点图本身不该把图关掉')
  overlay.props.onClick({})
  assert.equal(closed, 1, '点空白处关掉')
  cross.props.onClick({ stopPropagation() {} })
  assert.equal(closed, 2, '那颗 × 也关')
})

test('点开正文里的图就当场放大，按 Esc 收起来', async () => {
  // 上面那条测的是渲染器给不给按钮；这条测真的点下去之后面板里发生了什么：
  // 遮罩得真的出现，Esc 得真的把它收掉（挂到窗口上，焦点不在遮罩里也要管用）。
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

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

  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '放大查看验收',
      content: ['# 放大查看验收', '', '![[放大验收.png]]', ''].join('\n'),
      withDatePrefix: false,
      requestId: 'seed-zoom-image',
    }),
  })
  const seeded = await res.json()
  assert.equal(seeded.path, '随手记/放大查看验收.md')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const card = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === seeded.path) || null,
    8000,
    '列表里应该有这一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 5000, '打开这一篇')

  const pic = await waitFor(
    () => window.document.querySelector('.dshgn_md .dshgn_img'),
    8000,
    '正文里的图该画出来',
  )
  pic.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const mask = await waitFor(() => window.document.querySelector('.dshgn_zoomMask'), 5000, '点图该放大')
  const big = mask.querySelector('.dshgn_zoomImg')
  assert.ok(big !== null, '遮罩里得是那张图')
  assert.ok(String(big.getAttribute('src') || '').includes('/getnote/asset?path='), '放大的还是同一张图')

  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_zoomMask') === null, 5000, 'Esc 该收起来')

  // 收起来之后笔记还在读着，不该顺手把笔记也关掉
  assert.equal(rootNode().getAttribute('data-has-note'), 'true', 'Esc 只关遮罩，不该退出笔记')
})

test('清单里按回车接着写下一行，Tab 把整行挪两格，空条目按回车就收掉', async () => {
  const { continueListLine, indentLines } = panel.__internals

  // 先验这一下接管的范围：只认行尾，行中间的回车仍然是「把这行拆成两条」
  assert.equal(continueListLine('- 第一条', 5).text, '- 第一条\n- ')
  assert.equal(continueListLine('- 第一条', 3), null, '光标在行中间时不该接管')
  assert.equal(continueListLine('一段普通的话', 6), null, '不是列表就不接管')
  assert.equal(continueListLine('  * 缩进的一条', 9).text, '  * 缩进的一条\n  * ', '缩进要跟着带下来')
  assert.equal(continueListLine('3. 第三步', 6).text, '3. 第三步\n4. ', '有序列表得自动加一')
  assert.equal(continueListLine('1) 括号的写法', 8).text, '1) 括号的写法\n2) ')
  assert.equal(continueListLine('- [ ] 没做的一条', 11).text, '- [ ] 没做的一条\n- [ ] ')
  assert.equal(continueListLine('- [x] 做过的', 9).text, '- [x] 做过的\n- [ ] ', '新的一条总是没勾的')
  assert.equal(continueListLine('- ', 2).text, '', '空条目按回车把这行记号收掉')
  assert.equal(continueListLine('> - 引用里的一条', 10).text, '> - 引用里的一条\n> - ', '引用层要原样贴回去')
  // 多行时只动光标所在那一行
  const multi = continueListLine('- 甲\n- 乙', 7)
  assert.equal(multi.text, '- 甲\n- 乙\n- ')
  assert.equal(multi.caret, multi.text.length)

  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

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

  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '列表续行验收',
      content: ['# 列表续行验收', '', '- 第一条', ''].join('\n'),
      withDatePrefix: false,
      requestId: 'seed-list-continue',
    }),
  })
  const seeded = await res.json()
  assert.equal(seeded.path, '随手记/列表续行验收.md')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const card = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === seeded.path) || null,
    8000,
    '列表里应该有这一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 5000, '打开这一篇')

  const editBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '编辑')
  editBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const editor = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '进编辑态')

  // Preact 的 onChange 落在 input 事件上，jsdom 里要自己派发；
  // 回车这一下也要自己派发——textarea 不会替我们把按键变成一次真实输入。
  const typeInto = async (value, caret) => {
    editor.value = value
    editor.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(40)
    editor.setSelectionRange(caret === undefined ? value.length : caret, caret === undefined ? value.length : caret)
    editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await sleep(80)
  }

  await typeInto('- 第一条')
  assert.equal(editor.value, '- 第一条\n- ', '回车之后下一行该带着记号')
  assert.equal(editor.selectionStart, editor.value.length, '光标要落在新行末尾，接着就能写')

  await typeInto('- 第一条\n- 第二条')
  await typeInto('3. 第三步')
  assert.equal(editor.value, '3. 第三步\n4. ', '有序列表得接着数下去')

  await typeInto('- ')
  assert.equal(editor.value, '', '空条目按回车把这行记号收掉')

  // 行中间的回车不接管：这一下要让浏览器自己插换行，别补记号把句子劈开
  await typeInto('- 半句话', 2)
  assert.equal(editor.value, '- 半句话', '行中间的回车不该被接管')

  // Tab 把整行往右挪两格、Shift+Tab 收回来；焦点不许跳走（preventDefault 之后
  // jsdom 里再派发一次 keydown 仍然落在这个节点上，说明没被浏览器抢走）。
  const pressTab = async (shift) => {
    editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: Boolean(shift), bubbles: true }))
    await sleep(80)
  }
  editor.setSelectionRange(3, 3)
  await pressTab(false)
  assert.equal(editor.value, '  - 半句话', 'Tab 该把整行挪两格')
  await pressTab(false)
  assert.equal(editor.value, '    - 半句话', '连着按两下就是四格')
  await pressTab(true)
  assert.equal(editor.value, '  - 半句话', 'Shift+Tab 该收回来')
  await pressTab(true)
  await pressTab(true)
  assert.equal(editor.value, '- 半句话', '已经顶格时再收也不该吃掉字')

  // 缩进的是整行：光标在句子中间按 Tab，那句话不该被顶出一个洞
  const one = indentLines('- 一条', 3, 3, false)
  assert.equal(one.text, '  - 一条')
  assert.equal(one.start, 5, '选区跟着挪，光标不会落在错的地方')
  // 空行不补空格：缩进之后它会变成一串看不见的空格
  assert.equal(indentLines('- 甲\n\n- 乙', 0, 9, false).text, '  - 甲\n\n  - 乙')

  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_editor') === null, 5000, 'Esc 退出编辑态')
})

test('编辑区里 Ctrl+B / Ctrl+I / Ctrl+Shift+X 给选中的字套上记号，再按一次取消', async () => {
  const { wrapInline } = panel.__internals
  const rootNode = () => window.document.querySelector('.dshgn_root')

  // 纯函数：套上、取消、没选中时插一对让光标落在中间
  const bold = wrapInline('今天很好', 0, 2, '**')
  assert.equal(bold.text, '**今天**很好')
  assert.equal(bold.start, 2, '选区跟着记号一起挪')
  assert.equal(bold.end, 4)
  // 再按一次：认得出记号已经包在外面，剥掉而不是再套一层
  const undone = wrapInline(bold.text, bold.start, bold.end, '**')
  assert.equal(undone.text, '今天很好')
  assert.equal(undone.start, 0)
  assert.equal(undone.end, 2)
  // 选中的文字自己两头就是记号时，剥掉它自己那一对
  assert.equal(wrapInline('**甲**乙', 0, 5, '**').text, '甲乙')
  // 没选中任何字：插一对记号，光标落在中间
  const empty = wrapInline('abc', 1, 1, '*')
  assert.equal(empty.text, 'a**bc')
  assert.equal(empty.start, 2)
  assert.equal(empty.end, 2)

  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    const backBtn = window.document.querySelector('.dshgn_noteBack')
    if (backBtn) {
      backBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
    }
  } finally {
    panel.setConfirmDialog(null)
  }

  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '加粗快捷键验收',
      content: ['# 加粗快捷键验收', '', '今天很好', ''].join('\n'),
      withDatePrefix: false,
      // requestId 是服务端的去重号：撞上别的用例会直接把那一篇的路径还回来
      requestId: 'seed-inline-mark-keys',
    }),
  })
  const seeded = await res.json()
  assert.equal(seeded.path, '随手记/加粗快捷键验收.md')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const card = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === seeded.path) || null,
    8000,
    '列表里应该有这一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 5000, '打开这一篇')

  const editBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '编辑')
  editBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const editor = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '进编辑态')

  const press = async (key, opts) => {
    editor.dispatchEvent(
      new window.KeyboardEvent('keydown', Object.assign({ key, bubbles: true }, opts || {})),
    )
    await sleep(80)
  }

  // 真在编辑区里按一遍：选中「今天」两个字，Ctrl+B
  editor.value = '今天很好'
  editor.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(40)
  editor.setSelectionRange(0, 2)
  await press('b', { ctrlKey: true })
  assert.equal(editor.value, '**今天**很好', 'Ctrl+B 该把选中的字包起来')
  assert.equal(editor.selectionStart, 2, '光标落在记号里面，接着还能改')

  // 再按一次是取消
  await press('b', { ctrlKey: true })
  assert.equal(editor.value, '今天很好', '连按两次等于取消，不该套两层')

  // Ctrl+I 斜体、Ctrl+Shift+X 删除线
  editor.setSelectionRange(0, 2)
  await press('i', { ctrlKey: true })
  assert.equal(editor.value, '*今天*很好', 'Ctrl+I 是斜体')
  editor.value = '今天很好'
  editor.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(40)
  editor.setSelectionRange(0, 2)
  await press('x', { ctrlKey: true, shiftKey: true })
  assert.equal(editor.value, '~~今天~~很好', 'Ctrl+Shift+X 是删除线')

  // 编辑区底下那行提示里写得出这几个键，不然用户不知道有这回事
  const hint = window.document.querySelector('.dshgn_editorHint')
  assert.ok(hint !== null, '编辑区底下该有那行提示')
  assert.ok(hint.textContent.includes('Ctrl+B'), '提示里要写上 Ctrl+B')

  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_editor') === null, 5000, 'Esc 退出编辑态')
})


test('大纲上亮着「现在读到哪一节」，点过去就换一条，自己往下翻也跟着换', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')

  // 前一个用例可能把某篇开着、搜索框里还留着词，先退回干净的空态
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    const backBtn = window.document.querySelector('.dshgn_noteBack')
    if (backBtn) {
      backBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
    }
  } finally {
    panel.setConfirmDialog(null)
  }

  const box = await waitFor(() => window.document.querySelector('.dshgn_search'), 5000, '搜索框')
  const setInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setInput.call(box, '')
  box.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(260)

  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '大纲高亮验收',
      content: '# 大纲高亮验收\n\n第一节的话。\n\n## 第二节\n\n第二节的话。\n\n## 第三节\n\n第三节的话。\n',
      withDatePrefix: false,
      requestId: 'seed-outline-active',
    }),
  })
  assert.equal((await res.json()).path, '随手记/大纲高亮验收.md')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const card = await waitFor(
    () => {
      const all = Array.from(window.document.querySelectorAll('.dshgn_card'))
      return all.find((el) => (el.textContent || '').includes('大纲高亮验收')) || null
    },
    8000,
    '列表里的那一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

  const items = await waitFor(
    () => {
      const all = Array.from(window.document.querySelectorAll('.dshgn_outlineItem'))
      return all.length >= 3 ? all : null
    },
    8000,
    '大纲里应该有三条',
  )
  assert.equal(items[0].textContent, '大纲高亮验收')
  assert.equal(items[1].textContent, '第二节')

  // jsdom 没有排版，所有元素的 getBoundingClientRect 都是 0——那样每个标题都
  // 算「已经在视野上方」，滚动侦测会把最后一条点亮，跟浏览器里的表现不一样。
  // 这里给标题补一份假排版（每条往下挪 100px），让「谁在视野里」有答案可比。
  const realRect = window.HTMLElement.prototype.getBoundingClientRect
  const realScrollTo = window.HTMLElement.prototype.scrollTo
  let fakeScrollTop = 0
  window.HTMLElement.prototype.getBoundingClientRect = function fakeRect() {
    if (this.classList && this.classList.contains('dshgn_h')) {
      const heads = Array.from(window.document.querySelectorAll('.dshgn_h'))
      // 减去「已经滚过去多少」，标题才会随滚动移到视野上方
      const top = heads.indexOf(this) * 100 - fakeScrollTop
      return { top, bottom: top + 40, left: 0, right: 0, width: 0, height: 40, x: 0, y: top }
    }
    return realRect.call(this)
  }
  // jsdom 的 scrollTo 是空实现，滚完位置不会变；这里让它真把「滚到哪儿」记下来
  window.HTMLElement.prototype.scrollTo = function fakeScrollToTo(options) {
    if (options && typeof options.top === 'number') fakeScrollTop = options.top
  }
  try {
  // 亮着的必须只有一条：两条同时亮等于没说「我在哪」。
  // 每次重查一遍：React 重渲染会换掉节点，攥着旧引用会读到已经不挂在页面上的那份。
  const outlineItems = () => Array.from(window.document.querySelectorAll('.dshgn_outlineItem'))
  const onNow = () => outlineItems().filter((el) => el.getAttribute('data-on') === 'true')
  assert.equal(onNow().length, 1, '同一时刻只有一节是「正在读的」')

  // 点第二节：亮的那条跟着换过去，并且带 aria-current 给读屏
  outlineItems()[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => {
      const live = outlineItems()
      return live.length >= 2 && live[1].getAttribute('data-on') === 'true' ? live : null
    },
    5000,
    '点了第二节就该亮第二节',
  )
  assert.equal(outlineItems()[0].getAttribute('data-on'), 'false', '上一节要熄掉')
  assert.equal(outlineItems()[1].getAttribute('aria-current'), 'true')
  assert.equal(onNow().length, 1)

  // 自己往下翻（滚动）时也得跟着变，不能只在点大纲时才对
  const scroller = window.document.querySelector('.dshgn_scroll')
  assert.ok(scroller !== null, '正文外面应该有滚动容器')
  scroller.dispatchEvent(new window.Event('scroll'))
  await sleep(200)
  assert.equal(onNow().length, 1, '滚动之后仍然只有一节亮着')
  } finally {
    window.HTMLElement.prototype.getBoundingClientRect = realRect
    window.HTMLElement.prototype.scrollTo = realScrollTo
  }
})


test('搜索卡片上把用户敲的词标出来，tag:/dir: 限定词不去染正文', async () => {
  const { splitByTerms, highlightTerms, searchTermsOf } = panel.__internals
  const rootNode = () => window.document.querySelector('.dshgn_root')

  // 纯函数：按原文写法切，大小写不敏感，重叠的词按长的先吃
  assert.deepEqual(splitByTerms('开会时提到会议室', ['会议']), [
    { hit: false, text: '开会时提到' },
    { hit: true, text: '会议' },
    { hit: false, text: '室' },
  ])
  assert.deepEqual(splitByTerms('Alpha beta ALPHA', ['alpha']), [
    { hit: true, text: 'Alpha' },
    { hit: false, text: ' beta ' },
    { hit: true, text: 'ALPHA' },
  ])
  // 长词先吃：「会议」和「会议室」同时在，不能把「会议室」劈成两半
  assert.deepEqual(splitByTerms('去会议室', ['会议', '会议室']).filter((p) => p.hit), [{ hit: true, text: '会议室' }])
  // 一个词都没有就原样返回，别把整行拆成一堆片段
  assert.deepEqual(splitByTerms('没有命中', []), [{ hit: false, text: '没有命中' }])
  assert.deepEqual(splitByTerms('', ['甲']), [{ hit: false, text: '' }])

  // 限定词不进正文：拿 tag: 去标正文只会把整行染成没命中
  assert.deepEqual(searchTermsOf('tag:录音卡 会议'), ['会议'])
  assert.deepEqual(searchTermsOf('dir:"随手记/子目录" 桂圆 荔枝'), ['桂圆', '荔枝'])
  assert.deepEqual(searchTermsOf('#生活 桂圆'), ['桂圆'])
  assert.deepEqual(searchTermsOf('   '), [])

  // 没词时返回原字符串（渲染成纯文本，不套一堆 span）
  assert.equal(highlightTerms('一整行灰字', []), '一整行灰字')

  // 真渲染：搜索卡片上的命中行要带 .dshgn_matchHit
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    const backBtn = window.document.querySelector('.dshgn_noteBack')
    if (backBtn) {
      backBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
    }
  } finally {
    panel.setConfirmDialog(null)
  }

  const box = await waitFor(() => window.document.querySelector('.dshgn_search'), 5000, '搜索框')
  const setInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setInput.call(box, '')
  box.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(260)

  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '标词验收',
      content: '# 标词验收\n\n今天去买了 荔枝 和 龙眼，荔枝 很甜。\n',
      withDatePrefix: false,
      requestId: 'seed-highlight-terms',
    }),
  })
  assert.equal((await res.json()).path, '随手记/标词验收.md')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const searchBox = await waitFor(() => window.document.querySelector('.dshgn_search'), 5000, '搜索框')
  setInput.call(searchBox, '荔枝')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))

  const line = await waitFor(
    () => {
      const all = Array.from(window.document.querySelectorAll('.dshgn_matchLine'))
      return all.find((el) => (el.textContent || '').includes('荔枝')) || null
    },
    8000,
    '搜索卡片上的命中行',
  )
  const marks = Array.from(line.querySelectorAll('.dshgn_matchHit'))
  assert.equal(marks.length, 2, '这一行里出现两次就该标两处：' + line.textContent)
  assert.equal(marks[0].textContent, '荔枝')
  assert.equal(marks[1].textContent, '荔枝')
  // 标出来的是原行的一部分，不是把整行换掉
  assert.ok((line.textContent || '').includes('今天去买了'), '没命中的字还得原样留着')

  // 清掉搜索框，别把词留给下一个用例
  setInput.call(searchBox, '')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(260)
})

test('编辑区里敲 [[ 就把库里的笔记名摆出来，挑一条补成双链', async () => {
  const { wikilinkQueryAt, wikilinkMatches } = panel.__internals
  const rootNode = () => window.document.querySelector('.dshgn_root')

  // 纯函数：什么时候算「在补全」
  assert.deepEqual(wikilinkQueryAt('看 [[随手', 6), { query: '随手', start: 4 })
  assert.deepEqual(wikilinkQueryAt('看 [[', 4), { query: '', start: 4 })
  assert.equal(wikilinkQueryAt('看 [[随手]] 了', 10), null, '已经闭合的不算在补全')
  assert.equal(wikilinkQueryAt('看 [[随手\n接着', 8), null, '跨行的不算')
  assert.equal(wikilinkQueryAt('没有方括号', 5), null)

  // 纯函数：挑哪几条、插什么进去
  const names = ['随手记/周报.md', '归档/周报.md', '随手记/随手一记.md', '随手记/别的.md']
  const hits = wikilinkMatches(names, '随手')
  assert.equal(hits.length, 1, '只留名字里带「随手」的：目录名不算，否则整个目录都会被列出来')
  assert.equal(hits[0].insert, '随手一记', '名字打头的排在前面，重名的才用整条路径')
  const dup = wikilinkMatches(names, '周报')
  assert.equal(dup.length, 2)
  assert.ok(dup.every((item) => item.insert.includes('/')), '两篇重名时要带上目录，否则插进去指错篇')
  assert.equal(wikilinkMatches(names, '根本没有').length, 0)

  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    const backBtn = window.document.querySelector('.dshgn_noteBack')
    if (backBtn) {
      backBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
    }
  } finally {
    panel.setConfirmDialog(null)
  }

  for (const [title, requestId] of [['补全目标甲', 'seed-wikilink-a'], ['补全目标乙', 'seed-wikilink-b']]) {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({
        dir: '随手记',
        title,
        content: ['# ' + title, '', '正文。', ''].join('\n'),
        withDatePrefix: false,
        requestId,
      }),
    })
    await res.json()
  }

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const card = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === '随手记/补全目标甲.md') || null,
    8000,
    '列表里应该有这一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 5000, '打开这一篇')

  const editBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '编辑')
  editBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const editor = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '进编辑态')

  // 敲到「[[补全目标」为止：候选该出来了
  editor.value = '# 补全目标甲\n\n看这里 [[补全目标'
  editor.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(120)
  const picks = () => Array.from(window.document.querySelectorAll('.dshgn_linkPickItem'))
  const shown = await waitFor(() => (picks().length > 0 ? picks() : null), 5000, '候选该摆出来')
  assert.equal(shown.length, 2, '库里两篇名字都对得上')
  assert.equal(shown[0].getAttribute('data-on'), 'true', '第一条默认选中')
  assert.ok(shown[0].textContent.includes('补全目标甲'))

  // 键盘往下挪一格再回车：插进去的是第二条，且补上了 ]]
  editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  await sleep(60)
  assert.equal(picks()[1].getAttribute('data-on'), 'true', '往下键该挪到第二条')
  editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await sleep(120)
  assert.equal(editor.value, '# 补全目标甲\n\n看这里 [[补全目标乙]]', '挑中的那条补上 ]] 落在光标处')
  assert.equal(editor.selectionStart, editor.value.length, '光标停在新补的双链后面')
  assert.equal(picks().length, 0, '补完就该收起来')

  // 再用鼠标点一次：从「[[补」开始重新选
  editor.value = '引一下 [[补'
  editor.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(120)
  const again = await waitFor(() => (picks().length > 0 ? picks() : null), 5000, '候选该再摆一次')
  again[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(120)
  assert.equal(editor.value, '引一下 [[补全目标甲]]', '鼠标点第一条也能补上')

  // 一条都对不上时不摆空盒子
  editor.value = '写点 [[完全没有的篇名'
  editor.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(120)
  assert.equal(picks().length, 0, '一条都没有时不该摆一个空列表')

  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_editor') === null, 5000, 'Esc 退出编辑态')
})

/**
 * 读到一半关掉，回来要还在原来那一行。
 *
 * 长笔记读到第三节、切去回个消息，回来又从第一行开始——得自己再翻一遍。
 * 这里守三件事：位置真的记下来了、回来真的放回去了、没记过的那篇从头开始
 * （正文容器是同一个 DOM 节点，不清的话会停在上一篇读到的地方）。
 */
test('读到哪儿记到哪儿，回来还停在那儿；没记过的那篇从头开始', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const { readScrollMarks, writeScrollMark, scrollMarkOf, SCROLL_KEY } = panel.__internals

  // 先验存取本身：最近翻过的排前面、同一篇只留一条、坏数据当没记过
  window.localStorage.removeItem(SCROLL_KEY)
  assert.deepEqual(readScrollMarks(), [], '没记过时是空的')
  assert.equal(scrollMarkOf('随手记/甲.md'), 0, '没记过的那篇当作从头开始')
  assert.equal(scrollMarkOf(''), 0)
  writeScrollMark('随手记/甲.md', 640)
  writeScrollMark('随手记/乙.md', 120)
  assert.equal(scrollMarkOf('随手记/甲.md'), 640)
  assert.equal(readScrollMarks().length, 2)
  assert.equal(readScrollMarks()[0].path, '随手记/乙.md', '最近翻过的排前面')
  writeScrollMark('随手记/甲.md', 900)
  assert.equal(readScrollMarks().length, 2, '同一篇只留一条')
  assert.equal(readScrollMarks()[0].path, '随手记/甲.md')
  assert.equal(scrollMarkOf('随手记/甲.md'), 900, '再记一次是覆盖不是追加')
  writeScrollMark('', 100)
  assert.equal(readScrollMarks().length, 2, '空路径不记')
  writeScrollMark('随手记/丙.md', -5)
  assert.equal(scrollMarkOf('随手记/丙.md'), 0, '负数按 0 算')
  // 存的东西坏了当作没记过，而不是抛错
  window.localStorage.setItem(SCROLL_KEY, '{ 这不是 JSON')
  assert.deepEqual(readScrollMarks(), [])
  window.localStorage.setItem(SCROLL_KEY, JSON.stringify([{ path: 3, top: 'x' }, { path: '好的.md', top: 10 }]))
  assert.deepEqual(readScrollMarks().map((item) => item.path), ['好的.md'], '形状不对的条目剔掉')
  // 不封顶的话这份表会一直长下去
  window.localStorage.removeItem(SCROLL_KEY)
  for (let i = 0; i < 45; i += 1) writeScrollMark('第' + i + '篇.md', i)
  assert.equal(readScrollMarks().length, 40, '只留最近 40 篇')
  window.localStorage.removeItem(SCROLL_KEY)

  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    const backBtn = window.document.querySelector('.dshgn_noteBack')
    if (backBtn) {
      backBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
    }
  } finally {
    panel.setConfirmDialog(null)
  }

  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '滚动位置验收',
      content: ['# 滚动位置验收', '', '第一段。', '', '第二段。', '', '第三段。', ''].join('\n'),
      withDatePrefix: false,
      requestId: 'seed-scroll-restore',
    }),
  })
  const seeded = await res.json()
  assert.equal(seeded.path, '随手记/滚动位置验收.md')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const openCard = async (path) => {
    const card = await waitFor(
      () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === path) || null,
      8000,
      '列表里应该有 ' + path,
    )
    card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 5000, '打开 ' + path)
    // 面板里不止一个 .dshgn_scroll（左栏列表也是），要的是正文那一层
    return waitFor(() => window.document.querySelector('.dshgn_note .dshgn_scroll'), 5000, '正文容器')
  }
  const back = async () => {
    panel.setConfirmDialog(() => Promise.resolve(true))
    try {
      const btn = window.document.querySelector('.dshgn_noteBack')
      if (btn) btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回列表')
    } finally {
      panel.setConfirmDialog(null)
    }
  }

  // 打开、往下翻到 720，等防抖把它记下来
  const liveScroller = () => window.document.querySelector('.dshgn_note .dshgn_scroll')
  let scroller = await openCard(seeded.path)
  await sleep(150)
  assert.equal(liveScroller().scrollTop, 0, '没记过的那篇从头开始')
  liveScroller().scrollTop = 720
  liveScroller().dispatchEvent(new window.Event('scroll', { bubbles: false }))
  await sleep(600)
  assert.equal(scrollMarkOf(seeded.path), 720, '翻过的地方要记下来')

  // 切到别的一篇再回来：位置要放回去
  await back()
  const other = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') !== seeded.path) || null,
    8000,
    '列表里还有别的笔记',
  )
  other.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 5000, '打开另一篇')
  await waitFor(() => window.document.querySelector('.dshgn_note .dshgn_scroll'), 5000, '正文容器')
  await sleep(150)
  assert.equal(liveScroller().scrollTop, 0, '没记过的那篇从头开始，不能停在上一篇读到的地方')
  await back()

  scroller = await openCard(seeded.path)
  await sleep(250)
  assert.equal(liveScroller().scrollTop, 720, '回来还停在上次读到的地方')

  // 回到顶上也算「读到哪儿」：再翻回 0，记的应该是 0
  liveScroller().scrollTop = 0
  liveScroller().dispatchEvent(new window.Event('scroll', { bubbles: false }))
  await sleep(600)
  assert.equal(scrollMarkOf(seeded.path), 0, '翻回顶上就记 0，别留着上一次的位置')
  window.localStorage.removeItem(SCROLL_KEY)
})



test('正文里就地找一句话，回车往下走、Shift+回车往回走，到头了明说', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')

  // 前一个用例可能把某篇开着、搜索框里还留着词，先退回干净的空态
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    const backBtn = window.document.querySelector('.dshgn_noteBack')
    if (backBtn) {
      backBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
    }
  } finally {
    panel.setConfirmDialog(null)
  }

  const searchBox = await waitFor(() => window.document.querySelector('.dshgn_search'), 5000, '搜索框')
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setValue.call(searchBox, '')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(260)

  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '就地查找验收',
      content: '# 就地查找验收\n\n开头一段没有那个词。\n\n中间写着 桂圆 两个字。\n\n结尾又提到 桂圆 一次。\n',
      withDatePrefix: false,
      requestId: 'seed-find-in-body',
    }),
  })
  assert.equal((await res.json()).path, '随手记/就地查找验收.md')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const card = await waitFor(
    () => {
      const all = Array.from(window.document.querySelectorAll('.dshgn_card'))
      return all.find((el) => (el.textContent || '').includes('就地查找验收')) || null
    },
    8000,
    '列表里的那一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '打开笔记')

  // jsdom 没有排版：所有元素的 getBoundingClientRect 都是 0，那样「哪个块在视野上方」
  // 全都没有答案，查找会一直停在同一处。这里给正文里的块补一份假排版（每条往下
  // 挪 100px，再减去已经滚过去的距离），让「下一处」真的存在。
  const realRect = window.HTMLElement.prototype.getBoundingClientRect
  const realScrollTo = window.HTMLElement.prototype.scrollTo
  const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th'
  // 每个块都是「第几条 × 100px」，滚动之后减去已滚的距离——与浏览器里一样，
  // 滚过去的块 top 会变成负数。
  const blockTopOf = (node) => {
    const note = node.closest ? node.closest('.dshgn_note .dshgn_scroll') : null
    if (note === null || note === undefined) return null
    const index = Array.from(note.querySelectorAll(BLOCKS)).indexOf(node)
    return index < 0 ? null : index * 100
  }
  window.HTMLElement.prototype.getBoundingClientRect = function fakeRect() {
    const note = this.classList && this.classList.contains('dshgn_scroll') && this.closest('.dshgn_note')
    if (note) return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 }
    const base = blockTopOf(this)
    if (base !== null) {
      const top = base - (this.closest('.dshgn_scroll').scrollTop || 0)
      return { top, bottom: top + 40, left: 0, right: 0, width: 0, height: 40, x: 0, y: top }
    }
    return realRect.call(this)
  }
  // jsdom 的 scrollTo 是空实现，滚完位置不会变；这里让它真把 scrollTop 挪过去，
  // 下一处才能「在视野下方」变成「在视野上方」。
  window.HTMLElement.prototype.scrollTo = function fakeScrollToTo(options) {
    if (options && typeof options.top === 'number') this.scrollTop = options.top
  }
  try {
    // 打开查找条：笔记头那颗放大镜，点一次展开、再点一次收起
    const findBtn = () => Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '在这篇里找')
    assert.ok(findBtn() !== undefined, '笔记头上应该有个「在这篇里找」')
    findBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    const input = await waitFor(() => window.document.querySelector('.dshgn_findInput'), 5000, '查找输入框')
    assert.equal(findBtn().getAttribute('data-on'), 'true', '开着的时候按钮要亮')

    // 敲词、回车：视野落到第一个含这个词的块上（滚动容器自己重查，别攥旧节点）
    const liveScroller = () => window.document.querySelector('.dshgn_note .dshgn_scroll')
    setValue.call(input, '桂圆')
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(120)
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await sleep(150)
    const first = liveScroller().scrollTop
    assert.ok(first > 0, '回车应该落到第一处「桂圆」')

    // 再回车：往下走到第二处
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await sleep(150)
    const second = liveScroller().scrollTop
    assert.ok(second > first, '再回车应该继续往下走')

    // Shift+回车：回到上一处
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    await sleep(150)
    assert.ok(liveScroller().scrollTop < second, 'Shift+回车应该往回走')

    // 到头了要明说，别静默不动让人以为敲错了词
    const toast = () => window.document.querySelector('.dshgn_toast')
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await sleep(200)
    assert.ok(toast() !== null && (toast().textContent || '').includes('到头了'), '到头了要说一声')

    // 一个词都找不到：说的是「这篇里没有」
    setValue.call(input, '根本没有这个词')
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(120)
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await sleep(200)
    assert.ok((toast().textContent || '').includes('这篇里没有'), '找不到要说「这篇里没有」')

    // Esc 收起查找条
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await sleep(150)
    assert.equal(window.document.querySelector('.dshgn_findInput'), null, 'Esc 应该收起查找条')

    // 渲染器层：空词直接当没找，不滚也不报
    assert.equal(panel.__internals.findInBody(window.document.body, ''), null)
    assert.equal(panel.__internals.findInBody(window.document.body, '   '), null)
  } finally {
    window.HTMLElement.prototype.getBoundingClientRect = realRect
    window.HTMLElement.prototype.scrollTo = realScrollTo
  }
})

test('列表能在「最近改的」和「按名称」之间切，切完记着下次还按这个排', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')

  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    const backBtn = window.document.querySelector('.dshgn_noteBack')
    if (backBtn) {
      backBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
    }
  } finally {
    panel.setConfirmDialog(null)
  }

  const searchBox = await waitFor(() => window.document.querySelector('.dshgn_search'), 5000, '搜索框')
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setValue.call(searchBox, '')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(260)

  // 两篇：名字上 A 在前，但 A 先建、B 后建，所以「最近改的」那条路上 B 在前。
  // 这样两种顺序互不相同，切一下就能看出确实换了排法。
  for (const [title, requestId] of [
    ['排序验收A', 'seed-list-sort-a'],
    ['排序验收B', 'seed-list-sort-b'],
  ]) {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '随手记', title, content: '正文', withDatePrefix: false, requestId }),
    })
    assert.equal((await res.json()).path, '随手记/' + title + '.md')
  }

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  // 只认这两篇的先后，别让库里别的笔记搅进来
  const orderOf = () =>
    Array.from(window.document.querySelectorAll('.dshgn_card'))
      .map((el) => el.textContent || '')
      .filter((text) => text.includes('排序验收'))
      .map((text) => (text.includes('排序验收A') ? 'A' : 'B'))

  const sortBtn = await waitFor(
    () => window.document.querySelector('.dshgn_listSort'),
    5000,
    '列表排序开关',
  )
  // 默认是「最近改的」：后建的 B 在前
  assert.equal(sortBtn.textContent, '⏱', '默认该是最近改的在前')
  assert.deepEqual(orderOf(), ['B', 'A'], '默认按修改时间倒序，后建的排前面')

  sortBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(200)
  assert.equal(sortBtn.textContent, 'A→Z', '点一下该切到按名称')
  assert.deepEqual(orderOf(), ['A', 'B'], '按名称时 A 在前')
  assert.equal(window.localStorage.getItem('dshgn.listSort'), 'name', '选择要记下来')

  // 搜索态不给这个开关：那边的顺序是相关度排的，换成本地排序反而把最该看的挤下去
  setValue.call(searchBox, '排序验收')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
  // 要等 /search 真的回来（那边有 220ms 防抖 + 一次请求），搜索态才成立
  await waitFor(
    () => window.document.querySelector('.dshgn_listSort') === null,
    5000,
    '搜索时收起排序开关',
  )

  setValue.call(searchBox, '')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(300)

  // 切回「最近改的」，把偏好还原，免得影响后面的用例
  const backSort = window.document.querySelector('.dshgn_listSort')
  backSort.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(200)
  assert.equal(window.localStorage.getItem('dshgn.listSort'), 'time')
  window.localStorage.removeItem('dshgn.listSort')
})

test('阅读态按 Ctrl+F 直接把查找条叫出来，编辑态按下去找的是正文里那一段字', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')

  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    const backBtn = window.document.querySelector('.dshgn_noteBack')
    if (backBtn) {
      backBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
    }
  } finally {
    panel.setConfirmDialog(null)
  }

  const searchBox = await waitFor(() => window.document.querySelector('.dshgn_search'), 5000, '搜索框')
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setValue.call(searchBox, '')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(260)

  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '快捷键查找验收',
      content: '# 快捷键查找验收\n\n第一段写着 龙眼 两个字。\n\n第二段又提到 龙眼 一次。\n',
      withDatePrefix: false,
      requestId: 'seed-find-shortcut',
    }),
  })
  assert.equal((await res.json()).path, '随手记/快捷键查找验收.md')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const card = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => (el.textContent || '').includes('快捷键查找验收')) || null,
    8000,
    '列表里的那一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '打开笔记')

  const findBtn = () => Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '在这篇里找')

  // 阅读态：焦点不在输入框里，Ctrl+F 就该把查找条叫出来。
  // 原来是「鼠标去点笔记头那颗放大镜」才行——宿主里这是肌肉记忆。
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
  const input = await waitFor(() => window.document.querySelector('.dshgn_findInput'), 5000, 'Ctrl+F 该叫出查找条')
  assert.equal(findBtn().getAttribute('data-on'), 'true', '查找条开着时那颗按钮要亮')
  assert.equal(input.getAttribute('placeholder'), '找什么…', '阅读态的占位文字是「在这篇里找」')
  assert.equal(findBtn().getAttribute('aria-keyshortcuts'), 'Control+F Meta+F', '按钮上要写着这个快捷键')

  // 再按一次不该把它关掉（那是「叫出来」的手势，不是开关）
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
  await sleep(120)
  assert.ok(window.document.querySelector('.dshgn_findInput') !== null, '再按一次仍然是开着')

  // 焦点在输入框里时，Ctrl+F 不该被面板抢走（那是「在那个框里找」）
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
  await sleep(80)
  assert.ok(window.document.querySelector('.dshgn_findInput') !== null)

  // 收起，进编辑态
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(150)
  assert.equal(window.document.querySelector('.dshgn_findInput'), null, 'Esc 应该收起查找条')

  const editBtn = () => Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '编辑')
  editBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const editor = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '进编辑态')

  // 编辑态：正文没渲染，Ctrl+F 找的是 textarea 里那一段字，挪的是选区
  editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
  const editInput = await waitFor(() => window.document.querySelector('.dshgn_findInput'), 5000, '编辑态也要能叫出查找条')
  assert.equal(editInput.getAttribute('placeholder'), '在正文里找什么…', '编辑态的占位文字说的是「在正文里」')
  assert.ok((window.document.querySelector('.dshgn_editorHint').textContent || '').includes('Ctrl+F'), '提示行里写得出 Ctrl+F')

  // 光标放在开头，找「龙眼」：选区落到第一处
  editor.focus()
  editor.setSelectionRange(0, 0)
  setValue.call(editInput, '龙眼')
  editInput.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(120)
  editInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await sleep(150)
  const body = editor.value
  const firstAt = body.indexOf('龙眼')
  assert.equal(editor.selectionStart, firstAt, '回车该选中正文里第一处「龙眼」')
  assert.equal(editor.selectionEnd, firstAt + 2, '选中两个字')

  // 再回车：往下走到第二处（不是原地再选一遍）
  editInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await sleep(150)
  const secondAt = body.indexOf('龙眼', firstAt + 2)
  assert.equal(editor.selectionStart, secondAt, '再回车该往下走到第二处')

  // Shift+回车：往回走
  editInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
  await sleep(150)
  assert.equal(editor.selectionStart, firstAt, 'Shift+回车该回到上一处')

  // 到头了要明说
  const toast = () => window.document.querySelector('.dshgn_toast')
  editInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  editInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await sleep(200)
  assert.ok(toast() !== null && (toast().textContent || '').includes('到头了'), '编辑态到头了也要说一声')

  // 一个词都没有：说的是「这篇里没有」
  setValue.call(editInput, '根本没有这个词')
  editInput.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(120)
  editInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await sleep(200)
  assert.ok((toast().textContent || '').includes('这篇里没有'), '编辑态找不到也要说「这篇里没有」')

  // Esc 收起查找条，焦点要回到编辑区（不然接着敲的字全进了那个藏起来的框）
  editInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(200)
  assert.equal(window.document.querySelector('.dshgn_findInput'), null, 'Esc 应该收起查找条')
  assert.equal(window.document.activeElement, window.document.querySelector('.dshgn_editor'), '焦点要回到编辑区')

  // 纯函数：起点取「选区末尾」往下、取「选区开头」往上，空词当没找
  const findInText = panel.__internals.findInText
  assert.equal(findInText('甲龙眼乙龙眼丙', '龙眼', 0, 0, true).start, 1, '从光标往下找第一处')
  assert.equal(findInText('甲龙眼乙龙眼丙', '龙眼', 0, 0, true).end, 3, '区间是两个字的宽度')
  assert.equal(findInText('甲龙眼乙龙眼丙', '龙眼', 7, 7, true), null, '到底了就没有下一处')
  assert.equal(findInText('甲龙眼乙龙眼丙', '龙眼', 4, 4, false).start, 1, '往回找上一处')
  assert.equal(findInText('甲龙眼乙龙眼丙', '龙眼', 1, 1, false), null, '到头了就没有上一处')
  assert.equal(findInText('甲龙眼乙龙眼丙', '', 0, 0, true), null, '空词当没找')
  assert.equal(findInText('', '龙眼', 0, 0, true), null, '空正文当没找')
  // 大小写不敏感，但选区落在原文上
  assert.equal(findInText('Alpha beta ALPHA', 'alpha', 0, 0, true).start, 0)
  assert.equal(findInText('Alpha beta ALPHA', 'alpha', 6, 6, true).start, 11, '第二处按原文的位置给')

  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_editor') === null, 5000, 'Esc 退出编辑态')
})



test('在笔记之间前进后退：Alt+← 回上一篇、Alt+→ 再走回去，按钮跟着亮灭', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')

  // 前一个用例可能把某篇开着、搜索框里还留着词，先退回干净的空态
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    const backBtn = window.document.querySelector('.dshgn_noteBack')
    if (backBtn) {
      backBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
    }
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    searchBox.value = ''
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(260)
  }

  // 两篇分两次建：先建的那篇在列表里更靠后，点开顺序才和「最近改的」不一样，
  // 于是栈里的先后就是点击的先后，不会被列表顺序带跑。
  const seedOne = async (title, requestId) => {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({
        dir: '随手记',
        title,
        content: '# ' + title + '\n\n这是 ' + title + ' 的正文。\n',
        withDatePrefix: false,
        requestId,
      }),
    })
    return (await res.json()).path
  }
  const pathA = await seedOne('导航验收A', 'seed-nav-a')
  const pathB = await seedOne('导航验收B', 'seed-nav-b')
  assert.equal(pathA, '随手记/导航验收A.md')
  assert.equal(pathB, '随手记/导航验收B.md')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const notePath = () => {
    const el = window.document.querySelector('.dshgn_notePath')
    return el ? el.textContent : null
  }
  const navBtn = (title) => Array.from(window.document.querySelectorAll('.dshgn_navBtn')).find((el) => el.title === title)
  const openCard = async (path) => {
    const card = await waitFor(
      () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === path) || null,
      8000,
      '列表里应该有 ' + path,
    )
    card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => notePath() === path, 5000, '打开 ' + path)
  }
  const backToList = async () => {
    panel.setConfirmDialog(() => Promise.resolve(true))
    try {
      window.document.querySelector('.dshgn_noteBack').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回列表')
    } finally {
      panel.setConfirmDialog(null)
    }
  }
  const altKey = (key) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key, altKey: true, bubbles: true }))

  // 刚点开一篇时「去下一篇」一定是灰的：从列表点开就是新的一步，
  // 前面那截「前进」当场作废（和浏览器一样，否则前进会跳到一条已经
  // 不在路径上的分支）。整个测试文件共用同一个面板实例，所以「能不能
  // 回上一篇」要看前面用例攒下的历史，这里不断言它。
  await openCard(pathA)
  assert.equal(navBtn('去下一篇').disabled, true, '刚打开一篇时没有下一篇')

  // 从列表点开第二篇：栈顶就是 B，它前面是 A
  await backToList()
  await openCard(pathB)
  assert.equal(navBtn('回上一篇').disabled, false, '开过两篇了，应该能回上一篇')
  assert.equal(navBtn('去下一篇').disabled, true, '还没退回去过，没有下一篇')

  // Alt+← 回上一篇：Alt 不按住时不该被当成导航
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  await sleep(200)
  assert.equal(notePath(), pathB, '不按 Alt 的左键不该换篇')
  altKey('ArrowLeft')
  await waitFor(() => notePath() === pathA, 5000, 'Alt+← 应该回到上一篇')
  assert.equal(navBtn('去下一篇').disabled, false, '退回来之后就能再往前走')

  // Alt+→ 走回去
  altKey('ArrowRight')
  await waitFor(() => notePath() === pathB, 5000, 'Alt+→ 应该回到下一篇')
  assert.equal(navBtn('去下一篇').disabled, true, '走到最新的一篇了')

  // 鼠标也能用：点那颗「回上一篇」
  navBtn('回上一篇').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => notePath() === pathA, 5000, '点按钮也该回上一篇')

  // 有没保存的草稿时先问一句：答「不」就留在原地，答「好」才走
  const editBtn = () => Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '编辑')
  editBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const editor = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '进编辑态')
  editor.value = editor.value + '改了一句。'
  editor.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(120)

  let asked = 0
  panel.setConfirmDialog(() => {
    asked += 1
    return Promise.resolve(false)
  })
  try {
    altKey('ArrowRight')
    await sleep(400)
    assert.equal(asked, 1, '有草稿时要先问一句')
    assert.equal(notePath(), pathA, '答「不」就留在这一篇')
  } finally {
    panel.setConfirmDialog(null)
  }

  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    altKey('ArrowRight')
    await waitFor(() => notePath() === pathB, 5000, '答「好」就换篇')
  } finally {
    panel.setConfirmDialog(null)
  }

  // 后退/前进自己触发的那次打开不再入栈，否则「前进」永远回不去
  assert.equal(navBtn('回上一篇').disabled, false)
  assert.equal(navBtn('去下一篇').disabled, true, '走回最新那篇后不该还有「下一篇」')

  // 在编辑区里按 Alt+← 也照样该生效（用户常常刚改完字就想回上一篇看一眼）。
  // 换篇会把编辑态收起，所以这里重新点一次「编辑」。
  editBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const editorAgain = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '再进一次编辑态')
  editorAgain.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }))
  await waitFor(() => notePath() === pathA, 5000, '编辑区里 Alt+← 也要回上一篇')

  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_editor') === null, 5000, 'Esc 退出编辑态')
})

