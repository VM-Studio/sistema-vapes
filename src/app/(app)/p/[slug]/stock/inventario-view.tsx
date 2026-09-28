"use client";

import { Modulo } from "@prisma/client";
import { ArrowLeftRight, Boxes, Download, History, SlidersVertical } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState, type ReactNode } from "react";

import {
  AjusteRapidoDialog,
  type VarianteParaAjuste,
} from "@/components/catalogo/ajuste-rapido-dialog";
import { EstadoStockBadge } from "@/components/catalogo/estado-stock-badge";
import { FiltrosCatalogo, type OpcionFiltro } from "@/components/catalogo/filtros-catalogo";
import { usePanel, useRutaPanel } from "@/components/layout/panel-context";
import { usePuede } from "@/components/layout/usuario-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChipLink, ChipRow } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { hrefCon, Pagination } from "@/components/ui/pagination";
import { SortHeader } from "@/components/ui/sort-header";
import { StatCard } from "@/components/ui/stat-card";
import { EscanearAbrirProducto } from "@/features/scanner/EscanearAbrirProducto";
import { formatearNumero } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  FilaStock,
  FiltrosStock,
  ResultadoStock,
  ResumenStock,
} from "@/server/services/inventario.service";

const ICONO = { strokeWidth: 1.75 } as const;

interface Props {
  resumen: ResumenStock;
  datos: ResultadoStock;
  filtros: FiltrosStock;
  params: Record<string, string>;
  categorias: OpcionFiltro[];
  marcas: OpcionFiltro[];
  /** Selector Global / depósito (lo arma el servidor). */
  selector: ReactNode;
}

export function InventarioView({
  resumen,
  datos,
  filtros,
  params,
  categorias,
  marcas,
  selector,
}: Props) {
  const panel = usePanel();
  const ruta = useRutaPanel();
  const puedeAjustar = usePuede(Modulo.STOCK, "editar");
  const puedeTransferir = usePuede(Modulo.STOCK, "crear");
  const [ajustando, setAjustando] = useState<VarianteParaAjuste | null>(null);
  const { depositos, deposito, filas } = datos;
  const PATH = ruta("/stock");

  const link = (cambios: Record<string, string | number | null>) =>
    hrefCon(PATH, params, { page: null, ...cambios });
  const sinFiltroRapido = !filtros.soloBajoMinimo && !filtros.soloSinStock && !filtros.soloConStock;
  const exportarHref = (formato: "xlsx" | "csv") =>
    hrefCon(`/api/p/${panel.slug}/stock/exportar`, params, { page: null, formato });
  // Columnas de cantidades: una por depósito + total en Global; solo la del depósito elegido si no.
  const columnas = deposito
    ? [{ id: "cantidad", nombre: `En ${deposito.nombre}`, orden: "cantidad" }]
    : [
        ...depositos.map((d) => ({ id: d.id, nombre: d.nombre, orden: `dep:${d.id}` })),
        { id: "total", nombre: "Total", orden: "cantidad" },
      ];
  const valor = (f: FilaStock, col: string) =>
    col === "cantidad" || col === "total" ? f.cantidad : (f.porDeposito[col] ?? 0);

  // Vista por producto: agrupar las filas de la página.
  const grupos = useMemo(() => {
    if (!filtros.agruparPorProducto) return null;
    const mapa = new Map<string, FilaStock[]>();
    for (const f of filas) mapa.set(f.productoId, [...(mapa.get(f.productoId) ?? []), f]);
    return [...mapa.values()];
  }, [filas, filtros.agruparPorProducto]);

  const acciones = (f: FilaStock, compacto: boolean) => {
    const origen = deposito
      ? f.cantidad > 0
        ? deposito
        : undefined
      : depositos.find((d) => (f.porDeposito[d.id] ?? 0) > 0);
    const clase = buttonVariants({ variant: "ghost", size: compacto ? "sm" : "icon" });
    const historial = ruta(
      `/stock/movimientos?varianteId=${f.varianteId}${deposito ? `&depositoId=${deposito.id}` : ""}`,
    );
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
            <SlidersVertical {...ICONO} />
            {compacto && "Ajustar"}
          </Button>
        )}
        {puedeTransferir && origen && depositos.length > 1 && (
          <Link
            href={ruta(
              `/stock/movimientos/transferencias/nueva?variante=${f.varianteId}&origen=${origen.id}`,
            )}
            className={clase}
            aria-label={`Transferir ${f.nombreCompleto}`}
            title="Transferir"
          >
            <ArrowLeftRight {...ICONO} />
            {compacto && "Transferir"}
          </Link>
        )}
        <Link
          href={historial}
          className={clase}
          aria-label={`Movimientos de ${f.nombreCompleto}`}
          title="Ver movimientos"
        >
          <History {...ICONO} />
          {compacto && "Historial"}
        </Link>
      </div>
    );
  };

  const filaTabla = (f: FilaStock, anidada = false) => (
    <tr
      key={f.varianteId}
      className={cn(
        f.estado === "BAJO" && "bg-warning-soft/50",
        f.estado === "SIN_STOCK" && "bg-danger-soft/40",
        f.estado === "OK" && "hover:bg-surface-2/40",
      )}
    >
      <td className={cn("px-4 py-2.5", anidada && "pl-10")}>
        <Link href={ruta(`/productos/${f.productoId}`)} className="font-medium hover:underline">
          {anidada ? (f.sabor ?? f.producto) : f.producto}
        </Link>
        {!anidada && f.sabor && <span className="text-muted block">{f.sabor}</span>}
      </td>
      <td className="text-muted px-4 py-2.5 font-mono text-xs whitespace-nowrap">{f.sku}</td>
      {columnas.map((c) => (
        <td
          key={c.id}
          className={cn(
            "px-4 py-2.5 text-right tabular-nums",
            (c.id === "total" || c.id === "cantidad") && "text-base font-semibold",
          )}
        >
          {valor(f, c.id)}
        </td>
      ))}
      <td className="text-muted px-4 py-2.5 text-right tabular-nums">{f.stockMinimo}</td>
      <td className="px-4 py-2.5">
        <EstadoStockBadge estado={f.estado} />
      </td>
      <td className="px-2 py-1.5">{acciones(f, false)}</td>
    </tr>
  );

  return (
    <>
      <PageHeader
        title="Stock"
        subtitle={
          deposito ? `Depósito ${deposito.nombre}` : "Global: todos los depósitos del panel"
        }
        actions={
          <>
            <EscanearAbrirProducto />
            <a
              href={exportarHref("xlsx")}
              className={buttonVariants({ variant: "secondary" })}
              download
            >
              <Download {...ICONO} /> Excel
            </a>
            <a href={exportarHref("csv")} className={buttonVariants({ variant: "ghost" })} download>
              CSV
            </a>
          </>
        }
      />

      {selector}

      <section aria-label="Resumen" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={deposito ? `Unidades en ${deposito.nombre}` : "Unidades totales"}
          value={formatearNumero(resumen.unidades)}
          hint={deposito ? "Solo este depósito" : `${depositos.length} depósitos activos`}
        />
        <div className="border-border bg-surface flex flex-col gap-2 rounded-2xl border p-4">
          <p className="text-muted text-sm font-medium">Por depósito</p>
          <ul className="flex flex-col gap-1">
            {resumen.porDeposito.map((d) => (
              <li key={d.id}>
                <Link
                  href={link({ depositoId: deposito?.id === d.id ? null : d.id })}
                  scroll={false}
                  className={cn(
                    "hover:bg-surface-2 flex min-h-9 items-center justify-between gap-2 rounded-lg px-2 text-sm",
                    deposito?.id === d.id && "bg-primary-soft text-primary",
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
        <StatCard
          label="Sin stock"
          value={formatearNumero(resumen.variantesSinStock)}
          hint={
            deposito ? `Variantes activas en 0 en ${deposito.nombre}` : "Variantes activas en 0"
          }
          href={link({ soloSinStock: filtros.soloSinStock ? null : "1", soloBajoMinimo: null })}
        />
      </section>

      <ChipRow ariaLabel="Filtros rápidos" className="mb-3">
        <ChipLink
          href={link({ soloBajoMinimo: null, soloSinStock: null, soloConStock: null })}
          activo={sinFiltroRapido}
        >
          Todos
        </ChipLink>
        <ChipLink
          href={link({ soloConStock: "1", soloBajoMinimo: null, soloSinStock: null })}
          activo={filtros.soloConStock}
        >
          Con stock
        </ChipLink>
        <ChipLink
          href={link({ soloBajoMinimo: "1", soloSinStock: null, soloConStock: null })}
          activo={filtros.soloBajoMinimo}
        >
          Bajo mínimo
        </ChipLink>
        <ChipLink
          href={link({ soloSinStock: "1", soloBajoMinimo: null, soloConStock: null })}
          activo={filtros.soloSinStock}
        >
          Sin stock
        </ChipLink>
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
        placeholder="Producto, variante, SKU o código…"
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
          <div className="border-border bg-surface hidden overflow-x-auto rounded-2xl border md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">
                {deposito ? `Stock en ${deposito.nombre}` : "Stock por depósito y total"}
              </caption>
              <thead className="border-border bg-surface-2/60 text-muted border-b text-xs tracking-wide uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium">
                    <SortHeader
                      campo="producto"
                      ordenActual={filtros.orden}
                      pathname={PATH}
                      params={params}
                    >
                      Producto · variante
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
                  {columnas.map((c) => (
                    <th key={c.id} scope="col" className="px-4 py-3 text-right font-medium">
                      <SortHeader
                        campo={c.orden}
                        ordenActual={filtros.orden}
                        pathname={PATH}
                        params={params}
                        alinearDerecha
                      >
                        {c.nombre}
                      </SortHeader>
                    </th>
                  ))}
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
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {grupos
                  ? grupos.map((g) => {
                      const primero = g[0]!;
                      return (
                        <Fragment key={primero.productoId}>
                          <tr className="bg-surface-2/50">
                            <td className="px-4 py-2.5 font-semibold" colSpan={2}>
                              <Link
                                href={ruta(`/productos/${primero.productoId}`)}
                                className="hover:underline"
                              >
                                {primero.producto}
                              </Link>
                              <span className="text-muted ml-2 text-xs font-normal">
                                {g.length} variantes
                              </span>
                            </td>
                            {columnas.map((c) => (
                              <td
                                key={c.id}
                                className="px-4 py-2.5 text-right font-semibold tabular-nums"
                              >
                                {g.reduce((a, f) => a + valor(f, c.id), 0)}
                              </td>
                            ))}
                            <td colSpan={3} />
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
                      "bg-surface rounded-2xl border p-4",
                      f.estado === "BAJO"
                        ? "border-warning-soft-foreground/30 bg-warning-soft/40"
                        : f.estado === "SIN_STOCK"
                          ? "border-danger/30 bg-danger-soft/30"
                          : "border-border",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={ruta(`/productos/${f.productoId}`)} className="font-medium">
                          {grupos ? (f.sabor ?? f.producto) : f.nombreCompleto}
                        </Link>
                        <p className="text-muted truncate font-mono text-xs">{f.sku}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-3xl leading-none font-bold tabular-nums">{f.cantidad}</p>
                        <p className="text-muted mt-1 text-xs">mín. {f.stockMinimo}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {!deposito &&
                        depositos.map((d) => (
                          <span
                            key={d.id}
                            className="bg-surface-2 rounded-full px-2.5 py-1 text-xs"
                          >
                            {d.nombre}{" "}
                            <strong className="tabular-nums">{f.porDeposito[d.id] ?? 0}</strong>
                          </span>
                        ))}
                      <EstadoStockBadge estado={f.estado} />
                    </div>
                    {acciones(f, true)}
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
        depositoInicial={deposito?.id}
        onOpenChange={(o) => !o && setAjustando(null)}
      />
    </>
  );
}
