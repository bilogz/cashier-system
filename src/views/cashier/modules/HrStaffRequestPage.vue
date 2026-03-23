<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import {
  createHrStaffRequest,
  fetchHrStaffRequestStatus,
  fetchHrStaffRequests,
  type CashierRoleType,
  type HrStaffRequestRow,
  type HrStaffRequestStatus
} from '@/services/hrStaffRequests';
import { HR_STAFF_INTEGRATION_ROLES } from '../../../../../shared/hrStaffIntegrationRoles';

const loading = ref(true);
const requestLoading = ref(false);
const requesting = ref(false);
const status = ref<HrStaffRequestStatus | null>(null);
const requests = ref<HrStaffRequestRow[]>([]);
const requestMeta = reactive({ page: 1, perPage: 10, total: 0, totalPages: 1 });
const requestSearch = ref('');
const requestStatus = ref<'all' | 'pending' | 'approved' | 'rejected' | 'queue' | 'waiting_applicant' | 'hiring' | 'hired'>('all');
const requestPage = ref(1);
const staffDialog = ref(false);
const requestedRole = ref<CashierRoleType>('cashier_staff');
const requestedCount = ref(1);
const requestNotes = ref('');
const requestedBy = ref('Cashier Admin');
const toast = reactive({ open: false, text: '', color: 'info' as 'success' | 'info' | 'warning' | 'error' });
let pollInterval: ReturnType<typeof setInterval> | null = null;
let searchDebounce: ReturnType<typeof setTimeout> | null = null;

const cards = computed(() => [
  { title: 'Active HR Roster', value: status.value?.totals.activeRoster ?? 0, subtitle: 'Active cashier staff', icon: 'mdi-account-check-outline', color: '#1565C0' },
  { title: 'Working Roster', value: status.value?.totals.workingRoster ?? 0, subtitle: 'Currently on duty', icon: 'mdi-cash-register', color: '#2E7D32' },
  { title: 'Pending Requests', value: status.value?.totals.pendingRequests ?? 0, subtitle: 'Awaiting HR action', icon: 'mdi-timer-sand', color: '#E65100' },
  { title: 'Approved Requests', value: status.value?.totals.approvedRequests ?? 0, subtitle: 'Approved by HR', icon: 'mdi-check-decagram-outline', color: '#6A1B9A' }
]);

const roleLabel = (r: string) => r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
function showToast(text: string, color: typeof toast.color = 'info'): void { toast.text = text; toast.color = color; toast.open = true; }
function formatDateTime(v: string | null): string {
  if (!v) return '--';
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleString();
}
function statusColor(v: string): string {
  if (v === 'approved' || v === 'hired') return 'success';
  if (v === 'rejected') return 'error';
  if (v === 'hiring') return 'primary';
  if (v === 'waiting_applicant') return 'info';
  return 'warning';
}

async function loadStatus(): Promise<void> {
  try { status.value = await fetchHrStaffRequestStatus(); } catch { /* silent */ }
}
async function loadRequests(silent = false): Promise<void> {
  if (!silent) requestLoading.value = true;
  try {
    const data = await fetchHrStaffRequests({
      search: requestSearch.value.trim() || undefined,
      status: requestStatus.value === 'all' ? undefined : requestStatus.value,
      page: requestPage.value, perPage: requestMeta.perPage
    });
    requests.value = data.items;
    Object.assign(requestMeta, data.meta);
  } catch (e) { showToast(e instanceof Error ? e.message : String(e), 'error'); }
  finally { requestLoading.value = false; }
}
function openDialog(): void {
  staffDialog.value = true;
  requestedRole.value = 'cashier_staff';
  requestedCount.value = 1;
  requestNotes.value = '';
}
async function submitRequest(): Promise<void> {
  requesting.value = true;
  try {
    await createHrStaffRequest({
      roleType: requestedRole.value, requestedCount: requestedCount.value,
      requestedBy: requestedBy.value, requestNotes: requestNotes.value
    });
    staffDialog.value = false;
    await Promise.all([loadStatus(), loadRequests()]);
    showToast('Staff request sent to HR.', 'success');
  } catch (e) { showToast(e instanceof Error ? e.message : String(e), 'error'); }
  finally { requesting.value = false; }
}

watch(requestSearch, () => {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => { requestPage.value = 1; void loadRequests(); }, 400);
});
watch(requestStatus, () => { requestPage.value = 1; void loadRequests(); });
watch(requestPage, () => { void loadRequests(); });

onMounted(async () => {
  await Promise.all([loadStatus(), loadRequests()]);
  loading.value = false;
  pollInterval = setInterval(async () => { await loadStatus(); await loadRequests(true); }, 30_000);
});
onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval);
  if (searchDebounce) clearTimeout(searchDebounce);
});
</script>

<template>
  <div class="hr-request-page">
    <v-card class="hero-card" variant="outlined">
      <v-card-text class="d-flex justify-space-between align-center flex-wrap ga-3">
        <div>
          <div class="hero-kicker">HR Integration</div>
          <h1 class="text-h5 font-weight-black mb-1">Request Cashier Staff from HR</h1>
          <p class="text-medium-emphasis mb-0">Submit staffing requests and track approval status from HR.</p>
        </div>
        <v-btn class="saas-btn" color="primary" rounded="pill" prepend-icon="mdi-account-plus-outline" @click="openDialog">
          Request Staff
        </v-btn>
      </v-card-text>
    </v-card>

    <v-row>
      <v-col v-for="card in cards" :key="card.title" cols="12" sm="6" lg="3">
        <v-card variant="outlined" rounded="lg">
          <v-card-text class="d-flex align-center ga-3">
            <v-avatar :color="card.color" size="44" rounded="lg">
              <v-icon :icon="card.icon" color="white" size="20" />
            </v-avatar>
            <div>
              <div class="text-h5 font-weight-black">{{ card.value }}</div>
              <div class="text-caption font-weight-bold text-medium-emphasis text-uppercase">{{ card.title }}</div>
              <div class="text-caption text-medium-emphasis">{{ card.subtitle }}</div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-card variant="outlined">
      <v-card-item><v-card-title>HR Staff Requests</v-card-title></v-card-item>
      <v-card-text>
        <v-row class="mb-2">
          <v-col cols="12" md="8">
            <v-text-field v-model="requestSearch" label="Search by reference, employee no, name" prepend-inner-icon="mdi-magnify" variant="outlined" density="comfortable" hide-details />
          </v-col>
          <v-col cols="12" md="4">
            <v-select v-model="requestStatus" :items="['all','pending','queue','waiting_applicant','hiring','approved','hired','rejected']" label="Status" variant="outlined" density="comfortable" hide-details />
          </v-col>
        </v-row>
        <v-progress-linear v-if="requestLoading" indeterminate color="primary" class="mb-2" />
        <v-table density="comfortable">
          <thead>
            <tr><th>REQUEST</th><th>STAFF</th><th>ROLE</th><th>STATUS</th><th>REQUESTED BY</th><th>CREATED</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in requests" :key="row.id">
              <td>
                <div class="font-weight-bold">{{ row.request_reference }}</div>
                <div class="text-caption text-medium-emphasis">{{ row.employee_no }}</div>
              </td>
              <td>{{ row.staff_name }}</td>
              <td><v-chip size="small" variant="tonal" color="primary">{{ roleLabel(row.role_type) }}</v-chip></td>
              <td><v-chip size="small" variant="tonal" :color="statusColor(row.request_status)">{{ row.request_status }}</v-chip></td>
              <td>{{ row.requested_by || '--' }}</td>
              <td>{{ formatDateTime(row.created_at) }}</td>
            </tr>
            <tr v-if="!requestLoading && requests.length === 0">
              <td colspan="6" class="text-center text-medium-emphasis py-6">No requests found.</td>
            </tr>
          </tbody>
        </v-table>
        <div class="d-flex align-center mt-3 text-caption text-medium-emphasis">
          <span>Showing {{ requests.length }} of {{ requestMeta.total }}</span>
          <v-spacer />
          <v-pagination v-model="requestPage" :length="requestMeta.totalPages" density="comfortable" />
        </div>
      </v-card-text>
    </v-card>

    <v-dialog v-model="staffDialog" max-width="680">
      <v-card>
        <v-card-item><v-card-title>Request Cashier Staff from HR</v-card-title></v-card-item>
        <v-card-text>
          <v-row>
            <v-col cols="12" md="6">
              <v-select v-model="requestedRole" :items="[...HR_STAFF_INTEGRATION_ROLES]" item-title="title" item-value="value" label="Requested role" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model.number="requestedCount" type="number" min="1" label="Requested count" variant="outlined" density="comfortable" />
            </v-col>
          </v-row>
          <v-row>
            <v-col cols="12" md="4">
              <v-text-field v-model="requestedBy" label="Requested by" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="12" md="8">
              <v-textarea v-model="requestNotes" label="Request notes" rows="2" variant="outlined" density="comfortable" />
            </v-col>
          </v-row>
        </v-card-text>
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="staffDialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="requesting" @click="submitRequest">Send Request</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="toast.open" :color="toast.color" timeout="2800">{{ toast.text }}</v-snackbar>
  </div>
</template>

<style scoped>
.hr-request-page { display: grid; gap: 16px; }
.hero-card { border-radius: 16px; border-color: #d7e4ff !important; background: linear-gradient(120deg, #f4f8ff 0%, #eef4ff 45%, #f8faff 100%); }
.hero-kicker { display: inline-flex; margin-bottom: 10px; border-radius: 999px; padding: 4px 10px; background: rgba(47,128,237,0.08); border: 1px solid rgba(47,128,237,0.18); color: #2f5c9f; font-size: 12px; font-weight: 800; letter-spacing: 0.7px; text-transform: uppercase; }
.saas-btn { text-transform: none; font-weight: 700; }
</style>
