<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
</script>

<template>
  <v-container class="fill-height d-flex align-center justify-center">
    <v-card max-width="560" class="pa-6 text-center">
      <v-icon size="64" color="error" class="mb-3">mdi-shield-lock-outline</v-icon>
      <h2 class="text-h3 mb-2">Access Denied</h2>
      <p class="text-medium-emphasis mb-6">Your account does not have permission to access this module.</p>
      <div class="d-flex justify-center ga-2">
        <v-btn color="primary" variant="flat" :to="auth.defaultRouteForUser(auth.user)">Go to Allowed Module</v-btn>
        <v-btn color="secondary" variant="outlined" to="/dashboard/default">Dashboard</v-btn>
      </div>
    </v-card>
  </v-container>
</template>

