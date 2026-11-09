// Admin : demande de confirmation avant les actions irréversibles (sans JS, l'action s'exécute directement).
document.querySelectorAll('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (e) => { if (!window.confirm(form.dataset.confirm)) e.preventDefault(); });
});
