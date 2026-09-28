import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { esOwner } from "@/lib/permisos";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { depositosActivosPanel } from "@/server/services/inventario.service";
import { obtenerVariantesPorId } from "@/server/services/producto.service";

import { StockTabs } from "../movimientos-tabs";
import { IngresoForm } from "./ingreso-form";

export const metadata: Metadata = { title: "Ingreso de stock" };

type SP = Record<string, string | string[] | undefined>;

/** ?variantes=id1,id2&deposito=id precargan el formulario (ej: "Guardar y cargar stock inicial"). */
export default async function IngresoPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.STOCK, "crear");
  const params = await searchParams;
  const depositos = await depositosActivosPanel(ctx);
  const depositoInicial =
    (typeof params.deposito === "string" && depositos.find((d) => d.id === params.deposito)?.id) ||
    depositos.find((d) => d.esPrincipal)?.id ||
    depositos[0]?.id ||
    "";
  const ids =
    typeof params.variantes === "string"
      ? params.variantes.split(",").filter(Boolean).slice(0, 200)
      : [];
  const precargadas = await obtenerVariantesPorId(ctx, ids, depositoInicial || undefined);

  return (
    <>
      <StockTabs panel={ctx.panel} usuario={ctx.usuario} actual="ingreso" />
      <IngresoForm
        depositos={depositos}
        depositoInicial={depositoInicial}
        precargadas={precargadas}
        conCostos={esOwner(ctx.usuario)}
      />
    </>
  );
}
