<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  mdiArchiveOutline,
  mdiArrowRightThick,
  mdiArrowULeftTopBold,
  mdiCashClock,
  mdiCashMultiple,
  mdiChartBoxOutline,
  mdiChartLine,
  mdiCheckAll,
  mdiCheckDecagramOutline,
  mdiClipboardListOutline,
  mdiCreditCardSyncOutline,
  mdiFileCertificateOutline,
  mdiFileDocumentMultipleOutline
} from '@mdi/js';
import CashierAnalyticsCard from '@/components/shared/CashierAnalyticsCard.vue';
import {
  fetchBpaDashboardSnapshot,
  fetchDashboardHrRequestsSnapshot,
  fetchDashboardAlerts,
  fetchDashboardCharts,
  fetchDashboardRecentActivities,
  createDashboardHrRequest,
  type BpaDashboardSnapshot,
  type DashboardActivityItem,
  type DashboardAlertItem,
  type DashboardChartsSnapshot,
  type DashboardHrEmployee,
  type DashboardHrRequestItem
} from '@/services/bpaDashboard';
import {
  fetchCashierDepartmentHandoffs,
  type CashierDepartmentHandoffItem,
  type CashierDepartmentHandoffSnapshot
} from '@/services/cashierDepartmentHandoffs';

const router = useRouter();
const summaryCards = ref<BpaDashboardSnapshot['summaryCards']>([]);
const moduleCards = ref<BpaDashboardSnapshot['moduleCards']>([]);
const recentTransactions = ref<BpaDashboardSnapshot['recentTransactions']>([]);
const recentActivities = ref<DashboardActivityItem[]>([]);
const dashboardAlerts = ref<DashboardAlertItem[]>([]);
const chartData = ref<DashboardChartsSnapshot>({
  dailyCollection: [],
  paymentStatusBreakdown: []
});
const departmentStats = ref<CashierDepartmentHandoffSnapshot['stats']>([]);
const departmentMatrix = ref<CashierDepartmentHandoffSnapshot['matrix']>([]);
const departmentLatestItems = ref<CashierDepartmentHandoffItem[]>([]);
const hrEmployees = ref<DashboardHrEmployee[]>([]);
const hrRequests = ref<DashboardHrRequestItem[]>([]);
const selectedHrEmployeeId = ref<number | null>(null);
const hrRequestType = ref('Certification Request');
const hrRequestDetails = ref('');
const hrRequestSubmitting = ref(false);
const hrRequestSnackbar = ref(false);
const hrRequestSnackbarMessage = ref('');

const dashboardIconMap: Record<string, string> = {
  'mdi-arrow-right-thick': mdiArrowRightThick,
  'mdi-arrow-u-left-top-bold': mdiArrowULeftTopBold,
  'mdi-clipboard-list-outline': mdiClipboardListOutline,
  'mdi-check-decagram-outline': mdiCheckDecagramOutline,
  'mdi-chart-box-outline': mdiChartBoxOutline,
  'mdi-archive-outline': mdiArchiveOutline,
  'mdi-file-document-multiple-outline': mdiFileDocumentMultipleOutline,
  'mdi-cash-clock': mdiCashClock,
  'mdi-credit-card-sync-outline': mdiCreditCardSyncOutline,
  'mdi-check-all': mdiCheckAll,
  'mdi-account-credit-card-outline': mdiCashMultiple,
  'mdi-cash-multiple': mdiCashMultiple,
  'mdi-file-certificate-outline': mdiFileCertificateOutline,
  'mdi-chart-line': mdiChartLine
};

const flowLegend = [
  {
    title: 'Forward Payment Flow',
    detail: 'Student Portal & Billing -> Pay Bills -> Payment Processing & Gateway -> Compliance & Documentation -> Completed Transactions',
    icon: 'mdi-arrow-right-thick',
    tone: 'success'
  },
  {
    title: 'Correction Backflow',
    detail: 'Major correction actions send the record back to the previous stage instead of leaving it in the same active queue.',
    icon: 'mdi-arrow-u-left-top-bold',
    tone: 'warning'
  }
];

const stageNotes = [
  'Student Portal & Billing: account statement, billing creation, invoice generation, verify billing',
  'Pay Bills: billing payment queue, installment handling, approve payment',
  'Payment Processing & Gateway: authorize transaction, confirm paid, gateway validation',
  'Compliance & Documentation: generate receipt, verify proof of payment, final documentation',
  'Completed Transactions: finalized records, archive, discrepancy review, send back when needed'
];

function resolveDashboardIcon(icon?: string) {
  return dashboardIconMap[icon || ''] || mdiChartLine;
}

function transactionStatusColor(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'paid') return 'success';
  if (normalized === 'authorized' || normalized === 'reconciled') return 'primary';
  if (normalized === 'processing' || normalized === 'logged') return 'warning';
  if (normalized === 'failed' || normalized === 'cancelled') return 'error';
  return 'secondary';
}

function alertColor(severity: string): string {
  if (severity === 'error') return 'error';
  if (severity === 'warning') return 'warning';
  if (severity === 'success') return 'success';
  return 'primary';
}

function clearanceColor(status: string): string {
  return status === 'Cleared' ? 'success' : 'warning';
}

function handoffColor(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'sent') return 'success';
  if (normalized === 'ready') return 'info';
  return 'secondary';
}

function handoffLabel(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (!normalized) return 'Pending';
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

async function loadSnapshot() {
  const [snapshot, activities, alerts, charts, handoffs, hrSnapshot] = await Promise.all([
    fetchBpaDashboardSnapshot(),
    fetchDashboardRecentActivities(),
    fetchDashboardAlerts(),
    fetchDashboardCharts(),
    fetchCashierDepartmentHandoffs(),
    fetchDashboardHrRequestsSnapshot()
  ]);
  summaryCards.value = snapshot.summaryCards;
  moduleCards.value = snapshot.moduleCards;
  recentTransactions.value = snapshot.recentTransactions;
  recentActivities.value = activities.items || [];
  dashboardAlerts.value = alerts.items || [];
  chartData.value = charts;
  departmentStats.value = handoffs.stats;
  departmentMatrix.value = handoffs.matrix;
  departmentLatestItems.value = handoffs.latestItems;
  hrEmployees.value = hrSnapshot.employees || [];
  hrRequests.value = hrSnapshot.requests || [];
  if (!selectedHrEmployeeId.value && hrEmployees.value.length) {
    selectedHrEmployeeId.value = hrEmployees.value[0].id;
  }
}

async function submitHrRequest() {
  const employee = hrEmployees.value.find((item) => item.id === selectedHrEmployeeId.value);
  if (!employee) {
    hrRequestSnackbarMessage.value = 'Select a cashier employee first.';
    hrRequestSnackbar.value = true;
    return;
  }
  if (!hrRequestType.value.trim()) {
    hrRequestSnackbarMessage.value = 'Request type is required.';
    hrRequestSnackbar.value = true;
    return;
  }

  hrRequestSubmitting.value = true;
  try {
    const response = await createDashboardHrRequest({
      employeeId: employee.id,
      employeeName: employee.name,
      requestType: hrRequestType.value.trim(),
      details: hrRequestDetails.value.trim()
    });
    hrRequestSnackbarMessage.value = response.message || `${employee.name} request submitted to HR.`;
    hrRequestSnackbar.value = true;
    hrRequestDetails.value = '';
    const hrSnapshot = await fetchDashboardHrRequestsSnapshot();
    hrEmployees.value = hrSnapshot.employees || [];
    hrRequests.value = hrSnapshot.requests || [];
  } catch (error) {
    hrRequestSnackbarMessage.value = error instanceof Error ? error.message : 'Unable to submit HR request.';
    hrRequestSnackbar.value = true;
  } finally {
    hrRequestSubmitting.value = false;
  }
}

const collectionChartSeries = computed(() => [
  {
    name: 'Daily Collection',
    data: chartData.value.dailyCollection.map((row) => row.total)
  }
]);

const collectionChartOptions = computed(() => ({
  chart: {
    type: 'area',
    toolbar: { show: false },
    fontFamily: 'inherit'
  },
  colors: ['#25549d'],
  stroke: {
    curve: 'smooth',
    width: 3
  },
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 1,
      opacityFrom: 0.32,
      opacityTo: 0.05,
      stops: [0, 100]
    }
  },
  dataLabels: { enabled: false },
  grid: {
    borderColor: 'rgba(37, 84, 157, 0.12)',
    strokeDashArray: 4
  },
  xaxis: {
    categories: chartData.value.dailyCollection.map((row) =>
      new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    ),
    labels: {
      style: {
        colors: '#73809b',
        fontSize: '12px'
      }
    },
    axisBorder: { show: false },
    axisTicks: { show: false }
  },
  yaxis: {
    labels: {
      style: {
        colors: '#73809b',
        fontSize: '12px'
      },
      formatter: (value: number) => `P${Math.round(value).toLocaleString()}`
    }
  },
  tooltip: {
    y: {
      formatter: (value: number) => `P${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
  }
}));

const statusChartSeries = computed(() => chartData.value.paymentStatusBreakdown.map((item) => item.total));

const statusChartOptions = computed(() => ({
  chart: {
    type: 'donut',
    toolbar: { show: false },
    fontFamily: 'inherit'
  },
  labels: chartData.value.paymentStatusBreakdown.map((item) => item.status),
  colors: ['#23ba63', '#357adf', '#ff9800', '#a82cf0', '#ef4444', '#8c6a43'],
  legend: {
    position: 'bottom',
    fontSize: '13px',
    labels: {
      colors: '#4b5563'
    }
  },
  dataLabels: {
    enabled: true,
    formatter: (value: number) => `${Math.round(value)}%`
  },
  plotOptions: {
    pie: {
      donut: {
        size: '62%'
      }
    }
  },
  stroke: {
    width: 0
  }
}));

onMounted(() => {
  void loadSnapshot();
});
</script>

<template>
  <v-card class="hero-banner mb-4" elevation="0">
    <v-card-text class="pa-5">
      <div class="d-flex flex-wrap align-center justify-space-between ga-4">
        <div>
          <div class="hero-kicker">Cashier Operations</div>
          <h1 class="text-h4 font-weight-black mb-1">Cashier System Dashboard</h1>
          <p class="hero-subtitle mb-0">
            Live cashier flow overview based on the current process chart, from Student Portal & Billing up to Completed Transactions.
          </p>
        </div>
        <div class="hero-side-card">
          <div class="hero-side-label">Flow Window</div>
          <div class="hero-side-value">Cashier Online Payment System Flow</div>
          <div class="hero-side-note">Student Portal & Billing -> Pay Bills -> Payment Processing & Gateway -> Compliance & Documentation -> Completed Transactions</div>
        </div>
      </div>
    </v-card-text>
  </v-card>

  <v-row class="mb-1">
    <v-col v-for="card in summaryCards" :key="card.key" cols="12" sm="6" lg="3">
      <CashierAnalyticsCard
        :title="card.title"
        :value="card.value"
        :subtitle="card.subtitle"
        :icon="card.icon"
        :tone="card.cardClass.replace('analytics-card-', '') as 'green' | 'blue' | 'orange' | 'purple'"
      />
    </v-col>
  </v-row>

  <v-row>
    <v-col cols="12" lg="8">
      <v-card variant="outlined" class="h-100 chart-card">
        <v-card-item>
          <v-card-title>Daily Collection Trend</v-card-title>
          <v-card-subtitle>Paid cashier amounts captured over the last 7 days</v-card-subtitle>
        </v-card-item>
        <v-card-text class="pt-2">
          <apexchart
            v-if="chartData.dailyCollection.length"
            type="area"
            height="290"
            :options="collectionChartOptions"
            :series="collectionChartSeries"
          />
          <div v-else class="text-body-2 text-medium-emphasis py-8 text-center">No daily collection data available yet.</div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="4">
      <v-card variant="outlined" class="h-100 chart-card">
        <v-card-item>
          <v-card-title>Payment Status Breakdown</v-card-title>
          <v-card-subtitle>Live distribution of payment records by cashier status</v-card-subtitle>
        </v-card-item>
        <v-card-text class="pt-2">
          <apexchart
            v-if="chartData.paymentStatusBreakdown.length"
            type="donut"
            height="290"
            :options="statusChartOptions"
            :series="statusChartSeries"
          />
          <div v-else class="text-body-2 text-medium-emphasis py-8 text-center">No payment status data available yet.</div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col v-for="module in moduleCards" :key="module.title" cols="12" md="6" xl="4">
      <v-card variant="outlined" class="module-card h-100">
        <v-card-text class="pa-5">
          <div class="d-flex align-start justify-space-between ga-3 mb-4">
            <div>
              <div class="module-kicker">Flow Stage</div>
              <div class="text-h6 font-weight-bold">{{ module.title }}</div>
            </div>
            <div :class="['module-icon', `module-icon-${module.accent}`]">
              <v-icon :icon="resolveDashboardIcon(module.icon)" size="24"></v-icon>
            </div>
          </div>
          <p class="text-body-2 text-medium-emphasis mb-0">
            {{ module.description }}
          </p>
          <div class="text-body-2 text-primary font-weight-medium mt-3">{{ module.statusSummary }}</div>
          <v-btn class="mt-4" color="primary" variant="tonal" size="small" @click="router.push(module.actionTo)">
            {{ module.actionLabel }}
          </v-btn>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="5">
      <v-card variant="outlined" class="h-100">
        <v-card-item>
          <v-card-title>Department Handoff Matrix</v-card-title>
          <v-card-subtitle>Cashier intake and delivery contract for Registrar, PMED, HR, and Admin Reports</v-card-subtitle>
        </v-card-item>
        <v-card-text class="pt-2">
          <div class="department-matrix-grid">
            <div v-for="item in departmentMatrix" :key="item.department" class="department-matrix-card">
              <div class="font-weight-bold">{{ item.department }}</div>
              <div class="text-body-2 text-medium-emphasis mt-1">{{ item.usage }}</div>
              <div class="department-flow-line mt-3">
                <div class="department-flow-label">Into Cashier</div>
                <div class="department-flow-copy">{{ item.incomingToCashier.join(' | ') }}</div>
              </div>
              <div class="department-flow-line mt-3">
                <div class="department-flow-label">From Cashier</div>
                <div class="department-flow-copy">{{ item.outgoingFromCashier.join(' | ') }}</div>
              </div>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="7">
      <v-card variant="outlined" class="h-100">
        <v-card-item>
          <v-card-title>Live Department-Ready Records</v-card-title>
          <v-card-subtitle>Real cashier outputs built from payment status, official receipts, and clearance state</v-card-subtitle>
        </v-card-item>
        <v-card-text class="pt-2">
          <v-row class="mb-1">
            <v-col v-for="card in departmentStats" :key="card.title" cols="12" sm="6">
              <CashierAnalyticsCard :title="card.title" :value="card.value" :subtitle="card.subtitle" :icon="card.icon" :tone="card.tone" />
            </v-col>
          </v-row>

          <div v-if="departmentLatestItems.length" class="department-live-grid mt-2">
            <div v-for="item in departmentLatestItems" :key="item.id" class="department-live-card">
              <div class="d-flex flex-wrap align-center justify-space-between ga-3">
                <div>
                  <div class="font-weight-bold">{{ item.consumerDepartment }} · {{ item.channelType }}</div>
                  <div class="text-body-2 text-medium-emphasis">
                    {{ item.paymentReference }} | {{ item.studentName }} | {{ item.billingCode }}
                  </div>
                </div>
                <v-chip size="small" :color="clearanceColor(item.clearanceStatus)" variant="tonal">{{ item.clearanceStatus }}</v-chip>
              </div>
              <div class="department-live-meta mt-3">
                <div>{{ item.paymentStatus }} | {{ item.receiptNumber }} | {{ item.receiptStatus }}</div>
                <div>{{ item.amountFormatted }} | {{ item.workflowStageLabel }}</div>
              </div>
              <div class="department-live-meta text-medium-emphasis mt-2">{{ item.clearanceNote }}</div>
              <div class="d-flex flex-wrap align-center ga-2 mt-3">
                <v-chip size="x-small" :color="handoffColor(item.handoffStatus)" variant="tonal">{{ handoffLabel(item.handoffStatus) }}</v-chip>
                <v-chip v-for="output in item.outputs" :key="`${item.id}-${output}`" size="x-small" color="primary" variant="outlined">
                  {{ output }}
                </v-chip>
              </div>
            </div>
          </div>
          <div v-else class="text-body-2 text-medium-emphasis py-8 text-center">No department-ready cashier records yet.</div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="6">
      <v-card variant="outlined" class="h-100">
        <v-card-item>
          <v-card-title>HR Employee Request (Cashier Department)</v-card-title>
          <v-card-subtitle>Send employee-related requests from Cashier to HR.</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <v-row>
            <v-col cols="12" md="6">
              <v-select
                v-model="selectedHrEmployeeId"
                :items="hrEmployees.map((item) => ({ title: `${item.name} (${item.role})`, value: item.id }))"
                label="Cashier Employee"
                variant="outlined"
                density="comfortable"
                hide-details
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="hrRequestType"
                :items="['Certification Request', 'Payroll Concern', 'Leave Validation', 'Employment Record Update']"
                label="Request Type"
                variant="outlined"
                density="comfortable"
                hide-details
              />
            </v-col>
            <v-col cols="12">
              <v-textarea
                v-model="hrRequestDetails"
                label="Details"
                variant="outlined"
                density="comfortable"
                rows="3"
                auto-grow
                hide-details
              />
            </v-col>
            <v-col cols="12" class="pt-0">
              <v-btn color="primary" :loading="hrRequestSubmitting" @click="submitHrRequest">Send Request to HR</v-btn>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="6">
      <v-card variant="outlined" class="h-100">
        <v-card-item>
          <v-card-title>Recent HR Requests</v-card-title>
          <v-card-subtitle>Latest requests sent from Cashier to HR.</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div v-if="hrRequests.length">
            <div v-for="item in hrRequests.slice(0, 6)" :key="item.id" class="insight-card">
              <div class="d-flex justify-space-between ga-3">
                <div class="font-weight-bold">{{ item.requestReference }}</div>
                <v-chip size="x-small" color="warning" variant="tonal">{{ item.status }}</v-chip>
              </div>
              <div class="text-body-2 text-medium-emphasis mt-1">{{ item.employeeName }} | {{ item.requestType }}</div>
              <div class="text-caption text-medium-emphasis mt-1">{{ item.createdAtLabel }} | {{ item.createdAtRelative }}</div>
            </div>
          </div>
          <div v-else class="text-body-2 text-medium-emphasis py-4 text-center">No HR requests sent yet.</div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="5">
      <v-card variant="outlined" class="h-100">
        <v-card-item>
          <v-card-title>Flow Legend</v-card-title>
          <v-card-subtitle>How records move across the cashier workflow</v-card-subtitle>
        </v-card-item>
        <v-card-text class="pt-2">
          <div class="integration-grid">
            <div v-for="item in flowLegend" :key="item.title" class="integration-card">
              <v-icon :icon="resolveDashboardIcon(item.icon)" size="18" class="mr-2" :class="item.tone === 'success' ? 'text-success' : 'text-warning'"></v-icon>
              <div>
                <div class="font-weight-bold">{{ item.title }}</div>
                <div class="text-body-2 text-medium-emphasis mt-1">{{ item.detail }}</div>
              </div>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="7">
      <v-card variant="outlined" class="h-100">
        <v-card-item>
          <v-card-title>Stage Notes</v-card-title>
          <v-card-subtitle>Core actions preserved from the flow chart</v-card-subtitle>
        </v-card-item>
        <v-card-text class="pt-2">
          <div class="database-grid">
            <div v-for="(note, index) in stageNotes" :key="note" class="database-card">
              <div class="database-code">S{{ index + 1 }}</div>
              <div class="database-title">{{ note.split(':')[0] }}</div>
              <div class="database-subtitle">{{ note.split(':')[1] }}</div>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" md="6">
      <v-card variant="outlined" class="h-100">
        <v-card-item>
          <v-card-title>Recent Activity</v-card-title>
          <v-card-subtitle>Live BPA workflow actions across the cashier modules</v-card-subtitle>
        </v-card-item>
        <v-card-text class="pt-2">
          <div v-for="activity in recentActivities" :key="activity.id" class="insight-card">
            <div class="d-flex justify-space-between ga-3">
              <div>
                <div class="font-weight-bold">{{ activity.action }}</div>
                <div class="text-body-2 text-medium-emphasis">{{ activity.remarks }}</div>
              </div>
              <v-chip size="x-small" color="primary" variant="tonal">{{ activity.relativeTime }}</v-chip>
            </div>
            <div class="text-caption text-medium-emphasis mt-2">
              {{ activity.actorName || 'System' }} | {{ activity.module.replace(/_/g, ' ') }}
            </div>
          </div>
          <div v-if="!recentActivities.length" class="text-body-2 text-medium-emphasis py-4 text-center">No recent activities yet.</div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" md="6">
      <v-card variant="outlined" class="h-100">
        <v-card-item>
          <v-card-title>Workflow Alerts</v-card-title>
          <v-card-subtitle>Unread notifications, failed payments, and pending documentation</v-card-subtitle>
        </v-card-item>
        <v-card-text class="pt-2">
          <div v-for="alert in dashboardAlerts" :key="alert.id" class="insight-card">
            <div class="d-flex justify-space-between ga-3">
              <div class="font-weight-bold">{{ alert.title }}</div>
              <v-chip size="x-small" :color="alertColor(alert.severity)" variant="tonal">{{ alert.severity }}</v-chip>
            </div>
            <div class="text-body-2 text-medium-emphasis mt-2">{{ alert.detail }}</div>
          </div>
          <div v-if="!dashboardAlerts.length" class="text-body-2 text-medium-emphasis py-4 text-center">No active alerts right now.</div>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12">
      <v-card variant="outlined">
          <v-card-item>
          <v-card-title>Recent Transactions</v-card-title>
          <v-card-subtitle>Live BPA payment and gateway activity</v-card-subtitle>
        </v-card-item>
        <v-card-text class="pt-2">
          <v-table density="comfortable">
            <thead>
              <tr>
                <th>Reference Number</th>
                <th>Student Name</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="transaction in recentTransactions" :key="transaction.referenceNumber">
                <td class="font-weight-medium">{{ transaction.referenceNumber }}</td>
                <td>{{ transaction.studentName }}</td>
                <td>{{ transaction.amount }}</td>
                <td>
                  <v-chip size="small" :color="transactionStatusColor(transaction.status)" variant="tonal">
                    {{ transaction.status }}
                  </v-chip>
                </td>
                <td>{{ transaction.date }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
  <v-snackbar v-model="hrRequestSnackbar" color="primary">{{ hrRequestSnackbarMessage }}</v-snackbar>
</template>

<style scoped>
.hero-banner {
  border-radius: 16px;
  color: #fff;
  background: linear-gradient(120deg, #162d84 0%, #2f63cc 54%, #3ea8f0 100%);
  box-shadow: 0 14px 30px rgba(19, 45, 126, 0.22);
}

.hero-kicker {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  margin-bottom: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.32);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.55px;
  text-transform: uppercase;
}

.hero-subtitle {
  max-width: 720px;
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 1px 2px rgba(8, 20, 52, 0.35);
}

.hero-side-card {
  min-width: 280px;
  max-width: 320px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.9);
  color: #14316e;
}

.hero-side-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.hero-side-value {
  margin-top: 4px;
  font-weight: 700;
}

.hero-side-note {
  margin-top: 8px;
  font-size: 13px;
  color: rgba(20, 49, 110, 0.82);
}

.chart-card {
  border-radius: 18px;
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.05);
}

.module-card {
  border-radius: 18px;
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.05);
}

.module-kicker {
  margin-bottom: 8px;
  color: #8c6a43;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.45px;
  text-transform: uppercase;
}

.module-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 16px;
  flex-shrink: 0;
}

.module-icon-verification {
  background: rgba(64, 169, 242, 0.16);
  color: #1e88e5;
}

.module-icon-billing {
  background: rgba(255, 152, 0, 0.14);
  color: #ef6c00;
}

.module-icon-payment {
  background: rgba(35, 186, 99, 0.16);
  color: #1b8f4c;
}

.module-icon-receipt {
  background: rgba(168, 44, 240, 0.16);
  color: #7a1fca;
}

.module-icon-finance {
  background: rgba(139, 111, 71, 0.14);
  color: #8c6a43;
}

.module-icon-completed {
  background: rgba(35, 186, 99, 0.16);
  color: #1b8f4c;
}

.integration-grid,
.database-grid,
.department-matrix-grid,
.department-live-grid {
  display: grid;
  gap: 14px;
}

.insight-card {
  padding: 14px;
  border-radius: 14px;
  background: #fbf7f1;
  border: 1px solid rgba(189, 157, 120, 0.15);
}

.insight-card + .insight-card {
  margin-top: 12px;
}

.integration-grid {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.database-grid {
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}

.department-matrix-grid,
.department-live-grid {
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.integration-card,
.database-card,
.department-matrix-card,
.department-live-card {
  border-radius: 16px;
  padding: 16px;
  background: #fbf7f1;
  border: 1px solid rgba(140, 106, 67, 0.12);
}

.integration-card {
  display: flex;
  align-items: center;
  min-height: 64px;
  font-weight: 600;
  color: #3f3326;
}

.department-flow-line {
  display: grid;
  gap: 4px;
}

.department-flow-label {
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #73809b;
  font-weight: 700;
}

.department-flow-copy,
.department-live-meta {
  font-size: 13px;
  color: rgba(44, 62, 80, 0.78);
}

.database-code {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  padding: 6px 10px;
  border-radius: 999px;
  background: #efe3d3;
  color: #7a5833;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.4px;
}

.database-title {
  margin-top: 12px;
  font-size: 16px;
  font-weight: 700;
  color: #2c3e50;
}

.database-subtitle {
  margin-top: 6px;
  font-size: 13px;
  color: rgba(44, 62, 80, 0.7);
}
</style>
