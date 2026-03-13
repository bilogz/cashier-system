<template>
  <div class="logo-main">
    <RouterLink to="/dashboard/default" class="logo-main-link">
      <img :src="bcpOlpLogo" alt="Bestlink College of the Philippines Cashier System" class="logo-main-icon" />
      <div class="logo-main-copy">
        <div class="logo-main-title">Bestlink College</div>
        <div class="logo-main-title">of the Philippines</div>
      </div>
    </RouterLink>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router';
import bcpOlpLogo from '@/assets/images/logos/bcp-olp-logo-mini2.png';
</script>

<style scoped>
.logo-main {
  display: flex;
  align-items: center;
}

.logo-main-link {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
}

.logo-main-icon {
  width: 48px;
  height: 48px;
  display: block;
  object-fit: contain;
  flex-shrink: 0;
}

.logo-main-copy {
  display: grid;
  gap: 1px;
  color: #fff;
  line-height: 1.1;
}

.logo-main-title {
  font-size: 17px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
</style>
