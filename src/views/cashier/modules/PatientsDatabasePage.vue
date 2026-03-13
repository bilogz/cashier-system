<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { fetchPatientsSnapshot, syncPatientsProfiles, type PatientRecord } from '@/services/patientsDatabase';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';
import { REALTIME_POLICY } from '@/config/realtimePolicy';
import { emitSuccessModal } from '@/composables/useSuccessModal';

const loading = ref(true);
const syncing = ref(false);
const drawer = ref(false);
const selected = ref<PatientRecord | null>(null);

const search = ref('');
const moduleFilter = ref('all');
const page = ref(1);
const perPage = ref(10);

const records = ref<PatientRecord[]>([]);
const analytics = ref({ total_patients: 0, high_risk: 0, active_profiles: 0, active_30_days: 0 });
const meta = ref({ page: 1, perPage: 10, total: 0, totalPages: 1 });

const toast = reactive({ open: false, text: '', color: 'info' as 'success' | 'info' | 'warning' | 'error' });
const realtime = useRealtimeListSync();

const filters = [
  { title: 'All Modules', value: 'all' },
  { title: 'Appointments', value: 'appointments' },
  { title: 'Walk-In', value: 'walkin' },
  { title: 'Check-Up', value: 'checkup' },
  { title: 'Mental Health', value: 'mental' },
  { title: 'Pharmacy', value: 'pharmacy' }
];

const totalText = computed(() => {
  if (!meta.value.total) return 'Showing 0-0 of 0 patients';
  const start = (meta.value.page - 1) * meta.value.perPage + 1;
  const end = Math.min(meta.value.page * meta.value.perPage, meta.value.total);
  return `Showing ${start}-${end} of ${meta.value.total} patients`;
});

function showToast(text: string, color: 'success' | 'info' | 'warning' | 'error' = 'info'): void {
  if (color === 'success') {
    emitSuccessModal({ title: 'Success', message: text, tone: 'success' });
    return;
  }
  toast.text = text;
  toast.color = color;
  toast.open = true;
}

function riskColor(risk: string): string {
  if (risk === 'high') return 'error';
  if (risk === 'medium') return 'warning';
  return 'success';
}

function formatDate(value: string | null): string {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function moduleCount(record: PatientRecord): number {
  return record.appointment_count + record.walkin_count + record.checkup_count + record.mental_count + record.pharmacy_count;
}

function openProfile(record: PatientRecord): void {
  selected.value = record;
  drawer.value = true;
}

async function load(options: { silent?: boolean } = {}): Promise<void> {
  const requestId = ++lastRequestId;
  if (!options.silent) loading.value = true;
  try {
    const snapshot = await fetchPatientsSnapshot({
      search: search.value.trim(),
      module: moduleFilter.value,
      page: page.value,
      perPage: perPage.value
    });
    if (requestId !== lastRequestId) return;
    records.value = snapshot.items;
    analytics.value = snapshot.analytics;
    meta.value = snapshot.meta;
  } catch (error) {
    if (!options.silent) {
      showToast(error instanceof Error ? error.message : String(error), 'error');
    }
  } finally {
    if (requestId === lastRequestId && !options.silent) loading.value = false;
  }
}

let lastRequestId = 0;

let timer: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    page.value = 1;
    void load();
  }, REALTIME_POLICY.debounce.patientsSearchMs);
});

watch([moduleFilter, page, perPage], () => {
  void load();
});

async function syncNow(): Promise<void> {
  syncing.value = true;
  try {
    await syncPatientsProfiles();
    await load();
    showToast('Patients database synced from clinic modules.', 'success');
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    syncing.value = false;
  }
}

onMounted(async () => {
  try {
    await load();
    realtime.startPolling(() => {
      void load({ silent: true });
    }, REALTIME_POLICY.polling.patientsMs);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  }
});

onUnmounted(() => {
  realtime.stopPolling();
  realtime.invalidatePending();
});
</script>

<template>
  <div class="patients-db-page">
    <v-card class="hero-card" variant="outlined">
      <v-card-text class="d-flex justify-space-between align-center flex-wrap ga-3">
        <div>
          <h1 class="text-h4 font-weight-black mb-1">Patients Database</h1>
          <p class="text-medium-emphasis mb-0">Centralized patient profiles synced across Appointments, Walk-In, Check-Up, Mental Health, and Pharmacy.</p>
        </div>
      </v-card-text>
    </v-card>

    <v-row>
      <v-col cols="12" sm="6" md="3"><v-card class="metric-card metric-total" elevation="0"><v-card-text><div class="metric-label">Total Patients</div><div class="metric-value">{{ analytics.total_patients }}</div></v-card-text></v-card></v-col>
      <v-col cols="12" sm="6" md="3"><v-card class="metric-card metric-risk" elevation="0"><v-card-text><div class="metric-label">High Risk</div><div class="metric-value">{{ analytics.high_risk }}</div></v-card-text></v-card></v-col>
      <v-col cols="12" sm="6" md="3"><v-card class="metric-card metric-active" elevation="0"><v-card-text><div class="metric-label">Active Profiles</div><div class="metric-value">{{ analytics.active_profiles }}</div></v-card-text></v-card></v-col>
      <v-col cols="12" sm="6" md="3"><v-card class="metric-card metric-recent" elevation="0"><v-card-text><div class="metric-label">Seen (30 days)</div><div class="metric-value">{{ analytics.active_30_days }}</div></v-card-text></v-card></v-col>
    </v-row>

    <v-card class="surface-card" variant="outlined">
      <v-card-item>
        <v-card-title>Patient Registry</v-card-title>
        <template #append>
          <div class="d-flex ga-2 align-center flex-wrap">
            <v-btn class="saas-btn saas-btn-ghost" prepend-icon="mdi-refresh" :loading="loading" @click="load">Refresh</v-btn>
            <v-btn class="saas-btn saas-btn-primary" prepend-icon="mdi-sync" :loading="syncing" @click="syncNow">Sync Modules</v-btn>
          </div>
        </template>
      </v-card-item>
      <v-divider />
      <v-card-text>
        <v-row class="mb-2">
          <v-col cols="12" md="6"><v-text-field v-model="search" prepend-inner-icon="mdi-magnify" label="Search patient, code, contact" density="comfortable" variant="outlined" hide-details /></v-col>
          <v-col cols="12" md="3"><v-select v-model="moduleFilter" :items="filters" label="Module" density="comfortable" variant="outlined" hide-details /></v-col>
          <v-col cols="12" md="3"><v-select v-model="perPage" :items="[10,20,30,50]" label="Rows" density="comfortable" variant="outlined" hide-details /></v-col>
        </v-row>

        <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />
        <v-table density="comfortable">
          <thead>
            <tr>
              <th>PATIENT</th>
              <th>CODE</th>
              <th>CONTACT</th>
              <th>RISK</th>
              <th>STATUS</th>
              <th>MODULE LOAD</th>
              <th>LAST SEEN</th>
              <th class="text-right">ACTION</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in records" :key="item.id" class="db-row">
              <td>
                <div class="font-weight-bold">{{ item.patient_name }}</div>
                <div class="text-caption text-medium-emphasis">{{ item.sex || '--' }} | age {{ item.age ?? '--' }}</div>
              </td>
              <td>{{ item.patient_code }}</td>
              <td>{{ item.contact || item.email || '--' }}</td>
              <td><v-chip size="small" :color="riskColor(item.risk_level)" variant="tonal">{{ item.risk_level }}</v-chip></td>
              <td>{{ item.latest_status }}</td>
              <td>{{ moduleCount(item) }}</td>
              <td>{{ formatDate(item.last_seen_at) }}</td>
              <td class="text-right"><v-btn size="small" class="saas-btn saas-btn-primary" @click="openProfile(item)">Open Profile</v-btn></td>
            </tr>
            <tr v-if="!loading && !records.length"><td colspan="8" class="text-center text-medium-emphasis py-6">No patient profiles found for current filters.</td></tr>
          </tbody>
        </v-table>

        <div class="d-flex align-center mt-3 text-caption text-medium-emphasis">
          <span>{{ totalText }}</span>
          <v-spacer />
          <v-pagination v-model="page" :length="meta.totalPages" density="comfortable" total-visible="7" />
        </div>
      </v-card-text>
    </v-card>

    <ModuleActivityLogs module="patients" title="Module Activity Logs" :per-page="8" />

    <v-navigation-drawer v-model="drawer" location="right" temporary width="460">
      <v-card v-if="selected" flat>
        <v-card-item>
          <v-card-title>{{ selected.patient_name }}</v-card-title>
          <v-card-subtitle>{{ selected.patient_code }}</v-card-subtitle>
        </v-card-item>
        <v-divider />
        <v-card-text>
          <div class="summary-pair"><span>Risk</span><v-chip size="small" :color="riskColor(selected.risk_level)" variant="tonal">{{ selected.risk_level }}</v-chip></div>
          <div class="summary-pair"><span>Latest Status</span><strong>{{ selected.latest_status }}</strong></div>
          <div class="summary-pair"><span>Contact</span><strong>{{ selected.contact || '--' }}</strong></div>
          <div class="summary-pair"><span>Email</span><strong>{{ selected.email || '--' }}</strong></div>
          <div class="summary-pair"><span>Emergency</span><strong>{{ selected.emergency_contact || '--' }}</strong></div>
          <div class="summary-pair"><span>Guardian</span><strong>{{ selected.guardian_contact || '--' }}</strong></div>
          <div class="summary-pair"><span>Last Seen</span><strong>{{ formatDate(selected.last_seen_at) }}</strong></div>
          <v-divider class="my-3" />
          <div class="text-subtitle-2 font-weight-bold mb-2">Module Activity</div>
          <div class="summary-pair"><span>Appointments</span><strong>{{ selected.appointment_count }}</strong></div>
          <div class="summary-pair"><span>Walk-In</span><strong>{{ selected.walkin_count }}</strong></div>
          <div class="summary-pair"><span>Check-Up</span><strong>{{ selected.checkup_count }}</strong></div>
          <div class="summary-pair"><span>Mental Health</span><strong>{{ selected.mental_count }}</strong></div>
          <div class="summary-pair"><span>Pharmacy</span><strong>{{ selected.pharmacy_count }}</strong></div>
        </v-card-text>
      </v-card>
    </v-navigation-drawer>

    <v-snackbar v-model="toast.open" :color="toast.color" timeout="2800">{{ toast.text }}</v-snackbar>
  </div>
</template>

<style scoped>
.patients-db-page { display: grid; gap: 16px; }
.hero-card { border-radius: 18px; border-color: #d7e4ff !important; background: linear-gradient(120deg, #f4f8ff 0%, #eef4ff 45%, #f8faff 100%); box-shadow: 0 10px 28px rgba(37, 99, 235, 0.08); }
.surface-card { border-radius: 16px; border-color: #dbe4f2 !important; background: #fbfdff; }
.metric-card { border-radius: 12px; color: #fff; box-shadow: 0 10px 18px rgba(16, 24, 40, 0.18); }
.metric-total { background: linear-gradient(135deg, #2f80ed 0%, #0f5ec2 100%); }
.metric-risk { background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); }
.metric-active { background: linear-gradient(135deg, #22c55e 0%, #15803d 100%); }
.metric-recent { background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); }
.metric-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 700; }
.metric-value { font-size: 30px; font-weight: 800; line-height: 1.1; }
.saas-btn { border-radius: 10px !important; text-transform: none !important; font-weight: 700 !important; min-height: 36px !important; }
.saas-btn-primary { background: linear-gradient(135deg, #2f80ed 0%, #225ac8 100%) !important; color: #fff !important; }
.saas-btn-ghost { background: #f5f8ff !important; color: #30558f !important; border: 1px solid rgba(54, 86, 143, 0.24) !important; }
.db-row { transition: background 160ms ease; }
.db-row:hover { background: rgba(55, 123, 229, 0.08); }
.summary-pair { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; }
.summary-pair span { color: #64748b; font-size: 13px; }
</style>
