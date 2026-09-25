import type { VarianteEncontrada } from "@/server/services/producto.service";

/** Lo que recibe la UI al escanear (el costo solo viaja a quien puede verlo). */
export type VarianteEscaneada = Omit<VarianteEncontrada, "precioCosto"> & {
  precioCosto: string | null;
};

export type ResultadoResolucion =
  { encontrado: true; variante: VarianteEscaneada } | { encontrado: false; codigo: string };
