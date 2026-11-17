import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { widgetScriptTag } from './src/widgetInstallation.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000'
  if (!!env.VITE_WIDGET_SITE_ID !== !!env.VITE_WIDGET_CONFIG_URL) throw new Error('Для виджета задайте вместе VITE_WIDGET_SITE_ID и VITE_WIDGET_CONFIG_URL.')
  return {
    plugins: [vue(), {
      name: 'demo-widget-config',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const path = (req.url || '').split('?')[0]
          if (!path.startsWith('/demo/')) return next()
          const name = path.slice('/demo/'.length) || 'index.html'
          if (!['index.html', 'courses.html', 'course.html', 'signup.html', 'style.css', 'onboarding.json'].includes(name)) return next()
          try {
            let body = await readFile(resolve(process.cwd(), 'demo-source', name), 'utf8')
            if (name.endsWith('.html')) body = body.replace(/<script\b[^>]*data-site-id="demo-school"[^>]*><\/script>/, widgetScriptTag({ src: '/widget.js', editorOrigin: 'self', siteId: env.VITE_WIDGET_SITE_ID || 'demo-school', configUrl: env.VITE_WIDGET_CONFIG_URL || './onboarding.json' }))
            res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/json; charset=utf-8')
            res.end(body)
          } catch (error) { next(error) }
        })
      },
      transformIndexHtml(html) {
        if (!env.VITE_WIDGET_SITE_ID || !html.includes('data-site-id="demo-school"')) return html
        return html.replace(/<script\b[^>]*data-site-id="demo-school"[^>]*><\/script>/, script => widgetScriptTag({
          src: /\bsrc="([^"]+)"/.exec(script)?.[1] || '/widget.js',
          editorOrigin: /\bdata-editor-origin="([^"]+)"/.exec(script)?.[1] || 'self',
          siteId: env.VITE_WIDGET_SITE_ID, configUrl: env.VITE_WIDGET_CONFIG_URL,
        }))
      },
    }],
    base: env.VITE_BASE_PATH || '/',
    server: {
      proxy: {
        '/api/v1': { target, changeOrigin: true },
        '/testconnect/': { target, changeOrigin: true },
      },
    },
  }
})
