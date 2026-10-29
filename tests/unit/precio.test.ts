import { describe, expect, it } from "vitest";

import {
  pesosDesdeUSD,
  precioConDescuento,
  resolverPrecios,
  totalEnUSD,
  type DatosResolverPrecios,
  type ItemAResolver,
} from "@/server/services/precio.service";

const ELF = "prod_elf";
const IGN = "prod_ignite";

const item = (
  varianteId: string,
  cantidad: number,
  extra: Partial<ItemAResolver> = {},
): ItemAResolver => ({
  varianteId,
  productoId: ELF,
  titulo: `Elf Bar BC 5000 — ${varianteId}`,
  nombreCompleto: "Elf Bar BC 5000",
  cantidad,
  precioLista: "10000.00",
  ...extra,
});

const ESCALONES_ELF: DatosResolverPrecios["escalones"] = [
  { productoId: ELF, cantidadMinima: 10, precioUnitario: "9000.00" },
  { productoId: ELF, cantidadMinima: 50, precioUnitario: "8200.00" },
  { productoId: ELF, cantidadMinima: 100, precioUnitario: "7500.00" },
];
const DEFAULTS: DatosResolverPrecios["defaults"] = [
  { cantidadMinima: 10, porcentajeDescuento: "5" },
  { cantidadMinima: 50, porcentajeDescuento: "12" },
];

const mayorista = (
  items: ItemAResolver[],
  extra: Partial<DatosResolverPrecios> = {},
): ReturnType<typeof resolverPrecios> =>
  resolverPrecios({
    tipo: "MAYORISTA",
    items,
    escalones: [],
    defaults: [],
    ...extra,
  });

describe("motor de precios del cotizador", () => {
  it("unitaria: precio de lista aunque haya escalones", () => {
    const r = resolverPrecios({
      tipo: "UNITARIA",
      items: [item("Mango", 60)],
      escalones: ESCALONES_ELF,
      defaults: DEFAULTS,
    });
    expect(r.items[0]!.precioUnitario).toBe("10000.00");
    expect(r.items[0]!.escalonAplicado).toBeNull();
    expect(r.subtotal).toBe("600000.00");
    expect(r.resumenEscalones).toEqual([]);
  });

  it("mayorista sin escalones ni defaults: lista", () => {
    const r = mayorista([item("Mango", 200)]);
    expect(r.items[0]!.precioUnitario).toBe("10000.00");
    expect(r.items[0]!.escalonAplicado).toBeNull();
    expect(r.items[0]!.proximoEscalon).toBeUndefined();
  });

  it("escalones propios: el de mayor mínimo ≤ cantidad", () => {
    const r = mayorista([item("Mango", 60)], { escalones: ESCALONES_ELF, defaults: DEFAULTS });
    expect(r.items[0]!.precioUnitario).toBe("8200.00");
    expect(r.items[0]!.escalonAplicado).toBe(50);
    expect(r.items[0]!.proximoEscalon).toEqual({
      cantidadMinima: 100,
      precioUnitario: "7500.00",
      precioUnitarioUSD: null,
      faltan: 40,
    });
  });

  it("debajo del primer escalón: lista y próximo escalón", () => {
    const r = mayorista([item("Mango", 4)], { escalones: ESCALONES_ELF });
    expect(r.items[0]!.precioUnitario).toBe("10000.00");
    expect(r.items[0]!.proximoEscalon).toEqual({
      cantidadMinima: 10,
      precioUnitario: "9000.00",
      precioUnitarioUSD: null,
      faltan: 6,
    });
  });

  it("borde exacto al mínimo entra en el escalón", () => {
    const r = mayorista([item("Mango", 50)], { escalones: ESCALONES_ELF });
    expect(r.items[0]!.escalonAplicado).toBe(50);
    expect(r.items[0]!.precioUnitario).toBe("8200.00");
    const r2 = mayorista([item("Mango", 49)], { escalones: ESCALONES_ELF });
    expect(r2.items[0]!.escalonAplicado).toBe(10);
    expect(r2.items[0]!.proximoEscalon?.faltan).toBe(1);
  });

  it("escalones inactivos se ignoran", () => {
    const r = mayorista([item("Mango", 60)], {
      escalones: ESCALONES_ELF.map((e) => ({ ...e, activo: e.cantidadMinima !== 50 })),
    });
    expect(r.items[0]!.escalonAplicado).toBe(10);
  });

  it("mezcla de sabores del mismo producto: 20 Mango + 35 Frutilla → escalón 50 para ambas", () => {
    const r = mayorista([item("Mango", 20), item("Frutilla", 35)], { escalones: ESCALONES_ELF });
    for (const i of r.items) {
      expect(i.escalonAplicado).toBe(50);
      expect(i.precioUnitario).toBe("8200.00");
      expect(i.proximoEscalon).toEqual({
        cantidadMinima: 100,
        precioUnitario: "7500.00",
        precioUnitarioUSD: null,
        faltan: 45,
      });
    }
    expect(r.resumenEscalones).toEqual([
      {
        productoId: ELF,
        nombreCompleto: "Elf Bar BC 5000",
        unidades: 55,
        escalonAplicado: 50,
        precioUnitario: "8200.00",
        precioUnitarioUSD: null,
      },
    ]);
    expect(r.subtotal).toBe("451000.00");
  });

  it("default del panel: 10 → 5 %, 50 → 12 %; lista $10.000 y 50 u. → $8.800", () => {
    const r = mayorista([item("Mango", 50)], { defaults: DEFAULTS });
    expect(r.items[0]!.precioUnitario).toBe("8800.00");
    expect(r.items[0]!.escalonAplicado).toBe(50);
    const r10 = mayorista([item("Mango", 10)], { defaults: DEFAULTS });
    expect(r10.items[0]!.precioUnitario).toBe("9500.00");
    expect(r10.items[0]!.proximoEscalon).toEqual({
      cantidadMinima: 50,
      precioUnitario: "8800.00",
      precioUnitarioUSD: null,
      faltan: 40,
    });
  });

  it("default redondeado a 10 pesos", () => {
    expect(precioConDescuento("14500.00", 12).toFixed(2)).toBe("12760.00");
    expect(precioConDescuento("9999.00", 5).toFixed(2)).toBe("9500.00");
    expect(precioConDescuento("1234.00", 7).toFixed(2)).toBe("1150.00");
  });

  it("escalones propios pisan los defaults (solo esos)", () => {
    const r = mayorista(
      [item("Mango", 50), item("I1", 50, { productoId: IGN, nombreCompleto: "Ignite V80" })],
      {
        escalones: ESCALONES_ELF,
        defaults: DEFAULTS,
      },
    );
    expect(r.items[0]!.precioUnitario).toBe("8200.00");
    expect(r.items[1]!.precioUnitario).toBe("8800.00");
  });

  describe("pedido surtido (escalón por el total del pedido)", () => {
    const ign: DatosResolverPrecios["escalones"] = [
      { productoId: IGN, cantidadMinima: 30, precioUnitario: "7000.00" },
      { productoId: IGN, cantidadMinima: 50, precioUnitario: "6500.00" },
    ];
    const otro = (v: string, n: number) =>
      item(v, n, { productoId: IGN, nombreCompleto: "Ignite V80" });

    it("10 de un modelo + 20 de otro = 30 → cada uno a SU precio del escalón de 30", () => {
      const escalones: DatosResolverPrecios["escalones"] = [
        { productoId: ELF, cantidadMinima: 10, precioUnitario: "9000.00" },
        { productoId: ELF, cantidadMinima: 30, precioUnitario: "8500.00" },
        ...ign,
      ];
      const r = mayorista([item("Mango", 10), otro("I1", 20)], { escalones, surtido: true });
      expect(r.surtido).toBe(true);
      expect(r.unidadesPedido).toBe(30);
      expect(r.items.map((i) => [i.escalonAplicado, i.precioUnitario])).toEqual([
        [30, "8500.00"],
        [30, "7000.00"],
      ]);
      // El resumen sigue mostrando las unidades de cada producto.
      expect(r.resumenEscalones.map((x) => x.unidades)).toEqual([10, 20]);
    });

    it("cada producto usa su tabla: el escalón es el mayor de SU tabla ≤ total del pedido", () => {
      // 60 en total: Elf tiene 10/50/100 → 50; Ignite 30/50 → 50.
      const r = mayorista([item("Mango", 30), otro("I1", 30)], {
        escalones: [...ESCALONES_ELF, ...ign],
        surtido: true,
      });
      expect(r.items.map((i) => [i.escalonAplicado, i.precioUnitario])).toEqual([
        [50, "8200.00"],
        [50, "6500.00"],
      ]);
      // Próximo escalón de Elf: 100, faltan 40 unidades AL PEDIDO.
      expect(r.items[0]!.proximoEscalon?.faltan).toBe(40);
      expect(r.items[1]!.proximoEscalon).toBeUndefined();
    });

    it("con defaults del panel: el % se aplica por el total del pedido", () => {
      const r = mayorista([item("Mango", 25), otro("I1", 25)], {
        defaults: DEFAULTS,
        surtido: true,
      });
      // 50 en total → 12 % para los dos.
      expect(r.items.map((i) => i.precioUnitario)).toEqual(["8800.00", "8800.00"]);
    });

    it("los precios manuales también suman unidades al pedido", () => {
      const r = mayorista([item("Mango", 45, { precioManual: "5000" }), otro("I1", 5)], {
        escalones: ign,
        surtido: true,
      });
      expect(r.items[0]!.precioUnitario).toBe("5000.00");
      expect(r.items[1]!.escalonAplicado).toBe(50);
      expect(r.items[1]!.precioUnitario).toBe("6500.00");
    });

    it("unitaria ignora el surtido", () => {
      const r = resolverPrecios({
        tipo: "UNITARIA",
        items: [item("Mango", 60)],
        escalones: ESCALONES_ELF,
        defaults: DEFAULTS,
        surtido: true,
      });
      expect(r.surtido).toBe(false);
      expect(r.items[0]!.precioUnitario).toBe("10000.00");
    });
  });

  it("surtido apagado: dos productos distintos de 30 u. con escalón 50 → ninguno entra", () => {
    const ign: DatosResolverPrecios["escalones"] = [
      { productoId: IGN, cantidadMinima: 50, precioUnitario: "7000.00" },
    ];
    const r = mayorista(
      [item("Mango", 30), item("I1", 30, { productoId: IGN, nombreCompleto: "Ignite V80" })],
      { escalones: [...ESCALONES_ELF, ...ign] },
    );
    // 60 unidades en la cotización, pero 30 de cada producto: ninguno llega a 50.
    expect(r.items[0]!.escalonAplicado).toBe(10);
    expect(r.items[0]!.precioUnitario).toBe("9000.00");
    expect(r.items[0]!.proximoEscalon?.faltan).toBe(20);
    expect(r.items[1]!.escalonAplicado).toBeNull();
    expect(r.items[1]!.precioUnitario).toBe("10000.00");
    expect(r.items[1]!.proximoEscalon).toEqual({
      cantidadMinima: 50,
      precioUnitario: "7000.00",
      precioUnitarioUSD: null,
      faltan: 20,
    });
    expect(r.resumenEscalones.map((x) => [x.productoId, x.unidades, x.escalonAplicado])).toEqual([
      [ELF, 30, 10],
      [IGN, 30, null],
    ]);
  });

  it("escalón por producto con defaults: otro producto no suma unidades", () => {
    const items = [
      item("Mango", 20),
      item("Frutilla", 35),
      item("I1", 10, { productoId: IGN, nombreCompleto: "Ignite V80" }),
    ];
    const r = mayorista(items, { escalones: ESCALONES_ELF, defaults: DEFAULTS });
    expect(r.items[0]!.precioUnitario).toBe("8200.00");
    expect(r.items[1]!.precioUnitario).toBe("8200.00");
    expect(r.items[2]!.escalonAplicado).toBe(10);
    expect(r.items[2]!.precioUnitario).toBe("9500.00");
    expect(r.resumenEscalones.map((x) => x.unidades)).toEqual([55, 10]);
  });

  it("precio manual pisa todo", () => {
    const r = mayorista([item("Mango", 60, { precioManual: "7000" }), item("Frutilla", 5)], {
      escalones: ESCALONES_ELF,
    });
    expect(r.items[0]!.precioUnitario).toBe("7000.00");
    expect(r.items[0]!.esPrecioManual).toBe(true);
    expect(r.items[0]!.escalonAplicado).toBeNull();
    expect(r.items[0]!.proximoEscalon).toBeUndefined();
    // Las unidades con precio manual igual cuentan para el escalón del producto.
    expect(r.items[1]!.escalonAplicado).toBe(50);
    expect(r.resumenEscalones[0]!.escalonAplicado).toBe(50);
    expect(r.subtotal).toBe("461000.00");
  });

  describe("escalones en dólares (blue venta)", () => {
    const USD: DatosResolverPrecios["escalones"] = [
      { productoId: ELF, cantidadMinima: 10, precioUnitario: "8.00", moneda: "USD" },
      { productoId: ELF, cantidadMinima: 50, precioUnitario: "6.50", moneda: "USD" },
    ];

    it("USD × blue, redondeado a 10 pesos", () => {
      expect(pesosDesdeUSD("6.50", "1300").toFixed(2)).toBe("8450.00");
      expect(pesosDesdeUSD("7.77", "1333.33").toFixed(2)).toBe("10360.00");
      expect(pesosDesdeUSD("1", "1544").toFixed(2)).toBe("1540.00");
      expect(pesosDesdeUSD("1", "1545").toFixed(2)).toBe("1550.00");
    });

    it("20 Mango + 35 Frutilla en USD: ambos al escalón 50, precio en USD y en pesos", () => {
      const r = mayorista([item("Mango", 20), item("Frutilla", 35)], {
        escalones: USD,
        blue: "1300",
      });
      for (const i of r.items) {
        expect(i.escalonAplicado).toBe(50);
        expect(i.precioUnitarioUSD).toBe("6.50");
        expect(i.precioUnitario).toBe("8450.00");
      }
      expect(r.subtotal).toBe("464750.00");
      expect(r.subtotalUSD).toBe("357.50");
      expect(r.resumenEscalones[0]).toMatchObject({ unidades: 55, precioUnitarioUSD: "6.50" });
    });

    it("próximo escalón informa USD y pesos", () => {
      const r = mayorista([item("Mango", 30)], { escalones: USD, blue: "1300" });
      expect(r.items[0]!.precioUnitario).toBe("10400.00");
      expect(r.items[0]!.proximoEscalon).toEqual({
        cantidadMinima: 50,
        precioUnitario: "8450.00",
        precioUnitarioUSD: "6.50",
        faltan: 20,
      });
    });

    it("el blue cambia los pesos, no los dólares", () => {
      const a = mayorista([item("Mango", 60)], { escalones: USD, blue: "1300" });
      const b = mayorista([item("Mango", 60)], { escalones: USD, blue: "1540" });
      expect(a.items[0]!.precioUnitarioUSD).toBe(b.items[0]!.precioUnitarioUSD);
      expect(a.items[0]!.precioUnitario).toBe("8450.00");
      expect(b.items[0]!.precioUnitario).toBe("10010.00");
    });

    it("sin blue: error claro si aplica un escalón en USD; debajo del primero, lista", () => {
      expect(() => mayorista([item("Mango", 60)], { escalones: USD })).toThrow(/dólar blue/);
      const r = mayorista([item("Mango", 5)], { escalones: USD });
      expect(r.items[0]!.precioUnitario).toBe("10000.00");
      expect(r.items[0]!.proximoEscalon).toMatchObject({
        precioUnitario: null,
        precioUnitarioUSD: "8.00",
      });
      expect(r.subtotalUSD).toBeNull();
    });

    it("precio manual en USD (mayorista) se convierte con el blue; en unitaria no se permite", () => {
      const r = mayorista(
        [item("Mango", 10, { precioManual: "7.25", monedaManual: "USD" }), item("Frutilla", 5)],
        { escalones: USD, blue: "1300" },
      );
      expect(r.items[0]!.esPrecioManual).toBe(true);
      expect(r.items[0]!.precioUnitarioUSD).toBe("7.25");
      expect(r.items[0]!.precioUnitario).toBe("9430.00");
      expect(r.items[1]!.escalonAplicado).toBe(10);
      expect(() =>
        resolverPrecios({
          tipo: "UNITARIA",
          items: [item("Mango", 1, { precioManual: "7", monedaManual: "USD" })],
          escalones: [],
          defaults: [],
          blue: "1300",
        }),
      ).toThrow(/pesos/);
    });

    it("total en USD: exactos + pesos ÷ blue", () => {
      expect(
        totalEnUSD(
          [
            { cantidad: 10, precioUnitario: "8450.00", precioUnitarioUSD: "6.50" },
            { cantidad: 2, precioUnitario: "13000.00", precioUnitarioUSD: null },
          ],
          "1300",
        ).toFixed(2),
      ).toBe("85.00");
    });

    it("unitaria ignora el blue y los escalones en USD", () => {
      const r = resolverPrecios({
        tipo: "UNITARIA",
        items: [item("Mango", 60)],
        escalones: USD,
        defaults: [],
        blue: "1300",
      });
      expect(r.items[0]!.precioUnitario).toBe("10000.00");
      expect(r.items[0]!.precioUnitarioUSD).toBeNull();
      expect(r.subtotalUSD).toBeNull();
    });
  });
});
