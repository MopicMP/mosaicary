# Why a model comes out wrong

The import report is the first place to look: every case about a converted model
leaves a line in it, and the report can be saved to a file from its window. The
catalogue, the account and uploading are at the end of this page — there the
window says what happened as it happens, and the site's own refusals are quoted in
the site's words.

## The figure is black or dark where it should be skin

**Cause:** the texture lost its alpha channel. A Minecraft-style figure has an
outer shell that is transparent wherever it is unused; without alpha that shell
becomes solid and hides the body. The report says *The material asks for
transparency, but the texture has no alpha channel*.

**What to do:** download the model through *File > Import > Import from
Sketchfab*: for a model uploaded from Blockbench it takes the author's original,
whose texture keeps its alpha (see *Some faces are black on a model from
Sketchfab*). A channel lost somewhere along the way cannot be recovered from the
file.

## The whole model wears one texture

**Cause:** the file itself points all of its geometry at a single material, and
the other images have nothing to land on. The report says *Colour textures no mesh
references: N of M*. Nothing in such a file tells which part each image belongs to.

## The model is a pile of blocks, or of thin plates

**Cause:** it is not made of boxes. Sculpted and scanned models have no cubes in
them. By default each such part is rebuilt from plates that follow its surface —
*Not boxes: N — rebuilt from plates* — which keeps the shape but multiplies the
cubes; with *Approximate with a bounding box* in the advanced settings each part
becomes one block instead.

**What to do:** choose models built from cubes. The Sketchfab search lists only
models tagged `blockbench` by default (*Made in Blockbench*) — those convert
whole.

## Some faces are black on a model from Sketchfab

**Cause:** Sketchfab's own conversion to glTF can drop a texture's transparency
together with the material's `alphaMode`: what was see-through — windows, the
unused sides of a cube — comes out solid black, and nothing in the file says it
was ever clear. Guessing it back from the colour would punch holes in real black.

**What to do:** for a model uploaded straight from Blockbench, the plugin's
Sketchfab search already downloads the author's original, which keeps the
transparency; the report then says *Downloaded: the author's original*. When
downloading by hand, pick *Original format* for such a model: it holds
Blockbench's own glTF and imports as is.

## An outline around a part is missing

**Cause:** the outline was an inside-out copy of the part on a one-sided material,
drawn only from behind. Minecraft draws cubes from both sides, where such a copy
would cover the part with a dark casing, so it is left out; the report says
*Outline shells left out: N*.

## The model lies on its side or faces the wrong way

**Cause:** the author worked with a different "up" axis, and the file does not
say which. **What to do:** use *Extra rotation around X* / *Extra rotation around
Y* in the import dialog.

## The model is tiny or huge

**Cause:** the scale is derived from texel density, and some models do not follow
that convention. The report lists the chosen factor and the alternatives.
**What to do:** pick another *Model size* in the dialog, or set a *Custom scale*
under *Advanced settings*.

## The import says the model, the archive or a texture is too large

**Cause:** the file is valid, but bigger than the import takes. The limits keep a
runaway file from hanging Blockbench; in practice they stop whole scenes (towns,
cathedrals of millions of vertices), almost never a figure.

| What | Limit |
|---|---|
| Nodes | 20,000 |
| Hierarchy depth | 256 levels |
| Links between nodes | 40,000 |
| Entries in one list of model data | 1,000,000 |
| Values of geometry and animation, all together | 4,000,000 |
| Archive | 64 MB, 4,096 files |
| One file, unpacked | 64 MB |
| Archive, unpacked in all | 128 MB |
| One colour texture | 8,192 on a side, 16,777,216 pixels |
| Colour textures, all together | 33,554,432 pixels |

- Only colour textures count. Normal and roughness maps are left out of the atlas
  anyway, so one too large is left out without stopping the import.
- Animations are read after the geometry and share its budget. Past it, the
  remaining animations are dropped with a line in the report, and the model
  itself still comes in.
- In *Import from Sketchfab* a model whose archive is over 64 MB is marked on its
  card, and its download is refused before it starts.

**What to do:** the message names the limit and what to change: simplify the
model or split it into parts, remove the files it does not need from the archive,
or reduce the textures, then export it again.

## The import stops on a damaged file

**Cause:** the file breaks the glTF format: a node hierarchy that loops back on
itself (*glTF node hierarchy contains a cycle*), data pointing past the end of its
buffer, an archive cut short. The message names what is broken. Smaller damage
does not stop the import: a broken animation channel is skipped with a line in
the report, and a PNG the plugin cannot read is handed to Blockbench's own
decoder.
**What to do:** export the model again from the editor it was made in, or
download it again.

## "This archive has no glTF model"

**Cause:** the archive holds only the author's source files (`.blend`, `.fbx`).
**What to do:** download the *glTF* (autoconverted) version instead of *Original*.
The plugin's own Sketchfab download requests it automatically.

## GeckoLib was chosen, and there is no GeckoLib plugin

Nothing happens: since 0.1.4 this plugin registers the GeckoLib format itself
where nothing else has, and *Export GeckoLib Geometry* appears beside the other
exports to write the `.geo.json` the mod reads. The message this entry used to be
about — *GeckoLib plugin required*, with a button to the plugin list — is gone.

Where the GeckoLib plugin **is** installed, its format is the one in use and our
export entry is hidden: it is their format, their export and their animations, as
before.

A GeckoLib `.bbmodel` somebody else made opens as itself too, which is why the
format is registered at load rather than when an import asks for it: such a file
never passes through our import, and in an editor where nothing has registered
that format it opens as a Generic project — bones, animation files and every
format flag gone, with Blockbench's own line sending the reader after a plugin.
Their keyframes are read in the same breath, for as long as the format is ours to
stand in for.

## A Java model shows up broken in the game

**Cause:** cubes turned on several axes, or past 45°, exist in Java models only
from Minecraft 1.21.11; any angle on one axis, from 1.21.6. An older game does
not show them as built. The import report says which version the model needs.

**What to do:** use that version or newer, or pick a model built from unturned
cubes.

## A Java model came out smaller than expected

**Cause:** a Java block or item model has to fit −16…32 on each axis — three
blocks. A larger model is shrunk to fit, and the report says by how much.

**What to do:** nothing, if the size is fine; the item's display settings in
Blockbench can scale it back up in hand or on the head. For a model that must
stay big, build into GeckoLib or Bedrock instead.

## A Sketchfab model has a lock, and no 3D button

**Cause:** its author does not allow it to be downloaded. Measured on the live
API, about one model in six of the `blockbench` tag can be; the rest used to be
left out of the search, which made the search look several times smaller than the
same words on Sketchfab's own site. They are listed now — a fifth of each page —
with a lock on the card, no import, and no 3D view: turning a model means having
its geometry, and its geometry is the download their author does not allow.

**What to do:** open it on its own page, or pick one without a lock. *Models that
cannot be downloaded*, in the filters, leaves them out again and the choice is
remembered.

## Blockbench is slow after opening a model as meshes

**Cause:** meshes are kept triangle for triangle, and Blockbench's mesh editing
grows heavy past about 10,000 triangles — at twice that it draws some 25 frames a
second. Both figures are measured, and the window says so before the import rather
than after: the count of this model's triangles stands beside the limit.

**What to do:** import as cubes instead, which is the default, or take out the
parts needed and delete the rest. Mesh mode is for looking a model over, measuring
it and taking pieces from it; the game cannot draw meshes at all.

## A card says "probably not built from cubes"

**Cause:** the model's corners are shared, as on smooth and bevelled meshes. The
`blockbench` tag does not rule that out: anyone can set it, and Blockbench makes
meshes too.

**What to do:** expect slopes and curves to become boxes, or pick a model with the
cube icon. With no icon the counts cannot tell either way.

## The CPM export is over 30 kB

A local `.cpmmodel` holds 30 kB; animations take most of it. Transfer fewer
animations or lower the sampling rate. *File > Test ingame* in CPM works at any
size.

## "Cannot add the model"

Adding to the open project redraws the project texture with the model's beside
it, and three textures cannot be redrawn that way: one with **layers** (they would
be merged), an **animated** one (its frames would break), and one that **never
loaded**. Merge the layers into one, or build the model as a new project and copy
it over.

## The project texture file did not change

After adding to a GeckoLib or Bedrock project the texture in Blockbench holds both
pictures, but the file on disk does not until the texture itself is saved, from
the Textures panel. Saving the project alone keeps the picture inside the
project file.

## The catalogue, the account and uploading

What each of these is and why it works that way is in
[the catalogue](the-catalogue.md); here are the sentences you may actually be
reading on screen. Anything the site itself refuses is shown in the site's own
words, in English, because the site writes it: *there is no room left*, *that is
enough uploads for today*, *this model is in the catalogue already*.

### "The site is not answering"

**Cause:** the request did not come back — no answer within the time allowed, or
an HTTP status instead of a catalogue. The line says which.

**What to do:** try again; nothing is left half-done by a failed read. A search, a
shelf and a model window each read on their own, so one failing does not empty the
others.

### The page in the browser shows a different code

**Do not allow it.** That page is about somebody else's sign-in. The plugin shows
the code it asked for, and the page has to show the same one; the code is public
and travels in the address, which is exactly why it is not the thing the key is
handed to. Close that page and press *Sign in through the browser* again.

Two other endings of the same flow: *The sign-in has run out* — the request has a
life and yours is past it, so press the button again; and *The sign-in was refused
on the site* — somebody pressed no on the page.

### "The key does not work"

**Cause:** the key was removed on the site, or pasted incomplete. The shape is
checked before the key is kept, so a key cut short in the copying is said at once
rather than as a failed request.

**What to do:** make a new one on the site, under *My models > API keys*. Note
that signing out in the plugin only forgets the key here: on the site it keeps
working until it is removed there.

### "10 accounts are remembered here already"

**Cause:** the eleventh is refused rather than quietly pushing the oldest out, because
a key the plugin forgot still works until somebody takes it away on the site.

**What to do:** sign out of one you do not need.

### The upload stopped at a step

**Cause:** an upload is four requests — telling the site, the file, the picture,
publishing — and the one that failed is named, with the site's reason beside it.
It is not atomic and does not pretend to be.

**What to do:** press again. The site answers the first request with the row it
already has for that file, so a second attempt picks up where the first stopped
instead of making a second model. A model whose file arrived and whose publishing
failed is a draft, which is a real thing, and publishing it again is one press.

### "The model is up, the picture is not"

**Cause:** the picture is the one step whose failure is not a failure of the
upload: a model without a card picture is still up.

**What to do:** *Send the picture again*, in the same window.

### "Textures that live on disk: N"

**Cause:** the project points at texture files on this computer, which are not
inside it — uploaded as is, the model would arrive grey for everybody else.

**What to do:** *Draw them in*, in the upload window, and save the project
afterwards to keep them in your own file too.

### "This project is a model on the site already"

**Cause:** the project remembers which site model it came from or was uploaded as,
and uploading again would make a second model beside the first.

**What to do:** if that is what you want, go on; if you meant to replace what is
there, do it on the site, or let draft sync keep the draft up to date for you.

### "The draft on the site is behind this file"

**Cause:** draft sync replaces the file of the draft it made for this project. The
model on the site is no longer that draft — it was published, taken over by
another file, or made from somewhere else — and a file is only replaced in a draft
that mirrors it.

**What to do:** nothing has been lost; the file on the site is simply older than
yours. Upload it as a new model, or update it on the site. The line is said once
per project and per reason, not on every Ctrl+S.

### "Upload Model to Mosaicary" in the image editor

**Known, and not fixed yet.** The entry is offered in an image project
(*New > Image*), where there is no model to upload. The condition it asks is
whether a project is open, and an image project is a project.

**What to do:** ignore it there, and upload from a model project.
