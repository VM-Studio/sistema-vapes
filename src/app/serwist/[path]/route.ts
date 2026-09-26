import { spawnSync } from "node:child_process";

import { createSerwistRoute } from "@serwist/turbopack";

/**
 * /serwist/sw.js — el service worker (src/app/sw.ts) compilado con esbuild y
 * con el precache del build inyectado. Revisión de /offline = commit (o un
 * UUID si no hay git): cada deploy renueva la página sin conexión.
 */
const revision =
  process.env.APP_VERSION ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() ??
  crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute(
  {
    swSrc: "src/app/sw.ts",
    useNativeEsbuild: false,
    additionalPrecacheEntries: [{ url: "/offline", revision: revision || crypto.randomUUID() }],
    // Solo el shell (JS/CSS/fuentes del build + íconos): nada de datos.
    globDirectory: ".",
    globPatterns: [".next/static/**/*.{js,css,woff2}", "public/icons/*.png", "public/brand/*.svg"],
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
  },
);
