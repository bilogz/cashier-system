import { dispatchDepartmentFlow, getFlowEventStatus, type FlowEventStatus } from '@/services/departmentIntegration';

export type ComlabPaymentConfirmation = {
  reference_no: string;
  payment_status: 'paid' | 'partial' | 'pending' | 'refunded' | 'cancelled';
  official_receipt?: string;
  amount_paid?: number;
  cleared_at?: string;
  student_id?: string;
  student_name?: string;
  lab_name?: string;
  notes?: string;
};

export type ComlabPaymentResult = FlowEventStatus & {
  confirmation?: ComlabPaymentConfirmation;
};

export async function dispatchPaymentConfirmationToComlab(
  confirmation: ComlabPaymentConfirmation,
  sourceRecordId?: string
): Promise<ComlabPaymentResult> {
  const payload: Record<string, unknown> = {
    reference_no: confirmation.reference_no,
    payment_status: confirmation.payment_status,
    official_receipt: confirmation.official_receipt,
    amount_paid: confirmation.amount_paid,
    cleared_at: confirmation.cleared_at || (confirmation.payment_status === 'paid' ? new Date().toISOString() : null),
    student_id: confirmation.student_id,
    student_name: confirmation.student_name,
    lab_name: confirmation.lab_name,
    notes: confirmation.notes
  };

  const result = await dispatchDepartmentFlow(
    'cashier',
    'comlab',
    'payment_confirmation',
    payload,
    sourceRecordId
  );

  if (result.ok && result.correlation_id) {
    const status = await getFlowEventStatus(undefined, result.correlation_id);
    return {
      ...status,
      confirmation
    };
  }

  return {
    ok: false,
    last_error: result.message || 'Failed to dispatch payment confirmation to COMLAB'
  } as ComlabPaymentResult;
}

export async function notifyComlabLabFeePayment(
  referenceNo: string,
  paymentStatus: ComlabPaymentConfirmation['payment_status'],
  officialReceipt?: string,
  amountPaid?: number,
  studentName?: string
): Promise<ComlabPaymentResult> {
  return dispatchPaymentConfirmationToComlab({
    reference_no: referenceNo,
    payment_status: paymentStatus,
    official_receipt: officialReceipt,
    amount_paid: amountPaid,
    student_name: studentName
  });
}
