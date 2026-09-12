export function generatePickupCode() {
  const code = Math.floor(1000 + Math.random() * 9000);
  return `AHL-${code}`;
}

// Users may type AHL-1234, AHL 1234, or paste text containing invisible
// characters. Compare the meaningful letters and digits only.
export function normalizePickupCode(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

