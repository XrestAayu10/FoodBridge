import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const browse = await readFile(new URL("../org/browse.html", import.meta.url), "utf8");
const detail = await readFile(new URL("../org/listing-detail.html", import.meta.url), "utf8");

assert.match(browse, /listing-detail\.html\?id=\$\{encodeURIComponent\(listing\.id\)\}/);
assert.match(browse, /sessionStorage\.setItem\("foodbridge-selected-listing-id"/);
assert.match(detail, /queryListingId \|\| sessionStorage\.getItem\("foodbridge-selected-listing-id"\)/);
assert.match(detail, /history\.replaceState/);

console.log("Listing detail route regression checks passed.");
