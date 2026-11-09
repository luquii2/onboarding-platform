<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import PreviewFrame from './components/PreviewFrame.vue'
import { DEVICES, applyTarget, canonicalUrl, configFor, createStep, createScenario, createPlayback, exportProject, isDraft, normalizeActions, readProject, validationKey, confirmTrigger, triggerErrors, triggerIsReady } from './model.js'
import './styles.css'

const SITE = import.meta.env.VITE_DEMO_SITE_URL || 'http://localhost:4174/'
const STORAGE = 'onboarding-prototype:' + SITE
const mainFrame = ref(null), desktopValidator = ref(null), mobileValidator = ref(null)
const mainReady = ref(false), frameUrl = ref(SITE), frameEpoch = ref(0), currentPage = ref(SITE)
const project = ref(readProject(null, SITE))
const scenario = computed(() => project.value.scenarios.find(item => item.id === project.value.activeScenarioId) || project.value.scenarios[0])
const steps = computed({ get: () => scenario.value.steps, set: value => { scenario.value.steps = value } })
const color = computed({ get: () => scenario.value.color, set: value => { scenario.value.color = value } })
const selectedId = ref(null), device = ref('desktop')
const status = ref('Подключаем сайт…'), events = ref([]), interaction = ref(null), playback = ref(null), launchSession = ref(null)
const playing = computed(() => !!playback.value)
const armed = computed(() => !!launchSession.value)
const settingsDetails = ref(null), settingsOpen = ref(false), settingsAttempted = ref(false), settingsMessage = ref(''), notification = ref(null)
const launchReady = computed(() => triggerIsReady(scenario.value, SITE))
const configurationErrors = computed(() => settingsAttempted.value ? triggerErrors(scenario.value.trigger, SITE) : {})
const selected = computed(() => steps.value.find(step => step.id === selectedId.value))
const viewport = computed(() => DEVICES[device.value])
const checkJob = ref(null), checks = ref({ desktop: { state: 'idle' }, mobile: { state: 'idle' } })
let navigationIntent = '', validationTimer, notificationTimer, highlightVersion = 0, sequence = 0, disposed = false, runRequest = 0, triggerRequest = 0
const availablePages = computed(() => {
  const urls = new Set([SITE, currentPage.value, ...project.value.pages.map(page => page.url)])
  for (const item of project.value.scenarios) {
    for (const step of item.steps) urls.add(step.pageUrl)
    if (item.trigger.pageUrl) urls.add(item.trigger.pageUrl)
  }
  return [...urls].map(url => ({ url, label: pageLabel(url) }))
})
const waitingMessage = computed(() => {
  if (!launchSession.value) return ''
  const trigger = launchSession.value.config.scenarios[0].trigger
  const elsewhere = trigger.pageUrl && trigger.pageUrl !== currentPage.value
  const destination = elsewhere ? 'Перейдите на страницу «' + pageLabel(trigger.pageUrl) + '». ' : ''
  if (trigger.type === 'click') return destination + 'Ожидаем нажатия на выбранный элемент сайта.'
  if (trigger.type === 'manual') return 'Ожидаем вызова Onboarding.start() из кода сайта.'
  return destination + (elsewhere ? 'Там появится приглашение. ' : 'Приглашение появится справа внизу сайта. ') + 'Нажмите «' + trigger.buttonText + '», чтобы начать обучение.'
})
const configUrl = ref(new URL('onboarding.json', SITE).href)
const installScript = computed(() => {
  const attr = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
  const source = new URL(import.meta.env.BASE_URL + 'widget.js', location.origin).href
  return '<script src="' + attr(source) + '" data-site-id="' + attr(project.value.siteId) + '" data-config-url="' + attr(configUrl.value) + '" data-editor-origin="' + attr(location.origin) + '" defer></' + 'script>'
})

try {
  project.value = readProject(JSON.parse(localStorage.getItem(STORAGE) || 'null'), SITE)
  selectedId.value = steps.value.find(step => step.pageUrl === SITE)?.id ?? null
} catch { status.value = 'Черновик не удалось прочитать. Можно создать новый.' }

watch(project, () => {
  try { localStorage.setItem(STORAGE, JSON.stringify(project.value)) }
  catch { status.value = 'Браузер не разрешил сохранить черновик.' }
}, { deep: true, immediate: true })
watch(() => project.value.scenarios, () => {
  if (armed.value && !playing.value) {
    disableTriggers()
    status.value = 'Настройки изменились. Нажмите «Запустить тур» снова, чтобы применить их.'
  }
}, { deep: true })

function describeState(state) {
  return ({ idle: 'Выберите элемент', pending: 'Проверяем…', ready: 'Готово', hidden: 'Элемент скрыт', missing: 'Элемент не найден',
    unconfigured: 'Цель не задана', ambiguous: 'Нужно уточнить цель', invalid: 'Нужно выбрать цель заново',
    'action-missing': 'Подготовка недоступна', 'action-invalid': 'Нужно настроить подготовку', error: 'Не удалось проверить', offline: 'Нет подключения' })[state] || 'Нужно проверить'
}

function pageName(url) {
  try { return new URL(url).pathname.split('/').pop() || 'Главная' } catch { return 'Страница сайта' }
}

function pageLabel(value) {
  const url = new URL(value)
  const title = project.value.pages.find(page => page.url === value)?.title || pageName(value)
  const base = new URL(SITE).pathname
  const path = url.pathname.startsWith(base) ? '/' + url.pathname.slice(base.length) : url.pathname
  return title + ' (' + path + url.search + ')'
}

function rememberPage(url, title) {
  const value = String(title || pageName(url)).slice(0, 256)
  const page = project.value.pages.find(item => item.url === url)
  if (page) { if (page.title !== value) page.title = value }
  else {
    project.value.pages.push({ url, title: value })
    if (project.value.pages.length > 100) project.value.pages.splice(1, 1)
  }
}

function clearNotification() { clearTimeout(notificationTimer); notification.value = null }
function notify(title, text) {
  clearNotification(); notification.value = { title, text }
  notificationTimer = setTimeout(clearNotification, 6000)
}

function resetSettingsPanel() { settingsOpen.value = false; settingsAttempted.value = false; settingsMessage.value = '' }

async function showSettingsError(message) {
  settingsAttempted.value = true; settingsMessage.value = message; settingsOpen.value = true
  status.value = message
  await nextTick()
  settingsDetails.value?.querySelector('[aria-invalid="true"], [data-testid="save-launch"]')?.focus()
}

async function saveLaunchSettings() {
  settingsAttempted.value = true
  try {
    disableTriggers(); confirmTrigger(scenario.value, SITE)
    settingsMessage.value = ''; settingsOpen.value = false
    status.value = 'Настройки запуска сохранены. Теперь можно запустить тур.'
  } catch (error) { await showSettingsError(error.message) }
}

function useCurrentPage() {
  scenario.value.trigger.pageScope = 'page'; scenario.value.trigger.pageUrl = currentPage.value
}

function refreshChecks() {
  clearTimeout(validationTimer)
  if (!selected.value || isDraft(selected.value)) {
    checkJob.value = null
    checks.value = { desktop: { state: 'idle' }, mobile: { state: 'idle' } }
    return
  }
  checks.value = { desktop: { state: 'pending' }, mobile: { state: 'pending' } }
  validationTimer = setTimeout(() => {
    if (!selected.value) return
    checkJob.value = { id: crypto.randomUUID(), step: JSON.parse(JSON.stringify(selected.value)) }
  }, 100)
}
watch(() => validationKey(selected.value), refreshChecks, { immediate: true })

async function validateVariant(kind, info) {
  const job = checkJob.value
  if (!job || info.identity !== job.id) return
  await nextTick()
  const controller = kind === 'desktop' ? desktopValidator.value : mobileValidator.value
  try {
    const result = await controller.request('probe', { config: configFor(job.step, kind) })
    if (checkJob.value?.id === job.id && result.state !== 'cancelled') checks.value[kind] = result
  } catch (error) {
    if (checkJob.value?.id === job.id) checks.value[kind] = { state: 'error', message: error.message }
  }
}

function validatorOffline(kind, info) {
  if (info.identity === checkJob.value?.id) checks.value[kind] = { state: 'offline', message: info.message }
}

async function waitForMain() {
  const deadline = Date.now() + 8000
  while (!mainReady.value && Date.now() < deadline && !disposed) await new Promise(resolve => setTimeout(resolve, 40))
  if (!mainReady.value) throw new Error('Дождитесь подключения виджета на странице.')
}

async function ensurePage(step) {
  if (currentPage.value !== step.pageUrl) {
    navigationIntent = step.pageUrl
    mainReady.value = false
    frameUrl.value = step.pageUrl
    frameEpoch.value++
  }
  await waitForMain()
}

async function highlightSelected() {
  const step = selected.value, token = ++highlightVersion
  if (!step || isDraft(step) || !mainReady.value || interaction.value || playing.value || armed.value || step.pageUrl !== currentPage.value) return
  try {
    const result = await mainFrame.value.request('highlight', { config: configFor(step, device.value) })
    if (token !== highlightVersion || selectedId.value !== step.id || interaction.value || playing.value || armed.value) return
    status.value = result.state === 'ready' ? 'Цель шага подсвечена.' : 'Для этой версии нужно настроить цель. Подсказка справа.'
  } catch (error) { if (token === highlightVersion) status.value = error.message }
}

function onMainLoading() {
  mainReady.value = false; runRequest++
  if (playback.value) status.value = 'Подключаем страницу шага ' + (playback.value.index + 1) + '…'
  else if (armed.value) status.value = 'Тур запущен. Ждём загрузки страницы сайта…'
  if (interaction.value && !navigationIntent) {
    interaction.value = null; sequence++
    status.value = 'Страница изменилась. Шаг сохранен; выбор элемента можно повторить.'
  }
}

function onMainReady(info) {
  let url
  try { url = canonicalUrl(info.url, SITE) } catch { status.value = 'Сайт перешел на неподдерживаемый адрес.'; return }
  currentPage.value = url
  rememberPage(url, info.title)
  navigationIntent = ''
  mainReady.value = true
  if (playback.value) {
    if (playback.value.steps[playback.value.index].pageUrl !== url) { failPlayback('Сайт открыл другую страницу. Проверьте адрес шага и доступ к нему.'); return }
    showPlayback(playback.value)
    return
  }
  if (selected.value && selected.value.pageUrl !== url) selectedId.value = null
  if (armed.value) { syncTriggers(); return }
  if (!interaction.value) { status.value = 'Сайт подключен. Выберите шаг или добавьте новый.'; highlightSelected() }
}

function onMainOffline(info) {
  mainReady.value = false
  if (playback.value) failPlayback(info.message)
  else { disableTriggers(); status.value = info.message }
}

async function selectStep(step) {
  const token = ++sequence
  highlightVersion++; interaction.value = null; resetPlayback(); disableTriggers()
  selectedId.value = step.id
  if (mainReady.value) mainFrame.value.request('cancel').catch(() => {})
  try { await ensurePage(step); if (token === sequence) await highlightSelected() }
  catch (error) { if (token === sequence) status.value = error.message }
}

function addStep() {
  // Черновик появляется синхронно, до ответа виджета и выбора цели.
  const step = createStep(currentPage.value, steps.value.length + 1)
  steps.value.push(step)
  selectedId.value = step.id
  beginPick(step, device.value)
}

async function beginPick(step, kind, actions = []) {
  const token = ++sequence, task = { id: crypto.randomUUID(), stepId: step.id, device: kind, phase: 'pick', actions }
  highlightVersion++; interaction.value = task; resetPlayback(); disableTriggers(); device.value = kind
  status.value = 'Нажмите на конечный элемент внутри сайта. Шаг уже добавлен.'
  try {
    await ensurePage(step); await nextTick()
    if (token !== sequence || interaction.value?.id !== task.id) return
    await mainFrame.value.request('pick-start', { taskId: task.id })
  } catch (error) {
    if (token === sequence) { interaction.value = null; status.value = error.message }
  }
}

async function configureVariant(kind) {
  const step = selected.value
  if (!step) return
  const token = ++sequence, task = { id: crypto.randomUUID(), stepId: step.id, device: kind, phase: 'record', actions: [] }
  highlightVersion++; interaction.value = task; resetPlayback(); disableTriggers(); device.value = kind
  status.value = 'Откройте нужное меню, список или вкладку. Затем нажмите «Выбрать конечный элемент».'
  try {
    await ensurePage(step); await nextTick()
    if (token !== sequence || interaction.value?.id !== task.id) return
    await mainFrame.value.request('record-start', { taskId: task.id })
  } catch (error) {
    if (token === sequence) { interaction.value = null; status.value = error.message }
  }
}

async function chooseFinalTarget() {
  const task = interaction.value
  if (task?.phase !== 'record') return
  try {
    const result = await mainFrame.value.request('record-stop', { taskId: task.id })
    if (interaction.value?.id !== task.id) return
    task.actions = normalizeActions(result.actions)
    task.phase = 'pick'
    status.value = 'Теперь нажмите на конечный элемент сайта.'
    await mainFrame.value.request('pick-start', { taskId: task.id })
  } catch (error) { if (interaction.value?.id === task.id) status.value = error.message }
}

async function cancelInteraction() {
  const kind = interaction.value?.kind
  sequence++; highlightVersion++; interaction.value = null
  if (mainReady.value) await mainFrame.value.request('cancel').catch(() => {})
  status.value = kind === 'trigger' ? 'Выбор элемента запуска отменён.' : selected.value && isDraft(selected.value) ? 'Выбор отменен. Черновик шага остался в списке.' : 'Настройка отменена. Сохраненные настройки не изменились.'
}

function onWidgetEvent(message) {
  const task = interaction.value
  if (message.name === 'picked' && task && message.taskId === task.id) {
    if (task.kind === 'trigger') {
      try {
        const target = project.value.scenarios.find(item => item.id === task.scenarioId)
        if (!target) return
        target.trigger.selector = message.selector
        target.trigger.label = message.label || 'Выбранный элемент'
        target.trigger.pageUrl = canonicalUrl(message.pageUrl, SITE)
        target.trigger.pageScope = 'page'
        interaction.value = null; sequence++
        status.value = 'Элемент запуска выбран. Сохраните настройки запуска.'
      } catch (error) { status.value = error.message }
      return
    }
    const step = steps.value.find(item => item.id === task.stepId)
    if (!step) return
    try {
      step.pageUrl = canonicalUrl(message.pageUrl, SITE)
      applyTarget(step, task.device, message, task.actions)
      selectedId.value = step.id; interaction.value = null; sequence++
      status.value = 'Цель сохранена. Проверяем компьютерную и мобильную версии.'
      highlightSelected()
    } catch (error) { status.value = error.message }
  } else if (message.name === 'action-recorded' && task?.phase === 'record' && message.taskId === task.id) {
    task.actions = normalizeActions(message.actions)
  } else if (['pick-cancelled', 'pick-error'].includes(message.name) && task && message.taskId === task.id) {
    interaction.value = null; sequence++
    status.value = message.message || (task.kind === 'trigger' ? 'Выбор элемента запуска отменён.' : 'Выбор отменен. Шаг остался в списке.')
  } else if (message.name === 'record-note' && task && message.taskId === task.id) status.value = message.message
  else if (message.name === 'trigger_dismissed' && armed.value && !playing.value && Array.isArray(message.scenarioIds) && message.scenarioIds.includes(launchSession.value.scenario.id)) {
    disableTriggers(); status.value = 'Приглашение закрыто. Нажмите «Запустить тур», чтобы показать его снова.'
  } else if (message.name === 'scenario_triggered' && armed.value && !playing.value && message.scenarioId === launchSession.value.scenario.id) {
    clearNotification(); preview(launchSession.value.scenario)
  } else if (playback.value && message.runId === playback.value.id) {
    const run = playback.value, step = run.steps[message.index]
    if (!Number.isInteger(message.index) || !step || message.stepId !== step.id) return
    run.index = message.index; run.started = true
    if (Array.isArray(message.completed)) run.completed = [...new Set([...run.completed, ...message.completed.filter(id => run.steps.some(item => item.id === id))])]
    selectedId.value = step.id
    if (message.name === 'tour_progress') return
    recordEvent(message, run)
    if (message.name === 'tour_navigate') { showPlayback(run); return }
    if (message.name === 'step_shown') status.value = run.scenarioName + ' · шаг ' + (run.index + 1) + ' из ' + run.steps.length + '.'
    if (['tour_completed', 'tour_skipped', 'tour_stopped', 'tour_error'].includes(message.name)) {
      playback.value = null; runRequest++
      disableTriggers()
      status.value = message.name === 'tour_error' ? 'Нужно настроить шаг: ' + message.message : 'Предпросмотр завершен.'
    }
  }
}

function moveStep(id, delta) {
  const from = steps.value.findIndex(step => step.id === id), to = from + delta
  if (from < 0 || to < 0 || to >= steps.value.length) return
  const list = [...steps.value]; [list[from], list[to]] = [list[to], list[from]]; steps.value = list
}

function deleteStep(id) {
  if (interaction.value?.stepId === id) cancelInteraction()
  steps.value = steps.value.filter(step => step.id !== id)
  if (selectedId.value === id) {
    selectedId.value = null
    if (mainReady.value) mainFrame.value.request('cancel').catch(() => {})
  }
}

function recordEvent(message, run) {
  const id = message.eventId || crypto.randomUUID()
  if (events.value.some(event => event.id === id)) return
  events.value.unshift({ id, name: message.name, scenarioName: run.scenarioName, runId: run.id, time: new Date().toLocaleTimeString(), index: message.index ?? run.index })
  events.value = events.value.slice(0, 200)
}

function resetPlayback() {
  if (playback.value) recordEvent({ name: 'tour_stopped' }, playback.value)
  playback.value = null; runRequest++
}

function failPlayback(message) {
  if (playback.value) recordEvent({ name: 'tour_error' }, playback.value)
  playback.value = null; runRequest++; disableTriggers(); status.value = message
  if (mainReady.value) mainFrame.value.request('cancel').catch(() => {})
}

async function showPlayback(run) {
  if (!run || playback.value !== run) return
  const step = run.steps[run.index]
  selectedId.value = step.id
  if (currentPage.value !== step.pageUrl) {
    status.value = 'Открываем страницу шага ' + (run.index + 1) + ' из ' + run.steps.length + '…'
    navigationIntent = step.pageUrl; mainReady.value = false; frameUrl.value = step.pageUrl; frameEpoch.value++
    return
  }
  if (!mainReady.value) return
  const ticket = ++runRequest
  try {
    const result = await mainFrame.value.request('preview', { ...run, runId: run.id })
    if (playback.value !== run || ticket !== runRequest) return
    if (!result?.ok) { failPlayback(result?.message || 'Не удалось запустить сценарий. Обновите страницу сайта.'); return }
    run.started = true
  } catch (error) { if (playback.value === run && ticket === runRequest && mainReady.value) failPlayback(error.message) }
}

async function preview(target = scenario.value) {
  try {
    const run = createPlayback(target, device.value, SITE)
    highlightVersion++; sequence++; interaction.value = null
    project.value.activeScenarioId = target.id
    playback.value = run
    await nextTick()
    await showPlayback(playback.value)
  } catch (error) { status.value = error.message }
}

async function stopPreview() {
  resetPlayback(); disableTriggers()
  if (mainReady.value) await mainFrame.value.request('cancel').catch(() => {})
  status.value = 'Сценарий остановлен.'
}

function addScenario() {
  disableTriggers(); resetSettingsPanel(); selectedId.value = null
  const item = createScenario('Сценарий ' + (project.value.scenarios.length + 1))
  project.value.scenarios.push(item); project.value.activeScenarioId = item.id
  status.value = 'Добавьте шаги нового сценария и выберите способ запуска.'
}

async function chooseScenario(event) {
  resetPlayback(); disableTriggers(); resetSettingsPanel(); interaction.value = null; sequence++
  project.value.activeScenarioId = event.target.value
  selectedId.value = null
  if (scenario.value.steps[0]) await selectStep(scenario.value.steps[0])
}

function deleteScenario() {
  if (project.value.scenarios.length < 2 || !confirm('Удалить сценарий «' + scenario.value.name + '» и его шаги?')) return
  disableTriggers(); resetSettingsPanel(); interaction.value = null; sequence++; selectedId.value = null
  project.value.scenarios = project.value.scenarios.filter(item => item.id !== scenario.value.id)
  project.value.activeScenarioId = project.value.scenarios[0].id
}

async function pickTrigger() {
  disableTriggers(); highlightVersion++
  const task = { id: crypto.randomUUID(), kind: 'trigger', scenarioId: scenario.value.id, phase: 'pick', actions: [] }
  interaction.value = task
  try { await mainFrame.value.request('pick-start', { taskId: task.id }); status.value = 'Нажмите на элемент сайта, который должен запускать этот сценарий.' }
  catch (error) { interaction.value = null; status.value = error.message }
}

function disableTriggers() {
  if (!armed.value) return
  launchSession.value = null; triggerRequest++; clearNotification()
  if (mainReady.value) mainFrame.value.request('configure', { siteId: project.value.siteId, scenarios: [] }).catch(() => {})
}

async function syncTriggers(resetOffers = false) {
  const session = launchSession.value
  if (!session || !mainReady.value) return
  const ticket = ++triggerRequest
  try {
    const result = await mainFrame.value.request('configure', { ...session.config, resetOffers })
    if (ticket !== triggerRequest || launchSession.value !== session) return
    if (!result?.ok) throw new Error(result?.message || 'Не удалось настроить триггеры. Проверьте выбранные элементы.')
    if (!playing.value) {
      status.value = 'Тур запущен. ' + waitingMessage.value
      if (notification.value?.title === 'Тур запущен') notification.value.text = waitingMessage.value
    }
    return true
  } catch (error) {
    if (ticket === triggerRequest && launchSession.value === session && mainReady.value) { disableTriggers(); status.value = error.message }
    return false
  }
}

async function startTour() {
  clearNotification()
  if (!launchReady.value) { await showSettingsError('Настройте и сохраните запуск сценария перед началом тура.'); return }
  try {
    const snapshot = JSON.parse(JSON.stringify(scenario.value))
    const config = exportProject({ ...project.value, scenarios: [{ ...snapshot, enabled: true }] }, SITE)
    highlightVersion++; sequence++
    launchSession.value = { scenario: snapshot, config }
    notify('Тур запущен', waitingMessage.value)
    await syncTriggers(true)
  } catch (error) { disableTriggers(); status.value = error.message }
}

function downloadConfig() {
  try {
    const data = exportProject(project.value, SITE)
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'onboarding.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    status.value = 'Конфигурация скачана. Разместите onboarding.json на сайте по указанному адресу.'
  } catch (error) { status.value = error.message }
}

watch(device, async () => { await nextTick(); if (!interaction.value && !playing.value) highlightSelected() })
onBeforeUnmount(() => { disposed = true; clearTimeout(validationTimer); clearNotification(); sequence++; highlightVersion++ })
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <div><p class="eyebrow">ИНТЕРАКТИВНЫЙ ОНБОРДИНГ</p><h1>Конструктор сценариев</h1></div>
      <span class="connection" :class="{ online: mainReady }">{{ mainReady ? 'Сайт подключен' : 'Подключаем сайт' }}</span>
      <button v-if="playing || armed" class="button" @click="stopPreview">Остановить тур</button>
      <button v-else class="button primary" :disabled="!mainReady || !steps.length || !!interaction" @click="startTour">Запустить тур</button>
    </header>
    <p class="status-bar" :role="notification ? undefined : 'status'">{{ status }}</p>
    <div v-if="notification" class="launch-notice" role="status" aria-live="polite">
      <button class="notice-close" aria-label="Закрыть уведомление" @click="clearNotification">×</button>
      <strong>{{ notification.title }}</strong><p>{{ notification.text }}</p>
    </div>

    <section class="panel scenarios-panel" aria-label="Сценарии сайта">
      <div class="scenario-toolbar">
        <label class="field scenario-select">Сценарий<select :value="scenario.id" :disabled="playing || !!interaction" @change="chooseScenario"><option v-for="item in project.scenarios" :key="item.id" :value="item.id">{{ item.name }} · {{ item.steps.length }} шагов</option></select></label>
        <button class="button" :disabled="playing || !!interaction || project.scenarios.length >= 20" @click="addScenario">+ Новый сценарий</button>
        <button class="button subtle" :disabled="playing || !!interaction || project.scenarios.length < 2" @click="deleteScenario">Удалить сценарий</button>
        <label class="enabled-field"><input v-model="scenario.enabled" type="checkbox" :disabled="playing || !!interaction"> Включён на сайте</label>
      </div>
      <details ref="settingsDetails" class="launch-settings" :open="settingsOpen" @toggle="settingsOpen = $event.target.open">
        <summary><span>Настройки запуска</span><span class="setup-badge" :class="{ ready: launchReady }">{{ launchReady ? 'Сохранено' : scenario.triggerConfirmation ? 'Есть изменения' : 'Обязательно' }}</span></summary>
        <p class="hint setup-intro">Выберите, как и где предложить обучение. Перед запуском сохраните эти настройки.</p>
        <p v-if="settingsMessage" class="settings-error" role="alert">{{ settingsMessage }}</p>
        <div class="scenario-settings">
        <div>
          <label class="field">Название сценария<input v-model="scenario.name" maxlength="120" :disabled="playing || !!interaction"></label>
          <label class="field">Способ запуска<select v-model="scenario.trigger.type" :disabled="playing || !!interaction"><option value="offer">Приглашение справа внизу</option><option value="click">Клик по элементу сайта</option><option value="manual">Вызов из JavaScript</option></select></label>
          <fieldset v-if="scenario.trigger.type !== 'manual'" class="page-scope" :disabled="playing || !!interaction">
            <legend>{{ scenario.trigger.type === 'offer' ? 'Где показывать приглашение?' : 'Где ждать нажатия?' }}</legend>
            <label class="page-choice"><input v-model="scenario.trigger.pageScope" type="radio" value="all"> На всех страницах сайта</label>
            <label class="page-choice"><input v-model="scenario.trigger.pageScope" type="radio" value="page"> На выбранной странице</label>
            <div v-if="scenario.trigger.pageScope === 'page'" class="page-picker">
              <label class="field">Страница запуска<select v-model="scenario.trigger.pageUrl" :aria-invalid="!!configurationErrors.pageUrl" :aria-describedby="configurationErrors.pageUrl ? 'launch-page-error' : 'launch-page-help'"><option disabled value="">Выберите страницу</option><option v-for="page in availablePages" :key="page.url" :value="page.url">{{ page.label }}</option></select></label>
              <p v-if="configurationErrors.pageUrl" id="launch-page-error" class="field-error">{{ configurationErrors.pageUrl }}</p>
              <button class="button small" :disabled="!mainReady" @click="useCurrentPage">Использовать открытую страницу</button>
              <p id="launch-page-help" class="hint">Адрес вводить не нужно. Откройте нужную страницу в окне сайта и нажмите эту кнопку или выберите посещённую страницу из списка.</p>
            </div>
          </fieldset>
          <div v-if="scenario.trigger.type === 'click'">
            <button class="button" :disabled="!mainReady || playing || !!interaction" :aria-invalid="!!configurationErrors.selector" @click="pickTrigger">Выбрать элемент запуска</button>
            <p class="hint">{{ scenario.trigger.selector ? 'Выбрано: ' + (scenario.trigger.label || 'элемент сайта') : 'Нажмите кнопку выше, затем выберите нужный элемент в окне сайта.' }}</p>
            <p v-if="configurationErrors.selector" class="field-error">{{ configurationErrors.selector }}</p>
          </div>
          <p v-if="scenario.trigger.type === 'manual'" class="hint">Вызовите для этого сценария:<code class="code-block">window.Onboarding.start("{{ scenario.id }}")</code></p>
        </div>
        <div v-if="scenario.trigger.type === 'offer'" class="offer-settings">
          <label class="field">Заголовок приглашения <span aria-hidden="true">*</span><input v-model="scenario.trigger.title" aria-label="Заголовок приглашения" required maxlength="120" :disabled="playing || !!interaction" :aria-invalid="!!configurationErrors.title" :aria-describedby="configurationErrors.title ? 'launch-title-error' : undefined"></label>
          <p v-if="configurationErrors.title" id="launch-title-error" class="field-error">{{ configurationErrors.title }}</p>
          <label class="field">Текст приглашения <span aria-hidden="true">*</span><textarea v-model="scenario.trigger.text" aria-label="Текст приглашения" required rows="2" maxlength="500" :disabled="playing || !!interaction" :aria-invalid="!!configurationErrors.text" :aria-describedby="configurationErrors.text ? 'launch-text-error' : undefined" /></label>
          <p v-if="configurationErrors.text" id="launch-text-error" class="field-error">{{ configurationErrors.text }}</p>
          <label class="field">Текст кнопки <span aria-hidden="true">*</span><input v-model="scenario.trigger.buttonText" aria-label="Текст кнопки" required maxlength="80" :disabled="playing || !!interaction" :aria-invalid="!!configurationErrors.buttonText" :aria-describedby="configurationErrors.buttonText ? 'launch-button-error' : undefined"></label>
          <p v-if="configurationErrors.buttonText" id="launch-button-error" class="field-error">{{ configurationErrors.buttonText }}</p>
        </div>
        <div class="scenario-help">
          <strong>Как начнётся обучение</strong>
          <p v-if="scenario.trigger.type === 'offer'">После нажатия «Запустить тур» на подходящей странице появится приглашение справа внизу. Шаги начнутся, когда посетитель нажмёт его кнопку.</p>
          <p v-else-if="scenario.trigger.type === 'click'">Нажмите «Запустить тур», перейдите на нужную страницу и нажмите выбранный элемент. До этого сценарий будет ждать.</p>
          <p v-else>Нажмите «Запустить тур», затем вызовите указанный код в контексте сайта. До вызова шаги не показываются.</p>
          <p class="hint">Запускается выбранный сценарий. Его шаги могут вести по разным страницам сайта.</p>
        </div>
        </div>
        <div class="launch-actions"><button class="button primary" data-testid="save-launch" :disabled="playing || !!interaction" @click="saveLaunchSettings">Сохранить настройки запуска</button><span v-if="launchReady" class="hint">Настройки сохранены</span></div>
      </details>
      <div v-if="interaction?.kind === 'trigger'" class="interaction-card"><strong>Выберите элемент запуска в окне сайта</strong><p>Он будет запускать только сценарий «{{ scenario.name }}».</p><button class="button" @click="cancelInteraction">Отменить настройку</button></div>
      <details class="connection-details">
        <summary>Подключение сайта и экспорт</summary>
        <p>В прототипе настройки сохраняются в этом браузере. Чтобы применить их на сайте, разместите файл <code>onboarding.json</code> и добавьте скрипт на все страницы. После изменений обновляйте файл конфигурации.</p>
        <label class="field">Адрес файла конфигурации<input v-model="configUrl" type="url"></label>
        <pre class="code-block">{{ installScript }}</pre>
        <button class="button" :disabled="playing || !!interaction" @click="downloadConfig">Скачать onboarding.json</button>
      </details>
    </section>

    <div class="workspace">
      <aside class="panel steps-panel">
        <div class="panel-title"><h2>Шаги</h2><span class="count">{{ steps.length }}</span></div>
        <button class="button add-step" :disabled="!mainReady || !!interaction || playing || steps.length >= 50" @click="addStep">+ Выбрать элемент</button>
        <p v-if="!steps.length" class="empty-hint">Добавьте шаг. Он сразу появится здесь, а затем можно выбрать его цель на сайте.</p>
        <ol class="step-list">
          <li v-for="(step, index) in steps" :key="step.id" class="step-item" :class="{ active: selectedId === step.id }" :data-step-id="step.id">
            <button class="step-select" :disabled="playing || !!interaction" @click="selectStep(step)">
              <span class="step-number">{{ index + 1 }}</span><span class="step-copy"><strong>{{ step.title || 'Без заголовка' }}</strong><small>{{ isDraft(step) ? 'Черновик · выберите элемент' : pageName(step.pageUrl) }}</small></span>
            </button>
            <div class="step-actions">
              <button :disabled="index === 0 || !!interaction || playing" aria-label="Переместить шаг вверх" @click="moveStep(step.id, -1)">↑</button>
              <button :disabled="index === steps.length - 1 || !!interaction || playing" aria-label="Переместить шаг вниз" @click="moveStep(step.id, 1)">↓</button>
              <button :disabled="playing" @click="deleteStep(step.id)">Удалить</button>
            </div>
          </li>
        </ol>
      </aside>

      <section class="panel preview-panel" aria-label="Предпросмотр сайта">
        <div class="preview-toolbar">
          <div class="device-switch" role="group" aria-label="Версия сайта">
            <button v-for="(view, kind) in DEVICES" :key="kind" :aria-pressed="device === kind" :disabled="!!interaction || playing" @click="device = kind">{{ view.label }}</button>
          </div>
          <a :href="currentPage" target="_blank" rel="noopener">Открыть сайт ↗</a>
        </div>
        <p class="preview-caption">{{ viewport.label }} · ширина {{ viewport.width }} px · {{ playing ? 'Шаг ' + (playback.index + 1) + ' из ' + playback.steps.length : armed ? 'ожидаем запуска сценария' : 'масштаб подстраивается под панель' }}</p>
        <div class="preview-surface">
          <PreviewFrame :key="frameEpoch" ref="mainFrame" :url="frameUrl" :width="viewport.width" :height="viewport.height"
            @loading="onMainLoading" @ready="onMainReady" @disconnected="onMainOffline" @message="onWidgetEvent" />
        </div>
      </section>

      <aside class="panel inspector">
        <template v-if="selected">
          <div class="panel-title"><h2>Настройка шага</h2><span v-if="isDraft(selected)" class="draft-badge">Черновик</span></div>
          <label class="field">Заголовок<input v-model="selected.title" maxlength="120" :disabled="playing"></label>
          <label class="field">Текст подсказки<textarea v-model="selected.text" rows="4" maxlength="2000" :disabled="playing" placeholder="Объясните действие пользователя" /></label>

          <div v-if="interaction && interaction.kind !== 'trigger'" class="interaction-card" data-testid="interaction-card">
            <strong>{{ interaction.phase === 'record' ? 'Подготовьте нужный элемент' : 'Выберите конечный элемент' }}</strong>
            <p v-if="interaction.phase === 'record'">Откройте нужное меню, список или вкладку на сайте. Эти действия будут сохранены для версии «{{ DEVICES[interaction.device].label }}».</p>
            <p v-else>Нажмите на целевой элемент внутри сайта. Нажатие выберет его для шага.</p>
            <ol v-if="interaction.actions.length" class="recorded-actions"><li v-for="(action, index) in interaction.actions" :key="index">{{ action.kind === 'select' ? 'Выбрать вариант: ' : 'Нажать: ' }}{{ action.label || 'элемент' }}</li></ol>
            <button v-if="interaction.phase === 'record'" class="button primary" @click="chooseFinalTarget">Выбрать конечный элемент</button>
            <button class="button subtle" @click="cancelInteraction">Отменить настройку</button>
          </div>
          <button v-else-if="!interaction" class="button full-width" :disabled="!mainReady || playing" @click="beginPick(selected, device)">{{ isDraft(selected) ? 'Выбрать цель шага' : 'Изменить цель этой версии' }}</button>

          <section class="versions-section" aria-label="Проверка версий">
            <div class="panel-title"><h3>Доступность элемента</h3><button class="text-button" :disabled="!!interaction || playing" @click="refreshChecks">Проверить</button></div>
            <p class="hint">Обе версии проверяются автоматически после выбора цели.</p>
            <article v-for="(view, kind) in DEVICES" :key="kind" class="version-card" :class="{ warning: !['ready', 'idle', 'pending'].includes(checks[kind].state), success: checks[kind].state === 'ready' }" :data-testid="'check-' + kind" :data-state="checks[kind].state">
              <div class="version-card-title"><strong>{{ view.label }}</strong><span>{{ describeState(checks[kind].state) }}</span></div>
              <template v-if="!['ready', 'idle', 'pending'].includes(checks[kind].state)">
                <p v-if="checks[kind].state === 'offline'">{{ checks[kind].message }}</p>
                <p v-else>Нужно добавить цель для {{ kind === 'mobile' ? 'мобильной' : 'компьютерной' }} версии. Если элемент скрыт, запишите действия, которые его открывают.</p>
              </template>
              <p v-else-if="checks[kind].state === 'ready'" class="hint">Элемент доступен{{ configFor(selected, kind).actions.length ? ' после подготовки' : '' }}.</p>
              <button v-if="!isDraft(selected) && checks[kind].state !== 'offline'" class="button small" :disabled="!mainReady || !!interaction || playing" @click="configureVariant(kind)">{{ checks[kind].state === 'ready' ? 'Изменить настройку' : 'Настроить версию' }}</button>
            </article>
          </section>
          <label class="field color-field">Цвет кнопок тура<input v-model="color" type="color" :disabled="playing"></label>
          <p class="hint">Черновик сохраняется в этом браузере.</p>
        </template>
        <div v-else class="empty-inspector"><h2>Выберите шаг</h2><p>Здесь появятся текст подсказки и результаты проверки обеих версий сайта.</p></div>
        <details class="events-details"><summary>События предпросмотра</summary><ul><li v-for="event in events" :key="event.id">{{ event.time }} · {{ event.scenarioName }} · {{ event.name }}</li></ul></details>
      </aside>
    </div>
    <div v-if="checkJob" class="validation-frames" aria-hidden="true">
      <PreviewFrame :key="checkJob.id + '-desktop'" ref="desktopValidator" :url="checkJob.step.pageUrl" :width="DEVICES.desktop.width" :height="DEVICES.desktop.height" validator :identity="checkJob.id" @ready="validateVariant('desktop', $event)" @disconnected="validatorOffline('desktop', $event)" />
      <PreviewFrame :key="checkJob.id + '-mobile'" ref="mobileValidator" :url="checkJob.step.pageUrl" :width="DEVICES.mobile.width" :height="DEVICES.mobile.height" validator :identity="checkJob.id" @ready="validateVariant('mobile', $event)" @disconnected="validatorOffline('mobile', $event)" />
    </div>
  </main>
</template>
