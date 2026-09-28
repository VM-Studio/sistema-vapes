/** "Chrome en Android" a partir del User-Agent (para listar sesiones abiertas). */
export function dispositivo(ua: string | null): string {
  if (!ua) return "Dispositivo desconocido";
  const so = /android/i.test(ua)
    ? "Android"
    : /iphone|ipad/i.test(ua)
      ? "iPhone / iPad"
      : /windows/i.test(ua)
        ? "Windows"
        : /mac os/i.test(ua)
          ? "Mac"
          : /linux/i.test(ua)
            ? "Linux"
            : "Otro";
  const nav = /edg\//i.test(ua)
    ? "Edge"
    : /chrome|crios/i.test(ua)
      ? "Chrome"
      : /firefox|fxios/i.test(ua)
        ? "Firefox"
        : /safari/i.test(ua)
          ? "Safari"
          : "Navegador";
  return `${nav} en ${so}`;
}
