import { LayoutGrid, ShieldX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { rutaPanel } from "@/lib/paneles";
import { requirePaginaPanelUsuario } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Sin acceso" };

/** Sin permiso para un módulo DENTRO de un panel al que sí se accede. */
export default async function SinAccesoPanelPage() {
  const { panel } = await requirePaginaPanelUsuario();
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
