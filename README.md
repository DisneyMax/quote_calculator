# Dacha Craft Business Calculator

The browser editor starts with a sample Buttero luggage-tag quote. Add materials in **Material library** and select them from **Library material** when building a quote. You can also enter a custom cost for machine time, labor, packaging, or a one-off material. **Load sample quote** resets the current editor.

From the repository, run this in PowerShell and open `http://localhost:8765/`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./serve.ps1
```

Use Ctrl+C to stop the server. The browser app has no package dependencies. To run the sample calculation directly with Node.js:

```text
node examples/luggage-tag.mjs
```

## Quote rules

- Rates express a purchase cost in cents and the usable quantity it buys. Match usage and rate units within each row. For hourly rates, enter the cents per hour as the cost and 60 minutes as the rate quantity.
- Order costs charge once. Run costs charge for each run, including the final partial run. Sellable-unit costs charge by the quoted quantity. Started-unit costs charge by the units started, honoring the optional partial-run override.
- Each recipe line and the percentage fee are rounded half-up to cents. Production cost sums booked lines. The percentage fee applies to the customer subtotal after the discount, including setup, and the fixed fee applies once.
- The example uses synthetic rates. The price solver supports the quote's percentage fee on net order revenue and its fixed fee. It verifies the target after fee and currency rounding.
- Quotes retain copied material rates. **Refresh library rates** updates the open draft when the usage units still match. Final snapshots preserve their original inputs.
- Use **Monthly plan** to combine saved quotes by order count and channel. Shared selling costs are entered as a monthly amount. Owner labor marked unpaid is included in profit and added back for planned cash.
- The library stores purchase cost, usable quantity, units, quantity on hand, and an optional supplier link. Stock is manually maintained. Estimating or saving a quote never consumes inventory.
- Material types prefill an editable unit. Leather defaults to square feet and supports an optional weight in ounces and cut size. Enter an exact area or a range such as 3–4+ sq ft for both purchased area and stock on hand. Quotes divide purchase cost by the lower purchase estimate. Changing the unit leaves the entered quantity numbers as-is.
- Attach a JPEG, PNG, or WebP photo up to 15 MB per material. The editor resizes photos to fit within 480 pixels before saving them with the material record. JSON backups include saved photos.
- Use **Duplicate material** to start a separate weight or color record from an existing material. The form copies its purchase details and photo, and starts stock on hand at zero.
- Under **Material library → Import materials**, select one or more text-based Rocky Mountain Leather Supply or BuckleGuy order-confirmation PDFs, CSV files, or JSON material lists. The PDF parser runs locally using the vendored PDF.js 5.6.205 build (Apache-2.0). Imported PDF line totals exclude order tax, shipping, and package protection. Order confirmations initialize stock to zero until receipt is confirmed. Missing leather areas must be entered in review or skipped.
- Preview the rows, use **Review or edit** and **Keep draft changes**, then save the selected materials together. The same supplier order line is skipped if it already exists. Review drafts remain on the current page until saved or discarded.
- BuckleGuy invoices include order dates and numbers, SKU, and item pricing. Matching materials can be updated or saved separately. An update keeps the existing inventory record and adds the entered receipt quantity. A second document for the same order can add invoice details without receiving its stock twice. Expand **Order history** on a material to see the source documents.
- The downloadable CSV template documents the bulk columns. JSON uses the same fields, as an array of rows or an object with a `materials` array. `purchase_cost` is a dollar amount. `purchase` and `stock` use the stated `unit`. Exact quantities and the lower estimates for ranges go in those columns. Additional formats can be registered in `material-import.mjs` and mapped to the same review drafts.
- Saves use browser storage for the local URL. Export a JSON backup to move records between browsers or ports. Import merges by record ID and preserves existing records. Quote and monthly CSV exports use integer cents and identify their units.
- Low-stock notifications, inventory movement history, automated deductions, and event forecasting are future features.
