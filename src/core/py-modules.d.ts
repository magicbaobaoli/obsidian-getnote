/**
 * esbuild 的 text loader 会把 .py 脚本当成字符串导入（见 scripts/build.mjs 的 loader 配置）。
 * tsc 不认识这种导入，这里补一份声明，让 checkJs 不至于因为四个桥脚本报 TS2307。
 */
declare module '*.py' {
  const content: string
  export default content
}
