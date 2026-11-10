import { cn, initials } from '../lib/utils';

export function Avatar({
  name,
  color,
  size = 'md',
  className,
  ariaLabel,
}: {
  name: string;
  color?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <span
      className={cn('avatar', size !== 'md' && `avatar-${size}`, className)}
      style={{ ['--avatar-color' as string]: color || '#17865b' }}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      {initials(name)}
    </span>
  );
}
