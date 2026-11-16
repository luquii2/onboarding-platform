<script setup>
import { ref } from 'vue'
const emit = defineEmits(['analytics'])
const copied = ref(false), error = ref('')
const asset = name => import.meta.env.BASE_URL + 'design/' + name
async function copyLink() {
  try { await navigator.clipboard.writeText(location.href); copied.value = true; error.value = '' }
  catch { error.value = 'Скопируйте адрес этой страницы из строки браузера.' }
}
</script>
<template>
  <section class="mobile-editor-notice">
    <div class="desktop-graphic" aria-hidden="true"><img :src="asset('desktop-screen.svg')" alt=""><img :src="asset('desktop-fill.svg')" alt=""><img :src="asset('desktop-stand.svg')" alt=""><img :src="asset('desktop-foot.svg')" alt=""></div>
    <h2>Откройте на компьютере</h2><p>Конструктор туров удобнее на большом экране. Скопируйте ссылку и откройте кабинет на компьютере.</p>
    <button class="button primary full-width" @click="copyLink">{{ copied ? 'Ссылка скопирована' : 'Скопировать ссылку' }}</button><button class="button full-width" @click="emit('analytics')">Перейти к аналитике</button><p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
