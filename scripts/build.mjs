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
  logLevel: 'info',
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
  const ctx = await context({ ...options, plugins: [{ name: 'assets', setup(b) { b.onEnd(() => copyAssets()) } }] })
  await ctx.watch()
  console.log('watching...')
} else {
  await build(options)
  await copyAssets()
  const bytes = (await readFile(join(root, 'main.js'))).byteLength
  console.log(`main.js ${(bytes / 1024).toFixed(1)} KB`)
}
