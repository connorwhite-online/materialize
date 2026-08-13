# Manufacturing partner — rate card intake

**Purpose.** This is the form to walk out of a first partner call holding. It is the artifact that
makes everything downstream possible: without a rate card there is no instant quote, and without an
instant quote Materialize has no product.

It is written to be **sent to a shop as-is**. Strip this header block before sending.

Companion: the strategy memo (economics, precedent, outreach kit, risk register) is published as an
artifact and linked from the parent Linear issue.

**Why per-process.** The cost driver is different for each process. A single generic form produces a
rate card we cannot compute against:

| Process | Cost driver | What we need |
| --- | --- | --- |
| FDM | Time | $/hr machine + $/kg material + setup |
| SLS / MJF | Build volume | **$/cm³ of part volume** + per-build handling |
| SLA | Volume + labor | $/cm³ resin + $/hr + post-processing labor |

Powder-bed (SLS/MJF) is the important one: chamber time is shared across every part nested in a
build, so machine-hours is the wrong unit entirely. It is also the easiest for us to price against
— `fileAssets.volumeUm3` is already computed locally by `lib/hashing/mesh-fingerprint.ts`.

---
---

# Materialize — manufacturing partner rate card

**Shop:** ______________________  **Contact:** ______________________  **Date:** ____________

## How this works

We send you fully-specified, pre-paid jobs. You never quote, never email a customer, and never
chase payment. You set the rates below; we price against them automatically and commit to that
price with the buyer. You accept or decline each job.

- **You set the rates.** Nothing here is negotiated per job.
- **Jobs arrive prepaid and specified** — model file, material, finish, quantity, ship-to.
- **We pay on ship, net-15.**
- **Blind shipping** — your box, our label. The customer never sees your name unless you want them to.
- **30 days' notice** on any rate change, from either side.

---

## 1 · Processes and materials

Tick what you run in-house. We only route work to in-house capability — no brokered work, since
that reintroduces the middleman we're removing.

| Process | In-house? | Machines / models | Qty of machines |
| --- | --- | --- | --- |
| FDM | ☐ | | |
| SLS | ☐ | | |
| MJF | ☐ | | |
| SLA / DLP | ☐ | | |
| Other | ☐ | | |

**Materials you stock and can run without a special order:**

| Material | Process | Colors available | Notes / grade |
| --- | --- | --- | --- |
| | | | |
| | | | |
| | | | |

> Stocked-and-ready is what matters here. A material you *can* get in two weeks isn't one we can
> quote instantly, and we'd rather show the buyer a shorter list that's always true.

---

## 2 · FDM rate card

*Skip if you don't run FDM.*

| Field | Value |
| --- | --- |
| Machine rate, $/hr | |
| Material rate, $/kg — by type (PLA / PETG / ABS / ASA / TPU / other) | |
| Support material, if billed separately | |
| Setup / job-prep fee, per job | |
| Default layer height and infill you'd quote against | |
| Build envelope, mm (X × Y × Z) | |
| Minimum order value | |

**How do you estimate print time?** (Slicer + profile, a rule of thumb, or something else — we're
trying to reproduce your number, not second-guess it.)

_______________________________________________________________

---

## 3 · SLS / MJF rate card — powder bed

*Skip if you don't run powder bed. This is the section we care most about.*

| Field | Value |
| --- | --- |
| **Rate per cm³ of part volume** | |
| Minimum billable volume per part | |
| Per-build or per-order handling fee | |
| Build envelope, mm (X × Y × Z) | |
| Materials and any per-material rate difference | |
| Minimum order value | |

**The nesting question.** Our jobs are small parts. The proposition is that they fill volume in
builds you are already running rather than triggering builds of their own.

- Will you nest third-party parts into an existing customer build? ☐ Yes ☐ No ☐ Depends — explain:

  _______________________________________________________________

- If yes, is the nesting rate different from a standalone build rate? What is each?

  _______________________________________________________________

- Roughly how full does a typical build come out, and how often do you run one? (Helps us
  understand what volume you could actually absorb.)

  _______________________________________________________________

- How long can a part wait to be nested before you'd run it standalone?

  _______________________________________________________________

---

## 4 · SLA / DLP rate card

*Skip if you don't run resin.*

| Field | Value |
| --- | --- |
| Resin rate, $/cm³ — by resin type | |
| Machine rate, $/hr (if billed) | |
| Post-cure + support removal + finishing labor, $/hr or flat per part | |
| Build envelope, mm (X × Y × Z) | |
| Minimum order value | |

> Support removal and post-cure are real money and routinely get left out of quotes. We'd rather
> pay for them explicitly than have them show up as a margin problem for you later.

---

## 5 · Post-processing menu

Price anything you offer. Leave blank what you don't.

| Service | Price basis | Price |
| --- | --- | --- |
| Support removal (if not already in the base rate) | | |
| Bead blast / media tumble | | |
| Dyeing — colors available | | |
| Vapor smoothing | | |
| Sanding / hand finishing | | |
| Painting | | |
| Inserts / hardware install | | |
| Assembly | | |
| Other | | |

---

## 6 · Lead time

| Tier | Business days (ship-ready) | Surcharge |
| --- | --- | --- |
| Standard | | — |
| Expedited | | |
| Rush | | |

- What's your realistic **weekly capacity** for our kind of work? (Parts, build-hours, or builds —
  whichever way you actually think about it.)

  _______________________________________________________________

- Any predictable blackout periods — shutdowns, known busy season?

  _______________________________________________________________

---

## 7 · Shipping

| Field | Value |
| --- | --- |
| Carriers you have accounts with | |
| Do you ship on our account number, or bill us your rate? | |
| Typical package handling / materials fee | |
| Can you drop-ship to our customer with our label? (blind ship) | ☐ Yes ☐ No |
| Can you include a packing slip we provide? | ☐ Yes ☐ No |

---

## 8 · Quality and reprints

- **Standard tolerances** you hold, by process:

  _______________________________________________________________

- **Our proposal on defects, tell us if it doesn't work for you:** you cover parts that miss the
  spec we sent; we cover customer-side changes of mind; a photo settles anything ambiguous. No
  inspection reports, no formal QC documentation — these are consumer parts.

  Acceptable? ☐ Yes ☐ With changes: _______________________________________________________

- What do you need from us in a job packet to make a part right the first time? (File format,
  orientation notes, critical dimensions, anything else.)

  _______________________________________________________________

---

## 9 · Commercial terms

| Field | Value |
| --- | --- |
| Payment terms — we propose pay-on-ship, net-15 | |
| Preferred payment method (ACH / card / other) | |
| Do you require a minimum monthly volume? | ☐ No ☐ Yes: ______ |
| Do you require an NDA or MSA before quoting? | ☐ No ☐ Yes |
| Notice period for rate changes — we propose 30 days | |
| Billing contact + AP email | |

**Mutual non-solicit.** We propose that neither side solicits the other's customers found through
this relationship, for the term plus 12 months. Any objection?

_______________________________________________________________

---

## 10 · How you want jobs to arrive

We are deliberately starting manual — no integration work on your side. Which fits how you already
operate?

- ☐ **Email** — model file + spec sheet + PO to an address you give us. *(Our default to start.)*
- ☐ **Shared folder** — Drive / Dropbox / SFTP drop.
- ☐ **Your existing portal or MES** — tell us what it is and we'll look at it.
- ☐ **An API on your side** — if you already have one, we'll integrate to it.

**Who should get the job notification?** _______________________________________

**Who do we contact about a problem on an in-flight job?** _______________________________________

---

## 11 · One question, if you run powder bed

Our whole proposition rests on this, so it's worth being blunt about it:

> Does filling otherwise-empty chamber volume in builds you're already running actually help your
> economics — or does the handling overhead on small third-party parts eat the benefit?

If the honest answer is the second one, tell us now. We'd rather find out on this call than after
we've sent you fifty parts you didn't want.

_______________________________________________________________

---

*Materialize · materialize.cc*
