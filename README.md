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
npm run db:migrate            # applique src/db/migrations
npm run dev                   # http://localhost:3000
```

## Tests

Les tests utilisent `.env.test` (même format que `.env.example`, base `timango_test`).

```bash
npm test
```

## Variables d'environnement

Voir `.env.example`. `MAIL_TRANSPORT=file` (par défaut) écrit les emails dans `var/mail/` au lieu de les envoyer.

## Arborescence

```
src/        serveur (config, routes, domaine, base, emails, vues)
content/    contenu éditable (carte)
public/     CSS, JS, polices, images
scripts/    utilitaires (création admin, données de test)
tests/      unitaires, intégration, bout en bout
```
