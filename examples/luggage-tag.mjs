import { calculateQuote } from "../quote.mjs";
import { luggageTag } from "./luggage-tag-data.mjs";

console.log(JSON.stringify(calculateQuote(luggageTag), null, 2));
