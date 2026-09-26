import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buscarEnCatalogo, sincronizarCatalogo } from "@/features/offline/catalogo";
import {
  descartar,
  encolar,
  listarCola,
  reintentar,
  sincronizarCola,
} from "@/features/offline/cola";
import { abrirDb } from "@/features/offline/db";

const respuesta = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

beforeEach(async () => {
  const db = await abrirDb();
  await db.clear("cola");
  await db.clear("variantes");
  await db.clear("meta");
});

describe("catálogo offline (IndexedDB)", () => {
  it("resuelve por código principal, alternativo y SKU; si no cambió, 304 sin bajar nada", async () => {
    const catalogo = {
      version: "v1",
      generadoEn: "",
      depositos: [{ id: "g1", nombre: "Galpón 1", esPrincipal: true }],
      variantes: [
        {
          varianteId: "v1",
          productoId: "p1",
          producto: "Ignite V80",
          variante: "Mango Ice",
          nombreCompleto: "Ignite V80 — Mango Ice",
          sku: "PRD-000001",
          codigoBarras: "7790001000019",
          codigos: ["7790001000019", "7799999000014", "PRD-000001"],
          alternativos: ["7799999000014"],
          marca: "Ignite",
          categoria: "Vapes",
          imagenUrl: null,
          precioVenta: "16000.00",
          stockMinimo: 10,
          stock: [{ depositoId: "g1", deposito: "Galpón 1", esPrincipal: true, cantidad: 24 }],
          stockTotal: 24,
        },
      ],
    };
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(respuesta(catalogo));
    const usuario = {
      id: "u1",
      nombre: "Ana",
      permisos: { ingresar: true, contar: true, transferir: true, completar: false },
    };
    expect((await sincronizarCatalogo(usuario)).estado).toBe("actualizado");
    expect((await buscarEnCatalogo("7790001000019"))?.nombreCompleto).toBe(
      "Ignite V80 — Mango Ice",
    );
    expect((await buscarEnCatalogo(" 7799999000014 "))?.porCodigoAlternativo).toBe(true);
    expect((await buscarEnCatalogo("prd-000001"))?.varianteId).toBe("v1");
    expect((await buscarEnCatalogo("7790001000019"))?.precioCosto).toBeNull(); // sin costos offline
    expect(await buscarEnCatalogo("0000")).toBeNull();

    f.mockResolvedValueOnce(new Response(null, { status: 304 }));
    expect((await sincronizarCatalogo(usuario)).estado).toBe("sin-cambios");
    expect(f.mock.calls[1]![1]).toMatchObject({ headers: { "If-None-Match": '"cat-v1"' } });
    f.mockRestore();
  });
});

describe("cola de operaciones sin conexión", () => {
  it("encola con idOperacion UUID; al sincronizar, las aplicadas salen y las rechazadas quedan con motivo", async () => {
    const a = await encolar("INGRESO", { depositoId: "g1" }, "u1", "Ingreso · 3 u.");
    const b = await encolar("TRANSFERENCIA", { transferencia: {} }, "u1", "Transferencia · 1 u.");
    expect(a.idOperacion).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const fetchFalso = vi.fn().mockResolvedValue(
      respuesta({
        ok: true,
        data: {
          resultados: [
            { idOperacion: a.idOperacion, estado: "APLICADA", repetida: false },
            {
              idOperacion: b.idOperacion,
              estado: "RECHAZADA",
              motivo: "Stock insuficiente en Galpón 1",
              repetida: false,
            },
          ],
        },
      }),
    );
    const r = await sincronizarCola(fetchFalso as unknown as typeof fetch);
    expect(r).toMatchObject({ enviadas: 2, aplicadas: 1, rechazadas: 1 });
    // Se mandaron en orden y con su autor.
    const cuerpo = JSON.parse(fetchFalso.mock.calls[0]![1].body as string);
    expect(cuerpo.operaciones.map((o: { idOperacion: string }) => o.idOperacion)).toEqual([
      a.idOperacion,
      b.idOperacion,
    ]);
    expect(cuerpo.operaciones[0].usuarioId).toBe("u1");
    const cola = await listarCola();
    expect(cola).toHaveLength(1);
    expect(cola[0]).toMatchObject({
      idOperacion: b.idOperacion,
      estado: "RECHAZADA",
      motivo: "Stock insuficiente en Galpón 1",
    });
  });

  it("sin red, todo queda pendiente (nada se pierde)", async () => {
    await encolar("RECUENTO", {}, "u1", "Recuento");
    const r = await sincronizarCola(
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch,
    );
    expect(r.sinRed).toBe(true);
    expect((await listarCola()).map((o) => o.estado)).toEqual(["PENDIENTE"]);
  });

  it("una rechazada solo sale a mano; reintentar crea una operación NUEVA (otro idOperacion)", async () => {
    const op = await encolar("INGRESO", {}, "u1", "Ingreso");
    await sincronizarCola(
      vi.fn().mockResolvedValue(
        respuesta({
          ok: true,
          data: {
            resultados: [
              { idOperacion: op.idOperacion, estado: "RECHAZADA", motivo: "x", repetida: false },
            ],
          },
        }),
      ) as unknown as typeof fetch,
    );
    await reintentar(op.idOperacion);
    const [nueva] = await listarCola();
    expect(nueva!.idOperacion).not.toBe(op.idOperacion);
    expect(nueva!.estado).toBe("PENDIENTE");
    await descartar(nueva!.idOperacion); // pendiente: descartar no hace nada
    expect(await listarCola()).toHaveLength(1);
  });
});
