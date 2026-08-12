# Mistfall Hunter loadout share code — reverse engineering notes

Working notes on the in-game loadout share code (*Prepare → Import Loadout*),
with the aim of importing a build into the Gem Helper. Everything below was
derived empirically from the sample codes at the bottom of this file — nothing
here comes from official documentation.

Status: **gem encoding solved, item encoding untouched.**

---

## 1. Container

| Property | Finding |
|---|---|
| Alphabet | base62, `0-9A-Za-z` (index 0 = `0`, 61 = `z`) |
| Value | one big-endian integer; the whole code is a positional number |
| Header | every code begins `01 4E 13 01` — all four classes, and the empty loadout |
| Compression | **none** — a single gem change flips a handful of bits in place |
| Checksum | none detected (edits stay local; no trailing bytes move) |
| Payload | 16 bytes (empty loadout) up to 33 bytes observed |

Because it is a positional number, **changing a low-order field only changes
the trailing characters**, while anything that changes the payload *length*
shifts every character. That is why a chest swap looked like a total rewrite
and a gem change looked local — the underlying record was fine in both cases.

Decode:

```js
const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const dec = s => { let n = 0n; for (const c of s) n = n * 62n + BigInt(A.indexOf(c)); return n; };
const bits = s => dec(s).toString(2).padStart(240, "0"); // 240 = 30-byte frame
```

All bit positions below are **MSB-first within a 240-bit frame** and are only
comparable between codes of the same byte length (30 bytes / 40 chars).

---

## 2. Gem IDs — SOLVED

### 2.1 Storage

A socket's gem ID is an integer stored as **two nibbles that are not adjacent**.
This is why a naive contiguous-window search finds nothing.

```
gemId = nibble(hiBit) * 16 + nibble(loBit)
```

Measured socket field positions (30-byte frame):

| Socket | lo nibble | hi nibble |
|---|---|---|
| Necklace, universal | bits 144–147 | bits 156–159 |
| Sword, socket 1 (blue/Moonstone) | bits 212–215 | bits 208–211 |
| Sword, socket 2 (green/Peridot) | in 216–231, not yet pinned |

`gemId = 0` means **empty socket**.

**IDs are global and position-independent** — Wrath Moonstone reads `169` in
both the necklace socket and the sword socket. That is the property an importer
depends on, and it was verified across two different slots in two different
loadouts.

### 2.2 ID block structure

Gems occupy IDs **9–320**, in four colour blocks of 78 (12 single-affix + 66
dual-affix). `9 + 4×78 = 321`, i.e. exactly the 312 gems in `data.js`.

| Colour | Lv1 (12 singles) | Lv2 (66 pairs) | Evidence |
|---|---|---|---|
| Agate | **9–20** | 21–86 | all 12 measured |
| Amethyst | 87–98 | 99–164 | predicted |
| Moonstone | **165–176** | 177–242 | 4 of 12 measured, span confirms width |
| Peridot | 243–254 | 255–320 | predicted |

Block order matches `DEFAULT_GEM_TYPES` in `data.js`
(Agate, Amethyst, Moonstone, Peridot). Both measured blocks landed exactly
where the model predicted *before* they were measured.

IDs 0–8 are unaccounted for (0 = empty; 1–8 unknown, possibly reserved).

### 2.3 Agate Lv1 — complete

| ID | Affix | Gem |
|---|---|---|
| 9 | Aegis | Warding Agate |
| 10 | Tenacious | Tenacity Agate |
| 11 | Bulwark | Steel Bulwark Agate |
| 12 | Iron Helmet | Iron Helm Agate |
| 13 | Stoic | Fortitude Onyx |
| 14 | Brotherhood | Brotherhood Onyx |
| 15 | Valor | Resolve Onyx |
| 16 | Sky Piercer | Skyshatter Onyx |
| 17 | Fervid | Fervor Onyx |
| 18 | Focused | Focus Onyx |
| 19 | Distant Ward | Ranged Ward Onyx |
| 20 | Strife | Carnage Onyx |

### 2.4 Moonstone Lv1 — partial (4 of 12)

| ID | Affix | Gem |
|---|---|---|
| 165 | Aegis | Guardian Moonstone |
| 169 | Wrath | Wrath Moonstone |
| 172 | Swift | Haste Moonstone |
| 176 | Burst | Blast Moonstone |

Within-block ordering is **not** alphabetical and not obviously by role. Both
measured blocks happen to start with Aegis at offset 0, but Peridot has no
Aegis, so that is not a general rule. Ordering must be sampled per colour.

---

## 3. Not yet solved

- **Item IDs.** Which armour/weapon occupies each slot is untouched. This is the
  larger remaining job and is what blocks a *full* gear import.
- **Socket field positions** for the remaining slots — mechanical, needs a few
  more one-gem-at-a-time codes.
- **Lv2 (dual-affix) gems.** Untested: they need a Lv2 socket, which only
  appears on Epic (purple) gear or better. Predicted to sit in the 66-wide
  half of each colour block.
- **Existing/fixed affixes on gear** — presumably part of the item record, so
  likely blocked behind item IDs.
- **Header meaning** beyond "version/magic".

---

## 4. Method that worked

1. Fix a loadout, export a **baseline** code.
2. Change **exactly one thing**, export again.
3. Diff the decoded bit strings — the changed bits are that field.
4. Vary the *same* field across many values to learn its encoding.

Pitfalls hit along the way, worth avoiding on a resume:

- Codes from **different baselines are not comparable**. Two of the loadouts
  below differ only by the ring, which contaminated an early comparison.
- Only compare codes of the **same byte length**; a length change shifts every
  bit position.
- A gem's *type* can be read off a screenshot from the socket border colour,
  which survives being filled. Socket colours: red = Agate, blue = Moonstone,
  green = Peridot, pink = Amethyst, white = universal (necklace).
- Lv2 sockets are visibly **wider** (they show two affix icons).
- Affix totals in the character panel are a good cross-check: one Lv1 gem adds
  exactly one level to exactly one affix.

---

## 5. Raw samples

All Withered Knight. Blue (Excellent) gear unless noted, so all sockets Lv1.

### Loadout A — Equipment Value 1547, ring has an existing affix (Stoic 3 / Wrath 3)

| What | Code |
|---|---|
| base | `17lpV0V7siZSH0c6LTx5cw9MarSD9Fn5B2cAcBH6` |
| + Wrath Moonstone, sword socket 1 | `17lpV0V7siZSH0c6LTx5cw9MarSD9Fn5B2fGV1Ci` |
| + Tenacious Peridot, sword socket 2 | `17lpV0V7siZSH0c6LTx5cw9MarSD9Fn5B2fHP7Ng` |
| 2nd weapon removed | `17lpV0V7siZSH0c6LTx5cw9MarSD9Fn5B2cAc5wm` |
| different chest (no existing affix, 2 sockets) | `4e5Ue24WY9Pp7Fst5Rq3bhtNfHNMmgPw9StXF7iKX` |

### Empty loadout (nothing equipped)

`2SfgWc4ZiM5kKn0W8vrjE` — 21 chars, 16 bytes: `014e13013c00` then all zeros.

### Loadout B — Equipment Value 1489, ring has 2 sockets (Wrath 3 / Stoic 2)

One gem at a time into the **necklace universal socket**, everything else fixed.

| Gem (affix) | Gem ID | Code |
|---|---|---|
| *(baseline, empty)* | 0 | `17lpV0V7siZSH0c6LTx5cw9MarSD9BKHtuKVdy1Q` |
| Warding Agate (Aegis) | 9 | `17lpV0V7siZSH0c6LTx5cw9NWoxcrGkhtcM1EGG0` |
| Tenacity Agate (Tenacious) | 10 | `17lpV0V7siZSH0c6LTx5cw9NdGEtUc1Q7MZxqjq4` |
| Steel Bulwark Agate (Bulwark) | 11 | `17lpV0V7siZSH0c6LTx5cw9NjhWA7xI8L6nuTDQ8` |
| Iron Helm Agate (Iron Helmet) | 12 | `17lpV0V7siZSH0c6LTx5cw9Nq8nQlIYqYr1r5h0C` |
| Fortitude Onyx (Stoic) | 13 | `17lpV0V7siZSH0c6LTx5cw9Nwa4hOdpYmbFniAaG` |
| Brotherhood Onyx (Brotherhood) | 14 | `17lpV0V7siZSH0c6LTx5cw9O31Ly1z6H0LTkKeAK` |
| Resolve Onyx (Valor) | 15 | `17lpV0V7siZSH0c6LTx5cw9O9SdEfKMzE5hgx7kO` |
| Skyshatter Onyx (Sky Piercer) | 16 | `17lpV0V7siZSH0c6LTx5cw9MarYFrQ9NVoU1DZtw` |
| Fervor Onyx (Fervid) | 17 | `17lpV0V7siZSH0c6LTx5cw9MhIpWUlQ5jYhxq3U0` |
| Focus Onyx (Focused) | 18 | `17lpV0V7siZSH0c6LTx5cw9Mnk6n86gnxIvuSX44` |
| Ranged Ward Onyx (Distant Ward) | 19 | `17lpV0V7siZSH0c6LTx5cw9MuBO3lRxWB39r50e8` |
| Carnage Onyx (Strife) | 20 | `17lpV0V7siZSH0c6LTx5cw9N0cfKOnEEOnNnhUEC` |
| Guardian Moonstone (Aegis) | 165 | `17lpV0V7siZSH0c6LTx5cw9N74ozSHul7gzKUSiu` |
| Wrath Moonstone (Wrath) | 169 | `17lpV0V7siZSH0c6LTx5cw9NWpw3zezc0ft6yN3A` |
| Haste Moonstone (Swift) | 172 | `17lpV0V7siZSH0c6LTx5cw9Nq9lrtgnkfuYwpnnM` |
| Blast Moonstone (Burst) | 176 | `17lpV0V7siZSH0c6LTx5cw9MasWgzoOHcs16xgh6` |

### Other classes (from public build guides — contents unknown)

| Class | Code |
|---|---|
| Blackarrow | `17lpUyIJg0FawaAkPONLSMfPsxBGZcN8yWO5kmxM` |
| Sorcerer | `1HDax9Q7a9Bme1YRpMKG4fTu4JNncfQQlWCPqJKmOnJY` |
| Shadowstrix | `4e5UeibaIloOPWqLqeCXWMQPeZG0QcSf5rgKtrERV` |

Useful only for confirming the shared header and the base62 alphabet, since the
loadouts they encode aren't known.

---

## 5a. Third-party decoder (GameDB) — what it does and doesn't recover

`https://mistfallhunter.gamedb.wiki/builds/#make` has a working import/export
for these codes. Tested against our own samples on 2026-08-09.

**Its codec is server-side** (the page bundle only `fetch`es an API), so there
is no table to read out of its JavaScript, and using it would mean depending on
someone else's service at runtime.

What it recovered from `17lpV0V7siZSH0c6LTx5cw9MarSD9Fn5B2fHP7Ng`:

| Field | Result |
|---|---|
| Item identity per slot | correct — Crusade Helmet, Exile Greatsword, etc. |
| Rarity | correct — Excellent, and Damaged for the grey off-hand |
| **Socket layout per slot** | correct — colours and tiers, incl. `Universal I + Agate I` |
| **Gems in sockets** | **not imported** — both weapon gem slots left empty |
| **Existing (fixed) affixes** | **wrong** — see below |

The gem failure is certain, not a display quirk: that code demonstrably contains
Wrath Moonstone (ID 169, bits 208–215 — decoded independently here), and no gem
name appears anywhere in the rendered page.

The affixes it shows look like generic per-item template values, not values read
from the code. It reported `STOIC 1` on the Exile Greatsword where the actual
loadout had no affix on that weapon at all, and Aegis/Tenacious across the
armour where the real rolls were Wrath ×3 and Stoic ×2.

**Do not treat its affix output as ground truth.** Its item and socket-layout
decoding, on the other hand, matched our screenshots exactly and independently
confirmed that white = universal socket.

Net position: they solved the item layer, we solved the gem layer, and *fixed
affixes remain unsolved by both*.

### Key consequence for our importer

Their UI exposes **socket layout as a field separate from the equipment item**,
and it populated correctly on import. Combined with the fact that two items of
the same name and rarity can roll different socket colours, this means the
**socket layout must be encoded in the share code itself** — it cannot be
derived from an item ID alone.

That is the single most useful thing to come out of this comparison: the fields
this tool actually needs (socket layout, gems, existing affixes) are all present
in the code, so **item IDs are not a prerequisite for the importer we want**.

## 6. Suggested next steps

Roughly in order of value per code collected:

1. **Finish the Moonstone Lv1 ordering** — 8 more single-affix Moonstone gems in
   the same necklace socket. Completes a second block and confirms the within-
   block ordering rule (or proves there isn't one).
2. **Pin one Amethyst and one Peridot Lv1 gem** — 2 codes. Confirms the
   predicted block starts (87 and 243) and would make all 4 blocks certain.
3. **One Lv2 gem**, once Epic gear is to hand — tests whether the 66-pair half
   of a block behaves as predicted.
4. **Socket field positions** for the remaining slots — one gem into each slot
   in turn, diffing against a fixed baseline.
5. **Socket layout fields** — now the highest-value unknown, and the one that
   unblocks a useful importer. Because layout is a per-item-instance roll, it
   must be in the code. Find it by exporting a baseline, then swapping one piece
   for another of the **same rarity but a different socket layout**, and diffing.
   Compare only same-length codes.
6. **Existing (fixed) affixes** — unsolved by us and by GameDB. Isolate by
   swapping one piece for another of the same rarity and *same socket layout*
   but a different rolled affix, so only that field moves.
7. **Item IDs** — deliberately deprioritised. Nice for showing item names, but
   *not* required for this tool, which only needs sockets, gems and affixes.

**Verdict:** a socket + gem importer is achievable without ever solving item
IDs. Steps 5 and 6 are what stand between here and a working paste-a-code
feature; both are ordinary diffing work, not new cryptanalysis.
