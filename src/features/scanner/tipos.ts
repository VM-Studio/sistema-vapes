/** Stock de un sabor en un depósito activo del panel (0 si nunca tuvo). */
export interface StockEnDeposito {
  depositoId: string;
  nombre: string;
  esPrincipal: boolean;
  cantidad: number;
}

/**
 * Un sabor (Variante) tal como lo necesitan el escáner, el POS, las compras y
 * la carga de stock. Lo devuelven buscarPorCodigo / buscarVariantes /
 * obtenerVariantesPorId / altaRapida (servidor) y el catálogo offline.
 * Montos como string con 2 decimales.
 */
export interface VarianteEncontrada {
  varianteId: string;
  productoId: string;
  /** Del producto: "Elf Bar BC 5000" (lo mantiene la DB). */
  nombreCompleto: string;
  /** null si es la variante "Único" de un producto sin sabores. */
  sabor: string | null;
  /** Para mostrar en una línea: "Elf Bar BC 5000 — Mango" (o solo el producto). */
  titulo: string;
  marca: string;
  marcaId: string;
  modelo: string;
  especificacion: string;
  categoria: string | null;
  imagenUrl: string | null;
  sku: string;
  codigoBarras: string | null;
  /** Precio efectivo del sabor: el propio o, si no tiene, el del producto. */
  precioVenta: string;
  precioVentaProducto: string;
  tienePrecioPropio: boolean;
  /** Costo de la última compra. null para quien no es dueño (se filtra en el servidor). */
  ultimoCosto: string | null;
  stockMinimo: number;
  /** Todos los depósitos activos del panel (principal primero). */
  stockPorDeposito: StockEnDeposito[];
  stockTotal: number;
  /** Stock en el depósito pedido (buscarVariantes / obtenerVariantesPorId con depositoId); si no, null. */
  stockEnDeposito: number | null;
  /** Sabor y producto activos. */
  activo: boolean;
  /** true si se encontró por un código alternativo (no el principal). */
  porCodigoAlternativo: boolean;
}

/** Lo que recibe la UI al escanear. */
export type VarianteEscaneada = VarianteEncontrada;

export type ResultadoResolucion =
  { encontrado: true; variante: VarianteEscaneada } | { encontrado: false; codigo: string };
