import {
  AlertTriangle,
  BadgeCheck,
  ChevronRight,
  MessageCircle,
  Scale,
  ShoppingCart,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, cardVariants } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { hrefCon } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { SectionCard } from "@/components/ui/section-card";
import { TabsNav } from "@/components/ui/tabs-nav";
import { formatearDolares, formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { cn, formatearFecha } from "@/lib/utils";
import { telefonoVisible, telefonoWhatsApp } from "@/lib/ventas-ui";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import type { OfertaComparada } from "@/server/reportes/comparador";
import { obtenerCotizacionUsd } from "@/server/services/configuracion.service";
import {
  buscarProductosDelPanel,
  compararProveedores,
  matrizProveedores,
  productosConVariosProveedores,
} from "@/server/services/proveedor.service";
import { opcionesFiltros } from "@/server/services/reporte.service";

import { BarraFiltros } from "../_componentes/barra-filtros";
import { CabeceraReporte } from "../_componentes/cabecera-reporte";
import { FiltroSelect } from "../_componentes/filtro-select";
import { CotizacionUsd } from "./cotizacion-usd";

export const metadata: Metadata = { title: "Comparador de proveedores" };

type SP = Record<string, string | string[] | undefined>;

const precioEn = (precio: string, moneda: "ARS" | "USD") =>
  moneda === "USD" ? formatearDolares(precio) : formatearPesos(precio);

/**
 * Comparador de proveedores (SOLO dueños): buscador de productos,
 * sugerencias de productos con varios proveedores y, para el elegido, la
 * lista del más barato al más caro. Vista Matriz (escritorio) por marca.
 */
export default async function ComparadorPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanelOwner();
  const slug = ctx.panel.slug;
  const PATH = rutaPanel(slug, "/reportes/comparador");
  const plano = Object.fromEntries(
    Object.entries(await searchParams).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const vista = plano.vista === "matriz" ? "matriz" : "lista";
  const q = (plano.q ?? "").trim();

  const [cotizacionUsd, sugerencias, resultados, comparacion, matriz, opciones] = await Promise.all(
    [
      obtenerCotizacionUsd(ctx),
      productosConVariosProveedores(ctx, { limite: 12 }),
      q ? buscarProductosDelPanel(ctx, q) : Promise.resolve([]),
      plano.productoId && vista === "lista"
        ? compararProveedores(ctx, plano.productoId).catch(() => null)
        : Promise.resolve(null),
      vista === "matriz"
        ? matrizProveedores(ctx, { marcaId: plano.marcaId })
        : Promise.resolve(null),
      vista === "matriz" ? opcionesFiltros(ctx) : Promise.resolve(null),
    ],
  );

  return (
    <>
      <CabeceraReporte
        slug={slug}
        clave="comparador"
        titulo="Comparador de proveedores"
        subtitulo="Quién te vende más barato cada producto (el sabor no cambia el precio)."
        params={
          vista === "matriz"
            ? { marcaId: plano.marcaId ?? "" }
            : { productoId: plano.productoId ?? "" }
        }
      />

      <TabsNav
        ariaLabel="Vista"
        className="mb-4 hidden md:block"
        items={[
          {
            href: hrefCon(PATH, plano, { vista: null }),
            label: "Por producto",
            activo: vista === "lista",
          },
          {
            href: hrefCon(PATH, plano, { vista: "matriz" }),
            label: "Matriz",
            activo: vista === "matriz",
          },
        ]}
      />

      <BarraFiltros className="md:flex-row md:items-end md:justify-between md:gap-4">
        {vista === "lista" ? (
          <SearchInput
            placeholder="Buscá un producto: marca, modelo o pitadas…"
            className="min-w-0 flex-1 md:max-w-xl"
          />
        ) : (
          opciones && (
            <FiltroSelect
              param="marcaId"
              valor={plano.marcaId}
              etiqueta="Marca"
              todos="Todas las marcas"
              opciones={opciones.marcas.map((m) => ({ value: m.id, label: m.nombre }))}
              className="md:w-72"
            />
          )
        )}
        <CotizacionUsd valor={cotizacionUsd} />
      </BarraFiltros>

      {vista === "lista" ? (
        <div className="flex flex-col gap-6 md:gap-8">
          {q && (
            <Card className="p-2">
              {resultados.length === 0 ? (
                <p className="text-muted p-3 text-sm">No hay productos que coincidan con «{q}».</p>
              ) : (
                <ul className="flex flex-col" data-testid="resultados-busqueda">
                  {resultados.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={hrefCon(PATH, {}, { productoId: p.id })}
                        className="hover:bg-surface rounded-control flex min-h-11 items-center justify-between gap-3 px-3 text-sm font-medium transition-colors"
                      >
                        {p.nombreCompleto}
                        <ChevronRight
                          className="text-subtle size-4 shrink-0"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {comparacion ? (
            <ListaComparacion slug={slug} c={comparacion} />
          ) : plano.productoId ? (
            <EmptyState icon={Scale} title="Ese producto no existe o fue dado de baja" />
          ) : null}

          <section aria-labelledby="titulo-sugerencias" className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <h2 id="titulo-sugerencias" className="text-h3 font-semibold">
                Productos con varios proveedores
              </h2>
              <p className="text-muted text-small">
                Elegí uno para ver quién te lo vende más barato.
              </p>
            </div>
            {sugerencias.length === 0 ? (
              <p className="text-muted bg-card rounded-card p-5 text-sm">
                Todavía no hay productos que te vendan 2 o más proveedores. Cargá los precios en la
                ficha de cada proveedor.
              </p>
            ) : (
              <ul
                className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
                data-testid="sugerencias"
              >
                {sugerencias.map((s) => {
                  const activa = plano.productoId === s.productoId;
                  return (
                    <li key={s.productoId}>
                      <Link
                        href={hrefCon(PATH, {}, { productoId: s.productoId })}
                        aria-current={activa ? "true" : undefined}
                        className={cn(
                          cardVariants({ variant: "clickable" }),
                          "flex min-h-16 items-center gap-3 p-4",
                          activa && "ring-foreground bg-card-hover ring-1",
                        )}
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate font-semibold">{s.nombreCompleto}</span>
                          <span className="text-muted text-small">
                            {s.proveedores} proveedores · ahorrás hasta{" "}
                            <span className="text-foreground font-medium tabular-nums">
                              {s.moneda === "USD"
                                ? formatearDolares(s.ahorro)
                                : formatearPesos(s.ahorro)}
                              /u
                            </span>
                          </span>
                        </span>
                        <ChevronRight
                          className="text-subtle size-5 shrink-0"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      ) : (
        matriz && <Matriz slug={slug} m={matriz} />
      )}
    </>
  );
}

function ListaComparacion({
  slug,
  c,
}: {
  slug: string;
  c: Awaited<ReturnType<typeof compararProveedores>>;
}) {
  if (c.ofertas.length === 0) {
    return (
      <EmptyState
        icon={Scale}
        title={`Ningún proveedor tiene precio para ${c.producto.nombreCompleto}`}
        description="Cargá el precio en la ficha del proveedor para poder compararlo."
      />
    );
  }
  return (
    <section aria-labelledby="titulo-comparacion" className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3 p-5 md:p-6">
        <div className="flex flex-col gap-1">
          <p className="text-muted text-small font-medium">Comparando</p>
          <h2 id="titulo-comparacion" className="text-h2 font-semibold">
            {c.producto.nombreCompleto}
          </h2>
          <p className="text-muted text-sm">
            {c.ofertas.length} {c.ofertas.length === 1 ? "proveedor" : "proveedores"}
            {c.ahorroMaximo && (
              <>
                {" "}
                · ahorrás hasta{" "}
                <span className="text-foreground font-semibold tabular-nums">
                  {formatearPesos(c.ahorroMaximo)}/u
                </span>
              </>
            )}
          </p>
        </div>
        {c.monedasSinConvertir && (
          <p
            className="bg-warning-soft text-warning-soft-foreground rounded-control flex items-start gap-2 p-3 text-sm"
            data-testid="aviso-monedas"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            Hay precios en pesos y en dólares: se ordenan por separado. Cargá la cotización del
            dólar para compararlos juntos.
          </p>
        )}
        {c.cotizacionUsd && c.ofertas.some((o) => o.moneda === "USD") && (
          <p className="text-muted text-sm" data-testid="aviso-conversion">
            Los precios en dólares se convierten a pesos a {formatearPesos(c.cotizacionUsd)} solo
            para ordenarlos.
          </p>
        )}
      </Card>
      <ol className="flex flex-col gap-3" data-testid="lista-comparador">
        {c.ofertas.map((o) => (
          <FilaOferta key={o.proveedorId} slug={slug} o={o} producto={c.producto.nombreCompleto} />
        ))}
      </ol>
    </section>
  );
}

function FilaOferta({ slug, o, producto }: { slug: string; o: OfertaComparada; producto: string }) {
  const mensaje = `Hola ${o.proveedor}, ¿qué precio tenés hoy para ${producto}?`;
  return (
    <li
      data-testid="oferta"
      data-proveedor={o.proveedor}
      className="bg-card rounded-card flex flex-col gap-4 p-4 md:flex-row md:items-center md:gap-6 md:p-5"
    >
      <div className="flex items-start gap-4 md:flex-1">
        <span
          className="bg-foreground text-background rounded-control flex size-10 shrink-0 items-center justify-center text-base font-semibold tabular-nums"
          data-testid="posicion"
        >
          {o.posicion}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-h3 font-semibold">{o.proveedor}</span>
          <span className="text-muted text-sm">{o.tienda}</span>
          <span className="text-subtle text-small">
            Actualizado {formatearFecha(o.actualizadoAt)}
            {o.ultimaCompra ? (
              <>
                {" "}
                · Última compra {formatearFecha(o.ultimaCompra.fecha)} a{" "}
                {formatearPesos(o.ultimaCompra.costo)}
              </>
            ) : (
              " · Sin compras registradas"
            )}
          </span>
          {(o.masBarato || o.desactualizado) && (
            <div className="mt-1 flex flex-wrap gap-2">
              {o.masBarato && (
                <Badge variant="success" data-testid="badge-mas-barato">
                  <BadgeCheck strokeWidth={1.75} /> Más barato
                  {o.grupo === "USD" ? " en dólares" : ""}
                </Badge>
              )}
              {o.desactualizado && (
                <Badge variant="warning">
                  <AlertTriangle strokeWidth={1.75} aria-hidden /> Precio posiblemente
                  desactualizado
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="border-border flex items-end justify-between gap-4 border-t pt-3 md:flex-col md:items-end md:gap-1 md:border-0 md:pt-0">
        <span
          className="text-2xl leading-tight font-semibold tracking-tight tabular-nums md:text-[1.75rem]"
          data-testid="precio"
        >
          {precioEn(o.precio, o.moneda)}
        </span>
        <span className="text-small tabular-nums">
          {o.precioArsEquivalente && (
            <span className="text-muted block text-right" data-testid="equivalente">
              ≈ {formatearPesos(o.precioArsEquivalente)}
            </span>
          )}
          <span
            className={cn(
              "block text-right",
              o.masBarato ? "text-success font-medium" : "text-muted",
            )}
            data-testid="diferencia"
          >
            {o.masBarato
              ? "El mejor precio"
              : `+${o.grupo === "USD" ? formatearDolares(o.diferencia) : formatearPesos(o.diferencia)} (+${o.diferenciaPct.toLocaleString("es-AR")} %)`}
          </span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:flex md:w-40 md:flex-col">
        {o.telefono ? (
          <a
            href={`https://wa.me/${telefonoWhatsApp(o.telefono)}?text=${encodeURIComponent(mensaje)}`}
            target="_blank"
            rel="noopener"
            className={buttonVariants({ variant: "secondary" })}
            title={telefonoVisible(o.telefono)}
          >
            <MessageCircle strokeWidth={1.75} /> WhatsApp
          </a>
        ) : (
          <span className="text-subtle text-small flex min-h-11 items-center justify-center md:min-h-10">
            Sin teléfono
          </span>
        )}
        <Link
          href={`${rutaPanel(slug, "/compras/nueva")}?proveedor=${o.proveedorId}`}
          className={buttonVariants({ variant: "secondary" })}
        >
          <ShoppingCart strokeWidth={1.75} /> Nueva compra
          <span className="sr-only"> a este proveedor</span>
        </Link>
      </div>
    </li>
  );
}

/** Fondo de la celda más barata: azul de marca muy claro (única excepción de color fuera de gráficos). */
const FONDO_MAS_BARATO = { background: "color-mix(in oklab, var(--marca-azul) 10%, white)" };

function Matriz({ slug, m }: { slug: string; m: Awaited<ReturnType<typeof matrizProveedores>> }) {
  if (m.filas.length === 0) {
    return <EmptyState icon={Scale} title="No hay precios de proveedores para mostrar" />;
  }
  const PATH = rutaPanel(slug, "/reportes/comparador");
  return (
    <SectionCard
      title="Precio de cada proveedor"
      description="La celda resaltada es el proveedor más barato de cada producto."
    >
      <div
        className="border-border bg-surface rounded-card overflow-x-auto border"
        data-testid="matriz"
      >
        <table className="w-full text-sm tabular-nums">
          <thead className="border-border bg-card text-muted border-b text-left text-xs">
            <tr>
              <th scope="col" className="bg-card sticky left-0 z-10 h-12 px-4 font-medium">
                Producto
              </th>
              {m.proveedores.map((p) => (
                <th
                  key={p.id}
                  scope="col"
                  className="px-4 py-2 text-right font-medium whitespace-nowrap"
                >
                  <span className="text-foreground">{p.nombre}</span>
                  <span className="text-subtle block font-normal">{p.tienda}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {m.filas.map((f) => (
              <tr key={f.productoId}>
                <th
                  scope="row"
                  className="bg-surface sticky left-0 h-12 px-4 text-left font-medium whitespace-nowrap"
                >
                  <Link href={`${PATH}?productoId=${f.productoId}`} className="hover:underline">
                    {f.nombreCompleto}
                  </Link>
                </th>
                {m.proveedores.map((p) => {
                  const x = f.precios[p.id];
                  return (
                    <td
                      key={p.id}
                      className={cn(
                        "px-4 py-3 text-right whitespace-nowrap",
                        x?.masBarato && "font-semibold",
                      )}
                      style={x?.masBarato ? FONDO_MAS_BARATO : undefined}
                    >
                      {x ? (
                        <>
                          {precioEn(x.precio, x.moneda)}
                          {x.desactualizado && (
                            <AlertTriangle
                              className="text-warning ml-1 inline size-3.5 align-[-2px]"
                              strokeWidth={1.75}
                              aria-label="Precio posiblemente desactualizado"
                            />
                          )}
                        </>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
