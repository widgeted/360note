import { AlertCircle, RotateCcw } from 'lucide-react';
import { useT } from '../lib/i18n';

/**
 * Shared inline failure state for panels that would otherwise render a
 * misleading empty view when a request fails.
 */
export function LoadFailure({
  message,
  onRetry,
  compact = false,
}: {
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const t = useT();
  return (
    <div className={compact ? 'setting-note form-error' : 'banner banner-warning'} role="alert">
      <AlertCircle size={14} />
      <div style={{ flex: 1, minWidth: 0 }}>{message || t('加载失败，请稍后重试。')}</div>
      {onRetry && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          <RotateCcw size={12} /> {t('重试')}
        </button>
      )}
    </div>
  );
}
