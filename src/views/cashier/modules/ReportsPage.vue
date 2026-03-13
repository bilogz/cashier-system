<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import SaasDateTimePickerField from '@/components/shared/SaasDateTimePickerField.vue';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';
import { fetchReportsSnapshot, type ReportsActivityRow, type ReportsModuleTotal, type ReportsSnapshot, type ReportsTrendRow } from '@/services/reports';
import { REALTIME_POLICY } from '@/config/realtimePolicy';
import { emitSuccessModal } from '@/composables/useSuccessModal';

const loading = ref(true);
const fromDate = ref('');
const toDate = ref('');
const snapshot = ref<ReportsSnapshot | null>(null);
const moduleTotals = ref<ReportsModuleTotal[]>([]);
const trend = ref<ReportsTrendRow[]>([]);
const activity = ref<ReportsActivityRow[]>([]);
const toast = reactive({ open: false, text: '', color: 'info' as 'success' | 'info' | 'warning' | 'error' });
const realtime = useRealtimeListSync();

let lastRequestId = 0;

const kpiCards = computed(() => {
  const base = snapshot.value?.kpis;
  return [
    { title: 'Total Patients', value: base?.totalPatients ?? 0, subtitle: 'Unified patient registry', className: 'metric-blue' },
    { title: 'Total Visits', value: base?.totalVisits ?? 0, subtitle: 'Cross-module traffic', className: 'metric-indigo' },
    { title: 'Pending Queue', value: base?.pendingQueue ?? 0, subtitle: 'Needs action', className: 'metric-amber' },
    { title: 'Emergency Cases', value: base?.emergencyCases ?? 0, subtitle: 'Escalated priority', className: 'metric-red' },
    { title: 'Active Profiles', value: base?.activeProfiles ?? 0, subtitle: 'With module activity', className: 'metric-green' },
    { title: 'High Risk', value: base?.highRiskPatients ?? 0, subtitle: 'Clinical monitoring', className: 'metric-orange' },
    { title: 'Dispensed Items', value: base?.dispensedItems ?? 0, subtitle: 'Pharmacy output', className: 'metric-cyan' }
  ];
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

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function totalTrendRow(row: ReportsTrendRow): number {
  return row.appointments + row.walkin + row.checkup + row.mental + row.pharmacy;
}

async function load(options: { silent?: boolean } = {}): Promise<void> {
  const requestId = ++lastRequestId;
  if (!options.silent) loading.value = true;
  try {
    const data = await fetchReportsSnapshot({
      from: fromDate.value || undefined,
      to: toDate.value || undefined
    });
    if (requestId !== lastRequestId) return;
    snapshot.value = data;
    moduleTotals.value = data.moduleTotals;
    trend.value = data.dailyTrend;
    activity.value = data.recentActivity;
    if (!fromDate.value) fromDate.value = data.window.from;
    if (!toDate.value) toDate.value = data.window.to;
  } catch (error) {
    if (!options.silent) {
      showToast(error instanceof Error ? error.message : String(error), 'error');
    }
  } finally {
    if (requestId === lastRequestId && !options.silent) loading.value = false;
  }
}

onMounted(async () => {
  await load();
  realtime.startPolling(() => {
    void load({ silent: true });
  }, REALTIME_POLICY.polling.reportsMs);
});

onUnmounted(() => {
  realtime.stopPolling();
  realtime.invalidatePending();
});
</script>

<template>
  <div class="reports-page">
    <v-card class="hero-card" variant="outlined">
      <v-card-text class="d-flex justify-space-between align-center flex-wrap ga-3">
        <div>
          <h1 class="text-h4 font-weight-black mb-1">Clinic Reports</h1>
          <p class="text-medium-emphasis mb-0">Dynamic, Neon-backed analytics across appointments, walk-in, check-up, mental health, and pharmacy.</p>
        </div>
      </v-card-text>
    </v-card>

    <v-row>
      <v-col v-for="card in kpiCards" :key="card.title" cols="12" sm="6" md="4" lg="3">
        <v-card class="metric-card" :class="card.className" elevation="0">
          <v-card-text>
            <div class="metric-label">{{ card.title }}</div>
            <div class="metric-value">{{ card.value }}</div>
            <div class="metric-subtitle">{{ card.subtitle }}</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12" md="4">
        <v-card class="surface-card" variant="outlined">
          <v-card-title>Module Distribution</v-card-title>
          <v-divider />
          <v-list density="comfortable">
            <v-list-item v-for="row in moduleTotals" :key="row.module">
              <template #title>{{ row.module }}</template>
              <template #append><strong>{{ row.total }}</strong></template>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>
      <v-col cols="12" md="8">
        <v-card class="surface-card" variant="outlined">
          <v-card-title>Recent Activity</v-card-title>
          <v-divider />
          <v-list density="compact">
            <v-list-item v-for="row in activity" :key="`${row.module}-${row.action}-${row.created_at}`">
              <template #title>{{ row.action }}</template>
              <template #subtitle>{{ row.detail }}</template>
              <template #append>
                <div class="text-right">
                  <div class="text-caption">{{ row.module }}</div>
                  <div class="text-caption text-medium-emphasis">{{ formatDate(row.created_at) }}</div>
                </div>
              </template>
            </v-list-item>
            <v-list-item v-if="!activity.length">
              <template #title>No activity logs available.</template>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>
    </v-row>

    <v-card class="surface-card" variant="outlined">
      <v-card-item>
        <v-card-title>Daily Trend</v-card-title>
        <template #append>
          <div class="d-flex ga-2 align-center flex-wrap">
            <SaasDateTimePickerField v-model="fromDate" mode="date" label="From" hide-details />
            <SaasDateTimePickerField v-model="toDate" mode="date" label="To" hide-details />
            <v-btn class="saas-btn saas-btn-primary" prepend-icon="mdi-chart-line" :loading="loading" @click="load">Apply</v-btn>
          </div>
        </template>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-2">
        <v-progress-linear v-if="loading" color="primary" indeterminate class="mb-2" />
        <v-table density="comfortable">
          <thead>
            <tr>
              <th>DATE</th>
              <th>APPOINTMENTS</th>
              <th>WALK-IN</th>
              <th>CHECK-UP</th>
              <th>MENTAL</th>
              <th>PHARMACY</th>
              <th>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in trend" :key="row.day">
              <td>{{ row.day }}</td>
              <td>{{ row.appointments }}</td>
              <td>{{ row.walkin }}</td>
              <td>{{ row.checkup }}</td>
              <td>{{ row.mental }}</td>
              <td>{{ row.pharmacy }}</td>
              <td class="font-weight-bold">{{ totalTrendRow(row) }}</td>
            </tr>
            <tr v-if="!loading && !trend.length">
              <td colspan="7" class="text-center text-medium-emphasis py-6">No report data available for selected dates.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>

    <ModuleActivityLogs module="all" title="All Module Activity Logs" :per-page="12" />

    <v-snackbar v-model="toast.open" :color="toast.color" timeout="2800">{{ toast.text }}</v-snackbar>
  </div>
</template>

<style scoped>
.reports-page { display: grid; gap: 16px; }
.hero-card { border-radius: 18px; border-color: #d7e4ff !important; background: linear-gradient(120deg, #f4f8ff 0%, #eef4ff 45%, #f8faff 100%); box-shadow: 0 10px 28px rgba(37, 99, 235, 0.08); }
.surface-card { border-radius: 16px; border-color: #dbe4f2 !important; background: #fbfdff; }
.metric-card { border-radius: 12px; color: #fff; min-height: 122px; box-shadow: 0 10px 18px rgba(16, 24, 40, 0.18); }
.metric-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 700; }
.metric-value { font-size: 30px; font-weight: 800; line-height: 1.1; margin-top: 2px; }
.metric-subtitle { opacity: 0.9; font-size: 13px; margin-top: 6px; }
.metric-blue { background: linear-gradient(135deg, #2f80ed 0%, #0f5ec2 100%); }
.metric-indigo { background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); }
.metric-amber { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); }
.metric-red { background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); }
.metric-green { background: linear-gradient(135deg, #22c55e 0%, #15803d 100%); }
.metric-orange { background: linear-gradient(135deg, #fb923c 0%, #ea580c 100%); }
.metric-cyan { background: linear-gradient(135deg, #06b6d4 0%, #0e7490 100%); }
.saas-btn { border-radius: 10px !important; text-transform: none !important; font-weight: 700 !important; min-height: 36px !important; }
.saas-btn-primary { background: linear-gradient(135deg, #2f80ed 0%, #225ac8 100%) !important; color: #fff !important; }
</style>
