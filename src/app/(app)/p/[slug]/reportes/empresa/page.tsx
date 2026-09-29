import { Modulo } from "@prisma/client";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  SeccionComprasVentas,
  SeccionGalpones,
  SeccionGrafico,
  SeccionKpis,
  SeccionMedios,
  SeccionTipo,
  SeccionTop,
  SkeletonKpis,
  SkeletonTarjeta,
} from "@/components/analitica/secciones";
import { puede } from "@/lib/permisos";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import { diaDe, periodoDesdeParams } from "@/server/services/analitica.service";

import { CabeceraReporte } from "../_componentes/cabecera-reporte";
import { PeriodoAnalitica } from "../_componentes/periodo-analitica";

export const metadata: Metadata = { title: "Rendimiento de la empresa" };

type SP = Record<string, string | string[] | undefined>;

/** Rendimiento de la empresa (SOLO dueños): KPIs vs. el período anterior, gráficos y rankings. */
export default async function EmpresaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanelOwner();
  const sp = await searchParams;
  const plano = Object.fromEntries(
    Object.entries(sp).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const periodo = periodoDesdeParams(sp);
  const clave = `${periodo.modo}-${diaDe(periodo.desde)}-${diaDe(periodo.hasta)}`;
  const props = { ctx, periodo };
  return (
    <>
      <CabeceraReporte
        slug={ctx.panel.slug}
        clave="empresa"
        titulo="Rendimiento de la empresa"
        subtitulo="Facturación, ganancia y ventas comparadas con el período anterior."
        params={plano}
      />
      <PeriodoAnalitica periodo={periodo} preset={plano.preset ?? null} />
      <div className="flex flex-col gap-4">
        <Suspense key={`k${clave}`} fallback={<SkeletonKpis n={6} />}>
          <SeccionKpis {...props} />
        </Suspense>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
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
            <SeccionTipo {...props} className="lg:col-span-4" />
          </Suspense>
          <Suspense
            key={`d${clave}`}
            fallback={<SkeletonTarjeta className="lg:col-span-4" alto="h-40" />}
          >
            <SeccionGalpones {...props} className="lg:col-span-4" />
          </Suspense>
          <Suspense
            key={`c${clave}`}
            fallback={<SkeletonTarjeta className="lg:col-span-4" alto="h-40" />}
          >
            <SeccionComprasVentas {...props} className="lg:col-span-4" />
          </Suspense>
          <Suspense key={`p${clave}`} fallback={<SkeletonTarjeta className="lg:col-span-6" />}>
            <SeccionTop
              {...props}
              que="productos"
              verProductos={puede(ctx.usuario, ctx.panelId, Modulo.PRODUCTOS, "ver")}
              className="lg:col-span-6"
            />
          </Suspense>
          <Suspense key={`s${clave}`} fallback={<SkeletonTarjeta className="lg:col-span-6" />}>
            <SeccionTop {...props} que="sabores" verProductos={false} className="lg:col-span-6" />
          </Suspense>
        </div>
      </div>
    </>
  );
}
