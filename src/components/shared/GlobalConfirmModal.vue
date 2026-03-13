<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  cancelAllConfirmModals,
  confirmModalEventName,
  resolveConfirmModal,
  type ConfirmModalRequest
} from '@/composables/useConfirmModal';

type OpenPayload = ConfirmModalRequest & { id: number };

const open = ref(false);
const activeId = ref<number | null>(null);
const title = ref('Confirm Action');
const message = ref('');
const confirmText = ref('Confirm');
const cancelText = ref('Cancel');
const tone = ref<'primary' | 'warning' | 'danger'>('primary');

const toneColor = computed(() => {
  if (tone.value === 'danger') return 'error';
  if (tone.value === 'warning') return 'warning';
  return 'primary';
});

function closeWith(result: boolean): void {
  const id = activeId.value;
  open.value = false;
  activeId.value = null;
  if (id != null) {
    resolveConfirmModal(id, result);
  }
}

function handleOpen(event: Event): void {
  const custom = event as CustomEvent<OpenPayload>;
  const detail = custom.detail;
  if (!detail?.id || !detail.message) return;
  activeId.value = detail.id;
  title.value = detail.title || 'Confirm Action';
  message.value = detail.message;
  confirmText.value = detail.confirmText || 'Confirm';
  cancelText.value = detail.cancelText || 'Cancel';
  tone.value = detail.tone || 'primary';
  open.value = true;
}

onMounted(() => {
  window.addEventListener(confirmModalEventName(), handleOpen as EventListener);
});

onBeforeUnmount(() => {
  window.removeEventListener(confirmModalEventName(), handleOpen as EventListener);
  cancelAllConfirmModals();
});
</script>

<template>
  <v-dialog :model-value="open" max-width="460" persistent content-class="global-confirm-wrap">
    <transition name="confirm-pop">
      <v-card v-if="open" class="confirm-card">
        <v-card-text class="pa-6 text-center">
          <v-icon :color="toneColor" size="44" class="mb-2">
            {{ tone === 'danger' ? 'mdi-alert-octagon-outline' : tone === 'warning' ? 'mdi-alert-circle-outline' : 'mdi-help-circle-outline' }}
          </v-icon>
          <div class="text-h5 mb-2">{{ title }}</div>
          <div class="text-body-1 text-medium-emphasis">{{ message }}</div>
        </v-card-text>
        <v-card-actions class="justify-center pb-5 pt-0 ga-2">
          <v-btn variant="outlined" color="secondary" min-width="120" @click="closeWith(false)">{{ cancelText }}</v-btn>
          <v-btn variant="flat" :color="toneColor" min-width="120" @click="closeWith(true)">{{ confirmText }}</v-btn>
        </v-card-actions>
      </v-card>
    </transition>
  </v-dialog>
</template>

<style scoped>
.confirm-card {
  border-radius: 16px;
  border: 1px solid rgba(33, 97, 188, 0.2);
  box-shadow: 0 18px 40px rgba(14, 48, 113, 0.2);
  background: linear-gradient(180deg, #ffffff 0%, #f7fbff 100%);
}

.confirm-pop-enter-active,
.confirm-pop-leave-active {
  transition: opacity 200ms ease, transform 220ms ease;
}

.confirm-pop-enter-from,
.confirm-pop-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}
</style>

