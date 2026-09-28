import { defineConfig } from "@playwright/test";

// Système de design v2, phase 0 (specs/design-system-v2-raycast.md § 8.5) : captures des écrans aux
// trois largeurs, sur le serveur de développement. Chrome installé (`channel`), aucun navigateur
// à télécharger. Lecture seule : les tests ne cliquent jamais sur une action qui écrit.
export default defineConfig({
  testDir: "./tests",
  outputDir: "./tests/.results",
  fullyParallel: false,
  workers: 2,
  timeout: 90_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.CATALOG_URL ?? "http://localhost:3000",
    channel: "chrome",
    reducedMotion: "reduce",
    colorScheme: "dark",
    locale: "fr-FR",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "telephone",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
    },
    { name: "tablette", use: { viewport: { width: 834, height: 1112 }, deviceScaleFactor: 1 } },
    { name: "ordinateur", use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  ],
});
