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

  panel.setNoteMenu(null)
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
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
  await waitFor(
    () => fetchCalls.filter((url) => url.includes('/getnote/save')).length > savesBefore,
    8000,
    'Ctrl+S 之后要真的打一次保存',
  )

  // Esc：退出编辑态（保存后可能已经退出，也接受再进一次）
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await waitFor(() => window.document.querySelector('.dshgn_editor') === null, 5000, 'Esc 之后要退出编辑态')
})

