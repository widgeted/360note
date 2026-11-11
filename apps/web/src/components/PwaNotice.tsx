import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Shared compact notice card for PWA install/update prompts.
 * Close is anchored top-left, icon sits next to the title, actions live at the
 * bottom-left so these prompts match the notification rows used elsewhere.
 */
export function PwaNotice({
  icon,
  title,
  children,
  actions,
  onClose,
  closeLabel,
  placement = 'bottom',
  role = 'status',
  ariaLabel,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  closeLabel: string;
  placement?: 'top' | 'bottom';
  role?: 'status' | 'dialog';
  ariaLabel?: string;
}) {
  return (
    <div
      className={cn('pwa-notice', placement === 'top' && 'is-top')}
      role={role}
      aria-live="polite"
      aria-label={ariaLabel}
    >
      <button type="button" className="pwa-notice-close" onClick={onClose} aria-label={closeLabel} title={closeLabel}>
        <X size={14} />
      </button>
      <div className="pwa-notice-head">
        <span className="pwa-notice-icon" aria-hidden="true">{icon}</span>
        <div className="pwa-notice-title">{title}</div>
      </div>
      <div className="pwa-notice-text">{children}</div>
      {actions && <div className="pwa-notice-actions">{actions}</div>}
    </div>
  );
}
