import { Modulo, RolUsuario } from "@prisma/client";
import { z } from "zod";

import { MODULOS_GLOBALES, normalizarPermiso } from "@/lib/permisos";

import { email, id, texto } from "./common";

/** Mínimo 8 caracteres, al menos una letra y un número. Máximo 72 (límite de bcrypt). */
export const password = z
  .string()
  .min(8, "Mínimo 8 caracteres")
  .max(72, "Máximo 72 caracteres")
  .regex(/\p{L}/u, "Debe incluir al menos una letra")
  .regex(/\d/, "Debe incluir al menos un número");

export const permisoModuloSchema = z.object({
  modulo: z.enum(Modulo).refine((m) => !MODULOS_GLOBALES.has(m), "Este módulo es solo para dueños"),
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

/** Porcentaje de comisión opcional (0–100, hasta 2 decimales); vacío = sin comisión. */
const porcentajeComision = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.coerce
    .number({ error: "Porcentaje inválido" })
    .min(0, "Mínimo 0 %")
    .max(100, "Máximo 100 %")
    .refine((n) => Math.round(n * 100) === n * 100, "Hasta 2 decimales")
    .nullable(),
);

/** Comisión orientativa de un EMPLEADO (solo referencia en el dashboard). */
export const actualizarComisionSchema = z.object({
  id,
  comisionUnitariaPct: porcentajeComision,
  comisionMayoristaPct: porcentajeComision,
});

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

/** Acceso de un EMPLEADO: paneles habilitados y, en cada uno, la grilla de permisos. */
export const actualizarAccesoSchema = z.object({
  usuarioId: id,
  paneles: z
    .array(
      z.object({
        panelId: id,
        permisos: z
          .array(permisoModuloSchema)
          .refine((ps) => new Set(ps.map((p) => p.modulo)).size === ps.length, "Módulo repetido")
          // Cualquier acción implica ver.
          .transform((ps) => ps.map((p) => normalizarPermiso({ ...p, panelId: "" }))),
      }),
    )
    .refine((ps) => new Set(ps.map((p) => p.panelId)).size === ps.length, "Panel repetido"),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Ingresá tu contraseña").max(200),
});

export type CrearUsuarioInput = z.input<typeof crearUsuarioSchema>;
export type CrearUsuario = z.output<typeof crearUsuarioSchema>;
export type ActualizarUsuario = z.output<typeof actualizarUsuarioSchema>;
export type ActualizarComision = z.output<typeof actualizarComisionSchema>;
export type ActualizarAcceso = z.output<typeof actualizarAccesoSchema>;
export type CambiarPassword = z.output<typeof cambiarPasswordSchema>;
export type LoginInput = z.output<typeof loginSchema>;
