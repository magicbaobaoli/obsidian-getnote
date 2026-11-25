/**
 * 打包进 main.js 的录音卡桥脚本。
 *
 * 为什么要把 .py 内联进 main.js：社区目录装插件时 Obsidian 只下载 main.js、
 * manifest.json、styles.css 三个文件——Release 里多挂的 zip 或 card/ 目录它一个都
 * 不会取。所以「桥脚本放在 main.js 旁边的 card/ 子目录里」这条路对目录用户是断的：
 * 插件装上了，一点录音卡就报找不到脚本。把脚本当成字符串打进 bundle，加载时按需
 * 解到插件数据目录，三个文件的安装就真的是完整的。
 *
 * 只在文件缺失或长度不同时才写盘：每次启动都重写会让 Windows 上的杀毒软件反复扫
 * 同一个文件，也让「用户自己改过脚本调试」这件事没法做。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import bridgePy from '../card/getcard_bridge.py'
import wifiTransferPy from '../card/wifi_transfer.py'
import wifiProbePy from '../card/wifi_probe.py'
import wifiFetchPy from '../card/wifi_fetch.py'

/** 文件名 → 脚本正文。构建期由 esbuild 的 text loader 填进来。 */
export const BUNDLED_CARD_SCRIPTS = {
  'getcard_bridge.py': bridgePy,
  'wifi_transfer.py': wifiTransferPy,
  'wifi_probe.py': wifiProbePy,
  'wifi_fetch.py': wifiFetchPy,
}

/**
 * 把桥脚本解到 `<插件数据目录>/card/`。
 *
 * 失败不抛：脚本解不出来时录音卡用不了，但本地笔记、搜索、同步都还该照常能用，
 * 所以这里只返回一个 `{ written, failed }` 让调用方决定记哪一行启动轨迹。
 */
export async function ensureCardScripts(baseDir) {
  const dir = join(baseDir, 'card')
  const written = []
  const failed = []
  try {
    await mkdir(dir, { recursive: true })
  } catch (error) {
    return { written, failed: [{ name: 'card/', error: String(error && error.message ? error.message : error) }] }
  }
  for (const [name, body] of Object.entries(BUNDLED_CARD_SCRIPTS)) {
    const target = join(dir, name)
    try {
      const existing = await readFile(target, 'utf8').catch(() => null)
      if (existing === body) continue
      await writeFile(target, body, 'utf8')
      written.push(name)
    } catch (error) {
      failed.push({ name, error: String(error && error.message ? error.message : error) })
    }
  }
  return { written, failed }
}
