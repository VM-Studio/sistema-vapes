import { randomInt } from "node:crypto";

import bcrypt from "bcryptjs";

import { password as passwordSchema } from "@/lib/validations/usuario";

const ROUNDS = 12;

/**
 * Hash con el mismo costo que los reales, para comparar contra algo cuando el
 * email no existe: la respuesta tarda lo mismo y no revela si el usuario existe.
 */
const HASH_SENUELO = bcrypt.hashSync("señuelo-para-igualar-tiempos", ROUNDS);

export function hashPassword(plano: string): Promise<string> {
  return bcrypt.hash(plano, ROUNDS);
}

/** Compara en tiempo constante. Con hash null usa el señuelo (y devuelve false). */
export async function verifyPassword(
  plano: string,
  hash: string | null | undefined,
): Promise<boolean> {
  const coincide = await bcrypt.compare(plano, hash ?? HASH_SENUELO);
  return hash != null && coincide;
}

/** Reglas: mínimo 8, al menos una letra y un número (mismo schema que los formularios). */
export function validarFortaleza(plano: string): { ok: true } | { ok: false; errores: string[] } {
  const r = passwordSchema.safeParse(plano);
  return r.success ? { ok: true } : { ok: false, errores: r.error.issues.map((i) => i.message) };
}

// Sin caracteres ambiguos (0/O, 1/l/I): la temporal se dicta o se copia a mano.
const LETRAS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITOS = "23456789";

/** Contraseña temporal de 12 caracteres con letras y números (cumple la política). */
export function generarPasswordTemporal(largo = 12): string {
  const todos = LETRAS + DIGITOS;
  const chars = [LETRAS[randomInt(LETRAS.length)]!, DIGITOS[randomInt(DIGITOS.length)]!];
  while (chars.length < largo) chars.push(todos[randomInt(todos.length)]!);
  // Fisher–Yates para que la letra y el dígito garantizados no queden al principio.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

// -----------------------------------------------------------------------------
// Contraseñas comunes (top 10.000 de SecLists, en passwords-comunes.txt)
// -----------------------------------------------------------------------------

let comunes: Set<string> | null = null;

function cargarComunes(): Set<string> {
  if (comunes) return comunes;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const texto = readFileSync(
    path.join(process.cwd(), "src/server/auth/passwords-comunes.txt"),
    "utf8",
  );
  comunes = new Set(
    texto
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean),
  );
  return comunes;
}

/** ¿Está en la lista de las 10.000 más usadas (sin distinguir mayúsculas)? */
export function esPasswordComun(plano: string): boolean {
  return cargarComunes().has(plano.trim().toLowerCase());
}

/** Lanza ValidationError en el campo indicado si la contraseña es de las más comunes. */
export async function assertPasswordNoComun(plano: string, campo: string): Promise<void> {
  if (esPasswordComun(plano)) {
    const { ValidationError } = await import("@/server/errors");
    throw new ValidationError(
      "Esa contraseña es de las más usadas y se adivina fácil: elegí otra.",
      {
        [campo]: ["Contraseña demasiado común"],
      },
    );
  }
}
