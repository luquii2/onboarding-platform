<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import PreviewFrame from './components/PreviewFrame.vue'
import { DEVICES, applyTarget, canonicalUrl, configFor, createStep, isDraft, normalizeActions, readDraft, validationKey } from './model.js'
import './styles.css'

const SITE = import.meta.env.VITE_DEMO_SITE_URL || 'http://localhost:4174/'
const STORAGE = 'onboarding-prototype:' + SITE
const mainFrame = ref(null), desktopValidator = ref(null), mobileValidator = ref(null)
const mainReady = ref(false), frameUrl = ref(SITE), frameEpoch = ref(0), currentPage = ref(SITE)
const steps = ref([]), selectedId = ref(null), color = ref('#4f46e5'), device = ref('desktop')
const status = ref('Подключаем сайт…'), events = ref([]), playing = ref(false), interaction = ref(null)
const selected = computed(() => steps.value.find(step => step.id === selectedId.value))
const viewport = computed(() => DEVICES[device.value])
const pageSteps = computed(() => steps.value.filter(step => step.pageUrl === currentPage.value))
const checkJob = ref(null), checks = ref({ desktop: { state: 'idle' }, mobile: { state: 'idle' } })
let navigationIntent = '', validationTimer, highlightVersion = 0, sequence = 0, disposed = false

try {
  const draft = readDraft(JSON.parse(localStorage.getItem(STORAGE) || 'null'), SITE)
  steps.value = draft.steps; color.value = draft.color
  selectedId.value = steps.value.find(step => step.pageUrl === SITE)?.id ?? null
} catch { status.value = 'Черновик не удалось прочитать. Можно создать новый.' }

watch([steps, color], () => {
  try { localStorage.setItem(STORAGE, JSON.stringify({ schema: 3, steps: steps.value, color: color.value })) }
  catch { status.value = 'Браузер не разрешил сохранить черновик.' }
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
  if (!step || isDraft(step) || !mainReady.value || interaction.value || playing.value || step.pageUrl !== currentPage.value) return
  try {
    const result = await mainFrame.value.request('highlight', { config: configFor(step, device.value) })
    if (token !== highlightVersion || selectedId.value !== step.id || interaction.value || playing.value) return
    status.value = result.state === 'ready' ? 'Цель шага подсвечена.' : 'Для этой версии нужно настроить цель. Подсказка справа.'
  } catch (error) { if (token === highlightVersion) status.value = error.message }
}

function onMainLoading() {
  mainReady.value = false; playing.value = false
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
  if (selected.value && selected.value.pageUrl !== url) selectedId.value = null
  if (!interaction.value) { status.value = 'Сайт подключен. Выберите шаг или добавьте новый.'; highlightSelected() }
}

function onMainOffline(info) { mainReady.value = false; status.value = info.message }

async function selectStep(step) {
  const token = ++sequence
  highlightVersion++; interaction.value = null; playing.value = false
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
  highlightVersion++; interaction.value = task; playing.value = false; device.value = kind
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
  highlightVersion++; interaction.value = task; playing.value = false; device.value = kind
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
  sequence++; highlightVersion++; interaction.value = null
  if (mainReady.value) await mainFrame.value.request('cancel').catch(() => {})
  status.value = selected.value && isDraft(selected.value) ? 'Выбор отменен. Черновик шага остался в списке.' : 'Настройка отменена. Сохраненные настройки не изменились.'
}

function onWidgetEvent(message) {
  const task = interaction.value
  if (message.name === 'picked' && task && message.taskId === task.id) {
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
    status.value = message.message || 'Выбор отменен. Шаг остался в списке.'
  } else if (message.name === 'record-note' && task && message.taskId === task.id) status.value = message.message
  else if (typeof message.runId === 'string') {
    events.value.unshift({ id: message.eventId || crypto.randomUUID(), name: message.name, time: new Date().toLocaleTimeString(), index: message.index })
    events.value = events.value.slice(0, 40)
    if (['tour_completed', 'tour_skipped', 'tour_stopped', 'tour_error'].includes(message.name)) {
      playing.value = false
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

async function preview() {
  if (!pageSteps.value.length || pageSteps.value.some(isDraft)) { status.value = 'Сначала выберите элемент для каждого черновика на этой странице.'; return }
  try {
    highlightVersion++; playing.value = true
    await mainFrame.value.request('preview', {
      color: color.value,
      steps: pageSteps.value.map(step => ({ id: step.id, title: step.title, text: step.text, config: configFor(step, device.value) })),
    })
    status.value = 'Предпросмотр тура: ' + DEVICES[device.value].label.toLowerCase() + '.'
  } catch (error) { playing.value = false; status.value = error.message }
}

async function stopPreview() {
  if (mainReady.value) await mainFrame.value.request('cancel').catch(() => {})
  playing.value = false
}

watch(device, async () => { await nextTick(); if (!interaction.value && !playing.value) highlightSelected() })
onBeforeUnmount(() => { disposed = true; clearTimeout(validationTimer); sequence++; highlightVersion++ })
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <div><p class="eyebrow">ИНТЕРАКТИВНЫЙ ОНБОРДИНГ</p><h1>Конструктор тура</h1></div>
      <span class="connection" :class="{ online: mainReady }">{{ mainReady ? 'Сайт подключен' : 'Подключаем сайт' }}</span>
      <button v-if="playing" class="button" @click="stopPreview">Остановить тур</button>
      <button v-else class="button primary" :disabled="!mainReady || !pageSteps.length || !!interaction" @click="preview">Запустить тур</button>
    </header>
    <p class="status-bar" role="status">{{ status }}</p>

    <div class="workspace">
      <aside class="panel steps-panel">
        <div class="panel-title"><h2>Шаги</h2><span class="count">{{ steps.length }}</span></div>
        <button class="button add-step" :disabled="!mainReady || !!interaction || playing || steps.length >= 50" @click="addStep">+ Выбрать элемент</button>
        <p v-if="!steps.length" class="empty-hint">Добавьте шаг. Он сразу появится здесь, а затем можно выбрать его цель на сайте.</p>
        <ol class="step-list">
          <li v-for="(step, index) in steps" :key="step.id" class="step-item" :class="{ active: selectedId === step.id }" :data-step-id="step.id">
            <button class="step-select" @click="selectStep(step)">
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
        <p class="preview-caption">{{ viewport.label }} · ширина {{ viewport.width }} px · масштаб подстраивается под панель</p>
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

          <div v-if="interaction" class="interaction-card" data-testid="interaction-card">
            <strong>{{ interaction.phase === 'record' ? 'Подготовьте нужный элемент' : 'Выберите конечный элемент' }}</strong>
            <p v-if="interaction.phase === 'record'">Откройте нужное меню, список или вкладку на сайте. Эти действия будут сохранены для версии «{{ DEVICES[interaction.device].label }}».</p>
            <p v-else>Нажмите на целевой элемент внутри сайта. Нажатие выберет его для шага.</p>
            <ol v-if="interaction.actions.length" class="recorded-actions"><li v-for="(action, index) in interaction.actions" :key="index">{{ action.kind === 'select' ? 'Выбрать вариант: ' : 'Нажать: ' }}{{ action.label || 'элемент' }}</li></ol>
            <button v-if="interaction.phase === 'record'" class="button primary" @click="chooseFinalTarget">Выбрать конечный элемент</button>
            <button class="button subtle" @click="cancelInteraction">Отменить настройку</button>
          </div>
          <button v-else class="button full-width" :disabled="!mainReady || playing" @click="beginPick(selected, device)">{{ isDraft(selected) ? 'Выбрать цель шага' : 'Изменить цель этой версии' }}</button>

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
        <details class="events-details"><summary>События предпросмотра</summary><ul><li v-for="event in events" :key="event.id">{{ event.time }} · {{ event.name }}</li></ul></details>
      </aside>
    </div>
    <div v-if="checkJob" class="validation-frames" aria-hidden="true">
      <PreviewFrame :key="checkJob.id + '-desktop'" ref="desktopValidator" :url="checkJob.step.pageUrl" :width="DEVICES.desktop.width" :height="DEVICES.desktop.height" validator :identity="checkJob.id" @ready="validateVariant('desktop', $event)" @disconnected="validatorOffline('desktop', $event)" />
      <PreviewFrame :key="checkJob.id + '-mobile'" ref="mobileValidator" :url="checkJob.step.pageUrl" :width="DEVICES.mobile.width" :height="DEVICES.mobile.height" validator :identity="checkJob.id" @ready="validateVariant('mobile', $event)" @disconnected="validatorOffline('mobile', $event)" />
    </div>
  </main>
</template>
