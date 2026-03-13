<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import SaasDateTimePickerField from '@/components/shared/SaasDateTimePickerField.vue';
import { updatePatientProfile } from '@/services/patientPortal';
import type { PatientAccount } from '@/services/patientAuth';

const model = defineModel<boolean>({ default: false });
const props = defineProps<{ account: PatientAccount | null }>();
const emit = defineEmits<{ updated: [account: PatientAccount] }>();

const saving = ref(false);
const errorMessage = ref('');

const form = reactive({
  full_name: '',
  phone_number: '',
  sex: '',
  date_of_birth: '',
  guardian_name: ''
});

const isMinor = computed(() => {
  if (!form.date_of_birth) return false;
  const dob = new Date(form.date_of_birth);
  if (Number.isNaN(dob.getTime())) return false;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age < 18;
});

watch(
  () => model.value,
  (open) => {
    if (!open) return;
    errorMessage.value = '';
    form.full_name = props.account?.fullName || '';
    form.phone_number = props.account?.phoneNumber || '';
    form.sex = props.account?.sex || '';
    form.date_of_birth = props.account?.dateOfBirth || '';
    form.guardian_name = props.account?.guardianName || '';
  }
);

async function submitProfile(): Promise<void> {
  errorMessage.value = '';
  if (!form.full_name.trim()) {
    errorMessage.value = 'Full name is required.';
    return;
  }
  if (!/^[0-9+\-\s()]{7,20}$/.test(form.phone_number.trim())) {
    errorMessage.value = 'Valid phone number is required.';
    return;
  }
  if (isMinor.value && !form.guardian_name.trim()) {
    errorMessage.value = 'Guardian name is required for minors.';
    return;
  }

  saving.value = true;
  try {
    const result = await updatePatientProfile({
      full_name: form.full_name.trim(),
      phone_number: form.phone_number.trim(),
      sex: form.sex || undefined,
      date_of_birth: form.date_of_birth || undefined,
      guardian_name: form.guardian_name || undefined
    });
    emit('updated', result.account);
    model.value = false;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="model" max-width="680" persistent>
    <v-card class="profile-modal">
      <v-card-title class="profile-title">Edit Student Profile</v-card-title>
      <v-card-text>
        <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-3">{{ errorMessage }}</v-alert>
        <div class="profile-grid">
          <v-text-field v-model="form.full_name" label="Full Name" variant="outlined" density="comfortable" hide-details />
          <v-text-field v-model="form.phone_number" label="Phone Number" variant="outlined" density="comfortable" hide-details />
          <v-select v-model="form.sex" :items="['Male', 'Female', 'Other']" label="Sex" variant="outlined" density="comfortable" hide-details />
          <SaasDateTimePickerField v-model="form.date_of_birth" mode="date" label="Date of Birth" clearable />
          <v-text-field
            v-model="form.guardian_name"
            :label="isMinor ? 'Guardian Name *' : 'Guardian Name (optional)'"
            variant="outlined"
            density="comfortable"
            :hint="isMinor ? 'Required for minors.' : ''"
            :persistent-hint="isMinor"
            hide-details="auto"
          />
        </div>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" :disabled="saving" @click="model = false">Cancel</v-btn>
        <v-spacer />
        <v-btn color="primary" :loading="saving" :disabled="saving" @click="submitProfile">Save Profile</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.profile-modal {
  border-radius: 14px;
}

.profile-title {
  font-weight: 800;
  color: #183d59;
}

.profile-grid {
  display: grid;
  gap: 12px;
}
</style>
