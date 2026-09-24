import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { requirePaginaPermiso } from "@/server/auth/permissions";

import { ImportarView } from "./importar-view";

export const metadata: Metadata = { title: "Importar productos" };

export default async function ImportarPage() {
  await requirePaginaPermiso(Modulo.PRODUCTOS, "crear");
  return <ImportarView />;
}
