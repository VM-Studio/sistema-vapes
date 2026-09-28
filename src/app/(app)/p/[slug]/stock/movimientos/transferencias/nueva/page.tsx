import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { requirePaginaPanel } from "@/server/auth/permissions";
import { depositosActivosPanel } from "@/server/services/inventario.service";
import { obtenerVariantesPorId } from "@/server/services/producto.service";

import { StockTabs } from "../../movimientos-tabs";
import { NuevaTransferenciaForm } from "./nueva-transferencia-form";

export const metadata: Metadata = { title: "Nueva transferencia" };

type SP = Record<string, string | string[] | undefined>;

/** ?variante=id&origen=id precargan (acción "Transferir" desde Stock). Solo depósitos del panel. */
export default async function NuevaTransferenciaPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const ctx = await requirePaginaPanel(Modulo.STOCK, "crear");
  const params = await searchParams;
  const depositos = await depositosActivosPanel(ctx);
  const origen =
    (typeof params.origen === "string" && depositos.find((d) => d.id === params.origen)?.id) ||
    depositos.find((d) => d.esPrincipal)?.id ||
    depositos[0]?.id ||
    "";
  const destino = depositos.find((d) => d.id !== origen)?.id ?? "";
  const precargadas =
    typeof params.variante === "string"
      ? await obtenerVariantesPorId(ctx, [params.variante], origen)
      : [];

  return (
    <>
      <StockTabs panel={ctx.panel} usuario={ctx.usuario} actual="transferencias" />
      <NuevaTransferenciaForm
        depositos={depositos}
        origenInicial={origen}
        destinoInicial={destino}
        precargadas={precargadas}
      />
    </>
  );
}
