import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, PencilLine, X } from 'lucide-react';
import { translate } from '../lib/i18n';
import { useFocusTrap } from '../lib/useFocusTrap';

interface PreviewImage {
  src: string;
  alt?: string;
  title?: string;
  editable?: boolean;
}

export function ImageLightbox() {
  const [image, setImage] = useState<PreviewImage | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, Boolean(image), () => setImage(null));

  useEffect(() => {
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<PreviewImage>).detail;
      if (detail?.src) setImage(detail);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setImage(null);
    }
    window.addEventListener('nh:open-image', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('nh:open-image', onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (!image) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [image]);

  if (!image) return null;

  return createPortal(
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={translate('图片预览')}
      onClick={() => setImage(null)}
    >
      <div className="image-lightbox-bar">
        <a href={image.src} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
          <ExternalLink size={14} /> {translate('查看原图')}
        </a>
        {image.editable && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              window.dispatchEvent(new CustomEvent('nh:edit-image-caption', { detail: image }));
              setImage(null);
            }}
          >
            <PencilLine size={14} /> {translate('图片说明')}
          </button>
        )}
        <button type="button" className="image-lightbox-close" onClick={() => setImage(null)} aria-label={translate('关闭预览')}>
          <X size={18} />
        </button>
      </div>
      <img
        src={image.src}
        alt={image.alt?.trim() ? image.alt : translate('图片预览')}
        onClick={(event) => event.stopPropagation()}
      />
    </div>,
    document.body,
  );
}
