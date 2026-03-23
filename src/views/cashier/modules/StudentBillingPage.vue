<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  mdiClose,
  mdiFilterRemoveOutline,
  mdiMagnify,
  mdiPlus
} from '@mdi/js';
import { useRoute } from 'vue-router';
import CashierAnalyticsCard from '@/components/shared/CashierAnalyticsCard.vue';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';
import WorkflowActionDialog from '@/components/shared/WorkflowActionDialog.vue';
import { emitSuccessModal } from '@/composables/useSuccessModal';
import { useAuthStore } from '@/stores/auth';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';
import { REALTIME_POLICY } from '@/config/realtimePolicy';
import {
  applyEnrollmentFeedDecision,
  createEnrollmentFeedRecord,
  deleteEnrollmentFeedRecord,
  fetchEnrollmentFeedSnapshot,
  updateEnrollmentFeedRecord,
  type EnrollmentFeedDecisionAction,
  type EnrollmentFeedItem,
  type EnrollmentFeedStatCard
} from '@/services/studentEnrollmentFeed';

type FeedForm = {
  batchId: string;
  source: string;
  office: string;
  studentNo: string;
  studentName: string;
  classCode: string;
  subject: string;
  academicYear: string;
  semester: string;
  status: string;
  downpaymentAmount: number;
};
type DialogField = {
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'select' | 'number' | 'date';
  items?: Array<string | { title: string; value: string | number }>;
  required?: boolean;
  placeholder?: string;
  rows?: number;
};

const route = useRoute();
const auth = useAuthStore();
const realtime = useRealtimeListSync();

const pageTitle = computed(() => String(route.meta.pageTitle || 'Registrar Enrollment Feed'));
const pageDescription = computed(
  () =>
    String(
      route.meta.pageDescription ||
        'Review registrar submissions, approve them for cashier billing, place them on hold, or return them for correction.'
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
const actionLoading = ref(false);
const errorMessage = ref('');
let activeForegroundLoads = 0;

const editorOpen = ref(false);
const editorMode = ref<'create' | 'edit'>('create');
const deleteDialog = ref(false);
const rowPendingDelete = ref<EnrollmentFeedItem | null>(null);
const rowPendingEdit = ref<EnrollmentFeedItem | null>(null);

const decisionDialogOpen = ref(false);
const decisionAction = ref<EnrollmentFeedDecisionAction>('approve');
const decisionTarget = ref<EnrollmentFeedItem | null>(null);

const statusOptions = ref<string[]>([]);
const semesterOptions = ref<string[]>([]);
const sourceOptions = ref<string[]>([]);
const officeOptions = ref<string[]>([]);
const formErrors = ref<Partial<Record<keyof FeedForm, string>>>({});
const form = ref<FeedForm>(buildEmptyForm());

const filterStatusOptions = computed(() => ['All Statuses', ...statusOptions.value]);
const filterSemesterOptions = computed(() => ['All Semesters', ...semesterOptions.value]);
const filterSourceOptions = computed(() => ['All Sources', ...sourceOptions.value]);
const filterOfficeOptions = computed(() => ['All Offices', ...officeOptions.value]);
const editorTitle = computed(() => (editorMode.value === 'create' ? 'Add Enrollment Feed Record' : 'Edit Enrollment Feed Record'));
const hasActiveFilters = computed(
  () =>
    Boolean(
      search.value ||
        statusFilter.value !== 'All Statuses' ||
        semesterFilter.value !== 'All Semesters' ||
        sourceFilter.value !== 'All Sources' ||
        officeFilter.value !== 'All Offices'
    )
);
const resultSummary = computed(() => {
  const keyword = search.value.trim();
  if (keyword) return `${totalItems.value} enrollment row${totalItems.value === 1 ? '' : 's'} matched "${keyword}"`;
  return `${totalItems.value} enrollment row${totalItems.value === 1 ? '' : 's'} available`;
});

const decisionDialogTitle = computed(() => {
  if (decisionAction.value === 'approve') return decisionTarget.value?.billingCode ? 'Refresh Linked Billing' : 'Approve And Create Billing';
  if (decisionAction.value === 'hold') return 'Place Enrollment On Hold';
  return 'Return To Registrar';
});

const decisionDialogSubtitle = computed(() => {
  if (decisionAction.value === 'approve') return 'Approval creates or refreshes a real billing record in Student Portal & Billing.';
  if (decisionAction.value === 'hold') return 'Hold the row while cashier validation is still incomplete.';
  return 'Return the row to registrar with a clear correction reason.';
});

const decisionConfirmLabel = computed(() => {
  if (decisionAction.value === 'approve') return decisionTarget.value?.billingCode ? 'Refresh Billing' : 'Approve';
  if (decisionAction.value === 'hold') return 'Place On Hold';
  return 'Return To Registrar';
});

const decisionConfirmColor = computed(() => (decisionAction.value === 'approve' ? 'success' : decisionAction.value === 'hold' ? 'warning' : 'error'));
const decisionChipLabel = computed(() => (decisionAction.value === 'approve' ? 'Cashier Approval' : decisionAction.value === 'hold' ? 'Validation Hold' : 'Registrar Return'));
const decisionContextFields = computed(() => {
  const item = decisionTarget.value;
  if (!item) return [];
  return [
    { label: 'Student', value: item.studentName || '--' },
    { label: 'Student Number', value: item.studentNo || '--' },
    { label: 'Downpayment', value: item.downpaymentAmountFormatted || '--' },
    { label: 'Current Status', value: item.status || '--' },
    { label: 'Billing Link', value: item.billingCode || 'Not created yet' },
    { label: 'Next Step', value: item.nextStep || '--' }
  ];
});

const decisionFields = computed<DialogField[]>(() =>
  decisionAction.value === 'return'
    ? [
        { key: 'reason', label: 'Reason', type: 'select', required: true, items: ['Registrar correction required', 'Invalid student details', 'Amount mismatch', 'Duplicate submission'] },
        { key: 'remarks', label: 'Cashier notes', type: 'textarea', rows: 3, placeholder: 'Explain what registrar needs to correct.' }
      ]
    : [
        {
          key: 'remarks',
          label: decisionAction.value === 'approve' ? 'Approval notes' : 'Hold reason',
          type: 'textarea',
          rows: 3,
          required: decisionAction.value === 'hold',
          placeholder: decisionAction.value === 'approve' ? 'Optional notes for the linked billing record.' : 'State why this row should remain on hold.'
        }
      ]
);

const decisionInitialValues = computed<Record<string, string | number>>(() => {
  if (decisionAction.value === 'approve') {
    return {
      reason: '',
      remarks: decisionTarget.value?.billingCode ? 'Refresh the linked billing from the latest registrar submission.' : 'Approve the registrar feed and create billing.'
    };
  }
  if (decisionAction.value === 'hold') {
    return {
      reason: '',
      remarks: decisionTarget.value?.decisionNotes || 'Awaiting cashier validation before billing activation.'
    };
  }
  return { reason: 'Registrar correction required', remarks: decisionTarget.value?.decisionNotes || '' };
});

function buildEmptyForm(): FeedForm {
  return {
    batchId: '',
    source: 'Registrar',
    office: 'Main Registrar',
    studentNo: '',
    studentName: '',
    classCode: '',
    subject: '',
    academicYear: '2025-2026',
    semester: '1st Semester',
    status: 'Pending Review',
    downpaymentAmount: 0
  };
}

function fillForm(item: EnrollmentFeedItem): void {
  form.value = {
    batchId: item.batchId || '',
    source: item.source || 'Registrar',
    office: item.office || 'Registrar',
    studentNo: item.studentNo || '',
    studentName: item.studentName || '',
    classCode: item.classCode || '',
    subject: item.subject || '',
    academicYear: item.academicYear || '',
    semester: item.semester || '',
    status: item.status || 'Pending Review',
    downpaymentAmount: Number(item.downpaymentAmount || 0)
  };
  formErrors.value = {};
}

function statusColor(status: string): string {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized.includes('approve') || normalized.includes('billing') || normalized.includes('cleared')) return 'success';
  if (normalized.includes('hold') || normalized.includes('return') || normalized.includes('reject')) return 'error';
  return 'warning';
}

function validateForm(): boolean {
  const errors: Partial<Record<keyof FeedForm, string>> = {};
  if (!form.value.studentNo.trim()) errors.studentNo = 'Student number is required.';
  if (!form.value.studentName.trim()) errors.studentName = 'Student name is required.';
  if (!form.value.source.trim()) errors.source = 'Source is required.';
  if (!form.value.office.trim()) errors.office = 'Office is required.';
  if (!Number.isFinite(form.value.downpaymentAmount) || form.value.downpaymentAmount < 0) errors.downpaymentAmount = 'Downpayment must be zero or greater.';
  formErrors.value = errors;
  return Object.keys(errors).length === 0;
}

async function loadSnapshot(options: { silent?: boolean } = {}): Promise<void> {
  if (!options.silent) {
    activeForegroundLoads += 1;
    loading.value = true;
  }
  try {
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
  } finally {
    if (!options.silent) {
      activeForegroundLoads = Math.max(0, activeForegroundLoads - 1);
      loading.value = activeForegroundLoads > 0;
    }
  }
}

function clearFilters(): void {
  search.value = '';
  statusFilter.value = 'All Statuses';
  semesterFilter.value = 'All Semesters';
  sourceFilter.value = 'All Sources';
  officeFilter.value = 'All Offices';
  currentPage.value = 1;
}

function openCreateDialog(): void {
  editorMode.value = 'create';
  rowPendingEdit.value = null;
  form.value = buildEmptyForm();
  formErrors.value = {};
  editorOpen.value = true;
}

function openEditDialog(item: EnrollmentFeedItem): void {
  editorMode.value = 'edit';
  rowPendingEdit.value = item;
  fillForm(item);
  editorOpen.value = true;
}

function askDelete(item: EnrollmentFeedItem): void {
  rowPendingDelete.value = item;
  deleteDialog.value = true;
}

function openDecisionDialog(action: EnrollmentFeedDecisionAction, item: EnrollmentFeedItem | null = selectedItem.value): void {
  if (!item) return;
  decisionTarget.value = item;
  selectedItem.value = item;
  decisionAction.value = action;
  decisionDialogOpen.value = true;
}

async function saveRecord(): Promise<void> {
  if (!validateForm()) return;
  actionLoading.value = true;
  try {
    const payload = {
      id: rowPendingEdit.value?.id,
      batchId: form.value.batchId.trim(),
      source: form.value.source.trim(),
      office: form.value.office.trim(),
      studentNo: form.value.studentNo.trim(),
      studentName: form.value.studentName.trim(),
      classCode: form.value.classCode.trim(),
      subject: form.value.subject.trim(),
      academicYear: form.value.academicYear.trim(),
      semester: form.value.semester.trim(),
      status: form.value.status.trim(),
      downpaymentAmount: Number(form.value.downpaymentAmount || 0)
    };
    if (editorMode.value === 'create') {
      await createEnrollmentFeedRecord(payload);
      emitSuccessModal({ title: 'Record Created', message: 'Enrollment feed record added successfully.', tone: 'success' });
    } else {
      await updateEnrollmentFeedRecord(payload);
      emitSuccessModal({ title: 'Record Updated', message: 'Enrollment feed record updated successfully.', tone: 'success' });
    }
    editorOpen.value = false;
    await loadSnapshot();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to save enrollment feed record.';
  } finally {
    actionLoading.value = false;
  }
}

async function confirmDelete(): Promise<void> {
  if (!rowPendingDelete.value) return;
  actionLoading.value = true;
  try {
    await deleteEnrollmentFeedRecord(rowPendingDelete.value.id);
    if (selectedItem.value?.id === rowPendingDelete.value.id) selectedItem.value = null;
    deleteDialog.value = false;
    rowPendingDelete.value = null;
    emitSuccessModal({ title: 'Record Deleted', message: 'Enrollment feed record removed successfully.', tone: 'success' });
    await loadSnapshot();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to delete enrollment feed record.';
  } finally {
    actionLoading.value = false;
  }
}

async function submitDecision(formValues: Record<string, string | number>): Promise<void> {
  const target = decisionTarget.value;
  if (!target) return;
  actionLoading.value = true;
  try {
    const response = await applyEnrollmentFeedDecision({
      id: target.id,
      action: decisionAction.value,
      remarks: String(formValues.remarks || '').trim(),
      reason: String(formValues.reason || '').trim()
    });
    decisionDialogOpen.value = false;
    emitSuccessModal({
      title: decisionAction.value === 'approve' ? 'Billing Approved' : decisionAction.value === 'hold' ? 'Enrollment On Hold' : 'Returned To Registrar',
      message: response.message,
      tone: 'success'
    });
    await loadSnapshot();
    if (response.item?.id) selectedItem.value = items.value.find((item) => item.id === response.item?.id) || response.item;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to apply cashier decision.';
  } finally {
    actionLoading.value = false;
  }
}

watch([statusFilter, semesterFilter, sourceFilter, officeFilter, itemsPerPage], () => {
  if (currentPage.value !== 1) {
    currentPage.value = 1;
    return;
  }
  void loadSnapshot();
});
watch(currentPage, () => {
  void loadSnapshot();
});
let searchDebounce: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    if (currentPage.value !== 1) {
      currentPage.value = 1;
      return;
    }
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
              <div class="hero-side-label">Cashier Decision Flow</div>
              <div class="text-h6 font-weight-bold">Approve, Hold, Or Return</div>
              <div class="text-body-2">Approval creates a real billing record in Student Portal & Billing. Hold and return keep registrar and cashier queues aligned.</div>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col v-for="stat in stats" :key="stat.title" cols="12" sm="6" lg="3">
      <CashierAnalyticsCard :title="stat.title" :value="stat.value" :subtitle="stat.subtitle" :icon="stat.icon" :tone="stat.tone" />
    </v-col>

    <v-col cols="12">
      <v-card class="panel-card" variant="outlined">
        <v-card-item>
          <div class="d-flex flex-column flex-xl-row justify-space-between ga-4 w-100">
            <div>
              <v-card-title class="px-0">Enrollment Decision Board</v-card-title>
              <v-card-subtitle class="px-0">Search, review, and maintain registrar rows while applying real cashier decisions.</v-card-subtitle>
            </div>
            <div class="toolbar">
              <div class="search-stack">
                <v-text-field
                  v-model="search"
                  :prepend-inner-icon="mdiMagnify"
                  label="Search by student, class, subject, batch, billing code, or note"
                  placeholder="Try 2024-0001, BSIT, or BILL-ENR-2026-0008"
                  variant="outlined"
                  density="comfortable"
                  clearable
                  hide-details
                />
                <div class="d-flex align-center justify-space-between flex-wrap ga-2">
                  <div class="text-body-2 text-medium-emphasis">{{ resultSummary }}</div>
                  <div class="d-flex ga-2 flex-wrap">
                    <v-btn color="primary" :prepend-icon="mdiPlus" rounded="pill" @click="openCreateDialog">Add Record</v-btn>
                    <v-btn v-if="hasActiveFilters" size="small" variant="text" color="primary" :prepend-icon="mdiFilterRemoveOutline" @click="clearFilters">Clear Filters</v-btn>
                  </div>
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
                  <th>CLASS / SUBJECT</th>
                  <th>TERM</th>
                  <th>STATUS</th>
                  <th>DOWNPAYMENT</th>
                  <th>BILLING</th>
                  <th class="text-center">ACTION</th>
                  <th class="text-right">MAINTAIN</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in items" :key="item.id" class="table-row" :class="{ 'table-row--selected': selectedItem?.id === item.id }" @click="selectedItem = item">
                  <td>
                    <div class="font-weight-bold">{{ item.studentName }}</div>
                    <div class="text-body-2 text-medium-emphasis">{{ item.studentNo || item.batchId || 'No student number' }}</div>
                  </td>
                  <td>
                    <div>{{ item.classCode || '--' }}</div>
                    <div class="text-body-2 text-medium-emphasis subject-cell">{{ item.subject || '--' }}</div>
                  </td>
                  <td>{{ item.semester || '--' }} <span class="text-medium-emphasis">{{ item.academicYear || '' }}</span></td>
                  <td><v-chip size="small" :color="statusColor(item.status)" variant="tonal">{{ item.status || 'Unknown' }}</v-chip></td>
                  <td>{{ item.downpaymentAmountFormatted }}</td>
                  <td>
                    <div v-if="item.billingCode" class="billing-link">{{ item.billingCode }}</div>
                    <div v-else class="billing-link billing-link--empty">Awaiting approval</div>
                  </td>
                  <td class="text-center">
                    <div class="d-inline-flex ga-2 flex-wrap justify-center">
                      <v-btn
                        size="small"
                        variant="tonal"
                        color="success"
                        :disabled="actionLoading"
                        @click.stop="openDecisionDialog('approve', item)"
                      >
                        {{ item.billingCode ? 'Refresh Billing' : 'Approve' }}
                      </v-btn>
                      <v-btn size="small" variant="tonal" color="warning" :disabled="actionLoading" @click.stop="openDecisionDialog('hold', item)">
                        Hold
                      </v-btn>
                      <v-btn size="small" variant="tonal" color="error" :disabled="actionLoading" @click.stop="openDecisionDialog('return', item)">
                        Return
                      </v-btn>
                    </div>
                  </td>
                  <td class="text-right">
                    <div class="d-inline-flex ga-2">
                      <v-btn size="small" variant="tonal" color="primary" @click.stop="openEditDialog(item)">Edit</v-btn>
                      <v-btn size="small" variant="tonal" color="error" @click.stop="askDelete(item)">Delete</v-btn>
                    </div>
                  </td>
                </tr>
                <tr v-if="!loading && items.length === 0">
                  <td colspan="8" class="text-center text-medium-emphasis py-8">No enrollment records yet. Incoming registrar rows will appear here automatically.</td>
                </tr>
              </tbody>
            </v-table>
          </div>

          <div v-if="totalItems > 0" class="d-flex flex-column flex-md-row justify-space-between align-md-center ga-3 mt-4">
            <div class="text-body-2 text-medium-emphasis">Showing {{ Math.min((currentPage - 1) * itemsPerPage + 1, totalItems) }}-{{ Math.min(currentPage * itemsPerPage, totalItems) }} of {{ totalItems }} enrollment rows</div>
            <v-pagination v-model="currentPage" :length="totalPages" density="comfortable" total-visible="5" />
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12">
      <ModuleActivityLogs module="all" title="Cashier Activity Logs" :per-page="6" />
    </v-col>

    <WorkflowActionDialog
      v-model="decisionDialogOpen"
      :loading="actionLoading"
      :title="decisionDialogTitle"
      :subtitle="decisionDialogSubtitle"
      :chip-label="decisionChipLabel"
      :chip-color="decisionConfirmColor"
      :confirm-label="decisionConfirmLabel"
      :confirm-color="decisionConfirmColor"
      :context-fields="decisionContextFields"
      :fields="decisionFields"
      :initial-values="decisionInitialValues"
      @submit="submitDecision"
    />

    <v-dialog v-model="editorOpen" max-width="820" :persistent="actionLoading">
      <v-card class="panel-card">
        <v-card-title class="d-flex align-center justify-space-between">
          <span>{{ editorTitle }}</span>
          <v-btn icon variant="text" :disabled="actionLoading" @click="editorOpen = false"><v-icon :icon="mdiClose" /></v-btn>
        </v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" md="6"><v-text-field v-model="form.studentNo" label="Student Number" variant="outlined" density="comfortable" :error-messages="formErrors.studentNo" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.studentName" label="Student Name" variant="outlined" density="comfortable" :error-messages="formErrors.studentName" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.batchId" label="Batch ID" variant="outlined" density="comfortable" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.status" label="Status" variant="outlined" density="comfortable" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.classCode" label="Class Code" variant="outlined" density="comfortable" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.subject" label="Subject" variant="outlined" density="comfortable" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.academicYear" label="Academic Year" variant="outlined" density="comfortable" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.semester" label="Semester" variant="outlined" density="comfortable" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.source" label="Source" variant="outlined" density="comfortable" :error-messages="formErrors.source" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="form.office" label="Office" variant="outlined" density="comfortable" :error-messages="formErrors.office" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model.number="form.downpaymentAmount" label="Downpayment Amount" type="number" min="0" step="0.01" variant="outlined" density="comfortable" :error-messages="formErrors.downpaymentAmount" /></v-col>
          </v-row>
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn variant="text" :disabled="actionLoading" @click="editorOpen = false">Cancel</v-btn>
          <v-btn color="primary" :loading="actionLoading" @click="saveRecord">{{ editorMode === 'create' ? 'Create Record' : 'Save Changes' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteDialog" max-width="460" :persistent="actionLoading">
      <v-card class="panel-card">
        <v-card-title>Delete Enrollment Feed Record</v-card-title>
        <v-card-text>Remove <strong>{{ rowPendingDelete?.studentName || 'this record' }}</strong> from the enrollment feed?</v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn variant="text" :disabled="actionLoading" @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" :loading="actionLoading" @click="confirmDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-row>
</template>

<style scoped>
.hero-banner{border-radius:18px;color:#fff;background:linear-gradient(125deg,#163066 0%,#25549d 52%,#5ba6dc 100%);box-shadow:0 18px 36px rgba(20,50,115,.18)}
.hero-kicker{display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;margin-bottom:12px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.26);text-transform:uppercase;letter-spacing:.08em;font-size:12px;font-weight:800}
.hero-subtitle{max-width:760px;color:rgba(255,255,255,.92)}
.hero-side-panel{min-width:280px;padding:18px;border-radius:16px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18)}
.hero-side-label,.meta-label{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#73809b;font-weight:700}
.panel-card{border-radius:18px;background:#fff;box-shadow:0 14px 28px rgba(15,23,42,.05)}
.toolbar{display:grid;grid-template-columns:minmax(260px,1.5fr) repeat(4,minmax(140px,1fr));gap:12px;align-items:start;width:min(100%,1120px)}
.search-stack{display:grid;gap:10px}
.filter-select{min-width:0}
.table-shell{overflow:hidden;border-radius:16px;border:1px solid rgba(37,84,157,.12)}
.table-row{cursor:pointer;transition:background .18s ease}
.table-row:hover{background:rgba(37,84,157,.04)}
.table-row--selected{background:rgba(37,84,157,.08)}
.subject-cell{max-width:220px}
.billing-link{font-weight:700;color:#1d4b96}
.billing-link--empty{color:#8b97ad;font-weight:600}
.focus-column{position:sticky;top:88px;align-self:start;max-height:calc(100vh - 112px);overflow-y:auto;overflow-x:hidden;padding-right:6px}
.focus-banner{padding:18px;border-radius:16px;color:#fff;display:flex;justify-content:space-between;gap:16px;background:linear-gradient(135deg,#1d4b96 0%,#3579c9 100%)}
.workflow-callout{padding:16px;border-radius:16px;border:1px solid rgba(37,84,157,.14);background:linear-gradient(180deg,#f8fbff 0%,#fff 100%)}
.workflow-callout__title{margin-top:6px;font-size:15px;font-weight:800;color:#18243f}
.workflow-callout__meta{margin-top:8px;font-size:13px;color:#66738d}
.action-stack{display:grid;gap:12px}
.secondary-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.detail-item--wide{grid-column:span 2}
.meta-value{margin-top:4px;color:#18243f;font-weight:700;word-break:break-word}
@media (max-width:1279px){.toolbar{grid-template-columns:repeat(2,minmax(0,1fr));width:100%}}
@media (max-width:959px){.focus-column{position:static;max-height:none;overflow:visible;padding-right:0}}
@media (max-width:640px){.toolbar,.detail-grid,.secondary-actions{grid-template-columns:1fr}.detail-item--wide{grid-column:auto}.focus-banner{flex-direction:column;align-items:flex-start}}
</style>
