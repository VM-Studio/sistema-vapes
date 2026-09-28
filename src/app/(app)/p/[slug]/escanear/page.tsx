import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { requirePaginaPanelAlguno } from "@/server/auth/permissions";
import { listarDepositosActivos } from "@/server/services/deposito.service";

import { EscanearHub } from "./escanear-hub";

export const metadata: Metadata = { title: "Escanear" };

/**
 * Hub de escaneo del panel. Entrar: ver en Stock, Productos, Compras o Ventas.
 * Cada modo que escribe pide su propio permiso (y conexión).
 */
export default async function EscanearPage() {
  const ctx = await requirePaginaPanelAlguno(
    [Modulo.STOCK, Modulo.PRODUCTOS, Modulo.COMPRAS, Modulo.VENTAS],
    "ver",
  );
  const depositos = await listarDepositosActivos(ctx);
  return <EscanearHub depositos={depositos} />;
}
