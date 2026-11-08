import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import { translate, useT } from '../lib/i18n';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnOverlay = true,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnOverlay?: boolean;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  // Keep the latest onClose without making the focus effect restart on every
  // parent render (which used to steal focus after the first typed character).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => {
      const field = panelRef.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]), textarea, select, [contenteditable="true"]',
      );
      const fallback = panelRef.current?.querySelector<HTMLElement>('button, [tabindex]:not([tabindex="-1"])');
      (field ?? fallback)?.focus();
    }, 40);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(timer);
      lastFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (closeOnOverlay && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={cn('modal', size !== 'md' && `modal-${size}`, className)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {(title || description) && (
          <div className="modal-head">
            <div>
              {title && <div className="modal-title">{title}</div>}
              {description && <div className="modal-desc">{description}</div>}
            </div>
            <button type="button" className="modal-close" onClick={onClose} aria-label={translate('关闭')}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className={cn('modal-body', title || description ? 'pad' : '')}>{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = '确认',
  danger = false,
  loading = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={loading}>
            {t('取消')}
          </button>
          <button
            type="button"
            className={cn('btn btn-sm', danger ? 'btn-danger' : 'btn-primary')}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && <span className="spinner" />}
            {t(confirmLabel)}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
