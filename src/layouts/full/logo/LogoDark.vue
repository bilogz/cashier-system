<template>
  <div class="logo">
    <RouterLink to="/dashboard/default" class="logo-link">
      <img :src="bcpOlpLogo" alt="Bestlink College of the Philippines Cashier System" class="logo-image" />
      <div class="logo-copy">
        <div class="logo-title">Bestlink College</div>
        <div class="logo-title">of the Philippines</div>
      </div>
    </RouterLink>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router';
import bcpOlpLogo from '@/assets/images/logos/bcp-olp-logo-mini2.png';
</script>

<style scoped>
.logo-link {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  max-width: 100%;
  text-decoration: none;
}

.logo-image {
  width: 48px;
  height: 48px;
  display: block;
  object-fit: contain;
  flex-shrink: 0;
}

.logo-copy {
  display: grid;
  gap: 1px;
  color: #fff;
  line-height: 1.1;
}

.logo-title {
  font-size: 17px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
</style>
