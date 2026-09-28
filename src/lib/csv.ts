/**
 * CSV sin dependencias, pensado para planillas que se abren con Excel argentino:
 * UTF-8 con BOM (Excel detecta el encoding), separador ";" y comillas RFC 4180
 * en los campos con separador, comillas ("") o saltos de línea.
 */

export type Separador = ";" | ",";

function escaparCelda(valor: string, separador: Separador): string {
  return /["\r\n]/.test(valor) || valor.includes(separador)
    ? `"${valor.replace(/"/g, '""')}"`
    : valor;
}

/** Genera CSV con BOM (Excel detecta UTF-8) y ";" (separador de Excel es-AR). */
export function aCSV(
  filas: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
  separador: Separador = ";",
): string {
  const cuerpo = filas
    .map((f) =>
      f
        .map((c) => escaparCelda(c === null || c === undefined ? "" : String(c), separador))
        .join(separador),
    )
    .join("\r\n");
  return `﻿${cuerpo}\r\n`;
}
