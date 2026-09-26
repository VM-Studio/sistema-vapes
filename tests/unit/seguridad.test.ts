// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { construirCsp } from "@/server/seguridad/csp";
import { detectarTipo, procesarImagenSubida } from "@/server/seguridad/archivos";
import { estimarVentanaDeslizante } from "@/server/seguridad/rate-limit";
import { esPasswordComun } from "@/server/auth/password";

describe("CSP", () => {
  const csp = construirCsp({
    nonce: "abc",
    dev: false,
    storage: ["https://pub.r2.dev/x", "https://acc.r2.cloudflarestorage.com"],
    https: true,
  });
  it("scripts solo con nonce + strict-dynamic, sin unsafe-inline ni unsafe-eval", () => {
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic'");
  });
  it("cámara (blob:) y storage permitidos; frames y objetos no", () => {
    expect(csp).toContain("media-src 'self' blob:");
    expect(csp).toContain(
      "img-src 'self' data: blob: https://pub.r2.dev https://acc.r2.cloudflarestorage.com",
    );
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });
  it("en desarrollo permite eval (React Refresh) y no fuerza https", () => {
    const dev = construirCsp({ nonce: "n", dev: true, storage: [] });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });
});

describe("rate limit (ventana deslizante)", () => {
  it("al empezar el minuto pesa casi toda la ventana anterior; al final, nada", () => {
    expect(estimarVentanaDeslizante(10, 300, 0)).toBe(310);
    expect(estimarVentanaDeslizante(10, 300, 30_000)).toBe(160);
    expect(estimarVentanaDeslizante(10, 300, 60_000)).toBe(10);
  });
});

describe("archivos subidos: tipo real por magic bytes", () => {
  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]); // "MZ": ejecutable de Windows
  it("reconoce PNG, JPEG, WebP y PDF; un .exe no es nada de eso", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#f00" } })
      .png()
      .toBuffer();
    const jpg = await sharp(png).jpeg().toBuffer();
    const webp = await sharp(png).webp().toBuffer();
    expect(detectarTipo(png)).toBe("image/png");
    expect(detectarTipo(jpg)).toBe("image/jpeg");
    expect(detectarTipo(webp)).toBe("image/webp");
    expect(detectarTipo(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    expect(detectarTipo(exe)).toBeNull();
  });
  it("un .exe renombrado a .jpg se rechaza", async () => {
    await expect(procesarImagenSubida(exe, { campo: "comprobante" })).rejects.toThrow(
      /no es una imagen/,
    );
  });
  it("una foto se re-codifica sin EXIF (marca, modelo, ubicación) y se achica", async () => {
    const conExif = await sharp({
      create: { width: 3000, height: 1000, channels: 3, background: "#0a0" },
    })
      .jpeg()
      .withExif({ IFD0: { Make: "CelularEspia", Model: "X", Copyright: "GPS -34.6,-58.4" } })
      .toBuffer();
    expect((await sharp(conExif).metadata()).exif).toBeDefined();
    const limpia = await procesarImagenSubida(conExif);
    const meta = await sharp(limpia.datos).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(2000);
    expect(limpia.tipo).toBe("image/jpeg");
  });
  it("más de 5 MB se rechaza sin procesar", async () => {
    await expect(procesarImagenSubida(new Uint8Array(5 * 1024 * 1024 + 1))).rejects.toThrow(/5 MB/);
  });
});

describe("contraseñas comunes (top 10.000)", () => {
  it("rechaza las más usadas, sin importar mayúsculas", () => {
    for (const p of ["password", "123456", "qwerty", "PassWord1"])
      expect(esPasswordComun(p)).toBe(true);
    expect(esPasswordComun("VapesGalpon2026!")).toBe(false);
  });
});
