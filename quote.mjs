// All booked money amounts are integer cents. Decimal usage stays exact
// until its cost line is booked, using half-up rounding.
function decimal(value, label) {
  const match = /^(\d+)(?:\.(\d{1,9}))?$/.exec(String(value));
  if (!match) throw new RangeError(`${label} must be a nonnegative decimal with up to nine decimal places`);
  const fraction = match[2] ?? "";
  return [BigInt(match[1] + fraction), 10n ** BigInt(fraction.length)];
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${label} must be a safe integer of at least ${minimum}`);
  }
  return BigInt(value);
}

function cents(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Amount exceeds the supported currency range");
  }
  return Number(value);
}

function round(numerator, denominator) {
  return (2n * numerator + denominator) / (2n * denominator);
}

export function calculateQuote({ quantity, batch, recipe, priceCents, setupCents = 0,
  discountCents = 0, shippingCents = 0, feeBasisPoints = 0, fixedFeeCents = 0 }) {
  const sellable = integer(quantity, "Quote quantity", 1);
  const expected = integer(batch.sellable, "Sellable units per run", 1);
  const started = integer(batch.started, "Started units per run", batch.sellable);
  const runs = (sellable + expected - 1n) / expected;
  const remainder = sellable % expected;
  let startedUnits = started * runs;
  if (remainder && batch.partialStarted != null) {
    const partial = integer(batch.partialStarted, "Started units in last run", Number(remainder));
    if (partial > started) throw new RangeError("Last run cannot start more units than a full run");
    startedUnits = started * (runs - 1n) + partial;
  }
  const price = integer(priceCents, "Selling price");
  const setup = integer(setupCents, "Setup charge");
  const discount = integer(discountCents, "Discount");
  const shipping = integer(shippingCents, "Seller-paid shipping");
  const feeRate = integer(feeBasisPoints, "Fee basis points");
  const fixedFee = integer(fixedFeeCents, "Fixed fee");
  if (feeRate > 10000n) throw new RangeError("Fee cannot exceed 100%");

  const ids = new Set();
  const lines = recipe.map(row => {
    if (!row.id || ids.has(row.id)) throw new RangeError("Recipe rows require unique IDs");
    ids.add(row.id);
    const counts = { order: 1n, batch: runs, sellableUnit: sellable, startedUnit: startedUnits };
    if (!Object.hasOwn(counts, row.scope)) throw new RangeError(`Unknown scope: ${row.scope}`);
    const count = counts[row.scope];
    const [usage, usageScale] = decimal(row.usage, "Usage");
    const [rateUnits, rateScale] = decimal(row.rate.units, "Rate quantity");
    if (rateUnits === 0n) throw new RangeError("Rate quantity must be positive");
    const rateCents = integer(row.rate.cents, "Rate cost");
    const amount = round(usage * count * rateCents * rateScale, usageScale * rateUnits);
    return { ...row, count: cents(count), amountCents: cents(amount),
      minutes: ["machine", "labor", "ownerLabor"].includes(row.category) ? Number(usage * count) / Number(usageScale) : 0 };
  });

  const production = lines.reduce((total, line) => total + BigInt(line.amountCents), 0n);
  const revenue = price * sellable + setup - discount;
  if (revenue < 0n) throw new RangeError("Discount exceeds the customer subtotal");
  const fee = round(revenue * feeRate, 10000n) + fixedFee;
  const profit = revenue - production - shipping - fee;
  return {
    runs: cents(runs),
    startedUnits: cents(startedUnits),
    lines,
    customerTotalCents: cents(revenue),
    productionCents: cents(production),
    shippingCents: cents(shipping),
    feeCents: cents(fee),
    profitCents: cents(profit),
    profitPerUnitCents: cents(profit) / quantity,
    actualMargin: revenue === 0n ? null : Number(profit) / Number(revenue),
  };
}

// Solve against the configured order-level fee and check the booked result.
export function solvePrice(quote, targetBasisPoints) {
  const target = integer(targetBasisPoints, "Target margin");
  const fee = integer(quote.feeBasisPoints, "Fee basis points");
  const denominator = 10000n - target - fee;
  if (denominator <= 0n) throw new RangeError("Target margin plus percentage fee must be below 100%");
  const costs = calculateQuote({ ...quote, priceCents: 0, setupCents: 0, discountCents: 0 });
  const fixed = BigInt(costs.productionCents) + BigInt(costs.shippingCents) + BigInt(costs.feeCents);
  const adjustment = BigInt(quote.setupCents) - BigInt(quote.discountCents);
  const quantity = BigInt(quote.quantity);
  // Allow for up to half a cent of percentage-fee rounding if needed.
  for (const allowance of [0n, fee ? 5000n : 0n]) {
    const requiredRevenue = (fixed * 10000n + allowance + denominator - 1n) / denominator;
    const requiredSales = (requiredRevenue < 1n ? 1n : requiredRevenue) - adjustment;
    const priceCents = cents(requiredSales > 0n ? (requiredSales + quantity - 1n) / quantity : 0n);
    const result = calculateQuote({ ...quote, priceCents });
    if (BigInt(result.profitCents) * 10000n >= BigInt(result.customerTotalCents) * target) return priceCents;
  }
  throw new RangeError("Unable to meet that margin target");
}
