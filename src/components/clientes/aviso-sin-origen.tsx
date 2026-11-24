import { ChevronRight, UserRoundSearch } from "lucide-react";
import Link from "next/link";

import { formatearNumero } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { cn } from "@/lib/utils";
import type { CtxPanel } from "@/server/auth/permissions";
import { contarClientesSinOrigen } from "@/server/services/cliente.service";

/**
 * Dueños: aviso de los clientes cargados antes de v2.13.0 que todavía no
 * tienen «¿De quién viene?». Lleva a Clientes → Completar de quién viene.
 * Desaparece solo cuando están todos respondidos.
 */
export async function AvisoClientesSinOrigen({
  ctx,
  className,
}: {
  ctx: CtxPanel;
  className?: string;
}) {
  const n = await contarClientesSinOrigen(ctx);
  if (n === 0) return null;
  return (
    <Link
      href={rutaPanel(ctx.panel.slug, "/clientes/origen")}
      className={cn(
        "bg-warning-soft text-warning-soft-foreground rounded-card flex min-h-14 items-center gap-3 p-4",
        className,
      )}
      data-testid="aviso-clientes-sin-origen"
    >
      <UserRoundSearch className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">
          {n === 1
            ? "1 cliente no tiene «¿De quién viene?»"
            : `${formatearNumero(n)} clientes no tienen «¿De quién viene?»`}
        </span>{" "}
        Respondé de quién es cada uno: define la ganancia de cliente nuevo de los vendedores.
      </span>
      <ChevronRight className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
    </Link>
  );
}
