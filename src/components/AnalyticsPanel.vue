<script setup>
import { ref } from 'vue'
defineProps({ sites: Array })
const period = ref(7), selectedSite = ref('all'), selectedTour = ref('all')
</script>

<template>
  <section class="page-view analytics-view">
    <div class="view-filters"><label class="visually-hidden" for="analytics-period">Период</label><select id="analytics-period" v-model.number="period"><option :value="7">Период: 7 дней</option><option :value="30">Период: 30 дней</option></select><label class="visually-hidden" for="analytics-site">Сайт</label><select id="analytics-site" v-model="selectedSite"><option value="all">Сайт: все</option><option v-for="site in sites" :key="site.id" :value="site.id">{{ site.name }}</option></select><label class="visually-hidden" for="analytics-tour">Тур</label><select id="analytics-tour" v-model="selectedTour"><option value="all">Тур: все</option></select></div>
    <div class="metrics-grid"><article v-for="label in ['Запуски', 'Скипы', 'Дошли до конца']" :key="label" class="panel metric"><span>{{ label }}</span><strong class="metric-empty">—</strong></article></div>
    <div class="analytics-charts"><section class="panel runs-chart"><h2>Запуски по дням</h2><div class="chart-empty"><h3>Данных пока нет</h3><p>Сбор статистики прохождения пока не подключён.</p></div></section><section class="panel funnel-chart"><h2>Воронка по шагам</h2><div class="chart-empty"><p>Нет данных</p></div></section></div>
    <section class="panel analytics-tours"><h2>Туры</h2><div class="chart-empty"><p>Данные о прохождении туров появятся после подключения статистики.</p></div></section>
  </section>
</template>
