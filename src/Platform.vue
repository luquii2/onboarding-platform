<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import TourEditor from './App.vue'
import { ApiError, authResult, createApi, normalizeApiBase } from './api.js'
import './platform.css'

const SESSION_KEY = 'onboarding-session:v1', API_KEY = 'onboarding-api:v1'
const demoUrl = import.meta.env.VITE_DEMO_SITE_URL || 'http://localhost:4174/'
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
let storedBase = ''
try { storedBase = localStorage.getItem(API_KEY) || '' } catch { /* The configured environment still works without storage. */ }
let initialApi = ''
try { initialApi = normalizeApiBase(storedBase || import.meta.env.VITE_API_BASE_URL || (local ? '/api/v1' : '')) } catch { initialApi = local ? '/api/v1' : '' }
const apiBase = ref(initialApi)
const apiInput = ref(apiBase.value), connectionOpen = ref(false), connectionError = ref(''), healthMessage = ref(''), checkingHealth = ref(false)
const token = ref(null), user = ref(null), previousUserId = ref(null), booting = ref(true)
const route = ref(location.hash.slice(1) || '/login'), mode = ref('auth'), authMode = ref('login')
const working = ref(false), authError = ref(''), authFields = ref([]), authNotice = ref('')
const credentials = ref({ companyName: '', email: '', password: '', acceptTerms: false })
const sites = ref([]), loadingSites = ref(false), pageError = ref(''), pageNotice = ref('')
const editor = ref(null), editorSite = ref(null), editorDocument = ref(null)
const siteDialog = ref(null), siteSaving = ref(false), siteError = ref(''), siteFields = ref([]), siteForm = ref({ name: '', baseUrl: '' })
const installDialog = ref(null), installation = ref(null), installSite = ref(null), installError = ref(''), installBusy = ref(false), publicResult = ref(null), copied = ref(false)
let routeTicket = 0, authTicket = 0, disposed = false
const api = computed(() => createApi({ baseUrl: apiBase.value, getToken: () => token.value, onUnauthorized: expiredToken => {
  if (token.value !== expiredToken) return
  credentials.value.email = user.value?.email || credentials.value.email
  previousUserId.value = user.value?.id ?? previousUserId.value
  clearSession(); authError.value = 'Сессия истекла. Войдите снова; открытый черновик остаётся в редакторе.'
  siteDialog.value?.close(); installDialog.value?.close()
  location.hash = '/login'
} }))
const isRegister = computed(() => authMode.value === 'register')
const displayName = computed(() => user.value?.companyName || user.value?.email || '')
const installConfigUrl = computed(() => installation.value?.configUrl || '')

function clearSession() {
  token.value = null; user.value = null; sites.value = []
  try { sessionStorage.removeItem(SESSION_KEY) } catch { /* Current in-memory state is still cleared. */ }
}
function storeSession() {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ apiBase: apiBase.value, token: token.value })) } catch { /* The session remains valid until this page closes. */ }
}
function validUser(value) {
  if (value?.id === undefined || typeof value.email !== 'string') throw new ApiError('Сервер вернул некорректные данные аккаунта.', { code: 'USER_RESPONSE_INVALID' })
  return value
}
function fieldError(fields, name) { return fields.find(field => field.path === name)?.message || '' }
function statusLabel(status) { return ({ connected: 'Виджет отвечает', inactive: 'Нет недавних сигналов', not_detected: 'Виджет не обнаружен' })[status] || 'Статус неизвестен' }
function safeSiteUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined } catch { return undefined }
}
function date(value) {
  const parsed = value ? new Date(value) : null
  return parsed && Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('ru', { dateStyle: 'short', timeStyle: 'short' }).format(parsed) : 'Сигналов ещё не было'
}

async function mayLeave() { return !editor.value || await editor.value.mayLeave() }
async function go(path) {
  if (path === route.value) return
  if (editorSite.value && !await mayLeave()) return
  if (path !== '/login' && path !== '/register') { editorSite.value = null; editorDocument.value = null }
  location.hash = path
}
async function handleRoute() {
  const ticket = ++routeTicket
  route.value = location.hash.slice(1) || '/login'
  pageError.value = ''; pageNotice.value = ''
  if (route.value === '/demo') { mode.value = 'demo'; return }
  if (['/login', '/register'].includes(route.value)) {
    mode.value = 'auth'; authMode.value = route.value === '/register' ? 'register' : 'login'; authFields.value = []
    return
  }
  if (!user.value) { location.hash = '/login'; mode.value = 'auth'; return }
  if (route.value === '/sites') { mode.value = 'sites'; await refreshSites(); return }
  const match = /^\/sites\/([^/]+)$/.exec(route.value)
  if (!match) { location.hash = '/sites'; return }
  let siteId
  try { siteId = decodeURIComponent(match[1]) } catch { location.hash = '/sites'; return }
  if (editorSite.value?.id === siteId && editorDocument.value) { mode.value = 'editor'; return }
  mode.value = 'loading'
  try {
    const [site, document] = await Promise.all([api.value.site(siteId), api.value.loadProject(siteId)])
    if (ticket !== routeTicket || disposed) return
    if (site.id !== siteId || !site.baseUrl) throw new ApiError('Сервер вернул данные другого сайта.')
    const url = new URL(site.baseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== site.origin) throw new ApiError('Проверьте baseUrl и origin сайта в ответе API.')
    editorSite.value = site; editorDocument.value = document; mode.value = 'editor'
  } catch (error) { if (ticket === routeTicket) { pageError.value = error.message; mode.value = user.value ? 'sites' : 'auth' } }
}

async function refreshSites() {
  const currentApi = api.value, currentToken = token.value
  loadingSites.value = true; pageError.value = ''
  try {
    const loaded = await currentApi.sites()
    if (currentToken === token.value && currentApi === api.value) sites.value = loaded
  } catch (error) { if (currentToken === token.value) pageError.value = error.message }
  finally { if (currentApi === api.value) loadingSites.value = false }
}

async function signInResponse(response) {
  const session = authResult(response), before = previousUserId.value ?? user.value?.id
  token.value = session.token
  try {
    const loadedUser = validUser(session.user || await api.value.me())
    if (loadedUser.email.toLowerCase() !== credentials.value.email.trim().toLowerCase()) throw new ApiError('Сервер вернул другой аккаунт. Проверьте ответ авторизации.')
    if (before !== undefined && before !== null && before !== loadedUser.id) { editorSite.value = null; editorDocument.value = null }
    user.value = loadedUser; previousUserId.value = loadedUser.id; storeSession()
    credentials.value.password = ''; authError.value = ''; authNotice.value = ''
    location.hash = editorSite.value ? '/sites/' + encodeURIComponent(editorSite.value.id) : '/sites'
    await handleRoute()
  } catch (error) { clearSession(); throw error }
}

async function submitAuth() {
  if (working.value) return
  const ticket = ++authTicket, registering = isRegister.value
  working.value = true; authError.value = ''; authFields.value = []; authNotice.value = ''
  try {
    const data = { email: credentials.value.email.trim(), password: credentials.value.password }
    if (registering) {
      const response = await api.value.register({ ...data, companyName: credentials.value.companyName.trim(), acceptTerms: credentials.value.acceptTerms })
      if (ticket !== authTicket || disposed) return
      credentials.value.acceptTerms = false
      if (response?.accessToken || response?.access_token) await signInResponse(response)
      else {
        credentials.value.password = ''; authNotice.value = 'Регистрация принята сервером. Теперь войдите в аккаунт.'
        location.hash = '/login'; authMode.value = 'login'
      }
    } else {
      const response = await api.value.login(data)
      if (ticket === authTicket && !disposed) await signInResponse(response)
    }
  } catch (error) { if (ticket === authTicket) { authError.value = error.message; authFields.value = error.fields || [] } }
  finally { if (ticket === authTicket) working.value = false }
}

async function signOut() {
  if (!await mayLeave()) return
  working.value = true
  let notice = ''
  try { await api.value.logout() } catch (error) { if (error.status !== 401) notice = 'Вы вышли из аккаунта в этой вкладке. Сервер не подтвердил завершение сессии.' }
  clearSession(); previousUserId.value = null; editorSite.value = null; editorDocument.value = null
  working.value = false; authNotice.value = notice; authError.value = ''; location.hash = '/login'
}

async function configureApi() {
  connectionError.value = ''; healthMessage.value = ''
  try {
    const value = normalizeApiBase(apiInput.value)
    if (!value) throw new ApiError('Укажите адрес сервера API.')
    if (value === apiBase.value) return
    if (!await mayLeave()) return
    authTicket++; routeTicket++; working.value = false
    clearSession(); previousUserId.value = null; editorSite.value = null; editorDocument.value = null
    credentials.value.password = ''
    apiBase.value = value; apiInput.value = value
    try { localStorage.setItem(API_KEY, value) } catch { /* The entered address remains active in this tab. */ }
    authNotice.value = 'Адрес API сохранён. Войдите в аккаунт этого сервера.'; authError.value = ''; location.hash = '/login'
    connectionOpen.value = false
  } catch (error) { connectionError.value = error.message }
}

async function checkHealth() {
  checkingHealth.value = true; connectionError.value = ''; healthMessage.value = ''
  try {
    if (normalizeApiBase(apiInput.value) !== apiBase.value) throw new ApiError('Сначала сохраните новый адрес API.')
    const result = await api.value.health()
    if (result?.status !== 'ok' || result?.database !== 'ok') throw new ApiError('Сервер не подтвердил подключение к базе данных.')
    healthMessage.value = 'Сервер и база данных доступны.'
  } catch (error) { connectionError.value = error.status >= 500 ? 'Сервер ответил ошибкой проверки БД. Проверьте запуск PostgreSQL и DATABASE_URL.' : error.message }
  finally { checkingHealth.value = false }
}

async function openCreateSite() {
  siteError.value = ''; siteFields.value = []; siteForm.value = { name: '', baseUrl: '' }
  await nextTick(); siteDialog.value.showModal()
}
function useDemoSite() { siteForm.value = { name: 'Школа «Шаг»', baseUrl: demoUrl } }
async function createSite() {
  if (siteSaving.value) return
  siteSaving.value = true; siteError.value = ''; siteFields.value = []
  try {
    const url = new URL(siteForm.value.baseUrl.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ApiError('Укажите адрес сайта HTTP или HTTPS без пароля и параметров.')
    const response = await api.value.createSite({ name: siteForm.value.name.trim(), baseUrl: url.href })
    if (!response?.id) throw new ApiError('Сервер не выдал идентификатор сайта.')
    if (sites.value.some(site => site.id === response.id)) throw new ApiError('Сервер вернул ID уже существующего сайта. Проверьте обработчик создания сайта.')
    const loaded = await api.value.sites()
    const saved = loaded.find(site => site.id === response.id && site.baseUrl === response.baseUrl)
    if (!saved) throw new ApiError('Сайт отсутствует в повторно загруженном списке. Проверьте сохранение сайта в базе данных.')
    sites.value = loaded; pageNotice.value = 'Сайт «' + saved.name + '» добавлен.'; siteDialog.value.close()
  } catch (error) { siteError.value = error instanceof TypeError ? 'Укажите полный адрес, например https://example.com/.' : error.message; siteFields.value = error.fields || [] }
  finally { siteSaving.value = false }
}

async function openInstallation(site) {
  installSite.value = site; installation.value = null; publicResult.value = null; installError.value = ''; copied.value = false
  installDialog.value.showModal(); installBusy.value = true
  try {
    const result = await api.value.installation(site.id)
    if (result.siteId !== site.id || typeof result.scriptTag !== 'string') throw new ApiError('Сервер вернул некорректный код подключения.')
    installation.value = result
  } catch (error) { installError.value = error.message }
  finally { installBusy.value = false }
}
async function copyScript() {
  try { await navigator.clipboard.writeText(installation.value.scriptTag); copied.value = true }
  catch { installError.value = 'Не удалось скопировать автоматически. Выделите и скопируйте код из поля.' }
}
async function checkPublicConfig() {
  installBusy.value = true; installError.value = ''; publicResult.value = null
  try {
    const result = await api.value.publicConfig(installSite.value.id)
    if (result?.siteId !== installSite.value.id || result?.schema !== 1 || !Array.isArray(result.scenarios)) throw new ApiError('Сервер вернул некорректную конфигурацию виджета.')
    if (result.origin && result.origin !== new URL(installSite.value.baseUrl).origin) throw new ApiError('Публичная конфигурация относится к другому домену. Проверьте GET /public/sites/{siteId}/config.')
    publicResult.value = { version: result.version, count: result.scenarios.length }
  } catch (error) { installError.value = error.message }
  finally { installBusy.value = false }
}

async function onHashChange() {
  if (booting.value || route.value === (location.hash.slice(1) || '/login')) return
  const target = location.hash.slice(1)
  if (editorSite.value && mode.value === 'editor' && target !== '/login') {
    if (!await mayLeave()) { history.replaceState(null, '', '#' + route.value); return }
    editorSite.value = null; editorDocument.value = null
  }
  handleRoute()
}
onMounted(async () => {
  window.addEventListener('hashchange', onHashChange)
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null')
    if (session?.apiBase === apiBase.value && typeof session.token === 'string' && session.token) {
      token.value = session.token; user.value = validUser(await api.value.me()); previousUserId.value = user.value.id
      if (route.value === '/login') location.hash = '/sites'
    }
  } catch (error) { clearSession(); if (error instanceof ApiError && error.status !== 401) authError.value = error.message }
  finally { booting.value = false; await handleRoute() }
})
onBeforeUnmount(() => { disposed = true; routeTicket++; authTicket++; window.removeEventListener('hashchange', onHashChange) })
</script>

<template>
  <div class="platform-shell">
    <header class="platform-header">
      <a class="platform-brand" href="#/sites" @click.prevent="go(user ? '/sites' : '/login')"><span class="brand-mark">о</span>Онбординг</a>
      <div class="platform-nav">
        <button class="text-button" :aria-expanded="connectionOpen" @click="connectionOpen = !connectionOpen">Подключение API</button>
        <span v-if="user" class="account-name">{{ displayName }}</span>
        <button v-if="user" class="button small" :disabled="working" @click="signOut">Выйти</button>
        <button v-else-if="mode === 'demo'" class="button small" @click="go('/login')">Войти в кабинет</button>
      </div>
    </header>

    <section v-if="connectionOpen" class="api-settings panel" aria-label="Подключение API">
      <form @submit.prevent="configureApi">
        <label class="field">Адрес сервера API<input v-model="apiInput" placeholder="http://localhost:8000" autocomplete="url" required></label>
        <div class="inline-actions"><button class="button primary" type="submit">Сохранить адрес</button><button class="button" type="button" :disabled="checkingHealth || !apiBase" @click="checkHealth">{{ checkingHealth ? 'Проверяем…' : 'Проверить сервер и БД' }}</button></div>
      </form>
      <p class="hint">Для локальной разработки можно оставить /api/v1: панель перенаправляет запросы на сервер порта 8000.</p>
      <p v-if="connectionError" class="form-error" role="alert">{{ connectionError }}</p><p v-if="healthMessage" class="form-success" role="status">{{ healthMessage }}</p>
    </section>

    <main v-if="booting || mode === 'loading'" class="platform-content"><p class="loading-state" role="status">{{ booting ? 'Проверяем сессию…' : 'Загружаем сайт и проект с сервера…' }}</p></main>

    <main v-else-if="mode === 'auth'" class="auth-layout">
      <section class="auth-story"><p class="eyebrow">ИНТЕРАКТИВНОЕ ОБУЧЕНИЕ</p><h1>Помогите пользователям<br>сделать первый шаг.</h1><p>Добавьте сайт, создайте сценарий и проведите посетителя по нужным действиям.</p><div class="story-flow"><span>01 · Сайт</span><span>02 · Сценарий</span><span>03 · Обучение</span></div><button class="button" @click="go('/demo')">Открыть демоконструктор</button><p class="hint">Демоконструктор доступен без аккаунта. Его черновик сохраняется только в этом браузере.</p></section>
      <section class="auth-card panel" aria-label="Вход и регистрация">
        <div class="auth-tabs"><button :class="{ active: !isRegister }" :disabled="working" @click="authError = ''; authNotice = ''; go('/login')">Вход</button><button :class="{ active: isRegister }" :disabled="working" @click="authError = ''; authNotice = ''; go('/register')">Регистрация</button></div>
        <h2>{{ isRegister ? 'Создать аккаунт' : 'Войти в кабинет' }}</h2><p class="hint">{{ isRegister ? 'Все сайты и сценарии вашей команды в одном месте.' : 'Продолжите работу со своими сайтами и сценариями.' }}</p>
        <p v-if="!apiBase" class="form-note">Для работы кабинета укажите адрес сервера в разделе «Подключение API».</p>
        <p v-if="authError" class="form-error" role="alert">{{ authError }}</p><p v-if="authNotice" class="form-success" role="status">{{ authNotice }}</p>
        <form @submit.prevent="submitAuth">
          <label v-if="isRegister" class="field">Название компании<input v-model="credentials.companyName" required maxlength="200" autocomplete="organization" :disabled="working" :aria-invalid="!!fieldError(authFields, 'companyName')"></label>
          <label class="field">Email<input v-model="credentials.email" type="email" required maxlength="254" autocomplete="email" :disabled="working" :readonly="!!editorSite" :aria-invalid="!!fieldError(authFields, 'email')"></label>
          <label class="field">Пароль<input v-model="credentials.password" type="password" required :minlength="isRegister ? 8 : 1" maxlength="128" :autocomplete="isRegister ? 'new-password' : 'current-password'" :disabled="working" :aria-invalid="!!fieldError(authFields, 'password')"></label>
          <p v-if="isRegister" class="hint">Не менее 8 символов.</p>
          <label v-if="isRegister" class="terms-field"><input v-model="credentials.acceptTerms" type="checkbox" required :disabled="working">Принимаю условия использования</label>
          <button class="button primary full-width auth-submit" type="submit" :disabled="working || !apiBase">{{ working ? 'Отправляем…' : isRegister ? 'Зарегистрироваться' : 'Войти' }}</button>
        </form>
      </section>
    </main>

    <main v-else-if="mode === 'sites'" class="platform-content">
      <div class="sites-heading"><div><p class="eyebrow">ЛИЧНЫЙ КАБИНЕТ</p><h1>Мои сайты <span class="sites-count">{{ sites.length }}</span></h1><p class="hint">Выберите сайт, чтобы продолжить работу со сценариями.</p></div><div class="inline-actions"><button class="button" :disabled="loadingSites" @click="refreshSites">Обновить список</button><button class="button primary" @click="openCreateSite">+ Добавить сайт</button></div></div>
      <p v-if="pageError" class="form-error" role="alert">{{ pageError }}</p><p v-if="pageNotice" class="form-success" role="status">{{ pageNotice }}</p>
      <p v-if="loadingSites" class="loading-state" role="status">Загружаем ваши сайты…</p>
      <section v-else-if="!sites.length && !pageError" class="empty-sites panel"><span class="empty-site-icon">↗</span><h2>Добавьте свой первый сайт</h2><p>После добавления можно настроить обучение и получить скрипт виджета.</p><button class="button primary" @click="openCreateSite">Добавить сайт</button></section>
      <div v-else class="site-grid"><article v-for="site in sites" :key="site.id" class="site-card panel"><div class="site-card-top"><span class="site-monogram">{{ site.name?.slice(0, 1).toUpperCase() }}</span><span class="site-status" :class="site.installationStatus">{{ statusLabel(site.installationStatus) }}</span></div><h2>{{ site.name }}</h2><a :href="safeSiteUrl(site.baseUrl)" target="_blank" rel="noopener noreferrer" class="site-url">{{ site.baseUrl }}</a><p class="hint">{{ site.lastSeenAt ? 'Последний сигнал: ' + date(site.lastSeenAt) : 'Установите виджет, чтобы проверить подключение.' }}</p><div class="site-card-actions"><button class="button primary" @click="go('/sites/' + encodeURIComponent(site.id))">Открыть конструктор</button><button class="button" @click="openInstallation(site)">Код подключения</button></div></article></div>
    </main>

    <div v-if="mode === 'demo'" class="demo-heading"><button class="text-button" @click="go(user ? '/sites' : '/login')">← {{ user ? 'Мои сайты' : 'Личный кабинет' }}</button><span>Локальный демочерновик · без сохранения на сервере</span></div>
    <TourEditor v-if="mode === 'demo'" :key="'demo'" />
    <div v-if="editorSite && !booting" v-show="mode === 'editor'" class="cloud-editor">
      <div class="editor-heading"><button class="text-button" @click="go('/sites')">← Мои сайты</button><span>{{ editorSite.name }}</span><button class="text-button" @click="openInstallation(editorSite)">Код подключения</button></div>
      <TourEditor :key="editorSite.id + ':' + previousUserId" ref="editor" :site="editorSite" :initial-document="editorDocument" :api="api" />
    </div>

    <dialog ref="siteDialog" class="platform-dialog" aria-labelledby="add-site-title" @cancel="siteSaving && $event.preventDefault()">
      <div class="dialog-heading"><h2 id="add-site-title">Добавить сайт</h2><button class="dialog-close" aria-label="Закрыть добавление сайта" :disabled="siteSaving" @click="siteDialog.close()">×</button></div>
      <p class="hint">Укажите главную страницу сайта или адрес проекта в подпапке.</p><p v-if="siteError" class="form-error" role="alert">{{ siteError }}</p>
      <form @submit.prevent="createSite"><label class="field">Название сайта<input v-model="siteForm.name" required maxlength="200" :disabled="siteSaving" :aria-invalid="!!fieldError(siteFields, 'name')" autofocus></label><label class="field">Адрес сайта<input v-model="siteForm.baseUrl" type="url" placeholder="https://example.com/" required maxlength="2048" :disabled="siteSaving" :aria-invalid="!!fieldError(siteFields, 'baseUrl')"></label><button class="text-button" type="button" :disabled="siteSaving" @click="useDemoSite">Подставить адрес демосайта</button><div class="dialog-actions"><button class="button" type="button" :disabled="siteSaving" @click="siteDialog.close()">Отмена</button><button class="button primary" type="submit" :disabled="siteSaving">{{ siteSaving ? 'Сохраняем…' : 'Добавить сайт' }}</button></div></form>
    </dialog>

    <dialog ref="installDialog" class="platform-dialog installation-dialog" aria-labelledby="installation-title">
      <div class="dialog-heading"><h2 id="installation-title">Подключение {{ installSite?.name }}</h2><button class="dialog-close" aria-label="Закрыть код подключения" @click="installDialog.close()">×</button></div><p class="hint">Установите этот скрипт на все страницы, участвующие в обучении. Для SPA достаточно общей точки входа.</p>
      <p v-if="installBusy" role="status">Загружаем данные с сервера…</p><p v-if="installError" class="form-error" role="alert">{{ installError }}</p>
      <template v-if="installation"><label class="field">Скрипт виджета<textarea class="script-output" :value="installation.scriptTag" rows="5" readonly @focus="$event.target.select()" /></label><div class="inline-actions"><button class="button primary" @click="copyScript">{{ copied ? 'Скопировано' : 'Копировать скрипт' }}</button><button class="button" :disabled="installBusy" @click="checkPublicConfig">Проверить конфигурацию с сервера</button></div><p class="hint">{{ statusLabel(installation.installationStatus) }} · {{ date(installation.lastSeenAt) }}</p><a :href="safeSiteUrl(installConfigUrl)" target="_blank" rel="noopener noreferrer" class="site-url">Открыть JSON конфигурации ↗</a></template>
      <p v-if="publicResult" class="form-success" role="status">Конфигурация получена с сервера. Версия {{ publicResult.version }}, сценариев: {{ publicResult.count }}.</p>
    </dialog>
  </div>
</template>
