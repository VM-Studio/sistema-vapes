import {
  AlertTriangle,
  BadgeCheck,
  MessageCircle,
  Scale,
  ShoppingCart,
  TrendingDown,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { hrefCon } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { TabsNav } from "@/components/ui/tabs-nav";
import { formatearPesos } from "@/lib/format";
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

import { CabeceraReporte } from "../_componentes/cabecera-reporte";
import { FiltroSelect } from "../_componentes/filtro-select";
import { CotizacionUsd } from "./cotizacion-usd";

export const metadata: Metadata = { title: "Comparador de proveedores" };

type SP = Record<string, string | string[] | undefined>;

const precioEn = (precio: string, moneda: "ARS" | "USD") =>
  moneda === "USD"
    ? `US$ ${Number(precio).toLocaleString("es-AR", { minimumFractionDigits: Number.isInteger(Number(precio)) ? 0 : 2 })}`
    : formatearPesos(precio);

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

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <TabsNav
          ariaLabel="Vista"
          className="hidden md:block"
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
        <CotizacionUsd valor={cotizacionUsd} />
      </div>

      {vista === "lista" ? (
        <div className="flex flex-col gap-5">
          <SearchInput
            placeholder="Buscá un producto: marca, modelo o pitadas…"
            className="md:max-w-xl"
          />
          {q && (
            <Card>
              <CardContent className="p-2">
                {resultados.length === 0 ? (
                  <p className="text-muted p-3 text-sm">
                    No hay productos que coincidan con «{q}».
                  </p>
                ) : (
                  <ul className="flex flex-col" data-testid="resultados-busqueda">
                    {resultados.map((p) => (
                      <li key={p.id}>
                        <Link
                          href={hrefCon(PATH, {}, { productoId: p.id })}
                          className="hover:bg-surface-2 flex min-h-11 items-center rounded-xl px-3 text-sm font-medium"
                        >
                          {p.nombreCompleto}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {comparacion ? (
            <ListaComparacion slug={slug} c={comparacion} />
          ) : plano.productoId ? (
            <EmptyState icon={Scale} title="Ese producto no existe o fue dado de baja" />
          ) : null}

          <section aria-labelledby="titulo-sugerencias" className="flex flex-col gap-3">
            <h2 id="titulo-sugerencias" className="text-lg font-semibold">
              Productos con varios proveedores
            </h2>
            {sugerencias.length === 0 ? (
              <p className="text-muted text-sm">
                Todavía no hay productos que te vendan 2 o más proveedores. Cargá los precios en la
                ficha de cada proveedor.
              </p>
            ) : (
              <ul
                className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3"
                data-testid="sugerencias"
              >
                {sugerencias.map((s) => (
                  <li key={s.productoId}>
                    <Link
                      href={hrefCon(PATH, {}, { productoId: s.productoId })}
                      className={cn(
                        "border-border bg-surface hover:border-input flex min-h-14 items-center gap-3 rounded-2xl border p-4 text-sm transition-colors",
                        plano.productoId === s.productoId && "border-primary bg-primary-soft",
                      )}
                    >
                      <TrendingDown
                        className="text-success size-5 shrink-0"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="font-semibold">{s.nombreCompleto}</span>
                        <span className="text-muted">
                          {" "}
                          — {s.proveedores} proveedores — ahorrás hasta{" "}
                          <span className="text-success font-medium">
                            {s.moneda === "USD" ? `US$ ${s.ahorro}` : formatearPesos(s.ahorro)}/u
                          </span>
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : (
        matriz &&
        opciones && (
          <div className="flex flex-col gap-4">
            <FiltroSelect
              param="marcaId"
              valor={plano.marcaId}
              etiqueta="Marca"
              todos="Todas las marcas"
              opciones={opciones.marcas.map((m) => ({ value: m.id, label: m.nombre }))}
              className="md:max-w-xs"
            />
            <Matriz slug={slug} m={matriz} />
          </div>
        )
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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="titulo-comparacion" className="text-xl font-semibold">
          {c.producto.nombreCompleto}
        </h2>
        <p className="text-muted text-sm">
          {c.ofertas.length} {c.ofertas.length === 1 ? "proveedor" : "proveedores"}
          {c.ahorroMaximo && (
            <>
              {" "}
              · ahorrás hasta{" "}
              <span className="text-success font-medium">{formatearPesos(c.ahorroMaximo)}/u</span>
            </>
          )}
        </p>
      </div>
      {c.monedasSinConvertir && (
        <p
          className="bg-warning-soft text-warning-soft-foreground rounded-xl p-3 text-sm"
          data-testid="aviso-monedas"
        >
          Hay precios en pesos y en dólares: se ordenan por separado. Cargá la cotización del dólar
          para compararlos juntos.
        </p>
      )}
      {c.cotizacionUsd && c.ofertas.some((o) => o.moneda === "USD") && (
        <p className="text-muted text-sm" data-testid="aviso-conversion">
          Los precios en dólares se convierten a pesos a $ {c.cotizacionUsd.toLocaleString("es-AR")}{" "}
          solo para ordenarlos.
        </p>
      )}
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
      className={cn(
        "bg-surface shadow-card flex flex-col gap-4 rounded-2xl border p-4 md:flex-row md:items-center md:gap-6 md:p-5",
        o.masBarato ? "border-success/50 ring-success/30 ring-1" : "border-border",
      )}
    >
      <div className="flex items-start gap-4 md:flex-1">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full text-lg font-semibold tabular-nums",
            o.masBarato
              ? "bg-success-soft text-success-soft-foreground"
              : "bg-surface-2 text-muted",
          )}
          data-testid="posicion"
        >
          {o.posicion}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{o.proveedor}</span>
            {o.masBarato && (
              <Badge variant="success" data-testid="badge-mas-barato">
                <BadgeCheck strokeWidth={1.75} /> Más barato{o.grupo === "USD" ? " en dólares" : ""}
              </Badge>
            )}
          </div>
          <span className="text-muted text-sm">{o.tienda}</span>
          <span className="text-muted text-xs">
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
          {o.desactualizado && (
            <span className="text-warning-soft-foreground bg-warning-soft inline-flex w-fit items-center gap-1 rounded-[var(--radius-control)] px-2.5 py-1 text-xs font-medium">
              <AlertTriangle className="size-3.5" strokeWidth={1.75} aria-hidden /> Precio
              posiblemente desactualizado
            </span>
          )}
        </div>
      </div>
      <div className="flex items-end justify-between gap-4 md:flex-col md:items-end md:gap-1">
        <span className="text-2xl font-semibold tabular-nums md:text-3xl" data-testid="precio">
          {precioEn(o.precio, o.moneda)}
        </span>
        <span className="text-sm tabular-nums">
          {o.precioArsEquivalente && (
            <span className="text-muted block text-right" data-testid="equivalente">
              ≈ {formatearPesos(o.precioArsEquivalente)}
            </span>
          )}
          <span
            className={cn("block text-right", o.masBarato ? "text-success" : "text-danger")}
            data-testid="diferencia"
          >
            {o.masBarato
              ? "El mejor precio"
              : `+${o.grupo === "USD" ? `US$ ${o.diferencia}` : formatearPesos(o.diferencia)} (+${o.diferenciaPct.toLocaleString("es-AR")} %)`}
          </span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:flex md:flex-col">
        {o.telefono ? (
          <a
            href={`https://wa.me/${telefonoWhatsApp(o.telefono)}?text=${encodeURIComponent(mensaje)}`}
            target="_blank"
            rel="noopener"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
            title={telefonoVisible(o.telefono)}
          >
            <MessageCircle strokeWidth={1.75} /> WhatsApp
          </a>
        ) : (
          <span className="text-muted flex items-center justify-center text-xs">Sin teléfono</span>
        )}
        <Link
          href={`${rutaPanel(slug, "/compras/nueva")}?proveedor=${o.proveedorId}`}
          className={buttonVariants({ variant: o.masBarato ? "primary" : "secondary", size: "sm" })}
        >
          <ShoppingCart strokeWidth={1.75} /> Nueva compra
          <span className="sr-only"> a este proveedor</span>
        </Link>
      </div>
    </li>
  );
}

function Matriz({ slug, m }: { slug: string; m: Awaited<ReturnType<typeof matrizProveedores>> }) {
  if (m.filas.length === 0) {
    return <EmptyState icon={Scale} title="No hay precios de proveedores para mostrar" />;
  }
  const PATH = rutaPanel(slug, "/reportes/comparador");
  return (
    <div
      className="border-border bg-surface overflow-x-auto rounded-2xl border"
      data-testid="matriz"
    >
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-muted text-left text-xs">
          <tr>
            <th className="sticky left-0 z-10 bg-inherit px-4 py-3 font-medium">Producto</th>
            {m.proveedores.map((p) => (
              <th key={p.id} className="px-4 py-3 text-right font-medium whitespace-nowrap">
                {p.nombre}
                <span className="block font-normal">{p.tienda}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {m.filas.map((f) => (
            <tr key={f.productoId} className="border-border border-t">
              <th className="bg-surface sticky left-0 px-4 py-3 text-left font-medium whitespace-nowrap">
                <Link
                  href={`${PATH}?productoId=${f.productoId}`}
                  className="hover:text-primary hover:underline"
                >
                  {f.nombreCompleto}
                </Link>
              </th>
              {m.proveedores.map((p) => {
                const x = f.precios[p.id];
                return (
                  <td
                    key={p.id}
                    className={cn(
                      "px-4 py-3 text-right whitespace-nowrap tabular-nums",
                      x?.masBarato && "bg-success-soft text-success-soft-foreground font-semibold",
                    )}
                  >
                    {x ? (
                      <>
                        {precioEn(x.precio, x.moneda)}
                        {x.desactualizado && (
                          <AlertTriangle
                            className="text-warning-soft-foreground ml-1 inline size-3.5"
                            strokeWidth={1.75}
                            aria-label="Precio posiblemente desactualizado"
                          />
                        )}
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
