<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { Form } from 'vee-validate';

const defaultAdminUsername = 'admin@cashier.local';
const defaultAdminPassword = 'admin123';
const demoStaffUsername = 'staff@cashier.local';
const demoStaffPassword = 'staff123';
const demoComplianceUsername = 'compliance@cashier.local';
const demoCompliancePassword = 'compliance123';
const show1 = ref(false);
const password = ref('');
const username = ref('');
const apiError = ref('');
const signingIn = ref(false);
const passwordRules = ref([(v: string) => !!String(v || '').trim() || 'Password is required']);
const emailRules = ref([
  (v: string) => !!String(v || '').trim() || 'Email is required',
  (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim()) || 'Enter a valid email'
]);
const canSubmit = computed(() => {
  return Boolean(String(username.value || '').trim()) && Boolean(String(password.value || '').trim());
});

function useDefaultAccount(): void {
  username.value = defaultAdminUsername;
  password.value = defaultAdminPassword;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function validate(_values: any, { setErrors }: any) {
  const authStore = useAuthStore();
  apiError.value = '';
  signingIn.value = true;
  try {
    await authStore.login(username.value, password.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    apiError.value = message || 'Unable to sign in.';
    setErrors({ apiError: message });
  } finally {
    signingIn.value = false;
  }
}
</script>

<template>
  <Form @submit="validate" class="mt-7 loginForm" v-slot="{ errors, isSubmitting }">
    <v-alert color="info" variant="tonal" class="mb-4 default-account-note">
      <div class="font-weight-bold mb-1">Demo Admin and Staff Accounts</div>
      <div>Admin: {{ defaultAdminUsername }} / {{ defaultAdminPassword }}</div>
      <div class="mt-2">Faculty or Staff: {{ demoStaffUsername }} / {{ demoStaffPassword }}</div>
      <div>Compliance: {{ demoComplianceUsername }} / {{ demoCompliancePassword }}</div>
      <v-btn size="small" variant="flat" color="primary" class="mt-3" @click="useDefaultAccount">Use Default Account</v-btn>
    </v-alert>

    <v-text-field
      v-model="username"
      :rules="emailRules"
      label="Email Address"
      class="mt-2 mb-6"
      required
      density="comfortable"
      hide-details="auto"
      variant="outlined"
      color="primary"
      autocomplete="username"
    ></v-text-field>
    <v-text-field
      v-model="password"
      :rules="passwordRules"
      label="Password"
      required
      density="comfortable"
      variant="outlined"
      color="primary"
      hide-details="auto"
      :append-icon="show1 ? '$eye' : '$eyeOff'"
      :type="show1 ? 'text' : 'password'"
      @click:append="show1 = !show1"
      class="pwdInput"
      autocomplete="current-password"
    ></v-text-field>

    <v-btn color="primary" :loading="isSubmitting || signingIn" :disabled="isSubmitting || signingIn || !canSubmit" block class="mt-6 login-submit-btn" variant="flat" size="large" type="submit">Sign In</v-btn>
    <div v-if="apiError || errors.apiError" class="mt-2">
      <v-alert color="error" variant="tonal">{{ apiError || errors.apiError }}</v-alert>
    </div>
  </Form>

  <v-dialog :model-value="signingIn" persistent max-width="360">
    <v-card class="pa-6 text-center auth-loading-card">
      <v-progress-circular indeterminate color="primary" size="48" width="4" class="mb-4" />
      <div class="text-h6 mb-1">Signing In</div>
      <div class="text-body-2 text-medium-emphasis">Securing your admin session...</div>
    </v-card>
  </v-dialog>
</template>
<style lang="scss">
.outlinedInput .v-field {
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: none;
}
.pwdInput {
  position: relative;
  .v-input__append {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
  }
}
.loginForm {
  .v-text-field .v-field--active input {
    font-weight: 500;
  }
}
.login-submit-btn {
  letter-spacing: 0.25px;
  font-weight: 700;
}
.auth-loading-card {
  border: 1px solid rgba(31, 91, 188, 0.2);
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff 0%, #f5f9ff 100%);
}
.default-account-note {
  text-align: left;
}
</style>
