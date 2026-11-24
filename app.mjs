import { calculateQuote, solvePrice } from "./quote.mjs";
import { luggageTag } from "./examples/luggage-tag-data.mjs";
import { applyImportedMaterial, importDocumentKey, matchesImport, materialSources, readMaterialImport } from "./material-import.mjs";

const byId = id => document.getElementById(id);
const form = byId("quote-form");
const recipe = byId("recipe");
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 });
const formatMoney = cents => money.format(cents / 100);
const totals = ["total", "revenue", "production", "shipping-total", "fees", "profit", "unit-profit", "margin"];
let openQuote = null;
let openPlan = null;
let editingMaterial = null;
let materialPendingDelete = null;
let editingImport = null;
let materialImports = [];
const storageKey = "dacha-craft-workspace-v1";
const emptyWorkspace = () => ({ version: 1, materials: [], quotes: [], plans: [] });
let workspace = emptyWorkspace();
try {
  const stored = localStorage.getItem(storageKey);
  if (stored) workspace = validateBackup(JSON.parse(stored));
} catch {
  notify("Saved workspace could not be loaded. Your browser data has not been overwritten.");
  byId("workspace-status").dataset.storageBlocked = "true";
}

function notify(message) {
  const status = byId("workspace-status");
  status.hidden = false;
  status.textContent = message;
}

function persist(next, message) {
  if (byId("workspace-status").dataset.storageBlocked) throw new Error("Storage is unavailable. Existing browser data was preserved.");
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch (error) {
    if (error.name === "QuotaExceededError") {
      throw new Error("Browser storage is full. The change was not saved and existing records were preserved.");
    }
    throw error;
  }
  workspace = next;
  renderWorkspace();
  notify(message);
}

function safely(action) {
  return (...args) => {
    try { return action(...args); }
    catch (error) { notify(error.message); }
  };
}

function showView(id) {
  for (const button of document.querySelectorAll("[data-view]")) {
    const active = button.dataset.view === id;
    byId(button.dataset.view).hidden = !active;
    button.setAttribute("aria-pressed", String(active));
  }
}

function hundredths(input) {
  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(input.value);
  if (!match || !input.value) throw new RangeError("Enter dollar amounts and percentages with at most two decimal places.");
  return Number(match[1] + (match[2] ?? "").padEnd(2, "0"));
}

function readQuote(rows = Array.from(recipe.children)) {
  const invalid = form.querySelector("input:invalid");
  if (invalid) {
    invalid.setAttribute("aria-invalid", "true");
    throw new RangeError(`${invalid.labels[0].textContent.trim()}. ${invalid.validationMessage}`);
  }
  return {
    product: byId("product").value.trim() || "Untitled product",
    channel: byId("channel").value.trim() || "Direct",
    targetBasisPoints: hundredths(byId("target")),
    quantity: byId("quantity").valueAsNumber,
    batch: {
      started: byId("started").valueAsNumber, sellable: byId("sellable").valueAsNumber,
      partialStarted: byId("partial").value ? byId("partial").valueAsNumber : null,
    },
    priceCents: hundredths(byId("price")),
    setupCents: hundredths(byId("setup")),
    discountCents: hundredths(byId("discount")),
    shippingCents: hundredths(byId("shipping")),
    feeBasisPoints: hundredths(byId("fee")),
    fixedFeeCents: hundredths(byId("fixed")),
    recipe: rows.map(row => {
      const input = field => row.querySelector(`[data-field="${field}"]`);
      return {
        id: row.dataset.id,
        label: input("label").value,
        category: input("category").value,
        scope: input("scope").value,
        usage: normalizeDecimal(input("usage").value),
        material: row.materialSnapshot ?? null,
        rate: { cents: hundredths(input("rateCost")), units: normalizeDecimal(input("rateUnits").value) },
      };
    }),
  };
}

function normalizeDecimal(value) {
  return String(value).replace(/^\./, "0.").replace(/\.$/, "");
}

function update() {
  const rows = Array.from(recipe.children);
  const error = byId("error");
  byId("product-summary").textContent = byId("product").value.trim() || "Untitled product";
  form.querySelectorAll("[aria-invalid]").forEach(input => input.removeAttribute("aria-invalid"));
  try {
    const input = readQuote(rows);
    const quote = calculateQuote(input);
    const runLabel = quote.runs === 1 ? "run" : "runs";
    byId("runs").textContent = `${quote.runs} production ${runLabel} · ${quote.startedUnits} units started`;
    rows.forEach((row, index) => {
      row.querySelector("output").textContent = formatMoney(quote.lines[index].amountCents);
    });
    const values = [
      formatMoney(quote.customerTotalCents), formatMoney(quote.customerTotalCents),
      formatMoney(quote.productionCents), formatMoney(quote.shippingCents), formatMoney(quote.feeCents),
      formatMoney(quote.profitCents), formatMoney(quote.profitPerUnitCents),
      quote.actualMargin === null ? "—" : percent.format(quote.actualMargin),
    ];
    totals.forEach((id, index) => { byId(id).textContent = values[index]; });
    byId("profit").classList.toggle("loss", quote.profitCents < 0);
    const target = input.targetBasisPoints / 10000;
    byId("target-status").textContent = quote.actualMargin === null ? "" :
      `${quote.actualMargin >= target ? "Meets" : "Below"} the ${percent.format(target)} target.`;
    error.hidden = true;
    error.textContent = "";
  } catch (issue) {
    if (!(issue instanceof RangeError)) throw issue;
    totals.forEach(id => { byId(id).textContent = "—"; });
    rows.forEach(row => { row.querySelector("output").textContent = "—"; });
    byId("runs").textContent = "";
    byId("target-status").textContent = "";
    byId("profit").classList.remove("loss");
    error.hidden = false;
    error.textContent = issue.message;
  }
}

function addRow(cost) {
  const row = byId("cost-row").content.firstElementChild.cloneNode(true);
  row.dataset.id = cost.id ?? crypto.randomUUID();
  row.querySelector("legend").textContent = cost.label || "New production cost";
  const fields = {
    label: cost.label, category: cost.category, scope: cost.scope,
    usage: cost.usage, rateCost: cost.rate.cents / 100, rateUnits: cost.rate.units,
  };
  Object.entries(fields).forEach(([field, value]) => {
    row.querySelector(`[data-field="${field}"]`).value = value;
  });
  if (cost.material) {
    row.materialSnapshot = { ...cost.material };
    for (const field of ["label", "rateCost", "rateUnits"]) {
      row.querySelector(`[data-field="${field}"]`).readOnly = true;
    }
    const source = row.querySelector(".material-source");
    source.hidden = false;
    source.textContent = cost.material.purchaseUpper
      ? `Library rate · using ${cost.rate.units} ${cost.material.unit} from a ${quantityRange(cost.rate.units, cost.material.purchaseUpper, cost.material.purchasePlus)} ${cost.material.unit} purchase`
      : `Library rate · ${cost.material.unit}`;
  }
  row.querySelector('[data-field="label"]').addEventListener("input", event => {
    row.querySelector("legend").textContent = event.target.value.trim() || "Production cost";
  });
  row.querySelector(".remove").addEventListener("click", () => {
    const next = row.nextElementSibling ?? row.previousElementSibling;
    row.remove();
    (next?.querySelector(".remove") ?? byId("add-row")).focus();
    update();
  });
  recipe.append(row);
  return row;
}

function loadQuote(sample, id = null) {
  openQuote = id;
  const values = {
    product: sample.product, quantity: sample.quantity, price: sample.priceCents / 100,
    started: sample.batch.started, sellable: sample.batch.sellable,
    setup: sample.setupCents / 100, discount: sample.discountCents / 100, shipping: sample.shippingCents / 100,
    fee: sample.feeBasisPoints / 100, fixed: sample.fixedFeeCents / 100,
    partial: sample.batch.partialStarted ?? "", channel: sample.channel ?? "Direct",
    target: (sample.targetBasisPoints ?? 5000) / 100,
  };
  Object.entries(values).forEach(([id, value]) => { byId(id).value = value; });
  recipe.replaceChildren();
  sample.recipe.forEach(addRow);
  update();
}

form.addEventListener("submit", event => event.preventDefault());
form.addEventListener("input", update);
byId("load-sample").addEventListener("click", () => loadQuote(luggageTag));
byId("new-quote").addEventListener("click", () => loadQuote({
  product: "", quantity: 1, batch: { started: 1, sellable: 1 }, priceCents: 0, setupCents: 0,
  discountCents: 0, shippingCents: 0, feeBasisPoints: 0, fixedFeeCents: 0, recipe: [],
}));
byId("add-row").addEventListener("click", () => {
  const row = addRow({ label: "", category: "material", scope: "sellableUnit", usage: 1, rate: { cents: 0, units: 1 } });
  row.querySelector('[data-field="label"]').focus();
  update();
});
loadQuote(luggageTag);

const materialForm = byId("material-form");
const materialType = materialForm.elements.namedItem("type");
const materialWeight = materialForm.elements.namedItem("weight");
const quantityFormats = [
  { key: "purchase", formatField: "leather-range-field", exactLabel: "Usable quantity purchased", rangeLabel: "Range lower estimate" },
  { key: "stock", formatField: "leather-stock-format-field", exactLabel: "Quantity on hand", rangeLabel: "Stock lower estimate" },
];
const photoInput = materialForm.elements.namedItem("photo");
let materialPhoto = "";
let pendingPhoto = null;
const pickMaterial = byId("pick-material");
const storedQuote = byId("plan-quote");
const planForm = byId("plan-form");
const planOrders = byId("plan-orders");

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function action(label, run) {
  const button = element("button", label);
  button.type = "button";
  button.addEventListener("click", safely(run));
  return button;
}

function record(title, detail, buttons, photo) {
  const row = element("div", null, "record");
  const description = element("div");
  description.append(element("strong", title), element("p", detail));
  const identity = element("div", null, "record-identity");
  if (photo) {
    const image = element("img", null, "material-thumbnail");
    image.src = photo;
    image.alt = "";
    image.loading = "lazy";
    identity.append(image);
  }
  identity.append(description);
  const actions = element("div", null, "actions");
  actions.append(...buttons);
  row.append(identity, actions);
  return row;
}

function choices(select, placeholder, entries) {
  const previous = select.value;
  select.replaceChildren(new Option(placeholder, ""), ...entries.map(([label, id]) => new Option(label, id)));
  if (entries.some(([, id]) => previous === id)) select.value = previous;
}

function quantityRange(lower, upper, plus) {
  return upper ? `${lower}–${upper}${plus ? "+" : ""}` : lower;
}

function materialGroups() {
  const types = Array.from(materialType.options);
  const ordered = [...types.filter(type => type.value !== "other"), types.find(type => type.value === "other")];
  const groups = new Map(ordered.map(type => [type.value, { label: type.textContent.trim(), items: [] }]));
  for (const item of workspace.materials) {
    (groups.get(item.type) ?? groups.get("other")).items.push(item);
  }
  return Array.from(groups.values()).filter(group => group.items.length).map(group => ({
    ...group, items: group.items.sort((first, second) => first.name.localeCompare(second.name)),
  }));
}

function renderWorkspace() {
  const groups = materialGroups();
  const previousMaterial = pickMaterial.value;
  pickMaterial.replaceChildren(new Option("Select a material", ""), ...groups.map(group => {
    const options = element("optgroup");
    options.label = group.label;
    options.append(...group.items.map(item => new Option(`${item.name} (${item.unit})`, item.id)));
    return options;
  }));
  if (workspace.materials.some(item => item.id === previousMaterial)) pickMaterial.value = previousMaterial;
  byId("add-material").disabled = !pickMaterial.value;
  choices(storedQuote, "Select a saved quote", workspace.quotes.map(item =>
    [`${item.input.product} · ${item.input.channel} · ${item.input.quantity} units`, item.id]));
  byId("add-plan-order").disabled = !storedQuote.value;
  const materialRecord = item => {
    const controls = [
      action("Edit material", () => editMaterial(item)),
      action("Duplicate material", () => duplicateMaterial(item)),
      action("Delete material", () => requestMaterialDeletion(item)),
    ];
    if (item.link) {
      const link = element("a", "Supplier");
      link.href = item.link;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      controls.unshift(link);
    }
    const type = Array.from(materialType.options).find(option => option.value === item.type);
    const description = [
      type?.value !== "other" ? type?.textContent.trim() : "",
      item.type === "leather" && item.weight ? `${item.weight} oz leather` : "",
      `${quantityRange(item.stock, item.stockUpper, item.stockPlus)} ${item.unit} on hand`,
      item.cut,
      item.purchaseUpper
        ? `${formatMoney(item.cost)} per ${quantityRange(item.purchase, item.purchaseUpper, item.purchasePlus)} ${item.unit} · quotes use ${item.purchase} ${item.unit}`
        : `${formatMoney(item.cost)} per ${item.purchase} ${item.unit}`,
    ].filter(Boolean).join(" · ");
    const row = record(item.name, description, controls, item.photo);
    const sources = materialSources(item);
    if (sources.length) {
      const details = element("details", null, "material-source-details");
      details.append(element("summary", "Order history"), ...sources.map(source => element("p", sourceSummary(source))));
      row.querySelector(".record-identity > div").append(details);
    }
    return row;
  };
  byId("materials").replaceChildren(...groups.map(({ label, items }) => {
    const group = element("section", null, "material-group");
    group.append(element("h2", label), ...items.map(materialRecord));
    return group;
  }));
  if (!workspace.materials.length) byId("materials").append(element("p", "Your material library is empty.", "hint"));
  byId("saved-quotes").replaceChildren(...workspace.quotes.map(item => record(item.input.product,
    `${item.final ? "Final" : "Draft"} · ${item.input.channel} · ${formatMoney(calculateQuote(item.input).customerTotalCents)} · ${new Date(item.savedAt).toLocaleDateString()}`,
    [
      action(item.final ? "Open as draft" : "Open", () => openSavedQuote(item, item.final ? null : item.id)),
      action("Duplicate", () => {
        const copy = { ...item, id: crypto.randomUUID(), final: false, savedAt: new Date().toISOString(),
          input: { ...item.input, product: `${item.input.product} (copy)` } };
        persist({ ...workspace, quotes: [...workspace.quotes, copy] }, "Quote duplicated.");
        openSavedQuote(copy, copy.id);
      }),
    ])));
  if (!workspace.quotes.length) byId("saved-quotes").append(element("p", "No saved quotes yet.", "hint"));
  byId("saved-plans").replaceChildren(...workspace.plans.map(item => record(item.input.name,
    `${item.input.orders.length} order types · ${new Date(item.savedAt).toLocaleDateString()}`,
    [
      action("Open", () => loadPlan(item.input, item.id)),
      action("Duplicate", () => {
        const copy = { ...item, id: crypto.randomUUID(), savedAt: new Date().toISOString(),
          input: { ...item.input, name: `${item.input.name} (copy)` } };
        persist({ ...workspace, plans: [...workspace.plans, copy] }, "Monthly plan duplicated.");
        loadPlan(copy.input, copy.id);
      }),
    ])));
  if (!workspace.plans.length) byId("saved-plans").append(element("p", "No saved plans yet.", "hint"));
}

function editMaterial(item, id = item.id) {
  editingImport = null;
  editingMaterial = id;
  byId("material-import-edit").hidden = true;
  resetPhoto(item.photo);
  for (const [name, value] of Object.entries({ name: item.name, type: item.type ?? "other",
    weight: item.weight ?? "", unit: item.unit, cost: item.cost == null ? "" : item.cost / 100,
    cut: item.cut ?? "", purchase: item.purchase, purchaseUpper: item.purchaseUpper ?? "",
    purchaseFormat: item.purchaseUpper ? (item.purchasePlus ? "rangePlus" : "range") : "exact",
    stockUpper: item.stockUpper ?? "", stockFormat: item.stockUpper ? (item.stockPlus ? "rangePlus" : "range") : "exact",
    stock: item.stock, link: item.link })) {
    const field = materialForm.elements.namedItem(name);
    if (field) field.value = value;
  }
  updateMaterialType();
  byId("material-submit").textContent = id ? "Save material" : "Add material";
  byId("cancel-material").hidden = false;
  byId("cancel-material").textContent = id ? "Cancel edit" : "Cancel duplicate";
  materialForm.elements.namedItem("name").focus();
}

function duplicateMaterial(item) {
  editMaterial({
    ...item, name: `${item.name} (copy)`, stock: "0", stockUpper: undefined, stockPlus: undefined,
  }, null);
  notify("Material copied into the form. Save it to create a separate record.");
}

function requestMaterialDeletion(item) {
  materialPendingDelete = item.id;
  const dialog = byId("delete-material-dialog");
  dialog.returnValue = "cancel";
  byId("delete-material-description").textContent =
    `Delete ${item.name} from the material library? Saved quotes retain the rates they already used.`;
  dialog.showModal();
}

byId("delete-material-dialog").addEventListener("close", safely(event => {
  const id = materialPendingDelete;
  materialPendingDelete = null;
  if (event.currentTarget.returnValue !== "delete" || !id) return;
  const removed = workspace.materials.find(material => material.id === id);
  if (!removed) return;
  persist({ ...workspace, materials: workspace.materials.filter(material => material.id !== id) },
    `${removed.name} deleted from the library.`);
  if (editingMaterial === id) resetMaterialForm();
  for (const draft of materialImports) {
    if (draft.destination === id) delete draft.destination;
  }
  renderMaterialImports();
  byId("library-heading").focus();
}));

function resetMaterialForm() {
  editingMaterial = null;
  editingImport = null;
  byId("material-import-edit").hidden = true;
  materialForm.reset();
  updateMaterialType();
  resetPhoto();
  byId("material-submit").textContent = "Add material";
  byId("cancel-material").hidden = true;
}

function updateMaterialType(applyUnit = false) {
  const leather = materialType.value === "leather";
  byId("material-weight-field").hidden = !leather;
  materialWeight.disabled = !leather;
  byId("leather-cut-field").hidden = !leather;
  materialForm.elements.namedItem("cut").disabled = !leather;
  for (const { key, formatField, exactLabel, rangeLabel } of quantityFormats) {
    const format = materialForm.elements.namedItem(`${key}Format`);
    const upper = materialForm.elements.namedItem(`${key}Upper`);
    const range = leather && format.value !== "exact";
    byId(formatField).hidden = !leather;
    format.disabled = !leather;
    byId(`${key}-upper-field`).hidden = !range;
    byId(`${key}-quantity-label`).textContent = range ? rangeLabel : exactLabel;
    upper.disabled = !range;
    upper.required = range;
  }
  byId("leather-range-hint").hidden = !leather || materialForm.elements.namedItem("purchaseFormat").value === "exact";
  const unit = materialType.selectedOptions[0]?.dataset.unit;
  if (applyUnit && unit) materialForm.elements.namedItem("unit").value = unit;
}

function showPhoto(photo) {
  materialPhoto = photo ?? "";
  const image = byId("material-photo");
  if (materialPhoto) image.src = materialPhoto;
  else image.removeAttribute("src");
  byId("material-photo-preview").hidden = !materialPhoto;
}

function resetPhoto(photo) {
  pendingPhoto = null;
  photoInput.value = "";
  byId("material-submit").disabled = false;
  showPhoto(photo);
}

async function makeThumbnail(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 15 * 1024 * 1024) {
    throw new Error("Choose a JPEG, PNG, or WebP image up to 15 MB.");
  }
  let image;
  try { image = await createImageBitmap(file); }
  catch { throw new Error("This photo could not be opened. Choose another image."); }
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 480 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } finally {
    image.close();
  }
}

function validateMaterial(item) {
  if (!item || typeof item.id !== "string" || !item.id || typeof item.name !== "string" ||
      !item.name.trim() || typeof item.unit !== "string" || !item.unit.trim() ||
      !Number.isSafeInteger(item.cost) || item.cost < 0 ||
      !/^\d+(?:\.\d{1,6})?$/.test(item.purchase) || !Number.isFinite(Number(item.purchase)) ||
      Number(item.purchase) <= 0 || !/^\d+(?:\.\d{1,6})?$/.test(item.stock) ||
      !Number.isFinite(Number(item.stock)) || typeof item.link !== "string") {
    throw new Error("Enter a material name, unit, cost, usable purchase quantity, and stock on hand.");
  }
  if (item.link && !["https:", "http:"].includes(new URL(item.link).protocol)) {
    throw new Error("Supplier links must use HTTP or HTTPS.");
  }
  if (item.type != null && !["other", "leather", "thread", "filament", "hardware", "sheet", "packaging"].includes(item.type)) {
    throw new Error("Invalid material type.");
  }
  if (item.weight != null && (item.type !== "leather" || typeof item.weight !== "string" ||
      !/^\d+(?:\.\d{1,2})?$/.test(item.weight) || !Number.isFinite(Number(item.weight)) || Number(item.weight) <= 0)) {
    throw new Error("Enter a positive leather weight in ounces, with up to two decimal places.");
  }
  if (item.cut != null && (item.type !== "leather" || typeof item.cut !== "string" || item.cut.length > 60)) {
    throw new Error("Enter a leather cut or size up to 60 characters.");
  }
  for (const [key, label] of [["purchase", "purchase area"], ["stock", "stock on hand"]]) {
    const upper = item[`${key}Upper`];
    const plus = item[`${key}Plus`];
    if (upper != null && (item.type !== "leather" || typeof upper !== "string" ||
        !/^\d+(?:\.\d{1,6})?$/.test(upper) || !Number.isFinite(Number(upper)) || Number(upper) <= Number(item[key]))) {
      throw new Error(`The upper ${label} estimate must be greater than the lower estimate.`);
    }
    if (plus != null && (typeof plus !== "boolean" || !upper)) {
      throw new Error(`A ${label} range is required for a plus estimate.`);
    }
  }
  if (item.photo != null && (typeof item.photo !== "string" || item.photo.length > 400000 ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(item.photo))) {
    throw new Error("Invalid material photo.");
  }
}

function sourceSummary(source) {
  return [source.vendor, source.document, source.order && `Order ${source.order}`, source.date,
    source.sku && `SKU ${source.sku}`, source.unitCost != null ? `${formatMoney(source.unitCost)} per ordered unit` : "",
    source.orderQuantity != null ? `Ordered: ${source.orderQuantity}` : "", source.description]
    .filter(Boolean).join(" · ");
}

function reviewIssue(item) {
  if (!item.purchase) return "Enter the usable quantity.";
  if (item.cost == null) return "Enter the purchase cost.";
  if (!item.unit) return "Enter the unit used in quotes.";
  if (item.name.length > 120) return "Shorten the material name to 120 characters.";
  try {
    validateMaterial(item);
    return "";
  } catch (error) {
    return error.message;
  }
}

function matchingMaterials(item) {
  return workspace.materials.filter(material => matchesImport(material, item));
}

function saveCandidate({ skipped, destination, ...item }, matches, materials) {
  const issue = reviewIssue(item);
  if (issue) throw new Error(issue);
  if (matches.length && !destination) throw new Error("Choose whether to update the match or create a separate record.");
  if (!destination || destination === "new") return item;
  const existing = materials.find(material => material.id === destination);
  if (!existing) throw new Error("Choose an existing material again.");
  const merged = applyImportedMaterial(existing, item);
  validateMaterial(merged);
  return merged;
}

function importSaveStatus(message) {
  const status = byId("material-import-save-status");
  status.textContent = message;
  status.hidden = !message;
}

function renderMaterialImports() {
  const hasItems = materialImports.length > 0;
  byId("material-import-actions").hidden = !hasItems;
  const selected = materialImports.filter(item => !item.skipped);
  byId("save-material-import").textContent = "Save ready materials";
  byId("save-material-import").disabled = !selected.length;
  byId("material-import-list").replaceChildren(...materialImports.map(item => {
    const matches = matchingMaterials(item);
    const detail = () => {
      let progress = item.skipped ? "Skipped" : "Ready to save";
      if (!item.skipped) {
        try { saveCandidate(item, matches, workspace.materials); }
        catch (error) { progress = error.message; }
      }
      return [progress, item.cost == null ? "" : formatMoney(item.cost),
        item.weight ? `${item.weight} oz` : "",
        item.purchase ? quantityRange(item.purchase, item.purchaseUpper, item.purchasePlus) + " " + item.unit : "",
        sourceSummary(item.source)].filter(Boolean).join(" · ");
    };
    const controls = [
      action("Review or edit", () => {
        editMaterial(item, null);
        editingImport = item.id;
        byId("material-import-edit").hidden = false;
        byId("material-import-edit").textContent = [`Reviewing ${item.name}`, sourceSummary(item.source),
          "For an update, quantity on hand is the amount received to add to existing stock."].join(" · ");
        byId("material-submit").textContent = "Keep draft changes";
        byId("cancel-material").textContent = "Cancel review";
      }),
      action(item.skipped ? "Include" : "Skip", () => {
        item.skipped = !item.skipped;
        renderMaterialImports();
      }),
    ];
    if (workspace.materials.length && !item.skipped) {
      const label = element("label", matches.length ? "Possible inventory matches" : "Save as");
      const select = element("select");
      const addOptions = (heading, materials) => {
        if (!materials.length) return;
        const group = element("optgroup");
        group.label = heading;
        group.append(...materials.map(material => new Option(
          [`Update ${material.name}`, material.weight ? `${material.weight} oz` : "",
            `${material.stock} ${material.unit} on hand`].filter(Boolean).join(" · "), material.id)));
        select.append(group);
      };
      if (matches.length) select.append(new Option("Choose what to save", ""));
      select.append(new Option("Create a separate material", "new"));
      addOptions("Suggested matches", matches);
      addOptions("Other existing materials", workspace.materials.filter(material => !matches.includes(material)));
      select.value = item.destination || (matches.length ? "" : "new");
      select.addEventListener("change", () => {
        item.destination = select.value;
        row.querySelector(".record-identity p").textContent = detail();
        importSaveStatus("");
      });
      label.append(select);
      controls.unshift(label);
    }
    const row = record(item.name, detail(), controls);
    return row;
  }));
}

byId("material-import-files").addEventListener("change", async event => {
  const input = event.target;
  const files = Array.from(input.files);
  if (!files.length) return;
  importSaveStatus("");
  const status = byId("material-import-status");
  status.hidden = false;
  status.textContent = "Reading import files…";
  input.disabled = true;
  let added = 0;
  let repeated = 0;
  const problems = [];
  try {
    for (const file of files) {
      try {
        const rows = await readMaterialImport(file);
        const known = new Set([...workspace.materials, ...materialImports].flatMap(item =>
          materialSources(item).map(source => importDocumentKey(source, item.name))).filter(Boolean));
        for (const row of rows) {
          const key = importDocumentKey(row.source, row.name);
          if (key && known.has(key)) { repeated++; continue; }
          materialImports.push({ ...row, id: crypto.randomUUID(), effectiveAt: new Date().toISOString(), skipped: false });
          if (key) known.add(key);
          added++;
        }
      } catch (error) {
        problems.push(`${file.name} — ${error.message}`);
      }
    }
  } catch {
    problems.push("The importer could not load. Restart the local calculator server and refresh this page.");
  } finally {
    input.disabled = false;
    input.value = "";
    status.textContent = [`${added} drafts added.`, repeated ? `${repeated} order lines already imported or in review.` : "", ...problems]
      .filter(Boolean).join(" ");
    renderMaterialImports();
  }
});

function saveMaterialImports() {
  if (editingImport) throw new Error("Keep or cancel the open draft changes before saving the import.");
  const selected = materialImports.filter(item => !item.skipped);
  const materials = [...workspace.materials];
  const saved = new Set();
  const pending = [];
  for (const draft of selected) {
    try {
      const item = saveCandidate(draft, matchingMaterials(draft), materials);
      const index = materials.findIndex(material => material.id === item.id);
      if (index < 0) materials.push(item);
      else materials[index] = item;
      saved.add(draft.id);
    } catch (error) {
      pending.push(`${draft.name}: ${error.message}`);
    }
  }
  if (saved.size) {
    persist({ ...workspace, materials }, `${saved.size} imported materials saved.`);
    materialImports = materialImports.filter(item => !saved.has(item.id));
    renderMaterialImports();
  }
  const result = saved.size ? `Saved ${saved.size} ${saved.size === 1 ? "material" : "materials"}.` : "No materials are ready to save.";
  const remaining = pending.length ? ` ${pending.length} ${pending.length === 1 ? "draft needs" : "drafts need"} review. ${pending[0]}` : "";
  importSaveStatus(result + remaining);
}

byId("save-material-import").addEventListener("click", () => {
  try { saveMaterialImports(); }
  catch (error) { importSaveStatus(error.message); }
});

byId("discard-material-import").addEventListener("click", () => {
  if (editingImport) resetMaterialForm();
  materialImports = [];
  renderMaterialImports();
  importSaveStatus("");
  byId("material-import-status").textContent = "Import drafts discarded.";
});

byId("material-import-template").addEventListener("click", () => download("dacha-craft-materials.csv", "text/csv", csv([
  ["name", "type", "unit", "purchase_cost", "purchase", "stock", "link", "weight", "cut",
    "purchaseUpper", "purchasePlus", "stockUpper", "stockPlus", "description"],
  ["Example quarter hide", "leather", "sq ft", "48.00", "3", "0", "", "4.5", "1/4 hide", "4", "true", "", "", ""],
])));

function materialRow(item, existing = {}) {
  return {
    id: existing.id, category: existing.category ?? "material",
    scope: existing.scope ?? "sellableUnit", usage: existing.usage ?? 1,
    label: `${item.name} (${item.unit})`, material: { id: item.id, unit: item.unit, effectiveAt: item.effectiveAt,
      purchaseUpper: item.purchaseUpper, purchasePlus: item.purchasePlus },
    rate: { cents: item.cost, units: item.purchase },
  };
}

function openSavedQuote(item, id) {
  loadQuote(item.input, id);
  showView("quote-view");
}

function saveQuote(final) {
  const input = readQuote();
  calculateQuote(input);
  const id = final ? crypto.randomUUID() : openQuote ?? crypto.randomUUID();
  const item = { id, savedAt: new Date().toISOString(), input, final };
  persist({ ...workspace, quotes: [...workspace.quotes.filter(quote => quote.id !== id), item] },
    final ? "Final quote snapshot saved." : "Draft quote saved.");
  if (!final) openQuote = id;
}

function download(filename, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = element("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csv(rows) {
  const cell = value => {
    let escaped = String(value ?? "");
    if (typeof value === "string" && /^\s*[=+@-]/.test(value)) escaped = "'" + escaped;
    return '"' + escaped.replaceAll('"', '""') + '"';
  };
  return rows.map(row => row.map(cell).join(",")).join("\r\n");
}

function quoteCsv() {
  const input = readQuote();
  const result = calculateQuote(input);
  download("dacha-craft-quote.csv", "text/csv", csv([
    ["Product", "Channel", "Category", "Name", "Material ID", "Scope", "Count", "Usage", "Rate cents", "Rate quantity", "Amount cents"],
    ...result.lines.map(line => [input.product, input.channel, line.category, line.label, line.material?.id,
      line.scope, line.count, line.usage, line.rate.cents, line.rate.units, line.amountCents]),
    ...[["Customer total", result.customerTotalCents], ["Production total", result.productionCents],
      ["Shipping", result.shippingCents], ["Selling fees", result.feeCents], ["Profit", result.profitCents]]
      .map(([label, amount]) => [input.product, input.channel, "Summary", label, "", "", "", "", "", "", amount]),
  ]));
}

function addPlanOrder(order) {
  const row = element("div", null, "record");
  row.quote = structuredClone(order.quote);
  const label = element("label", `${order.quote.product} · ${order.quote.channel} · orders per month`);
  const input = element("input");
  Object.assign(input, { type: "number", min: "0", step: "1", required: true, value: order.count });
  label.append(input);
  row.append(label, action("Remove", () => { row.remove(); updatePlan(); }));
  planOrders.append(row);
}

function readPlan() {
  if (!planForm.checkValidity()) throw new RangeError("Check monthly plan quantities, amounts, and percentages.");
  return {
    name: byId("plan-name").value.trim() || "Monthly plan",
    overhead: hundredths(byId("overhead")), marketing: hundredths(byId("marketing")),
    admin: byId("admin").valueAsNumber, adminRate: hundredths(byId("admin-rate")),
    savings: hundredths(byId("savings")), reserve: hundredths(byId("reserve")),
    orders: Array.from(planOrders.children, row => ({ quote: row.quote, count: row.querySelector("input").valueAsNumber })),
  };
}

function monthly(plan) {
  const adminRate = plan.adminRate ?? 0;
  if (typeof plan.name !== "string" || !Array.isArray(plan.orders) || !Number.isFinite(plan.admin) ||
      plan.admin < 0 || ![plan.overhead, plan.marketing, plan.savings, plan.reserve, adminRate]
        .every(value => Number.isSafeInteger(value) && value >= 0) || plan.savings > 10000 || plan.reserve > 10000) {
    throw new RangeError("Invalid monthly plan inputs.");
  }
  const categories = new Map();
  const productionDetail = [];
  let revenue = 0, production = 0, selling = 0, labor = 0, owner = 0, machine = 0;
  const contributions = [];
  for (const { quote, count } of plan.orders) {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("Order counts must be nonnegative whole numbers.");
    const result = calculateQuote(quote);
    revenue += result.customerTotalCents * count;
    production += result.productionCents * count;
    selling += (result.feeCents + result.shippingCents) * count;
    labor += result.lines.filter(line => line.category === "labor").reduce((sum, line) => sum + line.minutes, 0) * count;
    owner += result.lines.filter(line => line.category === "ownerLabor").reduce((sum, line) => sum + line.minutes, 0) * count;
    machine += result.lines.filter(line => line.category === "machine").reduce((sum, line) => sum + line.minutes, 0) * count;
    for (const line of result.lines) {
      const amount = line.amountCents * count;
      categories.set(line.category, (categories.get(line.category) ?? 0) + amount);
      productionDetail.push([quote.product, quote.channel, line.category, line.label, count, line.count,
        line.usage, line.rate.cents, line.rate.units, amount]);
    }
    contributions.push([`${quote.product} · ${quote.channel}`, result.profitCents * count]);
  }
  const adminCost = adminRate ? calculateQuote({
    quantity: 1, batch: { started: 1, sellable: 1 }, priceCents: 0,
    recipe: [{ id: "admin", scope: "order", usage: plan.admin.toFixed(6), rate: { cents: adminRate, units: 1 } }],
  }).productionCents : 0;
  if (![revenue, production, selling, plan.marketing + selling + plan.overhead + production + adminCost]
    .every(Number.isSafeInteger)) throw new RangeError("Monthly amounts exceed the supported range.");
  const gross = revenue - production;
  const contribution = gross - selling - plan.marketing;
  const operating = contribution - plan.overhead - adminCost;
  const allocation = (base, rate) => Number((BigInt(base) * BigInt(rate) + 5000n) / 10000n);
  const savings = allocation(revenue, plan.savings);
  const reserve = allocation(Math.max(operating, 0), plan.reserve);
  const unpaid = (categories.get("ownerLabor") ?? 0) + adminCost;
  const cash = operating + unpaid - savings - reserve;
  if (!Number.isSafeInteger(cash)) throw new RangeError("Monthly cash exceeds the supported range.");
  return { contributions, productionDetail, hours: [["Paid production hours", labor / 60], ["Owner production hours", owner / 60], ["Machine hours", machine / 60], ["Owner admin hours", plan.admin]],
    statement: [["Revenue", revenue],
      ...Object.entries({ material: "Materials", packaging: "Packaging", machine: "Machine cost",
        labor: "Paid production labor", ownerLabor: "Imputed owner production labor" }).map(([id, label]) => [label, categories.get(id) ?? 0]),
      ["Production COGS", production], ["Gross profit", gross],
      ["Fees and seller-paid shipping", selling], ["Shared selling costs", plan.marketing],
      ["Contribution after selling costs", contribution], ["Overhead", plan.overhead], ["Imputed owner admin labor", adminCost],
      ["Operating profit", operating], ["Add back unpaid owner labor", unpaid],
      [`Savings (${percent.format(plan.savings / 10000)} of revenue)`, savings],
      [`Tax reserve (${percent.format(plan.reserve / 10000)} of positive operating profit)`, reserve], ["Planned cash remaining", cash]],
  };
}

function updatePlan() {
  const target = byId("plan-result");
  target.replaceChildren();
  try {
    const result = monthly(readPlan());
    for (const [heading, rows, format] of [
      ["Monthly statement", result.statement, formatMoney],
      ["Contribution by order type", result.contributions, formatMoney],
      ["Monthly hours", result.hours, value => value.toLocaleString(undefined, { maximumFractionDigits: 2 })],
    ]) {
      if (!rows.length) continue;
      const list = element("dl");
      for (const [label, value] of rows) {
        const row = element("div");
        row.append(element("dt", label), element("dd", format(value)));
        list.append(row);
      }
      target.append(element("h2", heading), list);
    }
  } catch (error) {
    target.append(element("p", error.message, "loss"));
  }
}

function loadPlan(input, id) {
  openPlan = id;
  for (const [key, value] of Object.entries({ "plan-name": input.name, overhead: input.overhead / 100,
    marketing: input.marketing / 100, admin: input.admin, "admin-rate": (input.adminRate ?? 0) / 100,
    savings: input.savings / 100, reserve: input.reserve / 100 })) {
    byId(key).value = value;
  }
  planOrders.replaceChildren();
  input.orders.forEach(addPlanOrder);
  updatePlan();
  showView("plan-view");
}

function validateBackup(data) {
  if (data?.version !== 1) throw new Error("Unsupported backup version.");
  for (const key of ["materials", "quotes", "plans"]) {
    if (!Array.isArray(data[key]) || data[key].some(item => !item || typeof item.id !== "string" || !item.id) ||
        new Set(data[key].map(item => item.id)).size !== data[key].length) throw new Error("Invalid backup records.");
  }
  data.materials.forEach(validateMaterial);
  const validateQuoteRecord = item => {
    if (typeof item?.product !== "string" || typeof item.channel !== "string" ||
        !Number.isSafeInteger(item.targetBasisPoints) || item.targetBasisPoints < 0 || item.targetBasisPoints >= 10000) {
      throw new Error("Invalid quote in backup.");
    }
    calculateQuote(item);
    if (item.recipe.some(line => !["material", "packaging", "machine", "labor", "ownerLabor"].includes(line.category))) {
      throw new Error("Invalid quote cost category.");
    }
  };
  data.quotes.forEach(item => validateQuoteRecord(item.input));
  data.plans.forEach(item => {
    monthly(item.input);
    item.input.orders.forEach(order => validateQuoteRecord(order.quote));
  });
  return data;
}

document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
materialForm.addEventListener("submit", safely(event => {
  event.preventDefault();
  if (pendingPhoto) return;
  const fields = materialForm.elements;
  const value = name => fields.namedItem(name).value.trim();
  const leather = value("type") === "leather";
  const previous = editingImport
    ? materialImports.find(material => material.id === editingImport)
    : workspace.materials.find(material => material.id === editingMaterial);
  const item = {
    id: previous?.id ?? crypto.randomUUID(),
    name: value("name"), type: value("type"), unit: value("unit"), cost: hundredths(fields.namedItem("cost")),
    purchase: normalizeDecimal(value("purchase")), stock: normalizeDecimal(value("stock")), link: value("link"),
    effectiveAt: new Date().toISOString(),
    ...(leather && value("weight") ? { weight: normalizeDecimal(value("weight")) } : {}),
    ...(leather && value("cut") ? { cut: value("cut") } : {}),
    ...(materialPhoto ? { photo: materialPhoto } : {}),
    ...(previous?.source ? { source: previous.source } : {}),
    ...(previous?.sources ? { sources: previous.sources } : {}),
  };
  for (const { key } of quantityFormats) {
    const format = value(`${key}Format`);
    if (!leather || format === "exact") continue;
    item[`${key}Upper`] = normalizeDecimal(value(`${key}Upper`));
    item[`${key}Plus`] = format === "rangePlus";
  }
  validateMaterial(item);
  if (editingImport) {
    materialImports = materialImports.map(material => material.id === item.id
      ? { ...item, skipped: material.skipped, destination: material.destination } : material);
    resetMaterialForm();
    renderMaterialImports();
    notify("Draft updated. Save the import when the selected materials are ready.");
    return;
  }
  persist({ ...workspace, materials: [...workspace.materials.filter(material => material.id !== item.id), item] }, "Material saved.");
  resetMaterialForm();
}));
byId("cancel-material").addEventListener("click", resetMaterialForm);
materialType.addEventListener("change", () => updateMaterialType(true));
for (const { key } of quantityFormats) {
  materialForm.elements.namedItem(`${key}Format`).addEventListener("change", () => updateMaterialType());
}
byId("remove-material-photo").addEventListener("click", () => resetPhoto());
photoInput.addEventListener("change", async () => {
  const file = photoInput.files[0];
  if (!file) return;
  const task = makeThumbnail(file);
  pendingPhoto = task;
  byId("material-submit").disabled = true;
  try {
    const photo = await task;
    if (pendingPhoto === task) showPhoto(photo);
  } catch (error) {
    if (pendingPhoto === task) {
      photoInput.value = "";
      notify(error.message);
    }
  } finally {
    if (pendingPhoto === task) {
      pendingPhoto = null;
      byId("material-submit").disabled = false;
    }
  }
});
pickMaterial.addEventListener("change", () => { byId("add-material").disabled = !pickMaterial.value; });
storedQuote.addEventListener("change", () => { byId("add-plan-order").disabled = !storedQuote.value; });
byId("add-material").addEventListener("click", () => {
  const item = workspace.materials.find(material => material.id === pickMaterial.value);
  if (item) {
    addRow(materialRow(item)).querySelector('[data-field="usage"]').focus();
    update();
  }
});
byId("refresh-rates").addEventListener("click", safely(() => {
  const input = readQuote();
  let updated = 0;
  let incompatible = 0;
  input.recipe = input.recipe.map(row => {
    const item = workspace.materials.find(material => material.id === row.material?.id);
    if (!item) return row;
    if (item.unit !== row.material.unit) {
      incompatible++;
      return row;
    }
    updated++;
    return materialRow(item, row);
  });
  loadQuote(input, openQuote);
  notify(`${updated} library rates refreshed.${incompatible ? " Re-add materials whose units changed to revise their usage." : ""}`);
}));
byId("solve-price").addEventListener("click", safely(() => {
  const input = readQuote();
  byId("price").value = (solvePrice(input, input.targetBasisPoints) / 100).toFixed(2);
  update();
}));
byId("save-quote").addEventListener("click", safely(() => saveQuote(false)));
byId("finalize-quote").addEventListener("click", safely(() => saveQuote(true)));
byId("quote-csv").addEventListener("click", safely(quoteCsv));
byId("export-backup").addEventListener("click", () =>
  download("dacha-craft-backup.json", "application/json", JSON.stringify(workspace, null, 2)));
byId("import-backup").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const incoming = validateBackup(JSON.parse(await file.text()));
    const next = { ...workspace };
    for (const key of ["materials", "quotes", "plans"]) {
      const existing = new Set(workspace[key].map(item => item.id));
      next[key] = [...workspace[key], ...incoming[key].filter(item => !existing.has(item.id))];
    }
    persist(next, "Backup imported. Existing records were kept for matching IDs.");
  } catch (error) {
    notify(`Backup could not be imported. ${error.message}`);
  } finally {
    event.target.value = "";
  }
});
byId("add-plan-order").addEventListener("click", () => {
  const item = workspace.quotes.find(quote => quote.id === storedQuote.value);
  if (item) {
    addPlanOrder({ quote: item.input, count: 1 });
    updatePlan();
  }
});
byId("new-plan").addEventListener("click", () =>
  loadPlan({ name: "Monthly plan", overhead: 0, marketing: 0, admin: 0, adminRate: 0, savings: 0, reserve: 0, orders: [] }, null));
planForm.addEventListener("input", updatePlan);
planForm.addEventListener("submit", safely(event => {
  event.preventDefault();
  const input = readPlan();
  monthly(input);
  const id = openPlan ?? crypto.randomUUID();
  persist({ ...workspace, plans: [...workspace.plans.filter(item => item.id !== id), { id, input, savedAt: new Date().toISOString() }] }, "Monthly plan saved.");
  openPlan = id;
}));
byId("plan-csv").addEventListener("click", safely(() => {
  const result = monthly(readPlan());
  download("dacha-craft-monthly-plan.csv", "text/csv", csv([
    ["Section", "Line", "Amount", "Unit"],
    ...result.statement.map(([label, value]) => ["Statement", label, value, "cents"]),
    ...result.contributions.map(([label, value]) => ["Order contribution", label, value, "cents"]),
    ...result.hours.map(([label, value]) => ["Hours", label, value, "hours"]),
    [],
    ["Product", "Channel", "Category", "Cost", "Orders", "Count per order", "Usage", "Rate cents", "Rate quantity", "Monthly cents"],
    ...result.productionDetail,
  ]));
}));
renderWorkspace();
updatePlan();
