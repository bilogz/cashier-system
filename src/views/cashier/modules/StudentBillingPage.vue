<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { mdiMagnify } from '@mdi/js';
import { useRoute } from 'vue-router';
import CashierAnalyticsCard from '@/components/shared/CashierAnalyticsCard.vue';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';
import { useAuthStore } from '@/stores/auth';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';
import { REALTIME_POLICY } from '@/config/realtimePolicy';
import { fetchEnrollmentFeedSnapshot, type EnrollmentFeedItem, type EnrollmentFeedStatCard } from '@/services/studentEnrollmentFeed';

const route = useRoute();
const auth = useAuthStore();
const realtime = useRealtimeListSync();

const pageTitle = computed(() => String(route.meta.pageTitle || 'Registrar Enrollment Feed'));
const pageDescription = computed(
  () =>
    String(
      route.meta.pageDescription ||
        'Review enrollment data shared by registrar, inspect payload details, and keep cashier visibility aligned with the registrar enrollment feed.'
    )
);

const stats = ref<EnrollmentFeedStatCard[]>([]);
const items = ref<EnrollmentFeedItem[]>([]);
const selectedItem = ref<EnrollmentFeedItem | null>(null);
const search = ref('');
const statusFilter = ref('All Statuses');
const semesterFilter = ref('All Semesters');
const sourceFilter = ref('All Sources');
const officeFilter = ref('All Offices');
const currentPage = ref(1);
const itemsPerPage = ref(10);
const totalPages = ref(1);
const totalItems = ref(0);
const loading = ref(false);
const errorMessage = ref('');

const statusOptions = ref<string[]>([]);
const semesterOptions = ref<string[]>([]);
const sourceOptions = ref<string[]>([]);
const officeOptions = ref<string[]>([]);

const filterStatusOptions = computed(() => ['All Statuses', ...statusOptions.value]);
const filterSemesterOptions = computed(() => ['All Semesters', ...semesterOptions.value]);
const filterSourceOptions = computed(() => ['All Sources', ...sourceOptions.value]);
const filterOfficeOptions = computed(() => ['All Offices', ...officeOptions.value]);

const resultSummary = computed(() => {
  const keyword = search.value.trim();
  if (keyword) return `${totalItems.value} enrollment row${totalItems.value === 1 ? '' : 's'} matched "${keyword}"`;
  return `${totalItems.value} enrollment row${totalItems.value === 1 ? '' : 's'} available`;
});

const payloadPreview = computed(() => {
  if (!selectedItem.value?.payload) return 'No payload details were provided for this feed row.';
  return JSON.stringify(selectedItem.value.payload, null, 2);
});

const selectedDetails = computed(() => {
  if (!selectedItem.value) return [];
  return [
    { label: 'Student Number', value: selectedItem.value.studentNo || '--' },
    { label: 'Student Name', value: selectedItem.value.studentName || '--' },
    { label: 'Class Code', value: selectedItem.value.classCode || '--' },
    { label: 'Subject', value: selectedItem.value.subject || '--' },
    { label: 'Academic Year', value: selectedItem.value.academicYear || '--' },
    { label: 'Semester', value: selectedItem.value.semester || '--' },
    { label: 'Status', value: selectedItem.value.status || '--' },
    { label: 'Downpayment', value: selectedItem.value.downpaymentAmountFormatted || '--' },
    { label: 'Batch ID', value: selectedItem.value.batchId || '--' },
    { label: 'Source', value: selectedItem.value.source || '--' },
    { label: 'Office', value: selectedItem.value.office || '--' },
    { label: 'Sent At', value: formatDateTime(selectedItem.value.sentAt) },
    { label: 'Created At', value: formatDateTime(selectedItem.value.createdAt) }
  ];
});

function formatDateTime(value: string | null): string {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(parsed);
}

function statusColor(status: string): string {
  const normalized = String(status || '').trim().toLowerCase();
  if (/(paid|posted|complete|completed|cleared|approved)/.test(normalized)) return 'success';
  if (/(pending|queued|draft|processing)/.test(normalized)) return 'warning';
  if (/(reject|failed|cancel|hold|error)/.test(normalized)) return 'error';
  return 'info';
}

async function loadSnapshot(options: { silent?: boolean } = {}): Promise<void> {
  const payload = await realtime.runLatest(
    async () =>
      fetchEnrollmentFeedSnapshot({
        search: search.value.trim(),
        status: statusFilter.value,
        semester: semesterFilter.value,
        source: sourceFilter.value,
        office: officeFilter.value,
        page: currentPage.value,
        perPage: itemsPerPage.value
      }),
    {
      silent: options.silent,
      onStart: () => {
        loading.value = true;
      },
      onFinish: () => {
        loading.value = false;
      },
      onError: async (error) => {
        const message = error instanceof Error ? error.message : 'Unable to load enrollment feed.';
        if (message.toLowerCase().includes('authentication required')) {
          await auth.logout();
          return;
        }
        errorMessage.value = message;
      }
    }
  );

  if (!payload) return;

  errorMessage.value = '';
  stats.value = payload.stats;
  items.value = payload.items;
  totalPages.value = payload.meta.totalPages;
  totalItems.value = payload.meta.total;
  statusOptions.value = payload.filters.statuses;
  semesterOptions.value = payload.filters.semesters;
  sourceOptions.value = payload.filters.sources;
  officeOptions.value = payload.filters.offices;

  if (!selectedItem.value) {
    selectedItem.value = payload.items[0] || null;
    return;
  }

  selectedItem.value = payload.items.find((item) => item.id === selectedItem.value?.id) || payload.items[0] || null;
}

function clearFilters(): void {
  search.value = '';
  statusFilter.value = 'All Statuses';
  semesterFilter.value = 'All Semesters';
  sourceFilter.value = 'All Sources';
  officeFilter.value = 'All Offices';
  currentPage.value = 1;
}

watch([statusFilter, semesterFilter, sourceFilter, officeFilter, itemsPerPage], () => {
  currentPage.value = 1;
  void loadSnapshot();
});

watch(currentPage, () => {
  void loadSnapshot();
});

let searchDebounce: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    currentPage.value = 1;
    void loadSnapshot();
  }, REALTIME_POLICY.debounce.registrationSearchMs);
});

onMounted(() => {
  void loadSnapshot();
  realtime.startPolling(() => {
    void loadSnapshot({ silent: true });
  }, REALTIME_POLICY.polling.registrationMs);
});

onUnmounted(() => {
  realtime.stopPolling();
  realtime.invalidatePending();
  if (searchDebounce) clearTimeout(searchDebounce);
});
</script>

<template>
  <v-row class="enrollment-feed-page">
    <v-col cols="12">
      <v-card class="hero-banner" elevation="0">
        <v-card-text class="pa-6">
          <div class="d-flex flex-column flex-lg-row justify-space-between ga-4">
            <div>
              <div class="hero-kicker">Registrar To Cashier</div>
              <h1 class="text-h4 font-weight-black mb-2">{{ pageTitle }}</h1>
              <p class="hero-subtitle mb-0">{{ pageDescription }}</p>
            </div>
            <div class="hero-side-panel">
              <div class="hero-side-label">Feed Source</div>
              <div class="text-h6 font-weight-bold">`cashier_registrar_student_enrollment_feed`</div>
              <div class="text-body-2">This module now reads enrollment rows directly from the registrar feed table instead of the old student billing snapshot.</div>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col v-for="stat in stats" :key="stat.title" cols="12" sm="6" lg="3">
      <CashierAnalyticsCard :title="stat.title" :value="stat.value" :subtitle="stat.subtitle" :icon="stat.icon" :tone="stat.tone" />
    </v-col>

    <v-col cols="12" lg="8">
      <v-card class="panel-card" variant="outlined">
        <v-card-item>
          <div class="d-flex flex-column flex-xl-row justify-space-between ga-4 w-100">
            <div>
              <v-card-title class="px-0">Enrollment Feed Queue</v-card-title>
              <v-card-subtitle class="px-0">Search and inspect student enrollment rows delivered from registrar for cashier visibility.</v-card-subtitle>
            </div>
            <div class="toolbar">
              <div class="search-stack">
                <v-text-field
                  v-model="search"
                  :prepend-inner-icon="mdiMagnify"
                  label="Search by student, class code, subject, batch, year, or status"
                  placeholder="Try 2024-0001, BSIT, or Pending"
                  variant="outlined"
                  density="comfortable"
                  clearable
                  hide-details
                />
                <div class="d-flex align-center justify-space-between flex-wrap ga-2">
                  <div class="text-body-2 text-medium-emphasis">{{ resultSummary }}</div>
                  <v-btn
                    v-if="search || statusFilter !== 'All Statuses' || semesterFilter !== 'All Semesters' || sourceFilter !== 'All Sources' || officeFilter !== 'All Offices'"
                    size="small"
                    variant="text"
                    color="primary"
                    prepend-icon="mdi-filter-remove-outline"
                    @click="clearFilters"
                  >
                    Clear Filters
                  </v-btn>
                </div>
              </div>
              <v-select v-model="statusFilter" :items="filterStatusOptions" label="Status" variant="outlined" density="comfortable" hide-details class="filter-select" />
              <v-select v-model="semesterFilter" :items="filterSemesterOptions" label="Semester" variant="outlined" density="comfortable" hide-details class="filter-select" />
              <v-select v-model="sourceFilter" :items="filterSourceOptions" label="Source" variant="outlined" density="comfortable" hide-details class="filter-select" />
              <v-select v-model="officeFilter" :items="filterOfficeOptions" label="Office" variant="outlined" density="comfortable" hide-details class="filter-select" />
            </div>
          </div>
        </v-card-item>

        <v-card-text>
          <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">{{ errorMessage }}</v-alert>

          <div class="table-shell">
            <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />
            <v-table density="comfortable" fixed-header>
              <thead>
                <tr>
                  <th>STUDENT</th>
                  <th>CLASS</th>
                  <th>SUBJECT</th>
                  <th>TERM</th>
                  <th>STATUS</th>
                  <th>DOWNPAYMENT</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in items" :key="item.id" class="table-row" :class="{ 'table-row--selected': selectedItem?.id === item.id }" @click="selectedItem = item">
                  <td>
                    <div class="font-weight-bold">{{ item.studentName }}</div>
                    <div class="text-body-2 text-medium-emphasis">{{ item.studentNo || item.batchId || 'No student number' }}</div>
                  </td>
                  <td>{{ item.classCode || '--' }}</td>
                  <td class="subject-cell">{{ item.subject || '--' }}</td>
                  <td>{{ item.semester || '--' }} <span class="text-medium-emphasis">{{ item.academicYear || '' }}</span></td>
                  <td>
                    <v-chip size="small" :color="statusColor(item.status)" variant="tonal">{{ item.status || 'Unknown' }}</v-chip>
                  </td>
                  <td>{{ item.downpaymentAmountFormatted }}</td>
                </tr>
                <tr v-if="!loading && items.length === 0">
                  <td colspan="6" class="text-center text-medium-emphasis py-8">
                    No enrollment rows are available yet in `cashier_registrar_student_enrollment_feed`.
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>

          <div v-if="totalItems > 0" class="d-flex flex-column flex-md-row justify-space-between align-md-center ga-3 mt-4">
            <div class="text-body-2 text-medium-emphasis">
              Showing {{ Math.min((currentPage - 1) * itemsPerPage + 1, totalItems) }}-{{ Math.min(currentPage * itemsPerPage, totalItems) }}
              of {{ totalItems }} enrollment rows
            </div>
            <v-pagination v-model="currentPage" :length="totalPages" density="comfortable" total-visible="5" />
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="4" class="focus-column">
      <v-card class="panel-card mb-6" variant="outlined">
        <v-card-item>
          <v-card-title>Feed Record Details</v-card-title>
          <v-card-subtitle>Selected enrollment row and registrar metadata</v-card-subtitle>
        </v-card-item>
        <v-card-text v-if="selectedItem">
          <div class="focus-banner mb-4">
            <div class="text-overline">Selected Student</div>
            <div class="text-h6 font-weight-bold">{{ selectedItem.studentName }}</div>
            <div class="text-body-2">{{ selectedItem.studentNo || 'No student number' }} | {{ selectedItem.downpaymentAmountFormatted }}</div>
          </div>
          <div class="detail-grid">
            <div v-for="detail in selectedDetails" :key="detail.label">
              <div class="meta-label">{{ detail.label }}</div>
              <div class="meta-value">{{ detail.value }}</div>
            </div>
          </div>
        </v-card-text>
        <v-card-text v-else class="text-body-2 text-medium-emphasis">
          Select an enrollment row to inspect its details and payload.
        </v-card-text>
      </v-card>

      <v-card class="panel-card" variant="outlined">
        <v-card-item>
          <v-card-title>Payload Preview</v-card-title>
          <v-card-subtitle>Raw JSON captured in the registrar enrollment feed</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <pre class="payload-preview">{{ payloadPreview }}</pre>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12">
      <ModuleActivityLogs module="all" title="Cashier Activity Logs" :per-page="6" />
    </v-col>
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
.meta-label {
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #73809b;
  font-weight: 700;
}

.panel-card {
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.05);
}

.toolbar {
  display: grid;
  grid-template-columns: minmax(260px, 1.5fr) repeat(4, minmax(140px, 1fr));
  gap: 12px;
  align-items: start;
  width: min(100%, 1120px);
}

.search-stack {
  display: grid;
  gap: 10px;
}

.filter-select {
  min-width: 0;
}

.table-shell {
  overflow: hidden;
  border-radius: 16px;
  border: 1px solid rgba(37, 84, 157, 0.12);
}

.table-row {
  cursor: pointer;
  transition: background 0.18s ease;
}

.table-row:hover {
  background: rgba(37, 84, 157, 0.04);
}

.table-row--selected {
  background: rgba(37, 84, 157, 0.08);
}

.subject-cell {
  max-width: 260px;
}

.focus-column {
  position: sticky;
  top: 88px;
  align-self: start;
  max-height: calc(100vh - 112px);
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 6px;
}

.focus-banner {
  padding: 18px;
  border-radius: 16px;
  color: #fff;
  background: linear-gradient(135deg, #1d4b96 0%, #3579c9 100%);
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.meta-value {
  margin-top: 4px;
  color: #18243f;
  font-weight: 700;
  word-break: break-word;
}

.payload-preview {
  margin: 0;
  padding: 14px;
  min-height: 220px;
  max-height: 420px;
  overflow: auto;
  border-radius: 14px;
  background: #0f172a;
  color: #dbeafe;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 1279px) {
  .toolbar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
  }
}

@media (max-width: 959px) {
  .focus-column {
    position: static;
    max-height: none;
    overflow: visible;
    padding-right: 0;
  }
}

@media (max-width: 640px) {
  .toolbar,
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
