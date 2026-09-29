import { RolUsuario } from "@prisma/client";
import { ArrowLeft, MonitorSmartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { dispositivo } from "@/lib/dispositivo";
import { formatearFechaHora } from "@/lib/utils";
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
    <div className="flex flex-col gap-8">
      <Link
        href="/usuarios"
        className="text-muted hover:text-foreground flex w-fit items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden /> Usuarios
      </Link>
      <div className="flex items-center gap-4">
        <Avatar nombre={usuario.nombre} />
        <PageHeader
          title={usuario.nombre}
          subtitle={usuario.email}
          actions={
            <Badge variant={owner ? "primary" : "neutral"}>{owner ? "Dueño" : "Empleado"}</Badge>
          }
        />
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="titulo-acceso">
        <div>
          <h2 id="titulo-acceso" className="text-xl font-semibold">
            Acceso por sistema
          </h2>
          <p className="text-muted text-sm">
            Marcá los sistemas que puede abrir y, en cada uno, qué puede hacer en cada módulo.
          </p>
        </div>
        <AccesoForm
          usuarioId={usuario.id}
          esOwner={owner}
          paneles={visibles}
          habilitadosIniciales={acceso.paneles}
          permisosIniciales={acceso.permisos}
        />
      </section>

      {!owner && (
        <section className="flex flex-col gap-4" aria-labelledby="titulo-comision">
          <div>
            <h2 id="titulo-comision" className="text-xl font-semibold">
              Comisión
            </h2>
            <p className="text-muted text-sm">
              Opcional. Porcentaje sobre sus ventas unitarias y mayoristas.
            </p>
          </div>
          <ComisionForm
            usuarioId={usuario.id}
            unitariaPct={usuario.comisionUnitariaPct}
            mayoristaPct={usuario.comisionMayoristaPct}
          />
        </section>
      )}

      <section className="flex flex-col gap-4" aria-labelledby="titulo-sesiones">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="titulo-sesiones" className="text-xl font-semibold">
              Sesiones activas
            </h2>
            <p className="text-muted text-sm">Dispositivos donde tiene la sesión abierta.</p>
          </div>
          <CerrarSesiones
            usuarioId={usuario.id}
            nombre={usuario.nombre}
            cantidad={sesiones.length}
          />
        </div>
        {sesiones.length === 0 ? (
          <p className="border-border bg-surface-2 rounded-2xl border p-5 text-sm">
            No tiene sesiones abiertas.
          </p>
        ) : (
          <ul className="border-border bg-surface divide-border divide-y rounded-2xl border">
            {sesiones.map((s) => (
              <li key={s.id} className="flex items-center gap-3 p-4">
                <MonitorSmartphone
                  className="text-muted size-5 shrink-0"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{dispositivo(s.userAgent)}</p>
                  <p className="text-muted text-xs">
                    Último uso: {formatearFechaHora(s.ultimoUso)} · Desde{" "}
                    {formatearFechaHora(s.createdAt)}
                    {s.ip ? ` · IP ${s.ip}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
