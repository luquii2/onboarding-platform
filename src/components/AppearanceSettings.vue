<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { DEFAULT_THEME, normalizeTheme } from '../theme.js'
const props = defineProps({ api: Object, sites: Array, selectedSiteId: String })
const emit = defineEmits(['site-change'])
const selectedId = ref(''), theme = ref({ ...DEFAULT_THEME }), baseline = ref(JSON.stringify(DEFAULT_THEME)), loading = ref(false), saving = ref(false), error = ref(''), notice = ref(''), device = ref('desktop')
const placements = [{ value: 'top', label: 'Сверху' }, { value: 'bottom', label: 'Снизу' }, { value: 'left', label: 'Слева' }, { value: 'right', label: 'Справа' }]
const dirty = computed(() => JSON.stringify(theme.value) !== baseline.value)
const loaded = ref(false)
const previewStyle = computed(() => ({ '--tip-primary': theme.value.primaryColor, '--tip-text': theme.value.textColor, '--tip-muted': theme.value.textColor.toLowerCase() === '#0f172a' ? '#64748b' : theme.value.textColor, '--tip-bg': theme.value.backgroundColor, '--tip-radius': theme.value.borderRadius + 'px', fontFamily: theme.value.fontFamily }))
let ticket = 0, disposed = false
watch(() => [props.sites, props.selectedSiteId], () => { selectedId.value = props.sites?.find(site => site.id === props.selectedSiteId)?.id || props.sites?.find(site => site.id === selectedId.value)?.id || props.sites?.[0]?.id || '' }, { immediate: true })
async function loadTheme() {
  const id = selectedId.value
  const current = ++ticket; notice.value = ''; error.value = ''
  loaded.value = false
  if (!id) return
  emit('site-change', id)
  loading.value = true
  try { const value = await props.api.theme(id); if (current === ticket && !disposed) { theme.value = normalizeTheme(value); baseline.value = JSON.stringify(theme.value); loaded.value = true } }
  catch (failure) { if (current === ticket && !disposed) error.value = failure.message }
  finally { if (current === ticket && !disposed) loading.value = false }
}
watch(selectedId, loadTheme, { immediate: true })
function chooseSite(event) {
  if (dirty.value && !confirm('Перейти к другому сайту без сохранения оформления?')) { event.target.value = selectedId.value; return }
  selectedId.value = event.target.value
}
async function save() {
  if (!selectedId.value || !loaded.value || loading.value || saving.value) return
  if (['primaryColor', 'textColor', 'backgroundColor'].some(key => !/^#[0-9a-f]{6}$/i.test(theme.value[key]))) { error.value = 'Укажите цвет в формате #RRGGBB, например #4F46E5.'; return }
  const current = ++ticket, id = selectedId.value
  saving.value = true; error.value = ''; notice.value = ''
  try { const value = await props.api.saveTheme(id, normalizeTheme(theme.value)); if (current !== ticket || disposed) return; theme.value = normalizeTheme(value); baseline.value = JSON.stringify(theme.value); notice.value = 'Оформление сохранено. Оно применяется при следующей загрузке виджета.' }
  catch (failure) { if (current === ticket && !disposed) error.value = failure.message }
  finally { if (!disposed) saving.value = false }
}
function mayLeave() { return !dirty.value || confirm('Выйти без сохранения оформления?') }
defineExpose({ save, mayLeave })
onBeforeUnmount(() => { disposed = true; ticket++ })
</script>

<template>
  <section class="page-view appearance-view">
    <div class="view-filters"><label class="visually-hidden" for="theme-site">Сайт для оформления</label><select id="theme-site" :value="selectedId" :disabled="saving" @change="chooseSite"><option disabled value="">Выберите сайт</option><option v-for="site in sites" :key="site.id" :value="site.id">{{ site.name }}</option></select><button class="button primary" :disabled="!selectedId || !loaded || loading || saving || !dirty" @click="save">{{ saving ? 'Сохраняем…' : 'Сохранить' }}</button></div>
    <p v-if="error" class="form-error" role="alert">{{ error }} <button v-if="!loaded && !loading" class="text-button" @click="loadTheme()">Повторить загрузку</button></p><p v-if="notice" class="form-success" role="status">{{ notice }}</p>
    <p v-if="loading" class="loading-state" role="status">Загружаем оформление…</p>
    <div v-else-if="selectedId" class="appearance-grid">
      <form class="panel appearance-form" @submit.prevent="save">
        <fieldset :disabled="saving || !loaded"><legend>Цвета</legend><label v-for="item in [{ key: 'primaryColor', label: 'Основной цвет' }, { key: 'textColor', label: 'Цвет текста' }, { key: 'backgroundColor', label: 'Фон подсказки' }]" :key="item.key" class="theme-color-field"><span>{{ item.label }}</span><div><input v-model="theme[item.key]" type="color" :aria-label="item.label"><input v-model="theme[item.key]" type="text" :aria-label="item.label + ' HEX'" pattern="#[0-9a-fA-F]{6}" maxlength="7" required></div></label></fieldset>
        <label class="field theme-field">Шрифт<select v-model="theme.fontFamily" :disabled="saving"><option>Inter</option><option>Arial</option><option>Georgia</option><option value="system-ui">Системный</option></select></label>
        <label class="field theme-field">Скругление углов<div class="radius-control"><input v-model.number="theme.borderRadius" type="range" min="0" max="32" :disabled="saving"><output>{{ theme.borderRadius }} px</output></div></label>
        <fieldset class="placement-field" :disabled="saving"><legend>Положение подсказки</legend><div class="segmented"><button v-for="item in placements" :key="item.value" type="button" :aria-pressed="theme.defaultPlacement === item.value" @click="theme.defaultPlacement = item.value">{{ item.label }}</button></div></fieldset>
        <label class="switch-field">Показывать счётчик шагов<input v-model="theme.showProgress" class="switch-input" type="checkbox" :disabled="saving"></label>
        <label class="switch-field">Показывать кнопку «Пропустить»<input v-model="theme.showSkip" class="switch-input" type="checkbox" :disabled="saving"></label>
      </form>
      <section class="panel theme-preview-panel" aria-label="Предпросмотр оформления"><div class="panel-title"><h2>Предпросмотр</h2><div class="segmented"><button :aria-pressed="device === 'desktop'" @click="device = 'desktop'">ПК</button><button :aria-pressed="device === 'mobile'" @click="device = 'mobile'">Телефон</button></div></div><div class="theme-demo" :class="{ 'is-mobile': device === 'mobile' }" :style="previewStyle"><div class="demo-block demo-header">Шапка сайта</div><div class="demo-block demo-banner">Баннер</div><div class="theme-target">Кнопка</div><article class="theme-tooltip" :class="'placement-' + theme.defaultPlacement"><h3>Заголовок шага</h3><p>Текст подсказки, который увидит пользователь.</p><small v-if="theme.showProgress">Шаг 2 из 5</small><nav><span v-if="theme.showSkip">Пропустить</span><button disabled>Назад</button><button class="theme-next" disabled>Далее</button></nav></article></div></section>
    </div>
    <div v-else class="empty-page"><h2>Сначала добавьте сайт</h2><p>У каждого сайта свои настройки оформления подсказок.</p></div>
  </section>
</template>
