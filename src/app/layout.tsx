import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";

import { PwaProvider } from "@/components/pwa/pwa-provider";
import { ToastProvider } from "@/components/ui/toast";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** Pantallas de inicio de iOS (las genera `pnpm iconos`): iPhone SE, 8, X/11 Pro, 12–15, Pro Max. */
const SPLASH = [
  { w: 640, h: 1136, r: 2 },
  { w: 750, h: 1334, r: 2 },
  { w: 1125, h: 2436, r: 3 },
  { w: 1170, h: 2532, r: 3 },
  { w: 1284, h: 2778, r: 3 },
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
  icons: {
    icon: [
      { url: "/icons/192", sizes: "192x192", type: "image/png" },
      { url: "/icons/512", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple", sizes: "180x180", type: "image/png" }],
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#15151c" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Leer los headers hace dinámicas todas las páginas: cada respuesta lleva
  // su propio nonce de CSP (lo pone el middleware y Next lo aplica a sus scripts).
  await headers();
  return (
    <html lang="es">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <PwaProvider>
          <ToastProvider>{children}</ToastProvider>
        </PwaProvider>
      </body>
    </html>
  );
}
