"use client";

import { ChevronDown, Coins, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useRutaPanel } from "@/components/layout/panel-context";
import { Badge } from "@/components/ui/badge";
import { ChipRow, FilterChip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { formatearDolares, formatearNumero, formatearPesos, formatearUsdt } from "@/lib/format";
import { cn, formatearFecha } from "@/lib/utils";
import type { CostoProducto, CostoSabor, ListadoCostos } from "@/server/services/costos.service";

const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Orden = "nombre" | "mayor" | "menor";
type Filtro = "todos" | "sinCosto";

const ORIGEN: Record<NonNullable<CostoSabor["origen"]>, string> = {
  COMPRA_RECIBIDA: "compra",
  COSTOS_FINALES_COMPRA: "gastos de compra",
  INGRESO_MANUAL: "carga de stock",
};

/**
 * Listado de costos: buscador, filtro por marca, «Sin costo» y orden. Cada
 * producto muestra su costo por unidad en USDT (o el rango si sus sabores
 * cuestan distinto) con la referencia en pesos y dólares de hoy, el precio de
 * venta y el margen; tocándolo se abre el detalle por sabor.
 */
export function CostosView({
  productos,
  cotizacion,
  etiquetaEspecificacion,
}: ListadoCostos & { etiquetaEspecificacion: string }) {
  const ruta = useRutaPanel();
  const [texto, setTexto] = useState("");
  const [marca, setMarca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [orden, setOrden] = useState<Orden>("nombre");
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const marcas = useMemo(
    () => [...new Set(productos.map((p) => p.marca))].sort((a, b) => a.localeCompare(b, "es")),
    [productos],
  );
  const conCosto = productos.filter((p) => p.saboresSinCosto === 0).length;
  const sinCosto = productos.filter((p) => p.saboresSinCosto > 0).length;

  const visibles = useMemo(() => {
    const palabras = sinAcentos(texto).split(/\s+/).filter(Boolean);
    const lista = productos.filter((p) => {
      if (marca && p.marca !== marca) return false;
      if (filtro === "sinCosto" && p.saboresSinCosto === 0) return false;
      if (!palabras.length) return true;
      const t = sinAcentos(
        `${p.titulo} ${p.categoria ?? ""} ${p.sabores.map((s) => `${s.sabor ?? ""} ${s.sku}`).join(" ")}`,
      );
      return palabras.every((x) => t.includes(x));
    });
    const valor = (p: CostoProducto) => (p.costoMax === null ? null : Number(p.costoMax));
    if (orden === "nombre") return lista;
    return [...lista].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      if (va === null) return vb === null ? 0 : 1;
      if (vb === null) return -1;
      return orden === "mayor" ? vb - va : va - vb;
    });
  }, [productos, texto, marca, filtro, orden]);

  const alternar = (id: string) =>
    setAbiertos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <PageHeader
        title="Costos"
        subtitle={
          <>
            A cuánto compran cada producto: el costo final por unidad (lo que le pagaron al
            proveedor + pasista + gastos) de la última compra recibida, o el que cargaron con el
            stock.
            {cotizacion && (
              <span className="text-small block pt-1">
                Pesos y dólares de referencia, a la cotización de hoy: USDT{" "}
                {formatearPesos(cotizacion.usdt)} · Blue {formatearPesos(cotizacion.usd)}.
              </span>
            )}
          </>
        }
      />

      <section
        aria-label="Resumen"
        className="mb-4 grid grid-cols-3 gap-2 md:gap-3"
        data-testid="resumen-costos"
      >
        <Resumen etiqueta="Productos" valor={formatearNumero(productos.length)} />
        <Resumen etiqueta="Con costo completo" valor={formatearNumero(conCosto)} />
        <Resumen
          etiqueta="Les falta costo"
          valor={formatearNumero(sinCosto)}
          alerta={sinCosto > 0}
        />
      </section>

      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative md:max-w-sm md:flex-1">
          <Search
            className="text-muted pointer-events-none absolute top-1/2 left-3.5 size-[1.125rem] -translate-y-1/2"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar modelo, marca o sabor"
            aria-label="Buscar modelo, marca o sabor"
            className={cn(
              controlClass,
              "h-11 pr-11 pl-10.5 md:h-10 [&::-webkit-search-cancel-button]:hidden",
            )}
          />
          {texto && (
            <button
              type="button"
              onClick={() => setTexto("")}
              className="text-muted hover:bg-surface-2 hover:text-foreground rounded-control absolute top-1/2 right-1.5 flex size-9 -translate-y-1/2 items-center justify-center"
              aria-label="Limpiar búsqueda"
            >
              <X className="size-4" strokeWidth={1.75} aria-hidden />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <select
            value={marca}
            onChange={(e) => setMarca(e.target.value)}
            aria-label="Marca"
            className={cn(controlClass, "h-11 md:h-10 md:w-48")}
          >
            <option value="">Todas las marcas</option>
            {marcas.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={orden}
            onChange={(e) => setOrden(e.target.value as Orden)}
            aria-label="Ordenar"
            className={cn(controlClass, "h-11 md:h-10 md:w-48")}
          >
            <option value="nombre">Ordenar por nombre</option>
            <option value="mayor">Más caros primero</option>
            <option value="menor">Más baratos primero</option>
          </select>
        </div>
      </div>
      <ChipRow ariaLabel="Filtrar" className="mb-4">
        <FilterChip activo={filtro === "todos"} onClick={() => setFiltro("todos")}>
          Todos
        </FilterChip>
        <FilterChip activo={filtro === "sinCosto"} onClick={() => setFiltro("sinCosto")}>
          Sin costo cargado
        </FilterChip>
      </ChipRow>

      {visibles.length === 0 ? (
        <EmptyState
          icon={Coins}
          title={productos.length === 0 ? "Todavía no hay productos" : "Nada coincide"}
          description={
            productos.length === 0
              ? "Cuando carguen productos y compras, sus costos aparecen acá."
              : "Probá con otra búsqueda o sacá los filtros."
          }
        />
      ) : (
        <ul aria-label="Costos de los productos" className="flex flex-col gap-2">
          {visibles.map((p) => {
            const abierto = abiertos.has(p.productoId);
            const espec = p.especificacion.trim();
            const variosSabores = p.sabores.length > 1 || p.sabores[0]?.sabor !== null;
            return (
              <li
                key={p.productoId}
                className="bg-card border-border rounded-card border"
                data-testid="costo-producto"
              >
                <button
                  type="button"
                  onClick={() => alternar(p.productoId)}
                  aria-expanded={abierto}
                  className="flex w-full flex-col gap-3 p-4 text-left md:flex-row md:items-center md:gap-6"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-semibold">
                      {p.marca} {p.modelo}
                    </span>
                    <span className="text-muted text-small">
                      {[
                        espec ? `${espec} ${etiquetaEspecificacion.toLowerCase()}` : null,
                        p.categoria,
                        variosSabores
                          ? `${p.sabores.length} ${p.sabores.length === 1 ? "sabor" : "sabores"}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="flex items-end justify-between gap-4 md:contents">
                    <CostoCelda
                      min={p.costoMin}
                      max={p.costoMax}
                      cotizacion={cotizacion}
                      sinCosto={p.saboresSinCosto}
                      total={p.sabores.length}
                    />
                    <span className="flex flex-col items-end md:w-32">
                      <span className="text-muted text-xs">Precio de venta</span>
                      <span className="text-sm font-medium tabular-nums">
                        {formatearPesos(p.precioVenta)}
                      </span>
                      <Margen
                        precio={p.precioVenta}
                        costoUsdt={p.costoMax}
                        cotizacion={cotizacion}
                      />
                    </span>
                    <ChevronDown
                      className={cn(
                        "text-subtle size-5 shrink-0 transition-transform",
                        abierto && "rotate-180",
                      )}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  </span>
                </button>
                {abierto && (
                  <div className="border-border border-t px-4 pt-2 pb-4">
                    <ul className="divide-border flex flex-col divide-y" aria-label="Por sabor">
                      {p.sabores.map((s) => (
                        <li
                          key={s.varianteId}
                          className="flex flex-col gap-1 py-2.5 md:flex-row md:items-center md:gap-6"
                        >
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="text-sm font-medium">{s.sabor ?? "Sin sabor"}</span>
                            <span className="text-muted text-xs">
                              {s.sku} · stock {formatearNumero(s.stock)}
                              {s.actualizadoAt &&
                                ` · costo del ${formatearFecha(s.actualizadoAt)}${
                                  s.origen
                                    ? ` (${ORIGEN[s.origen]}${s.compraNumero ? ` #${s.compraNumero}` : ""})`
                                    : ""
                                }`}
                            </span>
                          </span>
                          <span className="flex items-baseline justify-between gap-4 md:contents">
                            <span className="flex flex-col md:w-60 md:items-end">
                              {s.costoUsdt === null ? (
                                <Badge variant="warning">Sin costo</Badge>
                              ) : (
                                <>
                                  <span className="text-sm font-semibold tabular-nums">
                                    {formatearUsdt(s.costoUsdt)}
                                  </span>
                                  {cotizacion && (
                                    <span className="text-muted text-xs tabular-nums">
                                      {referencia(s.costoUsdt, cotizacion)}
                                    </span>
                                  )}
                                </>
                              )}
                            </span>
                            <span className="flex flex-col items-end md:w-32">
                              <span className="text-sm tabular-nums">
                                {formatearPesos(s.precioVenta)}
                              </span>
                              <Margen
                                precio={s.precioVenta}
                                costoUsdt={s.costoUsdt}
                                cotizacion={cotizacion}
                              />
                            </span>
                            <span className="hidden w-5 md:block" aria-hidden />
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Link
                      href={ruta(`/productos/${p.productoId}`)}
                      className="text-marca-azul text-small mt-2 inline-flex font-semibold underline-offset-4 hover:underline"
                    >
                      Ver el producto
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** "$ 21.000 · US$ 13,30": el costo en USDT pasado a pesos y dólares con las cotizaciones de hoy. */
function referencia(usdt: string, c: { usdt: string; usd: string }) {
  const pesos = Math.round(Number(usdt) * Number(c.usdt) * 100) / 100;
  return `${formatearPesos(pesos)} · ${formatearDolares(Math.round((pesos / Number(c.usd)) * 100) / 100)}`;
}

function CostoCelda({
  min,
  max,
  cotizacion,
  sinCosto,
  total,
}: {
  min: string | null;
  max: string | null;
  cotizacion: { usdt: string; usd: string } | null;
  sinCosto: number;
  total: number;
}) {
  if (min === null || max === null)
    return (
      <span className="flex flex-col md:w-60 md:items-end">
        <span className="text-muted text-xs">Costo por unidad</span>
        <Badge variant="warning">Sin costo cargado</Badge>
      </span>
    );
  const igual = min === max;
  return (
    <span className="flex flex-col md:w-60 md:items-end" data-testid="costo-unidad">
      <span className="text-muted text-xs">Costo por unidad</span>
      <span className="text-base font-semibold whitespace-nowrap tabular-nums">
        {igual ? formatearUsdt(min) : `${formatearUsdt(min)} a ${formatearUsdt(max)}`}
      </span>
      {cotizacion && igual && (
        <span className="text-muted text-xs tabular-nums">{referencia(min, cotizacion)}</span>
      )}
      {sinCosto > 0 && (
        <span className="text-warning-soft-foreground text-xs">
          {sinCosto === total ? "sin costo" : `${sinCosto} de ${total} sabores sin costo`}
        </span>
      )}
    </span>
  );
}

/** Margen sobre el precio de venta, con el costo pasado a pesos a la cotización de hoy. */
function Margen({
  precio,
  costoUsdt,
  cotizacion,
}: {
  precio: string;
  costoUsdt: string | null;
  cotizacion: { usdt: string; usd: string } | null;
}) {
  if (costoUsdt === null || !cotizacion || !(Number(precio) > 0)) return null;
  const costo = Number(costoUsdt) * Number(cotizacion.usdt);
  const pct = Math.round(((Number(precio) - costo) / Number(precio)) * 1000) / 10;
  return (
    <span className={cn("text-xs tabular-nums", pct < 0 ? "text-danger" : "text-muted")}>
      margen {pct.toLocaleString("es-AR")} %
    </span>
  );
}

function Resumen({
  etiqueta,
  valor,
  alerta = false,
  className,
}: {
  etiqueta: string;
  valor: string;
  alerta?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("bg-card rounded-card flex flex-col gap-1 p-3 md:p-4", className)}>
      <span className="text-muted md:text-small text-xs">{etiqueta}</span>
      <span
        className={cn(
          "text-h2 font-semibold tabular-nums",
          alerta && "text-warning-soft-foreground",
        )}
      >
        {valor}
      </span>
    </div>
  );
}
