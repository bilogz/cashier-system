<script setup lang="ts">
import { computed } from 'vue';
import {
  mdiAccountCashOutline,
  mdiAlertCircleOutline,
  mdiBankOutline,
  mdiBankTransfer,
  mdiCalendarTodayOutline,
  mdiCalendarWeekOutline,
  mdiCashCheck,
  mdiCashFast,
  mdiChartLine,
  mdiCheckAll,
  mdiCheckDecagramOutline,
  mdiCircleOutline,
  mdiCogOutline,
  mdiCreditCardSettingsOutline,
  mdiCurrencyPhp,
  mdiFileDocumentCheckOutline,
  mdiFileDocumentEditOutline,
  mdiFileSearchOutline,
  mdiFinance,
  mdiFolderFileOutline,
  mdiPauseCircleOutline,
  mdiReceiptTextCheckOutline,
  mdiReceiptTextOutline,
  mdiShieldOutline,
  mdiSwapHorizontalBold,
  mdiTableAccount,
  mdiTimerSand,
  mdiTuneVariant,
  mdiWalletOutline
} from '@mdi/js';

const props = defineProps<{
  title: string;
  value: string;
  subtitle: string;
  icon?: string;
  tone?: 'green' | 'blue' | 'orange' | 'purple';
}>();

const iconMap: Record<string, string> = {
  'mdi-file-search-outline': mdiFileSearchOutline,
  'mdi-alert-circle-outline': mdiAlertCircleOutline,
  'mdi-cash-check': mdiCashCheck,
  'mdi-bank-outline': mdiBankOutline,
  'mdi-table-account': mdiTableAccount,
  'mdi-pencil-ruler-outline': mdiFileDocumentEditOutline,
  'mdi-pause-circle-outline': mdiPauseCircleOutline,
  'mdi-finance': mdiFinance,
  'mdi-cash-fast': mdiCashFast,
  'mdi-check-decagram-outline': mdiCheckDecagramOutline,
  'mdi-timer-sand': mdiTimerSand,
  'mdi-currency-php': mdiCurrencyPhp,
  'mdi-receipt-text-check-outline': mdiReceiptTextCheckOutline,
  'mdi-file-document-check-outline': mdiFileDocumentCheckOutline,
  'mdi-printer-outline': mdiFileDocumentCheckOutline,
  'mdi-folder-file-outline': mdiFolderFileOutline,
  'mdi-swap-horizontal-bold': mdiSwapHorizontalBold,
  'mdi-alert-decagram-outline': mdiAlertCircleOutline,
  'mdi-check-all': mdiCheckAll,
  'mdi-chart-line': mdiChartLine,
  'mdi-calendar-today-outline': mdiCalendarTodayOutline,
  'mdi-calendar-week-outline': mdiCalendarWeekOutline,
  'mdi-account-cash-outline': mdiAccountCashOutline,
  'mdi-tune-variant': mdiTuneVariant,
  'mdi-credit-card-settings-outline': mdiCreditCardSettingsOutline,
  'mdi-receipt-text-cog-outline': mdiReceiptTextOutline,
  'mdi-shield-cog-outline': mdiShieldOutline,
  'mdi-bank-transfer': mdiBankTransfer,
  'mdi-cog-outline': mdiCogOutline,
  'mdi-wallet-outline': mdiWalletOutline
};

const toneClass = computed(() => `analytics-card-${props.tone || 'blue'}`);
const resolvedIcon = computed(() => iconMap[props.icon || ''] || mdiCircleOutline);
</script>

<template>
  <v-card :class="['analytics-card', toneClass]">
    <v-card-text class="pa-4">
      <div class="d-flex justify-space-between align-start ga-4">
        <div class="flex-grow-1">
          <div class="analytics-label">{{ title }}</div>
          <div class="analytics-value mt-3">{{ value }}</div>
          <div class="analytics-subtitle mt-1">{{ subtitle }}</div>
        </div>
        <div class="analytics-icon-wrap">
          <v-icon :icon="resolvedIcon" size="20" color="white" />
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.analytics-card {
  min-height: 108px;
  border-radius: 16px;
  color: #fff;
  box-shadow: 0 12px 24px rgba(19, 45, 126, 0.14);
}

.analytics-card-green {
  background: linear-gradient(135deg, #17a957 0%, #1cb35d 100%);
}

.analytics-card-blue {
  background: linear-gradient(135deg, #4f96e8 0%, #3d7dd2 100%);
}

.analytics-card-orange {
  background: linear-gradient(135deg, #ff9800 0%, #ff7b00 100%);
}

.analytics-card-purple {
  background: linear-gradient(135deg, #9b35f5 0%, #7e22ce 100%);
}

.analytics-label {
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  opacity: 0.98;
}

.analytics-value {
  font-size: 1.75rem;
  line-height: 1;
  font-weight: 900;
}

.analytics-subtitle {
  font-size: 0.9rem;
  line-height: 1.25;
  opacity: 0.95;
}

.analytics-icon-wrap {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: 1.5px solid rgba(255, 255, 255, 0.75);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
</style>
