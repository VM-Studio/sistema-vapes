import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Navegación instantánea (ver src/app/(app)/p/[slug]/loading.tsx): toda
 * sección de la app que tiene pantallas hijas necesita su propio loading.tsx.
 * Si no, ir de un listado a su detalle (p. ej. /fiados → /fiados/[cliente])
 * queda debajo de un boundary ya resuelto y Next 15.5 a veces nunca confirma
 * la transición: la URL no cambia y el clic "no hace nada".
 */
const APP = path.join(process.cwd(), "src/app/(app)");

function tienePaginaHija(dir: string): boolean {
  return readdirSync(dir, { withFileTypes: true }).some(
    (e) =>
      e.isDirectory() &&
      !e.name.startsWith("_") &&
      (existsSync(path.join(dir, e.name, "page.tsx")) || tienePaginaHija(path.join(dir, e.name))),
  );
}

function seccionesSinLoading(dir: string, dentroDeBoundary: boolean): string[] {
  const propio = existsSync(path.join(dir, "loading.tsx"));
  const faltan =
    dentroDeBoundary && !propio && tienePaginaHija(dir) && existsSync(path.join(dir, "page.tsx"))
      ? [path.relative(APP, dir)]
      : [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith("_")) continue;
    faltan.push(...seccionesSinLoading(path.join(dir, e.name), dentroDeBoundary || propio));
  }
  return faltan;
}

describe("loading.tsx por sección", () => {
  it("cada sección con pantallas hijas (dentro de un panel o de las globales) tiene su boundary", () => {
    expect(seccionesSinLoading(APP, false)).toEqual([]);
  });
});
