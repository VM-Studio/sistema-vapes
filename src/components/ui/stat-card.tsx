import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tono?: "neutral" | "alerta" | "ok";
  href?: string;
  className?: string;
  children?: ReactNode;
}

/** Tarjeta de métrica para cabeceras (clickeable si tiene href). */
export function StatCard({
  label,
  value,
  hint,
  tono = "neutral",
  href,
  className,
  children,
}: StatCardProps) {
  const contenido = (
    <>
      <p className="text-muted text-xs font-medium tracking-wide uppercase">{label}</p>
      <p
        className={cn(
          // Montos grandes ("$ 12.136.400") tienen que entrar en media pantalla de 375px.
          "text-xl font-semibold tabular-nums sm:text-2xl lg:text-3xl",
          tono === "alerta" && "text-danger",
          tono === "ok" && "text-success",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-muted text-xs">{hint}</p>}
      {children}
    </>
  );
  const clase = cn(
    "flex flex-col gap-1 rounded-xl border bg-surface p-4",
    tono === "alerta" ? "border-danger/40 bg-danger-soft/40" : "border-border",
    href && "transition-colors hover:border-primary/40",
    className,
  );
  return href ? (
    <Link href={href} className={clase} scroll={false}>
      {contenido}
    </Link>
  ) : (
    <div className={clase}>{contenido}</div>
  );
}
