import { RolUsuario } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  itemActivo,
  navegacionPermitida,
  tituloDeRuta,
  type ItemNavegacion,
} from "@/config/navigation";

const dueno = { rol: RolUsuario.OWNER, permisos: [], paneles: [] };
const items = navegacionPermitida(dueno, { id: "pnl_vapes", slug: "vapes" });
const activos = (pathname: string) =>
  items
    .filter((i: ItemNavegacion) => i.href === itemActivo(items, pathname)?.href)
    .map((i) => i.label);

describe("itemActivo: un solo ítem activo, el más específico", () => {
  it("/cotizador/mayorista/nueva marca solo «Cotizar por mayor» (no también «Cotizaciones»)", () => {
    expect(activos("/p/vapes/cotizador/mayorista/nueva")).toEqual(["Cotizar por mayor"]);
  });

  it("/cotizador/unitaria/nueva marca solo «Cotizar por unidad»", () => {
    expect(activos("/p/vapes/cotizador/unitaria/nueva")).toEqual(["Cotizar por unidad"]);
  });

  it("el listado y el detalle de una cotización marcan «Cotizaciones»", () => {
    expect(activos("/p/vapes/cotizador")).toEqual(["Cotizaciones"]);
    expect(activos("/p/vapes/cotizador/abc123")).toEqual(["Cotizaciones"]);
  });

  it("el inicio del panel solo por ruta exacta", () => {
    expect(activos("/p/vapes")).toEqual(["Inicio"]);
    expect(activos("/p/vapes/ventas/xyz")).toEqual(["Ventas"]);
  });

  it("Pasista está en la navegación (grupo Compras) y se marca en su detalle", () => {
    const pasista = items.find((i) => i.label === "Pasista");
    expect(pasista?.grupo).toBe("Compras");
    expect(activos("/p/vapes/pasista/c1")).toEqual(["Pasista"]);
  });

  it("sin coincidencias no hay ítem activo", () => {
    expect(itemActivo(items, "/paneles")).toBeNull();
  });

  it("el título de la barra superior usa el mismo criterio", () => {
    expect(tituloDeRuta("/p/vapes/cotizador/mayorista/nueva")).toBe("Cotizar por mayor");
    expect(tituloDeRuta("/p/vapes/cotizador/abc")).toBe("Cotizaciones");
    expect(tituloDeRuta("/p/vapes/pasista")).toBe("Pasista");
  });

  it("un empleado sin PASISTA no ve el ítem", () => {
    const empleado = {
      rol: RolUsuario.EMPLEADO,
      paneles: ["pnl_vapes"],
      permisos: [
        {
          panelId: "pnl_vapes",
          modulo: "VENTAS" as const,
          puedeVer: true,
          puedeCrear: true,
          puedeEditar: false,
          puedeEliminar: false,
        },
      ],
    };
    const suyos = navegacionPermitida(empleado, { id: "pnl_vapes", slug: "vapes" });
    expect(suyos.some((i) => i.label === "Pasista")).toBe(false);
  });
});
