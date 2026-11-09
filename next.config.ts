import { spawnSync } from "node:child_process";

import { withSentryConfig } from "@sentry/nextjs/config";
import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";

/**
 * Versión del build (SHA corto). Se inyecta en el cliente como
 * NEXT_PUBLIC_APP_VERSION y la expone /api/version: si el navegador tiene
 * abierta una versión distinta a la desplegada, la app se actualiza sola.
 */
const VERSION_BUILD = (
  process.env.APP_VERSION ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  (spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() || "dev")
).slice(0, 12);

/**
 * Headers de seguridad para TODO (incluidos los assets). La CSP va aparte,
 * en el middleware, porque lleva un nonce distinto en cada request.
 */
const HEADERS_SEGURIDAD = [
  // 2 años + subdominios + preload (solo tiene efecto sobre HTTPS).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // La cámara la usa el escáner (solo este sitio); micrófono y ubicación, nunca.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

function hostApp(): string[] {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) return [];
  try {
    return [new URL(url).host];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: { NEXT_PUBLIC_APP_VERSION: VERSION_BUILD },
  // Metadata SIEMPRE en el <head> (sin streaming): Chrome ignora un
  // <link rel="manifest"> en el <body> y la app deja de ser instalable; iOS
  // tampoco lee ahí los apple-touch-icon / splash.
  htmlLimitedBots: /.*/,
  experimental: {
    serverActions: {
      // Además de la verificación de Next (Origin = Host), el dominio de producción.
      allowedOrigins: hostApp(),
      // Fotos de tickets de hasta 5 MB (+ margen del multipart).
      bodySizeLimit: "6mb",
    },
  },
  serverExternalPackages: ["pino", "pino-pretty", "sharp", "exceljs", "@aws-sdk/client-s3"],
  // Archivos que se leen con fs en runtime: que entren al bundle del deploy.
  outputFileTracingIncludes: {
    // sharp es externo y su binario depende de la plataforma: en el deploy (Linux)
    // el trazado no siempre lo encuentra solo, así que se incluye explícito.
    // Los logos de marca: los PDFs los leen de public/ (que en el deploy sirve el CDN).
    "/**": [
      "./src/server/auth/passwords-comunes.txt",
      "./docs/MANUAL-USUARIO.md",
      "./public/logo*.png",
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: HEADERS_SEGURIDAD },
      // El service worker nunca se cachea en el CDN: si no, las actualizaciones tardan en llegar.
      {
        source: "/serwist/:path*",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

/**
 * Sentry (proyecto vm-studio-ai/sistema-vapes). El navegador manda los eventos
 * a /monitoring (mismo dominio → cumple la CSP y esquiva los ad-blockers) y el
 * servidor los reenvía a Sentry. Los source maps se suben solo si hay
 * SENTRY_AUTH_TOKEN en el build (Vercel); sin él, el build sigue igual.
 */
export default withSentryConfig(withSerwist(nextConfig), {
  org: "vm-studio-ai",
  project: "sistema-vapes",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  tunnelRoute: "/monitoring",
  release: { name: VERSION_BUILD },
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  silent: !process.env.CI,
  telemetry: false,
});
