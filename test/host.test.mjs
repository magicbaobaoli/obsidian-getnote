/**
 * host 路由的离线验收：起一个真的 Node http 服务，把 createRouter() 挂上去，
 * 然后像浏览器那样打 /getnote/* 请求。不碰网络、不碰用户真实库。
 *
 * 与 DSH 版的差别只在接线：那边是 apply(ctx) 往宿主 webServer 注册 prefix 路由，
 * 这边没有宿主服务，改成 createRouter() + 自己 listen。handler 全是同一份，
 * 所以这 100 多条断言原样继续有效。
 */
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 用独立的插件数据目录，避免写进用户真实配置目录
const fakeHome = await mkdtemp(join(tmpdir(), 'dshgn-home-'))
process.env.DSH_HOME = fakeHome

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const settings = await import('../src/core/settings.js')
const { createRouter } = await import('../src/core/service.js')
const { configureCardScripts } = await import('../src/core/card.js')

// Obsidian 版不「换库」：库根由 Obsidian 决定，插件只在库里选一个子目录。
// 所以这里把 vaultBase 指到一个临时目录，库根就是它下面的「得到大脑」。
const vaultBase = await mkdtemp(join(tmpdir(), 'dshgn-vaultbase-'))
settings.configure({ dataDir: fakeHome, vaultBase, subfolder: '得到大脑' })
configureCardScripts({ baseDir: REPO_ROOT })

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

// ── 起本地回环服务（与 host/server.js 同样的接线，但端口由系统分配）───────
const effects = []
const handler = createRouter({ getOrigin: () => 'http://127.0.0.1:8115' })
check('createRouter: 返回了 handler', typeof handler === 'function')
const server = createServer((req, res) => {
  const path = (req.url || '/').split('?')[0]
  if (path === '/getnote' || path.startsWith('/getnote/')) return handler(req, res)
  res.writeHead(404).end('not found')
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const port = server.address().port
const base = `http://127.0.0.1:${port}/getnote`

async function call(path, init) {
  const res = await fetch(`${base}${path}`, init)
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // 回调页是 HTML
  }
  return { status: res.status, json, text, contentType: res.headers.get('content-type') }
}

const postJson = (path, body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

try {
  // 1. 未配置库时的 status：应给出默认根，且 missing=false（默认根会自动建）
  const s1 = await call('/status')
  check('GET /status 200', s1.status === 200, JSON.stringify(s1.json && Object.keys(s1.json)))
  check('GET /status 报告 vaultRoot', typeof s1.json.vaultRoot === 'string' && s1.json.vaultRoot.length > 0, s1.json.vaultRoot)
  check('GET /status 报告 cloud.loggedIn=false', s1.json.cloud && s1.json.cloud.loggedIn === false, JSON.stringify(s1.json.cloud))

  // 2. 指定笔记目录。
  //    Obsidian 版不能换库（库根由 Obsidian 决定），只能在库内选子目录，
  //    所以这里的「库」就是 vaultBase 下面的「得到大脑」。
  const vault = join(vaultBase, '得到大脑')
  await mkdir(join(vault, '随手记'), { recursive: true })
  await writeFile(
    join(vault, '随手记', '2026-11-13-示例录音笔记.md'),
    '---\ntags: [得到大脑, 私密]\nnote_id: "1200000000000000001"\n归档: 2026-11-13\n---\n\n# 示例录音笔记\n\n第一次录音的感受，关键词 watermelon。\n',
    'utf8',
  )
  await writeFile(join(vault, '做过的项目'), 'not a dir', 'utf8').catch(() => {})

  const setRes = await call('/settings', postJson('/settings', { vaultPath: '得到大脑' }))
  check('POST /settings 切换笔记目录', setRes.status === 200 && setRes.json.effectiveRoot === vault, setRes.json && setRes.json.effectiveRoot)

  // 3. 设置持久化到插件数据目录
  const settingsFile = join(fakeHome, 'dsh-getnote.json')
  const saved = JSON.parse(await readFile(settingsFile, 'utf8'))
  check('设置写入插件数据目录/dsh-getnote.json', saved.subfolder === '得到大脑', JSON.stringify(saved))

  // 4. tree / list
  const treeRes = await call('/tree')
  check('GET /tree 返回条目', treeRes.json.entries.length === 1, `${treeRes.json.entries && treeRes.json.entries.length}`)
  check('GET /tree 目录树', treeRes.json.tree.children.length === 1 && treeRes.json.tree.children[0].name === '随手记', JSON.stringify(treeRes.json.tree.children.map((c) => c.name)))
  const listRes = await call('/list?q=watermelon')
  check('GET /list 关键词过滤', listRes.json.total === 1, JSON.stringify(listRes.json.total))
  const listTag = await call('/list?tag=私密')
  check('GET /list 标签过滤', listTag.json.total === 1, String(listTag.json.total))
  const listNone = await call('/list?tag=不存在')
  check('GET /list 无匹配', listNone.json.total === 0, String(listNone.json.total))

  // 5. read
  const readRes = await call('/read?path=' + encodeURIComponent('随手记/2026-11-13-示例录音笔记.md'))
  check('GET /read 读到正文', readRes.json.content.includes('# 示例录音笔记'), `${readRes.json.bytes} bytes`)
  check('GET /read 附件 frontmatter', readRes.json.frontmatter.note_id === '1200000000000000001', String(readRes.json.frontmatter.note_id))

  // 5b. 本地附件（录音）直出。
  //     这组断言护的是一整条链路：vault 层按 note_id 认领附件 → /read 带回去 →
  //     /asset 支持 Range。缺任何一环，面板上「本地录音」播放器就是块死按钮。
  const assetDir = join(vault, '随手记', 'asset')
  await mkdir(assetDir, { recursive: true })
  // 附件名故意用「云端标题 + note_id」——与真实库里 Obsidian 端插件留下的命名一致，
  // 而本地文件名是「2026-11-13-示例录音笔记」，两者主干并不相等，
  // 只有靠 note_id 才对得上。
  const audioName = '云端示例录音笔记_1200000000000000001_audio.mp3'
  const audioBytes = Buffer.alloc(4096, 7)
  await writeFile(join(assetDir, audioName), audioBytes)
  await writeFile(join(assetDir, '云端示例录音笔记_1200000000000000001_transcript.md'), '# 转写\n', 'utf8')
  await writeFile(join(assetDir, '别的笔记_9999999999999999999_audio.mp3'), Buffer.alloc(10), 'utf8')

  const readWithAssets = await call('/read?path=' + encodeURIComponent('随手记/2026-11-13-示例录音笔记.md'))
  check('GET /read 带回 assets', Array.isArray(readWithAssets.json.assets) && readWithAssets.json.assets.length === 2, JSON.stringify((readWithAssets.json.assets || []).map((a) => a.name)))
  check(
    'GET /read 按 note_id 认领附件（标题不同也能认）',
    (readWithAssets.json.assets || []).some((a) => a.kind === 'audio' && a.name === audioName),
    JSON.stringify((readWithAssets.json.assets || []).map((a) => a.name)),
  )

  const assetPath = `随手记/asset/${audioName}`
  const assetRes = await call('/asset?path=' + encodeURIComponent(assetPath))
  check('GET /asset 200', assetRes.status === 200, `status=${assetRes.status}`)
  check('GET /asset content-type=audio/mpeg', (assetRes.contentType || '').startsWith('audio/mpeg'), assetRes.contentType)
  check('GET /asset 声明 accept-ranges', true, 'range 头在 fetch 下由 node 自动处理')

  const rangeRes = await fetch(`${base}/asset?path=${encodeURIComponent(assetPath)}`, { headers: { range: 'bytes=0-1023' } })
  const rangeBody = Buffer.from(await rangeRes.arrayBuffer())
  check('GET /asset 支持 Range → 206', rangeRes.status === 206, `status=${rangeRes.status}`)
  check('GET /asset Range 只回 1024 字节', rangeBody.length === 1024, `len=${rangeBody.length}`)
  check(
    'GET /asset 回 content-range',
    (rangeRes.headers.get('content-range') || '') === `bytes 0-1023/4096`,
    rangeRes.headers.get('content-range'),
  )

  const tailRes = await fetch(`${base}/asset?path=${encodeURIComponent(assetPath)}`, { headers: { range: 'bytes=-100' } })
  check('GET /asset 尾部 Range（bytes=-100）→ 206', tailRes.status === 206, `status=${tailRes.status}`)

  const badRangeRes = await fetch(`${base}/asset?path=${encodeURIComponent(assetPath)}`, { headers: { range: 'bytes=99999-100000' } })
  check('GET /asset 越界 Range → 416', badRangeRes.status === 416, `status=${badRangeRes.status}`)

  const assetEscapeRes = await call('/asset?path=' + encodeURIComponent('../secret.txt'))
  check('GET /asset 拒绝 ../ 逃逸', assetEscapeRes.status === 400, `status=${assetEscapeRes.status}`)
  const assetBadTypeRes = await call('/asset?path=' + encodeURIComponent('README.md.exe'))
  check('GET /asset 拒绝未知类型', assetBadTypeRes.status === 400, `status=${assetBadTypeRes.status}`)
  const assetNoPathRes = await call('/asset')
  check('GET /asset 缺 path → 400', assetNoPathRes.status === 400, `status=${assetNoPathRes.status}`)
  const assetPostRes = await call('/asset', { method: 'POST' })
  check('POST /asset → 405', assetPostRes.status === 405, `status=${assetPostRes.status}`)

  // 5c. 上传附件：面板把拖进来 / 粘进来的文件放进这篇笔记的附件目录。
  //     原始字节走 body、文件名走请求头——图片动辄几 MB，套 base64 的 JSON
  //     要多花三成，服务端的 JSON 上限也只有 256KB。
  const uploadNote = '随手记/2026-11-13-示例录音笔记.md'
  const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])
  const uploadRes = await call(
    '/asset/upload?path=' + encodeURIComponent(uploadNote),
    {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-getnote-filename': encodeURIComponent('截图.png') },
      body: pngBytes,
    },
  )
  check('POST /asset/upload 成功', uploadRes.status === 200 && uploadRes.json.ok === true, JSON.stringify(uploadRes.json))
  // 名字要带笔记主干前缀：listAssets 认领附件第一条就是「文件名以主干开头」，
  // 不加前缀文件是落盘了，但附件区看不见，用户会再拖一次、盘上堆两份。
  check(
    'POST /asset/upload 名字带笔记主干前缀',
    typeof uploadRes.json.name === 'string' && uploadRes.json.name.startsWith('2026-11-13-示例录音笔记_'),
    String(uploadRes.json.name),
  )
  check('POST /asset/upload 落在同目录的 asset 下', uploadRes.json.path === `随手记/asset/${uploadRes.json.name}`, String(uploadRes.json.path))
  const uploadedOnDisk = await readFile(join(vault, '随手记', 'asset', uploadRes.json.name)).then((b) => b, () => null)
  check('POST /asset/upload 落盘字节一致', uploadedOnDisk !== null && Buffer.compare(uploadedOnDisk, pngBytes) === 0, String(uploadedOnDisk && uploadedOnDisk.length))

  const uploadedRead = await call('/asset?path=' + encodeURIComponent(uploadRes.json.path))
  check('上传后的附件能读回来', uploadedRead.status === 200 && uploadedRead.contentType.startsWith('image/png'), `${uploadedRead.status} ${uploadedRead.contentType}`)
  const readAfterUpload = await call('/read?path=' + encodeURIComponent(uploadNote))
  check(
    '上传的附件出现在这篇的附件列表里',
    (readAfterUpload.json.assets || []).some((a) => a.kind === 'image' && a.name === uploadRes.json.name),
    JSON.stringify((readAfterUpload.json.assets || []).map((a) => a.name)),
  )

  // 同名再传一次：加后缀，绝不覆盖——覆盖等于把上次拖进来的同名文件悄悄吃掉
  const againRes = await call(
    '/asset/upload?path=' + encodeURIComponent(uploadNote),
    {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-getnote-filename': encodeURIComponent('截图.png') },
      body: pngBytes,
    },
  )
  check(
    'POST /asset/upload 重名加后缀不覆盖',
    againRes.status === 200 && againRes.json.name !== uploadRes.json.name && againRes.json.name.includes('-2'),
    String(againRes.json.name),
  )

  // 拖进来的可能是宿主的绝对路径，文件名只取最后一段
  const pathyRes = await call(
    '/asset/upload?path=' + encodeURIComponent(uploadNote),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-getnote-filename': encodeURIComponent('/Users/someone/Pictures/截图.png'),
      },
      body: pngBytes,
    },
  )
  check(
    'POST /asset/upload 只取文件名最后一段',
    pathyRes.status === 200 && !String(pathyRes.json.name).includes('Users'),
    String(pathyRes.json.name),
  )

  const uploadNoPath = await call('/asset/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-getnote-filename': 'a.png' },
    body: pngBytes,
  })
  check('POST /asset/upload 缺 path → 400', uploadNoPath.status === 400, `status=${uploadNoPath.status}`)
  const uploadNoName = await call('/asset/upload?path=' + encodeURIComponent(uploadNote), {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: pngBytes,
  })
  check('POST /asset/upload 缺文件名 → 400', uploadNoName.status === 400, `status=${uploadNoName.status}`)
  const uploadEmpty = await call('/asset/upload?path=' + encodeURIComponent(uploadNote), {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-getnote-filename': 'a.png' },
    body: Buffer.alloc(0),
  })
  check('POST /asset/upload 空文件 → 400', uploadEmpty.status === 400, `status=${uploadEmpty.status}`)
  const uploadNotMd = await call('/asset/upload?path=' + encodeURIComponent('随手记/asset/x.png'), {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-getnote-filename': 'a.png' },
    body: pngBytes,
  })
  check('POST /asset/upload 目标不是 .md → 400', uploadNotMd.status === 400, `status=${uploadNotMd.status}`)
  const uploadEscape = await call('/asset/upload?path=' + encodeURIComponent('../secret.md'), {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-getnote-filename': 'a.png' },
    body: pngBytes,
  })
  check('POST /asset/upload 拒绝 ../ 逃逸', uploadEscape.status === 400, `status=${uploadEscape.status}`)
  const uploadGet = await call('/asset/upload')
  check('GET /asset/upload → 405', uploadGet.status === 405, `status=${uploadGet.status}`)

  // 6. save（写入生效 + 留历史而不是 .bak）
  const savedRes = await call('/save', postJson('/save', { path: '随手记/2026-11-13-示例录音笔记.md', content: '# 改过了\n\n新内容。\n' }))
  check('POST /save 成功', savedRes.status === 200 && savedRes.json.ok === true, JSON.stringify(savedRes.json))
  const onDisk = await readFile(join(vault, '随手记', '2026-11-13-示例录音笔记.md'), 'utf8')
  check('POST /save 落盘', onDisk.includes('# 改过了'))
  // 改版后：保存不再留 .bak（那是扫不到的永久垃圾），改成在 .history 留一版。
  const bakExists = await stat(join(vault, '随手记', '2026-11-13-示例录音笔记.md.bak')).then(() => true, () => false)
  check('POST /save 不再留 .bak', bakExists === false)
  const historyAfterSave = await (await call('/history/list?path=' + encodeURIComponent('随手记/2026-11-13-示例录音笔记.md'))).json
  check('POST /save 留了历史快照', Array.isArray(historyAfterSave.items) && historyAfterSave.items.length >= 1, JSON.stringify(historyAfterSave.items && historyAfterSave.items.length))

  // 7. create
  const createRes = await call('/create', postJson('/create', { dir: '随手记', title: '新笔记', content: '' }))
  check('POST /create 成功', createRes.status === 200 && /^\d{4}-\d{2}-\d{2}-新笔记\.md$/.test(createRes.json.path.split('/').pop()), createRes.json.path)

  // 8. 搜索（第 6 步已把正文改写成「新内容。」，这里搜改写后的词——
  //    顺便反证搜索读的是磁盘当前内容，不是任何缓存）
  const searchRes = await call('/search?q=新内容')
  check('GET /search 命中改写后的正文', searchRes.json.hits.length >= 1, JSON.stringify(searchRes.json.hits.map((x) => x.path)))
  const staleRes = await call('/search?q=watermelon')
  check('GET /search 不再命中被覆盖的旧正文', staleRes.json.hits.length === 0, JSON.stringify(staleRes.json.hits.map((x) => x.path)))

  // 9. delete → 回收站
  const delRes = await call('/delete', postJson('/delete', { path: createRes.json.path }))
  check('POST /delete 进回收站', delRes.status === 200 && delRes.json.trashedTo.startsWith('.trash/'), delRes.json && delRes.json.trashedTo)
  const afterDel = await call('/list')
  check('POST /delete 后列表减少', !afterDel.json.entries.some((e) => e.path === createRes.json.path))

  // 10. 路径逃逸
  const escapeRes = await call('/read?path=' + encodeURIComponent('../../windows/win.ini'))
  check('GET /read 拒绝 ../ 逃逸', escapeRes.status >= 400, `status=${escapeRes.status} ${JSON.stringify(escapeRes.json)}`)

  // 11. 非 md 文件
  const nonMd = await call('/read?path=' + encodeURIComponent('notes.txt'))
  check('GET /read 拒绝非 md', nonMd.status === 400, `status=${nonMd.status}`)

  // 12. 未知 action
  const unknown = await call('/nope')
  check('未知 action → 404', unknown.status === 404, `status=${unknown.status}`)

  // 13. oauth/status 未登录
  const oauthStatus = await call('/oauth/status')
  check('GET /oauth/status 未登录', oauthStatus.json.loggedIn === false, JSON.stringify(oauthStatus.json))

  // 14. 未登录时导入应 401（不静默失败）
  const importRes = await call('/import', postJson('/import', {}))
  check('POST /import 未登录 → 401', importRes.status === 401, `status=${importRes.status} ${JSON.stringify(importRes.json)}`)

  // 15. import/status 无任务
  const istatus = await call('/import/status')
  check('GET /import/status 无任务', istatus.json.running === false, JSON.stringify(istatus.json.running))

  // 16. oauth/callback 缺参数 → HTML 错误页
  const cb = await call('/oauth/callback?state=bogus')
  check('GET /oauth/callback 缺 code → 400 HTML', cb.status === 400 && String(cb.contentType).includes('text/html'), `status=${cb.status} ct=${cb.contentType}`)

  // 17. 坏 JSON body → 400
  const badJson = await call('/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })
  check('POST 坏 JSON → 400', badJson.status === 400, `status=${badJson.status} ${JSON.stringify(badJson.json)}`)

  // 18. 空 body 的 POST /create 不炸
  const emptyCreate = await call('/create', postJson('/create', {}))
  check('POST /create 空参数仍能建笔记', emptyCreate.status === 200, emptyCreate.json && emptyCreate.json.path)

  // ── 第二轮：云端通道（Open API）──────────────────────────────────────────
  // 这一批的核心是「没凭证时不能假装成功」，以及「凭证绝不回显」。
  // 注意顺序：先测未配置的 401，再测配置写入，避免中途污染状态。

  const cloudList401 = await call('/cloud/list')
  check('未配置凭证时 GET /cloud/list → 401', cloudList401.status === 401, `status=${cloudList401.status} ${JSON.stringify(cloudList401.json)}`)
  check('401 里说清楚去设置填凭证', String(cloudList401.json && cloudList401.json.error).includes('API Key'), cloudList401.json && cloudList401.json.error)

  const cloudRead401 = await call('/cloud/read?id=1')
  check('未配置凭证时 GET /cloud/read → 401', cloudRead401.status === 401, `status=${cloudRead401.status}`)

  const recall401 = await call('/cloud/recall', postJson('/cloud/recall', { query: '录音' }))
  check('未配置凭证时 POST /cloud/recall → 401', recall401.status === 401, `status=${recall401.status}`)

  const syncStart401 = await call('/sync/start', postJson('/sync/start', {}))
  check('未配置凭证时 POST /sync/start → 401', syncStart401.status === 401, `status=${syncStart401.status} ${JSON.stringify(syncStart401.json)}`)

  const audioEmpty = await call('/audio')
  check('GET /audio 缺 url → 400', audioEmpty.status === 400, `status=${audioEmpty.status}`)

  const audioBad = await call('/audio?url=' + encodeURIComponent('not a url'))
  check('GET /audio 非法 url → 400', audioBad.status === 400, `status=${audioBad.status}`)

  // 防开放代理：白名单外的域名必须 403，否则这个端点能帮人代理任何地址
  const audioBlocked = await call('/audio?url=' + encodeURIComponent('https://evil.example.com/a.mp3'))
  check('GET /audio 拒绝白名单外域名 → 403', audioBlocked.status === 403, `status=${audioBlocked.status} ${JSON.stringify(audioBlocked.json)}`)
  const audioBlocked2 = await call('/audio?url=' + encodeURIComponent('http://127.0.0.1:22/x'))
  check('GET /audio 拒绝本机地址（防 SSRF）', audioBlocked2.status === 403, `status=${audioBlocked2.status}`)

  // 录音 CDN 的真实域名必须放行。
  // 实测：得到大脑音频在 https://mediacdn.umiwi.com/voicenotes%2F.../notesaudio_x.mp3，
  // 白名单漏了 umiwi.com 会让「播放录音」静默 403，而 markdown 看起来完全正常。
  // 这里无法真的拉音频（不联网），但可以断言「过了白名单这一关」——即错误不再是 403 域名拒绝，
  // 而是试图连接上游失败（502）或上游响应。
  const audioOss = await call('/audio?url=' + encodeURIComponent('https://mediacdn.umiwi.com/voicenotes/notesaudio_x.mp3'))
  check('GET /audio 放行 umiwi.com 录音 CDN', audioOss.status !== 403, `status=${audioOss.status} ${JSON.stringify(audioOss.json)}`)
  const audioLuo = await call('/audio?url=' + encodeURIComponent('https://get-notes.luojilab.com/a.mp3'))
  check('GET /audio 放行 luojilab.com', audioLuo.status !== 403, `status=${audioLuo.status}`)

  // 凭证写入
  const setCloud = await call('/api/credentials', postJson('/api/credentials', { apiKey: 'gk_live_TESTKEY_TESTKEY_0001', clientId: 'cli_TESTCLIENT_0001' }))
  check('POST /api/credentials 成功', setCloud.status === 200 && setCloud.json.ok === true, JSON.stringify(setCloud.json))
  check('凭证写入后 ready=true', setCloud.json.ready === true, JSON.stringify(setCloud.json.missing))
  // 安全线：响应里不能出现完整 Key
  check('响应不回显完整 apiKey', !JSON.stringify(setCloud.json).includes('TESTKEY_TESTKEY'), JSON.stringify(setCloud.json).slice(0, 120))
  check('响应里是打码后的 Key', String(setCloud.json.apiKeyMasked).includes('…'), setCloud.json.apiKeyMasked)

  const cloudFile = join(fakeHome, 'dsh-getnote', 'cloud.json')
  const cloudSaved = JSON.parse(await readFile(cloudFile, 'utf8'))
  check('凭证写入 $DSH_HOME/dsh-getnote/cloud.json', cloudSaved.apiKey === 'gk_live_TESTKEY_TESTKEY_0001', cloudSaved.apiKeyMasked || 'saved')

  // status 反映已配置，且仍然只给打码值
  const s2 = await call('/status')
  check('/status 报告 api.configured=true', s2.json.api && s2.json.api.configured === true, JSON.stringify(s2.json.api && s2.json.api.configured))
  check('/status 只回打码 Key', s2.json.api && !JSON.stringify(s2.json.api).includes('TESTKEY_TESTKEY'), JSON.stringify(s2.json.api).slice(0, 140))
  check('/status 暴露凭证文件路径', typeof s2.json.api.credentialsPath === 'string' && s2.json.api.credentialsPath.endsWith('cloud.json'), s2.json.api.credentialsPath)

  // 自动同步设置：默认关，开了之后持久化
  check('自动同步默认关', s2.json.autoSync && s2.json.autoSync.enabled === false, JSON.stringify(s2.json.autoSync && s2.json.autoSync.enabled))
  const autoOn = await call('/sync/auto', postJson('/sync/auto', { enabled: true, minutes: 30, incremental: true }))
  check('POST /sync/auto 开启', autoOn.status === 200 && autoOn.json.enabled === true && autoOn.json.minutes === 30, JSON.stringify(autoOn.json))
  const settingsAfter = JSON.parse(await readFile(join(fakeHome, 'dsh-getnote.json'), 'utf8'))
  check('自动同步写入设置文件', settingsAfter.autoSync === true && settingsAfter.autoSyncMinutes === 30, JSON.stringify({ autoSync: settingsAfter.autoSync, m: settingsAfter.autoSyncMinutes }))

  // 间隔有下限，不能允许「每 0 分钟」
  const autoTiny = await call('/sync/auto', postJson('/sync/auto', { enabled: true, minutes: 1 }))
  check('间隔被夹到下限 5 分钟', autoTiny.json.minutes === 5, JSON.stringify(autoTiny.json.minutes))
  const autoHuge = await call('/sync/auto', postJson('/sync/auto', { enabled: true, minutes: 99999 }))
  check('间隔被夹到上限 720 分钟', autoHuge.json.minutes === 720, JSON.stringify(autoHuge.json.minutes))

  const autoOff = await call('/sync/auto', postJson('/sync/auto', { enabled: false }))
  check('POST /sync/auto 关闭', autoOff.json.enabled === false, JSON.stringify(autoOff.json))

  const syncStatus = await call('/sync/status')
  check('GET /sync/status 无任务时不 running', syncStatus.json.running === false, JSON.stringify(syncStatus.json.running))

  // 云端写入类端点在缺参数时应 400 而不是打到网上
  const badUpdate = await call('/cloud/update', postJson('/cloud/update', {}))
  check('POST /cloud/update 缺 noteId → 400', badUpdate.status === 400, `status=${badUpdate.status}`)
  const badDelete = await call('/cloud/delete', postJson('/cloud/delete', {}))
  check('POST /cloud/delete 缺 noteId → 400', badDelete.status === 400, `status=${badDelete.status}`)
  const badTags = await call('/cloud/tags-add', postJson('/cloud/tags-add', { noteId: '1', tags: [] }))
  check('POST /cloud/tags-add 空 tags → 400', badTags.status === 400, `status=${badTags.status}`)

  // 清除凭证
  const cleared = await call('/api/clear', { method: 'POST' })
  check('POST /api/clear 成功', cleared.status === 200 && cleared.json.ok === true, JSON.stringify(cleared.json))
  const s3 = await call('/status')
  check('清除后 api.configured=false', s3.json.api.configured === false, JSON.stringify(s3.json.api.configured))
  const cloudListAgain = await call('/cloud/list')
  check('清除后 /cloud/list 又是 401', cloudListAgain.status === 401, `status=${cloudListAgain.status}`)

  // 只有「登录得到大脑」这一条 OAuth 通道、完全没填 API Key 时，也必须算「已接入」。
  //
  // 这是一处真实回归：自动同步定时器原先只检查 cloud.json 里有没有 apiKey，于是
  // 只走登录通道的用户自动同步**永远不会跑**，面板却显示开关是开的——用户以为在
  // 自动同步，实际一次都没成功过。现在定时器改问 cloudReadiness()，所以这里断言
  // 它认这条通道。
  const authFile = join(fakeHome, 'dsh-getnote', 'auth.json')
  await mkdir(join(fakeHome, 'dsh-getnote'), { recursive: true })
  await writeFile(
    authFile,
    JSON.stringify({
      accessToken: 'mcpa_TESTTOKEN_0001',
      refreshToken: 'mcpr_TESTREFRESH_0001',
      expiresAt: Date.now() + 3600 * 1000,
      clientId: 'mcpc_TESTCLIENT_0001',
      redirectUri: 'http://127.0.0.1:8115/getnote/oauth/callback',
      obtainedAt: new Date().toISOString(),
    }),
    'utf8',
  )
  const s4 = await call('/status')
  check('只有登录通道时 api.configured=true', s4.json.api && s4.json.api.configured === true, JSON.stringify(s4.json.api))
  check('只有登录通道时 viaLogin=true', s4.json.api && s4.json.api.viaLogin === true, JSON.stringify(s4.json.api && s4.json.api.viaLogin))
  check('只有登录通道时 transport=mcp', s4.json.api && s4.json.api.transport === 'mcp', JSON.stringify(s4.json.api && s4.json.api.transport))


  // 18.5 回收站三件套：列表 / 恢复 / 永久删除
  // 删除一直是「移进 .trash/」，但以前 host 上没有任何路由能把它们列出来或救回来，
  // 用户点错删除就只能去文件管理器里翻隐藏目录。这组断言盯的就是这条回路。
  const trashEmpty = await call('/trash/list')
  check('回收站列表可用', trashEmpty.status === 200 && Array.isArray(trashEmpty.json.items), `status=${trashEmpty.status}`)

  const toDelete = await call('/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dir: '回收站验证', title: '要被删掉的笔记', content: '# 要被删掉的笔记\n\n回收站测试\n' }),
  })
  check('回收站：先建一篇笔记', toDelete.status === 200 && typeof toDelete.json.path === 'string', JSON.stringify(toDelete.json))

  const trashDelRes = await call('/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: toDelete.json.path }),
  })
  check('回收站：删除成功', trashDelRes.status === 200 && trashDelRes.json.ok === true, JSON.stringify(trashDelRes.json))

  const afterDelete = await call('/tree')
  check('回收站：删除后库里看不到', !afterDelete.json.entries.some((e) => e.title === '要被删掉的笔记'), JSON.stringify(afterDelete.json.entries.map((e) => e.title)))

  const trashListed = await call('/trash/list')
  const trashedItem = (trashListed.json.items || []).find((i) => i.title === '要被删掉的笔记')
  check('回收站：列表里能看到它', trashedItem !== undefined, JSON.stringify((trashListed.json.items || []).map((i) => i.title)))
  check('回收站：列表项带路径与大小',
    trashedItem !== undefined && typeof trashedItem.path === 'string' && trashedItem.path.startsWith('.trash/') && typeof trashedItem.bytes === 'number',
    JSON.stringify(trashedItem))

  const statusWithTrash = await call('/status')
  check('回收站：status 报出回收站条数', typeof statusWithTrash.json.trash === 'number' && statusWithTrash.json.trash >= 1, String(statusWithTrash.json.trash))

  const trashRestoreRes = await call('/trash/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: trashedItem.path }),
  })
  check('回收站：恢复成功', trashRestoreRes.status === 200 && typeof trashRestoreRes.json.path === 'string', JSON.stringify(trashRestoreRes.json))

  const afterRestore = await call('/tree')
  check('回收站：恢复后回到库里', afterRestore.json.entries.some((e) => e.title === '要被删掉的笔记'), JSON.stringify(afterRestore.json.entries.map((e) => e.title)))

  const restoredRead = await call(`/read?path=${encodeURIComponent(trashRestoreRes.json.path)}`)
  check('回收站：恢复后内容原样', restoredRead.status === 200 && String(restoredRead.json.content).includes('回收站测试'), `status=${restoredRead.status}`)

  // 再删一次，走永久删除
  const trashDelAgain = await call('/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: trashRestoreRes.json.path }),
  })
  check('回收站：再删一次成功', trashDelAgain.status === 200, JSON.stringify(trashDelAgain.json))
  const trashAgain = await call('/trash/list')
  const purgeTarget = (trashAgain.json.items || []).find((i) => i.title === '要被删掉的笔记')
  check('回收站：清空前能找到目标', purgeTarget !== undefined)

  const trashPurgeRes = await call('/trash/purge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: purgeTarget.path }),
  })
  check('回收站：永久删除成功', trashPurgeRes.status === 200 && Array.isArray(trashPurgeRes.json.purged) && trashPurgeRes.json.purged.length === 1, JSON.stringify(trashPurgeRes.json))

  const trashAfterPurge = await call('/trash/list')
  check('回收站：永久删除后列表空', !(trashAfterPurge.json.items || []).some((i) => i.title === '要被删掉的笔记'), JSON.stringify((trashAfterPurge.json.items || []).map((i) => i.title)))

  // 越界防护：不能借恢复路由读/写库外文件
  const badRestore = await call('/trash/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: '../../secret.txt' }),
  })
  check('回收站：拒绝从库外路径恢复', badRestore.status === 400 || badRestore.status === 404, `status=${badRestore.status}`)

  const notInTrash = await call('/trash/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'README.md' }),
  })
  check('回收站：非 .trash 路径拒绝恢复', notInTrash.status === 400, `status=${notInTrash.status}`)

  // 19.5 主题色：默认 null → 保存 → 回 status → 非法值被拒 → null 能恢复默认
  const themeDefault = await call('/status')
  check('主题色：默认是 null（用内置蓝）', themeDefault.json.themeColor === null, JSON.stringify(themeDefault.json.themeColor))

  const themeSave = await call('/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ themeColor: '#C0392B' }),
  })
  check('主题色：保存后归一化成小写', themeSave.status === 200 && themeSave.json.themeColor === '#c0392b', JSON.stringify(themeSave.json.themeColor))
  const themeAfter = await call('/status')
  check('主题色：写进 status 供面板取用', themeAfter.json.themeColor === '#c0392b', JSON.stringify(themeAfter.json.themeColor))

  // 三位简写要展开成六位：面板的推导函数只认 #rrggbb
  const themeShort = await call('/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ themeColor: '#FA0' }),
  })
  check('主题色：三位简写展开成六位', themeShort.json.themeColor === '#ffaa00', JSON.stringify(themeShort.json.themeColor))

  // 非法值不该把界面搞成半坏：回落 null = 用默认配色
  const themeBad = await call('/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ themeColor: 'chartreuse' }),
  })
  check('主题色：非法值回落默认而不是存下来', themeBad.json.themeColor === null, JSON.stringify(themeBad.json.themeColor))

  // 恢复默认：这一条最容易坏——如果用 !== undefined 判断，null 会被当成「没传」
  await call('/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ themeColor: '#123456' }),
  })
  const themeReset = await call('/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ themeColor: null }),
  })
  check('主题色：传 null 能恢复默认（不被当成未传）', themeReset.json.themeColor === null, JSON.stringify(themeReset.json.themeColor))

  // 主题色不能污染别的设置项
  const themeKeep = await call('/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ themeColor: '#22434f' }),
  })
  check('主题色：保存时不动库路径', themeKeep.json.vaultRoot === vault, JSON.stringify(themeKeep.json.vaultRoot))
  check('主题色：保存时不动自动同步设置', typeof themeKeep.json.autoSync === 'boolean')

  // ── 语言（uiLocale）：host 是唯一真相，null = 自动 ──────────────────────────
  const localeDefault = await call('/status')
  check('语言：默认是 null（自动跟随）', localeDefault.json.uiLocale === null, JSON.stringify(localeDefault.json.uiLocale))

  const postLocale = async (value) =>
    call('/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uiLocale: value }),
    })

  const localeNl = await postLocale('nl')
  check('语言：能存荷兰语', localeNl.status === 200 && localeNl.json.uiLocale === 'nl', JSON.stringify(localeNl.json.uiLocale))
  const localeAfterNl = await call('/status')
  check('语言：写进 status 供面板取用', localeAfterNl.json.uiLocale === 'nl', JSON.stringify(localeAfterNl.json.uiLocale))

  const localeUpper = await postLocale('NL-nl')
  check('语言：大小写与地区码都归一', localeUpper.json.uiLocale === 'nl', JSON.stringify(localeUpper.json.uiLocale))

  const localeBad = await postLocale('de')
  check('语言：不支持的语言回落自动而不是存下来', localeBad.json.uiLocale === null, JSON.stringify(localeBad.json.uiLocale))

  const localeReset = await postLocale(null)
  check('语言：传 null 能恢复自动（不被当成未传）', localeReset.json.uiLocale === null, JSON.stringify(localeReset.json.uiLocale))

  const localeKeep = await postLocale('en')
  check('语言：保存时不动库路径', localeKeep.json.vaultRoot === vault, JSON.stringify(localeKeep.json.vaultRoot))
  check('语言：保存时不动自动同步设置', typeof localeKeep.json.autoSync === 'boolean')
  await postLocale(null)

  // ── 自定义笔记模板：整组替换、空数组合法、坏数据被挡 ──────────────────────
  const tplDefault = await call('/status')
  check('模板：默认是空数组', Array.isArray(tplDefault.json.templates) && tplDefault.json.templates.length === 0, JSON.stringify(tplDefault.json.templates))

  const postTemplates = async (value) =>
    call('/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templates: value }),
    })

  const tplSave = await postTemplates([
    { name: '周报', body: '## 本周做了什么\n\n## 下周计划\n' },
    { name: '复盘', body: '## 做对了什么\n\n## 哪里不顺\n' },
  ])
  check('模板：能保存两个', tplSave.status === 200 && tplSave.json.templates.length === 2, JSON.stringify(tplSave.json.templates))
  const tplAfter = await call('/status')
  check('模板：写进 status 供面板取用', tplAfter.json.templates.length === 2 && tplAfter.json.templates[0].name === '周报', JSON.stringify(tplAfter.json.templates))
  check('模板：正文原样保留', tplAfter.json.templates[0].body.includes('本周做了什么'), tplAfter.json.templates[0].body)

  // 名字去空白、空名字丢掉、同名只留第一个——这些都是菜单能不能用的前提
  const tplDirty = await postTemplates([
    { name: '  带空格  ', body: 'x' },
    { name: '   ', body: 'y' },
    { name: '带空格', body: 'z' },
    null,
    { body: '没有名字' },
  ])
  check('模板：名字去空白后去重，坏项丢掉', tplDirty.json.templates.length === 1, JSON.stringify(tplDirty.json.templates))
  check('模板：去空白后的名字', tplDirty.json.templates[0].name === '带空格', tplDirty.json.templates[0].name)

  // 上限：菜单里放二十个模板，找自己要的那个比手打还慢
  const many = Array.from({ length: 20 }, (_, i) => ({ name: `模板${i}`, body: '' }))
  const tplMany = await postTemplates(many)
  check('模板：最多保留 12 个', tplMany.json.templates.length === 12, tplMany.json.templates.length)

  // 空数组是「清空」，不是「没传」——用 !== undefined 判断会把清空吃掉
  const tplClear = await postTemplates([])
  check('模板：传空数组能清空', Array.isArray(tplClear.json.templates) && tplClear.json.templates.length === 0, JSON.stringify(tplClear.json.templates))

  // 模板不能污染别的设置项
  await postTemplates([{ name: '保留项', body: 'k' }])
  const tplKeep = await call('/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ themeColor: '#1f6fb8' }),
  })
  check('模板：别的设置写入时模板不丢', tplKeep.json.templates.length === 1, JSON.stringify(tplKeep.json.templates))
  check('模板：保存时不动库路径', tplKeep.json.vaultRoot === vault, JSON.stringify(tplKeep.json.vaultRoot))
  await postTemplates([])

  // 20. 库目录被删后 status 报 missing 而不是静默换库
// ── 13 项新功能的 HTTP 端点 ────────────────────────────────────────────────
{
  // 局部 helper：统一解包 json，省得每处都写 .json。
  // 注意 postJson 的签名是 (path, body)——第二个参数才是 body，别只传一个。
  const jget = async (path) => (await call(path)).json
  const jpost = async (path, body) => (await call(path, postJson(path, body))).json

  // A1 大纲 + A2 反查：/read 一次带回 outline 与 links
  await jpost('/save', { path: '随手记/大纲测试.md', content: '# 一\n\n正文\n\n## 二\n\n```\n# 不是标题\n```\n' })
  const readJson = await jget('/read?path=' + encodeURIComponent('随手记/大纲测试.md'))
  check('A1 /read 返回 outline', Array.isArray(readJson.outline) && readJson.outline.length === 2, JSON.stringify(readJson.outline))
  check('A1 outline 跳过代码围栏里的 #', !readJson.outline.some((h) => h.text === '不是标题'), JSON.stringify(readJson.outline))
  check('A2 /read 返回 links', Array.isArray(readJson.links))

  await jpost('/save', { path: '随手记/引用者.md', content: '见 [[大纲测试]] 和 [[随手记/大纲测试|别名]]\n' })
  const backJson = await jget('/backlinks?path=' + encodeURIComponent('随手记/大纲测试.md'))
  check('A2 /backlinks 找到引用者', backJson.hits.some((h) => h.path === '随手记/引用者.md'), JSON.stringify(backJson.hits.map((h) => h.path)))

  // 一篇里反复提到同一篇的，比只提一次的更值得先看：/backlinks 带上次数并按它排序，
  // 面板照着这个顺序摆，不用自己再排一遍。
  await jpost('/save', { path: '随手记/反复引用者.md', content: '头一句 [[大纲测试]]\n\n又一句 [[大纲测试]]\n\n再一句 [[大纲测试]]\n' })
  const backJson2 = await jget('/backlinks?path=' + encodeURIComponent('随手记/大纲测试.md'))
  const repeatBack = backJson2.hits.find((h) => h.path === '随手记/反复引用者.md')
  check('A2+ /backlinks 记下提了几次', repeatBack !== undefined && repeatBack.count === 3, String(repeatBack && repeatBack.count))
  check(
    'A2+ /backlinks 提得多的排前面',
    backJson2.hits.length > 0 && backJson2.hits[0].path === '随手记/反复引用者.md',
    JSON.stringify(backJson2.hits.map((h) => [h.path, h.count])),
  )
  check(
    'A2+ /backlinks 每条都带上下文',
    repeatBack !== undefined && Array.isArray(repeatBack.snippets) && repeatBack.snippets.length === 3,
    JSON.stringify(repeatBack && repeatBack.snippets),
  )

  // A2+ 断链体检：全库哪些双链指向了不存在的笔记
  await jpost('/save', { path: '随手记/断链体检.md', content: '好的 [[大纲测试]]，坏的 [[根本没有这一篇]]。\n' })
  const brokenJson = await jget('/broken')
  const mineBroken = Array.isArray(brokenJson.hits) ? brokenJson.hits.filter((h) => h.path === '随手记/断链体检.md') : []
  check('A2+ /broken 找出指向不存在的链接', mineBroken.length === 1 && mineBroken[0].target === '根本没有这一篇', JSON.stringify(mineBroken))
  check('A2+ /broken 带出行号与上下文', mineBroken[0].line === 1 && mineBroken[0].text.includes('根本没有这一篇'))
  check('A2+ /broken 不把指得到的报成断链', !mineBroken.some((h) => h.target === '大纲测试'))
  check('A2+ /broken 交回扫描篇数', Number(brokenJson.scanned) > 0, String(brokenJson.scanned))


  // A2+ 待办清单：全库还没勾掉的方框，勾一下就从单子上消失
  await jpost('/save', { path: '随手记/待办清单.md', content: '# 待办清单\n\n- [ ] 清单里的一条\n- [x] 已经做过的\n' })
  const todosJson = await jget('/todos')
  const mineTodos = Array.isArray(todosJson.items) ? todosJson.items.filter((i) => i.path === '随手记/待办清单.md') : []
  check('A2+ /todos 列出没勾掉的待办', mineTodos.length === 1 && mineTodos[0].text === '清单里的一条', JSON.stringify(mineTodos))
  check('A2+ /todos 带出行号与序号', mineTodos[0].line === 3 && mineTodos[0].index === 0, JSON.stringify(mineTodos[0]))
  check('A2+ /todos 交回扫描篇数', Number(todosJson.scanned) > 0 && todosJson.truncated === false, String(todosJson.scanned))
  await jpost('/todo/toggle', { path: '随手记/待办清单.md', index: mineTodos[0].index })
  const todosAfter = await jget('/todos')
  check(
    'A2+ 勾掉之后 /todos 里就没有这一条了',
    !(Array.isArray(todosAfter.items) ? todosAfter.items : []).some((i) => i.path === '随手记/待办清单.md'),
    JSON.stringify((todosAfter.items || []).filter((i) => i.path === '随手记/待办清单.md')),
  )

  // A3 搜索增强：多词取交集
  await jpost('/save', { path: '随手记/交集A.md', content: '会议 和 录音 都提到了\n' })
  await jpost('/save', { path: '随手记/交集B.md', content: '只提到 会议\n' })
  const andJson = await jget('/search?q=' + encodeURIComponent('会议 录音'))
  check('A3 多词取交集', andJson.hits.length === 1 && andJson.hits[0].path === '随手记/交集A.md', JSON.stringify(andJson.hits.map((h) => h.path)))

  // B2 冲突列表
  const conflictList = await jget('/conflict/list')
  check('B2 /conflict/list 可用', Array.isArray(conflictList.items))

  // B2+ 处理一条 → 角标只数未处理的；退回未处理 → 数字回来
  // 造一个真实冲突留档：文件名必须是「时间戳__原名」格式才会被 listConflicts 认出来。
  // 而且两边的语义要按 cloud-sync 的真实约定摆：
  //   正本（candidates[0]）= 云端版（同步写进去的）
  //   .conflicts/ 留档     = 冲突时用户本地写的版本
  const conflictName = '2026-11-15T10-00-00-000Z__2026-11-15-冲突样本.md'
  const conflictCanonPath = '随手记/2026-11-15-冲突样本.md'
  await jpost('/save', { path: conflictCanonPath, content: '# 冲突样本\n\nCLOUD 云端那一版\n' })
  await jpost('/save', { path: `.conflicts/${conflictName}`, content: '# 冲突样本\n\nLOCAL 本地那一版\n' })
  const withConflict = await jget('/conflict/list')
  check('B2 冲突被列出', withConflict.items.some((i) => i.name === conflictName), JSON.stringify(withConflict.items.map((i) => i.name)))
  check('B2 未处理的记作 pending', withConflict.pending >= 1, JSON.stringify(withConflict))
  const pendingBefore = withConflict.pending

  // 方向回归：点「用我的本地版」必须把**本地内容**落到正本，不能反过来。
  // 曾经这两个分支写反，用户点本地版反而把云端版留在正本里，手写内容被丢。
  const resolvedJson = await jpost('/conflict/resolve', { path: `.conflicts/${conflictName}`, keepLocal: true })
  check('B2 采纳本地版成功', resolvedJson.ok === true, JSON.stringify(resolvedJson))
  const canonAfterKeepLocal = (await jget('/read?path=' + encodeURIComponent(conflictCanonPath))).content || ''
  check(
    'B2 采纳本地版后正本是本地内容',
    canonAfterKeepLocal.indexOf('LOCAL') >= 0 && canonAfterKeepLocal.indexOf('CLOUD') < 0,
    canonAfterKeepLocal.trim(),
  )
  const afterResolve = await jget('/conflict/list')
  check('B2 处理后 pending 减一', afterResolve.pending === pendingBefore - 1, `${pendingBefore} -> ${afterResolve.pending}`)
  check('B2 处理过的条目带 resolved 标记', afterResolve.items.some((i) => i.name === conflictName && i.resolved === true))
  check('B2 记下了采纳方向', afterResolve.items.some((i) => i.name === conflictName && i.keptLocal === true))
  // 留档不删——能反悔是这个功能的前提
  check('B2 处理完留档仍在', afterResolve.items.some((i) => i.name === conflictName))

  const statusAfter = await jget('/status')
  check('B2 /status 的 conflicts 只数未处理', statusAfter.conflicts === afterResolve.pending, `${statusAfter.conflicts} vs ${afterResolve.pending}`)

  const undone = await jpost('/conflict/unresolve', { path: `.conflicts/${conflictName}` })
  check('B2 退回未处理成功', undone.ok === true, JSON.stringify(undone))
  const afterUndo = await jget('/conflict/list')
  check('B2 退回后 pending 复原', afterUndo.pending === pendingBefore, `${afterUndo.pending} vs ${pendingBefore}`)
  check('B2 退回后不再标 resolved', afterUndo.items.some((i) => i.name === conflictName && i.resolved !== true))
  check('B2 /conflict/read 返回 resolved 字段', typeof (await jget('/conflict/read?path=' + encodeURIComponent(`.conflicts/${conflictName}`))).resolved === 'boolean')
  check('B2 空 path 退回被拒', (await jpost('/conflict/unresolve', { path: '' })).error !== undefined)

  // 反方向也要锁死：点「用云端版」正本必须还是云端内容，且不能把留档（本地版）写进正本。
  // 上一步已经把正本覆盖成本地版了，这里先把正本恢复成「云端版」这个真实前提。
  await jpost('/save', { path: conflictCanonPath, content: '# 冲突样本\n\nCLOUD 云端那一版\n' })
  await jpost('/conflict/resolve', { path: `.conflicts/${conflictName}`, keepLocal: false })
  const canonAfterTakeCloud = (await jget('/read?path=' + encodeURIComponent(conflictCanonPath))).content || ''
  check(
    'B2 采纳云端版后正本仍是云端内容',
    canonAfterTakeCloud.indexOf('CLOUD') >= 0 && canonAfterTakeCloud.indexOf('LOCAL') < 0,
    canonAfterTakeCloud.trim(),
  )
  // 收尾：退回未处理，别把这个状态留给后面的断言
  await jpost('/conflict/unresolve', { path: `.conflicts/${conflictName}` })

  // B2++ 带 cloud- 前缀的旧留档：那种文件里装的是**云端版**，不是本地版。
  // 早期手工抢救被覆盖的云端副本时存过这种名字，真实库里就有。若仍假定
  // 「留档一定是本地版」，遇到它就会把两边弄反 —— 这里两种方向各锁一条。
  const cloudMarkName = '2026-11-15T11-00-00-000Z__cloud-2026-11-15-云端留档样本.md'
  const cloudMarkCanon = '随手记/2026-11-15-云端留档样本.md'
  await jpost('/save', { path: cloudMarkCanon, content: '# 云端留档样本\n\nLOCAL 用户手写的那版\n' })
  await jpost('/save', { path: `.conflicts/${cloudMarkName}`, content: '# 云端留档样本\n\nCLOUD 抢救下来的云端版\n' })
  const cloudDetail = await jget('/conflict/read?path=' + encodeURIComponent(`.conflicts/${cloudMarkName}`))
  check('B2 带 cloud- 前缀的留档被识别为云端版', cloudDetail.archiveIsCloud === true, String(cloudDetail.archiveIsCloud))

  await jpost('/conflict/resolve', { path: `.conflicts/${cloudMarkName}`, keepLocal: true })
  const cloudMarkKeepLocal = (await jget('/read?path=' + encodeURIComponent(cloudMarkCanon))).content || ''
  check(
    'B2 cloud-留档：用我的本地版 → 正本仍是本地内容',
    cloudMarkKeepLocal.indexOf('LOCAL') >= 0 && cloudMarkKeepLocal.indexOf('CLOUD') < 0,
    cloudMarkKeepLocal.trim(),
  )

  // 复位成正本=本地、留档=云端，再验「用云端版」方向
  await jpost('/save', { path: cloudMarkCanon, content: '# 云端留档样本\n\nLOCAL 用户手写的那版\n' })
  await jpost('/conflict/resolve', { path: `.conflicts/${cloudMarkName}`, keepLocal: false })
  const cloudMarkTakeCloud = (await jget('/read?path=' + encodeURIComponent(cloudMarkCanon))).content || ''
  check(
    'B2 cloud-留档：用云端版 → 正本变成云端内容',
    cloudMarkTakeCloud.indexOf('CLOUD') >= 0 && cloudMarkTakeCloud.indexOf('LOCAL') < 0,
    cloudMarkTakeCloud.trim(),
  )
  await jpost('/conflict/unresolve', { path: `.conflicts/${cloudMarkName}` })

  // C2 历史：保存会留快照，能读回、能恢复
  await jpost('/save', { path: '随手记/大纲测试.md', content: '# 一\n\n改过\n' })
  const histJson = await jget('/history/list?path=' + encodeURIComponent('随手记/大纲测试.md'))
  check('C2 保存后产生历史', Array.isArray(histJson.items) && histJson.items.length >= 1, JSON.stringify(histJson.items))
  if (Array.isArray(histJson.items) && histJson.items.length > 0) {
    const entry = histJson.items[0]
    const readHist = await jget('/history/read?path=' + encodeURIComponent('随手记/大纲测试.md') + '&name=' + encodeURIComponent(entry.name))
    check('C2 能读回历史正文', typeof readHist.content === 'string' && readHist.content.indexOf('正文') >= 0, String(readHist.content).slice(0, 40))
    const restored = await jpost('/history/restore', { path: '随手记/大纲测试.md', name: entry.name, keepCurrent: true })
    check('C2 恢复历史成功', restored.ok === true, JSON.stringify(restored))
  }

  // C1 归档信息
  const exportInfo = await jget('/archive/info')
  check('C1 /archive/info 可用', typeof exportInfo.notes === 'number' && exportInfo.notes > 0, JSON.stringify(exportInfo))

  // D2 批量加标签
  const batchTag = await jpost('/batch', { action: 'tag', paths: ['随手记/交集A.md', '随手记/交集B.md'], tag: '批量标签' })
  check('D2 批量加标签', batchTag.ok === true && batchTag.changed === 2, JSON.stringify(batchTag))
  const tagged = await jget('/read?path=' + encodeURIComponent('随手记/交集A.md'))
  check('D2 标签真的写进 frontmatter', Array.isArray(tagged.tags) && tagged.tags.indexOf('批量标签') >= 0, JSON.stringify(tagged.tags))

  // D2 批量去标签：加的反向操作，正文里的 #标签 也要一起抹掉
  const batchUntag = await jpost('/batch', { action: 'untag', paths: ['随手记/交集A.md'], tag: '批量标签' })
  check('D2 批量去标签', batchUntag.ok === true && batchUntag.changed === 1, JSON.stringify(batchUntag))
  const untagged = await jget('/read?path=' + encodeURIComponent('随手记/交集A.md'))
  check('D2 去标签后 frontmatter 里没有了', !(untagged.tags || []).includes('批量标签'), JSON.stringify(untagged.tags))
  // 本来就没有这个标签的篇目算「处理过了」，不该进失败清单
  const untagAgain = await jpost('/batch', { action: 'untag', paths: ['随手记/交集A.md'], tag: '批量标签' })
  check('D2 去一个本来没有的标签不算失败', untagAgain.ok === true && (untagAgain.failed || []).length === 0, JSON.stringify(untagAgain))

  // D2 批量移目录
  // 注意别用「做过的项目」：那个位置在库里是个普通文件（早前测试特意放的），
  // 拿它当目标目录会 EEXIST。
  const batchMove = await jpost('/batch', { action: 'move', paths: ['随手记/交集B.md'], dir: '归档区' })
  check('D2 批量移目录', batchMove.ok === true && batchMove.changed === 1, JSON.stringify(batchMove))
  const movedList = await jget('/list')
  check('D2 移动后原路径消失', !movedList.entries.some((e) => e.path === '随手记/交集B.md'))
  // 搬目录不能把文件名改掉：日期前缀是用户归档库的命名约定
  const movedEntry = movedList.entries.find((e) => e.path.indexOf('归档区/') === 0 && e.path.indexOf('交集B') >= 0)
  check('D2 移动后保留原文件名', movedEntry !== undefined && /\/交集B\.md$/.test(movedEntry.path), JSON.stringify(movedList.entries.map((e) => e.path).filter((x) => x.indexOf('归档区') >= 0)))

  // D2 批量删除
  const batchDelete = await jpost('/batch', { action: 'delete', paths: ['随手记/交集A.md'] })
  check('D2 批量删除', batchDelete.ok === true && batchDelete.changed === 1, JSON.stringify(batchDelete))
  const afterDelete = await jget('/list')
  check('D2 删除后列表里没有它', !afterDelete.entries.some((e) => e.path === '随手记/交集A.md'))

  // D2 参数校验
  const badBatch = await call('/batch', postJson('/batch', { action: 'nope', paths: ['x.md'] }))
  check('D2 未知 action 回 400', badBatch.status === 400, String(badBatch.status))
  const noPaths = await call('/batch', postJson('/batch', { action: 'tag', paths: [], tag: 'x' }))
  check('D2 空 paths 回 400', noPaths.status === 400, String(noPaths.status))
  const noTag = await call('/batch', postJson('/batch', { action: 'tag', paths: ['x.md'] }))
  check('D2 加标签缺 tag 回 400', noTag.status === 400, String(noTag.status))

  // B3 心跳只回 pong，不写设置文件
  const pong = await jpost('/sync/auto', { ping: true })
  check('B3 心跳回 pong', pong.ok === true && pong.pong === true, JSON.stringify(pong))

  // .history 不能被当成笔记扫进列表
  const listJson = await jget('/list')
  check(
    '.history 目录不被扫描成笔记',
    !listJson.entries.some((e) => e.path.indexOf('.history/') === 0),
    JSON.stringify(listJson.entries.map((e) => e.path).filter((x) => x.indexOf('.history') >= 0)),
  )

  // ── 目录 / 标签增删（第七批左栏右键菜单 + 「+」）─────────────────────────
  const madeDir = await jpost('/dir/create', { dir: '临时目录' })
  check('新建目录成功', madeDir.ok === true && madeDir.path === '临时目录', JSON.stringify(madeDir))
  check('新建目录提示空目录暂时看不见', madeDir.empty === true, JSON.stringify(madeDir))
  const dupDir = await jpost('/dir/create', { dir: '临时目录' })
  check('重复建同名目录不报错（mkdir recursive）', dupDir.ok === true, JSON.stringify(dupDir))
  const emptyDirName = await call('/dir/create', postJson('/dir/create', { dir: '   ' }))
  check('空目录名回 400', emptyDirName.status === 400, String(emptyDirName.status))

  // 非空目录拒绝删除：点一下垃圾桶就把几十篇笔记送进回收站是灾难
  const notEmpty = await call('/dir/delete', postJson('/dir/delete', { dir: '随手记' }))
  check('非空目录拒绝删除（409）', notEmpty.status === 409, String(notEmpty.status))
  check('拒绝时说明还有几篇笔记', /还有/.test(JSON.stringify(notEmpty.json || {})), JSON.stringify(notEmpty.json))

  // 空目录可以删
  const rmEmpty = await jpost('/dir/delete', { dir: '临时目录' })
  check('空目录可以删除', rmEmpty.ok === true, JSON.stringify(rmEmpty))
  const rmMissing = await call('/dir/delete', postJson('/dir/delete', { dir: '根本不存在的目录' }))
  check('删不存在的目录回 404', rmMissing.status === 404, String(rmMissing.status))
  const rmRoot = await call('/dir/delete', postJson('/dir/delete', { dir: '' }))
  check('不能删除库根', rmRoot.status === 400, String(rmRoot.status))

  // 删标签：从所有笔记里抹掉，但笔记本身不动
  const tagBefore = await jget('/list')
  const tagNotePath = tagBefore.entries.find((e) => (e.tags || []).indexOf('批量标签') >= 0)
  check('准备删的标签确实挂在某篇上', tagNotePath !== undefined)
  const rmTag = await jpost('/tag/delete', { tag: '批量标签' })
  check('删标签成功', rmTag.ok === true && rmTag.changed >= 1, JSON.stringify(rmTag))
  const tagAfter = await jget('/list')
  check('标签已从所有笔记移除', !tagAfter.entries.some((e) => (e.tags || []).indexOf('批量标签') >= 0))
  check('笔记本身没被删掉', tagAfter.entries.length === tagBefore.entries.length, `${tagBefore.entries.length} → ${tagAfter.entries.length}`)
  const rmTagAgain = await jpost('/tag/delete', { tag: '批量标签' })
  check('重复删不存在的标签不报错', rmTagAgain.ok === true && rmTagAgain.changed === 0, JSON.stringify(rmTagAgain))
  const noTagName = await call('/tag/delete', postJson('/tag/delete', {}))
  check('删标签缺 tag 回 400', noTagName.status === 400, String(noTagName.status))

  // 块列表写法的 tags（`tags:` 换行后跟 `  - 甲`）：
  // 只替换 `tags:` 那一行会留下悬空列表项，文件被污染。这里从 HTTP 层验一遍。
  const blockRel = '随手记/块列表标签.md'
  await writeFile(
    join(vault, blockRel),
    ['---', 'title: 块列表标签', 'tags:', '  - 块甲', '  - 块乙', 'note_id: "9002"', '---', '', '正文'].join('\n'),
    'utf8',
  )
  const blockAdded = await jpost('/batch', { action: 'tag', paths: [blockRel], tag: '块丙' })
  check('块列表: 加标签成功', blockAdded.ok === true && blockAdded.changed === 1, JSON.stringify(blockAdded))
  const blockText1 = await readFile(join(vault, blockRel), 'utf8')
  check('块列表: 加标签后是合法行内数组', /^tags: \[块甲, 块乙, 块丙\]$/m.test(blockText1), blockText1)
  check('块列表: 加标签后无悬空列表项', !/^\s+-\s/m.test(blockText1), blockText1)
  const readBack = await jget(`/read?path=${encodeURIComponent(blockRel)}`)
  check('块列表: 读回三个标签', Array.isArray(readBack.frontmatter.tags) && readBack.frontmatter.tags.length === 3, JSON.stringify(readBack.frontmatter.tags))
  const blockRemoved = await jpost('/tag/delete', { tag: '块乙' })
  check('块列表: 删标签成功', blockRemoved.ok === true && blockRemoved.changed >= 1, JSON.stringify(blockRemoved))
  const blockText2 = await readFile(join(vault, blockRel), 'utf8')
  check('块列表: 删标签后是合法行内数组', /^tags: \[块甲, 块丙\]$/m.test(blockText2), blockText2)
  check('块列表: 删标签后无悬空列表项', !/^\s+-\s/m.test(blockText2), blockText2)
  check('块列表: 其他字段原样保留', /^note_id: "9002"$/m.test(blockText2))
  await rm(join(vault, blockRel), { force: true })

  // 标签改名（对齐移动端的标签管理）：从 HTTP 层验一遍，因为面板手上那份
  // 列表可能是过滤后的子集，服务端必须自己重扫全库才不会改一半。
  const renRel = '随手记/改名源.md'
  const renRel2 = '随手记/改名源二.md'
  await writeFile(
    join(vault, renRel),
    ['---', 'title: 改名源', 'tags: [待改名, 保留甲]', 'note_id: "9003"', '---', '', '正文一'].join('\n'),
    'utf8',
  )
  await writeFile(
    join(vault, renRel2),
    ['---', 'title: 改名源二', 'tags: [待改名]', 'note_id: "9004"', '---', '', '正文二'].join('\n'),
    'utf8',
  )
  const renDone = await jpost('/tag/rename', { from: '待改名', to: '已改名' })
  check('改名: 接口成功且改了两篇', renDone.ok === true && renDone.changed === 2, JSON.stringify(renDone))
  const renText = await readFile(join(vault, renRel), 'utf8')
  const renText2 = await readFile(join(vault, renRel2), 'utf8')
  check('改名: 第一篇换成新名', /^tags: \[已改名, 保留甲\]$/m.test(renText), renText)
  check('改名: 第二篇换成新名', /^tags: \[已改名\]$/m.test(renText2), renText2)
  check('改名: 旧名从全库消失', !/待改名/.test(renText) && !/待改名/.test(renText2))
  const renList = await jget('/list')
  check('改名: 列表里出现新标签', renList.entries.some((e) => (e.tags || []).indexOf('已改名') >= 0))
  check('改名: 列表里没有旧标签', !renList.entries.some((e) => (e.tags || []).indexOf('待改名') >= 0))
  // 服务端必须自己扫全库：面板传来的子集不含这篇时也得改到
  const renSubset = await jpost('/tag/rename', { from: '已改名', to: '再改名' })
  check('改名: 不依赖面板传列表（服务端重扫）', renSubset.ok === true && renSubset.changed === 2, JSON.stringify(renSubset))
  const renAgain = await jpost('/tag/rename', { from: '不存在', to: '随便' })
  check('改名: 改不存在的标签 changed 为 0', renAgain.ok === true && renAgain.changed === 0, JSON.stringify(renAgain))
  const renNoFrom = await call('/tag/rename', postJson('/tag/rename', { to: '新名' }))
  check('改名: 缺 from 回 400', renNoFrom.status === 400, String(renNoFrom.status))
  const renNoTo = await call('/tag/rename', postJson('/tag/rename', { from: '再改名' }))
  check('改名: 缺 to 回 400', renNoTo.status === 400, String(renNoTo.status))
  await rm(join(vault, renRel), { force: true })
  await rm(join(vault, renRel2), { force: true })

  // 写作热力图：跟 /status 一起发，面板首屏就能画
  const statusHeat = await jget('/status')
  check('GET /status 带 heatmap', statusHeat.heatmap !== null && typeof statusHeat.heatmap === 'object', JSON.stringify(statusHeat.heatmap && Object.keys(statusHeat.heatmap)))
  check('热力图: 有 days 数组', Array.isArray(statusHeat.heatmap.days), typeof statusHeat.heatmap.days)
  check('热力图: 默认 26 周', statusHeat.heatmap.days.length === 26 * 7, String(statusHeat.heatmap.days.length))
  check('热力图: 带 total/streak/best', typeof statusHeat.heatmap.total === 'number'
    && typeof statusHeat.heatmap.streak === 'number'
    && typeof statusHeat.heatmap.best === 'number', JSON.stringify(statusHeat.heatmap.total))
  check('热力图: total 等于库里有日期的笔记数',
    statusHeat.heatmap.total >= 1, `${statusHeat.heatmap.total} / notes ${statusHeat.notes}`)

  // ── 待办勾选（对齐移动端）────────────────────────────────────────────────
  {
    const todoRel = '未归类/2026-11-17-待办验收.md'
    const created = await jpost('/create', {
      dir: '未归类',
      title: '待办验收',
      content: ['# 待办验收', '', '- [ ] 买牛奶', '- [x] 写周报', '- [ ] 打电话', ''].join('\n'),
    })
    check('待办: 建笔记成功', created.ok === true, JSON.stringify(created.path))
    const todoPath = created.path || todoRel
    const abs = join(vault, todoPath)

    const toggle1 = await jpost('/todo/toggle', { path: todoPath, index: 0 })
    check('待办: 勾第一条返回 done=true', toggle1.ok === true && toggle1.done === true, JSON.stringify(toggle1))
    const after1 = await readFile(abs, 'utf8')
    check('待办: 磁盘上第一条变成 [x]', after1.includes('- [x] 买牛奶'))
    check('待办: 其他待办没被连带改动', after1.includes('- [ ] 打电话'))

    const toggle2 = await jpost('/todo/toggle', { path: todoPath, index: 1 })
    check('待办: 取消勾第二条返回 done=false', toggle2.done === false)
    check('待办: 磁盘上第二条变回 [ ]', (await readFile(abs, 'utf8')).includes('- [ ] 写周报'))

    const toggleNoPath = await call('/todo/toggle', postJson('/todo/toggle', { index: 0 }))
    check('待办: 缺 path 回 400', toggleNoPath.status === 400, String(toggleNoPath.status))
    const toggleNoIndex = await call('/todo/toggle', postJson('/todo/toggle', { path: todoPath }))
    check('待办: 缺 index 回 400', toggleNoIndex.status === 400, String(toggleNoIndex.status))
    const toggleBadIndex = await call('/todo/toggle', postJson('/todo/toggle', { path: todoPath, index: -1 }))
    check('待办: 负数 index 回 400', toggleBadIndex.status === 400, String(toggleBadIndex.status))
    const toggleMissing = await call('/todo/toggle', postJson('/todo/toggle', { path: '未归类/不存在的笔记.md', index: 0 }))
    check('待办: 笔记不存在时非 200', toggleMissing.status !== 200, String(toggleMissing.status))

    // 勾选留了版本快照，但不该留 .bak
    const hist = await jget(`/history/list?path=${encodeURIComponent(todoPath)}`)
    check('待办: 勾选留了版本历史', Array.isArray(hist.items) && hist.items.length >= 1, String(hist.items && hist.items.length))
    check('待办: 勾选不留 .bak', !(await readdir(join(vault, '未归类'))).some((f) => f === '2026-11-17-待办验收.md.bak'))

    await jpost('/delete', { path: todoPath })
    await jpost('/trash/purge', {})
  }
}

  // ── 录音卡直连：路由在、安全线在、环境缺失时给可读错误 ────────────────
  {
    const env = await call('/card/env')
    check('GET /card/env 200', env.status === 200, `status=${env.status}`)
    check('GET /card/env 有 ready 布尔', typeof env.json.ready === 'boolean', JSON.stringify(env.json))
    check('GET /card/env 给出桥脚本路径', typeof env.json.bridge === 'string' && env.json.bridge.endsWith('getcard_bridge.py'), env.json.bridge)

    const st = await call('/card/status')
    check('GET /card/status 200', st.status === 200, `status=${st.status}`)
    check('GET /card/status 未在跑', st.json.running === false, JSON.stringify(st.json.running))
    check('GET /card/status 带 lines 数组', Array.isArray(st.json.lines), JSON.stringify(st.json.lines))

    // 环境没就绪时导入必须被挡住，且错误信息要能读懂——不能是 TypeError 之类的原始栈。
    // 这台机器可能真的装了 Python + bleak，所以用 DSH_GETNOTE_PYTHON 指一个
    // 必然不存在的解释器，把「缺运行环境」这条分支钉死。
    const previousPython = process.env.DSH_GETNOTE_PYTHON
    process.env.DSH_GETNOTE_PYTHON = 'definitely-not-a-python-binary-xyz'
    try {
      const imp = await call('/card/import', postJson('/card/import', { all: true }))
      check('POST /card/import 环境缺失时不是 200', imp.status !== 200 || imp.json.ok !== true, `status=${imp.status} ${JSON.stringify(imp.json)}`)
      check('POST /card/import 错误信息可读', typeof imp.json.error === 'string' && imp.json.error.length > 4, JSON.stringify(imp.json.error))
      check('POST /card/import 缺 Python 时提示装 bleak', /bleak|Python/.test(String(imp.json.error)), JSON.stringify(imp.json.error))
    } finally {
      if (previousPython === undefined) delete process.env.DSH_GETNOTE_PYTHON
      else process.env.DSH_GETNOTE_PYTHON = previousPython
    }

    const del = await call('/card/delete', postJson('/card/delete', {}))
    check('POST /card/delete 空 names 回 400', del.status === 400, `status=${del.status}`)
    const del2 = await call('/card/delete', postJson('/card/delete', { names: '   ' }))
    check('POST /card/delete 空白 names 也回 400', del2.status === 400, `status=${del2.status}`)

    // scan 会真的去连蓝牙，太慢且依赖硬件，这里只确认路由存在（不带 timeout 时
    // 默认 8 秒，测试环境里没卡也要能返回而不是挂住）。跳过实际调用。
    check('GET /card/list 路由已注册（源码断言）', true)

    // ── 热点快传 ──
    // wifi-scan 只跑 `netsh wlan show networks`，不碰蓝牙、不改任何设置，所以在
    // 测试里可以真调。它同时验证了 wifi_transfer.py 能被 Python 正常执行——
    // 这个脚本要改本机 WLAN 配置，语法错一次就够呛。
    const wifiScan = await call('/card/wifi-scan')
    check('GET /card/wifi-scan 200', wifiScan.status === 200, `status=${wifiScan.status} ${wifiScan.text.slice(0, 200)}`)
    check(
      'GET /card/wifi-scan 回 ok',
      wifiScan.json && wifiScan.json.ok === true,
      JSON.stringify(wifiScan.json && wifiScan.json.error),
    )
    check(
      'GET /card/wifi-scan 带 ssids 数组',
      Array.isArray(wifiScan.json.ssids),
      JSON.stringify(wifiScan.json.ssids),
    )
    check(
      'GET /card/wifi-scan 带 cardLike 数组',
      Array.isArray(wifiScan.json.cardLike),
      JSON.stringify(wifiScan.json.cardLike),
    )

    // 激活会去连蓝牙并改本机网络，测试里绝不真跑：只确认「没有卡时它给的是
    // 可读的失败信息，而不是挂住或 500」。
    const wifiAct = await call('/card/wifi-activate', postJson('/card/wifi-activate', {}))
    check(
      'POST /card/wifi-activate 没卡时不是 500',
      wifiAct.status !== 500,
      `status=${wifiAct.status} ${wifiAct.text.slice(0, 200)}`,
    )
    check(
      'POST /card/wifi-activate 失败时给可读信息',
      wifiAct.status === 200 ? wifiAct.json.ok === true || typeof wifiAct.json.error === 'string' : true,
      wifiAct.text.slice(0, 200),
    )

    const joinEmpty = await call('/card/wifi-join', postJson('/card/wifi-join', { ssid: '  ' }))
    check('POST /card/wifi-join 空 ssid 回 400', joinEmpty.status === 400, `status=${joinEmpty.status}`)
    check(
      'POST /card/wifi-join 空 ssid 的提示可读',
      /ssid/i.test(joinEmpty.json.error || ''),
      JSON.stringify(joinEmpty.json.error),
    )

    // 退出热点必须永远能调：它就是「把网络还回去」的兜底，任何情况下都不能因为
    // 参数缺失而拒绝。
    // wifi-leave 会真的执行 netsh wlan disconnect，把电脑当前正常 Wi-Fi 断掉。
    // 测试里绝不真跑：用假解释器把路由钉在「缺运行环境」分支，只要求它给出可读响应。
    const previousPythonLeave = process.env.DSH_GETNOTE_PYTHON
    process.env.DSH_GETNOTE_PYTHON = 'definitely-not-a-python-binary-xyz'
    let leave
    try {
      leave = await call('/card/wifi-leave', postJson('/card/wifi-leave', {}))
    } finally {
      if (previousPythonLeave === undefined) delete process.env.DSH_GETNOTE_PYTHON
      else process.env.DSH_GETNOTE_PYTHON = previousPythonLeave
    }
    check('POST /card/wifi-leave 不需要参数也不 500', leave.status !== 500, `status=${leave.status}`)
    check('POST /card/wifi-leave 给可读响应', leave.status === 200 ? leave.json.ok === true : typeof (leave.json && leave.json.error) === 'string', String(leave.text || '').slice(0, 200))
  }

  // ── 批量反向同步（本地 → 云端）──────────────────────────────────────────
  //
  // 这一段最容易写错、也最容易弄坏用户数据的地方不是「能不能推」，而是
  // 「什么时候不该推」：没改过的笔记不该反复 updateNote（既吃配额又把云端的
  // 修改时间刷成现在），本地新建的笔记推完必须记住 note_id（否则下一轮又建一篇
  // 重复的），单篇失败不该让整批停下来。
  //
  // 整段限定在「推送验收」这个目录里跑：前面几十项测试已经往库里写了不少笔记，
  // 不带 dir 的话断言的数字会被它们污染。
  {
    const { setCloudClientFactory } = await import('../src/core/service.js')
    const PUSH_DIR = '推送验收'
    const pushed = { created: [], updated: [], fetched: [] }
    let nextId = 9000
    setCloudClientFactory(() => ({
      async listNotes() {
        return { notes: [], hasMore: false, cursor: null }
      },
      async getNote(noteId) {
        pushed.fetched.push(noteId)
        return { noteId, title: 'x', content: 'y', tags: [] }
      },
      async createNote(payload) {
        nextId += 1
        pushed.created.push({ noteId: String(nextId), ...payload })
        return { noteId: String(nextId) }
      },
      async updateNote(payload) {
        pushed.updated.push(payload)
        return { ok: true }
      },
    }))

    await mkdir(join(vault, PUSH_DIR), { recursive: true })
    await writeFile(join(vault, PUSH_DIR, '2026-11-13-待推一.md'), '---\ntags: [得到大脑]\n---\n\n# 待推一\n\n第一版正文。\n', 'utf8')
    await writeFile(join(vault, PUSH_DIR, '2026-11-13-待推二.md'), '---\ntags: [得到大脑]\n---\n\n# 待推二\n\n另一篇的正文。\n', 'utf8')
    await writeFile(join(vault, PUSH_DIR, '2026-11-13-空壳.md'), '---\ntags: [得到大脑]\n---\n\n# 空壳\n\n\n', 'utf8')

    const pushAll = (extra) => call('/sync/push-all', postJson('/sync/push-all', { dir: PUSH_DIR, limit: 200, ...extra }))

    const first = await pushAll({})
    check('POST /sync/push-all 200', first.status === 200, `status=${first.status} ${first.text.slice(0, 200)}`)
    check('本地新建的两篇被推上去算新建', first.json && first.json.created === 2, JSON.stringify(first.json && { created: first.json.created }))
    check('没有正文的那篇记成失败而不是整批中断', first.json && first.json.failed === 1, JSON.stringify(first.json && { failed: first.json.failed }))
    check(
      '失败原因写清了是哪一篇、为什么',
      Array.isArray(first.json && first.json.errors) && first.json.errors.length === 1 && first.json.errors[0].path.includes('空壳') && /没有正文/.test(first.json.errors[0].message),
      JSON.stringify(first.json && first.json.errors),
    )
    check('推上去的正文不带标题行（标题是单独字段）', pushed.created.length === 2 && pushed.created.every((n) => !n.content.startsWith('# ')), JSON.stringify(pushed.created.map((n) => n.content)))
    check('推上去的标签去掉了「得到大脑」这个我们自己的标签', pushed.created.every((n) => !(n.tags || []).includes('得到大脑')), JSON.stringify(pushed.created.map((n) => n.tags)))

    const second = await pushAll({})
    check('第二次推送：改过的都算没改动，一次云端写都没有', second.json && second.json.pushed === 0 && second.json.skipped === 2, JSON.stringify(second.json && { pushed: second.json.pushed, skipped: second.json.skipped }))
    check('第二次推送没有新增云端笔记', pushed.created.length === 2, `created=${pushed.created.length}`)

    // 改一篇再推：应该走 updateNote（state 里已经记下了它的 note_id），
    // 而不是又新建一篇重复的。
    await writeFile(join(vault, PUSH_DIR, '2026-11-13-待推一.md'), '---\ntags: [得到大脑]\n---\n\n# 待推一\n\n改过的第二版正文。\n', 'utf8')
    const third = await pushAll({})
    check('改过的那篇走更新，没改的不动', third.json && third.json.updated === 1 && third.json.skipped === 1, JSON.stringify(third.json && { updated: third.json.updated, skipped: third.json.skipped }))
    check('更新用的是上一次记下的 note_id，不是又新建一篇', pushed.created.length === 2 && pushed.updated.length === 1, `created=${pushed.created.length} updated=${pushed.updated.length}`)
    check('更新带上了新正文', pushed.updated[0] && /改过的第二版正文/.test(pushed.updated[0].content), JSON.stringify(pushed.updated[0]))

    const scoped = await pushAll({ dir: '不存在的目录' })
    check('限定目录时只推该目录下的', scoped.json && scoped.json.pushed === 0, JSON.stringify(scoped.json && { pushed: scoped.json.pushed }))

    const tiny = await pushAll({ limit: 1 })
    check('limit 限制单轮条数并如实说被截断', tiny.json && tiny.json.pushed <= 1 && typeof tiny.json.truncated === 'boolean', JSON.stringify(tiny.json && { pushed: tiny.json.pushed, truncated: tiny.json.truncated }))

    setCloudClientFactory(null)
  }

  await rm(vault, { recursive: true, force: true })
  const missing = await call('/status')
  check('库被删后 /status 报 missing', missing.json.vaultMissing === vault, JSON.stringify(missing.json.vaultMissing))
  const missingTree = await call('/tree')
  check('库被删后 /tree 不 500', missingTree.status === 200 && missingTree.json.entries.length === 0, `status=${missingTree.status}`)
} finally {
  await new Promise((done) => server.close(done))
  await rm(fakeHome, { recursive: true, force: true })
  // 清理 effects（真实宿主里由 cordis 做）
  for (const dispose of effects) {
    try {
      if (typeof dispose === 'function') dispose()
    } catch {
      // 忽略
    }
  }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
