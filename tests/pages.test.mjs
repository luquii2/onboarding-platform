import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { buildHostedDemo, hostedConfig, injectWidget } from '../tools/build-hosted-demo.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const url = 'https://luquii2.github.io/onboarding-platform/demo/'

test('all demo pages contain one hosted widget and a matching public configuration', async t => {
  const temp = await mkdtemp(resolve(root, 'node_modules/.pages-test-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  await cp(resolve(root, 'demo-source'), resolve(temp, 'demo-source'), { recursive: true })
  await buildHostedDemo(temp, url)
  const config = JSON.parse(await readFile(resolve(temp, 'dist/demo/onboarding.json'), 'utf8'))
  assert.equal(config.scenarios.length, 2)
  for (const name of ['index.html', 'courses.html', 'course.html', 'signup.html']) {
    const html = await readFile(resolve(temp, 'dist/demo', name), 'utf8')
    const dom = new JSDOM(html)
    const widgets = dom.window.document.querySelectorAll('script[data-editor-origin]')
    assert.equal(widgets.length, 1)
    assert.equal(widgets[0].src, 'https://luquii2.github.io/onboarding-platform/widget.js')
    assert.equal(widgets[0].dataset.configUrl, url + 'onboarding.json')
    assert.equal(widgets[0].dataset.siteId, config.siteId)
    dom.window.close()
    assert.equal(injectWidget(html, hostedConfig(url)).match(/data-config-url=/g).length, 1)
  }
  for (const scenario of config.scenarios) for (const step of scenario.steps) {
    const html = await readFile(resolve(temp, 'dist/demo', step.pageUrl), 'utf8')
    const dom = new JSDOM(html)
    assert.equal(dom.window.document.querySelectorAll(step.selector).length, 1)
    dom.window.close()
  }
})
