import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type CrudWorkflowResponse = {
  message: string;
  status?: string;
  workflow_stage?: string;
  next_module?: string;
  receipt_no?: string;
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(segment: string): string {
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

async function postAction<T>(segment: string, body: Record<string, unknown>): Promise<T> {
  const data = await fetchApiData<T>(resolveApiUrl(segment), {
    method: 'POST',
    body
  });
  invalidateWorkflowCaches();
  return data;
}

async function patchAction<T>(segment: string, body: Record<string, unknown>): Promise<T> {
  const data = await fetchApiData<T>(resolveApiUrl(segment), {
    method: 'PATCH',
    body
  });
  invalidateWorkflowCaches();
  return data;
}

async function putAction<T>(segment: string, body: Record<string, unknown>): Promise<T> {
  const data = await fetchApiData<T>(resolveApiUrl(segment), {
    method: 'PUT',
    body
  });
  invalidateWorkflowCaches();
  return data;
}

async function deleteAction<T>(segment: string): Promise<T> {
  const data = await fetchApiData<T>(resolveApiUrl(segment), {
    method: 'DELETE'
  });
  invalidateWorkflowCaches();
  return data;
}

export async function sendWorkflowNotification(payload: {
  billingId: number;
  recipient: string;
  subject: string;
  message: string;
}) {
  return await postAction<{ billingId: number | null; recipient: string; subject: string; message: string }>('notifications/send', {
    billingId: payload.billingId,
    recipient: payload.recipient,
    subject: payload.subject,
    message: payload.message
  });
}

export async function createApprovedPaymentRequest(payload: {
  billingId: number;
  amount: number;
  paymentMethod: string;
  allocationMode: string;
  allocations: Array<{ billingItemId: number; allocatedAmount: number }>;
  remarks: string;
}): Promise<CrudWorkflowResponse> {
  return await postAction<CrudWorkflowResponse>('payments/approve', {
    billingId: payload.billingId,
    amount: payload.amount,
    paymentMethod: payload.paymentMethod,
    allocationMode: payload.allocationMode,
    allocations: payload.allocations,
    remarks: payload.remarks
  });
}

export async function markPayBillsFailed(payload: {
  billingId: number;
  reason: string;
  remarks: string;
}): Promise<CrudWorkflowResponse> {
  return await postAction<CrudWorkflowResponse>(`payments/${payload.billingId}/mark-failed`, {
    reason: payload.reason,
    remarks: payload.remarks
  });
}

export async function createInstallmentArrangement(payload: {
  billingId: number;
  installmentAmount: number;
  installmentCount: number;
  dueSchedule: string;
  paymentMethod: string;
  allocationMode: string;
  allocations: Array<{ billingItemId: number; allocatedAmount: number }>;
  remarks: string;
}) {
  return await postAction<CrudWorkflowResponse>('installments', {
    billingId: payload.billingId,
    installmentAmount: payload.installmentAmount,
    installmentCount: payload.installmentCount,
    dueSchedule: payload.dueSchedule,
    paymentMethod: payload.paymentMethod,
    allocationMode: payload.allocationMode,
    allocations: payload.allocations,
    remarks: payload.remarks
  });
}

export async function updateInstallmentArrangement(payload: {
  installmentId: number;
  installmentAmount: number;
  installmentCount: number;
  dueSchedule: string;
  remarks: string;
}) {
  return await putAction<{ id: number }>(`installments/${payload.installmentId}`, {
    installmentAmount: payload.installmentAmount,
    installmentCount: payload.installmentCount,
    dueSchedule: payload.dueSchedule,
    remarks: payload.remarks
  });
}

export async function archiveInstallmentArrangement(installmentId: number) {
  return await deleteAction<{ id: number }>(`installments/${installmentId}`);
}

export async function authorizeGatewayPayment(payload: {
  paymentId: number;
  gatewayRemarks: string;
  authorizationNotes: string;
}): Promise<CrudWorkflowResponse> {
  return await patchAction<CrudWorkflowResponse>(`payment-transactions/${payload.paymentId}/authorize`, {
    remarks: payload.gatewayRemarks,
    authorizationNotes: payload.authorizationNotes
  });
}

export async function verifyComplianceProof(payload: {
  paymentId: number;
  proofType: string;
  verificationNotes: string;
  verifiedBy: string;
  decision: string;
}): Promise<CrudWorkflowResponse> {
  return await postAction<CrudWorkflowResponse>(`compliance/${payload.paymentId}/verify-proof`, {
    proofType: payload.proofType,
    verificationNotes: payload.verificationNotes,
    verifiedBy: payload.verifiedBy,
    decision: payload.decision
  });
}

export async function completeComplianceDocumentation(payload: {
  paymentId: number;
  completionNotes: string;
  checklistSummary: string;
  finalDecision: string;
}): Promise<CrudWorkflowResponse> {
  return await postAction<CrudWorkflowResponse>(`compliance/${payload.paymentId}/complete`, {
    completionNotes: payload.completionNotes,
    checklistSummary: payload.checklistSummary,
    finalDecision: payload.finalDecision
  });
}

export async function reportReconciliationRecord(payload: {
  paymentId: number;
  remarks: string;
}): Promise<CrudWorkflowResponse> {
  return await postAction<CrudWorkflowResponse>('reporting-reconciliation', {
    paymentId: payload.paymentId,
    action: 'report',
    remarks: payload.remarks
  });
}

export async function archiveReconciliationRecord(payload: {
  paymentId: number;
  remarks: string;
}): Promise<CrudWorkflowResponse> {
  return await postAction<CrudWorkflowResponse>(`reconciliation/${payload.paymentId}/archive`, {
    remarks: payload.remarks
  });
}

export async function flagReconciliationDiscrepancy(payload: {
  paymentId: number;
  discrepancyType: string;
  reason: string;
  notes: string;
}): Promise<CrudWorkflowResponse> {
  return await postAction<CrudWorkflowResponse>(`reconciliation/${payload.paymentId}/flag-discrepancy`, {
    note: [payload.discrepancyType, payload.reason, payload.notes].filter(Boolean).join(' | ')
  });
}
