import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type AnalyticsTone = 'green' | 'blue' | 'orange' | 'purple';

export type BillingStatCard = {
  title: string;
  value: string;
  subtitle: string;
  icon: string;
  tone: AnalyticsTone;
};

export type BillingAlert = {
  title: string;
  detail: string;
  time: string;
};

export type VerificationBillingStatus = 'Draft' | 'Active Billing' | 'Pending Payment' | 'Needs Correction';
export type ManagementLedgerStatus = 'Pending Payment' | 'Partially Paid' | 'Fully Paid' | 'Payment Failed';

export type BillingFeeItem = {
  id: number;
  feeCode: string;
  feeType: string;
  feeName: string;
  category: string;
  amount: number;
  amountFormatted: string;
  paidAmount: number;
  paidAmountFormatted: string;
  pendingAmount: number;
  pendingAmountFormatted: string;
  committedAmount: number;
  committedAmountFormatted: string;
  remainingAmount: number;
  remainingAmountFormatted: string;
  status: 'Paid' | 'Partially Paid' | 'Unpaid';
};

export type BillingFeeSummary = {
  totalFees: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
  committedAmount: number;
  committedAmountFormatted: string;
  finalizedAmount: number;
  finalizedAmountFormatted: string;
  remainingAmount: number;
  remainingAmountFormatted: string;
  label: string;
};

export type VerificationBillingItem = {
  id: number;
  reference: string;
  studentName: string;
  studentNumber: string;
  program: string;
  sourceModule: string;
  sourceDepartment: string;
  sourceCategory: string;
  amount: string;
  totalPaid: string;
  dueDate: string;
  status: VerificationBillingStatus;
  workflowStage: string;
  workflowStageLabel: string;
  note: string;
  feeItems: BillingFeeItem[];
  feeSummary: BillingFeeSummary | null;
};

export type ManagementLedgerItem = {
  id: number;
  billingCode: string;
  studentName: string;
  semester: string;
  category: string;
  sourceModule: string;
  sourceDepartment: string;
  sourceCategory: string;
  total: string;
  balance: string;
  status: ManagementLedgerStatus;
  workflowStage: string;
  workflowStageLabel: string;
  remarks: string;
  feeItems: BillingFeeItem[];
  feeSummary: BillingFeeSummary | null;
};

export type VerificationSnapshot = {
  stats: BillingStatCard[];
  items: VerificationBillingItem[];
  activityFeed: BillingAlert[];
};

export type ManagementSnapshot = {
  stats: BillingStatCard[];
  items: ManagementLedgerItem[];
  activityFeed: BillingAlert[];
};

type BillingActionResponse = {
  message: string;
  status?: string;
  workflow_stage?: string;
  next_module?: string;
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/student-billing`;
  return '/api/student-billing';
}

export async function fetchVerificationSnapshot(): Promise<VerificationSnapshot> {
  return await fetchApiData<VerificationSnapshot>(`${resolveApiUrl()}?view=verification`, { ttlMs: 8_000 });
}

export async function fetchManagementSnapshot(): Promise<ManagementSnapshot> {
  return await fetchApiData<ManagementSnapshot>(`${resolveApiUrl()}?view=management`, { ttlMs: 8_000 });
}

export async function runBillingAction(
  action: 'approve' | 'reject' | 'notify' | 'settle_full' | 'settle_partial' | 'mark_failed',
  billingId: number
): Promise<BillingActionResponse> {
  const data = await fetchApiData<BillingActionResponse>(resolveApiUrl(), {
    method: 'POST',
    body: {
      action,
      billingId
    }
  });

  invalidateApiCache('/api/student-billing');
  invalidateApiCache('/student-billing');
  invalidateApiCache('/api/process-payment');
  invalidateApiCache('/process-payment');
  invalidateApiCache('/api/generate-receipt');
  invalidateApiCache('/generate-receipt');
  invalidateApiCache('/api/payables');
  invalidateApiCache('/api/billings');
  invalidateApiCache('/api/dashboard/summary');
  invalidateApiCache('/api/dashboard/recent-activities');
  invalidateApiCache('/api/dashboard/alerts');
  invalidateApiCache('/api/notifications');
  invalidateApiCache('/api/audit-logs');
  return data;
}
