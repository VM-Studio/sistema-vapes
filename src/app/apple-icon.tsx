import { renderAppIcon } from "@/lib/app-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS aplica sus propias esquinas redondeadas: va cuadrado. */
export default function AppleIcon() {
  return renderAppIcon(180, { redondeado: false });
}
