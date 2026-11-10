import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils';

export function Dropdown({
  trigger,
  children,
  align = 'end',
  width = 'auto',
  className,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  width?: number | 'auto' | 'trigger';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<{ top: number; left: number; width?: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    // Use the actual trigger control, not the wrapper span. A full-width
    // wrapper would otherwise report x=0 and push the popover to the edge.
    const triggerNode = (triggerRef.current.firstElementChild as HTMLElement | null) ?? triggerRef.current;
    const rect = triggerNode.getBoundingClientRect();
    const panelHeight = panelRef.current?.offsetHeight ?? 260;
    const targetWidth = width === 'trigger' ? rect.width : width === 'auto' ? undefined : width;
    const panelWidth = targetWidth ?? panelRef.current?.offsetWidth ?? 180;
    const top = rect.bottom + 6 + panelHeight > window.innerHeight - 12 ? Math.max(12, rect.top - panelHeight - 6) : rect.bottom + 6;
    const left = align === 'end' ? Math.max(12, rect.right - panelWidth) : Math.min(rect.left, window.innerWidth - panelWidth - 12);
    setStyle({ top, left, ...(targetWidth ? { width: targetWidth } : {}) });
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const node = (triggerRef.current?.firstElementChild as HTMLElement | null) ?? triggerRef.current;
      void node;
      panelRef.current?.querySelector<HTMLElement>('.menu-item:not(:disabled)')?.focus();
    });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      // Scrollbar clicks are not always reported inside the panel node.
      const rect = panelRef.current?.getBoundingClientRect();
      if (
        rect &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onScroll = (event: Event) => {
      // Scrolling inside the panel (wheel or scrollbar) must never close it.
      const target = event.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [open]);

  const close = () => setOpen(false);
  const closeAndFocus = () => {
    setOpen(false);
    const node = (triggerRef.current?.firstElementChild as HTMLElement | null) ?? triggerRef.current;
    window.requestAnimationFrame(() => node?.focus());
  };

  return (
    <>
      <span
        ref={triggerRef}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        style={{ display: 'inline-flex' }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {trigger}
      </span>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={cn('popover', className)}
            style={{ top: style.top, left: style.left, ...(style.width ? { width: style.width } : {}) }}
            onClick={(event) => event.stopPropagation()}
            role="menu"
            onKeyDown={(event) => {
              const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('.menu-item:not(:disabled)') ?? []);
              if (!items.length) return;
              const index = items.indexOf(document.activeElement as HTMLElement);
              if (event.key === 'Escape') {
                event.preventDefault();
                closeAndFocus();
              } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const delta = event.key === 'ArrowDown' ? 1 : -1;
                items[(index + delta + items.length) % items.length]?.focus();
              } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
              } else if (event.key === 'Tab') {
                event.preventDefault();
                const delta = event.shiftKey ? -1 : 1;
                items[(index + delta + items.length) % items.length]?.focus();
              }
            }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

export function MenuItem({
  icon,
  children,
  shortcut,
  detail,
  danger = false,
  onClick,
  disabled,
}: {
  icon?: ReactNode;
  children: ReactNode;
  shortcut?: ReactNode;
  detail?: ReactNode;
  danger?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn('menu-item', danger && 'danger')}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      <span>{children}</span>
      {shortcut && <span className="menu-shortcut">{shortcut}</span>}
      {detail && <span className="menu-detail">{detail}</span>}
    </button>
  );
}
