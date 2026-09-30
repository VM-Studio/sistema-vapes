/**
 * Genera los assets de marca de la app. Uso: pnpm iconos
 *
 * Desde public/portadaApp.png (osito + "BISSCHEN" sobre blanco):
 *   - public/icons/icon-{192,512,maskable,apple,favicon}.png (los sirve /icons/[size]
 *     cuando el negocio no subió un ícono propio en /configuracion/negocio)
 *   - public/splash/splash-WxH.png (pantallas de inicio de iOS, iPhone y iPad)
 *   - public/screenshots/portada-{ancha,angosta}.png (screenshots del manifest)
 *   - src/app/opengraph-image.png (1200x630)
 *
 * Desde public/brand/favicon-fuente.png (el osito en el círculo, fondo
 * transparente y recortado al borde del aro: así ocupa toda la pestaña), con
 * la convención de metadata de Next (reemplaza a metadata.icons):
 *   - src/app/favicon.ico (ICO real: 16/32/48 con entradas PNG)
 *   - src/app/icon1.png (32) · icon2.png (192) · icon3.png (512)
 *   - src/app/apple-icon.png (180, fondo blanco sólido)
 *
 * Para cambiar la marca: reemplazar esas dos imágenes y volver a correrlo.
 */
import { mkdir, writeFile } from "node:fs/promises";

import sharp from "sharp";

import { generarIcono, generarSplash, type VarianteIcono } from "../src/lib/iconos-app";

const BLANCO = "#ffffff";

/** [ancho, alto] en píxeles físicos. Mantener en sincronía con SPLASH de src/app/layout.tsx. */
const SPLASH = [
  // iPhone
  [640, 1136], // SE (1.ª gen), 5s
  [750, 1334], // SE 2/3, 8, 7, 6s
  [828, 1792], // XR, 11
  [1125, 2436], // X, XS, 11 Pro, 12/13 mini
  [1170, 2532], // 12, 13, 14, 12/13 Pro
  [1179, 2556], // 14 Pro, 15, 15 Pro, 16
  [1242, 2688], // XS Max, 11 Pro Max
  [1284, 2778], // 12/13 Pro Max, 14 Plus
  [1290, 2796], // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  // iPad
  [1536, 2048], // iPad 9.7", mini 7.9"
  [1668, 2224], // iPad Pro 10.5", Air 3
  [1668, 2388], // iPad Pro 11"
  [2048, 2732], // iPad Pro 12.9"
] as const;

/** Contenedor ICO con entradas PNG (válido desde Windows Vista y en todos los navegadores). */
function armarIco(pngs: { lado: number; datos: Buffer }[]): Buffer {
  const cabecera = Buffer.alloc(6);
  cabecera.writeUInt16LE(0, 0); // reservado
  cabecera.writeUInt16LE(1, 2); // tipo 1 = ícono
  cabecera.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entradas = pngs.map(({ lado, datos }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(lado >= 256 ? 0 : lado, 0); // ancho (0 = 256)
    e.writeUInt8(lado >= 256 ? 0 : lado, 1); // alto
    e.writeUInt8(0, 2); // colores de paleta
    e.writeUInt8(0, 3); // reservado
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por píxel
    e.writeUInt32LE(datos.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += datos.length;
    return e;
  });
  return Buffer.concat([cabecera, ...entradas, ...pngs.map((p) => p.datos)]);
}

/**
 * Las fuentes traen el "blanco" con ruido (#fefefe, #fcfcfb...): se nota como un
 * recuadro sobre el blanco puro del lienzo. Todo lo casi blanco pasa a #ffffff.
 */
async function limpiarFondo(archivo: string): Promise<Buffer> {
  const { data, info } = await sharp(archivo)
    .flatten({ background: BLANCO })
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i]! >= 240 && data[i + 1]! >= 240 && data[i + 2]! >= 240) {
      data[i] = data[i + 1] = data[i + 2] = 255;
    }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

/** Recorta el margen blanco del osito y deja un aire mínimo para que se lea a 16 px. */
async function osito(fuente: Buffer): Promise<Buffer> {
  const recortado = await sharp(fuente).trim({ background: BLANCO, threshold: 20 }).toBuffer();
  const { width = 0, height = 0 } = await sharp(recortado).metadata();
  const aire = Math.round(Math.max(width, height) * 0.03);
  return sharp(recortado)
    .extend({ top: aire, bottom: aire, left: aire, right: aire, background: BLANCO })
    .png()
    .toBuffer();
}

/** Arte plano: paleta de 8 bits sin pérdida visible, ~70 % menos peso. */
const liviano = async (png: Promise<Buffer>) =>
  sharp(await png)
    .png({ palette: true, quality: 90, compressionLevel: 9 })
    .toBuffer();

const cuadrado = (base: Buffer, lado: number) =>
  sharp(base)
    .resize(lado, lado, { fit: "contain", background: BLANCO })
    .flatten({ background: BLANCO })
    .png({ compressionLevel: 9 })
    .toBuffer();

/** Cuadrado con fondo transparente (favicon e íconos de pestaña). */
const transparente = (base: Buffer, lado: number) =>
  sharp(base)
    .resize(lado, lado, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();

async function main() {
  const portada = await limpiarFondo("public/portadaApp.png");
  for (const dir of ["public/icons", "public/splash", "public/screenshots"])
    await mkdir(dir, { recursive: true });

  for (const v of ["192", "512", "maskable", "apple", "favicon"] as VarianteIcono[]) {
    await writeFile(`public/icons/icon-${v}.png`, await generarIcono(portada, v));
  }
  for (const [w, h] of SPLASH) {
    await writeFile(
      `public/splash/splash-${w}x${h}.png`,
      await liviano(generarSplash(portada, w, h)),
    );
  }
  await writeFile(
    "public/screenshots/portada-ancha.png",
    await liviano(generarSplash(portada, 1280, 720)),
  );
  await writeFile(
    "public/screenshots/portada-angosta.png",
    await liviano(generarSplash(portada, 750, 1334)),
  );
  await writeFile("src/app/opengraph-image.png", await liviano(generarSplash(portada, 1200, 630)));

  // Pestaña del navegador: transparente y sin margen (el aro toca el borde).
  const fav = await sharp("public/brand/favicon-fuente.png").ensureAlpha().png().toBuffer();
  const ico = await Promise.all(
    // Los decodificadores de ICO (el de Next incluido) exigen PNG RGBA de 32 bits.
    [16, 32, 48].map(async (lado) => ({ lado, datos: await transparente(fav, lado) })),
  );
  await writeFile("src/app/favicon.ico", armarIco(ico));
  await writeFile("src/app/icon1.png", await transparente(fav, 32));
  await writeFile("src/app/icon2.png", await transparente(fav, 192));
  await writeFile("src/app/icon3.png", await transparente(fav, 512));
  // iOS pinta de negro lo transparente: el ícono de Apple va sobre blanco, con aire.
  await writeFile(
    "src/app/apple-icon.png",
    await cuadrado(await osito(await limpiarFondo("public/brand/favicon-fuente.png")), 180),
  );

  console.log(
    `Generados: public/icons (5), public/splash (${SPLASH.length}), public/screenshots (2), ` +
      "src/app/{favicon.ico,icon1-3.png,apple-icon.png,opengraph-image.png}",
  );
}

void main();
