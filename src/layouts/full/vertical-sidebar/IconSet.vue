<script setup lang="ts">
import { computed } from 'vue';
import {
  mdiAccountHeartOutline,
  mdiAccountOutline,
  mdiAccountSearchOutline,
  mdiBankTransfer,
  mdiCalendarClockOutline,
  mdiChartLine,
  mdiCircleOutline,
  mdiClipboardTextOutline,
  mdiCogOutline,
  mdiFileChartOutline,
  mdiFileDocumentEditOutline,
  mdiFlaskOutline,
  mdiLogout,
  mdiPill,
  mdiReceiptTextOutline,
  mdiRunFast,
  mdiStethoscope,
  mdiViewDashboardOutline,
  mdiWalletOutline
} from '@mdi/js';

type SidebarItemLike = {
  icon?: unknown;
  title?: string;
};

const props = defineProps<{
  item?: SidebarItemLike | string | object;
  level?: number;
}>();

const mdiPathByName: Record<string, string> = {
  'mdi-view-dashboard-outline': mdiViewDashboardOutline,
  'mdi-account-search-outline': mdiAccountSearchOutline,
  'mdi-file-document-edit-outline': mdiFileDocumentEditOutline,
  'mdi-file-chart-outline': mdiFileChartOutline,
  'mdi-cash-fast': mdiWalletOutline,
  'mdi-receipt-text-outline': mdiReceiptTextOutline,
  'mdi-bank-transfer': mdiBankTransfer,
  'mdi-chart-line': mdiChartLine,
  'mdi-account-outline': mdiAccountOutline,
  'mdi-cog-outline': mdiCogOutline,
  'mdi-logout': mdiLogout,
  'mdi-calendar-clock-outline': mdiCalendarClockOutline,
  'mdi-account-group-outline': mdiAccountOutline,
  'mdi-clipboard-text-outline': mdiClipboardTextOutline,
  'mdi-walk': mdiRunFast,
  'mdi-stethoscope': mdiStethoscope,
  'mdi-flask-outline': mdiFlaskOutline,
  'mdi-pill': mdiPill,
  'mdi-account-heart-outline': mdiAccountHeartOutline,
  'mdi-circle-outline': mdiCircleOutline
};

const iconByTitle: Record<string, string> = {
  dashboard: mdiViewDashboardOutline,
  'student billing verification': mdiAccountSearchOutline,
  'manage student billing': mdiFileDocumentEditOutline,
  'process payment': mdiWalletOutline,
  'generate receipt': mdiReceiptTextOutline,
  'financial transactions': mdiBankTransfer,
  appointments: mdiCalendarClockOutline,
  'patients database': mdiAccountOutline,
  'registration (patient management)': mdiClipboardTextOutline,
  'walk-in': mdiRunFast,
  'check-up': mdiStethoscope,
  laboratory: mdiFlaskOutline,
  'pharmacy & inventory': mdiPill,
  'mental health & addiction': mdiAccountHeartOutline,
  reports: mdiChartLine,
  'my profile': mdiAccountOutline,
  settings: mdiCogOutline,
  logout: mdiLogout
};

const resolved = computed(() => {
  const raw = props.item;

  if (typeof raw === 'string') {
    return mdiPathByName[raw] || raw;
  }

  if (raw && typeof raw === 'object') {
    const candidate = raw as SidebarItemLike;

    if (typeof candidate.icon === 'string') {
      return mdiPathByName[candidate.icon] || candidate.icon;
    }

    if (candidate.icon) {
      return candidate.icon;
    }

    return iconByTitle[String(candidate.title || '').trim().toLowerCase()] || mdiCircleOutline;
  }

  return mdiCircleOutline;
});
</script>

<template>
  <v-icon :icon="resolved as string" :size="(props.level || 0) > 0 ? 14 : 20" class="iconClass" />
</template>
