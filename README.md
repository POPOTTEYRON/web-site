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
npm run test:e2e    # navigateur (Playwright/Chromium) : mobile, tablette, ordinateur
```

## Variables d'environnement

Voir `.env.example`. `MAIL_TRANSPORT=file` (par défaut) écrit les emails dans `var/mail/` au lieu de les envoyer.

## Modifier le contenu

- **Carte et prix** : `content/menu.json` (noms FR/EN, description, prix en euros, allergènes).
- **Adresse, téléphone, horaires** : `content/restaurant.json`.
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
