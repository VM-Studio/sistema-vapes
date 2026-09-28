import type { VarianteEncontrada } from "@/server/services/producto.service";

/** Lo que recibe la UI al escanear (`precioCosto` es null salvo para los dueños). */
export type VarianteEscaneada = VarianteEncontrada;

export type ResultadoResolucion =
  { encontrado: true; variante: VarianteEscaneada } | { encontrado: false; codigo: string };
