<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { mdiCloseCircleOutline } from '@mdi/js';

type ActionDialogField = {
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'select' | 'number' | 'date';
  items?: Array<string | { title: string; value: string | number }>;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  min?: number;
  step?: string | number;
  rows?: number;
  readonly?: boolean;
};

type ActionDialogContextField = {
  label: string;
  value: string;
};

const props = defineProps<{
  modelValue: boolean;
  loading?: boolean;
  title: string;
  subtitle?: string;
  chipLabel?: string;
  chipColor?: string;
  confirmLabel?: string;
  confirmColor?: string;
  contextFields: ActionDialogContextField[];
  fields: ActionDialogField[];
  initialValues?: Record<string, string | number>;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'submit', payload: Record<string, string | number>): void;
}>();

const formValues = ref<Record<string, string | number>>({});
const internalError = ref('');

const resolvedConfirmLabel = computed(() => props.confirmLabel || 'Save Changes');
const resolvedConfirmColor = computed(() => props.confirmColor || 'primary');
const resolvedChipColor = computed(() => props.chipColor || 'primary');

function initializeForm() {
  const nextValues: Record<string, string | number> = {};

  for (const field of props.fields) {
    const preset = props.initialValues?.[field.key];
    if (preset !== undefined && preset !== null) {
      nextValues[field.key] = preset;
      continue;
    }

    if (field.type === 'number') {
      nextValues[field.key] = '';
      continue;
    }

    nextValues[field.key] = '';
  }

  formValues.value = nextValues;
  internalError.value = '';
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) initializeForm();
  },
  { immediate: true }
);

watch(
  () => props.initialValues,
  () => {
    if (props.modelValue) initializeForm();
  },
  { deep: true }
);

function closeDialog() {
  emit('update:modelValue', false);
}

function validateForm() {
  for (const field of props.fields) {
    if (!field.required) continue;
    const value = formValues.value[field.key];

    if (field.type === 'number') {
      if (value === '' || value === null || Number(value) <= 0) {
        internalError.value = `${field.label} is required.`;
        return false;
      }
      continue;
    }

    if (String(value ?? '').trim() === '') {
      internalError.value = `${field.label} is required.`;
      return false;
    }
  }

  internalError.value = '';
  return true;
}

function submitDialog() {
  if (!validateForm()) return;
  emit('submit', { ...formValues.value });
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="720" @update:model-value="emit('update:modelValue', $event)">
    <v-card class="action-dialog">
      <v-card-text class="pa-0">
        <div class="dialog-hero">
          <div class="dialog-hero-copy">
            <v-chip v-if="chipLabel" :color="resolvedChipColor" variant="tonal" size="small" class="mb-3">{{ chipLabel }}</v-chip>
            <div class="text-h6 font-weight-black">{{ title }}</div>
            <div v-if="subtitle" class="text-body-2 text-medium-emphasis mt-2">{{ subtitle }}</div>
          </div>
        </div>

        <div class="pa-6 pt-5">
          <v-alert v-if="internalError" type="error" variant="tonal" class="mb-4">{{ internalError }}</v-alert>

          <div class="context-card mb-5">
            <div class="context-grid">
              <div v-for="field in contextFields" :key="field.label">
                <div class="context-label">{{ field.label }}</div>
                <div class="context-value">{{ field.value }}</div>
              </div>
            </div>
          </div>

          <slot name="preview" :form-values="formValues" />

          <div class="form-grid">
            <template v-for="field in fields" :key="field.key">
              <v-text-field
                v-if="field.type === 'text' || field.type === 'number' || field.type === 'date' || !field.type"
                v-model="formValues[field.key]"
                :type="field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'"
                :label="field.required ? `${field.label} *` : field.label"
                :placeholder="field.placeholder"
                :hint="field.hint"
                :readonly="field.readonly"
                :min="field.min"
                :step="field.step"
                variant="outlined"
                density="comfortable"
                persistent-hint
                hide-details="auto"
              />

              <v-select
                v-else-if="field.type === 'select'"
                v-model="formValues[field.key]"
                :items="field.items || []"
                :label="field.required ? `${field.label} *` : field.label"
                :hint="field.hint"
                :readonly="field.readonly"
                variant="outlined"
                density="comfortable"
                persistent-hint
                hide-details="auto"
              />

              <v-textarea
                v-else-if="field.type === 'textarea'"
                v-model="formValues[field.key]"
                :label="field.required ? `${field.label} *` : field.label"
                :placeholder="field.placeholder"
                :hint="field.hint"
                :readonly="field.readonly"
                :rows="field.rows || 3"
                auto-grow
                variant="outlined"
                density="comfortable"
                persistent-hint
                hide-details="auto"
              />
            </template>
          </div>
        </div>
      </v-card-text>

      <v-card-actions class="px-6 pb-6 pt-0">
        <v-spacer />
        <v-btn variant="text" :prepend-icon="mdiCloseCircleOutline" @click="closeDialog">Cancel</v-btn>
        <v-btn :color="resolvedConfirmColor" class="dialog-confirm-btn" :loading="loading" @click="submitDialog">
          {{ resolvedConfirmLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.action-dialog {
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.18);
}

.dialog-hero {
  padding: 24px 24px 20px;
  background: linear-gradient(135deg, #f6f9ff 0%, #eef4ff 100%);
  border-bottom: 1px solid rgba(78, 107, 168, 0.14);
}

.dialog-hero-copy {
  max-width: 520px;
}

.context-card {
  padding: 16px;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
  border: 1px solid rgba(78, 107, 168, 0.16);
}

.context-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 16px;
}

.context-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #71819e;
  font-weight: 700;
}

.context-value {
  margin-top: 4px;
  font-size: 15px;
  font-weight: 700;
  color: #18243f;
}

.form-grid {
  display: grid;
  gap: 16px;
}

.dialog-confirm-btn {
  min-width: 140px;
}

@media (max-width: 640px) {
  .context-grid {
    grid-template-columns: 1fr;
  }
}
</style>
