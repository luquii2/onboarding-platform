import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPlayback, createScenario, exportProject, readProject } from '../src/model.js'
import { SITE, scenario, step } from './helpers.mjs'

test('old single-tour drafts migrate to one scenario without losing page and mobile preparation', () => {
  const old = { schema: 3, color: '#0f766e', steps: [{ ...step('one', SITE + 'courses.html'), mobileSelector: '#mobile', menuToggleSelector: '#menu', variants: undefined }] }
  const project = readProject(old, SITE)
  assert.equal(project.schema, 4)
  assert.equal(project.scenarios.length, 1)
  assert.equal(project.scenarios[0].steps[0].pageUrl, SITE + 'courses.html')
  assert.equal(project.scenarios[0].steps[0].variants.mobile.selector, '#mobile')
  assert.equal(project.scenarios[0].steps[0].variants.mobile.actions[0].selector, '#menu')
  assert.equal(project.scenarios[0].color, '#0f766e')
  assert.equal(readProject(JSON.parse(JSON.stringify(project)), SITE).scenarios[0].id, project.scenarios[0].id)
})

test('playback includes every page in the configured order and snapshots device settings', () => {
  const input = scenario('intro', [step('one'), step('two', SITE + 'courses.html'), step('three', SITE + 'signup.html')])
  input.steps[1].variants.mobile = { selector: '#mobile', actions: [{ kind: 'click', selector: '#menu' }] }
  const playback = createPlayback(input, 'mobile', SITE)
  assert.deepEqual(playback.steps.map(item => item.id), ['one', 'two', 'three'])
  assert.equal(playback.steps[1].config.selector, '#mobile')
  input.steps[1].variants.mobile.actions[0].selector = '#changed'
  assert.equal(playback.steps[1].config.actions[0].selector, '#menu')
})

test('a draft on another page blocks an incomplete tour rather than silently dropping the step', () => {
  const draft = step('draft', SITE + 'courses.html', '')
  assert.throws(() => createPlayback(scenario('intro', [step('one'), draft]), 'desktop', SITE), /шага 2/)
  assert.throws(() => createPlayback(scenario('foreign', [step('one', 'https://other.example/')]), 'desktop', SITE), /подключенного сайта/)
})

test('one site exports independent scenarios and excludes disabled drafts', () => {
  const first = scenario('intro', [step('one')])
  const second = scenario('help', [step('two', SITE + 'signup.html')], 'click')
  const disabled = { ...createScenario('Черновик'), enabled: false }
  const project = readProject({ siteId: 'site-test', scenarios: [first, second, disabled], activeScenarioId: 'help' }, SITE)
  const exported = exportProject(project, SITE)
  assert.equal(project.activeScenarioId, 'help')
  assert.deepEqual(exported.scenarios.map(item => item.id), ['intro', 'help'])
  assert.equal(exported.scenarios[1].trigger.type, 'click')
  assert.equal(exported.origin, new URL(SITE).origin)
  project.scenarios[1].trigger.selector = ''
  assert.throws(() => exportProject(project, SITE), /кнопку запуска/)
})
