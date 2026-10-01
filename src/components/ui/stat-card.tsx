import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { formatearDelta } from "@/lib/format";
import { cn } from "@/lib/utils";

import { CLASE_TONO, iconoMetrica, type TonoMetrica } from "./icono-metrica";

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tono?: "neutral" | "alerta" | "ok";
  href?: string;
  className?: string;
  children?: ReactNode;
  /** Valor del período anterior (se muestra en chico, con su etiqueta). */
  anterior?: ReactNode;
  /** "Ayer", "Mes pasado"… (default "Anterior"). */
  etiquetaAnterior?: string;
  /** Variación %: pastilla oliva si sube, naranja si baja, con flecha. */
  deltaPct?: number | null;
  /** Ícono y color del círculo; por defecto salen de la etiqueta (iconoMetrica). */
  icono?: LucideIcon;
  acento?: TonoMetrica;
}

/**
 * Tarjeta de métrica: ícono en un círculo de color, etiqueta, valor grande,
 * valor anterior y delta en pastilla (clickeable si tiene href). En pantallas
 * anchas el ícono va a la izquierda; en las angostas, arriba.
 */
export function StatCard({
  label,
  value,
  hint,
  tono = "neutral",
  href,
  className,
  children,
  anterior,
  etiquetaAnterior = "Anterior",
  deltaPct,
  icono,
  acento,
}: StatCardProps) {
  const conDelta = deltaPct !== undefined;
  const sube = deltaPct != null && deltaPct > 0;
  const baja = deltaPct != null && deltaPct < 0;
  const Flecha = sube ? ArrowUpRight : baja ? ArrowDownRight : Minus;
  const auto = iconoMetrica(label);
  const Icono = icono ?? auto.icono;
  const contenido = (
    <>
      <span
        aria-hidden
        className={cn(
          "rounded-circle flex size-10 shrink-0 items-center justify-center md:size-11",
          tono === "alerta"
            ? "bg-danger/10 text-danger"
            : CLASE_TONO[acento ?? (tono === "ok" ? "oliva" : auto.tono)],
        )}
      >
        <Icono className="size-5" strokeWidth={2} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-muted text-small font-medium">{label}</p>
        <p
          className={cn(
            // Montos grandes ("$ 12.136.400") tienen que entrar en media pantalla de 375px.
            "text-2xl leading-tight font-bold tracking-tight break-words tabular-nums lg:text-[1.75rem]",
            tono === "alerta" && "text-danger",
            tono === "ok" && "text-success",
          )}
        >
          {value}
        </p>
        {(conDelta || anterior !== undefined) && (
          <div className="text-small mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {conDelta && (
              <span
                className={cn(
                  "rounded-inner inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                  sube && "bg-tono-oliva-suave text-tono-oliva",
                  baja && "bg-tono-naranja-suave text-tono-naranja",
                  !sube && !baja && "bg-surface-2 text-subtle",
                )}
              >
                <Flecha className="size-3.5" strokeWidth={2.25} aria-hidden />
                {deltaPct == null ? "—" : formatearDelta(deltaPct)}
              </span>
            )}
            {anterior !== undefined && (
              <span className="text-subtle tabular-nums">
                {etiquetaAnterior}: {anterior}
              </span>
            )}
          </div>
        )}
        {hint && <p className="text-subtle text-small">{hint}</p>}
        {children}
      </div>
    </>
  );
  const clase = cn(
    "flex min-w-0 flex-col gap-3 rounded-card p-5 xl:flex-row xl:gap-4",
    tono === "alerta" ? "bg-danger-soft" : "bg-card",
    href &&
      "transition-[background-color,box-shadow] duration-150 hover:bg-card-hover hover:shadow-card-hover",
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
