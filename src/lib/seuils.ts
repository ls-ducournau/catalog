// Les seuils d'une bibliothèque qui démarre, partagés par l'accueil (serveur) et la bienvenue (navigateur) :
// ce module ne dépend de rien, pour que le paquet de cartes ne tire aucun module du serveur.

/** En dessous de ce nombre de titres, la bibliothèque « démarre » (seuil du score de compatibilité). */
export const DEMARRAGE_TITRES = 30;

/** Notes à donner avant les premières recommandations (MIN_RATED_TITLES, preferenceService.ts). */
export const NOTES_POUR_RECOS = 10;
