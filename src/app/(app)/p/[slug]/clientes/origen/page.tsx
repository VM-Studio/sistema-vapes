import type { Metadata } from "next";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/ui/page-header";
import { rutaPanel } from "@/lib/paneles";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import { listarClientesSinOrigen } from "@/server/services/cliente.service";

import { CompletarOrigen } from "./completar-origen";

export const metadata: Metadata = { title: "¿De quién viene cada cliente?" };

/**
 * Dueños: responder «¿De quién viene este cliente?» de los clientes que se
 * cargaron antes de que existiera la pregunta (v2.13.0). Desde entonces es
 * obligatoria en toda alta, así que esta lista solo se va vaciando.
 */
export default async function OrigenClientesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const ctx = await requirePaginaPanelOwner();
  const { slug } = await params;
  const { clientes, origenes } = await listarClientesSinOrigen(ctx);
  return (
    <>
      <PageHeader
        title="¿De quién viene cada cliente?"
        subtitle="Para los clientes que ya estaban cargados. Si viene de un vendedor, todas sus ventas a ese cliente cuentan como de cliente nuevo en su ganancia (también las de este mes que todavía no se liquidó)."
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "Clientes", href: rutaPanel(slug, "/clientes") },
              { label: "De quién viene" },
            ]}
          />
        }
      />
      <CompletarOrigen clientes={clientes} origenes={origenes} />
    </>
  );
}
