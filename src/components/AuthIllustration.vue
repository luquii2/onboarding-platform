<script setup>
const asset = name => import.meta.env.BASE_URL + 'design/' + name
</script>

<template>
  <div class="auth-illustration" aria-hidden="true">
    <img class="auth-demo-target" :src="asset('auth-target.svg')" alt=""><span class="auth-demo-target-label">Кнопка</span>
    <img class="auth-demo-arrow" :src="asset('auth-pointer.svg')" alt="">
    <img class="auth-demo-surface" :src="asset('auth-tooltip.svg')" alt="">
    <strong>Нажмите здесь</strong><p>Так выглядит подсказка на вашем сайте.</p><small>Шаг 1 из 3</small>
    <span class="auth-demo-next">Далее</span>
  </div>
</template>
