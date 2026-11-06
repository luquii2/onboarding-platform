import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPlayback } from '../src/model.js'
import { EDITOR, SITE, scenario, step, until, widgetHarness } from './helpers.mjs'

const payload = input => { const run = createPlayback(input, 'desktop', SITE); return { ...run, runId: run.id } }
const visibleCard = h => h.shadow()?.getElementById('card')?.hidden === false

test('bridge requires the current parent, origin and session', async t => {
  const h = widgetHarness(); t.after(h.close); await h.ready()
  const config = { selector: '#one', actions: [] }
  assert.equal(await h.request('probe', { config }, { origin: 'https://other.example' }), undefined)
  assert.equal(await h.request('probe', { config }, { source: {} }), undefined)
  assert.equal(await h.request('probe', { config }, { session: 'obsolete-session' }), undefined)
  assert.equal((await h.request('probe', { config })).state, 'ready')
  assert.equal(new URL(EDITOR).origin, EDITOR)
})

test('cross-page next and back preserve one run and completion history', async t => {
  const tour = scenario('intro', [step('one'), step('two', SITE + 'courses.html'), step('three', SITE + 'signup.html')])
  const start = payload(tour)
  const first = widgetHarness(); t.after(first.close); await first.ready(); await first.request('preview', start)
  await until(() => visibleCard(first))
  first.shadow().getElementById('next').click()
  await until(() => first.names().includes('tour_navigate'))
  let checkpoint = first.messages().find(message => message.name === 'tour_navigate')
  assert.equal(checkpoint.runId, start.runId)
  assert.equal(checkpoint.index, 1)
  assert.deepEqual([...checkpoint.completed], ['one'])
  assert.equal(first.names().includes('tour_completed'), false)

  const second = widgetHarness({ url: SITE + 'courses.html', html: '<h2 id="two">Курсы</h2>' })
  t.after(second.close); await second.ready()
  await second.request('preview', { ...start, ...checkpoint })
  await until(() => visibleCard(second))
  assert.equal(second.shadow().getElementById('progress').textContent, 'Шаг 2 из 3')
  assert.equal(second.names().includes('tour_started'), false)
  second.shadow().getElementById('back').click()
  await until(() => second.names().includes('tour_navigate'))
  checkpoint = second.messages().find(message => message.name === 'tour_navigate')
  assert.equal(checkpoint.index, 0)

  const back = widgetHarness(); t.after(back.close); await back.ready()
  await back.request('preview', { ...start, ...checkpoint })
  await until(() => visibleCard(back))
  back.shadow().getElementById('next').click()
  await until(() => back.names().includes('tour_navigate'))
  assert.equal(back.names().includes('step_completed'), false, 'returning through a completed step must not count it twice')
  assert.equal(back.names().includes('tour_stopped'), false)
})

test('mobile preparation is replayed after resuming on another page', async t => {
  const h = widgetHarness({ url: SITE + 'courses.html', width: 390, html: '<button id="menu">Меню</button><nav id="nav" style="display:none"><a id="target">Запись</a></nav>' })
  t.after(h.close)
  h.window.document.getElementById('menu').onclick = () => { h.window.document.getElementById('nav').style.display = 'block' }
  await h.ready()
  await h.request('preview', { runId: 'run-mobile', started: true, index: 1, completed: ['one'], steps: [
    { ...step('one'), config: { selector: '#one', actions: [] } },
    { ...step('two', SITE + 'courses.html'), config: { selector: '#target', actions: [{ kind: 'click', selector: '#menu' }] } },
  ] })
  await until(() => visibleCard(h))
  assert.equal(h.shadow().getElementById('progress').textContent, 'Шаг 2 из 2')
  assert.equal(h.window.document.getElementById('nav').style.display, 'block')
})

test('offer and click triggers launch their own scenarios', async t => {
  const h = widgetHarness(); t.after(h.close); await h.ready()
  const offer = scenario('offer-tour', [step('one')])
  const click = scenario('click-tour', [step('one')], 'click')
  await h.request('configure', { siteId: 'site-test', scenarios: [offer, click], resetOffers: true })
  assert.equal(h.shadow().getElementById('offer').hidden, false)
  h.shadow().getElementById('offer-start').click()
  assert.equal(h.messages().at(-1).scenarioId, 'offer-tour')
  await h.request('configure', { siteId: 'site-test', scenarios: [offer, click] })
  h.window.document.getElementById('launch').click()
  assert.equal(h.messages().at(-1).scenarioId, 'click-tour')
  assert.equal(h.names().includes('tour_started'), false, 'the editor owns playback until it acknowledges the trigger')
})

test('several invitations share one card and render configured text safely', async t => {
  const h = widgetHarness(); t.after(h.close); await h.ready()
  const first = scenario('first', [step('one')]), second = scenario('second', [step('one')])
  second.trigger.title = '<img src=x onerror=alert(1)>'
  await h.request('configure', { siteId: 'site-test', scenarios: [first, second] })
  const choices = h.shadow().getElementById('offer-choices')
  assert.equal(choices.hidden, false)
  choices.value = 'second'; choices.dispatchEvent(new h.window.Event('change'))
  assert.equal(h.shadow().getElementById('offer-title').textContent, second.trigger.title)
  assert.equal(h.shadow().querySelectorAll('img').length, 0)
  h.shadow().getElementById('offer-start').click()
  assert.equal(h.messages().at(-1).scenarioId, 'second')
})

test('page restrictions and disabled scenarios suppress their triggers', async t => {
  const h = widgetHarness(); t.after(h.close); await h.ready()
  const wrongPage = scenario('elsewhere', [step('one')]); wrongPage.trigger.pageUrl = SITE + 'signup.html'
  const disabled = { ...scenario('disabled', [step('one')]), enabled: false }
  await h.request('configure', { siteId: 'site-test', scenarios: [wrongPage, disabled] })
  assert.equal(h.shadow()?.getElementById('offer')?.hidden ?? true, true)
  assert.equal(await h.window.Onboarding.start('disabled'), false)
})

test('standalone embedding resumes across documents and completes only the last global step', async t => {
  const storage = new Map()
  const config = { schema: 1, siteId: 'site-test', scenarios: [scenario('intro', [step('one'), step('two', SITE + 'courses.html')])] }
  const first = widgetHarness({ embedded: false, config, storage }); t.after(first.close)
  assert.equal(await first.ready(), true)
  first.shadow().getElementById('offer-start').click()
  await until(() => visibleCard(first))
  first.shadow().getElementById('next').click()
  await until(() => first.names().includes('tour_navigate'))
  const saved = JSON.parse(storage.get('onboarding:site-test:run'))
  assert.equal(saved.index, 1)
  assert.deepEqual(saved.completed, ['one'])
  assert.equal(first.names().includes('tour_completed'), false)

  const second = widgetHarness({ url: SITE + 'courses.html', html: '<h2 id="two">Курсы</h2>', embedded: false, config, storage })
  t.after(second.close); assert.equal(await second.ready(), true)
  await until(() => visibleCard(second))
  assert.equal(second.shadow().getElementById('progress').textContent, 'Шаг 2 из 2')
  assert.equal(second.messages().find(message => message.name === 'step_shown').runId, saved.runId)
  second.shadow().getElementById('next').click()
  assert.equal(second.names().filter(name => name === 'tour_completed').length, 1)
  assert.equal(second.names().includes('tour_started'), false)
  assert.equal(storage.has('onboarding:site-test:run'), false)
})

test('programmatic start waits for configuration and selects an exact scenario', async t => {
  const config = { schema: 1, siteId: 'site-test', scenarios: [scenario('manual', [step('one')], 'manual')] }
  const h = widgetHarness({ embedded: false, config }); t.after(h.close)
  assert.equal(await h.window.Onboarding.start('manual'), true)
  await until(() => visibleCard(h))
  assert.equal(h.messages().find(message => message.name === 'tour_started').scenarioId, 'manual')
  h.window.Onboarding.stop()
  assert.equal(h.names().filter(name => name === 'tour_stopped').length, 1)
})

test('corrupt saved progress does not disable a valid invitation', async t => {
  const config = { schema: 1, siteId: 'site-test', scenarios: [scenario('intro', [step('one')])] }
  const storage = new Map([['onboarding:site-test:run', JSON.stringify({ scenarioId: 'intro', runId: 'corrupt', index: 999, stepIds: ['one'], updatedAt: Date.now() })]])
  const h = widgetHarness({ embedded: false, config, storage }); t.after(h.close)
  assert.equal(await h.ready(), true)
  assert.equal(h.shadow().getElementById('offer').hidden, false)
  assert.equal(storage.has('onboarding:site-test:run'), false)
})

test('foreign pages and invalid trigger selectors are rejected before playback', async t => {
  const h = widgetHarness(); t.after(h.close); await h.ready()
  const foreign = payload(scenario('intro', [step('one')]))
  foreign.steps[0].pageUrl = 'https://other.example/'
  assert.equal((await h.request('preview', foreign)).state, 'error')
  const invalid = scenario('bad', [step('one')], 'click'); invalid.trigger.selector = '['
  assert.equal((await h.request('configure', { siteId: 'site-test', scenarios: [invalid] })).state, 'error')
  assert.equal(h.names().includes('tour_started'), false)
})
