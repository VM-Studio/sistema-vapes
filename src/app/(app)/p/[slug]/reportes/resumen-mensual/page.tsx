import type { Metadata } from "next";
import { Suspense } from "react";

import {
  SeccionComprasVentas,
  SeccionEquipo,
  SeccionKpis,
  SeccionTop,
  SkeletonKpis,
  SkeletonTarjeta,
} from "@/components/analitica/secciones";
import { diaEn, ZONA_DEFAULT } from "@/lib/zona-horaria";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import { diasDelMes, mesResumen, nombreMes } from "@/server/reportes/filtros";
import { periodoDelMes } from "@/server/reportes/resumen-mensual";

import { BarraFiltros } from "../_componentes/barra-filtros";
import { CabeceraReporte } from "../_componentes/cabecera-reporte";
import { paramsPlanos } from "../_componentes/params";
import { SelectorMes } from "./selector-mes";

export const metadata: Metadata = { title: "Resumen mensual" };

/** Reporte 10 (SOLO dueños): vista previa del mes y el PDF de una página. */
export default async function ResumenMensualPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePaginaPanelOwner();
  const plano = await paramsPlanos(searchParams);
  const mes = mesResumen(plano.mes);
  const periodo = periodoDelMes(mes);
  const props = { ctx, periodo };
  return (
    <>
      <CabeceraReporte
        slug={ctx.panel.slug}
        clave="resumen-mensual"
        titulo={`Resumen de ${nombreMes(mes)}`}
        subtitulo="Una página con los números del mes, comparados con el mes anterior."
        params={{ mes }}
        excel={false}
      />
      <BarraFiltros>
        <SelectorMes mes={mes} max={diaEn(new Date(), ZONA_DEFAULT).slice(0, 7)} />
      </BarraFiltros>
      <div className="flex flex-col gap-4">
        <Suspense key={`k${mes}`} fallback={<SkeletonKpis n={6} />}>
          <SeccionKpis {...props} />
        </Suspense>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Suspense key={`t${mes}`} fallback={<SkeletonTarjeta />}>
            <SeccionTop {...props} que="productos" verProductos={false} />
          </Suspense>
          <Suspense key={`c${mes}`} fallback={<SkeletonTarjeta />}>
            <SeccionComprasVentas {...props} />
          </Suspense>
        </div>
        <Suspense key={`e${mes}`} fallback={<SkeletonTarjeta alto="h-40" />}>
          <SeccionEquipo
            {...props}
            query={`?modo=periodo&desde=${diasDelMes(mes).desde}&hasta=${diasDelMes(mes).hasta}`}
          />
        </Suspense>
      </div>
    </>
  );
}
