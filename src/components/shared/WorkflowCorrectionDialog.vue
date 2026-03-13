<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { mdiArrowLeftCircleOutline, mdiCloseCircleOutline } from '@mdi/js';

const props = defineProps<{
  modelValue: boolean;
  loading?: boolean;
  recordLabel: string;
  currentModuleLabel: string;
  targetModuleLabel: string;
  reasonOptions?: string[];
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'submit', payload: { reason: string; remarks: string }): void;
}>();

const selectedReason = ref('');
const remarks = ref('');
const internalError = ref('');

const reasons = computed(
  () =>
    props.reasonOptions?.length
      ? props.reasonOptions
      : [
          'Incorrect billing amount',
          'Wrong invoice details',
          'Student information mismatch',
          'Duplicate billing',
          'Incorrect payment amount',
          'Invalid payment request',
          'Wrong payment method',
          'Receipt details incorrect',
          'Proof of payment incomplete',
          'Document mismatch'
        ]
);

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      selectedReason.value = '';
      remarks.value = '';
      internalError.value = '';
    }
  }
);

function closeDialog() {
  emit('update:modelValue', false);
}

function submitDialog() {
  if (!selectedReason.value.trim()) {
    internalError.value = 'Correction reason is required.';
    return;
  }

  internalError.value = '';
  emit('submit', {
    reason: selectedReason.value.trim(),
    remarks: remarks.value.trim()
  });
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="560" @update:model-value="emit('update:modelValue', $event)">
    <v-card class="correction-dialog">
      <v-card-text class="pa-0">
        <div class="dialog-hero">
          <div>
            <v-chip color="error" variant="tonal" size="small" class="mb-3">Correction Workflow</v-chip>
            <div class="text-h6 font-weight-black">Return Record for Correction</div>
            <div class="text-body-2 text-medium-emphasis mt-2">
              Send {{ recordLabel }} back to the correct previous BPA stage with a required correction reason.
            </div>
          </div>
          <div class="dialog-icon-shell">
            <v-icon :icon="mdiArrowLeftCircleOutline" size="28" />
          </div>
        </div>

        <div class="pa-6 pt-5">
          <v-alert v-if="internalError" type="error" variant="tonal" class="mb-4">{{ internalError }}</v-alert>

          <div class="dialog-summary-card mb-4">
            <div class="dialog-summary-grid">
              <div>
                <div class="dialog-label">Current Module</div>
                <div class="dialog-value">{{ currentModuleLabel }}</div>
              </div>
              <div>
                <div class="dialog-label">Send Back To</div>
                <div class="dialog-value">{{ targetModuleLabel }}</div>
              </div>
            </div>
          </div>

          <v-select
            v-model="selectedReason"
            :items="reasons"
            label="Correction Reason *"
            variant="outlined"
            density="comfortable"
            class="mb-4"
          />

          <v-textarea
            v-model="remarks"
            label="Remarks / Notes"
            variant="outlined"
            density="comfortable"
            rows="3"
            auto-grow
          />
        </div>
      </v-card-text>

      <v-card-actions class="px-6 pb-6 pt-0">
        <v-spacer />
        <v-btn variant="text" :prepend-icon="mdiCloseCircleOutline" @click="closeDialog">Cancel</v-btn>
        <v-btn color="error" class="dialog-confirm-btn" :loading="loading" @click="submitDialog">Confirm Correction</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.correction-dialog {
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.18);
}

.dialog-hero {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 24px 20px;
  background: linear-gradient(135deg, #fff5f5 0%, #fff0f0 100%);
  border-bottom: 1px solid rgba(211, 47, 47, 0.12);
}

.dialog-icon-shell {
  width: 60px;
  height: 60px;
  border-radius: 18px;
  display: grid;
  place-items: center;
  background: rgba(211, 47, 47, 0.12);
  color: #d32f2f;
}

.dialog-summary-card {
  padding: 16px;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff 0%, #fdf8f8 100%);
  border: 1px solid rgba(211, 47, 47, 0.12);
}

.dialog-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 16px;
}

.dialog-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #71819e;
  font-weight: 700;
}

.dialog-value {
  margin-top: 4px;
  font-size: 15px;
  font-weight: 700;
  color: #18243f;
}

.dialog-confirm-btn {
  min-width: 160px;
}

@media (max-width: 640px) {
  .dialog-hero {
    flex-direction: column;
    align-items: flex-start;
  }

  .dialog-summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
