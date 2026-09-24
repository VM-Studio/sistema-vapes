import { KeyRound } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { esOwner } from "@/lib/permisos";
import { requirePaginaUsuario } from "@/server/auth/permissions";

import { CambiarPasswordForm } from "./cambiar-password-form";

export const metadata: Metadata = { title: "Mi cuenta" };

export default async function CuentaPage() {
  const usuario = await requirePaginaUsuario({ permitirCambioPendiente: true });

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
