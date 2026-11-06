import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function hostedConfig(value) {
  if (!value) throw new Error('Укажите VITE_DEMO_SITE_URL для опубликованного демосайта.')
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/demo/')) {
    throw new Error('Адрес демосайта должен оканчиваться на /demo/ без параметров.')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Для публикации нужен HTTPS.')
  }
  const appBase = new URL('../', url)
  return { demoUrl: url.href, editorOrigin: appBase.origin, widgetUrl: new URL('widget.js', appBase).href }
}

export function injectWidget(html, config) {
  // Комментарии обрабатываются целиком: содержащиеся в них примеры script не являются подключениями.
  const token = /<!--[\s\S]*?-->|<script\b(?:"[^"]*"|'[^']*'|[^'">])*?>[\s\S]*?<\/script\s*>/gi
  const cleaned = html.replace(token, value => {
    if (value.startsWith('<!--')) return value.includes('onboarding-hosted-widget') ? '' : value
    if (!/\bdata-editor-origin\s*=/.test(value)) return value
    const source = /\bsrc\s*=\s*(["'])(.*?)\1/i.exec(value)?.[2]
    if (!source) return value
    try {
      const name = new URL(source, config.widgetUrl).pathname.split('/').pop()
      return ['widget.js', 'onboarding-widget.js'].includes(name) ? '' : value
    } catch { return value }
  })
  if (!/<\/body\s*>/i.test(cleaned)) throw new Error('В странице не найдена закрывающая часть body.')
  const script = '\n<!-- onboarding-hosted-widget -->\n<script src="' + config.widgetUrl + '" data-editor-origin="' + config.editorOrigin + '" data-site-id="demo-school" data-config-url="' + new URL('onboarding.json', config.demoUrl).href + '" defer></script>\n'
  return cleaned.replace(/<\/body\s*>/i, script + '</body>')
}

export async function buildHostedDemo(root, value) {
  const config = hostedConfig(value)
  const source = join(root, 'demo-source'), output = join(root, 'dist/demo')
  await mkdir(output, { recursive: true })
  for (const name of ['index.html', 'courses.html', 'course.html', 'signup.html']) {
    const html = await readFile(join(source, name), 'utf8')
    await writeFile(join(output, name), injectWidget(html, config))
  }
  await copyFile(join(source, 'style.css'), join(output, 'style.css'))
  await copyFile(join(source, 'onboarding.json'), join(output, 'onboarding.json'))
  console.log('Демосайт добавлен в dist/demo. Origin редактора: ' + config.editorOrigin)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  await buildHostedDemo(root, process.env.VITE_DEMO_SITE_URL)
}
