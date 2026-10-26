import { describe, expect, it } from "vitest";

import { calcularCostosFinales } from "@/lib/costos-compra";

describe("calcularCostosFinales", () => {
  it("100 u. × $10.000 con 10% de pasista y $80.000 de gastos → $1.180.000 y $11.800 por unidad", () => {
    const sinGastos = calcularCostosFinales({
      items: [{ cantidad: 100, costoUnitario: "10000" }],
      comisionPorcentaje: 10,
      gastos: [],
    });
    expect(sinGastos.subtotal).toBe(1_000_000);
    expect(sinGastos.comision).toBe(100_000);
    expect(sinGastos.costoFinalTotal).toBe(1_100_000);
    expect(sinGastos.costoUnitarioFinalPromedio).toBe(11_000);

    const r = calcularCostosFinales({
      items: [{ cantidad: 100, costoUnitario: "10000" }],
      comisionPorcentaje: 10,
      gastos: ["50000", "30000"],
    });
    expect(r.comision).toBe(100_000);
    expect(r.gastos).toBe(80_000);
    expect(r.costoFinalTotal).toBe(1_180_000);
    expect(r.unidades).toBe(100);
    expect(r.gastosPorUnidad).toBe(800);
    expect(r.costoUnitarioFinalPromedio).toBe(11_800);
    expect(r.items).toEqual([
      {
        cantidad: 100,
        costoUnitario: 10_000,
        subtotal: 1_000_000,
        comisionPorUnidad: 1_000,
        gastosPorUnidad: 800,
        ajustePorUnidad: 0,
        costoUnitarioFinal: 11_800,
        subtotalFinal: 1_180_000,
      },
    ]);
  });

  it("los gastos extras se prorratean parejo por unidad (sin comisión)", () => {
    const r = calcularCostosFinales({
      items: [
        { cantidad: 10, costoUnitario: 5_000 },
        { cantidad: 10, costoUnitario: 15_000 },
      ],
      comisionPorcentaje: null,
      gastos: [20_000],
    });
    expect(r.gastosPorUnidad).toBe(1_000);
    expect(r.items.map((i) => i.costoUnitarioFinal)).toEqual([6_000, 16_000]);
    expect(r.costoFinalTotal).toBe(220_000);
  });

  it("la comisión se calcula sobre subtotal − descuento", () => {
    const r = calcularCostosFinales({
      items: [{ cantidad: 4, costoUnitario: 2_500 }],
      descuento: 1_000,
      comisionPorcentaje: "10",
      gastos: [],
    });
    expect(r.total).toBe(9_000);
    expect(r.comision).toBe(900);
    expect(r.costoFinalTotal).toBe(9_900);
  });

  it("sin comisión ni gastos el costo final es el costo base", () => {
    const r = calcularCostosFinales({
      items: [{ cantidad: 3, costoUnitario: "1234.56" }],
      comisionPorcentaje: null,
      gastos: [],
    });
    expect(r.comision).toBe(0);
    expect(r.comisionPorcentaje).toBeNull();
    expect(r.costoFinalTotal).toBe(3_703.68);
    expect(r.items[0]!.costoUnitarioFinal).toBe(1_234.56);
  });

  it("redondea a centavos mitad hacia arriba (como ROUND de Postgres)", () => {
    // 3 u. × $1 con 12,5% → comisión 0,375 → 0,38; recargo 0,1266… por unidad.
    const r = calcularCostosFinales({
      items: [{ cantidad: 3, costoUnitario: 1 }],
      comisionPorcentaje: "12,5",
      gastos: [],
    });
    expect(r.comision).toBe(0.38);
    expect(r.costoFinalTotal).toBe(3.38);
    expect(r.costoUnitarioFinalPromedio).toBe(1.13);
    // 0,125 → 0,13 por unidad; 3 × 0,13 = 0,39 > 0,38: el centavo de más se descuenta
    // en el único ítem (−1 centavo no se puede repartir en 3 unidades) → queda informado.
    expect(r.items[0]!.comisionPorUnidad).toBe(0.13);
    expect(r.items[0]!.costoUnitarioFinal).toBe(1.13);
    expect(r.diferenciaRedondeo).toBe(-0.01);
  });

  it("sin unidades no divide por cero", () => {
    const r = calcularCostosFinales({ items: [], comisionPorcentaje: 10, gastos: [500] });
    expect(r.unidades).toBe(0);
    expect(r.gastosPorUnidad).toBe(0);
    expect(r.costoUnitarioFinalPromedio).toBe(0);
    expect(r.costoFinalTotal).toBe(500);
  });

  it("un porcentaje 0 o vacío es sin comisión", () => {
    expect(
      calcularCostosFinales({
        items: [{ cantidad: 1, costoUnitario: 100 }],
        comisionPorcentaje: 0,
        gastos: [],
      }).comisionPorcentaje,
    ).toBeNull();
    expect(
      calcularCostosFinales({
        items: [{ cantidad: 1, costoUnitario: 100 }],
        comisionPorcentaje: "",
        gastos: [],
      }).comision,
    ).toBe(0);
  });

  it("pasista proporcional al precio y gastos parejos: el ejemplo del cliente", () => {
    // A: 10 u. × $10.000 · B: 10 u. × $20.000 · 10% pasista · gastos $30.000.
    const r = calcularCostosFinales({
      items: [
        { cantidad: 10, costoUnitario: "10000" },
        { cantidad: 10, costoUnitario: "20000" },
      ],
      comisionPorcentaje: 10,
      gastos: ["30000"],
    });
    expect(r.subtotal).toBe(300_000);
    expect(r.comision).toBe(30_000);
    expect(r.gastosPorUnidad).toBe(1_500);
    expect(r.items.map((i) => i.comisionPorUnidad)).toEqual([1_000, 2_000]);
    expect(r.items.map((i) => i.gastosPorUnidad)).toEqual([1_500, 1_500]);
    expect(r.items.map((i) => i.costoUnitarioFinal)).toEqual([12_500, 23_500]);
    expect(r.items.map((i) => i.subtotalFinal)).toEqual([125_000, 235_000]);
    expect(r.costoFinalTotal).toBe(360_000);
    expect(r.sumaSubtotalesFinales).toBe(360_000);
    expect(r.diferenciaRedondeo).toBe(0);
  });

  it("Σ comisión por unidad × cantidad = comisión de la compra (sin descuento)", () => {
    const r = calcularCostosFinales({
      items: [
        { cantidad: 7, costoUnitario: "13333.33" },
        { cantidad: 3, costoUnitario: "9999.99" },
        { cantidad: 1, costoUnitario: "12345.67" },
      ],
      comisionPorcentaje: "7,5",
      gastos: ["10000"],
    });
    const extra = r.items.reduce(
      (a, i) => a + i.cantidad * (i.comisionPorUnidad + i.gastosPorUnidad + i.ajustePorUnidad),
      0,
    );
    expect(Math.round(extra * 100)).toBe(Math.round((r.comision + r.gastos) * 100));
    expect(r.diferenciaRedondeo).toBe(0);
    expect(r.sumaSubtotalesFinales).toBe(r.costoFinalTotal);
    // El residuo cayó en un solo ítem (el de cantidad 1, el único que lo divide exacto).
    expect(r.items.filter((i) => i.ajustePorUnidad !== 0).length).toBeLessThanOrEqual(1);
  });

  it("el residuo va al ítem de mayor subtotal cuya cantidad lo divide", () => {
    // 3 ítems de 1 u. a $1 con 50% → 0,50 c/u exacto; con gastos $0,10 → 0,03 c/u (0,09) y residuo 0,01.
    const r = calcularCostosFinales({
      items: [
        { cantidad: 1, costoUnitario: 1 },
        { cantidad: 1, costoUnitario: 3 },
        { cantidad: 1, costoUnitario: 2 },
      ],
      comisionPorcentaje: null,
      gastos: ["0.10"],
    });
    expect(r.items.map((i) => i.ajustePorUnidad)).toEqual([0, 0.01, 0]);
    expect(r.sumaSubtotalesFinales).toBe(r.costoFinalTotal);
  });

  it("con descuento la comisión por unidad se calcula sobre el precio con descuento", () => {
    const r = calcularCostosFinales({
      items: [
        { cantidad: 10, costoUnitario: 10_000 },
        { cantidad: 10, costoUnitario: 20_000 },
      ],
      descuento: 30_000,
      comisionPorcentaje: 10,
      gastos: [],
    });
    expect(r.factorDescuento).toBeCloseTo(0.9);
    expect(r.comision).toBe(27_000);
    expect(r.items.map((i) => i.comisionPorUnidad)).toEqual([900, 1_800]);
    // El costo unitario base no se descuenta (CHECK costo final ≥ costo): la suma excede en el descuento.
    expect(r.sumaSubtotalesFinales).toBe(r.costoFinalTotal + 30_000);
  });

  it("nunca deja un costo final por debajo del costo base", () => {
    const r = calcularCostosFinales({
      items: [
        { cantidad: 2, costoUnitario: "0.01" },
        { cantidad: 2, costoUnitario: "0.01" },
      ],
      comisionPorcentaje: "50",
      gastos: [],
    });
    for (const i of r.items) expect(i.costoUnitarioFinal).toBeGreaterThanOrEqual(i.costoUnitario);
  });
});
