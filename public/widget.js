(() => {
  const settings = { ...document.currentScript?.dataset }
  const editorOrigin = settings.editorOrigin
  const embedded = !!editorOrigin && window.parent !== window
  if ((!embedded && !settings.configUrl) || window.__onboardingPrototype === 'v3') return
  window.__onboardingPrototype = 'v3'
  const CHANNEL = 'onboarding-prototype/v3'
  let session = '', validator = false, epoch = 0, mode = null, run = null, inspection = null, hovered = null, raf = 0, preparing = false
  let host, shadow, ring, card, blocker, heading, copy, progress, back, next, skip, previousFocus
  let offer, offerTitle, offerText, offerStart, offerChoices, notice
  let catalog = [], siteId = '', configVersion = 0, launchPending = false, dismissed = new Set()

  const post = (type, payload = {}, id) => embedded && session && window.parent.postMessage({ channel: CHANNEL, session, type, id, payload }, editorOrigin)
  const reply = (request, payload) => post('response', payload, request.id)
  const emit = (name, payload = {}) => {
    if (embedded) post('event', { name, ...payload })
    else window.dispatchEvent(new CustomEvent('onboarding:event', { detail: { name, ...payload } }))
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

  function assertCurrent(token) {
    if (token !== epoch) throw Object.assign(new Error('Операция отменена.'), { cancelled: true })
  }

  function visible(element) {
    if (!element?.isConnected || !element.getClientRects().length) return false
    const rect = element.getBoundingClientRect(), css = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && css.display !== 'none' && !['hidden', 'collapse'].includes(css.visibility) && css.opacity !== '0'
  }

  function find(selector) {
    if (!selector) return { state: 'unconfigured', message: 'Выберите целевой элемент.' }
    let nodes
    try { nodes = [...document.querySelectorAll(selector)] }
    catch { return { state: 'invalid', message: 'Выберите элемент заново.' } }
    const available = nodes.filter(visible)
    if (available.length > 1) return { state: 'ambiguous', message: 'Найдено несколько элементов. Уточните цель.' }
    if (available.length === 1) return { state: 'ready', element: available[0] }
    return nodes.length
      ? { state: 'hidden', message: 'Элемент есть на странице, но скрыт.' }
      : { state: 'missing', message: 'На этой странице нет выбранного элемента.' }
  }

  function validConfig(config) {
    return config && typeof config.selector === 'string' && config.selector.length <= 2000 &&
      Array.isArray(config.actions) && config.actions.length <= 20 && config.actions.every(action =>
        action && ['click', 'select'].includes(action.kind) && typeof action.selector === 'string' &&
        action.selector.length > 0 && action.selector.length <= 2000 &&
        (action.kind !== 'select' || (typeof action.value === 'string' && action.value.length <= 500)))
  }

  function actionControl(element) {
    return element?.closest?.('button, summary, [role="button"], [role="tab"], a[href^="#"]') || null
  }

  function safeControl(element) {
    if (!element || !visible(element) || element.disabled || element.getAttribute('aria-disabled') === 'true') return false
    if (element.tagName === 'BUTTON' && element.form && element.type !== 'button') return false
    if (element.tagName === 'A') {
      const href = element.getAttribute('href') || ''
      if (!href.startsWith('#')) return false
    }
    return element.matches('button, summary, [role="button"], [role="tab"], a[href^="#"]')
  }

  async function waitFor(selector, token, timeout = 1500) {
    const deadline = Date.now() + timeout
    let result
    do {
      assertCurrent(token)
      result = find(selector)
      if (result.state === 'ready' || ['invalid', 'ambiguous', 'unconfigured'].includes(result.state)) return result
      await sleep(40)
    } while (Date.now() < deadline)
    return result
  }

  async function prepare(config, token) {
    assertCurrent(token)
    let target = find(config.selector)
    if (target.state === 'ready' || !config.actions.length || ['invalid', 'ambiguous', 'unconfigured'].includes(target.state)) return target
    for (const action of config.actions) {
      assertCurrent(token)
      target = find(config.selector)
      if (target.state === 'ready') return target
      const found = await waitFor(action.selector, token)
      if (found.state !== 'ready') return { state: 'action-missing', message: 'Действие подготовки недоступно. Запишите последовательность заново.' }
      const control = found.element
      assertCurrent(token)
      if (action.kind === 'select') {
        if (control.tagName !== 'SELECT' || control.disabled || ![...control.options].some(option => option.value === action.value && !option.disabled)) {
          return { state: 'action-missing', message: 'Выбранный вариант списка недоступен.' }
        }
        control.value = action.value
        control.dispatchEvent(new Event('input', { bubbles: true }))
        control.dispatchEvent(new Event('change', { bubbles: true }))
      } else {
        if (!safeControl(control)) return { state: 'action-invalid', message: 'Выберите действие, открывающее нужный раздел.' }
        const alreadyOpen = control.getAttribute('aria-expanded') === 'true' || control.getAttribute('aria-selected') === 'true' ||
          (control.tagName === 'SUMMARY' && control.parentElement?.open)
        if (!alreadyOpen) control.click()
      }
      await sleep(80)
    }
    return waitFor(config.selector, token)
  }

  function selectorFor(element) {
    for (const attribute of ['data-onboarding', 'id']) {
      const value = element.getAttribute(attribute)
      if (!value) continue
      const candidate = '[' + attribute + '="' + CSS.escape(value) + '"]'
      if (document.querySelectorAll(candidate).length === 1) return candidate
    }
    if (element === document.documentElement) return 'html'
    const path = []
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      const siblings = [...(node.parentElement?.children || [])].filter(other => other.localName === node.localName)
      path.unshift(CSS.escape(node.localName) + ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')')
    }
    return 'html > ' + path.join(' > ')
  }

  function readable(element) {
    return (element.getAttribute('aria-label') || element.labels?.[0]?.textContent || element.textContent || element.localName).trim().replace(/\s+/g, ' ').slice(0, 80)
  }

  function pickElement(element) {
    return element.closest('button, a, input, select, textarea, [data-onboarding], [role="button"], [role="tab"], summary') || element
  }

  function ui() {
    if (host || validator) return
    host = document.createElement('div')
    host.id = 'onboarding-widget-v3'
    shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = `<style>
      :host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;color-scheme:light}
      *{box-sizing:border-box}[hidden]{display:none!important}
      #blocker{position:fixed;inset:0;pointer-events:auto}
      #ring{position:fixed;outline:3px solid #4f46e5;border-radius:7px;pointer-events:none}
      #card,#offer,#notice{position:fixed;width:320px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow:auto;padding:18px;background:#fff;color:#20243a;border-radius:12px;box-shadow:0 12px 40px #0003;font:15px/1.5 system-ui;pointer-events:auto}
      #offer,#notice{right:20px;bottom:20px;border:1px solid #e0e5ef}#offer-close{float:right;padding:0 7px;margin:-5px -5px 4px 10px}#offer-start{width:100%;background:#4f46e5;color:white;border-color:transparent}#offer-choices{width:100%;font:inherit;padding:8px;margin-bottom:12px;border:1px solid #d4d9e7;border-radius:7px}
      h2{font-size:18px;margin:8px 0}p{white-space:pre-wrap;margin:8px 0 16px}small{color:#626b80}
      nav{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;border:1px solid #d4d9e7;border-radius:7px;padding:7px 10px;background:#fff;color:#20243a;cursor:pointer}button:focus-visible{outline:3px solid #818cf8}
    </style><div id="blocker" hidden></div><div id="ring" hidden></div>
    <section id="card" role="dialog" aria-modal="true" aria-labelledby="title" aria-describedby="copy" hidden>
      <small id="progress"></small><h2 id="title"></h2><p id="copy"></p>
      <nav aria-label="Управление туром"><button id="back">Назад</button><button id="next">Далее</button><button id="skip">Пропустить</button></nav>
    </section>
    <aside id="offer" role="complementary" aria-label="Обучение на сайте" hidden>
      <button id="offer-close" aria-label="Закрыть приглашение">×</button><small>ОБУЧЕНИЕ НА САЙТЕ</small>
      <h2 id="offer-title"></h2><p id="offer-text"></p>
      <select id="offer-choices" aria-label="Выберите обучение" hidden></select><button id="offer-start"></button>
    </aside>
    <section id="notice" role="status" hidden><h2>Обучение приостановлено</h2><p id="notice-text"></p><button id="notice-close">Закрыть</button></section>`
    const get = id => shadow.getElementById(id)
    ring = get('ring'); card = get('card'); blocker = get('blocker'); heading = get('title'); copy = get('copy'); progress = get('progress')
    back = get('back'); next = get('next'); skip = get('skip')
    offer = get('offer'); offerTitle = get('offer-title'); offerText = get('offer-text'); offerStart = get('offer-start'); offerChoices = get('offer-choices'); notice = get('notice')
    get('offer-close').onclick = () => {
      const scenarioIds = eligibleOffers().map(scenario => scenario.id)
      for (const id of scenarioIds) dismissed.add(id)
      store('dismissed', [...dismissed]); offer.hidden = true
      emit('trigger_dismissed', { scenarioIds })
    }
    offerChoices.onchange = updateOffer
    offerStart.onclick = () => launchScenario(offerChoices.value)
    get('notice-close').onclick = () => { notice.hidden = true }
    back.onclick = () => { if (run && !preparing && run.index > 0) { run.index--; showStep() } }
    next.onclick = () => {
      if (!run || preparing) return
      const step = run.steps[run.index]
      if (!run.completed.has(step.id)) { run.completed.add(step.id); analytics('step_completed') }
      if (run.index === run.steps.length - 1) finish('tour_completed')
      else { run.index++; showStep() }
    }
    skip.onclick = () => finish('tour_skipped')
    document.documentElement.append(host)
  }

  function analytics(name, message) {
    if (run) emit(name, { ...runState(), message, eventId: crypto.randomUUID() })
  }

  function cancel() {
    if (run) analytics('tour_stopped')
    if (run && !embedded) removeStored('run')
    epoch++; run = inspection = mode = hovered = null; preparing = false
    launchPending = false
    cancelAnimationFrame(raf); raf = 0
    if (host) ring.hidden = card.hidden = blocker.hidden = offer.hidden = notice.hidden = true
  }

  function finish(name, message) {
    analytics(name, message)
    if (!embedded) removeStored('run')
    run = null
    cancel()
    if (name === 'tour_error' && !embedded) showNotice(message)
    else renderOffer()
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  }

  function draw(element, dimmed = false) {
    ui()
    if (!host) return
    const rect = element.getBoundingClientRect()
    ring.hidden = false
    Object.assign(ring.style, { left: (rect.left - 3) + 'px', top: (rect.top - 3) + 'px', width: (rect.width + 6) + 'px', height: (rect.height + 6) + 'px', boxShadow: dimmed ? '0 0 0 9999px #0f172a66' : '0 0 0 4px #4f46e522' })
    if (dimmed) {
      const width = card.offsetWidth, height = card.offsetHeight
      const left = Math.max(12, Math.min(rect.left, innerWidth - width - 12))
      let top = rect.bottom + 12
      if (top + height > innerHeight - 12) top = rect.top - height - 12
      top = Math.max(12, Math.min(top, innerHeight - height - 12))
      Object.assign(card.style, { left: left + 'px', top: top + 'px' })
    }
  }

  function tick() {
    raf = 0
    if (preparing) return
    const target = run?.target || inspection?.target || (mode?.kind === 'pick' ? hovered : null)
    if (target && visible(target)) draw(target, !!run)
    else if (host) ring.hidden = true
    if (run || inspection || mode?.kind === 'pick') raf = requestAnimationFrame(tick)
  }
  const animate = () => { if (!raf && !validator) raf = requestAnimationFrame(tick) }

  async function showStep() {
    if (!run) return
    const current = run, token = ++epoch, step = current.steps[current.index]
    preparing = true; ring.hidden = card.hidden = true; blocker.hidden = false
    try {
      analytics('tour_progress')
      if (!embedded) saveRun()
      if (step.pageUrl !== pageUrl(location.href)) {
        analytics('tour_navigate')
        if (!embedded) {
          if (!saveRun()) { finish('tour_error', 'Браузер не разрешил сохранить прогресс. Разрешите хранение данных сайта и повторите обучение.'); return }
          location.assign(step.pageUrl)
        }
        return
      }
      const result = await prepare(step.config, token)
      assertCurrent(token)
      if (result.state !== 'ready') { finish('tour_error', result.message); return }
      current.target = result.element
      result.element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
      heading.textContent = step.title || 'Подсказка'; copy.textContent = step.text
      progress.textContent = 'Шаг ' + (current.index + 1) + ' из ' + current.steps.length
      back.hidden = current.index === 0; next.textContent = current.index === current.steps.length - 1 ? 'Завершить' : 'Далее'
      card.hidden = false; preparing = false; draw(result.element, true); next.focus({ preventScroll: true })
      analytics('step_shown'); animate()
    } catch (error) { if (!error.cancelled && run === current) finish('tour_error', 'Не удалось подготовить шаг.') }
  }

  function recordAction(action) {
    if (mode?.kind !== 'record') return
    if (mode.actions.length >= 20) { emit('record-note', { taskId: mode.taskId, message: 'Уже записано 20 действий. Выберите конечную цель.' }); return }
    const last = mode.actions.at(-1)
    if (action.kind === 'select' && last?.kind === 'select' && last.selector === action.selector) mode.actions[mode.actions.length - 1] = action
    else mode.actions.push(action)
    emit('action-recorded', { taskId: mode.taskId, actions: mode.actions })
  }

  window.addEventListener('message', async event => {
    if (!embedded || event.source !== window.parent || event.origin !== editorOrigin) return
    const data = event.data
    if (!data || data.channel !== CHANNEL || typeof data.session !== 'string' || data.session.length < 10 || data.session.length > 100 || typeof data.id !== 'string' || data.id.length > 100) return
    const payload = data.payload || {}
    if (data.type === 'hello') { cancel(); session = data.session; validator = payload.validator === true; post('ready', { url: location.href, title: document.title, capabilities: ['multipage-tour', 'scenario-triggers'] }); return }
    if (!session || data.session !== session) return
    try {
      if (data.type === 'probe' || data.type === 'highlight') {
        if (!validConfig(payload.config)) { reply(data, { state: 'invalid', message: 'Выберите элемент заново.' }); return }
        if (data.type === 'highlight') { if (validator) return; cancel(); ui(); preparing = true }
        const token = ++epoch, result = await prepare(payload.config, token)
        assertCurrent(token)
        if (data.type === 'highlight') {
          preparing = false
          if (result.state === 'ready') { inspection = { target: result.element }; result.element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); draw(result.element); animate() }
        }
        reply(data, { state: result.state, message: result.message || '', label: result.element ? readable(result.element) : '' })
      } else if (data.type === 'pick-start') {
        if (validator || typeof payload.taskId !== 'string') return
        cancel(); ui(); mode = { kind: 'pick', taskId: payload.taskId }; animate(); reply(data, { ok: true })
      } else if (data.type === 'record-start') {
        if (validator || typeof payload.taskId !== 'string') return
        cancel(); mode = { kind: 'record', taskId: payload.taskId, actions: [] }; reply(data, { ok: true })
      } else if (data.type === 'record-stop') {
        const actions = mode?.kind === 'record' && mode.taskId === payload.taskId ? mode.actions : []
        mode = null; reply(data, { actions })
      } else if (data.type === 'cancel') { cancel(); reply(data, { ok: true })
      } else if (data.type === 'configure') {
        if (validator) { reply(data, { ok: false }); return }
        configureCatalog(payload)
        reply(data, { ok: true })
      } else if (data.type === 'preview') {
        if (validator) { reply(data, { ok: false }); return }
        startRun(payload)
        reply(data, { ok: true })
      } else reply(data, { ok: false })
    } catch (error) {
      if (error.cancelled) reply(data, { state: 'cancelled' })
      else { preparing = false; reply(data, { state: 'error', message: String(error.message || 'Не удалось выполнить действие. Повторите настройку.').slice(0, 300) }) }
    }
  })

  document.addEventListener('pointermove', event => {
    if (mode?.kind !== 'pick' || event.composedPath().includes(host) || !(event.target instanceof Element)) return
    hovered = pickElement(event.target)
  }, true)
  document.addEventListener('pointerdown', event => {
    if (mode?.kind !== 'pick' || event.composedPath().includes(host)) return
    event.preventDefault(); event.stopImmediatePropagation()
  }, true)
  document.addEventListener('click', event => {
    if (!mode || event.composedPath().includes(host) || !(event.target instanceof Element)) return
    if (mode.kind === 'pick') {
      event.preventDefault(); event.stopImmediatePropagation()
      const element = pickElement(event.target), selector = selectorFor(element), taskId = mode.taskId
      cancel()
      if (selector.length > 2000) { emit('pick-error', { taskId, message: 'Выберите более простой элемент.' }); return }
      emit('picked', { taskId, selector, label: readable(element), pageUrl: location.href })
    } else if (mode.kind === 'record' && event.isTrusted) {
      const control = actionControl(event.target)
      if (!control) return
      if (!safeControl(control)) { event.preventDefault(); emit('record-note', { taskId: mode.taskId, message: 'Выберите действие, открывающее нужный раздел.' }); return }
      recordAction({ kind: 'click', selector: selectorFor(control), label: readable(control) })
    }
  }, true)
  document.addEventListener('click', event => {
    if (run || mode || validator || launchPending || event.defaultPrevented || event.button > 0 || event.composedPath().includes(host) || !(event.target instanceof Element)) return
    const scenario = catalog.find(item => item.trigger.type === 'click' && matchesTriggerPage(item) && event.target.closest(item.trigger.selector))
    if (scenario) { event.preventDefault(); event.stopImmediatePropagation(); launchScenario(scenario.id) }
  }, true)
  document.addEventListener('change', event => {
    if (mode?.kind === 'record' && event.target instanceof HTMLSelectElement && !event.target.disabled) {
      recordAction({ kind: 'select', selector: selectorFor(event.target), value: event.target.value, label: readable(event.target) })
    }
  }, true)
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mode) { const taskId = mode.taskId; event.preventDefault(); cancel(); emit('pick-cancelled', { taskId }) }
    else if (event.key === 'Escape' && run) { event.preventDefault(); finish('tour_skipped') }
    else if (event.key === 'Tab' && run && host) {
      const buttons = [back, next, skip].filter(button => !button.hidden), first = buttons[0], last = buttons.at(-1), active = shadow.activeElement
      if (!buttons.includes(active) || (!event.shiftKey && active === last) || (event.shiftKey && active === first)) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
    }
  }, true)
  function pageUrl(value) {
    const url = new URL(value, location.href)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== location.origin) throw new Error('Сценарий содержит страницу другого сайта.')
    url.hash = ''
    return url.href
  }

  function runState() {
    return {
      runId: run.id, scenarioId: run.scenarioId, stepId: run.steps[run.index].id,
      configVersion: run.configVersion,
      index: run.index, pageUrl: run.steps[run.index].pageUrl,
      completed: [...run.completed], started: true,
    }
  }

  function startRun(payload) {
    if (!Array.isArray(payload.steps) || !payload.steps.length || payload.steps.length > 50) throw new Error('В сценарии нет готовых шагов.')
    const ids = new Set()
    const steps = payload.steps.map(step => {
      if (!step || typeof step.id !== 'string' || !step.id || step.id.length > 100 || ids.has(step.id) || typeof step.title !== 'string' || typeof step.text !== 'string' || !validConfig(step.config)) throw new Error('Некорректные настройки шага.')
      ids.add(step.id)
      return { ...step, title: step.title.slice(0, 120), text: step.text.slice(0, 2000), pageUrl: pageUrl(step.pageUrl || location.href) }
    })
    const index = payload.index ?? 0
    if (!Number.isInteger(index) || index < 0 || index >= steps.length) throw new Error('Некорректный номер шага.')
    if (payload.runId !== undefined && (typeof payload.runId !== 'string' || !payload.runId || payload.runId.length > 100)) throw new Error('Некорректный запуск.')
    cancel(); ui(); previousFocus = document.activeElement
    run = {
      id: payload.runId || crypto.randomUUID(), scenarioId: payload.scenarioId || '', steps, index,
      configVersion: Number.isInteger(payload.configVersion) && payload.configVersion >= 0 ? payload.configVersion : configVersion,
      color: /^#[0-9a-f]{6}$/i.test(payload.color) ? payload.color : '#4f46e5',
      target: null, completed: new Set(Array.isArray(payload.completed) ? payload.completed.filter(id => ids.has(id)) : []),
    }
    if (run.scenarioId) { dismissed.add(run.scenarioId); store('dismissed', [...dismissed]) }
    next.style.background = run.color
    const rgb = [1, 3, 5].map(index => parseInt(run.color.slice(index, index + 2), 16))
    next.style.color = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 > 145 ? '#111827' : '#fff'
    if (!payload.started) analytics('tour_started')
    showStep()
  }

  const storageKey = kind => 'onboarding:' + (embedded ? 'preview:' : '') + siteId + ':' + kind
  function stored(kind) { try { return JSON.parse(sessionStorage.getItem(storageKey(kind)) || 'null') } catch { return null } }
  function store(kind, value) { try { sessionStorage.setItem(storageKey(kind), JSON.stringify(value)); return true } catch { return false } }
  function removeStored(kind) { try { sessionStorage.removeItem(storageKey(kind)) } catch { /* Storage can be disabled. */ } }
  function saveRun() {
    return store('run', { ...runState(), color: run.color, stepIds: run.steps.map(step => step.id), updatedAt: Date.now() })
  }

  function matchesTriggerPage(scenario) { return !scenario.trigger.pageUrl || scenario.trigger.pageUrl === pageUrl(location.href) }
  function eligibleOffers() { return catalog.filter(item => item.trigger.type === 'offer' && matchesTriggerPage(item) && !dismissed.has(item.id)) }
  function updateOffer() {
    const scenario = catalog.find(item => item.id === offerChoices.value)
    if (!scenario) return
    offerTitle.textContent = scenario.trigger.title || 'Нужно помочь освоиться?'
    offerText.textContent = scenario.trigger.text || 'Пройдите короткое обучение.'
    offerStart.textContent = scenario.trigger.buttonText || 'Начать обучение'
    offerStart.style.background = scenario.color
  }
  function renderOffer() {
    if (validator || run || mode || launchPending || !catalog.length) return
    ui()
    const options = eligibleOffers()
    offerChoices.replaceChildren()
    for (const scenario of options) {
      const option = document.createElement('option'); option.value = scenario.id; option.textContent = scenario.name
      offerChoices.append(option)
    }
    offerChoices.hidden = options.length < 2
    offer.hidden = !options.length
    if (options.length) { offerChoices.value = options[0].id; updateOffer() }
  }

  function configureCatalog(config) {
    if (!config || typeof config.siteId !== 'string' || !config.siteId || config.siteId.length > 100 || !Array.isArray(config.scenarios) || config.scenarios.length > 20 || (config.origin && config.origin !== location.origin)) throw new Error('Конфигурация не соответствует сайту.')
    if (!embedded && settings.siteId && config.siteId !== settings.siteId) throw new Error('Идентификатор сайта не совпадает с конфигурацией.')
    const seen = new Set()
    const nextCatalog = config.scenarios.filter(scenario => scenario?.enabled !== false).map(scenario => {
      if (!scenario || typeof scenario.id !== 'string' || !scenario.id || scenario.id.length > 100 || seen.has(scenario.id) || typeof scenario.name !== 'string' || !Array.isArray(scenario.steps) || !scenario.steps.length || scenario.steps.length > 50) throw new Error('Проверьте сценарии в конфигурации.')
      seen.add(scenario.id)
      const trigger = scenario.trigger
      if (!trigger || !['offer', 'click', 'manual'].includes(trigger.type)) throw new Error('Выберите способ запуска сценария.')
      if (trigger.type === 'click') {
        if (typeof trigger.selector !== 'string' || !trigger.selector || trigger.selector.length > 2000) throw new Error('Не задана кнопка запуска сценария.')
        document.querySelector(trigger.selector)
      }
      const stepIds = new Set()
      const steps = scenario.steps.map(step => {
        if (!step || typeof step.id !== 'string' || !step.id || step.id.length > 100 || stepIds.has(step.id) || typeof step.title !== 'string' || typeof step.text !== 'string') throw new Error('Проверьте шаги сценария.')
        stepIds.add(step.id)
        for (const kind of ['desktop', 'mobile']) if (!validConfig(runtimeConfig(step, kind))) throw new Error('Некорректная цель шага.')
        return { ...step, pageUrl: pageUrl(step.pageUrl) }
      })
      return { ...scenario, name: scenario.name.slice(0, 120), steps, color: /^#[0-9a-f]{6}$/i.test(scenario.color) ? scenario.color : '#4f46e5', trigger: { ...trigger, pageUrl: trigger.pageUrl ? pageUrl(trigger.pageUrl) : '' } }
    })
    cancel(); catalog = nextCatalog; siteId = config.siteId
    configVersion = Number.isInteger(config.version) && config.version >= 0 ? config.version : 0
    if (config.resetOffers) removeStored('dismissed')
    const savedDismissed = stored('dismissed')
    dismissed = new Set(Array.isArray(savedDismissed) ? savedDismissed.filter(id => typeof id === 'string') : [])
    renderOffer()
  }

  function runtimeConfig(step, kind) {
    return { selector: step.variants?.[kind]?.selector || step.selector || '', actions: step.variants?.[kind]?.actions || [] }
  }

  function scenarioPayload(scenario) {
    const kind = innerWidth <= 760 ? 'mobile' : 'desktop'
    return { scenarioId: scenario.id, configVersion, color: scenario.color, steps: scenario.steps.map(step => ({ ...step, config: runtimeConfig(step, kind) })) }
  }

  function launchScenario(id) {
    if (run || mode || validator || launchPending) return false
    const scenario = catalog.find(item => item.id === id)
    if (!scenario) return false
    dismissed.add(id); store('dismissed', [...dismissed])
    if (embedded) { launchPending = true; if (offer) offer.hidden = true; emit('scenario_triggered', { scenarioId: id }) }
    else startRun(scenarioPayload(scenario))
    return true
  }

  function showNotice(message) {
    ui(); shadow.getElementById('notice-text').textContent = message || 'Повторите запуск обучения.'; notice.hidden = false
  }

  async function connect() {
    if (embedded) return true
    const url = new URL(settings.configUrl, location.href)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Проверьте адрес конфигурации.')
    siteId = settings.siteId || ''
    let saved = siteId ? stored('run') : null
    const resumable = value => value && Number.isFinite(value.updatedAt) && Date.now() - value.updatedAt >= 0 && Date.now() - value.updatedAt < 3600000
    const pinnedVersion = resumable(saved) && Number.isInteger(saved.configVersion) && saved.configVersion > 0 ? saved.configVersion : null
    if (pinnedVersion !== null) url.searchParams.set('version', String(pinnedVersion))
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000)
    let config
    try {
      const response = await fetch(url.href, { credentials: 'omit', signal: controller.signal })
      if (!response.ok) {
        if (pinnedVersion !== null && response.status === 404) removeStored('run')
        throw new Error('Не удалось загрузить конфигурацию обучения.')
      }
      const body = await response.text()
      if (body.length > 500000) throw new Error('Конфигурация обучения слишком большая.')
      config = JSON.parse(body)
      if (pinnedVersion !== null && config.version !== pinnedVersion) {
        removeStored('run')
        throw new Error('Сервер вернул другую версию обучения. Обновите страницу и повторите запуск тура.')
      }
    } finally { clearTimeout(timer) }
    siteId = settings.siteId || config.siteId
    if (!saved) saved = stored('run')
    configureCatalog(config)
    if (resumable(saved)) {
      const scenario = catalog.find(item => item.id === saved.scenarioId)
      if (scenario && Number.isInteger(saved.index) && saved.index >= 0 && saved.index < scenario.steps.length &&
          typeof saved.runId === 'string' && saved.runId.length > 0 && saved.runId.length <= 100 &&
          JSON.stringify(saved.stepIds) === JSON.stringify(scenario.steps.map(step => step.id))) {
        startRun({ ...scenarioPayload(scenario), runId: saved.runId, index: saved.index, completed: saved.completed, started: true })
      } else removeStored('run')
    } else if (saved) removeStored('run')
    window.dispatchEvent(new CustomEvent('onboarding:ready', { detail: { siteId } }))
    return true
  }

  const ready = connect().catch(error => { emit('configuration_error', { message: error.message }); console.warn('[Onboarding]', error.message); return false })
  window.Onboarding = {
    ready,
    start: async id => { if (!(await ready)) return false; return launchScenario(id) },
    stop: () => { cancel(); renderOffer() },
    scenarios: () => catalog.map(({ id, name }) => ({ id, name })),
  }
})()
