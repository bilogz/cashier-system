<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { mdiDeleteClockOutline, mdiDownloadOutline, mdiMagnify, mdiSendCheckOutline } from '@mdi/js';
import CashierAnalyticsCard from '@/components/shared/CashierAnalyticsCard.vue';
import CashierActionButton from '@/components/shared/CashierActionButton.vue';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';
import WorkflowActionDialog from '@/components/shared/WorkflowActionDialog.vue';
import WorkflowCorrectionDialog from '@/components/shared/WorkflowCorrectionDialog.vue';
import { useAuthStore } from '@/stores/auth';
import {
  fetchReceiptSnapshot,
  type ReceiptQueueItem,
  type ReceiptSnapshot,
  type ReceiptStatus
} from '@/services/cashierFlow';
import { returnWorkflowRecordForCorrection } from '@/services/workflowCorrections';
import { generateReceiptWorkflowRecord } from '@/services/workflowActions';
import { completeComplianceDocumentation, verifyComplianceProof } from '@/services/workflowCrudActions';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';

const auth = useAuthStore();
const stats = ref<ReceiptSnapshot['stats']>([]);
const receiptItems = ref<ReceiptQueueItem[]>([]);
const receiptHistoryItems = ref<ReceiptQueueItem[]>([]);
const alerts = ref<ReceiptSnapshot['activityFeed']>([]);
const selectedReceipt = ref<ReceiptQueueItem | null>(null);
const search = ref('');
const departmentFilter = ref('All Departments');
const categoryFilter = ref('All Categories');
const itemsPerPage = ref(6);
const currentPage = ref(1);
const historyItemsPerPage = ref(6);
const historyCurrentPage = ref(1);
const dialogMode = ref<'generate' | 'verify' | 'complete' | null>(null);
const correctionDialog = ref(false);
const correctionReceipt = ref<ReceiptQueueItem | null>(null);
const snackbar = ref(false);
const snackbarMessage = ref('');
const loading = ref(false);
const actionLoading = ref(false);
const errorMessage = ref('');
const realtime = useRealtimeListSync();
const departmentFilterOptions = computed(() => [
  'All Departments',
  ...new Set([...receiptItems.value, ...receiptHistoryItems.value].map((item) => item.sourceDepartment).filter(Boolean))
]);
const categoryFilterOptions = computed(() => [
  'All Categories',
  ...new Set([...receiptItems.value, ...receiptHistoryItems.value].map((item) => item.sourceCategory).filter(Boolean))
]);

function statusColor(status: ReceiptStatus) {
  if (status === 'Documentation Completed') return 'success';
  if (status === 'Proof Verified') return 'info';
  if (status === 'Receipt Generated') return 'primary';
  return 'warning';
}

function hasSuccessfulPayment(item: ReceiptQueueItem) {
  return item.paymentStatus === 'Paid';
}

function canGenerateReceipt(item: ReceiptQueueItem) {
  return hasSuccessfulPayment(item) && item.status === 'Receipt Pending';
}

function canVerifyProof(item: ReceiptQueueItem) {
  return hasSuccessfulPayment(item) && item.status === 'Receipt Generated';
}

function canCompleteDocumentation(item: ReceiptQueueItem) {
  return item.status === 'Proof Verified';
}

function actionValidationMessage(mode: 'generate' | 'verify' | 'complete', item: ReceiptQueueItem) {
  if (mode === 'generate') {
    if (!hasSuccessfulPayment(item)) return 'Receipt generation is only allowed after successful payment.';
    if (item.status !== 'Receipt Pending') return 'Receipt has already been generated or advanced to the next compliance step.';
  }

  if (mode === 'verify') {
    if (!hasSuccessfulPayment(item)) return 'Proof verification is only allowed after successful payment.';
    if (item.status !== 'Receipt Generated') return 'Generate the receipt first before verifying proof of payment.';
  }

  if (mode === 'complete' && item.status !== 'Proof Verified') {
    return 'Proof verification must be completed before final documentation.';
  }

  return '';
}

function openDialog(mode: 'generate' | 'verify' | 'complete', item: ReceiptQueueItem) {
  const validationMessage = actionValidationMessage(mode, item);
  if (validationMessage) {
    snackbarMessage.value = validationMessage;
    snackbar.value = true;
    return;
  }
  selectedReceipt.value = item;
  dialogMode.value = mode;
}

function openCorrectionDialog(item: ReceiptQueueItem) {
  selectedReceipt.value = item;
  correctionReceipt.value = item;
  correctionDialog.value = true;
}

function dialogTitle() {
  if (dialogMode.value === 'generate') return 'Generate Receipt';
  if (dialogMode.value === 'verify') return 'Verify Proof of Payment';
  if (dialogMode.value === 'complete') return 'Complete Documentation';
  return '';
}

function dialogMessage() {
  if (!selectedReceipt.value) return '';
  if (dialogMode.value === 'generate') return `Generate the receipt package for ${selectedReceipt.value.receiptNo}?`;
  if (dialogMode.value === 'verify') return `Verify the payment proof for ${selectedReceipt.value.receiptNo}?`;
  if (dialogMode.value === 'complete') return `Complete the documentation package for ${selectedReceipt.value.receiptNo}?`;
  return '';
}

function formatActionMessage(response: { message?: string; next_module?: string }) {
  if (response.next_module) return `${response.message} Next queue: ${response.next_module}.`;
  return response.message || 'Documentation queue updated successfully.';
}

async function loadSnapshot(options: { silent?: boolean } = {}) {
  if (!options.silent) loading.value = true;
  errorMessage.value = '';
  try {
    const snapshot = await fetchReceiptSnapshot();
    stats.value = snapshot.stats;
    receiptItems.value = snapshot.items;
    receiptHistoryItems.value = snapshot.historyItems;
    alerts.value = snapshot.activityFeed;
    selectedReceipt.value = snapshot.items.find((item) => item.id === selectedReceipt.value?.id) || snapshot.items[0] || null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load receipt queue.';
    if (message.toLowerCase().includes('authentication required')) {
      await auth.logout();
      return;
    }
    errorMessage.value = message;
  } finally {
    if (!options.silent) loading.value = false;
  }
}

async function submitCorrection(payload: { reason: string; remarks: string }) {
  if (!correctionReceipt.value) return;

  actionLoading.value = true;
  try {
    const response = await returnWorkflowRecordForCorrection({
      recordId: correctionReceipt.value.id,
      currentModule: 'compliance_documentation',
      reason: payload.reason,
      remarks: payload.remarks
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    correctionDialog.value = false;
    correctionReceipt.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to return compliance record for correction.';
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

watch(receiptItems, (items) => {
  selectedReceipt.value = items.find((item) => item.id === selectedReceipt.value?.id) || items[0] || null;
});

const receiptContextFields = computed(() => {
  if (!selectedReceipt.value) return [];

  return [
    { label: 'Student Name', value: selectedReceipt.value.studentName },
    { label: 'Receipt Number', value: selectedReceipt.value.receiptNo },
    { label: 'Payment Reference', value: selectedReceipt.value.paymentRef },
    { label: 'Payment Method', value: selectedReceipt.value.paymentMethod },
    { label: 'Payment Status', value: selectedReceipt.value.paymentStatus },
    { label: 'Billing Code', value: selectedReceipt.value.issuedFor },
    { label: 'Source Module', value: selectedReceipt.value.sourceModule },
    { label: 'Connected Department', value: selectedReceipt.value.sourceDepartment },
    { label: 'Category Type', value: selectedReceipt.value.sourceCategory },
    { label: 'Amount', value: selectedReceipt.value.amount },
    { label: 'Workflow Stage', value: selectedReceipt.value.workflowStageLabel }
  ];
});

const generateInitialValues = computed(() => ({
  receiptType: 'Official Receipt',
  issueDate: new Date().toISOString().slice(0, 10),
  remarks: 'Official receipt generated.'
}));

const verifyInitialValues = computed(() => ({
  proofType:
    selectedReceipt.value?.paymentMethod?.toLowerCase().includes('cash') ? 'Cash Payment Slip'
      : selectedReceipt.value?.paymentMethod?.toLowerCase().includes('bank') ? 'Bank Account Validation'
      : selectedReceipt.value?.paymentMethod?.toLowerCase().includes('hma') ? 'HMA Payment Confirmation'
      : 'Proof of Payment',
  verifiedBy: auth.user?.fullName || auth.user?.username || 'Compliance Staff',
  decision: 'Verified',
  verificationNotes: 'Proof of payment reviewed and accepted.'
}));

const completeInitialValues = computed(() => ({
  checklistSummary: 'Payment, receipt, and proof of payment are complete.',
  finalDecision: 'Completed',
  completionNotes: 'Documentation package completed and ready for Reporting & Reconciliation.'
}));

const receiptPreviewNumber = computed(() => {
  if (!selectedReceipt.value) return 'Pending Receipt Number';
  return selectedReceipt.value.receiptNo || 'Pending Receipt Number';
});

const receiptPreviewAmount = computed(() => selectedReceipt.value?.amount || 'P0.00');

const nextStepLabel = computed(() => {
  if (!selectedReceipt.value) return 'Select a documentation record to review its next cashier handoff.';
  if (selectedReceipt.value.status === 'Receipt Pending' && selectedReceipt.value.paymentStatus !== 'Paid') {
    return 'Wait for a successful paid transaction before generating the receipt.';
  }
  if (selectedReceipt.value.status === 'Receipt Pending') return 'Generate the receipt first so the documentation package can continue.';
  if (selectedReceipt.value.status === 'Receipt Generated') return 'Verify the proof of payment before completing the documentation package.';
  if (selectedReceipt.value.status === 'Proof Verified') return 'Complete Documentation to move this record into Reporting & Reconciliation.';
  return 'This documentation package is ready for the next reporting step.';
});
const filteredReceiptItems = computed(() =>
  receiptItems.value.filter((item) => {
    if (departmentFilter.value !== 'All Departments' && item.sourceDepartment !== departmentFilter.value) return false;
    if (categoryFilter.value !== 'All Categories' && item.sourceCategory !== categoryFilter.value) return false;
    if (search.value.trim()) {
      const needle = search.value.trim().toLowerCase();
      const haystack =
        `${item.receiptNo} ${item.studentName} ${item.paymentRef} ${item.paymentMethod} ${item.issuedFor} ${item.sourceDepartment} ${item.sourceCategory} ${item.status} ${item.workflowStageLabel}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  })
);
const filteredReceiptHistoryItems = computed(() =>
  receiptHistoryItems.value.filter((item) => {
    if (departmentFilter.value !== 'All Departments' && item.sourceDepartment !== departmentFilter.value) return false;
    if (categoryFilter.value !== 'All Categories' && item.sourceCategory !== categoryFilter.value) return false;
    if (search.value.trim()) {
      const needle = search.value.trim().toLowerCase();
      const haystack =
        `${item.receiptNo} ${item.studentName} ${item.paymentRef} ${item.paymentMethod} ${item.issuedFor} ${item.sourceDepartment} ${item.sourceCategory} ${item.status} ${item.workflowStageLabel}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  })
);
const totalPages = computed(() => Math.max(1, Math.ceil(filteredReceiptItems.value.length / itemsPerPage.value)));
const historyTotalPages = computed(() => Math.max(1, Math.ceil(filteredReceiptHistoryItems.value.length / historyItemsPerPage.value)));
const paginatedReceiptItems = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value;
  return filteredReceiptItems.value.slice(start, start + itemsPerPage.value);
});
const paginatedReceiptHistoryItems = computed(() => {
  const start = (historyCurrentPage.value - 1) * historyItemsPerPage.value;
  return filteredReceiptHistoryItems.value.slice(start, start + historyItemsPerPage.value);
});
const activePageSummary = computed(() => {
  if (!filteredReceiptItems.value.length) return 'No active compliance records.';
  const first = (currentPage.value - 1) * itemsPerPage.value + 1;
  const last = Math.min(currentPage.value * itemsPerPage.value, filteredReceiptItems.value.length);
  return `Showing ${first}-${last} of ${filteredReceiptItems.value.length} active documentation record${filteredReceiptItems.value.length === 1 ? '' : 's'}`;
});
const historyPageSummary = computed(() => {
  if (!filteredReceiptHistoryItems.value.length) return 'No compliance history records.';
  const first = (historyCurrentPage.value - 1) * historyItemsPerPage.value + 1;
  const last = Math.min(historyCurrentPage.value * historyItemsPerPage.value, filteredReceiptHistoryItems.value.length);
  return `Showing ${first}-${last} of ${filteredReceiptHistoryItems.value.length} moved documentation record${filteredReceiptHistoryItems.value.length === 1 ? '' : 's'}`;
});

watch(itemsPerPage, () => {
  currentPage.value = 1;
});

watch(historyItemsPerPage, () => {
  historyCurrentPage.value = 1;
});

watch([search, departmentFilter, categoryFilter], () => {
  currentPage.value = 1;
  historyCurrentPage.value = 1;
});

watch(totalPages, (value) => {
  if (currentPage.value > value) currentPage.value = value;
});

watch(historyTotalPages, (value) => {
  if (historyCurrentPage.value > value) historyCurrentPage.value = value;
});

async function submitGenerateAction(formValues: Record<string, string | number>) {
  if (!selectedReceipt.value) return;
  if (!canGenerateReceipt(selectedReceipt.value)) {
    snackbarMessage.value = actionValidationMessage('generate', selectedReceipt.value);
    snackbar.value = true;
    return;
  }

  actionLoading.value = true;
  try {
    const response = await generateReceiptWorkflowRecord({
      recordId: selectedReceipt.value.id,
      currentModule: 'compliance_documentation',
      receiptType: String(formValues.receiptType || 'Official Receipt'),
      remarks: `${String(formValues.remarks || '')}${formValues.issueDate ? ` | Issue Date: ${String(formValues.issueDate)}` : ''}`
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    dialogMode.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate receipt.';
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

async function submitVerifyAction(formValues: Record<string, string | number>) {
  if (!selectedReceipt.value) return;
  if (!canVerifyProof(selectedReceipt.value)) {
    snackbarMessage.value = actionValidationMessage('verify', selectedReceipt.value);
    snackbar.value = true;
    return;
  }

  actionLoading.value = true;
  try {
    const response = await verifyComplianceProof({
      paymentId: selectedReceipt.value.id,
      proofType: String(formValues.proofType || 'Proof of Payment'),
      verifiedBy: String(formValues.verifiedBy || auth.user?.fullName || auth.user?.username || 'Compliance Staff'),
      decision: String(formValues.decision || 'Verified'),
      verificationNotes: String(formValues.verificationNotes || '')
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    dialogMode.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to verify proof document.';
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

async function submitCompleteAction(formValues: Record<string, string | number>) {
  if (!selectedReceipt.value) return;
  if (!canCompleteDocumentation(selectedReceipt.value)) {
    snackbarMessage.value = actionValidationMessage('complete', selectedReceipt.value);
    snackbar.value = true;
    return;
  }

  actionLoading.value = true;
  try {
    const response = await completeComplianceDocumentation({
      paymentId: selectedReceipt.value.id,
      checklistSummary: String(formValues.checklistSummary || ''),
      finalDecision: String(formValues.finalDecision || 'Completed'),
      completionNotes: String(formValues.completionNotes || '')
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    dialogMode.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to complete compliance documentation.';
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
              <div class="hero-kicker">Compliance & Documentation</div>
              <h1 class="text-h4 font-weight-black mb-2">Compliance & Documentation</h1>
              <p class="hero-subtitle mb-0">Generate proof of payment, verify documentation, and complete cashier compliance records.</p>
            </div>
            <div class="hero-side-panel">
              <div class="hero-side-label">Documentation Flow</div>
              <div class="text-h6 font-weight-bold">Paid -> Receipt -> Proof -> Completed</div>
              <div class="text-body-2">{{ receiptItems.length }} documentation record{{ receiptItems.length === 1 ? '' : 's' }} available</div>
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
          <v-card-title>Compliance Board</v-card-title>
          <v-card-subtitle>Manage receipt generation, proof verification, and final documentation completion.</v-card-subtitle>
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
                  v-model="search"
                  :prepend-inner-icon="mdiMagnify"
                  label="Search receipt, payment, or department"
                  density="compact"
                  variant="outlined"
                  hide-details
                  class="toolbar-search"
                />
                <v-btn
                  v-if="search || departmentFilter !== 'All Departments' || categoryFilter !== 'All Categories'"
                  size="small"
                  variant="text"
                  color="primary"
                  prepend-icon="mdi-filter-remove-outline"
                  @click="search = ''; departmentFilter = 'All Departments'; categoryFilter = 'All Categories'"
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
            <v-row>
            <v-col v-for="item in paginatedReceiptItems" :key="item.id" cols="12" md="6">
              <v-card class="entry-card" elevation="0">
                <v-card-text class="pa-4">
                  <div class="d-flex flex-column flex-xl-row justify-space-between ga-4">
                    <div class="flex-grow-1">
                      <div class="d-flex flex-wrap align-center ga-3 mb-3">
                        <div class="text-subtitle-1 font-weight-bold">{{ item.studentName }}</div>
                        <v-chip size="small" :color="statusColor(item.status)" variant="tonal">{{ item.status }}</v-chip>
                        <v-chip size="small" color="primary" variant="outlined">{{ item.receiptNo }}</v-chip>
                        <v-chip size="small" :color="item.sourceModule === 'Clinic' ? 'warning' : 'secondary'" variant="tonal">{{ item.sourceDepartment }}</v-chip>
                      </div>
                      <div class="entry-grid">
                        <div>
                          <div class="metric-label">Payment Ref</div>
                          <div class="meta-value">{{ item.paymentRef }}</div>
                        </div>
                        <div>
                          <div class="metric-label">Payment Status</div>
                          <div class="meta-value">{{ item.paymentStatus }}</div>
                        </div>
                        <div>
                          <div class="metric-label">Amount</div>
                          <div class="meta-value">{{ item.amount }}</div>
                        </div>
                        <div>
                          <div class="metric-label">Issued For</div>
                          <div class="meta-value">{{ item.issuedFor }}</div>
                        </div>
                        <div>
                          <div class="metric-label">Category Type</div>
                          <div class="meta-value">{{ item.sourceCategory }}</div>
                        </div>
                        <div>
                          <div class="metric-label">Receipt Status</div>
                          <div class="meta-value">{{ item.status }}</div>
                        </div>
                      </div>
                      <div v-if="item.receiptItems?.length" class="allocation-summary-card mt-4">
                        <div class="metric-label mb-2">Paid Fee Breakdown</div>
                        <div class="allocation-list">
                          <div v-for="allocation in item.receiptItems" :key="allocation.id" class="allocation-row">
                            <span>{{ allocation.feeType }}</span>
                            <strong>{{ allocation.allocatedAmountFormatted }}</strong>
                          </div>
                        </div>
                      </div>
                      <div class="entry-note mt-4">{{ item.note }}</div>
                    </div>
                    <div class="entry-actions">
                      <CashierActionButton :icon="mdiSendCheckOutline" label="Generate Receipt" color="primary" :disabled="!canGenerateReceipt(item)" @click="openDialog('generate', item)" />
                      <CashierActionButton :icon="mdiDownloadOutline" label="Verify Proof" color="secondary" variant="outlined" :disabled="!canVerifyProof(item)" @click="openDialog('verify', item)" />
                      <CashierActionButton :icon="mdiDeleteClockOutline" label="Complete" color="success" variant="tonal" :disabled="!canCompleteDocumentation(item)" @click="openDialog('complete', item)" />
                      <CashierActionButton :icon="mdiDeleteClockOutline" label="Correction" color="error" variant="outlined" @click="openCorrectionDialog(item)" />
                    </div>
                  </div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col v-if="filteredReceiptItems.length === 0" cols="12">
              <div class="text-body-2 text-medium-emphasis py-8 text-center">No receipt records are available yet.</div>
            </v-col>
            </v-row>
            <div v-if="filteredReceiptItems.length" class="d-flex flex-column flex-sm-row justify-space-between align-start align-sm-center ga-3 mt-4">
              <div class="text-body-2 text-medium-emphasis">{{ activePageSummary }}</div>
              <v-pagination v-model="currentPage" :length="totalPages" density="comfortable" total-visible="5" />
            </div>
          </div>
        </v-card-text>
      </v-card>

      <v-card class="panel-card mt-6" variant="outlined">
        <v-card-item>
          <v-card-title>Documentation History</v-card-title>
          <v-card-subtitle>{{ receiptHistoryItems.length }} record{{ receiptHistoryItems.length === 1 ? '' : 's' }} already moved out of compliance</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div v-if="filteredReceiptHistoryItems.length">
            <div class="toolbar-row mb-4">
              <div class="text-body-2 text-medium-emphasis">{{ historyPageSummary }}</div>
              <div class="toolbar-controls">
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
            <div class="history-list">
            <div v-for="item in paginatedReceiptHistoryItems" :key="`history-${item.id}`" class="history-row">
              <div>
                <div class="font-weight-bold">{{ item.receiptNo }}</div>
                <div class="text-body-2 text-medium-emphasis">{{ item.studentName }} | {{ item.paymentRef }} | {{ item.amount }}</div>
                <div class="text-body-2 text-medium-emphasis">{{ item.sourceDepartment }} | {{ item.sourceCategory }}</div>
                <div class="text-body-2 text-medium-emphasis">{{ item.status }} -> {{ item.workflowStageLabel }}</div>
              </div>
              <v-chip size="small" color="secondary" variant="tonal">{{ item.workflowStageLabel }}</v-chip>
            </div>
            </div>
            <div class="d-flex flex-column flex-sm-row justify-space-between align-start align-sm-center ga-3 mt-4">
              <div class="text-body-2 text-medium-emphasis">{{ historyPageSummary }}</div>
              <v-pagination v-model="historyCurrentPage" :length="historyTotalPages" density="comfortable" total-visible="5" />
            </div>
          </div>
          <div v-else class="text-body-2 text-medium-emphasis py-4 text-center">No compliance history records yet.</div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="4" class="focus-column">
      <v-card class="panel-card mb-6" variant="outlined">
        <v-card-item>
          <v-card-title>Documentation Focus</v-card-title>
          <v-card-subtitle>Selected proof-of-payment record</v-card-subtitle>
        </v-card-item>
        <v-card-text v-if="selectedReceipt">
          <div class="focus-banner mb-4">
            <div class="text-overline">Selected Documentation</div>
            <div class="text-h6 font-weight-bold">{{ selectedReceipt.studentName }}</div>
            <div class="text-body-2">{{ selectedReceipt.receiptNo }} | {{ selectedReceipt.amount }}</div>
          </div>
          <div class="focus-next-step mb-4">
            <div class="metric-label mb-1">Next Step</div>
            <div class="text-body-2">{{ nextStepLabel }}</div>
          </div>
          <v-list density="comfortable" class="py-0">
            <v-list-item title="Payment reference" :subtitle="selectedReceipt.paymentRef" />
            <v-list-item title="Payment status" :subtitle="selectedReceipt.paymentStatus" />
            <v-list-item title="Issued for" :subtitle="selectedReceipt.issuedFor" />
            <v-list-item title="Connected department" :subtitle="selectedReceipt.sourceDepartment" />
            <v-list-item title="Category type" :subtitle="selectedReceipt.sourceCategory" />
            <v-list-item title="Status" :subtitle="selectedReceipt.status" />
            <v-list-item title="Workflow stage" :subtitle="selectedReceipt.workflowStageLabel" />
          </v-list>
          <div v-if="selectedReceipt.receiptItems?.length" class="focus-allocation-list mt-4">
            <div class="metric-label mb-2">Receipt Fee Lines</div>
            <div v-for="allocation in selectedReceipt.receiptItems" :key="allocation.id" class="allocation-row">
              <span>{{ allocation.feeType }}</span>
              <strong>{{ allocation.allocatedAmountFormatted }}</strong>
            </div>
          </div>
        </v-card-text>
      </v-card>

      <v-card class="panel-card" variant="outlined">
        <v-card-item>
          <v-card-title>Compliance Alerts</v-card-title>
          <v-card-subtitle>Live documentation activity from the backend</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div v-for="item in alerts" :key="item.title + item.time" class="alert-card">
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
      <ModuleActivityLogs module="generate_receipt" title="Compliance & Documentation Activity Logs" :per-page="6" />
    </v-col>

    <WorkflowActionDialog
      v-if="dialogMode === 'generate'"
      :model-value="true"
      :loading="actionLoading"
      title="Generate Receipt"
      subtitle="Create the official receipt using the paid transaction details before forwarding the documentation package."
      chip-label="Receipt Generation"
      chip-color="primary"
      confirm-label="Generate Receipt"
      confirm-color="primary"
      :context-fields="receiptContextFields"
      :fields="[
        {
          key: 'receiptType',
          label: 'Receipt Type',
          type: 'select',
          required: true,
          items: ['Official Receipt', 'Acknowledgement Receipt']
        },
        {
          key: 'issueDate',
          label: 'Issue Date',
          type: 'date',
          required: true
        },
        {
          key: 'remarks',
          label: 'Remarks',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Add cashier notes for the generated receipt.'
        }
      ]"
      :initial-values="generateInitialValues"
      @update:model-value="dialogMode = $event ? dialogMode : null"
      @submit="submitGenerateAction"
    >
      <template #preview="{ formValues }">
        <div v-if="selectedReceipt" class="receipt-preview-card mb-5">
          <div class="receipt-preview-header">
            <div>
              <div class="receipt-preview-kicker">Receipt Review</div>
              <div class="text-h6 font-weight-black">Preview Before Sending</div>
            </div>
            <v-chip color="success" variant="tonal" size="small">{{ String(formValues.receiptType || 'Official Receipt') }}</v-chip>
          </div>

          <div class="receipt-paper">
            <div class="receipt-paper-top">
              <div>
                <div class="receipt-school">Bestlink College of the Philippines</div>
                <div class="receipt-type">{{ String(formValues.receiptType || 'Official Receipt') }}</div>
              </div>
              <div class="receipt-number-block">
                <div class="context-label">Receipt No.</div>
                <div class="receipt-number">{{ receiptPreviewNumber }}</div>
              </div>
            </div>

            <div class="receipt-paper-grid">
              <div>
                <div class="context-label">Student</div>
                <div class="context-value">{{ selectedReceipt.studentName }}</div>
              </div>
              <div>
                <div class="context-label">Issue Date</div>
                <div class="context-value">{{ String(formValues.issueDate || generateInitialValues.issueDate) }}</div>
              </div>
              <div>
                <div class="context-label">Payment Reference</div>
                <div class="context-value">{{ selectedReceipt.paymentRef }}</div>
              </div>
              <div>
                <div class="context-label">Billing Code</div>
                <div class="context-value">{{ selectedReceipt.issuedFor }}</div>
              </div>
            </div>

            <div class="receipt-total-row">
              <div>
                <div class="context-label">Amount Received</div>
                <div class="receipt-total">{{ receiptPreviewAmount }}</div>
              </div>
              <div class="receipt-stage-pill">Ready for Compliance Release</div>
            </div>

            <div v-if="selectedReceipt.receiptItems?.length" class="receipt-allocation-grid">
              <div class="context-label">Fees Paid</div>
              <div v-for="allocation in selectedReceipt.receiptItems" :key="`receipt-item-${allocation.id}`" class="receipt-allocation-row">
                <span>{{ allocation.feeType }}</span>
                <strong>{{ allocation.allocatedAmountFormatted }}</strong>
              </div>
            </div>

            <div class="receipt-notes">
              <div class="context-label">Receipt Remarks</div>
              <div class="text-body-2 text-medium-emphasis">
                {{ String(formValues.remarks || generateInitialValues.remarks) }}
              </div>
            </div>
          </div>
        </div>
      </template>
    </WorkflowActionDialog>

    <WorkflowActionDialog
      v-else-if="dialogMode === 'verify'"
      :model-value="true"
      :loading="actionLoading"
      title="Verify Proof of Payment"
      subtitle="Validate the attached proof details before the documentation package can continue."
      chip-label="Proof Verification"
      chip-color="secondary"
      confirm-label="Verify Proof"
      confirm-color="secondary"
      :context-fields="receiptContextFields"
      :fields="[
        {
          key: 'proofType',
          label: 'Proof Type',
          type: 'select',
          required: true,
          items: ['Proof of Payment', 'Cash Payment Slip', 'Bank Account Validation', 'HMA Payment Confirmation', 'Online Gateway Receipt']
        },
        {
          key: 'verifiedBy',
          label: 'Verified By',
          type: 'text',
          required: true,
          readonly: true
        },
        {
          key: 'decision',
          label: 'Decision',
          type: 'select',
          required: true,
          items: ['Verified', 'Accepted']
        },
        {
          key: 'verificationNotes',
          label: 'Verification Notes',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Add verification notes for the proof document.'
        }
      ]"
      :initial-values="verifyInitialValues"
      @update:model-value="dialogMode = $event ? dialogMode : null"
      @submit="submitVerifyAction"
    >
      <template #preview="{ formValues }">
        <div v-if="selectedReceipt" class="receipt-preview-card mb-5">
          <div class="receipt-preview-header">
            <div>
              <div class="receipt-preview-kicker">Proof Review</div>
              <div class="text-h6 font-weight-black">Review Before Verification</div>
            </div>
            <v-chip color="secondary" variant="tonal" size="small">{{ String(formValues.decision || 'Verified') }}</v-chip>
          </div>

          <div class="receipt-paper">
            <div class="receipt-paper-top">
              <div>
                <div class="receipt-school">Bestlink College of the Philippines</div>
                <div class="receipt-type">Proof of Payment Validation</div>
              </div>
              <div class="receipt-number-block">
                <div class="context-label">Receipt Ref.</div>
                <div class="receipt-number">{{ selectedReceipt.receiptNo }}</div>
              </div>
            </div>

            <div class="receipt-paper-grid">
              <div>
                <div class="context-label">Student</div>
                <div class="context-value">{{ selectedReceipt.studentName }}</div>
              </div>
              <div>
                <div class="context-label">Billing Code</div>
                <div class="context-value">{{ selectedReceipt.issuedFor }}</div>
              </div>
              <div>
                <div class="context-label">Payment Reference</div>
                <div class="context-value">{{ selectedReceipt.paymentRef }}</div>
              </div>
              <div>
                <div class="context-label">Payment Method</div>
                <div class="context-value">{{ selectedReceipt.paymentMethod }}</div>
              </div>
              <div>
                <div class="context-label">Proof Type</div>
                <div class="context-value">{{ String(formValues.proofType || verifyInitialValues.proofType) }}</div>
              </div>
              <div>
                <div class="context-label">Verified By</div>
                <div class="context-value">{{ String(formValues.verifiedBy || verifyInitialValues.verifiedBy) }}</div>
              </div>
            </div>

            <div class="receipt-total-row">
              <div>
                <div class="context-label">Amount Reviewed</div>
                <div class="receipt-total">{{ selectedReceipt.amount }}</div>
              </div>
              <div class="receipt-stage-pill">Keep in Compliance Until Completed</div>
            </div>

            <div v-if="selectedReceipt.receiptItems?.length" class="receipt-allocation-grid">
              <div class="context-label">Fee Allocation Checked</div>
              <div v-for="allocation in selectedReceipt.receiptItems" :key="`proof-item-${allocation.id}`" class="receipt-allocation-row">
                <span>{{ allocation.feeType }}</span>
                <strong>{{ allocation.allocatedAmountFormatted }}</strong>
              </div>
            </div>

            <div class="receipt-notes">
              <div class="context-label">Verification Notes</div>
              <div class="text-body-2 text-medium-emphasis">
                {{ String(formValues.verificationNotes || verifyInitialValues.verificationNotes) }}
              </div>
            </div>
          </div>
        </div>
      </template>
    </WorkflowActionDialog>

    <WorkflowActionDialog
      v-else-if="dialogMode === 'complete'"
      :model-value="true"
      :loading="actionLoading"
      title="Complete Documentation"
      subtitle="Finalize the compliance checklist and move this record into Reporting & Reconciliation."
      chip-label="Documentation Complete"
      chip-color="success"
      confirm-label="Complete Documentation"
      confirm-color="success"
      :context-fields="receiptContextFields"
      :fields="[
        {
          key: 'checklistSummary',
          label: 'Checklist Summary',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Summarize the completed documentation checks.'
        },
        {
          key: 'finalDecision',
          label: 'Final Decision',
          type: 'select',
          required: true,
          items: ['Completed', 'Ready for Reporting']
        },
        {
          key: 'completionNotes',
          label: 'Completion Notes',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Add final compliance notes before handoff.'
        }
      ]"
      :initial-values="completeInitialValues"
      @update:model-value="dialogMode = $event ? dialogMode : null"
      @submit="submitCompleteAction"
    />

    <WorkflowCorrectionDialog
      v-model="correctionDialog"
      :loading="actionLoading"
      :record-label="correctionReceipt?.receiptNo || 'compliance record'"
      current-module-label="Compliance & Documentation"
      target-module-label="Payment Processing & Gateway"
      :reason-options="[
        'Receipt details incorrect',
        'Proof of payment incomplete',
        'Payment reference mismatch',
        'Invalid receipt data'
      ]"
      @submit="submitCorrection"
    />

    <v-snackbar v-model="snackbar" color="primary" location="top right" :timeout="2600">
      {{ snackbarMessage }}
    </v-snackbar>
  </v-row>
</template>

<style scoped>
.hero-banner { border-radius: 18px; color: #fff; background: linear-gradient(125deg, #163066 0%, #25549d 52%, #5ba6dc 100%); box-shadow: 0 18px 36px rgba(20, 50, 115, 0.18); }
.hero-kicker { display: inline-flex; align-items: center; padding: 4px 12px; border-radius: 999px; margin-bottom: 12px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.26); text-transform: uppercase; letter-spacing: 0.08em; font-size: 12px; font-weight: 800; }
.hero-subtitle { max-width: 760px; color: rgba(255,255,255,0.92); }
.hero-side-panel { min-width: 260px; padding: 18px; border-radius: 16px; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.18); }
.hero-side-label,.metric-label { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #73809b; font-weight: 700; }
.panel-card { border-radius: 18px; background: #fff; box-shadow: 0 14px 28px rgba(15, 23, 42, 0.05); }
.entry-card { border-radius: 18px; background: linear-gradient(180deg, #fff 0%, #fbf7f1 100%); border: 1px solid rgba(189,157,120,0.18); }
.entry-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.meta-value { margin-top: 4px; color: #18243f; font-weight: 700; }
.allocation-summary-card,.focus-allocation-list { padding: 14px 16px; border-radius: 16px; background: linear-gradient(180deg, #f7fbff 0%, #f3f7fb 100%); border: 1px solid rgba(66, 110, 182, 0.12); }
.allocation-list { display: grid; gap: 8px; }
.allocation-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 14px; }
.entry-note { padding: 12px 14px; border-radius: 14px; background: rgba(33,80,166,0.06); color: #49556e; }
.entry-actions { min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-content: start; }
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

.focus-column::-webkit-scrollbar { width: 8px; }

.focus-column::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(33, 80, 166, 0.22);
}

.focus-column::-webkit-scrollbar-track { background: transparent; }
.toolbar-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.toolbar-controls { display: flex; align-items: center; gap: 12px; }
.toolbar-search { min-width: 260px; }
.toolbar-select { max-width: 140px; min-width: 120px; }
.focus-banner { padding: 18px; border-radius: 16px; color: #fff; background: linear-gradient(135deg, #1d4b96 0%, #3579c9 100%); }
.focus-next-step { padding: 14px 16px; border-radius: 14px; background: #f6f9ff; border: 1px solid rgba(78,107,168,0.14); }
.alert-card { padding: 14px; border-radius: 14px; background: #fbf7f1; border: 1px solid rgba(189,157,120,0.15); }
.alert-card + .alert-card { margin-top: 12px; }
.confirm-dialog { border-radius: 20px; }
.history-list { display: grid; gap: 12px; }
.history-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px; border-radius: 16px; background: linear-gradient(180deg, #fff 0%, #fbf7f1 100%); border: 1px solid rgba(189,157,120,0.18); }
.receipt-preview-card { padding: 18px; border-radius: 18px; background: linear-gradient(180deg, #f7fbff 0%, #ffffff 100%); border: 1px solid rgba(78,107,168,0.16); }
.receipt-preview-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.receipt-preview-kicker { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #71819e; font-weight: 700; margin-bottom: 4px; }
.receipt-paper { padding: 18px; border-radius: 18px; background: linear-gradient(180deg, #ffffff 0%, #fdf8f1 100%); border: 1px solid rgba(189,157,120,0.18); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.65); }
.receipt-paper-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 16px; margin-bottom: 16px; border-bottom: 1px dashed rgba(120,138,172,0.35); }
.receipt-school { font-size: 18px; font-weight: 800; color: #17305f; }
.receipt-type { margin-top: 4px; font-size: 14px; color: #5a6c8f; font-weight: 700; }
.receipt-number-block { text-align: right; }
.receipt-number { margin-top: 4px; font-size: 18px; font-weight: 800; color: #1d4b96; }
.receipt-paper-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 16px; margin-bottom: 16px; }
.receipt-total-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; margin-bottom: 16px; border-top: 1px dashed rgba(120,138,172,0.35); border-bottom: 1px dashed rgba(120,138,172,0.35); }
.receipt-allocation-grid { display: grid; gap: 10px; padding: 0 0 16px; }
.receipt-allocation-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 14px; }
.receipt-total { margin-top: 4px; font-size: 24px; font-weight: 900; color: #0f7a45; }
.receipt-stage-pill { padding: 10px 14px; border-radius: 999px; background: rgba(18, 153, 94, 0.12); color: #15724b; font-weight: 700; }
.receipt-notes { padding: 14px; border-radius: 14px; background: rgba(33,80,166,0.05); }
@media (max-width: 959px) {
  .entry-actions { min-width: 100%; }
  .focus-column {
    position: static;
    max-height: none;
    overflow: visible;
    padding-right: 0;
  }
}
@media (max-width: 959px) { .history-row { flex-direction: column; align-items: flex-start; } }
@media (max-width: 640px) {
  .entry-grid { grid-template-columns: 1fr; }
  .receipt-paper-grid { grid-template-columns: 1fr; }
  .receipt-paper-top,
  .receipt-total-row,
  .receipt-preview-header { flex-direction: column; align-items: flex-start; }
  .receipt-number-block { text-align: left; }
}
</style>




