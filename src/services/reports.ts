import { fetchApiData } from '@/services/apiClient';

export type ReportsKpis = {
  totalPatients: number;
  activeProfiles: number;
  highRiskPatients: number;
  totalVisits: number;
  pendingQueue: number;
  emergencyCases: number;
  dispensedItems: number;
};

export type ReportsModuleTotal = {
  module: string;
  total: number;
};

export type ReportsTrendRow = {
  day: string;
  appointments: number;
  walkin: number;
  checkup: number;
  mental: number;
  pharmacy: number;
};

export type ReportsActivityRow = {
  module: string;
  action: string;
  detail: string;
  actor: string;
  created_at: string;
};

export type ReportsSnapshot = {
  window: { from: string; to: string };
  kpis: ReportsKpis;
  moduleTotals: ReportsModuleTotal[];
  dailyTrend: ReportsTrendRow[];
  recentActivity: ReportsActivityRow[];
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const directApi = import.meta.env.VITE_REPORTS_API_URL?.trim();
  if (directApi) return trimTrailingSlashes(directApi);
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/reports`;
  return '/api/reports';
}

export async function fetchReportsSnapshot(filters: { from?: string; to?: string } = {}): Promise<ReportsSnapshot> {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const url = `${resolveApiUrl()}${params.toString() ? `?${params.toString()}` : ''}`;
  return await fetchApiData<ReportsSnapshot>(url, { ttlMs: 12_000 });
}
