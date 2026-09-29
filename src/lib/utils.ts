import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge con la escala tipográfica y los colores propios del sistema
 * (globals.css): sin esto, `text-body` se tomaría como color y borraría
 * `text-primary-foreground`, y `rounded-[var(--radius-card)]` no pisaría a `rounded-2xl`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "h1", "h2", "h3", "body", "small"],
      radius: ["control", "card"],
    },
  },
});

/** Combina clases condicionales y resuelve conflictos de Tailwind (la última gana). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const partesFecha = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Argentina/Buenos_Aires",
});

/**
 * "24/09/26 15:24" (hora argentina). Se arma a mano desde formatToParts: el
 * texto de Intl ("p. m.", separadores) varía entre el ICU de Node y el del
 * navegador y rompería la hidratación de React.
 */
export function formatearFechaHora(fecha: Date | string | null | undefined): string {
  if (!fecha) return "—";
  const p = Object.fromEntries(
    partesFecha
      .formatToParts(typeof fecha === "string" ? new Date(fecha) : fecha)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** "24/09/26" (solo el día, hora argentina). */
export function formatearFecha(fecha: Date | string | null | undefined): string {
  return fecha ? formatearFechaHora(fecha).slice(0, 8) : "—";
}

/** "Juan Pérez" -> "JP" (para avatares). */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  const [a, b] = [partes[0]?.[0] ?? "?", partes.length > 1 ? partes[partes.length - 1]?.[0] : ""];
  return `${a}${b ?? ""}`.toUpperCase();
}
