import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { requirePaginaPermiso } from "@/server/auth/permissions";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import { obtenerVariantesPorId } from "@/server/services/producto.service";

import { MovimientosTabs } from "../../movimientos-tabs";
import { NuevaTransferenciaForm } from "./nueva-transferencia-form";

export const metadata: Metadata = { title: "Nueva transferencia" };

type SP = Record<string, string | string[] | undefined>;

/** ?variante=id&origen=id precargan (acción "Transferir" desde Inventario). */
export default async function NuevaTransferenciaPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const usuario = await requirePaginaPermiso(Modulo.MOVIMIENTOS, "crear");
  const params = await searchParams;
  const depositos = await listarDepositosActivos();
  const origen =
    (typeof params.origen === "string" && depositos.find((d) => d.id === params.origen)?.id) ||
    depositos.find((d) => d.esPrincipal)?.id ||
    depositos[0]?.id ||
    "";
  const destino = depositos.find((d) => d.id !== origen)?.id ?? "";
  const precargadas =
    typeof params.variante === "string"
      ? await obtenerVariantesPorId([params.variante], origen)
      : [];

  return (
    <>
      <MovimientosTabs usuario={usuario} actual="transferencias" />
      <NuevaTransferenciaForm
        depositos={depositos}
        origenInicial={origen}
        destinoInicial={destino}
        precargadas={precargadas}
      />
    </>
  );
}
