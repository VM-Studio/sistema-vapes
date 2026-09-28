import { ShieldX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requirePaginaUsuario } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Sin acceso" };

export default async function SinAccesoPage() {
  await requirePaginaUsuario();
  return (
    <EmptyState
      icon={ShieldX}
      title="No tenés acceso a este módulo"
      description="Pedile a un dueño que te lo habilite."
      action={
        <Link href="/" className={buttonVariants({ variant: "secondary" })}>
          Volver al inicio
        </Link>
      }
      className="mt-8"
    />
  );
}
