import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><div id=a><p id=p>hi</p></div>')
const { window } = dom
let hits = 0
window.addEventListener('mouseup', () => { hits += 1 })
const p = window.document.getElementById('p')
p.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 80 }))
console.log('hits', hits, 'defaultView===window', window.document.defaultView === window)
