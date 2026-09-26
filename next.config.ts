import { withSentryConfig } from "@sentry/nextjs/config";
import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";

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
    "/**": ["./src/server/auth/passwords-comunes.txt", "./docs/MANUAL-USUARIO.md"],
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

const conSerwist = withSerwist(nextConfig);

/**
 * Sentry es opcional: sin SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN la app anda igual
 * (el SDK queda deshabilitado). Los source maps se suben solo si hay
 * SENTRY_AUTH_TOKEN en el build.
 */
export default withSentryConfig(conSerwist, {
  silent: true,
  telemetry: false,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  release: {
    name: process.env.APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA,
    create: Boolean(process.env.SENTRY_AUTH_TOKEN),
  },
});
