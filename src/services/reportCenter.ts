import { fetchApiData, invalidateApiCache } from '@/services/apiClient';
import type { AnalyticsTone, BillingAlert } from '@/services/studentBilling';

export type ReportCenterStatCard = {
  title: string;
  value: string;
  subtitle: string;
  icon: string;
  tone: AnalyticsTone;
};

export type PmedReportRequestItem = {
  id: number;
  requestReference: string;
  reportName: string;
  reportType: string;
  targetDepartment: string;
  requestedBy: string;
  requestedAt: string;
  requestedAtLabel?: string;
  requestedAtRelative?: string;
  detail: string;
  planReference: string;
  status: string;
};

export type ReadyCashierReportItem = {
  id: number;
  reference: string;
  studentName: string;
  amount: string;
  rawAmount: number;
  billingCode: string;
  receiptNumber: string;
  paymentMethod: string;
  paymentStatus: string;
  sourceDepartment: string;
  sourceCategory: string;
  postedAt: string;
};

export type ReportCenterCandidateItem = ReadyCashierReportItem & {
  status: string;
  workflowStage: string;
  workflowStageLabel: string;
};

export type SentPmedReportItem = {
  id: number;
  reportReference: string;
  requestReference: string;
  paymentReference: string;
  billingCode: string;
  studentName: string;
  amount: string;
  status: string;
  reportName: string;
  sentAt: string;
  sentAtLabel?: string;
  sentAtRelative?: string;
  actor: string;
};

export type ReportCenterSnapshot = {
  stats: ReportCenterStatCard[];
  requests: PmedReportRequestItem[];
  candidateItems: ReportCenterCandidateItem[];
  readyItems: ReadyCashierReportItem[];
  sentItems: SentPmedReportItem[];
  activityFeed: BillingAlert[];
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(segment: string): string {
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/${segment}`;
  return `/api/${segment}`;
}

export async function fetchReportCenterSnapshot(forceRefresh = false): Promise<ReportCenterSnapshot> {
  return await fetchApiData<ReportCenterSnapshot>(resolveApiUrl('report-center'), { ttlMs: 8_000, forceRefresh });
}

export function invalidateReportCenterCaches(): void {
  invalidateApiCache('/api/report-center');
  invalidateApiCache('/report-center');
  invalidateApiCache('/api/reporting-reconciliation');
  invalidateApiCache('/reporting-reconciliation');
  invalidateApiCache('/api/reports/transactions');
  invalidateApiCache('/api/notifications');
}
