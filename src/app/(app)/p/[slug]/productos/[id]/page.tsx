import { Modulo } from "@prisma/client";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/ui/section-card";
import { rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import { listarEscalones } from "@/server/services/escalon.service";
import { listarMovimientos } from "@/server/services/movimiento.service";
import { obtener } from "@/server/services/producto.service";
import { proveedoresDeProducto } from "@/server/services/proveedor.service";

import { CabeceraProducto } from "./cabecera-producto";
import { MovimientosProducto } from "./movimientos-producto";
import { PreciosMayoristas } from "./precios-mayoristas";
import { ProveedoresProducto } from "./proveedores-producto";
import { SaboresProducto } from "./sabores-producto";

export const metadata: Metadata = { title: "Producto" };

export default async function FichaProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePaginaPanel(Modulo.PRODUCTOS, "ver");
  const { id } = await params;
  const owner = esOwner(ctx.usuario);
  // Precios de proveedores = costos de compra: solo dueños o quien ve Compras
  // (misma regla que veCostosCompras en proveedores; se decide acá, en el servidor).
  const veProveedores = owner || puede(ctx.usuario, ctx.panelId, Modulo.COMPRAS, "ver");

  const producto = await obtener(ctx, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  // Precios mayoristas (escalones del cotizador): dueños o "editar" en Productos.
  const editaEscalones = owner || puede(ctx.usuario, ctx.panelId, Modulo.PRODUCTOS, "editar");
  const [depositos, movimientos, proveedores, escalones] = await Promise.all([
    listarDepositosActivos(ctx),
    listarMovimientos(ctx, { productoId: id, page: 1, pageSize: 20 }, { incluirCostos: owner }),
    veProveedores ? proveedoresDeProducto(ctx, id) : Promise.resolve(null),
    editaEscalones ? listarEscalones(ctx, id) : Promise.resolve(null),
  ]);

  return (
    <>
      <CabeceraProducto producto={producto} depositos={depositos} />
      <div className="flex flex-col gap-4">
        <SaboresProducto producto={producto} depositos={depositos} />
        {(escalones || proveedores) && (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {escalones && (
              <PreciosMayoristas
                productoId={id}
                precioLista={String(producto.precioVenta)}
                escalones={escalones}
              />
            )}
            {proveedores && (
              <ProveedoresProducto
                proveedores={proveedores}
                baseProveedores={rutaPanel(ctx.panel.slug, "/proveedores")}
              />
            )}
          </div>
        )}
        <SectionCard
          title="Últimos movimientos"
          description="Entradas, salidas y transferencias de todos los sabores."
        >
          <MovimientosProducto
            movimientos={movimientos.movimientos}
            total={movimientos.total}
            verCostos={owner}
            hrefTodos={rutaPanel(ctx.panel.slug, `/stock/movimientos?productoId=${id}`)}
          />
        </SectionCard>
      </div>
    </>
  );
}
