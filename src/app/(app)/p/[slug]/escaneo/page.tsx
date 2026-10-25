import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { requirePaginaPanel } from "@/server/auth/permissions";
import { listarPendientesDeEscaneo } from "@/server/services/escaneo-remoto.service";

import { PantallaEscaneo } from "./pantalla-escaneo";

export const metadata: Metadata = { title: "Ventas para escanear" };

/**
 * «Escanea Charly»: la pantalla del usuario de escaneo (Modulo ESCANEO). Lista
 * las ventas que le pidieron escanear (de todos los vendedores) y, al tocar
 * una, escanea cada vape con la pistola o la cámara. Para el perfil «Escaneo
 * (Charly)» es la ÚNICA pantalla del sistema (middleware).
 */
export default async function EscaneoPage() {
  const ctx = await requirePaginaPanel(Modulo.ESCANEO, "ver");
  const ventas = await listarPendientesDeEscaneo(ctx);
  return <PantallaEscaneo inicial={ventas} />;
}
