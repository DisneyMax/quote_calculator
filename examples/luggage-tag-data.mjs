// Sample rates and yield for exercising the calculator.
export const luggageTag = {
  product: "Buttero luggage tag",
  quantity: 13,
  batch: { started: 12, sellable: 10 },
  priceCents: 1800,
  setupCents: 2000,
  discountCents: 0,
  shippingCents: 900,
  feeBasisPoints: 300,
  fixedFeeCents: 30,
  recipe: [
    { id: "leather", category: "material", label: "Buttero leather (sq ft)", scope: "startedUnit",
      usage: "0.12", rate: { cents: 4800, units: 12 } },
    { id: "hardware", category: "material", label: "Hardware (pieces)", scope: "sellableUnit",
      usage: 1, rate: { cents: 1400, units: 20 } },
    { id: "design", category: "labor", label: "Personalization setup (minutes)", scope: "order",
      usage: 20, rate: { cents: 2500, units: 60 } },
    { id: "engraving", category: "machine", label: "Engraving (minutes)", scope: "batch",
      usage: 10, rate: { cents: 500, units: 60 } },
    { id: "finishing", category: "labor", label: "Finishing (minutes)", scope: "sellableUnit",
      usage: 5, rate: { cents: 2500, units: 60 } },
  ],
};
