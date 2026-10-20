# What the plugin touches

One page for a reader who has to judge the whole thing at once: every entry it
adds to Blockbench, every API it calls, every address it talks to, and everything
it keeps on the computer it runs on. Written because those questions are asked of
a plugin before its arithmetic is, and because a single file of this size is
otherwise read by searching it.

## The file, and how to read it

One file, `plugin/gltf_to_minecraft.js`, about 1.9 MB of the 2 MB a catalogue
entry allows. More than half of that weight is the thirteen non-English language
tables, which are data: strings keyed the same as the English ones, overlaid
through Blockbench's own translation API.

It is laid out in named sections, in this order, each marked by a divider
comment. Searching for the name finds the section:

| Section | What is in it |
|---|---|
| `internationalisation` | the English strings, then one table per language |
| `vectors`, `box detection`, `orientation candidates`, `UV` | the arithmetic that turns triangles into a cube |
| `core`, `glTF parsing`, `animation maths (pure)` | reading a file and its animations, with no editor involved |
| `Mosaicary` and the six sections after it | the catalogue: its rules, accounts, reading and counting a `.bbmodel`, the rules of publishing |
| `CPM (.cpmproject) construction` | the Customizable Player Models export |
| `Java block/item models`, `the outliner`, `adding to the open project` | what each target format needs |
| `rounded parts: …` (four sections) | parts that are not boxes: the pieces, their texture, culling, the whole pass |
| `Node export` | what the checks in `tools/` import; nothing of Blockbench is needed above this line |
| `Blockbench integration`, `action`, `import from ZIP` | the editor side begins here |
| `Sketchfab browser`, `models browser: …` (twelve sections) | the catalogue window: cards, filters, shelves, the bell, signing in |
| `models window`, `Mosaicary: drawing / playing a .bbmodel` | the view a model turns in, and the one stage both windows share |
| `Mosaicary: the picture on a card`, `putting a model up` | uploading |
| `the import window` | the import settings, the view and the figures beside them |
| `CPM export from Blockbench`, `environment diagnostics` | the export, and the window that says what this editor has |
| `Mosaicary: reviews of the work`, `the plugin's language`, `drafts that follow saving` | the smaller windows and the one setting that sends anything |
| `registration` | `Plugin.register`, every action, and what `onunload` takes back |

Everything above `Node export` is pure: it neither reads nor writes any global of
the editor. That is what lets the scripts in [`tools/`](../tools) run
the conversion in Node, and it is why a change to the arithmetic can be proved
without opening Blockbench.

## What it adds to the editor

| Entry | Where | Shown when |
|---|---|---|
| Import glTF Model | File > Import | always |
| Import glTF as Customizable Player Model | File > Import | always |
| Import from Sketchfab | File > Import | always |
| Browse Mosaicary Models | File, beside Open Model | always |
| Upload Model to Mosaicary | File, beside the exports | while a project is open |
| Export GeckoLib Geometry | File, beside the exports | only where the GeckoLib plugin is absent |
| Convert Meshes to Cubes | Tools | while the project holds a mesh |
| Leave a Review | Help | always |
| Mosaicary language | Help | always |
| Environment diagnostics (Mosaicary) | Help | always |

The three importers sit in *File > Import* because that is where the editor's own
importers are; appended to the bare File menu they landed at its very bottom,
away from every other import. *Browse Mosaicary Models* opens a model as a
project of its own rather than importing into the open one, so it goes beside
*Open Model* and *Open from Link* — found by looking for those entries, since a
menu id of the form `file.open` is read as a submenu and silently adds nothing.
The two reviews-and-language entries are under Help because they are about the
plugin rather than about the model in front of you.

The conditions hide rather than grey out, the way Blockbench hides Save and its
own exports. Where a reason can be given instead — the upload button in the
profile, which stays while a project closes — it is given there.

Besides the menu it registers: one panel, for the catalogue once a project is
open; one setting for the language of its own windows, beside Blockbench's own
Language; one setting for sending drafts after a save, off by default; one
property on `ModelProject`, remembering which site model a project came from;
one start-screen entry for the import; and the **GeckoLib format**, but only
where the GeckoLib plugin has not registered it — see
[Requirements in the README](../README.md#requirements) for why, and
`onunload` for the care that goes with it: the entry is removed only while it is
still ours.

## What it calls

Blockbench's own API, and nothing else: `Plugin.register`, `Action`,
`MenuBar.addAction`, `Dialog`, `Setting`, `Panel`, `Property`, `ModelFormat`,
`Blockbench.on`, `Blockbench.import`, `Blockbench.export`,
`Blockbench.showQuickMessage`, `Blockbench.addCSS`, `Blockbench.openLink`,
`Undo.initEdit` / `finishEdit`, `Cube`, `Group`, `Mesh`, `Texture`, `Animation`,
`Project`, `Formats`, `Codecs`, `StartScreen`, `Language.code`, and the `THREE`
and `JSZip` the editor ships with.

One of those is listened to without being documented: `saved_state_changed`,
which is in none of Blockbench's own lists of events — twenty-three were counted
in a live editor, and three of them were about projects. It is listened to all
the same, because `Blockbench.on` makes the bucket for a name nobody has used, so
a name that is never dispatched is silence rather than a fault.

**No code arrives from anywhere.** There is no `new Function`, no `importScripts`,
no script element, and no `iframe`: the Sketchfab viewer used to be one, and it
was taken out together with the address that built it, because the rules against
running code from elsewhere cover rendering HTML from elsewhere too. The single
`eval` in the file is in the diagnostics window, asking `typeof` of global names
written as literals in that same function, so that an editor without a developer
console can still say whether it has `JSZip`. All 27 assignments to `innerHTML`
assign the empty string, to empty a container before its children are built as
elements; no text from the wire is ever written as markup.

**The icon** is `plugin/icon.png`, rendered from a Blockbench model by the same
arithmetic that draws the cards in the catalogue, so the icon and the cards are
drawn by one thing.

## What leaves this computer

| Address | When | What goes |
|---|---|---|
| `api.sketchfab.com` | while the Sketchfab search is open, and when a model is downloaded | the search words and the filters; your Sketchfab token on a download |
| `mosaicary.com` | while the catalogue window is open, and on signing in, commenting, hearting, reviewing or uploading | the search and the filters; the account's key on anything that needs one; a model's file, its picture and what you typed about it when you upload |
| `sketchfab.com`, `github.com` | only when you press a link | nothing but the opening of a page in your browser |

Nothing is sent while no window of the plugin is open, with one exception: with
*Send saved models to drafts* switched on, a save sends the project to your
drafts a minute later. That setting is off until you turn it on, and the question
is asked once.

Searching Sketchfab needs no token; downloading from it does, and it is the
user's own, from their Sketchfab profile. Nothing is sent anywhere for a plain
import from a file or a folder.

## What is kept on this computer

In `localStorage`, all under the plugin's own id, and nothing anywhere else:

| What | Why it is remembered |
|---|---|
| the site accounts and which one is in use | so that signing in happens once |
| the Sketchfab token | the same |
| the last chosen target format, model size, and the import window's settings | the next import starts where the last one left off |
| the card size, cards per row, the colour behind a model | how the catalogue looks |
| the search order, on each side, and whether locked models are shown | the same |
| whether the catalogue folds away after a model is taken | the same |
| the last chosen licence and the pose a card's picture was taken at | so that a second upload asks less |
| which site has been asked the one question about sending drafts | so that it is asked once |

The account key lives there because that is the only store a plugin has in both
builds. Any other plugin can read it, which is why a key made this way may
publish and update but never delete, and why signing out here does not take the
key away on the site.

## Known, and not yet fixed

*Upload Model to Mosaicary* is offered in the image editor (*New > Image*), where
there is no model to upload: the entry asks whether a project is open, and an
image project is a project. It is one condition, and it is not in this file yet.

## Running the checks

Every script in [`tools/`](../tools) needs nothing but Node; the ones reached for
most often have a line each at the end of the
[README](../README.md#testing-without-blockbench). The two that cover the most
ground:

```bash
node tools/smoke-plugin.mjs        # the whole import path, against substituted editor objects
node tools/survey-models.mjs       # what the import makes of every model it is given
```

`smoke-plugin` substitutes `Cube`, `Group`, `Animation`, `THREE`, `JSZip` and the
rest, and runs the entire import on several archives, then builds the same model
into every target format, adds it to open projects of each, and checks what an
editor without the GeckoLib plugin gets. It catches what `node --check` cannot:
a `const` read before its declaration, a typo in a name, a call to a function
that does not exist.

The catalogue half is not in that list, because a protocol cannot be proved
against our own idea of it; how it is checked instead is at the end of
[the catalogue](the-catalogue.md#how-this-half-is-checked).
