/*
 * css-loader.mjs —— 把 .css 读成一个 ESM 字符串模块（default 导出）。
 *
 * 与 esbuild 的 loader: { '.css': 'text' } 行为一致：导出的就是文件原文。
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    const text = await readFile(fileURLToPath(url), 'utf8')
    return { format: 'module', source: 'export default ' + JSON.stringify(text), shortCircuit: true }
  }
  return nextLoad(url, context)
}
