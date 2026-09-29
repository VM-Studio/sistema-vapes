/** sharp se carga recién al generar un ícono (binario nativo, pesado). */
const cargarSharp = async () => (await import("sharp")).default;

/**
 * Íconos de la app a partir de UNA imagen cuadrada (el SVG base o la que suba
 * el dueño). Lo usan `pnpm iconos` (archivos en /public) y la ruta /icons/[size]
 * (ícono propio del negocio, guardado en el storage).
 */
export const COLOR_MARCA = "#4338ca";
export const FONDO_SPLASH = "#f5f5f7";

export type VarianteIcono = "192" | "512" | "maskable" | "apple" | "favicon";

export const TAMANO: Record<VarianteIcono, number> = {
  "192": 192,
  "512": 512,
  maskable: 512,
  apple: 180,
  favicon: 32,
};

export async function generarIcono(
  base: Uint8Array | Buffer,
  variante: VarianteIcono,
): Promise<Buffer> {
  const sharp = await cargarSharp();
  const lado = TAMANO[variante];
  if (variante === "maskable") {
    // Zona segura de Android: el dibujo ocupa el 80 % central sobre el color de marca.
    const interior = Math.round(lado * 0.8);
    const dibujo = await sharp(base)
      .resize(interior, interior, { fit: "contain", background: COLOR_MARCA })
      .png()
      .toBuffer();
    return sharp({ create: { width: lado, height: lado, channels: 4, background: COLOR_MARCA } })
      .composite([{ input: dibujo, gravity: "center" }])
      .png()
      .toBuffer();
  }
  // iOS pone sus propias esquinas y no admite transparencia: fondo sólido.
  return sharp(base)
    .resize(lado, lado, { fit: "contain", background: COLOR_MARCA })
    .flatten({ background: COLOR_MARCA })
    .png()
    .toBuffer();
}

export async function generarSplash(
  base: Uint8Array | Buffer,
  ancho: number,
  alto: number,
): Promise<Buffer> {
  const sharp = await cargarSharp();
  const lado = Math.round(Math.min(ancho, alto) * 0.28);
  const icono = await generarIcono(base, "512").then((b) =>
    sharp(b).resize(lado, lado).png().toBuffer(),
  );
  return sharp({ create: { width: ancho, height: alto, channels: 4, background: FONDO_SPLASH } })
    .composite([{ input: icono, gravity: "center" }])
    .png()
    .toBuffer();
}
