<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  mdiBellOutline,
  mdiCheckDecagramOutline,
  mdiCloseThick,
  mdiMagnify
} from '@mdi/js';
import { useRoute } from 'vue-router';
import CashierAnalyticsCard from '@/components/shared/CashierAnalyticsCard.vue';
import CashierActionButton from '@/components/shared/CashierActionButton.vue';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';
import WorkflowActionDialog from '@/components/shared/WorkflowActionDialog.vue';
import WorkflowCorrectionDialog from '@/components/shared/WorkflowCorrectionDialog.vue';
import { useAuthStore } from '@/stores/auth';
import {
  fetchVerificationSnapshot,
  type BillingAlert,
  type BillingFeeItem,
  type BillingStatCard,
  type VerificationBillingItem,
  type VerificationBillingStatus
} from '@/services/studentBilling';
import { returnWorkflowRecordForCorrection } from '@/services/workflowCorrections';
import { verifyWorkflowRecord } from '@/services/workflowActions';
import { sendWorkflowNotification } from '@/services/workflowCrudActions';
import { fetchIntegratedFlow, type IntegratedFlowEdge } from '@/services/integratedFlow';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';

const route = useRoute();
const auth = useAuthStore();

const pageTitle = computed(() => String(route.meta.pageTitle || 'Student Billing Verification'));
const pageDescription = computed(
  () =>
    String(
      route.meta.pageDescription ||
        'Start the BPA cashier flow by viewing billing summaries, checking eligibility, and forwarding valid billings to Pay Bills.'
    )
);

const stats = ref<BillingStatCard[]>([]);
const billingItems = ref<VerificationBillingItem[]>([]);
const activityFeed = ref<BillingAlert[]>([]);
const selectedBilling = ref<VerificationBillingItem | null>(null);
const dialogMode = ref<'approve' | 'notify' | null>(null);
const correctionDialog = ref(false);
const correctionBilling = ref<VerificationBillingItem | null>(null);
const snackbar = ref(false);
const snackbarMessage = ref('');
const search = ref('');
const itemsPerPage = ref(6);
const currentPage = ref(1);
const loading = ref(false);
const actionLoading = ref(false);
const errorMessage = ref('');
const integrationLoading = ref(false);
const integrationError = ref('');
const incomingDependencies = ref<IntegratedFlowEdge[]>([]);
const outgoingDependencies = ref<IntegratedFlowEdge[]>([]);
const realtime = useRealtimeListSync();
const departmentFilter = ref('All Departments');
const categoryFilter = ref('All Categories');
const departmentFilterOptions = computed(() => [
  'All Departments',
  ...new Set(billingItems.value.map((item) => item.sourceDepartment).filter(Boolean))
]);
const categoryFilterOptions = computed(() => [
  'All Categories',
  ...new Set(billingItems.value.map((item) => item.sourceCategory).filter(Boolean))
]);

const filteredBillings = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  const departmentValue = departmentFilter.value;
  const sourceFiltered =
    departmentValue === 'All Departments'
      ? billingItems.value
      : billingItems.value.filter((item) => item.sourceDepartment === departmentValue);
  const categoryFiltered =
    categoryFilter.value === 'All Categories'
      ? sourceFiltered
      : sourceFiltered.filter((item) => item.sourceCategory === categoryFilter.value);

  if (!keyword) return categoryFiltered;

  return categoryFiltered.filter((item) =>
    [
      item.reference,
      item.studentName,
      item.studentNumber,
      item.program,
      item.sourceModule,
      item.sourceDepartment,
      item.sourceCategory,
      item.status,
      item.workflowStageLabel,
      item.note,
      item.feeSummary?.label ?? '',
      ...(item.feeItems?.map((fee) => `${fee.feeType} ${fee.feeName} ${fee.category}`) ?? [])
    ]
      .join(' ')
      .toLowerCase()
      .includes(keyword)
  );
});

const totalPages = computed(() => Math.max(1, Math.ceil(filteredBillings.value.length / itemsPerPage.value)));
const resultSummary = computed(() =>
  search.value.trim()
    ? `${filteredBillings.value.length} match${filteredBillings.value.length === 1 ? '' : 'es'} for "${search.value.trim()}"`
    : `${filteredBillings.value.length} billing record${filteredBillings.value.length === 1 ? '' : 's'} available`
);
const nextStepLabel = computed(() => {
  if (!selectedBilling.value) return 'Select a billing record to review the next action.';
  if ((selectedBilling.value.feeSummary?.remainingAmount ?? 0) <= 0) {
    return 'This billing is already settled. Review it in the later workflow/history stages instead of verifying it again.';
  }
  if (selectedBilling.value.status === 'Pending Payment') return 'This billing is ready to continue to Pay Bills.';
  if (selectedBilling.value.status === 'Needs Correction') return 'Return this to billing management for correction and re-check.';
  if (selectedBilling.value.status === 'Draft') return 'Complete the billing details and activate the record first.';
  return 'Review the billing details and activate the billing once it is valid for payment.';
});

function getVerifyBlockReason(item: VerificationBillingItem) {
  const remainingAmount = Number(item.feeSummary?.remainingAmount ?? 0);

  if (item.workflowStage !== 'student_portal_billing') {
    return 'Only billings still in Student Portal & Billing can be verified.';
  }
  if (remainingAmount <= 0) {
    return 'Only billings with an active outstanding balance can be forwarded to Pay Bills.';
  }
  if (item.status !== 'Pending Payment') {
    return 'Only billings marked Pending Payment can be verified for cashier processing.';
  }

  return '';
}

function canVerifyBilling(item: VerificationBillingItem) {
  return getVerifyBlockReason(item) === '';
}

const paginatedBillings = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value;
  return filteredBillings.value.slice(start, start + itemsPerPage.value);
});

const billingContextFields = computed(() => {
  if (!selectedBilling.value) return [];

  return [
    { label: 'Student Name', value: selectedBilling.value.studentName },
    { label: 'Student Number', value: selectedBilling.value.studentNumber },
    { label: 'Billing Code', value: selectedBilling.value.reference },
    { label: 'Program', value: selectedBilling.value.program },
    { label: 'Source Module', value: selectedBilling.value.sourceModule },
    { label: 'Connected Department', value: selectedBilling.value.sourceDepartment },
    { label: 'Booking Category', value: selectedBilling.value.sourceCategory },
    { label: 'Balance Due', value: selectedBilling.value.amount },
    { label: 'Workflow Stage', value: selectedBilling.value.workflowStageLabel }
  ];
});

const verifyInitialValues = computed(() => ({
  studentProfileCheck: 'Complete',
  feeBreakdownCheck: 'Validated',
  paymentEligibilityCheck: 'Eligible',
  duplicateBillingCheck: 'No Duplicate Found',
  remarks: 'Billing verified and ready for payment.',
  validationChecklist: 'Student information, billing amount, and payment eligibility have been reviewed.'
}));

const notifyInitialValues = computed(() => ({
  recipient: selectedBilling.value?.studentName || '',
  subject: 'Billing Status Update',
  message: selectedBilling.value
    ? `${selectedBilling.value.reference} is currently in ${selectedBilling.value.status} and ready for the next cashier action.`
    : 'Billing status update.'
}));

function statusColor(status: VerificationBillingStatus) {
  if (status === 'Pending Payment') return 'success';
  if (status === 'Needs Correction') return 'error';
  if (status === 'Draft') return 'secondary';
  return 'primary';
}

function feeStatusColor(status: BillingFeeItem['status']) {
  if (status === 'Paid') return 'success';
  if (status === 'Partially Paid') return 'warning';
  return 'secondary';
}

function openDialog(mode: 'approve' | 'notify', item: VerificationBillingItem) {
  if (mode === 'approve') {
    const blockReason = getVerifyBlockReason(item);
    if (blockReason) {
      selectedBilling.value = item;
      snackbarMessage.value = blockReason;
      snackbar.value = true;
      return;
    }
  }

  selectedBilling.value = item;
  dialogMode.value = mode;
}

function openCorrectionDialog(item: VerificationBillingItem) {
  selectedBilling.value = item;
  correctionBilling.value = item;
  correctionDialog.value = true;
}

function formatActionMessage(response: { message?: string; next_module?: string }) {
  if (response.next_module) return `${response.message} Next queue: ${response.next_module}.`;
  return response.message || 'Billing queue updated successfully.';
}

async function loadSnapshot(forceRefresh = false, options: { silent?: boolean } = {}) {
  if (!options.silent) loading.value = true;
  errorMessage.value = '';

  try {
    const snapshot = await fetchVerificationSnapshot();
    stats.value = snapshot.stats;
    billingItems.value = snapshot.items;
    activityFeed.value = snapshot.activityFeed;

    if (!selectedBilling.value) {
      selectedBilling.value = snapshot.items[0] ?? null;
      return;
    }

    selectedBilling.value = snapshot.items.find((item) => item.id === selectedBilling.value?.id) || snapshot.items[0] || null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load billing verification records.';
    if (message.toLowerCase().includes('authentication required')) {
      await auth.logout();
      return;
    }
    errorMessage.value = message;
  } finally {
    if (!options.silent) loading.value = false;
  }
}

async function loadIntegrationFlow() {
  integrationLoading.value = true;
  integrationError.value = '';
  try {
    const payload = await fetchIntegratedFlow('Cashier');
    incomingDependencies.value = Array.isArray(payload.incoming) ? payload.incoming : [];
    outgoingDependencies.value = Array.isArray(payload.outgoing) ? payload.outgoing : [];
  } catch (error) {
    integrationError.value = error instanceof Error ? error.message : 'Unable to load integration flow.';
    incomingDependencies.value = [];
    outgoingDependencies.value = [];
  } finally {
    integrationLoading.value = false;
  }
}

watch(billingItems, (items) => {
  if (!selectedBilling.value) {
    selectedBilling.value = items[0] ?? null;
    return;
  }

  selectedBilling.value = items.find((item) => item.id === selectedBilling.value?.id) || items[0] || null;
});

watch([search, itemsPerPage], () => {
  currentPage.value = 1;
});

watch([departmentFilter, categoryFilter], () => {
  currentPage.value = 1;
});

watch(totalPages, (value) => {
  if (currentPage.value > value) currentPage.value = value;
});

watch([dialogMode, selectedBilling], ([mode, billing]) => {
  if (mode !== 'approve' || !billing) return;

  const blockReason = getVerifyBlockReason(billing);
  if (!blockReason) return;

  dialogMode.value = null;
  snackbarMessage.value = blockReason;
  snackbar.value = true;
});

async function submitVerifyAction(formValues: Record<string, string | number>) {
  if (!selectedBilling.value) return;
  const blockReason = getVerifyBlockReason(selectedBilling.value);
  if (blockReason) {
    snackbarMessage.value = blockReason;
    snackbar.value = true;
    return;
  }
  actionLoading.value = true;
  try {
    const response = await verifyWorkflowRecord({
      recordId: selectedBilling.value.id,
      currentModule: 'student_portal_billing',
      remarks: String(formValues.remarks || ''),
      validationChecklist: String(formValues.validationChecklist || ''),
      studentProfileCheck: String(formValues.studentProfileCheck || ''),
      feeBreakdownCheck: String(formValues.feeBreakdownCheck || ''),
      paymentEligibilityCheck: String(formValues.paymentEligibilityCheck || ''),
      duplicateBillingCheck: String(formValues.duplicateBillingCheck || '')
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    dialogMode.value = null;
    await loadSnapshot(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update billing record.';
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

async function submitNotifyAction(formValues: Record<string, string | number>) {
  if (!selectedBilling.value) return;

  actionLoading.value = true;
  try {
    await sendWorkflowNotification({
      billingId: selectedBilling.value.id,
      recipient: String(formValues.recipient || selectedBilling.value.studentName),
      subject: String(formValues.subject || 'Billing Status Update'),
      message: String(formValues.message || '')
    });
    snackbarMessage.value = `Notification sent for ${selectedBilling.value.reference}.`;
    snackbar.value = true;
    dialogMode.value = null;
    await loadSnapshot(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to send billing notification.';
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

async function submitCorrection(payload: { reason: string; remarks: string }) {
  if (!correctionBilling.value) return;

  actionLoading.value = true;
  try {
    const response = await returnWorkflowRecordForCorrection({
      recordId: correctionBilling.value.id,
      currentModule: 'student_portal_billing',
      reason: payload.reason,
      remarks: payload.remarks
    });
    snackbarMessage.value = formatActionMessage(response);
    snackbar.value = true;
    correctionDialog.value = false;
    correctionBilling.value = null;
    await loadSnapshot(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to return billing for correction.';
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
  void loadIntegrationFlow();
  realtime.startPolling(() => {
    void loadSnapshot(true, { silent: true });
  }, 0, { immediate: false, pauseWhenDialogOpen: false });
});

onUnmounted(() => {
  realtime.stopPolling();
  realtime.invalidatePending();
});
</script>

<template>
  <v-row class="billing-page">
    <v-col cols="12">
      <v-card class="hero-banner" elevation="0">
        <v-card-text class="pa-6">
          <div class="d-flex flex-column flex-lg-row justify-space-between ga-4">
            <div>
              <div class="hero-kicker">Student Portal & Billing</div>
              <h1 class="text-h4 font-weight-black mb-2">{{ pageTitle }}</h1>
              <p class="hero-subtitle mb-0">{{ pageDescription }}</p>
            </div>
            <div class="hero-side-panel">
              <div class="hero-side-label">Portal Flow</div>
              <div class="text-h6 font-weight-bold">Statement -> Billing -> Pay Bills</div>
              <div class="text-body-2">Valid billing records move to Pay Bills, while issues are marked for review or correction.</div>
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
        <v-card-item class="pb-0">
          <div class="d-flex flex-column flex-xl-row justify-space-between ga-4 w-100">
            <div>
              <v-card-title class="px-0">Student Billing Queue</v-card-title>
              <v-card-subtitle class="px-0">Review student billing statements, check eligibility, and release valid records to Pay Bills.</v-card-subtitle>
            </div>
            <div class="billing-toolbar">
              <div class="billing-search-stack">
                <v-text-field
                  v-model="search"
                  :prepend-inner-icon="mdiMagnify"
                  label="Search by student, number, billing code, program, stage, or fee"
                  placeholder="Try BILL-VERIFY-2001, Clara, or Accountancy"
                  variant="outlined"
                  density="comfortable"
                  clearable
                  hide-details
                  class="billing-search"
                />
                <div class="d-flex align-center justify-space-between flex-wrap ga-2">
                  <div class="text-body-2 text-medium-emphasis">{{ resultSummary }}</div>
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
                </div>
              </div>
              <v-select
                v-model="departmentFilter"
                :items="departmentFilterOptions"
                label="Connected department"
                variant="outlined"
                density="comfortable"
                hide-details
                class="page-size-select"
              />
              <v-select
                v-model="categoryFilter"
                :items="categoryFilterOptions"
                label="Category type"
                variant="outlined"
                density="comfortable"
                hide-details
                class="page-size-select"
              />
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
        <v-card-text class="pt-4">
          <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">{{ errorMessage }}</v-alert>
          <div v-if="loading" class="py-10 text-center">
            <v-progress-circular indeterminate color="primary" />
          </div>
          <v-row>
            <v-col v-for="item in paginatedBillings" :key="item.id" cols="12" md="6">
              <v-card class="billing-card" :class="{ 'billing-card--selected': selectedBilling?.id === item.id }" elevation="0" @click="selectedBilling = item">
                <v-card-text class="pa-4">
                  <div class="d-flex flex-column flex-xl-row justify-space-between ga-4">
                    <div class="flex-grow-1">
                      <div class="d-flex flex-wrap align-center ga-3 mb-3">
                        <div class="text-subtitle-1 font-weight-bold">{{ item.studentName }}</div>
                        <v-chip size="small" :color="statusColor(item.status)" variant="tonal">{{ item.status }}</v-chip>
                        <v-chip size="small" color="primary" variant="outlined">{{ item.reference }}</v-chip>
                        <v-chip size="small" :color="item.sourceModule === 'Clinic' ? 'warning' : 'secondary'" variant="tonal">{{ item.sourceDepartment }}</v-chip>
                      </div>
                      <div class="billing-meta-grid">
                        <div>
                          <div class="meta-label">Student Number</div>
                          <div class="meta-value">{{ item.studentNumber }}</div>
                        </div>
                        <div>
                          <div class="meta-label">Program</div>
                          <div class="meta-value">{{ item.program }}</div>
                        </div>
                        <div>
                          <div class="meta-label">Balance Due</div>
                          <div class="meta-value">{{ item.amount }}</div>
                        </div>
                        <div>
                          <div class="meta-label">Connected Dept</div>
                          <div class="meta-value">{{ item.sourceDepartment }}</div>
                        </div>
                        <div>
                          <div class="meta-label">Total Paid</div>
                          <div class="meta-value">{{ item.totalPaid }}</div>
                        </div>
                        <div>
                          <div class="meta-label">Booking Category</div>
                          <div class="meta-value">{{ item.sourceCategory }}</div>
                        </div>
                        <div>
                          <div class="meta-label">Due Date</div>
                          <div class="meta-value">{{ item.dueDate }}</div>
                        </div>
                      </div>
                      <div v-if="item.feeSummary" class="fee-summary-strip mt-4">
                        <div class="meta-label">Fees Summary</div>
                        <div class="text-body-2 font-weight-medium">{{ item.feeSummary.label }}</div>
                        <div class="text-body-2 text-medium-emphasis">
                          {{ item.feeSummary.committedAmountFormatted }} allocated | Remaining {{ item.feeSummary.remainingAmountFormatted }}
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
                          <v-chip size="x-small" :color="feeStatusColor(fee.status)" variant="tonal">{{ fee.status }}</v-chip>
                        </div>
                      </div>
                      <div class="billing-note mt-4">{{ item.note }}</div>
                    </div>
                    <div class="billing-actions">
                      <CashierActionButton
                        :icon="mdiCheckDecagramOutline"
                        label="Verify"
                        color="primary"
                        :disabled="!canVerifyBilling(item)"
                        @click="openDialog('approve', item)"
                      />
                      <CashierActionButton :icon="mdiCloseThick" label="Correction" color="error" variant="outlined" @click="openCorrectionDialog(item)" />
                      <CashierActionButton :icon="mdiBellOutline" label="Notify" color="secondary" variant="tonal" @click="openDialog('notify', item)" />
                    </div>
                  </div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col v-if="!loading && filteredBillings.length === 0" cols="12">
              <div class="text-body-2 text-medium-emphasis py-8 text-center">No billing records matched your search.</div>
            </v-col>
          </v-row>
          <div v-if="!loading && filteredBillings.length > 0" class="d-flex flex-column flex-md-row justify-space-between align-md-center ga-3 mt-4">
            <div class="text-body-2 text-medium-emphasis">
              Showing {{ Math.min((currentPage - 1) * itemsPerPage + 1, filteredBillings.length) }}-{{ Math.min(currentPage * itemsPerPage, filteredBillings.length) }}
              of {{ filteredBillings.length }} billing records
            </div>
            <v-pagination v-model="currentPage" :length="totalPages" density="comfortable" total-visible="5" />
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="4" class="focus-column">
        <v-card class="panel-card mb-6" variant="outlined">
        <v-card-item>
          <v-card-title>Billing Focus</v-card-title>
          <v-card-subtitle>Selected account statement and next BPA step</v-card-subtitle>
        </v-card-item>
        <v-card-text v-if="selectedBilling">
          <div class="focus-banner mb-4">
            <div class="text-overline">Selected Billing</div>
            <div class="text-h6 font-weight-bold">{{ selectedBilling.studentName }}</div>
            <div class="text-body-2">{{ selectedBilling.reference }} | {{ selectedBilling.amount }}</div>
          </div>
          <div class="focus-next-step mb-4">
            <div class="meta-label mb-1">Next Step</div>
            <div class="text-body-2">{{ nextStepLabel }}</div>
          </div>
          <v-list density="comfortable" class="py-0">
            <v-list-item title="Source module" :subtitle="selectedBilling.sourceModule" />
            <v-list-item title="Connected department" :subtitle="selectedBilling.sourceDepartment" />
            <v-list-item title="Booking category" :subtitle="selectedBilling.sourceCategory" />
            <v-list-item title="Current status" :subtitle="selectedBilling.status" />
            <v-list-item title="Program" :subtitle="selectedBilling.program" />
            <v-list-item title="Due date" :subtitle="selectedBilling.dueDate" />
            <v-list-item title="Student number" :subtitle="selectedBilling.studentNumber" />
          </v-list>
          <div v-if="selectedBilling.feeItems?.length" class="focus-fee-list mt-4">
            <div class="meta-label mb-2">Fee Breakdown</div>
            <div v-for="fee in selectedBilling.feeItems" :key="fee.id" class="focus-fee-row">
              <div>
                <div class="font-weight-medium">{{ fee.feeType }}</div>
                <div class="text-body-2 text-medium-emphasis">
                  Paid {{ fee.paidAmountFormatted }} | Remaining {{ fee.remainingAmountFormatted }}
                </div>
              </div>
              <v-chip size="x-small" :color="feeStatusColor(fee.status)" variant="tonal">{{ fee.status }}</v-chip>
            </div>
          </div>
        </v-card-text>
      </v-card>

      <v-card class="panel-card" variant="outlined">
        <v-card-item>
          <v-card-title>Activity Alerts</v-card-title>
          <v-card-subtitle>Recent billing updates, correction notices, and payment handoffs</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div v-for="item in activityFeed" :key="item.title" class="alert-card">
            <div class="d-flex align-center justify-space-between ga-3 mb-1">
              <div class="font-weight-bold">{{ item.title }}</div>
              <v-chip size="x-small" color="primary" variant="tonal">{{ item.time }}</v-chip>
            </div>
            <div class="text-body-2 text-medium-emphasis">{{ item.detail }}</div>
          </div>
        </v-card-text>
      </v-card>

      <v-card class="panel-card mt-6" variant="outlined">
        <v-card-item>
          <v-card-title>Inter-Department Integration</v-card-title>
          <v-card-subtitle>Cashier dependencies for end-to-end institutional workflow</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <v-alert v-if="integrationError" type="warning" variant="tonal" class="mb-3">{{ integrationError }}</v-alert>
          <div v-if="integrationLoading" class="py-4 text-center">
            <v-progress-circular indeterminate color="primary" size="22" />
          </div>
          <div v-else class="integration-grid">
            <div class="integration-column">
              <div class="meta-label mb-2">Incoming To Cashier</div>
              <div v-if="incomingDependencies.length === 0" class="text-body-2 text-medium-emphasis">No incoming dependencies configured.</div>
              <div v-for="(edge, index) in incomingDependencies" :key="`in-${index}-${edge.from}-${edge.artifact}`" class="integration-edge">
                <div class="font-weight-bold">{{ edge.from }}</div>
                <div class="text-body-2 text-medium-emphasis">{{ edge.artifact }}</div>
              </div>
            </div>
            <div class="integration-column">
              <div class="meta-label mb-2">Outgoing From Cashier</div>
              <div v-if="outgoingDependencies.length === 0" class="text-body-2 text-medium-emphasis">No outgoing dependencies configured.</div>
              <div v-for="(edge, index) in outgoingDependencies" :key="`out-${index}-${edge.to}-${edge.artifact}`" class="integration-edge">
                <div class="font-weight-bold">{{ edge.to }}</div>
                <div class="text-body-2 text-medium-emphasis">{{ edge.artifact }}</div>
              </div>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12">
      <ModuleActivityLogs module="billing_verification" title="Student Portal & Billing Activity Logs" :per-page="6" />
    </v-col>

    <WorkflowActionDialog
      v-if="dialogMode === 'approve'"
      :model-value="true"
      :loading="actionLoading"
      :confirm-disabled="!selectedBilling || !canVerifyBilling(selectedBilling)"
      title="Verify Billing Record"
      subtitle="Validate the billing details and move the record into Pay Bills once it is ready for cashier settlement."
      chip-label="Verify"
      chip-color="success"
      confirm-label="Verify Billing"
      confirm-color="success"
      :context-fields="billingContextFields"
      :initial-values="verifyInitialValues"
      :fields="[
        {
          key: 'studentProfileCheck',
          label: 'Student Profile Check',
          type: 'select',
          required: true,
          items: ['Complete', 'Needs Review']
        },
        {
          key: 'feeBreakdownCheck',
          label: 'Fee Breakdown Check',
          type: 'select',
          required: true,
          items: ['Validated', 'Needs Clarification']
        },
        {
          key: 'paymentEligibilityCheck',
          label: 'Payment Eligibility',
          type: 'select',
          required: true,
          items: ['Eligible', 'On Hold']
        },
        {
          key: 'duplicateBillingCheck',
          label: 'Duplicate Billing Check',
          type: 'select',
          required: true,
          items: ['No Duplicate Found', 'Possible Duplicate']
        },
        {
          key: 'remarks',
          label: 'Verification Remarks',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Add cashier notes for the verified billing.'
        },
        {
          key: 'validationChecklist',
          label: 'Validation Checklist',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Summarize the checks completed before forwarding the billing.'
        }
      ]"
      @update:model-value="dialogMode = $event ? dialogMode : null"
      @submit="submitVerifyAction"
    >
      <template #preview>
        <div v-if="selectedBilling" class="verify-flow-preview mb-5">
          <div class="verify-flow-preview__header">
            <div>
              <div class="meta-label">Verification Outcome</div>
              <div class="text-body-1 font-weight-bold">
                {{ canVerifyBilling(selectedBilling) ? 'Ready to move into Pay Bills' : 'Cannot be forwarded yet' }}
              </div>
            </div>
            <v-chip :color="canVerifyBilling(selectedBilling) ? 'success' : 'error'" variant="tonal" size="small">
              {{ canVerifyBilling(selectedBilling) ? 'Next: Pay Bills' : 'Needs Billing Review' }}
            </v-chip>
          </div>
          <div class="verify-flow-preview__copy text-body-2 text-medium-emphasis">
            {{
              canVerifyBilling(selectedBilling)
                ? 'Verify the student profile, fee breakdown, payment eligibility, and duplicate-billing check before releasing this record to the cashier payment queue.'
                : getVerifyBlockReason(selectedBilling)
            }}
          </div>
          <div v-if="selectedBilling.feeSummary" class="verify-flow-preview__summary">
            <div class="verify-flow-preview__metric">
              <span class="meta-label">Remaining Balance</span>
              <strong>{{ selectedBilling.feeSummary.remainingAmountFormatted }}</strong>
            </div>
            <div class="verify-flow-preview__metric">
              <span class="meta-label">Fees Summary</span>
              <strong>{{ selectedBilling.feeSummary.label }}</strong>
            </div>
            <div class="verify-flow-preview__metric">
              <span class="meta-label">Forward Path</span>
              <strong>Student Portal & Billing -> Pay Bills</strong>
            </div>
          </div>
        </div>
      </template>
    </WorkflowActionDialog>

    <WorkflowActionDialog
      v-else-if="dialogMode === 'notify'"
      :model-value="true"
      :loading="actionLoading"
      title="Send Billing Notification"
      subtitle="Notify the student or billing office about the current billing state without changing the active workflow stage."
      chip-label="Notify"
      chip-color="secondary"
      confirm-label="Send Notification"
      confirm-color="secondary"
      :context-fields="billingContextFields"
      :fields="[
        {
          key: 'recipient',
          label: 'Recipient',
          type: 'text',
          required: true,
          placeholder: 'Enter the recipient name or email'
        },
        {
          key: 'subject',
          label: 'Subject',
          type: 'text',
          required: true,
          placeholder: 'Billing Status Update'
        },
        {
          key: 'message',
          label: 'Message',
          type: 'textarea',
          required: true,
          rows: 4,
          placeholder: 'Write the billing follow-up message here.'
        }
      ]"
      :initial-values="notifyInitialValues"
      @update:model-value="dialogMode = $event ? dialogMode : null"
      @submit="submitNotifyAction"
    />

    <WorkflowCorrectionDialog
      v-model="correctionDialog"
      :loading="actionLoading"
      :record-label="correctionBilling?.reference || 'billing record'"
      current-module-label="Student Portal & Billing"
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
  background: linear-gradient(125deg, #143273 0%, #2150a6 55%, #4f9ed8 100%);
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

.fee-summary-strip {
  padding: 14px 16px;
  border-radius: 16px;
  background: linear-gradient(180deg, #f7fbff 0%, #f3f7fb 100%);
  border: 1px solid rgba(66, 110, 182, 0.12);
}

.fee-breakdown-list,
.focus-fee-list {
  display: grid;
  gap: 10px;
}

.fee-breakdown-row,
.focus-fee-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(120, 145, 190, 0.12);
}

.hero-side-label,
.metric-label,
.meta-label {
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

.billing-toolbar {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) 180px 180px 150px;
  gap: 12px;
  align-items: start;
  width: min(100%, 940px);
}

.billing-search-stack {
  display: grid;
  gap: 10px;
}

.billing-search {
  min-width: 0;
}

.page-size-select {
  min-width: 160px;
}

.billing-card {
  height: 100%;
  border-radius: 18px;
  background: linear-gradient(180deg, #fff 0%, #fbf7f1 100%);
  border: 1px solid rgba(189, 157, 120, 0.18);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
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
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 0 0 2px rgba(33, 80, 166, 0.08);
}

.billing-meta-grid {
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

.integration-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.integration-column {
  padding: 12px;
  border-radius: 14px;
  background: #f8fbff;
  border: 1px solid rgba(78, 107, 168, 0.14);
}

.integration-edge {
  padding: 10px 12px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid rgba(120, 145, 190, 0.14);
}

.integration-edge + .integration-edge {
  margin-top: 8px;
}

@media (max-width: 959px) {
  .billing-actions {
    min-width: 100%;
  }

  .billing-toolbar {
    width: 100%;
  }

  .focus-column {
    position: static;
    max-height: none;
    overflow: visible;
    padding-right: 0;
  }

  .integration-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .billing-meta-grid {
    grid-template-columns: 1fr;
  }

  .billing-toolbar {
    grid-template-columns: 1fr;
  }
}
</style>



