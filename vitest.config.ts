// Vitest config — used only when running `npm test`.
// Picked up automatically from project root.

import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // Resolve `@/*` aliases the same way tsconfig.json does — so test files can
  // `import from "@/lib/..."` without sprinkling relative paths everywhere.
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
