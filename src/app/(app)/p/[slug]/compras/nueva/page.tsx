import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { esFechaISO, hoyAR } from "@/lib/fechas";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerBorradorCompra } from "@/server/services/borrador-compra.service";
import { pesosAMoneda } from "@/lib/costos-compra";
import { formatearPesos } from "@/lib/format";
import { cotizacionResumenCompra, cotizacionUsdCompra } from "@/server/services/compra.service";
import { obtenerConfigCompras } from "@/server/services/configuracion.service";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import { obtenerVariantesPorId } from "@/server/services/producto.service";
import { listarProveedoresActivos } from "@/server/services/proveedor.service";

import { CompraForm } from "../compra-form";

export const metadata: Metadata = { title: "Nueva compra" };

type SP = Record<string, string | string[] | undefined>;

/**
 * ?proveedor=id preselecciona el proveedor (desde su ficha) · ?deposito=id
 * preselecciona el galpón · ?items=varianteId:cantidad,… precarga ítems
 * (ítems precargados por URL). El costo sugerido se
 * completa en el cliente apenas hay proveedor. ?borrador=id retoma un
 * borrador guardado (si ya no existe, arranca de cero).
 */
export default async function NuevaCompraPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.COMPRAS, "crear");
  const params = await searchParams;
  const [depositos, proveedores, configCompras, cotizacionUsdt, cotizacionUsd] = await Promise.all([
    listarDepositosActivos(ctx),
    listarProveedoresActivos(ctx),
    obtenerConfigCompras(ctx),
    cotizacionResumenCompra(null),
    cotizacionUsdCompra(null),
  ]);
  const depositoId =
    typeof params.deposito === "string" && depositos.some((d) => d.id === params.deposito)
      ? params.deposito
      : "";
  const proveedorId =
    typeof params.proveedor === "string" && proveedores.some((p) => p.id === params.proveedor)
      ? params.proveedor
      : "";
  const pedidos = new Map<string, number>();
  if (typeof params.items === "string") {
    for (const par of params.items.split(",").slice(0, 300)) {
      const [id, cant] = par.split(":");
      const n = Number(cant);
      if (id && Number.isInteger(n) && n > 0) pedidos.set(id, (pedidos.get(id) ?? 0) + n);
    }
  }
  const variantes = await obtenerVariantesPorId(ctx, [...pedidos.keys()]);
  const borrador =
    typeof params.borrador === "string"
      ? await obtenerBorradorCompra(ctx, params.borrador).catch((e: unknown) => {
          if (e instanceof NotFoundError) return null;
          throw e;
        })
      : null;

  if (borrador) {
    const d = borrador.datos;
    // Borrador de antes de que Compras pasara a USDT: sus costos están en
    // pesos → se pasan a USDT con la cotización vigente (y se avisa de dónde
    // salió); sin cotización, se vuelven a sugerir.
    const items =
      d.moneda === "USDT"
        ? d.items
        : d.items.map((i) => {
            const pesos = Number(i.costo.replace(",", "."));
            if (!i.costo || !Number.isFinite(pesos) || !cotizacionUsdt)
              return { ...i, costo: "", origenCosto: null, detalleUsdt: null };
            return {
              ...i,
              costo: String(pesosAMoneda(pesos, cotizacionUsdt.valor)),
              origenCosto: "manual" as const,
              detalleUsdt: `${formatearPesos(pesos)} ÷ ${formatearPesos(cotizacionUsdt.valor)}`,
            };
          });
    return (
      <CompraForm
        key={borrador.id}
        proveedores={proveedores}
        depositos={depositos}
        comisionDefault={configCompras.comisionPasistaPorcentajeDefault}
        cotizacionUsdt={cotizacionUsdt}
        cotizacionUsd={cotizacionUsd}
        inicial={{
          id: null,
          borrador: { id: borrador.id, updatedAt: borrador.updatedAt },
          comisionPasistaPorcentaje: null,
          comision: { activa: d.comisionActiva, porcentaje: d.comisionPct },
          gastos: [],
          proveedorId: proveedores.some((p) => p.id === d.proveedorId) ? d.proveedorId : "",
          depositoId: depositos.some((x) => x.id === d.depositoId) ? d.depositoId : "",
          fecha: esFechaISO(d.fecha) ? d.fecha : hoyAR(),
          notas: d.notas,
          items: items.map((i) => ({ ...i, detalleUsdt: i.detalleUsdt ?? null })),
        }}
      />
    );
  }

  return (
    <CompraForm
      proveedores={proveedores}
      depositos={depositos}
      comisionDefault={configCompras.comisionPasistaPorcentajeDefault}
      cotizacionUsdt={cotizacionUsdt}
      cotizacionUsd={cotizacionUsd}
      inicial={{
        id: null,
        comisionPasistaPorcentaje: null,
        gastos: [],
        proveedorId,
        depositoId,
        fecha: hoyAR(),
        notas: "",
        items: variantes.map((v) => ({
          varianteId: v.varianteId,
          productoId: v.productoId,
          nombreCompleto: v.nombreCompleto,
          sabor: v.sabor,
          sku: v.sku,
          cantidad: String(pedidos.get(v.varianteId) ?? 1),
          costo: "",
          origenCosto: null,
        })),
      }}
    />
  );
}
