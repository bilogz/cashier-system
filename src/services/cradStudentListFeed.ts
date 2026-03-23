import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type CradPaidStudentItem = {
  enrollmentFeedId: number;
  billingId: number | null;
  batchId: string;
  studentNo: string;
  studentName: string;
  semester: string;
  academicYear: string;
  downpaymentAmount: number;
  downpaymentAmountFormatted: string;
  paidAmount: number;
  paidAmountFormatted: string;
  alreadySent: boolean;
  sentAt: string | null;
};

export type CradSentStudentItem = {
  id: number;
  enrollmentFeedId: number | null;
  studentNo: string;
  studentName: string;
  semester: string;
  academicYear: string;
  downpaymentAmount: number;
  downpaymentAmountFormatted: string;
  paidAmount: number;
  paidAmountFormatted: string;
  status: string;
  sentAt: string | null;
};

export type CradStudentListFeedSnapshot = {
  stats: Array<{ title: string; value: string; subtitle: string; icon: string; tone: 'green' | 'blue' | 'orange' | 'purple' }>;
  eligibleItems: CradPaidStudentItem[];
  sentItems: CradSentStudentItem[];
};

function resolveApiUrl(): string {
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${configured.replace(/\/+$/, '')}/crad-student-list-feed`;
  return '/api/crad-student-list-feed';
}

export async function fetchCradStudentListFeedSnapshot(): Promise<CradStudentListFeedSnapshot> {
  return await fetchApiData<CradStudentListFeedSnapshot>(resolveApiUrl(), { ttlMs: 8_000 });
}

export async function sendPaidStudentToCradStudentListFeed(enrollmentFeedId: number): Promise<{ id: number; message?: string }> {
  const data = await fetchApiData<{ id: number; message?: string }>(resolveApiUrl(), {
    method: 'POST',
    body: {
      action: 'send',
      enrollmentFeedId
    }
  });

  invalidateApiCache('/api/crad-student-list-feed');
  invalidateApiCache('/crad-student-list-feed');
  return data;
}
