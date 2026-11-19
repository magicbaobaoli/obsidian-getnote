/**
 * 离线性验收：不碰网络，只把本地库这一层（vault/settings）跑通。
 * 用临时目录，不污染用户真实库。
 */
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  scanVault,
  buildTree,
  readNote,
  writeNote,
  createNote,
  trashNote,
  searchNotes,
  parseFrontmatter,
  vaultStats,
  listDirs,
  listAssets,
  listTrash,
  restoreNote,
  purgeTrash,
  parseTrashName,
  removeTag,
  readTags,
  rewriteTags,
  normalizeTags,
  normalizeAliases,
  findBacklinks,
  findBrokenLinks,
  renameTag,
  heatmapOf,
  toggleTodo,
  conflictArchiveName,
  listConflicts,
  readConflict,
  resolveConflict,
  unresolveConflict,
} from '../src/core/vault.js'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const root = await mkdtemp(join(tmpdir(), 'dshgn-test-'))
try {
  // 1. frontmatter 解析（用户已有归档库的真实形状）
  const sample = `---
tags: [得到大脑, 录音卡, 私密]
note_id: "1200000000000000001"
note_url: https://www.biji.com/note/1200000000000000001
知识库: 随手记
归档: 2026-11-13
---

# 示例录音笔记

正文第一段。
`
  const fm = parseFrontmatter(sample)
  check('frontmatter: tags 数组', JSON.stringify(fm.data.tags) === JSON.stringify(['得到大脑', '录音卡', '私密']), JSON.stringify(fm.data.tags))
  check('frontmatter: note_id 引号剥除', fm.data.note_id === '1200000000000000001', String(fm.data.note_id))
  check('frontmatter: 中文键', fm.data['知识库'] === '随手记', String(fm.data['知识库']))
  check('frontmatter: 正文剥离', fm.body.trim().startsWith('# 示例录音笔记'), JSON.stringify(fm.body.slice(0, 20)))

  // 2. 写入 + 扫描
  await mkdir(join(root, '随手记'), { recursive: true })
  await writeFile(join(root, '随手记', '2026-11-13-示例录音笔记.md'), sample, 'utf8')
  await mkdir(join(root, '做过的项目'), { recursive: true })
  await writeFile(join(root, '做过的项目', '2026-10-01-某个项目.md'), '# 某个项目\n\n项目正文，含关键词 kumquat。\n', 'utf8')

  const scan = await scanVault(root)
  check('scanVault: 找到 2 篇', scan.entries.length === 2, `${scan.entries.length}`)
  const entry = scan.entries.find((e) => e.path.includes('示例录音笔记'))
  check('scanVault: 标题来自 # 标题', entry && entry.title === '示例录音笔记', entry && entry.title)
  check('scanVault: 日期来自文件名', entry && entry.date === '2026-11-13', entry && entry.date)
  check('scanVault: noteId 提取', entry && entry.noteId === '1200000000000000001', entry && entry.noteId)
  check('scanVault: tags', entry && entry.tags.length === 3, entry && JSON.stringify(entry.tags))

  // 3. 树
  const tree = buildTree(scan.entries)
  check('buildTree: 2 个顶层目录', tree.children.filter((c) => c.kind === 'dir').length === 2, String(tree.children.length))
  check('buildTree: 计数', tree.count === 2, String(tree.count))

  // 4. 读
  const note = await readNote(root, '随手记/2026-11-13-示例录音笔记.md')
  check('readNote: 内容完整', note.content.includes('# 示例录音笔记'), `${note.bytes} bytes`)
  check('readNote: frontmatter 附加', note.frontmatter['归档'] === '2026-11-13', String(note.frontmatter['归档']))

  // 5. 路径逃逸必须被拒
  let escaped = false
  try {
    await readNote(root, '../../etc/passwd')
  } catch {
    escaped = true
  }
  check('readNote: 拒绝 ../ 逃逸', escaped)

  // 6. 写（保留 .bak）
  await writeNote(root, '随手记/2026-11-13-示例录音笔记.md', sample.replace('正文第一段。', '改过的正文。'))
  const bak = await readFile(join(root, '随手记', '2026-11-13-示例录音笔记.md.bak'), 'utf8')
  check('writeNote: 留 .bak', bak.includes('正文第一段。'), `${bak.length} chars`)
  const after = await readNote(root, '随手记/2026-11-13-示例录音笔记.md')
  check('writeNote: 新内容生效', after.content.includes('改过的正文。'))

  // 7. 新建：同名不覆盖
  const created1 = await createNote(root, { dir: '做过的项目', title: '同名测试', content: '# 一\n' })
  const created2 = await createNote(root, { dir: '做过的项目', title: '同名测试', content: '# 二\n' })
  check('createNote: 首篇命名带日期', /^\d{4}-\d{2}-\d{2}-同名测试\.md$/.test(created1.path.split('/').pop()), created1.path)
  check('createNote: 冲突追加 -2', created2.path.includes('-2.md'), created2.path)
  const one = await readNote(root, created1.path)
  check('createNote: 原文件未被覆盖', one.content.includes('# 一'))

  // 8. 回收站
  const trashed = await trashNote(root, created2.path)
  check('trashNote: 进 .trash', trashed.trashedTo.startsWith('.trash/'), trashed.trashedTo)
  const scan2 = await scanVault(root)
  check('trashNote: 扫描不再计入', !scan2.entries.some((e) => e.path === created2.path))

  // 9. 搜索
  const found = await searchNotes(root, 'kumquat')
  check('searchNotes: 命中正文', found.hits.length === 1 && found.hits[0].matches.length === 1, JSON.stringify(found.hits.map((x) => x.path)))
  const foundTitle = await searchNotes(root, '同名')
  check('searchNotes: 命中标题', foundTitle.hits.some((x) => x.titleHit === true))
  // 搜索结果要带上「这一篇引用了谁」：只给命中次数的话，用户还得点进去才知道
  // 它讲的是哪几篇。正文本来就已经读进来了，顺手抽一下不额外读盘。
  await writeFile(
    join(root, '随手记', '搜索出链.md'),
    ['# 搜索出链', '', '菠萝蜜 记到 [[甲篇]] 与 [[乙篇|别名]]', ''].join('\n'),
    'utf8',
  )
  const foundLinks = await searchNotes(root, '菠萝蜜')
  const linkHit = foundLinks.hits.find((h) => h.path === '随手记/搜索出链.md')
  check(
    'searchNotes: 命中项带上它引用了谁',
    linkHit !== undefined && Array.isArray(linkHit.links) && linkHit.links.length === 2,
    JSON.stringify(linkHit && linkHit.links),
  )
  check(
    'searchNotes: 别名写法只留目标',
    linkHit !== undefined && linkHit.links.indexOf('乙篇') >= 0 && linkHit.links.indexOf('甲篇') >= 0,
    JSON.stringify(linkHit && linkHit.links),
  )
  check(
    'searchNotes: 没有双链的笔记给空数组',
    found.hits.every((h) => Array.isArray(h.links)),
    JSON.stringify(found.hits.map((h) => h.links)),
  )

  // 10. 统计与目录
  const stats = await vaultStats(root, scan2.entries)
  check('vaultStats: 计数/体积', stats.notes === scan2.entries.length && stats.bytes > 0, JSON.stringify(stats))
  const dirs = listDirs(scan2.entries)
  check('listDirs: 含根与两个目录', dirs.includes('') && dirs.includes('随手记') && dirs.includes('做过的项目'), JSON.stringify(dirs))

  // 11. 中文与非法字符文件名
  const weird = await createNote(root, { dir: '', title: 'a/b:c*d?e"f<g>h|i', content: 'x' })
  check('createNote: 清洗非法字符', !/[\\/:*?"<>|]/.test(weird.path), weird.path)

  // 12. 附件归属：录音 mp3 / 转写 md 要能被对应的笔记认领。
  //     真实库里的命名是 Obsidian 端插件留下的「<云端标题>_<note_id>_audio.mp3」，
  //     而本地文件名是「YYYY-MM-DD-<本地标题>」，两边标题实测并不相同，所以
  //     只靠文件名主干是认不出来的，必须靠 note_id。
  const assetDir = join(root, '随手记', 'asset')
  await mkdir(assetDir, { recursive: true })
  await writeFile(join(assetDir, '云端标题_1200000000000000001_audio.mp3'), Buffer.alloc(64, 1))
  await writeFile(join(assetDir, '云端标题_1200000000000000001_transcript.md'), '# 转写\n', 'utf8')
  await writeFile(join(assetDir, '别的笔记_9999999999999999999_audio.mp3'), Buffer.alloc(8, 2))
  await writeFile(join(assetDir, '云端标题_1200000000000000001_audio.mp3.bak'), Buffer.alloc(8, 3))

  const assetsById = await listAssets(root, '随手记/2026-11-13-本地标题.md', '1200000000000000001')
  check('listAssets: 靠 note_id 认领附件', assetsById.length === 2, JSON.stringify(assetsById.map((a) => a.name)))
  check(
    'listAssets: 分出 audio / transcript',
    assetsById.some((a) => a.kind === 'audio') && assetsById.some((a) => a.kind === 'transcript'),
    JSON.stringify(assetsById.map((a) => a.kind)),
  )
  check('listAssets: 跳过 .bak', !assetsById.some((a) => a.name.endsWith('.bak')), JSON.stringify(assetsById.map((a) => a.name)))
  check('listAssets: 不认领别人的附件', !assetsById.some((a) => a.name.includes('9999999999999999999')), JSON.stringify(assetsById.map((a) => a.name)))

  const assetsByStem = await listAssets(root, '随手记/2026-11-13-云端标题.md', '')
  check('listAssets: 没有 note_id 时靠去日期前缀的主干认领', assetsByStem.length === 2, JSON.stringify(assetsByStem.map((a) => a.name)))

  const noAssets = await listAssets(root, '随手记/2026-11-13-毫无关系的笔记.md', '')
  check('listAssets: 没附件时返回空数组而不是抛错', Array.isArray(noAssets) && noAssets.length === 0, JSON.stringify(noAssets))

  const noDir = await listAssets(root, '做过的项目/2026-11-13-没有 asset 目录.md', '')
  check('listAssets: 没有 asset 目录时返回空数组', Array.isArray(noDir) && noDir.length === 0, JSON.stringify(noDir))

  // ── 冲突留档的命名与认回正本 ──────────────────────────────────────────────
  // 老名字只按文件名去重：`随手记/甲.md` 与 `做过的项目/甲.md` 同一毫秒撞车时，
  // 后写的会把先写的覆盖掉，两份内容只剩一份。新名字里带原路径的短哈希。
  const nameA = conflictArchiveName('随手记/甲.md', { at: '2026-11-15T10:00:00.000Z' })
  const nameB = conflictArchiveName('做过的项目/甲.md', { at: '2026-11-15T10:00:00.000Z' })
  check('冲突命名: 形如 .conflicts/<时间戳>__<哈希>__<原名>', /^\.conflicts\/2026-11-15T10-00-00-000Z__[0-9a-f]{6}__甲\.md$/.test(nameA), nameA)
  check('冲突命名: 同名不同目录落点不同', nameA !== nameB, `${nameA} vs ${nameB}`)
  check('冲突命名: 反斜杠路径也认', conflictArchiveName('随手记\\甲.md', { at: '2026-11-15T10:00:00.000Z' }) === nameA)
  check(
    '冲突命名: cloud 前缀在哈希之后',
    /^[^]*__[0-9a-f]{6}__cloud-甲\.md$/.test(conflictArchiveName('随手记/甲.md', { cloud: true })),
    conflictArchiveName('随手记/甲.md', { cloud: true }),
  )
  check('冲突命名: 认不出时间就用当前时刻', /^[^]*__[0-9a-f]{6}__甲\.md$/.test(conflictArchiveName('随手记/甲.md', { at: '不是时间' })))

  // 两篇同名笔记都进了留档，各自都要认回自己那篇正本
  await createNote(root, { dir: '随手记', title: '撞名正本', content: '# 撞名正本\n\n随手记里的\n' })
  await createNote(root, { dir: '做过的项目', title: '撞名正本', content: '# 撞名正本\n\n项目里的\n' })
  const allEntries = (await scanVault(root)).entries.filter((e) => e.title === '撞名正本')
  check('冲突认回: 造出两篇同名正本', allEntries.length === 2, JSON.stringify(allEntries.map((e) => e.path)))
  for (const entry of allEntries) {
    const rel = conflictArchiveName(entry.path)
    await mkdir(join(root, '.conflicts'), { recursive: true })
    await writeFile(join(root, rel), `# 留档\n\n来自 ${entry.path}\n`, 'utf8')
    const detail = await readConflict(root, rel)
    check(
      `冲突认回: 认回 ${entry.path}`,
      detail.candidates.length === 1 && detail.candidates[0].path === entry.path,
      JSON.stringify(detail.candidates.map((c) => c.path)),
    )
  }
  const listed = await listConflicts(root)
  check('冲突列表: 两份都在，各带哈希', listed.length === 2 && listed.every((i) => /^[0-9a-f]{6}$/.test(i.pathHash)), JSON.stringify(listed.map((i) => [i.name, i.pathHash])))

  // 老格式（没有哈希）仍要能读、能认回
  // 老名字里带的是正本当时的完整文件名（createNote 会加日期前缀），不是标题
  const legacyName = allEntries[0].path.split('/').pop()
  const legacyRel = `${'.conflicts'}/2026-11-15T10-00-00-000Z__${legacyName}`
  await writeFile(join(root, legacyRel), '# 老留档\n', 'utf8')
  const legacyDetail = await readConflict(root, legacyRel)
  check('冲突认回: 老格式没有哈希也能读', legacyDetail.pathHash === '' && legacyDetail.originalName === legacyName, JSON.stringify({ hash: legacyDetail.pathHash, name: legacyDetail.originalName }))
  check('冲突认回: 老格式退回按文件名找正本', legacyDetail.candidates.length === 2, JSON.stringify(legacyDetail.candidates.map((c) => c.path)))

  // 采纳一份之后能退回未处理
  const firstConflict = listed[0]
  const resolved = await resolveConflict(root, firstConflict.path, { keepLocal: true })
  check('冲突处理: 采纳本地版写回正本', typeof resolved.path === 'string' && resolved.keepLocal === true, JSON.stringify(resolved))
  check('冲突处理: 处理完标为已处理', (await listConflicts(root)).find((i) => i.path === firstConflict.path).resolved === true)
  await unresolveConflict(root, firstConflict.path)
  check('冲突处理: 能退回未处理', (await listConflicts(root)).find((i) => i.path === firstConflict.path).resolved === false)

  // ── 回收站 ────────────────────────────────────────────────────────────────
  // 以前删除只进不出：面板上没有任何入口能看见 .trash、更没法恢复。下面这组
  // 断言盯的就是「删错了还能救回来」这条底线。
  const trashParsed = parseTrashName('2026-11-15T03-04-05-678Z__随手记·旧笔记.md')
  check('parseTrashName: 拆出原名', trashParsed !== null && trashParsed.originalName === '随手记·旧笔记.md', JSON.stringify(trashParsed))
  check('parseTrashName: 拆出删除时间', trashParsed !== null && /^2026-11-15T03:04:05\.678Z$/.test(trashParsed.trashedAt), JSON.stringify(trashParsed))
  // 非约定格式不抛错、也不假装知道删除时间：trashedAt 给 null，originalName 保留原名。
  const trashOdd = parseTrashName('随便一个名字.md')
  check('parseTrashName: 非约定格式不炸且时间未知',
    trashOdd !== null && trashOdd.trashedAt === null && trashOdd.originalName === '随便一个名字.md',
    JSON.stringify(trashOdd))

  // 注意：`createNote` 传了 content 时标题由正文里的一级标题推出，所以这里让正文
  // 自己带 `# 待删的笔记`，否则标题会变成第一个小标题。
  await createNote(root, { dir: '做过的项目', title: '待删的笔记', content: '# 待删的笔记\n\n删掉我\n' })
  const beforeTrash = await scanVault(root)
  const trashedRel = beforeTrash.entries.find((e) => e.title === '待删的笔记')
  check('回收站: 先有一条笔记可删', trashedRel !== undefined, JSON.stringify(beforeTrash.entries.map((e) => e.title)))

  const trashResult = await trashNote(root, trashedRel.path)
  check('回收站: 删除返回目标路径', trashResult !== null && typeof trashResult.trashedTo === 'string' && trashResult.trashedTo.startsWith('.trash/'), JSON.stringify(trashResult))

  const afterTrash = await scanVault(root)
  check('回收站: 删掉的笔记不再出现在库里', !afterTrash.entries.some((e) => e.title === '待删的笔记'))

  const trashList = await listTrash(root)
  check('回收站: listTrash 能看到它', trashList.some((i) => i.title === '待删的笔记'), JSON.stringify(trashList.map((i) => i.title)))
  check('回收站: listTrash 带上原始文件名', trashList.some((i) => typeof i.originalName === 'string' && i.originalName.length > 0))
  check('回收站: listTrash 带上大小与时间',
    trashList.every((i) => typeof i.bytes === 'number' && typeof i.trashedAt === 'string'))

  const target = trashList.find((i) => i.title === '待删的笔记')
  const restored = await restoreNote(root, target.path, '')
  check('回收站: 恢复返回落点路径', typeof restored.path === 'string' && restored.path.length > 0, JSON.stringify(restored))
  const restoredText = await readFile(join(root, restored.path), 'utf8')
  check('回收站: 恢复后内容原样', restoredText.includes('删掉我'), restoredText.slice(0, 60))
  check('回收站: 恢复后不在回收站里了', !(await listTrash(root)).some((i) => i.title === '待删的笔记'))

  // 恢复不能覆盖同名文件——为了救一个文件而毁掉另一个说不通。
  await createNote(root, { dir: '做过的项目', title: '撞名测试', content: '# 撞名测试\n\nA 版本\n' })
  const toTrash2 = (await scanVault(root)).entries.find((e) => e.title === '撞名测试')
  const trashed2 = await trashNote(root, toTrash2.path)
  const parsed2 = parseTrashName(trashed2.trashedTo.split('/').pop())
  // 再放一个同名文件占位（和恢复目标同一目录，这样才能真的撞上）
  const occupiedRel = `做过的项目/${parsed2.originalName}`
  await writeFile(join(root, '做过的项目', parsed2.originalName), 'B 版本\n', 'utf8')
  const item2 = (await listTrash(root)).find((i) => i.originalName === parsed2.originalName)
  const restored2 = await restoreNote(root, item2.path, occupiedRel)
  check('回收站: 撞名时改名而不是覆盖', restored2.path !== occupiedRel, restored2.path)
  check('回收站: 撞名时占位文件没被改', (await readFile(join(root, occupiedRel), 'utf8')) === 'B 版本\n')

  // 永久删除
  const trashListBefore = await listTrash(root)
  check('回收站: 清空前有东西', trashListBefore.length > 0, String(trashListBefore.length))
  const purged = await purgeTrash(root, trashListBefore[0].path)
  check('回收站: purgeTrash 单个返回已删列表', Array.isArray(purged.purged) && purged.purged.length === 1, JSON.stringify(purged))
  check('回收站: 单个清除后少一条', (await listTrash(root)).length === trashListBefore.length - 1)

  const purgeAllResult = await purgeTrash(root)
  check('回收站: purgeTrash 清空全部', Array.isArray(purgeAllResult.purged) && purgeAllResult.purged.length === trashListBefore.length - 1, JSON.stringify(purgeAllResult))
  check('回收站: 清空后为空', (await listTrash(root)).length === 0)

  // 标签改写：块列表写法必须整段换掉，不能留悬空 `- 甲` 残渣
  // （这是真 bug：只替换 `tags:` 那一行的话，下面的列表项会原地留下，
  //  文件变成「新标签 + 一堆孤儿列表项」，下次解析把它们当垃圾）
  const readTagsFile = async (rel) => readTags(await readFile(join(root, rel), 'utf8'))
  const blockRel = '标签测试/块列表.md'
  await mkdir(join(root, '标签测试'), { recursive: true })
  await writeFile(join(root, blockRel), ['---', 'title: 块列表', 'tags:', '  - 甲', '  - 乙', '  - 丙', 'note_id: "9001"', '---', '', '正文'].join('\n'), 'utf8')
  check('标签: readTags 认块列表写法', JSON.stringify(await readTagsFile(blockRel)) === JSON.stringify(['甲', '乙', '丙']))
  await removeTag(root, '乙', [{ path: blockRel, tags: ['甲', '乙', '丙'] }])
  const blockAfter = await readFile(join(root, blockRel), 'utf8')
  check('标签: 块列表删除后剩两个', JSON.stringify(await readTagsFile(blockRel)) === JSON.stringify(['甲', '丙']), blockAfter)
  check('标签: 块列表删除后没有悬空列表项', !/^\s+-\s/m.test(blockAfter), blockAfter)
  check('标签: 块列表删除后其他字段没动', /^note_id: "9001"$/m.test(blockAfter) && /^title: 块列表$/m.test(blockAfter))

  const inlineRel = '标签测试/行内.md'
  await writeFile(join(root, inlineRel), ['---', 'title: 行内', 'tags: [甲, 乙]', '---', '', '正文'].join('\n'), 'utf8')
  await removeTag(root, '乙', [{ path: inlineRel, tags: ['甲', '乙'] }])
  check('标签: 行内写法删除只留一个', JSON.stringify(await readTagsFile(inlineRel)) === JSON.stringify(['甲']))

  await removeTag(root, '甲', [{ path: inlineRel, tags: ['甲'] }])
  check('标签: 删到空写成空数组', /^tags: \[\]$/m.test(await readFile(join(root, inlineRel), 'utf8')))

  // 加标签：块列表新增要转成合法的行内数组，且不能残留旧块列表
  const addRel = '标签测试/加标签.md'
  await writeFile(join(root, addRel), ['---', 'title: 加标签', 'tags:', '  - 旧', '---', '', '正文'].join('\n'), 'utf8')
  const added = rewriteTags(await readFile(join(root, addRel), 'utf8'), ['旧', '新'])
  check('标签: rewriteTags 块列表新增合并成行内', /^tags: \[旧, 新\]$/m.test(added), added)
  check('标签: rewriteTags 新增后无残渣', !/^\s+-\s/m.test(added), added)

  // 无 frontmatter / 无 tags 字段也要能正确落盘
  const bareRel = '标签测试/无frontmatter.md'
  await writeFile(join(root, bareRel), '只有正文\n', 'utf8')
  const bareOut = rewriteTags(await readFile(join(root, bareRel), 'utf8'), ['新标签'])
  check('标签: 无 frontmatter 自动包一层', /^---\ntags: \[新标签\]\n---\n/.test(bareOut), bareOut)
  const noTagsOut = rewriteTags(['---', 'title: 无tags', '---', '', '正文'].join('\n'), ['x'])
  check('标签: 无 tags 字段插到末尾且保留原字段', /title: 无tags\n tags: \[x\]|title: 无tags\ntags: \[x\]/.test(noTagsOut), noTagsOut)

  // 单值标签写法 `tags: 甲`（合法 YAML，不是数组）必须能被认出来，
  // 否则 `tag:甲` 搜不到那篇——用户明明看着标签在那儿却搜不出来。
  check('标签: normalizeTags 单值转数组', JSON.stringify(normalizeTags('独苗')) === JSON.stringify(['独苗']))
  check('标签: normalizeTags 数组原样', JSON.stringify(normalizeTags(['甲', '乙'])) === JSON.stringify(['甲', '乙']))
  check('标签: normalizeTags 空值回空数组', normalizeTags(undefined).length === 0 && normalizeTags('').length === 0 && normalizeTags([]).length === 0)
  const singleRel = '标签测试/单值标签.md'
  await writeFile(join(root, singleRel), ['---', 'tags: 独苗', '---', '', '正文里有 关键词'].join('\n'), 'utf8')
  const singleScan = await scanVault(root)
  const singleEntry = singleScan.entries.find((e) => e.path === singleRel)
  check('标签: 扫描把单值写法读成数组', Array.isArray(singleEntry.tags) && singleEntry.tags[0] === '独苗', JSON.stringify(singleEntry && singleEntry.tags))
  const singleHits = await searchNotes(root, 'tag:独苗', {})
  check('标签: tag:单值 能搜到', Array.isArray(singleHits.hits) && singleHits.hits.some((h) => h.path === singleRel), JSON.stringify((singleHits.hits || []).map((h) => h.path)))

  // 别名：`aliases: [读书笔记]` 之后 [[读书笔记]] 该指到这一篇。宿主按别名解析
  // 双链，面板只比标题的话，同一个链接一边点得开、一边报「找不到」。
  check('别名: normalizeAliases 单值转数组', JSON.stringify(normalizeAliases('读书笔记')) === JSON.stringify(['读书笔记']))
  check('别名: normalizeAliases 数组原样', JSON.stringify(normalizeAliases(['甲', '乙'])) === JSON.stringify(['甲', '乙']))
  check('别名: normalizeAliases 空值回空数组', normalizeAliases(undefined).length === 0 && normalizeAliases('').length === 0 && normalizeAliases([]).length === 0)
  const aliasRel = '标签测试/带别名.md'
  await writeFile(join(root, aliasRel), ['---', 'aliases: [读书笔记, 会议备忘]', 'tags: [读书]', '---', '', '正文'].join('\n'), 'utf8')
  const aliasScan = await scanVault(root)
  const aliasEntry = aliasScan.entries.find((e) => e.path === aliasRel)
  check('别名: 扫描把别名读成数组', Array.isArray(aliasEntry.aliases) && aliasEntry.aliases.length === 2 && aliasEntry.aliases[0] === '读书笔记', JSON.stringify(aliasEntry && aliasEntry.aliases))
  const aliasNote = await readNote(root, aliasRel)
  check('别名: /read 载荷里也带着别名', Array.isArray(aliasNote.aliases) && aliasNote.aliases.indexOf('会议备忘') >= 0, JSON.stringify(aliasNote.aliases))
  const singleAliasRel = '标签测试/单值别名.md'
  await writeFile(join(root, singleAliasRel), ['---', 'alias: 独苗别名', '---', '', '正文'].join('\n'), 'utf8')
  const singleAliasScan = await scanVault(root)
  const singleAliasEntry = singleAliasScan.entries.find((e) => e.path === singleAliasRel)
  check('别名: 单值写法也认', Array.isArray(singleAliasEntry.aliases) && singleAliasEntry.aliases[0] === '独苗别名', JSON.stringify(singleAliasEntry && singleAliasEntry.aliases))

  // 批量改标签不能每篇留一个 .bak：用户库里会堆出几十个看不见的副本。
  // 给了 snapshot 回调时走 history，一个 .bak 都不该产生。
  const bakDir = '标签测试'
  const bakFilesBefore = (await readdir(join(root, bakDir))).filter((name) => name.endsWith('.bak')).length
  await writeFile(join(root, bakDir, '批量A.md'), ['---', 'tags: [要删的, 保留的]', '---', '', '正文'].join('\n'), 'utf8')
  await writeFile(join(root, bakDir, '批量B.md'), ['---', 'tags: [要删的]', '---', '', '正文'].join('\n'), 'utf8')
  const snaps = []
  const bulk = await removeTag(root, '要删的', [
    { path: `${bakDir}/批量A.md`, tags: ['要删的', '保留的'] },
    { path: `${bakDir}/批量B.md`, tags: ['要删的'] },
  ], { snapshot: async (rel) => { snaps.push(rel) } })
  check('标签: 批量删两篇', bulk.changed === 2, JSON.stringify(bulk))
  check('标签: 批量删会先留历史快照', snaps.length === 2 && snaps.indexOf(`${bakDir}/批量A.md`) >= 0, JSON.stringify(snaps))
  const bakFilesAfter = (await readdir(join(root, bakDir))).filter((name) => name.endsWith('.bak')).length
  check('标签: 走历史就不产生 .bak', bakFilesAfter === bakFilesBefore, `${bakFilesBefore} → ${bakFilesAfter}`)

  // ── 标签改名（对齐移动端的标签管理）──────────────────────────────────────
  const renDir = '改名测试'
  await mkdir(join(root, renDir), { recursive: true })
  await writeFile(join(root, renDir, 'A.md'), ['---', 'tags: [旧名, 保留]', '---', '', '甲'].join('\n'), 'utf8')
  await writeFile(join(root, renDir, 'B.md'), ['---', 'tags:', '  - 旧名', '---', '', '乙'].join('\n'), 'utf8')
  await writeFile(join(root, renDir, 'C.md'), ['---', 'tags: [无关]', '---', '', '丙'].join('\n'), 'utf8')
  const renEntries = [
    { path: `${renDir}/A.md`, tags: ['旧名', '保留'] },
    { path: `${renDir}/B.md`, tags: ['旧名'] },
    { path: `${renDir}/C.md`, tags: ['无关'] },
  ]
  const renSnaps = []
  const ren = await renameTag(root, '旧名', '新名', renEntries, { snapshot: async (rel) => { renSnaps.push(rel) } })
  check('改名: 命中两篇', ren.changed === 2, JSON.stringify(ren))
  check('改名: 没命中的那篇不动', ren.failed.length === 0)
  check('改名: 两篇都留了历史快照', renSnaps.length === 2, JSON.stringify(renSnaps))
  const renA = await readFile(join(root, renDir, 'A.md'), 'utf8')
  const renB = await readFile(join(root, renDir, 'B.md'), 'utf8')
  const renC = await readFile(join(root, renDir, 'C.md'), 'utf8')
  check('改名: 行内写法换成了新名', /tags: \[新名, 保留\]/.test(renA), renA.split('\n')[1])
  check('改名: 块列表写法也换成了新名', /新名/.test(renB) && !/旧名/.test(renB), renB.split('\n').slice(0, 4).join('|'))
  check('改名: 不相干的笔记原样', /tags: \[无关\]/.test(renC))
  check('改名: 旧名在全库消失', !/旧名/.test(renA) && !/旧名/.test(renB))

  // 改到一个已存在的标签 = 合并，不能写出两个同名项
  await writeFile(join(root, renDir, 'A.md'), ['---', 'tags: [新名, 保留]', '---', '', '甲'].join('\n'), 'utf8')
  const merged = await renameTag(root, '新名', '保留', [{ path: `${renDir}/A.md`, tags: ['新名', '保留'] }])
  const mergedA = await readFile(join(root, renDir, 'A.md'), 'utf8')
  check('改名: 合并到已有标签', merged.changed === 1, JSON.stringify(merged))
  check('改名: 合并后不重复写同名项', /tags: \[保留\]/.test(mergedA), mergedA.split('\n')[1])

  // 同名改名是空操作（用户在输入框里只按了个回车）
  const noop = await renameTag(root, '保留', '保留', [{ path: `${renDir}/A.md`, tags: ['保留'] }])
  check('改名: 新旧同名是空操作', noop.changed === 0, JSON.stringify(noop))

  // 空参数必须报错，不能静默把全库标签抹成空字符串
  let renErr = null
  try {
    await renameTag(root, '  ', '新名', [])
  } catch (error) {
    renErr = error
  }
  check('改名: 空的原标签名报 400', renErr !== null && renErr.status === 400, renErr && renErr.message)
  let renErr2 = null
  try {
    await renameTag(root, '保留', '  ', [])
  } catch (error) {
    renErr2 = error
  }
  check('改名: 空的新标签名报 400', renErr2 !== null && renErr2.status === 400, renErr2 && renErr2.message)

  // ── 反链上下文 ──────────────────────────────────────────────────────────
  // 一篇笔记里可能三处都提到同一篇。只给「它引用了我」和路径的话，用户还得
  // 自己点进去再搜一遍；顺手把那一行剩下的字带出来，扫一眼就知道为什么被引。
  const blDir = '反链测试'
  await mkdir(join(root, blDir), { recursive: true })
  await writeFile(join(root, blDir, '被引.md'), '# 被引\n\n正文\n', 'utf8')
  await writeFile(
    join(root, blDir, '引用方.md'),
    // 两种写法：短名与带目录的路径。extractWikiLinks 会按「链接文字」去重，
    // 同一个写法写两遍只会留一条，这里要的是两处不同的引用。
    ['# 引用方', '', '开会时记到 [[被引]] 这一段', '', '后来又想到 [[反链测试/被引]] 也行', ''].join('\n'),
    'utf8',
  )
  const blResult = await findBacklinks(root, `${blDir}/被引.md`)
  const blHit = blResult.hits.find((h) => h.path === `${blDir}/引用方.md`)
  check('反链: 两处引用都算一次命中', blHit !== undefined && blHit.links.length === 2, JSON.stringify(blHit && blHit.links))
  check(
    '反链: 每处引用各自带上下文',
    blHit !== undefined && Array.isArray(blHit.snippets) && blHit.snippets.length === 2,
    JSON.stringify(blHit && blHit.snippets),
  )
  check(
    '反链: 上下文里是那一行剩下的字',
    blHit !== undefined && blHit.snippets[0].indexOf('开会时记到') >= 0 && blHit.snippets[0].indexOf('[[') < 0,
    JSON.stringify(blHit && blHit.snippets),
  )
  check(
    '反链: 带路径的写法也取得到上下文',
    blHit !== undefined && blHit.snippets[1].indexOf('后来又想到') >= 0,
    JSON.stringify(blHit && blHit.snippets),
  )

  // ── 写作热力图（对齐移动端首页那张）────────────────────────────────────
  const fixedToday = new Date('2026-11-16T12:00:00')
  const hm = heatmapOf(
    [
      { date: '2026-11-16' },
      { date: '2026-11-16' },
      { date: '2026-11-15' },
      { date: '2026-11-14' },
      { date: '2026-11-10' },
      { date: '2026-10-01' },
      { date: null },
      { date: '不是日期' },
    ],
    { weeks: 4, today: fixedToday },
  )
  check('热力图: 格子数 = 周数 × 7', hm.days.length === 28, String(hm.days.length))
  check('热力图: 总数只算有日期的', hm.total === 5, String(hm.total))
  check('热力图: 单日最多 2 篇', hm.best === 2, String(hm.best))
  check('热力图: 连续 3 天', hm.streak === 3, String(hm.streak))
  check('热力图: 日期升序', hm.days[0].date < hm.days[hm.days.length - 1].date)
  check('热力图: 未来日期标了 future', hm.days[hm.days.length - 1].future === true)
  check('热力图: 今天不是 future', hm.days.find((d) => d.date === '2026-11-16').future === false)
  check('热力图: 没有日期的笔记不计数', hm.days.every((d) => typeof d.count === 'number'))

  // 今天还没写不该让连续天数归零：很多人是晚上写，早上打开看到「0 天」会莫名其妙
  const hmMorning = heatmapOf([{ date: '2026-11-15' }, { date: '2026-11-14' }], {
    weeks: 4,
    today: new Date('2026-11-16T08:00:00'),
  })
  check('热力图: 今天没写不算断', hmMorning.streak === 2, String(hmMorning.streak))

  // 昨天也没写才算断
  const hmBroken = heatmapOf([{ date: '2026-11-13' }], { weeks: 4, today: new Date('2026-11-16T08:00:00') })
  check('热力图: 隔了一天就断', hmBroken.streak === 0, String(hmBroken.streak))

  // 周数越界要夹住，不能让用户传 10000 周把面板卡死
  check('热力图: 周数下限 4', heatmapOf([], { weeks: 1, today: fixedToday }).days.length === 28)
  check('热力图: 周数上限 104', heatmapOf([], { weeks: 9999, today: fixedToday }).days.length === 104 * 7)

  // ── 待办勾选 ──────────────────────────────────────────────────────────────
  {
    const todoDir = '未归类'
    await mkdir(join(root, todoDir), { recursive: true })
    const todoPath = `${todoDir}/2026-11-17-待办.md`
    const original = [
      '---',
      'title: 待办',
      'tags: [测试]',
      '---',
      '',
      '# 待办',
      '',
      '- [ ] 第一条',
      '- [x] 第二条',
      '- [ ] 第三条',
      '',
      '```',
      '- [ ] 围栏里的示例',
      '```',
      '',
      '  - [ ] 缩进的一条',
      '',
    ].join('\n')
    await writeFile(join(root, todoPath), original, 'utf8')
    const read = async () => readFile(join(root, todoPath), 'utf8')

    const snaps = []
    const r1 = await toggleTodo(root, todoPath, 0, { snapshot: async (rel) => { snaps.push(rel) } })
    check('待办: 勾第一条返回 done=true', r1.ok === true && r1.done === true && r1.index === 0)
    check('待办: 第一条变成 [x]', (await read()).includes('- [x] 第一条'))
    check('待办: 只改目标那一行，其他待办不动', (await read()).includes('- [ ] 第三条'))
    check('待办: 围栏里的示例不被改', (await read()).includes('- [ ] 围栏里的示例'))
    check('待办: 勾选前留了版本快照', snaps.length === 1 && snaps[0] === todoPath)
    check('待办: 走快照时不留 .bak', !(await readdir(join(root, todoDir))).some((f) => f.endsWith('.bak')))
    check('待办: frontmatter 完好', (await read()).startsWith('---\ntitle: 待办'))

    const r2 = await toggleTodo(root, todoPath, 1)
    check('待办: 取消勾第二条返回 done=false', r2.done === false)
    check('待办: 第二条变成 [ ]', (await read()).includes('- [ ] 第二条'))

    // 缩进的待办也算一条：与 renderBlocks 的 /^\[( |x|X)\]/ 口径不同，
    // 这里认缩进（正文里嵌套的待办也是待办），序号顺序与视觉顺序一致。
    const r3 = await toggleTodo(root, todoPath, 2)
    check('待办: 第三条（围栏之后）序号正确', r3.done === true && (await read()).includes('- [x] 第三条'))
    check('待办: 缩进那条是第 4 个（index=3）', (await read()).includes('  - [ ] 缩进的一条'))
    const r4 = await toggleTodo(root, todoPath, 3)
    check('待办: 缩进那条也能勾（与渲染侧同口径）', r4.done === true && (await read()).includes('  - [x] 缩进的一条'))

    let err404 = null
    try {
      await toggleTodo(root, todoPath, 99)
    } catch (error) {
      err404 = error
    }
    check('待办: 序号越界报 404', err404 !== null && err404.status === 404)

    let err400 = null
    try {
      await toggleTodo(root, todoPath, -1)
    } catch (error) {
      err400 = error
    }
    check('待办: 负数序号报 400', err400 !== null && err400.status === 400)

    let errBad = null
    try {
      await toggleTodo(root, todoPath, 'x')
    } catch (error) {
      errBad = error
    }
    check('待办: 非数字序号报 400', errBad !== null && errBad.status === 400)

    // 没有待办的笔记：不该静默成功
    const emptyPath = `${todoDir}/2026-11-17-没待办.md`
    await writeFile(join(root, emptyPath), '---\ntitle: 没待办\n---\n\n正文没有待办。\n', 'utf8')
    let errNone = null
    try {
      await toggleTodo(root, emptyPath, 0)
    } catch (error) {
      errNone = error
    }
    check('待办: 笔记里没有待办时报 404 而不是假装成功', errNone !== null && errNone.status === 404)
  }

  // 断链体检：写了双链但库里没有这一篇的地方
  {
    const brokenDir = '断链测试'
    await mkdir(join(root, brokenDir), { recursive: true })
    await writeFile(
      join(root, brokenDir, '有问题的.md'),
      [
        '# 有问题的',
        '',
        '这里指得到 [[没问题的]] 和 [[不存在的一篇]]。',
        '还有一条带小节的 [[也不存在#某个小节]]。',
        '附件不算断链：![[示意图.png]] 和 ![[说明.pdf]]。',
        '自己这一节也不算：[[#本节]]。',
        '\u0060\u0060\u0060',
        '围栏里的 [[也是不存在的]] 不算。',
        '\u0060\u0060\u0060',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      join(root, brokenDir, '没问题的.md'),
      '---\naliases: [别名一篇]\n---\n\n# 没问题的\n\n正文\n',
      'utf8',
    )
    await writeFile(
      join(root, brokenDir, '用别名的.md'),
      '# 用别名的\n\n见 [[别名一篇]]，这个是好的。\n',
      'utf8',
    )
    const broken = await findBrokenLinks(root)
    // 库里还有前面用例建的笔记，只挑这一个目录里的看
    const mine = broken.hits.filter((h) => h.path.startsWith(`${brokenDir}/`))
    check('断链: 找得到指向不存在的那些', mine.length === 2, JSON.stringify(mine.map((h) => h.target)))
    check(
      '断链: 目标名字原样交回（带小节时只留前面那段）',
      mine[0].target === '不存在的一篇' && mine[1].target === '也不存在',
      JSON.stringify(mine.map((h) => h.target)),
    )
    check('断链: 带出行号与那一行上下文', mine[0].line === 3 && mine[0].text.includes('不存在的一篇'))
    check('断链: 附件不算断链', !mine.some((h) => /\.(png|pdf)$/i.test(h.target)))
    check('断链: 本节的小节不算断链', !mine.some((h) => h.target === ''))
    check('断链: 围栏里的不算', !mine.some((h) => h.target === '也是不存在的'))
    check('断链: 别名指得到的不算断链', !mine.some((h) => h.target === '别名一篇'))
    check('断链: 扫描篇数交回去', broken.scanned >= 3, String(broken.scanned))
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
