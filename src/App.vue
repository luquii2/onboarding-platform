<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const SITE = 'http://localhost:4174/'
const ORIGIN = new URL(SITE).origin
const CHANNEL = 'onboarding-prototype/v1'
const STORAGE = 'onboarding-prototype:' + SITE

const frame = ref(null)
const connected = ref(false)
const picking = ref(false)
const playing = ref(false)
const mobile = ref(false)
const status = ref('Подключаем демосайт…')
const steps = ref([])
const color = ref('#4f46e5')
const selectedId = ref(null)
const events = ref([])

const selected = computed(() =>
  steps.value.find(step => step.id === selectedId.value),
)

let session = ''
let timer
let replaceId = null

function validStep(step) {
  return step &&
    ['id', 'selector', 'title', 'text'].every(
      key => typeof step[key] === 'string',
    ) &&
    step.id.length > 0 &&
    step.selector.length > 0 &&
    step.selector.length <= 2000 &&
    step.title.length <= 120 &&
    step.text.length <= 2000
}

try {
  const draft = JSON.parse(localStorage.getItem(STORAGE) || 'null')

  if (
    draft &&
    Array.isArray(draft.steps) &&
    draft.steps.length <= 50 &&
    draft.steps.every(validStep) &&
    new Set(draft.steps.map(step => step.id)).size === draft.steps.length
  ) {
    steps.value = draft.steps

    if (/^#[0-9a-f]{6}$/i.test(draft.color)) {
      color.value = draft.color
    }

    selectedId.value = steps.value[0]?.id ?? null
  }
} catch {
  status.value = 'Сохраненный черновик недоступен. Можно создать новый.'
}

watch([steps, color], () => {
  try {
    localStorage.setItem(
      STORAGE,
      JSON.stringify({ steps: steps.value, color: color.value }),
    )
  } catch {
    status.value = 'Браузер не разрешил сохранить черновик.'
  }
}, { deep: true })

function log(name) {
  events.value.unshift({
    id: crypto.randomUUID(),
    name,
    time: new Date().toLocaleTimeString(),
  })

  events.value = events.value.slice(0, 40)
}

function send(type, payload = {}) {
  frame.value?.contentWindow?.postMessage(
    JSON.parse(JSON.stringify({
      channel: CHANNEL,
      session,
      type,
      ...payload,
    })),
    ORIGIN,
  )
}

function connect() {
  clearTimeout(timer)
  connected.value = picking.value = playing.value = false
  session = crypto.randomUUID()
  status.value = 'Ожидаем ответа виджета…'
  send('hello')

  timer = setTimeout(() => {
    status.value =
      'Нет ответа. Проверь сервер демосайта и подключение widget.js.'
  }, 5000)
}

function pick(id = null) {
  replaceId = id
  picking.value = true
  send('pick')
  status.value =
    'Нажми на нужный элемент внутри сайта. Esc отменяет выбор.'
}

function cancelPick() {
  send('cancel-pick')
  picking.value = false
  replaceId = null
  status.value = 'Выбор отменен.'
}

function remove(id) {
  steps.value = steps.value.filter(step => step.id !== id)

  if (selectedId.value === id) {
    selectedId.value = steps.value[0]?.id ?? null
  }
}

function move(id, direction) {
  const from = steps.value.findIndex(step => step.id === id)
  const to = from + direction

  if (from < 0 || to < 0 || to >= steps.value.length) return

  const updated = [...steps.value]
  ;[updated[from], updated[to]] = [updated[to], updated[from]]
  steps.value = updated
}

function preview() {
  playing.value = true
  send('preview', { steps: steps.value, color: color.value })
}

function stop() {
  send('stop')
  playing.value = false
}

function receive(event) {
  if (
    event.origin !== ORIGIN ||
    event.source !== frame.value?.contentWindow
  ) return

  const data = event.data

  if (
    !session ||
    !data ||
    data.channel !== CHANNEL ||
    data.session !== session
  ) return

  if (data.type === 'ready') {
    clearTimeout(timer)
    connected.value = true
    status.value = 'Виджет подключен. Добавь шаг и выбери элемент.'
  } else if (
    data.type === 'selected' &&
    picking.value &&
    typeof data.selector === 'string' &&
    data.selector.length > 0 &&
    data.selector.length <= 2000
  ) {
    const existing = steps.value.find(step => step.id === replaceId)

    if (existing) {
      existing.selector = data.selector
      selectedId.value = existing.id
    } else if (steps.value.length < 50) {
      const step = {
        id: crypto.randomUUID(),
        selector: data.selector,
        title: 'Новый шаг',
        text: 'Объясни, что здесь может сделать пользователь.',
      }

      steps.value.push(step)
      selectedId.value = step.id
    }

    picking.value = false
    replaceId = null
    status.value = 'Элемент выбран. Отредактируй подсказку.'
  } else if (data.type === 'pick-cancelled') {
    picking.value = false
    replaceId = null
    status.value = 'Выбор отменен.'
  } else if (
    data.type === 'event' &&
    typeof data.name === 'string' &&
    typeof data.runId === 'string' &&
    data.name.length < 80
  ) {
    log(
      data.name +
      (data.stepId ? ' · шаг ' + (data.index + 1) : ''),
    )

    if ([
      'tour_completed',
      'tour_skipped',
      'tour_stopped',
      'tour_error',
    ].includes(data.name)) {
      playing.value = false
      status.value = data.name === 'tour_error'
        ? 'Тур остановлен: ' + data.message
        : 'Предпросмотр завершен.'
    }
  } else if (
    data.type === 'error' &&
    typeof data.message === 'string'
  ) {
    picking.value = playing.value = false
    status.value = data.message.slice(0, 300)
  }
}

window.addEventListener('message', receive)

onBeforeUnmount(() => {
  send('stop')
  clearTimeout(timer)
  window.removeEventListener('message', receive)
})
</script>

<template>
  <main>
    <header>
      <div>
        <small>ТЕХНИЧЕСКИЙ ПРОТОТИП</small>
        <h1>Конструктор онбординга</h1>
      </div>

      <button
        :disabled="!connected || !steps.length || picking || playing"
        @click="preview"
      >
        Запустить тур
      </button>

      <button v-if="playing" @click="stop">Остановить</button>
    </header>

    <p role="status" class="status">{{ status }}</p>

    <div class="workspace">
      <aside>
        <h2>Шаги · {{ steps.length }}</h2>

        <button
          :disabled="!connected || picking || playing || steps.length >= 50"
          @click="pick()"
        >
          + Выбрать элемент
        </button>

        <button v-if="picking" @click="cancelPick">
          Отменить выбор
        </button>

        <p v-if="!steps.length">
          Добавь первый шаг и нажми на элемент сайта.
        </p>

        <ol>
          <li v-for="(step, index) in steps" :key="step.id">
            <button
              :class="{ active: selectedId === step.id }"
              @click="selectedId = step.id"
            >
              {{ index + 1 }}. {{ step.title || 'Без заголовка' }}
            </button>

            <div class="actions">
              <button
                :disabled="playing || picking || index === 0"
                aria-label="Переместить вверх"
                @click="move(step.id, -1)"
              >↑</button>

              <button
                :disabled="playing || picking || index === steps.length - 1"
                aria-label="Переместить вниз"
                @click="move(step.id, 1)"
              >↓</button>

              <button
                :disabled="playing || picking"
                @click="remove(step.id)"
              >
                Удалить
              </button>
            </div>
          </li>
        </ol>
      </aside>

      <section class="preview">
        <div class="toolbar">
          <a :href="SITE" target="_blank" rel="noopener">
            Демосайт ↗
          </a>

          <button
            :aria-pressed="mobile"
            :disabled="playing || picking"
            @click="mobile = !mobile"
          >
            {{ mobile ? 'Ширина компьютера' : 'Ширина телефона' }}
          </button>

          <button
            :disabled="playing || picking"
            @click="connect"
          >
            Проверить связь
          </button>
        </div>

        <div class="frame-area">
          <iframe
            ref="frame"
            :src="SITE"
            :class="{ mobile }"
            title="Демосайт для создания тура"
            @load="connect"
          />
        </div>
      </section>

      <aside>
        <h2>Подсказка</h2>

        <fieldset :disabled="playing || picking">
          <template v-if="selected">
            <label>
              Заголовок
              <input v-model="selected.title" maxlength="120">
            </label>

            <label>
              Текст
              <textarea
                v-model="selected.text"
                rows="6"
                maxlength="2000"
              />
            </label>

            <button
              :disabled="!connected"
              @click="pick(selected.id)"
            >
              Изменить элемент
            </button>

            <details>
              <summary>Техническая информация</summary>
              <code>{{ selected.selector }}</code>
            </details>
          </template>

          <p v-else>Выбери шаг в списке.</p>

          <label>
            Цвет кнопок
            <input v-model="color" type="color">
          </label>
        </fieldset>

        <small>Черновик сохраняется в этом браузере.</small>

        <h2>События предпросмотра</h2>

        <ul class="events">
          <li v-for="event in events" :key="event.id">
            <time>{{ event.time }}</time>
            {{ event.name }}
          </li>
        </ul>
      </aside>
    </div>
  </main>
</template>

<style>
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #f3f5fa;
  color: #20243a;
  font: 15px/1.5 system-ui, sans-serif;
}
main { max-width: 1700px; margin: auto; padding: 24px; }
header, .toolbar, .actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
header { flex-wrap: wrap; }
header > div { flex: 1; }
h1 { margin: 4px 0 12px; font-size: 26px; }
h2 { font-size: 17px; }
small { color: #626b80; }
.status {
  padding: 12px 16px;
  background: #e9edff;
  border-radius: 10px;
}
button, input, textarea { font: inherit; }
button {
  border: 1px solid #d4d9e7;
  border-radius: 8px;
  background: white;
  padding: 8px 12px;
  cursor: pointer;
}
button:hover:not(:disabled), .active {
  border-color: #4f46e5;
  background: #eef0ff;
}
button:disabled { opacity: .45; cursor: default; }
button:focus-visible, input:focus-visible, textarea:focus-visible {
  outline: 3px solid #a5b4fc;
}
.workspace {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr) 280px;
  gap: 16px;
}
aside, .preview {
  background: white;
  border: 1px solid #e0e4ed;
  border-radius: 12px;
  padding: 16px;
  min-width: 0;
}
ol { padding: 0; list-style: none; }
ol li { margin-top: 14px; }
ol li > button { width: 100%; text-align: left; }
.actions { margin-top: 6px; }
.actions button { padding: 3px 9px; }
.toolbar { flex-wrap: wrap; margin-bottom: 12px; }
.toolbar a { margin-right: auto; color: #4338ca; }
.frame-area {
  overflow: auto;
  background: #edf0f6;
  padding: 10px;
}
iframe {
  display: block;
  width: 100%;
  height: 650px;
  margin: auto;
  border: 1px solid #d4d9e7;
  background: white;
}
iframe.mobile { width: 390px; }
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
label { display: block; margin: 12px 0; }
input:not([type=color]), textarea {
  width: 100%;
  padding: 9px;
  border: 1px solid #d4d9e7;
  border-radius: 7px;
}
textarea { resize: vertical; }
input[type=color] { display: block; }
details { margin: 16px 0; }
code { overflow-wrap: anywhere; }
.events {
  padding: 0;
  list-style: none;
  font: 12px/1.7 ui-monospace, monospace;
  overflow-wrap: anywhere;
}
time { color: #737b91; }
@media (max-width: 1100px) {
  .workspace { grid-template-columns: 210px minmax(0, 1fr); }
  .workspace > aside:last-child { grid-column: 1 / -1; }
}
@media (max-width: 700px) {
  main { padding: 12px; }
  .workspace { display: flex; flex-direction: column; }
}
</style>
