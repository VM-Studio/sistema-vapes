import { Modulo } from "@prisma/client";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/ui/section-card";
import { rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import { obtenerCotizacion } from "@/server/services/cambio.service";
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

type SP = Record<string, string | string[] | undefined>;

export default async function FichaProductoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  const ctx = await requirePaginaPanel(Modulo.PRODUCTOS, "ver");
  const { id } = await params;
  const sp = await searchParams;
  const texto = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
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
  // Movimientos solo de este producto: por sabor (de este producto) y galpón, paginados.
  const msabor = producto.sabores.some((s) => s.id === texto("msabor"))
    ? texto("msabor")
    : undefined;
  const mpage = Math.max(1, Number(texto("mpage")) || 1);
  const depositos = await listarDepositosActivos(ctx);
  const mgalpon = depositos.some((d) => d.id === texto("mgalpon")) ? texto("mgalpon") : undefined;
  const [movimientos, proveedores, escalones, blue] = await Promise.all([
    listarMovimientos(
      ctx,
      { productoId: id, varianteId: msabor, depositoId: mgalpon, page: mpage, pageSize: 20 },
      { incluirCostos: owner },
    ),
    veProveedores ? proveedoresDeProducto(ctx, id) : Promise.resolve(null),
    editaEscalones ? listarEscalones(ctx, id) : Promise.resolve(null),
    editaEscalones ? obtenerCotizacion("USD_BLUE", "VENTA") : Promise.resolve(null),
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
                blue={blue ? { valor: blue.valor, obtenidoAt: blue.obtenidoAt } : null}
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
          title={<span id="movimientos-producto">Movimientos de este producto</span>}
          description="Ventas, compras, ajustes, transferencias y retiros de sus sabores: entradas en verde, salidas en rojo."
        >
          <MovimientosProducto
            productoId={id}
            movimientos={movimientos.movimientos}
            total={movimientos.total}
            page={movimientos.page}
            pageSize={movimientos.pageSize}
            sabores={
              producto.sinSabores
                ? []
                : producto.sabores.map((s) => ({ id: s.id, nombre: s.sabor ?? s.nombre }))
            }
            depositos={depositos.map((d) => ({ id: d.id, nombre: d.nombre }))}
          />
        </SectionCard>
      </div>
    </>
  );
}
