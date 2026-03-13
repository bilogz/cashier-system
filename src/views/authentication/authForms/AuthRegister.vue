<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();
const loading = ref(false);
const successMessage = ref('');
const errorMessage = ref('');

const form = reactive({
  full_name: '',
  username: '',
  email: '',
  phone: '',
  role: 'Admin',
  status: 'active',
  password: '',
  confirmPassword: ''
});

function validate(): string | null {
  const fullName = form.full_name.trim();
  const username = form.username.trim().toLowerCase();
  const email = form.email.trim().toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!authStore.user?.isSuperAdmin) return 'Only super admin can create admin accounts.';
  if (!fullName) return 'Full name is required.';
  if (!emailPattern.test(username)) return 'Username must be a valid email address.';
  if (!emailPattern.test(email)) return 'Email must be a valid email address.';
  if (form.password.length < 8) return 'Password must be at least 8 characters.';
  if (form.password !== form.confirmPassword) return 'Password confirmation does not match.';
  return null;
}

async function submit(): Promise<void> {
  successMessage.value = '';
  errorMessage.value = '';
  const validationError = validate();
  if (validationError) {
    errorMessage.value = validationError;
    return;
  }
  loading.value = true;
  try {
    await authStore.registerAdminAccount({
      full_name: form.full_name.trim(),
      username: form.username.trim().toLowerCase(),
      email: form.email.trim().toLowerCase(),
      role: form.role,
      status: form.status,
      phone: form.phone.trim(),
      password: form.password,
      is_super_admin: false
    });
    successMessage.value = 'Admin account created successfully.';
    form.full_name = '';
    form.username = '';
    form.email = '';
    form.phone = '';
    form.password = '';
    form.confirmPassword = '';
    form.role = 'Admin';
    form.status = 'active';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <v-alert color="lightinfo" variant="tonal" class="mb-6">
    Super admin access is required to create admin accounts.
  </v-alert>

  <v-form class="mt-5 loginForm" @submit.prevent="submit">
    <v-text-field v-model="form.full_name" label="Full Name *" variant="outlined" density="comfortable" class="mb-4" />
    <v-text-field v-model="form.username" label="Username (Email) *" variant="outlined" density="comfortable" class="mb-4" />
    <v-text-field v-model="form.email" label="Email *" variant="outlined" density="comfortable" class="mb-4" />
    <v-text-field v-model="form.phone" label="Phone" variant="outlined" density="comfortable" class="mb-4" />
    <v-row>
      <v-col cols="12" sm="6">
        <v-select v-model="form.role" :items="['Admin', 'Doctor', 'Nurse', 'Receptionist', 'Lab Staff', 'Pharmacist']" label="Role" variant="outlined" density="comfortable" />
      </v-col>
      <v-col cols="12" sm="6">
        <v-select v-model="form.status" :items="['active', 'inactive']" label="Status" variant="outlined" density="comfortable" />
      </v-col>
    </v-row>
    <v-text-field
      v-model="form.password"
      type="password"
      label="Password *"
      variant="outlined"
      density="comfortable"
      class="mb-4"
      autocomplete="new-password"
    />
    <v-text-field
      v-model="form.confirmPassword"
      type="password"
      label="Confirm Password *"
      variant="outlined"
      density="comfortable"
      class="mb-4"
      autocomplete="new-password"
    />

    <v-btn color="secondary" block size="large" type="submit" :loading="loading">Create Admin Account</v-btn>
    <v-alert v-if="successMessage" color="success" variant="tonal" class="mt-4">{{ successMessage }}</v-alert>
    <v-alert v-if="errorMessage" color="error" variant="tonal" class="mt-4">{{ errorMessage }}</v-alert>
  </v-form>
</template>
