<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { EyeIcon, EditIcon, TrashIcon } from 'vue-tabler-icons';
import SaasDateTimePickerField from '@/components/shared/SaasDateTimePickerField.vue';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';
import { REALTIME_POLICY } from '@/config/realtimePolicy';
import {
  deleteDoctorAvailability,
  fetchDoctorAvailability,
  listDoctorAvailability,
  upsertDoctorAvailability,
  type DoctorAvailabilityScheduleRow,
  type DoctorAvailabilitySnapshot
} from '@/services/doctorAvailability';
import { listDoctors, upsertDoctor, type DoctorRow } from '@/services/doctors';
import {
  createAppointment,
  fetchAppointments,
  updateAppointment,
  type CreateAppointmentPayload,
  type AppointmentAnalytics,
  type AppointmentRow,
  type AppointmentStatus
} from '@/services/appointmentsAdmin';
import {
  appointmentBookingRoleColor,
  appointmentBookingRoleLabel,
  fetchAppointmentMonitor,
  type AppointmentBookedByRole,
  type AppointmentMonitorRow,
  type AppointmentMonitorSummary
} from '@/services/appointmentMonitor';

const loading = ref(false);
const saving = ref(false);
const addSaving = ref(false);
const realtime = useRealtimeListSync();

const statusFilter = ref('All Statuses');
const serviceFilter = ref('All Services');
const doctorFilter = ref('Doctor: Any');
const assignmentFilter = ref('Booked By: Any');
const periodFilter = ref('Period: Upcoming');
const searchValue = ref('');

const page = ref(1);
const perPage = 8;

const statusOptions = ['All Statuses', 'New', 'Appointed', 'Confirmed', 'Pending', 'Accepted', 'Awaiting', 'Canceled'];
const assignmentOptions = ['Booked By: Any', 'Booked By Student', 'Booked By Teacher', 'Booked By Admin', 'Booked By Unknown'];
const periodOptions = ['Period: Upcoming', 'Today', 'This Week', 'This Month'];
const appointmentStatusOptions: AppointmentStatus[] = ['New', 'Appointed', 'Pending', 'Confirmed', 'Accepted', 'Awaiting', 'Canceled'];
const departmentOptions = ['General Medicine', 'Pediatrics', 'Orthopedic', 'Dental', 'Laboratory', 'Mental Health', 'Check-Up'];
const paymentOptions = ['Cash', 'Card', 'HMO', 'Online'];
const priorityOptions: Array<'Routine' | 'Urgent'> = ['Routine', 'Urgent'];
const bookedByOptions = [
  { title: 'Student', value: 'student' as const },
  { title: 'Teacher', value: 'teacher' as const }
];
const symptomTags = ['Fever', 'Cough', 'Headache', 'Chest Pain', 'Abdominal Pain', 'Dizziness', 'Back Pain', 'Nausea'];
const dayOfWeekOptions = [
  { title: 'Sunday', value: 0 },
  { title: 'Monday', value: 1 },
  { title: 'Tuesday', value: 2 },
  { title: 'Wednesday', value: 3 },
  { title: 'Thursday', value: 4 },
  { title: 'Friday', value: 5 },
  { title: 'Saturday', value: 6 }
];
const rows = ref<AppointmentRow[]>([]);
const analytics = ref<AppointmentAnalytics>({
  totalPatients: 0,
  totalAppointments: 0,
  todayAppointments: 0,
  pendingQueue: 0
});
const totalItems = ref(0);
const totalPages = ref(1);
const monitorSummary = ref<AppointmentMonitorSummary>({
  totalAppointments: 0,
  studentAppointed: 0,
  teacherAppointed: 0,
  fullyAppointed: 0,
  unassigned: 0
});
const monitorByBookingId = ref<Record<string, AppointmentMonitorRow>>({});

const viewDialog = ref(false);
const editDialog = ref(false);
const addDialog = ref(false);
const addAvailabilityLoading = ref(false);
const addDoctorAvailability = ref<DoctorAvailabilitySnapshot | null>(null);
const availabilityRows = ref<DoctorAvailabilityScheduleRow[]>([]);
const availabilityLoading = ref(false);
const availabilitySaving = ref(false);
const availabilityDialog = ref(false);
const doctorDialog = ref(false);
const doctorSaving = ref(false);
const doctorsLoading = ref(false);
const doctorsCatalog = ref<DoctorRow[]>([]);
const availabilityDeleteDialog = ref(false);
const availabilityDeleteTarget = ref<DoctorAvailabilityScheduleRow | null>(null);
const availabilityFilterDoctor = ref('All Doctors');
const availabilityFilterDepartment = ref('All Departments');
const availabilityFormErrors = reactive<Record<string, string>>({});
const availabilityForm = reactive({
  id: 0,
  doctor_name: '',
  department_name: 'General Medicine',
  day_of_week: 1,
  start_time: '',
  end_time: '',
  max_appointments: 8,
  is_active: true
});
const doctorFormErrors = reactive<Record<string, string>>({});
const doctorForm = reactive({
  doctor_name: '',
  department_name: 'General Medicine',
  specialization: '',
  is_active: true
});
const feedbackDialog = ref(false);
const feedbackTitle = ref('Success');
const feedbackMessage = ref('');
const feedbackVariant = ref<'success' | 'error'>('success');
const selected = ref<AppointmentRow | null>(null);
const editForm = reactive({
  doctorName: '',
  service: '',
  date: '',
  time: '',
  status: 'Pending' as AppointmentStatus,
  reason: ''
});

const addForm = reactive<CreateAppointmentPayload>({
  patient_id: '',
  patient_name: '',
  patient_email: '',
  phone_number: '',
  emergency_contact: '',
  insurance_provider: '',
  payment_method: 'Cash',
  appointment_priority: 'Routine',
  doctor_name: '',
  department_name: '',
  visit_type: '',
  appointment_date: '',
  preferred_time: '',
  symptoms_summary: '',
  doctor_notes: '',
  visit_reason: '',
  patient_age: null,
  patient_gender: '',
  status: 'New'
});
const addFormErrors = reactive<Record<string, string>>({});
const useExistingPatient = ref(false);
const patientLookupKey = ref('');
const selectedSymptomTags = ref<string[]>([]);
const addBookedByRole = ref<'student' | 'teacher'>('student');
const addBookerLabel = computed(() => (addBookedByRole.value === 'teacher' ? 'Teacher' : 'Student'));

const serviceOptions = computed(() => {
  const dynamic = Array.from(new Set(rows.value.map((row) => row.service).filter(Boolean))).sort();
  return ['All Services', ...dynamic];
});

const doctorOptions = computed(() => {
  const fromRows = rows.value.map((row) => row.doctor).filter(Boolean);
  const fromCatalog = doctorsCatalog.value.filter((row) => row.isActive).map((row) => row.doctorName);
  const dynamic = Array.from(new Set([...fromRows, ...fromCatalog])).sort();
  return ['Doctor: Any', ...dynamic];
});

const activeQuickFilters = computed(() => {
  const chips: string[] = [];
  if (statusFilter.value !== 'All Statuses') chips.push(statusFilter.value);
  if (serviceFilter.value !== 'All Services') chips.push(serviceFilter.value);
  if (doctorFilter.value !== 'Doctor: Any') chips.push(doctorFilter.value);
  if (assignmentFilter.value !== 'Booked By: Any') chips.push(assignmentFilter.value);
  if (periodFilter.value !== 'Period: Upcoming') chips.push(periodFilter.value);
  return chips;
});

const cardData = computed(() => [
  { title: 'BOOKED BY STUDENT', value: monitorSummary.value.studentAppointed, subtitle: 'Appointments created by students', className: 'analytics-card-green', icon: 'mdi-account-school-outline' },
  { title: 'BOOKED BY TEACHER', value: monitorSummary.value.teacherAppointed, subtitle: 'Appointments created by teachers', className: 'analytics-card-blue', icon: 'mdi-account-tie-outline' },
  { title: 'DOCTOR ASSIGNED', value: monitorSummary.value.fullyAppointed, subtitle: 'Appointments with assigned doctor', className: 'analytics-card-orange', icon: 'mdi-check-decagram-outline' },
  { title: 'NO DOCTOR YET', value: monitorSummary.value.unassigned, subtitle: 'Appointments missing doctor assignment', className: 'analytics-card-purple', icon: 'mdi-alert-circle-outline' }
]);

function bookedByRole(item: AppointmentRow): AppointmentBookedByRole {
  const mapped = monitorByBookingId.value[item.bookingId]?.bookedByRole;
  if (mapped) return mapped;
  return item.actorRole || 'unknown';
}

function assignmentLabel(item: AppointmentRow): string {
  return appointmentBookingRoleLabel(bookedByRole(item));
}

function assignmentColor(item: AppointmentRow): string {
  return appointmentBookingRoleColor(bookedByRole(item));
}

const displayRows = computed(() =>
  rows.value.filter((item) => {
    if (assignmentFilter.value === 'Booked By: Any') return true;
    const role = bookedByRole(item);
    if (assignmentFilter.value === 'Booked By Student') return role === 'student';
    if (assignmentFilter.value === 'Booked By Teacher') return role === 'teacher';
    if (assignmentFilter.value === 'Booked By Admin') return role === 'admin';
    return role === 'unknown';
  })
);

function toApiPeriod(value: string): string {
  const lowered = value.toLowerCase();
  if (lowered.includes('today')) return 'Today';
  if (lowered.includes('this week')) return 'This Week';
  if (lowered.includes('this month')) return 'This Month';
  return 'Upcoming';
}

function formatDate(dateValue: string): string {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return dateValue || '--';
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' }).format(date);
}

function toInputDate(dateValue: string): string {
  if (!dateValue) return '';
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) {
    const raw = String(dateValue).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
  }
  const utc = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return utc.toISOString().slice(0, 10);
}

function statusColor(status: AppointmentStatus): string {
  const lowered = status.toLowerCase();
  if (lowered === 'appointed' || lowered === 'confirmed' || lowered === 'accepted') return 'success';
  if (lowered === 'pending' || lowered === 'awaiting') return 'warning';
  return 'error';
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function dayOfWeekLabel(value: number): string {
  return dayOfWeekOptions.find((item) => item.value === value)?.title || `Day ${value}`;
}

const existingPatientOptions = computed(() => {
  const seen = new Set<string>();
  return rows.value
    .map((row) => {
      const pid = row.patientId || '';
      const key = pid || `${row.patientName}|${row.phoneNumber}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        title: pid ? `${row.patientName} (${pid})` : `${row.patientName} (${row.phoneNumber})`,
        value: key,
        row
      };
    })
    .filter((item): item is { title: string; value: string; row: AppointmentRow } => Boolean(item));
});

function normalizeDepartment(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const doctorOptionsForDepartment = computed(() => {
  const departmentKey = normalizeDepartment(addForm.department_name || '');
  const catalogList = doctorsCatalog.value
    .filter((item) => item.isActive && normalizeDepartment(item.departmentName) === departmentKey)
    .map((item) => item.doctorName);
  return Array.from(new Set(catalogList)).sort();
});
const hasAddDepartmentDoctors = computed(() => doctorOptionsForDepartment.value.length > 0);
const addDoctorSelectHint = computed(() =>
  hasAddDepartmentDoctors.value
    ? 'Only doctors assigned to selected department are listed.'
    : `No doctor assigned yet for ${addForm.department_name || 'this department'}.`
);

const addAvailableTimeOptions = computed(() => {
  if (!addDoctorAvailability.value) return [] as string[];
  const recommended = addDoctorAvailability.value.recommendedTimes || [];
  if (recommended.length) return recommended;
  return (addDoctorAvailability.value.slots || [])
    .filter((slot) => slot.isOpen)
    .map((slot) => `${slot.startTime}`);
});

const doctorAvailabilityFilterOptions = computed(() => {
  const doctorSet = new Set<string>();
  doctorsCatalog.value.forEach((item) => {
    if (item.isActive && item.doctorName) doctorSet.add(item.doctorName);
  });
  rows.value.forEach((row) => {
    if (row.doctor) doctorSet.add(row.doctor);
  });
  availabilityRows.value.forEach((row) => {
    if (row.doctorName) doctorSet.add(row.doctorName);
  });
  return ['All Doctors', ...Array.from(doctorSet).sort()];
});

const filteredAvailabilityRows = computed(() =>
  availabilityRows.value.filter((row) => {
    if (availabilityFilterDoctor.value !== 'All Doctors' && row.doctorName !== availabilityFilterDoctor.value) return false;
    if (availabilityFilterDepartment.value !== 'All Departments' && row.departmentName !== availabilityFilterDepartment.value) return false;
    return true;
  })
);

async function loadAppointments(options: { silent?: boolean } = {}): Promise<void> {
  if (!options.silent) {
    loading.value = true;
  }
  try {
    const query = {
      search: searchValue.value.trim(),
      status: statusFilter.value === 'All Statuses' ? '' : statusFilter.value,
      service: serviceFilter.value === 'All Services' ? '' : serviceFilter.value,
      doctor: doctorFilter.value === 'Doctor: Any' ? '' : doctorFilter.value,
      period: toApiPeriod(periodFilter.value),
      page: page.value,
      perPage
    };
    const [payload, monitor] = await Promise.all([fetchAppointments(query), fetchAppointmentMonitor(query)]);
    rows.value = payload.items;
    analytics.value = payload.analytics;
    totalItems.value = payload.meta.total;
    totalPages.value = payload.meta.totalPages;
    monitorSummary.value = monitor.summary;
    monitorByBookingId.value = monitor.items.reduce<Record<string, AppointmentMonitorRow>>((acc, row) => {
      if (row.bookingId) acc[row.bookingId] = row;
      return acc;
    }, {});
  } catch (error) {
    if (!options.silent) {
      showFeedback('error', 'Loading failed', error instanceof Error ? error.message : String(error));
    }
  } finally {
    if (!options.silent) {
      loading.value = false;
    }
  }
}

async function loadAddDoctorAvailability(): Promise<void> {
  if (!addDialog.value) return;
  const doctorName = String(addForm.doctor_name || '').trim();
  const departmentName = String(addForm.department_name || '').trim();
  const appointmentDate = String(addForm.appointment_date || '').trim();
  if (!doctorName || !departmentName || !appointmentDate) {
    addDoctorAvailability.value = null;
    return;
  }
  addAvailabilityLoading.value = true;
  try {
    addDoctorAvailability.value = await fetchDoctorAvailability({
      doctorName,
      departmentName,
      appointmentDate,
      preferredTime: String(addForm.preferred_time || '').trim() || undefined
    });
  } catch (error) {
    addDoctorAvailability.value = {
      doctorName,
      departmentName,
      appointmentDate,
      isDoctorAvailable: false,
      reason: error instanceof Error ? error.message : String(error),
      slots: [],
      recommendedTimes: []
    };
  } finally {
    addAvailabilityLoading.value = false;
  }
}

function resetAvailabilityForm(): void {
  Object.keys(availabilityFormErrors).forEach((key) => {
    availabilityFormErrors[key] = '';
  });
  availabilityForm.id = 0;
  availabilityForm.doctor_name = '';
  availabilityForm.department_name = 'General Medicine';
  availabilityForm.day_of_week = 1;
  availabilityForm.start_time = '';
  availabilityForm.end_time = '';
  availabilityForm.max_appointments = 8;
  availabilityForm.is_active = true;
}

function openAddAvailabilityDialog(): void {
  resetAvailabilityForm();
  availabilityForm.doctor_name = doctorAvailabilityFilterOptions.value.find((name) => name !== 'All Doctors') || '';
  availabilityDialog.value = true;
}

function openEditAvailabilityDialog(row: DoctorAvailabilityScheduleRow): void {
  resetAvailabilityForm();
  availabilityForm.id = row.id;
  availabilityForm.doctor_name = row.doctorName;
  availabilityForm.department_name = row.departmentName;
  availabilityForm.day_of_week = row.dayOfWeek;
  availabilityForm.start_time = row.startTime;
  availabilityForm.end_time = row.endTime;
  availabilityForm.max_appointments = row.maxAppointments;
  availabilityForm.is_active = row.isActive;
  availabilityDialog.value = true;
}

async function loadAvailabilityRows(): Promise<void> {
  availabilityLoading.value = true;
  try {
    availabilityRows.value = await listDoctorAvailability();
  } catch (error) {
    showFeedback('error', 'Doctor availability failed', error instanceof Error ? error.message : String(error));
  } finally {
    availabilityLoading.value = false;
  }
}

async function loadDoctorsCatalog(): Promise<void> {
  doctorsLoading.value = true;
  try {
    doctorsCatalog.value = await listDoctors({ includeInactive: true });
  } catch (error) {
    showFeedback('error', 'Doctors load failed', error instanceof Error ? error.message : String(error));
  } finally {
    doctorsLoading.value = false;
  }
}

function resetDoctorForm(): void {
  Object.keys(doctorFormErrors).forEach((key) => {
    doctorFormErrors[key] = '';
  });
  doctorForm.doctor_name = '';
  doctorForm.department_name = 'General Medicine';
  doctorForm.specialization = '';
  doctorForm.is_active = true;
}

function openDoctorDialog(): void {
  resetDoctorForm();
  doctorDialog.value = true;
}

async function saveDoctor(): Promise<void> {
  Object.keys(doctorFormErrors).forEach((key) => {
    doctorFormErrors[key] = '';
  });
  if (!String(doctorForm.doctor_name || '').trim()) doctorFormErrors.doctor_name = 'Doctor name is required.';
  if (!String(doctorForm.department_name || '').trim()) doctorFormErrors.department_name = 'Department is required.';
  if (Object.values(doctorFormErrors).some(Boolean)) return;

  doctorSaving.value = true;
  try {
    const saved = await upsertDoctor({
      doctorName: String(doctorForm.doctor_name || '').trim(),
      departmentName: String(doctorForm.department_name || '').trim(),
      specialization: String(doctorForm.specialization || '').trim(),
      isActive: Boolean(doctorForm.is_active),
      actor: 'Admin'
    });
    doctorDialog.value = false;
    await loadDoctorsCatalog();
    if (saved.isActive && !availabilityForm.doctor_name) {
      availabilityForm.doctor_name = saved.doctorName;
    }
    showFeedback('success', 'Doctor saved', `${saved.doctorName} is now available in doctor lists.`);
  } catch (error) {
    showFeedback('error', 'Save doctor failed', error instanceof Error ? error.message : String(error));
  } finally {
    doctorSaving.value = false;
  }
}

async function saveAvailabilityRow(): Promise<void> {
  Object.keys(availabilityFormErrors).forEach((key) => {
    availabilityFormErrors[key] = '';
  });
  if (!String(availabilityForm.doctor_name || '').trim()) availabilityFormErrors.doctor_name = 'Doctor name is required.';
  if (!String(availabilityForm.department_name || '').trim()) availabilityFormErrors.department_name = 'Department is required.';
  if (!String(availabilityForm.start_time || '').trim()) availabilityFormErrors.start_time = 'Start time is required.';
  if (!String(availabilityForm.end_time || '').trim()) availabilityFormErrors.end_time = 'End time is required.';
  if (Number(availabilityForm.max_appointments || 0) <= 0) availabilityFormErrors.max_appointments = 'Max appointments must be at least 1.';
  if (
    String(availabilityForm.start_time || '').trim() &&
    String(availabilityForm.end_time || '').trim() &&
    String(availabilityForm.start_time).slice(0, 5) >= String(availabilityForm.end_time).slice(0, 5)
  ) {
    availabilityFormErrors.end_time = 'End time must be later than start time.';
  }
  if (Object.values(availabilityFormErrors).some(Boolean)) {
    return;
  }

  availabilitySaving.value = true;
  try {
    const editingExisting = Number(availabilityForm.id || 0) > 0;
    const existingRow = editingExisting ? availabilityRows.value.find((row) => row.id === availabilityForm.id) : null;
    const nextSignature = [
      String(availabilityForm.doctor_name || '').trim().toLowerCase(),
      String(availabilityForm.department_name || '').trim().toLowerCase(),
      Number(availabilityForm.day_of_week),
      String(availabilityForm.start_time || '').slice(0, 5),
      String(availabilityForm.end_time || '').slice(0, 5)
    ].join('|');
    const prevSignature = existingRow
      ? [existingRow.doctorName.toLowerCase(), existingRow.departmentName.toLowerCase(), existingRow.dayOfWeek, existingRow.startTime, existingRow.endTime].join('|')
      : '';

    await upsertDoctorAvailability({
      doctorName: String(availabilityForm.doctor_name || '').trim(),
      departmentName: String(availabilityForm.department_name || '').trim(),
      dayOfWeek: Number(availabilityForm.day_of_week),
      startTime: String(availabilityForm.start_time || '').slice(0, 5),
      endTime: String(availabilityForm.end_time || '').slice(0, 5),
      maxAppointments: Number(availabilityForm.max_appointments || 8),
      isActive: Boolean(availabilityForm.is_active),
      actor: 'Admin'
    });
    if (editingExisting && existingRow && prevSignature !== nextSignature) {
      await deleteDoctorAvailability(existingRow.id, 'Admin');
    }
    availabilityDialog.value = false;
    await loadAvailabilityRows();
    showFeedback('success', 'Doctor availability updated', 'Schedule configuration has been saved.');
  } catch (error) {
    showFeedback('error', 'Save failed', error instanceof Error ? error.message : String(error));
  } finally {
    availabilitySaving.value = false;
  }
}

function openDeleteAvailabilityDialog(row: DoctorAvailabilityScheduleRow): void {
  availabilityDeleteTarget.value = row;
  availabilityDeleteDialog.value = true;
}

async function removeAvailabilityRow(): Promise<void> {
  const row = availabilityDeleteTarget.value;
  if (!row) return;
  availabilitySaving.value = true;
  try {
    await deleteDoctorAvailability(row.id, 'Admin');
    availabilityDeleteDialog.value = false;
    availabilityDeleteTarget.value = null;
    await loadAvailabilityRows();
    showFeedback('success', 'Schedule deleted', 'Doctor availability row has been removed.');
  } catch (error) {
    showFeedback('error', 'Delete failed', error instanceof Error ? error.message : String(error));
  } finally {
    availabilitySaving.value = false;
  }
}

function showFeedback(variant: 'success' | 'error', title: string, message: string): void {
  feedbackVariant.value = variant;
  feedbackTitle.value = title;
  feedbackMessage.value = message;
  feedbackDialog.value = true;
}

function clearFilters(): void {
  statusFilter.value = 'All Statuses';
  serviceFilter.value = 'All Services';
  doctorFilter.value = 'Doctor: Any';
  assignmentFilter.value = 'Booked By: Any';
  periodFilter.value = 'Period: Upcoming';
  searchValue.value = '';
  page.value = 1;
  void loadAppointments();
}

function openView(item: AppointmentRow): void {
  selected.value = item;
  viewDialog.value = true;
}

function openEdit(item: AppointmentRow): void {
  selected.value = item;
  editForm.doctorName = item.doctor;
  editForm.service = item.service;
  editForm.date = toInputDate(item.scheduleDate);
  editForm.time = item.scheduleTime;
  editForm.status = item.status;
  editForm.reason = item.visitReason || '';
  editDialog.value = true;
}

function openAddDialog(): void {
  Object.keys(addFormErrors).forEach((key) => {
    addFormErrors[key] = '';
  });
  useExistingPatient.value = false;
  addBookedByRole.value = 'student';
  patientLookupKey.value = '';
  selectedSymptomTags.value = [];
  addForm.patient_id = '';
  addForm.patient_name = '';
  addForm.patient_email = '';
  addForm.phone_number = '';
  addForm.emergency_contact = '';
  addForm.insurance_provider = '';
  addForm.payment_method = 'Cash';
  addForm.appointment_priority = 'Routine';
  addForm.department_name = 'General Medicine';
  addForm.doctor_name = doctorOptionsForDepartment.value[0] || '';
  addForm.visit_type = 'General Check-Up';
  addForm.appointment_date = toInputDate(new Date().toISOString());
  addForm.preferred_time = '';
  addForm.symptoms_summary = '';
  addForm.doctor_notes = '';
  addForm.visit_reason = '';
  addForm.patient_age = null;
  addForm.patient_gender = '';
  addForm.status = 'New';
  addDialog.value = true;
  void loadAddDoctorAvailability();
}

async function saveEdit(): Promise<void> {
  if (!selected.value) return;
  saving.value = true;
  try {
    await updateAppointment({
      booking_id: selected.value.bookingId,
      doctor_name: editForm.doctorName,
      patient_name: selected.value.patientName,
      patient_email: selected.value.patientEmail,
      visit_type: editForm.service,
      appointment_date: editForm.date,
      preferred_time: editForm.time,
      status: editForm.status,
      visit_reason: editForm.reason,
      actor_role: 'admin'
    });
    showFeedback('success', 'Appointment updated', 'Appointment updated successfully.');
    editDialog.value = false;
    await loadAppointments();
  } catch (error) {
    showFeedback('error', 'Update failed', error instanceof Error ? error.message : String(error));
  } finally {
    saving.value = false;
  }
}

async function markReschedule(item: AppointmentRow): Promise<void> {
  saving.value = true;
  try {
    await updateAppointment({
      booking_id: item.bookingId,
      status: 'Pending',
      actor_role: 'admin'
    });
    showFeedback('success', 'Reschedule queued', 'Appointment moved to pending queue for reschedule.');
    await loadAppointments();
  } catch (error) {
    showFeedback('error', 'Reschedule failed', error instanceof Error ? error.message : String(error));
  } finally {
    saving.value = false;
  }
}

async function saveAdd(): Promise<void> {
  Object.keys(addFormErrors).forEach((key) => {
    addFormErrors[key] = '';
  });

  const phone = String(addForm.phone_number || '').trim();
  const isPhoneValid = /^[0-9+\-\s()]{7,20}$/.test(phone);
  if (!String(addForm.patient_name || '').trim()) addFormErrors.patient_name = `${addBookerLabel.value} name is required.`;
  if (!phone) addFormErrors.phone_number = 'Phone number is required.';
  else if (!isPhoneValid) addFormErrors.phone_number = 'Enter a valid phone number.';
  if (!String(addForm.department_name || '').trim()) addFormErrors.department_name = 'Department is required.';
  if (!hasAddDepartmentDoctors.value) addFormErrors.doctor_name = `No doctor is assigned to ${addForm.department_name || 'selected department'}.`;
  else if (!String(addForm.doctor_name || '').trim()) addFormErrors.doctor_name = 'Doctor is required.';
  if (!String(addForm.visit_type || '').trim()) addFormErrors.visit_type = 'Visit type is required.';
  if (!String(addForm.appointment_date || '').trim()) addFormErrors.appointment_date = 'Appointment date is required.';
  if (!String(addForm.status || '').trim()) addFormErrors.status = 'Status is required.';
  if (useExistingPatient.value && !String(addForm.patient_id || '').trim()) {
    addFormErrors.patient_id = `${addBookerLabel.value} ID is required for existing ${addBookerLabel.value.toLowerCase()} lookup.`;
  }
  if (addForm.appointment_priority === 'Urgent' && !String(addForm.emergency_contact || '').trim()) {
    addFormErrors.emergency_contact = 'Emergency contact is required for urgent appointments.';
  }

  if (Object.values(addFormErrors).some(Boolean)) {
    showFeedback('error', 'Validation failed', 'Please fix highlighted fields before saving.');
    return;
  }
  if (!addDoctorAvailability.value?.isDoctorAvailable) {
    addFormErrors.preferred_time = addDoctorAvailability.value?.reason || 'Selected doctor is not available for this date/time.';
    showFeedback('error', 'Doctor unavailable', addFormErrors.preferred_time);
    return;
  }

  addForm.symptoms_summary = [selectedSymptomTags.value.join(', '), String(addForm.visit_reason || '').trim()].filter(Boolean).join(' | ');
  addSaving.value = true;
  try {
    await createAppointment({
      ...addForm,
      student_name: addForm.patient_name,
      actor_role: addBookedByRole.value
    });
    addDialog.value = false;
    showFeedback('success', 'Appointment created', 'New appointment has been added successfully.');
    await loadAppointments();
  } catch (error) {
    showFeedback('error', 'Create failed', error instanceof Error ? error.message : String(error));
  } finally {
    addSaving.value = false;
  }
}

function applyExistingPatientLookup(value: string): void {
  patientLookupKey.value = value;
  const target = existingPatientOptions.value.find((item) => item.value === value);
  if (!target) return;
  const row = target.row;
  addForm.patient_id = row.patientId || '';
  addForm.patient_name = row.patientName;
  addForm.patient_email = row.patientEmail || '';
  addForm.phone_number = row.phoneNumber || '';
}

function onDepartmentChange(value: string): void {
  const doctors = doctorsCatalog.value
    .filter((item) => item.isActive && normalizeDepartment(item.departmentName) === normalizeDepartment(value))
    .map((item) => item.doctorName);
  if (!doctors.length) {
    addForm.doctor_name = '';
    return;
  }
  if (!doctors.includes(String(addForm.doctor_name || ''))) {
    addForm.doctor_name = doctors[0];
  }
}

watch(
  () => addForm.department_name,
  (value) => {
    if (!value) return;
    onDepartmentChange(value);
    void loadAddDoctorAvailability();
  }
);

watch(
  () => [addForm.doctor_name, addForm.appointment_date, addForm.preferred_time, addDialog.value],
  () => {
    if (!addDialog.value) return;
    void loadAddDoctorAvailability();
  }
);

watch([statusFilter, serviceFilter, doctorFilter, assignmentFilter, periodFilter], () => {
  page.value = 1;
  void loadAppointments();
});

watch(page, () => {
  void loadAppointments();
});

onMounted(() => {
  void loadAppointments();
  void loadDoctorsCatalog();
  void loadAvailabilityRows();
  realtime.startPolling(() => {
    void loadAppointments({ silent: true });
  }, REALTIME_POLICY.polling.registrationMs);
});

onBeforeUnmount(() => {
  realtime.stopPolling();
  realtime.invalidatePending();
});
</script>

<template>
  <section class="appointments-page">
    <v-card class="hero-banner mb-4" elevation="0">
      <v-card-text class="pa-5">
        <div class="d-flex flex-wrap align-center justify-space-between ga-4">
          <div>
            <div class="hero-kicker">Clinical Operations</div>
            <h1 class="text-h4 font-weight-black mb-1">Appointment Monitoring</h1>
            <p class="hero-subtitle mb-0">Students and teachers can book appointments; monitor booking source and doctor assignment end-to-end.</p>
          </div>
        </div>
      </v-card-text>
    </v-card>

    <v-row class="mb-4">
      <v-col v-for="card in cardData" :key="card.title" cols="12" sm="6" lg="3">
        <v-card :class="['analytics-card', card.className]" elevation="0">
          <v-card-text class="pa-5">
            <div class="d-flex justify-space-between align-start">
              <div class="analytics-card-title">{{ card.title }}</div>
              <v-btn icon size="small" variant="outlined" class="analytics-card-icon">
                <v-icon :icon="card.icon" size="18" />
              </v-btn>
            </div>
            <div class="analytics-card-value">{{ card.value }}</div>
            <div class="analytics-card-subtitle">{{ card.subtitle }}</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-card rounded="xl" variant="flat">
      <v-card-text class="pa-4 pa-md-5">
        <div class="d-flex flex-wrap ga-3 mb-3">
          <v-select v-model="statusFilter" :items="statusOptions" density="comfortable" variant="outlined" hide-details class="filter-field" />
          <v-select v-model="serviceFilter" :items="serviceOptions" density="comfortable" variant="outlined" hide-details class="filter-field" />
          <v-select v-model="doctorFilter" :items="doctorOptions" density="comfortable" variant="outlined" hide-details class="filter-field" />
          <v-select v-model="assignmentFilter" :items="assignmentOptions" density="comfortable" variant="outlined" hide-details class="filter-field" />
          <v-select v-model="periodFilter" :items="periodOptions" density="comfortable" variant="outlined" hide-details class="filter-field" />
          <v-text-field
            v-model="searchValue"
            density="comfortable"
            variant="outlined"
            hide-details
            prepend-inner-icon="mdi-magnify"
            placeholder="Search student name, email, phone..."
            class="search-field"
            @keyup.enter="loadAppointments"
          />
        </div>

        <div class="d-flex flex-wrap justify-space-between align-center ga-3 mb-6">
          <div class="d-flex flex-wrap ga-2">
            <v-chip
              v-for="chip in activeQuickFilters"
              :key="chip"
              color="primary"
              variant="tonal"
              rounded="lg"
              class="font-weight-medium"
            >
              {{ chip }}
            </v-chip>
          </div>

          <div class="d-flex flex-wrap ga-2">
            <v-btn variant="outlined" color="secondary" rounded="pill" class="saas-outline-btn" prepend-icon="mdi-filter-off-outline" @click="clearFilters">Clear Filters</v-btn>
            <v-btn color="primary" rounded="pill" class="saas-primary-btn" prepend-icon="mdi-refresh" :loading="loading" @click="loadAppointments">Reload</v-btn>
          </div>
        </div>

        <div class="d-flex justify-space-between align-center mb-2 ga-2 flex-wrap">
          <h2 class="text-h5 font-weight-bold">Appointments</h2>
          <div class="d-flex align-center ga-2 flex-wrap">
            <p class="text-body-2 text-medium-emphasis mb-0">Showing {{ displayRows.length }} of {{ totalItems }}</p>
            <v-btn color="primary" prepend-icon="mdi-plus" rounded="pill" class="saas-primary-btn" @click="openAddDialog">Add Appointment</v-btn>
          </div>
        </div>

        <v-table class="appointment-table" density="comfortable">
          <thead>
            <tr>
              <th>BOOKER</th>
              <th>SERVICE</th>
              <th>DOCTOR</th>
              <th>SCHEDULE</th>
              <th>STATUS</th>
              <th>BOOKED BY</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in displayRows" :key="item.id">
              <td>
                <div class="d-flex align-center ga-3">
                  <v-avatar color="blue-grey-lighten-4" size="38">
                    <span class="text-caption font-weight-bold">{{ initials(item.patientName) }}</span>
                  </v-avatar>
                  <div>
                    <div class="font-weight-bold text-body-2">{{ item.patientName }}</div>
                    <div class="text-caption text-medium-emphasis">{{ item.patientEmail || item.phoneNumber }}</div>
                  </div>
                </div>
              </td>
              <td class="text-body-2">{{ item.service }}</td>
              <td class="text-body-2">{{ item.doctor }}</td>
              <td>
                <div class="text-body-2 font-weight-medium">{{ formatDate(item.scheduleDate) }}</div>
                <div class="text-caption text-medium-emphasis">{{ item.scheduleTime || '--' }}</div>
              </td>
              <td>
                <v-chip :color="statusColor(item.status)" variant="tonal" rounded="pill" size="small">
                  {{ item.status }}
                </v-chip>
              </td>
              <td>
                <v-chip :color="assignmentColor(item)" variant="tonal" rounded="pill" size="small">
                  {{ assignmentLabel(item) }}
                </v-chip>
              </td>
              <td>
                <div class="d-flex flex-wrap ga-2 align-center">
                  <v-btn icon size="small" class="saas-icon-btn" color="primary" variant="tonal" @click="openView(item)">
                    <EyeIcon class="action-icon action-icon-view" size="16" stroke-width="2.2" />
                  </v-btn>
                  <v-btn icon size="small" class="saas-icon-btn" color="indigo" variant="tonal" @click="openEdit(item)">
                    <EditIcon class="action-icon action-icon-edit" size="16" stroke-width="2.2" />
                  </v-btn>
                  <v-btn size="small" color="error" variant="flat" rounded="pill" class="saas-danger-btn" append-icon="mdi-chevron-down" @click="markReschedule(item)">Reschedule</v-btn>
                </div>
              </td>
            </tr>
            <tr v-if="displayRows.length === 0">
              <td colspan="7" class="text-center py-6 text-medium-emphasis">No appointments found for current filters.</td>
            </tr>
          </tbody>
        </v-table>

        <div class="d-flex flex-wrap justify-space-between align-center ga-3 mt-4">
          <p class="text-body-2 text-medium-emphasis">Showing {{ displayRows.length }} of {{ totalItems }}</p>
          <v-pagination v-model="page" :length="totalPages" :total-visible="7" rounded="circle" />
        </div>
      </v-card-text>
    </v-card>

    <v-card rounded="xl" variant="flat" class="mt-5">
      <v-card-item>
        <v-card-title class="text-h6 font-weight-bold">Doctor Availability Management</v-card-title>
        <v-card-subtitle>Configure weekly doctor schedules used by student and teacher booking validation.</v-card-subtitle>
        <template #append>
          <div class="d-flex ga-2">
            <v-btn variant="outlined" rounded="pill" class="saas-outline-btn" :loading="availabilityLoading" prepend-icon="mdi-refresh" @click="loadAvailabilityRows">Refresh</v-btn>
            <v-btn variant="outlined" rounded="pill" class="saas-outline-btn" prepend-icon="mdi-account-plus-outline" :loading="doctorsLoading" @click="openDoctorDialog">Add Doctor</v-btn>
            <v-btn color="primary" rounded="pill" class="saas-primary-btn" prepend-icon="mdi-plus" @click="openAddAvailabilityDialog">Add Schedule</v-btn>
          </div>
        </template>
      </v-card-item>
      <v-card-text class="pt-2">
        <v-row class="mb-2">
          <v-col cols="12" md="6">
            <v-select
              v-model="availabilityFilterDoctor"
              :items="doctorAvailabilityFilterOptions"
              density="comfortable"
              variant="outlined"
              hide-details
              label="Doctor Filter"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-select
              v-model="availabilityFilterDepartment"
              :items="['All Departments', ...departmentOptions]"
              density="comfortable"
              variant="outlined"
              hide-details
              label="Department Filter"
            />
          </v-col>
        </v-row>

        <v-table density="comfortable" class="availability-table">
          <thead>
            <tr>
              <th>TEACHER</th>
              <th>DEPARTMENT</th>
              <th>DAY</th>
              <th>TIME WINDOW</th>
              <th>CAPACITY</th>
              <th>STATUS</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in filteredAvailabilityRows" :key="item.id">
              <td>{{ item.doctorName }}</td>
              <td>{{ item.departmentName }}</td>
              <td>{{ dayOfWeekLabel(item.dayOfWeek) }}</td>
              <td>{{ item.startTime }} - {{ item.endTime }}</td>
              <td>{{ item.maxAppointments }}</td>
              <td>
                <v-chip size="small" :color="item.isActive ? 'success' : 'warning'" variant="tonal">{{ item.isActive ? 'Active' : 'Inactive' }}</v-chip>
              </td>
              <td>
                <div class="d-flex ga-2">
                  <v-btn icon size="small" class="saas-icon-btn" color="indigo" variant="tonal" @click="openEditAvailabilityDialog(item)">
                    <EditIcon class="action-icon action-icon-edit" size="16" stroke-width="2.2" />
                  </v-btn>
                  <v-btn icon size="small" class="saas-icon-btn saas-icon-btn-danger" color="error" variant="tonal" :loading="availabilitySaving" @click="openDeleteAvailabilityDialog(item)">
                    <TrashIcon class="action-icon action-icon-delete" size="16" stroke-width="2.2" />
                  </v-btn>
                </div>
              </td>
            </tr>
            <tr v-if="!availabilityLoading && filteredAvailabilityRows.length === 0">
              <td colspan="7" class="text-center py-5 text-medium-emphasis">No doctor availability rows found.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>

    <ModuleActivityLogs module="appointments" title="Module Activity Logs" :per-page="8" />

    <v-dialog v-model="viewDialog" max-width="600">
        <v-card class="saas-modal-card">
          <v-card-title class="saas-modal-title text-h6 font-weight-bold">Appointment Details</v-card-title>
          <v-card-text v-if="selected">
            <div><strong>Booking ID:</strong> {{ selected.bookingId }}</div>
            <div><strong>Booker ID:</strong> {{ selected.patientId || '--' }}</div>
            <div><strong>Booker:</strong> {{ selected.patientName }}</div>
            <div><strong>Email:</strong> {{ selected.patientEmail || '--' }}</div>
            <div><strong>Phone:</strong> {{ selected.phoneNumber || '--' }}</div>
            <div><strong>Emergency Contact:</strong> {{ selected.emergencyContact || '--' }}</div>
            <div><strong>Service:</strong> {{ selected.service }}</div>
            <div><strong>Doctor:</strong> {{ selected.doctor }}</div>
            <div><strong>Priority:</strong> {{ selected.appointmentPriority || 'Routine' }}</div>
            <div><strong>Date:</strong> {{ formatDate(selected.scheduleDate) }}</div>
            <div><strong>Time:</strong> {{ selected.scheduleTime || '--' }}</div>
            <div><strong>Status:</strong> {{ selected.status }}</div>
            <div><strong>Assignment:</strong> {{ assignmentLabel(selected) }}</div>
            <div><strong>Symptoms:</strong> {{ selected.symptomsSummary || '--' }}</div>
            <div><strong>Doctor Notes:</strong> {{ selected.doctorNotes || '--' }}</div>
            <div><strong>Appointment Concern:</strong> {{ selected.visitReason || '--' }}</div>
          </v-card-text>
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="viewDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="editDialog" max-width="700">
      <v-card class="saas-modal-card">
        <v-card-title class="saas-modal-title text-h6 font-weight-bold">Edit Appointment</v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" md="6"><v-text-field v-model="editForm.doctorName" label="Doctor" variant="outlined" density="comfortable" hide-details /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="editForm.service" label="Service" variant="outlined" density="comfortable" hide-details /></v-col>
            <v-col cols="12" md="6"><SaasDateTimePickerField v-model="editForm.date" mode="date" label="Date" /></v-col>
            <v-col cols="12" md="6"><SaasDateTimePickerField v-model="editForm.time" mode="time" label="Preferred Time" clearable /></v-col>
            <v-col cols="12" md="6"><v-select v-model="editForm.status" :items="appointmentStatusOptions" label="Status" variant="outlined" density="comfortable" /></v-col>
            <v-col cols="12"><v-textarea v-model="editForm.reason" label="Visit Reason" rows="3" variant="outlined" density="comfortable" /></v-col>
          </v-row>
        </v-card-text>
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="editDialog = false">Cancel</v-btn>
          <v-btn color="primary" rounded="pill" class="saas-primary-btn" :loading="saving" @click="saveEdit">Save Changes</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="addDialog" max-width="840">
      <v-card class="saas-modal-card">
        <v-card-title class="saas-modal-title text-h6 font-weight-bold">Add Appointment</v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12"><div class="modal-section-title">Booker Info</div></v-col>
            <v-col cols="12" md="4">
              <v-select
                v-model="addBookedByRole"
                :items="bookedByOptions"
                item-title="title"
                item-value="value"
                label="Booked By *"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
            <v-col cols="12" md="5">
              <v-switch v-model="useExistingPatient" inset color="primary" :label="`Existing ${addBookerLabel} Lookup`" hide-details />
            </v-col>
            <v-col cols="12" md="7" v-if="useExistingPatient">
              <v-select
                :items="existingPatientOptions"
                item-title="title"
                item-value="value"
                :model-value="patientLookupKey"
                :label="`Search Existing ${addBookerLabel}`"
                variant="outlined"
                density="comfortable"
                :hint="`Select ${addBookerLabel.toLowerCase()} from previous appointment records`"
                persistent-hint
                @update:model-value="applyExistingPatientLookup"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model="addForm.patient_id"
                :label="`${addBookerLabel} ID`"
                variant="outlined"
                density="comfortable"
                :error-messages="addFormErrors.patient_id"
                :hint="`Required if using existing ${addBookerLabel.toLowerCase()} flow`"
                persistent-hint
              />
            </v-col>
            <v-col cols="12" md="8">
              <v-text-field v-model="addForm.patient_name" :label="`${addBookerLabel} Name *`" variant="outlined" density="comfortable" :error-messages="addFormErrors.patient_name" />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model="addForm.phone_number" label="Phone Number *" variant="outlined" density="comfortable" :error-messages="addFormErrors.phone_number" />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model="addForm.emergency_contact" label="Emergency / Contact Person" variant="outlined" density="comfortable" :error-messages="addFormErrors.emergency_contact" />
            </v-col>
            <v-col cols="12" md="6"><v-text-field v-model="addForm.patient_email" :label="`${addBookerLabel} Email`" variant="outlined" density="comfortable" /></v-col>
            <v-col cols="12" md="3"><v-text-field v-model.number="addForm.patient_age" type="number" min="0" :label="`${addBookerLabel} Age`" variant="outlined" density="comfortable" /></v-col>
            <v-col cols="12" md="3"><v-select v-model="addForm.patient_gender" :items="['Male', 'Female', 'Other']" :label="`${addBookerLabel} Gender`" variant="outlined" density="comfortable" /></v-col>

            <v-col cols="12"><div class="modal-section-title">Appointment Details</div></v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="addForm.department_name"
                :items="departmentOptions"
                label="Department *"
                variant="outlined"
                density="comfortable"
                :error-messages="addFormErrors.department_name"
                hint="Doctor list depends on selected department"
                persistent-hint
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="addForm.doctor_name"
                :items="doctorOptionsForDepartment"
                label="Doctor *"
                variant="outlined"
                density="comfortable"
                :disabled="!hasAddDepartmentDoctors"
                :hint="addDoctorSelectHint"
                persistent-hint
                :error-messages="addFormErrors.doctor_name"
              />
            </v-col>
            <v-col cols="12" v-if="!hasAddDepartmentDoctors">
              <v-alert type="warning" variant="tonal" density="comfortable">
                No doctors are currently assigned to {{ addForm.department_name || 'this department' }}.
              </v-alert>
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model="addForm.visit_type" label="Visit Type *" variant="outlined" density="comfortable" :error-messages="addFormErrors.visit_type" hint="Example: Follow-up, General Check-Up" persistent-hint />
            </v-col>
            <v-col cols="12" md="6">
              <v-select v-model="addForm.appointment_priority" :items="priorityOptions" label="Appointment Priority" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="12" md="4">
              <SaasDateTimePickerField v-model="addForm.appointment_date" mode="date" label="Appointment Date *" :error-messages="addFormErrors.appointment_date" />
            </v-col>
            <v-col cols="12" md="4">
              <SaasDateTimePickerField
                v-model="addForm.preferred_time"
                mode="time"
                label="Preferred Time"
                :loading="addAvailabilityLoading"
                :allowed-times="addAvailableTimeOptions"
                :error-messages="addFormErrors.preferred_time"
                hint="Time options are based on doctor availability."
                persistent-hint
                clearable
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-select v-model="addForm.status" :items="appointmentStatusOptions" label="Appointment Status *" variant="outlined" density="comfortable" :error-messages="addFormErrors.status" />
            </v-col>
            <v-col cols="12" v-if="addDoctorAvailability">
              <v-alert :type="addDoctorAvailability.isDoctorAvailable ? 'success' : 'warning'" variant="tonal" density="comfortable">
                {{ addDoctorAvailability.reason }}
              </v-alert>
            </v-col>

            <v-col cols="12"><div class="modal-section-title">Medical Info</div></v-col>
            <v-col cols="12" md="6"><v-select v-model="addForm.payment_method" :items="paymentOptions" label="Payment Method" variant="outlined" density="comfortable" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="addForm.insurance_provider" label="Insurance Provider / Plan" variant="outlined" density="comfortable" /></v-col>
            <v-col cols="12">
              <v-combobox
                v-model="selectedSymptomTags"
                :items="symptomTags"
                chips
                multiple
                clearable
                label="Symptoms / Chief Complaint (Structured)"
                variant="outlined"
                density="comfortable"
                hint="Pick common symptoms and add custom tags if needed"
                persistent-hint
              />
            </v-col>
            <v-col cols="12"><v-textarea v-model="addForm.visit_reason" label="Chief Complaint Details" rows="2" variant="outlined" density="comfortable" /></v-col>
            <v-col cols="12"><v-textarea v-model="addForm.doctor_notes" label="Notes for Doctor" rows="2" variant="outlined" density="comfortable" /></v-col>
          </v-row>
        </v-card-text>
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="addDialog = false">Cancel</v-btn>
          <v-btn color="primary" rounded="pill" class="saas-primary-btn" :loading="addSaving" @click="saveAdd">Create Appointment</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="availabilityDialog" max-width="760">
      <v-card class="saas-modal-card">
        <v-card-title class="saas-modal-title text-h6 font-weight-bold">
          {{ availabilityForm.id ? 'Edit Doctor Availability' : 'Add Doctor Availability' }}
        </v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" md="6">
              <v-combobox
                v-model="availabilityForm.doctor_name"
                :items="doctorAvailabilityFilterOptions.filter((item) => item !== 'All Doctors')"
                label="Doctor Name *"
                variant="outlined"
                density="comfortable"
                :error-messages="availabilityFormErrors.doctor_name"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="availabilityForm.department_name"
                :items="departmentOptions"
                label="Department *"
                variant="outlined"
                density="comfortable"
                :error-messages="availabilityFormErrors.department_name"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-select
                v-model="availabilityForm.day_of_week"
                :items="dayOfWeekOptions"
                item-title="title"
                item-value="value"
                label="Day of Week *"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
            <v-col cols="12" md="4">
              <SaasDateTimePickerField
                v-model="availabilityForm.start_time"
                mode="time"
                label="Start Time *"
                :error-messages="availabilityFormErrors.start_time"
              />
            </v-col>
            <v-col cols="12" md="4">
              <SaasDateTimePickerField
                v-model="availabilityForm.end_time"
                mode="time"
                label="End Time *"
                :error-messages="availabilityFormErrors.end_time"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model.number="availabilityForm.max_appointments"
                type="number"
                min="1"
                label="Max Appointments *"
                variant="outlined"
                density="comfortable"
                :error-messages="availabilityFormErrors.max_appointments"
              />
            </v-col>
            <v-col cols="12" md="6" class="d-flex align-center">
              <v-switch v-model="availabilityForm.is_active" color="success" inset label="Schedule is active" hide-details />
            </v-col>
          </v-row>
        </v-card-text>
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="availabilityDialog = false">Cancel</v-btn>
          <v-btn color="primary" rounded="pill" class="saas-primary-btn" :loading="availabilitySaving" @click="saveAvailabilityRow">
            Save Schedule
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="doctorDialog" max-width="680">
      <v-card class="saas-modal-card">
        <v-card-title class="saas-modal-title text-h6 font-weight-bold">Add Doctor</v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="doctorForm.doctor_name"
                label="Doctor Name *"
                variant="outlined"
                density="comfortable"
                :error-messages="doctorFormErrors.doctor_name"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="doctorForm.department_name"
                :items="departmentOptions"
                label="Department *"
                variant="outlined"
                density="comfortable"
                :error-messages="doctorFormErrors.department_name"
              />
            </v-col>
            <v-col cols="12">
              <v-text-field
                v-model="doctorForm.specialization"
                label="Specialization"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
            <v-col cols="12">
              <v-switch v-model="doctorForm.is_active" inset color="success" label="Doctor is active" hide-details />
            </v-col>
          </v-row>
        </v-card-text>
        <v-card-actions class="justify-end">
          <v-btn variant="text" :disabled="doctorSaving" @click="doctorDialog = false">Cancel</v-btn>
          <v-btn color="primary" rounded="pill" class="saas-primary-btn" :loading="doctorSaving" @click="saveDoctor">Save Doctor</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="availabilityDeleteDialog" max-width="520">
      <v-card class="saas-modal-card">
        <v-card-title class="saas-modal-title text-h6 font-weight-bold">Delete Doctor Availability</v-card-title>
        <v-card-text class="pt-5" v-if="availabilityDeleteTarget">
          <p class="text-body-1 mb-3">
            Remove this schedule row from doctor availability?
          </p>
          <div class="delete-review-grid">
            <article><label>Doctor</label><strong>{{ availabilityDeleteTarget.doctorName }}</strong></article>
            <article><label>Department</label><strong>{{ availabilityDeleteTarget.departmentName }}</strong></article>
            <article><label>Day</label><strong>{{ dayOfWeekLabel(availabilityDeleteTarget.dayOfWeek) }}</strong></article>
            <article><label>Time</label><strong>{{ availabilityDeleteTarget.startTime }} - {{ availabilityDeleteTarget.endTime }}</strong></article>
          </div>
        </v-card-text>
        <v-card-actions class="justify-end">
          <v-btn variant="text" :disabled="availabilitySaving" @click="availabilityDeleteDialog = false; availabilityDeleteTarget = null">Cancel</v-btn>
          <v-btn color="error" rounded="pill" class="saas-danger-btn" :loading="availabilitySaving" @click="removeAvailabilityRow">
            Delete Row
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="feedbackDialog" max-width="430">
      <v-card class="saas-modal-card feedback-card">
        <v-card-text class="pa-6">
          <div class="d-flex flex-column align-center text-center ga-3">
            <v-avatar :color="feedbackVariant === 'success' ? 'success' : 'error'" size="56" variant="tonal">
              <v-icon :icon="feedbackVariant === 'success' ? 'mdi-check-bold' : 'mdi-alert-circle-outline'" size="30" />
            </v-avatar>
            <h3 class="text-h6 font-weight-bold mb-0">{{ feedbackTitle }}</h3>
            <p class="text-body-2 text-medium-emphasis mb-0">{{ feedbackMessage }}</p>
            <v-btn color="primary" rounded="pill" class="saas-primary-btn mt-1" @click="feedbackDialog = false">Okay</v-btn>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.hero-banner {
  border-radius: 16px;
  color: #fff;
  background: linear-gradient(120deg, #162d84 0%, #2f63cc 54%, #3ea8f0 100%);
  box-shadow: 0 14px 30px rgba(19, 45, 126, 0.22);
}
.hero-kicker {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  margin-bottom: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.32);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.55px;
  text-transform: uppercase;
}
.hero-subtitle { color: rgba(255, 255, 255, 0.95); }
.hero-side-card {
  min-width: 250px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.9);
  color: #14316e;
}
.hero-side-label { font-size: 11px; font-weight: 700; text-transform: uppercase; }
.hero-side-text { margin-top: 4px; font-size: 13px; }

.analytics-card { color: #fff; border-radius: 12px; box-shadow: 0 10px 24px rgba(12, 31, 60, 0.18); }
.analytics-card-green { background: linear-gradient(135deg, #23ba63 0%, #129a51 100%); }
.analytics-card-blue { background: linear-gradient(135deg, #40a9f2 0%, #357adf 100%); }
.analytics-card-orange { background: linear-gradient(135deg, #ff9800 0%, #ff6f00 100%); }
.analytics-card-purple { background: linear-gradient(135deg, #a82cf0 0%, #7a1fca 100%); }
.analytics-card-title { font-size: 12px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; }
.analytics-card-value { font-size: 44px; font-weight: 800; line-height: 1.05; margin-top: 8px; }
.analytics-card-subtitle { margin-top: 4px; font-size: 14px; opacity: 0.95; }
.analytics-card-icon {
  color: #fff !important;
  border-color: rgba(255, 255, 255, 0.55) !important;
  background-color: rgba(255, 255, 255, 0.12) !important;
}

.filter-field { min-width: 170px; flex: 1 1 190px; }
.search-field { min-width: 280px; flex: 2 1 320px; }
.appointment-table th { font-size: 0.78rem; font-weight: 700; }
.appointment-table td { vertical-align: middle; }
.availability-table th { font-size: 0.76rem; font-weight: 700; }
.availability-table td { vertical-align: middle; }

.saas-primary-btn {
  box-shadow: 0 8px 18px rgba(24, 104, 208, 0.3);
  font-weight: 700;
  letter-spacing: 0.2px;
  text-transform: none;
}
.saas-outline-btn {
  border-width: 1px !important;
  color: #2f568f !important;
  border-color: rgba(54, 86, 143, 0.32) !important;
  background: #f5f8ff !important;
  text-transform: none;
  font-weight: 600;
}
.saas-danger-btn {
  box-shadow: 0 8px 16px rgba(248, 79, 66, 0.22);
  text-transform: none;
  font-weight: 700;
}
.saas-icon-btn {
  border-radius: 10px;
  border: 1px solid rgba(69, 98, 175, 0.22) !important;
  box-shadow: 0 4px 12px rgba(23, 50, 103, 0.14);
}
.action-icon {
  display: block;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.action-icon-view {
  color: #2365e2;
}
.action-icon-edit {
  color: #4f46e5;
}
.action-icon-delete {
  color: #dc2626;
}

.saas-icon-btn-danger {
  border-color: rgba(220, 38, 38, 0.26) !important;
  background: rgba(220, 38, 38, 0.08) !important;
}

.feedback-card {
  border: 1px solid rgba(76, 104, 168, 0.12);
  box-shadow: 0 20px 50px rgba(13, 36, 89, 0.22);
}

.saas-modal-card {
  border-radius: 16px !important;
  border: 1px solid rgba(76, 104, 168, 0.16);
  overflow: hidden;
}

.saas-modal-title {
  padding: 16px 24px !important;
  color: #1b2e67 !important;
  background: linear-gradient(180deg, rgba(35, 101, 226, 0.08) 0%, rgba(35, 101, 226, 0) 100%);
  border-bottom: 1px solid rgba(76, 104, 168, 0.14);
}

.modal-section-title {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: #26417f;
}

.delete-review-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.delete-review-grid article {
  border: 1px solid rgba(76, 104, 168, 0.18);
  border-radius: 10px;
  padding: 10px 12px;
  background: #f8fbff;
}

.delete-review-grid label {
  display: block;
  font-size: 12px;
  color: #5e7390;
}

.delete-review-grid strong {
  font-size: 14px;
  color: #173963;
}
</style>
