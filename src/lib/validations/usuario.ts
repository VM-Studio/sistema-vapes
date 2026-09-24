import { Modulo, RolUsuario } from "@prisma/client";
import { z } from "zod";

import { MODULOS_SOLO_OWNER, normalizarPermiso } from "@/lib/permisos";

import { email, id, texto } from "./common";

/** Mínimo 8 caracteres, al menos una letra y un número. Máximo 72 (límite de bcrypt). */
export const password = z
  .string()
  .min(8, "Mínimo 8 caracteres")
  .max(72, "Máximo 72 caracteres")
  .regex(/\p{L}/u, "Debe incluir al menos una letra")
  .regex(/\d/, "Debe incluir al menos un número");

export const permisoModuloSchema = z.object({
  modulo: z
    .enum(Modulo)
    .refine((m) => !MODULOS_SOLO_OWNER.has(m), "Este módulo es solo para dueños"),
  puedeVer: z.boolean().default(false),
  puedeCrear: z.boolean().default(false),
  puedeEditar: z.boolean().default(false),
  puedeEliminar: z.boolean().default(false),
});

export const crearUsuarioSchema = z.object({
  nombre: texto(100),
  email,
  rol: z.enum(RolUsuario),
  /** Contraseña inicial: el usuario deberá cambiarla en su primer ingreso. */
  password,
});

export const actualizarUsuarioSchema = z.object({
  id,
  nombre: texto(100),
  email,
  rol: z.enum(RolUsuario),
  activo: z.boolean(),
});

export const usuarioIdSchema = z.object({ id });

export const cambiarPasswordSchema = z
  .object({
    passwordActual: z.string().min(1, "Ingresá tu contraseña actual"),
    passwordNueva: password,
    confirmacion: z.string().min(1, "Repetí la contraseña nueva"),
  })
  .refine((d) => d.passwordNueva === d.confirmacion, {
    message: "Las contraseñas no coinciden",
    path: ["confirmacion"],
  })
  .refine((d) => d.passwordActual !== d.passwordNueva, {
    message: "La nueva contraseña debe ser distinta de la actual",
    path: ["passwordNueva"],
  });

export const actualizarPermisosSchema = z.object({
  usuarioId: id,
  permisos: z
    .array(permisoModuloSchema)
    .refine((ps) => new Set(ps.map((p) => p.modulo)).size === ps.length, "Módulo repetido")
    // Cualquier acción implica ver (misma regla que el CHECK en la DB).
    .transform((ps) => ps.map((p) => normalizarPermiso(p))),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Ingresá tu contraseña").max(200),
});

export type CrearUsuarioInput = z.input<typeof crearUsuarioSchema>;
export type CrearUsuario = z.output<typeof crearUsuarioSchema>;
export type ActualizarUsuario = z.output<typeof actualizarUsuarioSchema>;
export type ActualizarPermisos = z.output<typeof actualizarPermisosSchema>;
export type CambiarPassword = z.output<typeof cambiarPasswordSchema>;
export type LoginInput = z.output<typeof loginSchema>;
