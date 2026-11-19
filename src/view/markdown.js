/*
 * 笔记正文的渲染：交给 Obsidian 自己的 Markdown 渲染器。
 *
 * 为什么要这么做：面板里原来有一套手写的 Markdown 解析（renderBlocks / renderInline），
 * 它能渲染标题、列表、表格、代码块和 [[双链]]，但每一样都是「像」而不是「是」——
 * callout 不会折叠、公式不会排版、Mermaid 不会画图、脚注、高亮、嵌入块、
 * Dataview / Bases 的查询块全都出不来。这些能力 Obsidian 本体都有，没必要重写一遍。
 *
 * 代价是渲染器要从 'obsidian' 引入，而面板的离线测试跑在纯 Node 里（没有 obsidian 模块）。
 * 所以这里不静态 import，由 main.js 在启动时把 app / component / MarkdownRenderer
 * 三样东西注入进来；没注入时 hasMarkdownHost() 为假，面板自动退回原来的手写渲染器。
 * 这也是离线测试仍然能跑完整面板的原因。
 */

import * as React from 'preact/compat'

const h = React.createElement

let hostApp = null
let hostComponent = null
let hostRenderer = null
let hoverSource = ''

/**
 * 注入 Obsidian 的渲染能力。
 *
 * @param {{ app: object, component: object, MarkdownRenderer: object }} host
 *   component 用来托管渲染器创建的子组件（Mermaid、嵌入笔记…），传插件实例即可。
 */
export function setMarkdownHost(host) {
  const value = host && typeof host === 'object' ? host : null
  hostApp = value && value.app ? value.app : null
  hostComponent = value && value.component ? value.component : null
  hostRenderer = value && value.MarkdownRenderer ? value.MarkdownRenderer : null
}

export function clearMarkdownHost() {
  hostApp = null
  hostComponent = null
  hostRenderer = null
}

/**
 * 告诉这一层「我们是谁」，页面预览（hover-link）要用这个名字认来源。
 *
 * Obsidian 的页面预览靠 `workspace.trigger('hover-link', {...})` 触发，其中的
 * `source` 必须是宿主登记过的 id（见插件里的 `registerHoverLinkSource`）。
 * 不登记的话，宿主不知道该用哪套规则来预览，鼠标停在 `[[双链]]` 上什么都不会发生。
 */
export function setHoverSource(id) {
  hoverSource = typeof id === 'string' ? id : ''
}

/**
 * 鼠标停在一条内链上时，请宿主弹它的页面预览。
 *
 * 返回 true 表示已经交给宿主；false 说明没注入宿主（离线测试），调用方什么都不用做。
 * 这里只做转发：预览怎么画、多大、要不要锁定，都是宿主自己的事。
 */
export function hoverLink(event, targetEl, href, sourcePath) {
  if (hostApp === null || !hostApp.workspace || typeof hostApp.workspace.trigger !== 'function') return false
  if (hoverSource === '') return false
  try {
    hostApp.workspace.trigger('hover-link', {
      event,
      source: hoverSource,
      hoverParent: hostComponent,
      targetEl,
      linktext: String(href || ''),
      sourcePath: String(sourcePath || ''),
    })
    return true
  } catch {
    return false
  }
}

export function hasMarkdownHost() {
  return hostApp !== null && hostRenderer !== null
}

/**
 * 用 Obsidian 自己的方式打开一条内链（在编辑器里打开那篇笔记）。
 *
 * 返回 true 表示已经交给宿主处理了；返回 false 说明没注入宿主（离线测试），
 * 调用方可以退回面板自己的「在面板里打开」逻辑。
 */
export function openLinkInVault(href, sourcePath) {
  if (hostApp === null || !hostApp.workspace || typeof hostApp.workspace.openLinkText !== 'function') {
    return false
  }
  try {
    hostApp.workspace.openLinkText(String(href || ''), String(sourcePath || ''), false)
    return true
  } catch {
    return false
  }
}

/** 拿 closest 但不怕 target 是文本节点 / 跨 realm 的节点。 */
function closestOf(node, selector) {
  let current = node
  while (current) {
    if (typeof current.closest === 'function') {
      const hit = current.closest(selector)
      if (hit) return hit
    }
    current = current.parentNode
  }
  return null
}

function openExternalUrl(url) {
  try {
    window.open(url, '_blank', 'noopener')
  } catch {
    // 打不开就算了，链接本身的 href 还在，用户能手动复制
  }
}

/**
 * 渲染一段 Markdown。
 *
 * props:
 *   markdown     要渲染的正文
 *   sourcePath   这篇笔记在库里的相对路径（渲染器靠它解析相对链接与图片）
 *   className    外层 class（沿用面板原来的 .dshgn_md 字号档位）
 *   onOpenLink   点内链时的回调；不传就走 Obsidian 自己的打开逻辑
 *   onToggleTodo 点待办方框时的回调，参数是「第几个待办」（跳过代码围栏、跳过引用块，
 *                与 host 侧 toggleTodo 的口径一致）
 */
export function MarkdownView(props) {
  const { markdown, sourcePath, className, onOpenLink, onToggleTodo } = props
  const ref = React.useRef(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    let disposed = false

    // 每次渲染都写进一个新建的子节点。渲染是异步的（内部要等 Mermaid、
    // 嵌入笔记这些子组件），快速换笔记时上一版的渲染还在跑；如果两版都写
    // 同一个节点，慢的那版回来会把新内容盖掉。写进各自的节点、卸载时把节点
    // 摘掉，上一版再怎么写也只是写进一个已经脱离文档的 div。
    const target = el.ownerDocument.createElement('div')
    target.className = 'dshgn_mdBody'
    el.textContent = ''
    el.appendChild(target)

    // 没注入宿主（离线测试、或某个宿主忘了接）时不要留一块空白：
    // 原样把正文铺出来，至少内容还在。面板侧本来就会先判断再选渲染器，
    // 这里只是兜住「有人直接用了 MarkdownView」的情况。
    if (!hasMarkdownHost()) {
      target.textContent = String(markdown || '')
      return () => {
        disposed = true
        if (target.parentNode) target.parentNode.removeChild(target)
      }
    }

    Promise.resolve(hostRenderer.render(hostApp, String(markdown || ''), target, sourcePath || '', hostComponent))
      .catch(() => {
        // 渲染器自己抛错（比如块语法写坏了）不该把整个面板带崩，
        // 退回到「原样显示文本」，至少内容还在。
        if (!disposed) target.textContent = String(markdown || '')
      })

    return () => {
      disposed = true
      if (target.parentNode) target.parentNode.removeChild(target)
    }
  }, [markdown, sourcePath])

  const onClick = React.useCallback(
    (event) => {
      const anchor = closestOf(event.target, 'a')
      if (!anchor) return
      const href = anchor.getAttribute('data-href') || anchor.getAttribute('href') || ''
      if (href === '') return
      const internal = anchor.classList.contains('internal-link')
      if (internal) {
        event.preventDefault()
        event.stopPropagation()
        const inEditor = event.ctrlKey || event.metaKey
        if (typeof onOpenLink === 'function' && !inEditor) {
          onOpenLink(href)
          return
        }
        if (hostApp && hostApp.workspace && typeof hostApp.workspace.openLinkText === 'function') {
          hostApp.workspace.openLinkText(href, sourcePath || '', inEditor)
        }
        return
      }
      if (/^https?:/i.test(href)) {
        event.preventDefault()
        event.stopPropagation()
        openExternalUrl(href)
      }
    },
    [onOpenLink, sourcePath],
  )

  // 鼠标停在 [[双链]] 上：请宿主弹页面预览。这是 Obsidian 里最常用的一个手势，
  // 少了它用户得先点进去再点回来才能确认「这是不是我要的那篇」。
  const onMouseOver = React.useCallback(
    (event) => {
      const anchor = closestOf(event.target, 'a.internal-link')
      if (!anchor) return
      const href = anchor.getAttribute('data-href') || anchor.getAttribute('href') || ''
      if (href === '') return
      hoverLink(event, anchor, href, sourcePath)
    },
    [sourcePath],
  )

  const onCheckbox = React.useCallback(
    (event) => {
      if (typeof onToggleTodo !== 'function') return
      const box = closestOf(event.target, 'input.task-list-item-checkbox')
      if (!box) return
      // 引用块里的待办 host 侧不计数（那一行开头是 `>`），这里也不响应，
      // 否则点第一条会勾到别处去。
      if (closestOf(box, 'blockquote')) return
      const container = ref.current
      if (!container) return
      const all = Array.from(container.querySelectorAll('input.task-list-item-checkbox'))
      const usable = all.filter((item) => !closestOf(item, 'blockquote'))
      const index = usable.indexOf(box)
      if (index < 0) return
      event.preventDefault()
      onToggleTodo(index)
    },
    [onToggleTodo],
  )

  return h('div', { ref, className, onClick, onMouseDown: onCheckbox, onMouseOver })
}
