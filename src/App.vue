<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import PreviewFrame from './components/PreviewFrame.vue'
import { DEVICES, applyTarget, canonicalUrl, configFor, createStep, createScenario, createPlayback, exportProject, isDraft, normalizeActions, readProject, validationKey } from './model.js'
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
const status = ref('Подключаем сайт…'), events = ref([]), interaction = ref(null), playback = ref(null), testingTriggers = ref(false)
const playing = computed(() => !!playback.value)
const selected = computed(() => steps.value.find(step => step.id === selectedId.value))
const viewport = computed(() => DEVICES[device.value])
const checkJob = ref(null), checks = ref({ desktop: { state: 'idle' }, mobile: { state: 'idle' } })
let navigationIntent = '', validationTimer, highlightVersion = 0, sequence = 0, disposed = false, runRequest = 0, triggerRequest = 0
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
  if (testingTriggers.value && !playing.value) {
    disableTriggers()
    status.value = 'Настройки изменились. Нажмите «Проверить триггеры», чтобы применить их в предпросмотре.'
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
  if (!step || isDraft(step) || !mainReady.value || interaction.value || playing.value || testingTriggers.value || step.pageUrl !== currentPage.value) return
  try {
    const result = await mainFrame.value.request('highlight', { config: configFor(step, device.value) })
    if (token !== highlightVersion || selectedId.value !== step.id || interaction.value || playing.value) return
    status.value = result.state === 'ready' ? 'Цель шага подсвечена.' : 'Для этой версии нужно настроить цель. Подсказка справа.'
  } catch (error) { if (token === highlightVersion) status.value = error.message }
}

function onMainLoading() {
  mainReady.value = false; runRequest++
  if (playback.value) status.value = 'Подключаем страницу шага ' + (playback.value.index + 1) + '…'
  if (interaction.value && !navigationIntent) {
    interaction.value = null; sequence++
    status.value = 'Страница изменилась. Шаг сохранен; выбор элемента можно повторить.'
  }
}

function onMainReady(info) {
  let url
  try { url = canonicalUrl(info.url, SITE) } catch { status.value = 'Сайт перешел на неподдерживаемый адрес.'; return }
  currentPage.value = url
  navigationIntent = ''
  mainReady.value = true
  if (playback.value) {
    if (playback.value.steps[playback.value.index].pageUrl !== url) { failPlayback('Сайт открыл другую страницу. Проверьте адрес шага и доступ к нему.'); return }
    showPlayback(playback.value)
    return
  }
  if (selected.value && selected.value.pageUrl !== url) selectedId.value = null
  if (testingTriggers.value) { syncTriggers(); return }
  if (!interaction.value) { status.value = 'Сайт подключен. Выберите шаг или добавьте новый.'; highlightSelected() }
}

function onMainOffline(info) {
  mainReady.value = false
  if (playback.value) failPlayback(info.message)
  else status.value = info.message
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
  status.value = kind === 'trigger' ? 'Выбор кнопки запуска отменён.' : selected.value && isDraft(selected.value) ? 'Выбор отменен. Черновик шага остался в списке.' : 'Настройка отменена. Сохраненные настройки не изменились.'
}

function onWidgetEvent(message) {
  const task = interaction.value
  if (message.name === 'picked' && task && message.taskId === task.id) {
    if (task.kind === 'trigger') {
      try {
        const target = project.value.scenarios.find(item => item.id === task.scenarioId)
        if (!target) return
        target.trigger.selector = message.selector
        target.trigger.pageUrl = canonicalUrl(message.pageUrl, SITE)
        interaction.value = null; sequence++
        status.value = 'Кнопка запуска выбрана. Проверьте триггер на сайте.'
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
    status.value = message.message || (task.kind === 'trigger' ? 'Выбор кнопки запуска отменён.' : 'Выбор отменен. Шаг остался в списке.')
  } else if (message.name === 'record-note' && task && message.taskId === task.id) status.value = message.message
  else if (message.name === 'scenario_triggered' && testingTriggers.value && !playing.value) {
    const target = project.value.scenarios.find(item => item.id === message.scenarioId && item.enabled)
    if (target) preview(target)
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
      status.value = message.name === 'tour_error' ? 'Нужно настроить шаг: ' + message.message : 'Предпросмотр завершен.'
      if (testingTriggers.value && message.name !== 'tour_error') syncTriggers()
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
  playback.value = null; runRequest++; status.value = message
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
  resetPlayback()
  if (mainReady.value) await mainFrame.value.request('cancel').catch(() => {})
  status.value = 'Сценарий остановлен.'
  if (testingTriggers.value) syncTriggers()
}

function addScenario() {
  disableTriggers(); selectedId.value = null
  const item = createScenario('Сценарий ' + (project.value.scenarios.length + 1))
  project.value.scenarios.push(item); project.value.activeScenarioId = item.id
  status.value = 'Добавьте шаги нового сценария и выберите способ запуска.'
}

async function chooseScenario(event) {
  resetPlayback(); disableTriggers(); interaction.value = null; sequence++
  project.value.activeScenarioId = event.target.value
  selectedId.value = null
  if (scenario.value.steps[0]) await selectStep(scenario.value.steps[0])
}

function deleteScenario() {
  if (project.value.scenarios.length < 2 || !confirm('Удалить сценарий «' + scenario.value.name + '» и его шаги?')) return
  disableTriggers(); interaction.value = null; sequence++; selectedId.value = null
  project.value.scenarios = project.value.scenarios.filter(item => item.id !== scenario.value.id)
  project.value.activeScenarioId = project.value.scenarios[0].id
}

async function pickTrigger() {
  disableTriggers(); highlightVersion++
  const task = { id: crypto.randomUUID(), kind: 'trigger', scenarioId: scenario.value.id, phase: 'pick', actions: [] }
  interaction.value = task
  try { await mainFrame.value.request('pick-start', { taskId: task.id }); status.value = 'Нажмите на кнопку сайта, которая должна запускать этот сценарий.' }
  catch (error) { interaction.value = null; status.value = error.message }
}

function disableTriggers() {
  if (!testingTriggers.value) return
  testingTriggers.value = false; triggerRequest++
  if (mainReady.value) mainFrame.value.request('configure', { siteId: project.value.siteId, scenarios: [] }).catch(() => {})
}

async function syncTriggers(resetOffers = false) {
  const ticket = ++triggerRequest
  try {
    const result = await mainFrame.value.request('configure', { ...exportProject(project.value, SITE), resetOffers })
    if (ticket !== triggerRequest || !testingTriggers.value) return
    if (!result?.ok) throw new Error(result?.message || 'Не удалось настроить триггеры. Проверьте выбранные элементы.')
    status.value = 'Триггеры включены в предпросмотре: откройте приглашение или нажмите выбранную кнопку сайта.'
  } catch (error) { if (ticket === triggerRequest) { disableTriggers(); status.value = error.message } }
}

async function testTriggers() {
  if (testingTriggers.value) { disableTriggers(); status.value = 'Проверка триггеров выключена.'; return }
  testingTriggers.value = true; highlightVersion++
  await syncTriggers(true)
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
onBeforeUnmount(() => { disposed = true; clearTimeout(validationTimer); sequence++; highlightVersion++ })
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <div><p class="eyebrow">ИНТЕРАКТИВНЫЙ ОНБОРДИНГ</p><h1>Конструктор сценариев</h1></div>
      <span class="connection" :class="{ online: mainReady }">{{ mainReady ? 'Сайт подключен' : 'Подключаем сайт' }}</span>
      <button v-if="playing" class="button" @click="stopPreview">Остановить тур</button>
      <button v-else class="button primary" :disabled="!mainReady || !steps.length || !!interaction" @click="preview()">Запустить тур</button>
    </header>
    <p class="status-bar" role="status">{{ status }}</p>

    <section class="panel scenarios-panel" aria-label="Сценарии сайта">
      <div class="scenario-toolbar">
        <label class="field scenario-select">Сценарий<select :value="scenario.id" :disabled="playing || !!interaction" @change="chooseScenario"><option v-for="item in project.scenarios" :key="item.id" :value="item.id">{{ item.name }} · {{ item.steps.length }} шагов</option></select></label>
        <button class="button" :disabled="playing || !!interaction || project.scenarios.length >= 20" @click="addScenario">+ Новый сценарий</button>
        <button class="button subtle" :disabled="playing || !!interaction || project.scenarios.length < 2" @click="deleteScenario">Удалить сценарий</button>
        <label class="enabled-field"><input v-model="scenario.enabled" type="checkbox" :disabled="playing || !!interaction"> Включён на сайте</label>
      </div>
      <div class="scenario-settings">
        <div>
          <label class="field">Название сценария<input v-model="scenario.name" maxlength="120" :disabled="playing || !!interaction"></label>
          <label class="field">Способ запуска<select v-model="scenario.trigger.type" :disabled="playing || !!interaction"><option value="offer">Приглашение справа внизу</option><option value="click">Клик по элементу сайта</option><option value="manual">Вызов из JavaScript</option></select></label>
          <label class="field">{{ scenario.trigger.type === 'offer' ? 'Показывать на странице' : 'Страница запуска' }}<input v-model="scenario.trigger.pageUrl" :disabled="playing || !!interaction" placeholder="Пусто — любая страница сайта"></label>
          <div v-if="scenario.trigger.type === 'click'">
            <button class="button" :disabled="!mainReady || playing || !!interaction" @click="pickTrigger">Выбрать кнопку запуска</button>
            <p class="hint target-selector">{{ scenario.trigger.selector || 'Выберите элемент в предпросмотре сайта.' }}</p>
          </div>
          <p v-if="scenario.trigger.type === 'manual'" class="hint">Вызовите для этого сценария:<code class="code-block">window.Onboarding.start("{{ scenario.id }}")</code></p>
        </div>
        <div v-if="scenario.trigger.type === 'offer'" class="offer-settings">
          <label class="field">Заголовок приглашения<input v-model="scenario.trigger.title" maxlength="120" :disabled="playing || !!interaction"></label>
          <label class="field">Текст приглашения<textarea v-model="scenario.trigger.text" rows="2" maxlength="500" :disabled="playing || !!interaction" /></label>
          <label class="field">Текст кнопки<input v-model="scenario.trigger.buttonText" maxlength="80" :disabled="playing || !!interaction"></label>
        </div>
        <div class="scenario-help">
          <strong>{{ scenario.steps.length }} шагов · один сценарий</strong>
          <p>Добавляйте шаги с разных страниц. Тур начинается с первого шага и сам открывает нужные страницы при нажатии «Далее» и «Назад».</p>
          <button class="button full-width" :disabled="!mainReady || playing || !!interaction" @click="testTriggers">{{ testingTriggers ? 'Выключить триггеры' : 'Проверить триггеры' }}</button>
          <p class="hint">Проверка запускает включённые сценарии внутри предпросмотра. Для запуска на отдельном сайте скачайте конфигурацию ниже.</p>
        </div>
      </div>
      <div v-if="interaction?.kind === 'trigger'" class="interaction-card"><strong>Выберите кнопку запуска в окне сайта</strong><p>Она будет запускать только сценарий «{{ scenario.name }}».</p><button class="button" @click="cancelInteraction">Отменить настройку</button></div>
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
        <p class="preview-caption">{{ viewport.label }} · ширина {{ viewport.width }} px · {{ playing ? 'Шаг ' + (playback.index + 1) + ' из ' + playback.steps.length : 'масштаб подстраивается под панель' }}</p>
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
