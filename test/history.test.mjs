/**
 * 版本历史验收：不碰网络，只在临时库里跑 history.js 这一层。
 * 用临时目录，不污染用户真实库。
 */
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HISTORY_DIR,
  HISTORY_LIMIT,
  historyKeyFor,
  snapshotNote,
  listHistory,
  readHistoryEntry,
  restoreHistoryEntry,
  pruneHistory,
} from '../src/core/history.js'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const root = await mkdtemp(join(tmpdir(), 'gn-hist-'))
try {
  // ── historyKeyFor：目录名映射 ───────────────────────────────────────────────
  check(
    'historyKeyFor: 斜杠换成 __ 且保留中文',
    historyKeyFor('随手记/2026-11-13-我的笔记.md') === '随手记__2026-11-13-我的笔记.md',
    historyKeyFor('随手记/2026-11-13-我的笔记.md'),
  )
  const dirtyKey = historyKeyFor('随手记/a:b*c?d"e<f>g|h.md')
  check('historyKeyFor: 去掉 Windows 非法字符', !/[<>:"\\|?*]/.test(dirtyKey), dirtyKey)
  check('historyKeyFor: 去掉非法字符后仍可读', dirtyKey.startsWith('随手记__abcdefgh.md'), dirtyKey)
  check(
    'historyKeyFor: 反斜杠也当分隔符',
    historyKeyFor('随手记\\2026-11-13-示例.md') === '随手记__2026-11-13-示例.md',
    historyKeyFor('随手记\\2026-11-13-示例.md'),
  )
  const longKey = historyKeyFor(`随手记/${'很长的标题'.repeat(40)}.md`)
  check('historyKeyFor: 超长截断到 120', Array.from(longKey).length <= 120, `${Array.from(longKey).length}`)
  check('historyKeyFor: 超长时尾部换成哈希', /^随手记__/.test(longKey) && /-[0-9a-f]{16}$/.test(longKey), longKey)
  check(
    'historyKeyFor: 前缀相同的两篇长标题不撞 key',
    historyKeyFor(`随手记/${'同前缀标题'.repeat(40)}甲.md`) !== historyKeyFor(`随手记/${'同前缀标题'.repeat(40)}乙.md`),
  )

  // ── 快照与列表 ──────────────────────────────────────────────────────────────
  const rel = '随手记/2026-11-13-我的笔记.md'
  const abs = join(root, '随手记', '2026-11-13-我的笔记.md')
  await mkdir(join(root, '随手记'), { recursive: true })
  await writeFile(abs, '# 我的笔记\n\n第一版正文。\n', 'utf8')

  const missing = await snapshotNote(root, '随手记/不存在的笔记.md')
  check('snapshotNote: 文件不存在返回 missing', missing.saved === false && missing.reason === 'missing', JSON.stringify(missing))

  const snap1 = await snapshotNote(root, rel, { now: Date.parse('2026-11-13T02:03:04.005Z') })
  check('snapshotNote: 保存成功并返回字节数', snap1.saved === true && snap1.bytes > 0, JSON.stringify(snap1))
  const snapAbs = join(root, snap1.path)
  const snapText = await readFile(snapAbs, 'utf8')
  check('snapshotNote: 落在 .history/<key>/ 下', snap1.path.startsWith(`${HISTORY_DIR}/${historyKeyFor(rel)}/`), snap1.path)
  check('snapshotNote: 内容与原文件一致', snapText === '# 我的笔记\n\n第一版正文。\n', JSON.stringify(snapText.slice(0, 20)))
  check(
    'snapshotNote: 文件名用 YYYY-MM-DDTHH-mm-ss-SSSZ（无冒号）',
    /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/.test(snap1.path.split('/').pop()),
    snap1.path.split('/').pop(),
  )
  check('snapshotNote: now 参数决定时间戳', snap1.path.endsWith('2026-11-13T02-03-04-005Z.md'), snap1.path.split('/').pop())

  // 同一毫秒重复调用：文件名会撞，必须加 -2 / -3 而不是覆盖上一版
  const dupA = await snapshotNote(root, rel, { now: Date.parse('2026-11-13T05:06:07.008Z') })
  const dupB = await snapshotNote(root, rel, { now: Date.parse('2026-11-13T05:06:07.008Z') })
  const dupC = await snapshotNote(root, rel, { now: Date.parse('2026-11-13T05:06:07.008Z') })
  check('snapshotNote: 同毫秒不覆盖（-2 后缀）', dupB.path.endsWith('-2.md') && dupC.path.endsWith('-3.md'), `${dupA.path.split('/').pop()} / ${dupB.path.split('/').pop()} / ${dupC.path.split('/').pop()}`)
  const dupNames = (await listHistory(root, rel, { limit: 50 })).map((h) => h.name)
  check(
    'snapshotNote: 同毫秒三版都还在',
    dupNames.includes('2026-11-13T05-06-07-008Z.md') &&
      dupNames.includes('2026-11-13T05-06-07-008Z-2.md') &&
      dupNames.includes('2026-11-13T05-06-07-008Z-3.md'),
    JSON.stringify(dupNames),
  )

  // ── listHistory 倒序 ────────────────────────────────────────────────────────
  const listed = await listHistory(root, rel, { limit: 50 })
  check('listHistory: 返回字段齐全', listed.every((h) => typeof h.name === 'string' && typeof h.path === 'string' && typeof h.bytes === 'number' && typeof h.mtimeMs === 'number' && typeof h.savedAt === 'string'))
  check('listHistory: 倒序（第一个最新）', listed[0].name.startsWith('2026-11-13T05-06-07-008Z'), JSON.stringify(listed.map((h) => h.name)))
  check(
    'listHistory: savedAt 从文件名解析成 ISO',
    listed.some((h) => h.savedAt === '2026-11-13T02:03:04.005Z'),
    JSON.stringify(listed.map((h) => h.savedAt)),
  )
  const limited = await listHistory(root, rel, { limit: 2 })
  check('listHistory: limit 生效', limited.length === 2, String(limited.length))
  const emptyDir = await listHistory(root, '随手记/从没快照过的笔记.md')
  check('listHistory: 没有目录返回空数组', Array.isArray(emptyDir) && emptyDir.length === 0, JSON.stringify(emptyDir))

  // ── readHistoryEntry ───────────────────────────────────────────────────────
  const readBack = await readHistoryEntry(root, rel, '2026-11-13T02-03-04-005Z.md')
  check('readHistoryEntry: 内容与写时一致', readBack.content === '# 我的笔记\n\n第一版正文。\n', JSON.stringify(readBack.content.slice(0, 12)))
  check('readHistoryEntry: 带上 savedAt 与字节数', readBack.savedAt === '2026-11-13T02:03:04.005Z' && readBack.bytes > 0, JSON.stringify({ savedAt: readBack.savedAt, bytes: readBack.bytes }))

  let rejectedSlash = false
  try {
    await readHistoryEntry(root, rel, 'a/b.md')
  } catch (error) {
    rejectedSlash = true
    check('readHistoryEntry: 拒绝含 / 的 name（400）', error && error.status === 400, JSON.stringify({ status: error && error.status }))
  }
  if (!rejectedSlash) check('readHistoryEntry: 拒绝含 / 的 name（400）', false)

  let rejectedDotdot = false
  try {
    await readHistoryEntry(root, rel, '../../随手记/2026-11-13-我的笔记.md')
  } catch (error) {
    rejectedDotdot = true
    check('readHistoryEntry: 拒绝 ../ 逃逸（400）', error && error.status === 400, JSON.stringify({ status: error && error.status }))
  }
  if (!rejectedDotdot) check('readHistoryEntry: 拒绝 ../ 逃逸（400）', false)

  let rejectedBackslash = false
  try {
    await readHistoryEntry(root, rel, '..\\x.md')
  } catch (error) {
    rejectedBackslash = true
    check('readHistoryEntry: 拒绝含 \\ 的 name（400）', error && error.status === 400, JSON.stringify({ status: error && error.status }))
  }
  if (!rejectedBackslash) check('readHistoryEntry: 拒绝含 \\ 的 name（400）', false)

  let missingEntry = null
  try {
    await readHistoryEntry(root, rel, '2026-01-01T00-00-00-000Z.md')
  } catch (error) {
    missingEntry = error
  }
  check(
    'readHistoryEntry: 不存在的版本抛 404 中文提示',
    missingEntry !== null && missingEntry.status === 404 && missingEntry.message === '这一版快照不在了',
    JSON.stringify({ status: missingEntry && missingEntry.status, message: missingEntry && missingEntry.message }),
  )

  // ── 保留最近 N 版 ──────────────────────────────────────────────────────────
  const rotRel = '随手记/2026-11-14-轮换测试.md'
  const rotAbs = join(root, '随手记', '2026-11-14-轮换测试.md')
  await mkdir(join(root, '随手记'), { recursive: true })
  const base = Date.parse('2026-11-14T00:00:00.000Z')
  const savedNames = []
  for (let i = 0; i < 13; i += 1) {
    await writeFile(rotAbs, `# 轮换测试\n\n第 ${i + 1} 版。\n`, 'utf8')
    const out = await snapshotNote(root, rotRel, { now: base + i * 1000 })
    savedNames.push(out.path.split('/').pop())
  }
  const rotList = await listHistory(root, rotRel, { limit: 50 })
  check('保留 N 版: 13 次快照只留 10 版', rotList.length === HISTORY_LIMIT && HISTORY_LIMIT === 10, `${rotList.length}`)
  const rotNames = rotList.map((h) => h.name)
  check('保留 N 版: 最旧的 3 个被删掉', savedNames.slice(0, 3).every((n) => !rotNames.includes(n)), JSON.stringify(savedNames.slice(0, 3)))
  check('保留 N 版: 最新的 3 个还在', savedNames.slice(-3).every((n) => rotNames.includes(n)), JSON.stringify(savedNames.slice(-3)))
  check('保留 N 版: 最新版排第一', rotNames[0] === savedNames[savedNames.length - 1], `${rotNames[0]} vs ${savedNames[savedNames.length - 1]}`)

  // ── 恢复 ───────────────────────────────────────────────────────────────────
  const resRel = '做过的项目/2026-11-15-恢复测试.md'
  const resAbs = join(root, '做过的项目', '2026-11-15-恢复测试.md')
  await mkdir(join(root, '做过的项目'), { recursive: true })
  await writeFile(resAbs, '# 恢复测试\n\n旧版本内容 A。\n', 'utf8')
  const oldSnap = await snapshotNote(root, resRel, { now: Date.parse('2026-11-15T01:00:00.000Z') })
  const oldName = oldSnap.path.split('/').pop()
  // 覆盖成新内容——这一版才是「点恢复时正在被丢掉的正文」
  await writeFile(resAbs, '# 恢复测试\n\n新版本内容 B。\n', 'utf8')

  const beforeRestore = (await listHistory(root, resRel, { limit: 100 })).map((h) => h.name)
  const restored = await restoreHistoryEntry(root, resRel, oldName)
  check('restoreHistoryEntry: 返回恢复信息', restored.restored === true && restored.from === oldName && restored.path === resRel, JSON.stringify(restored))
  const afterText = await readFile(resAbs, 'utf8')
  check('restoreHistoryEntry: 正本变成快照里的内容', afterText === '# 恢复测试\n\n旧版本内容 A。\n', JSON.stringify(afterText))

  const afterRestoreList = await listHistory(root, resRel, { limit: 100 })
  check('restoreHistoryEntry: 恢复前的正本被存了一版（长度 +1）', afterRestoreList.length === beforeRestore.length + 1, `${beforeRestore.length} -> ${afterRestoreList.length}`)
  const keptCurrent = await Promise.all(
    afterRestoreList
      .filter((h) => !beforeRestore.includes(h.name))
      .map((h) => readHistoryEntry(root, resRel, h.name)),
  )
  check(
    'restoreHistoryEntry: 被存下来的正是恢复前那份 B 版正文',
    keptCurrent.length === 1 && keptCurrent[0].content === '# 恢复测试\n\n新版本内容 B。\n',
    JSON.stringify(keptCurrent.map((h) => h.content.slice(-8))),
  )
  check('restoreHistoryEntry: 恢复不删任何快照', beforeRestore.every((n) => afterRestoreList.some((h) => h.name === n)), JSON.stringify(afterRestoreList.map((h) => h.name)))
  check('restoreHistoryEntry: 恢复前正本仍在', (await listHistory(root, resRel, { limit: 100 })).some((h) => h.name === oldName))

  // keepCurrent:false 时不额外存版（调用方明确知道自己不要撤销点）
  const noKeep = await restoreHistoryEntry(root, resRel, oldName, { keepCurrent: false })
  const noKeepList = await listHistory(root, resRel, { limit: 100 })
  check('restoreHistoryEntry: keepCurrent:false 不再存新快照', noKeep.hadSnapshot === false && noKeepList.length === afterRestoreList.length, JSON.stringify({ hadSnapshot: noKeep.hadSnapshot, len: noKeepList.length }))

  // 正本被整车删掉（整个目录没了）时，恢复也要能把目录建回来——否则「恢复」按钮
  // 在最需要它的时候反而报 ENOENT。
  const goneRel = '临时目录/2026-11-15-目录也丢了.md'
  const goneAbs = join(root, '临时目录', '2026-11-15-目录也丢了.md')
  await mkdir(join(root, '临时目录'), { recursive: true })
  await writeFile(goneAbs, '# 目录也丢了\n\n这段得救回来。\n', 'utf8')
  const goneSnap = await snapshotNote(root, goneRel, { now: Date.parse('2026-11-15T02:00:00.000Z') })
  await rm(join(root, '临时目录'), { recursive: true, force: true })
  await restoreHistoryEntry(root, goneRel, goneSnap.path.split('/').pop())
  const goneText = await readFile(goneAbs, 'utf8')
  check('restoreHistoryEntry: 正本目录不存在时 mkdir -p 后恢复', goneText === '# 目录也丢了\n\n这段得救回来。\n', JSON.stringify(goneText))

  // ── 体积上限 ───────────────────────────────────────────────────────────────
  const bigRel = '随手记/2026-11-16-超大文件.md'
  await writeFile(join(root, '随手记', '2026-11-16-超大文件.md'), Buffer.alloc(2 * 1024 * 1024 + 1, 0x61))
  const big = await snapshotNote(root, bigRel)
  check('snapshotNote: 超过 2MB 返回 too-large', big.saved === false && big.reason === 'too-large', JSON.stringify(big))
  const bigList = await listHistory(root, bigRel)
  check('snapshotNote: too-large 时没留下快照', bigList.length === 0, String(bigList.length))

  // ── pruneHistory 全库清理 ──────────────────────────────────────────────────
  // 轮换测试那篇因为 limit 已经在写入时被裁过；这里再造一个「历史遗留」的超限目录。
  const histKey = historyKeyFor(rotRel)
  const histDir = join(root, HISTORY_DIR, histKey)
  for (let i = 0; i < 6; i += 1) {
    await writeFile(join(histDir, `2026-01-0${i + 1}T00-00-00-000Z.md`), `# 遗留旧版 ${i + 1}\n`, 'utf8')
  }
  const beforePrune = (await readdir(histDir)).filter((n) => n.endsWith('.md')).length
  check('pruneHistory: 先制造出超限目录', beforePrune > HISTORY_LIMIT, String(beforePrune))
  const pruned = await pruneHistory(root)
  const afterPrune = (await readdir(histDir)).filter((n) => n.endsWith('.md')).length
  check('pruneHistory: 返回计数', typeof pruned.pruned === 'number' && typeof pruned.kept === 'number' && pruned.pruned > 0, JSON.stringify(pruned))
  check('pruneHistory: 超限目录被裁到 10 版', afterPrune === HISTORY_LIMIT && pruned.kept >= afterPrune, `after=${afterPrune} kept=${pruned.kept}`)
  const prunedAgain = await pruneHistory(root)
  check('pruneHistory: 再跑一次无事可做', prunedAgain.pruned === 0, JSON.stringify(prunedAgain))
  const prunedEmpty = await pruneHistory(join(root, '不存在的库'))
  check('pruneHistory: 没有 .history 时返回 0', prunedEmpty.pruned === 0 && prunedEmpty.kept === 0, JSON.stringify(prunedEmpty))
  const meta = await stat(join(root, HISTORY_DIR))
  check('pruneHistory: 不动 .history 以外的目录', meta.isDirectory())
} finally {
  await rm(root, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
