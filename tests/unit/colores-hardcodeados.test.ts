import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guardas del sistema de diseño (docs/DISENO.md): los colores salen de los
 * tokens de src/app/globals.css. Reemplaza al `grep` manual de colores
 * hardcodeados.
 */
const SRC = path.join(process.cwd(), "src");

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return archivos(p);
    return /\.(tsx?|mts)$/.test(e.name) ? [p] : [];
  });
}

const FUENTES = archivos(SRC).map((p) => ({
  ruta: path.relative(process.cwd(), p),
  texto: readFileSync(p, "utf8"),
}));

/** Donde un hex es legítimo: tema de gráficos, PDFs (react-pdf no lee CSS), PWA y el catálogo /diseno. */
const HEX_PERMITIDO = [
  /src\/components\/ui\/chart-theme\.tsx$/,
  /pdf/i,
  /src\/app\/manifest\.ts$/,
  /src\/app\/layout\.tsx$/,
  /src\/lib\/iconos-app\.ts$/,
  /src\/app\/.*opengraph/,
  /src\/app\/\(app\)\/\(global\)\/diseno\//,
];

/** El naranja del módulo activo solo vive en la navegación (nunca en botones ni gráficos). */
const NARANJA_PERMITIDO = [
  /src\/components\/layout\/sidebar\.tsx$/,
  /src\/components\/layout\/mobile-nav\.tsx$/,
  /src\/components\/layout\/global-shell\.tsx$/,
  /src\/components\/ui\/tabs\.tsx$/,
  /src\/components\/ui\/tabs-nav\.tsx$/,
  /src\/components\/ui\/chip\.tsx$/,
  /src\/app\/\(app\)\/p\/\[slug\]\/stock\/_componentes\/tabs-galpones\.tsx$/,
  /src\/app\/\(app\)\/\(global\)\/diseno\//,
];

const PALETA_TAILWIND =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|divide|decoration|accent|caret|shadow)-(?:red|blue|gray|slate|zinc|neutral|stone|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

function infractores(re: RegExp, permitido: RegExp[] = []) {
  return FUENTES.filter((f) => !permitido.some((p) => p.test(f.ruta)) && re.test(f.texto)).map(
    (f) => f.ruta,
  );
}

describe("colores hardcodeados", () => {
  it("no hay clases de la paleta de Tailwind (bg-blue-500, text-gray-600…)", () => {
    expect(infractores(PALETA_TAILWIND)).toEqual([]);
  });

  it("no hay valores arbitrarios de color en clases (bg-[#…], text-[rgb(…)])", () => {
    expect(infractores(/-\[(?:#[0-9a-fA-F]{3,8}|rgba?\()/)).toEqual([]);
  });

  it("los hex sueltos solo aparecen donde no hay tokens CSS", () => {
    expect(infractores(/["'`]#[0-9a-fA-F]{6}\b/, HEX_PERMITIDO)).toEqual([]);
  });

  it("el naranja del módulo activo solo se usa en la navegación", () => {
    expect(infractores(/brand-orange/, NARANJA_PERMITIDO)).toEqual([]);
  });

  it("botones y gráficos no usan el naranja del módulo activo", () => {
    const prohibidos = FUENTES.filter(
      (f) => /components\/(ui\/button|analitica\/)/.test(f.ruta) && /brand-orange/.test(f.texto),
    );
    expect(prohibidos.map((f) => f.ruta)).toEqual([]);
  });
});
