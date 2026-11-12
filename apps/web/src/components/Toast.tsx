import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CheckCircleIcon, CrossCircleIcon, XIcon } from './icons';

export type ToastTone = 'success' | 'error';

interface ToastApi {
  /** Shows a short message at the bottom of the window for 4 seconds. */
  show: (message: string, tone?: ToastTone) => void;
}

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

/** How long a toast stays, counted again from the start after a hover or focus ends. */
export const TOAST_MS = 4000;

// Without a provider (a component rendered on its own in a test) a toast is simply dropped.
const ToastContext = createContext<ToastApi>({ show: () => {} });

export const useToast = () => useContext(ToastContext);

/**
 * Brief messages after an action whose own dialog has closed, so the message would otherwise
 * vanish with it (a quick add from a card). Messages inside a form that stays open stay inline.
 * One polite live region, fixed at the bottom centre above the safe area.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const show = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = next.current++;
    // The newest replaces any other with the same text, so a double save shows once.
    setToasts((t) => [...t.filter((x) => x.message !== message), { id, message, tone }].slice(-3));
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => dismissRef.current(), TOAST_MS);
    return () => clearTimeout(timer);
  }, [paused]);

  return (
    <div
      className={`toast toast-${toast.tone}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <span className="toast-icon">
        {toast.tone === 'error' ? <CrossCircleIcon /> : <CheckCircleIcon />}
      </span>
      <span className="toast-message">{toast.message}</span>
      <button type="button" className="icon-button" aria-label="Dismiss" onClick={onDismiss}>
        <XIcon />
      </button>
    </div>
  );
}
