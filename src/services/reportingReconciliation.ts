import { fetchApiData, invalidateApiCache } from '@/services/apiClient';
import type { AnalyticsTone, BillingAlert } from '@/services/studentBilling';

export type ReportingStatus = 'Logged' | 'Reconciled' | 'Reported' | 'Archived' | 'With Discrepancy';

export type ReportingStatCard = {
  title: string;
  value: string;
  subtitle: string;
  icon: string;
  tone: AnalyticsTone;
};

export type ReportingItem = {
  id: number;
  reference: string;
  studentName: string;
  amount: string;
  billingCode: string;
  receiptNumber: string;
  paymentStatus: string;
  documentStatus: string;
  status: ReportingStatus;
  workflowStage: string;
  workflowStageLabel: string;
  postedAt: string;
  allocationSummary?: string;
  allocations?: Array<{
    feeType: string;
    allocatedAmount: number;
    allocatedAmountFormatted: string;
  }>;
};

export type ReportingSnapshot = {
  stats: ReportingStatCard[];
  items: ReportingItem[];
  historyItems: ReportingItem[];
  activityFeed: BillingAlert[];
};

export type ReportingPaginationMeta = {
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

export type CompletedTransactionsResponse = {
  items: ReportingItem[];
  meta: ReportingPaginationMeta;
};

export type ReportingFilters = {
  search?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
};

type ActionResponse = {
  message: string;
  status?: string;
  workflow_stage?: string;
  next_module?: string;
};

type ReportingTransactionsApiRow = {
  id: number;
  referenceNumber: string;
  studentName: string;
  amountFormatted?: string;
  amount?: number;
  billingCode: string;
  receiptNumber: string;
  paymentStatus: string;
  documentationStatus: string;
  reportingStatus: ReportingStatus;
  workflowStage: string;
  workflowStageLabel: string;
  createdAt: string;
  allocationSummary?: string;
  allocations?: Array<{
    feeType: string;
    allocatedAmount: number;
    allocatedAmountFormatted: string;
  }>;
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/reporting-reconciliation`;
  return '/api/reporting-reconciliation';
}

function resolveReportsTransactionsUrl(query: string): string {
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/reports/transactions${query}`;
  return `/api/reports/transactions${query}`;
}

function resolveReportsExportUrl(query: string): string {
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/reports/export${query}`;
  return `/api/reports/export${query}`;
}

function mapReportingItem(item: ReportingTransactionsApiRow): ReportingItem {
  return {
    id: item.id,
    reference: item.referenceNumber,
    studentName: item.studentName,
    amount: item.amountFormatted || '',
    billingCode: item.billingCode,
    receiptNumber: item.receiptNumber,
    paymentStatus: item.paymentStatus,
    documentStatus: item.documentationStatus,
    status: item.reportingStatus,
    workflowStage: item.workflowStage,
    workflowStageLabel: item.workflowStageLabel,
    postedAt: item.createdAt,
    allocationSummary: item.allocationSummary,
    allocations: item.allocations
  };
}

function buildCompletedQuery(params: { page?: number; perPage?: number } & ReportingFilters) {
  const query = new URLSearchParams({
    workflow_stage: 'completed'
  });
  if (params.page) query.set('page', String(params.page));
  if (params.perPage) query.set('per_page', String(params.perPage));
  if (params.search?.trim()) query.set('search', params.search.trim());
  if (params.status?.trim()) query.set('status', params.status.trim());
  if (params.dateFrom?.trim()) query.set('date_from', params.dateFrom.trim());
  if (params.dateTo?.trim()) query.set('date_to', params.dateTo.trim());
  return query.toString();
}

export async function fetchReportingSnapshot(): Promise<ReportingSnapshot> {
  return await fetchApiData<ReportingSnapshot>(resolveApiUrl(), { ttlMs: 8_000 });
}

export async function fetchCompletedTransactions(params: {
  page: number;
  perPage: number;
} & ReportingFilters): Promise<CompletedTransactionsResponse> {
  const query = buildCompletedQuery(params);
  const data = await fetchApiData<{
    items: ReportingTransactionsApiRow[];
    meta: ReportingPaginationMeta;
  }>(resolveReportsTransactionsUrl(`?${query}`), {
    ttlMs: 8_000,
    cacheKey: `GET:/api/reports/transactions/completed:${query}`
  });

  return {
    items: data.items.map(mapReportingItem),
    meta: data.meta
  };
}

export async function exportCompletedTransactions(filters: ReportingFilters): Promise<{ filename: string; mimeType: string; content: string }> {
  const query = buildCompletedQuery(filters);
  return await fetchApiData<{ filename: string; mimeType: string; content: string }>(resolveReportsExportUrl(`?${query}`), {
    forceRefresh: true
  });
}

export async function runReportingAction(action: 'reconcile' | 'report' | 'archive', paymentId: number): Promise<ActionResponse> {
  const data = await fetchApiData<ActionResponse>(resolveApiUrl(), {
    method: 'POST',
    body: {
      action,
      paymentId
    }
  });

  invalidateApiCache('/api/reporting-reconciliation');
  invalidateApiCache('/reporting-reconciliation');
  invalidateApiCache('/api/bpa-dashboard');
  invalidateApiCache('/api/dashboard/summary');
  invalidateApiCache('/api/dashboard/recent-activities');
  invalidateApiCache('/api/dashboard/alerts');
  invalidateApiCache('/api/reconciliation');
  invalidateApiCache('/api/reports/transactions');
  invalidateApiCache('/api/reports/export');
  invalidateApiCache('/api/notifications');
  invalidateApiCache('/api/audit-logs');
  return data;
}
