import { Modulo } from "@prisma/client";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SeccionGanancia } from "@/components/ganancia/seccion-ganancia";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { esMes } from "@/lib/ganancia-vendedor";
import { rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { requirePaginaPanelUsuario } from "@/server/auth/permissions";
import {
  gananciaDelMes,
  liquidacionesDe,
  mesActual,
} from "@/server/services/ganancia-vendedor.service";
import { obtenerRemito } from "@/server/services/remito-liquidacion.service";

export const metadata: Metadata = { title: "Mi ganancia" };

/**
 * "Mi ganancia" del vendedor: lo mismo que ven los dueños en "Ventas de
 * {vendedor}" (total del mes a hoy, categorías, ventas y liquidaciones), solo
 * de lo suyo y sin acciones. Sin ganancia por vape → vuelve al inicio.
 */
export default async function MiGananciaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePaginaPanelUsuario();
  const inicio = rutaPanel(ctx.panel.slug);
  if (esOwner(ctx.usuario)) redirect(rutaPanel(ctx.panel.slug, "/equipo"));
  const sp = await searchParams;
  const mes = esMes(sp.mes) ? sp.mes : mesActual();
  const [g, historial] = await Promise.all([
    gananciaDelMes(ctx, ctx.usuarioId, mes),
    liquidacionesDe(ctx, ctx.usuarioId),
  ]);
  if (!g) redirect(inicio);
  const remito =
    g.liquidacion && g.liquidacion.estado !== "PENDIENTE"
      ? await obtenerRemito(ctx, g.liquidacion.id)
      : null;
  const verVentas = puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "ver");
  return (
    <div className="flex flex-col gap-4">
      <header className="mb-2 flex flex-col gap-4 md:mb-4">
        <Breadcrumb items={[{ label: "Inicio", href: inicio }, { label: "Mi ganancia" }]} />
        <h1 className="text-h1 font-semibold">Mi ganancia</h1>
      </header>
      <SeccionGanancia
        g={g}
        historial={historial}
        slug={ctx.panel.slug}
        dueno={false}
        remito={remito}
        usuarioActual={{ id: ctx.usuario.id, nombre: ctx.usuario.nombre }}
        tarifasVigentes={null}
        titulo={`Lo que vas ganando`}
        hrefMes={(m) => rutaPanel(ctx.panel.slug, `/ganancia?mes=${m}`)}
        rutaVenta={verVentas ? (id) => rutaPanel(ctx.panel.slug, `/ventas/${id}`) : null}
        // «Mi ganancia» es del vendedor: solo lo que gana, sin el total vendido/facturado.
        verFacturado={false}
      />
    </div>
  );
}
