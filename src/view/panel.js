/*
 * 得到大脑 · Obsidian 面板视图
 *
 * 由 DSH 版 lib/client.js 机械移植：剥掉 __ModuleLoader__ 工厂壳与 slots/locale 接线，
 * 其余 React 组件、Markdown 渲染器、样式与图标原样保留。
 */

import * as React from 'preact/compat'
import { error as logError, setDebugLogging } from '../core/log.js'

import { MarkdownView, hasMarkdownHost, openLinkInVault } from './markdown.js'

// 面板要访问的本地服务地址，由 main.js 在服务监听成功后写入。
// Obsidian 里没有宿主的 webServer，/getnote 全部走本机 127.0.0.1 回环端口。
let __apiBase = ''
export function setApiOrigin(origin) {
  __apiBase = String(origin || '').replace(/\/+$/, '')
}
function apiOrigin() {
  return __apiBase
}

// 本机服务的访问令牌，由 main.js 在服务监听成功后写入。
// CORS 头是 `*`（渲染进程的源是 app://obsidian.md，预知不了），所以门禁靠这个
// 令牌：没有它，本机任何网页都能 fetch 这个端口、把整个笔记库读走。
let __apiToken = ''
export function setApiToken(token) {
  __apiToken = String(token || '')
}
export function apiToken() {
  return __apiToken
}

/**
 * 给「浏览器自己发起的请求」补令牌。
 *
 * `<img src>` 和 `<audio src>` 是浏览器原生加载，加不了自定义头，只能把令牌
 * 塞进查询参数。带令牌的 URL 不要缓存、不要写进笔记——它每次启动都会变。
 */
export function withToken(url) {
  if (__apiToken === '') return url
  const text = String(url || '')
  if (text === '') return text
  const sep = text.includes('?') ? '&' : '?'
  return `${text}${sep}t=${encodeURIComponent(__apiToken)}`
}

// 授权要在系统浏览器里走：Obsidian 渲染进程里的 window.open 会被
// Electron 接走（有时开成新窗口、有时直接没反应），所以由宿主注入一个
// 「用系统浏览器打开」的实现；没注入时退回 window.open。
let __openExternal = null
export function setOpenExternal(fn) {
  __openExternal = typeof fn === 'function' ? fn : null
}
function openExternal(url) {
  if (__openExternal !== null) {
    try {
      if (__openExternal(url) === true) return
    } catch {
      // 注入的实现失败了就往下走 window.open
    }
  }
  window.open(url, '_blank', 'noopener,width=520,height=760')
}

// 外部（命令面板、状态栏）让面板做某件事的通道。
//
// 命令面板触发时，视图可能刚被创建、面板还没渲染完，所以不能直接调用面板内部
// 函数；改成「投递一个意图，谁在听谁处理」。没人在听就先存着，面板挂载时
// 一次性取走——否则从命令面板打开面板会丢动作。
let __pendingIntent = null
const __intentListeners = new Set()

export function requestIntent(intent) {
  if (intent === null || typeof intent !== 'object') return
  if (__intentListeners.size === 0) {
    __pendingIntent = intent
    return
  }
  for (const listener of Array.from(__intentListeners)) {
    try {
      listener(intent)
    } catch {
      // 一个监听者炸了不该影响别人
    }
  }
}

function subscribeIntent(listener) {
  __intentListeners.add(listener)
  if (__pendingIntent !== null) {
    const pending = __pendingIntent
    __pendingIntent = null
    try {
      listener(pending)
    } catch {
      // 同上
    }
  }
  return () => {
    __intentListeners.delete(listener)
  }
}

// 同步完成后要不要做点什么（比如写一条同步摘要进日记）。
//
// 面板只负责「跑完一轮同步了，结果是这样」，具体写去哪由宿主决定：
// 日记的位置属于 Obsidian 的日常笔记配置，面板不该去猜。
let __syncReport = null
export function setSyncReport(fn) {
  __syncReport = typeof fn === 'function' ? fn : null
}
function reportSync(result) {
  if (__syncReport === null) return
  try {
    __syncReport(result)
  } catch {
    // 摘要写失败不该影响同步本身
  }
}

// 整库导出的落盘方式。渲染进程里点 a[download] 在 Electron 里不可靠：
// Obsidian 没开下载管理器时它可能静默什么都不做。所以由宿主注入一个「弹出
// 保存对话框再写文件」的实现，拿不到就退回 a[download]。
let __saveFile = null
export function setSaveFile(fn) {
  __saveFile = typeof fn === 'function' ? fn : null
}
async function saveFile(url, filename) {
  if (__saveFile !== null) {
    try {
      const saved = await __saveFile(url, filename)
      if (saved) return true
    } catch {
      // 注入的实现失败（用户取消、磁盘满…）就退回 a[download]
    }
  }
  return false
}

    // 右键菜单交给宿主。
    //
    // 面板里原来只有目录/标签有右键菜单，笔记卡片没有——用户想在列表上右键
    // 重命名、删除、复制引用，只能先点开再找按钮。这里把「一份动作清单」交给
    // 宿主：Obsidian 桌面版弹原生 Menu，其它环境（离线测试）退回面板自己的
    // 简易菜单，所以这段逻辑不依赖 obsidian 模块也能跑。
    let __noteMenu = null
    export function setNoteMenu(fn) {
      __noteMenu = typeof fn === 'function' ? fn : null
    }
    function showNoteMenu(anchor, items) {
      if (__noteMenu === null) return false
      try {
        return __noteMenu(anchor, items) !== false
      } catch {
        return false
      }
    }

    // 确认框。宿主注入的是 Obsidian 的 Modal——它跟设置页、命令面板长得一样，
    // 能用键盘操作，也会被宿主的弹层层级管着；window.confirm 是浏览器原生的，
    // 在 Obsidian 里既不像宿主的一部分，某些平台（移动端 WebView）还会直接不弹。
    // 没有注入时（离线测试、早期加载阶段）退回 window.confirm。
    let __confirm = null
    export function setConfirmDialog(fn) {
      __confirm = typeof fn === 'function' ? fn : null
    }
    function confirmDialog(message) {
      if (__confirm !== null) {
        try {
          return Promise.resolve(__confirm(String(message))).then(
            (value) => value === true,
            () => window.confirm(String(message)),
          )
        } catch {
          // 宿主实现炸了也不能把用户卡在一个点了没反应的按钮上
        }
      }
      try {
        return Promise.resolve(window.confirm(String(message)) === true)
      } catch {
        return Promise.resolve(false)
      }
    }

    // 在宿主的编辑器里打开这一篇。
    //
    // 面板的编辑器只服务「扫一眼、改两笔」：没有补全、没有 Vim、没有
    // 插件提供的命令（格式化、模板、AI 补全）。真要动结构，用户还是得去
    // Obsidian 自己的编辑器——所以笔记头上得有个能过去的门，而不是逼他
    // 在文件列表里找。
    let __openInEditor = null
    export function setOpenInEditor(fn) {
      __openInEditor = typeof fn === 'function' ? fn : null
    }
    function hasOpenInEditor() {
      return __openInEditor !== null
    }
    function openInEditor(path) {
      if (__openInEditor === null) return false
      try {
        return __openInEditor(String(path || '')) === true
      } catch {
        return false
      }
    }

    // 复制引用该用宿主自己的链接格式。
    //
    // 面板原来拼的是「库根绝对路径 + @前缀」，那是喂给外部工具（Claude Code 之类）
    // 的口径。但用户在 Obsidian 里复制引用，十有八九是想粘进另一篇笔记里——
    // 那要的是 `[[随手记/甲|甲]]` 或 `[甲](随手记/甲.md)`，取决于他自己的
    // 「使用 Wiki 链接」和「新链接格式」设置。这两项只有 app.fileManager 知道，
    // 所以交给宿主生成；没注入时（离线测试、早期加载）退回原来的绝对路径。
    let __markdownLink = null
    export function setMarkdownLink(fn) {
      __markdownLink = typeof fn === 'function' ? fn : null
    }
    function markdownLinkOf(path) {
      if (__markdownLink === null) return ''
      try {
        const text = __markdownLink(String(path || ''))
        return typeof text === 'string' ? text : ''
      } catch {
        return ''
      }
    }

    // 附件（图片、录音）该走宿主自己的资源协议。
    //
    // 面板原来把附件地址拼成本地服务的 `/getnote/asset?path=...&t=令牌`：端口会变、
    // 令牌每次启动都换，而且每张图都要绕一圈本机 HTTP 服务。Obsidian 自己有
    // `adapter.getResourcePath()`，给出的是它内部资源协议下的地址，浏览器能直接加载，
    // 还能吃到宿主的缓存与 Range 处理。注入之后优先用它，没注入（离线测试、早期
    // 加载）退回本地服务地址——两条路都得能走。
    let __assetUrl = null
    export function setAssetUrl(fn) {
      __assetUrl = typeof fn === 'function' ? fn : null
    }
    function assetUrlOf(path) {
      if (__assetUrl === null) return ''
      try {
        const url = __assetUrl(String(path || ''))
        return typeof url === 'string' ? url : ''
      } catch {
        return ''
      }
    }

    // 在宿主的文件列表里定位这一篇（或这个目录）。
    //
    // 面板的列表是平的、按目录筛的，用户想「这到底在库里的哪儿、旁边还有哪些」
    // 时，光看路径字符串没有空间感。宿主自己的文件列表知道这件事，把那一项
    // 亮出来比解释一遍路径直观。注入失败（宿主没这个接口）时菜单里就不出现这一项，
    // 免得点了没反应。
    let __revealInVault = null
    export function setRevealInVault(fn) {
      __revealInVault = typeof fn === 'function' ? fn : null
    }
    function hasRevealInVault() {
      return __revealInVault !== null
    }
    function revealInVault(path) {
      if (__revealInVault === null) return false
      try {
        return __revealInVault(String(path || '')) === true
      } catch {
        return false
      }
    }

    // 「今天」该落在哪一篇，由宿主的日记核心插件说了算。
    //
    // 很多人把日记配成「日记/YYYY/YYYY-MM-DD」或者别的文件名格式，插件再自己
    // 拼一个 YYYY-MM-DD 丢在库根，等于在同一个库里造第二套「今天」——用户下次
    // 在宿主里点「打开今天的日记」看到的又是另一个文件。所以这里只问，不猜。
    let __dailyNote = null
    export function setDailyNote(fn) {
      __dailyNote = typeof fn === 'function' ? fn : null
    }
    /**
     * 问宿主「今天的日记在哪」。
     *
     * 返回 { dir, title }（相对笔记目录的目录 + 文件名，面板直接喂给 /create），
     * 宿主没配日记或没注入时返回 null——这时调用方退回自己的日期标题。
     * 路径里没有斜杠时 dir 是空串，正好等于「笔记根」。
     */
    function dailyNoteOf() {
      if (__dailyNote === null) return null
      let raw = ''
      try {
        const answer = __dailyNote()
        raw = typeof answer === 'string' ? answer : ''
      } catch {
        return null
      }
      const clean = raw.replace(/\\/g, '/').replace(/^\/+/, '')
      if (clean === '') return null
      const cut = clean.lastIndexOf('/')
      const title = clean.slice(cut + 1).replace(/\.md$/i, '')
      if (title === '') return null
      return { dir: cut < 0 ? '' : clean.slice(0, cut), title }
    }

    // 双链该指向哪一篇，宿主的索引比我们清楚。
    //
    // 面板原来在自己扫到的 entries 里按「路径全等 → 文件名去扩展名 → 标题」三级
    // 退让，能应付大多数 [[笔记名]]，但宿主的解析规则要多得多：同名笔记取离当前
    // 文件最近的那篇、认别名、认不带扩展名的路径前缀、大小写也按库里的实际文件
    // 来。同一篇链接我们可能指错，宿主不会。所以先问它，问不到再走自己那套。
    let __linkResolve = null
    export function setLinkResolve(fn) {
      __linkResolve = typeof fn === 'function' ? fn : null
    }
    /**
     * 问宿主「这个双链指向哪一篇」。
     *
     * 返回相对笔记目录的路径（面板 entry.path 的口径），解析不出来返回空串——
     * 这时调用方退回自己的三级退让。
     */
    function resolveViaHost(linkpath, sourcePath) {
      if (__linkResolve === null) return ''
      try {
        const answer = __linkResolve(String(linkpath || ''), String(sourcePath || ''))
        return typeof answer === 'string' ? answer : ''
      } catch {
        return ''
      }
    }

    // 新建的笔记落在哪儿，宿主的「设置 → 文件与链接 → 新建笔记的默认位置」
    // 里已经写好了（库根 / 当前笔记所在目录 / 指定目录）。面板自己默认丢在
    // 笔记目录根，跟用户在其他地方点「新建笔记」的习惯对不上。
    let __newNotePlacement = null
    export function setNewNotePlacement(fn) {
      __newNotePlacement = typeof fn === 'function' ? fn : null
    }
    /**
     * 问宿主「新建的笔记该放哪个目录」。
     *
     * 返回相对笔记目录的目录（空串 = 笔记根），宿主没配或配在笔记目录之外
     * 时也返回空串——不把笔记建到笔记目录外面去。
     */
    function newNotePlacementOf() {
      if (__newNotePlacement === null) return ''
      try {
        const answer = __newNotePlacement()
        return typeof answer === 'string' ? answer.replace(/^\/+|\/+$/g, '') : ''
      } catch {
        return ''
      }
    }

    // 「今天」新建时填什么内容，宿主的日记插件里已经配好一个模板文件了
    // （设置 → 核心插件 → 日记 → 模板文件）。再让用户在我们这儿配一遍，
    // 同一个库里就会出现两种「今天的日记」。
    let __dailyTemplate = null
    export function setDailyTemplate(fn) {
      __dailyTemplate = typeof fn === 'function' ? fn : null
    }
    /**
     * 问宿主日记模板的正文；没配、读不到都返回空串（那就建一篇空的）。
     *
     * 宿主那边要读一次文件，所以是异步的；面板在新建日记之前等它一下，
     * 新建本来就是异步的，多这一跳不影响手感。
     */
    async function dailyTemplateOf() {
      if (__dailyTemplate === null) return ''
      try {
        const answer = await __dailyTemplate()
        return typeof answer === 'string' ? answer : ''
      } catch {
        return ''
      }
    }

    // 面板里的图片（正文里的 ![[图]] 与附件区的图）点了交给宿主打开：宿主有自己的
    // 图片视图（能缩放、能翻页），比在面板里再塞一个全屏浮层更符合 Obsidian 用户
    // 的习惯，也不用我们操心滚轮缩放、键盘翻页这些细节。
    let __openAsset = null
    export function setOpenAsset(fn) {
      __openAsset = typeof fn === 'function' ? fn : null
    }
    function hasOpenAsset() {
      return __openAsset !== null
    }
    function openAssetInHost(path) {
      if (__openAsset === null) return false
      try {
        return __openAsset(String(path || '')) === true
      } catch {
        return false
      }
    }

    // 重命名交给宿主做。它改名的时候会顺手把全库的双链、Markdown 链接一起改掉；
    // 我们自己去 rename 文件的话，别的笔记里的 [[旧名字]] 会静默变成死链——
    // 那种断裂往往几个月后才被发现。宿主还自带一个跟文件列表里一模一样的
    // 改名对话框（预填原名、Enter 确认），比自己再造一个更像 Obsidian。
    let __renameNote = null
    export function setRenameNote(fn) {
      __renameNote = typeof fn === 'function' ? fn : null
    }
    function hasRenameNote() {
      return __renameNote !== null
    }
    /**
     * 请宿主弹改名对话框。返回改完之后相对笔记目录的新路径；
     * 没接上宿主、用户取消、改到笔记目录之外，都返回空串。
     */
    async function renameNoteInHost(path) {
      if (__renameNote === null) return ''
      try {
        const answer = await __renameNote(String(path || ''))
        return typeof answer === 'string' ? answer : ''
      } catch {
        return ''
      }
    }

    // 宿主换主题时 Obsidian 会发 'css-change' 事件，比 MutationObserver 盯 body
    // 的 class 更准（用户改了字体、字号、界面缩放也能收到）。没有宿主时靠
    // MutationObserver 兜底，两者最终都只是让面板重新算一次配色。
    const __cssListeners = new Set()
    export function notifyCssChange() {
      for (const listener of Array.from(__cssListeners)) {
        try {
          listener()
        } catch {
          // 一个监听器出错不能影响其它监听器
        }
      }
    }
    function subscribeCssChange(listener) {
      __cssListeners.add(listener)
      return () => __cssListeners.delete(listener)
    }

    // 宿主的库变动事件。
    //
    // 用户在 Obsidian 编辑器里改了当前这篇、或者干脆把它删了/改了名，面板不能
    // 还端着旧正文——以前只有重新点一次卡片才会重读，开着的那一篇等于一直停在
    // 过去。这里只负责把「哪一篇、什么动作」转给面板，怎么反应由面板决定
    // （整库扫描缓存的失效在 main.js 那边单独做）。
    const __vaultListeners = new Set()
    export function notifyVaultChange(change) {
      for (const listener of Array.from(__vaultListeners)) {
        try {
          listener(change)
        } catch {
          // 一个监听器出错不能影响其它监听器
        }
      }
    }
    export function subscribeVaultChange(listener) {
      if (typeof listener !== 'function') return () => {}
      __vaultListeners.add(listener)
      return () => __vaultListeners.delete(listener)
    }

    // 面板把「现在有几篇笔记、打开的是哪一篇」报给宿主。
    //
    // 状态栏是用户唯一一直看得见我们的地方：只写「得到大脑」四个字，用户既不知道
    // 库有多大，也不知道面板里开着什么。宿主拿这条信息去更新状态栏文案。
    let __statusReport = null
    export function setStatusReport(fn) {
      __statusReport = typeof fn === 'function' ? fn : null
    }
    function reportStatus(info) {
      if (__statusReport === null) return
      try {
        __statusReport(info)
      } catch {
        // 状态栏更新失败不能影响面板本身
      }
    }

    // 宿主的知识图谱。
    //
    // 反链、双链补全、出链这些东西 Obsidian 的 metadataCache 本来就一直在维护，
    // 我们再扫一遍全库正文等于把它干过的活重干一次——库大了这个差别是「点一下
    // 立刻出」和「等一秒」的差别。注入之后反查优先问宿主，问不到（链接还没被
    // 索引、文件刚写下去）再退回自己扫；没注入时行为跟以前完全一样。
    let __graph = null
    export function setVaultGraph(fn) {
      __graph = typeof fn === 'function' ? fn : null
    }
    function hasVaultGraph() {
      return __graph !== null
    }
    function backlinksViaHost(path) {
      if (__graph === null) return null
      try {
        const result = __graph(String(path || ''), 'backlinks')
        return result === undefined || result === null ? null : result
      } catch {
        return null
      }
    }
    function linksViaHost(path) {
      if (__graph === null) return null
      try {
        const result = __graph(String(path || ''), 'links')
        return result === undefined || result === null ? null : result
      } catch {
        return null
      }
    }

    const h = React.createElement
    const NS = 'dsh-getnote'
    const PANEL_ID = 'dsh-getnote'
    const PANEL_ORDER = 7
    const STYLE_ID = 'dshgn-style'

    // ── 文案 ──────────────────────────────────────────────────────────────────

    const LEX = {
      zh: {
        'panel.title': '得到大脑',
        'panel.toggleTree': '目录面板',
        'panel.hint': '本地笔记库',
        'tab.notes': '笔记',
        'tab.import': '导入',
        'tab.settings': '设置',
        'action.refresh': '刷新',
        'action.new': '新建',
        'action.save': '保存',
        'action.cancel': '取消',
        'action.edit': '编辑',
        'action.openInEditor': '在 Obsidian 里打开',
        'action.delete': '删除',
        'action.copyRef': '复制引用',
        'action.rename': '重命名',
        'action.renamed': '改好了',
        'note.renameUnsaved': '先保存再改名，别把刚写的丢了',
        'action.copied': '已复制',
        'action.retry': '重试',
        'search.placeholder': '搜索标题、正文、标签…',
        'search.hint': '可以加限定：tag:录音卡 · dir:随手记 · #私密。多个词要同时命中。',
        'search.jumpToLine': '跳到这一行',
        'batch.pick': '选择这篇',
        'batch.picked': '篇已选',
        'batch.actions': '批量操作',
        'batch.clear': '取消选择',
        'batch.tagPlaceholder': '要添加的标签',
        'batch.addTag': '加标签',
        'batch.dirPlaceholder': '目标目录',
        'batch.move': '移动',
        'batch.delete': '移到回收站',
        'batch.confirmDelete': '确定把这 篇移到回收站？',
        'drop.pickDirFirst': '先在左边选一个目录，再往里拖',
        'drop.moved': '已经挪进这个目录',
        'batch.done': '已处理',
        'search.searching': '搜索中…',
        'search.clear': '清空',
        'tree.all': '全部笔记',
        'tree.dirs': '目录',
        'tree.tags': '标签',
        // 左栏排序：三种视角，用户的库越大越依赖这个
        'tree.sort': '排序',
        'tree.sortTime': '按修改时间',
        'tree.sortName': '按名称',
        'tree.sortCount': '按条数',
        // 三栏拖拽手柄的无障碍名字（视觉上是一条发丝线，读屏要能说出它是什么）
        'col.treeWidth': '调整左栏宽度',
        'col.listWidth': '调整中栏宽度',
        // 目录 / 标签的增删
        'tree.newDir': '新建目录',
        'tree.newDirHint': '输入目录名，多层用 / 分隔',
        'tree.newTag': '新建标签',
        'tree.newTagHint': '输入标签名，回车创建',
        'tree.deleteDir': '删除目录',
        'tree.deleteTag': '删除标签',
        'tree.deleteDirConfirm': '确定删除目录「{name}」？目录里必须没有笔记和子目录。',
        'tree.deleteTagConfirm': '确定删除标签「{name}」？会从所有笔记里移除这个标签，笔记本身不动。',
        'tree.deletedDir': '目录已删除',
        'tree.deletedTag': '标签已移除',
        'tree.dirNotEmpty': '这个目录里还有笔记，先把它们移走',
        'tree.dirCreated': '目录已创建（空目录暂时不显示在列表里）',
        'tree.tagCreated': '标签已添加到当前笔记',
        'tree.tagNeedNote': '先打开一篇笔记再建标签',
        'tree.menuDelete': '删除',
        'tree.menuCancel': '取消',
        'tree.menuRename': '改名',
        'tree.menuReveal': '在文件列表里定位',
        'tree.tagRenamed': '标签已改名',
        'todo.toggle': '点一下勾掉',
        'todo.done': '已勾掉',
        'todo.undone': '已取消勾选',
        'heat.title': '写作热力图',
        'heat.streak': '天连续',
        'heat.unit': '篇',
        'heat.totalHint': '篇（近半年）',
        'empty.noVault': '还没有本地笔记库',
        'empty.noVaultDesc': '先在「设置」里指定一个目录，或者点「导入」把得到大脑的笔记抓下来。',
        'empty.noNotes': '这个目录还没有笔记',
        'list.more': '显示更多',
        'empty.select': '选一篇笔记开始阅读',
        'empty.selectDesc': '左栏是目录，中间是笔记列表。也可以点「新建」写一篇。',
        'empty.search': '没有匹配的笔记',
        'meta.notes': '篇',
        'meta.dirs': '个目录',
        'reader.missing': '文件不存在或已被移动',
        'reader.frontmatter': '属性',
        'import.title': '一次性导入',
        'import.desc':
          '趁得到大脑会员还有效，把云端笔记全量抓成本地 Markdown。之后会员到期、断网、甚至服务下线，这里的笔记都照常能读能改 —— 导入是本插件唯一会联网的动作。',
        'import.loggedIn': '已连接得到大脑',
        'import.notLoggedIn': '未连接',
        'import.login': '登录得到大脑',
        'import.loginHint': '会打开浏览器完成授权，完成后回到这个面板即可。',
        'import.start': '开始导入',
        'import.running': '正在导入…',
        'import.logout': '退出登录',
        'import.result': '导入结果',
        'import.lastSync': '上次导入',
        'import.never': '从未导入',
        'import.done': '完成',
        'import.newNotes': '新增',
        'import.skipped': '已存在跳过',
        'import.failed': '失败',
        'import.authorizeWait': '等待浏览器授权…',
        'import.openLink': '如果没有自动打开，点这里手动授权',
        'import.needLogin': '先登录得到大脑，才能读取云端笔记。',
        'import.cloudHint': '这一步之后就不再需要会员了。',
        'settings.vault': '笔记目录',
        'settings.vaultHint': '相对库根的目录名，比如「得到大脑」或「李欣颀/知识库/得到大脑归档」。只能选库内的目录，插件不会写到库外面去。',
        'settings.save': '保存目录',
        'settings.saved': '已保存',
        'settings.suggest': '在这个位置发现了已有笔记',
        'settings.use': '用这个',
        'settings.authFile': '凭证文件',
        'settings.loggedIn': '已登录',
        'settings.loggedOut': '未登录',
        'settings.loginExpired': '登录已过期',
        'settings.storeHint': '登录凭证只保存在本机 DSH 配置目录，不出现在浏览器里。',
        'theme.title': '面板主题色',
        'theme.desc': '选一个颜色，左栏最深、中栏浅一点、右栏接近白，层次会自动算好。改完点「应用」才会保存。',
        'theme.custom': '自定义颜色',
        'theme.preset': '用预设色',
        'theme.apply': '应用',
        'theme.reset': '恢复默认蓝',
        'theme.saved': '主题色已保存',
        'theme.previewLeft': '左栏',
        'theme.previewMid': '中栏',
        'theme.previewRight': '右栏',
        'error.prefix': '出错了',
        'capture.title': '速记',
        'capture.saved': '已存为笔记',
        'note.created': '已新建',
        'note.saved': '已保存',
        'note.deleted': '已移入回收站',
        'note.unsaved': '有未保存的修改',
        'note.menuOpen': '打开这篇',
        'note.localAudio': '本地录音',
        'note.outline': '本文大纲',
        'note.openImage': '在 Obsidian 里打开这张图',
        'note.attach': '插入附件',
        'attach.added': '附件已插入',
        'attach.failed': '有几个附件没传上去',
        'attach.needNote': '先打开一篇笔记，再往里放文件',
        'note.backlinks': '引用了这篇的笔记',
        'note.outlinks': '这篇引用了',
        'note.fontSize': '字号',
        'panel.loading': '正在读取笔记库…',
        'sync.pushOne': '把这篇推到云端',
        'sync.pullOne': '从云端拉这篇',
        'sync.pushedOne': '已推到云端',
        'sync.pulledOne': '已从云端更新',
        'new.template': '新建什么',
        'new.daily': '日记',
        'new.dailyHint': '今天发生了什么',
        'new.book': '读书笔记',
        'new.bookHint': '书名与感想',
        'new.meeting': '会议记录',
        'new.meetingHint': '讨论与结论',
        'new.note': '随手记',
        'new.noteHint': '只有标题',
        'new.customHint': '用你自己写的骨架',
        'settings.templateTitle': '笔记模板',
        'settings.templateDesc': '自己攒几个常用的骨架，新建时直接选。内置的日记 / 读书 / 会议 / 随手记一直在。',
        'settings.templateName': '模板名',
        'settings.templateNameHint': '新建时菜单里显示这个名字',
        'settings.templateBody': '骨架正文',
        'settings.templateBodyHint': '留空就是只有标题；支持 Markdown',
        'settings.templateAdd': '加一个模板',
        'settings.templateSave': '保存模板',
        'settings.templateSaved': '模板已保存',
        'settings.templateEmpty': '还没有自定义模板',
        'settings.templateLimit': '最多 12 个',
        'settings.templateRemove': '删掉',
        'settings.followTitle': '跟着宿主切换笔记',
        'settings.followDesc': '你在 Obsidian 里翻到哪一篇，开着的面板就跟着打开同一篇，反链和同步状态立刻跟上。面板没开着时不会替你打开它；不在「得到大脑」目录里的笔记也不会跟。',
        'settings.followToggle': '面板跟着我翻',
        'settings.followSaved': '跟随设置已保存',
        'new.bookTitle': '读书笔记',
        'new.meetingTitle': '会议记录',
        'note.fontSize.s': '小字',
        'note.fontSize.m': '标准',
        'note.fontSize.l': '大字',
        'note.wikilinkMissing': '库里找不到「{name}」这篇笔记',
        'note.anchorMissing': '这一篇里没有「{name}」这一节',
        'note.blockRef': '本页某一段',
    'note.footnote': '跳到这条脚注',
        'note.openEmbed': '打开这一篇',
        'note.embedBroken': '这一篇没读出来',
        'callout.expand': '展开',
 'editor.words': '{n} 字',
 'editor.saveHint': 'Ctrl+S 保存 · Esc 取消',
        'callout.collapse': '收起',
        'note.image': '图片',
        'action.close': '关闭',
        'action.back': '返回列表',
        'history.title': '版本历史',
        'history.restore': '恢复这一版',
        'history.empty': '还没有历史版本',
        'history.emptyHint': '保存或删除笔记时插件会自动留一版快照，最多留最近 10 版。',
        'archive.title': '整库备份',
        'archive.desc': '导出成一个 zip（含附件），换电脑或重装时导回来。导入逐篇合并，不覆盖你已有的笔记。',
        'archive.export': '导出 zip',
        'archive.import': '导入 zip',
        'archive.exporting': '正在导出…',
      'archive.exported': '已导出归档包',
      'archive.scope': '导出范围',
      'archive.scopeAll': '整库',
      'archive.scopeNotes': '只要文字',
      'archive.scopeAssets': '只要附件',
        'archive.imported': '导入完成：新增/跳过',
        'archive.importMode': '同名时',
        'archive.mode.rename': '另存一份',
        'archive.mode.skip': '跳过',
        'tab.conflict': '冲突',
        'conflict.desc': '同步时如果云端和本地都改过同一篇，本地版会另存到 .conflicts/，正文用云端版。这里可以并排比对、一键采纳任意一边。采纳后留档不会删，随时可以再换。',
        'conflict.compare': '比对',
        'conflict.keepLocal': '用我的本地版',
        'conflict.takeCloud': '用云端版',
        'conflict.back': '返回',
        'conflict.keptLocal': '已采纳本地版',
        'conflict.tookCloud': '已采纳云端版',
        'conflict.sideLocal': '我的本地版（冲突时存档）',
        'conflict.sideCloud': '云端版（已同步到正本）',
        'conflict.noLocal': '这份留档没有正文。',
        'conflict.noCloud': '库里已经找不到这篇的正本了（可能被改名或删掉了）。',
        'conflict.savedAt': '留档于',
        'conflict.modeRendered': '渲染',
        'conflict.modeRaw': '原文',
        'conflict.empty': '没有待处理的冲突',
        'conflict.emptyHint': '同步时只有「两边都改过同一篇」才会产生冲突。现在没有，说明都对齐了。',
        'conflict.resolvedSection': '已处理',
        'conflict.review': '查看',
        'conflict.pickedLocal': '当初选了本地版',
        'conflict.pickedCloud': '当初选了云端版',
        'conflict.undo': '退回未处理',
        'conflict.undone': '已退回未处理',
        'tab.trash': '回收站',
        'tab.broken': '断链',
        'broken.desc': '这里列出全库「写了双链、但库里没有这一篇」的地方。点一行就打开出问题的那一篇，改掉那个名字就好。',
        'broken.empty': '没有断链',
        'broken.emptyHint': '库里每一条双链都指得到东西。写完新链接顺手回来看一眼就行。',
        'broken.found': '扫了 {scanned} 篇，有 {n} 处指不到。',
        'broken.truncated': '太多了，只列前 500 处。先修掉一些再刷新。',
        'broken.line': '第',
        'trash.desc': '删掉的笔记先放这里，随时可以恢复。恢复只是把文件搬回库里，不碰内容。',
        'trash.empty': '回收站是空的',
        'trash.emptyHint': '在笔记列表里点删除，文件会先到这里。清空才会真的删。',
        'trash.deletedAt': '删除于',
        'trash.restore': '恢复',
        'trash.restored': '已恢复到库里',
        'trash.purgeOne': '永久删除',
        'trash.purgeAll': '清空回收站',
        'trash.purgeConfirm': '清空回收站会真的删掉这些文件，无法撤销。继续？',
        'trash.purgeOneConfirm': '永久删除这个文件，无法撤销。继续？',
        'trash.purged': '已清理',
        'trash.originalName': '原文件',
        'cloud.newNote': '新建云端笔记',
        'cloud.newNoteTitle': '标题',
        'cloud.newNoteBody': '正文',
        'cloud.create': '创建',
        'cloud.created': '已创建',
        'cloud.addTagHint': '输入标签，回车或点加号',
        'cloud.tagAdded': '已加标签',
        'cloud.tagRemoved': '已删标签',
        'cloud.removeTag': '删掉这个标签',
        'cloud.shareLink': '分享链接',
        'cloud.shareCreated': '分享链接已生成',
        'cloud.shareExcludeAudio': '不含录音',
        'cloud.copyLink': '复制链接',
        'cloud.copied': '已复制',
        'cloud.topics': '知识库',
        'cloud.allTopics': '全部云端笔记',
        'cloud.topicNotes': '知识库内的笔记',
        'cloud.pushLocal': '推送本地改动到云端',
        'cloud.pushHint': '把这篇本地笔记的标题和正文覆盖到云端。会改动云端内容，请确认。',
        'cloud.pushed': '已推送到云端',
        // ── 云端（Open API）──
        'tab.cloud': '云端',
        'cloud.title': '云端笔记',
        'cloud.desc': '直接读得到大脑里的内容，可以播放录音、改标题正文、加标签、删到回收站。',
        'cloud.notConfigured': '还没接入得到大脑',
        'cloud.notConfiguredDesc':
          '去「设置 → 云端接入」填 API Key 与 Client ID。在 openapi.biji.com 控制台创建个人开发应用就能拿到这两个值。',
        'cloud.loading': '正在读取云端…',
        'cloud.empty': '云端还没有笔记',
        'cloud.loadMore': '加载更多',
        'cloud.audio': '录音',
        'cloud.play': '播放',
        'cloud.pause': '暂停',
        'cloud.transcript': '逐字稿',
        'cloud.seekTo': '跳到这里播放',
        'cloud.moments': '时间轴',
        'cloud.todos': '待办',
        'cloud.tags': '标签',
        'cloud.editTitle': '标题',
        'cloud.editBody': '正文',
        'cloud.saveCloud': '保存到云端',
        'cloud.savedCloud': '已保存到云端，本地镜像也刷新了',
        'cloud.deleteCloud': '删除（进回收站）',
        'cloud.deletedCloud': '已从云端删除',
        'cloud.addTag': '加标签',
        'cloud.share': '生成分享链接',
        'cloud.polling': '云端详情加载中…',
        'cloud.localCopy': '本地副本',
        'cloud.noLocalCopy': '本地还没有这一篇',
        'cloud.pullOne': '拉到本地',
        // ── 同步 ──
        'sync.title': '自动同步',
        'sync.desc':
          '打开后每隔一段时间自动把云端新增和修改的笔记拉到本地，不需要手动点。本地改过的笔记不会被覆盖；两边都改过会另存一份到 .conflicts 目录。',
        'sync.enabled': '开启自动同步',
        'sync.interval': '同步间隔',
        'sync.minutes': '分钟',
        'sync.incremental': '只同步有变化的（省配额）',
        'sync.foregroundOnly': '只在面板打开时同步',
        'sync.foregroundHint': '关掉面板或合上电脑后不再自动同步，省云端配额。下次打开面板会补上。',
        'sync.now': '立即同步',
        'sync.running': '正在同步…',
        'sync.pushAll': '把本地改动推上去',
        'sync.pushAllHint': '只推本地改过、还没同步上去的笔记。云端的同名笔记正文会被覆盖，请确认那些改动确实是你写的。',
        'sync.pushAllDone': '推送完成',
        'sync.pushAllPushed': '已推',
        'sync.pushAllSkipped': '没改动',
        'sync.pushAllFailed': '失败',
        'sync.pushAllTruncated': '一次最多 200 篇，剩下的再点一次',
        'sync.lastRun': '上次同步',
        'sync.never': '从未同步',
        'sync.result': '同步结果',
        'sync.pulled': '拉取',
        'sync.skipped': '未变化',
        'sync.adopted': '保留本地',
        'sync.conflicts': '冲突',
        'sync.deleted': '已删除',
        'sync.errors': '失败',
        'sync.fullScan': '全量扫描（能发现云端删除，慢且费配额）',
        'sync.quotaHint': '官方配额：读 1000 次/天、写 200 次/天。默认 15 分钟一轮、只拉有变化的，全天也就用掉几十次。',
        'sync.legacy': '旧的一次性导入',
        'sync.legacyHint': 'OAuth 通道，只在没配 API Key 时兜底用。',
        // ── 云端凭证 ──
        'api.title': '云端接入',
        'api.desc': '填自己的 API Key 与 Client ID，插件就能直接操作得到大脑（读笔记、播录音、改内容、自动同步）。',
        'api.apiKey': 'API Key',
        'api.clientId': 'Client ID',
        'api.grantId': '授权 ID（可选，企业代授权才需要）',
        'api.keyPlaceholder': 'gk_live_...',
        'api.idPlaceholder': 'cli_...',
        'api.grantPlaceholder': 'grt_...（留空即可）',
        'api.save': '保存凭证',
        'api.saved': '凭证已保存',
        'api.test': '测试连接',
        'api.testing': '测试中…',
        'api.ok': '连接正常',
        'api.clear': '清除凭证',
        'api.cleared': '凭证已清除',
        'api.ready': '已接入',
        'api.notReady': '未接入',
        'api.missing': '还缺',
        'api.file': '凭证文件',
        'api.consoleHint': '去 openapi.biji.com → 控制台 → 创建个人开发应用，拿到 Client ID；再在 API Key 页生成一个 Key。',
        'api.neverEcho': 'Key 只保存在本机，保存后不会再显示完整内容。',
        'api.needKey': 'API Key 与 Client ID 都要填才能用。',
        'api.keyRejected': '这个 API Key 被服务端拒绝了',
        'api.usingFallback': '还好你登录过得到大脑，现在自动改用登录通道，功能都正常。要修好 Key，去控制台确认它已激活、且应用有对应权限。',
        'api.viaLogin': '当前用的是「登录得到大脑」这条通道，不需要 API Key。',
        'lang.title': '语言',
        'lang.desc': '选面板显示的语言。「自动」跟随 DeepSeek Harness 的语言。',
        'lang.auto': '自动',
        'lang.saved': '语言已保存',
        'tab.card': '录音卡',
        'card.title': '录音卡直连',
        'card.desc': '绕过云端，直接通过蓝牙从录音卡上把音频拉进笔记库。卡片要开机、在 3 米内，并且手机 App 先断开（关掉手机蓝牙即可，不用解绑）。',
        'card.envOk': '环境就绪',
        'card.envMissing': '缺少运行环境',
        'card.envHint': '录音卡直连需要电脑上有 Python 3.10+ 和 bleak 包。装一下：pip install bleak',
        'card.envBridge': '协议桥',
        'card.scan': '扫描录音卡',
        'card.scanning': '正在扫描…',
        'card.scanFound': '找到卡片',
        'card.scanNone': '没扫到卡片。确认卡片已开机、离电脑近一点、手机蓝牙已关。',
        'card.pending': '待导入',
        'card.refresh': '刷新卡片',
        'card.none': '卡片上没有录音。',
        'card.dir': '放进哪个目录',
        'card.dirHint': '留空就放库里已有的「录音卡」目录。',
        'card.deleteAfter': '导入后从卡片上删掉原件',
        'card.deleteAfterHint': '默认不动卡片。打开后导入成功的文件会被永久删除，不能恢复。',
        'card.wifiTitle': '热点快传',
        'card.wifiDesc':
          '让卡片自己开一个热点，电脑连上去直接下载。同样的文件，蓝牙要几十分钟，走热点通常一两分钟。卡片热点没有互联网，传完记得点「退出热点」把网络还回去。',
        'card.wifiAvailable': '扫到像录音卡的热点',
        'card.wifiGo': '开热点并连接',
        'card.wifiBusy': '正在处理…',
        'card.wifiRescan': '刷新网络',
        'card.wifiOff': '退出热点',
        'card.wifiSsid': '热点名（手动）',
        'card.wifiPassword': '密码（没有就留空）',
        'card.wifiJoin': '连这个热点',
        'card.wifiHotspot': '已连热点',
        'card.wifiPorts': '开放端口',
        'card.wifiOn': '已连上卡片热点',
        'card.wifiLeft': '已退出卡片热点',
        'card.wifiNoHotspot': '卡片没有报出热点名。可能这个固件版本不支持热点快传，或者命令码还没对上。',
        'card.wifiFail': '热点快传没成功',
        'card.wifiNeedSsid': '先填一个热点名',
        'card.import': '导入全部录音',
        'card.importing': '正在导入…',
        'card.imported': '导入完成',
        'card.log': '进度',
        'card.downloaded': '已导入',
        'card.skipped': '已存在',
        'card.failed': '失败',
        'card.alreadyRunning': '已经有一个导入在跑了。',
        'card.needPython': '先装好 Python 和 bleak 才能用。',
      },
      en: {
        'panel.title': 'Get笔记',
        'panel.hint': 'Local note vault',
        'panel.toggleTree': 'Folder panel',
        'tab.notes': 'Notes',
        'tab.import': 'Import',
        'tab.settings': 'Settings',
        'action.refresh': 'Refresh',
        'action.new': 'New',
        'action.save': 'Save',
        'action.cancel': 'Cancel',
        'action.edit': 'Edit',
        'action.openInEditor': 'Open in Obsidian',
        'action.delete': 'Delete',
        'action.copyRef': 'Copy reference',
        'action.rename': 'Rename',
        'action.renamed': 'Renamed',
        'note.renameUnsaved': 'Save first, then rename',
        'action.copied': 'Copied',
        'action.retry': 'Retry',
        'search.placeholder': 'Search title, body, tags…',
        'search.hint': 'Narrow it down: tag:voice · dir:notes · #private. All words must match.',
        'search.jumpToLine': 'Jump to this line',
        'batch.pick': 'Select this note',
        'batch.picked': 'selected',
        'batch.actions': 'Batch actions',
        'batch.clear': 'Clear selection',
        'batch.tagPlaceholder': 'Tag to add',
        'batch.addTag': 'Add tag',
        'batch.dirPlaceholder': 'Target folder',
        'batch.move': 'Move',
        'batch.delete': 'Move to trash',
        'batch.confirmDelete': 'Move these notes to trash?',
        'drop.pickDirFirst': 'Pick a folder on the left first, then drop',
        'drop.moved': 'Moved into this folder',
        'batch.done': 'Processed',
        'search.searching': 'Searching…',
        'search.clear': 'Clear',
        'tree.all': 'All notes',
        'tree.dirs': 'Folders',
        'tree.tags': 'Tags',
        'tree.sort': 'Sort',
        'tree.sortTime': 'By modified',
        'tree.sortName': 'By name',
        'tree.sortCount': 'By count',
        'col.treeWidth': 'Resize left column',
        'col.listWidth': 'Resize middle column',
        'tree.newDir': 'New folder',
        'tree.newDirHint': 'Folder name; use / for nesting',
        'tree.newTag': 'New tag',
        'tree.newTagHint': 'Tag name, press Enter',
        'tree.deleteDir': 'Delete folder',
        'tree.deleteTag': 'Delete tag',
        'tree.deleteDirConfirm': 'Delete folder “{name}”? It must be empty first.',
        'tree.deleteTagConfirm': 'Delete tag “{name}”? It is removed from every note; notes stay.',
        'tree.deletedDir': 'Folder deleted',
        'tree.deletedTag': 'Tag removed',
        'tree.dirNotEmpty': 'This folder still has notes — move them out first',
        'tree.dirCreated': 'Folder created (empty folders stay hidden)',
        'tree.tagCreated': 'Tag added to the open note',
        'tree.tagNeedNote': 'Open a note first to add a tag',
        'tree.menuDelete': 'Delete',
        'tree.menuCancel': 'Cancel',
        'tree.menuRename': 'Rename',
        'tree.menuReveal': 'Reveal in file explorer',
        'tree.tagRenamed': 'Tag renamed',
        'todo.toggle': 'Click to tick off',
        'todo.done': 'Ticked off',
        'todo.undone': 'Unchecked',
        'heat.title': 'Writing streak',
        'heat.streak': 'day streak',
        'heat.unit': 'notes',
        'heat.totalHint': 'notes (last 6 months)',
        'empty.noVault': 'No local vault yet',
        'empty.noVaultDesc': 'Pick a folder in Settings, or press Import to pull your notes down.',
        'empty.noNotes': 'No notes in this folder',
        'list.more': 'Show more',
        'empty.select': 'Pick a note to read',
        'empty.selectDesc': 'Folders on the left, notes in the middle. Or press New.',
        'empty.search': 'No matching notes',
        'meta.notes': 'notes',
        'meta.dirs': 'folders',
        'reader.missing': 'File is missing or was moved',
        'reader.frontmatter': 'Properties',
        'import.title': 'One-time import',
        'import.desc':
          'While your subscription still works, pull every cloud note down as local Markdown. Afterwards the notes stay readable and editable — this is the only action in the plugin that touches the network.',
        'import.loggedIn': 'Connected',
        'import.notLoggedIn': 'Not connected',
        'import.login': 'Sign in',
        'import.loginHint': 'A browser window opens for authorization; come back here when done.',
        'import.start': 'Start import',
        'import.running': 'Importing…',
        'import.logout': 'Sign out',
        'import.result': 'Result',
        'import.lastSync': 'Last import',
        'import.never': 'never',
        'import.done': 'Done',
        'import.newNotes': 'new',
        'import.skipped': 'skipped',
        'import.failed': 'failed',
        'import.authorizeWait': 'Waiting for authorization…',
        'import.openLink': 'If no window opened, authorize manually here',
        'import.needLogin': 'Sign in first to read cloud notes.',
        'import.cloudHint': 'After this you no longer need the subscription.',
        'settings.vault': 'Vault folder',
        'settings.vaultHint': 'A folder inside this vault, e.g. "Getnote" or "Notes/Getnote". Only paths inside the vault are allowed.',
        'settings.save': 'Save folder',
        'settings.saved': 'Saved',
        'settings.suggest': 'Found existing notes here',
        'settings.use': 'Use it',
        'settings.authFile': 'Credential file',
        'settings.loggedIn': 'Signed in',
        'settings.loggedOut': 'Not signed in',
        'settings.loginExpired': 'Sign-in expired',
        'settings.storeHint': 'Credentials stay in the local DSH config dir, never in the browser.',
        'theme.title': 'Panel theme color',
        'theme.desc': 'Pick one color — the left pane stays darkest, the middle lighter, the reading pane near white. Depth is derived for you. Click Apply to save.',
        'theme.custom': 'Custom color',
        'theme.preset': 'Use presets',
        'theme.apply': 'Apply',
        'theme.reset': 'Reset to default blue',
        'theme.saved': 'Theme color saved',
        'theme.previewLeft': 'Left',
        'theme.previewMid': 'Middle',
        'theme.previewRight': 'Right',
        'error.prefix': 'Error',
        'capture.title': 'Clipping',
        'capture.saved': 'Saved as a note',
        'note.created': 'Created',
        'note.saved': 'Saved',
        'note.deleted': 'Moved to trash',
        'note.unsaved': 'Unsaved changes',
        'note.menuOpen': 'Open this note',
        'note.localAudio': 'Local recording',
        'note.outline': 'Outline',
        'note.openImage': 'Open this image in Obsidian',
        'note.attach': 'Attach a file',
        'attach.added': 'Attachment inserted',
        'attach.failed': 'Some files could not be uploaded',
        'attach.needNote': 'Open a note first, then drop files into it',
        'note.backlinks': 'Notes linking here',
        'note.outlinks': 'Links from this note',
        'note.fontSize': 'Text size',
        'panel.loading': 'Loading vault…',
        'sync.pushOne': 'Push this note',
        'sync.pullOne': 'Pull this note',
        'sync.pushedOne': 'Pushed to cloud',
        'sync.pulledOne': 'Updated from cloud',
        'new.template': 'Start a new',
        'new.daily': 'Daily note',
        'new.dailyHint': 'What happened today',
        'new.book': 'Book notes',
        'new.bookHint': 'Title and takeaways',
        'new.meeting': 'Meeting',
        'new.meetingHint': 'Discussion and decisions',
        'new.note': 'Quick note',
        'new.noteHint': 'Just a title',
        'new.customHint': 'uses your own skeleton',
        'settings.templateTitle': 'Note templates',
        'settings.templateDesc': 'Save the skeletons you reuse and pick them when creating a note. Daily / Book / Meeting / Quick note are always available.',
        'settings.templateName': 'Template name',
        'settings.templateNameHint': 'Shown in the create menu',
        'settings.templateBody': 'Skeleton body',
        'settings.templateBodyHint': 'Leave empty for a title-only note; Markdown works',
        'settings.templateAdd': 'Add a template',
        'settings.templateSave': 'Save templates',
        'settings.templateSaved': 'Templates saved',
        'settings.templateEmpty': 'No custom templates yet',
        'settings.templateLimit': 'up to 12',
        'settings.templateRemove': 'Remove',
        'settings.followTitle': 'Follow what you open in Obsidian',
        'settings.followDesc': 'Open a note in Obsidian and the panel switches to the same one, with its backlinks and sync state right behind it. The panel will not open itself for you, and notes outside the Get笔记 folder are ignored.',
        'settings.followToggle': 'Keep the panel on the note I open',
        'settings.followSaved': 'Follow setting saved',
        'new.bookTitle': 'Book notes',
        'new.meetingTitle': 'Meeting',
        'note.fontSize.s': 'Small',
        'note.fontSize.m': 'Normal',
        'note.fontSize.l': 'Large',
        'note.wikilinkMissing': 'No note named "{name}" in this vault',
        'note.anchorMissing': 'No section called "{name}" in this note',
        'note.blockRef': 'A paragraph on this page',
    'note.footnote': 'Jump to this footnote',
        'note.openEmbed': 'Open this note',
        'note.embedBroken': 'Could not read this note',
        'callout.expand': 'Expand',
 'editor.words': '{n} words',
 'editor.saveHint': 'Ctrl+S to save · Esc to cancel',
        'callout.collapse': 'Collapse',
        'note.image': 'Image',
        'action.close': 'Close',
        'action.back': 'Back to list',
        'history.title': 'Version history',
        'history.restore': 'Restore this version',
        'history.empty': 'No versions yet',
        'history.emptyHint': 'A snapshot is saved automatically each time you save or delete a note, keeping the latest 10.',
        'archive.title': 'Whole-vault backup',
        'archive.desc': 'Exports one zip (attachments included) so you can restore on another machine. Import merges note by note and never overwrites what you already have.',
        'archive.export': 'Export zip',
        'archive.import': 'Import zip',
        'archive.exporting': 'Exporting…',
      'archive.exported': 'Archive exported',
      'archive.scope': 'Export range',
      'archive.scopeAll': 'Whole vault',
      'archive.scopeNotes': 'Notes only',
      'archive.scopeAssets': 'Attachments only',
        'archive.imported': 'Import done — added/skipped',
        'archive.importMode': 'On name clash',
        'archive.mode.rename': 'Keep both',
        'archive.mode.skip': 'Skip',
        'tab.conflict': 'Conflicts',
        'conflict.desc': 'When both sides changed the same note, the local copy is kept in .conflicts/ and the note body takes the cloud version. Compare them here and adopt either side in one click. The archive is never deleted, so you can switch again later.',
        'conflict.compare': 'Compare',
        'conflict.keepLocal': 'Use my local copy',
        'conflict.takeCloud': 'Use cloud copy',
        'conflict.back': 'Back',
        'conflict.keptLocal': 'Adopted local copy',
        'conflict.tookCloud': 'Adopted cloud copy',
        'conflict.sideLocal': 'My local version (archived at conflict)',
        'conflict.sideCloud': 'Cloud version (now in the live note)',
        'conflict.noLocal': 'This archived copy has no body.',
        'conflict.noCloud': 'The live note is gone from the vault (renamed or deleted).',
        'conflict.savedAt': 'Archived at',
        'conflict.modeRendered': 'Rendered',
        'conflict.modeRaw': 'Raw',
        'conflict.empty': 'No conflicts to resolve',
        'conflict.emptyHint': 'Conflicts only appear when both sides changed the same note. None right now.',
        'conflict.resolvedSection': 'Resolved',
        'conflict.review': 'Review',
        'conflict.pickedLocal': 'you kept local',
        'conflict.pickedCloud': 'you took cloud',
        'conflict.undo': 'Mark unresolved',
        'conflict.undone': 'Marked unresolved',
        'tab.trash': 'Trash',
        'tab.broken': 'Broken links',
        'broken.desc': 'Every place where a note links to something that is not in the vault. Click a row to open the note and fix the name.',
        'broken.empty': 'No broken links',
        'broken.emptyHint': 'Every link in the vault resolves. Check back after writing new ones.',
        'broken.found': 'Scanned {scanned} notes, {n} links go nowhere.',
        'broken.truncated': 'That is a lot — only the first 500 are listed. Fix some and refresh.',
        'broken.line': 'line',
        'trash.desc': 'Deleted notes wait here and can be restored. Restoring just moves the file back.',
        'trash.empty': 'Trash is empty',
        'trash.emptyHint': 'Deleting a note moves it here first. Only purging really deletes it.',
        'trash.deletedAt': 'Deleted',
        'trash.restore': 'Restore',
        'trash.restored': 'Restored into the vault',
        'trash.purgeOne': 'Delete forever',
        'trash.purgeAll': 'Empty trash',
        'trash.purgeConfirm': 'Emptying the trash really deletes these files. Continue?',
        'trash.purgeOneConfirm': 'Delete this file forever. Continue?',
        'trash.purged': 'Purged',
        'trash.originalName': 'Original file',
        'cloud.newNote': 'New cloud note',
        'cloud.newNoteTitle': 'Title',
        'cloud.newNoteBody': 'Body',
        'cloud.create': 'Create',
        'cloud.created': 'Created',
        'cloud.addTagHint': 'Type a tag, press Enter or plus',
        'cloud.tagAdded': 'Tag added',
        'cloud.tagRemoved': 'Tag removed',
        'cloud.removeTag': 'Remove this tag',
        'cloud.shareLink': 'Share link',
        'cloud.shareCreated': 'Share link created',
        'cloud.shareExcludeAudio': 'Exclude audio',
        'cloud.copyLink': 'Copy link',
        'cloud.copied': 'Copied',
        'cloud.topics': 'Knowledge bases',
        'cloud.allTopics': 'All cloud notes',
        'cloud.topicNotes': 'Notes in this knowledge base',
        'cloud.pushLocal': 'Push local changes to cloud',
        'cloud.pushHint': 'Overwrite the cloud title and body with this local note. This changes cloud content.',
        'cloud.pushed': 'Pushed to cloud',
        // ── Cloud (Open API) ──
        'tab.cloud': 'Cloud',
        'cloud.title': 'Cloud notes',
        'cloud.desc': 'Read Get笔记 directly, play recordings, edit text, add tags, delete to trash.',
        'cloud.notConfigured': 'Not connected to Get笔记',
        'cloud.notConfiguredDesc':
          'Add your API Key and Client ID under Settings → Cloud access. Create a personal app at openapi.biji.com to get both.',
        'cloud.loading': 'Loading cloud notes…',
        'cloud.empty': 'No cloud notes yet',
        'cloud.loadMore': 'Load more',
        'cloud.audio': 'Recording',
        'cloud.play': 'Play',
        'cloud.pause': 'Pause',
        'cloud.transcript': 'Transcript',
        'cloud.seekTo': 'Play from here',
        'cloud.moments': 'Timeline',
        'cloud.todos': 'To-dos',
        'cloud.tags': 'Tags',
        'cloud.editTitle': 'Title',
        'cloud.editBody': 'Body',
        'cloud.saveCloud': 'Save to cloud',
        'cloud.savedCloud': 'Saved to cloud; local copy refreshed too',
        'cloud.deleteCloud': 'Delete (to trash)',
        'cloud.deletedCloud': 'Deleted from cloud',
        'cloud.addTag': 'Add tag',
        'cloud.share': 'Create share link',
        'cloud.polling': 'Loading cloud note…',
        'cloud.localCopy': 'Local copy',
        'cloud.noLocalCopy': 'No local copy yet',
        'cloud.pullOne': 'Pull to local',
        // ── Sync ──
        'sync.title': 'Auto sync',
        'sync.desc':
          'When on, new and changed cloud notes are pulled to the local vault on a timer, with no clicking. Locally edited notes are never overwritten; when both sides changed, a copy goes to .conflicts.',
        'sync.enabled': 'Enable auto sync',
        'sync.interval': 'Interval',
        'sync.minutes': 'min',
        'sync.incremental': 'Only sync changes (saves quota)',
        'sync.foregroundOnly': 'Only sync while the panel is open',
        'sync.foregroundHint': 'Stops auto-sync when the panel is closed or the machine sleeps, saving cloud quota. Catches up next time you open it.',
        'sync.now': 'Sync now',
        'sync.running': 'Syncing…',
        'sync.pushAll': 'Push local changes',
        'sync.pushAllHint': 'Only notes you edited locally and have not synced yet are pushed. The cloud copy of the same note will be overwritten — make sure those edits are really yours.',
        'sync.pushAllDone': 'Push finished',
        'sync.pushAllPushed': 'pushed',
        'sync.pushAllSkipped': 'unchanged',
        'sync.pushAllFailed': 'failed',
        'sync.pushAllTruncated': '200 per run at most, click again for the rest',
        'sync.lastRun': 'Last sync',
        'sync.never': 'never',
        'sync.result': 'Result',
        'sync.pulled': 'pulled',
        'sync.skipped': 'unchanged',
        'sync.adopted': 'kept local',
        'sync.conflicts': 'conflicts',
        'sync.deleted': 'deleted',
        'sync.errors': 'failed',
        'sync.fullScan': 'Full scan (detects cloud deletions; slower, uses more quota)',
        'sync.quotaHint': 'Official quota: 1000 reads/day, 200 writes/day. The default 15-minute incremental run uses only dozens.',
        'sync.legacy': 'Legacy one-time import',
        'sync.legacyHint': 'OAuth channel, kept only as a fallback when no API key is set.',
        // ── Cloud credentials ──
        'api.title': 'Cloud access',
        'api.desc': 'Add your own API Key and Client ID so the plugin can drive Get笔记: read notes, play audio, edit, auto-sync.',
        'api.apiKey': 'API Key',
        'api.clientId': 'Client ID',
        'api.grantId': 'Grant ID (optional, enterprise only)',
        'api.keyPlaceholder': 'gk_live_...',
        'api.idPlaceholder': 'cli_...',
        'api.grantPlaceholder': 'grt_... (leave empty)',
        'api.save': 'Save credentials',
        'api.saved': 'Credentials saved',
        'api.test': 'Test connection',
        'api.testing': 'Testing…',
        'api.ok': 'Connection OK',
        'api.clear': 'Clear credentials',
        'api.cleared': 'Credentials cleared',
        'api.ready': 'Connected',
        'api.notReady': 'Not connected',
        'api.missing': 'missing',
        'api.file': 'Credential file',
        'api.consoleHint': 'Create a personal app at openapi.biji.com → console → get the Client ID, then generate a key on the API Key page.',
        'api.neverEcho': 'The key stays on this machine and is never echoed back in full.',
        'api.needKey': 'Both API Key and Client ID are required.',
        'api.keyRejected': 'This API key was rejected by the server',
        'api.usingFallback': 'Your Get笔记 login still works, so the plugin switched to that channel automatically. To fix the key, check in the console that it is active and the app has the right scopes.',
        'api.viaLogin': 'Currently using the "sign in to Get笔记" channel — no API key needed.',
        'lang.title': 'Language',
        'lang.desc': 'Choose the language for this panel. Automatic follows DeepSeek Harness.',
        'lang.auto': 'Automatic',
        'lang.saved': 'Language saved',
        'tab.card': 'Recorder',
        'card.title': 'Recorder card (direct)',
        'card.desc': 'Skip the cloud — pull audio straight off the recorder card over Bluetooth. The card must be on, within about 3 metres, and the phone app disconnected (just turn off phone Bluetooth; no need to unbind).',
        'card.envOk': 'Ready',
        'card.envMissing': 'Runtime missing',
        'card.envHint': 'Direct card access needs Python 3.10+ and the bleak package on this computer. Install with: pip install bleak',
        'card.envBridge': 'Protocol bridge',
        'card.scan': 'Scan for card',
        'card.scanning': 'Scanning…',
        'card.scanFound': 'Card found',
        'card.scanNone': 'No card found. Make sure it is powered on, close to the computer, and phone Bluetooth is off.',
        'card.pending': 'Waiting',
        'card.refresh': 'Refresh card',
        'card.none': 'No recordings on the card.',
        'card.dir': 'Import into folder',
        'card.dirHint': 'Leave empty to use the existing "Recorder" folder in the vault.',
        'card.deleteAfter': 'Delete originals from the card after import',
        'card.deleteAfterHint': 'The card is left untouched by default. When enabled, imported files are deleted permanently.',
        'card.wifiTitle': 'Wi-Fi transfer',
        'card.wifiDesc':
          'Let the card start its own hotspot and download over it. The same files take tens of minutes over Bluetooth and one or two minutes over Wi-Fi. The card hotspot has no internet — tap "Leave hotspot" when you are done.',
        'card.wifiAvailable': 'Hotspots that look like the card',
        'card.wifiGo': 'Start hotspot and connect',
        'card.wifiBusy': 'Working…',
        'card.wifiRescan': 'Refresh network',
        'card.wifiOff': 'Leave hotspot',
        'card.wifiSsid': 'Hotspot name (manual)',
        'card.wifiPassword': 'Password (blank if none)',
        'card.wifiJoin': 'Join this hotspot',
        'card.wifiHotspot': 'Connected to',
        'card.wifiPorts': 'Open ports',
        'card.wifiOn': 'Connected to the card hotspot',
        'card.wifiLeft': 'Left the card hotspot',
        'card.wifiNoHotspot': 'The card did not report a hotspot. This firmware may not support it, or the command code is not matched yet.',
        'card.wifiFail': 'Wi-Fi transfer did not start',
        'card.wifiNeedSsid': 'Enter a hotspot name first',
        'card.import': 'Import all recordings',
        'card.importing': 'Importing…',
        'card.imported': 'Import finished',
        'card.log': 'Progress',
        'card.downloaded': 'Imported',
        'card.skipped': 'Already there',
        'card.failed': 'Failed',
        'card.alreadyRunning': 'An import is already running.',
        'card.needPython': 'Install Python and bleak first.',
      },
      nl: {
        'panel.title': 'Get笔记',
        'panel.hint': 'Lokale notitiemap',
        'panel.toggleTree': 'Mappenpaneel',
        'tab.notes': 'Notities',
        'tab.import': 'Importeren',
        'tab.settings': 'Instellingen',
        'action.refresh': 'Vernieuwen',
        'action.new': 'Nieuw',
        'action.save': 'Opslaan',
        'action.cancel': 'Annuleren',
        'action.edit': 'Bewerken',
        'action.openInEditor': 'Openen in Obsidian',
        'action.delete': 'Verwijderen',
        'action.copyRef': 'Referentie kopiëren',
        'action.rename': 'Naam wijzigen',
        'action.renamed': 'Naam gewijzigd',
        'note.renameUnsaved': 'Sla eerst op en wijzig dan de naam',
        'action.copied': 'Gekopieerd',
        'action.retry': 'Opnieuw',
        'search.placeholder': 'Zoek titel, tekst, tags…',
        'search.hint': 'Verfijn: tag:spraak · dir:notities · #privé. Alle woorden moeten voorkomen.',
        'search.jumpToLine': 'Naar deze regel',
        'batch.pick': 'Deze notitie selecteren',
        'batch.picked': 'geselecteerd',
        'batch.actions': 'Bulkacties',
        'batch.clear': 'Selectie wissen',
        'batch.tagPlaceholder': 'Tag om toe te voegen',
        'batch.addTag': 'Tag toevoegen',
        'batch.dirPlaceholder': 'Doelmap',
        'batch.move': 'Verplaatsen',
        'batch.delete': 'Naar prullenbak',
        'batch.confirmDelete': 'Deze notities naar de prullenbak verplaatsen?',
        'drop.pickDirFirst': 'Kies eerst links een map en sleep dan hierheen',
        'drop.moved': 'Naar deze map verplaatst',
        'batch.done': 'Verwerkt',
        'search.searching': 'Zoeken…',
        'search.clear': 'Wissen',
        'tree.all': 'Alle notities',
        'tree.dirs': 'Mappen',
        'tree.tags': 'Tags',
        'tree.sort': 'Sorteren',
        'tree.sortTime': 'Op gewijzigd',
        'tree.sortName': 'Op naam',
        'tree.sortCount': 'Op aantal',
        'col.treeWidth': 'Linkerkolom breder of smaller maken',
        'col.listWidth': 'Middenkolom breder of smaller maken',
        'tree.newDir': 'Nieuwe map',
        'tree.newDirHint': 'Mapnaam; gebruik / voor submappen',
        'tree.newTag': 'Nieuwe tag',
        'tree.newTagHint': 'Tagnaam, druk op Enter',
        'tree.deleteDir': 'Map verwijderen',
        'tree.deleteTag': 'Tag verwijderen',
        'tree.deleteDirConfirm': 'Map ‘{name}’ verwijderen? De map moet eerst leeg zijn.',
        'tree.deleteTagConfirm': 'Tag ‘{name}’ verwijderen? Hij verdwijnt uit elke notitie; de notities blijven.',
        'tree.deletedDir': 'Map verwijderd',
        'tree.deletedTag': 'Tag verwijderd',
        'tree.dirNotEmpty': 'Er staan nog notities in deze map — verplaats ze eerst',
        'tree.dirCreated': 'Map aangemaakt (lege mappen blijven verborgen)',
        'tree.tagCreated': 'Tag toegevoegd aan de geopende notitie',
        'tree.tagNeedNote': 'Open eerst een notitie om een tag toe te voegen',
        'tree.menuDelete': 'Verwijderen',
        'tree.menuCancel': 'Annuleren',
        'tree.menuRename': 'Naam wijzigen',
        'tree.menuReveal': 'Toon in bestandsverkenner',
        'tree.tagRenamed': 'Tag hernoemd',
        'todo.toggle': 'Klik om af te vinken',
        'todo.done': 'Afgevinkt',
        'todo.undone': 'Vinkje verwijderd',
        'heat.title': 'Schrijfritme',
        'heat.streak': 'dagen op rij',
        'heat.unit': 'notities',
        'heat.totalHint': 'notities (afgelopen half jaar)',
        'empty.noVault': 'Nog geen lokale map',
        'empty.noVaultDesc': 'Kies een map bij Instellingen, of druk op Importeren om je notities op te halen.',
        'empty.noNotes': 'Geen notities in deze map',
        'list.more': 'Meer tonen',
        'empty.select': 'Kies een notitie om te lezen',
        'empty.selectDesc': 'Mappen links, notities in het midden. Of druk op Nieuw.',
        'empty.search': 'Geen passende notities',
        'meta.notes': 'notities',
        'meta.dirs': 'mappen',
        'reader.missing': 'Bestand ontbreekt of is verplaatst',
        'reader.frontmatter': 'Eigenschappen',
        'import.title': 'Eenmalige import',
        'import.desc': 'Zolang je abonnement loopt, haal je elke cloudnotitie als lokale Markdown binnen. Daarna blijven de notities leesbaar en bewerkbaar — dit is de enige actie in de plug-in die het netwerk gebruikt.',
        'import.loggedIn': 'Verbonden',
        'import.notLoggedIn': 'Niet verbonden',
        'import.login': 'Inloggen',
        'import.loginHint': 'Er opent een browservenster voor de autorisatie; kom daarna hier terug.',
        'import.start': 'Import starten',
        'import.running': 'Importeren…',
        'import.logout': 'Uitloggen',
        'import.result': 'Resultaat',
        'import.lastSync': 'Laatste import',
        'import.never': 'nooit',
        'import.done': 'Klaar',
        'import.newNotes': 'nieuw',
        'import.skipped': 'overgeslagen',
        'import.failed': 'mislukt',
        'import.authorizeWait': 'Wachten op autorisatie…',
        'import.openLink': 'Is er geen venster geopend? Autoriseer dan hier handmatig',
        'import.needLogin': 'Log eerst in om cloudnotities te lezen.',
        'import.cloudHint': 'Hierna heb je het abonnement niet meer nodig.',
        'settings.vault': 'Notitiemap',
        'settings.vaultHint': 'Een map binnen deze vault, bijvoorbeeld "Getnote" of "Notities/Getnote". Alleen paden binnen de vault zijn toegestaan.',
        'settings.save': 'Map opslaan',
        'settings.saved': 'Opgeslagen',
        'settings.suggest': 'Hier zijn bestaande notities gevonden',
        'settings.use': 'Gebruiken',
        'settings.authFile': 'Inloggegevens',
        'settings.loggedIn': 'Ingelogd',
        'settings.loggedOut': 'Niet ingelogd',
        'settings.loginExpired': 'Inlog verlopen',
        'settings.storeHint': 'Inloggegevens blijven in de lokale DSH-configuratiemap, nooit in de browser.',
        'theme.title': 'Themakleur van het paneel',
        'theme.desc': 'Kies één kleur — het linkerpaneel blijft het donkerst, het midden lichter, het leespaneel bijna wit. De diepte wordt voor je berekend. Klik op Toepassen om op te slaan.',
        'theme.custom': 'Eigen kleur',
        'theme.preset': 'Voorinstellingen',
        'theme.apply': 'Toepassen',
        'theme.reset': 'Terug naar standaardblauw',
        'theme.saved': 'Themakleur opgeslagen',
        'theme.previewLeft': 'Links',
        'theme.previewMid': 'Midden',
        'theme.previewRight': 'Rechts',
        'error.prefix': 'Fout',
        'capture.title': 'Knipsel',
        'capture.saved': 'Opgeslagen als notitie',
        'note.created': 'Aangemaakt',
        'note.saved': 'Opgeslagen',
        'note.deleted': 'Naar prullenbak',
        'note.unsaved': 'Niet-opgeslagen wijzigingen',
        'note.menuOpen': 'Deze notitie openen',
        'note.localAudio': 'Lokale opname',
        'note.outline': 'Overzicht',
        'note.openImage': 'Open deze afbeelding in Obsidian',
        'note.attach': 'Bestand toevoegen',
        'attach.added': 'Bijlage ingevoegd',
        'attach.failed': 'Sommige bestanden zijn niet geüpload',
        'attach.needNote': 'Open eerst een notitie en zet daar bestanden in',
        'note.backlinks': 'Notities die hierheen linken',
        'note.outlinks': 'Links uit deze notitie',
        'note.fontSize': 'Tekstgrootte',
        'panel.loading': 'Notitiemap laden…',
        'sync.pushOne': 'Deze notitie pushen',
        'sync.pullOne': 'Deze notitie ophalen',
        'sync.pushedOne': 'Naar de cloud gepusht',
        'sync.pulledOne': 'Bijgewerkt vanuit de cloud',
        'new.template': 'Begin met een',
        'new.daily': 'Dagnotitie',
        'new.dailyHint': 'Wat er vandaag gebeurde',
        'new.book': 'Boeknotities',
        'new.bookHint': 'Titel en inzichten',
        'new.meeting': 'Vergadering',
        'new.meetingHint': 'Overleg en besluiten',
        'new.note': 'Snelnotitie',
        'new.noteHint': 'Alleen een titel',
        'new.customHint': 'gebruikt je eigen skelet',
        'settings.templateTitle': 'Notitiesjablonen',
        'settings.templateDesc': 'Bewaar skeletten die je vaker gebruikt en kies ze bij het aanmaken. Dagboek / Boek / Vergadering / Losse notitie staan er altijd.',
        'settings.templateName': 'Sjabloonnaam',
        'settings.templateNameHint': 'Deze naam zie je in het aanmaakmenu',
        'settings.templateBody': 'Skeletinhoud',
        'settings.templateBodyHint': 'Leeg laten = alleen een titel; Markdown werkt',
        'settings.templateAdd': 'Sjabloon toevoegen',
        'settings.templateSave': 'Sjablonen opslaan',
        'settings.templateSaved': 'Sjablonen opgeslagen',
        'settings.templateEmpty': 'Nog geen eigen sjablonen',
        'settings.templateLimit': 'maximaal 12',
        'settings.templateRemove': 'Verwijderen',
        'settings.followTitle': 'Volg wat je in Obsidian opent',
        'settings.followDesc': 'Open je een notitie in Obsidian, dan springt het paneel naar dezelfde, met de verwijzingen en de synchronisatiestatus erachteraan. Het paneel opent zichzelf niet en notities buiten de map Get笔记 worden genegeerd.',
        'settings.followToggle': 'Laat het paneel mijn notitie volgen',
        'settings.followSaved': 'Volginstelling opgeslagen',
        'new.bookTitle': 'Boeknotities',
        'new.meetingTitle': 'Vergadering',
        'note.fontSize.s': 'Klein',
        'note.fontSize.m': 'Normaal',
        'note.fontSize.l': 'Groot',
        'note.wikilinkMissing': 'Geen notitie met de naam ‘{name}’ in deze map',
        'note.anchorMissing': 'Geen kop met de naam ‘{name}’ in deze notitie',
        'note.blockRef': 'Een alinea op deze pagina',
    'note.footnote': 'Naar deze voetnoot',
        'note.openEmbed': 'Open deze notitie',
        'note.embedBroken': 'Deze notitie kon niet gelezen worden',
        'callout.expand': 'Uitvouwen',
 'editor.words': '{n} woorden',
 'editor.saveHint': 'Ctrl+S om op te slaan · Esc om te annuleren',
        'callout.collapse': 'Invouwen',
        'note.image': 'Afbeelding',
        'action.close': 'Sluiten',
        'action.back': 'Terug naar lijst',
        'history.title': 'Versiegeschiedenis',
        'history.restore': 'Deze versie herstellen',
        'history.empty': 'Nog geen versies',
        'history.emptyHint': 'Bij elke keer opslaan of verwijderen wordt automatisch een momentopname bewaard; de laatste 10 blijven staan.',
        'archive.title': 'Volledige back-up van de map',
        'archive.desc': 'Exporteert één zip (bijlagen inbegrepen) zodat je op een andere machine kunt herstellen. Importeren voegt notitie voor notitie samen en overschrijft nooit wat je al hebt.',
        'archive.export': 'Zip exporteren',
        'archive.import': 'Zip importeren',
        'archive.exporting': 'Exporteren…',
      'archive.exported': 'Archief geëxporteerd',
      'archive.scope': 'Exportbereik',
      'archive.scopeAll': 'Hele kluis',
      'archive.scopeNotes': 'Alleen notities',
      'archive.scopeAssets': 'Alleen bijlagen',
        'archive.imported': 'Import klaar — toegevoegd/overgeslagen',
        'archive.importMode': 'Bij naamconflict',
        'archive.mode.rename': 'Beide houden',
        'archive.mode.skip': 'Overslaan',
        'tab.conflict': 'Conflicten',
        'conflict.desc': 'Als beide kanten dezelfde notitie hebben gewijzigd, blijft de lokale kopie in .conflicts/ staan en krijgt de notitie zelf de cloudversie. Vergelijk ze hier en neem met één klik een kant over. Het archief wordt nooit verwijderd, dus je kunt later opnieuw kiezen.',
        'conflict.compare': 'Vergelijken',
        'conflict.keepLocal': 'Mijn lokale kopie gebruiken',
        'conflict.takeCloud': 'Cloudversie gebruiken',
        'conflict.back': 'Terug',
        'conflict.keptLocal': 'Lokale kopie overgenomen',
        'conflict.tookCloud': 'Cloudversie overgenomen',
        'conflict.sideLocal': 'Mijn lokale versie (gearchiveerd bij conflict)',
        'conflict.sideCloud': 'Cloudversie (staat nu in de notitie)',
        'conflict.noLocal': 'Deze gearchiveerde kopie heeft geen tekst.',
        'conflict.noCloud': 'De notitie zelf is uit de map verdwenen (hernoemd of verwijderd).',
        'conflict.savedAt': 'Gearchiveerd op',
        'conflict.modeRendered': 'Weergegeven',
        'conflict.modeRaw': 'Ruw',
        'conflict.empty': 'Geen conflicten om op te lossen',
        'conflict.emptyHint': 'Conflicten ontstaan alleen als beide kanten dezelfde notitie wijzigen. Nu geen.',
        'conflict.resolvedSection': 'Afgehandeld',
        'conflict.review': 'Bekijken',
        'conflict.pickedLocal': 'je koos lokaal',
        'conflict.pickedCloud': 'je koos cloud',
        'conflict.undo': 'Terugzetten op onafgehandeld',
        'conflict.undone': 'Teruggezet op onafgehandeld',
        'tab.trash': 'Prullenbak',
        'tab.broken': 'Dode links',
        'broken.desc': 'Elke plek waar een notitie naar iets linkt dat niet in de map staat. Klik op een regel om de notitie te openen en de naam te herstellen.',
        'broken.empty': 'Geen dode links',
        'broken.emptyHint': 'Elke link in de map wijst ergens naar. Kom later terug na nieuwe links.',
        'broken.found': '{scanned} notities gescand, {n} links wijzen nergens heen.',
        'broken.truncated': 'Dat zijn er veel — alleen de eerste 500 staan er. Herstel er een paar en vernieuw.',
        'broken.line': 'regel',
        'trash.desc': 'Verwijderde notities wachten hier en kunnen worden hersteld. Herstellen zet het bestand gewoon terug.',
        'trash.empty': 'De prullenbak is leeg',
        'trash.emptyHint': 'Een notitie verwijderen verplaatst hem eerst hierheen. Pas leegmaken verwijdert echt.',
        'trash.deletedAt': 'Verwijderd',
        'trash.restore': 'Herstellen',
        'trash.restored': 'Teruggezet in de map',
        'trash.purgeOne': 'Voorgoed verwijderen',
        'trash.purgeAll': 'Prullenbak leegmaken',
        'trash.purgeConfirm': 'Leegmaken verwijdert deze bestanden echt. Doorgaan?',
        'trash.purgeOneConfirm': 'Dit bestand voorgoed verwijderen. Doorgaan?',
        'trash.purged': 'Verwijderd',
        'trash.originalName': 'Oorspronkelijk bestand',
        'cloud.newNote': 'Nieuwe cloudnotitie',
        'cloud.newNoteTitle': 'Titel',
        'cloud.newNoteBody': 'Tekst',
        'cloud.create': 'Aanmaken',
        'cloud.created': 'Aangemaakt',
        'cloud.tags': 'Tags',
        'cloud.addTagHint': 'Typ een tag, druk op Enter of plus',
        'cloud.tagAdded': 'Tag toegevoegd',
        'cloud.tagRemoved': 'Tag verwijderd',
        'cloud.removeTag': 'Deze tag verwijderen',
        'cloud.shareLink': 'Deellink',
        'cloud.shareCreated': 'Deellink aangemaakt',
        'cloud.shareExcludeAudio': 'Audio uitsluiten',
        'cloud.copyLink': 'Link kopiëren',
        'cloud.copied': 'Gekopieerd',
        'cloud.topics': 'Kennisbanken',
        'cloud.allTopics': 'Alle cloudnotities',
        'cloud.topicNotes': 'Notities in deze kennisbank',
        'cloud.pushLocal': 'Lokale wijzigingen naar de cloud pushen',
        'cloud.pushHint': 'Overschrijft de cloudtitel en -tekst met deze lokale notitie. Dit wijzigt cloudinhoud.',
        'cloud.pushed': 'Naar de cloud gepusht',
        'tab.cloud': 'Cloud',
        'cloud.title': 'Cloudnotities',
        'cloud.desc': 'Lees Get笔记 direct, speel opnames af, bewerk tekst, voeg tags toe, verwijder naar de prullenbak.',
        'cloud.notConfigured': 'Niet verbonden met Get笔记',
        'cloud.notConfiguredDesc': 'Voeg je API Key en Client ID toe onder Instellingen → Cloudtoegang. Maak een persoonlijke app op openapi.biji.com om beide te krijgen.',
        'cloud.loading': 'Cloudnotities laden…',
        'cloud.empty': 'Nog geen cloudnotities',
        'cloud.loadMore': 'Meer laden',
        'cloud.audio': 'Opname',
        'cloud.play': 'Afspelen',
        'cloud.pause': 'Pauzeren',
        'cloud.transcript': 'Transcript',
        'cloud.seekTo': 'Speel vanaf hier',
        'cloud.moments': 'Tijdlijn',
        'cloud.todos': 'Taken',
        'cloud.editTitle': 'Titel',
        'cloud.editBody': 'Tekst',
        'cloud.saveCloud': 'Naar de cloud opslaan',
        'cloud.savedCloud': 'Naar de cloud opgeslagen; lokale kopie bijgewerkt',
        'cloud.deleteCloud': 'Verwijderen (naar prullenbak)',
        'cloud.deletedCloud': 'Uit de cloud verwijderd',
        'cloud.addTag': 'Tag toevoegen',
        'cloud.share': 'Deellink aanmaken',
        'cloud.polling': 'Cloudnotitie laden…',
        'cloud.localCopy': 'Lokale kopie',
        'cloud.noLocalCopy': 'Nog geen lokale kopie',
        'cloud.pullOne': 'Lokaal ophalen',
        'sync.title': 'Automatisch synchroniseren',
        'sync.desc': 'Als dit aan staat, worden nieuwe en gewijzigde cloudnotities volgens een schema naar de lokale map gehaald, zonder klikken. Lokaal bewerkte notities worden nooit overschreven; als beide kanten zijn gewijzigd, gaat er een kopie naar .conflicts.',
        'sync.enabled': 'Automatisch synchroniseren aanzetten',
        'sync.interval': 'Interval',
        'sync.minutes': 'min',
        'sync.incremental': 'Alleen wijzigingen (bespaart quotum)',
        'sync.foregroundOnly': 'Alleen synchroniseren als het paneel open is',
        'sync.foregroundHint': 'Stopt met automatisch synchroniseren als het paneel dicht is of de machine slaapt, wat cloudquotum bespaart. De volgende keer wordt het ingehaald.',
        'sync.now': 'Nu synchroniseren',
        'sync.running': 'Synchroniseren…',
        'sync.pushAll': 'Lokale wijzigingen pushen',
        'sync.pushAllHint': 'Alleen notities die je lokaal hebt gewijzigd en nog niet gesynchroniseerd zijn worden gepusht. De cloudversie van dezelfde notitie wordt overschreven — controleer of die wijzigingen echt van jou zijn.',
        'sync.pushAllDone': 'Push voltooid',
        'sync.pushAllPushed': 'gepusht',
        'sync.pushAllSkipped': 'onveranderd',
        'sync.pushAllFailed': 'mislukt',
        'sync.pushAllTruncated': 'maximaal 200 per keer, klik nog eens voor de rest',
        'sync.lastRun': 'Laatste sync',
        'sync.never': 'nooit',
        'sync.result': 'Resultaat',
        'sync.pulled': 'opgehaald',
        'sync.skipped': 'onveranderd',
        'sync.adopted': 'lokaal gehouden',
        'sync.conflicts': 'conflicten',
        'sync.deleted': 'verwijderd',
        'sync.errors': 'mislukt',
        'sync.fullScan': 'Volledige scan (vindt cloudverwijderingen; langzamer, meer quotum)',
        'sync.quotaHint': 'Officieel quotum: 1000 leesacties per dag, 200 schrijfacties per dag. De standaard run elke 15 minuten gebruikt er maar tientallen.',
        'sync.legacy': 'Oude eenmalige import',
        'sync.legacyHint': 'OAuth-kanaal, alleen bewaard als terugvaloptie wanneer er geen API-sleutel is ingesteld.',
        'api.title': 'Cloudtoegang',
        'api.desc': 'Voeg je eigen API Key en Client ID toe zodat de plug-in Get笔记 kan aansturen: notities lezen, audio afspelen, bewerken, automatisch synchroniseren.',
        'api.apiKey': 'API Key',
        'api.clientId': 'Client ID',
        'api.grantId': 'Grant ID (optioneel, alleen enterprise)',
        'api.keyPlaceholder': 'gk_live_...',
        'api.idPlaceholder': 'cli_...',
        'api.grantPlaceholder': 'grt_... (leeg laten)',
        'api.save': 'Inloggegevens opslaan',
        'api.saved': 'Inloggegevens opgeslagen',
        'api.test': 'Verbinding testen',
        'api.testing': 'Testen…',
        'api.ok': 'Verbinding oké',
        'api.clear': 'Inloggegevens wissen',
        'api.cleared': 'Inloggegevens gewist',
        'api.ready': 'Verbonden',
        'api.notReady': 'Niet verbonden',
        'api.missing': 'ontbreekt',
        'api.file': 'Bestand met inloggegevens',
        'api.consoleHint': 'Maak een persoonlijke app op openapi.biji.com → console → haal de Client ID op en genereer daarna een sleutel op de API Key-pagina.',
        'api.neverEcho': 'De sleutel blijft op deze machine en wordt nooit volledig teruggegeven.',
        'api.needKey': 'Zowel API Key als Client ID zijn verplicht.',
        'api.keyRejected': 'Deze API-sleutel is door de server geweigerd',
        'api.usingFallback': 'Je Get笔记-login werkt nog, dus de plug-in is automatisch op dat kanaal overgestapt. Controleer in de console of de sleutel actief is en de app de juiste scopes heeft.',
        'api.viaLogin': 'Je gebruikt nu het kanaal ‘inloggen bij Get笔记’ — geen API-sleutel nodig.',
        'lang.title': 'Taal',
        'lang.desc': 'Kies de taal van het paneel. Automatisch volgt de taal van DeepSeek Harness.',
        'lang.auto': 'Automatisch',
        'lang.saved': 'Taal opgeslagen',
        'tab.card': 'Recordercard',
        'card.title': 'Recordercard (direct)',
        'card.desc': 'Sla de cloud over — haal audio rechtstreeks via bluetooth van de recordercard. De kaart moet aan staan, binnen ongeveer 3 meter, en de telefoon-app moet losgekoppeld zijn (zet gewoon bluetooth op je telefoon uit; ontkoppelen is niet nodig).',
        'card.envOk': 'Klaar voor gebruik',
        'card.envMissing': 'Runtime ontbreekt',
        'card.envHint': 'Directe toegang tot de kaart vereist Python 3.10+ en het bleak-pakket op deze computer. Installeren met: pip install bleak',
        'card.envBridge': 'Protocolbrug',
        'card.scan': 'Kaart zoeken',
        'card.scanning': 'Bezig met zoeken…',
        'card.scanFound': 'Kaart gevonden',
        'card.scanNone': 'Geen kaart gevonden. Controleer of hij aan staat, dichtbij is en bluetooth op je telefoon uit staat.',
        'card.pending': 'Te importeren',
        'card.refresh': 'Kaart verversen',
        'card.none': 'Geen opnames op de kaart.',
        'card.dir': 'Importeer in map',
        'card.dirHint': 'Laat leeg om de bestaande map “Recordercard” in de kluis te gebruiken.',
        'card.deleteAfter': 'Verwijder originelen van de kaart na import',
        'card.deleteAfterHint': 'De kaart blijft standaard ongemoeid. Ingeschakeld worden geïmporteerde bestanden permanent verwijderd.',
        'card.wifiTitle': 'Wifi-overdracht',
        'card.wifiDesc':
          'Laat de kaart zijn eigen hotspot starten en download eroverheen. Dezelfde bestanden kosten tientallen minuten via Bluetooth en een paar minuten via wifi. De hotspot heeft geen internet — tik op "Hotspot verlaten" als je klaar bent.',
        'card.wifiAvailable': 'Hotspots die op de kaart lijken',
        'card.wifiGo': 'Hotspot starten en verbinden',
        'card.wifiBusy': 'Bezig…',
        'card.wifiRescan': 'Netwerk verversen',
        'card.wifiOff': 'Hotspot verlaten',
        'card.wifiSsid': 'Hotspotnaam (handmatig)',
        'card.wifiPassword': 'Wachtwoord (leeg als er geen is)',
        'card.wifiJoin': 'Met deze hotspot verbinden',
        'card.wifiHotspot': 'Verbonden met',
        'card.wifiPorts': 'Open poorten',
        'card.wifiOn': 'Verbonden met de kaarthotspot',
        'card.wifiLeft': 'Kaarthotspot verlaten',
        'card.wifiNoHotspot': 'De kaart meldde geen hotspot. Deze firmware ondersteunt het misschien niet, of de commandocode klopt nog niet.',
        'card.wifiFail': 'Wifi-overdracht startte niet',
        'card.wifiNeedSsid': 'Vul eerst een hotspotnaam in',
        'card.import': 'Alle opnames importeren',
        'card.importing': 'Bezig met importeren…',
        'card.imported': 'Import voltooid',
        'card.log': 'Voortgang',
        'card.downloaded': 'Geïmporteerd',
        'card.skipped': 'Al aanwezig',
        'card.failed': 'Mislukt',
        'card.alreadyRunning': 'Er loopt al een import.',
        'card.needPython': 'Installeer eerst Python en bleak.',
      },
    }

    /**
     * 面板语言：'zh' | 'en' | 'nl'，null 表示「跟随宿主」。
     *
     * 放模块级而不是组件 state：t() 是到处在用的闭包，语言一变所有调用点
     * 都得换字典。组件那边靠 locale state 触发重渲染，这里只负责「查哪本字典」。
     */
    let uiLocale = null

    /**
     * 宿主界面语言，由 main.js 注入（Obsidian 的 moment.locale()）。
     *
     * 不能在这里直接读 moment：面板的离线测试跑在纯 Node 里，没有 obsidian
     * 模块。注入一个值、拿不到就当 null（最后兜中文），两处都能跑。
     */
    let hostLocale = null

    /** 注入宿主语言；认不出的语言当 null。 */
    export function setHostLocale(value) {
      const raw = typeof value === 'string' ? value.toLowerCase().split(/[-_]/)[0] : ''
      hostLocale = raw === 'zh' || raw === 'en' || raw === 'nl' ? raw : null
    }

    /** 设置面板语言；传 null 恢复「跟随宿主」。非法值一律当 null。 */
    function setUiLocale(value) {
      uiLocale = value === 'zh' || value === 'en' || value === 'nl' ? value : null
    }

    /** 当前实际生效的语言（供语言选择器显示「哪一项是选中的」） */
    function activeUiLocale() {
      return uiLocale
    }

    /**
     * 面板此刻该用哪本字典。
     *
     * 顺序：用户显式选的 → 宿主界面语言 → 中文。宿主的 locale 服务（DSH 版
     * 才有的 ctx.locale）比注入值更准，所以放在注入值前面。
     */
    function resolveLocale() {
      if (uiLocale !== null) return uiLocale
      if (hostLocale !== null) return hostLocale
      return null
    }

    /**
     * 取文案：用户显式选过语言就查那本字典，否则优先问宿主 locale，最后兜中文。
     *
     * bind 在每次调用时才解析，不在 apply 时缓存：apply 早于 locale 就绪是常态，
     * 缓存下来的 bound 会永远返回 key，界面就整片英文键名了。
     */
    let boundCtx = null
    function setLocaleCtx(ctx) {
      boundCtx = ctx
    }
    function makeT(ctx) {
      const bound = () => {
        // ctx 优先，其次用 apply 时记下的那个；都在调用时才解析，
        // 这样 locale 服务晚于 apply 就绪也照样能取到文案
        const host = ctx || boundCtx
        if (!host || !host.locale || typeof host.locale.bind !== 'function') return null
        try {
          return host.locale.bind(NS)
        } catch {
          return null
        }
      }
      return (key) => {
        // 用户在设置里显式选了语言，就以它为准——不能先问宿主：
        // 宿主 locale 是中文时会把「改成英文」这个选择直接顶回去。
        const picked = resolveLocale()
        if (picked !== null) {
          const dict = LEX[picked]
          if (dict && typeof dict[key] === 'string') return dict[key]
        }
        const translate = bound()
        if (translate) {
          try {
            const text = translate(key)
            if (typeof text === 'string' && text !== key && text !== '') return text
          } catch {
            // 宿主 locale 未就绪：落到内置字典
          }
        }
        return LEX.zh[key] || key
      }
    }

    // 组件里拿文案的入口：apply 时记下真实 ctx，取不到时用内置中文兜底
    let panelT = null
    function getT() {
      if (panelT === null) panelT = makeT(undefined)
      return panelT
    }

    // ── HTTP ──────────────────────────────────────────────────────────────────

    /**
     * 调 host 的本地库 API。
     *
     * 保留 `status`：调用方要能区分「路由不存在」（宿主还没重启 / 插件没装好）
     * 和业务失败，否则两者都会被显示成「空库」，用户会以为笔记丢了。
     */
    // 同一类请求只留最新的一次：用户快速连点、或输入搜索词时，先发出去的
    // 请求可能后回来，把新结果盖成旧的（经典竞态）。按「路径去掉查询参数」
    // 分组，每组新请求发出时 abort 掉上一个。
    const inflight = new Map()

    /**
     * 一次用户动作的幂等号。
     *
     * 双击、断网后手动重试、两个窗口同时点——都会让「新建一篇笔记」变成两篇。
     * 每个动作在**开始那一刻**取一个 id，重试时复用同一个，服务端认 id 去重。
     * 不能用请求发出时现生成：那样每次重试都是新 id，等于没有保护。
     */
    function requestId() {
      const bytes = new Uint8Array(8)
      const crypto = typeof window !== 'undefined' ? window.crypto : undefined
      if (crypto && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes)
      else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    }

    /** 退避重试：只重试「网络层没连上」，业务错误（4xx/5xx）立刻抛。 */
    const RETRY_DELAYS = [180, 520]

    function sleep(ms) {
      return new Promise((resolve) => window.setTimeout(resolve, ms))
    }

    async function api(path, init) {
      const options = { ...(init || {}) }
      const method = String(options.method || 'GET').toUpperCase()
      // 写操作不重试、不 abort：重放一次 POST 可能建出两篇笔记。
      const idempotent = method === 'GET'
      const group = String(path).split('?')[0]

      let signal = options.signal
      if (idempotent) {
        const previous = inflight.get(group)
        if (previous !== undefined && typeof previous.abort === 'function') previous.abort()
        const controller = new AbortController()
        inflight.set(group, controller)
        signal = controller.signal
      }

      const headers = { ...(options.headers || {}) }
      if (__apiToken !== '') headers['x-getnote-token'] = __apiToken

      let attempt = 0
      for (;;) {
        try {
          const res = await fetch(`${apiOrigin()}/getnote${path}`, {
            ...options,
            headers,
            signal,
          })
          let json = {}
          try {
            json = await res.json()
          } catch {
            // 非 JSON 响应：保留状态码，让上层给出「宿主版本不匹配」这类可操作提示
          }
          if (!res.ok) {
            const err = new Error((json && json.error) || `HTTP ${res.status}`)
            err.status = res.status
            throw err
          }
          return json
        } catch (error) {
          const aborted =
            error !== null && typeof error === 'object' && (error.name === 'AbortError' || signal.aborted)
          // 被更新的同类请求顶掉了：这是正常流程，静默退出
          if (aborted) throw error
          // 业务错误带 status，说明服务是活的，重试没有意义
          const hasStatus = error !== null && typeof error === 'object' && typeof error.status === 'number'
          const retryable = idempotent && !hasStatus && attempt < RETRY_DELAYS.length
          if (!retryable) throw error
          await sleep(RETRY_DELAYS[attempt])
          attempt += 1
        }
      }
    }

    /**
     * 把一个本地文件传进这篇笔记的附件目录。
     *
     * 不用 api()：它只会 res.json()，而这里要发的是原始字节。走请求头带文件名、
     * 查询串带笔记路径，跟归档导入收 zip 是同一个套路——图片动辄几 MB，套进
     * base64 的 JSON 里要多花三成，服务端的 JSON 上限也只有 256KB。
     */
    async function uploadAsset(notePath, file) {
      const name = String((file && file.name) || '') || 'file'
      const buffer = await file.arrayBuffer()
      const response = await fetch(
        `${apiOrigin()}/getnote/asset/upload?path=${encodeURIComponent(String(notePath || ''))}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/octet-stream',
            // 头里只能放 ASCII，中文文件名得先编码，服务端那边再解回来
            'x-getnote-filename': encodeURIComponent(name),
            ...(__apiToken === '' ? {} : { 'x-getnote-token': __apiToken }),
          },
          body: buffer,
        },
      )
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error((json && json.error) || `HTTP ${response.status}`)
      return json
    }

    function formatBytes(bytes) {
      const n = Number(bytes) || 0
      if (n < 1024) return `${n} B`
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
      return `${(n / (1024 * 1024)).toFixed(1)} MB`
    }

    /**
     * 附件名的可读标签。
     *
     * 云端/旧体系生成的附件名长这样：
     * `示例录音笔记_1200000000000000001_audio.mp3`
     * 播放器卡片上直接显示这一长串，用户根本看不出这是什么。去掉 `_<note_id>`
     * 与 `_audio` / `_transcript` 后缀，只留下干净的名字 + 扩展名。
     */
    function assetLabel(name) {
      const raw = String(name || '')
      if (raw === '') return ''
      const ext = (/\.([a-z0-9]+)$/i.exec(raw) || [])[1] || ''
      let stem = ext === '' ? raw : raw.slice(0, -(ext.length + 1))
      // 真实文件名是 `<标题>_<note_id>_audio.mp3`，`_audio` 在 note_id **后面**，
      // 所以一遍替换只能剥掉一层。反复剥到不再变化为止，否则卡片上会留着
      // 「标题_1200000000000000001.mp3」这种半截名字。
      for (let i = 0; i < 4; i += 1) {
        const next = stem.replace(/_\d{10,}$/, '').replace(/_(audio|transcript|image|video)$/i, '')
        if (next === stem) break
        stem = next
      }
      return ext === '' ? stem : `${stem}.${ext}`
    }

    // ── 主题色推导 ────────────────────────────────────────────────────────────

    /** `#rgb` / `#rrggbb` → `{r,g,b}`；不合法返回 null。 */
    function parseHex(input) {
      if (typeof input !== 'string') return null
      const raw = input.trim().toLowerCase()
      const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(raw)
      if (short) return { r: parseInt(short[1] + short[1], 16), g: parseInt(short[2] + short[2], 16), b: parseInt(short[3] + short[3], 16) }
      const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(raw)
      if (long) return { r: parseInt(long[1], 16), g: parseInt(long[2], 16), b: parseInt(long[3], 16) }
      return null
    }

    function rgbToHsl(r, g, b) {
      const rn = r / 255
      const gn = g / 255
      const bn = b / 255
      const max = Math.max(rn, gn, bn)
      const min = Math.min(rn, gn, bn)
      const l = (max + min) / 2
      if (max === min) return { h: 0, s: 0, l }
      const d = max - min
      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      let h
      if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
      else if (max === gn) h = ((bn - rn) / d + 2) / 6
      else h = ((rn - gn) / d + 4) / 6
      return { h, s, l }
    }

    function hslToHex(h, s, l) {
      const hue = ((h % 1) + 1) % 1
      const sat = Math.min(1, Math.max(0, s))
      const lig = Math.min(1, Math.max(0, l))
      if (sat === 0) {
        const v = Math.round(lig * 255)
        const hex = v.toString(16).padStart(2, '0')
        return `#${hex}${hex}${hex}`
      }
      const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat
      const p = 2 * lig - q
      const channel = (t) => {
        let tt = t
        if (tt < 0) tt += 1
        if (tt > 1) tt -= 1
        let value
        if (tt < 1 / 6) value = p + (q - p) * 6 * tt
        else if (tt < 1 / 2) value = q
        else if (tt < 2 / 3) value = p + (q - p) * (2 / 3 - tt) * 6
        else value = p
        return Math.round(value * 255).toString(16).padStart(2, '0')
      }
      return `#${channel(hue + 1 / 3)}${channel(hue)}${channel(hue - 1 / 3)}`
    }

    /**
     * 从一个主题色推导出整面板的配色变量。
     *
     * **只让用户选一个颜色**，三层深浅在这里算出来。理由是产品判断：
     * 用户说的「主题色」是一个**色相**（这是蓝的、这是绿的），不是一个调色板。
     * 如果开放成三个输入框，一旦有人填出「左栏比右栏还淡」的组合，整个界面的
     * 层次就散了，而他自己多半看不出问题出在哪一格。
     * 所以这里让色相跟随用户，**明度由代码锁死**：左栏永远最深、右栏永远最浅。
     *
     * 返回 null 表示「用内置配色」——调用方据此不给 style 属性，
     * 让 CSS 里那套默认值原样生效。
     */
    /** 没选主题色时用的色相：与设置页第一枚预设一致。 */
    const DEFAULT_THEME_COLOR = '#0a2a52'

    /**
     * 宿主现在是深色主题吗？
     *
     * Obsidian 在 `<body>` 上挂 `theme-dark` / `theme-light` 两个类，切换主题时
     * 只换类名、不重新加载插件。所以这个判断必须在**每次渲染时**做（而不是
     * 启动时算一次存起来），否则用户切换主题后面板会一直停在旧配色上。
     *
     * 拿不到 document（测试环境）时按浅色处理：那套配色是默认值。
     */
    // 面板可能活在一个 popout 窗口里（「在新窗口中打开」），那里的
    // `document` 是另一个 document，不是主窗口那个。所有「找 DOM」的动作
    // 都得从面板自己的根节点出发，否则会在主窗口里找不到东西——
    // 表现为 popout 里快捷键聚焦不了搜索框、点空白处菜单不关、主题不跟着变。
    // 同一个插件可以同时开多个面板（主窗口一个、popout 窗口一个），
    // 所以是「一组根节点」而不是一个。每个根节点各自的 document 里
    // 都要有自己的样式表——popout 窗口的 document 是独立的。
    const panelRoots = new Set()
    function rootsOf(doc) {
      const list = []
      for (const el of panelRoots) {
        if (!el || el.isConnected === false) continue
        if (doc === undefined || el.ownerDocument === doc) list.push(el)
      }
      return list
    }
    function panelDocuments() {
      const docs = []
      for (const el of rootsOf()) {
        const doc = el.ownerDocument
        if (doc && docs.indexOf(doc) === -1) docs.push(doc)
      }
      if (docs.length === 0 && typeof document !== 'undefined') docs.push(document)
      return docs
    }
    function panelDocument() {
      const docs = panelDocuments()
      return docs.length === 0 ? null : docs[0]
    }
    function panelWindows() {
      const wins = []
      for (const doc of panelDocuments()) {
        const win = doc.defaultView
        if (win && wins.indexOf(win) === -1) wins.push(win)
      }
      return wins
    }
    function panelWindow() {
      const wins = panelWindows()
      return wins.length === 0 ? null : wins[0]
    }
    /** 记住一个面板根节点，之后所有 DOM 查找都从它所在的 document 出发。 */
    export function setPanelRootEl(el) {
      if (el) panelRoots.add(el)
      else panelRoots.clear()
    }
    /**
     * 只在面板自己的子树里找元素（popout 窗口里 document 不是主窗口那个）。
     *
     * 传了 doc 就先在那个 document 的面板里找——在 popout 窗口里按 Ctrl+K，
     * 焦点该落在**这个窗口**的搜索框上，而不是把主窗口的抢过来。
     */
    /** 事件是从哪个 document 里来的（在 window 上派发时 target 是 window 本身）。 */
    function docOfEvent(event) {
      const target = event ? event.target : null
      if (!target) return undefined
      if (target.ownerDocument) return target.ownerDocument
      if (target.document) return target.document
      return undefined
    }
    /** 这个事件是不是从面板自己的子树里冒上来的（拖到面板外头不该算拖进来）。 */
    function inPanel(event) {
      const target = event ? event.target : null
      if (!target || typeof target !== 'object') return false
      for (const root of rootsOf(docOfEvent(event))) {
        if (typeof root.contains === 'function' && root.contains(target)) return true
      }
      return false
    }
    function findInPanel(selector, doc) {
      const groups = doc ? [rootsOf(doc), rootsOf()] : [rootsOf()]
      for (const group of groups) {
        for (const el of group) {
          if (typeof el.querySelector !== 'function') continue
          const hit = el.querySelector(selector)
          if (hit) return hit
        }
      }
      return null
    }
    function isDarkTheme() {
      const doc = panelDocument()
      if (doc === null || !doc.body) return false
      return doc.body.classList.contains('theme-dark')
    }
    function themeVars(input, dark = false) {
      // 没选主题色时：浅色返回 null 让 CSS 默认值生效（那是手调过的浅色板）；
      // 深色必须自己算一套，否则深色界面上会冒出一整片浅蓝。
      const rgb = parseHex(input) || (dark === true ? parseHex(DEFAULT_THEME_COLOR) : null)
      if (rgb === null) return null
      const base = rgbToHsl(rgb.r, rgb.g, rgb.b)
      const hue = base.h
      const sat = base.s
      // 用户选的是灰色（s < 0.12）时按单色主题处理：保留灰，不要硬拗成彩色。
      // 灰阶用户要的就是素雅，给他染上一层红比不让他选灰更糟。
      const tint = (min, max) => (sat < 0.12 ? Math.min(sat, 0.06) : Math.min(max, Math.max(min, sat)))
      if (dark === true) {
        // 深色：三栏都落在 4.5%~18.5% 明度之间，靠亮度递增维持「左栏最沉、右栏最亮」。
        // 深色界面的层次不能像浅色那样拉开——拉太开就会有一栏亮得像故障。
        return {
          '--dshgn-deep': hslToHex(hue, tint(0.30, 0.56), 0.075),
          '--dshgn-deep2': hslToHex(hue, tint(0.32, 0.60), 0.045),
          '--dshgn-deepFg': '#ffffff',
          '--dshgn-deepFg2': 'rgba(255,255,255,.86)',
          '--dshgn-deepFg3': 'rgba(255,255,255,.62)',
          '--dshgn-mid': hslToHex(hue, tint(0.24, 0.44), 0.125),
          '--dshgn-mid2': hslToHex(hue, tint(0.26, 0.48), 0.095),
          '--dshgn-midFg': 'rgba(255,255,255,.92)',
          '--dshgn-midFg2': 'rgba(255,255,255,.72)',
          '--dshgn-midFg3': 'rgba(255,255,255,.52)',
          '--dshgn-light': hslToHex(hue, tint(0.18, 0.36), 0.155),
          '--dshgn-light2': hslToHex(hue, tint(0.20, 0.40), 0.185),
          '--dshgn-lightFg': 'rgba(255,255,255,.94)',
          '--dshgn-lightFg2': 'rgba(255,255,255,.74)',
          '--dshgn-lightFg3': 'rgba(255,255,255,.54)',
          '--dshgn-accentOnDark': hslToHex(hue, 0.86, 0.80),
          '--dshgn-accentOnLight': hslToHex(hue, 0.82, 0.68),
          '--dshgn-tintRgb': `${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)}`,
          '--dshgn-btnFill': hslToHex(hue, 0.68, 0.50),
          '--dshgn-btnHover': hslToHex(hue, 0.70, 0.58),
          '--dshgn-btnFillSoft': hslToHex(hue, 0.44, 0.42),
          '--dshgn-btnHoverSoft': hslToHex(hue, 0.48, 0.50),
          '--dshgn-btnFillPale': hslToHex(hue, 0.34, 0.32),
          '--dshgn-btnHoverPale': hslToHex(hue, 0.38, 0.38),
        }
      }
      return {
        // 左栏：深，但要保证白字对比度足够（明度 15% 配 93% 的字够 WCAG AA）
        '--dshgn-deep': hslToHex(hue, tint(0.42, 0.82), 0.15),
        '--dshgn-deep2': hslToHex(hue, tint(0.46, 0.86), 0.09),
        '--dshgn-deepFg': '#ffffff',
        '--dshgn-deepFg2': 'rgba(255,255,255,.86)',
        '--dshgn-deepFg3': 'rgba(255,255,255,.66)',
        // 中栏：浅
        '--dshgn-mid': hslToHex(hue, tint(0.46, 0.88), 0.855),
        '--dshgn-mid2': hslToHex(hue, tint(0.48, 0.88), 0.815),
        '--dshgn-midFg': hslToHex(hue, 0.60, 0.16),
        '--dshgn-midFg2': hslToHex(hue, 0.42, 0.36),
        '--dshgn-midFg3': hslToHex(hue, 0.32, 0.52),
        // 右栏：极浅近白。故意留一点点色相，纯白会让三栏看起来断成两块。
        '--dshgn-light': hslToHex(hue, tint(0.30, 0.70), 0.985),
        '--dshgn-light2': hslToHex(hue, tint(0.34, 0.74), 0.955),
        '--dshgn-lightFg': hslToHex(hue, 0.40, 0.17),
        '--dshgn-lightFg2': hslToHex(hue, 0.25, 0.34),
        '--dshgn-lightFg3': hslToHex(hue, 0.18, 0.50),
        // 强调色：深底上要够亮，浅底上要够沉，否则链接/选中态会糊掉
        '--dshgn-accentOnDark': hslToHex(hue, 0.92, 0.74),
        '--dshgn-accentOnLight': hslToHex(hue, 0.80, 0.38),
        // 所有半透明描边/阴影统一由这一个分量推导。
        // 原来 17 处硬编码 rgba(var(--dshgn-tintRgb),…) 散在 CSS 里，换主题色时它们不会跟着变，
        // 界面就会「底色换了、线条还是旧的蓝」。
        '--dshgn-tintRgb': `${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)}`,
        '--dshgn-btnFill': hslToHex(hue, 0.72, 0.48),
        '--dshgn-btnHover': hslToHex(hue, 0.75, 0.56),
        // 次要强调按钮（冲突比对里的「用我的本地版」这类）：比主按钮淡一档。
        // 同样由色相推导而不是写死蓝——换主题色后它还必须是「淡的那一版」，
        // 写死的话在墨绿/酒红主题下会突然跳出一块亮蓝，比不淡更难看。
        '--dshgn-btnFillSoft': hslToHex(hue, 0.52, 0.62),
        '--dshgn-btnHoverSoft': hslToHex(hue, 0.56, 0.55),
        // 冲突页采纳按钮的「已选中」填充色。比 btnFillSoft 更浅一档——那个色
        // 用在主操作上刚好，但冲突页三个按钮并排，太饱和会让人以为哪个是
        // 主按钮；这里要表达的是「我选过这个」，不是「点这个」。
        '--dshgn-btnFillPale': hslToHex(hue, 0.44, 0.74),
        '--dshgn-btnHoverPale': hslToHex(hue, 0.48, 0.68),
      }
    }

    function formatTime(iso) {
      if (!iso) return ''
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    // ── 图标 ──────────────────────────────────────────────────────────────────

    const ICONS = {
      brain:
        'M9.2 3.4A5.2 5.2 0 0 0 4 8.6c0 1 .3 1.9.8 2.7A3.9 3.9 0 0 0 3.6 14a4 4 0 0 0 2.3 3.6A4.3 4.3 0 0 0 9.6 21c.9 0 1.7-.3 2.4-.8.7.5 1.5.8 2.4.8a4.3 4.3 0 0 0 3.7-3.4A4 4 0 0 0 20.4 14a3.9 3.9 0 0 0-1.2-2.7c.5-.8.8-1.7.8-2.7a5.2 5.2 0 0 0-5.2-5.2c-.9 0-1.7.2-2.4.6a4.6 4.6 0 0 0-2.4-.6Z M12 6.4v13.2 M12 12.2 8.6 9.6 M12 15.4l3.4-2.6',
      folder: 'M3 7.5A2.5 2.5 0 0 1 5.5 5h3l2 2h8A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5Z',
      file: 'M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9Zm0 0v6h6',
      search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z M16.5 16.5 21 21',
      plus: 'M12 5v14 M5 12h14',
      refresh: 'M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7',
      trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
      edit: 'M4 20h4l10-10-4-4L4 16Z M14 6l4 4',
      cloud: 'M7 18a4 4 0 0 1 .6-7.96A5.5 5.5 0 0 1 18 10.5a3.5 3.5 0 0 1-.5 7.5Z',
      check: 'M4 12.5 9.5 18 20 6.5',
      gear: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.56-1.03 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
      up: 'M12 19V5 M5 12l7-7 7 7',
      close: 'M6 6l12 12 M18 6 6 18',
      link: 'M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 1 0-5-5l-1.2 1.2 M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 1 0 5 5l1.2-1.2',
      play: 'M8 5.5v13l11-6.5Z',
      pause: 'M9 5v14 M15 5v14',
      audio: 'M4 13v-2a8 8 0 0 1 16 0v2 M4 13h2.5v5H5a1 1 0 0 1-1-1Z M20 13h-2.5v5H19a1 1 0 0 0 1-1Z',
      sync: 'M4 9a8 8 0 0 1 13.7-3.3L20 8 M20 4v4h-4 M20 15a8 8 0 0 1-13.7 3.3L4 16 M4 20v-4h4',
      clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 7v5l3.5 2',
      book: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H19v16H5.5A1.5 1.5 0 0 1 4 18.5Z M8 4v16',
      chevron: 'M9 6l6 6-6 6',
      calendar: 'M4 7h16v13H4Z M4 11h16 M8 4v5 M16 4v5',
      note: 'M5 4h9l5 5v11H5Z M14 4v5h5 M8 13h8 M8 17h5',
      'external-link': 'M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
      rename: 'M9 4h6 M12 4v16 M9 20h6',
      attach: 'M14 3.5a4.5 4.5 0 0 1 6.4 6.4l-8.5 8.5a3 3 0 0 1-4.2-4.2l7.8-7.8',
      warn: 'M12 4 3.5 19.5h17Z M12 10v4 M12 17h.01',
      info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 11v5 M12 8h.01',
      down: 'M12 5v14 M5 12l7 7 7-7',
    }

    function Icon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 16
      const name = props && props.name ? props.name : 'brain'
      const path = ICONS[name] || ICONS.brain
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          className: props && props.className ? props.className : undefined,
        },
        path.split(' M').map((segment, index) =>
          h('path', { key: index, d: index === 0 ? segment : `M${segment}` }),
        ),
      )
    }

    // ── Markdown 渲染（无依赖）─────────────────────────────────────────────────

    /**
     * 把 `[文字](href)` 里的 href 认成库内跳转，认不出就返回 null（当外链）。
     *
     * 宿主认三种写法：`[[笔记]]` 是双链，`[文字](笔记.md)` 与 `[文字](#小节)` 是普通
     * Markdown 链接，但它们指向的仍是库里的东西。我们原来一律 target=_blank：点下去
     * 宿主打不开这个相对地址，什么也不会发生，用户会以为链接坏了。
     *
     * 只认「看起来是库内」的：外站 http(s)、mailto、带协议头的都不碰；指向图片、
     * PDF 之类的附件也交回外链（宿主里那是打开文件，不是切笔记）。
     */
    function markdownLinkTarget(href) {
      const raw = String(href || '').trim()
      if (raw === '') return null
      // 带协议头的（http://、mailto:、file: …）一律当外链，交给浏览器/宿主
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null
      // 纯锚点：同一篇里的某一节
      if (raw.startsWith('#')) {
        const anchor = raw.slice(1).trim()
        return anchor === '' ? null : { target: '', anchor }
      }
      // 去掉可能的 ./ 与开头的斜杠；查询串与片段分开
      const hashAt = raw.indexOf('#')
      const pathPart = (hashAt === -1 ? raw : raw.slice(0, hashAt)).replace(/^\.\//, '').replace(/^\/+/, '')
      const anchor = hashAt === -1 ? '' : raw.slice(hashAt + 1).trim()
      if (pathPart === '') return anchor === '' ? null : { target: '', anchor }
      // 附件（图片、PDF、音频…）不是笔记，宿主里点它是打开文件
      if (/\.(?!md$)[a-z0-9]{1,6}$/i.test(pathPart)) return null
      const target = pathPart.replace(/\.md$/i, '')
      if (target === '') return null
      return { target, anchor }
    }

    /**
     * 行内：`code` / **粗** / *斜* / [文本](链接) / 裸链接。
     *
     * 刻意保持保守：认不出的语法原样显示，绝不吞字。笔记里的时间是 `[00:12:30]`
     * 这种方括号，误判成链接会让整篇时间轴坏掉，所以链接必须是 `[文本](url)` 全形。
     */
    function renderInline(text, keyPrefix, options) {
      const opts = options || {}
      const nodes = []
      // 行内标记按宿主那套认：行内代码、粗体、斜体、删除线（`~~`）、
      // 高亮（`==`）、注释（`%%`）、双链、普通链接、裸链。
      // 删除线和高亮是 Obsidian 自己的扩展，标准 Markdown 里没有，但用户天天在写；
      // 不认的话它们会连标记符号一起原样露在界面上，看起来像正文写错了。
      const pattern =
        /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(~~[^~\n]+~~)|(==[^=\n]+==)|(%%[\s\S]*?%%)|(!?\[\[[^\]\n]+\]\])|(\[[^\]\n]*\]\([^)\s]+\))|(https?:\/\/[^\s)]+)|(\[\^[^\]\n]+\])/g
      let last = 0
      let match
      let seq = 0
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index))
        const token = match[0]
        const key = `${keyPrefix}-${seq++}`
        if (token.startsWith('`')) {
          nodes.push(h('code', { key, className: 'dshgn_code' }, token.slice(1, -1)))
        } else if (token.startsWith('**')) {
          nodes.push(h('strong', { key }, token.slice(2, -2)))
        } else if (token.startsWith('*')) {
          nodes.push(h('em', { key }, token.slice(1, -1)))
        } else if (token.startsWith('~~')) {
          nodes.push(h('del', { key, className: 'dshgn_del' }, token.slice(2, -2)))
        } else if (token.startsWith('==')) {
          nodes.push(h('mark', { key, className: 'dshgn_mark' }, token.slice(2, -2)))
        } else if (token.startsWith('%%')) {
          // 注释在宿主里根本不显示（不是小字、不是灰色，是整段不存在），
          // 这里也一个字都不放。留成空节点等于占位，段落里会多出一个空格。
        } else if (token.startsWith('[[') || token.startsWith('![[')) {
          // Obsidian 双链：`[[目标]]` / `[[目标|显示文字]]` / `![[附件]]`
          const embed = token.startsWith('!')
          const inner = token.slice(embed ? 3 : 2, -2)
          const pipe = inner.indexOf('|')
          const linkText = (pipe === -1 ? inner : inner.slice(0, pipe)).trim()
          // 没有竖线就是没有自定义显示文字。这里必须给空串，不能拿整串顶上去——
          // 顶上去的话 `[[#第二节]]` 会显示成「#第二节」，「笔记 › 小节」那套也永远走不到。
          const label = pipe === -1 ? '' : inner.slice(pipe + 1).trim()
          // 双链可以带小节：`[[笔记#小节]]`、`[[#本页的小节]]`。
          // 宿主解析路径时只认 # 前面那段，所以这里就切开，别整串递过去——
          // 整串递过去宿主找不到这一篇，点击会变成「库里找不到」。
          const hash = linkText.indexOf('#')
          const target = (hash === -1 ? linkText : linkText.slice(0, hash)).trim()
          const anchor = hash === -1 ? '' : linkText.slice(hash + 1).trim()
          if (embed) {
            // `![[#本页小节]]`：没写笔记名就是「这一篇的这一节」，没有东西可嵌，
            // 拿一个空名字去解析只会解析失败。直接滚过去。
            if (target === '' && anchor !== '') {
              nodes.push(
                h(
                  'button',
                  {
                    key,
                    type: 'button',
                    className: 'dshgn_wikilink',
                    onClick: () => {
                      if (typeof opts.onOpenWikiLink === 'function') opts.onOpenWikiLink('', anchor)
                    },
                  },
                  label || anchor,
                ),
              )
              last = match.index + token.length
              continue
            }
            const embedded = renderEmbed(target, key, Object.assign({}, opts, { anchor, label }))
            // 嵌进来的是一整篇笔记时它自己就是块级元素，再套一层 inline-flex 的
            // 胶囊会把它挤成一条线——那种情况下直接放进来。
            const blockLevel = embedded !== null && embedded !== undefined && embedded.type === NoteEmbed
            nodes.push(blockLevel ? embedded : h('span', { key, className: 'dshgn_embed' }, embedded))
          } else {
            nodes.push(
              h(
                'button',
                {
                  key,
                  type: 'button',
                  className: 'dshgn_wikilink',
                  // 双链在 Obsidian 里是跳转。这里没有 Obsidian 的解析器，尽力而为：
                  // 有完整路径就按路径打开，只写标题就在当前库里按标题/文件名找。
                  onClick: () => {
                    if (typeof opts.onOpenWikiLink === 'function') opts.onOpenWikiLink(target, anchor)
                  },
                },
                // 带小节时显示「笔记 › 小节」：只显示笔记名的话，同一篇被链到
                // 不同小节看起来一模一样，点进去落在哪儿全靠猜。
                // 块引用那一串 `^abc123` 对人没有意义，不摆在链接上：
                // 有笔记名就只显示笔记名，只有块 id 时显示「本页某一段」。
                label ||
                  (isBlockAnchor(anchor)
                    ? target === ''
                      ? t('note.blockRef')
                      : target
                    : target === ''
                      ? anchor
                      : anchor === ''
                        ? target
                        : `${target} › ${anchor}`),
              ),
            )
          }
        } else if (token.startsWith('[^')) {
          // 脚注引用 [^1]：宿主的渲染器会把它变成上标并连到篇尾的注解，
          // 我们原来把 [^1] 这串字符原样留在正文里，看着像写错了。
          const footId = token.slice(2, -1).trim()
          nodes.push(
            h(
              'sup',
              {
                key,
                className: 'dshgn_footRef',
                'data-footnote-ref': footId,
                title: getT()('note.footnote'),
                onClick: (event) => {
                  const box = event && event.currentTarget ? event.currentTarget.closest('.dshgn_md') : null
                  if (box) scrollToFootnote(box, footId)
                },
              },
              footId,
            ),
          )
        } else if (token.startsWith('[')) {
          const split = token.indexOf('](')
          const label = token.slice(1, split)
          const href = token.slice(split + 2, -1)
          // [文字](笔记.md) / [文字](#小节) 在宿主里是往库内跳，不是开浏览器。
          // 原来一律当外链 target=_blank，点下去宿主没反应（库里没有这个地址），
          // 用户会以为链接坏了。认得出来的就交回 onOpenWikiLink 走同一套解析。
          const inner = typeof opts.onOpenWikiLink === 'function' ? markdownLinkTarget(href) : null
          if (inner !== null) {
            nodes.push(
              h(
                'button',
                {
                  key,
                  type: 'button',
                  className: 'dshgn_wikilink',
                  onClick: () => opts.onOpenWikiLink(inner.target, inner.anchor),
                },
                label === '' ? (inner.anchor === '' ? inner.target : inner.anchor) : label,
              ),
            )
          } else {
            nodes.push(
              h(
                'a',
                { key, href, target: '_blank', rel: 'noreferrer noopener', className: 'dshgn_link' },
                label,
              ),
            )
          }
        } else {
          nodes.push(
            h('a', { key, href: token, target: '_blank', rel: 'noreferrer noopener', className: 'dshgn_link' }, token),
          )
        }
        last = match.index + token.length
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes
    }

    /**
     * 标题比对用的归一化。
     *
     * 双链里写的小节名和正文里那行标题常常差在几处：正文可能带行尾的 `###`、
     * 中间多几个空格、大小写不一致。宿主的双链是按标题文字找的，我们也照这个来，
     * 只是先抹平这几处差异，否则「明明有这个标题却跳不过去」很难自己看出来。
     */
    function normalizeHeading(text) {
      return String(text || '')
        .replace(/^#+\s*/, '')
        .replace(/\s+#+\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
    }

    /**
     * 块引用（block reference）。
     *
     * 宿主的写法是「块末尾一个空格加 ^ 再加 id」，双链写成 `[[笔记#^abc123]]`，
     * 指的是那一篇里标了这个 id 的那**一段**，不是某一节标题。以前我们把它当小节名
     * 去找标题，永远找不到，于是弹一句「这一篇里没有 ^abc123 这一节」——链接没坏，
     * 坏的是我们的理解。
     */
    const BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9-]{1,64})\s*$/

    /** 双链 # 后面那一段是不是块引用（以 ^ 开头），而不是小节名。 */
    function isBlockAnchor(text) {
      return /^\^\s*[A-Za-z0-9-]{1,64}$/.test(String(text || '').trim())
    }

    /** 一行文字末尾的块 id，没有就返回空串。 */
    function blockIdIn(text) {
      const hit = BLOCK_ID_RE.exec(String(text || ''))
      return hit === null ? '' : hit[1]
    }

    /** 把块末尾那个 ^id 削掉——它是给链接用的记号，不该显示在正文里。 */
    function stripBlockId(text) {
      return String(text || '').replace(BLOCK_ID_RE, '').trim()
    }

    /**
     * 找出一篇正文里的标题元素。
     *
     * 两种渲染路径产出的标题不一样：手写渲染器给我们自己的 `.dshgn_h`，
     * 宿主的 MarkdownRenderer 给的是普通的 h1..h6。只认前者的话，接上宿主之后
     * 大纲点击和「跳到某一节」都会静默失效——点了没反应，也没人知道为什么。
     */
    function headingNodes(host) {
      if (!host) return []
      const own = host.querySelectorAll('.dshgn_h')
      if (own.length > 0) return Array.from(own)
      return Array.from(host.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    }

    /**
     * frontmatter 里的一个值 → 一行文字。
     *
     * 我们自己写出去的头部只有字符串和字符串数组两种形状（见 core/vault.js 的
     * parseFrontmatter），但用户会手改，可能写成嵌套、数字、布尔。这里只负责
     * 「别崩、别显示 [object Object]」：数组用 · 连起来（和卡片摘要里标签的
     * 连法一致），对象退成 JSON 一行，其它交给 String。
     */
    function frontmatterText(value) {
      if (value === null || value === undefined) return ''
      if (Array.isArray(value)) {
        return value
          .map((item) => frontmatterText(item))
          .filter((text) => text !== '')
          .join(' · ')
      }
      if (typeof value === 'object') {
        try {
          return JSON.stringify(value)
        } catch {
          return ''
        }
      }
      return String(value).trim()
    }

    /**
     * 这篇笔记的别名列表（宿主的 aliases 约定；手写时常见 alias / 别名）。
     *
     * 别名就是「这篇笔记的另一个名字」：写了 `aliases: [读书笔记]` 之后，
     * `[[读书笔记]]` 应该指到这一篇。宿主按别名解析双链，面板以前只比标题和
     * 文件名，于是同一个链接在两边一个点得开、一个报「库里找不到」。
     */
    function aliasesOf(entry) {
      const data = entry !== null && entry !== undefined && typeof entry === 'object' ? entry.aliases : null
      if (!Array.isArray(data)) return []
      return data.map((item) => String(item === null || item === undefined ? '' : item).trim()).filter((item) => item !== '')
    }

    /** 这个键是不是「标签」——宿主的约定是 tags，用户手写时常见 tag / 标签。 */
    function isTagKey(key) {
      const name = String(key || '').trim().toLowerCase()
      return name === 'tags' || name === 'tag' || name === '标签' || name === '标签页'
    }

    /**
     * 把某个容器滚到它的某一节标题上。
     *
     * 嵌进来的那一篇自己不是滚动容器——滚动发生在外面那层 `.dshgn_scroll` 上，
     * 所以从内容往上找到最近的滚动容器再算偏移。找不到标题、或者容器压根不在
     * 滚动区里，都返回 false，让调用方自己决定要不要说点什么。
     */
    function scrollToHeading(box, text) {
      if (!box) return false
      const want = normalizeHeading(text)
      if (want === '') return false
      const heads = headingNodes(box)
      let hit = null
      for (let i = 0; i < heads.length; i += 1) {
        if (normalizeHeading(heads[i].textContent) === want) {
          hit = heads[i]
          break
        }
      }
      const host = scrollHostOf(box)
      if (!host) return false
      scrollHostTo(host, hit)
      return true
    }

    /**
     * 滚到正文里标了某个块 id 的那一块。
     *
     * 渲染时我们给每一块挂 `data-block-id`，所以这里只是一次属性查找。找不到
     * （用户刚把 id 删了、或者 id 写在没被渲染成块的容器里）返回 false。
     */
    /**
     * 从一篇正文里抠出挂了 `^id` 的那一块。
     *
     * 宿主里 `![[笔记#^abc123]]` 嵌的是「那一段」，不是「那一篇滚到那一段」。
     * 整篇嵌进来再滚过去，用户会看到一大段跟自己无关的正文，还以为嵌错了。
     * 段落（连续的非空行）和列表项都算一块；找不到返回空串，调用方退回去整篇显示。
     */
    function blockTextOf(body, id) {
      const want = String(id === undefined || id === null ? '' : id).trim().replace(/^\^/, '')
      if (want === '') return ''
      const lines = String(body === undefined || body === null ? '' : body).split('\n')
      let inFence = false
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]
        if (/^\s*(```|~~~)/.test(line)) {
          inFence = !inFence
          continue
        }
        if (inFence) continue
        if (blockIdIn(line) !== want) continue
        // 命中的这一行可能是段落中间一行，也可能就是列表项：往回找到这一块的起点
        let start = i
        const isList = /^\s*([-*+]|\d+[.)])\s+/.test(line)
        if (!isList) {
          while (start > 0 && lines[start - 1].trim() !== '' && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[start - 1]) && !/^#{1,6}\s/.test(lines[start - 1])) {
            start -= 1
          }
        }
        let end = i
        if (!isList) {
          while (end + 1 < lines.length && lines[end + 1].trim() !== '' && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[end + 1]) && !/^#{1,6}\s/.test(lines[end + 1])) {
            end += 1
          }
        }
        const picked = lines.slice(start, end + 1)
        picked[picked.length - 1] = stripBlockId(picked[picked.length - 1])
        return picked.join('\n').trim()
      }
      return ''
    }

    function scrollToBlock(box, id) {
      const want = String(id || '').trim().replace(/^\^/, '')
      if (want === '') return false
      const host = scrollHostOf(box)
      if (!host) return false
      let hit = null
      try {
        hit = host.querySelector('[data-block-id="' + want + '"]')
      } catch (error) {
        hit = null
      }
      if (!hit) return false
      return scrollHostTo(host, hit)
    }

    /**
     * 滚到篇尾那一条脚注。
     *
     * 脚注定义在 `[^id]: 注解正文` 里，渲染时给那一块挂 `data-footnote-id`。
     * 找不到就老实返回 false——脚注写了一半（有引用没有定义）是常见的手滑，
     * 那种时候弹一句「这一篇里没有这条脚注」比什么都不说更吵。
     */
    function scrollToFootnote(box, id) {
      const want = String(id || '').trim()
      if (want === '') return false
      const host = scrollHostOf(box)
      if (!host) return false
      let hit = null
      try {
        hit = host.querySelector('[data-footnote-id="' + want + '"]')
      } catch (error) {
        hit = null
      }
      if (!hit) return false
      return scrollHostTo(host, hit)
    }

    /**
     * 找正文的滚动容器（那一层 `.dshgn_scroll`，不是窗口）。
     *
     * 传进来的可能是正文里的某一块（嵌入框、段落），也可能本身就是那个滚动容器
     * ——NotePane 手里的 scrollRef 指的就是它。两种都认，否则从 scrollRef 找起来
     * 会一路找到文档根上去，什么都滚不动。
     */
    function scrollHostOf(box) {
      if (!box) return null
      if (box.classList && box.classList.contains('dshgn_scroll')) return box
      let host = box.parentElement
      while (host && !(host.classList && host.classList.contains('dshgn_scroll'))) host = host.parentElement
      return host || null
    }

    /** 与大纲跳转同一套算法：只改滚动容器自己的 scrollTop，横向一点不动。 */
    function scrollHostTo(host, hit) {
      if (!host || !hit) return false
      const offset = hit.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop - 8
      host.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' })
      return true
    }

    /**
     * 把搜索命中行那一行文字，还原成「渲染后正文里大概长什么样」。
     *
     * 搜索结果里的那一行是**原始 Markdown**（带 `##`、`- `、`[[双链]]`、`**粗体**`），
     * 而正文渲染之后这些标记都不见了。直接拿原文去正文里找永远找不到，所以先把
     * 标记削掉，只留几个字做锚——行号会变（用户刚编辑过），文字才是稳的那个。
     */
    function lineNeedle(text) {
      let line = String(text || '')
      line = line.replace(/^\s*(?:>\s*)+/, '')
      line = line.replace(/^\s*#{1,6}\s*/, '')
      line = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
      line = line.replace(/^\s*\[[ xX]\]\s+/, '')
      line = line.replace(/!?\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (all, target, label) => label || target || '')
      line = line.replace(/\[([^\]\n]*)\]\([^)\s]+\)/g, '$1')
      line = line.replace(/[*_`~]+/g, '')
      line = line.replace(/\s+/g, ' ').trim()
      return line.slice(0, 40)
    }

    /**
     * 滚到正文里包含某段文字的块上。
     *
     * 只认「块级」元素（段落、列表项、标题、引用、表格单元、代码块），不认
     * 外层的容器——容器也包含这段文字，但滚到容器等于没滚。挑文档顺序里
     * 第一个命中的块：同一段文字出现多次时，用户是从搜索结果点进来的，
     * 他看到的第一个就是列表里第一条。
     */
    function scrollToText(box, text) {
      const needle = lineNeedle(text)
      if (needle === '') return false
      const host = scrollHostOf(box)
      if (!host) return false
      const blocks = host.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th')
      for (let i = 0; i < blocks.length; i += 1) {
        const node = blocks[i]
        // 只认最小的那一个：列表项里还有段落时，滚到段落比滚到整条列表更准
        if (node.querySelector('p, li, blockquote, pre')) continue
        if (String(node.textContent || '').replace(/\s+/g, ' ').includes(needle)) return scrollHostTo(host, node)
      }
      return false
    }

    /** 图像扩展名判定：只认浏览器能直接显示的格式。 */
    const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i

    /**
     * 认得出「这是个附件文件」的扩展名。
     *
     * `![[xxx]]` 里通常不写扩展名，所以「不是图片」并不等于「是一篇笔记」：
     * PDF、录音、压缩包这些也该老老实实显示成文件名胶囊，不能拿去当笔记读。
     */
    const FILE_EXT_RE =
      /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|tar|gz|mp3|wav|m4a|aac|ogg|flac|mp4|mov|webm|mkv|canvas|excalidraw|txt|csv|tsv|json|html?|js|css)$/i

    /**
     * 正文里 `![[另一篇笔记]]` 的嵌入。
     *
     * 宿主会把那一篇的正文整段嵌进来（连标题一起），我们原来只给一颗文件名
     * 胶囊——点了能跳过去，但「在这儿引用一段别处的内容」这件事根本没做到：
     * 读者得点开、看完、再退回来，对比两篇时来回切。
     *
     * 正文走 /read，和打开笔记是同一个端点；只往下嵌一层——嵌进来的那篇里
     * 再嵌一篇时显示成文件名胶囊，两篇互相嵌入不会无限递归下去。
     */
    function NoteEmbed(props) {
      const path = String(props.path || '')
      const [note, setNote] = React.useState(null)
      const [failed, setFailed] = React.useState(false)
      const boxRef = React.useRef(null)
      React.useEffect(() => {
        if (path === '') return undefined
        let alive = true
        setNote(null)
        setFailed(false)
        void api(`/read?path=${encodeURIComponent(path)}`)
          .then((json) => {
            if (alive) setNote(json)
          })
          .catch(() => {
            // 读不到（刚被删、路径变了）就明说，别留一个永远转圈的框
            if (alive) setFailed(true)
          })
        return () => {
          alive = false
        }
      }, [path])
      const t = typeof props.t === 'function' ? props.t : getT()
      // 标题用用户写下的那个名字：note.title 是正文里第一个标题，常常是
      // 「目标的小节」这种，写在嵌入框头上会让人以为嵌的是另一篇。
      const title =
        typeof props.label === 'string' && props.label.trim() !== ''
          ? props.label.trim()
          : note !== null && typeof note.title === 'string'
            ? note.title
            : path
      const open = () => {
        if (typeof props.onOpen === 'function') props.onOpen(path)
      }
      // `![[笔记#小节]]`：正文读回来之后滚到那一节。滚的是外面那层滚动容器，
      // 所以等 note 落地（DOM 里真的有了标题）再滚，且只滚一次——anchor 变了
      // 才重来，不然勾个待办重新渲染又会把人拽回去。
      const anchor = typeof props.anchor === 'string' ? props.anchor : ''
      React.useEffect(() => {
        if (anchor === '' || note === null) return
        // `![[笔记#^abc]]` 嵌的是那一段：块引用要按 id 找，按标题找永远找不到。
        if (isBlockAnchor(anchor)) {
          scrollToBlock(boxRef.current, anchor)
          return
        }
        scrollToHeading(boxRef.current, anchor)
      }, [anchor, note])
      let body
      if (failed) {
        body = h('div', { className: 'dshgn_embedEmpty' }, t('note.embedBroken'))
      } else if (note === null) {
        body = h('div', { className: 'dshgn_embedEmpty' }, t('panel.loading'))
      } else {
        const fullBody = note.body !== undefined && note.body !== null ? note.body : note.content
        // `![[笔记#^abc123]]` 嵌的是那一段：只把这一段摆出来，而不是整篇嵌进来再滚过去
        // （滚过去之后用户看到的还是一整篇，分不清哪一句是被引的那句）。
        const excerpt = isBlockAnchor(anchor) ? blockTextOf(fullBody, anchor) : ''
        body = h(
          'div',
          { className: 'dshgn_embedBody' },
          renderMarkdown(excerpt === '' ? fullBody : excerpt, {
            assets: Array.isArray(note.assets) ? note.assets : [],
            sourcePath: '',
            // 嵌进来的正文里再点双链：交回面板自己那套（宿主编辑器不该被
            // 一个「看引用」的动作拉起来）
            onOpenWikiLink: open,
            onToggleTodo: undefined,
            // 再往下一层不再嵌笔记：两篇互相嵌入时递归没有尽头
            embedDepth: props.depth,
            resolveNote: props.resolveNote,
            t,
          }),
        )
      }
      return h(
        'div',
        { className: 'dshgn_noteEmbed', ref: boxRef },
        h(
          'div',
          { className: 'dshgn_embedHead' },
          h(Icon, { name: 'file', size: 12 }),
          h('button', { type: 'button', className: 'dshgn_embedTitle', title: t('note.openEmbed'), onClick: open }, title),
        ),
        body,
      )
    }

    /**
     * 渲染一个 `![[附件]]` 嵌入。
     *
     * 图片走 `/getnote/asset` 直接读用户库里的文件——同源、不受 CDN 签名过期影响，
     * 也不需要把附件内容塞进笔记正文（那样库会越滚越大）。
     * 音频交给 AudioPlayer；认不出来的（PDF、docx…）只给文件名，不假装能预览。
     */
    /**
     * 嵌入图片时写在竖线后面的尺寸：`![[图.png|300]]`、`![[图.png|300x200]]`。
     * 宿主按这个把图缩放显示；不认的话用户写多少都当显示文字用，图还是原样大小。
     * 返回 null 表示没写尺寸（那种情况竖线后面是显示文字或什么都没有）。
     */
    function parseImageSize(label) {
      const text = String(label === undefined || label === null ? '' : label).trim()
      const hit = /^(\d{1,4})(?:\s*[xX×]\s*(\d{1,4}))?$/.exec(text)
      if (hit === null) return null
      const width = Number(hit[1])
      const height = hit[2] === undefined ? 0 : Number(hit[2])
      if (!Number.isFinite(width) || width <= 0) return null
      return { width, height: Number.isFinite(height) && height > 0 ? height : 0 }
    }

    function renderEmbed(target, key, options) {
      const opts = options || {}
      const clean = String(target || '').trim()
      if (clean === '') return null
      const assets = Array.isArray(opts.assets) ? opts.assets : []
      // 双链里通常只写文件名，所以优先在「这篇笔记的附件」里按文件名匹配
      const base = clean.split('/').pop()
      const hit = assets.find((a) => a.name === clean || a.name === base)
      const path = (hit && hit.path) || clean
      // 嵌入的另一篇笔记：宿主会把它的正文嵌进来（连标题一起），我们原来只显示
      // 一个文件名胶囊——点了能跳过去，但「引用一段别处的内容」这件事完全没做到。
      //
      // 判断顺序很要紧：图片 > 认得出的附件 > 剩下的才当笔记。`![[xxx]]` 通常
      // 不写扩展名，所以「不是图片」推不出「是笔记」——PDF、录音这些必须先在
      // 附件那一档拦住，否则会拿一个二进制文件去 /read。
      const notePath =
        hit === undefined && !IMAGE_EXT_RE.test(path) && !FILE_EXT_RE.test(path) && typeof opts.resolveNote === 'function'
          ? opts.resolveNote(clean)
          : ''
      // 嵌进来的笔记里再嵌一篇、那一篇又嵌回来，会无限递归。只往下走一层：
      // 第二层开始一律显示成文件名胶囊，用户点进去就能看到完整的那一篇。
      const depth = typeof opts.embedDepth === 'number' ? opts.embedDepth : 0
      if (notePath !== '' && depth < 1) {
        return h(NoteEmbed, {
          key,
          path: notePath,
          label: base.replace(/\.md$/i, ''),
          depth: depth + 1,
          anchor: typeof opts.anchor === 'string' ? opts.anchor : '',
          onOpen: opts.onOpenWikiLink,
          resolveNote: opts.resolveNote,
          t: opts.t,
        })
      }
      if (IMAGE_EXT_RE.test(path)) {
        const hosted = assetUrlOf(path)
        // 点了交给宿主打开；没注入宿主时不给光标、不挂 onClick——挂一个点了
        // 什么都不会发生的处理器，比不能点更让人困惑。
        const openable = hasOpenAsset()
        const size = parseImageSize(opts.label)
        // 写了尺寸就按写的来：缩略图行那条 max-height 会把 300 高的图压成 200，
        // 用户写数字就是为了看图本身，这里得让开。
        const sized = size === null ? {} : {
          width: `${size.width}px`,
          height: size.height > 0 ? `${size.height}px` : 'auto',
          maxHeight: 'none',
        }
        return h('img', {
          key,
          className: 'dshgn_img' + (openable ? ' dshgn_imgOpen' : '') + (size === null ? '' : ' dshgn_imgSized'),
          style: sized,
          src: hosted !== '' ? hosted : withToken(`${apiOrigin()}/getnote/asset?path=${encodeURIComponent(path)}`),
          alt: base,
          loading: 'lazy',
          onClick: openable
            ? (event) => {
                if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
                openAssetInHost(path)
              }
            : undefined,
        })
      }
      return h('span', { key, className: 'dshgn_embedFile' }, base)
    }

    /** 表格：`| a | b |` + 分隔行。返回 { table, consumed }。 */
    function parseTable(lines, start) {
      const headerCells = splitRow(lines[start])
      if (headerCells === null) return null
      if (start + 1 >= lines.length) return null
      if (!/^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[start + 1])) return null
      // 对齐标记写在分隔行里：`:---` 靠左、`:---:` 居中、`---:` 靠右。
      // 宿主认这三套，面板原来一律靠左——一份「金额」右对齐的表格搬过来会全部
      // 贴到左边，数字位数不一就完全没法看。没写冒号就是默认，交给 CSS。
      const aligns = splitRow(lines[start + 1]) || []
      const alignOf = (index) => {
        const cell = String(aligns[index] === undefined ? '' : aligns[index]).trim()
        if (!cell.includes(':')) return ''
        const left = cell.startsWith(':')
        const right = cell.endsWith(':')
        if (left && right) return 'center'
        if (right) return 'right'
        return 'left'
      }
      const rows = []
      let index = start + 2
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        const cells = splitRow(lines[index])
        if (cells === null) break
        rows.push(cells)
        index += 1
      }
      return { header: headerCells, rows, alignOf, consumed: index - start }
    }

    function splitRow(line) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('|')) return null
      const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '')
      return inner.split('|').map((cell) => cell.trim())
    }

    /**
     * 去掉正文开头与标题同名的一级标题。
     *
     * 云端笔记的正文经常以 `# 标题` 开头，而阅读区外面已经渲染了一行 h1，
     * 不剥掉就会出现两个一模一样的大标题。只剥「一级 + 同名」，别的不动。
     */
    function stripLeadingHeading(markdown, title) {
      const text = String(markdown || '')
      const name = String(title || '').trim()
      if (name === '') return text
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return text.replace(new RegExp(`^\\s*#\\s+${escaped}\\s*\\n+`), '')
    }

    // callout 的配色与图标。宿主里 callout 类型是自由的（[!任意名字] 都能写），
    // 所以这里只给常见的一批配色，认不出的统一走 note 那套中性色——认不出就当普通
    // 引用块处理会让用户写的 [!warning] 变成一串字符，比配色不准难看得多。
    const CALLOUT_TONES = {
      note: { icon: 'note', tone: '' },
      info: { icon: 'info', tone: 'info' },
      todo: { icon: 'check', tone: 'info' },
      abstract: { icon: 'note', tone: 'info' },
      summary: { icon: 'note', tone: 'info' },
      tldr: { icon: 'note', tone: 'info' },
      tip: { icon: 'brain', tone: 'success' },
      hint: { icon: 'brain', tone: 'success' },
      important: { icon: 'warn', tone: 'success' },
      success: { icon: 'check', tone: 'success' },
      check: { icon: 'check', tone: 'success' },
      done: { icon: 'check', tone: 'success' },
      question: { icon: 'info', tone: 'warn' },
      help: { icon: 'info', tone: 'warn' },
      faq: { icon: 'info', tone: 'warn' },
      warning: { icon: 'warn', tone: 'warn' },
      caution: { icon: 'warn', tone: 'warn' },
      attention: { icon: 'warn', tone: 'warn' },
      failure: { icon: 'close', tone: 'error' },
      fail: { icon: 'close', tone: 'error' },
      missing: { icon: 'close', tone: 'error' },
      danger: { icon: 'warn', tone: 'error' },
      error: { icon: 'warn', tone: 'error' },
      bug: { icon: 'warn', tone: 'error' },
      example: { icon: 'file', tone: '' },
      quote: { icon: 'note', tone: '' },
      cite: { icon: 'note', tone: '' },
    }

    /**
     * 宿主的 callout（`> [!note] 标题` + 缩进正文）。
     *
     * 手写渲染器里以前整块当普通引用，[!note] 会原样显示成一行字符——用户写的
     * 「注意」「警告」全变成噪音。这里把它拆成「图标 + 标题 + 正文」三块，
     * 类型名不认识的也照样有标题，不吞字。
     *
     * 可折叠标记（[!note]- 默认收起、[!note]+ 默认展开）也认：收起时只留
     * 标题那一行，点标题展开。宿主里 - 就是「默认收起」，照做。
     */
    function CalloutBlock(props) {
      const type = String(props.type || '').toLowerCase()
      const spec = CALLOUT_TONES[type] || { icon: 'note', tone: '' }
      const t = getT()
      const title = String(props.title || '').trim()
      const foldable = props.fold === '-' || props.fold === '+'
      const [open, setOpen] = React.useState(props.fold !== '-')
      const bodyLines = Array.isArray(props.lines) ? props.lines : []
      const hasBody = bodyLines.some((line) => String(line || '').trim() !== '')
      return h(
        'div',
        {
          className: 'dshgn_callout' + (spec.tone === '' ? '' : ' dshgn_callout-' + spec.tone),
          'data-type': type,
        },
        h(
          foldable ? 'button' : 'div',
          {
            type: foldable ? 'button' : undefined,
            className: 'dshgn_calloutHead' + (foldable ? ' dshgn_calloutFold' : ''),
            onClick: foldable
              ? () => {
                  setOpen((prev) => !prev)
                }
              : undefined,
            title: foldable ? t(open ? 'callout.collapse' : 'callout.expand') : undefined,
          },
          h(Icon, { name: spec.icon, size: 13, className: 'dshgn_calloutIcon' }),
          h('span', { className: 'dshgn_calloutTitle' }, title !== '' ? title : type),
          foldable ? h(Icon, { name: open ? 'up' : 'down', size: 12 }) : null,
        ),
        open && hasBody
          ? h('div', { className: 'dshgn_calloutBody' }, renderBlocks(bodyLines.join('\n'), props.opts))
          : null,
      )
    }

    /**
     * 正文渲染的统一入口。
     *
     * 有宿主渲染器（Obsidian 的 MarkdownRenderer）就交给它——callout、公式、
     * Mermaid、脚注、嵌入块、双链、Dataview/Bases 查询块都能出得来；没有
     * （面板的离线测试跑在纯 Node 里）就退回下面这套手写渲染器，保证测试
     * 覆盖的仍然是同一份界面。
     */
    function renderMarkdown(markdown, options) {
      const opts = options || {}
      if (hasMarkdownHost()) {
        return h(MarkdownView, {
          markdown,
          sourcePath: opts.sourcePath || '',
          onOpenLink: opts.onOpenLink,
          onToggleTodo: opts.onToggleTodo,
        })
      }
      return renderBlocks(markdown, opts)
    }

    // 编辑时的字数：中文按字算、西文按词算，和宿主的「字数」口径一致。
    // 中文一个词可能两三个字，按词算会把一篇两千字的中文报成八百，用户会以为丢了一半。
    function countWords(text) {
      const source = String(text === null || text === undefined ? '' : text)
      const cjk = source.match(/[\u4e00-\u9fa5]/g)
      const latin = source.match(/[A-Za-z0-9_'-]+/g)
      return (cjk === null ? 0 : cjk.length) + (latin === null ? 0 : latin.length)
    }

    /**
     * 段落里的换行按宿主的口径处理：单独一个换行是「软换行」，接成一句话；
     * 行尾两个空格或者一个反斜杠才是「硬换行」，真的断行。
     *
     * 原来段落是把整段原文塞给 renderInline，靠 CSS 的 white-space:pre-wrap 显示，
     * 结果每一个换行都成了断行——同一段在 Obsidian 里是一行话，在面板里被切成好几行，
     * 版式看着像两篇东西。
     */
    function renderParagraph(text, keyPrefix, options) {
      const lines = String(text === undefined || text === null ? '' : text).split('\n')
      const nodes = []
      lines.forEach((line, index) => {
        const hard = /(\\|\s{2,})$/.test(line)
        const content = hard ? line.replace(/(\\|\s{2,})$/, '') : line
        const parts = renderInline(content.trim(), `${keyPrefix}l${index}`, options)
        parts.forEach((part) => nodes.push(part))
        if (index === lines.length - 1) return
        if (hard) nodes.push(h('br', { key: `${keyPrefix}br${index}` }))
        else nodes.push(' ')
      })
      return nodes
    }

    function renderBlocks(markdown, options) {
      const opts = options || {}
      const lines = String(markdown || '').split(/\r?\n/)
      const blocks = []
      let index = 0
      let key = 0
      // 待办序号：与 host 侧 toggleTodo 的口径必须逐字一致，否则点第一条却勾了第二条。
      // 两边都是「从上往下扫，跳过代码围栏」。引用块里的待办两边都不算（host 侧
      // 那一行的开头是 `>`，匹配不上 `^(\s*)([-*+])\s+\[`；这里的递归调用也不传
      // opts，所以既不计数也不可点），口径天然对齐。
      const todoCounter = typeof opts.onToggleTodo === 'function' ? { n: 0 } : null
      // 脚注：`[^id]: 注解正文` 是定义，`[^id]` 是引用。宿主把定义收在篇尾
      // 渲染成一小块注解列表，正文里只留一个上标。我们原来把定义行当普通段落
      // 原样显示，读者会看到一串 `[^1]: ...` 混在正文中间。
      const footnotes = []

      while (index < lines.length) {
        const line = lines[index]
        const trimmed = line.trim()

        if (trimmed === '') {
          index += 1
          continue
        }

        // 代码围栏
        const fence = /^(```|~~~)\s*(\S*)\s*$/.exec(trimmed)
        if (fence) {
          const marker = fence[1]
          const lang = fence[2] || ''
          const body = []
          index += 1
          while (index < lines.length && !lines[index].trim().startsWith(marker)) {
            body.push(lines[index])
            index += 1
          }
          index += 1 // 跳过收尾围栏（未闭合就到文件末尾）
          const fenceText = body.join('\n')
          // 归档里的「## 逐字稿」是一段带时间戳的围栏。用等宽字体渲染中文口语
          // 既丑又会被横向裁掉，所以认出来就走逐字稿排版。
          blocks.push(
            looksLikeTranscript(fenceText)
              ? h(TranscriptBlock, { key: `b${key++}`, text: fenceText })
              : h(
                  'pre',
                  { key: `b${key++}`, className: 'dshgn_pre' },
                  lang ? h('span', { className: 'dshgn_preLang' }, lang) : null,
                  h('code', null, fenceText),
                ),
          )
          continue
        }

        // 整段注释：\`%%\` 单独起一行、下面几行是注释内容、再用一行 \`%%\` 收尾。
        // 宿主里这一整段是不显示的（不是折叠、不是灰字，就是不存在），这里也
        // 一个字都不留——留着的话用户会以为自己写的东西没被注释掉。
        // 只认「整行就是 %%」的开头，行尾带内容的交给行内那条规则处理。
        if (trimmed === '%%') {
          index += 1
          while (index < lines.length && lines[index].trim() !== '%%') index += 1
          index += 1
          continue
        }

        // 脚注定义：`[^id]: 注解正文`，缩进的续行也算这条注解的一部分
        const footDef = /^\[\^([^\]\n]+)\]:\s?(.*)$/.exec(trimmed)
        if (footDef) {
          const footId = footDef[1].trim()
          const footBody = [footDef[2]]
          index += 1
          while (index < lines.length && /^\s{2,}\S/.test(lines[index])) {
            footBody.push(lines[index].trim())
            index += 1
          }
          footnotes.push({ id: footId, text: footBody.join(' ').trim() })
          continue
        }

        // 标题
        const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
        if (heading) {
          const level = heading[1].length
          // 标题也能挂块 id（`## 甲节 ^abc`）：挂在标题上的引用要跳到这个标题。
          const headingId = blockIdIn(heading[2])
          blocks.push(
            h(
              `h${Math.min(level + 0, 6)}`,
              {
                key: `b${key++}`,
                className: `dshgn_h dshgn_h${level}`,
                'data-block-id': headingId === '' ? undefined : headingId,
              },
              renderInline(stripBlockId(heading[2]), `b${key}`, opts),
            ),
          )
          index += 1
          continue
        }

        // 分隔线
        if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
          blocks.push(h('hr', { key: `b${key++}`, className: 'dshgn_hr' }))
          index += 1
          continue
        }

        // 表格
        if (trimmed.startsWith('|')) {
          const table = parseTable(lines, index)
          if (table) {
            blocks.push(
              h(
                'div',
                { key: `b${key++}`, className: 'dshgn_tableWrap' },
                h(
                  'table',
                  { className: 'dshgn_table' },
                  h(
                    'thead',
                    null,
                    h(
                      'tr',
                      null,
                      table.header.map((cell, i) =>
                        h(
                          'th',
                          { key: i, style: table.alignOf(i) === '' ? undefined : { textAlign: table.alignOf(i) } },
                          renderInline(cell, `th${i}`, opts),
                        ),
                      ),
                    ),
                  ),
                  h(
                    'tbody',
                    null,
                    table.rows.map((row, rowIndex) =>
                      h(
                        'tr',
                        { key: rowIndex },
                        row.map((cell, cellIndex) =>
                          h(
                            'td',
                            {
                              key: cellIndex,
                              style: table.alignOf(cellIndex) === '' ? undefined : { textAlign: table.alignOf(cellIndex) },
                            },
                            renderInline(cell, `td${rowIndex}-${cellIndex}`, opts),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            )
            index += table.consumed
            continue
          }
        }

        // 引用块（逐行，不吞后续行）
        if (trimmed.startsWith('>')) {
          const body = []
          while (index < lines.length && lines[index].trim().startsWith('>')) {
            body.push(lines[index].trim().replace(/^>\s?/, ''))
            index += 1
          }
          // `> [!note] 标题` 是宿主的 callout。以前整块当普通引用渲染，
          // `[!note]` 会原样显示成一串字符，用户写的「注意」和正文混在一起。
          // 类型名不限英文——宿主认的是「方括号感叹号 + 任意名字」，
          // 写成中文类型也照样是个 callout，只是配色走中性那套。
          const callout = /^\[!([^\]\n]+?)\]([+-]?)\s*(.*)$/.exec(body[0].trim())
          if (callout) {
            blocks.push(
              h(CalloutBlock, {
                key: `b${key++}`,
                type: callout[1],
                fold: callout[2],
                title: callout[3],
                lines: body.slice(1),
                opts,
              }),
            )
            continue
          }
          blocks.push(
            h(
              'blockquote',
              { key: `b${key++}`, className: 'dshgn_quote' },
              renderBlocks(body.join('\n')),
            ),
          )
          continue
        }

        // 列表（含任务列表）
        const listMatch = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
        if (listMatch) {
          const ordered = /\d/.test(listMatch[2])
          const items = []
          while (index < lines.length) {
            const current = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[index])
            if (!current) {
              // 单独一行的块 id 属于上一条列表项（宿主两种写法都认：写在行尾，
              // 或者另起一行）。不接住的话它会被当成一个空段落渲染出来。
              const loneId = /^\s*\^([A-Za-z0-9-]{1,64})\s*$/.exec(lines[index])
              if (loneId && items.length > 0) {
                items[items.length - 1].blockId = loneId[1]
                index += 1
                continue
              }
              // 列表项里的续行
              if (lines[index].trim() !== '' && items.length > 0 && /^\s{2,}\S/.test(lines[index])) {
                items[items.length - 1].continuation.push(lines[index].trim())
                index += 1
                continue
              }
              break
            }
            items.push({ text: current[3], ordered: /\d/.test(current[2]), continuation: [], blockId: '' })
            index += 1
          }
          blocks.push(
            h(
              ordered ? 'ol' : 'ul',
              { key: `b${key++}`, className: 'dshgn_mdList' },
              items.map((item, itemIndex) => {
                const task = /^\[( |x|X)\]\s+(.*)$/.exec(item.text)
                // 行尾的 `^id` 是块引用记号，不该显示出来
                const tailId = blockIdIn(task ? task[2] : item.text)
                const content = stripBlockId(task ? task[2] : item.text)
                const itemId = item.blockId !== '' ? item.blockId : tailId
                // 只有「可点」时才分配序号：编辑态/冲突比对里渲染的同一篇笔记没有
                // onToggleTodo，不该悄悄消耗序号（否则会与 host 侧错位）。
                let todoIndex = -1
                if (task && todoCounter !== null) {
                  todoIndex = todoCounter.n
                  todoCounter.n += 1
                }
                const done = task !== null && task[1].toLowerCase() === 'x'
                return h(
                  'li',
                  {
                    key: itemIndex,
                    className: task ? 'dshgn_li dshgn_task' : 'dshgn_li',
                    'data-block-id': itemId === '' ? undefined : itemId,
                  },
                  task
                    ? h('span', {
                        className: 'dshgn_check' + (done ? ' dshgn_checkOn' : '') + (todoIndex >= 0 ? ' dshgn_checkHit' : ''),
                        'aria-hidden': 'true',
                        role: todoIndex >= 0 ? 'checkbox' : undefined,
                        'aria-checked': todoIndex >= 0 ? (done ? 'true' : 'false') : undefined,
                        title: todoIndex >= 0 ? getT()('todo.toggle') : undefined,
                        onClick:
                          todoIndex >= 0
                            ? (event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                opts.onToggleTodo(todoIndex, !done)
                              }
                            : undefined,
                      })
                    : null,
                  renderInline(content, `li${itemIndex}`, opts),
                  item.continuation.length > 0
                    ? h('div', { className: 'dshgn_liCont' }, renderInline(item.continuation.join(' '), `lc${itemIndex}`, opts))
                    : null,
                )
              }),
            ),
          )
          continue
        }

        // 段落：连续非空行合成一段（保持换行）
        const paragraph = []
        while (
          index < lines.length &&
          lines[index].trim() !== '' &&
          !/^\s*(#{1,6}\s|```|~~~|>|[-*+]\s|\d+[.)]\s|\|)/.test(lines[index]) &&
          !/^(\*{3,}|-{3,}|_{3,})$/.test(lines[index].trim())
        ) {
          paragraph.push(lines[index])
          index += 1
        }
        // 段落行尾的 `^id` 是块引用记号：这一段挂了 id 之后，
        // `[[笔记#^id]]` 才跳得到它。记号本身不该显示在正文里。
        const paraText = paragraph.join('\n')
        const paraId = blockIdIn(paraText)
        blocks.push(
          h(
            'p',
            { key: `b${key++}`, className: 'dshgn_p', 'data-block-id': paraId === '' ? undefined : paraId },
            renderParagraph(stripBlockId(paraText), `p${key}`, opts),
          ),
        )
      }

      // 篇尾的注解列表。宿主也是收在正文最后，编号跟着定义走的顺序。
      if (footnotes.length > 0) {
        blocks.push(
          h(
            'div',
            { key: `b${key++}`, className: 'dshgn_footnotes' },
            footnotes.map((foot) =>
              h(
                'div',
                { key: foot.id, className: 'dshgn_footnote', 'data-footnote-id': foot.id },
                h('span', { className: 'dshgn_footnoteNo' }, foot.id),
                h('span', { className: 'dshgn_footnoteText' }, renderInline(foot.text, `fn-${foot.id}`, opts)),
              ),
            ),
          ),
        )
      }

      return blocks
    }

    // ── 样式（只用 --dsw-* token，跟随主题）─────────────────────────────────────

    const CSS = `
.dshgn_root{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;
  background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary);
  font-family:var(--font-interface,var(--dsw-font-sans,inherit));font-size:var(--font-ui-small,13px)}
.dshgn_head{flex:none;display:flex;align-items:center;gap:10px;padding:10px 14px;
  border-bottom:0.5px solid var(--dsw-alias-border-l2)}
.dshgn_headMain{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.dshgn_title{font-size:13px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary)}
.dshgn_sub{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.dshgn_tabs{display:flex;gap:2px;padding:3px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_tab{appearance:none;border:0;height:24px;padding:0 10px;border-radius:7px;background:transparent;
  color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;line-height:24px;
  display:inline-flex;align-items:center;gap:5px}
.dshgn_tab:hover{color:var(--dsw-alias-label-primary)}
.dshgn_tab[data-on="true"]{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}
/* 页签上的数字小标：跟文字同一行、排在右边。用 pill 而不是右上角角标，
   是因为角标要绝对定位，会把「冲突」两个字的右内边距吃掉、跟后面页签挤在一起。 */
.dshgn_tabLabel{display:inline-block}
.dshgn_tabBadge{display:inline-flex;align-items:center;justify-content:center;
  min-width:16px;height:16px;padding:0 5px;border-radius:8px;
  background:var(--dsw-alias-state-error-primary);color:#fff;
  font-size:10px;font-weight:600;line-height:16px;letter-spacing:0;
  font-variant-numeric:tabular-nums}
.dshgn_actions{display:flex;align-items:center;gap:4px;flex:none}
/* 切换页签的入场动画：淡入 + 轻微上浮。180ms 是从「能感觉到」到「不挡手」之间的
   经验值——再慢就有拖沓感，再快就看不出来。只做 opacity/transform，走 GPU 合成，
   不触发重排，面板里同时有列表和正文也不会掉帧。 */
/* 切页签时给内容一个淡入上移。这里只加动画，不要重写 display/flex-direction：
   三栏横排的布局由后面那条 .dshgn_body{flex:1;display:flex;min-height:0} 决定，
   在这里写 flex-direction:column 会把它顶成竖排，三栏就叠成一列了。 */
.dshgn_body{animation:dshgn_tabIn 180ms cubic-bezier(.22,.61,.36,1)}
/* 从左到右滑入：横排三栏的阅读方向是横向的，左右位移比上下位移更贴合
   「翻到下一页」的感觉；上下位移在宽面板里会显得像整块往下掉。
   刻意不做透明度渐变：左栏是深蓝底，从 opacity:0 淡入时透出的是接近白的面板
   底色，看起来就是「深色那一栏先白闪一下再变深」。只做位移没有这个问题，
   位移本身已经足够让人感到「换了一页」。 */
@keyframes dshgn_tabIn{
  from{transform:translateX(-16px)}
  to{transform:translateX(0)}
}
/* 用户系统里开了「减少动效」就完全别动：这类前庭敏感的用户看到位移会不适，
   而且他们开这个开关本来就是为了让界面别动。 */
@media (prefers-reduced-motion:reduce){
  .dshgn_body{animation:none}
  .dshgn_root *{transition-duration:0ms !important}
}
/* 主题色色板：8 个圆形色块 + 一个「自定义」按钮。
   色块本身用内联 background（每个颜色不一样），所以这里只管形状与选中环。 */
.dshgn_themeRow{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:4px}
.dshgn_swatch{appearance:none;width:26px;height:26px;border-radius:50%;cursor:pointer;
  border:0;padding:0;box-shadow:inset 0 0 0 1px rgba(255,255,255,.22);
  transition:transform 120ms ease,box-shadow 120ms ease}
.dshgn_swatch:hover{transform:scale(1.08)}
/* 选中环用外发光而不是 border：border 会把色块撑大 2px，一排圆点就大小不一了 */
.dshgn_swatchOn{box-shadow:inset 0 0 0 1px rgba(255,255,255,.22),0 0 0 2px var(--dshgn-accentOnLight),
  0 0 0 4px var(--dshgn-light)}
.dshgn_colorInput{width:44px;height:28px;padding:2px;border-radius:7px;cursor:pointer;
  border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay)}
/* 三栏效果预览条：三格按真实层次排开，让用户在设置页里就能看出「左深中浅右白」。
   高 30px 是因为要放得下 11px 的字，再矮文字会被挤成一条线。 */
.dshgn_previewBar{display:flex;gap:0;margin-top:10px;border-radius:8px;overflow:hidden;
  border:0.5px solid var(--dsw-alias-border-l2)}
.dshgn_previewCell{flex:1;height:30px;display:flex;align-items:center;justify-content:center;
  font-size:11px;letter-spacing:.02em}
.dshgn_iconBtn{appearance:none;display:inline-flex;align-items:center;justify-content:center;
  width:28px;height:28px;border:0;border-radius:8px;background:transparent;
  color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshgn_iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshgn_iconBtn:disabled{opacity:.45;cursor:default}
.dshgn_iconBtn[data-on="true"]{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-brand-primary)}
/* 刷新反馈：顺时针转 5 圈 = 「收到了」，变绿/变红 = 「成没成」，5 秒后回到中性灰。
   正角度 = 顺时针。
   缓动故意用 ease-out 而不是 linear：先快后慢才像「转起来再停下」，
   匀速转会让人以为它会一直转下去。 */
.dshgn_refreshSpin{display:inline-flex;align-items:center;justify-content:center}
.dshgn_refreshSpinOn{animation:dshgn_spin 1400ms cubic-bezier(.16,.84,.24,1) 1 both}
@keyframes dshgn_spin{
  from{transform:rotate(0deg)}
  to{transform:rotate(1800deg)}
}
/* 成功/失败用颜色说话，不弹 toast：用户视线就在那个小图标上，冒出来的提示
   反而会让他去找「刚才发生了什么」。
   平时是中性灰（和「+」同一个颜色），只有结果揭晓的那 5 秒才着色。 */
.dshgn_iconBtnOk{color:var(--dsw-alias-state-success-primary)}
.dshgn_iconBtnFail{color:var(--dsw-alias-state-error-primary)}
/* 「+」和「刷新」必须同色：两个并排的图标按钮一旦一个灰一个蓝，
   用户会以为蓝色的那个是主操作、灰色那个不可用。 */
.dshgn_head .dshgn_iconBtn{color:var(--dsw-alias-label-tertiary)}
.dshgn_head .dshgn_iconBtn:hover{color:var(--dsw-alias-label-primary)}
.dshgn_head .dshgn_iconBtn.dshgn_iconBtnOk{color:var(--dsw-alias-state-success-primary)}
.dshgn_head .dshgn_iconBtn.dshgn_iconBtnFail{color:var(--dsw-alias-state-error-primary)}
/* 大纲：贴着阅读区顶部的一条可折叠目录。层级靠左内边距区分，不做竖线树状，
   因为阅读区本来就窄，画树线会把标题文字挤到很短。 */
.dshgn_outline{margin:0 0 10px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;
  background:var(--dsw-alias-interactive-bg-hover);overflow:hidden}
.dshgn_outlineToggle{appearance:none;display:flex;align-items:center;gap:6px;width:100%;
  padding:7px 10px;border:0;background:transparent;font:inherit;font-size:11px;
  color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left}
.dshgn_outlineToggle:hover{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-primary)}
.dshgn_outlineCount{margin-left:auto;min-width:16px;text-align:center;padding:0 4px;border-radius:7px;
  background:rgba(var(--dshgn-tintRgb),.1);font-size:10px;line-height:15px;
  color:var(--dsw-alias-label-tertiary)}
.dshgn_outlineList{padding:0 0 5px;max-height:220px;overflow-y:auto}
.dshgn_outlineItem{appearance:none;display:block;width:100%;padding:3px 10px;border:0;
  background:transparent;font:inherit;font-size:12px;line-height:1.5;
  color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshgn_outlineItem:hover{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-brand-primary)}
/* 属性区：笔记头部那些键值（tags / aliases / 自定义字段）。
   放在正文上方、比大纲更淡——它是「这篇是什么」，不是「这篇写了什么」，
   读正文时它应该退到背景里，但要一眼能扫到。 */
.dshgn_props{margin:0 0 12px;border:0.5px solid var(--dsw-alias-border-l1);
  border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden;font-size:11.5px}
.dshgn_propsBody{padding:0 10px 7px}
.dshgn_propRow{display:flex;align-items:flex-start;gap:8px;padding:2px 0;line-height:1.6}
.dshgn_propKey{flex:0 0 auto;min-width:52px;max-width:110px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_propVal{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);
  word-break:break-word;white-space:pre-wrap}
.dshgn_propTag{appearance:none;border:0;border-radius:9px;padding:1px 7px;margin:0 4px 4px 0;
  background:rgba(var(--dshgn-tintRgb),.1);font:inherit;font-size:11px;
  color:var(--dsw-alias-brand-primary);cursor:pointer}
.dshgn_propTag:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}
/* 关联笔记：正文读完才出现，所以样式比大纲更轻——它是一条补充信息，不该抢正文视线。 */
/* 断链清单：一行一处。目标名字用错误色，因为这一行本身就是「这里有问题」；
   底下的位置与上下文用淡色，扫一眼就能跳过正常的那些。 */
.dshgn_brokenRow{appearance:none;display:flex;flex-direction:column;gap:3px;width:100%;
  text-align:left;padding:8px 10px;border:0.5px solid var(--dsw-alias-border-l1);
  border-radius:8px;background:transparent;font:inherit;cursor:pointer}
.dshgn_brokenRow:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.dshgn_brokenTarget{font-size:12px;font-weight:600;color:var(--dsw-alias-state-error-primary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_brokenWhere{font-size:10.5px;color:var(--dsw-alias-label-dimmed);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_brokenSnip{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_backlinks{margin-top:18px;padding-top:12px;border-top:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_backlinksHead{display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:11px;
  color:var(--dsw-alias-label-tertiary)}
.dshgn_backlinkItem{appearance:none;display:flex;flex-direction:column;gap:2px;width:100%;
  padding:6px 9px;margin-bottom:3px;border:0;border-radius:7px;
  background:var(--dsw-alias-interactive-bg-hover);font:inherit;cursor:pointer;text-align:left}
.dshgn_backlinkItem:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}
.dshgn_backlinkTitle{font-size:12px;color:var(--dsw-alias-brand-primary);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshgn_backlinkSnip{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_backlinkPath{font-size:10px;color:var(--dsw-alias-label-dimmed);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 出链：这篇自己引用了谁。一条条竖排太占地方（出链常常十几条），排成一行胶囊。 */
.dshgn_outlinks{margin-top:14px;padding-top:10px;border-top:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_outlinksHead{display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:11px;
  color:var(--dsw-alias-label-tertiary)}
.dshgn_outlinkRow{display:flex;flex-wrap:wrap;gap:4px}
.dshgn_outlinkChip{appearance:none;border:0;border-radius:6px;padding:3px 8px;font:inherit;font-size:11px;
  max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;
  background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}
.dshgn_outlinkChip:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}
/* 搜索增强：命中次数用一个小胶囊标在标题右边，命中行带行号——
   用户判断「这篇是不是我要的」靠的就是这两样东西。 */
.dshgn_pickBox{flex:none;width:14px;height:14px;border-radius:4px;display:flex;
  align-items:center;justify-content:center;cursor:pointer;opacity:0;
  border:1px solid var(--dsw-alias-border-l2);background:transparent;
  transition:opacity 120ms ease,background 120ms ease}
.dshgn_card:hover .dshgn_pickBox,.dshgn_pickBoxOn{opacity:1}
.dshgn_pickBoxOn{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-label-primary-foreground)}
.dshgn_batchBar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 8px;
  border-bottom:0.5px solid rgba(var(--dshgn-tintRgb),.14);background:rgba(var(--dshgn-tintRgb),.07)}
.dshgn_batchCount{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dshgn_batchBtn{appearance:none;border:0;background:transparent;cursor:pointer;
  font:inherit;font-size:11px;padding:2px 6px;border-radius:5px;
  color:var(--dsw-alias-label-secondary)}
.dshgn_batchBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_batchMenu{flex-basis:100%;display:flex;flex-direction:column;gap:6px;
  padding:8px;margin-top:2px;border-radius:8px;background:var(--dshgn-surface);
  box-shadow:0 2px 10px rgba(var(--dshgn-tintRgb),.14)}
.dshgn_batchRow{display:flex;gap:6px;align-items:center}
.dshgn_batchInput{flex:1;min-width:0;height:26px;font-size:12px}
.dshgn_cardTitleRow{display:flex;align-items:center;gap:6px}
.dshgn_cardTitleRow .dshgn_cardTitle{flex:1;min-width:0}
/* 中栏笔记卡：勾选框从行内挪到左侧留白里。
   原来它占着标题行首的位置，把标题文字往右推了 20px，而下面的日期与正文
   直接从卡片内边距起——三行左边缘对不齐，看着像缩进错乱。现在整张卡统一
   多留 20px 左内边距，勾选框绝对定位停在留白里，标题/日期/正文左端一致。 */
.dshgn_card[data-pick="true"]{position:relative;padding-left:28px}
.dshgn_card[data-pick="true"] .dshgn_pickBox{position:absolute;left:8px;top:9px}
.dshgn_hitCount{flex:none;min-width:17px;text-align:center;padding:0 4px;border-radius:7px;
  background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);
  font-size:10px;line-height:15px;font-weight:600}
.dshgn_cardMatches{margin-top:3px;display:flex;flex-direction:column;gap:2px}
.dshgn_matchLine{display:flex;gap:5px;align-items:baseline;width:100%;appearance:none;border:0;background:transparent;padding:1px 3px;margin:0 -3px;border-radius:4px;font:inherit;font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer}
.dshgn_matchLine:hover{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-primary)}
.dshgn_matchNo{flex:none;min-width:18px;text-align:right;font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-dimmed);font-size:10px;padding-top:1px}
.dshgn_matchText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_cardLinks{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.dshgn_cardLinkChip{appearance:none;border:0;background:rgba(var(--dshgn-tintRgb),.08);
  color:var(--dsw-alias-brand-primary);border-radius:6px;padding:1px 6px;font-size:10px;
  cursor:pointer;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_cardLinkChip:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}
.dshgn_cardLinkMore{font-size:10px;color:var(--dsw-alias-label-dimmed);align-self:center}
.dshgn_searchHint{padding:0 10px 7px;font-size:10px;line-height:1.5;
  color:var(--dsw-alias-label-dimmed)}
.dshgn_searching{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary)}
/* 字号三档：只改 .dshgn_md 的字号与行距，标题和代码块用 em 相对放大，
   整篇比例保持一致——如果标题写死 px，放大正文字号后标题会显得比正文还小。 */
.dshgn_scaleGroup{display:inline-flex;align-items:center;gap:1px;margin-left:auto;
  padding:1px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_scaleBtn{appearance:none;display:inline-flex;align-items:flex-end;justify-content:center;
  width:20px;height:20px;border:0;border-radius:5px;background:transparent;
  color:var(--dsw-alias-label-tertiary);cursor:pointer;font-family:inherit;padding-bottom:2px}
.dshgn_scaleBtn:hover{color:var(--dsw-alias-label-primary)}
.dshgn_scaleBtnOn{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-brand-primary);
  box-shadow:0 1px 2px rgba(var(--dshgn-tintRgb),.14)}
/* 新建模板菜单：点「+」弹一层小菜单。遮罩用透明 div 而不是监听 document 点击，
   因为面板是 slot 里的子树，document 级监听在 React 卸载时容易漏摘。 */
.dshgn_newWrap{position:relative;display:inline-flex}
.dshgn_menuMask{position:fixed;inset:0;z-index:40;background:transparent}
.dshgn_menu{position:absolute;top:32px;left:0;z-index:41;min-width:190px;padding:5px;
  border-radius:9px;background:var(--dsw-alias-bg-overlay);
  border:0.5px solid var(--dsw-alias-border-l2);box-shadow:0 6px 20px rgba(var(--dshgn-tintRgb),.18)}
.dshgn_menuTitle{padding:4px 8px 6px;font-size:10px;letter-spacing:.04em;
  color:var(--dsw-alias-label-dimmed)}
.dshgn_menuItem{appearance:none;display:flex;align-items:center;gap:8px;width:100%;
  padding:6px 8px;border:0;border-radius:6px;background:transparent;font:inherit;
  font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}
.dshgn_menuItem:hover{background:var(--dsw-alias-interactive-bg-hover-accent);
  color:var(--dsw-alias-brand-primary)}
.dshgn_menuHint{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-dimmed)}
/* 骨架屏：用一条脉动的浅色块占位。动画只改 opacity，不改尺寸——
   改尺寸会触发重排，三栏骨架一起抖看着像卡住。 */
.dshgn_skTree,.dshgn_skList,.dshgn_skNote{padding:14px 12px;gap:9px}
.dshgn_skTree{display:flex;flex-direction:column}
.dshgn_skList{display:flex;flex-direction:column;gap:10px}
.dshgn_skNote{display:flex;flex-direction:column;gap:11px}
.dshgn_skCard{display:flex;flex-direction:column;gap:7px;padding:10px 11px;border-radius:8px;
  background:rgba(var(--dshgn-tintRgb),.10)}
.dshgn_skRow{border-radius:5px;background:var(--dsw-alias-interactive-bg-hover);
  animation:dshgn_skPulse 1.4s ease-in-out infinite}
.dshgn_skTree .dshgn_skRow{background:rgba(var(--dshgn-tintRgb),.07)}
@keyframes dshgn_skPulse{
  0%,100%{opacity:.55}
  50%{opacity:1}
}
@media (prefers-reduced-motion:reduce){
  .dshgn_skRow{animation:none;opacity:.7}
}
/* 冲突比对：左右两列各自滚动。默认走 Markdown 渲染（.dshgn_diffMd），
   和「笔记」「云端」页读起来一致；切到「原文」时才用 .dshgn_diffBody 的等宽 pre，
   那种模式是为抠空格/换行差异准备的。 */
.dshgn_diffRow{display:flex;gap:10px;flex:1;min-height:0;overflow:hidden}
.dshgn_diffCol{flex:1;min-width:0;display:flex;flex-direction:column;
  border:0.5px solid var(--dsw-alias-border-l2);border-radius:9px;overflow:hidden;
  background:var(--dsw-alias-bg-overlay)}
.dshgn_diffHead{flex:none;padding:6px 10px;font-size:11px;font-weight:600;
  background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);
  border-bottom:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_diffBody{flex:1;min-height:0;margin:0;padding:10px 12px;overflow:auto;
  font-family:var(--font-monospace,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:11.5px;
  line-height:1.65;white-space:pre-wrap;word-break:break-word;
  color:var(--dsw-alias-label-primary)}
/* 渲染模式：沿用 .dshgn_md 的排版规则（标题层级/表格/引用/围栏），
   但去掉 max-width 居中——两列各占一半宽度，居中会让正文缩在中间一窄条。 */
.dshgn_diffMd{font-family:inherit;font-size:12.5px;line-height:1.7;white-space:normal}
.dshgn_diffMd .dshgn_md{max-width:none;margin:0;font-size:inherit}
.dshgn_diffMd .dshgn_h{margin:12px 0 6px}
.dshgn_diffMd .dshgn_h1{font-size:1.3em}
.dshgn_diffMd .dshgn_h2{font-size:1.15em}
.dshgn_diffMd .dshgn_h3{font-size:1.02em}
.dshgn_diffEmpty{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;
  padding:20px;font-size:12px;line-height:1.7;text-align:center;
  color:var(--dsw-alias-label-tertiary)}
.dshgn_dot{color:var(--dsw-alias-label-dimmed)}
/* 版本历史：占满阅读区，用列表 + 预览两段式。时间用等宽数字对齐，
   一列扫下来能立刻看出「哪个是我要的那次保存」。 */
.dshgn_historyPane{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.dshgn_historyHead{flex:none;display:flex;align-items:center;gap:6px;padding:8px 12px;
  font-size:12px;color:var(--dsw-alias-label-secondary);
  border-bottom:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_historyList{flex:1;min-height:0;overflow-y:auto;padding:8px 12px}
.dshgn_historyItem{appearance:none;display:flex;align-items:center;gap:10px;width:100%;
  padding:8px 10px;margin-bottom:4px;border:0;border-radius:7px;
  background:var(--dsw-alias-interactive-bg-hover);font:inherit;cursor:pointer;text-align:left}
.dshgn_historyItem:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}
.dshgn_historyTime{flex:1;min-width:0;font-size:12px;font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-primary)}
.dshgn_historyMeta{flex:none;font-size:11px;color:var(--dsw-alias-label-dimmed)}
.dshgn_mdS{font-size:12px;line-height:1.7}
.dshgn_mdL{font-size:15px;line-height:1.9}
/* 用 !important 是为了盖过 .dshgn_note .dshgn_md 的 13.5px —— 那条规则
   多一层选择器，普通写法压不住它，档位会「点了没反应」。
   （CSS 注释里不能写反引号：整个样式表是一个 JS 模板字符串，反引号会提前收尾。） */
.dshgn_note .dshgn_md.dshgn_mdS{font-size:12px !important;line-height:1.7}
.dshgn_note .dshgn_md.dshgn_mdL{font-size:15px !important;line-height:1.9}
.dshgn_btn{appearance:none;display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 11px;
  border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;
  color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;white-space:nowrap}
.dshgn_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_btn:disabled{opacity:.5;cursor:default}
.dshgn_btnPrimary{border:0;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.dshgn_btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dshgn_btnDanger{color:var(--dsw-alias-state-error-primary)}
/* overflow:hidden 是承重的：三栏各自内部滚动，外层绝不能滚。
   少了它，正文里一块超宽的代码表格会把整个 .dshgn_body 撑出横向滚动条，
   点大纲跳转时浏览器把外层的横向滚动一起带走，看起来就是「整个插件往左移、变形」。 */
.dshgn_body{flex:1;display:flex;min-height:0;min-width:0;overflow:hidden}
.dshgn_tree{flex:none;width:var(--dshgn-treeW,204px);display:flex;flex-direction:column;min-height:0;
  border-right:0.5px solid var(--dsw-alias-border-l2);overflow-y:auto;overflow-x:hidden;padding:8px 6px}
.dshgn_treeHead{display:flex;align-items:center;justify-content:space-between;gap:6px;
  padding:4px 6px;font-size:11px;color:var(--dsw-alias-label-tertiary);user-select:none}
.dshgn_treeRow{display:flex;align-items:center;gap:6px;height:26px;padding:0 7px;border-radius:7px;
  color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;user-select:none}
.dshgn_treeRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_treeRow[data-on="true"]{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-primary)}
.dshgn_treeName{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;font-size:12px}
.dshgn_treeCount{flex:none;font-size:10px;color:var(--dsw-alias-label-dimmed)}
/* max-width + 省略号是承重的：标签名是用户随手起的，一个长标签在 190px 的左栏里
   会把胶囊撑得比栏还宽，而 .dshgn_tree 只设了 overflow-y，横向就溢到栏外面去了
   ——看起来就是「字跑到标签圈外面」。胶囊自己截断，宽度永远不超过所在行。 */
.dshgn_tagRow{display:inline-flex;align-items:center;gap:4px;height:22px;margin:0 4px 4px 0;padding:0 8px;
  border-radius:11px;border:0.5px solid var(--dsw-alias-border-l2);background:transparent;
  color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11px;
  max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_tagRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_tagRow[data-on="true"]{border-color:transparent;background:var(--dsw-alias-interactive-bg-hover-accent);
  color:var(--dsw-alias-brand-primary)}
.dshgn_treeTags{display:flex;flex-wrap:wrap;padding:2px 4px}
/* 写作热力图：16 周 × 7 天的小方格。格子用 grid-auto-flow:column 按列铺，
   所以 DOM 顺序是「一天接一天」，视觉上是「一周一列」——顺序对了不用重排。 */
.dshgn_heat{flex:none;margin:6px 6px 8px;padding:8px 8px 6px;border-radius:8px;
  background:rgba(255,255,255,.05)}
.dshgn_heatHead{display:flex;align-items:baseline;justify-content:space-between;gap:6px;
  margin-bottom:6px}
.dshgn_heatTitle{font-size:10px;letter-spacing:.04em;text-transform:uppercase;
  color:var(--dsw-alias-label-tertiary)}
.dshgn_heatStat{font-size:10px;font-weight:600;color:var(--dsw-alias-label-secondary);
  font-variant-numeric:tabular-nums}
.dshgn_heatGrid{display:grid;grid-auto-flow:column;gap:2px}
.dshgn_heatCell{width:7px;height:7px;border-radius:2px;background:rgba(255,255,255,.08)}
.dshgn_heatCell[data-lv="1"]{background:rgba(255,255,255,.28)}
.dshgn_heatCell[data-lv="2"]{background:rgba(255,255,255,.46)}
.dshgn_heatCell[data-lv="3"]{background:rgba(255,255,255,.66)}
.dshgn_heatCell[data-lv="4"]{background:rgba(255,255,255,.88)}
/* 未来日期画成虚线空框：实心空框会被误读成「那天写 0 篇」 */
.dshgn_heatCell[data-future="true"]{background:transparent;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
.dshgn_list{flex:none;width:var(--dshgn-listW,260px);display:flex;flex-direction:column;min-height:0;
  border-right:0.5px solid var(--dsw-alias-border-l2)}
/* 三栏之间的拖拽手柄：常态是一条 1px 的发丝线，悬停/拖动时才亮起来。
   宽度 5px 而不是 1px——1px 的目标在触控板上几乎抓不住。 */
.dshgn_splitter{flex:none;width:5px;margin:0 -2px;cursor:col-resize;position:relative;z-index:2;
  background:transparent;border:0;padding:0}
.dshgn_splitter::after{content:"";position:absolute;top:0;bottom:0;left:2px;width:1px;
  background:var(--dsw-alias-border-l2);transition:background .12s}
.dshgn_splitter:hover::after,.dshgn_splitterOn::after{background:var(--dsw-alias-brand-primary)}
.dshgn_splitter:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
/* 窄窗口：Obsidian 的侧栏可以只有两三百像素宽，popout 窗口也能随便拉。
   视口宽度判断不了这件事——窗口很宽、侧栏很窄是常态，所以用容器查询盯
   面板根节点的**实际宽度**：左栏收成抽屉，再窄就把中栏也让出来。 */
.dshgn_treeToggle,.dshgn_noteBack{display:none}
@container dshgn (max-width:760px){
  .dshgn_treeToggle{display:inline-flex}
  .dshgn_splitter{display:none}
  /* 左栏改成浮在列表上的抽屉：宽度固定，点完目录就自己收回去 */
  .dshgn_body{position:relative}
  .dshgn_tree{position:absolute;left:0;top:0;bottom:0;z-index:20;display:none;
    width:min(240px,72%);box-shadow:0 8px 28px rgba(0,0,0,.28)}
  .dshgn_root[data-narrow-tree="true"] .dshgn_tree{display:flex}
}
@container dshgn (max-width:560px){
  /* 一篇笔记开着的时候，列表让位：两栏挤在一起谁都读不了 */
  .dshgn_noteBack{display:inline-flex}
  .dshgn_root[data-has-note="true"] .dshgn_list{display:none}
  .dshgn_head{padding:8px 10px;gap:6px}
  .dshgn_sub{display:none}
  .dshgn_tabs{overflow-x:auto;scrollbar-width:none}
  .dshgn_tabs::-webkit-scrollbar{display:none}
}
.dshgn_searchWrap{flex:none;display:flex;align-items:center;gap:6px;padding:8px 10px;
  border-bottom:0.5px solid var(--dsw-alias-border-l2)}
.dshgn_search{flex:1;min-width:0;height:26px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l2);
  border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;
  font-size:12px;outline:none}
.dshgn_search:focus{border-color:var(--dsw-alias-brand-primary)}
/* 搜索框左侧的放大镜：以前没有规则，图标会被 input 的 flex:1 挤到贴边 */
.dshgn_searchIcon{flex:none;color:var(--dsw-alias-label-tertiary);pointer-events:none}
/* 侧栏入口图标（ownerProps.size 决定尺寸，这里只保证块级对齐） */
.dshgn_sideIcon{display:block;flex:none}
.dshgn_listBody{flex:1;overflow-y:auto;padding:6px}
.dshgn_moreBtn{display:block;width:100%;margin:6px 0 2px;justify-content:center}
.dshgn_card{display:flex;flex-direction:column;gap:2px;padding:7px 8px;border-radius:8px;cursor:pointer;
  border-left:2px solid transparent;user-select:none}
.dshgn_card:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_card[data-on="true"]{background:var(--dsw-alias-interactive-bg-hover-accent);
  border-left-color:var(--dsw-alias-brand-primary)}
.dshgn_cardTitle{font-size:12px;line-height:17px;color:var(--dsw-alias-label-primary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_cardMeta{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;white-space:nowrap}
.dshgn_cardExcerpt{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_note{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
.dshgn_noteHead{flex:none;display:flex;align-items:center;gap:8px;padding:8px 14px;
  border-bottom:0.5px solid var(--dsw-alias-border-l2)}
.dshgn_notePath{flex:1;min-width:0;font-size:11px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_scroll{flex:1;overflow-y:auto;padding:16px clamp(16px,3vw,32px) 48px}
.dshgn_md{max-width:760px;margin:0 auto;color:var(--dsw-alias-label-primary);
  font-family:var(--font-text,var(--dsw-font-sans,inherit));font-size:var(--font-text-size,13px);
  line-height:var(--line-height-normal,1.75)}
.dshgn_h{font-size:1em;margin:18px 0 8px;line-height:1.4;font-weight:600;color:var(--dsw-alias-label-primary)}
/* 标题用 em 而不是 px：字号三档只改 .dshgn_md 的基准字号，标题按比例跟着放大，
   整篇层级关系不变。写死 px 的话把正文调到 15px，二级标题反而比正文还小。 */
.dshgn_h1{font-size:1.48em;margin-top:0}
.dshgn_h2{font-size:1.19em;padding-bottom:5px;border-bottom:0.5px solid var(--dsw-alias-border-l2)}
.dshgn_h3{font-size:1.05em}
.dshgn_h4,.dshgn_h5,.dshgn_h6{font-size:.96em}
.dshgn_p{margin:8px 0;white-space:normal;word-break:break-word}
.dshgn_hr{border:0;border-top:0.5px solid var(--dsw-alias-border-l2);margin:16px 0}
.dshgn_link{color:var(--dsw-alias-brand-primary);text-decoration:none}
.dshgn_link:hover{text-decoration:underline}
/* 外链按钮：外观照链接走，行为是按钮（避免自定义视图里点外链把应用导航走） */
.dshgn_linkBtn{background:none;border:0;padding:0;font:inherit;cursor:pointer;text-align:left}
.dshgn_del{text-decoration:line-through;opacity:.72}
.dshgn_mark{padding:0 2px;border-radius:3px;background:rgba(255,208,0,.34);color:inherit}
.dshgn_code{padding:1px 5px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover);
  font-family:var(--font-monospace,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:12px}
.dshgn_pre{position:relative;margin:10px 0;padding:11px 12px;border-radius:9px;overflow-x:auto;
  background:var(--dsw-alias-interactive-bg-hover);border:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_pre code{font-family:var(--font-monospace,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:12px;
  line-height:1.65;white-space:pre;color:var(--dsw-alias-label-primary)}
.dshgn_preLang{position:absolute;top:4px;right:8px;font-size:10px;color:var(--dsw-alias-label-dimmed)}
/* 逐字稿单独一套排版：它是一段段中文口语，不是代码。
   以前复用 .dshgn_pre 的等宽字体，中文全部回落到宋体/雅黑，等宽对中文毫无作用，
   加上 white-space:pre 不折行，长句在窄栏里被横向裁掉，只能拖滚动条看——这就是「字体太丑」的由来。
   现在换成正文字体栈、放大字号、放宽行距，并允许自动折行；每段之间用细分隔线，
   方便对着时间戳找位置。 */
.dshgn_transcript{margin:10px 0;padding:2px 0 2px 0;border:0;background:transparent;
  font-family:var(--dsw-font-sans,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",system-ui,-apple-system,"Segoe UI",sans-serif);
  font-size:13px;line-height:1.9;color:var(--dsw-alias-label-primary);white-space:pre-wrap;
  word-break:break-word;overflow-wrap:anywhere}
.dshgn_transcript p{margin:0;padding:5px 0;border-bottom:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_transcript p:last-child{border-bottom:0}
.dshgn_transcript .dshgn_ts{display:inline-block;min-width:56px;margin-right:8px;
  font-family:var(--dsw-font-mono,var(--font-monospace,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace));
  font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);
  user-select:none}
.dshgn_transcript .dshgn_speaker{color:var(--dsw-alias-brand-primary);font-weight:600;margin-right:6px}
/* 时间戳做成按钮：点一下跳到那句话。以前它只是个 span，用户看着时间戳
   却只能自己拖进度条去找位置。样式上仍保持「一列小字」的观感，只在悬停
   和聚焦时露出可点的线索，免得整段逐字稿变成一片蓝色按钮。 */
.dshgn_transcript .dshgn_tsBtn{background:none;border:0;padding:1px 4px;margin-left:-4px;border-radius:4px;
  font:inherit;font-family:var(--dsw-font-mono,var(--font-monospace,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace));
  font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);
  cursor:pointer;text-align:left;user-select:none}
.dshgn_transcript .dshgn_tsBtn:hover{background:var(--dsw-alias-interactive-bg-hover);
  color:var(--dsw-alias-brand-primary)}
.dshgn_transcript .dshgn_tsBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
/* 正在播放的那一句：时间戳加重、整段左侧留一道竖线，扫读时视线不会跑丢 */
.dshgn_transcript .dshgn_tsOn{color:var(--dsw-alias-brand-primary);font-weight:600}
.dshgn_transcript p.dshgn_tpOn{background:rgba(var(--dshgn-tintRgb),.06);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary);
  padding-left:8px;margin-left:-8px}
.dshgn_quote{margin:10px 0;padding:2px 0 2px 12px;border-left:2px solid var(--dsw-alias-border-l2);
  color:var(--dsw-alias-label-secondary)}
/* 脚注：正文里留一个上标，定义收在篇尾一小块里。
   定义行原样显示的话，读者会看到一串 [^1]: ... 混在正文中间。 */
.dshgn_footRef{font-size:9px;line-height:1;vertical-align:super;color:var(--dsw-alias-brand-primary);cursor:pointer;padding:0 1px}
.dshgn_footRef:hover{text-decoration:underline}
.dshgn_footnotes{margin:14px 0 0;padding-top:8px;border-top:0.5px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:4px}
.dshgn_footnote{display:flex;gap:6px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dshgn_footnoteNo{flex:0 0 auto;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dshgn_footnoteText{flex:1 1 auto;min-width:0;word-break:break-word}
/* callout：跟宿主一样「左竖线 + 淡底 + 一行标题」。类型只影响竖线与标题的颜色，
   正文一律用常规色——整块染成警告色会让人以为笔记本身出错了。 */
.dshgn_callout{margin:10px 0;padding:7px 11px;border-radius:0 8px 8px 0;
  border-left:2.5px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_callout-info{border-left-color:var(--dsw-alias-brand-primary)}
.dshgn_callout-success{border-left-color:var(--dsw-alias-state-success-primary)}
.dshgn_callout-warn{border-left-color:var(--dsw-alias-state-warn-primary)}
.dshgn_callout-error{border-left-color:var(--dsw-alias-state-error-primary)}
.dshgn_calloutHead{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;
  color:var(--dsw-alias-label-primary);line-height:17px}
.dshgn_callout-info .dshgn_calloutHead{color:var(--dsw-alias-brand-primary)}
.dshgn_callout-success .dshgn_calloutHead{color:var(--dsw-alias-state-success-primary)}
.dshgn_callout-warn .dshgn_calloutHead{color:var(--dsw-alias-state-warn-primary)}
.dshgn_callout-error .dshgn_calloutHead{color:var(--dsw-alias-state-error-primary)}
/* 可折叠时标题是按钮：去掉按钮默认样式，只留 hover 的一点底色，
   让人能看出这一行能点。 */
.dshgn_calloutFold{appearance:none;border:0;background:transparent;padding:0;margin:0;
  width:100%;font:inherit;font-size:12px;font-weight:600;text-align:left;cursor:pointer;
  border-radius:5px}
.dshgn_calloutFold:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}
.dshgn_calloutIcon{flex:none}
.dshgn_calloutTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_calloutBody{margin-top:5px;color:var(--dsw-alias-label-secondary);font-size:12.5px}
.dshgn_calloutBody .dshgn_p:first-child{margin-top:0}
.dshgn_calloutBody .dshgn_p:last-child{margin-bottom:0}
.dshgn_mdList{margin:8px 0;padding-left:22px}
.dshgn_li{margin:3px 0;line-height:1.7}
.dshgn_liCont{color:var(--dsw-alias-label-secondary)}
.dshgn_task{list-style:none;margin-left:-18px;display:flex;align-items:flex-start;gap:6px}
.dshgn_check{flex:none;width:12px;height:12px;margin-top:5px;border-radius:3px;
  border:1.5px solid var(--dsw-alias-border-l2);display:inline-block}
.dshgn_checkOn{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
/* 可点的待办方框：12px 的方块在桌面上太难点中，用透明 outline 把命中区撑到 26px，
   视觉上还是一个 12px 的框。cursor 与 hover 是唯一能告诉用户「这个能点」的信号。 */
.dshgn_checkHit{cursor:pointer;position:relative;transition:background .12s ease,border-color .12s ease}
.dshgn_checkHit:hover{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_checkHit.dshgn_checkOn:hover{background:var(--dsw-alias-button-primary-hover)}
.dshgn_checkHit::after{content:'';position:absolute;inset:-7px}
.dshgn_tableWrap{overflow-x:auto;margin:10px 0}
.dshgn_table{border-collapse:collapse;font-size:12px;min-width:100%}
.dshgn_table th,.dshgn_table td{padding:6px 10px;text-align:left;
  border-bottom:0.5px solid var(--dsw-alias-border-l2);vertical-align:top}
.dshgn_table th{color:var(--dsw-alias-label-secondary);font-weight:600;
  background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_editor{flex:1;width:100%;box-sizing:border-box;resize:none;border:0;outline:none;padding:16px clamp(16px,3vw,32px);
  background:transparent;color:var(--dsw-alias-label-primary);
  font-family:var(--font-text,var(--dsw-font-sans,inherit));font-size:var(--font-text-size,13px);
  line-height:var(--line-height-normal,1.7)}
.dshgn_editorFoot{display:flex;align-items:center;gap:10px;padding:5px clamp(16px,3vw,32px);
  border-top:0.5px solid var(--dsw-alias-border-l1);font-size:10.5px;
  color:var(--dsw-alias-label-tertiary);flex:0 0 auto}
.dshgn_editorHint{margin-left:auto;opacity:.75}
.dshgn_empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:8px;padding:32px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.dshgn_emptyTitle{font-size:13px;color:var(--dsw-alias-label-secondary)}
.dshgn_emptyDesc{font-size:12px;line-height:1.7;max-width:340px}
.dshgn_pane{flex:1;overflow-y:auto;padding:18px clamp(16px,3vw,28px) 40px}
.dshgn_cardBox{max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.dshgn_section{display:flex;flex-direction:column;gap:8px;padding:14px 15px;border-radius:10px;
  border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay)}
.dshgn_sectionTitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
/* 卡片标题行：标题 + 右侧状态徽章。以前徽章只能挂在下一行，读起来像两个独立信息。 */
.dshgn_sectionHead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px}
.dshgn_sectionDesc{font-size:11.5px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.dshgn_rowLine{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshgn_input{flex:1;min-width:180px;height:28px;padding:0 9px;border:0.5px solid var(--dsw-alias-border-l2);
  border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;
  font-size:12px;outline:none}
.dshgn_input:focus{border-color:var(--dsw-alias-brand-primary)}
/* 工具栏里的小下拉：不该像正文输入框那样抢走半行宽度 */
.dshgn_selectSm{flex:none;min-width:0;width:auto;height:24px;padding:0 6px;font-size:11.5px;cursor:pointer}
.dshgn_badge{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:10px;
  font-size:10.5px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dshgn_badgeOk{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-brand-primary)}
.dshgn_badgeWarn{background:transparent;color:var(--dsw-alias-state-warn-primary);
  box-shadow:inset 0 0 0 0.5px var(--dsw-alias-state-warn-primary)}
.dshgn_badgeErr{color:var(--dsw-alias-state-error-primary)}
.dshgn_log{max-height:220px;overflow-y:auto;padding:8px 10px;border-radius:8px;
  background:var(--dsw-alias-interactive-bg-hover);font-family:var(--font-monospace,ui-monospace,SFMono-Regular,Menlo,monospace);
  font-size:11px;line-height:1.7;color:var(--dsw-alias-label-secondary);white-space:pre-wrap}
.dshgn_error{padding:8px 10px;border-radius:8px;font-size:11.5px;line-height:1.6;
  color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_toast{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:20;
  display:flex;align-items:center;gap:6px;padding:7px 13px;border-radius:9px;
  background:var(--dsw-alias-toast-bg);color:var(--dsw-alias-toast-label);
  font-size:12px;box-shadow:0 6px 22px rgba(0,0,0,.16)}
.dshgn_rel{position:relative;height:100%;container-type:inline-size;container-name:dshgn}
.dshgn_spin{display:inline-block;width:12px;height:12px;border-radius:50%;
  border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);
  animation:dshgn-spin .8s linear infinite}
@keyframes dshgn-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.dshgn_spin{animation:none}}
.dshgn_emptyState{display:flex;align-items:center;justify-content:center;height:100%;
  color:var(--dsw-alias-label-tertiary);font-size:12px}
/* 错误边界：渲染异常时的降级界面。不做成居中空状态——用户需要一眼看出这是
   「坏了」而不是「没有内容」，所以左对齐、留白收紧、错误原文用等宽字体可选中。 */
.dshgn_boundary{display:flex;flex-direction:column;gap:10px;padding:28px 32px;
  align-items:flex-start;justify-content:flex-start;overflow:auto}
.dshgn_boundaryTitle{font-size:14px;font-weight:600;
  color:var(--dsw-alias-state-error-primary)}
.dshgn_boundaryMsg{font-size:13px;line-height:1.7;color:var(--dsw-alias-label-primary);
  word-break:break-word;max-width:100%}
.dshgn_boundaryStack{margin:0;padding:10px 12px;border-radius:8px;max-width:100%;
  overflow:auto;background:var(--dsw-alias-interactive-bg-hover);
  border:0.5px solid var(--dsw-alias-border-l1);font-size:11.5px;line-height:1.6;
  color:var(--dsw-alias-label-secondary);
  font-family:var(--font-monospace,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);white-space:pre-wrap}
/* ── 音频播放器 ── */
.dshgn_audioCard{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-radius:10px;
  border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay)}
.dshgn_audioBar{display:flex;align-items:center;gap:10px}
.dshgn_audioBtn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;
  border-radius:50%;border:0;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);
  cursor:pointer;padding:0}
.dshgn_audioBtn:hover{background:var(--dsw-alias-button-primary-hover)}
.dshgn_audioBtn:disabled{opacity:.5;cursor:default}
/* 进度条改成自绘的 div，不再用 <input type=range>。
   原因：原生 range 在这套面板里实测「怎么拖都没反应」——元素只有 4px 高时鼠标抓不住拇指；
   把高度撑到 18px 也只是提高了命中率，受控 value 还会被 timeupdate 打回原位。
   自绘之后整条 18px 都是命中区，按下就能抓，setPointerCapture 保证拖出元素也不丢事件。
   touch-action:none 是必须的：不写的话触摸/触控板手势会抢走 pointermove，
   表现同样是「拖不动」。 */
.dshgn_audioSeek{position:relative;flex:1;min-width:0;height:18px;display:flex;align-items:center;
  cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none;outline:none;
  border-radius:9px}
.dshgn_audioSeek:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary)}
.dshgn_audioTrack{position:relative;width:100%;height:4px;border-radius:2px;
  background:var(--dsw-alias-border-l2);overflow:visible}
.dshgn_audioFill{position:absolute;left:0;top:0;height:100%;border-radius:2px;
  background:var(--dsw-alias-brand-primary)}
.dshgn_audioThumb{position:absolute;top:50%;width:13px;height:13px;border-radius:50%;
  background:var(--dsw-alias-brand-primary);border:2px solid var(--dsw-alias-bg-overlay);
  box-shadow:0 1px 3px rgba(var(--dshgn-tintRgb),.28);transform:translate(-50%,-50%);pointer-events:none}
.dshgn_audioSeek:hover .dshgn_audioThumb{transform:translate(-50%,-50%) scale(1.12)}
.dshgn_audioTime{flex:none;font-size:11px;font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-tertiary)}
.dshgn_audioLabel{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
/* ── 开关 ── */
.dshgn_toggle{position:relative;flex:none;width:34px;height:19px;border-radius:10px;border:0;padding:0;
  background:var(--dsw-alias-border-l2);cursor:pointer;transition:background .15s}
.dshgn_toggle[data-on="true"]{background:var(--dsw-alias-brand-primary)}
.dshgn_toggle::after{content:"";position:absolute;top:2.5px;left:2.5px;width:14px;height:14px;
  border-radius:50%;background:Canvas;transition:transform .15s}
.dshgn_toggle[data-on="true"]::after{transform:translateX(15px)}
.dshgn_toggleRow{display:flex;align-items:center;gap:10px;justify-content:space-between}
.dshgn_toggleLabel{display:flex;flex-direction:column;gap:2px;min-width:0}
.dshgn_toggleTitle{font-size:12px;color:var(--dsw-alias-label-primary)}
.dshgn_toggleDesc{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
/* ── 表单字段 ── */
.dshgn_field{display:flex;flex-direction:column;gap:5px}
.dshgn_fieldLabel{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.dshgn_fieldHint{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
/* 自定义模板列表：模板名一行、骨架预览两行截断。预览要截断是因为骨架可能有几十行，
   整段铺开会把设置页撑得老长，而用户在这一屏只需要认出「这是哪个模板」。 */
.dshgn_sectionHint{font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary);margin-left:auto}
.dshgn_emptyRow{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:6px 0}
.dshgn_tplList{display:flex;flex-direction:column;gap:6px}
.dshgn_tplRow{display:flex;align-items:flex-start;gap:8px;padding:7px 9px;border-radius:7px;
  background:var(--dsw-alias-interactive-bg-hover);border:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_tplMain{flex:1;min-width:0}
.dshgn_tplName{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dshgn_tplBody{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary);margin-top:2px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}
.dshgn_tplForm{display:flex;flex-direction:column;gap:6px}
.dshgn_btnRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshgn_textarea{width:100%;box-sizing:border-box;min-height:180px;resize:vertical;padding:9px 10px;
  border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;
  color:var(--dsw-alias-label-primary);font-family:var(--font-monospace,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);
  font-size:12px;line-height:1.65;outline:none}
.dshgn_textarea:focus{border-color:var(--dsw-alias-brand-primary)}
.dshgn_btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 11px;border-radius:7px;
  border:0.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);
  font:inherit;font-size:12px;cursor:pointer}
.dshgn_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_btn:disabled{opacity:.5;cursor:default}
.dshgn_btnPri{border-color:transparent;background:var(--dsw-alias-button-primary-fill);
  color:var(--dsw-alias-label-primary-foreground)}
.dshgn_btnPri:hover{background:var(--dsw-alias-button-primary-hover)}
/* 淡一档的强调按钮：给「用我的本地版 / 用云端版」这种二选一用。
   满饱和的主色在这两个按钮上会抢掉比对正文的注意力——用户是来读差异的，
   不是来看按钮的。这里改用柔和的填充 + 同色系深字，选中感还在但不刺眼。 */
.dshgn_btnSoft{border-color:transparent;background:var(--dshgn-btnFillSoft);
  color:var(--dsw-alias-label-primary-foreground)}
.dshgn_btnSoft:hover:not(:disabled){background:var(--dshgn-btnHoverSoft)}
/* 冲突页的采纳按钮：未处理时用红色描边提醒「这里需要你做个决定」，
   两个按钮都红，谁都不像默认选项；选过之后红框消失、填成浅色，
   填充本身就是「我当初选了这一边」的记号。 */
.dshgn_btnWarn{border-color:var(--dsw-alias-state-error-primary);
  color:var(--dsw-alias-state-error-primary);background:transparent}
.dshgn_btnWarn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshgn_btnPale{border-color:transparent;background:var(--dshgn-btnFillPale);
  color:var(--dsw-alias-label-primary-foreground)}
.dshgn_btnPale:hover:not(:disabled){background:var(--dshgn-btnHoverPale)}
/* 已处理区的折叠标题行：整行可点，箭头跟着开合转 90°。 */
.dshgn_foldHead{display:flex;align-items:center;gap:6px;padding:8px 2px;cursor:pointer;
  border:0;background:transparent;font:inherit;font-size:12px;width:100%;text-align:left;
  color:var(--dsw-alias-label-secondary)}
.dshgn_foldHead:hover{color:var(--dsw-alias-label-primary)}
.dshgn_foldArrow{display:inline-flex;transition:transform 140ms ease}
.dshgn_foldArrow[data-open="true"]{transform:rotate(90deg)}
.dshgn_foldCount{font-size:11px;color:var(--dsw-alias-label-dimmed);
  font-variant-numeric:tabular-nums}
.dshgn_btnDanger{color:var(--dsw-alias-state-error-primary)}
/* 录音卡面板：卡片上的文件列表与危险开关。
   「导入后删原件」那一行刻意做成普通 checkbox 而不是花哨开关——它旁边写着
   「永久删除」，越朴素越好，别让人误以为是某种推荐设置。 */
.dshgn_paneInner{display:flex;flex-direction:column;gap:12px;padding:18px 20px;max-width:720px;overflow-y:auto}
.dshgn_paneDesc{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-tertiary)}
.dshgn_row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px}
.dshgn_fileList{display:flex;flex-direction:column;gap:2px;margin-top:8px;max-height:260px;overflow-y:auto}
.dshgn_fileRow{display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:5px 8px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);
  font-size:11.5px;font-variant-numeric:tabular-nums}
.dshgn_fileName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--dsw-alias-label-primary)}
.dshgn_fileMeta{flex:none;color:var(--dsw-alias-label-tertiary)}
.dshgn_checkRow{display:flex;align-items:center;gap:7px;margin-top:10px;font-size:12px;
  color:var(--dsw-alias-label-primary);cursor:pointer}
.dshgn_checkRow input{width:13px;height:13px;margin:0;cursor:pointer}
/* 胶囊/预设按钮：必须显式清掉 UA 的按钮底色与字体，
   否则在深色主题里会画成一块灰底（文字是主题色，底是浏览器默认灰）。 */
.dshgn_chip{display:inline-flex;align-items:center;gap:4px;height:21px;padding:0 9px;border-radius:11px;
  border:0.5px solid var(--dsw-alias-border-l2);background:transparent;font:inherit;
  font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.dshgn_chip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);
  color:var(--dsw-alias-label-primary)}
.dshgn_chip:disabled{opacity:.5;cursor:default}
.dshgn_chipOn{border-color:transparent;background:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-label-primary-foreground);font-weight:500}
.dshgn_chipOn:hover:not(:disabled){background:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-label-primary-foreground)}
/* 只读的标签胶囊（云端详情里的标签）：形状同 chip，但不假装可点 */
/* 语言选择行：四个胶囊横排，窄面板时自动折行（Nederlands 比中文长得多） */
.dshgn_langRow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px}
.dshgn_tagPill{display:inline-flex;align-items:center;height:21px;padding:0 9px;border-radius:11px;
  border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);
  font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
/* 标签胶囊上的「×」：只让那个叉可点，整块胶囊不响应点击——否则想点标签看详情的人
   会一不小心把标签删掉。 */
.dshgn_tagX{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;
  margin-left:5px;border:0;border-radius:50%;padding:0;cursor:pointer;font-size:11px;
  line-height:1;background:transparent;color:var(--dsw-alias-label-tertiary);font-family:inherit}
.dshgn_tagX:hover{background:var(--dsw-alias-state-error-primary);color:#fff}
/* 云端知识库筛选行：横向可滚，不换行——知识库多的账号换行后会占掉半屏。
   左内边距对齐笔记卡标题的首字：卡片是 listBody 6px + 卡片左边框 2px + 卡片内边距 8px
   = 16px，筛选行不补这个值就会比下面的标题往左凸出 16px，看起来像没对齐的悬挂缩进。 */
.dshgn_topicRow{display:flex;gap:6px;overflow-x:auto;padding:2px 10px 6px 16px;flex:none}
.dshgn_topicChip{display:inline-flex;align-items:center;height:22px;padding:0 10px;border-radius:11px;
  border:0.5px solid var(--dsw-alias-border-l2);background:transparent;font:inherit;font-size:11px;
  color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;flex:none}
.dshgn_topicChip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshgn_topicChip[data-on="true"]{border-color:transparent;background:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-label-primary-foreground);font-weight:500}
/* 图片附件：一行横向排，单张最高 200px，避免一张竖构图手机截图把整篇文章推到屏幕外。 */
.dshgn_imgRow{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.dshgn_imgOpen{cursor:zoom-in}
/* 写了尺寸的图按写的来：object-fit 保持比例，不要被缩略图那条 max-height 压扁。 */
.dshgn_imgSized{object-fit:contain}
    .dshgn_img{max-width:100%;max-height:200px;border-radius:8px;object-fit:contain;
  border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-interactive-bg-hover)}
/* Obsidian 双链：外观要像链接但不能真跳（库内跳转由 JS 处理），所以用 button 而不是 a。 */
.dshgn_wikilink{display:inline;padding:0;margin:0;border:0;background:transparent;font:inherit;
  color:var(--dsw-alias-brand-primary);cursor:pointer;text-decoration:none;
  border-bottom:0.5px solid currentColor}
.dshgn_wikilink:hover{color:var(--dsw-alias-brand-primary);border-bottom-color:transparent}
/* 嵌入的非图片附件（![[x.pdf]] 这类）：只显示成一颗文件名胶囊，点不开也不假装能点。 */
.dshgn_embed{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;
  border-radius:10px;border:0.5px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-interactive-bg-hover);font-size:11px;
  color:var(--dsw-alias-label-secondary);white-space:nowrap;vertical-align:middle}
.dshgn_embedFile{font-size:11px;color:var(--dsw-alias-label-tertiary)}
/* 嵌入的另一篇笔记：左边一道竖线把它和这一篇的正文分开，看起来像「引用了一段」。 */
.dshgn_noteEmbed{display:block;margin:8px 0;padding:6px 10px;border-left:2px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-interactive-bg-hover);border-radius:0 8px 8px 0}
.dshgn_embedHead{display:flex;align-items:center;gap:5px;margin-bottom:4px;
  color:var(--dsw-alias-label-tertiary)}
.dshgn_embedTitle{appearance:none;border:0;background:transparent;padding:0;font:inherit;
  font-size:11px;font-weight:600;color:var(--dsw-alias-brand-primary);cursor:pointer;
  max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgn_embedTitle:hover{text-decoration:underline}
.dshgn_embedBody{font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.dshgn_embedEmpty{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dshgn_noteDrop{position:relative}
.dshgn_statGrid{display:flex;flex-wrap:wrap;gap:8px}
.dshgn_stat{display:flex;flex-direction:column;gap:1px;padding:7px 11px;border-radius:8px;
  background:var(--dsw-alias-interactive-bg-hover);min-width:66px}
.dshgn_statNum{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);
  font-variant-numeric:tabular-nums}
.dshgn_statLabel{font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.dshgn_moment{display:flex;gap:10px;padding:5px 0;font-size:12px;line-height:1.65;
  border-bottom:0.5px solid var(--dsw-alias-border-l1)}
.dshgn_moment:last-child{border-bottom:0}
.dshgn_momentAt{flex:none;width:44px;font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-brand-primary);cursor:pointer;font-size:11px}
.dshgn_momentAt:hover{text-decoration:underline}
.dshgn_banner{display:flex;flex-direction:column;gap:8px;padding:14px;border-radius:10px;
  border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);text-align:center;
  align-items:center}
/* 警告型横幅：左对齐、带色边。用于「Key 被拒」这类要用户动手处理的提示，
   居中的空状态样式会让它看起来像普通说明文字而被划过去。 */
.dshgn_bannerWarn{align-items:stretch;text-align:left;
  border-left:3px solid var(--dsw-alias-state-warn-primary)}
.dshgn_bannerTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dshgn_bannerWarn .dshgn_bannerTitle{color:var(--dsw-alias-state-warn-primary)}
.dshgn_bannerDesc{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}

/* ══ 三栏配色：深蓝 → 浅蓝 → 极浅近白蓝 ══════════════════════════════════════
   做法：不改每个组件里的 token 用法，而是在各栏容器上**局部重定义** --dsw-alias-*
   变量。自定义属性沿 DOM 继承，于是这一栏里所有用 token 的字色/底色/边框色会
   自动跟着变，只有真正需要「换一种颜色」的地方才写显式规则。
   好处：以后调色只改这里一组变量，不会漏掉某个还在用旧 token 的角落。 */
.dshgn_root{
  /* 左栏（目录树）：很深的蓝 */
  --dshgn-deep:#0a2a52;
  --dshgn-deep2:#071d3b;
  /* 深蓝区一律白字：用户明确要求「所有这种深度的蓝色区域内的字体颜色都改为白色」。
     之前用 hslToHex(hue,…) 推导浅色字，换主题色时会偏成淡绿/淡粉，白字最稳。 */
  --dshgn-deepFg:#ffffff;
  --dshgn-deepFg2:rgba(255,255,255,.86);
  --dshgn-deepFg3:rgba(255,255,255,.66);
  /* 中栏（笔记列表）：浅一点的蓝 */
  --dshgn-mid:#c5daf3;
  --dshgn-mid2:#b6cfee;
  --dshgn-midFg:#102a45;
  --dshgn-midFg2:#3d5c7e;
  --dshgn-midFg3:#5d7c9d;
  /* 右栏（阅读区）：很浅很浅、接近白的蓝 */
  --dshgn-light:#f7fbff;
  --dshgn-light2:#eef6ff;
  --dshgn-lightFg:#16283c;
  --dshgn-lightFg2:#40586f;
  --dshgn-lightFg3:#6b8298;
  /* 强调色：深栏上要够亮，浅栏上要够沉 */
  --dshgn-accentOnDark:#7fb8ff;
  --dshgn-accentOnLight:#1f6fb8;
  --dshgn-lineOnDark:rgba(255,255,255,.13);
  --dshgn-lineOnLight:rgba(var(--dshgn-tintRgb),.13);
  /* 默认主题色的 RGB 分量。所有半透明描边/阴影/悬浮底色都由它推导，
     这样「自定义主题色」只需要覆盖这一个值 + 上面那批色板，
     散落在 18 处的 rgba(10,42,82,…) 会自动跟着变。 */
  --dshgn-tintRgb:10,42,82;
  --dshgn-btnFill:#2f7fd4;
  --dshgn-btnHover:#3d90e8;
  --dshgn-btnFillSoft:#7fa9d0;
  --dshgn-btnHoverSoft:#6b99c4;
  --dshgn-btnFillPale:#a8c6e4;
  --dshgn-btnHoverPale:#96badd;
  /* 卡片/弹层/输入框的实底色。浅色是纯白，深色由 themeVars 换成深灰。 */
  --dshgn-surface:#ffffff;
  --dshgn-surfaceStrong:#ffffff;
  --dshgn-overlayMask:rgba(4,12,24,.42);
}

/* ── 顶栏：与右栏同色系，压一条浅蓝分隔 ── */
.dshgn_head{
  background:linear-gradient(180deg,var(--dshgn-light) 0%,var(--dshgn-light2) 100%);
  border-bottom:1px solid var(--dshgn-lineOnLight);
  color:var(--dshgn-lightFg);
  --dsw-alias-label-primary:var(--dshgn-lightFg);
  --dsw-alias-label-secondary:var(--dshgn-lightFg2);
  --dsw-alias-label-tertiary:var(--dshgn-lightFg3);
  --dsw-alias-label-dimmed:var(--dshgn-lightFg3);
  --dsw-alias-border-l2:var(--dshgn-lineOnLight);
  --dsw-alias-interactive-bg-hover:rgba(var(--dshgn-tintRgb),.07);
  --dsw-alias-interactive-bg-hover-accent:rgba(31,111,184,.16);
  --dsw-alias-bg-overlay:var(--dshgn-surface);
  --dsw-alias-brand-primary:var(--dshgn-accentOnLight);
}
.dshgn_tabs{background:rgba(var(--dshgn-tintRgb),.07);border-radius:10px}
.dshgn_tab[data-on="true"]{background:var(--dshgn-surface);box-shadow:0 1px 3px rgba(var(--dshgn-tintRgb),.14)}

/* ── 左栏：深蓝。整栏用上深下更深的渐变，边界靠一条亮线收住 ── */
.dshgn_tree{
  width:var(--dshgn-treeW,204px);
  background:linear-gradient(180deg,var(--dshgn-deep) 0%,var(--dshgn-deep2) 100%);
  color:var(--dshgn-deepFg);
  border-right:1px solid rgba(0,0,0,.28);
  box-shadow:inset -1px 0 0 rgba(255,255,255,.06);
  scrollbar-color:rgba(255,255,255,.24) transparent;
  /* 局部把主题 token 翻成「深底浅字」，栏内一切 token 用法自动跟随 */
  --dsw-alias-label-primary:var(--dshgn-deepFg);
  --dsw-alias-label-secondary:var(--dshgn-deepFg2);
  --dsw-alias-label-tertiary:var(--dshgn-deepFg3);
  --dsw-alias-label-dimmed:var(--dshgn-deepFg3);
  --dsw-alias-label-primary-foreground:#08182c;
  --dsw-alias-border-l1:var(--dshgn-lineOnDark);
  --dsw-alias-border-l2:var(--dshgn-lineOnDark);
  --dsw-alias-interactive-bg-hover:rgba(255,255,255,.09);
  --dsw-alias-interactive-bg-hover-accent:rgba(255,255,255,.17);
  --dsw-alias-interactive-bg-active:rgba(255,255,255,.22);
  --dsw-alias-brand-primary:var(--dshgn-accentOnDark);
  --dsw-alias-button-primary-fill:var(--dshgn-btnFill);
  --dsw-alias-button-primary-hover:var(--dshgn-btnHover);
}
/* 栏内小标题（目录/标签）：加字距，像侧边栏分组 */
.dshgn_tree .dshgn_treeHead{
  margin-top:6px;padding-top:9px;border-top:1px solid rgba(255,255,255,.09);
  letter-spacing:.06em;text-transform:uppercase;font-size:10px;
}
.dshgn_tree .dshgn_treeRow[data-on="true"]{box-shadow:inset 2px 0 0 var(--dshgn-accentOnDark)}
.dshgn_tree .dshgn_treeCount{
  min-width:18px;text-align:center;padding:0 4px;border-radius:8px;
  background:rgba(255,255,255,.11);font-size:10px;line-height:15px;
}
.dshgn_tree .dshgn_tagRow{
  background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.12);
}
.dshgn_tree .dshgn_tagRow:hover{background:rgba(255,255,255,.15)}
.dshgn_tree .dshgn_tagRow[data-on="true"]{
  background:var(--dshgn-accentOnDark);border-color:transparent;color:#08182c;font-weight:600;
}
/* 标题行右侧的动作组：排序 + 「+」。
   用 flex:1 的 spacer 把动作推到最右，与标题文字之间留出距离——紧贴标题
   会让它看起来像标题的一部分，用户不会想到那是个按钮。 */
.dshgn_treeHeadRight{display:flex;align-items:center;gap:2px;flex:none;margin-left:auto}
.dshgn_treeHeadTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.dshgn_treeSort,
.dshgn_treeAdd{
  display:inline-flex;align-items:center;justify-content:center;
  height:18px;min-width:18px;padding:0 4px;border:0;border-radius:5px;
  background:transparent;color:var(--dsw-alias-label-tertiary);
  font:inherit;font-size:9px;line-height:1;cursor:pointer;
  letter-spacing:0;text-transform:none;
}
.dshgn_treeSort:hover,
.dshgn_treeAdd:hover{background:rgba(255,255,255,.14);color:var(--dsw-alias-label-primary)}
.dshgn_treeSort:focus-visible,
.dshgn_treeAdd:focus-visible{outline:1px solid var(--dshgn-accentOnDark);outline-offset:1px}
/* 新建目录 / 标签的输入行 */
.dshgn_treeNew{display:flex;align-items:center;gap:3px;padding:2px 4px 4px}
.dshgn_treeNewInput{
  flex:1;min-width:0;height:22px;padding:0 6px;border-radius:6px;
  border:0.5px solid var(--dsw-alias-border-l2);background:rgba(0,0,0,.22);
  color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;outline:none;
}
.dshgn_treeNewInput::placeholder{color:var(--dsw-alias-label-dimmed)}
.dshgn_treeNewInput:focus{border-color:var(--dshgn-accentOnDark)}
.dshgn_treeNewOk,
.dshgn_treeNewCancel{
  display:inline-flex;align-items:center;justify-content:center;flex:none;
  width:20px;height:22px;border:0;border-radius:6px;background:transparent;
  color:var(--dsw-alias-label-tertiary);cursor:pointer;
}
.dshgn_treeNewOk:hover{background:rgba(255,255,255,.16);color:var(--dsw-alias-label-primary)}
.dshgn_treeNewCancel:hover{background:rgba(255,255,255,.16);color:var(--dsw-alias-state-error-primary)}
/* 行内删除/取消：画在被右键的那一行里接替计数徽章的位置。
   不再用 position:fixed 的浮层——.dshgn_body 挂着 animation ... both，
   动画播完后 transform 仍留着，带 transform 的祖先会成为 fixed 的包含块，
   菜单的坐标基准从视口变成 .dshgn_body 的左上角，于是飘到很远的地方。 */
.dshgn_rowMenu{display:inline-flex;align-items:center;gap:2px;flex:none}
.dshgn_rowBtn{
  display:inline-flex;align-items:center;gap:3px;height:18px;padding:0 5px;
  border:0;border-radius:5px;background:transparent;font:inherit;font-size:10px;
  line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer;
}
.dshgn_rowBtn:hover{background:rgba(255,255,255,.18);color:var(--dsw-alias-label-primary)}
.dshgn_rowBtnDanger{color:var(--dsw-alias-state-error-primary)}
.dshgn_rowBtnDanger:hover{background:rgba(255,255,255,.18);color:var(--dsw-alias-state-error-primary)}
/* 标签项外层：给行内菜单留位置，同时避免 button 套 button */
.dshgn_tagWrap{display:inline-flex;align-items:center;gap:2px;max-width:100%;min-width:0}
/* 标签区是 flex-wrap 容器，改名输入行必须自己占满一整行，
   否则它会挤在上一个标签右边，输入框被压成几十像素宽。 */
.dshgn_treeTags .dshgn_treeNew{width:100%;margin:0 0 4px;box-sizing:border-box}
/* 二次确认弹窗：遮住整个面板，避免用户误点背后的东西 */
.dshgn_modalMask{
  position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;
  padding:24px;background:var(--dshgn-overlayMask);
}
.dshgn_modal{
  width:100%;max-width:320px;padding:16px 18px;border-radius:12px;
  border:0.5px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-overlay);box-shadow:var(--dsw-alias-elevation-prominent);
  display:flex;flex-direction:column;gap:10px;
}
.dshgn_modalTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dshgn_modalBody{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary);word-break:break-word}
.dshgn_modalActions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}

/* ── 中栏：浅蓝。留一条稍深的右边线把它和阅读区区分开 ── */
.dshgn_list{
  width:272px;
  background:linear-gradient(180deg,var(--dshgn-mid) 0%,var(--dshgn-mid2) 100%);
  color:var(--dshgn-midFg);
  border-right:1px solid rgba(var(--dshgn-tintRgb),.16);
  scrollbar-color:rgba(var(--dshgn-tintRgb),.26) transparent;
  --dsw-alias-label-primary:var(--dshgn-midFg);
  --dsw-alias-label-secondary:var(--dshgn-midFg2);
  --dsw-alias-label-tertiary:var(--dshgn-midFg3);
  --dsw-alias-label-dimmed:var(--dshgn-midFg3);
  --dsw-alias-label-primary-foreground:#ffffff;
  --dsw-alias-border-l1:var(--dshgn-lineOnLight);
  --dsw-alias-border-l2:var(--dshgn-lineOnLight);
  --dsw-alias-interactive-bg-hover:rgba(var(--dshgn-tintRgb),.09);
  --dsw-alias-interactive-bg-hover-accent:rgba(var(--dshgn-tintRgb),.16);
  --dsw-alias-bg-overlay:var(--dshgn-surface);
  --dsw-alias-brand-primary:var(--dshgn-accentOnLight);
  --dsw-alias-button-primary-fill:var(--dshgn-btnFill);
  --dsw-alias-button-primary-hover:var(--dshgn-btnHover);
}
.dshgn_list .dshgn_searchWrap{border-bottom-color:rgba(var(--dshgn-tintRgb),.14)}
.dshgn_list .dshgn_search{
  background:var(--dshgn-surfaceStrong);border-color:rgba(var(--dshgn-tintRgb),.16);
}
.dshgn_list .dshgn_search::placeholder{color:var(--dshgn-midFg3)}
.dshgn_list .dshgn_card{border-radius:9px;margin-bottom:2px}
.dshgn_list .dshgn_card[data-on="true"]{
  background:var(--dshgn-surface);box-shadow:0 1px 4px rgba(var(--dshgn-tintRgb),.14);
  border-left-color:var(--dshgn-accentOnLight);
}
.dshgn_list .dshgn_cardTitle{font-weight:500}

/* ── 右栏：极浅近白蓝 ── */
.dshgn_note{
  background:var(--dshgn-light);
  color:var(--dshgn-lightFg);
  --dsw-alias-label-primary:var(--dshgn-lightFg);
  --dsw-alias-label-secondary:var(--dshgn-lightFg2);
  --dsw-alias-label-tertiary:var(--dshgn-lightFg3);
  --dsw-alias-label-dimmed:var(--dshgn-lightFg3);
  /* 同 .dshgn_pane：播放按钮、主按钮这类深蓝填充上的字必须是白的。 */
  --dsw-alias-label-primary-foreground:#ffffff;
  --dsw-alias-border-l1:var(--dshgn-lineOnLight);
  --dsw-alias-border-l2:var(--dshgn-lineOnLight);
  --dsw-alias-interactive-bg-hover:rgba(var(--dshgn-tintRgb),.055);
  --dsw-alias-interactive-bg-hover-accent:rgba(var(--dshgn-tintRgb),.14);
  --dsw-alias-bg-overlay:var(--dshgn-surface);
  --dsw-alias-brand-primary:var(--dshgn-accentOnLight);
  --dsw-alias-button-primary-fill:var(--dshgn-btnFill);
  --dsw-alias-button-primary-hover:var(--dshgn-btnHover);
  scrollbar-color:rgba(var(--dshgn-tintRgb),.22) transparent;
}
.dshgn_note .dshgn_noteHead{background:var(--dshgn-light2)}
.dshgn_note .dshgn_md{font-size:13.5px;line-height:1.8}
.dshgn_note .dshgn_md .dshgn_pre{background:rgba(var(--dshgn-tintRgb),.08)}
.dshgn_note .dshgn_md .dshgn_table th{background:rgba(var(--dshgn-tintRgb),.10)}
.dshgn_note .dshgn_md .dshgn_h2{border-bottom-color:rgba(var(--dshgn-tintRgb),.14)}

/* ── 其它页签（云端/同步/设置）：整页用极浅蓝，卡片纯白 ── */
.dshgn_pane{
  background:linear-gradient(180deg,var(--dshgn-light) 0%,var(--dshgn-light2) 100%);
  color:var(--dshgn-lightFg);
  --dsw-alias-label-primary:var(--dshgn-lightFg);
  --dsw-alias-label-secondary:var(--dshgn-lightFg2);
  --dsw-alias-label-tertiary:var(--dshgn-lightFg3);
  --dsw-alias-label-dimmed:var(--dshgn-lightFg3);
  /* 深蓝填充上的字一律白：主按钮、选中的 chip、选中的知识库都是深色底，
     没这一行它们就落到应用默认的深色前景色上——白底页面里看着还凑合，
     一旦按钮被填成深蓝就变成「深字压深底」，几乎读不出来。 */
  --dsw-alias-label-primary-foreground:#ffffff;
  --dsw-alias-border-l1:var(--dshgn-lineOnLight);
  --dsw-alias-border-l2:var(--dshgn-lineOnLight);
  --dsw-alias-interactive-bg-hover:rgba(var(--dshgn-tintRgb),.055);
  --dsw-alias-interactive-bg-hover-accent:rgba(var(--dshgn-tintRgb),.14);
  --dsw-alias-bg-overlay:var(--dshgn-surface);
  --dsw-alias-brand-primary:var(--dshgn-accentOnLight);
  --dsw-alias-button-primary-fill:var(--dshgn-btnFill);
  --dsw-alias-button-primary-hover:var(--dshgn-btnHover);
}
.dshgn_pane .dshgn_section{box-shadow:0 1px 2px rgba(var(--dshgn-tintRgb),.06)}
.dshgn_pane .dshgn_input,.dshgn_pane .dshgn_textarea{background:var(--dshgn-surface)}
.dshgn_pane .dshgn_log{background:rgba(var(--dshgn-tintRgb),.06)}
.dshgn_pane .dshgn_stat{background:rgba(var(--dshgn-tintRgb),.08)}
.dshgn_root{background:var(--dshgn-light)}

/* 深色栏里的滚动条（WebKit 不认 scrollbar-color） */
.dshgn_tree::-webkit-scrollbar,.dshgn_list::-webkit-scrollbar,
.dshgn_note .dshgn_scroll::-webkit-scrollbar,.dshgn_pane::-webkit-scrollbar{width:9px;height:9px}
.dshgn_tree::-webkit-scrollbar-thumb{background:rgba(255,255,255,.22);border-radius:5px}
.dshgn_list::-webkit-scrollbar-thumb{background:rgba(var(--dshgn-tintRgb),.24);border-radius:5px}
.dshgn_note .dshgn_scroll::-webkit-scrollbar-thumb,
.dshgn_pane::-webkit-scrollbar-thumb{background:rgba(var(--dshgn-tintRgb),.18);border-radius:5px}
.dshgn_tree::-webkit-scrollbar-track,.dshgn_list::-webkit-scrollbar-track,
.dshgn_note .dshgn_scroll::-webkit-scrollbar-track,.dshgn_pane::-webkit-scrollbar-track{background:transparent}
`

    /** 往一个 document 里注一份样式表（已经注过就跳过）。 */
    function injectCssInto(doc) {
      if (!doc || doc.getElementById(STYLE_ID) !== null) return
      const style = doc.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      ;(doc.head || doc.documentElement).appendChild(style)
    }
    function injectCss() {
      for (const doc of panelDocuments()) injectCssInto(doc)
      return () => {}
    }
    // 事件监听与主题同步都是「挂在每个面板窗口上」的，但窗口可能比监听
    // 建立得晚（先开面板、再「在新窗口中打开」）。所以登记一批「窗口变了
    // 就补一遍」的回调，新根节点出现时重放。
    const pendingAttach = new Set()
    const pendingSync = new Set()
    function attachOnPanelWindows(type, fn, capture) {
      const done = new Set()
      const apply = () => {
        for (const win of panelWindows()) {
          if (done.has(win)) continue
          done.add(win)
          win.addEventListener(type, fn, capture)
        }
      }
      apply()
      pendingAttach.add(apply)
      return () => {
        pendingAttach.delete(apply)
        for (const win of done) win.removeEventListener(type, fn, capture)
        done.clear()
      }
    }
    /**
     * 面板根节点挂上来时调一次：记进根节点集合，给**它所在的** document
     * 补一份样式，并让之前登记的监听/主题同步补到新窗口上。
     *
     * popout 窗口有自己的 document，样式得各注一份，否则新窗口里的面板
     * 是一堆没有样式的裸元素。
     */
    function registerPanelRoot(el) {
      if (!el) return
      panelRoots.add(el)
      injectCssInto(el.ownerDocument)
      for (const apply of Array.from(pendingAttach)) apply()
      for (const sync of Array.from(pendingSync)) sync()
    }

    // ── 侧栏入口 ──────────────────────────────────────────────────────────────

    /** 侧栏按钮图标。尺寸与激活态由 sidebar.panellist 的 ownerProps 给。 */
    function PanelIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 18
      const active = props && props.active === true
      return h(Icon, { name: 'brain', size, className: active ? 'dshgn_sideIcon dshgn_sideIconOn' : 'dshgn_sideIcon' })
    }

    // ── 面板 ──────────────────────────────────────────────────────────────────

    function GetnotePage() {
      // 面板语言。null = 跟随宿主；用户在设置里选过就是 'zh' | 'en' | 'nl'。
      // 初值取模块级 uiLocale（上次面板渲染时用的），status 回来后以 host 存的为准。
      const [locale, setLocale] = React.useState(() => activeUiLocale())
      // 这里在渲染期写一次模块变量：t() 是模块级闭包，只有先把 uiLocale 定下来，
      // 下面 useMemo 里创建出来的 t 才会查对字典。纯赋值、无副作用，重复渲染结果一致。
      setUiLocale(locale)
      // t 缓存的是「取文案的函数」，locale 一变就换一个新的，整棵子树的文案才跟着变
      const t = React.useMemo(() => makeT(), [locale])
      // 上次停在哪儿（页签 / 目录 / 标签 / 开着的那篇），见 readSession 的说明。
      // 只在首帧读一次，之后由下面两个 effect 负责写回。
      const [bootSession] = React.useState(() => readSession())
      const [tab, setTab] = React.useState(bootSession.tab === '' ? 'notes' : bootSession.tab)
      const [status, setStatus] = React.useState(null)
      const [tree, setTree] = React.useState(null)
      const [entries, setEntries] = React.useState([])
      const [dirs, setDirs] = React.useState([])
      const [query, setQuery] = React.useState('')
      const [activeDir, setActiveDir] = React.useState(bootSession.dir)
      const [activeTag, setActiveTag] = React.useState(bootSession.tag)
      // 左栏排序：time（按修改时间）/ name（按名称）/ count（按条数）。
      // 存 localStorage 而不是 host 设置：这是纯展示偏好，不涉及数据，
      // 也没必要为它多一个接口；隐私模式下 localStorage 抛错就回落默认值。
      //
      // 目录和标签各存各的：它们数量级不同、用法也不同——目录通常十来个、
      // 按名称找；标签往往几十个、按条数看热点。共用一个开关的话，
      // 调标签的顺序会把目录的顺序一起改掉，用户得来回切。
      const makeSortPref = (key) => {
        const read = () => {
          try {
            const saved = window.localStorage.getItem(key)
            if (saved === 'name' || saved === 'count' || saved === 'time') return saved
          } catch {
            // 隐私模式 / 存储被禁用：用默认值
          }
          return 'time'
        }
        const write = (next) => {
          try {
            window.localStorage.setItem(key, next)
          } catch {
            // 隐私模式下存不了，下次打开回落默认值，不影响本次使用
          }
        }
        return { read, write }
      }
      const [dirSort, setDirSort] = React.useState(() => makeSortPref('dshgn.sortDir').read())
      const [tagSort, setTagSort] = React.useState(() => makeSortPref('dshgn.sortTag').read())
      // 三栏宽度。拖动过程中只改内存状态（每帧都写 localStorage 会卡），
      // 松手后由下面那个 effect 落盘。
      const [colWidths, setColWidths] = React.useState(() => readColWidths())
      // 窄窗口下左栏变成抽屉，这是它的开关。宽窗口里这个按钮由 CSS 藏起来，
      // 状态留着也无害（抽屉样式只在容器查询命中时才生效）。
      const [treeOpen, setTreeOpen] = React.useState(false)
      // 列表一次渲染多少条。库大了以后把几千个卡片全塞进 DOM，滚动会明显发涩，
      // 所以先渲染一屏多一点，滚到底再续。搜索、切目录、切标签都会重置回初始值。
      const [listLimit, setListLimit] = React.useState(LIST_PAGE_SIZE)
      const [current, setCurrent] = React.useState(null)
      // 在飞的 /read 请求序号，见 openNote 里的说明
      const openSeq = React.useRef(0)
      // 面板自己刚存过的那一篇。宿主写盘之后会发 modify，那次不是「别处改了」，
      // 重读只会白跑一趟还把滚动位置顶掉，所以记下来放行一次。
      const selfSavedRef = React.useRef(null)
      const [draft, setDraft] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [toast, setToast] = React.useState(null)
      const [error, setError] = React.useState(null)
      // 从 `[[笔记#小节]]` 跳进来的那一节。正文是异步读回来的，设锚点的
      // 时候 DOM 里还一个标题都没有，所以先记下来，等 NotePane 渲染完再滚。
      // 带 seq 是为了「点同一节两次」也能再滚一次——只存文字的话状态没变化，
      // effect 不会重跑，用户会觉得第二次点没反应。
      const [pendingAnchor, setPendingAnchor] = React.useState(null)
      const anchorSeq = React.useRef(0)
      // 刷新按钮的反馈状态：idle → running（转三圈）→ ok/fail（变色）→ 5 秒后 idle
      const [refreshState, setRefreshState] = React.useState('idle')
      const refreshTimer = React.useRef(null)
      const refreshSpinTimer = React.useRef(null)
      const refreshOutcome = React.useRef(null)
      // 动画时长要和 CSS 里的 @keyframes 一致：改一边必须改另一边，
      // 否则要么动画播到一半被换色，要么转完了还空等一段。
      const SPIN_MS = 1400
      // 选色器里的草稿值。放在 GetnotePage 而不是 ThemeCard 里面，因为主题变量
      // 是挂在面板根节点上的——草稿若只存在卡片内部，用户拖色轮时整面板不动，
      // 只有点「应用」保存后才会变，那就不叫预览了。
      const [themePreview, setThemePreview] = React.useState(null)
      // 宿主的明暗主题会随用户切换（设置里改、或者按日出日落自动切），而 Obsidian
      // 只改 `<body>` 上的类名，不通知视图。盯这个类名，切换后立刻重算配色，
      // 否则面板会一直停在打开那一刻的配色上。
      const [darkTheme, setDarkTheme] = React.useState(() => isDarkTheme())
      React.useEffect(() => {
        // 有的环境（测试里的 jsdom）把 MutationObserver 挂在 window 上而不是全局，
        // 两处都找一遍。
        const Observer =
          typeof MutationObserver !== 'undefined'
            ? MutationObserver
            : typeof window !== 'undefined'
              ? window.MutationObserver
              : undefined
        if (typeof Observer !== 'function') return undefined
        const sync = () => setDarkTheme(isDarkTheme())
        const observer = new Observer(sync)
        // popout 窗口是另一个 document，各盯一份；窗口是后开的，所以
        // 「盯上它」这一步要能在新根节点出现时重放。
        const observed = new Set()
        const attach = () => {
          for (const doc of panelDocuments()) {
            if (!doc || !doc.body || observed.has(doc.body)) continue
            observed.add(doc.body)
            observer.observe(doc.body, { attributes: true, attributeFilter: ['class'] })
          }
          sync()
        }
        attach()
        pendingSync.add(attach)
        // 宿主发 'css-change' 时（改主题、改字体字号、改界面缩放）也重算一次。
        // 光盯 body 的 class 会漏掉「同一套深浅、但换了主题片段」的情况。
        const unsubscribe = subscribeCssChange(sync)
        return () => {
          pendingSync.delete(attach)
          observer.disconnect()
          unsubscribe()
        }
      }, [])

      // 把库的大小与当前打开的笔记报给宿主（状态栏用它写文案）。
      // 用 entries.length 而不是再打一次接口：这个数面板本来就有。
      React.useEffect(() => {
        reportStatus({
          count: Array.isArray(entries) ? entries.length : 0,
          note: current !== null ? String(current.title || current.path || '') : '',
        })
      }, [entries, current])

      // 新建模板菜单的开关。点「+」不再直接建空笔记，而是先让用户选一类——
      // 日记/读书/会议/随手记的日期与结构都是固定的，每次手写是重复劳动。
      const [templatesOpen, setTemplatesOpen] = React.useState(false)

      const showToast = React.useCallback((text) => {
        setToast(text)
        window.setTimeout(() => setToast(null), 2400)
      }, [])

      const refresh = React.useCallback(async () => {
        setError(null)
        // 刷新本身只要几十毫秒，用户点完看不出任何变化，会以为按钮坏了。
        //
        // 反馈分两段，且**转圈和结果分开计时**：以前是把动画绑在「正在请求」这个
        // 状态上，请求一返回动画就被拆掉——5 圈还没转到第一圈的一半，用户看到的
        // 就是「按钮根本不转」。现在先进入 spinning 播完整段动画，动画结束才
        // 换成绿/红，绿/红保持 5 秒后回中性灰。
        setRefreshState('spinning')
        if (refreshTimer.current !== null) {
          window.clearTimeout(refreshTimer.current)
          refreshTimer.current = null
        }
        if (refreshSpinTimer.current !== null) {
          window.clearTimeout(refreshSpinTimer.current)
          refreshSpinTimer.current = null
        }
        refreshOutcome.current = null
        try {
          const [statusJson, treeJson] = await Promise.all([api('/status'), api('/tree')])
          setStatus(statusJson)
          // host 是语言的唯一真相：多开窗口/换机器时以它为准。
          // 不写成 setLocale(statusJson.uiLocale || null) 是为了保留「自动」——
          // 非法值 normalizeLocale 已归成 null，这里直接透传即可。
          if ('uiLocale' in statusJson) setLocale(statusJson.uiLocale || null)
          setTree(treeJson.tree || null)
          setEntries(Array.isArray(treeJson.entries) ? treeJson.entries : [])
          setDirs(Array.isArray(treeJson.dirs) ? treeJson.dirs : [])
          refreshOutcome.current = 'ok'
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
          refreshOutcome.current = 'fail'
        } finally {
          // 等动画播完再揭晓结果：转圈途中就变绿，等于告诉用户「还没转完就已经好了」，
          // 反而让人怀疑结果是不是上一步的。
          refreshSpinTimer.current = window.setTimeout(() => {
            refreshSpinTimer.current = null
            const outcome = refreshOutcome.current === 'fail' ? 'fail' : 'ok'
            setRefreshState(outcome)
            refreshTimer.current = window.setTimeout(() => {
              setRefreshState('idle')
              refreshTimer.current = null
            }, 5000)
          }, SPIN_MS)
        }
      }, [])

      React.useEffect(() => {
        void refresh()
      }, [refresh])


      // 心跳：告诉 host「面板还开着」。host 侧「仅前台运行」靠它判断要不要
      // 跑自动同步——没有心跳，host 永远认为面板不可见，同步就永远不会触发。
      // 20 秒一次，与 host 的 PANEL_VISIBLE_MS（3 分钟）配合，容忍切走再回来。
      // 失败静默：心跳失败只说明这一刻后端忙，不该弹错误打扰用户。
      React.useEffect(() => {
        let alive = true
        const ping = () => {
          void api('/sync/auto', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ping: true }),
          }).catch(() => {})
        }
        ping()
        const timer = window.setInterval(() => {
          if (alive) ping()
        }, 20000)
        return () => {
          alive = false
          window.clearInterval(timer)
        }
      }, [])

      // 标签云：按出现频次排序，取前 24 个（全量的标签墙反而找不到想要的那个）
      const tagCounts = React.useMemo(() => {
        const counts = new Map()
        for (const entry of entries) {
          for (const tag of entry.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1)
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24)
      }, [entries])

      const visible = React.useMemo(() => {
        const needle = query.trim().toLowerCase()
        return entries.filter((entry) => {
          if (activeDir !== '') {
            if (entry.dir !== activeDir && !entry.path.startsWith(`${activeDir}/`)) return false
          }
          if (activeTag !== '' && !(entry.tags || []).includes(activeTag)) return false
          if (needle === '') return true
          return (
            entry.title.toLowerCase().includes(needle) ||
            entry.path.toLowerCase().includes(needle) ||
            (entry.excerpt || '').toLowerCase().includes(needle) ||
            (entry.tags || []).some((tag) => tag.toLowerCase().includes(needle))
          )
        })
      }, [entries, query, activeDir, activeTag])

      // 全文搜索：上面的 visible 只看标题/路径/摘要，正文里提到关键词的那篇
      // 搜不出来。这里在用户停止输入后打一次 /search 补上正文命中，并带上
      // tag:/dir: 限定与命中次数——正文提到 20 次的那篇显然比标题蹭到一次的
      // 更该排前面。
      const [hits, setHits] = React.useState(null)
      const [searching, setSearching] = React.useState(false)
      React.useEffect(() => {
        const raw = query.trim()
        if (raw === '') {
          setHits(null)
          setSearching(false)
          return undefined
        }
        setSearching(true)
        let alive = true
        const timer = window.setTimeout(() => {
          void api(`/search?q=${encodeURIComponent(raw)}&limit=40`)
            .then((json) => {
              if (!alive) return
              setHits(Array.isArray(json.hits) ? json.hits : [])
              setSearching(false)
            })
            .catch(() => {
              if (alive) {
                setHits(null)
                setSearching(false)
              }
            })
        }, 220)
        return () => {
          alive = false
          window.clearTimeout(timer)
        }
      }, [query])

      // 搜索命中优先用 /search 的结果：它包含正文命中，且已经按相关度排过序。
      // 只有在 /search 还没回来（或失败）时才退回本地过滤，避免输入时列表闪空。
      const searchMode = query.trim() !== '' && hits !== null
      const shown = searchMode ? hits : visible
      // 只渲染前 listLimit 条。切查询/目录/标签时回到初始窗口，否则在新目录里
      // 还留着一个巨大的窗口，等于没省。
      //
      // 这里在渲染期直接比较「上一次的筛选条件」而不是用 useEffect：effect 是
      // 异步排队的，用户刚点完目录立刻点「显示更多」时，effect 可能后到，把刚
      // 加大的窗口又按回初始值，点了没反应。渲染期比较是同步的，顺序永远正确。
      const filterKey = `${query}\u0000${activeDir}\u0000${activeTag}`
      const [lastFilterKey, setLastFilterKey] = React.useState(filterKey)
      if (lastFilterKey !== filterKey) {
        setLastFilterKey(filterKey)
        setListLimit(LIST_PAGE_SIZE)
      }
      const shownSlice = shown.length > listLimit ? shown.slice(0, listLimit) : shown
      // 滚到底附近就续一屏。用 scrollTop 而不是 IntersectionObserver：
      // 面板可能被放在 popout 窗口里，观察器在隐藏容器中拿不到交叉信息。
      const onListScroll = React.useCallback(
        (event) => {
          const el = event && event.currentTarget
          if (!el) return
          if (el.scrollTop + el.clientHeight < el.scrollHeight - 120) return
          setListLimit((prev) => (prev >= shown.length ? prev : prev + LIST_PAGE_SIZE))
        },
        [shown.length],
      )

      /**
       * 打开笔记。
       *
       * toggle=true 时，点开的那一条再点一次就收起（右栏回到空态）——用户要的是
       * 「再点一下它又缩回去」，而不是「必须去别处点一下才能关掉」。
       * 其它调用方（新建后自动打开、保存后重载、双链跳转）都传 false：
       * 那些场景点一下本来就该是「打开」，折起来反而是 bug。
       *
       * reload=true 是「库里那篇被别处改了，把正文重读一遍」。此时即使它就是
       * 当前打开的那一篇也要重读——toggle 那套「再点一下收起」在这里是反的。
       */
      const openNote = React.useCallback(
        async (path, toggle = false, reload = false) => {
          // 序号闸门：打开一篇要等 /read 回来，这中间用户可能已经关掉笔记
          // 或者点了另一篇。晚到的那份响应不能把界面按回旧状态——否则点
          // 「返回列表」之后旧笔记会自己又冒出来。
          const seq = openSeq.current + 1
          openSeq.current = seq
          if (!reload && toggle && current !== null && current.path === path) {
            setCurrent(null)
            setDraft(null)
            setError(null)
            return
          }
          setError(null)
          try {
            const note = await api(`/read?path=${encodeURIComponent(path)}`)
            if (openSeq.current !== seq) return
            setCurrent(note)
            setDraft(note.content)
          } catch (err) {
            if (openSeq.current !== seq) return
            setCurrent(null)
            setDraft(null)
            setError(err && err.message ? err.message : String(err))
          }
        },
        [current],
      )

      // 宿主的 vault 事件：用户在 Obsidian 编辑器里改了这篇（或删了、改名了），
      // 面板不能还端着旧正文。以前只有重新点一次才会重读，开着的那一篇等于
      // 一直停在过去。整库扫描缓存那边由 main.js 负责失效，这里只管当前这篇。
      //
      // 这里**不订阅 draft/current**（用 ref 读当下的值）：宿主在磁盘上写一次
      // 常常连着发好几个事件（写临时文件、rename、chmod 都会），如果每次重读都
      // 让 effect 重建，新订阅可能赶不上同一批事件里后面的那几个；更要命的是
      // 订阅重建期间到的事件直接丢了，正文就永远停在旧的一版。
      const liveRef = React.useRef({ current: null, draft: null })
      liveRef.current = { current, draft }
      // 宿主写一次盘常常连着发好几个事件（先写临时文件再 rename 之类）。
      // 同一篇在一秒内只重读一次，否则一串事件会把 /read 打成连发。
      const reloadRef = React.useRef({ path: '', at: 0 })
      React.useEffect(() => {
        return subscribeVaultChange((change) => {
          if (change === null || typeof change !== 'object') return
          const path = String(change.path || '')
          if (path === '') return
          const live = liveRef.current
          const open = live.current
          if (open === null || open.path !== path) return
          // 删掉或改走了：不能再端着一篇已经不存在的笔记
          if (change.kind === 'delete' || change.kind === 'rename') {
            openSeq.current += 1
            setCurrent(null)
            setDraft(null)
            setError(null)
            return
          }
          // 面板自己刚存完的那一下，宿主也会发一个 modify。这时磁盘上的正文就是
          // 我们写的那份，重读纯属白跑一趟（还会把光标/滚动位置顶掉）。
          // 只认「保存之后紧接着来的第一个 modify」：用户在宿主编辑器里改了同一篇
          // 再存，我们这边会先收到 modify，正常重读。
          const saved = selfSavedRef.current
          if (saved !== null && saved.path === path) {
            selfSavedRef.current = null
            return
          }
          // 还有没保存的改动就不覆盖：用户正在改，别把草稿冲掉
          if (live.draft !== null && live.draft !== open.content) return
          const now = Date.now()
          const last = reloadRef.current
          if (last.path === path && now - last.at < 1000) return
          reloadRef.current = { path, at: now }
          void openNote(path, false, true)
        })
      }, [openNote])

      // 恢复上次开着的那一篇。等列表回来再开：笔记可能已经被删掉或改了名，
      // 直接 /read 会 404 弹一条没头没尾的错；先确认它还在列表里。
      const restoredRef = React.useRef(false)
      React.useEffect(() => {
        if (restoredRef.current) return
        if (bootSession.path === '') {
          restoredRef.current = true
          return
        }
        if (!Array.isArray(entries) || entries.length === 0) return
        restoredRef.current = true
        const hit = entries.find((entry) => entry.path === bootSession.path)
        if (hit !== undefined) void openNote(hit.path)
      }, [bootSession.path, entries, openNote])

      // 位置变了就记下来。只记路径不记正文：正文可能已经被别处改过
      // （同步、宿主编辑器、另一个窗口），恢复时重新读一遍才是当下真实的内容。
      React.useEffect(() => {
        writeSession({ tab, dir: activeDir, tag: activeTag })
      }, [tab, activeDir, activeTag])
      React.useEffect(() => {
        // 还没恢复完就写会把上次的位置冲掉，所以等那一篇恢复过（或确认没有）再写
        if (!restoredRef.current) return
        writeSession({ path: current !== null ? String(current.path || '') : '' })
      }, [current])

      /**
       * 记下「打开这一篇之后滚到哪一节」。
       *
       * 连目标路径一起记：正文是异步读回来的，记下锚点的这一刻 DOM 里还是上一篇
       * 的标题，拿它去比对只会得出「这一节不存在」。带上路径之后，等那一篇真的
       * 渲染出来再滚。
       */
      const requestAnchor = React.useCallback((text, path, kind) => {
        const clean = String(text || '').trim()
        if (clean === '') return
        anchorSeq.current += 1
        setPendingAnchor({
          text: clean,
          path: String(path || ''),
          // 'heading' 是「跳到某一节」，'line' 是「跳到正文里写着这行字的地方」。
          // 搜索卡片上的命中行走后者：那一行往往是普通段落，不是标题。
          kind: kind === 'line' ? 'line' : kind === 'block' ? 'block' : 'heading',
          seq: anchorSeq.current,
        })
      }, [])

      /**
       * 打开 Obsidian 双链的目标。
       *
       * 双链写法有三种：`[[完整/路径/笔记]]`、`[[笔记标题]]`、`[[标题|显示文字]]`。
       * 前两种要分开处理——只写标题时库里可能有同名文件在任意目录，所以按
       * 「路径完全相等 → 文件名（去扩展名）相等 → 标题相等」三级退让找。
       * 都找不到就明确提示，而不是静默什么都不做（那样用户以为点击没反应）。
       */
      const openWikiLink = React.useCallback(
        (target, anchor) => {
          const raw = String(target || '').trim()
          const section = typeof anchor === 'string' ? anchor.trim() : ''
          // # 后面是 ^id 时那是块引用，不是小节名：找块，别去找标题。
          const anchorKind = isBlockAnchor(section) ? 'block' : 'heading'
          // `[[#小节]]`：链接的就是当前这一篇里的某个小节，没有别的笔记要打开。
          if (raw === '') {
            if (section !== '') requestAnchor(section, current !== null ? current.path : '', anchorKind)
            return
          }
          // 先问宿主的索引：别名、同名取最近、路径前缀这些规则都在它那儿，
          // 我们自己在 entries 里找容易指到另一篇同名笔记上去。
          const sub = status !== null && typeof status.subfolder === 'string' ? status.subfolder.replace(/^\/+|\/+$/g, '') : ''
          const rel = current !== null && typeof current.path === 'string' ? current.path : ''
          const sourceRel = rel === '' ? sub : sub === '' ? rel : `${sub}/${rel}`
          const hosted = resolveViaHost(raw, sourceRel)
          if (hosted !== '') {
            if (section !== '') requestAnchor(section, hosted, anchorKind)
            void openNote(hosted)
            return
          }
          const wanted = raw.replace(/\.md$/i, '')
          const list = entries || []
          const direct = list.find((entry) => entry.path === raw || entry.path === `${wanted}.md`)
          if (direct !== undefined) {
            if (section !== '') requestAnchor(section, direct.path, anchorKind)
            void openNote(direct.path)
            return
          }
          const byName = list.find((entry) => {
            const name = entry.path.split('/').pop().replace(/\.md$/i, '')
            return name === wanted
          })
          if (byName !== undefined) {
            if (section !== '') requestAnchor(section, byName.path, anchorKind)
            void openNote(byName.path)
            return
          }
          const lowered = wanted.toLowerCase()
          const byTitle = list.find((entry) => String(entry.title || '').toLowerCase() === lowered)
          if (byTitle !== undefined) {
            if (section !== '') requestAnchor(section, byTitle.path, anchorKind)
            void openNote(byTitle.path)
            return
          }
          // 别名：`aliases: [读书笔记]` 之后 [[读书笔记]] 也该指到这一篇。
          // 放在最后一级——别名是「我自己起的另一个名字」，撞上真实文件名或
          // 标题时，真实的那一个更该赢。
          const byAlias = list.find((entry) =>
            aliasesOf(entry).some((alias) => alias.toLowerCase() === lowered),
          )
          if (byAlias !== undefined) {
            if (section !== '') requestAnchor(section, byAlias.path, anchorKind)
            void openNote(byAlias.path)
            return
          }
          setError(t('note.wikilinkMissing').replace('{name}', wanted))
        },
        [current, entries, openNote, requestAnchor, status, t],
      )

      /**
       * 把 `![[xxx]]` 里的那段文字解析成一篇笔记的路径（解析不出来返回空串）。
       *
       * 判断口径与点双链完全一致：先问宿主的索引，再按「路径全等 → 文件名 →
       * 标题」三级退让。两边用不同的规则会出现「点能跳过去、嵌不进来」这种
       * 说不清的现象。
       */
      const resolveNotePath = React.useCallback(
        (target) => {
          const raw = String(target || '').trim()
          if (raw === '') return ''
          const sub = status !== null && typeof status.subfolder === 'string' ? status.subfolder.replace(/^\/+|\/+$/g, '') : ''
          const rel = current !== null && typeof current.path === 'string' ? current.path : ''
          const sourceRel = rel === '' ? sub : sub === '' ? rel : `${sub}/${rel}`
          const hosted = resolveViaHost(raw, sourceRel)
          if (hosted !== '') return hosted
          const wanted = raw.replace(/\.md$/i, '')
          const list = entries || []
          const direct = list.find((entry) => entry.path === raw || entry.path === `${wanted}.md`)
          if (direct !== undefined) return direct.path
          const byName = list.find((entry) => entry.path.split('/').pop().replace(/\.md$/i, '') === wanted)
          if (byName !== undefined) return byName.path
          const lowered = wanted.toLowerCase()
          const byTitle = list.find((entry) => String(entry.title || '').toLowerCase() === lowered)
          if (byTitle !== undefined) return byTitle.path
          // 别名与点双链同一套口径：两边不一致会出现「点得过去、嵌不进来」
          const byAlias = list.find((entry) =>
            aliasesOf(entry).some((alias) => alias.toLowerCase() === lowered),
          )
          if (byAlias !== undefined) return byAlias.path
          return ''
        },
        [current, entries, status],
      )

      const dirty = current !== null && draft !== null && draft !== current.content

      /**
       * 从搜索结果点一行，跳到正文里那一行。
       *
       * 用命中行的**文字**当锚，不用行号：搜索是磁盘上那一刻算出来的，用户可能
       * 刚在别处改过这篇，行号一挪就指到别的段落去了，而那一行字通常还在。
       * 有没保存的草稿时也要先问一句——直接 openNote 会把草稿冲掉，用户只是想
       * 去看一眼搜到的那句话。
       */
      const jumpToMatch = React.useCallback(
        (path, match) => {
          const target = String(path || '')
          const text = match !== null && match !== undefined ? String(match.text || '') : ''
          if (target === '' || text.trim() === '') return
          const go = () => {
            requestAnchor(text, target, 'line')
            void openNote(target)
          }
          if (!dirty) {
            go()
            return
          }
          void confirmDialog(t('note.unsaved')).then((ok) => {
            if (ok) go()
          })
        },
        [dirty, openNote, requestAnchor, t],
      )

      const saveNote = React.useCallback(async () => {
        if (current === null || draft === null) return
        setBusy(true)
        // 先记下来再写：宿主的 modify 可能比 /save 的响应还早到
        selfSavedRef.current = { path: current.path }
        try {
          await api('/save', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: current.path, content: draft, requestId: requestId() }),
          })
          setCurrent({ ...current, content: draft })
          showToast(t('note.saved'))
          void refresh()
        } catch (err) {
          // 没存成：磁盘上什么都没变，别让下一次真正的改动被我们吞掉
          selfSavedRef.current = null
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [current, draft, refresh, showToast, t])

      // 新建模板：标题与骨架都带好，用户落笔就是内容。
      // 日期用本地时区算（toISOString 会按 UTC 走，晚上 8 点之后会变成「明天」）。
      const customTemplates = React.useMemo(() => {
        const list = status !== null && Array.isArray(status.templates) ? status.templates : []
        return list.filter((item) => item !== null && typeof item === 'object' && typeof item.name === 'string' && item.name.trim() !== '')
      }, [status])

      const templateContent = React.useCallback((id) => {
        const now = new Date()
        const pad = (n) => String(n).padStart(2, '0')
        const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
        const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`
        const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
        // 自定义模板：id 形如 `custom:周报`。标题就是模板名，正文是用户自己写的骨架。
        // 不再自动加日期前缀——用户建模板时自己就能写 `{{date}}` 之类，替他加反而
        // 会在他已经写好日期的地方再叠一层。
        if (typeof id === 'string' && id.startsWith('custom:')) {
          const name = id.slice('custom:'.length)
          const found = customTemplates.find((item) => item.name === name)
          return { title: name, content: found && typeof found.body === 'string' ? found.body : '' }
        }
        if (id === 'daily') {
          return {
            title: `${day} 日记`,
            content: `\n## 今天发生了什么\n\n\n## 想法\n\n\n## 明天要做\n\n`,
          }
        }
        if (id === 'book') {
          return {
            title: t('new.bookTitle'),
            content: `\n## 这本书在讲什么\n\n\n## 让我有反应的地方\n\n> \n\n## 我会怎么用\n\n`,
          }
        }
        if (id === 'meeting') {
          return {
            title: `${day} ${t('new.meetingTitle')}`,
            content: `\n- 时间：${day} ${hm}\n- 参与：\n\n## 讨论了什么\n\n\n## 结论\n\n\n## 我要跟进的\n\n- [ ] \n`,
          }
        }
        // 随手记：只给日期标题，正文留空——它本来就是「想到一句就记下来」的场景
        return { title: `${day} ${weekday} 随手记`, content: '' }
      }, [customTemplates, t])

      const newTemplates = React.useMemo(() => {
        const builtin = [
          { id: 'daily', icon: 'calendar' },
          { id: 'book', icon: 'book' },
          { id: 'meeting', icon: 'clock' },
          { id: 'note', icon: 'note' },
        ]
        // 自定义模板排在后面：内置那四个是大多数人的起点，用户自己的模板
        // 是他确认过要反复用的，但出现频率通常低于日记，放前面会挤掉常用项。
        const mine = customTemplates.map((item) => ({ id: `custom:${item.name}`, icon: 'edit', custom: true }))
        return builtin.concat(mine)
      }, [customTemplates])

      const newNote = React.useCallback(
        async (templateId) => {
          const spec = typeof templateId === 'string' ? templateContent(templateId) : { title: t('action.new'), content: '' }
          setTemplatesOpen(false)
          setBusy(true)
          // 在面板里选了目录就以它为准（那是用户刚刚明说的）；没选才跟着宿主
          // 的「新建笔记默认位置」走，免得在同一个库里有两套「新建落在哪」。
          const dir = activeDir !== '' ? activeDir : newNotePlacementOf()
          try {
            const created = await api('/create', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                dir,
                title: spec.title,
                content: spec.content,
                requestId: requestId(),
              }),
            })
            showToast(t('note.created'))
            await refresh()
            await openNote(created.path)
          } catch (err) {
            setError(err && err.message ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        },
        [activeDir, openNote, refresh, showToast, t, templateContent],
      )

      /**
       * 等这一轮同步跑完，返回它的结果。
       *
       * 轮询而不是让服务端回调：面板可能刚被命令面板拉起来，也可能在同步途中
       * 被关掉；轮询的每一跳都是独立的 HTTP 请求，中间断了不会有悬挂状态。
       * 上限 5 分钟——真跑飞了也不该让面板一直转。
       */
      const waitForSync = React.useCallback(async () => {
        const deadline = Date.now() + 5 * 60 * 1000
        // 刚点下去的那一瞬间 running 可能还没置上，先等一拍再开始看
        await new Promise((done) => window.setTimeout(done, 600))
        for (;;) {
          if (Date.now() > deadline) return null
          let json
          try {
            json = await api('/sync/status')
          } catch {
            return null
          }
          if (json && json.running !== true) {
            if (json.lastResult) reportSync(json.lastResult)
            return json.lastResult || null
          }
          await new Promise((done) => window.setTimeout(done, 2000))
        }
      }, [])

      /**
       * 处理来自命令面板 / 状态栏的意图。
       *
       * 这些动作原来只能点面板里的按钮，用户在命令面板里敲「同步」却什么都
       * 搜不到。现在命令直接投递意图过来，这里负责把它落到面板的状态上。
       */
      React.useEffect(
        () =>
          subscribeIntent((intent) => {
            const kind = intent && intent.type
            if (kind === 'search') {
              setTab('notes')
              // 深链带过来的关键词直接填进去，用户从浏览器点过来就该看到结果，
              // 而不是先看到空搜索框再自己敲一遍。
              if (typeof intent.q === 'string' && intent.q !== '') setQuery(intent.q)
              // 等一帧再找输入框：切页签的渲染是异步的，立刻 querySelector 拿不到
              window.setTimeout(() => {
                const input = findInPanel('.dshgn_search')
                if (input) {
                  input.focus()
                  input.select()
                }
              }, 30)
              return
            }
            if (kind === 'open') {
              // 从宿主的快速切换器挑了一篇。面板可能还停在别的页签上，
              // 先切回笔记页再打开，否则用户点完看到的是「什么都没发生」。
              const path = typeof intent.path === 'string' ? intent.path : ''
              if (path === '') return
              setTab('notes')
              void openNote(path)
              return
            }
            if (kind === 'new') {
              setTab('notes')
              if (status !== null && !status.vaultMissing) void newNote()
              return
            }
            if (kind === 'today') {
              // 「今天」的笔记：先按日期找，找不到就按日期新建。
              // 用日期做标题而不是「今日」两个字，归档后仍然能一眼看出是哪天。
              //
              // 目录和文件名格式先问宿主的日记核心插件：用户可能把日记配成
              // 「日记/YYYY/YYYY-MM-DD」，自己再拼一个丢在库根，就等于在同一个库里
              // 造第二套「今天」。问不到才退回「库根 + YYYY-MM-DD」。
              const now = new Date()
              const pad = (n) => String(n).padStart(2, '0')
              const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
              const hosted = dailyNoteOf()
              const todayDir = hosted !== null ? hosted.dir : ''
              const todayTitle = hosted !== null ? hosted.title : stamp
              const todayPath = todayDir === '' ? `${todayTitle}.md` : `${todayDir}/${todayTitle}.md`
              setTab('notes')
              // 先按路径认（宿主的格式可能不是日期，比如「YYYY年MM月DD日」），
              // 再退回按标题认（宿主的格式认不出来时，至少标题对得上）。
              //
              // 「今天」这个日期只有在问不到宿主时才拿来认：宿主已经明说今天
              // 在哪一篇了，就不该因为库里另有几篇也是今天的日期而打开别的。
              const hit =
                (entries || []).find((entry) => entry.path === todayPath) ||
                (hosted !== null
                  ? (entries || []).find(
                      (entry) => String(entry.title || '').trim() === todayTitle,
                    )
                  : (entries || []).find(
                      (entry) =>
                        entry.date === stamp || String(entry.title || '').trim() === stamp,
                    ))
              if (hit !== undefined) {
                void openNote(hit.path)
                return
              }
              if (status === null || status.vaultMissing) return
              setBusy(true)
              // 宿主的日记模板：那边配好的标题骨架、提问、标签都在这儿。
              // 问不到就建一篇空的——凭空造一套模板比空着更糟。
              void dailyTemplateOf()
                .then((template) =>
                  api('/create', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      dir: hosted !== null ? todayDir : activeDir,
                      title: todayTitle,
                      content: template,
                      // 宿主的日记名可能本身就是日期，别再叠一层日期前缀
                      withDatePrefix: hosted === null,
                      requestId: requestId(),
                    }),
                  }),
                )
                .then(async (created) => {
                  showToast(t('note.created'))
                  await refresh()
                  await openNote(created.path)
                })
                .catch((err) => setError(err && err.message ? err.message : String(err)))
                .finally(() => setBusy(false))
              return
            }
            if (kind === 'capture') {
              // 选区速记：把别处的文字（选中一段笔记、命令里带的原文）落成一篇
              // 新笔记。标题取第一行，正文整段引用——摘录和自己的想法必须能
              // 一眼分开，所以用引用块而不是直接粘。
              const text = typeof intent.text === 'string' ? intent.text.trim() : ''
              if (text === '') return
              setTab('notes')
              if (status === null || status.vaultMissing) return
              const firstLine =
                text
                  .split('\n')
                  .map((line) => line.trim())
                  .filter((line) => line !== '')[0] || t('capture.title')
              const title = firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine
              const quoted = text
                .split('\n')
                .map((line) => (line === '' ? '>' : `> ${line}`))
                .join('\n')
              const from =
                typeof intent.source === 'string' && intent.source !== ''
                  ? `\n\n—— 摘自 ${intent.source}`
                  : ''
              setBusy(true)
              void api('/create', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  dir: activeDir,
                  title,
                  content: `${quoted}${from}\n`,
                  requestId: requestId(),
                }),
              })
                .then(async (created) => {
                  showToast(t('capture.saved'))
                  await refresh()
                  await openNote(created.path)
                })
                .catch((err) => setError(err && err.message ? err.message : String(err)))
                .finally(() => setBusy(false))
              return
            }
            if (kind === 'sync') {
              setTab('settings')
              setBusy(true)
              void api('/sync/start', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ full: false }),
              })
                .then(() => {
                  showToast(t('sync.running'))
                  // 命令面板触发时面板可能根本没打开，跑完的结果没人看见。
                  // 这里等到这一轮结束，再把结果交给宿主（写进当天日记）。
                  return waitForSync()
                })
                .catch((err) => setError(err && err.message ? err.message : String(err)))
                .finally(() => setBusy(false))
              return
            }
            if (kind === 'card') {
              setTab('card')
              setBusy(true)
              // 8 秒是卡片页扫描按钮用的同一档：BLE 扫描慢一点也够，
              // 再长用户会以为卡住了。
              void api('/card/scan?timeout=8')
                .then((json) => {
                  const count = Array.isArray(json && json.cards) ? json.cards.length : 0
                  showToast(count > 0 ? `${t('card.scanFound')}：${count}` : t('card.scanNone'))
                })
                .catch((err) => setError(err && err.message ? err.message : String(err)))
                .finally(() => setBusy(false))
            }
          }),
        [activeDir, entries, newNote, openNote, refresh, showToast, status, t],
      )

      /**
       * 把拖进来 / 粘进来的文件存成这篇笔记的附件，并在正文里留下引用。
       *
       * 宿主里这两件事是自动的：拖张图进编辑器就落到附件目录、正文里多一行
       * ![[图.png]]。面板以前什么都不做——用户以为图存进去了，其实盘上没有，
       * 正文里只有一串文件名。这里补上同一件事。
       *
       * 有没保存的草稿时只改草稿不落盘：用户正在写，我们替他保存会把半句话
       * 也一起写进去。没草稿才直接存，省得用户还要再点一次保存。
       */
      const attachFiles = React.useCallback(
        async (fileList) => {
          const files = Array.from(fileList || []).filter((file) => file !== null && typeof file === 'object')
          if (files.length === 0) return
          if (current === null) {
            showToast(t('attach.needNote'))
            return
          }
          setBusy(true)
          try {
            const names = []
            let failed = 0
            for (const file of files) {
              try {
                const saved = await uploadAsset(current.path, file)
                if (saved && typeof saved.name === 'string' && saved.name !== '') names.push(saved.name)
              } catch {
                failed += 1
              }
            }
            if (names.length === 0) {
              showToast(t('attach.failed'))
              return
            }
            const base = draft !== null ? draft : current.content
            const insert = names.map((name) => `![[${name}]]`).join('\n')
            const next = base.trim() === '' ? `${insert}\n` : `${base.replace(/\s*$/, '')}\n\n${insert}\n`
            const unsaved = draft !== null && draft !== current.content
            if (unsaved) {
              setDraft(next)
            } else {
              await api('/save', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ path: current.path, content: next, requestId: requestId() }),
              })
              await openNote(current.path)
            }
            showToast(failed > 0 ? t('attach.failed') : t('attach.added'))
          } catch (err) {
            setError(err && err.message ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        },
        [current, draft, openNote, setDraft, showToast, t],
      )

      /**
       * 重命名一篇笔记。
       *
       * 这件事必须交给宿主：它改名的时候会顺手把全库的双链、Markdown 链接一起
       * 改掉。我们自己去 rename 文件的话，别的笔记里的 [[旧名字]] 会静默变成
       * 死链——那种断裂往往几个月后才被发现，而且很难查是哪一次改名造成的。
       *
       * 改完之后重读一遍正文：宿主的链接重写可能连这篇自己内部的引用也改了。
       */
      const renameNote = React.useCallback(
        async (path) => {
          const target = String(path || '')
          if (target === '') return
          // 有没保存的改动就先拦住：宿主的改名对话框挡在中间，改完面板会重新读
          // 一遍，草稿没落盘的话，用户刚敲的那几句就跟着旧文件一起没了。
          if (
            current !== null &&
            current.path === target &&
            draft !== null &&
            draft !== current.content
          ) {
            showToast(t('note.renameUnsaved'))
            return
          }
          const next = await renameNoteInHost(target)
          if (next === '') return
          showToast(t('action.renamed'))
          await refresh()
          await openNote(next)
        },
        [current, draft, openNote, refresh, showToast, t],
      )

      const deleteNote = React.useCallback(async () => {
        if (current === null) return
        setBusy(true)
        try {
          await api('/delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: current.path, requestId: requestId() }),
          })
          setCurrent(null)
          setDraft(null)
          showToast(t('note.deleted'))
          void refresh()
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [current, refresh, showToast, t])

      const copyReference = React.useCallback(async () => {
        if (current === null || status === null) return
        // 先问宿主：它知道用户偏好 Wiki 链接还是 Markdown 链接、路径写全还是写短。
        const hosted = markdownLinkOf(current.path)
        let text = hosted
        if (text === '') {
          const abs = `${status.vaultRoot}${status.vaultRoot.endsWith('/') || status.vaultRoot.endsWith('\\') ? '' : '/'}${current.path}`
          text = /[\s"]/.test(abs) ? `@"${abs}"` : `@${abs}`
        }
        try {
          await navigator.clipboard.writeText(text)
          showToast(t('action.copied'))
        } catch {
          showToast(text)
        }
      }, [current, status, showToast, t])

      // B1 单篇同步：把当前这篇推上云端 / 从云端拉下来。
      // 整轮同步要翻页扫全库，而用户此刻只想让眼前这一篇对上，
      // 所以走 /sync/push-one 与 /sync/pull-one 这两个单篇端点。
      const syncCurrent = React.useCallback(
        async (direction) => {
          if (current === null) return
          setBusy(true)
          try {
            const json = await api(direction === 'push' ? '/sync/push-one' : '/sync/pull-one', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ path: current.path }),
            })
            showToast(direction === 'push' ? t('sync.pushedOne') : t('sync.pulledOne'))
            // 拉下来之后要重新读一遍，否则面板还显示旧正文
            await refresh()
            await openNote(current.path)
            return json
          } catch (err) {
            setError(err && err.message ? err.message : String(err))
            return null
          } finally {
            setBusy(false)
          }
        },
        [current, openNote, refresh, setBusy, showToast, t],
      )

      // D2 批量操作：多选后批量加标签 / 移目录 / 删。选中的是 path 集合，
      // 不是索引——列表会随搜索和排序变，用索引会选错人。
      const [picked, setPicked] = React.useState(() => new Set())
      const [batchTag, setBatchTag] = React.useState('')
      const [batchDir, setBatchDir] = React.useState('')
      const [batchOpen, setBatchOpen] = React.useState(false)
      const pickedCount = picked.size

      const togglePick = React.useCallback((path) => {
        setPicked((prev) => {
          const next = new Set(prev)
          if (next.has(path)) next.delete(path)
          else next.add(path)
          return next
        })
      }, [])

      const clearPicked = React.useCallback(() => {
        setPicked(new Set())
        setBatchOpen(false)
      }, [])

      const runBatch = React.useCallback(
        async (kind) => {
          if (picked.size === 0) return
          setBusy(true)
          try {
            const json = await api('/batch', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                action: kind,
                paths: Array.from(picked),
                tag: kind === 'tag' ? batchTag.trim() : undefined,
                dir: kind === 'move' ? batchDir.trim() : undefined,
              }),
            })
            showToast(`${t('batch.done')} ${json.changed || 0}`)
            clearPicked()
            await refresh()
            if (current !== null && picked.has(current.path)) setCurrent(null)
          } catch (err) {
            setError(err && err.message ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        },
        [batchDir, batchTag, clearPicked, current, picked, refresh, setBusy, setError, showToast, t],
      )

      // 从宿主的文件树里拖一篇笔记到列表上 = 挪进当前筛的这个目录。
      //
      // 拖进来的是宿主自己的路径口径（库内相对路径，带笔记子目录前缀），而
      // /batch 认的是面板口径（相对笔记目录）。先归一，再交给同一个批量移动
      // 端点——拖动和「批量移目录」必须是同一条路，否则两边行为会慢慢走偏。
      const dropIntoDir = React.useCallback(
        async (rawPaths) => {
          const target = activeDir
          if (target === '') {
            showToast(t('drop.pickDirFirst'))
            return
          }
          const sub = status !== null && typeof status.subfolder === 'string' ? status.subfolder.replace(/^\/+|\/+$/g, '') : ''
          const paths = []
          for (const raw of rawPaths) {
            const rel = String(raw || '').replace(/\\/g, '/').replace(/^\/+/, '')
            if (rel === '') continue
            // 只收笔记目录里的东西：拖进来的是「库里的另一篇笔记」，不是「把库外
            // 任意文件搬进笔记目录」。后者是个大得多的动作，不该由一次误拖触发。
            if (sub !== '' && !rel.startsWith(`${sub}/`)) continue
            const inner = sub !== '' ? rel.slice(sub.length + 1) : rel
            if (!/\.md$/i.test(inner)) continue
            paths.push(inner)
          }
          if (paths.length === 0) return
          setBusy(true)
          try {
            const json = await api('/batch', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: 'move', paths, dir: target }),
            })
            showToast(`${t('batch.done')} ${json.changed || 0}`)
            await refresh()
          } catch (err) {
            setError(err && err.message ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        },
        [activeDir, refresh, setBusy, setError, showToast, status, t],
      )

      // vaultMissing 正常时是 null（不是 false）：这里原本写 === false，
      // 于是「+」和刷新按钮永远处于 disabled 状态，用户点了以为没反应。
      // 只要 status 拿到了、且没报缺失，就算就绪。
      const vaultReady = status !== null && !status.vaultMissing

      // D1 键盘快捷键。只在「笔记」页签生效——云端/同步/设置页里按 J/K
      // 去切笔记会很意外。另外必须排除输入态：用户在搜索框里打字按 j，
      // 那是要输字母，不是要往下走。
      React.useEffect(() => {
        const onKey = (event) => {
          const target = event.target
          const tag = target && target.tagName ? String(target.tagName).toLowerCase() : ''
          const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable === true)
          if (event.key === 'Escape') {
            setTemplatesOpen(false)
            return
          }
          if (typing) return
          const meta = event.ctrlKey || event.metaKey
          if (meta && event.key.toLowerCase() === 'k') {
            event.preventDefault()
            // 搜到搜索框，而不是另开一个搜索面板：用户已经熟悉那一个入口
            const input = findInPanel('.dshgn_search', docOfEvent(event))
            if (input) {
              input.focus()
              input.select()
            }
            return
          }
          if (meta && event.key.toLowerCase() === 'n') {
            event.preventDefault()
            if (vaultReady) void newNote()
            return
          }
          if (tab !== 'notes') return
          // J/K 上下移：和 vim、Gmail、GitHub 的列表浏览一致
          if (event.key === 'j' || event.key === 'k') {
            if (shown.length === 0) return
            const index = current === null ? -1 : shown.findIndex((entry) => entry.path === current.path)
            const next = event.key === 'j' ? Math.min(shown.length - 1, index + 1) : Math.max(0, index - 1)
            const target2 = shown[next]
            if (target2 && target2.path !== (current !== null ? current.path : null)) {
              event.preventDefault()
              void openNote(target2.path)
            }
          }
        }
        // 每个面板窗口各挂一份：popout 里按 Ctrl+K 也得能聚焦搜索框。
        return attachOnPanelWindows('keydown', onKey)
      }, [current, newNote, openNote, shown, tab, vaultReady])

      // 把宿主的文件拖进面板时，别让浏览器把它当成「打开这个文件」。
      //
      // 浏览器默认行为是「拖到窗口里就导航到那个文件」，在 Obsidian 里表现成
      // 整个工作区被换掉，用户就以为面板炸了。只有拖到面板自己身上才拦：
      // 拖到别处（宿主自己的编辑器、别的插件）那是它们的事。
      React.useEffect(() => {
        const onDragOver = (event) => {
          if (!inPanel(event)) return
          event.preventDefault()
          if (event.dataTransfer) {
            try {
              event.dataTransfer.dropEffect = 'copy'
            } catch {
              // 某些环境 dataTransfer 是只读的，拦默认行为本身已经够了
            }
          }
        }
        return attachOnPanelWindows('dragover', onDragOver)
      }, [])

      // badge 是文字右边的小胶囊（像邮件未读那种），不是骑在页签右上角的角标——
      // 角标会压住页签本身的边距，还会让相邻页签的间距看起来不齐。
      const tabButton = (id, label, badge) =>
        h(
          'button',
          { type: 'button', className: 'dshgn_tab', 'data-on': tab === id ? 'true' : 'false', onClick: () => setTab(id) },
          h('span', { className: 'dshgn_tabLabel' }, label),
          badge === undefined || badge === null
            ? null
            : h('span', { className: 'dshgn_tabBadge' }, String(badge)),
        )

      const head = h(
        'div',
        { className: 'dshgn_head' },
        // 窄窗口里左栏是抽屉，没有这个按钮就再也打不开了。
        // 宽窗口下 display:none，不占位。
        tab === 'notes'
          ? h(
              'button',
              {
                type: 'button',
                className: 'dshgn_iconBtn dshgn_treeToggle',
                title: t('panel.toggleTree'),
                'aria-expanded': treeOpen ? 'true' : 'false',
                onClick: () => setTreeOpen((prev) => !prev),
              },
              h(Icon, { name: 'folder', size: 15 }),
            )
          : null,
        h(
          'div',
          { className: 'dshgn_headMain' },
          h('div', { className: 'dshgn_title' }, t('panel.title')),
          h(
            'div',
            { className: 'dshgn_sub', title: status ? status.vaultRoot : '' },
            status === null ? '' : status.vaultMissing ? t('empty.noVault') : status.vaultRoot,
          ),
        ),
        // 动作按钮放在页签**左边**：页签是「去哪」（导航），按钮是「对当前页做什么」（动作）。
        // 动作紧贴内容更有因果关系，也避免鼠标为了点刷新横穿整条顶栏。
        h(
          'div',
          { className: 'dshgn_actions' },
          tab === 'notes' || tab === 'cloud'
            ? h(
                React.Fragment,
                null,
                h(
                  'div',
                  { className: 'dshgn_newWrap' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshgn_iconBtn',
                      title: t('action.new'),
                      onClick: () => setTemplatesOpen((prev) => !prev),
                      disabled: busy || !vaultReady,
                      'data-on': templatesOpen ? 'true' : 'false',
                    },
                    h(Icon, { name: 'plus' }),
                  ),
                  // 模板菜单：直接点「+」会建一篇空笔记，用户还得自己写标题和标签。
                  // 常写的几类（日记/读书/会议/随手记）日期和结构都是固定的，
                  // 让用户选一次比每次重复劳动好。
                  templatesOpen
                    ? h(
                        React.Fragment,
                        null,
                        h('div', { className: 'dshgn_menuMask', onClick: () => setTemplatesOpen(false) }),
                        h(
                          'div',
                          { className: 'dshgn_menu', role: 'menu' },
                          h('div', { className: 'dshgn_menuTitle' }, t('new.template')),
                          newTemplates.map((item) =>
                            h(
                              'button',
                              {
                                key: item.id,
                                type: 'button',
                                className: 'dshgn_menuItem',
                                role: 'menuitem',
                                onClick: () => void newNote(item.id),
                              },
                              h(Icon, { name: item.icon, size: 13 }),
                              // 自定义模板直接显示模板名（用户自己起的，没有译文可查），
                              // 提示行说明它带的是自己写的骨架，而不是空白。
                              h('span', null, item.custom ? item.id.slice('custom:'.length) : t(`new.${item.id}`)),
                              h(
                                'span',
                                { className: 'dshgn_menuHint' },
                                item.custom ? t('new.customHint') : t(`new.${item.id}Hint`),
                              ),
                            ),
                          ),
                        ),
                      )
                    : null,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshgn_iconBtn' + (refreshState === 'ok' ? ' dshgn_iconBtnOk' : refreshState === 'fail' ? ' dshgn_iconBtnFail' : ''),
                    title: t('action.refresh'),
                    onClick: refresh,
                    disabled: busy,
                  },
                  h('span', { className: 'dshgn_refreshSpin' + (refreshState === 'spinning' ? ' dshgn_refreshSpinOn' : '') }, h(Icon, { name: 'refresh' })),
                ),
              )
            : null,
        ),
        h(
          'div',
          { className: 'dshgn_tabs' },
          tabButton('notes', t('tab.notes')),
          tabButton('cloud', t('tab.cloud')),
          // 「同步」不再单独占一个页签，收进了设置页。自动同步本质上是「设置」：
          // 设一次间隔就不管了，不是每天要看的东西，占一个一级入口反而挤掉了
          // 真正要翻的笔记/云端。
          // 冲突页签常驻。早先是「有冲突才出现」，但页签凭空消失会让人以为功能
          // 被删了，而且处理过的留档也想随时翻回去看。所以入口一直在，
          // 只有未处理的数量挂在旁边当角标——数字没了就说明手头清干净了。
          tabButton(
            'conflict',
            t('tab.conflict'),
            status !== null && status.conflicts > 0 ? status.conflicts : undefined,
          ),
          tabButton('card', t('tab.card')),
          tabButton('broken', t('tab.broken')),
          tabButton('settings', t('tab.settings')),
          tabButton('trash', t('tab.trash')),
        ),
      )

      let body
      if (tab === 'cloud') {
        body = h(CloudPane, {
          t,
          status,
          showToast,
          onError: (message) => setError(message),
          onSynced: () => {
            void refresh()
          },
        })
      } else if (tab === 'settings') {
        body = h(SettingsPane, {
          t,
          status,
          onSaved: async (message) => {
            showToast(message)
            await refresh()
          },
          onError: (message) => setError(message),
          showToast,
          onThemePreview: setThemePreview,
          locale,
          onLocaleChange: setLocale,
          // 同步卡里的改动只需要静默刷新状态，不要弹 toast——用户点一下开关
          // 就弹一条提示，反而像在催他。
          onSyncChanged: async () => {
            await refresh()
          },
        })
      } else if (tab === 'card') {
        body = h(CardPane, {
          t,
          status,
          showToast,
          onError: (message) => setError(message),
          onChanged: async () => {
            await refresh()
          },
        })
      } else if (tab === 'conflict') {
        body = h(ConflictPane, {
          t,
          status,
          onChanged: async () => {
            await refresh()
          },
          onError: (message) => setError(message),
          showToast,
        })
      } else if (tab === 'broken') {
        body = h(BrokenPane, {
          t,
          status,
          onError: (message) => setError(message),
          onOpen: (path) => {
            setTab('notes')
            void openNote(path)
          },
        })
      } else if (tab === 'trash') {
        body = h(TrashPane, {
          t,
          status,
          onChanged: async () => {
            await refresh()
          },
          onError: (message) => setError(message),
          showToast,
        })
      } else if (status === null) {
        // 首次加载：先出骨架，避免一片空白
        body = h(SkeletonPane, { t })
      } else {
        body = h(
          'div',
          { className: 'dshgn_body' },
          h(TreePane, {
            t,
            tree,
            // 窄窗口抽屉里点完目录要自己收回去，否则它还盖在列表上
            onNarrowPick: () => setTreeOpen(false),
            dirs,
            entries,
            activeDir,
            activeTag,
            tagCounts,
            dirSort,
            tagSort,
            onDirSortChange: (next) => {
              setDirSort(next)
              makeSortPref('dshgn.sortDir').write(next)
            },
            onTagSortChange: (next) => {
              setTagSort(next)
              makeSortPref('dshgn.sortTag').write(next)
            },
            onPickDir: (dir) => {
              setActiveDir(dir)
              setActiveTag('')
            },
            onPickTag: (tag) => {
              setActiveTag(tag)
              setActiveDir('')
            },
            onCreateDir: async (name) => {
              try {
                await api('/dir/create', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ dir: name }),
                })
                showToast(t('tree.dirCreated'))
                await refresh()
              } catch (err) {
                setError(err && err.message ? err.message : String(err))
              }
            },
            onDeleteDir: async (name) => {
              try {
                await api('/dir/delete', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ dir: name }),
                })
                showToast(t('tree.deletedDir'))
                // 正在看的目录被删掉了就退回全部笔记，否则列表会空着
                if (activeDir === name) setActiveDir('')
                await refresh()
              } catch (err) {
                const message = err && err.message ? err.message : String(err)
                // 非空目录是预期内的失败（用户得先把笔记移走），单独给一句人话
                setError(/还有|not empty|409/.test(message) ? t('tree.dirNotEmpty') : message)
              }
            },
            onDeleteTag: async (name) => {
              try {
                await api('/tag/delete', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ tag: name }),
                })
                showToast(t('tree.deletedTag'))
                if (activeTag === name) setActiveTag('')
                await refresh()
              } catch (err) {
                setError(err && err.message ? err.message : String(err))
              }
            },
            onCreateTag: async (name) => {
              // 标签不是独立实体：它必须挂在某一篇笔记上。没有打开的笔记就
              // 明确告诉用户先打开一篇，而不是建一个永远不显示的幽灵标签。
              if (current === null || current.path === undefined) {
                showToast(t('tree.tagNeedNote'))
                return
              }
              try {
                await api('/batch', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ action: 'tag', paths: [current.path], tag: name }),
                })
                showToast(t('tree.tagCreated'))
                await refresh()
              } catch (err) {
                setError(err && err.message ? err.message : String(err))
              }
            },
            onRenameTag: async (from, to) => {
              try {
                const json = await api('/tag/rename', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ from, to }),
                })
                // 正在按旧标签筛着的时候，改名完要跟过去，否则列表会突然空掉
                if (activeTag === from) setActiveTag(to)
                const changed = json && typeof json.changed === 'number' ? json.changed : 0
                showToast(`${t('tree.tagRenamed')} · ${changed}`)
                await refresh()
              } catch (err) {
                setError(err && err.message ? err.message : String(err))
              }
            },
            currentNoteId: current !== null && current.noteId ? current.noteId : null,
            heatmap: status !== null && status.heatmap ? status.heatmap : null,
          }),
          h(ColSplitter, {
            label: t('col.treeWidth'),
            value: colWidths.tree,
            min: TREE_MIN_W,
            max: TREE_MAX_W,
            onChange: (next) => setColWidths((prev) => ({ ...prev, tree: next })),
          }),
          h(
            'div',
            { className: 'dshgn_list' },
            h(
              'div',
              { className: 'dshgn_searchWrap' },
              h(Icon, { name: 'search', size: 14, className: 'dshgn_searchIcon' }),
              h('input', {
                className: 'dshgn_search',
                type: 'search',
                value: query,
                placeholder: t('search.placeholder'),
                onChange: (event) => setQuery(event.target.value),
              }),
              searching ? h('span', { className: 'dshgn_searching' }, t('search.searching')) : null,
            ),
            // 限定语法提示：`tag:` / `dir:` 是隐藏功能，不提示没人会知道。
            // 只在输入框有内容时出现，平时不占位置。
            query.trim() !== ''
              ? h('div', { className: 'dshgn_searchHint' }, t('search.hint'))
              : null,
            // D2 批量工具栏：只在有选中时出现，不占常态空间。
            pickedCount > 0
              ? h(
                  'div',
                  { className: 'dshgn_batchBar' },
                  h('span', { className: 'dshgn_batchCount' }, `${pickedCount} ${t('batch.picked')}`),
                  h(
                    'button',
                    { type: 'button', className: 'dshgn_batchBtn', onClick: () => setBatchOpen(!batchOpen) },
                    t('batch.actions'),
                  ),
                  h('button', { type: 'button', className: 'dshgn_batchBtn', onClick: clearPicked }, t('batch.clear')),
                  batchOpen
                    ? h(
                        'div',
                        { className: 'dshgn_batchMenu' },
                        h(
                          'div',
                          { className: 'dshgn_batchRow' },
                          h('input', {
                            className: 'dshgn_input dshgn_batchInput',
                            type: 'text',
                            value: batchTag,
                            placeholder: t('batch.tagPlaceholder'),
                            onChange: (event) => setBatchTag(event.target.value),
                          }),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'dshgn_btn dshgn_btnPrimary',
                              disabled: busy || batchTag.trim() === '',
                              onClick: () => void runBatch('tag'),
                            },
                            t('batch.addTag'),
                          ),
                        ),
                        h(
                          'div',
                          { className: 'dshgn_batchRow' },
                          h('input', {
                            className: 'dshgn_input dshgn_batchInput',
                            type: 'text',
                            value: batchDir,
                            placeholder: t('batch.dirPlaceholder'),
                            onChange: (event) => setBatchDir(event.target.value),
                          }),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'dshgn_btn',
                              disabled: busy || batchDir.trim() === '',
                              onClick: () => void runBatch('move'),
                            },
                            t('batch.move'),
                          ),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dshgn_btn dshgn_btnDanger',
                            disabled: busy,
                            onClick: () => {
                              // 批量删除不可撤销地进回收站，必须先确认一次
                              void confirmDialog(`${t('batch.confirmDelete')} ${pickedCount}`).then((ok) => {
                                if (ok) void runBatch('delete')
                              })
                            },
                          },
                          t('batch.delete'),
                        ),
                      )
                    : null,
                )
              : null,
            h(
              'div',
              {
                className: 'dshgn_listBody',
                onScroll: onListScroll,
                // 宿主的文件拖到列表里 = 把它挪进当前筛的这个目录。
                // 从宿主文件树拖进来的是宿主自己的路径口径，交给 onDropNote 去认。
                onDrop: (event) => {
                  const files = event && event.dataTransfer ? event.dataTransfer.files : null
                  if (!files || files.length === 0) return
                  event.preventDefault()
                  const paths = []
                  for (const file of Array.from(files)) {
                    const path = file && typeof file.path === 'string' ? file.path : ''
                    if (path !== '') paths.push(path)
                  }
                  if (paths.length > 0) void dropIntoDir(paths)
                },
              },
              visible.length === 0 && !searchMode
                ? h(
                    'div',
                    { className: 'dshgn_empty', style: { padding: '24px 12px' } },
                    h('div', { className: 'dshgn_emptyTitle' }, query.trim() !== '' ? t('empty.search') : t('empty.noNotes')),
                    // 空列表最需要的不是一句「没有笔记」，而是一个能马上动手的按钮
                    query.trim() === '' && vaultReady
                      ? h(
                          'button',
                          { type: 'button', className: 'dshgn_btn dshgn_btnPrimary', style: { marginTop: 10 }, onClick: () => void newNote() },
                          h(Icon, { name: 'plus', size: 13 }),
                          t('action.new'),
                        )
                      : null,
                  )
                : [
                    shownSlice.map((entry) =>
                    h(
                      'div',
                      {
                        key: entry.path,
                        className: 'dshgn_card',
                        'data-on': current !== null && current.path === entry.path ? 'true' : 'false',
                        // 勾选框需要左侧留白停靠（见 .dshgn_card[data-pick]），
                        // 其他列表（云端/冲突/回收站）没有勾选框就不用留这个空
                        'data-pick': 'true',
                        // 拖到宿主的编辑器里就是一条链接。用户在列表里扫到一篇、
                        // 想把它引到正在写的那篇里时，拖过去比复制引用再粘更顺手；
                        // 拖出去的内容用宿主自己的链接格式（跟「复制引用」同一套），
                        // 粘进笔记里才认得出是双链。
                        draggable: true,
                        onDragStart: (event) => {
                          const link = markdownLinkOf(entry.path)
                          const text = link !== '' ? link : entry.path
                          if (event.dataTransfer === null || event.dataTransfer === undefined) return
                          try {
                            event.dataTransfer.setData('text/plain', text)
                            event.dataTransfer.effectAllowed = 'copy'
                          } catch {
                            // 某些环境不让写 dataTransfer，拖动就退化成没反应，不该炸
                          }
                        },
                        onClick: (event) => {

                          // 有未保存的草稿才拦一下；没改动时不该弹框
                          if (!dirty) {
                            void openNote(entry.path, true)
                            return
                          }
                          void confirmDialog(t('note.unsaved')).then((ok) => {
                            if (ok) void openNote(entry.path, true)
                          })
                        },
                        // 右键：把这一篇能做的事一次列出来。先把它设为当前笔记，
                        // 因为下面的动作（复制引用、单篇同步、删除）都作用在 current 上。
                        onContextMenu: (event) => {
                          event.preventDefault()
                          const items = [
                            {
                              id: 'open',
                              label: t('note.menuOpen'),
                              run: () => {
                                if (!dirty) {
                                  void openNote(entry.path, true)
                                  return
                                }
                                void confirmDialog(t('note.unsaved')).then((ok) => {
                                  if (ok) void openNote(entry.path, true)
                                })
                              },
                            },
                            // 右键菜单也要有「在 Obsidian 里打开」：用户常常是在列表里
                            // 扫到一篇、想拿宿主的补全/Vim 去改，而不是先点开再找按钮。
                            hasOpenInEditor()
                              ? {
                                  id: 'open-in-editor',
                                  label: t('action.openInEditor'),
                                  run: () => {
                                    openInEditor(entry.path)
                                  },
                                }
                              : null,
                            hasRevealInVault()
                              ? {
                                  id: 'reveal-in-vault',
                                  label: t('tree.menuReveal'),
                                  run: () => {
                                    revealInVault(entry.path)
                                  },
                                }
                              : null,
                            hasRenameNote()
                              ? {
                                  id: 'rename',
                                  label: t('action.rename'),
                                  run: () => {
                                    void renameNote(entry.path)
                                  },
                                }
                              : null,
                            {
                              id: 'copy-ref',
                              label: t('action.copyRef'),
                              run: () => {
                                void openNote(entry.path, true).then(() => copyReference())
                              },
                            },
                            {
                              id: 'push-one',
                              label: t('sync.pushOne'),
                              run: () => {
                                void openNote(entry.path, true).then(() => syncCurrent('push'))
                              },
                            },
                            {
                              id: 'pull-one',
                              label: t('sync.pullOne'),
                              run: () => {
                                void openNote(entry.path, true).then(() => syncCurrent('pull'))
                              },
                            },
                            {
                              id: 'delete',
                              label: t('action.delete'),
                              danger: true,
                              // 不二次确认：删除是进回收站，可还原，和面板里的删除按钮一致
                              run: () => {
                                void openNote(entry.path, true).then(() => deleteNote())
                              },
                            },
                          ]
                          // 有条件的项（比如没接上宿主编辑器时的「在 Obsidian 里
                          // 打开」）会是 null，交给宿主之前先滤掉：宿主拿到 null 会
                          // 在 setTitle 上炸，整个菜单就没了。
                          showNoteMenu(event, items.filter((item) => item !== null))
                        },
                        title: entry.path,
                      },
                      h(
                        'div',
                        { className: 'dshgn_cardTitleRow' },
                        // 勾选框只在「已有选中」或「鼠标悬停」时可见：常态下列表
                        // 干净，一旦开始多选就全部显形，不用先去某个按钮开多选模式。
                        h('span', {
                          className: 'dshgn_pickBox' + (picked.has(entry.path) ? ' dshgn_pickBoxOn' : ''),
                          role: 'checkbox',
                          'aria-checked': picked.has(entry.path) ? 'true' : 'false',
                          'aria-label': t('batch.pick'),
                          onClick: (event) => {
                            // 勾选不该顺带把笔记打开
                            event.stopPropagation()
                            togglePick(entry.path)
                          },
                          onKeyDown: (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              event.stopPropagation()
                              togglePick(entry.path)
                            }
                          },
                          tabIndex: 0,
                        },
                          picked.has(entry.path) ? h(Icon, { name: 'check', size: 11 }) : null,
                        ),
                        h('div', { className: 'dshgn_cardTitle' }, entry.title),
                        // 正文命中次数：用户能一眼看出哪篇是「真在讲这个」，
                        // 哪篇只是顺口提了一句。
                        searchMode && entry.matchCount > 0
                          ? h('span', { className: 'dshgn_hitCount' }, `${entry.matchCount}`)
                          : null,
                      ),
                      h(
                        'div',
                        { className: 'dshgn_cardMeta' },
                        entry.date ? h('span', null, entry.date) : null,
                        entry.dir ? h('span', null, entry.dir) : null,
                      ),
                      // 搜索态优先显示正文命中行（带行号），比摘要更能说明为什么它被搜出来
                      searchMode && Array.isArray(entry.matches) && entry.matches.length > 0
                        ? h(
                            'div',
                            { className: 'dshgn_cardMatches' },
                            entry.matches.slice(0, 2).map((match, index) =>
                              h(
                                'button',
                                {
                                  key: `${index}-${match.line}`,
                                  type: 'button',
                                  className: 'dshgn_matchLine',
                                  title: t('search.jumpToLine'),
                                  onClick: (event) => {
                                    // 点命中行是「去这一行」，不是「打开这篇」：
                                    // 不拦住的话外层卡片的 onClick 会再跑一遍，
                                    // 先按「打开」跳到篇首，再按「跳行」滚下去
                                    event.stopPropagation()
                                    jumpToMatch(entry.path, match)
                                  },
                                },
                                h('span', { className: 'dshgn_matchNo' }, String(match.line)),
                                h('span', { className: 'dshgn_matchText' }, match.text),
                              ),
                            ),
                          )
                        : entry.excerpt
                          ? h('div', { className: 'dshgn_cardExcerpt' }, entry.excerpt)
                          : null,
                      // 搜索态再补一行「它引用了谁」：只给命中次数的话，用户还得点进去
                      // 才知道这篇讲的是哪几篇。点胶囊直接跳过去。
                      searchMode && Array.isArray(entry.links) && entry.links.length > 0
                        ? h(
                            'div',
                            { className: 'dshgn_cardLinks' },
                            entry.links.slice(0, 4).map((link) =>
                              h(
                                'button',
                                {
                                  key: `l-${link}`,
                                  type: 'button',
                                  className: 'dshgn_cardLinkChip',
                                  title: link,
                                  onClick: (event) => {
                                    event.stopPropagation()
                                    onOpenWikiLink(link)
                                  },
                                },
                                link,
                              ),
                            ),
                            entry.links.length > 4
                              ? h('span', { className: 'dshgn_cardLinkMore' }, `+${entry.links.length - 4}`)
                              : null,
                          )
                        : null,
                    ),
                  ),
                    // 还没渲染完就放一个按钮：滚动续载之外再给个明确出口，
                    // 用户知道下面确实还有东西，而不是以为列表就到这儿了。
                    shown.length > shownSlice.length
                      ? h(
                          'button',
                          {
                            key: '__more',
                            type: 'button',
                            className: 'dshgn_btn dshgn_moreBtn',
                            onClick: () => setListLimit((prev) => prev + LIST_PAGE_SIZE),
                          },
                          `${t('list.more')}（${shown.length - shownSlice.length}）`,
                        )
                      : null,
                  ],
            ),
          ),
          h(ColSplitter, {
            label: t('col.listWidth'),
            value: colWidths.list,
            min: LIST_MIN_W,
            max: LIST_MAX_W,
            onChange: (next) => setColWidths((prev) => ({ ...prev, list: next })),
          }),
          h(NotePane, {
            t,
            status,
            current,
            draft,
            setDraft,
            dirty,
            busy,
            // 窄窗口里「返回列表」用：把当前笔记收起，中栏就回来了。
            // 有没保存的草稿时先问一句——收起来之后草稿就没了，而用户往往
            // 只是想看一眼列表，不是想丢掉刚写的半句。
            onClose: () => {
              if (dirty) {
                void confirmDialog(t('note.unsaved')).then((ok) => {
                  if (!ok) return
                  openSeq.current += 1
                  setCurrent(null)
                  setDraft(null)
                })
                return
              }
              openSeq.current += 1
              setCurrent(null)
              setDraft(null)
            },
            onSave: saveNote,
            onDelete: deleteNote,
            onRename: renameNote,
            onCopyReference: copyReference,
            onOpenWikiLink: openWikiLink,
            onSyncOne: syncCurrent,
            onRestored: async () => {
              // 恢复历史后重新读一遍：面板上还显示着恢复前的正文，
              // 用户会以为恢复没生效。
              await openNote(current.path)
            },
            anchor: pendingAnchor,
            onAnchorDone: () => setPendingAnchor(null),
            resolveNote: resolveNotePath,
            onAttach: attachFiles,
            // 属性区里的标签胶囊：与左栏标签区同一个动作（筛这个标签）
            onPickTag: (tag) => {
              setActiveTag(tag)
              setActiveDir('')
              setTab('notes')
            },
            onError: (message) => setError(message),
            // 勾待办直接落盘再重读：本地文件已经变了，只改前端状态的话
            // 下次保存草稿会把旧内容写回去，把刚勾的那一下冲掉。
            onToggleTodo: async (index, done) => {
              if (current === null) return
              try {
                await api('/todo/toggle', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ path: current.path, index }),
                })
                await openNote(current.path)
                showToast(`${done ? t('todo.done') : t('todo.undone')}`)
              } catch (err) {
                setError(err && err.message ? err.message : String(err))
              }
            },
          }),
        )
      }

      // 拖完松手才落盘：拖动过程中每帧写一次 localStorage 会明显掉帧。
      // 依赖只有 colWidths，值没变时不会重复写。
      React.useEffect(() => {
        writeColWidths(colWidths)
      }, [colWidths])

      // 主题色变量挂在根节点上：自定义属性沿 DOM 继承，三栏里所有
      // var(--dshgn-*) 用法自动跟随，不用挨个组件传参。
      // 预览优先级：选色器里的草稿 > 已保存的值。这样用户拖色轮时整面板
      // 实时跟着变，点「应用」才落盘。
      const themeStyle = themeVars(
        themePreview !== null ? themePreview : status !== null ? status.themeColor : null,
        darkTheme,
      )

      // 栏宽也走 CSS 变量：三栏的 width 全在样式表里写死会没法拖，
      // 挂在根节点上则整棵子树都能继承，拖的时候只改这两个值。
      // 主题色为空时（浅色 + 没选主题色）CSS 里的默认值要生效，所以不能
      // 把 style 整个置空——必须把栏宽这一份并进去。
      const rootStyle = {
        ...(themeStyle === null ? {} : themeStyle),
        '--dshgn-treeW': `${colWidths.tree}px`,
        '--dshgn-listW': `${colWidths.list}px`,
      }

      return h(
        'div',
        { className: 'dshgn_rel', ref: registerPanelRoot },
        h(
          'div',
          {
            className: 'dshgn_root',
            style: rootStyle,
            // 窄窗口的两条状态：抽屉开没开、当前有没有打开笔记。
            // 挂在根节点上而不是每个组件里判断，容器查询只负责显示/隐藏。
            'data-narrow-tree': treeOpen ? 'true' : 'false',
            'data-has-note': current !== null ? 'true' : 'false',
          },
          head,
          error !== null ? h('div', { className: 'dshgn_error', role: 'alert' }, `${t('error.prefix')}: ${error}`) : null,
          // key 用 tab：切换页签时 React 会换掉整个节点，动画才会从头播一遍。
          // 不加 key 的话 React 复用同一个 DOM，transition 没有「变化」可播，
          // 表现就是切页签时内容硬跳一下。
          h('div', { key: tab, className: 'dshgn_body' }, body),
        ),
        toast !== null ? h('div', { className: 'dshgn_toast' }, h(Icon, { name: 'check', size: 13 }), toast) : null,
      )
    }

    // ── 音频播放器 ────────────────────────────────────────────────────────────

    /**
     * 录音播放器。
     *
     * 关键设计：`<audio src>` **不直接指向云端的签名 URL**，而是指向本插件的
     * `${apiOrigin()}/getnote/audio?url=...` 代理。三个原因：
     *   1. 云端 play_url 是短期签名，面板开着放二十分钟就会 403；
     *   2. 那个 URL 是拿用户凭证签出来的，直接暴露在 DOM 里不合适；
     *   3. 部分 CDN 不给跨源 audio 加载，代理能绕开。
     *
     * 用原生 <audio> 而不是自绘波形：原生有系统级的播放能力、支持 Range 拖动、
     * 有键盘可达性，自绘只会更差。
     */
    function AudioPlayer(props) {
      const { t, track, onTimeChange, seekRequest, trackIndex } = props
      const audioRef = React.useRef(null)
      const [playing, setPlaying] = React.useState(false)
      const [current, setCurrent] = React.useState(0)
      const [duration, setDuration] = React.useState(track && track.duration ? track.duration : 0)
      const [failed, setFailed] = React.useState(false)
      // 拖动进度条时，拇指要跟手走。以前直接把 value 绑到 current，用户一拖
      // 就 setCurrent，紧接着 audio 的 timeupdate 又拿旧时间把它打回去，
      // 拇指原地弹回——表现就是「进度条拖不动」。所以拖动期间单独存一份值，
      // timeupdate 不再覆盖它，松手才真正落定。
      const [dragging, setDragging] = React.useState(false)
      const [dragValue, setDragValue] = React.useState(0)

      // 云端的 track 是 CDN 上的签名 URL，必须过 host 侧代理（会过期、会漏凭证）；
      // 本地附件的 track 已经是 `/getnote/asset?...` 这种本站路径，原样用即可。
      const src = track
        ? track.url.startsWith(`${apiOrigin()}/getnote/`)
          ? track.url
          : withToken(`${apiOrigin()}/getnote/audio?url=${encodeURIComponent(track.url)}`)
        : null

      // 换音轨时重置播放状态（否则进度条会停在上一首的位置）
      React.useEffect(() => {
        setPlaying(false)
        setCurrent(0)
        setDuration(track && track.duration ? track.duration : 0)
        setFailed(false)
        const el = audioRef.current
        if (el) {
          try {
            el.pause()
            el.currentTime = 0
          } catch {
            /* 还没加载好，忽略 */
          }
        }
      }, [src])

      // 逐字稿点时间戳 → 这里跳过去。用「请求对象 + 序号」而不是一个裸秒数：
      // 连点同一个时间戳两次，秒数没变，单靠数值比较第二次不会触发。
      React.useEffect(() => {
        if (!seekRequest || typeof seekRequest.time !== 'number') return
        if (typeof seekRequest.index === 'number' && seekRequest.index !== (trackIndex || 0)) return
        const el = audioRef.current
        if (!el) return
        const value = Math.max(0, seekRequest.time)
        try {
          el.currentTime = value
        } catch {
          /* 元数据还没到，忽略；下面仍更新 UI */
        }
        setCurrent(value)
        setDragValue(value)
        const p = el.play()
        if (p && typeof p.catch === 'function') p.catch(() => undefined)
      }, [seekRequest, trackIndex])

      const toggle = React.useCallback(() => {
        const el = audioRef.current
        if (!el) return
        if (el.paused) {
          const p = el.play()
          // 浏览器可能因为「无用户手势」拒绝播放，这里必须接住，否则控制台一片红
          if (p && typeof p.catch === 'function') p.catch(() => setFailed(true))
        } else {
          el.pause()
        }
      }, [])

      // ── 进度条：自绘 div + 指针捕获 ─────────────────────────────────────
      // 不用 <input type=range>：实测在这套面板里「怎么拖都没反应」。两个原因叠加：
      //   1) 元素只有 4px 高时鼠标抓不住拇指；撑到 18px 也只是提高命中率。
      //   2) 受控 value 绑在 current 上，timeupdate 每秒多次把它打回播放位置，
      //      拇指一拖就弹回——看起来完全没反应。
      // 现在整条 18px 都是命中区，按下即抓；拖动中只改 dragValue（不动 audio），
      // 松手才写 currentTime，避免每动一像素 seek 一次把流式代理拖到反复重新缓冲。
      const barRef = React.useRef(null)

      const valueFromPointer = React.useCallback(
        (clientX) => {
          const el = barRef.current
          if (!el) return 0
          const rect = el.getBoundingClientRect()
          if (!rect.width) return 0
          const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
          return Math.round(ratio * Math.max(1, Math.round(duration)))
        },
        [duration],
      )

      const commitSeek = React.useCallback((target) => {
        const value = Math.max(0, Number(target) || 0)
        const el = audioRef.current
        if (el) {
          try {
            el.currentTime = value
          } catch {
            /* 尚未可 seek：忽略 */
          }
        }
        setCurrent(value)
      }, [])

      const onSeekDown = React.useCallback(
        (event) => {
          // 只响应主键（触屏/触控板的 pointerdown button 是 0 或 undefined）
          if (typeof event.button === 'number' && event.button !== 0) return
          const target = valueFromPointer(event.clientX)
          setDragging(true)
          setDragValue(target)
          // 捕获指针：拖出进度条外面也继续收 move/up，否则在元素外松手就丢事件，
          // 拖动态会永久卡住（这正是原生 input 的老毛病）。
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            /* 老浏览器没有 pointer capture：退化为普通拖动 */
          }
        },
        [valueFromPointer],
      )

      const onSeekMove = React.useCallback(
        (event) => {
          if (!dragging) return
          setDragValue(valueFromPointer(event.clientX))
        },
        [dragging, valueFromPointer],
      )

      const onSeekUp = React.useCallback(
        (event) => {
          if (!dragging) return
          const target = valueFromPointer(event.clientX)
          setDragging(false)
          setDragValue(target)
          commitSeek(target)
          try {
            event.currentTarget.releasePointerCapture(event.pointerId)
          } catch {
            /* 没捕获过就忽略 */
          }
        },
        [dragging, valueFromPointer, commitSeek],
      )

      // 键盘可达性：左右方向键 ±5 秒，Home/End 到首尾。
      const onSeekKey = React.useCallback(
        (event) => {
          const max = Math.max(1, Math.round(duration))
          const base = dragging ? dragValue : current
          let next = null
          if (event.key === 'ArrowLeft') next = Math.max(0, base - 5)
          else if (event.key === 'ArrowRight') next = Math.min(max, base + 5)
          else if (event.key === 'Home') next = 0
          else if (event.key === 'End') next = max
          if (next === null) return
          event.preventDefault()
          setDragValue(next)
          commitSeek(next)
        },
        [dragging, dragValue, current, duration, commitSeek],
      )

      const mmss = (sec) => {
        const s = Math.max(0, Math.floor(Number(sec) || 0))
        const m = Math.floor(s / 60)
        const r = s % 60
        return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
      }

      if (!track) return null

      // 拇指/填充的横向位置。时长未知（duration 还是 0）时按 0 处理，避免除以 0。
      const maxValue = Math.max(1, Math.round(duration))
      const shown = Math.min(Math.round(dragging ? dragValue : current), maxValue)
      const percent = maxValue > 0 ? Math.max(0, Math.min(100, (shown / maxValue) * 100)) : 0

      return h(
        'div',
        { className: 'dshgn_audioCard' },
        h(
          'div',
          { className: 'dshgn_audioLabel' },
          h(Icon, { name: 'audio', size: 13 }),
          h('span', null, track.kind === 'local' ? t('note.localAudio') : t('cloud.audio')),
          track.title ? h('span', { className: 'dshgn_treeCount' }, track.title) : null,
        ),
        h(
          'div',
          { className: 'dshgn_audioBar' },
          h(
            'button',
            {
              type: 'button',
              className: 'dshgn_audioBtn',
              onClick: toggle,
              title: playing ? t('cloud.pause') : t('cloud.play'),
              'aria-label': playing ? t('cloud.pause') : t('cloud.play'),
            },
            h(Icon, { name: playing ? 'pause' : 'play', size: 14 }),
          ),
          h(
            'div',
            {
              ref: barRef,
              className: 'dshgn_audioSeek',
              role: 'slider',
              tabIndex: 0,
              'aria-label': t('cloud.audio'),
              'aria-valuemin': 0,
              'aria-valuemax': Math.max(1, Math.round(duration)),
              'aria-valuenow': Math.round(dragging ? dragValue : current),
              onPointerDown: onSeekDown,
              onPointerMove: onSeekMove,
              onPointerUp: onSeekUp,
              onPointerCancel: onSeekUp,
              onKeyDown: onSeekKey,
            },
            h(
              'div',
              { className: 'dshgn_audioTrack' },
              h('div', { className: 'dshgn_audioFill', style: { width: `${percent}%` } }),
              h('div', { className: 'dshgn_audioThumb', style: { left: `${percent}%` } }),
            ),
          ),
          h('span', { className: 'dshgn_audioTime' }, `${mmss(dragging ? dragValue : current)} / ${mmss(duration)}`),
        ),
        failed ? h('div', { className: 'dshgn_fieldHint', style: { color: 'var(--dsw-alias-state-warn-primary)' } }, track.url) : null,
        h('audio', {
          ref: audioRef,
          src,
          preload: 'metadata',
          style: { display: 'none' },
          onPlay: () => setPlaying(true),
          onPause: () => setPlaying(false),
          onEnded: () => {
            setPlaying(false)
            setCurrent(0)
          },
          onError: () => setFailed(true),
          onLoadedMetadata: (event) => {
            const d = event.target.duration
            if (Number.isFinite(d) && d > 0) setDuration(d)
          },
          onTimeUpdate: (event) => {
            const c = event.target.currentTime
            setCurrent(c)
            if (typeof onTimeChange === 'function') onTimeChange(c)
          },
        }),
      )
    }

    // ── 云端面板 ──────────────────────────────────────────────────────────────

    /**
     * 云端视图：直接读得到大脑，不经过本地文件。
     *
     * 和「笔记」页签的分工：本地页签永远是离线的、快的、可读写的；云端页签是
     * 在线的、能播放录音和改云端内容的。两个都保留，因为用户在不同场景下需要
     * 不同的东西（断网时读本地，想改云端时用云端）。
     */
    function CloudPane(props) {
      const { t, status, showToast, onError, onSynced } = props
      const configured = status !== null && status.api !== undefined && status.api.configured === true

      const [list, setList] = React.useState([])
      const [cursor, setCursor] = React.useState(null)
      const [hasMore, setHasMore] = React.useState(false)
      const [loading, setLoading] = React.useState(false)
      const [query, setQuery] = React.useState('')
      const [selected, setSelected] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [detailLoading, setDetailLoading] = React.useState(false)
      const [editing, setEditing] = React.useState(false)
      const [draftTitle, setDraftTitle] = React.useState('')
      const [draftBody, setDraftBody] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [recallHits, setRecallHits] = React.useState(null)
      const [recalling, setRecalling] = React.useState(false)
      const [shareUrl, setShareUrl] = React.useState(null)
      const [tagDraft, setTagDraft] = React.useState('')
      const [topics, setTopics] = React.useState(null)
      const [activeTopic, setActiveTopic] = React.useState(null)
      const [composing, setComposing] = React.useState(false)
      const [newTitle, setNewTitle] = React.useState('')
      const [newBody, setNewBody] = React.useState('')
      // 播放进度（秒）与「跳到某秒」的请求。逐字稿点时间戳时改后者，
      // 播放器 timeupdate 时改前者——两个方向，互不覆盖。
      const [playhead, setPlayhead] = React.useState(0)
      const [seekRequest, setSeekRequest] = React.useState(null)

      const loadFirst = React.useCallback(async () => {
        if (!configured) return
        setLoading(true)
        onError(null)
        try {
          const page = await api('/cloud/list?limit=20')
          setList(Array.isArray(page.notes) ? page.notes : [])
          setCursor(page.cursor ?? null)
          setHasMore(page.hasMore === true)
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setLoading(false)
        }
      }, [configured, onError])

      const loadMore = React.useCallback(async () => {
        if (!hasMore || loading) return
        setLoading(true)
        try {
          const q = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
          const page = await api(`/cloud/list?limit=20${q}`)
          setList((prev) => [...prev, ...(Array.isArray(page.notes) ? page.notes : [])])
          setCursor(page.cursor ?? null)
          setHasMore(page.hasMore === true)
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setLoading(false)
        }
      }, [cursor, hasMore, loading, onError])

      React.useEffect(() => {
        void loadFirst()
      }, [loadFirst])

      // 知识库列表：进来就拉一次，之后基本不变（用户很少改知识库结构）
      React.useEffect(() => {
        if (!configured) return undefined
        let alive = true
        void (async () => {
          try {
            const result = await api('/cloud/topics')
            if (alive) setTopics(Array.isArray(result.topics) ? result.topics : [])
          } catch {
            // 知识库拉不到不影响看笔记，静默即可
          }
        })()
        return () => {
          alive = false
        }
      }, [configured])

      /** 切到某个知识库：拉库内笔记，替换列表。传 null 回到全部。 */
      const pickTopic = React.useCallback(
        async (topic) => {
          setActiveTopic(topic)
          setRecallHits(null)
          if (topic === null) {
            await loadFirst()
            return
          }
          setLoading(true)
          onError(null)
          try {
            const page = await api(`/cloud/topic-notes?topicId=${encodeURIComponent(topic.topicId || topic.id)}&page=1`)
            setList(Array.isArray(page.notes) ? page.notes : [])
            setCursor(null)
            setHasMore(false)
          } catch (err) {
            onError(err && err.message ? err.message : String(err))
          } finally {
            setLoading(false)
          }
        },
        [loadFirst, onError],
      )

      /** 在云端新建一篇笔记。 */
      const createCloudNote = React.useCallback(async () => {
        const title = newTitle.trim()
        if (title === '') return
        setBusy(true)
        onError(null)
        try {
          const result = await api('/cloud/create', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              title,
              content: newBody,
              topicId: activeTopic !== null ? activeTopic.topicId || activeTopic.id : undefined,
            }),
          })
          showToast(t('cloud.created'))
          setComposing(false)
          setNewTitle('')
          setNewBody('')
          await loadFirst()
          if (result && result.noteId) {
            await openCloudNote({ noteId: String(result.noteId), title })
          }
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [activeTopic, loadFirst, newBody, newTitle, onError, showToast, t])

      // 打开一篇云端笔记：列表里没有 audio/timeline，必须拉详情。
      //
      // toggle=true 时再点一次同一条会收起（右栏回到空白）。只有列表卡片那样传：
      // 新建后自动打开、保存后刷新详情这些内部调用点必须始终是「打开」。
      const openCloudNote = React.useCallback(
        async (note, toggle = false) => {
          if (toggle && selected !== null && selected.noteId === note.noteId) {
            setSelected(null)
            setDetail(null)
            setEditing(false)
            setDetailLoading(false)
            onError(null)
            return
          }
          setSelected(note)
          setDetail(null)
          setEditing(false)
          setDetailLoading(true)
          onError(null)
          try {
            const result = await api(`/cloud/read?id=${encodeURIComponent(note.noteId)}`)
            // localPath 挂在响应顶层（host 从同步状态里查的），但界面上它属于这篇笔记，
            // 所以合并进去，免得每处判断都要同时看 detail 与外部状态。
            setDetail({ ...result.note, localPath: result.localPath || '' })
            setDraftTitle(result.note.title || '')
            setDraftBody(result.note.content || result.note.original || '')
          } catch (err) {
            onError(err && err.message ? err.message : String(err))
          } finally {
            setDetailLoading(false)
          }
        },
        [onError, selected],
      )

      const saveCloud = React.useCallback(async () => {
        if (!detail) return
        setBusy(true)
        try {
          await api('/cloud/update', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ noteId: detail.noteId, title: draftTitle, content: draftBody }),
          })
          showToast(t('cloud.savedCloud'))
          setEditing(false)
          // 云端改完 host 侧已顺手刷新本地镜像，这里重拉一次保证显示的是新值
          await openCloudNote(detail)
          if (typeof onSynced === 'function') onSynced()
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [detail, draftTitle, draftBody, openCloudNote, onError, onSynced, showToast, t])

      const deleteCloud = React.useCallback(async () => {
        if (!detail) return
        if (!(await confirmDialog(`${t('cloud.deleteCloud')}：${detail.title || detail.noteId}？`))) return
        setBusy(true)
        try {
          await api('/cloud/delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ noteId: detail.noteId }),
          })
          showToast(t('cloud.deletedCloud'))
          setSelected(null)
          setDetail(null)
          await loadFirst()
          if (typeof onSynced === 'function') onSynced()
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [detail, loadFirst, onError, onSynced, showToast, t])

      const pullOne = React.useCallback(async () => {
        if (!detail) return
        setBusy(true)
        try {
          const result = await api('/cloud/update', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ noteId: detail.noteId, title: detail.title, content: detail.content || detail.original || '' }),
          })
          showToast(result.local && result.local.path ? result.local.path : t('cloud.localCopy'))
          if (typeof onSynced === 'function') onSynced()
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [detail, onError, onSynced, showToast, t])

      // 语义召回：和本地子串搜索是两套东西，所以单独一个按钮
      const doRecall = React.useCallback(async () => {
        const q = query.trim()
        if (q === '') return
        setRecalling(true)
        onError(null)
        try {
          const result = await api('/cloud/recall', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query: q, topK: 8 }),
          })
          setRecallHits(Array.isArray(result.results) ? result.results : [])
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setRecalling(false)
        }
      }, [query, onError])

      // ── 标签 ────────────────────────────────────────────────────────────────
      // 云端标签是服务端的数据，加/删都要回写；本地镜像由 host 侧顺手刷新，
      // 所以这里改完重拉详情，而不是乐观更新（乐观更新一旦失败界面就是假的）。
      const addCloudTag = React.useCallback(
        async (tag) => {
          const name = String(tag || '').trim()
          if (name === '' || !detail) return
          setBusy(true)
          try {
            await api('/cloud/tags-add', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ noteId: detail.noteId, tags: [name] }),
            })
            showToast(t('cloud.tagAdded'))
            await openCloudNote(detail)
            await loadFirst()
          } catch (err) {
            onError(err && err.message ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        },
        [detail, loadFirst, onError, openCloudNote, showToast, t],
      )

      const removeCloudTag = React.useCallback(
        async (tag) => {
          if (!detail || !tag) return
          // 服务端删标签要 tag_id，不是名字；列表里可能只有名字，那就先按名字找
          const tagId = tag.id !== undefined && tag.id !== null ? tag.id : tag.name
          setBusy(true)
          try {
            await api('/cloud/tags-delete', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ noteId: detail.noteId, tagId }),
            })
            showToast(t('cloud.tagRemoved'))
            await openCloudNote(detail)
            await loadFirst()
          } catch (err) {
            onError(err && err.message ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        },
        [detail, loadFirst, onError, openCloudNote, showToast, t],
      )

      // ── 分享链接 ────────────────────────────────────────────────────────────
      const shareCloud = React.useCallback(
        async (excludeAudio) => {
          if (!detail) return
          setBusy(true)
          try {
            const result = await api('/cloud/share', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ noteId: detail.noteId, excludeAudio: excludeAudio === true }),
            })
            const url = String(result.url || '')
            if (url !== '') {
              setShareUrl(url)
              // 复制到剪贴板：失败不算错误（有些环境没有剪贴板权限），
              // 链接已经显示在卡片上，用户仍能手动选。
              try {
                await navigator.clipboard.writeText(url)
                showToast(t('cloud.copied'))
              } catch {
                showToast(t('cloud.shareCreated'))
              }
            } else {
              showToast(t('cloud.shareCreated'))
            }
          } catch (err) {
            onError(err && err.message ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        },
        [detail, onError, showToast, t],
      )

      // ── 把这一篇的本地版本推到云端 ──────────────────────────────────────────
      // 危险动作：会覆盖云端正文。所以走「确认 + 明确说明改的是云端」。
      const pushLocalOne = React.useCallback(async () => {
        if (!detail) return
        const localPath = detail.localPath || ''
        if (localPath === '') {
          onError(t('cloud.noLocalCopy'))
          return
        }
        if (!(await confirmDialog(`${t('cloud.pushLocal')}\n\n${t('cloud.pushHint')}`))) return
        setBusy(true)
        try {
          await api('/sync/push', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: localPath }),
          })
          showToast(t('cloud.pushed'))
          await openCloudNote(detail)
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [detail, onError, openCloudNote, showToast, t])

      if (!configured) {
        return h(
          'div',
          { className: 'dshgn_pane' },
          h(
            'div',
            { className: 'dshgn_banner' },
            h(Icon, { name: 'cloud', size: 26 }),
            h('div', { className: 'dshgn_emptyTitle' }, t('cloud.notConfigured')),
            h('div', { className: 'dshgn_emptyDesc' }, t('cloud.notConfiguredDesc')),
          ),
        )
      }

      const shown = recallHits !== null ? recallHits : list

      const listPane = h(
        'div',
        { className: 'dshgn_list' },
        h(
          'div',
          { className: 'dshgn_searchWrap' },
          h(Icon, { name: 'search', size: 14, className: 'dshgn_searchIcon' }),
          h('input', {
            className: 'dshgn_search',
            type: 'search',
            value: query,
            placeholder: t('search.placeholder'),
            onChange: (event) => {
              setQuery(event.target.value)
              // 输入清空就退回普通列表，避免用户以为列表没了
              if (event.target.value.trim() === '') setRecallHits(null)
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter') void doRecall()
            },
          }),
        ),
        // 知识库筛选：云端笔记是按知识库归档的，不提供筛选就只能一路翻页找
        topics !== null && topics.length > 0
          ? h(
              'div',
              { className: 'dshgn_topicRow' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshgn_chip' + (activeTopic === null ? ' dshgn_chipOn' : ''),
                  onClick: () => void pickTopic(null),
                },
                t('cloud.allTopics'),
              ),
              topics.map((topic) =>
                h(
                  'button',
                  {
                    key: topic.topicId || topic.id,
                    type: 'button',
                    className:
                      'dshgn_chip' +
                      (activeTopic !== null && (activeTopic.topicId || activeTopic.id) === (topic.topicId || topic.id)
                        ? ' dshgn_chipOn'
                        : ''),
                    onClick: () => void pickTopic(topic),
                    title: topic.description || topic.name,
                  },
                  topic.name,
                ),
              ),
            )
          : null,
        h(
          'div',
          { className: 'dshgn_rowLine', style: { padding: '4px 10px 8px' } },
          h(
            'button',
            { type: 'button', className: 'dshgn_btn', onClick: doRecall, disabled: recalling || query.trim() === '' },
            recalling ? h('span', { className: 'dshgn_spin' }) : h(Icon, { name: 'search', size: 12 }),
            recallHits !== null ? `语义搜索 (${recallHits.length})` : '语义搜索',
          ),
          h(
            'button',
            { type: 'button', className: 'dshgn_btn', onClick: () => setComposing(true), disabled: busy },
            h(Icon, { name: 'plus', size: 12 }),
            t('cloud.newNote'),
          ),
          recallHits !== null
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dshgn_btn',
                  onClick: () => {
                    setRecallHits(null)
                    void loadFirst()
                  },
                },
                t('action.cancel'),
              )
            : null,
        ),
        h(
          'div',
          { className: 'dshgn_listBody' },
          loading && shown.length === 0
            ? h('div', { className: 'dshgn_empty' }, h('span', { className: 'dshgn_spin' }), h('span', null, t('cloud.loading')))
            : shown.length === 0
              ? h('div', { className: 'dshgn_empty' }, h('div', { className: 'dshgn_emptyTitle' }, t('cloud.empty')))
              : shown.map((note) =>
                  h(
                    'div',
                    {
                      key: note.noteId,
                      className: 'dshgn_card',
                      'data-on': selected !== null && selected.noteId === note.noteId ? 'true' : 'false',
                      onClick: () => void openCloudNote(note, true),
                      title: note.noteId,
                    },
                    h(
                      'div',
                      { className: 'dshgn_cardTitle' },
                      note.hasAudio ? h(Icon, { name: 'audio', size: 11 }) : null,
                      note.title || '(无标题)',
                    ),
                    h(
                      'div',
                      { className: 'dshgn_cardMeta' },
                      note.updatedAt || note.createdAt ? h('span', null, String(note.updatedAt || note.createdAt).slice(0, 10)) : null,
                      note.topics && note.topics[0] ? h('span', null, note.topics[0].name) : null,
                      typeof note.score === 'number' ? h('span', null, note.score.toFixed(2)) : null,
                    ),
                    note.tags.length > 0 ? h('div', { className: 'dshgn_cardExcerpt' }, note.tags.map((x) => x.name).join(' · ')) : null,
                  ),
                ),
        ),
        hasMore && recallHits === null
          ? h(
              'div',
              { style: { padding: '6px 10px 10px' } },
              h('button', { type: 'button', className: 'dshgn_btn', onClick: loadMore, disabled: loading }, loading ? h('span', { className: 'dshgn_spin' }) : null, t('cloud.loadMore')),
            )
          : null,
      )

      const readerPane = h(
        'div',
        { className: 'dshgn_note' },
        composing
          ? h(
              'div',
              { className: 'dshgn_pane' },
              h(
                'div',
                { className: 'dshgn_cardBox' },
                h(
                  'div',
                  { className: 'dshgn_sectionHead' },
                  h('span', { className: 'dshgn_sectionTitle' }, t('cloud.newNote')),
                  activeTopic !== null
                    ? h('span', { className: 'dshgn_badge' }, activeTopic.name)
                    : null,
                ),
                h(
                  'div',
                  { className: 'dshgn_field' },
                  h('span', { className: 'dshgn_fieldLabel' }, t('cloud.newNoteTitle')),
                  h('input', {
                    className: 'dshgn_input',
                    value: newTitle,
                    autoFocus: true,
                    onChange: (event) => setNewTitle(event.target.value),
                  }),
                ),
                h(
                  'div',
                  { className: 'dshgn_field' },
                  h('span', { className: 'dshgn_fieldLabel' }, t('cloud.newNoteBody')),
                  h('textarea', {
                    className: 'dshgn_textarea',
                    value: newBody,
                    onChange: (event) => setNewBody(event.target.value),
                  }),
                ),
                h(
                  'div',
                  { className: 'dshgn_rowLine' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshgn_btn dshgn_btnPri',
                      onClick: createCloudNote,
                      disabled: busy || newTitle.trim() === '',
                    },
                    busy ? h('span', { className: 'dshgn_spin' }) : h(Icon, { name: 'check', size: 12 }),
                    t('cloud.create'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshgn_btn',
                      onClick: () => {
                        setComposing(false)
                        setNewTitle('')
                        setNewBody('')
                      },
                      disabled: busy,
                    },
                    t('action.cancel'),
                  ),
                ),
              ),
            )
          : selected === null
          ? h('div', { className: 'dshgn_empty' }, h(Icon, { name: 'cloud', size: 26 }), h('div', { className: 'dshgn_emptyTitle' }, t('cloud.title')), h('div', { className: 'dshgn_emptyDesc' }, t('cloud.desc')))
          : h(
              React.Fragment,
              null,
              h(
                'div',
                { className: 'dshgn_noteHead' },
                h('div', { className: 'dshgn_notePath' }, selected.title || selected.noteId),
                detail !== null && !editing
                  ? h(
                      React.Fragment,
                      null,
                      h('button', { type: 'button', className: 'dshgn_iconBtn', title: t('action.edit'), onClick: () => setEditing(true), disabled: busy }, h(Icon, { name: 'edit' })),
                      h('button', { type: 'button', className: 'dshgn_iconBtn', title: t('cloud.pullOne'), onClick: pullOne, disabled: busy }, h(Icon, { name: 'up' })),
                      // 把本地改动推到云端：以前只能单向「云端 → 本地」，用户在本地
                      // 改完笔记就没有任何办法把它送回云端，只能去得到大脑里重写一遍。
                      h('button', { type: 'button', className: 'dshgn_iconBtn', title: t('cloud.pushLocal'), onClick: pushLocalOne, disabled: busy }, h(Icon, { name: 'cloud' })),
                      h('button', { type: 'button', className: 'dshgn_iconBtn', title: t('cloud.deleteCloud'), onClick: deleteCloud, disabled: busy }, h(Icon, { name: 'trash' })),
                    )
                  : null,
              ),
              detailLoading
                ? h('div', { className: 'dshgn_emptyState' }, h('span', { className: 'dshgn_spin' }), h('span', { style: { marginLeft: 8 } }, t('cloud.polling')))
                : detail === null
                  ? h('div', { className: 'dshgn_emptyState' }, t('cloud.polling'))
                  : editing
                    ? h(
                        'div',
                        { className: 'dshgn_pane' },
                        h(
                          'div',
                          { className: 'dshgn_cardBox' },
                          h(
                            'div',
                            { className: 'dshgn_field' },
                            h('span', { className: 'dshgn_fieldLabel' }, t('cloud.editTitle')),
                            h('input', { className: 'dshgn_input', value: draftTitle, onChange: (e) => setDraftTitle(e.target.value) }),
                          ),
                          h(
                            'div',
                            { className: 'dshgn_field' },
                            h('span', { className: 'dshgn_fieldLabel' }, t('cloud.editBody')),
                            h('textarea', { className: 'dshgn_textarea', value: draftBody, onChange: (e) => setDraftBody(e.target.value) }),
                          ),
                          h(
                            'div',
                            { className: 'dshgn_rowLine' },
                            h('button', { type: 'button', className: 'dshgn_btn dshgn_btnPri', onClick: saveCloud, disabled: busy }, busy ? h('span', { className: 'dshgn_spin' }) : h(Icon, { name: 'check', size: 12 }), t('cloud.saveCloud')),
                            h('button', { type: 'button', className: 'dshgn_btn', onClick: () => setEditing(false), disabled: busy }, t('action.cancel')),
                          ),
                        ),
                      )
                    : h(
                        'div',
                        { className: 'dshgn_scroll' },
                        h(
                          'div',
                          { className: 'dshgn_md' },
                          h('h1', { className: 'dshgn_h dshgn_h1' }, detail.title || '(无标题)'),
                          detail.tags.length > 0
                            ? h(
                                'div',
                                { className: 'dshgn_rowLine', style: { gap: 6, marginBottom: 12 } },
                                detail.tags.map((tag) =>
                                  h(
                                    'span',
                                    { key: tag.name || tag.id, className: 'dshgn_tagPill' },
                                    tag.name,
                                    // 云端标签可删：用一个极小的 × 而不是整块可点，
                                    // 否则用户想选文字复制时会被误删掉标签。
                                    h(
                                      'button',
                                      {
                                        type: 'button',
                                        className: 'dshgn_tagX',
                                        title: t('cloud.removeTag'),
                                        disabled: busy,
                                        onClick: () => void removeCloudTag(tag),
                                      },
                                      '×',
                                    ),
                                  ),
                                ),
                              )
                            : null,
                          // 加标签：输入框 + 回车。标签是云端的一等数据，能加不能删很别扭，
                          // 所以两个动作都要有。
                          h(
                            'div',
                            { className: 'dshgn_rowLine', style: { gap: 6, marginBottom: 12 } },
                            h('input', {
                              className: 'dshgn_input',
                              style: { maxWidth: 180, height: 26 },
                              value: tagDraft,
                              placeholder: t('cloud.addTagHint'),
                              onChange: (event) => setTagDraft(event.target.value),
                              onKeyDown: (event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  const value = tagDraft
                                  setTagDraft('')
                                  void addCloudTag(value)
                                }
                              },
                            }),
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'dshgn_btn',
                                disabled: busy || tagDraft.trim() === '',
                                onClick: () => {
                                  const value = tagDraft
                                  setTagDraft('')
                                  void addCloudTag(value)
                                },
                              },
                              h(Icon, { name: 'plus', size: 12 }),
                              t('cloud.tags'),
                            ),
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'dshgn_btn',
                                disabled: busy,
                                onClick: () => void shareCloud(false),
                              },
                              h(Icon, { name: 'link', size: 12 }),
                              t('cloud.shareLink'),
                            ),
                          ),
                          // 分享出来的链接直接显示出来，用户能选中复制（剪贴板可能被拒）
                          shareUrl !== null
                            ? h(
                                'div',
                                { className: 'dshgn_section', style: { marginBottom: 12 } },
                                h('div', { className: 'dshgn_sectionTitle' }, t('cloud.shareCreated')),
                                h(
                                  'div',
                                  { className: 'dshgn_rowLine', style: { gap: 6 } },
                                  h('code', { className: 'dshgn_code', style: { wordBreak: 'break-all' } }, shareUrl),
                                  h(
                                    'button',
                                    {
                                      type: 'button',
                                      className: 'dshgn_btn',
                                      onClick: () => {
                                        void navigator.clipboard.writeText(shareUrl).then(
                                          () => showToast(t('cloud.copied')),
                                          () => showToast(t('cloud.shareCreated')),
                                        )
                                      },
                                    },
                                    t('cloud.copyLink'),
                                  ),
                                ),
                              )
                            : null,
                          // 录音优先：用户要的就是「听原声」，所以放在正文之前
                          detail.audio.length > 0
                            ? detail.audio.map((track, index) =>
                                h(AudioPlayer, {
                                  key: `${track.url}-${index}`,
                                  t,
                                  track,
                                  trackIndex: index,
                                  seekRequest,
                                  onTimeChange: (seconds) => setPlayhead(seconds),
                                }),
                              )
                            : null,
                          detail.audio.length > 0 ? h('div', { style: { height: 12 } }) : null,
                          detail.moments.length > 0
                            ? h(
                                'div',
                                { className: 'dshgn_section', style: { marginTop: 12 } },
                                h('div', { className: 'dshgn_sectionTitle' }, t('cloud.moments')),
                                h(
                                  'div',
                                  null,
                                  detail.moments.map((moment, index) =>
                                    h(
                                      'div',
                                      { key: `m-${index}`, className: 'dshgn_moment' },
                                      h('span', { className: 'dshgn_momentAt' }, formatMoment(moment.startMs)),
                                      h('span', null, moment.text),
                                    ),
                                  ),
                                ),
                              )
                            : null,
                          detail.todos.length > 0
                            ? h(
                                'div',
                                { className: 'dshgn_section', style: { marginTop: 12 } },
                                h('div', { className: 'dshgn_sectionTitle' }, t('cloud.todos')),
                                h(
                                  'ul',
                                  { className: 'dshgn_mdList' },
                                  detail.todos.map((todo, index) =>
                                    h(
                                      'li',
                                      { key: `t-${index}`, className: 'dshgn_li' },
                                      h('span', { className: 'dshgn_check' + (todo.completed ? ' dshgn_checkOn' : ''), style: { marginRight: 6 } }),
                                      todo.text,
                                    ),
                                  ),
                                ),
                              )
                            : null,
                          h('div', { style: { height: 12 } }),
                          // 云端正文常常自己就以 `# 同一个标题` 开头，上面已经渲染过 h1 了，
                          // 留着就是「# 时间线」两行一样的大标题。
                          detail.content ? renderMarkdown(stripLeadingHeading(detail.content, detail.title)) : null,
                          detail.hasTranscript && detail.original !== detail.content
                            ? h(
                                React.Fragment,
                                null,
                                h('h2', { className: 'dshgn_h dshgn_h2' }, t('cloud.transcript')),
                                h(TranscriptBlock, {
                                  text: detail.original,
                                  activeSeconds: detail.audio.length > 0 ? playhead : null,
                                  // 没有音轨就没有可跳的目标，别把时间戳做成按了没反应的按钮
                                  onSeek:
                                    detail.audio.length > 0
                                      ? (seconds) => setSeekRequest({ time: seconds, index: 0, at: Date.now() })
                                      : null,
                                }),
                              )
                            : null,
                        ),
                      ),
            ),
      )

      return h('div', { className: 'dshgn_body' }, listPane, readerPane)
    }

    /**
     * 逐字稿：中文口语长文，按「一段一句」排开，时间戳单独占一列。
     *
     * 以前直接塞进 <pre><code>，等宽字体对中文没用（全部回落成宋体），
     * white-space:pre 又不折行，长句被横向裁掉——用户看到的就是「字体太丑」。
     * 这里拆成段落：时间戳固定宽度靠左、说话人跟着、内容自动折行，
     * 段与段之间一条细分隔线，扫起来像剧本，不像日志。
     *
     * 两种来源都要吃得下：
     *   · 云端 note.original 是一行一句 `🟢 说话人1 [00:00:00] 内容`
     *   · 本地归档里的围栏是「时间戳一行、内容下一行」
     * 所以「只有时间戳没有内容」的行要把后面几行收进同一段，否则时间戳会和
     * 它的正文被拆成两个段落，读起来完全对不上。
     */
    /**
     * 逐字稿解析：把「说话人 [mm:ss] 内容」拆成条目。
     *
     * 解析单独拎出来是因为「点时间戳跳转」和「跟着播放高亮」两件事都要用同一份
     * 结果——以前只有渲染逻辑里有这段正则，别人想用还得再抄一遍。
     */
    function parseTranscript(text) {
      const source = String(text || '')
      const entries = []
      for (const raw of source.split('\n')) {
        const line = raw.replace(/\s+$/, '')
        if (line.trim() === '') continue
        const match = /^([^\[]*?)\s*\[([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)\]\s*(.*)$/.exec(line)
        if (match) {
          entries.push({ speaker: match[1].trim(), stamp: match[2], body: match[3] })
          continue
        }
        const last = entries.length > 0 ? entries[entries.length - 1] : null
        if (last !== null && last.stamp !== null) {
          last.body = last.body === '' ? line : `${last.body} ${line}`
        } else {
          entries.push({ speaker: '', stamp: null, body: line })
        }
      }
      return entries
    }

    /** 「01:23」或「1:02:03」→ 秒。认不出返回 null（没时间戳的段落不该可点）。 */
    function stampToSeconds(stamp) {
      const parts = String(stamp || '').split(':').map((piece) => Number(piece))
      if (parts.length < 2 || parts.some((value) => !Number.isFinite(value))) return null
      if (parts.length === 2) return parts[0] * 60 + parts[1]
      return parts[0] * 3600 + parts[1] * 60 + parts[2]
    }

    /** 当前播放到第几段：最后一个「时间戳 ≤ 当前秒数」的条目。 */
    function activeTranscriptIndex(entries, seconds) {
      if (!Array.isArray(entries) || entries.length === 0) return -1
      if (!Number.isFinite(seconds) || seconds <= 0) return -1
      let found = -1
      for (let index = 0; index < entries.length; index += 1) {
        const start = stampToSeconds(entries[index].stamp)
        if (start === null) continue
        if (start <= seconds + 0.25) found = index
        else break
      }
      return found
    }

    function TranscriptBlock(props) {
      const text = String((props && props.text) || '')
      if (text.trim() === '') return null
      const entries = parseTranscript(text)
      if (entries.length === 0) return null
      // onSeek：点时间戳交给上层（有播放器就跳过去，没有就什么也不做）
      const onSeek = props && typeof props.onSeek === 'function' ? props.onSeek : null
      // activeSeconds：播放进度，用来把「正在播的这一段」标出来
      const activeSeconds = props && Number.isFinite(props.activeSeconds) ? props.activeSeconds : null
      const activeIndex = activeSeconds === null ? -1 : activeTranscriptIndex(entries, activeSeconds)
      const t = getT()
      const children = entries.map((entry, index) => {
        const seconds = stampToSeconds(entry.stamp)
        const stampClass = 'dshgn_ts' + (index === activeIndex ? ' dshgn_tsOn' : '')
        // 没有可跳的目标（这篇没有音轨、或者这块是 markdown 围栏里的逐字稿）
        // 就退回普通 span：做成按钮却按了没反应，比不可点更让人困惑。
        const clickable = onSeek !== null && seconds !== null
        const stamp =
          entry.stamp === null
            ? h('span', { className: stampClass })
            : !clickable
              ? h('span', { className: stampClass }, entry.stamp)
              : h(
                'button',
                {
                  type: 'button',
                  className: stampClass + ' dshgn_tsBtn',
                  title: t('cloud.seekTo'),
                  'aria-label': `${t('cloud.seekTo')} ${entry.stamp}`,
                  onClick: () => {
                    if (onSeek !== null && seconds !== null) onSeek(seconds)
                  },
                },
                entry.stamp,
              )
        return h(
          'p',
          { key: `t${index}`, className: index === activeIndex ? 'dshgn_tpOn' : undefined },
          stamp,
          entry.speaker === '' ? null : h('span', { className: 'dshgn_speaker' }, entry.speaker),
          entry.body,
        )
      })
      return h('div', { className: 'dshgn_transcript' }, children)
    }

    /** 围栏里的内容看起来像不像逐字稿：至少两行带 [mm:ss] 时间戳。 */
    function looksLikeTranscript(text) {
      const hits = String(text || '').match(/^\s*[^\[]*\[[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\]/gm)
      return hits !== null && hits.length >= 2
    }

    /** 毫秒 → mm:ss，给时间轴用。 */
    function formatMoment(ms) {
      const total = Math.max(0, Math.round((Number(ms) || 0) / 1000))
      const m = Math.floor(total / 60)
      const s = total % 60
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    }

    // ── 同步面板 ──────────────────────────────────────────────────────────────

    /**
     * 自动同步设置 + 手动触发 + 结果展示。
     *
     * 这里的原则：**默认关**。装个插件就偷偷每 15 分钟联网、吃配额，不是用户
     * 显式点的。打开之后才由 host 侧的定时器跑，关掉时把定时器停掉。
     */
    /**
     * 回收站。
     *
     * 删除笔记一直是「移进 .trash/」，但以前面板上没有任何入口能看见它、更没法恢复——
     * 用户点错删除就只剩下去文件管理器里翻 `.trash` 这一条路。这里把回收站摆出来，
     * 恢复就是把文件搬回库里，清空才是真删。
     */
    // C1 整库备份：导出成一个 zip，导入时逐篇合并、不覆盖已有文件。
    // 放在设置页而不是单独页签——它是「偶尔做一次」的事，不值得占一个常驻入口。
    /**
     * 语言卡片：中文 / English / Nederlands / 自动。
     *
     * 不引 i18n 框架：只有三本字典、几百个键，多一层运行时和一套全新的坑，
     * 换不来什么。
     */
    function LanguageCard(props) {
      const { t, locale, onSaved, onError, onLocaleChange } = props
      const [busy, setBusy] = React.useState(false)

      const options = [
        { id: null, label: t('lang.auto') },
        { id: 'zh', label: '中文' },
        { id: 'en', label: 'English' },
        { id: 'nl', label: 'Nederlands' },
      ]

      const pick = React.useCallback(
        async (next) => {
          if (busy) return
          setBusy(true)
          try {
            await api('/settings', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ uiLocale: next }),
            })
            // 先切本地 state，界面立刻换语言，再把消息按新语言弹出来。
            // 顺序反了的话「已保存」会先用旧语言闪一下再变。
            onLocaleChange(next)
            await onSaved(t('lang.saved'))
          } catch (err) {
            onError(err && err.message ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        },
        [busy, onError, onLocaleChange, onSaved, t],
      )

      return h(
        'div',
        { className: 'dshgn_section' },
        h('div', { className: 'dshgn_sectionHead' }, h('span', null, t('lang.title'))),
        h('div', { className: 'dshgn_sectionDesc' }, t('lang.desc')),
        h(
          'div',
          { className: 'dshgn_langRow' },
          options.map((option) =>
            h(
              'button',
              {
                key: option.id === null ? 'auto' : option.id,
                type: 'button',
                className: 'dshgn_chip' + (locale === option.id ? ' dshgn_chipOn' : ''),
                onClick: () => void pick(option.id),
                disabled: busy,
              },
              option.label,
            ),
          ),
        ),
      )
    }

    /**
     * 跟着宿主切换笔记。
     *
     * 关着的时候面板只看自己那一篇——这是默认。开着之后用户在 Obsidian 里翻到
     * 哪一篇，面板就跟着打开同一篇：反链、同步状态、历史版本立刻跟上，不必再
     * 回命令面板按一次「在得到大脑里打开当前笔记」。
     *
     * 做成一个开关而不是默认行为，是因为面板自己动起来这件事得用户点头：他可能
     * 正拿面板里的一篇跟宿主里的另一篇对照着看，一切换标签页就被顶掉很恼人。
     */
    function FollowCard(props) {
      const { t, status, onSaved, onError } = props
      const [busy, setBusy] = React.useState(false)
      const on = status !== null && status.followActive === true

      const flip = React.useCallback(
        async (next) => {
          if (busy) return
          setBusy(true)
          try {
            await api('/settings', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ followActive: next }),
            })
            await onSaved(t('settings.followSaved'))
          } catch (err) {
            onError(err && err.message ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        },
        [busy, onError, onSaved, t],
      )

      return h(
        'div',
        { className: 'dshgn_section' },
        h('div', { className: 'dshgn_sectionHead' }, h('span', null, t('settings.followTitle'))),
        h('div', { className: 'dshgn_sectionDesc' }, t('settings.followDesc')),
        h(
          'label',
          { className: 'dshgn_rowLine', style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
          h('input', {
            type: 'checkbox',
            checked: on,
            disabled: busy || status === null,
            onChange: (event) => void flip(event.target.checked === true),
          }),
          t('settings.followToggle'),
        ),
      )
    }

    /**
     * 自定义笔记模板。
     *
     * 内置的日记/读书/会议/随手记是写死的，覆盖最常见的四类；但「周报」「复盘」
     * 「课程笔记」这种结构每个人都不同，硬编码进代码只会越堆越乱。这里让用户自己
     * 攒几个，存在设置文件里跟着他走。
     *
     * 交互取舍：不做「加一个立刻保存」，而是先攒在本地草稿里、点一次保存整体提交。
     * 因为每次改动都发一次请求的话，用户删掉一个模板的瞬间界面上那一项会闪一下再
     * 消失（等响应回来）。草稿模式让界面立刻响应，保存失败再整体回滚提示。
     */
    function TemplateCard(props) {
      const { t, status, onSaved, onError } = props
      const [draft, setDraft] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [adding, setAdding] = React.useState(false)
      const [name, setName] = React.useState('')
      const [body, setBody] = React.useState('')

      const saved = React.useMemo(() => {
        const list = status !== null && Array.isArray(status.templates) ? status.templates : []
        return list.filter((item) => item !== null && typeof item === 'object' && typeof item.name === 'string')
      }, [status])

      const list = draft !== null ? draft : saved
      const dirty = draft !== null

      const add = React.useCallback(() => {
        const trimmed = name.trim()
        if (trimmed === '') return
        // 同名直接覆盖：用户看到列表里已经有个同名项，第一反应就是「我要改它」，
        // 再塞一个同名项进去只会让菜单里出现两行分不出区别的条目。
        const next = list.filter((item) => item.name !== trimmed).concat([{ name: trimmed, body }])
        setDraft(next.slice(0, 12))
        setAdding(false)
        setName('')
        setBody('')
      }, [body, list, name])

      const remove = React.useCallback(
        (target) => {
          setDraft(list.filter((item) => item.name !== target))
        },
        [list],
      )

      const save = React.useCallback(async () => {
        if (busy) return
        setBusy(true)
        try {
          await api('/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ templates: draft !== null ? draft : [] }),
          })
          setDraft(null)
          await onSaved(t('settings.templateSaved'))
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [busy, draft, onError, onSaved, t])

      return h(
        'div',
        { className: 'dshgn_section' },
        h(
          'div',
          { className: 'dshgn_sectionHead' },
          h('span', null, t('settings.templateTitle')),
          h('span', { className: 'dshgn_sectionHint' }, `${list.length} / 12`),
        ),
        h('div', { className: 'dshgn_sectionDesc' }, t('settings.templateDesc')),
        list.length === 0
          ? h('div', { className: 'dshgn_emptyRow' }, t('settings.templateEmpty'))
          : h(
              'div',
              { className: 'dshgn_tplList' },
              list.map((item) =>
                h(
                  'div',
                  { key: item.name, className: 'dshgn_tplRow' },
                  h(
                    'div',
                    { className: 'dshgn_tplMain' },
                    h('div', { className: 'dshgn_tplName' }, item.name),
                    h('div', { className: 'dshgn_tplBody' }, item.body || '—'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshgn_rowBtn dshgn_rowBtnDanger',
                      onClick: () => remove(item.name),
                    },
                    t('settings.templateRemove'),
                  ),
                ),
              ),
            ),
        adding
          ? h(
              'div',
              { className: 'dshgn_tplForm' },
              h('input', {
                className: 'dshgn_input',
                value: name,
                placeholder: t('settings.templateName'),
                maxLength: 24,
                onChange: (event) => setName(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    add()
                  } else if (event.key === 'Escape') {
                    setAdding(false)
                  }
                },
              }),
              h('div', { className: 'dshgn_fieldHint' }, t('settings.templateNameHint')),
              h('textarea', {
                className: 'dshgn_textarea',
                value: body,
                placeholder: t('settings.templateBody'),
                rows: 5,
                maxLength: 4000,
                onChange: (event) => setBody(event.target.value),
              }),
              h('div', { className: 'dshgn_fieldHint' }, t('settings.templateBodyHint')),
              h(
                'div',
                { className: 'dshgn_btnRow' },
                h(
                  'button',
                  { type: 'button', className: 'dshgn_btn dshgn_btnPri', onClick: add, disabled: name.trim() === '' },
                  t('settings.templateAdd'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'dshgn_btn', onClick: () => setAdding(false) },
                  t('action.cancel'),
                ),
              ),
            )
          : h(
              'div',
              { className: 'dshgn_btnRow' },
              h(
                'button',
                { type: 'button', className: 'dshgn_btn', onClick: () => setAdding(true), disabled: list.length >= 12 },
                t('settings.templateAdd'),
              ),
              h(
                'button',
                { type: 'button', className: 'dshgn_btn dshgn_btnPri', onClick: () => void save(), disabled: busy || !dirty },
                t('settings.templateSave'),
              ),
            ),
      )
    }

    /**
     * 录音卡直连面板。
     *
     * 设计取向：这是一条「绕过云端」的通道，用户最关心的是三件事——能不能连上、
     * 卡上还有什么、导进来之后卡片会不会被清掉。所以界面上把「环境自检」放在最上面
     * （连不上要第一时间说清是缺 Python 还是卡片没开机），把「删原件」这个不可逆
     * 开关单独拎出来默认关着，且打开时要再确认一次。
     */
    function CardPane(props) {
      const { t, status, showToast, onError, onChanged } = props
      const [env, setEnv] = React.useState(null)
      const [envBusy, setEnvBusy] = React.useState(false)
      const [scanning, setScanning] = React.useState(false)
      const [found, setFound] = React.useState(null)
      const [files, setFiles] = React.useState(null)
      const [listBusy, setListBusy] = React.useState(false)
      const [dir, setDir] = React.useState('')
      const [deleteAfter, setDeleteAfter] = React.useState(false)
      const [run, setRun] = React.useState(null)
      const timerRef = React.useRef(null)
      // 热点快传：这三块状态分开存，因为它们回答三个不同的问题——
      // 「本机现在在哪个网上」「卡片热点开了没有」「连上之后有没有找到传输服务」。
      // 混成一个就分不清失败在哪一步。
      const [wifiNet, setWifiNet] = React.useState(null)
      const [wifiBusy, setWifiBusy] = React.useState(false)
      const [wifiHot, setWifiHot] = React.useState(null)
      const [wifiManual, setWifiManual] = React.useState({ ssid: '', password: '' })

      const checkEnv = React.useCallback(async () => {
        setEnvBusy(true)
        try {
          const json = await api('/card/env')
          setEnv(json)
          return json
        } catch (err) {
          setEnv({ ready: false, error: err && err.message ? err.message : String(err) })
          return null
        } finally {
          setEnvBusy(false)
        }
      }, [])

      React.useEffect(() => {
        void checkEnv()
      }, [checkEnv])

      // 导入跑起来之后轮询进度；组件卸载或跑完就停，别在后台空转。
      React.useEffect(() => {
        if (run === null || run.running !== true) {
          if (timerRef.current !== null) {
            window.clearInterval(timerRef.current)
            timerRef.current = null
          }
          return undefined
        }
        if (timerRef.current !== null) return undefined
        timerRef.current = window.setInterval(() => {
          void api('/card/status')
            .then((json) => {
              setRun(json)
              if (json.running !== true) {
                if (json.error) onError(json.error)
                else if (json.result) {
                  showToast(`${t('card.imported')}：${json.result.downloaded}`)
                  void onChanged()
                }
              }
            })
            .catch(() => {
              /* 轮询抖动不打扰用户，下一拍会自己恢复 */
            })
        }, 1200)
        return () => {
          if (timerRef.current !== null) {
            window.clearInterval(timerRef.current)
            timerRef.current = null
          }
        }
      }, [run, onChanged, onError, showToast, t])

      const doScan = React.useCallback(async () => {
        setScanning(true)
        setFound(null)
        try {
          const json = await api('/card/scan?timeout=8')
          setFound(json)
          if (Array.isArray(json.cards) && json.cards.length > 0) {
            showToast(`${t('card.scanFound')}：${json.cards.length}`)
            void checkEnv()
          } else {
            onError(t('card.scanNone'))
          }
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setScanning(false)
        }
      }, [checkEnv, onError, showToast, t])

      const loadList = React.useCallback(async () => {
        setListBusy(true)
        try {
          const json = await api('/card/list')
          setFiles(Array.isArray(json.files) ? json.files : [])
        } catch (err) {
          setFiles([])
          onError(err && err.message ? err.message : String(err))
        } finally {
          setListBusy(false)
        }
      }, [onError])

      const startImport = React.useCallback(async () => {
        if (deleteAfter) {
          const ok = await confirmDialog(
            '导入成功后会把卡片上的原件永久删掉，不能恢复。确定要这样吗？',
          )
          if (!ok) return
        }
        try {
          const json = await api('/card/import', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ all: true, dir, deleteAfter }),
          })
          if (json.ok !== true) {
            onError(json.error || t('card.alreadyRunning'))
            return
          }
          setRun({ running: true, lines: [] })
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        }
      }, [deleteAfter, dir, onError, t])

      // ── 热点快传 ──
      //
      // 卡片自己的热点没有互联网。一旦连上去，浏览器、同步、什么都打不开，
      // 用户很容易以为「插件把网弄断了」。所以每个动作结束后都立刻把本机网络
      // 状况读回来显示在界面上，并且「退出」按钮任何时候都在。
      const wifiRefresh = React.useCallback(async () => {
        try {
          const json = await api('/card/wifi-scan')
          setWifiNet(json)
          return json
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
          return null
        }
      }, [onError])

      React.useEffect(() => {
        void wifiRefresh()
      }, [wifiRefresh])

      const wifiGo = React.useCallback(async () => {
        setWifiBusy(true)
        setWifiHot(null)
        try {
          const json = await api('/card/wifi-activate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ join: true }),
          })
          setWifiHot(json)
          if (json && json.ok === true && json.hotspot) {
            showToast(`${t('card.wifiOn')}：${json.hotspot}`)
          } else if (json && json.ok === true) {
            onError(t('card.wifiNoHotspot'))
          } else {
            onError((json && json.error) || t('card.wifiFail'))
          }
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setWifiBusy(false)
          void wifiRefresh()
        }
      }, [onError, showToast, t, wifiRefresh])

      const wifiJoinManual = React.useCallback(async () => {
        const ssid = wifiManual.ssid.trim()
        if (ssid === '') {
          onError(t('card.wifiNeedSsid'))
          return
        }
        setWifiBusy(true)
        setWifiHot(null)
        try {
          const json = await api('/card/wifi-join', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              ssid,
              password: wifiManual.password === '' ? null : wifiManual.password,
              // 手动连接时留着热点：用户是主动在试，连完可能还要再点一次。
              keep: true,
            }),
          })
          setWifiHot(json)
          if (json && json.ok === true) showToast(`${t('card.wifiOn')}：${ssid}`)
          else onError((json && json.error) || t('card.wifiFail'))
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setWifiBusy(false)
          void wifiRefresh()
        }
      }, [onError, showToast, t, wifiManual, wifiRefresh])

      const wifiOff = React.useCallback(async () => {
        setWifiBusy(true)
        try {
          const json = await api('/card/wifi-leave', { method: 'POST' })
          setWifiHot(null)
          if (json && json.ok === true) showToast(t('card.wifiLeft'))
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setWifiBusy(false)
          void wifiRefresh()
        }
      }, [onError, showToast, t, wifiRefresh])

      const ready = env !== null && env.ready === true
      const running = run !== null && run.running === true
      const result = run !== null ? run.result : null
      const lines = run !== null && Array.isArray(run.lines) ? run.lines : []

      return h(
        'div',
        { className: 'dshgn_pane' },
        h(
          'div',
          { className: 'dshgn_paneInner' },
          h('h2', { className: 'dshgn_h dshgn_h2' }, t('card.title')),
          h('div', { className: 'dshgn_paneDesc' }, t('card.desc')),

          // ── 环境自检 ──
          h(
            'div',
            { className: 'dshgn_section' },
            h(
              'div',
              { className: 'dshgn_sectionHead' },
              h('span', null, t('card.envBridge')),
              h(
                'span',
                {
                  className:
                    'dshgn_badge ' + (ready ? 'dshgn_badgeOk' : 'dshgn_badgeWarn'),
                },
                ready ? t('card.envOk') : t('card.envMissing'),
              ),
            ),
            env === null
              ? h('div', { className: 'dshgn_sectionDesc' }, '…')
              : h(
                  'div',
                  { className: 'dshgn_sectionDesc' },
                  ready
                    ? `Python ${env.python || '?'} · bleak ${env.bleak || '?'}`
                    : t('card.envHint'),
                ),
            !ready && env !== null && env.error
              ? h('pre', { className: 'dshgn_log' }, String(env.error))
              : null,
            h(
              'div',
              { className: 'dshgn_row' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshgn_btn',
                  onClick: () => void checkEnv(),
                  disabled: envBusy,
                },
                t('card.envBridge'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshgn_btn',
                  onClick: () => void doScan(),
                  disabled: scanning || !ready,
                },
                scanning ? t('card.scanning') : t('card.scan'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshgn_btn',
                  onClick: () => void loadList(),
                  disabled: listBusy || !ready,
                },
                t('card.refresh'),
              ),
            ),
            found !== null && Array.isArray(found.cards)
              ? h(
                  'div',
                  { className: 'dshgn_sectionDesc' },
                  found.cards.length === 0
                    ? t('card.scanNone')
                    : found.cards
                        .map((card) => `${card.name || '?'} (${card.address || ''})`)
                        .join('  ·  '),
                )
              : null,
          ),

          // ── 热点快传 ──
          //
          // 放在「卡片上的录音」前面：传一小时录音，BLE 要四十多分钟，走热点
          // 通常一两分钟。先让人看到这条快路，再去纠结导哪几个文件。
          h(
            'div',
            { className: 'dshgn_section' },
            h(
              'div',
              { className: 'dshgn_sectionHead' },
              h('span', null, t('card.wifiTitle')),
              wifiNet !== null && wifiNet.current
                ? h('span', { className: 'dshgn_badge' }, wifiNet.current)
                : null,
            ),
            h('div', { className: 'dshgn_sectionDesc' }, t('card.wifiDesc')),
            // 连上之后必须一眼看到「现在挂在卡片热点上」——不然用户会以为断网。
            wifiNet !== null && wifiNet.cardLike && wifiNet.cardLike.length > 0
              ? h(
                  'div',
                  { className: 'dshgn_sectionDesc' },
                  `${t('card.wifiAvailable')}：${wifiNet.cardLike.join('  ·  ')}`,
                )
              : null,
            h(
              'div',
              { className: 'dshgn_row' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshgn_btn dshgn_btnPri',
                  onClick: () => void wifiGo(),
                  disabled: wifiBusy || !ready,
                },
                wifiBusy ? t('card.wifiBusy') : t('card.wifiGo'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshgn_btn',
                  onClick: () => void wifiRefresh(),
                  disabled: wifiBusy,
                },
                t('card.wifiRescan'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshgn_btn',
                  onClick: () => void wifiOff(),
                  disabled: wifiBusy,
                },
                t('card.wifiOff'),
              ),
            ),
            // 连上了但没找到服务，或者卡片热点名/密码拿不到时，手输是最后一条路。
            h(
              'div',
              { className: 'dshgn_row' },
              h('input', {
                className: 'dshgn_input',
                value: wifiManual.ssid,
                placeholder: t('card.wifiSsid'),
                onChange: (event) =>
                  setWifiManual({ ssid: event.target.value, password: wifiManual.password }),
              }),
              h('input', {
                className: 'dshgn_input',
                value: wifiManual.password,
                placeholder: t('card.wifiPassword'),
                onChange: (event) =>
                  setWifiManual({ ssid: wifiManual.ssid, password: event.target.value }),
              }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshgn_btn',
                  onClick: () => void wifiJoinManual(),
                  disabled: wifiBusy || !ready,
                },
                t('card.wifiJoin'),
              ),
            ),
            wifiHot !== null && wifiHot.ok === true
              ? h(
                  'div',
                  { className: 'dshgn_sectionDesc' },
                  [
                    wifiHot.hotspot ? `${t('card.wifiHotspot')}：${wifiHot.hotspot}` : null,
                    wifiHot.ip ? `IP ${wifiHot.ip}` : null,
                    Array.isArray(wifiHot.openPorts) && wifiHot.openPorts.length > 0
                      ? `${t('card.wifiPorts')}：${wifiHot.openPorts.join(', ')}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join('  ·  ') || '—',
                )
              : null,
            // 探测到的传输服务：面板不给下载按钮（协议还没对上），但把路径摊开，
            // 让人能自己去 curl 一下看是什么。
            wifiHot !== null && Array.isArray(wifiHot.hits) && wifiHot.hits.length > 0
              ? h(
                  'div',
                  { className: 'dshgn_fileList' },
                  wifiHot.hits.map((hit, index) =>
                    h(
                      'div',
                      { key: `${hit.path || index}`, className: 'dshgn_fileRow' },
                      h('span', { className: 'dshgn_fileName' }, hit.path || '?'),
                      h(
                        'span',
                        { className: 'dshgn_fileMeta' },
                        `${hit.status || '?'} · ${formatBytes(hit.bytes || 0)}`,
                      ),
                    ),
                  ),
                )
              : null,
          ),

          // ── 卡片上的录音 ──
          h(
            'div',
            { className: 'dshgn_section' },
            h(
              'div',
              { className: 'dshgn_sectionHead' },
              h('span', null, t('card.pending')),
              files === null
                ? null
                : h('span', { className: 'dshgn_badge' }, String(files.length)),
            ),
            files === null
              ? h('div', { className: 'dshgn_sectionDesc' }, '—')
              : files.length === 0
                ? h('div', { className: 'dshgn_sectionDesc' }, t('card.none'))
                : h(
                    'div',
                    { className: 'dshgn_fileList' },
                    files.map((file, index) =>
                      h(
                        'div',
                        { key: `${file.name || index}`, className: 'dshgn_fileRow' },
                        h('span', { className: 'dshgn_fileName' }, file.name || '?'),
                        h('span', { className: 'dshgn_fileMeta' }, formatBytes(file.size || 0)),
                      ),
                    ),
                  ),
          ),

          // ── 导入 ──
          h(
            'div',
            { className: 'dshgn_section' },
            h('div', { className: 'dshgn_sectionHead' }, h('span', null, t('card.import'))),
            h('div', { className: 'dshgn_field' },
              h('div', { className: 'dshgn_fieldLabel' }, t('card.dir')),
              h('input', {
                className: 'dshgn_input',
                value: dir,
                placeholder: '录音卡',
                onChange: (event) => setDir(event.target.value),
              }),
              h('div', { className: 'dshgn_fieldHint' }, t('card.dirHint')),
            ),
            // 删原件是唯一不可逆的操作，所以单独一行、默认关、开关旁写清后果。
            h(
              'label',
              { className: 'dshgn_checkRow' },
              h('input', {
                type: 'checkbox',
                checked: deleteAfter,
                onChange: (event) => setDeleteAfter(event.target.checked),
              }),
              h('span', null, t('card.deleteAfter')),
            ),
            h('div', { className: 'dshgn_fieldHint' }, t('card.deleteAfterHint')),
            h(
              'div',
              { className: 'dshgn_row' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshgn_btn dshgn_btnPri',
                  onClick: () => void startImport(),
                  disabled: running || !ready,
                },
                running ? t('card.importing') : t('card.import'),
              ),
            ),
            lines.length > 0
              ? h('pre', { className: 'dshgn_log' }, lines.join('\n'))
              : null,
            result !== null
              ? h(
                  'div',
                  { className: 'dshgn_statGrid' },
                  h('div', { className: 'dshgn_stat' },
                    h('div', { className: 'dshgn_statNum' }, String(result.downloaded || 0)),
                    h('div', { className: 'dshgn_statLabel' }, t('card.downloaded'))),
                  h('div', { className: 'dshgn_stat' },
                    h('div', { className: 'dshgn_statNum' }, String(result.skipped || 0)),
                    h('div', { className: 'dshgn_statLabel' }, t('card.skipped'))),
                  h('div', { className: 'dshgn_stat' },
                    h('div', { className: 'dshgn_statNum' }, String(result.failed || 0)),
                    h('div', { className: 'dshgn_statLabel' }, t('card.failed'))),
                )
              : null,
          ),
        ),
      )
    }

    function ArchiveCard(props) {
      const { t, status, onChanged, onError, showToast } = props
      const [info, setInfo] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [importMode, setImportMode] = React.useState('rename')
      // 导出范围：整库 / 只要文字 / 只要附件。附件常常比笔记大两个数量级，
      // 只想备份文字的人不该每次等几百兆。
      const [exportScope, setExportScope] = React.useState('all')
      const fileRef = React.useRef(null)

      React.useEffect(() => {
        let alive = true
        void api('/archive/info')
          .then((json) => {
            if (alive) setInfo(json)
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [])

      // 用 a[download] 触发下载而不是 window.open：桌面版里 window.open
      // 常被拦，而带 download 属性的锚点点击在 Electron 里是可靠的。
      const exportZip = React.useCallback(async () => {
        setBusy(true)
        try {
          const suffix = exportScope === 'notes' ? '-文字' : exportScope === 'assets' ? '-附件' : ''
          const url = withToken(`${apiOrigin()}/getnote/archive/export?scope=${encodeURIComponent(exportScope)}`)
          const name = '得到大脑归档' + suffix + '-' + new Date().toISOString().slice(0, 10) + '.zip'
          // 宿主能弹保存框就走它（用户能选位置），否则退回 a[download]。
          const saved = await saveFile(url, name)
          if (saved) {
            showToast(t('archive.exported'))
            return
          }
          const doc = panelDocument()
          if (doc === null || !doc.body) return
          const anchor = doc.createElement('a')
          anchor.href = url
          anchor.download = name
          doc.body.appendChild(anchor)
          anchor.click()
          doc.body.removeChild(anchor)
          showToast(t('archive.exporting'))
        } finally {
          // 下载是浏览器接管的，这边没法知道何时完成，给一个短延迟就恢复
          window.setTimeout(() => setBusy(false), 1200)
        }
      }, [exportScope, showToast, t])

      const doImport = React.useCallback(
        async (file) => {
          if (!file) return
          setBusy(true)
          try {
            const buffer = await file.arrayBuffer()
            const response = await fetch(`${apiOrigin()}/getnote/archive/import`, {
              method: 'POST',
              headers: {
                'content-type': 'application/zip',
                'x-getnote-import-mode': importMode,
                ...(__apiToken === '' ? {} : { 'x-getnote-token': __apiToken }),
              },
              body: buffer,
            })
            const json = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`)
            showToast(`${t('archive.imported')} ${json.written || 0} / ${json.skipped || 0}`)
            if (typeof onChanged === 'function') await onChanged()
          } catch (err) {
            onError(err && err.message ? err.message : String(err))
          } finally {
            setBusy(false)
            if (fileRef.current) fileRef.current.value = ''
          }
        },
        [importMode, onChanged, onError, showToast, t],
      )

      return h(
        'div',
        { className: 'dshgn_section' },
        h(
          'div',
          { className: 'dshgn_sectionHead' },
          h('div', { className: 'dshgn_sectionTitle' }, t('archive.title')),
          h(
            'div',
            { className: 'dshgn_rowLine', style: { gap: 6 } },
            h(
              'select',
              {
                className: 'dshgn_input dshgn_selectSm',
                value: exportScope,
                title: t('archive.scope'),
                'aria-label': t('archive.scope'),
                onChange: (event) => setExportScope(event.target.value),
                disabled: busy,
              },
              h('option', { value: 'all' }, t('archive.scopeAll')),
              h('option', { value: 'notes' }, t('archive.scopeNotes')),
              h('option', { value: 'assets' }, t('archive.scopeAssets')),
            ),
            h(
              'button',
              { type: 'button', className: 'dshgn_btn dshgn_btnPri', onClick: exportZip, disabled: busy },
              h(Icon, { name: 'up', size: 12 }),
              t('archive.export'),
            ),
            h(
              'button',
              { type: 'button', className: 'dshgn_btn', onClick: () => fileRef.current && fileRef.current.click(), disabled: busy },
              h(Icon, { name: 'folder', size: 12 }),
              t('archive.import'),
            ),
            h('input', {
              ref: fileRef,
              type: 'file',
              accept: '.zip,application/zip',
              style: { display: 'none' },
              onChange: (event) => void doImport(event.target.files && event.target.files[0]),
            }),
          ),
        ),
        h('div', { className: 'dshgn_sectionDesc' }, t('archive.desc')),
        info !== null
          ? h(
              'div',
              { className: 'dshgn_fieldHint' },
              `${info.notes} 篇 · ${formatBytes(info.bytes)}${info.assetCount > 0 ? ` · 附件 ${info.assetCount} 个 ${formatBytes(info.assetBytes)}` : ''}`,
            )
          : null,
        h(
          'label',
          { className: 'dshgn_rowLine', style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
          t('archive.importMode'),
          ['rename', 'skip'].map((mode) =>
            h(
              'button',
              {
                key: mode,
                type: 'button',
                className: 'dshgn_chip' + (importMode === mode ? ' dshgn_chipOn' : ''),
                onClick: () => setImportMode(mode),
                disabled: busy,
              },
              t(`archive.mode.${mode}`),
            ),
          ),
        ),
      )
    }

    // B2 冲突比对：同步时「两边都改过」的情况，插件会把本地版另存到
    // .conflicts/ 而正文写云端版。原来用户只能在文件管理器里翻那个目录，
    // 这里给并排比对 + 一键采纳任意一边。
    function ConflictPane(props) {
      const { t, status, onChanged, onError, showToast } = props
      const [items, setItems] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [detail, setDetail] = React.useState(null)
      // 比对视图的呈现方式：默认渲染成 Markdown（和笔记页一致），
      // 想抠空格差异时切「原文」。不给开关的话默认值只能二选一，
      // 而这两种需求都真实存在。
      const [diffMode, setDiffMode] = React.useState('rendered')
      // 「已处理」区默认折叠：处理完的东西是归档，不是待办。默认展开的话
      // 用户每次进来都要先滚过一堆已经决定过的条目才能看到真正要处理的。
      const [resolvedOpen, setResolvedOpen] = React.useState(false)

      const load = React.useCallback(async () => {
        setLoading(true)
        try {
          const result = await api('/conflict/list')
          setItems(Array.isArray(result.items) ? result.items : [])
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setLoading(false)
        }
      }, [onError])

      React.useEffect(() => {
        void load()
      }, [load])

      const openDetail = React.useCallback(
        async (item) => {
          setBusy(true)
          try {
            const result = await api(`/conflict/read?path=${encodeURIComponent(item.path)}`)
            setDetail(result)
          } catch (err) {
            onError(err && err.message ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        },
        [onError],
      )

      const resolve = React.useCallback(
        async (keepLocal) => {
          if (detail === null) return
          setBusy(true)
          try {
            const result = await api('/conflict/resolve', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ path: detail.path, keepLocal }),
            })
            showToast(keepLocal ? t('conflict.keptLocal') : t('conflict.tookCloud'))
            // 选完自动回到冲突主列表（用户明确要求）：对比页是为「做决定」
            // 存在的，决定完了就该退出去，否则他还得自己点一次返回。
            setDetail(null)
            await load()
            if (typeof onChanged === 'function') await onChanged()
            return result
          } catch (err) {
            onError(err && err.message ? err.message : String(err))
            return null
          } finally {
            setBusy(false)
          }
        },
        [detail, load, onChanged, onError, showToast, t],
      )

      // 退回「未处理」：改主意是这功能最正常的用法，没有它就只能去文件系统
      // 删 .resolved.json 才能把条目捞回待办区。
      const undo = React.useCallback(async () => {
        if (detail === null) return
        setBusy(true)
        try {
          await api('/conflict/unresolve', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: detail.path }),
          })
          showToast(t('conflict.undone'))
          try {
            const fresh = await api(`/conflict/read?path=${encodeURIComponent(detail.path)}`)
            setDetail(fresh)
          } catch {
            setDetail(null)
          }
          await load()
          if (typeof onChanged === 'function') await onChanged()
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [detail, load, onChanged, onError, showToast, t])

      const list = items === null ? [] : items
      const pendingItems = list.filter((item) => item.resolved !== true)
      const resolvedItems = list.filter((item) => item.resolved === true)

      const renderRow = (item) =>
        h(
          'div',
          {
            key: item.path,
            className: 'dshgn_rowLine',
            style: {
              justifyContent: 'space-between',
              padding: '7px 0',
              borderBottom: '0.5px solid var(--dsw-alias-border-l1)',
            },
          },
          h(
            'div',
            { style: { minWidth: 0 } },
            h(
              'div',
              { className: 'dshgn_cardTitle', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              item.originalName,
            ),
            h(
              'div',
              { className: 'dshgn_cardMeta' },
              `${formatTime(item.savedAt)} · ${formatBytes(item.bytes)}` +
                (item.resolved === true
                  ? ` · ${item.keptLocal === true ? t('conflict.pickedLocal') : t('conflict.pickedCloud')}`
                  : ''),
            ),
          ),
          h(
            'button',
            { type: 'button', className: 'dshgn_btn dshgn_btnPri', onClick: () => void openDetail(item), disabled: busy },
            item.resolved === true ? t('conflict.review') : t('conflict.compare'),
          ),
        )

      if (detail !== null) {
        // 两侧都用和「笔记」「云端」页同一套 Markdown 渲染，而不是铺原始文本。
        // 冲突留档里带着 YAML frontmatter 和围栏逐字稿，裸文本读起来像在看配置文件，
        // 用户要比对的是内容差异，不是缩进字符。想抠空格时切到「原文」还能看回去。
        // 两边的真实来源由 host 明确给出，不要在这里靠名字猜：
        //   · detail.archiveIsCloud === false → 留档装的是**我本地写的那版**，正本是云端版
        //   · detail.archiveIsCloud === true  → 留档装的是**云端版**（早期抢救副本），正本是本地版
        // 曾经这里按「留档=本地、正本=云端」硬套，遇到带 cloud- 前缀的旧留档就整列反了。
        const archiveText = detail.body !== undefined && detail.body !== null ? detail.body : detail.content
        const liveText =
          detail.local === null || detail.local === undefined
            ? null
            : detail.local.body !== undefined && detail.local.body !== null
              ? detail.local.body
              : detail.local.content
        const archiveIsCloud = detail.archiveIsCloud === true
        const localBody = archiveIsCloud ? liveText : archiveText
        const cloudBody = archiveIsCloud ? archiveText : liveText
        const sideBlock = (body, emptyText) =>
          body === null
            ? h('div', { className: 'dshgn_diffEmpty' }, emptyText)
            : diffMode === 'raw'
              ? h('pre', { className: 'dshgn_diffBody' }, body)
              : h('div', { className: 'dshgn_diffBody dshgn_diffMd' }, renderBlocks(body, { assets: [] }))

        return h(
          'div',
          { className: 'dshgn_pane' },
          h(
            'div',
            { className: 'dshgn_section' },
            h(
              'div',
              { className: 'dshgn_sectionHead' },
              h('div', { className: 'dshgn_sectionTitle' }, t('conflict.compare')),
              h(
                'div',
                { className: 'dshgn_rowLine', style: { gap: 6 } },
                // 三个按钮统一用浅色系：比对页的主角是左右两栏正文，按钮太饱和
                // 会抢注意力。未处理时两个采纳按钮都是红描边（提醒要决定），
                // 已经选过哪边就填成浅色——这个填充是「当初选了谁」的持久记号，
                // 重新打开这条冲突时依然在。
                h(
                  'button',
                  {
                    type: 'button',
                    className:
                      'dshgn_btn ' +
                      (detail.keptLocal === true
                        ? 'dshgn_btnPale'
                        : detail.keptLocal === false
                          ? 'dshgn_btnWarn'
                          : 'dshgn_btnWarn'),
                    onClick: () => void resolve(true),
                    disabled: busy,
                  },
                  t('conflict.keepLocal'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className:
                      'dshgn_btn ' + (detail.keptLocal === false ? 'dshgn_btnPale' : 'dshgn_btnWarn'),
                    onClick: () => void resolve(false),
                    disabled: busy,
                  },
                  t('conflict.takeCloud'),
                ),
                h('button', { type: 'button', className: 'dshgn_btn', onClick: () => setDetail(null), disabled: busy }, t('conflict.back')),
                // 已处理的条目给一个「退回未处理」：改主意是这个功能最正常的
                // 用法，没有它就只能去文件系统删 .resolved.json。
                detail.resolved === true &&
                  h(
                    'button',
                    { type: 'button', className: 'dshgn_btn', onClick: () => void undo(), disabled: busy },
                    t('conflict.undo'),
                  ),
              ),
            ),
            h(
              'div',
              { className: 'dshgn_sectionDesc', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h('span', null, detail.originalName),
              h('span', { className: 'dshgn_dot' }, '·'),
              h('span', null, t('conflict.savedAt')),
              h('span', null, formatTime(detail.savedAt)),
              h(
                'div',
                { className: 'dshgn_rowLine', style: { gap: 4, marginLeft: 'auto' } },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshgn_chip' + (diffMode === 'rendered' ? ' dshgn_chipOn' : ''),
                    onClick: () => setDiffMode('rendered'),
                  },
                  t('conflict.modeRendered'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshgn_chip' + (diffMode === 'raw' ? ' dshgn_chipOn' : ''),
                    onClick: () => setDiffMode('raw'),
                  },
                  t('conflict.modeRaw'),
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'dshgn_diffRow' },
            h(
              'div',
              { className: 'dshgn_diffCol' },
              h('div', { className: 'dshgn_diffHead' }, t('conflict.sideLocal')),
              sideBlock(localBody, t('conflict.noLocal')),
            ),
            h(
              'div',
              { className: 'dshgn_diffCol' },
              h('div', { className: 'dshgn_diffHead' }, t('conflict.sideCloud')),
              sideBlock(cloudBody, t('conflict.noCloud')),
            ),
          ),
        )
      }

      return h(
        'div',
        { className: 'dshgn_pane' },
        h(
          'div',
          { className: 'dshgn_section' },
          h(
            'div',
            { className: 'dshgn_sectionHead' },
            h('div', { className: 'dshgn_sectionTitle' }, t('tab.conflict')),
            h(
              'button',
              { type: 'button', className: 'dshgn_btn', onClick: () => void load(), disabled: loading || busy },
              loading ? h('span', { className: 'dshgn_spin' }) : h(Icon, { name: 'refresh', size: 12 }),
              t('action.refresh'),
            ),
          ),
          h('div', { className: 'dshgn_sectionDesc' }, t('conflict.desc')),
        ),
        loading && list.length === 0
          ? h('div', { className: 'dshgn_emptyState' }, h('span', { className: 'dshgn_spin' }))
          : list.length === 0
            ? h(
                'div',
                { className: 'dshgn_empty' },
                h(Icon, { name: 'check', size: 24 }),
                h('div', { className: 'dshgn_emptyTitle' }, t('conflict.empty')),
                h('div', { className: 'dshgn_emptyDesc' }, t('conflict.emptyHint')),
              )
            : h(
                'div',
                { className: 'dshgn_cardBox' },
                // 未处理区：直接铺开，这就是用户进来要看的东西。
                pendingItems.length === 0
                  ? h(
                      'div',
                      { className: 'dshgn_empty' },
                      h(Icon, { name: 'check', size: 24 }),
                      h('div', { className: 'dshgn_emptyTitle' }, t('conflict.empty')),
                      h('div', { className: 'dshgn_emptyDesc' }, t('conflict.emptyHint')),
                    )
                  : pendingItems.map(renderRow),
                // 已处理区：默认折叠。这些是「已经决定过」的归档，留着是为了
                // 能反悔和复查，不该占据一进页面就能看到的视觉重心。
                resolvedItems.length > 0 &&
                  h(
                    'div',
                    null,
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dshgn_foldHead',
                        onClick: () => setResolvedOpen((prev) => !prev),
                      },
                      h(
                        'span',
                        { className: 'dshgn_foldArrow', 'data-open': resolvedOpen ? 'true' : 'false' },
                        h(Icon, { name: 'chevron', size: 12 }),
                      ),
                      h('span', null, t('conflict.resolvedSection')),
                      h('span', { className: 'dshgn_foldCount' }, String(resolvedItems.length)),
                    ),
                    resolvedOpen && resolvedItems.map(renderRow),
                  ),
              ),
      )
    }

    /**
     * 断链体检：把全库「写了双链但库里没有这一篇」的地方摊成一张清单。
     *
     * 点一行直接打开出问题的那一篇——用户要改的是那一行字，不是这条记录。
     * 行号留着是为了在长笔记里能对上位置（面板没有「跳到第 N 行」，
     * 所以把它当路标写在旁边）。
     */
    function BrokenPane(props) {
      const { t, status, onError, onOpen } = props
      const [hits, setHits] = React.useState(null)
      const [scanned, setScanned] = React.useState(0)
      const [truncated, setTruncated] = React.useState(false)
      const [loading, setLoading] = React.useState(false)

      const load = React.useCallback(async () => {
        setLoading(true)
        try {
          const result = await api('/broken')
          setHits(Array.isArray(result.hits) ? result.hits : [])
          setScanned(Number(result.scanned) || 0)
          setTruncated(result.truncated === true)
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setLoading(false)
        }
      }, [onError])

      React.useEffect(() => {
        void load()
      }, [load])

      const list = hits === null ? [] : hits
      const summary = t('broken.found').replace('{n}', String(list.length)).replace('{scanned}', String(scanned))

      return h(
        'div',
        { className: 'dshgn_pane' },
        h(
          'div',
          { className: 'dshgn_section' },
          h(
            'div',
            { className: 'dshgn_sectionHead' },
            h('div', { className: 'dshgn_sectionTitle' }, t('tab.broken')),
            h(
              'button',
              { type: 'button', className: 'dshgn_btn', onClick: () => void load(), disabled: loading },
              loading ? h('span', { className: 'dshgn_spin' }) : h(Icon, { name: 'refresh', size: 12 }),
              t('action.refresh'),
            ),
          ),
          h('div', { className: 'dshgn_sectionDesc' }, t('broken.desc')),
          hits !== null && list.length > 0 ? h('div', { className: 'dshgn_sectionDesc' }, summary) : null,
          truncated ? h('div', { className: 'dshgn_sectionDesc' }, t('broken.truncated')) : null,
        ),
        loading && list.length === 0
          ? h('div', { className: 'dshgn_emptyState' }, h('span', { className: 'dshgn_spin' }))
          : list.length === 0
            ? h(
                'div',
                { className: 'dshgn_empty' },
                h(Icon, { name: 'check', size: 24 }),
                h('div', { className: 'dshgn_emptyTitle' }, t('broken.empty')),
                h('div', { className: 'dshgn_emptyDesc' }, t('broken.emptyHint')),
              )
            : h(
                'div',
                { className: 'dshgn_cardBox' },
                list.map((hit) =>
                  h(
                    'button',
                    {
                      key: `${hit.path}#${hit.line}#${hit.target}`,
                      type: 'button',
                      className: 'dshgn_brokenRow',
                      title: hit.path,
                      onClick: () => {
                        if (typeof onOpen === 'function') onOpen(hit.path)
                      },
                    },
                    h('span', { className: 'dshgn_brokenTarget' }, hit.target),
                    h('span', { className: 'dshgn_brokenWhere' }, `${hit.title || hit.path} · ${t('broken.line')} ${hit.line}`),
                    hit.text === '' ? null : h('span', { className: 'dshgn_brokenSnip' }, hit.text),
                  ),
                ),
              ),
      )
    }

    function TrashPane(props) {
      const { t, status, onChanged, onError, showToast } = props
      const [items, setItems] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [busy, setBusy] = React.useState(false)

      const load = React.useCallback(async () => {
        setLoading(true)
        try {
          const result = await api('/trash/list')
          setItems(Array.isArray(result.items) ? result.items : [])
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setLoading(false)
        }
      }, [onError])

      React.useEffect(() => {
        void load()
      }, [load])

      const restore = React.useCallback(
        async (item) => {
          setBusy(true)
          try {
            const result = await api('/trash/restore', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ path: item.path }),
            })
            showToast(`${t('trash.restored')}${result && result.path ? '：' + result.path : ''}`)
            await load()
            if (typeof onChanged === 'function') await onChanged()
          } catch (err) {
            onError(err && err.message ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        },
        [load, onChanged, onError, showToast, t],
      )

      const purgeOne = React.useCallback(
        async (item) => {
          if (!(await confirmDialog(t('trash.purgeOneConfirm')))) return
          setBusy(true)
          try {
            await api('/trash/purge', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ path: item.path }),
            })
            showToast(t('trash.purged'))
            await load()
            if (typeof onChanged === 'function') await onChanged()
          } catch (err) {
            onError(err && err.message ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        },
        [load, onChanged, onError, showToast, t],
      )

      const purgeAll = React.useCallback(async () => {
        if (!(await confirmDialog(t('trash.purgeConfirm')))) return
        setBusy(true)
        try {
          await api('/trash/purge', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          })
          showToast(t('trash.purged'))
          await load()
          if (typeof onChanged === 'function') await onChanged()
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [load, onChanged, onError, showToast, t])

      const list = items === null ? [] : items

      return h(
        'div',
        { className: 'dshgn_pane' },
        h(
          'div',
          { className: 'dshgn_section' },
          h(
            'div',
            { className: 'dshgn_sectionHead' },
            h('div', { className: 'dshgn_sectionTitle' }, t('tab.trash')),
            h(
              'div',
              { className: 'dshgn_rowLine', style: { gap: 6 } },
              h(
                'button',
                { type: 'button', className: 'dshgn_btn', onClick: () => void load(), disabled: loading || busy },
                loading ? h('span', { className: 'dshgn_spin' }) : h(Icon, { name: 'refresh', size: 12 }),
                t('action.refresh'),
              ),
              h(
                'button',
                { type: 'button', className: 'dshgn_btn dshgn_btnDanger', onClick: purgeAll, disabled: busy || list.length === 0 },
                h(Icon, { name: 'trash', size: 12 }),
                t('trash.purgeAll'),
              ),
            ),
          ),
          h('div', { className: 'dshgn_sectionDesc' }, t('trash.desc')),
        ),
        loading && list.length === 0
          ? h('div', { className: 'dshgn_emptyState' }, h('span', { className: 'dshgn_spin' }))
          : list.length === 0
            ? h(
                'div',
                { className: 'dshgn_empty' },
                h(Icon, { name: 'trash', size: 24 }),
                h('div', { className: 'dshgn_emptyTitle' }, t('trash.empty')),
                h('div', { className: 'dshgn_emptyDesc' }, t('trash.emptyHint')),
              )
            : h(
                'div',
                { className: 'dshgn_cardBox' },
                list.map((item) =>
                  h(
                    'div',
                    { key: item.path, className: 'dshgn_rowLine', style: { justifyContent: 'space-between', padding: '7px 0', borderBottom: '0.5px solid var(--dsw-alias-border-l1)' } },
                    h(
                      'div',
                      { style: { minWidth: 0 } },
                      h('div', { className: 'dshgn_cardTitle', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.title || item.originalName),
                      h(
                        'div',
                        { className: 'dshgn_cardMeta' },
                        `${t('trash.deletedAt')} ${formatTime(item.trashedAt)} · ${formatBytes(item.bytes)}`,
                      ),
                    ),
                    h(
                      'div',
                      { className: 'dshgn_rowLine', style: { gap: 6, flex: 'none' } },
                      h(
                        'button',
                        { type: 'button', className: 'dshgn_btn dshgn_btnPri', onClick: () => void restore(item), disabled: busy },
                        h(Icon, { name: 'up', size: 12 }),
                        t('trash.restore'),
                      ),
                      h(
                        'button',
                        { type: 'button', className: 'dshgn_btn dshgn_btnDanger', onClick: () => void purgeOne(item), disabled: busy },
                        t('trash.purgeOne'),
                      ),
                    ),
                  ),
                ),
              ),
      )
    }

    function SyncPane(props) {
      const { t, status, onChanged, onError, showToast } = props
      const configured = status !== null && status.api !== undefined && status.api.configured === true
      const auto = status !== null && status.autoSync ? status.autoSync : { enabled: false, minutes: 15, incremental: true }

      const [enabled, setEnabled] = React.useState(auto.enabled === true)
      const [minutes, setMinutes] = React.useState(auto.minutes || 15)
      const [incremental, setIncremental] = React.useState(auto.incremental !== false)
      // 仅前台运行：笔记本合上、DSH 窗口最小化之后还在后台跑同步，既浪费
      // 云端配额（读 1000/天）也没人看结果，所以给个开关让用户自己决定。
      const [foregroundOnly, setForegroundOnly] = React.useState(auto.foregroundOnly === true)
      const [fullScan, setFullScan] = React.useState(false)
      const [running, setRunning] = React.useState(auto.running === true)
      const [lastResult, setLastResult] = React.useState(auto.lastResult || null)
      const [lastError, setLastError] = React.useState(auto.lastError || null)
      const [busy, setBusy] = React.useState(false)

      // 同步是一个后台任务：开跑之后轮询到结束，用户就不用自己刷新
      React.useEffect(() => {
        if (!running) return undefined
        const timer = window.setInterval(async () => {
          try {
            const state = await api('/sync/status')
            if (state.running !== true) {
              setRunning(false)
              setLastResult(state.lastResult || null)
              setLastError(state.lastError || null)
              if (typeof onChanged === 'function') await onChanged()
            }
          } catch {
            // 轮询失败就等下一轮，不要因为一次网络抖动就把界面报错
          }
        }, 1200)
        return () => window.clearInterval(timer)
      }, [running, onChanged])

      const persist = React.useCallback(
        async (next) => {
          try {
            await api('/sync/auto', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(next),
            })
            if (typeof onChanged === 'function') await onChanged()
          } catch (err) {
            onError(err && err.message ? err.message : String(err))
          }
        },
        [onChanged, onError],
      )

      const toggle = React.useCallback(() => {
        const next = !enabled
        setEnabled(next)
        void persist({ enabled: next, minutes, incremental })
        showToast(next ? `${t('sync.enabled')} · ${minutes}${t('sync.minutes')}` : t('sync.enabled'))
      }, [enabled, minutes, incremental, persist, showToast, t])

      const changeMinutes = React.useCallback(
        (value) => {
          const parsed = Number(value)
          if (!Number.isFinite(parsed)) return
          const clamped = Math.min(Math.max(Math.round(parsed), 5), 720)
          setMinutes(clamped)
          if (enabled) void persist({ enabled: true, minutes: clamped, incremental })
        },
        [enabled, incremental, persist],
      )

      const runNow = React.useCallback(async () => {
        setBusy(true)
        setLastError(null)
        try {
          await api('/sync/start', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ full: fullScan }),
          })
          setRunning(true)
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [fullScan, onError])

      // 反向同步（本地 → 云端）的批量版：离线写了一批之后，一篇篇右键推太笨。
      // 服务端只推「本地指纹和上次同步记下的不一样」的笔记，所以反复点也不会
      // 把整库刷一遍。
      const [pushReport, setPushReport] = React.useState(null)
      const pushAll = React.useCallback(async () => {
        if (!(await confirmDialog(`${t('sync.pushAll')}\n\n${t('sync.pushAllHint')}`))) return
        setBusy(true)
        setLastError(null)
        try {
          const json = await api('/sync/push-all', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ dir: '', limit: 200 }),
          })
          setPushReport(json)
          showToast(`${t('sync.pushAllDone')}：${json.pushed}`)
          if (typeof onChanged === 'function') await onChanged()
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [onChanged, onError, showToast, t])

      const resultStats = lastResult
        ? [
            { label: t('sync.pulled'), num: lastResult.pulled ?? 0 },
            { label: t('sync.skipped'), num: lastResult.skipped ?? 0 },
            { label: t('sync.adopted'), num: lastResult.adopted ?? 0 },
            { label: t('sync.conflicts'), num: lastResult.conflicts ?? 0 },
            { label: t('sync.deleted'), num: lastResult.deleted ?? 0 },
            { label: t('sync.errors'), num: lastResult.errors ?? 0 },
          ]
        : []

      // 自动同步原来是独立页签，现在收进「设置」页当几张卡片。不再自己套
      // dshgn_pane / dshgn_cardBox —— 外层已经由 SettingsPane 提供，重复套一层
      // 会多出一圈内边距和一条独立的滚动区，这张卡看起来就跟旁边的不像一伙的。
      // 顺带一个好处：设置页不打开时这个组件根本不挂载，下面那个 1200ms 轮询
      // 也就不会在后台空转。
      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'dshgn_section' },
          h('div', { className: 'dshgn_sectionTitle' }, t('sync.title')),
          h('div', { className: 'dshgn_sectionDesc' }, t('sync.desc')),
          h(
            'div',
            { className: 'dshgn_toggleRow' },
            h(
              'div',
              { className: 'dshgn_toggleLabel' },
              h('span', { className: 'dshgn_toggleTitle' }, t('sync.enabled')),
              h(
                'span',
                { className: 'dshgn_toggleDesc' },
                status !== null && status.api && status.api.lastRunAt ? `${t('sync.lastRun')}: ${formatTime(status.api.lastRunAt)}` : `${t('sync.lastRun')}: ${t('sync.never')}`,
              ),
            ),
            h('button', {
              type: 'button',
              className: 'dshgn_toggle',
              'data-on': enabled ? 'true' : 'false',
              onClick: toggle,
              disabled: !configured,
              'aria-label': t('sync.enabled'),
            }),
          ),
          h(
            'div',
            { className: 'dshgn_rowLine' },
            h('span', { className: 'dshgn_fieldLabel' }, t('sync.interval')),
            h('input', {
              className: 'dshgn_input',
              style: { flex: 'none', width: 76 },
              type: 'number',
              min: 5,
              max: 720,
              step: 5,
              value: minutes,
              onChange: (e) => changeMinutes(e.target.value),
              disabled: !configured,
            }),
            h('span', { className: 'dshgn_fieldHint' }, t('sync.minutes')),
            [5, 15, 60].map((preset) =>
              h(
                'button',
                {
                  key: preset,
                  type: 'button',
                  className: 'dshgn_chip' + (minutes === preset ? ' dshgn_chipOn' : ''),
                  onClick: () => changeMinutes(preset),
                  disabled: !configured,
                },
                `${preset}${t('sync.minutes')}`,
              ),
            ),
          ),
          h(
            'label',
            { className: 'dshgn_rowLine', style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
            h('input', {
              type: 'checkbox',
              checked: incremental,
              onChange: (e) => {
                setIncremental(e.target.checked)
                void persist({ enabled, minutes, incremental: e.target.checked })
              },
              disabled: !configured,
            }),
            t('sync.incremental'),
          ),
          h(
            'label',
            { className: 'dshgn_rowLine', style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
            h('input', {
              type: 'checkbox',
              checked: foregroundOnly,
              onChange: (e) => {
                setForegroundOnly(e.target.checked)
                void persist({ enabled, minutes, incremental, foregroundOnly: e.target.checked })
              },
              disabled: !configured,
            }),
            t('sync.foregroundOnly'),
          ),
          h('div', { className: 'dshgn_fieldHint' }, t('sync.foregroundHint')),
          h('div', { className: 'dshgn_fieldHint' }, t('sync.quotaHint')),
        ),
        h(
          'div',
          { className: 'dshgn_section' },
          h(
            'div',
            { className: 'dshgn_rowLine' },
            h('button', { type: 'button', className: 'dshgn_btn dshgn_btnPri', onClick: runNow, disabled: busy || running || !configured }, running ? h('span', { className: 'dshgn_spin' }) : h(Icon, { name: 'sync', size: 12 }), running ? t('sync.running') : t('sync.now')),
            h('button', { type: 'button', className: 'dshgn_btn', onClick: pushAll, disabled: busy || running || !configured, title: t('sync.pushAllHint') }, t('sync.pushAll')),
            h(
              'label',
              { className: 'dshgn_rowLine', style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
              h('input', { type: 'checkbox', checked: fullScan, onChange: (e) => setFullScan(e.target.checked), disabled: !configured }),
              t('sync.fullScan'),
            ),
          ),
          !configured ? h('div', { className: 'dshgn_fieldHint' }, t('cloud.notConfiguredDesc')) : null,
          lastError !== null ? h('div', { className: 'dshgn_error' }, lastError) : null,
          resultStats.length > 0 ? h('div', { className: 'dshgn_statGrid' }, resultStats.map((s) => h('div', { key: s.label, className: 'dshgn_stat' }, h('span', { className: 'dshgn_statNum' }, String(s.num)), h('span', { className: 'dshgn_statLabel' }, s.label)))) : null,
          pushReport !== null
            ? h(
                'div',
                { className: 'dshgn_fieldHint' },
                `${t('sync.pushAllDone')}：${t('sync.pushAllPushed')} ${pushReport.pushed}，${t('sync.pushAllSkipped')} ${pushReport.skipped}${pushReport.failed > 0 ? `，${t('sync.pushAllFailed')} ${pushReport.failed}` : ''}${pushReport.truncated ? `（${t('sync.pushAllTruncated')}）` : ''}`,
              )
            : null,
          lastResult !== null && lastResult.at ? h('div', { className: 'dshgn_fieldHint' }, `${t('sync.result')}: ${formatTime(lastResult.at)}`) : null,
        ),
        h(LegacyImport),
      )

      /** 旧的一次性导入：只在没配 API Key 时作为兜底暴露出来。 */
      function LegacyImport() {
        const [open, setOpen] = React.useState(false)
        if (configured || !open) {
          return h(
            'div',
            { className: 'dshgn_rowLine', style: { justifyContent: 'center' } },
            h('button', { type: 'button', className: 'dshgn_btn', onClick: () => setOpen(true) }, t('sync.legacy')),
            h('span', { className: 'dshgn_fieldHint' }, t('sync.legacyHint')),
          )
        }
        return h(ImportPane, {
          t,
          status,
          onRefresh: async () => {
            if (typeof onChanged === 'function') await onChanged()
          },
          onDone: () => {
            if (typeof onChanged === 'function') void onChanged()
          },
        })
      }
    }


    // 骨架屏：首次打开面板时 /status 与 /tree 还没回来，原来是一片空白，
    // 用户会以为插件没加载出来。骨架把三栏形状先画出来，内容到了再替换——
    // 空白和「有形状但还没内容」给人的确定感完全不同。
    function SkeletonPane(props) {
      const { t } = props
      const row = (width, height) => h('div', { className: 'dshgn_skRow', style: { width, height } })
      return h(
        'div',
        { className: 'dshgn_body', 'aria-busy': 'true', 'aria-label': t('panel.loading') },
        h(
          'div',
          { className: 'dshgn_tree dshgn_skTree' },
          row('60%', '10px'),
          row('82%', '10px'),
          row('70%', '10px'),
          row('76%', '10px'),
          row('54%', '10px'),
        ),
        h(
          'div',
          { className: 'dshgn_list dshgn_skList' },
          h(
            'div',
            { className: 'dshgn_skCard' },
            row('72%', '12px'),
            row('40%', '9px'),
            row('92%', '9px'),
          ),
          h(
            'div',
            { className: 'dshgn_skCard' },
            row('58%', '12px'),
            row('34%', '9px'),
            row('86%', '9px'),
          ),
          h(
            'div',
            { className: 'dshgn_skCard' },
            row('66%', '12px'),
            row('46%', '9px'),
            row('80%', '9px'),
          ),
        ),
        h(
          'section',
          { className: 'dshgn_note dshgn_skNote' },
          row('46%', '18px'),
          row('100%', '10px'),
          row('96%', '10px'),
          row('88%', '10px'),
          row('100%', '10px'),
          row('72%', '10px'),
        ),
      )
    }

    // 写作热力图（移动端首页那张的本地版）。
    //
    // 移动端要打 /notes/heatmap 才能画，本地版完全离线：日期本来就在文件名或
    // frontmatter 里。这正好是「本地优先」的一个可见证据——会员到期之后，
    // 这张图照样一天不少。
    //
    // 只显示最近 16 周：左栏只有 200px 出头，26 周会把格子挤到 5px 看不出深浅。
    // 16 周 × 9px = 144px，留得下，也够看出「最近是不是在坚持」。
    function HeatmapStrip(props) {
      const { t, heatmap } = props
      if (heatmap === null || heatmap === undefined || !Array.isArray(heatmap.days) || heatmap.days.length === 0) {
        return null
      }
      const WEEKS = 16
      const days = heatmap.days.slice(-(WEEKS * 7))
      // 分档而不是连续插值：格子只有 7px，连续色阶在这么小的面积上根本分不出来，
      // 反而让人以为渲染坏了。五档足够表达「没写 / 写了一点 / 写得很多」。
      const level = (count) => {
        if (count <= 0) return 0
        if (count === 1) return 1
        if (count === 2) return 2
        if (count <= 4) return 3
        return 4
      }
      return h(
        'div',
        { className: 'dshgn_heat' },
        h(
          'div',
          { className: 'dshgn_heatHead' },
          h('span', { className: 'dshgn_heatTitle' }, t('heat.title')),
          h(
            'span',
            { className: 'dshgn_heatStat', title: `${heatmap.total} ${t('heat.totalHint')}` },
            `${heatmap.streak} ${t('heat.streak')}`,
          ),
        ),
        h(
          'div',
          { className: 'dshgn_heatGrid', style: { gridTemplateRows: 'repeat(7, 1fr)', gridAutoFlow: 'column' } },
          days.map((day) =>
            h('span', {
              key: day.date,
              className: 'dshgn_heatCell',
              'data-lv': String(level(day.count)),
              'data-future': day.future === true ? 'true' : 'false',
              title: `${day.date} · ${day.count} ${t('heat.unit')}`,
            }),
          ),
        ),
      )
    }

    // 三栏宽度的上下限。左栏放「目录 / 标签」两段，再窄就挤得只剩省略号；
    // 中栏要放标题 + 日期 + 摘要三行，200 是能读的下限。
    // 列表一次渲染多少条。一屏大约 8~10 张卡片，60 条足够滚两三屏，
    // 又不至于把几千个 DOM 节点一次性建出来。
    const LIST_PAGE_SIZE = 60
    const TREE_MIN_W = 150
    const TREE_MAX_W = 360
    const LIST_MIN_W = 200
    const LIST_MAX_W = 520
    const COL_WIDTH_KEY = 'dshgn.colWidths'

    /**
     * 读回上次拖出来的栏宽。
     *
     * 存 localStorage 而不是 host 设置：纯展示偏好，不涉及数据，也没必要为它
     * 多一个接口。隐私模式下读不到就回落默认值，不影响使用。
     */
    function readColWidths() {
      const fallback = { tree: 204, list: 260 }
      try {
        const raw = window.localStorage.getItem(COL_WIDTH_KEY)
        if (raw === null) return fallback
        const parsed = JSON.parse(raw)
        const num = (value, min, max, def) => {
          const n = Number(value)
          return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : def
        }
        return {
          tree: num(parsed && parsed.tree, TREE_MIN_W, TREE_MAX_W, fallback.tree),
          list: num(parsed && parsed.list, LIST_MIN_W, LIST_MAX_W, fallback.list),
        }
      } catch {
        return fallback
      }
    }

    function writeColWidths(widths) {
      try {
        window.localStorage.setItem(COL_WIDTH_KEY, JSON.stringify(widths))
      } catch {
        // 存不了就这次先用着，下次打开回落默认值
      }
    }

    // 上次看到哪儿了：哪个页签、哪个目录、哪个标签、开着哪一篇。
    //
    // Obsidian 关掉再开是很常见的事（重启、切库、关掉这个叶子又拉回来），
    // 每次回来都从「笔记 / 全部 / 没打开任何一篇」开始，等于让人重新找一遍
    // 刚才的位置。这跟栏宽是同一类东西——纯界面状态，存 localStorage 就够，
    // 不必为它多一个设置接口。
    //
    // 只存路径不存正文：正文可能已经被别处改过（同步、宿主编辑器、另一个
    // 窗口），恢复时重新走一遍 /read 才是当下真实的内容。
    const SESSION_KEY = 'dshgn.session'
    const SESSION_TABS = ['notes', 'cloud', 'settings', 'card', 'conflict', 'broken', 'trash']

    function readSession() {
      const empty = { tab: '', dir: '', tag: '', path: '' }
      try {
        const raw = window.localStorage.getItem(SESSION_KEY)
        if (raw === null) return empty
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return empty
        const str = (value) => (typeof value === 'string' ? value : '')
        const tab = str(parsed.tab)
        return {
          tab: SESSION_TABS.includes(tab) ? tab : '',
          dir: str(parsed.dir),
          tag: str(parsed.tag),
          path: str(parsed.path),
        }
      } catch {
        // 隐私模式 / 存的是上一版的旧结构：当作没有，从默认位置开始
        return empty
      }
    }

    function writeSession(patch) {
      try {
        const prev = readSession()
        window.localStorage.setItem(SESSION_KEY, JSON.stringify({ ...prev, ...patch }))
      } catch {
        // 存不了就这次先用着
      }
    }

    /**
     * 三栏之间的拖拽手柄。
     *
     * 用 pointer 事件而不是 mouse：触控板、触屏、鼠标走同一条路径，而且
     * setPointerCapture 之后指针移出手柄（拖快了很常见）仍能继续收到事件，
     * 不用在 window 上挂监听再自己拆。
     *
     * 用 <button> 而不是 <div>：键盘用户能 Tab 到它，再用左右方向键调宽。
     */
    function ColSplitter(props) {
      const { label, value, min, max, onChange } = props

      const clamp = (n) => Math.max(min, Math.min(max, Math.round(n)))

      const onPointerDown = (event) => {
        if (typeof event.button === 'number' && event.button !== 0) return
        const startX = event.clientX
        const base = value
        const el = event.currentTarget
        try {
          el.setPointerCapture(event.pointerId)
        } catch {
          // 没有指针捕获也能拖，只是移出手柄就断
        }
        el.classList.add('dshgn_splitterOn')
        const move = (moveEvent) => onChange(clamp(base + (moveEvent.clientX - startX)))
        const stop = () => {
          el.classList.remove('dshgn_splitterOn')
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', stop)
          el.removeEventListener('pointercancel', stop)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', stop)
        el.addEventListener('pointercancel', stop)
        event.preventDefault()
      }

      const onKeyDown = (event) => {
        const step = event.shiftKey ? 32 : 8
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onChange(clamp(value - step))
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          onChange(clamp(value + step))
        }
      }

      return h('button', {
        type: 'button',
        className: 'dshgn_splitter',
        'aria-label': label,
        'aria-orientation': 'vertical',
        title: label,
        onPointerDown,
        onKeyDown,
      })
    }

    function TreePane(props) {
      const {
        t,
        tree,
        dirs,
        entries,
        activeDir,
        activeTag,
        tagCounts,
        dirSort,
        tagSort,
        onDirSortChange,
        onTagSortChange,
        onPickDir,
        onPickTag,
        onCreateDir,
        onDeleteDir,
        onDeleteTag,
        onCreateTag,
        onRenameTag,
        heatmap,
        currentNoteId,
        onNarrowPick,
      } = props
      const total = Array.isArray(entries) ? entries.length : 0
      // 窄窗口里左栏是浮在列表上的抽屉，选完就该消失，不然它一直盖着结果。
      // 宽窗口下 CSS 根本没把左栏做成抽屉，这个回调也就没人调用。
      const picked = (fn) => (arg) => {
        fn(arg)
        if (typeof onNarrowPick === 'function') onNarrowPick()
      }

      // 右键菜单与二次确认：菜单是「删除」这一项，点它之后才弹确认框。
      // 两步是刻意的——右键菜单里直接删，手一抖就没了；而弹窗里再点一次
      // 「删除」这个动作本身有分量，用户会停下来看一眼删的是什么。
      const [menu, setMenu] = React.useState(null) // {kind:'dir'|'tag', name}
      const [confirm, setConfirm] = React.useState(null) // {kind, name}
      const [creating, setCreating] = React.useState(null) // 'dir' | 'tag'
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      // 标签改名：{from, to} 非空时那一行变成输入框。
      // 不做成弹窗是因为改名要边看原名边打字，弹窗会挡住标签云本身。
      const [renaming, setRenaming] = React.useState(null)

      // 点空白处关菜单：右键菜单不会自己消失是最烦人的一类小毛病
      React.useEffect(() => {
        if (menu === null) return undefined
        const close = () => setMenu(null)
        const offClick = attachOnPanelWindows('click', close)
        const offScroll = attachOnPanelWindows('scroll', close, true)
        return () => {
          offClick()
          offScroll()
        }
      }, [menu])

      // 行内菜单只记「被右键的是哪一项」，不记鼠标坐标。
      // 早先用 position:fixed + clientX/clientY 让菜单跟着鼠标，结果菜单飘到很远——
      // .dshgn_body 上挂了 animation ... both，动画播完后 transform 仍保留，
      // 而带 transform 的祖先会成为 position:fixed 的包含块，坐标基准从视口变成了
      // .dshgn_body 的左上角。与其去算偏移，不如把按钮直接放在那一行里。
      const openMenu = (event, kind, name) => {
        event.preventDefault()
        event.stopPropagation()
        setMenu({ kind, name })
      }

      // 扁平化目录树（缩进按层级），比折叠树更适合窄侧栏：一屏看全库结构。
      // 排序在这里做而不是让 host 排：三种排序都是纯前端视角，多跑一趟
      // 请求只为换个顺序不值当，而且切换要立刻生效不能等网络。
      const flat = React.useMemo(() => {
        // 「按修改时间」用的是目录下最新一篇的 mtime：目录本身没有 mtime 的
        // 语义（建完就不动了），而用户想找的是「我最近在动的那个目录」。
        const latest = (path) => {
          let max = 0
          for (const entry of entries) {
            if (entry.path === path || entry.path.startsWith(`${path}/`)) {
              if (entry.mtimeMs > max) max = entry.mtimeMs
            }
          }
          return max
        }
        const compare = (a, b) => {
          if (dirSort === 'name') return a.name.localeCompare(b.name, 'zh')
          if (dirSort === 'count') return b.count - a.count || a.name.localeCompare(b.name, 'zh')
          return latest(b.path) - latest(a.path) || a.name.localeCompare(b.name, 'zh')
        }
        const list = []
        // 必须在**同一层内部**排序：对整个扁平列表排一次会把子目录排到
        // 别的父目录的兄弟节点中间，缩进层级看着就乱了（随手记/子目录
        // 跑到 索引 前面）。这里逐层排完再深度优先展开。
        const walk = (node, depth) => {
          const dirsOnly = (node.children || []).filter((child) => child.kind === 'dir')
          dirsOnly.sort(compare)
          for (const child of dirsOnly) {
            list.push({ path: child.path, name: child.name, depth, count: child.count })
            walk(child, depth + 1)
          }
        }
        if (tree) walk(tree, 0)
        // 兜底：树为空但条目有目录（扫描被截断时）
        if (list.length === 0 && Array.isArray(dirs)) {
          const fallback = []
          for (const dir of dirs) {
            if (dir === '') continue
            fallback.push({ path: dir, name: dir, depth: 0, count: entries.filter((e) => e.path.startsWith(`${dir}/`)).length })
          }
          fallback.sort(compare)
          list.push(...fallback)
        }
        return list
      }, [tree, dirs, entries, dirSort])

      const sortedTags = React.useMemo(() => {
        const copy = [...tagCounts]
        if (tagSort === 'name') {
          copy.sort((a, b) => a[0].localeCompare(b[0], 'zh'))
        } else if (tagSort === 'count') {
          copy.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
        } else {
          const latest = (tag) => {
            let max = 0
            for (const entry of entries) {
              if ((entry.tags || []).includes(tag) && entry.mtimeMs > max) max = entry.mtimeMs
            }
            return max
          }
          copy.sort((a, b) => latest(b[0]) - latest(a[0]) || a[0].localeCompare(b[0], 'zh'))
        }
        return copy
      }, [tagCounts, entries, tagSort])

      const runCreate = async () => {
        const name = draft.trim()
        if (name === '') {
          setCreating(null)
          return
        }
        setBusy(true)
        try {
          if (creating === 'dir') await onCreateDir(name)
          else await onCreateTag(name)
          setCreating(null)
          setDraft('')
        } finally {
          setBusy(false)
        }
      }

      const runDelete = async () => {
        if (confirm === null) return
        setBusy(true)
        try {
          if (confirm.kind === 'dir') await onDeleteDir(confirm.name)
          else await onDeleteTag(confirm.name)
          setConfirm(null)
        } finally {
          setBusy(false)
        }
      }

      const runRename = async () => {
        if (renaming === null) return
        const to = String(renaming.to || '').trim()
        if (to === '' || to === renaming.from) {
          setRenaming(null)
          return
        }
        setBusy(true)
        try {
          if (typeof onRenameTag === 'function') await onRenameTag(renaming.from, to)
          setRenaming(null)
        } finally {
          setBusy(false)
        }
      }

      // 行内删除/取消：直接画在被右键的那一行里，不弹浮层。
      // 用户的原话是「删除键离我要删的东西很远」——浮层哪怕只偏一点，
      // 眼睛也要在「我点的那一项」和「按钮在哪」之间来回找一次；
      // 放在同一行里，指向关系不用解释。
      const rowMenu = () => {
        const target = menu
        if (target === null) return null
        return h(
          'span',
          { className: 'dshgn_rowMenu', onClick: (event) => event.stopPropagation() },
          // 标签多一个「改名」。目录不需要：目录名就是磁盘上的文件夹名，
          // 改名等于移动文件，风险比改个标签大得多，那是另一个功能。
          target.kind === 'tag' && typeof onRenameTag === 'function'
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dshgn_rowBtn',
                  title: t('tree.menuRename'),
                  onClick: () => {
                    setRenaming({ from: target.name, to: target.name })
                    setMenu(null)
                  },
                },
                h(Icon, { name: 'edit', size: 11 }),
                h('span', null, t('tree.menuRename')),
              )
            : null,
          // 「在文件列表里定位」：面板的列表是平的，用户想知道这个目录在库里
          // 的哪儿、旁边还有什么时，把它交给宿主的文件列表比自己解释路径直观。
          // 只给目录：标签不是文件，宿主那边没有可定位的东西。
          target.kind === 'dir' && hasRevealInVault()
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dshgn_rowBtn',
                  title: t('tree.menuReveal'),
                  onClick: () => {
                    revealInVault(target.name)
                    setMenu(null)
                  },
                },
                h(Icon, { name: 'external-link', size: 11 }),
                h('span', null, t('tree.menuReveal')),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'dshgn_rowBtn dshgn_rowBtnDanger',
              title: target.kind === 'dir' ? t('tree.deleteDir') : t('tree.deleteTag'),
              onClick: () => {
                setConfirm({ kind: target.kind, name: target.name })
                setMenu(null)
              },
            },
            h(Icon, { name: 'trash', size: 11 }),
            h('span', null, t('tree.menuDelete')),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dshgn_rowBtn',
              title: t('tree.menuCancel'),
              onClick: () => setMenu(null),
            },
            h(Icon, { name: 'close', size: 11 }),
            h('span', null, t('tree.menuCancel')),
          ),
        )
      }

      // 标题行右侧的动作组：排序 + 「+」。
      // 「+」与标题文字之间留出 flex:1 的空隙，不贴着标题——贴着的话视觉上
      // 像是标题的一部分，用户不会想到那是个按钮。
      // 排序开关按 kind 取各自的状态：目录与标签的排序互不影响。
      const headActions = (kind, label, canCreate) => {
        const mode = kind === 'dir' ? dirSort : tagSort
        const setMode = kind === 'dir' ? onDirSortChange : onTagSortChange
        const nextMode = mode === 'time' ? 'name' : mode === 'name' ? 'count' : 'time'
        return h(
          'div',
          { className: 'dshgn_treeHeadRight' },
          h(
            'button',
            {
              type: 'button',
              className: 'dshgn_treeSort',
              title: `${t('tree.sort')}：${t(`tree.sort${mode === 'time' ? 'Time' : mode === 'name' ? 'Name' : 'Count'}`)}`,
              onClick: () => setMode(nextMode),
            },
            mode === 'time' ? '⏱' : mode === 'name' ? 'A→Z' : '#',
          ),
          canCreate
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dshgn_treeAdd',
                  title: label,
                  'aria-label': label,
                  onClick: () => {
                    setCreating(kind)
                    setDraft('')
                  },
                },
                h(Icon, { name: 'plus', size: 12 }),
              )
            : null,
        )
      }

      return h(
        'aside',
        { className: 'dshgn_tree' },
        h(
          'div',
          {
            className: 'dshgn_treeRow',
            'data-on': activeDir === '' && activeTag === '' ? 'true' : 'false',
            onClick: picked(() => onPickDir('')),
          },
          h(Icon, { name: 'brain', size: 14 }),
          h('span', { className: 'dshgn_treeName' }, t('tree.all')),
          h('span', { className: 'dshgn_treeCount' }, String(total)),
        ),

        // 热力图放在「全部笔记」正下方：它是「这个库整体在长」的视角，
        // 跟下面按目录/标签切分是两种维度，夹在中间会让人以为它属于某个目录。
        h(HeatmapStrip, { t, heatmap }),

        // 目录区
        h(
          'div',
          { className: 'dshgn_treeHead' },
          h('span', { className: 'dshgn_treeHeadTitle' }, t('tree.dirs')),
          headActions('dir', t('tree.newDir'), true),
        ),
        creating === 'dir'
          ? h(
              'div',
              { className: 'dshgn_treeNew' },
              h('input', {
                className: 'dshgn_treeNewInput',
                type: 'text',
                autoFocus: true,
                value: draft,
                placeholder: t('tree.newDirHint'),
                onChange: (event) => setDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') void runCreate()
                  if (event.key === 'Escape') setCreating(null)
                },
              }),
              h(
                'button',
                { type: 'button', className: 'dshgn_treeNewOk', onClick: () => void runCreate(), disabled: busy },
                h(Icon, { name: 'check', size: 12 }),
              ),
              h(
                'button',
                { type: 'button', className: 'dshgn_treeNewCancel', onClick: () => setCreating(null), disabled: busy },
                h(Icon, { name: 'close', size: 12 }),
              ),
            )
          : null,
        flat.map((node) =>
          h(
            'div',
            {
              key: node.path,
              className: 'dshgn_treeRow',
              'data-on': activeDir === node.path ? 'true' : 'false',
              style: { paddingLeft: `${7 + node.depth * 11}px` },
              onClick: picked(() => onPickDir(node.path)),
              onContextMenu: (event) => openMenu(event, 'dir', node.path),
              title: `${node.path}\n${t('tree.menuDelete')}：右键`,
            },
            h(Icon, { name: 'folder', size: 13 }),
            h('span', { className: 'dshgn_treeName' }, node.name),
            menu !== null && menu.kind === 'dir' && menu.name === node.path
              ? rowMenu()
              : h('span', { className: 'dshgn_treeCount' }, String(node.count)),
          ),
        ),

        // 标签区
        h(
          'div',
          { className: 'dshgn_treeHead' },
          h('span', { className: 'dshgn_treeHeadTitle' }, t('tree.tags')),
          headActions('tag', t('tree.newTag'), true),
        ),
        creating === 'tag'
          ? h(
              'div',
              { className: 'dshgn_treeNew' },
              h('input', {
                className: 'dshgn_treeNewInput',
                type: 'text',
                autoFocus: true,
                value: draft,
                placeholder: t('tree.newTagHint'),
                onChange: (event) => setDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') void runCreate()
                  if (event.key === 'Escape') setCreating(null)
                },
              }),
              h(
                'button',
                { type: 'button', className: 'dshgn_treeNewOk', onClick: () => void runCreate(), disabled: busy },
                h(Icon, { name: 'check', size: 12 }),
              ),
              h(
                'button',
                { type: 'button', className: 'dshgn_treeNewCancel', onClick: () => setCreating(null), disabled: busy },
                h(Icon, { name: 'close', size: 12 }),
              ),
            )
          : null,
        sortedTags.length > 0
          ? h(
              'div',
              { className: 'dshgn_treeTags' },
              // 标签项外面包一层 span：行内菜单里也是按钮，button 不能套 button
              // （HTML 非法，React 会警告，点击也会被外层吞掉）。
              sortedTags.map(([tag, count]) =>
                renaming !== null && renaming.from === tag
                  ? h(
                      'span',
                      { key: tag, className: 'dshgn_treeNew' },
                      h('input', {
                        className: 'dshgn_treeNewInput',
                        type: 'text',
                        autoFocus: true,
                        value: renaming.to,
                        placeholder: tag,
                        onChange: (event) => setRenaming({ from: tag, to: event.target.value }),
                        onKeyDown: (event) => {
                          if (event.key === 'Enter') void runRename()
                          if (event.key === 'Escape') setRenaming(null)
                        },
                      }),
                      h(
                        'button',
                        { type: 'button', className: 'dshgn_treeNewOk', onClick: () => void runRename(), disabled: busy },
                        h(Icon, { name: 'check', size: 12 }),
                      ),
                      h(
                        'button',
                        { type: 'button', className: 'dshgn_treeNewCancel', onClick: () => setRenaming(null), disabled: busy },
                        h(Icon, { name: 'close', size: 12 }),
                      ),
                    )
                  : h(
                      'span',
                      { key: tag, className: 'dshgn_tagWrap' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dshgn_tagRow',
                          'data-on': activeTag === tag ? 'true' : 'false',
                          onClick: picked(() => onPickTag(activeTag === tag ? '' : tag)),
                          onContextMenu: (event) => openMenu(event, 'tag', tag),
                        },
                        `${tag} ${count}`,
                      ),
                      menu !== null && menu.kind === 'tag' && menu.name === tag ? rowMenu() : null,
                    ),
              ),
            )
          : null,

        // 二次确认
        confirm !== null
          ? h(
              'div',
              { className: 'dshgn_modalMask', onClick: () => setConfirm(null) },
              h(
                'div',
                { className: 'dshgn_modal', onClick: (event) => event.stopPropagation() },
                h(
                  'div',
                  { className: 'dshgn_modalTitle' },
                  confirm.kind === 'dir' ? t('tree.deleteDir') : t('tree.deleteTag'),
                ),
                h(
                  'div',
                  { className: 'dshgn_modalBody' },
                  (confirm.kind === 'dir' ? t('tree.deleteDirConfirm') : t('tree.deleteTagConfirm')).replace(
                    '{name}',
                    confirm.name,
                  ),
                ),
                h(
                  'div',
                  { className: 'dshgn_modalActions' },
                  h(
                    'button',
                    { type: 'button', className: 'dshgn_btn', onClick: () => setConfirm(null), disabled: busy },
                    t('action.cancel'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshgn_btn dshgn_btnDanger',
                      onClick: () => void runDelete(),
                      disabled: busy,
                    },
                    t('action.delete'),
                  ),
                ),
              ),
            )
          : null,
      )
    }

    // ── 阅读 / 编辑 ───────────────────────────────────────────────────────────

    function NotePane(props) {
      const { t, status, current, draft, setDraft, dirty, busy, onSave, onRename, onDelete, onCopyReference, onOpenWikiLink, onSyncOne, onRestored, onError, onToggleTodo, onClose, onAttach } = props
      const anchorRequest = props.anchor
      const onAnchorDone = props.onAnchorDone
      // 嵌入 ![[另一篇笔记]] 时用它把名字解析成路径（与点双链共用一套口径）
      const resolveNote = props.resolveNote
      // 属性区里的标签胶囊点一下，等于在左栏筛这个标签（与左栏标签区同一个动作）
      const onPickTag = props.onPickTag
      // 渲染器要的是「库内相对路径」：status.vaultRoot 是绝对路径，笔记在库里
      // 真正的位置是「<子目录>/<笔记相对路径>」。相对链接、图片、嵌入块都靠它解析。
      const subfolder = status !== null && typeof status.subfolder === 'string' ? status.subfolder.replace(/^\/+|\/+$/g, '') : ''
      const vaultPathOf = (note) => {
        const rel = note !== null && typeof note.path === 'string' ? note.path : ''
        if (rel === '') return subfolder
        return subfolder === '' ? rel : `${subfolder}/${rel}`
      }
      const [editing, setEditing] = React.useState(false)
      const [showOutline, setShowOutline] = React.useState(true)
      // 属性区默认展开：头部就三五条，藏起来等于没有；笔记没有头部时整块不渲染。
      const [showProps, setShowProps] = React.useState(true)
      const [backlinks, setBacklinks] = React.useState(null)
      const [outlinks, setOutlinks] = React.useState(null)
      const scrollRef = React.useRef(null)
      // 字号三档：阅读长文（尤其逐字稿）时 13.5px 偏小，但直接调大又会让
      // 习惯默认的人觉得挤。做成三档自己选，存在 localStorage 里——
      // 这是纯本机观感偏好，没必要走一趟 host 写配置文件。
      const [textScale, setTextScale] = React.useState(() => {
        try {
          const saved = window.localStorage.getItem('dshgn.textScale')
          return saved === 's' || saved === 'l' ? saved : 'm'
        } catch {
          return 'm'
        }
      })
      // C2 版本历史：保存/删除前 host 会自动留一版快照，这里给用户翻回去。
      // 快照只留最近 10 版——留太多会让 .history 目录无限膨胀，而真要找回
      // 一个月前的内容，用户应该靠整库备份而不是这个。
      const [historyOpen, setHistoryOpen] = React.useState(false)
      const [historyItems, setHistoryItems] = React.useState(null)
      const [historyPreview, setHistoryPreview] = React.useState(null)
      const [historyBusy, setHistoryBusy] = React.useState(false)
      // 插入附件的文件选择器：按钮只是把它点开，真正干活的是 onAttach
      const attachRef = React.useRef(null)
      const canAttach = typeof onAttach === 'function'

      const loadHistory = React.useCallback(async (path) => {
        if (path === null || path === '') {
          setHistoryItems(null)
          return
        }
        try {
          const json = await api(`/history/list?path=${encodeURIComponent(path)}`)
          setHistoryItems(Array.isArray(json.items) ? json.items : [])
        } catch {
          // 历史读不出来不该挡住读笔记
          setHistoryItems([])
        }
      }, [])

      const previewHistory = React.useCallback(
        async (name) => {
          if (current === null) return
          setHistoryBusy(true)
          try {
            const json = await api(`/history/read?path=${encodeURIComponent(current.path)}&name=${encodeURIComponent(name)}`)
            setHistoryPreview(json)
          } catch (err) {
            onError(err && err.message ? err.message : String(err))
          } finally {
            setHistoryBusy(false)
          }
        },
        [current, onError],
      )

      const restoreHistory = React.useCallback(
        async (name) => {
          if (current === null) return
          setHistoryBusy(true)
          try {
            // keepCurrent 默认 true：恢复前 host 会把当前版也存一版，
            // 用户点错了还能再换回来。
            await api('/history/restore', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ path: current.path, name, keepCurrent: true }),
            })
            setHistoryPreview(null)
            setHistoryOpen(false)
            await loadHistory(current.path)
            if (typeof onRestored === 'function') await onRestored()
          } catch (err) {
            onError(err && err.message ? err.message : String(err))
          } finally {
            setHistoryBusy(false)
          }
        },
        [current, loadHistory, onError, onRestored],
      )

      const pickScale = React.useCallback((next) => {
        setTextScale(next)
        try {
          window.localStorage.setItem('dshgn.textScale', next)
        } catch {
          // 隐私模式下 localStorage 会抛，档位不记住而已，不影响阅读
        }
      }, [])

      // 编辑态里的两个快捷键，跟宿主编辑器同一个口径：Ctrl/Cmd+S 保存、
      // Esc 退出编辑。挂在 window 上而不是 textarea 上，是因为用户按
      // Ctrl+S 时焦点可能已经点到别处（比如刚复制完一段），那时也应该保存。
      // 注意只在编辑态才接管：阅读态下 Ctrl+S 该由宿主处理，抢了就是添乱。
      React.useEffect(() => {
        if (!editing) return undefined
        const onKey = (event) => {
          const meta = event.ctrlKey || event.metaKey
          if (meta && String(event.key).toLowerCase() === 's') {
            event.preventDefault()
            if (!busy && dirty) void onSave()
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(current !== null ? current.content : null)
            setEditing(false)
          }
        }
        return attachOnPanelWindows('keydown', onKey)
      }, [busy, current, dirty, editing, onSave, setDraft])

      // 换笔记时退出编辑态与历史面板：留着编辑态会让用户以为新笔记也是可编辑草稿，
      // 留着上一篇的版本列表会让人点开就恢复错文件。
      //
      // 为什么在渲染期比较而不是 useEffect：effect 是排队执行的，用户「打开笔记 →
      // 立刻点编辑」时 effect 还没轮到，它后到那一下会把刚打开的编辑态又按回关闭。
      // 渲染期比较是同步的，不存在这个窗口。
      const pathKey = current !== null ? current.path : null
      const [lastPathKey, setLastPathKey] = React.useState(pathKey)
      if (lastPathKey !== pathKey) {
        setLastPathKey(pathKey)
        setEditing(false)
        setHistoryOpen(false)
        setHistoryItems(null)
        setHistoryPreview(null)
      }

      // 反查引用单独请求：一次反查要读全库正文，和打开一篇笔记不是一个量级，
      // 塞进 /read 会把「点开笔记」这个最常做的动作拖慢。
      //
      // 有宿主图谱时先问它：metadataCache 的反向链接是增量维护的，不用为了一次
      // 点击把全库正文重读一遍。问不到（刚写下的文件还没进索引）再走本地扫描。
      const currentPath = current !== null ? current.path : null
      React.useEffect(() => {
        if (currentPath === null) {
          setBacklinks(null)
          return undefined
        }
        let alive = true
        setBacklinks(null)
        const hosted = backlinksViaHost(currentPath)
        if (hosted !== null) {
          setBacklinks(hosted)
          return undefined
        }
        void api(`/backlinks?path=${encodeURIComponent(currentPath)}`)
          .then((json) => {
            if (alive) setBacklinks(json)
          })
          .catch(() => {
            // 反查失败不该影响读笔记，静默降级成「没有关联」
            if (alive) setBacklinks({ hits: [] })
          })
        return () => {
          alive = false
        }
      }, [currentPath])

      // 出链：这篇自己写了哪些 [[双链]]。
      //
      // 与反链相反，出链不用扫全库——它就在这一篇的正文里，/read 已经顺带算好
      // 了（载荷里的 links）。但宿主的 metadataCache 认得别名、竖线前的那一段、
      // 以及指向库外文件的情况，比我们的正则更准，所以接上宿主时先问它。
      // 问不到（老版本没有 getFileCache、或者文件刚写下还没进索引）就用载荷里那份。
      React.useEffect(() => {
        if (currentPath === null) {
          setOutlinks(null)
          return undefined
        }
        const hosted = linksViaHost(currentPath)
        if (hosted !== null && Array.isArray(hosted.links)) {
          setOutlinks(hosted.links)
          return undefined
        }
        setOutlinks(Array.isArray(current.links) ? current.links : [])
        return undefined
      }, [current, currentPath])

      // 出链去重 + 去掉空串。宿主那边已经把 links 和 embeds 合过一遍，但同一篇
      // 里写两遍 `[[甲]]` 很常见，排成一排胶囊时重复项只是噪音。
      const outlinkChips = React.useMemo(() => {
        const list = Array.isArray(outlinks) ? outlinks : []
        const seen = new Set()
        const out = []
        for (const raw of list) {
          const text = String(raw === null || raw === undefined ? '' : raw).trim()
          if (text === '' || seen.has(text)) continue
          seen.add(text)
          out.push(text)
        }
        return out
      }, [outlinks])

      // 属性区：把 frontmatter 摊成「键 → 值」几行。
      //
      // 面板以前完全不显示头部——用户在 Obsidian 里写的 tags、aliases、自定义
      // 字段，回到面板里一眼都看不到，还以为没存上。标签单独拎出来做成可点的
      // 胶囊（点了就去左栏筛这个标签），其余按原样列出来。
      //
      // 空值整行跳过：`aliases: []` 这种写了等于没写的键，占一行只会让人以为
      // 面板没渲染对。整篇没有头部时 propRows 是空数组，那块压根不出现。
      const propRows = React.useMemo(() => {
        const data =
          current !== null && current.frontmatter !== null && typeof current.frontmatter === 'object'
            ? current.frontmatter
            : {}
        const rows = []
        for (const key of Object.keys(data)) {
          const raw = data[key]
          const text = frontmatterText(raw)
          if (text === '') continue
          let tags = null
          if (isTagKey(key)) {
            const list = Array.isArray(raw)
              ? raw
              : String(raw === null || raw === undefined ? '' : raw).split(/[,，\s]+/)
            tags = list
              .map((item) => String(item === null || item === undefined ? '' : item).trim())
              .filter((item) => item !== '')
            if (tags.length === 0) tags = null
          }
          rows.push({ key, text, tags })
        }
        return rows
      }, [current])

      // 大纲跳转按「第几个标题」定位而不是按行号：renderBlocks 和 outlineOf 都跳过
      // 代码围栏里的 #，两者的标题顺序完全一致，序号是稳的；行号在正文被重新渲染
      // 后（比如编辑保存）就对不上了。
      const jumpToHeading = React.useCallback((index) => {
        const host = scrollRef.current
        if (!host) return
        const heads = headingNodes(host)
        const target = heads[index]
        if (!target) return
        // 不用 scrollIntoView：它会把**外层每一个可滚动祖先**一起滚，包括横向。
        // 面板里有 overflow-x 的代码块和宽表格，横向一滚整块面板就被拖走、看起来
        // 像「点个大纲整个插件往左移还变形」。这里只改 host 自己的 scrollTop，
        // 横向滚动位置一点都不动。
        const offset = target.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop - 8
        host.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' })
      }, [])

      // 从 `[[笔记#小节]]` 跳进来时滚到那一节。
      //
      // 为什么带 pendingAnchor.seq 依赖：点两次同一个双链，文字没变、状态没变，
      // 只依赖文字的话 effect 不会重跑，第二次点看起来像没反应。seq 每次请求都加一，
      // 保证重跑。为什么滚完就调 onAnchorDone 清掉：不清的话用户接着自己往下翻，
      // 下次这篇笔记重新渲染（比如勾了个待办）又会莫名其妙滚回去。
      React.useEffect(() => {
        if (anchorRequest === null || anchorRequest === undefined) return
        // 还在上一篇上：等目标那一篇读回来再说。这里不清 pendingAnchor，
        // 清了就等于把用户的这次跳转丢掉了。
        if (String(anchorRequest.path || '') !== '' && String(anchorRequest.path) !== String(currentPath || '')) return
        // 搜索卡片点进来的那一行：正文里那一行通常是普通段落，按标题找永远找不到，
        // 得按文字找。找不到时**不报错**——搜索用的是磁盘上那一刻的内容，用户
        // 可能刚改过那一行；为这个弹一条错误条，比「安静地停在篇首」更吵。
        if (anchorRequest.kind === 'line') {
          const lineHost = scrollRef.current
          if (lineHost) scrollToText(lineHost, anchorRequest.text)
          if (typeof onAnchorDone === 'function') onAnchorDone()
          return
        }
        // 块引用（`[[笔记#^abc]]`）：找的是挂了 data-block-id 的那一块，
        // 不是标题。找不到也不报错——用户可能刚把那个 id 删了。
        if (anchorRequest.kind === 'block' || isBlockAnchor(anchorRequest.text)) {
          const blockHost = scrollRef.current
          if (blockHost) scrollToBlock(blockHost, anchorRequest.text)
          if (typeof onAnchorDone === 'function') onAnchorDone()
          return
        }
        const want = normalizeHeading(anchorRequest.text)
        const host = scrollRef.current
        if (want !== '' && host) {
          const heads = headingNodes(host)
          let hit = null
          for (let i = 0; i < heads.length; i += 1) {
            if (normalizeHeading(heads[i].textContent) === want) {
              hit = heads[i]
              break
            }
          }
          if (hit !== null) {
            const offset = hit.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop - 8
            host.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' })
          } else if (typeof onError === 'function') {
            // 找不到就明说。静默不动的话，用户会以为这个双链是坏的。
            onError(t('note.anchorMissing').replace('{name}', anchorRequest.text))
          }
        }
        if (typeof onAnchorDone === 'function') onAnchorDone()
      }, [anchorRequest, currentPath, onAnchorDone, onError, t])

      if (current === null) {
        return h(
          'section',
          { className: 'dshgn_note' },
          h(
            'div',
            { className: 'dshgn_empty' },
            h(Icon, { name: 'brain', size: 26 }),
            h('div', { className: 'dshgn_emptyTitle' }, t('empty.select')),
            h('div', { className: 'dshgn_emptyDesc' }, t('empty.selectDesc')),
          ),
        )
      }

      const absolute = status !== null ? `${status.vaultRoot}/${current.path}` : current.path

      return h(
        'section',
        {
          className: 'dshgn_note' + (canAttach ? ' dshgn_noteDrop' : ''),
          // 把文件拖进笔记正文就插进来。列表那边的 drop 是「挪目录」，
          // 这里同一个手势是「存成附件」——落点不同、意思不同，跟宿主一致。
          onDrop: canAttach
            ? (event) => {
                const files = event.dataTransfer && event.dataTransfer.files
                if (!files || files.length === 0) return
                event.preventDefault()
                event.stopPropagation()
                void onAttach(files)
              }
            : undefined,
        },
        h(
          'div',
          { className: 'dshgn_noteHead' },
          // 窄窗口里中栏被笔记让掉了（两栏挤在一起谁都读不了），
          // 没有这个按钮就回不到列表。宽窗口下 CSS 把它藏起来。
          h(
            'button',
            {
              type: 'button',
              className: 'dshgn_iconBtn dshgn_noteBack',
              title: t('action.back'),
              onClick: () => {
                if (typeof onClose === 'function') onClose()
              },
            },
            // chevron 是朝右的，翻过来当「返回」用，省一个图标
            h('span', { style: { display: 'inline-flex', transform: 'rotate(180deg)' } }, h(Icon, { name: 'chevron', size: 15 })),
          ),
          h('div', { className: 'dshgn_notePath', title: absolute }, current.path),
          // 字号三档。放在笔记头而不是设置页：用户是在「读这篇字太小」的那一刻
          // 想调它，跑到设置页去调完再回来，会打断阅读。
          h(
            'div',
            { className: 'dshgn_scaleGroup', role: 'group', title: t('note.fontSize') },
            ['s', 'm', 'l'].map((size) =>
              h(
                'button',
                {
                  key: size,
                  type: 'button',
                  className: 'dshgn_scaleBtn' + (textScale === size ? ' dshgn_scaleBtnOn' : ''),
                  onClick: () => pickScale(size),
                  title: t(`note.fontSize.${size}`),
                },
                // 三个 A 用不同字号画，比写「小/中/大」省位置，也比图标直观
                h('span', { style: { fontSize: size === 's' ? 10 : size === 'm' ? 12 : 14, lineHeight: 1 } }, 'A'),
              ),
            ),
          ),
          dirty ? h('span', { className: 'dshgn_badge' }, t('note.unsaved')) : null,
          editing
            ? h(
                React.Fragment,
                null,
                h(
                  'button',
                  { type: 'button', className: 'dshgn_btn dshgn_btnPrimary', onClick: onSave, disabled: busy || !dirty },
                  h(Icon, { name: 'check', size: 13 }),
                  t('action.save'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'dshgn_btn', onClick: () => { setDraft(current.content); setEditing(false) }, disabled: busy },
                  t('action.cancel'),
                ),
              )
            : h(
                React.Fragment,
                null,
                h(
                  'button',
                  { type: 'button', className: 'dshgn_iconBtn', title: t('action.edit'), onClick: () => setEditing(true) },
                  h(Icon, { name: 'edit', size: 15 }),
                ),
                // 改名走宿主的对话框：它会把全库双链一起改掉，自己改文件就会留死链。
                hasRenameNote()
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'dshgn_iconBtn',
                        title: t('action.rename'),
                        onClick: () => {
                          if (typeof onRename === 'function') onRename(current.path)
                        },
                      },
                      h(Icon, { name: 'rename', size: 15 }),
                    )
                  : null,
                h(
                  'button',
                  { type: 'button', className: 'dshgn_iconBtn', title: t('action.copyRef'), onClick: onCopyReference },
                  h(Icon, { name: 'link', size: 15 }),
                ),
                // B1：单篇推云端 / 单篇拉云端。只有这篇确实在云端有 note_id 时
                // 才有意义，所以没 note_id 就不显示——点了会报「这篇还没同步过」，
                // 那还不如不给这个按钮。
                current.noteId
                  ? h(
                      'button',
                      { type: 'button', className: 'dshgn_iconBtn', title: t('sync.pushOne'), onClick: () => onSyncOne('push'), disabled: busy },
                      h(Icon, { name: 'cloud', size: 15 }),
                    )
                  : null,
                current.noteId
                  ? h(
                      'button',
                      { type: 'button', className: 'dshgn_iconBtn', title: t('sync.pullOne'), onClick: () => onSyncOne('pull'), disabled: busy },
                      h(Icon, { name: 'sync', size: 15 }),
                    )
                  : null,
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshgn_iconBtn',
                    title: t('history.title'),
                    'data-on': historyOpen ? 'true' : 'false',
                    onClick: () => {
                      const next = !historyOpen
                      setHistoryOpen(next)
                      if (next) void loadHistory(current.path)
                    },
                  },
                  h(Icon, { name: 'clock', size: 15 }),
                ),
                // 去宿主编辑器里改：补全、Vim、插件命令都在那边。
                // 宿主没注入时（离线测试）不显示，免得点了没反应。
                hasOpenInEditor()
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'dshgn_iconBtn',
                        title: t('action.openInEditor'),
                        onClick: () => openInEditor(absolute),
                      },
                      h(Icon, { name: 'external-link', size: 15 }),
                    )
                  : null,
                canAttach
                  ? h(
                      React.Fragment,
                      null,
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dshgn_iconBtn',
                          title: t('note.attach'),
                          onClick: () => {
                            if (attachRef.current) attachRef.current.click()
                          },
                          disabled: busy,
                        },
                        h(Icon, { name: 'attach', size: 15 }),
                      ),
                      // 藏起来的 file input：宿主里插图走的是同一个系统选择器，
                      // 面板没必要自造一套。
                      h('input', {
                        ref: attachRef,
                        type: 'file',
                        multiple: true,
                        style: { display: 'none' },
                        onChange: (event) => {
                          const files = event.target.files
                          if (files && files.length > 0) void onAttach(files)
                          event.target.value = ''
                        },
                      }),
                    )
                  : null,
                h(
                  'button',
                  { type: 'button', className: 'dshgn_iconBtn', title: t('action.delete'), onClick: onDelete, disabled: busy },
                  h(Icon, { name: 'trash', size: 15 }),
                ),
              ),
        ),
        editing
          ? h(
            React.Fragment,
            null,
            h('textarea', {
              className: 'dshgn_editor',
              value: draft === null ? '' : draft,
              spellCheck: false,
              onChange: (event) => setDraft(event.target.value),
              // 截图之后 Ctrl+V 是最顺手的插图方式。宿主接住了，面板以前什么都不做，
              // 剪贴板里的图就悄悄没了。
              onPaste: canAttach
                ? (event) => {
                    const files = event.clipboardData && event.clipboardData.files
                    if (files && files.length > 0) {
                      event.preventDefault()
                      void onAttach(files)
                    }
                  }
                : undefined,
            }),
            // 编辑时脚下那一条：字数 + 快捷键提示。原来编辑态一个字的反馈都没有，
            // 用户不知道按什么保存、也不知道自己写了多少。
            h(
              'div',
              { className: 'dshgn_editorFoot' },
              h('span', null, t('editor.words').replace('{n}', String(countWords(draft)))),
              h('span', { className: 'dshgn_editorHint' }, t('editor.saveHint')),
            ),
          )
          : historyOpen
            ? h(
                'div',
                { className: 'dshgn_historyPane' },
                h(
                  'div',
                  { className: 'dshgn_historyHead' },
                  h(Icon, { name: 'clock', size: 13 }),
                  h('span', null, t('history.title')),
                  h('span', { className: 'dshgn_outlineCount' }, historyItems === null ? '…' : String(historyItems.length)),
                  h(
                    'button',
                    { type: 'button', className: 'dshgn_btn', style: { marginLeft: 'auto' }, onClick: () => { setHistoryOpen(false); setHistoryPreview(null) } },
                    t('action.close'),
                  ),
                ),
                historyPreview !== null
                  ? h(
                      React.Fragment,
                      null,
                      h(
                        'div',
                        { className: 'dshgn_rowLine', style: { padding: '6px 12px', gap: 8 } },
                        h('span', { className: 'dshgn_fieldHint' }, formatTime(historyPreview.savedAt)),
                        h(
                          'button',
                          { type: 'button', className: 'dshgn_btn dshgn_btnPri', style: { marginLeft: 'auto' }, onClick: () => void restoreHistory(historyPreview.name), disabled: historyBusy },
                          t('history.restore'),
                        ),
                        h('button', { type: 'button', className: 'dshgn_btn', onClick: () => setHistoryPreview(null), disabled: historyBusy }, t('action.back')),
                      ),
                      h('pre', { className: 'dshgn_diffBody', style: { flex: 1, minHeight: 0 } }, historyPreview.content),
                    )
                  : historyItems === null
                    ? h('div', { className: 'dshgn_emptyState' }, h('span', { className: 'dshgn_spin' }))
                    : historyItems.length === 0
                      ? h(
                          'div',
                          { className: 'dshgn_empty' },
                          h(Icon, { name: 'clock', size: 22 }),
                          h('div', { className: 'dshgn_emptyTitle' }, t('history.empty')),
                          h('div', { className: 'dshgn_emptyDesc' }, t('history.emptyHint')),
                        )
                      : h(
                          'div',
                          { className: 'dshgn_historyList' },
                          historyItems.map((item) =>
                            h(
                              'button',
                              {
                                key: item.name,
                                type: 'button',
                                className: 'dshgn_historyItem',
                                onClick: () => void previewHistory(item.name),
                                disabled: historyBusy,
                              },
                              h('span', { className: 'dshgn_historyTime' }, formatTime(item.savedAt)),
                              h('span', { className: 'dshgn_historyMeta' }, formatBytes(item.bytes)),
                            ),
                          ),
                        ),
              )
            : h(
              'div',
              { className: 'dshgn_scroll', ref: scrollRef },
              // 属性区：笔记头部那几行（tags / aliases / 自定义字段）。
              // 放在正文上方、大纲之上——它回答「这篇是什么」，读正文之前先有个背景。
              // 没有头部时 propRows 是空数组，这一整块不出现。
              propRows.length > 0
                ? h(
                    'div',
                    { className: 'dshgn_props' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dshgn_outlineToggle',
                        onClick: () => setShowProps((prev) => !prev),
                        title: t('reader.frontmatter'),
                      },
                      h(Icon, { name: showProps ? 'up' : 'file', size: 12 }),
                      t('reader.frontmatter'),
                      h('span', { className: 'dshgn_outlineCount' }, String(propRows.length)),
                    ),
                    showProps
                      ? h(
                          'div',
                          { className: 'dshgn_propsBody' },
                          propRows.map((row) =>
                            h(
                              'div',
                              { key: row.key, className: 'dshgn_propRow' },
                              h('span', { className: 'dshgn_propKey', title: row.key }, row.key),
                              h(
                                'span',
                                { className: 'dshgn_propVal' },
                                // 标签做成可点的胶囊：点一下等于在左栏筛这个标签。
                                // 其余的值原样列出来（数组在 frontmatterText 里已经用 · 连好）。
                                row.tags !== null && typeof onPickTag === 'function'
                                  ? row.tags.map((tag, index) =>
                                      h(
                                        'button',
                                        {
                                          key: `${index}-${tag}`,
                                          type: 'button',
                                          className: 'dshgn_propTag',
                                          title: tag,
                                          onClick: () => onPickTag(tag),
                                        },
                                        tag,
                                      ),
                                    )
                                  : row.text,
                              ),
                            ),
                          ),
                        )
                      : null,
                  )
                : null,
              // 大纲：长笔记（尤其逐字稿那种几千字）靠滚动找「金句在哪一节」非常费劲，
              // 给一排可点的标题省掉这个过程。默认展开，但可以收起——有些用户
              // 只想一口气读完，多一行都是干扰。
              Array.isArray(current.outline) && current.outline.length > 1
                ? h(
                    'div',
                    { className: 'dshgn_outline' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dshgn_outlineToggle',
                        onClick: () => setShowOutline((prev) => !prev),
                        title: t('note.outline'),
                      },
                      h(Icon, { name: showOutline ? 'up' : 'file', size: 12 }),
                      t('note.outline'),
                      h('span', { className: 'dshgn_outlineCount' }, String(current.outline.length)),
                    ),
                    showOutline
                      ? h(
                          'div',
                          { className: 'dshgn_outlineList' },
                          current.outline.map((item, index) =>
                            h(
                              'button',
                              {
                                key: `${index}-${item.text}`,
                                type: 'button',
                                className: 'dshgn_outlineItem',
                                // 缩进跟着标题层级走，三级标题比一级多缩进两格，
                                // 结构一眼能看出来，不用读文字判断谁是谁的子节。
                                style: { paddingLeft: 8 + Math.max(0, item.level - 1) * 12 },
                                onClick: () => jumpToHeading(index),
                              },
                              item.text,
                            ),
                          ),
                        )
                      : null,
                  )
                : null,
              // 附件里的录音直接放播放器：合并两套体系时把这些 mp3 搬进来了，
              // 如果只留 markdown 里那条外链，用户还得跳浏览器才能听。
              (current.assets || [])
                .filter((asset) => asset.kind === 'audio')
                .map((asset, index) =>
                  h(AudioPlayer, {
                    key: `${asset.path}-${index}`,
                    t,
                    track: {
                      // 宿主给了资源地址就用它（Range、缓存都归宿主管），否则退回本地服务
                      url:
                        assetUrlOf(asset.path) !== ''
                          ? assetUrlOf(asset.path)
                          : withToken(`${apiOrigin()}/getnote/asset?path=${encodeURIComponent(asset.path)}`),
                      duration: 0,
                      kind: 'local',
                      title: assetLabel(asset.name),
                    },
                  }),
                ),
              // 附件里的图片也画出来。以前只筛 audio，`kind:'image'` 的附件在面板里
              // 完全看不见——用户明明存了图，却以为没同步下来。
              (current.assets || []).some((asset) => asset.kind === 'image')
                ? h(
                    'div',
                    { className: 'dshgn_imgRow' },
                    (current.assets || [])
                      .filter((asset) => asset.kind === 'image')
                      .map((asset, index) =>
                        h('img', {
                          key: `${asset.path}-${index}`,
                          className: 'dshgn_img' + (hasOpenAsset() ? ' dshgn_imgOpen' : ''),
                          src:
                            assetUrlOf(asset.path) !== ''
                              ? assetUrlOf(asset.path)
                              : withToken(`${apiOrigin()}/getnote/asset?path=${encodeURIComponent(asset.path)}`),
                          alt: asset.name,
                          title: hasOpenAsset() ? `${t('note.openImage')} · ${asset.name}` : asset.name,
                          loading: 'lazy',
                          onClick: hasOpenAsset()
                            ? (event) => {
                                if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
                                openAssetInHost(asset.path)
                              }
                            : undefined,
                        }),
                      ),
                  )
                : null,
              // 阅读时只渲染正文：`content` 带 YAML frontmatter，直接 renderBlocks 会把
              // `title: xxx` / `note_id: "..."` 当成正文段落一条条铺出来。编辑时仍用
              // `content`，这样保存不会把 frontmatter 丢掉。
              h(
                'div',
                { className: 'dshgn_md' + (textScale === 's' ? ' dshgn_mdS' : textScale === 'l' ? ' dshgn_mdL' : '') },
                renderMarkdown(
                  current.body !== undefined && current.body !== null ? current.body : current.content,
                  // 编辑态不给 onToggleTodo：那时显示的是可编辑 textarea，正文里的
                  // 方框根本不该响应点击（改内容要走保存）。只有阅读态才可点。
                  {
                    assets: current.assets || [],
                    sourcePath: vaultPathOf(current),
                    // 点 [[双链]]：先交给 Obsidian 在编辑器里打开（这是 Obsidian
                    // 用户的直觉），没注入宿主时退回面板自己的「在面板里打开」。
                    onOpenLink: (target) => {
                      if (openLinkInVault(target, vaultPathOf(current))) return
                      onOpenWikiLink(target)
                    },
                    onOpenWikiLink,
                    onToggleTodo: editing ? undefined : onToggleTodo,
                    // ![[另一篇笔记]]：把那一篇的正文嵌进来。解析口径与点双链
                    // 共用一套，否则会出现「点得过去、嵌不进来」。
                    resolveNote,
                    embedDepth: 0,
                    t,
                  },
                ),
              ),
              // 关联笔记（反向链接）：用户写了很多 [[双链]]，但双链只有「点进去」
              // 一个方向；想看「谁提到了我这篇」只能靠这个面板。
              backlinks !== null && Array.isArray(backlinks.hits) && backlinks.hits.length > 0
                ? h(
                    'div',
                    { className: 'dshgn_backlinks' },
                    h('div', { className: 'dshgn_backlinksHead' }, h(Icon, { name: 'link', size: 12 }), t('note.backlinks'), h('span', { className: 'dshgn_outlineCount' }, String(backlinks.hits.length))),
                    backlinks.hits.map((hit) =>
                      h(
                        'button',
                        {
                          key: hit.path,
                          type: 'button',
                          className: 'dshgn_backlinkItem',
                          title: hit.path,
                          onClick: () => onOpenWikiLink(hit.path),
                        },
                        h('span', { className: 'dshgn_backlinkTitle' }, hit.title || hit.path),
                        // 一篇笔记里提到这一篇好几次时标个次数：三条反链里那条提了 5 次
                        // 的，通常比只提一次的更值得先看。
                        Number(hit.count) > 1
                          ? h('span', { className: 'dshgn_outlineCount', style: { marginLeft: 6 } }, String(hit.count))
                          : null,
                        // 上下文：引用那一行剩下的字。没有（宿主索引那份不带）就不占行，
                        // 免得每条反链底下都空一格。最多三条——再多就是把人家的正文
                        // 整段抄过来了。
                        (Array.isArray(hit.snippets) ? hit.snippets : [])
                          .filter((line) => typeof line === 'string' && line !== '')
                          .slice(0, 3)
                          .map((line, index) =>
                            h('span', { key: `${hit.path}-s${index}`, className: 'dshgn_backlinkSnip' }, line),
                          ),
                        h('span', { className: 'dshgn_backlinkPath' }, hit.path),
                      ),
                    ),
                  )
                : null,
              // 出链：这篇引用了谁。反链回答「谁提到我」，出链回答「我提到过谁」，
              // 两个方向合起来才是用户脑子里的那张网。
              outlinkChips.length > 0
                ? h(
                    'div',
                    { className: 'dshgn_outlinks' },
                    h('div', { className: 'dshgn_outlinksHead' }, h(Icon, { name: 'link', size: 12 }), t('note.outlinks'), h('span', { className: 'dshgn_outlineCount' }, String(outlinkChips.length))),
                    h(
                      'div',
                      { className: 'dshgn_outlinkRow' },
                      outlinkChips.map((link) =>
                        h(
                          'button',
                          {
                            key: link,
                            type: 'button',
                            className: 'dshgn_outlinkChip',
                            title: link,
                            onClick: () => onOpenWikiLink(link),
                          },
                          link,
                        ),
                      ),
                    ),
                  )
                : null,
            ),
      )
    }

    // ── 导入 ──────────────────────────────────────────────────────────────────

    function ImportPane(props) {
      const { t, status, onRefresh, onDone } = props
      const [state, setState] = React.useState(null)
      const [authUrl, setAuthUrl] = React.useState(null)
      const [waiting, setWaiting] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const loadStatus = React.useCallback(async () => {
        try {
          const json = await api('/import/status')
          setState(json)
          return json
        } catch {
          return null
        }
      }, [])

      React.useEffect(() => {
        void loadStatus()
      }, [loadStatus])

      // 导入在 host 侧跑，面板这边轮询进度（关掉面板也不影响它继续）
      const running = state !== null && state.running === true
      React.useEffect(() => {
        if (!running) return undefined
        const timer = window.setInterval(() => {
          void loadStatus().then((json) => {
            if (json && json.running === false) onDone()
          })
        }, 900)
        return () => window.clearInterval(timer)
      }, [running, loadStatus, onDone])

      const loggedIn = status !== null && status.cloud !== null && status.cloud.loggedIn === true

      const startLogin = React.useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          const json = await api('/oauth/start', { method: 'POST' })
          setAuthUrl(json.url)
          setWaiting(true)
          // 打开系统浏览器可能失败：不依赖它的返回值，面板上始终给可点的链接
          try {
            openExternal(json.url)
          } catch {
            // 打开失败也没关系，下面有手动链接
          }
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [])

      // 等待授权回跳：每 2 秒看一次 host 有没有拿到令牌
      React.useEffect(() => {
        if (!waiting) return undefined
        const timer = window.setInterval(async () => {
          try {
            const json = await api('/oauth/status')
            if (json && json.loggedIn === true) {
              setWaiting(false)
              setAuthUrl(null)
              await onRefresh()
            }
          } catch {
            // 授权未完成：继续等
          }
        }, 2000)
        return () => window.clearInterval(timer)
      }, [waiting, onRefresh])

      const startImport = React.useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          const json = await api('/import', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          })
          if (json && json.ok === false) setError(json.error || 'import failed')
          setState((previous) => ({ ...(previous || {}), running: json.ok === true }))
          await loadStatus()
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [loadStatus])

      const logout = React.useCallback(async () => {
        setBusy(true)
        try {
          await api('/logout', { method: 'POST' })
          await onRefresh()
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [onRefresh])

      const lines = state !== null && Array.isArray(state.lines) ? state.lines : []
      const result = state !== null ? state.result : null

      return h(
        'div',
        { className: 'dshgn_pane' },
        h(
          'div',
          { className: 'dshgn_cardBox' },
          h(
            'div',
            { className: 'dshgn_section' },
            h('div', { className: 'dshgn_sectionTitle' }, t('import.title')),
            h('div', { className: 'dshgn_sectionDesc' }, t('import.desc')),
            h(
              'div',
              { className: 'dshgn_rowLine' },
              h(
                'span',
                { className: loggedIn ? 'dshgn_badge dshgn_badgeOk' : 'dshgn_badge' },
                h(Icon, { name: 'cloud', size: 11 }),
                loggedIn ? t('import.loggedIn') : t('import.notLoggedIn'),
              ),
              status !== null && status.lastSyncAt
                ? h('span', { className: 'dshgn_badge' }, `${t('import.lastSync')}: ${formatTime(status.lastSyncAt)}`)
                : h('span', { className: 'dshgn_badge' }, `${t('import.lastSync')}: ${t('import.never')}`),
              status !== null && status.notes > 0 ? h('span', { className: 'dshgn_badge' }, `${status.notes} ${t('meta.notes')}`) : null,
            ),
            h(
              'div',
              { className: 'dshgn_rowLine' },
              loggedIn
                ? h(
                    React.Fragment,
                    null,
                    h(
                      'button',
                      { type: 'button', className: 'dshgn_btn dshgn_btnPrimary', onClick: startImport, disabled: busy || running },
                      running ? h('span', { className: 'dshgn_spin' }) : h(Icon, { name: 'cloud', size: 13 }),
                      running ? t('import.running') : t('import.start'),
                    ),
                    h('button', { type: 'button', className: 'dshgn_btn', onClick: logout, disabled: busy || running }, t('import.logout')),
                  )
                : h(
                    React.Fragment,
                    null,
                    h(
                      'button',
                      { type: 'button', className: 'dshgn_btn dshgn_btnPrimary', onClick: startLogin, disabled: busy },
                      h(Icon, { name: 'cloud', size: 13 }),
                      t('import.login'),
                    ),
                    h('span', { className: 'dshgn_sectionDesc' }, t('import.loginHint')),
                  ),
            ),
            !loggedIn ? h('div', { className: 'dshgn_sectionDesc' }, t('import.cloudHint')) : null,
            authUrl !== null
              ? h(
                  'div',
                  { className: 'dshgn_sectionDesc' },
                  waiting ? `${t('import.authorizeWait')} ` : '',
                  // 用按钮而不是 a[target=_blank]：Obsidian 的自定义视图里点外链
                  // 有时会把整个应用导航走，比打开浏览器难收拾得多。
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshgn_link dshgn_linkBtn',
                      onClick: () => openExternal(authUrl),
                    },
                    t('import.openLink'),
                  ),
                )
              : null,
          ),
          error !== null ? h('div', { className: 'dshgn_error', role: 'alert' }, error) : null,
          result !== null
            ? h(
                'div',
                { className: 'dshgn_section' },
                h('div', { className: 'dshgn_sectionTitle' }, t('import.result')),
                h(
                  'div',
                  { className: 'dshgn_rowLine' },
                  h('span', { className: 'dshgn_badge dshgn_badgeOk' }, `${t('import.newNotes')} ${result.created}`),
                  h('span', { className: 'dshgn_badge' }, `${t('import.skipped')} ${result.skipped}`),
                  h('span', { className: 'dshgn_badge' }, `${t('import.failed')} ${result.failed}`),
                  h('span', { className: 'dshgn_badge' }, `${Math.round((result.durationMs || 0) / 1000)}s`),
                ),
                h('div', { className: 'dshgn_sectionDesc' }, result.root),
              )
            : null,
          lines.length > 0
            ? h('div', { className: 'dshgn_log' }, lines.map((line, index) => h('div', { key: index }, `${formatTime(line.at)}  ${line.text}`)))
            : null,
        ),
      )
    }

    // ── 设置 ──────────────────────────────────────────────────────────────────

    function SettingsPane(props) {
      const { t, status, onSaved, onError, onThemePreview, showToast, locale, onLocaleChange, onSyncChanged } = props
      const [input, setInput] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [touched, setTouched] = React.useState(false)

      React.useEffect(() => {
        if (!touched && status !== null) setInput(status.subfolder || '')
      }, [status, touched])

      const save = React.useCallback(
        async (path) => {
          setBusy(true)
          try {
            await api('/settings', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ vaultPath: path }),
            })
            setTouched(false)
            await onSaved(t('settings.saved'))
          } catch (err) {
            onError(err && err.message ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        },
        [onError, onSaved, t],
      )

      const suggestions = status !== null && Array.isArray(status.suggestions) ? status.suggestions : []
      const cloudApi = status !== null && status.api ? status.api : null
      // 登录态三态：没有 auth.json / 有但过期 / 有效。只看 loggedIn 会把
      // 「过期了但文件还在」误报成已登录。
      const loginState =
        status === null || status.cloud === null || status.cloud.loggedIn !== true
          ? 'none'
          : status.cloud.expired === true
            ? 'expired'
            : 'ok'

      return h(
        'div',
        { className: 'dshgn_pane' },
        h(
          'div',
          { className: 'dshgn_cardBox' },
          h(
            'div',
            { className: 'dshgn_section' },
            h('div', { className: 'dshgn_sectionTitle' }, t('settings.vault')),
            h('div', { className: 'dshgn_sectionDesc' }, t('settings.vaultHint')),
            h(
              'div',
              { className: 'dshgn_rowLine' },
              h('input', {
                className: 'dshgn_input',
                value: input,
                spellCheck: false,
                placeholder: status !== null ? status.vaultRoot : '',
                onChange: (event) => {
                  setTouched(true)
                  setInput(event.target.value)
                },
              }),
              h('button', { type: 'button', className: 'dshgn_btn dshgn_btnPrimary', onClick: () => save(input), disabled: busy }, t('settings.save')),
            ),
            status !== null && status.vaultMissing ? h('div', { className: 'dshgn_error' }, `✕ ${status.vaultMissing}`) : null,
            status !== null ? h('div', { className: 'dshgn_sectionDesc' }, `${status.notes} ${t('meta.notes')} · ${status.dirs} ${t('meta.dirs')} · ${formatBytes(status.bytes)}`) : null,
          ),
          suggestions.length > 0
            ? h(
                'div',
                { className: 'dshgn_section' },
                h('div', { className: 'dshgn_sectionTitle' }, t('settings.suggest')),
                suggestions.map((item) =>
                  h(
                    'div',
                    { key: item.path, className: 'dshgn_rowLine' },
                    h('div', { className: 'dshgn_sectionDesc', style: { flex: 1, minWidth: 0, wordBreak: 'break-all' } }, `${item.path} — ${item.notes} ${t('meta.notes')}`),
                    h('button', { type: 'button', className: 'dshgn_btn', onClick: () => save(item.path), disabled: busy }, t('settings.use')),
                  ),
                ),
              )
            : null,
          h(CloudCredCard, { t, api: cloudApi, onSaved, onError }),
          // 自动同步紧跟在云端接入卡后面：它俩是同一件事的两半——上面说「用哪条
          // 通道连云端」，这里说「多久自动拉一次」。中间隔着主题色/语言会让这层
          // 关系看不出来。
          h(SyncPane, { t, status, onChanged: onSyncChanged, onError, showToast }),
          h(ThemeCard, { t, themeColor: status !== null ? status.themeColor : null, onSaved, onError, onPreview: onThemePreview }),
          h(LanguageCard, { t, locale, onSaved, onError, onLocaleChange }),
          // 跟随卡片紧跟在语言之后：它和「面板长什么样」属于同一类设置（怎么跟
          // 宿主配合），而不是「库里有什么」。
          h(FollowCard, { t, status, onSaved, onError }),
          // 模板卡放在语言之后、备份之前：它属于「写作习惯」这一类，跟主题色/语言
          // 挨着；备份是整库操作，应该留在最后。
          h(TemplateCard, { t, status, onSaved, onError }),
          h(ArchiveCard, { t, status, onChanged: onSaved, onError, showToast }),
          h(
            'div',
            { className: 'dshgn_section' },
            h(
              'div',
              { className: 'dshgn_sectionHead' },
              h('div', { className: 'dshgn_sectionTitle' }, t('settings.authFile')),
              h(
                'span',
                {
                  // auth.json 存在只说明「登录过」，令牌过期后它还在文件里。
                  // 这时仍显示「已登录」会骗人：用户以为登录有效，其实云端操作
                  // 走的是 API Key 那条通道。所以按 expiresAt 分三态。
                  className:
                    'dshgn_badge' +
                    (loginState === 'ok' ? ' dshgn_badgeOk' : loginState === 'expired' ? ' dshgn_badgeWarn' : ''),
                },
                loginState === 'ok'
                  ? t('settings.loggedIn')
                  : loginState === 'expired'
                    ? t('settings.loginExpired')
                    : t('settings.loggedOut'),
              ),
            ),
            h('div', { className: 'dshgn_sectionDesc' }, status !== null ? status.authPath : ''),
            h('div', { className: 'dshgn_sectionDesc' }, t('settings.storeHint')),
          ),
        ),
      )
    }

    // ── 主题色卡片 ────────────────────────────────────────────────────────────

    /**
     * 自定义面板主题色。
     *
     * 交互上做了三件事，都是为了「随手玩一下」不变成负担：
     *   1. 预设色板（8 个常用色）点一下就应用，不用打开取色器；
     *   2. `<input type="color">` 只在点「自定义」时出现——原生取色器一按就
     *      弹出系统对话框，放在默认位置太打扰；
     *   3. 改完立刻预览（draft 覆盖 status 里的 themeColor），但只有点「应用」
     *      才落盘。不然用户试了三个颜色，磁盘就写了三次。
     */
    function ThemeCard(props) {
      const { t, themeColor, onSaved, onError, onPreview } = props
      const [draft, setDraft] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [custom, setCustom] = React.useState(false)

      const active = draft === null ? themeColor : draft

      // 草稿一变就把颜色交给面板根节点去算变量，用户拖色轮时整面板实时跟着变。
      // 卸载时也补一次 null：离开设置页还留着预览色的话，用户回到笔记页
      // 会看到「没保存的颜色」，以为已经生效了。
      React.useEffect(() => {
        if (typeof onPreview === 'function') onPreview(draft)
        return () => {
          if (typeof onPreview === 'function') onPreview(null)
        }
      }, [draft, onPreview])

      const save = React.useCallback(
        async (value) => {
          setBusy(true)
          try {
            await api('/settings', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ themeColor: value }),
            })
            // 先让 onSaved 刷新 status，再清草稿：反过来的话草稿一清空，
            // 面板立刻回落到「旧的已保存色」，等 status 回来才跳到新色，
            // 用户会看到颜色闪一下旧值。
            await onSaved(t('theme.saved'))
            setDraft(null)
          } catch (err) {
            onError(err && err.message ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        },
        [onError, onSaved, t],
      )

      const presets = ['#0a2a52', '#14342b', '#4a2036', '#3b2d5c', '#5c3a1e', '#22434f', '#40202c', '#333333']

      return h(
        'div',
        { className: 'dshgn_section' },
        h('div', { className: 'dshgn_sectionTitle' }, t('theme.title')),
        h('div', { className: 'dshgn_sectionDesc' }, t('theme.desc')),
        h(
          'div',
          { className: 'dshgn_themeRow' },
          presets.map((hex) =>
            h('button', {
              key: hex,
              type: 'button',
              className: 'dshgn_swatch' + (active === hex ? ' dshgn_swatchOn' : ''),
              title: hex,
              'aria-label': hex,
              style: { background: hex },
              onClick: () => setDraft(hex),
            }),
          ),
          h(
            'button',
            { type: 'button', className: 'dshgn_btn', onClick: () => setCustom(!custom) },
            custom ? t('theme.preset') : t('theme.custom'),
          ),
        ),
        custom
          ? h(
              'div',
              { className: 'dshgn_rowLine', style: { marginTop: 8 } },
              h('input', {
                type: 'color',
                className: 'dshgn_colorInput',
                value: active === null ? '#0a2a52' : active,
                onChange: (event) => setDraft(event.target.value),
              }),
              h('input', {
                className: 'dshgn_input',
                value: active === null ? '' : active,
                spellCheck: false,
                placeholder: '#0a2a52',
                onChange: (event) => setDraft(event.target.value),
              }),
            )
          : null,
        // 三栏效果预览条：设置页主体是白卡片，用户在这儿看不到目录树/列表/正文，
        // 光靠点色块没法判断「左深中浅右白」到底长什么样，所以直接画一条出来。
        (() => {
          const preview = themeVars(active, isDarkTheme())
          if (preview === null) return null
          return h(
            'div',
            { className: 'dshgn_previewBar', 'aria-hidden': 'true' },
            h('div', { className: 'dshgn_previewCell', style: { background: preview['--dshgn-deep'], color: preview['--dshgn-deepFg'] } }, t('theme.previewLeft')),
            h('div', { className: 'dshgn_previewCell', style: { background: preview['--dshgn-mid'], color: preview['--dshgn-midFg'] } }, t('theme.previewMid')),
            h('div', { className: 'dshgn_previewCell', style: { background: preview['--dshgn-light'], color: preview['--dshgn-lightFg'] } }, t('theme.previewRight')),
          )
        })(),
        h(
          'div',
          { className: 'dshgn_rowLine', style: { marginTop: 10 } },
          h('button', { type: 'button', className: 'dshgn_btn dshgn_btnPrimary', onClick: () => save(active), disabled: busy || draft === null }, t('theme.apply')),
          h('button', { type: 'button', className: 'dshgn_btn', onClick: () => save(null), disabled: busy }, t('theme.reset')),
        ),
      )
    }

    // ── 云端凭证卡片 ──────────────────────────────────────────────────────────

    /**
     * 填 API Key / Client ID 的卡片。
     *
     * 两个安全点：
     *   1. 保存后输入框立刻清空，只显示打码值 —— 不要在 DOM 里留着明文 Key，
     *      截图、录屏、共享屏幕都会漏。
     *   2. 「只写不回」：host 侧 `/api/credentials` 的响应里永远不含明文，
     *      这样即便前端被 XSS 也偷不到。
     */
    function CloudCredCard(props) {
      const { t, api: apiInfo, onSaved, onError } = props
      const configured = apiInfo !== null && apiInfo.configured === true

      const [apiKey, setApiKey] = React.useState('')
      const [clientId, setClientId] = React.useState('')
      const [grantId, setGrantId] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [testing, setTesting] = React.useState(false)
      const [probe, setProbe] = React.useState(null)

      const save = React.useCallback(async () => {
        if (apiKey.trim() === '' || clientId.trim() === '') {
          onError(t('api.needKey'))
          return
        }
        setBusy(true)
        setProbe(null)
        try {
          await api('/api/credentials', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ apiKey: apiKey.trim(), clientId: clientId.trim(), grantId: grantId.trim() }),
          })
          // 立刻清空输入框，界面上只留打码值
          setApiKey('')
          setClientId('')
          setGrantId('')
          await onSaved(t('api.saved'))
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [apiKey, clientId, grantId, onSaved, onError, t])

      const test = React.useCallback(async () => {
        setTesting(true)
        setProbe(null)
        try {
          const result = await api('/api/probe')
          setProbe({ ok: true, text: `${t('api.ok')}${result.total !== undefined ? ` · ${result.total}` : ''}` })
        } catch (err) {
          setProbe({ ok: false, text: err && err.message ? err.message : String(err) })
          onError(err && err.message ? err.message : String(err))
        } finally {
          setTesting(false)
        }
      }, [onError, t])

      const clear = React.useCallback(async () => {
        if (!(await confirmDialog(t('api.clear')))) return
        setBusy(true)
        setProbe(null)
        try {
          await api('/api/clear', { method: 'POST' })
          await onSaved(t('api.cleared'))
        } catch (err) {
          onError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [onSaved, onError, t])

      return h(
        'div',
        { className: 'dshgn_section' },
        h(
          'div',
          { className: 'dshgn_rowLine' },
          h('div', { className: 'dshgn_sectionTitle' }, t('api.title')),
          h('span', { className: 'dshgn_badge' + (configured ? ' dshgn_badgeOk' : '') }, configured ? t('api.ready') : t('api.notReady')),
          configured && apiInfo.apiKeyMasked ? h('span', { className: 'dshgn_treeCount' }, `${apiInfo.apiKeyMasked} · ${apiInfo.clientIdMasked || ''}`) : null,
        ),
        h('div', { className: 'dshgn_sectionDesc' }, t('api.desc')),
        // Key 被服务端拒过：这条必须显眼。用户填完 Key 看到「已接入」，然后云端每个
        // 操作都失败，却不知道为什么——那是这个插件最糟的体验。
        apiInfo !== null && apiInfo.keyRejected === true
          ? h(
              'div',
              { className: 'dshgn_banner dshgn_bannerWarn' },
              h('div', { className: 'dshgn_bannerTitle' }, t('api.keyRejected')),
              h('div', { className: 'dshgn_bannerDesc' }, apiInfo.keyError || ''),
              apiInfo.fallbackAvailable === true
                ? h('div', { className: 'dshgn_bannerDesc' }, t('api.usingFallback'))
                : null,
            )
          : null,
        // 走的是登录通道（不是 Key）：说明清楚，省得用户以为 Key 没存住
        apiInfo !== null && apiInfo.effectiveTransport === 'mcp' && apiInfo.keyRejected !== true
          ? h('div', { className: 'dshgn_fieldHint' }, t('api.viaLogin'))
          : null,
        h(
          'div',
          { className: 'dshgn_field' },
          h('span', { className: 'dshgn_fieldLabel' }, t('api.apiKey')),
          h('input', {
            className: 'dshgn_input',
            type: 'password',
            autoComplete: 'off',
            spellCheck: false,
            value: apiKey,
            placeholder: configured ? '••••••••（已保存，重新填可替换）' : t('api.keyPlaceholder'),
            onChange: (event) => setApiKey(event.target.value),
          }),
        ),
        h(
          'div',
          { className: 'dshgn_field' },
          h('span', { className: 'dshgn_fieldLabel' }, t('api.clientId')),
          h('input', {
            className: 'dshgn_input',
            spellCheck: false,
            value: clientId,
            placeholder: configured ? '••••••••（已保存，重新填可替换）' : t('api.idPlaceholder'),
            onChange: (event) => setClientId(event.target.value),
          }),
        ),
        h(
          'div',
          { className: 'dshgn_field' },
          h('span', { className: 'dshgn_fieldLabel' }, t('api.grantId')),
          h('input', {
            className: 'dshgn_input',
            spellCheck: false,
            value: grantId,
            placeholder: configured && apiInfo.hasGrantId ? '••••••••' : t('api.grantPlaceholder'),
            onChange: (event) => setGrantId(event.target.value),
          }),
        ),
        h(
          'div',
          { className: 'dshgn_rowLine' },
          h('button', { type: 'button', className: 'dshgn_btn dshgn_btnPrimary', onClick: save, disabled: busy }, busy ? h('span', { className: 'dshgn_spin' }) : h(Icon, { name: 'check', size: 12 }), t('api.save')),
          configured ? h('button', { type: 'button', className: 'dshgn_btn', onClick: test, disabled: testing }, testing ? h('span', { className: 'dshgn_spin' }) : null, testing ? t('api.testing') : t('api.test')) : null,
          configured ? h('button', { type: 'button', className: 'dshgn_btn dshgn_btnDanger', onClick: clear, disabled: busy }, t('api.clear')) : null,
        ),
        probe !== null ? h('div', { className: probe.ok ? 'dshgn_fieldHint' : 'dshgn_error', style: probe.ok ? { color: 'var(--dsw-alias-state-success-primary)' } : undefined }, `${probe.ok ? '✓' : '✕'} ${probe.text}`) : null,
        h('div', { className: 'dshgn_fieldHint' }, t('api.consoleHint')),
        h('div', { className: 'dshgn_fieldHint' }, t('api.neverEcho')),
        apiInfo !== null && apiInfo.credentialsPath ? h('div', { className: 'dshgn_fieldHint' }, `${t('api.file')}: ${apiInfo.credentialsPath}`) : null,
      )
    }

    // ── 插件入口 ──────────────────────────────────────────────────────────────

    /**
     * 面板级错误边界。
     *
     * 为什么必须有：面板注册进 `main` 槽之后，只要渲染期抛一次异常，宿主就把整块
     * 区域留成空白——用户看到的是「点了侧栏没反应」，而不是任何线索，我这边也只能
     * 靠猜。包一层边界后，异常会变成界面上的一行红字 + 重试按钮，既让用户知道
     * 「是这一块坏了、别的功能还在」，也把错误原文暴露出来便于定位。
     *
     * 为什么必须是 class：React 只有 class 组件能声明 getDerivedStateFromError /
     * componentDidCatch，函数组件无法拦截子树的渲染异常。
     *
     * 为什么用 typeof 探针取基类：本文件在测试里会被 `new Function` 求值，那时
     * `React` 是注入的桩，可能没有 Component。直接 `extends React.Component`
     * 会在求值瞬间抛 TypeError；探针取不到就退回一个同形替身，真实运行时才用真的。
     */
    const ErrorBoundaryBase =
      typeof React !== 'undefined' && React && React.Component
        ? React.Component
        : class {
            constructor(props) {
              this.props = props || {}
              this.state = { error: null }
            }
          }

    class PanelBoundary extends ErrorBoundaryBase {
      constructor(props) {
        super(props)
        this.state = { error: null }
        this.retry = this.retry.bind(this)
      }

      static getDerivedStateFromError(error) {
        return { error: error || new Error('渲染异常') }
      }

      componentDidCatch(error, info) {
        // 不静默吞：控制台留痕，便于把「哪个组件把面板打挂」定位到具体栈。
        // eslint-disable-next-line no-console
        logError('面板渲染异常，已降级显示：', error, info && info.componentStack)
      }

      retry() {
        this.setState({ error: null })
      }

      render() {
        if (this.state.error) {
          const message = String((this.state.error && this.state.error.message) || this.state.error)
          const stack = String((this.state.error && this.state.error.stack) || '')
            .split('\n')
            .slice(0, 6)
            .join('\n')
          return h(
            'div',
            { className: 'dshgn_root dshgn_boundary', role: 'alert' },
            h('div', { className: 'dshgn_boundaryTitle' }, '得到大脑面板渲染出错'),
            h('div', { className: 'dshgn_boundaryMsg' }, message),
            h('pre', { className: 'dshgn_boundaryStack' }, stack),
            h(
              'button',
              { type: 'button', className: 'dshgn_btn dshgn_btnPrimary', onClick: this.retry },
              '重试',
            ),
          )
        }
        return this.props.children
      }
    }

    // 注册进 main 的是这个包装组件，而不是 GetnotePage 本身
    function PanelRoot(props) {
      return h(PanelBoundary, null, h(GetnotePage, props))
    }


// ---- Obsidian 侧导出：ItemView 直接挂 PanelRoot，图标给 ribbon 用 ----
export {
  PanelRoot,
  PanelIcon,
  PanelBoundary,
  GetnotePage,
  injectCss,
  LEX,
  ICONS,
  setUiLocale,
  activeUiLocale,
}

// 离线测试直接验渲染结构用，运行时无影响
export const __internals = {
  renderBlocks, renderInline, stripLeadingHeading, BrokenPane, CalloutBlock, CALLOUT_TONES,
  lineNeedle, scrollToText, LEX, ICONS, AudioPlayer, CloudPane,
  SyncPane, CloudCredCard, SettingsPane, GetnotePage, NotePane, TranscriptBlock,
  looksLikeTranscript, formatMoment, parseTranscript, stampToSeconds, activeTranscriptIndex,
  TrashPane, renderEmbed, assetLabel, ThemeCard, readSession, writeSession, SESSION_KEY,
  themeVars, parseHex, rgbToHsl, hslToHex, ConflictPane, ArchiveCard, CardPane,
  TemplateCard, SkeletonPane, HeatmapStrip, LanguageCard, setUiLocale, activeUiLocale,
  reportSync, dailyTemplateOf, frontmatterText, isTagKey, FollowCard, parseTable, countWords,
  isBlockAnchor, blockIdIn, stripBlockId, scrollToBlock, scrollToFootnote, parseImageSize, renderParagraph, blockTextOf, markdownLinkTarget,
}
