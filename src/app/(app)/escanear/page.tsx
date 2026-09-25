import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { requirePaginaPermiso } from "@/server/auth/permissions";
import { listarDepositosActivos } from "@/server/services/deposito.service";

import { EscanearHub } from "./escanear-hub";

export const metadata: Metadata = { title: "Escanear" };

/** Hub de escaneo. Entrar: ver Inventario. Cada modo que escribe pide su propio permiso. */
export default async function EscanearPage() {
  await requirePaginaPermiso(Modulo.INVENTARIO, "ver");
  const depositos = await listarDepositosActivos();
  return <EscanearHub depositos={depositos} />;
}
