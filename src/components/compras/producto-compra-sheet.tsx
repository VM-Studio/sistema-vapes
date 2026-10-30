"use client";

import { AlertTriangle, BadgeCheck, ExternalLink, Repeat } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { soloDecimal } from "@/components/compras/proveedor-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CantidadInput } from "@/components/ui/cantidad-input";
import { controlClass } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { fechaHoraCotizacion, type CotizacionVigente } from "@/lib/cambio";
import { pesosAMoneda } from "@/lib/costos-compra";
import { formatearMonto, formatearNumero, formatearPesos, formatearUsdt } from "@/lib/format";
import { cn, formatearFecha } from "@/lib/utils";
import type { ComparacionCompra, OfertaCompra } from "@/server/reportes/comparador";
import type { ProductoCatalogoCompra } from "@/server/services/compra.service";

export interface SaborAgregado {
  varianteId: string;
  sabor: string | null;
  sku: string;
  cantidad: number;
}

const num = (s: string) => Number(s.replace(",", ".")) || 0;

/**
 * Monto del comparador en USDT (moneda de Compras): en USDT tal cual; en
 * pesos, su equivalente con la cotización vigente ("≈ 5,70 USDT") o, sin
 * cotización, en pesos.
 */
export function montoCompraEnUsdt(
  monto: string | number,
  moneda: string,
  cotizacionUsdt: CotizacionVigente | null,
): string {
  if (moneda === "USDT") return formatearUsdt(monto);
  if (!cotizacionUsdt) return formatearMonto(monto, moneda);
  return `≈ ${formatearUsdt(pesosAMoneda(monto, cotizacionUsdt.valor))}`;
}

/**
 * Hoja de un producto dentro de la compra:
 * 1. Sabores del producto (si el proveedor actual lo vende: viene de su
 *    catálogo) con cantidad y el costo precargado con su precio → "Agregar".
 * 2. Quién lo vende y a cuánto, del más barato al más caro, en USDT (los
 *    precios en pesos, con su equivalente en USDT), con el proveedor de la compra y el
 *    más barato marcados. Si la compra no tiene productos de otro, se puede
 *    pasar la compra a otro proveedor desde acá; si no, se avisa.
 */
export function ProductoCompraSheet({
  abierto,
  onCerrar,
  nombreCompleto,
  proveedorActual,
  catalogo,
  comparacion,
  cotizacionUsdt,
  puedeCambiarProveedor,
  otrosProductos,
  hrefNuevaCompra,
  onAgregar,
  onCambiarProveedor,
}: {
  abierto: boolean;
  onCerrar: () => void;
  nombreCompleto: string;
  proveedorActual: string;
  /** El producto en el catálogo del proveedor actual (null = no lo tiene cargado). */
  catalogo: ProductoCatalogoCompra | null;
  /** null = cargando. */
  comparacion: ComparacionCompra | null;
  cotizacionUsdt: CotizacionVigente | null;
  /** Ids de proveedores activos a los que se puede pasar la compra. */
  puedeCambiarProveedor: (proveedorId: string) => boolean;
  /** Cuántos productos distintos de este ya tiene la compra (para el aviso). */
  otrosProductos: number;
  hrefNuevaCompra: (proveedorId: string) => string;
  onAgregar: (sabores: SaborAgregado[], costo: { valor: string; editado: boolean }) => void;
  onCambiarProveedor: (proveedorId: string) => void;
}) {
  const costoInicial = catalogo?.costoUsdt ? String(Number(catalogo.costoUsdt)) : "";
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [costo, setCosto] = useState(costoInicial);
  const [clave, setClave] = useState<string | null>(null);
  // Producto nuevo en la hoja: arrancar de cero.
  const claveActual = `${catalogo?.productoId ?? nombreCompleto}:${costoInicial}`;
  if (abierto && clave !== claveActual) {
    setClave(claveActual);
    setCantidades({});
    setCosto(costoInicial);
  }

  const sabores = catalogo?.sabores ?? [];
  const unidades = Object.values(cantidades).reduce((a, n) => a + n, 0);
  const unico = sabores.length === 1;

  function agregar() {
    onAgregar(
      sabores
        .filter((s) => (cantidades[s.varianteId] ?? 0) > 0)
        .map((s) => ({
          varianteId: s.varianteId,
          sabor: s.sabor,
          sku: s.sku,
          cantidad: cantidades[s.varianteId]!,
        })),
      { valor: costo.replace(",", "."), editado: costo !== costoInicial },
    );
  }

  return (
    <Sheet
      open={abierto}
      onOpenChange={(o) => !o && onCerrar()}
      title={nombreCompleto}
      description={
        catalogo ? (
          <>
            Precio de {proveedorActual}:{" "}
            <span className="text-foreground font-medium tabular-nums">
              {formatearMonto(catalogo.precio, catalogo.moneda)}
            </span>
            {catalogo.moneda !== "USDT" && catalogo.costoUsdt && (
              <span className="tabular-nums"> ≈ {formatearUsdt(catalogo.costoUsdt)}</span>
            )}{" "}
            · actualizado {formatearFecha(catalogo.actualizadoAt)}
          </>
        ) : (
          `${proveedorActual} no tiene precio cargado para este producto.`
        )
      }
      footer={
        catalogo ? (
          <>
            <Button variant="secondary" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button onClick={agregar} disabled={unidades === 0 || num(costo) <= 0}>
              {unidades > 0
                ? `Agregar ${formatearNumero(unidades)} u. · ${formatearUsdt((Math.round(num(costo) * 100) * unidades) / 100)}`
                : "Agregar a la compra"}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-6">
        {catalogo && (
          <section aria-labelledby="titulo-sabores" className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <h3 id="titulo-sabores" className="text-h3 font-semibold">
                {unico ? "Cantidad" : "Sabores"}
              </h3>
              <label className="text-muted text-small flex flex-col gap-1">
                Costo unitario (USDT)
                <input
                  inputMode="decimal"
                  aria-label="Costo unitario"
                  value={costo}
                  onChange={(e) => setCosto(soloDecimal(e.target.value))}
                  className={cn(controlClass, "h-11 w-32 text-right tabular-nums md:h-10")}
                />
              </label>
            </div>
            {catalogo.moneda !== "USDT" && catalogo.tipoCambio && (
              <p className="text-subtle text-xs">
                {formatearMonto(catalogo.precio, catalogo.moneda)} ÷{" "}
                {formatearPesos(catalogo.tipoCambio)} (cotización USDT de la compra).
              </p>
            )}
            {sabores.length === 0 ? (
              <p className="text-muted bg-surface rounded-control p-3 text-sm">
                El producto no tiene sabores activos.
              </p>
            ) : (
              <ul
                aria-label="Sabores para agregar"
                className="border-border divide-border rounded-control flex flex-col divide-y border"
              >
                {sabores.map((s) => {
                  const etiqueta = s.sabor ?? nombreCompleto;
                  return (
                    <li key={s.varianteId} className="flex items-center gap-3 px-3 py-2">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-medium">{s.sabor ?? "Sin sabor"}</span>
                        <span className="text-subtle text-xs">
                          {s.sku}
                          {s.stock !== null && ` · ${formatearNumero(s.stock)} en el galpón`}
                        </span>
                      </span>
                      <CantidadInput
                        etiqueta={`Cantidad a agregar de ${etiqueta}`}
                        valor={cantidades[s.varianteId] ?? 0}
                        min={0}
                        onCambio={(n) => setCantidades((c) => ({ ...c, [s.varianteId]: n }))}
                        className="w-20"
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        <section aria-labelledby="titulo-quien-vende" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 id="titulo-quien-vende" className="text-h3 font-semibold">
              Quién lo vende
            </h3>
            <p className="text-muted text-small">Del más barato al más caro.</p>
          </div>
          {comparacion === null ? (
            <div className="flex flex-col gap-2" aria-hidden>
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : comparacion.ofertas.length === 0 ? (
            <p className="text-muted bg-surface rounded-control p-3 text-sm">
              Ningún proveedor tiene precio cargado para este producto.
            </p>
          ) : (
            <>
              {comparacion.monedasSinConvertir && (
                <p className="bg-warning-soft text-warning-soft-foreground rounded-control flex items-start gap-2 p-3 text-sm">
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  Hay precios en pesos y en USDT sin cotización: se ordenan por separado.
                </p>
              )}
              {cotizacionUsdt && comparacion.ofertas.some((o) => o.moneda !== "USDT") && (
                <p className="text-subtle text-xs">
                  Precios en pesos pasados a USDT a {formatearPesos(cotizacionUsdt.valor)}{" "}
                  (cotización del {fechaHoraCotizacion(cotizacionUsdt.obtenidoAt)}) para comparar.
                </p>
              )}
              <ol aria-label="Proveedores que lo venden" className="flex flex-col gap-2">
                {comparacion.ofertas.map((o) => (
                  <FilaOferta
                    key={o.proveedorId}
                    o={o}
                    masBarato={comparacion.masBarato}
                    cotizacionUsdt={cotizacionUsdt}
                    puedeCambiar={puedeCambiarProveedor(o.proveedorId)}
                    otrosProductos={otrosProductos}
                    proveedorActual={proveedorActual}
                    hrefNuevaCompra={hrefNuevaCompra(o.proveedorId)}
                    onCambiar={() => onCambiarProveedor(o.proveedorId)}
                  />
                ))}
              </ol>
            </>
          )}
        </section>
      </div>
    </Sheet>
  );
}

function FilaOferta({
  o,
  masBarato,
  cotizacionUsdt,
  puedeCambiar,
  otrosProductos,
  proveedorActual,
  hrefNuevaCompra,
  onCambiar,
}: {
  o: OfertaCompra;
  masBarato: OfertaCompra | null;
  cotizacionUsdt: CotizacionVigente | null;
  puedeCambiar: boolean;
  otrosProductos: number;
  proveedorActual: string;
  hrefNuevaCompra: string;
  onCambiar: () => void;
}) {
  return (
    <li
      data-testid="oferta-compra"
      data-proveedor={o.proveedor}
      className={cn(
        "bg-surface rounded-control flex flex-col gap-2 border p-3",
        o.esActual ? "border-foreground" : "border-transparent",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="bg-foreground text-primary-foreground rounded-control flex size-8 shrink-0 items-center justify-center text-sm font-semibold tabular-nums">
          {o.posicion}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold">{o.proveedor}</span>
          <span className="text-muted text-small truncate">{o.tienda}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="font-semibold tabular-nums">
            {montoCompraEnUsdt(o.precio, o.moneda, cotizacionUsdt)}
          </span>
          {o.moneda !== "USDT" && (
            <span className="text-subtle text-xs tabular-nums">
              precio en pesos: {formatearMonto(o.precio, o.moneda)}
            </span>
          )}
          <span
            className={cn(
              "text-xs tabular-nums",
              o.masBarato ? "text-success font-medium" : "text-muted",
            )}
          >
            {o.masBarato
              ? "El mejor precio"
              : `+${
                  // Los dos en USDT: la diferencia exacta en USDT (sin pasar por pesos).
                  o.moneda === "USDT" && masBarato?.moneda === "USDT"
                    ? formatearUsdt(
                        (Math.round(Number(o.precio) * 100) -
                          Math.round(Number(masBarato.precio) * 100)) /
                          100,
                      )
                    : montoCompraEnUsdt(o.diferencia, o.grupo, cotizacionUsdt)
                } (+${o.diferenciaPct.toLocaleString("es-AR")} %)`}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {o.esActual && <Badge variant="primary">Proveedor de esta compra</Badge>}
        {o.masBarato && (
          <Badge variant="success">
            <BadgeCheck strokeWidth={1.75} aria-hidden /> Más barato
            {o.grupo === "USDT" ? " en USDT" : ""}
          </Badge>
        )}
        {o.desactualizado && (
          <Badge variant="warning">Precio del {formatearFecha(o.actualizadoAt)}</Badge>
        )}
        {!o.activo && <Badge>Inactivo</Badge>}
      </div>
      {!o.esActual &&
        o.activo &&
        (puedeCambiar ? (
          <Button variant="secondary" size="sm" className="max-md:h-11" onClick={onCambiar}>
            <Repeat strokeWidth={1.75} /> Comprarle a {o.proveedor}
          </Button>
        ) : (
          <p className="text-muted text-xs">
            La compra ya tiene {otrosProductos} {otrosProductos === 1 ? "producto" : "productos"}{" "}
            más de {proveedorActual}: para comprarle esto a {o.proveedor}, armá otra compra.{" "}
            <Link
              href={hrefNuevaCompra}
              target="_blank"
              className="text-foreground inline-flex items-center gap-1 font-medium underline underline-offset-4"
            >
              Nueva compra a {o.proveedor}
              <ExternalLink className="size-3" strokeWidth={1.75} aria-hidden />
            </Link>
          </p>
        ))}
    </li>
  );
}
