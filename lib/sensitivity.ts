import { RULES_BY_FAMILY, typeFamily, type MaskRule } from '@/lib/plan';

/**
 * Name-based hint for columns that usually hold personal data. A heuristic only:
 * it suggests a default masking rule, the user decides.
 */
const HINTS: { pattern: RegExp; rule: MaskRule; label: string }[] = [
  { pattern: /e_?mail/i, rule: 'email', label: 'email' },
  { pattern: /(ssn|social_?sec|national_?id|passport|tax_?id|personnummer)/i, rule: 'hash', label: 'national ID' },
  { pattern: /(phone|mobile|cell|fax)/i, rule: 'partial', label: 'phone' },
  { pattern: /(card|iban|account_?n(o|um)|acct|bank)/i, rule: 'partial', label: 'financial' },
  { pattern: /(birth|dob)/i, rule: 'year', label: 'birth date' },
  { pattern: /(first_?name|last_?name|full_?name|surname|given_?name|^name$|customer_?name|contact_?name)/i, rule: 'hash', label: 'name' },
  { pattern: /(address|street|zip|postal|postcode)/i, rule: 'redact', label: 'address' },
  { pattern: /(ip_?addr|^ip$|device_?id|mac_?addr)/i, rule: 'hash', label: 'device' },
  { pattern: /(salary|income|wage)/i, rule: 'round', label: 'compensation' },
  { pattern: /(password|secret|token)/i, rule: 'null', label: 'credential' },
];

export interface Hint {
  rule: MaskRule;
  label: string;
}

export function sensitivityHint(name: string, dataType: string): Hint | null {
  const allowed = RULES_BY_FAMILY[typeFamily(dataType)];
  for (const h of HINTS) {
    if (!h.pattern.test(name)) continue;
    const rule = allowed.includes(h.rule) ? h.rule : allowed.includes('hash') ? 'hash' : 'null';
    return { rule, label: h.label };
  }
  return null;
}
