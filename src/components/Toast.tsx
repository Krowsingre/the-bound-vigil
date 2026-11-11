import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export type ShowToast = (text: string, action?: { label: string; run: () => void }) => void;
type Toast = { id: number; text: string; action?: Parameters<ShowToast>[1] };
const ToastContext = createContext<ShowToast>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const show = useCallback<ShowToast>((text, action) => {
    const id = next.current++;
    setToasts((t) => [...t.slice(-2), { id, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 12000 : 4500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
            {t.action && <button type="button" className="toast-action" onClick={() => {
              setToasts((items) => items.filter(({ id }) => id !== t.id));
              t.action?.run();
            }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
