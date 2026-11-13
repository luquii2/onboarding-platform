import { ApiError } from './api.js'

const copy = value => JSON.parse(JSON.stringify(value))
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
  return value
}
const key = value => JSON.stringify(stable(value))

export function createProjectPersistence({ api, siteId, initialDocument, normalize, onState = () => {}, onReplace = () => {}, delay = 1500 }) {
  let revision = initialDocument.revision, updatedAt = initialDocument.updatedAt
  let baseline = normalize(copy(initialDocument.project)), latest = copy(baseline)
  let state = 'saved', error = '', timer, pending = null, disposed = false, reloading = false
  const dirty = () => key(latest) !== key(baseline)
  const emit = () => { if (!disposed) onState({ state, error, revision, updatedAt, dirty: dirty(), busy: !!pending || reloading }) }
  function schedule() {
    clearTimeout(timer)
    if (!disposed && !reloading && dirty() && !['conflict', 'error'].includes(state)) timer = setTimeout(() => save().catch(() => {}), delay)
  }
  function update(project) {
    if (disposed) return
    latest = normalize(copy(project))
    if (!['conflict', 'error', 'saving', 'loading'].includes(state)) state = dirty() ? 'unsaved' : 'saved'
    emit(); schedule()
  }
  async function save() {
    clearTimeout(timer)
    if (disposed) throw new ApiError('Редактор уже закрыт.')
    if (reloading) throw new ApiError('Дождитесь загрузки проекта.')
    if (state === 'conflict') throw new ApiError(error, { code: 'REVISION_CONFLICT' })
    if (pending) { await pending; if (dirty()) return save(); return }
    if (!dirty()) { state = 'saved'; error = ''; emit(); return }
    const snapshot = copy(latest), baseRevision = revision
    state = 'saving'; error = ''
    pending = (async () => {
      try {
        const response = await api.saveProject(siteId, { baseRevision, project: snapshot })
        if (disposed) return
        if (response.revision <= baseRevision) throw new ApiError('Сервер не обновил ревизию проекта.', { code: 'PROJECT_REVISION_INVALID' })
        const normalized = normalize(copy(response.project))
        revision = response.revision; updatedAt = response.updatedAt
        baseline = normalized
        if (key(latest) === key(snapshot)) {
          const changedByServer = key(latest) !== key(normalized)
          latest = copy(normalized)
          if (changedByServer) onReplace(copy(normalized))
        }
        state = dirty() ? 'unsaved' : 'saved'
      } catch (failure) {
        if (!disposed) { state = failure.code === 'REVISION_CONFLICT' || failure.status === 409 ? 'conflict' : 'error'; error = failure.message }
        throw failure
      } finally { pending = null; emit(); schedule() }
    })()
    emit()
    await pending
    if (!disposed && dirty()) return save()
  }
  async function reload() {
    clearTimeout(timer)
    if (pending) { try { await pending } catch { /* The server copy remains available after a failed save. */ } }
    if (disposed) return
    reloading = true; state = 'loading'; error = ''; emit()
    try {
      const response = await api.loadProject(siteId)
      if (disposed) return
      baseline = normalize(copy(response.project)); latest = copy(baseline)
      revision = response.revision; updatedAt = response.updatedAt
      state = 'saved'; onReplace(copy(latest))
    } catch (failure) { if (!disposed) { state = 'error'; error = failure.message }; throw failure }
    finally { reloading = false; emit() }
  }
  function dispose() { clearTimeout(timer); disposed = true }
  emit()
  return { update, save, reload, dispose, isDirty: dirty, snapshot: () => copy(latest) }
}
