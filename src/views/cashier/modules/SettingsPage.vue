<script setup lang="ts">
import { ref } from 'vue';
import { mdiBackupRestore, mdiBellCogOutline, mdiContentSaveOutline } from '@mdi/js';
import CashierAnalyticsCard from '@/components/shared/CashierAnalyticsCard.vue';
import CashierActionButton from '@/components/shared/CashierActionButton.vue';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';

const settingsCards = [
  { title: 'Cashier Preferences', value: 'Live Preview', subtitle: 'Static UI controls for dashboard density, alerts, and display options.', icon: 'mdi-tune-variant', tone: 'green' as const },
  { title: 'Payment Methods', value: '4 Channels', subtitle: 'Preview supported channels and cashier collection options.', icon: 'mdi-credit-card-settings-outline', tone: 'blue' as const },
  { title: 'Receipt Rules', value: '12 Policies', subtitle: 'Static receipt numbering, footer text, and archive preferences.', icon: 'mdi-receipt-text-cog-outline', tone: 'orange' as const },
  { title: 'Security Access', value: 'Secure', subtitle: 'Role visibility, confirmation prompts, and session handling preview.', icon: 'mdi-shield-cog-outline', tone: 'purple' as const }
];

const alertDialogs = ref<'save' | 'reset' | 'notify' | null>(null);
const snackbar = ref(false);
const snackbarMessage = ref('');

const toggleItems = ref([
  { title: 'Email notifications', subtitle: 'Receive cashier activity summaries', enabled: true },
  { title: 'Payment confirmation modal', subtitle: 'Prompt before posting a transaction', enabled: true },
  { title: 'Receipt release reminder', subtitle: 'Show alerts for unreleased receipts', enabled: true },
  { title: 'Compact dashboard cards', subtitle: 'Use a denser cashier dashboard layout', enabled: false }
]);

const systemNotes = [
  { title: 'Settings snapshot saved', detail: 'Static configuration preview is ready for capstone demo.', time: '9 mins ago' },
  { title: 'Receipt policy checked', detail: 'Receipt numbering and archive options were reviewed.', time: '33 mins ago' },
  { title: 'Session controls updated', detail: 'Cashier session reminder settings are enabled in the preview.', time: '1 hr ago' }
];

function openDialog(type: 'save' | 'reset' | 'notify') {
  alertDialogs.value = type;
}

function dialogTitle() {
  if (alertDialogs.value === 'save') return 'Save Settings';
  if (alertDialogs.value === 'reset') return 'Reset Settings';
  if (alertDialogs.value === 'notify') return 'Send Settings Notice';
  return '';
}

function dialogMessage() {
  if (alertDialogs.value === 'save') return 'Save these static cashier settings changes to the preview dashboard?';
  if (alertDialogs.value === 'reset') return 'Reset all cashier settings cards back to their default static values?';
  if (alertDialogs.value === 'notify') return 'Send a static configuration update notice to the cashier team?';
  return '';
}

function applyDialogAction() {
  if (alertDialogs.value === 'save') {
    snackbarMessage.value = 'Cashier settings preview saved successfully.';
  } else if (alertDialogs.value === 'reset') {
    snackbarMessage.value = 'Cashier settings were reset to default preview values.';
  } else {
    snackbarMessage.value = 'Static configuration notice prepared for the cashier team.';
  }

  alertDialogs.value = null;
  snackbar.value = true;
}
</script>

<template>
  <v-row>
    <v-col cols="12">
      <v-card class="hero-banner" elevation="0">
        <v-card-text class="pa-6">
          <div class="d-flex flex-column flex-lg-row justify-space-between ga-4">
            <div>
              <div class="hero-kicker">Settings Endpoint</div>
              <h1 class="text-h4 font-weight-black mb-2">Settings</h1>
              <p class="hero-subtitle mb-0">
                Static cashier system settings page for configuration previews, notification preferences, and workflow controls.
              </p>
            </div>
            <div class="hero-side-panel">
              <div class="hero-side-label">Config Flow</div>
              <div class="text-h6 font-weight-bold">Review -> Save -> Apply</div>
              <div class="text-body-2">Matches the same cashier SaaS style as the rest of the modules.</div>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col v-for="card in settingsCards" :key="card.title" cols="12" sm="6" lg="3">
      <CashierAnalyticsCard :title="card.title" :value="card.value" :subtitle="card.subtitle" :icon="card.icon" :tone="card.tone" />
    </v-col>

    <v-col cols="12" lg="8">
      <v-card class="panel-card" variant="outlined">
        <v-card-item>
          <v-card-title>Cashier Preferences</v-card-title>
          <v-card-subtitle>Static toggle controls and confirmation actions.</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div class="settings-list">
            <div v-for="item in toggleItems" :key="item.title" class="setting-row">
              <div>
                <div class="font-weight-bold">{{ item.title }}</div>
                <div class="text-body-2 text-medium-emphasis">{{ item.subtitle }}</div>
              </div>
              <v-switch v-model="item.enabled" color="primary" hide-details inset />
            </div>
          </div>

          <div class="settings-actions mt-6">
            <CashierActionButton :icon="mdiContentSaveOutline" label="Save Settings" color="primary" @click="openDialog('save')" />
            <CashierActionButton :icon="mdiBackupRestore" label="Reset" color="warning" variant="outlined" @click="openDialog('reset')" />
            <CashierActionButton :icon="mdiBellCogOutline" label="Notify Team" color="secondary" variant="tonal" @click="openDialog('notify')" />
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="4">
      <v-card class="panel-card" variant="outlined">
        <v-card-item>
          <v-card-title>System Notes</v-card-title>
          <v-card-subtitle>Static settings notifications</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div v-for="item in systemNotes" :key="item.title" class="alert-card">
            <div class="d-flex align-center justify-space-between ga-3 mb-1">
              <div class="font-weight-bold">{{ item.title }}</div>
              <v-chip size="x-small" color="primary" variant="tonal">{{ item.time }}</v-chip>
            </div>
            <div class="text-body-2 text-medium-emphasis">{{ item.detail }}</div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12">
      <ModuleActivityLogs module="settings" title="Settings Activity Logs" :per-page="6" />
    </v-col>

    <v-dialog :model-value="Boolean(alertDialogs)" max-width="480" @update:model-value="alertDialogs = $event ? alertDialogs : null">
      <v-card class="confirm-dialog">
        <v-card-title class="text-h6 font-weight-bold">{{ dialogTitle() }}</v-card-title>
        <v-card-text>{{ dialogMessage() }}</v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn variant="text" prepend-icon="mdi-close-circle-outline" @click="alertDialogs = null">Cancel</v-btn>
          <v-btn color="primary" prepend-icon="mdi-check-circle-outline" @click="applyDialogAction">Proceed</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" color="primary" location="top right" :timeout="2600">
      {{ snackbarMessage }}
    </v-snackbar>
  </v-row>
</template>

<style scoped>
.hero-banner {
  border-radius: 18px;
  color: #fff;
  background: linear-gradient(125deg, #163066 0%, #25549d 52%, #5ba6dc 100%);
  box-shadow: 0 18px 36px rgba(20, 50, 115, 0.18);
}

.hero-kicker {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 999px;
  margin-bottom: 12px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.26);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 12px;
  font-weight: 800;
}

.hero-subtitle {
  max-width: 760px;
  color: rgba(255, 255, 255, 0.92);
}

.hero-side-panel {
  min-width: 260px;
  padding: 18px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
}

.hero-side-label,
.metric-label {
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #73809b;
  font-weight: 700;
}

.metric-card,
.panel-card {
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.05);
}

.metric-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: #f4ede4;
  color: #1f4ea1;
}

.settings-list {
  display: grid;
  gap: 14px;
}

.setting-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  padding: 16px;
  border-radius: 16px;
  background: linear-gradient(180deg, #fff 0%, #fbf7f1 100%);
  border: 1px solid rgba(189, 157, 120, 0.18);
}

.settings-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.alert-card {
  padding: 14px;
  border-radius: 14px;
  background: #fbf7f1;
  border: 1px solid rgba(189, 157, 120, 0.15);
}

.alert-card + .alert-card {
  margin-top: 12px;
}

.confirm-dialog {
  border-radius: 20px;
}

@media (max-width: 640px) {
  .setting-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
