import { useEffect, useRef, useState } from 'react';
import { cn } from './utils';

export function useScrollFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const max = element.scrollWidth - element.clientWidth;
      setFade({
        left: element.scrollLeft > 2,
        right: max > 2 && element.scrollLeft < max - 2,
      });
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);

  return {
    ref,
    className: cn(fade.left && 'scroll-fade-left', fade.right && 'scroll-fade-right'),
  };
}
