import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { hrefCon, type ParamsUrl } from "./pagination";

/** Encabezado de columna ordenable por URL (?orden=campo / -campo). */
export function SortHeader({
  campo,
  children,
  ordenActual,
  pathname,
  params,
  className,
  alinearDerecha,
}: {
  campo: string;
  children: ReactNode;
  ordenActual: string;
  pathname: string;
  params: ParamsUrl;
  className?: string;
  alinearDerecha?: boolean;
}) {
  const activo = ordenActual === campo || ordenActual === `-${campo}`;
  const desc = ordenActual === `-${campo}`;
  const siguiente = activo && !desc ? `-${campo}` : campo;
  const Icono = !activo ? ArrowUpDown : desc ? ArrowDown : ArrowUp;
  return (
    <Link
      href={hrefCon(pathname, params, { orden: siguiente, page: null })}
      scroll={false}
      className={cn(
        "hover:text-foreground inline-flex items-center gap-1 whitespace-nowrap",
        alinearDerecha && "flex-row-reverse",
        activo && "text-foreground",
        className,
      )}
    >
      {children}
      <Icono className={cn("size-3.5", !activo && "opacity-40")} aria-hidden />
    </Link>
  );
}
