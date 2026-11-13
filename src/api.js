const fieldNames = {
  companyName: 'Название компании', email: 'Email', password: 'Пароль', acceptTerms: 'Согласие с условиями',
  name: 'Название', baseUrl: 'Адрес сайта', baseRevision: 'Ревизия', project: 'Проект',
  title: 'Заголовок', text: 'Текст', pageUrl: 'Страница', selector: 'Выбранный элемент',
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', fields = [] } = {}) {
    super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.fields = fields
  }
}

export function normalizeApiBase(value) {
  const input = String(value || '').trim().replace(/\/+$/, '')
  if (!input) return ''
  if (input.startsWith('/') && !input.startsWith('//')) {
    if (/[?#\\\s]/.test(input)) throw new ApiError('Проверьте адрес API.')
    return input.endsWith('/api/v1') ? input : input + '/api/v1'
  }
  let url
  try { url = new URL(input) } catch { throw new ApiError('Укажите полный адрес сервера, например http://localhost:8000.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ApiError('Нужен адрес HTTP или HTTPS без пароля и параметров.')
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path.endsWith('/api/v1') ? path : path + '/api/v1'
  return url.href.replace(/\/+$/, '')
}

function validationFields(detail) {
  return detail.map(issue => {
    const path = (issue.loc || []).filter(part => !['body', 'query', 'path'].includes(part)).join('.')
    const leaf = issue.loc?.at(-1), label = fieldNames[leaf] || 'Поле'
    const type = issue.type || ''
    let message = 'Проверьте значение.'
    if (type === 'missing') message = 'Заполните это поле.'
    else if (type === 'string_too_short') message = 'Минимум символов: ' + (issue.ctx?.min_length ?? 1) + '.'
    else if (type === 'string_too_long') message = 'Максимум символов: ' + (issue.ctx?.max_length ?? '') + '.'
    else if (leaf === 'email') message = 'Укажите корректный email.'
    else if (leaf === 'acceptTerms') message = 'Подтвердите согласие с условиями.'
    else if (/[а-яё]/i.test(issue.msg || '')) message = issue.msg.replace(/^Value error, /, '')
    return { path, code: type, message, label }
  })
}

function responseError(status, data) {
  const detail = data?.detail ?? data?.error
  if (Array.isArray(detail)) {
    const fields = validationFields(detail)
    return new ApiError(fields[0] ? fields[0].label + ': ' + fields[0].message : 'Проверьте заполнение полей.', { status, code: 'VALIDATION_ERROR', fields })
  }
  const code = typeof detail === 'object' ? detail?.code : ''
  const messages = {
    REVISION_CONFLICT: 'Проект изменён в другой вкладке. Загрузите версию с сервера или скачайте свои изменения.',
    EMAIL_ALREADY_EXISTS: 'Этот email уже зарегистрирован. Войдите в аккаунт.',
    SITE_ALREADY_EXISTS: 'Этот сайт уже добавлен в ваш аккаунт.',
    INVALID_CREDENTIALS: 'Неверный email или пароль.',
    NOT_AUTHENTICATED: 'Войдите в аккаунт, чтобы продолжить.',
    INVALID_TOKEN: 'Вход завершён или срок действия сессии истёк. Войдите снова.',
  }
  const fallback = ({ 401: 'Сессия истекла. Войдите снова.', 403: 'Недостаточно прав для этого действия.', 404: 'Данные не найдены или недоступны вашему аккаунту.', 409: 'Данные изменились. Обновите их перед повторной попыткой.', 413: 'Проект слишком большой для отправки.', 422: 'Проверьте заполнение полей.', 429: 'Слишком много запросов. Повторите немного позже.' })[status] || 'Сервер не смог выполнить запрос. Повторите позже.'
  const supplied = typeof detail?.message === 'string' && /[а-яё]/i.test(detail.message) ? detail.message.slice(0, 400) : ''
  return new ApiError(messages[code] || supplied || fallback, { status, code: code || 'HTTP_' + status })
}

export function authResult(data) {
  const token = data?.accessToken ?? data?.access_token
  if (typeof token !== 'string' || !token || /\s/.test(token) || token.length > 16000) {
    throw new ApiError('Сервер не выдал токен входа. Проверьте адрес API и версию сервера.', { code: 'AUTH_TOKEN_MISSING' })
  }
  const type = data.tokenType ?? data.token_type ?? 'bearer'
  if (String(type).toLowerCase() !== 'bearer') throw new ApiError('Сервер вернул неподдерживаемый способ авторизации.', { code: 'AUTH_RESPONSE_INVALID' })
  return { token, user: data.user || null }
}

export function validateProjectResponse(data, siteId) {
  if (!Number.isInteger(data?.revision) || data.revision < 0 || !data.project || data.project.schema !== 4 || !Array.isArray(data.project.scenarios)) {
    throw new ApiError('Сервер вернул некорректный проект. Черновик не заменён.', { code: 'PROJECT_RESPONSE_INVALID' })
  }
  if (data.project.siteId && data.project.siteId !== siteId) {
    throw new ApiError('В ответе API проект другого сайта. Проверьте обработчик GET /project на бэкенде.', { code: 'PROJECT_SITE_MISMATCH' })
  }
  return { ...data, project: { ...data.project, siteId } }
}

export function createApi({ baseUrl, getToken = () => null, onUnauthorized = () => {}, fetcher = (...args) => fetch(...args), timeout = 12000 }) {
  const base = normalizeApiBase(baseUrl)
  async function request(path, { method = 'GET', body, auth = true, signal, idempotencyKey, token: requestToken } = {}) {
    if (!base) throw new ApiError('Сначала укажите адрес сервера в разделе «Подключение API».', { code: 'API_NOT_CONFIGURED' })
    const token = auth ? requestToken ?? getToken() : null
    if (auth && !token) throw new ApiError('Войдите в аккаунт, чтобы работать с сервером.', { status: 401, code: 'AUTH_REQUIRED' })
    const controller = new AbortController(), abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    const timer = setTimeout(abort, timeout)
    try {
      const headers = { Accept: 'application/json' }
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      if (token) headers.Authorization = 'Bearer ' + token
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
      const response = await fetcher(base + path, { method, headers, credentials: 'omit', signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      const raw = response.status === 204 ? '' : await response.text()
      let data = null
      try { if (raw) data = JSON.parse(raw) } catch {
        if (response.ok) throw new ApiError('По этому адресу вернулась HTML-страница вместо API. Проверьте адрес сервера и proxy.', { code: 'API_RESPONSE_INVALID' })
      }
      if (!response.ok) {
        if (response.status === 401 && auth) onUnauthorized(token)
        throw responseError(response.status, data)
      }
      return data
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (signal?.aborted) throw new ApiError('Запрос отменён.', { code: 'REQUEST_CANCELLED' })
      if (controller.signal.aborted) throw new ApiError('Сервер не ответил вовремя. Проверьте, что он запущен.', { code: 'REQUEST_TIMEOUT' })
      throw new ApiError('Не удалось связаться с API. Проверьте адрес сервера и разрешение CORS для панели.', { code: 'NETWORK_ERROR' })
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
  const id = value => encodeURIComponent(value)
  return {
    base, request,
    register: body => request('/auth/register', { method: 'POST', body, auth: false }),
    login: body => request('/auth/login', { method: 'POST', body, auth: false }),
    me: options => request('/auth/me', options),
    logout: () => request('/auth/logout', { method: 'POST' }),
    logoutAll: () => request('/auth/logout-all', { method: 'POST' }),
    async sites() {
      const data = await request('/sites'), items = Array.isArray(data) ? data : data?.items
      if (!Array.isArray(items)) throw new ApiError('Сервер вернул некорректный список сайтов.', { code: 'SITES_RESPONSE_INVALID' })
      return items
    },
    createSite: body => request('/sites', { method: 'POST', body }),
    site: siteId => request('/sites/' + id(siteId)),
    installation: siteId => request('/sites/' + id(siteId) + '/installation'),
    async loadProject(siteId) { return validateProjectResponse(await request('/sites/' + id(siteId) + '/project'), siteId) },
    async saveProject(siteId, body) { return validateProjectResponse(await request('/sites/' + id(siteId) + '/project', { method: 'PUT', body }), siteId) },
    configUrl: siteId => base + '/public/sites/' + id(siteId) + '/config',
    publicConfig: (siteId, version) => request('/public/sites/' + id(siteId) + '/config' + (Number.isInteger(version) ? '?version=' + version : ''), { auth: false }),
    publish: (siteId, revision, idempotencyKey) => request('/sites/' + id(siteId) + '/publications', { method: 'POST', body: { projectRevision: revision }, idempotencyKey }),
    async health() {
      if (!base) throw new ApiError('Укажите адрес API.')
      const healthBase = base.replace(/\/api\/v1$/, '')
      const client = createApi({ baseUrl: base, fetcher: (url, options) => fetcher(healthBase + '/testconnect/', options), timeout })
      return client.request('/health', { auth: false })
    },
  }
}
