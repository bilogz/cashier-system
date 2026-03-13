<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  mdiArchiveOutline,
  mdiContentSaveOutline,
  mdiPauseCircleOutline
} from '@mdi/js';
import { useAuthStore } from '@/stores/auth';
import CashierAnalyticsCard from '@/components/shared/CashierAnalyticsCard.vue';
import CashierActionButton from '@/components/shared/CashierActionButton.vue';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';
import WorkflowActionDialog from '@/components/shared/WorkflowActionDialog.vue';
import WorkflowCorrectionDialog from '@/components/shared/WorkflowCorrectionDialog.vue';
import {
  fetchManagementSnapshot,
  type BillingAlert,
  type BillingFeeItem,
  type BillingStatCard,
  type ManagementLedgerItem,
  type ManagementLedgerStatus
} from '@/services/studentBilling';
import { returnWorkflowRecordForCorrection } from '@/services/workflowCorrections';
import { createApprovedPaymentRequest, createInstallmentArrangement, markPayBillsFailed } from '@/services/workflowCrudActions';

const stats = ref<BillingStatCard[]>([]);
const auth = useAuthStore();
const ledgerItems = ref<ManagementLedgerItem[]>([]);
const selectedLedger = ref<ManagementLedgerItem | null>(null);
const recentUpdates = ref<BillingAlert[]>([]);
const search = ref('');
const itemsPerPage = ref(6);
const currentPage = ref(1);
const loading = ref(false);
const actionLoading = ref(false);
const errorMessage = ref('');

const dialogMode = ref<'settle_full' | 'settle_partial' | 'mark_failed' | null>(null);
const correctionDialog = ref(false);
const correctionLedger = ref<ManagementLedgerItem | null>(null);
const snackbar = ref(false);
const snackbarMessage = ref('');

const filteredLedgerItems = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  if (!keyword) return ledgerItems.value;

  return ledgerItems.value.filter((item) =>
    [item.billingCode, item.studentName, item.semester, item.category, item.status, item.balance, item.remarks]
      .join(' ')
      .toLowerCase()
      .includes(keyword)
  );
});

const totalPages = computed(() => Math.max(1, Math.ceil(filteredLedgerItems.value.length / itemsPerPage.value)));
const resultSummary = computed(() =>
  search.value.trim()
    ? `${filteredLedgerItems.value.length} ledger match${filteredLedgerItems.value.length === 1 ? '' : 'es'} for "${search.value.trim()}"`
    : `${ledgerItems.value.length} billing ledger record${ledgerItems.value.length === 1 ? '' : 's'} available`
);
const nextStepLabel = computed(() => {
  if (!selectedLedger.value) return 'Select a billing ledger to review its maintenance path.';
  if (selectedLedger.value.status === 'Fully Paid') return 'Forwarded to Payment Processing & Gateway for transaction validation.';
  if (selectedLedger.value.status === 'Partially Paid') return 'Remain visible here until the balance is fully settled.';
  if (selectedLedger.value.status === 'Payment Failed') return 'Retry payment or return the student billing to review.';
  return 'Accept payment here, then hand the request to the payment gateway flow.';
});

const paginatedLedgerItems = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value;
  return filteredLedgerItems.value.slice(start, start + itemsPerPage.value);
});

function statusColor(status: ManagementLedgerStatus) {
  if (status === 'Fully Paid') return 'success';
  if (status === 'Partially Paid') return 'warning';
  if (status === 'Payment Failed') return 'error';
  return 'primary';
}

function openDialog(mode: 'settle_full' | 'settle_partial' | 'mark_failed', item: ManagementLedgerItem) {
  selectedLedger.value = item;
  dialogMode.value = mode;
}

function openCorrectionDialog(item: ManagementLedgerItem) {
  selectedLedger.value = item;
  correctionLedger.value = item;
  correctionDialog.value = true;
}

function parseCurrencyValue(value: string) {
  const numeric = Number(String(value || '').replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

function allocationStatusColor(status: BillingFeeItem['status']) {
  if (status === 'Paid') return 'success';
  if (status === 'Partially Paid') return 'warning';
  return 'secondary';
}

function buildAutoAllocations(feeItems: BillingFeeItem[], amount: number) {
  let remaining = Number(amount || 0);
  const allocations: Array<{ billingItemId: number; allocatedAmount: number }> = [];

  for (const feeItem of feeItems) {
    if (remaining <= 0) break;
    const available = Number(feeItem.remainingAmount || 0);
    if (available <= 0) continue;
    const allocatedAmount = Number(Math.min(available, remaining).toFixed(2));
    if (allocatedAmount <= 0) continue;
    allocations.push({
      billingItemId: feeItem.id,
      allocatedAmount
    });
    remaining = Number((remaining - allocatedAmount).toFixed(2));
  }

  return allocations;
}

function buildManualAllocations(formValues: Record<string, string | number>, feeItems: BillingFeeItem[]) {
  return feeItems
    .map((feeItem) => ({
      billingItemId: feeItem.id,
      allocatedAmount: Number(formValues[`alloc_${feeItem.id}`] || 0)
    }))
    .filter((item) => item.allocatedAmount > 0);
}

function resolveAllocationPayload(formValues: Record<string, string | number>, feeItems: BillingFeeItem[], amount: number) {
  const allocationMode = String(formValues.allocationMode || 'auto');
  const allocations = allocationMode === 'manual' ? buildManualAllocations(formValues, feeItems) : buildAutoAllocations(feeItems, amount);
  return { allocationMode, allocations };
}

function formatActionMessage(response: { message?: string; next_module?: string }) {
  if (response.next_module) return `${response.message} Next queue: ${response.next_module}.`;
  return response.message || 'Pay Bills queue updated successfully.';
}

async function loadSnapshot() {
  loading.value = true;
  errorMessage.value = '';

  try {
    const snapshot = await fetchManagementSnapshot();
    stats.value = snapshot.stats;
    ledgerItems.value = snapshot.items;
    recentUpdates.value = snapshot.activityFeed;

    if (!selectedLedger.value) {
      selectedLedger.value = snapshot.items[0] ?? null;
      return;
    }

    selectedLedger.value = snapshot.items.find((item) => item.id === selectedLedger.value?.id) || snapshot.items[0] || null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load billing management records.';
    if (message.toLowerCase().includes('authentication required')) {
      await auth.logout();
      return;
    }
    errorMessage.value = message;
  } finally {
    loading.value = false;
  }
}

async function submitCorrection(payload: { reason: string; remarks: string }) {
  if (!correctionLedger.value) return;

  actionLoading.value = true;
  try {
    const response = await returnWorkflowRecordForCorrection({
      recordId: correctionLedger.value.id,
      currentModule: 'pay_bills',
      reason: payload.reason,
      remarks: payload.remarks
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    correctionDialog.value = false;
    correctionLedger.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to return payment for correction.';
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

watch(ledgerItems, (items) => {
  if (!selectedLedger.value) {
    selectedLedger.value = items[0] ?? null;
    return;
  }

  selectedLedger.value = items.find((item) => item.id === selectedLedger.value?.id) || items[0] || null;
});

watch([search, itemsPerPage], () => {
  currentPage.value = 1;
});

watch(totalPages, (value) => {
  if (currentPage.value > value) currentPage.value = value;
});

async function submitApproveAction(formValues: Record<string, string | number>) {
  if (!selectedLedger.value) return;

  actionLoading.value = true;
  try {
    const amount = Number(formValues.amount || 0);
    const allocationPayload = resolveAllocationPayload(formValues, selectedLedger.value.feeItems || [], amount);
    const response = await createApprovedPaymentRequest({
      billingId: selectedLedger.value.id,
      amount,
      paymentMethod: String(formValues.paymentMethod || 'Online'),
      allocationMode: allocationPayload.allocationMode,
      allocations: allocationPayload.allocations,
      remarks: String(formValues.remarks || '')
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    dialogMode.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to approve payment request.';
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

async function submitInstallmentAction(formValues: Record<string, string | number>) {
  if (!selectedLedger.value) return;

  actionLoading.value = true;
  try {
    const installmentAmount = Number(formValues.installmentAmount || 0);
    const allocationPayload = resolveAllocationPayload(formValues, selectedLedger.value.feeItems || [], installmentAmount);
    const response = await createInstallmentArrangement({
      billingId: selectedLedger.value.id,
      installmentAmount,
      installmentCount: Number(formValues.installmentCount || 1),
      dueSchedule: String(formValues.dueSchedule || ''),
      paymentMethod: String(formValues.paymentMethod || 'Online'),
      allocationMode: allocationPayload.allocationMode,
      allocations: allocationPayload.allocations,
      remarks: String(formValues.remarks || '')
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    dialogMode.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create installment arrangement.';
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

async function submitFailedAction(formValues: Record<string, string | number>) {
  if (!selectedLedger.value) return;

  actionLoading.value = true;
  try {
    const response = await markPayBillsFailed({
      billingId: selectedLedger.value.id,
      reason: String(formValues.reason || ''),
      remarks: String(formValues.remarks || '')
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    dialogMode.value = null;
    await loadSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to mark the payment request as failed.';
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

const ledgerContextFields = computed(() => {
  if (!selectedLedger.value) return [];

  return [
    { label: 'Student', value: selectedLedger.value.studentName },
    { label: 'Billing Code', value: selectedLedger.value.billingCode },
    { label: 'Status', value: selectedLedger.value.status },
    { label: 'Remaining Balance', value: selectedLedger.value.balance },
    { label: 'Semester', value: selectedLedger.value.semester },
    { label: 'Category', value: selectedLedger.value.category }
  ];
});

const approveInitialValues = computed(() => ({
  amount: parseCurrencyValue(selectedLedger.value?.balance || '0'),
  paymentMethod: 'Online',
  allocationMode: 'auto',
  remarks: 'Payment request approved for processing.'
}));

const installmentInitialValues = computed(() => {
  const remainingBalance = parseCurrencyValue(selectedLedger.value?.balance || '0');
  const suggestedInstallment = remainingBalance > 0 ? Number(Math.max(500, Math.round(remainingBalance / 2)).toFixed(2)) : '';

  return {
    installmentAmount: suggestedInstallment,
    installmentCount: 2,
    dueSchedule: 'Every 15th of the month',
    paymentMethod: 'Online',
    allocationMode: 'manual',
    remarks: 'Installment payment request created from Pay Bills.'
  };
});

const failedInitialValues = computed(() => ({
  reason: 'Failed amount validation',
  remarks: 'Payment request failed before gateway handoff and needs review.'
}));

onMounted(() => {
  loadSnapshot();
});
</script>

<template>
  <v-row>
    <v-col cols="12">
      <v-card class="hero-banner" elevation="0">
        <v-card-text class="pa-6">
          <div class="d-flex flex-column flex-lg-row justify-space-between ga-4">
            <div>
              <div class="hero-kicker">Pay Bills</div>
              <h1 class="text-h4 font-weight-black mb-2">Pay Bills</h1>
              <p class="hero-subtitle mb-0">
                Accept full or installment bill settlements and prepare approved payments for gateway processing.
              </p>
            </div>
            <div class="hero-side-panel">
              <div class="hero-side-label">Payment Flow</div>
              <div class="text-h6 font-weight-bold">Pending Payment -> Settlement -> Gateway</div>
              <div class="text-body-2">Only active billings from Student Portal & Billing should move through this queue.</div>
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
          <div class="d-flex flex-column flex-md-row justify-space-between ga-3 w-100">
            <div>
              <v-card-title class="px-0">Bills Payment Queue</v-card-title>
              <v-card-subtitle class="px-0">Accept settlement requests, keep partial balances visible, and forward payments to the gateway.</v-card-subtitle>
            </div>
            <div class="billing-toolbar">
              <div class="billing-search-stack">
                <v-text-field
                  v-model="search"
                  prepend-inner-icon="mdi-magnify"
                  append-inner-icon="mdi-book-search-outline"
                  label="Search by billing code, student, payment status, or program"
                  placeholder="Try BILL-1007 or Partially Paid"
                  variant="outlined"
                  density="comfortable"
                  clearable
                  hide-details
                  class="billing-search"
                />
                <div class="d-flex align-center justify-space-between flex-wrap ga-2">
                  <div class="text-body-2 text-medium-emphasis">{{ resultSummary }}</div>
                  <v-btn
                    v-if="search"
                    size="small"
                    variant="text"
                    color="primary"
                    prepend-icon="mdi-filter-remove-outline"
                    @click="search = ''"
                  >
                    Clear Search
                  </v-btn>
                </div>
              </div>
              <v-select
                v-model="itemsPerPage"
                :items="[6, 10]"
                label="Rows per page"
                variant="outlined"
                density="comfortable"
                hide-details
                class="page-size-select"
              />
            </div>
          </div>
        </v-card-item>
        <v-card-text>
          <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">{{ errorMessage }}</v-alert>
          <div v-if="loading" class="py-10 text-center">
            <v-progress-circular indeterminate color="primary" />
          </div>
          <v-row>
            <v-col v-for="item in paginatedLedgerItems" :key="item.id" cols="12" md="6">
              <v-card class="billing-card" :class="{ 'billing-card--selected': selectedLedger?.id === item.id }" elevation="0" @click="selectedLedger = item">
                <v-card-text class="pa-4">
                  <div class="d-flex flex-column flex-xl-row justify-space-between ga-4">
                    <div class="flex-grow-1">
                      <div class="d-flex flex-wrap align-center ga-3 mb-3">
                        <div class="text-subtitle-1 font-weight-bold">{{ item.studentName }}</div>
                        <v-chip size="small" :color="statusColor(item.status)" variant="tonal">{{ item.status }}</v-chip>
                        <v-chip size="small" color="primary" variant="outlined">{{ item.billingCode }}</v-chip>
                      </div>
                      <div class="billing-grid">
                        <div>
                          <div class="metric-label">Semester</div>
                          <div class="meta-value">{{ item.semester }}</div>
                        </div>
                        <div>
                          <div class="metric-label">Category</div>
                          <div class="meta-value">{{ item.category }}</div>
                        </div>
                        <div>
                          <div class="metric-label">Total Assessment</div>
                          <div class="meta-value">{{ item.total }}</div>
                        </div>
                        <div>
                          <div class="metric-label">Remaining Balance</div>
                          <div class="meta-value">{{ item.balance }}</div>
                        </div>
                      </div>
                      <div v-if="item.feeSummary" class="fee-summary-strip mt-4">
                        <div class="metric-label">Fees Summary</div>
                        <div class="text-body-2 font-weight-medium">{{ item.feeSummary.label }}</div>
                        <div class="text-body-2 text-medium-emphasis">
                          Paid {{ item.feeSummary.finalizedAmountFormatted }} | Remaining {{ item.feeSummary.remainingAmountFormatted }}
                        </div>
                      </div>
                      <div v-if="item.feeItems?.length" class="fee-breakdown-list mt-3">
                        <div v-for="fee in item.feeItems.slice(0, 4)" :key="fee.id" class="fee-breakdown-row">
                          <div>
                            <div class="font-weight-medium">{{ fee.feeType }}</div>
                            <div class="text-body-2 text-medium-emphasis">
                              {{ fee.amountFormatted }} | Remaining {{ fee.remainingAmountFormatted }}
                            </div>
                          </div>
                          <v-chip size="x-small" :color="allocationStatusColor(fee.status)" variant="tonal">{{ fee.status }}</v-chip>
                        </div>
                      </div>
                      <div class="billing-note mt-4">{{ item.remarks }}</div>
                    </div>
                    <div class="billing-actions">
                      <CashierActionButton :icon="mdiContentSaveOutline" label="Approve" color="primary" @click="openDialog('settle_full', item)" />
                      <CashierActionButton :icon="mdiPauseCircleOutline" label="Installment" color="warning" variant="outlined" @click="openDialog('settle_partial', item)" />
                      <CashierActionButton :icon="mdiArchiveOutline" label="Failed" color="error" variant="tonal" @click="openDialog('mark_failed', item)" />
                      <CashierActionButton :icon="mdiPauseCircleOutline" label="Correction" color="error" variant="outlined" @click="openCorrectionDialog(item)" />
                    </div>
                  </div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col v-if="!loading && filteredLedgerItems.length === 0" cols="12">
              <div class="text-body-2 text-medium-emphasis py-8 text-center">No billing ledgers matched your search.</div>
            </v-col>
          </v-row>
          <div v-if="!loading && filteredLedgerItems.length > 0" class="d-flex flex-column flex-md-row justify-space-between align-md-center ga-3 mt-4">
            <div class="text-body-2 text-medium-emphasis">
              Showing {{ Math.min((currentPage - 1) * itemsPerPage + 1, filteredLedgerItems.length) }}-{{ Math.min(currentPage * itemsPerPage, filteredLedgerItems.length) }}
              of {{ filteredLedgerItems.length }} billing records
            </div>
            <v-pagination v-model="currentPage" :length="totalPages" density="comfortable" total-visible="5" />
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="4" class="focus-column">
        <v-card class="panel-card mb-6" variant="outlined">
        <v-card-item>
          <v-card-title>Payment Focus</v-card-title>
          <v-card-subtitle>Selected billing and settlement direction</v-card-subtitle>
        </v-card-item>
        <v-card-text v-if="selectedLedger">
          <div class="focus-banner mb-4">
            <div class="text-overline">Selected Billing</div>
            <div class="text-h6 font-weight-bold">{{ selectedLedger.studentName }}</div>
            <div class="text-body-2">{{ selectedLedger.billingCode }} | {{ selectedLedger.balance }}</div>
          </div>
          <div class="focus-next-step mb-4">
            <div class="metric-label mb-1">Next Step</div>
            <div class="text-body-2">{{ nextStepLabel }}</div>
          </div>
          <v-list density="comfortable" class="py-0">
            <v-list-item title="Status" :subtitle="selectedLedger.status" />
            <v-list-item title="Category" :subtitle="selectedLedger.category" />
            <v-list-item title="Semester" :subtitle="selectedLedger.semester" />
            <v-list-item title="Total assessment" :subtitle="selectedLedger.total" />
          </v-list>
          <div v-if="selectedLedger.feeItems?.length" class="focus-fee-list mt-4">
            <div class="metric-label mb-2">Fee Breakdown</div>
            <div v-for="fee in selectedLedger.feeItems" :key="fee.id" class="focus-fee-row">
              <div>
                <div class="font-weight-medium">{{ fee.feeType }}</div>
                <div class="text-body-2 text-medium-emphasis">
                  Paid {{ fee.paidAmountFormatted }} | Remaining {{ fee.remainingAmountFormatted }}
                </div>
              </div>
              <v-chip size="x-small" :color="allocationStatusColor(fee.status)" variant="tonal">{{ fee.status }}</v-chip>
            </div>
          </div>
        </v-card-text>
      </v-card>

      <v-card class="panel-card" variant="outlined">
        <v-card-item>
          <v-card-title>Payment Alerts</v-card-title>
          <v-card-subtitle>Recent payment accepts, failures, and settlement updates</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div v-for="item in recentUpdates" :key="item.title" class="alert-card">
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
      <ModuleActivityLogs module="manage_billing" title="Pay Bills Activity Logs" :per-page="6" />
    </v-col>

    <WorkflowActionDialog
      v-if="dialogMode === 'settle_full'"
      :model-value="true"
      :loading="actionLoading"
      title="Approve Payment Request"
      subtitle="Confirm the full settlement details and create the payment request that will move this billing into Payment Processing & Gateway."
      chip-label="Approve"
      chip-color="primary"
      confirm-label="Approve Payment"
      confirm-color="primary"
      :context-fields="ledgerContextFields"
      :fields="[
        {
          key: 'amount',
          label: 'Approved Amount',
          type: 'number',
          required: true,
          readonly: true,
          hint: 'Full approval uses the current remaining balance.'
        },
        {
          key: 'paymentMethod',
          label: 'Payment Method',
          type: 'select',
          required: true,
          items: ['Online', 'GCash', 'Maya', 'Bank Transfer']
        },
        {
          key: 'allocationMode',
          label: 'Allocation Mode',
          type: 'select',
          required: true,
          items: ['auto', 'manual'],
          hint: 'Use auto allocation or assign the amount per fee item manually.'
        },
        {
          key: 'remarks',
          label: 'Approval Remarks',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Add cashier approval notes before forwarding the request.'
        }
      ]"
      :initial-values="approveInitialValues"
      @update:model-value="dialogMode = $event ? dialogMode : null"
      @submit="submitApproveAction"
    >
      <template #preview="{ formValues }">
        <div v-if="selectedLedger?.feeItems?.length" class="allocation-panel mb-5">
          <div class="allocation-panel__header">
            <div>
              <div class="receipt-preview-kicker">Fee Allocation Review</div>
              <div class="text-h6 font-weight-black">Select What This Payment Covers</div>
            </div>
            <v-chip color="primary" variant="tonal" size="small">{{ String(formValues.allocationMode || 'auto').toUpperCase() }}</v-chip>
          </div>
          <div class="allocation-fee-list">
            <div v-for="fee in selectedLedger.feeItems" :key="`approve-${fee.id}`" class="allocation-fee-row">
              <div class="allocation-fee-copy">
                <div class="font-weight-medium">{{ fee.feeType }}</div>
                <div class="text-body-2 text-medium-emphasis">
                  Remaining {{ fee.remainingAmountFormatted }} | Paid {{ fee.paidAmountFormatted }}
                </div>
              </div>
              <v-chip size="x-small" :color="allocationStatusColor(fee.status)" variant="tonal">{{ fee.status }}</v-chip>
              <v-text-field
                v-if="String(formValues.allocationMode || 'auto') === 'manual'"
                v-model="formValues[`alloc_${fee.id}`]"
                type="number"
                density="compact"
                variant="outlined"
                hide-details
                :min="0"
                :max="fee.remainingAmount"
                step="0.01"
                class="allocation-input"
                label="Allocate"
              />
            </div>
          </div>
        </div>
      </template>
    </WorkflowActionDialog>

    <WorkflowActionDialog
      v-else-if="dialogMode === 'settle_partial'"
      :model-value="true"
      :loading="actionLoading"
      title="Apply Installment Payment"
      subtitle="Capture the installment arrangement, create the partial payment request, and keep the remaining balance visible in Pay Bills."
      chip-label="Installment"
      chip-color="warning"
      confirm-label="Create Installment"
      confirm-color="warning"
      :context-fields="ledgerContextFields"
      :fields="[
        {
          key: 'installmentAmount',
          label: 'Installment Amount',
          type: 'number',
          required: true,
          hint: 'This amount becomes the partial payment request sent to the gateway.'
        },
        {
          key: 'installmentCount',
          label: 'Number of Installments',
          type: 'number',
          required: true,
          hint: 'Use the expected number of settlement cycles for this billing.'
        },
        {
          key: 'dueSchedule',
          label: 'Due Schedule',
          type: 'text',
          required: true,
          placeholder: 'Every 15th of the month'
        },
        {
          key: 'paymentMethod',
          label: 'Payment Method',
          type: 'select',
          required: true,
          items: ['Online', 'GCash', 'Maya', 'Bank Transfer']
        },
        {
          key: 'allocationMode',
          label: 'Allocation Mode',
          type: 'select',
          required: true,
          items: ['auto', 'manual'],
          hint: 'Choose which fee items this installment should cover.'
        },
        {
          key: 'remarks',
          label: 'Remarks',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Add cashier notes for the installment plan.'
        }
      ]"
      :initial-values="installmentInitialValues"
      @update:model-value="dialogMode = $event ? dialogMode : null"
      @submit="submitInstallmentAction"
    >
      <template #preview="{ formValues }">
        <div v-if="selectedLedger?.feeItems?.length" class="allocation-panel mb-5">
          <div class="allocation-panel__header">
            <div>
              <div class="receipt-preview-kicker">Installment Coverage</div>
              <div class="text-h6 font-weight-black">Fee Items Included in This Installment</div>
            </div>
            <v-chip color="warning" variant="tonal" size="small">{{ String(formValues.allocationMode || 'auto').toUpperCase() }}</v-chip>
          </div>
          <div class="allocation-fee-list">
            <div v-for="fee in selectedLedger.feeItems" :key="`installment-${fee.id}`" class="allocation-fee-row">
              <div class="allocation-fee-copy">
                <div class="font-weight-medium">{{ fee.feeType }}</div>
                <div class="text-body-2 text-medium-emphasis">
                  Remaining {{ fee.remainingAmountFormatted }} | Pending {{ fee.pendingAmountFormatted }}
                </div>
              </div>
              <v-chip size="x-small" :color="allocationStatusColor(fee.status)" variant="tonal">{{ fee.status }}</v-chip>
              <v-text-field
                v-if="String(formValues.allocationMode || 'auto') === 'manual'"
                v-model="formValues[`alloc_${fee.id}`]"
                type="number"
                density="compact"
                variant="outlined"
                hide-details
                :min="0"
                :max="fee.remainingAmount"
                step="0.01"
                class="allocation-input"
                label="Allocate"
              />
            </div>
          </div>
        </div>
      </template>
    </WorkflowActionDialog>

    <WorkflowActionDialog
      v-else-if="dialogMode === 'mark_failed'"
      :model-value="true"
      :loading="actionLoading"
      title="Mark Payment as Failed"
      subtitle="Capture the cashier failure reason so the billing stays in Pay Bills and can be reviewed or retried correctly."
      chip-label="Failed"
      chip-color="error"
      confirm-label="Mark as Failed"
      confirm-color="error"
      :context-fields="ledgerContextFields"
      :fields="[
        {
          key: 'reason',
          label: 'Failure Reason',
          type: 'select',
          required: true,
          items: [
            'Failed amount validation',
            'Incorrect payment amount',
            'Invalid payment method',
            'Duplicate payment request',
            'Student account not eligible'
          ]
        },
        {
          key: 'remarks',
          label: 'Failure Remarks',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Describe why this payment request failed.'
        }
      ]"
      :initial-values="failedInitialValues"
      @update:model-value="dialogMode = $event ? dialogMode : null"
      @submit="submitFailedAction"
    />

    <WorkflowCorrectionDialog
      v-model="correctionDialog"
      :loading="actionLoading"
      :record-label="correctionLedger?.billingCode || 'billing ledger'"
      current-module-label="Pay Bills"
      target-module-label="Student Portal & Billing"
      :reason-options="[
        'Incorrect billing amount',
        'Wrong invoice details',
        'Student information mismatch',
        'Duplicate billing'
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

.fee-summary-strip,
.allocation-panel {
  padding: 14px 16px;
  border-radius: 16px;
  background: linear-gradient(180deg, #f7fbff 0%, #f3f7fb 100%);
  border: 1px solid rgba(66, 110, 182, 0.12);
}

.fee-breakdown-list,
.allocation-fee-list,
.focus-fee-list {
  display: grid;
  gap: 10px;
}

.fee-breakdown-row,
.focus-fee-row,
.allocation-fee-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(120, 145, 190, 0.12);
}

.allocation-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.allocation-fee-copy {
  flex: 1 1 auto;
  min-width: 0;
}

.allocation-input {
  max-width: 130px;
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

.billing-toolbar {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) 170px;
  gap: 12px;
  align-items: start;
  width: min(100%, 560px);
}

.billing-search-stack {
  display: grid;
  gap: 10px;
}

.billing-search {
  min-width: 0;
}

.billing-card {
  height: 100%;
  border-radius: 18px;
  background: linear-gradient(180deg, #fff 0%, #fbf7f1 100%);
  border: 1px solid rgba(189, 157, 120, 0.18);
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
  cursor: pointer;
}

.billing-card:hover {
  transform: translateY(-1px);
  border-color: rgba(33, 80, 166, 0.28);
}

.billing-card--selected {
  border-color: rgba(33, 80, 166, 0.4);
  box-shadow: 0 0 0 2px rgba(33, 80, 166, 0.08);
}

.page-size-select {
  min-width: 160px;
}

.billing-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.meta-value {
  margin-top: 4px;
  color: #18243f;
  font-weight: 700;
}

.billing-note {
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(33, 80, 166, 0.06);
  color: #49556e;
}

.billing-actions {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-content: start;
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

.alert-card {
  padding: 14px;
  border-radius: 14px;
  background: #fbf7f1;
  border: 1px solid rgba(189, 157, 120, 0.15);
}

.alert-card + .alert-card {
  margin-top: 12px;
}

@media (max-width: 959px) {
  .focus-column {
    position: static;
    max-height: none;
    overflow: visible;
    padding-right: 0;
  }
}

.confirm-dialog {
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.18);
}

.dialog-hero {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 24px 20px;
  background: linear-gradient(135deg, #f6f9ff 0%, #eef4ff 100%);
  border-bottom: 1px solid rgba(78, 107, 168, 0.14);
}

.dialog-hero-copy {
  max-width: 320px;
}

.dialog-icon-shell {
  width: 60px;
  height: 60px;
  border-radius: 18px;
  display: grid;
  place-items: center;
  background: rgba(47, 84, 185, 0.1);
  color: #2f54b9;
}

.dialog-icon-shell--primary {
  background: rgba(47, 84, 185, 0.12);
  color: #2f54b9;
}

.dialog-icon-shell--warning {
  background: rgba(237, 108, 2, 0.12);
  color: #ed6c02;
}

.dialog-icon-shell--secondary {
  background: rgba(90, 63, 175, 0.12);
  color: #5a3faf;
}

.dialog-summary-card {
  padding: 16px;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
  border: 1px solid rgba(78, 107, 168, 0.16);
}

.dialog-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 16px;
}

.dialog-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #71819e;
  font-weight: 700;
}

.dialog-value {
  margin-top: 4px;
  font-size: 15px;
  font-weight: 700;
  color: #18243f;
}

.dialog-message {
  color: #46546f;
  line-height: 1.65;
}

.dialog-confirm-btn {
  min-width: 126px;
  box-shadow: 0 12px 24px rgba(47, 84, 185, 0.18);
}

@media (max-width: 959px) {
  .billing-actions {
    min-width: 100%;
  }
}

@media (max-width: 640px) {
  .billing-toolbar {
    grid-template-columns: 1fr;
  }

  .billing-grid {
    grid-template-columns: 1fr;
  }

  .dialog-hero {
    flex-direction: column;
    align-items: flex-start;
  }

  .dialog-summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
