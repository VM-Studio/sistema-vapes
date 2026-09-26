import type { Page } from "@playwright/test";

import { expect, test } from "./base";

import {
  codigoDe,
  db,
  esperarCatalogoOffline,
  loginDueno,
  pistola,
  stock,
  soltarFoco,
} from "./helpers";

interface OpCola {
  idOperacion: string;
  tipo: string;
  creadaEn: string;
  usuarioId: string;
  payload: unknown;
  estado: string;
  motivo?: string;
}

const leerCola = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<OpCola[]>((ok) => {
        const req = indexedDB.open("gestion-offline");
        req.onsuccess = () => {
          const g = req.result.transaction("cola").objectStore("cola").getAll();
          g.onsuccess = () => ok(g.result as OpCola[]);
        };
      }),
  );

test.describe("modo sin conexión del escáner", () => {
  test("ingreso offline: código desde IndexedDB, queda en cola y se sincroniza UNA sola vez", async ({
    page,
    context,
  }) => {
    const codigo = await codigoDe("Elf Bar BC5000", "Peach Mango");
    const antes = await stock("Elf Bar BC5000", "Peach Mango", "Galpón 1");
    const inicio = new Date();
    await loginDueno(page);
    await page.goto("/escanear?modo=ingresar");
    await esperarCatalogoOffline(page);
    await page.getByLabel("Depósito", { exact: true }).selectOption({ label: "Galpón 1" });

    await context.setOffline(true);
    await expect(page.getByTestId("indicador-red").first()).toHaveAttribute("data-online", "0");
    await soltarFoco(page);
    await pistola(page, codigo); // sin red: lo resuelve el catálogo de IndexedDB
    await expect(page.getByLabel("Cantidad de Elf Bar BC5000 — Peach Mango")).toHaveValue("1");
    await page.getByRole("button", { name: /Confirmar ingreso \(1 u\.\)/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirmar ingreso" }).click();
    await expect(page.getByText("Guardado sin conexión")).toBeVisible();

    const cola = await leerCola(page);
    expect(cola).toHaveLength(1);
    const op = cola[0]!;
    expect(op.idOperacion).toMatch(/^[0-9a-f-]{36}$/);
    expect(op.tipo).toBe("INGRESO");
    await expect(page.getByLabel("Pendientes de sincronización")).toContainText(
      "Ingreso · 1 u. · Galpón 1",
    );
    expect(await stock("Elf Bar BC5000", "Peach Mango", "Galpón 1")).toBe(antes); // todavía nada

    // Vuelve la red: se sincroniza sola (evento online) y ADEMÁS se dispara el
    // sync dos veces más a la vez con la misma operación: tiene que aplicarse una sola vez.
    await context.setOffline(false);
    const cuerpo = {
      operaciones: [
        {
          idOperacion: op.idOperacion,
          tipo: op.tipo,
          creadaEn: op.creadaEn,
          usuarioId: op.usuarioId,
          payload: op.payload,
        },
      ],
    };
    const [r1, r2] = await page.evaluate(async (b) => {
      const enviar = () =>
        fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(b),
        }).then((r) => r.json());
      return Promise.all([enviar(), enviar()]);
    }, cuerpo);
    for (const r of [r1, r2]) expect(r.data.resultados[0].estado).toBe("APLICADA");

    await expect.poll(async () => (await leerCola(page)).length, { timeout: 20_000 }).toBe(0);
    expect(await db.operacionSincronizada.count({ where: { idOperacion: op.idOperacion } })).toBe(
      1,
    );
    const movimientos = await db.movimientoStock.count({
      where: {
        tipo: "INGRESO_MANUAL",
        createdAt: { gte: inicio },
        variante: { codigoBarras: codigo },
      },
    });
    expect(movimientos).toBe(1);
    expect(await stock("Elf Bar BC5000", "Peach Mango", "Galpón 1")).toBe(antes + 1);
  });

  test("transferencia offline sin stock al sincronizar → RECHAZADA con motivo visible", async ({
    page,
    context,
  }) => {
    const codigo = await codigoDe("Elf Bar BC5000", "Lemon Mint"); // sin stock en Galpón 1 (seed)
    await loginDueno(page);
    await page.goto("/escanear?modo=transferir");
    await esperarCatalogoOffline(page);
    await page.getByLabel("Origen").selectOption({ label: "Galpón 1" });
    await page.getByLabel("Destino").selectOption({ label: "Galpón 2" });

    await context.setOffline(true);
    await soltarFoco(page);
    await pistola(page, codigo);
    await page.getByRole("button", { name: /Crear transferencia \(1 u\.\)/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Crear", exact: true }).click();
    await expect(page.getByText("Guardado sin conexión")).toBeVisible();
    const [op] = await leerCola(page);

    await context.setOffline(false);
    const pendientes = page.getByLabel("Pendientes de sincronización");
    await expect(pendientes.getByTestId("motivo-rechazo")).toContainText(/Stock insuficiente/i, {
      timeout: 30_000,
    });
    await expect(pendientes.locator('[data-estado="RECHAZADA"]')).toHaveCount(1);
    const fila = await db.operacionSincronizada.findUniqueOrThrow({
      where: { idOperacion: op!.idOperacion },
    });
    expect(fila.estado).toBe("RECHAZADA");
    expect(fila.motivo).toMatch(/Stock insuficiente/i);
    // Nunca se descarta sola: sigue en la cola hasta que alguien decida.
    expect((await leerCola(page)).map((o) => o.estado)).toEqual(["RECHAZADA"]);
  });
});
