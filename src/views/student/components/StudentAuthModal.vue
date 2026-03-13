<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import SaasDateTimePickerField from '@/components/shared/SaasDateTimePickerField.vue';
import {
  loginPatientAccount,
  requestEmailVerification,
  requestPasswordReset,
  resetPatientPassword,
  signupPatientAccount,
  verifyPatientEmail,
  type PatientSessionResponse
} from '@/services/patientAuth';

const model = defineModel<boolean>({ default: false });
const props = defineProps<{ initialMode?: 'login' | 'signup' }>();
const emit = defineEmits<{ authenticated: [session: PatientSessionResponse] }>();

type AuthMode = 'login' | 'signup' | 'verify' | 'forgot' | 'reset';
const mode = ref<AuthMode>('login');
const submitting = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const devCode = ref('');

const loginForm = reactive({ email: '', password: '' });
const signupForm = reactive({
  full_name: '',
  email: '',
  phone_number: '',
  sex: '',
  date_of_birth: '',
  guardian_name: '',
  password: '',
  confirm_password: ''
});
const verifyForm = reactive({ email: '', code: '' });
const forgotForm = reactive({ email: '' });
const resetForm = reactive({ email: '', code: '', new_password: '', confirm_password: '' });

const isSignupMinor = computed(() => {
  if (!signupForm.date_of_birth) return false;
  const dob = new Date(signupForm.date_of_birth);
  if (Number.isNaN(dob.getTime())) return false;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age < 18;
});

function resetMessages(): void {
  errorMessage.value = '';
  successMessage.value = '';
  devCode.value = '';
}

function closeModal(): void {
  if (submitting.value) return;
  model.value = false;
}

function setMode(next: AuthMode): void {
  mode.value = next;
  resetMessages();
}

watch(
  () => model.value,
  (open) => {
    if (!open) return;
    mode.value = props.initialMode || 'login';
    resetMessages();
  }
);

async function submitLogin(): Promise<void> {
  resetMessages();
  submitting.value = true;
  try {
    const session = await loginPatientAccount({ email: loginForm.email, password: loginForm.password });
    emit('authenticated', session);
    closeModal();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorMessage.value = message;
    if (message.toLowerCase().includes('not verified')) {
      verifyForm.email = loginForm.email;
      setMode('verify');
    }
  } finally {
    submitting.value = false;
  }
}

async function submitSignup(): Promise<void> {
  resetMessages();
  if (signupForm.password !== signupForm.confirm_password) {
    errorMessage.value = 'Passwords do not match.';
    return;
  }
  if (isSignupMinor.value && !signupForm.guardian_name.trim()) {
    errorMessage.value = 'Guardian name is required for minors.';
    return;
  }
  submitting.value = true;
  try {
    const session = await signupPatientAccount({
      full_name: signupForm.full_name,
      email: signupForm.email,
      phone_number: signupForm.phone_number,
      sex: signupForm.sex || undefined,
      date_of_birth: signupForm.date_of_birth || undefined,
      guardian_name: signupForm.guardian_name || undefined,
      password: signupForm.password
    });
    if (session.authenticated) {
      emit('authenticated', session);
      closeModal();
      return;
    }
    verifyForm.email = session.verificationEmail || signupForm.email;
    devCode.value = session.devVerificationCode || '';
    successMessage.value = 'Account created. Enter verification code to continue.';
    setMode('verify');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    submitting.value = false;
  }
}

async function requestVerifyCode(): Promise<void> {
  resetMessages();
  submitting.value = true;
  try {
    const payload = await requestEmailVerification(verifyForm.email);
    successMessage.value = 'Verification code sent.';
    devCode.value = payload.devVerificationCode || '';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    submitting.value = false;
  }
}

async function submitVerify(): Promise<void> {
  resetMessages();
  submitting.value = true;
  try {
    const session = await verifyPatientEmail({ email: verifyForm.email, code: verifyForm.code });
    emit('authenticated', session);
    closeModal();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    submitting.value = false;
  }
}

async function submitForgot(): Promise<void> {
  resetMessages();
  submitting.value = true;
  try {
    const payload = await requestPasswordReset(forgotForm.email);
    resetForm.email = payload.resetEmail || forgotForm.email;
    devCode.value = payload.devResetCode || '';
    successMessage.value = 'Reset code sent. Enter code and new password.';
    setMode('reset');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    submitting.value = false;
  }
}

async function submitReset(): Promise<void> {
  resetMessages();
  if (resetForm.new_password !== resetForm.confirm_password) {
    errorMessage.value = 'Passwords do not match.';
    return;
  }
  submitting.value = true;
  try {
    await resetPatientPassword({ email: resetForm.email, code: resetForm.code, new_password: resetForm.new_password });
    successMessage.value = 'Password reset successful. Please login.';
    setMode('login');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="model" max-width="700" :persistent="submitting">
    <v-card class="auth-modal">
      <v-card-title class="auth-title d-flex align-center justify-space-between">
        <span>Student Account Access</span>
        <v-btn icon variant="text" :disabled="submitting" @click="closeModal">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-card-text>
        <div class="auth-tabs" v-if="mode === 'login' || mode === 'signup'">
          <button type="button" class="auth-tab" :class="{ active: mode === 'login' }" @click="setMode('login')">Login</button>
          <button type="button" class="auth-tab" :class="{ active: mode === 'signup' }" @click="setMode('signup')">Sign Up</button>
        </div>

        <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-3">{{ errorMessage }}</v-alert>
        <v-alert v-if="successMessage" type="success" variant="tonal" class="mb-3">{{ successMessage }}</v-alert>
        <v-alert v-if="devCode" type="info" variant="tonal" class="mb-3">Demo code: <strong>{{ devCode }}</strong></v-alert>

        <div v-if="mode === 'login'" class="auth-grid">
          <v-text-field v-model="loginForm.email" label="Email" type="email" variant="outlined" density="comfortable" hide-details />
          <v-text-field v-model="loginForm.password" label="Password" type="password" variant="outlined" density="comfortable" hide-details />
          <button type="button" class="text-link" @click="setMode('forgot')">Forgot password?</button>
        </div>

        <div v-else-if="mode === 'signup'" class="auth-grid">
          <v-text-field v-model="signupForm.full_name" label="Full Name" variant="outlined" density="comfortable" hide-details />
          <v-text-field v-model="signupForm.email" label="Email" type="email" variant="outlined" density="comfortable" hide-details />
          <v-text-field v-model="signupForm.phone_number" label="Phone Number" variant="outlined" density="comfortable" hide-details />
          <v-select v-model="signupForm.sex" :items="['Male', 'Female', 'Other']" label="Sex" variant="outlined" density="comfortable" hide-details />
          <SaasDateTimePickerField v-model="signupForm.date_of_birth" mode="date" label="Date of Birth" clearable />
          <v-text-field
            v-model="signupForm.guardian_name"
            :label="isSignupMinor ? 'Guardian Name *' : 'Guardian Name (optional)'"
            variant="outlined"
            density="comfortable"
            :hint="isSignupMinor ? 'Required for minors.' : ''"
            :persistent-hint="isSignupMinor"
            hide-details="auto"
          />
          <v-text-field v-model="signupForm.password" label="Password" type="password" variant="outlined" density="comfortable" hint="Minimum 8 characters" persistent-hint />
          <v-text-field v-model="signupForm.confirm_password" label="Confirm Password" type="password" variant="outlined" density="comfortable" hide-details />
        </div>

        <div v-else-if="mode === 'verify'" class="auth-grid">
          <v-text-field v-model="verifyForm.email" label="Email" type="email" variant="outlined" density="comfortable" hide-details />
          <v-text-field v-model="verifyForm.code" label="Verification Code" variant="outlined" density="comfortable" hide-details />
          <button type="button" class="text-link" @click="requestVerifyCode">Resend verification code</button>
          <button type="button" class="text-link" @click="setMode('login')">Back to login</button>
        </div>

        <div v-else-if="mode === 'forgot'" class="auth-grid">
          <v-text-field v-model="forgotForm.email" label="Email" type="email" variant="outlined" density="comfortable" hide-details />
          <button type="button" class="text-link" @click="setMode('login')">Back to login</button>
        </div>

        <div v-else class="auth-grid">
          <v-text-field v-model="resetForm.email" label="Email" type="email" variant="outlined" density="comfortable" hide-details />
          <v-text-field v-model="resetForm.code" label="Reset Code" variant="outlined" density="comfortable" hide-details />
          <v-text-field v-model="resetForm.new_password" label="New Password" type="password" variant="outlined" density="comfortable" hide-details />
          <v-text-field v-model="resetForm.confirm_password" label="Confirm Password" type="password" variant="outlined" density="comfortable" hide-details />
          <button type="button" class="text-link" @click="setMode('login')">Back to login</button>
        </div>
      </v-card-text>
      <v-card-actions class="auth-actions">
        <v-btn variant="text" :disabled="submitting" @click="closeModal">Cancel</v-btn>
        <v-spacer />
        <v-btn v-if="mode === 'login'" color="primary" :loading="submitting" :disabled="submitting" @click="submitLogin">Login</v-btn>
        <v-btn v-else-if="mode === 'signup'" color="primary" :loading="submitting" :disabled="submitting" @click="submitSignup">Create Account</v-btn>
        <v-btn v-else-if="mode === 'verify'" color="primary" :loading="submitting" :disabled="submitting" @click="submitVerify">Verify Email</v-btn>
        <v-btn v-else-if="mode === 'forgot'" color="primary" :loading="submitting" :disabled="submitting" @click="submitForgot">Send Reset Code</v-btn>
        <v-btn v-else color="primary" :loading="submitting" :disabled="submitting" @click="submitReset">Reset Password</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss">
.auth-modal { border-radius: 14px; }
.auth-title { font-weight: 800; color: #183d59; }
.auth-tabs { display: flex; gap: 8px; margin-bottom: 14px; }
.auth-tab { border: 1px solid #cae2ef; background: #f6fbff; border-radius: 999px; padding: 8px 14px; color: #30566f; font-weight: 700; }
.auth-tab.active { background: #0f66e8; border-color: #0f66e8; color: #fff; }
.auth-grid { display: grid; gap: 12px; }
.auth-actions { padding: 12px 16px 18px; }
.text-link { color: #0f66e8; font-weight: 700; background: transparent; border: 0; text-align: left; }
</style>
