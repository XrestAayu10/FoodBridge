import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const repair = await readFile(new URL("../supabase/fix-rls-recursion.sql", import.meta.url), "utf8");

assert.match(schema, /public\.listing_has_org_request\(food_listings\.id\)/);
assert.match(schema, /public\.listing_supplier_is_me\(pickup_requests\.listing_id\)/);
assert.doesNotMatch(
  schema,
  /where pr\.listing_id = food_listings\.id and o\.user_id = auth\.uid\(\)/,
  "food_listings policy must not directly query pickup_requests"
);
assert.match(repair, /begin;[\s\S]*commit;/);
assert.match(repair, /grant execute on function public\.listing_has_org_request\(uuid\) to authenticated/);
assert.match(repair, /with check \(/);

console.log("RLS regression checks passed: recursive policies are replaced by helper functions.");
