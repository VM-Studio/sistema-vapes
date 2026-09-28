import { describe, expect, it } from "vitest";

import {
  precioConDescuento,
  resolverPrecios,
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
    modo: "POR_PRODUCTO",
    items,
    escalones: [],
    defaults: [],
    ...extra,
  });

describe("motor de precios del cotizador", () => {
  it("unitaria: precio de lista aunque haya escalones", () => {
    const r = resolverPrecios({
      tipo: "UNITARIA",
      modo: "POR_PRODUCTO",
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
      faltan: 40,
    });
  });

  it("debajo del primer escalón: lista y próximo escalón", () => {
    const r = mayorista([item("Mango", 4)], { escalones: ESCALONES_ELF });
    expect(r.items[0]!.precioUnitario).toBe("10000.00");
    expect(r.items[0]!.proximoEscalon).toEqual({
      cantidadMinima: 10,
      precioUnitario: "9000.00",
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

  it("POR_PRODUCTO vs POR_TOTAL", () => {
    const items = [
      item("Mango", 20),
      item("Frutilla", 35),
      item("I1", 10, { productoId: IGN, nombreCompleto: "Ignite V80" }),
    ];
    const porProducto = mayorista(items, { escalones: ESCALONES_ELF, defaults: DEFAULTS });
    expect(porProducto.items[2]!.escalonAplicado).toBe(10);
    expect(porProducto.items[2]!.precioUnitario).toBe("9500.00");

    const porTotal = mayorista(items, {
      modo: "POR_TOTAL",
      escalones: ESCALONES_ELF,
      defaults: DEFAULTS,
    });
    expect(porTotal.modo).toBe("POR_TOTAL");
    // 65 unidades en total: escalón 50 para todos.
    expect(porTotal.items[0]!.precioUnitario).toBe("8200.00");
    expect(porTotal.items[2]!.escalonAplicado).toBe(50);
    expect(porTotal.items[2]!.precioUnitario).toBe("8800.00");
    expect(porTotal.items[2]!.proximoEscalon).toBeUndefined();
    expect(porTotal.items[0]!.proximoEscalon?.faltan).toBe(35);
    expect(porTotal.resumenEscalones.map((r) => r.unidades)).toEqual([65, 65]);
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
});
