<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { mdiBankTransfer, mdiMagnify, mdiBellBadgeOutline, mdiBroadcast } from '@mdi/js';
import CashierAnalyticsCard from '@/components/shared/CashierAnalyticsCard.vue';
import CashierActionButton from '@/components/shared/CashierActionButton.vue';
import WorkflowActionDialog from '@/components/shared/WorkflowActionDialog.vue';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';
import {
  fetchReportCenterSnapshot,
  type ReportCenterCandidateItem,
  type PmedReportRequestItem,
  type ReadyCashierReportItem,
  type ReportCenterSnapshot,
  type SentPmedReportItem
} from '@/services/reportCenter';
import { reportReconciliationRecord } from '@/services/workflowCrudActions';
import { formatDateTimeWithTimezone, formatRelativeDateTime } from '@/utils/dateTime';
import { reconcileWorkflowRecord } from '@/services/workflowActions';

const realtime = useRealtimeListSync();

const stats = ref<ReportCenterSnapshot['stats']>([]);
const requests = ref<PmedReportRequestItem[]>([]);
const candidateItems = ref<ReportCenterCandidateItem[]>([]);
const readyItems = ref<ReadyCashierReportItem[]>([]);
const sentItems = ref<SentPmedReportItem[]>([]);
const alerts = ref<ReportCenterSnapshot['activityFeed']>([]);
const search = ref('');
const categoryFilter = ref('All Categories');
const selectedRequest = ref<PmedReportRequestItem | null>(null);
const selectedCandidateItem = ref<ReportCenterCandidateItem | null>(null);
const selectedReadyItem = ref<ReadyCashierReportItem | null>(null);
const selectedSentItem = ref<SentPmedReportItem | null>(null);
const loading = ref(false);
const actionLoading = ref(false);
const errorMessage = ref('');
const snackbar = ref(false);
const snackbarMessage = ref('');
const sendDialog = ref(false);
const timeTick = ref(Date.now());
let timeTimer: ReturnType<typeof setInterval> | null = null;

const categoryOptions = computed(() => [
  'All Categories',
  ...new Set([
    ...requests.value.map((item) => item.reportType).filter(Boolean),
    ...candidateItems.value.map((item) => item.sourceCategory).filter(Boolean),
    ...readyItems.value.map((item) => item.sourceCategory).filter(Boolean)
  ])
]);

const liveStatusLabel = computed(() => (realtime.connectionState.value === 'live' ? 'Live' : realtime.connectionState.value === 'connecting' ? 'Connecting' : 'Syncing'));

const requestSummaryText = computed(() => {
  const count = filteredRequests.value.length;
  if (!count) return 'No PMED requests are waiting right now.';
  return `${count} PMED request${count === 1 ? '' : 's'} currently visible in the live queue.`;
});

const filteredRequests = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return requests.value.filter((item) => {
    if (categoryFilter.value !== 'All Categories' && item.reportType !== categoryFilter.value && item.targetDepartment !== categoryFilter.value) return false;
    if (!needle) return true;
    return `${item.requestReference} ${item.reportName} ${item.reportType} ${item.requestedBy} ${item.detail}`.toLowerCase().includes(needle);
  });
});

const filteredReadyItems = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return readyItems.value.filter((item) => {
    if (categoryFilter.value !== 'All Categories' && item.sourceCategory !== categoryFilter.value) return false;
    if (!needle) return true;
    return `${item.reference} ${item.studentName} ${item.billingCode} ${item.sourceDepartment} ${item.sourceCategory} ${item.receiptNumber}`.toLowerCase().includes(needle);
  });
});

const filteredCandidateItems = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return candidateItems.value.filter((item) => {
    if (categoryFilter.value !== 'All Categories' && item.sourceCategory !== categoryFilter.value) return false;
    if (!needle) return true;
    return `${item.reference} ${item.studentName} ${item.billingCode} ${item.sourceDepartment} ${item.sourceCategory} ${item.status}`.toLowerCase().includes(needle);
  });
});

const filteredSentItems = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return sentItems.value.filter((item) => {
    if (!needle) return true;
    return `${item.reportReference} ${item.requestReference} ${item.paymentReference} ${item.studentName} ${item.billingCode} ${item.reportName}`.toLowerCase().includes(needle);
  });
});

const sendContextFields = computed(() => {
  if (!selectedReadyItem.value) return [];
  return [
    { label: 'Payment Reference', value: selectedReadyItem.value.reference },
    { label: 'Student', value: selectedReadyItem.value.studentName },
    { label: 'Billing Code', value: selectedReadyItem.value.billingCode },
    { label: 'Amount', value: selectedReadyItem.value.amount },
    { label: 'Category Type', value: selectedReadyItem.value.sourceCategory },
    { label: 'PMED Request', value: selectedRequest.value?.requestReference || 'No specific PMED request selected' }
  ];
});

const selectedCandidateNeedsReconcile = computed(() => {
  if (!selectedCandidateItem.value) return false;
  return selectedCandidateItem.value.status === 'Logged' || selectedCandidateItem.value.status === 'With Discrepancy';
});

const selectedRequestCanSend = computed(() => Boolean(selectedReadyItem.value));

const sendInitialValues = computed(() => ({
  remarks: selectedRequest.value
    ? `Sent to PMED in response to ${selectedRequest.value.requestReference}.`
    : 'Sent to PMED as part of the cashier financial reporting flow.'
}));

function formatAbsoluteTime(value: string | null | undefined): string {
  void timeTick.value;
  return formatDateTimeWithTimezone(value, { fallback: '--' });
}

function formatLiveRelativeTime(value: string | null | undefined): string {
  void timeTick.value;
  return formatRelativeDateTime(value, '--');
}

function formatRequestStatus(value: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'requested') return 'Requested';
  if (normalized === 'received') return 'Received';
  if (normalized === 'matched') return 'Matched';
  return normalized ? normalized.replace(/\b\w/g, (char) => char.toUpperCase()) : 'Pending';
}

async function loadSnapshot(forceRefresh = false, options: { silent?: boolean } = {}) {
  if (!options.silent) loading.value = true;
  errorMessage.value = '';
  try {
    const snapshot = await fetchReportCenterSnapshot(forceRefresh);
    stats.value = snapshot.stats;
    requests.value = snapshot.requests;
    candidateItems.value = snapshot.candidateItems || [];
    readyItems.value = snapshot.readyItems;
    sentItems.value = snapshot.sentItems;
    alerts.value = snapshot.activityFeed;
    selectedRequest.value = snapshot.requests.find((item) => item.id === selectedRequest.value?.id) || snapshot.requests[0] || null;
    selectedCandidateItem.value = (snapshot.candidateItems || []).find((item) => item.id === selectedCandidateItem.value?.id) || snapshot.candidateItems?.[0] || null;
    selectedReadyItem.value = snapshot.readyItems.find((item) => item.id === selectedReadyItem.value?.id) || snapshot.readyItems[0] || null;
    selectedSentItem.value = snapshot.sentItems.find((item) => item.id === selectedSentItem.value?.id) || snapshot.sentItems[0] || null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load the report center.';
    errorMessage.value = message.toLowerCase().includes('authentication required')
      ? 'Your session check is still syncing. Please refresh once after the cashier server finishes loading.'
      : message;
  } finally {
    if (!options.silent) loading.value = false;
  }
}

function openSendDialog(item: ReadyCashierReportItem) {
  selectedReadyItem.value = item;
  sendDialog.value = true;
}

function openSendDialogFromFocus() {
  if (!selectedReadyItem.value) {
    snackbarMessage.value = 'No reconciled cashier record is ready yet. Reconcile a reporting record first, then send it to the selected PMED request.';
    snackbar.value = true;
    return;
  }
  sendDialog.value = true;
}

async function reconcileSelectedCandidate() {
  if (!selectedCandidateItem.value) return;
  actionLoading.value = true;
  try {
    const response = await reconcileWorkflowRecord({
      recordId: selectedCandidateItem.value.id,
      currentModule: 'reporting_reconciliation',
      remarks: selectedRequest.value
        ? `Reconciled for PMED request ${selectedRequest.value.requestReference}.`
        : 'Reconciled from the report center for PMED handoff.'
    });
    snackbarMessage.value = response.message || 'Cashier record reconciled and ready for PMED handoff.';
    snackbar.value = true;
    await loadSnapshot(true);
    selectedReadyItem.value = readyItems.value.find((item) => item.id === selectedCandidateItem.value?.id) || readyItems.value[0] || null;
  } catch (error) {
    snackbarMessage.value = error instanceof Error ? error.message : 'Unable to reconcile the selected cashier record.';
    snackbar.value = true;
  } finally {
    actionLoading.value = false;
  }
}

async function submitSendToPmed(formValues: Record<string, string | number>) {
  if (!selectedReadyItem.value) return;
  actionLoading.value = true;
  try {
    const response = await reportReconciliationRecord({
      paymentId: selectedReadyItem.value.id,
      remarks: String(formValues.remarks || 'Sent to PMED as part of the cashier financial reporting flow.'),
      requestReference: selectedRequest.value?.requestReference || ''
    });
    snackbarMessage.value = response.message || 'Report sent to PMED.';
    snackbar.value = true;
    sendDialog.value = false;
    await loadSnapshot(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to send report to PMED.';
    snackbarMessage.value = message.toLowerCase().includes('authentication required')
      ? 'Your session check is still syncing. Please refresh once and try again.'
      : message;
    snackbar.value = true;
  } finally {
    actionLoading.value = false;
  }
}

watch(requests, (items) => {
  selectedRequest.value = items.find((item) => item.id === selectedRequest.value?.id) || items[0] || null;
});

watch(readyItems, (items) => {
  selectedReadyItem.value = items.find((item) => item.id === selectedReadyItem.value?.id) || items[0] || null;
});

watch(candidateItems, (items) => {
  selectedCandidateItem.value = items.find((item) => item.id === selectedCandidateItem.value?.id) || items[0] || null;
});

watch(sentItems, (items) => {
  selectedSentItem.value = items.find((item) => item.id === selectedSentItem.value?.id) || items[0] || null;
});

onMounted(() => {
  void loadSnapshot(true);
  timeTimer = setInterval(() => {
    timeTick.value = Date.now();
  }, 60 * 1000);
  realtime.startPolling(() => {
    void loadSnapshot(true, { silent: true });
  }, 0, { pauseWhenDialogOpen: false });
});

onUnmounted(() => {
  if (timeTimer) clearInterval(timeTimer);
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
              <div class="hero-kicker">Report Center</div>
              <h1 class="text-h4 font-weight-black mb-2">PMED Report Center</h1>
              <p class="hero-subtitle mb-0">
                Receive PMED report requests, match them with reconciled cashier records, and send structured financial report packages back to PMED.
              </p>
            </div>
            <div class="hero-side-panel">
              <div class="hero-side-label">Reporting Flow</div>
              <div class="text-h6 font-weight-bold">PMED Request -> Cashier Reconcile -> Send to PMED</div>
              <div class="text-body-2">{{ readyItems.length }} reconciled cashier record{{ readyItems.length === 1 ? '' : 's' }} ready for PMED handoff</div>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col v-for="card in stats" :key="card.title" cols="12" sm="6" lg="3">
      <CashierAnalyticsCard :title="card.title" :value="card.value" :subtitle="card.subtitle" :icon="card.icon" :tone="card.tone" />
    </v-col>

    <v-col cols="12" lg="8">
      <v-card class="panel-card mb-6" variant="outlined">
        <v-card-item>
          <v-card-title class="d-flex align-center ga-2">
            PMED Requests
            <v-chip size="small" color="success" variant="tonal">{{ liveStatusLabel }}</v-chip>
          </v-card-title>
          <v-card-subtitle>Inbound report requests sent by PMED to the cashier reporting desk.</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">{{ errorMessage }}</v-alert>
          <div class="toolbar-row mb-4">
            <v-text-field v-model="search" :prepend-inner-icon="mdiMagnify" label="Search requests, ready reports, or sent deliveries" density="compact" variant="outlined" hide-details class="completed-search" />
            <v-select v-model="categoryFilter" :items="categoryOptions" label="Category type" density="compact" variant="outlined" hide-details class="toolbar-select" />
          </div>
          <div class="queue-meta mb-4">
            <div class="queue-meta__item">
              <v-icon :icon="mdiBellBadgeOutline" size="16" />
              <span>{{ requestSummaryText }}</span>
            </div>
            <div class="queue-meta__item">
              <v-icon :icon="mdiBroadcast" size="16" />
              <span>Live request sync is listening for PMED updates.</span>
            </div>
          </div>
          <div v-if="loading" class="py-10 text-center">
            <v-progress-circular indeterminate color="primary" />
          </div>
          <div v-else class="stack-grid">
            <div v-for="item in filteredRequests" :key="item.id" class="report-card" :class="{ 'report-card--active': selectedRequest?.id === item.id }" @click="selectedRequest = item">
              <div class="d-flex align-center justify-space-between ga-3">
                <div>
                  <div class="font-weight-bold">{{ item.reportName }}</div>
                  <div class="text-body-2 text-medium-emphasis">{{ item.requestReference }} | {{ item.reportType }}</div>
                </div>
                <v-chip size="small" color="warning" variant="tonal">{{ formatRequestStatus(item.status) }}</v-chip>
              </div>
              <div class="text-body-2 mt-3">{{ item.detail }}</div>
              <div class="request-meta mt-3">
                <div class="request-meta__line">{{ item.targetDepartment }} Desk</div>
                <div class="request-meta__line">{{ item.requestedAtLabel || formatAbsoluteTime(item.requestedAt) }}</div>
                <div class="request-meta__line">{{ item.requestedBy }} | {{ item.requestedAtRelative || formatLiveRelativeTime(item.requestedAt) }}</div>
              </div>
            </div>
            <div v-if="!filteredRequests.length" class="text-body-2 text-medium-emphasis py-4">No PMED requests are waiting right now.</div>
          </div>
        </v-card-text>
      </v-card>

      <v-card class="panel-card mb-6" variant="outlined">
        <v-card-item>
          <v-card-title>Available Cashier Records</v-card-title>
          <v-card-subtitle>Active reporting records that can be reconciled for the selected PMED request.</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div class="stack-grid">
            <div
              v-for="item in filteredCandidateItems"
              :key="item.id"
              class="report-card"
              :class="{ 'report-card--active': selectedCandidateItem?.id === item.id }"
              @click="selectedCandidateItem = item"
            >
              <div class="d-flex align-center justify-space-between ga-3">
                <div>
                  <div class="font-weight-bold">{{ item.reference }}</div>
                  <div class="text-body-2 text-medium-emphasis">{{ item.studentName }} | {{ item.billingCode }}</div>
                </div>
                <v-chip size="small" :color="item.status === 'Reconciled' ? 'success' : item.status === 'With Discrepancy' ? 'error' : 'warning'" variant="tonal">
                  {{ item.status }}
                </v-chip>
              </div>
              <div class="text-body-2 mt-3">{{ item.amount }} | {{ item.sourceCategory }} | Receipt {{ item.receiptNumber }}</div>
              <div class="text-body-2 text-medium-emphasis mt-2">{{ item.sourceDepartment }} | {{ formatAbsoluteTime(item.postedAt) }}</div>
              <div class="mt-4 d-flex flex-wrap ga-2">
                <CashierActionButton
                  v-if="item.status === 'Logged' || item.status === 'With Discrepancy'"
                  :icon="mdiBroadcast"
                  label="Mark Ready for PMED"
                  color="primary"
                  variant="flat"
                  compact
                  @click.stop="selectedCandidateItem = item; reconcileSelectedCandidate()"
                />
                <v-chip v-else size="small" color="success" variant="tonal">Ready to send</v-chip>
              </div>
            </div>
            <div v-if="!filteredCandidateItems.length" class="text-body-2 text-medium-emphasis py-4">No active cashier reporting records are available yet.</div>
          </div>
        </v-card-text>
      </v-card>

      <v-card class="panel-card mb-6" variant="outlined">
        <v-card-item>
          <v-card-title>Ready to Send</v-card-title>
          <v-card-subtitle>Reconciled cashier records that can be delivered to PMED.</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div class="stack-grid">
            <div v-for="item in filteredReadyItems" :key="item.id" class="report-card" :class="{ 'report-card--active': selectedReadyItem?.id === item.id }" @click="selectedReadyItem = item">
              <div class="d-flex align-center justify-space-between ga-3">
                <div>
                  <div class="font-weight-bold">{{ item.reference }}</div>
                  <div class="text-body-2 text-medium-emphasis">{{ item.studentName }} | {{ item.billingCode }}</div>
                </div>
                <v-chip size="small" color="info" variant="tonal">{{ item.sourceCategory }}</v-chip>
              </div>
              <div class="text-body-2 mt-3">{{ item.amount }} | {{ item.paymentMethod }} | Receipt {{ item.receiptNumber }}</div>
              <div class="text-body-2 text-medium-emphasis mt-2">{{ item.sourceDepartment }} | {{ formatAbsoluteTime(item.postedAt) }}</div>
              <div class="mt-4">
                <CashierActionButton :icon="mdiBankTransfer" label="Send to PMED" color="secondary" variant="flat" compact @click.stop="openSendDialog(item)" />
              </div>
            </div>
            <div v-if="!filteredReadyItems.length" class="text-body-2 text-medium-emphasis py-4">No reconciled cashier reports are ready to send yet.</div>
          </div>
        </v-card-text>
      </v-card>

      <v-card class="panel-card" variant="outlined">
        <v-card-item>
          <v-card-title>Sent Report Log</v-card-title>
          <v-card-subtitle>Traceable deliveries already sent from Cashier to PMED.</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div class="stack-grid">
            <div v-for="item in filteredSentItems" :key="item.id" class="report-card" :class="{ 'report-card--active': selectedSentItem?.id === item.id }" @click="selectedSentItem = item">
              <div class="d-flex align-center justify-space-between ga-3">
                <div>
                  <div class="font-weight-bold">{{ item.reportReference }}</div>
                  <div class="text-body-2 text-medium-emphasis">{{ item.reportName }}</div>
                </div>
                <v-chip size="small" color="success" variant="tonal">{{ item.status }}</v-chip>
              </div>
              <div class="text-body-2 mt-3">{{ item.studentName }} | {{ item.amount }} | {{ item.paymentReference }}</div>
              <div class="text-body-2 text-medium-emphasis mt-2">{{ item.sentAtLabel || formatAbsoluteTime(item.sentAt) }} | {{ item.sentAtRelative || formatLiveRelativeTime(item.sentAt) }} <span v-if="item.requestReference">| Request {{ item.requestReference }}</span></div>
            </div>
            <div v-if="!filteredSentItems.length" class="text-body-2 text-medium-emphasis py-4">No cashier report packages have been sent to PMED yet.</div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="4">
      <v-card class="panel-card mb-6" variant="outlined">
        <v-card-item>
          <v-card-title>Reporting Focus</v-card-title>
          <v-card-subtitle>Current PMED request and cashier handoff point.</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div class="focus-banner mb-4">
            <div class="text-overline">Selected Request</div>
            <div class="text-h6 font-weight-bold">{{ selectedRequest?.reportName || 'No PMED request selected' }}</div>
            <div class="text-body-2">{{ selectedRequest?.requestReference || 'Waiting for inbound PMED request' }}</div>
          </div>
          <v-list density="comfortable" class="py-0">
            <v-list-item title="Requested by" :subtitle="selectedRequest?.requestedBy || 'PMED'" />
            <v-list-item title="Plan reference" :subtitle="selectedRequest?.planReference || '--'" />
            <v-list-item title="Requested at" :subtitle="selectedRequest ? `${selectedRequest.requestedAtLabel || formatAbsoluteTime(selectedRequest.requestedAt)} | ${selectedRequest.requestedAtRelative || formatLiveRelativeTime(selectedRequest.requestedAt)}` : '--'" />
            <v-list-item title="Selected reporting record" :subtitle="selectedCandidateItem?.reference || 'No cashier reporting record selected'" />
            <v-list-item title="Reporting status" :subtitle="selectedCandidateItem?.status || '--'" />
            <v-list-item title="Ready cashier record" :subtitle="selectedReadyItem?.reference || 'No reconciled record selected'" />
            <v-list-item title="Selected student" :subtitle="selectedReadyItem?.studentName || '--'" />
            <v-list-item title="Category type" :subtitle="selectedReadyItem?.sourceCategory || '--'" />
          </v-list>
          <div class="mt-4 d-flex flex-wrap ga-2">
            <CashierActionButton
              v-if="selectedCandidateNeedsReconcile"
              :icon="mdiBroadcast"
              label="Reconcile Selected Record"
              color="primary"
              variant="outlined"
              compact
              :disabled="actionLoading || !selectedCandidateItem"
              @click="reconcileSelectedCandidate"
            />
            <CashierActionButton
              :icon="mdiBankTransfer"
              label="Send Selected Report"
              color="secondary"
              variant="flat"
              compact
              :disabled="!selectedRequestCanSend || actionLoading"
              @click="openSendDialogFromFocus"
            />
          </div>
        </v-card-text>
      </v-card>

      <v-card class="panel-card" variant="outlined">
        <v-card-item>
          <v-card-title>Report Alerts</v-card-title>
          <v-card-subtitle>Live PMED request and delivery activity.</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div v-for="item in alerts" :key="item.title + item.time" class="alert-card">
            <div class="d-flex align-center justify-space-between ga-3 mb-1">
              <div class="font-weight-bold">{{ item.title }}</div>
              <v-chip size="x-small" color="primary" variant="tonal">{{ item.time }}</v-chip>
            </div>
            <div class="text-body-2 text-medium-emphasis">{{ item.detail }}</div>
          </div>
          <div v-if="!alerts.length" class="text-body-2 text-medium-emphasis">No report-center alerts yet.</div>
        </v-card-text>
      </v-card>
    </v-col>

    <WorkflowActionDialog
      :model-value="sendDialog"
      :loading="actionLoading"
      title="Send Cashier Report to PMED"
      subtitle="Deliver this reconciled cashier record to PMED as a structured financial report package."
      chip-label="Send to PMED"
      chip-color="secondary"
      confirm-label="Send to PMED"
      confirm-color="secondary"
      :context-fields="sendContextFields"
      :fields="[
        {
          key: 'remarks',
          label: 'PMED Handoff Remarks',
          type: 'textarea',
          required: true,
          rows: 3,
          placeholder: 'Add notes for the PMED reporting desk.'
        }
      ]"
      :initial-values="sendInitialValues"
      @update:model-value="sendDialog = $event"
      @submit="submitSendToPmed"
    />

    <v-snackbar v-model="snackbar" color="primary">{{ snackbarMessage }}</v-snackbar>
  </v-row>
</template>

<style scoped>
.hero-banner {
  border-radius: 24px;
  background: linear-gradient(135deg, #1f4aa8 0%, #5d9ae4 100%);
  color: #fff;
}

.hero-kicker {
  display: inline-flex;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.hero-subtitle {
  max-width: 720px;
  color: rgba(255, 255, 255, 0.9);
}

.hero-side-panel {
  min-width: 320px;
  padding: 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.hero-side-label {
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.72);
}

.panel-card {
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.96);
}

.toolbar-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.completed-search {
  flex: 1 1 320px;
}

.toolbar-select {
  width: 220px;
}

.queue-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  color: rgba(65, 79, 116, 0.78);
  font-size: 0.88rem;
}

.queue-meta__item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.stack-grid {
  display: grid;
  gap: 14px;
}

.report-card {
  padding: 16px;
  border-radius: 16px;
  border: 1px solid rgba(78, 107, 168, 0.16);
  background: linear-gradient(180deg, #fff 0%, #f8fbff 100%);
  cursor: pointer;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.report-card:hover,
.report-card--active {
  border-color: rgba(61, 125, 210, 0.44);
  box-shadow: 0 16px 32px rgba(22, 48, 100, 0.1);
  transform: translateY(-1px);
}

.request-meta {
  display: grid;
  gap: 4px;
  color: rgba(65, 79, 116, 0.76);
  font-size: 0.84rem;
}

.request-meta__line {
  line-height: 1.35;
}

.focus-banner {
  padding: 16px;
  border-radius: 18px;
  color: #fff;
  background: linear-gradient(135deg, #3d6cc0 0%, #264ea1 100%);
}

.alert-card {
  padding: 14px;
  border-radius: 14px;
  border: 1px solid rgba(78, 107, 168, 0.12);
  background: #f8fbff;
}

@media (max-width: 959px) {
  .hero-side-panel {
    min-width: 0;
  }
}
</style>





