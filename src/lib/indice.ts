// Le rythme de l'indice du geste — spec: specs/bienvenue-v1.md (FR-12), le raisonnement et les sources y sont.
//
// - 1 s après que le paquet est à l'écran : le temps d'y poser les yeux, sans attendre (limite de 1 s de
//   Nielsen : au-delà, le fil de la pensée se rompt ; en deçà, l'animation se perd dans le défilement).
// - Puis, tant qu'aucun geste : 8 s, 16 s, 32 s d'écart. Le premier rappel tombe juste avant la limite
//   d'attention de 10 s (Nielsen) et dans la fenêtre où un visiteur décide de rester ; l'écart double
//   ensuite, pour ne pas devenir un bruit visuel qu'on cesse de voir (habituation) ; le dernier vers 1 min.
// - Quatre passages au plus par venue à l'écran, de 1,6 s chacun (sous les 5 s de WCAG 2.2.2) ; de nouveau
//   à chaque retour du paquet à l'écran ou de l'onglet ; plus jamais après un geste.

export const INDICE_ARRIVEE_MS = 1000;
export const INDICE_RELANCES_MS = [8000, 16000, 32000] as const;

/** Le délai avant le prochain passage, après `joues` passages depuis l'arrivée à l'écran ; null : c'est fini. */
export function prochainIndice(joues: number): number | null {
  if (joues <= 0) return INDICE_ARRIVEE_MS;
  return INDICE_RELANCES_MS[joues - 1] ?? null;
}

/** Une fois le geste fait au doigt ou à la souris, il est appris : plus d'indice de la séance. */
const CLE_APPRIS = "catalog-geste-appris";

export function gesteAppris(): boolean {
  try {
    return window.sessionStorage.getItem(CLE_APPRIS) === "1";
  } catch {
    return false;
  }
}

export function noterGesteAppris(): void {
  try {
    window.sessionStorage.setItem(CLE_APPRIS, "1");
  } catch {
    // Stockage refusé : l'indice reviendra à la prochaine page, sans plus.
  }
}
