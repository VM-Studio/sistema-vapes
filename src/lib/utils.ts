import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combina clases condicionales y resuelve conflictos de Tailwind (la última gana). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const fechaHora = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

export function formatearFechaHora(fecha: Date | string | null | undefined): string {
  if (!fecha) return "—";
  return fechaHora.format(typeof fecha === "string" ? new Date(fecha) : fecha);
}

/** "Juan Pérez" -> "JP" (para avatares). */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  const [a, b] = [partes[0]?.[0] ?? "?", partes.length > 1 ? partes[partes.length - 1]?.[0] : ""];
  return `${a}${b ?? ""}`.toUpperCase();
}
