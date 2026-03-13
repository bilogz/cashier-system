<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useRoute } from 'vue-router';
import { fetchAdminProfile, type AdminActivityLog, type AdminProfilePayload, updateAdminProfile } from '@/services/adminProfile';

const authStore = useAuthStore();
const route = useRoute();

const loading = ref(false);
const saving = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const activeTab = ref('recent');

const payload = ref<AdminProfilePayload>({
  profile: {
    fullName: '',
    username: '',
    email: '',
    role: 'admin',
    status: 'active',
    phone: '',
    createdAt: '',
    lastLoginAt: ''
  },
  preferences: {
    emailNotifications: true,
    inAppNotifications: true,
    darkMode: false
  },
  stats: {
    totalLogins: 0,
    status: 'ACTIVE'
  },
  activityLogs: [],
  loginHistory: []
});

const profileForm = ref({
  fullName: '',
  phone: ''
});

const preferencesForm = ref({
  emailNotifications: true,
  inAppNotifications: true,
  darkMode: false
});

const profile = computed(() => payload.value.profile);
const stats = computed(() => payload.value.stats);
const recentActivity = computed(() => payload.value.activityLogs);
const loginHistory = computed(() => payload.value.loginHistory);

const initials = computed(() => {
  const name = profile.value.fullName.trim();
  if (!name) {
    return 'TC';
  }

  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
});

function formatDate(value: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function formatDateTime(value: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function roleLabel(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .toUpperCase();
}

function actionColor(log: AdminActivityLog): string {
  const action = (log.rawAction || '').toUpperCase();
  if (action.includes('LOGIN')) return 'primary';
  if (action.includes('PROFILE')) return 'warning';
  if (action.includes('LOGOUT')) return 'secondary';
  return 'success';
}

function applyPayload(nextPayload: AdminProfilePayload): void {
  payload.value = nextPayload;
  profileForm.value.fullName = nextPayload.profile.fullName;
  profileForm.value.phone = nextPayload.profile.phone;
  preferencesForm.value = {
    emailNotifications: !!nextPayload.preferences.emailNotifications,
    inAppNotifications: !!nextPayload.preferences.inAppNotifications,
    darkMode: !!nextPayload.preferences.darkMode
  };

  if (authStore.user) {
    authStore.user = {
      ...authStore.user,
      fullName: nextPayload.profile.fullName
    };
    localStorage.setItem('user', JSON.stringify(authStore.user));
  }
}

async function loadProfile(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  successMessage.value = '';

  try {
    const nextPayload = await fetchAdminProfile();
    applyPayload(nextPayload);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to load profile page.';
  } finally {
    loading.value = false;
  }
}

async function saveProfile(): Promise<void> {
  saving.value = true;
  errorMessage.value = '';
  successMessage.value = '';

  try {
    const nextPayload = await updateAdminProfile({
      fullName: profileForm.value.fullName.trim(),
      phone: profileForm.value.phone.trim(),
      preferences: preferencesForm.value
    });
    applyPayload(nextPayload);
    successMessage.value = 'Profile updated successfully.';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to update profile.';
  } finally {
    saving.value = false;
  }
}

function resolveInitialTab(): void {
  const tabQuery = String(route.query.tab || '').trim().toLowerCase();
  const tabMap: Record<string, string> = {
    account: 'recent',
    social: 'preferences',
    password: 'security',
    help: 'recent',
    recent: 'recent',
    login: 'login',
    security: 'security',
    preferences: 'preferences'
  };
  activeTab.value = tabMap[tabQuery] || 'recent';
}

onMounted(() => {
  resolveInitialTab();
  loadProfile();
});

watch(
  () => route.query.tab,
  () => {
    resolveInitialTab();
  }
);
</script>

<template>
  <div>
    <div class="text-subtitle-2 text-medium-emphasis mb-2">Dashboard / My Profile</div>
    <h1 class="text-h3 d-flex align-center mb-2">
      <v-icon icon="$accountCircle" color="primary" class="mr-2"></v-icon>
      My Profile
    </h1>
    <p class="text-subtitle-1 text-medium-emphasis mb-6">Manage your account settings and view your activity history.</p>

    <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">{{ errorMessage }}</v-alert>
    <v-alert v-if="successMessage" type="success" variant="tonal" class="mb-4">{{ successMessage }}</v-alert>

    <v-row>
      <v-col cols="12" lg="4">
        <v-card variant="outlined" class="mb-4">
          <v-card-text class="pa-6 text-center">
            <v-avatar size="110" color="primary" class="mb-4">
              <span class="text-h2 text-white">{{ initials }}</span>
            </v-avatar>

            <h3 class="text-h4 mb-1">{{ profileForm.fullName || 'Admin User' }}</h3>
            <div class="text-subtitle-2 text-primary font-weight-bold mb-4">{{ roleLabel(profile.role || 'admin') }}</div>

            <v-divider class="my-4"></v-divider>

            <v-row>
              <v-col cols="6">
                <div class="text-caption text-medium-emphasis">Total Logins</div>
                <div class="text-h5 font-weight-bold">{{ stats.totalLogins }}</div>
              </v-col>
              <v-col cols="6">
                <div class="text-caption text-medium-emphasis">Status</div>
                <v-chip color="success" variant="tonal" size="small">{{ stats.status }}</v-chip>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>

        <v-card variant="outlined">
          <v-card-text class="pa-6">
            <h3 class="text-h5 mb-4">Account Info</h3>

            <v-text-field
              v-model="profileForm.fullName"
              label="Full Name"
              variant="outlined"
              density="comfortable"
              class="mb-2"
              :disabled="loading || saving"
            ></v-text-field>

            <v-text-field
              :model-value="profile.email"
              label="Email Address"
              variant="outlined"
              density="comfortable"
              class="mb-2"
              readonly
            ></v-text-field>

            <v-text-field
              :model-value="profile.username"
              label="Username"
              variant="outlined"
              density="comfortable"
              class="mb-2"
              readonly
            ></v-text-field>

            <v-text-field
              v-model="profileForm.phone"
              label="Phone Number"
              variant="outlined"
              density="comfortable"
              class="mb-2"
              :disabled="loading || saving"
            ></v-text-field>

            <div class="text-caption text-medium-emphasis mb-1">Account Created</div>
            <div class="text-body-2 mb-4">{{ formatDate(profile.createdAt) }}</div>

            <v-btn color="primary" variant="flat" block :loading="saving" :disabled="loading" @click="saveProfile">
              Save Profile
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" lg="8">
        <v-card variant="outlined">
          <v-card-text class="pa-6">
            <v-tabs v-model="activeTab" color="primary">
              <v-tab value="recent">Recent Activity</v-tab>
              <v-tab value="login">Login History</v-tab>
              <v-tab value="security">Security Settings</v-tab>
              <v-tab value="preferences">Preferences</v-tab>
            </v-tabs>

            <v-divider class="mb-4"></v-divider>

            <v-tabs-window v-model="activeTab">
              <v-tabs-window-item value="recent">
                <v-table density="comfortable">
                  <thead>
                    <tr>
                      <th>DATE & TIME</th>
                      <th>ACTION</th>
                      <th>DESCRIPTION</th>
                      <th>IP ADDRESS</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="log in recentActivity" :key="`${log.dateTime}-${log.rawAction}-${log.description}`">
                      <td>{{ formatDateTime(log.dateTime) }}</td>
                      <td>
                        <v-chip :color="actionColor(log)" variant="tonal" size="small">
                          {{ log.action }}
                        </v-chip>
                      </td>
                      <td>{{ log.description }}</td>
                      <td>{{ log.ipAddress || '-' }}</td>
                    </tr>
                    <tr v-if="recentActivity.length === 0">
                      <td colspan="4" class="text-center text-medium-emphasis py-5">No recent activity found.</td>
                    </tr>
                  </tbody>
                </v-table>
              </v-tabs-window-item>

              <v-tabs-window-item value="login">
                <v-table density="comfortable">
                  <thead>
                    <tr>
                      <th>DATE & TIME</th>
                      <th>ACTION</th>
                      <th>DESCRIPTION</th>
                      <th>IP ADDRESS</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="log in loginHistory" :key="`${log.dateTime}-${log.rawAction}-${log.description}`">
                      <td>{{ formatDateTime(log.dateTime) }}</td>
                      <td>
                        <v-chip :color="actionColor(log)" variant="tonal" size="small">
                          {{ log.action }}
                        </v-chip>
                      </td>
                      <td>{{ log.description }}</td>
                      <td>{{ log.ipAddress || '-' }}</td>
                    </tr>
                    <tr v-if="loginHistory.length === 0">
                      <td colspan="4" class="text-center text-medium-emphasis py-5">No login history found.</td>
                    </tr>
                  </tbody>
                </v-table>
              </v-tabs-window-item>

              <v-tabs-window-item value="security">
                <div class="py-2">
                  <div class="text-subtitle-1 font-weight-medium mb-2">Security Overview</div>
                  <v-list density="comfortable">
                    <v-list-item>
                      <v-list-item-title>Role</v-list-item-title>
                      <template v-slot:append>{{ roleLabel(profile.role || 'admin') }}</template>
                    </v-list-item>
                    <v-list-item>
                      <v-list-item-title>Account Status</v-list-item-title>
                      <template v-slot:append>{{ stats.status }}</template>
                    </v-list-item>
                    <v-list-item>
                      <v-list-item-title>Last Login</v-list-item-title>
                      <template v-slot:append>{{ formatDateTime(profile.lastLoginAt) }}</template>
                    </v-list-item>
                  </v-list>
                </div>
              </v-tabs-window-item>

              <v-tabs-window-item value="preferences">
                <div class="py-2">
                  <div class="text-subtitle-1 font-weight-medium mb-4">Notification Preferences</div>
                  <v-switch
                    v-model="preferencesForm.emailNotifications"
                    color="primary"
                    label="Email Notifications"
                    :disabled="loading || saving"
                  ></v-switch>
                  <v-switch
                    v-model="preferencesForm.inAppNotifications"
                    color="primary"
                    label="In-App Notifications"
                    :disabled="loading || saving"
                  ></v-switch>
                  <v-switch
                    v-model="preferencesForm.darkMode"
                    color="primary"
                    label="Dark Mode Preference"
                    :disabled="loading || saving"
                  ></v-switch>

                  <v-btn color="primary" variant="flat" :loading="saving" :disabled="loading" @click="saveProfile">
                    Save Preferences
                  </v-btn>
                </div>
              </v-tabs-window-item>
            </v-tabs-window>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>
