<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { successModalEventName, type SuccessModalPayload, type SuccessModalTone } from '@/composables/useSuccessModal';

const open = ref(false);
const title = ref('Success');
const message = ref('');
const tone = ref<SuccessModalTone>('success');
let timer: ReturnType<typeof setTimeout> | null = null;

const toneColor = computed(() => {
  if (tone.value === 'warning') return '#f59e0b';
  if (tone.value === 'info') return '#2563eb';
  return '#16a34a';
});

const toneBg = computed(() => {
  if (tone.value === 'warning') return 'rgba(245, 158, 11, 0.08)';
  if (tone.value === 'info') return 'rgba(37, 99, 235, 0.08)';
  return 'rgba(22, 163, 74, 0.08)';
});

const toneIcon = computed(() => {
  if (tone.value === 'warning') return 'mdi-alert-circle-outline';
  if (tone.value === 'info') return 'mdi-information-outline';
  return 'mdi-check-circle-outline';
});

function closeModal(): void {
  open.value = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

function handleEvent(event: Event): void {
  const custom = event as CustomEvent<SuccessModalPayload>;
  const detail = custom.detail;
  if (!detail?.message) return;

  title.value = detail.title?.trim() || 'Success';
  message.value = detail.message;
  tone.value = detail.tone || 'success';
  open.value = true;

  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    open.value = false;
    timer = null;
  }, 2200);
}

onMounted(() => {
  window.addEventListener(successModalEventName(), handleEvent as EventListener);
});

onBeforeUnmount(() => {
  window.removeEventListener(successModalEventName(), handleEvent as EventListener);
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <v-dialog :model-value="open" max-width="420" persistent content-class="success-modal-wrap">
    <transition name="success-pop">
      <v-card v-if="open" class="success-modal-card">
        <div class="success-accent" :style="{ background: toneColor }" />
        <v-card-text class="success-body" :style="{ backgroundColor: toneBg }">
          <v-icon :color="toneColor" size="46" class="mb-2">{{ toneIcon }}</v-icon>
          <h3 class="text-h5 mb-1">{{ title }}</h3>
          <p class="text-body-1 text-medium-emphasis mb-0">{{ message }}</p>
        </v-card-text>
        <v-card-actions class="justify-center pb-4">
          <v-btn variant="flat" color="primary" class="px-8" @click="closeModal">OK</v-btn>
        </v-card-actions>
      </v-card>
    </transition>
  </v-dialog>
</template>

<style scoped>
.success-modal-card {
  overflow: hidden;
  border-radius: 18px;
  border: 1px solid rgba(34, 93, 186, 0.18);
  box-shadow: 0 18px 42px rgba(25, 68, 138, 0.22);
}

.success-accent {
  height: 6px;
}

.success-body {
  padding: 24px 24px 18px;
  text-align: center;
}

.success-pop-enter-active,
.success-pop-leave-active {
  transition: opacity 220ms ease, transform 220ms ease;
}

.success-pop-enter-from,
.success-pop-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}
</style>

