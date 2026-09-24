import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { TabsNav } from "@/components/ui/tabs-nav";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import { obtenerVariantesPorId } from "@/server/services/producto.service";

import { MovimientosTabs } from "../movimientos-tabs";
import { AjusteSimple } from "./ajuste-simple";
import { Recuento } from "./recuento";

export const metadata: Metadata = { title: "Ajuste de stock" };

type SP = Record<string, string | string[] | undefined>;

export default async function AjustePage({ searchParams }: { searchParams: Promise<SP> }) {
  // Ajustar stock: solo OWNER o quien tenga "editar" en Movimientos.
  const usuario = await requirePaginaPermiso(Modulo.MOVIMIENTOS, "editar");
  const params = await searchParams;
  const modo = params.modo === "recuento" ? "recuento" : "simple";
  const depositos = await listarDepositosActivos();
  const depositoInicial =
    (typeof params.deposito === "string" && depositos.find((d) => d.id === params.deposito)?.id) ||
    depositos.find((d) => d.esPrincipal)?.id ||
    depositos[0]?.id ||
    "";
  const precargada =
    typeof params.variante === "string"
      ? ((await obtenerVariantesPorId([params.variante], depositoInicial))[0] ?? null)
      : null;

  return (
    <>
      <MovimientosTabs usuario={usuario} actual="ajuste" />
      <TabsNav
        className="mb-4"
        ariaLabel="Modo de ajuste"
        items={[
          { href: "/movimientos/ajuste", label: "Ajuste simple", activo: modo === "simple" },
          {
            href: "/movimientos/ajuste?modo=recuento",
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
