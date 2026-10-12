import { describe, expect, it } from "vitest";

import { navegacionPermitida } from "@/config/navigation";
import {
  calcularImportesFactura,
  configFacturacionSchema,
  cuitValido,
  facturarVentaSchema,
  formatearCuit,
  formatearIdFactura,
  normalizarCuit,
  tiposPermitidos,
} from "@/lib/validations/factura";

describe("CUIT", () => {
  it("valida el dígito verificador", () => {
    expect(cuitValido("20-12345678-6")).toBe(true);
    expect(cuitValido("20123456786")).toBe(true);
    expect(cuitValido("20-12345678-5")).toBe(false);
    expect(cuitValido("30-71234567-1")).toBe(cuitValido("30712345671"));
    expect(cuitValido("2012345678")).toBe(false);
    expect(cuitValido("99-12345678-6")).toBe(false);
  });

  it("normaliza y formatea", () => {
    expect(normalizarCuit("20 12345678 6")).toBe("20123456786");
    expect(formatearCuit("20123456786")).toBe("20-12345678-6");
  });

  it("la factura A exige razón social y CUIT válido", () => {
    const base = { ventaId: "v1", tipo: "A" as const };
    expect(facturarVentaSchema.safeParse(base).success).toBe(false);
    expect(
      facturarVentaSchema.safeParse({
        ...base,
        datosFiscales: { razonSocial: "Cliente SA", cuit: "20-12345678-5" },
      }).success,
    ).toBe(false);
    const ok = facturarVentaSchema.parse({
      ...base,
      datosFiscales: { razonSocial: "Cliente SA", cuit: "20-12345678-6" },
    });
    expect(ok.datosFiscales.cuit).toBe("20123456786");
    expect(facturarVentaSchema.safeParse({ ventaId: "v1", tipo: "B" }).success).toBe(true);
  });
});

describe("importes de la factura", () => {
  const items = [
    { cantidad: 2, precioUnitario: 15000 },
    { cantidad: 1, precioUnitario: "8000.00" },
  ];

  it("B, C e interno: el total sin discriminar IVA", () => {
    for (const tipo of ["B", "C", "COMPROBANTE_INTERNO"] as const) {
      const r = calcularImportesFactura(tipo, items, 1000);
      expect(r).toMatchObject({ bruto: "38000.00", descuento: "1000.00", total: "37000.00" });
      expect(r.subtotal).toBe("37000.00");
      expect(r.iva).toBe("0.00");
    }
  });

  it("A: neto + IVA 21% = total exacto", () => {
    const r = calcularImportesFactura("A", [{ cantidad: 1, precioUnitario: 15000 }], 0, 21);
    expect(r.subtotal).toBe("12396.69");
    expect(r.iva).toBe("2603.31");
    expect(Number(r.subtotal) + Number(r.iva)).toBeCloseTo(15000, 2);
    expect(r.alicuotaIva).toBe("21.00");
  });

  it("el descuento no supera el bruto", () => {
    expect(calcularImportesFactura("B", items, 999999).total).toBe("0.00");
  });
});

describe("configuración y numeración", () => {
  it("tipos según la condición del negocio", () => {
    expect(tiposPermitidos("RESPONSABLE_INSCRIPTO")).toEqual(["A", "B", "COMPROBANTE_INTERNO"]);
    expect(tiposPermitidos("MONOTRIBUTO")).toEqual(["C", "COMPROBANTE_INTERNO"]);
    expect(tiposPermitidos(undefined)).toHaveLength(4);
  });

  it("defaults: deshabilitada, punto de venta 1 e IVA 21%", () => {
    expect(configFacturacionSchema.parse({})).toMatchObject({
      habilitada: false,
      puntoVenta: 1,
      alicuotaIva: 21,
    });
    expect(configFacturacionSchema.safeParse({ cuit: "123" }).success).toBe(false);
  });

  it("ID visible COS-F-000001", () => {
    expect(formatearIdFactura("COS", 1)).toBe("COS-F-000001");
  });

  it("Facturas aparece en la navegación solo si el panel factura", () => {
    const owner = { rol: "OWNER" as const, permisos: [], paneles: [] };
    const panel = { id: "pnl_cosmetic", slug: "cosmetic" };
    const con = navegacionPermitida(owner, panel, { facturacion: true });
    const sin = navegacionPermitida(owner, panel, { facturacion: false });
    expect(con.some((i) => i.href === "/p/cosmetic/facturas")).toBe(true);
    expect(sin.some((i) => i.href === "/p/cosmetic/facturas")).toBe(false);
  });
});
