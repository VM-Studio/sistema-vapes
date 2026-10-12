import { describe, expect, it } from "vitest";

import {
  ajustarVerificadas,
  faltanVerificar,
  listaDeItems,
  ventaVerificada,
  verificarEscaneo,
  type ItemAVerificar,
} from "@/lib/verificacion-escaneo";

const MANGO: ItemAVerificar = {
  varianteId: "mango",
  titulo: "Ignite V80 8000 — Mango Ice",
  cantidad: 2,
};
const BLUE: ItemAVerificar = {
  varianteId: "blue",
  titulo: "Ignite V80 8000 — Blue Razz",
  cantidad: 1,
};

describe("verificarEscaneo (Verificar con pistola)", () => {
  it("(a) coincide y faltan unidades: suma una", () => {
    const r = verificarEscaneo([MANGO], {}, "mango");
    expect(r).toMatchObject({ tipo: "ok", x: 1, y: 2, verificadas: { mango: 1 } });
  });

  it("dos escaneos de Mango → 2/2; el tercero avisa que ya están todas", () => {
    let v = {};
    for (const esperado of [1, 2]) {
      const r = verificarEscaneo([MANGO], v, "mango");
      expect(r.tipo).toBe("ok");
      if (r.tipo !== "ok") return;
      expect(r.x).toBe(esperado);
      v = r.verificadas;
    }
    expect(verificarEscaneo([MANGO], v, "mango")).toMatchObject({ tipo: "completo", y: 2 });
  });

  it("(c) otro sabor del mismo modelo no corresponde (varianteId exacto)", () => {
    expect(verificarEscaneo([MANGO], {}, "frutilla")).toEqual({ tipo: "ajeno" });
  });

  it("no muta los contadores recibidos", () => {
    const v = { mango: 1 };
    verificarEscaneo([MANGO], v, "mango");
    expect(v).toEqual({ mango: 1 });
  });
});

describe("ajustarVerificadas / faltanVerificar", () => {
  it("si baja la cantidad, el contador no supera Y; quitar el ítem borra su contador", () => {
    const items = [{ ...MANGO, cantidad: 1 }];
    expect(ajustarVerificadas(items, { mango: 2, blue: 1 })).toEqual({ mango: 1 });
  });

  it("cuenta las unidades pendientes de toda la venta", () => {
    expect(faltanVerificar([MANGO, BLUE], {})).toBe(3);
    expect(faltanVerificar([MANGO, BLUE], { mango: 2 })).toBe(1);
    expect(faltanVerificar([MANGO, BLUE], { mango: 5, blue: 1 })).toBe(0);
  });
});

describe("ventaVerificada (lo decide el servidor)", () => {
  const vendidos = [
    { varianteId: "mango", cantidad: 2 },
    { varianteId: "blue", cantidad: 1 },
  ];
  it("true solo si el detalle coincide exacto con lo vendido", () => {
    expect(
      ventaVerificada(vendidos, [
        { varianteId: "mango", unidades: 2 },
        { varianteId: "blue", unidades: 1 },
      ]),
    ).toBe(true);
  });
  it("false sin detalle, con unidades de menos, de más o ítems ajenos", () => {
    expect(ventaVerificada(vendidos, undefined)).toBe(false);
    expect(ventaVerificada(vendidos, [{ varianteId: "mango", unidades: 2 }])).toBe(false);
    expect(
      ventaVerificada(vendidos, [
        { varianteId: "mango", unidades: 3 },
        { varianteId: "blue", unidades: 1 },
      ]),
    ).toBe(false);
    expect(
      ventaVerificada(vendidos, [
        { varianteId: "mango", unidades: 2 },
        { varianteId: "blue", unidades: 1 },
        { varianteId: "otro", unidades: 1 },
      ]),
    ).toBe(false);
    expect(ventaVerificada([], [])).toBe(false);
  });
});

it("listaDeItems arma el texto del aviso", () => {
  expect(listaDeItems([MANGO, BLUE])).toBe(
    "2 × Ignite V80 8000 — Mango Ice, 1 × Ignite V80 8000 — Blue Razz",
  );
});
