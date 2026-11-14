import { create } from 'zustand';

export type ToastType = 'info' | 'success' | 'error' | 'warning';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  text?: string;
  duration?: number;
}

interface ToastState {
  toasts: ToastItem[];
  push: (toast: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = crypto.randomUUID();
    set({ toasts: [...get().toasts, { ...toast, id }] });
    if (toast.duration !== 0) {
      setTimeout(() => {
        set({ toasts: get().toasts.filter((entry) => entry.id !== id) });
      }, toast.duration ?? (toast.type === 'error' ? 6500 : 3800));
    }
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
}));

export function toast(type: ToastType, title: string, text?: string): void {
  useToastStore.getState().push({ type, title, text });
}
