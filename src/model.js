export const DEVICES = {
  desktop: { label: 'Компьютер', width: 1100, height: 740 },
  mobile: { label: 'Телефон', width: 390, height: 740 },
}

export function canonicalUrl(value, base) {
  const url = new URL(value || base, base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Нужен обычный адрес страницы сайта.')
  }
  if (url.origin !== new URL(base).origin) throw new Error('Выберите страницу подключенного сайта.')
  url.hash = ''
  return url.href
}

const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : ''

export function normalizeActions(actions) {
  if (!Array.isArray(actions)) return []
  return actions.slice(0, 20).filter(action => action &&
    ['click', 'select'].includes(action.kind) && typeof action.selector === 'string' &&
    action.selector.length > 0 && action.selector.length <= 2000 &&
    (action.kind !== 'select' || typeof action.value === 'string')
  ).map(action => ({
    kind: action.kind, selector: action.selector,
    label: text(action.label, 100),
    ...(action.kind === 'select' ? { value: text(action.value, 500) } : {}),
  }))
}

export function createStep(pageUrl, number = 1) {
  return {
    id: crypto.randomUUID(), title: 'Шаг ' + number, text: '', pageUrl, selector: '',
    variants: { desktop: { selector: '', actions: [] }, mobile: { selector: '', actions: [] } },
  }
}

export function normalizeStep(value, baseUrl, number = 1) {
  if (!value || typeof value !== 'object') return null
  let pageUrl
  try { pageUrl = canonicalUrl(value.pageUrl, baseUrl) } catch { pageUrl = baseUrl }
  const legacyMobileActions = typeof value.menuToggleSelector === 'string' && value.menuToggleSelector
    ? [{ kind: 'click', selector: value.menuToggleSelector, label: 'Открыть элемент' }] : []
  return {
    id: text(value.id, 100) || crypto.randomUUID(),
    title: typeof value.title === 'string' ? text(value.title, 120) : 'Шаг ' + number,
    text: text(value.text, 2000), pageUrl, selector: text(value.selector, 2000),
    variants: {
      desktop: {
        selector: text(value.variants?.desktop?.selector, 2000),
        actions: normalizeActions(value.variants?.desktop?.actions),
      },
      mobile: {
        selector: text(value.variants?.mobile?.selector ?? value.mobileSelector, 2000),
        actions: normalizeActions(value.variants?.mobile?.actions ?? legacyMobileActions),
      },
    },
  }
}

export function readDraft(value, baseUrl) {
  if (!value || !Array.isArray(value.steps)) return { steps: [], color: '#4f46e5' }
  const seen = new Set()
  const steps = value.steps.slice(0, 50).map((step, i) => normalizeStep(step, baseUrl, i + 1)).filter(Boolean)
  for (const step of steps) {
    if (seen.has(step.id)) step.id = crypto.randomUUID()
    seen.add(step.id)
  }
  return { steps, color: /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : '#4f46e5' }
}

export function configFor(step, device) {
  const variant = step.variants?.[device]
  return { selector: variant?.selector || step.selector || '', actions: normalizeActions(variant?.actions) }
}

export function isDraft(step) {
  return !step.selector && !step.variants?.desktop?.selector && !step.variants?.mobile?.selector
}

export function applyTarget(step, device, target, actions = []) {
  if (!target || typeof target.selector !== 'string' || !target.selector) throw new Error('Цель не выбрана.')
  if (!step.selector) step.selector = target.selector
  step.variants[device] = { selector: target.selector, actions: normalizeActions(actions) }
}

export function validationKey(step) {
  if (!step) return ''
  return JSON.stringify({ id: step.id, pageUrl: step.pageUrl, selector: step.selector, variants: step.variants })
}

export function createScenario(name = 'Новый сценарий') {
  return {
    id: crypto.randomUUID(), name, enabled: true, color: '#4f46e5', steps: [], triggerConfirmation: '',
    trigger: {
      type: 'offer', pageScope: 'all', pageUrl: '', selector: '', label: '',
      title: 'Показать, как всё устроено?',
      text: 'Пройдите короткое обучение и познакомьтесь с возможностями сайта.',
      buttonText: 'Начать обучение',
    },
  }
}

export function readProject(value, baseUrl) {
  const source = Array.isArray(value?.scenarios) && value.scenarios.length
    ? value.scenarios.slice(0, 20) : [{ ...readDraft(value, baseUrl), name: 'Основной сценарий' }]
  const seen = new Set()
  const scenarios = source.map((item, index) => {
    const scenario = createScenario(text(item?.name, 120) || 'Сценарий ' + (index + 1))
    scenario.id = text(item?.id, 100) || scenario.id
    if (seen.has(scenario.id)) scenario.id = crypto.randomUUID()
    seen.add(scenario.id)
    Object.assign(scenario, readDraft(item, baseUrl))
    scenario.enabled = item?.enabled !== false
    const trigger = item?.trigger
    if (trigger && ['offer', 'click', 'manual'].includes(trigger.type)) {
      let pageUrl = ''
      try { if (trigger.pageUrl) pageUrl = canonicalUrl(trigger.pageUrl, baseUrl) } catch { /* A new page can be selected in the editor. */ }
      scenario.trigger = {
        ...scenario.trigger, type: trigger.type, pageUrl, selector: text(trigger.selector, 2000), label: text(trigger.label, 100),
        pageScope: ['all', 'page'].includes(trigger.pageScope) ? trigger.pageScope : trigger.pageUrl ? 'page' : 'all',
        title: typeof trigger.title === 'string' ? text(trigger.title, 120) : scenario.trigger.title,
        text: typeof trigger.text === 'string' ? text(trigger.text, 500) : scenario.trigger.text,
        buttonText: typeof trigger.buttonText === 'string' ? text(trigger.buttonText, 80) : scenario.trigger.buttonText,
      }
    }
    scenario.triggerConfirmation = text(item?.triggerConfirmation, 16000)
    return scenario
  })
  const pages = new Map([[canonicalUrl(baseUrl, baseUrl), { url: canonicalUrl(baseUrl, baseUrl), title: 'Главная страница' }]])
  for (const page of Array.isArray(value?.pages) ? value.pages.slice(-100) : []) {
    if (typeof page?.url !== 'string' || !page.url) continue
    try {
      const url = canonicalUrl(page?.url, baseUrl)
      pages.set(url, { url, title: text(page?.title, 256) })
    } catch { /* Only pages of this site can be selected. */ }
  }
  return {
    schema: 4, siteId: text(value?.siteId, 100) || crypto.randomUUID(), scenarios, pages: [...pages.values()],
    activeScenarioId: scenarios.some(item => item.id === value?.activeScenarioId) ? value.activeScenarioId : scenarios[0].id,
  }
}

export function triggerErrors(trigger, baseUrl) {
  const errors = {}
  if (!trigger || !['offer', 'click', 'manual'].includes(trigger.type)) return { type: 'Выберите способ запуска.' }
  if (trigger.type === 'offer') {
    if (typeof trigger.title !== 'string' || !trigger.title.trim()) errors.title = 'Добавьте заголовок приглашения.'
    if (typeof trigger.text !== 'string' || !trigger.text.trim()) errors.text = 'Добавьте текст приглашения.'
    if (typeof trigger.buttonText !== 'string' || !trigger.buttonText.trim()) errors.buttonText = 'Добавьте текст кнопки.'
  }
  if (trigger.type === 'click' && (typeof trigger.selector !== 'string' || !trigger.selector.trim())) errors.selector = 'Выберите элемент запуска в окне сайта.'
  if (trigger.type !== 'manual' && !['all', 'page'].includes(triggerPageScope(trigger))) errors.pageUrl = 'Выберите, на каких страницах запускать сценарий.'
  if (trigger.type !== 'manual' && triggerPageScope(trigger) === 'page') {
    if (typeof trigger.pageUrl !== 'string' || !trigger.pageUrl.trim()) errors.pageUrl = 'Выберите страницу из списка или используйте открытую страницу сайта.'
    else try { canonicalUrl(trigger.pageUrl, baseUrl) } catch { errors.pageUrl = 'Выберите страницу подключённого сайта.' }
  }
  return errors
}

const triggerPageScope = trigger => trigger.pageScope ?? (trigger.pageUrl ? 'page' : 'all')

export function triggerKey(trigger) {
  return JSON.stringify({
    type: trigger.type,
    pageScope: trigger.type === 'manual' ? 'all' : triggerPageScope(trigger),
    pageUrl: trigger.type !== 'manual' && triggerPageScope(trigger) === 'page' ? trigger.pageUrl : '',
    ...(trigger.type === 'offer' ? { title: trigger.title, text: trigger.text, buttonText: trigger.buttonText } : {}),
    ...(trigger.type === 'click' ? { selector: trigger.selector } : {}),
  })
}

export function triggerIsReady(scenario, baseUrl) {
  return !Object.keys(triggerErrors(scenario.trigger, baseUrl)).length && scenario.triggerConfirmation === triggerKey(scenario.trigger)
}

export function confirmTrigger(scenario, baseUrl) {
  const errors = triggerErrors(scenario.trigger, baseUrl)
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0])
  const trigger = scenario.trigger
  trigger.pageScope = triggerPageScope(trigger)
  if (trigger.type !== 'manual' && trigger.pageScope === 'page') trigger.pageUrl = canonicalUrl(trigger.pageUrl, baseUrl)
  for (const field of ['title', 'text', 'buttonText', 'selector']) if (typeof trigger[field] === 'string') trigger[field] = trigger[field].trim()
  scenario.triggerConfirmation = triggerKey(trigger)
}

export function createPlayback(scenario, device, baseUrl) {
  if (!scenario.steps.length) throw new Error('Добавьте шаги в сценарий «' + scenario.name + '».')
  const draftIndex = scenario.steps.findIndex(isDraft)
  if (draftIndex !== -1) throw new Error('Выберите цель шага ' + (draftIndex + 1) + ' в сценарии «' + scenario.name + '».')
  return {
    id: crypto.randomUUID(), scenarioId: scenario.id, scenarioName: scenario.name,
    color: scenario.color, index: 0, completed: [], started: false,
    steps: scenario.steps.map(step => ({
      id: step.id, title: step.title, text: step.text,
      pageUrl: canonicalUrl(step.pageUrl, baseUrl), config: configFor(step, device),
    })),
  }
}

export function exportProject(project, baseUrl) {
  const scenarios = project.scenarios.filter(scenario => scenario.enabled).map(scenario => {
    createPlayback(scenario, 'desktop', baseUrl)
    const trigger = { ...scenario.trigger }
    const errors = triggerErrors(trigger, baseUrl)
    if (Object.keys(errors).length) throw new Error(Object.values(errors)[0])
    if (!triggerIsReady(scenario, baseUrl)) throw new Error('Сохраните настройки запуска сценария «' + scenario.name + '».')
    trigger.pageUrl = trigger.type !== 'manual' && triggerPageScope(trigger) === 'page' ? canonicalUrl(trigger.pageUrl, baseUrl) : ''
    return {
      id: scenario.id, name: scenario.name, color: scenario.color, trigger,
      steps: scenario.steps.map(step => ({
        id: step.id, title: step.title, text: step.text, pageUrl: canonicalUrl(step.pageUrl, baseUrl),
        selector: step.selector,
        variants: { desktop: configFor(step, 'desktop'), mobile: configFor(step, 'mobile') },
      })),
    }
  })
  if (!scenarios.length) throw new Error('Включите хотя бы один готовый сценарий.')
  const config = { schema: 1, siteId: project.siteId, origin: new URL(baseUrl).origin, scenarios }
  if (JSON.stringify(config, null, 2).length > 500000) throw new Error('Сократите содержимое сценариев: конфигурация превышает 500 КБ.')
  return config
}
