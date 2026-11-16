<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { createScenario, exportProject, isDraft, readProject, runtimeSignature } from '../model.js'
const props = defineProps({ api: Object, sites: Array, selectedSiteId: String })
const emit = defineEmits(['edit', 'site-change'])
const selectedId = ref(''), document = ref(null), publication = ref(null), loading = ref(false), busy = ref(false), error = ref(''), notice = ref(''), filter = ref('all'), candidate = ref(null), deleteDialog = ref(null)
const site = computed(() => props.sites?.find(item => item.id === selectedId.value))
const tours = computed(() => (document.value?.project.scenarios || []).filter(item => item.steps.length || item.name !== 'Основной сценарий'))
const visibleTours = computed(() => tours.value.filter(item => filter.value === 'all' || (filter.value === 'published' ? status(item) === 'Опубликован' : status(item) !== 'Опубликован')))
const canCreate = computed(() => !loading.value && !busy.value && !!document.value)
let request = 0, disposed = false
watch(() => [props.sites, props.selectedSiteId], () => { selectedId.value = props.sites?.find(item => item.id === props.selectedSiteId)?.id || props.sites?.find(item => item.id === selectedId.value)?.id || props.sites?.[0]?.id || '' }, { immediate: true })
async function load() {
  const id = selectedId.value, ticket = ++request
  document.value = null; publication.value = null; error.value = ''; notice.value = ''
  if (!id) return
  emit('site-change', id)
  loading.value = true
  try {
    const [saved, published] = await Promise.all([props.api.loadProject(id), props.api.publicConfig(id).catch(failure => { if (failure.status === 404) return null; throw failure })])
    if (ticket !== request || disposed) return
    document.value = { ...saved, project: readProject(saved.project, site.value.baseUrl) }; publication.value = published
  } catch (failure) { if (ticket === request && !disposed) error.value = failure.message }
  finally { if (ticket === request && !disposed) loading.value = false }
}
watch(selectedId, load, { immediate: true })
function status(tour) {
  if (!tour.enabled) return 'Отключён'
  if (tour.steps.some(isDraft)) return 'Требует проверки'
  const published = publication.value?.scenarios.find(item => item.id === tour.id)
  if (!published) return 'Черновик'
  try { return runtimeSignature({ scenarios: [published] }, site.value.baseUrl) === runtimeSignature(exportProject({ ...document.value.project, scenarios: [tour] }, site.value.baseUrl), site.value.baseUrl) ? 'Опубликован' : 'Есть изменения' } catch { return 'Черновик' }
}
function date(value) { return value ? new Intl.DateTimeFormat('ru', { dateStyle: 'short' }).format(new Date(value)) : '—' }
async function commit(project) {
  const current = document.value
  const response = await props.api.saveProject(selectedId.value, { baseRevision: current.revision, project })
  if (disposed || current !== document.value) throw new Error('Сайт изменился. Обновите список туров.')
  document.value = { ...response, project: readProject(response.project, site.value.baseUrl) }
  return response
}
async function applyPublication(project, revision) {
  const enabled = project.scenarios.filter(item => item.enabled)
  const result = enabled.length ? await props.api.publish(selectedId.value, revision, crypto.randomUUID()) : await props.api.unpublish(selectedId.value)
  const config = await props.api.publicConfig(selectedId.value, result.version)
  const expected = enabled.length ? exportProject(project, site.value.baseUrl) : { scenarios: [] }
  if (config.siteId !== selectedId.value || runtimeSignature(config, site.value.baseUrl) !== runtimeSignature(expected, site.value.baseUrl)) throw new Error('Сервер не подтвердил изменение опубликованных туров. Откройте конструктор и повторите публикацию.')
  publication.value = config
}
async function createTour() {
  if (busy.value || loading.value || !document.value) return
  if (document.value.project.scenarios.length >= 20) { error.value = 'На одном сайте можно создать до 20 сценариев.'; return }
  const project = JSON.parse(JSON.stringify(document.value.project))
  let tour = project.scenarios.find(item => item.name === 'Основной сценарий' && !item.steps.length)
  if (tour) tour.name = 'Новый тур'
  else { tour = createScenario('Новый тур'); project.scenarios.push(tour) }
  project.activeScenarioId = tour.id
  busy.value = true; error.value = ''
  try { await commit(project); if (!disposed) emit('edit', selectedId.value, tour.id) }
  catch (failure) { if (!disposed) error.value = failure.message }
  finally { if (!disposed) busy.value = false }
}
async function toggle(tour) {
  if (busy.value) return
  const project = JSON.parse(JSON.stringify(document.value.project)), changed = project.scenarios.find(item => item.id === tour.id)
  changed.enabled = !tour.enabled
  const published = publication.value?.scenarios.some(item => item.id === tour.id)
  busy.value = true; error.value = ''; notice.value = ''
  try {
    if (published && project.scenarios.some(item => item.enabled)) exportProject(project, site.value.baseUrl)
    const result = await commit(project)
    if (published) await applyPublication(project, result.revision)
    notice.value = published ? 'Показ тура на сайте обновлён.' : 'Изменения сохранены в черновике. Опубликуйте тур в конструкторе, чтобы применить их на сайте.'
  } catch (failure) { if (!disposed) error.value = failure.message }
  finally { if (!disposed) busy.value = false }
}
async function askDelete(tour) { candidate.value = tour; await nextTick(); deleteDialog.value.showModal() }
async function remove() {
  if (busy.value || !candidate.value) return
  const id = candidate.value.id, project = JSON.parse(JSON.stringify(document.value.project))
  project.scenarios = project.scenarios.filter(item => item.id !== id); project.activeScenarioId = project.scenarios[0]?.id || ''
  const published = publication.value?.scenarios.some(item => item.id === id)
  busy.value = true; error.value = ''; notice.value = ''
  try {
    if (published && project.scenarios.some(item => item.enabled)) exportProject(project, site.value.baseUrl)
    const result = await commit(project)
    if (published) await applyPublication(project, result.revision)
    notice.value = 'Тур удалён.'; deleteDialog.value.close(); candidate.value = null
  } catch (failure) { if (!disposed) error.value = failure.message }
  finally { if (!disposed) busy.value = false }
}
defineExpose({ createTour, refresh: load, canCreate })
onBeforeUnmount(() => { disposed = true; request++ })
</script>

<template>
  <section class="page-view tours-view">
    <div class="view-filters"><label class="visually-hidden" for="tour-site">Сайт</label><select id="tour-site" v-model="selectedId" :disabled="busy"><option disabled value="">Выберите сайт</option><option v-for="item in sites" :key="item.id" :value="item.id">Сайт: {{ item.name }}</option></select><div class="filter-tabs" role="group" aria-label="Статус тура"><button v-for="item in [{ id: 'all', label: 'Все' }, { id: 'published', label: 'Опубликованные' }, { id: 'drafts', label: 'Черновики' }]" :key="item.id" :aria-pressed="filter === item.id" @click="filter = item.id">{{ item.label }}</button></div></div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p><p v-if="notice" class="form-success" role="status">{{ notice }}</p>
    <p v-if="loading" class="loading-state" role="status">Загружаем туры…</p>
    <div v-else-if="visibleTours.length" class="panel tour-table-wrap"><table class="tour-table"><thead><tr><th>Название</th><th>Статус</th><th>Шагов</th><th>Обновлён</th><th>Включён</th><th><span class="visually-hidden">Действия</span></th></tr></thead><tbody><tr v-for="tour in visibleTours" :key="tour.id"><td><button class="tour-name" @click="emit('edit', selectedId, tour.id)">{{ tour.name }}</button><small v-if="status(tour) === 'Требует проверки'" class="tour-warning">⚠ Выберите элементы для всех шагов</small></td><td><span class="status-badge" :class="{ success: status(tour) === 'Опубликован', warning: status(tour) === 'Требует проверки', neutral: !['Опубликован', 'Требует проверки'].includes(status(tour)) }">{{ status(tour) }}</span></td><td>{{ tour.steps.length }}</td><td>{{ date(document.updatedAt) }}</td><td><input class="switch-input" type="checkbox" :aria-label="'Включить тур «' + tour.name + '»'" :checked="tour.enabled" :disabled="busy" @change="toggle(tour)"></td><td class="tour-row-actions"><button class="button small" :disabled="busy" @click="emit('edit', selectedId, tour.id)">Изменить</button><details class="row-menu"><summary aria-label="Действия с туром">⋮</summary><button :disabled="busy" @click="askDelete(tour)">Удалить тур</button></details></td></tr></tbody></table></div>
    <div v-else class="empty-page"><h2>{{ selectedId ? filter === 'all' ? 'Создайте первый тур' : 'Туры не найдены' : 'Сначала добавьте сайт' }}</h2><p>{{ selectedId ? 'Покажите посетителям, как пользоваться вашим сайтом.' : 'После подключения сайта можно создавать интерактивное обучение.' }}</p><button v-if="selectedId && filter === 'all'" class="button primary" :disabled="busy || !document" @click="createTour">+ Создать тур</button></div>
    <dialog ref="deleteDialog" class="platform-dialog" aria-labelledby="delete-tour-title" @cancel="busy && $event.preventDefault()"><h2 id="delete-tour-title">Удалить тур?</h2><p>Тур «{{ candidate?.name }}» и все его шаги будут удалены. Это действие нельзя отменить.</p><p v-if="error" class="form-error" role="alert">{{ error }}</p><div class="dialog-actions"><button class="button" :disabled="busy" @click="deleteDialog.close()">Отмена</button><button class="button danger-button" :disabled="busy" @click="remove">{{ busy ? 'Удаляем…' : 'Удалить' }}</button></div></dialog>
  </section>
</template>
