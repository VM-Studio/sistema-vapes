import { describe, expect, it } from "vitest";

import {
  crearClienteSchema,
  mostrarTelefono,
  linkWhatsApp,
  normalizarTelefono,
  TELEFONO_NORMALIZADO,
  telefonoValido,
} from "@/lib/validations/cliente";
import { formatearIdDevolucion } from "@/lib/validations/devolucion";

/** Mismos casos que fn_normalizar_telefono (SQL): la app y la DB tienen que coincidir. */
describe("normalizarTelefono", () => {
  it.each([
    ["11 5555-1234", "+541155551234"],
    ["(011) 15 5555-1234", "+54111555551234"],
    ["011 5555 1234", "+541155551234"],
    ["+54 9 11 5555-1234", "+5491155551234"],
    ["54 9 11 5555 1234", "+5491155551234"],
    ["0054 9 11 5555 1234", "+5491155551234"],
    ["5491155551234", "+5491155551234"],
    ["351 123 4567", "+543511234567"],
    ["5411555", "+545411555"],
    ["541155551234", "+541155551234"],
  ])("%s → %s", (entrada, esperado) => {
    expect(normalizarTelefono(entrada)).toBe(esperado);
  });

  it("vacío, solo símbolos o solo ceros → null", () => {
    expect(normalizarTelefono("")).toBeNull();
    expect(normalizarTelefono("   ")).toBeNull();
    expect(normalizarTelefono("-()+")).toBeNull();
    expect(normalizarTelefono("000")).toBeNull();
    expect(normalizarTelefono(null)).toBeNull();
    expect(normalizarTelefono(undefined)).toBeNull();
  });

  it("es idempotente", () => {
    for (const t of ["11 5555-1234", "+54 9 11 5555-1234", "351 123 4567"]) {
      const una = normalizarTelefono(t);
      expect(normalizarTelefono(una)).toBe(una);
    }
  });

  it("el resultado cumple el CHECK de la DB", () => {
    expect(TELEFONO_NORMALIZADO.test(normalizarTelefono("11 5555-1234")!)).toBe(true);
    expect(TELEFONO_NORMALIZADO.test(normalizarTelefono("+54 9 11 5555-1234")!)).toBe(true);
  });
});

describe("crearClienteSchema.telefono", () => {
  const base = { nombre: "Ana" };

  it("normaliza antes de guardar", () => {
    const r = crearClienteSchema.parse({ ...base, telefono: "011 15-5555-1234" });
    expect(r.telefono).toBe("+54111555551234");
  });

  it("es obligatorio", () => {
    expect(crearClienteSchema.safeParse({ ...base, telefono: "" }).success).toBe(false);
    expect(crearClienteSchema.safeParse({ ...base, telefono: "  -  " }).success).toBe(false);
    expect(crearClienteSchema.safeParse(base).success).toBe(false);
  });

  it("rechaza números demasiado cortos o largos", () => {
    expect(crearClienteSchema.safeParse({ ...base, telefono: "1234" }).success).toBe(false);
    expect(crearClienteSchema.safeParse({ ...base, telefono: "12345678901234567" }).success).toBe(
      false,
    );
  });
});

describe("telefonoValido / mostrarTelefono / linkWhatsApp", () => {
  it("telefonoValido normaliza o devuelve null", () => {
    expect(telefonoValido("11 5555-1234")).toBe("+541155551234");
    expect(telefonoValido("1234")).toBeNull();
    expect(telefonoValido("")).toBeNull();
  });

  it("formatea para mostrar", () => {
    expect(mostrarTelefono("+541155551234")).toBe("+54 11 5555 1234");
    expect(mostrarTelefono("+5491155551234")).toBe("+54 9 11 5555 1234");
    expect(mostrarTelefono("+54351123")).toBe("+54351123");
  });

  it("link de WhatsApp solo con dígitos", () => {
    expect(linkWhatsApp("+541155551234")).toBe("https://wa.me/541155551234");
  });
});

describe("formatearIdDevolucion", () => {
  it("VAP-D-000001", () => {
    expect(formatearIdDevolucion("vapes", 1)).toBe("VAP-D-000001");
    expect(formatearIdDevolucion("cosmetic", 1234)).toBe("COS-D-001234");
  });
});
