import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Download } from 'lucide-react';

interface LightboxImage {
  src: string;
  alt?: string;
}

interface ImageLightboxContextValue {
  /** Open the fullscreen viewer for a single image. */
  open: (src: string, alt?: string) => void;
}

const ImageLightboxContext = createContext<ImageLightboxContextValue | null>(null);

/**
 * App-wide fullscreen image viewer (Facebook-style). Any component can call
 * `useImageLightbox().open(src, alt)` to pop an image into a dismissible
 * overlay — used for avatars, cover images, and post media so every image that
 * looks tappable actually does something.
 */
export function ImageLightboxProvider({ children }: { children: React.ReactNode }) {
  const [image, setImage] = useState<LightboxImage | null>(null);

  const open = useCallback((src: string, alt?: string) => {
    if (src) setImage({ src, alt });
  }, []);

  const close = useCallback(() => setImage(null), []);

  // Esc to close + lock body scroll while open.
  useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [image, close]);

  return (
    <ImageLightboxContext.Provider value={{ open }}>
      {children}
      {createPortal(
        <AnimatePresence>
          {image && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              role="dialog"
              aria-modal="true"
              aria-label={image.alt || 'Image viewer'}
              onClick={close}
              className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md"
            >
              <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
                <a
                  href={image.src}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Open image in new tab"
                  className="rounded-full border border-white/15 bg-black/60 p-2.5 text-zinc-300 transition hover:border-cyan-300/40 hover:text-cyan-200"
                >
                  <Download className="h-5 w-5" />
                </a>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close image viewer"
                  className="rounded-full border border-white/15 bg-black/60 p-2.5 text-zinc-300 transition hover:border-red-400/40 hover:text-red-300"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <motion.img
                key={image.src}
                src={image.src}
                alt={image.alt || ''}
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.92, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                onClick={(e) => e.stopPropagation()}
                className="max-h-[90vh] max-w-[92vw] rounded-2xl object-contain shadow-[0_0_60px_rgba(0,0,0,0.8)]"
              />
              {image.alt && (
                <p className="pointer-events-none absolute bottom-5 left-1/2 max-w-[90vw] -translate-x-1/2 truncate rounded-full bg-black/60 px-4 py-1.5 text-center text-xs font-medium text-zinc-300">
                  {image.alt}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </ImageLightboxContext.Provider>
  );
}

/**
 * Access the fullscreen image viewer. Returns a no-op opener when used outside
 * the provider so callers never need to null-check.
 */
export function useImageLightbox(): ImageLightboxContextValue {
  const ctx = useContext(ImageLightboxContext);
  return ctx ?? { open: () => undefined };
}
