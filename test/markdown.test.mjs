/**
 * 正文渲染层验收：MarkdownView 在「有宿主渲染器」和「没宿主渲染器」两种情况下
 * 都必须把内容显示出来。
 *
 * 这一层最怕的是静默失败：注入没接上就退回手写渲染（看起来还行但功能少了），
 * 渲染器抛错就整块空白，换笔记时旧内容盖掉新内容。这三件事用户都只会看到
 * 「面板坏了」，所以每一条都单独断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'app://obsidian.md/',
  pretendToBeVisual: true,
})
const { window } = dom

for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  if (window[key] !== undefined) globalThis[key] = window[key]
}
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = false

const React = await import('preact/compat')
const { createRoot } = await import('preact/compat/client')
const { MarkdownView, setMarkdownHost, clearMarkdownHost, hasMarkdownHost, openLinkInVault } = await import('../src/view/markdown.js')

/**
 * 挂一个组件到全新的 div 上，等到内容真的出现。
 *
 * 原来固定等 60ms，单跑这个文件时够用；整套测试一起跑（每个文件一个进程、
 * 机器被占满）时 effect 还没轮到执行，断言就先跑了，于是报「应该只渲染一次」
 * 这种假失败。改成轮询到内容出现为止，上限 3 秒。
 */
async function mount(props, ready) {
  const host = window.document.createElement('div')
  window.document.body.appendChild(host)
  const root = createRoot(host)
  root.render(React.createElement(MarkdownView, props))
  const done = typeof ready === 'function' ? ready : () => (host.textContent || '').trim() !== ''
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 20))
    if (done(host)) break
  }
  return {
    host,
    unmount() {
      root.unmount()
      if (host.parentNode) host.parentNode.removeChild(host)
    },
  }
}

/** 造一个假的 Obsidian 渲染器：把正文包进 <p> 写进去，并记录收到的参数。 */
function fakeRenderer(options = {}) {
  const seen = []
  return {
    seen,
    async render(app, markdown, el, sourcePath, component) {
      seen.push({ app, markdown, el, sourcePath, component })
      if (options.throws) throw new Error('渲染器炸了')
      const p = el.ownerDocument.createElement('p')
      p.className = 'fake-rendered'
      p.textContent = markdown
      el.appendChild(p)
      if (typeof options.after === 'function') options.after(el)
    },
  }
}

test('没注入宿主渲染器时退回原样显示，不抛错', async () => {
  clearMarkdownHost()
  assert.equal(hasMarkdownHost(), false)
  const view = await mount({ markdown: '# 标题\n\n正文', sourcePath: '得到大脑/a.md' })
  try {
    const text = view.host.textContent || ''
    assert.ok(text.includes('# 标题'), '应该原样显示正文：' + text)
    assert.ok(text.includes('正文'))
  } finally {
    view.unmount()
  }
})

test('注入宿主渲染器后走它，并把 app / sourcePath / component 一起传过去', async () => {
  const renderer = fakeRenderer()
  const app = { workspace: {} }
  const component = { name: 'plugin' }
  setMarkdownHost({ app, component, MarkdownRenderer: renderer })

  const view = await mount({ markdown: '**加粗**', sourcePath: '得到大脑/随手记/a.md' }, (host) => host.querySelector('.fake-rendered') !== null)
  try {
    assert.equal(renderer.seen.length, 1, '应该只渲染一次')
    const call = renderer.seen[0]
    assert.equal(call.app, app)
    assert.equal(call.markdown, '**加粗**')
    assert.equal(call.sourcePath, '得到大脑/随手记/a.md')
    assert.equal(call.component, component)
    assert.ok(view.host.querySelector('.fake-rendered'), '渲染结果应该出现在 DOM 里')
    assert.ok((view.host.textContent || '').includes('**加粗**'))
  } finally {
    view.unmount()
    clearMarkdownHost()
  }
})

test('渲染器抛错时退回原样文本，不把面板带崩', async () => {
  const renderer = fakeRenderer({ throws: true })
  setMarkdownHost({ app: { workspace: {} }, component: {}, MarkdownRenderer: renderer })
  const view = await mount({ markdown: '坏掉的块语法', sourcePath: '得到大脑/a.md' })
  try {
    await new Promise((resolve) => window.setTimeout(resolve, 60))
    assert.ok((view.host.textContent || '').includes('坏掉的块语法'), '至少内容还在')
  } finally {
    view.unmount()
    clearMarkdownHost()
  }
})

test('换正文时不会让上一版异步渲染盖掉新内容', async () => {
  // 第一版渲染慢（300ms 后才写），第二版立刻写；如果两版共用同一个节点，
  // 慢的那版回来就会把新内容覆盖成旧的。
  let version = 0
  const renderer = {
    async render(app, markdown, el) {
      const mine = ++version
      await new Promise((resolve) => window.setTimeout(resolve, mine === 1 ? 300 : 10))
      const p = el.ownerDocument.createElement('p')
      p.textContent = markdown
      el.appendChild(p)
    },
  }
  setMarkdownHost({ app: { workspace: {} }, component: {}, MarkdownRenderer: renderer })

  const host = window.document.createElement('div')
  window.document.body.appendChild(host)
  const root = createRoot(host)
  const render = (markdown) =>
    root.render(React.createElement(MarkdownView, { markdown, sourcePath: '得到大脑/a.md' }))

  render('第一版')
  await new Promise((resolve) => window.setTimeout(resolve, 20))
  render('第二版')
  await new Promise((resolve) => window.setTimeout(resolve, 500))

  try {
    const text = host.textContent || ''
    assert.ok(text.includes('第二版'), '应该显示最新内容：' + text)
    assert.ok(!text.includes('第一版'), '上一版的渲染结果不该盖回来：' + text)
  } finally {
    root.unmount()
    if (host.parentNode) host.parentNode.removeChild(host)
    clearMarkdownHost()
  }
})

test('点内链交给 onOpenLink；按着 Ctrl 时交给 Obsidian 新开一页', async () => {
  const opened = []
  const editorOpened = []
  const renderer = fakeRenderer({
    after(el) {
      const a = el.ownerDocument.createElement('a')
      a.className = 'internal-link'
      a.setAttribute('data-href', '另一篇笔记')
      a.textContent = '另一篇笔记'
      el.appendChild(a)
    },
  })
  setMarkdownHost({
    app: { workspace: { openLinkText: (href, source, newLeaf) => editorOpened.push({ href, source, newLeaf }) } },
    component: {},
    MarkdownRenderer: renderer,
  })

  const view = await mount(
    { markdown: '见 [[另一篇笔记]]', sourcePath: '得到大脑/a.md', onOpenLink: (href) => opened.push(href) },
    (host) => host.querySelector('a.internal-link') !== null,
  )
  try {
    const anchor = view.host.querySelector('a.internal-link')
    assert.ok(anchor, '应该渲染出内链')

    anchor.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    assert.deepEqual(opened, ['另一篇笔记'], '普通点击应该走面板自己的回调')

    anchor.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))
    assert.equal(editorOpened.length, 1, 'Ctrl+点击应该在编辑器里新开')
    assert.equal(editorOpened[0].href, '另一篇笔记')
    assert.equal(editorOpened[0].source, '得到大脑/a.md')
    assert.equal(editorOpened[0].newLeaf, true)
  } finally {
    view.unmount()
    clearMarkdownHost()
  }
})

test('点待办方框按序号回调，引用块里的不算', async () => {
  const toggled = []
  const renderer = fakeRenderer({
    after(el) {
      const doc = el.ownerDocument
      const first = doc.createElement('input')
      first.className = 'task-list-item-checkbox'
      first.type = 'checkbox'
      el.appendChild(first)

      const quote = doc.createElement('blockquote')
      const quoted = doc.createElement('input')
      quoted.className = 'task-list-item-checkbox'
      quoted.type = 'checkbox'
      quote.appendChild(quoted)
      el.appendChild(quote)

      const second = doc.createElement('input')
      second.className = 'task-list-item-checkbox'
      second.type = 'checkbox'
      el.appendChild(second)
    },
  })
  setMarkdownHost({ app: { workspace: {} }, component: {}, MarkdownRenderer: renderer })

  const view = await mount(
    { markdown: '- [ ] 一\n- [ ] 二', sourcePath: '得到大脑/a.md', onToggleTodo: (index) => toggled.push(index) },
    (host) => host.querySelectorAll('input.task-list-item-checkbox').length === 3,
  )
  try {
    const boxes = view.host.querySelectorAll('input.task-list-item-checkbox')
    assert.equal(boxes.length, 3)

    boxes[0].dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    boxes[2].dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    // 引用块里的那条：host 侧不计数，这里也不该回调
    boxes[1].dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))

    assert.deepEqual(toggled, [0, 1], '第三个方框是第 2 个可勾待办（index 1），引用块不计数')
  } finally {
    view.unmount()
    clearMarkdownHost()
  }
})

test('没注入宿主时 openLinkInVault 返回 false，注入后才接管', () => {
  clearMarkdownHost()
  assert.equal(openLinkInVault('另一篇', '得到大脑/a.md'), false)

  const opened = []
  setMarkdownHost({
    app: { workspace: { openLinkText: (href, source) => opened.push({ href, source }) } },
    component: {},
    MarkdownRenderer: fakeRenderer(),
  })
  assert.equal(openLinkInVault('另一篇', '得到大脑/a.md'), true)
  assert.deepEqual(opened, [{ href: '另一篇', source: '得到大脑/a.md' }])
  clearMarkdownHost()
})
