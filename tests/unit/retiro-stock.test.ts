import { Escaneo, EstadoVenta, TipoMovimiento } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { FAMILIAS_MOVIMIENTO, TIPO_MOVIMIENTO_UI } from "@/lib/movimientos-ui";
import { normalizarGusto } from "@/server/services/inventario.service";
import { motivoNoRetirable } from "@/server/services/retiro.service";
import { describirMovimiento } from "@/server/services/stock.service";

describe("motivoNoRetirable", () => {
  const base = { estado: EstadoVenta.CONFIRMADA, retiradaAt: null, escaneoRemoto: null };
  it("una confirmada sin retirar se puede", () => {
    expect(motivoNoRetirable(base)).toBeNull();
    expect(motivoNoRetirable({ ...base, escaneoRemoto: Escaneo.ESCANEADA })).toBeNull();
  });
  it("con el escaneo pendiente pide que la escanee Charly", () => {
    expect(motivoNoRetirable({ ...base, escaneoRemoto: Escaneo.PENDIENTE })).toMatch(
      /Falta que Charly la escanee/,
    );
  });
  it("anulada o ya retirada, no", () => {
    expect(motivoNoRetirable({ ...base, estado: EstadoVenta.ANULADA })).toMatch(/anulada/);
    expect(motivoNoRetirable({ ...base, retiradaAt: new Date() })).toMatch(/ya está retirada/);
  });
});

describe("describirMovimiento", () => {
  const venta = { tipo: "VENTA", id: "v", etiqueta: "VAP-000123", href: null, contraparte: "Juan" };
  it("texto fácil de ventas, anulaciones y retiros", () => {
    expect(describirMovimiento(TipoMovimiento.VENTA, venta)).toBe("Venta VAP-000123 a Juan");
    expect(describirMovimiento(TipoMovimiento.VENTA_ANULADA, venta)).toBe(
      "Anulación de la venta VAP-000123 (Juan)",
    );
    expect(describirMovimiento(TipoMovimiento.VENTA, venta, "RETIRO")).toBe(
      "Retirado (venta VAP-000123 a Juan)",
    );
  });
  it("transferencias con origen y destino; compras con proveedor", () => {
    const t = { tipo: "TRANSFERENCIA", id: "t", etiqueta: "VAP-T-000004", href: null };
    expect(
      describirMovimiento(TipoMovimiento.TRANSFERENCIA_SALIDA, { ...t, destino: "Mercedes" }),
    ).toBe("Transferencia VAP-T-000004 a Mercedes");
    expect(
      describirMovimiento(TipoMovimiento.TRANSFERENCIA_ENTRADA, { ...t, origen: "Ayres Plaza" }),
    ).toBe("Transferencia VAP-T-000004 desde Ayres Plaza");
    expect(
      describirMovimiento(TipoMovimiento.INGRESO_COMPRA, {
        tipo: "COMPRA",
        id: "c",
        etiqueta: "VAP-C-000001",
        href: null,
        contraparte: "Distribuidora",
      }),
    ).toBe("Compra VAP-C-000001 de Distribuidora");
  });
  it("todos los tipos tienen texto", () => {
    for (const t of Object.values(TipoMovimiento))
      expect(describirMovimiento(t, null).length).toBeGreaterThan(0);
  });
});

describe("familias del ledger", () => {
  it("entradas y salidas cubren todos los tipos según el signo", () => {
    const todos = [...FAMILIAS_MOVIMIENTO.entradas.tipos, ...FAMILIAS_MOVIMIENTO.salidas.tipos];
    expect(new Set(todos).size).toBe(Object.values(TipoMovimiento).length);
    for (const t of FAMILIAS_MOVIMIENTO.entradas.tipos) expect(TIPO_MOVIMIENTO_UI[t].signo).toBe(1);
  });
  it("solo ventas y retiros incluyen los retiros", () => {
    const conRetiros = Object.entries(FAMILIAS_MOVIMIENTO)
      .filter(([, f]) => f.retiros)
      .map(([k]) => k);
    expect(conRetiros.sort()).toEqual(["retiros", "ventas"]);
  });
});

describe("normalizarGusto", () => {
  it("agrupa mayúsculas, tildes y espacios", () => {
    expect(normalizarGusto("  Mango   ICE ")).toBe("mango ice");
    expect(normalizarGusto("Limón")).toBe(normalizarGusto("limon"));
  });
});
