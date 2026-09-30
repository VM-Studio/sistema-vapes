// Tipos de los imports estáticos de imágenes (`import x from "…/foto.png"`).
// Los trae next-env.d.ts, pero ese archivo no se versiona (lo genera `next`):
// sin esta referencia, el typecheck del CI falla antes de cualquier build.
/// <reference types="next/image-types/global" />
