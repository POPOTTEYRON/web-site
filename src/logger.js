// Journalisation des erreurs sans données personnelles.
// Les erreurs PostgreSQL contiennent dans `detail` la ligne refusée (nom, téléphone, email…) :
// on ne journalise que le message, le code, la contrainte et la pile.
export function logError(err, context = '') {
  const parts = [
    `[erreur]${context ? ` ${context}` : ''}`,
    err?.message ?? String(err),
    err?.code ? `code=${err.code}` : '',
    err?.constraint ? `contrainte=${err.constraint}` : '',
  ].filter(Boolean);
  console.error(parts.join(' '));
  if (err?.stack) console.error(err.stack.split('\n').slice(1, 6).join('\n'));
}
