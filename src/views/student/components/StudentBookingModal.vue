<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import SaasDateTimePickerField from '@/components/shared/SaasDateTimePickerField.vue';
import { createAppointment, type CreateAppointmentPayload } from '@/services/appointmentsAdmin';
import {
  fetchDoctorTimeCatalog,
  fetchDoctorAvailability,
  listDoctorAvailability,
  type DoctorAvailabilityScheduleRow,
  type DoctorAvailabilitySnapshot
} from '@/services/doctorAvailability';
import { listDoctors, type DoctorRow } from '@/services/doctors';
import { deleteCookie, getCookie, setCookie } from '@/utils/cookies';

type CreateStep = 1 | 2 | 3;
type AppointedRole = 'student' | 'teacher';

const model = defineModel<boolean>({ default: false });
const props = defineProps<{
  patientContext?: {
    patientCode?: string;
    fullName?: string;
    email?: string;
    phoneNumber?: string;
    sex?: string | null;
  } | null;
}>();

const serviceByDepartment: Record<string, string[]> = {
  'General Medicine': ['General Check-Up', 'Follow-up Visit', 'Medical Clearance'],
  Pediatrics: ['Pediatric Consultation', 'Child Wellness Visit'],
  Orthopedic: ['Bone and Joint Consultation', 'Sports Injury Assessment'],
  Dental: ['Oral Consultation', 'Tooth Extraction Assessment'],
  Laboratory: ['Lab Result Review', 'Diagnostic Referral'],
  'Mental Health': ['Counseling', 'Psychiatric Consultation'],
  'Check-Up': ['Annual Physical Exam', 'Routine Check-Up']
};

const fallbackDoctorsByDepartment: Record<string, string[]> = {
  'General Medicine': ['Dr. Humour', 'Dr. Jenni'],
  Pediatrics: ['Dr. Rivera'],
  Orthopedic: ['Dr. Morco', 'Dr. Martinez'],
  Dental: ['Dr. Santos', 'Dr. Lim'],
  Laboratory: ['Dr. A. Rivera'],
  'Mental Health': ['Dr. S. Villaraza'],
  'Check-Up': ['Dr. B. Martinez']
};

const staticDepartmentOptions = Object.keys(serviceByDepartment);
const priorityOptions: Array<'Routine' | 'Urgent'> = ['Routine', 'Urgent'];
const paymentOptions = ['Cash', 'Card', 'HMO', 'Online'];
const sexOptions = ['Male', 'Female', 'Other'];
const appointedRoleOptions = [
  { title: 'Student', value: 'student' as AppointedRole },
  { title: 'Teacher', value: 'teacher' as AppointedRole }
];

const doctorsCatalog = ref<DoctorRow[]>([]);
const availabilityLoading = ref(false);
const doctorAvailability = ref<DoctorAvailabilitySnapshot | null>(null);
const doctorScheduleRows = ref<DoctorAvailabilityScheduleRow[]>([]);
const doctorAvailabilityByDoctor = ref<Record<string, DoctorAvailabilitySnapshot | null>>({});
const doctorListAvailabilityLoading = ref(false);
const availabilityRequestId = ref(0);
const scheduleRequestId = ref(0);
const doctorListRequestId = ref(0);
const scheduleRefreshTimer = ref<number | null>(null);
const listRefreshTimer = ref<number | null>(null);
const availabilityRefreshTimer = ref<number | null>(null);
const isInitializing = ref(false);
const submitting = ref(false);
const step = ref<CreateStep>(1);
const stepError = ref('');
const appointedRole = ref<AppointedRole>('student');
const submitSuccess = ref<null | { bookingId: string; patientName: string; date: string; time: string }>(null);
const errors = reactive<Record<string, string>>({});
const PATIENT_BOOKING_COOKIE = 'patient_booking_draft';

type PatientBookingCookieDraft = {
  appointed_role?: AppointedRole;
  patient_name?: string;
  patient_email?: string;
  phone_number?: string;
  patient_age?: number | null;
  patient_sex?: string;
  guardian_name?: string;
  emergency_contact?: string;
  insurance_provider?: string;
  payment_method?: string;
  appointment_priority?: 'Routine' | 'Urgent';
  department_name?: string;
  doctor_name?: string;
  visit_type?: string;
  appointment_date?: string;
  preferred_time?: string;
};

const form = reactive<
  CreateAppointmentPayload & {
    guardian_name: string;
    consent_acknowledged: boolean;
  }
>({
  patient_id: '',
  patient_name: '',
  patient_email: '',
  phone_number: '',
  emergency_contact: '',
  insurance_provider: '',
  payment_method: 'Cash',
  appointment_priority: 'Routine',
  doctor_name: 'Dr. Humour',
  department_name: 'General Medicine',
  visit_type: 'General Check-Up',
  appointment_date: toInputDate(new Date()),
  preferred_time: '',
  symptoms_summary: '',
  doctor_notes: '',
  visit_reason: '',
  patient_age: null,
  patient_sex: '',
  status: 'New',
  guardian_name: '',
  consent_acknowledged: false
});

const modalTitle = computed(() => (submitSuccess.value ? 'Booking Submitted' : 'Book Student Appointment'));
const stepStatus = computed(() => ({ patient: step.value >= 1, schedule: step.value >= 2, review: step.value >= 3 }));
const isMinor = computed(() => Number(form.patient_age || 0) > 0 && Number(form.patient_age || 0) < 18);

function normalizeCatalogValue(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const doctorOptionsForDepartment = computed(() => {
  const departmentKey = normalizeCatalogValue(form.department_name || 'General Medicine');
  const selectedDepartment = String(form.department_name || 'General Medicine').trim();
  const activeDoctors = doctorsCatalog.value.filter((item) => item.isActive);
  const departmentDoctors = activeDoctors.filter((item) => normalizeCatalogValue(item.departmentName) === departmentKey);
  const fallbackDepartmentDoctors = fallbackDoctorsByDepartment[selectedDepartment] || [];
  const candidates = [
    ...departmentDoctors.map((item) => item.doctorName),
    ...fallbackDepartmentDoctors
  ].filter(Boolean);

  return Array.from(new Set(candidates));
});

const hasDepartmentDoctors = computed(() => doctorOptionsForDepartment.value.length > 0);
const doctorSelectHint = computed(() =>
  hasDepartmentDoctors.value
    ? 'Only doctors assigned to selected department are listed.'
    : `No doctor assigned yet for ${form.department_name || 'this department'}.`
);

const departmentOptions = computed(() => {
  const fromCatalog = doctorsCatalog.value
    .filter((item) => item.isActive)
    .map((item) => item.departmentName);
  return Array.from(new Set([...staticDepartmentOptions, ...fromCatalog]));
});

function summarizeDoctorAvailability(snapshot: DoctorAvailabilitySnapshot | null): string {
  if (!snapshot) return 'Checking schedule...';
  if (!snapshot.isDoctorAvailable) return snapshot.reason || 'Unavailable';
  const times = (snapshot.recommendedTimes || []).slice(0, 3);
  if (times.length) return `Available: ${times.join(', ')}${snapshot.recommendedTimes.length > 3 ? '...' : ''}`;
  const openSlot = (snapshot.slots || []).find((slot) => slot.isOpen);
  if (!openSlot) return 'No open slot left for selected date';
  return `Open window: ${openSlot.startTime}-${openSlot.endTime}`;
}

function resolveDoctorDepartment(doctorName: string): string {
  const fromCatalog = doctorsCatalog.value.find((item) => item.doctorName === doctorName);
  if (fromCatalog?.departmentName) return fromCatalog.departmentName;
  const fromFallback = Object.entries(fallbackDoctorsByDepartment).find(([, doctors]) => doctors.includes(doctorName));
  return fromFallback?.[0] || '';
}

const doctorDropdownItems = computed(() =>
  doctorOptionsForDepartment.value.map((doctorName) => {
    const departmentName = resolveDoctorDepartment(doctorName);
    return {
      title: departmentName ? `${doctorName} - ${departmentName}` : doctorName,
      value: doctorName,
      subtitle: summarizeDoctorAvailability(doctorAvailabilityByDoctor.value[doctorName] || null)
    };
  })
);

function doctorItemStatusColor(doctorName: string): string {
  const snapshot = doctorAvailabilityByDoctor.value[doctorName] || null;
  if (!snapshot) return 'info';
  return snapshot.isDoctorAvailable ? 'success' : 'warning';
}

function doctorItemStatusText(doctorName: string): string {
  const snapshot = doctorAvailabilityByDoctor.value[doctorName] || null;
  if (!snapshot) return 'Checking';
  return snapshot.isDoctorAvailable ? 'Open' : 'Busy';
}

const visitTypeOptions = computed(() => {
  const department = form.department_name || 'General Medicine';
  return serviceByDepartment[department] || ['General Check-Up'];
});

const reviewRows = computed(() => [
  { label: 'Booked By', value: appointedRole.value === 'teacher' ? 'Teacher' : 'Student' },
  { label: 'Booker', value: form.patient_name || '--' },
  { label: 'Phone', value: form.phone_number || '--' },
  { label: 'Department', value: form.department_name || '--' },
  { label: 'Doctor', value: selectedDoctorName.value || '--' },
  { label: 'Visit Type', value: form.visit_type || '--' },
  { label: 'Schedule', value: `${form.appointment_date || '--'} ${form.preferred_time || ''}`.trim() },
  { label: 'Priority', value: form.appointment_priority || '--' }
]);

function toTimeMinutes(value: string): number {
  const [hh, mm] = String(value || '')
    .slice(0, 5)
    .split(':')
    .map((item) => Number(item || 0));
  return hh * 60 + mm;
}

const preferredTimeOptions = computed(() => {
  const activeSnapshot =
    doctorAvailability.value && doctorAvailability.value.doctorName === selectedDoctorName.value
      ? doctorAvailability.value
      : doctorAvailabilityByDoctor.value[selectedDoctorName.value] || null;
  if (!activeSnapshot) return [] as string[];
  const recommended = Array.from(new Set((activeSnapshot.recommendedTimes || []).map((item) => String(item || '').slice(0, 5)).filter(Boolean))).sort(
    (a, b) => toTimeMinutes(a) - toTimeMinutes(b)
  );
  if (recommended.length) return recommended;
  return (activeSnapshot.slots || [])
    .filter((slot) => slot.isOpen)
    .map((slot) => slot.startTime)
    .sort((a, b) => toTimeMinutes(a) - toTimeMinutes(b));
});

function normalizeDoctorName(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const source = value as { value?: unknown; title?: unknown };
    if (typeof source.value === 'string') return source.value.trim();
    if (typeof source.title === 'string') return source.title.trim();
  }
  return String(value || '').trim();
}

const selectedDoctorName = computed(() => normalizeDoctorName(form.doctor_name));

const nextAvailableDates = computed(() => {
  const daySet = new Set<number>(
    doctorScheduleRows.value.filter((row) => row.isActive).map((row) => Number(row.dayOfWeek))
  );
  if (!daySet.size) return [] as string[];
  const now = new Date();
  const items: string[] = [];
  for (let offset = 0; offset <= 35 && items.length < 6; offset += 1) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    if (!daySet.has(candidate.getDay())) continue;
    items.push(toInputDate(candidate));
  }
  return items;
});

const selectedDoctorSlots = computed(() =>
  [...(doctorAvailability.value?.slots || [])]
    .filter((slot) => slot.isOpen)
    .sort((a, b) => toTimeMinutes(a.startTime) - toTimeMinutes(b.startTime))
);

const selectedDoctorRecommended = computed(() =>
  [...preferredTimeOptions.value].slice(0, 10)
);

const isSelectedPreferredTimeValid = computed(() => {
  const current = String(form.preferred_time || '').trim();
  if (!current) return false;
  return preferredTimeOptions.value.includes(current);
});

const isStepTwoReady = computed(() => {
  const today = toInputDate(new Date());
  const hasCoreFields =
    !!String(form.department_name || '').trim() &&
    !!selectedDoctorName.value &&
    !!String(form.visit_type || '').trim() &&
    !!String(form.appointment_date || '').trim();
  const dateValid = String(form.appointment_date || '').trim() >= today;
  const availabilityValid = Boolean(doctorAvailability.value?.isDoctorAvailable);
  const preferredTimeValid = isSelectedPreferredTimeValid.value;
  const urgentContactValid =
    form.appointment_priority !== 'Urgent' || !!String(form.emergency_contact || '').trim();
  return hasCoreFields && dateValid && availabilityValid && preferredTimeValid && urgentContactValid && !availabilityLoading.value;
});

function toInputDate(value: Date): string {
  const localDate = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function dayLabelFromIso(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' });
}

function clearErrors(): void {
  stepError.value = '';
  Object.keys(errors).forEach((key) => {
    errors[key] = '';
  });
}

function readBookingDraftCookie(): PatientBookingCookieDraft | null {
  const raw = getCookie(PATIENT_BOOKING_COOKIE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PatientBookingCookieDraft;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeBookingDraftCookie(): void {
  const payload: PatientBookingCookieDraft = {
    appointed_role: appointedRole.value,
    patient_name: String(form.patient_name || '').trim(),
    patient_email: String(form.patient_email || '').trim(),
    phone_number: String(form.phone_number || '').trim(),
    patient_age: form.patient_age == null ? null : Number(form.patient_age || 0) || null,
    patient_sex: String(form.patient_sex || '').trim(),
    guardian_name: String(form.guardian_name || '').trim(),
    emergency_contact: String(form.emergency_contact || '').trim(),
    insurance_provider: String(form.insurance_provider || '').trim(),
    payment_method: String(form.payment_method || '').trim(),
    appointment_priority: form.appointment_priority,
    department_name: String(form.department_name || '').trim(),
    doctor_name: selectedDoctorName.value,
    visit_type: String(form.visit_type || '').trim(),
    appointment_date: String(form.appointment_date || '').trim(),
    preferred_time: String(form.preferred_time || '').trim()
  };
  setCookie(PATIENT_BOOKING_COOKIE, JSON.stringify(payload), { days: 30, sameSite: 'Lax', path: '/' });
}

function applyBookingDraftCookie(): void {
  const draft = readBookingDraftCookie();
  if (!draft) return;

  appointedRole.value = draft.appointed_role === 'teacher' ? 'teacher' : 'student';
  if (!props.patientContext?.fullName) form.patient_name = String(draft.patient_name || '').trim();
  if (!props.patientContext?.email) form.patient_email = String(draft.patient_email || '').trim();
  if (!props.patientContext?.phoneNumber) form.phone_number = String(draft.phone_number || '').trim();
  if (!props.patientContext?.sex) form.patient_sex = String(draft.patient_sex || '').trim();
  form.patient_age = draft.patient_age == null ? null : Number(draft.patient_age || 0) || null;
  form.guardian_name = String(draft.guardian_name || '').trim();
  form.emergency_contact = String(draft.emergency_contact || '').trim();
  form.insurance_provider = String(draft.insurance_provider || '').trim();
  form.payment_method = String(draft.payment_method || '').trim() || 'Cash';
  form.appointment_priority = draft.appointment_priority === 'Urgent' ? 'Urgent' : 'Routine';
  form.department_name = String(draft.department_name || '').trim() || 'General Medicine';
  form.doctor_name = normalizeDoctorName(draft.doctor_name || '');
  form.visit_type = String(draft.visit_type || '').trim() || form.visit_type;
  form.appointment_date = String(draft.appointment_date || '').trim() || form.appointment_date;
  form.preferred_time = String(draft.preferred_time || '').trim();
}

function resetForm(): void {
  clearErrors();
  submitSuccess.value = null;
  step.value = 1;
  appointedRole.value = 'student';
  form.patient_id = '';
  form.patient_name = props.patientContext?.fullName || '';
  form.patient_email = props.patientContext?.email || '';
  form.phone_number = props.patientContext?.phoneNumber || '';
  form.emergency_contact = '';
  form.insurance_provider = '';
  form.payment_method = 'Cash';
  form.appointment_priority = 'Routine';
  form.department_name = 'General Medicine';
  form.doctor_name = '';
  form.visit_type = serviceByDepartment['General Medicine'][0] || 'General Check-Up';
  form.appointment_date = toInputDate(new Date());
  form.preferred_time = '';
  form.symptoms_summary = '';
  form.doctor_notes = '';
  form.visit_reason = '';
  form.patient_age = null;
  form.patient_sex = props.patientContext?.sex || '';
  form.status = 'New';
  form.guardian_name = '';
  form.consent_acknowledged = false;
  doctorAvailability.value = null;
  if (props.patientContext?.patientCode) {
    form.patient_id = props.patientContext.patientCode;
  }
  applyBookingDraftCookie();
}

function closeModal(): void {
  if (submitting.value) return;
  model.value = false;
}

function clearQueuedLoads(): void {
  if (scheduleRefreshTimer.value != null) window.clearTimeout(scheduleRefreshTimer.value);
  if (listRefreshTimer.value != null) window.clearTimeout(listRefreshTimer.value);
  if (availabilityRefreshTimer.value != null) window.clearTimeout(availabilityRefreshTimer.value);
  scheduleRefreshTimer.value = null;
  listRefreshTimer.value = null;
  availabilityRefreshTimer.value = null;
}

function queueLoadDoctorSchedules(delayMs = 80): void {
  if (scheduleRefreshTimer.value != null) window.clearTimeout(scheduleRefreshTimer.value);
  scheduleRefreshTimer.value = window.setTimeout(() => {
    scheduleRefreshTimer.value = null;
    void loadDoctorSchedules();
  }, delayMs);
}

function queueLoadDoctorListAvailability(delayMs = 100): void {
  if (listRefreshTimer.value != null) window.clearTimeout(listRefreshTimer.value);
  listRefreshTimer.value = window.setTimeout(() => {
    listRefreshTimer.value = null;
    void loadDoctorListAvailability();
  }, delayMs);
}

function queueLoadDoctorAvailability(delayMs = 120): void {
  if (availabilityRefreshTimer.value != null) window.clearTimeout(availabilityRefreshTimer.value);
  availabilityRefreshTimer.value = window.setTimeout(() => {
    availabilityRefreshTimer.value = null;
    void loadDoctorAvailability();
  }, delayMs);
}

function queueRefreshScheduleSection(immediate = false): void {
  const delay = immediate ? 0 : 90;
  queueLoadDoctorSchedules(delay);
  queueLoadDoctorListAvailability(delay);
  queueLoadDoctorAvailability(delay);
}

function normalizeDepartmentSelection(): void {
  const doctors = doctorOptionsForDepartment.value;
  const visits = serviceByDepartment[form.department_name] || [];
  const selected = selectedDoctorName.value || '';
  if (!doctors.length) {
    form.doctor_name = '';
  } else if (!doctors.includes(selected)) {
    form.doctor_name = doctors[0];
  }
  if (visits.length && !visits.includes(form.visit_type || '')) {
    form.visit_type = visits[0];
  }
  queueRefreshScheduleSection();
}

async function loadDoctorSchedules(): Promise<void> {
  const requestId = scheduleRequestId.value + 1;
  scheduleRequestId.value = requestId;
  const doctorName = selectedDoctorName.value;
  const departmentName = String(form.department_name || '').trim();
  if (!doctorName || !departmentName) {
    doctorScheduleRows.value = [];
    return;
  }
  try {
    const rows = await listDoctorAvailability({ doctorName, departmentName });
    if (requestId !== scheduleRequestId.value) return;
    doctorScheduleRows.value = rows;
  } catch {
    if (requestId !== scheduleRequestId.value) return;
    doctorScheduleRows.value = [];
  }
}

async function loadDoctorsCatalog(): Promise<void> {
  try {
    doctorsCatalog.value = await listDoctors();
    const doctors = doctorOptionsForDepartment.value;
    if (!selectedDoctorName.value && doctors.length) {
      form.doctor_name = doctors[0];
    }
    queueRefreshScheduleSection(true);
  } catch {
    doctorsCatalog.value = [];
  }
}

async function loadDoctorListAvailability(): Promise<void> {
  const requestId = doctorListRequestId.value + 1;
  doctorListRequestId.value = requestId;
  const departmentName = String(form.department_name || '').trim();
  const appointmentDate = String(form.appointment_date || '').trim();
  const doctors = doctorOptionsForDepartment.value.filter(Boolean);
  if (!departmentName || !appointmentDate || !doctors.length) {
    doctorAvailabilityByDoctor.value = {};
    return;
  }
  doctorListAvailabilityLoading.value = true;
  try {
    const catalog = await fetchDoctorTimeCatalog({ departmentName, appointmentDate });
    const entries = doctors.map((name) => {
      const matched = (catalog.doctors || []).find((item) => item.doctorName === name);
      return [
        name,
        matched
          ? {
              doctorName: matched.doctorName,
              departmentName: matched.departmentName,
              appointmentDate,
              isDoctorAvailable: matched.isDoctorAvailable,
              reason: matched.reason,
              slots: matched.slots || [],
              recommendedTimes: matched.recommendedTimes || []
            }
          : {
              doctorName: name,
              departmentName,
              appointmentDate,
              isDoctorAvailable: false,
              reason: 'No active schedule found for selected date.',
              slots: [],
              recommendedTimes: []
            }
      ] as const;
    });
    if (requestId !== doctorListRequestId.value) return;
    doctorAvailabilityByDoctor.value = Object.fromEntries(entries);
    const selectedSnapshot = doctorAvailabilityByDoctor.value[selectedDoctorName.value] || null;
    if (!String(form.preferred_time || '').trim() && selectedSnapshot?.isDoctorAvailable && (selectedSnapshot.recommendedTimes || []).length) {
      form.preferred_time = String(selectedSnapshot.recommendedTimes[0] || '').slice(0, 5);
    }
  } finally {
    if (requestId !== doctorListRequestId.value) return;
    doctorListAvailabilityLoading.value = false;
  }
}

async function loadDoctorAvailability(): Promise<void> {
  const requestId = availabilityRequestId.value + 1;
  availabilityRequestId.value = requestId;
  const doctorName = selectedDoctorName.value;
  const departmentName = String(form.department_name || '').trim();
  const appointmentDate = String(form.appointment_date || '').trim();
  if (!doctorName || !departmentName || !appointmentDate) {
    doctorAvailability.value = null;
    return;
  }
  const preferredTime = String(form.preferred_time || '').trim();
  if (!preferredTime) {
    const cachedSnapshot = doctorAvailabilityByDoctor.value[doctorName] || null;
    if (cachedSnapshot) {
      doctorAvailability.value = cachedSnapshot;
      return;
    }
  }
  availabilityLoading.value = true;
  try {
    const snapshot = await fetchDoctorAvailability({
      doctorName,
      departmentName,
      appointmentDate,
      preferredTime: preferredTime || undefined
    });
    if (requestId !== availabilityRequestId.value) return;
    doctorAvailability.value = snapshot;
    if (!preferredTime && snapshot.isDoctorAvailable && (snapshot.recommendedTimes || []).length) {
      form.preferred_time = snapshot.recommendedTimes[0] || '';
    }
  } catch (error) {
    if (requestId !== availabilityRequestId.value) return;
    doctorAvailability.value = {
      doctorName,
      departmentName,
      appointmentDate,
      isDoctorAvailable: false,
      reason: error instanceof Error ? error.message : String(error),
      slots: [],
      recommendedTimes: []
    };
  } finally {
    if (requestId !== availabilityRequestId.value) return;
    availabilityLoading.value = false;
  }
}

function validateStepOne(): boolean {
  clearErrors();
  const phone = String(form.phone_number || '').trim();
  const phoneValid = /^[0-9+\-\s()]{7,20}$/.test(phone);
  if (!String(form.patient_name || '').trim()) errors.patient_name = 'Student name is required.';
  if (!phone) errors.phone_number = 'Phone number is required.';
  else if (!phoneValid) errors.phone_number = 'Enter a valid phone number.';
  if (!String(form.patient_sex || '').trim()) errors.patient_sex = 'Please select sex.';
  if (Number(form.patient_age || 0) <= 0) errors.patient_age = 'Please enter valid age.';
  if (isMinor.value && !String(form.guardian_name || '').trim()) errors.guardian_name = 'Guardian name is required for minors.';
  return !Object.values(errors).some(Boolean);
}

function validateStepTwo(): boolean {
  clearErrors();
  const today = toInputDate(new Date());
  if (!nextAvailableDates.value.length) {
    errors.appointment_date = 'No available schedule dates for the selected doctor.';
  }
  if (!String(form.department_name || '').trim()) errors.department_name = 'Department is required.';
  if (!selectedDoctorName.value) errors.doctor_name = 'Doctor is required.';
  if (!String(form.visit_type || '').trim()) errors.visit_type = 'Visit type is required.';
  if (!String(form.appointment_date || '').trim()) errors.appointment_date = 'Appointment date is required.';
  else if (String(form.appointment_date) < today) errors.appointment_date = 'Appointment date cannot be in the past.';
  else if (nextAvailableDates.value.length && !nextAvailableDates.value.includes(String(form.appointment_date))) {
    errors.appointment_date = 'Selected date is outside doctor availability.';
  }
  if (!String(form.preferred_time || '').trim()) errors.preferred_time = 'Preferred time is required.';
  if (!doctorAvailability.value?.isDoctorAvailable) errors.preferred_time = doctorAvailability.value?.reason || 'Doctor is unavailable for selected date/time.';
  if (form.appointment_priority === 'Urgent' && !String(form.emergency_contact || '').trim()) {
    errors.emergency_contact = 'Emergency contact is required for urgent booking.';
  }
  return !Object.values(errors).some(Boolean);
}

function validateStepThree(): boolean {
  clearErrors();
  if (!String(form.visit_reason || '').trim()) errors.visit_reason = 'Chief complaint is required.';
  if (!form.consent_acknowledged) errors.consent_acknowledged = 'Please acknowledge the consent and privacy notice.';
  return !Object.values(errors).some(Boolean);
}

function nextStep(): void {
  const valid = step.value === 1 ? validateStepOne() : step.value === 2 ? validateStepTwo() : validateStepThree();
  if (!valid) {
    stepError.value = 'Please complete required fields before continuing.';
    return;
  }
  stepError.value = '';
  step.value = Math.min(3, step.value + 1) as CreateStep;
}

function previousStep(): void {
  clearErrors();
  step.value = Math.max(1, step.value - 1) as CreateStep;
}

function setSuggestedDate(dateValue: string): void {
  form.appointment_date = dateValue;
  form.preferred_time = '';
  queueRefreshScheduleSection();
}

async function submitBooking(): Promise<void> {
  if (!validateStepThree()) {
    stepError.value = 'Please complete required fields before submitting.';
    return;
  }
  submitting.value = true;
  try {
    const created = await createAppointment({
      patient_id: String(form.patient_id || '').trim() || undefined,
      patient_name: String(form.patient_name || '').trim(),
      patient_email: String(form.patient_email || '').trim() || undefined,
      phone_number: String(form.phone_number || '').trim(),
      emergency_contact: String(form.emergency_contact || '').trim() || undefined,
      insurance_provider: String(form.insurance_provider || '').trim() || undefined,
      payment_method: String(form.payment_method || '').trim() || undefined,
      appointment_priority: form.appointment_priority || 'Routine',
      doctor_name: selectedDoctorName.value,
      student_name: String(form.patient_name || '').trim(),
      department_name: String(form.department_name || '').trim(),
      visit_type: String(form.visit_type || '').trim(),
      appointment_date: String(form.appointment_date || '').trim(),
      preferred_time: String(form.preferred_time || '').trim() || undefined,
      symptoms_summary: String(form.symptoms_summary || '').trim() || undefined,
      doctor_notes: String(form.doctor_notes || '').trim() || undefined,
      visit_reason: String(form.visit_reason || '').trim(),
      patient_age: Number(form.patient_age || 0) || null,
      patient_sex: String(form.patient_sex || '').trim() || undefined,
      guardian_name: String(form.guardian_name || '').trim() || undefined,
      status: 'New',
      actor_role: appointedRole.value
    });

    submitSuccess.value = {
      bookingId: created.bookingId,
      patientName: created.patientName,
      date: created.scheduleDate,
      time: created.scheduleTime || '--'
    };
    deleteCookie(PATIENT_BOOKING_COOKIE);
  } catch (error) {
    stepError.value = error instanceof Error ? error.message : String(error);
  } finally {
    submitting.value = false;
  }
}

watch(
  () => model.value,
  async (open) => {
    if (open) {
      isInitializing.value = true;
      resetForm();
      await loadDoctorsCatalog();
      isInitializing.value = false;
      queueRefreshScheduleSection(true);
      return;
    }
    clearQueuedLoads();
    isInitializing.value = false;
  }
);

watch(
  () => [form.department_name, form.doctor_name],
  ([department, doctor], [prevDepartment, prevDoctor]) => {
    if (department !== prevDepartment || doctor !== prevDoctor) {
      form.preferred_time = '';
      doctorAvailability.value = null;
    }
    if (!model.value || isInitializing.value) return;
    queueRefreshScheduleSection();
  }
);

watch(
  () => form.preferred_time,
  () => {
    if (!model.value || isInitializing.value) return;
    queueLoadDoctorAvailability();
  }
);

watch(
  () => preferredTimeOptions.value.join(','),
  () => {
    const current = String(form.preferred_time || '').trim();
    if (!current) return;
    if (!preferredTimeOptions.value.includes(current)) {
      form.preferred_time = '';
    }
  }
);

watch(
  () => nextAvailableDates.value.join(','),
  () => {
    const currentDate = String(form.appointment_date || '').trim();
    if (!currentDate) return;
    if (!nextAvailableDates.value.length) {
      form.appointment_date = '';
      form.preferred_time = '';
      return;
    }
    if (!nextAvailableDates.value.includes(currentDate)) {
      form.appointment_date = nextAvailableDates.value[0] || '';
      form.preferred_time = '';
    }
  }
);

watch(
  () => form.appointment_date,
  (nextDate, prevDate) => {
    if (nextDate !== prevDate) {
      form.preferred_time = '';
      doctorAvailability.value = null;
    }
    if (!model.value || isInitializing.value) return;
    queueLoadDoctorListAvailability();
    queueLoadDoctorAvailability();
  }
);

watch(
  () => [
    model.value,
    submitSuccess.value,
    form.patient_name,
    form.patient_email,
    form.phone_number,
    form.patient_age,
    form.patient_sex,
    form.guardian_name,
    form.emergency_contact,
    form.insurance_provider,
    form.payment_method,
    appointedRole.value,
    form.appointment_priority,
    form.department_name,
    selectedDoctorName.value,
    form.visit_type,
    form.appointment_date,
    form.preferred_time
  ],
  () => {
    if (!model.value || submitSuccess.value) return;
    writeBookingDraftCookie();
  }
);
</script>

<template>
  <v-dialog v-model="model" max-width="980" :persistent="submitting">
    <v-card class="booking-modal">
      <v-card-title class="modal-title d-flex align-center justify-space-between">
        <span>{{ modalTitle }}</span>
        <v-btn icon variant="text" :disabled="submitting" @click="closeModal">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-card-text>
        <template v-if="!submitSuccess">
          <div class="modal-stepper" role="group" aria-label="Booking steps">
            <div class="step" :class="{ active: stepStatus.patient, current: step === 1 }"><span>1</span><label>Student Info</label></div>
            <div class="line"></div>
            <div class="step" :class="{ active: stepStatus.schedule, current: step === 2 }"><span>2</span><label>Schedule</label></div>
            <div class="line"></div>
            <div class="step" :class="{ active: stepStatus.review, current: step === 3 }"><span>3</span><label>Review</label></div>
          </div>

          <div v-if="stepError" class="error-banner">{{ stepError }}</div>

          <div v-if="step === 1" class="form-grid">
            <div class="grid-col span-12">
              <v-text-field
                v-model="form.patient_id"
                label="Student ID (optional)"
                variant="outlined"
                density="comfortable"
                hint="If you already have a student ID, enter it here."
                persistent-hint
                hide-details="auto"
              />
            </div>
            <div class="grid-col span-6">
              <v-select
                v-model="appointedRole"
                :items="appointedRoleOptions"
                item-title="title"
                item-value="value"
                label="Booked By *"
                variant="outlined"
                density="comfortable"
                hide-details
              />
            </div>
            <div class="grid-col span-6"><v-text-field v-model="form.patient_name" label="Student Name *" variant="outlined" density="comfortable" :error-messages="errors.patient_name" /></div>
            <div class="grid-col span-6"><v-text-field v-model="form.patient_email" label="Email" variant="outlined" density="comfortable" hide-details /></div>
            <div class="grid-col span-6"><v-text-field v-model="form.phone_number" label="Phone Number *" variant="outlined" density="comfortable" :error-messages="errors.phone_number" /></div>
            <div class="grid-col span-3"><v-text-field v-model.number="form.patient_age" label="Age *" type="number" min="0" variant="outlined" density="comfortable" :error-messages="errors.patient_age" /></div>
            <div class="grid-col span-3"><v-select v-model="form.patient_sex" :items="sexOptions" label="Sex *" variant="outlined" density="comfortable" :error-messages="errors.patient_sex" /></div>
            <div class="grid-col span-12" v-if="isMinor">
              <v-text-field
                v-model="form.guardian_name"
                label="Guardian Name *"
                variant="outlined"
                density="comfortable"
                :error-messages="errors.guardian_name"
                hint="Required for students below 18"
                persistent-hint
              />
            </div>
          </div>

          <div v-if="step === 2" class="form-grid">
            <div class="grid-col span-6">
              <v-select
                v-model="form.department_name"
                :items="departmentOptions"
                label="Department *"
                variant="outlined"
                density="comfortable"
                :error-messages="errors.department_name"
                @update:model-value="normalizeDepartmentSelection"
              />
            </div>
            <div class="grid-col span-6">
              <v-select
                v-model="form.doctor_name"
                :items="doctorDropdownItems"
                item-title="title"
                item-value="value"
                label="Doctor *"
                variant="outlined"
                density="comfortable"
                :loading="doctorListAvailabilityLoading"
                :disabled="!hasDepartmentDoctors"
                :error-messages="errors.doctor_name"
                :hint="doctorSelectHint"
                persistent-hint
                hide-no-data
              >
                <template #item="{ props: itemProps, item }">
                  <v-list-item v-bind="itemProps" :title="item.raw.title" :subtitle="item.raw.subtitle">
                    <template #append>
                      <v-chip
                        size="x-small"
                        :color="doctorItemStatusColor(String(item.raw.value || item.raw.title || ''))"
                        variant="tonal"
                        class="doctor-item-chip"
                      >
                        {{ doctorItemStatusText(String(item.raw.value || item.raw.title || '')) }}
                      </v-chip>
                    </template>
                  </v-list-item>
                </template>
              </v-select>
            </div>
            <div class="grid-col span-12" v-if="!hasDepartmentDoctors">
              <v-alert type="warning" variant="tonal" density="comfortable">
                No doctors are currently assigned to {{ form.department_name || 'this department' }}.
              </v-alert>
            </div>
            <div class="grid-col span-6"><v-select v-model="form.visit_type" :items="visitTypeOptions" label="Visit Type *" variant="outlined" density="comfortable" :error-messages="errors.visit_type" /></div>
            <div class="grid-col span-3">
              <SaasDateTimePickerField
                v-model="form.appointment_date"
                mode="date"
                label="Date *"
                :min="toInputDate(new Date())"
                :allowed-dates="nextAvailableDates"
                :error-messages="errors.appointment_date"
              />
            </div>
            <div class="grid-col span-3">
              <SaasDateTimePickerField
                v-model="form.preferred_time"
                mode="time"
                label="Preferred Time"
                :loading="availabilityLoading"
                :allowed-times="preferredTimeOptions"
                :error-messages="errors.preferred_time"
                hint="Recommended based on doctor schedule capacity"
                persistent-hint
                clearable
              />
            </div>
            <div class="grid-col span-12 doctor-time-side-wrap">
              <div class="doctor-time-side">
                <div class="doctor-time-head">
                  <div class="doctor-time-title">Doctor Time Availability</div>
                  <div class="doctor-time-meta">{{ selectedDoctorName || '--' }} | {{ form.appointment_date || '--' }}</div>
                </div>
                <div class="doctor-time-body" v-if="doctorAvailability">
                  <v-chip size="small" :color="doctorAvailability.isDoctorAvailable ? 'success' : 'warning'" variant="tonal" class="mb-2">
                    {{ doctorAvailability.isDoctorAvailable ? 'Available' : 'Unavailable' }}
                  </v-chip>
                  <p class="doctor-time-reason mb-2">{{ doctorAvailability.reason }}</p>
                  <div class="doctor-slot-row" v-if="selectedDoctorSlots.length">
                    <span class="doctor-slot-label">Open Windows</span>
                    <div class="doctor-slot-list">
                      <span v-for="slot in selectedDoctorSlots" :key="slot.id" class="doctor-slot-pill">
                        {{ slot.startTime }}-{{ slot.endTime }} ({{ slot.remainingAppointments }})
                      </span>
                    </div>
                  </div>
                  <div class="doctor-slot-row" v-if="selectedDoctorRecommended.length">
                    <span class="doctor-slot-label">Recommended Times</span>
                    <div class="doctor-slot-list">
                      <span v-for="slot in selectedDoctorRecommended" :key="`rec-${slot}`" class="doctor-slot-pill doctor-slot-pill-primary">
                        {{ slot }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="grid-col span-12" v-if="nextAvailableDates.length && (!doctorAvailability?.isDoctorAvailable || !preferredTimeOptions.length)">
              <div class="next-dates-card">
                <div class="next-dates-title">Next available dates</div>
                <div class="next-dates-row">
                  <button
                    v-for="dateItem in nextAvailableDates"
                    :key="dateItem"
                    type="button"
                    class="next-date-pill"
                    :class="{ active: form.appointment_date === dateItem }"
                    @click="setSuggestedDate(dateItem)"
                  >
                    {{ dayLabelFromIso(dateItem) }}
                  </button>
                </div>
              </div>
            </div>
            <div class="grid-col span-4"><v-select v-model="form.appointment_priority" :items="priorityOptions" label="Priority" variant="outlined" density="comfortable" /></div>
            <div class="grid-col span-4"><v-text-field v-model="form.emergency_contact" label="Emergency Contact" variant="outlined" density="comfortable" :error-messages="errors.emergency_contact" /></div>
            <div class="grid-col span-4"><v-select v-model="form.payment_method" :items="paymentOptions" label="Payment Method" variant="outlined" density="comfortable" hide-details /></div>
            <div class="grid-col span-12"><v-text-field v-model="form.insurance_provider" label="Insurance / HMO Provider" variant="outlined" density="comfortable" hide-details /></div>
            <div class="grid-col span-12" v-if="doctorAvailability">
              <v-alert :type="doctorAvailability.isDoctorAvailable ? 'success' : 'warning'" variant="tonal" density="comfortable">
                {{ doctorAvailability.reason }}
              </v-alert>
            </div>
          </div>

          <div v-if="step === 3" class="form-grid">
            <div class="grid-col span-12 review-grid">
              <article v-for="item in reviewRows" :key="item.label"><label>{{ item.label }}</label><strong>{{ item.value || '--' }}</strong></article>
            </div>
            <div class="grid-col span-12"><v-textarea v-model="form.visit_reason" rows="2" label="Chief Complaint *" variant="outlined" density="comfortable" :error-messages="errors.visit_reason" /></div>
            <div class="grid-col span-12"><v-textarea v-model="form.symptoms_summary" rows="2" label="Symptoms Summary" variant="outlined" density="comfortable" hide-details /></div>
            <div class="grid-col span-12"><v-textarea v-model="form.doctor_notes" rows="2" label="Notes For Doctor" variant="outlined" density="comfortable" hide-details /></div>
            <div class="grid-col span-12">
              <v-checkbox
                v-model="form.consent_acknowledged"
                color="primary"
                label="I confirm details are correct and consent to processing for appointment care."
                :error-messages="errors.consent_acknowledged"
                hide-details="auto"
              />
            </div>
          </div>
        </template>

        <div v-else class="success-state">
          <v-icon icon="mdi-check-decagram" color="success" size="52" />
          <h3>Appointment Confirmed</h3>
          <p>{{ submitSuccess.patientName }} has been queued with booking ID <strong>{{ submitSuccess.bookingId }}</strong>.</p>
          <p>Schedule: {{ submitSuccess.date }} {{ submitSuccess.time }}</p>
        </div>
      </v-card-text>

      <v-card-actions class="modal-actions">
        <template v-if="!submitSuccess">
          <v-btn variant="text" :disabled="submitting" @click="closeModal">Cancel</v-btn>
          <v-spacer />
          <v-btn v-if="step > 1" variant="outlined" :disabled="submitting" @click="previousStep">Back</v-btn>
          <v-btn v-if="step < 3" color="primary" :disabled="submitting || (step === 2 && !isStepTwoReady)" @click="nextStep">Next</v-btn>
          <v-btn v-else color="primary" :loading="submitting" :disabled="submitting" @click="submitBooking">Submit Booking</v-btn>
        </template>
        <template v-else>
          <v-spacer />
          <v-btn color="primary" @click="closeModal">Done</v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss">
.booking-modal { border-radius: 14px; }
.modal-title { font-size: 21px; font-weight: 800; color: #16395d; }
.modal-stepper { display: flex; align-items: center; margin-bottom: 18px; }
.modal-stepper .step { min-width: 120px; display: flex; flex-direction: column; align-items: center; color: #5a7586; font-weight: 700; gap: 6px; }
.modal-stepper .step span { width: 32px; height: 32px; border-radius: 50%; border: 1px solid #c2d7e4; display: flex; align-items: center; justify-content: center; background: #fff; }
.modal-stepper .step.active span { background: #dff2ff; border-color: #79bef1; color: #0f66e8; }
.modal-stepper .step.current span { background: #0f66e8; border-color: #0f66e8; color: #fff; }
.modal-stepper .line { flex: 1; height: 1px; background: #d0e1ea; }
.form-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 12px; }
.grid-col { grid-column: span 12; min-width: 0; }
.grid-col.span-6 { grid-column: span 6; }
.grid-col.span-4 { grid-column: span 4; }
.grid-col.span-3 { grid-column: span 3; }
.review-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.review-grid article { border: 1px solid #d2e3ed; border-radius: 10px; padding: 10px; }
.review-grid label { font-size: 12px; color: #628094; display: block; }
.review-grid strong { color: #183d59; font-size: 14px; }
.error-banner { background: #fff0f0; border: 1px solid #f4cccc; color: #b03232; padding: 8px 10px; border-radius: 8px; margin-bottom: 14px; font-weight: 600; }
.next-dates-card {
  border: 1px solid rgba(76, 104, 168, 0.2);
  border-radius: 12px;
  background: linear-gradient(180deg, #f8fbff 0%, #f3f8ff 100%);
  padding: 10px;
}
.next-dates-title {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.4px;
  color: #24457f;
  margin-bottom: 8px;
  text-transform: uppercase;
}
.next-dates-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.next-date-pill {
  border: 1px solid rgba(54, 86, 143, 0.28);
  border-radius: 999px;
  background: #fff;
  color: #2c4f87;
  font-size: 12px;
  font-weight: 700;
  padding: 6px 12px;
  cursor: pointer;
  transition: all 140ms ease;
}
.next-date-pill:hover {
  border-color: rgba(44, 101, 225, 0.45);
  background: #ecf4ff;
}
.next-date-pill.active {
  border-color: #2f67d2;
  background: linear-gradient(130deg, #2f67d2 0%, #3c97f0 100%);
  color: #fff;
  box-shadow: 0 8px 14px rgba(42, 92, 184, 0.22);
}
.doctor-time-side-wrap {
  display: flex;
  justify-content: flex-end;
}
.doctor-time-side {
  width: min(100%, 430px);
  border: 1px solid rgba(76, 104, 168, 0.2);
  border-radius: 12px;
  background: linear-gradient(180deg, #f8fbff 0%, #f1f7ff 100%);
  padding: 12px;
}
.doctor-time-head {
  margin-bottom: 8px;
}
.doctor-time-title {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: #274985;
}
.doctor-time-meta {
  font-size: 12px;
  color: #5a7392;
}
.doctor-time-reason {
  font-size: 13px;
  color: #2a466f;
}
.doctor-slot-row {
  margin-top: 8px;
}
.doctor-slot-label {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: #4b6484;
  margin-bottom: 6px;
}
.doctor-slot-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.doctor-slot-pill {
  border: 1px solid rgba(54, 86, 143, 0.24);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 700;
  color: #2c4f87;
  background: #fff;
}
.doctor-slot-pill-primary {
  border-color: rgba(47, 103, 210, 0.42);
  background: rgba(47, 103, 210, 0.1);
  color: #1f4d9f;
}
.doctor-item-chip {
  min-width: 56px;
  justify-content: center;
  font-weight: 700;
}
.success-state { text-align: center; padding: 20px 10px; }
.success-state h3 { margin: 10px 0 8px; color: #1c4f36; }
.modal-actions { padding: 14px 20px 20px; }

@media (max-width: 991px) {
  .review-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .modal-stepper .line { display: none; }
  .modal-stepper { gap: 8px; justify-content: center; }
  .grid-col.span-6, .grid-col.span-4, .grid-col.span-3 { grid-column: span 12; }
}

@media (max-width: 680px) {
  .review-grid { grid-template-columns: 1fr; }
}
</style>

