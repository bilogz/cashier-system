import { emitRealtimeRefresh } from '@/composables/useRealtimeListSync';
import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type LabStatus = 'Pending' | 'In Progress' | 'Result Ready' | 'Completed' | 'Cancelled';
export type LabPriority = 'Normal' | 'Urgent' | 'STAT';

export type LabQueueFilterParams = {
  search?: string;
  status?: string;
  category?: string;
  priority?: string;
  doctor?: string;
  fromDate?: string;
  toDate?: string;
};

export type LabQueueRequest = {
  requestId: number;
  visitId: string;
  patientId: string;
  patientName: string;
  category: string;
  priority: LabPriority;
  status: LabStatus;
  requestedAt: string;
  requestedByDoctor: string;
};

export type LabRequestDetail = {
  requestId: number;
  visitId: string;
  patientId: string;
  patientName: string;
  age: number | null;
  sex: string;
  category: string;
  priority: LabPriority;
  status: LabStatus;
  requestedAt: string;
  requestedByDoctor: string;
  doctorDepartment: string;
  notes: string;
  tests: string[];
  specimenType: string;
  sampleSource: string;
  collectionDateTime: string | null;
  clinicalDiagnosis: string;
  labInstructions: string;
  insuranceReference: string;
  billingReference: string;
  assignedLabStaff: string;
  sampleCollected: boolean;
  sampleCollectedAt: string | null;
  processingStartedAt: string | null;
  resultEncodedAt: string | null;
  resultReferenceRange: string;
  verifiedBy: string;
  verifiedAt: string | null;
  rejectionReason: string;
  resampleFlag: boolean;
  releasedAt: string | null;
  rawAttachmentName: string;
  encodedValues: Record<string, string | number | null>;
};

export type LabActivityLog = {
  id: number;
  requestId: number;
  action: string;
  details: string;
  actor: string;
  createdAt: string;
};

export type StartProcessingPayload = {
  requestId: number;
  labStaff: string;
  sampleCollected: boolean;
  sampleCollectedAt: string | null;
  processingStartedAt: string;
  specimenType?: string;
  sampleSource?: string;
  collectionDateTime?: string | null;
};

export type SaveResultsPayload = {
  requestId: number;
  summary: string;
  encodedValues: Record<string, string | number | null>;
  attachmentName: string;
  finalize: boolean;
  resultEncodedAt: string | null;
  resultReferenceRange?: string;
  verifiedBy?: string;
};

export type ReleaseReportPayload = {
  requestId: number;
  releasedBy: string;
  releasedAt: string;
};

export type CreateLabRequestPayload = {
  patientName: string;
  patientId?: string;
  visitId?: string;
  age?: number | null;
  sex?: string;
  category: string;
  priority: LabPriority;
  requestedByDoctor: string;
  doctorDepartment: string;
  notes?: string;
  tests: string[];
  specimenType: string;
  sampleSource: string;
  collectionDateTime?: string | null;
  clinicalDiagnosis: string;
  labInstructions?: string;
  insuranceReference?: string;
  billingReference?: string;
  assignedLabStaff?: string;
};

type LabStore = {
  requests: LabRequestDetail[];
  logs: LabActivityLog[];
};

const LAB_STORE_KEY = 'nexora_laboratory_store_v1';

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const directApi = import.meta.env.VITE_LABORATORY_API_URL?.trim();
  if (directApi) return trimTrailingSlashes(directApi);
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/laboratory`;
  return '/api/laboratory';
}

function toQueueFromApi(item: any): LabQueueRequest {
  return {
    requestId: Number(item.request_id || item.requestId || 0),
    visitId: String(item.visit_id || item.visitId || ''),
    patientId: String(item.patient_id || item.patientId || ''),
    patientName: String(item.patient_name || item.patientName || ''),
    category: String(item.category || ''),
    priority: String(item.priority || 'Normal') as LabPriority,
    status: String(item.status || 'Pending') as LabStatus,
    requestedAt: String(item.requested_at || item.requestedAt || ''),
    requestedByDoctor: String(item.requested_by_doctor || item.requestedByDoctor || '')
  };
}

function toDetailFromApi(item: any): LabRequestDetail {
  return {
    requestId: Number(item.request_id || item.requestId || 0),
    visitId: String(item.visit_id || item.visitId || ''),
    patientId: String(item.patient_id || item.patientId || ''),
    patientName: String(item.patient_name || item.patientName || ''),
    age: item.age == null ? null : Number(item.age),
    sex: String(item.sex || ''),
    category: String(item.category || ''),
    priority: String(item.priority || 'Normal') as LabPriority,
    status: String(item.status || 'Pending') as LabStatus,
    requestedAt: String(item.requested_at || item.requestedAt || ''),
    requestedByDoctor: String(item.requested_by_doctor || item.requestedByDoctor || ''),
    doctorDepartment: String(item.doctor_department || item.doctorDepartment || ''),
    notes: String(item.notes || ''),
    tests: Array.isArray(item.tests) ? item.tests.map((x: unknown) => String(x)) : [],
    specimenType: String(item.specimen_type || item.specimenType || ''),
    sampleSource: String(item.sample_source || item.sampleSource || ''),
    collectionDateTime: item.collection_date_time ? String(item.collection_date_time) : item.collectionDateTime ? String(item.collectionDateTime) : null,
    clinicalDiagnosis: String(item.clinical_diagnosis || item.clinicalDiagnosis || ''),
    labInstructions: String(item.lab_instructions || item.labInstructions || ''),
    insuranceReference: String(item.insurance_reference || item.insuranceReference || ''),
    billingReference: String(item.billing_reference || item.billingReference || ''),
    assignedLabStaff: String(item.assigned_lab_staff || item.assignedLabStaff || ''),
    sampleCollected: Boolean(item.sample_collected ?? item.sampleCollected),
    sampleCollectedAt: item.sample_collected_at ? String(item.sample_collected_at) : item.sampleCollectedAt ? String(item.sampleCollectedAt) : null,
    processingStartedAt: item.processing_started_at ? String(item.processing_started_at) : item.processingStartedAt ? String(item.processingStartedAt) : null,
    resultEncodedAt: item.result_encoded_at ? String(item.result_encoded_at) : item.resultEncodedAt ? String(item.resultEncodedAt) : null,
    resultReferenceRange: String(item.result_reference_range || item.resultReferenceRange || ''),
    verifiedBy: String(item.verified_by || item.verifiedBy || ''),
    verifiedAt: item.verified_at ? String(item.verified_at) : item.verifiedAt ? String(item.verifiedAt) : null,
    rejectionReason: String(item.rejection_reason || item.rejectionReason || ''),
    resampleFlag: Boolean(item.resample_flag ?? item.resampleFlag),
    releasedAt: item.released_at ? String(item.released_at) : item.releasedAt ? String(item.releasedAt) : null,
    rawAttachmentName: String(item.raw_attachment_name || item.rawAttachmentName || ''),
    encodedValues: item.encoded_values && typeof item.encoded_values === 'object' ? (item.encoded_values as Record<string, string | number | null>) : {}
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function isoAgo(daysAgo: number, hour: number, minute: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function seedStore(): LabStore {
  const requests: LabRequestDetail[] = [
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
      encodedValues: {}
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
      clinicalDiagnosis: 'Urinary tract infection, for confirmation',
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
      encodedValues: {}
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
      encodedValues: { wbc: 6.4, rbc: 4.8, hemoglobin: 14.2, platelets: 288 }
    },
    {
      requestId: 1160,
      visitId: 'VISIT-2026-1908',
      patientId: 'PAT-2509',
      patientName: 'Lara Gomez',
      age: 27,
      sex: 'Female',
      category: 'X-Ray',
      priority: 'Urgent',
      status: 'Completed',
      requestedAt: isoAgo(6, 8, 40),
      requestedByDoctor: 'Dr. Molina',
      doctorDepartment: 'Radiology',
      notes: 'Follow-up chest imaging.',
      tests: ['Chest X-Ray (PA View)'],
      specimenType: 'Imaging',
      sampleSource: 'Radiology',
      collectionDateTime: isoAgo(6, 8, 50),
      clinicalDiagnosis: 'Pulmonary follow-up',
      labInstructions: '',
      insuranceReference: '',
      billingReference: 'BILL-LAB-1160',
      assignedLabStaff: 'Tech Paolo',
      sampleCollected: true,
      sampleCollectedAt: isoAgo(6, 8, 50),
      processingStartedAt: isoAgo(6, 9, 5),
      resultEncodedAt: isoAgo(6, 9, 35),
      resultReferenceRange: 'No acute infiltrates',
      verifiedBy: 'Tech Paolo',
      verifiedAt: isoAgo(6, 9, 40),
      rejectionReason: '',
      resampleFlag: false,
      releasedAt: isoAgo(6, 10, 5),
      rawAttachmentName: 'lara-gomez-xray.jpg',
      encodedValues: { examined_area: 'Chest', radiology_findings: 'No acute infiltrates', impression: 'Normal chest X-ray' }
    },
    {
      requestId: 1151,
      visitId: 'VISIT-2026-1884',
      patientId: 'PAT-2401',
      patientName: 'Carlos Medina',
      age: 36,
      sex: 'Male',
      category: 'Serology',
      priority: 'Urgent',
      status: 'In Progress',
      requestedAt: isoAgo(1, 9, 25),
      requestedByDoctor: 'Dr. Rivera',
      doctorDepartment: 'Pediatrics',
      notes: 'Evaluate viral markers due to persistent fever.',
      tests: ['Dengue IgM/IgG', 'HBsAg'],
      specimenType: 'Serum',
      sampleSource: 'Blood',
      collectionDateTime: isoAgo(1, 9, 40),
      clinicalDiagnosis: 'Rule out viral infection',
      labInstructions: '',
      insuranceReference: '',
      billingReference: 'BILL-LAB-1151',
      assignedLabStaff: 'Tech Carla',
      sampleCollected: true,
      sampleCollectedAt: isoAgo(1, 9, 40),
      processingStartedAt: isoAgo(1, 9, 50),
      resultEncodedAt: null,
      resultReferenceRange: '',
      verifiedBy: '',
      verifiedAt: null,
      rejectionReason: '',
      resampleFlag: false,
      releasedAt: null,
      rawAttachmentName: '',
      encodedValues: {}
    },
    {
      requestId: 1144,
      visitId: 'VISIT-2026-1869',
      patientId: 'PAT-2332',
      patientName: 'Rina Lopez',
      age: 49,
      sex: 'Female',
      category: 'Microbiology',
      priority: 'Normal',
      status: 'Cancelled',
      requestedAt: isoAgo(2, 8, 30),
      requestedByDoctor: 'Dr. Morco',
      doctorDepartment: 'Internal Medicine',
      notes: 'Culture requested for persistent urinary symptoms.',
      tests: ['Urine Culture and Sensitivity'],
      specimenType: 'Urine',
      sampleSource: 'Urine',
      collectionDateTime: isoAgo(2, 8, 45),
      clinicalDiagnosis: 'Complicated UTI workup',
      labInstructions: 'Resample due to contamination',
      insuranceReference: '',
      billingReference: 'BILL-LAB-1144',
      assignedLabStaff: 'Tech Liza',
      sampleCollected: true,
      sampleCollectedAt: isoAgo(2, 8, 45),
      processingStartedAt: isoAgo(2, 9, 0),
      resultEncodedAt: null,
      resultReferenceRange: '',
      verifiedBy: '',
      verifiedAt: null,
      rejectionReason: 'Initial specimen contaminated; repeat sample required.',
      resampleFlag: true,
      releasedAt: null,
      rawAttachmentName: 'rina-lopez-urine-culture-initial.pdf',
      encodedValues: {}
    }
  ];

  const logs: LabActivityLog[] = [
    {
      id: 1,
      requestId: 1208,
      action: 'Request Created',
      details: 'Doctor submitted a new laboratory request.',
      actor: 'Dr. Humour',
      createdAt: isoAgo(0, 10, 45)
    },
    {
      id: 2,
      requestId: 1196,
      action: 'Processing Started',
      details: 'Sample collected and moved to processing queue.',
      actor: 'Tech Liza',
      createdAt: isoAgo(2, 10, 0)
    },
    {
      id: 3,
      requestId: 1151,
      action: 'Processing Started',
      details: 'Serology sample received and processing started.',
      actor: 'Tech Carla',
      createdAt: isoAgo(1, 9, 50)
    },
    {
      id: 4,
      requestId: 1144,
      action: 'Resample Requested',
      details: 'Initial sample rejected due to contamination.',
      actor: 'Lab Manager',
      createdAt: isoAgo(2, 10, 10)
    }
  ];

  return { requests, logs };
}

function readStore(): LabStore {
  try {
    const raw = localStorage.getItem(LAB_STORE_KEY);
    if (!raw) {
      const seeded = seedStore();
      localStorage.setItem(LAB_STORE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    return JSON.parse(raw) as LabStore;
  } catch {
    const seeded = seedStore();
    localStorage.setItem(LAB_STORE_KEY, JSON.stringify(seeded));
    return seeded;
  }
}

function writeStore(store: LabStore): void {
  localStorage.setItem(LAB_STORE_KEY, JSON.stringify(store));
}

function toQueueItem(item: LabRequestDetail): LabQueueRequest {
  return {
    requestId: item.requestId,
    visitId: item.visitId,
    patientId: item.patientId,
    patientName: item.patientName,
    category: item.category,
    priority: item.priority,
    status: item.status,
    requestedAt: item.requestedAt,
    requestedByDoctor: item.requestedByDoctor
  };
}

function addLog(store: LabStore, requestId: number, action: string, details: string, actor: string): void {
  const nextId = store.logs.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  store.logs.unshift({
    id: nextId,
    requestId,
    action,
    details,
    actor,
    createdAt: nowIso()
  });
}

function updateRequest(requestId: number, updater: (item: LabRequestDetail) => LabRequestDetail): LabRequestDetail | null {
  const store = readStore();
  const idx = store.requests.findIndex((item) => item.requestId === requestId);
  if (idx < 0) return null;
  store.requests[idx] = updater(store.requests[idx]);
  writeStore(store);
  return store.requests[idx];
}

export async function createLabRequest(payload: CreateLabRequestPayload): Promise<LabRequestDetail> {
  try {
    const data = await fetchApiData<any>(resolveApiUrl(), {
      method: 'POST',
      timeoutMs: 12_000,
      body: {
        action: 'create',
        patient_name: payload.patientName,
        patient_id: payload.patientId,
        visit_id: payload.visitId,
        age: payload.age,
        sex: payload.sex,
        category: payload.category,
        priority: payload.priority,
        requested_by_doctor: payload.requestedByDoctor,
        doctor_department: payload.doctorDepartment,
        notes: payload.notes || '',
        tests: payload.tests,
        specimen_type: payload.specimenType,
        sample_source: payload.sampleSource,
        collection_date_time: payload.collectionDateTime || null,
        clinical_diagnosis: payload.clinicalDiagnosis,
        lab_instructions: payload.labInstructions || '',
        insurance_reference: payload.insuranceReference || '',
        billing_reference: payload.billingReference || '',
        assigned_lab_staff: payload.assignedLabStaff || 'Tech Anne'
      }
    });
    const created = toDetailFromApi(data);
    invalidateApiCache('/api/laboratory');
    invalidateApiCache('/api/module-activity');
    invalidateApiCache('/api/dashboard');
    invalidateApiCache('/api/reports');
    invalidateApiCache('/api/patients');
    emitRealtimeRefresh('laboratory_create');
    return created;
  } catch {
    const store = readStore();
    const nextId = Math.max(1000, ...store.requests.map((row) => row.requestId)) + 1;
    const now = nowIso();
    const created: LabRequestDetail = {
      requestId: nextId,
      visitId: payload.visitId || `VISIT-${new Date().getFullYear()}-${nextId}`,
      patientId: payload.patientId || `PAT-${nextId}`,
      patientName: payload.patientName,
      age: payload.age == null ? null : payload.age,
      sex: payload.sex || '',
      category: payload.category,
      priority: payload.priority,
      status: 'Pending',
      requestedAt: now,
      requestedByDoctor: payload.requestedByDoctor,
      doctorDepartment: payload.doctorDepartment,
      notes: payload.notes || '',
      tests: payload.tests.length ? payload.tests : [`${payload.category} request`],
      specimenType: payload.specimenType,
      sampleSource: payload.sampleSource,
      collectionDateTime: payload.collectionDateTime || null,
      clinicalDiagnosis: payload.clinicalDiagnosis,
      labInstructions: payload.labInstructions || '',
      insuranceReference: payload.insuranceReference || '',
      billingReference: payload.billingReference || '',
      assignedLabStaff: payload.assignedLabStaff || 'Tech Anne',
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
      encodedValues: {}
    };
    store.requests.unshift(created);
    addLog(store, nextId, 'Request Created', 'New lab request created from laboratory queue dashboard.', 'Lab Staff');
    writeStore(store);
    emitRealtimeRefresh('laboratory_create');
    return created;
  }
}

export async function fetchLabQueue(params: LabQueueFilterParams = {}): Promise<LabQueueRequest[]> {
  try {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.status) query.set('status', params.status);
    if (params.category) query.set('category', params.category);
    if (params.priority) query.set('priority', params.priority);
    if (params.doctor) query.set('doctor', params.doctor);
    if (params.fromDate) query.set('fromDate', params.fromDate);
    if (params.toDate) query.set('toDate', params.toDate);
    const data = await fetchApiData<any[]>(`${resolveApiUrl()}${query.toString() ? `?${query.toString()}` : ''}`, {
      ttlMs: 7_000,
      timeoutMs: 12_000
    });
    return Array.isArray(data) ? data.map((item) => toQueueFromApi(item)) : [];
  } catch {
    const store = readStore();
    const q = (params.search || '').trim().toLowerCase();
    const status = (params.status || '').trim().toLowerCase();
    const category = (params.category || '').trim().toLowerCase();
    const priority = (params.priority || '').trim().toLowerCase();
    const doctor = (params.doctor || '').trim().toLowerCase();

    return store.requests
      .filter((item) => {
        if (status && status !== 'all') {
          if (status === 'in_progress') {
            if (!(item.status === 'In Progress' || item.status === 'Result Ready')) return false;
          } else if (status === 'completed') {
            if (item.status !== 'Completed') return false;
          } else if (status === 'pending') {
            if (item.status !== 'Pending') return false;
          }
        }

        if (category && category !== 'all' && item.category.toLowerCase() !== category) return false;
        if (priority && priority !== 'all' && item.priority.toLowerCase() !== priority) return false;
        if (doctor && doctor !== 'all' && item.requestedByDoctor.toLowerCase() !== doctor) return false;
        if (!q) return true;

        const target = `${item.requestId} ${item.visitId} ${item.patientId} ${item.patientName} ${item.category} ${item.priority} ${item.status} ${item.requestedByDoctor}`.toLowerCase();
        return target.includes(q);
      })
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
      .map(toQueueItem);
  }
}

export async function fetchLabRequest(requestId: number): Promise<LabRequestDetail> {
  try {
    const data = await fetchApiData<any>(`${resolveApiUrl()}?request_id=${requestId}&mode=detail`, {
      ttlMs: 10_000,
      timeoutMs: 12_000
    });
    return toDetailFromApi(data);
  } catch {
    const store = readStore();
    const item = store.requests.find((entry) => entry.requestId === requestId);
    if (!item) {
      throw 'Laboratory request not found.';
    }
    return { ...item };
  }
}

export async function fetchLabActivity(requestId: number): Promise<LabActivityLog[]> {
  try {
    const data = await fetchApiData<any[]>(`${resolveApiUrl()}?request_id=${requestId}&mode=activity`, {
      ttlMs: 7_000,
      timeoutMs: 12_000
    });
    return Array.isArray(data)
      ? data.map((item) => ({
          id: Number(item.id || 0),
          requestId: Number(item.request_id || item.requestId || 0),
          action: String(item.action || ''),
          details: String(item.details || ''),
          actor: String(item.actor || ''),
          createdAt: String(item.created_at || item.createdAt || '')
        }))
      : [];
  } catch {
    const store = readStore();
    return store.logs.filter((item) => item.requestId === requestId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function startLabProcessing(payload: StartProcessingPayload): Promise<LabRequestDetail | null> {
  try {
    const data = await fetchApiData<any>(resolveApiUrl(), {
      method: 'POST',
      timeoutMs: 12_000,
      body: {
        action: 'start_processing',
        request_id: payload.requestId,
        lab_staff: payload.labStaff,
        sample_collected: payload.sampleCollected,
        sample_collected_at: payload.sampleCollectedAt,
        processing_started_at: payload.processingStartedAt,
        specimen_type: payload.specimenType,
        sample_source: payload.sampleSource,
        collection_date_time: payload.collectionDateTime
      }
    });
    const updated = data ? toDetailFromApi(data) : null;
    invalidateApiCache('/api/laboratory');
    invalidateApiCache('/api/module-activity');
    invalidateApiCache('/api/dashboard');
    invalidateApiCache('/api/reports');
    invalidateApiCache('/api/patients');
    if (updated) emitRealtimeRefresh('laboratory_start_processing');
    return updated;
  } catch {
    const store = readStore();
    const idx = store.requests.findIndex((item) => item.requestId === payload.requestId);
    if (idx < 0) return null;

    store.requests[idx] = {
      ...store.requests[idx],
      status: 'In Progress',
      assignedLabStaff: payload.labStaff || store.requests[idx].assignedLabStaff,
      sampleCollected: payload.sampleCollected,
      sampleCollectedAt: payload.sampleCollected ? payload.sampleCollectedAt || nowIso() : null,
      processingStartedAt: payload.processingStartedAt || nowIso(),
      specimenType: payload.specimenType || store.requests[idx].specimenType,
      sampleSource: payload.sampleSource || store.requests[idx].sampleSource,
      collectionDateTime: payload.collectionDateTime ?? store.requests[idx].collectionDateTime
    };

    addLog(store, payload.requestId, 'Processing Started', 'Sample collected and processing started.', payload.labStaff || 'Lab Staff');
    writeStore(store);
    emitRealtimeRefresh('laboratory_start_processing');
    return { ...store.requests[idx] };
  }
}

export async function saveLabResults(payload: SaveResultsPayload): Promise<LabRequestDetail | null> {
  try {
    const data = await fetchApiData<any>(resolveApiUrl(), {
      method: 'POST',
      timeoutMs: 12_000,
      body: {
        action: 'save_results',
        request_id: payload.requestId,
        summary: payload.summary,
        encoded_values: payload.encodedValues,
        attachment_name: payload.attachmentName,
        finalize: payload.finalize,
        result_encoded_at: payload.resultEncodedAt,
        result_reference_range: payload.resultReferenceRange,
        verified_by: payload.verifiedBy
      }
    });
    const updated = data ? toDetailFromApi(data) : null;
    invalidateApiCache('/api/laboratory');
    invalidateApiCache('/api/module-activity');
    invalidateApiCache('/api/dashboard');
    invalidateApiCache('/api/reports');
    invalidateApiCache('/api/patients');
    if (updated) emitRealtimeRefresh(payload.finalize ? 'laboratory_finalize_results' : 'laboratory_save_draft');
    return updated;
  } catch {
    const store = readStore();
    const idx = store.requests.findIndex((item) => item.requestId === payload.requestId);
    if (idx < 0) return null;

    const current = store.requests[idx];
    const nextStatus: LabStatus = payload.finalize ? 'Result Ready' : 'In Progress';
    const nextEncodedAt = payload.finalize ? payload.resultEncodedAt || nowIso() : current.resultEncodedAt;

    store.requests[idx] = {
      ...current,
      status: nextStatus,
      rawAttachmentName: payload.attachmentName || current.rawAttachmentName,
      encodedValues: { ...payload.encodedValues },
      resultEncodedAt: nextEncodedAt,
      resultReferenceRange: payload.resultReferenceRange ?? current.resultReferenceRange,
      verifiedBy: payload.finalize ? payload.verifiedBy || current.assignedLabStaff || current.verifiedBy : current.verifiedBy,
      verifiedAt: payload.finalize ? nowIso() : current.verifiedAt
    };

    addLog(
      store,
      payload.requestId,
      payload.finalize ? 'Result Finalized' : 'Draft Saved',
      payload.summary || (payload.finalize ? 'Result is now ready for release.' : 'Encoded result draft saved.'),
      current.assignedLabStaff || 'Lab Staff'
    );
    writeStore(store);
    emitRealtimeRefresh(payload.finalize ? 'laboratory_finalize_results' : 'laboratory_save_draft');
    return { ...store.requests[idx] };
  }
}

export async function releaseLabReport(payload: ReleaseReportPayload): Promise<LabRequestDetail | null> {
  try {
    const data = await fetchApiData<any>(resolveApiUrl(), {
      method: 'POST',
      timeoutMs: 12_000,
      body: {
        action: 'release',
        request_id: payload.requestId,
        released_by: payload.releasedBy,
        released_at: payload.releasedAt
      }
    });
    const updated = data ? toDetailFromApi(data) : null;
    invalidateApiCache('/api/laboratory');
    invalidateApiCache('/api/module-activity');
    invalidateApiCache('/api/dashboard');
    invalidateApiCache('/api/reports');
    invalidateApiCache('/api/patients');
    if (updated) emitRealtimeRefresh('laboratory_release');
    return updated;
  } catch {
    const store = readStore();
    const idx = store.requests.findIndex((item) => item.requestId === payload.requestId);
    if (idx < 0) return null;
    const current = store.requests[idx];
    if (current.status !== 'Result Ready') return null;

    store.requests[idx] = {
      ...current,
      status: 'Completed',
      releasedAt: payload.releasedAt || nowIso()
    };

    addLog(store, payload.requestId, 'Report Released', 'Lab report released to doctor/check-up.', payload.releasedBy || 'Lab Staff');
    writeStore(store);
    emitRealtimeRefresh('laboratory_release');
    return { ...store.requests[idx] };
  }
}

export async function rejectLabRequest(payload: { requestId: number; reason: string; resampleFlag: boolean; actor: string }): Promise<LabRequestDetail | null> {
  try {
    const data = await fetchApiData<any>(resolveApiUrl(), {
      method: 'POST',
      timeoutMs: 12_000,
      body: {
        action: 'reject',
        request_id: payload.requestId,
        reason: payload.reason,
        resample_flag: payload.resampleFlag,
        actor: payload.actor
      }
    });
    const updated = data ? toDetailFromApi(data) : null;
    invalidateApiCache('/api/laboratory');
    invalidateApiCache('/api/module-activity');
    invalidateApiCache('/api/dashboard');
    invalidateApiCache('/api/reports');
    invalidateApiCache('/api/patients');
    if (updated) emitRealtimeRefresh(payload.resampleFlag ? 'laboratory_resample' : 'laboratory_reject');
    return updated;
  } catch {
    const store = readStore();
    const idx = store.requests.findIndex((item) => item.requestId === payload.requestId);
    if (idx < 0) return null;
    const current = store.requests[idx];
    store.requests[idx] = {
      ...current,
      status: 'Cancelled',
      rejectionReason: payload.reason,
      resampleFlag: payload.resampleFlag
    };
    addLog(
      store,
      payload.requestId,
      payload.resampleFlag ? 'Resample Requested' : 'Request Rejected',
      payload.reason || 'Request rejected by lab staff.',
      payload.actor || 'Lab Staff'
    );
    writeStore(store);
    emitRealtimeRefresh(payload.resampleFlag ? 'laboratory_resample' : 'laboratory_reject');
    return { ...store.requests[idx] };
  }
}
