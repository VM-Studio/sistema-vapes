import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { buttonVariants } from "./button";

export type ParamsUrl = Record<string, string | string[] | undefined>;

/** Arma una URL conservando los parámetros actuales y pisando los indicados. */
export function hrefCon(
  pathname: string,
  params: ParamsUrl,
  cambios: Record<string, string | number | null>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string" && v !== "") sp.set(k, v);
  }
  for (const [k, v] of Object.entries(cambios)) {
    if (v === null || v === "") sp.delete(k);
    else sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Paginación server-side por links (funciona sin JS y conserva los filtros). */
export function Pagination({
  page,
  pageSize,
  total,
  pathname,
  params,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  pathname: string;
  params: ParamsUrl;
  className?: string;
}) {
  const paginas = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const desde = (page - 1) * pageSize + 1;
  const hasta = Math.min(page * pageSize, total);
  const link = (p: number) => hrefCon(pathname, params, { page: p === 1 ? null : p });
  const clase = buttonVariants({ variant: "secondary", size: "sm" });
  return (
    <nav
      aria-label="Paginación"
      className={cn("flex items-center justify-between gap-3 text-sm", className)}
    >
      <p className="text-muted">
        {desde}–{hasta} de {total}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={link(page - 1)} className={clase} aria-label="Página anterior" scroll={false}>
            <ChevronLeft strokeWidth={1.75} /> <span className="max-sm:sr-only">Anterior</span>
          </Link>
        ) : (
          <span className={cn(clase, "pointer-events-none opacity-40")} aria-hidden>
            <ChevronLeft strokeWidth={1.75} />
          </span>
        )}
        <span className="text-muted tabular-nums">
          {page} / {paginas}
        </span>
        {page < paginas ? (
          <Link
            href={link(page + 1)}
            className={clase}
            aria-label="Página siguiente"
            scroll={false}
          >
            <span className="max-sm:sr-only">Siguiente</span> <ChevronRight strokeWidth={1.75} />
          </Link>
        ) : (
          <span className={cn(clase, "pointer-events-none opacity-40")} aria-hidden>
            <ChevronRight strokeWidth={1.75} />
          </span>
        )}
      </div>
    </nav>
  );
}
