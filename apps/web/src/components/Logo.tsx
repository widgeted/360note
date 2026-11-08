import { cn } from '../lib/utils';
import { getLocale } from '../lib/i18n';

function brandLogoPath(): string {
  return getLocale() === 'zh-CN' ? '/img/360biji.svg' : '/img/360note.svg';
}

/**
 * The public brand mark uses the official artwork already published on the two
 * domains: 360note.svg on the English edition and 360biji.svg on the Chinese
 * edition. The icon version is kept for compact surfaces such as favicons.
 */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <img src="/img/360note_icon.svg" alt="" className="brand-mark-image" />
    </span>
  );
}

export function LogoLockup({ inverse = false }: { inverse?: boolean }) {
  const label = getLocale() === 'zh-CN' ? '360笔记' : '360note';
  return (
    <span className={cn('brand-lockup', inverse && 'brand-lockup-inverse')}>
      <img src={brandLogoPath()} alt={label} className="brand-logo" />
      <img src="/img/360note_icon.svg" alt="" aria-hidden="true" className="brand-icon" />
    </span>
  );
}
