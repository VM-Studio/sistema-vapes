"use client";

import { Modulo } from "@prisma/client";
import {
  ArrowLeftRight,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Download,
  History,
  ScanBarcode,
  SlidersVertical,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";

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
import { TabsNav } from "@/components/ui/tabs-nav";
import { formatearNumero } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FilaStock, ResultadoStock } from "@/server/services/inventario.service";
import type { ResultadoLedger, ResumenStockPanel } from "@/server/services/stock.service";

import { FiltrosMovimientosStock, TablaMovimientos } from "./tabla-movimientos";
import { TransferirSheet, type FilaATransferir } from "./transferir-sheet";

const ICONO = { strokeWidth: 1.75 } as const;

interface Props {
  resumen: ResumenStockPanel;
  /** Galpón de la pestaña (null = Global). */
  depositoId: string | null;
  datos: ResultadoStock;
  porProducto: boolean;
  soloBajoMinimo: boolean;
  ledger: ResultadoLedger;
  params: Record<string, string>;
  marcas: OpcionFiltro[];
  /** Exportar CSV: solo dueños. */
  puedeExportar: boolean;
}

/** Código visible de un sabor: el de barras si tiene, si no el SKU. */
const codigoDe = (f: FilaStock) => f.codigoBarras ?? f.sku;

export function StockView({
  resumen,
  depositoId,
  datos,
  porProducto,
  soloBajoMinimo,
  ledger,
  params,
  marcas,
  puedeExportar,
}: Props) {
  const panel = usePanel();
  const ruta = useRutaPanel();
  const puedeAjustar = usePuede(Modulo.STOCK, "editar");
  const puedeTransferir = usePuede(Modulo.STOCK, "crear");
  const [ajustando, setAjustando] = useState<VarianteParaAjuste | null>(null);
  const [transfiriendo, setTransfiriendo] = useState<FilaATransferir | null>(null);

  const PATH = ruta("/stock");
  const depositos = resumen.porDeposito;
  const deposito = depositos.find((d) => d.id === depositoId) ?? null;
  const otros = depositos.filter((d) => d.id !== depositoId);
  const { filas } = datos;
  const conFiltros = Boolean(
    params.q || params.marcaId || params.categoriaId || params.soloBajoMinimo === "1",
  );

  const link = (cambios: Record<string, string | number | null>) =>
    hrefCon(PATH, params, { page: null, ...cambios });
  /** Cambiar de pestaña conserva la búsqueda y la marca; el resto se reinicia. */
  const linkTab = (tab: string) => hrefCon(PATH, { q: params.q, marcaId: params.marcaId }, { tab });
  const exportarHref = hrefCon(`/api/p/${panel.slug}/stock/exportar`, params, {
    formato: "csv",
    page: null,
    tab: null,
    depositoId: deposito?.id ?? null,
    agruparPorProducto: porProducto ? "producto" : null,
  });

  const grupos = useMemo(() => {
    if (!porProducto) return null;
    const mapa = new Map<string, FilaStock[]>();
    for (const f of filas) mapa.set(f.productoId, [...(mapa.get(f.productoId) ?? []), f]);
    return [...mapa.values()];
  }, [filas, porProducto]);

  const acciones = (f: FilaStock, compacto: boolean) => {
    if (!deposito) return null;
    const destinoUnico = otros.length === 1 ? otros[0]! : null;
    const puedeMover = puedeTransferir && otros.length > 0 && f.cantidad > 0;
    if (!puedeMover && !puedeAjustar) return null;
    return (
      <div
        className={cn("flex gap-2", compacto ? "border-border mt-3 border-t pt-3" : "justify-end")}
      >
        {puedeMover && (
          <Button
            variant="secondary"
            size="sm"
            className={cn(compacto && "flex-1")}
            onClick={() =>
              setTransfiriendo({
                varianteId: f.varianteId,
                nombre: f.nombreCompleto,
                disponible: f.cantidad,
              })
            }
            aria-label={`Transferir ${f.nombreCompleto} a ${destinoUnico?.nombre ?? "otro galpón"}`}
          >
            <ArrowLeftRight {...ICONO} />
            {destinoUnico ? `Transferir a ${destinoUnico.nombre}` : "Transferir"}
          </Button>
        )}
        {puedeAjustar && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(compacto && "flex-1")}
            onClick={() =>
              setAjustando({
                varianteId: f.varianteId,
                nombre: f.nombreCompleto,
                porDeposito: f.porDeposito,
              })
            }
            aria-label={`Ajustar stock de ${f.nombreCompleto}`}
          >
            <SlidersVertical {...ICONO} />
            Ajustar
          </Button>
        )}
      </div>
    );
  };

  // Columnas de cantidades: la del galpón, o una por galpón + Total en Global.
  const columnas = deposito
    ? [{ id: "cantidad", nombre: "Cantidad" }]
    : [...depositos.map((d) => ({ id: d.id, nombre: d.nombre })), { id: "total", nombre: "Total" }];
  const valor = (f: FilaStock, col: string) =>
    col === "cantidad" || col === "total" ? f.cantidad : (f.porDeposito[col] ?? 0);

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
          {anidada ? (f.sabor ?? f.producto) : f.nombreCompleto}
        </Link>
      </td>
      <td className="text-muted px-4 py-2.5 font-mono text-xs whitespace-nowrap">{codigoDe(f)}</td>
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
      {deposito && <td className="px-2 py-1.5">{acciones(f, false)}</td>}
    </tr>
  );

  const titulo = deposito ? deposito.nombre : "Global";
  const paginasLedger = Math.max(1, Math.ceil(ledger.total / ledger.pageSize));

  return (
    <>
      <PageHeader
        title="Stock"
        subtitle={
          deposito
            ? `Galpón ${deposito.nombre}: su stock y sus movimientos`
            : "Todos los galpones del panel y el total"
        }
        actions={
          <>
            <Link
              href={ruta("/stock/movimientos/transferencias")}
              className={buttonVariants({ variant: "ghost" })}
            >
              <ArrowLeftRight {...ICONO} /> Transferencias
            </Link>
            {puedeExportar && (
              <a href={exportarHref} className={buttonVariants({ variant: "secondary" })} download>
                <Download {...ICONO} /> Exportar CSV
              </a>
            )}
          </>
        }
      />

      <TabsNav
        className="mb-4"
        ariaLabel="Galpones"
        items={[
          ...depositos.map((d) => ({
            href: linkTab(d.id),
            label: d.nombre,
            activo: d.id === depositoId,
          })),
          { href: linkTab("global"), label: "Global", activo: !deposito },
        ]}
      />

      {deposito ? (
        <section aria-label="Resumen del galpón" className="mb-4 grid grid-cols-2 gap-3">
          <div className="border-border bg-surface flex flex-col gap-1 rounded-2xl border p-4">
            <p className="text-muted text-sm font-medium">Unidades en {deposito.nombre}</p>
            <p className="text-3xl leading-tight font-bold tabular-nums lg:text-4xl">
              {formatearNumero(deposito.unidades)}
            </p>
          </div>
          <Link
            href={link({ soloBajoMinimo: soloBajoMinimo ? null : "1" })}
            scroll={false}
            className={cn(
              "border-border bg-surface hover:bg-surface-2/60 flex flex-col gap-1 rounded-2xl border p-4 transition-colors",
              soloBajoMinimo && "border-primary",
            )}
          >
            <p className="text-muted text-sm font-medium">Bajo mínimo</p>
            <p
              className={cn(
                "text-3xl leading-tight font-bold tabular-nums lg:text-4xl",
                deposito.bajoMinimo > 0 ? "text-danger" : "text-success",
              )}
            >
              {formatearNumero(deposito.bajoMinimo)}
            </p>
            <p className="text-muted text-xs">
              {soloBajoMinimo ? "Tocá para ver todos" : "Sabores con menos que el mínimo acá"}
            </p>
          </Link>
        </section>
      ) : (
        <section aria-label="Resumen global" className="mb-4 flex flex-col gap-3">
          <div className="border-border bg-surface flex flex-wrap items-end justify-between gap-3 rounded-2xl border p-4">
            <div>
              <p className="text-muted text-sm font-medium">Unidades en todos los galpones</p>
              <p className="text-4xl leading-tight font-bold tabular-nums">
                {formatearNumero(resumen.total)}
              </p>
            </div>
            <Link
              href={link({ soloBajoMinimo: soloBajoMinimo ? null : "1" })}
              scroll={false}
              className={cn(
                "rounded-xl px-3 py-2 text-sm font-medium",
                resumen.bajoMinimo > 0
                  ? "bg-danger-soft text-danger-soft-foreground"
                  : "bg-success-soft text-success-soft-foreground",
              )}
            >
              {formatearNumero(resumen.bajoMinimo)} bajo mínimo
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Por galpón">
            {depositos.map((d) => (
              <li key={d.id}>
                <Link
                  href={linkTab(d.id)}
                  className="border-border bg-surface hover:bg-surface-2/60 flex flex-col gap-0.5 rounded-2xl border p-3 transition-colors"
                >
                  <span className="text-muted flex items-center gap-1.5 truncate text-sm">
                    <Warehouse className="size-4 shrink-0" {...ICONO} aria-hidden />
                    {d.nombre}
                  </span>
                  <span className="text-2xl font-semibold tabular-nums">
                    {formatearNumero(d.unidades)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!deposito && (
        <ChipRow ariaLabel="Vista" className="mb-3">
          <ChipLink href={link({ vista: null })} activo={!porProducto}>
            Por sabor
          </ChipLink>
          <ChipLink href={link({ vista: "producto" })} activo={porProducto}>
            Por producto
          </ChipLink>
        </ChipRow>
      )}

      <FiltrosCatalogo
        marcas={marcas}
        extras={[{ tipo: "check", param: "soloBajoMinimo", label: "Solo bajo mínimo" }]}
        placeholder="Producto, sabor, SKU o código…"
      />

      {filas.length === 0 ? (
        conFiltros ? (
          <EmptyState
            icon={Boxes}
            title="No hay sabores con esos filtros"
            description="Probá quitando algún filtro."
            action={
              <Link
                href={link({ q: null, marcaId: null, categoriaId: null, soloBajoMinimo: null })}
                className={buttonVariants({ variant: "secondary" })}
              >
                Limpiar filtros
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={Boxes}
            title={deposito ? `Todavía no hay stock en ${deposito.nombre}` : "Todavía no hay stock"}
            description="El stock aparece acá cuando cargás productos escaneándolos o recibís una compra."
            action={
              puedeTransferir ? (
                <Link href={ruta("/productos/cargar")} className={buttonVariants()}>
                  <ScanBarcode {...ICONO} /> Cargar stock escaneando
                </Link>
              ) : null
            }
          />
        )
      ) : (
        <>
          <div className="border-border bg-surface hidden overflow-x-auto rounded-2xl border md:block">
            <table className="w-full text-sm" data-testid="tabla-stock">
              <caption className="sr-only">
                {deposito ? `Stock en ${deposito.nombre}` : "Stock por galpón y total"}
              </caption>
              <thead className="border-border bg-surface-2/60 text-muted border-b text-xs tracking-wide uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium">
                    Producto — sabor
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">
                    Código
                  </th>
                  {columnas.map((c) => (
                    <th key={c.id} scope="col" className="px-4 py-3 text-right font-medium">
                      {c.nombre}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Mínimo
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">
                    Estado
                  </th>
                  {deposito && (
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
                                {g.length} {g.length === 1 ? "sabor" : "sabores"}
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
                            <td colSpan={2} />
                          </tr>
                          {g.map((f) => filaTabla(f, true))}
                        </Fragment>
                      );
                    })
                  : filas.map((f) => filaTabla(f))}
              </tbody>
            </table>
          </div>

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
                        <p className="text-muted truncate font-mono text-xs">{codigoDe(f)}</p>
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
                            className="bg-surface-2 rounded-[var(--radius-control)] px-2.5 py-1 text-xs"
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
          {porProducto && (
            <p className="text-muted mt-1 text-xs">
              En la vista por producto se pagina por producto.
            </p>
          )}
        </>
      )}

      <section aria-labelledby="titulo-movimientos" className="mt-10 flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="titulo-movimientos" className="flex items-center gap-2 text-lg font-semibold">
            <History className="text-muted size-5" {...ICONO} aria-hidden />
            {deposito ? `Movimientos de ${titulo}` : "Movimientos de todos los galpones"}
          </h2>
          <Link
            href={ruta(
              deposito ? `/stock/movimientos?depositoId=${deposito.id}` : "/stock/movimientos",
            )}
            className="text-primary text-sm font-medium hover:underline"
          >
            Ver historial completo
          </Link>
        </div>
        <FiltrosMovimientosStock />
        <TablaMovimientos movimientos={ledger.movimientos} conDeposito={!deposito} />
        {ledger.total > ledger.pageSize && (
          <nav
            aria-label="Paginación de movimientos"
            className="flex items-center justify-between gap-3 text-sm"
          >
            <p className="text-muted">
              Página {ledger.page} de {paginasLedger} · {formatearNumero(ledger.total)} movimientos
            </p>
            <div className="flex gap-2">
              {ledger.page > 1 && (
                <Link
                  href={hrefCon(PATH, params, {
                    mpage: ledger.page - 1 === 1 ? null : ledger.page - 1,
                  })}
                  scroll={false}
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                  aria-label="Movimientos anteriores"
                >
                  <ChevronLeft {...ICONO} />
                </Link>
              )}
              {ledger.page < paginasLedger && (
                <Link
                  href={hrefCon(PATH, params, { mpage: ledger.page + 1 })}
                  scroll={false}
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                  aria-label="Movimientos siguientes"
                >
                  <ChevronRight {...ICONO} />
                </Link>
              )}
            </div>
          </nav>
        )}
      </section>

      {deposito && (
        <>
          <AjusteRapidoDialog
            key={ajustando?.varianteId ?? "cerrado"}
            variante={ajustando}
            depositos={[deposito]}
            depositoInicial={deposito.id}
            onOpenChange={(o) => !o && setAjustando(null)}
          />
          <TransferirSheet
            key={transfiriendo?.varianteId ?? "cerrado-t"}
            fila={transfiriendo}
            origen={deposito}
            destinos={otros}
            onCerrar={() => setTransfiriendo(null)}
          />
        </>
      )}
    </>
  );
}
