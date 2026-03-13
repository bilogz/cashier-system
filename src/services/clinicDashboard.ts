import { fetchApiData } from '@/services/apiClient';

export type ClinicSummary = {
  totalPatients: number;
  totalAppointments: number;
  todayAppointments: number;
  pendingAppointments: number;
  completedToday: number;
  newPatientsThisMonth: number;
};

export type ClinicTrendPoint = {
  key: string;
  label: string;
  total: number;
};

export type ClinicBreakdown = {
  label: string;
  total: number;
};

export type UpcomingAppointment = {
  bookingId: string;
  patientName: string;
  doctorName: string;
  department: string;
  appointmentDate: string;
  preferredTime: string;
  status: string;
};

export type RecentPatient = {
  patientId: string;
  patientName: string;
  patientGender: string;
  createdAt: string;
};

export type ClinicDashboardPayload = {
  generatedAt: string;
  summary: ClinicSummary;
  appointmentsTrend: ClinicTrendPoint[];
  statusBreakdown: ClinicBreakdown[];
  departmentBreakdown: ClinicBreakdown[];
  upcomingAppointments: UpcomingAppointment[];
  recentPatients: RecentPatient[];
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const directApi = import.meta.env.VITE_DASHBOARD_API_URL?.trim();
  if (directApi) return trimTrailingSlashes(directApi);
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/dashboard`;
  return '/api/dashboard';
}

function fallbackPayload(): ClinicDashboardPayload {
  const now = new Date().toISOString();
  return {
    generatedAt: now,
    summary: {
      totalPatients: 0,
      totalAppointments: 0,
      todayAppointments: 0,
      pendingAppointments: 0,
      completedToday: 0,
      newPatientsThisMonth: 0
    },
    appointmentsTrend: [],
    statusBreakdown: [],
    departmentBreakdown: [],
    upcomingAppointments: [],
    recentPatients: []
  };
}

export async function fetchClinicDashboard(): Promise<ClinicDashboardPayload> {
  try {
    const data = await fetchApiData<ClinicDashboardPayload>(resolveApiUrl(), { ttlMs: 12_000 });
    return data || fallbackPayload();
  } catch {
    return fallbackPayload();
  }
}
