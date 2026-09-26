/**
 * Genera íconos y splash screens en /public desde public/brand/icono.svg.
 * Uso: pnpm iconos (reemplazar el SVG por el del cliente y volver a correrlo;
 * o subir el ícono desde /configuracion/negocio sin tocar el repo).
 */
import { readFile, writeFile } from "node:fs/promises";

import { generarIcono, generarSplash, type VarianteIcono } from "../src/lib/iconos-app";

const SPLASH = [
  [640, 1136],
  [750, 1334],
  [1125, 2436],
  [1170, 2532],
  [1284, 2778],
] as const;

async function main() {
  const svg = await readFile("public/brand/icono.svg");
  for (const v of ["192", "512", "maskable", "apple", "favicon"] as VarianteIcono[]) {
    await writeFile(`public/icons/icon-${v}.png`, await generarIcono(svg, v));
  }
  for (const [w, h] of SPLASH)
    await writeFile(`public/splash/splash-${w}x${h}.png`, await generarSplash(svg, w, h));
  console.log("Íconos y splash generados en public/icons y public/splash");
}

void main();
