-- Phase 8 : conservation des données (RGPD), traçabilité des modifications, contraintes nommées.

-- 1. Contraintes nommées explicitement (messages d'erreur lisibles).
ALTER TABLE reservations RENAME CONSTRAINT reservations_check1 TO reservation_annulation_coherente;
ALTER TABLE reservations DROP CONSTRAINT reservations_check;

-- 2. Anonymisation : les coordonnées sont effacées, les données utiles à l'activité restent
--    (date, heure, couverts, statut, source) pour les statistiques.
ALTER TABLE reservations ADD COLUMN anonymise_le timestamptz;
ALTER TABLE reservations ALTER COLUMN nom DROP NOT NULL, ALTER COLUMN telephone DROP NOT NULL;

ALTER TABLE reservations
  ADD CONSTRAINT reservation_coordonnees_presentes
    CHECK (anonymise_le IS NOT NULL OR (nom IS NOT NULL AND telephone IS NOT NULL)),
  ADD CONSTRAINT reservation_en_ligne_complete
    CHECK (source <> 'en_ligne' OR anonymise_le IS NOT NULL
           OR (email IS NOT NULL AND jeton_hash IS NOT NULL AND consentement_le IS NOT NULL)),
  ADD CONSTRAINT reservation_anonymisee_vide
    CHECK (anonymise_le IS NULL
           OR (nom IS NULL AND telephone IS NULL AND email IS NULL AND remarque IS NULL AND jeton_hash IS NULL));

-- Recherche des réservations à anonymiser.
CREATE INDEX reservations_a_anonymiser ON reservations (date) WHERE anonymise_le IS NULL;

-- 3. Durée de conservation des coordonnées, en mois après la date de la réservation (à valider : 12 proposé).
ALTER TABLE reglages ADD COLUMN conservation_mois smallint NOT NULL DEFAULT 12
  CHECK (conservation_mois BETWEEN 1 AND 120);

-- 4. modifie_le tenu à jour automatiquement à chaque modification.
CREATE FUNCTION maj_modifie_le() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.modifie_le := now();
  RETURN NEW;
END $$;

CREATE TRIGGER reservations_modifie_le BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION maj_modifie_le();
CREATE TRIGGER reglages_modifie_le BEFORE UPDATE ON reglages
  FOR EACH ROW EXECUTE FUNCTION maj_modifie_le();
