import { RolUsuario } from "@prisma/client";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requirePaginaOwner } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerPermisos, obtenerUsuario } from "@/server/services/usuario.service";

import { PermisosForm } from "./permisos-form";

export const metadata: Metadata = { title: "Permisos" };

export default async function PermisosPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePaginaOwner();
  const { id } = await params;

  const usuario = await obtenerUsuario(id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const volver = (
    <Link href="/usuarios" className={buttonVariants({ variant: "secondary" })}>
      <ArrowLeft /> Usuarios
    </Link>
  );

  if (usuario.rol === RolUsuario.OWNER) {
    return (
      <>
        <PageHeader title={`Permisos de ${usuario.nombre}`} actions={volver} />
        <EmptyState
          icon={ShieldCheck}
          title="Los dueños tienen acceso total"
          description="No se les asignan permisos por módulo. Para limitar su acceso, cambiale el rol a Empleado."
        />
      </>
    );
  }

  const permisos = await obtenerPermisos(usuario.id);
  return (
    <>
      <PageHeader
        title={`Permisos de ${usuario.nombre}`}
        subtitle="Qué puede ver y hacer en cada módulo. Los cambios aplican en su próximo request, sin volver a ingresar."
        actions={volver}
      />
      <PermisosForm usuarioId={usuario.id} permisosIniciales={permisos} />
    </>
  );
}
