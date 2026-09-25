import { Modulo } from "@prisma/client";
import { FileSpreadsheet, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Grafico } from "@/components/charts/grafico";
import { Kpi } from "@/components/reportes/kpi";
import { SelectorPeriodo } from "@/components/reportes/selector-periodo";
import { TablaReporte } from "@/components/reportes/tabla-reporte";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ahora } from "@/lib/reloj";
import { formatearCelda } from "@/lib/reportes/documento";
import { parametrosDesdeUrl, queryDeParametros } from "@/lib/reportes/parametros";
import { diaEn, PERIODOS } from "@/lib/zona-horaria";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { contextoReporte, puedeVerReporte, reportePorSlug } from "@/server/reportes/definiciones";
import { listarClasificacionesActivas } from "@/server/services/clasificacion.service";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import { listarUsuariosBasico } from "@/server/services/usuario.service";

import { CompartirReporte } from "./compartir-reporte";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = reportePorSlug((await params).slug);
  return { title: r ? `Reporte: ${r.titulo}` : "Reportes" };
}

export default async function ReportePage({ params, searchParams }: Props) {
  const usuario = await requirePaginaPermiso(Modulo.REPORTES, "ver");
  const def = reportePorSlug((await params).slug);
  if (!def) notFound();
  if (!puedeVerReporte(usuario, def)) redirect("/sin-acceso");
  const ctx = await contextoReporte(usuario);
  const p = parametrosDesdeUrl(await searchParams, diaEn(ahora(), ctx.tz), def.periodoPorDefecto);
  const [doc, depositos, categorias, vendedores] = await Promise.all([
    def.construir(p, ctx),
    def.filtros.includes("deposito") ? listarDepositosActivos() : Promise.resolve(undefined),
    def.filtros.includes("categoria")
      ? listarClasificacionesActivas("Categoria")
      : Promise.resolve(undefined),
    def.filtros.includes("vendedor") ? listarUsuariosBasico() : Promise.resolve(undefined),
  ]);
  const qs = queryDeParametros(p);
  const exportar = (formato: "pdf" | "xlsx") =>
    `/api/reportes/${def.slug}?formato=${formato}&${qs}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`${def.numero}. ${def.titulo}`}
        subtitle={
          <>
            <Link href="/reportes" className="text-primary hover:underline">
              Reportes
            </Link>{" "}
            · {def.descripcion}
          </>
        }
        actions={
          <>
            <a href={exportar("pdf")} className={buttonVariants({ variant: "secondary" })} download>
              <FileText /> Exportar PDF
            </a>
            <a
              href={exportar("xlsx")}
              className={buttonVariants({ variant: "secondary" })}
              download
            >
              <FileSpreadsheet /> Exportar Excel
            </a>
            {def.slug === "resumen-mensual" && <CompartirReporte slug={def.slug} query={qs} />}
          </>
        }
        className="mb-0 md:mb-0"
      />
      {def.filtros.length > 0 && (
        <SelectorPeriodo
          periodos={PERIODOS}
          periodo={p.periodo}
          rango={p.rango}
          mostrarPeriodo={def.filtros.includes("periodo")}
          depositos={depositos}
          depositoId={p.depositoId}
          categorias={categorias}
          categoriaId={p.categoriaId}
          vendedores={vendedores?.filter((v) => v.activo)}
          usuarioId={p.usuarioId}
          conDiferencia={def.filtros.includes("diferencia") ? p.soloConDiferencia : undefined}
        />
      )}
      <p className="text-muted -mt-2 text-xs">
        {doc.filtros.map((f) => `${f.etiqueta}: ${f.valor}`).join(" · ")}
      </p>

      {doc.kpis && doc.kpis.length > 0 && (
        <section
          aria-label="Indicadores"
          className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4"
        >
          {doc.kpis.map((k) => (
            <Kpi
              key={k.etiqueta}
              label={k.etiqueta}
              valor={formatearCelda(k.valor, k.tipo)}
              delta={k.delta}
              invertido={k.deltaInvertido}
            />
          ))}
        </section>
      )}

      {doc.graficos && doc.graficos.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {doc.graficos.map((g, i) => (
            <section
              key={g.id}
              className={`border-border bg-surface flex min-w-0 flex-col gap-3 rounded-xl border p-4 ${i === 0 && doc.graficos!.length % 2 === 1 ? "lg:col-span-2" : ""}`}
            >
              <h2 className="font-semibold">{g.titulo}</h2>
              <Grafico g={g} />
            </section>
          ))}
        </div>
      )}

      {doc.secciones.map((s) => (
        <TablaReporte key={s.id} seccion={s} max={s.id === "detalle" ? 100 : undefined} />
      ))}
      {doc.nota && <p className="text-muted text-xs">{doc.nota}</p>}
    </div>
  );
}
