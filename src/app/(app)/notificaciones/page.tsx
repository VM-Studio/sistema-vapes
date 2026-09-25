import { Bell } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requirePaginaUsuario } from "@/server/auth/permissions";
import { listarNotificaciones } from "@/server/services/notificacion.service";

import { ListaNotificaciones } from "./lista-notificaciones";

export const metadata: Metadata = { title: "Notificaciones" };

export default async function NotificacionesPage() {
  const usuario = await requirePaginaUsuario();
  const notificaciones = await listarNotificaciones(usuario.id);
  return (
    <>
      <PageHeader
        title="Notificaciones"
        subtitle="Stock bajo, cajas con diferencia, transferencias demoradas y deudas viejas."
      />
      {notificaciones.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No tenés notificaciones"
          description="El control diario avisa acá cuando algo necesita atención."
        />
      ) : (
        <ListaNotificaciones notificaciones={notificaciones} />
      )}
    </>
  );
}
