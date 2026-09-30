import { Modulo, RolUsuario } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  cambiarMontoFila,
  filasIniciales,
  resumirPago,
  type FilaPago,
} from "@/app/(app)/p/[slug]/ventas/estado-venta";
import { accionesDe, normalizarPermiso, puede } from "@/lib/permisos";
import { etiquetaMedioPrincipal, textoResumenVenta } from "@/lib/ventas-ui";

const fila = (medioPago: FilaPago["medioPago"], monto: string, referencia = ""): FilaPago => ({
  medioPago,
  monto,
  referencia,
});

describe("resumirPago (paso 4 del modal de venta)", () => {
  it("un medio = un pago por el total", () => {
    const r = resumirPago({ medioPago: "TRANSFERENCIA", dividido: false, pagos: [] }, "30000.00");
    expect(r.pagos).toEqual([{ medioPago: "TRANSFERENCIA", monto: "30000.00" }]);
    expect(r.pendiente).toBe("0.00");
    expect(r.error).toBeNull();
  });

  it("sin medio elegido queda todo pendiente", () => {
    const r = resumirPago({ medioPago: null, dividido: false, pagos: [] }, "30000.00");
    expect(r.pagos).toEqual([]);
    expect(r.pendiente).toBe("30000.00");
  });

  it("dividido: suma las filas, ignora las vacías y conserva la referencia", () => {
    const r = resumirPago(
      {
        medioPago: null,
        dividido: true,
        pagos: [
          fila("EFECTIVO", "20.000"),
          fila("TRANSFERENCIA", "10000", " OP-1 "),
          fila("BINANCE", ""),
        ],
      },
      "30000.00",
    );
    expect(r.pagos).toEqual([
      { medioPago: "EFECTIVO", monto: "20000.00" },
      { medioPago: "TRANSFERENCIA", monto: "10000.00", referencia: "OP-1" },
    ]);
    expect(r.pagado).toBe("30000.00");
    expect(r.pendiente).toBe("0.00");
  });

  it("el efectivo de más es vuelto y no se registra", () => {
    const r = resumirPago(
      {
        medioPago: null,
        dividido: true,
        pagos: [fila("TRANSFERENCIA", "10000"), fila("EFECTIVO", "25000")],
      },
      "30000.00",
    );
    expect(r.vuelto).toBe("5000.00");
    expect(r.pagos).toEqual([
      { medioPago: "TRANSFERENCIA", monto: "10000.00" },
      { medioPago: "EFECTIVO", monto: "20000.00" },
    ]);
    expect(r.error).toBeNull();
  });

  it("de más sin efectivo que lo cubra es error", () => {
    const r = resumirPago(
      { medioPago: null, dividido: true, pagos: [fila("TRANSFERENCIA", "35000")] },
      "30000.00",
    );
    expect(r.error).toBe("Los pagos superan el total");
  });

  it("lo que no se paga queda pendiente (fiado)", () => {
    const r = resumirPago(
      { medioPago: null, dividido: true, pagos: [fila("EFECTIVO", "10000")] },
      "30000.00",
    );
    expect(r.pendiente).toBe("20000.00");
    expect(r.pagado).toBe("10000.00");
  });
});

describe("cambiarMontoFila", () => {
  it("un monto menor en la última fila agrega otra con el restante", () => {
    const filas = cambiarMontoFila(filasIniciales("EFECTIVO", "30000.00"), 0, "20000", "30000.00");
    expect(filas).toEqual([fila("EFECTIVO", "20000"), fila("TRANSFERENCIA", "10000.00")]);
  });

  it("si hay una fila después, esa absorbe la diferencia", () => {
    const filas = cambiarMontoFila(
      [fila("EFECTIVO", "20000"), fila("TRANSFERENCIA", "10000.00")],
      0,
      "5000",
      "30000.00",
    );
    expect(filas[1]!.monto).toBe("25000.00");
  });

  it("no pasa de 3 filas ni repite medios", () => {
    let filas = filasIniciales("BINANCE", "30000.00");
    filas = cambiarMontoFila(filas, 0, "10000", "30000.00");
    filas = cambiarMontoFila(filas, 1, "10000", "30000.00");
    filas = cambiarMontoFila(filas, 2, "5000", "30000.00");
    expect(filas.map((f) => f.medioPago)).toEqual(["BINANCE", "EFECTIVO", "TRANSFERENCIA"]);
    expect(filas).toHaveLength(3);
  });
});

describe("Permisos de FIADOS", () => {
  const empleado = (
    acciones: Partial<Record<"puedeVer" | "puedeCrear" | "puedeEditar", boolean>>,
  ) => ({
    rol: RolUsuario.EMPLEADO,
    paneles: ["p1"],
    permisos: [
      {
        panelId: "p1",
        modulo: Modulo.FIADOS,
        puedeVer: false,
        puedeCrear: false,
        puedeEditar: false,
        puedeEliminar: false,
        ...acciones,
      },
    ],
  });

  it("ver, crear (vender fiado) y editar (cobrar); sin eliminar", () => {
    expect(accionesDe(Modulo.FIADOS)).toEqual(["ver", "crear", "editar"]);
    const n = normalizarPermiso({
      ...empleado({}).permisos[0]!,
      puedeEliminar: true,
      puedeCrear: true,
    });
    expect(n.puedeEliminar).toBe(false);
    expect(n.puedeVer).toBe(true);
  });

  it("un empleado sin la fila no fía; con crear sí; el dueño siempre", () => {
    expect(
      puede(
        { rol: RolUsuario.EMPLEADO, paneles: ["p1"], permisos: [] },
        "p1",
        Modulo.FIADOS,
        "crear",
      ),
    ).toBe(false);
    expect(
      puede(empleado({ puedeVer: true, puedeCrear: true }), "p1", Modulo.FIADOS, "crear"),
    ).toBe(true);
    expect(
      puede({ rol: RolUsuario.OWNER, paneles: [], permisos: [] }, "p1", Modulo.FIADOS, "editar"),
    ).toBe(true);
  });
});

describe("Textos de venta", () => {
  it("medio principal null = Fiado", () => {
    expect(etiquetaMedioPrincipal(null)).toBe("Fiado");
    expect(etiquetaMedioPrincipal("BINANCE")).toBe("Binance");
  });

  it("el resumen por WhatsApp muestra lo pendiente si quedó debiendo", () => {
    const texto = textoResumenVenta({
      codigo: "VAP-000001",
      cliente: "Ana",
      items: [{ titulo: "Pod", cantidad: 1, subtotal: "30000.00" }],
      descuento: "0.00",
      total: "30000.00",
      pagado: "10000.00",
      pendiente: "20000.00",
    });
    expect(texto).toMatch(/Pagado: \$\s?10\.000/);
    expect(texto).toMatch(/Pendiente: \$\s?20\.000/);
  });
});
