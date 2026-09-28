import type { MetadataRoute } from "next";

import { nombreNegocio } from "@/server/services/identidad.service";

export const dynamic = "force-dynamic";

/**
 * Manifest de la PWA. El nombre sale de ConfiguracionGlobal (el del negocio),
 * con "Gestión" si todavía no se configuró o la DB no responde. La app
 * instalada arranca en el último panel usado (/paneles?origen=pwa lo resuelve
 * con localStorage). Sin accesos directos: cada módulo depende del panel.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const nombre = await nombreNegocio();
  const corto = nombre.length > 12 ? nombre.split(/\s+/)[0]!.slice(0, 12) : nombre;
  return {
    id: "/",
    name: nombre === "Gestión" ? "Gestión — Inventario y ventas" : nombre,
    short_name: corto,
    description:
      "Stock, ventas y compras de cada uno de tus sistemas, con escáner que reconoce códigos sin señal.",
    lang: "es-AR",
    dir: "ltr",
    start_url: "/paneles?origen=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["business"],
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    screenshots: [
      {
        src: "/screenshots/movil-inicio.png",
        sizes: "750x1624",
        type: "image/png",
        form_factor: "narrow",
        label: "Resumen del negocio",
      },
      {
        src: "/screenshots/movil-escanear.png",
        sizes: "750x1624",
        type: "image/png",
        form_factor: "narrow",
        label: "Escáner",
      },
      {
        src: "/screenshots/escritorio-inicio.png",
        sizes: "1440x900",
        type: "image/png",
        form_factor: "wide",
        label: "Dashboard",
      },
    ],
  };
}
