"use client";

import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info";

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** ms; default 4000 (errores: 6000). */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastInput, "title" | "variant">> {
  id: number;
  description?: string;
}

interface ToastApi {
  toast: (t: ToastInput) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONO = { success: CheckCircle2, error: XCircle, info: Info } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const siguienteId = useRef(0);

  const cerrar = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    ({ title, description, variant = "info", duration }: ToastInput) => {
      const id = ++siguienteId.current;
      setToasts((ts) => [...ts.slice(-2), { id, title, description, variant }]); // máximo 3 a la vez
      setTimeout(() => cerrar(id), duration ?? (variant === "error" ? 6000 : 4000));
    },
    [cerrar],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, variant: "success" }),
      error: (title, description) => toast({ title, description, variant: "error" }),
      info: (title, description) => toast({ title, description, variant: "info" }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className={cn(
          "pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4",
          // mobile: arriba, debajo del header (abajo tapaban las barras fijas de acción:
          // Guardar, Confirmar ingreso, Recibir…); desktop: arriba a la derecha
          "top-[calc(4rem+env(safe-area-inset-top))] md:top-4 md:right-4 md:left-auto md:items-end",
        )}
      >
        {toasts.map((t) => {
          const Icono = ICONO[t.variant];
          return (
            <div
              key={t.id}
              role={t.variant === "error" ? "alert" : "status"}
              className="bg-card shadow-pop rounded-card pointer-events-auto flex w-full max-w-sm items-start gap-3 border border-black/[0.04] p-4"
            >
              <Icono
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  t.variant === "success" && "text-success",
                  t.variant === "error" && "text-danger",
                  t.variant === "info" && "text-foreground",
                )}
                strokeWidth={1.75}
                aria-hidden
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.description && <p className="text-muted text-sm">{t.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => cerrar(t.id)}
                className="text-muted hover:bg-surface-3 hover:text-foreground rounded-control -m-1.5 flex size-8 items-center justify-center"
                aria-label="Cerrar aviso"
              >
                <X className="size-4" strokeWidth={1.75} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() requiere <ToastProvider>");
  return ctx;
}
