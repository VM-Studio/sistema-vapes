import { KeyRound, MonitorSmartphone } from "lucide-react";
import type { Metadata } from "next";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { esOwner } from "@/lib/permisos";
import { dispositivo } from "@/lib/dispositivo";
import { requirePaginaUsuario } from "@/server/auth/permissions";

import { formatearFechaHora } from "@/lib/utils";
import { listarSesionesActivas } from "@/server/auth/sesiones";

import { CambiarPasswordForm } from "./cambiar-password-form";
import { CerrarTodas } from "./cerrar-todas";

export const metadata: Metadata = { title: "Mi cuenta" };

export default async function CuentaPage() {
  const usuario = await requirePaginaUsuario({ permitirCambioPendiente: true });
  const sesiones = await listarSesionesActivas(usuario.id);

  return (
    <>
      <PageHeader title="Mi cuenta" subtitle="Tus datos, tu contraseña y tus sesiones" />

      {usuario.debeCambiarPassword && (
        <div
          role="alert"
          className="bg-warning-soft text-warning-soft-foreground rounded-card mb-4 flex gap-3 p-4 text-sm"
        >
          <KeyRound className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
          <p>
            <strong className="font-semibold">
              Tenés que cambiar tu contraseña para continuar.
            </strong>{" "}
            La que usaste es temporal: elegí una nueva que solo sepas vos.
          </p>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <SectionCard title="Datos">
            <div className="flex items-center gap-3">
              <Avatar nombre={usuario.nombre} className="size-12 text-sm" />
              <div className="flex min-w-0 flex-col">
                <p className="truncate font-medium">{usuario.nombre}</p>
                <p className="text-muted text-small break-all">{usuario.email}</p>
              </div>
            </div>
            <dl className="text-small mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
              <dt className="text-muted">Rol</dt>
              <dd>
                <Badge
                  variant={esOwner(usuario) ? "primary" : "neutral"}
                  className={esOwner(usuario) ? undefined : "bg-surface-3"}
                >
                  {esOwner(usuario) ? "Dueño" : "Empleado"}
                </Badge>
              </dd>
            </dl>
          </SectionCard>

          <SectionCard
            title="Sesiones abiertas"
            description="Dispositivos donde tu usuario está ingresado."
            contentClassName="flex flex-col gap-4"
          >
            <ul className="border-border bg-surface divide-border rounded-card max-h-[28rem] divide-y overflow-y-auto overscroll-contain border">
              {sesiones.map((s) => (
                <li key={s.id} className="flex items-start gap-3 p-4">
                  <MonitorSmartphone
                    className="text-muted mt-0.5 size-5 shrink-0"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{dispositivo(s.userAgent)}</p>
                    <p className="text-muted text-small">
                      {s.ip ?? "IP desconocida"} · último uso {formatearFechaHora(s.ultimoUso)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <CerrarTodas />
          </SectionCard>
        </div>

        <SectionCard
          title="Cambiar contraseña"
          description="Te vamos a pedir la actual para confirmar que sos vos."
          className={usuario.debeCambiarPassword ? "order-first lg:order-none" : undefined}
        >
          <CambiarPasswordForm />
        </SectionCard>
      </div>
    </>
  );
}
