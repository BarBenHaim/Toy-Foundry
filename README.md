# ToyFoundry

A parent photographs the thing their child drew. Three minutes later
they have approved a collectible-toy version of it, watched it turn into
a 3D model, and paid to have it printed and posted.

**Upload a drawing → see it become a toy → make it real.**

---

## Quick start

```bash
npm install
cp .env.example .env.local     # Firebase is the only required part
npm run dev                    # http://localhost:3000
```

Set `TOYFOUNDRY_DEMO=1` and you can walk the entire flow with no AI keys
at all — see [Demo mode](#demo-mode-and-what-it-actually-means).

```bash
npm test         # 79 tests, pure, no network
npm run build    # production build
```

| Route | What it is |
|---|---|
| `/` | Landing page |
| `/studio` | The whole customer flow, one screen that moves |
| `/orders/[orderId]` | Order tracking, and where a payment becomes an order |
| `/admin` | The production queue |

---

## The flow, and which file owns each step

| # | Step | Owner |
|---|------|-------|
| 1 | Upload a photo of the drawing | `app/api/projects/route.ts` → `lib/demo.ts:normalizeUpload` |
| 2 | Read the drawing into a character DNA | `lib/providers/vision.ts` → `lib/characterDna.ts` |
| 3 | Render the toy design | `lib/toyBrief.ts` → `lib/providers/imageModel.ts` |
| 4 | Design it so it can be printed | `lib/printRules.ts` (stated to the model in words) |
| 5 | Preview, revise, approve | `lib/toyBrief.ts:parseRevision`, the studio UI |
| 6 | Image → 3D model | `lib/providers/imageTo3d.ts` (Meshy) or `lib/mesh/standIn.ts` |
| 7 | Printability check + auto repair | `lib/printability.ts`, `lib/mesh/*` |
| 8 | Size, price, payment | `lib/pricing.ts`, `lib/providers/payments.ts` |
| 9 | Send to production | `lib/providers/manufacturing.ts` |
| 10 | Order tracking | `lib/orderStatus.ts`, `/orders/[orderId]` |

`lib/pipeline.ts` is the orchestrator every API route calls. Nothing in
it loops waiting on a provider: the one slow step (image-to-3D, minutes)
is start/poll and the studio drives it, because a serverless invocation
does not get minutes.

---

## The two ideas the product rests on

**1. Identity is explicit, not hoped for.**
Ask an image model for "a beautiful collectible toy of this drawing" and
it will give you a beautiful toy that is not your child's character — it
quietly fixes the wonky proportions, and the parent's reaction is "that's
not it", which is worse than an ugly render. So the vision pass first
writes down what makes this creature itself (three eyes, the left horn
longer, these exact hexes, importance 1–5 each), and every prompt
afterwards restates the features scoring 3+ as things it may not drop.
`lib/toyBrief.ts` is where that contract is written and
`tests/design.test.js` is where it is enforced.

**2. Printability is measured, not assumed.**
The print rules are stated twice, from one source (`lib/printRules.ts`):
in English to the image model ("chunky, thick limbs, stands on its own"),
and in millimetres to the checker. A model that fails the checker is a
model the image model was asked for badly, and when a rule changes it
changes for both.

---

## The print engine

`lib/printability.ts` and `lib/mesh/*` are the parts that took the most
getting right. The decisions that are not obvious:

- **Weld first.** Image-to-3D output is a soup of unshared vertices. On
  unwelded soup every edge is a boundary edge, so watertightness, shell
  counting and orientation all read as catastrophically broken. Checking
  before welding is the easiest way to build a checker that always says
  no.
- **A "part" is a group of overlapping shells, not a connected
  component.** Sculpts are built from solids that overlap — an eye sunk
  into a head, a horn rooted in a skull — and a slicer unions them. Vertex
  connectivity alone reports a perfectly printable toy as fourteen
  separate pieces.
- **Containment uses signed crossings, not odd/even.** A point inside two
  overlapping solids crosses two surfaces on the way out, counts two, and
  the textbook parity test calls it outside. Counting +1 leaving material
  and −1 entering gives the containment depth, which is what a slicer
  computes.
- **Thickness ignores buried surfaces.** The inside of an eye that sits
  within a head does not exist in the print. Measuring from it reported a
  solid toy as having a 1.1mm wall — exactly the false alarm that makes
  people switch a printability checker off.
- **Thickness is a sampled estimate, not a proof.** Rays are cast inward
  from a stratified sample of the outer surface and capped at 3× the
  rule. It can miss a thin feature it did not sample; it will not invent
  one. Every surface that shows the number says "no part thinner than",
  because on a chunky toy the number IS the cap.
- **Re-check at the ordered size.** Wall thickness is a millimetre
  property, so a model that passes at 12cm can fail at 8cm. Orders
  re-derive their print files from the 100mm master and re-run the checks
  at the size that was actually bought
  (`lib/pipeline.ts:printFilesForOrder`).
- **The browser never gets the print file.** The model is the product.
  The 3D viewer is served a vertex-cluster-decimated STL from
  `/api/projects/[id]/model/preview` — recognisable at arm's length,
  disappointing on a printer.

Output is binary STL (what every shop accepts) plus 3MF (which carries
units and colour, so a shop that guesses inches cannot print it at 25×
scale).

---

## Demo mode, and what it actually means

Every provider is optional, and each has a fallback that keeps the flow
alive rather than a failure that ends it:

| Missing | What happens instead |
|---|---|
| `ANTHROPIC_API_KEY` | A generic creature whose **palette is really sampled from the drawing** (sharp), confidence 0.4, and the UI says the analysis is off |
| `OPENAI_API_KEY` | The drawing itself, restaged as a product shot — trimmed, on a studio backdrop with a contact shadow. Compositing, not generation, and labelled as such |
| `MESHY_API_KEY`, or a failed sculpt | `lib/mesh/standIn.ts` builds a chunky figure from primitives, driven by the DNA: horns become cones, wings become flattened ellipsoids, three eyes become three spheres |
| `STRIPE_SECRET_KEY` | Checkout is refused, unless `TOYFOUNDRY_DEMO_PAYMENTS=1` |
| `JLC3DP_API_*` | The order is emailed to the admin with the STL, the 3MF, the print report and the address, and moves to *Ready for production* |
| `MAIL_USER`/`MAIL_PASS` | Emails are skipped with a warning; the order still completes |

The stand-in sculpt is **not a mock**: it goes through the same weld, the
same repair, the same printability check and the same STL writer, and it
is flagged on the order so a human looks at it before it prints. It is
the floor under a paid order, not a demo prop.

`TOYFOUNDRY_DEMO=1` forces every AI step onto its fallback at once — the
whole flow walkable, on a preview deploy, with no keys and no spend.

---

## The hosted demo

There is a live page that runs the print engine in the browser — change
the character, change the ordered size, watch the checks and the
millimetres move:

**https://claude.ai/code/artifact/30d542da-4a33-443c-aada-2ba1d6aeabf3**

It is not a mockup and not a fork: `src/demo-entry.ts` re-exports the
pure half of this codebase and esbuild bundles it into the page, so the
mesh a visitor turns around is welded, repaired, measured and written to
STL by the same functions the server calls.

```bash
npx esbuild src/demo-entry.ts --bundle --format=iife --global-name=TF \
  --minify --target=es2020 --outfile=engine.js
```

What the page cannot do is the two AI calls and checkout — those need
keys and a server, and the page says so on itself.

---

## Data, and who can read it

Two flat Firestore collections, both reachable **only** through the API
routes:

- `toyfoundry_projects/{id}` — drawing, DNA, previews, revisions, model,
  print report
- `toyfoundry_orders/{id}` — size, price, address, payment, production,
  status history

There is no login for customers. Ownership is a 256-bit token generated
at upload, held in the browser, and compared in constant time on every
mutation (`lib/ids.ts`, `lib/store.ts:requireProject`). "Wrong token" and
"no such project" both return 404, so ids cannot be probed. The token is
echoed to the client exactly once, at upload, and stripped from every
response after that. The link in the confirmation email carries it, which
is the only way back to an order from another device — the email says so.

Files live under `toyfoundry/{projectId}/` in Firebase Storage, private,
served through long-lived signed URLs. Private because a child's drawing
is not ours to make world-readable; signed rather than proxied because
the image-to-3D provider has to fetch the image over plain HTTPS.

No Firestore security rules ship with this project: nothing here is
reachable from a browser to rule on. If you later add client-side reads,
that changes.

---

## The manual half, on purpose

`/admin` is the production queue: every order with its files, its print
report, its shipping address, margin per order, and the buttons that move
it through *Printing → Shipped → Delivered*. The customer's tracking page
is driven by exactly those buttons.

That is the bargain the MVP makes: the customer experience is complete
whether or not the operation behind it is a person with a laptop.
Statuses only ever move forward (`lib/orderStatus.ts:canTransition`),
because a parent who sees *Printing* and then *Ready for production* the
next morning assumes something broke.

---

## Tests

```bash
npm test
```

79 tests, all pure — no network, no Firebase, no browser.

The mesh suite is written against shapes whose right answer is
arithmetic: a box of known volume, an unwelded box, a box plus a floating
speck, a mesh turned deliberately inside out, a slab of known thickness.
Three of them are regression tests for bugs that shipped a wrong answer
first — the overlapping-solids part count, the odd/even containment test,
and a thickness reading taken from a buried surface — and all three would
silently come back without them.

---

## What is not built

- **Webhooks.** Payment is confirmed by asking the provider when the
  parent lands back on the tracking page, which is correct but means an
  order paid on a closed tab stays *Awaiting payment* until someone opens
  the link. A Stripe webhook is the fix.
- **Print-shop status feed.** Once a printing API is granted, the queue's
  *Printing → Shipped* transitions should come from the shop, not from a
  human pressing a button.
- **Rate limiting.** Uploads cost money downstream (a vision call and an
  image generation each). Revisions are capped at six per project and
  uploads at 12MB, and that is all that stands between the studio and
  someone with a script.
- **No refund path.** A failed print is currently an email conversation.
