import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type StudentAccountStatement = {
  student: {
    id: number;
    studentNumber: string;
    fullName: string;
    program: string;
    yearLevel: string;
    email?: string;
    phone?: string;
    status: string;
  };
  summary: {
    totalAssessment: number;
    totalAssessmentFormatted: string;
    totalPaid: number;
    totalPaidFormatted: string;
    totalBalance: number;
    totalBalanceFormatted: string;
  };
  billings: StudentBillingRecord[];
};

export type StudentBillingRecord = {
  id: number;
  studentId: number;
  studentName: string;
  studentNumber: string;
  billingCode: string;
  invoiceNumber: string;
  term: string;
  semester: string;
  schoolYear: string;
  program: string;
  totalAmount: number;
  totalAmountFormatted: string;
  paidAmount: number;
  paidAmountFormatted: string;
  balanceAmount: number;
  balanceAmountFormatted: string;
  status: string;
  paymentEligible: boolean;
  dueDate: string;
  dueDateFormatted: string;
  items: Array<{
    id: number;
    code: string;
    name: string;
    category: string;
    amount: number;
    amountFormatted: string;
    sortOrder: number;
    createdAt: string;
  }>;
};

export type StudentReceiptRecord = {
  id: number;
  receiptNumber: string;
  billingId: number;
  billingCode: string;
  paymentReference: string;
  amount: number;
  amountFormatted: string;
  paymentMethod: string;
  status: string;
  issuedDate: string;
  issuedDateFormatted: string;
  remarks?: string;
};

export type PaymentMethodOption = {
  code: string;
  label: string;
  category: string;
};

export async function fetchStudentAccountStatement(): Promise<StudentAccountStatement> {
  return await fetchApiData<StudentAccountStatement>('/api/student/account-statement', { ttlMs: 8_000 });
}

export async function fetchStudentBillings(): Promise<StudentBillingRecord[]> {
  const data = await fetchApiData<{ items: StudentBillingRecord[] }>('/api/student/billings', { ttlMs: 8_000 });
  return data.items || [];
}

export async function fetchStudentInvoices(): Promise<StudentBillingRecord[]> {
  const data = await fetchApiData<{ items: StudentBillingRecord[] }>('/api/student/invoices', { ttlMs: 8_000 });
  return data.items || [];
}

export async function fetchStudentReceipts(): Promise<StudentReceiptRecord[]> {
  const data = await fetchApiData<{ items: StudentReceiptRecord[] }>('/api/student/receipts', { ttlMs: 8_000 });
  return data.items || [];
}

export async function fetchStudentPayables(): Promise<StudentBillingRecord[]> {
  const data = await fetchApiData<{ items: StudentBillingRecord[] }>('/api/billings/payable', { ttlMs: 8_000 });
  return data.items || [];
}

export async function fetchStudentPaymentMethods(): Promise<PaymentMethodOption[]> {
  const data = await fetchApiData<{ items: PaymentMethodOption[] }>('/api/student/payment-methods', { ttlMs: 60_000 });
  return data.items || [];
}

export async function initiateStudentPayment(payload: {
  billingId: number;
  amount: number;
  paymentMethod: string;
}): Promise<{ id: number; referenceNumber: string; status: string; billingCode: string }> {
  const data = await fetchApiData<{ id: number; referenceNumber: string; status: string; billingCode: string }>('/api/payments/initiate', {
    method: 'POST',
    body: payload
  });
  invalidateApiCache('/api/student/account-statement');
  invalidateApiCache('/api/student/billings');
  invalidateApiCache('/api/student/invoices');
  invalidateApiCache('/api/student/receipts');
  invalidateApiCache('/api/billings/payable');
  invalidateApiCache('/api/dashboard/summary');
  invalidateApiCache('/api/dashboard/activity');
  invalidateApiCache('/api/dashboard/recent-activities');
  return data;
}

export async function setupStudentAutoDebit(payload: {
  billingId: number;
  accountName: string;
  bankName?: string;
  accountMask?: string;
  frequency?: string;
}): Promise<void> {
  await fetchApiData<Record<string, never>>('/api/payments/auto-debit', {
    method: 'POST',
    body: payload
  });
  invalidateApiCache('/api/billings/payable');
}
