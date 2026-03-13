<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import SaasDateTimePickerField from '@/components/shared/SaasDateTimePickerField.vue';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';
import { REALTIME_POLICY } from '@/config/realtimePolicy';
import { dispatchMentalHealthAction, fetchMentalHealthSnapshot, type MentalHealthActivity, type MentalHealthNote, type MentalHealthPatient, type MentalHealthSession, type MentalHealthStatus } from '@/services/mentalHealth';
import { emitSuccessModal } from '@/composables/useSuccessModal';

type SessionRole = 'Admin' | 'Counselor' | 'Nurse' | 'Doctor' | 'Receptionist';
type SessionAction = 'create' | 'edit' | 'note' | 'followup' | 'complete' | 'escalate' | 'archive' | 'activate' | 'draft';

const pageLoading = ref(true);
const actionLoading = ref(false);
const isEditMode = ref(false);

const role = ref<SessionRole>('Counselor');
const search = ref('');
const statusFilter = ref<'all' | MentalHealthStatus>('all');
const riskFilter = ref<'all' | 'low' | 'medium' | 'high'>('all');

const sessions = ref<MentalHealthSession[]>([]);
const patients = ref<MentalHealthPatient[]>([]);
const notes = ref<MentalHealthNote[]>([]);
const activities = ref<MentalHealthActivity[]>([]);
const analytics = ref({ active: 0, follow_up: 0, at_risk: 0, completed: 0, escalated: 0, archived: 0 });
const realtime = useRealtimeListSync();

const sessionDialog = ref(false);
const detailsDialog = ref(false);
const noteDialog = ref(false);
const followupDialog = ref(false);
const completeDialog = ref(false);
const escalateDialog = ref(false);
const selectedSession = ref<MentalHealthSession | null>(null);

const toast = reactive({ open: false, text: '', color: 'info' as 'success' | 'info' | 'warning' | 'error' });
const errors = reactive<Record<string, string>>({});

const sessionForm = reactive({
  patient_id: '', patient_name: '', counselor: 'Dr. Rivera', session_type: 'Individual Counseling',
  session_mode: 'in_person', location_room: '', guardian_contact: '', emergency_contact: '',
  appointment_at: '', risk_level: 'low', diagnosis_condition: '', treatment_plan: '', session_goals: '',
  session_duration_minutes: 45, medication_reference: '', follow_up_frequency: 'Weekly',
  assessment_tool: 'PHQ-9', assessment_score: null as number | null, escalation_reason: ''
});

const noteForm = reactive({ note_type: 'Progress', note_content: '', clinical_score: null as number | null, attachment_name: '', attachment_url: '', mark_at_risk: false });
const followupForm = reactive({ next_follow_up_at: '', follow_up_frequency: 'Weekly' });
const completeForm = reactive({ outcome_result: '' });
const escalateForm = reactive({ escalation_reason: '' });

const rolePermissions: Record<SessionRole, SessionAction[]> = {
  Admin: ['create', 'edit', 'note', 'followup', 'complete', 'escalate', 'archive', 'activate', 'draft'],
  Counselor: ['create', 'edit', 'note', 'followup', 'complete', 'activate', 'draft'],
  Nurse: ['note', 'followup', 'draft'],
  Doctor: ['note', 'escalate', 'draft'],
  Receptionist: ['create', 'followup', 'draft']
};

const counselorItems = ['Dr. Rivera', 'Dr. Molina', 'Dr. Dela Cruz', 'Dr. Humour'];
const sessionTypeItems = ['Individual Counseling', 'Family Session', 'Substance Recovery', 'Group Therapy', 'Youth Counseling'];
const modeItems = [{ title: 'In Person', value: 'in_person' }, { title: 'Online', value: 'online' }];
const riskItems = [{ title: 'Low', value: 'low' }, { title: 'Medium', value: 'medium' }, { title: 'High', value: 'high' }];
const statusItems: Array<{ title: string; value: 'all' | MentalHealthStatus }> = [
  { title: 'All', value: 'all' }, { title: 'Create', value: 'create' }, { title: 'Active', value: 'active' }, { title: 'Follow-Up', value: 'follow_up' },
  { title: 'At-Risk', value: 'at_risk' }, { title: 'Completed', value: 'completed' }, { title: 'Escalated', value: 'escalated' }, { title: 'Archived', value: 'archived' }
];

const patientLookupItems = computed(() => patients.value.map((p) => ({ title: `${p.patient_name} (${p.patient_id})`, value: p.patient_id, subtitle: `${p.previous_sessions} previous sessions` })));
const selectedPatientHistory = computed(() => patients.value.find((p) => p.patient_id === sessionForm.patient_id) || null);
watch(() => sessionForm.patient_id, (patientId) => { const patient = patients.value.find((item) => item.patient_id === patientId); if (patient) sessionForm.patient_name = patient.patient_name; });

const filteredSessions = computed(() => {
  const query = search.value.trim().toLowerCase();
  return sessions.value.filter((item) => {
    if (statusFilter.value !== 'all' && item.status !== statusFilter.value) return false;
    if (riskFilter.value !== 'all' && item.risk_level !== riskFilter.value) return false;
    if (!query) return true;
    return `${item.case_reference} ${item.patient_name} ${item.patient_id} ${item.counselor} ${item.session_type}`.toLowerCase().includes(query);
  });
});

const sessionNotes = computed(() => (!selectedSession.value ? [] : notes.value.filter((n) => n.session_id === selectedSession.value?.id)));
const sessionActivity = computed(() => (!selectedSession.value ? [] : activities.value.filter((a) => a.session_id === selectedSession.value?.id).slice(0, 12)));
const upcomingFollowups = computed(() => sessions.value.filter((s) => s.next_follow_up_at).sort((a, b) => String(a.next_follow_up_at).localeCompare(String(b.next_follow_up_at))).slice(0, 6));
const riskAlerts = computed(() => sessions.value.filter((s) => s.status === 'at_risk' || s.status === 'escalated').slice(0, 6));
const recentActivity = computed(() => activities.value.slice(0, 8));

function can(action: SessionAction): boolean { return rolePermissions[role.value]?.includes(action) || false; }
function statusLabel(status: MentalHealthStatus): string { return status.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
function statusColor(status: MentalHealthStatus): string { if (status === 'active') return 'primary'; if (status === 'follow_up') return 'info'; if (status === 'completed') return 'success'; if (status === 'at_risk') return 'warning'; if (status === 'escalated') return 'error'; if (status === 'archived') return 'secondary'; return 'grey'; }
function formatDateTime(value: string | null): string { if (!value) return '--'; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(); }
function showToast(text: string, color: 'success' | 'info' | 'warning' | 'error' = 'info'): void {
  if (color === 'success') {
    emitSuccessModal({ title: 'Success', message: text, tone: 'success' });
    return;
  }
  toast.text = text;
  toast.color = color;
  toast.open = true;
}
function clearErrors(): void { Object.keys(errors).forEach((k) => delete errors[k]); }
function reloadDashboard(): void { pageLoading.value = true; loadData().finally(() => { pageLoading.value = false; }); }

function primaryAction(item: MentalHealthSession): { label: string; tone: 'primary' | 'success' | 'warning' | 'error' | 'secondary'; disabled: boolean } {
  if (item.status === 'create') return { label: 'Activate', tone: 'success', disabled: !can('activate') || actionLoading.value };
  if (item.status === 'active') return { label: 'Record Notes', tone: 'primary', disabled: !can('note') || actionLoading.value };
  if (item.status === 'follow_up') return { label: 'Open Session', tone: 'primary', disabled: actionLoading.value };
  if (item.status === 'at_risk') return { label: 'Escalate', tone: 'error', disabled: !can('escalate') || actionLoading.value };
  if (item.status === 'completed') return { label: 'Archive', tone: 'secondary', disabled: !can('archive') || actionLoading.value };
  if (item.status === 'escalated') return { label: 'Archive', tone: 'secondary', disabled: !can('archive') || actionLoading.value };
  return { label: 'Open Session', tone: 'primary', disabled: actionLoading.value };
}

function runPrimaryAction(item: MentalHealthSession): void {
  if (item.status === 'create') {
    activateOrArchive(item);
    return;
  }
  if (item.status === 'active') {
    openNote(item);
    return;
  }
  if (item.status === 'at_risk') {
    openEscalate(item);
    return;
  }
  if (item.status === 'completed' || item.status === 'escalated') {
    activateOrArchive(item);
    return;
  }
  openDetails(item);
}

function resetSessionForm(): void {
  Object.assign(sessionForm, { patient_id: '', patient_name: '', counselor: 'Dr. Rivera', session_type: 'Individual Counseling', session_mode: 'in_person', location_room: '', guardian_contact: '', emergency_contact: '', appointment_at: '', risk_level: 'low', diagnosis_condition: '', treatment_plan: '', session_goals: '', session_duration_minutes: 45, medication_reference: '', follow_up_frequency: 'Weekly', assessment_tool: 'PHQ-9', assessment_score: null, escalation_reason: '' });
}

function applySessionToForm(session: MentalHealthSession): void {
  Object.assign(sessionForm, {
    patient_id: session.patient_id, patient_name: session.patient_name, counselor: session.counselor, session_type: session.session_type,
    session_mode: session.session_mode, location_room: session.location_room || '', guardian_contact: session.guardian_contact || '', emergency_contact: session.emergency_contact || '',
    appointment_at: session.appointment_at ? String(session.appointment_at).slice(0, 16) : '', risk_level: session.risk_level, diagnosis_condition: session.diagnosis_condition || '',
    treatment_plan: session.treatment_plan || '', session_goals: session.session_goals || '', session_duration_minutes: session.session_duration_minutes || 45,
    medication_reference: session.medication_reference || '', follow_up_frequency: session.follow_up_frequency || 'Weekly', assessment_tool: session.assessment_tool || 'PHQ-9',
    assessment_score: session.assessment_score ?? null, escalation_reason: session.escalation_reason || ''
  });
}

async function loadData(options: { silent?: boolean } = {}): Promise<void> {
  const snapshot = await realtime.runLatest(
    async () => fetchMentalHealthSnapshot(),
    {
      silent: options.silent,
      onError: (error) => {
        showToast(error instanceof Error ? error.message : String(error), 'error');
      }
    }
  );
  if (!snapshot) return;
  sessions.value = snapshot.sessions;
  patients.value = snapshot.patients;
  notes.value = snapshot.notes;
  activities.value = snapshot.activities;
  analytics.value = snapshot.analytics;
}

function openCreate(): void { if (!can('create')) return showToast(`Role ${role.value} is not allowed to create sessions.`, 'warning'); isEditMode.value = false; selectedSession.value = null; clearErrors(); resetSessionForm(); sessionDialog.value = true; }
function openEdit(session: MentalHealthSession): void { if (!can('edit')) return showToast(`Role ${role.value} is not allowed to edit sessions.`, 'warning'); isEditMode.value = true; selectedSession.value = session; clearErrors(); applySessionToForm(session); sessionDialog.value = true; }
function openDetails(session: MentalHealthSession): void { selectedSession.value = session; detailsDialog.value = true; }
function openNote(session: MentalHealthSession): void { if (!can('note')) return showToast(`Role ${role.value} is not allowed to record notes.`, 'warning'); selectedSession.value = session; clearErrors(); Object.assign(noteForm, { note_type: 'Progress', note_content: '', clinical_score: null, attachment_name: '', attachment_url: '', mark_at_risk: false }); noteDialog.value = true; }
function openFollowup(session: MentalHealthSession): void { if (!can('followup')) return showToast(`Role ${role.value} is not allowed to schedule follow-up.`, 'warning'); selectedSession.value = session; followupForm.next_follow_up_at = session.next_follow_up_at ? String(session.next_follow_up_at).slice(0, 16) : ''; followupForm.follow_up_frequency = session.follow_up_frequency || 'Weekly'; followupDialog.value = true; }
function openComplete(session: MentalHealthSession): void { if (!can('complete')) return showToast(`Role ${role.value} is not allowed to complete sessions.`, 'warning'); selectedSession.value = session; completeForm.outcome_result = session.outcome_result || ''; completeDialog.value = true; }
function openEscalate(session: MentalHealthSession): void { if (!can('escalate')) return showToast(`Role ${role.value} is not allowed to escalate sessions.`, 'warning'); selectedSession.value = session; escalateForm.escalation_reason = session.escalation_reason || ''; escalateDialog.value = true; }

function validateSessionForm(): boolean {
  clearErrors();
  if (!sessionForm.patient_id) errors.patient_id = 'Patient is required.';
  if (!sessionForm.counselor) errors.counselor = 'Counselor is required.';
  if (!sessionForm.session_type) errors.session_type = 'Session type is required.';
  if (!sessionForm.appointment_at) errors.appointment_at = 'Session date/time is required.';
  if (sessionForm.session_mode === 'in_person' && !sessionForm.location_room) errors.location_room = 'Room/location is required for in-person mode.';
  if ((sessionForm.session_type.toLowerCase().includes('family') || sessionForm.session_type.toLowerCase().includes('youth')) && !sessionForm.guardian_contact) errors.guardian_contact = 'Guardian/contact is required for family/youth sessions.';
  if (sessionForm.risk_level === 'high' && !sessionForm.escalation_reason) errors.escalation_reason = 'Escalation reason is required for high-risk sessions.';
  return Object.keys(errors).length === 0;
}

async function submitSession(isDraft = false): Promise<void> {
  if (!isDraft && !validateSessionForm()) return;
  actionLoading.value = true;
  try {
    if (isEditMode.value && selectedSession.value) {
      await dispatchMentalHealthAction({ action: 'update_session', role: role.value, session_id: selectedSession.value.id, status: selectedSession.value.status, ...sessionForm });
      showToast('Session updated.', 'success');
    } else {
      await dispatchMentalHealthAction({ action: 'create_session', role: role.value, is_draft: isDraft, ...sessionForm });
      showToast(isDraft ? 'Draft session saved.' : 'Session created.', 'success');
    }
    sessionDialog.value = false;
    await loadData();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    actionLoading.value = false;
  }
}

async function saveDraft(): Promise<void> { if (!can('draft')) return showToast(`Role ${role.value} is not allowed to save drafts.`, 'warning'); await submitSession(true); }

async function submitNote(): Promise<void> {
  clearErrors();
  if (!selectedSession.value) return;
  if (!noteForm.note_content.trim()) { errors.note_content = 'Note content is required.'; return; }
  actionLoading.value = true;
  try {
    await dispatchMentalHealthAction({ action: 'record_note', role: role.value, session_id: selectedSession.value.id, ...noteForm });
    noteDialog.value = false;
    showToast('Session note recorded.', 'success');
    await loadData();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    actionLoading.value = false;
  }
}

async function submitFollowup(): Promise<void> {
  if (!selectedSession.value) return;
  clearErrors();
  if (!followupForm.next_follow_up_at) errors.next_follow_up_at = 'Follow-up date/time is required.';
  if (!followupForm.follow_up_frequency) errors.follow_up_frequency = 'Follow-up frequency is required.';
  if (Object.keys(errors).length) return;
  actionLoading.value = true;
  try {
    await dispatchMentalHealthAction({ action: 'schedule_followup', role: role.value, session_id: selectedSession.value.id, ...followupForm });
    followupDialog.value = false;
    showToast('Follow-up planned.', 'success');
    await loadData();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    actionLoading.value = false;
  }
}

async function submitComplete(): Promise<void> {
  if (!selectedSession.value) return;
  if (!completeForm.outcome_result.trim()) { errors.outcome_result = 'Outcome/result is required.'; return; }
  actionLoading.value = true;
  try {
    await dispatchMentalHealthAction({ action: 'complete_session', role: role.value, session_id: selectedSession.value.id, outcome_result: completeForm.outcome_result });
    completeDialog.value = false;
    showToast('Session completed.', 'success');
    await loadData();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    actionLoading.value = false;
  }
}

async function submitEscalate(): Promise<void> {
  if (!selectedSession.value) return;
  if (!escalateForm.escalation_reason.trim()) { errors.escalation_reason = 'Escalation reason is required.'; return; }
  actionLoading.value = true;
  try {
    await dispatchMentalHealthAction({ action: 'escalate_session', role: role.value, session_id: selectedSession.value.id, escalation_reason: escalateForm.escalation_reason });
    escalateDialog.value = false;
    showToast('Session escalated.', 'warning');
    await loadData();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    actionLoading.value = false;
  }
}

async function activateOrArchive(session: MentalHealthSession): Promise<void> {
  const canActivate = can('activate') && session.status === 'create';
  const canArchive = can('archive') && (session.status === 'completed' || session.status === 'escalated');
  if (!canActivate && !canArchive) return;
  actionLoading.value = true;
  try {
    if (canActivate) {
      await dispatchMentalHealthAction({ action: 'update_session', role: role.value, session_id: session.id, status: 'active' });
      showToast('Session activated.', 'success');
    } else {
      await dispatchMentalHealthAction({ action: 'archive_session', role: role.value, session_id: session.id });
      showToast('Session archived.', 'info');
    }
    await loadData();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    actionLoading.value = false;
  }
}

onMounted(async () => {
  try {
    await loadData();
    realtime.startPolling(() => {
      void loadData({ silent: true });
    }, REALTIME_POLICY.polling.patientsMs);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    pageLoading.value = false;
  }
});

onUnmounted(() => {
  realtime.stopPolling();
  realtime.invalidatePending();
});
</script>

<template>
  <div class="mental-health-page">
    <v-card class="hero-card mb-4" variant="outlined">
      <v-card-text class="d-flex flex-wrap justify-space-between align-center ga-3">
        <div>
          <h1 class="text-h4 font-weight-black mb-1 hero-title">Mental Health & Addiction</h1>
          <p class="text-medium-emphasis mb-0">Workflow: Create -> Active -> Follow-Up -> At-Risk -> Completed -> Escalated -> Archived</p>
        </div>
        <div class="d-flex ga-2 align-center flex-wrap">
          <v-select v-model="role" :items="['Admin', 'Counselor', 'Nurse', 'Doctor', 'Receptionist']" label="Session Role" variant="outlined" density="compact" hide-details class="role-select" />
        </div>
      </v-card-text>
    </v-card>

    <v-row class="mb-4">
      <v-col cols="12" sm="6" md="4" lg="2"><v-card class="kpi-card" color="primary" variant="flat"><v-card-text>Active<br /><strong class="text-h5">{{ analytics.active }}</strong></v-card-text></v-card></v-col>
      <v-col cols="12" sm="6" md="4" lg="2"><v-card class="kpi-card" color="info" variant="flat"><v-card-text>Follow-Up<br /><strong class="text-h5">{{ analytics.follow_up }}</strong></v-card-text></v-card></v-col>
      <v-col cols="12" sm="6" md="4" lg="2"><v-card class="kpi-card" color="warning" variant="flat"><v-card-text>At-Risk<br /><strong class="text-h5">{{ analytics.at_risk }}</strong></v-card-text></v-card></v-col>
      <v-col cols="12" sm="6" md="4" lg="2"><v-card class="kpi-card" color="success" variant="flat"><v-card-text>Completed<br /><strong class="text-h5">{{ analytics.completed }}</strong></v-card-text></v-card></v-col>
      <v-col cols="12" sm="6" md="4" lg="2"><v-card class="kpi-card" color="error" variant="flat"><v-card-text>Escalated<br /><strong class="text-h5">{{ analytics.escalated }}</strong></v-card-text></v-card></v-col>
      <v-col cols="12" sm="6" md="4" lg="2"><v-card class="kpi-card" color="secondary" variant="flat"><v-card-text>Archived<br /><strong class="text-h5">{{ analytics.archived }}</strong></v-card-text></v-card></v-col>
    </v-row>

    <v-card class="filter-card mb-4" variant="outlined">
      <v-card-text>
        <v-row>
          <v-col cols="12" md="6"><v-text-field v-model="search" prepend-inner-icon="mdi-magnify" label="Search case, patient, counselor" density="compact" variant="outlined" hide-details /></v-col>
          <v-col cols="6" md="3"><v-select v-model="statusFilter" :items="statusItems" label="Status" density="compact" variant="outlined" hide-details /></v-col>
          <v-col cols="6" md="3"><v-select v-model="riskFilter" :items="[{title:'All',value:'all'},{title:'Low',value:'low'},{title:'Medium',value:'medium'},{title:'High',value:'high'}]" label="Risk" density="compact" variant="outlined" hide-details /></v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-row>
      <v-col cols="12" lg="8">
        <v-card class="table-card" variant="outlined">
          <v-card-item>
            <v-card-title>Sessions</v-card-title>
            <template #append>
              <div class="d-flex ga-2 align-center flex-wrap">
                <v-btn class="saas-btn saas-btn-ghost" prepend-icon="mdi-refresh" :loading="pageLoading" @click="reloadDashboard">Refresh</v-btn>
                <v-btn class="saas-btn saas-btn-primary" prepend-icon="mdi-plus" :disabled="!can('create')" @click="openCreate">New Session</v-btn>
              </div>
            </template>
          </v-card-item>
          <v-divider />
          <v-card-text>
            <v-progress-linear v-if="pageLoading" indeterminate color="primary" class="mb-3" />
            <v-table v-else density="comfortable">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Patient</th>
                  <th>Status</th>
                  <th>Risk</th>
                  <th>Counselor</th>
                  <th>Follow-Up</th>
                  <th class="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in filteredSessions" :key="item.id" class="session-row">
                  <td>{{ item.case_reference }}</td>
                  <td><div class="font-weight-bold">{{ item.patient_name }}</div><div class="text-caption text-medium-emphasis">{{ item.patient_id }}</div></td>
                  <td><v-chip size="small" :color="statusColor(item.status)" variant="tonal">{{ statusLabel(item.status) }}</v-chip></td>
                  <td><v-chip size="x-small" :color="item.risk_level === 'high' ? 'error' : item.risk_level === 'medium' ? 'warning' : 'success'" variant="tonal">{{ item.risk_level }}</v-chip></td>
                  <td>{{ item.counselor }}</td>
                  <td>{{ formatDateTime(item.next_follow_up_at) }}</td>
                  <td class="text-right">
                    <v-btn
                      size="small"
                      class="action-primary-btn mr-1"
                      :color="primaryAction(item).tone"
                      :disabled="primaryAction(item).disabled"
                      :loading="actionLoading && (item.status === 'create' || item.status === 'completed' || item.status === 'escalated')"
                      @click="runPrimaryAction(item)"
                    >
                      {{ primaryAction(item).label }}
                    </v-btn>
                    <v-btn size="small" class="mr-1 action-open-btn" variant="text" @click="openDetails(item)">Open</v-btn>
                    <v-menu>
                      <template #activator="{ props }"><v-btn v-bind="props" size="small" icon="mdi-dots-horizontal" variant="tonal" class="action-menu-btn" /></template>
                      <v-list density="compact" class="action-menu">
                        <v-list-item prepend-icon="mdi-pencil-outline" title="Edit" :disabled="!can('edit')" @click="openEdit(item)" />
                        <v-list-item prepend-icon="mdi-notebook-edit-outline" title="Record Notes" :disabled="!can('note')" @click="openNote(item)" />
                        <v-list-item prepend-icon="mdi-calendar-sync-outline" title="Plan Follow-Up" :disabled="!can('followup')" @click="openFollowup(item)" />
                        <v-list-item prepend-icon="mdi-check-decagram-outline" title="Complete" :disabled="!can('complete')" @click="openComplete(item)" />
                        <v-list-item prepend-icon="mdi-alert-octagon-outline" title="Escalate" :disabled="!can('escalate')" @click="openEscalate(item)" />
                        <v-list-item :title="item.status === 'create' ? 'Activate' : 'Archive'" :disabled="item.status === 'create' ? !can('activate') : !(can('archive') && (item.status === 'completed' || item.status === 'escalated'))" @click="activateOrArchive(item)" />
                      </v-list>
                    </v-menu>
                  </td>
                </tr>
                <tr v-if="!filteredSessions.length"><td colspan="7" class="text-center text-medium-emphasis py-6">No sessions matched the current filters.</td></tr>
              </tbody>
            </v-table>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" lg="4">
        <v-card variant="outlined" class="mb-3">
          <v-card-item><v-card-title>Upcoming Follow-Ups</v-card-title></v-card-item>
          <v-divider />
          <v-list density="compact">
            <v-list-item v-for="item in upcomingFollowups" :key="`f-${item.id}`" :title="item.patient_name" :subtitle="`${item.case_reference} • ${formatDateTime(item.next_follow_up_at)}`" />
            <v-list-item v-if="!upcomingFollowups.length" title="No follow-ups scheduled." />
          </v-list>
        </v-card>

        <v-card variant="outlined" class="mb-3">
          <v-card-item><v-card-title>Risk Alerts</v-card-title></v-card-item>
          <v-divider />
          <v-list density="compact">
            <v-list-item v-for="item in riskAlerts" :key="`r-${item.id}`" :title="item.patient_name" :subtitle="item.escalation_reason || 'High risk, monitoring required.'" />
            <v-list-item v-if="!riskAlerts.length" title="No active risk alerts." />
          </v-list>
        </v-card>

        <v-card variant="outlined">
          <v-card-item><v-card-title>Activity Log</v-card-title></v-card-item>
          <v-divider />
          <v-list density="compact">
            <v-list-item v-for="item in recentActivity" :key="`a-${item.id}`" :title="item.action" :subtitle="`${item.detail} • ${formatDateTime(item.created_at)}`" />
            <v-list-item v-if="!recentActivity.length" title="No activity yet." />
          </v-list>
        </v-card>
      </v-col>
    </v-row>

    <ModuleActivityLogs module="mental_health" title="Module Activity Logs" :per-page="8" />

    <v-dialog v-model="sessionDialog" max-width="980">
      <v-card>
        <v-card-item>
          <v-card-title>{{ isEditMode ? 'Edit Session' : 'Create Session' }}</v-card-title>
          <template #append><v-btn icon="mdi-close" variant="text" @click="sessionDialog = false" /></template>
        </v-card-item>
        <v-divider />
        <v-card-text>
          <div class="flow-steps mb-4"><span class="step active">1. Create Session</span><span class="step">2. Record Notes</span><span class="step">3. Plan Follow-Up</span><span class="step">4. Complete</span></div>
          <v-row>
            <v-col cols="12" md="6">
              <v-autocomplete v-model="sessionForm.patient_id" :items="patientLookupItems" item-title="title" item-value="value" label="Patient Lookup *" variant="outlined" density="comfortable" :error-messages="errors.patient_id" />
              <div class="text-caption text-medium-emphasis mt-1">Type patient ID or name to load previous history.</div>
              <div v-if="selectedPatientHistory" class="text-caption mt-1">Previous sessions: {{ selectedPatientHistory.previous_sessions }} | Latest case: {{ selectedPatientHistory.latest_case_reference || '--' }}</div>
            </v-col>
            <v-col cols="12" md="6"><v-text-field v-model="sessionForm.patient_name" label="Patient Name" variant="outlined" density="comfortable" readonly /></v-col>
            <v-col cols="12" md="6"><v-select v-model="sessionForm.counselor" :items="counselorItems" label="Counselor *" variant="outlined" :error-messages="errors.counselor" /></v-col>
            <v-col cols="12" md="6"><v-select v-model="sessionForm.session_type" :items="sessionTypeItems" label="Session Type *" variant="outlined" :error-messages="errors.session_type" /></v-col>
            <v-col cols="12" md="4"><v-select v-model="sessionForm.session_mode" :items="modeItems" label="Session Mode" variant="outlined" /></v-col>
            <v-col cols="12" md="4"><v-text-field v-model="sessionForm.location_room" label="Location/Room" variant="outlined" :error-messages="errors.location_room" /></v-col>
            <v-col cols="12" md="4"><SaasDateTimePickerField v-model="sessionForm.appointment_at" mode="datetime" label="Session Date/Time *" :error-messages="errors.appointment_at" /></v-col>
            <v-col cols="12" md="4"><v-select v-model="sessionForm.risk_level" :items="riskItems" label="Risk Level" variant="outlined" /></v-col>
            <v-col cols="12" md="4"><v-text-field v-model.number="sessionForm.session_duration_minutes" type="number" min="15" step="5" label="Duration (minutes)" variant="outlined" /></v-col>
            <v-col cols="12" md="4"><v-text-field v-model="sessionForm.follow_up_frequency" label="Follow-Up Frequency" variant="outlined" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="sessionForm.guardian_contact" label="Guardian/Contact" variant="outlined" :error-messages="errors.guardian_contact" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="sessionForm.emergency_contact" label="Emergency Contact" variant="outlined" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="sessionForm.medication_reference" label="Medication Reference" variant="outlined" /></v-col>
            <v-col cols="12" md="3"><v-text-field v-model="sessionForm.assessment_tool" label="Assessment Tool" variant="outlined" /></v-col>
            <v-col cols="12" md="3"><v-text-field v-model.number="sessionForm.assessment_score" type="number" step="0.1" label="Assessment Score" variant="outlined" /></v-col>
            <v-col cols="12"><v-textarea v-model="sessionForm.diagnosis_condition" label="Diagnosis / Condition" variant="outlined" rows="2" /></v-col>
            <v-col cols="12"><v-textarea v-model="sessionForm.treatment_plan" label="Treatment Plan" variant="outlined" rows="2" /></v-col>
            <v-col cols="12"><v-textarea v-model="sessionForm.session_goals" label="Session Goals" variant="outlined" rows="2" /></v-col>
            <v-col cols="12" v-if="sessionForm.risk_level === 'high'"><v-textarea v-model="sessionForm.escalation_reason" label="Escalation Reason *" variant="outlined" :error-messages="errors.escalation_reason" /></v-col>
          </v-row>
        </v-card-text>
        <v-card-actions class="px-6 pb-5"><v-spacer /><v-btn variant="text" @click="sessionDialog = false">Cancel</v-btn><v-btn color="secondary" variant="outlined" :loading="actionLoading" :disabled="!can('draft')" @click="saveDraft">Save Draft</v-btn><v-btn color="primary" :loading="actionLoading" @click="submitSession(false)">{{ isEditMode ? 'Update Session' : 'Create Session' }}</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="detailsDialog" max-width="1080">
      <v-card v-if="selectedSession">
        <v-card-item><v-card-title>{{ selectedSession.patient_name }} - {{ selectedSession.case_reference }}</v-card-title><template #append><v-btn icon="mdi-close" variant="text" @click="detailsDialog = false" /></template></v-card-item>
        <v-divider />
        <v-card-text>
          <v-row>
            <v-col cols="12" md="4">
              <div class="summary-line"><span>Status</span><v-chip :color="statusColor(selectedSession.status)" variant="tonal" size="small">{{ statusLabel(selectedSession.status) }}</v-chip></div>
              <div class="summary-line"><span>Risk</span><strong>{{ selectedSession.risk_level }}</strong></div>
              <div class="summary-line"><span>Type</span><strong>{{ selectedSession.session_type }}</strong></div>
              <div class="summary-line"><span>Counselor</span><strong>{{ selectedSession.counselor }}</strong></div>
              <div class="summary-line"><span>Next Follow-Up</span><strong>{{ formatDateTime(selectedSession.next_follow_up_at) }}</strong></div>
            </v-col>
            <v-col cols="12" md="8">
              <div class="flow-steps mb-3"><span class="step active">Create Session</span><span class="step active">Record Notes</span><span class="step">Plan Follow-Up</span><span class="step">Complete / Escalate</span></div>
              <v-alert variant="tonal" color="info" class="mb-3">{{ selectedSession.treatment_plan || 'No treatment plan documented.' }}</v-alert>
              <v-card variant="outlined" class="mb-3"><v-card-item><v-card-title class="text-subtitle-1">Structured Notes</v-card-title></v-card-item><v-divider /><v-list density="compact"><v-list-item v-for="item in sessionNotes.slice(0, 6)" :key="`n-${item.id}`" :title="`${item.note_type} • ${item.created_by_role}`" :subtitle="`${item.note_content}${item.attachment_name ? ` • Attachment: ${item.attachment_name}` : ''}`" /><v-list-item v-if="!sessionNotes.length" title="No notes for this session." /></v-list></v-card>
              <v-card variant="outlined"><v-card-item><v-card-title class="text-subtitle-1">Timeline / Audit</v-card-title></v-card-item><v-divider /><v-list density="compact"><v-list-item v-for="item in sessionActivity" :key="`ac-${item.id}`" :title="item.action" :subtitle="`${item.detail} • ${item.actor_role} • ${formatDateTime(item.created_at)}`" /><v-list-item v-if="!sessionActivity.length" title="No activity yet." /></v-list></v-card>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog v-model="noteDialog" max-width="760">
      <v-card>
        <v-card-item><v-card-title>Record Notes</v-card-title></v-card-item>
        <v-divider />
        <v-card-text>
          <v-row>
            <v-col cols="12" md="4"><v-select v-model="noteForm.note_type" :items="['Progress', 'Clinical', 'Risk', 'Counseling']" label="Note Type" variant="outlined" /></v-col>
            <v-col cols="12" md="4"><v-text-field v-model.number="noteForm.clinical_score" type="number" step="0.1" label="Clinical Score" variant="outlined" /></v-col>
            <v-col cols="12" md="4"><v-checkbox v-model="noteForm.mark_at_risk" label="Mark At-Risk" color="error" hide-details /></v-col>
            <v-col cols="12"><v-textarea v-model="noteForm.note_content" label="Structured Note Content *" rows="4" variant="outlined" :error-messages="errors.note_content" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="noteForm.attachment_name" label="Attachment Name" variant="outlined" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="noteForm.attachment_url" label="Attachment URL" variant="outlined" /></v-col>
          </v-row>
        </v-card-text>
        <v-card-actions class="px-6 pb-5"><v-spacer /><v-btn variant="text" @click="noteDialog = false">Cancel</v-btn><v-btn color="primary" :loading="actionLoading" @click="submitNote">Save Note</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="followupDialog" max-width="620">
      <v-card>
        <v-card-item><v-card-title>Plan Follow-Up</v-card-title></v-card-item>
        <v-divider />
        <v-card-text>
          <SaasDateTimePickerField v-model="followupForm.next_follow_up_at" mode="datetime" label="Next Follow-Up *" :error-messages="errors.next_follow_up_at" class="mb-3" />
          <v-text-field v-model="followupForm.follow_up_frequency" label="Follow-Up Frequency *" variant="outlined" :error-messages="errors.follow_up_frequency" />
        </v-card-text>
        <v-card-actions class="px-6 pb-5"><v-spacer /><v-btn variant="text" @click="followupDialog = false">Cancel</v-btn><v-btn color="primary" :loading="actionLoading" @click="submitFollowup">Schedule Follow-Up</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="completeDialog" max-width="620">
      <v-card>
        <v-card-item><v-card-title>Complete Session</v-card-title></v-card-item>
        <v-divider />
        <v-card-text>
          <v-textarea v-model="completeForm.outcome_result" label="Outcome / Result *" rows="3" variant="outlined" :error-messages="errors.outcome_result" />
        </v-card-text>
        <v-card-actions class="px-6 pb-5"><v-spacer /><v-btn variant="text" @click="completeDialog = false">Cancel</v-btn><v-btn color="success" :loading="actionLoading" @click="submitComplete">Complete</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="escalateDialog" max-width="620">
      <v-card>
        <v-card-item><v-card-title>Escalate Session</v-card-title></v-card-item>
        <v-divider />
        <v-card-text>
          <v-textarea v-model="escalateForm.escalation_reason" label="Escalation Reason *" rows="3" variant="outlined" :error-messages="errors.escalation_reason" />
        </v-card-text>
        <v-card-actions class="px-6 pb-5"><v-spacer /><v-btn variant="text" @click="escalateDialog = false">Cancel</v-btn><v-btn color="error" :loading="actionLoading" @click="submitEscalate">Escalate</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="toast.open" :color="toast.color" timeout="3200">{{ toast.text }}</v-snackbar>
  </div>
</template>

<style scoped>
.mental-health-page {
  display: grid;
  gap: 16px;
}

.hero-card {
  border-radius: 18px;
  border-color: #d7e4ff !important;
  background: linear-gradient(120deg, #f4f8ff 0%, #eef4ff 45%, #f8faff 100%);
  box-shadow: 0 10px 28px rgba(37, 99, 235, 0.08);
}

.hero-title {
  color: #0f172a;
  letter-spacing: -0.2px;
}

.filter-card,
.table-card {
  border-radius: 16px;
  border-color: #dbe4f2 !important;
  background: #fbfdff;
}

.kpi-card {
  border-radius: 14px;
  color: #fff;
  box-shadow: 0 12px 20px rgba(15, 23, 42, 0.15);
}

.role-select {
  min-width: 210px;
}

.saas-btn {
  border-radius: 12px !important;
  min-height: 38px !important;
  padding-inline: 14px !important;
  font-weight: 700 !important;
  letter-spacing: 0.2px;
  text-transform: none !important;
}

.saas-btn-primary {
  background: linear-gradient(90deg, #2563eb 0%, #3b82f6 100%) !important;
  color: #fff !important;
  box-shadow: 0 8px 16px rgba(37, 99, 235, 0.35);
}

.saas-btn-ghost {
  border: 1px solid #cfd8ea !important;
  background: #ffffff !important;
  color: #1f2937 !important;
}

.flow-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.step {
  border: 1px solid rgba(15, 23, 42, 0.18);
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 700;
  color: #334155;
}

.step.active {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}

.session-row:hover {
  background: #f8fbff;
}

.action-primary-btn {
  border-radius: 10px !important;
  min-height: 30px !important;
  text-transform: none !important;
  font-weight: 700 !important;
}

.action-open-btn {
  border-radius: 10px !important;
  text-transform: none !important;
  font-weight: 700 !important;
}

.action-menu-btn {
  border-radius: 10px !important;
}

.action-menu {
  border: 1px solid #e4eaf5;
  border-radius: 12px;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.16);
}

.summary-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px dashed rgba(148, 163, 184, 0.35);
  padding: 8px 0;
  gap: 8px;
}

.summary-line span {
  color: #64748b;
  font-size: 13px;
}
</style>

