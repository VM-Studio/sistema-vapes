import { Construction } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Cuerpo de los módulos cuya funcionalidad se construye en etapas siguientes.
 * La página ya existe y ya está protegida por permisos (lo que se prueba acá).
 */
export function ModuloProximamente({
  titulo,
  descripcion,
}: {
  titulo: string;
  descripcion: string;
}) {
  return (
    <>
      <PageHeader title={titulo} subtitle={descripcion} />
      <EmptyState
        icon={Construction}
        title="Módulo en preparación"
        description="La estructura y los permisos de este módulo ya están activos. Sus pantallas se habilitan en la próxima etapa del sistema."
      />
    </>
  );
}
