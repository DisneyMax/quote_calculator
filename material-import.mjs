const money = /\$\s*(\d[\d,]*\.\d{2})/;
const materialTypes = ["other", "leather", "thread", "filament", "hardware", "sheet", "packaging"];
const maxRows = 500;
const asString = value => String(value ?? "").trim();

function costInCents(value) {
  const match = /^\$?(\d+)(?:\.(\d{1,2}))?$/.exec(asString(value).replaceAll(",", ""));
  if (!match) return null;
  const cost = Number(match[1] + (match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cost) ? cost : null;
}

function describeOrderLine(line) {
  const description = [line.title, ...line.details].join(" ");
  const shade = line.details.find(text => text.includes(" / "))?.split(" / ")[0];
  const name = [line.title, shade].filter(Boolean).join(" · ");
  const { count } = line;
  const data = { name, type: "other", unit: "pieces", purchase: String(count), stock: "0",
    cost: line.cost, link: "", source: { ...line.source, sku: line.sku, orderQuantity: count, description } };

  if (/\b(?:thread|spools?)\b/i.test(line.title)) {
    data.type = "thread";
    const length = /(\d+(?:\.\d+)?)\s*(meters?|metres?|yards?)\b/i.exec(description);
    data.unit = /^yard/i.test(length?.[2] ?? "") ? "yards" : "meters";
    data.purchase = length ? String(Number(length[1]) * count) : "";
  } else if (/\b(?:buckle|rivets?|burrs|snaps|hardware)\b/i.test(line.title)) {
    data.type = "hardware";
    const pack = /(\d+)\s*[- ]\s*pack\b/i.exec(description);
    if (pack) data.purchase = String(Number(pack[1]) * count);
  } else if (/\b(?:leather|buttero|hides?)\b/i.test(line.title) && !/\bswatches\b/i.test(line.title)) {
    data.type = "leather";
    const weight = /Custom Splitting:.*?\((\d+(?:\.\d+)?)\s*oz\)/i.exec(description) ??
      /Weight\/Thickness:\s*(\d+(?:\.\d+)?)(?:\s*[/–-]\s*\d+(?:\.\d+)?)?\s*oz/i.exec(description) ??
      line.details.map(value => /\b(\d+(?:\.\d+)?)\s*oz\b/i.exec(value)).find(Boolean) ??
      /\b(\d+(?:\.\d+)?)\s*oz(?!\s*&)/i.exec(line.title);
    if (weight && Number(weight[1]) >= 1 && Number(weight[1]) <= 16 && Number(weight[1]) * 2 % 1 === 0) data.weight = weight[1];
    const cut = /\b(?:(?:[1-9]\/\d+\s+hide|belly)\b|\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?")/i.exec(description);
    if (cut) data.cut = cut[0];
    if (/\bstraps?\b/i.test(line.title)) {
      data.cut = line.details.find(value => /\bstrap\b/i.test(value))?.split(" / ").at(-1) ?? "Strap";
    } else {
      data.unit = "sq ft";
      const area = /(\d+(?:\.\d+)?)\s*(?:[-–]\s*(\d+(?:\.\d+)?)\s*(\+)?)?\s*(?:sq\.?\s*ft\.?|square feet)\b/i.exec(description);
      data.purchase = area ? String(Number(area[1]) * count) : "";
      if (area?.[2]) {
        data.purchaseUpper = String(Number(area[2]) * count);
        data.purchasePlus = Boolean(area[3]);
      }
    }
  } else if (/\bswatches\b/i.test(line.title)) {
    data.unit = "sets";
  }
  return data;
}

function lineDetails(text) {
  return /\s\/\s|^Custom Splitting:|^__|^#\d|^[A-Z0-9-]{3,12}$/i.test(text);
}

function rockyOrder(lines, source) {
  const result = [];
  let title = [];
  let current;
  for (const line of lines) {
    if (/^(?:subtotal|customer information|shipping|total paid)\b/i.test(line)) break;
    const amount = money.exec(line);
    const cleaned = line.replace(money, "").trim();
    const quantity = /^(.*?)\s*[×x]\s*(\d+)\s*$/i.exec(cleaned);
    if (quantity) {
      const name = [...title, quantity[1]].filter(Boolean).join(" ");
      title = [];
      current = { title: name, count: Number(quantity[2]), cost: amount ? costInCents(amount[1]) : null, details: [], source };
      if (name && !/package protection|shipping protection/i.test(name)) result.push(current);
    } else if (current && (!cleaned || lineDetails(cleaned))) {
      if (amount && current.cost === null) current.cost = costInCents(amount[1]);
      if (cleaned && !cleaned.startsWith("__")) current.details.push(cleaned);
    } else if (cleaned) {
      title.push(cleaned);
    }
  }
  return result;
}

function buckleOrder(lines, source) {
  const result = [];
  let title = [];
  for (const line of lines) {
    if (/^(?:tax|shipping|subtotal|total)\s*:/i.test(line)) break;
    const quantity = /^(.*?)\bQuantity:\s*(\d+)/i.exec(line);
    if (!quantity) {
      title.push(line);
      continue;
    }
    const amount = money.exec(line);
    if (quantity[1].trim()) title.push(quantity[1].trim());
    if (title.length) result.push({ title: title.join(" "), count: Number(quantity[2]),
      cost: amount ? costInCents(amount[1]) : null, details: [], source });
    title = [];
  }
  return result;
}

function buckleInvoice(lines, source) {
  const result = [];
  let current;
  for (const line of lines) {
    if (/^(?:subtotal|shipping|sales tax|grand total)\b/i.test(line)) break;
    if (/^Qty\s+Code\/SKU\b/i.test(line)) continue;
    const start = /^(\d+)\s+(\S+)\s+(.+?)\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})$/.exec(line);
    if (start) {
      current = { count: Number(start[1]), sku: start[2], title: start[3], unitCost: costInCents(start[4]),
        cost: costInCents(start[5]), details: [], source };
      result.push(current);
      continue;
    }
    if (!current) continue;
    const continuation = /^([A-Z0-9][A-Z0-9/-]*)(?:\s+(.*))?$/.exec(line);
    if (!current.details.length && continuation && (current.sku.endsWith("-") || continuation[1] === "LL")) {
      current.sku += continuation[1];
      if (continuation[2]) current.title += " " + continuation[2];
    } else if (!current.details.length && !/^[\w/ ]+:/.test(line)) {
      current.title += " " + line;
    } else {
      current.details.push(line);
    }
  }
  return result;
}

export function parseOrderText(lines) {
  const header = lines.join("\n");
  const rocky = /\b(?:Rocky Mountain Leather Supply|ORDER\s+RM\d)/i.test(header);
  const buckle = /\bBuckleGuy\b/i.test(header);
  const invoice = buckle && /\binvoice for order\b|\bOrder Date:\s*\d/i.test(header);
  const start = lines.findIndex(line => rocky ? /^Order summary$/i.test(line) :
    invoice ? /^Order Items$/i.test(line) : /^Order Details:?$/i.test(line));
  if ((!rocky && !buckle) || start < 0) {
    throw new Error("Unrecognized PDF layout. Use a Rocky Mountain Leather Supply or BuckleGuy confirmation, a BuckleGuy invoice, or CSV or JSON.");
  }
  const order = (rocky ? /\bORDER\s+(RM[\w-]+)/i :
    invoice ? /\bOrder:\s*#?([\w-]+)/i : /\border ID is\s*([\w-]+)/i).exec(header)?.[1] ?? "";
  const numericDate = /\bOrder Date:\s*(\d{1,2})[\s/-]+(\d{1,2})[\s/-]+(\d{4}|\d{2})\b/i.exec(header);
  const date = numericDate
    ? `${numericDate[3].length === 2 ? "20" + numericDate[3] : numericDate[3]}-${numericDate[1].padStart(2, "0")}-${numericDate[2].padStart(2, "0")}`
    : /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*([A-Za-z]{3}\s+\d{1,2},\s+\d{4})\b/i.exec(header)?.[1] ?? "";
  const source = { vendor: rocky ? "Rocky Mountain Leather Supply" : "BuckleGuy", order, date,
    document: invoice ? "Invoice" : "Confirmation" };
  const linesToParse = lines.slice(start + 1);
  const items = (rocky ? rockyOrder : invoice ? buckleInvoice : buckleOrder)(linesToParse, source).map((line, index) =>
    describeOrderLine({ ...line, source: { ...source, line: index + 1, title: line.title, unitCost: line.unitCost } }));
  if (!items.length) throw new Error("No order items could be read from this PDF.");
  return items;
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[index + 1] === '"') { cell += '"'; index++; }
      else { quoted = false; closed = true; }
    } else if (char === "," || char === "\r" || char === "\n") {
      row.push(cell);
      cell = "";
      closed = false;
      if (char === ",") continue;
      if (char === "\r" && text[index + 1] === "\n") index++;
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else if (char === '"' && !cell && !closed) {
      quoted = true;
    } else {
      if (closed || char === '"') throw new Error("Invalid CSV quoting.");
      cell += char;
    }
  }
  if (quoted) throw new Error("CSV ends inside a quoted field.");
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

export function parseMaterialTable(records) {
  if (!Array.isArray(records) || !records.length) throw new Error("No materials found.");
  if (records.length > maxRows) throw new Error(`Import up to ${maxRows} material rows at once.`);
  return records.map(record => {
    if (!record || typeof record !== "object" || !asString(record.name)) throw new Error("Each material row needs a name.");
    const type = asString(record.type).toLowerCase();
    const unit = asString(record.unit);
    const purchase = asString(record.purchase);
    const stock = asString(record.stock) || "0";
    const data = { name: asString(record.name), type: materialTypes.includes(type) ? type : "other",
      unit, purchase, stock, cost: costInCents(record.purchase_cost), link: asString(record.link),
      source: { description: [asString(record.description), type && !materialTypes.includes(type) ? `Imported type: ${type}` : ""].filter(Boolean).join(" · ") } };
    for (const key of ["weight", "cut", "purchaseUpper", "stockUpper"]) {
      if (asString(record[key])) data[key] = asString(record[key]);
    }
    for (const key of ["purchasePlus", "stockPlus"]) {
      if (asString(record[key])) data[key] = /^(?:true|yes|1)$/i.test(asString(record[key]));
    }
    return data;
  });
}

function importCsv(text) {
  const [columns, ...data] = csvRows(text.replace(/^\uFEFF/, ""));
  const keys = columns?.map(value => value.trim()) ?? [];
  if (!keys.includes("name") || new Set(keys).size !== keys.length) throw new Error("CSV must include a name header and unique column names.");
  if (data.some(row => row.length !== keys.length)) throw new Error("CSV rows must have the same number of columns as the header.");
  return parseMaterialTable(data.map(row => Object.fromEntries(keys.map((key, index) => [key, row[index]]))));
}

const adapters = {
  csv: async file => importCsv(await file.text()),
  json: async file => {
    const input = JSON.parse(await file.text());
    return parseMaterialTable(Array.isArray(input) ? input : input?.materials);
  },
  pdf: async file => {
    const { readPdfLines } = await import("./pdf-order-text.mjs");
    return parseOrderText(await readPdfLines(new Uint8Array(await file.arrayBuffer())));
  },
};

export async function readMaterialImport(file) {
  const extension = /\.(pdf|csv|json)$/i.exec(file.name)?.[1].toLowerCase();
  if (!extension) throw new Error("Choose a PDF, CSV, or JSON file.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose a file under 20 MB.");
  const items = await adapters[extension](file);
  if (items.length > maxRows) throw new Error(`Import up to ${maxRows} material rows at once.`);
  return items;
}

export function materialSources(item) {
  return item.sources?.length ? item.sources : item.source ? [item.source] : [];
}

function identity(text) {
  return asString(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function sameOrder(first, second) {
  return Boolean(first?.vendor && first?.order && first.vendor === second?.vendor && first.order === second?.order);
}

export function importDocumentKey(source, name) {
  return source?.vendor && source?.order
    ? JSON.stringify([source.vendor, source.order, source.document ?? "Confirmation",
      identity(source.description || source.title || name), identity(source.sku)])
    : "";
}

function unitIdentity(unit) {
  const key = identity(asString(unit).replaceAll("²", "2"));
  if (["sqft", "squarefeet", "squarefoot", "ft2"].includes(key)) return "sqft";
  if (["m", "meter", "meters", "metre", "metres", "metere", "meteres"].includes(key)) return "meters";
  if (["yd", "yds", "yard", "yards"].includes(key)) return "yards";
  if (["pc", "pcs", "piece", "pieces", "ea", "each"].includes(key)) return "pieces";
  return key;
}

function compatibleType(existing, incoming) {
  const current = existing.type ?? "other";
  const imported = incoming.type ?? "other";
  return current === imported || current === "other" || imported === "other";
}

function nameWords(name) {
  return new Set(asString(name).normalize("NFKC").toLowerCase()
    .replace(/(\d)(oz|mm|cm|meter|yard)/g, "$1 $2")
    .match(/[\p{L}\d]+/gu) ?? []);
}

function similarNames(existing, incoming) {
  if (identity(existing.name) === identity(incoming.name)) return true;
  const left = nameWords(existing.name);
  const right = nameWords(incoming.name);
  const [shorter, longer] = left.size <= right.size ? [left, right] : [right, left];
  // Short shop names often omit the supplier, size or marketing description.
  return shorter.size >= 2 && [...shorter].every(word => longer.has(word));
}

export function matchesImport(existing, incoming) {
  const origins = materialSources(existing);
  const source = incoming.source;
  const comparable = origins.filter(origin => source?.vendor && origin.vendor === source.vendor && origin.sku && source.sku);
  if (comparable.length) return comparable.some(origin => identity(origin.sku) === identity(source.sku));
  if (!similarNames(existing, incoming)) return false;
  if (identity(existing.name) === identity(incoming.name) && origins.some(origin => sameOrder(origin, source))) return true;
  return unitIdentity(existing.unit) === unitIdentity(incoming.unit) && compatibleType(existing, incoming) &&
    (!existing.weight || !incoming.weight || Number(existing.weight) === Number(incoming.weight));
}

function addQuantity(first, second) {
  const scaled = value => {
    const [whole, decimals = ""] = String(value).split(".");
    return BigInt(whole + decimals.padEnd(6, "0"));
  };
  const total = scaled(first) + scaled(second);
  const decimal = String(total % 1000000n).padStart(6, "0").replace(/0+$/, "");
  return String(total / 1000000n) + (decimal ? "." + decimal : "");
}

export function applyImportedMaterial(existing, incoming) {
  if (unitIdentity(existing.unit) !== unitIdentity(incoming.unit)) {
    throw new Error(`The saved material uses “${existing.unit}” and the import uses “${incoming.unit}”. In Review or edit, use the saved unit and convert the quantities before updating.`);
  }
  if (!compatibleType(existing, incoming)) {
    throw new Error(`The saved material type is “${existing.type}” and the imported type is “${incoming.type}”. Check the material type in Review or edit.`);
  }
  const history = materialSources(existing);
  const previouslyRecorded = history.some(source => sameOrder(source, incoming.source));
  if (previouslyRecorded && (Number(incoming.stock) > 0 || incoming.stockUpper)) {
    throw new Error("This order is already recorded for this material. Use zero stock for the import and adjust stock separately if needed.");
  }
  const merged = { ...existing, type: (existing.type ?? "other") === "other" ? incoming.type ?? "other" : existing.type,
    cost: incoming.cost, purchase: incoming.purchase, effectiveAt: incoming.effectiveAt,
    stock: addQuantity(existing.stock, incoming.stock), source: incoming.source, sources: [...history, incoming.source],
    link: incoming.link || existing.link };
  for (const key of ["purchaseUpper", "purchasePlus"]) {
    if (incoming[key] == null) delete merged[key];
    else merged[key] = incoming[key];
  }
  for (const key of ["weight", "cut", "photo"]) {
    if (incoming[key]) merged[key] = incoming[key];
  }
  if (existing.stockUpper || incoming.stockUpper) {
    merged.stockUpper = addQuantity(existing.stockUpper ?? existing.stock, incoming.stockUpper ?? incoming.stock);
    merged.stockPlus = Boolean(existing.stockPlus || incoming.stockPlus);
  }
  return merged;
}
