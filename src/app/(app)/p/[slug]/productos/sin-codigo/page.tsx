import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { puede } from "@/lib/permisos";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { listarSinCodigo } from "@/server/services/producto.service";

import { SinCodigoView } from "./sin-codigo-view";

export const metadata: Metadata = { title: "Productos sin código de barras" };

/** Sabores cargados a mano que nunca se escanearon: se les vincula el código de a uno. */
export default async function SinCodigoPage() {
  const ctx = await requirePaginaPanel(Modulo.PRODUCTOS, "ver");
  const sabores = await listarSinCodigo(ctx);
  return (
    <SinCodigoView
      sabores={sabores}
      puedeVincular={puede(ctx.usuario, ctx.panelId, Modulo.PRODUCTOS, "editar")}
    />
  );
}
