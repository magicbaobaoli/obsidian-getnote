import js from '@eslint/js'
import globals from 'globals'

/**
 * 从严起步、按现状降级：先把「重复键、未定义变量、未使用变量、隐式全局、
 * 改 const、空块」这几条真能抓 bug 的规则打开，其余全关。
 *
 * 为什么不开 eslint 的 recommended：这套代码是给 Obsidian 插件写的，
 * 大量依赖宿主注入的全局（window / document / Obsidian 的 API），
 * recommended 里的风格类规则会把几千条噪音一起倒出来，反而看不见真问题。
 */
export default [
  {
    ignores: [
      'node_modules/**',
      'main.js', // 构建产物
      'card/**',
      'locale/**',
      '*.min.js',
    ],
  },
  {
    files: ['src/**/*.js', 'scripts/**/*.mjs', 'test/**/*.mjs', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-duplicate-case': 'error',
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-implicit-globals': 'error',
      'no-const-assign': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unreachable': 'error',
      'no-fallthrough': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'no-self-assign': 'error',
      'no-unsafe-negation': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
  {
    // 测试里用 node:test 的 assert 与 jsdom 造出来的 window，宿主存储桩也是手写的，
    // 这几处有意留空 catch / 未使用变量，按现状降级。
    files: ['test/**/*.mjs'],
    rules: {
      'no-empty': 'off',
    },
  },
]
