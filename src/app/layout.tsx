import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";

import { PwaProvider } from "@/components/pwa/pwa-provider";
import { ToastProvider } from "@/components/ui/toast";

import "./globals.css";

// Inter self-hosteada por next/font; la variable alimenta --font-sans (globals.css).
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

/**
 * Pantallas de inicio de iOS (las genera `pnpm iconos`, ver SPLASH en
 * scripts/generar-iconos.ts). w×h en píxeles físicos; r = device pixel ratio.
 */
const SPLASH = [
  // iPhone
  { w: 640, h: 1136, r: 2 }, // SE (1.ª gen)
  { w: 750, h: 1334, r: 2 }, // SE 2/3, 8
  { w: 828, h: 1792, r: 2 }, // XR, 11
  { w: 1125, h: 2436, r: 3 }, // X, XS, 11 Pro, mini
  { w: 1170, h: 2532, r: 3 }, // 12–14
  { w: 1179, h: 2556, r: 3 }, // 14 Pro, 15, 16
  { w: 1242, h: 2688, r: 3 }, // XS Max, 11 Pro Max
  { w: 1284, h: 2778, r: 3 }, // 12/13 Pro Max, 14 Plus
  { w: 1290, h: 2796, r: 3 }, // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  // iPad
  { w: 1536, h: 2048, r: 2 }, // 9.7", mini
  { w: 1668, h: 2224, r: 2 }, // Pro 10.5", Air 3
  { w: 1668, h: 2388, r: 2 }, // Pro 11"
  { w: 2048, h: 2732, r: 2 }, // Pro 12.9"
];

export const metadata: Metadata = {
  title: { default: "Gestión", template: "%s · Gestión" },
  description: "Inventario, ventas y stock por depósito",
  applicationName: "Gestión",
  appleWebApp: {
    capable: true,
    title: "Gestión",
    // El contenido va detrás de la barra de estado (los paddings safe-area lo acomodan).
    statusBarStyle: "black-translucent",
    startupImage: SPLASH.map((s) => ({
      url: `/splash/splash-${s.w}x${s.h}.png`,
      media: `(device-width: ${s.w / s.r}px) and (device-height: ${s.h / s.r}px) and (-webkit-device-pixel-ratio: ${s.r}) and (orientation: portrait)`,
    })),
  },
  formatDetection: { telephone: false },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // cover: la app ocupa toda la pantalla (notch incluido); los paddings
  // env(safe-area-inset-*) evitan que el contenido quede debajo.
  viewportFit: "cover",
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Leer los headers hace dinámicas todas las páginas: cada respuesta lleva
  // su propio nonce de CSP (lo pone el middleware y Next lo aplica a sus scripts).
  await headers();
  return (
    <html lang="es" className={inter.variable}>
      <body className="bg-background text-foreground font-sans antialiased">
        <PwaProvider>
          <ToastProvider>{children}</ToastProvider>
        </PwaProvider>
      </body>
    </html>
  );
}
