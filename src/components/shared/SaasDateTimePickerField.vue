<script setup lang="ts">
import { computed, ref, watch } from 'vue';

type PickerMode = 'date' | 'time' | 'datetime';

const props = withDefaults(
  defineProps<{
    modelValue: string | null | undefined;
    label: string;
    mode?: PickerMode;
    errorMessages?: string | string[];
    density?: 'default' | 'comfortable' | 'compact';
    disabled?: boolean;
    min?: string;
    max?: string;
    clearable?: boolean;
    hideDetails?: boolean | 'auto';
    hint?: string;
    persistentHint?: boolean;
    allowedTimes?: string[];
    allowedDates?: string[];
    loading?: boolean;
  }>(),
  {
    mode: 'date',
    density: 'comfortable',
    disabled: false,
    min: '',
    max: '',
    clearable: false,
    hideDetails: false,
    hint: '',
    persistentHint: false,
    allowedTimes: () => [],
    allowedDates: () => [],
    loading: false
  }
);

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
}>();

const dialog = ref(false);
const tab = ref<'date' | 'time'>('date');
const draftDate = ref('');
const draftTime = ref('');
const selectionError = ref('');

function toDateInput(value: string | null | undefined): string {
  if (!value) return '';
  const raw = String(value).trim();
  const fromIso = raw.includes('T') ? raw.split('T')[0] : raw;
  return /^\d{4}-\d{2}-\d{2}$/.test(fromIso) ? fromIso : '';
}

function toTimeInput(value: string | null | undefined): string {
  if (!value) return '';
  const raw = String(value).trim();
  const fromIso = raw.includes('T') ? raw.split('T')[1] : raw;
  const candidate = fromIso.slice(0, 5);
  return /^\d{2}:\d{2}$/.test(candidate) ? candidate : '';
}

function hydrateDraft(): void {
  draftDate.value = toDateInput(props.modelValue);
  draftTime.value = toTimeInput(props.modelValue);
  tab.value = props.mode === 'time' ? 'time' : 'date';
  selectionError.value = '';
}

watch(
  () => props.modelValue,
  () => {
    if (!dialog.value) hydrateDraft();
  },
  { immediate: true }
);

watch(
  () => dialog.value,
  (opened) => {
    if (opened) hydrateDraft();
  }
);

const displayValue = computed(() => {
  if (props.mode === 'date') return draftDate.value;
  if (props.mode === 'time') return draftTime.value;
  if (!draftDate.value && !draftTime.value) return '';
  return `${draftDate.value || '---- -- --'} ${draftTime.value || '--:--'}`;
});

const normalizedAllowedTimes = computed(() =>
  Array.from(
    new Set(
      (props.allowedTimes || [])
        .map((value) => String(value || '').slice(0, 5))
        .filter((value) => /^\d{2}:\d{2}$/.test(value))
    )
  )
);
const hasAllowedTimes = computed(() => normalizedAllowedTimes.value.length > 0);
const normalizedAllowedDates = computed(() =>
  Array.from(
    new Set(
      (props.allowedDates || [])
        .map((value) => String(value || '').trim().slice(0, 10))
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    )
  ).sort()
);
const hasAllowedDates = computed(() => normalizedAllowedDates.value.length > 0);

const pickerTitle = computed(() => {
  if (props.mode === 'date') return 'Select Date';
  if (props.mode === 'time') return 'Select Time';
  return 'Select Date & Time';
});

const pickerSummary = computed(() => {
  if (props.mode === 'date') return draftDate.value || 'No date selected';
  if (props.mode === 'time') return draftTime.value || 'No time selected';
  return `${draftDate.value || 'No date'} | ${draftTime.value || 'No time'}`;
});

const quickDatePicks = computed(() => {
  const offsets = [0, 1, 3, 7];
  const now = new Date();
  return offsets
    .map((offset) => {
      const date = new Date(now);
      date.setDate(now.getDate() + offset);
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      return {
        value: iso,
        label: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' })
      };
    })
    .filter((item) => {
      if (props.min && item.value < props.min) return false;
      if (props.max && item.value > props.max) return false;
      return true;
    });
});

function clearValue(): void {
  selectionError.value = '';
  draftDate.value = '';
  draftTime.value = '';
  emit('update:modelValue', '');
}

function openPicker(): void {
  if (props.disabled) return;
  dialog.value = true;
}

function pickAllowedTime(value: string): void {
  draftTime.value = value;
  selectionError.value = '';
}

function pickQuickDate(value: string): void {
  draftDate.value = value;
}

function pickAllowedDate(value: string): void {
  draftDate.value = value;
  selectionError.value = '';
}

function applySelection(): void {
  selectionError.value = '';
  if (props.mode === 'date') {
    if (hasAllowedDates.value && draftDate.value && !normalizedAllowedDates.value.includes(draftDate.value)) {
      selectionError.value = 'Please select a date from available schedule dates.';
      return;
    }
    emit('update:modelValue', draftDate.value || '');
    dialog.value = false;
    return;
  }
  if (props.mode === 'time') {
    if (hasAllowedTimes.value && draftTime.value && !normalizedAllowedTimes.value.includes(draftTime.value)) {
      selectionError.value = 'Please select a time from available schedule slots.';
      return;
    }
    emit('update:modelValue', draftTime.value || '');
    dialog.value = false;
    return;
  }
  if (!draftDate.value && !draftTime.value) {
    emit('update:modelValue', '');
    dialog.value = false;
    return;
  }
  emit('update:modelValue', `${draftDate.value || ''}T${draftTime.value || '00:00'}`);
  dialog.value = false;
}

watch(
  () => draftTime.value,
  () => {
    if (!selectionError.value) return;
    if (!hasAllowedTimes.value || !draftTime.value || normalizedAllowedTimes.value.includes(draftTime.value)) {
      selectionError.value = '';
    }
  }
);

watch(
  () => draftDate.value,
  () => {
    if (!selectionError.value) return;
    if (!hasAllowedDates.value || !draftDate.value || normalizedAllowedDates.value.includes(draftDate.value)) {
      selectionError.value = '';
    }
  }
);
</script>

<template>
  <div class="saas-picker-field">
    <v-text-field
      :model-value="displayValue"
      :label="label"
      variant="outlined"
      :density="density"
      :error-messages="errorMessages"
      :disabled="disabled"
      :hide-details="hideDetails"
      :hint="hint"
      :persistent-hint="persistentHint"
      :loading="loading"
      readonly
      :prepend-inner-icon="mode === 'time' ? 'mdi-clock-time-four-outline' : 'mdi-calendar-month-outline'"
      @click="openPicker"
      @click:control="openPicker"
      @mousedown.prevent="openPicker"
    >
      <template #append-inner>
        <v-btn
          v-if="clearable && !disabled && displayValue"
          icon="mdi-close-circle-outline"
          variant="text"
          size="x-small"
          class="text-medium-emphasis mr-1"
          @click.stop="clearValue"
        />
        <v-icon icon="mdi-chevron-down" class="text-medium-emphasis" />
      </template>
    </v-text-field>

    <v-dialog v-model="dialog" max-width="680" transition="scale-transition">
      <v-card class="saas-picker-card">
        <v-card-item class="saas-picker-head">
          <v-card-title class="text-h6">{{ pickerTitle }}</v-card-title>
          <v-card-subtitle>{{ pickerSummary }}</v-card-subtitle>
        </v-card-item>

        <v-card-text class="pt-4">
          <template v-if="mode === 'date'">
            <div class="picker-layout">
              <div class="picker-main">
                <div v-if="hasAllowedDates" class="allowed-times-shell">
                  <div class="allowed-times-label">Available dates</div>
                  <div class="allowed-times-grid">
                    <button
                      v-for="slot in normalizedAllowedDates"
                      :key="slot"
                      type="button"
                      class="time-pill"
                      :class="{ active: draftDate === slot }"
                      @click="pickAllowedDate(slot)"
                    >
                      {{ slot }}
                    </button>
                  </div>
                </div>
                <div v-else class="native-picker-shell">
                  <label class="native-picker-label">Pick a date</label>
                  <input v-model="draftDate" class="native-picker-input" type="date" :min="min || undefined" :max="max || undefined" />
                </div>
                <div v-if="selectionError" class="picker-error">{{ selectionError }}</div>
              </div>
              <aside class="picker-aside">
                <div class="picker-aside-card">
                  <div class="picker-aside-title">Quick Dates</div>
                  <div class="quick-date-list">
                    <button
                      v-for="item in quickDatePicks"
                      :key="`q-${item.value}`"
                      type="button"
                      class="quick-date-pill"
                      :class="{ active: draftDate === item.value }"
                      @click="pickQuickDate(item.value)"
                    >
                      {{ item.label }}
                    </button>
                  </div>
                </div>
              </aside>
            </div>
          </template>

          <template v-else-if="mode === 'time'">
            <div class="picker-layout">
              <div class="picker-main">
                <div v-if="hasAllowedTimes" class="allowed-times-shell">
                  <div class="allowed-times-label">Available time slots</div>
                  <div class="allowed-times-grid">
                    <button
                      v-for="slot in normalizedAllowedTimes"
                      :key="slot"
                      type="button"
                      class="time-pill"
                      :class="{ active: draftTime === slot }"
                      @click="pickAllowedTime(slot)"
                    >
                      {{ slot }}
                    </button>
                  </div>
                </div>
                <div v-else class="native-picker-shell">
                  <label class="native-picker-label">Pick a time</label>
                  <input v-model="draftTime" class="native-picker-input" type="time" step="1800" />
                </div>
                <div v-if="selectionError" class="picker-error">{{ selectionError }}</div>
              </div>
              <aside class="picker-aside">
                <div class="picker-aside-card">
                  <div class="picker-aside-title">Selection Summary</div>
                  <div class="picker-aside-row"><span>Selected</span><strong>{{ draftTime || '--:--' }}</strong></div>
                  <div class="picker-aside-row"><span>Available Slots</span><strong>{{ normalizedAllowedTimes.length || '--' }}</strong></div>
                  <p class="picker-aside-note">Choose from suggested times to match doctor schedule capacity.</p>
                </div>
              </aside>
            </div>
          </template>

          <template v-else>
            <v-tabs v-model="tab" density="comfortable" color="primary" class="mb-3">
              <v-tab value="date">Date</v-tab>
              <v-tab value="time">Time</v-tab>
            </v-tabs>
            <v-window v-model="tab">
              <v-window-item value="date">
                <div v-if="hasAllowedDates" class="allowed-times-shell">
                  <div class="allowed-times-label">Available dates</div>
                  <div class="allowed-times-grid">
                    <button
                      v-for="slot in normalizedAllowedDates"
                      :key="`dd-${slot}`"
                      type="button"
                      class="time-pill"
                      :class="{ active: draftDate === slot }"
                      @click="pickAllowedDate(slot)"
                    >
                      {{ slot }}
                    </button>
                  </div>
                </div>
                <div v-else class="native-picker-shell">
                  <label class="native-picker-label">Pick a date</label>
                  <input v-model="draftDate" class="native-picker-input" type="date" :min="min || undefined" :max="max || undefined" />
                </div>
              </v-window-item>
              <v-window-item value="time">
                <div v-if="hasAllowedTimes" class="allowed-times-shell">
                  <div class="allowed-times-label">Available time slots</div>
                  <div class="allowed-times-grid">
                    <button
                      v-for="slot in normalizedAllowedTimes"
                      :key="`dt-${slot}`"
                      type="button"
                      class="time-pill"
                      :class="{ active: draftTime === slot }"
                      @click="pickAllowedTime(slot)"
                    >
                      {{ slot }}
                    </button>
                  </div>
                </div>
                <div v-else class="native-picker-shell">
                  <label class="native-picker-label">Pick a time</label>
                  <input v-model="draftTime" class="native-picker-input" type="time" step="1800" />
                </div>
              </v-window-item>
            </v-window>
          </template>
        </v-card-text>

        <v-card-actions class="px-5 pb-5 saas-picker-actions">
          <v-btn variant="text" class="picker-btn-cancel" @click="dialog = false">Cancel</v-btn>
          <v-spacer />
          <v-btn color="primary" variant="flat" class="picker-btn-apply" @click="applySelection">Apply</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped lang="scss">
.saas-picker-card {
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  box-shadow: 0 20px 60px rgba(16, 24, 40, 0.22);
  border-radius: 18px;
  overflow: hidden;
  animation: saasPickerPop 220ms ease;
}

.saas-picker-head {
  background: linear-gradient(135deg, rgba(var(--v-theme-primary), 0.12), rgba(var(--v-theme-secondary), 0.08));
}

.picker-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  gap: 12px;
}

.picker-main {
  min-width: 0;
}

.picker-aside {
  min-width: 0;
}

.picker-aside-card {
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 14px;
  background: linear-gradient(180deg, #f8fbff 0%, #f2f7ff 100%);
  padding: 10px;
}

.picker-aside-title {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.35px;
  text-transform: uppercase;
  color: #264783;
  margin-bottom: 8px;
}

.picker-aside-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
  color: #4c6485;
}

.picker-aside-row strong {
  color: #21467f;
  font-size: 13px;
}

.picker-aside-note {
  margin: 6px 0 0;
  font-size: 12px;
  color: #607894;
}

.saas-picker-field :deep(.v-field) {
  border-radius: 12px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
}

.native-picker-shell {
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 14px;
  padding: 12px;
  background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.05) 0%, rgba(var(--v-theme-secondary), 0.03) 100%);
}

.native-picker-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  color: rgba(26, 49, 91, 0.9);
  letter-spacing: 0.35px;
  text-transform: uppercase;
}

.native-picker-input {
  width: 100%;
  min-height: 42px;
  border: 1px solid rgba(54, 86, 143, 0.25);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 14px;
  font-weight: 600;
  color: #23477f;
  background: #fff;
  outline: none;
}

.native-picker-input:focus {
  border-color: #2f67d2;
  box-shadow: 0 0 0 3px rgba(47, 103, 210, 0.15);
}

.allowed-times-shell {
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 14px;
  padding: 12px;
  background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.05) 0%, rgba(var(--v-theme-secondary), 0.03) 100%);
}

.allowed-times-label {
  font-size: 12px;
  font-weight: 700;
  color: rgba(26, 49, 91, 0.9);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.allowed-times-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 8px;
  max-height: 260px;
  overflow: auto;
}

.time-pill {
  border: 1px solid rgba(54, 86, 143, 0.25);
  border-radius: 10px;
  min-height: 36px;
  background: #fff;
  color: #2b4e86;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 140ms ease;
}

.time-pill:hover {
  border-color: rgba(44, 101, 225, 0.45);
  background: #f3f8ff;
}

.time-pill.active {
  border-color: #2f67d2;
  background: linear-gradient(130deg, #2f67d2 0%, #3c97f0 100%);
  color: #fff;
  box-shadow: 0 8px 14px rgba(42, 92, 184, 0.26);
}

.quick-date-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.quick-date-pill {
  border: 1px solid rgba(54, 86, 143, 0.24);
  border-radius: 10px;
  background: #fff;
  color: #2f568f;
  font-size: 12px;
  font-weight: 700;
  min-height: 34px;
  text-align: left;
  padding: 0 10px;
  cursor: pointer;
}

.quick-date-pill.active {
  border-color: #2f67d2;
  background: linear-gradient(130deg, #2f67d2 0%, #3c97f0 100%);
  color: #fff;
}

.picker-error {
  margin-top: 10px;
  font-size: 12px;
  color: #b42318;
  font-weight: 600;
}

.saas-picker-actions {
  border-top: 1px solid rgba(61, 95, 160, 0.14);
}

.picker-btn-cancel {
  text-transform: none;
  font-weight: 700;
}

.picker-btn-apply {
  min-width: 110px;
  border-radius: 999px;
  text-transform: none;
  font-weight: 700;
  box-shadow: 0 10px 18px rgba(44, 101, 225, 0.26);
}

@media (max-width: 720px) {
  .picker-layout {
    grid-template-columns: 1fr;
  }
}

@keyframes saasPickerPop {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
