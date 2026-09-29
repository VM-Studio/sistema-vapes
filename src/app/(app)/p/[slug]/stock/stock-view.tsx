"use client";

import { Modulo } from "@prisma/client";
import {
  ArrowLeftRight,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Download,
  History,
  Package,
  ScanLine,
  SlidersVertical,
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
import { EmptyState } from "@/components/ui/empty-state";
import { MenuFila, type AccionFila } from "@/components/ui/menu-fila";
import { PageHeader } from "@/components/ui/page-header";
import { hrefCon, Pagination } from "@/components/ui/pagination";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FilaStock, ResultadoStock } from "@/server/services/inventario.service";
import type { ResultadoLedger, ResumenStockPanel } from "@/server/services/stock.service";

import { TabsGalpones } from "./_componentes/tabs-galpones";
import { FiltrosMovimientosStock, TablaMovimientos } from "./tabla-movimientos";
import { TransferirSheet, type FilaATransferir } from "./transferir-sheet";

const ICONO = { strokeWidth: 1.75 } as const;

/** Celda de encabezado (mismo aspecto que DataTable). */
const TH = "h-10 px-4 font-medium whitespace-nowrap";

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
    const menu: AccionFila[] = [
      ...(puedeAjustar
        ? [
            {
              label: "Ajustar stock",
              icon: SlidersVertical,
              onSelect: () =>
                setAjustando({
                  varianteId: f.varianteId,
                  nombre: f.nombreCompleto,
                  porDeposito: f.porDeposito,
                }),
            },
          ]
        : []),
      {
        label: "Ver movimientos",
        icon: History,
        href: ruta(`/stock/movimientos?varianteId=${f.varianteId}&depositoId=${deposito.id}`),
      },
      { label: "Ver producto", icon: Package, href: ruta(`/productos/${f.productoId}`) },
    ];
    return (
      <div
        className={cn(
          "flex items-center gap-1",
          compacto ? "border-border mt-3 border-t pt-3" : "justify-end",
        )}
      >
        {puedeMover && (
          <Button
            variant={compacto ? "secondary" : "ghost"}
            size="sm"
            className={cn(compacto && "h-11 flex-1")}
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
            {compacto && destinoUnico ? `Transferir a ${destinoUnico.nombre}` : "Transferir"}
          </Button>
        )}
        <MenuFila acciones={menu} label={`Acciones de ${f.nombreCompleto}`} />
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
    <tr key={f.varianteId} className="hover:bg-card/60 transition-colors">
      <td className={cn("px-4 py-3", anidada && "pl-10")}>
        <Link href={ruta(`/productos/${f.productoId}`)} className="font-medium hover:underline">
          {anidada ? (f.sabor ?? f.producto) : f.nombreCompleto}
        </Link>
      </td>
      <td className="text-muted px-4 py-3 font-mono text-xs whitespace-nowrap">{codigoDe(f)}</td>
      {columnas.map((c) => (
        <td
          key={c.id}
          className={cn(
            "px-4 py-3 text-right tabular-nums",
            c.id === "total" || c.id === "cantidad" ? "text-base font-semibold" : "text-muted",
          )}
        >
          {valor(f, c.id)}
        </td>
      ))}
      <td className="text-subtle px-4 py-3 text-right tabular-nums">{f.stockMinimo}</td>
      <td className="px-4 py-3">
        <EstadoStockBadge estado={f.estado} />
      </td>
      {deposito && <td className="py-2 pr-2 pl-4">{acciones(f, false)}</td>}
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

      <TabsGalpones
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
        <section aria-label="Resumen del galpón" className="mb-6 grid grid-cols-2 gap-4">
          <StatCard
            label={`Unidades en ${deposito.nombre}`}
            value={formatearNumero(deposito.unidades)}
            hint={`${formatearNumero(resumen.total)} en todos los galpones`}
          />
          <StatCard
            label="Bajo mínimo"
            value={formatearNumero(deposito.bajoMinimo)}
            href={link({ soloBajoMinimo: soloBajoMinimo ? null : "1" })}
            className={cn(soloBajoMinimo && "ring-foreground ring-2")}
            hint={soloBajoMinimo ? "Tocá para ver todos" : "Sabores con menos que el mínimo acá"}
          />
        </section>
      ) : (
        <section
          aria-label="Resumen global"
          className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]"
        >
          {depositos.map((d) => (
            <StatCard
              key={d.id}
              label={d.nombre}
              value={formatearNumero(d.unidades)}
              href={linkTab(d.id)}
              hint={`${formatearNumero(d.bajoMinimo)} bajo mínimo`}
            />
          ))}
          <StatCard
            label="Total del panel"
            value={formatearNumero(resumen.total)}
            hint="Unidades en todos los galpones"
          />
          <StatCard
            label="Bajo mínimo"
            value={formatearNumero(resumen.bajoMinimo)}
            href={link({ soloBajoMinimo: soloBajoMinimo ? null : "1" })}
            className={cn(soloBajoMinimo && "ring-foreground ring-2")}
            hint={soloBajoMinimo ? "Tocá para ver todos" : "Sabores con menos que el mínimo"}
          />
        </section>
      )}

      <FiltrosCatalogo
        marcas={marcas}
        extras={[{ tipo: "check", param: "soloBajoMinimo", label: "Solo bajo mínimo" }]}
        placeholder="Producto, sabor, SKU o código…"
        inicio={
          !deposito && (
            <nav
              aria-label="Vista"
              className="bg-card inline-flex shrink-0 gap-0.5 rounded-control p-0.5"
            >
              {[
                { href: link({ vista: null }), label: "Por sabor", activo: !porProducto },
                { href: link({ vista: "producto" }), label: "Por producto", activo: porProducto },
              ].map((v) => (
                <Link
                  key={v.label}
                  href={v.href}
                  scroll={false}
                  aria-current={v.activo ? "page" : undefined}
                  className={cn(
                    "flex h-10 items-center rounded-inner px-3 text-sm font-medium whitespace-nowrap transition-colors md:h-9",
                    v.activo
                      ? "bg-foreground text-background"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  {v.label}
                </Link>
              ))}
            </nav>
          )
        }
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
                  <ScanLine {...ICONO} /> Cargar stock escaneando
                </Link>
              ) : null
            }
          />
        )
      ) : (
        <>
          <div className="border-border bg-surface hidden overflow-x-auto rounded-card border md:block">
            <table className="w-full text-left text-sm tabular-nums" data-testid="tabla-stock">
              <caption className="sr-only">
                {deposito ? `Stock en ${deposito.nombre}` : "Stock por galpón y total"}
              </caption>
              <thead className="border-border bg-card text-muted border-b text-xs">
                <tr>
                  <th scope="col" className={TH}>
                    Producto — sabor
                  </th>
                  <th scope="col" className={TH}>
                    Código
                  </th>
                  {columnas.map((c) => (
                    <th key={c.id} scope="col" className={cn(TH, "text-right")}>
                      {c.nombre}
                    </th>
                  ))}
                  <th scope="col" className={cn(TH, "text-right")}>
                    Mínimo
                  </th>
                  <th scope="col" className={TH}>
                    Estado
                  </th>
                  {deposito && (
                    <th scope="col" className={TH}>
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
                          <tr className="bg-card">
                            <td className="px-4 py-3 font-semibold" colSpan={2}>
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
                                className="px-4 py-3 text-right font-semibold tabular-nums"
                              >
                                {g.reduce((a, f) => a + valor(f, c.id), 0)}
                              </td>
                            ))}
                            <td colSpan={deposito ? 3 : 2} />
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
                    <li className="text-h3 mt-3 px-1 font-semibold first:mt-0">{f.producto}</li>
                  )}
                  <li className="bg-card rounded-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <Link
                          href={ruta(`/productos/${f.productoId}`)}
                          className="font-medium hover:underline"
                        >
                          {grupos ? (f.sabor ?? f.producto) : f.nombreCompleto}
                        </Link>
                        <p className="text-muted truncate font-mono text-xs">{codigoDe(f)}</p>
                        <div className="mt-1">
                          <EstadoStockBadge estado={f.estado} sobreGris />
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-3xl leading-none font-semibold tracking-tight tabular-nums">
                          {f.cantidad}
                        </p>
                        <p className="text-subtle mt-1 text-xs">mín. {f.stockMinimo}</p>
                      </div>
                    </div>
                    {!deposito && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {depositos.map((d) => (
                          <span
                            key={d.id}
                            className="bg-surface text-muted rounded-control px-2 py-1 text-xs"
                          >
                            {d.nombre}{" "}
                            <strong className="text-foreground tabular-nums">
                              {f.porDeposito[d.id] ?? 0}
                            </strong>
                          </span>
                        ))}
                      </div>
                    )}
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
            <p className="text-subtle mt-1 text-xs">
              En la vista por producto se pagina por producto.
            </p>
          )}
        </>
      )}

      <section aria-labelledby="titulo-movimientos" className="mt-10 flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="titulo-movimientos" className="text-h2 font-semibold">
            {deposito ? `Movimientos de ${titulo}` : "Movimientos de todos los galpones"}
          </h2>
          <Link
            href={ruta(
              deposito ? `/stock/movimientos?depositoId=${deposito.id}` : "/stock/movimientos",
            )}
            className="text-foreground text-sm font-medium underline underline-offset-4 hover:decoration-2"
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
