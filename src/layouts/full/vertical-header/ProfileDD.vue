<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import {
  LockIcon,
  LogoutIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
  HelpIcon,
  PaletteIcon
} from 'vue-tabler-icons';

const authStore = useAuthStore();
const router = useRouter();

const menuSearch = ref('');
const showLogoutConfirm = ref(false);
const logoutLoading = ref(false);

const menuItems = [
  { label: 'Account Settings', icon: SettingsIcon, action: () => router.push('/profile?tab=account') },
  { label: 'Social Profile', icon: UserIcon, action: () => router.push('/profile?tab=social') },
  { label: 'Security & Login Activity', icon: LockIcon, action: () => router.push('/profile?tab=security') },
  { label: 'Change Password', icon: LockIcon, action: () => router.push('/profile?tab=password') },
  { label: 'Preferences', icon: PaletteIcon, action: () => router.push('/profile?tab=preferences') },
  { label: 'Help / Support', icon: HelpIcon, action: () => router.push('/profile?tab=help') }
];

const filteredMenuItems = computed(() => {
  const q = menuSearch.value.trim().toLowerCase();
  if (!q) {
    return menuItems;
  }
  return menuItems.filter((item) => item.label.toLowerCase().includes(q));
});

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 18) return 'Good Afternoon';
  return 'Good Evening';
});

const displayName = computed(() => authStore.user?.fullName || authStore.user?.username || 'Admin User');
const displayRole = computed(() => authStore.user?.role || 'Administrator');
const unreadCount = computed(() => Number(authStore.user?.unreadNotifications || 0));

const userInitials = computed(() => {
  const raw = displayName.value.trim();
  if (!raw) return 'AD';
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
});

function closeAllMenusOnEsc(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    showLogoutConfirm.value = false;
  }
}

function handleLogoutClick(): void {
  showLogoutConfirm.value = true;
}

async function confirmLogout(): Promise<void> {
  showLogoutConfirm.value = false;
  logoutLoading.value = true;
  try {
    await authStore.logout();
  } finally {
    logoutLoading.value = false;
  }
}

onMounted(() => {
  window.addEventListener('keydown', closeAllMenusOnEsc);
});

onUnmounted(() => {
  window.removeEventListener('keydown', closeAllMenusOnEsc);
});
</script>

<template>
  <div class="pa-4">
    <div class="d-flex align-center justify-space-between">
      <div>
        <h4 class="mb-n1">{{ greeting }}, <span class="font-weight-regular">{{ displayName }}</span></h4>
        <span class="text-subtitle-2 text-medium-emphasis">{{ displayRole }}</span>
      </div>
      <div class="d-flex align-center ga-2">
        <v-avatar size="34" color="primary" variant="flat">
          <img v-if="authStore.user?.avatar" :src="authStore.user.avatar" alt="Avatar" />
          <span v-else class="text-caption text-white font-weight-bold">{{ userInitials }}</span>
        </v-avatar>
        <v-chip v-if="unreadCount > 0" size="small" color="error" variant="flat">{{ unreadCount }}</v-chip>
      </div>
    </div>

    <v-text-field
      v-model="menuSearch"
      persistent-placeholder
      placeholder="Search menu"
      class="my-3"
      color="primary"
      variant="outlined"
      hide-details
    >
      <template v-slot:prepend-inner>
        <SearchIcon stroke-width="1.5" size="20" class="text-lightText SearchIcon" />
      </template>
    </v-text-field>

    <perfect-scrollbar style="height: calc(100vh - 300px); max-height: 515px">
      <v-divider></v-divider>

      <v-list class="mt-3">
        <v-list-item
          v-for="item in filteredMenuItems"
          :key="item.label"
          color="secondary"
          rounded="md"
          @click="item.action()"
        >
          <template v-slot:prepend>
            <component :is="item.icon" size="20" class="mr-2" />
          </template>
          <v-list-item-title class="text-subtitle-2">{{ item.label }}</v-list-item-title>
        </v-list-item>

        <v-divider class="my-2"></v-divider>

        <v-list-item color="secondary" rounded="md" @click="handleLogoutClick">
          <template v-slot:prepend>
            <LogoutIcon size="20" class="mr-2" />
          </template>
          <v-list-item-title class="text-subtitle-2">Logout</v-list-item-title>
        </v-list-item>
      </v-list>
    </perfect-scrollbar>

    <v-dialog v-model="showLogoutConfirm" max-width="420">
      <v-card>
        <v-card-title class="text-h5">Confirm Logout</v-card-title>
        <v-card-text>Are you sure you want to log out of your admin session?</v-card-text>
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="showLogoutConfirm = false">Cancel</v-btn>
          <v-btn color="error" variant="flat" @click="confirmLogout">Logout</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="logoutLoading" persistent max-width="360">
      <v-card class="pa-6 text-center logout-loading-card">
        <v-progress-circular indeterminate color="error" size="48" width="4" class="mb-4" />
        <div class="text-h6 mb-1">Signing Out</div>
        <div class="text-body-2 text-medium-emphasis">Closing your session securely...</div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.logout-loading-card {
  border: 1px solid rgba(219, 62, 62, 0.22);
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff 0%, #fff6f6 100%);
}
</style>
