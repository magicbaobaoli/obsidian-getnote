/**
 * cloud-sync.js 的离线测试。
 *
 * 这是整个插件里**唯一会覆盖用户磁盘文件**的模块，所以测试重点不是「能不能拉
 * 下来」，而是**在什么情况下不该动用户的文件**：
 *   · 本地手写归档（带 note_id 但同步引擎没见过它）→ 必须原样保留
 *   · 用户在面板里改过 → 必须保留本地
 *   · 两边都改 → 本地版另存 .conflicts/，不许丢
 *   · 云端删了但本地改过 → 保留本地，不替用户删
 * 用假 client 跑，不联网。
 */
import { mkdtemp, readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runSync, syncSingleNote, pushNote, renderNote, contentFingerprint, safeDirName } from '../src/core/cloud-sync.js'

let passed = 0
let failed = 0
const failures = []

function ok(name, cond, extra = '') {
  if (cond) {
    passed += 1
  } else {
    failed += 1
    failures.push(`${name}${extra ? ` — ${extra}` : ''}`)
  }
}

async function freshRoot() {
  const dir = await mkdtemp(join(tmpdir(), 'gn-sync-'))
  return dir
}

async function writeLocal(root, rel, text) {
  const abs = join(root, rel)
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, text, 'utf8')
}

async function readLocal(root, rel) {
  try {
    return await readFile(join(root, rel), 'utf8')
  } catch {
    return null
  }
}

async function exists(root, rel) {
  try {
    await stat(join(root, rel))
    return true
  } catch {
    return false
  }
}

/** 造一篇云端笔记（形状对齐 normalizeNote 的输入）。 */
function cloudNote(over = {}) {
  return {
    noteId: over.noteId || '1001',
    title: over.title || '一篇笔记',
    content: over.content || '正文内容',
    noteType: over.noteType || 'plain_text',
    tags: (over.tags || []).map((name) => ({ name })),
    topics: over.topics || [],
    createdAt: over.createdAt || '2026-11-13 10:00:00',
    updatedAt: over.updatedAt || '2026-11-13 10:00:00',
    ...over,
  }
}

/** 假 client：listNotes 返回给定集合，getNote 按 id 查。 */
function fakeClient(notes) {
  const calls = { list: 0, get: 0 }
  return {
    calls,
    async listNotes({ cursor } = {}) {
      calls.list += 1
      if (cursor) return { notes: [], hasMore: false, cursor: null }
      return { notes, hasMore: false, cursor: null }
    },
    async getNote(noteId) {
      calls.get += 1
      const found = notes.find((n) => n.noteId === noteId)
      if (!found) throw Object.assign(new Error('not found'), { status: 404 })
      return found
    },
    async createNote() {
      throw new Error('不该走到 createNote')
    },
    async updateNote() {
      throw new Error('不该走到 updateNote')
    },
  }
}

// ── 1. 全新库：把云端笔记落下来 ─────────────────────────────────────────────

{
  const root = await freshRoot()
  const note = cloudNote({ noteId: '1001', title: '第一条', content: '正文一', tags: ['标签A'] })
  const client = fakeClient([note])
  const result = await runSync({ client, root, state: { notes: {} }, full: false, log: () => {} })

  ok('全新库 pulled=1', result.pulled === 1, `pulled=${result.pulled}`)
  ok('全新库 errors=0', result.errors.length === 0)
  const rel = Object.values(result.notes)[0].path
  ok('路径带日期前缀', /^\d{4}-\d{2}-\d{2}-第一条\.md$/.test(rel) || /未归类\/\d{4}-\d{2}-\d{2}-第一条\.md$/.test(rel), rel)
  const text = await readLocal(root, rel)
  ok('落盘内容含标题', text !== null && text.includes('# 第一条'))
  ok('落盘内容含正文', text !== null && text.includes('正文一'))
  ok('frontmatter 带 note_id', text !== null && text.includes('note_id: "1001"'))
  ok('frontmatter 带 tags', text !== null && text.includes('标签A'))
  ok('写到"未归类"目录而不是 "_"', rel.startsWith('未归类/') || !rel.includes('_/'), rel)
  ok('首次写入不产生 .bak', !(await exists(root, `${rel}.bak`)))
}

// ── 2. 知识库归属：按 topic 名分目录 ─────────────────────────────────────────

{
  const root = await freshRoot()
  const note = cloudNote({ noteId: '2001', title: '课程笔记', topics: [{ id: 'TOPICDEMO01', name: '课程与笔记' }] })
  const result = await runSync({ client: fakeClient([note]), root, state: { notes: {} }, full: false, log: () => {} })
  const rel = Object.values(result.notes)[0].path
  ok('按知识库分目录', rel === '课程与笔记/' + rel.split('/').pop(), rel)
  const text = await readLocal(root, rel)
  ok('frontmatter 记知识库', text !== null && text.includes('知识库: 课程与笔记'))
}

// ── 3. 第二轮无变化：什么都不写 ─────────────────────────────────────────────

{
  const root = await freshRoot()
  const note = cloudNote({ noteId: '3001', title: '稳定', content: '不变' })
  const client = fakeClient([note])
  const first = await runSync({ client, root, state: { notes: {} }, full: false, log: () => {} })
  const rel = Object.values(first.notes)[0].path
  const before = await readLocal(root, rel)

  const second = await runSync({ client, root, state: { notes: first.notes }, full: false, log: () => {} })
  ok('第二轮 pulled=0', second.pulled === 0, `pulled=${second.pulled}`)
  ok('第二轮 skipped=1', second.skipped === 1)
  const after = await readLocal(root, rel)
  ok('文件没被重写', before === after)
  ok('覆盖也不留 .bak', !(await exists(root, `${rel}.bak`)))
}

// ── 4. 云端改了、本地没改：跟着云端走，且不留 .bak ──────────────────────────

{
  const root = await freshRoot()
  const v1 = cloudNote({ noteId: '4001', title: '会更新', content: '旧内容' })
  const client = fakeClient([v1])
  const first = await runSync({ client, root, state: { notes: {} }, full: false, log: () => {} })
  const rel = Object.values(first.notes)[0].path

  const v2 = cloudNote({ noteId: '4001', title: '会更新', content: '新内容' })
  const result = await runSync({ client: fakeClient([v2]), root, state: { notes: first.notes }, full: false, log: () => {} })
  const text = await readLocal(root, rel)
  ok('云端更新被拉下来', text !== null && text.includes('新内容'), rel)
  ok('覆盖时不留 .bak（库不会被副本塞满）', !(await exists(root, `${rel}.bak`)))
  ok('pulled 计 1', result.pulled === 1, `pulled=${result.pulled}`)
}

// ── 5. 用户手写归档：state 里没有它 → 必须原样保留（真实事故回归）───────────

{
  const root = await freshRoot()
  // 模拟用户自己按归档规则手写的笔记：带 note_id，但没有我们的字段
  const handwritten = [
    '---',
    'tags: [得到大脑, 记录]',
    'note_id: "5001"',
    '类型: recorder_audio（GetSeed 录音卡）',
    '录音时间: 2026-01-01 09:00:00',
    '设备: GSDEMO0000001',
    '---',
    '',
    '# 我手写的标题',
    '',
    '这是我自己整理的内容，不许覆盖我。',
  ].join('\n')
  await writeLocal(root, '随手记/2026-11-13-我手写的标题.md', handwritten)

  const note = cloudNote({ noteId: '5001', title: '我手写的标题', content: '云端那份完全不同的正文' })
  const result = await runSync({ client: fakeClient([note]), root, state: { notes: {} }, full: false, log: () => {} })

  const text = await readLocal(root, '随手记/2026-11-13-我手写的标题.md')
  ok('手写归档没有被覆盖', text === handwritten, text === null ? '文件消失' : '')
  ok('adopted 计数为 1', result.adopted === 1, `adopted=${result.adopted}`)
  ok('adopt 后 state 带 adopted 标记', Object.values(result.notes)[0].adopted === true)
  ok('adopt 时不留 .bak', !(await exists(root, '随手记/2026-11-13-我手写的标题.md.bak')))
  ok('手写的原始字段还在', text !== null && text.includes('设备: GSDEMO0000001'))
}

// ── 6. adopt 之后云端又改：仍然不动用户的文件，只另存一份 ──────────────────

{
  const root = await freshRoot()
  const handwritten = '---\nnote_id: "6001"\n---\n\n# 我的\n\n我的内容。\n'
  await writeLocal(root, '未归类/2026-11-13-我的.md', handwritten)
  const v1 = cloudNote({ noteId: '6001', title: '我的', content: '云端一' })
  const first = await runSync({ client: fakeClient([v1]), root, state: { notes: {} }, full: false, log: () => {} })

  const v2 = cloudNote({ noteId: '6001', title: '我的', content: '云端二' })
  const result = await runSync({ client: fakeClient([v2]), root, state: { notes: first.notes }, full: false, log: () => {} })

  const text = await readLocal(root, '未归类/2026-11-13-我的.md')
  ok('adopt 后仍不覆盖', text === handwritten)
  ok('云端新版另存到 .conflicts', await exists(root, '.conflicts') === true)
  const conflicts = await readdir(join(root, '.conflicts'))
  ok('冲突目录里有一份', conflicts.length === 1, conflicts.join(','))
  const alt = await readFile(join(root, '.conflicts', conflicts[0]), 'utf8')
  ok('另存的是云端新版本', alt.includes('云端二'), alt.slice(0, 80))
  ok('kept-local 不计入 pulled', result.pulled === 0, `pulled=${result.pulled}`)
}

// ── 7. 用户改过本地、云端没改：保留本地 ────────────────────────────────────

{
  const root = await freshRoot()
  const note = cloudNote({ noteId: '7001', title: '我会被改', content: '云端原文' })
  const first = await runSync({ client: fakeClient([note]), root, state: { notes: {} }, full: false, log: () => {} })
  const rel = Object.values(first.notes)[0].path

  // 用户在 Obsidian / 面板里补了一段
  const edited = (await readLocal(root, rel)) + '\n这是我加的一段。\n'
  await writeLocal(root, rel, edited)

  const result = await runSync({ client: fakeClient([note]), root, state: { notes: first.notes }, full: false, log: () => {} })
  const text = await readLocal(root, rel)
  ok('本地修改被保留', text !== null && text.includes('这是我加的一段。'))
  ok('保留本地不计入 pulled', result.pulled === 0, `pulled=${result.pulled}`)
}

// ── 8. 两边都改：本地版另存 .conflicts，正文写云端 ─────────────────────────

{
  const root = await freshRoot()
  const v1 = cloudNote({ noteId: '8001', title: '冲突', content: '初版' })
  const first = await runSync({ client: fakeClient([v1]), root, state: { notes: {} }, full: false, log: () => {} })
  const rel = Object.values(first.notes)[0].path

  const edited = (await readLocal(root, rel)) + '\n本地独有的一段。\n'
  await writeLocal(root, rel, edited)

  const v2 = cloudNote({ noteId: '8001', title: '冲突', content: '云端改过的正文' })
  const result = await runSync({ client: fakeClient([v2]), root, state: { notes: first.notes }, full: false, log: () => {} })

  const text = await readLocal(root, rel)
  ok('正文写云端版', text !== null && text.includes('云端改过的正文'))
  ok('冲突计数为 1', result.conflicts === 1, `conflicts=${result.conflicts}`)
  const conflicts = await readdir(join(root, '.conflicts'))
  ok('本地版进了 .conflicts', conflicts.length === 1, conflicts.join(','))
  const saved = await readFile(join(root, '.conflicts', conflicts[0]), 'utf8')
  ok('另存的本地版含用户那段', saved.includes('本地独有的一段。'), saved.slice(-120))
}

// ── 9. 云端删了、本地没改（仅全量模式才检测）───────────────────────────────

{
  const root = await freshRoot()
  const note = cloudNote({ noteId: '9001', title: '会被删', content: 'x' })
  const first = await runSync({ client: fakeClient([note]), root, state: { notes: {} }, full: false, log: () => {} })
  const rel = Object.values(first.notes)[0].path

  const result = await runSync({ client: fakeClient([]), root, state: { notes: first.notes }, full: true, log: () => {} })
  ok('全量模式检测到删除', result.deleted === 1, `deleted=${result.deleted}`)
  ok('本地文件进了回收站', !(await exists(root, rel)))
  ok('回收站目录存在', await exists(root, '.trash'))
}

// ── 10. 云端删了但本地改过：保留本地，不替用户删 ──────────────────────────

{
  const root = await freshRoot()
  const note = cloudNote({ noteId: '9101', title: '别删我', content: 'x' })
  const first = await runSync({ client: fakeClient([note]), root, state: { notes: {} }, full: false, log: () => {} })
  const rel = Object.values(first.notes)[0].path
  const edited = (await readLocal(root, rel)) + '\n我改过。\n'
  await writeLocal(root, rel, edited)

  const result = await runSync({ client: fakeClient([]), root, state: { notes: first.notes }, full: true, log: () => {} })
  ok('改过的本地文件没被删', await exists(root, rel))
  ok('不删除算冲突保护', result.deleted === 0, `deleted=${result.deleted}`)
  ok('标记 cloudDeleted', Object.values(result.notes)[0].cloudDeleted === true)
}

// ── 11. 增量模式不误删：扫到第一页没变化就收工，不许判删除 ─────────────────

{
  const root = await freshRoot()
  const notes = [
    cloudNote({ noteId: '11001', title: 'A', content: 'a' }),
    cloudNote({ noteId: '11002', title: 'B', content: 'b' }),
  ]
  const first = await runSync({ client: fakeClient(notes), root, state: { notes: {} }, full: false, log: () => {} })
  // 增量跑一轮：云端仍在，只是我们提前收工
  const result = await runSync({ client: fakeClient(notes), root, state: { notes: first.notes }, full: false, log: () => {} })
  ok('增量模式 deleted 恒为 0', result.deleted === 0, `deleted=${result.deleted}`)
  const stillA = await readLocal(root, Object.values(first.notes)[0].path)
  ok('增量不会动已有文件', stillA !== null)
}

// ── 12. syncSingleNote：只刷这一篇，别的笔记不受影响 ────────────────────────

{
  const root = await freshRoot()
  const a = cloudNote({ noteId: '12001', title: '甲', content: '甲的正文' })
  const b = cloudNote({ noteId: '12002', title: '乙', content: '乙的正文' })
  const first = await runSync({ client: fakeClient([a, b]), root, state: { notes: {} }, full: false, log: () => {} })
  const pathB = Object.entries(first.notes).find(([id]) => id === '12002')[1].path
  const beforeB = await readLocal(root, pathB)

  const a2 = cloudNote({ noteId: '12001', title: '甲', content: '甲改过了' })
  const out = await syncSingleNote({
    client: fakeClient([a2, b]),
    root,
    state: { notes: first.notes },
    noteId: '12001',
    index: new Map(),
  })
  ok('single 返回 submitted 路径', typeof out.path === 'string' && out.path !== '')
  const afterB = await readLocal(root, pathB)
  ok('另一篇完全没动', beforeB === afterB)
  const relA = Object.entries(first.notes).find(([id]) => id === '12001')[1].path
  const textA = await readLocal(root, relA)
  ok('目标那篇更新了', textA !== null && textA.includes('甲改过了'))
}

// ── 13. runSync 上报 errors 而不整体崩掉 ───────────────────────────────────

{
  const root = await freshRoot()
  const good = cloudNote({ noteId: '13001', title: '好的', content: 'g' })
  // 这篇故意做成「列表里没有正文 + 录音类」：只有这种笔记才必须拉详情，
  // 详情失败时也确实没有可用数据，应当如实记进 errors 而不是落一篇空文件。
  const broken = cloudNote({ noteId: '13002', title: '会失败', content: '', noteType: 'recorder_audio' })
  const client = {
    async listNotes() {
      return { notes: [{ ...good }, { ...broken }], hasMore: false }
    },
    async getNote(noteId) {
      if (noteId === '13002') throw Object.assign(new Error('服务端 500'), { status: 500 })
      return good
    },
  }
  const result = await runSync({ client, root, state: { notes: {} }, full: false, log: () => {} })
  ok('单篇失败不中断整轮', result.pulled >= 1, `pulled=${result.pulled}`)
  ok('失败被记进 errors', result.errors.length === 1, `errors=${result.errors.length}`)
  ok('失败项带 message', result.errors[0].message.includes('服务端 500'))
}

// ── 14. pushNote：只推正文，剥 frontmatter 与来源行 ────────────────────────

{
  const root = await freshRoot()
  const body = [
    '---',
    'title: 推上去',
    'note_id: "14001"',
    'tags: [得到大脑, 自定义]',
    '---',
    '',
    '# 推上去',
    '',
    '正文段落。',
    '',
    '---',
    '',
    '（源自得到大脑 · [原笔记](https://www.biji.com/note/14001) · 归档于 2026-11-14）',
  ].join('\n')
  await writeLocal(root, '未归类/2026-11-14-推上去.md', body)

  let sent = null
  const client = {
    async updateNote(payload) {
      sent = payload
      return { ok: true }
    },
  }
  await pushNote({ client, root, relPath: '未归类/2026-11-14-推上去.md' })
  ok('push 调用了 updateNote', sent !== null)
  ok('push 带上 noteId', sent !== null && String(sent.noteId) === '14001', sent ? String(sent.noteId) : '')
  ok('push 的正文不含 frontmatter', sent !== null && !sent.content.includes('---\ntitle:'))
  ok('push 的正文不含来源行', sent !== null && !sent.content.includes('源自得到大脑'), sent ? sent.content.slice(-100) : '')
  ok('push 保留正文内容', sent !== null && sent.content.includes('正文段落。'))
  ok('push 剥掉正文开头的一级标题（标题单独推）', sent !== null && !/^#\s/m.test(sent.content), sent ? sent.content : '')
}

// ── 15. 纯函数 ──────────────────────────────────────────────────────────────

{
  ok('safeDirName 空名不返回 "_"', safeDirName('') !== '_', safeDirName(''))
  ok('safeDirName 清洗非法字符', safeDirName('a/b:c*d') === 'a b c d', safeDirName('a/b:c*d'))
  ok('safeDirName 处理 undefined', safeDirName(undefined) === '')

  const f1 = contentFingerprint({ title: 't', content: 'c', tags: ['a'] })
  const f2 = contentFingerprint({ title: 't', content: 'c', tags: ['a'] })
  const f3 = contentFingerprint({ title: 't', content: 'c2', tags: ['a'] })
  ok('指纹稳定', f1 === f2)
  ok('内容变则指纹变', f1 !== f3)
  ok('指纹不含时间戳', contentFingerprint({ title: 't', content: 'c', tags: ['a'] }) === f1)

  const rendered = renderNote({
    note: cloudNote({
      noteId: '15001',
      title: '渲染测试',
      content: '正文',
      noteType: 'recorder_audio',
      audio: [{ url: 'https://mediacdn.umiwi.com/a.mp3', duration: 44, kind: 'primary' }],
      moments: [{ startMs: 0, endMs: 15000, text: '开场白' }],
      todos: [{ text: '记得回消息', completed: true }],
    }),
    topicName: '随手记',
  })
  ok('渲染含标题', rendered.includes('# 渲染测试'))
  ok('渲染含音频链接', rendered.includes('## 音频') && rendered.includes('mediacdn.umiwi.com'))
  ok('渲染含时间轴', rendered.includes('## 时间轴') && rendered.includes('开场白'))
  ok('渲染含待办勾选', rendered.includes('- [x] 记得回消息'))
  ok('渲染含来源行', rendered.includes('源自得到大脑'))
  ok('渲染的 frontmatter 可被识别', rendered.startsWith('---\n') && rendered.includes('note_id: "15001"'))
}

// ── 输出 ────────────────────────────────────────────────────────────────────

console.log(`\n${passed}/${passed + failed} passed`)
if (failed > 0) {
  console.log('\nFAILURES:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exitCode = 1
}
