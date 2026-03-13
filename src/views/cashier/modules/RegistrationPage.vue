<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ArchiveIcon, CheckIcon, DotsIcon, EditIcon } from 'vue-tabler-icons';
import SaasDateTimePickerField from '@/components/shared/SaasDateTimePickerField.vue';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';
import { useAuthStore } from '@/stores/auth';
import { createAppointment } from '@/services/appointmentsAdmin';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';
import { REALTIME_POLICY } from '@/config/realtimePolicy';
import { emitSuccessModal } from '@/composables/useSuccessModal';
import {
  archiveRegistration,
  assignRegistration,
  createRegistration,
  fetchRegistrations,
  rejectRegistration,
  setRegistrationStatus,
  updateRegistration,
  type RegistrationAnalytics,
  type RegistrationRow,
  type RegistrationStatus
} from '@/services/registrationsAdmin';

type QueueStatus = 'All Statuses' | RegistrationStatus;
type SortFilter = 'Sort Latest Intake' | 'Sort Name A-Z' | 'Sort Name Z-A';
type ModalType = 'add' | 'edit' | 'triage' | 'decision' | 'archive' | 'assign';
type DecisionType = 'approve' | 'reject';
type UserRole = 'Admin' | 'Receptionist' | 'Doctor' | 'Nurse';

type PatientDraft = {
  name: string;
  email: string;
  phone: string;
  age: number;
  sex: 'Male' | 'Female' | 'Other' | '';
  address: string;
  emergencyName: string;
  emergencyPhone: string;
  insuranceProvider: string;
  insuranceNumber: string;
  medicalNotes: string;
  concern: string;
  assignedTo: string;
  priority: 'Low' | 'Moderate' | 'High' | 'Critical';
  intakeTime: string;
  bookedTime: string;
  status: RegistrationStatus;
};

type ValidationErrors = Partial<Record<keyof PatientDraft, string>>;

type WorkflowEvent = {
  title: string;
  detail: string;
  at: string;
};

const router = useRouter();
const authStore = useAuthStore();

const pageSize = 8;
const statuses: RegistrationStatus[] = ['Pending', 'Review', 'Active', 'Archived'];
const statusFilters: QueueStatus[] = ['All Statuses', 'Pending', 'Review', 'Active', 'Archived'];
const sortFilters: SortFilter[] = ['Sort Latest Intake', 'Sort Name A-Z', 'Sort Name Z-A'];

const records = ref<RegistrationRow[]>([]);
const analytics = ref<RegistrationAnalytics>({ pending: 0, active: 0, concerns: 0, approvalRate: 0 });
const totalItems = ref(0);
const pageCount = ref(1);
const listPage = ref(1);

const pageLoading = ref(true);
const tableLoading = ref(false);
const pageReady = ref(false);

const searchQuery = ref('');
const selectedStatus = ref<QueueStatus>('All Statuses');
const selectedSort = ref<SortFilter>('Sort Latest Intake');

const previewOpen = ref(false);
const previewRecord = ref<RegistrationRow | null>(null);

const actionDialog = ref(false);
const actionType = ref<ModalType>('add');
const previewActionLoading = ref(false);
const modalLoading = ref(false);
const actionRecord = ref<RegistrationRow | null>(null);
const decisionType = ref<DecisionType>('approve');
const decisionReason = ref('');
const archiveReason = ref('');

const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref<'success' | 'info' | 'warning' | 'error'>('success');

const form = ref<PatientDraft>(buildEmptyDraft());
const formErrors = ref<ValidationErrors>({});
const realtime = useRealtimeListSync();

const currentRole = computed<UserRole>(() => {
  const role = String(authStore.user?.role || 'Receptionist').trim().toLowerCase();
  if (role === 'admin') return 'Admin';
  if (role === 'doctor') return 'Doctor';
  if (role === 'nurse') return 'Nurse';
  return 'Receptionist';
});

const canEditByRole = computed(() => currentRole.value === 'Admin' || currentRole.value === 'Receptionist' || currentRole.value === 'Nurse');
const canApproveByRole = computed(() => currentRole.value === 'Admin' || currentRole.value === 'Doctor');
const canAssignByRole = computed(() => currentRole.value === 'Admin' || currentRole.value === 'Receptionist' || currentRole.value === 'Nurse');
const canArchiveByRole = computed(() => currentRole.value === 'Admin');

const statCards = computed(() => [
  {
    title: 'Pending',
    value: String(analytics.value.pending),
    subtitle: 'Awaiting review',
    className: 'stat-pending'
  },
  {
    title: 'Active',
    value: String(analytics.value.active),
    subtitle: 'In active care',
    className: 'stat-active'
  },
  {
    title: 'Concerns',
    value: String(analytics.value.concerns),
    subtitle: 'Need triage attention',
    className: 'stat-concern'
  },
  {
    title: 'Approval Rate',
    value: `${analytics.value.approvalRate}%`,
    subtitle: `Across ${totalItems.value} registrations`,
    className: 'stat-rate'
  }
]);

const totalCountText = computed(() => {
  if (totalItems.value === 0) return 'Showing 0-0 of 0 records';
  const first = (listPage.value - 1) * pageSize + 1;
  const last = Math.min(listPage.value * pageSize, totalItems.value);
  return `Showing ${first}-${last} of ${totalItems.value} records`;
});

const duplicateWarning = computed(() => {
  const currentName = form.value.name.trim().toLowerCase();
  const currentEmail = form.value.email.trim().toLowerCase();
  if (!currentName && !currentEmail) return '';

  const duplicate = records.value.find((item) => {
    const nameMatch = currentName && item.patient_name.trim().toLowerCase() === currentName;
    const emailMatch = currentEmail && item.patient_email.trim().toLowerCase() === currentEmail;
    return Boolean(nameMatch || emailMatch);
  });

  if (!duplicate) return '';
  return `Possible duplicate: ${duplicate.patient_name} (${duplicate.case_id})`;
});

const modalTitle = computed(() => {
  if (actionType.value === 'add') return 'Add Patient Registration';
  if (actionType.value === 'edit') return 'Edit Registration';
  if (actionType.value === 'triage') return 'Concern Review / Triage';
  if (actionType.value === 'assign') return 'Assign Staff';
  if (actionType.value === 'decision') return decisionType.value === 'approve' ? 'Approve Registration' : 'Reject Registration';
  return 'Archive Registration';
});

const modalActionLabel = computed(() => {
  if (actionType.value === 'add') return 'Create Registration';
  if (actionType.value === 'edit') return 'Save Changes';
  if (actionType.value === 'triage') return 'Save Routing';
  if (actionType.value === 'assign') return 'Assign';
  if (actionType.value === 'decision') return decisionType.value === 'approve' ? 'Approve' : 'Reject';
  return 'Archive';
});

const timeline = computed<WorkflowEvent[]>(() => {
  if (!previewRecord.value) return [];
  const base = previewRecord.value;
  return [
    {
      title: 'Registration Created',
      detail: `Case ${base.case_id} registered under ${base.status}.`,
      at: base.intake_time
    },
    {
      title: 'Assigned Staff',
      detail: `Current assignment: ${base.assigned_to || 'Unassigned'}.`,
      at: base.booked_time
    },
    {
      title: 'Workflow Status',
      detail: `Patient is currently in ${base.status}.`,
      at: base.booked_time
    }
  ];
});

function buildEmptyDraft(): PatientDraft {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return {
    name: '',
    email: '',
    phone: '',
    age: 18,
    sex: '',
    address: '',
    emergencyName: '',
    emergencyPhone: '',
    insuranceProvider: '',
    insuranceNumber: '',
    medicalNotes: '',
    concern: '',
    assignedTo: 'Nurse Triage',
    priority: 'Low',
    intakeTime: local,
    bookedTime: local,
    status: 'Pending'
  };
}

function toInputDateTime(value: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatDateTime(value: string): string {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(parsed);
}

function statusColor(status: RegistrationStatus): string {
  if (status === 'Active') return 'success';
  if (status === 'Review') return 'info';
  if (status === 'Archived') return 'secondary';
  return 'warning';
}

function priorityColor(priority: PatientDraft['priority']): string {
  if (priority === 'Critical') return 'error';
  if (priority === 'High') return 'warning';
  if (priority === 'Moderate') return 'info';
  return 'success';
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'PT';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

function showToast(message: string, color: 'success' | 'info' | 'warning' | 'error' = 'success'): void {
  if (color === 'success') {
    emitSuccessModal({ title: 'Success', message, tone: 'success' });
    return;
  }
  snackbarText.value = message;
  snackbarColor.value = color;
  snackbar.value = true;
}

function normalizeFormForRecord(record: RegistrationRow): void {
  form.value = {
    ...buildEmptyDraft(),
    name: record.patient_name,
    email: record.patient_email || '',
    age: Number(record.age || 18),
    concern: record.concern || '',
    assignedTo: record.assigned_to || 'Nurse Triage',
    intakeTime: toInputDateTime(record.intake_time),
    bookedTime: toInputDateTime(record.booked_time),
    status: record.status
  };
  formErrors.value = {};
}

function validateDraft(): boolean {
  const errors: ValidationErrors = {};
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!form.value.name.trim()) {
    errors.name = 'Patient name is required.';
  }

  if (form.value.email && !emailPattern.test(form.value.email.trim())) {
    errors.email = 'Enter a valid email address.';
  }

  if (!Number.isFinite(form.value.age) || form.value.age < 0 || form.value.age > 120) {
    errors.age = 'Age must be between 0 and 120.';
  }

  if (!form.value.concern.trim()) {
    errors.concern = 'Chief concern is required.';
  }

  if (!form.value.assignedTo.trim()) {
    errors.assignedTo = 'Assigned clinician is required.';
  }

  if (!form.value.intakeTime) {
    errors.intakeTime = 'Intake time is required.';
  }

  if (!form.value.bookedTime) {
    errors.bookedTime = 'Booked time is required.';
  }

  formErrors.value = errors;
  return Object.keys(errors).length === 0;
}

async function loadRecords(options: { silent?: boolean } = {}): Promise<void> {
  const payload = await realtime.runLatest(
    async () =>
      fetchRegistrations({
        search: searchQuery.value.trim(),
        status: selectedStatus.value,
        sort: selectedSort.value,
        page: listPage.value,
        perPage: pageSize
      }),
    {
      silent: options.silent,
      onStart: () => {
        tableLoading.value = true;
      },
      onFinish: () => {
        tableLoading.value = false;
      },
      onError: (error) => {
        showToast(error instanceof Error ? error.message : String(error), 'error');
      }
    }
  );

  if (!payload) return;
  records.value = payload.items;
  analytics.value = payload.analytics;
  totalItems.value = payload.meta.total;
  pageCount.value = payload.meta.totalPages;
}

function openModal(type: ModalType, record?: RegistrationRow): void {
  actionType.value = type;
  actionRecord.value = record || null;
  decisionType.value = 'approve';
  decisionReason.value = '';
  archiveReason.value = '';

  if (type === 'add') {
    form.value = buildEmptyDraft();
    formErrors.value = {};
  }

  if ((type === 'edit' || type === 'triage' || type === 'assign') && record) {
    normalizeFormForRecord(record);
  }

  actionDialog.value = true;
}

function closeModal(): void {
  if (modalLoading.value) return;
  actionDialog.value = false;
}

function openPreview(record: RegistrationRow): void {
  previewRecord.value = record;
  previewOpen.value = true;
}

function applySearchReset(): void {
  searchQuery.value = '';
  selectedStatus.value = 'All Statuses';
  selectedSort.value = 'Sort Latest Intake';
  listPage.value = 1;
}

function canDecision(record: RegistrationRow): boolean {
  return canApproveByRole.value && (record.status === 'Pending' || record.status === 'Review');
}

function canEdit(record: RegistrationRow): boolean {
  if (!canEditByRole.value) return false;
  return record.status !== 'Archived';
}

function canAssign(record: RegistrationRow): boolean {
  if (!canAssignByRole.value) return false;
  return record.status === 'Pending' || record.status === 'Review' || record.status === 'Active';
}

function canArchive(record: RegistrationRow): boolean {
  if (!canArchiveByRole.value) return false;
  return record.status !== 'Archived';
}

async function runOverflowAction(action: 'history' | 'assign' | 'triage' | 'archive', record: RegistrationRow): Promise<void> {
  if (action === 'history') {
    openPreview(record);
    return;
  }

  if (action === 'assign') {
    openModal('assign', record);
    return;
  }

  if (action === 'triage') {
    openModal('triage', record);
    return;
  }

  if (action === 'archive') {
    openModal('archive', record);
  }
}

async function submitModal(): Promise<void> {
  if (actionType.value === 'add' || actionType.value === 'edit' || actionType.value === 'triage') {
    if (!validateDraft()) return;
  }

  if (actionType.value === 'assign') {
    if (!form.value.assignedTo.trim()) {
      formErrors.value = { assignedTo: 'Assigned staff / doctor is required.' };
      return;
    }
  }

  modalLoading.value = true;
  try {
    if (actionType.value === 'add') {
      await createRegistration({
        patient_name: form.value.name,
        patient_email: form.value.email,
        age: form.value.age,
        concern: `${form.value.concern}${form.value.medicalNotes ? ` | Notes: ${form.value.medicalNotes}` : ''}`,
        assigned_to: form.value.assignedTo,
        intake_time: form.value.intakeTime,
        booked_time: form.value.bookedTime,
        status: form.value.status
      });
      showToast('Patient registration created.', 'success');
    }

    if (actionType.value === 'edit' && actionRecord.value) {
      await updateRegistration({
        id: actionRecord.value.id,
        patient_name: form.value.name,
        patient_email: form.value.email,
        age: form.value.age,
        concern: `${form.value.concern}${form.value.medicalNotes ? ` | Notes: ${form.value.medicalNotes}` : ''}`,
        assigned_to: form.value.assignedTo,
        intake_time: form.value.intakeTime,
        booked_time: form.value.bookedTime,
        status: form.value.status
      });
      showToast('Registration updated.', 'success');
    }

    if (actionType.value === 'triage' && actionRecord.value) {
      const triageSummary = `[Priority: ${form.value.priority}] ${form.value.concern}`;
      await updateRegistration({
        id: actionRecord.value.id,
        patient_name: form.value.name,
        patient_email: form.value.email,
        age: form.value.age,
        concern: triageSummary,
        assigned_to: form.value.assignedTo,
        intake_time: form.value.intakeTime,
        booked_time: form.value.bookedTime,
        status: 'Review'
      });
      showToast('Concern routing updated. Case moved to Review.', 'info');
    }

    if (actionType.value === 'decision' && actionRecord.value) {
      if (decisionType.value === 'approve') {
        await setRegistrationStatus(actionRecord.value.id, 'Active');
        showToast('Registration approved and moved to Active.', 'success');
      } else {
        const reason = decisionReason.value.trim() || 'Rejected by reviewer';
        await rejectRegistration(actionRecord.value.id, reason);
        showToast('Registration rejected and archived.', 'warning');
      }
    }

    if (actionType.value === 'assign' && actionRecord.value) {
      await assignRegistration(actionRecord.value.id, form.value.assignedTo.trim());
      showToast(`Assigned to ${form.value.assignedTo}.`, 'success');
    }

    if (actionType.value === 'archive' && actionRecord.value) {
      const reason = archiveReason.value.trim() || 'Archived by registration staff';
      await archiveRegistration(actionRecord.value.id, reason);
      showToast('Registration archived.', 'info');
    }

    actionDialog.value = false;
    await loadRecords();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    modalLoading.value = false;
  }
}

async function createAppointmentFromPreview(): Promise<void> {
  if (!previewRecord.value) return;
  previewActionLoading.value = true;
  try {
    const target = previewRecord.value;
    await createAppointment({
      patient_name: target.patient_name,
      patient_email: target.patient_email || undefined,
      phone_number: 'N/A',
      doctor_name: target.assigned_to || 'TBD',
      department_name: 'General Medicine',
      visit_type: 'Check-Up',
      appointment_date: new Date().toISOString().slice(0, 10),
      preferred_time: '09:00',
      visit_reason: target.concern || 'Registration follow-up',
      patient_age: target.age || undefined,
      status: 'Pending'
    });

    await setRegistrationStatus(target.id, 'Review');
    showToast('Appointment draft created and registration moved to Review.', 'success');
    await loadRecords();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    previewActionLoading.value = false;
  }
}

watch([selectedStatus, selectedSort], () => {
  listPage.value = 1;
  void loadRecords();
});

let searchDebounce: ReturnType<typeof setTimeout> | null = null;
watch(searchQuery, () => {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    listPage.value = 1;
    void loadRecords();
  }, REALTIME_POLICY.debounce.registrationSearchMs);
});

watch(listPage, () => {
  void loadRecords();
});

onMounted(async () => {
  await loadRecords();
  realtime.startPolling(() => {
    void loadRecords({ silent: true });
  }, REALTIME_POLICY.polling.registrationMs);
  pageLoading.value = false;
  requestAnimationFrame(() => {
    pageReady.value = true;
  });
});

onUnmounted(() => {
  realtime.stopPolling();
  realtime.invalidatePending();
  if (searchDebounce) clearTimeout(searchDebounce);
});
</script>
<template>
  <div class="registration-refactor-page">
    <div v-if="pageLoading">
      <v-skeleton-loader type="heading, text" class="mb-5" />
      <v-row class="mb-4">
        <v-col v-for="n in 4" :key="`sk-${n}`" cols="12" sm="6" lg="3">
          <v-skeleton-loader type="card" />
        </v-col>
      </v-row>
      <v-card variant="outlined">
        <v-card-text>
          <v-skeleton-loader type="table-heading, table-row-divider@6" />
        </v-card-text>
      </v-card>
    </div>

    <div v-else class="registration-refactor-content" :class="{ 'is-visible': pageReady }">
      <v-card class="hero mb-4" elevation="0">
        <v-card-text class="pa-5">
          <div class="d-flex flex-wrap ga-4 justify-space-between align-center">
            <div>
              <div class="hero-kicker">Patient Management</div>
              <h1 class="text-h4 font-weight-black mb-2">Registration Workflow Hub</h1>
              <p class="hero-text mb-0">Track intake, triage concerns, approvals, and downstream handoffs across modules.</p>
            </div>

          </div>
        </v-card-text>
      </v-card>

      <v-row class="mb-4">
        <v-col v-for="card in statCards" :key="card.title" cols="12" sm="6" lg="3">
          <v-card :class="['metric-card', card.className]" elevation="0">
            <v-card-text>
              <div class="text-caption text-uppercase font-weight-bold">{{ card.title }}</div>
              <div class="metric-value">{{ card.value }}</div>
              <div class="metric-subtitle">{{ card.subtitle }}</div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-card variant="outlined" class="table-card">
        <v-card-item>
          <v-card-title class="text-h5">Patient Records</v-card-title>
          <template #append>
            <div class="d-flex ga-2 flex-wrap justify-end">
              <v-btn class="capsule-btn" color="primary" prepend-icon="mdi-account-plus-outline" rounded="pill" @click="openModal('add')">
                New Registration
              </v-btn>
              <v-btn class="capsule-btn reset-filters-btn" color="secondary" variant="outlined" prepend-icon="mdi-filter-off-outline" rounded="pill" @click="applySearchReset">
                Reset Filters
              </v-btn>
              <v-btn class="table-link-btn" size="small" variant="outlined" prepend-icon="mdi-calendar-clock-outline" @click="router.push('/appointments')">Appointments</v-btn>
              <v-btn class="table-link-btn" size="small" variant="outlined" prepend-icon="mdi-run-fast" @click="router.push('/modules/walk-in')">Walk-In Queue</v-btn>
              <v-btn class="table-link-btn" size="small" variant="outlined" prepend-icon="mdi-flask-outline" @click="router.push('/modules/laboratory')">Laboratory</v-btn>
            </div>
          </template>
        </v-card-item>

        <v-card-text>
          <v-row class="mb-3">
            <v-col cols="12" md="6">
              <v-text-field
                v-model="searchQuery"
                density="comfortable"
                variant="outlined"
                hide-details
                prepend-inner-icon="mdi-magnify"
                placeholder="Search patient name, case ID, concern, or assigned staff"
              />
            </v-col>
            <v-col cols="12" sm="6" md="3">
              <v-select v-model="selectedStatus" :items="statusFilters" density="comfortable" hide-details variant="outlined" prepend-inner-icon="mdi-filter-outline" />
            </v-col>
            <v-col cols="12" sm="6" md="3">
              <v-select v-model="selectedSort" :items="sortFilters" density="comfortable" hide-details variant="outlined" prepend-inner-icon="mdi-sort" />
            </v-col>
          </v-row>

          <div class="table-wrap position-relative">
            <v-progress-linear v-if="tableLoading" indeterminate color="primary" class="mb-2" />
            <v-table density="comfortable" fixed-header>
              <thead>
                <tr>
                  <th>PATIENT</th>
                  <th>CONCERN</th>
                  <th>INTAKE</th>
                  <th>STATUS</th>
                  <th>ASSIGNED</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="record in records" :key="record.id">
                  <td class="row-primary-trigger" @click="openPreview(record)">
                    <div class="d-flex align-center ga-3">
                      <v-avatar size="34" color="primary" variant="tonal">{{ initials(record.patient_name) }}</v-avatar>
                      <div>
                        <div class="font-weight-medium">{{ record.patient_name }} <span class="text-medium-emphasis">{{ record.age || '--' }}</span></div>
                        <div class="text-caption text-medium-emphasis">{{ record.patient_email || record.case_id }}</div>
                      </div>
                    </div>
                  </td>
                  <td class="max-concern">{{ record.concern || '--' }}</td>
                  <td>{{ formatDateTime(record.intake_time) }}</td>
                  <td>
                    <v-chip size="small" :color="statusColor(record.status)" variant="tonal">{{ record.status }}</v-chip>
                  </td>
                  <td>{{ record.assigned_to || 'Unassigned' }}</td>
                  <td>
                    <div class="d-flex flex-wrap ga-2">
                      <v-btn
                        v-if="canDecision(record)"
                        class="row-action-btn"
                        icon
                        size="small"
                        color="success"
                        variant="tonal"
                        @click="decisionType = 'approve'; openModal('decision', record)"
                      >
                        <CheckIcon class="row-action-tabler-icon" size="16" stroke-width="2.2" />
                      </v-btn>
                      <v-btn v-if="canEdit(record)" class="row-action-btn" icon size="small" color="indigo" variant="tonal" @click="openModal('edit', record)">
                        <EditIcon class="row-action-tabler-icon" size="16" stroke-width="2.1" />
                      </v-btn>

                      <v-menu location="bottom end">
                        <template #activator="{ props }">
                          <v-btn class="row-action-btn" icon size="small" color="secondary" variant="tonal" v-bind="props">
                            <DotsIcon size="18" class="row-action-overflow-icon" />
                          </v-btn>
                        </template>
                        <v-list density="compact">
                          <v-list-item @click="runOverflowAction('history', record)">
                            <v-list-item-title>View History</v-list-item-title>
                          </v-list-item>
                          <v-list-item v-if="canAssign(record)" @click="runOverflowAction('assign', record)">
                            <v-list-item-title>Assign Staff</v-list-item-title>
                          </v-list-item>
                          <v-list-item v-if="canEdit(record)" @click="runOverflowAction('triage', record)">
                            <v-list-item-title>Review Concern</v-list-item-title>
                          </v-list-item>
                          <v-list-item v-if="canArchive(record)" @click="runOverflowAction('archive', record)">
                            <template #prepend>
                              <ArchiveIcon size="18" class="mr-2 text-secondary" />
                            </template>
                            <v-list-item-title>Archive</v-list-item-title>
                          </v-list-item>
                        </v-list>
                      </v-menu>
                    </div>
                  </td>
                </tr>
                <tr v-if="!tableLoading && records.length === 0">
                  <td colspan="6" class="text-center text-medium-emphasis py-5">No records match the current filters.</td>
                </tr>
              </tbody>
            </v-table>
          </div>

          <div class="d-flex align-center mt-3 text-caption text-medium-emphasis">
            <span>{{ totalCountText }}</span>
            <v-spacer />
            <v-pagination v-model="listPage" :length="pageCount" density="comfortable" total-visible="7" />
          </div>
        </v-card-text>
      </v-card>
    </div>

    <ModuleActivityLogs module="registration" title="Module Activity Logs" :per-page="8" />

    <v-navigation-drawer v-model="previewOpen" temporary location="right" width="420" class="preview-drawer">
      <div class="pa-4" v-if="previewRecord">
        <div class="d-flex align-center justify-space-between mb-4">
          <h3 class="text-h6 mb-0">Patient Profile</h3>
          <v-btn icon variant="text" @click="previewOpen = false"><v-icon>mdi-close</v-icon></v-btn>
        </div>

        <v-card variant="tonal" class="mb-3">
          <v-card-text>
            <div class="text-overline">Case ID</div>
            <div class="font-weight-bold mb-1">{{ previewRecord.case_id }}</div>
            <div class="text-h6">{{ previewRecord.patient_name }}</div>
            <div class="text-caption text-medium-emphasis">{{ previewRecord.patient_email || 'No email on file' }}</div>
            <div class="mt-3 d-flex ga-2 flex-wrap">
              <v-chip size="small" :color="statusColor(previewRecord.status)" variant="tonal">{{ previewRecord.status }}</v-chip>
              <v-chip size="small" color="info" variant="tonal">Assigned: {{ previewRecord.assigned_to }}</v-chip>
            </div>
          </v-card-text>
        </v-card>

        <v-card variant="outlined" class="mb-3">
          <v-card-title class="text-subtitle-1">Timeline</v-card-title>
          <v-list density="compact">
            <v-list-item v-for="(event, idx) in timeline" :key="`${event.title}-${idx}`">
              <v-list-item-title>{{ event.title }}</v-list-item-title>
              <v-list-item-subtitle>{{ event.detail }}</v-list-item-subtitle>
              <template #append>
                <span class="text-caption text-medium-emphasis">{{ formatDateTime(event.at) }}</span>
              </template>
            </v-list-item>
          </v-list>
        </v-card>

        <div class="d-grid ga-2">
          <v-btn color="primary" variant="flat" prepend-icon="mdi-calendar-plus" :loading="previewActionLoading" @click="createAppointmentFromPreview">
            Create Appointment Draft
          </v-btn>
          <v-btn variant="outlined" prepend-icon="mdi-run-fast" @click="router.push('/modules/walk-in')">Send to Walk-In Queue</v-btn>
          <v-btn variant="outlined" prepend-icon="mdi-hospital-box-outline" @click="router.push('/modules/check-up')">Open Check-Up Module</v-btn>
        </div>
      </div>
    </v-navigation-drawer>

    <v-dialog v-model="actionDialog" max-width="880" transition="dialog-bottom-transition" :persistent="modalLoading">
      <v-card class="modal-card">
        <v-card-title class="text-h5 d-flex align-center justify-space-between">
          <span>{{ modalTitle }}</span>
          <v-btn icon variant="text" :disabled="modalLoading" @click="closeModal"><v-icon>mdi-close</v-icon></v-btn>
        </v-card-title>
        <v-card-text>
          <template v-if="actionType === 'add' || actionType === 'edit' || actionType === 'triage'">
            <v-alert v-if="duplicateWarning" type="warning" variant="tonal" class="mb-3">{{ duplicateWarning }}</v-alert>

            <v-row>
              <v-col cols="12" md="6">
                <v-text-field v-model="form.name" label="Full name" variant="outlined" density="comfortable" :error-messages="formErrors.name" />
              </v-col>
              <v-col cols="12" md="3">
                <v-text-field v-model.number="form.age" label="Age" type="number" variant="outlined" density="comfortable" :error-messages="formErrors.age" />
              </v-col>
              <v-col cols="12" md="3">
                <v-select v-model="form.sex" :items="['Male', 'Female', 'Other']" label="Sex" variant="outlined" density="comfortable" />
              </v-col>

              <v-col cols="12" md="6">
                <v-text-field v-model="form.email" label="Email" variant="outlined" density="comfortable" :error-messages="formErrors.email" />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="form.phone" label="Phone" variant="outlined" density="comfortable" />
              </v-col>

              <v-col cols="12">
                <v-text-field v-model="form.address" label="Address" variant="outlined" density="comfortable" />
              </v-col>

              <v-col cols="12" md="6">
                <v-text-field v-model="form.emergencyName" label="Emergency contact name" variant="outlined" density="comfortable" />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="form.emergencyPhone" label="Emergency contact phone" variant="outlined" density="comfortable" />
              </v-col>

              <v-col cols="12" md="6">
                <v-text-field v-model="form.insuranceProvider" label="Insurance provider" variant="outlined" density="comfortable" />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="form.insuranceNumber" label="Insurance member ID" variant="outlined" density="comfortable" />
              </v-col>

              <v-col cols="12">
                <v-textarea v-model="form.concern" label="Chief concern" rows="2" auto-grow variant="outlined" density="comfortable" :error-messages="formErrors.concern" />
              </v-col>

              <v-col cols="12">
                <v-textarea v-model="form.medicalNotes" label="Medical notes" rows="2" auto-grow variant="outlined" density="comfortable" />
              </v-col>

              <v-col cols="12" md="4">
                <v-select v-model="form.priority" :items="['Low', 'Moderate', 'High', 'Critical']" label="Priority" variant="outlined" density="comfortable">
                  <template #selection>
                    <v-chip size="small" :color="priorityColor(form.priority)" variant="tonal">{{ form.priority }}</v-chip>
                  </template>
                </v-select>
              </v-col>
              <v-col cols="12" md="4">
                <v-select v-model="form.status" :items="statuses" label="Lifecycle status" variant="outlined" density="comfortable" />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field v-model="form.assignedTo" label="Assigned doctor / staff" variant="outlined" density="comfortable" :error-messages="formErrors.assignedTo" />
              </v-col>

              <v-col cols="12" md="6">
                <SaasDateTimePickerField v-model="form.intakeTime" mode="datetime" label="Intake time" :error-messages="formErrors.intakeTime" />
              </v-col>
              <v-col cols="12" md="6">
                <SaasDateTimePickerField v-model="form.bookedTime" mode="datetime" label="Booked time" :error-messages="formErrors.bookedTime" />
              </v-col>
            </v-row>
          </template>

          <template v-else-if="actionType === 'decision' && actionRecord">
            <v-radio-group v-model="decisionType" inline>
              <v-radio label="Approve" value="approve" color="success" />
              <v-radio label="Reject" value="reject" color="error" />
            </v-radio-group>
            <v-alert :type="decisionType === 'approve' ? 'success' : 'warning'" variant="tonal" class="mb-3">
              {{ decisionType === 'approve' ? 'This registration will move to Active and notify downstream workflows.' : 'This registration will be moved to Archived with a reason.' }}
            </v-alert>
            <v-textarea
              v-if="decisionType === 'reject'"
              v-model="decisionReason"
              label="Rejection reason"
              variant="outlined"
              rows="3"
              auto-grow
              placeholder="Capture why this registration is rejected"
            />
          </template>

          <template v-else-if="actionType === 'assign' && actionRecord">
            <v-alert type="info" variant="tonal" class="mb-3">Assign this patient to the appropriate staff or doctor.</v-alert>
            <v-text-field
              v-model="form.assignedTo"
              label="Assigned staff / doctor"
              variant="outlined"
              density="comfortable"
              :error-messages="formErrors.assignedTo"
            />
          </template>

          <template v-else-if="actionType === 'archive' && actionRecord">
            <v-alert type="info" variant="tonal" class="mb-3">Archived records stay searchable for reporting and audits.</v-alert>
            <v-textarea
              v-model="archiveReason"
              label="Archive reason"
              variant="outlined"
              rows="3"
              auto-grow
              placeholder="Reason for archive"
            />
          </template>
        </v-card-text>

        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn variant="text" prepend-icon="mdi-close" @click="closeModal">Cancel</v-btn>
          <v-btn color="primary" variant="flat" rounded="pill" :loading="modalLoading" @click="submitModal">{{ modalActionLabel }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :timeout="2600" :color="snackbarColor">{{ snackbarText }}</v-snackbar>
  </div>
</template>

<style scoped>
.registration-refactor-content {
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 220ms ease, transform 220ms ease;
}

.registration-refactor-content.is-visible {
  opacity: 1;
  transform: translateY(0);
}

.hero {
  border-radius: 18px;
  color: #fff;
  background: linear-gradient(125deg, #124170 0%, #156ba6 55%, #2aa18a 100%);
  box-shadow: 0 16px 30px rgba(14, 45, 84, 0.24);
}

.hero-kicker {
  display: inline-flex;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.34);
  background: rgba(255, 255, 255, 0.14);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.55px;
  text-transform: uppercase;
}

.hero-text {
  max-width: 680px;
  color: rgba(255, 255, 255, 0.92);
}

.capsule-btn {
  text-transform: none;
  font-weight: 700;
}

.reset-filters-btn {
  color: #264b85 !important;
  border-color: rgba(38, 75, 133, 0.35) !important;
  background: #f3f8ff !important;
}

.table-link-btn {
  color: #254781 !important;
  border-color: rgba(38, 75, 133, 0.3) !important;
  background: #f7faff !important;
  text-transform: none;
  font-weight: 600;
}

.metric-card {
  color: #fff;
  border-radius: 14px;
  box-shadow: 0 8px 20px rgba(11, 35, 69, 0.18);
}

.stat-pending {
  background: linear-gradient(130deg, #f59e0b 0%, #d97706 100%);
}

.stat-active {
  background: linear-gradient(130deg, #15803d 0%, #16a34a 100%);
}

.stat-concern {
  background: linear-gradient(130deg, #2563eb 0%, #1d4ed8 100%);
}

.stat-rate {
  background: linear-gradient(130deg, #0f766e 0%, #0d9488 100%);
}

.metric-value {
  margin-top: 6px;
  font-size: 40px;
  line-height: 1.05;
  font-weight: 800;
}

.metric-subtitle {
  opacity: 0.95;
}

.table-card {
  border-radius: 14px;
}

.max-concern {
  max-width: 270px;
}

.row-primary-trigger {
  cursor: pointer;
}

.row-action-btn {
  border: 1px solid rgba(60, 74, 98, 0.12);
}

.row-action-tabler-icon {
  color: rgba(35, 43, 56, 0.9);
}

.row-action-overflow-icon {
  color: #4a5568;
}

.preview-drawer {
  border-left: 1px solid rgba(18, 65, 112, 0.16);
}

.modal-card {
  border-radius: 16px;
}

@media (max-width: 960px) {
  .metric-value {
    font-size: 32px;
  }
}
</style>
