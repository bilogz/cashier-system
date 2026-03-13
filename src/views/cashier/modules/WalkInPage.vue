<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { CheckIcon } from 'vue-tabler-icons';
import SaasDateTimePickerField from '@/components/shared/SaasDateTimePickerField.vue';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';
import { createWalkIn, fetchWalkIns, runWalkInAction, type Severity, type WalkInCase, type WalkInStatus, type WalkInAnalytics } from '@/services/walkInAdmin';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';
import { REALTIME_POLICY } from '@/config/realtimePolicy';
import { emitSuccessModal } from '@/composables/useSuccessModal';

type ActionType = 'new' | 'identify' | 'queue_triage' | 'start_triage' | 'triage' | 'assign' | 'complete' | 'emergency' | 'view';
type UserRole = 'Nurse' | 'Doctor' | 'Admin';

type WalkInForm = {
  patientName: string;
  age: number;
  sex: 'Male' | 'Female' | 'Other' | '';
  dateOfBirth: string;
  contact: string;
  address: string;
  emergencyContact: string;
  existingPatient: boolean;
  patientRef: string;
  visitDepartment: 'General OPD' | 'ER' | 'Pediatrics' | 'Orthopedic' | 'Dental';
  checkinTime: string;
  painScale: number;
  temperatureC: number | null;
  bloodPressure: string;
  pulseBpm: number | null;
  weightKg: number | null;
  complaint: string;
  severity: Severity;
  assignedDoctor: string;
  notes: string;
};

const loadingPage = ref(true);
const pageVisible = ref(false);
const searchQuery = ref('');
const statusFilter = ref<'All' | WalkInStatus>('All');
const severityFilter = ref<'All' | Severity>('All');
const queuePage = ref(1);
const pageSize = 5;
const currentRole = ref<UserRole>('Nurse');
const sessionDoctor = ref('Dr. Humour');
const nowTick = ref(Date.now());

const dialogOpen = ref(false);
const dialogAction = ref<ActionType>('new');
const dialogCase = ref<WalkInCase | null>(null);
const dialogLoading = ref(false);
const detailsDialog = ref(false);
const selectedCase = ref<WalkInCase | null>(null);

const successDialog = ref(false);
const successTitle = ref('Action Completed');
const successMessage = ref('');

const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref<'success' | 'warning' | 'info' | 'error'>('success');

const walkInCases = ref<WalkInCase[]>([]);
const totals = ref<WalkInAnalytics>({ all: 0, triage: 0, doctor: 0, emergency: 0, completed: 0 });
const totalItems = ref(0);
const totalPages = ref(1);
const realtime = useRealtimeListSync();

const caseForm = ref<WalkInForm>({
  patientName: '',
  age: 18,
  sex: '',
  dateOfBirth: '',
  contact: '',
  address: '',
  emergencyContact: '',
  existingPatient: false,
  patientRef: '',
  visitDepartment: 'General OPD',
  checkinTime: new Date().toISOString().slice(0, 16),
  painScale: 0,
  temperatureC: null,
  bloodPressure: '',
  pulseBpm: null,
  weightKg: null,
  complaint: '',
  severity: 'Low',
  assignedDoctor: '',
  notes: ''
});
const formErrors = ref<Partial<Record<keyof WalkInForm, string>>>({});
const assignedDoctorManuallyChanged = ref(false);

const queueLength = computed(() => totalPages.value || 1);
const pagedCases = computed(() => walkInCases.value);
const doctorOptions = computed(() => {
  const base = ['Dr. Humour', 'Dr. Jenni', 'Dr. Rivera', 'Dr. Martinez', 'Nurse Triage', 'ER Team'];
  const dynamic = walkInCases.value
    .map((item) => item.assigned_doctor.trim())
    .filter((name) => Boolean(name) && name.toLowerCase() !== 'unassigned');
  const merged = Array.from(new Set([sessionDoctor.value, ...base, ...dynamic].filter(Boolean)));
  return merged;
});
const isNewWalkInEmergency = computed(() => dialogAction.value === 'new' && caseForm.value.severity === 'Emergency');
const estimatedWaitMinutes = computed(() => {
  const queueLoad = Math.max(1, totals.value.doctor || 1);
  return queueLoad * 12;
});
const queuePreview = computed(() => {
  return `W-${String(totalItems.value + 1).padStart(3, '0')}`;
});
const existingPatientHits = computed(() => {
  const targetName = caseForm.value.patientName.trim().toLowerCase();
  const targetContact = caseForm.value.contact.trim().toLowerCase();
  if (!targetName && !targetContact) return [];
  return walkInCases.value.filter((item) => {
    const nameMatch = targetName && item.patient_name.trim().toLowerCase() === targetName;
    const contactMatch = targetContact && item.contact.trim().toLowerCase() === targetContact;
    return Boolean(nameMatch || contactMatch);
  });
});

const dialogTitle = computed(() => {
  if (dialogAction.value === 'new') return 'New Walk-In';
  if (dialogAction.value === 'identify') return 'Patient Identification';
  if (dialogAction.value === 'queue_triage') return 'Queue to Triage';
  if (dialogAction.value === 'start_triage') return 'Start Triage';
  if (dialogAction.value === 'triage') return 'Intake / Triage';
  if (dialogAction.value === 'assign') return 'Assign Doctor';
  if (dialogAction.value === 'complete') return 'Mark as Complete';
  if (dialogAction.value === 'view') return 'Patient Details';
  return 'Emergency Escalation';
});

const dialogActionText = computed(() => {
  if (dialogAction.value === 'new') return 'Create Case';
  if (dialogAction.value === 'identify') return 'Confirm Identify';
  if (dialogAction.value === 'queue_triage') return 'Move to Triage Pending';
  if (dialogAction.value === 'start_triage') return 'Start Triage';
  if (dialogAction.value === 'triage') return 'Save Triage';
  if (dialogAction.value === 'assign') return 'Assign Doctor';
  if (dialogAction.value === 'complete') return 'Confirm Complete';
  if (dialogAction.value === 'view') return 'Close';
  return 'Escalate to Emergency';
});

const dialogActionIcon = computed(() => {
  if (dialogAction.value === 'new') return 'mdi-plus-circle-outline';
  if (dialogAction.value === 'identify') return 'mdi-account-search-outline';
  if (dialogAction.value === 'queue_triage') return 'mdi-arrow-right-circle-outline';
  if (dialogAction.value === 'start_triage') return 'mdi-play-circle-outline';
  if (dialogAction.value === 'triage') return 'mdi-clipboard-pulse-outline';
  if (dialogAction.value === 'assign') return 'mdi-stethoscope';
  if (dialogAction.value === 'complete') return 'mdi-check-circle-outline';
  if (dialogAction.value === 'view') return 'mdi-eye-outline';
  return 'mdi-alert-circle-outline';
});

function statusColor(status: WalkInStatus): string {
  if (status === 'completed') return 'success';
  if (status === 'emergency') return 'error';
  if (status === 'waiting_for_doctor') return 'warning';
  if (status === 'triage_pending') return 'secondary';
  if (status === 'in_triage') return 'info';
  return 'grey';
}

function severityColor(severity: Severity): string {
  if (severity === 'Emergency') return 'error';
  if (severity === 'Moderate') return 'warning';
  return 'success';
}

function statusLabel(status: WalkInStatus): string {
  if (status === 'waiting') return 'Waiting';
  if (status === 'identified') return 'Identified';
  if (status === 'triage_pending') return 'Triage Pending';
  if (status === 'in_triage') return 'In Triage';
  if (status === 'waiting_for_doctor') return 'Waiting for Doctor';
  if (status === 'completed') return 'Completed';
  return 'Emergency';
}

function toInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'PT';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

function formatTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value || '--';
  return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(parsed);
}

function waitTimeText(value: string): string {
  nowTick.value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '--';
  const diffMs = Math.max(0, Date.now() - parsed.getTime());
  const mins = Math.floor(diffMs / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function isDoctorAssigned(item: WalkInCase): boolean {
  return item.assigned_doctor.trim().toLowerCase() === sessionDoctor.value.trim().toLowerCase();
}

function canRunAction(action: ActionType, item: WalkInCase): boolean {
  if (action === 'view') return true;
  if (action === 'identify') return item.status === 'waiting';
  if (action === 'queue_triage') return item.status === 'identified';
  if (action === 'start_triage') return item.status === 'triage_pending';
  if (action === 'triage') return item.status === 'in_triage';
  if (action === 'assign') return item.status === 'waiting_for_doctor';
  if (action === 'complete') return item.status === 'waiting_for_doctor';
  if (action === 'emergency') return item.status !== 'completed' && item.status !== 'emergency';
  return true;
}

function canRoleUse(action: ActionType, item?: WalkInCase): boolean {
  if (currentRole.value === 'Admin') return true;
  if (currentRole.value === 'Nurse') return ['identify', 'queue_triage', 'start_triage', 'triage', 'view', 'emergency', 'new'].includes(action);
  if (action === 'complete' && item) return isDoctorAssigned(item);
  return ['view', 'emergency'].includes(action);
}

function primaryAction(item: WalkInCase): { action: ActionType; label: string } {
  if (item.status === 'waiting') return { action: 'identify', label: 'Identify Patient' };
  if (item.status === 'identified') return { action: 'queue_triage', label: 'Queue to Triage' };
  if (item.status === 'triage_pending') return { action: 'start_triage', label: 'Start Triage' };
  if (item.status === 'in_triage') return { action: 'triage', label: 'Save Triage' };
  if (item.status === 'waiting_for_doctor') {
    if (currentRole.value === 'Doctor') return isDoctorAssigned(item) ? { action: 'complete', label: 'Complete Case' } : { action: 'view', label: 'View Details' };
    if (currentRole.value === 'Admin') return { action: 'assign', label: 'Assign Doctor' };
    return { action: 'view', label: 'View Details' };
  }
  return { action: 'view', label: 'View Details' };
}

function rowPriorityClass(item: WalkInCase): string {
  if (item.severity === 'Emergency') return 'priority-emergency';
  if (item.severity === 'Moderate') return 'priority-moderate';
  return 'priority-low';
}

function resetForm(): void {
  const defaultDoctor = currentRole.value === 'Doctor' ? sessionDoctor.value : 'Nurse Triage';
  caseForm.value = {
    patientName: '',
    age: 18,
    sex: '',
    dateOfBirth: '',
    contact: '',
    address: '',
    emergencyContact: '',
    existingPatient: false,
    patientRef: '',
    visitDepartment: 'General OPD',
    checkinTime: new Date().toISOString().slice(0, 16),
    painScale: 0,
    temperatureC: null,
    bloodPressure: '',
    pulseBpm: null,
    weightKg: null,
    complaint: '',
    severity: 'Low',
    assignedDoctor: defaultDoctor || 'Nurse Triage',
    notes: ''
  };
  formErrors.value = {};
  assignedDoctorManuallyChanged.value = false;
}

function applyCaseToForm(item: WalkInCase): void {
  caseForm.value = {
    patientName: item.patient_name,
    age: item.age,
    sex: item.sex || '',
    dateOfBirth: item.date_of_birth || '',
    contact: item.contact,
    address: item.address || '',
    emergencyContact: item.emergency_contact || '',
    existingPatient: Boolean(item.patient_ref),
    patientRef: item.patient_ref || '',
    visitDepartment: (item.visit_department as WalkInForm['visitDepartment']) || 'General OPD',
    checkinTime: item.checkin_time ? new Date(item.checkin_time).toISOString().slice(0, 16) : new Date(item.intake_time).toISOString().slice(0, 16),
    painScale: item.pain_scale ?? 0,
    temperatureC: item.temperature_c ?? null,
    bloodPressure: item.blood_pressure || '',
    pulseBpm: item.pulse_bpm ?? null,
    weightKg: item.weight_kg ?? null,
    complaint: item.chief_complaint,
    severity: item.severity,
    assignedDoctor: item.assigned_doctor,
    notes: ''
  };
}

function showToast(message: string, color: 'success' | 'warning' | 'info' | 'error' = 'success'): void {
  if (color === 'success') {
    emitSuccessModal({ title: 'Success', message, tone: 'success' });
    return;
  }
  snackbarText.value = message;
  snackbarColor.value = color;
  snackbar.value = true;
}

function showSuccess(title: string, message: string): void {
  successTitle.value = title;
  successMessage.value = message;
  successDialog.value = true;
}

async function loadWalkIns(options: { silent?: boolean } = {}): Promise<void> {
  const payload = await realtime.runLatest(
    async () =>
      fetchWalkIns({
        search: searchQuery.value.trim(),
        status: statusFilter.value,
        severity: severityFilter.value,
        page: queuePage.value,
        perPage: pageSize
      }),
    {
      silent: options.silent,
      onError: (error) => {
        showToast(error instanceof Error ? error.message : String(error), 'error');
      }
    }
  );
  if (!payload) return;

  walkInCases.value = payload.items;
  totals.value = payload.analytics;
  totalItems.value = payload.meta.total;
  totalPages.value = payload.meta.totalPages;
}

let nowTickTimer: ReturnType<typeof setInterval> | null = null;

function openAction(action: ActionType, item?: WalkInCase): void {
  if (action === 'view' && item) {
    selectedCase.value = item;
    detailsDialog.value = true;
    return;
  }

  dialogAction.value = action;
  dialogCase.value = item || null;

  if (action === 'new') {
    resetForm();
  } else if (item) {
    applyCaseToForm(item);
    if (action === 'assign' && (!caseForm.value.assignedDoctor.trim() || caseForm.value.assignedDoctor === 'Unassigned')) {
      caseForm.value.assignedDoctor = sessionDoctor.value || 'Dr. Humour';
    }
  }

  dialogOpen.value = true;
}

watch(sessionDoctor, (value) => {
  if (!dialogOpen.value || dialogAction.value !== 'new') return;
  if (assignedDoctorManuallyChanged.value) return;
  if (caseForm.value.severity === 'Emergency') return;
  caseForm.value.assignedDoctor = value || 'Nurse Triage';
});

watch(
  () => caseForm.value.severity,
  (severity) => {
    if (dialogAction.value !== 'new') return;
    if (severity === 'Emergency') {
      caseForm.value.assignedDoctor = 'ER Team';
      return;
    }
    if (assignedDoctorManuallyChanged.value) return;
    const defaultDoctor = currentRole.value === 'Doctor' ? sessionDoctor.value : 'Nurse Triage';
    caseForm.value.assignedDoctor = defaultDoctor || 'Nurse Triage';
  }
);

function computeAgeFromDob(value: string): number {
  if (!value) return caseForm.value.age;
  const dob = new Date(value);
  if (Number.isNaN(dob.getTime())) return caseForm.value.age;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age -= 1;
  return Math.max(0, age);
}

watch(
  () => caseForm.value.dateOfBirth,
  (value) => {
    if (dialogAction.value !== 'new') return;
    caseForm.value.age = computeAgeFromDob(value);
  }
);

function validateNewWalkInForm(): boolean {
  const errors: Partial<Record<keyof WalkInForm, string>> = {};
  const name = caseForm.value.patientName.trim();
  const contact = caseForm.value.contact.trim();
  const complaint = caseForm.value.complaint.trim();
  const assigned = caseForm.value.assignedDoctor.trim();

  if (!name) errors.patientName = 'Patient name is required.';
  if (!contact) errors.contact = 'Contact number is required.';
  if (!complaint) errors.complaint = 'Chief complaint is required.';
  if (!assigned) errors.assignedDoctor = 'Assigned doctor/staff is required.';
  if (!caseForm.value.sex) errors.sex = 'Sex is required.';
  if (!caseForm.value.dateOfBirth) errors.dateOfBirth = 'Date of birth is required.';
  if (!caseForm.value.visitDepartment) errors.visitDepartment = 'Visit department is required.';
  if (!caseForm.value.checkinTime) errors.checkinTime = 'Check-in time is required.';
  if (caseForm.value.existingPatient && !caseForm.value.patientRef.trim()) {
    errors.patientRef = 'Patient ID/MRN is required for existing patients.';
  }
  if (caseForm.value.painScale < 0 || caseForm.value.painScale > 10) {
    errors.painScale = 'Pain scale must be between 0 and 10.';
  }
  if (caseForm.value.temperatureC !== null && (caseForm.value.temperatureC < 30 || caseForm.value.temperatureC > 45)) {
    errors.temperatureC = 'Temperature must be 30C to 45C.';
  }
  if (caseForm.value.pulseBpm !== null && (caseForm.value.pulseBpm < 20 || caseForm.value.pulseBpm > 240)) {
    errors.pulseBpm = 'Pulse must be 20 to 240 bpm.';
  }
  if (!Number.isFinite(caseForm.value.age) || caseForm.value.age < 0 || caseForm.value.age > 120) {
    errors.age = 'Age must be between 0 and 120.';
  }

  formErrors.value = errors;
  return Object.keys(errors).length === 0;
}

function closeAction(): void {
  if (dialogLoading.value) return;
  dialogOpen.value = false;
}

async function executeAction(): Promise<void> {
  if (dialogAction.value === 'view') {
    dialogOpen.value = false;
    return;
  }
  if (dialogAction.value === 'new') {
    if (!validateNewWalkInForm()) return;
  }
  if (dialogAction.value === 'triage' && !caseForm.value.complaint.trim()) {
    showToast('Chief complaint is required before saving triage.', 'warning');
    return;
  }
  if (dialogAction.value === 'assign' && !caseForm.value.assignedDoctor.trim()) {
    showToast('Assigned doctor is required.', 'warning');
    return;
  }
  dialogLoading.value = true;
  try {
    if (dialogAction.value === 'new') {
      const created = await createWalkIn({
        patient_name: caseForm.value.patientName.trim(),
        age: caseForm.value.age,
        sex: caseForm.value.sex,
        date_of_birth: caseForm.value.dateOfBirth || undefined,
        contact: caseForm.value.contact.trim(),
        address: caseForm.value.address.trim() || undefined,
        emergency_contact: caseForm.value.emergencyContact.trim() || undefined,
        patient_ref: caseForm.value.existingPatient ? caseForm.value.patientRef.trim() : undefined,
        visit_department: caseForm.value.visitDepartment,
        checkin_time: caseForm.value.checkinTime || undefined,
        pain_scale: caseForm.value.painScale,
        temperature_c: caseForm.value.temperatureC ?? undefined,
        blood_pressure: caseForm.value.bloodPressure.trim() || undefined,
        pulse_bpm: caseForm.value.pulseBpm ?? undefined,
        weight_kg: caseForm.value.weightKg ?? undefined,
        chief_complaint: caseForm.value.complaint.trim(),
        severity: caseForm.value.severity,
        assigned_doctor: caseForm.value.assignedDoctor
      });

      if (caseForm.value.severity === 'Emergency') {
        await runWalkInAction({ action: 'emergency', id: created.id });
        showSuccess('Emergency Case Created', 'Walk-in has been created and escalated to emergency routing.');
      } else {
        showSuccess('Walk-In Created', 'New walk-in case has been queued for triage.');
      }
      } else if (dialogCase.value) {
      await runWalkInAction({
        action: dialogAction.value,
        id: dialogCase.value.id,
        chief_complaint: caseForm.value.complaint,
        severity: caseForm.value.severity,
        assigned_doctor: caseForm.value.assignedDoctor
      });

      if (dialogAction.value === 'complete') showSuccess('Case Completed', 'Patient visit was successfully marked as completed.');
      else if (dialogAction.value === 'emergency') showSuccess('Emergency Escalated', 'Case has been moved to emergency priority routing.');
      else if (dialogAction.value === 'queue_triage') showSuccess('Queued for Triage', 'Patient is now triage pending.');
      else if (dialogAction.value === 'start_triage') showSuccess('Triage Started', 'Case is now in active triage stage.');
      else if (dialogAction.value === 'assign') showSuccess('Doctor Assigned', 'Case has been assigned and queued for doctor.');
      else if (dialogAction.value === 'triage') showSuccess('Triage Saved', 'Triage assessment saved and status updated.');
      else showSuccess('Patient Identified', 'Patient profile confirmed and moved to identified stage.');
    }

    dialogOpen.value = false;
    await loadWalkIns();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    dialogLoading.value = false;
  }
}

watch([searchQuery, statusFilter, severityFilter], () => {
  queuePage.value = 1;
  void loadWalkIns();
});

watch(queuePage, () => {
  void loadWalkIns();
});

onMounted(async () => {
  await loadWalkIns();
  nowTickTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, REALTIME_POLICY.uiTick.walkInClockMs);
  realtime.startPolling(() => {
    void loadWalkIns({ silent: true });
  }, REALTIME_POLICY.polling.walkInMs);
  loadingPage.value = false;
  requestAnimationFrame(() => {
    pageVisible.value = true;
  });
});

onBeforeUnmount(() => {
  realtime.stopPolling();
  realtime.invalidatePending();
  if (nowTickTimer) clearInterval(nowTickTimer);
});
</script>

<template>
  <div class="walkin-page">
    <div v-if="loadingPage">
      <v-skeleton-loader type="heading, text" class="mb-4" />
      <v-row class="mb-4">
        <v-col cols="12" sm="6" lg="3" v-for="n in 4" :key="`walkin-skeleton-${n}`">
          <v-skeleton-loader type="card" />
        </v-col>
      </v-row>
      <v-card variant="outlined">
        <v-card-text>
          <v-skeleton-loader type="table-heading, table-row-divider@6" />
        </v-card-text>
      </v-card>
    </div>

    <div v-else class="walkin-content" :class="{ 'is-visible': pageVisible }">
      <v-card class="hero-banner mb-4" elevation="0">
        <v-card-text class="pa-5">
          <div class="d-flex flex-wrap align-center justify-space-between ga-4">
            <div>
              <div class="hero-kicker">Clinical Operations</div>
              <h1 class="text-h4 font-weight-black mb-1">Walk-In Clinic Operations</h1>
              <p class="hero-subtitle mb-0">Operational flow for handling unscheduled patient visits.</p>
            </div>
            <div class="hero-side-card">
              <v-select
                v-model="currentRole"
                :items="['Nurse', 'Doctor', 'Admin']"
                density="compact"
                variant="outlined"
                hide-details
                class="mb-2 role-select"
                prepend-inner-icon="mdi-account-badge-outline"
                label="Role"
              />
              <v-select
                v-if="currentRole === 'Doctor'"
                v-model="sessionDoctor"
                :items="['Dr. Humour', 'Dr. Jenni', 'Dr. Rivera', 'Dr. Martinez']"
                density="compact"
                variant="outlined"
                hide-details
                class="mb-2 role-select"
                prepend-inner-icon="mdi-stethoscope"
                label="Session Doctor"
              />
              <div class="hero-side-label">New Intake</div>
              <div class="hero-side-text">Create and route new walk-in cases from one queue.</div>
            </div>
          </div>
        </v-card-text>
      </v-card>

      <v-row class="mb-4">
        <v-col cols="12" sm="6" lg="3">
          <v-card class="metric-card metric-blue" elevation="0"><v-card-text><div class="metric-label">Total Queue</div><div class="metric-value">{{ totals.all }}</div><div class="metric-subtitle">All active and completed</div></v-card-text></v-card>
        </v-col>
        <v-col cols="12" sm="6" lg="3">
          <v-card class="metric-card metric-indigo" elevation="0"><v-card-text><div class="metric-label">Triage Pending</div><div class="metric-value">{{ totals.triage }}</div><div class="metric-subtitle">Needs intake assessment</div></v-card-text></v-card>
        </v-col>
        <v-col cols="12" sm="6" lg="3">
          <v-card class="metric-card metric-orange" elevation="0"><v-card-text><div class="metric-label">Waiting / Consult</div><div class="metric-value">{{ totals.doctor }}</div><div class="metric-subtitle">Doctor assignment in progress</div></v-card-text></v-card>
        </v-col>
        <v-col cols="12" sm="6" lg="3">
          <v-card class="metric-card metric-red" elevation="0"><v-card-text><div class="metric-label">Emergency</div><div class="metric-value">{{ totals.emergency }}</div><div class="metric-subtitle">Immediate priority queue</div></v-card-text></v-card>
        </v-col>
      </v-row>

      <v-card variant="outlined">
        <v-card-item>
          <v-card-title>Live Walk-In Queue</v-card-title>
          <template #append>
            <v-btn color="primary" prepend-icon="mdi-account-plus-outline" rounded="pill" class="saas-primary-btn" @click="openAction('new')">New Walk-In</v-btn>
          </template>
        </v-card-item>
        <v-card-text>
          <v-row class="mb-3">
            <v-col cols="12" md="6">
              <v-text-field v-model="searchQuery" density="comfortable" variant="outlined" prepend-inner-icon="mdi-magnify" hide-details placeholder="Search by case id, patient, concern, or doctor..." />
            </v-col>
            <v-col cols="12" sm="6" md="3">
              <v-select
                :items="['All', 'waiting', 'identified', 'triage_pending', 'in_triage', 'waiting_for_doctor', 'completed', 'emergency']"
                v-model="statusFilter"
                density="comfortable"
                variant="outlined"
                hide-details
                prepend-inner-icon="mdi-filter-outline"
              />
            </v-col>
            <v-col cols="12" sm="6" md="3">
              <v-select :items="['All', 'Low', 'Moderate', 'Emergency']" v-model="severityFilter" density="comfortable" variant="outlined" hide-details prepend-inner-icon="mdi-alert-outline" />
            </v-col>
          </v-row>

          <v-table density="comfortable" class="walkin-table">
            <thead>
              <tr>
                <th>CASE ID</th>
                <th>PATIENT</th>
                <th>COMPLAINT</th>
                <th>SEVERITY</th>
                <th>STATUS</th>
                <th>WAIT TIME</th>
                <th>DOCTOR</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in pagedCases" :key="item.case_id" :class="rowPriorityClass(item)" @click="openAction('view', item)">
                <td class="font-weight-medium">{{ item.case_id }}</td>
                <td>
                  <div class="d-flex align-center ga-2">
                    <v-avatar size="30" color="primary" variant="tonal">{{ toInitials(item.patient_name) }}</v-avatar>
                    <div>
                      <div class="font-weight-medium">{{ item.patient_name }} <span class="text-medium-emphasis">{{ item.age }}</span></div>
                      <div class="text-caption text-medium-emphasis">{{ item.contact }} • {{ formatTime(item.intake_time) }}</div>
                    </div>
                  </div>
                </td>
                <td>{{ item.chief_complaint }}</td>
                <td><v-chip size="small" variant="tonal" :color="severityColor(item.severity)">{{ item.severity }}</v-chip></td>
                <td><v-chip size="small" variant="tonal" :color="statusColor(item.status)">{{ statusLabel(item.status) }}</v-chip></td>
                <td class="font-weight-medium">{{ waitTimeText(item.intake_time) }}</td>
                <td>{{ item.assigned_doctor }}</td>
                <td>
                  <div class="actions-inline">
                    <v-btn
                      size="small"
                      rounded="pill"
                      class="action-text-btn"
                      color="primary"
                      variant="flat"
                      :disabled="!canRoleUse(primaryAction(item).action, item) || !canRunAction(primaryAction(item).action, item)"
                      @click.stop="openAction(primaryAction(item).action, item)"
                    >
                      {{ primaryAction(item).label }}
                    </v-btn>
                    <v-btn
                      v-if="canRunAction('emergency', item)"
                      size="small"
                      rounded="pill"
                      class="action-text-btn emergency-action-btn"
                      color="error"
                      variant="outlined"
                      :disabled="!canRoleUse('emergency', item)"
                      @click.stop="openAction('emergency', item)"
                    >
                      Emergency Override
                    </v-btn>
                  </div>
                </td>
              </tr>
              <tr v-if="pagedCases.length === 0"><td colspan="8" class="text-center text-medium-emphasis py-5">No walk-in cases found for the selected filters.</td></tr>
            </tbody>
          </v-table>

          <div class="d-flex align-center mt-3 text-caption text-medium-emphasis">
            <span>Showing {{ pagedCases.length }} of {{ totalItems }} cases</span>
            <v-spacer />
            <v-pagination v-model="queuePage" :length="queueLength" density="comfortable" total-visible="7" />
          </div>
        </v-card-text>
      </v-card>
    </div>

    <ModuleActivityLogs module="walkin" title="Module Activity Logs" :per-page="8" />

    <v-dialog v-model="dialogOpen" max-width="660" transition="dialog-bottom-transition">
      <v-card class="walkin-dialog-card">
        <v-card-title class="walkin-modal-title text-h5 font-weight-bold">{{ dialogTitle }}</v-card-title>
        <v-card-subtitle class="pt-2">Action confirmation for real walk-in queue records.</v-card-subtitle>
        <v-card-text class="pt-4">
          <template v-if="dialogAction === 'new'">
            <v-row class="ga-2">
              <v-col cols="12">
                <v-alert type="info" variant="tonal" density="comfortable" class="mb-2">
                  Queue # <strong>{{ queuePreview }}</strong> • Estimated wait: <strong>{{ estimatedWaitMinutes }} min</strong>
                </v-alert>
              </v-col>

              <v-col cols="12">
                <div class="intake-section-title">Patient Identity</div>
              </v-col>
              <v-col cols="12" md="7">
                <v-text-field v-model="caseForm.patientName" label="Patient Name *" variant="outlined" density="comfortable" :error-messages="formErrors.patientName" />
              </v-col>
              <v-col cols="12" md="5">
                <v-select :items="['Male', 'Female', 'Other']" v-model="caseForm.sex" label="Gender / Sex *" variant="outlined" density="comfortable" :error-messages="formErrors.sex" />
              </v-col>
              <v-col cols="12" md="4">
                <SaasDateTimePickerField v-model="caseForm.dateOfBirth" mode="date" label="Date of Birth *" :error-messages="formErrors.dateOfBirth" />
              </v-col>
              <v-col cols="12" md="2">
                <v-text-field v-model.number="caseForm.age" type="number" min="0" max="120" label="Age" variant="outlined" density="comfortable" readonly :error-messages="formErrors.age" />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="caseForm.contact" label="Contact Number *" variant="outlined" density="comfortable" :error-messages="formErrors.contact" />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="caseForm.emergencyContact" label="Emergency Contact" variant="outlined" density="comfortable" />
              </v-col>
              <v-col cols="12">
                <v-text-field v-model="caseForm.address" label="Address" variant="outlined" density="comfortable" />
              </v-col>
              <v-col cols="12" md="4">
                <v-switch v-model="caseForm.existingPatient" inset label="Existing Patient?" color="primary" hide-details />
              </v-col>
              <v-col cols="12" md="8" v-if="caseForm.existingPatient">
                <v-text-field v-model="caseForm.patientRef" label="Patient ID / MRN *" variant="outlined" density="comfortable" :error-messages="formErrors.patientRef" />
              </v-col>

              <v-col cols="12">
                <div class="intake-section-title">Visit Routing</div>
              </v-col>
              <v-col cols="12" md="4">
                <SaasDateTimePickerField v-model="caseForm.checkinTime" mode="datetime" label="Check-in Time *" :error-messages="formErrors.checkinTime" />
              </v-col>
              <v-col cols="12" md="4">
                <v-select :items="['General OPD', 'ER', 'Pediatrics', 'Orthopedic', 'Dental']" v-model="caseForm.visitDepartment" label="Visit Department *" variant="outlined" density="comfortable" :error-messages="formErrors.visitDepartment" />
              </v-col>
              <v-col cols="12" md="4">
                <v-select :items="['Low', 'Moderate', 'Emergency']" v-model="caseForm.severity" label="Triage Priority" variant="outlined" density="comfortable" />
              </v-col>
              <v-col cols="12">
                <v-text-field v-model="caseForm.complaint" label="Chief Complaint *" variant="outlined" density="comfortable" :error-messages="formErrors.complaint" />
              </v-col>

              <v-col cols="12">
                <div class="intake-section-title">Triage Vitals</div>
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field
                  v-model.number="caseForm.painScale"
                  type="number"
                  min="0"
                  max="10"
                  label="Pain Scale (0-10)"
                  variant="outlined"
                  density="comfortable"
                  :error-messages="formErrors.painScale"
                />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field v-model.number="caseForm.temperatureC" type="number" step="0.1" label="Temperature (C)" variant="outlined" density="comfortable" :error-messages="formErrors.temperatureC" />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field v-model.number="caseForm.pulseBpm" type="number" label="Pulse (bpm)" variant="outlined" density="comfortable" :error-messages="formErrors.pulseBpm" />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="caseForm.bloodPressure" label="Blood Pressure (e.g. 120/80)" variant="outlined" density="comfortable" />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model.number="caseForm.weightKg" type="number" step="0.1" label="Weight (kg)" variant="outlined" density="comfortable" />
              </v-col>

              <v-col cols="12">
                <div class="intake-section-title">Assignment</div>
              </v-col>
              <v-col cols="12">
                <v-select
                  v-model="caseForm.assignedDoctor"
                  :items="doctorOptions"
                  label="Assigned Doctor/Staff *"
                  variant="outlined"
                  density="comfortable"
                  @update:model-value="assignedDoctorManuallyChanged = true"
                  :error-messages="formErrors.assignedDoctor"
                  :disabled="isNewWalkInEmergency"
                  :hint="isNewWalkInEmergency ? 'Emergency cases are auto-routed to ER Team.' : 'Default assignment follows current session role.'"
                  persistent-hint
                />
              </v-col>

              <v-col cols="12" v-if="existingPatientHits.length > 0">
                <v-alert type="warning" variant="tonal" density="comfortable">
                  Possible duplicate record(s): {{ existingPatientHits.map((item) => `${item.patient_name} (${item.case_id})`).join(', ') }}
                </v-alert>
              </v-col>
            </v-row>
          </template>

          <template v-else-if="dialogAction === 'identify' && dialogCase">
            <v-alert type="info" variant="tonal" class="mb-3">Loading existing profile for <strong>{{ dialogCase.patient_name }}</strong> ({{ dialogCase.case_id }}).</v-alert>
            <div class="text-medium-emphasis">This action confirms profile and sets status to <strong>identified</strong>.</div>
          </template>

          <template v-else-if="dialogAction === 'queue_triage' && dialogCase">
            <v-alert type="info" variant="tonal" class="mb-3">Move <strong>{{ dialogCase.patient_name }}</strong> to triage queue?</v-alert>
            <div class="text-medium-emphasis">Status will update to <strong>triage_pending</strong>.</div>
          </template>

          <template v-else-if="dialogAction === 'start_triage' && dialogCase">
            <v-alert type="info" variant="tonal" class="mb-3">Start triage for <strong>{{ dialogCase.patient_name }}</strong>?</v-alert>
            <div class="text-medium-emphasis">Case will move to <strong>in triage</strong>.</div>
          </template>

          <template v-else-if="dialogAction === 'triage'">
            <v-row>
              <v-col cols="12" md="7"><v-text-field v-model="caseForm.patientName" label="Patient Name" variant="outlined" density="comfortable" disabled /></v-col>
              <v-col cols="12" md="5"><v-text-field v-model.number="caseForm.age" type="number" label="Age" variant="outlined" density="comfortable" disabled /></v-col>
              <v-col cols="12" md="6"><v-text-field v-model="caseForm.contact" label="Contact Number" variant="outlined" density="comfortable" disabled /></v-col>
              <v-col cols="12" md="6"><v-select :items="['Low', 'Moderate', 'Emergency']" v-model="caseForm.severity" label="Severity" variant="outlined" density="comfortable" /></v-col>
              <v-col cols="12"><v-text-field v-model="caseForm.complaint" label="Chief Complaint" variant="outlined" density="comfortable" /></v-col>
              <v-col cols="12"><v-text-field v-model="caseForm.notes" label="Nurse Notes" variant="outlined" density="comfortable" placeholder="Assessment notes..." /></v-col>
            </v-row>
          </template>

          <template v-else-if="dialogAction === 'assign'">
            <v-row>
              <v-col cols="12">
                <v-select
                  v-model="caseForm.assignedDoctor"
                  :items="doctorOptions"
                  label="Assign Doctor"
                  variant="outlined"
                  density="comfortable"
                />
              </v-col>
            </v-row>
          </template>

          <template v-else-if="dialogAction === 'complete' && dialogCase">
            <v-alert type="success" variant="tonal" class="mb-3">Mark <strong>{{ dialogCase.patient_name }}</strong> as completed?</v-alert>
            <div class="text-medium-emphasis">Current doctor: <strong>{{ dialogCase.assigned_doctor }}</strong></div>
          </template>

          <template v-else-if="dialogAction === 'emergency' && dialogCase">
            <v-alert type="error" variant="tonal" class="mb-3">Escalate <strong>{{ dialogCase.patient_name }}</strong> to emergency queue now?</v-alert>
            <div class="text-medium-emphasis">This will prioritize the case and assign <strong>ER Team</strong>.</div>
          </template>
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn variant="text" prepend-icon="mdi-close" @click="closeAction">Cancel</v-btn>
          <v-btn color="primary" rounded="pill" class="saas-primary-btn" :append-icon="dialogActionIcon" :loading="dialogLoading" @click="executeAction">{{ dialogActionText }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="detailsDialog" max-width="580">
      <v-card class="walkin-dialog-card">
        <v-card-title class="walkin-modal-title text-h6 font-weight-bold">Patient Details</v-card-title>
        <v-card-text v-if="selectedCase" class="pt-4">
          <v-list density="comfortable" lines="one">
            <v-list-item title="Case ID" :subtitle="selectedCase.case_id" />
            <v-list-item title="Patient" :subtitle="`${selectedCase.patient_name}, ${selectedCase.age}`" />
            <v-list-item title="Contact" :subtitle="selectedCase.contact || '--'" />
            <v-list-item title="Complaint" :subtitle="selectedCase.chief_complaint || '--'" />
            <v-list-item title="Severity" :subtitle="selectedCase.severity" />
            <v-list-item title="Workflow Status" :subtitle="statusLabel(selectedCase.status)" />
            <v-list-item title="Wait Time" :subtitle="waitTimeText(selectedCase.intake_time)" />
            <v-list-item title="Assigned Doctor" :subtitle="selectedCase.assigned_doctor || '--'" />
          </v-list>
        </v-card-text>
        <v-card-actions class="justify-end pb-5 px-6">
          <v-btn rounded="pill" color="primary" class="saas-primary-btn" @click="detailsDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="successDialog" max-width="420" persistent>
      <v-card class="success-modal-card">
        <v-card-text class="pa-7 text-center">
          <div class="success-icon-wrap">
            <div class="success-pulse" />
            <v-avatar size="74" color="success" class="success-icon">
              <CheckIcon size="34" color="white" stroke-width="3" />
            </v-avatar>
          </div>
          <h3 class="text-h5 font-weight-bold mt-4 mb-2">{{ successTitle }}</h3>
          <p class="text-body-2 text-medium-emphasis mb-5">{{ successMessage }}</p>
          <v-btn color="success" rounded="pill" class="saas-primary-btn" prepend-icon="mdi-check-circle-outline" @click="successDialog = false">
            Done
          </v-btn>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="2200">{{ snackbarText }}</v-snackbar>
  </div>
</template>

<style scoped>
.walkin-content { opacity: 0; transform: translateY(12px); transition: opacity 320ms ease, transform 320ms ease; }
.walkin-content.is-visible { opacity: 1; transform: translateY(0); }

.hero-banner { border-radius: 16px; color: #fff; background: linear-gradient(120deg, #162d84 0%, #2f63cc 54%, #3ea8f0 100%); box-shadow: 0 14px 30px rgba(19, 45, 126, 0.22); }
.hero-kicker { display: inline-flex; align-items: center; padding: 4px 12px; margin-bottom: 10px; border-radius: 999px; background: rgba(255, 255, 255, 0.14); border: 1px solid rgba(255, 255, 255, 0.32); font-size: 12px; font-weight: 700; letter-spacing: 0.55px; text-transform: uppercase; }
.hero-subtitle { color: rgba(255, 255, 255, 0.95); text-shadow: 0 1px 2px rgba(8, 20, 52, 0.35); }
.hero-side-card { min-width: 260px; padding: 14px; border-radius: 14px; background: rgba(255, 255, 255, 0.9); color: #14316e; }
.role-select :deep(.v-field) { background: #fff; }
.hero-side-label { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
.hero-side-text { margin-top: 4px; font-size: 13px; }

.metric-card { color: #fff; border-radius: 12px; box-shadow: 0 10px 24px rgba(12, 31, 60, 0.18); transition: transform 220ms ease, box-shadow 220ms ease; }
.metric-card:hover { transform: translateY(-3px); box-shadow: 0 14px 26px rgba(12, 31, 60, 0.2); }
.metric-blue { background: linear-gradient(135deg, #40a9f2 0%, #357adf 100%); }
.metric-indigo { background: linear-gradient(135deg, #5a6de2 0%, #3949ab 100%); }
.metric-orange { background: linear-gradient(135deg, #ff9800 0%, #ff6f00 100%); }
.metric-red { background: linear-gradient(135deg, #ef5350 0%, #e53935 100%); }
.metric-label { font-size: 12px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; }
.metric-value { margin-top: 4px; font-size: 38px; line-height: 1.1; font-weight: 800; }
.metric-subtitle { margin-top: 2px; opacity: 0.95; }

.saas-primary-btn { box-shadow: 0 8px 18px rgba(24, 104, 208, 0.3); font-weight: 700; letter-spacing: 0.2px; text-transform: none; }
.actions-inline { display: flex; gap: 8px; align-items: center; justify-content: flex-start; min-width: 290px; }
.action-text-btn { text-transform: none; font-weight: 700; min-width: 130px; }
.emergency-action-btn { min-width: 150px; }
.walkin-table td { vertical-align: middle; }
.walkin-table tbody tr { cursor: pointer; transition: background-color 150ms ease; }
.walkin-table tbody tr:hover { background: rgba(37, 99, 235, 0.04); }
.walkin-table :deep(td:first-child) { border-left: 4px solid transparent; }
.priority-emergency :deep(td:first-child) { border-left-color: #ef4444; }
.priority-moderate :deep(td:first-child) { border-left-color: #f59e0b; }
.priority-low :deep(td:first-child) { border-left-color: #22c55e; }

.walkin-dialog-card { border-radius: 16px; overflow: hidden; border: 1px solid rgba(76, 104, 168, 0.16); }
.walkin-modal-title { padding: 16px 24px !important; color: #1b2e67 !important; background: linear-gradient(180deg, rgba(35, 101, 226, 0.08) 0%, rgba(35, 101, 226, 0) 100%); border-bottom: 1px solid rgba(76, 104, 168, 0.14); }
.intake-section-title { font-size: 12px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; color: #26417f; padding-top: 4px; }

.success-modal-card {
  border-radius: 18px;
  border: 1px solid rgba(21, 157, 89, 0.18);
  box-shadow: 0 24px 55px rgba(18, 43, 90, 0.22);
}

.success-icon-wrap {
  position: relative;
  width: 88px;
  height: 88px;
  margin: 0 auto;
}

.success-icon {
  position: absolute;
  inset: 7px;
  z-index: 2;
  animation: popIn 220ms ease-out;
}

.success-pulse {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.2);
  animation: pulseOut 1.2s ease-out infinite;
}

@keyframes popIn {
  0% { transform: scale(0.8); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes pulseOut {
  0% { transform: scale(0.75); opacity: 0.85; }
  100% { transform: scale(1.08); opacity: 0; }
}
</style>

