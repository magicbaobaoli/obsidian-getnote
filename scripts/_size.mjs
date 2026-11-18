
import * as esbuild from 'esbuild'
const r = await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node18',
  external: ['obsidian', 'electron'], metafile: true, logLevel: 'silent',
})
const out = r.metafile.outputs[Object.keys(r.metafile.outputs)[0]]
const rows = Object.entries(out.inputs).map(([k,v]) => [k, v.bytesInOutput]).sort((a,b)=>b[1]-a[1]).slice(0,10)
for (const [k,v] of rows) console.log((v/1024).toFixed(1).padStart(8), 'KB ', k)
console.log('total', (out.bytes/1024).toFixed(1), 'KB')
