import { Check, CircleAlert, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';

export interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'info' | 'error';
  action?: { label: string; run: () => void };
}

type Show = (toast: Omit<Toast, 'id'>) => void;
const ToastContext = createContext<Show>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const show = useCallback<Show>((toast) => {
    const id = nextId.current++;
    setToasts((all) => [...all.slice(-2), { ...toast, id }]);
    // Longer when there's something to do (Undo) or read (an error).
    window.setTimeout(() => dismiss(id), toast.action || toast.kind === 'error' ? 8000 : 4500);
  }, [dismiss]);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {/* Newer toasts push older ones up (layout); a closing toast fades and drops 4 px. */}
        <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div key={t.id} className={`toast toast-${t.kind}`} layout transition={{ layout: { duration: 0.16 } }}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.14 } }}>
            <span className="toast-icon" aria-hidden="true">
              {t.kind === 'success' ? <Check size={13} strokeWidth={3} /> : t.kind === 'error' ? <CircleAlert size={14} /> : <Info size={14} />}
            </span>
            <span className="toast-message">{t.message}</span>
            {t.action && (
              <button type="button" className="btn-link" onClick={() => { dismiss(t.id); t.action!.run(); }}>
                {t.action.label}
              </button>
            )}
            <button type="button" className="icon-btn toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}><X size={16} aria-hidden="true" /></button>
          </motion.div>
        ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
