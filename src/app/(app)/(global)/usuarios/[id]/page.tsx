import { RolUsuario } from "@prisma/client";
import { MonitorSmartphone } from "lucide-react";
import type { Metadata } from "next";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { dispositivo } from "@/lib/dispositivo";
import { cn, formatearFechaHora } from "@/lib/utils";
import { requirePaginaOwner } from "@/server/auth/permissions";
import { listarSesionesActivas } from "@/server/auth/sesiones";
import { listarTodosLosPaneles } from "@/server/services/panel.service";
import { obtenerAcceso, obtenerUsuario } from "@/server/services/usuario.service";

import { AccesoForm } from "./acceso-form";
import { CerrarSesiones } from "./cerrar-sesiones";
import { ComisionForm } from "./comision-form";

export const metadata: Metadata = { title: "Acceso del usuario" };

export default async function UsuarioPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePaginaOwner();
  const { id } = await params;
  const usuario = await obtenerUsuario(id);
  const [paneles, acceso, sesiones] = await Promise.all([
    listarTodosLosPaneles(),
    obtenerAcceso(id),
    listarSesionesActivas(id),
  ]);
  const owner = usuario.rol === RolUsuario.OWNER;
  // Paneles desactivados solo aparecen si todavía los tiene habilitados.
  const visibles = paneles.filter((p) => p.activo || acceso.paneles.includes(p.id));

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[{ label: "Usuarios", href: "/usuarios" }, { label: usuario.nombre }]}
          />
        }
        title={usuario.nombre}
        subtitle="Datos, acceso por sistema y sesiones"
      />

      {/* Desktop: datos, comisión y sesiones a la izquierda; acceso (la grilla) a la derecha. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <SectionCard title="Datos" className="lg:col-start-1 lg:row-start-1">
          <div className="flex items-center gap-3">
            <Avatar nombre={usuario.nombre} className="size-12 text-sm" />
            <div className="flex min-w-0 flex-col">
              <p className="truncate font-medium">{usuario.nombre}</p>
              <p className="text-muted text-small truncate">{usuario.email}</p>
            </div>
          </div>
          <dl className="text-small mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
            <dt className="text-muted">Rol</dt>
            <dd>
              <Badge
                variant={owner ? "primary" : "neutral"}
                className={owner ? undefined : "bg-surface-3"}
              >
                {owner ? "Dueño" : "Empleado"}
              </Badge>
            </dd>
            <dt className="text-muted">Estado</dt>
            <dd className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn("rounded-circle size-2", usuario.activo ? "bg-success" : "bg-danger")}
              />
              {usuario.activo ? "Activo" : "Inactivo"}
            </dd>
            <dt className="text-muted">Último acceso</dt>
            <dd className="tabular-nums">
              {usuario.ultimoLogin ? formatearFechaHora(usuario.ultimoLogin) : "Nunca"}
            </dd>
          </dl>
        </SectionCard>

        <SectionCard
          title={<span id="titulo-acceso">Acceso por sistema</span>}
          description="Marcá los sistemas que puede abrir y, en cada uno, qué puede hacer en cada módulo."
          className="lg:col-start-2 lg:row-span-3 lg:row-start-1"
        >
          <AccesoForm
            usuarioId={usuario.id}
            esOwner={owner}
            paneles={visibles}
            habilitadosIniciales={acceso.paneles}
            permisosIniciales={acceso.permisos}
          />
        </SectionCard>

        {!owner && (
          <SectionCard
            title={<span id="titulo-comision">Comisión</span>}
            description="Opcional. Porcentaje sobre sus ventas unitarias y mayoristas."
            className="lg:col-start-1"
          >
            <ComisionForm
              usuarioId={usuario.id}
              unitariaPct={usuario.comisionUnitariaPct}
              mayoristaPct={usuario.comisionMayoristaPct}
            />
          </SectionCard>
        )}

        <SectionCard
          title={<span id="titulo-sesiones">Sesiones activas</span>}
          description="Dispositivos donde tiene la sesión abierta."
          className="lg:col-start-1"
          contentClassName="flex flex-col gap-4"
        >
          {sesiones.length === 0 ? (
            <p className="text-muted text-small">No tiene sesiones abiertas.</p>
          ) : (
            <ul className="border-border bg-surface divide-border rounded-card max-h-[28rem] divide-y overflow-y-auto overscroll-contain border">
              {sesiones.map((s) => (
                <li key={s.id} className="flex items-start gap-3 p-4">
                  <MonitorSmartphone
                    className="text-muted mt-0.5 size-5 shrink-0"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{dispositivo(s.userAgent)}</p>
                    <p className="text-muted text-small">
                      Último uso: {formatearFechaHora(s.ultimoUso)} · Desde{" "}
                      {formatearFechaHora(s.createdAt)}
                      {s.ip ? ` · IP ${s.ip}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <CerrarSesiones
            usuarioId={usuario.id}
            nombre={usuario.nombre}
            cantidad={sesiones.length}
          />
        </SectionCard>
      </div>
    </>
  );
}
