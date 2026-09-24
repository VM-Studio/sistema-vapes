/** Formato aceptado para códigos de barras (mismo regex que el CHECK en la DB). */
export const CODIGO_BARRAS_REGEX = /^[0-9A-Za-z-]{4,64}$/;

/** Normaliza lo que manda una pistola lectora o la cámara: trim y sin espacios internos. */
export function normalizarCodigoBarras(codigo: string): string {
  return codigo.replace(/\s+/g, "");
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
