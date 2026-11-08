import { cn, initials } from '../lib/utils';

export function Avatar({
  name,
  color,
  size = 'md',
  className,
}: {
  name: string;
  color?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  return (
    <span
      className={cn('avatar', size !== 'md' && `avatar-${size}`, className)}
      style={{ ['--avatar-color' as string]: color || '#17865b' }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
