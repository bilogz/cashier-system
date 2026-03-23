import { fetchApiData } from '@/services/apiClient';

export type DashboardSummaryCard = {
  key: string;
  title: string;
  subtitle: string;
  value: string;
  icon: string;
  cardClass: string;
};

export type DashboardModuleCard = {
  title: string;
  description: string;
  icon: string;
  accent: string;
  statusSummary: string;
  actionLabel: string;
  actionTo: string;
};

export type DashboardTransactionRow = {
  referenceNumber: string;
  studentName: string;
  amount: string;
  status: string;
  date: string;
};

export type BpaDashboardSnapshot = {
  summaryCards: DashboardSummaryCard[];
  moduleCards: DashboardModuleCard[];
  recentTransactions: DashboardTransactionRow[];
};

export type DashboardChartPoint = {
  date: string;
  total: number;
  totalFormatted: string;
  transactions: number;
};

export type DashboardStatusBreakdown = {
  status: string;
  total: number;
};

export type DashboardChartsSnapshot = {
  dailyCollection: DashboardChartPoint[];
  paymentStatusBreakdown: DashboardStatusBreakdown[];
};

export type DashboardActivityItem = {
  id: number;
  actorName: string | null;
  actorRole: string | null;
  module: string;
  entityType: string;
  entityId: number;
  action: string;
  beforeStatus: string | null;
  afterStatus: string | null;
  remarks: string | null;
  createdAt: string | null;
  relativeTime: string;
};

export type DashboardAlertItem = {
  id: string;
  severity: string;
  title: string;
  detail: string;
  entityType: string | null;
  entityId: number | string | null;
  createdAt: string | null;
};

export type DashboardHrEmployee = {
  id: number;
  name: string;
  role: string;
  department: string;
};

export type DashboardHrRequestItem = {
  id: number;
  requestReference: string;
  employeeId: number | null;
  employeeName: string;
  employeeDepartment: string;
  requestType: string;
  details: string;
  status: string;
  requestedBy: string;
  targetDepartment: string;
  createdAt: string;
  createdAtLabel: string;
  createdAtRelative: string;
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/dashboard/summary`;
  return '/api/dashboard/summary';
}

export async function fetchBpaDashboardSnapshot(): Promise<BpaDashboardSnapshot> {
  return await fetchApiData<BpaDashboardSnapshot>(resolveApiUrl(), { ttlMs: 8_000 });
}

export async function fetchDashboardRecentActivities(): Promise<{ items: DashboardActivityItem[] }> {
  return await fetchApiData<{ items: DashboardActivityItem[] }>('/api/dashboard/recent-activities', { ttlMs: 8_000 });
}

export async function fetchDashboardAlerts(): Promise<{ items: DashboardAlertItem[] }> {
  return await fetchApiData<{ items: DashboardAlertItem[] }>('/api/dashboard/alerts', { ttlMs: 8_000 });
}

export async function fetchDashboardCharts(): Promise<DashboardChartsSnapshot> {
  return await fetchApiData<DashboardChartsSnapshot>('/api/dashboard/charts', { ttlMs: 8_000 });
}

export async function fetchDashboardHrRequestsSnapshot(): Promise<{
  employees: DashboardHrEmployee[];
  requests: DashboardHrRequestItem[];
}> {
  return await fetchApiData<{ employees: DashboardHrEmployee[]; requests: DashboardHrRequestItem[] }>('/api/dashboard/hr-requests', { ttlMs: 5_000 });
}

export async function createDashboardHrRequest(payload: {
  employeeId?: number | null;
  employeeName: string;
  requestType: string;
  details?: string;
}): Promise<{ requestReference: string; message?: string }> {
  return await fetchApiData<{ requestReference: string; message?: string }>('/api/dashboard/hr-requests', {
    method: 'POST',
    body: payload
  });
}
