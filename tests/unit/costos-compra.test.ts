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
    expect(r.recargoPorUnidad).toBe(1_800);
    expect(r.costoUnitarioFinalPromedio).toBe(11_800);
    expect(r.items).toEqual([{ costoUnitarioFinal: 11_800 }]);
  });

  it("prorratea por unidad, no por valor: el producto caro y el barato llevan el mismo recargo", () => {
    const r = calcularCostosFinales({
      items: [
        { cantidad: 10, costoUnitario: 5_000 },
        { cantidad: 10, costoUnitario: 15_000 },
      ],
      comisionPorcentaje: null,
      gastos: [20_000],
    });
    expect(r.recargoPorUnidad).toBe(1_000);
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
    expect(r.items[0]!.costoUnitarioFinal).toBe(1.13);
  });

  it("sin unidades no divide por cero", () => {
    const r = calcularCostosFinales({ items: [], comisionPorcentaje: 10, gastos: [500] });
    expect(r.unidades).toBe(0);
    expect(r.recargoPorUnidad).toBe(0);
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
});
