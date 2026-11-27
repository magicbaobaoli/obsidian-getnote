/*
 * css-hooks.mjs —— 让 Node 也能 import .css
 *
 * 面板样式表在 src/view/panel.css，构建时由 esbuild 的 text loader 打成字符串。
 * 但离线测试直接 import src/view/panel.js，Node 不认识 .css 后缀，会直接
 * ERR_UNKNOWN_FILE_EXTENSION 崩掉。这里注册一个 loader，把它读成同样的字符串，
 * 于是测试与打包看到的是同一份 CSS 文本。
 *
 * 只在测试进程里生效（package.json 的 test 脚本用 --import 挂进来）。
 */

import { register } from 'node:module'

register('./css-loader.mjs', import.meta.url)
