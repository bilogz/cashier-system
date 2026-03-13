<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import SaasDateTimePickerField from '@/components/shared/SaasDateTimePickerField.vue';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';
import { useAuthStore } from '@/stores/auth';
import { useCheckupWorkflowStore } from '@/stores/checkupWorkflow';
import type { CheckupState, CheckupVisit } from '@/services/checkupWorkflow';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';
import { REALTIME_POLICY } from '@/config/realtimePolicy';
import { emitSuccessModal } from '@/composables/useSuccessModal';

type UserRole = 'Admin' | 'Receptionist' | 'Doctor' | 'Nurse';
type ConfirmAction = 'archive' | 'reopen' | 'escalate_emergency';

const authStore = useAuthStore();
const workflowStore = useCheckupWorkflowStore();
const realtime = useRealtimeListSync();

const pageVisible = ref(false);
const workspaceOpen = ref(false);
const selectedVisitId = ref<number | null>(null);

const toast = ref(false);
const toastText = ref('');
const toastColor = ref<'success' | 'warning' | 'info' | 'error'>('info');

const confirmDialog = ref(false);
const confirmAction = ref<ConfirmAction>('archive');

const assignDialog = ref(false);
const assignDoctor = ref('');

const form = reactive({
  diagnosis: '',
  clinicalNotes: '',
  followUpDate: ''
});

const statusFilter = ref<'All' | CheckupState>('All');
const searchQuery = ref('');
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const currentRole = computed<UserRole>(() => {
  const role = String(authStore.user?.role || 'Receptionist').trim().toLowerCase();
  if (role === 'admin') return 'Admin';
  if (role === 'doctor') return 'Doctor';
  if (role === 'nurse') return 'Nurse';
  return 'Receptionist';
});

const canAssignByRole = computed(() => currentRole.value === 'Admin' || currentRole.value === 'Receptionist' || currentRole.value === 'Nurse');
const canConsultByRole = computed(() => currentRole.value === 'Admin' || currentRole.value === 'Doctor');
const canArchiveByRole = computed(() => currentRole.value === 'Admin');

const selectedVisit = computed(() => workflowStore.visitById(selectedVisitId.value));
const totalCountText = computed(() => {
  if (workflowStore.meta.total === 0) return 'Showing 0-0 of 0 visits';
  const first = (workflowStore.meta.page - 1) * workflowStore.meta.perPage + 1;
  const last = Math.min(workflowStore.meta.page * workflowStore.meta.perPage, workflowStore.meta.total);
  return `Showing ${first}-${last} of ${workflowStore.meta.total} visits`;
});

const metrics = computed(() => [
  { label: 'Intake', value: workflowStore.analytics.intake, subtitle: 'New triage-ready visits', className: 'metric-intake' },
  { label: 'Queue', value: workflowStore.analytics.queue, subtitle: 'Waiting assignment', className: 'metric-queue' },
  { label: 'Assigned', value: workflowStore.analytics.doctorAssigned, subtitle: 'Doctor assigned', className: 'metric-assigned' },
  { label: 'In Consultation', value: workflowStore.analytics.inConsultation, subtitle: 'Active consultations', className: 'metric-consult' },
  { label: 'Lab', value: workflowStore.analytics.labRequested, subtitle: 'Lab workflow pending', className: 'metric-lab' },
  { label: 'Pharmacy', value: workflowStore.analytics.pharmacy, subtitle: 'Prescription stage', className: 'metric-pharmacy' },
  { label: 'Completed', value: workflowStore.analytics.completed, subtitle: 'Ready for archive', className: 'metric-complete' },
  { label: 'Emergency', value: workflowStore.analytics.emergency, subtitle: 'Escalated priority', className: 'metric-emergency' }
]);

const workspaceFlags = computed(() => {
  if (!selectedVisit.value) return [];
  return [
    { label: 'Lab Requested', value: selectedVisit.value.lab_requested ? 'Yes' : 'No', color: selectedVisit.value.lab_requested ? 'warning' : 'default' },
    { label: 'Lab Ready', value: selectedVisit.value.lab_result_ready ? 'Ready' : 'Pending', color: selectedVisit.value.lab_result_ready ? 'success' : 'default' },
    { label: 'Prescription', value: selectedVisit.value.prescription_created ? 'Created' : 'No', color: selectedVisit.value.prescription_created ? 'info' : 'default' },
    { label: 'Dispensed', value: selectedVisit.value.prescription_dispensed ? 'Done' : 'Pending', color: selectedVisit.value.prescription_dispensed ? 'success' : 'default' }
  ];
});

function showToast(message: string, color: 'success' | 'warning' | 'info' | 'error' = 'info'): void {
  if (color === 'success') {
    emitSuccessModal({ title: 'Success', message, tone: 'success' });
    return;
  }
  toastText.value = message;
  toastColor.value = color;
  toast.value = true;
}

async function refreshQueue(): Promise<void> {
  await workflowStore.fetchQueue();
  showToast('Queue refreshed.', 'info');
}

function statusLabel(status: CheckupState): string {
  return status.replace(/_/g, ' ');
}

function statusColor(status: CheckupState): string {
  if (status === 'completed') return 'success';
  if (status === 'archived') return 'secondary';
  if (status === 'in_consultation') return 'primary';
  if (status === 'lab_requested') return 'warning';
  if (status === 'pharmacy') return 'info';
  if (status === 'doctor_assigned') return 'indigo';
  if (status === 'queue') return 'cyan';
  return 'default';
}

function sourceLabel(source: string): string {
  return source.replace(/_/g, ' ');
}

function canEditConsultation(visit: CheckupVisit): boolean {
  if (!canConsultByRole.value) return false;
  return visit.status === 'in_consultation' || visit.status === 'lab_requested' || visit.status === 'doctor_assigned';
}

function rowPrimaryAction(visit: CheckupVisit): { label: string; color: string; icon: string; styleClass: string; action: () => Promise<void> } {
  if (visit.status === 'intake' && canAssignByRole.value) {
    return { label: 'Queue Visit', color: 'primary', icon: 'mdi-playlist-plus', styleClass: 'saas-action-primary', action: async () => executeAction(visit, 'queue') };
  }
  if ((visit.status === 'queue' || visit.status === 'doctor_assigned') && canAssignByRole.value) {
    return {
      label: visit.status === 'queue' ? 'Assign Doctor' : 'Start Consultation',
      color: visit.status === 'queue' ? 'info' : 'primary',
      icon: visit.status === 'queue' ? 'mdi-account-switch' : 'mdi-stethoscope',
      styleClass: visit.status === 'queue' ? 'saas-action-info' : 'saas-action-primary',
      action: async () => {
        if (visit.status === 'queue') {
          selectedVisitId.value = visit.id;
          assignDoctor.value = visit.assigned_doctor === 'Unassigned' ? '' : visit.assigned_doctor;
          assignDialog.value = true;
          return;
        }
        await executeAction(visit, 'start_consultation');
      }
    };
  }
  return {
    label: 'Open Workspace',
    color: 'primary',
    icon: 'mdi-folder-open-outline',
    styleClass: 'saas-action-neutral',
    action: async () => {
      openWorkspace(visit);
    }
  };
}

async function executeAction(
  visit: CheckupVisit,
  action: 'queue' | 'assign_doctor' | 'start_consultation' | 'request_lab' | 'mark_lab_ready' | 'send_pharmacy' | 'mark_dispensed' | 'complete' | 'archive' | 'reopen' | 'escalate_emergency',
  payload: Record<string, unknown> = {}
): Promise<void> {
  try {
    await workflowStore.executeAction({
      id: visit.id,
      action,
      expectedVersion: visit.version,
      ...payload
    });
    showToast(`Action "${action}" completed.`, 'success');
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function saveConsultation(auto = false): Promise<void> {
  if (!selectedVisit.value) return;
  const visit = selectedVisit.value;

  if (!form.diagnosis.trim() || !form.clinicalNotes.trim()) {
    if (!auto) showToast('Diagnosis and clinical notes are required.', 'warning');
    return;
  }

  try {
    await workflowStore.executeAction({
      id: visit.id,
      action: 'save_consultation',
      expectedVersion: visit.version,
      diagnosis: form.diagnosis.trim(),
      clinical_notes: form.clinicalNotes.trim(),
      follow_up_date: form.followUpDate || undefined
    });
    if (!auto) showToast('Consultation notes saved.', 'success');
  } catch (error) {
    if (!auto) showToast(error instanceof Error ? error.message : String(error), 'error');
  }
}

function openWorkspace(visit: CheckupVisit): void {
  selectedVisitId.value = visit.id;
  workspaceOpen.value = true;
}

function openConfirm(action: ConfirmAction, visit: CheckupVisit): void {
  selectedVisitId.value = visit.id;
  confirmAction.value = action;
  confirmDialog.value = true;
}

async function confirmWorkflowAction(): Promise<void> {
  if (!selectedVisit.value) return;
  const visit = selectedVisit.value;
  await executeAction(visit, confirmAction.value);
  confirmDialog.value = false;
}

async function submitAssignDoctor(): Promise<void> {
  if (!selectedVisit.value) return;
  const doctor = assignDoctor.value.trim();
  if (!doctor) {
    showToast('Assigned doctor is required.', 'warning');
    return;
  }
  await executeAction(selectedVisit.value, 'assign_doctor', { assigned_doctor: doctor });
  assignDialog.value = false;
}

watch(selectedVisit, (visit) => {
  if (!visit) return;
  form.diagnosis = visit.diagnosis || '';
  form.clinicalNotes = visit.clinical_notes || '';
  form.followUpDate = visit.follow_up_date || '';
});

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => [form.diagnosis, form.clinicalNotes, form.followUpDate, selectedVisit.value?.id, workspaceOpen.value],
  () => {
    if (!workspaceOpen.value || !selectedVisit.value) return;
    if (!canEditConsultation(selectedVisit.value)) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      void saveConsultation(true);
    }, 900);
  }
);

watch(searchQuery, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    workflowStore.filters.search = searchQuery.value.trim();
    workflowStore.filters.page = 1;
    void workflowStore.fetchQueue();
  }, REALTIME_POLICY.debounce.checkupSearchMs);
});

watch(statusFilter, () => {
  workflowStore.filters.status = statusFilter.value;
  workflowStore.filters.page = 1;
  void workflowStore.fetchQueue();
});

watch(
  () => workflowStore.filters.page,
  () => {
    void workflowStore.fetchQueue();
  }
);

onMounted(async () => {
  pageVisible.value = true;
  await workflowStore.fetchQueue({ silent: false });
  realtime.startPolling(() => workflowStore.syncQueue({ silent: true }), REALTIME_POLICY.polling.checkupMs);
  if (workflowStore.visits.length > 0 && !selectedVisitId.value) {
    selectedVisitId.value = workflowStore.visits[0].id;
  }
  if (workflowStore.lastError) {
    showToast(`Check-Up API unavailable: ${workflowStore.lastError}. Showing local fallback data.`, 'warning');
  }
});

onBeforeUnmount(() => {
  realtime.stopPolling();
  realtime.invalidatePending();
});
</script>

<template>
  <div class="checkup-v2-page">
    <div class="checkup-v2-content" :class="{ 'is-visible': pageVisible }">
      <v-alert v-if="workflowStore.lastError" type="warning" variant="tonal" class="mb-3">
        Live check-up API is unavailable. Showing fallback queue data.
      </v-alert>

      <v-card class="hero-card mb-4" elevation="0">
        <v-card-text class="pa-5">
          <div class="d-flex flex-wrap ga-4 align-center justify-space-between">
            <div>
              <div class="hero-kicker">Clinical Workflow</div>
              <h1 class="text-h4 font-weight-black mb-1">Check-Up Consultation Center</h1>
              <p class="mb-0 hero-subtitle">State-driven visit lifecycle from intake to archive with live queue updates.</p>
            </div>
            <div class="hero-meta">
              <div class="text-caption text-uppercase font-weight-bold">Session Role</div>
              <div class="text-h6 font-weight-bold">{{ currentRole }}</div>
              <v-chip :color="workflowStore.syncing ? 'warning' : 'success'" size="small" variant="tonal">
                {{ workflowStore.syncing ? 'Syncing' : 'Live' }}
              </v-chip>
            </div>
          </div>
        </v-card-text>
      </v-card>

      <v-row class="mb-4">
        <v-col v-for="metric in metrics" :key="metric.label" cols="12" sm="6" md="3" lg="3" xl="3">
          <v-card :class="['metric-card', metric.className]" elevation="0">
            <v-card-text>
              <div class="metric-label">{{ metric.label }}</div>
              <div class="metric-value">{{ metric.value }}</div>
              <div class="metric-subtitle">{{ metric.subtitle }}</div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-card variant="outlined" class="surface-card mb-4">
        <v-card-item>
          <v-card-title>Consultation Queue Board</v-card-title>
          <v-card-subtitle>Row click opens workspace. Primary action is workflow-contextual.</v-card-subtitle>
          <template #append>
            <v-btn class="saas-hero-btn" size="small" variant="flat" :loading="workflowStore.loading" @click="refreshQueue">Refresh</v-btn>
          </template>
        </v-card-item>
        <v-card-text>
          <v-row class="mb-3">
            <v-col cols="12" md="8">
              <v-text-field v-model="searchQuery" density="comfortable" variant="outlined" hide-details prepend-inner-icon="mdi-magnify" placeholder="Search by visit, patient, complaint, doctor" />
            </v-col>
            <v-col cols="12" md="4">
              <v-select
                v-model="statusFilter"
                :items="['All', 'intake', 'queue', 'doctor_assigned', 'in_consultation', 'lab_requested', 'pharmacy', 'completed', 'archived']"
                density="comfortable"
                hide-details
                variant="outlined"
                prepend-inner-icon="mdi-filter-outline"
              />
            </v-col>
          </v-row>

          <v-progress-linear v-if="workflowStore.loading" indeterminate color="primary" class="mb-2" />
          <v-table density="comfortable">
            <thead>
              <tr>
                <th>VISIT</th>
                <th>PATIENT</th>
                <th>STATUS</th>
                <th>DOCTOR</th>
                <th>SOURCE</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="visit in workflowStore.visits" :key="visit.id" class="queue-row">
                <td class="clickable-cell" @click="openWorkspace(visit)">
                  <div class="font-weight-bold">{{ visit.visit_id }}</div>
                  <div class="text-caption text-medium-emphasis">{{ visit.chief_complaint || '--' }}</div>
                </td>
                <td>{{ visit.patient_name }}</td>
                <td>
                  <v-chip size="small" :color="statusColor(visit.status)" variant="tonal">{{ statusLabel(visit.status) }}</v-chip>
                </td>
                <td>{{ visit.assigned_doctor }}</td>
                <td>
                  <v-chip size="x-small" color="secondary" variant="tonal">{{ sourceLabel(visit.source) }}</v-chip>
                </td>
                <td>
                  <div class="d-flex ga-2 align-center action-cell">
                    <v-btn
                      size="small"
                      :color="rowPrimaryAction(visit).color"
                      variant="flat"
                      :class="['saas-row-action-btn', rowPrimaryAction(visit).styleClass]"
                      :prepend-icon="rowPrimaryAction(visit).icon"
                      :loading="workflowStore.syncing && selectedVisitId === visit.id"
                      @click="rowPrimaryAction(visit).action()"
                    >
                      {{ rowPrimaryAction(visit).label }}
                    </v-btn>
                    <v-menu location="bottom end">
                      <template #activator="{ props }">
                        <v-btn icon="mdi-dots-horizontal" size="small" variant="outlined" class="saas-overflow-btn" v-bind="props" aria-label="More actions" />
                      </template>
                      <v-list density="compact" class="saas-overflow-menu">
                        <v-list-item @click="openWorkspace(visit)"><v-list-item-title>Open Workspace</v-list-item-title></v-list-item>
                        <v-list-item v-if="canAssignByRole" @click="selectedVisitId = visit.id; assignDoctor = visit.assigned_doctor === 'Unassigned' ? '' : visit.assigned_doctor; assignDialog = true"><v-list-item-title>Assign Doctor</v-list-item-title></v-list-item>
                        <v-list-item v-if="canConsultByRole && visit.status !== 'archived'" @click="executeAction(visit, 'escalate_emergency')"><v-list-item-title>Escalate Emergency</v-list-item-title></v-list-item>
                        <v-list-item v-if="canArchiveByRole && visit.status === 'completed'" @click="openConfirm('archive', visit)"><v-list-item-title>Archive</v-list-item-title></v-list-item>
                        <v-list-item v-if="canArchiveByRole && (visit.status === 'completed' || visit.status === 'archived')" @click="openConfirm('reopen', visit)"><v-list-item-title>Reopen</v-list-item-title></v-list-item>
                      </v-list>
                    </v-menu>
                  </div>
                </td>
              </tr>
              <tr v-if="!workflowStore.loading && workflowStore.visits.length === 0">
                <td colspan="6" class="text-center text-medium-emphasis py-5">No consultation visits match current filters.</td>
              </tr>
            </tbody>
          </v-table>

          <div class="d-flex align-center mt-3 text-caption text-medium-emphasis">
            <span>{{ totalCountText }}</span>
            <v-spacer />
            <v-pagination v-model="workflowStore.filters.page" :length="workflowStore.meta.totalPages" density="comfortable" total-visible="7" />
          </div>
        </v-card-text>
      </v-card>
    </div>

    <ModuleActivityLogs module="checkup" title="Module Activity Logs" :per-page="8" />

    <v-dialog v-model="workspaceOpen" max-width="1100" transition="dialog-bottom-transition" scrollable>
      <v-card v-if="selectedVisit" class="workspace-card">
        <v-toolbar density="comfortable" class="workspace-toolbar">
          <v-toolbar-title class="font-weight-bold">Consultation Workspace</v-toolbar-title>
          <v-chip size="small" color="primary" variant="flat">{{ selectedVisit.visit_id }}</v-chip>
          <v-btn icon="mdi-close" variant="text" @click="workspaceOpen = false" />
        </v-toolbar>

        <v-card-text class="pa-5">
          <v-row class="mb-2">
            <v-col cols="12" md="8">
              <div class="text-h5 font-weight-bold">{{ selectedVisit.patient_name }}</div>
              <div class="text-medium-emphasis">{{ selectedVisit.chief_complaint || '--' }}</div>
              <div class="d-flex flex-wrap ga-2 mt-3">
                <v-chip size="small" :color="statusColor(selectedVisit.status)" variant="tonal">{{ statusLabel(selectedVisit.status) }}</v-chip>
                <v-chip size="small" color="secondary" variant="tonal">Doctor: {{ selectedVisit.assigned_doctor }}</v-chip>
                <v-chip size="small" :color="selectedVisit.is_emergency ? 'error' : 'default'" variant="tonal">
                  {{ selectedVisit.is_emergency ? 'Emergency' : 'Routine' }}
                </v-chip>
              </div>
            </v-col>
            <v-col cols="12" md="4">
              <v-card variant="tonal" class="pa-3">
                <div class="text-caption text-uppercase font-weight-bold mb-2">Consultation Flags</div>
                <div v-for="flag in workspaceFlags" :key="flag.label" class="d-flex align-center justify-space-between mb-2">
                  <span class="text-body-2">{{ flag.label }}</span>
                  <v-chip size="x-small" :color="flag.color" variant="flat">{{ flag.value }}</v-chip>
                </div>
              </v-card>
            </v-col>
          </v-row>

          <v-row>
            <v-col cols="12">
              <v-text-field v-model="form.diagnosis" label="Diagnosis" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="12">
              <v-textarea v-model="form.clinicalNotes" label="Clinical Notes" variant="outlined" density="comfortable" rows="4" />
            </v-col>
            <v-col cols="12" md="6">
              <SaasDateTimePickerField v-model="form.followUpDate" mode="date" label="Follow-Up Date" clearable />
            </v-col>
          </v-row>

          <v-divider class="my-4" />

          <div class="d-flex flex-wrap ga-2">
            <v-btn v-if="selectedVisit.status === 'doctor_assigned' && canConsultByRole" class="saas-btn saas-btn-primary" @click="executeAction(selectedVisit, 'start_consultation')">Start Consultation</v-btn>
            <v-btn v-if="canEditConsultation(selectedVisit)" class="saas-btn saas-btn-ghost" @click="saveConsultation(false)">Save Notes</v-btn>
            <v-btn v-if="canConsultByRole && (selectedVisit.status === 'in_consultation' || selectedVisit.status === 'doctor_assigned')" class="saas-btn saas-btn-warning" @click="executeAction(selectedVisit, 'request_lab')">Request Lab</v-btn>
            <v-btn v-if="canConsultByRole && selectedVisit.status === 'lab_requested'" class="saas-btn saas-btn-ghost" @click="executeAction(selectedVisit, 'mark_lab_ready')">Mark Lab Ready</v-btn>
            <v-btn v-if="canConsultByRole && (selectedVisit.status === 'in_consultation' || selectedVisit.status === 'doctor_assigned')" class="saas-btn saas-btn-info" @click="executeAction(selectedVisit, 'send_pharmacy')">Send Pharmacy</v-btn>
            <v-btn v-if="canConsultByRole && selectedVisit.status === 'pharmacy'" class="saas-btn saas-btn-ghost" @click="executeAction(selectedVisit, 'mark_dispensed')">Mark Dispensed</v-btn>
            <v-btn v-if="canConsultByRole && (selectedVisit.status === 'in_consultation' || selectedVisit.status === 'pharmacy')" class="saas-btn saas-btn-success" @click="executeAction(selectedVisit, 'complete')">Complete Visit</v-btn>
            <v-btn class="saas-btn saas-btn-danger-soft" @click="openConfirm('escalate_emergency', selectedVisit)">Emergency</v-btn>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog v-model="assignDialog" max-width="460">
      <v-card>
        <v-card-title class="text-h6">Assign Doctor</v-card-title>
        <v-card-text>
          <v-text-field v-model="assignDoctor" label="Doctor name" variant="outlined" density="comfortable" />
        </v-card-text>
        <v-card-actions class="px-4 pb-4">
          <v-spacer />
          <v-btn variant="text" @click="assignDialog = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" @click="submitAssignDoctor">Assign</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="confirmDialog" max-width="420">
      <v-card>
        <v-card-title class="text-h6">Confirm Action</v-card-title>
        <v-card-text>
          Apply <strong>{{ confirmAction.replace(/_/g, ' ') }}</strong> on this visit?
        </v-card-text>
        <v-card-actions class="px-4 pb-4">
          <v-spacer />
          <v-btn variant="text" @click="confirmDialog = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" @click="confirmWorkflowAction">Confirm</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="toast" :timeout="2400" :color="toastColor">{{ toastText }}</v-snackbar>
  </div>
</template>

<style scoped>
.checkup-v2-page {
  background: radial-gradient(1200px 580px at 5% -10%, rgba(53, 122, 223, 0.12), transparent 62%),
    radial-gradient(900px 520px at 96% 0%, rgba(20, 145, 111, 0.1), transparent 60%);
}

.checkup-v2-content {
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 220ms ease, transform 220ms ease;
}

.checkup-v2-content.is-visible {
  opacity: 1;
  transform: translateY(0);
}

.hero-card {
  border-radius: 18px;
  color: #fff;
  background: linear-gradient(120deg, #11256f 0%, #2957be 45%, #3ca0ef 100%);
}

.hero-kicker {
  display: inline-flex;
  padding: 4px 10px;
  border-radius: 999px;
  margin-bottom: 10px;
  font-size: 12px;
  letter-spacing: 0.8px;
  font-weight: 800;
  text-transform: uppercase;
  background: rgba(255, 255, 255, 0.2);
}

.hero-subtitle {
  color: rgba(255, 255, 255, 0.92);
}

.hero-meta {
  min-width: 180px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.9);
  color: #1f2f65;
}

.saas-hero-btn {
  text-transform: none !important;
  font-weight: 700 !important;
  border-radius: 10px !important;
  background: linear-gradient(135deg, #4f46e5 0%, #2563eb 100%) !important;
  color: #fff !important;
}

.metric-card {
  border-radius: 12px;
  color: #fff;
}

.metric-intake { background: linear-gradient(135deg, #2f80ed 0%, #0f5ec2 100%); }
.metric-queue { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); }
.metric-assigned { background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); }
.metric-consult { background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%); }
.metric-lab { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); }
.metric-pharmacy { background: linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%); }
.metric-complete { background: linear-gradient(135deg, #22c55e 0%, #15803d 100%); }
.metric-emergency { background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); }

.metric-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 700;
}

.metric-value {
  font-size: 32px;
  line-height: 1.1;
  font-weight: 800;
}

.metric-subtitle {
  opacity: 0.92;
}

.surface-card {
  border-radius: 14px;
}

.clickable-cell {
  cursor: pointer;
}

.queue-row {
  transition: background 160ms ease;
}

.queue-row:hover {
  background: rgba(55, 123, 229, 0.08);
}

.action-cell {
  min-width: 220px;
}

.saas-row-action-btn {
  border-radius: 10px;
  text-transform: none;
  font-weight: 700;
  letter-spacing: 0.1px;
  box-shadow: 0 6px 14px rgba(19, 58, 117, 0.22);
}

.saas-action-primary {
  background: linear-gradient(135deg, #2f80ed 0%, #225ac8 100%) !important;
}

.saas-action-info {
  background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%) !important;
}

.saas-action-neutral {
  background: linear-gradient(135deg, #4f46e5 0%, #1d4ed8 100%) !important;
}

.saas-overflow-btn {
  border: 1px solid rgba(65, 81, 110, 0.28) !important;
  background: #f7f8fc !important;
  color: #38445a !important;
  border-radius: 10px !important;
}

.saas-overflow-menu {
  border: 1px solid rgba(58, 86, 138, 0.22);
  border-radius: 12px;
  box-shadow: 0 14px 28px rgba(17, 40, 92, 0.2);
}

.saas-btn {
  border-radius: 10px !important;
  text-transform: none !important;
  font-weight: 700 !important;
  letter-spacing: 0.1px;
  min-height: 36px !important;
}

.saas-btn-primary {
  background: linear-gradient(135deg, #2f80ed 0%, #225ac8 100%) !important;
  color: #fff !important;
  box-shadow: 0 8px 16px rgba(25, 62, 124, 0.26);
}

.saas-btn-ghost {
  background: #f5f8ff !important;
  color: #30558f !important;
  border: 1px solid rgba(54, 86, 143, 0.24) !important;
}

.saas-btn-warning {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%) !important;
  color: #fff !important;
}

.saas-btn-info {
  background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%) !important;
  color: #fff !important;
}

.saas-btn-success {
  background: linear-gradient(135deg, #22c55e 0%, #15803d 100%) !important;
  color: #fff !important;
}

.saas-btn-danger-soft {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.16) 0%, rgba(220, 38, 38, 0.24) 100%) !important;
  color: #b91c1c !important;
  border: 1px solid rgba(220, 38, 38, 0.24) !important;
}

.workspace-card {
  border-radius: 16px;
  overflow: hidden;
}

.workspace-toolbar {
  color: #fff;
  background: linear-gradient(120deg, #1f3c9d 0%, #397adf 100%);
}
</style>
