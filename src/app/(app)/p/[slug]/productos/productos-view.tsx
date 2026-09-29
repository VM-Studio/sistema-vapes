"use client";

import { Modulo } from "@prisma/client";
import { ChevronDown, ChevronRight, Package, Plus, ScanLine, Tags } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import { EstadoStockBadge } from "@/components/catalogo/estado-stock-badge";
import { useRutaPanel } from "@/components/layout/panel-context";
import { usePuede } from "@/components/layout/usuario-context";
import { Badge } from "@/components/ui/badge";
import { BarraAccion } from "@/components/ui/barra-accion";
import { buttonVariants } from "@/components/ui/button";
import { ChipLink } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { hrefCon, Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { EscanearAbrirProducto } from "@/features/scanner/EscanearAbrirProducto";
import { useUrlParams } from "@/hooks/use-url-params";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DepositoBasico } from "@/server/services/deposito.service";
import type { ProductoListado, SaborListado } from "@/server/services/producto.service";

interface Props {
  resultado: { productos: ProductoListado[]; total: number; page: number; pageSize: number };
  depositos: DepositoBasico[];
  params: Record<string, string>;
  marcas: { value: string; label: string }[];
}

/** Celda de encabezado (mismo aspecto que DataTable). */
const TH = "h-10 px-4 font-medium whitespace-nowrap";

/** Título de la card en mobile: modelo + especificación (la marca va en un chip). */
const tituloCorto = (p: ProductoListado) => [p.modelo, p.especificacion].filter(Boolean).join(" ");
const nombreSabor = (p: ProductoListado, s: SaborListado) => s.sabor ?? p.nombreCompleto;

function PrecioSabor({ sabor }: { sabor: SaborListado }) {
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      {formatearPesos(sabor.precioVenta)}
      {sabor.tienePrecioPropio && (
        <Badge title="Este sabor tiene un precio distinto al del producto">
          propio
        </Badge>
      )}
    </span>
  );
}

export function ProductosView({ resultado, depositos, params, marcas }: Props) {
  const ruta = useRutaPanel();
  const { actualizar } = useUrlParams();
  const puedeCrear = usePuede(Modulo.PRODUCTOS, "crear");
  const puedeCargarStock = usePuede(Modulo.STOCK, "crear");
  const puedeCargar = puedeCrear || puedeCargarStock;
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const { productos } = resultado;
  const base = ruta("/productos");
  const bajoMinimo = params.soloBajoMinimo === "1";
  const inactivos = params.inactivos === "1";
  const conFiltros = Object.entries(params).some(([k, v]) => k !== "page" && v !== "");

  const toggle = (id: string) =>
    setExpandidos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <PageHeader
        title="Productos"
        subtitle={`${formatearNumero(resultado.total)} producto${resultado.total === 1 ? "" : "s"}`}
        actions={
          <>
            <Link
              href={ruta("/productos/etiquetas")}
              className={buttonVariants({ variant: "ghost", size: "lg" })}
            >
              <Tags strokeWidth={1.75} /> Etiquetas
            </Link>
            {puedeCrear && (
              <Link
                href={ruta("/productos/nuevo")}
                className={buttonVariants({ variant: "secondary", size: "lg" })}
              >
                <Plus strokeWidth={1.75} /> Nuevo producto
              </Link>
            )}
            {puedeCargar && (
              <Link
                href={ruta("/productos/cargar")}
                className={cn(buttonVariants({ size: "lg" }), "hidden md:inline-flex")}
              >
                <ScanLine strokeWidth={1.75} /> Cargar stock (escanear)
              </Link>
            )}
          </>
        }
      />

      {/* Barra de filtros: buscador + cámara · marca · filtros rápidos */}
      <div
        role="search"
        aria-label="Filtrar productos"
        className="mb-4 flex flex-col gap-2 md:flex-row md:items-center"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <SearchInput placeholder="Buscar por nombre, sabor o código…" className="flex-1" />
          <EscanearAbrirProducto />
        </div>
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 md:mx-0 md:overflow-visible md:px-0">
          <Select
            aria-label="Marca"
            options={[{ value: "", label: "Todas las marcas" }, ...marcas]}
            value={params.marcaId ?? ""}
            onChange={(e) => actualizar({ marcaId: e.target.value || null })}
            containerClassName="w-48 shrink-0"
          />
          <ChipLink
            href={hrefCon(base, params, { soloBajoMinimo: bajoMinimo ? null : "1", page: null })}
            activo={bajoMinimo}
            className="h-11 md:h-10"
          >
            Bajo mínimo
          </ChipLink>
          <ChipLink
            href={hrefCon(base, params, { inactivos: inactivos ? null : "1", page: null })}
            activo={inactivos}
            className="h-11 md:h-10"
          >
            Desactivados
          </ChipLink>
        </div>
      </div>

      {productos.length === 0 ? (
        conFiltros ? (
          <EmptyState
            icon={Package}
            title="No hay productos con esos filtros"
            action={
              <Link href={base} className={buttonVariants({ variant: "secondary" })}>
                Limpiar filtros
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={Package}
            title="Todavía no hay productos"
            description="Escaneá el código de barras de cada producto para darlo de alta y cargar su stock."
            action={
              puedeCrear ? (
                <Link href={ruta("/productos/cargar")} className={buttonVariants()}>
                  <ScanLine strokeWidth={1.75} /> Cargar tu primer producto escaneando
                </Link>
              ) : null
            }
          />
        )
      ) : (
        <>
          {/* Desktop: tabla, cada producto se expande en sus sabores */}
          <div className="border-border bg-surface hidden overflow-x-auto rounded-card border md:block">
            <table className="w-full text-left text-sm tabular-nums">
              <caption className="sr-only">Productos</caption>
              <thead className="border-border bg-card text-muted border-b text-xs">
                <tr>
                  <th scope="col" className="w-12">
                    <span className="sr-only">Sabores</span>
                  </th>
                  <th scope="col" className={TH}>
                    Producto
                  </th>
                  <th scope="col" className={TH}>
                    Código
                  </th>
                  <th scope="col" className={cn(TH, "text-right")}>
                    Precio
                  </th>
                  {depositos.map((d) => (
                    <th key={d.id} scope="col" className={cn(TH, "text-right")}>
                      {d.nombre}
                    </th>
                  ))}
                  <th scope="col" className={cn(TH, "text-right")}>
                    Total
                  </th>
                  <th scope="col" className={TH}>
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {productos.map((p) => {
                  const abierto = expandidos.has(p.id);
                  return (
                    <Fragment key={p.id}>
                      <tr
                        className={cn(
                          "transition-colors",
                          abierto ? "bg-card" : "hover:bg-card/60",
                        )}
                      >
                        <td className="pl-2">
                          <button
                            type="button"
                            onClick={() => toggle(p.id)}
                            className="text-muted hover:bg-surface-3 hover:text-foreground flex size-9 items-center justify-center rounded-control transition-colors"
                            aria-expanded={abierto}
                            aria-label={`${abierto ? "Ocultar" : "Ver"} sabores de ${p.nombreCompleto}`}
                          >
                            <ChevronRight
                              className={cn("size-5 transition-transform", abierto && "rotate-90")}
                              strokeWidth={1.75}
                              aria-hidden
                            />
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Link
                              href={ruta(`/productos/${p.id}`)}
                              className="font-medium hover:underline"
                            >
                              {p.nombreCompleto}
                            </Link>
                            {!p.activo && <Badge>Desactivado</Badge>}
                          </div>
                          <span className="text-subtle block text-xs">
                            {p.sinSabores
                              ? "Sin sabores"
                              : `${p.sabores.length} sabor${p.sabores.length === 1 ? "" : "es"}`}
                            {p.categoria && ` · ${p.categoria}`}
                          </span>
                        </td>
                        <td className="text-muted px-4 py-3 font-mono text-xs">
                          {p.sinSabores ? (p.sabores[0]?.codigoBarras ?? "—") : ""}
                        </td>
                        <td className="px-4 py-3 text-right font-medium whitespace-nowrap">
                          {formatearPesos(p.precioVenta)}
                        </td>
                        {depositos.map((d) => (
                          <td key={d.id} className="text-muted px-4 py-3 text-right">
                            {formatearNumero(p.stockPorDeposito[d.id] ?? 0)}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right text-base font-semibold">
                          {formatearNumero(p.stockTotal)}
                        </td>
                        <td className="px-4 py-3">
                          <EstadoStockBadge estado={p.estado} sobreGris={abierto} />
                        </td>
                      </tr>
                      {abierto &&
                        p.sabores.map((s) => (
                          <tr
                            key={s.id}
                            aria-label={nombreSabor(p, s)}
                            data-testid="fila-sabor"
                            className={cn("bg-surface text-sm", !s.activo && "text-muted")}
                          >
                            <td className="bg-card" />
                            <td className="border-border border-l py-2.5 pr-4 pl-5">
                              <span className="inline-flex items-center gap-2">
                                {nombreSabor(p, s)}
                                {!s.activo && <Badge>Inactivo</Badge>}
                              </span>
                            </td>
                            <td className="text-muted px-4 py-2.5 font-mono text-xs">
                              {s.codigoBarras ?? "—"}
                            </td>
                            <td className="px-4 py-2.5 text-right whitespace-nowrap">
                              <PrecioSabor sabor={s} />
                            </td>
                            {depositos.map((d) => (
                              <td
                                key={d.id}
                                data-deposito={d.nombre}
                                className="text-muted px-4 py-2.5 text-right"
                              >
                                {s.stockPorDeposito[d.id] ?? 0}
                              </td>
                            ))}
                            <td
                              data-deposito="Total"
                              className="px-4 py-2.5 text-right font-semibold"
                            >
                              {s.stockTotal}
                            </td>
                            <td className="px-4 py-2.5">
                              <EstadoStockBadge estado={s.estado} />
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: tarjeta por producto; al tocarla, sus sabores con el stock por galpón */}
          <ul className="flex flex-col gap-2 md:hidden">
            {productos.map((p) => {
              const abierto = expandidos.has(p.id);
              return (
                <li key={p.id} className="bg-card rounded-card">
                  <button
                    type="button"
                    onClick={() => toggle(p.id)}
                    aria-expanded={abierto}
                    className="flex w-full flex-col gap-3 p-4 text-left"
                  >
                    <div className="flex w-full items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge className="bg-surface-3 text-foreground">{p.marca}</Badge>
                          {!p.activo && <Badge>Desactivado</Badge>}
                          {p.estado !== "OK" && <EstadoStockBadge estado={p.estado} sobreGris />}
                        </div>
                        <p className="text-h3 truncate font-semibold">{tituloCorto(p)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-body font-semibold tabular-nums">
                          {formatearPesos(p.precioVenta)}
                        </span>
                        <ChevronDown
                          className={cn(
                            "text-muted size-5 transition-transform",
                            abierto && "rotate-180",
                          )}
                          strokeWidth={1.75}
                          aria-hidden
                        />
                      </div>
                    </div>
                    <div className="flex w-full items-end justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap gap-1.5">
                        {depositos.map((d) => (
                          <span
                            key={d.id}
                            className="bg-surface text-muted rounded-control px-2 py-1 text-xs"
                          >
                            {d.nombre}{" "}
                            <strong className="text-foreground font-semibold tabular-nums">
                              {formatearNumero(p.stockPorDeposito[d.id] ?? 0)}
                            </strong>
                          </span>
                        ))}
                      </div>
                      <p className="shrink-0 text-right leading-none">
                        <span className="block text-2xl font-semibold tracking-tight tabular-nums">
                          {formatearNumero(p.stockTotal)}
                        </span>
                        <span className="text-subtle text-xs">
                          {p.sinSabores
                            ? "unidades"
                            : `u. · ${p.sabores.length} sabor${p.sabores.length === 1 ? "" : "es"}`}
                        </span>
                      </p>
                    </div>
                  </button>
                  {abierto && (
                    <div className="px-4 pb-4">
                      <ul className="bg-surface divide-border divide-y rounded-control px-3">
                        {p.sabores.map((s) => (
                          <li key={s.id} className="py-3">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className={cn("font-medium", !s.activo && "text-muted")}>
                                {nombreSabor(p, s)}
                              </span>
                              <span className="text-sm">
                                <PrecioSabor sabor={s} />
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {depositos.map((d) => (
                                <span
                                  key={d.id}
                                  className="bg-card text-muted rounded-control px-2 py-1 text-xs"
                                >
                                  {d.nombre}{" "}
                                  <strong className="text-foreground tabular-nums">
                                    {s.stockPorDeposito[d.id] ?? 0}
                                  </strong>
                                </span>
                              ))}
                              <span className="bg-surface-3 rounded-control px-2 py-1 text-xs">
                                Total <strong className="tabular-nums">{s.stockTotal}</strong>
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <Link
                        href={ruta(`/productos/${p.id}`)}
                        className={buttonVariants({
                          variant: "secondary",
                          className: "mt-3 w-full",
                        })}
                      >
                        Ver ficha
                      </Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <Pagination
            className="mt-4"
            page={resultado.page}
            pageSize={resultado.pageSize}
            total={resultado.total}
            pathname={base}
            params={params}
          />
        </>
      )}
      {puedeCargar && (
        <BarraAccion soloMobile>
          <Link href={ruta("/productos/cargar")} className={buttonVariants({ size: "lg" })}>
            <ScanLine strokeWidth={1.75} /> Cargar stock (escanear)
          </Link>
        </BarraAccion>
      )}
    </>
  );
}
