import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  convertirConCotizacion,
  estaDesactualizada,
  fechaHoraCotizacion,
  horaCotizacion,
  formatearDual,
  formatearEquivalente,
} from "@/lib/cambio";
import {
  ErrorFormatoFuente,
  FUENTES,
  parsearCriptoyaBlue,
  parsearCriptoyaDolarUsdt,
  parsearCriptoyaUsdtArs,
  parsearDolarApi,
  resolverCotizacion,
  validarRango,
} from "@/server/cambio/fuentes";
import {
  elegirVigente,
  necesitaActualizar,
  parsearFrecuencia,
  parsearOverride,
} from "@/server/cambio/vigente";

const fixture = (nombre: string): unknown =>
  JSON.parse(readFileSync(path.join(__dirname, "../fixtures/cambio", nombre), "utf8"));

const nbsp = (s: string) => s.replace(/ /g, " ");

describe("parsers de fuentes (respuestas grabadas 11/10/2026)", () => {
  it("dolarapi blue: compra y venta", () => {
    expect(parsearDolarApi(fixture("dolarapi-blue.json"), "dolarapi")).toEqual({
      VENTA: 1540,
      COMPRA: 1520,
    });
  });

  it("dolarapi cripto: compra y venta", () => {
    expect(parsearDolarApi(fixture("dolarapi-cripto.json"), "dolarapi")).toEqual({
      VENTA: 1604.39,
      COMPRA: 1600.75,
    });
  });

  it("criptoya dolar: blue (ask = venta, bid = compra)", () => {
    expect(parsearCriptoyaBlue(fixture("criptoya-dolar.json"), "criptoya")).toEqual({
      VENTA: 1540,
      COMPRA: 1520,
    });
  });

  it("criptoya dolar: cripto.usdt", () => {
    expect(parsearCriptoyaDolarUsdt(fixture("criptoya-dolar.json"), "criptoya")).toEqual({
      VENTA: 1611.208,
      COMPRA: 1611.81,
    });
  });

  it("criptoya usdt/ars: promedio de totalAsk de los principales, ignora sin oferta y no listados", () => {
    const json = fixture("criptoya-usdt-ars.json") as Record<string, { totalAsk: number }>;
    const r = parsearCriptoyaUsdtArs(json, "criptoya");
    const principales = [
      "binance",
      "binancep2p",
      "lemoncash",
      "belo",
      "fiwind",
      "letsbit",
      "ripio",
      "bybitp2p",
      "okexp2p",
    ];
    const esperado =
      principales.map((k) => json[k]!.totalAsk).reduce((a, b) => a + b, 0) / principales.length;
    expect(r.VENTA).toBeCloseTo(esperado, 2);
    // huobip2p (ask 0) y universalcoins (no principal) no entran
    expect(r.VENTA).toBeLessThan(1630);
  });

  it("forma inesperada → ErrorFormatoFuente con el campo que falta", () => {
    expect(() => parsearDolarApi({ compra: 1 }, "dolarapi.com/blue")).toThrow(ErrorFormatoFuente);
    expect(() => parsearDolarApi({ compra: 1 }, "dolarapi.com/blue")).toThrow(/venta/);
    expect(() => parsearCriptoyaBlue({ oficial: {} }, "criptoya")).toThrow(/"blue"/);
    expect(() => parsearCriptoyaDolarUsdt({ cripto: {} }, "criptoya")).toThrow(/cripto\.usdt/);
    expect(() => parsearCriptoyaUsdtArs({ otro: { totalAsk: 1 } }, "criptoya")).toThrow(
      /ningún exchange/,
    );
    expect(() => parsearDolarApi([], "x")).toThrow(ErrorFormatoFuente);
  });
});

describe("validación de rango", () => {
  it("> 0 y menos de 10× el anterior, en los dos sentidos", () => {
    expect(validarRango(1540, 1500)).toBeNull();
    expect(validarRango(1540, null)).toBeNull();
    expect(validarRango(0, 1500)).toMatch(/no positivo/);
    expect(validarRango(-5, null)).toMatch(/no positivo/);
    expect(validarRango(15000, 1500)).toMatch(/fuera de rango/);
    expect(validarRango(150, 1500)).toMatch(/fuera de rango/);
  });
});

describe("resolverCotizacion: orden y fallback", () => {
  const datos: Record<string, unknown> = {
    "https://dolarapi.com/v1/dolares/blue": fixture("dolarapi-blue.json"),
    "https://criptoya.com/api/dolar": fixture("criptoya-dolar.json"),
    "https://criptoya.com/api/usdt/ars/1": fixture("criptoya-usdt-ars.json"),
    "https://dolarapi.com/v1/dolares/cripto": fixture("dolarapi-cripto.json"),
  };
  const ok = (url: string) => Promise.resolve(datos[url]);

  it("usa la primera fuente que responde", async () => {
    const r = await resolverCotizacion(FUENTES.USD_BLUE, ok, 1500);
    expect(r).toMatchObject({ ok: true, fuente: "dolarapi.com/blue", valores: { VENTA: 1540 } });
  });

  it("si la primera se cae (timeout), pasa a la siguiente y registra el intento", async () => {
    const r = await resolverCotizacion(
      FUENTES.USD_BLUE,
      (url) =>
        url.includes("dolarapi")
          ? Promise.reject(new Error("The operation was aborted due to timeout"))
          : ok(url),
      1500,
    );
    expect(r.ok && r.fuente).toBe("criptoya.com/dolar");
    expect(r.intentos).toEqual([
      { fuente: "dolarapi.com/blue", error: expect.stringMatching(/timeout/) },
    ]);
  });

  it("si la primera cambió de formato, cae en la siguiente", async () => {
    const r = await resolverCotizacion(
      FUENTES.USDT,
      (url) =>
        url === "https://criptoya.com/api/dolar" ? Promise.resolve({ cripto: {} }) : ok(url),
      1600,
    );
    expect(r.ok && r.fuente).toBe("criptoya.com/usdt");
    expect(r.intentos[0]!.error).toMatch(/Formato inesperado de criptoya\.com\/dolar/);
  });

  it("descarta un valor fuera de rango y prueba la siguiente", async () => {
    const r = await resolverCotizacion(
      FUENTES.USD_BLUE,
      (url) => (url.includes("dolarapi") ? Promise.resolve({ compra: 15, venta: 15 }) : ok(url)),
      1500,
    );
    expect(r).toMatchObject({ ok: true, fuente: "criptoya.com/dolar", valores: { VENTA: 1540 } });
    expect(r.intentos[0]!.error).toMatch(/fuera de rango/);
  });

  it("todas caídas → ok false con cada intento (queda la última válida)", async () => {
    const r = await resolverCotizacion(
      FUENTES.USDT,
      () => Promise.reject(new Error("HTTP 503")),
      1600,
    );
    expect(r.ok).toBe(false);
    expect(r.intentos.map((i) => i.fuente)).toEqual([
      "criptoya.com/dolar",
      "criptoya.com/usdt",
      "dolarapi.com/cripto",
    ]);
  });
});

describe("cotización vigente: override y desactualizada", () => {
  const ahora = new Date("2026-10-11T18:00:00Z");
  const ultima = {
    valor: 1540,
    fuente: "dolarapi.com/blue",
    obtenidoAt: new Date("2026-10-11T17:50:00Z"),
  };

  it("sin override: la última automática", () => {
    expect(elegirVigente("USD_BLUE", "VENTA", null, ultima, ahora)).toMatchObject({
      valor: 1540,
      fuente: "dolarapi.com/blue",
      esManual: false,
      desactualizada: false,
    });
  });

  it("el override manual pisa a la automática y guarda quién y cuándo", () => {
    const override = parsearOverride({
      valor: 1600,
      usuarioId: "u1",
      usuarioNombre: "Juan Cruz",
      cargadoAt: "2026-10-11T12:00:00.000Z",
    });
    expect(elegirVigente("USD_BLUE", "VENTA", override, ultima, ahora)).toMatchObject({
      valor: 1600,
      esManual: true,
      fuente: "Manual",
      cargadaPor: "Juan Cruz",
      obtenidoAt: "2026-10-11T12:00:00.000Z",
      desactualizada: false,
    });
  });

  it("override inválido se ignora", () => {
    expect(parsearOverride({ valor: 0 })).toBeNull();
    expect(parsearOverride("1500")).toBeNull();
    expect(parsearOverride(null)).toBeNull();
  });

  it("más de 2 h sin actualizar → desactualizada", () => {
    const vieja = { ...ultima, obtenidoAt: new Date("2026-10-11T15:59:00Z") };
    expect(elegirVigente("USDT", "VENTA", null, vieja, ahora)?.desactualizada).toBe(true);
    expect(estaDesactualizada(new Date("2026-10-11T16:01:00Z"), ahora)).toBe(false);
  });

  it("sin datos ni override → null", () => {
    expect(elegirVigente("USDT", "VENTA", null, null, ahora)).toBeNull();
  });

  it("actualización perezosa según la frecuencia", () => {
    expect(necesitaActualizar(null, 15, ahora)).toBe(true);
    expect(necesitaActualizar(new Date("2026-10-11T17:50:00Z"), 15, ahora)).toBe(false);
    expect(necesitaActualizar(new Date("2026-10-11T17:45:00Z"), 15, ahora)).toBe(true);
    expect(parsearFrecuencia(30)).toBe(30);
    expect(parsearFrecuencia("x")).toBe(15);
    expect(parsearFrecuencia(1)).toBe(15);
  });
});

describe("conversión y formato", () => {
  it("convertir redondea a pesos enteros", () => {
    expect(convertirConCotizacion(150, 1300)).toBe(195000);
    expect(convertirConCotizacion(1.5, 1611.21)).toBe(2417);
  });

  it("formatearDual", () => {
    expect(nbsp(formatearDual(1200, "USD_BLUE", 1300))).toBe("U$D 1.200 · $ 1.560.000");
    expect(nbsp(formatearDual(150, "USDT", 1300))).toBe("150 USDT · $ 195.000");
    expect(nbsp(formatearDual(12.5, "USD_BLUE", 1000))).toBe("U$D 12,50 · $ 12.500");
    expect(formatearDual(150, "USDT", null)).toBe("150 USDT");
    expect(nbsp(formatearEquivalente(150, 1300) ?? "")).toBe("≈ $ 195.000");
  });

  it("hora de la cotización en 24 h, hora argentina", () => {
    expect(horaCotizacion("2026-10-12T01:49:00Z")).toBe("22:49");
    expect(fechaHoraCotizacion("2026-10-11T18:30:00Z")).toBe("11/10 15:30");
  });
});
