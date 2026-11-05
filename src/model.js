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
