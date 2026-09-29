import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { formatearDelta } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  /** Variación %: sube en verde apagado, baja en rojo apagado, con flecha. */
  deltaPct?: number | null;
}

/** Tarjeta de métrica: valor grande, etiqueta, valor anterior y delta (clickeable si tiene href). */
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
}: StatCardProps) {
  const conDelta = deltaPct !== undefined;
  const sube = deltaPct != null && deltaPct > 0;
  const baja = deltaPct != null && deltaPct < 0;
  const Flecha = sube ? ArrowUpRight : baja ? ArrowDownRight : Minus;
  const contenido = (
    <>
      <p className="text-muted text-small font-medium">{label}</p>
      <p
        className={cn(
          // Montos grandes ("$ 12.136.400") tienen que entrar en media pantalla de 375px.
          "text-2xl leading-tight font-semibold tracking-tight tabular-nums lg:text-[1.75rem]",
          tono === "alerta" && "text-danger",
          tono === "ok" && "text-success",
        )}
      >
        {value}
      </p>
      {(conDelta || anterior !== undefined) && (
        <div className="text-small flex flex-wrap items-center gap-x-2 gap-y-1">
          {conDelta && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-semibold tabular-nums",
                sube && "text-success",
                baja && "text-danger",
                !sube && !baja && "text-subtle",
              )}
            >
              <Flecha className="size-3.5" strokeWidth={2} aria-hidden />
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
    </>
  );
  const clase = cn(
    "flex flex-col gap-1.5 rounded-card p-5",
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
