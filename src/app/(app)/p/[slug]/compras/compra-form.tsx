"use client";

import { Modulo } from "@prisma/client";
import {
  ArrowLeft,
  BadgeCheck,
  Plus,
  Scale,
  Search,
  Store,
  Trash2,
  Truck,
  Warehouse,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AltaRapidaSheet } from "@/components/catalogo/alta-rapida-sheet";
import { SelectorGalpon } from "@/components/catalogo/selector-galpon";
import { BuscadorRemoto } from "@/components/compras/buscador-remoto";
import { CatalogoProveedor } from "@/components/compras/catalogo-proveedor";
import { CheckComisionPasista } from "@/components/compras/comision-pasista";
import { CostoFinalPorUnidad } from "@/components/compras/costo-final-por-unidad";
import {
  montoCompraEnUsdt,
  ProductoCompraSheet,
  type SaborAgregado,
} from "@/components/compras/producto-compra-sheet";
import { ProveedorForm, soloDecimal } from "@/components/compras/proveedor-form";
import {
  ResumenCompraCard,
  type CotizacionResumen,
} from "@/components/compras/resumen-compra-card";
import { usePanel, useRutaPanel } from "@/components/layout/panel-context";
import { usePuede } from "@/components/layout/usuario-context";
import { BarraAccion } from "@/components/ui/barra-accion";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { controlClass } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Sheet } from "@/components/ui/sheet";
import { Stepper } from "@/components/ui/stepper";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CameraScanner, type MensajeCamara } from "@/features/scanner/CameraScanner";
import { invalidarResoluciones, resolverCodigo } from "@/features/scanner/resolver-codigo";
import { ScanInput } from "@/features/scanner/ScanInput";
import { useBarcodeScanner } from "@/features/scanner/useBarcodeScanner";
import { useScanFeedback } from "@/features/scanner/useScanFeedback";
import type { CotizacionVigente } from "@/lib/cambio";
import { calcularCostosCompraUsdt, calcularCostosFinales, pesosAMoneda } from "@/lib/costos-compra";
import { hoyAR } from "@/lib/fechas";
import { formatearNumero, formatearPesos, formatearUsdt } from "@/lib/format";
import { cn, formatearFechaHora } from "@/lib/utils";
import type { ComparacionCompra } from "@/server/reportes/comparador";
import type { ProductoCatalogoCompra } from "@/server/services/compra.service";

import {
  buscarSaboresCompraAction,
  catalogoProveedorCompraAction,
  costoSugeridoAction,
  descartarBorradorCompraAction,
  guardarBorradorCompraAction,
  guardarCompraAction,
  ofertasCompraAction,
  type SaborBuscado,
} from "./actions";

export interface ItemCompraForm {
  varianteId: string;
  productoId: string;
  nombreCompleto: string;
  /** null = sabor "Único" (no se muestra). */
  sabor: string | null;
  sku: string;
  cantidad: string;
  /** Costo unitario EN USDT (moneda de Compras). */
  costo: string;
  /** De dónde salió el costo sugerido (o "manual" si lo editaron). */
  origenCosto: "PROVEEDOR" | "PROVEEDOR_USDT" | "ULTIMO_COSTO" | "manual" | "cargando" | null;
  /**
   * Si el costo salió de un monto en pesos (precio del proveedor en pesos o
   * último costo): "$ 9.356 ÷ $ 1.641,40" (cómo se pasó a USDT).
   */
  detalleUsdt?: string | null;
}

export interface ProveedorOpcion {
  id: string;
  nombre: string;
  nombreTienda: string;
}

export interface CompraInicial {
  id: string | null;
  idVisible?: string;
  proveedorId: string;
  depositoId: string;
  fecha: string;
  notas: string;
  /** null = sin comisión del pasista. */
  comisionPasistaPorcentaje: string | null;
  /** Gastos extras vigentes (solo al editar una compra que ya tiene): en pesos y en USDT. */
  gastos: { monto: string; montoUSDT: string | null }[];
  items: ItemCompraForm[];
  /** Compra nueva retomada de un borrador guardado (BorradorCompra). */
  borrador?: { id: string; updatedAt: Date | string } | null;
  /** Del borrador: comisión tildada y % tipeado (aunque no sea válido todavía). */
  comision?: { activa: boolean; porcentaje: string };
}

const num = (s: string) => Number(s.replace(",", ".")) || 0;
/** cantidad × costo en USDT, a centavos (sin errores de coma flotante). */
const subtotalUsdt = (cantidad: string, costo: string) =>
  (num(cantidad) * Math.round(num(costo) * 100)) / 100;
const soloEntero = (s: string) => s.replace(/\D/g, "");
const tituloItem = (i: { nombreCompleto: string; sabor: string | null }) =>
  i.sabor ? `${i.nombreCompleto} — ${i.sabor}` : i.nombreCompleto;

type Paso = 1 | 2 | 3;

/**
 * Nueva compra (o edición de un borrador) en tres pasos:
 * 1. proveedor (obligatorio, con "crear rápido"),
 * 2. galpón destino (SelectorGalpon: nunca se confirma solo),
 * 3. ítems con la pistola/cámara activas y buscador manual. Cada sabor trae
 *    el costo sugerido (precio del proveedor o último costo), editable.
 * TODO EN USDT (moneda principal de Compras): el costo se tipea en USDT y el
 * costo final se calcula en USDT; los pesos los deriva el servidor con la
 * cotización de la compra (acá se muestran solo en «= Final u.»).
 * «Confirmar» registra la compra pendiente de recibir (NO suma stock): el
 * stock entra después, con «Recibido» en el listado o el detalle. Abajo, la
 * tarjeta grande con el detalle (y su equivalente en USDT) y el costo final
 * por unidad de cada modelo, en vivo con la misma función que el servidor.
 */
export function CompraForm({
  inicial,
  proveedores: proveedoresIniciales,
  depositos,
  comisionDefault,
  cotizacionUsdt,
  cotizacionUsd,
}: {
  inicial: CompraInicial;
  proveedores: ProveedorOpcion[];
  depositos: { id: string; nombre: string; esPrincipal: boolean }[];
  /** % del pasista que propone el tick (configuración del panel). */
  comisionDefault: number;
  /** Cotización USDT con la que se pasan los costos a pesos (la de la compra o la vigente). */
  cotizacionUsdt: CotizacionResumen | null;
  /** Dólar blue para el costo final por unidad en dólares (el de la compra o el vigente). */
  cotizacionUsd: CotizacionResumen | null;
}) {
  const router = useRouter();
  const ruta = useRutaPanel();
  const panel = usePanel();
  const toast = useToast();
  const feedback = useScanFeedback();
  const puedeCrearProveedor = usePuede(Modulo.PROVEEDORES, "crear");

  const [compraId, setCompraId] = useState(inicial.id);
  const [idVisible, setIdVisible] = useState(inicial.idVisible ?? null);
  const [proveedores, setProveedores] = useState(proveedoresIniciales);
  const [proveedorId, setProveedorId] = useState(inicial.proveedorId);
  const [depositoId, setDepositoId] = useState(inicial.depositoId);
  // Una compra nueva siempre pasa por el galpón (aunque venga preseleccionado): nunca se confirma solo.
  // Un borrador retomado con el galpón ya elegido vuelve directo a los ítems.
  const [paso, setPaso] = useState<Paso>(
    !inicial.proveedorId ? 1 : (inicial.id || inicial.borrador) && inicial.depositoId ? 3 : 2,
  );
  const [fecha, setFecha] = useState(inicial.fecha);
  const [notas, setNotas] = useState(inicial.notas);
  const [items, setItems] = useState<ItemCompraForm[]>(inicial.items);
  const [comisionActiva, setComisionActiva] = useState(
    inicial.comision?.activa ?? inicial.comisionPasistaPorcentaje !== null,
  );
  const [comisionPct, setComisionPct] = useState(
    inicial.comision?.porcentaje ??
      String(
        inicial.comisionPasistaPorcentaje !== null
          ? Number(inicial.comisionPasistaPorcentaje)
          : comisionDefault,
      ).replace(".", ","),
  );
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [nuevoProveedor, setNuevoProveedor] = useState(false);
  const [creandoProveedor, setCreandoProveedor] = useState(false);
  const [filtroProveedor, setFiltroProveedor] = useState("");
  const [camara, setCamara] = useState(false);
  const [mensaje, setMensaje] = useState<MensajeCamara | null>(null);
  const [desconocido, setDesconocido] = useState<string | null>(null);
  const clave = useRef(0);
  // Catálogo del proveedor (null = cargando) y comparador por producto.
  const [catalogo, setCatalogo] = useState<{
    proveedorId: string;
    productos: ProductoCatalogoCompra[];
  } | null>(null);
  const [comparaciones, setComparaciones] = useState<{
    proveedorId: string;
    cotizacionUsdt: CotizacionVigente | null;
    productos: Record<string, ComparacionCompra>;
  }>({ proveedorId, cotizacionUsdt: null, productos: {} });
  /** Producto abierto en la hoja (catálogo + quién lo vende). */
  const [enFoco, setEnFoco] = useState<{ productoId: string; nombreCompleto: string } | null>(null);

  const proveedor = proveedores.find((p) => p.id === proveedorId);
  const deposito = depositos.find((d) => d.id === depositoId);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const compraIdRef = useRef(compraId);
  compraIdRef.current = compraId;

  /** Completa el costo sugerido de los sabores que todavía no tienen costo cargado a mano. */
  const sugerirCostos = useCallback(async (provId: string, varianteIds: string[]) => {
    if (!provId || varianteIds.length === 0) return;
    const r = await costoSugeridoAction({
      proveedorId: provId,
      varianteIds,
      compraId: compraIdRef.current ?? undefined,
    });
    if (!r.ok) {
      setItems((its) =>
        its.map((i) => (i.origenCosto === "cargando" ? { ...i, origenCosto: null } : i)),
      );
      return;
    }
    setItems((its) =>
      its.map((i) => {
        const s = r.data[i.varianteId];
        if (!s || i.origenCosto === "manual") return i;
        return {
          ...i,
          costo: s.costo === null ? "" : String(Number(s.costo)),
          origenCosto: s.fuente,
          detalleUsdt:
            s.pesos && s.tipoCambio
              ? `${formatearPesos(s.pesos)} ÷ ${formatearPesos(s.tipoCambio)}`
              : null,
        };
      }),
    );
  }, []);

  // Al elegir (o cambiar) el proveedor: sugerir el costo de todo lo que no se cargó a mano
  // (también los ítems precargados por URL).
  useEffect(() => {
    const sinCosto = itemsRef.current
      .filter((i) => i.origenCosto !== "manual")
      .map((i) => i.varianteId);
    if (proveedorId && sinCosto.length) void sugerirCostos(proveedorId, sinCosto);
  }, [proveedorId, sugerirCostos]);

  // Catálogo del proveedor elegido (paso Ítems). Se recarga al cambiar de proveedor o de galpón.
  useEffect(() => {
    if (paso !== 3 || !proveedorId) return;
    let vigente = true;
    void catalogoProveedorCompraAction({
      proveedorId,
      depositoId: depositoId || undefined,
      compraId: compraIdRef.current ?? undefined,
    }).then((r) => {
      if (!vigente) return;
      setCatalogo({ proveedorId, productos: r.ok ? r.data : [] });
    });
    return () => {
      vigente = false;
    };
  }, [paso, proveedorId, depositoId]);
  const productosCatalogo = catalogo?.proveedorId === proveedorId ? catalogo.productos : null;

  // Quién vende cada producto de la compra (y el abierto en la hoja), del más barato al más caro.
  const productosComparar = useMemo(() => {
    const ids = new Set(items.map((i) => i.productoId));
    if (enFoco) ids.add(enFoco.productoId);
    return [...ids].sort();
  }, [items, enFoco]);
  const comparacionesVigentes =
    comparaciones.proveedorId === proveedorId ? comparaciones.productos : {};
  const faltanComparar = productosComparar.filter((id) => !(id in comparacionesVigentes));
  const claveFaltantes = faltanComparar.join(",");
  const enFocoAbierto = enFoco !== null;
  useEffect(() => {
    if (paso !== 3 || !claveFaltantes) return;
    let vigente = true;
    // Con la hoja abierta, enseguida; si no, se espera a que termine la ráfaga
    // de escaneos (un pedido por tanda, no por código).
    const t = setTimeout(
      () =>
        void ofertasCompraAction({
          productoIds: claveFaltantes.split(","),
          proveedorId: proveedorId || undefined,
        }).then((r) => {
          if (!vigente || !r.ok) return;
          setComparaciones((c) => ({
            proveedorId,
            cotizacionUsdt: r.data.cotizacionUsdt,
            productos: {
              ...(c.proveedorId === proveedorId ? c.productos : {}),
              ...r.data.productos,
            },
          }));
        }),
      enFocoAbierto ? 0 : 700,
    );
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [paso, proveedorId, claveFaltantes, enFocoAbierto]);

  function agregar(v: {
    varianteId: string;
    productoId: string;
    nombreCompleto: string;
    sabor: string | null;
    sku: string;
  }) {
    const existe = itemsRef.current.some((i) => i.varianteId === v.varianteId);
    setItems((its) =>
      existe
        ? its.map((i) =>
            i.varianteId === v.varianteId ? { ...i, cantidad: String(num(i.cantidad) + 1) } : i,
          )
        : [
            ...its,
            {
              varianteId: v.varianteId,
              productoId: v.productoId,
              nombreCompleto: v.nombreCompleto,
              sabor: v.sabor,
              sku: v.sku,
              cantidad: "1",
              costo: "",
              origenCosto: "cargando",
            },
          ],
    );
    if (!existe) void sugerirCostos(proveedorId, [v.varianteId]);
  }

  /** Desde la hoja del producto: suma las cantidades elegidas con el costo del proveedor. */
  function agregarDesdeHoja(
    p: ProductoCatalogoCompra,
    sabores: SaborAgregado[],
    costo: { valor: string; editado: boolean },
  ) {
    const origen: ItemCompraForm["origenCosto"] = costo.editado
      ? "manual"
      : p.moneda === "USDT"
        ? "PROVEEDOR_USDT"
        : "PROVEEDOR";
    const detalleUsdt =
      origen === "PROVEEDOR" && p.tipoCambio
        ? `${formatearPesos(p.precio)} ÷ ${formatearPesos(p.tipoCambio)}`
        : null;
    const valor = String(Number(costo.valor) || "");
    setItems((its) => {
      const nuevos = [...its];
      for (const s of sabores) {
        const i = nuevos.findIndex((x) => x.varianteId === s.varianteId);
        if (i >= 0) {
          const actual = nuevos[i]!;
          nuevos[i] = {
            ...actual,
            cantidad: String(num(actual.cantidad) + s.cantidad),
            ...(costo.editado || actual.origenCosto !== "manual"
              ? { costo: valor, origenCosto: origen, detalleUsdt }
              : {}),
          };
        } else {
          nuevos.push({
            varianteId: s.varianteId,
            productoId: p.productoId,
            nombreCompleto: p.nombreCompleto,
            sabor: s.sabor,
            sku: s.sku,
            cantidad: String(s.cantidad),
            costo: valor,
            origenCosto: origen,
            detalleUsdt,
          });
        }
      }
      return nuevos;
    });
    const unidades = sabores.reduce((a, s) => a + s.cantidad, 0);
    toast.success(
      `${formatearNumero(unidades)} u. agregadas`,
      `${p.nombreCompleto} a ${formatearUsdt(valor)} c/u`,
    );
    setEnFoco(null);
  }

  /**
   * Pasar la compra a otro proveedor desde el comparador: solo si no tiene
   * productos distintos del que se está comparando (los costos sugeridos se
   * recalculan con el precio del nuevo; los cargados a mano quedan).
   */
  const puedeCambiarProveedor = (id: string) =>
    proveedores.some((p) => p.id === id) && items.every((i) => i.productoId === enFoco?.productoId);
  function cambiarProveedor(id: string) {
    const nuevo = proveedores.find((p) => p.id === id);
    if (!nuevo || !puedeCambiarProveedor(id)) return;
    setItems((its) =>
      its.map((i) => (i.origenCosto === "manual" ? i : { ...i, origenCosto: "cargando" })),
    );
    setProveedorId(id);
    toast.success(`La compra ahora es a ${nuevo.nombre}`, nuevo.nombreTienda);
  }

  const procesar = async (codigo: string) => {
    const r = await resolverCodigo(panel.id, codigo);
    if (!r.ok) {
      feedback.error("No se pudo buscar el código", r.error.message);
      return;
    }
    if (r.data.encontrado) {
      const v = r.data.variante;
      feedback.ok();
      setMensaje({ tipo: "ok", texto: tituloItem(v), clave: ++clave.current });
      agregar(v);
    } else {
      feedback.error();
      setMensaje({
        tipo: "error",
        texto: "Código desconocido",
        detalle: r.data.codigo,
        clave: ++clave.current,
      });
      setCamara(false);
      setDesconocido(r.data.codigo);
    }
  };

  // Pistola activa en el paso de ítems (pausada con el alta rápida o el diálogo abiertos).
  useBarcodeScanner({
    onScan: (c) => void procesar(c),
    enabled: paso === 3 && desconocido === null && !nuevoProveedor && enFoco === null,
  });

  // Resumen en vivo EN USDT (misma función que el servidor); el servidor
  // recalcula y guarda los números definitivos. Los pesos del costo final
  // salen de la cotización de la compra (sin cotización no se muestran).
  const comisionVigente = comisionActiva ? comisionPct : null;
  const gastosUsdt = inicial.gastos.map((g) => ({
    montoUSDT: g.montoUSDT ?? (cotizacionUsdt ? pesosAMoneda(g.monto, cotizacionUsdt.valor) : 0),
    monto: g.monto,
  }));
  const conPesos = cotizacionUsdt
    ? calcularCostosCompraUsdt({
        items: items.map((i) => ({ cantidad: num(i.cantidad), costoUnitarioUSDT: i.costo })),
        comisionPorcentaje: comisionVigente,
        gastos: gastosUsdt,
        tipoCambioUSDT: cotizacionUsdt.valor,
      })
    : null;
  const costos =
    conPesos?.usdt ??
    calcularCostosFinales({
      items: items.map((i) => ({ cantidad: num(i.cantidad), costoUnitario: i.costo })),
      comisionPorcentaje: comisionVigente,
      gastos: gastosUsdt.map((g) => g.montoUSDT),
    });
  const unidadesPorProducto = new Map<string, number>();
  for (const i of items)
    unidadesPorProducto.set(
      i.productoId,
      (unidadesPorProducto.get(i.productoId) ?? 0) + num(i.cantidad),
    );
  const actualizar = (id: string, cambios: Partial<ItemCompraForm>) =>
    setItems((its) => its.map((i) => (i.varianteId === id ? { ...i, ...cambios } : i)));

  /** Guarda la compra pendiente de recibir (crea o actualiza). Devuelve el id o null si hubo errores. */
  async function guardarBorrador(): Promise<{ id: string; idVisible: string } | null> {
    setErrores({});
    const r = await guardarCompraAction({
      id: compraId ?? undefined,
      borradorId: compraId ? undefined : (borradorIdRef.current ?? undefined),
      datos: {
        proveedorId,
        depositoId,
        fecha,
        notas,
        comisionPasistaPorcentaje: comisionActiva ? comisionPct : null,
        items: items.map((i) => ({
          varianteId: i.varianteId,
          cantidad: i.cantidad,
          costoUnitarioUSDT: i.costo.replace(",", "."),
        })),
      },
    });
    if (!r.ok) {
      setErrores(
        Object.fromEntries(
          Object.entries(r.error.fields ?? {}).map(([k, v]) => [
            k.replace(/^datos\./, ""),
            v[0] ?? "",
          ]),
        ),
      );
      toast.error(
        "No se pudo guardar la compra",
        r.error.fields ? "Revisá los datos marcados." : r.error.message,
      );
      return null;
    }
    setCompraId(r.data.id);
    setIdVisible(r.data.idVisible);
    return { id: r.data.id, idVisible: r.data.idVisible };
  }

  const editando = Boolean(compraId && inicial.id);

  async function onConfirmar() {
    setEnviando(true);
    // Que el guardado automático no pise ni recree el borrador mientras se confirma.
    confirmandoRef.current = true;
    await esperarAutoguardado();
    const g = await guardarBorrador();
    setEnviando(false);
    if (!g) {
      confirmandoRef.current = false;
      return;
    }
    toast.success(
      editando ? `Compra ${g.idVisible} actualizada` : `Compra ${g.idVisible} confirmada`,
      "Queda pendiente de recibir: el stock se suma cuando toques «Recibido».",
    );
    router.push(ruta(`/compras/${g.id}`));
  }

  // ---------------------------------------------------------------------------
  // Borrador automático (solo compra nueva): lo tipeado se guarda solo, un
  // segundo y medio después del último cambio, para retomarlo desde Compras si se sale
  // de la pantalla. Al confirmar, el servidor lo borra.
  // ---------------------------------------------------------------------------
  const autoguarda = !inicial.id;
  const [borradorId, setBorradorId] = useState<string | null>(inicial.borrador?.id ?? null);
  const borradorIdRef = useRef(borradorId);
  borradorIdRef.current = borradorId;
  const [estadoBorrador, setEstadoBorrador] = useState<
    { tipo: "guardando" } | { tipo: "guardado"; at: Date } | { tipo: "error" } | null
  >(inicial.borrador ? { tipo: "guardado", at: new Date(inicial.borrador.updatedAt) } : null);
  const [descartando, setDescartando] = useState<"preguntar" | "enviando" | null>(null);
  const confirmandoRef = useRef(false);
  const datosBorrador = useMemo(
    () =>
      JSON.stringify({
        proveedorId,
        depositoId,
        fecha,
        notas,
        comisionActiva,
        comisionPct,
        moneda: "USDT",
        items: items.map((i) => ({
          varianteId: i.varianteId,
          productoId: i.productoId,
          nombreCompleto: i.nombreCompleto,
          sabor: i.sabor,
          sku: i.sku,
          cantidad: i.cantidad,
          costo: i.costo,
          origenCosto: i.origenCosto === "cargando" ? null : i.origenCosto,
          detalleUsdt: i.detalleUsdt ?? null,
        })),
      }),
    [proveedorId, depositoId, fecha, notas, comisionActiva, comisionPct, items],
  );
  const datosBorradorRef = useRef(datosBorrador);
  datosBorradorRef.current = datosBorrador;
  /** Lo último que quedó guardado (lo inicial cuenta como guardado: no se crea un borrador vacío). */
  const guardadoRef = useRef(datosBorrador);
  const colaRef = useRef<Promise<void>>(Promise.resolve());

  /** Guarda lo tipeado si cambió (en cola: nunca dos a la vez, así no se crean dos borradores). */
  const autoguardar = useCallback(() => {
    colaRef.current = colaRef.current.then(async () => {
      const datos = datosBorradorRef.current;
      if (confirmandoRef.current || datos === guardadoRef.current) return;
      setEstadoBorrador({ tipo: "guardando" });
      const r = await guardarBorradorCompraAction({
        id: borradorIdRef.current ?? undefined,
        datos: JSON.parse(datos) as unknown,
      });
      if (!r.ok) {
        setEstadoBorrador({ tipo: "error" });
        return;
      }
      guardadoRef.current = datos;
      // Sin tocar la URL (el router re-renderiza y la pistola puede perder teclas):
      // el borrador se retoma desde «Compras en curso».
      if (borradorIdRef.current !== r.data.id) {
        borradorIdRef.current = r.data.id;
        setBorradorId(r.data.id);
      }
      setEstadoBorrador({ tipo: "guardado", at: new Date(r.data.updatedAt) });
    });
    return colaRef.current;
  }, []);

  const esperarAutoguardado = () => colaRef.current;

  useEffect(() => {
    if (!autoguarda || datosBorrador === guardadoRef.current) return;
    // Después de una pausa: no durante una ráfaga de escaneos.
    const t = setTimeout(() => void autoguardar(), 1500);
    return () => clearTimeout(t);
  }, [autoguarda, datosBorrador, autoguardar]);

  // Al salir de la pantalla (otro menú, otra pestaña, cerrar): guardar ya lo pendiente.
  useEffect(() => {
    if (!autoguarda) return;
    const alOcultar = () => {
      if (document.visibilityState === "hidden") void autoguardar();
    };
    document.addEventListener("visibilitychange", alOcultar);
    window.addEventListener("pagehide", autoguardar);
    return () => {
      document.removeEventListener("visibilitychange", alOcultar);
      window.removeEventListener("pagehide", autoguardar);
      void autoguardar();
    };
  }, [autoguarda, autoguardar]);

  async function descartarBorrador() {
    setDescartando("enviando");
    confirmandoRef.current = true;
    await esperarAutoguardado();
    const id = borradorIdRef.current;
    if (id) {
      const r = await descartarBorradorCompraAction({ id });
      if (!r.ok) {
        confirmandoRef.current = false;
        setDescartando(null);
        return toast.error("No se pudo descartar el borrador", r.error.message);
      }
    }
    toast.success("Borrador descartado");
    router.push(ruta("/compras"));
  }

  const avisoBorrador = autoguarda && (borradorId || estadoBorrador) && (
    <div
      className="text-small -mt-3 mb-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
      data-testid="estado-borrador"
    >
      <span
        aria-live="polite"
        className={estadoBorrador?.tipo === "error" ? "text-danger" : "text-muted"}
      >
        {estadoBorrador?.tipo === "guardando"
          ? "Guardando borrador…"
          : estadoBorrador?.tipo === "error"
            ? "No se pudo guardar el borrador: revisá la conexión (se reintenta con el próximo cambio)."
            : estadoBorrador?.tipo === "guardado"
              ? `Borrador guardado ${formatearFechaHora(estadoBorrador.at)} · lo retomás desde Compras`
              : null}
      </span>
      {borradorId &&
        (descartando === null ? (
          <Button variant="ghost" size="sm" onClick={() => setDescartando("preguntar")}>
            Descartar borrador
          </Button>
        ) : (
          <span className="flex items-center gap-2">
            <span>¿Descartar lo cargado?</span>
            <Button
              variant="danger"
              size="sm"
              loading={descartando === "enviando"}
              onClick={() => void descartarBorrador()}
            >
              Sí, descartar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={descartando === "enviando"}
              onClick={() => setDescartando(null)}
            >
              No
            </Button>
          </span>
        ))}
    </div>
  );

  const titulo = compraId && inicial.id ? `Editar compra ${idVisible ?? ""}` : "Nueva compra";
  const migas = (
    <Breadcrumb
      items={
        compraId && inicial.id
          ? [
              { label: "Compras", href: ruta("/compras") },
              { label: idVisible ?? "Compra", href: ruta(`/compras/${compraId}`) },
              { label: "Editar" },
            ]
          : [{ label: "Compras", href: ruta("/compras") }, { label: "Nueva" }]
      }
    />
  );
  const pasos = (
    <>
      <Stepper
        pasos={["Proveedor", "Galpón", "Ítems"]}
        actual={paso - 1}
        className="bg-card rounded-card mb-6 px-4 py-3 md:px-5"
      />
      {avisoBorrador}
    </>
  );

  // ---------------------------------------------------------------------------
  // Paso 1: proveedor
  // ---------------------------------------------------------------------------
  if (paso === 1) {
    const f = filtroProveedor.trim().toLowerCase();
    const visibles = f
      ? proveedores.filter((p) => `${p.nombre} ${p.nombreTienda}`.toLowerCase().includes(f))
      : proveedores;
    return (
      <>
        <PageHeader
          title={titulo}
          breadcrumb={migas}
          subtitle="Paso 1 de 3 · ¿A quién le comprás?"
        />
        {pasos}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search
                className="text-muted pointer-events-none absolute top-1/2 left-3.5 size-[1.125rem] -translate-y-1/2"
                strokeWidth={1.75}
                aria-hidden
              />
              <input
                type="search"
                aria-label="Buscar proveedor"
                placeholder="Buscar por nombre o tienda"
                value={filtroProveedor}
                onChange={(e) => setFiltroProveedor(e.target.value)}
                className={cn(controlClass, "h-11 pl-10 md:h-10")}
              />
            </div>
            {puedeCrearProveedor && (
              <Button variant="secondary" onClick={() => setNuevoProveedor(true)}>
                <Plus strokeWidth={1.75} /> Crear proveedor rápido
              </Button>
            )}
          </div>
          {visibles.length === 0 ? (
            <EmptyState
              icon={Truck}
              title={
                proveedores.length ? "Ningún proveedor coincide" : "Todavía no hay proveedores"
              }
              description={
                puedeCrearProveedor
                  ? "Crealo con «Crear proveedor rápido»."
                  : "Pedile a un dueño que lo cargue en Proveedores."
              }
              action={
                proveedores.length > 0 && f ? (
                  <Button variant="secondary" onClick={() => setFiltroProveedor("")}>
                    Limpiar búsqueda
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div
              role="radiogroup"
              aria-label="Proveedor"
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {visibles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={p.id === proveedorId}
                  onClick={() => {
                    setProveedorId(p.id);
                    setPaso(depositoId && compraId ? 3 : 2);
                  }}
                  className={cn(
                    "bg-card rounded-card hover:bg-card-hover hover:shadow-card-hover flex min-h-20 items-center gap-4 border p-4 text-left transition-[background-color,box-shadow,border-color] duration-150",
                    p.id === proveedorId ? "border-foreground" : "border-transparent",
                  )}
                >
                  <span className="bg-surface text-muted rounded-control flex size-11 shrink-0 items-center justify-center">
                    <Store className="size-5" strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold">{p.nombre}</span>
                    <span className="text-muted text-small truncate">{p.nombreTienda}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {errores.proveedorId && <p className="text-danger text-small">{errores.proveedorId}</p>}
        </div>
        <Sheet
          open={nuevoProveedor}
          onOpenChange={setNuevoProveedor}
          title="Nuevo proveedor"
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setNuevoProveedor(false)}
                disabled={creandoProveedor}
              >
                Cancelar
              </Button>
              <Button type="submit" form="form-proveedor-rapido" loading={creandoProveedor}>
                Crear
              </Button>
            </>
          }
        >
          {nuevoProveedor && (
            <ProveedorForm
              formId="form-proveedor-rapido"
              proveedor={null}
              verPrecios={false}
              compacto
              onEnviando={setCreandoProveedor}
              onListo={(p) => {
                setProveedores((ps) => [...ps, p].sort((a, b) => a.nombre.localeCompare(b.nombre)));
                setProveedorId(p.id);
                setNuevoProveedor(false);
                setPaso(2);
              }}
            />
          )}
        </Sheet>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Paso 2: galpón destino
  // ---------------------------------------------------------------------------
  if (paso === 2) {
    return (
      <>
        <PageHeader
          title={titulo}
          breadcrumb={migas}
          subtitle={`Paso 2 de 3 · Compra a ${proveedor?.nombre ?? ""}`}
        />
        {pasos}
        <SelectorGalpon
          depositos={depositos}
          preseleccionadoId={depositoId || depositos.find((d) => d.esPrincipal)?.id}
          titulo="¿A qué galpón entra la mercadería?"
          descripcion="El stock se suma ahí cuando recibas la compra."
          onConfirmar={(id) => {
            setDepositoId(id);
            setPaso(3);
          }}
        />
        <Button variant="ghost" className="mt-4 w-full md:w-auto" onClick={() => setPaso(1)}>
          <ArrowLeft strokeWidth={1.75} /> Volver al proveedor
        </Button>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Paso 3: ítems
  // ---------------------------------------------------------------------------
  return (
    <>
      <PageHeader
        title={titulo}
        breadcrumb={migas}
        subtitle="Paso 3 de 3 · Escaneá la mercadería (pistola o cámara) o buscala a mano."
      />
      {pasos}
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_12rem] md:items-end">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <Store className="text-muted size-5 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="min-w-0">
                  <span className="text-muted text-small block">Proveedor</span>
                  <span className="block truncate font-semibold">
                    {proveedor ? `${proveedor.nombre} · ${proveedor.nombreTienda}` : "—"}
                  </span>
                </span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setPaso(1)}>
                Cambiar
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <Warehouse className="text-muted size-5 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="min-w-0">
                  <span className="text-muted text-small block">Galpón destino</span>
                  <span className="block truncate font-semibold">{deposito?.nombre ?? "—"}</span>
                </span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setPaso(2)}>
                Cambiar
              </Button>
            </div>
            <Input
              label="Fecha"
              type="date"
              value={fecha}
              max={hoyAR()}
              onChange={(e) => setFecha(e.target.value)}
              error={errores.fecha}
            />
            {(errores.proveedorId || errores.depositoId) && (
              <p className="text-danger text-small md:col-span-3">
                {errores.proveedorId ?? errores.depositoId}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <ScanInput
              onScan={(c) => void procesar(c)}
              onAbrirCamara={() => {
                feedback.prepararAudio();
                setCamara(true);
              }}
              autoFocus={false}
            />
            <BuscadorRemoto<SaborBuscado>
              ariaLabel="Buscar producto a mano"
              placeholder="…o buscá por producto, sabor o SKU"
              buscar={(q) => buscarSaboresCompraAction({ q })}
              getKey={(v) => v.varianteId}
              render={(v) => (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">
                    {tituloItem(v)}
                    {items.some((i) => i.varianteId === v.varianteId) && (
                      <span className="text-subtle ml-2 text-xs font-normal">(ya agregado)</span>
                    )}
                  </span>
                  <span className="text-muted truncate text-xs">
                    {v.sku}
                    {v.codigoBarras ? ` · ${v.codigoBarras}` : ""}
                  </span>
                </span>
              )}
              onSelect={agregar}
            />
          </CardContent>
        </Card>

        {proveedor && (
          <CatalogoProveedor
            proveedor={proveedor.nombre}
            productos={productosCatalogo}
            enCompra={unidadesPorProducto}
            onElegir={(p) =>
              setEnFoco({ productoId: p.productoId, nombreCompleto: p.nombreCompleto })
            }
          />
        )}

        {items.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="Todavía no hay productos en la compra"
            description="Cada escaneo repetido suma una unidad."
          />
        ) : (
          <div className="border-border bg-surface rounded-card overflow-hidden border">
            <div
              aria-hidden
              className="border-border bg-card text-muted hidden h-10 grid-cols-[minmax(0,1fr)_6rem_8.5rem_8rem_2.75rem] items-center gap-3 border-b px-4 text-xs font-medium md:grid"
            >
              <span>Producto</span>
              <span className="text-right">Cantidad</span>
              <span className="text-right">Costo unitario (USDT)</span>
              <span className="text-right">Subtotal</span>
              <span />
            </div>
            <ul aria-label="Ítems de la compra" className="divide-border flex flex-col divide-y">
              {items.map((it, i) => {
                const t = tituloItem(it);
                const errorDe = (campo: string) => errores[`items.${i}.${campo}`];
                const sugerido =
                  it.origenCosto === "PROVEEDOR" ||
                  it.origenCosto === "PROVEEDOR_USDT" ||
                  it.origenCosto === "ULTIMO_COSTO";
                return (
                  <li
                    key={it.varianteId}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-start gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_6rem_8.5rem_8rem_2.75rem] md:items-center"
                  >
                    <div className="col-span-2 min-w-0 md:col-span-1">
                      <p className="font-medium">{it.nombreCompleto}</p>
                      <p className="text-subtle text-xs">
                        {it.sabor ? `${it.sabor} · ` : ""}
                        {it.sku}
                        {it.origenCosto === "PROVEEDOR_USDT" && " · costo del proveedor"}
                        {it.origenCosto === "PROVEEDOR" &&
                          ` · costo del proveedor${it.detalleUsdt ? ` en pesos: ${it.detalleUsdt}` : ""}`}
                        {it.origenCosto === "ULTIMO_COSTO" &&
                          ` · último costo${it.detalleUsdt ? `: ${it.detalleUsdt}` : ""}`}
                        {it.origenCosto === "manual" &&
                          it.detalleUsdt &&
                          ` · convertido de pesos: ${it.detalleUsdt}`}
                        {it.origenCosto === "cargando" && " · buscando costo…"}
                      </p>
                      {items.findIndex((x) => x.productoId === it.productoId) === i && (
                        <PistaComparador
                          comparacion={comparacionesVigentes[it.productoId] ?? null}
                          cotizacionUsdt={comparaciones.cotizacionUsdt}
                          proveedor={proveedor?.nombre ?? "este proveedor"}
                          onComparar={() =>
                            setEnFoco({
                              productoId: it.productoId,
                              nombreCompleto: it.nombreCompleto,
                            })
                          }
                        />
                      )}
                    </div>
                    <label className="text-muted text-small row-start-2 flex flex-col gap-1 md:row-start-auto">
                      <span className="md:sr-only">Cantidad</span>
                      <input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        aria-label={`Cantidad de ${t}`}
                        value={it.cantidad}
                        onChange={(e) =>
                          actualizar(it.varianteId, { cantidad: soloEntero(e.target.value) })
                        }
                        aria-invalid={errorDe("cantidad") ? true : undefined}
                        className={cn(
                          controlClass,
                          "text-foreground h-11 text-right font-semibold tabular-nums md:h-10",
                        )}
                      />
                      {errorDe("cantidad") && (
                        <span className="text-danger">{errorDe("cantidad")}</span>
                      )}
                    </label>
                    <label className="text-muted text-small row-start-2 flex flex-col gap-1 md:row-start-auto">
                      <span className="md:sr-only">Costo unitario (USDT)</span>
                      <input
                        inputMode="decimal"
                        aria-label={`Costo en USDT de ${t}`}
                        placeholder="USDT"
                        title={sugerido ? "Costo sugerido: editalo si cambió" : undefined}
                        value={it.costo}
                        onChange={(e) =>
                          actualizar(it.varianteId, {
                            costo: soloDecimal(e.target.value),
                            origenCosto: "manual",
                            detalleUsdt: null,
                          })
                        }
                        aria-invalid={errorDe("costoUnitario") ? true : undefined}
                        className={cn(
                          controlClass,
                          "h-11 text-right tabular-nums md:h-10",
                          sugerido && "text-muted",
                        )}
                      />
                      {errorDe("costoUnitario") && (
                        <span className="text-danger">{errorDe("costoUnitario")}</span>
                      )}
                    </label>
                    <p className="col-span-2 flex items-baseline justify-between gap-2 md:col-span-1 md:block md:text-right">
                      <span className="text-muted text-small md:hidden">Subtotal</span>
                      <span className="flex flex-col items-end">
                        <strong className="font-semibold tabular-nums">
                          {formatearUsdt(subtotalUsdt(it.cantidad, it.costo))}
                        </strong>
                      </span>
                    </p>
                    <IconButton
                      variant="ghost"
                      className="hover:text-danger col-start-3 row-start-1 justify-self-end md:col-start-auto md:row-start-auto"
                      onClick={() =>
                        setItems((its) => its.filter((x) => x.varianteId !== it.varianteId))
                      }
                      aria-label={`Quitar ${t}`}
                    >
                      <Trash2 strokeWidth={1.75} />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {errores.items && <p className="text-danger text-small">{errores.items}</p>}

        <Card>
          <CardContent>
            <Textarea
              label="Notas"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="N.º de remito o factura, observaciones…"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="text-h3 font-semibold">Comisión del pasista</h2>
            <CheckComisionPasista
              activa={comisionActiva}
              porcentaje={comisionPct}
              onActiva={setComisionActiva}
              onPorcentaje={setComisionPct}
              error={errores.comisionPasistaPorcentaje}
            />
            <p className="text-muted text-small">
              La comisión se suma a cada modelo según su precio y los gastos extras (valija, envío…)
              se reparten parejo por unidad: el costo final es el que toman las ventas para calcular
              la ganancia. Los gastos se cargan desde el listado o el detalle de la compra.
            </p>
          </CardContent>
        </Card>

        <ResumenCompraCard
          costos={costos}
          sabores={items.length}
          modelos={unidadesPorProducto.size}
          cotizacion={cotizacionUsdt}
        />

        <CostoFinalPorUnidad
          items={items.map((i) => ({
            key: i.varianteId,
            nombreCompleto: i.nombreCompleto,
            sabor: i.sabor,
          }))}
          costos={costos}
          finalesUsdt={costos.items.map((c) => c.costoUnitarioFinal)}
          finalesPesos={items.map((_, n) => conPesos?.itemsPesos[n]?.costoUnitarioFinal ?? null)}
          cotizacionUsd={cotizacionUsd}
        />

        <div className="md:flex md:justify-end">
          <BarraAccion>
            <Button
              onClick={() => void onConfirmar()}
              loading={enviando}
              disabled={items.length === 0 || enviando}
            >
              {editando ? "Guardar cambios" : "Confirmar"}
            </Button>
          </BarraAccion>
        </div>
        <p className="text-muted text-small md:text-right">
          {editando ? "Sigue" : "Queda"} pendiente de recibir: el stock se suma recién cuando toques
          «Recibido».
        </p>
      </div>

      <CameraScanner
        open={camara}
        onOpenChange={setCamara}
        onDetect={(c) => void procesar(c)}
        mensaje={mensaje}
        permitirRafaga
        titulo="Escanear mercadería"
      />
      <AltaRapidaSheet
        codigo={desconocido}
        abierto={desconocido !== null}
        onCerrar={() => setDesconocido(null)}
        onCreada={(v) => {
          setDesconocido(null);
          invalidarResoluciones();
          agregar(v);
        }}
      />
      <ProductoCompraSheet
        abierto={enFoco !== null}
        onCerrar={() => setEnFoco(null)}
        nombreCompleto={enFoco?.nombreCompleto ?? ""}
        proveedorActual={proveedor?.nombre ?? "el proveedor"}
        catalogo={productosCatalogo?.find((p) => p.productoId === enFoco?.productoId) ?? null}
        comparacion={enFoco ? (comparacionesVigentes[enFoco.productoId] ?? null) : null}
        cotizacionUsdt={comparaciones.cotizacionUsdt}
        puedeCambiarProveedor={puedeCambiarProveedor}
        otrosProductos={
          new Set(items.filter((i) => i.productoId !== enFoco?.productoId).map((i) => i.productoId))
            .size
        }
        hrefNuevaCompra={(id) => ruta(`/compras/nueva?proveedor=${id}`)}
        onAgregar={(sabores, costo) => {
          const p = productosCatalogo?.find((x) => x.productoId === enFoco?.productoId);
          if (p) agregarDesdeHoja(p, sabores, costo);
        }}
        onCambiarProveedor={cambiarProveedor}
      />
    </>
  );
}

/**
 * Debajo del primer sabor de cada producto: si el proveedor de la compra es
 * el más barato, o quién lo vende más barato y cuánto se ahorra por unidad.
 */
function PistaComparador({
  comparacion,
  cotizacionUsdt,
  proveedor,
  onComparar,
}: {
  comparacion: ComparacionCompra | null;
  cotizacionUsdt: CotizacionVigente | null;
  proveedor: string;
  onComparar: () => void;
}) {
  if (!comparacion || comparacion.ofertas.length === 0) return null;
  const { actual, masBarato, ofertas, sobrecostoActual } = comparacion;
  const n = ofertas.length;
  const boton = (
    <button
      type="button"
      onClick={onComparar}
      className="text-foreground inline-flex min-h-6 items-center gap-1 font-medium underline underline-offset-4"
    >
      <Scale className="size-3.5" strokeWidth={1.75} aria-hidden />
      {n === 1 ? "Ver proveedor" : `Comparar ${n} proveedores`}
    </button>
  );
  let texto: React.ReactNode;
  let tono = "text-muted";
  if (actual?.masBarato) {
    tono = "text-success";
    texto =
      n > 1 ? (
        <span className="inline-flex items-center gap-1">
          <BadgeCheck className="size-3.5" strokeWidth={1.75} aria-hidden />
          {proveedor} es el más barato
        </span>
      ) : (
        `Solo lo vende ${proveedor}`
      );
  } else if (masBarato && sobrecostoActual) {
    tono = "text-warning-soft-foreground";
    // Los dos en USDT: el ahorro exacto en USDT (sin pasar por pesos).
    const ahorro =
      actual?.moneda === "USDT" && masBarato.moneda === "USDT"
        ? formatearUsdt(
            (Math.round(Number(actual.precio) * 100) - Math.round(Number(masBarato.precio) * 100)) /
              100,
          )
        : montoCompraEnUsdt(sobrecostoActual, masBarato.grupo, cotizacionUsdt);
    texto = `Más barato con ${masBarato.proveedor}: ${montoCompraEnUsdt(masBarato.precio, masBarato.moneda, cotizacionUsdt)} · ahorrás ${ahorro}/u`;
  } else if (!actual && masBarato) {
    texto = `${proveedor} no lo tiene cargado · desde ${montoCompraEnUsdt(masBarato.precio, masBarato.moneda, cotizacionUsdt)} con ${masBarato.proveedor}`;
  } else {
    texto = `Lo venden ${n} proveedores`;
  }
  return (
    <p
      className={cn("mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", tono)}
      data-testid="pista-comparador"
    >
      <span>{texto}</span>
      {boton}
    </p>
  );
}
