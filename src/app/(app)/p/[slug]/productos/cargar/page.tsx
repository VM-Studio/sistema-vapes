import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { requirePaginaPanelAlguno } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import { obtener } from "@/server/services/producto.service";

import { CargaStock } from "./carga-stock";

export const metadata: Metadata = { title: "Cargar stock" };

type SP = Record<string, string | string[] | undefined>;

/**
 * Carga de stock por escaneo (el flujo principal del depósito): primero el
 * galpón, después escanear. ?producto=<id> deja ese producto listo en el
 * buscador (viene de "Cargar stock de este producto").
 */
export default async function CargarStockPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanelAlguno([Modulo.PRODUCTOS, Modulo.STOCK], "crear");
  const sp = await searchParams;
  const productoId = typeof sp.producto === "string" ? sp.producto : null;
  const [depositos, producto] = await Promise.all([
    listarDepositosActivos(ctx),
    productoId
      ? obtener(ctx, productoId).catch((e: unknown) => {
          if (e instanceof NotFoundError) return null;
          throw e;
        })
      : Promise.resolve(null),
  ]);
  return <CargaStock depositos={depositos} buscarInicial={producto?.nombreCompleto ?? ""} />;
}
