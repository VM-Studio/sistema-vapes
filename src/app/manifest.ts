import type { MetadataRoute } from "next";

import { nombreNegocio } from "@/server/services/identidad.service";

export const dynamic = "force-dynamic";

/**
 * Manifest de la PWA. El nombre sale de Configuracion (el del negocio), con
 * "Gestión" si todavía no se configuró o la DB no responde. Los colores son
 * los tokens de la app (primario índigo, fondo claro).
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const nombre = await nombreNegocio();
  const corto = nombre.length > 12 ? nombre.split(/\s+/)[0]!.slice(0, 12) : nombre;
  return {
    id: "/",
    name: nombre === "Gestión" ? "Gestión — Inventario y ventas" : nombre,
    short_name: corto,
    description: "Inventario, ventas y stock por depósito, con escáner que funciona sin señal.",
    lang: "es-AR",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f5f7",
    theme_color: "#4338ca",
    categories: ["business"],
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Nueva venta",
        short_name: "Vender",
        url: "/ventas/nueva",
        icons: [{ src: "/icons/192", sizes: "192x192" }],
      },
      {
        name: "Escanear",
        short_name: "Escanear",
        url: "/escanear",
        icons: [{ src: "/icons/192", sizes: "192x192" }],
      },
      {
        name: "Inventario",
        short_name: "Stock",
        url: "/inventario",
        icons: [{ src: "/icons/192", sizes: "192x192" }],
      },
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
