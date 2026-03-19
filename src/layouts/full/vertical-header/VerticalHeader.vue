<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useCustomizerStore } from '../../../stores/customizer';
import { useAuthStore } from '@/stores/auth';
import { BellIcon, SettingsIcon, SearchIcon, Menu2Icon, CalendarStatsIcon } from 'vue-tabler-icons';
import { fetchNotifications } from '@/services/notifications';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';
import { formatDateTimeWithTimezone } from '@/utils/dateTime';

import NotificationDD from './NotificationDD.vue';
import ProfileDD from './ProfileDD.vue';
import Searchbar from './SearchBarPanel.vue';

const customizer = useCustomizerStore();
const authStore = useAuthStore();
const showSearch = ref(false);
const dateText = ref('');
const unreadNotifications = ref(0);
let dateTimer: ReturnType<typeof setInterval> | null = null;
const realtime = useRealtimeListSync();

function searchbox() {
  showSearch.value = !showSearch.value;
}

const displayName = computed(() => authStore.user?.fullName || authStore.user?.username || 'Admin');
const userInitials = computed(() => {
  const raw = displayName.value.trim();
  if (!raw) return 'AD';
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
});

function updateDate(): void {
  dateText.value = formatDateTimeWithTimezone(new Date(), {
    weekday: 'short',
    year: 'numeric'
  });
}

async function loadUnreadNotifications(forceRefresh = false): Promise<void> {
  try {
    const payload = await fetchNotifications('all', forceRefresh);
    unreadNotifications.value = Number(payload.meta?.totalUnread || 0);
  } catch {
    unreadNotifications.value = 0;
  }
}

onMounted(() => {
  updateDate();
  dateTimer = setInterval(updateDate, 60 * 1000);
  void loadUnreadNotifications(true);
  realtime.startPolling(() => {
    void loadUnreadNotifications(true);
  }, 0, { pauseWhenDialogOpen: false });
});

onBeforeUnmount(() => {
  if (dateTimer) clearInterval(dateTimer);
  realtime.stopPolling();
  realtime.invalidatePending();
});
</script>

<template>
  <v-app-bar elevation="0" height="80">
    <v-btn
      class="hidden-md-and-down text-secondary"
      color="lightsecondary"
      icon
      rounded="sm"
      variant="flat"
      @click.stop="customizer.SET_MINI_SIDEBAR(!customizer.mini_sidebar)"
      size="small"
    >
      <Menu2Icon size="20" stroke-width="1.5" />
    </v-btn>
    <v-btn
      class="hidden-lg-and-up text-secondary ms-3"
      color="lightsecondary"
      icon
      rounded="sm"
      variant="flat"
      @click.stop="customizer.SET_SIDEBAR_DRAWER"
      size="small"
    >
      <Menu2Icon size="20" stroke-width="1.5" />
    </v-btn>

    <v-btn
      class="hidden-lg-and-up text-secondary ml-3"
      color="lightsecondary"
      icon
      rounded="sm"
      variant="flat"
      size="small"
      @click="searchbox"
    >
      <SearchIcon size="17" stroke-width="1.5" />
    </v-btn>

    <v-sheet v-if="showSearch" class="search-sheet v-col-12">
      <Searchbar :closesearch="searchbox" />
    </v-sheet>

    <v-sheet class="mx-3 v-col-3 v-col-xl-2 v-col-lg-4 d-none d-lg-block">
      <Searchbar />
    </v-sheet>

    <div class="d-none d-lg-flex align-center ga-3 topbar-context">
      <div class="system-title-block">
        <div class="system-title-label">System</div>
        <div class="system-title-text">Cashier System</div>
      </div>
      <v-chip color="lightsecondary" variant="flat" size="small" class="text-secondary">
        <CalendarStatsIcon size="14" stroke-width="1.8" class="mr-1" />
        {{ dateText }}
      </v-chip>
    </div>

    <v-spacer />

    <v-menu :close-on-content-click="false">
      <template v-slot:activator="{ props }">
        <div class="notification-trigger mx-3">
          <v-btn icon class="text-secondary" color="lightsecondary" rounded="sm" size="small" variant="flat" v-bind="props">
            <BellIcon stroke-width="1.5" size="22" />
          </v-btn>
          <v-chip v-if="unreadNotifications > 0" size="x-small" color="error" variant="flat" class="notification-badge">
            {{ unreadNotifications > 99 ? '99+' : unreadNotifications }}
          </v-chip>
        </div>
      </template>
      <v-sheet rounded="md" width="330" elevation="12">
        <NotificationDD />
      </v-sheet>
    </v-menu>

    <v-menu :close-on-content-click="false">
      <template v-slot:activator="{ props }">
        <v-btn class="profileBtn text-primary" color="lightprimary" variant="flat" rounded="pill" v-bind="props">
          <v-avatar size="30" class="mr-2 profile-avatar">
            <img v-if="authStore.user?.avatar" :src="authStore.user.avatar" alt="Profile" />
            <span v-else class="profile-initials">{{ userInitials }}</span>
            <span class="online-dot" />
          </v-avatar>
          <SettingsIcon stroke-width="1.5" />
        </v-btn>
      </template>
      <v-sheet rounded="md" width="330" elevation="12">
        <ProfileDD />
      </v-sheet>
    </v-menu>
  </v-app-bar>
</template>

<style scoped>
.profile-avatar {
  position: relative;
  background: linear-gradient(135deg, #2f80ed 0%, #225ac8 100%);
}

.profile-initials {
  color: #ffffff;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.3px;
}

.online-dot {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #16a34a;
  border: 2px solid #ffffff;
}

.topbar-context {
  min-width: 0;
}

.system-title-block {
  min-width: 0;
}

.system-title-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.45px;
  text-transform: uppercase;
  color: rgba(58, 63, 86, 0.58);
}

.system-title-text {
  color: #2f3447;
  font-size: 15px;
  font-weight: 800;
  line-height: 1.2;
}

.notification-trigger {
  position: relative;
}

.notification-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 22px;
  height: 22px;
  padding-inline: 6px;
  justify-content: center;
  box-shadow: 0 8px 16px rgba(220, 38, 38, 0.24);
}
</style>
