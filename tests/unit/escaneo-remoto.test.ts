import { describe, expect, it } from "vitest";

import { esPerfilEscaneo, type PermisoModulo } from "@/lib/permisos";
import {
  diferencias,
  evaluarEscaneo,
  type IdentidadVape,
  type ItemEscaneo,
  type LecturaEscaneo,
} from "@/lib/escaneo-remoto";

const vape = (
  varianteId: string,
  productoId: string,
  marca: string,
  modelo: string,
  especificacion: string,
  sabor: string | null,
): IdentidadVape => ({
  varianteId,
  productoId,
  marca,
  modelo,
  especificacion,
  sabor,
  titulo: `${marca} ${modelo} ${especificacion}${sabor ? ` — ${sabor}` : ""}`,
});

const BC5000_WATERMELON = vape("bc5-wm", "bc5", "Elf Bar", "BC", "5000", "Watermelon Ice");
const BC5000_PEACH = vape("bc5-pm", "bc5", "Elf Bar", "BC", "5000", "Peach Mango");
const BC10000_WATERMELON = vape("bc10-wm", "bc10", "Elf Bar", "BC", "10000", "Watermelon Ice");
const BC10000_BLUE = vape("bc10-br", "bc10", "Elf Bar", "BC", "10000", "Blue Razz Ice");
const IGNITE_MANGO = vape("ig-mango", "ig", "Ignite", "V80", "8000", "Mango Ice");
const IGNITE_STRAWBERRY = vape("ig-str", "ig", "Ignite", "V80", "8000", "Strawberry Watermelon");
const CARGADOR = vape("cargador", "carg", "TechPro", "Cargador USB-C 20W", "", null);

const item = (v: IdentidadVape, cantidad: number): ItemEscaneo => ({ ...v, cantidad });
const leer = (v: IdentidadVape | null, codigo = v?.varianteId ?? "000"): LecturaEscaneo => ({
  codigo,
  variante: v,
});

describe("diferencias (dónde no coincide)", () => {
  it("mismo producto, otro sabor: solo el sabor", () => {
    const d = diferencias(IGNITE_STRAWBERRY, IGNITE_MANGO);
    expect(d.campos).toEqual(["sabor"]);
    expect(d.resumen).toBe("Sabor distinto");
    expect(d.detalles).toEqual([
      "Sabor: escaneaste «Strawberry Watermelon», la venta lleva «Mango Ice».",
    ]);
  });

  it("mismo modelo y sabor, otras pitadas", () => {
    const d = diferencias(BC10000_WATERMELON, BC5000_WATERMELON);
    expect(d.campos).toEqual(["pitadas"]);
    expect(d.resumen).toBe("Pitadas distintas");
    expect(d.detalles[0]).toBe("Pitadas: escaneaste 10000, la venta lleva 5000.");
  });

  it("pitadas y sabor a la vez", () => {
    const d = diferencias(BC10000_BLUE, BC5000_WATERMELON);
    expect(d.campos).toEqual(["pitadas", "sabor"]);
    expect(d.resumen).toBe("No coincide: pitadas y sabor");
  });

  it("otro modelo (y todo lo demás)", () => {
    const d = diferencias(IGNITE_MANGO, BC5000_PEACH);
    expect(d.campos).toEqual(["producto", "pitadas", "sabor"]);
    expect(d.resumen).toBe("No coincide: modelo, pitadas y sabor");
    expect(d.detalles[0]).toBe("Modelo: escaneaste «Ignite V80», la venta lleva «Elf Bar BC».");
  });

  it("producto sin sabor y sin especificación: lo dice claro", () => {
    const d = diferencias(CARGADOR, IGNITE_MANGO);
    expect(d.campos).toEqual(["producto", "pitadas", "sabor"]);
    expect(d.detalles[1]).toBe("Pitadas: escaneaste sin dato, la venta lleva 8000.");
    expect(d.detalles[2]).toBe("Sabor: escaneaste «sin sabor», la venta lleva «Mango Ice».");
  });

  it("usa la etiqueta del panel y no distingue mayúsculas ni tildes", () => {
    const a = vape("a", "pa", "Marca", "Crema", "250 ml", "Coco");
    const b = vape("b", "pb", "marca", "crema", "500 ml", "coco");
    const d = diferencias(a, b, "Contenido");
    expect(d.campos).toEqual(["pitadas"]);
    expect(d.resumen).toBe("Contenido distinto");
  });
});

describe("evaluarEscaneo", () => {
  const venta = [item(BC5000_WATERMELON, 2), item(IGNITE_MANGO, 1)];

  it("todo exacto: completo, sin rechazos ni faltantes", () => {
    const r = evaluarEscaneo(venta, [
      leer(BC5000_WATERMELON, "c1"),
      leer(IGNITE_MANGO, "c2"),
      leer(BC5000_WATERMELON, "c1"),
    ]);
    expect(r.completo).toBe(true);
    expect(r.rechazos).toEqual([]);
    expect(r.faltantes).toEqual([]);
    expect(r.progreso).toEqual([
      { varianteId: "bc5-wm", escaneadas: 2, cantidad: 2 },
      { varianteId: "ig-mango", escaneadas: 1, cantidad: 1 },
    ]);
    expect(r.aceptados.map((a) => a.codigo)).toEqual(["c1", "c2", "c1"]);
  });

  it("faltan unidades: no completo y dice cuántas", () => {
    const r = evaluarEscaneo(venta, [leer(BC5000_WATERMELON), leer(IGNITE_MANGO)]);
    expect(r.completo).toBe(false);
    expect(r.faltantes).toEqual([
      {
        varianteId: "bc5-wm",
        faltan: 1,
        mensaje: "Falta 1 unidad de Elf Bar BC 5000 — Watermelon Ice (escaneaste 1 de 2).",
      },
    ]);
  });

  it("unidades de más: el escaneo sobrante se rechaza y no suma", () => {
    const r = evaluarEscaneo(venta, [leer(IGNITE_MANGO), leer(IGNITE_MANGO, "otra")]);
    expect(r.progreso[1]).toEqual({ varianteId: "ig-mango", escaneadas: 1, cantidad: 1 });
    expect(r.rechazos).toHaveLength(1);
    expect(r.rechazos[0]).toMatchObject({
      codigo: "otra",
      varianteIdItem: "ig-mango",
      campos: ["unidades"],
      resumen: "Unidades de más",
    });
    expect(r.rechazos[0]!.detalles[0]).toBe(
      "La venta lleva 1 unidad de Ignite V80 8000 — Mango Ice y ya está escaneada.",
    );
  });

  it("otro sabor del mismo modelo: compara contra ese ítem y marca el sabor", () => {
    const r = evaluarEscaneo(venta, [leer(IGNITE_STRAWBERRY, "frut")]);
    expect(r.completo).toBe(false);
    expect(r.aceptados).toEqual([]);
    expect(r.rechazos[0]).toMatchObject({
      varianteIdItem: "ig-mango",
      campos: ["sabor"],
      escaneado: "Ignite V80 8000 — Strawberry Watermelon",
    });
  });

  it("mismo sabor con otras pitadas: elige el ítem del mismo sabor", () => {
    const r = evaluarEscaneo(venta, [leer(BC10000_WATERMELON)]);
    expect(r.rechazos[0]).toMatchObject({ varianteIdItem: "bc5-wm", campos: ["pitadas"] });
  });

  it("a igual parecido prefiere el ítem que todavía tiene unidades pendientes", () => {
    const dos = [item(IGNITE_MANGO, 1), item(IGNITE_STRAWBERRY, 1)];
    const otroSabor = vape("ig-otro", "ig", "Ignite", "V80", "8000", "Grape");
    const r = evaluarEscaneo(dos, [leer(IGNITE_MANGO), leer(otroSabor)]);
    expect(r.rechazos[0]!.varianteIdItem).toBe("ig-str");
  });

  it("código desconocido: rechazo de código, sin ítem", () => {
    const r = evaluarEscaneo(venta, [leer(null, "999")]);
    expect(r.rechazos[0]).toMatchObject({
      codigo: "999",
      varianteIdItem: null,
      campos: ["codigo"],
      resumen: "Código desconocido",
    });
  });

  it("con un rechazo nunca queda completo aunque las cantidades cierren", () => {
    const r = evaluarEscaneo(
      [item(IGNITE_MANGO, 1)],
      [leer(IGNITE_MANGO), leer(IGNITE_STRAWBERRY)],
    );
    expect(r.faltantes).toEqual([]);
    expect(r.completo).toBe(false);
  });

  it("sin ítems no hay nada completo", () => {
    expect(evaluarEscaneo([], []).completo).toBe(false);
  });
});

describe("esPerfilEscaneo", () => {
  const permiso = (modulo: PermisoModulo["modulo"], puedeVer = true): PermisoModulo => ({
    panelId: "p",
    modulo,
    puedeVer,
    puedeCrear: false,
    puedeEditar: false,
    puedeEliminar: false,
  });
  it("empleado solo con ESCANEO: sí", () => {
    expect(
      esPerfilEscaneo({
        rol: "EMPLEADO",
        paneles: ["p"],
        permisos: [permiso("ESCANEO"), permiso("VENTAS", false)],
      }),
    ).toBe(true);
  });
  it("con otro módulo visible, o dueño, o sin ESCANEO: no", () => {
    expect(
      esPerfilEscaneo({
        rol: "EMPLEADO",
        paneles: ["p"],
        permisos: [permiso("ESCANEO"), permiso("VENTAS")],
      }),
    ).toBe(false);
    expect(esPerfilEscaneo({ rol: "OWNER", paneles: [], permisos: [permiso("ESCANEO")] })).toBe(
      false,
    );
    expect(esPerfilEscaneo({ rol: "EMPLEADO", paneles: ["p"], permisos: [] })).toBe(false);
  });
});
