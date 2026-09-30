import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { requirePaginaPanel } from "@/server/auth/permissions";
import { obtenerVariantesPorId } from "@/server/services/producto.service";
import { resumenStock } from "@/server/services/stock.service";

import { NuevaTransferencia } from "./nueva-transferencia";

export const metadata: Metadata = { title: "Nueva transferencia" };

type SP = Record<string, string | string[] | undefined>;

/**
 * Nueva transferencia con pistola: origen y destino → productos (escáner,
 * cámara o buscador) → confirmar ("Mover ahora" o "Registrar envío").
 * Desde la fila de Stock llega con ?variante=&origen=(&destino=): el sabor
 * queda cargado y, si origen y destino están, arranca en Productos.
 */
export default async function NuevaTransferenciaPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const ctx = await requirePaginaPanel(Modulo.STOCK, "crear");
  const sp = await searchParams;
  const texto = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const varianteId = texto("variante");
  const [resumen, variantes] = await Promise.all([
    resumenStock(ctx),
    varianteId ? obtenerVariantesPorId(ctx, [varianteId]) : Promise.resolve([]),
  ]);
  const depositos = resumen.porDeposito;
  const valido = (id: string | null) => (depositos.some((d) => d.id === id) ? id : null);
  return (
    <NuevaTransferencia
      depositos={depositos.map((d) => ({ id: d.id, nombre: d.nombre, esPrincipal: d.esPrincipal }))}
      unidades={Object.fromEntries(depositos.map((d) => [d.id, d.unidades]))}
      origenInicial={valido(texto("origen"))}
      destinoInicial={valido(texto("destino"))}
      varianteInicial={variantes[0] ?? null}
    />
  );
}
