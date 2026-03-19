<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { fetchNotifications, markAllNotificationsRead, markNotificationRead, type SystemNotification } from '@/services/notifications';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';
import { formatDateTimeWithTimezone, formatRelativeDateTime } from '@/utils/dateTime';

const notificationFilters = ['All Notifications', 'PMED Requests', 'Unread', 'New', 'Other'];
const selectedFilter = ref<string>('All Notifications');
const loading = ref(false);
const errorMessage = ref('');
const items = ref<SystemNotification[]>([]);
const totalUnread = ref(0);
const realtime = useRealtimeListSync();
const timeTick = ref(Date.now());
let timeTimer: ReturnType<typeof setInterval> | null = null;

const filterValue = computed(() => {
  if (selectedFilter.value === 'PMED Requests') return 'pmed_requests';
  if (selectedFilter.value === 'Unread') return 'unread';
  if (selectedFilter.value === 'New') return 'new';
  if (selectedFilter.value === 'Other') return 'other';
  return 'all';
});

function typeColor(item: SystemNotification): string {
  if (item.type.includes('pmed')) return 'secondary';
  if (item.type.includes('failed') || item.type.includes('discrepancy')) return 'error';
  if (item.type.includes('receipt') || item.type.includes('billing')) return 'primary';
  if (item.type.includes('payment')) return 'success';
  return 'warning';
}

function typeIcon(item: SystemNotification): string {
  if (item.type.includes('pmed')) return 'mdi-file-chart-outline';
  if (item.type.includes('failed') || item.type.includes('discrepancy')) return 'mdi-alert-circle-outline';
  if (item.type.includes('receipt')) return 'mdi-receipt-text-check-outline';
  if (item.type.includes('billing')) return 'mdi-file-document-outline';
  if (item.type.includes('payment')) return 'mdi-cash-sync';
  return 'mdi-bell-outline';
}

function formatAbsoluteTime(value: string | null): string {
  void timeTick.value;
  return formatDateTimeWithTimezone(value, { fallback: '--' });
}

function formatLiveRelativeTime(value: string | null): string {
  void timeTick.value;
  return formatRelativeDateTime(value, '--');
}

function formatTypeLabel(item: SystemNotification): string {
  if (item.type === 'pmed_report_request') return 'PMED request';
  return item.type.replace(/_/g, ' ');
}

async function loadNotifications(forceRefresh = false): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const payload = await fetchNotifications(filterValue.value, forceRefresh);
    items.value = payload.items || [];
    totalUnread.value = payload.meta.totalUnread || 0;
  } catch (error) {
    items.value = [];
    totalUnread.value = 0;
    errorMessage.value = error instanceof Error ? error.message : 'Unable to load notifications.';
  } finally {
    loading.value = false;
  }
}

async function handleRead(item: SystemNotification): Promise<void> {
  if (item.isRead) return;
  try {
    const payload = await markNotificationRead(item.id);
    totalUnread.value = payload.unreadCount || 0;
    await loadNotifications(true);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to mark notification as read.';
  }
}

async function handleReadAll(): Promise<void> {
  try {
    const payload = await markAllNotificationsRead();
    totalUnread.value = payload.unreadCount || 0;
    await loadNotifications(true);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to mark all notifications as read.';
  }
}

watch(filterValue, () => {
  void loadNotifications(true);
});

onMounted(() => {
  void loadNotifications(true);
  timeTimer = setInterval(() => {
    timeTick.value = Date.now();
  }, 60 * 1000);
  realtime.startPolling(() => {
    void loadNotifications(true);
  }, 0, { pauseWhenDialogOpen: false });
});

onUnmounted(() => {
  if (timeTimer) clearInterval(timeTimer);
  realtime.stopPolling();
  realtime.invalidatePending();
});
</script>

<template>
  <div class="pa-4">
    <div class="d-flex align-center justify-space-between mb-3 ga-2">
      <h6 class="text-subtitle-1 d-flex align-center ga-2">
        Notifications
        <v-chip color="warning" variant="flat" size="small" class="text-white">{{ totalUnread }}</v-chip>
      </h6>
      <v-btn variant="text" color="primary" size="small" @click="handleReadAll">Mark all read</v-btn>
    </div>
    <v-select :items="notificationFilters" v-model="selectedFilter" color="primary" variant="outlined" density="comfortable" hide-details />
  </div>
  <v-divider />
  <perfect-scrollbar style="height: calc(100vh - 300px); max-height: 650px">
    <div class="pa-4 pt-3">
      <v-alert v-if="errorMessage" type="error" variant="tonal" density="comfortable" class="mb-3">{{ errorMessage }}</v-alert>
      <div v-if="loading" class="py-8 text-center">
        <v-progress-circular indeterminate color="primary" />
      </div>
      <v-list v-else class="py-0" lines="three">
        <v-list-item
          v-for="item in items"
          :key="item.id"
          class="notification-item px-0"
          :class="{ 'notification-item--unread': !item.isRead }"
          @click="handleRead(item)"
        >
          <template #prepend>
            <v-avatar size="40" :color="`light${typeColor(item)}`" variant="flat" class="mr-3">
              <v-icon :icon="typeIcon(item)" :color="typeColor(item)" size="20" />
            </v-avatar>
          </template>

          <div class="d-inline-flex align-center justify-space-between w-100 ga-3">
            <h6 class="text-subtitle-2 font-weight-bold">{{ item.title }}</h6>
            <span class="text-caption text-medium-emphasis">{{ formatLiveRelativeTime(item.createdAt) }}</span>
          </div>

          <p class="text-body-2 text-medium-emphasis mt-1 mb-2">{{ item.message }}</p>
          <div class="text-caption text-medium-emphasis mb-2">{{ formatAbsoluteTime(item.createdAt) }}</div>
          <div class="d-flex align-center flex-wrap ga-2">
            <v-chip size="small" :color="typeColor(item)" variant="tonal">{{ formatTypeLabel(item) }}</v-chip>
            <v-chip v-if="!item.isRead" size="small" color="error" variant="tonal">Unread</v-chip>
            <v-chip v-else size="small" color="success" variant="tonal">Read</v-chip>
          </div>
        </v-list-item>
        <div v-if="!items.length" class="text-body-2 text-medium-emphasis text-center py-10">
          No notifications available for this filter.
        </div>
      </v-list>
    </div>
  </perfect-scrollbar>
  <v-divider />
  <div class="pa-2 text-center">
    <v-btn color="primary" variant="text" @click="loadNotifications(true)">Refresh</v-btn>
  </div>
</template>

<style scoped>
.notification-item {
  padding-block: 12px;
  border-bottom: 1px solid rgba(71, 98, 146, 0.08);
  cursor: pointer;
}

.notification-item--unread {
  background: linear-gradient(90deg, rgba(47, 80, 166, 0.06) 0%, rgba(47, 80, 166, 0) 100%);
}
</style>
