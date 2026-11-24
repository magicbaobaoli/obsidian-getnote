# 更新日志

## 0.1.0

首个版本。功能对齐 DSH 版 `dsh-getnote` 0.6.8。

### 新增

- **本地笔记库面板**：目录树 / 列表 / 正文三栏，Markdown 渲染，编辑保存，新建删除，回收站还原。
- **搜索**：全文搜索，支持 `tag:` / `path:` 限定，结果带上下文。
- **反链 / 大纲 / 标签管理 / 热力图 / 冲突解决 / 历史快照回滚**。
- **归档包**：整库导出 zip、从 zip 导入（合并或覆盖）。导出可选范围：整库 / 只要文字 /
  只要附件，也能只导某个子目录。库里附件常比笔记大两个数量级，备份文字的人不必陪跑几百兆。
- **模板**：最多 12 个正文模板，新建时套用。
- **云端同步**：Open API 与 MCP/OAuth 双通道，自动回退；单向拉取 + 逐条推送；定时自动同步（5–720 分钟，可增量、可仅面板可见时）。
- **录音卡**：蓝牙扫描 / 信息 / 列表 / 导入 / 按名删除，Wi-Fi 热点激活与传输。
- **多语言**：中文 / English / Nederlands，默认跟随 Obsidian 的界面语言（`moment.locale()`），
  用户在面板设置里显式选过就以用户的为准。
- **主题**：22 个主题变量映射到 Obsidian 原生配色，深浅色自动适配。
- **三栏可拖**：左栏 / 中栏之间的分隔条可拖动调宽，也能用方向键微调（Shift 加大步长），
  宽度夹在合理区间内并记在本地。栏宽走根节点的 CSS 变量，三栏的 `width` 全读它，
  不需要为每一栏各写一套状态。
- **命令面板入口**：`Ctrl+P` 里多了五条命令——搜索笔记、新建笔记、打开今天的笔记、
  立即同步、扫描录音卡。命令只「投递意图」，动作由面板自己执行（它才拿得到当前状态）；
  面板还没挂载时意图先存着，挂载后立刻取走，从命令面板打开面板不会丢动作。
- **状态栏**：常驻一行「得到大脑」，悬停显示本地服务端口，点一下打开面板。
- **笔记右键菜单**：卡片上右键出 Obsidian 原生 `Menu`（打开 / 复制引用 / 推到云端 /
  从云端拉下来 / 删除）。面板只给一份「标签 + 动作」清单，弹菜单、定位、键盘导航
  交给宿主；拿不到 `Menu` 的离线环境自动退回面板自己的简易菜单。
- **选区速记**：在任意笔记里选中一段文字，跑命令「得到大脑：选区速记」，这段文字
  落成一篇新笔记：第一行当标题，正文每行加 `>` 前缀变成引用块，末尾注明摘自哪个文件。
  摘录和自己的话必须一眼分得开，所以用引用块而不是直接粘。
- **深链**：`obsidian://getnote?action=search&q=关键词`（还有 `new` / `today` / `sync`），以及 `action=open&path=...` 直接跳到某一篇
  能从任何地方唤起面板并执行动作。只做导航与同步，不做写操作——一个能被任意网页
  触发的 URL 不该有删笔记的能力。
- **同步摘要写进当天日记**：一轮同步结束后把「新增 N 篇、跳过 M 篇、K 处冲突待处理」
  追加到当天日记里。日记路径读 Obsidian 日记核心插件的目录与日期格式设置，插件没启用
  就不写；写失败也不影响同步本身。
- **Bases 视图**：命令「在笔记目录里生成一个 Bases 视图」写一份 `得到大脑.base`，
  里面是全部 / 按标签 / 按日期三个视图，限定在笔记目录里。想自己写公式、自己排表就在
  Bases 里改，不必回到面板。已经存在就不覆盖——用户可能已经调过它了。
- **画布**：命令「把当前笔记放进得到大脑画布」把笔记加成 `得到大脑画布.canvas` 里的一个
  文件节点，没有画布就新建一张。节点存库内相对路径，只补节点不重排布局，同一篇加两次
  也只留一个。
- **逐字稿与音频联动**：云端笔记的逐字稿里，每个 `[mm:ss]` 时间戳都是一个按钮，点一下
  播放器就跳到那句并开始播；反过来，播放时正在念的那一段会高亮（时间戳加重、整段左侧一道
  竖线），扫读时视线不会跑丢。没有音轨的逐字稿不把时间戳做成按钮——按了没反应比不可点更
  让人困惑。跳转用的是「请求对象 + 音轨序号」而不是一个裸秒数：连点同一个时间戳时秒数没变，
  单靠数值比较第二次不会触发。
- **把本地改动推上去**：除了逐条推送，设置页多一个按钮把整库本地改动一次推上去
  （可限定子目录，一次最多 200 篇）。推送前先比内容指纹，没改过的直接跳过——否则每点
  一次都是几百次 `updateNote`，吃配额，还会把云端的修改时间刷成现在，之后判断不了
  云端有没有被别人改过。单篇失败不中断整批，失败的路径逐条列出来。
- **字体与字号跟着宿主**：界面、正文、等宽三套字体和正文字号都读 Obsidian 的 CSS 变量，
  不再自带一套写死的等宽栈（中文在等宽里毫无意义，只是把排版弄难看）。
- **不可逆动作问宿主**：删除 / 清空 / 覆盖弹 Obsidian 原生 `Modal`，默认焦点给「取消」，
  并且保证只回一次话——先点确定再按 Esc 不会回两回。移动端 WebView 里
  `window.confirm` 可能根本不弹，那样等于没有二次确认。
- **在 Obsidian 里打开**：笔记头一个按钮把当前笔记交给宿主编辑器（`getAbstractFileByPath`
  + `openFile`）。面板的编辑器只服务「扫一眼、改两笔」：没有补全、没有 Vim、没有插件命令。
- **宿主 `css-change` 事件**：换主题、换字体、改缩放时立刻重算配色，比盯 `body` 的 class
  更准——改字体和缩放不改类名。
- **反链走宿主的链接索引**：宿主一直在增量维护整库链接图（`metadataCache` 的
  `getBacklinksForFile` / `resolvedLinks`），面板直接问它；以前为了显示一屏反链会把
  全库正文重读一遍再正则匹配。宿主问不到（比如索引还没建好）才退回自己扫，
  返回形状两边一致，界面上不会缺标题。
- **窄窗口能收能放**：面板用容器查询盯自己的实际宽度（不是视口宽度——窗口很宽但
  侧栏很窄是常态），窄了左栏变成抽屉、有笔记时中栏让位，笔记头上有「返回列表」。
  窄窗口的抽屉状态挂在根节点的 data 属性上，样式交给 CSS，逻辑能在 jsdom 里验。
- **编辑态与宿主编辑器同口径**：Ctrl/Cmd+S 保存、Esc 退出编辑。快捷键挂在 window 上
  而不是 textarea 上——按 Ctrl+S 时焦点可能已经点到别处；只在编辑态接管，阅读态
  的 Ctrl+S 该归宿主。
- **状态栏跟着面板走**：库里有几篇、当前开着哪一篇，直接写在 Obsidian 的状态栏上
  （超长标题截断到 18 字，点一下打开面板）。状态栏是用户唯一一直看得见我们的地方，
  只写「得到大脑」四个字太浪费——他既不知道库有多大，也不知道面板里在看什么。
  tooltip 仍然说明本地服务在哪个端口，两件事互不覆盖。
- **快速切换器**：命令面板里一条「快速切换：打开得到大脑笔记」，用宿主自己的
  `FuzzySuggestModal` 列出库里的全部笔记（带目录前缀），选中直接在面板里打开。
  找笔记的第一反应是 Ctrl/Cmd+O 而不是翻 ribbon；顺着这个习惯来，库里的笔记才跟
  宿主自己的笔记一样好找。宿主没提供这个模态框时退回面板自己的搜索框。
- **右键菜单里也有我们**：宿主的 `file-menu` / `editor-menu` 上各挂一条——文件树里
  右键笔记目录里的 Markdown 是「在得到大脑里打开」，同一条菜单里还有「在得到大脑里搜索
  这一篇的名字」（`rel` 去掉目录和 `.md` 后缀就是关键词，投递 `{ type: 'search', q }`，
  填框和聚焦都交给面板自己做——只有它拿得到搜索框），编辑器里右键是「把选中的文字存进
  得到大脑」（没选中就取当前这一行）；选着字的时候还多一条「用选中的文字搜索得到大脑」
  （同样只投递 `{ type: 'search', q }`，空选区不摆——空搜索没有意义）。只往宿主自己的菜单里
  加条目，不接管菜单本身，
  别的插件的条目照旧；笔记目录外的文件一条都不加。菜单里那两条与命令面板里的
  「选区速记」走同一个方法，两边行为不一致的话用户会以为右键那条是坏的。
  文件树给的是库内相对路径，面板要的是相对笔记目录的路径，换算只在 `notePathInVault`
  一处做，别处不再各算一遍。
- **「今天」用宿主自己的日记模板**：「设置 → 核心插件 → 日记 → 模板文件」指向的那篇笔记，
  新建今天的日记时会整个填进去。以前我们建一篇空的，用户在宿主里新建看到有骨架、在我们
  这儿看到白纸，很难不觉得是坏了。宿主记的模板路径是**库内相对**的（相对库根，不是相对
  笔记目录），拿笔记根去拼会变成「得到大脑/得到大脑/模板/…」，于是永远读不到——补子目录
  这件事在别处做，模板这里不能做。读不到一律当没有，不让新建失败。
- **跟着宿主切换笔记**：命令面板里那条「在 Obsidian 里打开当前笔记」是「我按一下，面板
  跟过来」；想让它一直跟着也可以打开这个开关。钩子用的是宿主的 `file-open` 而不是
  `active-leaf-change`——后者在切到空叶子、点侧边栏、拖分栏的时候也发，那些时刻压根没有
  「哪一篇」可跟，还得再判一次。三道闸都是「不做比做好」：不在「得到大脑」目录里的不跟、
  面板没开着的时候不替你把它拉起来、开关关着不动。开关每次都现读一遍设置，不信启动时的
  快照（面板的设置页也能改它）；设置读不出来时按「关」处理——跟随是「面板自己动」，
  出问题时宁可不跟，也不要凭空把你正在看的那篇顶掉。
- **模板能摊开看全文**：自定义模板那一行只露两行骨架，周报、复盘那种几十行的在这一屏
  根本看不出当初写了什么，想知道只能删掉重建一遍。现在每行右边多一颗「看全文」
  （`settings.templatePreview` / `settings.templatePreviewClose`），点一下把整段摊进一个
  `pre.dshgn_tplFull`（保留换行、`max-height:220px` 自己滚，不把设置页撑长），再点一下收回两行。
  一次只摊一个（`previewName` 单值）——摊开两三个，想找的那一个反而更难找。只有标题的模板
  写一句「这个模板只有标题」（`settings.templatePreviewEmpty`）而不是摊一个空框。
- **版本历史留几版，改成设置项**：每篇固定留最近 10 版，这个数字原来写死在 `history.js`
  的 `HISTORY_LIMIT` 里，用户改不了——天天改稿的嫌少，只存定稿的嫌 `.history` 里堆东西。
  现在它是设置项 `historyLimit`（1–200，默认还是 10，升级上来的库观感不变），设置页里多一张
  「版本历史留几版」的卡（`HistoryCard`，输入框 `input.dshgn_historyLimitInput`，回车也能交）。
  口径统一在 `normalizeHistoryLimit`（`settings.js`）与 `clampLimit`（`history.js`，上限
  `HISTORY_LIMIT_MAX = 200`）：所有 `snapshotNote` 调用点都先过 `historyLimitNow()` 现读一遍
  设置（不维护内存缓存，改完下一次保存立刻生效），`handleBatch` 那种一批动几十篇的只读一次。
  调小时 `handleSetSettings` 当场跑一遍 `pruneHistory`，把库里超出的那些裁掉并在提示里报
  「顺手裁掉了 N 版多余的快照」——不这样的话设置页写 3、每篇还得再保存一次才缩到 3 版，
  中间那段时间历史里还躺着 10 版。笔记头那句空态文案也从写死的「最多留最近 10 版」改成
  带 `{n}` 的口径。
- **翻旧版也能看清结构**：版本预览原来只有一种看法——把快照全文塞进一个
  `pre.dshgn_diffBody` 当裸文本读。一篇带标题、表格、列表的稿子翻回旧版时，等于在读配置文件；
  更别扭的是快照存的是**整份文件**，开头那段 YAML frontmatter（`title: xxx` / `note_id: "..."`）
  会跟着铺成正文里的几行字——阅读区早就不这么干了（那边用 `readNote` 切好的 `body`）。
  现在预览顶上多两颗 chip（`button.dshgn_chip` / 选中 ` dshgn_chipOn`，文案
  `history.modeRendered` / `history.modeRaw`，与冲突比对页那两档同一套写法），状态 `historyMode`
  默认 `'rendered'`：渲染档走 `renderMarkdown(bodyOfSnapshot(content), { assets: [], t })` 挂在
  `div.dshgn_diffBody.dshgn_diffMd` 上（只铺正文，frontmatter 交给新加的模块级 `bodyOfSnapshot`
  切掉，认 `---` 开头 + `\n---` 收尾、CRLF 也认、没闭合就当没有头部整份给回）；原文档仍是
  整份文件一字不改的 `pre.dshgn_diffBody`——想核对空格、缩进、头部有没有被动过就看这一档。
- **列表按你定的版数给**：`handleHistoryList` 调 `listHistory(root, path)` 时没传 limit，
  `listHistory` 的默认值是 50，于是「留几版」调到 200 之后第 51 版起在界面上根本看不到——
  设置只负责裁、不负责显，等于白调。现在改成 `listHistory(root, path, { limit: await
  historyLimitNow() })`（`historyLimitNow()` 现读设置、读不到退回 `HISTORY_LIMIT`），
  列表条数与「留几版」始终是同一个数。撞到上限时历史面板头部补一句
  `span.dshgn_fieldHint.dshgn_historyCap`（`history.capped`，带 `{n}`），让人分得清
  「旧版被裁掉了」和「只是没列出来」——不然只看到 3 条会以为更早的版本丢了。
- **那几块白压暗了一档**：中栏搜索框、笔记卡片、设置页整排卡片、弹层原来都是纯白——浅蓝底上
  像贴白纸，深色桌面上整块发亮。更糟的是 `--dshgn-surface` / `--dshgn-surfaceStrong` 这两个
  变量 `themeVars` 两个分支都没给过，深色下弹层与设置卡片一直回落成 CSS 里那个 `#ffffff`。
  现在：默认浅色板 `--dshgn-surface:#eef4fb` / `--dshgn-surfaceStrong:#e3edf8`（原来都是
  `#ffffff`），右栏 `--dshgn-light` 从 `#f7fbff` 压到 `#eff5fc`、`--dshgn-light2` 从
  `#eef6ff` 压到 `#e6eef9`；新增 `--dshgn-well`（凹槽：比所在那一栏略沉一档），中栏搜索框
  `.dshgn_list .dshgn_search` 的 background 从 `var(--dshgn-surfaceStrong)` 改成
  `var(--dshgn-well)`、描边从 `.16` 提到 `.22`（压暗之后描边太浅会糊），设置页那些
  `.dshgn_pane .dshgn_input/.dshgn_textarea` 也从 surface 改成 well；`themeVars` 深色分支
  补 `--dshgn-surface` L 0.215 / `--dshgn-surfaceStrong` L 0.185 / `--dshgn-well` L 0.10，
  浅色分支补 L 0.955 / 0.925 / 0.905，两档都跟着主题色走，不再回落成白。
- **反链一多，先摆前四条**：右栏「引用了这篇的笔记」原来是 `backlinks.hits.map(...)` 全量铺，
  十几条摊在正文底下会把正文挤成一条缝。现在 `shownBacklinks` 默认取 `hits.slice(0, 4)`
  （`BACKLINK_SHOWN = 4`），收起来的条数记在 `hiddenBacklinks`，底下多一颗
  `button.dshgn_backlinkMore`：没摊开时写「+N」、`aria-expanded="false"`，摊开时写「收起」、
  `aria-expanded="true"`，title 复用 `note.moreLinks` / `note.lessLinks`（不新增 LEX 键）；
  换一篇时 `setBacklinksOpen(false)` 重新收起——上一篇摊开过不等于这一篇也要摊开。
- **搜到的不止四十篇时，底下能接着看**：`/search` 原来在面板里写死 `limit=40`，`handleSearch`
  那边最多给三百，中间那二百六十条等于没有入口。现在多一个 `searchTake`（`{ q, n }`，跟着
  这一串词走，换词就回到 `SEARCH_PAGE = 40`），请求带上 `limit=${takeNow}`；`searchScan.truncated`
  且已经全给出来的时候，底下摆一颗 `button.dshgn_btn.dshgn_moreBtn`（外层 `dshgn_searchMoreRow`，
  左右边距跟上面那行「扫了多少篇」对齐），文案 `search.more` 写「再多看 {n} 篇」，按一下
  `setSearchTake({ q, n: Math.min(SEARCH_MAX, takeNow + SEARCH_PAGE) })` 重取；到 `SEARCH_MAX = 300`
  这颗就不再摆，被截那句换成 `search.scanAll`（「一次最多就这么多，再往下要靠收窄词」），
  免得按到底还一直说「后面还有没扫到的」。
- **出链一多，先摆前六颗**：篇尾出链原来是 `outlinkChips.map(...)` 全量铺，十几个 `[[ ]]` 能把右栏
  半屏占掉。现在 `shownOutlinks` 默认取 `outlinkChips.slice(0, OUTLINK_SHOWN)`（`OUTLINK_SHOWN = 6`），
  收起来的条数记在 `hiddenOutlinks`，同一行最后多一颗 `button.dshgn_outlinkChip.dshgn_outlinkMore`：
  没摊开时写「+N」、`aria-expanded="false"`，摊开时写「收起」、`aria-expanded="true"`，title 复用
  `note.moreLinks` / `note.lessLinks`（不新增 LEX 键），样式是虚线边的胶囊而不是整行按钮——它排在同一行
  里，得让人一眼看出不是一条链接。换一篇时 `setOutlinksOpen(false)` 重新收起。
- **读到哪一节，大纲自己跟过去**：大纲列表自己会滚（`max-height:220px`），长笔记几十个小节时，亮着
  的那一条一落到可见区外面就再也看不见，「现在读到哪一节」等于没说。现在给列表挂一个 `outlineRef`，
  再加一个跟着 `activeHeading` 走的 effect：整条已经在可见区里就一下都不动，出去了才把该滚多少算出来
  写回 `scrollTop`。这段数学抽成纯函数 `outlineScrollDelta(hostRect, rowRect)`——容器没高度、输入不是
  数字都返回 0，行在下方为正（往下滚）、在上方为负，算的是「挪到容器中间」而不是「贴着边」。
  只挪这个小列表，正文那边一动不动。
- **大纲一长，顶上那行筛能筛到想找的那一节**：大纲里的筛（`note.outlineFilter` /
  `note.outlineFilterClear` / `note.outlineFilterNone` 三个 LEX 键），只在 `current.outline.length > 6`
  时摆——三五个小节时多一行输入框纯属挡路。`outlineShown` 保留原序号不重排（每项带 `{ item, index }`），
  所以点标题跳转和「亮着哪一节」都还按原来那一节算；行上因此多挂一个 `data-index`，自动滚那个 effect
  从 `rows[activeHeading]` 改成按 `[data-index="N"]` 找——筛着的时候 DOM 顺序已经不是第几节了。
  一条都对不上时摆 `.dshgn_outlineEmpty` 直说，Esc 只清这一个筛。
- **读到底了，一键回顶上**：`.dshgn_scroll` 是右栏唯一的正文滚动区，几千字读到末尾想回开头只能一路
  滚回去。现在 `.dshgn_note` 加 `position:relative`，里面浮一颗 `button.dshgn_toTop`（`position:absolute`
  `right:18px;bottom:16px`，`Icon up` + `reader.toTop`）；摆不摆由纯函数 `toTopVisible(scrollTop)` 决定
  （阈值 `TO_TOP_AFTER = 320`，脏数字一律不摆），滚动保存那个 effect 里顺手 `setScrollPast`，换篇的
  effect 里按记下的位置重算一次；按下去 `scrollTo({ top: 0, behavior: 'smooth' })` 并把
  `scrollTopRef.current` 与 `writeScrollMark(path, 0)` 一起归零，然后自己收起来。编辑态不摆（滚动
  不在正文容器上）。
- **写太长的时候，先别等保存才告诉你存不下**：单篇正文有 2MB 的硬上限（vault 的 `MAX_WRITE`、HTTP
  层的 `MAX_BODY` 都是这个量级），从前只有按了保存、被 413 打回一句英文的 `request body too large`
  才知道。现在加 `NOTE_MAX_BYTES = 2 * 1024 * 1024` 与纯函数 `noteBodyBytes(text)`（按 UTF-8 算，
  中文一个字三字节，没有 `TextEncoder` 时按码点手算），`draftBytes` memo 跟着草稿走；编辑态脚下
  一越过上限就把那句灰字提示换成 `.dshgn_editorBig` 红字（`editor.tooBig`，带 `{size}` 与 `{max}`）；
  `saveNote` 的 catch 里先认 `err.status === 413`，把服务端那句英文换成 `note.tooBig`，并说清
  「拆成两篇再存」。两个键都补齐了英文与荷兰语。
- **冲突攒多了，先筛到要找的那一条**：同步一出岔子，冲突页一次能摆出几十条留档，未处理与
  已处理两区全量铺开，想找某一篇只能一行行往下扫——断链页、待办页、回收站、大纲都有自己的
  筛，就这一页没有。现在 `ConflictPane` 多一个 `filter` state，`needle` 拿留档名（`originalName`
  退到 `name` / `path`）比对，已处理的条目连 `keptLocal` 换算出的 `local` / `cloud` 一起筛得到；
  `pendingItems` / `resolvedItems` 都先过一遍 `keep(item)`，计数跟着筛后的数走。顶上那行复用断链页
  那套 `dshgn_brokenFilterRow` / `dshgn_brokenFilter` / `dshgn_brokenFilterClear`（没新增 CSS），
  一条冲突都没有时不摆；筛着时 `dshgn_brokenFiltered` 报「筛出 {n} 条，一共 {total} 条」。空态
  分两种说法：没筛时照旧「没有待处理的冲突」，筛空时说 `conflict.filterNone`「没有对得上的冲突」
  并给出路（`conflict.filterNoneHint`）。Esc 只清这一页的筛，不顺手收别处的输入。五个新键三语齐。
- **回收站里摊开的开头一段不够看时，就地摊全**：`TRASH_PREVIEW_CHARS = 320` 只摆开头一段，
  尾巴那句 `trash.previewLong` 让人「恢复回去就能看全」——想看一眼被截掉的那段话，得先恢复、
  看完再删回去。现在 `TrashPane` 多一个 `peekAll` state，`shownText` 在 `cut && !peekAll` 时才
  切到 320；截断时尾巴上多一颗 `button.dshgn_trashPeekMore`（虚线胶囊，`aria-expanded` 跟着变），
  点一下整篇摊开、`data-all="true"` 让 `.dshgn_trashPreviewBody` 不再 `max-height:160px`，按钮
  改成「只看开头」，再点回到开头一段。`togglePeek` 里收起与换篇各 `setPeekAll(false)`，不继承
  上一篇摊开的姿势。两个新键 `trash.previewMore` / `trash.previewLess` 三语齐。
- **字号按篇记，不再是全库一刀切**：三档字号原来存在一个全局键 `dshgn.textScale` 上，可它
  其实是「这一篇的观感」——一篇小字扫描件调到「大字」之后，回头看普通正文就嫌挤；调回标准，
  那篇扫描件又变小了。现在另存一份 `dshgn.noteScale`（`{ path, scale }` 数组，最多 80 篇，
  `readNoteScales` / `noteScaleOf` / `writeNoteScale`）：开着哪篇就记在哪篇头上，`scaleNow`
  先看这一篇有没有自己那档、没有才落到全局默认，所以老用户升级上来观感一模一样。选中的正好
  是全局默认那一档时把这笔记录删掉——那跟「没单独调过」是一回事，留着只让这份表越攒越长。
  三颗按钮补了 `aria-pressed`，屏幕阅读器也读得出当前是哪档。
- **空态里那句「点「新建」」旁边真的有一颗按钮**：右栏没打开笔记时，`empty.selectDesc` 一直
  指着顶栏那颗「+」，可空态里什么都没摆——用户得先抬头找一遍顶栏。现在空态里多一颗
  `button.dshgn_emptyBtn`（`empty.newNote`，三语齐），走的是和顶栏「+」同一条 `newNote()`：
  模板、目录、建完当场打开都照旧。
- **嵌进来的那一篇也停在你要的那一节**：`![[笔记#小节]]` 在宿主里是「把那一篇嵌进来、
  停在那一节」。我们原来嵌是嵌了，但永远从第一行开始——用户想看的偏偏是中间那一段，
  还得自己往下翻。现在小节会一路递到嵌入组件上，正文读回来之后滚过去。
  `![[#本节]]` 更极端：它压根没有「另一篇」可嵌，只有一个「滚到这一篇的这一节」的动作，
  以前会拿一个空名字去解析、然后失败。
  嵌进来的那一篇自己不是滚动容器（滚动发生在外层 `.dshgn_scroll` 上），所以是从内容往上
  找到最近的那个滚动容器再算偏移，跟大纲跳转同一套算法：只改 `scrollTop`，横向一点不动。
- **删除线、高亮、注释按宿主那套认**：`~~划掉~~`、`==高亮==`、`%%注释%%` 都是 Obsidian
  自己的写法，标准 Markdown 里没有。以前三种都会连符号一起原样露在界面上——用户看到的是
  「这句有 ~~划掉的字~~ 和 ==高亮的字==」，第一反应是「我是不是写错了」。现在删除线真的
  划掉、高亮真的标黄，注释**一个字都不露**。
  注释这一项尤其不能只当「隐藏」处理：宿主里它是整段不存在，不是小字也不是灰字，留成灰字
  反而会让人以为自己写的没被注释掉。而且它不该参与任何统计——注释里随手写的 `#草稿` 不能
  冒进标签云，注释里那条「先别删」的旧双链不该被报成断链、也不该算进反链，注释里的内容
  更不该出现在列表摘录里。这些口径要是不跟宿主对齐，用户就会遇到「在 Obsidian 里干干净净、
  在面板里冒出一堆奇怪东西」的错位，而且很难自己看出是注释惹的。
  抹注释分两种：要行号的地方（断链体检、反链上下文）用 `maskComments` 保留换行，其余地方
  用 `stripComments` 直接抹平。
- **提示框里的待办不会勾错**：待办是按「第几个」落盘的（同一篇里两条「喝水」很常见，
  按文字改会一次改两行），序号必须与宿主逐字一致。宿主那边逐行扫、跳过围栏，提示框里
  那几行开头是 `>`，压根不算第几个；面板原来把提示框里的一起数了进去，于是勾的是提示框
  里那条、改的却是正文里另一条——勾错了还看不出来。现在渲染提示框时把 onToggleTodo
  摘掉，里面那条只显示、不可点，序号也就不会被吃掉。

- **`[文字](笔记.md)` 也是库内链接**：宿主里除了双链，普通 Markdown 链接写成
  `[会议纪要](随手记/会议.md)`、`[小结](#小结)` 也往库里跳。面板原来一律 target=_blank：
  宿主打不开那个相对地址，点下去什么也不会发生，用户只会觉得链接坏了。现在认得出来的走
  同一套解析（`#小节` 就是本篇的那一节），外站、mailto、附件仍然交给外面。

- **块引用嵌进来只摆那一段**：`![[笔记#^abc123]]` 在宿主里嵌的是那一段。原来我们是整篇
  嵌进来再滚过去——用户看到的还是一整篇，分不清哪一句是被引的那句。现在从正文里把挂了
  那个 id 的那一块抠出来单独摆（段落要整段、列表项只要那一项，围栏代码里的 `^id` 不算）。

- **一段话就是一段话**：宿主里段落中间敲一个回车是「软换行」，接着往下写还是同一句；
  行尾敲两个空格（或者一个反斜杠）才是真的断行。面板原来把整段原文交给行内渲染、靠
  `white-space:pre-wrap` 显示，于是每个换行都断行——同一段在 Obsidian 里是一行话，
  搬过来被切成好几行，版式看着像两篇东西。

- **图片写多大就多大**：宿主里 `![[图.png|300]]`、`![[图.png|300x200]]` 是给图定尺寸。
  面板原来把竖线后面那串当显示文字（图片本来也没有显示文字，那串就直接丢了），图还是
  原样大小，还被缩略图行那条 `max-height:200px` 压住。现在按写的来，写宽度按比例、
  写宽高就都照着来。

- **脚注也有上标**：宿主里 `正文[^1]` 配篇尾的 `[^1]: 注解` 是一条脚注。面板原来
  把定义行当普通段落原样显示——读者会看到一串 `[^1]: …` 混在正文中间，像正文写错了。
  现在正文里只留一个上标（点了滚到那一条），定义收在篇尾一小块里，缩进的续行接上。
  只有引用没有定义时什么都不弹：写了一半是常见的手滑，为这个弹错误比安静更吵。
  看完注解点一下篇尾那一行就跳回正文里引用它的那一句（回车也行，注解正文里的双链
  点了还是按它自己的意思走，不被这一行截走）。

- **块引用也认**：宿主里 `一段话 ^abc123` 是给这一段挂个 id，别处 `[[笔记#^abc123]]`
  就能指到这一段。面板原来把 `^abc123` 当成小节名去找标题，永远找不到，还弹一句
  「这一篇里没有 ^abc123 这一节」——链接没坏，是我们的理解坏了。现在段落、列表项、
  标题都能挂 id，按 id 找块；`^id` 那个记号本身也不显示在正文里（它是给链接用的，
  不是内容）。列表项末尾的 id 和另起一行写的 id 都认。

- **编辑的时候脚下有字数和办法**：编辑区底下原来一直空着。用户不知道按什么保存，也
  不知道自己写了多少——两千字的中文按「词」算会被报成八百，用户会以为丢了一半，所以
  中文按字算、西文按词算，和宿主的字数口径对齐。提示写「Ctrl+S 保存 · Esc 取消」是因为
  这两个键本来就绑好了，只是没人告诉过用户。

- **清单里按回车接着写**：记笔记最常做的一件事是往清单里再添一条，而编辑区原来只会老实
  插一个换行——想写第二条得自己再敲一遍「- 」，有序列表还得自己数到几。现在光标停在列表行
  末尾敲回车，下一行自带同样的缩进和记号，有序列表自动加一，`- [ ]` 接着还是 `- [ ]`
  （新的一条总是没勾的），引用块里写的列表把 `> ` 原样贴回去。空条目敲回车是「这一条不写了」，
  把那行记号收掉、退回上一层——不然一个空方框留在那儿，下次回来还得删。光标停在行中间时
  一律不管：那一下在 Obsidian 里是「把这行拆成两条」，替用户补个记号反而会把他写了一半的
  句子劈开。`Tab` 也从「焦点跳走」改成「把整行挪两格」（`Shift+Tab` 收回来）：缩进的是整行
  不是光标处，空行不补空格，选区跟着一起挪，连着按几下也不会把光标落在错的地方。

- **代码块右上角有个「复制」**：读笔记时想把一段示例命令、报错原文搬去别处，用鼠标划选很容易漏掉
  首尾、还会把旁边的语言标签和缩进一起带上。现在每段围栏右上角都有一个「复制」，点一下搬走的
  就是围栏里那一份原文，缩进和引号一个字不改。只在阅读态出现（编辑态看到的本来就是原文），
  卡片摘要和嵌进来的正文不给——那里没有「复制走」这个去处，点了没反应的按钮比不能点更让人困惑。
- **待办都在一张单子上**：待办写在正文里，想知道「还剩哪些没做」就得一篇一篇翻；
  宿主自己有「搜索 - [ ]」，但那要你先知道这条语法。现在多了一个「待办」页签，点开
  就把全库还没勾掉的方框列出来：哪一条、在哪一篇、第几行。方框就在这一页上，勾一下
  当场划掉、笔记里那一行真的变成 [x]，点文字直接打开那一篇去改。围栏代码块里的方框
  不算（那是示例），注释里的也不算（宿主里根本不显示）。序号必须与阅读区那个方框
  完全同一个口径——逐行数方框、已勾的也算——否则点一下勾错的是别人那一行。一条待办
  埋在几十行之后时，点文字只送到篇首；现在每行多一颗「去这一条」，点它打开那一篇并落到
  写着这条待办的那一行（锚的是那一行文字不是行号）。整份清单要抄去别处时，顶上那颗
  「复制这份清单」按屏幕上这个顺序拼成一段 Markdown：一篇一个 `## 标题`，下面一行一条
  `- [ ] 正文`，抄的是原文而不是被 CSS 截断的省略号，已勾掉的不进去；没有剪贴板权限时
  照旧把正文摊出来让人自己选。几十条散在七八篇里时按篇分组：组头写着这是哪一篇、
  还剩几条，右边一颗「勾掉这一篇的 N 条」把这一篇的一次勾完（仍然一条一条走
  /todo/toggle 写回笔记，中途失败就把已经勾上的重新查一遍——它们确实已经写进笔记了，
  不能还挂在「没做」里）；行里只报「第几行」，篇名交给组头，一行里塞两遍同一个名字只是噪声。
  勾完只把
  那一行从单子上拿掉、不整页重查：重查要读全库正文，等两秒你会以为没点上又点一次。
  命中上限 500 条，超了就明说被截断。这一项要读全库正文，所以和断链一样单独一个端点、
  点开才查，不塞进 /status。
- **一篇里十几条待办，能把这一篇收起来**：按篇分组之后又冒出另一个问题——某一篇塞了
  十几条时，清单会被它一个人撑满，别的篇全被顶到屏幕外面去，想看别处还得先滚过去。
  现在每个组头最前面多一颗小箭头（和左栏标签的 `dshgn_tagFold` 同一套手势），点一下把
  这一篇的行收起来。收起来不等于「这一篇没待办了」：组头、篇名、还剩几条、以及那颗
  「勾掉这一篇的 N 条」都留在原地——「这一篇还剩几条」这个信息不能跟着行一起消失，
  否则收起来之后人会以为这篇清空了。收起来的地方补一行 `.dshgn_sectionDesc` 写
  「这一篇的 {n} 条收起来了」，再点一下原样摊开。折叠状态是 `foldedGroups` 这个 Set，
  按路径记、只活在这次会话里不落盘，和左栏目录/标签的折叠同一口径；收的只是这一篇，
  别的篇不受影响。篇数多的时候顶上还有一颗「全部收起」（`dshgn_todoFoldAll`，`aria-pressed`
  跟着走）：一次把所有组都塞进 `foldedGroups`，先看清「都剩哪几篇」再决定从哪篇开始；
  全收着时这颗按钮自己改成「全部展开」并清空 Set，和左栏那两颗「全部收起」同一套口径。
  只有一组时不摆——一篇收不收就是那一篇自己的箭头，顶上再摆一颗是重复的。
- **待办攒多了，先筛到要找的那一条**：待办页一直只能按篇收起再翻——清单攒到几百条、
  散在几十篇里时，想找「上次那个接口改了没有」得一篇篇点开再点开。现在这一页顶上多了
  一个自己的筛（input.dshgn_brokenFilter，和断链页那副样子同一套样式，不碰中栏那个
  搜索框）：按待办正文或篇名随便对上一个就留下，needle 取 filter.trim().toLowerCase()，
  匹配 item.text 与 item.title || item.path。allItems 是全量、list 是筛完的：顶上那句
  「扫了 {scanned} 篇，还剩 {n} 条没做」照旧报全量（allItems.length），筛着时另补一行
  todos.filtered 写「筛出 {n} 条，一共 {total} 条」；一条都没筛出来时不摆这行——下面
  那一屏已经说清了。空态按 needle 分开：筛空时说「没有对得上的待办」并提示清掉这个筛，
  而不是「库里每一条待办都做完了」那句。copyAll 改成收一个 rows 参数，「复制这份清单」
  传的是 list——抄的永远是你眼前这一份，不是看不见的那几百条。Esc 只清这一页的筛，
  不顺手把别处的输入一起收了。
- **表格的对齐标记也算数**：`| :--- | ---: |` 分隔行里的冒号在宿主里是「这列靠左 /
  靠右 / 居中」。面板原来一律靠左——一份金额右对齐的表格搬过来全部贴到左边，位数不一
  就完全没法对账，而且用户很难看出是「面板没认对齐」还是「表格本身写错了」。现在三种
  都认，没写冒号时不硬塞一个对齐方式，交给 CSS 的默认值。

- **搜到哪一行就落到哪一行**：搜索卡片上一直列着命中行（带行号），但那几行只能看不能点——
  点下去等于点整张卡片，跳到的还是篇首，用户得自己在正文里再搜一遍那个词。宿主里搜出来
  是直接落到那一行的。
  锚用的是那一行的**文字**，不是行号：搜索结果是磁盘上那一刻算出来的，用户刚在别处改过这篇、
  行号一挪，按行号找就指到别的段落去了，而那一行字通常还在。行号照旧留着，它的用处是让人
  判断「这一条值不值得点」。
  原始 Markdown 那一行（带 `##`、`- `、`[[双链]]`、`**粗体**`）得先削成渲染之后大概的样子
  再去正文里找，不然永远找不到。找不到时不弹错误——多半是那一行刚被改掉了，为这个吵一句
  比安静地停在篇首更烦。
  有没保存的草稿时照样先问一句：直接打开会把草稿冲掉，而用户只是想去看一眼搜到的那句话。
  命中行里那个词还做了标记：整行灰字让人自己在里面再找一遍，等于白搜。标的时候按原文写法
  比、不区分大小写，重叠的词（「会议」和「会议室」）按长的先吃；`tag:` / `dir:` 这类限定词
  不去染正文——它们本来就不出现在那一行上，拿它们去标只会把整行染成「没命中」。
- **长表格读到下面，还知道这一列是什么**：一张十几二十行的对照表、词表，滚到下面几屏，表头
  早就滚出去了，只能靠记。现在超过八行的表格单独给一块可滚区域（`.dshgn_tableTall`，
  `max-height:min(70vh,520px)`），表头 `position:sticky` 钉在顶上，横向照样能滚；短表格不加这一层——
  一屏就看得完的表再套一层滚动更别扭。
- **写错的那一行，点一下就送到眼前**：断链页原来点一行只打开出问题的那一篇，而那个写错的
  名字往往在整篇的第三十几行。现在每行旁边多一颗「去这一句」，点它就打开那一篇并滚到写着
  这个名字的那一段。锚的是那一行文字不是行号（用户可能刚编辑过这篇，行号一挪就指到别的段落），
  上下文末尾的省略号先削掉再比对，不然整串永远对不上正文。行主体与这颗按钮拆成两个可点区域，
  因为按钮里再套按钮不是合法结构。
- **断链一次摊出来**：双链写错一个字的时候，当时一点感觉都没有——点下去没反应，过几个月才
  发现一堆死链，那时已经想不起当初想指哪一篇。点开时报一句「找不到」只在那一刻有用，事后
  没有地方能一次看全。现在多了一个「断链」页签：哪一篇、第几行、那一行长什么样，点一行
  直接打开出问题的那篇去改。判定上宁可放过也不能误报——误报会让用户去改一堆本来没问题的
  链接：围栏代码块里的不算，`[[笔记#小节]]` 只看小节前面那段（`[[#本节]]` 是本页跳转，
  直接跳过），`.png` `.pdf` 这些按附件放过，文件名、标题、别名三层都认。命中上限 500 条，
  超了就明说被截断，而不是让人以为库里只有这些。这一项要读全库正文，所以单独一个端点、
  点开才查，不塞进 `/status` 让每次刷新都背上这个成本。
- **搜出来就知道它讲的是哪几篇**：搜索结果的卡片原来只有标题、目录和命中次数。用户知道这
  篇提到了关键词，却不知道它到底在讲哪几篇，还得点进去翻。现在卡片底下直接列出这一篇引用的
  笔记，点胶囊就跳过去，超过四颗收成「+N」。`searchNotes` 本来就把正文读进来了，这一行不
  额外读盘；别名写法（`[[乙篇|别名]]`）只留目标那一段。
- **双链指空了，就地把它写出来**：点一条指向还不存在的笔记的双链，以前只报一句「库里找不到」，
  那一刻你其实就想把这一篇写出来，还得退出去新建、补标题、放对目录。现在报错行后面多一颗
  「写一篇「某某」」：名字取双链里写的那个（去掉两头的斜杠），落在当前这一篇所在的目录里，
  建的时候 withDatePrefix 为 false（照抄原名，叠上今天的日期就指不回来了），建完 refresh 后当场
  打开那一篇。missingRef 在 openWikiLink 落空时记下、在 openNote 成功或切换时清空；报错条从一行
  文字变成 flex 行，那颗按钮用主色而不是错误色——它是一条出路，不是又一句坏消息。
- **同一个错名字，别再报八遍**：断链清单以前一条一行，同一个名字在七八篇里各写错一次就是七八条
  一模一样的红字。现在按 `hit.target` 分组（顺序沿用后端的路径 + 行号），组头写着这个名字被写错
  了几处，右边一颗「写一篇」走 `/create` 在库根建同名空笔记（`withDatePrefix: false`，照抄原名）
  再 `refresh()` + `openNote()`；建完那两处双链当场指得到，这一组也就自己没了。断链里没有
  「它本该在哪」的信息，所以不猜目录，落在库根。
- **整张断链清单，能一次抄走**：`copyAll` 按 `hit.target` 分组（顺序与屏幕上一致），每组一个
  `## [[名字]]` 小标题，每条写成 `- 篇名 · 第 N 行：原文`（原文为空时只写行号），整段 trim 之后走
  `navigator.clipboard.writeText`；抄完 `showToast(t('broken.copied').replace('{n}', 条数))`，
  没有剪贴板权限就把正文摊进提示条让用户自己选。清单为空时不摆这颗按钮——空清单没有可抄的东西。
- **名字打错一个字，别再补一篇同名的**：断链绝大多数不是「少了一篇」，是「写错了一个字」。以前每组
  只有一颗「写一篇」，补出来之后库里就有两篇讲同一件事的了，原来那篇还是没人引。现在组头还多一颗
  「改指到已有的那篇」：填上本来想指的那一篇（`datalist` 里是库里已有的名字），回车全库一起改过去。
  `rewriteLinkTarget(root, from, to, entries, { snapshot })` 先用 `linkLinesOf` 的行记忆挑出真提到这个名字的篇
  （围栏里的跳过、不读盘），再逐行把 `[[旧名]]` 换成 `[[新名]]`——只换目标那一段，后面跟的 `#小节` 和
  `|显示文字` 原样拼回去，CRLF 也照原样；写之前先 `snapshotNote`，写走 `writeNote(..., { backup: false })`。
  改之前先问一句「全库里这 N 处都改过去？」，改完那一组自己从清单上消失。
- **断链一多，先筛到想修的那一处**：`findBrokenLinks` 的 `MAX_HITS` 是 500，一屏翻不完，而想修的
  那一条常常只记得半个名字。`BrokenPane` 新增 `const [filter, setFilter] = React.useState('')`，
  过滤按三处任意命中：`hit.target`（指不到的那个名字）、`hit.title || hit.path`（出处那一篇）、
  `hit.text`（那一句原文），都先 `toLowerCase()`；`allHits` 保留全量、`list` 是筛后那一份，顶部那句
  `broken.found` 报的仍是**全量**，另起一行 `div.dshgn_brokenFiltered` 报 `broken.filtered`
  「筛出 {n} 处，一共 {total} 处」。输入框是 `input.dshgn_input.dshgn_brokenFilter`，Esc 只清这一页的
  筛（`preventDefault` + `stopPropagation`，别顺手收掉别处的输入）。筛空时那一屏换成
  `broken.filterNone` / `broken.filterNoneHint`（「清掉上面那个筛就能看到全部断链。」），图标也从
  `check` 换成 `search`——`broken.empty` 说的是「库里每一条双链都指得到东西」，那是另一件事。
  `copyAll` 跟着改成抄 `list`（筛着的时候抄筛出来的那几处，没筛时就是全量），deps 从 `[hits, ...]`
  换成 `[list, ...]`。CSS 三条：`.dshgn_brokenFilterRow` / `.dshgn_brokenFilter`（`flex:1;min-width:0`）/
  `.dshgn_brokenFilterClear`。LEX 三语五键：`broken.filter` / `filterClear` / `filtered` / `filterNone` /
  `filterNoneHint`。
- **新建时就说清建到哪儿**：新建落在哪原来只看两件事——面板里有没有选中某个目录，没有就
  跟宿主的默认位置（`newNotePlacementOf()`）。想建到别处只能建完再拖或再挪一次。现在模板菜单
  顶上多了一行目录框，和批量移动的目标目录框共用 `searchSuggestions(dirs, [], 'dir', query)`；
  填了字就以它为准（`const typed = newDir.trim()...; const dir = typed !== '' ? typed : activeDir !== '' ? activeDir : newNotePlacementOf()`），
  留空仍按原来那套走。挑一条只 `setNewDir`、不动文件；菜单里按 Esc 只收候选并
  `stopPropagation`，不把整张菜单关掉。
 - **刚建好的目录，别让它当场消失**：以前左栏只认有笔记的目录（`scanVault` 只收 .md），
   刚建好一个准备往里写，它当场就不见了，看着像根本没建成。现在 `scanVault` 顺手把走过的目录记进
   `allDirs`、把有笔记的记进 `filled`，两者之差就是 `emptyDirs`；`buildTree(entries, emptyDirs)` 用
   `ensure(rel)` 逐段补出节点、计数 0，`listDirs(entries, emptyDirs)` 也让它们进目录清单（新建时的
   目录框因此挑得到）。不传 `emptyDirs` 时行为与以前一致；`/dir/create` 的返回仍带 `empty: true`。
- **批量加标签，也不用背标签名**：库里标签是斜杠套斜杠的，凭记忆打一个「读书/笔记」而库里叫
  「读书/摘抄」，加进去的结果是几篇一起贴上一个新标签、旧的还在。现在标签框跟搜索框、目标目录框
  共用同一套 `searchSuggestions`：标签清单来自列表里已经有的那些（`searchTags` memo，不额外读盘），
  上下键挑、回车或 `onMouseDown` 填进去，Esc 先 `stopPropagation` 收候选而不清掉已填的字。挑一条只
  `setBatchTag`、不动文件，加/去还是要再点那颗按钮。
- **批量挪目录不用再背目录名**：批量条里的「移动」原来是个空输入框，目录名得凭记忆手打。
  打错一个字不是「没找到」，而是当场新建一个目录，事后才发现多出来一摊空壳。现在敲字就把
  库里已有的目录摆出来——复用搜索框那套 `searchSuggestions(dirs, [], 'dir', query)`，目录清单
  来自 `/tree` 响应里已有的 `dirs`（`listDirs` 生成，含库根空串），不额外读盘。上下键挑、
  回车或者点一下（`onMouseDown`，`onClick` 要等松手、那时输入框已失焦）填进输入框，Esc 先收
  候选不把已经填好的清掉。挑一条只 `setBatchDir`、不动文件，填好再按「移动」才真的调 `/batch`
  ——一步选目标、一步动手。
- **目录名打错了，右键就能改**：目录名就是磁盘上的文件夹名，所以以前只能去系统里改名、
  再回来逐篇搬，注释里一直写着「那是另一个功能」。现在目录行右键多一项「改名」，跟改标签共用
  同一条输入行（`.dshgn_treeNew*`，按 `renaming.kind` 派给 `onRenameDir` 或 `onRenameTag`），
  填个新名字回车就整棵搬过去。后端是 `renameDir`（src/core/vault.js）一条 `rename` 搬走整棵树，
  不会出现搬了一半；撞上已有目录回 409（Windows 上同名 rename 会静默覆盖空目录、别处又是
  ENOTEMPTY，所以先自己 stat 一次说清楚）、填的是 `.trash` 这类保留目录名回 400、原目录不在
  回 404。版本历史也跟着搬（`moveHistoryEntries`，src/core/history.js，按 `historyKeyFor` 的前缀
  匹配，目录自己那一篇和底下所有笔记都算，单条失败就跳过——丢一版历史不该让整个改名失败）。
  正开着的那一篇要是在这棵子树里，`setCurrent` 把 `current.path` 换到新位置，否则再按保存
  会写回旧地方、旧目录里凭空多个副本；`activeDir` 正好是它也跟着换。
- **想往哪个目录里写，就在那个目录上点右键**：顶上那颗「+」的模板菜单虽然能填目录，但只想在
  某个目录里起一篇空笔记时，还是得先把目录名打一遍。现在目录行右键多一项「在这里新建笔记」
  （`tree.menuNewNote`），走同一条 `/create` 把 `dir` 钉成这个目录、标题用 `t('action.new')`、
  正文留空，建完 `refresh()` + `openNote()` 当场打开。只在目录行出现——标签不是文件，没地方放。
- **整个左栏嫌乱，一颗按钮全收起来**：目录和标签各攒到二三十支之后，一支一支点小箭头是几十次
  点击，而「只想看看顶层有哪几摊」恰恰是最常见的一眼需求。现在 `headActions` 在排序按钮左边多摆
  一颗 `.dshgn_treeFoldAll`（`Icon` 的 `chevron`，10px，默认 `rotate(90deg)`、`data-folded` 为 `true` 时
  `rotate(0)`，和行里那颗箭头同一个方向语言）：按一下 `setFolded(new Set(dirFoldable))` 或
  `setFoldedTags(new Set(tagFoldable))`，再按一下传空 `Set` 全摊开。判定「现在是不是全收着」用的是
  `dirFoldable`/`tagFoldable`（`flat`/`tagTree` 里 `hasKids` 为真的那些路径）而不是数个数——收起来之后
  子行本来就不在列表里了，个数会跟着变，拿它比永远对不上。两区各自记各自的 `Set`，目录那颗不会顺手
  把标签也收了；这一区全是叶子（没有可收的行）时那颗按钮根本不摆，免得按了什么都不变。同样不落盘。
- **标签多的时候也能收起来**：标签按斜杠摊成层级之后，同一支底下会攒出七八行，把整个左栏顶下去。
  现在 `tagTree` 的每一行多带一个 `hasKids`（`item.children.size > 0`），有子标签的行前面摆一颗
  `.dshgn_tagFold`（`Icon` 的 `chevron`，11px，默认 `rotate(90deg)`，`data-folded` 为 `true` 时 `rotate(0)`），
  `walk` 里 `if (hasKids && foldedTags.has(path)) continue` —— 子标签连同更深的那些一起从列表里消失，
  而不是只把箭头转个向。折叠状态记在单独的 `foldedTags` 里而不是复用目录那套 `folded`：同一个名字既
  可能是目录又是标签前缀，收一个不该顺手把另一个也收了。箭头在胶囊外面（`.dshgn_tagWrap` 里胶囊前面），
  因为胶囊自己就是 `button`、按钮里不能套按钮；`onClick` 先 `stopPropagation()` 再折叠，右键箭头弹的是
  同一个标签菜单。收起只影响子标签、父标签自己还在，点它照样把这一支的笔记全筛出来。同样不落盘。
- **目录多的时候能收起来**：左栏是整库的目录树，平时常去的那几支之外全摊着，一屏塞不下。
  现在每一行前面多一颗小箭头（`.dshgn_treeFold`），点一下把这一支折下去：`flat` memo 的 `walk`
  遇到 `folded.has(child.path)` 就 `continue`，子目录和更深的那些行一起从列表里消失，而不是只把
  箭头转个向、下面的行照旧摊着。节点上多带一个 `hasKids`，没有子目录的行摆一段等宽占位
  （`.dshgn_treeFoldGap`）——同一层的名字必须对齐，不能因为少一颗箭头就往前挪一格。箭头自己是一颗
  `button`（按钮里不能套按钮），`onClick` 先 `stopPropagation()` 再折叠，否则点箭头会顺带把那个
  目录选中；右键箭头和右键这一行一样弹目录菜单。折叠状态只活在这一个会话里（`useState` 里那个
  `Set`），不落盘——存下来反而会在下次打开时「我明明记得它是展开的」。
- **左栏自己也有一个筛**：目录和标签都攒到上百行之后，想找「录音卡」那一支得滚半天；中栏那个
  搜索框打的是笔记正文，拿它当目录筛选会让两件事混在一起——人分不清自己是在搜笔记还是在找目录。
  现在「全部笔记」行下面多一格 `input.dshgn_treeFilterInput`（`.dshgn_treeFilter`，细一号、压在
  热力图上面），只筛左栏：`filterTreeRows(rows, text)` 拿 `row.path` 小写包含匹配，命中的那一支
  连同它的所有祖先前缀（`parts.slice(0, i).join('/')`）一起进 `keep`——目录树和标签云都是靠缩进
  表示层级的，只留命中行会让它看着像从天上掉下来的。`flat` 和 `tagTree` 两个 memo 都过这一道，
  中栏的 `query` 一个字都不动。敲个肯定没有的词时摆一行「没有对得上的目录或标签」，而不是留一片
  空白；`Escape` 先 `preventDefault()` + `stopPropagation()` 再清，只清左栏这个筛、不冒到页面级那个
  Esc 上去。状态不落盘，和 `folded` / `foldedTags` 同类。
- **头部里写着的那条链接，点得开**：`相关: "[[另一篇]]"` 这种写法在笔记头部很常见，而属性区
  以前只认 `tags` 那一种能点的值，其余一律 `row.text` 原样摊出来——摆着一条通向另一篇的路，
  却要用户自己去左栏翻。现在 `propRows` 多算一个 `link`：整串匹配 `/^\[\[([^\]\n]+)\]\]$/`
  （只有整串是双链才算，`见 [[另一篇]] 里` 这种夹在句子中间的不动），再按 `|` 拆显示名、按 `#`
  拆小节，渲染成 `button.dshgn_propLink`，点了走 `onOpenWikiLink(target, anchor)`——和正文双链
  同一条路（路径全等 → 文件名 → 标题 → 别名四级退让，找不到才报错）。样式跟标签胶囊同款但颜色
  走链接色：点了会跳和点了会筛，一眼分得清。`onOpenWikiLink` 没接上时退回原样文字。
- **一整摊事，一颗按钮先全勾上**：批量加标签、挪目录、删掉都要先一张张点勾选框，想统一处理这一摊
  几十篇时那是几十次精确点击。列表顶上那颗 `button.dshgn_pickAll`（复用 `.dshgn_listSort` 那颗小方钮）
  一次把 `shown` 里这些卡片全选上，`aria-pressed` 与 `data-on` 跟着 `allShownPicked` 走，已经全勾着时
  title 与文案换成「取消勾选」、再按一下 `setPicked(new Set())`。只勾当前这次筛选的结果而不是整个库，
  因为用户眼睛盯着的是屏幕上这一摊；`shown.length === 0` 时这颗按钮不摆——按了什么都选不中比没有更糟。
  搜索态也摆：搜出来十几篇一起加个标签正是最需要它的场合。
- **贴错标签能一起撕掉**：批量条以前只有「加标签」，想去掉一个贴错的标签得逐篇打开改 frontmatter。
  现在标签输入框旁边多一颗「去标签」，勾几篇、敲个名字、按一下，头部那个标签和正文里写着的
  `#标签` 一起去掉。后端 `/batch` 多了 `untag` 一个 action，实现跟加标签同一套：`readTags` 读真实标签
  而不是信扫描快照、`rewriteTags` 只换 tags 那一段、`applyInlineTagEdit` 抹正文里那个 `#标签`
  （只改头部的话正文还留着，下次扫描它又长回来），走历史不留 `.bak`。本来就没这个标签的篇目算
  「处理过了」（`changed += 1`）而不是进失败清单——用户勾十篇、其中三篇本来就没这个标签，那三篇
  不该被报成失败。
- **勾好的那几篇，引用一次抄走**：勾选本来就是「这几篇是一伙的」，想把它们的链接一次抄进另一篇当索引，
  以前只能一篇篇右键「复制引用」。现在 `.dshgn_batchBar` 上多一颗 `batch.copyRefs`（「复制引用」），
  点它调 `copyPickedRefs()`：按 `picked` 逐条问 `markdownLinkOf(path)`（Wiki 还是 Markdown、路径写全还是
  写短都是宿主的偏好），问不到就退回 `[[路径]]`——那是 Obsidian 里最通用的写法；
  `navigator.clipboard.writeText` 之后 `showToast(t('batch.copiedRefs').replace('{n}', ...))`，
  抄不出去就把清单摊进提示条。抄完**不清选中**——顺手还想给这几篇贴同一个标签、挪进同一个目录，
  清了就得从头再勾一遍。
- **没成的那几篇，会点名说是哪几篇**：`handleBatch` 一直有回 `failed: [{ path, error }]`
  （src/core/service.js:1384），但 `runBatch` 只读了 `changed`，部分失败时提示条写「已处理 8」，
  剩下两篇的下落一个字都没有。现在 `reportBatchFails(json)` 把 `failed` 收成 `{ path, error }`
  列表存进 `batchFails`（只留前 8 条：挂掉几十篇时摊满一屏不比「还有 N 篇」更有用），渲染成
  `.dshgn_batchFails` 一行一条（`.dshgn_batchFailItem` 写路径、`.dshgn_batchFailWhy` 写原因，
  title 也是原因），旁边一颗「知道了」清掉。`runBatch` / `dropIntoDir` / `moveNoteTo` / `addTagTo`
  四条路都过这一道，提示条也补一句 `batch.partial`（「有 N 篇没成」）。清单**不跟着批量条一起消失**：
  `clearPicked()` 会把批量条收起来，但「刚才那一下哪儿没成」跟当前选中无关，得留着让人看完。
- **按住 Shift 点第二下，连着一整段都勾上**：一次要勾十几篇时，一张一张点勾选框是纯体力活。
  现在 `pickAnchor` 记着上一次点的那一张（和 `picked` 分开存——起点不一定是勾着的），
  `pickRange(fromPath, toPath)` 按当前 `shown` 的顺序取中间那一段一起勾；这一段本来就全勾着时
  再 Shift 点一下就是整段取消。`togglePick(path, extend)` 多收一个 `extend`，勾选框的 `onClick` /
  `onKeyDown` 把 `event.shiftKey === true` 递进去。提示按 `pickedCount` 改口：没勾过时
  `batch.pickHint`（「按住 Shift 再点一张，连着把这一摊都勾上」），勾过之后 `batch.shiftHint`。
- **卡片上就摆着这一篇的标签**：光看标题、日期和目录，常常想不起这篇属于哪一摊事。现在卡片
  底下摆出这一篇的标签（`entry.tags` 已经把行内 `#标签` 合并进来了），最多三颗、多的收成 `+N`——
  标签多的一行会把目录挤没，宁可不显示。点一颗按它筛：`setActiveTag(tag)` + `setActiveDir('')`；
  标签多的时候先摊开看一眼，再决定按哪个筛。
- **收起来的那个 `+N`，点一下就在原地摊开**：卡片底下最多摆三颗标签、多的收成 `+N`，可那个 `+N`
  以前只是个数字——想知道这篇还剩哪些标签，只能打开去右栏翻属性区。现在它是一颗真按钮
  （`button.dshgn_cardTagMore`）：点一下 `openTags` 记上这个 path，渲染时改用完整的 `entry.tags`，
  `.dshgn_cardTags[data-open="true"]` 放开 `flex-wrap` 让它换行摊出来，按钮文字换成「收起」、
  `aria-expanded` 跟着翻。再点一下收回三颗。摊开只 `stopPropagation()`，既不 `setActiveTag()` 也
  不 `openNote()`——它是一扇窗，不是一次筛选。`openTags` 按 path 记而不是按索引：列表会随搜索和排序变。
- **卡片上那个目录，也点得动**：卡片 meta 行里 date / dir / 标签都在，原来只有标签能点——看到一篇在
  `随手记/录音卡` 底下，想找同一摊的其它篇，只能回左栏一层层展开。现在 `entry.dir` 渲染成
  `button.dshgn_cardDir`，点一下 `setActiveDir(entry.dir)` + `setActiveTag('')`，和点标签是同一对动作
  （两者互斥，按目录筛就把标签筛让出来）。`stopPropagation()` 之后既不 `openNote()` 也不进批量，
  悬停那句「筛这个目录：<目录名>」把点下去的后果写在前面。
- **热力图上点某一天就按那一天筛**：`HeatmapStrip` 的格子原来只有 `title`
  （`日期 · N 篇`），知道那天写了几篇却打不开那几篇。现在 `day.count > 0` 且传了 `onPickDay` 时
  渲染成 `button.dshgn_heatCell`（带 `data-on` / `aria-pressed`），点一下 `setActiveDay(day)`，
  `visible` memo 里按 `entry.date` 过滤；再点同一颗传 `''` 取消。空日仍然退回 `span`：点下去只会
  筛出一屏「没有笔记」。筛选胶囊条多了第三颗 `data-kind="day"` 的日期胶囊，`onPickDay` 非空时还会
  把 `activeDir` / `activeTag` 一起清掉——两个条件一叠加常常是空的。格子是 7px 的小方块当按钮用，
  必须 `appearance:none;padding:0;border:0` 清干净，否则会被浏览器默认样式撑大、整张图错位；
  选中只加一圈 `box-shadow` 不改底色，免得和 `data-lv` 的深浅打架。
- **卡片上那个日期，也点得动**：卡片 meta 行里日期本来只是一段灰字，看到一篇是某天写的、想找同一天
  的其它篇，只能先去热力图上找那颗小格子。现在 `entry.date` 渲染成 `button.dshgn_cardDay`（带 `data-on`），
  点一下 `setActiveDay(entry.date)` 并把 `activeDir` / `activeTag` 一起清掉（和热力图同一套互斥），
  再点同一篇的日期传 `''` 取消。`stopPropagation()` 之后不 `openNote()`——它是筛选，不是打开。
  已经在按这一天筛着时那颗日期带下划线（`data-on="true"`），不用回头看左栏那颗胶囊。
- **版本历史里那一版和现在差多少，打开就说**：点开一版以前只能看正文，多几行少几行得自己比对。
  `diffLineCounts(fromText, toText)`（滚动数组 LCS，两边都按 `\n` 切成行、结尾那个空串先 pop 掉）
  算出 `{ added, removed }`；`from.length * to.length > 4000000` 时退化成多重集差，免得 O(n·m) 把面板
  卡住。`historyDiffBadge()` 把非零的那几项拼成「恢复后多 3 行 · 少 1 行」，一项都没有时写「和现在一样」
  ——空着不写会让人以为没算。预览头部那颗 `span.dshgn_historyDiff` 紧跟保存时间，**参数顺序是
  `historyDiffBadge(现在的内容, 这一版)`**：方向是「从现在换成这一版」，反过来读会把多写成少。
- **面板开不出来的时候，得说一句**：`activateView` 的调用方几乎全是 `void this.activateView()`，
  里面抛出去就是一条没人接的 Promise 拒绝——屏幕上没反应、`boot.txt` 里也一个字不留，用户只能对着
  黑屏猜。现在整段包在 try/catch 里（真身拆到 `openPanelLeaf(newWindow)`），失败时写一行
  `activateView 失败：<原因>` 进轨迹，再弹一句「得到大脑：面板没能打开 —— <原因>」。挑叶子前后也各留
  一行轨迹（`准备挂上视图：有叶子` / `setViewState 已返回`），下次再出问题能一眼看出卡在哪一步。
- **搜索卡片上那行「它引用了谁」，收起来的也点得开**：搜索态卡片底下摆 `entry.links.slice(0, 4)` 颗
  胶囊，多的收成 `+N`——可那个 `+N` 原来是个 `span`，只是个数字。现在它是 `button.dshgn_cardLinkMore`：
  点一下 `openLinks` 记上这个 path，渲染时改用完整的 `entry.links`，`data-open` 跟着翻，按钮文字换成
  「收起」，再点收回四颗。`stopPropagation()` 之后既不 `onOpenWikiLink()` 也不 `openNote()`——摊开只是
  把话说完，不是跳走。`openLinks` 同样按 path 记，列表随搜索和排序变的时候不会摊错卡片。
- **搜索框记得住库里的目录和标签**：`tag:` / `dir:` 是省时间的写法，可目录名到底带不带斜杠、
  标签有没有嵌套，全凭记忆——记错一个字，搜出来就是空的，还不知道是自己打错了。现在敲到一半
  就把库里已有的目录名和标签名摆成胶囊（`dir:随` 只摆目录、`#读` 只摆标签、裸词两边都摆，打头
  的排前面），上下键挑、回车补进去。补全只认正在敲的那一个词，光标后面已经有空白就不再提示；
  Esc 先收候选而不是清空搜索框。候选条不额外读盘，目录来自 `/tree`、标签来自列表里已有的那些。
- **哪些双链还是空的，一眼看得出来**：一篇笔记里十几个双链，原来它们和真链接长得一模一样，
  点下去才知道哪个指向的笔记还没写。现在解析不出来的链接加一个 `dshgn_wikilinkDead`：暗一档、
  下划线改虚线（宿主里也是这样），悬停带一句「库里找不到「某某」这篇笔记」，点下去仍走原来
  那条路报错。判定复用 `resolveNote`（文件名 → 标题 → 别名 → 宿主索引），不另起一套口径；
  没接上解析函数时一律不标暗——判断不了就别乱标。`[文字](笔记.md)` 那种方括号写法同样适用。
- **出链里哪一条还是空的，同样看得出来**：篇尾那排出链是这一篇自己写下的名字，写错一个字或者
  那篇还没开始写，在胶囊上和真链接一模一样。现在 `outlinkChips` 从一串字符串改成
  `{ text, dead }`（`dead` 由同一个 `resolveNote(text) === ''` 判出来，与正文双链共用一套口径），
  指不到的那些挂 `dshgn_outlinkDead`：底色退回透明、文字转三级色、加一圈 0.5px 细边框，悬停说
  「库里找不到「某某」这篇笔记」，点下去仍走 `onOpenWikiLink` 报同一句错。没接上 `resolveNote` 时
  `dead` 恒为 `false`——判断不了就别乱标。
- **读到一半想知道这篇在库里的哪儿，点路径就行**：笔记头那行路径以前只是字，
  想看它在库里的位置得回列表、右键、再找「在文件列表里定位」，绕一圈。现在这行
  字自己就是入口——点一下（回车、空格也行）就把路径交给宿主，文件列表在它旁边展开。
  能点的那一版加了虚下划线，悬停变主色；宿主没这个接口时它退回纯文字、`role` 也不留，
  不留一个点了没反应的样子。
- **拖到左栏那个目录上，就挪进去了**：把一篇从 A 目录挪到 B 目录，以前得先勾选、再在批量条
  里挑目录；而拖动本身已经把目标指得很清楚。现在卡片拖到左栏某个目录行上松手就挪过去，
  那一行先亮起来告诉用户「放这儿」。同一次拖动还带着给宿主编辑器用的链接（`text/plain`），
  只有落在左栏目录上才算挪动（面板私有 MIME `application/x-getnote-path`）——从宿主文件树
  拖进来的文件不带这个类型，仍走「导入」那条路。`/batch` 的响应多带一份 `moved`（从哪到哪），
  面板正开着被挪那篇时据此把笔记头改到新路径，否则下一次保存会写回旧位置。
- **拖到左栏那个标签上，就贴上了**：给一篇笔记加标签，以前得勾选、再在批量条里敲标签名。
  同一份拖动现在也能落在左栏的标签胶囊上——`onDragOver` / `onDrop` 认的仍是那个私有 MIME
  `application/x-getnote-path`，落点换成 `button.dshgn_tagRow`。高亮用 `data-drop`，样式只加一圈
  主色边框、不换底色：胶囊的底色已经用来表示「正按这个标签筛着」（`data-on`），再用底色表示
  「要贴上去」两种状态会混在一起。放下后走同一个 `/batch` 端点、`action: 'tag'`、只带这一条
  路径；正开着这一篇时用 `openNote(path, false, true)` 重读一遍（第三个参数是 reload），头部
  标签行才会当场长出来。拖放状态和目录的 `dropOn` 分开记（`dropTag`），两区不会互相留着高亮。
- **删掉的东西，放回你指定的那个目录**：回收站里恢复一篇时文件只能落回库根——回收站里的
  文件名是 `.trash/<时间戳>__<原文件名>`，原目录没记下来，`restoreNote(root, trashPath, targetRel)`
  不传 `targetRel` 就退回 `meta.originalName`。现在回收站页的说明行下面多一行 `input.dshgn_input`
  （`.dshgn_trashTarget` 里），敲字时用 `searchSuggestions(dirs, [], 'dir', targetAt)` 出候选，
  选中后按「恢复」就把 `target` 拼成 `<目录>/<原名>` 交给 `POST /getnote/restore` 的 `target` 字段；
  留空仍传空串、老行为不变。候选按钮用 `onMouseDown` 而不是 `onClick`——click 要等松开，那时输入框
  已经失焦。同名冲突照旧不覆盖，由 `restoreNote` 加 `-2`/`-3` 后缀。
- **不说放哪，就回它原来那个目录**：上面那行目录框留空原本等于「丢回库根」，可一篇原本在
  `做过的项目/` 的笔记救回来还得自己再挪一次——`trashNote` 把文件改名成
  `.trash/<时间戳>__<原名>` 时，原目录就丢了。现在 `trashNote` 顺手把原目录记进
  `.trash/.origins.json`（`rememberTrashOrigin`，读-改-写走 `queueTrashIndex` 串成队列，
  `TRASH_INDEX_MAX = 5000` 只留最近那些），`listTrash` 每项多带一个 `originalDir`，
  `restoreNote` 在 `targetRel` 为空时先查索引、`normalizeRel` 过就拼回
  `<原目录>/<原名>`，查不到才退回 `meta.originalName`（库根，老行为不变）。恢复与永久删都会
  `forgetTrashOrigin` 抹掉那条记录；清空整个回收站时跳过 `.origins.json`（它不算回收站里的东西，
  否则 `purged` 长度会多算一个），最后连索引一起删。面板每行多一行 `div.dshgn_cardMeta.dshgn_trashOrigin`
  写 `trash.originalDir`「原来在」+ 目录（空目录写 `trash.vaultRoot`「库根」），
  `trash.restoreTo` 的占位文字改成「留空就放回原来那个目录」。
- **回收站攒多了，先筛到要找的那一个**：删了几十个文件之后，想找「上周删的那篇周报」只能
  一行行往下翻。现在回收站顶上也有自己的筛：`input.dshgn_input.dshgn_brokenFilter`（复用断链页
  那三条 CSS），`const [filter, setFilter] = React.useState('')` + `needle = filter.trim().toLowerCase()`，
  `allItems` 是全量、`list` 按名字（`title` 与 `originalName` 一起）或原目录（`originalDir`）过滤。
  名字和原目录一起对：只记得目录的人也能一次筛出整个目录里删掉的那些。下面一行
  `div.dshgn_sectionDesc.dshgn_trashFiltered` 报 `trash.filtered`「筛出 {n} 个，一共 {total} 个」，
  一个都没筛出来时不摆这行。空态按 `needle` 分叉：图标 search 而不是 trash、标题
  `trash.filterNone`「没有对得上的文件」、描述 `trash.filterNoneHint`。勾选状态那条
  `React.useEffect` 的依赖从 `list` 改成 `allItems`——对筛出来的那一摊算，等于一敲字就把
  「已选 3 个」清成 1 个。`button.dshgn_btnDanger`「清空回收站」的 `disabled` 也从 `list.length`
  改成 `allItems.length`：它清的是整个回收站，筛着的时候照样该按得动。
- **删之前先看一眼，不用先恢复出来**：回收站里只剩一个文件名，要确认「是不是这一篇」以前只能
  先恢复出来看。现在每一行多一颗 `button.dshgn_trashPeekBtn`（`aria-expanded` 跟着摊开状态走），
  点开走 `GET /getnote/read?path=<.trash 里那条路径>`——`readNote` 只要求路径在库根内，
  `.trash/` 也在里面，所以能直接读那一份原文。摊开的是 `note.body`（不带 frontmatter），
  最多摆 `TRASH_PREVIEW_CHARS = 320` 个字，尾巴用 `trash.previewLong` 说明还剩多少没展开；
  读失败写「这一篇读不出来了」+ 原因，空正文写「这一篇删的时候就是空的」。一次只摊一篇
  （`peekPath` 单值），只读不碰文件，恢复和永久删都不受影响。
- **删之前先问一句「还有谁提到它」**：`deleteNote` 以前直接 `POST /delete`，断链长在
  别人的正文里，删的人看不见。现在先走一次 `GET /getnote/backlinks?path=…`，`hits` 非空时
  用 `confirmDialog` 问一句：`note.deleteLinked` 带 `{n}` 与 `{names}`（前三篇篇名，
  多的补「等」），`confirmText` / `cancelText` 分别是 `note.deleteLinkedOk`「还是要删」与
  `note.deleteLinkedCancel`「先不删」。选「先不删」直接 return，`finally` 收掉忙碌态；
  选「还是要删」才真的 `POST /delete`。一篇都没提到它时不弹这一问；反查抛错也当没提过
  ——诊断失败不该拦住用户删自己的笔记。
- **批量删之前也先反查一句「这几篇里谁被人提到过」**：`deleteNote` 会查，批量删除那条路
  却只 `confirmDialog` 一句「确定把这 N 篇移到回收站」——勾了十篇里
  有三篇在别人正文里被引用，删完那三处就变成点不动的死链，删的人事先一点提示都没有。
  现在批量删除按钮改走新的 `deletePicked`：先 `GET /getnote/backlinks/many?path=…&path=…`
  一次问清（服务端 `findBacklinksMany` 只走一遍全库，不是一篇一遍），有人被引用时用
  `confirmDialog` 问 `batch.confirmLinked`（带 `{n}` 总数、`{m}` 被引用篇数、`{names}` 前三篇篇名），
  `confirmText` / `cancelText` 是 `batch.confirmLinkedOk`「还是要删」与 `batch.confirmLinkedCancel`
  「先不删」；一篇都没被提到时仍走原来那句 `batch.confirmDelete`。反查抛错也当没提过。
- **目录不是空的也能删，但笔记是进回收站、不是真没**：`removeDir` 只肯删空目录（数到 md 就
  409 + `notes`，数到子目录就 409 + `dirs`），撞上「还有 12 篇」只剩「先一篇篇移走」一条路。
  现在 `handleDeleteDir` 认 `recursive: true`，走新的 `removeDirTree`：先 `walk` 收集整棵子树里的
  笔记（跳过 `IGNORED_DIRS`），逐篇 `trashNote` 进 `.trash/`，有一篇失败就整个停下并回 409 +
  `failed`（目录留着，不留半个现场），全搬完才 `rm(abs, { recursive: true, force: true })`
  删掉剩下的空壳。前端在右键菜单点「删除」时先 `GET /getnote/dir/contents?dir=…` 数一遍
  （走同一次 `scanVault`，不额外读盘），确认框里用 `tree.deleteDirNotEmpty` + `tree.deleteDirHas`
  报「里面还有 12 篇笔记、3 个子目录」，旁边多一颗 `button[data-recursive="true"]`
  （`tree.deleteDirRecursive` 带 `{n}`；只有子目录时用 `tree.deleteDirSubs`），目录非空时原来那颗
  「删除」置灰（按了也只会 409）。删完提示 `tree.deleteDirRecursiveDone` 说「目录已删，12 篇在回收站里」。
- **回收站里攒了一堆，一次挑几个一起动**：一行行点「恢复」是体力活，而「放回哪个目录」本该
  一次说清——分开点等于把同一个目录名敲十遍。现在 `TrashPane` 新增 `picked`（Set 存路径）+
  `pickedCount`，每行左边一颗 `span.dshgn_pickBox.dshgn_trashPick`（回收站里一直显形，不走
  `.dshgn_card:hover` 那套），勾上之后渲染 `div.dshgn_batchBar`：`span.dshgn_batchCount`
  报「已选 N 个」+ 全选 / 取消选择 / 恢复这几个 / 永久删除这几个。恢复走新的
  `POST /getnote/trash/restore/many`（body `{ paths, target }`）→ `restoreNotes(root, paths, targetRel)`
  串行调 `restoreNote`，同名照旧加后缀、单个失败收进 `failed` 不连累其余；永久删走
  `/trash/purge/many` → `purgeTrashMany`。两条复数路由必须排在单数之前，否则
  `parts[2] === 'restore'` 会把 `restore/many` 一起吃掉。提示在部分失败时拼
  `trash.restorePickedFailed`（「已恢复 2 个 · 有 1 个没能恢复」），不把半成功说成全成；
  恢复/清空后 `setPicked(new Set())`，另有一个 effect 按新列表把已经不在的路径落掉。
- **引用某一节，不用自己拼链接**：想引用长笔记里的某一节，得自己拼 `[[笔记#小节]]`——小节名
  少一个字就是一条点了没反应的死链，而且不报错。现在大纲每一行右边有一颗小按钮（鼠标停在
  那一行才显形），点一下就把指向这一节的链接抄进剪贴板。拼法仍然问宿主：Wiki 还是 Markdown、
  路径写全还是写短都由它决定（`generateMarkdownLink` 的第三个参数就是 subpath），问不到才退回
  `[[路径#小节]]`。点标题本身还是「跳过去」，两件事分开。
- **搜完按回车，就进最该看的那篇**：搜出来之后还得把鼠标挪到第一张卡上点一下——搜索这条
  路上最后一段体力活。现在搜索框里有字时按回车直接打开排在最前面的那篇（搜索结果按相关度
  排，排头那篇就是最该看的）；`Esc` 把搜索框清空、退回整份列表。空搜索框里回车什么都不做，
  输入法组字时回车照样是上屏。
- **一串词要连着、不想要的能排掉**：搜索框原来只认「空格分隔、全部命中」——搜「开会 记录」，
  两个词各出现一次也算命中，想找那一次连着的会议没法说清；想排除录音转写也没处写。现在引号
  把一串词绑成一个（`"开会 记录"` 要连着出现），前面加减号就是不要它（`会议 -录音`）。
  `parseSearchQuery` 多拆一层，面板的 `searchTermsOf` 跟着改——标色只标正文词，减号后面那个
  不标，引号里的整串当一个词标。
- **篇尾看得见这一篇多少字、大概读几分钟**：编辑态脚下一直有草稿字数，阅读态却一个字都
  不给——读一篇几千字的逐字稿，读之前不知道有没有时间、读的时候不知道还剩多少，只能切进
  编辑态偷看一眼。现在阅读态正文之后也有一条 `.dshgn_readFoot`：字数（`reader.words`）与
  「约 N 分钟读完」（`reader.minutes`）。字数口径与编辑态共用 `countWords`（中文按字、西文按
  词），时间按每分钟三百字算、`readingMinutes` 至少报一分钟。字数从 `current.body`（没有就用
  `content`）算一次存在 memo 里，滚来滚去不重算；切进编辑态时这条不渲染，脚下换回草稿字数那条。
- **搜索框里有字，右边就有一颗清空**：打了半截才发现想搜的是另一件事，以前得把光标挪回去、按住
  退格一路删，或者按 Esc——而 Esc 在候选摆着时只收候选，要按两下才清得掉。现在 `query !== ''` 时
  `.dshgn_searchWrap` 里多一颗 `.dshgn_searchClear`（`search.clear` 这个 LEX 键以前只定义了没用上），
  点它一次把 `query` 清空、候选一起收掉、`findInPanel('.dshgn_search')` 把焦点放回框里。浏览器自带的
  那个 × 用 `::-webkit-search-cancel-button{display:none}` 藏掉，免得同一件事摆两颗按钮。
- **搜出来的这一摊，一次抄成一段清单**：搜完想把这次找到的几篇发给别人，只能一篇篇右键「复制引用」。
  现在 `searchMode && shown.length > 0` 时搜索框那一行多一颗 `button.dshgn_searchCopy`（Icon copy 11），
  点它调 `copySearchHits()`：按 `shown` 逐条拼成 `- 名字（路径）`（名字取 `entry.title`、位置取 `entry.path`，
  两者相同时只写名字），`navigator.clipboard.writeText` 之后 `showToast(t('search.copied'))`；写不出去就把
  清单摊进提示条（抄不走至少看得见）。类名单独一个，不复用 `.dshgn_pickAll`——那颗是「全勾」，只在搜索态
  出现的这颗是「抄走」，共用类会让按类名查的断言互相牵连。
- **搜过的词记在搜索框下面**：搜过什么只有用户自己知道，宿主那边没有这个信息，所以每次都得从零敲。
  现在搜索框空着时，`.dshgn_searchWrap` 下面多一条 `.dshgn_recent`：左边一行 `search.recent`（「最近搜过」），
  中间是最近八个词做成的 `button.dshgn_recentChip`，右边一颗 `.dshgn_recentClear` 一次清空。
  读写在 `readRecentSearches()` / `writeRecentSearches()`（`RECENT_KEY = 'dshgn.recentSearches'`、
  `RECENT_LIMIT = 8`，和栏宽、上次看到哪儿一样是纯界面状态，存 localStorage，隐私模式下抛错就回落空表）。
  记的时机是**停手之后**：`query` 与 `hits` 都稳住了再等 1200ms 才 `rememberSearch`，否则边打边搜会把
  「最近」「最近搜索」「最近搜索词」全存一遍；`rememberSearch` 里还会把当前词的前缀/被包含的旧条目一并剔掉。
  整条只在 `query.trim() === ''` 时摆——正搜着的时候摆一排别的词只会把人往岔路上带。
- **搜完说一句扫了多少篇**：`/search` 一直回着 `scanned` 与 `truncated`，面板只取了 `hits`，所以搜「录音」
  只回来四十篇时人分不清是库里就这么多、还是被 `limit` 截了。现在搜索 effect 把这两个数一起记进
  `searchScan`（`{ scanned, truncated, shown }`，`query` 清空或请求失败时置 null），搜索态在
  `.dshgn_searchHint` 下面多一行 `.dshgn_searchScan`：`t('search.scan')`（「扫了 {scanned} 篇，对上 {n} 篇」），
  `truncated` 时再补一句 `t('search.scanCut')` 并把 `data-cut` 置 `true`（颜色从三级提到二级）。
  `truncated` 由 `searchNotes` 在 `hits.length >= limit` 时置真——它表示「还没扫完就停了」，不是「库就这么大」。
- **这次到底按什么在筛，摆出来给你看**：搜索框里那一串敲完就滚走了，界面只剩一行 `search.hint`——它教的是
  「怎么写」，不回答「我这次写了什么」。现在 `searchQueryBits(input)` 把这一串拆成
  `[{ kind, value, start, end }]`（`kind` 取 `tag` / `dir` / `term` / `not`），界面上按 `start` 排成
  `.dshgn_queryBits` 里一排 `button.dshgn_queryBit`：左边一行 `search.bits`（「这次按这些筛」），
  每颗带 `data-kind`、图标（folder / hash / search）、`search.bitDrop` 的悬停说明。点一颗就走
  `dropQueryBit(bit)`：按 `start`/`end` 把那段从 `query` 里切掉、空白归一化、`setQuery` 重搜一遍、
  顺手清 `suggestAt` / `suggestIndex` 并把焦点还给搜索框。
  三段正则各吃各的、用 `taken` 区间表 + `free(from, to)` 保证不重复吃同一段文字（限定词
  `(?:^|\s)((?:tag|dir):(?:"[^"]*"|\S+))`、裸标签 `(?:^|\s)(#[^\s#]+)`、剩下按引号与减号切），
  每段都 `lastIndex = end` 防重叠。排除词那颗 `[data-kind="not"]` 划掉、颜色降一级，一排胶囊里才分得出正负。
  **只在 `queryBits.length > 1 || 有非 term 的段` 时摆**——只敲一个普通词时一颗胶囊重复框里那两个字纯属噪声。
- **空列表那一屏得给一条出路**：以前搜不到东西，中栏是一片空白——`visible.length === 0 && !searchMode`
  这个条件把搜索态整个排除了，`searching` 只在搜索框右边摆一行「搜索中…」，搜完命中 0 条时那一行也收了，
  屏幕上于是什么都没有。现在渲染条件改成 `shown.length === 0`（`shown = searchMode ? hits : visible`），
  搜索态的空结果也走这一屏；标题照旧用 `empty.search` / `empty.noNotes`，底下按情况补一句
  `empty.searchDesc` 或 `empty.filterDesc`，再在 `.dshgn_emptyActions` 里摆按钮：有搜索词给
  `search.clear`（顺手把 `suggestAt` / `suggestIndex` 一起清掉），筛着目录或标签给 `empty.clearFilter`
  （`setActiveDir('')` 与 `setActiveTag('')` 一起撤），真的空目录才摆原来那颗「新建」。
  连笔记库都还没有时（`status.vaultMissing` 非空）另外说一句：标题走 `empty.noVault`，说明走
  `empty.noVaultDesc`，动作只摆一颗 `empty.openSettings` 直接 `setTab('settings')` 跳到设置页——
  这时候「新建」建不出来、「清掉筛选」也没东西可清，一起按 `!vaultMissing` 收起来。
- **反链能看见「在哪一句」**：底下那块「谁提到了我」原来只给标题和路径。一篇笔记里三处都
  提到你时，那三处哪一处更该看、为什么被引，用户只能点进去再在正文里搜一遍。现在每条底下
  带着引用那一行的上下文，双链本身从上下文里削掉（`[[名字]]` 这几个字符不占地方），太长就
  两头留一点、中间省略。反查本来就要读全库正文，这一行不额外读盘。接上宿主的链接索引时
  还会标出「这一篇里提了几次」——`getBacklinksForFile` 顺手就给这个数，不拿白不拿。
  本地扫描那一份原来没有这个数，于是同一篇笔记接不接宿主会换个顺序；现在两边都自己数一遍、
  都按次数排（次数相同再按标题），同一行里写两遍只留一条上下文。宿主那条路因此变成异步的：
  索引只记得「谁引用、几次」，那一行剩下的字得现读引用方的正文。面板会等它答，而不是先摆
  一份「没有关联笔记」再自己改口；宿主答「我这儿没有」时跟问不到一样退回自己扫，别因为
  异步就静默空白。那句上下文本身也能点：点标题是「去那一篇」，点这句话是「去那一句」，
  打开就落在写着这句话的那一段上——反链最常用的场景就是「我记得在哪篇里提过，是哪一段
  来着」。上下文里双链是削掉的、正文里它是个胶囊，整串比对永远对不上，所以那句比对是按词
  顺序找的：只要这几个词依次出现就认它是同一行，中间夹了什么都不管。
- **列表能按名字排了**：左栏的目录和标签早就能切「按修改时间 / 按名称」，中栏那列笔记
  卡片却一直是服务端给什么顺序就是什么顺序（按修改时间倒序）——想在几十篇里按名字找一篇，
  只能去搜。现在搜索框右边也有一个同样的开关，点一下在「最近改的在前」和「按名称」之间切，
  切完记在本地，下次打开还是这个顺序。按名称用的是中文排序规则，不是按码位排。
- **搜完了也能按名字重排**：搜索结果的顺序默认是相关度（服务端按命中数排的，最该看的排前面），
  可「按名字找那一篇」一样是搜索时要做的动作——以前只能清空搜索再找，等于把刚敲的词白敲
  一遍。搜索态那颗开关不再收起来：默认仍是相关度（标 ★），点一下切「按名称」（标 A→Z），
  只把手上这批命中重排、不再打一次 `/search`。两档各存各的（`dshgn.searchSort` 与
  `dshgn.listSort`），切搜索态的顺序不会顺手改掉列表那一档；切回相关度时那颗按钮的悬停
  文字说清这会儿按什么排。
- **读长笔记时当场就能找**：以前想找一句话，得先离开这一篇、回到搜索框输词、再点命中行跳回来，
  找一句话的代价是走三趟。现在笔记头上有一颗放大镜，点开就在这篇里找：回车跳到下一处、
  Shift+回车回到上一处，Esc 收起。只把视野挪过去，不弹浮层也不标高亮——找的是「那一句在
  哪」，不是「把这一篇变成搜索结果页」。判断的是「哪个块已经滚到容器顶上」，留 12px 余量，
  刚跳过去的那一块不会被当成「还没到」而原地打转。一处都没有时说「这篇里没有「某词」」，
  已经有词但走到头了说「已经到头了」——两件事分开说，用户才知道是该换词还是该往回翻。
- **找的时候知道自己走到第几处了**：查找条以前只有「下一处」一个动作，一篇长笔记里反复按
  回车，走到第几处、还有几处没看全凭记忆。现在输入框右边摆着「2/7」（`countTextMatches`
  数的是出现次数、不分大小写也不重叠，`findAllBodyMatches` 按块顺序排），按到最后一处说完
  「已经到头了」就停在那儿不动；改了词就把旧数字收掉——那是上一个词的进度，留着只会误导。
  编辑态一样报，只是数的是 textarea 里那一段。
- **读的时候能往回退一步**：从 A 点进 B、又从 B 跳去 C，想回 A 得先退回列表、再翻一遍
  找到它——宿主里 Alt+← 就回去了，面板里没有这回事。现在每打开一篇都记进一条路径栈（最多
  40 篇，多了丢最早的），Alt+← 回上一篇、Alt+→ 再走回去，笔记头路径左边也摆了两颗箭头，灰着
  就是走不了。从栈中间往回退之后再点开别的一篇，前面那截「前进」当场作废——和浏览器一样，
  否则「前进」会跳到一条已经不在路径上的分支去。只记路径不记正文，走回去还是重新 `/read`
  一次，拿的是当下真实的那一版；有没保存的草稿时先问一句，别把刚写的半句冲掉。
- **列表里的上一篇 / 下一篇**：历史栈（`navRef` / `NAV_LIMIT = 40`）只记「点过的顺序」，从搜索
  结果里点进第 7 条时栈里没有第 8 条。新增 `adjacentAt`（在 `shown` 里找 `current.path` 的下标，
  找不到 -1）与 `gotoAdjacent(delta)`——按当前这次筛出来的 `shown` 走，越界就 return，有草稿时
  先 `confirmDialog(t('note.unsaved'))`，走的仍是 `openNote(path)` 所以照旧入栈、Alt+← 还能回来。
  NotePane 收 `onPrevNote` / `onNextNote` / `prevPath` / `nextPath` / `listPos` / `listTotal`，
  笔记头在 `dshgn_navBtn` 之后摆两颗 `button.dshgn_iconBtn.dshgn_adjBtn`（title 里带目标篇名，
  `prevPath === ''` 时不摆），阅读态脚下 `.dshgn_readFoot` 里多一个 `span.dshgn_readPos` 写
  「第 {i} / {n} 篇」。LEX 新增 `note.adjPrev` / `note.adjNext` / `reader.pos` 三语。
- **Ctrl+F 就能找，不用先找鼠标**：查找条以前只有笔记头上那颗放大镜能叫出来，键盘按 Ctrl+F
  什么都不发生——面板级那套快捷键在输入框里就放手了，它自己也只认 Ctrl+K 和 Ctrl+N。可宿主
  的阅读视图里 Ctrl+F 是肌肉记忆。现在阅读态按下去就把查找条叫出来、光标直接落在输入框里，
  再按一次也不会把它关掉（那是「叫出来」的手势，不是开关）。编辑态按下去找的是正文里那一段
  字：那时候正文根本没渲染，挪的是选区不是视野，命中的那一行会滚到视野中间，你才知道它是往
  上还是往下去了。Esc 收起时编辑态顺手把焦点还给正文——不然接着敲的字全进了那个已经藏起来
  的框里，看着像编辑区坏了。编辑区底下那行提示也写上了 Ctrl+F。
- **写到一半没了，下次还能捡回来**：面板的编辑器是草稿式的——正文只活在内存里，切页签、
  关窗口、宿主重载插件都会一起带走。写了一整段、手滑按了刷新，那是真丢了，连个「撤销」都没有。
  现在编辑态边写边往本地留一份（400ms 防抖，只留最近 5 篇、每篇封顶 20 万字：这是救急用的，
  不是版本历史，不封顶会让一篇长笔记把浏览器的配额吃掉大半）。下次打开同一篇，如果磁盘上的
  正文和那份草稿对不上，正文上方就提一句「上次写到一半没存（时间）」并摆「接着写 / 丢掉」：
  接着写会把草稿填回编辑区，丢掉就清掉。存好了、按「取消」、按 Esc，草稿都跟着消失——不然下次
  白问一句「上次没存」，而其实早就存好了。提醒条只在阅读态摆，正在写的时候再提一句只是噪音。
- **Ctrl+E 存好就退出**：看完一段想改几个字，改完还得去笔记头找「保存」再找「取消」，两次鼠标
  都花在同一件事上；宿主里 Ctrl+E 就在编辑和阅读之间来回切。现在面板也认这个键：阅读态按下去
  进编辑，编辑态按下去存好再退。存好再退而不是直接退，是因为面板的编辑器是草稿式的——直接退出
  等于把刚写的丢掉，而按下这个键的人想说的是「我看完了」。没改过就不白写一次盘，存不下的时候
  也照样退出（半句留在草稿里，不会因为存失败把人锁在编辑态）。
- **读到哪儿，回来还在那儿**：长笔记读到第三节、切去回个消息，回来又从第一行开始，得自己
  再翻一遍。现在每篇各记各的位置，换回来就放回去（最近翻过的 40 篇都记着，多了丢最旧的）。
  没记过的那篇从头开始——正文容器是同一个 DOM 节点，不清的话会停在上一篇读到的地方；翻回
  顶上就记 0，不会留着上一次的位置等你下次「惊喜」。记位置不记正文，回来还是要走一遍
  `/read` 拿当下真实的内容。
- **双链不用背路径**：在编辑区里敲 `[[`，底下就摆出库里名字对得上的那几篇——名字打头
  的排在前面，用上下键挑、回车（或 Tab）补上，也可以直接点。以前写双链得凭记忆把路径一字
  不差打对，打错一个斜杠就变成断链，还得回头去翻列表找那篇叫什么。重名的（两个目录下各有
  一篇「周报」）插进去的是整条路径，否则 `[[周报]]` 会指到另一篇去；名字一条都对不上时
  才退回比整条路径，不会因为目录名撞上就把整个目录列出来；一条都没有就什么都不弹。
- **编辑区里 Ctrl+B 加粗**：宿主的编辑区里 Ctrl+B / Ctrl+I / Ctrl+Shift+X 是肌肉记忆，面板的
  编辑区是个裸 textarea，按下去什么都不发生——用户在别处按习惯了，回来会以为「这个面板不支持
  加粗」，然后自己手打星号。现在三个键都接上了：记号套在选区外面、选区跟着记号一起挪，接着
  还能改；再按一次是取消（认得出「这一对已经包在外面了」，剥掉而不是再套一层——套两层在
  Markdown 里不会变粗，只会变成字面的星号）；选中的文字自己两头就是记号时，剥掉它自己那一对。
  没选中任何字时插一对、光标落在中间，接着敲的字就是加粗的。编辑区底下那行提示也把键位写上
  了，不然用户不知道有这回事。
- **筛了什么，界面上写着**：在左栏点一个目录、点一颗标签，中栏就只剩一部分卡片，但界面上
  一直没有留下任何「现在筛的是什么」的痕迹——切去别的目录再切回来，人会以为笔记丢了，
  或者以为扫描出了问题。现在中栏顶上会摆出当前的筛选：目录一颗胶囊、标签一颗（带井号，
  颜色也不一样），悬停说清点一下会怎样，点掉就退回去；两颗都清掉，整条自己收起来，不占
  平时的位置。它们和左栏的高亮是同一份状态，从哪边点都算。
- **按 ? 就能看见都有哪些键**：面板里能按的键散在各处——编辑区底下那行提示写着几个，
  按钮的悬停说明里各写一个，谁也不会把十几颗按钮一个个悬停过去。于是有人用了半年都不知道
  按 J/K 能上下翻、Alt+← 能回上一篇。现在按 `?`（或者点顶栏那颗问号）就摊开一张速查表：
  左边是键位、右边说按了会怎样，十几条一次看全；再按一次 `?`、按 Esc、点空白处、点「关闭」
  都能收起来。焦点在输入框里时按 `?` 不弹——那时用户是要打问号这个字。
- **标签也能分层看**：标签云以前是一颗颗平铺的胶囊，父标签「读书」和它下面的「读书/摘抄」
  并排摆着，看不出谁属于谁；同一份前缀还在每颗胶囊里重复一遍，一屏能塞的标签少了一半。
  现在按斜杠摊成层级：父标签一行、子标签缩进去一层、边框换成虚线，父标签上的数把子标签
  一起算进去。点父标签把子标签下面的笔记全收进来，点子标签只筛它自己那一篇；悬停能看到
  完整路径，因为摊平之后一行里只看得到最后一段。
- **标签也不用背**：双链能补全之后，标签成了唯一还得凭记忆敲的东西——而它比双链更
  容易写错：写错一个字不会报错，只会在标签云里多出一颗只有这一篇才有的孤零零的胶囊，
  过两天自己也认不出哪个才是「正牌」的那个。现在编辑区里敲 `#` 再打两个字，底下就摆出
  库里用过的标签，打头的排前面，上下键挑、回车（或 Tab）补上，也可以直接点。补的是库里
  真用过的词，凭空敲一个没人用过的新标签照样能敲完，只是没有候选——这恰好也是防手滑的
  那一层。判断得很克制：`C#` 这种紧贴着字的井号不算、`## 标题` 不算、`[[笔记#小节]]`
  里那个井号是在补小节也不算；标签不像双链，补完不用再加右括号。
- **大纲上亮着「现在读到哪一节」**：长笔记滚到一半，用户会想确认自己看的是第几节，而大纲
  里一条都不亮——只能自己数，或者滚回去看标题。现在正在读的那一节左侧有一道竖线、文字换成
  主色：从大纲点过去的当然算，自己用滚轮往下翻也跟着变（判据是「哪个标题已经滚过容器顶部」，
  留 24px 余量，刚贴上去就算在这一节里；滚动事件按帧合并，一屏几十条事件也只算一次）。只
  加粗上色、不动背景——否则和「鼠标正停在这」抢视觉，用户分不清「我点到这儿了」和「鼠标在
  这儿」。同一时刻只有一条亮着。
- **别名也算数**：`aliases: [读书笔记]` 之后，`[[读书笔记]]` 在面板里也指得到那一篇。
  以前面板只比文件名和标题，同一个链接在 Obsidian 里点得开、在面板里报「库里找不到」——
  这种「一边能用一边不能用」最难自查。别名排在最后一级（路径 → 文件名 → 标题 → 别名）：
  撞上真实文件名或标题时，真实的那一个更该赢。单值写法 `alias: 甲` 也认。
- **正文里写的 #标签 也算数**：标签能写两处——头部的 `tags:`，和正文里随手一个 `#生活`。
  宿主两个都认，面板以前只认头部（scanVault / readNote / searchNotes 三处都只读 frontmatter），
  于是同一个标签写在正文里就既进不了标签云、也筛不出这一篇，写在头部却一切正常——这种「一处
  能用一处不能」最难自查。现在两边合起来算：标签云、左栏筛选、`tag:生活` 搜索都能命中。删标签
  和改标签名会把正文里那个一起改掉（只改头部的话，删掉的下次扫描又冒出来、改名后会同时出现新旧
  两个，而「改名」应该是一处不落）。正文标签只归正文管：它不会被顺手写回头部，删掉时也不会
  在头部多出一个副本。围栏代码块、行内代码、`# 标题`、URL 里的 `#片段`、纯数字都不算。
  正文里那串 `#生活` 本身也做成能点的胶囊，点一下就在左栏筛这个标签——跟笔记头属性区那几颗
  是同一个动作。没接筛标签的去处时（卡片摘要、嵌进来的正文）只上色不给光标：一个点下去什么
  都不会发生的按钮，比不能点更让人困惑。
- **引用块也认得宿主那套 callout**：`> [!warning] 别在周五上线` 在 Obsidian 里是一块带图标、
  带配色、能折叠的提示框，以前面板的手写渲染器把它当普通引用，`[!warning]` 那几个字符原样
  显示出来，和用户写的标题混成一行。现在图标、标题、正文各归各位，警告黄、失败红、提示绿。
  **类型名是自由的**（宿主认的是「方括号感叹号 + 任意名字」），认不出的也照样把标题摆出来、
  只是配色走中性那套——认不出就退回普通引用的话，那串字符又会冒出来，比配色不准难看得多。
  带 `-` 的默认收起、点标题展开，照宿主的规矩。正文一律用常规色：整块染成警告色会让人以为
  笔记本身出错了。
- **属性就写在笔记头上**：`tags`、`aliases`、你自己加的字段都在每篇的 frontmatter 里，
  但面板以前阅读时只渲染正文（不然 `title: xxx` 会被当成段落铺出来），头部整块看不见。
  现在正文上方多一块「属性」：键值摊成几行，标签拆成一颗颗可点的胶囊，点一下等于在左栏
  筛这个标签。空值的键（`aliases: []` 这种写了等于没写的）不占行——占一行只会让人以为
  面板没渲染对；整篇没有头部时这块压根不出现，不给用户一个空框。
- **拖进来就是附件**：宿主里把图拖进编辑器就落到附件目录、正文里多一行 `![[图.png]]`，
  截图之后 Ctrl+V 也一样；面板以前什么都不做——用户以为图存进去了，其实盘上没有，
  正文里只有一串文件名。现在补上同一件事：文件存进这篇笔记旁边的 `asset` 目录，
  文件名带上笔记主干前缀（`listAssets` 认领附件第一条就是「文件名以主干开头」，不加前缀
  文件是落盘了但附件区看不见，用户会再拖一次、盘上堆两份），同名的不覆盖、自动加后缀。
  有没保存的草稿时只改草稿不落盘——用户正在写，替他保存会把半句话也一起写进去。
  原始字节走 body 不走 base64 的 JSON：图片动辄几 MB，套进去要多花三成，服务端的 JSON
  上限也只有 256KB。
- **引用一段就嵌一段**：正文里的 `![[另一篇笔记]]` 在宿主里会把那一篇的正文整段嵌进来，
  我们原来只给一颗文件名胶囊——点了能跳过去，但「在这儿引用一段别处的内容」根本没做到，
  对比两篇得点开、看完、再退回来。现在照宿主那样嵌，左边一道竖线分清楚哪段是别人的。
  只往下嵌一层：嵌进来的那篇里再嵌一篇时留成文件名，两篇互相嵌入不会一路读下去。
  `![[xxx]]` 通常不写扩展名，所以「不是图片」推不出「是一篇笔记」——PDF、录音、压缩包
  这些要先拦下来，不然会被当成笔记去读、读不到就显示成一个空框。解析用的是与点双链
  完全同一套（先问宿主索引，再按路径/文件名/标题退让），两处指错的方式才一致。
  嵌入框头上的名字用用户写下的那个，不用正文里第一个标题（那常常是「某某小节」，写在
  头上会让人以为嵌的是另一篇）。
- **双链带小节也能跳准**：`[[笔记#小节]]`、`[[#本页的小节]]` 在宿主里会直接滚到那一节。
  我们原来把整串 `笔记#小节` 当路径递给宿主，`getFirstLinkpathDest` 自然找不到，于是不管
  点得多准都只会得到「库里找不到」。现在先切开、把前面那段交给宿主解析，打开之后再按
  标题文字滚过去——**锚点得等目标那篇的正文真的到了再滚**，所以记锚点时把目标路径一起
  记下，NotePane 里对不上当前这篇就继续等，不然滚的是上一篇的同名标题。同一篇被链到
  不同小节时显示成「笔记 › 小节」，否则两行链接看起来一模一样，点进去落在哪儿全靠猜。
  标题文字比较前先归一化（去掉 `#`、行尾闭合的 `#`、压掉空白、忽略大小写）；标题节点
  既认自己渲染的 `.dshgn_h` 也认宿主渲染器给的 `h1..h6`，只认前者的话接上宿主之后
  大纲点击与锚点跳转会静默失效。那一节被改名或删掉时明说「这一篇里没有这一节」。
- **这篇引用了谁，也看得见**：笔记底下除了「引用了这篇的笔记」，还会列出这一篇自己写了
  哪些 `[[双链]]`。反链回答「谁提到我」，出链回答「我提到过谁」，只看一半的话一篇笔记的
  上下文永远只有一半。出链优先问宿主的 metadataCache（它认得别名、竖线前那一段、以及
  指向库外文件的情况），问不到就用读笔记时顺带算好的那份；同一篇写两遍合掉，点一下能过去。
- **改名还是宿主那一套**：笔记头、列表右键都能重命名，弹的是 Obsidian 自己的改名
  对话框。宿主改名时会顺手把全库的 `[[双链]]` 与 Markdown 链接一起改掉，我们绕过它
  直接改文件名的话，别的笔记里的引用就成了死链，往往几个月后才在某篇笔记里发现一串
  点不开的链接。有没保存的改动时先拦住，免得改完重读把那几句一起冲掉。
- **图点一下先自己放大**：面板里的图片是拿资源地址直接画出来的，点了本来什么都不会发生。
  后来改成交给宿主打开（宿主有自己的图片视图），但那样每看一行字都要把焦点交出去、
  看完再切回来，读扫描件时来回切窗口。现在先就地放大：遮罩铺满一屏看原图，Esc 或点空白
  处收起，点图本身不关（放大着看细节时手一抖不该把它关掉）。放大的是同一个资源地址，不额外
  下载一份；换笔记时放大态自动失效（记着「这是哪一篇的图」）。Esc 的监听在挂载时就挂上、
  靠一个 ref 判断「现在有没有放大」——等到有图放大才挂会漏掉「点开就按 Esc」这一下，那时
  遮罩已经在屏幕上了、监听却还没跑。没有放大去处时才退回「交给宿主打开」，两样都没有就连
  `cursor` 都不变、也不挂 `onClick`——挂一个点了没反应的处理器比不能点更让人困惑。
  一篇里好几张图时遮罩底部多一条「上一张 / 第几张 / 下一张」，左右方向键也能走（走到头
  绕回另一头），只有一张图就不摆；图单是打开那一刻从正文里读出来的（正文的图、附件区的图、
  嵌进来的那篇里的图都在，按页面从上往下的顺序），读成 state 存着而不是每次渲染现算——
  遮罩开着时正文可能因为同步或勾待办重渲染，现算会让左右键走到一半跳到别的图上。
  另外把「有没有放大」的判定从「state 非空」收紧成「state 非空且是这一篇的」：换过笔记之后
  state 里还留着上一张图，遮罩已经不画了，这时再接管 Esc 和方向键会悄悄吞掉用户的方向键。
- **图片和录音走宿主的资源协议**：面板里 `<img>` / `<audio>` 的 src 原来拼的是本地服务的
  `/getnote/asset?path=...&t=令牌`——端口会变、令牌每次启动都换，每张图还要绕一圈本机 HTTP。
  改成问 `adapter.getResourcePath()`，拿到的是宿主资源协议下的地址，浏览器直接加载，还能吃到
  宿主的缓存与 Range 处理（录音拖进度条就靠它）。面板传的是「相对笔记目录」的路径，宿主只认
  库内相对路径，补子目录这一步只在 `assetUrlFor` 一处做。宿主没给这个方法、或它自己炸了，
  就退回本地服务地址——两条路都得能走，否则旧版本宿主上图片全白。
- **点双链先问宿主的索引**：面板正文里的 `[[双链]]` 该指向哪一篇，先问
  `metadataCache.getFirstLinkpathDest()`——别名、不带扩展名的路径前缀、同名笔记取离当前
  这篇最近的那篇，这些规则都在宿主那儿；我们自己按「路径 → 文件名 → 标题」退让，同名一多
  就会指到另一篇上，而「点进去是另一篇」这种错很难自己发现。宿主解析不出来、或结果落在
  笔记目录之外，才退回自己那套。顺带修了反链的一处误判：刚写下的笔记在宿主索引里还没有
  反向链接时，「真的没人引用」和「还没来得及收录」长得一模一样，现在 30 秒内的新文件不替
  宿主下结论，交给面板自己扫一遍。
- **新建也落在你习惯的地方**：宿主的「设置 → 文件与链接 → 新建笔记的默认位置」有三档，
  面板原来固定把新笔记丢在笔记目录根，用户在别处点「新建笔记」看到的却是另一个位置，
  同一个库里于是有两套「新建落在哪」。现在读宿主的 `newFileLocation` / `newFileFolderPath`，
  指定目录与「当前笔记所在目录」都换算成面板口径；在面板里自己选了目录时以你选的为准
  （那是刚明说的），宿主的设置落在笔记目录之外时不跟——不替你把笔记建到笔记目录外面去。
- **「今天」就是宿主那个今天**：命令里的「打开今天的笔记」原来自己拼一个
  `YYYY-MM-DD` 丢在笔记目录里，而很多人把日记配成「日记/YYYY/YYYY-MM-DD」——同一个库里
  于是有两个「今天」，用户在宿主里点「打开今天的日记」看到的是另一个文件。改成先问日记
  核心插件（`daily-notes` 的 folder / format），按它给的位置找、按它的名字建（这类名字
  本身就是日期，不再叠日期前缀）；问不到、日记插件关着、或者日记落在笔记目录之外时，
  才退回自己的日期标题——不替用户把日记搬进笔记目录。
- **拖进来就是挪过来**：在宿主的文件树里按住一篇笔记拖到面板列表上，它就挪进当前筛的
  那个目录。拖进来的是宿主的路径口径（库内相对路径、带笔记子目录前缀），而 `/batch` 认的是
  面板口径（相对笔记目录），换算在 `dropIntoDir` 一处做完再交给同一个批量移动端点——
  拖动与「批量移目录」必须是同一条路，否则两边行为会慢慢走偏。没选目录时先提示，不瞎猜地方；
  笔记目录外的文件与非 Markdown 一律不理（把库外任意文件搬进笔记目录是个大得多的动作，
  不该由一次误拖触发）。
- **在文件列表里定位**：列表是平的，用户想知道一篇笔记在库里挨着什么时，把它交给宿主的
  文件列表最直观。Obsidian 没把这件事做成公开 API：老版本挂在 `internalPlugins` 的
  file-explorer 实例上，新版本也可能只有叶子视图上有——`fileExplorerApi()` 两处都试，
  都没有就明说「这个版本定位不了」，不静默失败。路径同样认两种口径。
- **popout 窗口里也长一样**：Obsidian 的「在新窗口中打开」会给出一个全新的 document，
  主窗口的 `document.head`、`window` 监听、`document.body` 的 class 变化在那里面统统不存在。
  原来面板的样式表只注入主窗口、Ctrl+K 只认主窗口的搜索框、点空白关菜单只挂主窗口、
  深色主题只盯主窗口的 body——popout 里打开就是一堆没有样式的裸元素。改成：根节点登记时
  往它自己的 document 注入一份样式；键盘与点击监听按窗口分别挂（新窗口出现时重放一遍）；
  主题观察器跟着每个窗口的 body 走。Ctrl+K 聚焦的是**事件所在那个窗口**的搜索框，
  不能抢主窗口的——`event.target.ownerDocument` 在 window 上派发时拿不到，所以按
  `ownerDocument → document` 依次取。
- **列表里能把笔记拖出去**：卡片标成可拖动，拖到宿主的编辑器里落下去是一条链接。
  拖出去的内容问 `markdownLinkOf`（跟「复制引用」同一个来源），拿不到就退回库内相对路径，
  至少粘过去是个能认的路径。没有 `dataTransfer` 的环境里拖动只是没反应，不该炸。
- **列表里右键就能拿去改**：卡片右键菜单多一条「在 Obsidian 里打开」。用户常常是在
  列表里扫到一篇、想拿宿主的补全/Vim 去改，而不是先点开再回头找按钮。面板里路径有三种
  口径（库内相对、相对笔记目录、绝对），宿主只认第一种，换算统一放在 `openInVaultEditor`：
  先剥库根、再补笔记子目录前缀，逐个候选查 `getAbstractFileByPath`，命中才 `openFile`。
  以前只认库内相对路径，右键传的是 `entry.path`（相对笔记目录），会找不到文件。
  清单里条件不成立的项是 `null`，交给宿主前先滤掉——宿主拿到 `null` 会在 `setTitle` 上炸，
  整个菜单就没了。
- **记得上次看到哪儿**：页签、目录、标签、开着的那一篇都存进 `localStorage`，
  关掉再开、切库回来、叶子关掉又拉回来，都从刚才的位置接着看。只存路径不存正文——
  正文可能已经被同步或宿主编辑器改过，恢复时重新走一遍 `/read` 才是当下真实的内容；
  恢复前先确认那篇还在列表里，笔记被删或改名时不会弹一条没头没尾的 404。
  存的东西坏了（隐私模式、旧结构）当作没有，从默认位置开始。
- **别处改了，面板当场跟着变**：宿主的 `vault` 事件（`modify` / `delete` / `rename`）转成
  「哪一篇、什么动作」送进面板。以前在 Obsidian 编辑器里改了当前这篇、或把它删了，
  面板还端着旧正文，只有重新点一次卡片才重读——开着的那一篇等于停在过去。
  订阅只建一次（用 ref 读当下的值）：宿主写一次盘常连着发好几个事件，每次重读都重建
  订阅的话，重建期间到的事件直接丢了，正文就永远停在旧的一版；同一篇一秒内只重读一次。
  面板自己保存的那一下也会收到 `modify`，靠「保存之后放行一次」跳过，不白读一遍还把
  滚动位置顶掉；有没保存的草稿时不覆盖用户正在改的内容。
- **深链能直接跳到某一篇**：`obsidian://getnote?action=open&path=...`，库内相对路径
  （`得到大脑/随手记/甲.md`）与面板口径（`随手记/甲.md`）两种写法都收——从浏览器、聊天
  窗口、其它插件里复制出来的路径多半是前者。不是 `.md`、路径为空、动作不认识，一律什么
  都不做：一个能被任意网页触发的 URL 不该有删笔记的能力，也不该因为一条坏链接弹错。
  先 `activateView()` 再投递意图——意图总线在没有监听者时只暂存一条，开面板期间用户
  点了别的动作的话，后投递的这份才是该执行的。
- **生成完顺手打开**：Bases 视图与画布写完直接交给宿主打开。只写一个文件、界面上什么
  都不发生，用户会以为命令没生效——尤其画布，本来就是拿来「摆」的。刚写完的文件在宿主的
  文件表里可能还没登记（写入与索引是两条路），所以 `openVaultFile` 带几次重试；
  已经存在的 Bases 视图不覆盖，但同样打开。
- **列表里停一下也预览**：中栏那列卡片以前只能点开才知道是不是要找的那篇。现在鼠标停上去
  就请宿主弹这一篇的预览，跟宿主的文件列表一个手感。用 `mouseenter` 不用 `mouseover`：
  卡片里还有勾选框和命中行，`mouseover` 在它们之间挪一下就重发一次，预览会一卡一顿的。
  宿主没登记预览来源时一条都不触发，宿主那边炸了也只是不弹，不会把面板带崩。
- **剩下的不想一屏一屏点下去**：中栏一次只渲染一屏（`LIST_PAGE_SIZE = 60`），滚到底附近
  续一屏，另有「显示更多」按钮给个明确出口。库大起来之后从第一屏翻到最后一屏要点十几次，
  每次都得重新把鼠标挪回列表底下。现在「显示更多」旁边并排一颗「全部显示」，点一下把
  `listLimit` 直接抬到当前筛选结果的条数——抬的是 `shown.length` 而不是 `Infinity`，
  因为窗口值跟着筛选走，换一次查询就自动降回一屏，不会把没筛掉的东西留在 DOM 里。
  两颗按钮包在 `.dshgn_moreRow` 里各占一半宽，全摊开之后整行一起消失。
- **划一段就能拿走**：正文里划选之后松手就地弹小条，「复制」搬进剪贴板、「存成新笔记」
  直接新建一篇（标题取选中内容的第一行前 30 字，落在当前筛的目录里并当场打开）。
  只在阅读态摆——编辑态那一块是可编辑的 textarea，划选是改字的前奏；一滚动就收起，
  因为小条按视口坐标钉着，正文一滚它就飘到别处去了。
- **挑几篇一起处理，不用先去够勾选框**：批量加标签、挪目录、删掉都要先勾选，可勾选框
  只在悬停或已经选过时才显形——想连着挑几篇得把鼠标在每张卡上停一下，键盘用户更够不着。
  现在按 `X` 就把当前打开的那一篇选进去（没打开笔记时落在列表第一篇，刚按 j/k 浏览完
  视线就在那儿），再按一次退出；`Esc` 把整批清掉，和「取消选择」那颗按钮一个效果。
- **想留着原稿再改，就复制一份**：写周报时拿上周那篇当骨架、做实验时想保住原稿，
  以前得「复制引用 → 新建 → 粘贴正文 → 自己补标题」四步。现在列表里右键「复制这一篇」
  （笔记头上也有一颗），读一份正文、以「原标题 副本」建一篇新的，落在同一个目录里并当场
  打开。副本照抄原篇的名字，不再叠一个今天的日期。原文件一个字都不动，也不碰你手上那份
  没保存的草稿——这是「另起一篇」，不是「把这篇存成另一篇」。
- **整篇正文一次抄走**：卡片右键新增 `copy-body`，走 `GET /getnote/read` 拿 `note.body`
  （`readNote` 已经切掉了 frontmatter，所以只按它给的 body 用，不自己找 `---`，正文里
  本来就有的分隔线才不会被误伤），`navigator.clipboard.writeText` 之后用
  `t('note.copiedBody')` 报「已复制正文（N 个字）」，空篇走 `note.copyBodyEmpty` 明说没东西
  可抄。LEX 新增 `note.copyBody` / `note.copiedBody` / `note.copyBodyEmpty` 三语。
- **保存撞车时先问一句用哪一版**：`handleSave` 以前只比对「内容是否相同」，然后
  `snapshotNote` + `writeNote`，**没有任何前置条件**——宿主里改过、或者同步下来一版，
  面板这一存就静默覆盖。现在面板 `saveNote` 带上 `current.mtimeMs` 当 `expectMtimeMs`，
  `writeNote` 在写之前 `stat` 一次，对不上抛 409（`err.code = 'conflict'`）；`fail()`
  把磁盘上现在的内容一起回给面板（`payload.conflict = { content, mtimeMs }`），`api()`
  再把响应正文挂到 `err.body` 上。面板收到冲突不是报错收场，而是 `confirmDialog` 问
  「存我这一版 / 用别处那一版」——`confirmDialog` 与宿主 `askConfirm` 都新增了
  `confirmText` / `cancelText`，两边都不是「取消」的选择不能写死成确定/取消（`setConfirmDialog`
  那一行也得把 options 一起递下去，只传 message 的话面板挑好的文案到宿主这儿就被换回确定/取消了）。选「存我这一版」
  才 `saveNote(true)` 清掉 baseMtime 重写一次，避免跟同一个冲突原地打转。
  顺手修掉一个真 bug：保存按钮原来直接挂 `onSave`，Preact 把点击事件当第一个参数传进去，
  而第一个参数正是 `force`——事件对象是真值，等于**每次点保存都绕过冲突检查**。
- **选中一段字再粘网址，它就当链接文字**：在宿主编辑器里选中几个字再粘贴一个网址，
  那段话会留在原地变成链接文字；面板的编辑区是个裸 textarea，粘贴会把选好的字整个
  替换成网址。现在选中一段字再粘网址，出来的是 `[那段字](网址)`，光标停在链接文字上，
  接着打字是改链接文字而不是改网址。没选字、剪贴板里不是 http/https 网址、选中的本来
  就是一条链接、或者选中的字里带 `]` 与换行时一律不插手，交回浏览器默认行为。
- **页面预览也走宿主**：鼠标停在面板正文的 `[[双链]]` 上，请宿主弹它自己的预览卡片
  （`workspace.trigger('hover-link', ...)`）。宿主要求先 `registerHoverLinkSource` 登记
  来源，否则它不知道该用哪套规则预览，事件会被静默丢掉——所以插件在 onload 里登记
  一次 `getnote-brain`。没登记来源、或宿主没有这个能力时，悬停什么都不做，不会误触发。
- **在得到大脑里打开当前笔记**：命令面板里一条，把宿主正在读/改的那篇切到面板里。
  在 Obsidian 里读一篇时想知道「谁引用过它、同步过没有、有没有历史版本」，得回面板、
  翻目录、找同名那篇——笔记一多就找不着。面板不会自己跟着宿主的活动笔记走（用户切
  标签页时它会乱跳），所以做成一条按需触发的命令。当前笔记不在笔记目录里时明确说一句，
  而不是静默不动——静默不动会被当成命令坏了。
- **复制引用按宿主的链接格式来**：以前拼的是「库根绝对路径 + @前缀」，那是喂给外部工具
  （Claude Code 之类）的口径。但用户点「复制引用」十有八九是想粘进另一篇笔记里——那要的
  是 `[[随手记/甲|甲]]` 或 `[甲](随手记/甲.md)`，取决于他自己的「使用 Wiki 链接」和
  「新链接格式」两项设置。这两项只有 `app.fileManager.generateMarkdownLink` 知道，
  所以交给宿主生成；宿主没提供、找不到文件、或者它自己抛错，都退回原来的绝对路径口径
  ——复制出一个空字符串比复制出一个不完美的路径糟得多。
- **换笔记的复位改成渲染期比较**：原来用 useEffect 退出编辑态与历史面板，effect 是
  排队执行的，用户「打开笔记 → 立刻点编辑」时它后到那一下会把刚打开的编辑态按回关闭。
  渲染期比较是同步的，不存在这个窗口。
- **正文交给 Obsidian 自己的渲染器**：面板原来有一套手写 Markdown 解析，能渲染标题、
  列表、表格、代码块和 `[[双链]]`，但 callout 不会折叠、公式不排版、Mermaid 不画图，
  脚注、高亮、嵌入块、Dataview / Bases 的查询块全出不来。现在正文走 `MarkdownRenderer`，
  这些能力白捡；点内链在编辑器里打开（Ctrl/Cmd 新开一页），点待办方框直接改文件。
  渲染器要从 'obsidian' 引入，而面板的离线测试跑在纯 Node 里，所以由视图层注入、
  没注入时自动退回手写渲染器——测试覆盖的仍然是同一份界面。

### 与 DSH 版的实现差异

- 宿主接线层重写：`ctx.slots` + `webServer` 前缀路由 → `ItemView` + 自带 `127.0.0.1` 回环服务。
- 新增 `src/core/vfs.js` 文件系统适配层，上层 API 不变，底层走 `app.vault.adapter`，让 Obsidian 感知写入。
- 新增 `src/core/net.js`，用 `node:http` 实现 fetch 兼容层，绕开渲染进程的 CORS 限制并支持自定义 `Referer`。
- 设置改为存插件数据目录（`data.json` 同级的 `dsh-getnote*.json`），不再写用户主目录。
- 「库根」改为「库内子目录」：Obsidian 不允许插件把笔记写到库外。
- OAuth 回调改为本机回环地址，端口变化时自动重新注册 client；端口会在首次启动后记进设置，之后优先复用，让 `redirect_uri` 跨会话稳定。
- 授权页改用系统浏览器打开（注入 `electron.shell.openExternal`），不再依赖渲染进程里的 `window.open`。
- 本地服务补 `Access-Control-Allow-Private-Network` 预检头：渲染进程的源是 `app://obsidian.md`，访问 `127.0.0.1` 属 Chromium 的 Private Network Access，缺这个头会让面板里所有接口在浏览器层被拦掉。
- 录音卡桥脚本路径改为可注入（`configureCardScripts`），不再依赖 `import.meta.url`。
- `vfs.mkdir` / `writeFile` / `rename` 自己逐级补父目录：Obsidian 的 `adapter.mkdir` 和
  `fs.mkdir` 一样不建父级，而笔记目录允许写成「笔记/知识库/得到大脑归档」这种多级路径。
- 整库导出不再依赖 `a[download]`：Electron 的下载管理器在 Obsidian 里没被接管，
  点了可能静默无反应。改为由宿主把 zip 拉到临时目录、再在系统文件管理器里定位到它。
- 面板设置页的「笔记目录」输入框改为显示**库内相对路径**（`/settings` 多回一个
  `subfolder` 字段），提示文案也改成 Obsidian 语境，不再提 DSH 配置目录。
- 笔记目录的绝对路径判定不再只看 `path.isAbsolute`：它是按平台判断的，`D:/x` 在 Linux
  上算相对路径，会被当成子目录拼到库根后面。现在显式认盘符与 POSIX 根两种写法，
  库外路径一律 400，笔记库同步到别的系统也不会写错地方。
- 目录收敛成空（用户指的正是库根）时回落到默认子目录，而不是把笔记铺进库根；
  顺手修掉「内存里的子目录与设置文件里写的子目录不一致」的问题。
- 测试与 CI 要求 Node ≥ 22：jsdom 31 依赖的 undici 用了 Node 22 才有的
  `zlib.createZstdDecompress`，Node 20 上面板/视图两个测试会直接崩在 require 阶段。

### 性能与安全

- **扫描缓存**：`scanVault` 原来是每次请求全量重扫整库（`/status`、`/tree`、`/search`
  等 9 个入口各扫一遍）。现在缓存键是「库根 + 全库 .md 的 mtime/size 指纹」，
  指纹没变就复用上次结果；另有逐文件记忆层，库里改了一篇时只需重新读那一篇。
  缓存在写操作后失效，并监听 Obsidian 的 `modify` / `create` / `delete` / `rename`
  事件——即使事件漏了，指纹比较也保证不会读到旧内容。
- **打包体积**：渲染层从 `react` + `react-dom` 换成 `preact` + `preact/compat`。
  面板用的是 100 处 `useState`/`useCallback`/`useEffect`/`useMemo`/`useRef`/`Fragment`
  加一处 `createElement`，没有 context、portal、Suspense 之类的重货，compat 层全覆盖，
  组件源码一行没改。另外 `process.env.NODE_ENV` 这类运行时判断 esbuild 静态分析不了，
  构建时钉成字面量让开发版整份消失。两步合起来 `main.js` 从 1814 KB 降到 626 KB。
- **列表增量渲染**：中栏原来把筛选结果全量渲染成卡片，几千篇的库里 DOM 节点数
  跟着条目数线性涨，滚动明显发涩。现在一次只渲染 60 条，滚到底部附近自动续一屏，
  另有「显示更多」按钮给一个明确的出口；切查询词 / 目录 / 标签时窗口回到 60。
  这个重置是在渲染期比较上一次的筛选条件做的，不是 `useEffect`——effect 是异步排队的，
  用户刚点完目录就点「显示更多」时它会后到，把刚加大的窗口又按回去，点了没反应。
- **本地服务令牌**：CORS 是 `*`（渲染进程的源是 `app://obsidian.md`，预知不了），
  所以每个请求必须带一个每次启动随机生成的令牌：普通接口走 `x-getnote-token` 头，
  `<img>`/`<audio>` 这种加不了头的资源请求走 `?t=` 查询参数；OAuth 回调是系统浏览器
  整页跳转过来的，单独放行。
- **请求竞态与重试**：`api()` 对 GET 按路径分组、新请求 abort 上一个（快速连点或输入
  搜索词时，先发的请求可能后回来把新结果盖成旧的）；网络层失败退避重试两次，业务错误
  （带状态码）立刻抛，写操作一律不重试。
- **写操作幂等**：新建 / 保存 / 删除都带一个动作开始时取的 `requestId`，服务端认号去重，
  双击或断网重试不会建出两篇；保存时内容没变直接返回 `unchanged: true`，不在历史里
  塞一模一样的版本。

- **面板打不开时不留一片黑**：视图的 `onOpen` 拆成两层，挂载流程里的任何异常都由
  外层接住，交给 `renderFatal` 画到屏幕上：标题 + 原因 + 前八行堆栈，整块用内联样式，
  不依赖面板自己的 CSS（没画出来的原因很可能正是样式没注入成功）；同时往
  `.obsidian/plugins/getnote-brain/panel-error.txt` 落一份，用户不必去翻控制台。
  另加一道看门狗：渲染调用不抛错不等于首帧真的提交了，两秒后回查 `.dshgn_root`——
  没出现报「首帧没有渲染完成」，出现了但 `clientHeight` 为 0 报「布局没有撑开」。
  两者在屏幕上都表现为全黑，混成一条报错会把排查引向完全错误的方向。

- **骨架屏上永远压着一行字**：三栏骨架的占位块用的是宿主的 `interactive-bg-hover`，
  碰上把它调得和背景几乎一样的主题（或这组变量压根没映射上），屏幕上就是一片黑——
  与「渲染挂了」在视觉上完全等价。所以骨架顶上固定一行「正在读取笔记库…」配一颗转圈，
  色块再怎么隐形，那行字都还在，一眼就能分辨「面板活着、只是在等数据」。等过 6 秒
  （本地接口正常耗时的几十倍）还没拿到 `status`，那行字换成「本地服务好像没连上」，
  底下补一段说明和一颗「重试」，直接调回 `refresh()`。无限转圈和一片黑对用户是同一件事，
  总得给一个能按的东西。

- **工作区里那个空壳叶子，别再对着它干瞪眼**：面板视图一旦被写进 `workspace.json`，
  下次启动 Obsidian 时工作区会先把它恢复出来，而这时插件还没注册视图——恢复出来的
  是一个有叶子、有容器、却从没跑过 `onOpen` 的空壳。原来的 `activateView` 看到
  `getLeavesOfType` 有结果就直接 `revealLeaf` 然后返回，可对空壳 reveal 一百次也还是空壳：
  屏幕上永远是一片黑、一个字都没有，连兜底报错都不会出现（因为压根没走到渲染）。
  现在先问一句 `leafIsAlive(leaf)`——容器里有没有 `.dshgn_root`、`.dshgn_boot`、
  `.dshgn_fatal`、`.dshgn_mount` 里任何一个，有才认它是活的；是空壳就 `detach` 掉，
  往下走正常新建叶子的那条路。另外视图构造函数里也留一行轨迹：构造函数跑没跑，
  是「视图工厂根本没被调」和「`onOpen` 里炸了」之间唯一的分界。

- **宿主把视图挂上了，却一直不喊开工**：`setViewState` 返回成功、视图构造函数跑了、
  容器也在，屏幕上却还是一片黑——轨迹里那句「等了一会儿，视图 onOpen 仍然没有被调用」
  说清了原因：宿主把视图挂进叶子之后，一次都没调 `onOpen`。面板的整棵树是在
  `onOpen` 里画的，没人喊就没人画，连兜底报错都轮不到。现在视图自己记一个 `opened` 标记，
  叶子挂上一秒半后回看一眼这几行轨迹：没有「视图 onOpen 被调用」就自己补调一次；宿主后来
  真调了，那个标记把第二次挡掉，不会画两遍。`onClose` 里把标记清掉，叶子被复用时还画得出来。
  判断「这次打开有没有跑过 onOpen」不能只看轨迹里有没有那句话——`probeLines` 跨多次打开累积，
  所以挂上去之前先记下当前行数，只查这一行之后新写进去的。
  还有一处更隐蔽，也是真机上「全黑」最终查到的那一条：视图把宿主那个 `containerEl`
  改写成自己的挂载点。那是宿主记「这个视图挂在哪儿」的字段，被换掉之后面板照常渲染、
  `boot.txt` 里每一步都对，画出来的树却不在屏幕上——用户看到的永远是整片黑。现在挂载点
  单独记在 `panelEl` 上，宿主的 `containerEl` 不碰；看门狗还会在容器始终没挂进文档时
  明说「画在屏幕外了」（每 400ms 回看一次、最多五秒：容器的 `isConnected` 会晚于 `onOpen`
  成立，一上来就判定会把正常挂载误报成故障）。
  这些轨迹一直只往插件目录的 `boot.txt` 里写，用户报「全黑」时得先知道有这么一个文件、
  再把它打开——这一步对大多数人就已经断了。现在设置页底下多一块「面板打不开的时候」：
  `readBootTrace()` 走 `adapter.read` 取回原文（读不到就返回空串，诊断代码自己抛错就把
  「帮用户说清问题」变成了新的问题），`showBootTrace(containerEl)` 把它摊成一个 `pre`，
  `copyBootTrace()` 直接进剪贴板。换一份新的之前先摘掉上一份，否则点几次就叠几层。

### 工程与发布

- **附件缓存**：录音、图片走一条 24 条 / 64MB 的 LRU 缓存，键里带 mtime 与大小，
  文件真变了自然换键。拖动录音进度条时浏览器会连着发好几个 Range 请求，每次整块
  读几十兆 ogg 是纯浪费；只按条数限制会让二十几个大录音吃掉 1GB，只按字节限制又会
  让 Map 撑到几万条，所以两道闸一起把。
- **冲突留档命名带原路径哈希**：以前只按文件名去重，`随手记/甲.md` 与
  `做过的项目/甲.md` 同一毫秒撞车时会落到同一个留档名，后写的把先写的覆盖掉——
  两份内容只剩一份。现在文件名里多一段 6 位短哈希，认回正本时也按它匹配；
  老名字没有这一段，仍然按文件名找，不会读不出来。
- **统一日志**：所有输出都带 `[得到大脑]` 前缀（控制台里挤着几十个插件，报问题时一眼能
  认出是这条插件说的）。`warn`/`error` 始终输出，`debug`/`info` 默认关，在设置里开
  「详细日志」才出现——详细日志不开就刷屏，开了才有用。
- **构建产物一致性检查**：CI 在测试之后重新构建一次，再比对 `main.js` / `card` / `locale`
  是否有未提交的差异。构建产物也在仓库里（社区惯例，方便直接下载），源码改了忘重建、
  或重建后忘提交，都会让两者分叉，用户下到的就是旧代码。
- **Release 自动化**：推 tag 触发 `.github/workflows/release.yml`，重跑测试后把
  `main.js` / `manifest.json` / `styles.css` / `card/` / `locale/` 打成
  `getnote-brain-<tag>.zip` 挂到 Release，附自动生成的更新说明。同一个 Release 里还
  单独挂了 `main.js` / `manifest.json` / `styles.css` 三个文件：社区目录的条目校验与
  Obsidian 的自动更新都只认这三个，只给 zip 的话用户能手动装、却永远收不到更新。
- **插件 id 与市场名**：原来是 `getnote-obsidian`，社区目录不接受 id 里带
  `obsidian`（会与宿主自身混淆），所以改成 `getnote-brain`；改名连带视图类型
  `getnote-brain-view`、悬停来源、安装目录与打包目录，全套测试与 `styles.css`
  里的选择器一起跟过去。manifest 的 description 也去掉了 `Obsidian` 字样并以句点
  收尾——这两条都是目录校验的硬性要求，不满足连 PR 都过不了。
- **上架条件自检**：目录那套规矩（id 不能带 `obsidian`、name 不能以 Plugin 结尾、
  description 不能带 Obsidian 且必须以标点收尾、版本三处一致、仓库根该有的文件都在、
  仓库里没有个人信息与真凭证）散在文档各处，改一处容易忘另一处，被驳回一次就得重走
  一轮。现在 `npm run check:market` 一次查完 23 条，CI 最后一步也跑它。凭证那几条
  用负向断言放过占位符——文档里写的 `gk_live_xxx`、测试里用的 `gk_live_TESTKEY`
  都不是真钥匙，按字面查会把它们全判成泄露。

### 测试

- 980 项离线测试：vault 算法 196 项、归档包 64 项、历史 51 项、同步 66 项、9 项文件系统适配层验收、
  290 项 HTTP 路由验收、36 项启动验收（真加载打包产物 + 假 obsidian 模块 + 内存 adapter，
  库根用带中文与空格的临时目录，同时验「库内写入只走 adapter」「插件状态只落插件目录」、
  深链动作识别与 `action=open&path=...` 两种路径写法、设置页里能把启动轨迹摊出来并一次抄走（读不到时说一句「还没有轨迹」而不是空着，再点一次是换掉那一份而不是叠一层）、复制引用按宿主链接格式生成、「在得到大脑里打开当前笔记」、页面预览来源登记、Bases 与画布生成后自动打开、同步摘要写进当天日记、原生确认框只回一次话、在宿主编辑器里打开笔记、
   css-change 接上了、状态栏文案跟着库大小与当前笔记走且参数乱传不炸、宿主右键菜单里挂着
   我们的入口且路径口径与面板一致（一篇笔记上正好两条：打开、按这一篇的名字去搜，名字带点带括号也照剥不误；编辑器里选着字时再多一条「用选中的文字搜索」，空选区不摆）、「在文件列表里定位」把这一项交给宿主的文件列表且两种接口位置都试、图片交给宿主打开且两种路径口径都认、
「今天」按宿主的日记配置给出位置且日记在笔记目录之外时不替用户搬、双链指向哪一篇由宿主的索引说了算且问不到才自己找、刚写下的笔记反链为空时不替宿主下结论、新建笔记落在宿主指定的目录里且指定到笔记目录之外不接、
改名走宿主的改名对话框（三种路径口径都认，取消或改到笔记目录之外时交回空串，没有这个接口时明说）、
跟着宿主切换笔记（面板开着 + 开关打开 + 笔记在笔记目录里才投递，面板没开着不替你打开、目录外的不跟、也不去动宿主正在看的那篇）、
附件上传（原始字节走 body、文件名走请求头，名字带笔记主干前缀且重名加后缀不覆盖，只取绝对路径的最后一段，缺路径缺名字空文件与目录逃逸一律 400），
   172 项面板渲染验收（jsdom 真渲染面板，含待办页签把全库没做的方框收成一张单子且勾一下当场划掉（勾完只拿掉那一行、不整页重查）、点文字打开那一篇，含深浅主题切换、跟随宿主语言、命令意图送达、右键菜单动作清单（含「在 Obsidian 里打开」）、卡片拖出去带宿主链接格式、三栏手柄拖动与键盘微调、选区速记落成笔记、同步结果回交宿主、库大小与当前笔记报给宿主、列表增量渲染、代码块右上角的「复制」搬走的是围栏里那一份原文（缩进与引号原样、不带语言标签，没接复制去处时不摆按钮）、确认框交给宿主且取消后一步不走、在 Obsidian 里打开把路径交出去、反链优先问宿主且注入后不再打 /backlinks、窄窗口抽屉与返回列表、编辑态 Ctrl+S 保存与 Esc 退出、上次看到哪儿能恢复且存坏了不炸、别处改了当前这篇面板当场换正文且自己刚存过的不重复读、复制引用先问宿主拿链接格式、popout 窗口里各自注入样式且 Ctrl+K 只聚焦本窗口的搜索框、附件地址先问宿主的资源协议且问不到就退回本地服务、从宿主文件树拖进来的笔记真的挪进当前目录且没选目录先说一声、「今天」按宿主的日记配置落位置且问不到就退回自己的日期标题、点内链先问宿主的索引且问不到或宿主炸了都退回自己按名字找、新建笔记落在宿主指定的目录里且宿主给空串或炸了都还建得出来、面板里的图片点了交给宿主打开且没接上宿主时不假装能点、「今天」新建时用宿主日记插件里配的模板且读不到就建一篇空的、改名交给宿主的对话框且没保存的改动先拦住、双链带小节时切开后交给宿主解析并滚到那一节且那一节没了就明说、出链优先问宿主的索引且同一篇写两遍会合掉、正文里嵌入的另一篇笔记真的嵌进来且只嵌一层（再深一层留成文件名，附件与解析不出来的仍是文件名）、拖进笔记正文的文件真的存成附件并在正文里留下带主干前缀的引用且截图后 Ctrl+V 也一样（有没保存的草稿时只改草稿不落盘）、嵌进来的那一篇能停在指定的小节上且 ![[#本节]] 直接滚到这一篇的那一节（嵌入框自己不是滚动容器，滚的是外面那层）、设置页里的「面板跟着我翻」勾上之后真的写进设置且再点一下能关掉、笔记头部的属性摊在正文上方（tags 拆成可点的胶囊且点一下去左栏筛这个标签，空值的键不占行，没有头部的笔记不出现空框）、双链写的是别名时也指得到那一篇且 `![[别名]]` 也嵌得进来、有没保存的草稿时点「返回列表」先问一句且说「不要」就一步都不走、反链底下带上引用那一行的上下文（双链本身削掉、太长两头留一点中间省略，标出这一篇里提了几次且提得多的排在前面、同一行里写两遍只留一条上下文，宿主那条路是异步的、晚一步答也落得下来且宿主答「我这儿没有」时照样退回自己扫）、搜索结果卡片上也列出这一篇引用了谁且点胶囊能跳过去（超过四颗收成 +N）、断链页把全库指不到的双链摊出来且点一行就打开出问题的那篇（围栏里的、带小节的、指附件的、写成别名的都不误报）、正文里写的 #标签 也进标签云且点一下就能筛出那一篇、正文里那串 #标签 本身做成能点的胶囊且点一下就去左栏筛（纯数字与紧贴着字的井号原样留着、不当标签看）、引用块写成宿主那种 callout 时图标标题正文各归各位且 [!warning] 这串标记不原样露出来（认不出的类型也照样有标题、只是配色走中性那套，带减号的默认收起且点标题展开，普通引用块还是普通引用块）、搜索卡片上的命中行点一下就打开那一篇并滚到那一行（锚的是那一行文字不是行号，找不到时安静停在篇首而不是弹错误，命中行里那个词标了出来、大小写不敏感且重叠的词按长的先吃、`tag:` / `dir:` 限定词不去染正文）、删除线高亮和注释按宿主那套认（`~~划掉~~` 真的划掉、`==高亮==` 真的标黄、`%%注释%%` 一个字都不露，行内的和整段的都不露）、正文里的图点一下当场放大且按 Esc 收起（Esc 只关遮罩不退出笔记，点图本身不关、点空白处才关，有放大去处时不再把焦点交给宿主）、清单行末尾敲回车接着写下一行（有序列表自动加一、`- [ ]` 接着还是 `- [ ]`、空条目敲回车把那行记号收掉、引用层原样贴回去、光标在行中间时不接管）、Tab 把整行挪两格且焦点不跳走（Shift+Tab 收回来、空行不补空格、选区跟着挪、已经顶格时再收也不吃字）、大纲上亮着「现在读到哪一节」（同一时刻只有一节亮着、从大纲点过去就换成那一节、自己往下翻也跟着换）、编辑区里 Ctrl+B / Ctrl+I / Ctrl+Shift+X 给选中的字套上记号且连按两次等于取消（提示行里写得出这几个键）、编辑区里敲 `[[` 会摆出名字对得上的笔记、上下键挑一条回车补成双链（重名的插整条路径、一条都对不上就不弹空盒子）、编辑区里敲 `#` 会摆出库里用过的标签、挑一条补上去且不加右括号（`C#` 与 `## 标题` 不算、双链里的井号也不算）、换一篇再回来还停在上次读到的地方（没记过的那篇从头开始、翻回顶上就记 0）、正文里就地找一句话（回车往下走、Shift+回车往回走、走到头说「已经到头了」而一处都没有说「这篇里没有」，Esc 收起查找条，刚跳到的块不被当成「还没到」）、列表能在「最近改的」和「按名称」之间切（切完记在本地，搜索态那颗开关也留着、默认按相关度、点一下只把手上这批命中按名字重排，两档各记各的）、阅读态按 Ctrl+F 直接把查找条叫出来而编辑态按下去找的是正文里那一段字（再按一次不关掉、焦点在输入框里时不被抢走、Esc 收起后焦点回到正文）、在笔记之间前进后退（Alt+← 回上一篇、Alt+→ 再走回去，笔记头那两颗箭头跟着亮灭，有草稿时先问一句、答「不要」就留在原地，编辑区里按也照样生效）、Ctrl+E 在阅读态进编辑、编辑态存好再退（没改过就不白写一次盘、存不下也照样退出）、反链底下那句上下文点一下就落到那一句、不是只送到篇首（双链从上下文里削掉了，正文里它是个胶囊，整串比对对不上就按词顺序找）、标签按斜杠摊成层级且点父标签把子标签的笔记一起收进来（子标签缩进一层、父标签的数把子标签算进去、悬停看得到完整路径）、中栏顶上摆出当前的筛选且点一下就退出去（目录一颗胶囊、标签一颗、两颗都清掉整条自己收起来）、按 ? 摊开一张快捷键速查表（Esc 先收它、再按一次 ? 也收、点空白处也收，焦点在输入框里按 ? 不弹）、写到一半关掉窗口再打开那篇会问要不要接着写（接着写把草稿填回编辑区、丢掉就清掉并说一声，存好了或者按 Esc 取消就不再问，同一篇只问一次）、鼠标停在列表卡片上就请宿主把这一篇预览出来（没登记预览来源时一条都不触发、卡片内部挪动不反复触发、宿主那边炸了也不把面板带崩）、正文里划选一段就地能复制或直接存成新笔记（标题取选中内容的第一行、落在当前筛的目录里并当场打开，在笔记头这类正文之外松手不弹、编辑态里也不弹）、篇尾脚注点一下就回到正文里引用它的那一句（回车也行，注解正文里的双链点了还是按它自己的意思走、不被这一行截走）、编辑区里选中一段字再粘贴网址会变成「那段字」当链接文字（没选字、剪贴板里不是网址、选中的本来就是链接时都不插手）、右键里能把这一篇复制成一份副本（副本照抄原名不叠今天的日期、建完当场打开、原文件一个字都不动）、搜索里引号把一串词绑在一起、减号把它排掉（结果当场跟着变、标色只标正文词）、按 x 把当前这一篇选进批量操作（再按一次退出、Esc 把整批清掉）、搜完在搜索框里按回车就打开排在最前面的那篇、Esc 退回整份列表（空搜索框里回车不打开任何东西、输入法组字时回车照常上屏）、搜索框里有字时右边多一颗清空（点一下词没了、列表退回整份、光标还在框里，空框上不摆这颗按钮）、大纲里每一节右边那颗小按钮能抄一条指向这一节的链接（怎么拼先问宿主、宿主给不出或炸了就退回 `[[路径#小节]]`，点标题本身只跳转不抄链接）、把卡片拖到左栏某个目录行上就挪进那个目录（那一行先亮起来、放下之后高亮收掉，笔记头跟着换成新路径、旧位置不再留着，正文一个字没动，从宿主文件树拖进来的文件仍按导入走）、笔记头那行路径点一下就请宿主在文件列表里定位（回车和空格也行、悬停说清点一下会怎样，宿主没这个接口时退回纯文字、不留一个点了没反应的可点外观）、指向还不存在的笔记的双链暗一档、悬停说清是哪一篇找不到（写得出的那篇不受影响、`[文字](笔记.md)` 同样适用、点了仍会明说一句、没接上解析函数时不乱标）、搜索框敲到一半就把库里已有的目录名和标签名摆出来（dir: 只摆目录、# 只摆标签、打头的排前面，上下键挑、回车补进去，光标后面有空白就不提示，Esc 先收候选而不是清空）、卡片底下摆着这一篇的标签且点一颗就按它筛（最多三颗、多的收成 +N，点标签不会顺带打开这一篇、左栏跟着亮）、批量移动的目标目录也能挑（敲字就摆出库里已有的目录、上下键挑、回车或点一下填进去，Esc 先收候选而不清掉已填的字，挑一条只填名字不动文件、再按「移动」才真的挪）、批量加标签的标签框也一样能挑（敲字就摆出库里已有的标签、Esc 先收候选而不清掉已填的字，挑一条只填名字、加还是去再点那颗按钮）、断链那一行点「去这一句」就打开那一篇并落到写着这个名字的那一行（不是只送到篇首，锚的是那一行文字不是行号）、待办页顶上那颗「复制这份清单」把整份抄成一段 Markdown（一篇一个 `## 标题`、下面一行一条 `- [ ] 正文`，已勾掉的不抄、顺序跟屏幕上一致、抄的是原文不是被截断的省略号）、篇尾那排出链里指向不存在的那些也暗下去、悬停说清是哪一篇找不到（写得出的不受影响、点了仍会明说一句、没接上解析函数时不乱标）、目录行右键改名把整棵子树连同笔记一起搬过去（新名字撞上已有目录、填的是保留目录名、原目录不在时当场说一声就不动，正开着的那一篇笔记头跟着换到新位置，版本历史也一起搬）、新建笔记时能先指定建到哪个目录（敲字就摆出库里已有的目录、上下键挑、回车或点一下填进去，Esc 先收候选而不清掉已填的字，挑一条只填名字、真要建还得再点一类模板；填了目录就以它为准，留空仍按「面板里选中的目录，否则宿主默认位置」走）、双链指空了就在报错行里点「写一篇」把它就地建出来（名字照抄双链里写的那个、落在当前这一篇所在的目录里，建完当场打开、那条双链当场不再暗）、刚建好还空着的目录也摆在左栏里、计数 0（点进去是一屏「这里还没有笔记」、右键删得掉，新建笔记的目录框里也挑得到它）、左栏标签多的时候每一支前面那颗小箭头能把子标签折起来、再点展开（折起来之后更深的那些子标签一起收掉、点箭头不等于按这个标签筛选、没有子标签的行不摆一颗按了没反应的箭头）、左栏目录区和标签区的标题行各有一颗「全部收起」，一次把这一区里能收的行全收起来、再按一下全摊开（两区互不牵连、全收着时按钮改成「全部展开」，全是叶子的那一区不摆这颗按钮）、列表顶上那颗「全部勾上」一次把这次筛出来的卡片都选上、再按一下全不勾（勾的是屏幕上这一摊不是整个库，全勾着时它自己改成「取消勾选」，一屏都没有卡片时不摆这颗按钮）、头部里写着的那条整串就是双链的值也做成能点的胶囊、点了就跳过去（带小节的也认、`[[笔记|名字]]` 按那个名字显示，夹在句子中间的不动）、待办页按篇分组且组头写着这一篇还剩几条（点组名打开那一篇、「勾掉这一篇的 N 条」一次勾完并一条条写回、勾完只拿掉那几行不整页重查，中途出错重新查一遍而不假装勾上）、断链页把全库指不到的名字按名字分组、一行头写着被写错了几处（组头右边一颗「写一篇」在库根把那一篇建出来并当场打开，写完之后这一组自己就不在清单里了）、目录行右键「在这里新建笔记」直接建在这个目录里并当场打开（标题沿用「新建笔记」那个默认名、正文留空，不用先建完再挪一次）、骨架屏上永远压着一行看得见的字、等过六秒就改成「本地服务好像没连上」并给一颗「重试」（占位色块在深色主题里可能和背景同色，光看色块分不出「在加载」和「挂了」；正常加载时那行字说在等什么，等太久就说没连上、按了重试真的去重新拉一次）、把卡片拖到左栏某个标签胶囊上就给这一篇贴上那个标签（胶囊先亮一圈边框、放下之后高亮收掉；笔记留在原地不动、只在头部多一个标签，正开着的那篇当场长出新标签；从宿主文件树拖进来的那种拖动不算）、搜不到东西时中栏那一屏会说清是没有匹配并给一颗「清空」一键抹掉搜索词、筛着一个空目录时说清是这一支还没有笔记并给一颗「清掉筛选」把筛选一起撤掉、连笔记库都还没有时那一屏直说还没有本地笔记库、只给一颗「去设置里挑个目录」（「新建」和「清掉筛选」这时候都不摆）、回收站里恢复一篇时能先指定放回哪个目录（敲一半有目录候选、留空还是放库根、同名不覆盖照旧加后缀）、卡片底下那个「+N」点一下就在原地摊开全部标签、再点收回三颗（摊开只是把话说完、不按它筛也不把这篇打开）、卡片上那个目录也点得动、点了就按这个目录筛（左栏跟着亮、顶上摆出一颗点得掉的筛选胶囊，不把这篇打开）、断链页能把整张清单一次抄成一段按名字分组的 Markdown（每条带出处的篇名、行号和那一句原文，一条断链都没有时不摆这颗按钮）、搜索卡片上那行「它引用了谁」收起来的那几处也点得开（点一下就地摊出全部、再点收回四颗，摊开不跳走也不把这篇打开）、热力图上点某一天就按那一天筛（再点同一颗取消，空日不摆按钮，按日期筛时把目录和标签的筛选一起让开）、卡片上那个日期也点得动、点了就按那一天筛（再点同一篇的日期取消，左栏跟着亮、不把这篇打开）、搜完之后能把这次找到的几篇一次抄成一段清单（一行一篇写着名字和位置，一条都没搜到时不摆这颗按钮）、版本历史里点开一版，头部直说恢复之后会多几行还是少几行（方向是「从现在换成这一版」，一行不差时写「和现在一样」）、搜索框空着时下面摆着最近搜过的几个词（最多八个、点一颗填回框里当场又搜一遍、旁边一颗一次清干净，边打边搜的中间态不会被存进去）、勾上几篇之后能把它们的引用一次抄走（一行一条、链接怎么写先问宿主，抄完选中不清掉）、回收站里每一行都能就地看一眼那篇写的是什么（摊的是正文开头一段、太长就说清还有多少字没展开，再点一下收回，一次只摊一篇，只读不碰文件）、待办页里每一篇都能收起来（组头前面那颗小箭头一点就把这一篇的行收起来，组头、篇名、还剩几条和「勾掉这一篇的 N 条」都留着，收起来的地方写一行说清收了几条、再点原样摊开，别的篇不受影响；篇数多时顶上那颗「全部收起」一次把所有篇都收起来、再按一下全摊开，全收着时它自己改成「全部展开」，只有一篇时不摆）、宿主把视图挂上却不喊 `onOpen` 时插件自己补一次且只画一遍、左栏那个筛只筛目录行和标签行、不碰中栏搜索框（命中那一支的上级目录一起留着、清掉回全量、一个都没对上时明说没有对得上的、按 Esc 只清左栏这个筛）、读到列表中间那一篇时笔记头上能接着看上一篇/下一篇（按当前这次筛出来的顺序走、悬停写着目标篇名、走到头那颗就收起来，阅读态脚下报着「第几 / 共几篇」）、卡片右键能把这一篇的正文整段抄走（带走的是正文、开头那段属性不跟过来，提示条报着复制了多少个字，空篇明说没东西可抄）、批量里有几篇没成时把没成的那几篇和原因一条一条摊在批量条上面（点「知道了」才收起来，成了的那几篇不混进去）、勾了一张之后按住 Shift 再点一张就把这一摊连着勾上（按当前这次筛出来的顺序算、跳过的那几张不带进来，整段本来就全勾着时再 Shift 点一下是整段取消，勾选框的提示会跟着改口）、两个地方都改了同一篇时保存先问一句「存我这一版 / 用别处那一版」（选后者正文当场换成磁盘上那一份、选前者才真的覆盖，写之前那一版照旧进历史）、搜完在提示那行下面报一句「扫了多少篇、对上多少篇」（真被条数上限截了就再补一句说停在上限、后面还有没扫到的，没被截时不说这句）、搜索框里那一串限定词拆成几颗胶囊摆在下头（限定词、正文词、排除词各一颗，排除词那颗划掉；点掉一颗那一段就从框里消失、当场重搜一遍，别的段原样留着；只敲一个普通词时不摆）、删一篇之前先反查一句「还有谁提到它」（有谁提到就把篇名点出来、说清删掉之后那几处的链接会断，问一句「还是要删 / 先不删」；选「先不删」这一篇原样留着，一篇都没提到它时不弹这一问）、字号是这一篇自己的事（这一篇调成大字，换一篇还是它原来那档，回来还是大的；调回标准等于没单独调过、那笔记录当场抹掉）、右栏空着时那颗「写一篇新的」是真能点的（点一下就地建一篇并打开，不是只指着顶栏那颗「+」）、批量删之前也先反查一句「这几篇里谁被人提到过」（被引用的那几篇点名出来、说清有几篇、删掉之后那些链接会断，问一句「还是要删 / 先不删」；选「先不删」这一批原样留着，一篇都没被提到时还是原来那句「确定吗」）、目录不是空的也能删（右键删除时先报「里面还有几篇笔记、几个子目录」，旁边多一颗「连里面的 N 篇一起删」；点它之后每一篇照旧先进回收站、提示里说「N 篇在回收站里」，目录非空时原来那颗「删除」是灰的）、回收站里能勾几个一起恢复、也能一起永久删掉（勾上几个之后上头报「已选 N 个」，全选 / 取消选择 / 恢复这几个 / 永久删除这几个都在；恢复只填一次目录就把它们全放回去、同名照旧加后缀，没勾的那几篇原地不动；有几个没成时提示里分开报「已恢复 2 个 · 有 1 个没能恢复」，永久删之前先问一句「无法撤销」）、断链那一组能改指到已有的那一篇（填上本来想指的名字、回车全库一起改过去，只换链接名字、后面跟的小节和显示文字原样留着，代码块里的不动；改之前先问一句「全库这 N 处都改过去」，改完这一组从清单上消失）、断链页能按名字或篇名筛一处（按「指不到的那个名字」「出处那一篇」「那一句原文」随便对上一个就留下，下面报「筛出 1 处，一共 12 处」；这个筛只管这一页、不碰中栏搜索框，Esc 或点清空就回全量；筛空时说「没有对得上的断链」而不是「库里每一条都指得到」，这时候「复制这份清单」抄的也是筛出来的那几处）、回收站里每一行直说一句「原来在」哪个目录（不说放哪就恢复回原处、不是一律丢回库根；索引里没有的老笔记仍落库根，清空回收站时索引跟着清掉但不计进「已清理 N 个」）、待办页能按待办正文或篇名筛一条（随便对上一个就留下、下面报「筛出 1 条，一共 N 条」；这个筛只管这一页、不碰中栏搜索框，筛着时「复制这份清单」抄的也是筛出来的那几条；一条都对不上时说「没有对得上的待办」并让你清掉这个筛，Esc 只清这一页）、回收站攒多了能按文件名或原目录筛（名字和原目录一起对，只记得目录的人也能一次筛出整个目录里删掉的那些；下面报「筛出 1 个，一共 37 个」，这个筛只管这一页、不碰中栏搜索框，Esc 只清这一页；一条都对不上时说「没有对得上的文件」并让你清掉这个筛，筛着的时候「清空回收站」照旧按得动——它清的是整个回收站）、版本历史留几版是设置项（设置页里那张卡填 1 到 200，填 0 或填字先拦住、不写进去；改小保存之后库里超出的那些当场裁掉、提示里报「顺手裁掉了 N 版」，笔记头那句「最多留最近 N 版」也跟着这个数字走）、版本历史那一版能在「渲染」和「原文」之间切（渲染档只铺正文、开头那段 frontmatter 不变成正文里的字，原文档整份一字不改、连头部都在，切回渲染状态跟着回来）、历史列表按设置里的「留几版」给（调到 200 就该列得出 200 条，撞到上限时头部补一句「最多留 N 版，可在设置里调」，让人分得清「旧版被裁掉了」和「只是没列出来」）、面板里那几块白都压暗了一档（搜索框、卡片、弹层不再是纯白 —— 深色下也不回落成白的，切回浅色照样还原）、反链一多就先摆前四条（底下那颗虚线胶囊写着「+N」，点开摊出全部、再点收回四条；换一篇重新收起，不是上一篇摊开这一篇也摊开）、搜到的不止四十篇时底下能接着看（按一下多接四十篇、搜索框里的词一个字不动，全给完了那句「被条数上限截了」自己收起来，按到三百条顶格就改口说一次最多这么多、再往下要靠收窄词）、出链一多就先摆前六颗（同一行最后那颗虚线胶囊写着「+N」，点一下就地摊全、再点收回六颗；换一篇重新收起，不是上一篇摊开这一篇也摊开）、读到哪一节大纲就自己跟过去（亮着的那条一落到 220px 可见区外面就挪回中间，整条本来就看得见时一下都不动，、大纲一长顶上那行筛能筛到想找的那一节（小节超过六个才摆，敲几个字只剩对得上的那几行、留下的那一行还记着原来第几节，一条都对不上时说「没有对得上的小节」，Esc 只清这一页的筛）、只挪这个小列表、正文一动不动）、读到底了能一键回顶上（正文往下滚过一屏右下角才浮出那颗「回到顶部」，按一下平滑滚回去、滚回顶上它自己收起来，换一篇也重新收起，小笔记与编辑态都不摆）、写太长时编辑态脚下就先说「超过单篇上限」，按了保存被 413 打回也翻成人话而不是那句英文、冲突攒多了顶上那行筛能筛到想找的那一条（按留档的名字筛，已处理的那区连「当初采纳的是本地还是云端」一起筛得到；筛着时报「筛出几条、一共几条」，一条都对不上时说「没有对得上的冲突」而不是「没有待处理的冲突」，Esc 只清这一页的筛）、回收站里摊开的开头一段不够看时能就地摊全（截断时尾巴上多一颗「在这儿看全」，点一下整篇摊开、不再拿高度卡着，按钮改成「只看开头」、再点回到开头一段，换一篇或收起来都重新从开头一段开始）、设置页里每个模板都能摊开看全文（摊出来的是整段而不是列表里那两行、再点一下收回，只有标题的模板明说它只有标题而不是摊一个空框，一次只摊一个）、9 项视图层验收（jsdom 里真 new 一个
   `ItemView` 调 `onOpen`，确认面板挂进 `contentEl`、样式只注入一份、关叶子时组件树卸载干净，
   渲染抛错时把原因和堆栈画到屏幕上并落一份 `panel-error.txt`、首帧没画出来时看门狗自己报出来、
   插件加载与服务就绪与视图挂载各往 `boot.txt` 里留一行、视图绝不去动宿主那个 `containerEl`（动了就是把面板画在屏幕外）），
   以及 8 项正文渲染验收（走宿主渲染器 / 渲染器抛错退回原样文本 / 快速换笔记不被旧渲染盖掉 /
   内链与待办点击、悬停内链请宿主弹页面预览、超过八行的表格自己滚且表头钉在顶上而短表格不套第二层滚动、批量操作里能把一个标签从选中的几篇里一起去掉（头部那个标签和正文里写着的 #标签 一起去掉、同一篇里别的标签不动、本来就没这个标签的那几篇算处理过了不进失败清单）、阅读态篇尾报着这一篇多少字、大概读几分钟（中文按字西文按词、不足一分钟也报一分钟，切进编辑态就换成草稿字数那条）、目录多的时候每一行前面那颗小箭头能把这一支折起来、再点展开（折起来之后子目录和更深的那几层一起收掉、点箭头不等于选中这个目录、底下没有目录的行不摆一颗按了没反应的箭头）、查找条报出「第几处 / 共几处」（到头了停在最后一处不跳回 1、改了词旧数字收掉、编辑态也报）、待办那一行点「去这一条」就打开那一篇并落到写着这条待办的那一行（不是只送到篇首、锚的是那一行文字不是行号）、列表底下那颗「全部显示」一次把剩下的都摊出来（不用一屏一屏点下去、全摊开之后这颗按钮自己收起来）、8 项逐字稿联动验收（时间戳解析与换算、播放进度落在哪一段、点时间戳把秒数
   交给上层、跳转请求真的让播放器跳到那一秒且不会误伤别的音轨、没有音轨时不做成按钮）。
