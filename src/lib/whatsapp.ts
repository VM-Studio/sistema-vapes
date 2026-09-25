/**
 * Link de WhatsApp (https://wa.me/<número>?text=...). El número va en formato
 * internacional sin "+": para Argentina, 54 + 9 (celulares) + área + número.
 * Si no hay teléfono, el link abre WhatsApp para elegir el contacto.
 */
export function numeroWhatsApp(telefono: string | null | undefined): string | null {
  let d = (telefono ?? "").replace(/\D/g, "");
  if (d.length < 8) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54")) return d;
  if (d.startsWith("0")) d = d.slice(1);
  // "15" local de celular (ej: 11 15 5555-1234): WhatsApp usa 9 + área + número.
  if (d.length === 12 && d.slice(2, 4) === "15") d = d.slice(0, 2) + d.slice(4);
  return `549${d}`;
}

export function linkWhatsApp(telefono: string | null | undefined, texto: string): string {
  const numero = numeroWhatsApp(telefono);
  return `https://wa.me/${numero ?? ""}?text=${encodeURIComponent(texto)}`;
}

export function textoComprobante(p: {
  negocio: string;
  ventaNumero: number;
  total: string;
  comprobante: string | null;
  urlPdf: string | null;
  saldoPendiente?: string | null;
}): string {
  return [
    `¡Gracias por tu compra en ${p.negocio}!`,
    `Venta #${p.ventaNumero}${p.comprobante ? ` · ${p.comprobante}` : ""}`,
    `Total: ${p.total}`,
    ...(p.saldoPendiente ? [`Saldo pendiente: ${p.saldoPendiente}`] : []),
    ...(p.urlPdf ? [`Tu comprobante: ${p.urlPdf}`] : []),
  ].join("\n");
}
