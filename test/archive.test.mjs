/**
 * 整库打包 / 解包（zip）的离线性验收：不碰网络、只用临时目录。
 *
 * 特意额外用「外部实现」的思路校对字节：本模块自己写 zip，如果读写两侧共享同一个
 * 误解（比如 CRC 算法或文件名编码一起错），自查会一路绿灯、到用户解压时才炸。
 * 所以除了往返测试，还直接断言签名字节、UTF-8 标志位和 CRC 数值。
 */
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, readdir } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  exportVaultToZip,
  importZipToVault,
  buildZipBuffer,
  crc32,
} from '../src/core/archive.js'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

/** 造一个库：`files` 是 {相对路径: string|Buffer}。 */
async function makeVault(root, files) {
  await mkdir(root, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, content)
  }
  return root
}

/** 把库里的文件读成 {相对路径: Buffer}，用于逐字节比对。 */
async function snapshot(root) {
  const out = {}
  const walk = async (dirAbs, relDir) => {
    for (const item of await readdir(dirAbs, { withFileTypes: true })) {
      const rel = relDir === '' ? item.name : `${relDir}/${item.name}`
      if (item.isDirectory()) await walk(join(dirAbs, item.name), rel)
      else out[rel] = await readFile(join(dirAbs, item.name))
    }
  }
  await walk(root, '')
  return out
}

const base = await mkdtemp(join(tmpdir(), 'dshgn-archive-'))
const rootA = join(base, 'vault-a')
const rootB = join(base, 'vault-b')
try {
  // ── 1. 空库导出：必须是合法 zip（能自己读回来） ────────────────────────────
  const emptyDir = join(base, 'empty-src')
  const emptyOut = join(base, 'empty-dst')
  await mkdir(emptyDir, { recursive: true })
  const emptyZip = await exportVaultToZip(emptyDir)
  check('空库: 导出一个非空 zip（含 EOCD）', Buffer.isBuffer(emptyZip.buffer) && emptyZip.buffer.length === 22, `${emptyZip.buffer.length} bytes`)
  check('空库: EOCD 签名 0x06054b50', emptyZip.buffer.readUInt32LE(0) === 0x06054b50, `0x${emptyZip.buffer.readUInt32LE(0).toString(16)}`)
  check('空库: entries 为空', emptyZip.entries.length === 0, JSON.stringify(emptyZip.entries))
  const emptyBack = await importZipToVault(emptyOut, emptyZip.buffer)
  check('空库: 能被自己导回', emptyBack.written === 0 && emptyBack.skipped === 0 && emptyBack.entries.length === 0, JSON.stringify(emptyBack))

  // ── 2/8/9. 往返：中文文件名 + asset 二进制，逐字节一致 ────────────────────
  // 随机字节（不是全 0）：全 0 的数据任何压缩bug都能蒙对，随机的才真校验 CRC。
  const blob = randomBytes(4096)
  const chineseText = '# 中文标题笔记\n\n正文里带中文、标点「」，以及 emoji 🌰。\n'
  await makeVault(rootA, {
    '随手记/2026-11-13-中文标题笔记.md': chineseText,
    '随手记/2026-11-13-另一篇.md': '# 另一篇\n\n第二篇正文。\n',
    '做过的项目/2026-10-01-某个项目.md': '# 某个项目\n\n项目正文。\n',
    '随手记/asset/云端标题_1200000000000000001_audio.mp3': blob,
    '随手记/asset/云端标题_1200000000000000001_audio.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  })

  const exported = await exportVaultToZip(rootA)
  check('导出: 计数 5 个文件', exported.entries.length === 5, JSON.stringify(exported.entries.map((e) => e.path)))
  check('导出: bytes 与 buffer.length 一致', exported.bytes === exported.buffer.length, `${exported.bytes}`)
  check(
    '导出: 路径全是正斜杠相对路径',
    exported.entries.every((e) => !e.path.includes('\\') && !e.path.startsWith('/') && !e.path.includes('..')),
    JSON.stringify(exported.entries.map((e) => e.path)),
  )

  const back = await importZipToVault(rootB, exported.buffer)
  check('导入: 5 个文件全部写入', back.written === 5 && back.skipped === 0, JSON.stringify({ written: back.written, skipped: back.skipped, conflicts: back.conflicts }))

  const snapA = await snapshot(rootA)
  const snapB = await snapshot(rootB)
  check('往返: 文件集合一致', JSON.stringify(Object.keys(snapA).sort()) === JSON.stringify(Object.keys(snapB).sort()), JSON.stringify(Object.keys(snapB).sort()))
  check(
    '往返: 每个文件逐字节一致',
    Object.keys(snapA).every((k) => Buffer.compare(snapA[k], snapB[k]) === 0),
    `${Object.keys(snapA).length} 个文件`,
  )
  check(
    '往返: 中文文件名原样保留',
    Object.prototype.hasOwnProperty.call(snapB, '随手记/2026-11-13-中文标题笔记.md'),
    JSON.stringify(Object.keys(snapB).filter((k) => k.includes('中文'))),
  )
  check('往返: 中文正文原样（含 emoji）', (await readFile(join(rootB, '随手记/2026-11-13-中文标题笔记.md'), 'utf8')) === chineseText)
  const blobBack = await readFile(join(rootB, '随手记/asset/云端标题_1200000000000000001_audio.mp3'))
  check('二进制: 附件字节完全一致', Buffer.compare(blob, blobBack) === 0, `${blob.length} vs ${blobBack.length} bytes`)

  // zip 内部结构：UTF-8 标志位与 CRC 必须能被外部解压器认出来。
  // 这一条是防「读写双方一起错」的关键——Windows 资源管理器只看这里的字节。
  const zipText = exported.buffer.toString('latin1')
  const localFlag = exported.buffer.readUInt16LE(6)
  check('zip 结构: local header 带 UTF-8 标志位 0x0800', (localFlag & 0x0800) === 0x0800, `0x${localFlag.toString(16)}`)
  check('zip 结构: 结尾是 EOCD', exported.buffer.readUInt32LE(exported.buffer.length - 22) === 0x06054b50)
  check('zip 结构: 文件名以 UTF-8 字节出现', exported.buffer.includes(Buffer.from('2026-11-13-中文标题笔记.md', 'utf8')))
  check('zip 结构: 不含 GBK 式乱码（latin1 里不该有替换字符）', !zipText.includes('\ufffd'))
  check('CRC32: 与已知查表结果一致', crc32(Buffer.from('123456789', 'ascii')) === 0xcbf43926, `0x${crc32(Buffer.from('123456789', 'ascii')).toString(16)}`)
  check('CRC32: 空内容是 0', crc32(Buffer.alloc(0)) === 0)

  // ── 3. 导出会跳过 .trash / .conflicts / .history / .bak ───────────────────
  await makeVault(rootA, {
    '.trash/2026-11-13-删掉的.md': '# 删掉的\n',
    '.conflicts/2026-11-13-冲突副本.md': '# 冲突\n',
    '.history/2026-11-13-历史.md': '# 历史\n',
    '.git/config': '[core]\n',
    'node_modules/pkg/index.js': 'module.exports={}\n',
    '.obsidian/app.json': '{}\n',
    '随手记/2026-11-13-有备份.md': '# 正文\n',
    '随手记/2026-11-13-有备份.md.bak': '# 旧版本\n',
  })
  const skippedExport = await exportVaultToZip(rootA)
  const paths = skippedExport.entries.map((e) => e.path)
  check('导出: 跳过 .trash', !paths.some((p) => p.startsWith('.trash/')), JSON.stringify(paths.filter((p) => p.includes('trash'))))
  check('导出: 跳过 .conflicts', !paths.some((p) => p.startsWith('.conflicts/')), JSON.stringify(paths.filter((p) => p.includes('conflict'))))
  check('导出: 跳过 .history', !paths.some((p) => p.startsWith('.history/')), JSON.stringify(paths.filter((p) => p.includes('history'))))
  check('导出: 跳过 .git / node_modules / .obsidian', !paths.some((p) => /^(\.git|node_modules|\.obsidian)\//.test(p)), JSON.stringify(paths.filter((p) => /^(\.git|node_modules|\.obsidian)\//.test(p))))
  check('导出: 跳过 .bak', !paths.some((p) => p.endsWith('.bak')), JSON.stringify(paths.filter((p) => p.endsWith('.bak'))))
  check('导出: 但保留 .bak 旁边的正本', paths.some((p) => p === '随手记/2026-11-13-有备份.md'), JSON.stringify(paths.filter((p) => p.includes('有备份'))))

  // ── 4. 导入不覆盖同名文件，默认加 -2 ──────────────────────────────────────
  const dst4 = join(base, 'dst-4')
  const src4 = join(base, 'src-4')
  await makeVault(src4, { '随手记/2026-11-13-撞名.md': '# 归档里的版本\n' })
  const zip4 = await exportVaultToZip(src4)
  await makeVault(dst4, { '随手记/2026-11-13-撞名.md': '# 用户手上的版本\n' })

  const imp4 = await importZipToVault(dst4, zip4.buffer)
  check('导入: 撞名按 rename 处理', imp4.written === 1 && imp4.conflicts === 1, JSON.stringify(imp4.entries))
  check('导入: 落在 -2 后缀', imp4.entries[0].path === '随手记/2026-11-13-撞名-2.md', imp4.entries[0].path)
  check('导入: action 是 renamed', imp4.entries[0].action === 'renamed', imp4.entries[0].action)
  check('导入: 原文件未被覆盖', (await readFile(join(dst4, '随手记/2026-11-13-撞名.md'), 'utf8')).includes('用户手上的版本'))
  check('导入: 归档版本另存为 -2', (await readFile(join(dst4, '随手记/2026-11-13-撞名-2.md'), 'utf8')).includes('归档里的版本'))

  // 再导一次：-2 已被占，应该让到 -3
  const imp4b = await importZipToVault(dst4, zip4.buffer)
  check('导入: 连续撞名让到 -3', imp4b.entries[0].path === '随手记/2026-11-13-撞名-3.md', imp4b.entries[0].path)

  // ── 5. mode: 'skip' 计入 skipped 且原文件未变 ──────────────────────────────
  const dst5 = join(base, 'dst-5')
  await makeVault(dst5, { '随手记/2026-11-13-撞名.md': '# 用户手上的版本\n' })
  const imp5 = await importZipToVault(dst5, zip4.buffer, { mode: 'skip' })
  check('mode skip: 记入 skipped', imp5.skipped === 1 && imp5.written === 0, JSON.stringify({ written: imp5.written, skipped: imp5.skipped }))
  check('mode skip: 仍记入 conflicts', imp5.conflicts === 1, String(imp5.conflicts))
  check('mode skip: action 是 skipped', imp5.entries[0].action === 'skipped', imp5.entries[0].action)
  check('mode skip: 原文件一字未改', (await readFile(join(dst5, '随手记/2026-11-13-撞名.md'), 'utf8')) === '# 用户手上的版本\n')
  check('mode skip: 没有多出 -2 文件', !(await readdir(join(dst5, '随手记'))).some((n) => n.includes('-2')))

  // ── 6. 路径逃逸必须被跳过，且不写到库外 ───────────────────────────────────
  // 手工造一个恶意归档：名字里带 ../、绝对路径、Windows 盘符。
  const evilZip = buildZipBuffer([
    { path: '../evil.md', data: '# 逃逸\n' },
    { path: '../../evil2.md', data: '# 再逃逸\n' },
    { path: '/tmp/absolute.md', data: '# 绝对路径\n' },
    { path: 'C:/Windows/evil.md', data: '# 盘符\n' },
    { path: '随手记/正常.md', data: '# 正常\n' },
  ])
  const dst6 = join(base, 'dst-6')
  const imp6 = await importZipToVault(dst6, evilZip)
  check('逃逸: 四个恶意路径全部 skipped', imp6.skipped === 4, JSON.stringify(imp6.entries.map((e) => [e.path, e.action])))
  check('逃逸: 正常条目照常写入', imp6.written === 1 && (await readFile(join(dst6, '随手记/正常.md'), 'utf8')).includes('正常'))
  check('逃逸: 记了警告', imp6.warnings.length === 4, JSON.stringify(imp6.warnings))
  let escapedOut = false
  for (const candidate of [join(base, 'evil.md'), join(tmpdir(), 'evil2.md'), join(base, 'evil2.md')]) {
    try {
      await stat(candidate)
      escapedOut = true
    } catch {
      // 不存在才对
    }
  }
  check('逃逸: 库外没有写出任何文件', escapedOut === false, escapedOut ? '发现库外文件' : '库外干净')

  // Windows 上 `a:b.md` 会被当成「盘符相对路径」解析，safeEntryRel 拦不住，
  // 必须靠落地前的包含性校验补刀。
  const colonZip = buildZipBuffer([{ path: 'C:evil.md', data: '# 冒号\n' }])
  const dstColon = join(base, 'dst-colon')
  const impColon = await importZipToVault(dstColon, colonZip)
  check('逃逸: 盘符相对路径 C:evil.md 被挡', impColon.written === 0 && impColon.skipped === 1, JSON.stringify(impColon.entries))

  // ── 7. 损坏的 zip 必须抛错 ────────────────────────────────────────────────
  let truncErr = null
  try {
    await importZipToVault(join(base, 'dst-7a'), zip4.buffer.subarray(0, zip4.buffer.length - 30))
  } catch (err) {
    truncErr = err
  }
  check('损坏: 截断（丢 EOCD）抛错', truncErr !== null, truncErr ? truncErr.message : '没有抛错')
  check('损坏: 截断的错误带 status 400', truncErr && truncErr.status === 400, String(truncErr && truncErr.status))

  let tinyErr = null
  try {
    await importZipToVault(join(base, 'dst-7b'), Buffer.from('not a zip at all'))
  } catch (err) {
    tinyErr = err
  }
  check('损坏: 根本不是 zip 抛错', tinyErr !== null, tinyErr ? tinyErr.message : '没有抛错')

  // 破坏 CRC：用 store 方式打包，数据是原文，改一个字节后 CRC 必然对不上。
  const plainZip = buildZipBuffer([{ path: 'a.md', data: Buffer.from('# 原文内容\n', 'utf8'), method: 'store' }])
  const broken = Buffer.from(plainZip)
  // local header 30 + 名字 4 = 34 是数据起点，翻掉一个字符
  broken[34] = 0x21
  let crcErr = null
  try {
    await importZipToVault(join(base, 'dst-7c'), broken)
  } catch (err) {
    crcErr = err
  }
  check('损坏: CRC 不符抛错', crcErr !== null, crcErr ? crcErr.message : '没有抛错')
  check('损坏: CRC 错误信息带「校验失败」', crcErr && /校验失败/.test(crcErr.message), crcErr && crcErr.message)
  check('损坏: CRC 错误带 status 400', crcErr && crcErr.status === 400, String(crcErr && crcErr.status))

  // ── 10. 同 note_id 的 md 也算冲突 ────────────────────────────────────────
  // 文件名完全不同，但 frontmatter 的 note_id 是同一篇——这是真实场景：
  // 用户改过标题、云端的标题和本地标题本来就不一样。
  const src10 = join(base, 'src-10')
  const dst10 = join(base, 'dst-10')
  await makeVault(src10, {
    '随手记/2026-11-13-云端标题.md': '---\nnote_id: "1200000000000000001"\n---\n\n# 云端标题\n\n归档版本。\n',
  })
  const zip10 = await exportVaultToZip(src10)
  await makeVault(dst10, {
    '随手记/2026-11-13-我改过的标题.md': '---\nnote_id: "1200000000000000001"\n---\n\n# 我改过的标题\n\n本地版本。\n',
  })
  const imp10 = await importZipToVault(dst10, zip10.buffer)
  check('note_id: 同 id 不同名算冲突', imp10.conflicts === 1, JSON.stringify(imp10.entries))
  check('note_id: 默认改名而不覆盖', imp10.entries[0].action === 'renamed' && imp10.entries[0].path.includes('-2'), imp10.entries[0].path)
  check('note_id: 本地版本完好', (await readFile(join(dst10, '随手记/2026-11-13-我改过的标题.md'), 'utf8')).includes('本地版本'))
  const imp10b = await importZipToVault(dst10, zip10.buffer, { mode: 'skip' })
  check('note_id: mode skip 时同 id 也跳过', imp10b.skipped === 1 && imp10b.written === 0, JSON.stringify({ written: imp10b.written, skipped: imp10b.skipped }))

  // ── 附加：非 .md / 非 asset 附件的条目要被挡掉 ─────────────────────────────
  const mixedZip = buildZipBuffer([
    { path: '随手记/正常.md', data: '# 正常\n' },
    { path: '随手记/asset/录音.mp3', data: Buffer.from([1, 2, 3]) },
    { path: '随手记/asset/截图.png', data: Buffer.from([9, 9, 9]) },
    { path: '随手记/asset/木马.exe', data: Buffer.from([4, 4]) },
    { path: '随手记/asset/脚本.js', data: Buffer.from('alert(1)') },
    { path: '随手记/不在asset/的.txt', data: 'x' },
  ])
  const dstMixed = join(base, 'dst-mixed')
  const impMixed = await importZipToVault(dstMixed, mixedZip)
  check('白名单: .md 与 asset 附件写入', impMixed.written === 3, JSON.stringify(impMixed.entries.map((e) => [e.path, e.action])))
  check('白名单: .exe / .js / 非资产目录的 .txt 被跳过', impMixed.skipped === 3, JSON.stringify(impMixed.entries.filter((e) => e.action === 'skipped').map((e) => e.path)))

  // ── 附加：导出侧的大小上限 ───────────────────────────────────────────────
  const srcBig = join(base, 'src-big')
  await makeVault(srcBig, {
    '小.md': '# 小\n',
    '大.bin': randomBytes(2048),
  })
  const limited = await exportVaultToZip(srcBig, { maxFileBytes: 1000 })
  check('上限: 超 maxFileBytes 的单文件被跳过', !limited.entries.some((e) => e.path === '大.bin') && limited.entries.some((e) => e.path === '小.md'), JSON.stringify(limited.entries.map((e) => e.path)))

  let totalErr = null
  try {
    await exportVaultToZip(srcBig, { maxTotalBytes: 100 })
  } catch (err) {
    totalErr = err
  }
  check('上限: 超 maxTotalBytes 抛 413', totalErr !== null && totalErr.status === 413, totalErr ? `${totalErr.status} ${totalErr.message}` : '没有抛错')
  check('上限: 413 文案提示分批导出', totalErr !== null && /分批导出/.test(totalErr.message), totalErr && totalErr.message)

  // ── 附加：不存在的库根导入会自动建目录 ────────────────────────────────────
  const freshRoot = join(base, 'fresh-root', 'nested')
  const impFresh = await importZipToVault(freshRoot, zip4.buffer)
  check('新建: 库根不存在时自动 mkdir -p', impFresh.written === 1 && (await stat(join(freshRoot, '随手记/2026-11-13-撞名.md'))).isFile())
} finally {
  await rm(base, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
