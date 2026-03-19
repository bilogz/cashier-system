import { fetchApiData } from '@/services/apiClient';

export type ClinicSyncActivity = {
  id: number;
  module: string;
  action: string;
  detail: string;
  actor: string;
  entityKey: string | null;
  createdAt: string;
};

export type ClinicSyncStatus = {
  generatedAt: string;
  counters: {
    clinicOriginBillings: number;
    pendingCashierQueue: number;
    forwardedToPayBills: number;
    patientProfiles: number;
  };
  recentActivity: ClinicSyncActivity[];
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/clinic-sync/status`;
  return '/api/clinic-sync/status';
}

export async function fetchClinicSyncStatus(): Promise<ClinicSyncStatus> {
  return await fetchApiData<ClinicSyncStatus>(resolveApiUrl(), { ttlMs: 8_000 });
}
