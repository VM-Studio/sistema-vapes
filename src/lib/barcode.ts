/** Formato aceptado para códigos de barras (mismo regex que el CHECK en la DB). */
export const CODIGO_BARRAS_REGEX = /^[0-9A-Za-z-]{4,64}$/;

/**
 * Normaliza lo que manda una pistola lectora o la cámara: sin espacios y en
 * mayúsculas (los alfanuméricos). La DB exige esta forma (CHECK), así que la
 * búsqueda "case-insensitive" es una igualdad exacta que usa el índice.
 */
export function normalizarCodigoBarras(codigo: string): string {
  return codigo.replace(/\s+/g, "").toUpperCase();
}

/** Dígito verificador EAN-13 a partir de los primeros 12 dígitos. */
export function digitoVerificadorEan13(base12: string): number {
  if (!/^\d{12}$/.test(base12)) throw new Error(`EAN-13 requiere 12 dígitos base: "${base12}"`);
  const suma = [...base12].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (suma % 10)) % 10;
}

export function generarEan13(base12: string): string {
  return `${base12}${digitoVerificadorEan13(base12)}`;
}

export function esEan13Valido(codigo: string): boolean {
  return (
    /^\d{13}$/.test(codigo) && digitoVerificadorEan13(codigo.slice(0, 12)) === Number(codigo[12])
  );
}

/** Dígito verificador Luhn (mod 10) de una cadena de dígitos. */
export function digitoLuhn(digitos: string): number {
  if (!/^\d+$/.test(digitos)) throw new Error(`Luhn requiere dígitos: "${digitos}"`);
  let suma = 0;
  for (let i = 0; i < digitos.length; i++) {
    let d = Number(digitos[digitos.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    suma += d;
  }
  return (10 - (suma % 10)) % 10;
}
