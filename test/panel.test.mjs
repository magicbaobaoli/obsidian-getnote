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
  // 同一次拖动带两份载荷：text/plain 是拖给外面（宿主编辑器）的链接，
  // 私有 MIME 是拖给面板自己左栏目录用的路径。见 DRAG_MIME。
  const plain = written.filter((item) => item[0] === 'text/plain')
  assert.deepEqual(plain, [['text/plain', '[[宿主给的链接]]']], '拖出去的内容应当是宿主给的链接')
  assert.equal(
    written.filter((item) => item[0] === 'application/x-getnote-path').length,
    1,
    '还要带一份面板口径的路径，拖到左栏目录上才认得出是哪一篇',
  )
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
  assert.equal(second.filter((item) => item[0] === 'text/plain').length, 1, '拿不到链接格式也要给出一份可用的文本')
  assert.match(
    second.find((item) => item[0] === 'text/plain')[1],
    /右键菜单验收\.md$/,
    '退回的是这篇的路径，实际 ' + second[0][1],
  )

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
  assert.ok((row.textContent || '').includes('第 '), '这一行要标出是第几行：' + row.textContent)
  // 组头和组里的行是兄弟节点（Fragment 里先组头、再逐行），所以不能从行往上找，
  // 按组的 title（整条路径）去认那一组。
  const groupHead = Array.from(window.document.querySelectorAll('.dshgn_todoGroup')).find(
    (el) => (el.getAttribute('title') || '').endsWith('待办验收.md'),
  )
  assert.ok(groupHead !== undefined && groupHead !== null, '组头要标出这条待办在哪一篇')
  assert.ok(
    (groupHead.textContent || '').includes('待办验收'),
    '组头要写着这一篇的篇名：' + (groupHead ? groupHead.textContent : ''),
  )

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

  // 搜索态这个开关还在，只是换成另一档：默认按相关度（服务端排的），
  // 点一下变「按名称」。两档各记各的，互不改写。
  setValue.call(searchBox, '排序验收')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
  // 要等 /search 真的回来（那边有 220ms 防抖 + 一次请求），搜索态才成立
  await waitFor(
    () => {
      const btn = window.document.querySelector('.dshgn_listSort')
      return btn !== null && btn.getAttribute('data-mode') === 'search'
    },
    5000,
    '搜索态仍摆着排序开关，只是换了一档',
  )
  const searchSortBtn = window.document.querySelector('.dshgn_listSort')
  assert.equal(searchSortBtn.textContent, '★', '搜索态默认按相关度')
  assert.ok(
    String(searchSortBtn.getAttribute('title') || '').includes('按相关度'),
    '悬停要说清这会儿按什么排：' + searchSortBtn.getAttribute('title'),
  )
  searchSortBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(220)
  assert.equal(searchSortBtn.textContent, 'A→Z', '点一下搜索态切到按名称')
  assert.equal(window.localStorage.getItem('dshgn.searchSort'), 'name', '搜索态的排序也要记下来')
  assert.equal(
    window.localStorage.getItem('dshgn.listSort'),
    'name',
    '搜索态切排序不该顺手改掉列表那一档',
  )
  // 按名称时命中是按名字排的
  const searchOrder = () =>
    Array.from(window.document.querySelectorAll('.dshgn_card'))
      .map((el) => el.textContent || '')
      .filter((text) => text.includes('排序验收'))
      .map((text) => (text.includes('排序验收A') ? 'A' : 'B'))
  assert.deepEqual(searchOrder(), ['A', 'B'], '搜索态按名称时 A 在前')
  // 切回相关度，把这一档也还原
  searchSortBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(220)
  assert.equal(window.localStorage.getItem('dshgn.searchSort'), 'time')
  window.localStorage.removeItem('dshgn.searchSort')

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

/**
 * 宿主里 Ctrl/Cmd+E 在「编辑」和「阅读」之间来回切，是最省事的那条路。
 * 面板的编辑器是草稿式的，所以这个键在编辑态必须「先落盘再退」——直接退
 * 等于把刚写的那几句丢掉，而用户按这个键的意思是「我看完了」。
 */
test('Ctrl+E 在阅读态进编辑、编辑态存好再退，没改过就不白写一次盘', async () => {
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
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    searchBox.value = ''
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(260)
  }

  const rel = '随手记/退出编辑验收.md'
  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '退出编辑验收',
      content: '# 退出编辑验收\n\n原来的第一句。\n',
      withDatePrefix: false,
      requestId: 'seed-ctrl-e-leave',
    }),
  })
  assert.equal((await res.json()).path, rel)

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const card = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === rel) || null,
    8000,
    '列表里应该有这一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '笔记打开')

  const readBack = async () => {
    const got = await realFetch(server.origin + '/getnote/read?path=' + encodeURIComponent(rel), {
      headers: { 'x-getnote-token': server.token },
    })
    return (await got.json()).content
  }
  const savesNow = () => fetchCalls.filter((url) => url.includes('/getnote/save')).length
  const ctrlE = (extra) =>
    window.dispatchEvent(
      new window.KeyboardEvent('keydown', Object.assign({ key: 'e', ctrlKey: true, metaKey: true, bubbles: true }, extra || {})),
    )
  const editBtn = () => Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '编辑')

  // 等一拍再按键：面板的快捷键监听是 effect 挂的，新闭包要等 React 把
  // effect 排到才生效；点开笔记的同一个 tick 里按下去会落到旧闭包上。
  await sleep(120)

  // 阅读态按下去：进编辑态（这时候不该写盘）
  const savesBeforeEnter = savesNow()
  ctrlE()
  const editor = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, 'Ctrl+E 应该进编辑态')
  assert.equal(savesNow(), savesBeforeEnter, '只是进编辑态，不该写盘')
  assert.ok(
    ((window.document.querySelector('.dshgn_editorFoot') || {}).textContent || '').includes('Ctrl+E'),
    '脚下那条提示要写上这个键',
  )

  // 不按修饰键敲 e、或者按着 Alt 敲，都不该被当成这个动作
  editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'e', bubbles: true }))
  await sleep(120)
  assert.ok(window.document.querySelector('.dshgn_editor'), '光敲 e 不该退出编辑态')
  editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'e', altKey: true, bubbles: true }))
  await sleep(120)
  assert.ok(window.document.querySelector('.dshgn_editor'), 'Alt+E 不该被当成这个动作')

  // 没改过就按：退出编辑态，但不白写一次盘
  const savesBeforeClean = savesNow()
  ctrlE()
  await waitFor(() => window.document.querySelector('.dshgn_editor') === null, 5000, '没改过也照样退出编辑态')
  await sleep(200)
  assert.equal(savesNow(), savesBeforeClean, '正文没变就不该打保存')

  // 改一句再按：先落盘、再退出，磁盘上要真的是新内容
  editBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const editor2 = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '再进一次编辑态')
  editor2.value = editor2.value + '补一句刚想到的。\n'
  editor2.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(120)

  const savesBeforeDirty = savesNow()
  ctrlE()
  await waitFor(() => savesNow() > savesBeforeDirty, 8000, '改过就要真的打一次保存')
  await waitFor(() => window.document.querySelector('.dshgn_editor') === null, 8000, '存好之后退出编辑态')
  // waitFor 只认同步判定，读盘要自己轮询（否则第一下没读到就直接判红）
  let onDisk = ''
  for (let attempt = 0; attempt < 80; attempt += 1) {
    onDisk = await readBack()
    if (onDisk.includes('补一句刚想到的')) break
    await sleep(100)
  }
  assert.ok(onDisk.includes('补一句刚想到的'), '磁盘上要真的是新内容：' + onDisk)
  assert.equal(rootNode().getAttribute('data-has-note'), 'true', '退出编辑态，但还留在这篇上')
})

test('编辑区里敲 # 就把库里用过的标签摆出来，挑一条补上去且不自动加空格', async () => {
  const { tagQueryAt, tagMatches } = panel.__internals

  // 纯函数：只在「# 后面正打着一串、前面是行首或空白」时才算在补标签
  assert.deepEqual(tagQueryAt('写点 #生', 5), { query: '生', start: 4 })
  assert.deepEqual(tagQueryAt('#生活', 3), { query: '生活', start: 1 })
  assert.equal(tagQueryAt('#', 1), null, '刚敲一个井号还没打字，不弹')
  assert.equal(tagQueryAt('C#', 2), null, 'C# 这种紧贴着字的井号不算标签')
  assert.equal(tagQueryAt('## 标题', 5), null, '## 是标题，不是标签')
  assert.equal(tagQueryAt('[[笔记#小节', 7), null, '双链里的井号是在补小节')
  assert.equal(tagQueryAt('没有井号', 4), null)
  assert.equal(tagQueryAt('写点 #生 活', 7), null, '中间隔了空白，已经不在这个标签里')

  // 纯函数：只补库里已经用过的标签，打头的排前面
  const tags = ['生活', '生活记录', '读书', '随手']
  const hits = tagMatches(tags, '生活')
  assert.equal(hits.length, 2)
  assert.equal(hits[0].insert, '生活')
  assert.equal(hits[0].label, '#生活')
  assert.equal(hits[0].close, '', '标签不用补右括号')
  assert.equal(tagMatches(tags, '读').length, 1)
  assert.equal(tagMatches(tags, '没有这个').length, 0)
  assert.equal(tagMatches(tags, '').length, 4, '空查询就是全都摆出来')

  // 真渲染：库里先有带标签的笔记，再在编辑区里敲 # 补一条
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
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    searchBox.value = ''
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(260)
  }

  const rel = '随手记/标签补全验收.md'
  const seeded = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '标签补全验收',
      content: '# 标签补全验收\n\n先写几个标签：#生活 #读书 #随手\n',
      withDatePrefix: false,
      requestId: 'seed-tag-complete',
    }),
  })
  assert.equal((await seeded.json()).path, rel)

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)
  const card = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === rel) || null,
    8000,
    '标签补全验收的卡片',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '打开标签补全验收')

  const editBtn = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '编辑') || null,
    5000,
    '编辑按钮',
  )
  editBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const editor = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '编辑区')

  // 敲到「#生」：候选里应该摆出库里那两个带「生活」的标签
  editor.value = '# 标签补全验收\n\n再补一个 #生'
  editor.dispatchEvent(new window.Event('input', { bubbles: true }))
  editor.setSelectionRange(editor.value.length, editor.value.length)
  const items = await waitFor(
    () => {
      const found = window.document.querySelectorAll('.dshgn_linkPickItem')
      return found.length > 0 ? Array.from(found) : null
    },
    5000,
    '标签候选',
  )
  const labels = items.map((node) => node.textContent)
  assert.ok(labels.some((text) => text.includes('#生活')), '候选里要有 #生活：' + labels.join('、'))
  assert.equal(items[0].getAttribute('data-on'), 'true', '第一条默认选中')

  // 回车补上：变成 #生活，不带 ]]，光标停在后面
  editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await sleep(120)
  assert.equal(editor.value, '# 标签补全验收\n\n再补一个 #生活', '补上的标签不加右括号')
  assert.equal(editor.selectionStart, editor.value.length, '光标停在补好的标签后面')
  assert.equal(window.document.querySelectorAll('.dshgn_linkPickItem').length, 0, '补完候选收起')

  // 库里没有的标签：不弹空盒子，用户照样能敲完
  editor.value = '# 标签补全验收\n\n全新的 #根本没有这个标签'
  editor.dispatchEvent(new window.Event('input', { bubbles: true }))
  editor.setSelectionRange(editor.value.length, editor.value.length)
  await sleep(200)
  assert.equal(window.document.querySelectorAll('.dshgn_linkPickItem').length, 0, '一条都对不上就不弹')

  // 收尾：退出编辑态，别把草稿留在面板上
  editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(120)
})

/**
 * 反链底下那句上下文点一下 = 去那一句，不是只把人送到篇首。
 *
 * 反链最常用的场景就是「我记得在哪篇里提过，是哪一段来着」。以前只能点开
 * 那一篇，然后自己在整篇里再找一遍；现在点那句话就落到那一段。
 */
test('反链底下那句上下文点一下就落到那一句，不是只送到篇首', async () => {
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

  // 目标那篇要够长：落到第二段和停在篇首才分得出来
  const target = await seed(
    '反链跳句目标',
    ['# 反链跳句目标', '', '第一段，跟这次跳转无关。', '', '第二段，也无关。', '', '第三段，还是无关。', ''].join('\n'),
    'seed-bl-jump-target',
  )
  await seed(
    '反链跳句来源',
    ['# 反链跳句来源', '', '开头一句废话。', '', '中间这句提到 [[反链跳句目标]] 并且后面还有半句。', ''].join('\n'),
    'seed-bl-jump-source',
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

  const snip = await waitFor(
    () => window.document.querySelector('.dshgn_backlinkSnipLink'),
    8000,
    '上下文那一行应该是能点的',
  )
  assert.equal(snip.getAttribute('title'), '去这一句', '悬停要说清楚点它会去哪')
  assert.ok((snip.textContent || '').includes('中间这句提到'), '这一行就是引用那一行剩下的字')

  // 假排版：jsdom 不算布局，不铺一下的话滚到哪儿都看不出来
  const realRect = window.HTMLElement.prototype.getBoundingClientRect
  const realScrollTo = window.HTMLElement.prototype.scrollTo
  let fakeTop = 0
  const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th'
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const host = this.closest ? this.closest('.dshgn_scroll') : null
    if (!host || !this.matches || !this.matches(BLOCKS)) {
      return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }
    }
    const all = Array.from(host.querySelectorAll(BLOCKS))
    const index = all.indexOf(this)
    return { top: index * 100 - (host.scrollTop || 0), left: 0, right: 0, bottom: 0, width: 0, height: 0 }
  }
  window.HTMLElement.prototype.scrollTo = function (options) {
    if (!options || typeof options.top !== 'number') return
    this.scrollTop = options.top
    fakeTop = options.top
  }
  try {
    const liveScroller = () => window.document.querySelector('.dshgn_note .dshgn_scroll')
    assert.equal(liveScroller().scrollTop, 0, '刚打开时停在篇首')

    snip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

    // 那一篇读回来之后才会滚，等滚动容器动起来
    await waitFor(() => (liveScroller() || {}).scrollTop > 0, 8000, '点了那句话就滚到那一句')
    assert.ok(fakeTop > 0, '滚的是正文自己的容器')
    const notePathText = (window.document.querySelector('.dshgn_notePath') || {}).textContent || ''
    assert.equal(notePathText, '随手记/反链跳句来源.md', '去的是引用方那一篇，不是被引的那一篇')

    // 上下文里双链被削掉了，正文里它是个胶囊：整串比不过也得认出来
    const body = window.document.querySelector('.dshgn_note')
    assert.ok((body.textContent || '').includes('中间这句提到'), '落到了写着这句话的那一段')
    assert.ok(!(body.textContent || '').includes('第一段，跟这次跳转无关。'), '目标篇的内容不该混进来')
  } finally {
    window.HTMLElement.prototype.getBoundingClientRect = realRect
    window.HTMLElement.prototype.scrollTo = realScrollTo
  }

  // 纯函数：整串能比上就用整串，比不上按词顺序找
  const textHasParts = panel.__internals.textHasParts
  assert.equal(textHasParts('开会时记到 反链目标 这一段', '开会时记到 这一段'), true, '双链削掉之后按词也认得出')
  assert.equal(textHasParts('开会时记到 反链目标 这一段', '开会时记到'), true, '整串能比上就按整串')
  assert.equal(textHasParts('别的话', '开会时记到 这一段'), false, '顺序不对就不认')
  assert.equal(textHasParts('这一段 开会时记到', '开会时记到 这一段'), false, '词序反了不算同一行')
  assert.equal(textHasParts('', '开会时记到'), false)
  assert.equal(textHasParts('开会时记到', ''), false)

  // 收尾：退回列表，别把这篇留着影响后面的用例
  const back2 = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back2) back2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '收尾退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
})

test('嵌套标签按斜杠摊成层级，点父标签也把子标签的笔记收进来', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const seed = async (title, tags, requestId) => {
    const content = ['---', 'tags: [' + tags.join(', ') + ']', '---', '', '# ' + title, '', '正文', ''].join('\n')
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '随手记', title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    return json.path
  }

  // 上一个用例可能把某篇开着：先退回空态，标签云才在左栏里
  const back = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  const pathA = await seed('嵌套标签甲', ['嵌套验收/子甲'], 'seed-nested-tag-a')
  const pathB = await seed('嵌套标签乙', ['嵌套验收/子乙'], 'seed-nested-tag-b')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const tagRows = () => Array.from(window.document.querySelectorAll('.dshgn_tagRow'))
  const rowOf = (title) => tagRows().find((el) => el.title === title) || null

  // 父标签与两颗子标签各占一行：以前它们并排摆着，看不出谁属于谁
  const parent = await waitFor(() => rowOf('嵌套验收'), 8000, '父标签要有一行')
  const childA = rowOf('嵌套验收/子甲')
  const childB = rowOf('嵌套验收/子乙')
  assert.ok(childA !== null && childB !== null, '子标签也要各占一行')
  assert.equal((parent.textContent || '').trim(), '嵌套验收 2', '父标签的数是它下面所有子标签加起来')
  assert.equal((childA.textContent || '').trim(), '子甲 1', '子标签只写最后一段，不再重复前缀')
  assert.equal(childA.getAttribute('data-nest'), 'true', '子标签要能看出是缩进去的那一层')
  assert.equal(parent.getAttribute('data-nest'), null, '父标签不是缩进去的那一层')

  // 父子顺序：父标签永远排在自己的子标签前面
  const order = tagRows().map((el) => el.title)
  assert.ok(
    order.indexOf('嵌套验收') < order.indexOf('嵌套验收/子甲'),
    '父标签该排在子标签前面：' + JSON.stringify(order.slice(0, 6)),
  )

  // 点父标签：子标签下面的笔记也要收进来
  parent.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const cardTitles = () =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).map((el) => el.getAttribute('title'))
  await waitFor(
    () => cardTitles().includes(pathA) && cardTitles().includes(pathB),
    5000,
    '点父标签该把两颗子标签的笔记都收进来：' + JSON.stringify(cardTitles()),
  )

  // 点子标签：只留它自己那一篇
  rowOf('嵌套验收/子甲').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => cardTitles().includes(pathA) && !cardTitles().includes(pathB),
    5000,
    '点子标签只该留它自己那一篇：' + JSON.stringify(cardTitles()),
  )

  // 收尾：把筛选清掉，别把状态留给后面的用例
  const onRow = tagRows().find((el) => el.getAttribute('data-on') === 'true')
  if (onRow) {
    onRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(
      () => tagRows().every((el) => el.getAttribute('data-on') !== 'true'),
      5000,
      '把标签筛选清掉',
    )
  }
})

test('中栏顶上会摆出「现在筛的是什么」，点一下就退出去', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const seed = async (title, requestId) => {
    const content = ['# ' + title, '', '正文', ''].join('\n')
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '筛选条验收', title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    return json.path
  }

  // 上一个用例可能把某篇开着：先退回空态，左栏才在
  const back = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  const pathA = await seed('筛选条甲', 'seed-filter-chip-a')
  const pathB = await seed('筛选条乙', 'seed-filter-chip-b')
  // 再放一篇打了标签的：标签那颗胶囊要单独验
  const tagRes = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '筛选条验收',
      title: '筛选条丙',
      content: ['---', 'tags: [筛选条标签]', '---', '', '# 筛选条丙', '', '正文', ''].join('\n'),
      withDatePrefix: false,
      requestId: 'seed-filter-chip-c',
    }),
  })
  await tagRes.json()

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const chips = () => Array.from(window.document.querySelectorAll('.dshgn_filterChip'))
  const chipOf = (kind) => chips().find((el) => el.getAttribute('data-kind') === kind) || null
  const cardTitles = () =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).map((el) => el.getAttribute('title'))
  const rowOf = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })

  // 刚进来没筛任何东西：整条不该出现，不占位置
  assert.equal(chips().length, 0, '没有筛选时不该摆筛选条')

  // 点左栏目录：中栏顶上摆出那颗胶囊，写着目录名
  const dirRow = await waitFor(() => rowOf('筛选条验收'), 8000, '左栏出现新目录')
  dirRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const dirChip = await waitFor(() => chipOf('dir'), 5000, '点了目录就摆出目录那颗胶囊')
  assert.ok((dirChip.textContent || '').includes('筛选条验收'), '胶囊上要写着筛的是哪个目录')
  assert.ok(dirChip.title.includes('去掉这个筛选'), '悬停要说清点一下会怎样')
  await waitFor(
    () => cardTitles().includes(pathA) && cardTitles().includes(pathB),
    5000,
    '这个目录里两篇都在',
  )

  // 点胶囊：筛选退掉，胶囊消失，卡片回到全部
  dirChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => chipOf('dir') === null, 5000, '点掉之后目录那颗胶囊要消失')
  assert.equal(
    window.document.querySelector('.dshgn_filterBar'),
    null,
    '一颗都不剩的时候整条筛选条也该收起来',
  )

  // 点左栏标签：换成标签那颗胶囊（带井号，颜色也跟着变）
  const tagRow2 = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_tagRow')).find((el) => el.title === '筛选条标签') ||
      null,
    8000,
    '标签云里有这个标签',
  )
  tagRow2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const tagChip = await waitFor(() => chipOf('tag'), 5000, '点了标签就摆出标签那颗胶囊')
  assert.ok((tagChip.textContent || '').includes('筛选条标签'), '胶囊上要写着筛的是哪个标签')

  // 收尾：点掉，别把筛选状态留给后面的用例
  tagChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_filterBar') === null, 5000, '收尾清掉筛选')
})

test('按 ? 就摊开一张快捷键速查表，Esc 先收它、再按一次也收', async () => {
  const helpMask = () => window.document.querySelector('.dshgn_helpModal')
  const rows = () => Array.from(window.document.querySelectorAll('.dshgn_helpRow'))
  const press = (key, extra) =>
    window.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({ key, bubbles: true }, extra || {})))

  // 先收掉别的：上一个用例可能把某篇开着，速查表在任何一页都该叫得出来
  const back = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(200)
  } finally {
    panel.setConfirmDialog(null)
  }

  assert.equal(helpMask(), null, '平时不占位置')

  // 顶栏那颗问号：点一下摊开
  const helpBtn = await waitFor(
    () => window.document.querySelector('.dshgn_helpBtn'),
    5000,
    '顶栏要有速查表入口',
  )
  assert.equal(helpBtn.getAttribute('aria-keyshortcuts'), 'Shift+Slash', '按钮上要写得出按什么键')
  helpBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => helpMask() !== null, 5000, '点一下就该摊开')

  // 表里得有干货：至少十来条，键位和说明都不能空
  const list = rows()
  assert.ok(list.length >= 10, '速查表不该只有两三条，实际 ' + list.length)
  const keyText = (row) =>
    Array.from(row.querySelectorAll('.dshgn_helpKey')).map((el) => (el.textContent || '').trim())
  const whatText = (row) => ((row.querySelector('.dshgn_helpWhat') || {}).textContent || '').trim()
  for (const row of list) {
    assert.ok(keyText(row).length > 0, '每一行都要写出按什么键')
    assert.ok(whatText(row) !== '', '每一行都要说清按了会怎样')
  }
  // 这几条是面板里最容易踩空的，必须在表里
  const allKeys = list.map((row) => keyText(row).join('+')).join(' | ')
  for (const want of ['Ctrl+K', 'Ctrl+N', 'Ctrl+F', 'Ctrl+E', 'Ctrl+S', 'Alt+←', 'Esc', 'Tab']) {
    assert.ok(allKeys.includes(want), '速查表里该有 ' + want + '，实际 ' + allKeys)
  }

  // 再点一次按钮收起
  helpBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => helpMask() === null, 5000, '再点一次就收起')

  // 按 ? 也能叫出来（Shift+/ 打出来的就是它）
  press('?', { shiftKey: true })
  await waitFor(() => helpMask() !== null, 5000, '按 ? 也要摊开')
  // 再按一次 ? 收起
  press('?', { shiftKey: true })
  await waitFor(() => helpMask() === null, 5000, '再按一次 ? 就收起')

  // Esc 收：它比页签里那一层更靠上，按下 Esc 最想关的就是它
  press('?', { shiftKey: true })
  await waitFor(() => helpMask() !== null, 5000, '再叫一次')
  press('Escape')
  await waitFor(() => helpMask() === null, 5000, 'Esc 先收速查表')

  // 焦点在输入框里时不该被抢走：那时 ? 是要打的字
  const searchBox = window.document.querySelector('.dshgn_search')
  assert.ok(searchBox !== null, '中栏有搜索框')
  searchBox.focus()
  searchBox.dispatchEvent(new window.KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true }))
  await sleep(200)
  assert.equal(helpMask(), null, '在输入框里打问号不该弹出速查表')
})

/**
 * 写到一半没了，下次打开还能捡回来。
 *
 * 面板的编辑器是草稿式的：正文只活在 React 的 state 里，切页签、关窗口、
 * 宿主重载插件都会一起带走。用户写了一整段、手滑按了刷新，那是真丢了。
 * 所以编辑态边写边往 localStorage 里留一份，下次打开同一篇时在正文上方
 * 提一句「上次写到一半没存」，接着写会把草稿填回编辑区，丢掉就清掉；
 * 存好了、或者按 Esc 取消，那份草稿也该跟着消失，不然下次白问一句。
 */
test('写到一半关掉窗口，下次打开那篇会问要不要接着写，存好了就不再问', async () => {
  const { DRAFT_KEY, DRAFT_KEEP, DRAFT_MAX, readDrafts, draftOf, writeDraft, dropDraft } = panel.__internals
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const storageRaw = () => window.localStorage.getItem(DRAFT_KEY)

  // ── 纯函数：写、读、丢、上限 ────────────────────────────────────────────
  for (const item of readDrafts()) dropDraft(item.path)
  assert.equal(storageRaw(), null, '一开始没有草稿')
  assert.equal(draftOf('随便.md'), null, '没写过的就是没有')

  writeDraft('草稿甲.md', '甲的内容')
  assert.equal(draftOf('草稿甲.md').content, '甲的内容', '写进去就读得出来')
  assert.ok(draftOf('草稿甲.md').at > 0, '要记下什么时候写的')

  writeDraft('草稿乙.md', '乙的内容')
  assert.equal(readDrafts()[0].path, '草稿乙.md', '最近写过的排在最前面')

  writeDraft('草稿甲.md', '甲改过')
  assert.equal(readDrafts().length, 2, '同一篇再写一次不该多出一条')
  assert.equal(draftOf('草稿甲.md').content, '甲改过', '同一篇以最新那次为准')

  // 超过上限的超长正文不存：那是救急用的，不是版本历史，别把配额吃光
  writeDraft('太长.md', 'x'.repeat(DRAFT_MAX + 1))
  assert.equal(draftOf('太长.md'), null, '超过上限的正文不落盘')

  // 只留最近几篇，最早的自己让位
  for (let i = 0; i < DRAFT_KEEP + 3; i += 1) writeDraft('批量' + i + '.md', '内容' + i)
  assert.equal(readDrafts().length, DRAFT_KEEP, '最多只留 ' + DRAFT_KEEP + ' 篇')
  assert.equal(draftOf('批量0.md'), null, '最早那几篇要被挤掉')
  assert.equal(draftOf('批量' + (DRAFT_KEEP + 2) + '.md').content, '内容' + (DRAFT_KEEP + 2), '最新的还在')

  for (const item of readDrafts()) dropDraft(item.path)
  assert.equal(storageRaw(), null, '全丢光之后连键都不该留')

  // ── 真渲染：写一半、关窗口、重新挂载 ────────────────────────────────────
  const back = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  const createRes = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '草稿救回验收',
      content: ['# 草稿救回验收', '', '磁盘上原来这一句。', '', '最后一行。'].join('\n'),
      withDatePrefix: false,
      requestId: 'seed-draft-stash',
    }),
  })
  const created = await createRes.json()
  const targetPath = created.path

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)
  const card = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === targetPath) ||
      null,
    8000,
    '列表里有这篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '笔记打开')

  const editBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '编辑')
  editBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const editor = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '进编辑态')
  const half = ['# 草稿救回验收', '', '磁盘上原来这一句。', '', '最后一行。', '', '写到一半的第三段，还没保存。'].join('\n')
  editor.value = half
  editor.dispatchEvent(new window.Event('input', { bubbles: true }))

  // 边写边存有 400ms 防抖：等它真的落进 localStorage
  await waitFor(() => draftOf(targetPath) !== null, 8000, '写一半也要落进本地草稿')
  assert.equal(draftOf(targetPath).content, half, '存的就是编辑区里那份')

  // 模拟「关掉窗口」：直接把组件树卸掉再挂回来（不走 Esc，那条路是「不要了」）
  root.unmount()
  root = createRoot(rootEl)
  root.render(React.createElement(panel.PanelRoot, {}))
  await waitFor(() => rootNode() !== null && rootNode().getAttribute('data-has-note') === 'true', 10000, '重开之后回到那篇')

  const draftBar = await waitFor(() => window.document.querySelector('.dshgn_draftBar'), 8000, '打开时要提一句')
  assert.ok((draftBar.textContent || '').includes('上次写到一半没存'), '要说清是什么：' + draftBar.textContent)
  const barBtns = () => Array.from(draftBar.querySelectorAll('.dshgn_draftBtn'))
  assert.equal(barBtns().length, 2, '摆「接着写」和「丢掉」两个选择')
  assert.equal((barBtns()[0].textContent || '').trim(), '接着写')
  assert.equal((barBtns()[1].textContent || '').trim(), '丢掉')
  assert.equal(window.document.querySelector('.dshgn_editor'), null, '提醒条只在阅读态摆')

  // 接着写：草稿填回编辑区，提醒条自己收起来
  barBtns()[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const editorAgain = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '接着写要进编辑态')
  assert.equal(editorAgain.value, half, '编辑区里就是没存完的那份')
  assert.equal(window.document.querySelector('.dshgn_draftBar'), null, '进编辑态之后提醒条该收起')

  // Esc 是「不要了」：草稿跟着清掉。
  // 编辑态那个监听是 effect 挂的，刚点完「接着写」的同一个 tick 里按下去会落到
  // 旧闭包上（那时 editing 还是 false，处理器根本不在），先让出一拍再按。
  await sleep(200)
  for (let attempt = 0; attempt < 3 && window.document.querySelector('.dshgn_editor') !== null; attempt += 1) {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await sleep(300)
  }
  await waitFor(() => window.document.querySelector('.dshgn_editor') === null, 5000, 'Esc 退出编辑态')
  assert.equal(draftOf(targetPath), null, '取消之后草稿不该留着')

  // ── 丢掉这条路 ──────────────────────────────────────────────────────────
  editBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const editor2 = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '再进一次编辑态')
  editor2.value = half + '\n再补一句。'
  editor2.dispatchEvent(new window.Event('input', { bubbles: true }))
  await waitFor(() => draftOf(targetPath) !== null, 8000, '这次也要落进草稿')

  root.unmount()
  root = createRoot(rootEl)
  root.render(React.createElement(panel.PanelRoot, {}))
  await waitFor(() => rootNode() !== null && rootNode().getAttribute('data-has-note') === 'true', 10000, '再重开一次')
  const bar2 = await waitFor(() => window.document.querySelector('.dshgn_draftBar'), 8000, '又该问一句')
  const dropBtn = Array.from(bar2.querySelectorAll('.dshgn_draftBtn'))[1]
  dropBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_draftBar') === null, 5000, '丢掉之后提醒条收起')
  await waitFor(
    () => ((window.document.querySelector('.dshgn_toast') || {}).textContent || '').includes('草稿已丢掉'),
    5000,
    '丢掉了要说一声',
  )
  assert.equal(draftOf(targetPath), null, '丢掉之后本地也不该留着')

  // 清掉，别把草稿留给后面的用例
  dropDraft(targetPath)
  const tailBack = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (tailBack) tailBack.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '收尾退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
})

test('鼠标停在列表卡片上，请宿主把这一篇预览出来，别的地方不乱触发', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const back = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  const createRes = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '预览验收',
      content: ['# 预览验收', '', '这一篇只是用来把鼠标停上去。'].join('\n'),
      withDatePrefix: false,
      requestId: 'seed-card-hover',
    }),
  })
  const created = await createRes.json()
  const targetPath = created.path

  const tabBtn = Array.from(window.document.querySelectorAll('.dshgn_tab')).find((el) => (el.textContent || '').trim() === '笔记')
  tabBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const refreshBtn = Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.getAttribute('title') === '刷新')
  refreshBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const cardOf = () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === targetPath)
  const card = await waitFor(cardOf, 8000, '列表里该有这一篇')

  // 没注入宿主时（离线环境）悬停什么都不该发生，更不该炸
  assert.doesNotThrow(() => {
    card.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }))
  })

  const md = await import('../src/view/markdown.js')
  const triggered = []
  md.setMarkdownHost({
    app: { workspace: { trigger: (name, payload) => triggered.push({ name, payload }) } },
    component: { id: 'panel' },
    MarkdownRenderer: { render: async () => {} },
  })
  try {
    // 宿主没登记预览来源时，事件会被静默丢掉——宁可不触发也不要乱弹
    md.setHoverSource('')
    card.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }))
    assert.equal(triggered.length, 0, '没登记来源时不该触发')

    md.setHoverSource('getnote-brain')
    card.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }))
    assert.equal(triggered.length, 1, '登记之后应该请宿主弹预览')
    assert.equal(triggered[0].name, 'hover-link')
    const payload = triggered[0].payload
    assert.equal(payload.source, 'getnote-brain')
    assert.equal(payload.linktext, targetPath, '预览的应该是鼠标停的那一篇')
    assert.equal(payload.sourcePath, '', '列表里没有当前笔记，不该瞎报一个来源路径')
    assert.equal(payload.targetEl, card, '预览要贴着被悬停的那张卡片')
    assert.equal(payload.hoverParent.id, 'panel')

    // 卡片里的勾选框是子元素：mouseenter 不冒泡，挪进去不该再触发一次
    const box = card.querySelector('.dshgn_pickBox')
    box.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }))
    assert.equal(triggered.length, 1, '在卡片内部挪动不该反复触发')

    // 宿主那边炸了也不能把面板带崩
    md.setMarkdownHost({
      app: { workspace: { trigger() { throw new Error('宿主炸了') } } },
      component: {},
      MarkdownRenderer: { render: async () => {} },
    })
    assert.doesNotThrow(() => {
      card.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }))
    })
  } finally {
    md.clearMarkdownHost()
    md.setHoverSource('')
  }
})

test('正文里划选一段，就地能复制或者直接存成新笔记', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const toastText = () => ((window.document.querySelector('.dshgn_toast') || {}).textContent || '')
  const pop = () => window.document.querySelector('.dshgn_selPop')
  const popBtn = (label) =>
    Array.from(window.document.querySelectorAll('.dshgn_selPopBtn')).find((el) => (el.textContent || '').trim() === label)

  // 退回空态，并把搜索框清干净（上一个用例可能留了筛选）
  const back = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  const paragraph = '这一段话是我想要单独摘出来的一片叶子，后面还有半句。'
  const createRes = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '划选验收',
      content: ['# 划选验收', '', '开头一段跟这次划选无关。', '', paragraph, '', '最后一段。'].join('\n'),
      withDatePrefix: false,
      requestId: 'seed-selection-quote',
    }),
  })
  assert.equal(createRes.ok, true, '造笔记失败：' + createRes.status)
  const targetPath = '随手记/划选验收.md'

  await clickTab('笔记')
  const refresh = Array.from(window.document.querySelectorAll('button')).find((el) => (el.getAttribute('title') || '') === '刷新')
  assert.ok(refresh, '找不到刷新按钮')
  refresh.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)
  const card = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === targetPath),
    5000,
    '列表里出现这一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 5000, '打开这一篇')
  await waitFor(() => window.document.querySelector('.dshgn_md') !== null, 5000, '正文渲染出来')
  // 划选监听是 effect 挂的：打开笔记的同一拍里派发 mouseup 会落到还没挂上的那一版，
  // 让出一拍等 React 把 effect 排到。
  await sleep(250)

  // 在那一段里真的划一下：jsdom 有 Selection 与 Range，只是没有排版矩形
  const mdBox = window.document.querySelector('.dshgn_md')
  const para = Array.from(mdBox.querySelectorAll('p')).find((el) => (el.textContent || '').includes('单独摘出来'))
  assert.ok(para, '正文里没找到那一段')
  const textNode = para.firstChild
  const range = window.document.createRange()
  range.setStart(textNode, 0)
  range.setEnd(textNode, paragraph.length)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  para.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 80 }))

  const bar = await waitFor(pop, 3000, '划选之后弹出小条')
  const copyBtn = popBtn('复制')
  const noteBtn = popBtn('存成新笔记')
  assert.ok(copyBtn, '小条上应该有「复制」')
  assert.ok(noteBtn, '小条上应该有「存成新笔记」')
  assert.equal(bar.style.left, '120px', '拿不到选区矩形时退回鼠标位置')

  // 复制：剪贴板里应该是那一段原文
  const written = []
  clipboard.writeText = async (text) => { written.push(String(text)) }
  copyBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => written.length === 1, 3000, '复制到剪贴板')
  assert.equal(written[0], paragraph, '复制的应该是选中的那一段')
  await waitFor(() => pop() === null, 3000, '复制完小条收起')

  // 再划一次，这次存成新笔记
  sel.removeAllRanges()
  sel.addRange(range)
  para.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 80 }))
  await waitFor(pop, 3000, '再划一次还弹')
  popBtn('存成新笔记').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => toastText().includes('已新建'), 5000, '存成新笔记之后要说一声')
  // data-has-note 这会儿本来就已经是 true（原来那篇开着），得等路径真的换过去
  const openedPath = await waitFor(
    () => {
      const now = (window.document.querySelector('.dshgn_notePath') || {}).textContent || ''
      return now.includes('这一段话是我想要单独摘出来') ? now : null
    },
    5000,
    '切到新笔记（标题取选中内容的第一行）',
  )
  assert.ok(openedPath, '新笔记的标题取选中内容的第一行')
  await waitFor(() => (window.document.querySelector('.dshgn_md') || {}).textContent.includes('单独摘出来'), 5000, '新笔记正文里就是那一段')

  // 划选之外的地方松手不该弹：先把选区收掉
  sel.removeAllRanges()
  const head = window.document.querySelector('.dshgn_noteHead')
  if (head) head.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }))
  await sleep(150)
  assert.equal(pop(), null, '没有选区就不该弹')

  // 编辑态不弹：那里划选是改字的前奏
  const editBtn = Array.from(window.document.querySelectorAll('button')).find((el) => (el.getAttribute('title') || '') === '编辑')
  assert.ok(editBtn, '找不到编辑按钮')
  editBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(200)
  const editor = window.document.querySelector('.dshgn_editor')
  assert.ok(editor, '应该进了编辑态')
  editor.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }))
  await sleep(150)
  assert.equal(pop(), null, '编辑态里划选不该弹小条')
  editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(200)
})

test('篇尾那条脚注点一下就回到正文里引用它的那一句，别让人自己往上翻', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const liveScroller = () => window.document.querySelector('.dshgn_note .dshgn_scroll')
  const footRow = () => window.document.querySelector('.dshgn_footnote')
  const footRef = () => window.document.querySelector('.dshgn_footRef')

  // 退回空态，并把搜索框清干净
  const back = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  const filler = []
  for (let i = 0; i < 8; i += 1) filler.push('第 ' + (i + 1) + ' 段废话，跟这次跳转无关。')
  const lines = ['# 脚注回跳验收', '', '这一句里带着一个脚注[^1]，后面还有半句。', '']
  for (const line of filler) lines.push(line, '')
  lines.push('[^1]: 这是篇尾那条注解。', '')
  const createRes = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '脚注回跳验收',
      content: lines.join('\n'),
      withDatePrefix: false,
      requestId: 'seed-footnote-back',
    }),
  })
  assert.equal(createRes.ok, true, '造笔记失败：' + createRes.status)
  const targetPath = '随手记/脚注回跳验收.md'

  await clickTab('笔记')
  const refresh = Array.from(window.document.querySelectorAll('button')).find((el) => (el.getAttribute('title') || '') === '刷新')
  assert.ok(refresh, '找不到刷新按钮')
  refresh.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)
  const card = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === targetPath),
    5000,
    '列表里出现这一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 5000, '打开这一篇')
  await waitFor(footRef, 5000, '正文里那个上标')

  // jsdom 没有排版：按块序造一份假的纵向坐标，滚动容器自己从 0 起
  const realRect = window.HTMLElement.prototype.getBoundingClientRect
  const realScrollTo = window.HTMLElement.prototype.scrollTo
  const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, .dshgn_footnotes'
  // 上标是段落里的行内节点，不在块列表里：往上找到它所在的那个块，
  // 否则「跳回引用处」会被算到篇尾去，测出来的位置是假的。
  const blockTopOf = (node) => {
    const note = node.closest('.dshgn_note .dshgn_scroll')
    if (!note) return 0
    const all = Array.from(note.querySelectorAll(BLOCKS))
    let hit = node
    while (hit && all.indexOf(hit) === -1) hit = hit.parentElement
    const index = hit ? all.indexOf(hit) : -1
    return (index < 0 ? all.length : index) * 100
  }
  let fakeTop = -1
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList && this.classList.contains('dshgn_scroll')) {
      return { top: 0, left: 0, width: 600, height: 400, bottom: 400, right: 600, x: 0, y: 0 }
    }
    const host = this.closest ? this.closest('.dshgn_scroll') : null
    if (!host) return realRect.call(this)
    const top = blockTopOf(this) - (host.scrollTop || 0)
    return { top, left: 0, width: 600, height: 20, bottom: top + 20, right: 600, x: 0, y: top }
  }
  window.HTMLElement.prototype.scrollTo = function (options) {
    const top = options && typeof options.top === 'number' ? options.top : 0
    this.scrollTop = top
    fakeTop = top
  }
  try {
    const scroller = await waitFor(liveScroller, 5000, '正文滚动容器')
    assert.equal(scroller.scrollTop, 0, '刚打开时在篇首')

    // 先点正文里的上标：滚到篇尾那条注解
    footRef().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => scroller.scrollTop > 0, 3000, '点脚注上标之后滚到篇尾')
    assert.ok(fakeTop > 0, '滚的是正文滚动容器，不是窗口')

    // 再点篇尾那一行：回到正文里引用它的那一句
    const row = await waitFor(footRow, 3000, '篇尾那条脚注')
    assert.equal(row.getAttribute('title'), '回到引用它的地方')
    scroller.scrollTop = 9999
    row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => scroller.scrollTop < 900, 3000, '点注解回到引用它的那一句')
    assert.ok(fakeTop < 900, '回跳也只动滚动容器')

    // 按回车也一样（键盘用户不该只能靠鼠标）
    scroller.scrollTop = 9999
    row.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await waitFor(() => scroller.scrollTop < 900, 3000, '回车也能回跳')

    // 注解正文里自己能点的东西（比如双链）不该被这一行截走
    scroller.scrollTop = 9999
    const textSpan = row.querySelector('.dshgn_footnoteText')
    textSpan.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => scroller.scrollTop < 900, 3000, '点在注解文字上也回跳')
  } finally {
    window.HTMLElement.prototype.getBoundingClientRect = realRect
    window.HTMLElement.prototype.scrollTo = realScrollTo
  }

  // 纯函数：找不到就老实说找不到，不假装跳了
  const box = window.document.querySelector('.dshgn_md')
  assert.equal(panel.__internals.scrollToFootnoteRef(box, '没有这条'), false)
  assert.equal(panel.__internals.scrollToFootnoteRef(box, ''), false)

  // 收尾退回空态
  const back2 = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back2) back2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '收尾退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
})


test('编辑区里选中一段字再粘贴网址，变成「那段字」当链接文字，没选字就照旧贴网址', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const linkPaste = panel.__internals.linkPaste

  // 纯函数：选中的那段字当链接文字，网址进括号，选区停在链接文字上
  const one = linkPaste('见这里', 1, 3, 'https://a.com/x')
  assert.equal(one.text, '见[这里](https://a.com/x)')
  assert.equal(one.start, 2)
  assert.equal(one.end, 4)
  // 没选字：不替他造链接文字，交回浏览器默认行为
  assert.equal(linkPaste('abc', 1, 1, 'https://a.com'), null)
  // 选中的是空白：同上
  assert.equal(linkPaste('a   b', 1, 4, 'https://a.com'), null)
  // 剪贴板里不是网址：不动
  assert.equal(linkPaste('abc', 0, 3, 'hello world'), null)
  assert.equal(linkPaste('abc', 0, 3, 'ftp://a.com'), null)
  // 选中的字里有 ] 或换行：拼出来的链接是坏的，宁可不动
  assert.equal(linkPaste('a]b', 0, 3, 'https://a.com'), null)
  assert.equal(linkPaste('a\nb', 0, 3, 'https://a.com'), null)
  // 选中的本来就是一条链接：再包一层就成了链接里套链接
  assert.equal(linkPaste('[文字](x.md)', 0, 11, 'https://a.com'), null)
  // 反着选的区间也照做
  const reversed = linkPaste('见这里', 3, 1, 'https://a.com')
  assert.equal(reversed.text, '见[这里](https://a.com)')
  // 网址两头的空白不算数
  assert.equal(linkPaste('见这里', 1, 3, '  https://a.com  ').text, '见[这里](https://a.com)')

  // 退回空态，并把搜索框清干净
  const back = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  const body = ['# 粘贴链接验收', '', '这一段话是要拿去当链接文字的。', '', '最后一行。'].join('\n')
  const createRes = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '粘贴链接验收',
      content: body,
      withDatePrefix: false,
      requestId: 'seed-paste-link',
    }),
  })
  assert.equal(createRes.ok, true, '造笔记失败：' + createRes.status)
  const targetPath = '随手记/粘贴链接验收.md'

  await clickTab('笔记')
  const refresh = Array.from(window.document.querySelectorAll('button')).find((el) => (el.getAttribute('title') || '') === '刷新')
  assert.ok(refresh, '找不到刷新按钮')
  refresh.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)
  const card = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === targetPath),
    5000,
    '列表里出现这一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 5000, '打开这一篇')

  const editBtn = await waitFor(
    () => Array.from(window.document.querySelectorAll('button')).find((el) => (el.getAttribute('title') || '') === '编辑'),
    5000,
    '编辑按钮',
  )
  editBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const editor = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '编辑区')
  // 快捷键与划选监听都是 effect 挂的，点开编辑态的同一拍里派发会落到旧闭包
  await sleep(250)

  const setValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  }
  const pasteOf = (text) => {
    const event = new window.Event('paste', { bubbles: true, cancelable: true })
    event.clipboardData = { files: [], getData: (kind) => (kind === 'text/plain' ? text : '') }
    return event
  }

  const seed = '# 粘贴链接验收\n\n这一段话是要拿去当链接文字的。\n\n最后一行。'
  setValue(editor, seed)
  await sleep(120)
  // 选中「这一段话是要拿去当链接文字的」这一段，再粘贴网址
  const from = seed.indexOf('这一段话')
  const to = from + '这一段话是要拿去当链接文字的'.length
  editor.setSelectionRange(from, to)
  const linkEvent = pasteOf('https://example.com/post')
  editor.dispatchEvent(linkEvent)
  await sleep(120)
  assert.equal(linkEvent.defaultPrevented, true, '选中一段字再粘网址时应当由面板接手')
  const afterLink = window.document.querySelector('.dshgn_editor')
  assert.ok(
    afterLink.value.includes('[这一段话是要拿去当链接文字的](https://example.com/post)'),
    '粘贴之后应当是「选中的字」当链接文字，实际：' + afterLink.value,
  )
  // 选区停在链接文字上，接着打字是改链接文字而不是改网址
  assert.equal(afterLink.selectionStart, from + 1)
  assert.equal(afterLink.selectionEnd, from + 1 + '这一段话是要拿去当链接文字的'.length)

  // 没选字：不该被面板截走，交回浏览器
  const plain = window.document.querySelector('.dshgn_editor')
  plain.setSelectionRange(0, 0)
  const plainEvent = pasteOf('https://example.com/post')
  plain.dispatchEvent(plainEvent)
  await sleep(120)
  assert.equal(plainEvent.defaultPrevented, false, '没选字时不要自作主张')

  // 剪贴板里不是网址：也不截
  const plain2 = window.document.querySelector('.dshgn_editor')
  plain2.setSelectionRange(from, to)
  const textEvent = pasteOf('一段普通文字')
  plain2.dispatchEvent(textEvent)
  await sleep(120)
  assert.equal(textEvent.defaultPrevented, false, '粘贴普通文字时不要接手')

  // 收尾：Esc 退出编辑态，再退回空态
  const quit = window.document.querySelector('.dshgn_editor')
  quit.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(200)
  const back2 = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back2) back2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '收尾退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
})

test('右键里能把这一篇复制成一份副本，原文件一个字都不动', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')

  // 退回空态，并把搜索框清干净
  const back = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  const original = ['# 副本验收', '', '第一句。', '', '第二句。'].join('\n')
  const created = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '副本验收',
      content: original,
      withDatePrefix: false,
      requestId: 'seed-duplicate-note',
    }),
  })
  assert.equal(created.ok, true, '造笔记失败：' + created.status)
  const targetPath = '随手记/副本验收.md'

  await clickTab('笔记')
  const refresh = Array.from(window.document.querySelectorAll('button')).find((el) => (el.getAttribute('title') || '') === '刷新')
  assert.ok(refresh, '找不到刷新按钮')
  refresh.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)
  const card = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === targetPath),
    5000,
    '列表里出现这一篇',
  )

  // 右键清单里要有这一项，点下去建出一篇「原标题 副本」
  let ran = 0
  panel.setNoteMenu((event, items) => {
    const item = items.find((one) => one.id === 'duplicate')
    assert.ok(item, '清单里应该有「复制这一篇」，实际 ' + items.map((one) => one.id).join(','))
    assert.equal(item.label, '复制这一篇')
    ran += 1
    item.run()
    return true
  })
  card.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await sleep(200)
  assert.equal(ran, 1, '右键应该把「复制这一篇」跑一次')

  // 建完当场打开，路径是「随手记/副本验收 副本.md」
  const opened = await waitFor(
    () => {
      const el = window.document.querySelector('.dshgn_notePath')
      const text = el === null ? '' : String(el.textContent || '')
      return text.includes('副本验收 副本') ? text : null
    },
    5000,
    '复制完当场打开那一篇',
  )
  assert.equal(opened, '随手记/副本验收 副本.md')
  // 副本名前面不该再叠一个今天的日期：原标题本来就没带日期前缀
  assert.equal(/^\d{4}-\d{2}-\d{2}-/.test(opened.split('/').pop()), false)

  // 正文一模一样
  const copyRead = await realFetch(server.origin + '/getnote/read?path=' + encodeURIComponent(opened), {
    headers: { 'x-getnote-token': server.token },
  })
  assert.equal(copyRead.ok, true, '读副本失败：' + copyRead.status)
  const copyJson = await copyRead.json()
  assert.equal(copyJson.content, original, '副本正文应当与原篇一致')

  // 原文件一个字都没动
  const originRead = await realFetch(server.origin + '/getnote/read?path=' + encodeURIComponent(targetPath), {
    headers: { 'x-getnote-token': server.token },
  })
  assert.equal(originRead.ok, true, '读原篇失败：' + originRead.status)
  const originJson = await originRead.json()
  assert.equal(originJson.content, original, '原篇不该被改动')

  // 笔记头上也有一颗按钮，没接上这个去处时不摆
  panel.setNoteMenu(null)
  const dupBtn = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => (el.getAttribute('title') || '') === '复制这一篇'),
    5000,
    '笔记头上的「复制这一篇」',
  )
  assert.ok(dupBtn, '笔记头上应该有「复制这一篇」')

  // 收尾退回空态
  const back2 = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back2) back2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '收尾退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
})

test('搜索里引号把一串词绑在一起、减号把它排掉，结果当场跟着变', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const { searchTermsOf } = panel.__internals

  // 标色只标正文词：引号里的整串算一个词，减号后面那个不该被标
  assert.deepEqual(searchTermsOf('开会 "连着 两个" -排除'), ['开会', '连着 两个'])
  assert.deepEqual(searchTermsOf('-"不要 这个" 会议'), ['会议'])
  assert.deepEqual(searchTermsOf('"只有这一串"'), ['只有这一串'])
  assert.deepEqual(searchTermsOf('tag:录音卡 会议'), ['会议'])

  // 退回空态，并把搜索框清干净
  const back = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const seed = async (title, content, requestId) => {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '随手记', title, content, withDatePrefix: false, requestId }),
    })
    assert.equal(res.ok, true, '造笔记失败：' + res.status)
  }
  await seed('短语搜索连着', ['# 短语搜索连着', '', '今天开会 记录得比较全。'].join('\n'), 'seed-phrase-joined')
  await seed('短语搜索分开', ['# 短语搜索分开', '', '开会之前先把记录本找出来。'].join('\n'), 'seed-phrase-apart')

  await clickTab('笔记')
  const refresh = Array.from(window.document.querySelectorAll('button')).find((el) => (el.getAttribute('title') || '') === '刷新')
  assert.ok(refresh, '找不到刷新按钮')
  refresh.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const searchBox = () => window.document.querySelector('.dshgn_search')
  const type = async (text) => {
    const box = searchBox()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(box, text)
    box.dispatchEvent(new window.Event('input', { bubbles: true }))
    // 搜索有 220ms 防抖 + 一次请求：只睡固定时间偶尔会在结果回来之前就断言
    await sleep(300)
    await waitFor(() => window.document.querySelector('.dshgn_searching') === null, 8000, '搜索结果回来')
  }
  const titles = () =>
    Array.from(window.document.querySelectorAll('.dshgn_card .dshgn_cardTitle'))
      .map((el) => el.textContent)
      .filter((text) => text.indexOf('短语搜索') >= 0)

  // 不加引号：两篇都命中
  await type('开会 记录')
  assert.deepEqual(titles().sort(), ['短语搜索分开', '短语搜索连着'])

  // 加引号：只有真的连着写的那一篇
  await type('"开会 记录"')
  assert.deepEqual(titles(), ['短语搜索连着'])

  // 减号：把连着的那篇排掉，只剩另一篇
  await type('记录 -"开会 记录"')
  assert.deepEqual(titles(), ['短语搜索分开'])

  // 收尾：清空搜索框
  await type('')
})

test('按 x 就把当前这一篇选进批量操作，再按一次退出，Esc 把整批清掉', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')

  const back = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }
  const seed = async (title, requestId) => {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({
        dir: '随手记',
        title,
        content: ['# ' + title, '', '正文一句话。'].join('\n'),
        withDatePrefix: false,
        requestId,
      }),
    })
    assert.equal(res.ok, true, '造笔记失败：' + res.status)
  }
  await seed('键盘选择甲', 'seed-key-pick-a')
  await seed('键盘选择乙', 'seed-key-pick-b')

  await clickTab('笔记')
  const refresh = Array.from(window.document.querySelectorAll('button')).find((el) => (el.getAttribute('title') || '') === '刷新')
  assert.ok(refresh, '找不到刷新按钮')
  refresh.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const cardOf = (path) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === path)
  const pathA = '随手记/键盘选择甲.md'
  const cardA = await waitFor(() => cardOf(pathA), 5000, '列表里出现甲')
  cardA.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 5000, '打开甲')
  // 键盘监听是 effect 挂的，打开笔记的同一拍里派发会落到旧闭包
  await sleep(250)

  const press = (key) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
  const batchBar = () => window.document.querySelector('.dshgn_batchBar')
  const pickOf = (path) => {
    const card = cardOf(path)
    return card === undefined ? null : card.querySelector('.dshgn_pickBox')
  }

  assert.equal(batchBar(), null, '一开始不该有批量条')
  press('x')
  await waitFor(() => batchBar() !== null, 3000, '按 x 之后批量条出现')
  assert.equal(pickOf(pathA).getAttribute('aria-checked'), 'true')
  assert.ok(batchBar().textContent.indexOf('1') >= 0, '批量条上该写着选了几篇')

  // 再按一次：同一篇退出选择，批量条跟着收起
  press('x')
  await waitFor(() => batchBar() === null, 3000, '再按一次批量条收起')
  assert.equal(pickOf(pathA).getAttribute('aria-checked'), 'false')

  // 选一篇再选另一篇：两篇都在里面
  press('x')
  await waitFor(() => batchBar() !== null, 3000, '重新选中')
  const pathB = '随手记/键盘选择乙.md'
  const cardB = await waitFor(() => cardOf(pathB), 5000, '列表里出现乙')
  cardB.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)
  press('x')
  await waitFor(() => {
    const bar = batchBar()
    return bar !== null && bar.textContent.indexOf('2') >= 0
  }, 3000, '两篇都选中')

  // Esc 把整批清掉
  press('Escape')
  await waitFor(() => batchBar() === null, 3000, 'Esc 之后批量条收起')
  assert.equal(pickOf(pathA).getAttribute('aria-checked'), 'false')

  // 收尾退回空态
  const back2 = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back2) back2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '收尾退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
})

test('搜出来之后在搜索框里按回车就打开排在最前面的那篇，Esc 把搜索退回整份列表', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')

  const back = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const clearBox = async () => {
    const box = window.document.querySelector('.dshgn_search')
    if (!box) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(box, '')
    box.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }
  await clearBox()

  const seed = async (title, content, requestId) => {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '随手记', title, content, withDatePrefix: false, requestId }),
    })
    assert.equal(res.ok, true, '造笔记失败：' + res.status)
  }
  await seed('回车搜索验收', ['# 回车搜索验收', '', '这一段里写着 荔枝 两个字。'].join('\n'), 'seed-search-enter')

  await clickTab('笔记')
  const refresh = Array.from(window.document.querySelectorAll('button')).find((el) => (el.getAttribute('title') || '') === '刷新')
  assert.ok(refresh, '找不到刷新按钮')
  refresh.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const box = window.document.querySelector('.dshgn_search')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))

  // 空搜索框里按回车不该打开任何东西
  key(box, 'Enter')
  await sleep(300)
  assert.equal(rootNode().getAttribute('data-has-note'), 'false', '空搜索框回车不该打开笔记')

  // 搜到结果之后回车打开第一篇
  setter.call(box, '荔枝')
  box.dispatchEvent(new window.Event('input', { bubbles: true }))
  // 等结果回来：搜索有 220ms 防抖 + 一次请求，卡片数会先停在整份列表上
  const cardsOf = () => Array.from(window.document.querySelectorAll('.dshgn_card'))
  await waitFor(() => {
    if (window.document.querySelector('.dshgn_searching') !== null) return false
    const list = cardsOf()
    return list.length > 0 && list.length < 3
  }, 8000, '搜索结果回来')
  // 回车该打开的是「排在最前面的那篇」，先把它记下来再按
  const firstPath = cardsOf()[0].getAttribute('title')
  key(window.document.querySelector('.dshgn_search'), 'Enter')
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 6000, '回车之后打开那一篇')
  const path = window.document.querySelector('.dshgn_notePath').textContent
  assert.equal(path, firstPath, '回车打开的应当是排在最前面的那篇')

  // 回列表，Esc 把搜索清掉、退回整份列表
  const back2 = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back2) back2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回列表')
  } finally {
    panel.setConfirmDialog(null)
  }
  const box2 = await waitFor(() => window.document.querySelector('.dshgn_search'), 5000, '搜索框')
  setter.call(box2, '荔枝')
  box2.dispatchEvent(new window.Event('input', { bubbles: true }))
  const searchedCount = await waitFor(() => {
    if (window.document.querySelector('.dshgn_searching') !== null) return false
    const list = cardsOf()
    return list.length > 0 && list.length < 3 ? list.length : false
  }, 8000, '第二次搜索的结果回来')
  key(window.document.querySelector('.dshgn_search'), 'Escape')
  await sleep(600)
  assert.equal(window.document.querySelector('.dshgn_search').value, '', 'Esc 之后搜索框该清空')
  await waitFor(() => cardsOf().length > searchedCount, 5000, 'Esc 之后该退回整份列表')

  // 速查表里写着这两个键
  const helpBtn = Array.from(window.document.querySelectorAll('button')).find((el) => el.classList.contains('dshgn_helpBtn'))
  assert.ok(helpBtn, '找不到速查表按钮')
  helpBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const rows = await waitFor(() => {
    const found = window.document.querySelectorAll('.dshgn_helpRow')
    return found.length > 0 ? found : null
  }, 5000, '速查表')
  const text = Array.from(rows).map((row) => row.textContent).join(' | ')
  assert.ok(text.indexOf('Enter') >= 0, '速查表里该有回车这一条')
  assert.ok(text.indexOf('打开第一篇') >= 0, '速查表里该写清楚回车做什么')
  key(window.document.body, 'Escape')
  await sleep(200)
  await clearBox()
})


test('大纲里那一节能抄一条指向它的链接，怎么拼先问宿主、问不到就按 [[路径#小节]] 拼', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')

  // 前一个用例可能把某篇开着，先退回干净的空态
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

  const seed = ['# 大纲链接验收', '', '第一节的话。', '', '## 第二节', '', '第二节的话。', ''].join('\n')
  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '大纲链接验收',
      content: seed,
      withDatePrefix: false,
      requestId: 'seed-outline-copy-link',
    }),
  })
  assert.equal((await res.json()).path, '随手记/大纲链接验收.md')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const card = await waitFor(
    () => {
      const all = Array.from(window.document.querySelectorAll('.dshgn_card'))
      return all.find((el) => (el.textContent || '').includes('大纲链接验收')) || null
    },
    8000,
    '列表里的那一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

  const rows = await waitFor(
    () => {
      const all = Array.from(window.document.querySelectorAll('.dshgn_outlineRow'))
      return all.length >= 2 ? all : null
    },
    8000,
    '大纲里应该有几行',
  )
  // 每一行都得有标题按钮 + 一颗抄链接的按钮，缺一颗这一行就只剩「跳过去」
  for (const row of rows) {
    assert.ok(row.querySelector('.dshgn_outlineItem') !== null, '一行里要有标题按钮')
    assert.ok(row.querySelector('.dshgn_outlineCopy') !== null, '一行里要有抄链接的按钮')
  }

  // 第二节那一行：点它右边那颗，抄的是「指向这一节」的链接
  const rowOf = (text) =>
    Array.from(window.document.querySelectorAll('.dshgn_outlineRow')).find(
      (el) => (el.querySelector('.dshgn_outlineItem').textContent || '') === text,
    )
  const copyOf = (text) => rowOf(text).querySelector('.dshgn_outlineCopy')
  assert.equal(copyOf('第二节').getAttribute('title'), '复制指向这一节的链接')
  assert.equal(copyOf('第二节').getAttribute('aria-label'), '复制指向这一节的链接')

  const written = []
  clipboard.writeText = async (text) => { written.push(String(text)) }
  const asked = []
  panel.setMarkdownLink((p, sub) => {
    asked.push([String(p), String(sub)])
    return '[[宿主给的这一节]]'
  })
  copyOf('第二节').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => written.length > 0, 5000, '抄到剪贴板')
  assert.equal(written[0], '[[宿主给的这一节]]', '应该用宿主生成的链接，实际 ' + written[0])
  assert.deepEqual(asked, [['随手记/大纲链接验收.md', '第二节']], '递给宿主的应该是这篇 + 这一节')

  // 宿主给不出（返回空）时按最通用的 [[路径#小节]] 拼一份，不能抄出一段空白
  panel.setMarkdownLink(() => '')
  copyOf('第二节').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => written.length > 1, 5000, '第二次抄')
  assert.equal(written[1], '[[随手记/大纲链接验收.md#第二节]]', '应该退回 [[路径#小节]]，实际 ' + written[1])

  // 宿主实现炸了也不该抄出空白
  panel.setMarkdownLink(() => { throw new Error('宿主炸了') })
  copyOf('第二节').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => written.length > 2, 5000, '第三次抄')
  assert.equal(written[2], '[[随手记/大纲链接验收.md#第二节]]', '宿主炸了也要退回 [[路径#小节]]')

  // 点标题本身还是「跳过去」，不该顺手抄一份（两件事得分开）
  const before = written.length
  rowOf('第二节').querySelector('.dshgn_outlineItem').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)
  assert.equal(written.length, before, '点标题只跳转，不该抄链接')

  panel.setMarkdownLink(null)
})
/**
 * 把列表里的卡片拖到左栏某个目录上 = 把这一篇挪进那个目录。
 *
 * 卡片本来就能拖（拖出去变成宿主链接），但那是「拿到别处去用」。想真正把一篇
 * 从 A 目录挪到 B 目录，以前得先勾选再走批量条；而拖动本身已经把目标指得很清楚了。
 * 这里验三件事：拖到目录行上真的挪了、笔记头跟着改到新路径（否则再按保存会写回
 * 旧位置、旧目录里凭空多个副本）、以及没带面板载荷的拖动（宿主文件树那种）不被当成挪。
 */
test('卡片拖到左栏目录上就挪进那个目录，笔记头也跟着换成新路径', async () => {
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
  const seedA = await post('/getnote/create', {
    dir: '拖动挪目录甲',
    title: '拖动挪目录-这一篇',
    content: ['# 拖动挪目录', '', '正文第一句。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-drag-move-note',
  })
  assert.equal(seedA.path, '拖动挪目录甲/拖动挪目录-这一篇.md')
  // 目标目录里先放一篇，左栏才会出现这个目录
  await post('/getnote/create', {
    dir: '拖动挪目录乙',
    title: '拖动挪目录-占位',
    content: '正文',
    withDatePrefix: false,
    requestId: 'seed-drag-move-placeholder',
  })

  const rowOf = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowOf('拖动挪目录乙') !== undefined, 8000, '左栏里出现目标目录')
  await waitFor(() => rowOf('拖动挪目录甲') !== undefined, 8000, '左栏里出现来源目录')

  // 前面的用例可能把搜索框填着、或者筛在某个目录上，先把列表退回全量，
  // 否则这一篇根本不在卡片里。
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    const setInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setInput.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(300)
  }
  const allRow = rowOf('全部笔记')
  if (allRow !== undefined) {
    allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }

  // 点开这一篇，后面要验笔记头里的路径跟着改。
  // 按 title（也就是整条路径）找，不按卡片上的字找：卡片标题取的是正文第一行
  // 那个 H1，和文件名并不一样。
  const card = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_card')).find(
        (el) => el.getAttribute('title') === '拖动挪目录甲/拖动挪目录-这一篇.md',
      ) || null,
    8000,
    '列表里的那一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '打开这一篇')
  await waitFor(
    () => (window.document.querySelector('.dshgn_notePath') || { textContent: '' }).textContent === '拖动挪目录甲/拖动挪目录-这一篇.md',
    8000,
    '笔记头显示原路径',
  )
  await sleep(250)

  // 拖到目标目录行上：先 dragover（要看到高亮），再 drop
  const target = rowOf('拖动挪目录乙')
  const carried = '拖动挪目录甲/拖动挪目录-这一篇.md'
  const makeTransfer = (withPanelPath) => ({
    types: withPanelPath ? ['text/plain', 'application/x-getnote-path'] : ['text/plain'],
    dropEffect: '',
    effectAllowed: '',
    setData: () => {},
    getData: (kind) => (withPanelPath && kind === 'application/x-getnote-path' ? carried : ''),
  })
  const fire = (kind, transfer, el) => {
    const event = new window.Event(kind, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: transfer, configurable: true })
    el.dispatchEvent(event)
    return event
  }

  // 宿主文件树那种拖动只有 text/plain：左栏不该接住，也不该亮
  const foreign = makeTransfer(false)
  fire('dragover', foreign, target)
  await sleep(80)
  assert.notEqual(rowOf('拖动挪目录乙').getAttribute('data-drop'), 'true', '不该为别人的拖动亮起来')
  assert.equal(foreign.dropEffect, 'copy', '别人的拖动还是走「拖进来导入」那条路')

  // 面板自己的拖动：dragover 要拦下来（否则浏览器不认这是合法落点）并亮起来
  const transfer = makeTransfer(true)
  const over = fire('dragover', transfer, target)
  assert.equal(over.defaultPrevented, true, '面板自己的拖动要认下来')
  await waitFor(() => rowOf('拖动挪目录乙').getAttribute('data-drop') === 'true', 5000, '目录行亮起来')

  const dropped = fire('drop', transfer, rowOf('拖动挪目录乙'))
  assert.equal(dropped.defaultPrevented, true, '放下之后不该再交给浏览器')
  await waitFor(
    () => (window.document.querySelector('.dshgn_toast') || { textContent: '' }).textContent.includes('已挪到 拖动挪目录乙'),
    8000,
    '说一声挪到哪儿了',
  )

  // 笔记头得跟着换成新路径：不然下一次保存会写回旧位置
  await waitFor(
    () => (window.document.querySelector('.dshgn_notePath') || { textContent: '' }).textContent === '拖动挪目录乙/拖动挪目录-这一篇.md',
    8000,
    '笔记头换成新路径',
  )
  assert.notEqual(rowOf('拖动挪目录乙').getAttribute('data-drop'), 'true', '放下之后高亮要收掉')

  // 文件真的挪过去了：新位置读得到，旧位置读不到
  const readAt = async (p) => {
    const res = await realFetch(server.origin + '/getnote/read?path=' + encodeURIComponent(p), {
      headers: { 'x-getnote-token': server.token },
    })
    return res.status
  }
  assert.equal(await readAt('拖动挪目录乙/拖动挪目录-这一篇.md'), 200, '新位置应该读得到')
  assert.notEqual(await readAt('拖动挪目录甲/拖动挪目录-这一篇.md'), 200, '旧位置不该还留着')

  // 正文还是原来那份（挪目录不该动内容）
  const after = await realFetch(
    server.origin + '/getnote/read?path=' + encodeURIComponent('拖动挪目录乙/拖动挪目录-这一篇.md'),
    { headers: { 'x-getnote-token': server.token } },
  )
  const afterBody = await after.json()
  assert.ok(String(afterBody.content || '').includes('正文第一句。'), '挪完正文不该变，实际 ' + afterBody.content)
})
/**
 * 笔记头那一行路径顺手也能点：读到一半想知道「这一篇在库里的哪儿」，
 * 以前得回列表、右键、再找「在文件列表里定位」。这里验：接上宿主之后
 * 路径变成可点的、点一下把路径交给宿主一次、回车和空格也行；
 * 没接上宿主时退回纯文字，不留一个点了没反应的可点外观。
 */
test('笔记头那行路径点一下就请宿主在文件列表里定位，没接上宿主就退回纯文字', async () => {
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
  const seeded = await post('/getnote/create', {
    dir: '随手记',
    title: '笔记头路径验收',
    content: ['# 笔记头路径验收', '', '正文一句。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-note-path-reveal',
  })
  const targetPath = seeded.path

  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  // 前面的用例可能把搜索框填着、或者筛在某个目录上，先退回全量
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    const setInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setInput.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(300)
  }
  const allRow = Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
    const label = el.querySelector('.dshgn_treeName')
    return label !== null && (label.textContent || '').trim() === '全部笔记'
  })
  if (allRow !== undefined) {
    allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }

  const cardOf = () =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === targetPath) || null
  const openCard = async () => {
    const card = await waitFor(cardOf, 8000, '列表里的那一篇')
    card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '打开这一篇')
    await waitFor(
      () => (window.document.querySelector('.dshgn_notePath') || { textContent: '' }).textContent === targetPath,
      8000,
      '笔记头显示这一篇的路径',
    )
  }
  const pathEl = () => window.document.querySelector('.dshgn_notePath')
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')

  // 1) 没接上宿主：就是一行字，不该看起来能点
  panel.setRevealInVault(null)
  await openCard()
  assert.equal(pathEl().className.includes('dshgn_notePathLink'), false, '没接上宿主时不该有可点外观')
  assert.equal(pathEl().getAttribute('role'), null, '没接上宿主时不是按钮')

  // 2) 接上宿主：路径变成按钮，点一下把路径交出去一次
  const revealed = []
  panel.setRevealInVault((path) => {
    revealed.push(String(path))
    return true
  })
  backBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 8000, '退回列表')
  await openCard()
  assert.equal(pathEl().className.includes('dshgn_notePathLink'), true, '接上宿主之后路径该能点')
  assert.equal(pathEl().getAttribute('role'), 'button', '能点的路径对读屏是按钮')
  assert.equal(pathEl().getAttribute('tabindex'), '0', '键盘也够得着')
  assert.ok(
    String(pathEl().getAttribute('title') || '').includes('在文件列表里定位'),
    '悬停要说清点一下会怎样，实际 ' + pathEl().getAttribute('title'),
  )

  pathEl().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(80)
  assert.equal(revealed.length, 1, '点一下该把路径交给宿主一次')
  assert.equal(revealed[0], targetPath, '交出去的就是这一篇的路径，实际 ' + revealed[0])

  // 回车和空格同样能触发：能点的东西键盘上也得能用
  pathEl().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await sleep(80)
  assert.equal(revealed.length, 2, '回车也该定位')
  pathEl().dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
  await sleep(80)
  assert.equal(revealed.length, 3, '空格也该定位')

  // 3) 宿主撤掉接口：重新渲染之后退回纯文字，点也不该再交出去
  panel.setRevealInVault(null)
  backBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 8000, '再退回列表')
  await openCard()
  assert.equal(pathEl().className.includes('dshgn_notePathLink'), false, '撤掉接口之后不该还留着可点外观')
  assert.equal(pathEl().getAttribute('role'), null, '撤掉接口之后不再是按钮')
  pathEl().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(80)
  assert.equal(revealed.length, 3, '没有接口时点了什么都不该发生')

  panel.setRevealInVault(null)
})

/**
 * 指向还不存在的笔记的双链要看得出来。
 *
 * 一篇笔记里十几个双链，原来它们和真链接长得一模一样，点下去才知道哪个是空的。
 * 宿主里这种链接是暗一档 + 虚下划线；这里按同一套判定给外观，点了仍走原来那条路。
 */
test('指向还不存在的笔记的双链暗一档、悬停说明白，真链接不受影响', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')
  await clickTab('笔记')

  // ── 纯渲染：认得出来的亮着，认不出来的暗下去 ──────────────────────────
  const { renderBlocks } = panel.__internals
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
  const linksOf = (nodes) =>
    walk(nodes, []).filter(
      (node) => node.type === 'button' && String(node.props.className || '').includes('dshgn_wikilink'),
    )
  const resolve = (name) => (name === '已经写过的那一篇' ? '随手记/已经写过的那一篇.md' : '')
  const nodes = renderBlocks('见 [[已经写过的那一篇]] 与 [[还没写的那一篇]]，还有 [方括号的那个](还没写的那一篇.md)。', {
    onOpenWikiLink: () => {},
    resolveNote: resolve,
  })
  const buttons = linksOf(nodes)
  assert.equal(buttons.length, 3, '三条链接都该渲染成可点的按钮，实际 ' + buttons.length)
  const alive = buttons.find((node) => String(node.props.children) === '已经写过的那一篇')
  const deadWiki = buttons.find((node) => String(node.props.children) === '还没写的那一篇')
  const deadSquare = buttons.find((node) => String(node.props.children) === '方括号的那个')
  assert.ok(alive !== undefined && deadWiki !== undefined && deadSquare !== undefined, '三条都找得到')
  assert.equal(String(alive.props.className).includes('dshgn_wikilinkDead'), false, '写得出的那篇不该暗')
  assert.equal(alive.props.title, undefined, '写得出的那篇不需要解释')
  assert.equal(String(deadWiki.props.className).includes('dshgn_wikilinkDead'), true, '还不存在的那篇该暗下去')
  assert.ok(
    String(deadWiki.props.title || '').includes('还没写的那一篇'),
    '悬停要说清是哪一篇找不到，实际 ' + deadWiki.props.title,
  )
  assert.equal(String(deadSquare.props.className).includes('dshgn_wikilinkDead'), true, '方括号写法也按同一套判定')
  // 没给解析函数时一律不暗：判断不了就别乱标
  const plain = renderBlocks('见 [[还没写的那一篇]]', { onOpenWikiLink: () => {} })
  assert.equal(String(linksOf(plain)[0].props.className).includes('dshgn_wikilinkDead'), false, '没接上解析函数时不标暗')

  // ── 真渲染：库里只有其中一篇，界面上只暗那一条 ────────────────────────
  const post = async (path, body) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res.json()
  }
  const existing = await post('/getnote/create', {
    dir: '随手记',
    title: '死链验收-已经写过',
    content: ['# 死链验收-已经写过', '', '这一篇真的存在。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-dead-link-target',
  })
  const source = await post('/getnote/create', {
    dir: '随手记',
    title: '死链验收-引用方',
    content: ['# 死链验收-引用方', '', '这里提到 [[死链验收-已经写过]] 与 [[死链验收-根本没写过]]。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-dead-link-source',
  })
  assert.ok(existing.path !== undefined && source.path !== undefined, '两篇都建好了')

  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    const setInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setInput.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(300)
  }
  const allRow = Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
    const label = el.querySelector('.dshgn_treeName')
    return label !== null && (label.textContent || '').trim() === '全部笔记'
  })
  if (allRow !== undefined) {
    allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }

  const cardOf = () =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === source.path) || null
  const card = await waitFor(cardOf, 8000, '引用方那一篇')
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '打开引用方')
  const bodyLinks = await waitFor(
    () => {
      const list = Array.from(window.document.querySelectorAll('.dshgn_md .dshgn_wikilink'))
      return list.length >= 2 ? list : null
    },
    8000,
    '正文里的两条双链',
  )
  const liveBtn = bodyLinks.find((el) => (el.textContent || '').trim() === '死链验收-已经写过')
  const deadBtn = bodyLinks.find((el) => (el.textContent || '').trim() === '死链验收-根本没写过')
  assert.ok(liveBtn !== undefined && deadBtn !== undefined, '两条都摆出来了')
  assert.equal(liveBtn.className.includes('dshgn_wikilinkDead'), false, '库里有的那篇不该暗')
  assert.equal(deadBtn.className.includes('dshgn_wikilinkDead'), true, '库里没有的那篇该暗下去')
  assert.ok(
    String(deadBtn.getAttribute('title') || '').includes('死链验收-根本没写过'),
    '悬停要说清是哪一篇找不到，实际 ' + deadBtn.getAttribute('title'),
  )

  // 点它仍然会明说一句，而不是什么都不发生
  deadBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => {
      const box = window.document.querySelector('.dshgn_error')
      return box !== null && String(box.textContent || '').includes('找不到')
    },
    5000,
    '点暗掉的双链也要明说一句',
  )

  window.document.querySelector('.dshgn_noteBack').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 8000, '退回列表')
})

test('搜索框里敲到一半，把库里已有的目录名和标签名摆出来，键盘挑一条补进去', async () => {
  const { searchSuggestAt, searchSuggestions } = panel.__internals

  // 只补正在敲的那一个词
  assert.deepEqual(searchSuggestAt('dir:随', 5), { kind: 'dir', query: '随', start: 4, wordStart: 0 })
  assert.deepEqual(searchSuggestAt('#读', 2), { kind: 'tag', query: '读', start: 1, wordStart: 0 })
  assert.deepEqual(searchSuggestAt('开会', 2), { kind: 'both', query: '开会', start: 0, wordStart: 0 })
  assert.deepEqual(searchSuggestAt('tag:读 会', 5), { kind: 'tag', query: '读', start: 4, wordStart: 0 })
  // 光标落在空白之后，正在敲的是下一个词
  assert.deepEqual(searchSuggestAt('tag:读 会', 7), { kind: 'both', query: '会', start: 6, wordStart: 6 })
  // 光标停在一个词后面（已经打了空白）就没什么可补的
  assert.equal(searchSuggestAt('开会 ', 3), null)
  assert.equal(searchSuggestAt('', 0), null)
  // 越界的光标不猜
  assert.equal(searchSuggestAt('abc', 99), null)
  assert.equal(searchSuggestAt('abc', -1), null)

  const dirs = ['随手记', '读书笔记', '归档']
  const tags = ['读书', '随手', '读书笔记摘抄']
  assert.deepEqual(
    searchSuggestions(dirs, tags, 'dir', '随').map((item) => item.value),
    ['随手记'],
  )
  assert.deepEqual(
    searchSuggestions(dirs, tags, 'tag', '读').map((item) => item.value),
    ['读书', '读书笔记摘抄'],
  )
  // 裸词两边都补：打头的排前面
  const both = searchSuggestions(dirs, tags, 'both', '读').map((item) => item.value)
  assert.ok(both.includes('读书笔记'))
  assert.ok(both.includes('读书'))
  // 空查询也有上限，不会把几十个标签一次铺满
  assert.ok(searchSuggestions(dirs, tags, 'both', '').length <= 6)
  assert.deepEqual(searchSuggestions(dirs, tags, 'dir', '根本没有这个'), [])

  // 真渲染：敲 dir:随 就摆出目录候选，上下键挑、回车补进去
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backBtn0 = () => window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn0()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }

  const box0 = window.document.querySelector('.dshgn_search')
  if (box0) {
    box0.value = ''
    box0.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(260)
  }

  await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '搜索补全验收',
      content: ['# 搜索补全验收', '', '这一篇用来把目录和标签带进索引。', '', '#读书'].join('\n'),
      withDatePrefix: false,
      requestId: 'seed-search-suggest',
    }),
  })

  await clickTab('笔记')
  const refreshBtn2 = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn2().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const box = await waitFor(() => window.document.querySelector('.dshgn_search'), 5000, '搜索框')
  const items = () => Array.from(window.document.querySelectorAll('.dshgn_suggestItem'))
  const type = async (text) => {
    box.value = text
    box.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(120)
  }
  const press = (key) => box.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))

  await type('dir:随')
  const first = await waitFor(() => items()[0] || null, 3000, '目录候选')
  assert.equal(first.getAttribute('data-kind'), 'dir')
  assert.ok(first.textContent.includes('随手记'))

  press('ArrowDown')
  await sleep(80)
  assert.equal(items()[0].getAttribute('data-on'), 'true')
  press('Enter')
  await sleep(150)
  assert.equal(box.value, 'dir:随手记 ')
  assert.equal(items().length, 0, '补进去之后候选该收起来')

  // 标签也一样：敲 #读 摆出标签候选
  await type('#读')
  const tagItem = await waitFor(
    () => items().find((el) => el.getAttribute('data-kind') === 'tag') || null,
    3000,
     '标签候选',
  )
  assert.ok(tagItem.textContent.includes('读书'))
  press('ArrowDown')
  await sleep(80)
  press('Enter')
  await sleep(150)
  assert.ok(box.value.startsWith('#读书') || box.value.startsWith('#读书笔记'))

  // 已经打了空白就不再提示
  await type('随便什么 ')
  await sleep(150)
  assert.equal(items().length, 0)

  // Esc 先收候选，不把已经敲好的词扔掉
  await type('dir:随')
  await waitFor(() => items().length > 0, 3000, '候选再出现')
  press('Escape')
  await sleep(120)
  assert.equal(items().length, 0)
  assert.equal(box.value, 'dir:随')

  box.value = ''
  box.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(200)
})
test('卡片上摆着这一篇的标签，点一颗就按它筛，多出来的收成 +N', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  const seed = async (title, tags, requestId) => {
    const content = ['---', 'tags: [' + tags.join(', ') + ']', '---', '', '# ' + title, '', '正文', ''].join('\n')
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '随手记', title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    return json.path
  }

  // 上一个用例可能把某篇开着：先退回空态，卡片才在列表里
  const back = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  const pathA = await seed(
    '卡片标签甲',
    ['卡片标签/子一', '卡片标签/子二', '卡片标签/子三', '卡片标签/子四'],
    'seed-card-tags-a',
  )
  const pathB = await seed('卡片标签乙', ['卡片标签乙独有'], 'seed-card-tags-b')
  assert.ok(pathA !== undefined && pathB !== undefined, '两篇都建好了')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const cardOf = (path) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === path) || null
  const cardA = await waitFor(() => cardOf(pathA), 8000, '四颗标签的那一篇')
  const cardB = await waitFor(() => cardOf(pathB), 8000, '一颗标签的那一篇')

  const chipsOf = (card) => Array.from(card.querySelectorAll('.dshgn_cardTag'))
  const chipsA = chipsOf(cardA)
  assert.equal(chipsA.length, 3, '最多摆三颗，实际 ' + chipsA.length)
  assert.deepEqual(
    chipsA.map((el) => (el.textContent || '').trim()),
    ['卡片标签/子一', '卡片标签/子二', '卡片标签/子三'],
    '摆的是最前面那三颗',
  )
  const moreA = cardA.querySelector('.dshgn_cardTagMore')
  assert.ok(moreA !== null, '多出来的要收成一颗 +N')
  assert.equal((moreA.textContent || '').trim(), '+1', '四颗里藏了一颗')
  assert.ok(
    String(chipsA[0].getAttribute('title') || '').includes('筛这个标签'),
    '悬停要说清点一下会怎样，实际 ' + chipsA[0].getAttribute('title'),
  )

  // 只有一颗标签的那篇不该冒出一个 +0
  assert.equal(chipsOf(cardB).length, 1)
  assert.equal(cardB.querySelector('.dshgn_cardTagMore'), null, '没多出来的就别摆 +0')

  // 点标签是「按它筛」，不是「打开这一篇」
  chipsA[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const cardTitles = () =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).map((el) => el.getAttribute('title'))
  await waitFor(
    () => {
      const list = cardTitles()
      return list.length === 1 && list[0] === pathA
    },
    5000,
    '点一颗标签之后只剩那个标签的笔记：' + JSON.stringify(cardTitles()),
  )
  assert.equal(
    rootNode().getAttribute('data-has-note'),
    'false',
    '点标签不该顺带把笔记打开',
  )
  const tagRowOn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_tagRow')).find((el) => el.title === '卡片标签/子一') || null
  const onRow = await waitFor(tagRowOn, 5000, '左栏那一行标签')
  assert.equal(onRow.getAttribute('data-on'), 'true', '左栏要跟着亮起来，同一个动作')

  // 收尾：把筛选退回去，别影响后面的用例
  const allRow = Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
    const label = el.querySelector('.dshgn_treeName')
    return label !== null && (label.textContent || '').trim() === '全部笔记'
  })
  if (allRow !== undefined) {
    allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }
})
/**
 * 批量移目录的目标目录原来是个空输入框：目录名得凭记忆手打，打错一个字不是
 * 「没找到」而是当场新建一个目录。这里验三件事：敲字就把库里已有的目录摆出来、
 * 挑一条只填进输入框（不直接动文件）、填好再按「移动」才真的挪。
 */
test('批量移动的目标目录能挑，不用凭记忆手打一个名字出来', async () => {
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
  const pathA = '批量移动甲/批量移动-这一篇.md'
  const seed = await post('/getnote/create', {
    dir: '批量移动甲',
    title: '批量移动-这一篇',
    content: ['# 批量移动', '', '正文第一句。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-batch-move-dir',
  })
  assert.equal(seed.path, pathA)
  // 目标目录里先放一篇，左栏与候选里才会出现它
  await post('/getnote/create', {
    dir: '批量移动乙',
    title: '批量移动-占位',
    content: '正文',
    withDatePrefix: false,
    requestId: 'seed-batch-move-placeholder',
  })

  // 退回空态、清搜索、退回全量，前面用例留下的状态别带进来
  const backBtn0 = () => window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn0()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setValue.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(300)
  }
  const rowOf = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })
  const allRow = rowOf('全部笔记')
  if (allRow !== undefined) {
    allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowOf('批量移动乙') !== undefined, 8000, '左栏里出现目标目录')

  // 勾一篇，展开批量操作
  const cardOf = (path) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === path) || null
  const card = await waitFor(() => cardOf(pathA), 8000, '要挪的那一篇')
  card.querySelector('.dshgn_pickBox').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_batchBar') !== null, 3000, '批量栏出现')
  const batchBtn = Array.from(window.document.querySelectorAll('.dshgn_batchBtn')).find(
    (el) => (el.textContent || '').trim() === '批量操作',
  )
  assert.ok(batchBtn, '应该有「批量操作」按钮')
  batchBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_batchMenu') !== null, 3000, '批量菜单展开')

  // 第二行那个输入框是「目标目录」
  const dirInput = () => window.document.querySelectorAll('.dshgn_batchInput')[1]
  assert.ok(dirInput(), '应该有一个目标目录输入框')
  const chips = () => Array.from(window.document.querySelectorAll('.dshgn_batchMenu .dshgn_suggestItem'))
  assert.equal(chips().length, 0, '没敲字之前不摆候选')

  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const type = async (text) => {
    setValue.call(dirInput(), text)
    dirInput().dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(140)
  }
  const press = (key) =>
    dirInput().dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

  // 敲到一半就把库里已有的目录摆出来
  await type('批量移动')
  const names = () => chips().map((el) => (el.querySelector('.dshgn_suggestName') || { textContent: '' }).textContent)
  assert.ok(chips().length >= 2, '应该摆出至少两个候选，实际 ' + JSON.stringify(names()))
  assert.ok(names().includes('批量移动甲'), '候选里要有来源目录，实际 ' + JSON.stringify(names()))
  assert.ok(names().includes('批量移动乙'), '候选里要有目标目录，实际 ' + JSON.stringify(names()))
  assert.ok(
    String(chips()[0].getAttribute('title') || '').includes('填进目标目录'),
    '悬停要说清点一下会怎样，实际 ' + chips()[0].getAttribute('title'),
  )

  // 上下键挑、回车填进去；填完候选收掉，文件还没动
  press('ArrowDown')
  await sleep(120)
  const onChip = chips().find((el) => el.getAttribute('data-on') === 'true')
  assert.ok(onChip, '按一下下键应该有一项被选中')
  press('Enter')
  await sleep(160)
  assert.ok(
    ['批量移动甲', '批量移动乙'].includes(dirInput().value),
    '回车应该把挑中的那一条填进去，实际 ' + dirInput().value,
  )
  assert.equal(chips().length, 0, '填进去之后候选要收掉')
  const before = await realFetch(server.origin + '/getnote/read?path=' + encodeURIComponent(pathA), {
    headers: { 'x-getnote-token': server.token },
  })
  assert.equal(before.status, 200, '挑候选不该动文件，原位置还得读得到')

  // 换一条：敲字之后点候选，也只填不挪
  await type('批量移动乙')
  const target = await waitFor(
    () => chips().find((el) => (el.textContent || '').includes('批量移动乙')) || null,
    3000,
    '目标目录的候选',
  )
  target.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  await sleep(160)
  assert.equal(dirInput().value, '批量移动乙', '点候选应该把目录名填进去')
  assert.equal(chips().length, 0, '点完候选要收掉')

  // Esc 先收候选，不把已经填好的目录清掉
  await type('批量移动')
  await waitFor(() => chips().length > 0, 3000, '再敲一次又摆出候选')
  press('Escape')
  await sleep(140)
  assert.equal(chips().length, 0, 'Esc 先把候选收起来')
  assert.equal(dirInput().value, '批量移动', 'Esc 不该把输入框里的字清掉')

  // 填好目标目录，再按「移动」才真的挪
  await type('批量移动乙')
  const moveBtn = Array.from(window.document.querySelectorAll('.dshgn_batchMenu .dshgn_btn')).find(
    (el) => (el.textContent || '').trim() === '移动',
  )
  assert.ok(moveBtn, '应该有「移动」按钮')
  assert.equal(moveBtn.disabled, false, '填了目录就该能按')
  moveBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => (window.document.querySelector('.dshgn_toast') || { textContent: '' }).textContent.includes('已处理'),
    8000,
    '说一声处理了几篇',
  )

  const movedPath = '批量移动乙/批量移动-这一篇.md'
  const readAt = async (p) =>
    realFetch(server.origin + '/getnote/read?path=' + encodeURIComponent(p), {
      headers: { 'x-getnote-token': server.token },
    })
  // waitFor 的判定是同步的，这里自己轮询：挪动是异步落盘的，读一次可能还看不到。
  let atNew = null
  for (let i = 0; i < 40 && atNew === null; i += 1) {
    const res = await readAt(movedPath)
    if (res.status === 200) atNew = res
    else await sleep(200)
  }
  assert.ok(atNew !== null, '文件应该挪到新目录')
  const body = await atNew.json()
  assert.ok(String(body.content || '').includes('正文第一句。'), '正文一个字都不该动')
  assert.notEqual((await readAt(pathA)).status, 200, '旧位置不该还留着')
})

test('断链那一行点「去这一句」就落到正文里写错的那一行，不是只送到篇首', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const liveScroller = () => window.document.querySelector('.dshgn_note .dshgn_scroll')
  const jumpBtnOf = () =>
    Array.from(window.document.querySelectorAll('.dshgn_brokenLine')).find((line) => {
      const name = line.querySelector('.dshgn_brokenTarget')
      return name !== null && name.textContent === '跳行验收-不存在的那篇'
    }) || null

  // 退回空态，并把搜索框清干净（前面用例可能还筛着某个目录）
  const back = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  // 那一条写错的双链放在十几行之后：只打开篇首的话，用户还得自己往下翻
  const filler = []
  for (let i = 0; i < 10; i += 1) filler.push('第 ' + (i + 1) + ' 段废话，跟这次跳转无关。')
  const body = ['# 断链跳行验收', ''].concat(filler).concat(['', '坏的 [[跳行验收-不存在的那篇]]。', ''])
  const createRes = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '断链跳行验收',
      content: body.join('\n'),
      withDatePrefix: false,
      requestId: 'seed-broken-jump',
    }),
  })
  assert.equal(createRes.ok, true, '造笔记失败：' + createRes.status)
  const targetPath = '随手记/断链跳行验收.md'

  await clickTab('断链')
  const jumpRow = await waitFor(jumpBtnOf, 8000, '断链页里应该有我们这一条')
  const jumpBtn = jumpRow.querySelector('.dshgn_brokenJump')
  assert.ok(jumpBtn, '这一行应该有一颗「去这一句」')
  assert.equal(jumpBtn.getAttribute('title'), '去这一句')
  assert.equal(jumpBtn.textContent, '去这一句')

  // jsdom 没有排版：按块序造一份假的纵向坐标，滚动容器自己从 0 起
  const realRect = window.HTMLElement.prototype.getBoundingClientRect
  const realScrollTo = window.HTMLElement.prototype.scrollTo
  const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th'
  const blockTopOf = (node) => {
    const note = node.closest('.dshgn_note .dshgn_scroll')
    if (!note) return 0
    const all = Array.from(note.querySelectorAll(BLOCKS))
    let hit = node
    while (hit && all.indexOf(hit) === -1) hit = hit.parentElement
    const index = hit ? all.indexOf(hit) : -1
    return (index < 0 ? all.length : index) * 100
  }
  let fakeTop = -1
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList && this.classList.contains('dshgn_scroll')) {
      return { top: 0, left: 0, width: 600, height: 400, bottom: 400, right: 600, x: 0, y: 0 }
    }
    const host = this.closest ? this.closest('.dshgn_scroll') : null
    if (!host) return realRect.call(this)
    const top = blockTopOf(this) - (host.scrollTop || 0)
    return { top, left: 0, width: 600, height: 20, bottom: top + 20, right: 600, x: 0, y: top }
  }
  window.HTMLElement.prototype.scrollTo = function (options) {
    const top = options && typeof options.top === 'number' ? options.top : 0
    this.scrollTop = top
    fakeTop = top
  }
  try {
    jumpBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '点「去这一句」应该打开那一篇')
    const scroller = await waitFor(liveScroller, 5000, '正文滚动容器')
    const pathEl = window.document.querySelector('.dshgn_notePath')
    assert.equal(pathEl.textContent, targetPath)
    // 写错的那一行在十几行之后：落点必须真的往下滚了，不是停在篇首
    await waitFor(() => scroller.scrollTop > 0, 3000, '落到写错的那一行')
    assert.ok(fakeTop > 0, '滚的是正文滚动容器，不是窗口')
    const noteText = window.document.querySelector('.dshgn_note').textContent
    assert.ok(noteText.includes('跳行验收-不存在的那篇'), '打开的确实是写错的那一篇')
  } finally {
    window.HTMLElement.prototype.getBoundingClientRect = realRect
    window.HTMLElement.prototype.scrollTo = realScrollTo
  }

  // 收尾退回空态，免得把状态留给下一条用例
  const back2 = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back2) back2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '收尾退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
})

test('长表格自己滚、表头钉在顶上；短表格不钉，免得一屏能看完的表多一层滚动', async () => {
  const { renderBlocks } = panel.__internals
  const walk = (nodes, out) => {
    for (const node of Array.isArray(nodes) ? nodes : [nodes]) {
      if (node === null || node === undefined || typeof node === 'string') continue
      out.push(node)
      const kids = node.props && node.props.children
      if (Array.isArray(kids)) walk(kids, out)
      else if (kids !== null && kids !== undefined && typeof kids === 'object') walk([kids], out)
    }
    return out
  }
  const wrapOf = (markdown) => {
    const nodes = renderBlocks(markdown, {})
    const flat = walk(nodes, [])
    return flat.find((node) => String(node.props && node.props.className || '').includes('dshgn_tableWrap'))
  }
  const table = (rows) => {
    const lines = ['| 列一 | 列二 |', '| --- | --- |']
    for (let i = 0; i < rows; i += 1) lines.push('| 第 ' + (i + 1) + ' 行 | 值 ' + (i + 1) + ' |')
    return lines.join('\n')
  }

  const tall = wrapOf(table(12))
  assert.ok(tall, '长表格该渲染成一块表格容器')
  assert.ok(String(tall.props.className).includes('dshgn_tableTall'), '长表格要能自己滚，实际 ' + tall.props.className)

  const short = wrapOf(table(3))
  assert.ok(short, '短表格该渲染成一块表格容器')
  assert.equal(String(short.props.className).includes('dshgn_tableTall'), false, '短表格不钉表头')

  // 真渲染：长表格确实多挂了一层可滚容器，短表格没有
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const back = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  const content = ['# 长表格验收', '', table(12), '', '中间一句。', '', table(2), ''].join('\n')
  const createRes = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '长表格验收',
      content,
      withDatePrefix: false,
      requestId: 'seed-tall-table',
    }),
  })
  assert.equal(createRes.ok, true, '造笔记失败：' + createRes.status)
  const targetPath = '随手记/长表格验收.md'

  await clickTab('笔记')
  const refresh = Array.from(window.document.querySelectorAll('button')).find((el) => (el.getAttribute('title') || '') === '刷新')
  assert.ok(refresh, '找不到刷新按钮')
  refresh.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)
  const card = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === targetPath),
    5000,
    '列表里出现这一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 5000, '打开这一篇')
  await waitFor(() => window.document.querySelector('.dshgn_tableTall') !== null, 5000, '长表格那块可滚区域')

  const wraps = Array.from(window.document.querySelectorAll('.dshgn_md .dshgn_tableWrap'))
  assert.equal(wraps.length, 2, '这篇里有两张表，实际 ' + wraps.length)
  assert.ok(wraps[0].classList.contains('dshgn_tableTall'), '第一张（12 行）要钉表头')
  assert.equal(wraps[1].classList.contains('dshgn_tableTall'), false, '第二张（2 行）不钉')

  // 收尾退回空态
  const back2 = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back2) back2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '收尾退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
})
test('查找条报出「第几处 / 共几处」，按到头了也知道自己在哪儿', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')
  await clickTab('笔记')
  const { countTextMatches } = panel.__internals
  // 纯函数：不分大小写、不重叠、空词算 0
  assert.equal(countTextMatches('桂圆 桂圆 龙眼', '桂圆'), 2)
  assert.equal(countTextMatches('GuiYuan guiyuan', 'guiyuan'), 2)
  assert.equal(countTextMatches('啊啊啊', '啊啊'), 1)
  assert.equal(countTextMatches('桂圆', '   '), 0)
  assert.equal(countTextMatches('', '桂圆'), 0)

  const post = async (path, body) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res.json()
  }
  const body = [
    '# 查找计数验收',
    '',
    '第一段里写着桂圆两个字。',
    '',
    '第二段里也有桂圆。',
    '',
    '第三段还是桂圆，一共三处。',
  ].join('\n')
  const targetPath = '随手记/查找计数验收.md'
  const seed = await post('/getnote/create', {
    dir: '随手记',
    title: '查找计数验收',
    content: body,
    withDatePrefix: false,
    requestId: 'seed-find-count',
  })
  assert.equal(seed.path, targetPath)

  // 退回空态、清搜索、退回全量，前面用例留下的状态别带进来
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = window.document.querySelector('.dshgn_noteBack')
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    const setBox = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setBox.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(300)
  }
  const rowOf = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })
  const allRow = rowOf('全部笔记')
  if (allRow !== undefined) {
    allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const cardOf = (path) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === path) || null
  const card = await waitFor(() => cardOf(targetPath), 8000, '列表里那一篇')
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '打开笔记')
  await waitFor(() => window.document.querySelector('.dshgn_md') !== null, 6000, '正文渲染')
  // 查找按钮与监听都是 effect 挂的，先让出一拍
  await sleep(250)

  // jsdom 没有排版，得给块补一份假排版，否则「下一处」永远停在原地
  const realRect = window.HTMLElement.prototype.getBoundingClientRect
  const realScrollTo = window.HTMLElement.prototype.scrollTo
  const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th'
  const blockTopOf = (node) => {
    const note = node.closest ? node.closest('.dshgn_note .dshgn_scroll') : null
    if (note === null || note === undefined) return null
    const all = Array.from(note.querySelectorAll(BLOCKS))
    let hit = node
    while (hit && all.indexOf(hit) === -1) hit = hit.parentElement
    if (!hit) return null
    const index = all.indexOf(hit)
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
  window.HTMLElement.prototype.scrollTo = function fakeScrollToTo(options) {
    if (options && typeof options.top === 'number') this.scrollTop = options.top
  }
  const setInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  try {
    const findBtn = () => Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '在这篇里找')
    findBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    const input = await waitFor(() => window.document.querySelector('.dshgn_findInput'), 5000, '查找输入框')
    const countEl = () => window.document.querySelector('.dshgn_findCount')
    assert.equal(countEl(), null, '刚打开还没找，不该摆一个 0/0')
    setInput.call(input, '桂圆')
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(150)
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await sleep(220)
    assert.ok(countEl() !== null, '找过之后要报出第几处')
    assert.equal((countEl().textContent || '').trim(), '1/3', '第一处 / 共三处')
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await sleep(220)
    assert.equal((countEl().textContent || '').trim(), '2/3')
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    await sleep(220)
    assert.equal((countEl().textContent || '').trim(), '1/3', '往回走也要报数')
    // 一路按到底：说完「到头了」，数字停在最后一处，不跳回 1
    for (let i = 0; i < 5; i += 1) {
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await sleep(160)
    }
    const toast = window.document.querySelector('.dshgn_toast')
    assert.ok(toast !== null && (toast.textContent || '').includes('到头了'), '到头了要说一声')
    assert.equal((countEl().textContent || '').trim(), '3/3', '到头之后停在最后一处')
    // 改词就把旧数字收掉：那是上一个词的进度，留着只会误导
    setInput.call(input, '龙眼')
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(150)
    assert.equal(countEl(), null, '改了词，旧的第几处要收掉')
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await sleep(220)
    assert.equal(countEl(), null, '这个词一处都没有，不报数')
    assert.ok((window.document.querySelector('.dshgn_toast').textContent || '').includes('这篇里没有'), '找不到要说「这篇里没有」')
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await sleep(150)
    assert.equal(countEl(), null, 'Esc 收起查找条，数字一起收掉')
  } finally {
    window.HTMLElement.prototype.getBoundingClientRect = realRect
    window.HTMLElement.prototype.scrollTo = realScrollTo
  }

  // 编辑态：正文没渲染，报的是 textarea 里那一段的第几处
  const editBtn = () => Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '编辑')
  editBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const editor = await waitFor(() => window.document.querySelector('.dshgn_editor'), 6000, '编辑区')
  await sleep(250)
  const setEditor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setEditor.call(editor, body)
  editor.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(200)
  try {
    editor.setSelectionRange(0, 0)
  } catch {
    // jsdom 里偶尔设不了选区，忽略
  }
  // 编辑态的笔记头没有那颗放大镜（只有「取消」），查找条走 textarea 自己的 Ctrl+F
  editor.focus()
  editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
  const input2 = await waitFor(() => window.document.querySelector('.dshgn_findInput'), 5000, '编辑态的查找输入框')
  editor.setSelectionRange(0, 0)
  setInput.call(input2, '桂圆')
  input2.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(150)
  input2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await sleep(220)
  const countEl2 = window.document.querySelector('.dshgn_findCount')
  assert.ok(countEl2 !== null, '编辑态也要报数')
  assert.equal((countEl2.textContent || '').trim(), '1/3', '编辑态从头找是第 1 处 / 共 3 处')
  input2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await sleep(220)
  assert.equal((window.document.querySelector('.dshgn_findCount').textContent || '').trim(), '2/3')
  input2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(150)
  editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(250)

  // 收尾：退回空态，别把编辑态留给后面的用例
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = window.document.querySelector('.dshgn_noteBack')
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
  } finally {
    panel.setConfirmDialog(null)
  }
})

test('待办那一行点「去这一条」就落到正文里写着这条待办的那一行，不是只送到篇首', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const liveScroller = () => window.document.querySelector('.dshgn_note .dshgn_scroll')
  const rowOf = (text) =>
    Array.from(window.document.querySelectorAll('.dshgn_todoRow')).find((el) =>
      (el.textContent || '').includes(text),
    ) || null

  // 退回空态，并把搜索框清干净（前面用例可能还筛着某个目录）
  const back = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  // 这条待办埋在十几行之后：只打开篇首的话，用户还得自己往下翻
  const filler = []
  for (let i = 0; i < 10; i += 1) filler.push('第 ' + (i + 1) + ' 段废话，跟这条待办无关。')
  const body = ['# 待办跳行验收', ''].concat(filler).concat(['', '- [ ] 买桂圆回去煮汤', ''])
  const createRes = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '待办跳行验收',
      content: body.join('\n'),
      withDatePrefix: false,
      requestId: 'seed-todo-jump-line',
    }),
  })
  assert.equal(createRes.ok, true, '造笔记失败：' + createRes.status)
  const targetPath = '随手记/待办跳行验收.md'

  await clickTab('待办')
  const row = await waitFor(() => rowOf('买桂圆回去煮汤'), 8000, '待办页里应该有我们这一条')
  const jumpBtn = row.querySelector('.dshgn_brokenJump')
  assert.ok(jumpBtn, '这一行应该有一颗「去这一条」')
  assert.equal(jumpBtn.getAttribute('title'), '去这一条')
  assert.equal(jumpBtn.textContent, '去这一条')

  // jsdom 没有排版：按块序造一份假的纵向坐标，滚动容器自己从 0 起
  const realRect = window.HTMLElement.prototype.getBoundingClientRect
  const realScrollTo = window.HTMLElement.prototype.scrollTo
  const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th'
  const blockTopOf = (node) => {
    const note = node.closest('.dshgn_note .dshgn_scroll')
    if (!note) return 0
    const all = Array.from(note.querySelectorAll(BLOCKS))
    let hit = node
    while (hit && all.indexOf(hit) === -1) hit = hit.parentElement
    const index = hit ? all.indexOf(hit) : -1
    return (index < 0 ? all.length : index) * 100
  }
  let fakeTop = -1
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList && this.classList.contains('dshgn_scroll')) {
      return { top: 0, left: 0, width: 600, height: 400, bottom: 400, right: 600, x: 0, y: 0 }
    }
    const host = this.closest ? this.closest('.dshgn_scroll') : null
    if (!host) return realRect.call(this)
    const top = blockTopOf(this) - (host.scrollTop || 0)
    return { top, left: 0, width: 600, height: 20, bottom: top + 20, right: 600, x: 0, y: top }
  }
  window.HTMLElement.prototype.scrollTo = function (options) {
    const top = options && typeof options.top === 'number' ? options.top : 0
    this.scrollTop = top
    fakeTop = top
  }
  try {
    jumpBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '点「去这一条」应该打开那一篇')
    const scroller = await waitFor(liveScroller, 5000, '正文滚动容器')
    const pathEl = window.document.querySelector('.dshgn_notePath')
    assert.equal(pathEl.textContent, targetPath)
    // 这条待办在十几行之后：落点必须真的往下滚了，不是停在篇首
    await waitFor(() => scroller.scrollTop > 0, 3000, '落到写着这条待办的那一行')
    assert.ok(fakeTop > 0, '滚的是正文滚动容器，不是窗口')
    const noteText = window.document.querySelector('.dshgn_note').textContent
    assert.ok(noteText.includes('买桂圆回去煮汤'), '打开的确实是写着这条待办的那一篇')
  } finally {
    window.HTMLElement.prototype.getBoundingClientRect = realRect
    window.HTMLElement.prototype.scrollTo = realScrollTo
  }

  // 收尾退回空态，免得把状态留给下一条用例
  const back2 = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back2) back2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '收尾退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
})
test('大图能左右一张张看，一张时就不摆那两颗按钮', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const maskOf = () => window.document.querySelector('.dshgn_zoomMask')
  const bigSrc = () => {
    const mask = maskOf()
    if (mask === null) return ''
    const pic = mask.querySelector('.dshgn_zoomImg')
    return pic === null ? '' : String(pic.getAttribute('src') || '')
  }
  const countText = () => {
    const mask = maskOf()
    if (mask === null) return ''
    const span = mask.querySelector('.dshgn_zoomCount')
    return span === null ? '' : span.textContent
  }
  const stepBtn = (title) => {
    const mask = maskOf()
    if (mask === null) return null
    return Array.from(mask.querySelectorAll('.dshgn_zoomStep')).find((el) => el.getAttribute('title') === title) || null
  }
  const press = (key) => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
  }

  // 只渲染遮罩本身时：没给图单就不摆按钮（一颗按了永远停在原地的按钮比没有更糟）
  const { ZoomOverlay } = panel.__internals
  const lone = ZoomOverlay({ src: 'http://x/a.png', name: 'a.png', onClose: () => {}, index: 0, total: 1, onStep: () => {} })
  const loneKids = Array.isArray(lone.props.children) ? lone.props.children : [lone.props.children]
  assert.equal(
    loneKids.filter((node) => node && typeof node === 'object' && node.props && node.props.className === 'dshgn_zoomBar').length,
    0,
    '只有一张图时不该摆左右按钮',
  )
  const stepped = []
  const many = ZoomOverlay({ src: 'http://x/b.png', name: 'b.png', onClose: () => {}, index: 1, total: 3, onStep: (d) => stepped.push(d) })
  const manyKids = Array.isArray(many.props.children) ? many.props.children : [many.props.children]
  const bar = manyKids.find((node) => node && typeof node === 'object' && node.props && node.props.className === 'dshgn_zoomBar')
  assert.ok(bar !== undefined, '多张图时该有那颗计数条')
  const barKids = Array.isArray(bar.props.children) ? bar.props.children : [bar.props.children]
  const countSpan = barKids.find((node) => node && typeof node === 'object' && node.props && node.props.className === 'dshgn_zoomCount')
  assert.equal(countSpan.props.children, '2 / 3', '计数是「第几张 / 共几张」')
  const prevBtn = barKids.find((node) => node && typeof node === 'object' && node.props && node.props.title === '上一张')
  const nextBtn = barKids.find((node) => node && typeof node === 'object' && node.props && node.props.title === '下一张')
  assert.ok(prevBtn !== undefined && nextBtn !== undefined, '该有上一张和下一张')
  prevBtn.props.onClick({ stopPropagation() {} })
  nextBtn.props.onClick({ stopPropagation() {} })
  assert.deepEqual(stepped, [-1, 1], '点按钮各自往回走一格 / 往前走一格')

  // 真渲染：一篇里三张图，点开第一张之后能一路看下去
  const back = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }
  const body = ['# 大图翻页验收', '', '![[翻页甲.png]]', '', '中间一句话。', '', '![[翻页乙.png]]', '', '![[翻页丙.png]]', '']
  const createRes = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '大图翻页验收',
      content: body.join('\n'),
      withDatePrefix: false,
      requestId: 'seed-zoom-gallery',
    }),
  })
  const seeded = await createRes.json()
  assert.equal(seeded.path, '随手记/大图翻页验收.md')

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

  const pics = await waitFor(() => {
    const list = window.document.querySelectorAll('.dshgn_md .dshgn_img')
    return list.length >= 3 ? list : null
  }, 8000, '正文里的三张图都该画出来')
  pics[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => maskOf() !== null, 5000, '点第一张图该放大')
  const first = bigSrc()
  assert.ok(first.includes('path='), '放大的还是同一张图')
  assert.equal(countText(), '1 / 3', '计数从第一张开始')

  stepBtn('下一张').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => countText() === '2 / 3', 5000, '点下一张该走到第二张')
  assert.notEqual(bigSrc(), first, '换了一张图')
  const second = bigSrc()

  press('ArrowRight')
  await waitFor(() => countText() === '3 / 3', 5000, '右键该走到第三张')
  assert.notEqual(bigSrc(), second)
  press('ArrowRight')
  await waitFor(() => countText() === '1 / 3', 5000, '走到头再往前就绕回第一张')
  assert.equal(bigSrc(), first, '绕回的是第一张那张图')
  press('ArrowLeft')
  await waitFor(() => countText() === '3 / 3', 5000, '往回走一格是最后一张')
  stepBtn('上一张').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => countText() === '2 / 3', 5000, '上一张按钮也能往回走')

  // 关掉之后笔记还读着，左右键也不该再弹图
  press('Escape')
  await waitFor(() => maskOf() === null, 5000, 'Esc 该收起来')
  press('ArrowRight')
  await sleep(120)
  assert.equal(maskOf(), null, '没放大时左右键不该弹图')
  assert.equal(rootNode().getAttribute('data-has-note'), 'true', 'Esc 只关遮罩，不该退出笔记')

  const back2 = window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    if (back2) back2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '收尾退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
})

test('批量操作里能把一个标签从选中的几篇里一起去掉，正文里那个 #标签 也不留', async () => {
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
  const pathA = '批量去标签甲/批量去标签-这一篇.md'
  const pathB = '批量去标签甲/批量去标签-那一篇.md'
  const seedA = await post('/getnote/create', {
    dir: '批量去标签甲',
    title: '批量去标签-这一篇',
    content: ['---', 'tags: [批量去标签]', '---', '', '# 批量去标签甲', '', '正文里也写一个 #批量去标签 在这儿。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-batch-untag-a',
  })
  assert.equal(seedA.path, pathA)
  const seedB = await post('/getnote/create', {
    dir: '批量去标签甲',
    title: '批量去标签-那一篇',
    content: ['---', 'tags: [批量去标签, 批量去标签保留]', '---', '', '# 批量去标签乙', '', '这篇只有头部挂着标签。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-batch-untag-b',
  })
  assert.equal(seedB.path, pathB)

  // 退回空态、清搜索、退回全量：前面用例留下的筛选别带进来
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setValue.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(300)
  }
  const rowOf = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })
  const allRow = rowOf('全部笔记')
  if (allRow !== undefined) {
    allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowOf('批量去标签甲') !== undefined, 8000, '左栏里出现这两篇所在的目录')

  // 两篇一起勾上
  const cardOf = (path) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === path) || null
  const cardA = await waitFor(() => cardOf(pathA), 8000, '第一篇')
  cardA.querySelector('.dshgn_pickBox').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(200)
  const cardB = await waitFor(() => cardOf(pathB), 8000, '第二篇')
  cardB.querySelector('.dshgn_pickBox').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_batchBar') !== null, 3000, '批量栏出现')
  const countText = () => (window.document.querySelector('.dshgn_batchCount') || { textContent: '' }).textContent
  assert.ok(String(countText()).includes('2'), '应该选中两篇，实际 ' + countText())

  const batchBtn = Array.from(window.document.querySelectorAll('.dshgn_batchBtn')).find(
    (el) => (el.textContent || '').trim() === '批量操作',
  )
  assert.ok(batchBtn, '应该有「批量操作」按钮')
  batchBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_batchMenu') !== null, 3000, '批量菜单展开')

  // 去标签和加标签共用第一个输入框
  const tagInput = () => window.document.querySelectorAll('.dshgn_batchInput')[0]
  assert.ok(tagInput(), '应该有标签输入框')
  const untagBtn = Array.from(window.document.querySelectorAll('.dshgn_batchMenu .dshgn_btn')).find(
    (el) => (el.textContent || '').trim() === '去标签',
  )
  assert.ok(untagBtn, '应该有「去标签」按钮')
  assert.equal(untagBtn.disabled, true, '还没填标签时不该能按')

  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setValue.call(tagInput(), '批量去标签')
  tagInput().dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(160)
  assert.equal(untagBtn.disabled, false, '填了标签就该能按')

  untagBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => (window.document.querySelector('.dshgn_toast') || { textContent: '' }).textContent.includes('已处理'),
    8000,
    '说一声处理了几篇',
  )

  const readAt = async (p) =>
    realFetch(server.origin + '/getnote/read?path=' + encodeURIComponent(p), {
      headers: { 'x-getnote-token': server.token },
    })
  const noteA = await (await readAt(pathA)).json()
  assert.ok(!(noteA.tags || []).includes('批量去标签'), '头部那个标签该没了，实际 ' + JSON.stringify(noteA.tags))
  assert.ok(
    !String(noteA.content || '').includes('#批量去标签'),
    '正文里那个 #标签 也该抹掉，实际 ' + String(noteA.content || ''),
  )
  assert.ok(String(noteA.content || '').includes('正文里也写一个'), '正文其余的字一个字都不该动')

  const noteB = await (await readAt(pathB)).json()
  assert.ok(!(noteB.tags || []).includes('批量去标签'), '第二篇的标签也该没了，实际 ' + JSON.stringify(noteB.tags))
  assert.ok(
    (noteB.tags || []).includes('批量去标签保留'),
    '同一篇里的别的标签不该被连带去掉，实际 ' + JSON.stringify(noteB.tags),
  )
})


test('左栏目录能收起来：点箭头把这一支折下去，再点展开，没有子目录的行不摆箭头', async () => {
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
  const made = await post('/getnote/create', {
    dir: '折叠验收/子目录一/更深一层',
    title: '折叠验收-最底下一篇',
    content: ['# 折叠验收底', '', '最底下的那一篇。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-fold-deep',
  })
  assert.ok(made && made.path, '造笔记失败：' + JSON.stringify(made))
  await post('/getnote/create', {
    dir: '折叠验收/子目录二',
    title: '折叠验收-第二支',
    content: ['# 折叠验收二', '', '第二支的一篇。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-fold-second',
  })
  await post('/getnote/create', {
    dir: '折叠验收',
    title: '折叠验收-根上那一篇',
    content: ['# 折叠验收根', '', '直接放在折叠验收下面的一篇。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-fold-root',
  })

  // 退回空态、清搜索、退回全量
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setValue.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(300)
  }
  const rowOf = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })
  const allRow = rowOf('全部笔记')
  if (allRow !== undefined) {
    allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowOf('折叠验收') !== undefined, 8000, '左栏里出现折叠验收这一支')

  const caretOf = (name) => {
    const row = rowOf(name)
    return row === undefined ? null : row.querySelector('.dshgn_treeFold')
  }
  // 底下还有目录的才摆箭头；叶子目录只留一段等宽空位，名字仍然对齐
  assert.ok(caretOf('折叠验收'), '「折叠验收」底下有子目录，应该有一颗折叠箭头')
  assert.ok(caretOf('子目录一'), '「子目录一」底下还有「更深一层」，也该有箭头')
  assert.equal(caretOf('子目录二'), null, '「子目录二」底下没有目录，不该摆一颗按了没反应的箭头')
  assert.ok(rowOf('更深一层') !== undefined, '一开始是全部展开的')

  // 点箭头把这一支折下去：子目录和更深的那些行都该从列表里消失
  caretOf('折叠验收').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(220)
  assert.ok(rowOf('折叠验收') !== undefined, '折下去之后这一行本身还在')
  assert.equal(rowOf('子目录一'), undefined, '折下去之后子目录不该还摊着')
  assert.equal(rowOf('更深一层'), undefined, '折下去之后更深的那一层也不该在')
  assert.equal(rowOf('子目录二'), undefined, '另一支同样收起来')
  assert.equal(caretOf('折叠验收').getAttribute('data-folded'), 'true', '箭头要转成「收着」的样子')
  assert.equal(caretOf('折叠验收').getAttribute('aria-expanded'), 'false')
  assert.equal(caretOf('折叠验收').getAttribute('title'), '展开子目录')

  // 点箭头只折叠，不顺手把这个目录选中
  assert.equal(rowOf('折叠验收').getAttribute('data-on'), 'false', '点箭头不该等于点这一行')

  // 再点一次展开
  caretOf('折叠验收').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(220)
  assert.ok(rowOf('子目录一') !== undefined, '展开之后子目录回来')
  assert.ok(rowOf('更深一层') !== undefined, '展开之后更深的那一层也回来')
  assert.equal(caretOf('折叠验收').getAttribute('data-folded'), 'false')
  assert.equal(caretOf('折叠验收').getAttribute('title'), '收起子目录')

  // 只折中间那一层：外层的兄弟目录不受影响
  caretOf('子目录一').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(220)
  assert.equal(rowOf('更深一层'), undefined, '折「子目录一」应该把它底下那一层收起来')
  assert.ok(rowOf('子目录二') !== undefined, '折一支不该把另一支也收掉')
  caretOf('子目录一').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(220)
  assert.ok(rowOf('更深一层') !== undefined, '再点一次又回来')
})


test('出链里指向还不存在的笔记暗一档、悬停说清是哪一篇，写得出的不受影响', async () => {
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
  const made = await post('/getnote/create', {
    dir: '随手记',
    title: '出链验收-写得出的那一篇',
    content: ['# 出链验收甲', '', '这一篇已经写好了。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-outlink-known',
  })
  assert.ok(made && made.path, '造笔记失败：' + JSON.stringify(made))
  const src = await post('/getnote/create', {
    dir: '随手记',
    title: '出链验收-引用方',
    content: ['# 出链验收乙', '', '见 [[出链验收-写得出的那一篇]]。', '', '还想写 [[出链验收-根本没写过的那一篇]]。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-outlink-source',
  })
  assert.ok(src && src.path, '造笔记失败：' + JSON.stringify(src))

  // 退回空态、清搜索、退回全量
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setValue.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(300)
  }
  const allRow = Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
    const label = el.querySelector('.dshgn_treeName')
    return label !== null && (label.textContent || '').trim() === '全部笔记'
  })
  if (allRow !== undefined) {
    allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const cardOf = (path) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === path)
  await waitFor(() => cardOf(src.path) !== undefined, 8000, '列表里出现引用方那一篇')
  cardOf(src.path).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '打开引用方那一篇')
  await waitFor(() => window.document.querySelector('.dshgn_notePath') !== null, 5000, '笔记头出现')

  const chips = () =>
    Array.from(window.document.querySelectorAll('.dshgn_outlinks .dshgn_outlinkChip'))
  await waitFor(() => chips().length === 2, 8000, '出链里摆出两条')
  const known = chips().find((el) => (el.textContent || '').trim() === '出链验收-写得出的那一篇')
  const dead = chips().find((el) => (el.textContent || '').trim() === '出链验收-根本没写过的那一篇')
  assert.ok(known !== undefined && dead !== undefined, '两条出链都该在')
  assert.equal(known.className.includes('dshgn_outlinkDead'), false, '写得出的那一条不该暗下去')
  assert.equal(known.getAttribute('title'), '出链验收-写得出的那一篇', '写得出的那一条悬停就是名字本身')
  assert.equal(dead.className.includes('dshgn_outlinkDead'), true, '还没写的那一条要暗下去')
  assert.ok((dead.getAttribute('title') || '').includes('出链验收-根本没写过的那一篇'), '悬停要说清是哪一篇找不到')

  // 暗下去只是外观，点下去仍走原来那条路：明说一句库里找不到
  dead.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)
  const errorBox = window.document.querySelector('.dshgn_error')
  assert.ok(errorBox !== null, '点死链该明说一句')
  assert.ok((errorBox.textContent || '').includes('找不到'), '要说清找不到，实际：' + (errorBox.textContent || ''))

  // 收尾：退回空态，别把错误条留在那儿给后面的用例
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '收尾退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
})


test('搜索框里打了字就摆一颗清空，点一下退回整份列表、光标还在框里', async () => {
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
  const made = await post('/getnote/create', {
    dir: '随手记',
    title: '清空验收-这一篇',
    content: ['# 清空验收', '', '这一篇是为了让搜索框里能敲出字来。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-search-clear',
  })
  assert.ok(made && made.path, '造笔记失败：' + JSON.stringify(made))

  // 退回空态
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const box = () => window.document.querySelector('.dshgn_search')
  const clearOf = () => window.document.querySelector('.dshgn_searchClear')
  const cards = () => Array.from(window.document.querySelectorAll('.dshgn_card'))
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const type = async (text) => {
    setValue.call(box(), text)
    box().dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(120)
  }

  // 先把搜索框清空，量一下「整份列表」有多少篇
  if (box() !== null && box().value !== '') {
    await type('')
    await sleep(400)
  }
  await waitFor(() => cards().length > 0, 8000, '列表里有卡片')
  const allCount = cards().length
  assert.equal(clearOf(), null, '空搜索框上不该摆一颗清空')

  // 打两个字：清空出现，列表跟着筛
  await type('清空验收')
  const btn = clearOf()
  assert.ok(btn !== null, '搜索框里有字时该摆一颗清空')
  assert.equal(btn.getAttribute('title'), '清空')
  assert.equal(btn.getAttribute('aria-label'), '清空')
  await waitFor(() => window.document.querySelector('.dshgn_searching') === null, 8000, '搜索结果回来')
  assert.ok(cards().length < allCount, '筛过之后卡片该变少，实际：' + cards().length + ' / ' + allCount)

  // 点一下：搜索框清空、清空按钮收掉、列表回到整份
  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(500)
  assert.equal(box().value, '', '点清空之后搜索框该是空的')
  assert.equal(clearOf(), null, '清空之后那颗按钮自己也收掉')
  assert.equal(cards().length, allCount, '列表该回到整份，实际：' + cards().length + ' / ' + allCount)
  assert.equal(window.document.activeElement, box(), '点完光标还在搜索框里，好接着敲下一个词')

  // 再敲一次、用 Esc 也能清掉（这条路上本来就通，这里顺手确认没被新按钮挡住）
  await type('清空验收')
  await sleep(300)
  assert.ok(clearOf() !== null, '又出现一颗清空')
  box().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(400)
  assert.equal(box().value, '', 'Esc 仍然能把搜索词清掉')
  assert.equal(clearOf(), null, 'Esc 之后清空按钮也收掉')
})


test('读到篇尾看得见这一篇多少字、大概读几分钟', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')
  await clickTab('笔记')

  const { readingMinutes } = panel.__internals
  assert.equal(readingMinutes(0), 0, '零字不报时间')
  assert.equal(readingMinutes(120), 1, '不足一分钟也报 1 分钟，不报 0')
  assert.equal(readingMinutes(300), 1)
  assert.equal(readingMinutes(900), 3)
  assert.equal(readingMinutes(3000), 10)

  const post = async (path, body) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res.json()
  }
  const made = await post('/getnote/create', {
    dir: '随手记',
    title: '阅读统计验收',
    content: ['# 阅读统计验收', '', '这一篇是用来量字数的。', '', '再写一句话凑够几个字。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-read-foot',
  })
  assert.ok(made && made.path, '造笔记失败：' + JSON.stringify(made))

  // 退回空态
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setValue.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(300)
  }
  const allRow = Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
    const label = el.querySelector('.dshgn_treeName')
    return label !== null && (label.textContent || '').trim() === '全部笔记'
  })
  if (allRow !== undefined) {
    allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const cardOf = (path) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === path)
  await waitFor(() => cardOf(made.path) !== undefined, 8000, '列表里出现这一篇')
  cardOf(made.path).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '打开这一篇')

  const foot = () => window.document.querySelector('.dshgn_readFoot')
  await waitFor(() => foot() !== null, 8000, '篇尾统计条出现')
  const text = (foot().textContent || '').trim()
  assert.ok(/\d+ 字/.test(text), '要报字数，实际：' + text)
  assert.ok(text.includes('分钟读完'), '要报大概读多久，实际：' + text)
  // 篇尾统计条在正文之后，不在笔记头
  const scroll = window.document.querySelector('.dshgn_scroll')
  assert.ok(scroll !== null && scroll.contains(foot()), '统计条该在滚动容器里（正文之后）')

  // 编辑态不摆阅读统计：那时脚下是草稿字数 + 保存提示
  const editBtn = Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '编辑')
  assert.ok(editBtn !== undefined, '笔记头该有编辑按钮')
  editBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)
  assert.equal(foot(), null, '编辑态不摆阅读统计')
  const editorFoot = window.document.querySelector('.dshgn_editorFoot')
  assert.ok(editorFoot !== null && !editorFoot.className.includes('dshgn_readFoot'), '编辑态脚下是草稿字数那条')
  const cancelBtn = Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '取消')
  if (cancelBtn !== undefined) {
    cancelBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }

  // 收尾退回空态
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '收尾退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
})

test('待办页能把整份清单一次抄走，按篇分组、按行号排', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backToList = async () => {
    const back = rootNode().querySelector('.dshgn_noteBack')
    if (back !== null) {
      panel.setConfirmDialog(() => Promise.resolve(true))
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false')
  }
  await backToList()
  const search = rootNode().querySelector('.dshgn_search')
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, '')
  search.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(400)

  const make = async (dir, title, content, requestId) => {
    const res = await realFetch(`${server.origin}/getnote/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir, title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    return json.path
  }
  await make('随手记', '待办复制验收甲', ['# 待办复制验收甲', '', '- [ ] 先买桂圆', '- [x] 已经做完的那条', '- [ ] 再买莲子', ''].join('\n'), 'seed-todo-copy-a')
  await make('随手记', '待办复制验收乙', ['# 待办复制验收乙', '', '- [ ] 乙那边的第一条', ''].join('\n'), 'seed-todo-copy-b')

  clickTab('待办')
  const rowOf = (text) => {
    const rows = Array.from(rootNode().querySelectorAll('.dshgn_todoRow'))
    return rows.find((row) => String(row.textContent || '').includes(text)) || null
  }
  await waitFor(() => rowOf('先买桂圆'))

  const written = []
  clipboard.writeText = async (text) => { written.push(String(text)) }

  const head = rootNode().querySelector('.dshgn_sectionHead')
  const copyBtn = Array.from(head.querySelectorAll('.dshgn_btn')).find((btn) => String(btn.textContent || '').includes('复制这份清单'))
  assert.ok(copyBtn, '待办页顶上该有一颗「复制这份清单」')
  copyBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => written.length > 0)
  const copied = written[0]

  assert.ok(copied.includes('## 待办复制验收甲'), '按篇分组，标题当小标题')
  assert.ok(copied.includes('## 待办复制验收乙'))
  assert.ok(copied.includes('- [ ] 先买桂圆'))
  assert.ok(copied.includes('- [ ] 再买莲子'))
  assert.ok(!copied.includes('已经做完的那条'), '已经勾掉的不会再抄进去')
  assert.ok(copied.indexOf('先买桂圆') < copied.indexOf('再买莲子'), '同一篇里按行号排')
  // 剪贴板写入先返回、提示是紧接着那一步才弹的，别在这一瞬间就去读 DOM
  // 提示条挂在 .dshgn_root 外面的兄弟节点上，得从 document 上找
  const toastText = await waitFor(() => {
    const node = window.document.querySelector('.dshgn_toast')
    return node === null ? null : String(node.textContent || '')
  })
  assert.ok(toastText.includes('条待办'), '抄完给一句「已复制 N 条待办」')
  // 库里可能还有前面用例留下的待办，条数按抄出来的那几行数
  const counted = copied.split('\n').filter((line) => line.startsWith('- [ ] ')).length
  assert.ok(toastText.includes(String(counted)), '抄了几条就说几条')
})

test('左栏目录右键改名，整棵子树连同笔记一起搬到新名字下', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backToList = async () => {
    const back = rootNode().querySelector('.dshgn_noteBack')
    if (back !== null) {
      panel.setConfirmDialog(() => Promise.resolve(true))
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false')
  }
  await backToList()
  // 上一条用例可能停在「待办」页签上，那一页没有搜索框——先回到笔记页再清搜索。
  clickTab('笔记')
  await waitFor(() => rootNode().querySelector('.dshgn_search') !== null, 4000, '笔记页签里有搜索框')
  const search = rootNode().querySelector('.dshgn_search')
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, '')
  search.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(400)

  const make = async (dir, title, content, requestId) => {
    const res = await realFetch(`${server.origin}/getnote/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir, title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    return json.path
  }
  const inside = await make('改名验收甲', '改名验收甲里的', ['# 改名验收甲里的', '', '正文第一句。', ''].join('\n'), 'seed-dir-rename-a')

  const rowOf = (name) =>
    Array.from(rootNode().querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowOf('改名验收甲') !== undefined, 8000, '左栏里出现新目录')

  // 右键这一行，菜单里应该有一颗「改名」
  rowOf('改名验收甲').dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  const renameBtn = await waitFor(() => {
    const menu = rootNode().querySelector('.dshgn_rowMenu')
    if (menu === null) return null
    const hit = Array.from(menu.querySelectorAll('.dshgn_rowBtn')).find((btn) => btn.title === '改名')
    return hit === undefined ? null : hit
  }, 4000, '目录行右键里应该有「改名」')
  renameBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

  const input = await waitFor(() => rootNode().querySelector('.dshgn_treeNewInput'), 4000, '改名输入框出现')
  // 预填的是整条路径，用户只改最后一段就够
  assert.equal(input.value, '改名验收甲')
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '改名验收乙')
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(60)
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

  await waitFor(() => rowOf('改名验收乙') !== undefined, 8000, '左栏里出现新目录名')
  assert.equal(rowOf('改名验收甲'), undefined, '旧目录名不该还在')

  const toastText = await waitFor(() => {
    const node = window.document.querySelector('.dshgn_toast')
    return node === null ? null : String(node.textContent || '')
  })
  assert.ok(toastText.includes('目录已改名'), '改完给一句提示，实际 ' + toastText)

  // 笔记真的跟着搬过去了
  const readAt = async (path) =>
    realFetch(`${server.origin}/getnote/read?path=${encodeURIComponent(path)}`, {
      headers: { 'x-getnote-token': server.token },
    })
  const movedPath = '改名验收乙/改名验收甲里的.md'
  let movedOk = false
  for (let i = 0; i < 30; i += 1) {
    const res = await readAt(movedPath)
    if (res.status === 200) {
      const json = await res.json()
      if (String(json.content || '').includes('正文第一句。')) movedOk = true
      break
    }
    await sleep(100)
  }
  assert.equal(movedOk, true, '新位置应该读得到那一篇，正文不变')
  const oldRes = await readAt(inside)
  assert.notEqual(oldRes.status, 200, '旧位置不该还留着')
})

test('批量加标签时标签框也摆出库里已有的标签，敲到一半挑一条补进去', async () => {
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
  const pathA = '批量标签甲/批量标签-这一篇.md'
  const seed = await post('/getnote/create', {
    dir: '批量标签甲',
    title: '批量标签-这一篇',
    content: ['---', 'tags: [批量标签一, 批量标签二]', '---', '', '# 批量标签', '', '正文第一句。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-batch-tag-suggest',
  })
  assert.equal(seed.path, pathA)

  const backBtn0 = () => window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn0()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    const setValue0 = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setValue0.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(300)
  }
  const rowOf = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })
  const allRow = rowOf('全部笔记')
  if (allRow !== undefined) {
    allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowOf('批量标签甲') !== undefined, 8000, '左栏里出现这一篇的目录')

  const cardOf = (path) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === path) || null
  const card = await waitFor(() => cardOf(pathA), 8000, '要加标签的那一篇')
  card.querySelector('.dshgn_pickBox').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_batchBar') !== null, 3000, '批量栏出现')
  const batchBtn = Array.from(window.document.querySelectorAll('.dshgn_batchBtn')).find(
    (el) => (el.textContent || '').trim() === '批量操作',
  )
  assert.ok(batchBtn, '应该有「批量操作」按钮')
  batchBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_batchMenu') !== null, 3000, '批量菜单展开')

  // 第一行那个输入框是「标签」
  const tagInput = () => window.document.querySelectorAll('.dshgn_batchInput')[0]
  assert.ok(tagInput(), '应该有一个标签输入框')
  // 上一条用例在目录框里敲过字，目录候选可能还摆着——这里只数标签那一档。
  const chips = () =>
    Array.from(window.document.querySelectorAll('.dshgn_batchMenu .dshgn_suggestItem')).filter(
      (el) => el.getAttribute('data-kind') === 'tag',
    )
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const type = async (text) => {
    setValue.call(tagInput(), text)
    tagInput().dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(140)
  }
  // 前面那条「去标签」用例在同一颗输入框里敲过字、面板状态还留着，
  // 先清空再看「空框上不摆候选」。
  await type('')
  assert.equal(chips().length, 0, '没敲字之前不摆候选')
  const press = (key) =>
    tagInput().dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  const names = () => chips().map((el) => (el.querySelector('.dshgn_suggestName') || { textContent: '' }).textContent)

  // 敲到一半就把库里已有的标签摆出来
  await type('批量标签')
  assert.ok(chips().length >= 2, '应该摆出至少两个候选，实际 ' + JSON.stringify(names()))
  assert.ok(names().includes('批量标签一'), '候选里要有这一篇贴过的标签，实际 ' + JSON.stringify(names()))
  assert.ok(names().includes('批量标签二'), '候选里要两个都在，实际 ' + JSON.stringify(names()))
  assert.ok(
    String(chips()[0].getAttribute('title') || '').includes('填进标签框'),
    '悬停要说清点一下会怎样，实际 ' + chips()[0].getAttribute('title'),
  )

  // 上下键挑、回车填进去；填完候选收掉，标签还没加上
  press('ArrowDown')
  await sleep(120)
  assert.ok(chips().find((el) => el.getAttribute('data-on') === 'true'), '按一下下键应该有一项被选中')
  press('Enter')
  await sleep(160)
  assert.ok(
    ['批量标签一', '批量标签二'].includes(tagInput().value),
    '回车应该把挑中的那一条填进去，实际 ' + tagInput().value,
  )
  assert.equal(chips().length, 0, '填进去之后候选要收掉')

  // Esc 先收候选，不把已经填好的标签清掉
  await type('批量标签')
  await waitFor(() => chips().length > 0, 3000, '再敲一次又摆出候选')
  press('Escape')
  await sleep(140)
  assert.equal(chips().length, 0, 'Esc 先把候选收起来')
  assert.equal(tagInput().value, '批量标签', 'Esc 不该把输入框里的字清掉')

  // 挑一条填好再按「加标签」才真的加
  await type('批量标签二')
  const addBtn = Array.from(window.document.querySelectorAll('.dshgn_batchMenu .dshgn_btn')).find(
    (el) => (el.textContent || '').trim() === '加标签',
  )
  assert.ok(addBtn, '应该有「加标签」按钮')
  addBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => (window.document.querySelector('.dshgn_toast') || { textContent: '' }).textContent.includes('已处理'),
    8000,
    '说一声处理了几篇',
  )
  const readAt = async (p) =>
    realFetch(server.origin + '/getnote/read?path=' + encodeURIComponent(p), {
      headers: { 'x-getnote-token': server.token },
    })
  let text = ''
  for (let i = 0; i < 40; i += 1) {
    const res = await readAt(pathA)
    if (res.status === 200) {
      const json = await res.json()
      text = String(json.content || '')
      break
    }
    await sleep(200)
  }
  assert.ok(text.includes('批量标签二'), '头部应该有这个标签，实际 ' + text.split('\n').slice(0, 4).join(' / '))
})
test('新建笔记时能指定建到哪个目录，不用建完再挪一次', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const post = async (path, payload) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(payload),
    })
    return res.json()
  }
  const wd = '新建挑目录'

  // 退回空态、清搜索、退回全量：否则目标目录可能根本不在左栏
  panel.setConfirmDialog(() => true)
  for (let i = 0; i < 4; i += 1) {
    const back = window.document.querySelector('.dshgn_noteBack')
    if (back === null) break
    back.click()
    await sleep(150)
  }
  clickTab('笔记')
  await waitFor(() => {
    const root = rootNode()
    return root !== null && root.querySelector('.dshgn_search') !== null
  }, 4000, '搜索框')
  const search = rootNode().querySelector('.dshgn_search')
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, '')
  search.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(400)
  const allRow = Array.from(rootNode().querySelectorAll('.dshgn_treeRow')).find(
    (el) => el.textContent.indexOf('全部笔记') !== -1,
  )
  if (allRow) allRow.click()
  await sleep(200)

  // 目标目录先有内容：空目录不列在左栏，候选也就摆不出来
  await post('/getnote/create', {
    dir: `${wd}/挑目录甲`,
    title: '占位',
    content: ['# 占位', '', '正文。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-newdir-a',
  })
  await post('/getnote/create', {
    dir: `${wd}/挑目录乙`,
    title: '占位',
    content: ['# 占位', '', '正文。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-newdir-b',
  })
  const refreshBtn = Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find(
    (el) => el.getAttribute('title') === '刷新',
  )
  refreshBtn.click()
  await waitFor(
    () => Array.from(rootNode().querySelectorAll('.dshgn_treeName')).some((el) => el.textContent === '挑目录乙'),
    8000,
    '左栏出现目标目录',
  )

  const plusBtn = Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find(
    (el) => el.getAttribute('title') === '新建',
  )
  assert.ok(plusBtn, '顶栏该有那颗新建的 +')
  plusBtn.click()
  await waitFor(() => window.document.querySelector('.dshgn_menu') !== null, 4000, '模板菜单')

  const dirInput = () => window.document.querySelector('.dshgn_menu .dshgn_batchInput')
  const chips = () =>
    Array.from(window.document.querySelectorAll('.dshgn_menu .dshgn_suggestItem')).filter(
      (el) => el.getAttribute('data-kind') === 'dir',
    )
  const type = async (text) => {
    const input = dirInput()
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, text)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(150)
  }

  assert.ok(dirInput(), '菜单里该有一行填目录的输入框')
  assert.equal(chips().length, 0, '没敲字时不该摆候选')

  await type(wd)
  assert.ok(chips().length >= 2, `敲字后该摆出库里已有的目录，实际 ${chips().length} 条`)
  assert.ok(chips().some((el) => el.textContent.indexOf('挑目录甲') !== -1), '候选里该有挑目录甲')
  assert.ok(chips().some((el) => el.textContent.indexOf('挑目录乙') !== -1), '候选里该有挑目录乙')
  assert.ok(
    chips()[0].getAttribute('title').indexOf('建到这个目录') !== -1,
    '候选的悬停说明该说清点一下会怎样',
  )

  // 只敲到「挑」为止：再往前敲一个字，父目录本身也会是候选，
  // 挑中它等于没换，验不出「回车把候选填了进去」。
  await type(`${wd}/挑`)
  assert.ok(chips().length >= 2, `敲到子目录该有候选，实际 ${chips().length} 条`)
  dirInput().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  await sleep(150)
  const lit = chips().filter((el) => el.getAttribute('data-on') === 'true')
  assert.equal(lit.length, 1, '按上下键该有一项亮着')
  const wanted = lit[0].textContent
  dirInput().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await sleep(200)
  assert.equal(dirInput().value, wanted, '回车该把亮着的那条候选填进输入框')
  assert.equal(chips().length, 0, '填好之后候选该收掉')
  assert.ok(window.document.querySelector('.dshgn_menu') !== null, '挑候选不该把菜单关掉')

  await type(`${wd}/挑目录乙`)
  assert.ok(chips().length >= 1, '再敲一次该重新摆出候选')
  chips()[0].dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  await sleep(200)
  assert.equal(dirInput().value, `${wd}/挑目录乙`, '点候选该把它填进去')
  assert.equal(chips().length, 0, '点完候选该收掉')

  // 挑一条只填名字：这会儿库里还不该多出任何一篇
  const treeBefore = await (await realFetch(`${server.origin}/getnote/tree`, {
    headers: { 'x-getnote-token': server.token },
  })).json()
  const beforeCount = (treeBefore.entries || []).length

  const item = Array.from(window.document.querySelectorAll('.dshgn_menuItem')).find(
    (el) => el.textContent.indexOf('随手记') !== -1,
  )
  assert.ok(item, '模板菜单里该有随手记那一项')
  item.click()
  await waitFor(() => window.document.querySelector('.dshgn_notePath') !== null, 8000, '新建完打开那一篇')
  const path = window.document.querySelector('.dshgn_notePath').textContent
  assert.ok(path.startsWith(`${wd}/挑目录乙/`), `新建的这一篇该落在挑目录乙里，实际 ${path}`)

  const treeAfter = await (await realFetch(`${server.origin}/getnote/tree`, {
    headers: { 'x-getnote-token': server.token },
  })).json()
  assert.equal((treeAfter.entries || []).length, beforeCount + 1, '只该多出这一篇')

  panel.setConfirmDialog(() => true)
  const back = window.document.querySelector('.dshgn_noteBack')
  if (back) back.click()
  await sleep(150)
})

test('双链指到还不存在的笔记时，报错行里那颗「写一篇」就地把它建出来', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const post = async (path, body) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  // 退回空态
  panel.setConfirmDialog(() => true)
  for (let i = 0; i < 4; i += 1) {
    const back = window.document.querySelector('.dshgn_noteBack')
    if (back === null) break
    back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(200)
  }
  clickTab('笔记')
  await waitFor(
    () => {
      const root = rootNode()
      return root !== null && root.querySelector('.dshgn_search') !== null
    },
    4000,
    '搜索框',
  )
  const searchBox = window.document.querySelector('.dshgn_search')
  const setInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setInput.call(searchBox, '')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(400)
  const allRow = Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
    const label = el.querySelector('.dshgn_treeName')
    return label !== null && (label.textContent || '').trim() === '全部笔记'
  })
  if (allRow !== undefined) {
    allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(200)
  }

  const name = '补写验收-还没写的那一篇'
  const source = await post('/getnote/create', {
    dir: '补写验收',
    title: '补写验收-引用方',
    content: ['# 补写验收-引用方', '', `这里提到 [[${name}]]。`, ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-create-missing-source',
  })
  assert.ok(source.path !== undefined, '引用方该建得出来')

  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const card = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_card')).find(
        (el) => el.getAttribute('title') === source.path,
      ) || null,
    8000,
    '引用方那一篇',
  )
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '打开那一篇')

  const dead = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_md .dshgn_wikilink')).find(
        (el) => (el.textContent || '').trim() === name,
      ) || null,
    6000,
    '那条还没写的双链',
  )
  assert.ok(String(dead.className).includes('dshgn_wikilinkDead'), '还没写的该暗着')

  dead.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const fixBtn = await waitFor(
    () => window.document.querySelector('.dshgn_error .dshgn_errorBtn'),
    6000,
    '报错行里的补救按钮',
  )
  assert.ok(
    String(fixBtn.textContent || '').includes(name),
    `按钮该说清要写哪一篇，实际 ${fixBtn.textContent}`,
  )
  assert.ok(
    String(fixBtn.getAttribute('title') || '').includes('同一个目录') ||
      String(fixBtn.getAttribute('title') || '').includes('目录'),
    '悬停该说清会落在哪儿',
  )

  fixBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => String((window.document.querySelector('.dshgn_notePath') || {}).textContent || '').includes(name),
    8000,
    '建完当场打开',
  )
  assert.equal(
    window.document.querySelector('.dshgn_notePath').textContent,
    `补写验收/${name}.md`,
    '落在引用方那一篇所在的目录里',
  )
  assert.equal(window.document.querySelector('.dshgn_error'), null, '建好之后那句「找不到」该收掉')

  // 回到引用方那一篇：那条双链现在指得到了
  const back = window.document.querySelector('.dshgn_noteBack')
  back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)
  const cardAgain = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_card')).find(
        (el) => el.getAttribute('title') === source.path,
      ) || null,
    8000,
    '回到列表',
  )
  cardAgain.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '再打开引用方')
  const link = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_md .dshgn_wikilink')).find(
        (el) => (el.textContent || '').trim() === name,
      ) || null,
    6000,
    '那条双链',
  )
  assert.equal(
    String(link.className).includes('dshgn_wikilinkDead'),
    false,
    '补上之后不该再暗着',
  )

  window.document.querySelector('.dshgn_noteBack').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 8000, '退回列表')
})

test('刚建好还空着的目录也摆在左栏里、计数 0，点它能筛出空列表，右键还能删掉', async () => {
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
  // 先造一篇别的笔记，保证库里有东西、左栏确实在渲染目录树
  await post('/getnote/create', {
    dir: '空目录验收',
    title: '空目录验收-先有一篇',
    content: ['# 空目录验收', '', '先放一篇在这儿。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-empty-dir-note',
  })
  const madeDir = await post('/getnote/dir/create', { dir: '空目录验收/还空着的那一支' })
  assert.equal(madeDir.ok, true, '造空目录失败：' + JSON.stringify(madeDir))

  // 退回空态、清搜索、退回全量
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setValue.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(300)
  }
  const rowOf = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })
  const allRow = rowOf('全部笔记')
  if (allRow !== undefined) {
    allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowOf('还空着的那一支') !== undefined, 8000, '左栏里出现那个空目录')

  // 空目录也在树上，计数写着 0
  const emptyRow = rowOf('还空着的那一支')
  const countEl = emptyRow.querySelector('.dshgn_treeCount')
  assert.ok(countEl !== null, '空目录也该显示计数')
  assert.equal((countEl.textContent || '').trim(), '0', '空目录的计数该是 0')
  // 父目录还在、还能折
  assert.ok(rowOf('空目录验收') !== undefined, '空目录的父目录也该在')

  // 点它能筛出空列表，而不是弹一句「没有笔记」就没了
  emptyRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)
  assert.equal(rowOf('还空着的那一支').getAttribute('data-on'), 'true', '点空目录也该选中它')
  const cardsAfter = Array.from(window.document.querySelectorAll('.dshgn_card'))
  assert.equal(cardsAfter.length, 0, '空目录里不该有卡片')
  assert.ok(window.document.querySelector('.dshgn_empty') !== null, '空目录要摆出「这里还没有笔记」那一屏')

  // 右键能删掉（空目录才删得掉）
  emptyRow.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await sleep(220)
  const menu = window.document.querySelector('.dshgn_rowMenu')
  assert.ok(menu !== null, '右键该弹出菜单')
  const delBtn = menu.querySelector('.dshgn_rowBtnDanger')
  assert.ok(delBtn !== null, '空目录右键菜单里该有「删除」')
  delBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(250)
  // 删除前先弹一次确认：空目录才删得掉，非空的会被后端挡下来
  const okBtn = window.document.querySelector('.dshgn_modal .dshgn_btnDanger')
  assert.ok(okBtn !== null, '删除前该弹一次确认')
  okBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowOf('还空着的那一支') === undefined, 8000, '删掉之后这一行该消失')
})

test('左栏标签也能收起来：点箭头把这一支折下去，再点展开，没有子标签的行不摆箭头', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const seed = async (title, tags, requestId) => {
    const content = ['---', 'tags: [' + tags.join(', ') + ']', '---', '', '# ' + title, '', '正文', ''].join('\n')
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '随手记', title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    return json.path
  }

  // 上一个用例可能把某篇开着：先退回空态，标签云才在左栏里
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = window.document.querySelector('.dshgn_noteBack')
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(120)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  await clickTab('笔记')
  await waitFor(() => rootNode().querySelector('.dshgn_search') !== null, 4000, '搜索框')
  const searchBox = rootNode().querySelector('.dshgn_search')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(searchBox, '')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(400)

  await seed('标签折叠甲', ['折叠标签/子一'], 'seed-tag-fold-a')
  await seed('标签折叠乙', ['折叠标签/子二'], 'seed-tag-fold-b')
  await seed('标签折叠丙', ['折叠标签另一个'], 'seed-tag-fold-c')

  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const tagRows = () => Array.from(window.document.querySelectorAll('.dshgn_tagRow'))
  const rowOf = (title) => tagRows().find((el) => el.title === title) || null
  const wrapOf = (title) => {
    const row = rowOf(title)
    return row === null ? null : row.closest('.dshgn_tagWrap')
  }
  const caretOf = (title) => {
    const wrap = wrapOf(title)
    return wrap === null ? null : wrap.querySelector('.dshgn_tagFold')
  }

  await waitFor(() => rowOf('折叠标签') !== null, 8000, '父标签要有一行')
  assert.ok(rowOf('折叠标签/子一') !== null, '子标签一开始是展开的')
  assert.ok(rowOf('折叠标签/子二') !== null, '第二条子标签也在')
  assert.ok(rowOf('折叠标签另一个') !== null, '另一支标签也在')

  // 叶子标签不摆箭头：一颗按了永远停在原地的按钮比没有更糟
  assert.equal(caretOf('折叠标签/子一'), null, '没有子标签的那一行不摆箭头')
  assert.equal(caretOf('折叠标签另一个'), null, '另一支叶子也不摆箭头')
  const caret = caretOf('折叠标签')
  assert.ok(caret !== null, '有子标签的那一行要摆箭头')
  assert.equal(caret.getAttribute('data-folded'), 'false', '一开始是展开的')
  assert.equal(caret.title, '收起子标签', '悬停说清点它会怎样')
  assert.equal(caret.getAttribute('aria-expanded'), 'true', '无障碍属性跟着走')

  // 收起来：这一行还在，子标签全藏起来，别的支不受影响
  caret.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowOf('折叠标签/子一') === null, 5000, '子标签该被收起来')
  assert.ok(rowOf('折叠标签') !== null, '父标签自己还在')
  assert.equal(rowOf('折叠标签/子二'), null, '同一条分支上的另一颗子标签也藏起来')
  assert.ok(rowOf('折叠标签另一个') !== null, '别的支不该跟着收')
  assert.equal(caretOf('折叠标签').getAttribute('data-folded'), 'true', '箭头记着已经收起来了')
  assert.equal(caretOf('折叠标签').title, '展开子标签', '收起之后悬停该说点它展开')
  assert.equal(caretOf('折叠标签').getAttribute('aria-expanded'), 'false', '无障碍属性跟着走')
  assert.equal(rowOf('折叠标签').getAttribute('data-on'), 'false', '点箭头不等于按这个标签筛选')

  // 再点一下展开，子标签回来
  caretOf('折叠标签').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowOf('折叠标签/子一') !== null, 5000, '再点该展开')
  assert.ok(rowOf('折叠标签/子二') !== null, '两条子标签都回来')
  assert.equal(caretOf('折叠标签').getAttribute('data-folded'), 'false', '箭头回到展开状态')

  // 只折这一支：另一支不受影响，父标签自己也不受影响
  caretOf('折叠标签').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowOf('折叠标签/子一') === null, 5000, '再收一次')
  assert.ok(rowOf('折叠标签另一个') !== null, '另一支照旧展开')
  caretOf('折叠标签').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowOf('折叠标签/子一') !== null, 5000, '收尾前展开回来')
})
test('待办按篇分组：一篇一组写着还剩几条，一颗按钮把这一篇的一起勾掉', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backToList = async () => {
    const back = rootNode().querySelector('.dshgn_noteBack')
    if (back !== null) {
      panel.setConfirmDialog(() => Promise.resolve(true))
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false')
  }
  await backToList()
  const search = rootNode().querySelector('.dshgn_search')
  if (search !== null) {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, '')
    search.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  const make = async (title, content, requestId) => {
    const res = await realFetch(`${server.origin}/getnote/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '随手记', title, content, withDatePrefix: false, requestId }),
    })
    return (await res.json()).path
  }
  await make('分组验收甲', ['# 分组验收甲', '', '- [ ] 甲的第一条', '- [ ] 甲的第二条', ''].join('\n'), 'seed-todo-group-a')
  await make('分组验收乙', ['# 分组验收乙', '', '- [ ] 乙的那一条', ''].join('\n'), 'seed-todo-group-b')

  await clickTab('待办')
  const groupOf = (name) => {
    const heads = Array.from(rootNode().querySelectorAll('.dshgn_todoGroup'))
    return heads.find((el) => String(el.textContent || '').includes(name)) || null
  }
  const rowOf = (text) => {
    const rows = Array.from(rootNode().querySelectorAll('.dshgn_todoRow'))
    return rows.find((el) => String(el.textContent || '').includes(text)) || null
  }
  const headA = await waitFor(() => groupOf('分组验收甲'), 8000, '甲那一组该有个组头')
  assert.ok(groupOf('分组验收乙') !== null, '乙也该有自己的一组')
  assert.ok(String(headA.textContent || '').includes('2'), '组头要报这一篇还剩几条：' + headA.textContent)
  // 行里不再重复篇名，只报第几行
  const rowA = rowOf('甲的第一条')
  assert.ok(rowA !== null, '甲的第一条该在单子上')
  assert.ok(!String(rowA.textContent || '').includes('分组验收甲'), '行里不重复篇名：' + rowA.textContent)
  assert.ok(/第 \d+ 行/.test(String(rowA.textContent || '')), '行里报第几行：' + rowA.textContent)

  const allBtn = headA.querySelector('.dshgn_todoGroupAll')
  assert.ok(allBtn !== null, '组头右边该有一颗一起勾掉的按钮')
  assert.ok(String(allBtn.getAttribute('title') || '').includes('2'), '按钮上说清要勾几条')
  // 提示条只活 2400ms，而后面那两步（等整组消失、再读一遍磁盘）可能更久。
  // 所以从点下去那一刻就开始盯，而不是等做完别的事再去找——不然它早散了，
  // 断言会莫名其妙地超时（CI 上就挂过这一条）。
  // 屏幕上可能还挂着上一条用例留下的提示条（它要 2400ms 才散），先记下它写的是什么，
  // 只认点下去之后换过内容的那一条——不然抓到的会是别人那句「目录已删除」。
  const staleToast = window.document.querySelector('.dshgn_toast')
  const staleText = staleToast === null ? '' : String(staleToast.textContent || '')
  const toastSeen = (async () => {
    for (let i = 0; i < 200; i += 1) {
      const node = window.document.querySelector('.dshgn_toast')
      const text = node === null ? '' : String(node.textContent || '')
      if (text !== '' && text !== staleText) return text
      await sleep(50)
    }
    return ''
  })()
  allBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => groupOf('分组验收甲') === null, 8000, '这一篇的待办都勾掉之后整组该消失')
  assert.ok(rowOf('乙的那一条') !== null, '别的篇不受影响')

  // 真的写进笔记了，不是只在界面上拿掉
  const readBack = await realFetch(`${server.origin}/getnote/read?path=` + encodeURIComponent('随手记/分组验收甲.md'), {
    headers: { 'x-getnote-token': server.token },
  })
  const note = await readBack.json()
  assert.ok(note.content.includes('- [x] 甲的第一条'), '甲的第一条要真的被勾上：' + note.content)
  assert.ok(note.content.includes('- [x] 甲的第二条'), '甲的第二条也要真的被勾上：' + note.content)
  assert.ok(!note.content.includes('- [ ] 甲的第一条'), '不该还留着没勾的那份')

  const toastText = await toastSeen
  assert.ok(toastText.includes('2'), '勾完说一句勾了几条：' + toastText)
  await backToList()
})

test('断链页按「指不到的那个名字」分组，一处名字一行头，右边一颗「写一篇」当场把它补出来', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backToList = async () => {
    const back = rootNode().querySelector('.dshgn_noteBack')
    if (back !== null) {
      panel.setConfirmDialog(() => Promise.resolve(true))
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false')
  }
  await backToList()
  const search = rootNode().querySelector('.dshgn_search')
  if (search !== null) {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, '')
    search.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  const target = '分组断链-还没写的那一篇'
  const make = async (title, content, requestId) => {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '随手记', title, content, withDatePrefix: false, requestId }),
    })
    assert.equal(res.ok, true, '造笔记失败：' + res.status)
  }
  // 同一个名字在库里被两个地方各写了一次：清单上就是两条一模一样的红字。
  await make('断链分组甲', ['# 断链分组甲', '', '坏的 [[' + target + ']]。', ''].join('\n'), 'seed-broken-group-a')
  await make('断链分组乙', ['# 断链分组乙', '', '这边也写了 [[' + target + ']]。', ''].join('\n'), 'seed-broken-group-b')

  await clickTab('断链')
  const groupOf = () =>
    Array.from(rootNode().querySelectorAll('.dshgn_brokenGroup')).find((el) => {
      const name = el.querySelector('.dshgn_brokenGroupName')
      return name !== null && String(name.textContent || '') === target
    }) || null
  const rowsOf = () =>
    Array.from(rootNode().querySelectorAll('.dshgn_brokenLine')).filter((line) => {
      const name = line.querySelector('.dshgn_brokenTarget')
      return name !== null && String(name.textContent || '') === target
    })
  const head = await waitFor(groupOf, 8000, '断链页里该有这个名字的一组')
  const count = head.querySelector('.dshgn_brokenGroupCount')
  assert.ok(count !== null, '组头要报这个名字被写错了几处')
  assert.ok(String(count.textContent || '').includes('2'), '组头该写着 2 处：' + count.textContent)
  assert.equal(rowsOf().length, 2, '两处都还在这一组里')

  // 组头现在有两颗按钮（「写一篇」和「改指到已有的那篇」），按悬停文案认那一颗，不按位置。
  const writeBtn =
    Array.from(head.querySelectorAll('.dshgn_brokenGroupAll')).find((el) =>
      String(el.getAttribute('title') || '').includes('空笔记')
    ) || null
  assert.ok(writeBtn !== null, '组头右边该有一颗「写一篇」')
  assert.equal(String(writeBtn.getAttribute('title') || '').includes('空笔记'), true, '悬停说清会建出什么')
  writeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '建完该当场打开那一篇')
  const opened = rootNode().querySelector('.dshgn_notePath')
  assert.ok(String(opened.textContent || '').includes(target), '打开的就是刚补出来的那一篇：' + opened.textContent)

  // 那一篇存在之后，两处双链都指得到了，这一组该从清单上消失
  const left = await realFetch(server.origin + '/getnote/broken', { headers: { 'x-getnote-token': server.token } })
  const json = await left.json()
  assert.equal(json.hits.filter((hit) => hit.target === target).length, 0, '补出来之后不该还挂着断链')
  await backToList()
})

test('目录行右键「在这里新建笔记」直接建在这个目录里并当场打开，不用先建完再挪', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backToList = async () => {
    const back = rootNode().querySelector('.dshgn_noteBack')
    if (back !== null) {
      panel.setConfirmDialog(() => Promise.resolve(true))
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false')
  }
  await backToList()
  await clickTab('笔记')
  await waitFor(() => rootNode().querySelector('.dshgn_search') !== null, 4000, '搜索框')
  const search = rootNode().querySelector('.dshgn_search')
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, '')
  search.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(400)

  const dirName = '右键新建验收'
  const seed = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({ dir: dirName, title: '右键新建-先有一篇', content: '# 右键新建-先有一篇\n\n正文。\n', withDatePrefix: false, requestId: 'seed-menu-new-a' }),
  })
  assert.equal(seed.ok, true, '造目录里那一篇失败：' + seed.status)

  const refreshBtn = () => Array.from(rootNode().querySelectorAll('.dshgn_iconBtn')).find((el) => el.getAttribute('title') === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const rowOf = () => Array.from(rootNode().querySelectorAll('.dshgn_treeRow')).find((el) => {
    const name = el.querySelector('.dshgn_treeName')
    return name !== null && String(name.textContent || '') === dirName
  }) || null
  const row = await waitFor(rowOf, 8000, '左栏该出现这个目录')
  row.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }))
  const menu = await waitFor(() => rootNode().querySelector('.dshgn_rowMenu'), 4000, '右键菜单')
  const newBtn = Array.from(menu.querySelectorAll('.dshgn_rowBtn')).find((el) => String(el.getAttribute('title') || '') === '在这里新建笔记')
  assert.ok(newBtn !== undefined, '目录的右键菜单里该有「在这里新建笔记」')

  const before = await (await realFetch(server.origin + '/getnote/tree', { headers: { 'x-getnote-token': server.token } })).json()
  const beforeCount = (before.entries || []).length

  newBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '建完该当场打开那一篇')
  const pathEl = rootNode().querySelector('.dshgn_notePath')
  const openedPath = String(pathEl.textContent || '')
  assert.equal(openedPath.startsWith(dirName + '/'), true, '新笔记该落在这个目录里：' + openedPath)
  assert.equal(openedPath.endsWith('.md'), true, '打开的该是一篇笔记：' + openedPath)

  const after = await (await realFetch(server.origin + '/getnote/tree', { headers: { 'x-getnote-token': server.token } })).json()
  assert.equal((after.entries || []).length, beforeCount + 1, '库里该多出这一篇')
  const written = await realFetch(server.origin + '/getnote/read?path=' + encodeURIComponent(openedPath), { headers: { 'x-getnote-token': server.token } })
  assert.equal(written.status, 200, '刚建的那一篇该读得回来')
  await backToList()
})

test('列表底下的「全部显示」一次把剩下的都摊出来，不用一屏一屏点下去', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backToList = async () => {
    const back = rootNode().querySelector('.dshgn_noteBack')
    if (back !== null) {
      panel.setConfirmDialog(() => Promise.resolve(true))
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false')
  }
  await backToList()
  await clickTab('笔记')
  await waitFor(() => rootNode().querySelector('.dshgn_search') !== null, 4000, '搜索框')
  const search = rootNode().querySelector('.dshgn_search')
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, '')
  search.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(400)

  // 一屏只渲染 60 条：造 61 篇，正好剩一篇要「显示更多」才看得见。
  const dirName = '显示全部验收'
  const total = 61
  for (let i = 1; i <= total; i += 1) {
    const num = String(i).padStart(2, '0')
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({
        dir: dirName,
        title: '显示全部验收-' + num,
        content: '# 显示全部验收-' + num + '\n\n第 ' + num + ' 篇。\n',
        withDatePrefix: false,
        requestId: 'seed-show-all-' + num,
      }),
    })
    assert.equal(res.ok, true, '造第 ' + num + ' 篇失败：' + res.status)
  }

  const refreshBtn = () => Array.from(rootNode().querySelectorAll('.dshgn_iconBtn')).find((el) => el.getAttribute('title') === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const rowOf = () => Array.from(rootNode().querySelectorAll('.dshgn_treeRow')).find((el) => {
    const name = el.querySelector('.dshgn_treeName')
    return name !== null && String(name.textContent || '') === dirName
  }) || null
  const row = await waitFor(rowOf, 10000, '左栏该出现这个目录')
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

  const cards = () => Array.from(rootNode().querySelectorAll('.dshgn_card'))
  await waitFor(() => cards().length === 60, 8000, '一屏该先渲染 60 张卡片')
  const moreRow = await waitFor(() => rootNode().querySelector('.dshgn_moreRow'), 4000, '底下该有那颗「显示更多」')
  const moreBtns = Array.from(moreRow.querySelectorAll('.dshgn_btn'))
  assert.equal(moreBtns.length, 2, '「显示更多」旁边该还有一颗「全部显示」：' + moreBtns.map((el) => el.textContent).join(' / '))
  assert.ok(String(moreBtns[0].textContent || '').includes('1'), '「显示更多」该报还剩 1 篇：' + moreBtns[0].textContent)
  assert.equal(String(moreBtns[1].textContent || ''), '全部显示', '第二颗是「全部显示」')

  moreBtns[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => cards().length === total, 8000, '点了「全部显示」该把 61 张卡片一次摊出来')
  assert.equal(rootNode().querySelector('.dshgn_moreRow'), null, '全摊开之后底下那颗就不该还在')
  await backToList()
})

test('左栏目录和标签各自有一颗「全部收起」，一次收干净再一次摊开', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const seed = async (title, dir, tags, requestId) => {
    const head = tags.length > 0 ? ['---', 'tags: [' + tags.join(', ') + ']', '---', ''] : []
    const content = head.concat(['# ' + title, '', '正文', '']).join('\n')
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir, title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    return json.path
  }

  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = window.document.querySelector('.dshgn_noteBack')
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(120)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }
  await clickTab('笔记')
  await waitFor(() => rootNode().querySelector('.dshgn_search') !== null, 4000, '搜索框')
  const searchBox = rootNode().querySelector('.dshgn_search')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(searchBox, '')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(400)

  // 两支带子目录的目录、两支带子标签的标签：两区都各自有「还能收的行」
  await seed('全收验收-甲', '全收验收/全收甲子', [], 'seed-fold-all-a')
  await seed('全收验收-乙', '全收验收/全收乙子', [], 'seed-fold-all-b')
  await seed('全收验收-标签一', '随手记', ['全收标签/子一'], 'seed-fold-all-c')
  await seed('全收验收-标签二', '随手记', ['全收标签/子二'], 'seed-fold-all-d')

  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  // 每区标题行右侧的动作组：目录区是第 0 个，标签区是第 1 个
  const heads = () => Array.from(window.document.querySelectorAll('.dshgn_treeHeadRight'))
  const foldAllOf = (index) => {
    const head = heads()[index]
    return head === undefined ? null : head.querySelector('.dshgn_treeFoldAll')
  }
  const dirRow = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && label.textContent === name
    }) || null
  const tagRow = (title) =>
    Array.from(window.document.querySelectorAll('.dshgn_tagRow')).find((el) => el.title === title) || null

  await waitFor(() => dirRow('全收甲子') !== null, 8000, '子目录一开始是展开的')
  assert.ok(dirRow('全收乙子') !== null, '另一支子目录也展开着')
  assert.ok(tagRow('全收标签/子一') !== null, '子标签一开始也展开着')

  const dirFoldAll = foldAllOf(0)
  const tagFoldAll = foldAllOf(1)
  assert.ok(dirFoldAll !== null, '目录区要有一颗「全部收起」')
  assert.ok(tagFoldAll !== null, '标签区也要有一颗')
  assert.equal(dirFoldAll.title, '全部收起', '悬停说清点它会怎样')
  assert.equal(dirFoldAll.getAttribute('aria-pressed'), 'false', '一开始是展开态')

  // 目录区全收：所有子目录一次收掉，标签区不受影响
  dirFoldAll.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => dirRow('全收甲子') === null, 5000, '目录该一次全收起来')
  assert.equal(dirRow('全收乙子'), null, '同一支以外的子目录也一起收掉')
  assert.ok(dirRow('全收验收') !== null, '顶层目录自己还在')
  assert.ok(tagRow('全收标签/子一') !== null, '标签区不该被目录那颗按钮带着收')
  assert.equal(foldAllOf(0).title, '全部展开', '全收之后这颗按钮改成「全部展开」')
  assert.equal(foldAllOf(0).getAttribute('aria-pressed'), 'true', '无障碍属性跟着走')

  // 标签区全收
  foldAllOf(1).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => tagRow('全收标签/子一') === null, 5000, '标签该一次全收起来')
  assert.equal(tagRow('全收标签/子二'), null, '另一颗子标签也一起收掉')
  assert.ok(tagRow('全收标签') !== null, '父标签自己还在')
  assert.equal(foldAllOf(1).title, '全部展开', '标签区那颗也改成「全部展开」')

  // 再点一次全摊开：两区都回到展开
  foldAllOf(0).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => dirRow('全收甲子') !== null, 5000, '再点该一次全展开')
  assert.ok(dirRow('全收乙子') !== null, '另一支也回来了')
  assert.equal(foldAllOf(0).title, '全部收起', '按钮回到「全部收起」')
  foldAllOf(1).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => tagRow('全收标签/子一') !== null, 5000, '标签区再点也全展开')
  assert.equal(foldAllOf(1).title, '全部收起', '标签区按钮也回到「全部收起」')
})

test('列表顶上那颗「全部勾上」一次把这次筛出来的都选上，再按一下全不勾', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')
  const post = async (path, payload) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(payload),
    })
    return res.json()
  }

  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }

  const tabBtn = Array.from(window.document.querySelectorAll('.dshgn_tab')).find(
    (el) => (el.textContent || '').trim() === '笔记',
  )
  assert.ok(tabBtn, '找不到「笔记」标签按钮')
  tabBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_search') !== null, 4000, '搜索框')

  const searchBox = window.document.querySelector('.dshgn_search')
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setValue.call(searchBox, '')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(300)

  const rowOf = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')

  for (const suffix of ['甲', '乙', '丙']) {
    const created = await post('/getnote/create', {
      dir: '勾选验收',
      title: '勾选验收-' + suffix,
      content: '# 勾选验收-' + suffix + '\n\n正文。\n',
      withDatePrefix: false,
      requestId: 'seed-pick-all-' + suffix,
    })
    assert.equal(created.ok, true, '这一篇该建得出来')
  }

  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowOf('勾选验收') !== undefined, 8000, '左栏出现目录')
  rowOf('勾选验收').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelectorAll('.dshgn_card').length === 3, 8000, '三张卡片')

  const pickAllBtn = () => window.document.querySelector('.dshgn_pickAll')
  assert.ok(pickAllBtn(), '列表顶上该有一颗「全部勾上」')
  assert.equal(pickAllBtn().getAttribute('data-on'), 'false', '还没勾的时候不该亮着')
  assert.equal(pickAllBtn().title, '全部勾上', '还没勾的时候该叫「全部勾上」')

  const batchBar = () => window.document.querySelector('.dshgn_batchBar')
  const countText = () => (window.document.querySelector('.dshgn_batchCount') || { textContent: '' }).textContent

  pickAllBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => batchBar() !== null, 3000, '批量栏出现')
  assert.ok(String(countText()).includes('3'), '一次该把三篇都勾上，实际 ' + countText())
  assert.equal(pickAllBtn().getAttribute('data-on'), 'true', '全勾上之后按钮该亮着')
  assert.equal(pickAllBtn().title, '取消勾选', '全勾上之后该叫「取消勾选」')

  pickAllBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => batchBar() === null, 3000, '再按一下该全不勾')
  assert.equal(pickAllBtn().getAttribute('data-on'), 'false', '全不勾之后按钮该灭掉')

  // 收尾：退回列表，别把筛选留在下一条用例头上
  rowOf('全部笔记').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(250)
})

test('头部里那个值是双链时点得开，不用自己去左栏翻', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')
  const seed = async (dir, title, content, requestId) => {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir, title, content, withDatePrefix: false, requestId }),
    })
    return (await res.json()).path
  }

  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }

  const tabBtn = Array.from(window.document.querySelectorAll('.dshgn_tab')).find(
    (el) => (el.textContent || '').trim() === '笔记',
  )
  assert.ok(tabBtn, '找不到「笔记」标签按钮')
  tabBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_search') !== null, 4000, '搜索框')

  const searchBox = window.document.querySelector('.dshgn_search')
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setValue.call(searchBox, '')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(300)

  // 被指向的那一篇
  const target = await seed('头部链接验收', '头部链接-被指向的那一篇', '# 头部链接-被指向的那一篇\n\n这边是被指的那一篇。\n', 'seed-prop-link-target')
  // 头部里挂着一条双链，正文里一次都没提它——只能从属性区点过去
  const source = await seed(
    '头部链接验收',
    '头部链接-引用方',
    ['---', '相关: "[[头部链接-被指向的那一篇]]"', '---', '', '# 头部链接-引用方', '', '正文里一次都没提它。', ''].join('\n'),
    'seed-prop-link-source',
  )

  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const cardOf = (path) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === path)
  const card = await waitFor(() => cardOf(source), 8000, '引用方那一篇出现在列表里')
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => ((window.document.querySelector('.dshgn_note') || {}).textContent || '').includes('正文里一次都没提它'),
    8000,
    '引用方那一篇打开了',
  )

  const props = await waitFor(() => window.document.querySelector('.dshgn_props'), 5000, '属性区出现')
  const linkBtn = props.querySelector('.dshgn_propLink')
  assert.ok(linkBtn, '头部里那条双链该做成能点的')
  assert.equal((linkBtn.textContent || '').trim(), '头部链接-被指向的那一篇', '按钮上显示的就是被指的那一篇')
  assert.equal(linkBtn.title, '头部链接-被指向的那一篇', '悬停说清点了会去哪一篇')
  // 同一条双链不该被当成普通文字原样摊出来
  assert.ok(!(props.textContent || '').includes('[['), '双链不该原样露出方括号')

  linkBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => ((window.document.querySelector('.dshgn_note') || {}).textContent || '').includes('这边是被指的那一篇'),
    8000,
    '点一下就打开了被指的那一篇',
  )

  // 收尾：退回列表
  const back = backBtn()
  if (back) {
    panel.setConfirmDialog(async () => true)
    try {
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(250)
    } finally {
      panel.setConfirmDialog(null)
    }
  }
})

test('骨架屏上永远压着一行看得见的字，等太久就直说没连上并给一颗重试', async () => {
  const { SkeletonPane } = panel.__internals
  // SkeletonPane 只认这几个键，直接用一张小表，不牵扯整套 LEX。
  const words = {
    'panel.loading': '正在读取笔记库…',
    'panel.loadingSlow': '本地服务好像没连上',
    'panel.loadingSlowHint': '面板已经打开了，只是还没取到笔记库。',
    'action.retry': '重试',
  }
  const t = (key) => words[key] ?? key
  const mount = window.document.createElement('div')
  window.document.body.appendChild(mount)
  const popRoot = createRoot(mount)
  try {
    popRoot.render(React.createElement(SkeletonPane, { t, slow: false }))
    await waitFor(() => mount.querySelector('.dshgn_skTop') !== null, 4000, '骨架顶上那行字')
    const top = mount.querySelector('.dshgn_skTop')
    assert.ok((top.textContent || '').includes('正在读取笔记库'), '还在加载时那行字要说清在等什么：' + top.textContent)
    assert.ok(top.querySelector('.dshgn_spin') !== null, '正常加载时给一个转圈')
    assert.equal(mount.querySelector('.dshgn_skSlow'), null, '还在正常加载时不该先摆出「没连上」')

    let retried = 0
    popRoot.render(
      React.createElement(SkeletonPane, {
        t,
        slow: true,
        onRetry: () => {
          retried += 1
        },
      }),
    )
    await waitFor(() => mount.querySelector('.dshgn_skSlow') !== null, 4000, '等太久之后的提示')
    assert.ok(
      (mount.querySelector('.dshgn_skTop').textContent || '').includes('没连上'),
      '等太久时那行字要改成没连上',
    )
    const slow = mount.querySelector('.dshgn_skSlow')
    assert.ok((slow.textContent || '').includes('还没取到笔记库'), '要说清面板是开着的、只是数据没回来')
    const retry = Array.from(slow.querySelectorAll('.dshgn_btn')).find(
      (one) => (one.textContent || '').trim() === '重试',
    )
    assert.ok(retry !== undefined, '得有一颗能按的重试')
    retry.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(60)
    assert.equal(retried, 1, '按了重试要真的去重新拉一次')
  } finally {
    popRoot.unmount()
    mount.remove()
  }
})
test('卡片拖到左栏的标签胶囊上就给这一篇贴上那个标签', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')
  const post = async (path, payload) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(payload),
    })
    return res.json()
  }

  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }

  const tabBtn = Array.from(window.document.querySelectorAll('.dshgn_tab')).find(
    (el) => (el.textContent || '').trim() === '笔记',
  )
  assert.ok(tabBtn, '找不到「笔记」标签按钮')
  tabBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_search') !== null, 4000, '搜索框')

  const searchBox = window.document.querySelector('.dshgn_search')
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setValue.call(searchBox, '')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(300)

  // 一篇带着标签（左栏里才会有那颗胶囊），另一篇空着等被贴
  // 标签不是 /create 的参数，得写进头部：左栏的标签云只认 frontmatter 里那一条。
  await post('/getnote/create', {
    dir: '随手记',
    title: '拖动贴标签-已有',
    content: ['---', 'tags: [拖动贴标签/甲]', '---', '', '# 拖动贴标签-已有', '', '正文。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-drag-tag-a',
  })
  const target = '拖动贴标签验收/拖动贴标签-要贴.md'
  await post('/getnote/create', {
    dir: '拖动贴标签验收',
    title: '拖动贴标签-要贴',
    content: '# 拖动贴标签-要贴\n\n正文。\n',
    withDatePrefix: false,
    requestId: 'seed-drag-tag-b',
  })

  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(500)

  const allRow = Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
    const label = el.querySelector('.dshgn_treeName')
    return label !== null && (label.textContent || '').trim() === '全部笔记'
  })
  if (allRow !== undefined) {
    allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }

  const tagRow = (title) =>
    Array.from(window.document.querySelectorAll('.dshgn_tagRow')).find((el) => el.title === title) || null
  await waitFor(() => tagRow('拖动贴标签/甲') !== null, 8000, '左栏里出现那颗标签')

  const card = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_card')).find(
        (el) => el.getAttribute('title') === target,
      ) || null,
    8000,
    '列表里的那一篇',
  )
  assert.ok(card !== null, '这一篇得在列表里才拖得动')

  const makeTransfer = (withPanelPath) => ({
    types: withPanelPath ? ['text/plain', 'application/x-getnote-path'] : ['text/plain'],
    dropEffect: '',
    effectAllowed: '',
    setData: () => {},
    getData: (kind) => (withPanelPath && kind === 'application/x-getnote-path' ? target : ''),
  })
  const fire = (kind, transfer, el) => {
    const event = new window.Event(kind, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: transfer, configurable: true })
    el.dispatchEvent(event)
    return event
  }

  // 别人的拖动（宿主文件树）只有 text/plain：胶囊不该亮、也不该接
  const foreign = makeTransfer(false)
  fire('dragover', foreign, tagRow('拖动贴标签/甲'))
  await sleep(80)
  assert.notEqual(tagRow('拖动贴标签/甲').getAttribute('data-drop'), 'true', '不该为别人的拖动亮起来')

  const transfer = makeTransfer(true)
  const over = fire('dragover', transfer, tagRow('拖动贴标签/甲'))
  assert.equal(over.defaultPrevented, true, '面板自己的拖动要认下来')
  await waitFor(
    () => tagRow('拖动贴标签/甲').getAttribute('data-drop') === 'true',
    5000,
    '胶囊亮起来',
  )

  const dropped = fire('drop', transfer, tagRow('拖动贴标签/甲'))
  assert.equal(dropped.defaultPrevented, true, '放下之后不该再交给浏览器')
  await waitFor(
    () => (window.document.querySelector('.dshgn_toast') || { textContent: '' }).textContent.includes('已加上标签 #拖动贴标签/甲'),
    8000,
    '说一声贴上了哪个标签',
  )
  await waitFor(
    () => tagRow('拖动贴标签/甲').getAttribute('data-drop') === 'false',
    5000,
    '放下之后高亮要收掉',
  )

  // 标签真的写进头部了：读回来得有 frontmatter 里那一条
  const res = await realFetch(server.origin + '/getnote/read?path=' + encodeURIComponent(target), {
    headers: { 'x-getnote-token': server.token },
  })
  assert.equal(res.status, 200, '这一篇还读得到（贴标签不该动文件位置）')
  const note = await res.json()
  assert.ok((note.content || '').includes('拖动贴标签/甲'), '头部里要真有这个标签：' + String(note.content || '').slice(0, 200))
  assert.ok(String(note.content || '').startsWith('---'), '标签写在 frontmatter 里')

  // 收尾：退回列表，别把状态留给下一条用例
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
  } finally {
    panel.setConfirmDialog(null)
  }
})
test('空列表那一屏不留一句「没有」就走人：搜不到能一键清空搜索词，筛着空目录能一键撤掉筛选', async () => {
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
  await post('/getnote/create', {
    dir: '空态出路验收',
    title: '空态出路-先有一篇',
    content: ['# 空态出路', '', '先放一篇在这儿。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-empty-exit-a',
  })
  const madeDir = await post('/getnote/dir/create', { dir: '空态出路验收/还空着的那一支' })
  assert.equal(madeDir.ok, true, '造空目录失败：' + JSON.stringify(madeDir))

  // 退回空态，免得带着上一篇的阅读态进来
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }

  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(600)

  const searchBox = () => window.document.querySelector('.dshgn_search')
  const type = async (text) => {
    const box = searchBox()
    assert.ok(box !== null, '搜索框该在')
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setValue.call(box, text)
    box.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(800)
  }
  const emptyOf = () => window.document.querySelector('.dshgn_empty')
  const emptyBtn = (label) =>
    Array.from((emptyOf() || window.document).querySelectorAll('.dshgn_emptyActions .dshgn_btn')).find(
      (el) => (el.textContent || '').trim().includes(label),
    )

  // 一、搜不到：以前中栏是一片空白，现在得说清「没有匹配」并给一颗「清空」
  await type('空态出路验收里肯定没有这个词')
  await waitFor(() => emptyOf() !== null, 8000, '搜不到时也要摆出空列表那一屏')
  assert.ok(
    (emptyOf().textContent || '').includes('没有匹配的笔记'),
    '搜不到要说清是没有匹配：' + emptyOf().textContent,
  )
  assert.ok(emptyOf().querySelector('.dshgn_emptyDesc') !== null, '还要给一句换个词试试的建议')
  const clearSearch = emptyBtn('清空')
  assert.ok(clearSearch !== undefined, '搜不到时要给一颗「清空」')
  clearSearch.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(700)
  assert.equal(String(searchBox().value || ''), '', '点了「清空」搜索框该空掉')
  await waitFor(
    () => window.document.querySelectorAll('.dshgn_card').length > 0,
    8000,
    '清掉搜索词之后列表该回来',
  )

  // 二、筛着一个空目录：得有一句解释和一颗「清掉筛选」
  const rowOf = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })
  await waitFor(() => rowOf('还空着的那一支') !== undefined, 8000, '左栏里出现那个空目录')
  rowOf('还空着的那一支').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(500)
  await waitFor(() => emptyOf() !== null, 8000, '空目录要摆出空列表那一屏')
  assert.ok(
    (emptyOf().textContent || '').includes('这个目录还没有笔记'),
    '空目录要说清是这一支还没有笔记：' + emptyOf().textContent,
  )
  const clearFilter = emptyBtn('清掉筛选')
  assert.ok(clearFilter !== undefined, '筛着空目录时要给一颗「清掉筛选」')
  clearFilter.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(600)
  assert.equal(
    window.document.querySelector('.dshgn_filterBar'),
    null,
    '点了「清掉筛选」筛选条该收起来',
  )
  await waitFor(
    () => window.document.querySelectorAll('.dshgn_card').length > 0,
    8000,
    '撤掉筛选之后列表该回来',
  )
  // 注意：右栏「选一篇笔记开始阅读」也用 .dshgn_empty，这里只看列表那一屏的按钮行
  assert.equal(
    window.document.querySelector('.dshgn_emptyActions'),
    null,
    '有卡片了就不该还摆着空列表那一屏',
  )
})
test('回收站里恢复一篇时能先指定放回哪个目录，敲一半有候选，留空还是老样子放库根', async () => {
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
  const notePath = '回收站验收/回收站-要恢复的一篇.md'
  await post('/getnote/create', {
    dir: '回收站验收',
    title: '回收站-要恢复的一篇',
    content: ['# 回收站-要恢复的一篇', '', '删掉之后还得能放回指定的地方。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-trash-target-a',
  })
  const madeDir = await post('/getnote/dir/create', { dir: '回收站验收/恢复到这里' })
  assert.equal(madeDir.ok, true, '造目标目录失败：' + JSON.stringify(madeDir))

  // 退回空态，免得带着上一篇的阅读态进来
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }

  // 先把目录拉进状态里，候选才有得挑
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(600)

  const deleted = await post('/getnote/delete', { path: notePath })
  assert.equal(deleted.ok, true, '删进回收站失败：' + JSON.stringify(deleted))

  await clickTab('回收站')
  const targetInput = () => window.document.querySelector('.dshgn_trashTarget input.dshgn_input')
  await waitFor(() => targetInput() !== null, 8000, '回收站里该摆出「恢复到哪个目录」那个框')
  assert.equal(
    targetInput().getAttribute('placeholder'),
    '恢复到哪个目录（留空就放库根）',
    '框上要写清楚留空是什么意思',
  )

  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const type = async (text) => {
    const box = targetInput()
    setValue.call(box, text)
    box.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }
  const suggestOf = () =>
    Array.from(window.document.querySelectorAll('.dshgn_trashTarget .dshgn_suggestItem'))
  await type('恢复到这里')
  await waitFor(() => suggestOf().length > 0, 5000, '敲一半要摆出目录候选')
  const wanted = suggestOf().find((el) => (el.textContent || '').includes('回收站验收/恢复到这里'))
  assert.ok(wanted !== undefined, '候选里要有那个目录：' + suggestOf().map((el) => el.textContent).join(' | '))
  wanted.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  await sleep(300)
  assert.equal(
    String(targetInput().value || ''),
    '回收站验收/恢复到这里',
    '挑了候选之后框里该填成那个目录',
  )

  const restoreBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_pane .dshgn_btn')).find(
      (el) => (el.textContent || '').trim() === '恢复',
    )
  assert.ok(restoreBtn() !== undefined, '每一行该有「恢复」')
  restoreBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => restoreBtn() === undefined, 8000, '恢复之后回收站里就不该还有这一行')

  const readBack = await realFetch(
    server.origin + '/getnote/read?path=' + encodeURIComponent('回收站验收/恢复到这里/回收站-要恢复的一篇.md'),
    { headers: { 'x-getnote-token': server.token } },
  )
  assert.equal(readBack.status, 200, '文件该落在指定的那个目录里')
  const backJson = await readBack.json()
  assert.ok(
    String(backJson.content || '').includes('删掉之后还得能放回指定的地方'),
    '恢复回来的内容要和删之前一样',
  )
  await clickTab('笔记')
})
test('卡片上收起来的「+N」点一下就地摊开全部标签，再点收回去，摊开不等于按它筛', async () => {
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
  const manyTags = ['摊开标签/一', '摊开标签/二', '摊开标签/三', '摊开标签/四', '摊开标签/五', '摊开标签/六']
  const title = '标签摊开-标签很多的这一篇'
  await post('/getnote/create', {
    dir: '标签摊开验收',
    title,
    content: ['---', 'tags: [' + manyTags.join(', ') + ']', '---', '', '# ' + title, '', '这一篇标签多，卡片上摆不下。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-tag-open-a',
  })

  const backBtn = () => window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }

  const search = () => window.document.querySelector('.dshgn_search')
  await waitFor(() => search() !== null, 5000, '搜索框')
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setValue.call(search(), '')
  search().dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(200)
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(700)

  const cardOf = () => {
    const cards = Array.from(window.document.querySelectorAll('.dshgn_card'))
    return cards.find((el) => {
      const node = el.querySelector('.dshgn_cardTitle')
      return node !== null && (node.textContent || '').trim() === title
    })
  }
  await waitFor(() => cardOf() !== undefined, 8000, '列表里出现这一篇')
  const chipsOf = () => Array.from(cardOf().querySelectorAll('.dshgn_cardTag'))
  const moreOf = () => cardOf().querySelector('.dshgn_cardTagMore')
  assert.equal(chipsOf().length, 3, '卡片上默认只摆三颗标签，多的收起来')
  assert.ok(moreOf() !== null, '三颗之外要有「+N」')
  assert.equal((moreOf().textContent || '').trim(), '+3', '六个标签收起来三颗，剩下写 +3')
  assert.equal(moreOf().getAttribute('data-open'), 'false', '一开始是收着的')
  assert.equal(moreOf().getAttribute('aria-expanded'), 'false', '收着时 aria-expanded 要是 false')

  moreOf().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(250)
  assert.equal(chipsOf().length, 6, '点开之后六颗全摊出来')
  assert.equal(moreOf().getAttribute('data-open'), 'true', '摊开之后状态记在 data-open 上')
  assert.equal(moreOf().getAttribute('aria-expanded'), 'true', '摊开时 aria-expanded 要是 true')
  assert.equal((moreOf().textContent || '').trim(), '收起', '摊开之后那颗按钮改成「收起」')
  assert.equal(
    window.document.querySelectorAll('.dshgn_filterChip').length,
    0,
    '摊开标签不该顺手按它筛——它只是一扇窗',
  )
  assert.equal(
    rootNode().getAttribute('data-has-note'),
    'false',
    '摊开标签也不该把这一篇打开',
  )

  moreOf().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(250)
  assert.equal(chipsOf().length, 3, '再点一下收回去，还是三颗')
  assert.equal(moreOf().getAttribute('data-open'), 'false', '收起之后状态也回到 false')

  // 收尾：退回「全部笔记」，别把筛选留给下一条用例
  const allBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find(
      (el) => (el.textContent || '').trim() === '全部笔记',
    )
  if (allBtn() !== undefined) {
    allBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }
})

/**
 * 卡片 meta 行里的目录原来是死文字：看到一篇在「随手记/录音卡」底下，想找同一摊
 * 的其它篇，只能回左栏一层层展开。现在点它直接按这个目录筛，和点标签同一个动作。
 */
test('卡片上那个目录也点得动：点了就按这个目录筛，左栏那一行跟着亮，不把笔记打开', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  const post = async (path, body) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  // 上一个用例可能把某篇开着：先退回空态，卡片才会在列表里
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = window.document.querySelector('.dshgn_noteBack')
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(200)
    }
  } finally {
    panel.setConfirmDialog(null)
  }
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  const madeA = await post('/getnote/create', {
    dir: '卡片目录验收/录音卡',
    title: '卡片目录-这一篇',
    content: ['# 卡片目录', '', '正文', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-card-dir-a',
  })
  const pathA = madeA.path
  await post('/getnote/create', {
    dir: '卡片目录别处',
    title: '卡片目录-另一摊',
    content: ['# 另一摊', '', '正文', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-card-dir-b',
  })
  assert.ok(typeof pathA === 'string' && pathA !== '', '那一篇建好了')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const cardOf = (path) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === path) || null
  const card = await waitFor(() => cardOf(pathA), 8000, '那一篇的卡片')

  const dirBtn = card.querySelector('.dshgn_cardDir')
  assert.ok(dirBtn !== null, '卡片上那颗目录要能点')
  assert.equal((dirBtn.textContent || '').trim(), '卡片目录验收/录音卡', '摆的就是它所在的目录')
  assert.ok(
    String(dirBtn.getAttribute('title') || '').includes('筛这个目录'),
    '悬停要说清点一下会怎样，实际 ' + dirBtn.getAttribute('title'),
  )

  dirBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const cardTitles = () =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).map((el) => el.getAttribute('title'))
  await waitFor(
    () => {
      const list = cardTitles()
      return list.length === 1 && list[0] === pathA
    },
    5000,
    '点目录之后只剩这个目录里的笔记：' + JSON.stringify(cardTitles()),
  )
  assert.equal(rootNode().getAttribute('data-has-note'), 'false', '点目录不该顺带把笔记打开')

  const chip = window.document.querySelector('.dshgn_filterChip[data-kind="dir"]')
  assert.ok(chip !== null, '筛选条上要摆一颗点得掉的目录胶囊')
  assert.equal((chip.querySelector('.dshgn_filterChipName').textContent || '').trim(), '卡片目录验收/录音卡')

  const dirRow = () =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) =>
      String(el.getAttribute('title') || '').startsWith('卡片目录验收/录音卡\n'),
    ) || null
  const onRow = await waitFor(dirRow, 5000, '左栏里那个目录行')
  assert.equal(onRow.getAttribute('data-on'), 'true', '左栏要跟着亮起来，同一个动作')

  // 收尾：把筛选退回去，别影响后面的用例
  const allRow = Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
    const label = el.querySelector('.dshgn_treeName')
    return label !== null && (label.textContent || '').trim() === '全部笔记'
  })
  if (allRow !== undefined) {
    allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }
})

/**
 * 断链页那一整张清单，光在屏幕上看没用：想一次修完，得把「哪几个名字指不到、
 * 各自出现在哪几篇的第几行」摊成一段能搜索的文本。这里验抄出来的样子，
 * 以及一条断链都没有时不摆那颗按了没反应的按钮。
 */
test('断链页能把整张清单抄成一段 Markdown，按名字分组、带篇名行号和原句', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  const post = async (path, body) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  // 上一个用例可能把某篇开着：先退回空态
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = window.document.querySelector('.dshgn_noteBack')
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(200)
    }
  } finally {
    panel.setConfirmDialog(null)
  }
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')

  // 同一个错名字写在两篇里 + 另一个错名字一篇：抄出来应该是两组
  const seedOne = async (dir, title, body, requestId) => {
    const res = await post('/getnote/create', {
      dir,
      title,
      content: ['# ' + title, '', body, ''].join('\n'),
      withDatePrefix: false,
      requestId,
    })
    assert.equal(res.path, dir + '/' + title + '.md', '造笔记失败：' + JSON.stringify(res))
  }
  await seedOne('随手记', '断链抄写验收甲', '坏的 [[抄写验收-没写的那篇]]。', 'seed-broken-copy-a')
  await seedOne('随手记', '断链抄写验收乙', '也是 [[抄写验收-没写的那篇]]。', 'seed-broken-copy-b')
  await seedOne('随手记', '断链抄写验收丙', '另起的 [[抄写验收-另一篇没写的]]。', 'seed-broken-copy-c')

  await clickTab('断链')
  const copyBtn = await waitFor(
    () => Array.from(window.document.querySelectorAll('.dshgn_pane .dshgn_btn')).find((el) =>
      (el.textContent || '').trim() === '复制这份清单',
    ) || null,
    8000,
    '断链页里那颗「复制这份清单」',
  )
  assert.equal(copyBtn.getAttribute('title'), '复制这份清单')

  const written = []
  clipboard.writeText = async (text) => { written.push(String(text)) }
  copyBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => written.length > 0, 5000, '抄到剪贴板')
  const text = written[0]

  const lines = text.split('\n')
  const headA = lines.findIndex((one) => one.trim() === '## [[抄写验收-没写的那篇]]')
  const headB = lines.findIndex((one) => one.trim() === '## [[抄写验收-另一篇没写的]]')
  assert.ok(headA >= 0, '同一个名字要收成一个小标题，实际：' + text)
  assert.ok(headB >= 0, '另一个名字也要有一个小标题，实际：' + text)
  // 组的先后跟后端的路径序走（中文按码位排，不是拼音），这里只验「同一个名字
  // 底下那两处收在同一组里」，不押具体谁先谁后。
  const nextHead = (from) => {
    for (let i = from + 1; i < lines.length; i += 1) {
      if (lines[i].trim().startsWith('## ')) return i
    }
    return lines.length
  }
  const between = lines.slice(headA + 1, nextHead(headA)).filter((one) => one.trim() !== '')
  assert.equal(between.length, 2, '同一个错名字的两处要收在同一组里，实际：' + JSON.stringify(between))
  for (const one of between) assert.ok(one.startsWith('- '), '每条以 - 开头，实际 ' + one)
  const joined = between.join('\n')
  assert.ok(joined.includes('断链抄写验收甲'), '要带出处的篇名，实际 ' + joined)
  assert.ok(joined.includes('断链抄写验收乙'), '两处各自的篇名都要在，实际 ' + joined)
  assert.ok(joined.includes('第 '), '要带行号，实际 ' + joined)
  assert.ok(joined.includes('抄写验收-没写的那篇'), '要带那一句原文，实际 ' + joined)

  // 抄完给一句提示，说清抄了多少处
  const toast = await waitFor(
    () => window.document.querySelector('.dshgn_toast'),
    3000,
    '抄完的提示条',
  )
  assert.ok((toast.textContent || '').includes('断链'), '提示条要说清抄的是什么，实际 ' + toast.textContent)

  await clickTab('笔记')
})

/*
 * 搜索结果卡片上收起来的「+N 处引用」。
 *
 * 一张卡片最多摆四颗引用胶囊，多的收成 +N。以前那个 +N 只是个数字，想看看
 * 这一篇还引用了谁就没辙了。现在点它就地摊开，再点收回去。
 */
test('搜索卡片上收起来的「+N」点一下就地摊开全部引用，再点收回去，摊开不等于跳走', async () => {
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

  const links = ['引用摊开一', '引用摊开二', '引用摊开三', '引用摊开四', '引用摊开五', '引用摊开六']
  const body = links.map((one) => '[[' + one + ']]').join('、')
  const res = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '随手记',
      title: '引用摊开验收',
      content: '# 引用摊开验收\n\n龙眼记到 ' + body + '\n',
      withDatePrefix: false,
      requestId: 'seed-link-open-a',
    }),
  })
  assert.equal(res.status, 200)

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const box = await waitFor(() => window.document.querySelector('.dshgn_search'), 5000, '搜索框')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(box, '龙眼')
  box.dispatchEvent(new window.Event('input', { bubbles: true }))

  // 别的用例也 seed 过带「龙眼」的笔记，这里必须认准这一张卡片，
  // 否则会把别人卡片上的引用胶囊一起数进来。
  const cardOf = () =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => {
      const title = el.querySelector('.dshgn_cardTitle')
      return title !== null && (title.textContent || '').includes('引用摊开验收')
    })
  const card = await waitFor(cardOf, 8000, '搜索卡片上应该出现这一篇')
  const moreOf = () => card.querySelector('.dshgn_cardLinkMore')
  const chipsIn = () => card.querySelectorAll('.dshgn_cardLinkChip').length
  const more = await waitFor(moreOf, 8000, '卡片底下应该有一颗收起来的 +N')
  assert.equal(more.textContent, '+2', '六处引用摆四颗、多的收成 +2：' + more.textContent)
  assert.equal(more.getAttribute('data-open'), 'false')
  assert.equal(more.getAttribute('aria-expanded'), 'false')
  assert.equal(chipsIn(), 4, '收着的时候只摆四颗')

  more.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => chipsIn() === 6, 4000, '摊开之后六颗都在')
  const opened = moreOf()
  assert.equal(opened.getAttribute('data-open'), 'true')
  assert.equal(opened.getAttribute('aria-expanded'), 'true')
  assert.equal(opened.textContent, '收起')
  assert.equal(rootNode().getAttribute('data-has-note'), 'false', '摊开只是把话说完，不把这篇打开')
  assert.equal(window.document.querySelectorAll('.dshgn_filterChip').length, 0, '摊开不等于按它筛')

  opened.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => chipsIn() === 4, 4000, '再点收回去')
  assert.equal(moreOf().getAttribute('data-open'), 'false')

  setter.call(box, '')
  box.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(400)
})
/**
 * 热力图上每一颗格子原来只有 title：知道那天写了几篇，却打不开那几篇。
 * 现在点一下按那一天筛，和点目录/标签是同一个动作；再点同一颗取消。
 */
test('热力图上点某一天就按那一天筛，左栏顶上多一颗日期胶囊，再点同一颗取消', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  const post = async (path, body) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  // 退回空态，卡片才会在列表里
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = window.document.querySelector('.dshgn_noteBack')
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(200)
    }
  } finally {
    panel.setConfirmDialog(null)
  }
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  // 挑一个三十天前的日子：还在 26 周的热力图范围内，又不是今天（今天那格子里
  // 还堆着别的用例 seed 的笔记，按它筛出来一片，断言会互相串）。
  const pad = (n) => String(n).padStart(2, '0')
  const day = new Date()
  day.setDate(day.getDate() - 30)
  const dayKey = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
  const front = (date, title) =>
    ['---', '日期: ' + date, '---', '', '# ' + title, '', '正文', ''].join('\n')

  const madeA = await post('/getnote/create', {
    dir: '热力图验收',
    title: '热力图-那一天写的第一篇',
    content: front(dayKey, '热力图那一天第一篇'),
    withDatePrefix: false,
    requestId: 'seed-heat-day-a',
  })
  await post('/getnote/create', {
    dir: '热力图验收',
    title: '热力图-那一天写的第二篇',
    content: front(dayKey, '热力图那一天第二篇'),
    withDatePrefix: false,
    requestId: 'seed-heat-day-b',
  })
  await post('/getnote/create', {
    dir: '热力图验收',
    title: '热力图-今天写的另一篇',
    content: ['# 热力图今天这一篇', '', '正文', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-heat-day-c',
  })
  assert.ok(typeof madeA.path === 'string' && madeA.path !== '', '那一篇建好了')

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(700)

  const cellOf = () =>
    Array.from(window.document.querySelectorAll('button.dshgn_heatCell')).find((el) =>
      String(el.title || '').startsWith(dayKey),
    ) || null
  await waitFor(() => cellOf() !== null, 8000, '热力图上出现那一天那颗格子')
  assert.equal(cellOf().getAttribute('data-on'), 'false', '还没点的时候不该亮')
  assert.ok(
    String(cellOf().title || '').includes('看这一天写了什么'),
    '格子上要说清点它是干什么的：' + cellOf().title,
  )

  const cardOf = (title) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => {
      const node = el.querySelector('.dshgn_cardTitle')
      return node !== null && (node.textContent || '').trim() === title
    }) || null

  cellOf().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(500)
  assert.equal(cellOf().getAttribute('data-on'), 'true', '点了之后那一颗要亮起来')
  assert.ok(
    String(cellOf().title || '').includes('再点一下这颗格子就取消'),
    '亮着的时候要说清再点一次会取消：' + cellOf().title,
  )
  const chip = window.document.querySelector('.dshgn_filterChip[data-kind="day"]')
  assert.ok(chip !== null, '左栏顶上要多一颗日期胶囊，说清现在按哪天筛着')
  assert.equal((chip.textContent || '').trim(), dayKey, '胶囊上写的就是那一天')
  await waitFor(() => cardOf('热力图那一天第一篇') !== null, 8000, '那一天的笔记留在列表里')
  assert.ok(cardOf('热力图那一天第二篇') !== null, '同一天的另外一篇也在')
  assert.equal(cardOf('热力图今天这一篇'), null, '今天写的那篇不该混进来')

  cellOf().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(500)
  assert.equal(cellOf().getAttribute('data-on'), 'false', '再点同一颗就取消')
  assert.equal(
    window.document.querySelector('.dshgn_filterChip[data-kind="day"]'),
    null,
    '取消之后那颗日期胶囊也跟着消失',
  )
  await waitFor(() => cardOf('热力图今天这一篇') !== null, 8000, '取消之后今天的笔记回到列表里')

  // 收尾：退回「全部笔记」，别把筛选留给下一条用例
  const allBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find(
      (el) => (el.textContent || '').trim() === '全部笔记',
    )
  if (allBtn() !== undefined) {
    allBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }
})

/**
 * 卡片上的日期原来只是一段灰字：看到一篇是 10 月 22 日写的，想找同一天的其它篇，
 * 只能去热力图那颗小格子里点。现在日期本身点得动，和热力图是同一个动作。
 */
test('卡片上那个日期也点得动：点了就按那一天筛，左栏顶上多一颗日期胶囊，再点一下就取消', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  const post = async (path, body) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = window.document.querySelector('.dshgn_noteBack')
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(200)
    }
  } finally {
    panel.setConfirmDialog(null)
  }
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  const pad = (n) => String(n).padStart(2, '0')
  const day = new Date()
  day.setDate(day.getDate() - 40)
  const dayKey = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
  const front = (date, title) =>
    ['---', '日期: ' + date, '---', '', '# ' + title, '', '正文', ''].join('\n')

  await post('/getnote/create', {
    dir: '卡片日期验收',
    title: '卡片日期-那一天写的',
    content: front(dayKey, '卡片日期那一天写的'),
    withDatePrefix: false,
    requestId: 'seed-card-day-a',
  })
  await post('/getnote/create', {
    dir: '卡片日期验收',
    title: '卡片日期-今天写的',
    content: ['# 卡片日期今天写的', '', '正文', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-card-day-b',
  })

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(700)

  // 先点左栏那个目录：别的用例可能把列表按名称排着，几百篇里这一摊不一定落在
  // 前 60 张里。按目录筛一下，两张卡片一定在。
  const treeRowOf = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const node = el.querySelector('.dshgn_treeName')
      return node !== null && (node.textContent || '').trim() === name
    }) || null
  await waitFor(() => treeRowOf('卡片日期验收') !== null, 8000, '左栏里出现那个目录')
  treeRowOf('卡片日期验收').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const cardOf = (title) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => {
      const node = el.querySelector('.dshgn_cardTitle')
      return node !== null && (node.textContent || '').trim() === title
    }) || null
  await waitFor(() => cardOf('卡片日期那一天写的') !== null, 8000, '那一天的卡片在列表里')

  const dayBtnOf = (title) => {
    const card = cardOf(title)
    return card === null ? null : card.querySelector('.dshgn_cardDay')
  }
  assert.ok(dayBtnOf('卡片日期那一天写的') !== null, '卡片上的日期要能点')
  assert.equal((dayBtnOf('卡片日期那一天写的').textContent || '').trim(), dayKey, '日期按钮上写的就是那一天')
  assert.equal(dayBtnOf('卡片日期那一天写的').getAttribute('data-on'), 'false', '还没点的时候不该亮')
  assert.ok(
    String(dayBtnOf('卡片日期那一天写的').title || '').includes('看这一天写了什么'),
    '要悬停说清点它是干什么的：' + dayBtnOf('卡片日期那一天写的').title,
  )

  dayBtnOf('卡片日期那一天写的').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(500)
  assert.equal(rootNode().getAttribute('data-has-note'), 'false', '点日期只是筛，不把这篇打开')
  const chip = window.document.querySelector('.dshgn_filterChip[data-kind="day"]')
  assert.ok(chip !== null, '左栏顶上要多一颗日期胶囊，说清现在按哪天筛着')
  assert.equal((chip.textContent || '').trim(), dayKey, '胶囊上写的就是那一天')
  await waitFor(() => cardOf('卡片日期那一天写的') !== null, 8000, '那一天的笔记还在列表里')
  assert.equal(cardOf('卡片日期今天写的'), null, '今天写的那篇不该混进来')

  dayBtnOf('卡片日期那一天写的').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(500)
  assert.equal(
    window.document.querySelector('.dshgn_filterChip[data-kind="day"]'),
    null,
    '再点同一篇的日期就取消，胶囊跟着消失',
  )
  await waitFor(() => cardOf('卡片日期今天写的') !== null, 8000, '取消之后今天的笔记回到列表里')

  // 收尾：退回「全部笔记」，别把目录筛选留给下一条用例
  const allBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const node = el.querySelector('.dshgn_treeName')
      return node !== null && (node.textContent || '').trim() === '全部笔记'
    }) || null
  if (allBtn() !== null) {
    allBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }
})

/**
 * 搜完之后常常要把「这次找到的这几篇」抄给别人。一篇篇右键「复制引用」太慢，
 * 现在搜索框那一行多一颗按钮，一次抄成一段清单：一行一篇，写名字和位置。
 */
test('搜完之后能把这次找到的几篇一次抄成一段清单，一行一篇写着名字和位置', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  const post = async (path, body) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = window.document.querySelector('.dshgn_noteBack')
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(200)
    }
  } finally {
    panel.setConfirmDialog(null)
  }
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  const searchBox = window.document.querySelector('.dshgn_search')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(searchBox, '')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(400)

  await post('/getnote/create', {
    dir: '搜索抄写验收',
    title: '搜索抄写-甲',
    content: ['# 搜索抄写甲', '', '这里面有一个只在这次测试里出现的词：抄写验收词。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-search-copy-a',
  })
  await post('/getnote/create', {
    dir: '搜索抄写验收',
    title: '搜索抄写-乙',
    content: ['# 搜索抄写乙', '', '另一篇也写着抄写验收词。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-search-copy-b',
  })

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(700)

  const copyBtn = () => window.document.querySelector('.dshgn_searchCopy')
  assert.equal(copyBtn(), null, '还没搜的时候不摆这颗按钮')

  setter.call(searchBox, '抄写验收词')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
  await waitFor(() => copyBtn() !== null, 8000, '搜到东西之后摆出复制按钮')
  const title = String(copyBtn().title || '')
  assert.ok(title.includes('2'), '悬停要说清这一次搜到几篇：' + title)
  assert.ok(title.includes('复制'), '悬停要说清点它是干什么的：' + title)

  const written = []
  clipboard.writeText = async (text) => {
    written.push(String(text))
  }
  copyBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => written.length > 0, 4000, '真的往剪贴板里写了一段')

  const text = written[0]
  const lines = text.split('\n')
  assert.equal(lines.length, 2, '两篇就两行，不多不少：' + JSON.stringify(text))
  assert.ok(lines[0].startsWith('- '), '一行一篇，写成清单：' + lines[0])
  assert.ok(lines[1].startsWith('- '), '第二行也是：' + lines[1])
  assert.ok(text.includes('搜索抄写甲'), '要写名字：' + text)
  assert.ok(text.includes('搜索抄写乙'), '另一篇也在：' + text)
  assert.ok(text.includes('搜索抄写验收/'), '还要写位置，光有名字分不出重名的那几篇：' + text)

  await waitFor(() => {
    const toast = window.document.querySelector('.dshgn_toast')
    return toast !== null && (toast.textContent || '').includes('已复制')
  }, 4000, '抄完要说一声')

  setter.call(searchBox, '')
  searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(400)
  assert.equal(copyBtn(), null, '清空搜索之后这颗按钮跟着收起来')
})

/**
 * 版本历史点开一版，以前只能看正文长什么样，多几行少几行得自己一行行比对。
 * 现在头部直接写「恢复后多/少 N 行」，方向是「从现在换成这一版」。
 */
test('版本历史里点开一版，头部直说恢复之后会多几行还是少几行', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  const post = async (path, body) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = window.document.querySelector('.dshgn_noteBack')
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(200)
    }
  } finally {
    panel.setConfirmDialog(null)
  }
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  // 第一版三行；再存一版多三行 —— 保存时会把第一版留成快照。
  const made = await post('/getnote/create', {
    dir: '历史差异验收',
    title: '历史差异-改过的那一篇',
    content: ['# 历史差异-改过的那一篇', '', '最初就这三行', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-history-diff-a',
  })
  const notePath = made.path
  assert.ok(typeof notePath === 'string' && notePath !== '', '那一篇建好了')
  await post('/getnote/save', {
    path: notePath,
    content: ['# 历史差异-改过的那一篇', '', '最初就这三行', '后来加的一行', '又加的一行', '再加一行', ''].join('\n'),
  })

  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(700)

  const treeRow = () =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find(
      (el) => (el.querySelector('.dshgn_treeName') || {}).textContent === '历史差异验收',
    )
  await waitFor(() => treeRow() !== undefined, 8000, '左栏出现这个目录')
  treeRow().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const cardOf = () => {
    const cards = Array.from(window.document.querySelectorAll('.dshgn_card'))
    return cards.find((el) => {
      const node = el.querySelector('.dshgn_cardTitle')
      return node !== null && (node.textContent || '').trim() === '历史差异-改过的那一篇'
    })
  }
  await waitFor(() => cardOf() !== undefined, 8000, '列表里出现这一篇')
  cardOf().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '这一篇打开')

  const historyBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '版本历史')
  await waitFor(() => historyBtn() !== undefined, 5000, '笔记头上有版本历史那颗按钮')
  historyBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_historyItem') !== null, 8000, '历史列表出来了')

  const item = window.document.querySelector('.dshgn_historyItem')
  item.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_historyDiff') !== null, 8000, '点开一版有差异徽章')

  const badge = window.document.querySelector('.dshgn_historyDiff')
  assert.equal(
    (badge.textContent || '').trim(),
    '恢复后少 3 行',
    '这一版比现在少三行，徽章要直说少三行：' + badge.textContent,
  )
  assert.equal(badge.getAttribute('title'), '版本历史', '徽章的悬停说明跟着这块走')
  // 徽章是「从现在换成这一版」，所以正文里那一版确实是短的那一版
  const previewBody = window.document.querySelector('.dshgn_diffBody')
  assert.ok(
    previewBody !== null && !(previewBody.textContent || '').includes('后来加的一行'),
    '预览里应该是旧的那一版',
  )

  // 收尾：退回列表，别把历史面板和目录筛选留给下一条用例
  const closeBtn = Array.from(window.document.querySelectorAll('.dshgn_historyHead .dshgn_btn')).find(
    (el) => (el.textContent || '').trim() === '关闭',
  )
  if (closeBtn) {
    closeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(250)
  }
  const back = window.document.querySelector('.dshgn_noteBack')
  if (back) {
    back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }
  const allBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find(
      (el) => (el.querySelector('.dshgn_treeName') || {}).textContent === '全部笔记',
    )
  if (allBtn() !== undefined) {
    allBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }
})

/**
 * 搜过的词只有用户自己知道，宿主那边没有这个信息。以前每次都得从零敲一遍，
 * 隔一天回来连上次搜的是「录音卡」还是「录音卡片」都想不起来。
 * 现在搜索框空着的时候，下面摆着最近搜过的几个词。
 */
test('搜索框空着的时候摆着最近搜过的词，点一下就填回去，也能一次清掉', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  const post = async (path, body) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const box = () => window.document.querySelector('.dshgn_search')
  const typeIn = async (text) => {
    setter.call(box(), text)
    box().dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = window.document.querySelector('.dshgn_noteBack')
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(200)
    }
  } finally {
    panel.setConfirmDialog(null)
  }
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  await typeIn('')

  const word = '最近搜索验收词'
  await post('/getnote/create', {
    dir: '最近搜索验收',
    title: '最近搜索-甲',
    content: ['# 最近搜索甲', '', '这一篇里写着' + word + '。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-recent-search-a',
  })

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(700)

  await typeIn(word)
  await waitFor(() => window.document.querySelector('.dshgn_card') !== null, 8000, '搜到那一篇')
  // 停手一会儿才记：边打边搜的中间态（「最近」「最近搜索」）不该全存进去
  await sleep(1800)

  await typeIn('')
  const chips = await waitFor(() => {
    const all = Array.from(window.document.querySelectorAll('.dshgn_recentChip'))
    return all.some((el) => (el.textContent || '').trim() === word) ? all : null
  }, 6000, '搜索框空着时摆出最近搜过的词')
  const recentBar = window.document.querySelector('.dshgn_recent')
  assert.ok(recentBar !== null, '最近搜过的那一条要真的画出来')
  assert.ok((recentBar.textContent || '').includes('最近搜过'), '这一条得有个标题：' + recentBar.textContent)

  // 存进 localStorage：重启 Obsidian 之后还在（和栏宽、上次看到哪儿同一类偏好）
  const stored = window.localStorage.getItem('dshgn.recentSearches')
  assert.ok(stored !== null && stored.includes(word), '搜过的词要落进 localStorage：' + stored)

  // 点一颗就把词填回搜索框，并且真的又搜了一遍
  const mine = chips.find((el) => (el.textContent || '').trim() === word)
  mine.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => box().value === word, 3000, '点一下就填回搜索框')
  await waitFor(() => window.document.querySelector('.dshgn_card') !== null, 8000, '填回去之后又搜出结果')

  // 正搜着的时候不摆这一排别的词：只会把人往岔路上带
  assert.equal(window.document.querySelector('.dshgn_recent'), null, '搜索框里有字时不摆最近搜过')

  await typeIn('')
  const clearBtn = await waitFor(
    () => window.document.querySelector('.dshgn_recentClear'),
    6000,
    '清掉记录那颗按钮',
  )
  clearBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_recent') === null, 4000, '清掉之后整条收起来')
  assert.equal(window.localStorage.getItem('dshgn.recentSearches'), null, '清掉也要把落盘的那份删干净')
})

test('勾上几篇之后能把它们的引用一次抄走，一行一条，链接怎么拼先问宿主', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')

  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }

  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    setValue.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(260)
  }

  const pathA = '批量引用验收/批量引用-甲.md'
  const pathB = '批量引用验收/批量引用-乙.md'
  for (const [title, requestId] of [
    ['批量引用-甲', 'seed-batch-ref-a'],
    ['批量引用-乙', 'seed-batch-ref-b'],
  ]) {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '批量引用验收', title, content: '正文', withDatePrefix: false, requestId }),
    })
    assert.equal(res.status, 200, '建笔记要成功')
  }

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const rowOf = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })
  const dirRow = await waitFor(() => rowOf('批量引用验收'), 8000, '左栏里出现这个目录')
  dirRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const cardOf = (path) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === path) || null
  const cardA = await waitFor(() => cardOf(pathA), 8000, '第一篇')
  cardA.querySelector('.dshgn_pickBox').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(200)
  const cardB = await waitFor(() => cardOf(pathB), 8000, '第二篇')
  cardB.querySelector('.dshgn_pickBox').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_batchBar') !== null, 3000, '批量栏出现')

  // 宿主那边给的是它自己的链接写法（这里用 Wiki 形式），面板要原样用它。
  const written = []
  clipboard.writeText = async (text) => { written.push(String(text)) }
  try {
    const copyBtn = Array.from(window.document.querySelectorAll('.dshgn_batchBtn')).find(
      (el) => (el.textContent || '').trim() === '复制引用',
    )
    assert.ok(copyBtn, '批量条上应该有「复制引用」')
    assert.equal(copyBtn.disabled, false, '勾着两篇时该能按')
    copyBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => written.length > 0, 3000, '真的写了剪贴板')
  } finally {
    clipboard.writeText = async () => undefined
  }

  const lines = written[0].split('\n').filter((line) => line.trim() !== '')
  assert.equal(lines.length, 2, '勾了两篇就该抄两条，实际 ' + JSON.stringify(lines))
  const joined = lines.join(' | ')
  assert.ok(joined.includes('批量引用-甲'), '第一条要写得出名字，实际 ' + joined)
  assert.ok(joined.includes('批量引用-乙'), '第二条要写得出名字，实际 ' + joined)
  for (const line of lines) {
    assert.ok(line.startsWith('[['), '每条都该是宿主给的链接写法，实际 ' + line)
  }
  const toastText = await waitFor(
    () => {
      const node = window.document.querySelector('.dshgn_toast')
      const text = node === null ? '' : node.textContent || ''
      return text.includes('2') ? text : null
    },
    3000,
    '提示条报出抄了几条',
  )
  assert.ok(String(toastText).includes('2'), '提示条要报出抄了几条，实际 ' + toastText)

  // 抄走不等于把选中清掉：还想接着贴标签、移目录。
  const countText = () => (window.document.querySelector('.dshgn_batchCount') || { textContent: '' }).textContent
  assert.ok(String(countText()).includes('2'), '抄完不该把选中清掉，实际 ' + countText())

  const clearBtn = Array.from(window.document.querySelectorAll('.dshgn_batchBtn')).find(
    (el) => (el.textContent || '').trim() === '取消选择',
  )
  clearBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(200)
  const allRow = rowOf('全部笔记')
  if (allRow !== undefined) allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)
})
test('回收站里能就地看一眼删掉的那篇写的是什么，不用先恢复出来', async () => {
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
  const shortPath = '回收站预览验收/回收站预览-短的一篇.md'
  const longPath = '回收站预览验收/回收站预览-长的一篇.md'
  await post('/getnote/create', {
    dir: '回收站预览验收',
    title: '回收站预览-短的一篇',
    content: ['# 回收站预览-短的一篇', '', '这一篇删掉之前写的是一句认得出来的话。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-trash-peek-a',
  })
  await post('/getnote/create', {
    dir: '回收站预览验收',
    title: '回收站预览-长的一篇',
    content: ['# 回收站预览-长的一篇', '', '长'.repeat(400), ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-trash-peek-b',
  })

  // 退回空态，免得带着上一篇的阅读态进来
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }

  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(600)

  for (const [path, id] of [[shortPath, 'a'], [longPath, 'b']]) {
    const deleted = await post('/getnote/delete', { path })
    assert.equal(deleted.ok, true, '删进回收站失败（' + id + '）：' + JSON.stringify(deleted))
  }

  await clickTab('回收站')
  const rowOf = (title) =>
    Array.from(window.document.querySelectorAll('.dshgn_cardBox .dshgn_rowLine')).find((el) => {
      const label = el.querySelector('.dshgn_cardTitle')
      return label !== null && (label.textContent || '').trim() === title
    }) || null
  const shortRow = await waitFor(() => rowOf('回收站预览-短的一篇'), 8000, '回收站里出现短的那一篇')
  const peekBtn = shortRow.querySelector('.dshgn_trashPeekBtn')
  assert.ok(peekBtn !== null, '每一行都该有「看一眼」')
  assert.equal((peekBtn.textContent || '').trim(), '看一眼', '按钮上要写明是看一眼')
  assert.equal(peekBtn.getAttribute('aria-expanded'), 'false', '没摊开时 aria-expanded 是 false')

  peekBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const preview = await waitFor(() => window.document.querySelector('.dshgn_trashPreview'), 8000, '摊开那一块')
  const previewBody = () => {
    const node = window.document.querySelector('.dshgn_trashPreviewBody')
    return node === null ? '' : node.textContent || ''
  }
  await waitFor(() => previewBody() !== '', 8000, '读到正文')
  assert.ok(
    previewBody().includes('这一篇删掉之前写的是一句认得出来的话'),
    '摊开的该是那篇的正文，实际：' + previewBody().slice(0, 80),
  )
  assert.ok(
    !previewBody().trimStart().startsWith('---'),
    '摊开的只是正文，不该把 frontmatter 也搬出来',
  )
  // 看一眼不等于把它恢复出来：那一行还在回收站里，恢复按钮也还在
  assert.ok(rowOf('回收站预览-短的一篇') !== null, '看一眼之后那一篇还该在回收站里')
  assert.equal(
    window.document.querySelectorAll('.dshgn_trashPreview').length,
    1,
    '一次只摊开一篇',
  )
  assert.equal(
    (shortRow.querySelector('.dshgn_trashPeekBtn').textContent || '').trim(),
    '收起',
    '摊开之后按钮该说「收起」',
  )

  // 再点一次收回去
  shortRow.querySelector('.dshgn_trashPeekBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_trashPreview') === null, 5000, '收回去')
  assert.equal(
    shortRow.querySelector('.dshgn_trashPeekBtn').getAttribute('aria-expanded'),
    'false',
    '收回去之后 aria-expanded 回到 false',
  )

  // 太长的那篇只摊开头一段，尾巴留一句话说明还有多少没展开
  const longRow = await waitFor(() => rowOf('回收站预览-长的一篇'), 8000, '回收站里出现长的那一篇')
  longRow.querySelector('.dshgn_trashPeekBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_trashPreviewBody') !== null, 8000, '摊开长的那一篇')
  const hint = await waitFor(
    () => {
      const node = window.document.querySelector('.dshgn_trashPreviewHint')
      const text = node === null ? '' : node.textContent || ''
      return text.includes('后面还有') ? text : null
    },
    5000,
    '尾巴要说明还有多少没展开',
  )
  assert.ok(String(hint).includes('后面还有'), '长文该留一句「后面还有 N 个字没展开」，实际：' + hint)
  assert.ok(
    (window.document.querySelector('.dshgn_trashPreviewBody').textContent || '').length <= 320,
    '只摆开头一段，不要整篇塞进回收站里',
  )

  await clickTab('笔记')
})
test('待办页里每一篇都能收起来，收起来之后组头和条数还留着', async () => {
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
  await post('/getnote/create', {
    dir: '待办折叠验收',
    title: '待办折叠-话多的那一篇',
    content: [
      '# 待办折叠-话多的那一篇',
      '',
      '- [ ] 折叠验收第一条',
      '- [ ] 折叠验收第二条',
      '- [ ] 折叠验收第三条',
      '',
    ].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-todo-fold-a',
  })
  await post('/getnote/create', {
    dir: '待办折叠验收',
    title: '待办折叠-另一篇',
    content: ['# 待办折叠-另一篇', '', '- [ ] 折叠验收别的一篇的那一条', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-todo-fold-b',
  })

  await clickTab('待办')

  const rowsOf = (needle) =>
    Array.from(window.document.querySelectorAll('.dshgn_todoRow')).filter((el) =>
      (el.textContent || '').includes(needle),
    )
  const groupHeadOf = () =>
    Array.from(window.document.querySelectorAll('.dshgn_todoGroup')).find((el) =>
      (el.getAttribute('title') || '').endsWith('待办折叠-话多的那一篇.md'),
    ) || null
  const foldedHintOf = () =>
    Array.from(window.document.querySelectorAll('.dshgn_sectionDesc')).find((el) =>
      (el.textContent || '').includes('收起来了'),
    ) || null

  await waitFor(() => groupHeadOf() !== null, 8000, '待办页里要出现这一篇的组头')
  await waitFor(() => rowsOf('折叠验收第一条').length === 1, 8000, '这一篇的三条都在单子上')
  assert.equal(rowsOf('折叠验收第').length, 3, '收着的时候这一篇该摆三条')
  assert.equal(rowsOf('折叠验收别的一篇').length, 1, '另一篇的那一条也在')

  const head = groupHeadOf()
  const foldBtn = head.querySelector('.dshgn_todoFold')
  assert.ok(foldBtn !== null, '组头前面得有一颗能收起来的小箭头')
  assert.equal(foldBtn.getAttribute('data-folded'), 'false', '一开始是展开的')
  assert.equal(foldBtn.getAttribute('aria-expanded'), 'true', '一开始是展开的')
  assert.equal(foldBtn.getAttribute('title'), '收起这一篇')

  foldBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowsOf('折叠验收第').length === 0, 5000, '收起来之后这一篇的行该全不见')

  // 收起来不等于「这一篇没待办了」：组头、篇名、条数、那颗「勾掉这一篇的 N 条」都得还在。
  const stillHead = groupHeadOf()
  assert.ok(stillHead !== null, '收起来之后组头不能跟着消失')
  assert.ok((stillHead.textContent || '').includes('待办折叠-话多的那一篇'), '组头还写着篇名')
  assert.ok((stillHead.textContent || '').includes('3'), '组头还标着这一篇有几条：' + stillHead.textContent)
  assert.ok(stillHead.querySelector('.dshgn_todoGroupAll') !== null, '「勾掉这一篇的 N 条」也得留着')
  assert.equal(
    stillHead.querySelector('.dshgn_todoFold').getAttribute('data-folded'),
    'true',
    '箭头要翻过来',
  )
  assert.equal(stillHead.querySelector('.dshgn_todoFold').getAttribute('title'), '展开这一篇')
  assert.equal(stillHead.querySelector('.dshgn_todoFold').getAttribute('aria-expanded'), 'false')

  const hint = foldedHintOf()
  assert.ok(hint !== null, '收起来的地方要说一句，不能留一片空白')
  assert.ok((hint.textContent || '').includes('这一篇的 3 条收起来了'), '要说清收了几条：' + (hint ? hint.textContent : ''))

  // 别的篇不受影响——收的是这一篇，不是整页。
  assert.equal(rowsOf('折叠验收别的一篇').length, 1, '别的篇的行不该跟着收起来')

  // 再点一下摊开，三条原样回来、那句说明收回去。
  groupHeadOf().querySelector('.dshgn_todoFold').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowsOf('折叠验收第').length === 3, 5000, '再点一下三条该回来')
  assert.equal(foldedHintOf(), null, '摊开之后那句说明该收回去')
  assert.equal(
    groupHeadOf().querySelector('.dshgn_todoFold').getAttribute('data-folded'),
    'false',
    '箭头要转回来',
  )

  await clickTab('笔记')
})
test('待办页顶上那颗「全部收起」一次把所有篇都收起来，再按一下全摊开', async () => {
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
  await post('/getnote/create', {
    dir: '待办全收验收',
    title: '待办全收-甲',
    content: ['# 待办全收-甲', '', '- [ ] 全收验收甲一', '- [ ] 全收验收甲二', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-todo-fold-all-a',
  })
  await post('/getnote/create', {
    dir: '待办全收验收',
    title: '待办全收-乙',
    content: ['# 待办全收-乙', '', '- [ ] 全收验收乙一', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-todo-fold-all-b',
  })

  await clickTab('待办')

  const rowsOf = (needle) =>
    Array.from(window.document.querySelectorAll('.dshgn_todoRow')).filter((el) =>
      (el.textContent || '').includes(needle),
    )
  const foldAllBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_todoFoldAll')).find(
      (el) => (el.textContent || '').trim() === '全部收起',
    ) ||
    Array.from(window.document.querySelectorAll('.dshgn_todoFoldAll')).find(
      (el) => (el.textContent || '').trim() === '全部展开',
    ) ||
    null

  await waitFor(() => rowsOf('全收验收甲一').length === 1, 8000, '甲那一篇的待办在单子上')
  await waitFor(() => rowsOf('全收验收乙一').length === 1, 8000, '乙那一篇的待办也在')
  assert.equal(rowsOf('全收验收').length, 3, '两篇一共三条')

  const btn = foldAllBtn()
  assert.ok(btn !== null, '篇数多的时候顶上得有一颗「全部收起」')
  assert.equal(btn.getAttribute('aria-pressed'), 'false', '一开始是摊开的')

  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowsOf('全收验收').length === 0, 5000, '全收起来之后一条行都不该留')

  // 收起来不等于清空：组头、篇名、条数都还在，说明条数也留着。
  const heads = Array.from(window.document.querySelectorAll('.dshgn_todoGroup'))
  const ours = heads.filter((el) => (el.getAttribute('title') || '').includes('待办全收验收/'))
  assert.equal(ours.length, 2, '两篇的组头都还在')
  for (const head of ours) {
    assert.equal(
      head.querySelector('.dshgn_todoFold').getAttribute('data-folded'),
      'true',
      '每一篇的箭头都翻成收起的',
    )
  }
  const unfoldedBtn = Array.from(window.document.querySelectorAll('.dshgn_todoFoldAll')).find(
    (el) => (el.textContent || '').trim() === '全部展开',
  )
  assert.ok(unfoldedBtn !== undefined, '全收着时这颗按钮该改成「全部展开」')
  assert.equal(unfoldedBtn.getAttribute('aria-pressed'), 'true', '全收着时按下去的状态是开着的')

  unfoldedBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowsOf('全收验收').length === 3, 5000, '再按一下三条都该回来')
  assert.equal(
    Array.from(window.document.querySelectorAll('.dshgn_todoFoldAll'))[0].getAttribute('aria-pressed'),
    'false',
    '摊开之后按钮回到「全部收起」',
  )

  await clickTab('笔记')
})

test('连笔记库都还没有的时候，空列表那一屏直说没有库，并给一条去设置的路', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 8000, '根节点渲染')

  // 这一屏只有在「库还没指过」时才出现，而正常跑测试时库是好的。
  // 所以只在 /status 上盖一层壳：其它请求照旧走真服务，免得影响别的断言。
  const wrapped = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input && input.url)
    const res = await realFetch(url, init)
    // 库没了的时候宿主那边 /tree 也是一篇都不给，这里照做：
    // 只盖 /status 的话列表里还摆着真库的那几百篇，空列表那一屏根本不会出现。
    if (url.includes('/getnote/tree')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ root: '', tree: { name: '', path: '', kind: 'dir', children: [], count: 0 }, entries: [], dirs: [] }),
      }
    }
    if (!url.includes('/getnote/status')) return res
    const json = await res.json()
    return {
      ok: true,
      status: 200,
      json: async () => ({ ...json, vaultMissing: '/tmp/不存在-的-笔记目录' }),
    }
  }
  window.fetch = globalThis.fetch = wrapped
  try {
    const refreshBtn = () =>
      Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) =>
        (el.getAttribute('title') || '').includes('刷新'),
      )
    assert.ok(refreshBtn(), '应该有一个刷新按钮')
    refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

    // 右栏「选一篇笔记开始阅读」也用 .dshgn_empty，所以要限定在中栏列表里找。
    const emptyOf = () => window.document.querySelector('.dshgn_listBody .dshgn_empty')
    await waitFor(() => emptyOf() !== null, 8000, '空列表那一屏')
    const title = emptyOf().querySelector('.dshgn_emptyTitle')
    assert.ok(title !== null, '空列表那一屏要有标题')
    assert.ok(
      (title.textContent || '').includes('还没有本地笔记库'),
      '没有库时不能只说「这个目录还没有笔记」：' + (title ? title.textContent : ''),
    )
    assert.ok(
      (emptyOf().textContent || '').includes('先在「设置」里指定一个目录'),
      '要说清该去哪儿挑目录：' + emptyOf().textContent,
    )

    const actions = emptyOf().querySelector('.dshgn_emptyActions')
    assert.ok(actions !== null, '这一屏要有一条出路')
    const goSettings = Array.from(actions.querySelectorAll('button')).find((el) =>
      (el.textContent || '').includes('去设置里挑个目录'),
    )
    assert.ok(goSettings !== null, '要有一颗「去设置里挑个目录」：' + actions.textContent)
    // 没有库的时候，「新建」「清掉筛选」都是空转的：一篇都建不出来，也没什么可清的。
    assert.equal(
      Array.from(actions.querySelectorAll('button')).some((el) => (el.textContent || '').includes('清掉筛选')),
      false,
      '没有库时不该摆「清掉筛选」',
    )

    goSettings.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(
      () =>
        Array.from(window.document.querySelectorAll('.dshgn_sectionTitle')).some(
          (el) => (el.textContent || '').trim() === '笔记目录',
        ),
      '设置页里那个目录输入框',
    )
  } finally {
    // 把壳摘掉，再把状态拉回真的：后面还有别的用例要用这个面板。
    window.fetch = globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : String(input && input.url)
      fetchCalls.push(url)
      return realFetch(url, init)
    }
    await clickTab('笔记')
    const refreshBtn = () =>
      Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) =>
        (el.getAttribute('title') || '').includes('刷新'),
      )
    if (refreshBtn()) refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(600)
  }
})

test('左栏那个筛只筛目录和标签：命中行的祖先留着，清掉就回全量', async () => {
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
  const seeded = [
    ['左栏筛验收/甲摊', '左栏筛验收-甲', 'seed-tree-filter-a', '左栏筛验收标签/一'],
    ['左栏筛验收/乙摊/更深一层', '左栏筛验收-乙', 'seed-tree-filter-b', '左栏筛验收标签/二'],
  ]
  for (const [dir, title, requestId, tag] of seeded) {
    await post('/getnote/create', {
      dir,
      title,
      content: ['---', 'tags: [' + tag + ']', '---', '', '# ' + title, '', '左栏筛验收的正文', ''].join(
        '\n',
      ),
      withDatePrefix: false,
      requestId,
    })
  }

  // 刷新一次，让左栏认出新目录和新标签
  const refreshBtn = Array.from(window.document.querySelectorAll('button')).find(
    (el) => (el.getAttribute('title') || '') === '刷新' || (el.textContent || '').trim() === '刷新',
  )
  if (refreshBtn) refreshBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(900)

  const dirRows = () => Array.from(window.document.querySelectorAll('.dshgn_treeRow'))
  const dirNames = () =>
    dirRows()
      .map((el) => {
        const label = el.querySelector('.dshgn_treeName')
        return label === null ? '' : (label.textContent || '').trim()
      })
      .filter((name) => name !== '')
  const tagRows = () => Array.from(window.document.querySelectorAll('.dshgn_tagRow'))
  const tagTitles = () => tagRows().map((el) => el.getAttribute('title') || '')

  await waitFor(() => dirNames().includes('甲摊'), 8000, '左栏里出现甲摊这一支')
  const beforeDirs = dirNames().length
  const beforeTags = tagTitles().length

  const box = await waitFor(
    () => window.document.querySelector('.dshgn_treeFilterInput'),
    5000,
    '左栏那个筛',
  )
  assert.equal(box.getAttribute('placeholder'), '筛目录和标签', '输入框上得写着它是筛什么的')
  assert.equal(
    window.document.querySelector('.dshgn_treeFilterClear'),
    null,
    '没敲字的时候不摆清空那颗',
  )

  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const type = async (text) => {
    setValue.call(box, text)
    box.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(200)
  }

  await type('左栏筛验收')
  // 只留命中的那几支：别的用例 seed 过的目录不该还在
  assert.ok(dirNames().includes('甲摊'), '命中那一支要留着')
  assert.ok(dirNames().includes('乙摊'), '另一支命中的也要留着')
  assert.ok(dirNames().includes('左栏筛验收'), '命中的上级目录要留着，不然那一支看着像凭空出现的')
  assert.equal(dirNames().includes('待办全收验收'), false, '不相关的目录要收起来')
  assert.ok(dirNames().length < beforeDirs, '筛完之后行数要变少')
  assert.ok(tagTitles().includes('左栏筛验收标签/一'), '标签云也一起筛')
  assert.equal(tagTitles().includes('筛选条标签'), false, '不相关的标签要收起来')
  assert.ok(tagTitles().length <= beforeTags, '标签行不会变多')

  // 清掉那颗一按就回全量
  const clearBtn = await waitFor(
    () => window.document.querySelector('.dshgn_treeFilterClear'),
    3000,
    '清空那颗按钮',
  )
  clearBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(200)
  assert.equal(box.value, '', '清掉之后输入框该空了')
  assert.equal(dirNames().length, beforeDirs, '清掉之后目录行回到原来那么多')
  assert.equal(
    window.document.querySelector('.dshgn_treeFilterClear'),
    null,
    '空了之后清空那颗要收起来',
  )

  // 敲一个肯定没有的词：得明说没有对得上的，而不是留一片空白
  await type('zzz-左栏筛验收肯定没有这个')
  await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_sectionDesc')).some((el) =>
        (el.textContent || '').includes('没有对得上的目录或标签'),
      ),
    3000,
    '没有对得上时的说明',
  )
  assert.equal(dirNames().includes('甲摊'), false, '一个都没对上时不该还留着目录行')

  // Esc 只清左栏这个筛，别把整个面板的 Esc 一起触发
  box.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  )
  await sleep(200)
  assert.equal(box.value, '', 'Esc 也该把左栏这个筛清掉')
  assert.equal(dirNames().length, beforeDirs, 'Esc 之后目录行回到原来那么多')

  await clickTab('笔记')
})

test('读到列表中间那一篇时，笔记头上能接着看上一篇/下一篇，脚下写着排第几', async () => {
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
  // 三篇，名字带序号，这样「按名称」排序时顺序是确定的
  for (const [idx, suffix] of [
    [1, '甲'],
    [2, '乙'],
    [3, '丙'],
  ]) {
    await post('/getnote/create', {
      dir: '相邻导航验收',
      title: '相邻导航-0' + idx + '-' + suffix,
      content: ['# 相邻导航-0' + idx + '-' + suffix, '', '相邻导航的正文第' + idx + '篇', ''].join('\n'),
      withDatePrefix: false,
      requestId: 'seed-adjacent-' + idx,
    })
  }

  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    const setValue0 = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setValue0.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(300)
  }
  const refreshBtn = Array.from(window.document.querySelectorAll('button')).find(
    (el) => (el.getAttribute('title') || '') === '刷新',
  )
  if (refreshBtn) refreshBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(900)

  // 点进这一摊（别的用例 seed 过几百篇，按名称排序时目标不一定落在前 60 张里）
  const dirRow = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
        const label = el.querySelector('.dshgn_treeName')
        return label !== null && (label.textContent || '').trim() === '相邻导航验收'
      }),
    8000,
    '左栏里出现相邻导航验收这一支',
  )
  dirRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(500)

  const cardOf = (title) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => {
      const label = el.querySelector('.dshgn_cardTitle')
      return label !== null && (label.textContent || '').trim() === title
    }) || null

  const openCard = async (title) => {
    const card = await waitFor(() => cardOf(title), 8000, '列表里出现 ' + title)
    card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(600)
  }

  // 先打开中间那篇。注意：列表默认按「最近改的」倒序，三篇是同一秒建出来的，
  // 谁在前谁在后不可预测——所以这里不押「上一篇一定是甲、下一篇一定是丙」，
  // 只押「两颗都在、悬停能说清是哪一篇、脚下写着第 2 / 3 篇」，再用脚下一步步
  // 走到两头去验边界。
  await openCard('相邻导航-02-乙')
  const adjBtns = () =>
    Array.from(window.document.querySelectorAll('.dshgn_adjBtn'))
  const prevBtnOf = () => adjBtns().find((el) => el.getAttribute('aria-label') === '上一篇')
  const nextBtnOf = () => adjBtns().find((el) => el.getAttribute('aria-label') === '下一篇')
  const posText = () =>
    (window.document.querySelector('.dshgn_readPos') || { textContent: '' }).textContent.trim()
  await waitFor(() => adjBtns().length === 2, 5000, '笔记头上有两颗「上一篇/下一篇」')
  const prevBtn = prevBtnOf()
  const nextBtn = nextBtnOf()
  assert.ok(prevBtn, '中间那篇该有「上一篇」')
  assert.ok(nextBtn, '中间那篇该有「下一篇」')
  assert.ok(
    (prevBtn.getAttribute('title') || '').includes('相邻导航-'),
    '上一篇悬停要说清是哪一篇：' + prevBtn.getAttribute('title'),
  )
  assert.ok(
    (nextBtn.getAttribute('title') || '').includes('相邻导航-'),
    '下一篇悬停要说清是哪一篇：' + nextBtn.getAttribute('title'),
  )
  assert.ok(
    prevBtn.getAttribute('title') !== nextBtn.getAttribute('title'),
    '上一篇和下一篇不该指向同一篇',
  )
  // 脚下写着排第几
  await waitFor(() => posText() !== '', 3000, '阅读态脚下写着排第几')
  assert.equal(posText(), '第 2 / 3 篇', '脚下要写着第几篇、一共几篇')

  // 一直往「下一篇」走到头：脚下走到 3 / 3，那颗按钮跟着收起来
  for (let step = 0; step < 3; step += 1) {
    const btn = nextBtnOf()
    if (btn === undefined) break
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(600)
  }
  await waitFor(() => posText().includes('第 3 / 3 篇'), 5000, '走到最后一篇之后脚下写着第 3 / 3 篇')
  assert.equal(nextBtnOf(), undefined, '已经是最后一篇了，不该还摆一颗按了没反应的「下一篇」')
  assert.ok(prevBtnOf(), '最后一篇仍该有「上一篇」')

  // 一直往「上一篇」走回最前面：脚下走到 1 / 3，那颗按钮也跟着收起来
  for (let step = 0; step < 3; step += 1) {
    const btn = prevBtnOf()
    if (btn === undefined) break
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(600)
  }
  await waitFor(() => posText().includes('第 1 / 3 篇'), 5000, '走回第一篇')
  assert.equal(prevBtnOf(), undefined, '第一篇前面没有别的了，不该还摆一颗「上一篇」')
  assert.ok(nextBtnOf(), '第一篇后面还有，仍该有「下一篇」')

  // 收尾：退回列表，别把右栏留给后面那些用例
  const backBtn = window.document.querySelector('.dshgn_noteBack')
  if (backBtn !== null) {
    backBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(400)
  }
  await clickTab('笔记')
})

test('卡片右键能把这一篇的正文整段抄走，带走的是正文不是链接、开头那段属性不跟过来', async () => {
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
  const title = '正文抄写-这一篇'
  const notePath = '正文抄写验收/' + title + '.md'
  await post('/getnote/create', {
    dir: '正文抄写验收',
    title,
    content: [
      '---',
      'tags: [正文抄写/甲]',
      '---',
      '',
      '# ' + title,
      '',
      '第一段正文，抄走的时候要跟着走。',
      '',
      '第二段正文，别丢了。',
      '',
    ].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-copy-body-a',
  })

  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    const setValue0 = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setValue0.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(300)
  }
  const refreshBtn = Array.from(window.document.querySelectorAll('button')).find(
    (el) => (el.getAttribute('title') || '') === '刷新',
  )
  if (refreshBtn) refreshBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(900)

  const dirRow = await waitFor(
    () =>
      Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
        const label = el.querySelector('.dshgn_treeName')
        return label !== null && (label.textContent || '').trim() === '正文抄写验收'
      }),
    8000,
    '左栏里出现正文抄写验收这一支',
  )
  dirRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(500)

  const card = await waitFor(
    () => window.document.querySelector('.dshgn_card[title="' + notePath + '"]'),
    8000,
    '列表里出现这一篇的卡片',
  )

  const toastText = () => ((window.document.querySelector('.dshgn_toast') || {}).textContent || '')

  // 剪贴板：收集写进去的那一段
  const copied = []
  const realWrite = window.navigator.clipboard.writeText
  window.navigator.clipboard.writeText = async (text) => {
    copied.push(String(text))
  }

  try {
    let sawItem = null
    panel.setNoteMenu((event, items) => {
      sawItem = items.find((one) => one.id === 'copy-body') || null
      if (sawItem !== null) sawItem.run()
      return true
    })
    card.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await waitFor(() => copied.length === 1, 6000, '右键里那颗「复制正文」把正文写进剪贴板')

    assert.ok(sawItem, '右键菜单里该有「复制正文」')
    assert.equal(sawItem.label, '复制正文', '菜单文案要对得上，实际 ' + sawItem.label)

    const text = copied[0]
    assert.ok(text.includes('第一段正文，抄走的时候要跟着走。'), '抄走的该是正文：' + text.slice(0, 80))
    assert.ok(text.includes('第二段正文，别丢了。'), '整段都该在，不只第一段')
    assert.ok(!text.trimStart().startsWith('---'), '开头那段属性不该跟过来')
    assert.ok(!text.includes('tags:'), '属性里的 tags 也不该出现')

    // 提示条要说清复制了多少个字，而不是一句干巴巴的「已复制」
    await waitFor(() => /已复制正文/.test(toastText()), 5000, '提示条说清复制了多少个字')
  } finally {
    window.navigator.clipboard.writeText = realWrite
    panel.setNoteMenu(null)
  }
})

/**
 * 同一篇在两个地方改过：后保存的那一份不能把前一份悄悄盖掉。
 *
 * 面板开着这一篇、用户在 Obsidian 编辑器里也改了同一篇（或者另一台设备同步下来一版），
 * 面板这边再按保存——以前是直接写盘，对方那份就没了，而且没有任何痕迹。
 * 现在带着「我读到的是哪一版」去存，对不上就问一句「用哪一版」。
 */
test('别处改过同一篇时，保存先问一句用哪一版，而不是闷头盖掉', async () => {
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

  const title = '保存撞车-这一篇'
  const path = '保存撞车验收/' + title + '.md'
  const created = await realFetch(server.origin + '/getnote/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
    body: JSON.stringify({
      dir: '保存撞车验收',
      title,
      content: '# ' + title + '\n\n原始正文。\n',
      withDatePrefix: false,
      requestId: 'seed-save-conflict-a',
    }),
  })
  assert.equal(created.status, 200, '种下这一篇')

  // 在「别处」改这一篇：绕开面板自己的保存流程，直接打服务接口
  const writeElsewhere = async (text) => {
    const res = await realFetch(server.origin + '/getnote/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ path, content: text }),
    })
    assert.equal(res.status, 200, '别处写盘应该成功')
  }

  await clickTab('笔记')
  // 前面的用例可能留着搜索词或目录筛选：不先撤掉的话，新种下的这一篇根本不会出现在列表里
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    const setValue0 = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setValue0.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(300)
  }
  const allRow = Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
    const name = el.querySelector('.dshgn_treeName')
    return name !== null && (name.textContent || '').trim() === '全部笔记'
  })
  if (allRow !== null) {
    allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(300)
  }
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(600)

  const cardOf = () =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => {
      const name = el.querySelector('.dshgn_cardTitle')
      return name !== null && (name.textContent || '').trim() === title
    })
  const card = await waitFor(cardOf, 8000, '列表里出现这一篇')
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'true', 8000, '笔记打开')

  const enterEdit = async () => {
    const btn = Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '编辑')
    assert.ok(btn, '阅读态应该有编辑按钮')
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    return await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '进入编辑态')
  }
  const typeInto = async (area, text) => {
    area.value = text
    area.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(60)
  }
  const pressSave = async () => {
    // 整套测试并行跑时机器可能很吃紧，一次按键的处理器要排一会儿队才轮到；
    // 重按几次（真的坏了仍然会失败，只是不会因为慢就判红）。
    for (let attempt = 0; attempt < 3; attempt += 1) {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, metaKey: true, bubbles: true }))
      await sleep(400)
    }
  }

  // ① 面板里改一笔，然后别处也改一笔 —— 保存时必须问，选了「用别处那一版」
  const area = await enterEdit()
  await typeInto(area, '# ' + title + '\n\n面板里改的正文。\n')
  await sleep(20)
  await writeElsewhere('# ' + title + '\n\n别处改的正文。\n')

  const asked = []
  panel.setConfirmDialog((message, options) => {
    asked.push({ message: String(message), options: options || {} })
    return Promise.resolve(false)
  })
  try {
    await pressSave()
    await waitFor(() => asked.length > 0, 8000, '撞车时应该问一句')
  } finally {
    panel.setConfirmDialog(null)
  }
  assert.match(asked[0].message, /在别处被改过/, '提示要说清是别处改过：' + asked[0].message)
  assert.equal(asked[0].options.confirmText, '存我这一版', '两颗按钮都得说清各自是哪个选择')
  assert.equal(asked[0].options.cancelText, '用别处那一版')

  // 选了「用别处那一版」：手上这份丢掉，正文换成磁盘上的。
  // 这时候还留在编辑态，正文在 textarea 里，阅读态那个 .dshgn_note 根本不在。
  await waitFor(
    () => {
      const area = window.document.querySelector('.dshgn_editor')
      return area !== null && String(area.value || '').includes('别处改的正文')
    },
    8000,
    '选「用别处那一版」之后正文要换成那一版',
  )
  const afterTheir = await realFetch(server.origin + '/getnote/read?path=' + encodeURIComponent(path), {
    headers: { 'x-getnote-token': server.token },
  }).then((res) => res.json())
  assert.match(afterTheir.content, /别处改的正文/, '磁盘上还是别处那一版，没被我们覆盖')

  // ② 再来一次，这次选「存我这一版」：写进去的必须是我手上这一份
  const area2 = await waitFor(() => window.document.querySelector('.dshgn_editor'), 5000, '还留在编辑态')
  await typeInto(area2, '# ' + title + '\n\n我这一版。\n')
  await sleep(20)
  await writeElsewhere('# ' + title + '\n\n别处又改了一版。\n')

  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    await pressSave()
    await sleep(700)
  } finally {
    panel.setConfirmDialog(null)
  }
  const afterMine = await realFetch(server.origin + '/getnote/read?path=' + encodeURIComponent(path), {
    headers: { 'x-getnote-token': server.token },
  }).then((res) => res.json())
  assert.match(afterMine.content, /我这一版/, '选了「存我这一版」就得真的写进去：' + afterMine.content)
  assert.ok(!/别处又改了一版/.test(afterMine.content), '不该还留着别处那一版')

  // 收尾：退出编辑态，别把草稿留给后面的用例
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(200)
})

/**
 * 设置页里的自定义模板。
 *
 * 列表里那段骨架只露两行，长模板（周报、复盘那种几十行的）在这一屏根本看不出
 * 全貌，以前只能把它删掉重建一遍才知道自己当初写了什么。这条守三件事：
 * 「看全文」摊出来的是完整正文（不是截断那段）、再点一下收起、只有标题的模板
 * 明说它只有标题而不是摊一个空框。
 */
test('设置页里每个模板都能摊开看全文，只有标题的也说得明白', async () => {
  await waitFor(() => window.document.querySelector('.dshgn_root') !== null, 5000, '根节点渲染')

  const post = async (path, body) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  const longBody = ['## 这一周', '', '- 做完了什么', '- 卡在哪儿', '', '## 下一周', '', '- 先做哪件'].join('\n')
  await post('/getnote/settings', {
    templates: [
      { name: '周报骨架-验收', body: longBody },
      { name: '只有标题-验收', body: '' },
    ],
  })

  // 设置是刚 POST 进去的，面板手上那份 status 还是旧的；先点一次刷新把 status 拉回来，
  // 否则设置页里还是上一批模板（甚至一个都没有）。
  const refreshBtn = Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  assert.ok(refreshBtn, '应该有一个刷新按钮')
  refreshBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(700)

  await clickTab('设置')
  await waitFor(
    () => window.document.querySelector('.dshgn_tplList') !== null,
    5000,
    '设置页里应该有模板列表',
  )
  await sleep(300)

  const rows = () => Array.from(window.document.querySelectorAll('.dshgn_tplRow'))
  const rowOf = (name) =>
    rows().find((row) => {
      const title = row.querySelector('.dshgn_tplName')
      return title !== null && (title.textContent || '').trim() === name
    }) || null
  const buttonIn = (row, label) =>
    Array.from(row.querySelectorAll('.dshgn_rowBtn')).find((el) => (el.textContent || '').trim() === label) || null

  const longRow = rowOf('周报骨架-验收')
  assert.ok(longRow !== null, '模板列表里应该有「周报骨架-验收」，实际 ' + rows().map((r) => r.textContent).join(' / '))

  // ① 摊开：摊出来的是整段，不是列表里那两行
  const openBtn = buttonIn(longRow, '看全文')
  assert.ok(openBtn !== null, '每一行都该有一颗「看全文」')
  assert.equal(openBtn.getAttribute('aria-expanded'), 'false')
  openBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

  const full = await waitFor(
    () => rowOf('周报骨架-验收').querySelector('.dshgn_tplFull'),
    4000,
    '点「看全文」之后应该摊出完整骨架',
  )
  const fullText = String(full.textContent || '')
  assert.match(fullText, /下一周/, '摊出来的得是整段，不是截断那两行：' + fullText)
  assert.match(fullText, /先做哪件/)
  assert.equal(
    buttonIn(rowOf('周报骨架-验收'), '收起').getAttribute('aria-expanded'),
    'true',
    '摊开之后那颗按钮要变成「收起」',
  )

  // ② 再点一下收起：回到两行预览
  buttonIn(rowOf('周报骨架-验收'), '收起').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => rowOf('周报骨架-验收').querySelector('.dshgn_tplFull') === null,
    4000,
    '再点一下应该收起',
  )
  assert.ok(buttonIn(rowOf('周报骨架-验收'), '看全文') !== null, '收起之后按钮要变回「看全文」')

  // ③ 只有标题的模板：明说它只有标题，不摊一个空框
  const emptyRow = rowOf('只有标题-验收')
  assert.ok(emptyRow !== null, '只有标题的模板也该在列表里')
  buttonIn(emptyRow, '看全文').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const emptyText = await waitFor(
    () => {
      const row = rowOf('只有标题-验收')
      const box = row === null ? null : row.querySelector('.dshgn_tplBody')
      return box !== null && (box.textContent || '').includes('只有标题') ? box.textContent : null
    },
    4000,
    '只有标题的模板要明说它只有标题',
  )
  assert.ok(!String(emptyText).includes('undefined'), '不该摊出 undefined')
  assert.equal(rowOf('只有标题-验收').querySelector('.dshgn_tplFull'), null, '空模板不摊空框')

  // 收尾：把验收用的模板删掉，后面的用例别被它们影响
  await post('/getnote/settings', { templates: [] })
  await clickTab('笔记')
})

test('搜完之后说一句扫了多少篇、对上多少篇，被条数上限截了也明说', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')

  const post = async (path, body) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const box = () => window.document.querySelector('.dshgn_search')
  const typeIn = async (text) => {
    setter.call(box(), text)
    box().dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }

  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = window.document.querySelector('.dshgn_noteBack')
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(200)
    }
  } finally {
    panel.setConfirmDialog(null)
  }
  await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  await typeIn('')

  const word = '扫描行验收词'
  await post('/getnote/create', {
    dir: '扫描行验收',
    title: '扫描行-甲',
    content: ['# 扫描行甲', '', '这一篇里写着' + word + '。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-search-scan-a',
  })

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(700)

  // ① 没到上限时：报「扫了多少篇、对上多少篇」，并说明没被截
  await typeIn(word)
  const line = await waitFor(() => {
    const el = window.document.querySelector('.dshgn_searchScan')
    return el !== null && /扫了 \d+ 篇，对上 \d+ 篇/.test(el.textContent || '') ? el : null
  }, 8000, '搜完之后报一句扫了多少篇')
  assert.equal(line.getAttribute('data-cut'), 'false', '没到上限时不该报被截')
  assert.ok(!(line.textContent || '').includes('条数上限'), '没被截时不说被截：' + line.textContent)
  const cards = window.document.querySelectorAll('.dshgn_card').length
  assert.ok(cards >= 1, '至少搜到刚种下的那一篇')
  const matched = Number((line.textContent || '').match(/对上 (\d+) 篇/)[1])
  assert.equal(matched, cards, '对上的篇数要和列表里的卡片数一致')
  const scanned = Number((line.textContent || '').match(/扫了 (\d+) 篇/)[1])
  assert.ok(scanned >= matched, '扫过的篇数不可能比对上的还少：' + line.textContent)

  // ② 超过面板一次要的 40 条时：明说停在条数上限，别让人以为库里就这四十篇
  const seedMany = []
  for (let i = 0; i < 41; i += 1) {
    seedMany.push(
      post('/getnote/create', {
        dir: '扫描行验收',
        title: '扫描行-' + String(i + 10),
        content: ['# 扫描行' + String(i + 10), '', '这一篇里也写着' + word + '。', ''].join('\n'),
        withDatePrefix: false,
        requestId: 'seed-search-scan-many-' + String(i),
      }),
    )
  }
  await Promise.all(seedMany)

  await typeIn('')
  await sleep(200)
  await typeIn(word)
  const cut = await waitFor(() => {
    const el = window.document.querySelector('.dshgn_searchScan')
    return el !== null && el.getAttribute('data-cut') === 'true' ? el : null
  }, 10000, '超过上限时要明说被截了')
  assert.ok((cut.textContent || '').includes('条数上限'), '被截时要写清停在条数上限：' + cut.textContent)

  await typeIn('')
  await clickTab('笔记')
})

test('批量里有几篇没成时，把那几篇和原因摊出来，而不是只报处理了几篇', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')

  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }

  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    setValue.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(260)
  }

  const pathA = '批量失败验收/批量失败-甲.md'
  const pathB = '批量失败验收/批量失败-乙.md'
  for (const [title, requestId] of [
    ['批量失败-甲', 'seed-batch-fail-a'],
    ['批量失败-乙', 'seed-batch-fail-b'],
  ]) {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir: '批量失败验收', title, content: '正文', withDatePrefix: false, requestId }),
    })
    assert.equal(res.status, 200, '建笔记要成功')
  }

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const rowOf = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })
  const dirRow = await waitFor(() => rowOf('批量失败验收'), 8000, '左栏里出现这个目录')
  dirRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const cardOf = (path) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === path) || null
  const cardA = await waitFor(() => cardOf(pathA), 8000, '第一篇')
  cardA.querySelector('.dshgn_pickBox').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(200)
  const cardB = await waitFor(() => cardOf(pathB), 8000, '第二篇')
  cardB.querySelector('.dshgn_pickBox').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_batchBar') !== null, 3000, '批量栏出现')

  // 让乙那一条在服务端失败：真去动磁盘太脆（还要赌文件被占用），
  // 直接在 /batch 的响应里挂一条 failed，考的是面板读不读这个字段。
  const wrapped = window.fetch
  window.fetch = globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input && input.url)
    const res = await wrapped(input, init)
    if (!url.includes('/getnote/batch')) return res
    // jsdom 里没有 Response，所以照 /status 那套壳的做法回一个带 json() 的普通对象。
    const json = await res.json()
    json.changed = 1
    json.failed = [{ path: pathB, error: '文件被别的程序占着' }]
    return { ok: true, status: 200, json: async () => json }
  }

  const toastText = () => ((window.document.querySelector('.dshgn_toast') || {}).textContent || '')
  try {
    const moreBtn = Array.from(window.document.querySelectorAll('.dshgn_batchBtn')).find(
      (el) => (el.textContent || '').trim() === '批量操作',
    )
    assert.ok(moreBtn, '批量条上应该有「批量操作」')
    moreBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

    const tagInput = await waitFor(
      () => window.document.querySelector('.dshgn_batchInput'),
      3000,
      '批量操作里应该有标签框',
    )
    setValue.call(tagInput, '批量失败标签')
    tagInput.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(200)

    const addBtn = Array.from(window.document.querySelectorAll('.dshgn_btn.dshgn_btnPrimary')).find(
      (el) => (el.textContent || '').trim() === '加标签',
    )
    assert.ok(addBtn, '应该有一颗「加标签」')
    addBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

    const fails = await waitFor(
      () => window.document.querySelector('.dshgn_batchFails'),
      5000,
      '没成的那几篇要摊出来',
    )
    const failText = fails.textContent || ''
    assert.ok(failText.includes('这几篇没处理成'), '要说清这是没成的清单，实际 ' + failText)
    assert.ok(failText.includes(pathB), '要点名是哪一篇没成，实际 ' + failText)
    assert.ok(failText.includes('文件被别的程序占着'), '要把原因一起写出来，实际 ' + failText)
    assert.equal(
      window.document.querySelectorAll('.dshgn_batchFailItem').length,
      1,
      '只失败一篇就只列一篇',
    )
    assert.ok(
      !failText.includes(pathA),
      '成了的那篇不该混进没成的清单，实际 ' + failText,
    )
    assert.ok(/有 1 篇没成/.test(toastText()), '提示条也要报出没成了几篇，实际 ' + toastText())

    const closeBtn = Array.from(fails.querySelectorAll('.dshgn_batchBtn')).find(
      (el) => (el.textContent || '').trim() === '知道了',
    )
    assert.ok(closeBtn, '清单旁边要有一颗「知道了」')
    closeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(
      () => window.document.querySelector('.dshgn_batchFails') === null,
      3000,
      '点「知道了」之后清单收起来',
    )
  } finally {
    window.fetch = globalThis.fetch = wrapped
    await clickTab('笔记')
  }
})
test('勾了一张之后按住 Shift 再点一张，就把这一摊连着勾上，再点一次整段取消', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')

  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }

  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    setValue.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(260)
  }

  // 四篇：够验「中间那几张一起勾上」，又不会让列表滚动出视口。
  for (let i = 1; i <= 4; i += 1) {
    const res = await realFetch(server.origin + '/getnote/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({
        dir: '连选验收',
        title: '连选-' + String(i),
        content: '正文',
        withDatePrefix: false,
        requestId: 'seed-shift-pick-' + String(i),
      }),
    })
    assert.equal(res.status, 200, '建笔记要成功')
  }

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const rowOf = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })
  const dirRow = await waitFor(() => rowOf('连选验收'), 8000, '左栏里出现这个目录')
  dirRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const cards = () => Array.from(window.document.querySelectorAll('.dshgn_card'))
  await waitFor(() => cards().length === 4, 8000, '这一摊正好四张卡片')
  // 顺序按修改时间倒序，四篇同一秒建出来谁前谁后不可预测——所以不押名字，
  // 只按屏幕上真实的顺序取第 1 / 3 / 4 张来验。
  const list = cards()
  const pickedOf = (card) => {
    const box = card.querySelector('.dshgn_pickBox')
    return box !== null && box.getAttribute('aria-checked') === 'true'
  }
  const pickedCount = () => list.filter((card) => pickedOf(card)).length
  const clickBox = (card, shift) =>
    card
      .querySelector('.dshgn_pickBox')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: shift === true }))

  // 提示先说明怎么连选，勾过之后改口成「按住 Shift 点另一张」。
  assert.equal(
    list[0].querySelector('.dshgn_pickBox').getAttribute('title'),
    '按住 Shift 再点一张，连着把这一摊都勾上',
    '还没勾过时要教一次怎么连选',
  )

  clickBox(list[0], false)
  await sleep(200)
  assert.equal(pickedCount(), 1, '普通点一下只勾这一张')
  assert.equal(
    list[1].querySelector('.dshgn_pickBox').getAttribute('title'),
    '按住 Shift 点另一张，连着勾一段',
    '勾过之后提示要改口',
  )

  clickBox(list[2], true)
  await sleep(250)
  assert.equal(pickedCount(), 3, 'Shift 点第三张要把前两张一起带上')
  assert.ok(pickedOf(list[0]) && pickedOf(list[1]) && pickedOf(list[2]), '这一段三张都该是勾着的')
  assert.ok(!pickedOf(list[3]), '这一段之外的那张不该被顺手勾进来')

  // 再 Shift 点同一张：整段本来就全勾着，那这一下就是整段取消。
  clickBox(list[2], true)
  await sleep(250)
  assert.equal(pickedCount(), 0, '再点一次要把整段一起取消')

  // 普通点一张会重新定起点：先点第四张，再 Shift 点第二张，中间的都要勾上。
  clickBox(list[3], false)
  await sleep(200)
  assert.equal(pickedCount(), 1, '重新点一下只勾这一张')
  clickBox(list[1], true)
  await sleep(250)
  assert.equal(pickedCount(), 3, '反着连选也要把中间那段勾上')
  assert.ok(pickedOf(list[1]) && pickedOf(list[2]) && pickedOf(list[3]), '反着选的这一段三张都该勾着')
  assert.ok(!pickedOf(list[0]), '反着选时第四张之外的那张不该被勾上')

  const clearBtn = Array.from(window.document.querySelectorAll('.dshgn_batchBtn')).find(
    (el) => (el.textContent || '').trim() === '取消选择',
  )
  if (clearBtn) clearBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await clickTab('笔记')
})

test('搜的时候把这次按什么在筛摆出来，点掉一颗就少一个限定词', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const post = async (path, body) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = window.document.querySelector('.dshgn_noteBack')
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }

  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const box = () => window.document.querySelector('.dshgn_search')
  const typeIn = async (text) => {
    setter.call(box(), text)
    box().dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(420)
  }
  const chips = () => Array.from(window.document.querySelectorAll('.dshgn_queryBit'))
  const chipOf = (kind, value) =>
    chips().find((el) => el.getAttribute('data-kind') === kind && (el.textContent || '').includes(value)) || null

  await typeIn('')
  await post('/getnote/create', {
    dir: '搜索胶囊验收',
    title: '搜索胶囊-甲',
    content: ['# 搜索胶囊甲', '', '这一篇里写着搜索胶囊验收词。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-query-bit-a',
  })
  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(700)

  // ① 一串限定词摆成几颗胶囊，各带各的类别
  await typeIn('tag:搜索胶囊标签 dir:搜索胶囊验收 搜索胶囊验收词 -不要这个词')
  const wrap = await waitFor(
    () => (chips().length > 0 ? window.document.querySelector('.dshgn_queryBits') : null),
    8000,
    '按什么在筛那一排要摆出来',
  )
  assert.ok((wrap.textContent || '').includes('这次按这些筛'), '要有一句说明这排是什么：' + wrap.textContent)
  assert.equal(chips().length, 4, '四段各摆一颗：' + chips().map((el) => el.textContent).join(' / '))
  assert.ok(chipOf('tag', '搜索胶囊标签') !== null, 'tag: 那颗要认出来')
  assert.ok(chipOf('dir', '搜索胶囊验收') !== null, 'dir: 那颗要认出来')
  assert.ok(chipOf('term', '搜索胶囊验收词') !== null, '正文词那颗要认出来')
  const notChip = chipOf('not', '不要这个词')
  assert.ok(notChip !== null, '排除词那颗要认出来，而且要标成 not')
  assert.ok((notChip.title || '').length > 0, '每颗都要有悬停说明')

  // ② 点掉一颗，搜索框里那一段就没了，别的段原样留着
  notChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(420)
  assert.ok(!(box().value || '').includes('不要这个词'), '点掉之后排除词要真的从框里删掉：' + box().value)
  assert.ok((box().value || '').includes('tag:搜索胶囊标签'), '别的段不能被顺手删掉：' + box().value)
  assert.ok((box().value || '').includes('dir:搜索胶囊验收'), '别的段不能被顺手删掉：' + box().value)
  assert.equal(chips().length, 3, '点掉一颗之后就只剩三颗')

  // ③ 限定词那颗点掉，正文词还在，卡片也跟着回来
  const dirChip = chipOf('dir', '搜索胶囊验收')
  assert.ok(dirChip !== null, '点掉一颗之后 dir 那颗还该在')
  dirChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(500)
  assert.ok(!(box().value || '').includes('dir:'), '点掉 dir 之后框里不该再有 dir:：' + box().value)
  assert.ok((box().value || '').includes('搜索胶囊验收词'), '正文词要留着：' + box().value)

  // ④ 全清掉框里就没词了，那一排跟着收起来
  await typeIn('')
  assert.equal(chips().length, 0, '空搜索时不该摆这一排')
  assert.equal(window.document.querySelector('.dshgn_queryBits'), null, '空搜索时那一排要收起来')

  await clickTab('笔记')
})


test('删一篇之前先问一句「还有谁提到它」，断链长在别人正文里看不见', async () => {
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
  const targetPath = '删除反查验收/删除反查-被提到的那一篇.md'
  const referrerPath = '删除反查验收/删除反查-提到它的那一篇.md'
  await post('/getnote/create', {
    dir: '删除反查验收',
    title: '删除反查-被提到的那一篇',
    content: ['# 删除反查-被提到的那一篇', '', '这一篇被别人引用了。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-del-link-a',
  })
  await post('/getnote/create', {
    dir: '删除反查验收',
    title: '删除反查-提到它的那一篇',
    content: ['# 删除反查-提到它的那一篇', '', '这里提了一句 [[删除反查-被提到的那一篇]]。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-del-link-b',
  })

  // 退回空态，免得带着上一篇的阅读态进来
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }

  const searchBox = () => window.document.querySelector('.dshgn_search')
  const clearSearch = async () => {
    const box = searchBox()
    if (box && String(box.value || '') !== '') {
      box.value = ''
      box.dispatchEvent(new window.Event('input', { bubbles: true }))
      await sleep(400)
    }
  }
  await clearSearch()
  const allRow = Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
    const name = el.querySelector('.dshgn_treeName')
    return name !== null && (name.textContent || '').trim() === '全部笔记'
  })
  if (allRow) allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(700)

  // 打开「被提到的那一篇」，再按笔记头那颗删除
  const cardOf = (title) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => {
      const label = el.querySelector('.dshgn_cardTitle')
      return label !== null && (label.textContent || '').trim() === title
    })
  await waitFor(() => cardOf('删除反查-被提到的那一篇') !== undefined, 8000, '列表里出现被提到的那一篇')
  cardOf('删除反查-被提到的那一篇').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(
    () => {
      const box = window.document.querySelector('.dshgn_note')
      return box !== null && (box.textContent || '').includes('这一篇被别人引用了')
    },
    8000,
    '打开被提到的那一篇',
  )

  // 只在笔记头里找：左栏、别的地方也可能有同名的按钮，全局找会抓错一颗。
  const deleteBtn = () => {
    const head = window.document.querySelector('.dshgn_noteHead')
    if (head === null) return undefined
    return Array.from(head.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '删除')
  }
  assert.ok(deleteBtn() !== undefined, '笔记头上该有删除那颗按钮')

  const asked = []
  panel.setConfirmDialog((message, options) => {
    asked.push({ message, options })
    // 先选「先不删」：这时候一篇都不该少
    return Promise.resolve(false)
  })
  try {
    // 刚打开那一篇时 busy 还是 true，删除那颗按钮是 disabled 的，点下去什么都不发生。
    // 等它可点了再按，并且连按几次——反查要读全库，慢的时候一次点击可能还没轮到。
    await waitFor(
      () => {
        const btn = deleteBtn()
        return btn !== undefined && btn.disabled !== true
      },
      8000,
      '删除那颗按钮可点',
    )
    // 只按一次：连按会让后一次把前一次的反查 abort 掉，反而问不出来。
    deleteBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => asked.length > 0, 10000, '删除前应该先问一句「还有谁提到它」')
  } finally {
    panel.setConfirmDialog(null)
  }

  const first = asked[0]
  assert.ok(
    String(first.message).includes('篇提到了这一篇'),
    '问的话要说清有谁提到了它：' + first.message,
  )
  assert.ok(
    String(first.message).includes('删除反查-提到它的那一篇'),
    '要把提到它的篇名点出来：' + first.message,
  )
  assert.equal(first.options && first.options.confirmText, '还是要删', '确认那颗写「还是要删」')
  assert.equal(first.options && first.options.cancelText, '先不删', '取消那颗写「先不删」')

  // 选了「先不删」：这一篇还在，正文读得回来
  await sleep(600)
  const stillThere = await realFetch(
    server.origin + '/getnote/read?path=' + encodeURIComponent(targetPath),
    { headers: { 'x-getnote-token': server.token } },
  )
  assert.equal(stillThere.status, 200, '选了「先不删」之后这一篇不该被删掉')

  // 再来一次，这回选「还是要删」
  panel.setConfirmDialog(() => Promise.resolve(true))
  try {
    deleteBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(
      () => rootNode().getAttribute('data-has-note') === 'false',
      8000,
      '确认之后这一篇该被删进回收站',
    )
  } finally {
    panel.setConfirmDialog(null)
  }
  // 删除是异步落盘的（先快照再挪进 .trash），读到 404 之前多等一会儿。
  const readStatus = async () => {
    const res = await realFetch(
      server.origin + '/getnote/read?path=' + encodeURIComponent(targetPath),
      { headers: { 'x-getnote-token': server.token } },
    )
    return res.status
  }
  let goneStatus = 200
  for (let i = 0; i < 20; i += 1) {
    goneStatus = await readStatus()
    if (goneStatus !== 200) break
    await sleep(300)
  }
  assert.notEqual(goneStatus, 200, '确认删除之后这一篇就读不回来了（实际 ' + goneStatus + '）')
  // 读不到还不够：要确认它确实进了回收站，而不是被弄丢了。
  const trashRes = await realFetch(server.origin + '/getnote/trash/list', {
    headers: { 'x-getnote-token': server.token },
  })
  const trash = await trashRes.json()
  const inTrash = (trash.items || []).some(
    (item) => String(item.originalName || '') === '删除反查-被提到的那一篇.md',
  )
  assert.ok(inTrash, '删掉的那一篇应该在回收站里：' + JSON.stringify((trash.items || []).map((one) => one.originalName)))
  // 提到它的那一篇原样留着——删的是被提到的那一篇
  const referrer = await realFetch(
    server.origin + '/getnote/read?path=' + encodeURIComponent(referrerPath),
    { headers: { 'x-getnote-token': server.token } },
  )
  assert.equal(referrer.status, 200, '提到它的那一篇不该被牵连')

  await clickTab('笔记')
})

test('批量删之前也先反查一句「这几篇里谁被人提到过」，别把别人的链接删成死链', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backBtn = () => window.document.querySelector('.dshgn_noteBack')

  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }

  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const searchBox = window.document.querySelector('.dshgn_search')
  if (searchBox !== null) {
    setValue.call(searchBox, '')
    searchBox.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(260)
  }

  const post = async (path, body) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res
  }
  const pathA = '批量删反查验收/批量删反查-被提到的那一篇.md'
  const pathC = '批量删反查验收/批量删反查-没人提的那一篇.md'
  await post('/getnote/create', {
    dir: '批量删反查验收',
    title: '批量删反查-被提到的那一篇',
    content: ['# 批量删反查-被提到的那一篇', '', '这一篇在别人正文里被引用了。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-batch-del-link-a',
  })
  await post('/getnote/create', {
    dir: '批量删反查验收',
    title: '批量删反查-没人提的那一篇',
    content: ['# 批量删反查-没人提的那一篇', '', '这一篇没人引用。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-batch-del-link-c',
  })
  await post('/getnote/create', {
    dir: '批量删反查验收',
    title: '批量删反查-提到它的那一篇',
    content: ['# 批量删反查-提到它的那一篇', '', '这里提了一句 [[批量删反查-被提到的那一篇]]。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-batch-del-link-b',
  })

  await clickTab('笔记')
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(600)

  const rowOf = (name) =>
    Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })
  const dirRow = await waitFor(() => rowOf('批量删反查验收'), 8000, '左栏里出现这个目录')
  dirRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(400)

  const cardOf = (path) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => el.getAttribute('title') === path) || null
  const cardA = await waitFor(() => cardOf(pathA), 8000, '被提到的那一篇')
  cardA.querySelector('.dshgn_pickBox').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(200)
  const cardC = await waitFor(() => cardOf(pathC), 8000, '没人提的那一篇')
  cardC.querySelector('.dshgn_pickBox').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_batchBar') !== null, 3000, '批量栏出现')

  // 「移到回收站」那颗在「批量操作」摊开的那个小面板里，得先把它摊开。
  const moreBtn = Array.from(window.document.querySelectorAll('.dshgn_batchBtn')).find(
    (el) => (el.textContent || '').trim() === '批量操作',
  )
  assert.ok(moreBtn, '批量条上应该有「批量操作」')
  moreBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)

  const deleteBtn = () => {
    const bar = window.document.querySelector('.dshgn_batchBar')
    if (bar === null) return undefined
    return Array.from(bar.querySelectorAll('.dshgn_btn')).find(
      (el) => (el.textContent || '').trim() === '移到回收站' && el.classList.contains('dshgn_btnDanger'),
    )
  }
  assert.ok(deleteBtn() !== undefined, '批量操作里该有「移到回收站」')

  const asked = []
  panel.setConfirmDialog((message, options) => {
    asked.push({ message, options })
    // 先选「先不删」：这时候两篇都该原样留着
    return Promise.resolve(false)
  })
  try {
    deleteBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => asked.length > 0, 12000, '批量删之前应该先问一句「谁被人提到过」')
  } finally {
    panel.setConfirmDialog(null)
  }

  const first = asked[0]
  assert.ok(
    String(first.message).includes('被人提到过'),
    '问的话要说清这几篇里有人被引用：' + first.message,
  )
  assert.ok(
    String(first.message).includes('批量删反查-被提到的那一篇'),
    '要把被引用的那篇点出来：' + first.message,
  )
  assert.ok(
    String(first.message).includes('1 篇被人提到过'),
    '两篇里只有一篇被引用，别把没人提的那篇也算进去：' + first.message,
  )
  assert.equal(first.options && first.options.confirmText, '还是要删', '确认那颗写「还是要删」')
  assert.equal(first.options && first.options.cancelText, '先不删', '取消那颗写「先不删」')

  // 选了「先不删」：两篇都还在
  await sleep(600)
  for (const path of [pathA, pathC]) {
    const still = await realFetch(
      server.origin + '/getnote/read?path=' + encodeURIComponent(path),
      { headers: { 'x-getnote-token': server.token } },
    )
    assert.equal(still.status, 200, '选了「先不删」，这一篇该原样留着：' + path)
  }

  // 再选「还是要删」：这次真删
  panel.setConfirmDialog(async () => true)
  try {
    const btn = deleteBtn()
    assert.ok(btn !== undefined, '批量条还该在（没删成就没清勾选）')
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(
      async () => {
        const res = await realFetch(
          server.origin + '/getnote/read?path=' + encodeURIComponent(pathA),
          { headers: { 'x-getnote-token': server.token } },
        )
        return res.status !== 200
      },
      12000,
      '选了「还是要删」之后这一篇才真的没了',
    )
  } finally {
    panel.setConfirmDialog(null)
  }
  // 逐篇删是串行的，前一篇还没删完时后一篇当然还在——轮询等它，别抢跑。
  await waitFor(
    async () => {
      const gone = await realFetch(
        server.origin + '/getnote/read?path=' + encodeURIComponent(pathC),
        { headers: { 'x-getnote-token': server.token } },
      )
      return gone.status !== 200
    },
    12000,
    '没人提的那一篇也该一起删掉',
  )
  await clickTab('笔记')
})

test('字号是这一篇的事：调大了这篇，换一篇还是原来那档，回来还是大的', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')
  await clickTab('笔记')

  // 每篇字号是上一批才有的，先把本机记着的那份清掉，免得上一次跑剩下的影响判断
  try {
    window.localStorage.removeItem('dshgn.noteScale')
  } catch {
    // 隐私模式：本来就没记住，不用管
  }

  const post = async (path, body) => {
    const res = await realFetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res.json()
  }
  const smallPath = '字号按篇验收/字号按篇-小字那篇.md'
  const plainPath = '字号按篇验收/字号按篇-普通那篇.md'
  await post('/getnote/create', {
    dir: '字号按篇验收',
    title: '字号按篇-小字那篇',
    content: ['# 字号按篇-小字那篇', '', '这一篇字本来就小，得调大才看得清。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-note-scale-a',
  })
  await post('/getnote/create', {
    dir: '字号按篇验收',
    title: '字号按篇-普通那篇',
    content: ['# 字号按篇-普通那篇', '', '这一篇按默认那档就合适。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-note-scale-b',
  })

  const backBtn = () => window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }

  const searchBox = () => window.document.querySelector('.dshgn_search')
  const box = searchBox()
  if (box && String(box.value || '') !== '') {
    box.value = ''
    box.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }
  const allRow = Array.from(window.document.querySelectorAll('.dshgn_treeRow')).find((el) => {
    const name = el.querySelector('.dshgn_treeName')
    return name !== null && (name.textContent || '').trim() === '全部笔记'
  })
  if (allRow) allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(700)

  const cardOf = (title) =>
    Array.from(window.document.querySelectorAll('.dshgn_card')).find((el) => {
      const label = el.querySelector('.dshgn_cardTitle')
      return label !== null && (label.textContent || '').trim() === title
    })
  const openByTitle = async (title) => {
    await waitFor(() => cardOf(title) !== undefined, 8000, '列表里出现：' + title)
    cardOf(title).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(
      () => {
        const area = window.document.querySelector('.dshgn_note')
        return area !== null && (area.textContent || '').includes(title)
      },
      8000,
      '打开：' + title,
    )
  }
  // 正文挂的档位：'' = 标准，'S' = 小，'L' = 大
  const scaleOfBody = () => {
    const md = window.document.querySelector('.dshgn_md')
    if (md === null) return 'none'
    if (md.classList.contains('dshgn_mdS')) return 'S'
    if (md.classList.contains('dshgn_mdL')) return 'L'
    return ''
  }
  const scaleBtn = (size) => {
    const group = window.document.querySelector('.dshgn_scaleGroup')
    if (group === null) return undefined
    const list = Array.from(group.querySelectorAll('.dshgn_scaleBtn'))
    // 三颗按钮的次序固定是 小 / 标准 / 大
    return list[{ s: 0, m: 1, l: 2 }[size]]
  }

  await openByTitle('字号按篇-小字那篇')
  assert.equal(scaleOfBody(), '', '第一次打开应该是标准那档')

  // 调成「大字」：只有这一篇该变大
  const big = scaleBtn('l')
  assert.ok(big !== undefined, '笔记头上该有三档字号')
  big.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => scaleOfBody() === 'L', 5000, '这一篇应该变成大字')
  assert.equal(
    scaleBtn('l').getAttribute('aria-pressed'),
    'true',
    '选中的那一档要标出来',
  )

  // 换到另一篇：它没被单独调过，应该还是标准那档
  await openByTitle('字号按篇-普通那篇')
  assert.equal(scaleOfBody(), '', '换一篇不该跟着变大')
  assert.equal(scaleBtn('m').getAttribute('aria-pressed'), 'true', '另一篇标的是标准那档')

  // 回到刚才那篇：它自己那一档还在
  await openByTitle('字号按篇-小字那篇')
  assert.equal(scaleOfBody(), 'L', '回到这一篇应该还是大字')
  assert.equal(scaleBtn('l').getAttribute('aria-pressed'), 'true', '回来时标的是大字那档')

  // 调回标准 = 跟「没单独调过」一样，那笔记录该被抹掉，不再占地方
  scaleBtn('m').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => scaleOfBody() === '', 5000, '调回标准')
  const kept = String(window.localStorage.getItem('dshgn.noteScale') || '')
  assert.ok(
    !kept.includes('字号按篇-小字那篇'),
    '调回标准之后不该再记着这一篇：' + kept,
  )
})

test('空态里那颗「写一篇新的」是真的能点，不是只指着顶栏那颗「+」', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  await waitFor(() => rootNode() !== null, 5000, '根节点渲染')
  await clickTab('笔记')

  const backBtn = () => window.document.querySelector('.dshgn_noteBack')
  panel.setConfirmDialog(async () => true)
  try {
    for (let i = 0; i < 4; i += 1) {
      const back = backBtn()
      if (!back) break
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await sleep(220)
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回空态')
  } finally {
    panel.setConfirmDialog(null)
  }

  const emptyBtn = () => window.document.querySelector('.dshgn_emptyBtn')
  await waitFor(() => emptyBtn() !== null, 5000, '空态里该有一颗「写一篇新的」')
  assert.ok(
    (emptyBtn().textContent || '').includes('写一篇新的'),
    '按钮上要说清是干什么的：' + (emptyBtn().textContent || ''),
  )

  const before = window.document.querySelectorAll('.dshgn_card').length
  emptyBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  // 建完会当场打开那一篇：空态退场、正文区出现编辑入口
  await waitFor(
    () => rootNode().getAttribute('data-has-note') === 'true',
    10000,
    '点完之后该建出一篇并打开',
  )
  assert.equal(
    window.document.querySelector('.dshgn_emptyBtn'),
    null,
    '打开一篇之后空态就该退场了',
  )
  assert.ok(before >= 0, '列表里卡片数量不为负（只是占位断言，避免未使用变量）')
})

test('目录里有笔记时，删目录那颗能连笔记一起删——笔记进回收站，不是真没', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backToList = async () => {
    const back = rootNode().querySelector('.dshgn_noteBack')
    if (back !== null) {
      panel.setConfirmDialog(() => Promise.resolve(true))
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回列表')
  }
  await backToList()
  clickTab('笔记')
  await waitFor(() => rootNode().querySelector('.dshgn_search') !== null, 4000, '笔记页签里有搜索框')
  const search = rootNode().querySelector('.dshgn_search')
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, '')
  search.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(400)

  const make = async (dir, title, content, requestId) => {
    const res = await realFetch(`${server.origin}/getnote/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir, title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    return json.path
  }
  const a = await make('删目录验收', '删目录验收-甲', '# 删目录验收-甲\n\n正文。\n', 'seed-dir-rm-a')
  const b = await make('删目录验收', '删目录验收-乙', '# 删目录验收-乙\n\n正文。\n', 'seed-dir-rm-b')

  const rowOf = (name) =>
    Array.from(rootNode().querySelectorAll('.dshgn_treeRow')).find((el) => {
      const label = el.querySelector('.dshgn_treeName')
      return label !== null && (label.textContent || '').trim() === name
    })
  const refreshBtn = () =>
    Array.from(window.document.querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => rowOf('删目录验收') !== undefined, 8000, '左栏里出现新目录')

  rowOf('删目录验收').dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  const deleteBtn = await waitFor(() => {
    const menu = rootNode().querySelector('.dshgn_rowMenu')
    if (menu === null) return null
    const hit = Array.from(menu.querySelectorAll('.dshgn_rowBtn')).find((btn) => btn.title === '删除目录')
    return hit === undefined ? null : hit
  }, 4000, '目录行右键里应该有「删除目录」')
  deleteBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

  // 确认框会先去数一遍这个目录里有多少篇，数完才给「连里面的 N 篇一起删」
  const modal = await waitFor(() => rootNode().querySelector('.dshgn_modal'), 4000, '确认框出现')
  const recursive = await waitFor(
    () => modal.querySelector('button[data-recursive="true"]'),
    8000,
    '非空目录该多一颗「连里面的 N 篇一起删」',
  )
  assert.ok(
    (recursive.textContent || '').includes('2'),
    '按钮上要说清是几篇：' + (recursive.textContent || ''),
  )
  const bodyText = String((modal.querySelector('.dshgn_modalBody') || {}).textContent || '')
  assert.ok(bodyText.includes('不是空的'), '正文要说明这个目录不是空的：' + bodyText)
  assert.ok(bodyText.includes('2'), '正文里也要报数：' + bodyText)
  // 旁边那颗「删除」在目录非空时该是灰的——按了也只会 409
  const plain = Array.from(modal.querySelectorAll('.dshgn_modalActions button')).find(
    (btn) => (btn.textContent || '').trim() === '删除',
  )
  assert.ok(plain !== undefined, '确认框里该有「删除」')
  assert.equal(plain.disabled, true, '目录非空时那颗「删除」该置灰')

  recursive.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

  // 目录没了
  await waitFor(() => rowOf('删目录验收') === undefined, 10000, '目录该从左栏消失')
  // 笔记没真没：两篇都进了回收站
  const trash = await realFetch(`${server.origin}/getnote/trash/list`, {
    headers: { 'x-getnote-token': server.token },
  })
  const trashJson = await trash.json()
  const names = (trashJson.items || []).map((one) => String(one.originalName || ''))
  assert.ok(names.includes('删目录验收-甲.md'), '甲该在回收站里：' + names.join('、'))
  assert.ok(names.includes('删目录验收-乙.md'), '乙该在回收站里：' + names.join('、'))
  // 原路径已经读不到了
  const still = await realFetch(
    `${server.origin}/getnote/read?path=${encodeURIComponent(a)}`,
    { headers: { 'x-getnote-token': server.token } },
  )
  assert.notEqual(still.status, 200, '删完原路径不该还能读到')
  assert.ok(b !== '', '乙的路径不该为空（占位，避免未使用变量）')
})

test('回收站里能勾几个一起恢复，也能一起永久删掉——放回哪个目录只说一次', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const backToList = async () => {
    const back = rootNode().querySelector('.dshgn_noteBack')
    if (back !== null) {
      panel.setConfirmDialog(() => Promise.resolve(true))
      back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    }
    await waitFor(() => rootNode().getAttribute('data-has-note') === 'false', 5000, '退回列表')
  }
  await backToList()
  await clickTab('笔记')
  await waitFor(() => rootNode().querySelector('.dshgn_search') !== null, 4000, '笔记页签里有搜索框')
  const search = rootNode().querySelector('.dshgn_search')
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, '')
  search.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(400)

  const make = async (dir, title, content, requestId) => {
    const res = await realFetch(`${server.origin}/getnote/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ dir, title, content, withDatePrefix: false, requestId }),
    })
    const json = await res.json()
    return json.path
  }
  const dir = '回收站批量验收'
  const paths = []
  paths.push(await make(dir, '回收站批量-甲', '# 回收站批量-甲\n\n正文。\n', 'seed-trash-pick-a'))
  paths.push(await make(dir, '回收站批量-乙', '# 回收站批量-乙\n\n正文。\n', 'seed-trash-pick-b'))
  paths.push(await make(dir, '回收站批量-丙', '# 回收站批量-丙\n\n正文。\n', 'seed-trash-pick-c'))

  // 先把三篇都删进回收站：走真接口，不走界面，免得再依赖一遍删除流程
  for (const one of paths) {
    await realFetch(`${server.origin}/getnote/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify({ path: one }),
    })
  }

  await clickTab('回收站')
  // 回收站里还留着别的用例删进去的东西，一律按标题认自己那三行。
  const pickOfTitle = (want) => {
    const rows = Array.from(rootNode().querySelectorAll('.dshgn_rowLine'))
    for (const row of rows) {
      const title = row.querySelector('.dshgn_cardTitle')
      if (title === null) continue
      if ((title.textContent || '').trim() !== want) continue
      return row.querySelector('.dshgn_trashPick')
    }
    return null
  }
  await waitFor(() => pickOfTitle('回收站批量-甲') !== null && pickOfTitle('回收站批量-丙') !== null, 8000, '回收站里该摆出我们那几行的勾选框')
  // 一开始一颗都不该勾着，批量条也不该出现
  assert.equal(
    ['回收站批量-甲', '回收站批量-乙', '回收站批量-丙']
      .map((name) => pickOfTitle(name))
      .filter((one) => one !== null && one.getAttribute('aria-checked') === 'true').length,
    0,
    '刚进来时不该有勾着的',
  )
  assert.equal(
    rootNode().querySelector('.dshgn_batchBar'),
    null,
    '一个都没勾时不摆批量条',
  )

  // 勾前两个，然后「恢复这几个」——目录只填一次
  pickOfTitle('回收站批量-甲').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  pickOfTitle('回收站批量-乙').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const bar = await waitFor(() => rootNode().querySelector('.dshgn_batchBar'), 4000, '勾了两个之后该出现批量条')
  const countText = String((bar.querySelector('.dshgn_batchCount') || {}).textContent || '')
  assert.ok(countText.includes('2'), '批量条上要报出勾了几个：' + countText)

  const targetInput = rootNode().querySelector('.dshgn_trashTarget input')
  assert.ok(targetInput !== null, '回收站里该有「恢复到哪个目录」那一行')
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(targetInput, dir)
  targetInput.dispatchEvent(new window.Event('input', { bubbles: true }))
  await sleep(300)

  const restoreBtn = Array.from(bar.querySelectorAll('.dshgn_btn')).find(
    (btn) => (btn.textContent || '').includes('恢复这几个'),
  )
  assert.ok(restoreBtn !== undefined, '批量条上该有「恢复这几个」')
  restoreBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

  // 两篇回到库里：原路径读得回来
  const readStatus = async (rel) => {
    const res = await realFetch(
      server.origin + '/getnote/read?path=' + encodeURIComponent(rel),
      { headers: { 'x-getnote-token': server.token } },
    )
    return res.status
  }
  const backBoth = async () => {
    const a = await readStatus(paths[0])
    const b = await readStatus(paths[1])
    return a === 200 && b === 200
  }
  await waitFor(backBoth, 10000, '勾着的那两篇该被恢复到原来那个目录')
  // 回收站里还留着别的用例删进去的东西，所以只按名字查我们自己这三篇。
  const trashNamesOf = async () => {
    const res = await realFetch(server.origin + '/getnote/trash/list', {
      headers: { 'x-getnote-token': server.token },
    })
    const items = (await res.json()).items || []
    return items.map((one) => String(one.originalName || ''))
  }
  let names = await trashNamesOf()
  for (let i = 0; i < 40; i += 1) {
    names = await trashNamesOf()
    if (!names.includes('回收站批量-甲.md') && !names.includes('回收站批量-乙.md')) break
    await sleep(250)
  }
  assert.ok(!names.includes('回收站批量-甲.md'), '勾着的甲该已经离开回收站：' + JSON.stringify(names))
  assert.ok(!names.includes('回收站批量-乙.md'), '勾着的乙该已经离开回收站：' + JSON.stringify(names))
  assert.ok(names.includes('回收站批量-丙.md'), '没勾的丙该还在回收站里：' + JSON.stringify(names))
  // 恢复完之后勾选清空、批量条收起来
  await waitFor(() => rootNode().querySelector('.dshgn_batchBar') === null, 5000, '恢复完批量条该收起来')

  // 再把剩下的那篇勾上，一起永久删掉：要问一句，问完真没了
  const asked = []
  panel.setConfirmDialog(async (message) => {
    asked.push(String(message))
    return true
  })
  try {
    const pickC = await waitFor(() => pickOfTitle('回收站批量-丙'), 8000, '回收站里该还有丙那一行')
    pickC.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    const bar2 = await waitFor(() => rootNode().querySelector('.dshgn_batchBar'), 4000, '勾一个也该出现批量条')
    const purgeBtn = Array.from(bar2.querySelectorAll('.dshgn_btn')).find(
      (btn) => (btn.textContent || '').includes('永久删除这几个'),
    )
    assert.ok(purgeBtn !== undefined, '批量条上该有「永久删除这几个」')
    purgeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => asked.length > 0, 8000, '永久删之前该问一句')
  } finally {
    panel.setConfirmDialog(null)
  }
  assert.ok(
    asked[0].includes('无法撤销'),
    '问的话要说清这是不可撤销的：' + asked[0],
  )
  // waitFor 只认同步条件，这里自己轮询：回收站里还留着别的用例删进去的东西，
  // 所以不能断言「空了」，只能断言「我们这几篇没了」。
  const trashNames = async () => {
    const res = await realFetch(server.origin + '/getnote/trash/list', {
      headers: { 'x-getnote-token': server.token },
    })
    const items = (await res.json()).items || []
    return items.map((one) => String(one.originalName || ''))
  }
  let leftNames = await trashNames()
  for (let i = 0; i < 40; i += 1) {
    leftNames = await trashNames()
    if (!leftNames.includes('回收站批量-丙.md')) break
    await sleep(250)
  }
  assert.ok(
    !leftNames.includes('回收站批量-丙.md'),
    '永久删掉之后这一篇不该还在回收站里：' + JSON.stringify(leftNames),
  )

  await clickTab('笔记')
})

test('断链那一组能改指到已有的那一篇，全库一起改过去而不是补一篇同名的空笔记', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const post = async (path, body) => {
    const res = await fetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(body),
    })
    return res
  }
  const wrong = '断链改名-写错的名字'
  const right = '断链改名-对的那一篇'
  await post('/getnote/create', {
    dir: '断链改名验收',
    title: '断链改名-引用它的那一篇',
    content: ['# 断链改名-引用它的那一篇', '', '见 [[' + wrong + ']] 与 [[' + wrong + '#小节]]。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-link-retarget-a',
  })
  await post('/getnote/create', {
    dir: '断链改名验收',
    title: right,
    content: ['# ' + right, '', '这一篇才是本来想指的那篇。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-link-retarget-b',
  })

  // 前面的用例留着搜索词和目录筛选，先退回「全部笔记」再刷新，新种的两篇才在列表里。
  const back = rootNode().querySelector('.dshgn_noteBack')
  if (back !== null) {
    panel.setConfirmDialog(() => Promise.resolve(true))
    back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(400)
  }
  const search = rootNode().querySelector('.dshgn_search')
  if (search !== null && String(search.value || '') !== '') {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, '')
    search.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }
  const allRow = Array.from(rootNode().querySelectorAll('.dshgn_treeRow')).find((el) => {
    const name = el.querySelector('.dshgn_treeName')
    return name !== null && (name.textContent || '').trim() === '全部笔记'
  })
  if (allRow) allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)
  const refreshBtn = Array.from(rootNode().querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(800)

  await clickTab('断链')
  const groupOf = () =>
    Array.from(rootNode().querySelectorAll('.dshgn_brokenGroup')).find((el) => {
      const name = el.querySelector('.dshgn_brokenGroupName')
      return name !== null && String(name.textContent || '') === wrong
    }) || null
  const head = await waitFor(groupOf, 10000, '断链页里该有写错的那个名字一组')
  const btns = Array.from(head.querySelectorAll('.dshgn_brokenGroupAll'))
  const retargetBtn = btns.find((el) => String(el.textContent || '').includes('改指到已有的那篇'))
  assert.ok(retargetBtn !== undefined, '组头该有一颗「改指到已有的那篇」：' + btns.map((b) => b.textContent).join('|'))
  retargetBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const input = await waitFor(() => rootNode().querySelector('.dshgn_brokenRetargetInput'), 4000, '点开该摊出一行输入框')
  // 候选名单来自库里已有的文件名：改错字时多半是改成另一篇的名字，不该逼人凭记忆敲。
  const options = Array.from(rootNode().querySelectorAll('#dshgn_brokenNames option')).map((el) => el.value)
  assert.ok(options.includes(right), '候选里该有库里那一篇：' + options.slice(0, 8).join('|'))

  const asked = []
  panel.setConfirmDialog(async (message, options2) => {
    asked.push({ message: String(message), options: options2 })
    return true
  })
  try {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, right)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(120)
    const go = head.parentElement.querySelector('.dshgn_brokenRetargetGo')
    assert.ok(go !== null, '输入框旁边该有提交那颗')
    go.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => asked.length > 0, 8000, '改全库之前该问一句')
  } finally {
    panel.setConfirmDialog(null)
  }
  assert.ok(asked[0].message.includes(wrong), '问的话要说清改的是哪个名字：' + asked[0].message)
  assert.ok(asked[0].message.includes(right), '问的话要说清改成哪一个：' + asked[0].message)
  assert.ok(asked[0].message.includes('2'), '问的话要报清这一组有几处：' + asked[0].message)

  // 改完这一组该整组从清单上消失
  await waitFor(() => groupOf() === null, 10000, '改对之后这一组不该还挂着')

  const read = async (rel) => {
    const res = await fetch(server.origin + '/getnote/read?path=' + encodeURIComponent(rel), {
      headers: { 'x-getnote-token': server.token },
    })
    return { status: res.status, json: res.ok ? await res.json() : null }
  }
  const hit = await read('断链改名验收/断链改名-引用它的那一篇.md')
  assert.equal(hit.status, 200, '引用它的那一篇该还在')
  const body = String((hit.json && hit.json.body) || '')
  assert.ok(body.includes('[[' + right + ']]'), '不带小节的链接该改成对的名字：' + body)
  assert.ok(body.includes('[[' + right + '#小节]]'), '带小节的链接也要改，小节要留着：' + body)
  assert.ok(!body.includes(wrong), '写错的那个名字该一处都不剩：' + body)
  // 补空笔记那条路没有被顺手走一遍：库里不该多出一篇叫错名的
  const wrongNote = await read('断链改名验收/' + wrong + '.md')
  assert.notEqual(wrongNote.status, 200, '不该顺手补出一篇叫错名的空笔记')

  await clickTab('笔记')
})


test('断链页能按名字或篇名筛一处，清掉这个筛就回全量', async () => {
  const rootNode = () => window.document.querySelector('.dshgn_root')
  const post = async (path, payload) => {
    const res = await fetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-getnote-token': server.token },
      body: JSON.stringify(payload),
    })
    return res
  }
  const wrongA = '断链筛选-没写的那一'
  const wrongB = '断链筛选-没写的另一'
  await post('/getnote/create', {
    dir: '断链筛选验收',
    title: '断链筛选-甲',
    content: ['# 断链筛选-甲', '', '坏的 [[' + wrongA + ']]。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-broken-filter-a',
  })
  await post('/getnote/create', {
    dir: '断链筛选验收',
    title: '断链筛选-乙',
    content: ['# 断链筛选-乙', '', '也是坏的 [[' + wrongB + ']]。', ''].join('\n'),
    withDatePrefix: false,
    requestId: 'seed-broken-filter-b',
  })

  // 前面的用例留着搜索词和目录筛选，先退回「全部笔记」再刷新，新种的两篇才在列表里。
  const back = rootNode().querySelector('.dshgn_noteBack')
  if (back !== null) {
    panel.setConfirmDialog(() => Promise.resolve(true))
    back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await sleep(400)
  }
  const search = rootNode().querySelector('.dshgn_search')
  if (search !== null && String(search.value || '') !== '') {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, '')
    search.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(400)
  }
  const allRow = Array.from(rootNode().querySelectorAll('.dshgn_treeRow')).find((el) => {
    const name = el.querySelector('.dshgn_treeName')
    return name !== null && (name.textContent || '').trim() === '全部笔记'
  })
  if (allRow) allRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(300)
  const refreshBtn = Array.from(rootNode().querySelectorAll('.dshgn_iconBtn')).find((el) => el.title === '刷新')
  refreshBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(800)

  await clickTab('断链')
  const groupNames = () =>
    Array.from(rootNode().querySelectorAll('.dshgn_brokenGroupName')).map((el) => String(el.textContent || ''))
  await waitFor(() => groupNames().includes(wrongA) && groupNames().includes(wrongB), 10000, '断链页里该有这两个错名字')
  const totalGroups = groupNames().length
  assert.ok(totalGroups >= 2, '至少该有这两组：' + JSON.stringify(groupNames()))

  const input = await waitFor(() => rootNode().querySelector('.dshgn_brokenFilter'), 4000, '断链页该有自己的筛')
  assert.equal(input.getAttribute('placeholder'), '按名字或篇名找一处')
  const typeFilter = async (text) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, text)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await sleep(220)
  }

  // ① 筛半个名字：只剩那一组
  await typeFilter('没写的那一')
  await waitFor(() => groupNames().length === 1, 5000, '筛完该只剩一组')
  assert.equal(groupNames()[0], wrongA, '筛出来该是写着半个名字的那一组：' + JSON.stringify(groupNames()))
  const countLine = await waitFor(
    () => rootNode().querySelector('.dshgn_brokenFiltered'),
    4000,
    '筛着的时候该报一句筛出几处',
  )
  assert.ok(
    /筛出 1 处，一共 \d+ 处/.test(String(countLine.textContent || '')),
    '该写清筛出几处、一共几处：' + countLine.textContent,
  )
  // 抄清单抄的是眼下这一份，不是筛之前那份
  const written = []
  clipboard.writeText = async (text) => { written.push(String(text)) }
  const copyBtn = Array.from(rootNode().querySelectorAll('.dshgn_btn')).find(
    (el) => (el.textContent || '').trim() === '复制这份清单',
  )
  copyBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => written.length > 0, 5000, '抄到剪贴板')
  assert.ok(written[0].includes(wrongA), '抄出来的该有筛中的那个名字：' + written[0])
  assert.ok(!written[0].includes(wrongB), '没筛中的那组不该被抄进去：' + written[0])

  // ② 按篇名也能筛：出处那一篇的名字
  await typeFilter('断链筛选-乙')
  await waitFor(() => groupNames().length === 1 && groupNames()[0] === wrongB, 5000, '按篇名也该筛得出来')

  // ③ 对不上任何一处：说「没有对得上的断链」，不能说「库里每一条都指得到」
  await typeFilter('这一串谁也对不上')
  const emptyTitle = await waitFor(() => rootNode().querySelector('.dshgn_emptyTitle'), 5000, '筛空时该有说明')
  assert.equal(String(emptyTitle.textContent || ''), '没有对得上的断链')
  const emptyDesc = rootNode().querySelector('.dshgn_emptyDesc')
  assert.ok(
    String(emptyDesc.textContent || '').includes('清掉上面那个筛'),
    '筛空时该说清怎么回去：' + emptyDesc.textContent,
  )
  assert.equal(rootNode().querySelector('.dshgn_brokenFiltered'), null, '一处都没有时不必再报筛出几处')

  // ④ Esc 清掉这个筛，回到全量
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await waitFor(() => groupNames().length === totalGroups, 5000, '清掉筛该回全量')
  assert.equal(String(input.value || ''), '', '清掉之后输入框该是空的')
  assert.equal(rootNode().querySelector('.dshgn_brokenFiltered'), null, '不筛的时候不摆那一行')

  await clickTab('笔记')
})
