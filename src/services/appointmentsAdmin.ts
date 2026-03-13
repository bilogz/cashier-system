import { emitRealtimeRefresh } from '@/composables/useRealtimeListSync';
import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type AppointmentStatus = 'New' | 'Confirmed' | 'Pending' | 'Canceled' | 'Accepted' | 'Awaiting' | 'Appointed';

export type AppointmentRow = {
  id: number;
  bookingId: string;
  patientId: string;
  patientName: string;
  patientEmail: string;
  phoneNumber: string;
  emergencyContact: string;
  insuranceProvider: string;
  paymentMethod: string;
  appointmentPriority: 'Urgent' | 'Routine';
  service: string;
  department: string;
  doctor: string;
  scheduleDate: string;
  scheduleTime: string;
  status: AppointmentStatus;
  symptomsSummary: string;
  doctorNotes: string;
  visitReason: string;
  actorRole: 'student' | 'teacher' | 'admin' | 'unknown';
  createdAt: string;
  updatedAt: string;
};

export type AppointmentAnalytics = {
  totalPatients: number;
  totalAppointments: number;
  todayAppointments: number;
  pendingQueue: number;
};

export type AppointmentQuery = {
  search?: string;
  status?: string;
  service?: string;
  doctor?: string;
  period?: string;
  page?: number;
  perPage?: number;
};

export type AppointmentListPayload = {
  analytics: AppointmentAnalytics;
  items: AppointmentRow[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
};

type UpdateAppointmentPayload = {
  booking_id: string;
  status?: string;
  patient_id?: string;
  patient_name?: string;
  patient_email?: string;
  emergency_contact?: string;
  insurance_provider?: string;
  payment_method?: string;
  appointment_priority?: 'Urgent' | 'Routine';
  symptoms_summary?: string;
  doctor_notes?: string;
  doctor_name?: string;
  teacher_name?: string;
  department_name?: string;
  visit_type?: string;
  appointment_date?: string;
  preferred_time?: string;
  visit_reason?: string;
  actor_role?: 'student' | 'teacher' | 'admin';
};

export type CreateAppointmentPayload = {
  patient_id?: string;
  patient_name: string;
  student_name?: string;
  patient_email?: string;
  guardian_name?: string;
  phone_number: string;
  emergency_contact?: string;
  insurance_provider?: string;
  payment_method?: string;
  appointment_priority?: 'Urgent' | 'Routine';
  doctor_name: string;
  teacher_name?: string;
  department_name: string;
  visit_type: string;
  appointment_date: string;
  preferred_time?: string;
  symptoms_summary?: string;
  doctor_notes?: string;
  visit_reason?: string;
  patient_age?: number | null;
  patient_sex?: string;
  patient_gender?: string;
  status?: AppointmentStatus;
  actor_role?: 'student' | 'teacher' | 'admin';
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const directApi = import.meta.env.VITE_APPOINTMENTS_API_URL?.trim();
  if (directApi) {
    return trimTrailingSlashes(directApi);
  }

  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) {
    return `${trimTrailingSlashes(configured)}/appointments`;
  }

  // Frontend-only default: keep this module backend-agnostic (no PHP path binding).
  return '/api/appointments';
}

function buildUrl(query: AppointmentQuery = {}): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    const mapped = key === 'perPage' ? 'per_page' : key;
    params.set(mapped, String(value));
  });
  const suffix = params.toString();
  const base = resolveApiUrl();
  return suffix ? `${base}?${suffix}` : base;
}

function toStatus(value: string): AppointmentStatus {
  const lowered = value.trim().toLowerCase();
  if (lowered === 'new') return 'New';
  if (lowered === 'appointed') return 'Appointed';
  if (lowered === 'confirmed') return 'Confirmed';
  if (lowered === 'pending') return 'Pending';
  if (lowered === 'accepted') return 'Accepted';
  if (lowered === 'awaiting') return 'Awaiting';
  return 'Canceled';
}

function normalizeRow(item: Record<string, unknown>): AppointmentRow {
  return {
    id: Number(item.id || 0),
    bookingId: String(item.booking_id || ''),
    patientId: String(item.patient_id || item.student_id || ''),
    patientName: String(item.patient_name || item.student_name || ''),
    patientEmail: String(item.patient_email || item.student_email || ''),
    phoneNumber: String(item.phone_number || ''),
    emergencyContact: String(item.emergency_contact || ''),
    insuranceProvider: String(item.insurance_provider || ''),
    paymentMethod: String(item.payment_method || ''),
    appointmentPriority: (String(item.appointment_priority || 'Routine') as 'Urgent' | 'Routine'),
    service: String(item.service_name || item.visit_type || ''),
    department: String(item.department_name || ''),
    doctor: String(item.doctor_name || item.teacher_name || ''),
    scheduleDate: String(item.appointment_date || ''),
    scheduleTime: String(item.preferred_time || ''),
    status: toStatus(String(item.status || 'Pending')),
    symptomsSummary: String(item.symptoms_summary || ''),
    doctorNotes: String(item.doctor_notes || ''),
    visitReason: String(item.visit_reason || ''),
    actorRole: ((): 'student' | 'teacher' | 'admin' | 'unknown' => {
      const role = String(item.actor_role || item.appointed_by_role || item.booked_by_role || '')
        .trim()
        .toLowerCase();
      if (role === 'student') return 'student';
      if (role === 'teacher') return 'teacher';
      if (role === 'admin') return 'admin';
      return 'unknown';
    })(),
    createdAt: String(item.created_at || ''),
    updatedAt: String(item.updated_at || '')
  };
}

function invalidateAppointmentCaches(): void {
  invalidateApiCache(resolveApiUrl());
  invalidateApiCache('/api/dashboard');
  invalidateApiCache('/api/reports');
  invalidateApiCache('/api/patients');
}

export async function fetchAppointments(query: AppointmentQuery = {}): Promise<AppointmentListPayload> {
  const data = await fetchApiData<{
    analytics: AppointmentAnalytics;
    items: Record<string, unknown>[];
    meta: { page: number; perPage: number; total: number; totalPages: number };
  }>(buildUrl(query), { ttlMs: 12_000 });

  return {
    analytics: data.analytics || { totalPatients: 0, totalAppointments: 0, todayAppointments: 0, pendingQueue: 0 },
    items: Array.isArray(data.items) ? data.items.map((row) => normalizeRow(row)) : [],
    meta: data.meta || { page: 1, perPage: 10, total: 0, totalPages: 1 }
  };
}

export async function updateAppointment(payload: UpdateAppointmentPayload): Promise<AppointmentRow> {
  const parsed = await fetchApiData<Record<string, unknown>>(resolveApiUrl(), {
    method: 'POST',
    body: {
      action: 'update',
      workflow_scope: 'student_teacher',
      ...payload
    }
  });
  const updated = normalizeRow(parsed);
  invalidateAppointmentCaches();
  emitRealtimeRefresh('appointment_updated');
  return updated;
}

export async function createAppointment(payload: CreateAppointmentPayload): Promise<AppointmentRow> {
  const parsed = await fetchApiData<Record<string, unknown>>(resolveApiUrl(), {
    method: 'POST',
    body: {
      action: 'create',
      workflow_scope: 'student_teacher',
      student_name: payload.student_name || payload.patient_name,
      teacher_name: payload.teacher_name || payload.doctor_name,
      ...payload
    }
  });
  const created = normalizeRow(parsed);
  invalidateAppointmentCaches();
  emitRealtimeRefresh('appointment_created');
  return created;
}
