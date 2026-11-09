// Ti Mango — améliorations progressives. Le site fonctionne sans ce script.
(() => {
  'use strict';

  // --- Menu de navigation mobile ---
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  if (toggle && nav) {
    const label = toggle.querySelector('.nav-toggle__label');
    const set = (open) => {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      label.textContent = open ? toggle.dataset.labelClose : toggle.dataset.labelOpen;
    };
    toggle.addEventListener('click', () => set(toggle.getAttribute('aria-expanded') !== 'true'));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) { set(false); toggle.focus(); }
    });
  }

  // --- Onglets de la carte (sans JS : toutes les catégories s'affichent l'une sous l'autre) ---
  const menu = document.querySelector('[data-tabs]');
  if (menu) {
    const list = menu.querySelector('[data-tablist]');
    const tabs = [...menu.querySelectorAll('[data-tab]')];
    const panels = [...menu.querySelectorAll('[data-panel]')];
    list.setAttribute('role', 'tablist');
    list.querySelectorAll('li').forEach((li) => li.setAttribute('role', 'presentation'));
    tabs.forEach((tab) => {
      const id = tab.dataset.tab;
      tab.setAttribute('role', 'tab');
      tab.id = `tab-${id}`;
      tab.setAttribute('aria-controls', id);
    });
    panels.forEach((p) => {
      p.setAttribute('role', 'tabpanel');
      p.setAttribute('aria-labelledby', `tab-${p.dataset.panel}`);
      p.tabIndex = 0;
    });
    const select = (id, focus) => {
      tabs.forEach((t) => {
        const on = t.dataset.tab === id;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        if (on && focus) t.focus();
      });
      panels.forEach((p) => { p.hidden = p.dataset.panel !== id; });
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        select(tab.dataset.tab, false);
        history.replaceState(null, '', `#${tab.dataset.tab}`);
      });
      tab.addEventListener('keydown', (e) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (step) { e.preventDefault(); select(tabs[(i + step + tabs.length) % tabs.length].dataset.tab, true); }
        if (e.key === 'Home') { e.preventDefault(); select(tabs[0].dataset.tab, true); }
        if (e.key === 'End') { e.preventDefault(); select(tabs[tabs.length - 1].dataset.tab, true); }
      });
    });
    const initial = tabs.find((t) => `#${t.dataset.tab}` === location.hash) || tabs[0];
    menu.setAttribute('data-tabs-ready', '');
    select(initial.dataset.tab, false);
  }

  // --- Réservation : étape 1–2 (choix du nombre de personnes et de la date) ---
  const pick = document.querySelector('form[data-autosubmit]');
  if (pick) {
    const other = pick.querySelector('[data-other-date]');
    const radios = [...pick.querySelectorAll('input[type=radio][name=date]')];
    const submit = () => { if (pick.querySelector('input[name=date]:checked') || (other && other.value)) pick.requestSubmit(); };
    pick.querySelectorAll('input[name=personnes]').forEach((r) => r.addEventListener('change', submit));
    radios.forEach((r) => r.addEventListener('change', () => { if (other) other.value = ''; submit(); }));
    if (other) other.addEventListener('change', () => { if (other.value) { radios.forEach((r) => { r.checked = false; }); submit(); } });
  }

  // --- Réservation : étapes 3–4 (heure, coordonnées) ---
  const form = document.querySelector('form[data-validate]');
  if (form) {
    const msg = form.dataset;
    // Plus strict que le navigateur : exige un domaine avec extension (nom@domaine.fr).
    const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;
    const summary = form.querySelector('[data-error-summary]');
    const timeOut = form.querySelector('[data-summary-time]');
    form.querySelectorAll('input[name=heure]').forEach((r) => r.addEventListener('change', () => {
      if (timeOut) timeOut.textContent = ` · ${r.nextElementSibling.textContent.trim()}`;
      clearError(form.querySelector('[data-slot-group]'));
    }));

    const errorFor = (el) => {
      if (el.name === 'heure') return form.querySelector('input[name=heure]:checked') ? '' : msg.msgSlot;
      if (el.type === 'checkbox') return el.checked ? '' : msg.msgConsent;
      if (el.validity.valueMissing || (el.required && !el.value.trim())) return msg.msgRequired;
      if (el.type === 'email' && (el.validity.typeMismatch || !EMAIL.test(el.value.trim()))) return msg.msgEmail;
      if (el.type === 'tel' && el.validity.patternMismatch) return msg.msgPhone;
      return '';
    };
    const holder = (el) => (el.name === 'heure' ? form.querySelector('[data-slot-group]') : el.closest('.field, .check'));
    function clearError(box) {
      if (!box) return;
      box.querySelector(':scope > .field-error')?.remove();
      box.querySelectorAll('[aria-invalid]').forEach((i) => { i.removeAttribute('aria-invalid'); i.removeAttribute('aria-describedby'); });
    }
    const showError = (el, text) => {
      const box = holder(el);
      clearError(box);
      if (!text) return;
      const p = document.createElement('p');
      p.className = 'field-error';
      p.id = `err-${el.name}`;
      p.textContent = text;
      box.appendChild(p);
      const target = el.name === 'heure' ? form.querySelector('input[name=heure]') : el;
      target.setAttribute('aria-invalid', 'true');
      target.setAttribute('aria-describedby', p.id);
    };

    const fields = () => {
      const seen = new Set();
      return [...form.querySelectorAll('input[required], textarea[required]')].filter((el) => {
        if (el.name === 'heure') { if (seen.has('heure')) return false; seen.add('heure'); }
        return true;
      });
    };
    // Les erreurs disparaissent pendant la saisie (jamais au moment de quitter le champ :
    // le décalage de la page ferait manquer le clic sur le bouton d'envoi).
    fields().forEach((el) => {
      if (el.name === 'heure') return;
      const fix = () => { if (el.hasAttribute('aria-invalid') && !errorFor(el)) clearError(holder(el)); };
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', fix);
      el.addEventListener('blur', () => {
        const text = el.value ? errorFor(el) : '';
        if (text) showError(el, text);
      });
    });
    form.addEventListener('submit', (e) => {
      let first = null;
      for (const el of fields()) {
        const text = errorFor(el);
        showError(el, text);
        if (text && !first) first = el.name === 'heure' ? form.querySelector('input[name=heure]') : el;
      }
      if (first) {
        e.preventDefault();
        summary.textContent = msg.msgSummary;
        summary.hidden = false;
        first.focus();
      } else {
        summary.hidden = true;
        form.querySelector('button[type=submit]').disabled = true;
        form.setAttribute('aria-busy', 'true');
      }
    });
  }
})();

// Retour arrière (cache du navigateur) : réactiver le bouton d'envoi.
window.addEventListener('pageshow', () => {
  document.querySelectorAll('form[aria-busy] button[type=submit]').forEach((b) => { b.disabled = false; b.closest('form').removeAttribute('aria-busy'); });
});
