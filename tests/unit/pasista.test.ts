import { describe, expect, it } from "vitest";

import { marcarPagadasSchema } from "@/lib/validations/pasista";
import { fechaDeMes, mesActualAR, mesDeFecha } from "@/server/services/pasista.service";

describe("pasista: meses argentinos", () => {
  it("el mes actual es el de Argentina (UTC−3), no el de UTC", () => {
    expect(mesActualAR(new Date("2026-11-01T02:30:00Z"))).toBe("2026-10");
    expect(mesActualAR(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11");
  });

  it("YYYY-MM ↔ DATE del primer día", () => {
    expect(fechaDeMes("2026-10").toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(mesDeFecha(fechaDeMes("2026-01"))).toBe("2026-01");
  });
});

describe("marcarPagadasSchema", () => {
  it("acepta un mes o una lista de ids, con medio y fecha", () => {
    const porMes = marcarPagadasSchema.parse({
      mes: "2026-09",
      medioPago: "EFECTIVO",
      fecha: "2026-09-30",
    });
    expect("mes" in porMes && porMes.mes).toBe("2026-09");
    const porIds = marcarPagadasSchema.parse({
      ids: ["ckabc1234567890"],
      medioPago: "TRANSFERENCIA",
      referencia: " 0001 ",
      fecha: "2026-09-30",
    });
    expect("ids" in porIds && porIds.ids).toHaveLength(1);
    expect(porIds.referencia).toBe("0001");
  });

  it("rechaza sin medio, fecha futura o mes inválido", () => {
    expect(marcarPagadasSchema.safeParse({ mes: "2026-09", fecha: "2026-09-30" }).success).toBe(
      false,
    );
    expect(
      marcarPagadasSchema.safeParse({ mes: "2026-09", medioPago: "EFECTIVO", fecha: "2999-01-01" })
        .success,
    ).toBe(false);
    expect(
      marcarPagadasSchema.safeParse({ mes: "2026-13", medioPago: "EFECTIVO", fecha: "2026-09-30" })
        .success,
    ).toBe(false);
  });
});
