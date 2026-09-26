// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  clavesAConservar,
  fechaDeBackup,
  nombreBackup,
  urlParaPgTools,
} from "@/server/services/backup.service";
import { diffAuditoria } from "@/server/services/auditoria.service";
import { limitesRango, rangoComparable, rangoDePeriodo } from "@/lib/zona-horaria";

const clave = (d: string) => `backups/backup-${d}-0400.dump`;
function dias(desde: string, n: number) {
  const out: string[] = [];
  const f = new Date(`${desde}T12:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push(f.toISOString().slice(0, 10));
    f.setUTCDate(f.getUTCDate() - 1);
  }
  return out;
}

describe("rotación de backups", () => {
  const hoy = "2026-09-25";
  const todos = dias(hoy, 500).map(clave); // un backup por día durante 500 días
  const quedan = clavesAConservar(todos, hoy);
  it("conserva los 30 diarios", () => {
    for (const d of dias(hoy, 30)) expect(quedan.has(clave(d))).toBe(true);
  });
  it("de ahí a 12 semanas, uno por semana; de ahí a 12 meses, uno por mes", () => {
    const viejos = [...quedan].map((c) => fechaDeBackup(c)!).filter((d) => d < "2026-08-26");
    const semanales = viejos.filter((d) => d >= "2026-07-03");
    const mensuales = viejos.filter((d) => d < "2026-07-03");
    expect(semanales.length).toBeGreaterThanOrEqual(5);
    expect(semanales.length).toBeLessThanOrEqual(9);
    expect(new Set(mensuales.map((d) => d.slice(0, 7))).size).toBe(mensuales.length); // uno por mes
    expect(mensuales.every((d) => d >= "2025-09-25")).toBe(true); // nada de más de un año
  });
  it("borra el resto (en total quedan ~50 de 500)", () => {
    expect(quedan.size).toBeGreaterThan(40);
    expect(quedan.size).toBeLessThan(60);
  });
  it("nombre en hora argentina: backup-YYYY-MM-DD-HHmm.dump", () => {
    expect(nombreBackup(new Date("2026-09-26T07:00:00Z"))).toBe(
      "backups/backup-2026-09-26-0400.dump",
    );
  });
  it("las herramientas de Postgres no reciben parámetros de Prisma", () => {
    expect(
      urlParaPgTools("postgresql://u:p@h:5432/db?schema=public&connection_limit=5&sslmode=require"),
    ).toBe("postgresql://u:p@h:5432/db?sslmode=require");
  });
});

describe("zona horaria y períodos", () => {
  it("un día en Buenos Aires va de 03:00 UTC a 03:00 UTC del día siguiente", () => {
    const r = limitesRango("2026-09-25", "2026-09-25", "America/Argentina/Buenos_Aires");
    expect(r.inicio.toISOString()).toBe("2026-09-25T03:00:00.000Z");
    expect(r.fin.toISOString()).toBe("2026-09-26T03:00:00.000Z");
  });
  it("«este mes» se compara con el mismo tramo del mes anterior; un mes completo, con el anterior completo", () => {
    expect(rangoComparable(rangoDePeriodo("mes", "2026-09-25"))).toEqual({
      desde: "2026-08-01",
      hasta: "2026-08-25",
    });
    expect(rangoComparable(rangoDePeriodo("mes-anterior", "2026-09-25"))).toEqual({
      desde: "2026-07-01",
      hasta: "2026-07-31",
    });
  });
});

describe("auditoría", () => {
  it("diff campo por campo", () => {
    expect(diffAuditoria({ a: 1, b: "x", c: true }, { a: 2, b: "x", d: 5 })).toEqual([
      { campo: "a", antes: 1, despues: 2 },
      { campo: "c", antes: true, despues: undefined },
      { campo: "d", antes: undefined, despues: 5 },
    ]);
  });
});
