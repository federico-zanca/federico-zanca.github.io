document.querySelectorAll('.copy-code').forEach(button => {
  button.addEventListener('click', async () => {
    const source = button.closest('.code-block').querySelector('.copy-source').value;
    try {
      await navigator.clipboard.writeText(source);
      button.textContent = 'Copied';
    } catch {
      button.closest('.code-block').querySelector('details').open = true;
      button.textContent = 'Select';
      const range = document.createRange();
      range.selectNodeContents(button.closest('.code-block').querySelector('.code-scroll'));
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    }
    window.setTimeout(() => { button.textContent = 'Copy'; }, 2000);
  });
});

const archiveSearch = document.querySelector('#archive-search');
const archiveKind = document.querySelector('#archive-kind');
if (archiveSearch && archiveKind) {
  const entries = [...document.querySelectorAll('[data-entry]')];
  const update = () => {
    let visible = 0;
    const query = archiveSearch.value.trim().toLowerCase();
    for (const entry of entries) {
      const match = entry.querySelector('.entry-title').textContent.toLowerCase().includes(query) &&
        (!archiveKind.value || entry.dataset.section === archiveKind.value);
      entry.hidden = !match;
      if (match) visible++;
    }
    document.querySelector('#empty-results').hidden = visible > 0;
  };
  archiveSearch.addEventListener('input', update);
  archiveKind.addEventListener('change', update);
}

const menu = document.querySelector('.menu-toggle');
if (menu) {
  const closeMenu = () => {
    document.body.classList.remove('nav-open');
    menu.setAttribute('aria-expanded', 'false');
  };
  menu.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    menu.setAttribute('aria-expanded', String(open));
  });
  document.querySelector('.nav-scrim')?.addEventListener('click', closeMenu);
  document.querySelectorAll('.left-pane a').forEach(link => link.addEventListener('click', closeMenu));
}

const navSearch = document.querySelector('#nav-search');
if (navSearch) {
  const links = [...document.querySelectorAll('.nav-note')];
  navSearch.addEventListener('input', () => {
    const query = navSearch.value.trim().toLowerCase();
    for (const link of links) link.hidden = !link.textContent.toLowerCase().includes(query);
  });
}
