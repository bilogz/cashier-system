<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    icon: string;
    color?: string;
    variant?: 'flat' | 'outlined' | 'tonal' | 'text';
    compact?: boolean;
  }>(),
  {
    color: 'primary',
    variant: 'flat',
    compact: false
  }
);
</script>

<template>
  <v-btn
    :color="color"
    :variant="variant"
    :class="['cashier-action-btn', { 'cashier-action-btn--compact': compact }]"
    rounded="xl"
    v-bind="$attrs"
  >
    <span class="cashier-action-btn__content">
      <span class="cashier-action-btn__icon-shell">
        <v-icon :icon="icon" size="18" />
      </span>
      <span class="cashier-action-btn__label">{{ label }}</span>
    </span>
  </v-btn>
</template>

<style scoped>
.cashier-action-btn {
  justify-content: flex-start;
  min-height: 46px;
  padding-inline: 10px 16px;
  letter-spacing: 0.01em;
  font-weight: 700;
  text-transform: none;
  box-shadow: 0 12px 22px rgba(15, 23, 42, 0.08);
}

.cashier-action-btn--compact {
  min-height: 36px;
  padding-inline: 8px 12px;
  box-shadow: none;
}

.cashier-action-btn__content {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
}

.cashier-action-btn__icon-shell {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: inline-grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.28);
  flex-shrink: 0;
}

.cashier-action-btn--compact .cashier-action-btn__icon-shell {
  width: 24px;
  height: 24px;
}

.cashier-action-btn__label {
  white-space: normal;
  line-height: 1.15;
  text-align: left;
}

.cashier-action-btn:deep(.v-btn__content) {
  width: 100%;
}

.cashier-action-btn:deep(.v-btn__overlay) {
  opacity: 0.06;
}

.cashier-action-btn:deep(.v-icon) {
  opacity: 1;
}
</style>
