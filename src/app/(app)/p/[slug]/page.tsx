import { Modulo } from "@prisma/client";
import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  SeccionAlertas,
  SeccionComprasVentas,
  SeccionEquipo,
  SeccionGalpones,
  SeccionGrafico,
  SeccionKpis,
  SeccionMedios,
  SeccionMiRendimiento,
  SeccionPendientes,
  SeccionTipo,
  SeccionTop,
  SkeletonKpis,
  SkeletonTarjeta,
} from "@/components/analitica/secciones";
import { SelectorPeriodo } from "@/components/analitica/selector-periodo";
import { navegacionPermitida, type ItemNavegacion } from "@/config/navigation";
import { esOwner, puede } from "@/lib/permisos";
import { requirePaginaPanelUsuario } from "@/server/auth/permissions";
import {
  describirPeriodo,
  diaDe,
  periodoDesdeParams,
  queryPeriodo,
} from "@/server/services/analitica.service";

export const metadata: Metadata = { title: "Inicio" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Inicio del panel. Con DASHBOARD: selector de período (estado en la URL),
 * KPIs contra el período anterior, gráfico comparativo, medios de pago,
 * unitaria vs. mayorista, galpones, rankings, alertas y pendientes. Los
 * dueños ven además ganancia, compras vs. ventas y el rendimiento del equipo;
 * un empleado ve "Mi rendimiento". Cada tarjeta carga por su cuenta
 * (Suspense). Siempre: accesos rápidos a los módulos que puede ver.
 */
export default async function InicioPanelPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePaginaPanelUsuario();
  const { usuario, panel, panelId } = ctx;
  const owner = esOwner(usuario);
  const verDashboard = puede(usuario, panelId, Modulo.DASHBOARD, "ver");
  const accesos = navegacionPermitida(usuario, panel).filter((i) => i.modulo !== null);

  if (!verDashboard) {
    return (
      <div className="flex flex-col gap-8 md:gap-10">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight md:text-3xl">
            {panel.nombre}
          </h1>
          <p className="text-muted text-sm md:text-base">Elegí por dónde empezar.</p>
        </header>
        {accesos.length > 0 && <AccesosRapidos items={accesos} />}
      </div>
    );
  }

  const sp = await searchParams;
  const periodo = periodoDesdeParams(sp);
  const desc = describirPeriodo(periodo);
  const clave = `${periodo.modo}-${diaDe(periodo.desde)}-${diaDe(periodo.hasta)}`;
  const preset = typeof sp.preset === "string" ? sp.preset : null;
  const props = { ctx, periodo };

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <header className="flex flex-col gap-4">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight md:text-3xl">
          {panel.nombre}
        </h1>
        <SelectorPeriodo
          modo={periodo.modo}
          desde={diaDe(periodo.desde)}
          hasta={diaDe(periodo.hasta)}
          preset={preset}
          etiqueta={desc.etiqueta}
          comparacion={desc.comparacion}
        />
      </header>

      <Suspense key={`k${clave}`} fallback={<SkeletonKpis n={owner ? 6 : 5} />}>
        <SeccionKpis {...props} />
      </Suspense>

      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-12">
        <Suspense
          key={`g${clave}`}
          fallback={<SkeletonTarjeta className="lg:col-span-8" alto="h-72" />}
        >
          <SeccionGrafico {...props} className="lg:col-span-8" />
        </Suspense>
        <Suspense key={`m${clave}`} fallback={<SkeletonTarjeta className="lg:col-span-4" />}>
          <SeccionMedios {...props} className="lg:col-span-4" />
        </Suspense>

        <Suspense
          key={`t${clave}`}
          fallback={<SkeletonTarjeta className="lg:col-span-4" alto="h-40" />}
        >
          <SeccionTipo {...props} className={owner ? "lg:col-span-4" : "lg:col-span-6"} />
        </Suspense>
        <Suspense
          key={`d${clave}`}
          fallback={<SkeletonTarjeta className="lg:col-span-4" alto="h-40" />}
        >
          <SeccionGalpones {...props} className={owner ? "lg:col-span-4" : "lg:col-span-6"} />
        </Suspense>
        {owner && (
          <Suspense
            key={`c${clave}`}
            fallback={<SkeletonTarjeta className="lg:col-span-4" alto="h-40" />}
          >
            <SeccionComprasVentas {...props} className="lg:col-span-4" />
          </Suspense>
        )}

        <Suspense key={`p${clave}`} fallback={<SkeletonTarjeta className="lg:col-span-6" />}>
          <SeccionTop
            {...props}
            que="productos"
            verProductos={puede(usuario, panelId, Modulo.PRODUCTOS, "ver")}
            className="lg:col-span-6"
          />
        </Suspense>
        <Suspense key={`s${clave}`} fallback={<SkeletonTarjeta className="lg:col-span-6" />}>
          <SeccionTop {...props} que="sabores" verProductos={false} className="lg:col-span-6" />
        </Suspense>

        <Suspense key={`e${clave}`} fallback={<SkeletonTarjeta className="lg:col-span-12" />}>
          {owner ? (
            <SeccionEquipo {...props} query={queryPeriodo(sp)} className="lg:col-span-12" />
          ) : (
            <SeccionMiRendimiento {...props} className="lg:col-span-12" />
          )}
        </Suspense>

        <Suspense fallback={<SkeletonTarjeta className="lg:col-span-6" alto="h-40" />}>
          <SeccionAlertas
            ctx={ctx}
            verStock={puede(usuario, panelId, Modulo.STOCK, "ver")}
            className="lg:col-span-6"
          />
        </Suspense>
        <Suspense fallback={<SkeletonTarjeta className="lg:col-span-6" alto="h-40" />}>
          <SeccionPendientes
            ctx={ctx}
            verCompras={owner || puede(usuario, panelId, Modulo.COMPRAS, "ver")}
            verCotizaciones={puede(usuario, panelId, Modulo.COTIZADOR, "ver")}
            soloPropias={!owner}
            className="lg:col-span-6"
          />
        </Suspense>
      </div>

      {accesos.length > 0 && <AccesosRapidos items={accesos} />}
    </div>
  );
}

function AccesosRapidos({ items }: { items: ItemNavegacion[] }) {
  return (
    <section aria-labelledby="accesos" className="flex flex-col gap-4">
      <h2 id="accesos" className="text-lg font-semibold tracking-tight">
        Accesos rápidos
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const Icono = item.icon;
          return (
            <li key={`${item.global ? "g" : "p"}${item.href}`}>
              <Link
                href={item.href}
                className="group border-border bg-surface hover:border-input hover:shadow-card-hover flex h-full min-h-16 items-center gap-4 rounded-card border p-4 transition-[border-color,box-shadow]"
              >
                <span className="bg-primary-soft text-primary-soft-foreground flex size-11 shrink-0 items-center justify-center rounded-control">
                  <Icono className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{item.label}</span>
                  <span className="text-muted block truncate text-sm">{item.descripcion}</span>
                </span>
                <ChevronRight
                  className="text-muted size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
