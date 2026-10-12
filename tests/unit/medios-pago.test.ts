import { describe, expect, it } from "vitest";

import {
  aplicarPreciosML,
  filasIniciales,
  medioLibre,
  medioPrincipalElegido,
  totalesVenta,
  type ItemVenta,
} from "@/app/(app)/p/[slug]/ventas/estado-venta";
import {
  esCobroMercadoLibre,
  listaDeMedios,
  medioPrincipal,
  MEDIOS_PAGO_DEFAULT,
  tieneMercadoLibre,
} from "@/lib/medios-pago";
import { precioVentaMLEfectivo } from "@/lib/precios";
import { configVentasSchema } from "@/lib/validations/venta";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";

const COSMETIC = ["EFECTIVO", "TRANSFERENCIA", "MERCADO_LIBRE"] as const;

const item = (varianteId: string, precioLista: string, extra: Partial<ItemVenta> = {}) =>
  ({
    varianteId,
    productoId: "p1",
    titulo: `Serum — ${varianteId}`,
    precioLista,
    cantidad: 1,
    precioEspecial: null,
    ...extra,
  }) satisfies ItemVenta;

describe("medios de pago por panel", () => {
  it("default: Efectivo, Transferencia y Binance; se puede elegir y ordenar", () => {
    expect(configVentasSchema.parse({}).mediosPago).toEqual(MEDIOS_PAGO_DEFAULT);
    expect(configVentasSchema.parse({}).usarPrecioMLEnVentasML).toBe(true);
    expect(configVentasSchema.parse({ mediosPago: COSMETIC }).mediosPago).toEqual(COSMETIC);
    expect(configVentasSchema.safeParse({ mediosPago: [] }).success).toBe(false);
    expect(configVentasSchema.safeParse({ mediosPago: ["EFECTIVO", "EFECTIVO"] }).success).toBe(
      false,
    );
  });

  it("lista legible y si el panel cobra por Mercado Libre", () => {
    expect(listaDeMedios(COSMETIC, ETIQUETA_MEDIO_PAGO)).toBe(
      "Efectivo, Transferencia o Mercado Libre",
    );
    expect(tieneMercadoLibre({ mediosPago: COSMETIC })).toBe(true);
    expect(tieneMercadoLibre({ mediosPago: MEDIOS_PAGO_DEFAULT })).toBe(false);
  });

  it("«Dividir pago» ofrece los medios del panel, en su orden", () => {
    expect(filasIniciales(null, "100.00", COSMETIC)[0]!.medioPago).toBe("EFECTIVO");
    const filas = [{ medioPago: "EFECTIVO" as const, monto: "50", referencia: "" }];
    expect(medioLibre(filas, null, COSMETIC)).toBe("TRANSFERENCIA");
    expect(medioLibre(filas, null, ["EFECTIVO", "MERCADO_LIBRE"])).toBe("MERCADO_LIBRE");
  });
});

describe("medio principal y cobro por Mercado Libre", () => {
  it("el de mayor monto; a igualdad, el primero", () => {
    expect(medioPrincipal([])).toBeNull();
    expect(
      medioPrincipal([
        { medioPago: "EFECTIVO", monto: "5000" },
        { medioPago: "MERCADO_LIBRE", monto: "10000" },
      ]),
    ).toBe("MERCADO_LIBRE");
    expect(
      medioPrincipal([
        { medioPago: "TRANSFERENCIA", monto: 100 },
        { medioPago: "MERCADO_LIBRE", monto: 100 },
      ]),
    ).toBe("TRANSFERENCIA");
  });

  it("pago único o mayoritario por ML = cobro por Mercado Libre", () => {
    expect(esCobroMercadoLibre([{ medioPago: "MERCADO_LIBRE", monto: 15000 }])).toBe(true);
    expect(
      esCobroMercadoLibre([
        { medioPago: "MERCADO_LIBRE", monto: 4000 },
        { medioPago: "EFECTIVO", monto: 11000 },
      ]),
    ).toBe(false);
    expect(esCobroMercadoLibre([])).toBe(false);
  });

  it("en el modal: medio simple o la fila de mayor monto tipeado", () => {
    expect(medioPrincipalElegido({ medioPago: "MERCADO_LIBRE", dividido: false, pagos: [] })).toBe(
      "MERCADO_LIBRE",
    );
    expect(
      medioPrincipalElegido({
        medioPago: null,
        dividido: true,
        pagos: [
          { medioPago: "EFECTIVO", monto: "2.000", referencia: "" },
          { medioPago: "MERCADO_LIBRE", monto: "13.000", referencia: "" },
        ],
      }),
    ).toBe("MERCADO_LIBRE");
  });
});

describe("precio Mercado Libre", () => {
  it("el del sabor pisa al del producto; null si ninguno tiene", () => {
    expect(precioVentaMLEfectivo({ precioVentaML: null }, { precioVentaML: "15000.00" })).toBe(
      "15000.00",
    );
    expect(precioVentaMLEfectivo({ precioVentaML: "16500.00" }, { precioVentaML: "15000" })).toBe(
      "16500.00",
    );
    expect(precioVentaMLEfectivo({ precioVentaML: null }, { precioVentaML: null })).toBeNull();
  });

  it("lista $ 12.000 y ML $ 15.000 → el ítem va a $ 15.000 y el total se recalcula", () => {
    const items = [item("rosa", "12000.00"), item("crema", "8000.00")];
    const { items: conML, cambios } = aplicarPreciosML(items, {
      rosa: "15000.00",
      crema: null,
    });
    expect(conML[0]!.precioLista).toBe("15000.00");
    expect(conML[1]!.precioLista).toBe("8000.00");
    expect(totalesVenta(conML, "").total).toBe("23000.00");
    expect(cambios.find((c) => c.varianteId === "crema")!.precioML).toBeNull();
  });

  it("el precio especial sigue mandando", () => {
    const { items: conML, cambios } = aplicarPreciosML(
      [item("rosa", "12000.00", { precioEspecial: "13000.00" })],
      { rosa: "15000.00" },
    );
    expect(totalesVenta(conML, "").total).toBe("13000.00");
    expect(cambios[0]!.conPrecioEspecial).toBe(true);
  });
});
