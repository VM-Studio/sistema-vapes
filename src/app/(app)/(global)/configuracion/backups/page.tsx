import { CheckCircle2, XCircle } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
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
        className="mb-4"
        ariaLabel="Configuración"
      />
      <PageHeader
        title="Backups"
        subtitle={`Copia completa de la base todos los días a las 4:00. Se guardan 30 diarios, 12 semanales y 12 mensuales. ${
          ultimoOk
            ? `Último correcto: ${formatearFechaHora(ultimoOk.createdAt)}.`
            : "Todavía no hay ninguno."
        }`}
        actions={<BotonBackup />}
      />
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
                  <CheckCircle2 className="size-3" aria-hidden /> Verificado
                </Badge>
              ) : (
                <Badge variant="danger">
                  <XCircle className="size-3" aria-hidden /> Falló
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
            header: "",
            cell: (b) =>
              b.ok ? (
                <BotonDescargar id={b.id} />
              ) : (
                <span className="text-danger text-xs">{b.error}</span>
              ),
          },
        ]}
      />
    </>
  );
}
