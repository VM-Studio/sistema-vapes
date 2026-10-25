import { LayoutGrid, ScanBarcode, ShieldX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { rutaPanel } from "@/lib/paneles";
import { esPerfilEscaneo } from "@/lib/permisos";
import { requirePaginaPanelUsuario } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Sin acceso" };

/** Sin permiso para un módulo DENTRO de un panel al que sí se accede. */
export default async function SinAccesoPanelPage() {
  const { panel, usuario } = await requirePaginaPanelUsuario();
  // «Escaneo (Charly)»: su única pantalla es la de escaneo.
  if (esPerfilEscaneo(usuario)) {
    return (
      <EmptyState
        icon={ShieldX}
        title="No tenés acceso a esta sección"
        description="Tu usuario solo escanea las ventas que te piden desde el galpón."
        action={
          <Link href={rutaPanel(panel.slug, "/escaneo")} className={buttonVariants()}>
            <ScanBarcode strokeWidth={1.75} /> Volver a las ventas para escanear
          </Link>
        }
        className="mt-8"
      />
    );
  }
  return (
    <EmptyState
      icon={ShieldX}
      title="No tenés acceso a este módulo"
      description={`Tu usuario no tiene permiso para esta sección de ${panel.nombre}. Si lo necesitás, pedile a un dueño que te lo habilite.`}
      action={
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Link href={rutaPanel(panel.slug)} className={buttonVariants()}>
            Ir al inicio de {panel.nombre}
          </Link>
          <Link href="/paneles" className={buttonVariants({ variant: "secondary" })}>
            <LayoutGrid strokeWidth={1.75} /> Cambiar de sistema
          </Link>
        </div>
      }
      className="mt-8"
    />
  );
}
