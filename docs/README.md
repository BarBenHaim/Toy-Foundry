# docs/ — the public demo

`index.html` is served at https://barbenhaim.github.io/Toy-Foundry/ by
GitHub Pages (Settings → Pages → main /docs).

It is one self-contained file: the page, its styles, and the print
engine compiled from `src/` with esbuild. Rebuild the engine half with

    npx esbuild src/demo-entry.ts --bundle --format=iife --global-name=TF \
      --minify --target=es2020 --outfile=engine.js

and paste it into the `<script>` at the bottom of the file. Nothing else
is generated — no build step runs on Pages, which is why this is a
folder of static files rather than an export of the Next app: the app's
API routes cannot be statically exported, and they are most of what
makes it work.
