import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Graphiques Bklit : code du registre shadcn, copié tel quel pour rester à jour avec
    // `npx shadcn add @bklit/...` ; on ne le réécrit pas pour nos règles.
    "src/components/charts/**",
    // Skills et documentation des agents : du code d'exemple tiers, pas celui de Catalog.
    ".claude/**",
  ]),
  // Mouvement (spec design-system-v2 § 4.3) : hors de src/lib/motion.ts et de components/motion/,
  // on n'écrit pas de tween, on appelle un préréglage.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/motion.ts", "src/components/motion/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='gsap'][callee.property.name=/^(to|from|fromTo)$/]",
          message:
            "Mouvement : passer par un préréglage de src/lib/motion.ts (preset.enter, preset.swap, preset.slide). Spec design-system-v2 § 4.3.",
        },
      ],
    },
  },
]);

export default eslintConfig;
