<script setup lang="ts">
import { ref } from 'vue';
import { mdiCheckDecagramOutline, mdiExportVariant, mdiFlagOutline } from '@mdi/js';
import CashierAnalyticsCard from '@/components/shared/CashierAnalyticsCard.vue';
import CashierActionButton from '@/components/shared/CashierActionButton.vue';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';

type TransactionStatus = 'Completed' | 'Flagged' | 'Pending';

type TransactionItem = {
  id: number;
  reference: string;
  studentName: string;
  amount: string;
  channel: string;
  postedAt: string;
  status: TransactionStatus;
};

const stats = [
  { title: 'Transactions Today', value: '43', subtitle: 'Posted cashier payment entries', icon: 'mdi-swap-horizontal-bold', tone: 'green' as const },
  { title: 'Flagged Entries', value: '03', subtitle: 'Transactions requiring audit review', icon: 'mdi-alert-decagram-outline', tone: 'blue' as const },
  { title: 'Successful Posts', value: '40', subtitle: 'Static count of completed entries', icon: 'mdi-check-all', tone: 'orange' as const },
  { title: 'Gross Collection', value: 'PHP 182,640', subtitle: 'Static financial snapshot', icon: 'mdi-chart-line', tone: 'purple' as const }
];

const transactions = ref<TransactionItem[]>([
  { id: 1, reference: 'TXN-2026-0101', studentName: 'Angela Dela Cruz', amount: 'PHP 7,450.00', channel: 'GCash', postedAt: 'Mar 13, 2026 9:20 AM', status: 'Completed' },
  { id: 2, reference: 'TXN-2026-0102', studentName: 'Michael Santos', amount: 'PHP 8,960.00', channel: 'Bank Transfer', postedAt: 'Mar 13, 2026 9:44 AM', status: 'Flagged' },
  { id: 3, reference: 'TXN-2026-0103', studentName: 'Trisha Mendoza', amount: 'PHP 15,300.00', channel: 'Maya', postedAt: 'Mar 13, 2026 10:05 AM', status: 'Pending' },
  { id: 4, reference: 'TXN-2026-0104', studentName: 'Carlo Reyes', amount: 'PHP 4,520.00', channel: 'Over-the-counter', postedAt: 'Mar 13, 2026 10:21 AM', status: 'Completed' }
]);

const dialogMode = ref<'flag' | 'reconcile' | 'export' | null>(null);
const selectedTransaction = ref<TransactionItem | null>(transactions.value[0] ?? null);
const snackbar = ref(false);
const snackbarMessage = ref('');

const highlights = [
  { title: 'Audit checkpoint', detail: 'One transfer reference still needs accounting confirmation.', time: '14 mins ago' },
  { title: 'Batch settlement', detail: 'Morning digital payments were grouped into the finance ledger.', time: '31 mins ago' },
  { title: 'Export bundle prepared', detail: 'A daily transaction file is ready for reports review.', time: '1 hr ago' }
];

function statusColor(status: TransactionStatus) {
  if (status === 'Completed') return 'success';
  if (status === 'Flagged') return 'error';
  return 'warning';
}

function openDialog(mode: 'flag' | 'reconcile' | 'export', item: TransactionItem) {
  selectedTransaction.value = item;
  dialogMode.value = mode;
}

function dialogTitle() {
  if (dialogMode.value === 'flag') return 'Flag Transaction';
  if (dialogMode.value === 'reconcile') return 'Reconcile Transaction';
  if (dialogMode.value === 'export') return 'Export Transaction Record';
  return '';
}

function dialogMessage() {
  if (!selectedTransaction.value) return '';
  if (dialogMode.value === 'flag') return `Mark ${selectedTransaction.value.reference} for finance follow-up?`;
  if (dialogMode.value === 'reconcile') return `Reconcile ${selectedTransaction.value.reference} as cleared in the transaction log?`;
  if (dialogMode.value === 'export') return `Prepare a static export copy for ${selectedTransaction.value.reference}?`;
  return '';
}

function applyDialogAction() {
  if (!selectedTransaction.value || !dialogMode.value) return;

  if (dialogMode.value === 'flag') {
    selectedTransaction.value.status = 'Flagged';
    snackbarMessage.value = `${selectedTransaction.value.reference} was flagged for review.`;
  } else if (dialogMode.value === 'reconcile') {
    selectedTransaction.value.status = 'Completed';
    snackbarMessage.value = `${selectedTransaction.value.reference} was reconciled successfully.`;
  } else {
    snackbarMessage.value = `Export bundle prepared for ${selectedTransaction.value.reference}.`;
  }

  dialogMode.value = null;
  snackbar.value = true;
}
</script>

<template>
  <v-row>
    <v-col cols="12">
      <v-card class="hero-banner" elevation="0">
        <v-card-text class="pa-6">
          <div class="d-flex flex-column flex-lg-row justify-space-between ga-4">
            <div>
              <div class="hero-kicker">Finance Endpoint</div>
              <h1 class="text-h4 font-weight-black mb-2">Financial Transactions</h1>
              <p class="hero-subtitle mb-0">
                Static SaaS-style monitoring board for cashier payment logs, transaction history, and finance review actions.
              </p>
            </div>
            <div class="hero-side-panel">
              <div class="hero-side-label">Transaction Flow</div>
              <div class="text-h6 font-weight-bold">Monitor -> Reconcile -> Export</div>
              <div class="text-body-2">Designed to look like an audit-ready payments operations screen.</div>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col v-for="stat in stats" :key="stat.title" cols="12" sm="6" xl="3">
      <CashierAnalyticsCard :title="stat.title" :value="stat.value" :subtitle="stat.subtitle" :icon="stat.icon" :tone="stat.tone" />
    </v-col>

    <v-col cols="12" lg="8">
      <v-card class="panel-card" variant="outlined">
        <v-card-item>
          <v-card-title>Transaction Ledger</v-card-title>
          <v-card-subtitle>Static finance table for cashier postings and audit notes.</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div class="table-wrap">
            <table class="transaction-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Student</th>
                  <th>Amount</th>
                  <th>Channel</th>
                  <th>Posted At</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in transactions" :key="item.id">
                  <td>{{ item.reference }}</td>
                  <td>{{ item.studentName }}</td>
                  <td>{{ item.amount }}</td>
                  <td>{{ item.channel }}</td>
                  <td>{{ item.postedAt }}</td>
                  <td>
                    <v-chip size="small" :color="statusColor(item.status)" variant="tonal">{{ item.status }}</v-chip>
                  </td>
                  <td class="action-cell">
                    <CashierActionButton :icon="mdiFlagOutline" label="Flag" color="error" variant="text" compact @click="openDialog('flag', item)" />
                    <CashierActionButton :icon="mdiCheckDecagramOutline" label="Reconcile" color="primary" variant="text" compact @click="openDialog('reconcile', item)" />
                    <CashierActionButton :icon="mdiExportVariant" label="Export" color="secondary" variant="text" compact @click="openDialog('export', item)" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="4">
      <v-card class="panel-card mb-6" variant="outlined">
        <v-card-item>
          <v-card-title>Transaction Focus</v-card-title>
          <v-card-subtitle>Static detail preview</v-card-subtitle>
        </v-card-item>
        <v-card-text v-if="selectedTransaction">
          <div class="focus-banner mb-4">
            <div class="text-overline">Selected Log</div>
            <div class="text-h6 font-weight-bold">{{ selectedTransaction.reference }}</div>
            <div class="text-body-2">{{ selectedTransaction.studentName }} | {{ selectedTransaction.amount }}</div>
          </div>
          <v-list density="comfortable" class="py-0">
            <v-list-item title="Status" :subtitle="selectedTransaction.status" />
            <v-list-item title="Channel" :subtitle="selectedTransaction.channel" />
            <v-list-item title="Posted at" :subtitle="selectedTransaction.postedAt" />
          </v-list>
        </v-card-text>
      </v-card>

      <v-card class="panel-card" variant="outlined">
        <v-card-item>
          <v-card-title>Finance Alerts</v-card-title>
          <v-card-subtitle>Static system notifications</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div v-for="item in highlights" :key="item.title" class="alert-card">
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
      <ModuleActivityLogs module="financial_transactions" title="Financial Transaction Activity Logs" :per-page="6" />
    </v-col>

    <v-dialog :model-value="Boolean(dialogMode)" max-width="480" @update:model-value="dialogMode = $event ? dialogMode : null">
      <v-card class="confirm-dialog">
        <v-card-title class="text-h6 font-weight-bold">{{ dialogTitle() }}</v-card-title>
        <v-card-text>{{ dialogMessage() }}</v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn variant="text" prepend-icon="mdi-close-circle-outline" @click="dialogMode = null">Cancel</v-btn>
          <v-btn color="primary" prepend-icon="mdi-check-circle-outline" @click="applyDialogAction">Proceed</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

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

.table-wrap {
  overflow-x: auto;
}

.transaction-table {
  width: 100%;
  border-collapse: collapse;
}

.transaction-table th,
.transaction-table td {
  padding: 14px 12px;
  text-align: left;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  white-space: nowrap;
}

.transaction-table th {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #73809b;
}

.action-cell {
  display: flex;
  gap: 4px;
}

.focus-banner {
  padding: 18px;
  border-radius: 16px;
  color: #fff;
  background: linear-gradient(135deg, #1d4b96 0%, #3579c9 100%);
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
}
</style>
