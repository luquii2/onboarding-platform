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
    id: crypto.randomUUID(), name, enabled: true, color: '#4f46e5', steps: [],
    trigger: {
      type: 'offer', pageUrl: '', selector: '',
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
        ...scenario.trigger, type: trigger.type, pageUrl, selector: text(trigger.selector, 2000),
        title: text(trigger.title, 120) || scenario.trigger.title,
        text: text(trigger.text, 500) || scenario.trigger.text,
        buttonText: text(trigger.buttonText, 80) || scenario.trigger.buttonText,
      }
    }
    return scenario
  })
  return {
    schema: 4, siteId: text(value?.siteId, 100) || crypto.randomUUID(), scenarios,
    activeScenarioId: scenarios.some(item => item.id === value?.activeScenarioId) ? value.activeScenarioId : scenarios[0].id,
  }
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
    if (trigger.pageUrl) trigger.pageUrl = canonicalUrl(trigger.pageUrl, baseUrl)
    if (trigger.type === 'click' && !trigger.selector.trim()) throw new Error('Выберите кнопку запуска для сценария «' + scenario.name + '».')
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
