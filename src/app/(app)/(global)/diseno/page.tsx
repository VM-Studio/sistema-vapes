import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requirePaginaOwner } from "@/server/auth/permissions";

import { Catalogo } from "./catalogo";

export const metadata: Metadata = { title: "Sistema de diseño" };

/**
 * /diseno — referencia viva del sistema de diseño (docs/DISENO.md): todos los
 * componentes con sus variantes. Solo en desarrollo y solo para dueños.
 */
export default async function DisenoPage() {
  if (process.env.NODE_ENV === "production") notFound();
  await requirePaginaOwner();
  return <Catalogo />;
}
