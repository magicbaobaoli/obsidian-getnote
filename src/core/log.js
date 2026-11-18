/*
 * 统一日志。
 *
 * 插件的输出会混进 Obsidian 的开发者控制台——那里还挤着几十个别的插件。
 * 每条都自带 `[得到大脑]` 前缀，用户报问题时截一段就能认出是谁说的；
 * 详细日志默认关掉，在设置里打开才输出（否则刷屏，用户反而不看）。
 */

let debugEnabled = false

/** 打开/关闭详细日志。设置页切换时调用。 */
export function setDebugLogging(enabled) {
  debugEnabled = enabled === true
}

export function isDebugLogging() {
  return debugEnabled
}

function emit(level, args) {
  const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'
  const fn = typeof console !== 'undefined' ? console[method] : null
  if (typeof fn !== 'function') return
  try {
    fn.apply(console, ['[得到大脑]', ...args])
  } catch {
    // 控制台本身出问题不该把插件带崩
  }
}

/** 详细日志：默认不输出，用户在设置里打开「详细日志」才看得到。 */
export function debug(...args) {
  if (!debugEnabled) return
  emit('log', args)
}

/** 值得记一笔但不算错误的事（比如某条通道回退到另一条）。 */
export function info(...args) {
  if (!debugEnabled) return
  emit('log', args)
}

/** 真出了问题：始终输出。 */
export function warn(...args) {
  emit('warn', args)
}

/** 出错：始终输出。 */
export function error(...args) {
  emit('error', args)
}
