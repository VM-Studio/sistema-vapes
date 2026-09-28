import type { Metadata } from "next";

import { NuevaCotizacion } from "../../nueva-cotizacion";

export const metadata: Metadata = { title: "Cotizar por unidad" };

export default function Page() {
  return <NuevaCotizacion tipo="UNITARIA" />;
}
