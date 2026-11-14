import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { useToastStore } from '../stores/toast';
import { cn } from '../lib/utils';
import { translate } from '../lib/i18n';

export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  if (!toasts.length) return null;
  return createPortal(
    <div className="toast-viewport" role="region" aria-label={translate('通知')}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn('toast', toast.type)}
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
        >
          <span className="toast-icon">
            {toast.type === 'success' ? (
              <CheckCircle2 size={15} />
            ) : toast.type === 'error' ? (
              <AlertCircle size={15} />
            ) : toast.type === 'warning' ? (
              <TriangleAlert size={15} />
            ) : (
              <Info size={15} />
            )}
          </span>
          <div className="toast-body">
            <div className="toast-title">{toast.title}</div>
            {toast.text && <div className="toast-text">{toast.text}</div>}
          </div>
          <button type="button" className="toast-close" onClick={() => dismiss(toast.id)} aria-label={translate('关闭通知')}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
