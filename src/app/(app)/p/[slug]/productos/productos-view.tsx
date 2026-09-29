"use client";

import { Modulo } from "@prisma/client";
import { ChevronDown, ChevronRight, Package, Plus, ScanBarcode, Tags } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import { EstadoStockBadge } from "@/components/catalogo/estado-stock-badge";
import { useRutaPanel } from "@/components/layout/panel-context";
import { usePuede } from "@/components/layout/usuario-context";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ChipLink, ChipRow } from "@/components/ui/chip";
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

/** Título de la card en mobile: modelo + especificación (la marca va en un chip). */
const tituloCorto = (p: ProductoListado) => [p.modelo, p.especificacion].filter(Boolean).join(" ");
const nombreSabor = (p: ProductoListado, s: SaborListado) => s.sabor ?? p.nombreCompleto;

function PrecioSabor({ sabor }: { sabor: SaborListado }) {
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      {formatearPesos(sabor.precioVenta)}
      {sabor.tienePrecioPropio && (
        <Badge variant="primary" title="Este sabor tiene un precio distinto al del producto">
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
            {puedeCargar && (
              <Link
                href={ruta("/productos/cargar")}
                className={buttonVariants({ size: "lg", className: "basis-full md:basis-auto" })}
              >
                <ScanBarcode strokeWidth={1.75} /> Cargar stock (escanear)
              </Link>
            )}
            {puedeCrear && (
              <Link
                href={ruta("/productos/nuevo")}
                className={buttonVariants({ variant: "secondary", size: "lg" })}
              >
                <Plus strokeWidth={1.75} /> Nuevo producto
              </Link>
            )}
            <Link
              href={ruta("/productos/etiquetas")}
              className={buttonVariants({ variant: "secondary", size: "lg" })}
            >
              <Tags strokeWidth={1.75} /> Etiquetas
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <SearchInput placeholder="Buscar por nombre, sabor o código…" className="flex-1" />
          <EscanearAbrirProducto />
          <Select
            aria-label="Marca"
            options={[{ value: "", label: "Todas las marcas" }, ...marcas]}
            value={params.marcaId ?? ""}
            onChange={(e) => actualizar({ marcaId: e.target.value || null })}
            containerClassName="hidden w-48 md:block"
          />
        </div>
        <Select
          aria-label="Marca"
          options={[{ value: "", label: "Todas las marcas" }, ...marcas]}
          value={params.marcaId ?? ""}
          onChange={(e) => actualizar({ marcaId: e.target.value || null })}
          containerClassName="md:hidden"
        />
        <ChipRow ariaLabel="Filtros rápidos">
          <ChipLink
            href={hrefCon(base, params, { soloBajoMinimo: bajoMinimo ? null : "1", page: null })}
            activo={bajoMinimo}
          >
            Bajo mínimo
          </ChipLink>
          <ChipLink
            href={hrefCon(base, params, { inactivos: inactivos ? null : "1", page: null })}
            activo={inactivos}
          >
            Desactivados
          </ChipLink>
        </ChipRow>
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
                  <ScanBarcode strokeWidth={1.75} /> Cargar tu primer producto escaneando
                </Link>
              ) : null
            }
          />
        )
      ) : (
        <>
          {/* Desktop: tabla, cada producto se expande en sus sabores */}
          <div className="border-border bg-surface hidden overflow-x-auto rounded-2xl border md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Productos</caption>
              <thead className="border-border bg-surface-2/60 text-muted border-b text-xs tracking-wide uppercase">
                <tr>
                  <th scope="col" className="w-10" />
                  <th scope="col" className="px-3 py-3 text-left font-medium">
                    Producto
                  </th>
                  <th scope="col" className="px-3 py-3 text-left font-medium">
                    Código
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Precio
                  </th>
                  {depositos.map((d) => (
                    <th key={d.id} scope="col" className="px-3 py-3 text-right font-medium">
                      {d.nombre}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Total
                  </th>
                  <th scope="col" className="px-3 py-3 text-left font-medium">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {productos.map((p) => {
                  const abierto = expandidos.has(p.id);
                  return (
                    <Fragment key={p.id}>
                      <tr className="hover:bg-surface-2/40">
                        <td className="pl-2">
                          <button
                            type="button"
                            onClick={() => toggle(p.id)}
                            className="text-muted hover:bg-surface-2 flex size-9 items-center justify-center rounded-lg"
                            aria-expanded={abierto}
                            aria-label={`${abierto ? "Ocultar" : "Ver"} sabores de ${p.nombreCompleto}`}
                          >
                            {abierto ? (
                              <ChevronDown className="size-4" strokeWidth={1.75} />
                            ) : (
                              <ChevronRight className="size-4" strokeWidth={1.75} />
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-2.5">
                          <Link
                            href={ruta(`/productos/${p.id}`)}
                            className="font-medium hover:underline"
                          >
                            {p.nombreCompleto}
                          </Link>
                          {!p.activo && <Badge className="ml-2">Desactivado</Badge>}
                          <span className="text-muted block text-xs">
                            {p.sinSabores
                              ? "Sin sabores"
                              : `${p.sabores.length} sabor${p.sabores.length === 1 ? "" : "es"}`}
                            {p.categoria && ` · ${p.categoria}`}
                          </span>
                        </td>
                        <td className="text-muted px-3 py-2.5 font-mono text-xs">
                          {p.sinSabores ? (p.sabores[0]?.codigoBarras ?? "—") : ""}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                          {formatearPesos(p.precioVenta)}
                        </td>
                        {depositos.map((d) => (
                          <td key={d.id} className="px-3 py-2.5 text-right tabular-nums">
                            {p.stockPorDeposito[d.id] ?? 0}
                          </td>
                        ))}
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                          {formatearNumero(p.stockTotal)}
                        </td>
                        <td className="px-3 py-2.5">
                          <EstadoStockBadge estado={p.estado} />
                        </td>
                      </tr>
                      {abierto &&
                        p.sabores.map((s) => (
                          <tr
                            key={s.id}
                            aria-label={nombreSabor(p, s)}
                            data-testid="fila-sabor"
                            className={cn("bg-surface-2/30", !s.activo && "text-muted")}
                          >
                            <td />
                            <td className="py-2 pr-3 pl-6">
                              {nombreSabor(p, s)}
                              {!s.activo && <Badge className="ml-2">Inactivo</Badge>}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{s.codigoBarras ?? "—"}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <PrecioSabor sabor={s} />
                            </td>
                            {depositos.map((d) => (
                              <td
                                key={d.id}
                                data-deposito={d.nombre}
                                className="px-3 py-2 text-right tabular-nums"
                              >
                                {s.stockPorDeposito[d.id] ?? 0}
                              </td>
                            ))}
                            <td
                              data-deposito="Total"
                              className="px-3 py-2 text-right font-semibold tabular-nums"
                            >
                              {s.stockTotal}
                            </td>
                            <td className="px-3 py-2">
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

          {/* Mobile: card por producto; al tocarla, sus sabores con el stock por galpón */}
          <ul className="flex flex-col gap-2 md:hidden">
            {productos.map((p) => {
              const abierto = expandidos.has(p.id);
              return (
                <li key={p.id} className="border-border bg-surface rounded-2xl border">
                  <button
                    type="button"
                    onClick={() => toggle(p.id)}
                    aria-expanded={abierto}
                    className="flex w-full items-center gap-3 p-4 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="primary">{p.marca}</Badge>
                        {!p.activo && <Badge>Desactivado</Badge>}
                        {p.estado !== "OK" && <EstadoStockBadge estado={p.estado} />}
                      </div>
                      <p className="mt-1 truncate text-lg leading-tight font-semibold">
                        {tituloCorto(p)}
                      </p>
                      <p className="text-muted text-sm tabular-nums">
                        {formatearPesos(p.precioVenta)}
                        {!p.sinSabores &&
                          ` · ${p.sabores.length} sabor${p.sabores.length === 1 ? "" : "es"}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold tabular-nums">
                        {formatearNumero(p.stockTotal)}
                      </p>
                      <p className="text-muted text-xs">unidades</p>
                    </div>
                    <ChevronDown
                      className={cn(
                        "text-muted size-4 shrink-0 transition-transform",
                        abierto && "rotate-180",
                      )}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  </button>
                  {abierto && (
                    <div className="border-border border-t px-4 pt-2 pb-4">
                      <ul className="divide-border divide-y">
                        {p.sabores.map((s) => (
                          <li key={s.id} className="py-2.5">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className={cn("font-medium", !s.activo && "text-muted")}>
                                {nombreSabor(p, s)}
                              </span>
                              <span className="text-sm">
                                <PrecioSabor sabor={s} />
                              </span>
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {depositos.map((d) => (
                                <span
                                  key={d.id}
                                  className="bg-surface-2 rounded-[var(--radius-control)] px-2.5 py-1 text-xs"
                                >
                                  {d.nombre}{" "}
                                  <strong className="tabular-nums">
                                    {s.stockPorDeposito[d.id] ?? 0}
                                  </strong>
                                </span>
                              ))}
                              <span className="bg-primary-soft text-primary-soft-foreground rounded-[var(--radius-control)] px-2.5 py-1 text-xs">
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
                          size: "sm",
                          className: "mt-2 w-full",
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
    </>
  );
}
