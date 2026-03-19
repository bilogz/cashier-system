<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { mdiArchiveOutline, mdiCheckDecagramOutline, mdiFileChartOutline, mdiDownloadOutline, mdiMagnify } from '@mdi/js';
import CashierAnalyticsCard from '@/components/shared/CashierAnalyticsCard.vue';
import CashierActionButton from '@/components/shared/CashierActionButton.vue';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';
import WorkflowActionDialog from '@/components/shared/WorkflowActionDialog.vue';
import WorkflowCorrectionDialog from '@/components/shared/WorkflowCorrectionDialog.vue';
import { useAuthStore } from '@/stores/auth';
import {
  fetchCompletedTransactions,
  exportCompletedTransactions,
  fetchReportingSnapshot,
  type ReportingPaginationMeta,
  type ReportingItem,
  type ReportingSnapshot,
  type ReportingStatus
} from '@/services/reportingReconciliation';
import { returnWorkflowRecordForCorrection } from '@/services/workflowCorrections';
import { reconcileWorkflowRecord } from '@/services/workflowActions';
import {
  archiveReconciliationRecord,
  flagReconciliationDiscrepancy,
  reportReconciliationRecord
} from '@/services/workflowCrudActions';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';

const auth = useAuthStore();
const stats = ref<ReportingSnapshot['stats']>([]);
const reportRows = ref<ReportingItem[]>([]);
const completedRows = ref<ReportingItem[]>([]);
const completedMeta = ref<ReportingPaginationMeta>({
  total: 0,
  page: 1,
  perPage: 5,
  totalPages: 1
});
const alerts = ref<ReportingSnapshot['activityFeed']>([]);
const selectedReport = ref<ReportingItem | null>(null);
const activeSearch = ref('');
const departmentFilter = ref('All Departments');
const categoryFilter = ref('All Categories');
const itemsPerPage = ref(6);
const currentPage = ref(1);
const historyItemsPerPage = ref(6);
const historyCurrentPage = ref(1);
const completedSearch = ref('');
const completedStatus = ref('');
const completedDateFrom = ref('');
const completedDateTo = ref('');
const dialogMode = ref<'reconcile' | 'report' | 'archive' | 'discrepancy' | null>(null);
const correctionDialog = ref(false);
const correctionReport = ref<ReportingItem | null>(null);
const snackbar = ref(false);
const snackbarMessage = ref('');
const loading = ref(false);
const actionLoading = ref(false);
const errorMessage = ref('');
const realtime = useRealtimeListSync();
const departmentFilterOptions = computed(() => [
  'All Departments',
  ...new Set([...reportRows.value, ...completedRows.value].map((item) => item.sourceDepartment).filter(Boolean))
]);
const categoryFilterOptions = computed(() => [
  'All Categories',
  ...new Set([...reportRows.value, ...completedRows.value].map((item) => item.sourceCategory).filter(Boolean))
]);

function statusColor(status: ReportingStatus) {
  if (status === 'Archived') return 'secondary';
  if (status === 'Reported') return 'success';
  if (status === 'Reconciled') return 'info';
  if (status === 'With Discrepancy') return 'error';
  return 'warning';
}

function canReconcile(row: ReportingItem) {
  return row.status === 'Logged' || row.status === 'With Discrepancy';
}

function canSendToPmed(row: ReportingItem) {
  return row.status === 'Reconciled';
}

function canArchive(row: ReportingItem) {
  return row.status === 'Reported' || row.status === 'Archived';
}

function openDialog(mode: 'reconcile' | 'report' | 'archive' | 'discrepancy', row: ReportingItem) {
  selectedReport.value = row;
  dialogMode.value = mode;
}

function openCorrectionDialog(row: ReportingItem) {
  selectedReport.value = row;
  correctionReport.value = row;
  correctionDialog.value = true;
}

function dialogTitle() {
  if (dialogMode.value === 'reconcile') return 'Reconcile and Archive';
  if (dialogMode.value === 'report') return 'Send Financial Report to PMED';
  if (dialogMode.value === 'archive') return 'Archive Record';
  return '';
}

function dialogMessage() {
  if (!selectedReport.value) return '';
  if (dialogMode.value === 'reconcile') return `Match ${selectedReport.value.reference} with its payment and documentation records, then move it to archive?`;
  if (dialogMode.value === 'report') return `Send ${selectedReport.value.reference} to PMED as a cashier financial report package?`;
  if (dialogMode.value === 'archive') return `Archive ${selectedReport.value.reference} from the active reconciliation board?`;
  return '';
}

function formatActionMessage(response: { message?: string; next_module?: string }) {
  if (response.next_module) return `${response.message} Next queue: ${response.next_module}.`;
  return response.message || 'Reporting queue updated successfully.';
}

async function loadSnapshot(options: { silent?: boolean } = {}) {
  if (!options.silent) loading.value = true;
  errorMessage.value = '';
  try {
    const [snapshot, completed] = await Promise.all([
      fetchReportingSnapshot(),
      fetchCompletedTransactions({
        page: historyCurrentPage.value,
        perPage: historyItemsPerPage.value,
        search: completedSearch.value,
        status: completedStatus.value,
        department: departmentFilter.value !== 'All Departments' ? departmentFilter.value : '',
        category: categoryFilter.value !== 'All Categories' ? categoryFilter.value : '',
        dateFrom: completedDateFrom.value,
        dateTo: completedDateTo.value
      })
    ]);
    stats.value = snapshot.stats;
    reportRows.value = snapshot.items;
    completedRows.value = completed.items;
    completedMeta.value = completed.meta;
    alerts.value = snapshot.activityFeed;
    selectedReport.value =
      snapshot.items.find((item) => item.id === selectedReport.value?.id) ||
      completed.items.find((item) => item.id === selectedReport.value?.id) ||
      snapshot.items[0] ||
      completed.items[0] ||
      null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load reporting and reconciliation records.';
    if (message.toLowerCase().includes('authentication required')) {
      await auth.logout();
      return;
    }
    errorMessage.value = message;
  } finally {
    if (!options.silent) loading.value = false;
  }
}

async function exportCompletedTable() {
  actionLoading.value = true;
  try {
    const file = await exportCompletedTransactions({
      search: completedSearch.value,
      status: completedStatus.value,
      department: departmentFilter.value !== 'All Departments' ? departmentFilter.value : '',
      category: categoryFilter.value !== 'All Categories' ? categoryFilter.value : '',
      dateFrom: completedDateFrom.value,
      dateTo: completedDateTo.value
    });
    const blob = new Blob([file.content], { type: file.mimeType || 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.filename || 'completed-transactions.csv';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    snackbarMessage.value = 'Completed transactions export downloaded successfully.';
    snackbar.value = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to export completed transactions.';
    snackbarMessage.value = message;
    snackbar.value = true;
  } finally {
    actionLoading.value = false;
  }
}

async function submitCorrection(payload: { reason: string; remarks: string }) {
  if (!correctionReport.value) return;

  actionLoading.value = true;
  try {
    const response = await returnWorkflowRecordForCorrection({
      recordId: correctionReport.value.id,
      currentModule: 'reporting_reconciliation',
      reason: payload.reason,
      remarks: payload.remarks
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    correctionDialog.value = false;
    correctionReport.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to return reporting record for correction.';
    if (message.toLowerCase().includes('authentication required')) {
      await auth.logout();
      return;
    }
    snackbarMessage.value = message;
    snackbar.value = true;
  } finally {
    actionLoading.value = false;
  }
}

watch(reportRows, (items) => {
  selectedReport.value =
    items.find((item) => item.id === selectedReport.value?.id) ||
    completedRows.value.find((item) => item.id === selectedReport.value?.id) ||
    items[0] ||
    completedRows.value[0] ||
    null;
});

const reportContextFields = computed(() => {
  if (!selectedReport.value) return [];

  return [
    { label: 'Reference', value: selectedReport.value.reference },
    { label: 'Student Name', value: selectedReport.value.studentName },
    { label: 'Billing Code', value: selectedReport.value.billingCode },
    { label: 'Receipt Number', value: selectedReport.value.receiptNumber },
    { label: 'Connected Department', value: selectedReport.value.sourceDepartment },
    { label: 'Category Type', value: selectedReport.value.sourceCategory },
    { label: 'Amount', value: selectedReport.value.amount },
    { label: 'Workflow Stage', value: selectedReport.value.workflowStageLabel }
  ];
});

const reconcileInitialValues = computed(() => ({
  remarks: 'Payment and receipt records matched successfully.'
}));

const reportInitialValues = computed(() => ({
  remarks: 'Cashier financial report package sent to PMED.'
}));

const archiveInitialValues = computed(() => ({
  remarks: 'Archived after reconciliation completion.'
}));

const discrepancyInitialValues = computed(() => ({
  discrepancyType: 'Document mismatch',
  reason: 'Supporting records need manual review.',
  notes: 'Receipt and payment documents require additional validation.'
}));
const nextStepLabel = computed(() => {
  if (!selectedReport.value) return 'Select a reporting record to review its final cashier outcome.';
  if (selectedReport.value.status === 'Logged') return 'Reconcile the billing, payment, and receipt records before final reporting.';
  if (selectedReport.value.status === 'Reconciled') return 'Send this reconciled cashier financial report package to PMED Department.';
  if (selectedReport.value.status === 'Reported') return 'PMED already received this cashier report package. Archive it to move the record into completed history.';
  if (selectedReport.value.status === 'With Discrepancy') return 'Resolve the discrepancy or return the record to Compliance & Documentation.';
  return 'This record already completed the reporting workflow.';
});
const filteredReportRows = computed(() =>
  reportRows.value.filter((item) => {
    if (departmentFilter.value !== 'All Departments' && item.sourceDepartment !== departmentFilter.value) return false;
    if (categoryFilter.value !== 'All Categories' && item.sourceCategory !== categoryFilter.value) return false;
    if (activeSearch.value.trim()) {
      const needle = activeSearch.value.trim().toLowerCase();
      const haystack =
        `${item.reference} ${item.studentName} ${item.billingCode} ${item.receiptNumber} ${item.sourceDepartment} ${item.sourceCategory} ${item.paymentStatus} ${item.documentStatus} ${item.status} ${item.workflowStageLabel}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  })
);
const totalPages = computed(() => Math.max(1, Math.ceil(filteredReportRows.value.length / itemsPerPage.value)));
const historyTotalPages = computed(() => Math.max(1, Number(completedMeta.value.totalPages || 1)));
const paginatedReportRows = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value;
  return filteredReportRows.value.slice(start, start + itemsPerPage.value);
});
const activePageSummary = computed(() => {
  if (!filteredReportRows.value.length) return 'No active reconciliation records.';
  const first = (currentPage.value - 1) * itemsPerPage.value + 1;
  const last = Math.min(currentPage.value * itemsPerPage.value, filteredReportRows.value.length);
  return `Showing ${first}-${last} of ${filteredReportRows.value.length} active reconciliation record${filteredReportRows.value.length === 1 ? '' : 's'}`;
});
const historyPageSummary = computed(() => {
  if (!completedRows.value.length) return 'No completed transaction records.';
  const first = (Number(completedMeta.value.page || 1) - 1) * Number(completedMeta.value.perPage || historyItemsPerPage.value) + 1;
  const last = Math.min(first + completedRows.value.length - 1, Number(completedMeta.value.total || completedRows.value.length));
  const total = Number(completedMeta.value.total || completedRows.value.length);
  return `Showing ${first}-${last} of ${total} completed reporting record${total === 1 ? '' : 's'}`;
});

watch(itemsPerPage, () => {
  currentPage.value = 1;
});

watch(activeSearch, () => {
  currentPage.value = 1;
});

watch([departmentFilter, categoryFilter], () => {
  currentPage.value = 1;
  historyCurrentPage.value = 1;
  void loadSnapshot();
});

watch(historyItemsPerPage, () => {
  historyCurrentPage.value = 1;
  void loadSnapshot();
});

watch(totalPages, (value) => {
  if (currentPage.value > value) currentPage.value = value;
});

watch(historyTotalPages, (value) => {
  if (historyCurrentPage.value > value) historyCurrentPage.value = value;
});

watch(historyCurrentPage, () => {
  void loadSnapshot();
});

watch([completedStatus, completedDateFrom, completedDateTo], () => {
  historyCurrentPage.value = 1;
  void loadSnapshot();
});

let completedSearchTimer: ReturnType<typeof setTimeout> | null = null;
watch(completedSearch, () => {
  historyCurrentPage.value = 1;
  if (completedSearchTimer) clearTimeout(completedSearchTimer);
  completedSearchTimer = setTimeout(() => {
    void loadSnapshot({ silent: true });
  }, 250);
});

async function submitReconcileAction(formValues: Record<string, string | number>) {
  if (!selectedReport.value) return;

  actionLoading.value = true;
  try {
    const response = await reconcileWorkflowRecord({
      recordId: selectedReport.value.id,
      currentModule: 'reporting_reconciliation',
      remarks: String(formValues.remarks || '')
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    dialogMode.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to reconcile reporting record.';
    if (message.toLowerCase().includes('authentication required')) {
      await auth.logout();
      return;
    }
    snackbarMessage.value = message;
    snackbar.value = true;
  } finally {
    actionLoading.value = false;
  }
}

async function submitReportAction(formValues: Record<string, string | number>) {
  if (!selectedReport.value) return;

  actionLoading.value = true;
  try {
    const response = await reportReconciliationRecord({
      paymentId: selectedReport.value.id,
      remarks: String(formValues.remarks || '')
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    dialogMode.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to mark reporting record as reported.';
    if (message.toLowerCase().includes('authentication required')) {
      await auth.logout();
      return;
    }
    snackbarMessage.value = message;
    snackbar.value = true;
  } finally {
    actionLoading.value = false;
  }
}

async function submitArchiveAction(formValues: Record<string, string | number>) {
  if (!selectedReport.value) return;

  actionLoading.value = true;
  try {
    const response = await archiveReconciliationRecord({
      paymentId: selectedReport.value.id,
      remarks: String(formValues.remarks || '')
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    dialogMode.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to archive reporting record.';
    if (message.toLowerCase().includes('authentication required')) {
      await auth.logout();
      return;
    }
    snackbarMessage.value = message;
    snackbar.value = true;
  } finally {
    actionLoading.value = false;
  }
}

async function submitDiscrepancyAction(formValues: Record<string, string | number>) {
  if (!selectedReport.value) return;

  actionLoading.value = true;
  try {
    const response = await flagReconciliationDiscrepancy({
      paymentId: selectedReport.value.id,
      discrepancyType: String(formValues.discrepancyType || ''),
      reason: String(formValues.reason || ''),
      notes: String(formValues.notes || '')
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    dialogMode.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to flag discrepancy.';
    if (message.toLowerCase().includes('authentication required')) {
      await auth.logout();
      return;
    }
    snackbarMessage.value = message;
    snackbar.value = true;
  } finally {
    actionLoading.value = false;
  }
}

onMounted(() => {
  void loadSnapshot();
  realtime.startPolling(() => {
    void loadSnapshot({ silent: true });
  }, 0, { pauseWhenDialogOpen: false });
});

onUnmounted(() => {
  realtime.stopPolling();
  realtime.invalidatePending();
});
</script>

<template>
  <v-row>
    <v-col cols="12">
      <v-card class="hero-banner" elevation="0">
        <v-card-text class="pa-6">
          <div class="d-flex flex-column flex-lg-row justify-space-between ga-4">
            <div>
              <div class="hero-kicker">Completed Transactions</div>
              <h1 class="text-h4 font-weight-black mb-2">Completed Transactions</h1>
              <p class="hero-subtitle mb-0">
                Review finalized cashier records, archive completed transactions, and keep discrepancy or send-back handling available when needed.
              </p>
            </div>
            <div class="hero-side-panel">
            <div class="hero-side-label">Completion Flow</div>
            <div class="text-h6 font-weight-bold">Compliance -> Completed -> Archive</div>
            <div class="text-body-2">{{ reportRows.length }} active completion record{{ reportRows.length === 1 ? '' : 's' }} available</div>
          </div>
        </div>
      </v-card-text>
      </v-card>
    </v-col>

    <v-col v-for="card in stats" :key="card.title" cols="12" sm="6" lg="3">
      <CashierAnalyticsCard :title="card.title" :value="card.value" :subtitle="card.subtitle" :icon="card.icon" :tone="card.tone" />
    </v-col>

    <v-col cols="12" lg="8">
      <v-card class="panel-card" variant="outlined">
        <v-card-item>
          <v-card-title>Completed & Exception Board</v-card-title>
          <v-card-subtitle>Finalized cashier records, discrepancy items, and archive-ready transactions from compliance.</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">{{ errorMessage }}</v-alert>
          <div v-if="loading" class="py-10 text-center">
            <v-progress-circular indeterminate color="primary" />
          </div>
          <div v-else>
            <div class="toolbar-row mb-4">
              <div class="text-body-2 text-medium-emphasis">{{ activePageSummary }}</div>
              <div class="toolbar-controls">
                <v-text-field
                  v-model="activeSearch"
                  :prepend-inner-icon="mdiMagnify"
                  label="Search reporting records"
                  density="compact"
                  variant="outlined"
                  hide-details
                  class="completed-search"
                />
                <v-btn
                  v-if="activeSearch || departmentFilter !== 'All Departments' || categoryFilter !== 'All Categories'"
                  size="small"
                  variant="text"
                  color="primary"
                  prepend-icon="mdi-filter-remove-outline"
                  @click="activeSearch = ''; departmentFilter = 'All Departments'; categoryFilter = 'All Categories'"
                >
                  Clear Filters
                </v-btn>
                <v-select
                  v-model="departmentFilter"
                  :items="departmentFilterOptions"
                  label="Connected department"
                  density="compact"
                  variant="outlined"
                  hide-details
                  class="toolbar-select"
                />
                <v-select
                  v-model="categoryFilter"
                  :items="categoryFilterOptions"
                  label="Category type"
                  density="compact"
                  variant="outlined"
                  hide-details
                  class="toolbar-select"
                />
                <v-select
                  v-model="itemsPerPage"
                  :items="[6, 10]"
                  label="Rows per page"
                  density="compact"
                  variant="outlined"
                  hide-details
                  class="toolbar-select"
                />
              </div>
            </div>
            <div class="report-list">
            <div v-for="row in paginatedReportRows" :key="row.id" class="report-row" @click="selectedReport = row">
              <div>
                <div class="font-weight-bold">{{ row.reference }}</div>
                <div class="text-body-2 text-medium-emphasis">{{ row.studentName }} | {{ row.billingCode }} | {{ row.amount }}</div>
                <div class="text-body-2 text-medium-emphasis">{{ row.sourceDepartment }} | {{ row.sourceCategory }}</div>
                <div class="text-body-2 text-medium-emphasis">{{ row.paymentStatus }} | {{ row.documentStatus }} | {{ row.postedAt }}</div>
                <div v-if="row.allocationSummary" class="text-body-2 text-medium-emphasis mt-1">{{ row.allocationSummary }}</div>
              </div>
              <div class="report-side">
                <v-chip size="small" :color="statusColor(row.status)" variant="tonal">{{ row.status }}</v-chip>
                <div class="report-actions">
                  <CashierActionButton :icon="mdiCheckDecagramOutline" label="Reconcile" color="primary" variant="text" compact :disabled="!canReconcile(row)" @click.stop="openDialog('reconcile', row)" />
                  <CashierActionButton :icon="mdiFileChartOutline" label="Send to PMED" color="secondary" variant="text" compact :disabled="!canSendToPmed(row)" @click.stop="openDialog('report', row)" />
                  <CashierActionButton :icon="mdiFileChartOutline" label="Discrepancy" color="warning" variant="text" compact @click.stop="openDialog('discrepancy', row)" />
                  <CashierActionButton :icon="mdiArchiveOutline" label="Correction" color="error" variant="text" compact @click.stop="openCorrectionDialog(row)" />
                  <CashierActionButton :icon="mdiArchiveOutline" label="Archive" color="warning" variant="text" compact :disabled="!canArchive(row)" @click.stop="openDialog('archive', row)" />
                </div>
              </div>
            </div>
            </div>
            <div v-if="!filteredReportRows.length" class="text-body-2 text-medium-emphasis py-8 text-center">No reporting records are available yet.</div>
            <div v-if="filteredReportRows.length" class="d-flex flex-column flex-sm-row justify-space-between align-start align-sm-center ga-3 mt-4">
              <div class="text-body-2 text-medium-emphasis">{{ activePageSummary }}</div>
              <v-pagination v-model="currentPage" :length="totalPages" density="comfortable" total-visible="5" />
            </div>
          </div>
        </v-card-text>
      </v-card>

      <v-card class="panel-card mt-6" variant="outlined">
        <v-card-item>
          <v-card-title>Completed Payments Table</v-card-title>
          <v-card-subtitle>{{ completedMeta.total }} record{{ completedMeta.total === 1 ? '' : 's' }} already finalized and moved into completed history</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div v-if="completedRows.length">
            <div class="toolbar-row mb-4">
              <div class="completed-toolbar-copy">
                <div class="text-body-2 text-medium-emphasis">{{ historyPageSummary }}</div>
                <div class="completed-filter-row">
                  <v-text-field
                    v-model="completedSearch"
                    :prepend-inner-icon="mdiMagnify"
                    label="Search completed payments"
                    density="compact"
                    variant="outlined"
                    hide-details
                    class="completed-search"
                  />
                  <v-select
                    v-model="completedStatus"
                    :items="['', 'Archived', 'Reported', 'Reconciled', 'With Discrepancy']"
                    label="Final status"
                    density="compact"
                    variant="outlined"
                    hide-details
                    class="completed-filter"
                  />
                  <v-select
                    v-model="departmentFilter"
                    :items="departmentFilterOptions"
                    label="Connected department"
                    density="compact"
                    variant="outlined"
                    hide-details
                    class="completed-filter"
                  />
                  <v-select
                    v-model="categoryFilter"
                    :items="categoryFilterOptions"
                    label="Category type"
                    density="compact"
                    variant="outlined"
                    hide-details
                    class="completed-filter"
                  />
                  <v-text-field
                    v-model="completedDateFrom"
                    label="Date from"
                    type="date"
                    density="compact"
                    variant="outlined"
                    hide-details
                    class="completed-filter"
                  />
                  <v-text-field
                    v-model="completedDateTo"
                    label="Date to"
                    type="date"
                    density="compact"
                    variant="outlined"
                    hide-details
                    class="completed-filter"
                  />
                </div>
              </div>
              <div class="toolbar-controls">
                <CashierActionButton
                  :icon="mdiDownloadOutline"
                  label="Export"
                  color="secondary"
                  variant="outlined"
                  compact
                  @click="exportCompletedTable"
                />
                <v-select
                  v-model="historyItemsPerPage"
                  :items="[6, 10]"
                  label="Rows per page"
                  density="compact"
                  variant="outlined"
                  hide-details
                  class="toolbar-select"
                />
              </div>
            </div>
            <div class="completed-table-wrap">
              <table class="completed-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Student</th>
                    <th>Billing Code</th>
                    <th>Department</th>
                    <th>Category</th>
                    <th>Receipt No.</th>
                    <th>Amount</th>
                    <th>Payment</th>
                    <th>Documentation</th>
                    <th>Fee Breakdown</th>
                    <th>Final Status</th>
                    <th>Stage</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in completedRows" :key="`history-${row.id}`">
                    <td class="font-weight-bold">{{ row.reference }}</td>
                    <td>{{ row.studentName }}</td>
                    <td>{{ row.billingCode }}</td>
                    <td>{{ row.sourceDepartment }}</td>
                    <td>{{ row.sourceCategory }}</td>
                    <td>{{ row.receiptNumber || 'Pending Receipt' }}</td>
                    <td>{{ row.amount }}</td>
                    <td>{{ row.paymentStatus }}</td>
                    <td>{{ row.documentStatus }}</td>
                    <td>{{ row.allocationSummary || 'No fee lines' }}</td>
                    <td>
                      <v-chip size="small" color="success" variant="tonal">{{ row.status }}</v-chip>
                    </td>
                    <td>
                      <v-chip size="small" color="secondary" variant="tonal">{{ row.workflowStageLabel }}</v-chip>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="d-flex flex-column flex-sm-row justify-space-between align-start align-sm-center ga-3 mt-4">
              <div class="text-body-2 text-medium-emphasis">{{ historyPageSummary }}</div>
              <v-pagination v-model="historyCurrentPage" :length="historyTotalPages" density="comfortable" total-visible="5" />
            </div>
          </div>
          <div v-else class="text-body-2 text-medium-emphasis py-8 text-center">No archived reporting records yet.</div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="4" class="focus-column">
      <v-card class="panel-card mb-6" variant="outlined">
        <v-card-item>
          <v-card-title>Completion Focus</v-card-title>
          <v-card-subtitle>Selected final-stage cashier record</v-card-subtitle>
        </v-card-item>
        <v-card-text v-if="selectedReport">
          <div class="focus-banner mb-4">
            <div class="text-overline">Current Record</div>
            <div class="text-h6 font-weight-bold">{{ selectedReport.reference }}</div>
            <div class="text-body-2">{{ selectedReport.studentName }} | {{ selectedReport.amount }}</div>
          </div>
          <div class="focus-next-step mb-4">
            <div class="metric-label mb-1">Next Step</div>
            <div class="text-body-2">{{ nextStepLabel }}</div>
          </div>
          <v-list density="comfortable" class="py-0">
            <v-list-item title="Connected department" :subtitle="selectedReport.sourceDepartment" />
            <v-list-item title="Category type" :subtitle="selectedReport.sourceCategory" />
            <v-list-item title="Billing code" :subtitle="selectedReport.billingCode" />
            <v-list-item title="Receipt number" :subtitle="selectedReport.receiptNumber" />
            <v-list-item title="Payment status" :subtitle="selectedReport.paymentStatus" />
            <v-list-item title="Documentation" :subtitle="selectedReport.documentStatus" />
            <v-list-item title="Reporting status" :subtitle="selectedReport.status" />
            <v-list-item title="Workflow stage" :subtitle="selectedReport.workflowStageLabel" />
          </v-list>
          <div v-if="selectedReport.allocationSummary" class="focus-allocation-summary mt-4">
            <div class="metric-label mb-2">Fee Allocation</div>
            <div class="text-body-2 text-medium-emphasis">{{ selectedReport.allocationSummary }}</div>
          </div>
        </v-card-text>
      </v-card>

      <v-card class="panel-card" variant="outlined">
        <v-card-item>
          <v-card-title>Completion Alerts</v-card-title>
          <v-card-subtitle>PMED report requests, archive updates, discrepancy flags, and send-back notifications</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div v-for="item in alerts" :key="item.title + item.time" class="alert-card">
            <div class="d-flex align-center justify-space-between ga-3 mb-1">
              <div class="font-weight-bold">{{ item.title }}</div>
              <v-chip size="x-small" color="primary" variant="tonal">{{ item.time }}</v-chip>
            </div>
            <div class="text-body-2 text-medium-emphasis">{{ item.detail }}</div>
          </div>
          <div v-if="!alerts.length" class="text-body-2 text-medium-emphasis">No PMED report requests or reporting alerts yet.</div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12">
      <ModuleActivityLogs module="reports" title="Completed Transactions Activity Logs" :per-page="6" />
    </v-col>

    <WorkflowActionDialog
      v-if="dialogMode === 'reconcile'"
      :model-value="true"
      :loading="actionLoading"
      title="Reconcile Record"
      subtitle="Match the payment, billing, and receipt data before this record is moved into the archived completed queue."
      chip-label="Reconcile"
      chip-color="primary"
      confirm-label="Reconcile Record"
      confirm-color="primary"
      :context-fields="reportContextFields"
      :fields="[
        {
          key: 'remarks',
          label: 'Reconciliation Remarks',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Add reconciliation notes before finalizing this record.'
        }
      ]"
      :initial-values="reconcileInitialValues"
      @update:model-value="dialogMode = $event ? dialogMode : null"
      @submit="submitReconcileAction"
    />

    <WorkflowActionDialog
      v-else-if="dialogMode === 'report'"
      :model-value="true"
      :loading="actionLoading"
      title="Send Cashier Financial Report to PMED"
      subtitle="Create a structured cashier financial report package and deliver it to PMED as an inbound department report."
      chip-label="Send to PMED"
      chip-color="secondary"
      confirm-label="Send to PMED"
      confirm-color="secondary"
      :context-fields="reportContextFields"
      :fields="[
        {
          key: 'remarks',
          label: 'PMED Handoff Remarks',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Add PMED-facing notes for this financial report package.'
        }
      ]"
      :initial-values="reportInitialValues"
      @update:model-value="dialogMode = $event ? dialogMode : null"
      @submit="submitReportAction"
    />

    <WorkflowActionDialog
      v-else-if="dialogMode === 'archive'"
      :model-value="true"
      :loading="actionLoading"
      title="Archive Record"
      subtitle="Move this completed record out of the active reconciliation queue and keep it in history for audit purposes."
      chip-label="Archive"
      chip-color="warning"
      confirm-label="Archive Record"
      confirm-color="warning"
      :context-fields="reportContextFields"
      :fields="[
        {
          key: 'remarks',
          label: 'Archive Remarks',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Add archive notes for this finalized transaction.'
        }
      ]"
      :initial-values="archiveInitialValues"
      @update:model-value="dialogMode = $event ? dialogMode : null"
      @submit="submitArchiveAction"
    />

    <WorkflowActionDialog
      v-else-if="dialogMode === 'discrepancy'"
      :model-value="true"
      :loading="actionLoading"
      title="Flag Discrepancy"
      subtitle="Record the mismatch details and keep this item in the active reporting queue until it is corrected."
      chip-label="Discrepancy"
      chip-color="warning"
      confirm-label="Flag Discrepancy"
      confirm-color="warning"
      :context-fields="reportContextFields"
      :fields="[
        {
          key: 'discrepancyType',
          label: 'Discrepancy Type',
          type: 'select',
          required: true,
          items: ['Document mismatch', 'Receipt missing', 'Amount mismatch', 'Proof not verified']
        },
        {
          key: 'reason',
          label: 'Reason',
          type: 'text',
          required: true,
          placeholder: 'Summarize the issue'
        },
        {
          key: 'notes',
          label: 'Notes',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Add investigation notes for this discrepancy.'
        }
      ]"
      :initial-values="discrepancyInitialValues"
      @update:model-value="dialogMode = $event ? dialogMode : null"
      @submit="submitDiscrepancyAction"
    />

    <WorkflowCorrectionDialog
      v-model="correctionDialog"
      :loading="actionLoading"
      :record-label="correctionReport?.reference || 'reporting record'"
      current-module-label="Reporting & Reconciliation"
      target-module-label="Compliance & Documentation"
      :reason-options="[
        'Receipt missing',
        'Document mismatch',
        'Reconciliation discrepancy caused by incomplete documentation',
        'Proof not verified'
      ]"
      @submit="submitCorrection"
    />

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

.toolbar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.toolbar-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.completed-toolbar-copy {
  display: grid;
  gap: 12px;
  flex: 1 1 560px;
}

.completed-filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.completed-search {
  min-width: 240px;
  flex: 1 1 260px;
}

.completed-filter {
  min-width: 150px;
  max-width: 180px;
}

.toolbar-select {
  max-width: 140px;
  min-width: 120px;
}

.report-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 14px;
}

.completed-table-wrap {
  overflow-x: auto;
  border: 1px solid rgba(189, 157, 120, 0.18);
  border-radius: 16px;
  background: linear-gradient(180deg, #fff 0%, #fbf7f1 100%);
}

.completed-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 920px;
}

.completed-table th,
.completed-table td {
  padding: 14px 16px;
  text-align: left;
  border-bottom: 1px solid rgba(189, 157, 120, 0.14);
  vertical-align: middle;
}

.completed-table th {
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #73809b;
  font-weight: 800;
  background: rgba(29, 75, 150, 0.04);
}

.completed-table tbody tr:last-child td {
  border-bottom: 0;
}

.report-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  height: 100%;
  padding: 16px;
  border-radius: 16px;
  background: linear-gradient(180deg, #fff 0%, #fbf7f1 100%);
  border: 1px solid rgba(189, 157, 120, 0.18);
  cursor: pointer;
}

.report-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}

.report-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.focus-column {
  position: sticky;
  top: 88px;
  align-self: start;
  max-height: calc(100vh - 112px);
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 6px;
  scrollbar-width: thin;
  scrollbar-color: rgba(33, 80, 166, 0.28) transparent;
}

.focus-column::-webkit-scrollbar {
  width: 8px;
}

.focus-column::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(33, 80, 166, 0.22);
}

.focus-column::-webkit-scrollbar-track {
  background: transparent;
}

.focus-banner {
  padding: 18px;
  border-radius: 16px;
  color: #fff;
  background: linear-gradient(135deg, #1d4b96 0%, #3579c9 100%);
}

.focus-next-step {
  padding: 14px 16px;
  border-radius: 14px;
  background: #f6f9ff;
  border: 1px solid rgba(78, 107, 168, 0.14);
}

.focus-allocation-summary {
  padding: 14px 16px;
  border-radius: 14px;
  background: linear-gradient(180deg, #f7fbff 0%, #f3f7fb 100%);
  border: 1px solid rgba(66, 110, 182, 0.12);
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
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.18);
}

@media (max-width: 959px) {
  .report-row {
    flex-direction: column;
  }

  .report-side {
    align-items: flex-start;
  }

  .report-actions {
    justify-content: flex-start;
  }

  .completed-filter {
    max-width: none;
    flex: 1 1 180px;
  }

  .focus-column {
    position: static;
    max-height: none;
    overflow: visible;
    padding-right: 0;
  }
}
</style>




