<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import TourEditor from './App.vue'
import SidebarNav from './components/SidebarNav.vue'
import AuthIllustration from './components/AuthIllustration.vue'
import TourList from './components/TourList.vue'
import AppearanceSettings from './components/AppearanceSettings.vue'
import AnalyticsPanel from './components/AnalyticsPanel.vue'
import MobileEditorNotice from './components/MobileEditorNotice.vue'
import { ApiError, authResult, createApi, normalizeApiBase } from './api.js'
import './platform.css'
import './design.css'

const SESSION_KEY = 'onboarding-session:v1', API_KEY = 'onboarding-api:v1'
const demoUrl = import.meta.env.VITE_DEMO_SITE_URL || (import.meta.env.DEV ? new URL('demo/', location.href).href : 'http://localhost:4174/')
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
let storedBase = ''
try { storedBase = localStorage.getItem(API_KEY) || '' } catch { /* The configured environment still works without storage. */ }
let initialApi = ''
try { initialApi = normalizeApiBase(storedBase || import.meta.env.VITE_API_BASE_URL || (local ? '/api/v1' : '')) } catch { initialApi = local ? '/api/v1' : '' }
const apiBase = ref(initialApi)
const apiInput = ref(apiBase.value), connectionOpen = ref(false), connectionError = ref(''), healthMessage = ref(''), checkingHealth = ref(false)
const token = ref(null), user = ref(null), previousUserId = ref(null), booting = ref(true)
const sessionError = ref(''), accountError = ref('')
const route = ref(location.hash.slice(1) || '/login'), mode = ref('auth'), authMode = ref('login')
const sidebarOpen = ref(false), passwordVisible = ref(false), selectedSiteId = ref(''), toursPanel = ref(null), appearancePanel = ref(null), editorTitle = ref('Конструктор тура')
const working = ref(false), authError = ref(''), authFields = ref([]), authNotice = ref('')
const credentials = ref({ companyName: '', email: '', password: '', acceptTerms: false })
const sites = ref([]), loadingSites = ref(false), pageError = ref(''), pageNotice = ref('')
const editor = ref(null), editorSite = ref(null), editorDocument = ref(null)
const siteDialog = ref(null), siteSaving = ref(false), siteError = ref(''), siteFields = ref([]), siteForm = ref({ name: '', baseUrl: '' })
const manageDialog = ref(null), managedSite = ref(null), managedName = ref(''), manageBusy = ref(false), manageError = ref('')
const installDialog = ref(null), installation = ref(null), installSite = ref(null), installError = ref(''), installBusy = ref(false), publicResult = ref(null), copied = ref(false)
const installationPages = ref([]), installPagesError = ref('')
const demoSettingsCopied = ref(false)
let routeTicket = 0, authTicket = 0, installationRequest = 0, disposed = false
const api = computed(() => createApi({ baseUrl: apiBase.value, getToken: () => token.value, onUnauthorized: expiredToken => {
  if (token.value !== expiredToken) return
  credentials.value.email = user.value?.email || credentials.value.email
  previousUserId.value = user.value?.id ?? previousUserId.value
  clearSession(); sessionError.value = ''
  authError.value = editorSite.value ? 'Сессия истекла. Войдите снова; открытый черновик остаётся в редакторе.' : 'Вход завершён или срок действия сессии истёк. Войдите снова.'
  siteDialog.value?.close(); installDialog.value?.close(); manageDialog.value?.close()
  location.hash = '/login'
} }))
const isRegister = computed(() => authMode.value === 'register')
const displayName = computed(() => user.value?.companyName || user.value?.email || '')
const installConfigUrl = computed(() => installation.value?.configUrl || '')
const localDemoSettings = computed(() => {
  if (!import.meta.env.DEV || !installSite.value) return ''
  const site = new URL(installSite.value.baseUrl), demo = new URL('demo/', location.href)
  if (site.origin !== location.origin || site.href !== demo.href) return ''
  return 'VITE_WIDGET_SITE_ID=' + installSite.value.id + '\nVITE_WIDGET_CONFIG_URL=' + new URL(api.value.configUrl(installSite.value.id), location.href).href
})
const showShell = computed(() => !['auth', 'session-error'].includes(mode.value) && !!user.value)
const activeNav = computed(() => mode.value === 'editor' ? 'tours' : mode.value)
const pageTitle = computed(() => ({ sites: 'Сайты', tours: 'Туры', analytics: 'Аналитика', appearance: 'Настройка вида подсказок', editor: editorTitle.value })[mode.value] || 'Онбординг')
const assetBase = import.meta.env.BASE_URL + 'design/'

function clearSession() {
  token.value = null; user.value = null; sites.value = []; managedSite.value = null; manageBusy.value = false
  installationRequest++; installBusy.value = false; installation.value = null; installationPages.value = []; publicResult.value = null
  manageDialog.value?.close()
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
function statusLabel(status) { return ({ connected: 'Виджет установлен', inactive: 'Нет недавних сигналов', not_detected: 'Виджет не найден' })[status] || 'Статус неизвестен' }
function safeSiteUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined } catch { return undefined }
}
function date(value) {
  const parsed = value ? new Date(value) : null
  return parsed && Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('ru', { dateStyle: 'short', timeStyle: 'short' }).format(parsed) : 'Сигналов ещё не было'
}

async function mayLeave() { if (mode.value === 'appearance' && appearancePanel.value && !appearancePanel.value.mayLeave()) return false; return !editor.value || await editor.value.mayLeave() }
async function go(path) {
  if (path === route.value) return
  if (!await mayLeave()) return
  if (path !== '/login' && path !== '/register') { editorSite.value = null; editorDocument.value = null }
  location.hash = path
}
function navigate(path) {
  sidebarOpen.value = false
  const query = selectedSiteId.value && path !== '/sites' ? '?site=' + encodeURIComponent(selectedSiteId.value) : ''
  return go(path + query)
}
function editTour(siteId, scenarioId) {
  selectedSiteId.value = siteId
  return go('/sites/' + encodeURIComponent(siteId) + (scenarioId ? '?scenario=' + encodeURIComponent(scenarioId) : ''))
}
function selectSite(id) {
  if (!id) return
  selectedSiteId.value = id
  if (!['tours', 'appearance'].includes(mode.value)) return
  const target = '/' + mode.value + '?site=' + encodeURIComponent(id)
  history.replaceState(null, '', '#' + target); route.value = target
}
async function handleRoute() {
  const ticket = ++routeTicket
  route.value = location.hash.slice(1) || '/login'
  const path = route.value.split('?')[0]
  const query = new URLSearchParams(route.value.split('?')[1] || '')
  if (query.has('site')) selectedSiteId.value = query.get('site')
  pageError.value = ''; pageNotice.value = ''
  if (['/login', '/register'].includes(path)) {
    mode.value = 'auth'; authMode.value = path === '/register' ? 'register' : 'login'; authFields.value = []; passwordVisible.value = false
    return
  }
  if (!user.value) { location.hash = '/login'; mode.value = 'auth'; return }
  if (['/sites', '/tours', '/analytics', '/appearance'].includes(path)) { mode.value = path.slice(1); await refreshSites(); return }
  const match = /^\/sites\/([^/]+)$/.exec(path)
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
    const scenarioId = query.get('scenario')
    if (scenarioId && document.project.scenarios.some(item => item.id === scenarioId)) document.project.activeScenarioId = scenarioId
    selectedSiteId.value = siteId; editorTitle.value = 'Конструктор тура: ' + (document.project.scenarios.find(item => item.id === document.project.activeScenarioId)?.name || document.project.scenarios[0]?.name || 'Новый тур')
    editorSite.value = site; editorDocument.value = document; mode.value = 'editor'
  } catch (error) { if (ticket === routeTicket) { pageError.value = error.message; mode.value = user.value ? 'sites' : 'auth' } }
}

async function refreshSites() {
  const currentApi = api.value, currentToken = token.value
  loadingSites.value = true; pageError.value = ''
  try {
    const loaded = await currentApi.sites()
    if (currentToken === token.value && currentApi === api.value) sites.value = loaded
  } catch (error) { if (currentToken === token.value && currentApi === api.value) pageError.value = error.message }
  finally { if (currentApi === api.value) loadingSites.value = false }
}

async function signInResponse(response, client, ticket, email) {
  const session = authResult(response), before = previousUserId.value ?? user.value?.id
  const loadedUser = validUser(await client.me({ token: session.token }))
  if (ticket !== authTicket || disposed || client !== api.value) return
  if (loadedUser.email.toLowerCase() !== email.toLowerCase() || session.user && session.user.id !== loadedUser.id) throw new ApiError('Сервер вернул другой аккаунт. Проверьте ответ авторизации.')
  if (before !== undefined && before !== null && before !== loadedUser.id) { editorSite.value = null; editorDocument.value = null }
  token.value = session.token; user.value = loadedUser; previousUserId.value = loadedUser.id; storeSession()
  credentials.value.password = ''; authError.value = ''; authNotice.value = ''; accountError.value = ''; sessionError.value = ''
  location.hash = editorSite.value ? '/sites/' + encodeURIComponent(editorSite.value.id) : '/sites'
  await handleRoute()
}

async function submitAuth() {
  if (working.value) return
  const ticket = ++authTicket, registering = isRegister.value, client = api.value
  working.value = true; authError.value = ''; authFields.value = []; authNotice.value = ''
  try {
    const data = { email: credentials.value.email.trim(), password: credentials.value.password }
    if (registering) {
      const response = await client.register({ ...data, companyName: credentials.value.companyName.trim(), acceptTerms: credentials.value.acceptTerms })
      if (ticket !== authTicket || disposed) return
      credentials.value.acceptTerms = false
      await signInResponse(response, client, ticket, data.email)
    } else {
      const response = await client.login(data)
      if (ticket === authTicket && !disposed) await signInResponse(response, client, ticket, data.email)
    }
  } catch (error) { if (ticket === authTicket) { authError.value = error.message; authFields.value = error.fields || [] } }
  finally { if (ticket === authTicket) working.value = false }
}

async function signOut(allDevices = false) {
  const client = api.value, currentToken = token.value
  if (allDevices && !confirm('Выйти из аккаунта на всех устройствах? На каждом устройстве потребуется войти снова.')) return
  if (!await mayLeave()) return
  if (client !== api.value || currentToken !== token.value) return
  const ticket = ++authTicket
  working.value = true; accountError.value = ''
  let notice = '', revokedAll = false
  try { if (allDevices) { await client.logoutAll(); revokedAll = true } else await client.logout() }
  catch (error) {
    if (ticket !== authTicket || client !== api.value || disposed) return
    if (allDevices && error.status !== 401) { accountError.value = 'Не удалось подтвердить выход на всех устройствах. ' + error.message; working.value = false; return }
    if (allDevices && error.status === 401) notice = 'Вход в этой вкладке завершён. Чтобы выйти на всех устройствах, войдите снова и повторите действие.'
    if (error.status !== 401) notice = 'Вы вышли из аккаунта в этой вкладке. Сервер не подтвердил завершение сессии.'
  }
  if (ticket !== authTicket || client !== api.value || disposed) return
  clearSession(); previousUserId.value = null; editorSite.value = null; editorDocument.value = null
  if (revokedAll) notice = 'Вы вышли из аккаунта на всех устройствах.'
  working.value = false; authNotice.value = notice; authError.value = ''; location.hash = '/login'
}

async function configureApi() {
  connectionError.value = ''; healthMessage.value = ''
  try {
    const value = normalizeApiBase(apiInput.value)
    if (!value) throw new ApiError('Укажите адрес сервера API.')
    if (value === apiBase.value) return
    if (!await mayLeave()) return
    authTicket++; routeTicket++; working.value = false; booting.value = false; sessionError.value = ''; accountError.value = ''
    clearSession(); previousUserId.value = null; editorSite.value = null; editorDocument.value = null
    credentials.value.password = ''
    apiBase.value = value; apiInput.value = value
    try { localStorage.setItem(API_KEY, value) } catch { /* The entered address remains active in this tab. */ }
    authNotice.value = 'Адрес API сохранён. Войдите в аккаунт этого сервера.'; authError.value = ''; location.hash = '/login'
    connectionOpen.value = false
    await handleRoute()
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

function openSiteSettings(site) {
  managedSite.value = site; managedName.value = site.name; manageError.value = ''
  manageDialog.value.showModal()
}
async function renameSite() {
  if (manageBusy.value || !managedSite.value) return
  const name = managedName.value.trim(), siteId = managedSite.value.id, client = api.value, accountToken = token.value
  if (!name) { manageError.value = 'Укажите название сайта.'; return }
  manageBusy.value = true; manageError.value = ''
  try {
    const saved = await client.renameSite(siteId, name)
    if (client !== api.value || accountToken !== token.value || disposed) return
    if (saved?.id !== siteId || typeof saved.name !== 'string' || !saved.name.trim()) throw new ApiError('Сервер вернул некорректные данные сайта.')
    sites.value = sites.value.map(site => site.id === siteId ? saved : site)
    if (editorSite.value?.id === siteId) editorSite.value = { ...editorSite.value, ...saved }
    pageNotice.value = 'Название сайта сохранено.'; manageDialog.value.close()
  } catch (error) { if (client === api.value && accountToken === token.value) manageError.value = error.message }
  finally { if (client === api.value && accountToken === token.value) manageBusy.value = false }
}
async function deleteSite() {
  if (manageBusy.value || !managedSite.value) return
  const siteId = managedSite.value.id, client = api.value, accountToken = token.value
  if (!confirm('Удалить сайт «' + managedSite.value.name + '» вместе со всеми сценариями и публикациями? Это действие нельзя отменить.')) return
  manageBusy.value = true; manageError.value = ''
  try {
    await client.deleteSite(siteId)
    if (client !== api.value || accountToken !== token.value || disposed) return
    sites.value = sites.value.filter(site => site.id !== siteId)
    if (editorSite.value?.id === siteId) { editorSite.value = null; editorDocument.value = null }
    pageNotice.value = 'Сайт удалён.'; manageDialog.value.close(); managedSite.value = null
  } catch (error) { if (client === api.value && accountToken === token.value) manageError.value = error.message }
  finally { if (client === api.value && accountToken === token.value) manageBusy.value = false }
}

async function openInstallation(site) {
  installSite.value = site; installation.value = null; publicResult.value = null; installError.value = ''; copied.value = false
  installationPages.value = []; installPagesError.value = ''; demoSettingsCopied.value = false
  installDialog.value.showModal()
  await refreshInstallation()
}
async function refreshInstallation() {
  if (!installSite.value) return
  const client = api.value, accountToken = token.value, siteId = installSite.value.id, ticket = ++installationRequest
  installBusy.value = true; installError.value = ''; installPagesError.value = ''
  try {
    const [metadata, pages] = await Promise.allSettled([client.installation(siteId), client.observedPages(siteId)])
    if (disposed || ticket !== installationRequest || client !== api.value || accountToken !== token.value) return
    if (metadata.status === 'rejected') throw metadata.reason
    const result = metadata.value
    if (result.siteId !== siteId || typeof result.scriptTag !== 'string') throw new ApiError('Сервер вернул некорректный код подключения.')
    installation.value = result
    const status = { installationStatus: result.installationStatus, lastSeenAt: result.lastSeenAt }
    sites.value = sites.value.map(site => site.id === siteId ? { ...site, ...status } : site)
    if (editorSite.value?.id === siteId) editorSite.value = { ...editorSite.value, ...status }
    if (pages.status === 'fulfilled' && Array.isArray(pages.value)) installationPages.value = pages.value.filter(page => safeSiteUrl(page?.url)).slice(0, 100)
    else installPagesError.value = 'Не удалось загрузить список страниц. ' + (pages.reason?.message || '')
  } catch (error) { if (ticket === installationRequest && client === api.value && accountToken === token.value) installError.value = error.message }
  finally { if (ticket === installationRequest) installBusy.value = false }
}
function installationClosed() { installationRequest++; installBusy.value = false }
async function copyScript() {
  try { await navigator.clipboard.writeText(installation.value.scriptTag); copied.value = true }
  catch { installError.value = 'Не удалось скопировать автоматически. Выделите и скопируйте код из поля.' }
}
async function copyDemoSettings() {
  try { await navigator.clipboard.writeText(localDemoSettings.value); demoSettingsCopied.value = true }
  catch { installError.value = 'Выделите и скопируйте настройки демосайта из поля.' }
}
async function checkPublicConfig() {
  const client = api.value, site = installSite.value, ticket = ++installationRequest
  installBusy.value = true; installError.value = ''; publicResult.value = null
  try {
    const result = await client.publicConfig(site.id)
    if (disposed || ticket !== installationRequest || client !== api.value) return
    if (result?.siteId !== site.id || result?.schema !== 1 || !Array.isArray(result.scenarios)) throw new ApiError('Сервер вернул некорректную конфигурацию виджета.')
    if (result.origin && result.origin !== new URL(site.baseUrl).origin) throw new ApiError('Публичная конфигурация относится к другому домену. Проверьте GET /public/sites/{siteId}/config.')
    publicResult.value = { version: result.version, count: result.scenarios.length }
  } catch (error) { if (ticket === installationRequest && client === api.value) installError.value = error.message }
  finally { if (ticket === installationRequest) installBusy.value = false }
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
async function restoreSession() {
  const ticket = ++authTicket, client = api.value
  booting.value = true; sessionError.value = ''
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null')
    if (session?.apiBase === apiBase.value && typeof session.token === 'string' && session.token) {
      token.value = session.token
      const loadedUser = validUser(await client.me({ token: session.token }))
      if (ticket !== authTicket || disposed || client !== api.value) return
      user.value = loadedUser; previousUserId.value = loadedUser.id
      const target = location.hash.slice(1) || '/login'
      if (['/login', '/register'].includes(target)) location.hash = '/sites'
    }
  } catch (error) {
    if (ticket !== authTicket || disposed || client !== api.value) return
    if (error instanceof SyntaxError || error.status === 401) clearSession()
    else { sessionError.value = error.message; mode.value = 'session-error' }
  } finally {
    if (ticket === authTicket && !disposed) {
      booting.value = false
      if (!sessionError.value) await handleRoute()
    }
  }
}
async function forgetSession() {
  authTicket++; clearSession(); sessionError.value = ''; accountError.value = ''; authError.value = ''; booting.value = false
  location.hash = '/login'; await handleRoute()
}
onMounted(async () => {
  window.addEventListener('hashchange', onHashChange)
  await restoreSession()
})
onBeforeUnmount(() => { disposed = true; routeTicket++; authTicket++; window.removeEventListener('hashchange', onHashChange) })
</script>

<template>
  <div class="platform-shell" :class="{ 'has-sidebar': showShell, 'auth-shell': mode === 'auth' }">
    <SidebarNav v-if="showShell" :active="activeNav" :open="sidebarOpen" :account-name="displayName" @navigate="navigate" @close="sidebarOpen = false" @connection="connectionOpen = !connectionOpen" @logout="signOut()" @logout-all="signOut(true)" />
    <header class="platform-header" :class="{ 'auth-header': mode === 'auth' || mode === 'session-error', 'editor-page-header': mode === 'editor' }">
      <button v-if="showShell" class="menu-toggle" aria-label="Открыть главное меню" :aria-expanded="sidebarOpen" @click="sidebarOpen = !sidebarOpen">☰</button>
      <h1 v-if="showShell" class="page-title">{{ pageTitle }}</h1>
      <div class="platform-nav">
        <button v-if="!showShell" class="text-button" :aria-expanded="connectionOpen" @click="connectionOpen = !connectionOpen">Подключение API</button>
        <button v-if="mode === 'sites'" class="button primary" @click="openCreateSite">+ Добавить сайт</button>
        <button v-if="mode === 'tours'" class="button primary" :disabled="loadingSites || !sites.length || !toursPanel?.canCreate" @click="toursPanel?.createTour()">+ Создать тур</button>
        <details v-if="user && !showShell" class="account-menu">
          <summary :aria-label="'Аккаунт: ' + displayName"><span class="account-avatar" aria-hidden="true">{{ displayName.slice(0, 1).toUpperCase() }}</span><span class="account-name">{{ displayName }}</span><span aria-hidden="true">⌄</span></summary>
          <div class="account-menu-actions"><button :disabled="working" @click="signOut()">Выйти</button><button :disabled="working" @click="signOut(true)">Выйти на всех устройствах</button></div>
        </details>
      </div>
    </header>
    <p v-if="accountError" class="account-error form-error" role="alert">{{ accountError }}</p>

    <section v-if="connectionOpen" class="api-settings panel" aria-label="Подключение API">
      <form @submit.prevent="configureApi">
        <label class="field">Адрес сервера API<input v-model="apiInput" placeholder="http://localhost:8000" autocomplete="url" required></label>
        <div class="inline-actions"><button class="button primary" type="submit">Сохранить адрес</button><button class="button" type="button" :disabled="checkingHealth || !apiBase" @click="checkHealth">{{ checkingHealth ? 'Проверяем…' : 'Проверить сервер и БД' }}</button></div>
      </form>
      <p class="hint">Для локальной разработки можно оставить /api/v1: панель перенаправляет запросы на сервер порта 8000.</p>
      <p v-if="connectionError" class="form-error" role="alert">{{ connectionError }}</p><p v-if="healthMessage" class="form-success" role="status">{{ healthMessage }}</p>
    </section>

    <main v-if="booting || mode === 'loading'" class="platform-content"><p class="loading-state" role="status">{{ booting ? 'Проверяем сессию…' : 'Загружаем сайт и проект с сервера…' }}</p></main>

    <main v-else-if="mode === 'session-error'" class="platform-content">
      <section class="session-recovery panel" aria-labelledby="session-error-title"><h1 id="session-error-title">Не удалось проверить вход</h1><p class="form-error" role="alert">{{ sessionError }}</p><p class="hint">Сохранённый вход остаётся в этой вкладке. Повторите проверку, когда сервер станет доступен.</p><div class="inline-actions"><button class="button primary" @click="restoreSession">Повторить проверку</button><button class="button" @click="forgetSession">Войти заново</button></div></section>
    </main>

    <main v-else-if="mode === 'auth'" class="auth-layout">
      <section class="auth-story"><a class="auth-brand" href="#/login" @click.prevent="go('/login')">Онбординг</a><div class="auth-pitch"><h1>Создавайте подсказки<br>для своего сайта<br>без программистов</h1><p>Собирайте туры из шагов, настраивайте цвета<br>и смотрите статистику прохождения.</p><AuthIllustration /></div></section>
      <section class="auth-card panel" aria-label="Вход и регистрация">
        <div class="auth-tabs"><button :class="{ active: !isRegister }" :disabled="working" @click="authError = ''; authNotice = ''; go('/login')">Вход</button><button :class="{ active: isRegister }" :disabled="working" @click="authError = ''; authNotice = ''; go('/register')">Регистрация</button></div>
        <h2>{{ isRegister ? 'Создайте аккаунт' : 'Добро пожаловать' }}</h2><p class="auth-subtitle">{{ isRegister ? 'Аккаунт компании: добавляйте сайты и туры' : 'Войдите, чтобы управлять подсказками' }}</p>
        <p v-if="!apiBase" class="form-note">Для работы кабинета укажите адрес сервера в разделе «Подключение API».</p>
        <p v-if="authError" class="form-error" role="alert">{{ authError }}</p><p v-if="authNotice" class="form-success" role="status">{{ authNotice }}</p>
        <form @submit.prevent="submitAuth">
          <label v-if="isRegister" class="field">Название компании<input v-model="credentials.companyName" placeholder="ООО «Ромашка»" required maxlength="200" autocomplete="organization" :disabled="working" :aria-invalid="!!fieldError(authFields, 'companyName')"></label>
          <label class="field">Email<input v-model="credentials.email" type="email" placeholder="name@company.ru" required maxlength="254" autocomplete="email" :disabled="working" :readonly="!!editorSite" :aria-invalid="!!fieldError(authFields, 'email')"></label>
          <div class="password-field"><label class="field">Пароль<input v-model="credentials.password" :type="passwordVisible ? 'text' : 'password'" :placeholder="isRegister ? 'Не менее 8 символов' : 'Введите пароль'" required :minlength="isRegister ? 8 : 1" maxlength="128" :autocomplete="isRegister ? 'new-password' : 'current-password'" :disabled="working" :aria-invalid="!!fieldError(authFields, 'password')"></label><button type="button" :disabled="working" :aria-pressed="passwordVisible" @click="passwordVisible = !passwordVisible">{{ passwordVisible ? 'Скрыть' : 'Показать' }}</button></div>
          <div v-if="!isRegister" class="forgot-password"><button class="text-button" type="button" disabled title="Восстановление пароля пока не подключено">Забыли пароль?</button></div>
          <label v-if="isRegister" class="terms-field"><input v-model="credentials.acceptTerms" type="checkbox" required :disabled="working">Принимаю условия использования</label>
          <button class="button primary full-width auth-submit" type="submit" :disabled="working || !apiBase">{{ working ? 'Отправляем…' : isRegister ? 'Создать аккаунт' : 'Войти' }}</button>
        </form>
        <p class="auth-switch">{{ isRegister ? 'Уже есть аккаунт?' : 'Нет аккаунта?' }} <button class="text-button" :disabled="working" @click="go(isRegister ? '/login' : '/register')">{{ isRegister ? 'Войти' : 'Зарегистрироваться' }}</button></p>
      </section>
    </main>

    <main v-else-if="mode === 'sites'" class="platform-content">
      <div class="sites-heading"><p>Сайты вашей компании</p><button class="text-button" :disabled="loadingSites" @click="refreshSites">Обновить список</button></div>
      <p v-if="pageError" class="form-error" role="alert">{{ pageError }}</p><p v-if="pageNotice" class="form-success" role="status">{{ pageNotice }}</p>
      <p v-if="loadingSites" class="loading-state" role="status">Загружаем ваши сайты…</p>
      <section v-else-if="!sites.length && !pageError" class="empty-sites"><div class="empty-browser-graphic" aria-hidden="true"><img :src="assetBase + 'empty-browser.svg'" alt=""><img :src="assetBase + 'empty-browser-line.svg'" alt=""><img :src="assetBase + 'empty-browser-dot.svg'" alt=""><img :src="assetBase + 'empty-browser-dot.svg'" alt=""><img :src="assetBase + 'empty-browser-title.svg'" alt=""><img :src="assetBase + 'empty-browser-text.svg'" alt=""></div><h2>Добавьте первый сайт</h2><p>Подключите виджет к сайту, чтобы создавать подсказки<br>для его посетителей.</p><button class="button primary" @click="openCreateSite">+ Добавить сайт</button></section>
      <div v-else class="site-grid"><article v-for="site in sites" :key="site.id" class="site-card panel"><div class="site-card-title"><h2>{{ site.name }}</h2><details class="row-menu"><summary aria-label="Действия с сайтом">⋮</summary><div><button @click="openSiteSettings(site)">Настройки сайта</button><button @click="editTour(site.id)">Открыть конструктор</button></div></details></div><a :href="safeSiteUrl(site.baseUrl)" target="_blank" rel="noopener noreferrer" class="site-url">{{ site.displayUrl || site.baseUrl }}</a><span class="site-status" :class="site.installationStatus">{{ statusLabel(site.installationStatus) }}</span><div class="site-stats"><span>Туров: {{ site.scenariosCount }}</span><span>Запусков за 7 дней: {{ site.startsLast7Days ? site.startsLast7Days.toLocaleString('ru') : '—' }}</span></div><div class="site-card-actions"><button class="button" @click="selectedSiteId = site.id; navigate('/tours')">Туры</button><button class="text-button" @click="openInstallation(site)">Код подключения</button></div></article><button class="site-card add-site-card" @click="openCreateSite">+ Добавить сайт</button></div>
    </main>

    <TourList v-if="mode === 'tours'" ref="toursPanel" :api="api" :sites="sites" :selected-site-id="selectedSiteId" @edit="editTour" @site-change="selectSite" />
    <AppearanceSettings v-if="mode === 'appearance'" ref="appearancePanel" :api="api" :sites="sites" :selected-site-id="selectedSiteId" @site-change="selectSite" />
    <AnalyticsPanel v-if="mode === 'analytics'" :sites="sites" />

    <MobileEditorNotice v-if="mode === 'editor'" @analytics="navigate('/analytics')" />
    <div v-if="editorSite && !booting" v-show="mode === 'editor'" class="cloud-editor">
      <div class="editor-heading"><button class="text-button" @click="navigate('/tours')">← Туры</button><button class="text-button" @click="go('/sites')">← Мои сайты</button><span>{{ editorSite.name }}</span><button class="text-button" @click="openInstallation(editorSite)">Код подключения</button></div>
      <TourEditor :key="editorSite.id + ':' + previousUserId" ref="editor" class="desktop-tour-editor" :site="editorSite" :initial-document="editorDocument" :api="api" @title-change="editorTitle = 'Конструктор тура: ' + $event" />
    </div>

    <dialog ref="siteDialog" class="platform-dialog" aria-labelledby="add-site-title" @cancel="siteSaving && $event.preventDefault()">
      <div class="dialog-heading"><h2 id="add-site-title">Добавить сайт</h2><button class="dialog-close" aria-label="Закрыть добавление сайта" :disabled="siteSaving" @click="siteDialog.close()">×</button></div>
      <p class="hint">Укажите главную страницу сайта или адрес проекта в подпапке.</p><p v-if="siteError" class="form-error" role="alert">{{ siteError }}</p>
      <form @submit.prevent="createSite"><label class="field">Название сайта<input v-model="siteForm.name" required maxlength="200" :disabled="siteSaving" :aria-invalid="!!fieldError(siteFields, 'name')" autofocus></label><label class="field">Адрес сайта<input v-model="siteForm.baseUrl" type="url" placeholder="https://example.com/" required maxlength="2048" :disabled="siteSaving" :aria-invalid="!!fieldError(siteFields, 'baseUrl')"></label><button class="text-button" type="button" :disabled="siteSaving" @click="useDemoSite">Подставить адрес демосайта</button><div class="dialog-actions"><button class="button" type="button" :disabled="siteSaving" @click="siteDialog.close()">Отмена</button><button class="button primary" type="submit" :disabled="siteSaving">{{ siteSaving ? 'Сохраняем…' : 'Добавить сайт' }}</button></div></form>
    </dialog>

    <dialog ref="manageDialog" class="platform-dialog" aria-labelledby="manage-site-title" @cancel="manageBusy && $event.preventDefault()">
      <div class="dialog-heading"><h2 id="manage-site-title">Настройки сайта</h2><button class="dialog-close" aria-label="Закрыть настройки сайта" :disabled="manageBusy" @click="manageDialog.close()">×</button></div>
      <p class="hint">{{ managedSite?.baseUrl }}</p><p v-if="manageError" class="form-error" role="alert">{{ manageError }}</p>
      <form @submit.prevent="renameSite"><label class="field">Название сайта<input v-model="managedName" required maxlength="200" :disabled="manageBusy" autofocus></label><div class="dialog-actions"><button class="button" type="button" :disabled="manageBusy" @click="manageDialog.close()">Отмена</button><button class="button primary" type="submit" :disabled="manageBusy">{{ manageBusy ? 'Сохраняем…' : 'Сохранить название' }}</button></div></form>
      <details class="delete-site-settings"><summary>Удаление сайта</summary><p class="hint">Сайт, его сценарии и все публикации будут удалены без возможности восстановления.</p><button class="button danger-button" :disabled="manageBusy" @click="deleteSite">Удалить сайт</button></details>
    </dialog>

    <dialog ref="installDialog" class="platform-dialog installation-dialog" aria-labelledby="installation-title" @close="installationClosed">
      <div class="dialog-heading"><h2 id="installation-title">Подключение {{ installSite?.name }}</h2><button class="dialog-close" aria-label="Закрыть код подключения" @click="installDialog.close()">×</button></div><p class="hint">Установите этот скрипт на все страницы, участвующие в обучении. Для SPA достаточно общей точки входа.</p>
      <p v-if="installBusy" role="status">Загружаем данные с сервера…</p><p v-if="installError" class="form-error" role="alert">{{ installError }}</p>
      <template v-if="installation">
        <label class="field">Скрипт виджета<textarea class="script-output" :value="installation.scriptTag" rows="5" readonly @focus="$event.target.select()" /></label>
        <div class="inline-actions"><button class="button primary" @click="copyScript">{{ copied ? 'Скопировано' : 'Копировать скрипт' }}</button><button class="button" :disabled="installBusy" @click="refreshInstallation">Обновить статус</button><a class="button" :href="safeSiteUrl(installSite.baseUrl)" target="_blank" rel="noopener noreferrer">Открыть сайт</a></div>
        <p class="hint installation-status" role="status">{{ statusLabel(installation.installationStatus) }} · {{ date(installation.lastSeenAt) }}</p>
        <p class="hint">После установки скрипта откройте сайт отдельной вкладкой, затем обновите статус. Предпросмотр в конструкторе не отправляет сигнал установки.</p>
        <details v-if="localDemoSettings" class="local-demo-settings"><summary>Локальный демосайт</summary><p class="hint">Чтобы демосайт получал туры этого сайта с сервера, добавьте строки ниже в файл .env.local в корне проекта и перезапустите npm run dev.</p><textarea class="script-output" :value="localDemoSettings" rows="3" readonly aria-label="Настройки локального демосайта" @focus="$event.target.select()" /><button class="button small" @click="copyDemoSettings">{{ demoSettingsCopied ? 'Скопировано' : 'Копировать настройки демо' }}</button></details>
        <section class="observed-pages" aria-label="Страницы с виджетом"><h3>Страницы с виджетом</h3><p v-if="installPagesError" class="form-note">{{ installPagesError }}</p><ul v-else-if="installationPages.length"><li v-for="page in installationPages" :key="page.url"><a :href="safeSiteUrl(page.url)" target="_blank" rel="noopener noreferrer">{{ page.title || page.url }}</a><small>{{ date(page.lastSeenAt) }}</small></li></ul><p v-else class="hint">Сигналов со страниц пока нет.</p></section>
        <div class="inline-actions"><button class="button" :disabled="installBusy" @click="checkPublicConfig">Проверить конфигурацию с сервера</button><a :href="safeSiteUrl(installConfigUrl)" target="_blank" rel="noopener noreferrer" class="text-button">Открыть JSON конфигурации ↗</a></div>
      </template>
      <p v-if="publicResult" class="form-success" role="status">Конфигурация получена с сервера. Версия {{ publicResult.version }}, сценариев: {{ publicResult.count }}.</p>
    </dialog>
  </div>
</template>
