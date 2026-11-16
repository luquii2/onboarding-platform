<script setup>
defineProps({ active: String, open: Boolean, accountName: String })
const emit = defineEmits(['navigate', 'close', 'connection', 'logout', 'logout-all'])
const items = [
  { id: 'sites', label: 'Сайты', path: '/sites' },
  { id: 'tours', label: 'Туры', path: '/tours' },
  { id: 'analytics', label: 'Аналитика', path: '/analytics' },
  { id: 'appearance', label: 'Настройка вида', path: '/appearance' },
]
</script>

<template>
  <button v-if="open" class="sidebar-backdrop" aria-label="Закрыть меню" @click="emit('close')" />
  <aside class="sidebar" :class="{ 'is-open': open }" aria-label="Главная навигация" @keydown.esc="emit('close')">
    <a class="sidebar-brand" href="#/sites" @click.prevent="emit('navigate', '/sites')">Онбординг</a>
    <button class="sidebar-close" aria-label="Закрыть меню" @click="emit('close')">×</button>
    <nav><a v-for="item in items" :key="item.id" :href="'#' + item.path" :class="{ active: active === item.id }" :aria-current="active === item.id ? 'page' : undefined" @click.prevent="emit('navigate', item.path)">{{ item.label }}</a></nav>
    <div class="sidebar-footer">
      <span v-if="accountName" class="sidebar-account account-name">{{ accountName }}</span>
      <button @click="emit('connection')">Подключение API</button>
      <button @click="emit('logout')">Выйти из аккаунта</button>
      <button v-if="accountName" @click="emit('logout-all')">Выйти на всех устройствах</button>
    </div>
  </aside>
</template>
