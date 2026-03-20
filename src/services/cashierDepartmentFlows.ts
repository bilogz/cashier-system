import { dispatchDepartmentFlow, getFlowEventStatus, type FlowEventStatus } from '@/services/departmentIntegration';

type TrackedCashierDispatch<T> = FlowEventStatus & {
  payload?: T;
};

export type CashierDepartmentTarget =
  | 'clinic'
  | 'pmed'
  | 'registrar'
  | 'hr'
  | 'admin_reports';

async function trackCashierDispatch<T>(
  targetDepartment: CashierDepartmentTarget,
  payload: Record<string, unknown>,
  sourceRecordId: string | undefined,
  attachment: T,
  fallbackMessage: string
): Promise<TrackedCashierDispatch<T>> {
  const result = await dispatchDepartmentFlow('cashier', targetDepartment, 'payment_status', payload, sourceRecordId);

  if (result.ok && result.correlation_id) {
    const status = await getFlowEventStatus(undefined, result.correlation_id);
    return {
      ...status,
      payload: attachment
    };
  }

  return {
    ok: false,
    last_error: result.message || fallbackMessage,
    payload: attachment
  };
}

export type CashierPaymentStatusUpdate = {
  reference_no: string;
  payment_status: 'paid' | 'partial' | 'unpaid' | 'void' | 'pending';
  official_receipt?: string;
  amount_paid?: number;
  balance_due?: number;
  cleared_at?: string;
  cleared_flag?: boolean;
};

export async function dispatchPaymentStatusToClinic(
  update: CashierPaymentStatusUpdate,
  sourceRecordId?: string
): Promise<TrackedCashierDispatch<CashierPaymentStatusUpdate>> {
  return await trackCashierDispatch(
    'clinic',
    {
      reference_no: update.reference_no,
      payment_status: update.payment_status,
      official_receipt: update.official_receipt,
      amount_paid: update.amount_paid,
      balance_due: update.balance_due,
      cleared_at: update.cleared_at,
      cleared_flag: update.cleared_flag
    },
    sourceRecordId,
    update,
    'Failed to dispatch payment status to Clinic.'
  );
}

export async function dispatchPaymentStatusToPmed(
  update: CashierPaymentStatusUpdate,
  sourceRecordId?: string
): Promise<TrackedCashierDispatch<CashierPaymentStatusUpdate>> {
  return await trackCashierDispatch(
    'pmed',
    {
      reference_no: update.reference_no,
      payment_status: update.payment_status,
      official_receipt: update.official_receipt,
      amount_paid: update.amount_paid,
      balance_due: update.balance_due,
      cleared_at: update.cleared_at,
      cleared_flag: update.cleared_flag
    },
    sourceRecordId,
    update,
    'Failed to dispatch payment status to PMED.'
  );
}

export async function dispatchPaymentStatusToRegistrar(
  update: CashierPaymentStatusUpdate,
  sourceRecordId?: string
): Promise<TrackedCashierDispatch<CashierPaymentStatusUpdate>> {
  return await trackCashierDispatch(
    'registrar',
    {
      reference_no: update.reference_no,
      payment_status: update.payment_status,
      official_receipt: update.official_receipt,
      amount_paid: update.amount_paid,
      balance_due: update.balance_due,
      cleared_at: update.cleared_at,
      cleared_flag: update.cleared_flag
    },
    sourceRecordId,
    update,
    'Failed to dispatch payment status to Registrar.'
  );
}

export async function dispatchPaymentStatusToHr(
  update: CashierPaymentStatusUpdate,
  sourceRecordId?: string
): Promise<TrackedCashierDispatch<CashierPaymentStatusUpdate>> {
  return await trackCashierDispatch(
    'hr',
    {
      reference_no: update.reference_no,
      payment_status: update.payment_status,
      official_receipt: update.official_receipt,
      amount_paid: update.amount_paid,
      balance_due: update.balance_due,
      cleared_at: update.cleared_at,
      cleared_flag: update.cleared_flag
    },
    sourceRecordId,
    update,
    'Failed to dispatch payment status to HR.'
  );
}

export async function dispatchPaymentStatusToAdminReports(
  update: CashierPaymentStatusUpdate,
  sourceRecordId?: string
): Promise<TrackedCashierDispatch<CashierPaymentStatusUpdate>> {
  return await trackCashierDispatch(
    'admin_reports',
    {
      reference_no: update.reference_no,
      payment_status: update.payment_status,
      official_receipt: update.official_receipt,
      amount_paid: update.amount_paid,
      balance_due: update.balance_due,
      cleared_at: update.cleared_at,
      cleared_flag: update.cleared_flag
    },
    sourceRecordId,
    update,
    'Failed to dispatch payment status to Admin Reports.'
  );
}
