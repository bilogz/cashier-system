import { fetchApiData } from '@/services/apiClient';
import { fetchAppointments, type AppointmentQuery, type AppointmentRow } from '@/services/appointmentsAdmin';

export type AppointmentBookedByRole = 'student' | 'teacher' | 'admin' | 'unknown';

export type AppointmentMonitorRow = {
  id: number;
  bookingId: string;
  patientName: string;
  doctorName: string;
  status: string;
  appointmentDate: string;
  preferredTime: string;
  bookedByRole: AppointmentBookedByRole;
  hasDoctorAssigned: boolean;
};

export type AppointmentMonitorSummary = {
  totalAppointments: number;
  studentAppointed: number;
  teacherAppointed: number;
  fullyAppointed: number;
  unassigned: number;
};

export type AppointmentMonitorPayload = {
  summary: AppointmentMonitorSummary;
  items: AppointmentMonitorRow[];
};

function normalizeRole(value: unknown): AppointmentBookedByRole {
  const role = String(value || '')
    .trim()
    .toLowerCase();
  if (role === 'student') return 'student';
  if (role === 'teacher') return 'teacher';
  if (role === 'admin') return 'admin';
  return 'unknown';
}

function normalizeMonitorRow(raw: Record<string, unknown>): AppointmentMonitorRow {
  const doctorName = String(raw.doctor_name || raw.teacher_name || '');
  return {
    id: Number(raw.id || 0),
    bookingId: String(raw.booking_id || ''),
    patientName: String(raw.patient_name || raw.student_name || ''),
    doctorName,
    status: String(raw.status || ''),
    appointmentDate: String(raw.appointment_date || ''),
    preferredTime: String(raw.preferred_time || ''),
    bookedByRole: normalizeRole(raw.actor_role || raw.appointed_by_role || raw.booked_by_role),
    hasDoctorAssigned: Boolean(String(doctorName || '').trim())
  };
}

function rowFromAppointment(item: AppointmentRow): AppointmentMonitorRow {
  return {
    id: item.id,
    bookingId: item.bookingId,
    patientName: item.patientName,
    doctorName: item.doctor,
    status: item.status,
    appointmentDate: item.scheduleDate,
    preferredTime: item.scheduleTime,
    bookedByRole: item.actorRole || 'unknown',
    hasDoctorAssigned: Boolean(String(item.doctor || '').trim())
  };
}

function buildSummary(items: AppointmentMonitorRow[]): AppointmentMonitorSummary {
  return items.reduce(
    (acc, item) => {
      acc.totalAppointments += 1;
      if (item.bookedByRole === 'student') acc.studentAppointed += 1;
      if (item.bookedByRole === 'teacher') acc.teacherAppointed += 1;
      if (item.hasDoctorAssigned) acc.fullyAppointed += 1;
      if (!item.hasDoctorAssigned) acc.unassigned += 1;
      return acc;
    },
    {
      totalAppointments: 0,
      studentAppointed: 0,
      teacherAppointed: 0,
      fullyAppointed: 0,
      unassigned: 0
    } as AppointmentMonitorSummary
  );
}

export function appointmentBookingRoleLabel(role: AppointmentBookedByRole): string {
  if (role === 'student') return 'Booked by Student';
  if (role === 'teacher') return 'Booked by Teacher';
  if (role === 'admin') return 'Booked by Admin';
  return 'Booked by Unknown';
}

export function appointmentBookingRoleColor(role: AppointmentBookedByRole): string {
  if (role === 'student') return 'primary';
  if (role === 'teacher') return 'success';
  if (role === 'admin') return 'warning';
  return 'secondary';
}

export async function fetchAppointmentMonitor(query: AppointmentQuery = {}): Promise<AppointmentMonitorPayload> {
  try {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      const mapped = key === 'perPage' ? 'per_page' : key;
      params.set(mapped, String(value));
    });
    const suffix = params.toString();
    const endpoint = suffix ? `/api/appointment-monitor?${suffix}` : '/api/appointment-monitor';
    const payload = await fetchApiData<{ summary?: AppointmentMonitorSummary; items?: Array<Record<string, unknown>> }>(endpoint, { ttlMs: 8_000 });
    const items = Array.isArray(payload.items) ? payload.items.map((item) => normalizeMonitorRow(item)) : [];
    return {
      summary: payload.summary || buildSummary(items),
      items
    };
  } catch {
    const data = await fetchAppointments(query);
    const items = data.items.map((item) => rowFromAppointment(item));
    return {
      summary: buildSummary(items),
      items
    };
  }
}
