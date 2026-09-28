import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { TabsNav } from "@/components/ui/tabs-nav";
import { rutaPanel } from "@/lib/paneles";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { depositosActivosPanel } from "@/server/services/inventario.service";
import { obtenerVariantesPorId } from "@/server/services/producto.service";

import { StockTabs } from "../movimientos-tabs";
import { AjusteSimple } from "./ajuste-simple";
import { Recuento } from "./recuento";

export const metadata: Metadata = { title: "Ajuste de stock" };

type SP = Record<string, string | string[] | undefined>;

export default async function AjustePage({ searchParams }: { searchParams: Promise<SP> }) {
  // Ajustar stock: solo OWNER o quien tenga "editar" en Stock (en este panel).
  const ctx = await requirePaginaPanel(Modulo.STOCK, "editar");
  const params = await searchParams;
  const modo = params.modo === "recuento" ? "recuento" : "simple";
  const depositos = await depositosActivosPanel(ctx);
  const depositoInicial =
    (typeof params.deposito === "string" && depositos.find((d) => d.id === params.deposito)?.id) ||
    depositos.find((d) => d.esPrincipal)?.id ||
    depositos[0]?.id ||
    "";
  const precargada =
    typeof params.variante === "string"
      ? ((await obtenerVariantesPorId(ctx, [params.variante], depositoInicial))[0] ?? null)
      : null;

  return (
    <>
      <StockTabs panel={ctx.panel} usuario={ctx.usuario} actual="ajuste" />
      <TabsNav
        className="mb-4"
        ariaLabel="Modo de ajuste"
        items={[
          {
            href: rutaPanel(ctx.panel.slug, "/stock/movimientos/ajuste"),
            label: "Ajuste simple",
            activo: modo === "simple",
          },
          {
            href: rutaPanel(ctx.panel.slug, "/stock/movimientos/ajuste?modo=recuento"),
            label: "Recuento de depósito",
            activo: modo === "recuento",
          },
        ]}
      />
      {modo === "simple" ? (
        <AjusteSimple
          depositos={depositos}
          depositoInicial={depositoInicial}
          precargada={precargada}
        />
      ) : (
        <Recuento depositos={depositos} depositoInicial={depositoInicial} />
      )}
    </>
  );
}
