import { fetchApiData, invalidateApiCache } from '@/services/apiClient';
import type { AnalyticsTone, BillingAlert } from '@/services/studentBilling';

export type PaymentStatus = 'Processing' | 'Authorized' | 'Paid' | 'Failed' | 'Cancelled';
export type ReceiptStatus = 'Receipt Pending' | 'Receipt Generated' | 'Proof Verified' | 'Documentation Completed';

export type FeeAllocationItem = {
  id: number;
  billingItemId: number;
  feeType: string;
  feeCode: string;
  category: string;
  allocatedAmount: number;
  allocatedAmountFormatted: string;
  allocationOrder: number;
  allocationStatus: string;
};

export type CashierStatCard = {
  title: string;
  value: string;
  subtitle: string;
  icon: string;
  tone: AnalyticsTone;
};

export type PaymentQueueItem = {
  id: number;
  reference: string;
  studentName: string;
  channel: string;
  amount: string;
  billingCode: string;
  status: PaymentStatus;
  workflowStage: string;
  workflowStageLabel: string;
  note: string;
  allocations: FeeAllocationItem[];
  allocationSummary: string;
  totalAllocated: string;
};

export type ReceiptQueueItem = {
  id: number;
  receiptNo: string;
  studentName: string;
  paymentRef: string;
  paymentMethod: string;
  paymentStatus: PaymentStatus;
  amount: string;
  issuedFor: string;
  status: ReceiptStatus;
  workflowStage: string;
  workflowStageLabel: string;
  note: string;
  receiptItems: Array<{
    id: number;
    billingItemId: number;
    feeType: string;
    allocatedAmount: number;
    allocatedAmountFormatted: string;
  }>;
  allocationSummary: string;
};

export type PaymentSnapshot = {
  stats: CashierStatCard[];
  items: PaymentQueueItem[];
  historyItems: PaymentQueueItem[];
  activityFeed: BillingAlert[];
};

export type ReceiptSnapshot = {
  stats: CashierStatCard[];
  items: ReceiptQueueItem[];
  historyItems: ReceiptQueueItem[];
  activityFeed: BillingAlert[];
};

type ActionResponse = {
  message: string;
  status?: string;
  workflow_stage?: string;
  next_module?: string;
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(segment: string): string {
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/${segment}`;
  return `/api/${segment}`;
}

export async function fetchPaymentSnapshot(): Promise<PaymentSnapshot> {
  return await fetchApiData<PaymentSnapshot>(resolveApiUrl('process-payment'), { ttlMs: 8_000 });
}

export async function runPaymentAction(action: 'authorize' | 'confirm' | 'cancel', paymentId: number): Promise<ActionResponse> {
  const data = await fetchApiData<ActionResponse>(resolveApiUrl('payment-gateway/process'), {
    method: 'POST',
    body: {
      action,
      paymentId
    }
  });

  invalidateApiCache('/api/process-payment');
  invalidateApiCache('/process-payment');
  invalidateApiCache('/api/generate-receipt');
  invalidateApiCache('/generate-receipt');
  invalidateApiCache('/api/student-billing');
  invalidateApiCache('/api/payment-transactions');
  invalidateApiCache('/api/receipts');
  invalidateApiCache('/api/reconciliation');
  invalidateApiCache('/api/reports/transactions');
  invalidateApiCache('/api/dashboard/summary');
  invalidateApiCache('/api/dashboard/recent-activities');
  invalidateApiCache('/api/dashboard/alerts');
  invalidateApiCache('/api/notifications');
  invalidateApiCache('/api/audit-logs');
  return data;
}

export async function fetchReceiptSnapshot(): Promise<ReceiptSnapshot> {
  return await fetchApiData<ReceiptSnapshot>(resolveApiUrl('generate-receipt'), { ttlMs: 8_000 });
}

export async function runReceiptAction(action: 'generate' | 'verify' | 'complete', paymentId: number): Promise<ActionResponse> {
  const data = await fetchApiData<ActionResponse>(resolveApiUrl('generate-receipt'), {
    method: 'POST',
    body: {
      action,
      paymentId
    }
  });

  invalidateApiCache('/api/generate-receipt');
  invalidateApiCache('/generate-receipt');
  invalidateApiCache('/api/receipts');
  invalidateApiCache('/api/reconciliation');
  invalidateApiCache('/api/reports/transactions');
  invalidateApiCache('/api/dashboard/summary');
  invalidateApiCache('/api/dashboard/recent-activities');
  invalidateApiCache('/api/dashboard/alerts');
  invalidateApiCache('/api/notifications');
  invalidateApiCache('/api/audit-logs');
  return data;
}
