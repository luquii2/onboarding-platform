# Публикация на GitHub Pages

Workflow `.github/workflows/pages.yml` собирает Vue-конструктор и тестовый сайт,
затем публикует их на GitHub Pages.

## Настройка и запуск

В Settings → Pages выберите Source → GitHub Actions.
Публикация запускается при push в `main` или `fix/responsive-editor-flow`.
Для ручного запуска откройте Actions → Deploy demo → Run workflow
и выберите нужную ветку.

Адрес конструктора: https://luquii2.github.io/onboarding-platform/.
Адрес тестового сайта: https://luquii2.github.io/onboarding-platform/demo/.
Результат публикации доступен в шаге Deploy и в Settings → Pages.

## Локальная проверка сборки

```sh
npm ci
VITE_BASE_PATH=/onboarding-platform/ VITE_DEMO_SITE_URL=https://luquii2.github.io/onboarding-platform/demo/ npm run build
VITE_DEMO_SITE_URL=https://luquii2.github.io/onboarding-platform/demo/ node tools/build-hosted-demo.mjs
```

Готовая сборка находится в `dist/`. Скрипт `tools/build-hosted-demo.mjs`
копирует страницы из `demo-source/` в `dist/demo/` и подключает `widget.js`
с адресом опубликованного конструктора.

Тестовые страницы взяты из репозитория `kiralizanchuk/onboarding-test-site`.
При изменении исходного демосайта обновляйте копию в `demo-source/`.

## Проверка демоверсии

Откройте конструктор и проверьте статус «Сайт подключен», выбор цели шага,
настройку мобильной версии и прохождение тура на разных страницах.

Туры сохраняются в localStorage текущего браузера.
У других посетителей собственный черновик; общая серверная синхронизация пока отсутствует.
