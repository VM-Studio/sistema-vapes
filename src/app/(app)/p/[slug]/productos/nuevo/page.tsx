import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { requirePaginaPanel } from "@/server/auth/permissions";
import { tieneMercadoLibre } from "@/lib/medios-pago";
import { listarCategoriasActivas } from "@/server/services/categoria.service";
import { obtenerConfigVentas } from "@/server/services/configuracion.service";
import { listarMarcasActivas } from "@/server/services/marca.service";

import { ProductoForm } from "../producto-form";

export const metadata: Metadata = { title: "Nuevo producto" };

export default async function NuevoProductoPage() {
  const ctx = await requirePaginaPanel(Modulo.PRODUCTOS, "crear");
  const [categorias, marcas, configVentas] = await Promise.all([
    listarCategoriasActivas(ctx),
    listarMarcasActivas(ctx),
    obtenerConfigVentas(ctx),
  ]);
  return (
    <ProductoForm
      producto={null}
      categorias={categorias.map((c) => ({ value: c.id, label: c.nombre }))}
      marcas={marcas.map((m) => m.nombre)}
      conMercadoLibre={tieneMercadoLibre(configVentas)}
    />
  );
}
