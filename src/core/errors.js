/**
 * core 层错误的统一构造。
 *
 * 为什么要有这一层：vault.js / service.js 里原本散着一百多条中文错误串，
 * 直接 `throw Object.assign(new Error('中文…'), { status }) `。面板只能拿到
 * `message`，于是英文 / 荷兰文界面里照样冒中文；想翻译也无从下手——字符串
 * 是散在逻辑里的，没有任何稳定的标识。
 *
 * 这里的做法：给每条错误一个稳定的 `code`（如 'vault.pathEscapes'），
 * `message` 仍然保留中文（日志、离线测试、老代码读 message 都不受影响），
 * 同时挂上 `lexKey`（= 'err.' + code）与 `params`，面板据此去 LEX 取对应
 * 语言的文案。status 之类的附加字段照旧通过 extra 透传，HTTP 状态码语义不变。
 *
 * ERROR_TEMPLATES 与 src/view/lex.js 里三本字典的 'err.*' 键必须逐字对齐，
 * 这一点由 test/errors.test.mjs 钉死：少了哪个键、哪句中文漂了都会挂。
 */

/** code → 中文兜底文案模板（`{name}` 为占位符）。 */
export const ERROR_TEMPLATES = {
  'vault.pathEscapes': 'path escapes vault root',
  'vault.readMdOnly': '只能读取 .md 文件',
  'vault.notAFile': '不是文件',
  'vault.fileTooLarge': '文件过大',
  'vault.assetMdOnly': '只能给 .md 笔记存附件',
  'vault.emptyFile': '文件是空的',
  'vault.tooManyAssets': '同名附件过多',
  'vault.writeMdOnly': '只能写入 .md 文件',
  'vault.contentNotString': 'content 必须是字符串',
  'vault.contentTooLarge': '内容超过 2MB 上限',
  'vault.conflict': '这一篇在别处被改过了',
  'vault.tooManyNotes': '同名笔记过多',
  'vault.cannotRemoveRoot': '不能删除库根',
  'vault.restoreTrashOnly': '只能从 .trash 目录恢复',
  'vault.trashMissing': '回收站里没有这个文件',
  'vault.targetEmpty': '目标路径不能为空',
  'vault.emptyTrashOnly': '只能清空 .trash 里的文件',
  'vault.notConflictPath': '不是冲突留档路径',
  'vault.conflictNoLocal': '找不到这条冲突对应的正本笔记，取不到本地版内容；留档仍然保留，可以直接打开对照',
  'vault.conflictNoCloud': '这条留档里没有云端版正文，取不到云端版本；留档仍然保留，可以直接打开对照',
  'vault.dirNameEmpty': '目录名不能为空',
  'vault.dirReserved': '「{segment}」是插件保留的目录名，换一个',
  'vault.mkdirFailed': '建目录失败：{detail}',
  'vault.dirMissing': '这个目录不存在',
  'vault.dirNotEmptyNotes': '这个目录里还有 {notes} 篇笔记，先把它们移走再删目录',
  'vault.dirNotEmptyDirs': '这个目录里还有 {dirs} 个子目录，先清空再删',
  'vault.rmdirFailed': '删目录失败：{detail}',
  'vault.trashMoveFailed': '有 {failed} 篇没能移进回收站，目录先留着',
  'vault.renameRoot': '要改名的目录不能是库根',
  'vault.newDirNameEmpty': '新目录名不能为空',
  'vault.notADirectory': '这不是一个目录',
  'vault.dirExists': '「{path}」已经存在，换一个名字',
  'vault.renameDirFailed': '改目录名失败：{detail}',
  'vault.tagNameEmpty': '标签名不能为空',
  'vault.fromTagEmpty': '要改名的标签不能为空',
  'vault.newTagNameEmpty': '新标签名不能为空',
  'vault.fromLinkEmpty': '要改的链接名不能为空',
  'vault.toLinkEmpty': '要指到哪一篇不能为空',
  'vault.todoIndexInvalid': '待办序号不对',
  'vault.todoMissing': '这篇笔记里没有这一条待办',
  'service.bodyTooLarge': '请求内容过大',
  'service.badJson': '请求内容不是合法 JSON',
  'service.notLoggedIn': '尚未登录得到大脑（或授权已过期），先在面板里点「登录并导入」',
  'service.noCredentials':
    '还没有接入得到大脑。最省事的是去「同步」页点「登录得到大脑」（一次授权，之后自动同步）；也可以在「设置 → 云端接入」填 API Key 与 Client ID（在 openapi.biji.com 控制台创建）。',
  'service.vaultMissing': '本地库目录不存在：{path}',
  'service.needFromRename': '需要 from（原来指的那个名字）',
  'service.needPath': '需要 path',
  'service.needFromDir': '需要 from（原目录路径）',
  'service.needDir': '需要 dir',
  'service.needTag': '需要 tag',
  'service.needFromTag': '需要 from（原标签名）',
  'service.needPathNote': '需要 path（笔记路径）',
  'service.needIndex': '需要 index（第几个待办，从 0 开始）',
  'service.needPathName': '需要 path 与 name',
  'service.pathEmpty': 'path 不能为空',
  'service.unsupportedFileType': '不支持的文件类型',
  'service.fileNameEmpty': '文件名不能为空',
  'service.needPaths': '需要 paths',
  'service.badBatchAction': 'action 只能是 tag / untag / move / delete',
  'service.pathsEmpty': 'paths 不能为空',
  'service.needPathOrId': '需要 path 或 noteId',
  'service.noNoteId': '这篇笔记没有 note_id，无从刷新',
  'service.syncRunning': '正在跑一轮同步，等它结束再推',
  'service.noOrigin': '无法确定 DSH Web 的访问地址',
  'service.idEmpty': 'id 不能为空',
  'service.cloudNoteMissing': '云端没有这篇笔记（可能已被删除）',
  'service.noteIdEmpty': 'noteId 不能为空',
  'service.noteIdTagsEmpty': 'noteId 与 tags 都不能为空',
  'service.noteIdTagIdEmpty': 'noteId 与 tagId 都不能为空',
  'service.topicIdEmpty': 'topicId 不能为空',
  'service.queryEmpty': 'query 不能为空',
  'service.urlEmpty': 'url 不能为空',
  'service.urlInvalid': 'url 不是合法地址',
  'service.urlScheme': '只支持 http/https',
  'service.hostNotAllowed': '不允许代理这个域名：{host}',
  'service.vaultNotConfigured': '笔记库目录不存在，先去设置里选一个目录',
  'service.cardPythonMissing': '录音卡直连需要 Python 3.10+ 和 bleak。装一下：pip install bleak',
  'service.namesEmpty': '要删哪个文件？names 不能为空',
  'service.ssidEmpty': '要连哪个热点？ssid 不能为空',
  'service.importRunning': '已有一个导入任务在跑，等它结束再试',
  'service.syncRunningNow': '已经有一轮同步在跑了',
  'service.syncTooSoon': '距上次同步太近，跳过这一轮',
  'service.cardImportRunning': '已经有一个录音卡导入在跑了，等它结束再试',
}

/** 把 `{name}` 占位符替换成 params 里的值；缺值就原样留着，便于发现漏传。 */
export function fillErrorTemplate(template, params) {
  if (typeof template !== 'string') return ''
  if (params === null || typeof params !== 'object') return template
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, key) => {
    const value = params[key]
    return value === undefined || value === null ? whole : String(value)
  })
}

/**
 * 造一条带 code / lexKey / params 的错误。
 * `extra` 里的字段（status、conflict、reason…）原样挂上去，调用方写法与
 * `Object.assign(new Error(...), { status })` 时期完全一致。
 *
 * @param {string} code 错误码，形如 'vault.pathEscapes'
 * @param {object} [params] 模板占位符的取值
 * @param {object} [extra] 额外挂到 Error 上的字段（status、conflict、path…）
 * @returns {Error & {code: string, lexKey: string, params?: object}} 带码的错误
 */
export function coreError(code, params = {}, extra = {}) {
  const template = ERROR_TEMPLATES[code]
  const message = template === undefined ? String(code) : fillErrorTemplate(template, params)
  const error = /** @type {Error & {code: string, lexKey: string, params?: object}} */ (new Error(message))
  error.code = code
  error.lexKey = `err.${code}`
  if (params !== null && typeof params === 'object' && Object.keys(params).length > 0) {
    error.params = { ...params }
  }
  if (extra !== null && typeof extra === 'object') Object.assign(error, extra)
  return error
}
