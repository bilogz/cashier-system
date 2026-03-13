export type SuccessModalTone = 'success' | 'info' | 'warning';

export type SuccessModalPayload = {
  title?: string;
  message: string;
  tone?: SuccessModalTone;
};

const EVENT_NAME = 'nexora:success-modal';

export function emitSuccessModal(payload: SuccessModalPayload): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<SuccessModalPayload>(EVENT_NAME, {
      detail: payload
    })
  );
}

export function successModalEventName(): string {
  return EVENT_NAME;
}

