# AGENTS.md

Notes for AI agents working on this repository. What the layout looks like and how it behaves is in [RECIPE.md](RECIPE.md); when you change behavior, update RECIPE.md too.

## Publishing

This is a layout for the [herdr.dev gallery](https://herdr.dev/gallery/). The repository root mirrors `~/.config/herdr-app` (`layouts/<name>.json` and `mods/<name>/`), plus `RECIPE.md` and `preview.png`. A public repository with the GitHub topic `herdr-layout` shows up in the gallery within the hour. How to write `RECIPE.md` is described under "Layouts and mods other people made" in the `~/.config/herdr-app/AGENTS.md` that Herdr App generates.

Keep it self-contained: no `keys.json`, no theme file (the colors are on the layout root), and the font ships in the mod's `fonts/`.

`preview.png` is rendered from `layouts/ibm-as400.svg` (`qlmanage -t -s 1600`, cropped to 1600×1000). Don't use a real `herdr-app shot`: it shows your own spaces and terminals.

## Running it while developing

```bash
R=/path/to/herdr-ibm-as400
H=~/.config/herdr-app
ln -sf $R/layouts/ibm-as400.json $H/layouts/ibm-as400.json
ln -sf $R/layouts/ibm-as400.svg $H/layouts/ibm-as400.svg
M=$H/mods/ibm-as400
mkdir -p $M/fonts
ln -sf $R/mods/ibm-as400/main.js $M/main.js
ln -sf $R/mods/ibm-as400/mod.json $M/mod.json
cp $R/mods/ibm-as400/fonts/* $M/fonts/
herdr-app do layout.switch --name ibm-as400
```

- Don't link the mod directory as a whole: a linked mod directory doesn't load its assets. The fonts are copies.
- If an edit doesn't show up, `touch -h` the link. Layout errors go to `~/.config/herdr-app/layout.error`.
- `herdr-app check mods/ibm-as400` only checks the default view (`spaces`). To check another, copy `main.js` and `mod.json` to a scratch folder, replace the default view in `init` with that view's name, and check the copy.

## Files

- `layouts/ibm-as400.json`: the layout. Every block is the `ibm-as400` mod with a `view` prop.
- `mods/ibm-as400/main.js`: one `View` class; `init_<view>` and `draw_<view>` per view (`header`, `spaces`, `jobs`, `tabs`, `pane`, `console`, `opt`). `JOB` maps agent statuses to job statuses, `KEYS` holds the two function-key sets, `submit` the command line's commands, `options` each row's options.
