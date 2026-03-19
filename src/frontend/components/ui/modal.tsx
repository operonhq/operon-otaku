import { useEffect, useRef, ReactNode } from 'react';

interface ModalProps {
  children: ReactNode;
  onClose: () => void;
  closeOnBackdropClick?: boolean;
  closeOnEsc?: boolean;
  showCloseButton?: boolean;
  className?: string;
}

export function Modal({ 
  children, 
  onClose, 
  closeOnBackdropClick = true,
  closeOnEsc = true,
  showCloseButton = true,
  className = ''
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);

  // Handle ESC key
  useEffect(() => {
    if (!closeOnEsc) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [closeOnEsc, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Focus trap: capture previous focus, focus first element, trap Tab cycle, restore on unmount
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement;

    const modal = modalRef.current;
    if (!modal) return;

    const focusableSelector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const focusableElements = modal.querySelectorAll<HTMLElement>(focusableSelector);
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    } else {
      modal.focus();
    }

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusables = modal.querySelectorAll<HTMLElement>(focusableSelector);
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTab);

    return () => {
      document.removeEventListener('keydown', handleTab);
      const prev = previouslyFocusedRef.current;
      if (prev && prev instanceof HTMLElement) {
        prev.focus();
      }
    };
  }, []);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (closeOnBackdropClick && e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/80  p-4"
      onClick={handleBackdropClick}
      style={{ pointerEvents: 'auto' }}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <div className={`bg-background rounded-lg w-full max-h-[90vh] p-1.5 relative ${className}`} style={{ overflow: 'visible' }}>
        {/* Close button - positioned above content with better visibility */}
        {showCloseButton && (
          <button 
            onClick={onClose}
            className="absolute top-6 right-6 z-[100] text-muted-foreground hover:text-foreground transition-colors text-xl leading-none"
            aria-label="Close modal"
          >
            
          </button>
        )}
        
        {/* Modal content - with proper overflow handling, allow dropdowns to extend beyond */}
        <div className="bg-pop rounded-lg p-4 sm:p-6" style={{ overflow: 'visible' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

