"use client";

import { Modulo } from "@prisma/client";
import { ChevronDown, ChevronRight, Download, Package, Percent, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import { EstadoStockBadge } from "@/components/catalogo/estado-stock-badge";
import { FiltrosCatalogo, type OpcionFiltro } from "@/components/catalogo/filtros-catalogo";
import { usePuede } from "@/components/layout/usuario-context";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { hrefCon, Pagination } from "@/components/ui/pagination";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DepositoBasico } from "@/server/services/deposito.service";
import type { ProductoListado } from "@/server/services/producto.service";

import { AumentoSheet } from "./aumento-sheet";

const PATH = "/productos";

function rangoPrecio(p: ProductoListado): string {
  if (!p.precioVentaMin) return "—";
  return p.precioVentaMin === p.precioVentaMax
    ? formatearPesos(p.precioVentaMin)
    : `${formatearPesos(p.precioVentaMin)} – ${formatearPesos(p.precioVentaMax)}`;
}

interface Props {
  resultado: { productos: ProductoListado[]; total: number; page: number; pageSize: number };
  depositos: DepositoBasico[];
  params: Record<string, string>;
  categorias: OpcionFiltro[];
  marcas: OpcionFiltro[];
}

export function ProductosView({ resultado, depositos, params, categorias, marcas }: Props) {
  const puedeCrear = usePuede(Modulo.PRODUCTOS, "crear");
  const puedeEditar = usePuede(Modulo.PRODUCTOS, "editar");
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [aumento, setAumento] = useState(false);
  const { productos } = resultado;

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
        subtitle={`${formatearNumero(resultado.total)} productos`}
        actions={
          <>
            {puedeEditar && (
              <Button
                variant="secondary"
                onClick={() => setAumento(true)}
                className="max-md:hidden"
              >
                <Percent /> Aumento masivo
              </Button>
            )}
            <a
              href={hrefCon("/api/productos/exportar", params, { page: null })}
              className={cn(buttonVariants({ variant: "secondary" }), "max-md:hidden")}
              download
            >
              <Download /> Exportar
            </a>
            {puedeCrear && (
              <Link href="/productos/importar" className={buttonVariants({ variant: "secondary" })}>
                <Upload /> Importar
              </Link>
            )}
            {puedeCrear && (
              <Link href="/productos/nuevo" className={buttonVariants()}>
                <Plus /> Nuevo
              </Link>
            )}
          </>
        }
      />

      <FiltrosCatalogo
        categorias={categorias}
        marcas={marcas}
        placeholder="Nombre, sabor, SKU o código de barras…"
        extras={[
          {
            tipo: "select",
            param: "estado",
            label: "Estado",
            valorPorDefecto: "activos",
            opciones: [
              { value: "activos", label: "Activos" },
              { value: "inactivos", label: "Inactivos" },
              { value: "todos", label: "Todos" },
            ],
          },
          { tipo: "check", param: "conStockBajo", label: "Solo stock bajo" },
        ]}
      />

      {productos.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No hay productos con esos filtros"
          action={
            puedeCrear && (
              <Link href="/productos/nuevo" className={buttonVariants()}>
                <Plus /> Nuevo producto
              </Link>
            )
          }
        />
      ) : (
        <>
          {/* Desktop: tabla expandible */}
          <div className="border-border bg-surface hidden overflow-x-auto rounded-xl border md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Productos</caption>
              <thead className="border-border bg-surface-2/60 text-muted border-b text-xs tracking-wide uppercase">
                <tr>
                  <th scope="col" className="w-10" />
                  <th scope="col" className="px-3 py-3 text-left font-medium">
                    Producto
                  </th>
                  <th scope="col" className="px-3 py-3 text-left font-medium">
                    Marca
                  </th>
                  <th scope="col" className="px-3 py-3 text-left font-medium">
                    Categoría
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Variantes
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Stock
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Precio
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
                            className="text-muted hover:bg-surface-2 flex size-9 items-center justify-center rounded-md"
                            aria-expanded={abierto}
                            aria-label={`${abierto ? "Ocultar" : "Ver"} variantes de ${p.nombre}`}
                          >
                            {abierto ? (
                              <ChevronDown className="size-4" />
                            ) : (
                              <ChevronRight className="size-4" />
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-2.5">
                          <Link href={`/productos/${p.id}`} className="font-medium hover:underline">
                            {p.nombre}
                          </Link>
                          {!p.activo && <Badge className="ml-2">Inactivo</Badge>}
                        </td>
                        <td className="text-muted px-3 py-2.5">{p.marca ?? "—"}</td>
                        <td className="text-muted px-3 py-2.5">{p.categoria}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {p.tieneVariantes ? p.variantes.length : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                          {formatearNumero(p.stockTotal)}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                          {rangoPrecio(p)}
                        </td>
                        <td className="px-3 py-2.5">
                          <EstadoStockBadge estado={p.estado} />
                        </td>
                      </tr>
                      {abierto && (
                        <tr className="bg-surface-2/30">
                          <td />
                          <td colSpan={7} className="px-3 pt-1 pb-3">
                            <table className="w-full text-sm">
                              <thead className="text-muted text-xs">
                                <tr>
                                  <th className="py-1.5 text-left font-medium">Variante</th>
                                  <th className="py-1.5 text-left font-medium">SKU</th>
                                  <th className="py-1.5 text-left font-medium">Código</th>
                                  {depositos.map((d) => (
                                    <th key={d.id} className="py-1.5 text-right font-medium">
                                      {d.nombre}
                                    </th>
                                  ))}
                                  <th className="py-1.5 text-right font-medium">Total</th>
                                  <th className="py-1.5 text-right font-medium">Precio</th>
                                  <th className="py-1.5 pl-3 text-left font-medium">Estado</th>
                                </tr>
                              </thead>
                              <tbody className="divide-border/60 divide-y">
                                {p.variantes.map((v) => (
                                  <tr key={v.id} className={cn(!v.activo && "text-muted")}>
                                    <td className="py-1.5">{v.nombre}</td>
                                    <td className="py-1.5 font-mono text-xs">{v.sku}</td>
                                    <td className="py-1.5 font-mono text-xs">
                                      {v.codigoBarras ?? "—"}
                                    </td>
                                    {depositos.map((d) => (
                                      <td key={d.id} className="py-1.5 text-right tabular-nums">
                                        {v.stockPorDeposito[d.id] ?? 0}
                                      </td>
                                    ))}
                                    <td className="py-1.5 text-right font-semibold tabular-nums">
                                      {v.stockTotal}
                                    </td>
                                    <td className="py-1.5 text-right tabular-nums">
                                      {formatearPesos(v.precioVenta)}
                                    </td>
                                    <td className="py-1.5 pl-3">
                                      {v.activo ? (
                                        <EstadoStockBadge estado={v.estado} />
                                      ) : (
                                        <Badge>Inactiva</Badge>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: card por producto → ficha */}
          <ul className="flex flex-col gap-2 md:hidden">
            {productos.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/productos/${p.id}`}
                  className="border-border bg-surface flex items-center gap-3 rounded-xl border p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.nombre}</p>
                    <p className="text-muted truncate text-sm">
                      {[
                        p.marca,
                        p.categoria,
                        p.tieneVariantes ? `${p.variantes.length} variantes` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <EstadoStockBadge estado={p.estado} />
                      {!p.activo && <Badge>Inactivo</Badge>}
                      <span className="text-muted text-xs tabular-nums">{rangoPrecio(p)}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold tabular-nums">
                      {formatearNumero(p.stockTotal)}
                    </p>
                    <p className="text-muted text-xs">unidades</p>
                  </div>
                  <ChevronRight className="text-muted size-4 shrink-0" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          <Pagination
            className="mt-4"
            page={resultado.page}
            pageSize={resultado.pageSize}
            total={resultado.total}
            pathname={PATH}
            params={params}
          />
        </>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 md:hidden">
        {puedeEditar && (
          <Button variant="secondary" onClick={() => setAumento(true)} className="min-w-0">
            <Percent /> Aumento masivo
          </Button>
        )}
        <a
          href={hrefCon("/api/productos/exportar", params, { page: null })}
          className={cn(
            buttonVariants({ variant: "secondary" }),
            "min-w-0",
            !puedeEditar && "col-span-2",
          )}
          download
        >
          <Download /> Exportar
        </a>
      </div>

      <AumentoSheet
        open={aumento}
        onOpenChange={setAumento}
        categorias={categorias}
        marcas={marcas}
      />
    </>
  );
}
