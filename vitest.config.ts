import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resuelve los alias de rutas declarados en tsconfig.json
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    // Los tests viven en `test/`, espejando la estructura de `src/`: hay cuatro
    // nombres repetidos —capacidad, tipo-servicio, transferencia, simulacion—
    // entre consulta y edición, así que una carpeta plana no valdría.
    include: ['test/**/*.spec.ts'],
  },
});
