import { normalizarCodigoBarras } from "@/lib/barcode";

import type { Sufijo } from "./config";

/**
 * Detección de escaneos de pistolas HID "keyboard wedge".
 *
 * La pistola es un teclado que "tipea" el código muy rápido (1–20 ms entre
 * teclas) y termina con Enter o Tab. Una ráfaga de ≥ minLength caracteres con
 * < maxIntervalMs entre teclas y terminada en un sufijo es un escaneo; el
 * tipeo humano no cumple eso.
 *
 * Protección de inputs: la 1ª tecla de una ráfaga no se puede distinguir de
 * una humana y entra al input con foco; las siguientes se bloquean
 * (preventDefault). Si la ráfaga termina siendo un escaneo, el input vuelve a
 * su valor previo; si no (una persona tipeó 2 teclas muy rápido), las teclas
 * bloqueadas se devuelven al input, así nunca se pierde lo que escribió.
 *
 * Clase sin React: la usa el ScannerProvider (una sola instancia, un solo
 * listener global) y se puede testear aislada.
 */

export interface OpcionesDeteccion {
  minLength: number;
  maxIntervalMs: number;
  sufijos: readonly Sufijo[];
  prefijo: string;
  /** true = no interceptar teclas cuando el foco está en ese elemento. */
  ignorarSiFocoEn?: (el: Element) => boolean;
}

export type EventoDiagnostico =
  | { tipo: "tecla"; key: string; intervaloMs: number | null; enRafaga: boolean }
  | { tipo: "escaneo"; codigo: string; crudo: string }
  | { tipo: "descartado"; motivo: string; buffer: string };

type Editable = HTMLInputElement | HTMLTextAreaElement;

const TIPOS_TEXTO = new Set(["text", "search", "email", "url", "tel", "password", "number", ""]);

function esEditable(el: Element | null): el is Editable {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement)
    return TIPOS_TEXTO.has(el.type) && !el.readOnly && !el.disabled;
  return false;
}

/** Reemplaza un rango del input y avisa a React (onChange) con un evento "input". */
function reemplazar(el: Editable, texto: string, inicio: number, fin: number) {
  try {
    el.setRangeText(texto, inicio, fin, "end");
  } catch {
    // type="number"/"email" no soportan selección: se reescribe el valor completo con el
    // setter nativo (asignar el.value directo lo "ve" el tracker de React y se pierde el onChange).
    const v = el.value;
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(
      el,
      v.slice(0, inicio) + texto + v.slice(fin),
    );
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const TECLAS_MODIFICADORAS = new Set(["Shift", "CapsLock", "Unidentified", "Dead"]);
export const DEDUPE_MS = 300;

export class CapturadorEscaneos {
  private buffer = "";
  private tragadas = "";
  private ultimo = 0;
  private objetivo: Editable | null = null;
  private snapshot: { valor: string; inicio: number; fin: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ultimoEmitido: { codigo: string; t: number } | null = null;

  constructor(
    private readonly opciones: () => OpcionesDeteccion | null,
    private readonly onEscaneo: (codigo: string) => void,
    /**
     * Reloj de cada tecla. Por defecto el timeStamp del evento (cuándo se generó la
     * tecla), no cuándo se procesa: si el hilo principal está ocupado 100 ms, las
     * teclas encoladas conservan sus intervalos reales y la ráfaga no se corta.
     */
    private readonly ahora: (e: KeyboardEvent) => number = (e) => e.timeStamp || performance.now(),
    private readonly diagnostico?: (e: EventoDiagnostico) => void,
  ) {}

  /** Handler para window.addEventListener("keydown", h, { capture: true }). */
  readonly onKeyDown = (e: KeyboardEvent): void => {
    const opts = this.opciones();
    if (!opts) return;
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return this.abortar();
    const target = (e.target instanceof Element ? e.target : null) ?? document.activeElement;
    if (target && opts.ignorarSiFocoEn?.(target)) return;
    if (TECLAS_MODIFICADORAS.has(e.key)) return; // la pistola manda Shift antes de mayúsculas

    const t = this.ahora(e);
    const intervalo = this.buffer ? t - this.ultimo : null;
    // Ráfaga ya confirmada (≥ minLength teclas a ritmo de máquina, imposible para una
    // persona): se tolera un hipo de hasta 3× el intervalo (Bluetooth, hilo ocupado) sin
    // partir el código en dos. Mientras no está confirmada, rige el intervalo estricto.
    const tolerancia =
      this.buffer.length >= opts.minLength ? opts.maxIntervalMs * 3 : opts.maxIntervalMs;
    const enRafaga = intervalo !== null && intervalo <= tolerancia;
    this.diagnostico?.({
      tipo: "tecla",
      key: e.key,
      intervaloMs: intervalo === null ? null : Math.round(intervalo),
      enRafaga,
    });

    if ((opts.sufijos as readonly string[]).includes(e.key)) {
      if (enRafaga && this.buffer.length >= opts.minLength) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const crudo = this.buffer;
        this.restaurarInput();
        this.limpiar();
        this.emitir(crudo, opts.prefijo, t);
      } else {
        if (this.buffer.length > 1)
          this.diagnostico?.({
            tipo: "descartado",
            motivo: enRafaga ? `menos de ${opts.minLength} caracteres` : "tipeo lento",
            buffer: this.buffer,
          });
        this.abortar(); // Enter/Tab normal: primero devuelve lo bloqueado, después sigue su curso
      }
      return;
    }

    if (e.key.length !== 1) return this.abortar(); // flechas, Backspace, etc.

    if (!enRafaga) {
      // Posible inicio de ráfaga: la tecla pasa (no se puede saber todavía).
      this.abortar();
      this.buffer = e.key;
      this.ultimo = t;
      const el = document.activeElement;
      if (esEditable(el)) {
        this.objetivo = el;
        this.snapshot = {
          valor: el.value,
          inicio: el.selectionStart ?? el.value.length,
          fin: el.selectionEnd ?? el.value.length,
        };
      }
      this.programarVencimiento(opts.maxIntervalMs);
      return;
    }

    // Dentro de una ráfaga: se bloquea (no contamina el input).
    e.preventDefault();
    this.buffer += e.key;
    this.tragadas += e.key;
    this.ultimo = t;
    this.programarVencimiento(opts.maxIntervalMs);
  };

  /**
   * Para pointerdown/focusout (fase de captura): si había teclas retenidas
   * esperando a ver si era una ráfaga, vuelven al input YA, antes de que un
   * click o un blur lean el valor (ej: tipear "30" rápido y tocar "Guardar").
   */
  readonly onInterrupcion = (): void => {
    if (this.buffer) this.abortar();
  };

  /**
   * beforeinput (fase de captura): las teclas retenidas NO generan beforeinput
   * (su keydown se canceló), así que si llega uno con teclas retenidas es texto
   * que entra por otro lado (autocompletar, IME, un carácter sin keydown):
   * primero vuelven las retenidas y el orden de lo tipeado se respeta.
   */
  readonly onTextoExterno = (): void => {
    if (this.tragadas) this.abortar();
  };

  /** Libera timers (al desmontar). */
  destruir(): void {
    this.abortar();
  }

  private programarVencimiento(maxIntervalMs: number) {
    if (this.timer) clearTimeout(this.timer);
    // Si la ráfaga se corta sin sufijo, no era un escaneo: devolver lo bloqueado.
    this.timer = setTimeout(() => {
      if (this.buffer.length > 1)
        this.diagnostico?.({
          tipo: "descartado",
          motivo: "sin sufijo (Enter/Tab)",
          buffer: this.buffer,
        });
      this.abortar();
    }, maxIntervalMs * 4); // > tolerancia de una ráfaga confirmada (3×)
  }

  private emitir(crudo: string, prefijo: string, t: number) {
    const sinPrefijo = prefijo && crudo.startsWith(prefijo) ? crudo.slice(prefijo.length) : crudo;
    const codigo = normalizarCodigoBarras(sinPrefijo.trim());
    if (!codigo) return;
    // Algunas pistolas disparan dos veces: mismo código en < 300 ms = un solo escaneo.
    if (
      this.ultimoEmitido &&
      this.ultimoEmitido.codigo === codigo &&
      t - this.ultimoEmitido.t < DEDUPE_MS
    )
      return;
    this.ultimoEmitido = { codigo, t };
    this.diagnostico?.({ tipo: "escaneo", codigo, crudo });
    this.onEscaneo(codigo);
  }

  /** El input vuelve a como estaba antes de la ráfaga (saca el 1er carácter que se coló). */
  private restaurarInput() {
    const el = this.objetivo;
    const s = this.snapshot;
    if (!el || !s || !el.isConnected || el.value === s.valor) return;
    reemplazar(el, s.valor, 0, el.value.length);
    try {
      el.setSelectionRange(s.inicio, s.fin);
    } catch {
      /* inputs sin selección */
    }
  }

  /** No era un escaneo: las teclas bloqueadas vuelven al input donde iban (aunque ya no tenga el foco). */
  private abortar() {
    const el = this.objetivo;
    if (this.tragadas && el && el.isConnected) {
      const inicio = el.selectionStart ?? el.value.length;
      const fin = el.selectionEnd ?? el.value.length;
      reemplazar(el, this.tragadas, inicio, fin);
    }
    this.limpiar();
  }

  private limpiar() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.buffer = "";
    this.tragadas = "";
    this.objetivo = null;
    this.snapshot = null;
  }
}
