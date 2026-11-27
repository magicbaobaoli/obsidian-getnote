#!/usr/bin/env node
/**
 * 构建：把 src/main.js 连同 src/core/* 一起打成单文件 main.js。
 *
 * Obsidian 插件只认一个 main.js，不能用相对 import 分文件加载，所以必须打包。
 * 用 esbuild 而不是 tsc：移植过来的核心模块是纯 JS，不需要类型检查这一步，
 * 少一层工具就少一类失败。
 */
import { build, context } from 'esbuild'
import { cp, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const watch = process.argv.includes('--watch')

const options = {
  entryPoints: [join(root, 'src', 'main.js')],
  outfile: join(root, 'main.js'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  // Obsidian 与 Electron 提供这些模块，不能打进来
  external: ['obsidian', 'electron'],
  sourcemap: false,
  minify: false,
  // preact / preact/compat 里也有 `if (process.env.NODE_ENV === 'production') ...`
  // 这种运行时判断，esbuild 静态分析不了，于是开发版和生产版两份都会打进来。
  // 这里把 NODE_ENV 钉成字面量，分支在打包期就折叠掉，开发版整份消失。
  // （早前用的 react-dom 更夸张：光它的开发版就 890KB，占了整个插件的半壁。）
  define: { 'process.env.NODE_ENV': '"production"' },
  // 录音卡的 .py 桥脚本当成字符串打进 bundle：社区目录只下载 main.js / manifest.json /
  // styles.css 三个文件，挂在 Release 里的 card/ 目录不会被取走。加载时再解到插件目录。
  // .py 是录音卡的桥脚本、.css 是面板样式表：两者都当字符串打进 bundle。
  // 社区目录只下载 main.js / manifest.json / styles.css，源码里的 panel.css
  // 不会跟着走，所以必须内联进 main.js。
  loader: { '.py': 'text', '.css': 'text' },
  // 警告当错误：esbuild 的黄字（重复键、语法降级、loader 未配置…）没人会看第二眼，
  // 于是重复键在 LEX 里活了好几个版本。这里把它们抬成构建失败。
  logLevel: 'silent',
}

/** 把 python 桥与语言包放进插件目录：它们要在运行时按相对路径读。 */
async function copyAssets() {
  await mkdir(join(root, 'card'), { recursive: true })
  await mkdir(join(root, 'locale'), { recursive: true })
  for (const name of ['getcard_bridge.py', 'wifi_transfer.py', 'wifi_probe.py', 'wifi_fetch.py']) {
    await cp(join(root, 'src', 'card', name), join(root, 'card', name))
  }
  for (const name of ['zh.json', 'en.json', 'nl.json']) {
    await cp(join(root, 'src', 'locale', name), join(root, 'locale', name))
  }
}

if (watch) {
  // watch 下照常打印，改错了要能看见红字。
  const ctx = await context({ ...options, logLevel: 'info', plugins: [{ name: 'assets', setup(b) { b.onEnd(() => copyAssets()) } }] })
  await ctx.watch()
  console.log('watching...')
} else {
  let result
  try {
    result = await build(options)
  } catch (error) {
    console.error(`构建失败：${error.message}`)
    process.exit(1)
  }
  const warnings = result.warnings || []
  if (warnings.length > 0) {
    for (const w of warnings) {
      const where = w.location === undefined || w.location === null
        ? ''
        : `${w.location.file}:${w.location.line}: `
      console.error(`构建警告 ${where}${w.text}`)
    }
    console.error(`构建失败：${warnings.length} 条警告`)
    process.exit(1)
  }
  await copyAssets()
  const bytes = (await readFile(join(root, 'main.js'))).byteLength
  console.log(`main.js ${(bytes / 1024).toFixed(1)} KB`)
}
