# The catalogue, the account and uploading

Since 0.1.4 converting is not all the plugin does. It is also the way into
**Mosaicary** — a catalogue of models made in Blockbench — and the way to put
your own models there. A model from Mosaicary was made in Blockbench, so it
opens as the project its author saved: nothing is converted and nothing is
rebuilt. The conversion described in [how it works](how-it-works.md) is for
everything else, Sketchfab included.

Two things hold for every part of this page.

**Everything arrives as data.** JSON and pictures, never a page: the plugin
catalogue forbids rendering HTML from elsewhere, so a model's name, its
description and every comment are put on screen as text. The 27 places this code
assigns `innerHTML` all assign the empty string, to empty a container before its
children are built; nothing from the wire is ever written as markup.

**The address is built in.** `https://mosaicary.com`, in one constant. There is
no field asking where the catalogue lives, because that is a question only its
authors ever had; a copy of the site running elsewhere is reached by writing one
key into local storage, which is what the checks do.

## The window and its shelves

*File > Browse Mosaicary Models*, beside *Open Model*, opens one window over two
sources — Mosaicary and Sketchfab — with four shelves on the catalogue side:

| Shelf | What it holds | Needs an account |
|---|---|---|
| Catalogue | every model published on the site | no |
| Loved | the models you put a heart on | yes |
| Mine | your own models, drafts included | yes |
| Recent | what you last opened in Blockbench | no |

The site also holds builds — Axiom blueprints, Litematica and Sponge schematics —
and Blockbench cannot open those, so no shelf lists them. The Loved shelf counts
what it shows rather than the site's own list of hearts, which takes in builds too.

**Recent** is the one shelf that is not the site's. It reads Blockbench's own
recent projects and opens an entry the way the start screen does; in the web
build, where Blockbench keeps no recents, it lists the open tabs instead. Search
works there, the filters and the orders do not — a file on a disk has no author,
no licence and no tags to narrow by. Its pictures are Blockbench's own
thumbnails, found the way the editor finds them: a PNG named after the hash of
the file's path, in the app's data folder, which the window hands to an `img` of
its own. Anything that is neither one of those files nor a data URL is refused,
so the shelf draws the editor's pictures and nothing else.

**Once a model has been taken, the catalogue gets out of the way**: it moves into
a Blockbench panel and folds there, and the model's own window closes. A window
standing over the very model it just delivered is in the way, and the panel is
where the catalogue belongs as soon as there is a project — it floats in a window
of its own only because the start screen has no panels to put it in. It comes
back by its own title bar with what was searched for still in it. A switch in the
header turns this off, for taking several models one after another. Putting it
away happens on the import having finished, not on the download having finished:
on the Sketchfab path the import window stands between the two, and a download
whose import was cancelled has delivered nothing to make room for.

## Finding a model

**Search** looks in all four places the site offers, or in one: the name, the
author, the tags. **Order** by newest, most liked, most downloaded, most
discussed or by name; the choice is remembered.

**Filters**, all taken together: the format, what the model is for (Java,
Bedrock, mods, or free of any of them), how detailed it is, how large its
textures are, the licence, the tags — any of them, all of them, or all but them —
when it was added (a day, a week, a month, a year), whether it has animations,
whether it is cubes only, and whether models for adults are among them. How many
were found stands under the filters, and one button puts every field back.

The four groups under *what it is for* are fixed rather than built from whatever
the catalogue happens to hold, because that is the question somebody arrives
with — will this go into my pack — and "none of these at the moment" is an answer
worth seeing. Each group is offered with its count, so an empty one says so
before it is pressed.

All of this narrows and orders by the same rules as the site's own panel, under
the same names, and an empty field always means everything: a fresh panel shows
the whole catalogue, and a filter nobody touched costs no comparison.

## A model before you take it

A window of its own, for one model: the model itself turning in a view, its
animations with play, pause and loop, and its figures in an icon grid — bones,
vertices, textures and their size, file size, format, licence, when it was
published, how many have looked at it. Under them its description, and under
that its comments, where you can answer somebody and take back what you wrote. A
heart puts the model on the Loved shelf, *Report it on the site* tells whoever
runs the site, and *Open in Blockbench* takes the model. A model for adults waits
behind a cover until you ask to see it.

A Sketchfab model gets the same window. There the view waits for the 3D button,
because turning the model means having its geometry, and having its geometry
means the download.

## Sketchfab, and the models that cannot be downloaded

Sketchfab models whose author does not allow downloading used to be left out of
the search, since they cannot be imported. Measured on the live API, about one
model in six of the `blockbench` tag can be downloaded, so hiding the rest made
the same search look several times smaller here than on Sketchfab's own site —
which reads as our search being poor rather than as somebody else's policy. They
are now listed, a fifth of each page, marked with a lock. Their window offers the model's
page and the catalogue instead of an import that could only fail, and offers no
3D: that geometry is the download their author does not allow. A switch in the
filters leaves them out again, and it is remembered.

The 3D view is the plugin's own, drawn out of the model's own geometry. It used
to be Sketchfab's viewer in an `iframe`, which the plugin catalogue's rules
forbid — running code from elsewhere covers rendering HTML from elsewhere as
well. Reading the archive ourselves also means one download serves both the view
and the import: pressing 3D downloads the model, and importing it afterwards
takes that same download rather than fetching it twice.

## The account

An account is needed for the Loved and Mine shelves, for hearts and comments, and
for uploading. Two ways in:

**A code read in the browser.** The plugin asks the site for a request, opens the
page the site names, and shows a code; the page has to show the same code, and
you allow it there. Nothing travels from the browser back into Blockbench — in
web Blockbench there is nowhere for it to come back to, and a plugin that
listened on a port would be a server inside a plugin — so the plugin keeps asking
the site whether anybody said yes. Two strings come out of a request and are not
the same: the **code** is public, it stands in the address and ends up in the
browser's history, while the **secret** is known only to the plugin that started
the request, and it is what the key is handed to. The code's alphabet leaves out
O, 0, I and 1, the four that are read for each other.

**A key pasted by hand**, for a Blockbench whose browser does not open. Its shape
is checked before it is kept, so a key cut short in the copying is said at once
rather than as a failed request.

What comes out either way is an ordinary API key, the kind the site lists under
its own *API keys* and takes away with one press. It is kept in local storage,
where any other plugin can read it. Two things follow, and both are deliberate: a
key may publish and update but never delete, and signing out here forgets the key
here while it keeps working on the site until you remove it there.

Several accounts are remembered — ten at most, and the eleventh is refused rather
than quietly pushing out the oldest, because a key the plugin forgot still works
until somebody takes it away.

## The bell

What the site has to tell you about your own models: a comment, an answer to one,
a decision about a model. A count sits on the bell until you have looked, and
each notice has a button that opens the model it is about. These lines come in
English, as the site writes them; everything the plugin itself says is in
Blockbench's language.

## Uploading a model

*Upload Model to Mosaicary*, beside the exports, puts the open project up —
published, or as a draft nobody but you sees. The window asks for its name,
description, tags, licence, who it is for, and, where the model is not yours, the
author and a link to the original.

**The card's picture is drawn in that same window**: turn the model to the angle
you want, choose the colour behind it, and where the model has animations of its
own, pick which one and the moment in it the picture is taken at. It is drawn by
the same arithmetic that draws the cards and the plugin's own icon, so a card
looks the way it looked while it was being made. The bytes are checked by their
own two magic numbers before they go — WebP, or the PNG a canvas that cannot
encode WebP hands back — because the site's refusal for a third kind has no words
a person could act on: the picture of a card is drawn here and never chosen.

**What goes up is the project file**, with two changes made first. Textures that
live on disk are drawn into the file, or the model would arrive grey, and paths to
files on this computer are taken out of what goes up. Which of the project's
animations travel with it is yours to tick; the ones left unticked do not go.

**The file's fingerprint** — hashes of its shape, its paint and its pictures —
lets the site recognise a model it already has, so the same file does not travel
twice, and lets it say when somebody published this very shape before yours.

**Four requests, in order**, the same four the site's own page makes:

| Step | What happens |
|---|---|
| Declaring | the site is told the size, the hash and the counts, and answers with the model's id |
| File | the bytes go straight to the bucket, which checks that hash as they land |
| Picture | the card's picture, which the site takes by its bytes |
| Publishing | the draft becomes public, where that was asked for |

Four and not one because the file never passes through the Worker: it is told
what is coming, and a Worker on the free plan could not take a twenty-five
megabyte body anyway. None of this is atomic and none of it pretends to be. A
model whose file arrived and whose publishing failed is a draft, which is a real
and useful thing, so every refusal carries the step it happened on and the window
says which step rather than "it did not work". A second attempt picks up where the
first stopped, since the site answers the first request with the row it already
has for that file. The picture is the one step whose failure is not a failure of
the upload: a model that is up without a picture is up, and the window offers the
picture again.

Everything that can be refused without the wire is refused before the first
request goes out, publishing included — a licence nobody picked is worth hearing
before a twenty-megabyte file goes up, not after. What the site itself refuses is
shown in the site's own words: no room left, enough uploads for today.

## Reviews

*Help > Leave a Review*: one review of the plugin and one of Mosaicary, on the
site's public wall, and either can be rewritten whenever you like rather than
written twice. The field stops at two thousand characters, the same number the
site allows — a field that takes more and then loses the end of it is worse than
one that stops.

## Drafts that follow saving

*Send saved models to drafts*, a setting, **off** by default and asked about
once: with it on, saving a project puts it in the drafts of your profile a minute
later, and every save after that keeps that same draft up to date — the file is
replaced in place, and the card gets a fresh picture of the model as it now is. A
draft is yours alone until you publish it, and a model you have already published
is never touched. Publishing stays something you do by hand.

Nothing of yours travels to a site before you have said that it may, which is why
the default is written out in the code: a toggle made without a value of its own
starts switched on.

The minute is deliberate. An upload is three changing requests, and a key may
make thirty a minute, so a minute between them leaves twenty-seven for whatever
you are doing by hand. Saves of one project replace one another in the queue —
what goes up is the file as it is now, and the readings in between are of files
that no longer exist — and nothing is written to disk, so an intention does not
survive a restart and send a file that is gone.

Two things it says rather than guesses at. The same file open in two windows is
one file, not two models: the site answers that it already mirrors it, and the
plugin takes the model the site names instead of making a second copy. And where
the draft on the site is not the mirror of this file at all, it says so in words —
*the draft on the site is behind this file* — once per project and per reason,
rather than on every press of Ctrl+S.

## How the cards look

Yours to set: the size of a card, how many go in a row or as many as fit, and the
colour behind a model — a palette of fourteen or one you pick yourself, either
only where the author chose no colour or behind every model.

## How this half is checked

The conversion is pure arithmetic and is checked in Node, as
[how it works](how-it-works.md) describes. The catalogue is a protocol, and a
check written against our own idea of a protocol proves only our idea of it. So
these fifteen run against a site actually running, in a real editor where the
window is a real window: signing in by code and by pasted key, several accounts,
the catalogue and its filter window, locked Sketchfab models, the model window,
the Sketchfab 3D view against the live Sketchfab API, the publish window, the
camera the card's picture is taken with, the animation clips offered for it, the
upload itself, reading and copying a `.bbmodel`, drawing a model with no figure
in it, and Blockbench's own recent files. They are measurements, not mocks: the
Sketchfab view, for one, was proved by dragging with a real mouse and comparing
the pixels before and after, because a synthetic `MouseEvent` never reaches a
handler listening for `pointerdown`.
