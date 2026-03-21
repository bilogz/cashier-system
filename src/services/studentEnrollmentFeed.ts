import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type EnrollmentFeedStatCard = {
  title: string;
  value: string;
  subtitle: string;
  icon: string;
  tone: 'green' | 'blue' | 'orange' | 'purple';
};

export type EnrollmentFeedItem = {
  id: number;
  batchId: string;
  source: string;
  office: string;
  studentNo: string;
  studentName: string;
  classCode: string;
  subject: string;
  academicYear: string;
  semester: string;
  status: string;
  downpaymentAmount: number;
  downpaymentAmountFormatted: string;
  payload: Record<string, unknown> | null;
  decisionNotes?: string;
  actionBy?: string;
  actionAt?: string | null;
  lastAction?: string;
  billingId?: number | null;
  billingCode?: string;
  billingStatus?: string;
  billingWorkflowStage?: string | null;
  billingWorkflowStageLabel?: string;
  nextStep?: string;
  queueBucket?: 'pending' | 'approved' | 'hold' | 'returned';
  sentAt: string | null;
  createdAt: string | null;
};

export type EnrollmentFeedSnapshot = {
  stats: EnrollmentFeedStatCard[];
  items: EnrollmentFeedItem[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
  filters: {
    statuses: string[];
    semesters: string[];
    sources: string[];
    offices: string[];
  };
};

export type EnrollmentFeedQuery = {
  search?: string;
  status?: string;
  semester?: string;
  source?: string;
  office?: string;
  page?: number;
  perPage?: number;
};

export type EnrollmentFeedUpsertPayload = {
  id?: number;
  batchId?: string;
  source?: string;
  office?: string;
  studentNo?: string;
  studentName?: string;
  classCode?: string;
  subject?: string;
  academicYear?: string;
  semester?: string;
  status?: string;
  downpaymentAmount?: number;
};

export type EnrollmentFeedDecisionAction = 'approve' | 'hold' | 'return';

export type EnrollmentFeedDecisionPayload = {
  id: number;
  action: EnrollmentFeedDecisionAction;
  remarks?: string;
  reason?: string;
};

export type EnrollmentFeedDecisionResponse = {
  message: string;
  status: string;
  workflow_stage: string;
  next_module: string;
  billingId?: number | null;
  billingCode?: string | null;
  item?: EnrollmentFeedItem | null;
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const directApi = import.meta.env.VITE_STUDENT_ENROLLMENT_FEED_API_URL?.trim();
  if (directApi) return trimTrailingSlashes(directApi);

  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) {
    return `${trimTrailingSlashes(configured)}/cashier-registrar-student-enrollment-feed`;
  }

  return '/api/cashier-registrar-student-enrollment-feed';
}

function buildUrl(query: EnrollmentFeedQuery = {}): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    params.set(key === 'perPage' ? 'per_page' : key, String(value));
  });
  const suffix = params.toString();
  const base = resolveApiUrl();
  return suffix ? `${base}?${suffix}` : base;
}

export async function fetchEnrollmentFeedSnapshot(query: EnrollmentFeedQuery = {}): Promise<EnrollmentFeedSnapshot> {
  return await fetchApiData<EnrollmentFeedSnapshot>(buildUrl(query), { ttlMs: 8_000 });
}

function invalidateEnrollmentFeedCache(): void {
  invalidateApiCache('/api/cashier-registrar-student-enrollment-feed');
  invalidateApiCache('/cashier-registrar-student-enrollment-feed');
  invalidateApiCache('/api/student-billing');
  invalidateApiCache('/student-billing');
  invalidateApiCache('/api/module-activity');
  invalidateApiCache('/module-activity');
  invalidateApiCache('/api/notifications');
  invalidateApiCache('/notifications');
}

export async function createEnrollmentFeedRecord(payload: EnrollmentFeedUpsertPayload): Promise<EnrollmentFeedItem> {
  const data = await fetchApiData<EnrollmentFeedItem>(resolveApiUrl(), {
    method: 'POST',
    body: {
      action: 'create',
      ...payload
    }
  });
  invalidateEnrollmentFeedCache();
  return data;
}

export async function updateEnrollmentFeedRecord(payload: EnrollmentFeedUpsertPayload): Promise<EnrollmentFeedItem> {
  const data = await fetchApiData<EnrollmentFeedItem>(resolveApiUrl(), {
    method: 'POST',
    body: {
      action: 'update',
      ...payload
    }
  });
  invalidateEnrollmentFeedCache();
  return data;
}

export async function deleteEnrollmentFeedRecord(id: number): Promise<{ id: number }> {
  const data = await fetchApiData<{ id: number }>(resolveApiUrl(), {
    method: 'POST',
    body: {
      action: 'delete',
      id
    }
  });
  invalidateEnrollmentFeedCache();
  return data;
}

export async function applyEnrollmentFeedDecision(payload: EnrollmentFeedDecisionPayload): Promise<EnrollmentFeedDecisionResponse> {
  const data = await fetchApiData<EnrollmentFeedDecisionResponse>(resolveApiUrl(), {
    method: 'POST',
    body: payload
  });
  invalidateEnrollmentFeedCache();
  return data;
}
