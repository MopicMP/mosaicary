# How it works

Minecraft renders boxes, not arbitrary polygons. Every game format — Java block
models, Bedrock geometry, GeckoLib `.geo.json`, OptiFine CEM — is a set of
cuboids. A glTF model opens fine in Blockbench, but every element is a `Mesh`,
and none of those formats can take it. This plugin rebuilds the model out of
`Cube`s.

The converter core does not depend on Blockbench, so most of what is described
here is covered by Node tests in [`tools/`](../tools).

This page is the conversion. The catalogue the plugin opens, the account, and
putting a model up are a separate matter, described in
[the catalogue](the-catalogue.md); what the plugin adds to the editor and what
leaves the computer is in [what it touches](what-it-touches.md).

## 1. Reading the model

**Archive or folder.** Unpacking a ZIP only fills a map of file name to bytes;
selecting the files of an unpacked folder fills the same map. Everything below
the reader is shared. Buffers and images are resolved by relative path, then by
bare file name — so a glTF that refers to `textures/foo.png` still finds `foo.png`
picked from a folder.

**Several `.gltf` files.** A Sketchfab folder usually holds the model and a twin
with no images at all. The one declaring the most images is chosen, and the
choice is written to the report. Taking whichever came first used to import an
untexturable model depending on the order of names.

**The outliner.** Every glTF node could become a folder, and a Sketchfab export
nests them deep: three wrapper nodes, then each cube in a node of its own, inside
a node that only holds its mesh. A folder is dropped when it has no animation and
holds one thing or nothing; its content moves up to its parent. That changes no
shape: bones stand unrotated, so a folder nothing animates moves nothing. The
wrapper goes whatever it holds. A cube whose node went takes the innermost
author's name on its way up, skipping names an exporter makes up
(`_gltfNode_2`, `Object_104`). Sketchfab appends `_N` to every node name; when
every name carries such a number, one is taken off, and bone names that then
repeat get a number back. [`tools/verify-outliner.mjs`](../tools/verify-outliner.mjs)
checks that no animated node is lost on any local model.

**Primitive modes.** Triangles (`mode 4`), triangle strips (`5`) and fans (`6`)
are all read. Every second triangle of a strip is stored reversed and is turned
back. A strip jumps from face to face by repeating an index; such a *stitch*
draws nothing but reads its corners from two faces of the texture, so a triangle
with a repeated corner is dropped. On a real strip-encoded box, 20 of 32
triangles were stitches.

**The export wrapper.** Sketchfab wraps a model in
`Sketchfab_model → root → GLTF_SceneRootNode`. The outer node carries the model's
placement in the Sketchfab showcase (an arbitrary rotation and offset) and is
dropped; an axis conversion (a multiple of 90°) is kept. Dropping both used to
make models arrive lying down. Extra rotation around X and Y is available in the
dialog for the cases a file cannot settle.

**Materials.** A material's colour texture is its `baseColorTexture`, or, in the
specular-glossiness workflow, the `diffuseTexture` inside that extension. Read
only in the first place, such a file looked textureless, and every part fell back
to the first picture. Normal, roughness and similar maps stay out of the atlas.

**Outline shells.** A toon outline is often a copy of a part, a little larger,
turned inside out and on a one-sided dark material: a viewer that culls back faces
draws only its far side, which peeks out around the part as a rim. Minecraft and
Blockbench draw cubes from both sides, so the same shell would arrive as a dark
casing over the part. A piece whose faces are all on one-sided materials, closed
(at most one edge in twenty unpaired) and wound inward — a negative signed volume,
read the other way round under a mirroring transform, as glTF itself does — is
left out, and the report counts them. Inside-out parts on two-sided materials stay:
there the winding means nothing.

## 2. From meshes to cubes

**Merged meshes** are split into connected components first: many exporters emit
one mesh of 708 triangles where the model really has 59 boxes.

**Box detection** (`solveBox`) tries all 24 orientations and picks the one with
the fewest UV violations, then the fewest mirrors, then the closest to identity.
All tolerances are relative to the object's size: models contain panels
0.001 px thick next to 8 px cubes.

Two float32 traps are avoided on purpose:

- a direction is never taken from a short edge — the axes come from the two
  longest edges, orthogonalised, and the third is their cross product;
- orthogonality is checked in units of length, not by angle, because the angle
  of a short edge is pure noise.

**Meshes instead of cubes.** The top of the import window offers the other
answer: leave the geometry as the author made it, and let Blockbench's own mesh
tools take it from there. Bones, textures and animations come across exactly as
they do on the cube path; nothing is split, solved or rebuilt. Cubes stay the
default, because cubes are what the game renders, and a format that cannot hold a
mesh is not offered for one. Where the model is heavy enough to make editing
uncomfortable the window says so before the import rather than after: the
threshold is 10,000 triangles, measured by building models in a live editor and
working on them — up to about ten thousand the editor answers at once, past it
dragging vertices begins to lag, and by twenty thousand the viewport draws about
25 frames a second. It is said only on the mesh path, since the cube path does
not keep a triangle count.

**Degenerate fragments** are dropped. **Objects that are not boxes** — wedges,
bevels, rounded shapes — are rebuilt from plates, see
[section 9](#9-parts-that-are-not-boxes). The advanced settings can instead replace
each with its bounding box, with the texture laid out per face, skip them, or
cancel the import; the report lists them either way.

## 3. Texture layout

**Per-face UV.** The project is switched off box UV, otherwise Blockbench would
recompute the layout itself. The direction in which `u` and `v` grow on each face
is **measured** from the running editor (`calibrateFaceDirs` puts an asymmetric
rectangle on a probe cube and reads its buffers); the table in the code is only a
fallback for Node. A mirror is written as a reversed rectangle (`x1 > x2`).

**Colour and auxiliary maps.** Normal, roughness, occlusion and emissive maps are
meaningless in Minecraft and are skipped.

**One texture per model.** GeckoLib and Bedrock take one, so several colour images are packed
into an atlas (shelf packing into power-of-two sides) and each object's UV is
moved into its rectangle. Two things decide what goes in:

- an image **no primitive references** is left out. A file may declare one
  material per image and still point every primitive at the first one; the other
  images are then unreachable, and packing them only wastes the atlas — twelve
  such images made 512×256 where the model reads a single 32×32. The report names
  such images;
- an object that **names no image at all** gets the main image's rectangle.
  Without it, its UV were multiplied by the whole atlas and the model arrived in a
  stretched mix of every picture.

**Per face, not per object.** A mesh may carry several primitives on different
materials — older Blockbench exports every face of a cube as one — so each
primitive's UV go into its own image's rectangle. The image used to be taken from
the first primitive for all of them, and a cube whose first face had no texture
arrived invisible.

**Faces with no texture.** Blockbench exports an untextured face on a stand-in: a
1×1 picture whose one pixel is transparent. It is recognised by its pixels — the
PNG is inflated by a small decoder in the plugin, checked byte for byte against
zlib in [`tools/verify-per-face-textures.mjs`](../tools/verify-per-face-textures.mjs)
— and only when every sample is zero and zero means transparent. Such faces keep
their geometry but no UV, so they stay hidden as they were; the stand-in stays out
of the atlas; an object made only of such faces, which is what Sketchfab's
conversion makes of them, is left out.

**Lost alpha.** A Minecraft-style figure has an outer shell that is transparent
wherever it is unused. If the texture has no alpha channel while the material
asks for transparency (`alphaMode` `BLEND` or `MASK`), that shell becomes a solid
slab and hides the body. The report names the mismatch rather than calling it a
loss: some models ask for transparency on a texture that never had any. Guessing
a transparent colour was tried and left out — in the downloads that lost alpha it
became black, and black is also outlines and dark details.

## 4. Coordinates

**Scale.** A texel is meant to match a model pixel, so the scale comes from the
ratio of UV area to geometric area: the median of `sqrt(uv / geometry)`, halved,
because textures are usually drawn at twice the model's detail. The result is
checked against a sane size (4–256 px); otherwise it falls back to the bounds. It
can always be set by hand.

**Snapping.** Floating-point noise is cleaned (`4.99998 → 5`). Snapping to the
0.25 px grid is applied only to unrotated cubes that already sit on it: the grid
is coarser than small details — a 0.6 × 0.7 × 0.001 px pupil grew by a quarter and
lost its thickness — and a snapped rotated cube moved its vertices by up to
0.46 px.

**Coincident faces.** Two faces in one plane flicker (z-fighting). Instead of
moving coordinates, the smaller cube of the pair is grown slightly through
`inflate`, which keeps every coordinate clean.

## 5. Animations

Bones sit with zero rotation and the rest pose is baked into world coordinates.
A rotation keyframe is `R(t)·R0⁻¹`; an offset is conjugated by the parent's rest
rotation; the two are assembled as `T·R`. This combination was chosen out of
sixteen by comparing the resulting pose with the true one from glTF
(`tools/verify-animation.mjs`).

Keyframe values are cleaned before they are written: anything below 1e-4 becomes
zero, the rest is rounded to four digits. Blockbench parses keyframe values as
Molang, and a float32 zero such as `4.76e-8` in scientific notation broke the
parse and threw the whole bone — 220 of 1479 values on one model.

**All three channels come across.** Rotation, position and scale: a part that
grows, shrinks or folds away keeps doing so, in Blockbench and in the CPM export
alike. A bone scaled along axes that are slanted in its rest pose can only be
matched closely, not exactly, and the report names such bones.

**Offsets are in the model's own pixels.** They used to be computed as if every
model had been built at ×16, so at ×8 every offset came out twice as long and the
parts flew apart while an animation played, though the model itself stood whole.

**Each animation gets a frame grid that holds its keyframes.** Blockbench puts
every keyframe on its animation's grid — 24 a second unless told otherwise — and
a keyframe landing on another replaces it. A model animated at 25 or 50 a second
therefore had its keyframes moved, and the keyframes added to ease a rotation
wiped out the ones beside them. Where no grid Blockbench offers holds them all,
they move by at most one step, and the report says how many.

**Animated bones keep their exact pivots.** Pivots were rounded to the 0.25 px
grid along with everything else, so a bone that turns swung its part a little off
at every turn.

**Long turns are eased the short way round.** Blockbench and CPM interpolate each
angle in a straight line, so a bone that turns most of the way round between two
keyframes, or all the way, threw parts out of place while it played. The nearest
of the equal angles is written, and in Blockbench extra keyframes are added
wherever that straight line would stray from the real turn; the report says how
many were added. In CPM, a looping animation whose bone makes a whole turn is
given a frame of its own at the end to close it, or it wound back on the last
frame.

**How a channel interpolates is read, not assumed.** Step channels hold each
keyframe until the next instead of easing between them, and a cubic-spline
channel's tangents are tangents: they used to be read as poses of their own.

## 6. Customizable Player Models

The CPM import runs the same conversion and then writes a `.cpmproject` itself —
a ZIP with `config.json`, `skin.png`, `description.json` and one JSON per
animation.

- **Names** follow the outliner: the dialog and the elements carry the tidied
  names, and the dialog asks about the top of the tidied tree, not the export
  wrapper.
- **Roots are player parts** (`head`, `body`, `left_arm`, …), not the model's own
  bones; everything is hung under them. A root with any other name is what trips
  CPM's own Blockbench exporter (`Unknown root group`).
- **Axes:** `x = −x`, `y = 24 − y`, `z = z`; the basis is carried over by
  conjugation, and CPM composes element rotations in ZYX order. The `up` and
  `down` faces need their UV turned by 180°.
- **UV must be whole numbers** — but in the UV grid, not in image pixels. So the
  image is left alone and only the grid size is raised by as much as needed. The
  viewer's texture limit (256 by default) applies to the image, so it is not hit.
- **Alignment:** the model is shifted as a whole so its bones sit on the vanilla
  pivots; otherwise a limb swings about a pivot far outside itself. Height is not
  touched — the import already stands the model on the ground.
- **The head** is driven by the model when it has animations: in Minecraft the
  head is not a child of the body, and the vanilla look rotation would tear it
  off during a tilted pose.
- **Animations** are snapshots of every moving bone, sampled at a steady rate and
  computed from the world pose, because a bone's parent in CPM is often not its
  parent in glTF. A `v_<pose>_…` file replaces a vanilla pose, `g_…` is a gesture;
  anything unrecognised becomes a gesture.
- **Budget:** a local `.cpmmodel` has 30 kB. The report estimates the encoded size
  with the mod's own writers, so an export too heavy to keep off CPM's servers says
  so before it is saved.

The `.cpmproject` is read back by CPM's own rules in
[`tools/verify-cpm.mjs`](../tools/verify-cpm.mjs): structure, limits, the eight
corners of every box through the renderer's transform, and every animated pose.

## 7. Formats

The conversion does not depend on the format it lands in. A cube turned freely,
per-face UV, bones and keyframes are what GeckoLib, Bedrock entities and Generic
models all take, and the UV convention is measured on whichever project is open.
Only the project's format changes:

- **Bedrock Entity** gets a geometry identifier from the model's name; an empty
  one would export as `geometry.unknown`.
- **Generic Model** measures UV against each texture's own size, so the atlas is
  given its size explicitly rather than when it finishes drawing.
- **Customizable Player Models** builds its intermediate project as a Generic
  model: it exists only to measure on, and Generic ships with Blockbench.

Modded Entity and OptiFine are not offered: both require box UV or whole-pixel
sizes, and neither can turn a single cube.

**GeckoLib without the GeckoLib plugin.** Of the four, only GeckoLib's format
comes from a plugin of its own, and choosing it without that plugin used to end
in a message about installing one. So where nothing has registered that format
id, this plugin registers it — at load, not when an import asks for it, because a
`.bbmodel` that arrives from somebody else never passes through our import.
Measured in a live editor: such a file opens as a Generic project instead of
itself, losing bones, animation files and every format flag, with Blockbench's own
line sending the reader after a plugin; in the desktop editor that load breaks off
partway. Along with the format, *Export GeckoLib Geometry* appears beside the
other exports and writes the `.geo.json` the mod reads — the animation files
Blockbench writes itself, as it always did — and the keyframes that plugin writes
become readable. Where the GeckoLib plugin is installed, none of this shows: its
format object is the one in the registry, our export entry is hidden, and
`onunload` removes our registration only while it is still ours.

**Java block and item models** take the cubes too, but have no bones and do not
animate: animations are left out and the report counts them. Two more things
follow from the format:

- **The box.** Every element's from/to must lie within −16…32 on each axis, and
  inflate counts, because the export bakes it into from/to. The bounds are taken
  from the cubes' from/to, not from their corners: a turned cube's from/to are its
  unturned box, which reaches further. With centring on, the model stands like a
  block — X and Z centred on it, the bottom on its floor. It is then pushed back
  inside, and shrunk only if it is larger than the box itself: moving by whole
  pixels keeps a model on its grid, shrinking does not.
- **The version.** Blockbench writes Java rotations in three ways, keyed to the
  project's format version: one axis in 22.5° steps within ±45° (1.9 and later),
  any angle on one axis within ±45° (1.21.6), and any rotation on all three axes
  (1.21.11). The import finds the oldest one that holds every cube, raises the
  project to it if the user's default is older, and reports it. A Blockbench too
  old to write free rotations says how many cubes it will snap.

Both are checked in [`tools/verify-java-fit.mjs`](../tools/verify-java-fit.mjs).

## 8. Adding to the open project

With *Add to the open project* the model goes into the project that is open,
in that project's format, instead of a new one. The conversion is the same; what
changes is where things land and what they are called.

**Where.** Into the selected folder, or the folder of the selected cube, standing
on that folder's pivot: the model's origin — its bottom centre with centring on —
is put there, and a sword in a hand turns with the hand. With nothing selected it
goes to the top level. It arrives as one folder, to be moved, hidden or deleted
whole: its own top folder when it has exactly one and nothing loose beside it,
otherwise a new folder named after the file. A Java model is only pushed back
inside the −16…32 box, not re-centred on the block.

**Names.** GeckoLib and Bedrock tell bones apart by name, so the tidied folder
names are made unique against the project's before any folder is created, the
same way repeats inside one model get `_2`, `_3`. Animations are left out unless
asked for: the project has its own, and a model seldom needs the ones it was
shown off with. Added ones are named `model.name`, after the file.

**Texture.** How it joins depends on what the format allows:

- **One texture per model** (GeckoLib, Bedrock). The atlas is drawn beside the
  project texture or under it, whichever leaves the smaller sheet, the squarer on
  a tie, and the project's UV size grows to match. UV count pixels from the top
  left, so the old picture keeps its corner and every UV already made reads the
  same pixels. The sheet is drawn at the old texture's own resolution: a 64×64 UV
  space painted at 128×128 gets the atlas doubled. A project with cubes but no
  texture gets a new sheet with the same room left for their UV.
- **A UV size per texture** (Generic). The atlas becomes a texture of its own
  with its own UV size; nothing already there changes.
- **One UV size for every texture** (Java). The atlas becomes a texture of its
  own, and its UV are scaled into the project's UV size — Minecraft stretches
  every texture over that size anyway.

An empty project takes the model's UV size, as a new one would.

Three kinds of project texture are refused before anything is built, with the
project untouched: one with layers, because the redraw would merge them; an
animated one, whose frames the sheet would break; and one that never loaded,
which would be replaced with an empty sheet.

**Undo.** Everything the import adds or changes — cubes, folders, animations, the
texture and the UV size — is one undo step. It is closed only once the texture
has its pixels: they are drawn after the images decode, and closing earlier would
record an empty texture, so undoing and redoing would leave one.

The placement, the names and the undo step run through
[`tools/smoke-plugin.mjs`](../tools/smoke-plugin.mjs) on projects of every format;
the layout arithmetic is in
[`tools/verify-add-to-project.mjs`](../tools/verify-add-to-project.mjs).

## 9. Parts that are not boxes

Artists round a shape in Blockbench with many turned cubes laid over each other,
not with a staircase of straight ones, and that is what the rebuild makes. All
distances below are model pixels.

**Shape.** A part that one box follows within 0.1 px both ways stays that box:
most deformed cubes do, and a box is one cube where plates would be six.
Otherwise its triangles are gathered into near-flat regions — corners within
0.15 px of the region's plane, each turned less than 5° from it.

**Plates.** Each region becomes a plate: a turned box a hair thick, lying on the
region, whose front wears a texture baked from the source. The texel of the baked
sheets is the finest of 1/8, 1/4, 1/2 and 1 px whose total, the file's own boxes
included, stays within 4 million texels — one 2048² sheet. A texel shows while its
centre lies within 0.35 texel of the region's outline, otherwise a thin sliver
between texel centres would vanish; the rest is clear, so the plates are cut out
by transparency and need a cutout material where the model is used.

**Strips** (*Best quality*). Along a slanted edge at least 1 px long, where the
surface turns 30° or more or ends, a strip 1.5 texels wide stands on the edge,
lifted along the normal so its outer edge falls on its own texel border and comes
out straight. Each strip lies 0.006 px further out than the one before it on its
plate, so strips crossing at a corner do not flicker. It takes 1.5 to 2 times the
cubes.

**Culling.** Plates and strips overlap, and many lie inside the model. The model
is drawn from 114 directions at 840 px across; a piece that covers fewer than 4
pixels from every one of them is left out. Only pieces that move together are
weighed against each other — what an animation could reveal stays — and the
file's own cubes are never left out; they are drawn with their texture's
transparency, so what shows through them counts as seen.

**Progress.** The rebuild runs in steps and shows how far it has gone. *Finish
now* keeps what is done and hurries the rest: the parts left get no strips, and
nothing is culled. *Cancel import* leaves the project as it was.

The pieces are covered by [`tools/verify-rounded.mjs`](../tools/verify-rounded.mjs)
— a prism, a near-box, the texel budget, culling, finishing early and cancelling —
and the whole path by [`tools/smoke-plugin.mjs`](../tools/smoke-plugin.mjs).

## 10. What a file is not allowed to ask for

A model file is input from elsewhere: downloaded from Sketchfab, taken from a
catalogue, handed over by somebody. So every count it declares is a budget before
it is a number, and the budget is checked **before the allocation it would cause**:

| Budget | Limit |
|---|---|
| nodes, and scene roots | 20 000 each |
| hierarchy depth | 256 |
| child references, taken together | 40 000 |
| one accessor's count | 1 000 000 |
| decoded accessor components, over the file | 4 000 000 |
| archive bytes as they arrive | 64 MiB |
| archive entries | 4 096 |
| one entry expanded, and all of them | 64 MiB, 128 MiB |
| one image | 8 192 a side, 16 M pixels |
| decoded image pixels, over the file | 32 M |

The archive figures are counted from what actually comes out of the stream, never
from the sizes the ZIP's own table claims, which is the whole of the trick a ZIP
bomb turns. An accessor with no `bufferView` at all declares a run of zeros and is
counted the same as one with bytes behind it, because the array it produces is
just as real. A cyclic hierarchy is found without recursion, by a walk with its
own stack — the regression is run inside a VM with a timeout, so a return of the
old infinite loop fails the check rather than hanging it. Reported by
HadesScience (report #2), and the budgets go wider than the report did.

**A file past a budget and a damaged file are different things, and are told
apart on purpose.** Too large gets a sentence naming the limit and what to change
about the model; damaged keeps the plain error it threw, which is what lets the
places built to tolerate damage go on tolerating it — a broken animation channel
is skipped and the model imports, an unreadable PNG goes to Blockbench's own
decoder. Two more consequences of the same rule: only colour textures count
towards the image budget, so a normal map too large is left out as such maps
always were instead of stopping the import, and animations past the data limit are
dropped with a line in the report while the model itself arrives. On the Sketchfab
side an archive too large is marked on its card and is not downloaded at all.

[`tools/verify-import-limits.mjs`](../tools/verify-import-limits.mjs) runs each
budget from both sides — the hostile input, and a legitimate model just inside the
same limit, since a budget that refuses real work is a worse defect than no budget.

## 11. The window that asks, and the window that answers

**The import window** holds the settings in a column on the left and the model
itself on the right, turned from the file's own triangles. The picture comes out of
the same probe parse the import begins with, so the figures it shows and the scale
it offers are the ones the import will use rather than a second opinion about them;
the rotation and the centring are shown as they will be applied, where this window
used to ask which way to turn a model nobody had seen yet. What the import would
refuse — a file with no usable picture in it — is said while the settings are still
open, not after the window is confirmed.

It is built by hand rather than out of a Dialog form, because the form was the
defect: it put every name at the left edge and its control at the right with the
window's whole width in between, cut the longer drop-down options off mid-word, and
could take a long explanation only as a paragraph in the flow — of which this
window had five, making it a screen and a half. Here a setting is one line, icon,
name and control, and each explanation waits behind the question mark on its icon
until the pointer is on it. The tooltip is fixed to the screen rather than placed in
the column, which scrolls and would cut it off at its own edge. The levers for
diagnosing a bad import sit behind one line instead of standing in a row like a
cockpit.

**The report** says which model and what it became, with a tick in front, or the
same amber its warnings are drawn in. The counts are in an icon grid — cubes or
meshes, bones, texture, animations, scale, and where they apply, how many parts
were approximated and what the rebuild made — in the same grid the import window's
own card and the model windows use, so the window that asked and the window that
answers read as one pair. Anything that has to be read without being asked for
stands under them in words: a model where three parts in ten are not really boxes,
materials whose picture never arrived. The log is folded behind *Import details*,
with *Save log…* and *Copy* beside it; where the clipboard is unavailable it says
so rather than quietly doing nothing. The log stays folded because it is several
times the height of everything else in the window, which is no way to greet an
import that went fine — and it stays, because it is how a breakage is diagnosed.
