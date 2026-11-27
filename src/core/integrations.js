/**
 * 与 Obsidian 其它视图的接线：Bases 视图模板、Canvas 画布。
 *
 * 这两样都只做「生成一份文件」——不依赖任何内部 API，坏掉了也只是少个便利功能，
 * 不会影响笔记本身。
 */

/** 生成一份 .base 文件的内容：按目录、按标签、按日期三种视图。 */
export function basesTemplate({ subfolder = '得到大脑' } = {}) {
  const dir = String(subfolder || '得到大脑').replace(/^\/+|\/+$/g, '') || '得到大脑'
  // Bases 的 YAML 结构：filters 用 and 组合，views 里每条是一个命名视图。
  // 缩进用两个空格——Bases 读的是 YAML，缩进错了它只会静默不显示任何东西。
  return [
    'filters:',
    '  and:',
    `    - file.inFolder("${dir}")`,
    'views:',
    '  - type: table',
    '    name: 全部',
    '    order:',
    '      - file.name',
    '      - note.date',
    '      - note.tags',
    '  - type: table',
    '    name: 按标签',
    '    groupBy:',
    '      property: note.tags',
    '      direction: ASC',
    '    order:',
    '      - file.name',
    '      - note.date',
    '  - type: table',
    '    name: 按日期',
    '    sort:',
    '      - property: note.date',
    '        direction: DESC',
    '    order:',
    '      - file.name',
    '      - note.date',
    '',
  ].join('\n')
}

/** 空画布：Obsidian 认的最小结构。 */
export function emptyCanvas() {
  return { nodes: [], edges: [] }
}

function randomId() {
  const bytes = new Uint8Array(8)
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : null
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') cryptoObj.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 往画布里加一个文件节点。
 *
 * 返回**新的**对象，不改传进来的那份：调用方可能还拿着旧引用去做对比，
 * 就地改会让「有没有变」的判断永远为假。
 *
 * @param {any} canvas 画布
 * @param {object} [options]
 * @param {string} [options.file] 库内相对路径
 * @param {number} [options.x]
 * @param {number} [options.y]
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @returns {object} 新的画布
 */
export function addFileNode(canvas, { file, x = 0, y = 0, width = 400, height = 400 } = {}) {
  const source = canvas && typeof canvas === 'object' ? canvas : emptyCanvas()
  const nodes = Array.isArray(source.nodes) ? source.nodes.slice() : []
  const edges = Array.isArray(source.edges) ? source.edges.slice() : []
  const path = String(file || '').replace(/^\/+/, '')
  if (path === '') throw Object.assign(new Error('画布节点需要一个文件路径'), { status: 400 })
  // 已经在画布上的不再加一遍：重复点命令不该越堆越多。
  const existing = nodes.find((node) => node && node.type === 'file' && node.file === path)
  if (existing) return { canvas: { nodes, edges }, added: false, id: existing.id }
  const id = randomId()
  nodes.push({ id, type: 'file', file: path, x, y, width, height })
  return { canvas: { nodes, edges }, added: true, id }
}

/** 解析画布 JSON；坏掉时给一张空画布，而不是抛错把命令整个打断。 */
export function parseCanvas(text) {
  try {
    const parsed = JSON.parse(String(text || ''))
    if (!parsed || typeof parsed !== 'object') return emptyCanvas()
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    }
  } catch {
    return emptyCanvas()
  }
}

export function serializeCanvas(canvas) {
  const source = canvas && typeof canvas === 'object' ? canvas : emptyCanvas()
  return JSON.stringify({
    nodes: Array.isArray(source.nodes) ? source.nodes : [],
    edges: Array.isArray(source.edges) ? source.edges : [],
  }, null, '\t')
}
