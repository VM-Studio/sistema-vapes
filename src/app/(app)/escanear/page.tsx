import { Modulo } from "@prisma/client";
import { ScanBarcode } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requirePaginaPermisoAlguno } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Escanear" };

/** Placeholder indicado por el spec: el escáner (pistola + cámara) llega en el Prompt 4. */
export default async function EscanearPage() {
  await requirePaginaPermisoAlguno([Modulo.VENTAS, Modulo.INVENTARIO], "ver");
  return (
    <>
      <PageHeader title="Escanear" subtitle="Pistola lectora y cámara del celular" />
      <EmptyState
        icon={ScanBarcode}
        title="Disponible en la próxima etapa"
        description="La búsqueda por código de barras ya está lista en el sistema (la usan Productos, Inventario y Movimientos); acá se suma el escaneo con pistola y cámara."
      />
    </>
  );
}
