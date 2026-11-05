<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  url: { type: String, required: true },
  width: { type: Number, required: true },
  height: { type: Number, default: 740 },
  validator: { type: Boolean, default: false },
  identity: { type: String, default: '' },
})
const emit = defineEmits(['ready', 'message', 'disconnected', 'loading'])
const CHANNEL = 'onboarding-prototype/v3'
const container = ref(null), frame = ref(null), availableWidth = ref(0), connected = ref(false)
const scale = computed(() => props.validator ? 1 : Math.min(1, (availableWidth.value || props.width) / props.width))
const viewportStyle = computed(() => ({ width: props.width + 'px', height: props.height + 'px', transform: 'scale(' + scale.value + ')' }))
const stageStyle = computed(() => ({ width: (props.width * scale.value) + 'px', height: (props.height * scale.value) + 'px' }))
let session = '', handshakeTimer, observer, disposed = false
const pending = new Map()

function send(type, payload = {}, id = crypto.randomUUID()) {
  frame.value?.contentWindow?.postMessage({ channel: CHANNEL, session, id, type, payload: JSON.parse(JSON.stringify(payload)) }, new URL(props.url).origin)
  return id
}

function rejectPending(message) {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(message)) }
  pending.clear()
}

function handshake() {
  if (disposed) return
  connected.value = false
  emit('loading')
  rejectPending('Страница изменилась. Дождитесь подключения.')
  clearTimeout(handshakeTimer)
  session = crypto.randomUUID()
  send('hello', { validator: props.validator })
  handshakeTimer = setTimeout(() => emit('disconnected', { identity: props.identity, message: 'На этой странице нет ответа виджета. Проверьте его подключение.' }), 6000)
}

function receive(event) {
  if (event.source !== frame.value?.contentWindow || event.origin !== new URL(props.url).origin) return
  const data = event.data
  if (!session || !data || data.channel !== CHANNEL || data.session !== session) return
  if (data.type === 'ready') {
    if (typeof data.payload?.url !== 'string') return
    clearTimeout(handshakeTimer)
    connected.value = true
    emit('ready', { ...data.payload, identity: props.identity })
  } else if (data.type === 'response' && typeof data.id === 'string') {
    const item = pending.get(data.id)
    if (!item) return
    clearTimeout(item.timer)
    pending.delete(data.id)
    if (data.error) item.reject(new Error(String(data.error).slice(0, 300)))
    else item.resolve(data.payload)
  } else if (data.type === 'event' && data.payload && typeof data.payload.name === 'string') emit('message', data.payload)
}

function request(type, payload = {}, timeout = 12000) {
  if (!connected.value) return Promise.reject(new Error('Дождитесь подключения страницы.'))
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Страница не ответила. Повторите действие.')) }, timeout)
    pending.set(id, { resolve, reject, timer })
    send(type, payload, id)
  })
}

onMounted(async () => {
  window.addEventListener('message', receive)
  await nextTick()
  if (disposed || !container.value) return
  observer = new ResizeObserver(entries => { availableWidth.value = entries[0].contentRect.width })
  observer.observe(container.value)
})
watch(() => props.url, () => { connected.value = false })
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(handshakeTimer)
  observer?.disconnect()
  rejectPending('Предпросмотр закрыт.')
  window.removeEventListener('message', receive)
})
defineExpose({ request, connected, handshake })
</script>

<template>
  <div ref="container" class="frame-container" :class="{ 'validator-container': validator }">
    <div class="frame-stage" :style="stageStyle">
      <iframe ref="frame" :src="url" :style="viewportStyle" :tabindex="validator ? -1 : undefined"
        :title="validator ? 'Проверка доступности цели' : 'Демосайт для настройки тура'" @load="handshake" />
    </div>
  </div>
</template>

<style scoped>
.frame-container { width: 100%; min-width: 0; overflow: hidden; }
.frame-stage { position: relative; margin: 0 auto; }
iframe { position: absolute; top: 0; left: 0; display: block; border: 0; background: white; transform-origin: top left; }
.validator-container { width: max-content; }
</style>
