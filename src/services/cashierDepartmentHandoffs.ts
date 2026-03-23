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

function resolveLocalApiUrl(segment: string): string {
  return `/api/${segment}`;
}

export async function fetchCashierDepartmentHandoffs(): Promise<CashierDepartmentHandoffSnapshot> {
  const configuredUrl = resolveApiUrl('cashier/department-handoffs');
  try {
    return await fetchApiData<CashierDepartmentHandoffSnapshot>(configuredUrl, {
      ttlMs: 8_000
    });
  } catch (error) {
    const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
    const message = error instanceof Error ? error.message : String(error);
    const shouldRetryLocally =
      Boolean(configured) &&
      /authentication required|admin authentication required|html instead of json|request failed \(500\)/i.test(message);

    if (!shouldRetryLocally) throw error;

    return await fetchApiData<CashierDepartmentHandoffSnapshot>(resolveLocalApiUrl('cashier/department-handoffs'), {
      ttlMs: 8_000,
      forceRefresh: true
    });
  }
}
