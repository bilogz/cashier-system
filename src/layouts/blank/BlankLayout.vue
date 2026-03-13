// ===============================|| Blank Layout ||=============================== //
<template>
  <v-app>
    <RouterView v-slot="{ Component, route }">
      <transition name="route-smooth" mode="out-in">
        <component :is="Component" :key="route.fullPath" />
      </transition>
    </RouterView>
  </v-app>
</template>
<script setup lang="ts">
import { RouterView } from 'vue-router';
</script>

<style>
.route-smooth-enter-active,
.route-smooth-leave-active {
  transition: opacity 260ms ease, transform 260ms ease;
}

.route-smooth-enter-from,
.route-smooth-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
