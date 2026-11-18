import { readFile, writeFile } from 'node:fs/promises'

const BT = String.fromCharCode(96)
const SRC = 'D:/xinqi/应用/应用DSH/dsh-getnote-official/lib/client.js'
const OUT = 'D:/xinqi/应用/应用DSH/obsidian-getnote/src/view/panel.js'

const text = await readFile(SRC, 'utf8')
const lines = text.split('\n')
// 去掉 __ModuleLoader__ 工厂的收尾 3 行：return module.exports / }, / })
let code = lines.slice(16, lines.length - 3).join('\n')

const report = []
function swap(from, to, label) {
  const n = code.split(from).length - 1
  report.push(label + ' x' + n)
  if (n > 0) code = code.split(from).join(to)
}

// React 来自宿主模块表 -> 普通 ESM import（下面统一前置）
swap(/^\s*const React = require\('react'\)\s*$/m, '', 'react-require-removed')

// /getnote 相对地址 -> 本机回环服务绝对地址
swap('fetch(' + BT + '/getnote${path}' + BT, 'fetch(' + BT + '${apiOrigin()}/getnote${path}' + BT, 'api')
swap(BT + '/getnote/asset?path=', BT + '${apiOrigin()}/getnote/asset?path=', 'asset')
swap(BT + '/getnote/audio?url=', BT + '${apiOrigin()}/getnote/audio?url=', 'audio')
swap("'/getnote/archive/export'", BT + '${apiOrigin()}/getnote/archive/export' + BT, 'export-zip')
swap("'/getnote/archive/import'", BT + '${apiOrigin()}/getnote/archive/import' + BT, 'import-zip')
swap("track.url.startsWith('/getnote/')", 'track.url.startsWith(' + BT + '${apiOrigin()}/getnote/' + BT + ')', 'track-prefix')

// 切掉 DSH 专用接线尾部（apply / slots / locale 注册 / exports.__internals）
const CUT = "    const inject = ['slots', 'locale']"
const cutAt = code.indexOf(CUT)
if (cutAt < 0) throw new Error('cut anchor not found')
code = code.slice(0, cutAt)

const header = [
  '/*',
  ' * 得到大脑 · Obsidian 面板视图',
  ' *',
  ' * 由 DSH 版 lib/client.js 机械移植：剥掉 __ModuleLoader__ 工厂壳与 slots/locale 接线，',
  ' * 其余 React 组件、Markdown 渲染器、样式与图标原样保留。',
  ' */',
  '',
  "import * as React from 'react'",
  '',
  '// 面板要访问的本地服务地址，由 main.js 在服务监听成功后写入。',
  '// Obsidian 里没有宿主的 webServer，/getnote 全部走本机 127.0.0.1 回环端口。',
  "let __apiBase = ''",
  'export function setApiOrigin(origin) {',
  "  __apiBase = String(origin || '').replace(/\\/+$/, '')",
  '}',
  'function apiOrigin() {',
  '  return __apiBase',
  '}',
  '',
].join('\n')

const tail = [
  '',
  '// ---- Obsidian 侧导出：ItemView 直接挂 PanelRoot，图标给 ribbon 用 ----',
  'export {',
  '  PanelRoot,',
  '  PanelIcon,',
  '  PanelBoundary,',
  '  GetnotePage,',
  '  injectCss,',
  '  LEX,',
  '  ICONS,',
  '  setUiLocale,',
  '  activeUiLocale,',
  '}',
  '',
  '// 离线测试直接验渲染结构用，运行时无影响',
  'export const __internals = {',
  '  renderBlocks, renderInline, stripLeadingHeading, LEX, ICONS, AudioPlayer, CloudPane,',
  '  SyncPane, CloudCredCard, SettingsPane, GetnotePage, NotePane, TranscriptBlock,',
  '  looksLikeTranscript, formatMoment, TrashPane, renderEmbed, assetLabel, ThemeCard,',
  '  themeVars, parseHex, rgbToHsl, hslToHex, ConflictPane, ArchiveCard, CardPane,',
  '  TemplateCard, SkeletonPane, HeatmapStrip, LanguageCard, setUiLocale, activeUiLocale,',
  '}',
  '',
].join('\n')

await writeFile(OUT, header + code + tail, 'utf8')
console.log(report.join('\n'))
console.log('out lines: ' + (header + code + tail).split('\n').length)
