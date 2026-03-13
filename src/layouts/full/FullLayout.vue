<script setup lang="ts">
import { RouterView } from 'vue-router';
import VerticalSidebarVue from './vertical-sidebar/VerticalSidebar.vue';
import VerticalHeaderVue from './vertical-header/VerticalHeader.vue';
import Customizer from './customizer/CustomizerPanel.vue';
import FooterPanel from './footer/FooterPanel.vue';
import GlobalSuccessModal from '@/components/shared/GlobalSuccessModal.vue';
import GlobalConfirmModal from '@/components/shared/GlobalConfirmModal.vue';
import { useCustomizerStore } from '../../stores/customizer';
const customizer = useCustomizerStore();
</script>

<template>
  <v-locale-provider>
    <v-app
      theme="PurpleTheme"
      :class="[customizer.fontTheme, customizer.mini_sidebar ? 'mini-sidebar' : '', customizer.inputBg ? 'inputWithbg' : '']"
    >
      <Customizer />
      <VerticalSidebarVue />
      <VerticalHeaderVue />

      <v-main>
        <v-container fluid class="page-wrapper">
          <div>
            <RouterView v-slot="{ Component, route }">
              <transition name="route-smooth">
                <component :is="Component" :key="route.fullPath" />
              </transition>
            </RouterView>
          </div>
        </v-container>
        <v-container fluid class="pt-0">
          <div>
            <FooterPanel />
          </div>
        </v-container>
      </v-main>
      <GlobalSuccessModal />
      <GlobalConfirmModal />
    </v-app>
  </v-locale-provider>
</template>

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
