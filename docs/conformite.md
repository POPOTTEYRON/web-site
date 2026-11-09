# Ti Mango — sécurité et conformité

> Ce document décrit ce que le site met en œuvre et ce qui reste à faire valider.
> **Il ne constitue pas un avis juridique et ne garantit pas, à lui seul, la conformité au RGPD.**
> Les points marqués ⚠️ demandent une décision ou une vérification par l'exploitant ou un professionnel.

## 1. Mesures de sécurité en place

| Domaine | Mesure | Vérifiée par |
|---|---|---|
| Transport | HTTPS imposé en production (redirection 301, HSTS) ; `/sante` reste joignable pour l'hébergeur | `tests/integration/security.test.js` (serveur réel en mode production) |
| En-têtes | CSP stricte sans `unsafe-inline` ni ressource tierce, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy` | idem |
| Saisies | Validation côté serveur (zod) de chaque champ, taille des requêtes limitée (10 Ko) | `reservations.test.js`, `admin.test.js` |
| Base de données | Requêtes paramétrées uniquement ; règles critiques doublées par des contraintes SQL | `database.test.js` |
| Affichage | Échappement HTML automatique (Eta) ; aucune saisie client affichée sans échappement | test d'injection HTML, revue des sorties `<%~` |
| Formulaires publics | Contrôle d'origine (`Sec-Fetch-Site` / `Origin`), champ piège anti-robot, limitation de débit (10 réservations / 15 min / adresse IP) | `reservations.test.js` |
| Lien client | Jeton aléatoire de 256 bits ; seule son empreinte SHA-256 est stockée ; jamais transmis à un tiers (Referrer-Policy) ni journalisé | `reservations.test.js`, `security.test.js` |
| Administration | Mot de passe haché argon2id (12 caractères min.), aucun compte par défaut, message d'échec identique pour un compte inexistant, 5 tentatives / 15 min, session renouvelée à la connexion, cookie `HttpOnly` + `SameSite=Strict` + `Secure` limité à `/admin`, jeton CSRF sur chaque formulaire, expiration après 8 h d'inactivité | `admin.test.js`, `security.test.js` |
| Secrets | `.env` hors du dépôt ; configuration de production refusée si l'URL n'est pas en HTTPS, si le secret de session est factice ou si les emails ne partiraient pas réellement | `security.test.js` |
| Journaux | Aucune donnée personnelle (le détail des erreurs PostgreSQL, qui contient la ligne refusée, n'est pas écrit) ; jetons masqués | `security.test.js` |
| Erreurs | Pages d'erreur génériques, aucun détail technique montré au visiteur | `security.test.js` |
| Dépendances | 9 dépendances de production, `npm audit` : 0 vulnérabilité au 9 novembre 2026 | à relancer avant chaque mise en production |

**Limites connues**
- La limitation de débit est tenue en mémoire : elle est remise à zéro à chaque redémarrage et n'est pas partagée entre plusieurs instances. C'est suffisant pour une instance unique.
- Pas de double authentification sur l'admin. C'est raisonnable pour un compte unique ; à reconsidérer si plusieurs personnes s'y connectent.
- La sécurité de l'hébergement (pare-feu, mises à jour, sauvegardes) dépend de l'hébergeur retenu (phase 12).

## 2. Registre des traitements (projet — article 30 du RGPD)

### Traitement 1 — Réservations de table

| Rubrique | Contenu |
|---|---|
| Responsable | Ti Mango, 12 rue de la Plage, 97180 Sainte-Anne — ⚠️ représentant légal à compléter |
| Finalité | Enregistrer et gérer les réservations (confirmation, annulation, accueil, contact en cas d'imprévu) |
| Base légale | Mesures précontractuelles (art. 6.1.b). Allergie indiquée en remarque : consentement explicite (art. 9.2.a), recueilli par la case du formulaire |
| Personnes concernées | Clients qui réservent |
| Données | Nom, téléphone, email, nombre de personnes, date, heure, langue, remarque facultative, date du consentement |
| Données sensibles | Possibles : allergie dans la remarque (santé). Minimisation : usage limité au repas, effacement après 30 jours |
| Destinataires | Équipe du restaurant ; sous-traitants : ⚠️ hébergeur et fournisseur d'emails à désigner |
| Transferts hors UE | ⚠️ À vérifier selon les sous-traitants retenus (viser un hébergement dans l'UE) |
| Durées | Remarque : 30 jours après la réservation. Nom, téléphone, email : ⚠️ 12 mois proposés, à valider. Ensuite seules restent date, heure, couverts et statut, anonymes |
| Mise en œuvre de la durée | Automatique (au démarrage puis toutes les 24 h) + effacement à la demande dans l'admin |
| Sécurité | Voir section 1 |

### Traitement 2 — Accès à l'administration

| Rubrique | Contenu |
|---|---|
| Finalité | Authentifier le personnel autorisé |
| Données | Email et empreinte du mot de passe de l'administrateur, date de dernière connexion, session (8 h) |
| Base légale | Intérêt légitime (sécurité du service) |
| Durée | Tant que le compte existe ; sessions supprimées à expiration |

### Cookies

| Cookie | Où | Rôle | Durée | Consentement |
|---|---|---|---|---|
| `tm_admin` | `/admin` uniquement | Session de l'administrateur | 8 h d'inactivité | Non requis (strictement nécessaire) |

Le site public ne dépose **aucun cookie**, ne charge aucune ressource tierce (polices et scripts hébergés sur le site, plan chargé seulement sur clic vers OpenStreetMap) et n'utilise aucune mesure d'audience. **Aucun bandeau cookies n'est donc nécessaire en l'état.** Si une mesure d'audience est ajoutée plus tard, il faudra revoir ce point.

### Exercice des droits

- **Accès, rectification, opposition** : par email à l'adresse du restaurant, traitement manuel.
- **Effacement** : bouton « Effacer les données personnelles » dans l'admin, pour une réservation passée ou annulée.
- **Retrait du consentement pour une allergie** : effacement de la remarque à la demande.
- ⚠️ Prévoir une procédure interne : délai de réponse d'un mois, vérification de l'identité du demandeur.

### Violation de données

⚠️ À formaliser par l'exploitant : qui prévient, notification à la CNIL sous 72 h si le risque est avéré, information des personnes si le risque est élevé.

## 3. À compléter ou faire valider avant la mise en ligne

| # | Élément | Où | Responsable |
|---|---|---|---|
| 1 | Forme juridique, capital, RCS/SIRET, TVA, directeur·rice de la publication | `src/views/pages/legal.*.eta` | Exploitant |
| 2 | Hébergeur (nom, adresse, téléphone) | mentions légales, politique de confidentialité | Exploitant + phase 12 |
| 3 | Fournisseur d'emails et localisation des données | politique de confidentialité, registre | Exploitant + phase 12 |
| 4 | Durée de conservation des coordonnées (12 mois proposés) | Admin › Réglages, politique de confidentialité | Exploitant |
| 5 | Relecture juridique des mentions légales, de la politique de confidentialité et du registre | `docs/conformite.md`, pages légales | Professionnel du droit |
| 6 | Descriptions des plats et **allergènes** (affichés comme exemples à valider) | `content/menu.json` | Restaurateur |
| 7 | Mention « Prix en euros, service compris » (prix nets obligatoires en restauration) | `src/i18n/*.json` (`menu.intro`) | Restaurateur |
| 8 | Procédures internes : demandes d'exercice des droits, violation de données | registre ci-dessus | Exploitant |
| 9 | Photos : droits d'auteur et droit à l'image des personnes photographiées | futures photos | Exploitant |
