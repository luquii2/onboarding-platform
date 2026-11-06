import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { JSDOM, VirtualConsole } from 'jsdom'

export const SITE = 'http://localhost:4174/'
export const EDITOR = 'http://localhost:5173'
export const CHANNEL = 'onboarding-prototype/v3'
const widgetSource = await readFile(new URL('../public/widget.js', import.meta.url), 'utf8')

export async function until(predicate, label = 'condition', interval = 5) {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, interval))
  }
  throw new Error('Timed out: ' + label)
}

export function step(id, pageUrl = SITE, selector = '#' + id) {
  return { id, pageUrl, selector, title: id, text: 'Подсказка ' + id, variants: { desktop: { selector, actions: [] }, mobile: { selector, actions: [] } } }
}

export function scenario(id, steps, type = 'offer') {
  return { id, name: id, enabled: true, color: '#4f46e5', steps, trigger: { type, pageUrl: '', selector: '#launch', title: 'Помочь освоиться?', text: 'Обучение', buttonText: 'Начать обучение' } }
}

export function widgetHarness({ url = SITE, html = '<button id="one">Один</button><button id="launch">Помощь</button>', embedded = true, width = 1100, storage = new Map(), config, onPost } = {}) {
  const posts = [], errors = [], events = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => { if (!error.message.includes('navigation')) errors.push(error.message) })
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole })
  const { window } = dom
  window.crypto.randomUUID = randomUUID
  window.CSS = { escape: value => String(value).replace(/["\\]/g, '\\$&') }
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true })
  const parent = { postMessage: message => { posts.push(message); onPost?.(message) } }
  if (embedded) Object.defineProperty(window, 'parent', { value: parent })
  Object.defineProperty(window, 'sessionStorage', { value: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  } })
  Object.defineProperty(window.document, 'currentScript', { value: { dataset: embedded
    ? { editorOrigin: EDITOR }
    : { siteId: config?.siteId || 'site-test', configUrl: '/onboarding.json' } } })
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    let visible = true
    for (let node = this; node; node = node.parentElement) {
      const css = window.getComputedStyle(node)
      if (node.hidden || css.display === 'none' || css.visibility === 'hidden') visible = false
    }
    return { left: 50, top: 100, width: visible ? 140 : 0, height: visible ? 40 : 0, right: 190, bottom: 140 }
  }
  window.HTMLElement.prototype.getClientRects = function () { return this.getBoundingClientRect().width ? [this.getBoundingClientRect()] : [] }
  window.HTMLElement.prototype.scrollIntoView = function () {}
  window.fetch = async () => ({ ok: true, text: async () => JSON.stringify(config) })
  window.AbortController = globalThis.AbortController
  window.addEventListener('onboarding:event', event => events.push(event.detail))
  window.eval(widgetSource)
  const session = 'test-session-' + randomUUID()
  function dispatch(data, { origin = EDITOR, source = parent } = {}) {
    window.dispatchEvent(new window.MessageEvent('message', { source, origin, data }))
  }
  async function request(type, payload = {}, options = {}) {
    const id = randomUUID()
    dispatch({ channel: CHANNEL, session: options.session || session, id, type, payload }, options)
    if (options.origin || options.source || options.session) { await new Promise(resolve => setTimeout(resolve, 5)); return posts.find(message => message.id === id)?.payload }
    await until(() => posts.some(message => type === 'hello' ? message.type === 'ready' : message.id === id), 'widget response: ' + type)
    return posts.find(message => message.id === id)?.payload
  }
  return {
    dom, window, parent, posts, events, storage, errors, dispatch, request,
    shadow: () => window.document.getElementById('onboarding-widget-v3')?.shadowRoot,
    names: () => (embedded ? posts.filter(message => message.type === 'event').map(message => message.payload) : events).map(message => message.name),
    messages: () => embedded ? posts.filter(message => message.type === 'event').map(message => message.payload) : events,
    ready: () => embedded ? request('hello') : window.Onboarding.ready,
    close: () => window.close(),
  }
}
