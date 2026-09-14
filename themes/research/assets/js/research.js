// Enhancements only: content, TOC links and disclosures work without JavaScript.
document.querySelectorAll('.copy-code').forEach(button => {
  button.addEventListener('click', async () => {
    const source = button.closest('.code-block').querySelector('.copy-source').value;
    try {
      await navigator.clipboard.writeText(source);
      button.textContent = 'Copied';
      document.querySelector('#copy-status').textContent = 'Code copied to clipboard.';
    } catch {
      const region = button.closest('.code-block').querySelector('.code-scroll');
      button.closest('.code-block').querySelector('details').open = true;
      const range = document.createRange();
      range.selectNodeContents(region);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      button.textContent = 'Select';
      document.querySelector('#copy-status').textContent = 'Clipboard unavailable. Code selected; use your browser copy command.';
    }
    window.setTimeout(() => { button.textContent = 'Copy'; }, 2200);
  });
});

const tocLinks = [...document.querySelectorAll('.desktop-toc a[href^="#"]')];
const sections = [...document.querySelectorAll('.prose h2[id], .prose h3[id], .prose h4[id]')];
if (tocLinks.length && sections.length) {
  let scheduled = false;
  function updateCurrent() {
    let current = sections[0];
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= 120) current = section;
      else break;
    }
    for (const link of tocLinks) {
      let id;
      try { id = decodeURIComponent(link.hash.slice(1)); } catch { continue; }
      if (id === current.id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    scheduled = false;
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(updateCurrent); }
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  document.addEventListener('toggle', schedule, true);
  window.addEventListener('load', schedule);
  updateCurrent();
}
document.querySelectorAll('.mobile-toc a').forEach(link => {
  link.addEventListener('click', () => { link.closest('details').open = false; });
});

const search = document.querySelector('#archive-search');
const tag = document.querySelector('#archive-tag');
if (search && tag) {
  const posts = [...document.querySelectorAll('.post-list > li')];
  const filter = () => {
    let visible = 0;
    for (const post of posts) {
      const tags = JSON.parse(post.dataset.tags || '[]') || [];
      const matches = post.dataset.title.includes(search.value.trim().toLowerCase()) &&
        (!tag.value || tags.some(value => value.toLowerCase() === tag.value));
      post.hidden = !matches;
      if (matches) visible++;
    }
    document.querySelector('#empty-results').hidden = visible > 0;
  };
  search.addEventListener('input', filter);
  tag.addEventListener('change', filter);
}
