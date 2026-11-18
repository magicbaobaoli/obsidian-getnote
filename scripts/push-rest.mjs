/*
 * push-rest.mjs —— 没有 gh CLI、github.com:443 又被挡住时，用 GitHub REST API 推提交
 *
 * 用法：
 *   GITHUB_TOKEN=... node scripts/push-rest.mjs
 *   （或 GITHUB_TOKEN=$(cat ../.github-token.txt) node scripts/push-rest.mjs）
 *
 * 做法：把「远端 head..本地 HEAD」的提交逐条重放——改动文件先建 blob，
 * 再以 base_tree 建 tree，然后建 commit，最后把分支指过去。产出的文件树
 * 与本地完全一致，只有提交 sha 会变（committer 时间不同）。
 */
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = process.env.GITHUB_REPO || 'magicbaobaoli/obsidian-getnote'
const BRANCH = process.env.GITHUB_BRANCH || 'main'
const API = 'https://api.github.com'
const TOKEN = (process.env.GITHUB_TOKEN || '').trim()

if (TOKEN === '') {
  console.error('缺少 GITHUB_TOKEN 环境变量')
  process.exit(1)
}

const git = (...args) => execFileSync('git', args, { cwd: DIR, encoding: 'utf8' }).trim()

async function gh(method, path, body) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(API + path, {
      method,
      headers: {
        authorization: 'token ' + TOKEN,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'obsidian-getnote-push',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (res.ok) return text === '' ? null : JSON.parse(text)
    if (res.status >= 500 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      continue
    }
    throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + text.slice(0, 400))
  }
  throw new Error('重试耗尽：' + method + ' ' + path)
}

const remote = await gh('GET', '/repos/' + REPO + '/git/ref/heads/' + BRANCH)
const baseSha = remote.object.sha
console.log('远端 head:', baseSha)

const commits = git('rev-list', '--reverse', baseSha + '..HEAD').split('\n').filter(Boolean)
if (commits.length === 0) {
  console.log('没有待推送的提交')
  process.exit(0)
}
console.log('待重放提交:', commits.length)

let remoteParent = baseSha
let localParent = baseSha
let treeSha = git('rev-parse', baseSha + '^{tree}')

for (const sha of commits) {
  const message = git('log', '-1', '--format=%B', sha)
  const changed = git('diff', '--name-status', localParent, sha).split('\n').filter(Boolean)
  const entries = []
  for (const line of changed) {
    const [status, ...rest] = line.split('\t')
    const path = rest.join('\t')
    if (status === 'D') {
      entries.push({ path, mode: '100644', type: 'blob', sha: null })
      continue
    }
    const buffer = await readFile(join(DIR, path))
    const blob = await gh('POST', '/repos/' + REPO + '/git/blobs', {
      content: buffer.toString('base64'),
      encoding: 'base64',
    })
    entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
    console.log('  blob', path, buffer.length)
  }
  const tree = await gh('POST', '/repos/' + REPO + '/git/trees', { base_tree: treeSha, tree: entries })
  treeSha = tree.sha
  const commit = await gh('POST', '/repos/' + REPO + '/git/commits', {
    message,
    tree: treeSha,
    parents: [remoteParent],
  })
  console.log('commit', commit.sha.slice(0, 8), message.split('\n')[0])
  remoteParent = commit.sha
  localParent = sha
}

await gh('PATCH', '/repos/' + REPO + '/git/refs/heads/' + BRANCH, { sha: remoteParent, force: false })
console.log('PUSH_OK', remoteParent)
