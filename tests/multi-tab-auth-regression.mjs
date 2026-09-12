import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const client = await readFile(new URL("../js/supabase-client.js", import.meta.url), "utf8");
const auth = await readFile(new URL("../js/auth.js", import.meta.url), "utf8");

assert.match(client, /storage:\s*sessionStorage/);
assert.match(client, /storageKey:\s*authStorageKey/);
assert.match(client, /crypto\.randomUUID\(\)/);
assert.match(client, /AUTH_TAB_ID_KEY/);
assert.doesNotMatch(auth, /localStorage\./);
assert.match(auth, /sessionStorage\.setItem\(PENDING_PROFILE_KEY/);

console.log("Multi-tab authentication regression checks passed.");
