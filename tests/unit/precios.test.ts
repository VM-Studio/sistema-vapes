import { describe, expect, it } from "vitest";

import { formatearIdCompra, formatearIdVenta } from "@/lib/paneles";
import { costoParaVenta, precioVentaEfectivo, tienePrecioPropio } from "@/lib/precios";

describe("precio de venta efectivo", () => {
  it("un sabor sin precio propio usa el del producto; con precio propio, el suyo", () => {
    const producto = { precioVenta: "10000.00" };
    expect(precioVentaEfectivo({ precioVenta: null }, producto)).toBe("10000.00");
    expect(precioVentaEfectivo({ precioVenta: "12000.00" }, producto)).toBe("12000.00");
    expect(tienePrecioPropio({ precioVenta: null })).toBe(false);
    expect(tienePrecioPropio({ precioVenta: 12000 })).toBe(true);
  });
  it("costo para la venta: último costo o 0", () => {
    expect(costoParaVenta({ ultimoCosto: "4500.00" })).toBe("4500.00");
    expect(costoParaVenta({ ultimoCosto: null })).toBe("0.00");
  });
  it("IDs visibles por panel", () => {
    expect(formatearIdVenta("vapes", 12)).toBe("VAP-000012");
    expect(formatearIdCompra("vapes", 1)).toBe("VAP-C-000001");
    expect(formatearIdCompra("cosmetic", 42)).toBe("COS-C-000042");
  });
});
