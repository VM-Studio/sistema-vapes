import { CheckCircle2, XCircle } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { TabsNav } from "@/components/ui/tabs-nav";
import { formatearFechaHora } from "@/lib/utils";
import { requirePaginaOwner } from "@/server/auth/permissions";
import { listarBackups } from "@/server/services/backup.service";

import { tabsConfiguracion } from "../secciones";
import { BotonBackup, BotonDescargar } from "./botones";

export const metadata: Metadata = { title: "Backups" };

const kib = (n: number | null) =>
  n === null
    ? "—"
    : n > 1024 * 1024
      ? `${(n / 1024 / 1024).toFixed(1)} MB`
      : `${(n / 1024).toFixed(0)} KB`;

export default async function BackupsPage() {
  await requirePaginaOwner();
  const backups = await listarBackups();
  const ultimoOk = backups.find((b) => b.ok);
  return (
    <>
      <TabsNav
        items={tabsConfiguracion("/configuracion/backups")}
        className="mb-6"
        ariaLabel="Configuración"
      />
      <PageHeader
        title="Backups"
        subtitle="Copias completas de la base, verificadas y guardadas fuera del servidor."
        actions={<BotonBackup />}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Último backup correcto"
          value={ultimoOk ? formatearFechaHora(ultimoOk.createdAt) : "Ninguno"}
          hint={ultimoOk ? kib(ultimoOk.tamanio) : "Todavía no hay ninguno."}
        />
        <StatCard label="Frecuencia" value="Diario" hint="Todos los días a las 4:00" />
        <StatCard
          label="Se conservan"
          value="30 · 12 · 12"
          hint="Diarios · semanales · mensuales"
        />
      </div>
      <DataTable
        caption="Backups"
        rows={backups}
        getRowKey={(b) => b.id}
        columns={[
          { key: "f", header: "Fecha", cell: (b) => formatearFechaHora(b.createdAt) },
          {
            key: "e",
            header: "Estado",
            cell: (b) =>
              b.ok ? (
                <Badge variant="success">
                  <CheckCircle2 strokeWidth={1.75} aria-hidden /> Verificado
                </Badge>
              ) : (
                <Badge variant="danger">
                  <XCircle strokeWidth={1.75} aria-hidden /> Falló
                </Badge>
              ),
          },
          {
            key: "o",
            header: "Origen",
            cell: (b) =>
              ({ cron: "Automático", manual: "Manual", release: "Antes de migrar" })[b.origen] ??
              b.origen,
          },
          {
            key: "t",
            header: "Tamaño",
            className: "text-right tabular-nums",
            cell: (b) => kib(b.tamanio),
          },
          {
            key: "d",
            header: "Duración",
            className: "text-right tabular-nums",
            cell: (b) => `${(b.duracionMs / 1000).toFixed(1)} s`,
          },
          {
            key: "x",
            header: <span className="sr-only">Acciones</span>,
            className: "text-right",
            cell: (b) =>
              b.ok ? (
                <BotonDescargar id={b.id} />
              ) : (
                <span className="text-danger text-small">{b.error}</span>
              ),
          },
        ]}
      />
    </>
  );
}
