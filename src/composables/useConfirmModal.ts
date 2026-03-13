export type ConfirmModalTone = 'primary' | 'warning' | 'danger';

export type ConfirmModalRequest = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmModalTone;
};

type ConfirmModalEventPayload = ConfirmModalRequest & { id: number };

const OPEN_EVENT = 'nexora:confirm-modal-open';
let requestIdCounter = 0;
const pending = new Map<number, (value: boolean) => void>();

export function confirmModalEventName(): string {
  return OPEN_EVENT;
}

export function requestConfirmModal(request: ConfirmModalRequest): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  const id = ++requestIdCounter;
  window.dispatchEvent(
    new CustomEvent<ConfirmModalEventPayload>(OPEN_EVENT, {
      detail: { id, ...request }
    })
  );
  return new Promise<boolean>((resolve) => {
    pending.set(id, resolve);
  });
}

export function resolveConfirmModal(id: number, result: boolean): void {
  const resolver = pending.get(id);
  if (!resolver) return;
  pending.delete(id);
  resolver(result);
}

export function cancelAllConfirmModals(): void {
  for (const [id, resolver] of pending.entries()) {
    pending.delete(id);
    resolver(false);
  }
}

