import { Modulo } from "@prisma/client";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { formatearIdCompra, rutaPanel } from "@/lib/paneles";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { cotizacionResumenCompra, obtenerCompra } from "@/server/services/compra.service";
import { obtenerConfigCompras } from "@/server/services/configuracion.service";
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
  const c = await obtenerCompra(ctx, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  // Solo se edita la pendiente de recibir: una compra recibida o anulada queda congelada.
  if (c.estado !== "BORRADOR") redirect(rutaPanel(ctx.panel.slug, `/compras/${id}`));
  const [depositos, proveedores, cotizacionUsdt] = await Promise.all([
    listarDepositosActivos(ctx),
    listarProveedoresActivos(ctx),
    cotizacionResumenCompra(c.tipoCambioUSDT),
  ]);
  const configCompras = await obtenerConfigCompras(ctx);

  return (
    <CompraForm
      proveedores={proveedores}
      depositos={depositos}
      comisionDefault={configCompras.comisionPasistaPorcentajeDefault}
      cotizacionUsdt={cotizacionUsdt}
      inicial={{
        id: c.id,
        comisionPasistaPorcentaje: c.comisionPasistaPorcentaje,
        gastos: c.gastos.filter((g) => !g.anulado).map((g) => g.monto),
        idVisible: formatearIdCompra(ctx.panel.slug, c.numero),
        // Si el proveedor o el galpón se desactivaron, hay que elegir otro.
        proveedorId: proveedores.some((p) => p.id === c.proveedorId) ? (c.proveedorId ?? "") : "",
        depositoId: depositos.some((d) => d.id === c.depositoId) ? c.depositoId : "",
        fecha: fechaAR(c.fecha),
        notas: c.notas ?? "",
        items: c.items.map((i) => ({
          varianteId: i.varianteId,
          productoId: i.productoId,
          nombreCompleto: i.nombreCompleto,
          sabor: i.sabor,
          sku: i.sku,
          cantidad: String(i.cantidad),
          costo: String(Number(i.costoUnitario)),
          origenCosto: "manual",
        })),
      }}
    />
  );
}
