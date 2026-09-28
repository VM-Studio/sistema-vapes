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
      <p className="text-muted text-sm font-medium">{label}</p>
      <p
        className={cn(
          // Montos grandes ("$ 12.136.400") tienen que entrar en media pantalla de 375px.
          "text-2xl leading-tight font-semibold tracking-tight tabular-nums lg:text-3xl",
          tono === "alerta" && "text-danger",
          tono === "ok" && "text-success",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-muted text-sm">{hint}</p>}
      {children}
    </>
  );
  const clase = cn(
    "flex flex-col gap-1.5 rounded-2xl border bg-surface p-5 shadow-card",
    tono === "alerta" ? "border-danger/30 bg-danger-soft" : "border-border",
    href &&
      "transition-[border-color,box-shadow] duration-150 hover:border-input hover:shadow-card-hover",
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
