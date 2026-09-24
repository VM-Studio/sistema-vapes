import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { requirePaginaPermiso } from "@/server/auth/permissions";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import { obtenerVariantesPorId } from "@/server/services/producto.service";

import { MovimientosTabs } from "../movimientos-tabs";
import { IngresoForm } from "./ingreso-form";

export const metadata: Metadata = { title: "Ingreso manual" };

type SP = Record<string, string | string[] | undefined>;

/** ?variantes=id1,id2&deposito=id precargan el formulario (ej: "Guardar y cargar stock inicial"). */
export default async function IngresoPage({ searchParams }: { searchParams: Promise<SP> }) {
  const usuario = await requirePaginaPermiso(Modulo.MOVIMIENTOS, "crear");
  const params = await searchParams;
  const depositos = await listarDepositosActivos();
  const depositoInicial =
    (typeof params.deposito === "string" && depositos.find((d) => d.id === params.deposito)?.id) ||
    depositos.find((d) => d.esPrincipal)?.id ||
    depositos[0]?.id ||
    "";
  const ids =
    typeof params.variantes === "string"
      ? params.variantes.split(",").filter(Boolean).slice(0, 200)
      : [];
  const precargadas = await obtenerVariantesPorId(ids, depositoInicial || undefined);

  return (
    <>
      <MovimientosTabs usuario={usuario} actual="ingreso" />
      <IngresoForm
        depositos={depositos}
        depositoInicial={depositoInicial}
        precargadas={precargadas}
      />
    </>
  );
}
