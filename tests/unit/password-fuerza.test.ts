import { describe, expect, it } from "vitest";

import { enmascararEmail, fuerzaPassword, requisitosPassword } from "@/lib/password-fuerza";
import {
  cambiarPasswordConCodigoSchema,
  codigoMailSchema,
  passwordNuevaSchema,
} from "@/lib/validations/usuario";

describe("requisitos y medidor de la contraseña nueva", () => {
  it("marca cada requisito de la política", () => {
    const cumple = (n: string, r: string) =>
      Object.fromEntries(requisitosPassword(n, r).map((x) => [x.id, x.cumple]));
    expect(cumple("", "")).toEqual({ largo: false, letra: false, numero: false, coinciden: false });
    expect(cumple("abcdefgh", "abcdefgh")).toEqual({
      largo: true,
      letra: true,
      numero: false,
      coinciden: true,
    });
    expect(cumple("Clave2026", "Clave2025")).toMatchObject({ numero: true, coinciden: false });
    expect(cumple("x".repeat(73) + "1", "")).toMatchObject({ largo: false });
  });

  it("la fuerza va de 0 (vacía) a 4", () => {
    expect(fuerzaPassword("")).toBe(0);
    expect(fuerzaPassword("abc")).toBe(1);
    expect(fuerzaPassword("abcdefgh")).toBe(1); // sin número: no cumple la política
    expect(fuerzaPassword("clave2026")).toBe(2);
    expect(fuerzaPassword("Clave2026")).toBe(3);
    expect(fuerzaPassword("lunes de sol 2026".replace(/ /g, ""))).toBe(3);
    expect(fuerzaPassword("Lunes-de-sol-2026")).toBe(4);
    // Largo sin variedad de caracteres no suma.
    expect(fuerzaPassword("aaaaaaaaaaaa1")).toBe(2);
  });

  it("enmascara el email al que fue el código", () => {
    expect(enmascararEmail("juan.perez@gmail.com")).toBe("ju••••••••@gmail.com");
    expect(enmascararEmail("ab@x.com")).toBe("a•••@x.com");
  });
});

describe("schemas del cambio con código", () => {
  it("el código acepta espacios o guiones al pegarlo, pero son 6 números", () => {
    expect(codigoMailSchema.parse({ codigo: " 123 456 " }).codigo).toBe("123456");
    expect(codigoMailSchema.parse({ codigo: "123-456" }).codigo).toBe("123456");
    expect(codigoMailSchema.safeParse({ codigo: "12345" }).success).toBe(false);
    expect(codigoMailSchema.safeParse({ codigo: "12345a" }).success).toBe(false);
    expect(codigoMailSchema.safeParse({ codigo: "1234567" }).success).toBe(false);
  });

  it("contraseña nueva: política y repetirla igual", () => {
    expect(
      passwordNuevaSchema.safeParse({ passwordNueva: "Clave2026", confirmacion: "Clave2026" })
        .success,
    ).toBe(true);
    const distinta = passwordNuevaSchema.safeParse({
      passwordNueva: "Clave2026",
      confirmacion: "Clave2027",
    });
    expect(distinta.error?.issues[0]?.path).toEqual(["confirmacion"]);
    expect(
      passwordNuevaSchema.safeParse({ passwordNueva: "corta1", confirmacion: "corta1" }).success,
    ).toBe(false);
  });

  it("la acción exige el token de verificación", () => {
    const base = { passwordNueva: "Clave2026", confirmacion: "Clave2026" };
    expect(cambiarPasswordConCodigoSchema.safeParse(base).success).toBe(false);
    expect(cambiarPasswordConCodigoSchema.safeParse({ ...base, token: "corto" }).success).toBe(
      false,
    );
    expect(
      cambiarPasswordConCodigoSchema.safeParse({ ...base, token: "t".repeat(43) }).success,
    ).toBe(true);
  });
});
