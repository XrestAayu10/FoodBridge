import assert from "node:assert/strict";
import { generatePickupCode, normalizePickupCode } from "../js/pickup-code.js";

assert.equal(normalizePickupCode("ahl-4821"), "AHL4821");
assert.equal(normalizePickupCode(" AHL 4821 "), "AHL4821");
assert.equal(normalizePickupCode("AHL–4821"), "AHL4821");
assert.notEqual(normalizePickupCode("AHL-4821"), normalizePickupCode("AHL-4822"));
assert.match(generatePickupCode(), /^AHL-\d{4}$/);

console.log("Pickup code regression checks passed.");
