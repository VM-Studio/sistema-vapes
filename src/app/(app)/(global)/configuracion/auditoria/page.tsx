import { ChevronRight, History } from "lucide-react";
import { AccionAuditoria } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { TabsNav } from "@/components/ui/tabs-nav";
import { formatearFechaHora } from "@/lib/utils";
import { requirePaginaOwner } from "@/server/auth/permissions";
import { filtrosAuditoriaSchema, listarAuditoria } from "@/server/services/auditoria.service";
import { listarTodosLosPaneles } from "@/server/services/panel.service";
import { listarUsuariosBasico } from "@/server/services/usuario.service";

import { tabsConfiguracion } from "../secciones";
import { FiltrosAuditoria } from "./filtros";

export const metadata: Metadata = { title: "Auditoría" };

const VARIANTE: Partial<
  Record<AccionAuditoria, "success" | "danger" | "warning" | "primary" | "neutral">
> = {
  CREATE: "success",
  DELETE: "danger",
  UPDATE: "primary",
  ACCESO_DENEGADO: "danger",
  SESION_REVOCADA: "warning",
  PERMISO_CAMBIADO: "warning",
};

const valor = (v: unknown) =>
  v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v);

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePaginaOwner();
  const plano = Object.fromEntries(
    Object.entries(await searchParams).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const f = filtrosAuditoriaSchema.parse(plano);
  const hayFiltros = Object.entries(plano).some(([k, v]) => k !== "page" && v !== "");
  const [r, usuarios, sistemas] = await Promise.all([
    listarAuditoria(f),
    listarUsuariosBasico(),
    listarTodosLosPaneles(),
  ]);
  return (
    <>
      <TabsNav
        items={tabsConfiguracion("/configuracion/auditoria")}
        className="mb-6"
        ariaLabel="Configuración"
      />
      <PageHeader
        title="Auditoría"
        subtitle="Registro inmutable: quién hizo qué, cuándo y desde dónde (incluye accesos denegados)."
      />
      <FiltrosAuditoria
        params={plano}
        usuarios={usuarios.map((u) => ({ id: u.id, nombre: u.nombre }))}
        sistemas={sistemas.map((p) => ({ id: p.id, nombre: p.nombre }))}
        entidades={r.entidades}
        acciones={Object.values(AccionAuditoria)}
      />
      <ul className="mt-4 flex flex-col gap-2">
        {r.filas.length === 0 && (
          <li>
            {hayFiltros ? (
              <EmptyState
                icon={History}
                title="No hay registros con esos filtros"
                action={
                  <Link
                    href="/configuracion/auditoria"
                    className={buttonVariants({ variant: "secondary" })}
                  >
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={History}
                title="Todavía no hay registros"
                description="Cada alta, cambio, baja y acceso denegado queda anotado acá."
              />
            )}
          </li>
        )}
        {r.filas.map((a) => (
          <li key={a.id} className="bg-card text-small rounded-card">
            <details className="group">
              <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="text-subtle size-4 shrink-0 transition-transform group-open:rotate-90"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <Badge
                  variant={VARIANTE[a.accion] ?? "neutral"}
                  className={VARIANTE[a.accion] ? undefined : "bg-surface-3"}
                >
                  {a.accion}
                </Badge>
                <span className="font-medium">{a.entidad}</span>
                <Badge variant="neutral" className="bg-surface-3">
                  {a.sistema}
                </Badge>
                <span className="text-muted">
                  {a.usuario} · {formatearFechaHora(a.fecha)}
                  {a.ip ? ` · ${a.ip}` : ""}
                </span>
                {a.cambios.length > 0 && (
                  <span className="text-subtle">({a.cambios.length} campo(s))</span>
                )}
              </summary>
              <div className="border-border bg-surface rounded-inner mx-4 mb-4 overflow-x-auto border p-3">
                {a.cambios.length ? (
                  <table className="w-full text-xs">
                    <thead className="text-muted">
                      <tr>
                        <th className="py-1 pr-3 text-left font-medium">Campo</th>
                        <th className="py-1 pr-3 text-left font-medium">Antes</th>
                        <th className="py-1 text-left font-medium">Después</th>
                      </tr>
                    </thead>
                    <tbody className="divide-border divide-y font-mono">
                      {a.cambios.map((c) => (
                        <tr key={c.campo}>
                          <td className="py-1 pr-3 font-sans font-medium">{c.campo}</td>
                          <td
                            className="text-danger-soft-foreground max-w-72 truncate py-1 pr-3"
                            title={valor(c.antes)}
                          >
                            {valor(c.antes)}
                          </td>
                          <td
                            className="text-success-soft-foreground max-w-72 truncate py-1"
                            title={valor(c.despues)}
                          >
                            {valor(c.despues)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-muted">Sin datos de cambios.</p>
                )}
                {a.entidadId && (
                  <p className="text-muted mt-2 text-xs">
                    Id: <span className="font-mono">{a.entidadId}</span>
                  </p>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
      <Pagination
        className="mt-4"
        page={r.page}
        pageSize={r.pageSize}
        total={r.total}
        pathname="/configuracion/auditoria"
        params={plano}
      />
    </>
  );
}
