import { AccionAuditoria } from "@prisma/client";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
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
  const [r, usuarios, sistemas] = await Promise.all([
    listarAuditoria(f),
    listarUsuariosBasico(),
    listarTodosLosPaneles(),
  ]);
  return (
    <>
      <TabsNav
        items={tabsConfiguracion("/configuracion/auditoria")}
        className="mb-4"
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
        {r.filas.map((a) => (
          <li key={a.id} className="border-border bg-surface rounded-2xl border p-4 text-sm">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <Badge variant={VARIANTE[a.accion] ?? "neutral"}>{a.accion}</Badge>
                <span className="font-medium">{a.entidad}</span>
                <Badge variant="neutral">{a.sistema}</Badge>
                <span className="text-muted">
                  {a.usuario} · {formatearFechaHora(a.fecha)}
                  {a.ip ? ` · ${a.ip}` : ""}
                </span>
                {a.cambios.length > 0 && (
                  <span className="text-muted text-xs">({a.cambios.length} campo(s))</span>
                )}
              </summary>
              <div className="mt-3 overflow-x-auto">
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
                            className="bg-danger-soft/40 max-w-72 truncate py-1 pr-3"
                            title={valor(c.antes)}
                          >
                            {valor(c.antes)}
                          </td>
                          <td
                            className="bg-success-soft/40 max-w-72 truncate py-1"
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
