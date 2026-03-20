import { fetchApiData } from '@/services/apiClient';
import type { AnalyticsTone } from '@/services/studentBilling';

export type DepartmentHandoffStatCard = {
  title: string;
  value: string;
  subtitle: string;
  icon: string;
  tone: AnalyticsTone;
};

export type DepartmentServiceMatrixItem = {
  department: string;
  incomingToCashier: string[];
  outgoingFromCashier: string[];
  usage: string;
};

export type CashierDepartmentHandoffItem = {
  id: string;
  paymentId: number;
  billingId: number;
  consumerDepartment: string;
  consumerRole: string;
  channelType: 'Operational' | 'Reporting';
  sourceDepartment: string;
  sourceModule: string;
  sourceCategory: string;
  studentName: string;
  studentNumber: string;
  billingCode: string;
  paymentReference: string;
  amount: number;
  amountFormatted: string;
  paymentStatus: string;
  receiptNumber: string;
  receiptStatus: string;
  clearanceStatus: string;
  clearanceNote: string;
  handoffStatus: string;
  handoffReference: string;
  requestReference: string;
  outputs: string[];
  workflowStage: string;
  workflowStageLabel: string;
  integrationSummary: string;
  lastUpdatedAt: string;
  lastUpdatedLabel?: string;
};

export type CashierDepartmentHandoffSnapshot = {
  stats: DepartmentHandoffStatCard[];
  matrix: DepartmentServiceMatrixItem[];
  items: CashierDepartmentHandoffItem[];
  latestItems: CashierDepartmentHandoffItem[];
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(segment: string): string {
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/${segment}`;
  return `/api/${segment}`;
}

export async function fetchCashierDepartmentHandoffs(): Promise<CashierDepartmentHandoffSnapshot> {
  return await fetchApiData<CashierDepartmentHandoffSnapshot>(resolveApiUrl('cashier/department-handoffs'), {
    ttlMs: 8_000
  });
}
