/**
 * Requisitos y medidor de la contraseña nueva (cliente y servidor). La política
 * que manda es el schema `password` de validations/usuario: esto solo la
 * muestra en vivo. La lista de contraseñas comunes se chequea en el servidor.
 */

export interface Requisito {
  id: "largo" | "letra" | "numero" | "coinciden";
  texto: string;
  cumple: boolean;
}

export function requisitosPassword(nueva: string, repetida: string): Requisito[] {
  return [
    { id: "largo", texto: "8 caracteres o más", cumple: nueva.length >= 8 && nueva.length <= 72 },
    { id: "letra", texto: "Al menos una letra", cumple: /\p{L}/u.test(nueva) },
    { id: "numero", texto: "Al menos un número", cumple: /\d/.test(nueva) },
    {
      id: "coinciden",
      texto: "Las dos coinciden",
      cumple: nueva.length > 0 && nueva === repetida,
    },
  ];
}

export type NivelFuerza = 0 | 1 | 2 | 3 | 4;

export const ETIQUETA_FUERZA: Record<NivelFuerza, string> = {
  0: "Sin cargar",
  1: "Débil",
  2: "Aceptable",
  3: "Buena",
  4: "Muy buena",
};

/**
 * 0 = vacía · 1 = no cumple la política · 2 = la cumple justo · 3 = 12+
 * caracteres o variedad (mayúsculas y minúsculas, símbolos) · 4 = las dos.
 */
export function fuerzaPassword(p: string): NivelFuerza {
  if (!p) return 0;
  const politica = p.length >= 8 && p.length <= 72 && /\p{L}/u.test(p) && /\d/.test(p);
  if (!politica) return 1;
  // Repetir un solo carácter o una secuencia trivial no suma por largo.
  const distintos = new Set(p).size;
  const largo = p.length >= 12 && distintos >= 6;
  const variedad =
    (/\p{Lu}/u.test(p) && /\p{Ll}/u.test(p) ? 1 : 0) + (/[^\p{L}\d]/u.test(p) ? 1 : 0);
  if (largo && variedad >= 1) return 4;
  if (largo || variedad >= 1) return 3;
  return 2;
}

/** "juan.perez@gmail.com" → "ju•••••••@gmail.com" (para decir a dónde fue el código). */
export function enmascararEmail(email: string): string {
  const [usuario = "", dominio = ""] = email.split("@");
  const visibles = usuario.length <= 2 ? 1 : 2;
  return `${usuario.slice(0, visibles)}${"•".repeat(Math.max(3, usuario.length - visibles))}@${dominio}`;
}
