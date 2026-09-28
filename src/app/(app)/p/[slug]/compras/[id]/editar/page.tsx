import { Modulo } from "@prisma/client";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { rutaPanel } from "@/lib/paneles";
import { esOwner } from "@/lib/permisos";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerCompra } from "@/server/services/compra.service";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import { listarProveedoresActivos } from "@/server/services/proveedor.service";

import { CompraForm } from "../../compra-form";

export const metadata: Metadata = { title: "Editar compra" };

/** Fecha de la compra como YYYY-MM-DD en hora argentina. */
const fechaAR = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(d);

export default async function EditarCompraPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePaginaPanel(Modulo.COMPRAS, "editar");
  const { id } = await params;
  const c = await obtenerCompra(ctx, id, { incluirCostoActual: esOwner(ctx.usuario) }).catch(
    (e: unknown) => {
      if (e instanceof NotFoundError) notFound();
      throw e;
    },
  );
  // Solo el borrador se edita: una compra recibida o anulada queda congelada.
  if (c.estado !== "BORRADOR") redirect(rutaPanel(ctx.panel.slug, `/compras/${id}`));
  const [depositos, proveedores] = await Promise.all([
    listarDepositosActivos(ctx),
    listarProveedoresActivos(ctx),
  ]);
  // El proveedor puede haber sido desactivado después: se mantiene en la lista para no perderlo.
  if (c.proveedorId && !proveedores.some((p) => p.id === c.proveedorId))
    proveedores.push({ id: c.proveedorId, nombre: c.proveedor ?? "" });

  return (
    <CompraForm
      proveedores={proveedores}
      depositos={depositos}
      inicial={{
        id: c.id,
        numero: c.numero,
        proveedorId: c.proveedorId ?? "",
        depositoId: c.depositoId,
        fecha: fechaAR(c.fecha),
        descuento: String(Number(c.descuento)),
        notas: c.notas ?? "",
        items: c.items.map((i) => ({
          varianteId: i.varianteId,
          nombre: i.nombre,
          sku: i.sku,
          precioCostoActual: i.precioCostoActual,
          cantidad: String(i.cantidad),
          costo: String(Number(i.costoUnitario)),
        })),
      }}
    />
  );
}
