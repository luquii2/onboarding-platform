import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000'
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
  if (!!env.VITE_WIDGET_SITE_ID !== !!env.VITE_WIDGET_CONFIG_URL) throw new Error('Для виджета задайте вместе VITE_WIDGET_SITE_ID и VITE_WIDGET_CONFIG_URL.')
  return {
    plugins: [vue(), {
      name: 'demo-widget-config',
      transformIndexHtml(html) {
        if (!env.VITE_WIDGET_SITE_ID || !html.includes('data-site-id="demo-school"')) return html
        return html.replace('data-site-id="demo-school"', 'data-site-id="' + escape(env.VITE_WIDGET_SITE_ID) + '"')
          .replace('data-config-url="./onboarding.json"', 'data-config-url="' + escape(env.VITE_WIDGET_CONFIG_URL) + '"')
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
