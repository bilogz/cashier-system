import { fetchApiData } from '@/services/apiClient';

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
