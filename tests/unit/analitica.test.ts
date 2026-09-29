import { describe, expect, it } from "vitest";

import {
  armarSerie,
  compararMonto,
  compararNumero,
  describirPeriodo,
  diaDe,
  fechaDeDia,
  periodoAnterior,
  periodoDesdeParams,
  type ModoPeriodo,
  type Periodo,
} from "@/server/services/analitica.service";

const P = (modo: ModoPeriodo, desde: string, hasta: string): Periodo => ({
  modo,
  desde: fechaDeDia(desde),
  hasta: fechaDeDia(hasta),
});
const dias = (p: Periodo) => ({ desde: diaDe(p.desde), hasta: diaDe(p.hasta) });

// Miércoles 16 de septiembre de 2026, 15:30 en Buenos Aires (18:30 UTC).
const AHORA = new Date("2026-09-16T18:30:00Z");

describe("periodoDesdeParams", () => {
  it("resuelve los 4 modos en la zona del negocio", () => {
    expect(dias(periodoDesdeParams({}, AHORA))).toEqual({
      desde: "2026-09-16",
      hasta: "2026-09-16",
    });
    expect(dias(periodoDesdeParams({ modo: "semanal" }, AHORA))).toEqual({
      desde: "2026-09-14",
      hasta: "2026-09-16",
    });
    expect(dias(periodoDesdeParams({ modo: "mensual" }, AHORA))).toEqual({
      desde: "2026-09-01",
      hasta: "2026-09-16",
    });
    expect(
      dias(
        periodoDesdeParams({ modo: "periodo", desde: "2026-09-15", hasta: "2026-09-01" }, AHORA),
      ),
    ).toEqual({ desde: "2026-09-01", hasta: "2026-09-15" });
    expect(dias(periodoDesdeParams({ modo: "periodo", preset: "trimestre" }, AHORA))).toEqual({
      desde: "2026-07-01",
      hasta: "2026-09-16",
    });
  });

  it("de noche en Argentina ya es otro día en UTC: manda el día local", () => {
    // 23:30 del 16 en BA = 02:30 del 17 en UTC.
    const p = periodoDesdeParams({}, new Date("2026-09-17T02:30:00Z"));
    expect(diaDe(p.desde)).toBe("2026-09-16");
  });
});

describe("periodoAnterior", () => {
  it("DIARIO → ayer", () => {
    expect(dias(periodoAnterior(P("DIARIO", "2026-09-01", "2026-09-01")))).toEqual({
      desde: "2026-08-31",
      hasta: "2026-08-31",
    });
  });

  it("SEMANAL (lunes → hoy) → la semana anterior completa, lunes a domingo", () => {
    expect(dias(periodoAnterior(P("SEMANAL", "2026-09-14", "2026-09-16")))).toEqual({
      desde: "2026-09-07",
      hasta: "2026-09-13",
    });
  });

  it("MENSUAL (1 → hoy) → el mes anterior completo", () => {
    expect(dias(periodoAnterior(P("MENSUAL", "2026-09-01", "2026-09-16")))).toEqual({
      desde: "2026-08-01",
      hasta: "2026-08-31",
    });
    expect(dias(periodoAnterior(P("MENSUAL", "2026-03-01", "2026-03-05")))).toEqual({
      desde: "2026-02-01",
      hasta: "2026-02-28",
    });
    expect(dias(periodoAnterior(P("MENSUAL", "2026-01-01", "2026-01-10")))).toEqual({
      desde: "2025-12-01",
      hasta: "2025-12-31",
    });
  });

  it("PERSONALIZADO → el rango inmediatamente anterior de igual duración (1–15 sep → 17–31 ago)", () => {
    expect(dias(periodoAnterior(P("PERSONALIZADO", "2026-09-01", "2026-09-15")))).toEqual({
      desde: "2026-08-17",
      hasta: "2026-08-31",
    });
    expect(describirPeriodo(P("PERSONALIZADO", "2026-09-01", "2026-09-15")).comparacion).toBe(
      "vs. 17 ago – 31 ago 2026",
    );
  });
});

describe("armarSerie", () => {
  const ahora = { hoy: "2026-09-16", hora: 15 };

  it("DIARIO: 24 horas; las horas futuras de hoy son null, las de ayer no", () => {
    const s = armarSerie(
      P("DIARIO", "2026-09-16", "2026-09-16"),
      [
        { actual: true, idx: 10, total: 5000 },
        { actual: false, idx: 10, total: 3000 },
        { actual: false, idx: 20, total: 7000 },
      ],
      ahora,
    );
    expect(s).toHaveLength(24);
    expect(s[10]).toMatchObject({ etiqueta: "10 h", actual: 5000, anterior: 3000 });
    expect(s[15]!.actual).toBe(0);
    expect(s[16]!.actual).toBeNull();
    expect(s[20]).toMatchObject({ actual: null, anterior: 7000 });
  });

  it("SEMANAL: Lun…Dom alineados; del jueves en adelante el actual es null", () => {
    const s = armarSerie(
      P("SEMANAL", "2026-09-14", "2026-09-16"),
      [
        { actual: true, idx: 0, total: 100 },
        { actual: false, idx: 0, total: 80 },
        { actual: false, idx: 6, total: 50 },
      ],
      ahora,
    );
    expect(s.map((x) => x.etiqueta)).toEqual(["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]);
    expect(s[0]).toMatchObject({
      actual: 100,
      anterior: 80,
      fechaActual: "14/09",
      fechaAnterior: "07/09",
    });
    expect(s[2]!.actual).toBe(0);
    expect(s.slice(3).every((x) => x.actual === null)).toBe(true);
    expect(s[6]!.anterior).toBe(50);
  });

  it("MENSUAL: 1…31 (el mes más largo); lo que un mes no tiene es null", () => {
    // Septiembre (30 días, hasta el 16) vs. agosto (31).
    const s = armarSerie(
      P("MENSUAL", "2026-09-01", "2026-09-16"),
      [{ actual: false, idx: 30, total: 900 }],
      ahora,
    );
    expect(s).toHaveLength(31);
    expect(s[15]!.actual).toBe(0);
    expect(s[16]!.actual).toBeNull();
    expect(s[30]).toMatchObject({ etiqueta: "31", actual: null, anterior: 900, fechaActual: null });

    // Marzo (31) vs. febrero (28): el 29–31 no existen en el anterior.
    const m = armarSerie(P("MENSUAL", "2026-03-01", "2026-03-31"), [], {
      hoy: "2026-04-02",
      hora: 9,
    });
    expect(m).toHaveLength(31);
    expect(m[27]!.anterior).toBe(0);
    expect(m[28]!.anterior).toBeNull();
    expect(m[30]!.actual).toBe(0);
  });

  it("PERSONALIZADO: Día 1…N contra el rango anterior", () => {
    const s = armarSerie(
      P("PERSONALIZADO", "2026-09-01", "2026-09-15"),
      [{ actual: false, idx: 0, total: 10 }],
      ahora,
    );
    expect(s).toHaveLength(15);
    expect(s[0]).toMatchObject({ etiqueta: "Día 1", anterior: 10, fechaAnterior: "17/08" });
    expect(s[14]!.fechaAnterior).toBe("31/08");
    expect(s.every((x) => x.actual === 0)).toBe(true);
  });
});

describe("comparaciones", () => {
  it("delta absoluto y porcentual", () => {
    expect(compararMonto("150000", "120000")).toEqual({
      actual: "150000.00",
      anterior: "120000.00",
      delta: "30000.00",
      deltaPct: 25,
    });
    expect(compararNumero(3, 0).deltaPct).toBeNull();
    expect(compararNumero(9, 12)).toMatchObject({ delta: -3, deltaPct: -25 });
  });
});
