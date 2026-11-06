import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { build } from 'vite'
import { JSDOM, VirtualConsole } from 'jsdom'
import { readProject } from '../src/model.js'
import { CHANNEL, EDITOR, SITE, scenario, step, until, widgetHarness } from './helpers.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = await mkdtemp(resolve(root, 'node_modules/.editor-test-'))
await build({ root, logLevel: 'silent', build: { outDir: output } })
const asset = (await readdir(resolve(output, 'assets'))).find(name => name.endsWith('.js'))
const bundle = await readFile(resolve(output, 'assets', asset), 'utf8')
after(() => rm(output, { recursive: true, force: true }))

function editorHarness(draft) {
  const errors = [], messages = [], services = new Map(), storage = new Map()
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error.message))
  const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: EDITOR + '/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole })
  const { window } = dom, doc = window.document
  window.crypto.randomUUID = randomUUID
  window.confirm = () => true
  window.ResizeObserver = class { constructor(callback) { this.callback = callback } observe() { this.callback([{ contentRect: { width: 600 } }]) } disconnect() {} }
  window.localStorage.setItem('onboarding-prototype:' + SITE, JSON.stringify(draft))
  window.eval(bundle)
  const button = name => [...doc.querySelectorAll('button')].find(item => item.textContent.trim() === name)
  const primary = () => services.get(doc.querySelector('iframe[title="Демосайт для настройки тура"]'))
  function installFrames() {
    for (const [frame, service] of services) if (!frame.isConnected) { service.widget.close(); services.delete(frame) }
    for (const frame of doc.querySelectorAll('iframe')) {
      if (services.has(frame)) continue
      const child = frame.contentWindow
      const id = frame.src.endsWith('courses.html') ? 'two' : frame.src.endsWith('signup.html') ? 'three' : 'one'
      const widget = widgetHarness({ url: frame.src, storage, html: '<h1 id="' + id + '">' + id + '</h1><button id="launch">Помощь</button>', width: parseInt(frame.style.width), onPost: message => {
        messages.push(message)
        queueMicrotask(() => window.dispatchEvent(new window.MessageEvent('message', { source: child, origin: new URL(SITE).origin, data: message })))
      } })
      const service = { widget, frame, requests: [] }
      services.set(frame, service)
      child.postMessage = data => { service.requests.push(data); queueMicrotask(() => widget.dispatch(data)) }
      frame.dispatchEvent(new window.Event('load'))
    }
  }
  async function wait(predicate, label) { return until(() => { installFrames(); return predicate() }, label) }
  const connected = () => wait(() => !!doc.querySelector('.connection.online'), 'editor connection')
  const card = () => primary()?.widget.shadow()?.getElementById('card')
  const shown = index => wait(() => card()?.hidden === false && primary().widget.shadow().getElementById('progress').textContent.startsWith('Шаг ' + index + ' из'), 'visible global step ' + index)
  const names = () => messages.filter(message => message.type === 'event').map(message => message.payload.name)
  const saved = () => JSON.parse(window.localStorage.getItem('onboarding-prototype:' + SITE))
  function change(element, value) { element.value = value; element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) }
  return { window, doc, button, primary, connected, wait, card, shown, names, saved, change, messages, errors,
    close() { for (const service of services.values()) service.widget.close(); dom.window.close() },
  }
}

const intro = () => scenario('intro', [step('one'), step('two', SITE + 'courses.html'), step('three', SITE + 'signup.html')])

test('actual editor and widget run the whole scenario from any current page, including backward navigation', async t => {
  const h = editorHarness(readProject({ scenarios: [intro(), scenario('help', [step('one')])] }, SITE))
  t.after(h.close); await h.connected()
  h.doc.querySelectorAll('.step-select')[2].click()
  await h.wait(() => h.primary()?.frame.src === SITE + 'signup.html' && h.doc.querySelector('.connection.online'), 'navigate to the last page before starting')
  assert.equal(h.button('Запустить тур').disabled, false)
  h.button('Запустить тур').click(); await h.shown(1)
  assert.equal(h.primary().frame.src, SITE)
  h.primary().widget.shadow().getElementById('next').click(); await h.shown(2)
  assert.equal(h.primary().frame.src, SITE + 'courses.html')
  h.primary().widget.shadow().getElementById('back').click(); await h.shown(1)
  h.primary().widget.shadow().getElementById('next').click(); await h.shown(2)
  h.primary().widget.shadow().getElementById('next').click(); await h.shown(3)
  assert.equal(h.primary().frame.src, SITE + 'signup.html')
  h.primary().widget.shadow().getElementById('next').click()
  await h.wait(() => !!h.button('Запустить тур'), 'tour finished')
  assert.equal(h.names().filter(name => name === 'tour_started').length, 1)
  assert.equal(h.names().filter(name => name === 'tour_completed').length, 1)
  assert.equal(h.names().filter(name => name === 'step_completed').length, 3)
  assert.equal(h.names().includes('tour_error'), false)
  assert.equal(h.names().includes('tour_stopped'), false)
  const runIds = h.messages.filter(message => message.payload?.runId).map(message => message.payload.runId)
  assert.equal(new Set(runIds).size, 1)
  assert.deepEqual(h.errors, [])
})

test('scenario switching and new drafts keep existing scenarios isolated', async t => {
  const h = editorHarness({ schema: 3, steps: [step('one')], color: '#0f766e' })
  t.after(h.close); await h.connected()
  const original = h.saved().scenarios[0]
  h.button('+ Новый сценарий').click()
  await h.wait(() => h.saved().scenarios.length === 2, 'second scenario')
  assert.equal(h.doc.querySelectorAll('.step-item').length, 0)
  h.button('+ Выбрать элемент').click()
  await h.wait(() => h.doc.querySelectorAll('.step-item').length === 1, 'immediate draft')
  assert.match(h.doc.querySelector('.step-item').textContent, /Черновик/)
  h.button('Отменить настройку').click()
  await h.wait(() => !h.doc.querySelector('.interaction-card'), 'pick cancelled')
  assert.deepEqual(h.saved().scenarios[0].steps, original.steps)
  const select = h.doc.querySelector('.scenario-select select')
  h.change(select, original.id)
  await h.wait(() => h.saved().activeScenarioId === original.id, 'original selected')
  assert.equal(h.doc.querySelectorAll('.step-item').length, 1)
  assert.doesNotMatch(h.doc.querySelector('.step-item').textContent, /Черновик/)
})

test('a custom click can start another scenario while the offer starts the full intro', async t => {
  const custom = scenario('custom', [step('one')], 'click')
  const h = editorHarness(readProject({ scenarios: [intro(), custom] }, SITE))
  t.after(h.close); await h.connected()
  h.button('Проверить триггеры').click()
  await h.wait(() => h.primary()?.widget.shadow()?.getElementById('offer')?.hidden === false, 'invitation')
  h.primary().widget.window.document.getElementById('launch').click()
  await h.shown(1)
  assert.equal(h.saved().activeScenarioId, 'custom')
  assert.equal(h.primary().widget.shadow().getElementById('progress').textContent, 'Шаг 1 из 1')
  h.primary().widget.shadow().getElementById('next').click()
  await h.wait(() => h.primary()?.widget.shadow()?.getElementById('offer')?.hidden === false, 'remaining intro invitation')
  h.primary().widget.shadow().getElementById('offer-start').click(); await h.shown(1)
  assert.equal(h.saved().activeScenarioId, 'intro')
  assert.equal(h.primary().widget.shadow().getElementById('progress').textContent, 'Шаг 1 из 3')
})

test('stopping during a page handoff does not restart playback after the new page connects', async t => {
  const h = editorHarness(readProject({ scenarios: [intro()] }, SITE))
  t.after(h.close); await h.connected(); h.button('Запустить тур').click(); await h.shown(1)
  h.primary().widget.shadow().getElementById('next').click()
  await until(() => !h.doc.querySelector('.connection.online'), 'navigation started')
  assert.ok(h.button('Остановить тур'))
  h.button('Остановить тур').click()
  await h.connected()
  await h.wait(() => !!h.button('Запустить тур'), 'stopped state')
  assert.notEqual(h.card()?.hidden, false)
  assert.equal(h.primary().requests.filter(request => request.type === 'preview').length, 0)
})

test('starting from a page without steps is allowed, but unfinished steps elsewhere are reported', async t => {
  const h = editorHarness(readProject({ scenarios: [scenario('other-page', [step('two', SITE + 'courses.html')])] }, SITE))
  t.after(h.close); await h.connected()
  assert.equal(h.button('Запустить тур').disabled, false)
  h.button('Запустить тур').click(); await h.shown(1)
  assert.equal(h.primary().frame.src, SITE + 'courses.html')
})

test('the trigger element is selected visually without creating an extra step', async t => {
  const h = editorHarness(readProject({ scenarios: [scenario('intro', [step('one')])] }, SITE))
  t.after(h.close); await h.connected()
  h.change(h.doc.querySelector('.scenario-settings select'), 'click')
  await h.wait(() => !!h.button('Выбрать кнопку запуска'), 'click trigger settings')
  h.button('Выбрать кнопку запуска').click()
  await h.wait(() => h.primary().requests.some(request => request.type === 'pick-start'), 'trigger picker')
  h.primary().widget.window.document.getElementById('launch').click()
  await h.wait(() => h.saved().scenarios[0].trigger.selector.includes('launch'), 'trigger saved')
  assert.equal(h.saved().scenarios[0].trigger.pageUrl, SITE)
  assert.equal(h.saved().scenarios[0].steps.length, 1)
})

test('changing scenario settings removes outdated live triggers', async t => {
  const h = editorHarness(readProject({ scenarios: [scenario('intro', [step('one')])] }, SITE))
  t.after(h.close); await h.connected(); h.button('Проверить триггеры').click()
  await h.wait(() => h.primary()?.widget.shadow()?.getElementById('offer')?.hidden === false, 'live offer')
  const input = h.doc.querySelector('.enabled-field input')
  input.checked = false; input.dispatchEvent(new h.window.Event('change', { bubbles: true }))
  await h.wait(() => h.primary()?.widget.shadow()?.getElementById('offer')?.hidden === true, 'outdated offer removed')
  assert.equal(h.saved().scenarios[0].enabled, false)
})
