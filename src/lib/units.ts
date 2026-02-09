// ============================================================
// Unit Conversion Helpers — SI prefix parsing & formatting
// ============================================================

/**
 * SI prefixes from yocto (10⁻²⁴) to yotta (10²⁴).
 * Maps both ASCII and Unicode symbols (e.g. 'µ' and 'u' for micro).
 */
const SI_PREFIX_MAP: Record<string, number> = {
  y: 1e-24,  // yocto
  z: 1e-21,  // zepto
  a: 1e-18,  // atto
  f: 1e-15,  // femto
  p: 1e-12,  // pico
  n: 1e-9,   // nano
  µ: 1e-6,   // micro (Unicode)
  u: 1e-6,   // micro (ASCII alias)
  μ: 1e-6,   // micro (Greek mu U+03BC)
  m: 1e-3,   // milli
  // no prefix → 1
  k: 1e3,    // kilo
  K: 1e3,    // kilo (common uppercase variant)
  M: 1e6,    // mega
  G: 1e9,    // giga
  T: 1e12,   // tera
};

/** Ordered list for formatting — largest first */
const FORMAT_PREFIXES: { symbol: string; factor: number }[] = [
  { symbol: 'T', factor: 1e12 },
  { symbol: 'G', factor: 1e9 },
  { symbol: 'M', factor: 1e6 },
  { symbol: 'k', factor: 1e3 },
  { symbol: '', factor: 1 },
  { symbol: 'm', factor: 1e-3 },
  { symbol: 'µ', factor: 1e-6 },
  { symbol: 'n', factor: 1e-9 },
  { symbol: 'p', factor: 1e-12 },
  { symbol: 'f', factor: 1e-15 },
];

/** Known unit symbols that may appear at the end of a value string */
const UNIT_SYMBOLS = ['Ω', 'ohm', 'R', 'F', 'H', 'V', 'A', 'W', 'Hz', 'S'];

/** Unit aliases for display */
export const UNIT_LABELS: Record<string, string> = {
  resistance: 'Ω',
  capacitance: 'F',
  inductance: 'H',
  voltage: 'V',
  current: 'A',
  power: 'W',
  frequency: 'Hz',
};

/** Result of parsing a component value string */
export interface ParsedValue {
  /** Numeric value in base units (e.g. ohms, farads) */
  value: number;
  /** The SI prefix character found (empty string if none) */
  prefix: string;
  /** The unit string found (empty string if none) */
  unit: string;
  /** Original input string */
  raw: string;
}

/**
 * Parse an engineering/SI-prefixed value string into a numeric value.
 *
 * Handles formats like:
 *   "10k", "10kΩ", "10 kOhm", "4.7µF", "4u7", "100nH",
 *   "2.2M", "0.1", "47", "1R5" (= 1.5Ω), "4k7" (= 4.7k)
 *
 * Returns null if the string cannot be parsed.
 */
export function parseValue(input: string): ParsedValue | null {
  if (!input || typeof input !== 'string') return null;
  const raw = input;

  // Strip whitespace and normalise
  let s = input.trim();
  if (s.length === 0) return null;

  // Strip known unit suffixes (case-insensitive for ohm)
  let unit = '';
  for (const u of UNIT_SYMBOLS) {
    if (s.endsWith(u)) {
      unit = u;
      s = s.slice(0, -u.length).trim();
      break;
    }
    if (s.toLowerCase().endsWith(u.toLowerCase())) {
      unit = u;
      s = s.slice(0, -u.length).trim();
      break;
    }
  }

  // Handle shorthand notation like "4k7" → 4.7k, "1R5" → 1.5Ω, "2M2" → 2.2M
  // Pattern: <digits><prefix-or-R><digits>
  const shorthandRe = /^(\d+)([kKMGTpnuµμmRrFfHh])(\d+)$/;
  const shortMatch = s.match(shorthandRe);
  if (shortMatch) {
    const intPart = shortMatch[1];
    const letter = shortMatch[2];
    const fracPart = shortMatch[3];
    const numericStr = `${intPart}.${fracPart}`;
    const numVal = parseFloat(numericStr);
    if (isNaN(numVal)) return null;

    // 'R' is a special case — it means × 1 (ohms) with no prefix
    if (letter === 'R' || letter === 'r') {
      return { value: numVal, prefix: '', unit: unit || 'Ω', raw };
    }

    const factor = SI_PREFIX_MAP[letter];
    if (factor !== undefined) {
      return { value: numVal * factor, prefix: letter, unit, raw };
    }
    return null;
  }

  // Standard notation: <number><optional prefix>
  // Try to match a number followed by an optional SI prefix
  const stdRe = /^([+-]?\d+\.?\d*(?:[eE][+-]?\d+)?)\s*([yzafpnuµμmkKMGT]?)$/;
  const stdMatch = s.match(stdRe);
  if (stdMatch) {
    const numVal = parseFloat(stdMatch[1]);
    if (isNaN(numVal)) return null;
    const prefix = stdMatch[2] || '';
    const factor = prefix ? (SI_PREFIX_MAP[prefix] ?? 1) : 1;
    return { value: numVal * factor, prefix, unit, raw };
  }

  // Fallback: try to parse as a plain number
  const plainNum = parseFloat(s);
  if (!isNaN(plainNum)) {
    return { value: plainNum, prefix: '', unit, raw };
  }

  return null;
}

/**
 * Format a numeric value with the best SI prefix for readability.
 *
 * @param value   The value in base units (e.g. 4700 for 4.7kΩ)
 * @param unit    Optional unit suffix (e.g. 'Ω', 'F')
 * @param digits  Maximum significant decimal digits (default 3)
 */
export function formatValue(value: number, unit = '', digits = 3): string {
  if (value === 0) return `0${unit}`;
  if (!isFinite(value)) return String(value);

  const absVal = Math.abs(value);

  // Find the best prefix
  for (const { symbol, factor } of FORMAT_PREFIXES) {
    if (absVal >= factor * 0.9999) {
      const scaled = value / factor;
      // Round to requested digits
      const str = parseFloat(scaled.toPrecision(digits)).toString();
      return `${str}${symbol}${unit}`;
    }
  }

  // Very small — use femto
  const scaled = value / 1e-15;
  const str = parseFloat(scaled.toPrecision(digits)).toString();
  return `${str}f${unit}`;
}

/**
 * Convert a value from one SI-prefixed representation to base units.
 * Convenience wrapper around parseValue that returns just the number.
 */
export function toBaseUnits(input: string): number | null {
  const parsed = parseValue(input);
  return parsed ? parsed.value : null;
}

/**
 * Compare two value strings for engineering equivalence.
 * e.g. "4k7" === "4.7k" === "4700"
 */
export function valuesEqual(a: string, b: string): boolean {
  const pa = parseValue(a);
  const pb = parseValue(b);
  if (!pa || !pb) return false;
  // Use relative tolerance for floating-point comparison
  const diff = Math.abs(pa.value - pb.value);
  const max = Math.max(Math.abs(pa.value), Math.abs(pb.value));
  if (max === 0) return diff === 0;
  return diff / max < 1e-9;
}

/**
 * Get the component category's expected unit symbol.
 */
export function unitForCategory(category: string): string {
  switch (category) {
    case 'Resistors': return 'Ω';
    case 'Capacitors': return 'F';
    case 'Inductors': return 'H';
    case 'Diodes':
    case 'LEDs': return 'V';
    case 'Crystals': return 'Hz';
    default: return '';
  }
}

/**
 * Validate the range of a parsed value based on the component category.
 * Returns an error message (German) if the value is out of a reasonable range,
 * or null if it's OK.
 */
export function validateValueRange(value: number, category: string): string | null {
  switch (category) {
    case 'Resistors':
      if (value <= 0) return 'Widerstand muss positiv sein';
      if (value > 100e6) return 'Widerstand ungewöhnlich hoch (> 100 MΩ)';
      if (value < 0.01) return 'Widerstand ungewöhnlich niedrig (< 10 mΩ)';
      return null;
    case 'Capacitors':
      if (value <= 0) return 'Kapazität muss positiv sein';
      if (value > 1) return 'Kapazität ungewöhnlich hoch (> 1 F)';
      if (value < 1e-15) return 'Kapazität ungewöhnlich niedrig (< 1 fF)';
      return null;
    case 'Inductors':
      if (value <= 0) return 'Induktivität muss positiv sein';
      if (value > 10) return 'Induktivität ungewöhnlich hoch (> 10 H)';
      if (value < 1e-12) return 'Induktivität ungewöhnlich niedrig (< 1 pH)';
      return null;
    case 'Crystals':
      if (value <= 0) return 'Frequenz muss positiv sein';
      if (value > 200e6) return 'Frequenz ungewöhnlich hoch (> 200 MHz)';
      if (value < 1e3) return 'Frequenz ungewöhnlich niedrig (< 1 kHz)';
      return null;
    default:
      return null; // No range validation for other categories
  }
}

/**
 * Full validation of a component value string for a given category.
 * Returns { valid, normalized, warning? } or { valid: false, error }.
 */
export interface ValidationResult {
  valid: boolean;
  /** The normalized display string (e.g. "4.7kΩ") */
  normalized?: string;
  /** The numeric value in base units */
  numericValue?: number;
  /** Warning message (value is valid but unusual) */
  warning?: string;
  /** Error message (value is invalid) */
  error?: string;
}

export function validateComponentValue(value: string, category: string): ValidationResult {
  // Some categories use arbitrary text values (IC part numbers, etc.)
  const numericCategories = new Set(['Resistors', 'Capacitors', 'Inductors', 'Crystals']);
  if (!numericCategories.has(category)) {
    // Accept any non-empty string
    return value.trim().length > 0
      ? { valid: true, normalized: value.trim() }
      : { valid: false, error: 'Wert darf nicht leer sein' };
  }

  const parsed = parseValue(value);
  if (!parsed) {
    return {
      valid: false,
      error: `Ungültiger Wert: „${value}" — erwartet z.B. 10k, 4.7µF, 100nH`,
    };
  }

  const unit = unitForCategory(category);
  const normalized = formatValue(parsed.value, unit);

  const rangeWarning = validateValueRange(parsed.value, category);

  return {
    valid: true,
    normalized,
    numericValue: parsed.value,
    warning: rangeWarning ?? undefined,
  };
}
