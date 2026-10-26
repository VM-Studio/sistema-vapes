import { Modulo } from "@prisma/client";
import { ChevronRight, Clock, PackageCheck } from "lucide-react";
import Link from "next/link";

import { NOMBRE_ESCANEO } from "@/lib/escaneo-remoto";
import { rutaPanel } from "@/lib/paneles";
import { puede } from "@/lib/permisos";
import { formatearFechaHora } from "@/lib/utils";
import type { CtxPanel } from "@/server/auth/permissions";
import { avisosEscaneo } from "@/server/services/escaneo-remoto.service";

import { BotonRetirado } from "./retiro";

/**
 * Aviso del inicio: las ventas (propias, o todas para los dueños) que
 * {NOMBRE_ESCANEO} ya escaneó y siguen sin retirar —con el botón «Retirado»— y
 * cuántas siguen esperando. Sin nada que avisar no se muestra.
 */
export async function AvisosEscaneo({ ctx, soloPropias }: { ctx: CtxPanel; soloPropias: boolean }) {
  const { escaneadas, pendientes } = await avisosEscaneo(ctx, { soloPropias });
  if (escaneadas.length === 0 && pendientes === 0) return null;
  const slug = ctx.panel.slug;
  const puedeRetirar = puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "crear");
  return (
    <section
      aria-label={`Escaneos de ${NOMBRE_ESCANEO}`}
      className="bg-card rounded-card flex flex-col gap-3 p-4"
      data-testid="avisos-escaneo"
    >
      {escaneadas.length > 0 && (
        <ul className="flex flex-col gap-2">
          {escaneadas.map((v) => (
            <li
              key={v.id}
              className="bg-success-soft text-success-soft-foreground rounded-control flex flex-col gap-2 pr-2 sm:flex-row sm:items-center"
            >
              <Link
                href={rutaPanel(slug, `/ventas/${v.id}`)}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-sm"
              >
                <PackageCheck className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    <span className="font-mono">{v.codigo}</span> · {v.escaneadaPor} ya escaneó ·
                    listo para retirar
                  </span>
                  <span className="block text-xs">
                    {formatearFechaHora(v.escaneadaAt)} · {v.unidades}{" "}
                    {v.unidades === 1 ? "unidad" : "unidades"} descontadas de {v.deposito}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
              </Link>
              {puedeRetirar && (
                <BotonRetirado
                  ventaId={v.id}
                  codigo={v.codigo}
                  variant="secondary"
                  size="sm"
                  className="mx-3 mb-2 sm:mx-0 sm:mb-0"
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {pendientes > 0 && (
        <Link
          href={rutaPanel(slug, "/ventas?escaneo=PENDIENTE")}
          className="text-foreground flex items-center gap-2 text-sm font-medium underline-offset-4 hover:underline"
        >
          <Clock className="text-muted size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          {pendientes === 1
            ? `1 venta esperando escaneo de ${NOMBRE_ESCANEO}`
            : `${pendientes} ventas esperando escaneo de ${NOMBRE_ESCANEO}`}
        </Link>
      )}
    </section>
  );
}
