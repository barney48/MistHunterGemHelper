const STORAGE_KEY = "mistHunterGemHelper.v1";

// The game's own confirmed gear slots (a weapon plus 5 armor pieces plus 2
// jewelry pieces). Socket *count* per piece isn't fixed data we could find
// reliably, so each group just holds however many sockets you add to it.
const GEAR_GROUPS = ["Weapon", "Head", "Chest", "Hands", "Legs", "Feet", "Necklace", "Ring"];

// Some gear rolls an affix baked into the piece in place of a level 1 socket.
// Jewellery doesn't -- necklaces and rings are sockets only.
const NO_FIXED_AFFIX_GROUPS = ["Necklace", "Ring"];

// In-game rarity ladder, in order. Damaged and Common carry no sockets or
// traits at all; Holy is only used by camp-improvement components and vouchers,
// not gear -- so only the middle four ever matter here.
// (Note the fan databases translate this ladder differently -- Worn / Normal /
// Delicate / Extraordinary / Epic / Legend / Holy -- these are the in-game names.)
const RARITY_LADDER = ["Damaged", "Common", "Rare", "Excellent", "Epic", "Legendary", "Holy"];

// What a gear piece can carry, by rarity. A piece gets a fixed number of
// "slots"; each is either a gem socket of some tier or a built-in affix, and
// where a rarity lists two shapes the piece rolls one or the other.
// `sockets` lists the TIER of each socket. Lv2 sockets do not appear below Epic.
const RARITY_LAYOUTS = {
  Rare:      [{ sockets: [1],       fixed: 0 }, { sockets: [],     fixed: 1 }], // green
  Excellent: [{ sockets: [1, 1],    fixed: 0 }, { sockets: [1],    fixed: 1 }], // blue
  Epic:      [{ sockets: [2, 1],    fixed: 0 }, { sockets: [2],    fixed: 1 }], // purple
  Legendary: [{ sockets: [2, 1, 1], fixed: 0 }, { sockets: [2, 1], fixed: 1 }], // gold
};

function generateId() {
  return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}

// ---------- Gem type icons ----------

const SVG_NS = "http://www.w3.org/2000/svg";

function makeGeometryEl(shape) {
  if (shape === "circle") {
    const el = document.createElementNS(SVG_NS, "circle");
    el.setAttribute("cx", "12"); el.setAttribute("cy", "12"); el.setAttribute("r", "8");
    return el;
  }
  if (shape === "square") {
    const el = document.createElementNS(SVG_NS, "rect");
    el.setAttribute("x", "5"); el.setAttribute("y", "5");
    el.setAttribute("width", "14"); el.setAttribute("height", "14"); el.setAttribute("rx", "3");
    return el;
  }
  const el = document.createElementNS(SVG_NS, "path");
  el.setAttribute("d", GEM_SHAPE_PATHS[shape]);
  el.setAttribute("stroke-linejoin", "round");
  return el;
}

// Builds a live DOM icon for interactive chips. `active` controls whether the
// shape is filled solid with the gem's colour or just outlined.
function gemTypeIconEl(type, active) {
  const style = GEM_TYPE_STYLE[type];
  if (!style) return null;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.classList.add("gem-icon");

  const halo = makeGeometryEl(style.shape);
  halo.setAttribute("fill", "none");
  halo.setAttribute("stroke", "rgba(255,255,255,0.18)");
  halo.setAttribute("stroke-width", "3.4");
  svg.appendChild(halo);

  const main = makeGeometryEl(style.shape);
  main.setAttribute("fill", active ? style.color : "transparent");
  main.setAttribute("stroke", style.color);
  main.setAttribute("stroke-width", "1.6");
  svg.appendChild(main);

  return svg;
}

// Raw markup version (always filled) for use inside innerHTML-built tables.
function gemTypeIconMarkup(type) {
  const style = GEM_TYPE_STYLE[type];
  if (!style) return escapeHtml(type);
  const c = style.color;
  let inner;
  if (style.shape === "circle") {
    inner = `<circle cx="12" cy="12" r="8" fill="${c}" stroke="${c}" stroke-width="1.6"/>`;
  } else if (style.shape === "square") {
    inner = `<rect x="5" y="5" width="14" height="14" rx="3" fill="${c}" stroke="${c}" stroke-width="1.6"/>`;
  } else {
    inner = `<path d="${GEM_SHAPE_PATHS[style.shape]}" fill="${c}" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/>`;
  }
  const safeType = escapeHtml(displayGemType(type));
  return `<span class="gem-icon-wrap" data-tooltip="${safeType}"><svg class="gem-icon gem-icon-inline" viewBox="0 0 24 24" role="img" aria-label="${safeType}">${inner}</svg></span>`;
}

function loadState() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { saved = {}; }
  // The red gem was briefly mislabelled "Onyx" before being confirmed as Agate.
  // Anyone who ticked that chip meant the red socket, so carry the choice over.
  const renameType = type => (type === "Onyx" ? "Agate" : type);
  const normalizeSlot = slot => ({
    id: slot.id,
    group: slot.group || "Other", // slots saved before grouping existed land in a catch-all group
    allowedTypes: Array.from(new Set((slot.allowedTypes || []).map(renameType))),
    allowedLevels: slot.allowedLevels || [1, 2], // gems saved before level filtering existed accepted either
    swap: !!slot.swap, // the one slot a rarity layout lets you flip to a built-in affix
  });
  const viewMode = saved.viewMode === "flat" ? "flat" : "gear"; // "gear" = grouped by gear piece (default), "flat" = quick top-up list

  // Full Gear and Top-Up keep independent slot lists so switching modes never
  // shows/loses the other mode's setup. Older saves only had one shared
  // `slots` list -- migrate it into whichever mode it was saved under, and
  // leave the other mode empty (it's genuinely never been opened yet).
  let gearSlots = saved.gearSlots;
  let flatSlots = saved.flatSlots;
  if (!gearSlots && !flatSlots && saved.slots) {
    gearSlots = viewMode === "gear" ? saved.slots : [];
    flatSlots = viewMode === "flat" ? saved.slots : [];
  }

  const goals = (saved.goals || []).map(g => ({
    id: g.id,
    affix: g.affix,
    // goals saved before target-only mode existed had separate min/max -- min becomes the target
    target: g.target != null ? g.target : (g.min != null ? g.min : 1),
  }));
  return {
    gearSlots: (gearSlots || []).map(normalizeSlot),
    flatSlots: (flatSlots || []).map(normalizeSlot),
    // affixes built into a gear piece instead of a socket (Full Gear view only)
    gearFixed: (saved.gearFixed || []).map(f => ({ id: f.id, group: f.group, affix: f.affix, swap: !!f.swap })),
    gearRarity: saved.gearRarity || {}, // {group: rarity} -- drives the socket layout preset
    goals,
    viewMode, // "gear" = grouped by gear piece (default), "flat" = quick top-up list
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    gearSlots: state.gearSlots,
    flatSlots: state.flatSlots,
    gearFixed: state.gearFixed,
    gearRarity: state.gearRarity,
    goals: state.goals,
    viewMode: state.viewMode,
  }));
}

const state = loadState();

// The slot list for whichever mode is currently active -- returned by
// reference, so callers can push/splice it directly and saveState() picks up.
function currentSlots() {
  return state.viewMode === "gear" ? state.gearSlots : state.flatSlots;
}

// Built-in gear affixes only exist in the Full Gear view; the Top-Up view is
// modelling loose sockets, not whole pieces.
function activeFixedAffixes() {
  return state.viewMode === "gear" ? state.gearFixed : [];
}

// {affix: levels} contributed for free, before any gem is socketed.
function fixedAffixBaseline() {
  const baseline = {};
  activeFixedAffixes().forEach(f => {
    if (f.affix) baseline[f.affix] = (baseline[f.affix] || 0) + 1;
  });
  return baseline;
}

// The gem catalog is fixed data now -- edit data.js to change it.
function activeCatalog() {
  return DEFAULT_GEMS;
}

function allAffixes() {
  return DEFAULT_AFFIXES;
}

// Which socket colours can grant this affix at all (each affix lives in only
// 1 or 2 of them), and at which gem tiers. Drives the at-a-glance icons on a
// goal row so an impossible pick is obvious before reading the results.
function affixSources(affix) {
  const byType = {};
  activeCatalog().forEach(g => {
    if (!g.affixes.includes(affix)) return;
    byType[g.type] = byType[g.type] || new Set();
    byType[g.type].add(g.affixes.length); // 1 = Lv1 gem, 2 = Lv2 gem
  });
  return DEFAULT_GEM_TYPES
    .filter(t => byType[t])
    .map(t => ({ type: t, levels: Array.from(byType[t]).sort() }));
}

// ---------- Row layout ----------

// Split a row into a wrapping middle and a pinned end. Without this the whole
// row wraps as one flow, so on a narrow panel the trailing controls (status
// badge, remove button) drop onto a line of their own instead of the chips
// simply flowing onto a second line. Call it last, once the row is built:
// everything already appended becomes the wrapping middle, and the elements
// passed here are moved out to the pinned end.
function pinRowEnd(row, ...endEls) {
  const main = document.createElement("div");
  main.className = "row-main";
  while (row.firstChild) main.appendChild(row.firstChild);
  row.appendChild(main);

  const end = document.createElement("div");
  end.className = "row-end";
  endEls.forEach(el => { if (el) end.appendChild(el); }); // reparents out of main
  row.appendChild(end);
  return row;
}

// ---------- Slots ----------

function buildSlotRow(slot, socketIndex) {
  const row = document.createElement("div");
  row.className = "slot-row";

  const label = document.createElement("span");
  label.className = "slot-label";
  label.textContent = t("socketLabel", { n: socketIndex });
  row.appendChild(label);

  DEFAULT_GEM_TYPES.forEach(type => {
    const isActive = slot.allowedTypes.includes(type);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "type-chip gem-chip" + (isActive ? " active" : "");
    chip.dataset.tooltip = displayGemType(type);
    chip.setAttribute("aria-label", displayGemType(type));
    const icon = gemTypeIconEl(type, isActive);
    if (icon) chip.appendChild(icon); else chip.textContent = type;
    chip.addEventListener("click", () => {
      const pos = slot.allowedTypes.indexOf(type);
      if (pos === -1) slot.allowedTypes.push(type);
      else slot.allowedTypes.splice(pos, 1);
      saveState();
      renderSlots();
      scheduleSolve();
    });
    row.appendChild(chip);
  });

  const universalChip = document.createElement("button");
  universalChip.type = "button";
  const isUniversal = DEFAULT_GEM_TYPES.every(gt => slot.allowedTypes.includes(gt));
  universalChip.className = "type-chip gem-chip universal-chip" + (isUniversal ? " active" : "");
  universalChip.appendChild(gemTypeIconEl("Universal", isUniversal));
  universalChip.dataset.tooltip = t("universalTip");
  universalChip.addEventListener("click", () => {
    slot.allowedTypes = isUniversal ? [] : DEFAULT_GEM_TYPES.slice();
    saveState();
    renderSlots();
    scheduleSolve();
  });
  row.appendChild(universalChip);

  const levelSep = document.createElement("span");
  levelSep.className = "slot-label";
  levelSep.textContent = t("levelLabel");
  row.appendChild(levelSep);

  [1, 2].forEach(level => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "type-chip level-chip" + (slot.allowedLevels.includes(level) ? " active" : "");
    chip.textContent = t("lvChip", { n: level });
    chip.dataset.tooltip = level === 1 ? t("lv1Tip") : t("lv2Tip");
    chip.addEventListener("click", () => {
      const pos = slot.allowedLevels.indexOf(level);
      if (pos === -1) slot.allowedLevels.push(level);
      else slot.allowedLevels.splice(pos, 1);
      saveState();
      renderSlots();
      scheduleSolve();
    });
    row.appendChild(chip);
  });

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "✕";
  removeBtn.title = t("removeSocket");
  removeBtn.addEventListener("click", () => {
    const slots = currentSlots();
    const pos = slots.findIndex(s => s.id === slot.id);
    if (pos !== -1) slots.splice(pos, 1);
    saveState();
    renderSlots();
    scheduleSolve();
  });
  row.appendChild(removeBtn);

  return pinRowEnd(row, removeBtn);
}

function buildFixedAffixRow(fixed) {
  const row = document.createElement("div");
  row.className = "slot-row fixed-row";

  const label = document.createElement("span");
  label.className = "slot-label fixed-label";
  label.textContent = t("fixedLabel");
  label.dataset.tooltip = t("fixedTip");
  row.appendChild(label);

  const select = document.createElement("select");
  allAffixes().forEach(a => {
    const opt = document.createElement("option");
    opt.value = a;
    opt.textContent = a;
    if (a === fixed.affix) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener("change", () => {
    withFixedAffixChange(() => { fixed.affix = select.value; });
    saveState();
    renderGoals();
    scheduleSolve();
  });
  row.appendChild(select);

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "✕";
  removeBtn.title = t("removeFixed");
  removeBtn.addEventListener("click", () => {
    withFixedAffixChange(() => {
      const pos = state.gearFixed.findIndex(f => f.id === fixed.id);
      if (pos !== -1) state.gearFixed.splice(pos, 1);
    });
    saveState();
    renderSlots();
    renderGoals();
    scheduleSolve();
  });
  row.appendChild(removeBtn);

  return pinRowEnd(row, removeBtn);
}

function addFixedAffix(group) {
  withFixedAffixChange(() => {
    state.gearFixed.push({ id: generateId(), group, affix: allAffixes()[0] });
  });
  saveState();
  renderSlots();
  renderGoals();
  scheduleSolve();
}

function groupIsEmpty(group) {
  return !state.gearSlots.some(s => s.group === group) &&
         !state.gearFixed.some(f => f.group === group);
}

// Lay a gear piece out from its rarity. Every rarity's two shapes differ only
// in the LAST slot -- a Lv1 socket in one, a built-in affix in the other -- so
// we generate the all-sockets shape and mark that last slot swappable.
// Jewellery never rolls a built-in, so its last slot isn't marked.
function applyRarityLayout(group, rarity) {
  const layout = RARITY_LAYOUTS[rarity];
  state.gearSlots = state.gearSlots.filter(s => s.group !== group);
  state.gearFixed = state.gearFixed.filter(f => f.group !== group);
  if (!layout) return; // cleared back to no rarity

  const tiers = layout[0].sockets;
  const canSwap = !NO_FIXED_AFFIX_GROUPS.includes(group);
  tiers.forEach((tier, i) => {
    state.gearSlots.push({
      id: generateId(),
      group,
      allowedTypes: [],
      allowedLevels: [tier],
      swap: canSwap && i === tiers.length - 1 && tier === 1,
    });
  });
}

// Flip the swappable slot between "gem socket" and "built-in affix".
function setSwapMode(group, mode) {
  withFixedAffixChange(() => {
    if (mode === "fixed") {
      state.gearSlots = state.gearSlots.filter(s => !(s.group === group && s.swap));
      state.gearFixed.push({ id: generateId(), group, affix: allAffixes()[0], swap: true });
    } else {
      state.gearFixed = state.gearFixed.filter(f => !(f.group === group && f.swap));
      state.gearSlots.push({ id: generateId(), group, allowedTypes: [], allowedLevels: [1], swap: true });
    }
  });
  saveState();
  renderSlots();
  renderGoals();
  scheduleSolve();
}

function buildSwapToggle(group, mode) {
  const wrap = document.createElement("span");
  wrap.className = "swap-toggle";
  wrap.dataset.tooltip = t("swapTip");
  [["socket", t("swapSocket")], ["fixed", t("swapFixed")]].forEach(([key, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "swap-btn" + (mode === key ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", () => { if (mode !== key) setSwapMode(group, key); });
    wrap.appendChild(btn);
  });
  return wrap;
}

function addSocket(group) {
  currentSlots().push({ id: generateId(), group, allowedTypes: [], allowedLevels: [1, 2] });
  saveState();
  renderSlots();
  scheduleSolve();
}

function renderSlotsFlat(list) {
  const slots = currentSlots();
  if (slots.length === 0) {
    list.innerHTML = `<p class="empty-note">${t("slotsEmpty")}</p>`;
  } else {
    slots.forEach((slot, i) => list.appendChild(buildSlotRow(slot, i + 1)));
  }

  const footer = document.getElementById("slots-footer");
  footer.innerHTML = "";
  const addBtn = document.createElement("button");
  addBtn.className = "btn";
  addBtn.textContent = t("addSlot");
  addBtn.addEventListener("click", () => addSocket("Other"));
  footer.appendChild(addBtn);
}

// Every gear piece shown in the Full Gear view: the standard set, plus any
// custom slot types the user added.
function displayedGearGroups() {
  const present = Array.from(new Set(
    state.gearSlots.map(s => s.group).concat(state.gearFixed.map(f => f.group))
  ));
  const extra = present.filter(g => !GEAR_GROUPS.includes(g)).sort();
  return GEAR_GROUPS.concat(extra);
}

// "Set every piece to this rarity" control above the list. Only meaningful in
// the Full Gear view -- the Top-Up view isn't modelling whole pieces.
function renderBulkRarity() {
  const el = document.getElementById("slots-bulk");
  if (!el) return;
  el.innerHTML = "";
  if (state.viewMode !== "gear") return;

  const groups = displayedGearGroups();
  const rarities = groups.map(g => state.gearRarity[g] || "");
  const common = rarities.every(r => r === rarities[0]) ? rarities[0] : "";

  const wrap = document.createElement("div");
  wrap.className = "bulk-rarity";

  const label = document.createElement("span");
  label.className = "bulk-label";
  label.textContent = t("bulkRarityLabel");
  wrap.appendChild(label);

  const sel = document.createElement("select");
  sel.className = "rarity-select";
  sel.dataset.tooltip = t("bulkRarityTip");
  const none = document.createElement("option");
  none.value = "";
  none.textContent = common ? t("rarityNone") : t("bulkRarityNone");
  sel.appendChild(none);
  Object.keys(RARITY_LAYOUTS).forEach(r => {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = t("rarity." + r);
    if (common === r) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener("change", () => {
    const chosen = sel.value;
    if (!chosen) { sel.value = common; return; } // placeholder isn't an action
    if (groups.some(g => !groupIsEmpty(g)) && !confirm(t("bulkRarityConfirm"))) {
      sel.value = common;
      return;
    }
    withFixedAffixChange(() => {
      groups.forEach(g => {
        state.gearRarity[g] = chosen;
        applyRarityLayout(g, chosen);
      });
    });
    saveState();
    renderSlots();
    renderGoals();
    scheduleSolve();
  });
  wrap.appendChild(sel);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "btn btn-secondary btn-small";
  clearBtn.textContent = t("clearAll");
  clearBtn.dataset.tooltip = t("clearAllTip");
  clearBtn.addEventListener("click", () => {
    if (groups.every(g => groupIsEmpty(g)) || !confirm(t("clearAllConfirm"))) return;
    withFixedAffixChange(() => {
      groups.forEach(g => {
        delete state.gearRarity[g];
        applyRarityLayout(g, null);
      });
    });
    saveState();
    renderSlots();
    renderGoals();
    scheduleSolve();
  });
  wrap.appendChild(clearBtn);

  el.appendChild(wrap);
}

function renderSlotsGrouped(list) {
  const slots = currentSlots();
  const allGroups = displayedGearGroups();

  allGroups.forEach(group => {
    const groupSlots = slots.filter(s => s.group === group);
    const groupFixed = state.gearFixed.filter(f => f.group === group);

    const section = document.createElement("div");
    section.className = "slot-group";

    const header = document.createElement("div");
    header.className = "slot-group-header";
    const title = document.createElement("span");
    title.className = "slot-group-title";
    title.textContent = displayGroup(group) + (groupSlots.length ? ` (${groupSlots.length})` : "");
    header.appendChild(title);
    const headerBtns = document.createElement("span");
    headerBtns.className = "slot-group-btns";

    const raritySel = document.createElement("select");
    raritySel.className = "rarity-select";
    raritySel.dataset.tooltip = t("rarityTip");
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = t("rarityNone");
    raritySel.appendChild(noneOpt);
    Object.keys(RARITY_LAYOUTS).forEach(r => {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = t("rarity." + r);
      if (state.gearRarity[group] === r) opt.selected = true;
      raritySel.appendChild(opt);
    });
    raritySel.addEventListener("change", () => {
      const chosen = raritySel.value;
      if (!groupIsEmpty(group) && !confirm(t("rarityConfirm", { group: displayGroup(group) }))) {
        raritySel.value = state.gearRarity[group] || "";
        return;
      }
      if (chosen) state.gearRarity[group] = chosen; else delete state.gearRarity[group];
      withFixedAffixChange(() => applyRarityLayout(group, chosen));
      saveState();
      renderSlots();
      renderGoals();
      scheduleSolve();
    });
    headerBtns.appendChild(raritySel);

    // The socket/built-in choice belongs to the piece, not to whichever row
    // happens to hold the swappable slot, so it lives up here beside the
    // rarity that created it.
    const swapSlot = groupSlots.find(s => s.swap);
    const swapFixed = groupFixed.find(f => f.swap);
    if (swapSlot || swapFixed) {
      headerBtns.appendChild(buildSwapToggle(group, swapSlot ? "socket" : "fixed"));
    }

    if (!NO_FIXED_AFFIX_GROUPS.includes(group)) {
      const fixedBtn = document.createElement("button");
      fixedBtn.type = "button";
      fixedBtn.className = "btn btn-secondary btn-small";
      fixedBtn.textContent = t("addFixed");
      fixedBtn.dataset.tooltip = t("fixedTip");
      fixedBtn.addEventListener("click", () => addFixedAffix(group));
      headerBtns.appendChild(fixedBtn);
    }
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn-secondary btn-small";
    addBtn.textContent = t("addSocket");
    addBtn.addEventListener("click", () => addSocket(group));
    headerBtns.appendChild(addBtn);
    header.appendChild(headerBtns);
    section.appendChild(header);

    groupFixed.forEach(fixed => section.appendChild(buildFixedAffixRow(fixed)));

    if (groupSlots.length === 0 && groupFixed.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-note slot-group-empty";
      empty.textContent = t("groupEmpty");
      section.appendChild(empty);
    } else {
      groupSlots.forEach((slot, i) => section.appendChild(buildSlotRow(slot, i + 1)));
    }

    list.appendChild(section);
  });

  const footer = document.getElementById("slots-footer");
  footer.innerHTML = "";
  const form = document.createElement("div");
  form.className = "custom-group-form";
  const input = document.createElement("input");
  input.type = "text";
  input.id = "new-group-name";
  input.placeholder = t("groupPh");
  const addBtn = document.createElement("button");
  addBtn.className = "btn btn-secondary";
  addBtn.textContent = t("addSocketThere");
  addBtn.addEventListener("click", () => {
    const name = input.value.trim();
    if (!name) {
      alert(t("groupAlert"));
      return;
    }
    addSocket(name);
    input.value = "";
  });
  form.appendChild(input);
  form.appendChild(addBtn);
  footer.appendChild(form);
}

function renderSlots() {
  document.getElementById("slots-hint").textContent = t(state.viewMode === "gear" ? "hintGear" : "hintFlat");
  document.querySelectorAll("#slots-view-toggle .toggle-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === state.viewMode);
  });

  renderBulkRarity();
  const list = document.getElementById("slots-list");
  list.innerHTML = "";
  if (state.viewMode === "gear") renderSlotsGrouped(list);
  else renderSlotsFlat(list);
  renderGoalBudget(); // socket changes move the budget too
}

document.querySelectorAll("#slots-view-toggle .toggle-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    state.viewMode = btn.dataset.mode;
    saveState();
    renderSlots();
    runSolve(); // slot labels in the results table depend on viewMode too
  });
});

// ---------- Goals ----------

function moveGoal(index, delta) {
  const to = index + delta;
  if (to < 0 || to >= state.goals.length) return;
  const [g] = state.goals.splice(index, 1);
  state.goals.splice(to, 0, g);
  saveState();
  renderGoals();
  scheduleSolve();
}

// Rough budget: how many affix levels the current sockets could grant at best.
// A Lv2 socket takes a two-affix gem so it is worth 2 levels, a Lv1 socket 1,
// and each built-in affix 1. It ignores gem colours, so it is an upper bound --
// the solver is what actually decides reachability.
function affixBudget() {
  let capacity = 0;
  currentSlots().forEach(slot => {
    if (!slot.allowedTypes.length || !slot.allowedLevels.length) return;
    capacity += Math.max.apply(null, slot.allowedLevels);
  });
  capacity += activeFixedAffixes().filter(f => f.affix).length;
  const used = state.goals.reduce((sum, g) => sum + (g.target || 0), 0);
  return { capacity, used, left: capacity - used };
}

function renderGoalBudget() {
  const el = document.getElementById("goals-budget");
  if (!el) return;
  const { capacity, used, left } = affixBudget();
  if (capacity === 0 && used === 0) { el.innerHTML = ""; return; }
  const over = left < 0;
  el.innerHTML = `<p class="budget-note${over ? " over" : ""}" data-tooltip="${escapeHtml(t("budgetTip"))}">` +
    escapeHtml(t("budgetUsed", { used, capacity })) + " " +
    `<strong>${escapeHtml(over ? t("budgetOver", { n: -left }) : t("budgetLeft", { n: left }))}</strong></p>`;
}

// Keep the goal list in step with the affixes built into the gear. A built-in
// grants its levels whether or not you asked for them, so it surfaces as a real
// goal row rather than a note somewhere else.
//   - a built-in with no goal gets one, starting at the level the gear grants
//   - a target can never sit below that level
//   - when a built-in goes away, its goal is dropped only if it was purely the
//     gear's -- a target you had raised beyond it stays as an ordinary goal
// Pass the baseline from *before* the change so removals can be spotted.
function syncBuiltInGoals(prevBaseline) {
  const baseline = fixedAffixBaseline();
  prevBaseline = prevBaseline || {};

  state.goals = state.goals.filter(g => {
    const had = prevBaseline[g.affix] || 0;
    const now = baseline[g.affix] || 0;
    return !(had > 0 && now === 0 && g.target === had); // nothing of it was yours
  });

  Object.keys(baseline).forEach(affix => {
    if (!state.goals.some(g => g.affix === affix)) {
      state.goals.push({ id: generateId(), affix, target: baseline[affix] });
    }
  });

  state.goals.forEach(g => {
    const min = baseline[g.affix] || 0;
    if (g.target != null && g.target < min) g.target = min;
  });
}

// Run a change to the built-in affixes and reconcile the goals around it.
function withFixedAffixChange(mutate) {
  const before = fixedAffixBaseline();
  mutate();
  syncBuiltInGoals(before);
}

// One pip per level of a goal's target; the first `fromGear` are the levels the
// gear supplies. Refilled in place as the target changes.
function fillGoalPips(container, goal, fromGear) {
  container.innerHTML = "";
  const shown = Math.min(goal.target || 0, 12); // a silly target shouldn't spray pips
  if (shown === 0) { container.removeAttribute("data-tooltip"); return; }
  container.dataset.tooltip = fromGear > 0 ? t("pipsGearTip", { n: fromGear }) : t("pipsTip");
  for (let i = 0; i < shown; i++) {
    const pip = document.createElement("i");
    pip.className = "pip" + (i < fromGear ? " pip-gear" : "");
    container.appendChild(pip);
  }
}

function renderGoals() {
  const list = document.getElementById("goals-list");
  list.innerHTML = "";
  renderGoalBudget();
  if (state.goals.length === 0) {
    list.innerHTML = `<p class="empty-note">${t("goalsEmpty")}</p>`;
  }
  const affixes = allAffixes();
  state.goals.forEach((goal, index) => {
    const row = document.createElement("div");
    row.className = "goal-row";
    row.dataset.goalId = goal.id;

    // Order == priority: goals higher in the list are protected first when
    // there aren't enough sockets to satisfy everything.
    const orderWrap = document.createElement("span");
    orderWrap.className = "goal-order";
    orderWrap.dataset.tooltip = t("priorityTip");
    [["▲", -1], ["▼", 1]].forEach(([glyph, delta]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "order-btn";
      btn.textContent = glyph;
      btn.disabled = delta < 0 ? index === 0 : index === state.goals.length - 1;
      btn.addEventListener("click", () => moveGoal(index, delta));
      orderWrap.appendChild(btn);
    });
    row.appendChild(orderWrap);

    const rank = document.createElement("span");
    rank.className = "goal-rank";
    rank.textContent = index + 1;
    row.appendChild(rank);

    const select = document.createElement("select");
    affixes.forEach(a => {
      const opt = document.createElement("option");
      opt.value = a;
      opt.textContent = a;
      if (a === goal.affix) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => {
      goal.affix = select.value;
      saveState();
      renderGoals();
      scheduleSolve();
    });
    row.appendChild(select);

    // Which socket colours could ever supply this affix.
    const sources = affixSources(goal.affix);
    const srcWrap = document.createElement("span");
    srcWrap.className = "goal-sources";
    srcWrap.dataset.tooltip = sources.length
      ? t("sourcesTip", { list: sources.map(s => `${displayGemType(s.type)} (${s.levels.map(l => t("lvChip", { n: l })).join("/")})`).join(", ") })
      : t("sourcesNone");
    sources.forEach(s => {
      const ic = gemTypeIconEl(s.type, true);
      if (ic) srcWrap.appendChild(ic);
    });
    if (!sources.length) srcWrap.textContent = "—";
    row.appendChild(srcWrap);

    // One pip per level of the target. The leading ones are shown in the gear
    // colour when they come from a built-in -- they say where the level comes
    // from, and they're the floor the target can't drop below. Always present
    // (empty collapses via CSS) so the steppers can just refill it.
    const fromGear = fixedAffixBaseline()[goal.affix] || 0;
    const pips = document.createElement("span");
    pips.className = "goal-pips";
    row.appendChild(pips);
    fillGoalPips(pips, goal, fromGear);

    const cap = AFFIX_MAX_LEVEL[goal.affix];
    if (cap != null) {
      const capHint = document.createElement("span");
      capHint.className = "goal-cap-hint";
      capHint.textContent = t("capsAt", { n: cap });
      row.appendChild(capHint);
    }

    const targetField = document.createElement("div");
    targetField.className = "goal-field";
    const targetLabel = document.createElement("span");
    targetLabel.className = "goal-label";
    targetLabel.textContent = t("targetLevel");
    targetField.appendChild(targetLabel);

    const targetInput = document.createElement("input");
    targetInput.type = "number";
    targetInput.min = "0";
    if (cap != null) targetInput.max = String(cap);
    targetInput.min = String(fromGear); // gear grants these whatever you ask for
    targetInput.value = goal.target != null ? goal.target : "";
    targetInput.addEventListener("input", () => {
      const typed = targetInput.value === "" ? null : Math.max(0, parseInt(targetInput.value, 10) || 0);
      goal.target = typed == null ? null : Math.max(typed, fromGear);
      saveState();
      renderGoalBudget(); // cheap, so show it straight away rather than after the solve debounce
      fillGoalPips(pips, goal, fromGear);
      scheduleSolve();
    });
    // Snap a below-floor entry back once the field loses focus, so mid-typing
    // isn't fought with but the box can't be left showing an impossible number.
    targetInput.addEventListener("blur", () => {
      if (goal.target != null && Number(targetInput.value) < goal.target) targetInput.value = goal.target;
    });

    // Stepper stays inside fromGear..cap; typing is left unclamped upward so the
    // "this affix caps at N" warning can still surface a too-high target.
    const step = (delta) => {
      const current = goal.target != null ? goal.target : 0;
      let next = current + delta;
      next = Math.max(fromGear, next);
      if (cap != null) next = Math.min(next, cap);
      goal.target = next;
      targetInput.value = next;
      saveState();
      renderGoalBudget();
      fillGoalPips(pips, goal, fromGear);
      scheduleSolve();
    };

    const minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "step-btn";
    minusBtn.textContent = "−";
    minusBtn.dataset.tooltip = t("stepDown");
    minusBtn.addEventListener("click", () => step(-1));

    const plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "step-btn";
    plusBtn.textContent = "+";
    plusBtn.dataset.tooltip = t("stepUp");
    plusBtn.addEventListener("click", () => step(1));

    targetField.appendChild(targetInput);
    targetField.appendChild(minusBtn);
    targetField.appendChild(plusBtn);
    row.appendChild(targetField);

    // Filled in by applyGoalFeedback() once the solver has run.
    const badge = document.createElement("span");
    badge.className = "goal-status-badge";
    row.appendChild(badge);

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "✕";
    removeBtn.title = t("removeGoal");
    removeBtn.addEventListener("click", () => {
      state.goals.splice(index, 1);
      saveState();
      renderGoals();
      scheduleSolve();
    });
    row.appendChild(removeBtn);

    list.appendChild(pinRowEnd(row, badge, removeBtn));
  });
}

document.getElementById("add-goal").addEventListener("click", () => {
  const affixes = allAffixes();
  const used = new Set(state.goals.map(g => g.affix));
  const next = affixes.find(a => !used.has(a)) || affixes[0];
  state.goals.push({ id: generateId(), affix: next, target: 1 });
  saveState();
  renderGoals();
  scheduleSolve();
});

// ---------- Solve & Results ----------

let solveTimer = null;
function scheduleSolve() {
  clearTimeout(solveTimer);
  solveTimer = setTimeout(runSolve, 120);
}

function runSolve() {
  // The budget is a pure view of slots + targets, and every mutation funnels
  // through here -- refreshing it at this one point keeps it in step with
  // edits that don't rebuild the goal rows, such as typing a target or
  // clicking the steppers.
  renderGoalBudget();

  const dedupedGoals = new Map();
  const capInfo = {};
  for (const g of state.goals) {
    if (g.target == null) continue;
    const cap = AFFIX_MAX_LEVEL[g.affix]; // undefined for affixes we have no cap data for -> uncapped
    const effectiveTarget = cap != null ? Math.min(g.target, cap) : g.target;
    // max = the affix's own cap (not user-set) -- just stops leftover slots from
    // wastefully over-stacking a single affix once it's already maxed out.
    dedupedGoals.set(g.affix, { affix: g.affix, min: effectiveTarget, max: cap });
    capInfo[g.affix] = { cap, requestedTarget: g.target };
  }
  const goals = Array.from(dedupedGoals.values());
  const result = solveGems(activeCatalog(), currentSlots(), goals, fixedAffixBaseline());
  result.capInfo = capInfo;
  renderResults(result);
  applyGoalFeedback(result);
}

// Flags an unreachable target right on its own goal row, so you find out while
// you are still editing rather than having to read the results table. The
// solver decides this jointly -- goals compete for the same sockets -- so a
// target can be flagged even though it would be fine on its own.
function applyGoalFeedback(result) {
  const byAffix = {};
  (result.goalResults || []).forEach(g => { byAffix[g.affix] = g; });

  document.querySelectorAll(".goal-row").forEach(row => {
    const goal = state.goals.find(g => g.id === row.dataset.goalId);
    const badge = row.querySelector(".goal-status-badge");
    if (!badge) return;
    row.classList.remove("goal-row-bad");
    badge.className = "goal-status-badge";
    badge.textContent = "";
    badge.removeAttribute("data-tooltip");
    if (!goal || goal.target == null) return;

    const gr = byAffix[goal.affix];
    if (!gr) return;
    const info = result.capInfo[goal.affix] || {};

    // Asking above the affix's own cap is worth flagging even when the solver
    // reports "met" -- it clamps to the cap, so the extra levels do nothing.
    if (info.cap != null && goal.target > info.cap) {
      badge.classList.add("warn");
      badge.textContent = t("badgeCap", { cap: info.cap });
      badge.dataset.tooltip = t("badgeCapTip", { cap: info.cap });
      if (gr.status !== "met") row.classList.add("goal-row-bad");
      return;
    }

    if (gr.status === "met") {
      if (goal.target > 0) {
        badge.classList.add("ok");
        badge.textContent = "✓";
        badge.dataset.tooltip = t("badgeOk");
      }
      return;
    }

    row.classList.add("goal-row-bad");
    badge.classList.add("bad");
    badge.textContent = t("badgeOnly", { n: gr.count });
    const sources = affixSources(goal.affix);
    badge.dataset.tooltip = sources.length
      ? t("badgeOnlyTip", { n: gr.count, list: sources.map(s => displayGemType(s.type)).join(", ") })
      : t("sourcesNone");
  });
}

function renderResults(result) {
  const status = document.getElementById("solve-status");
  const content = document.getElementById("results-content");

  if (!result.hasGoals) {
    status.textContent = "";
    content.innerHTML = `<p class="empty-note">${t("needGoal")}</p>`;
    return;
  }
  if (result.usableSlotCount === 0) {
    status.textContent = "";
    content.innerHTML = `<p class="empty-note">${t("needSlot")}</p>`;
    return;
  }

  let statusText = t("explored", { n: result.nodes.toLocaleString() });
  if (result.limited) {
    // Hitting the search limit only matters if something is still unmet -- if
    // every target is satisfied, the most that could improve is the gem count.
    const allMet = result.goalResults.every(g => g.status === "met");
    statusText += " " + t(allMet ? "limitedMet" : "limited");
  }
  status.textContent = statusText;

  let html = "";

  const fixedList = activeFixedAffixes().filter(f => f.affix);
  if (fixedList.length > 0) {
    const parts = fixedList.map(f => `${escapeHtml(displayGroup(f.group))} — <strong>${escapeHtml(f.affix)}</strong>`);
    html += `<p class="info-note">${t("fixedNote")} ${parts.join(", ")}</p>`;
  }

  const unmet = result.goalResults.filter(g => g.status === "under");
  if (unmet.length > 0) {
    html += `<div class="goal-warning"><strong>${t("notReachable")}</strong><ul>`;
    unmet.forEach(g => {
      const info = result.capInfo[g.affix] || {};
      const requested = info.requestedTarget != null ? info.requestedTarget : g.min;
      const restKey = info.cap != null && requested > info.cap ? "warnCapRest" : "warnSlotsRest";
      const rest = t(restKey, { req: requested, cap: info.cap, count: g.count });
      html += `<li><strong>${escapeHtml(g.affix)}</strong> - ${rest}</li>`;
    });
    html += "</ul></div>";
  }

  const slots = currentSlots();
  const groupCounts = {};
  let configuredCount = 0;
  let unusedCount = 0;
  html += `<table class="assignment-table"><thead><tr><th>${t("thSlot")}</th><th>${t("thTypes")}</th><th>${t("thLevels")}</th><th>${t("thGem")}</th><th>${t("thGrants")}</th></tr></thead><tbody>`;
  slots.forEach((slot, i) => {
    const gem = result.assignment[i];
    if (slot.allowedTypes.length > 0) {
      configuredCount++;
      if (!gem) unusedCount++;
    }
    let slotLabel;
    if (state.viewMode === "gear") {
      groupCounts[slot.group] = (groupCounts[slot.group] || 0) + 1;
      slotLabel = t("resultGearLabel", { group: displayGroup(slot.group), n: groupCounts[slot.group] });
    } else {
      slotLabel = t("resultSlotLabel", { n: i + 1 });
    }
    html += "<tr>";
    html += `<td>${escapeHtml(slotLabel)}</td>`;
    html += `<td>${slot.allowedTypes.length ? slot.allowedTypes.map(gemTypeIconMarkup).join(" ") : `<span class="empty-slot">${t("noneCell")}</span>`}</td>`;
    html += `<td>${slot.allowedLevels.map(l => t("lvChip", { n: l })).join(", ") || `<span class="empty-slot">${t("noneCell")}</span>`}</td>`;
    if (gem) {
      html += `<td>${gemTypeIconMarkup(gem.type)} ${escapeHtml(gem.name)}</td>`;
      html += `<td>${gem.affixes.map(escapeHtml).join(", ")}</td>`;
    } else {
      html += `<td class="empty-slot">${t("emptyCell")}</td><td></td>`;
    }
    html += "</tr>";
  });
  html += "</tbody></table>";

  if (unusedCount > 0) {
    const allMet = result.goalResults.every(g => g.status === "met");
    if (allMet) {
      html += `<p class="info-note">${t("unusedNote", { n: unusedCount, m: configuredCount })}`;
      // Which of the chosen affixes could still legally climb higher?
      const headroom = result.goalResults
        .filter(g => {
          const cap = (result.capInfo[g.affix] || {}).cap;
          return cap != null && g.count < cap;
        })
        .map(g => t("headroomItem", { affix: escapeHtml(g.affix), cap: (result.capInfo[g.affix] || {}).cap }));
      if (headroom.length > 0) {
        html += " " + t("headroomNote", { list: headroom.join(", ") });
      }
      html += "</p>";
    } else {
      // Slots sat empty while a target went unmet -- they simply can't take a
      // gem that helps (wrong gem type/level for what's still missing).
      html += `<p class="info-note">${t("unusedIdleNote", { n: unusedCount, m: configuredCount })}</p>`;
    }
  }

  html += `<table class="goals-table" style="margin-top:14px"><thead><tr><th>${t("thAffix")}</th><th>${t("thTarget")}</th><th>${t("thAchieved")}</th><th>${t("thStatus")}</th></tr></thead><tbody>`;
  result.goalResults.forEach(g => {
    const info = result.capInfo[g.affix] || {};
    const requestedTarget = info.requestedTarget != null ? info.requestedTarget : g.min;
    const target = [
      requestedTarget,
      info.cap != null ? t("capsAtParen", { n: info.cap }) : null,
    ].filter(Boolean).join(" ");
    const statusText = g.status === "met" ? t("statusMet") : t("statusUnder");
    html += `<tr><td>${escapeHtml(g.affix)}</td><td>${target}</td><td>${g.count}</td><td class="status-${g.status === "met" ? "met" : "under"}">${statusText}</td></tr>`;
  });
  html += "</tbody></table>";

  content.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Language ----------

function applyStaticTranslations() {
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-html]").forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll(".lang-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lang === LANG);
  });
}

document.querySelectorAll(".lang-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    setLang(btn.dataset.lang);
    applyStaticTranslations();
    renderSlots();
    renderGoals();
    runSolve();
  });
});

// ---------- Init ----------

applyStaticTranslations();
renderSlots();
renderGoals();
runSolve();
