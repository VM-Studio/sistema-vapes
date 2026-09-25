"use client";

import { Modulo } from "@prisma/client";
import { ArrowLeftRight, Boxes, Download, History, SlidersVertical } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";

import {
  AjusteRapidoDialog,
  type VarianteParaAjuste,
} from "@/components/catalogo/ajuste-rapido-dialog";
import { EstadoStockBadge } from "@/components/catalogo/estado-stock-badge";
import { FiltrosCatalogo, type OpcionFiltro } from "@/components/catalogo/filtros-catalogo";
import { usePuede } from "@/components/layout/usuario-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChipLink, ChipRow } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { hrefCon, Pagination } from "@/components/ui/pagination";
import { SortHeader } from "@/components/ui/sort-header";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EscanearAbrirProducto } from "@/features/scanner/EscanearAbrirProducto";
import type {
  FilaInventario,
  FiltrosInventario,
  ResultadoInventario,
  ResumenInventario,
} from "@/server/services/inventario.service";

const PATH = "/inventario";

interface Props {
  resumen: ResumenInventario;
  datos: ResultadoInventario;
  filtros: FiltrosInventario;
  params: Record<string, string>;
  categorias: OpcionFiltro[];
  marcas: OpcionFiltro[];
}

export function InventarioView({ resumen, datos, filtros, params, categorias, marcas }: Props) {
  const puedeAjustar = usePuede(Modulo.MOVIMIENTOS, "editar");
  const puedeTransferir = usePuede(Modulo.MOVIMIENTOS, "crear");
  const puedeVerMovimientos = usePuede(Modulo.MOVIMIENTOS, "ver");
  const [ajustando, setAjustando] = useState<VarianteParaAjuste | null>(null);
  const { depositos, filas } = datos;

  const link = (cambios: Record<string, string | number | null>) =>
    hrefCon(PATH, params, { page: null, ...cambios });
  const sinFiltroRapido = !filtros.soloBajoMinimo && !filtros.soloSinStock && !filtros.depositoId;
  const exportarHref = hrefCon("/api/inventario/exportar", params, { page: null });

  // Vista por producto: agrupar las filas de la página.
  const grupos = useMemo(() => {
    if (!filtros.agruparPorProducto) return null;
    const mapa = new Map<string, FilaInventario[]>();
    for (const f of filas) mapa.set(f.productoId, [...(mapa.get(f.productoId) ?? []), f]);
    return [...mapa.values()];
  }, [filas, filtros.agruparPorProducto]);

  const acciones = (f: FilaInventario, compacto: boolean) => {
    const conStock = depositos.find((d) => (f.porDeposito[d.id] ?? 0) > 0);
    const clase = buttonVariants({ variant: "ghost", size: compacto ? "sm" : "icon" });
    return (
      <div
        className={cn(
          "flex gap-1",
          compacto ? "border-border mt-3 grid grid-cols-3 border-t pt-3" : "justify-end",
        )}
      >
        {puedeAjustar && (
          <Button
            variant="ghost"
            size={compacto ? "sm" : "icon"}
            onClick={() =>
              setAjustando({
                varianteId: f.varianteId,
                nombre: f.nombreCompleto,
                porDeposito: f.porDeposito,
              })
            }
            aria-label={`Ajustar stock de ${f.nombreCompleto}`}
            title="Ajustar stock"
          >
            <SlidersVertical />
            {compacto && "Ajustar"}
          </Button>
        )}
        {puedeTransferir && conStock && (
          <Link
            href={`/movimientos/transferencias/nueva?variante=${f.varianteId}&origen=${conStock.id}`}
            className={clase}
            aria-label={`Transferir ${f.nombreCompleto}`}
            title="Transferir"
          >
            <ArrowLeftRight />
            {compacto && "Transferir"}
          </Link>
        )}
        {puedeVerMovimientos && (
          <Link
            href={`/movimientos?varianteId=${f.varianteId}`}
            className={clase}
            aria-label={`Movimientos de ${f.nombreCompleto}`}
            title="Ver movimientos"
          >
            <History />
            {compacto && "Historial"}
          </Link>
        )}
      </div>
    );
  };

  const hayAcciones = puedeAjustar || puedeTransferir || puedeVerMovimientos;

  const filaTabla = (f: FilaInventario, anidada = false) => (
    <tr
      key={f.varianteId}
      className={cn(
        f.estado === "BAJO" && "bg-warning-soft/50",
        f.estado === "SIN_STOCK" && "bg-danger-soft/40",
        f.estado === "OK" && "hover:bg-surface-2/40",
      )}
    >
      <td className={cn("px-4 py-2.5", anidada && "pl-10")}>
        <Link href={`/productos/${f.productoId}`} className="font-medium hover:underline">
          {anidada ? f.variante : f.producto}
        </Link>
        {!anidada && f.tieneVariantes && <span className="text-muted block">{f.variante}</span>}
      </td>
      <td className="text-muted px-4 py-2.5 font-mono text-xs whitespace-nowrap">{f.sku}</td>
      {depositos.map((d) => (
        <td key={d.id} className="px-4 py-2.5 text-right tabular-nums">
          {f.porDeposito[d.id] ?? 0}
        </td>
      ))}
      <td className="px-4 py-2.5 text-right text-base font-semibold tabular-nums">{f.total}</td>
      <td className="text-muted px-4 py-2.5 text-right tabular-nums">{f.stockMinimo}</td>
      <td className="px-4 py-2.5">
        <EstadoStockBadge estado={f.estado} />
      </td>
      {resumen.valorizacion && (
        <td className="text-muted px-4 py-2.5 text-right tabular-nums">
          {formatearPesos(f.valorizacion?.valorCosto)}
        </td>
      )}
      {hayAcciones && <td className="px-2 py-1.5">{acciones(f, false)}</td>}
    </tr>
  );

  return (
    <>
      <PageHeader
        title="Inventario"
        subtitle="Stock por depósito y consolidado"
        actions={
          <>
            <EscanearAbrirProducto />
            <a href={exportarHref} className={buttonVariants({ variant: "secondary" })} download>
              <Download /> Exportar CSV
            </a>
          </>
        }
      />

      {/* Cabecera: 4 tarjetas */}
      <section aria-label="Resumen" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Unidades totales"
          value={formatearNumero(resumen.unidadesTotales)}
          hint={`${depositos.length} depósitos activos`}
        />
        <div className="border-border bg-surface flex flex-col gap-2 rounded-xl border p-4">
          <p className="text-muted text-xs font-medium tracking-wide uppercase">Por depósito</p>
          <ul className="flex flex-col gap-1.5">
            {resumen.porDeposito.map((d) => (
              <li key={d.id}>
                <Link
                  href={link({ depositoId: filtros.depositoId === d.id ? null : d.id })}
                  scroll={false}
                  className={cn(
                    "hover:bg-surface-2 flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm",
                    filtros.depositoId === d.id && "bg-primary-soft text-primary-soft-foreground",
                  )}
                >
                  <span className="truncate">{d.nombre}</span>
                  <span className="font-semibold tabular-nums">{formatearNumero(d.unidades)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <StatCard
          label="Bajo mínimo"
          value={formatearNumero(resumen.variantesBajoMinimo)}
          hint={resumen.variantesBajoMinimo > 0 ? "Tocá para verlas" : "Todo en orden"}
          tono={resumen.variantesBajoMinimo > 0 ? "alerta" : "ok"}
          href={link({ soloBajoMinimo: filtros.soloBajoMinimo ? null : "1", soloSinStock: null })}
        />
        {resumen.valorizacion ? (
          <StatCard
            label="Valor a costo"
            value={formatearPesos(resumen.valorizacion.valorCosto)}
            hint={`A venta: ${formatearPesos(resumen.valorizacion.valorVenta)}`}
          />
        ) : (
          <StatCard
            label="Sin stock"
            value={formatearNumero(resumen.variantesSinStock)}
            hint="Variantes activas en 0"
            href={link({ soloSinStock: "1", soloBajoMinimo: null })}
          />
        )}
      </section>

      {/* Filtros rápidos */}
      <ChipRow ariaLabel="Filtros rápidos" className="mb-3">
        <ChipLink
          href={link({ soloBajoMinimo: null, soloSinStock: null, depositoId: null })}
          activo={sinFiltroRapido}
        >
          Todos
        </ChipLink>
        <ChipLink
          href={link({ soloBajoMinimo: "1", soloSinStock: null })}
          activo={filtros.soloBajoMinimo}
        >
          Bajo mínimo
        </ChipLink>
        <ChipLink
          href={link({ soloSinStock: "1", soloBajoMinimo: null })}
          activo={filtros.soloSinStock}
        >
          Sin stock
        </ChipLink>
        {depositos.map((d) => (
          <ChipLink
            key={d.id}
            href={link({ depositoId: filtros.depositoId === d.id ? null : d.id })}
            activo={filtros.depositoId === d.id}
          >
            En {d.nombre}
          </ChipLink>
        ))}
        <span className="bg-border mx-1 hidden w-px self-stretch md:block" aria-hidden />
        <ChipLink href={link({ agruparPorProducto: null })} activo={!filtros.agruparPorProducto}>
          Por variante
        </ChipLink>
        <ChipLink
          href={link({ agruparPorProducto: "producto" })}
          activo={filtros.agruparPorProducto}
        >
          Por producto
        </ChipLink>
      </ChipRow>

      <FiltrosCatalogo
        categorias={categorias}
        marcas={marcas}
        placeholder="Producto, sabor, SKU o código…"
      />

      {filas.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No hay variantes con esos filtros"
          description="Probá quitando algún filtro."
        />
      ) : (
        <>
          {/* Desktop */}
          <div className="border-border bg-surface hidden overflow-x-auto rounded-xl border md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Stock consolidado</caption>
              <thead className="border-border bg-surface-2/60 text-muted border-b text-xs tracking-wide uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium">
                    <SortHeader
                      campo="producto"
                      ordenActual={filtros.orden}
                      pathname={PATH}
                      params={params}
                    >
                      Producto · sabor
                    </SortHeader>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">
                    <SortHeader
                      campo="sku"
                      ordenActual={filtros.orden}
                      pathname={PATH}
                      params={params}
                    >
                      SKU
                    </SortHeader>
                  </th>
                  {depositos.map((d) => (
                    <th key={d.id} scope="col" className="px-4 py-3 text-right font-medium">
                      <SortHeader
                        campo={`dep:${d.id}`}
                        ordenActual={filtros.orden}
                        pathname={PATH}
                        params={params}
                        alinearDerecha
                      >
                        {d.nombre}
                      </SortHeader>
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    <SortHeader
                      campo="total"
                      ordenActual={filtros.orden}
                      pathname={PATH}
                      params={params}
                      alinearDerecha
                    >
                      Total
                    </SortHeader>
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    <SortHeader
                      campo="minimo"
                      ordenActual={filtros.orden}
                      pathname={PATH}
                      params={params}
                      alinearDerecha
                    >
                      Mínimo
                    </SortHeader>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">
                    <SortHeader
                      campo="estado"
                      ordenActual={filtros.orden}
                      pathname={PATH}
                      params={params}
                    >
                      Estado
                    </SortHeader>
                  </th>
                  {resumen.valorizacion && (
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Valor costo
                    </th>
                  )}
                  {hayAcciones && (
                    <th scope="col" className="px-4 py-3">
                      <span className="sr-only">Acciones</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {grupos
                  ? grupos.map((g) => {
                      const primero = g[0]!;
                      const subtotal = (depId: string) =>
                        g.reduce((a, f) => a + (f.porDeposito[depId] ?? 0), 0);
                      return (
                        <Fragment key={primero.productoId}>
                          <tr className="bg-surface-2/50">
                            <td className="px-4 py-2.5 font-semibold" colSpan={2}>
                              <Link
                                href={`/productos/${primero.productoId}`}
                                className="hover:underline"
                              >
                                {primero.producto}
                              </Link>
                              <span className="text-muted ml-2 text-xs font-normal">
                                {g.length} variantes
                              </span>
                            </td>
                            {depositos.map((d) => (
                              <td
                                key={d.id}
                                className="px-4 py-2.5 text-right font-semibold tabular-nums"
                              >
                                {subtotal(d.id)}
                              </td>
                            ))}
                            <td className="px-4 py-2.5 text-right text-base font-bold tabular-nums">
                              {g.reduce((a, f) => a + f.total, 0)}
                            </td>
                            <td
                              colSpan={2 + (resumen.valorizacion ? 1 : 0) + (hayAcciones ? 1 : 0)}
                            />
                          </tr>
                          {g.map((f) => filaTabla(f, true))}
                        </Fragment>
                      );
                    })
                  : filas.map((f) => filaTabla(f))}
              </tbody>
            </table>
          </div>

          {/* Mobile: una card por variante */}
          <ul className="flex flex-col gap-2 md:hidden">
            {filas.map((f, i) => {
              const nuevoProducto =
                grupos && (i === 0 || filas[i - 1]!.productoId !== f.productoId);
              return (
                <Fragment key={f.varianteId}>
                  {nuevoProducto && (
                    <li className="text-muted mt-2 px-1 text-sm font-semibold">{f.producto}</li>
                  )}
                  <li
                    className={cn(
                      "bg-surface rounded-xl border p-4",
                      f.estado === "BAJO"
                        ? "border-warning-soft-foreground/30 bg-warning-soft/40"
                        : f.estado === "SIN_STOCK"
                          ? "border-danger/30 bg-danger-soft/30"
                          : "border-border",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/productos/${f.productoId}`} className="font-medium">
                          {grupos ? f.variante : f.nombreCompleto}
                        </Link>
                        <p className="text-muted truncate font-mono text-xs">{f.sku}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-3xl leading-none font-bold tabular-nums">{f.total}</p>
                        <p className="text-muted mt-1 text-xs">mín. {f.stockMinimo}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {depositos.map((d) => (
                        <span key={d.id} className="bg-surface-2 rounded-full px-2.5 py-1 text-xs">
                          {d.nombre}{" "}
                          <strong className="tabular-nums">{f.porDeposito[d.id] ?? 0}</strong>
                        </span>
                      ))}
                      <EstadoStockBadge estado={f.estado} />
                    </div>
                    {hayAcciones && acciones(f, true)}
                  </li>
                </Fragment>
              );
            })}
          </ul>

          <Pagination
            className="mt-4"
            page={datos.page}
            pageSize={datos.pageSize}
            total={datos.total}
            pathname={PATH}
            params={params}
          />
          {filtros.agruparPorProducto && (
            <p className="text-muted mt-1 text-xs">
              En la vista por producto se pagina por producto.
            </p>
          )}
        </>
      )}

      <AjusteRapidoDialog
        key={ajustando?.varianteId ?? "cerrado"}
        variante={ajustando}
        depositos={depositos}
        depositoInicial={filtros.depositoId}
        onOpenChange={(o) => !o && setAjustando(null)}
      />
    </>
  );
}
