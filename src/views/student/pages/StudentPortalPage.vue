<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import bcpLogo from '@/assets/images/logos/bcp-olp-logo-mini2.png';
import { fetchStudentPortalSession, loginStudentPortal, logoutStudentPortal, type StudentPortalUser } from '@/services/studentPortalAuth';
import {
  fetchStudentAccountStatement,
  fetchStudentBillings,
  fetchStudentInvoices,
  fetchStudentPayables,
  fetchStudentPaymentMethods,
  fetchStudentReceipts,
  initiateStudentPayment,
  setupStudentAutoDebit,
  type PaymentMethodOption,
  type StudentAccountStatement,
  type StudentBillingRecord,
  type StudentReceiptRecord
} from '@/services/studentPortal';

const session = ref<StudentPortalUser | null>(null);
const accountStatement = ref<StudentAccountStatement | null>(null);
const billingRows = ref<StudentBillingRecord[]>([]);
const invoiceRows = ref<StudentBillingRecord[]>([]);
const payableRows = ref<StudentBillingRecord[]>([]);
const receiptRows = ref<StudentReceiptRecord[]>([]);
const paymentMethods = ref<PaymentMethodOption[]>([]);
const loading = ref(false);
const loggingIn = ref(false);
const authError = ref('');
const pageError = ref('');
const snackbar = ref(false);
const snackbarMessage = ref('');
const activeTab = ref('statement');
const loginForm = ref({
  login: '',
  password: ''
});
const selectedInvoice = ref<StudentBillingRecord | null>(null);
const invoiceDialog = ref(false);
const paymentDialog = ref(false);
const autoDebitDialog = ref(false);
const actionLoading = ref(false);
const paymentForm = ref({
  billingId: 0,
  amount: 0,
  paymentMethod: ''
});
const autoDebitForm = ref({
  billingId: 0,
  accountName: '',
  bankName: '',
  accountMask: '',
  frequency: 'monthly'
});

const summaryCards = computed(() => {
  if (!accountStatement.value) return [];
  const summary = accountStatement.value.summary;
  return [
    { title: 'Active Billings', value: String(billingRows.value.filter((item) => ['Active Billing', 'Pending Payment', 'Partially Paid'].includes(item.status)).length), subtitle: 'Student Portal & Billing records' },
    { title: 'Pending Payments', value: String(payableRows.value.length), subtitle: 'Ready for Pay Bills' },
    { title: 'Generated Receipts', value: String(receiptRows.value.length), subtitle: 'Compliance output available' },
    { title: 'Outstanding Balance', value: summary.totalBalanceFormatted, subtitle: 'Remaining balance due' }
  ];
});

const studentOverview = computed(() => accountStatement.value?.student || null);

function statusColor(status: string): string {
  const value = status.toLowerCase();
  if (value.includes('paid') || value.includes('completed') || value.includes('verified')) return 'success';
  if (value.includes('pending') || value.includes('processing') || value.includes('generated')) return 'warning';
  if (value.includes('correction') || value.includes('failed') || value.includes('cancelled')) return 'error';
  return 'primary';
}

function useDefaultStudent(): void {
  loginForm.value.login = '2024-0001';
  loginForm.value.password = 'student123';
}

function openInvoice(record: StudentBillingRecord): void {
  selectedInvoice.value = record;
  invoiceDialog.value = true;
}

function openPayment(record: StudentBillingRecord): void {
  paymentForm.value = {
    billingId: record.id,
    amount: record.balanceAmount,
    paymentMethod: paymentMethods.value[0]?.label || ''
  };
  paymentDialog.value = true;
}

function openAutoDebit(record: StudentBillingRecord): void {
  autoDebitForm.value = {
    billingId: record.id,
    accountName: studentOverview.value?.fullName || session.value?.fullName || '',
    bankName: '',
    accountMask: '',
    frequency: 'monthly'
  };
  autoDebitDialog.value = true;
}

async function loadPortalData(): Promise<void> {
  if (!session.value) return;
  loading.value = true;
  pageError.value = '';
  try {
    const [statement, billings, invoices, payables, receipts, methods] = await Promise.all([
      fetchStudentAccountStatement(),
      fetchStudentBillings(),
      fetchStudentInvoices(),
      fetchStudentPayables(),
      fetchStudentReceipts(),
      fetchStudentPaymentMethods()
    ]);
    accountStatement.value = statement;
    billingRows.value = billings;
    invoiceRows.value = invoices;
    payableRows.value = payables;
    receiptRows.value = receipts;
    paymentMethods.value = methods;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load student portal data.';
    if (message.toLowerCase().includes('authentication')) {
      session.value = null;
      accountStatement.value = null;
      billingRows.value = [];
      invoiceRows.value = [];
      payableRows.value = [];
      receiptRows.value = [];
      paymentMethods.value = [];
    }
    pageError.value = message;
  } finally {
    loading.value = false;
  }
}

async function hydrateSession(): Promise<void> {
  session.value = await fetchStudentPortalSession();
  if (session.value) {
    await loadPortalData();
  }
}

async function login(): Promise<void> {
  authError.value = '';
  loggingIn.value = true;
  try {
    session.value = await loginStudentPortal(loginForm.value.login.trim(), loginForm.value.password);
    await loadPortalData();
  } catch (error) {
    authError.value = error instanceof Error ? error.message : 'Unable to sign in to the student portal.';
  } finally {
    loggingIn.value = false;
  }
}

async function logout(): Promise<void> {
  await logoutStudentPortal();
  session.value = null;
  accountStatement.value = null;
  billingRows.value = [];
  invoiceRows.value = [];
  payableRows.value = [];
  receiptRows.value = [];
  paymentMethods.value = [];
  loginForm.value.password = '';
}

async function submitPayment(): Promise<void> {
  actionLoading.value = true;
  try {
    const response = await initiateStudentPayment({
      billingId: paymentForm.value.billingId,
      amount: Number(paymentForm.value.amount),
      paymentMethod: paymentForm.value.paymentMethod
    });
    snackbarMessage.value = `${response.referenceNumber} was submitted to Payment Processing & Gateway.`;
    snackbar.value = true;
    paymentDialog.value = false;
    await loadPortalData();
  } catch (error) {
    snackbarMessage.value = error instanceof Error ? error.message : 'Unable to submit payment.';
    snackbar.value = true;
  } finally {
    actionLoading.value = false;
  }
}

async function submitAutoDebit(): Promise<void> {
  actionLoading.value = true;
  try {
    await setupStudentAutoDebit({
      billingId: autoDebitForm.value.billingId,
      accountName: autoDebitForm.value.accountName,
      bankName: autoDebitForm.value.bankName,
      accountMask: autoDebitForm.value.accountMask,
      frequency: autoDebitForm.value.frequency
    });
    snackbarMessage.value = 'Auto debit arrangement saved successfully.';
    snackbar.value = true;
    autoDebitDialog.value = false;
  } catch (error) {
    snackbarMessage.value = error instanceof Error ? error.message : 'Unable to save auto debit arrangement.';
    snackbar.value = true;
  } finally {
    actionLoading.value = false;
  }
}

onMounted(() => {
  void hydrateSession();
});
</script>

<template>
  <div class="student-portal-page">
    <div class="portal-shell">
      <v-card class="hero-card" elevation="0">
        <v-card-text class="pa-6 pa-md-8">
          <div class="d-flex flex-column flex-lg-row justify-space-between ga-6">
            <div class="hero-copy">
              <div class="brand-row">
                <img :src="bcpLogo" alt="BCP Cashier System" class="hero-logo" />
                <div>
                  <div class="hero-kicker">Bestlink College of the Philippines</div>
                  <h1 class="hero-title">Student Portal & Billing</h1>
                </div>
              </div>
              <p class="hero-subtitle">
                Follow the BPA cashier workflow from account statement review, invoice generation, and bill payment initiation
                up to receipt release and reconciliation visibility.
              </p>
              <div class="actor-badges">
                <v-chip color="info" variant="tonal">Student</v-chip>
                <v-chip color="primary" variant="tonal">Pay Bills</v-chip>
                <v-chip color="secondary" variant="tonal">Payment Processing & Gateway</v-chip>
                <v-chip color="success" variant="tonal">Compliance & Documentation</v-chip>
              </div>
            </div>

            <v-card class="login-card" elevation="0">
              <v-card-text class="pa-5">
                <template v-if="!session">
                  <div class="text-overline font-weight-bold text-primary mb-2">Student Login</div>
                  <div class="text-h6 font-weight-bold mb-1">Access your billing workspace</div>
                  <div class="text-body-2 text-medium-emphasis mb-4">
                    Use your student number or student email to review billings, pay balances, and check receipts.
                  </div>

                  <v-alert color="info" variant="tonal" class="mb-4">
                    <div class="font-weight-bold mb-1">Default Student Demo</div>
                    <div>Login: 2024-0001</div>
                    <div>Password: student123</div>
                    <v-btn size="small" class="mt-3" color="primary" variant="flat" @click="useDefaultStudent">Use Demo Account</v-btn>
                  </v-alert>

                  <v-text-field v-model="loginForm.login" label="Student Number or Email" variant="outlined" density="comfortable" hide-details class="mb-3" />
                  <v-text-field v-model="loginForm.password" label="Password" type="password" variant="outlined" density="comfortable" hide-details class="mb-4" />
                  <v-btn block color="primary" size="large" :loading="loggingIn" @click="login">Sign In</v-btn>
                  <v-alert v-if="authError" type="error" variant="tonal" class="mt-4">{{ authError }}</v-alert>
                </template>

                <template v-else>
                  <div class="text-overline font-weight-bold text-primary mb-2">Logged In</div>
                  <div class="text-h6 font-weight-bold mb-1">{{ session.fullName }}</div>
                  <div class="text-body-2 text-medium-emphasis mb-4">
                    {{ session.studentNumber }} · {{ session.program || 'Program not set' }}
                  </div>
                  <div class="portal-user-meta">
                    <div>
                      <div class="meta-label">Email</div>
                      <div class="meta-value">{{ session.email || '--' }}</div>
                    </div>
                    <div>
                      <div class="meta-label">Year Level</div>
                      <div class="meta-value">{{ session.yearLevel || '--' }}</div>
                    </div>
                  </div>
                  <v-btn block color="primary" variant="tonal" class="mt-4" @click="logout">Sign Out</v-btn>
                </template>
              </v-card-text>
            </v-card>
          </div>
        </v-card-text>
      </v-card>

      <template v-if="session">
        <v-alert v-if="pageError" color="error" variant="tonal" class="mt-4">{{ pageError }}</v-alert>

        <v-row class="mt-1">
          <v-col v-for="card in summaryCards" :key="card.title" cols="12" sm="6" xl="3">
            <v-card class="summary-card" elevation="0">
              <v-card-text>
                <div class="text-overline text-primary font-weight-bold">{{ card.title }}</div>
                <div class="text-h5 font-weight-black mt-2">{{ card.value }}</div>
                <div class="text-body-2 text-medium-emphasis mt-2">{{ card.subtitle }}</div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>

        <v-card class="workspace-card mt-4" elevation="0">
          <v-tabs v-model="activeTab" color="primary" grow>
            <v-tab value="statement">Account Statement</v-tab>
            <v-tab value="billings">Student Billings</v-tab>
            <v-tab value="payables">Pay Bills</v-tab>
            <v-tab value="receipts">Receipts</v-tab>
          </v-tabs>

          <v-divider />

          <v-card-text class="pa-5">
            <div v-if="loading" class="py-10 text-center">
              <v-progress-circular indeterminate color="primary" />
            </div>

            <v-window v-else v-model="activeTab">
              <v-window-item value="statement">
                <div class="section-headline">
                  <div>
                    <div class="text-h6 font-weight-bold">Account Statement</div>
                    <div class="text-body-2 text-medium-emphasis">View your real billing totals, outstanding balances, and invoice-ready records.</div>
                  </div>
                </div>

                <div class="statement-summary-grid mt-4" v-if="accountStatement">
                  <v-card class="statement-summary-card" elevation="0">
                    <v-card-text>
                      <div class="meta-label">Total Assessment</div>
                      <div class="text-h6 font-weight-black">{{ accountStatement.summary.totalAssessmentFormatted }}</div>
                    </v-card-text>
                  </v-card>
                  <v-card class="statement-summary-card" elevation="0">
                    <v-card-text>
                      <div class="meta-label">Total Paid</div>
                      <div class="text-h6 font-weight-black">{{ accountStatement.summary.totalPaidFormatted }}</div>
                    </v-card-text>
                  </v-card>
                  <v-card class="statement-summary-card" elevation="0">
                    <v-card-text>
                      <div class="meta-label">Outstanding Balance</div>
                      <div class="text-h6 font-weight-black">{{ accountStatement.summary.totalBalanceFormatted }}</div>
                    </v-card-text>
                  </v-card>
                </div>

                <v-table class="mt-4">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Term</th>
                      <th>Status</th>
                      <th>Balance</th>
                      <th>Due Date</th>
                      <th class="text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in billingRows" :key="row.id">
                      <td>
                        <div class="font-weight-bold">{{ row.invoiceNumber }}</div>
                        <div class="text-caption text-medium-emphasis">{{ row.program }}</div>
                      </td>
                      <td>{{ row.term }}</td>
                      <td>
                        <v-chip size="small" :color="statusColor(row.status)" variant="tonal">{{ row.status }}</v-chip>
                      </td>
                      <td>{{ row.balanceAmountFormatted }}</td>
                      <td>{{ row.dueDateFormatted }}</td>
                      <td class="text-right">
                        <v-btn size="small" color="primary" variant="tonal" @click="openInvoice(row)">Invoice Preview</v-btn>
                      </td>
                    </tr>
                  </tbody>
                </v-table>
              </v-window-item>

              <v-window-item value="billings">
                <div class="section-headline">
                  <div>
                    <div class="text-h6 font-weight-bold">Student Portal & Billing Queue</div>
                    <div class="text-body-2 text-medium-emphasis">Review real BPA billing records and inspect the generated invoice lines.</div>
                  </div>
                </div>

                <v-row class="mt-2">
                  <v-col v-for="row in invoiceRows" :key="row.id" cols="12" md="6">
                    <v-card class="billing-card" elevation="0">
                      <v-card-text>
                        <div class="d-flex align-center justify-space-between ga-3">
                          <div>
                            <div class="font-weight-bold">{{ row.billingCode }}</div>
                            <div class="text-body-2 text-medium-emphasis">{{ row.term }}</div>
                          </div>
                          <v-chip size="small" :color="statusColor(row.status)" variant="tonal">{{ row.status }}</v-chip>
                        </div>
                        <div class="billing-card-grid mt-4">
                          <div>
                            <div class="meta-label">Total</div>
                            <div class="meta-value">{{ row.totalAmountFormatted }}</div>
                          </div>
                          <div>
                            <div class="meta-label">Paid</div>
                            <div class="meta-value">{{ row.paidAmountFormatted }}</div>
                          </div>
                          <div>
                            <div class="meta-label">Balance</div>
                            <div class="meta-value">{{ row.balanceAmountFormatted }}</div>
                          </div>
                          <div>
                            <div class="meta-label">Eligibility</div>
                            <div class="meta-value">{{ row.paymentEligible ? 'Ready for payment' : 'Needs update' }}</div>
                          </div>
                        </div>
                        <v-btn class="mt-4" color="primary" variant="tonal" @click="openInvoice(row)">View Invoice</v-btn>
                      </v-card-text>
                    </v-card>
                  </v-col>
                </v-row>
              </v-window-item>

              <v-window-item value="payables">
                <div class="section-headline">
                  <div>
                    <div class="text-h6 font-weight-bold">Pay Bills</div>
                    <div class="text-body-2 text-medium-emphasis">Initiate full or partial payments and configure your auto debit arrangement.</div>
                  </div>
                </div>

                <v-row class="mt-2">
                  <v-col v-for="row in payableRows" :key="row.id" cols="12" lg="6">
                    <v-card class="billing-card" elevation="0">
                      <v-card-text>
                        <div class="d-flex align-center justify-space-between ga-3">
                          <div>
                            <div class="font-weight-bold">{{ row.billingCode }}</div>
                            <div class="text-body-2 text-medium-emphasis">{{ row.program }}</div>
                          </div>
                          <v-chip size="small" :color="statusColor(row.status)" variant="tonal">{{ row.status }}</v-chip>
                        </div>
                        <div class="billing-card-grid mt-4">
                          <div>
                            <div class="meta-label">Balance Due</div>
                            <div class="meta-value">{{ row.balanceAmountFormatted }}</div>
                          </div>
                          <div>
                            <div class="meta-label">Due Date</div>
                            <div class="meta-value">{{ row.dueDateFormatted }}</div>
                          </div>
                        </div>
                        <div class="d-flex flex-wrap ga-2 mt-4">
                          <v-btn color="primary" @click="openPayment(row)">Pay This Billing</v-btn>
                          <v-btn color="secondary" variant="outlined" @click="openAutoDebit(row)">Setup Auto Debit</v-btn>
                        </div>
                      </v-card-text>
                    </v-card>
                  </v-col>
                </v-row>
              </v-window-item>

              <v-window-item value="receipts">
                <div class="section-headline">
                  <div>
                    <div class="text-h6 font-weight-bold">Generated Receipts</div>
                    <div class="text-body-2 text-medium-emphasis">Check receipts released by Compliance & Documentation after successful payments.</div>
                  </div>
                </div>

                <v-table class="mt-4">
                  <thead>
                    <tr>
                      <th>Receipt</th>
                      <th>Billing</th>
                      <th>Payment Ref</th>
                      <th>Status</th>
                      <th>Issued</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in receiptRows" :key="row.id">
                      <td class="font-weight-bold">{{ row.receiptNumber }}</td>
                      <td>{{ row.billingCode }}</td>
                      <td>{{ row.paymentReference }}</td>
                      <td>
                        <v-chip size="small" :color="statusColor(row.status)" variant="tonal">{{ row.status }}</v-chip>
                      </td>
                      <td>{{ row.issuedDateFormatted }}</td>
                      <td>{{ row.amountFormatted }}</td>
                    </tr>
                    <tr v-if="!receiptRows.length">
                      <td colspan="6" class="text-center py-6 text-medium-emphasis">No receipts available yet. Successful payments will appear here after documentation is completed.</td>
                    </tr>
                  </tbody>
                </v-table>
              </v-window-item>
            </v-window>
          </v-card-text>
        </v-card>
      </template>
    </div>

    <v-dialog v-model="invoiceDialog" max-width="760">
      <v-card v-if="selectedInvoice" class="dialog-card">
        <v-card-title class="d-flex align-center justify-space-between ga-3">
          <div>
            <div class="text-overline">Invoice Preview</div>
            <div class="text-h6 font-weight-bold">{{ selectedInvoice.invoiceNumber }}</div>
          </div>
          <v-chip :color="statusColor(selectedInvoice.status)" variant="tonal">{{ selectedInvoice.status }}</v-chip>
        </v-card-title>
        <v-card-text>
          <div class="invoice-summary-grid">
            <div>
              <div class="meta-label">Program</div>
              <div class="meta-value">{{ selectedInvoice.program }}</div>
            </div>
            <div>
              <div class="meta-label">Term</div>
              <div class="meta-value">{{ selectedInvoice.term }}</div>
            </div>
            <div>
              <div class="meta-label">Due Date</div>
              <div class="meta-value">{{ selectedInvoice.dueDateFormatted }}</div>
            </div>
            <div>
              <div class="meta-label">Balance</div>
              <div class="meta-value">{{ selectedInvoice.balanceAmountFormatted }}</div>
            </div>
          </div>

          <v-table class="mt-4">
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th class="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in selectedInvoice.items" :key="item.id">
                <td>{{ item.name }}</td>
                <td>{{ item.category }}</td>
                <td class="text-right">{{ item.amountFormatted }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>
        <v-card-actions class="px-6 pb-6">
          <v-spacer />
          <v-btn variant="text" @click="invoiceDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="paymentDialog" max-width="520">
      <v-card class="dialog-card">
        <v-card-title>Initiate Payment</v-card-title>
        <v-card-text>
          <v-text-field v-model="paymentForm.amount" label="Payment Amount" type="number" variant="outlined" density="comfortable" class="mb-3" />
          <v-select
            v-model="paymentForm.paymentMethod"
            :items="paymentMethods"
            item-title="label"
            item-value="label"
            label="Payment Method"
            variant="outlined"
            density="comfortable"
          />
          <v-alert color="info" variant="tonal" class="mt-4">
            Submitted payments move to `Payment Processing & Gateway` before a receipt can be generated.
          </v-alert>
        </v-card-text>
        <v-card-actions class="px-6 pb-6">
          <v-spacer />
          <v-btn variant="text" @click="paymentDialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="actionLoading" @click="submitPayment">Submit Payment</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="autoDebitDialog" max-width="520">
      <v-card class="dialog-card">
        <v-card-title>Setup Auto Debit Arrangement</v-card-title>
        <v-card-text>
          <v-text-field v-model="autoDebitForm.accountName" label="Account Name" variant="outlined" density="comfortable" class="mb-3" />
          <v-text-field v-model="autoDebitForm.bankName" label="Bank Name" variant="outlined" density="comfortable" class="mb-3" />
          <v-text-field v-model="autoDebitForm.accountMask" label="Account Mask" variant="outlined" density="comfortable" class="mb-3" />
          <v-select
            v-model="autoDebitForm.frequency"
            :items="['monthly', 'quarterly', 'semi-annual']"
            label="Frequency"
            variant="outlined"
            density="comfortable"
          />
        </v-card-text>
        <v-card-actions class="px-6 pb-6">
          <v-spacer />
          <v-btn variant="text" @click="autoDebitDialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="actionLoading" @click="submitAutoDebit">Save Arrangement</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" color="primary" location="top right" :timeout="3200">
      {{ snackbarMessage }}
    </v-snackbar>
  </div>
</template>

<style scoped>
.student-portal-page {
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgba(62, 133, 229, 0.18), transparent 32%),
    linear-gradient(180deg, #eef4ff 0%, #f7f9fc 55%, #eef2f7 100%);
  padding: 24px 0 48px;
}

.portal-shell {
  width: min(1320px, calc(100vw - 32px));
  margin: 0 auto;
}

.hero-card {
  border-radius: 28px;
  background: linear-gradient(135deg, #17357d 0%, #2557b2 48%, #4ea4eb 100%);
  color: #fff;
  box-shadow: 0 24px 48px rgba(23, 53, 125, 0.18);
}

.hero-logo {
  width: 78px;
  height: 78px;
  object-fit: contain;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.16);
  padding: 10px;
}

.brand-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.hero-kicker {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.78);
}

.hero-title {
  margin: 4px 0 0;
  font-size: clamp(30px, 4vw, 44px);
  line-height: 1.05;
  font-weight: 900;
}

.hero-subtitle {
  max-width: 780px;
  margin: 18px 0 0;
  color: rgba(255, 255, 255, 0.92);
  font-size: 15px;
}

.actor-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}

.login-card {
  width: min(360px, 100%);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.96);
  color: #1d2b53;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3);
}

.portal-user-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.summary-card,
.workspace-card,
.billing-card,
.statement-summary-card,
.dialog-card {
  border-radius: 22px;
  box-shadow: 0 14px 28px rgba(17, 36, 80, 0.08);
}

.summary-card {
  background: #fff;
}

.workspace-card {
  background: rgba(255, 255, 255, 0.96);
}

.statement-summary-grid,
.billing-card-grid,
.invoice-summary-grid {
  display: grid;
  gap: 14px;
}

.statement-summary-grid,
.invoice-summary-grid {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.billing-card-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.section-headline {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.meta-label {
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #6c7b9d;
  font-weight: 700;
}

.meta-value {
  margin-top: 4px;
  color: #162646;
  font-weight: 800;
}

@media (max-width: 960px) {
  .portal-shell {
    width: min(1320px, calc(100vw - 20px));
  }

  .brand-row {
    align-items: flex-start;
  }
}

@media (max-width: 640px) {
  .student-portal-page {
    padding-top: 16px;
  }

  .portal-user-meta,
  .billing-card-grid {
    grid-template-columns: 1fr;
  }

  .hero-card :deep(.v-card-text),
  .workspace-card :deep(.v-card-text) {
    padding-left: 18px !important;
    padding-right: 18px !important;
  }
}
</style>
