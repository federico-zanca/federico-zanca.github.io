document.querySelectorAll('.copy-code').forEach(button => {
  const label = button.getAttribute('aria-label');
  button.addEventListener('click', async () => {
    const source = button.closest('.code-block').querySelector('.copy-source').value;
    try {
      await navigator.clipboard.writeText(source);
      button.dataset.state = 'copied';
      button.setAttribute('aria-label', 'Copied to clipboard');
      button.title = 'Copied';
    } catch {
      button.closest('.code-block').querySelector('details').open = true;
      button.setAttribute('aria-label', 'Code selected; copy it manually');
      button.title = 'Code selected';
      const range = document.createRange();
      range.selectNodeContents(button.closest('.code-block').querySelector('.code-scroll'));
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    }
    window.setTimeout(() => {
      delete button.dataset.state;
      button.setAttribute('aria-label', label);
      button.title = 'Copy code';
    }, 2000);
  });
});

const paletteSelect = document.querySelector('#palette-select');
const root = document.documentElement;
const defaultPalette = root.dataset.forgeDefaultPalette || root.dataset.forgePalette;
const storageKey = 'federico-forge-palette';
let savedPalette = null;

try {
  savedPalette = window.localStorage.getItem(storageKey);
} catch {}

if (savedPalette) root.dataset.forgePalette = savedPalette;

if (paletteSelect) {
  const availablePalettes = new Set([...paletteSelect.options].map(option => option.value));
  if (savedPalette && availablePalettes.has(savedPalette)) paletteSelect.value = savedPalette;
  else {
    paletteSelect.value = 'default';
    if (savedPalette) {
      root.dataset.forgePalette = defaultPalette;
      try {
        window.localStorage.removeItem(storageKey);
      } catch {}
    }
  }

  const applyPalette = value => {
    root.dataset.forgePalette = value === 'default' ? defaultPalette : value;
    paletteSelect.value = value;
    try {
      if (value === 'default') window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, value);
    } catch {}
  };

  paletteSelect.addEventListener('change', () => applyPalette(paletteSelect.value));
}

const siteSearchInput = document.querySelector('#site-search-input');
const siteSearchResults = document.querySelector('#site-search-results');
if (siteSearchInput && siteSearchResults) {
  const searchItems = JSON.parse(document.querySelector('#site-search-index').textContent)
    .map(item => ({
      ...item,
      content: (item.content || '').replace(/\s+/g, ' ').trim(),
    }));

  const updateSiteSearch = () => {
    const query = siteSearchInput.value.trim().replace(/\s+/g, ' ').toLowerCase();
    siteSearchResults.replaceChildren();
    siteSearchResults.hidden = !query;
    if (!query) return;

    const matches = searchItems
      .map(item => {
        const title = item.title.toLowerCase();
        const titleMatch = title.includes(query);
        const contentIndex = item.content.toLowerCase().indexOf(query);
        if (!titleMatch && contentIndex < 0) return null;
        return {
          item,
          contentIndex,
          titleMatch,
          rank: title.startsWith(query) ? 0 : titleMatch ? 1 : 2,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 8);

    if (!matches.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No matches.';
      siteSearchResults.append(empty);
      return;
    }

    const list = document.createElement('ul');
    for (const { item, contentIndex, titleMatch } of matches) {
      const entry = document.createElement('li');
      const link = document.createElement('a');
      const detail = document.createElement('small');
      link.href = item.url;
      link.textContent = item.title;
      if (item.kind === 'Heading') {
        detail.textContent = `Heading in ${item.page}`;
      } else if (!titleMatch && contentIndex >= 0) {
        const start = Math.max(0, contentIndex - 50);
        const end = Math.min(item.content.length, contentIndex + query.length + 90);
        detail.textContent = `${start ? '…' : ''}${item.content.slice(start, end)}${end < item.content.length ? '…' : ''}`;
      } else {
        detail.textContent = 'Page';
      }
      link.append(detail);
      entry.append(link);
      list.append(entry);
    }
    siteSearchResults.append(list);
  };

  siteSearchInput.addEventListener('input', updateSiteSearch);
  siteSearchInput.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      siteSearchInput.value = '';
      updateSiteSearch();
    } else if (event.key === 'ArrowDown') {
      const first = siteSearchResults.querySelector('a');
      if (first) {
        event.preventDefault();
        first.focus();
      }
    } else if (event.key === 'Enter') {
      const first = siteSearchResults.querySelector('a');
      if (first) window.location.assign(first.href);
    }
  });
  siteSearchResults.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      siteSearchInput.value = '';
      updateSiteSearch();
      siteSearchInput.focus();
    }
  });
}

const archiveSearch = document.querySelector('#archive-search');
const archiveKind = document.querySelector('#archive-kind');
const archiveTag = document.querySelector('#archive-tag');
if (archiveSearch && archiveKind && archiveTag) {
  const entries = [...document.querySelectorAll('[data-entry]')];
  const update = () => {
    let visible = 0;
    const query = archiveSearch.value.trim().toLowerCase();
    for (const entry of entries) {
      const tags = JSON.parse(entry.dataset.tags || '[]') || [];
      const match = entry.querySelector('.entry-title').textContent.toLowerCase().includes(query) &&
        (!archiveKind.value || entry.dataset.section === archiveKind.value) &&
        (!archiveTag.value || tags.some(tag => tag.toLowerCase() === archiveTag.value));
      entry.hidden = !match;
      if (match) visible++;
    }
    document.querySelector('#empty-results').hidden = visible > 0;
  };
  archiveSearch.addEventListener('input', update);
  archiveKind.addEventListener('change', update);
  archiveTag.addEventListener('change', update);
}

const menu = document.querySelector('.menu-toggle');
if (menu) {
  const closeMenu = (restoreFocus = false) => {
    document.body.classList.remove('nav-open');
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Open navigation');
    if (restoreFocus) menu.focus();
  };
  menu.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  });
  document.querySelector('.nav-scrim')?.addEventListener('click', () => closeMenu(true));
  document.querySelector('.site-sidebar')?.addEventListener('click', event => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('nav-open')) closeMenu(true);
  });
  window.matchMedia('(min-width: 751px)').addEventListener('change', event => {
    if (event.matches) closeMenu();
  });
}

const navSearch = document.querySelector('#nav-search');
if (navSearch) {
  const links = [...document.querySelectorAll('.nav-note')];
  navSearch.addEventListener('input', () => {
    const query = navSearch.value.trim().toLowerCase();
    for (const link of links) link.hidden = !link.textContent.toLowerCase().includes(query);
  });
}

const toc = document.querySelector('.toc');
if (toc) {
  const entries = [...toc.querySelectorAll('a[href^="#"]')].map(link => ({
    link,
    heading: document.getElementById(link.getAttribute('href').slice(1)),
  })).filter(entry => entry.heading);

  if (entries.length) {
    const updateActiveHeading = () => {
      let active = entries[0];
      for (const entry of entries) {
        if (entry.heading.getBoundingClientRect().top > 140) break;
        active = entry;
      }

      toc.querySelectorAll('a[aria-current="location"]').forEach(link => link.removeAttribute('aria-current'));

      active.link.setAttribute('aria-current', 'location');
    };

    let updateScheduled = false;
    window.addEventListener('scroll', () => {
      if (updateScheduled) return;
      updateScheduled = true;
      window.requestAnimationFrame(() => {
        updateActiveHeading();
        updateScheduled = false;
      });
    }, { passive: true });
    window.addEventListener('resize', updateActiveHeading);
    updateActiveHeading();
  }
}
