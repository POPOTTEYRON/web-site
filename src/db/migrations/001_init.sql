-- Ti Mango — schéma initial.
-- Les horaires hebdomadaires restent dans content/restaurant.json (affichés partout, rarement modifiés).

-- Règles de réservation, une seule ligne, modifiables dans l'admin.
CREATE TABLE reglages (
  id                      smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  capacite_en_ligne       smallint NOT NULL DEFAULT 36 CHECK (capacite_en_ligne BETWEEN 1 AND 42),
  capacite_salle          smallint NOT NULL DEFAULT 42 CHECK (capacite_salle BETWEEN 1 AND 500),
  duree_table_min         smallint NOT NULL DEFAULT 90 CHECK (duree_table_min BETWEEN 30 AND 300),
  intervalle_min          smallint NOT NULL DEFAULT 30 CHECK (intervalle_min IN (15, 30, 60)),
  delai_min_min           smallint NOT NULL DEFAULT 60 CHECK (delai_min_min BETWEEN 0 AND 2880),
  jours_max               smallint NOT NULL DEFAULT 60 CHECK (jours_max BETWEEN 1 AND 365),
  personnes_max_en_ligne  smallint NOT NULL DEFAULT 8 CHECK (personnes_max_en_ligne BETWEEN 1 AND 42),
  modifie_le              timestamptz NOT NULL DEFAULT now(),
  CHECK (capacite_en_ligne <= capacite_salle),
  CHECK (personnes_max_en_ligne <= capacite_en_ligne)
);
INSERT INTO reglages DEFAULT VALUES;

-- Fermetures exceptionnelles (congés, privatisation…).
CREATE TABLE fermetures (
  date     date PRIMARY KEY,
  motif    text CHECK (char_length(motif) <= 120),
  cree_le  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE statut_reservation AS ENUM ('confirmee', 'annulee_client', 'annulee_restaurant', 'honoree', 'absent');

CREATE TABLE reservations (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reference        text NOT NULL UNIQUE CHECK (reference ~ '^[A-Z0-9]{8}$'),
  date             date NOT NULL,
  heure            time NOT NULL,
  personnes        smallint NOT NULL CHECK (personnes BETWEEN 1 AND 500),
  nom              text NOT NULL CHECK (char_length(nom) BETWEEN 1 AND 80),
  telephone        text NOT NULL CHECK (char_length(telephone) BETWEEN 6 AND 20),
  email            text CHECK (email IS NULL OR (char_length(email) <= 120 AND email = lower(email) AND email LIKE '%_@_%._%')),
  remarque         text CHECK (char_length(remarque) <= 500),
  langue           text NOT NULL DEFAULT 'fr' CHECK (langue IN ('fr', 'en')),
  statut           statut_reservation NOT NULL DEFAULT 'confirmee',
  source           text NOT NULL CHECK (source IN ('en_ligne', 'telephone')),
  jeton_hash       bytea UNIQUE,
  consentement_le  timestamptz,
  email_envoye_le  timestamptz,
  annule_le        timestamptz,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  -- Une réservation en ligne a toujours un email, un jeton d'accès et un consentement.
  CHECK (source <> 'en_ligne' OR (email IS NOT NULL AND jeton_hash IS NOT NULL AND consentement_le IS NOT NULL)),
  CHECK ((statut IN ('annulee_client', 'annulee_restaurant')) = (annule_le IS NOT NULL))
);
-- Calcul de capacité : réservations actives d'une date.
CREATE INDEX reservations_date_actives ON reservations (date, heure) WHERE statut IN ('confirmee', 'honoree');

CREATE TABLE admins (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email               text NOT NULL UNIQUE CHECK (email = lower(email)),
  mot_de_passe_hash   text NOT NULL,
  derniere_connexion  timestamptz,
  cree_le             timestamptz NOT NULL DEFAULT now()
);

-- Sessions de l'espace admin (connect-pg-simple).
CREATE TABLE session (
  sid     varchar NOT NULL PRIMARY KEY,
  sess    json NOT NULL,
  expire  timestamp(6) NOT NULL
);
CREATE INDEX session_expire ON session (expire);
