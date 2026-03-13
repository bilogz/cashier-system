import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type WorkflowCorrectionModule =
  | 'student_portal_billing'
  | 'pay_bills'
  | 'payment_processing_gateway'
  | 'compliance_documentation'
  | 'reporting_reconciliation';

export type WorkflowCorrectionResponse = {
  message: string;
  status: string;
  workflow_stage: string;
  returned_to: string;
  next_module: string;
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(recordId: number): string {
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/workflow/${recordId}/return-for-correction`;
  return `/api/workflow/${recordId}/return-for-correction`;
}

export async function returnWorkflowRecordForCorrection(payload: {
  recordId: number;
  currentModule: WorkflowCorrectionModule;
  reason: string;
  remarks?: string;
}): Promise<WorkflowCorrectionResponse> {
  const data = await fetchApiData<WorkflowCorrectionResponse>(resolveApiUrl(payload.recordId), {
    method: 'POST',
    body: {
      current_module: payload.currentModule,
      reason: payload.reason,
      remarks: payload.remarks || ''
    }
  });

  invalidateApiCache('/api/student-billing');
  invalidateApiCache('/student-billing');
  invalidateApiCache('/api/process-payment');
  invalidateApiCache('/process-payment');
  invalidateApiCache('/api/generate-receipt');
  invalidateApiCache('/generate-receipt');
  invalidateApiCache('/api/reporting-reconciliation');
  invalidateApiCache('/reporting-reconciliation');
  invalidateApiCache('/api/payables');
  invalidateApiCache('/api/billings');
  invalidateApiCache('/api/payment-transactions');
  invalidateApiCache('/api/receipts');
  invalidateApiCache('/api/reconciliation');
  invalidateApiCache('/api/reports/transactions');
  invalidateApiCache('/api/dashboard/summary');
  invalidateApiCache('/api/dashboard/recent-activities');
  invalidateApiCache('/api/dashboard/alerts');
  invalidateApiCache('/api/notifications');
  invalidateApiCache('/api/audit-logs');
  return data;
}
