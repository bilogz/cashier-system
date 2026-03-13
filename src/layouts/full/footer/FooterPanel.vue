<script setup lang="ts">
import { shallowRef } from 'vue';
import { RouterLink } from 'vue-router';

const footerLink = shallowRef([
  {
    title: 'Home',
    url: '/'
  },
  {
    title: 'Documentation',
    url: '#!'
  },
  {
    title: 'Support',
    url: '#!'
  }
]);
</script>
<template>
  <v-footer class="px-0 footer mt-2">
    <v-row justify="center" align="center" no-gutters>
      <v-col cols="12" sm="6">
        <p class="text-body-1 mb-0 text-sm-left text-center">
          Berry ♥ crafted by Team
          <a href="https://themeforest.net/user/codedthemes" class="text-darkText text-decoration-none" target="_blank">Codedthemes |</a>
          <span class="text-body-1 mb-0 text-sm-left text-center">
            distributed by
            <a href="https://themewagon.com/" class="text-darkText text-decoration-none" target="_blank">ThemeWagon</a>
          </span>
        </p>
      </v-col>
      <v-col class="text-sm-right text-center" cols="12" sm="6">
        <RouterLink
          v-for="(item, i) in footerLink"
          :key="i"
          class="mx-2 text-body-1 text-darkText text-decoration-none cursor-pointer"
          :to="item.url"
        >
          {{ item.title }}
        </RouterLink>
      </v-col>
    </v-row>
  </v-footer>
</template>

<style lang="scss">
.v-footer {
  position: unset;
}
footer {
  a {
    &:hover {
      color: rgb(var(--v-theme-primary)) !important;
    }
  }
}
</style>
