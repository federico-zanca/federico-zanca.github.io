# federico-zanca.github.io

Personal website and research notes, built with Hugo. The site includes three
independent local themes:

- `forge`: compact terminal layout with a collection of dark and light color
  palettes.
- `folio`: document layout with side navigation and a paper/teal palette.
- `research`: the earlier editorial theme.

Set `theme = 'forge'` or `theme = 'folio'` in `hugo.toml` to choose the deployed
theme. To preview the other theme without changing the configuration, run
`hugo server --theme folio` (or `--theme forge`). Home, Archives, Writeups, and
About are available in both. Archives combines posts and writeups.

The `forge` navigation shows `./blog`, which opens the combined archive at
`/archives/`. Its colors are selected with `forge_palette` under `[params]` in
`hugo.toml`:

- `cinder`: charcoal, amber, powder blue
- `cinder-rust`: charcoal, ember orange, powder blue
- `cinder-ice`: blue charcoal, ice blue, amber
- `cinder-petrol`: deep teal, sea glass, apricot
- `paper`: warm cream, brick red, dark teal
- `wine`: burgundy, gold, mint
- `mono`: grayscale, red, navy
- `rust`: dark terracotta, mint, apricot
- `noir`: black and white with red links
- `noir-crimson`: charcoal, soft crimson, rose
- `noir-oxblood`: brown-black, oxblood, dusty rose
- `graphite`: charcoal, copper, blue-gray

Article indexes show subsections by default. Set `toc_subsections: false` in an
article's front matter to show only its main sections.

## Local development

Use Hugo 0.147.9 or newer:

```sh
hugo server
```

Build the production site with:

```sh
hugo --minify
```

The GitHub Actions workflow deploys `public/` to GitHub Pages on pushes to
`main`.
