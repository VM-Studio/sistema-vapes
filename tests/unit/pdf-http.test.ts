import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = {
  leer: vi.fn<(clave: string) => Promise<{ datos: Uint8Array; tipo: string } | null>>(),
  guardar: vi.fn<(clave: string, datos: Uint8Array, tipo: string) => Promise<string>>(),
};
vi.mock("@/server/storage", () => ({ obtenerStorage: () => storage }));
vi.mock("@/server/log", () => ({ logger: () => ({ warn: vi.fn() }) }));
vi.mock("@/env", () => ({ obtenerEnv: () => ({ AUTH_SECRET: "x".repeat(40) }) }));

const {
  clavePdf,
  pdfCacheado,
  respuestaPdf,
  rutaPublicaPdf,
  verificarLinkPublico,
  firmaLinkPublico,
} = await import("@/server/pdf-http");
const { esClaveValida } =
  await vi.importActual<typeof import("@/server/storage")>("@/server/storage");

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

describe("pdfCacheado", () => {
  beforeEach(() => {
    storage.leer.mockReset();
    storage.guardar.mockReset();
  });

  it("si está en el caché no lo vuelve a generar", async () => {
    storage.leer.mockResolvedValue({ datos: PDF, tipo: "application/pdf" });
    const generar = vi.fn(async () => new Uint8Array([1]));
    expect(await pdfCacheado("pdf/a/b/c-1.pdf", generar)).toBe(PDF);
    expect(generar).not.toHaveBeenCalled();
  });

  it("si no está, lo genera y lo guarda", async () => {
    storage.leer.mockResolvedValue(null);
    storage.guardar.mockResolvedValue("/x");
    expect(await pdfCacheado("pdf/a/b/c-1.pdf", async () => PDF)).toBe(PDF);
    expect(storage.guardar).toHaveBeenCalledWith("pdf/a/b/c-1.pdf", PDF, "application/pdf");
  });

  it("con el storage de solo lectura (Vercel + local) igual entrega el PDF", async () => {
    storage.leer.mockRejectedValue(new Error("EACCES"));
    storage.guardar.mockRejectedValue(
      Object.assign(new Error("EROFS: read-only file system, mkdir '/var/task/.storage/pdf'"), {
        code: "EROFS",
      }),
    );
    expect(await pdfCacheado("pdf/a/b/c-1.pdf", async () => PDF)).toBe(PDF);
  });

  it("si falla la generación, el error sube (no se cachea nada)", async () => {
    storage.leer.mockResolvedValue(null);
    await expect(
      pdfCacheado("pdf/a/b/c-1.pdf", async () => {
        throw new Error("roto");
      }),
    ).rejects.toThrow("roto");
    expect(storage.guardar).not.toHaveBeenCalled();
  });
});

describe("clavePdf", () => {
  it("es una clave válida del storage y cambia con la firma", () => {
    const a = clavePdf("cotizacion", "pnl_vapes", "ckx1", { estado: "BORRADOR" });
    const b = clavePdf("cotizacion", "pnl_vapes", "ckx1", { estado: "ENVIADA" });
    expect(esClaveValida(a)).toBe(true);
    expect(esClaveValida(clavePdf("recibo", "pnl_vapes", "cob_1a2b-3c", {}))).toBe(true);
    expect(a).not.toBe(b);
    expect(clavePdf("cotizacion", "pnl_vapes", "ckx1", { estado: "BORRADOR" })).toBe(a);
  });
});

describe("respuestaPdf", () => {
  it("application/pdf, inline y sin caché HTTP", async () => {
    const r = respuestaPdf(PDF, "cotización VAP-Q-000001.pdf");
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-disposition")).toBe(
      'inline; filename="cotizacion-VAP-Q-000001.pdf"',
    );
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PDF);
  });
});

describe("links públicos firmados", () => {
  it("la firma valida solo para el mismo tipo, panel e id", () => {
    const f = firmaLinkPublico("cotizacion", "pnl_vapes", "abc");
    expect(verificarLinkPublico("cotizacion", "pnl_vapes", "abc", f)).toBe(true);
    expect(verificarLinkPublico("remito", "pnl_vapes", "abc", f)).toBe(false);
    expect(verificarLinkPublico("cotizacion", "pnl_cosmetic", "abc", f)).toBe(false);
    expect(verificarLinkPublico("cotizacion", "pnl_vapes", "abd", f)).toBe(false);
    expect(verificarLinkPublico("cotizacion", "pnl_vapes", "abc", "corta")).toBe(false);
    expect(rutaPublicaPdf("remito", "pnl_vapes", "t1")).toBe(
      `/api/publico/pdf/remito/pnl_vapes/t1/${firmaLinkPublico("remito", "pnl_vapes", "t1")}`,
    );
  });
});
