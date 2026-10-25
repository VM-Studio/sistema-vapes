import { describe, expect, it } from "vitest";

import { marcarPagadasSchema } from "@/lib/validations/pasista";
import {
  calcularComision,
  fechaDeMes,
  mesActualAR,
  mesDeFecha,
  totalizarComisiones,
} from "@/server/services/pasista.service";

describe("pasista: meses argentinos", () => {
  it("el mes actual es el de Argentina (UTC−3), no el de UTC", () => {
    expect(mesActualAR(new Date("2026-11-01T02:30:00Z"))).toBe("2026-10");
    expect(mesActualAR(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11");
  });

  it("YYYY-MM ↔ DATE del primer día", () => {
    expect(fechaDeMes("2026-10").toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(mesDeFecha(fechaDeMes("2026-01"))).toBe("2026-01");
  });
});

describe("marcarPagadasSchema", () => {
  it("acepta un mes o una lista de ids, con medio y fecha", () => {
    const porMes = marcarPagadasSchema.parse({
      mes: "2026-09",
      medioPago: "EFECTIVO",
      fecha: "2026-09-30",
    });
    expect("mes" in porMes && porMes.mes).toBe("2026-09");
    const porIds = marcarPagadasSchema.parse({
      ids: ["ckabc1234567890"],
      medioPago: "TRANSFERENCIA",
      referencia: " 0001 ",
      fecha: "2026-09-30",
    });
    expect("ids" in porIds && porIds.ids).toHaveLength(1);
    expect(porIds.referencia).toBe("0001");
  });

  it("rechaza sin medio, fecha futura o mes inválido", () => {
    expect(marcarPagadasSchema.safeParse({ mes: "2026-09", fecha: "2026-09-30" }).success).toBe(
      false,
    );
    expect(
      marcarPagadasSchema.safeParse({ mes: "2026-09", medioPago: "EFECTIVO", fecha: "2999-01-01" })
        .success,
    ).toBe(false);
    expect(
      marcarPagadasSchema.safeParse({ mes: "2026-13", medioPago: "EFECTIVO", fecha: "2026-09-30" })
        .success,
    ).toBe(false);
  });
});

describe("cálculo de la comisión del pasista", () => {
  it("ROUND(total × % / 100, 2), como el CHECK de la DB", () => {
    expect(calcularComision("1000000", "10")).toBe("100000.00");
    expect(calcularComision("3000", "7.5")).toBe("225.00");
    // Medio centavo redondea para arriba.
    expect(calcularComision("100.05", "10")).toBe("10.01");
    expect(calcularComision("0", "10")).toBe("0.00");
  });

  it("totales: original + ajustes, pagado/pendiente y el total de compras sin duplicar", () => {
    const t = totalizarComisiones([
      { compraId: "a", tipo: "ORIGINAL", monto: "120000.00", base: "1200000.00", estado: "PAGADA" },
      {
        compraId: "a",
        tipo: "AJUSTE",
        monto: "-20000.00",
        base: "1000000.00",
        estado: "PENDIENTE",
      },
      { compraId: "b", tipo: "ORIGINAL", monto: "225.00", base: "3000.00", estado: "PENDIENTE" },
    ]);
    expect(t).toEqual({
      total: "100225.00",
      pagado: "120000.00",
      pendiente: "-19775.00",
      totalCompras: "1203000.00",
      compras: 2,
    });
  });

  it("sin filas, todo en cero", () => {
    expect(totalizarComisiones([])).toEqual({
      total: "0.00",
      pagado: "0.00",
      pendiente: "0.00",
      totalCompras: "0.00",
      compras: 0,
    });
  });
});
