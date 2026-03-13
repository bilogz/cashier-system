<script setup lang="ts">
import { onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();

onMounted(() => {
  void authStore.logout();
});
</script>

<template>
  <v-row justify="center" align="center" class="fill-height">
    <v-col cols="12" md="5" lg="4">
      <v-card class="pa-8 text-center" rounded="xl" elevation="0">
        <v-progress-circular indeterminate color="primary" class="mb-4" />
        <div class="text-h6 font-weight-bold">Signing out</div>
        <div class="text-body-2 text-medium-emphasis">Redirecting to the admin login page...</div>
      </v-card>
    </v-col>
  </v-row>
</template>
