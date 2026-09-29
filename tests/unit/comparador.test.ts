import { describe, expect, it } from "vitest";

import {
  aCentavos,
  compararOfertas,
  esDesactualizado,
  type OfertaProveedor,
} from "@/server/reportes/comparador";

const AHORA = new Date("2026-10-15T12:00:00Z");
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 86_400_000);

const oferta = (
  proveedorId: string,
  precio: string,
  moneda: "ARS" | "USD" = "ARS",
  extra: Partial<OfertaProveedor> = {},
): OfertaProveedor => ({
  proveedorId,
  proveedor: `Prov ${proveedorId}`,
  tienda: `Tienda ${proveedorId}`,
  telefono: null,
  precio,
  moneda,
  actualizadoAt: hace(2),
  ultimaCompra: null,
  ...extra,
});

describe("compararOfertas", () => {
  it("ordena de menor a mayor con posición, diferencia $ y % contra el más barato", () => {
    const r = compararOfertas(
      [oferta("c", "11800"), oferta("a", "10000"), oferta("b", "10500.50")],
      { ahora: AHORA },
    );
    expect(r.ofertas.map((o) => o.proveedorId)).toEqual(["a", "b", "c"]);
    expect(r.ofertas.map((o) => o.posicion)).toEqual([1, 2, 3]);
    expect(r.ofertas.map((o) => o.diferencia)).toEqual(["0.00", "500.50", "1800.00"]);
    expect(r.ofertas.map((o) => o.diferenciaPct)).toEqual([0, 5, 18]);
    expect(r.ahorroMaximo).toBe("1800.00");
    expect(r.monedasSinConvertir).toBe(false);
  });

  it("badge: solo el más barato (o los empatados en el mínimo)", () => {
    const r = compararOfertas([oferta("a", "9000"), oferta("b", "9500")], { ahora: AHORA });
    expect(r.ofertas.map((o) => o.masBarato)).toEqual([true, false]);
    const empate = compararOfertas(
      [
        oferta("x", "9000", "ARS", { actualizadoAt: hace(10) }),
        oferta("y", "9000", "ARS", { actualizadoAt: hace(1) }),
        oferta("z", "9100"),
      ],
      { ahora: AHORA },
    );
    // Empate: primero el actualizado más recientemente; ambos con badge.
    expect(empate.ofertas.map((o) => o.proveedorId)).toEqual(["y", "x", "z"]);
    expect(empate.ofertas.map((o) => o.masBarato)).toEqual([true, true, false]);
  });

  it("monedas mezcladas SIN cotización: grupos separados, cada uno con su orden y su badge", () => {
    const r = compararOfertas(
      [
        oferta("u2", "12", "USD"),
        oferta("p1", "15000"),
        oferta("u1", "10", "USD"),
        oferta("p2", "14000"),
      ],
      { ahora: AHORA, cotizacionUsd: null },
    );
    expect(r.monedasSinConvertir).toBe(true);
    expect(r.ofertas.map((o) => `${o.grupo}:${o.proveedorId}:${o.posicion}`)).toEqual([
      "ARS:p2:1",
      "ARS:p1:2",
      "USD:u1:1",
      "USD:u2:2",
    ]);
    expect(r.ofertas.filter((o) => o.masBarato).map((o) => o.proveedorId)).toEqual(["p2", "u1"]);
    expect(r.ofertas.find((o) => o.proveedorId === "u2")!.diferencia).toBe("2.00");
    expect(r.ofertas.every((o) => o.precioArsEquivalente === null)).toBe(true);
    expect(r.ahorroMaximo).toBe("1000.00");
  });

  it("monedas mezcladas CON cotización: convierte USD a pesos solo para ordenar", () => {
    const r = compararOfertas(
      [oferta("p1", "15000"), oferta("u1", "10", "USD"), oferta("p2", "13000")],
      { ahora: AHORA, cotizacionUsd: 1400 },
    );
    expect(r.monedasSinConvertir).toBe(false);
    expect(r.ofertas.map((o) => o.proveedorId)).toEqual(["p2", "u1", "p1"]);
    const usd = r.ofertas.find((o) => o.proveedorId === "u1")!;
    expect(usd.precio).toBe("10");
    expect(usd.moneda).toBe("USD");
    expect(usd.precioArsEquivalente).toBe("14000.00");
    expect(usd.diferencia).toBe("1000.00");
    expect(usd.diferenciaPct).toBe(7.7);
    expect(r.ofertas.find((o) => o.proveedorId === "p2")!.precioArsEquivalente).toBeNull();
    expect(r.ofertas.every((o) => o.grupo === "ARS")).toBe(true);
    expect(r.ahorroMaximo).toBe("2000.00");
  });

  it("con cotización el USD puede ser el más barato", () => {
    const r = compararOfertas([oferta("p", "15000"), oferta("u", "9.5", "USD")], {
      ahora: AHORA,
      cotizacionUsd: 1500,
    });
    expect(r.ofertas[0]).toMatchObject({
      proveedorId: "u",
      masBarato: true,
      precioArsEquivalente: "14250.00",
    });
    expect(r.ofertas[1]).toMatchObject({ proveedorId: "p", diferencia: "750.00" });
  });

  it("cotización inválida (0, negativa, NaN) se ignora", () => {
    for (const cotizacionUsd of [0, -5, Number.NaN]) {
      const r = compararOfertas([oferta("p", "15000"), oferta("u", "10", "USD")], {
        ahora: AHORA,
        cotizacionUsd,
      });
      expect(r.monedasSinConvertir).toBe(true);
    }
  });

  it("desactualizado: más de 30 días", () => {
    const r = compararOfertas(
      [
        oferta("viejo", "9000", "ARS", { actualizadoAt: hace(31) }),
        oferta("justo", "9500", "ARS", { actualizadoAt: hace(30) }),
      ],
      { ahora: AHORA },
    );
    expect(r.ofertas.map((o) => [o.proveedorId, o.desactualizado])).toEqual([
      ["viejo", true],
      ["justo", false],
    ]);
    expect(esDesactualizado(hace(5), AHORA, 3)).toBe(true);
  });

  it("un solo proveedor: posición 1, sin ahorro; lista vacía no rompe", () => {
    const r = compararOfertas([oferta("a", "100")], { ahora: AHORA });
    expect(r.ofertas[0]).toMatchObject({ posicion: 1, masBarato: true, diferencia: "0.00" });
    expect(r.ahorroMaximo).toBeNull();
    expect(compararOfertas([], { ahora: AHORA }).ofertas).toEqual([]);
  });

  it("aCentavos redondea sin errores de coma flotante", () => {
    expect(aCentavos("0.1") + aCentavos("0.2")).toBe(aCentavos("0.3"));
    expect(aCentavos("10500.50")).toBe(1050050);
  });
});
