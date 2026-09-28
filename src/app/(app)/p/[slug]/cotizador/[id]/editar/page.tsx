import { Modulo } from "@prisma/client";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerConfigCotizacion } from "@/server/services/configuracion.service";
import { obtener } from "@/server/services/cotizacion.service";

import { EditorCotizacion } from "../../editor-cotizacion";
import { esEditable } from "../../estado-cotizacion";

export const metadata: Metadata = { title: "Editar cotización" };

const DIA = 24 * 3600 * 1000;

export default async function EditarCotizacionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requirePaginaPanel(Modulo.COTIZADOR, "crear");
  const { id } = await params;
  const [c, config] = await Promise.all([
    obtener(ctx, id).catch((e: unknown) => {
      if (e instanceof NotFoundError) notFound();
      throw e;
    }),
    obtenerConfigCotizacion(ctx),
  ]);
  if (!esEditable(c.estado)) redirect(rutaPanel(ctx.panel.slug, `/cotizador/${id}`));
  const validezDias = Math.max(
    1,
    Math.round((new Date(c.validaHasta).getTime() - new Date(c.fecha).getTime()) / DIA),
  );
  return (
    <EditorCotizacion
      tipo={c.tipo}
      inicial={{
        id: c.id,
        codigo: c.codigo,
        items: c.items.map((i) => ({
          varianteId: i.varianteId,
          productoId: i.productoId,
          titulo: i.titulo,
          cantidad: i.cantidad,
          precioManual: i.esPrecioManual ? i.precioUnitario : null,
        })),
        cliente: !c.cliente
          ? null
          : c.cliente.id
            ? {
                tipo: "existente",
                id: c.cliente.id,
                nombre: c.cliente.nombre,
                telefono: c.cliente.telefono ?? "",
              }
            : { tipo: "nuevo", nombre: c.cliente.nombre, telefono: c.cliente.telefono ?? "" },
        descuento: Number(c.descuento) > 0 ? c.descuento : "",
        notas: c.notas ?? "",
        validezDias,
      }}
      validezDefault={config.validezDias}
      modoEscalon={config.modoEscalonMayorista}
      mostrarStock={config.mostrarStock}
      puedeEditar={puede(ctx.usuario, ctx.panelId, Modulo.COTIZADOR, "editar")}
      esOwner={esOwner(ctx.usuario)}
      puedeVender={puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "crear")}
    />
  );
}
