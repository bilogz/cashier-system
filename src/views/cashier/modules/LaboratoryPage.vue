<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SaasDateTimePickerField from '@/components/shared/SaasDateTimePickerField.vue';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';
import {
  createLabRequest,
  fetchLabActivity,
  fetchLabQueue,
  fetchLabRequest,
  rejectLabRequest,
  releaseLabReport,
  saveLabResults,
  startLabProcessing,
  type LabActivityLog,
  type LabPriority,
  type LabQueueRequest,
  type LabRequestDetail,
  type LabStatus
} from '@/services/laboratoryWorkflow';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';
import { REALTIME_POLICY } from '@/config/realtimePolicy';
import { emitSuccessModal } from '@/composables/useSuccessModal';
import { requestConfirmModal } from '@/composables/useConfirmModal';

type WorkflowStep = 'order' | 'processing' | 'encode' | 'release' | 'history';
type RowAction = 'process' | 'encode' | 'release' | 'view';
type SnackbarTone = 'success' | 'info' | 'warning' | 'error';
type StatusTab = 'all' | 'pending' | 'in_progress' | 'completed';
type LabRole = 'Admin' | 'Lab Manager' | 'Lab Technician' | 'Doctor';

type WorkflowRecord = LabRequestDetail & {
  activityLogs: LabActivityLog[];
};

type TestFieldType = 'number' | 'text' | 'select';

type TestFieldDefinition = {
  key: string;
  label: string;
  type: TestFieldType;
  required: boolean;
  min?: number;
  max?: number;
  unit?: string;
  options?: string[];
};

const LAB_QUERY_KEYS = ['lab_q', 'lab_tab', 'lab_category', 'lab_priority', 'lab_doctor', 'lab_from', 'lab_to'];

const FIELD_TEMPLATES: Record<string, TestFieldDefinition[]> = {
  'Blood Test': [
    { key: 'wbc', label: 'WBC', type: 'number', required: true, min: 3.5, max: 11, unit: '10^9/L' },
    { key: 'rbc', label: 'RBC', type: 'number', required: true, min: 3.8, max: 6.1, unit: '10^12/L' },
    { key: 'hemoglobin', label: 'Hemoglobin', type: 'number', required: true, min: 11.5, max: 17.5, unit: 'g/dL' },
    { key: 'platelets', label: 'Platelets', type: 'number', required: true, min: 150, max: 450, unit: '10^9/L' }
  ],
  Urinalysis: [
    { key: 'ph', label: 'pH', type: 'number', required: true, min: 4.5, max: 8 },
    { key: 'protein', label: 'Protein', type: 'select', required: true, options: ['Negative', 'Trace', '+1', '+2', '+3'] },
    { key: 'glucose', label: 'Glucose', type: 'select', required: true, options: ['Negative', 'Trace', '+1', '+2', '+3'] },
    { key: 'rbc_hpf', label: 'RBC / HPF', type: 'number', required: true, min: 0, max: 5 }
  ],
  'X-Ray': [
    { key: 'examined_area', label: 'Examined Area', type: 'text', required: true },
    { key: 'radiology_findings', label: 'Findings', type: 'text', required: true },
    { key: 'impression', label: 'Impression', type: 'text', required: true }
  ],
  'COVID Test': [
    { key: 'test_method', label: 'Method', type: 'select', required: true, options: ['Antigen', 'RT-PCR'] },
    { key: 'result', label: 'Result', type: 'select', required: true, options: ['Negative', 'Positive', 'Invalid'] },
    { key: 'ct_value', label: 'CT Value', type: 'number', required: false, min: 0, max: 45 }
  ],
  ECG: [
    { key: 'heart_rate', label: 'Heart Rate', type: 'number', required: true, min: 40, max: 200, unit: 'bpm' },
    { key: 'rhythm', label: 'Rhythm', type: 'text', required: true },
    { key: 'ecg_interpretation', label: 'Interpretation', type: 'text', required: true }
  ],
  Serology: [
    { key: 'igm', label: 'IgM', type: 'select', required: true, options: ['Reactive', 'Non-reactive'] },
    { key: 'igg', label: 'IgG', type: 'select', required: true, options: ['Reactive', 'Non-reactive'] },
    { key: 'serology_impression', label: 'Impression', type: 'text', required: true }
  ],
  Microbiology: [
    { key: 'organism', label: 'Organism Identified', type: 'text', required: true },
    { key: 'colony_count', label: 'Colony Count', type: 'number', required: false, min: 0, max: 1000000 },
    { key: 'susceptibility', label: 'Antibiotic Susceptibility', type: 'text', required: true }
  ],
  Histopathology: [
    { key: 'specimen_description', label: 'Specimen Description', type: 'text', required: true },
    { key: 'microscopic_findings', label: 'Microscopic Findings', type: 'text', required: true },
    { key: 'pathology_diagnosis', label: 'Pathology Diagnosis', type: 'text', required: true }
  ],
  'Stool Test': [
    { key: 'ova_parasite', label: 'Ova / Parasite', type: 'select', required: true, options: ['Negative', 'Positive'] },
    { key: 'occult_blood', label: 'Occult Blood', type: 'select', required: true, options: ['Negative', 'Positive'] },
    { key: 'stool_remarks', label: 'Remarks', type: 'text', required: false }
  ]
};

const DEFAULT_TEMPLATE: TestFieldDefinition[] = [
  { key: 'result_value', label: 'Result Value', type: 'text', required: true },
  { key: 'remarks', label: 'Remarks', type: 'text', required: true }
];

const route = useRoute();
const router = useRouter();

const queueLoading = ref(true);
const queueReady = ref(false);
const workflowDialog = ref(false);
const workflowLoading = ref(false);
const workflowBusy = ref(false);
const workflowStep = ref<WorkflowStep>('order');

const backendMode = ref<'unknown' | 'connected' | 'local'>('unknown');
const localModeToastShown = ref(false);
const syncLock = ref(false);

const searchQuery = ref('');
const statusTab = ref<StatusTab>('all');
const showAdvancedFilters = ref(false);
const filterCategory = ref('All');
const filterPriority = ref<'All' | LabPriority>('All');
const filterDoctor = ref('All');
const filterFromDate = ref('');
const filterToDate = ref('');

const listPage = ref(1);
const pageSize = 6;

const queueRows = ref<LabQueueRequest[]>([]);
const workflowCache = reactive<Record<number, WorkflowRecord>>({});
const selectedRequestId = ref<number | null>(null);

const createDialog = ref(false);
const createBusy = ref(false);
const createErrors = reactive<Record<string, string>>({});
const currentRole = ref<LabRole>('Lab Technician');
const createForm = reactive({
  patientLookup: '',
  patientName: '',
  patientId: '',
  visitId: '',
  category: 'Blood Test',
  priority: 'Normal' as LabPriority,
  requestedByDoctor: 'Dr. Humour',
  doctorDepartment: 'General Medicine',
  specimenType: 'Whole Blood',
  sampleSource: 'Blood',
  collectionDateTime: new Date().toISOString().slice(0, 16),
  clinicalDiagnosis: '',
  tests: ['Complete Blood Count (CBC)'] as string[],
  notes: '',
  labInstructions: '',
  insuranceReference: '',
  billingReference: ''
});

const processingForm = reactive({
  sampleCollected: false,
  assignedLabStaff: 'Tech Anne',
  rawAttachmentName: '',
  specimenType: 'Whole Blood',
  sampleSource: 'Blood',
  collectionDateTime: new Date().toISOString().slice(0, 16)
});

const encodeForm = reactive<Record<string, string | number | null>>({});
const encodeErrors = reactive<Record<string, string>>({});
const rejectDialog = ref(false);
const rejectForm = reactive({
  reason: '',
  resampleFlag: false
});

const pendingAction = ref<'none' | 'start' | 'save_processing' | 'save_draft' | 'finalize' | 'release'>('none');
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastAutosaveSignature = '';
const autosaveInFlight = ref(false);
const workflowBaselineSignature = ref('');
const lastAutosavedAt = ref<string | null>(null);
let draftSaveToken = 0;
const realtime = useRealtimeListSync();

const snackbar = reactive({
  open: false,
  text: '',
  color: 'success' as SnackbarTone
});

const labStaffOptions = ['Tech Anne', 'Tech Mark', 'Tech Liza', 'Tech Paolo', 'Tech Carla'];
const roleOptions: LabRole[] = ['Admin', 'Lab Manager', 'Lab Technician', 'Doctor'];
const baseCategoryItems = ['Blood Test', 'Urinalysis', 'X-Ray', 'COVID Test', 'ECG', 'Serology', 'Microbiology', 'Histopathology', 'Stool Test'];
const doctorDepartmentMap: Record<string, string> = {
  'Dr. Humour': 'General Medicine',
  'Dr. Morco': 'Internal Medicine',
  'Dr. Jenni': 'General Medicine',
  'Dr. Molina': 'Radiology',
  'Dr. Rivera': 'Pediatrics'
};
const categoryTestsMap: Record<string, string[]> = {
  'Blood Test': ['Complete Blood Count (CBC)', 'Comprehensive Metabolic Panel (CMP)', 'Lipid Panel', 'Fasting Blood Sugar'],
  Urinalysis: ['Urinalysis Routine', 'Microscopy', 'Urine Culture'],
  'X-Ray': ['Chest X-Ray (PA View)', 'Skull X-Ray', 'Lumbar Spine X-Ray'],
  'COVID Test': ['SARS-CoV-2 Antigen', 'RT-PCR'],
  ECG: ['12-lead ECG', 'Rhythm Strip'],
  Serology: ['Dengue IgM/IgG', 'HBsAg', 'HIV Screening'],
  Microbiology: ['Urine Culture and Sensitivity', 'Blood Culture', 'Sputum Culture'],
  Histopathology: ['Biopsy Histopathology', 'Cytology'],
  'Stool Test': ['Fecalysis', 'Stool Ova and Parasite', 'Fecal Occult Blood']
};
const testSpecimenMap: Record<string, { specimenType: string; sampleSource: string }> = {
  'Complete Blood Count (CBC)': { specimenType: 'Whole Blood', sampleSource: 'Blood' },
  'Comprehensive Metabolic Panel (CMP)': { specimenType: 'Serum', sampleSource: 'Blood' },
  'Lipid Panel': { specimenType: 'Serum', sampleSource: 'Blood' },
  'Fasting Blood Sugar': { specimenType: 'Plasma', sampleSource: 'Blood' },
  'Urinalysis Routine': { specimenType: 'Urine', sampleSource: 'Urine' },
  Microscopy: { specimenType: 'Urine', sampleSource: 'Urine' },
  'Urine Culture': { specimenType: 'Urine', sampleSource: 'Urine' },
  'Chest X-Ray (PA View)': { specimenType: 'Imaging', sampleSource: 'Radiology' },
  'Skull X-Ray': { specimenType: 'Imaging', sampleSource: 'Radiology' },
  'Lumbar Spine X-Ray': { specimenType: 'Imaging', sampleSource: 'Radiology' },
  'SARS-CoV-2 Antigen': { specimenType: 'Swab', sampleSource: 'Nasopharyngeal' },
  'RT-PCR': { specimenType: 'Swab', sampleSource: 'Nasopharyngeal' },
  '12-lead ECG': { specimenType: 'ECG Trace', sampleSource: 'Cardiac' },
  'Rhythm Strip': { specimenType: 'ECG Trace', sampleSource: 'Cardiac' },
  'Dengue IgM/IgG': { specimenType: 'Serum', sampleSource: 'Blood' },
  HBsAg: { specimenType: 'Serum', sampleSource: 'Blood' },
  'HIV Screening': { specimenType: 'Serum', sampleSource: 'Blood' },
  'Urine Culture and Sensitivity': { specimenType: 'Urine', sampleSource: 'Urine' },
  'Blood Culture': { specimenType: 'Whole Blood', sampleSource: 'Blood' },
  'Sputum Culture': { specimenType: 'Sputum', sampleSource: 'Respiratory' },
  'Biopsy Histopathology': { specimenType: 'Tissue', sampleSource: 'Biopsy' },
  Cytology: { specimenType: 'Body Fluid', sampleSource: 'Cytology' },
  Fecalysis: { specimenType: 'Stool', sampleSource: 'Stool' },
  'Stool Ova and Parasite': { specimenType: 'Stool', sampleSource: 'Stool' },
  'Fecal Occult Blood': { specimenType: 'Stool', sampleSource: 'Stool' }
};
const specimenTypeOptions = ['Whole Blood', 'Serum', 'Plasma', 'Urine', 'Swab', 'Imaging', 'ECG Trace', 'Sputum', 'Tissue', 'Body Fluid', 'Stool'];
const sampleSourceOptions = ['Blood', 'Urine', 'Nasopharyngeal', 'Radiology', 'Cardiac', 'Respiratory', 'Biopsy', 'Cytology', 'Stool', 'Other'];

const activeWorkflow = computed<WorkflowRecord | null>(() => {
  if (selectedRequestId.value == null) {
    return null;
  }
  return workflowCache[selectedRequestId.value] || null;
});

const categoryItems = computed(() => {
  const dynamic = Array.from(new Set(queueRows.value.map((item) => item.category).filter(Boolean))).sort();
  const merged = Array.from(new Set([...baseCategoryItems, ...dynamic]));
  return ['All', ...merged];
});

const doctorItems = computed(() => {
  const dynamic = Array.from(new Set(queueRows.value.map((item) => item.requestedByDoctor).filter(Boolean))).sort();
  return ['All', ...dynamic];
});
const doctorRequestItems = computed(() => doctorItems.value.filter((item) => item !== 'All'));
const patientLookupItems = computed(() => {
  return queueRows.value.map((row) => ({
    title: `${row.patientName} (${row.patientId})`,
    value: row.requestId,
    row
  }));
});
const availableTestsForCategory = computed(() => categoryTestsMap[createForm.category] || []);
const canCreateRequest = computed(() => currentRole.value !== 'Doctor');
const canProcessWorkflow = computed(() => ['Admin', 'Lab Manager', 'Lab Technician'].includes(currentRole.value));
const canVerifyAndRelease = computed(() => ['Admin', 'Lab Manager'].includes(currentRole.value));

const priorityItems: Array<'All' | LabPriority> = ['All', 'Normal', 'Urgent', 'STAT'];

const tabCounts = computed(() => {
  const pending = queueRows.value.filter((row) => row.status === 'Pending').length;
  const inProgress = queueRows.value.filter((row) => row.status === 'In Progress' || row.status === 'Result Ready').length;
  const completed = queueRows.value.filter((row) => row.status === 'Completed').length;
  return {
    all: queueRows.value.length,
    pending,
    inProgress,
    completed
  };
});

const metrics = computed(() => {
  const totalRequests = queueRows.value.length;
  const pending = queueRows.value.filter((row) => row.status === 'Pending').length;
  const inProgress = queueRows.value.filter((row) => row.status === 'In Progress' || row.status === 'Result Ready').length;
  const completedToday = queueRows.value.filter((row) => {
    if (row.status !== 'Completed') {
      return false;
    }
    const workflow = workflowCache[row.requestId];
    return isSameDay(workflow?.releasedAt || row.requestedAt, new Date());
  }).length;
  const urgent = queueRows.value.filter((row) => (row.priority === 'Urgent' || row.priority === 'STAT') && row.status !== 'Completed').length;

  return { totalRequests, pending, inProgress, completedToday, urgent };
});

const filteredRows = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();

  return queueRows.value
    .filter((row) => {
      if (statusTab.value === 'pending' && row.status !== 'Pending') return false;
      if (statusTab.value === 'in_progress' && row.status !== 'In Progress' && row.status !== 'Result Ready') return false;
      if (statusTab.value === 'completed' && row.status !== 'Completed') return false;
      if (filterCategory.value !== 'All' && row.category !== filterCategory.value) return false;
      if (filterPriority.value !== 'All' && row.priority !== filterPriority.value) return false;
      if (filterDoctor.value !== 'All' && row.requestedByDoctor !== filterDoctor.value) return false;

      if (filterFromDate.value) {
        const startDate = new Date(`${filterFromDate.value}T00:00:00`);
        const rowDate = toDate(row.requestedAt);
        if (rowDate && rowDate < startDate) return false;
      }

      if (filterToDate.value) {
        const endDate = new Date(`${filterToDate.value}T23:59:59`);
        const rowDate = toDate(row.requestedAt);
        if (rowDate && rowDate > endDate) return false;
      }

      if (!query) return true;
      const target = `${row.requestId} ${row.visitId} ${row.patientId} ${row.patientName} ${row.category} ${row.priority} ${row.status} ${row.requestedByDoctor}`.toLowerCase();
      return target.includes(query);
    })
    .sort((a, b) => (toDate(b.requestedAt)?.getTime() || 0) - (toDate(a.requestedAt)?.getTime() || 0));
});

const pageCount = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / pageSize)));
const pagedRows = computed(() => filteredRows.value.slice((listPage.value - 1) * pageSize, listPage.value * pageSize));

const showingText = computed(() => {
  if (filteredRows.value.length === 0) {
    return 'Showing 0 of 0 requests';
  }
  const start = (listPage.value - 1) * pageSize + 1;
  const end = Math.min(listPage.value * pageSize, filteredRows.value.length);
  return `Showing ${start}-${end} of ${filteredRows.value.length} requests`;
});

const emptyStateTitle = computed(() => {
  if (statusTab.value === 'pending') return 'No pending requests.';
  if (statusTab.value === 'in_progress') return 'No in-progress requests.';
  if (statusTab.value === 'completed') return 'No completed requests.';
  return 'No laboratory requests found.';
});

const emptyStateDescription = computed(() => {
  if (statusTab.value === 'pending') return 'Incoming requests will appear here once doctors submit lab orders.';
  if (statusTab.value === 'in_progress') return 'Start processing a pending request to populate this queue.';
  if (statusTab.value === 'completed') return 'Released reports will appear here for viewing and printing.';
  return 'Try adjusting your search and filter settings.';
});

const currentFieldDefinitions = computed(() => FIELD_TEMPLATES[activeWorkflow.value?.category || ''] || DEFAULT_TEMPLATE);
const canStartProcessing = computed(() => activeWorkflow.value?.status === 'Pending');
const canFinalize = computed(() => activeWorkflow.value?.status === 'In Progress' || activeWorkflow.value?.status === 'Result Ready');
const canRelease = computed(() => activeWorkflow.value?.status === 'Result Ready');
const canExport = computed(() => activeWorkflow.value?.status === 'Result Ready' || activeWorkflow.value?.status === 'Completed');

onMounted(async () => {
  await loadQueue();
  realtime.startPolling(() => {
    void loadQueue({ silent: true });
  }, REALTIME_POLICY.polling.laboratoryMs);
  queueReady.value = true;
});

onBeforeUnmount(() => {
  realtime.stopPolling();
  realtime.invalidatePending();
  if (autosaveTimer) clearTimeout(autosaveTimer);
});

watch(pageCount, (value) => {
  if (listPage.value > value) {
    listPage.value = value;
  }
});

watch(
  () => route.query,
  (query) => {
    syncLock.value = true;
    searchQuery.value = readQueryString(query.lab_q);
    statusTab.value = normalizeStatusTab(readQueryString(query.lab_tab));
    filterCategory.value = readQueryString(query.lab_category) || 'All';
    filterPriority.value = (readQueryString(query.lab_priority) || 'All') as 'All' | LabPriority;
    filterDoctor.value = readQueryString(query.lab_doctor) || 'All';
    filterFromDate.value = readQueryString(query.lab_from);
    filterToDate.value = readQueryString(query.lab_to);
    syncLock.value = false;
  },
  { immediate: true }
);

watch([searchQuery, statusTab, filterCategory, filterPriority, filterDoctor, filterFromDate, filterToDate], () => {
  listPage.value = 1;
  if (!syncLock.value) {
    pushFiltersToQuery();
  }
});

watch(activeWorkflow, (record) => {
  if (record) {
    hydrateFormsFromWorkflow(record);
  }
});
watch(
  [encodeForm, workflowStep, activeWorkflow],
  () => {
    if (!activeWorkflow.value) return;
    if (workflowStep.value !== 'encode') return;
    if (workflowBusy.value) return;
    if (autosaveInFlight.value) return;
    if (activeWorkflow.value.status === 'Pending' || activeWorkflow.value.status === 'Completed' || activeWorkflow.value.status === 'Cancelled') return;
    if (!hasUnsavedWorkflowChanges()) return;
    const signature = buildWorkflowFormSignature(activeWorkflow.value);
    if (signature === lastAutosaveSignature) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      void (async () => {
        if (workflowBusy.value || autosaveInFlight.value) return;
        if (!hasUnsavedWorkflowChanges()) return;
        autosaveInFlight.value = true;
        const autosaveSignature = buildWorkflowFormSignature(activeWorkflow.value);
        const saved = await onSaveDraft(true);
        if (saved) {
          lastAutosaveSignature = autosaveSignature;
        }
        autosaveInFlight.value = false;
      })();
    }, 1400);
  },
  { deep: true }
);
watch(
  () => createForm.requestedByDoctor,
  (doctor) => {
    createForm.doctorDepartment = doctorDepartmentMap[doctor] || createForm.doctorDepartment || 'General Medicine';
  }
);
watch(
  () => createForm.category,
  (category) => {
    const defaults = categoryTestsMap[category] || [];
    if (!defaults.length) return;
    if (createForm.tests.length === 0 || !createForm.tests.every((test) => defaults.includes(test))) {
      createForm.tests = [defaults[0]];
    }
  }
);
watch(
  () => createForm.tests,
  (tests) => {
    if (!tests.length) return;
    const specimen = testSpecimenMap[tests[0]];
    if (!specimen) return;
    createForm.specimenType = specimen.specimenType;
    createForm.sampleSource = specimen.sampleSource;
  },
  { deep: true }
);

function showToast(text: string, color: SnackbarTone = 'success'): void {
  if (color === 'success') {
    emitSuccessModal({ title: 'Success', message: text, tone: 'success' });
    return;
  }
  snackbar.text = text;
  snackbar.color = color;
  snackbar.open = true;
}

function readQueryString(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length ? String(value[0] || '') : '';
  }
  return typeof value === 'string' ? value : '';
}

function normalizeStatusTab(value: string): StatusTab {
  if (value === 'pending' || value === 'in_progress' || value === 'completed') {
    return value;
  }
  return 'all';
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatDateTime(value: string | null | undefined): string {
  const parsed = toDate(value);
  if (!parsed) return value ? String(value) : '--';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(parsed);
}

function isSameDay(value: string | null | undefined, comparison: Date): boolean {
  const date = toDate(value);
  if (!date) return false;
  return date.getFullYear() === comparison.getFullYear() && date.getMonth() === comparison.getMonth() && date.getDate() === comparison.getDate();
}

function parseStatusFromTab(tab: StatusTab): string | undefined {
  if (tab === 'pending') return 'pending';
  if (tab === 'in_progress') return 'in_progress';
  if (tab === 'completed') return 'completed';
  return undefined;
}

function pushFiltersToQuery(): void {
  const nextQuery: Record<string, string> = {};
  Object.entries(route.query).forEach(([key, value]) => {
    if (LAB_QUERY_KEYS.includes(key)) {
      return;
    }
    const normalized = Array.isArray(value) ? value[0] : value;
    if (normalized != null && normalized !== '') {
      nextQuery[key] = String(normalized);
    }
  });

  if (searchQuery.value.trim()) nextQuery.lab_q = searchQuery.value.trim();
  if (statusTab.value !== 'all') nextQuery.lab_tab = statusTab.value;
  if (filterCategory.value !== 'All') nextQuery.lab_category = filterCategory.value;
  if (filterPriority.value !== 'All') nextQuery.lab_priority = filterPriority.value;
  if (filterDoctor.value !== 'All') nextQuery.lab_doctor = filterDoctor.value;
  if (filterFromDate.value) nextQuery.lab_from = filterFromDate.value;
  if (filterToDate.value) nextQuery.lab_to = filterToDate.value;

  void router.replace({ query: nextQuery });
}

function activateLocalMode(reason: unknown): void {
  backendMode.value = 'local';
  if (!localModeToastShown.value) {
    const message = typeof reason === 'string' ? reason : 'Laboratory API unavailable.';
    showToast(`${message} Using local workflow mode.`, 'warning');
    localModeToastShown.value = true;
  }
}

function resetWorkflowCache(): void {
  Object.keys(workflowCache).forEach((key) => {
    delete workflowCache[Number(key)];
  });
}

function isoAgo(daysAgo: number, hour: number, minute: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function fallbackLogs(requestId: number, entries: Array<{ action: string; details: string; actor: string; at: string }>): LabActivityLog[] {
  return entries.map((entry, index) => ({
    id: requestId * 100 + index,
    requestId,
    action: entry.action,
    details: entry.details,
    actor: entry.actor,
    createdAt: entry.at
  }));
}
function createFallbackWorkflows(): WorkflowRecord[] {
  return [
    {
      requestId: 1208,
      visitId: 'VISIT-2026-2001',
      patientId: 'PAT-3401',
      patientName: 'Maria Santos',
      age: 34,
      sex: 'Female',
      category: 'Blood Test',
      priority: 'Normal',
      status: 'Pending',
      requestedAt: isoAgo(0, 10, 45),
      requestedByDoctor: 'Dr. Humour',
      doctorDepartment: 'General Medicine',
      notes: 'Fatigue and dizziness for 3 days.',
      tests: ['Complete Blood Count (CBC)', 'Comprehensive Metabolic Panel (CMP)', 'Lipid Panel'],
      specimenType: 'Whole Blood',
      sampleSource: 'Blood',
      collectionDateTime: null,
      clinicalDiagnosis: 'Rule out anemia and metabolic imbalance',
      labInstructions: 'Fasting sample preferred',
      insuranceReference: 'HMO-MAXI-2026-1001',
      billingReference: 'BILL-LAB-1208',
      assignedLabStaff: 'Tech Anne',
      sampleCollected: false,
      sampleCollectedAt: null,
      processingStartedAt: null,
      resultEncodedAt: null,
      resultReferenceRange: '',
      verifiedBy: '',
      verifiedAt: null,
      rejectionReason: '',
      resampleFlag: false,
      releasedAt: null,
      rawAttachmentName: '',
      encodedValues: {},
      activityLogs: fallbackLogs(1208, [
        { action: 'Request Created', details: 'Doctor submitted a new laboratory request.', actor: 'Dr. Humour', at: isoAgo(0, 10, 45) }
      ])
    },
    {
      requestId: 1207,
      visitId: 'VISIT-2026-1998',
      patientId: 'PAT-3188',
      patientName: 'John Doe',
      age: 39,
      sex: 'Male',
      category: 'X-Ray',
      priority: 'Urgent',
      status: 'Pending',
      requestedAt: isoAgo(1, 8, 15),
      requestedByDoctor: 'Dr. Jenni',
      doctorDepartment: 'General Medicine',
      notes: 'Persistent chest pain, evaluate for pulmonary findings.',
      tests: ['Chest X-Ray (PA View)'],
      specimenType: 'Imaging',
      sampleSource: 'Radiology',
      collectionDateTime: null,
      clinicalDiagnosis: 'Chest pain, evaluate pulmonary condition',
      labInstructions: '',
      insuranceReference: '',
      billingReference: 'BILL-LAB-1207',
      assignedLabStaff: 'Tech Mark',
      sampleCollected: false,
      sampleCollectedAt: null,
      processingStartedAt: null,
      resultEncodedAt: null,
      resultReferenceRange: '',
      verifiedBy: '',
      verifiedAt: null,
      rejectionReason: '',
      resampleFlag: false,
      releasedAt: null,
      rawAttachmentName: '',
      encodedValues: {},
      activityLogs: fallbackLogs(1207, [{ action: 'Request Created', details: 'Urgent radiology request entered.', actor: 'Dr. Jenni', at: isoAgo(1, 8, 15) }])
    },
    {
      requestId: 1196,
      visitId: 'VISIT-2026-1983',
      patientId: 'PAT-2977',
      patientName: 'Emma Tan',
      age: 29,
      sex: 'Female',
      category: 'Urinalysis',
      priority: 'Normal',
      status: 'In Progress',
      requestedAt: isoAgo(2, 9, 20),
      requestedByDoctor: 'Dr. Morco',
      doctorDepartment: 'Internal Medicine',
      notes: 'Dysuria and mild lower abdominal discomfort.',
      tests: ['Urinalysis Routine', 'Microscopy'],
      specimenType: 'Urine',
      sampleSource: 'Urine',
      collectionDateTime: isoAgo(2, 9, 45),
      clinicalDiagnosis: 'UTI, rule out hematuria',
      labInstructions: 'Midstream clean catch',
      insuranceReference: '',
      billingReference: 'BILL-LAB-1196',
      assignedLabStaff: 'Tech Liza',
      sampleCollected: true,
      sampleCollectedAt: isoAgo(2, 9, 45),
      processingStartedAt: isoAgo(2, 10, 0),
      resultEncodedAt: null,
      resultReferenceRange: '',
      verifiedBy: '',
      verifiedAt: null,
      rejectionReason: '',
      resampleFlag: false,
      releasedAt: null,
      rawAttachmentName: 'emma-tan-urinalysis-raw.pdf',
      encodedValues: {},
      activityLogs: fallbackLogs(1196, [
        { action: 'Request Created', details: 'Laboratory request entered by check-up.', actor: 'Dr. Morco', at: isoAgo(2, 9, 20) },
        { action: 'Processing Started', details: 'Sample collected and moved to processing queue.', actor: 'Tech Liza', at: isoAgo(2, 10, 0) }
      ])
    },
    {
      requestId: 1183,
      visitId: 'VISIT-2026-1967',
      patientId: 'PAT-2844',
      patientName: 'Mark Reyes',
      age: 45,
      sex: 'Male',
      category: 'COVID Test',
      priority: 'Urgent',
      status: 'In Progress',
      requestedAt: isoAgo(3, 13, 40),
      requestedByDoctor: 'Dr. Humour',
      doctorDepartment: 'General Medicine',
      notes: 'Fever and sore throat. Rapid screening requested.',
      tests: ['SARS-CoV-2 Antigen'],
      specimenType: 'Swab',
      sampleSource: 'Nasopharyngeal',
      collectionDateTime: isoAgo(3, 14, 0),
      clinicalDiagnosis: 'Acute upper respiratory infection',
      labInstructions: '',
      insuranceReference: '',
      billingReference: 'BILL-LAB-1183',
      assignedLabStaff: 'Tech Paolo',
      sampleCollected: true,
      sampleCollectedAt: isoAgo(3, 14, 0),
      processingStartedAt: isoAgo(3, 14, 5),
      resultEncodedAt: null,
      resultReferenceRange: '',
      verifiedBy: '',
      verifiedAt: null,
      rejectionReason: '',
      resampleFlag: false,
      releasedAt: null,
      rawAttachmentName: '',
      encodedValues: { test_method: 'Antigen', result: 'Negative', ct_value: null },
      activityLogs: fallbackLogs(1183, [
        { action: 'Request Created', details: 'Urgent COVID screening requested.', actor: 'Dr. Humour', at: isoAgo(3, 13, 40) },
        { action: 'Processing Started', details: 'Specimen processing initiated.', actor: 'Tech Paolo', at: isoAgo(3, 14, 5) }
      ])
    },
    {
      requestId: 1172,
      visitId: 'VISIT-2026-1948',
      patientId: 'PAT-2674',
      patientName: 'Alex Chua',
      age: 31,
      sex: 'Male',
      category: 'Blood Test',
      priority: 'Normal',
      status: 'Result Ready',
      requestedAt: isoAgo(4, 11, 30),
      requestedByDoctor: 'Dr. Jenni',
      doctorDepartment: 'General Medicine',
      notes: 'Routine follow-up panel before physician review.',
      tests: ['CBC', 'Fasting Blood Sugar'],
      specimenType: 'Whole Blood',
      sampleSource: 'Blood',
      collectionDateTime: isoAgo(4, 11, 40),
      clinicalDiagnosis: 'Follow-up diabetes monitoring',
      labInstructions: '',
      insuranceReference: 'HMO-INTEL-5522',
      billingReference: 'BILL-LAB-1172',
      assignedLabStaff: 'Tech Mark',
      sampleCollected: true,
      sampleCollectedAt: isoAgo(4, 11, 40),
      processingStartedAt: isoAgo(4, 11, 45),
      resultEncodedAt: isoAgo(4, 12, 10),
      resultReferenceRange: 'WBC 3.5-11, Hemoglobin 11.5-17.5',
      verifiedBy: 'Tech Mark',
      verifiedAt: isoAgo(4, 12, 15),
      rejectionReason: '',
      resampleFlag: false,
      releasedAt: null,
      rawAttachmentName: 'alex-chua-blood-raw.pdf',
      encodedValues: { wbc: 6.4, rbc: 4.8, hemoglobin: 14.2, platelets: 288 },
      activityLogs: fallbackLogs(1172, [
        { action: 'Request Created', details: 'Routine blood panel requested.', actor: 'Dr. Jenni', at: isoAgo(4, 11, 30) },
        { action: 'Processing Started', details: 'Sample entered processing pipeline.', actor: 'Tech Mark', at: isoAgo(4, 11, 45) },
        { action: 'Result Finalized', details: 'Result encoded and marked as Result Ready.', actor: 'Tech Mark', at: isoAgo(4, 12, 10) }
      ])
    },
    {
      requestId: 1168,
      visitId: 'VISIT-2026-1932',
      patientId: 'PAT-2509',
      patientName: 'Lara Gomez',
      age: 53,
      sex: 'Female',
      category: 'ECG',
      priority: 'Normal',
      status: 'Completed',
      requestedAt: isoAgo(5, 9, 50),
      requestedByDoctor: 'Dr. Morco',
      doctorDepartment: 'Internal Medicine',
      notes: 'Baseline ECG prior to medication adjustment.',
      tests: ['12-lead ECG'],
      specimenType: 'ECG Trace',
      sampleSource: 'Cardiac',
      collectionDateTime: isoAgo(5, 10, 0),
      clinicalDiagnosis: 'Baseline cardiac monitoring',
      labInstructions: '',
      insuranceReference: '',
      billingReference: 'BILL-LAB-1168',
      assignedLabStaff: 'Tech Anne',
      sampleCollected: true,
      sampleCollectedAt: isoAgo(5, 10, 0),
      processingStartedAt: isoAgo(5, 10, 5),
      resultEncodedAt: isoAgo(5, 10, 30),
      resultReferenceRange: 'Heart rate 60-100 bpm',
      verifiedBy: 'Tech Anne',
      verifiedAt: isoAgo(5, 10, 35),
      rejectionReason: '',
      resampleFlag: false,
      releasedAt: isoAgo(5, 10, 40),
      rawAttachmentName: 'lara-gomez-ecg.pdf',
      encodedValues: { heart_rate: 76, rhythm: 'Sinus Rhythm', ecg_interpretation: 'No acute ischemic changes.' },
      activityLogs: fallbackLogs(1168, [
        { action: 'Request Created', details: 'ECG requested during follow-up consult.', actor: 'Dr. Morco', at: isoAgo(5, 9, 50) },
        { action: 'Processing Started', details: 'ECG tracing started.', actor: 'Tech Anne', at: isoAgo(5, 10, 5) },
        { action: 'Result Finalized', details: 'ECG interpretation encoded.', actor: 'Tech Anne', at: isoAgo(5, 10, 30) },
        { action: 'Report Released', details: 'Report released to doctor / check-up module.', actor: 'Tech Anne', at: isoAgo(5, 10, 40) }
      ])
    }
  ];
}

function toQueueRow(record: WorkflowRecord): LabQueueRequest {
  return {
    requestId: record.requestId,
    visitId: record.visitId,
    patientId: record.patientId,
    patientName: record.patientName,
    category: record.category,
    priority: record.priority,
    status: record.status,
    requestedAt: record.requestedAt,
    requestedByDoctor: record.requestedByDoctor
  };
}

function createWorkflowFromQueue(row: LabQueueRequest): WorkflowRecord {
  return {
    requestId: row.requestId,
    visitId: row.visitId,
    patientId: row.patientId,
    patientName: row.patientName,
    age: null,
    sex: '',
    category: row.category,
    priority: row.priority,
    status: row.status,
    requestedAt: row.requestedAt,
    requestedByDoctor: row.requestedByDoctor,
    doctorDepartment: doctorDepartmentMap[row.requestedByDoctor] || 'General Medicine',
    notes: '',
    tests: [row.category],
    specimenType: testSpecimenMap[row.category]?.specimenType || 'Whole Blood',
    sampleSource: testSpecimenMap[row.category]?.sampleSource || 'Blood',
    collectionDateTime: null,
    clinicalDiagnosis: '',
    labInstructions: '',
    insuranceReference: '',
    billingReference: '',
    assignedLabStaff: 'Tech Anne',
    sampleCollected: false,
    sampleCollectedAt: null,
    processingStartedAt: null,
    resultEncodedAt: null,
    resultReferenceRange: '',
    verifiedBy: '',
    verifiedAt: null,
    rejectionReason: '',
    resampleFlag: false,
    releasedAt: null,
    rawAttachmentName: '',
    encodedValues: {},
    activityLogs: []
  };
}

function seedFallbackData(): void {
  const records = createFallbackWorkflows();
  resetWorkflowCache();

  records.forEach((record) => {
    workflowCache[record.requestId] = {
      ...record,
      tests: [...record.tests],
      encodedValues: { ...record.encodedValues },
      activityLogs: [...record.activityLogs]
    };
  });

  queueRows.value = records.map((record) => toQueueRow(record));
}

function ensureWorkflowForQueueRow(row: LabQueueRequest): void {
  if (!workflowCache[row.requestId]) {
    workflowCache[row.requestId] = createWorkflowFromQueue(row);
  }
}

function upsertQueueFromWorkflow(record: WorkflowRecord): void {
  const existing = queueRows.value.find((row) => row.requestId === record.requestId);
  if (existing) {
    existing.patientName = record.patientName;
    existing.category = record.category;
    existing.priority = record.priority;
    existing.status = record.status;
    existing.requestedAt = record.requestedAt;
    existing.requestedByDoctor = record.requestedByDoctor;
    existing.visitId = record.visitId;
    existing.patientId = record.patientId;
    return;
  }

  queueRows.value.unshift(toQueueRow(record));
}

function upsertWorkflowFromBackend(detail: LabRequestDetail, logs: LabActivityLog[] = []): WorkflowRecord {
  const previous = workflowCache[detail.requestId] || createWorkflowFromQueue({
    requestId: detail.requestId,
    visitId: detail.visitId,
    patientId: detail.patientId,
    patientName: detail.patientName,
    category: detail.category,
    priority: detail.priority,
    status: detail.status,
    requestedAt: detail.requestedAt,
    requestedByDoctor: detail.requestedByDoctor
  });

  const merged: WorkflowRecord = {
    ...previous,
    ...detail,
    tests: detail.tests.length ? [...detail.tests] : [...previous.tests],
    encodedValues: { ...previous.encodedValues, ...detail.encodedValues },
    activityLogs: logs.length ? [...logs] : [...previous.activityLogs]
  };

  workflowCache[merged.requestId] = merged;
  upsertQueueFromWorkflow(merged);
  return merged;
}

async function loadQueue(options: { silent?: boolean } = {}): Promise<void> {
  const previousSelectedRequestId = selectedRequestId.value;
  const remoteQueue = await realtime.runLatest(
    async () =>
      fetchLabQueue({
        search: searchQuery.value || undefined,
        status: parseStatusFromTab(statusTab.value),
        category: filterCategory.value !== 'All' ? filterCategory.value : undefined,
        priority: filterPriority.value !== 'All' ? filterPriority.value : undefined,
        doctor: filterDoctor.value !== 'All' ? filterDoctor.value : undefined,
        fromDate: filterFromDate.value || undefined,
        toDate: filterToDate.value || undefined
      }),
    {
      silent: options.silent,
      onStart: () => {
        queueLoading.value = true;
      },
      onFinish: () => {
        queueLoading.value = false;
      },
      onError: (error) => {
        activateLocalMode(error);
        seedFallbackData();
        if (queueRows.value.length > 0) {
          selectedRequestId.value = queueRows.value[0].requestId;
        }
      }
    }
  );

  if (!remoteQueue) return;
  queueRows.value = remoteQueue;
  remoteQueue.forEach((row) => ensureWorkflowForQueueRow(row));
  backendMode.value = 'connected';

  if (remoteQueue.length === 0) {
    selectedRequestId.value = null;
    return;
  }

  const selectedStillExists =
    previousSelectedRequestId != null &&
    remoteQueue.some((row) => row.requestId === previousSelectedRequestId);

  // Keep currently selected workflow during background refresh to avoid modal/form resets.
  if (selectedStillExists) {
    selectedRequestId.value = previousSelectedRequestId;
    return;
  }

  selectedRequestId.value = remoteQueue[0].requestId;
}

function resetEncodeErrors(): void {
  Object.keys(encodeErrors).forEach((key) => {
    delete encodeErrors[key];
  });
}

function hydrateFormsFromWorkflow(record: WorkflowRecord): void {
  lastAutosavedAt.value = null;
  processingForm.sampleCollected = record.sampleCollected;
  processingForm.assignedLabStaff = record.assignedLabStaff || 'Tech Anne';
  processingForm.rawAttachmentName = record.rawAttachmentName || '';
  processingForm.specimenType = record.specimenType || 'Whole Blood';
  processingForm.sampleSource = record.sampleSource || 'Blood';
  processingForm.collectionDateTime = (record.collectionDateTime || new Date().toISOString()).slice(0, 16);

  resetEncodeErrors();
  Object.keys(encodeForm).forEach((key) => {
    delete encodeForm[key];
  });

  getFieldTemplate(record.category).forEach((field) => {
    const savedValue = record.encodedValues[field.key];
    encodeForm[field.key] = savedValue == null ? '' : savedValue;
  });

  workflowBaselineSignature.value = buildWorkflowFormSignature(record);
}

function buildWorkflowFormSignature(record = activeWorkflow.value): string {
  if (!record) {
    return '';
  }

  const encoded = Object.entries(encodeForm)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, value == null ? '' : String(value)]);

  return JSON.stringify({
    requestId: record.requestId,
    step: workflowStep.value,
    processing: {
      sampleCollected: processingForm.sampleCollected,
      assignedLabStaff: processingForm.assignedLabStaff.trim(),
      rawAttachmentName: processingForm.rawAttachmentName.trim(),
      specimenType: processingForm.specimenType.trim(),
      sampleSource: processingForm.sampleSource.trim(),
      collectionDateTime: processingForm.collectionDateTime
    },
    encoded,
    resultReferenceRange: record.resultReferenceRange.trim(),
    verifiedBy: record.verifiedBy.trim(),
    verifiedAt: record.verifiedAt || ''
  });
}

function markWorkflowAsSynced(record = activeWorkflow.value): void {
  workflowBaselineSignature.value = buildWorkflowFormSignature(record);
}

function hasUnsavedWorkflowChanges(): boolean {
  if (!workflowDialog.value || !activeWorkflow.value) {
    return false;
  }
  if (!workflowBaselineSignature.value) {
    return false;
  }
  return buildWorkflowFormSignature(activeWorkflow.value) !== workflowBaselineSignature.value;
}

async function confirmWorkflowDiscard(message: string): Promise<boolean> {
  if (!hasUnsavedWorkflowChanges()) {
    return true;
  }
  return requestConfirmModal({
    title: 'Unsaved Changes',
    message,
    confirmText: 'Discard',
    cancelText: 'Keep Editing',
    tone: 'warning'
  });
}

async function closeWorkflowDialog(): Promise<void> {
  if (workflowBusy.value) {
    return;
  }
  const canClose = await confirmWorkflowDiscard('You have unsaved laboratory changes. Discard changes and close this workflow?');
  if (!canClose) {
    return;
  }
  workflowDialog.value = false;
}

async function onWorkflowDialogModelUpdate(nextValue: boolean): Promise<void> {
  if (nextValue) {
    workflowDialog.value = true;
    return;
  }
  await closeWorkflowDialog();
}

function getFieldTemplate(category: string): TestFieldDefinition[] {
  return FIELD_TEMPLATES[category] || DEFAULT_TEMPLATE;
}

function resolveStepFromStatus(status: LabStatus): WorkflowStep {
  if (status === 'Pending') return 'order';
  if (status === 'In Progress') return 'processing';
  if (status === 'Result Ready') return 'release';
  return 'history';
}

function resolveStepFromAction(record: WorkflowRecord, action: RowAction): WorkflowStep {
  if (action === 'process') return 'order';
  if (action === 'encode') return 'encode';
  if (action === 'release') return 'release';
  if (record.status === 'Completed') return 'history';
  return resolveStepFromStatus(record.status);
}

function rowPrimaryAction(row: LabQueueRequest): RowAction {
  if (row.status === 'Pending') return 'process';
  if (row.status === 'In Progress') return 'encode';
  if (row.status === 'Result Ready') return 'release';
  return 'view';
}

function rowPrimaryActionLabel(row: LabQueueRequest): string {
  const action = rowPrimaryAction(row);
  if (action === 'process') return 'Process';
  if (action === 'encode') return 'Encode';
  if (action === 'release') return 'Release';
  return 'View';
}

function rowPrimaryActionColor(row: LabQueueRequest): string {
  const action = rowPrimaryAction(row);
  if (action === 'process') return 'primary';
  if (action === 'encode') return 'info';
  if (action === 'release') return 'warning';
  return 'secondary';
}

function rowPrimaryActionIcon(row: LabQueueRequest): string {
  const action = rowPrimaryAction(row);
  if (action === 'process') return 'mdi-flask-outline';
  if (action === 'encode') return 'mdi-clipboard-text-outline';
  if (action === 'release') return 'mdi-send-check-outline';
  return 'mdi-folder-open-outline';
}

async function refreshQueueNow(): Promise<void> {
  await loadQueue();
  showToast('Laboratory queue refreshed.', 'info');
}

function statusChipColor(status: LabStatus): string {
  if (status === 'Pending') return 'warning';
  if (status === 'In Progress') return 'info';
  if (status === 'Result Ready') return 'secondary';
  if (status === 'Completed') return 'success';
  return 'error';
}

function priorityChipColor(priority: LabPriority): string {
  if (priority === 'STAT') return 'error';
  if (priority === 'Urgent') return 'warning';
  return 'primary';
}
function applyPatientLookup(requestId: string | number | null): void {
  if (requestId == null || requestId === '') return;
  const parsedId = typeof requestId === 'number' ? requestId : Number(requestId);
  if (!Number.isFinite(parsedId)) return;
  const match = queueRows.value.find((row) => row.requestId === parsedId);
  if (!match) return;
  createForm.patientName = match.patientName;
  createForm.patientId = match.patientId;
  createForm.visitId = match.visitId;
}
function openCreateRequestDialog(): void {
  createForm.patientName = '';
  createForm.patientId = '';
  createForm.visitId = '';
  createForm.category = 'Blood Test';
  createForm.priority = 'Normal';
  createForm.requestedByDoctor = doctorItems.value[1] || 'Dr. Humour';
  createForm.patientLookup = '';
  createForm.doctorDepartment = doctorDepartmentMap[createForm.requestedByDoctor] || 'General Medicine';
  createForm.specimenType = 'Whole Blood';
  createForm.sampleSource = 'Blood';
  createForm.collectionDateTime = new Date().toISOString().slice(0, 16);
  createForm.tests = ['Complete Blood Count (CBC)'];
  createForm.clinicalDiagnosis = '';
  createForm.labInstructions = '';
  createForm.insuranceReference = '';
  createForm.billingReference = '';
  createForm.notes = '';
  Object.keys(createErrors).forEach((key) => {
    createErrors[key] = '';
  });
  createDialog.value = true;
}

async function createRequest(): Promise<void> {
  Object.keys(createErrors).forEach((key) => {
    createErrors[key] = '';
  });
  if (!canCreateRequest.value) {
    showToast('Your role cannot create laboratory requests.', 'warning');
    return;
  }
  if (!createForm.patientName.trim()) createErrors.patientName = 'Patient name is required.';
  if (!createForm.requestedByDoctor.trim()) createErrors.requestedByDoctor = 'Requested doctor is required.';
  if (!createForm.doctorDepartment.trim()) createErrors.doctorDepartment = 'Doctor department is required.';
  if (!createForm.category.trim()) createErrors.category = 'Category is required.';
  if (!createForm.tests.length) createErrors.tests = 'At least one test panel is required.';
  if (!createForm.specimenType.trim()) createErrors.specimenType = 'Specimen type is required.';
  if (!createForm.sampleSource.trim()) createErrors.sampleSource = 'Sample source is required.';
  if (!createForm.collectionDateTime) createErrors.collectionDateTime = 'Collection date/time is required.';
  if (!createForm.clinicalDiagnosis.trim()) createErrors.clinicalDiagnosis = 'Clinical diagnosis is required.';
  if (Object.values(createErrors).some(Boolean)) {
    showToast('Please complete required fields for new request.', 'error');
    return;
  }

  createBusy.value = true;
  try {
    const created = await createLabRequest({
      patientName: createForm.patientName.trim(),
      patientId: createForm.patientId.trim() || undefined,
      visitId: createForm.visitId.trim() || undefined,
      category: createForm.category,
      priority: createForm.priority,
      requestedByDoctor: createForm.requestedByDoctor.trim() || 'Doctor',
      doctorDepartment: createForm.doctorDepartment.trim() || 'General Medicine',
      notes: createForm.notes.trim(),
      tests: createForm.tests.map((item) => item.trim()).filter(Boolean),
      specimenType: createForm.specimenType,
      sampleSource: createForm.sampleSource,
      collectionDateTime: createForm.collectionDateTime ? new Date(createForm.collectionDateTime).toISOString() : null,
      clinicalDiagnosis: createForm.clinicalDiagnosis.trim(),
      labInstructions: createForm.labInstructions.trim(),
      insuranceReference: createForm.insuranceReference.trim(),
      billingReference: createForm.billingReference.trim(),
      assignedLabStaff: 'Tech Anne'
    });

    const workflow: WorkflowRecord = {
      ...created,
      activityLogs: [
        {
          id: created.requestId * 1000,
          requestId: created.requestId,
          action: 'Request Created',
          details: 'New lab request created from laboratory queue dashboard.',
          actor: 'Lab Staff',
          createdAt: created.requestedAt
        }
      ]
    };
    workflowCache[workflow.requestId] = workflow;
    upsertQueueFromWorkflow(workflow);
    selectedRequestId.value = workflow.requestId;
    createDialog.value = false;
    showToast(`New request #${workflow.requestId} created.`, 'success');
    await loadQueue({ silent: true });
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    createBusy.value = false;
  }
}

async function openWorkflow(requestId: number, action: RowAction): Promise<void> {
  const row = queueRows.value.find((item) => item.requestId === requestId);
  if (!row && !workflowCache[requestId]) {
    showToast('Request not found.', 'warning');
    return;
  }

  if (row) {
    ensureWorkflowForQueueRow(row);
  }

  if (workflowDialog.value && selectedRequestId.value !== requestId) {
    const canSwitch = await confirmWorkflowDiscard('You have unsaved laboratory changes. Discard changes and open another request?');
    if (!canSwitch) {
      return;
    }
  }

  selectedRequestId.value = requestId;
  workflowDialog.value = true;
  workflowLoading.value = true;

  if (backendMode.value !== 'local') {
    try {
      const [detail, activity] = await Promise.all([fetchLabRequest(requestId), fetchLabActivity(requestId)]);
      upsertWorkflowFromBackend(detail, activity);
      backendMode.value = 'connected';
    } catch (error) {
      activateLocalMode(error);
    }
  }

  const record = workflowCache[requestId];
  if (record) {
    hydrateFormsFromWorkflow(record);
    lastAutosaveSignature = '';
    workflowStep.value = resolveStepFromAction(record, action);
    markWorkflowAsSynced(record);
  }

  workflowLoading.value = false;
}

function appendActivity(record: WorkflowRecord, action: string, details: string, actor = 'Lab Staff'): void {
  const nowIso = new Date().toISOString();
  record.activityLogs.unshift({
    id: Date.now() + Math.floor(Math.random() * 500),
    requestId: record.requestId,
    action,
    details,
    actor,
    createdAt: nowIso
  });
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function collectEncodeValues(): Record<string, string | number | null> {
  const values: Record<string, string | number | null> = {};

  currentFieldDefinitions.value.forEach((field) => {
    const current = encodeForm[field.key];

    if (!hasValue(current)) {
      values[field.key] = null;
      return;
    }

    if (field.type === 'number') {
      const parsed = Number(current);
      values[field.key] = Number.isNaN(parsed) ? null : parsed;
      return;
    }

    values[field.key] = String(current);
  });

  return values;
}

function buildResultSummary(values: Record<string, string | number | null>): string {
  return currentFieldDefinitions.value
    .map((field) => `${field.label}: ${values[field.key] == null || values[field.key] === '' ? '--' : values[field.key]}`)
    .join('; ');
}

function validateEncodeForm(): boolean {
  resetEncodeErrors();
  const record = activeWorkflow.value;
  if (record) {
    if (!record.resultReferenceRange.trim()) {
      encodeErrors.resultReferenceRange = 'Result reference range is required.';
    }
    if (!record.verifiedBy.trim()) {
      encodeErrors.verifiedBy = 'Verified by is required before finalization.';
    }
  }

  currentFieldDefinitions.value.forEach((field) => {
    const value = encodeForm[field.key];

    if (field.required && !hasValue(value)) {
      encodeErrors[field.key] = `${field.label} is required.`;
      return;
    }

    if (field.type === 'number' && hasValue(value)) {
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        encodeErrors[field.key] = `${field.label} must be numeric.`;
        return;
      }

      if (field.min != null && parsed < field.min) {
        encodeErrors[field.key] = `${field.label} must be at least ${field.min}.`;
        return;
      }

      if (field.max != null && parsed > field.max) {
        encodeErrors[field.key] = `${field.label} must not exceed ${field.max}.`;
      }
    }
  });

  return Object.keys(encodeErrors).length === 0;
}

function isStepDisabled(step: WorkflowStep): boolean {
  const status = activeWorkflow.value?.status;
  if (!status) return true;
  if (step === 'order') return false;
  if (step === 'processing') return status === 'Pending' || status === 'Cancelled';
  if (step === 'encode') return status === 'Pending' || status === 'Cancelled';
  if (step === 'release') return status === 'Pending' || status === 'In Progress' || status === 'Cancelled';
  return false;
}

function updateWorkflowAndQueue(record: WorkflowRecord): void {
  workflowCache[record.requestId] = {
    ...record,
    tests: [...record.tests],
    encodedValues: { ...record.encodedValues },
    activityLogs: [...record.activityLogs]
  };
  upsertQueueFromWorkflow(workflowCache[record.requestId]);
}

async function onStartProcessing(): Promise<void> {
  const record = activeWorkflow.value;
  if (!record) return;
  if (!canProcessWorkflow.value) {
    showToast('Your role is not allowed to process samples.', 'warning');
    return;
  }
  if (record.status !== 'Pending') {
    showToast('Only pending requests can be started.', 'warning');
    return;
  }

  workflowBusy.value = true;
  pendingAction.value = 'start';

  const nowIso = new Date().toISOString();
  const sampleCollectedAt = processingForm.sampleCollected ? record.sampleCollectedAt || nowIso : null;

  if (backendMode.value !== 'local') {
    try {
      const response = await startLabProcessing({
        requestId: record.requestId,
        labStaff: processingForm.assignedLabStaff,
        sampleCollected: processingForm.sampleCollected,
        sampleCollectedAt,
        processingStartedAt: nowIso,
        specimenType: processingForm.specimenType,
        sampleSource: processingForm.sampleSource,
        collectionDateTime: processingForm.collectionDateTime ? new Date(processingForm.collectionDateTime).toISOString() : null
      });
      if (response) upsertWorkflowFromBackend(response, record.activityLogs);
      backendMode.value = 'connected';
    } catch (error) {
      activateLocalMode(error);
    }
  }

  const current = workflowCache[record.requestId] || record;
  current.status = 'In Progress';
  current.processingStartedAt = current.processingStartedAt || nowIso;
  current.assignedLabStaff = processingForm.assignedLabStaff;
  current.sampleCollected = processingForm.sampleCollected;
  current.sampleCollectedAt = sampleCollectedAt;
  current.specimenType = processingForm.specimenType;
  current.sampleSource = processingForm.sampleSource;
  current.collectionDateTime = processingForm.collectionDateTime ? new Date(processingForm.collectionDateTime).toISOString() : null;
  current.rawAttachmentName = processingForm.rawAttachmentName.trim();

  appendActivity(current, 'Processing Started', 'Status changed to In Progress and request is now in laboratory queue.');
  updateWorkflowAndQueue(current);

  workflowStep.value = 'processing';
  pendingAction.value = 'none';
  workflowBusy.value = false;
  markWorkflowAsSynced(current);
  showToast('Request moved to In Progress.', 'success');
}

function setEncodeFieldValue(key: string, value: unknown): void {
  encodeForm[key] = value == null ? '' : String(value);
  if (encodeErrors[key]) {
    delete encodeErrors[key];
  }
}

function onReferenceRangeChange(value: string | null): void {
  if (!activeWorkflow.value) return;
  activeWorkflow.value.resultReferenceRange = String(value ?? '');
  if (activeWorkflow.value.resultReferenceRange.trim() && encodeErrors.resultReferenceRange) {
    delete encodeErrors.resultReferenceRange;
  }
}

function onVerifiedByChange(value: string | null): void {
  if (!activeWorkflow.value) return;
  activeWorkflow.value.verifiedBy = String(value ?? '');
  if (activeWorkflow.value.verifiedBy.trim() && encodeErrors.verifiedBy) {
    delete encodeErrors.verifiedBy;
  }
}

async function onSaveProcessingProgress(): Promise<void> {
  const record = activeWorkflow.value;
  if (!record) return;
  if (!canProcessWorkflow.value) {
    showToast('Your role is not allowed to update processing progress.', 'warning');
    return;
  }
  if (record.status === 'Pending') {
    showToast('Start processing first before saving progress.', 'warning');
    return;
  }

  workflowBusy.value = true;
  pendingAction.value = 'save_processing';
  await new Promise((resolve) => setTimeout(resolve, 200));

  const nowIso = new Date().toISOString();
  const current = workflowCache[record.requestId] || record;

  current.sampleCollected = processingForm.sampleCollected;
  current.sampleCollectedAt = processingForm.sampleCollected ? current.sampleCollectedAt || nowIso : null;
  current.assignedLabStaff = processingForm.assignedLabStaff;
  current.specimenType = processingForm.specimenType;
  current.sampleSource = processingForm.sampleSource;
  current.collectionDateTime = processingForm.collectionDateTime ? new Date(processingForm.collectionDateTime).toISOString() : null;
  current.rawAttachmentName = processingForm.rawAttachmentName.trim();

  appendActivity(current, 'Processing Progress Saved', 'Sample checklist and assignment details were updated.');
  updateWorkflowAndQueue(current);

  pendingAction.value = 'none';
  workflowBusy.value = false;
  markWorkflowAsSynced(current);
  showToast('Processing progress saved.', 'success');
}

function onProceedToEncode(): void {
  const record = activeWorkflow.value;
  if (!record) return;
  if (record.status === 'Pending') {
    showToast('Start processing before encoding results.', 'warning');
    return;
  }
  if (!processingForm.sampleCollected) {
    showToast('Sample must be marked collected before encoding.', 'warning');
    return;
  }
  if (!processingForm.assignedLabStaff.trim()) {
    showToast('Assigned lab staff is required.', 'warning');
    return;
  }
  if (!processingForm.specimenType.trim()) {
    showToast('Specimen type is required before encoding.', 'warning');
    return;
  }
  if (!processingForm.sampleSource.trim()) {
    showToast('Sample source is required before encoding.', 'warning');
    return;
  }
  if (!processingForm.collectionDateTime) {
    showToast('Collection date/time is required before encoding.', 'warning');
    return;
  }

  const current = workflowCache[record.requestId] || record;
  current.sampleCollected = true;
  current.sampleCollectedAt = current.sampleCollectedAt || new Date().toISOString();
  current.assignedLabStaff = processingForm.assignedLabStaff;
  current.rawAttachmentName = processingForm.rawAttachmentName.trim();
  updateWorkflowAndQueue(current);
  workflowStep.value = 'encode';
}
async function onSaveDraft(silent = false): Promise<boolean> {
  const record = activeWorkflow.value;
  if (!record) return false;
  if (!canProcessWorkflow.value) {
    showToast('Your role is not allowed to encode results.', 'warning');
    return false;
  }
  if (record.status === 'Pending') {
    showToast('Request must be In Progress before saving draft results.', 'warning');
    return false;
  }
  if (silent && workflowBusy.value) {
    return false;
  }
  if (!silent && autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  const saveToken = ++draftSaveToken;

  if (!silent) {
    workflowBusy.value = true;
    pendingAction.value = 'save_draft';
  }
  let saved = false;
  try {
    const values = collectEncodeValues();
    const summary = buildResultSummary(values);

    if (backendMode.value !== 'local') {
      try {
        const response = await saveLabResults({
          requestId: record.requestId,
          summary,
          encodedValues: values,
          attachmentName: processingForm.rawAttachmentName.trim(),
          finalize: false,
          resultEncodedAt: record.resultEncodedAt,
          resultReferenceRange: record.resultReferenceRange,
          verifiedBy: record.verifiedBy
        });
        if (response) upsertWorkflowFromBackend(response, record.activityLogs);
        backendMode.value = 'connected';
      } catch (error) {
        activateLocalMode(error);
      }
    }

    // Ignore stale save completions if a newer save already started.
    if (saveToken !== draftSaveToken) {
      return false;
    }

    const current = workflowCache[record.requestId] || record;
    current.encodedValues = values;
    current.rawAttachmentName = processingForm.rawAttachmentName.trim();
    current.resultReferenceRange = record.resultReferenceRange;
    current.verifiedBy = record.verifiedBy;
    current.verifiedAt = record.verifiedAt;

    appendActivity(current, 'Result Draft Saved', 'Encoded result draft saved for later finalization.');
    updateWorkflowAndQueue(current);
    markWorkflowAsSynced(current);
    lastAutosavedAt.value = new Date().toISOString();
    saved = true;
    if (!silent) showToast('Result draft saved.', 'success');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Failed to save draft.', 'error');
  } finally {
    if (!silent) {
      pendingAction.value = 'none';
      workflowBusy.value = false;
    }
  }
  return saved;
}

async function onFinalizeResult(): Promise<void> {
  const record = activeWorkflow.value;
  if (!record) return;
  if (!canProcessWorkflow.value) {
    showToast('Your role is not allowed to finalize results.', 'warning');
    return;
  }
  if (!canFinalize.value) {
    showToast('Only in-progress requests can be finalized.', 'warning');
    return;
  }
  if (!validateEncodeForm()) {
    showToast('Please complete required result fields.', 'error');
    return;
  }

  workflowBusy.value = true;
  pendingAction.value = 'finalize';

  const nowIso = new Date().toISOString();
  const values = collectEncodeValues();
  const summary = buildResultSummary(values);

  if (backendMode.value !== 'local') {
    try {
      const response = await saveLabResults({
        requestId: record.requestId,
        summary,
        encodedValues: values,
        attachmentName: processingForm.rawAttachmentName.trim(),
        finalize: true,
        resultEncodedAt: nowIso,
        resultReferenceRange: record.resultReferenceRange,
        verifiedBy: record.verifiedBy || processingForm.assignedLabStaff
      });
      if (response) upsertWorkflowFromBackend(response, record.activityLogs);
      backendMode.value = 'connected';
    } catch (error) {
      activateLocalMode(error);
    }
  }

  const current = workflowCache[record.requestId] || record;
  current.encodedValues = values;
  current.resultEncodedAt = nowIso;
  current.verifiedBy = current.verifiedBy || processingForm.assignedLabStaff;
  current.verifiedAt = current.verifiedAt || nowIso;
  current.status = 'Result Ready';

  appendActivity(current, 'Result Finalized', 'Result finalized and status moved to Result Ready.');
  updateWorkflowAndQueue(current);

  workflowStep.value = 'release';
  pendingAction.value = 'none';
  workflowBusy.value = false;
  markWorkflowAsSynced(current);
  showToast('Result finalized.', 'success');
}

async function onReleaseReport(): Promise<void> {
  const record = activeWorkflow.value;
  if (!record) return;
  if (!canVerifyAndRelease.value) {
    showToast('Only Admin or Lab Manager can release reports.', 'warning');
    return;
  }
  if (record.status !== 'Result Ready') {
    showToast('Only Result Ready requests can be released.', 'warning');
    return;
  }
  if (!record.resultEncodedAt) {
    showToast('Cannot release report. Encoded result timestamp is missing.', 'error');
    return;
  }
  if (!record.verifiedBy) {
    showToast('Verification by lab staff is required before release.', 'warning');
    return;
  }

  workflowBusy.value = true;
  pendingAction.value = 'release';

  const nowIso = new Date().toISOString();

  if (backendMode.value !== 'local') {
    try {
      const response = await releaseLabReport({
        requestId: record.requestId,
        releasedBy: 'Lab Staff',
        releasedAt: nowIso
      });
      if (response) upsertWorkflowFromBackend(response, record.activityLogs);
      backendMode.value = 'connected';
    } catch (error) {
      activateLocalMode(error);
    }
  }

  const current = workflowCache[record.requestId] || record;
  current.status = 'Completed';
  current.releasedAt = nowIso;

  appendActivity(current, 'Report Released', 'Laboratory report released to doctor / check-up queue.');
  updateWorkflowAndQueue(current);

  workflowStep.value = 'history';
  pendingAction.value = 'none';
  workflowBusy.value = false;
  markWorkflowAsSynced(current);
  showToast('Report released successfully.', 'success');
}

async function onRejectOrResample(): Promise<void> {
  const record = activeWorkflow.value;
  if (!record) return;
  if (!canVerifyAndRelease.value) {
    showToast('Only Admin or Lab Manager can reject/request resample.', 'warning');
    return;
  }
  if (!rejectForm.reason.trim()) {
    showToast('Rejection reason is required.', 'warning');
    return;
  }
  workflowBusy.value = true;
  pendingAction.value = 'release';
  const updated = await rejectLabRequest({
    requestId: record.requestId,
    reason: rejectForm.reason.trim(),
    resampleFlag: rejectForm.resampleFlag,
    actor: currentRole.value
  });
  const current = updated ? upsertWorkflowFromBackend(updated, record.activityLogs) : (workflowCache[record.requestId] || record);
  current.rejectionReason = rejectForm.reason.trim();
  current.resampleFlag = rejectForm.resampleFlag;
  current.status = 'Cancelled';
  appendActivity(
    current,
    rejectForm.resampleFlag ? 'Resample Requested' : 'Request Rejected',
    rejectForm.reason.trim(),
    currentRole.value
  );
  updateWorkflowAndQueue(current);
  rejectDialog.value = false;
  pendingAction.value = 'none';
  workflowBusy.value = false;
  markWorkflowAsSynced(current);
  showToast(rejectForm.resampleFlag ? 'Resample requested.' : 'Request rejected.', 'success');
}

function onDownloadReport(): void {
  const record = activeWorkflow.value;
  if (!record) return;
  if (!canExport.value) {
    showToast('Report can be downloaded when status is Result Ready or Completed.', 'warning');
    return;
  }

  const reportOpened = openReportWindow(record, 'download');
  if (!reportOpened) {
    const fallbackPrinted = printReportViaIframe(record);
    if (!fallbackPrinted) {
      showToast('Unable to open report. Please allow pop-ups/printing and try again.', 'warning');
      return;
    }
  }

  appendActivity(record, 'PDF Downloaded', 'User triggered report PDF export.');
  updateWorkflowAndQueue(record);
  showToast('Report opened. Choose "Save as PDF" in the print dialog.', 'info');
}

function onPrintReport(): void {
  const record = activeWorkflow.value;
  if (!record) return;
  if (!canExport.value) {
    showToast('Report can be printed when status is Result Ready or Completed.', 'warning');
    return;
  }

  const reportOpened = openReportWindow(record, 'print');
  if (!reportOpened) {
    const fallbackPrinted = printReportViaIframe(record);
    if (!fallbackPrinted) {
      showToast('Unable to open print window. Please allow pop-ups/printing and try again.', 'warning');
      return;
    }
  }

  appendActivity(record, 'Report Printed', 'User opened print action for the released report.');
  updateWorkflowAndQueue(record);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildReportMarkup(record: WorkflowRecord): string {
  const fields = getFieldTemplate(record.category);
  const reportNumber = `LAB-${record.requestId}`;
  const releasedAt = formatDateTime(record.releasedAt);
  const encodedAt = formatDateTime(record.resultEncodedAt);
  const requestedAt = formatDateTime(record.requestedAt);
  const verifiedBy = record.verifiedBy || '--';
  const rows = fields
    .map((field) => {
      const raw = record.encodedValues[field.key];
      const value = raw == null || String(raw).trim() === '' ? '--' : String(raw);
      const suffix = field.unit ? ` ${field.unit}` : '';
      return `<tr><td>${escapeHtml(field.label)}</td><td>${escapeHtml(value)}${escapeHtml(suffix)}</td></tr>`;
    })
    .join('');

  const notes = record.notes || record.clinicalDiagnosis || '--';
  const referenceRange = record.resultReferenceRange || '--';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nexora Lab Report ${escapeHtml(reportNumber)}</title>
  <style>
    :root {
      --brand: #1f4fa9;
      --brand-dark: #0f2f6b;
      --accent: #1e88e5;
      --surface: #ffffff;
      --surface-soft: #f3f7ff;
      --text: #1f2937;
      --muted: #64748b;
      --border: #d8e1f2;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(180deg, #eaf1ff 0%, #f8fbff 38%, #ffffff 100%);
      color: var(--text);
      padding: 24px;
    }
    .sheet {
      width: 100%;
      max-width: 920px;
      margin: 0 auto;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 12px 30px rgba(12, 38, 94, 0.12);
    }
    .header {
      background: linear-gradient(135deg, var(--brand-dark), var(--brand));
      color: #fff;
      padding: 22px 26px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .brand { font-size: 20px; font-weight: 800; letter-spacing: .2px; }
    .sub { font-size: 12px; opacity: .9; margin-top: 2px; }
    .chip {
      font-size: 12px;
      font-weight: 700;
      background: rgba(255,255,255,.16);
      border: 1px solid rgba(255,255,255,.28);
      border-radius: 999px;
      padding: 6px 10px;
    }
    .body { padding: 20px 24px 24px; }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 16px;
    }
    .card {
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface-soft);
      padding: 12px 14px;
    }
    .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
    .value { margin-top: 4px; font-size: 14px; font-weight: 700; color: #17386f; }
    h2 { margin: 12px 0 8px; font-size: 18px; color: #14366f; }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      background: #fff;
      margin-top: 8px;
    }
    th, td { padding: 10px 12px; border-bottom: 1px solid #e7edf9; text-align: left; font-size: 13px; }
    th { background: #edf3ff; color: #193a72; font-size: 12px; text-transform: uppercase; letter-spacing: .35px; }
    tr:last-child td { border-bottom: none; }
    .notes {
      margin-top: 14px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: #fff;
      padding: 10px 12px;
      font-size: 13px;
      line-height: 1.45;
    }
    .footer {
      margin-top: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: var(--muted);
      font-size: 12px;
    }
    @media print {
      body { background: #fff; padding: 0; }
      .sheet { box-shadow: none; border-radius: 0; border: none; max-width: none; }
    }
  </style>
</head>
<body>
  <article class="sheet">
    <header class="header">
      <div>
        <div class="brand">Nexora Medical Center</div>
        <div class="sub">Laboratory Diagnostic Report</div>
      </div>
      <div class="chip">Result Ready</div>
    </header>

    <section class="body">
      <div class="grid">
        <div class="card"><div class="label">Patient</div><div class="value">${escapeHtml(record.patientName)} (${escapeHtml(record.patientId)})</div></div>
        <div class="card"><div class="label">Request</div><div class="value">#${escapeHtml(record.requestId)} / ${escapeHtml(reportNumber)}</div></div>
        <div class="card"><div class="label">Department</div><div class="value">${escapeHtml(record.doctorDepartment || '--')}</div></div>
        <div class="card"><div class="label">Doctor</div><div class="value">${escapeHtml(record.requestedByDoctor || '--')}</div></div>
        <div class="card"><div class="label">Requested At</div><div class="value">${escapeHtml(requestedAt)}</div></div>
        <div class="card"><div class="label">Released At</div><div class="value">${escapeHtml(releasedAt)}</div></div>
      </div>

      <h2>Test Results - ${escapeHtml(record.category)}</h2>
      <table>
        <thead><tr><th>Metric</th><th>Value</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="notes"><strong>Result Reference Range:</strong> ${escapeHtml(referenceRange)}</div>
      <div class="notes"><strong>Clinical Notes:</strong> ${escapeHtml(notes)}</div>

      <div class="footer">
        <span>Verified by: <strong>${escapeHtml(verifiedBy)}</strong></span>
        <span>Encoded: ${escapeHtml(encodedAt)}</span>
      </div>
    </section>
  </article>
</body>
</html>`;
}

function printReportViaIframe(record: WorkflowRecord): boolean {
  try {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.srcdoc = buildReportMarkup(record);
    document.body.appendChild(iframe);

    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        setTimeout(() => {
          iframe.remove();
        }, 1500);
      }
    };

    return true;
  } catch {
    return false;
  }
}

function openReportWindow(record: WorkflowRecord, mode: 'print' | 'download'): boolean {
  let reportWindow: Window | null = null;
  try {
    reportWindow = window.open('about:blank', '_blank', 'width=1100,height=900');
  } catch {
    reportWindow = null;
  }
  if (!reportWindow) {
    return false;
  }
  try {
    reportWindow.opener = null;
  } catch {
    // Ignore browsers that block setting opener.
  }

  try {
    reportWindow.document.open();
    reportWindow.document.write(buildReportMarkup(record));
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.onafterprint = () => {
      reportWindow?.close();
    };

    setTimeout(() => {
      reportWindow?.print();
    }, mode === 'download' ? 350 : 220);
  } catch {
    try {
      reportWindow.close();
    } catch {
      // Ignore close errors.
    }
    return false;
  }

  return true;
}

function workflowStepLabel(step: WorkflowStep): string {
  if (step === 'order') return 'Order Details';
  if (step === 'processing') return 'Sample / Processing';
  if (step === 'encode') return 'Encode Result';
  if (step === 'release') return 'Release Report';
  return 'History';
}

function updateVerifiedAt(value: string | null): void {
  if (!activeWorkflow.value) return;
  activeWorkflow.value.verifiedAt = value ? new Date(value).toISOString() : null;
}

function formatAutosavedAt(value: string | null): string {
  if (!value) return 'Not yet autosaved';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Autosaved';
  return `Autosaved ${new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date)}`;
}
</script>

<template>
  <div class="laboratory-page">
    <div v-if="queueLoading" class="pa-2">
      <v-skeleton-loader type="heading, text" class="mb-4" />
      <v-row class="mb-4">
        <v-col v-for="index in 5" :key="`metric-skeleton-${index}`" cols="12" md="6" lg="2">
          <v-skeleton-loader type="card" />
        </v-col>
      </v-row>
      <v-skeleton-loader type="table-heading, table-row-divider@6" />
    </div>

    <div v-else class="lab-shell" :class="{ ready: queueReady }">
      <v-card class="lab-header-card mb-4" elevation="0">
        <v-card-text class="pa-6">
          <div class="d-flex flex-wrap align-center justify-space-between ga-3">
            <div>
              <h1 class="text-h3 font-weight-black mb-1">Laboratory</h1>
              <p class="text-subtitle-1 mb-0 lab-header-subtitle">Manage lab requests, encode results, and release reports.</p>
              <div class="d-flex align-center ga-2 mt-3">
                <v-chip size="small" :color="backendMode === 'local' ? 'warning' : 'success'" variant="tonal" class="lab-mode-chip">
                  {{ backendMode === 'local' ? 'Local Mode' : 'API Connected' }}
                </v-chip>
                <v-chip size="small" color="primary" variant="tonal" class="lab-flow-chip">Workflow: Queue -> Process -> Encode -> Release</v-chip>
              </div>
            </div>

            <div class="d-flex align-center ga-2 flex-wrap">
              <v-select v-model="currentRole" :items="roleOptions" label="Session Role" variant="solo-filled" density="compact" hide-details class="role-inline-select" />
            </div>
          </div>
        </v-card-text>
      </v-card>

      <v-row class="mb-4">
        <v-col cols="12" sm="6" lg="2"><v-card class="metric-card metric-total" elevation="0"><v-card-text><div class="metric-title">Total Requests</div><div class="metric-value">{{ metrics.totalRequests }}</div></v-card-text></v-card></v-col>
        <v-col cols="12" sm="6" lg="2"><v-card class="metric-card metric-pending" elevation="0"><v-card-text><div class="metric-title">Pending</div><div class="metric-value">{{ metrics.pending }}</div></v-card-text></v-card></v-col>
        <v-col cols="12" sm="6" lg="2"><v-card class="metric-card metric-progress" elevation="0"><v-card-text><div class="metric-title">In Progress</div><div class="metric-value">{{ metrics.inProgress }}</div></v-card-text></v-card></v-col>
        <v-col cols="12" sm="6" lg="3"><v-card class="metric-card metric-completed" elevation="0"><v-card-text><div class="metric-title">Completed Today</div><div class="metric-value">{{ metrics.completedToday }}</div></v-card-text></v-card></v-col>
        <v-col cols="12" sm="6" lg="3"><v-card class="metric-card metric-urgent" elevation="0"><v-card-text><div class="metric-title">Urgent</div><div class="metric-value">{{ metrics.urgent }}</div></v-card-text></v-card></v-col>
      </v-row>

      <v-card class="lab-surface-card" variant="outlined">
        <v-card-item>
          <v-card-title>Laboratory Queue</v-card-title>
          <template #append>
            <div class="d-flex align-center ga-2 flex-wrap">
              <v-btn class="saas-btn saas-btn-ghost" prepend-icon="mdi-refresh" :loading="queueLoading" @click="refreshQueueNow">Refresh</v-btn>
              <v-btn class="saas-btn saas-btn-light" prepend-icon="mdi-plus" :disabled="!canCreateRequest" @click="openCreateRequestDialog">New Lab Request</v-btn>
            </div>
          </template>
        </v-card-item>
        <v-divider />
        <v-card-text>
          <div class="d-flex flex-wrap align-center ga-2 mb-3">
            <v-text-field v-model="searchQuery" class="flex-grow-1" variant="outlined" density="comfortable" hide-details prepend-inner-icon="mdi-magnify" label="Search patient, visit_id, request_id" />
            <v-btn class="saas-btn saas-btn-ghost" prepend-icon="mdi-filter-variant" @click="showAdvancedFilters = !showAdvancedFilters">Advanced Filters</v-btn>
          </div>

          <div class="status-tab-strip mb-3">
            <button class="status-tab" :class="{ active: statusTab === 'all' }" @click="statusTab = 'all'">All</button>
            <button class="status-tab" :class="{ active: statusTab === 'pending' }" @click="statusTab = 'pending'">Pending <span class="status-tab-count">{{ tabCounts.pending }}</span></button>
            <button class="status-tab" :class="{ active: statusTab === 'in_progress' }" @click="statusTab = 'in_progress'">In Progress <span class="status-tab-count">{{ tabCounts.inProgress }}</span></button>
            <button class="status-tab" :class="{ active: statusTab === 'completed' }" @click="statusTab = 'completed'">Completed <span class="status-tab-count">{{ tabCounts.completed }}</span></button>
          </div>

          <v-expand-transition>
            <div v-show="showAdvancedFilters" class="advanced-filters-panel mb-4">
              <v-row>
                <v-col cols="12" md="3"><v-select v-model="filterCategory" :items="categoryItems" label="Category" variant="outlined" density="comfortable" hide-details /></v-col>
                <v-col cols="12" md="3"><v-select v-model="filterPriority" :items="priorityItems" label="Priority" variant="outlined" density="comfortable" hide-details /></v-col>
                <v-col cols="12" md="3"><v-select v-model="filterDoctor" :items="doctorItems" label="Requested By Doctor" variant="outlined" density="comfortable" hide-details /></v-col>
                <v-col cols="12" md="3"><v-row><v-col cols="6" class="pr-1"><SaasDateTimePickerField v-model="filterFromDate" mode="date" label="From" hide-details /></v-col><v-col cols="6" class="pl-1"><SaasDateTimePickerField v-model="filterToDate" mode="date" label="To" hide-details /></v-col></v-row></v-col>
              </v-row>
            </div>
          </v-expand-transition>

          <div class="queue-table-wrap">
            <v-table density="comfortable">
              <thead>
                <tr>
                  <th>REQUEST ID</th>
                  <th>PATIENT</th>
                  <th>CATEGORY</th>
                  <th>PRIORITY</th>
                  <th>STATUS</th>
                  <th>REQUESTED DATE / TIME</th>
                  <th class="text-right">ACTION</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in pagedRows" :key="row.requestId" class="queue-row" @click="openWorkflow(row.requestId, rowPrimaryAction(row))">
                  <td class="font-weight-bold">#{{ row.requestId }}</td>
                  <td><div class="font-weight-bold">{{ row.patientName }}</div><div class="text-caption text-medium-emphasis">{{ row.patientId }} | {{ row.visitId }}</div></td>
                  <td>{{ row.category }}</td>
                  <td><v-chip size="small" variant="tonal" :color="priorityChipColor(row.priority)">{{ row.priority }}</v-chip></td>
                  <td><v-chip size="small" variant="tonal" :color="statusChipColor(row.status)">{{ row.status }}</v-chip></td>
                  <td>{{ formatDateTime(row.requestedAt) }}</td>
                  <td class="text-right">
                    <v-btn size="small" class="saas-btn action-btn saas-row-action-btn" :color="rowPrimaryActionColor(row)" :prepend-icon="rowPrimaryActionIcon(row)" variant="flat" @click.stop="openWorkflow(row.requestId, rowPrimaryAction(row))">
                      {{ rowPrimaryActionLabel(row) }}
                    </v-btn>
                  </td>
                </tr>
                <tr v-if="pagedRows.length === 0"><td colspan="7" class="text-center py-8"><div class="text-h6 mb-1">{{ emptyStateTitle }}</div><div class="text-body-2 text-medium-emphasis">{{ emptyStateDescription }}</div></td></tr>
              </tbody>
            </v-table>
          </div>

          <div class="d-flex align-center justify-space-between mt-3 flex-wrap ga-2">
            <div class="text-caption text-medium-emphasis">{{ showingText }}</div>
            <v-pagination v-model="listPage" :length="pageCount" :total-visible="5" density="comfortable" />
          </div>
        </v-card-text>
      </v-card>
    </div>
    <ModuleActivityLogs module="laboratory" title="Module Activity Logs" :per-page="8" />

    <v-dialog :model-value="workflowDialog" max-width="1380" transition="dialog-bottom-transition" scrollable @update:model-value="onWorkflowDialogModelUpdate">
      <v-card class="workflow-dialog-card">
        <v-card-item class="workflow-header">
          <v-card-title>
            <template v-if="activeWorkflow">
              <div class="text-h5 font-weight-bold">{{ activeWorkflow.patientName }} - Request #{{ activeWorkflow.requestId }}</div>
              <div class="text-body-2 text-medium-emphasis">{{ activeWorkflow.visitId }} | {{ activeWorkflow.patientId }}</div>
            </template>
            <template v-else><div class="text-h5 font-weight-bold">Lab Workflow</div></template>
          </v-card-title>
          <template #append>
            <div class="d-flex align-center ga-2">
              <v-chip v-if="activeWorkflow" size="small" :color="statusChipColor(activeWorkflow.status)" variant="tonal">{{ activeWorkflow.status }}</v-chip>
              <v-btn icon="mdi-printer" variant="text" :disabled="!canExport" @click="onPrintReport" />
              <v-btn icon="mdi-file-download-outline" variant="text" :disabled="!canExport" @click="onDownloadReport" />
              <v-btn icon="mdi-close" variant="text" @click="() => void closeWorkflowDialog()" />
            </div>
          </template>
        </v-card-item>
        <v-divider />

        <v-card-text class="workflow-content pa-4 pa-md-6">
          <template v-if="workflowLoading"><v-skeleton-loader type="heading, text, table-heading, list-item-two-line@4" /></template>

          <template v-else-if="activeWorkflow">
            <v-row>
              <v-col cols="12" lg="3">
                <v-card class="workflow-side-card" variant="outlined">
                  <v-card-item><v-card-title>Patient & Request Summary</v-card-title></v-card-item>
                  <v-card-text>
                    <div class="summary-pair"><span>Patient</span><strong>{{ activeWorkflow.patientName }}</strong></div>
                    <div class="summary-pair"><span>Request ID</span><strong>#{{ activeWorkflow.requestId }}</strong></div>
                    <div class="summary-pair"><span>Category</span><strong>{{ activeWorkflow.category }}</strong></div>
                    <div class="summary-pair"><span>Priority</span><v-chip size="small" :color="priorityChipColor(activeWorkflow.priority)" variant="tonal">{{ activeWorkflow.priority }}</v-chip></div>
                    <div class="summary-pair"><span>Doctor</span><strong>{{ activeWorkflow.requestedByDoctor || '--' }}</strong></div>
                    <div class="summary-pair"><span>Requested At</span><strong>{{ formatDateTime(activeWorkflow.requestedAt) }}</strong></div>
                    <v-divider class="my-3" />
                    <div class="text-subtitle-2 font-weight-bold mb-2">Timestamps</div>
                    <div class="summary-pair"><span>Processing Started</span><strong>{{ formatDateTime(activeWorkflow.processingStartedAt) }}</strong></div>
                    <div class="summary-pair"><span>Result Encoded</span><strong>{{ formatDateTime(activeWorkflow.resultEncodedAt) }}</strong></div>
                    <div class="summary-pair"><span>Released</span><strong>{{ formatDateTime(activeWorkflow.releasedAt) }}</strong></div>
                  </v-card-text>
                </v-card>
              </v-col>

              <v-col cols="12" lg="6">
                <v-card class="workflow-main-card" variant="outlined">
                  <v-card-text>
                    <v-tabs v-model="workflowStep" class="workflow-step-tabs" density="comfortable" align-tabs="start" color="primary">
                      <v-tab value="order" :disabled="isStepDisabled('order')">1. Order</v-tab>
                      <v-tab value="processing" :disabled="isStepDisabled('processing')">2. Processing</v-tab>
                      <v-tab value="encode" :disabled="isStepDisabled('encode')">3. Encode</v-tab>
                      <v-tab value="release" :disabled="isStepDisabled('release')">4. Release</v-tab>
                      <v-tab value="history">5. History</v-tab>
                    </v-tabs>

                    <v-window v-model="workflowStep" class="mt-4">
                      <v-window-item value="order">
                        <div class="text-subtitle-1 font-weight-bold mb-2">Order Details</div>
                        <div class="text-body-2 text-medium-emphasis mb-4">Review doctor request before moving the item into lab processing.</div>
                        <v-alert color="primary" variant="tonal" class="mb-4">Requested by <strong>{{ activeWorkflow.requestedByDoctor || '--' }}</strong></v-alert>
                        <div class="text-subtitle-2 font-weight-bold mb-2">Requested Tests</div>
                        <ul class="order-list mb-4"><li v-for="(test, index) in activeWorkflow.tests" :key="`${activeWorkflow.requestId}-test-${index}`">{{ test }}</li></ul>
                        <v-row>
                          <v-col cols="12" md="6"><v-text-field :model-value="activeWorkflow.doctorDepartment" label="Doctor Department" variant="outlined" density="comfortable" readonly /></v-col>
                          <v-col cols="12" md="6"><v-text-field :model-value="activeWorkflow.specimenType" label="Required Specimen" variant="outlined" density="comfortable" readonly /></v-col>
                          <v-col cols="12" md="6"><v-text-field :model-value="activeWorkflow.insuranceReference || '--'" label="Insurance Reference" variant="outlined" density="comfortable" readonly /></v-col>
                          <v-col cols="12" md="6"><v-text-field :model-value="activeWorkflow.billingReference || '--'" label="Billing Reference" variant="outlined" density="comfortable" readonly /></v-col>
                          <v-col cols="12"><v-textarea :model-value="activeWorkflow.clinicalDiagnosis || activeWorkflow.notes" label="Clinical Notes / Diagnosis" variant="outlined" density="comfortable" rows="3" readonly /></v-col>
                          <v-col cols="12"><v-textarea :model-value="activeWorkflow.labInstructions" label="Lab Instructions" variant="outlined" density="comfortable" rows="2" readonly /></v-col>
                        </v-row>
                        <div class="d-flex justify-end mt-4"><v-btn class="saas-btn saas-btn-primary" :loading="workflowBusy && pendingAction === 'start'" :disabled="!canStartProcessing || workflowBusy" @click="onStartProcessing">Start Processing</v-btn></div>
                      </v-window-item>

                      <v-window-item value="processing">
                        <div class="text-subtitle-1 font-weight-bold mb-2">Sample / Processing</div>
                        <div class="text-body-2 text-medium-emphasis mb-4">Update collection checklist, assignee, and processing notes.</div>
                        <v-row>
                          <v-col cols="12" md="6"><v-checkbox v-model="processingForm.sampleCollected" label="Sample Collected" color="primary" hide-details /></v-col>
                          <v-col cols="12" md="6"><v-text-field :model-value="formatDateTime(activeWorkflow.sampleCollectedAt)" label="Sample Collected At" variant="outlined" density="comfortable" readonly /></v-col>
                          <v-col cols="12" md="6"><v-text-field :model-value="formatDateTime(activeWorkflow.processingStartedAt)" label="Processing Started" variant="outlined" density="comfortable" readonly /></v-col>
                          <v-col cols="12" md="6"><v-select v-model="processingForm.assignedLabStaff" :items="labStaffOptions" label="Assigned Lab Staff" variant="outlined" density="comfortable" /></v-col>
                          <v-col cols="12" md="4"><v-select v-model="processingForm.specimenType" :items="specimenTypeOptions" label="Specimen Type" variant="outlined" density="comfortable" /></v-col>
                          <v-col cols="12" md="4"><v-select v-model="processingForm.sampleSource" :items="sampleSourceOptions" label="Sample Source" variant="outlined" density="comfortable" /></v-col>
                          <v-col cols="12" md="4"><SaasDateTimePickerField v-model="processingForm.collectionDateTime" mode="datetime" label="Collection Date/Time" /></v-col>
                          <v-col cols="12"><v-text-field v-model="processingForm.rawAttachmentName" label="Attach Raw Result File (optional)" placeholder="example: request-1208-raw.pdf" variant="outlined" density="comfortable" /></v-col>
                        </v-row>
                        <div class="d-flex justify-space-between mt-4 flex-wrap ga-2">
                          <v-btn class="saas-btn saas-btn-ghost" :loading="workflowBusy && pendingAction === 'save_processing'" :disabled="workflowBusy" @click="onSaveProcessingProgress">Save Progress</v-btn>
                          <v-btn class="saas-btn saas-btn-primary" :disabled="workflowBusy" @click="onProceedToEncode">Proceed to Encode Results</v-btn>
                        </div>
                      </v-window-item>

                      <v-window-item value="encode">
                        <div class="text-subtitle-1 font-weight-bold mb-2">Encode Result</div>
                        <div class="text-body-2 text-medium-emphasis mb-4">Encode validated values for {{ activeWorkflow.category }}. Required fields must be completed before finalization.</div>
                        <v-row>
                          <v-col v-for="field in currentFieldDefinitions" :key="field.key" cols="12" md="6">
                            <v-select
                              v-if="field.type === 'select'"
                              :model-value="String(encodeForm[field.key] ?? '')"
                              :items="field.options || []"
                              :label="`${field.label}${field.required ? ' *' : ''}`"
                              variant="outlined"
                              density="comfortable"
                              :error-messages="encodeErrors[field.key] ? [encodeErrors[field.key]] : []"
                              @update:model-value="(value) => setEncodeFieldValue(field.key, value)"
                            />
                            <v-text-field
                              v-else
                              :model-value="String(encodeForm[field.key] ?? '')"
                              :label="`${field.label}${field.required ? ' *' : ''}${field.unit ? ` (${field.unit})` : ''}`"
                              :type="field.type === 'number' ? 'number' : 'text'"
                              variant="outlined"
                              density="comfortable"
                              :error-messages="encodeErrors[field.key] ? [encodeErrors[field.key]] : []"
                              :hint="field.min != null || field.max != null ? `Range: ${field.min ?? '-'} to ${field.max ?? '-'}` : undefined"
                              persistent-hint
                              @update:model-value="(value) => setEncodeFieldValue(field.key, value)"
                            />
                          </v-col>
                          <v-col cols="12">
                            <v-textarea
                              :model-value="activeWorkflow.resultReferenceRange"
                              label="Result Reference Range *"
                              variant="outlined"
                              density="comfortable"
                              rows="2"
                              hint="Include expected normal ranges and interpretation guidance."
                              persistent-hint
                              :error-messages="encodeErrors.resultReferenceRange ? [encodeErrors.resultReferenceRange] : []"
                              @update:model-value="(value) => onReferenceRangeChange(value == null ? '' : String(value))"
                            />
                          </v-col>
                          <v-col cols="12" md="6">
                            <v-select
                              :model-value="activeWorkflow.verifiedBy"
                              :items="labStaffOptions"
                              label="Verified By *"
                              variant="outlined"
                              density="comfortable"
                              :error-messages="encodeErrors.verifiedBy ? [encodeErrors.verifiedBy] : []"
                              @update:model-value="(value) => onVerifiedByChange(value == null ? '' : String(value))"
                            />
                          </v-col>
                          <v-col cols="12" md="6">
                            <SaasDateTimePickerField
                              :model-value="activeWorkflow?.verifiedAt ? new Date(activeWorkflow.verifiedAt).toISOString().slice(0, 16) : ''"
                              mode="datetime"
                              label="Verified At"
                              @update:model-value="(value) => updateVerifiedAt(value ? String(value) : null)"
                            />
                          </v-col>
                        </v-row>
                        <div class="d-flex justify-space-between align-center mt-4 flex-wrap ga-2">
                          <div class="text-caption text-medium-emphasis">
                            {{ formatAutosavedAt(lastAutosavedAt) }}
                          </div>
                          <div class="d-flex ga-2">
                            <v-btn class="saas-btn saas-btn-ghost" :loading="workflowBusy && pendingAction === 'save_draft'" :disabled="workflowBusy" @click="onSaveDraft">Save Draft</v-btn>
                            <v-btn class="saas-btn saas-btn-primary" :loading="workflowBusy && pendingAction === 'finalize'" :disabled="workflowBusy || !canFinalize" @click="onFinalizeResult">Finalize Result</v-btn>
                          </div>
                        </div>
                      </v-window-item>

                      <v-window-item value="release">
                        <div class="text-subtitle-1 font-weight-bold mb-2">Release Report</div>
                        <div class="text-body-2 text-medium-emphasis mb-4">Preview encoded values and release report to doctor/check-up.</div>
                        <v-alert v-if="activeWorkflow.status !== 'Result Ready'" color="warning" variant="tonal" class="mb-4">Release is available only when status is <strong>Result Ready</strong>.</v-alert>
                        <v-alert v-if="activeWorkflow.rejectionReason" color="error" variant="tonal" class="mb-4">Rejected: {{ activeWorkflow.rejectionReason }}</v-alert>
                        <v-card class="report-preview-card mb-4" variant="outlined">
                          <v-card-item><v-card-title>Report Preview</v-card-title></v-card-item>
                          <v-card-text>
                            <div class="preview-meta mb-3"><span><strong>Patient:</strong> {{ activeWorkflow.patientName }}</span><span><strong>Category:</strong> {{ activeWorkflow.category }}</span><span><strong>Request #:</strong> {{ activeWorkflow.requestId }}</span></div>
                            <div class="preview-grid"><div v-for="field in currentFieldDefinitions" :key="`preview-${field.key}`" class="preview-row"><span>{{ field.label }}</span><strong>{{ encodeForm[field.key] || '--' }}</strong></div></div>
                          </v-card-text>
                        </v-card>
                        <div class="d-flex justify-space-between flex-wrap ga-2">
                          <div class="d-flex ga-2 flex-wrap"><v-btn class="saas-btn saas-btn-ghost" :disabled="!canExport" @click="onDownloadReport">Download PDF</v-btn><v-btn class="saas-btn saas-btn-ghost" :disabled="!canExport" @click="onPrintReport">Print</v-btn></div>
                          <div class="d-flex ga-2">
                            <v-btn class="saas-btn saas-btn-danger" :disabled="workflowBusy || activeWorkflow.status === 'Completed'" @click="rejectDialog = true">Reject / Resample</v-btn>
                            <v-btn class="saas-btn saas-btn-primary" :loading="workflowBusy && pendingAction === 'release'" :disabled="workflowBusy || !canRelease" @click="onReleaseReport">Release to Doctor / Check-Up</v-btn>
                          </div>
                        </div>
                      </v-window-item>

                      <v-window-item value="history">
                        <div class="text-subtitle-1 font-weight-bold mb-2">History / Timeline</div>
                        <div class="text-body-2 text-medium-emphasis mb-4">Traceable audit trail for this laboratory request.</div>
                        <div v-if="activeWorkflow.activityLogs.length === 0" class="text-medium-emphasis">No activity logs yet.</div>
                        <v-list v-else density="comfortable" class="history-list">
                          <v-list-item v-for="entry in activeWorkflow.activityLogs" :key="entry.id" class="history-item">
                            <template #prepend><v-avatar color="primary" size="30" variant="tonal"><v-icon icon="mdi-clock-outline" size="16" /></v-avatar></template>
                            <v-list-item-title>{{ entry.action }}</v-list-item-title>
                            <v-list-item-subtitle>{{ entry.details }}<br /><span class="text-caption">{{ entry.actor }} | {{ formatDateTime(entry.createdAt) }}</span></v-list-item-subtitle>
                          </v-list-item>
                        </v-list>
                      </v-window-item>
                    </v-window>
                  </v-card-text>
                </v-card>
              </v-col>

              <v-col cols="12" lg="3">
                <v-card class="workflow-side-card" variant="outlined">
                  <v-card-item><v-card-title>Activity Timeline</v-card-title></v-card-item>
                  <v-card-text>
                    <div v-if="activeWorkflow.activityLogs.length === 0" class="text-body-2 text-medium-emphasis">No workflow activity yet.</div>
                    <div v-else class="timeline-stack">
                      <div v-for="entry in activeWorkflow.activityLogs.slice(0, 6)" :key="`timeline-${entry.id}`" class="timeline-item"><div class="timeline-dot" /><div><div class="font-weight-bold">{{ entry.action }}</div><div class="text-caption text-medium-emphasis">{{ entry.actor }} | {{ formatDateTime(entry.createdAt) }}</div><div class="text-body-2">{{ entry.details }}</div></div></div>
                    </div>
                    <v-divider class="my-3" />
                    <div class="text-caption text-medium-emphasis">Current Step</div>
                    <div class="text-subtitle-1 font-weight-bold">{{ workflowStepLabel(workflowStep) }}</div>
                  </v-card-text>
                </v-card>
              </v-col>
            </v-row>
          </template>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog v-model="createDialog" max-width="760" transition="dialog-bottom-transition">
      <v-card>
        <v-card-item>
          <v-card-title>New Lab Request</v-card-title>
          <template #append><v-btn icon="mdi-close" variant="text" @click="createDialog = false" /></template>
        </v-card-item>
        <v-divider />
        <v-card-text class="pt-5">
          <v-row>
            <v-col cols="12"><div class="text-caption font-weight-bold text-uppercase text-primary">Patient Info</div></v-col>
            <v-col cols="12"><v-autocomplete :items="patientLookupItems" item-title="title" item-value="value" v-model="createForm.patientLookup" label="Existing Patient Lookup" variant="outlined" density="comfortable" clearable @update:model-value="(v) => applyPatientLookup(v)" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="createForm.patientName" label="Patient Name *" variant="outlined" density="comfortable" :error-messages="createErrors.patientName" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="createForm.patientId" label="Patient ID" variant="outlined" density="comfortable" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="createForm.visitId" label="Visit ID" variant="outlined" density="comfortable" /></v-col>
            <v-col cols="12" md="6"><v-select v-model="createForm.priority" :items="['Normal', 'Urgent', 'STAT']" label="Appointment Priority" variant="outlined" density="comfortable" /></v-col>

            <v-col cols="12"><div class="text-caption font-weight-bold text-uppercase text-primary">Clinical Order</div></v-col>
            <v-col cols="12" md="6"><v-select v-model="createForm.requestedByDoctor" :items="doctorRequestItems" label="Requested By Doctor *" variant="outlined" density="comfortable" :error-messages="createErrors.requestedByDoctor" hint="Department auto-fills from doctor" persistent-hint /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="createForm.doctorDepartment" label="Doctor Department *" variant="outlined" density="comfortable" :error-messages="createErrors.doctorDepartment" /></v-col>
            <v-col cols="12" md="6"><v-select v-model="createForm.category" :items="categoryItems.filter((item) => item !== 'All')" label="Category *" variant="outlined" density="comfortable" :error-messages="createErrors.category" /></v-col>
            <v-col cols="12" md="6"><v-select v-model="createForm.tests" :items="availableTestsForCategory" label="Test Panel Selector *" variant="outlined" density="comfortable" multiple chips :error-messages="createErrors.tests" hint="Structured test selection replaces comma input." persistent-hint /></v-col>
            <v-col cols="12" md="4"><v-select v-model="createForm.specimenType" :items="specimenTypeOptions" label="Specimen Type *" variant="outlined" density="comfortable" :error-messages="createErrors.specimenType" /></v-col>
            <v-col cols="12" md="4"><v-select v-model="createForm.sampleSource" :items="sampleSourceOptions" label="Sample Source *" variant="outlined" density="comfortable" :error-messages="createErrors.sampleSource" /></v-col>
            <v-col cols="12" md="4"><SaasDateTimePickerField v-model="createForm.collectionDateTime" mode="datetime" label="Collection Date/Time *" :error-messages="createErrors.collectionDateTime" /></v-col>
            <v-col cols="12"><v-textarea v-model="createForm.clinicalDiagnosis" label="Clinical Notes / Diagnosis *" variant="outlined" density="comfortable" rows="2" :error-messages="createErrors.clinicalDiagnosis" /></v-col>
            <v-col cols="12"><v-textarea v-model="createForm.labInstructions" label="Lab Instructions" variant="outlined" density="comfortable" rows="2" /></v-col>

            <v-col cols="12"><div class="text-caption font-weight-bold text-uppercase text-primary">Billing & Notes</div></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="createForm.insuranceReference" label="Insurance Reference" variant="outlined" density="comfortable" /></v-col>
            <v-col cols="12" md="6"><v-text-field v-model="createForm.billingReference" label="Billing Reference" variant="outlined" density="comfortable" /></v-col>
            <v-col cols="12"><v-textarea v-model="createForm.notes" label="Additional Notes" variant="outlined" density="comfortable" rows="2" /></v-col>
          </v-row>
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn class="saas-btn saas-btn-ghost" @click="createDialog = false">Cancel</v-btn>
          <v-btn class="saas-btn saas-btn-primary" :loading="createBusy" @click="createRequest">Save Draft / Create Request</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="rejectDialog" max-width="520">
      <v-card>
        <v-card-title class="text-h6 font-weight-bold">Reject / Resample</v-card-title>
        <v-card-text>
          <v-textarea v-model="rejectForm.reason" label="Rejection Reason *" variant="outlined" density="comfortable" rows="3" />
          <v-checkbox v-model="rejectForm.resampleFlag" label="Request resample instead of full rejection" color="warning" hide-details />
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn class="saas-btn saas-btn-ghost" @click="rejectDialog = false">Cancel</v-btn>
          <v-btn class="saas-btn saas-btn-danger" :loading="workflowBusy" @click="onRejectOrResample">Confirm</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.open" :color="snackbar.color" :timeout="2600">{{ snackbar.text }}</v-snackbar>
  </div>
</template>

<style scoped>
.laboratory-page { background: radial-gradient(1000px 620px at 5% -10%, rgba(56, 102, 220, 0.14), transparent 62%), radial-gradient(940px 540px at 95% 3%, rgba(74, 172, 247, 0.12), transparent 62%); }
.lab-shell { opacity: 0; transform: translateY(10px); transition: opacity 260ms ease, transform 260ms ease; }
.lab-shell.ready { opacity: 1; transform: translateY(0); }
.lab-header-card { border-radius: 18px; color: #fff; background: linear-gradient(120deg, #152e85 0%, #2d63cc 52%, #3fa8f0 100%); box-shadow: 0 16px 34px rgba(19, 45, 126, 0.24); }
.lab-header-subtitle { color: rgba(255, 255, 255, 0.96); text-shadow: 0 1px 2px rgba(8, 20, 52, 0.35); }
.lab-mode-chip { font-weight: 700; }
.lab-flow-chip { color: rgba(255, 255, 255, 0.96) !important; background: rgba(255, 255, 255, 0.14) !important; border: 1px solid rgba(255, 255, 255, 0.32) !important; }
.role-inline-select { min-width: 190px; }
.metric-card { border-radius: 12px; color: #fff; min-height: 100px; box-shadow: 0 12px 26px rgba(22, 43, 111, 0.2); }
.metric-total { background: linear-gradient(135deg, #365dd4 0%, #2f80ed 100%); }
.metric-pending { background: linear-gradient(135deg, #d88c1b 0%, #f59e0b 100%); }
.metric-progress { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); }
.metric-completed { background: linear-gradient(135deg, #0f9d7a 0%, #22c55e 100%); }
.metric-urgent { background: linear-gradient(135deg, #c93a3a 0%, #ef4444 100%); }
.metric-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.7px; font-weight: 700; opacity: 0.95; }
.metric-value { font-size: 30px; line-height: 1.15; font-weight: 800; }
.lab-surface-card { border-radius: 14px; background: linear-gradient(180deg, #fff 0%, #fafcff 100%); }
.queue-table-wrap { border-radius: 12px; overflow: auto; border: 1px solid rgba(75, 109, 177, 0.16); }
.queue-row { cursor: pointer; transition: background 170ms ease; }
.queue-row:hover { background: rgba(53, 115, 215, 0.08); }
.status-tab-strip { display: flex; flex-wrap: wrap; gap: 8px; }
.status-tab { border: 1px solid rgba(75, 109, 177, 0.24); background: #f7faff; color: #435b8f; border-radius: 12px; padding: 8px 14px; font-weight: 600; cursor: pointer; transition: all 160ms ease; }
.status-tab:hover { background: #eff4ff; border-color: rgba(61, 118, 221, 0.35); }
.status-tab.active { color: #1f4498; background: linear-gradient(120deg, rgba(50, 102, 210, 0.18) 0%, rgba(74, 172, 247, 0.18) 100%); border-color: rgba(61, 118, 221, 0.42); box-shadow: 0 6px 14px rgba(48, 92, 179, 0.16); }
.status-tab-count { margin-left: 6px; border-radius: 999px; padding: 2px 8px; background: rgba(61, 118, 221, 0.14); }
.advanced-filters-panel { background: linear-gradient(120deg, rgba(49, 96, 188, 0.08) 0%, rgba(14, 165, 233, 0.07) 100%); border: 1px solid rgba(49, 96, 188, 0.16); border-radius: 12px; padding: 12px; }
.workflow-dialog-card { border-radius: 16px; }
.workflow-header { background: linear-gradient(120deg, rgba(49, 96, 188, 0.14) 0%, rgba(14, 165, 233, 0.12) 100%); }
.workflow-content { min-height: 530px; }
.workflow-side-card,.workflow-main-card { border-radius: 14px; background: linear-gradient(180deg, #fff 0%, #fbfdff 100%); }
.summary-pair { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 8px; }
.summary-pair span { color: #5870a4; font-size: 13px; }
.summary-pair strong { color: #1d3368; text-align: right; font-size: 14px; }
.workflow-step-tabs { border-bottom: 1px solid rgba(79, 114, 184, 0.22); }
.order-list { margin: 0; padding-left: 18px; color: #375081; display: grid; gap: 6px; }
.report-preview-card { border-radius: 12px; }
.preview-meta { display: flex; flex-wrap: wrap; gap: 14px; color: #35538b; font-size: 13px; }
.preview-grid { border-top: 1px dashed rgba(70, 103, 171, 0.24); padding-top: 12px; display: grid; gap: 8px; }
.preview-row { display: flex; justify-content: space-between; gap: 10px; }
.preview-row span { color: #5b6f9c; }
.timeline-stack { display: grid; gap: 12px; }
.timeline-item { position: relative; display: flex; gap: 10px; }
.timeline-dot { width: 10px; height: 10px; margin-top: 6px; border-radius: 50%; background: linear-gradient(135deg, #2f67d2 0%, #06b6d4 100%); box-shadow: 0 0 0 3px rgba(47, 103, 210, 0.12); }
.history-list { border: 1px solid rgba(88, 118, 180, 0.2); border-radius: 12px; }
.history-item + .history-item { border-top: 1px solid rgba(88, 118, 180, 0.12); }
.saas-btn { border-radius: 12px; min-height: 40px; text-transform: none; font-weight: 700; letter-spacing: 0.2px; transition: transform 170ms ease, box-shadow 170ms ease; }
.saas-btn:hover { transform: translateY(-1px); }
.saas-btn:deep(.v-btn__content) { gap: 6px; }
.saas-btn-light { background: #fff !important; color: #18356f !important; box-shadow: 0 8px 16px rgba(23, 50, 103, 0.14); }
.saas-btn-primary { background: linear-gradient(120deg, #2a62d2 0%, #3e94ee 100%) !important; color: #fff !important; box-shadow: 0 8px 16px rgba(23, 50, 103, 0.18); }
.saas-btn-ghost { background: #f5f8ff !important; color: #335792 !important; border: 1px solid rgba(52, 92, 168, 0.22) !important; box-shadow: none; }
.saas-btn-ghost:hover { background: #edf3ff !important; box-shadow: 0 8px 16px rgba(42, 79, 151, 0.14); }
.saas-btn-danger { background: linear-gradient(120deg, #dc2626 0%, #ef4444 100%) !important; color: #fff !important; box-shadow: 0 8px 16px rgba(220, 38, 38, 0.24); }
.action-btn { min-width: 96px; }
.saas-row-action-btn { box-shadow: 0 8px 16px rgba(24, 52, 117, 0.2); border-radius: 10px !important; }
.saas-row-action-btn:hover { box-shadow: 0 10px 20px rgba(24, 52, 117, 0.28); }
:deep(.v-theme--dark) .lab-surface-card,:deep(.v-theme--dark) .workflow-side-card,:deep(.v-theme--dark) .workflow-main-card,:deep(.v-theme--dark) .report-preview-card { background: linear-gradient(180deg, rgba(27, 41, 78, 0.94) 0%, rgba(20, 31, 59, 0.94) 100%); border-color: rgba(155, 184, 255, 0.2) !important; }
:deep(.v-theme--dark) .queue-table-wrap { border-color: rgba(155, 184, 255, 0.2); }
:deep(.v-theme--dark) .queue-row:hover { background: rgba(65, 118, 223, 0.2); }
:deep(.v-theme--dark) .status-tab { background: rgba(255, 255, 255, 0.04); color: #c2d4ff; border-color: rgba(174, 201, 255, 0.24); }
:deep(.v-theme--dark) .status-tab.active { color: #fff; background: linear-gradient(120deg, rgba(65, 118, 223, 0.34) 0%, rgba(14, 165, 233, 0.3) 100%); }
:deep(.v-theme--dark) .summary-pair span,:deep(.v-theme--dark) .preview-row span { color: #b8c9ef; }
:deep(.v-theme--dark) .summary-pair strong,:deep(.v-theme--dark) .preview-row strong { color: #eff5ff; }
@media (max-width: 1100px) { .workflow-content { min-height: auto; } }
</style>
