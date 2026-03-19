<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { mdiBellBadgeOutline, mdiCashCheck, mdiMagnify, mdiPauseCircleOutline } from '@mdi/js';
import CashierAnalyticsCard from '@/components/shared/CashierAnalyticsCard.vue';
import CashierActionButton from '@/components/shared/CashierActionButton.vue';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';
import WorkflowActionDialog from '@/components/shared/WorkflowActionDialog.vue';
import WorkflowCorrectionDialog from '@/components/shared/WorkflowCorrectionDialog.vue';
import { useAuthStore } from '@/stores/auth';
import {
  fetchPaymentSnapshot,
  type PaymentIntakeItem,
  type PaymentQueueItem,
  type PaymentSnapshot,
  type PaymentStatus
} from '@/services/cashierFlow';
import { returnWorkflowRecordForCorrection } from '@/services/workflowCorrections';
import { confirmPaidWorkflowRecord } from '@/services/workflowActions';
import { authorizeGatewayPayment, createApprovedPaymentRequest, createInstallmentArrangement, markPayBillsFailed } from '@/services/workflowCrudActions';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';

const auth = useAuthStore();
const stats = ref<PaymentSnapshot['stats']>([]);
const upstreamItems = ref<PaymentIntakeItem[]>([]);
const paymentItems = ref<PaymentQueueItem[]>([]);
const paymentHistoryItems = ref<PaymentQueueItem[]>([]);
const alerts = ref<PaymentSnapshot['activityFeed']>([]);
const selectedPayment = ref<PaymentQueueItem | null>(null);
const selectedIntake = ref<PaymentIntakeItem | null>(null);
const search = ref('');
const departmentFilter = ref('All Departments');
const categoryFilter = ref('All Categories');
const itemsPerPage = ref(6);
const currentPage = ref(1);
const upstreamItemsPerPage = ref(8);
const upstreamCurrentPage = ref(1);
const historyItemsPerPage = ref(6);
const historyCurrentPage = ref(1);
const dialogMode = ref<'authorize' | 'confirm' | null>(null);
const intakeDialogMode = ref<'settle_full' | 'settle_partial' | 'mark_failed' | null>(null);
const correctionDialog = ref(false);
const correctionPayment = ref<PaymentQueueItem | null>(null);
const correctionIntake = ref<PaymentIntakeItem | null>(null);
const snackbar = ref(false);
const snackbarMessage = ref('');
const loading = ref(false);
const actionLoading = ref(false);
const errorMessage = ref('');
const realtime = useRealtimeListSync();
const combinedDepartmentItems = computed(() => [...upstreamItems.value, ...paymentItems.value, ...paymentHistoryItems.value]);
const departmentFilterOptions = computed(() => [
  'All Departments',
  ...new Set(combinedDepartmentItems.value.map((item) => item.sourceDepartment).filter(Boolean))
]);
const categoryFilterOptions = computed(() => [
  'All Categories',
  ...new Set(combinedDepartmentItems.value.map((item) => item.sourceCategory).filter(Boolean))
]);

function statusColor(status: PaymentStatus) {
  if (status === 'Paid') return 'success';
  if (status === 'Authorized') return 'info';
  if (status === 'Failed' || status === 'Cancelled') return 'error';
  return 'warning';
}

function openDialog(mode: 'authorize' | 'confirm', item: PaymentQueueItem) {
  selectedPayment.value = item;
  dialogMode.value = mode;
}

function openCorrectionDialog(item: PaymentQueueItem) {
  selectedPayment.value = item;
  correctionPayment.value = item;
  correctionDialog.value = true;
}

function openIntakeDialog(mode: 'settle_full' | 'settle_partial' | 'mark_failed', item: PaymentIntakeItem) {
  selectedIntake.value = item;
  intakeDialogMode.value = mode;
}

function openIntakeCorrectionDialog(item: PaymentIntakeItem) {
  selectedIntake.value = item;
  correctionIntake.value = item;
  correctionDialog.value = true;
}

function dialogTitle() {
  if (dialogMode.value === 'authorize') return 'Authorize Transaction';
  if (dialogMode.value === 'confirm') return 'Confirm Paid Transaction';
  return '';
}

function dialogMessage() {
  if (!selectedPayment.value) return '';
  if (dialogMode.value === 'authorize') return `Authorize ${selectedPayment.value.reference} for payment gateway approval?`;
  if (dialogMode.value === 'confirm') return `Confirm ${selectedPayment.value.reference} as a paid transaction and send it to Compliance & Documentation?`;
  return '';
}

function formatActionMessage(response: { message?: string; next_module?: string }) {
  if (response.next_module) return `${response.message} Next queue: ${response.next_module}.`;
  return response.message || 'Payment queue updated successfully.';
}

async function loadSnapshot(options: { silent?: boolean } = {}) {
  if (!options.silent) loading.value = true;
  errorMessage.value = '';
  try {
    const snapshot = await fetchPaymentSnapshot();
    stats.value = snapshot.stats;
    upstreamItems.value = snapshot.upstreamItems || [];
    paymentItems.value = snapshot.items;
    paymentHistoryItems.value = snapshot.historyItems;
    alerts.value = snapshot.activityFeed;
    selectedPayment.value = snapshot.items.find((item) => item.id === selectedPayment.value?.id) || snapshot.items[0] || null;
    selectedIntake.value = (snapshot.upstreamItems || []).find((item) => item.id === selectedIntake.value?.id) || snapshot.upstreamItems?.[0] || null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load payment queue.';
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
  if (!correctionPayment.value && !correctionIntake.value) return;

  actionLoading.value = true;
  try {
    const targetRecordId = correctionPayment.value?.id || correctionIntake.value?.id || 0;
    const currentModule = correctionPayment.value ? 'payment_processing_gateway' : 'pay_bills';
    const response = await returnWorkflowRecordForCorrection({
      recordId: targetRecordId,
      currentModule,
      reason: payload.reason,
      remarks: payload.remarks
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    correctionDialog.value = false;
    correctionPayment.value = null;
    correctionIntake.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to return gateway record for correction.';
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

watch(paymentItems, (items) => {
  selectedPayment.value = items.find((item) => item.id === selectedPayment.value?.id) || items[0] || null;
});

watch(upstreamItems, (items) => {
  selectedIntake.value = items.find((item) => item.id === selectedIntake.value?.id) || items[0] || null;
});

const paymentContextFields = computed(() => {
  if (!selectedPayment.value) return [];

  return [
    { label: 'Student Name', value: selectedPayment.value.studentName },
    { label: 'Payment Reference', value: selectedPayment.value.reference },
    { label: 'Billing Code', value: selectedPayment.value.billingCode },
    { label: 'Source Module', value: selectedPayment.value.sourceModule },
    { label: 'Connected Department', value: selectedPayment.value.sourceDepartment },
    { label: 'Booking Category', value: selectedPayment.value.sourceCategory },
    { label: 'Amount', value: selectedPayment.value.amount },
    { label: 'Status', value: selectedPayment.value.status },
    { label: 'Workflow Stage', value: selectedPayment.value.workflowStageLabel }
  ];
});

const intakeContextFields = computed(() => {
  if (!selectedIntake.value) return [];
  return [
    { label: 'Reference', value: selectedIntake.value.reference },
    { label: 'Patient', value: selectedIntake.value.patientName },
    { label: 'Source Module', value: selectedIntake.value.sourceModule },
    { label: 'Connected Department', value: selectedIntake.value.sourceDepartment },
    { label: 'Booking Category', value: selectedIntake.value.sourceCategory },
    { label: 'Amount', value: selectedIntake.value.amount },
    { label: 'Payment Status', value: selectedIntake.value.payment },
    { label: 'Sync', value: selectedIntake.value.sync },
    { label: 'Workflow Stage', value: selectedIntake.value.workflowStageLabel }
  ];
});

const authorizeInitialValues = computed(() => ({
  gatewayRemarks: 'Authorized by cashier during gateway review.',
  authorizationNotes: 'Gateway validation completed.'
}));

const confirmInitialValues = computed(() => ({
  confirmedBy: auth.user?.fullName || auth.user?.username || 'Cashier Admin',
  confirmationNotes: 'Payment confirmed successfully.'
}));
const nextStepLabel = computed(() => {
  if (!selectedPayment.value) return 'Select a transaction to review its gateway handoff.';
  if (selectedPayment.value.status === 'Processing') return 'Authorize the transaction after validating the gateway payload.';
  if (selectedPayment.value.status === 'Authorized') return 'Confirm Paid to move this record into Compliance & Documentation.';
  if (selectedPayment.value.status === 'Failed' || selectedPayment.value.status === 'Cancelled') {
    return 'Use Correction to return this record to Pay Bills for fixing or retry.';
  }
  return 'This payment is ready to continue to the next cashier workflow stage.';
});

async function submitAuthorizeAction(formValues: Record<string, string | number>) {
  if (!selectedPayment.value) return;

  actionLoading.value = true;
  try {
    const response = await authorizeGatewayPayment({
      paymentId: selectedPayment.value.id,
      gatewayRemarks: String(formValues.gatewayRemarks || ''),
      authorizationNotes: String(formValues.authorizationNotes || '')
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    dialogMode.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to authorize gateway transaction.';
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

async function submitConfirmAction(formValues: Record<string, string | number>) {
  if (!selectedPayment.value) return;

  actionLoading.value = true;
  try {
    const confirmedBy = String(formValues.confirmedBy || auth.user?.fullName || auth.user?.username || 'Cashier Admin');
    const notes = String(formValues.confirmationNotes || '');
    const response = await confirmPaidWorkflowRecord({
      recordId: selectedPayment.value.id,
      currentModule: 'payment_processing_gateway',
      remarks: `${notes}${notes ? ' ' : ''}(Confirmed by: ${confirmedBy})`
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    dialogMode.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to confirm paid transaction.';
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

const queueSummary = computed(() => `${paymentItems.value.length} transaction record${paymentItems.value.length === 1 ? '' : 's'} in the gateway queue`);
const intakeSummary = computed(() => `${upstreamItems.value.length} payment intake record${upstreamItems.value.length === 1 ? '' : 's'} ready from Pay Bills`);
const historySummary = computed(() => `${paymentHistoryItems.value.length} record${paymentHistoryItems.value.length === 1 ? '' : 's'} already moved out of gateway`);
function matchesSearch(value: string, fields: Array<string | number | undefined>) {
  if (!value.trim()) return true;
  const needle = value.trim().toLowerCase();
  return fields.some((field) => String(field ?? '').toLowerCase().includes(needle));
}
const filteredUpstreamItems = computed(() =>
  upstreamItems.value.filter((item) => {
    if (departmentFilter.value !== 'All Departments' && item.sourceDepartment !== departmentFilter.value) return false;
    if (categoryFilter.value !== 'All Categories' && item.sourceCategory !== categoryFilter.value) return false;
    if (!matchesSearch(search.value, [item.reference, item.patientName, item.sourceModule, item.sourceDepartment, item.sourceCategory, item.payment, item.sync, item.workflowStageLabel])) return false;
    return true;
  })
);
const filteredPaymentItems = computed(() =>
  paymentItems.value.filter((item) => {
    if (departmentFilter.value !== 'All Departments' && item.sourceDepartment !== departmentFilter.value) return false;
    if (categoryFilter.value !== 'All Categories' && item.sourceCategory !== categoryFilter.value) return false;
    if (!matchesSearch(search.value, [item.reference, item.studentName, item.billingCode, item.channel, item.sourceModule, item.sourceDepartment, item.sourceCategory, item.status, item.workflowStageLabel])) return false;
    return true;
  })
);
const filteredPaymentHistoryItems = computed(() =>
  paymentHistoryItems.value.filter((item) => {
    if (departmentFilter.value !== 'All Departments' && item.sourceDepartment !== departmentFilter.value) return false;
    if (categoryFilter.value !== 'All Categories' && item.sourceCategory !== categoryFilter.value) return false;
    if (!matchesSearch(search.value, [item.reference, item.studentName, item.billingCode, item.channel, item.sourceModule, item.sourceDepartment, item.sourceCategory, item.status, item.workflowStageLabel])) return false;
    return true;
  })
);
const upstreamTotalPages = computed(() => Math.max(1, Math.ceil(filteredUpstreamItems.value.length / upstreamItemsPerPage.value)));
const totalPages = computed(() => Math.max(1, Math.ceil(filteredPaymentItems.value.length / itemsPerPage.value)));
const historyTotalPages = computed(() => Math.max(1, Math.ceil(filteredPaymentHistoryItems.value.length / historyItemsPerPage.value)));
const paginatedUpstreamItems = computed(() => {
  const start = (upstreamCurrentPage.value - 1) * upstreamItemsPerPage.value;
  return filteredUpstreamItems.value.slice(start, start + upstreamItemsPerPage.value);
});
const paginatedPaymentItems = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value;
  return filteredPaymentItems.value.slice(start, start + itemsPerPage.value);
});
const intakePageSummary = computed(() => {
  if (!filteredUpstreamItems.value.length) return 'No intake records from Pay Bills.';
  const first = (upstreamCurrentPage.value - 1) * upstreamItemsPerPage.value + 1;
  const last = Math.min(upstreamCurrentPage.value * upstreamItemsPerPage.value, filteredUpstreamItems.value.length);
  return `Showing ${first}-${last} of ${filteredUpstreamItems.value.length} payment intake record${filteredUpstreamItems.value.length === 1 ? '' : 's'}`;
});
const paginatedPaymentHistoryItems = computed(() => {
  const start = (historyCurrentPage.value - 1) * historyItemsPerPage.value;
  return filteredPaymentHistoryItems.value.slice(start, start + historyItemsPerPage.value);
});
const activePageSummary = computed(() => {
  if (!filteredPaymentItems.value.length) return 'No active gateway records.';
  const first = (currentPage.value - 1) * itemsPerPage.value + 1;
  const last = Math.min(currentPage.value * itemsPerPage.value, filteredPaymentItems.value.length);
  return `Showing ${first}-${last} of ${filteredPaymentItems.value.length} active gateway record${filteredPaymentItems.value.length === 1 ? '' : 's'}`;
});
const historyPageSummary = computed(() => {
  if (!filteredPaymentHistoryItems.value.length) return 'No gateway history records.';
  const first = (historyCurrentPage.value - 1) * historyItemsPerPage.value + 1;
  const last = Math.min(historyCurrentPage.value * historyItemsPerPage.value, filteredPaymentHistoryItems.value.length);
  return `Showing ${first}-${last} of ${filteredPaymentHistoryItems.value.length} moved record${filteredPaymentHistoryItems.value.length === 1 ? '' : 's'}`;
});

watch(itemsPerPage, () => {
  currentPage.value = 1;
});

watch(upstreamItemsPerPage, () => {
  upstreamCurrentPage.value = 1;
});

watch([search, departmentFilter, categoryFilter], () => {
  upstreamCurrentPage.value = 1;
  currentPage.value = 1;
  historyCurrentPage.value = 1;
});

watch(historyItemsPerPage, () => {
  historyCurrentPage.value = 1;
});

watch(totalPages, (value) => {
  if (currentPage.value > value) currentPage.value = value;
});

watch([upstreamTotalPages, filteredUpstreamItems], ([value]) => {
  if (upstreamCurrentPage.value > value) upstreamCurrentPage.value = value;
});

watch(historyTotalPages, (value) => {
  if (historyCurrentPage.value > value) historyCurrentPage.value = value;
});

function buildAutoAllocations(item: PaymentIntakeItem, amount: number) {
  let remaining = Number(amount || 0);
  const allocations: Array<{ billingItemId: number; allocatedAmount: number }> = [];
  for (const feeItem of item.feeItems) {
    if (remaining <= 0) break;
    const available = Number(feeItem.remainingAmount || 0);
    if (available <= 0) continue;
    const allocatedAmount = Number(Math.min(available, remaining).toFixed(2));
    if (allocatedAmount <= 0) continue;
    allocations.push({ billingItemId: feeItem.id, allocatedAmount });
    remaining = Number((remaining - allocatedAmount).toFixed(2));
  }
  return allocations;
}

async function submitIntakeApproveAction(formValues: Record<string, string | number>) {
  if (!selectedIntake.value) return;
  actionLoading.value = true;
  try {
    const amount = Number(formValues.amount || selectedIntake.value.rawAmount || 0);
    const response = await createApprovedPaymentRequest({
      billingId: selectedIntake.value.id,
      amount,
      paymentMethod: String(formValues.paymentMethod || 'Cash'),
      allocationMode: 'auto',
      allocations: buildAutoAllocations(selectedIntake.value, amount),
      remarks: String(formValues.remarks || 'Payment request approved from process payment intake.')
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    intakeDialogMode.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update payment.';
    if (message.toLowerCase().includes('active in payment processing')) {
      await loadSnapshot();
      intakeDialogMode.value = null;
    }
    snackbarMessage.value = message;
    snackbar.value = true;
  } finally {
    actionLoading.value = false;
  }
}

async function submitIntakeInstallmentAction(formValues: Record<string, string | number>) {
  if (!selectedIntake.value) return;
  actionLoading.value = true;
  try {
    const amount = Number(formValues.installmentAmount || 0);
    const response = await createInstallmentArrangement({
      billingId: selectedIntake.value.id,
      installmentAmount: amount,
      installmentCount: Number(formValues.installmentCount || 2),
      dueSchedule: String(formValues.dueSchedule || 'Every 15th of the month'),
      paymentMethod: String(formValues.paymentMethod || 'Online'),
      allocationMode: 'auto',
      allocations: buildAutoAllocations(selectedIntake.value, amount),
      remarks: String(formValues.remarks || 'Installment request created from process payment intake.')
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    intakeDialogMode.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create installment payment.';
    if (message.toLowerCase().includes('active in payment processing')) {
      await loadSnapshot();
      intakeDialogMode.value = null;
    }
    snackbarMessage.value = message;
    snackbar.value = true;
  } finally {
    actionLoading.value = false;
  }
}

async function submitIntakeFailedAction(formValues: Record<string, string | number>) {
  if (!selectedIntake.value) return;
  actionLoading.value = true;
  try {
    const response = await markPayBillsFailed({
      billingId: selectedIntake.value.id,
      reason: String(formValues.reason || 'Failed amount validation'),
      remarks: String(formValues.remarks || '')
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    intakeDialogMode.value = null;
    await loadSnapshot();
  } catch (error) {
    snackbarMessage.value = error instanceof Error ? error.message : 'Unable to mark payment as failed.';
    snackbar.value = true;
  } finally {
    actionLoading.value = false;
  }
}

const intakeApproveInitialValues = computed(() => ({
  amount: selectedIntake.value?.rawAmount || 0,
  paymentMethod: 'Cash',
  remarks: 'Forward payment request from Pay Bills to gateway processing.'
}));

const intakeInstallmentInitialValues = computed(() => ({
  installmentAmount: selectedIntake.value ? Number(Math.max(500, Math.round(selectedIntake.value.rawAmount / 2)).toFixed(2)) : 0,
  installmentCount: 2,
  dueSchedule: 'Every 15th of the month',
  paymentMethod: 'Cash',
  remarks: 'Create installment plan before gateway handoff.'
}));

const intakeFailedInitialValues = computed(() => ({
  reason: 'Failed amount validation',
  remarks: 'Payment update failed before gateway handoff.'
}));

function syncChipColor(value: string) {
  if (value === 'clinic_synced') return 'warning';
  return 'primary';
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
              <div class="hero-kicker">Payment Processing & Gateway</div>
              <h1 class="text-h4 font-weight-black mb-2">Payment Processing & Gateway</h1>
              <p class="hero-subtitle mb-0">Review payment intake from Pay Bills, update clinic-synced settlements, then validate gateway transactions through to documentation.</p>
            </div>
            <div class="hero-side-panel">
              <div class="hero-side-label">End-to-End Flow</div>
              <div class="text-h6 font-weight-bold">Clinic Sync -> Pay Bills -> Gateway -> Documentation</div>
              <div class="text-body-2">{{ intakeSummary }} | {{ queueSummary }}</div>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col v-for="stat in stats" :key="stat.title" cols="12" sm="6" lg="3">
      <CashierAnalyticsCard :title="stat.title" :value="stat.value" :subtitle="stat.subtitle" :icon="stat.icon" :tone="stat.tone" />
    </v-col>

    <v-col cols="12" lg="8">
      <v-card class="panel-card mb-6" variant="outlined">
        <v-card-item>
          <v-card-title>Payment Intake Queue</v-card-title>
          <v-card-subtitle>End-to-end handoff point where Pay Bills and clinic-synced records become gateway-ready payment requests.</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div v-if="loading" class="py-6 text-center">
            <v-progress-circular indeterminate color="primary" />
          </div>
          <div v-else>
            <div class="toolbar-row mb-4">
              <div class="text-body-2 text-medium-emphasis">{{ intakePageSummary }}</div>
              <div class="toolbar-controls">
                <v-text-field
                  v-model="search"
                  :prepend-inner-icon="mdiMagnify"
                  label="Search intake, gateway, or history"
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
                  v-model="upstreamItemsPerPage"
                  :items="[8, 12]"
                  label="Rows per page"
                  density="compact"
                  variant="outlined"
                  hide-details
                  class="toolbar-select"
                />
              </div>
            </div>
            <div class="flow-strip mb-4">
              <div class="flow-step flow-step--done">1. Clinic / Billing Sync</div>
              <div class="flow-step flow-step--active">2. Update Payment</div>
              <div class="flow-step">3. Gateway Review</div>
              <div class="flow-step">4. Confirm Paid</div>
            </div>
            <v-table density="comfortable">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Patient</th>
                  <th>Department</th>
                  <th>Amount</th>
                  <th>Payment</th>
                  <th>Sync</th>
                  <th>Created</th>
                  <th class="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in paginatedUpstreamItems" :key="`intake-${item.id}`" class="queue-row" @click="selectedIntake = item">
                  <td>
                    <div class="font-weight-bold">{{ item.reference }}</div>
                    <div class="text-caption text-medium-emphasis">{{ item.workflowStageLabel }}</div>
                  </td>
                  <td>
                    <div class="font-weight-medium">{{ item.patientName }}</div>
                    <div class="text-caption text-medium-emphasis">{{ item.sourceCategory }}</div>
                  </td>
                  <td>
                    <div class="font-weight-medium">{{ item.sourceDepartment }}</div>
                    <div class="text-caption text-medium-emphasis">{{ item.sourceModule }}</div>
                  </td>
                  <td>{{ item.amount }}</td>
                  <td><v-chip size="small" :color="item.payment === 'paid' ? 'success' : item.payment === 'failed' ? 'error' : 'warning'" variant="tonal">{{ item.payment }}</v-chip></td>
                  <td><v-chip size="small" :color="syncChipColor(item.sync)" variant="tonal">{{ item.sync }}</v-chip></td>
                  <td>{{ new Date(item.createdAt).toLocaleString() }}</td>
                  <td class="text-right">
                    <div class="d-flex justify-end ga-2">
                      <v-btn size="small" color="primary" variant="flat" @click.stop="openIntakeDialog('settle_full', item)">Update Payment</v-btn>
                      <v-btn size="small" color="error" variant="outlined" @click.stop="openIntakeCorrectionDialog(item)">Correction</v-btn>
                    </div>
                  </td>
                </tr>
                <tr v-if="!paginatedUpstreamItems.length">
                  <td colspan="8" class="text-center text-medium-emphasis py-6">No Pay Bills records are waiting for payment update.</td>
                </tr>
              </tbody>
            </v-table>
            <div v-if="upstreamItems.length" class="d-flex flex-column flex-sm-row justify-space-between align-start align-sm-center ga-3 mt-4">
              <div class="text-body-2 text-medium-emphasis">{{ intakePageSummary }}</div>
              <v-pagination v-model="upstreamCurrentPage" :length="upstreamTotalPages" density="comfortable" total-visible="5" />
            </div>
          </div>
        </v-card-text>
      </v-card>

      <v-card class="panel-card" variant="outlined">
        <v-card-item>
          <v-card-title>Gateway Processing Board</v-card-title>
          <v-card-subtitle>Monitor transaction attempts received from Pay Bills and finalize gateway outcomes.</v-card-subtitle>
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
            <v-col v-for="item in paginatedPaymentItems" :key="item.id" cols="12" md="6">
              <v-card class="entry-card" elevation="0">
                <v-card-text class="pa-4">
                  <div class="d-flex flex-column flex-xl-row justify-space-between ga-4">
                    <div class="flex-grow-1">
                      <div class="d-flex flex-wrap align-center ga-3 mb-3">
                        <div class="text-subtitle-1 font-weight-bold">{{ item.studentName }}</div>
                        <v-chip size="small" :color="statusColor(item.status)" variant="tonal">{{ item.status }}</v-chip>
                        <v-chip size="small" color="primary" variant="outlined">{{ item.reference }}</v-chip>
                        <v-chip size="small" :color="item.sourceModule === 'Clinic' ? 'warning' : 'secondary'" variant="tonal">{{ item.sourceDepartment }}</v-chip>
                      </div>
                      <div class="entry-grid">
                        <div>
                          <div class="metric-label">Channel</div>
                          <div class="meta-value">{{ item.channel }}</div>
                        </div>
                        <div>
                          <div class="metric-label">Amount</div>
                          <div class="meta-value">{{ item.amount }}</div>
                        </div>
                        <div>
                          <div class="metric-label">Billing Code</div>
                          <div class="meta-value">{{ item.billingCode }}</div>
                        </div>
                        <div>
                          <div class="metric-label">Category Type</div>
                          <div class="meta-value">{{ item.sourceCategory }}</div>
                        </div>
                        <div>
                          <div class="metric-label">Queue Status</div>
                          <div class="meta-value">{{ item.status }}</div>
                        </div>
                      </div>
                      <div v-if="item.allocations?.length" class="allocation-summary-card mt-4">
                        <div class="metric-label mb-2">Allocated Fees</div>
                        <div class="allocation-list">
                          <div v-for="allocation in item.allocations" :key="allocation.id" class="allocation-row">
                            <span>{{ allocation.feeType }}</span>
                            <strong>{{ allocation.allocatedAmountFormatted }}</strong>
                          </div>
                        </div>
                      </div>
                      <div class="entry-note mt-4">{{ item.note }}</div>
                    </div>
                    <div class="entry-actions">
                      <CashierActionButton :icon="mdiBellBadgeOutline" label="Authorize" color="primary" @click="openDialog('authorize', item)" />
                      <CashierActionButton :icon="mdiCashCheck" label="Confirm Paid" color="success" variant="outlined" @click="openDialog('confirm', item)" />
                      <CashierActionButton :icon="mdiPauseCircleOutline" label="Correction" color="error" variant="tonal" @click="openCorrectionDialog(item)" />
                    </div>
                  </div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col v-if="filteredPaymentItems.length === 0" cols="12">
              <div class="text-body-2 text-medium-emphasis py-8 text-center">No payment records are available yet.</div>
            </v-col>
            </v-row>
            <div v-if="filteredPaymentItems.length" class="d-flex flex-column flex-sm-row justify-space-between align-start align-sm-center ga-3 mt-4">
              <div class="text-body-2 text-medium-emphasis">{{ activePageSummary }}</div>
              <v-pagination v-model="currentPage" :length="totalPages" density="comfortable" total-visible="5" />
            </div>
          </div>
        </v-card-text>
      </v-card>

      <v-card class="panel-card mt-6" variant="outlined">
        <v-card-item>
          <v-card-title>Gateway History</v-card-title>
          <v-card-subtitle>{{ historySummary }}</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div v-if="filteredPaymentHistoryItems.length">
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
            <div class="report-list">
            <div v-for="item in paginatedPaymentHistoryItems" :key="`history-${item.id}`" class="report-row">
              <div>
                <div class="font-weight-bold">{{ item.reference }}</div>
                <div class="text-body-2 text-medium-emphasis">{{ item.studentName }} | {{ item.billingCode }} | {{ item.amount }}</div>
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
          <div v-else class="text-body-2 text-medium-emphasis py-4 text-center">No gateway history records yet.</div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="4" class="focus-column">
      <v-card class="panel-card mb-6" variant="outlined">
        <v-card-item>
          <v-card-title>Gateway Focus</v-card-title>
          <v-card-subtitle>Selected intake or transaction and the current end-to-end next step</v-card-subtitle>
        </v-card-item>
        <v-card-text v-if="selectedPayment">
          <div class="focus-banner mb-4">
            <div class="text-overline">Current Transaction</div>
            <div class="text-h6 font-weight-bold">{{ selectedPayment.studentName }}</div>
            <div class="text-body-2">{{ selectedPayment.reference }} | {{ selectedPayment.amount }}</div>
          </div>
          <div class="focus-next-step mb-4">
            <div class="metric-label mb-1">Next Step</div>
            <div class="text-body-2">{{ nextStepLabel }}</div>
          </div>
            <v-list density="comfortable" class="py-0">
            <v-list-item title="Source module" :subtitle="selectedPayment.sourceModule" />
            <v-list-item title="Connected department" :subtitle="selectedPayment.sourceDepartment" />
            <v-list-item title="Category type" :subtitle="selectedPayment.sourceCategory" />
            <v-list-item title="Payment channel" :subtitle="selectedPayment.channel" />
            <v-list-item title="Billing code" :subtitle="selectedPayment.billingCode" />
            <v-list-item title="Status" :subtitle="selectedPayment.status" />
            <v-list-item title="Workflow stage" :subtitle="selectedPayment.workflowStageLabel" />
          </v-list>
          <div v-if="selectedPayment.allocations?.length" class="focus-allocation-list mt-4">
            <div class="metric-label mb-2">Fee Allocation</div>
            <div v-for="allocation in selectedPayment.allocations" :key="allocation.id" class="allocation-row">
              <span>{{ allocation.feeType }}</span>
              <strong>{{ allocation.allocatedAmountFormatted }}</strong>
            </div>
          </div>
        </v-card-text>
        <v-card-text v-else-if="selectedIntake">
          <div class="focus-banner mb-4">
            <div class="text-overline">Current Intake</div>
            <div class="text-h6 font-weight-bold">{{ selectedIntake.patientName }}</div>
            <div class="text-body-2">{{ selectedIntake.reference }} | {{ selectedIntake.amount }}</div>
          </div>
          <div class="focus-next-step mb-4">
            <div class="metric-label mb-1">Next Step</div>
            <div class="text-body-2">Update payment in this page, create the payment request, then continue here for gateway authorization and paid confirmation.</div>
          </div>
          <v-list density="comfortable" class="py-0">
            <v-list-item title="Source module" :subtitle="selectedIntake.sourceModule" />
            <v-list-item title="Connected department" :subtitle="selectedIntake.sourceDepartment" />
            <v-list-item title="Booking category" :subtitle="selectedIntake.sourceCategory" />
            <v-list-item title="Payment status" :subtitle="selectedIntake.payment" />
            <v-list-item title="Sync state" :subtitle="selectedIntake.sync" />
            <v-list-item title="Workflow stage" :subtitle="selectedIntake.workflowStageLabel" />
            <v-list-item title="Created at" :subtitle="new Date(selectedIntake.createdAt).toLocaleString()" />
          </v-list>
        </v-card-text>
      </v-card>

      <v-card class="panel-card" variant="outlined">
        <v-card-item>
          <v-card-title>Gateway Alerts</v-card-title>
          <v-card-subtitle>Live payment processing activity from the backend</v-card-subtitle>
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
      <ModuleActivityLogs module="process_payment" title="Payment Processing & Gateway Activity Logs" :per-page="6" />
    </v-col>

    <WorkflowActionDialog
      v-if="intakeDialogMode === 'settle_full'"
      :model-value="true"
      :loading="actionLoading"
      title="Update Payment"
      subtitle="This is the end-to-end handoff point from Pay Bills into Gateway. Approve the payment request so it appears below in Gateway Processing."
      chip-label="Update Payment"
      chip-color="primary"
      confirm-label="Forward To Gateway"
      confirm-color="primary"
      :context-fields="intakeContextFields"
      :fields="[
        {
          key: 'amount',
          label: 'Paid Amount',
          type: 'number',
          required: true,
          step: '0.01',
          hint: 'Cash payments can be edited before the request is forwarded to gateway processing.'
        },
        {
          key: 'paymentMethod',
          label: 'Payment Method',
          type: 'select',
          required: true,
          items: ['Cash', 'Online', 'GCash', 'Maya', 'Bank Transfer']
        },
        {
          key: 'remarks',
          label: 'Payment Update Notes',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Confirm this payment handoff to gateway processing.'
        }
      ]"
      :initial-values="intakeApproveInitialValues"
      @update:model-value="intakeDialogMode = $event ? intakeDialogMode : null"
      @submit="submitIntakeApproveAction"
    />

    <WorkflowActionDialog
      v-else-if="intakeDialogMode === 'settle_partial'"
      :model-value="true"
      :loading="actionLoading"
      title="Create Installment Payment"
      subtitle="Create a partial payment request from this intake record and keep the remaining balance visible upstream."
      chip-label="Installment"
      chip-color="warning"
      confirm-label="Create Installment"
      confirm-color="warning"
      :context-fields="intakeContextFields"
      :fields="[
        {
          key: 'installmentAmount',
          label: 'Installment Amount',
          type: 'number',
          required: true
        },
        {
          key: 'installmentCount',
          label: 'Installment Count',
          type: 'number',
          required: true
        },
        {
          key: 'dueSchedule',
          label: 'Due Schedule',
          type: 'text',
          required: true
        },
        {
          key: 'paymentMethod',
          label: 'Payment Method',
          type: 'select',
          required: true,
          items: ['Cash', 'Online', 'GCash', 'Maya', 'Bank Transfer']
        },
        {
          key: 'remarks',
          label: 'Installment Notes',
          type: 'textarea',
          required: true,
          rows: 3
        }
      ]"
      :initial-values="intakeInstallmentInitialValues"
      @update:model-value="intakeDialogMode = $event ? intakeDialogMode : null"
      @submit="submitIntakeInstallmentAction"
    />

    <WorkflowActionDialog
      v-else-if="intakeDialogMode === 'mark_failed'"
      :model-value="true"
      :loading="actionLoading"
      title="Mark Payment Intake As Failed"
      subtitle="Keep the record in Pay Bills with a cashier failure reason so it can be corrected or retried."
      chip-label="Failed"
      chip-color="error"
      confirm-label="Mark Failed"
      confirm-color="error"
      :context-fields="intakeContextFields"
      :fields="[
        {
          key: 'reason',
          label: 'Failure Reason',
          type: 'select',
          required: true,
          items: ['Failed amount validation', 'Incorrect payment amount', 'Invalid payment method', 'Duplicate payment request']
        },
        {
          key: 'remarks',
          label: 'Failure Notes',
          type: 'textarea',
          required: true,
          rows: 3
        }
      ]"
      :initial-values="intakeFailedInitialValues"
      @update:model-value="intakeDialogMode = $event ? intakeDialogMode : null"
      @submit="submitIntakeFailedAction"
    />

    <WorkflowActionDialog
      v-if="dialogMode === 'authorize'"
      :model-value="true"
      :loading="actionLoading"
      title="Authorize Transaction"
      subtitle="Validate the gateway request details before keeping this record in the active processing queue."
      chip-label="Gateway Authorization"
      chip-color="primary"
      confirm-label="Authorize"
      confirm-color="primary"
      :context-fields="paymentContextFields"
      :fields="[
        {
          key: 'gatewayRemarks',
          label: 'Gateway Remarks',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Describe the gateway validation result.'
        },
        {
          key: 'authorizationNotes',
          label: 'Authorization Notes',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Add cashier authorization notes.'
        }
      ]"
      :initial-values="authorizeInitialValues"
      @update:model-value="dialogMode = $event ? dialogMode : null"
      @submit="submitAuthorizeAction"
    />

    <WorkflowActionDialog
      v-else-if="dialogMode === 'confirm'"
      :model-value="true"
      :loading="actionLoading"
      title="Confirm Paid Transaction"
      subtitle="Finalize the paid transaction so it leaves Gateway and appears in Compliance & Documentation."
      chip-label="Confirm Paid"
      chip-color="success"
      confirm-label="Confirm Paid"
      confirm-color="success"
      :context-fields="paymentContextFields"
      :fields="[
        {
          key: 'confirmedBy',
          label: 'Confirmed By',
          type: 'text',
          required: true,
          readonly: true
        },
        {
          key: 'confirmationNotes',
          label: 'Confirmation Notes',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Add cashier confirmation notes before moving this payment forward.'
        }
      ]"
      :initial-values="confirmInitialValues"
      @update:model-value="dialogMode = $event ? dialogMode : null"
      @submit="submitConfirmAction"
    />

    <WorkflowCorrectionDialog
      v-model="correctionDialog"
      :loading="actionLoading"
      :record-label="correctionPayment?.reference || correctionIntake?.reference || 'payment transaction'"
      :current-module-label="correctionPayment ? 'Payment Processing & Gateway' : 'Pay Bills'"
      :target-module-label="correctionPayment ? 'Pay Bills' : 'Student Portal & Billing'"
      :reason-options="[
        'Incorrect payment amount',
        'Invalid payment request',
        'Wrong payment method',
        'Failed amount validation',
        'Duplicate payment attempt'
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
.allocation-summary-card,
.focus-allocation-list { padding: 14px 16px; border-radius: 16px; background: linear-gradient(180deg, #f7fbff 0%, #f3f7fb 100%); border: 1px solid rgba(66, 110, 182, 0.12); }
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
.flow-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.flow-step { padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(78,107,168,0.14); background: #f8fbff; color: #51627d; font-size: 13px; font-weight: 700; }
.flow-step--done { background: rgba(34,197,94,0.12); color: #166534; border-color: rgba(34,197,94,0.22); }
.flow-step--active { background: rgba(37,99,235,0.12); color: #1d4ed8; border-color: rgba(37,99,235,0.22); }
.queue-row { cursor: pointer; transition: background 160ms ease; }
.queue-row:hover { background: rgba(55, 123, 229, 0.08); }
.focus-banner { padding: 18px; border-radius: 16px; color: #fff; background: linear-gradient(135deg, #1d4b96 0%, #3579c9 100%); }
.focus-next-step { padding: 14px 16px; border-radius: 14px; background: #f6f9ff; border: 1px solid rgba(78,107,168,0.14); }
.alert-card { padding: 14px; border-radius: 14px; background: #fbf7f1; border: 1px solid rgba(189,157,120,0.15); }
.alert-card + .alert-card { margin-top: 12px; }
.confirm-dialog { border-radius: 20px; }
.report-list { display: grid; gap: 12px; }
.report-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px; border-radius: 16px; background: linear-gradient(180deg, #fff 0%, #fbf7f1 100%); border: 1px solid rgba(189,157,120,0.18); }
@media (max-width: 959px) {
  .entry-actions { min-width: 100%; }
  .focus-column {
    position: static;
    max-height: none;
    overflow: visible;
    padding-right: 0;
  }
  .flow-strip { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 959px) { .report-row { flex-direction: column; align-items: flex-start; } }
@media (max-width: 640px) {
  .entry-grid { grid-template-columns: 1fr; }
  .flow-strip { grid-template-columns: 1fr; }
}
</style>




