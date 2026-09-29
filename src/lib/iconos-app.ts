/** sharp se carga recién al generar un ícono (binario nativo, pesado). */
const cargarSharp = async () => (await import("sharp")).default;

/**
 * Íconos de la app a partir de UNA imagen cuadrada (la portada de la marca o la que suba
 * el dueño). Lo usan `pnpm iconos` (archivos en /public) y la ruta /icons/[size]
 * (ícono propio del negocio, guardado en el storage).
 */
/** Fondo de íconos y splash: blanco, como la portada de la marca. */
export const COLOR_MARCA = "#ffffff";
export const FONDO_SPLASH = "#ffffff";

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
    // Zona segura de Android: el dibujo ocupa el 80 % central sobre fondo blanco.
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
  // Portada centrada: ~70 % del lado menor, sobre blanco.
  const lado = Math.round(Math.min(ancho, alto) * 0.7);
  const icono = await sharp(base)
    .resize(lado, lado, { fit: "contain", background: FONDO_SPLASH })
    .flatten({ background: FONDO_SPLASH })
    .png()
    .toBuffer();
  return sharp({ create: { width: ancho, height: alto, channels: 4, background: FONDO_SPLASH } })
    .composite([{ input: icono, gravity: "center" }])
    .png()
    .toBuffer();
}
