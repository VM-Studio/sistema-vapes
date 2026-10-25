import { describe, expect, it } from "vitest";

import {
  calcularGanancia,
  categoriaDe,
  limitesMes,
  mesDe,
  nombreMes,
  sumarMeses,
  type DevolucionParaGanancia,
  type VentaParaGanancia,
} from "@/lib/ganancia-vendedor";

const TARIFAS = {
  minorista: "1500",
  mayorista: "300",
  minoristaNuevo: "2000",
  mayoristaNuevo: "500",
};

let n = 0;
function venta(
  tipo: "UNITARIA" | "MAYORISTA",
  clienteNuevo: boolean,
  unidades: number,
  total: number,
): VentaParaGanancia {
  n++;
  return {
    id: `v${n}`,
    codigo: `VAP-${String(n).padStart(6, "0")}`,
    fecha: new Date(`2026-10-${String(n).padStart(2, "0")}T15:00:00Z`),
    tipo,
    clienteNuevo,
    cliente: `Cliente ${n}`,
    unidades,
    total: String(total),
  };
}

describe("categorías", () => {
  it("tipo de venta × cliente nuevo", () => {
    expect(categoriaDe("UNITARIA", false)).toBe("MINORISTA");
    expect(categoriaDe("MAYORISTA", false)).toBe("MAYORISTA");
    expect(categoriaDe("UNITARIA", true)).toBe("MINORISTA_NUEVO");
    expect(categoriaDe("MAYORISTA", true)).toBe("MAYORISTA_NUEVO");
  });
});

describe("calcularGanancia", () => {
  it("las 4 categorías: unidades × tarifa, ventas y total vendido de cada una", () => {
    const c = calcularGanancia(
      TARIFAS,
      [
        venta("UNITARIA", false, 2, 20000),
        venta("UNITARIA", false, 1, 10000),
        venta("MAYORISTA", false, 50, 400000),
        venta("UNITARIA", true, 3, 30000),
        venta("MAYORISTA", true, 20, 160000),
      ],
      [],
    );
    const por = Object.fromEntries(c.categorias.map((x) => [x.categoria, x]));
    expect(por.MINORISTA).toMatchObject({
      ventas: 2,
      unidades: 3,
      monto: "4500.00",
      totalVendido: "30000.00",
    });
    expect(por.MAYORISTA).toMatchObject({
      ventas: 1,
      unidades: 50,
      monto: "15000.00",
      tarifa: "300.00",
    });
    expect(por.MINORISTA_NUEVO).toMatchObject({ ventas: 1, unidades: 3, monto: "6000.00" });
    expect(por.MAYORISTA_NUEVO).toMatchObject({ ventas: 1, unidades: 20, monto: "10000.00" });
    expect(c.total).toBe("35500.00");
    expect(c.cantidadVentas).toBe(5);
    expect(c.unidades).toBe(76);
    expect(c.totalVendido).toBe("620000.00");
    expect(c.filas.map((f) => f.ganancia)).toEqual([
      "10000.00",
      "6000.00",
      "15000.00",
      "1500.00",
      "3000.00",
    ]);
  });

  it("una devolución descuenta sus unidades a la tarifa de la venta original", () => {
    const v = venta("UNITARIA", true, 3, 30000);
    const d: DevolucionParaGanancia = {
      id: "d1",
      codigo: "VAP-D-000001",
      fecha: new Date("2026-10-28T12:00:00Z"),
      ventaId: v.id,
      ventaCodigo: v.codigo,
      tipo: "UNITARIA",
      clienteNuevo: true,
      cliente: v.cliente,
      unidades: 1,
    };
    const c = calcularGanancia(TARIFAS, [v], [d]);
    const nuevo = c.categorias.find((x) => x.categoria === "MINORISTA_NUEVO")!;
    expect(nuevo).toMatchObject({ unidades: 3, unidadesDevueltas: 1, monto: "4000.00" });
    expect(c.total).toBe("4000.00");
    expect(c.unidades).toBe(2);
    expect(c.filas[0]).toMatchObject({ tipo: "DEVOLUCION", unidades: -1, ganancia: "-2000.00" });
  });

  it("el total del mes nunca es negativo (solo devoluciones de meses anteriores)", () => {
    const c = calcularGanancia(
      TARIFAS,
      [],
      [
        {
          id: "d",
          codigo: "VAP-D-1",
          fecha: new Date(),
          ventaId: "x",
          ventaCodigo: "VAP-1",
          tipo: "MAYORISTA",
          clienteNuevo: false,
          cliente: "c",
          unidades: 4,
        },
      ],
    );
    expect(c.categorias.find((x) => x.categoria === "MAYORISTA")!.monto).toBe("-1200.00");
    expect(c.total).toBe("0.00");
  });
});

describe("meses en hora argentina", () => {
  it("el mes empieza a las 03:00 UTC del día 1", () => {
    const { inicio, fin } = limitesMes("2026-10");
    expect(inicio.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(fin.toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });

  it("las 23:30 del 31/10 en Argentina (02:30 UTC del 1/11) son de octubre", () => {
    expect(mesDe(new Date("2026-11-01T02:30:00Z"))).toBe("2026-10");
    expect(mesDe(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11");
  });

  it("sumar meses cruza el año", () => {
    expect(sumarMeses("2026-12", 1)).toBe("2027-01");
    expect(sumarMeses("2027-01", -1)).toBe("2026-12");
    expect(sumarMeses("2026-10", -12)).toBe("2025-10");
    expect(nombreMes("2026-02")).toBe("febrero 2026");
  });
});
