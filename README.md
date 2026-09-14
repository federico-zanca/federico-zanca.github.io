# federico-zanca.github.io

Personal website and research notes, built with Hugo and the local `research`
theme.

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
