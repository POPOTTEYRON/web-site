# Ti Mango — site du restaurant (démonstration)

> Entreprise **fictive**. Aucun email réel n'est envoyé, aucun paiement n'existe.

Site vitrine bilingue (FR/EN) avec carte, galerie et réservation en ligne, plus un espace administrateur pour gérer les réservations.
Pile : Node.js 22, Express 5, gabarits Eta rendus côté serveur, PostgreSQL 16.

## Prérequis

- Node.js ≥ 22
- PostgreSQL 16

## Installation locale

```bash
npm install
cp .env.example .env          # puis renseigner DATABASE_URL et SESSION_SECRET
```

Créer la base (une fois) :

```bash
sudo -u postgres psql -c "CREATE ROLE timango LOGIN PASSWORD 'mot_de_passe_local';" \
  -c "CREATE DATABASE timango OWNER timango;" -c "CREATE DATABASE timango_test OWNER timango;"
```

```bash
npm run db:migrate                                  # applique src/db/migrations
npm run admin:creer -- gerant@exemple.fr            # crée le compte admin (mot de passe demandé, 12 caractères min.)
npm run dev                                         # http://localhost:3000 — admin : /admin
```

## Réservations et emails

- La réservation en ligne vérifie la capacité côté serveur, sous verrou PostgreSQL par date : pas de surréservation, même en cas de demandes simultanées.
- Règles modifiables dans l'admin (Réglages) : couverts en ligne, capacité de la salle, durée d'une table, intervalle des créneaux, délai minimum, horizon de réservation, fermetures exceptionnelles.
- **Emails : avec `MAIL_TRANSPORT=file` (par défaut), aucun email ne part.** Chaque message est écrit en `.eml` dans `var/mail/` (ouvrable avec n'importe quel client mail). L'envoi réel (`smtp`) ne doit être activé qu'en production.
- Le client reçoit un lien secret de gestion (`/reservation/<jeton>`) qui lui permet d'annuler. Seule l'empreinte SHA-256 du jeton est stockée.

## Tests

Les tests utilisent `.env.test` (même format que `.env.example`, base `timango_test`).

```bash
npm test            # unitaires + intégration
npm run test:e2e    # navigateur (Playwright/Chromium) : parcours, clavier, accessibilité (axe), HTML, liens
```

## Règles métier

| Règle | Valeur par défaut (modifiable dans Admin › Réglages) |
|---|---|
| Couverts réservables en ligne, simultanément | 36 (les 6 autres restent pour les clients sans réservation) |
| Capacité de la salle (réservations saisies par le restaurant) | 42 |
| Durée d'occupation d'une table | 1 h 30 |
| Créneaux | toutes les 30 min, de l'ouverture jusqu'à fermeture − durée d'une table (11h30 → 20h30) |
| Groupe maximum en ligne | 8 (au-delà : téléphone) |
| Délai minimum (jour même) | 1 h |
| Horizon | 60 jours |

- Une réservation identique (même email, date, heure) n'est créée qu'une fois (double-clic, renvoi du formulaire).
- Le client peut annuler par son lien jusqu'à l'heure de la réservation ; les couverts sont libérés immédiatement.
- « Honorée », « Absent », « Rétablir » : seulement le jour même ou après. « Annuler » (restaurant) : seulement avant l'heure ; le client est prévenu par email. Une réservation annulée ne se rétablit pas.
- Un statut « absent » libère les couverts ; « honorée » les occupe.
- Fermeture exceptionnelle sur un jour déjà réservé : refusée tant que le restaurateur ne coche pas « annuler et prévenir » ; les clients sans email sont listés pour être appelés.
- Changer un réglage ne modifie jamais les réservations existantes ; il s'applique aux nouvelles.

## Base de données

Migrations SQL versionnées dans `src/db/migrations/` (appliquées dans l'ordre, chacune dans une transaction) :

| Table | Contenu |
|---|---|
| `reservations` | Réservations (en ligne / téléphone), statut, consentement, empreinte du jeton client |
| `reglages` | Règles de réservation et durée de conservation (une seule ligne, modifiable dans l'admin) |
| `fermetures` | Fermetures exceptionnelles |
| `admins` | Comptes administrateur (mot de passe haché argon2id) |
| `session` | Sessions de l'admin |

Les règles essentielles sont aussi garanties par la base (contraintes `CHECK`) : une réservation en ligne a toujours un email, un jeton et un consentement ; une réservation anonymisée n'a plus aucune coordonnée, etc.

```bash
npm run donnees:demo -- --reinitialiser   # développement : ~150 réservations fictives (refusé en production)
npm run donnees:purger                    # anonymise les réservations au-delà de la durée de conservation
```

**Conservation (RGPD)** : la remarque (qui peut contenir une allergie) est effacée 30 jours après la réservation ; nom, téléphone et email sont effacés automatiquement `conservation_mois` mois après la date de la réservation (12 par défaut, à valider). Le serveur le fait au démarrage puis toutes les 24 h. L'admin peut aussi effacer à la demande les données d'une réservation passée ou annulée. Date, heure, couverts et statut sont conservés pour l'activité.

**Sauvegarde** (à planifier chez l'hébergeur) :

```bash
pg_dump --format=custom --file=timango-$(date +%F).dump "$DATABASE_URL"
pg_restore --clean --if-exists --dbname="$DATABASE_URL" timango-AAAA-MM-JJ.dump
```

## Sécurité et RGPD

Voir [`docs/conformite.md`](docs/conformite.md) : mesures en place, registre des traitements (projet), cookies, et liste de ce qui reste à compléter ou faire valider avant la mise en ligne.

## Variables d'environnement

Voir `.env.example`. `MAIL_TRANSPORT=file` (par défaut) écrit les emails dans `var/mail/` au lieu de les envoyer.

## Modifier le contenu

- **Carte et prix** : `content/menu.json` (noms FR/EN, description, prix en euros, allergènes).
- **Adresse, téléphone, horaires** : `content/restaurant.json`. Tous les textes d'horaires du site (bandeau, tableau, « réouverture… », données Google) sont calculés depuis ce fichier.
- **Textes de l'interface** : `src/i18n/fr.json` et `src/i18n/en.json` (mêmes clés dans les deux fichiers, vérifié par les tests).

Redémarrer le serveur après modification.

## Arborescence

```
src/        serveur (config, routes, domaine, base, emails, vues)
content/    contenu éditable (carte)
public/     CSS, JS, polices, images
scripts/    utilitaires (création admin, données de test)
tests/      unitaires, intégration, bout en bout
```
