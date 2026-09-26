import { KeyRound } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { esOwner } from "@/lib/permisos";
import { requirePaginaUsuario } from "@/server/auth/permissions";

import { formatearFechaHora } from "@/lib/utils";
import { listarSesionesActivas } from "@/server/auth/sesiones";

import { CambiarPasswordForm } from "./cambiar-password-form";
import { CerrarTodas } from "./cerrar-todas";

export const metadata: Metadata = { title: "Mi cuenta" };

function dispositivo(ua: string | null): string {
  if (!ua) return "Dispositivo desconocido";
  const so = /android/i.test(ua)
    ? "Android"
    : /iphone|ipad/i.test(ua)
      ? "iPhone / iPad"
      : /windows/i.test(ua)
        ? "Windows"
        : /mac os/i.test(ua)
          ? "Mac"
          : /linux/i.test(ua)
            ? "Linux"
            : "Otro";
  const nav = /edg\//i.test(ua)
    ? "Edge"
    : /chrome|crios/i.test(ua)
      ? "Chrome"
      : /firefox|fxios/i.test(ua)
        ? "Firefox"
        : /safari/i.test(ua)
          ? "Safari"
          : "Navegador";
  return `${nav} en ${so}`;
}

export default async function CuentaPage() {
  const usuario = await requirePaginaUsuario({ permitirCambioPendiente: true });
  const sesiones = await listarSesionesActivas(usuario.id);

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader title="Mi cuenta" subtitle="Tus datos y tu contraseña" />

      {usuario.debeCambiarPassword && (
        <div
          role="alert"
          className="border-warning-soft-foreground/20 bg-warning-soft text-warning-soft-foreground flex gap-3 rounded-xl border p-4 text-sm"
        >
          <KeyRound className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>
            <strong className="font-semibold">
              Tenés que cambiar tu contraseña para continuar.
            </strong>{" "}
            La que usaste es temporal: elegí una nueva que solo sepas vos.
          </p>
        </div>
      )}

      <Card>
        <CardContent className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <span className="text-muted">Nombre</span>
          <span className="font-medium">{usuario.nombre}</span>
          <span className="text-muted">Email</span>
          <span className="font-medium break-all">{usuario.email}</span>
          <span className="text-muted">Rol</span>
          <span>
            <Badge variant={esOwner(usuario) ? "primary" : "neutral"}>
              {esOwner(usuario) ? "Dueño" : "Empleado"}
            </Badge>
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sesiones abiertas</CardTitle>
          <CardDescription>Dispositivos donde tu usuario está ingresado.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="divide-border flex flex-col divide-y text-sm">
            {sesiones.map((s) => (
              <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="min-w-0 truncate">{dispositivo(s.userAgent)}</span>
                <span className="text-muted text-xs">
                  {s.ip ?? "IP desconocida"} · último uso {formatearFechaHora(s.ultimoUso)}
                </span>
              </li>
            ))}
          </ul>
          <CerrarTodas />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cambiar contraseña</CardTitle>
          <CardDescription>Te vamos a pedir la actual para confirmar que sos vos.</CardDescription>
        </CardHeader>
        <CardContent>
          <CambiarPasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
