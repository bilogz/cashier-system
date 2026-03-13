<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();

const pageTitle = computed(() => String(route.meta.pageTitle || route.name || 'Cashier Module'));
const pageDescription = computed(
  () =>
    String(
      route.meta.pageDescription ||
        'Static cashier module page prepared for dashboard navigation and capstone presentation flow.'
    )
);
</script>

<template>
  <v-row>
    <v-col cols="12">
      <v-card class="hero-banner" elevation="0">
        <v-card-text class="pa-5">
          <div class="hero-kicker">Cashier Module</div>
          <h1 class="text-h4 font-weight-black mb-2">{{ pageTitle }}</h1>
          <p class="hero-subtitle mb-0">{{ pageDescription }}</p>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" md="7">
      <v-card variant="outlined" class="module-shell h-100">
        <v-card-item>
          <v-card-title>Module Workspace</v-card-title>
          <v-card-subtitle>Static content placeholder</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div class="placeholder-panel">
            <v-icon icon="mdi-view-dashboard-edit-outline" size="28" class="text-primary mb-3"></v-icon>
            <div class="text-h6 font-weight-bold mb-2">{{ pageTitle }}</div>
            <p class="text-body-2 text-medium-emphasis mb-0">
              This page keeps the same dashboard styling while reserving space for the cashier workflow screen tied to
              this menu endpoint.
            </p>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" md="5">
      <v-card variant="outlined" class="module-shell h-100">
        <v-card-item>
          <v-card-title>UI Notes</v-card-title>
          <v-card-subtitle>Static demo guidance</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <v-list density="comfortable" class="py-0">
            <v-list-item title="Beige sidebar and white main canvas preserved" />
            <v-list-item title="Rounded cards and soft shadows retained" />
            <v-list-item title="Ready for cashier-specific forms or tables later" />
          </v-list>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>

<style scoped>
.hero-banner {
  border-radius: 16px;
  color: #fff;
  background: linear-gradient(120deg, #162d84 0%, #2f63cc 54%, #3ea8f0 100%);
  box-shadow: 0 14px 30px rgba(19, 45, 126, 0.22);
}

.hero-kicker {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  margin-bottom: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.32);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.55px;
  text-transform: uppercase;
}

.hero-subtitle {
  max-width: 720px;
  color: rgba(255, 255, 255, 0.95);
}

.module-shell {
  border-radius: 18px;
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.05);
}

.placeholder-panel {
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 20px;
  border-radius: 16px;
  background: #fbf7f1;
  border: 1px solid rgba(140, 106, 67, 0.12);
}
</style>
