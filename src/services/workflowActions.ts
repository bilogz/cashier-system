import { fetchApiData, invalidateApiCache } from '@/services/apiClient';
import type { WorkflowCorrectionModule } from '@/services/workflowCorrections';

export type WorkflowActionResponse = {
  message: string;
  status: string;
  workflow_stage: string;
  next_module: string;
  receipt_no?: string;
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveWorkflowUrl(recordId: number, action: string): string {
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/workflow/${recordId}/${action}`;
  return `/api/workflow/${recordId}/${action}`;
}

function resolveModuleUrl(segment: string): string {
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/${segment}`;
  return `/api/${segment}`;
}

function invalidateWorkflowCaches() {
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
}

async function postWorkflowAction(recordId: number, action: string, body: Record<string, unknown>): Promise<WorkflowActionResponse> {
  const data = await fetchApiData<WorkflowActionResponse>(resolveWorkflowUrl(recordId, action), {
    method: 'POST',
    body
  });
  invalidateWorkflowCaches();
  return data;
}

async function postModuleAction(url: string, body: Record<string, unknown>): Promise<WorkflowActionResponse> {
  const data = await fetchApiData<WorkflowActionResponse>(resolveModuleUrl(url), {
    method: 'POST',
    body
  });
  invalidateWorkflowCaches();
  return data;
}

async function patchModuleAction(url: string, body: Record<string, unknown>): Promise<WorkflowActionResponse> {
  const data = await fetchApiData<WorkflowActionResponse>(resolveModuleUrl(url), {
    method: 'PATCH',
    body
  });
  invalidateWorkflowCaches();
  return data;
}

export async function verifyWorkflowRecord(payload: {
  recordId: number;
  currentModule: WorkflowCorrectionModule;
  remarks?: string;
  validationChecklist?: string;
  studentProfileCheck?: string;
  feeBreakdownCheck?: string;
  paymentEligibilityCheck?: string;
  duplicateBillingCheck?: string;
}): Promise<WorkflowActionResponse> {
  return await postModuleAction(`billings/${payload.recordId}/verify`, {
    current_module: payload.currentModule,
    remarks: payload.remarks || '',
    validation_checklist: payload.validationChecklist || '',
    student_profile_check: payload.studentProfileCheck || '',
    fee_breakdown_check: payload.feeBreakdownCheck || '',
    payment_eligibility_check: payload.paymentEligibilityCheck || '',
    duplicate_billing_check: payload.duplicateBillingCheck || ''
  });
}

export async function approveWorkflowRecord(payload: {
  recordId: number;
  currentModule: WorkflowCorrectionModule;
  paymentMethod?: string;
  remarks?: string;
}): Promise<WorkflowActionResponse> {
  return await postModuleAction('payments/approve', {
    billingId: payload.recordId,
    current_module: payload.currentModule,
    payment_method: payload.paymentMethod || 'Online',
    remarks: payload.remarks || ''
  });
}

export async function confirmPaidWorkflowRecord(payload: {
  recordId: number;
  currentModule: WorkflowCorrectionModule;
  remarks?: string;
}): Promise<WorkflowActionResponse> {
  return await patchModuleAction(`payment-transactions/${payload.recordId}/confirm-paid`, {
    current_module: payload.currentModule,
    remarks: payload.remarks || ''
  });
}

export async function generateReceiptWorkflowRecord(payload: {
  recordId: number;
  currentModule: WorkflowCorrectionModule;
  receiptType?: string;
  remarks?: string;
}): Promise<WorkflowActionResponse> {
  return await postModuleAction('receipts/generate', {
    paymentId: payload.recordId,
    current_module: payload.currentModule,
    receipt_type: payload.receiptType || 'Official Receipt',
    remarks: payload.remarks || ''
  });
}

export async function reconcileWorkflowRecord(payload: {
  recordId: number;
  currentModule: WorkflowCorrectionModule;
  remarks?: string;
}): Promise<WorkflowActionResponse> {
  return await postModuleAction(`reconciliation/${payload.recordId}/reconcile`, {
    current_module: payload.currentModule,
    remarks: payload.remarks || ''
  });
}
