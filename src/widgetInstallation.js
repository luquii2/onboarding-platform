export function widgetApiUrl(configUrl) {
  const value = String(configUrl || '').trim()
  const match = /^(.*)\/public\/sites\/[^/?#]+\/config\/?(?:\?[^#]*)?(?:#.*)?$/.exec(value)
  if (!match) return ''
  const url = new URL(value, 'http://localhost/')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Проверьте адрес конфигурации виджета.')
  return match[1].replace(/\/+$/, '') || '/'
}

export function widgetScriptTag({ src, siteId, configUrl, editorOrigin, apiUrl = widgetApiUrl(configUrl) }) {
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const attributes = { src, 'data-site-id': siteId, 'data-config-url': configUrl, 'data-editor-origin': editorOrigin }
  if (apiUrl) attributes['data-api-url'] = apiUrl
  return '<script ' + Object.entries(attributes).map(([name, value]) => name + '="' + escape(value) + '"').join(' ') + ' defer></script>'
}
