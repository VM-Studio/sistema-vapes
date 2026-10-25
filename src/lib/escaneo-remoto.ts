/**
 * «Escanea Charly»: escaneo remoto de una venta de un galpón con
 * `Deposito.escaneoRemoto` (Vapes: Mercedes). El vendedor lo pide; el usuario
 * de escaneo (perfil ESCANEO) escanea cada unidad y la venta queda ESCANEADA
 * solo si lo escaneado es EXACTAMENTE lo vendido (varianteId y cantidades).
 *
 * Funciones PURAS (sin DB): las usa el servidor —la única validación que
 * cuenta— y la pantalla de escaneo para mostrar el progreso y los errores.
 *
 * Pitadas: es `Producto.especificacion`, el atributo principal del panel
 * (`Panel.etiquetaEspecificacion` = "Pitadas" en Vapes). No se infiere del
 * nombre: es un campo explícito del catálogo y forma parte de la identidad del
 * producto (marca + modelo + especificación).
 */

/** Nombre con el que se muestra al usuario de escaneo en la UI («Escanea Charly»). */
export const NOMBRE_ESCANEO = "Charly";

/** Identidad de un sabor: lo que se compara entre lo vendido y lo escaneado. */
export interface IdentidadVape {
  varianteId: string;
  productoId: string;
  marca: string;
  /** Modelo (Producto.nombre): "BC". */
  modelo: string;
  /** Pitadas en Vapes (Producto.especificacion): "5000". */
  especificacion: string;
  /** null = producto sin sabores ("Único"). */
  sabor: string | null;
  /** "Elf Bar BC 5000 — Mango Ice". */
  titulo: string;
}

/** Un ítem de la venta a escanear. */
export interface ItemEscaneo extends IdentidadVape {
  cantidad: number;
}

/** Un código escaneado, ya resuelto contra el catálogo del panel (null = no existe). */
export interface LecturaEscaneo {
  codigo: string;
  variante: IdentidadVape | null;
}

/** Dónde está la diferencia (la UI resalta ese campo del ítem). */
export type CampoDiferencia = "codigo" | "producto" | "pitadas" | "sabor" | "unidades";

export interface RechazoEscaneo {
  codigo: string;
  /** Ítem de la venta más parecido (contra el que se explica la diferencia); null si el código no existe. */
  varianteIdItem: string | null;
  campos: CampoDiferencia[];
  /** "Sabor distinto". */
  resumen: string;
  /** Una línea por campo: "Sabor: escaneaste «Blue Razz Ice», la venta lleva «Watermelon Ice»." */
  detalles: string[];
  /** Lo escaneado ("Elf Bar BC 10000 — Blue Razz Ice"); null si el código no existe. */
  escaneado: string | null;
}

export interface ProgresoItem {
  varianteId: string;
  escaneadas: number;
  cantidad: number;
}

export interface FaltanteEscaneo {
  varianteId: string;
  faltan: number;
  mensaje: string;
}

export interface EvaluacionEscaneo {
  /** En el orden de los ítems de la venta. */
  progreso: ProgresoItem[];
  /** Escaneos que coinciden con lo vendido (en orden). */
  aceptados: { codigo: string; varianteId: string }[];
  /** Escaneos que NO corresponden (no suman). */
  rechazos: RechazoEscaneo[];
  /** Ítems con unidades sin escanear. */
  faltantes: FaltanteEscaneo[];
  /** Todo coincide: cada ítem escaneado exacto y ningún escaneo rechazado. */
  completo: boolean;
}

const norm = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();

const unidades = (n: number) => `${n} ${n === 1 ? "unidad" : "unidades"}`;
const modeloDe = (v: IdentidadVape) => `${v.marca} ${v.modelo}`.trim();
const saborDe = (v: IdentidadVape) => v.sabor ?? "sin sabor";
const especDe = (v: IdentidadVape) => v.especificacion.trim() || "sin dato";

/** Puntaje de parecido: mismo producto pesa más que todo; después modelo, sabor, marca y pitadas. */
function parecido(a: IdentidadVape, b: IdentidadVape): number {
  if (a.productoId === b.productoId) return 100;
  return (
    (norm(a.modelo) === norm(b.modelo) ? 20 : 0) +
    (norm(a.marca) === norm(b.marca) ? 10 : 0) +
    (norm(a.sabor) === norm(b.sabor) ? 8 : 0) +
    (norm(a.especificacion) === norm(b.especificacion) ? 5 : 0)
  );
}

/**
 * Diferencias entre lo escaneado y un ítem de la venta (variantes distintas).
 * Mismo producto ⇒ solo el sabor. Si no: modelo/marca, pitadas y sabor, cada
 * uno si difiere. `etiqueta` es la del panel ("Pitadas").
 */
export function diferencias(
  escaneado: IdentidadVape,
  item: IdentidadVape,
  etiqueta = "Pitadas",
): { campos: CampoDiferencia[]; resumen: string; detalles: string[] } {
  const campos: CampoDiferencia[] = [];
  const detalles: string[] = [];
  const mismoProducto = escaneado.productoId === item.productoId;
  if (
    !mismoProducto &&
    (norm(escaneado.marca) !== norm(item.marca) || norm(escaneado.modelo) !== norm(item.modelo))
  ) {
    campos.push("producto");
    detalles.push(
      `Modelo: escaneaste «${modeloDe(escaneado)}», la venta lleva «${modeloDe(item)}».`,
    );
  }
  if (!mismoProducto && norm(escaneado.especificacion) !== norm(item.especificacion)) {
    campos.push("pitadas");
    detalles.push(
      `${etiqueta}: escaneaste ${especDe(escaneado)}, la venta lleva ${especDe(item)}.`,
    );
  }
  if (norm(escaneado.sabor) !== norm(item.sabor)) {
    campos.push("sabor");
    detalles.push(`Sabor: escaneaste «${saborDe(escaneado)}», la venta lleva «${saborDe(item)}».`);
  }
  if (campos.length === 0) {
    // Mismos nombres pero otro producto (ej. dado de alta dos veces): es otro artículo.
    campos.push("producto");
    detalles.push(
      `Producto: escaneaste «${escaneado.titulo}», que es otro artículo del catálogo que «${item.titulo}».`,
    );
  }
  return { campos, resumen: resumenDe(campos, etiqueta), detalles };
}

function resumenDe(campos: CampoDiferencia[], etiqueta: string): string {
  const nombre: Record<CampoDiferencia, string> = {
    codigo: "código",
    producto: "modelo",
    pitadas: etiqueta.toLowerCase(),
    sabor: "sabor",
    unidades: "unidades",
  };
  if (campos.length === 1) {
    const c = campos[0]!;
    if (c === "producto") return "Modelo distinto";
    if (c === "sabor") return "Sabor distinto";
    if (c === "pitadas")
      return etiqueta.endsWith("s") ? `${etiqueta} distintas` : `${etiqueta} distinto`;
  }
  const lista = campos.map((c) => nombre[c]);
  const texto = lista.length > 1 ? `${lista.slice(0, -1).join(", ")} y ${lista.at(-1)}` : lista[0];
  return `No coincide: ${texto}`;
}

/**
 * Evalúa los escaneos (en orden) contra los ítems vendidos. Cada escaneo:
 * - código inexistente → rechazo "codigo";
 * - mismo sabor exacto con unidades pendientes → aceptado;
 * - mismo sabor ya completo → rechazo "unidades" (de más);
 * - otro sabor → rechazo con la diferencia contra el ítem más parecido
 *   (a igual parecido, el que todavía tiene unidades pendientes).
 * Al final, cada ítem con unidades sin escanear es un faltante ("unidades" de menos).
 */
export function evaluarEscaneo(
  items: readonly ItemEscaneo[],
  lecturas: readonly LecturaEscaneo[],
  opciones: { etiquetaEspecificacion?: string } = {},
): EvaluacionEscaneo {
  const etiqueta = opciones.etiquetaEspecificacion || "Pitadas";
  const contados = new Map<string, number>(items.map((i) => [i.varianteId, 0]));
  const aceptados: EvaluacionEscaneo["aceptados"] = [];
  const rechazos: RechazoEscaneo[] = [];

  for (const l of lecturas) {
    const v = l.variante;
    if (!v) {
      rechazos.push({
        codigo: l.codigo,
        varianteIdItem: null,
        campos: ["codigo"],
        resumen: "Código desconocido",
        detalles: [
          `El código ${l.codigo} no está cargado en el catálogo: no es nada de esta venta.`,
        ],
        escaneado: null,
      });
      continue;
    }
    const exacto = items.find((i) => i.varianteId === v.varianteId);
    if (exacto) {
      const n = contados.get(exacto.varianteId) ?? 0;
      if (n < exacto.cantidad) {
        contados.set(exacto.varianteId, n + 1);
        aceptados.push({ codigo: l.codigo, varianteId: v.varianteId });
      } else {
        rechazos.push({
          codigo: l.codigo,
          varianteIdItem: exacto.varianteId,
          campos: ["unidades"],
          resumen: "Unidades de más",
          detalles: [
            `La venta lleva ${unidades(exacto.cantidad)} de ${exacto.titulo} y ya ${exacto.cantidad === 1 ? "está escaneada" : "están escaneadas"}.`,
          ],
          escaneado: v.titulo,
        });
      }
      continue;
    }
    let mejor: ItemEscaneo | null = null;
    let mejorPuntaje = -1;
    for (const i of items) {
      const pendiente = (contados.get(i.varianteId) ?? 0) < i.cantidad ? 1 : 0;
      const p = parecido(v, i) * 2 + pendiente;
      if (p > mejorPuntaje) {
        mejor = i;
        mejorPuntaje = p;
      }
    }
    if (!mejor) {
      rechazos.push({
        codigo: l.codigo,
        varianteIdItem: null,
        campos: ["producto"],
        resumen: "No corresponde",
        detalles: [`${v.titulo} no está en esta venta.`],
        escaneado: v.titulo,
      });
      continue;
    }
    const d = diferencias(v, mejor, etiqueta);
    rechazos.push({
      codigo: l.codigo,
      varianteIdItem: mejor.varianteId,
      ...d,
      escaneado: v.titulo,
    });
  }

  const progreso = items.map((i) => ({
    varianteId: i.varianteId,
    escaneadas: contados.get(i.varianteId) ?? 0,
    cantidad: i.cantidad,
  }));
  const faltantes = items.flatMap((i) => {
    const x = contados.get(i.varianteId) ?? 0;
    const faltan = i.cantidad - x;
    return faltan > 0
      ? [
          {
            varianteId: i.varianteId,
            faltan,
            mensaje: `${faltan === 1 ? "Falta" : "Faltan"} ${unidades(faltan)} de ${i.titulo} (escaneaste ${x} de ${i.cantidad}).`,
          },
        ]
      : [];
  });
  return {
    progreso,
    aceptados,
    rechazos,
    faltantes,
    completo: items.length > 0 && faltantes.length === 0 && rechazos.length === 0,
  };
}
