// Nigerian mobile prefixes, without the leading 0. Anything outside this list is
// almost certainly a typo or a landline, neither of which can receive WhatsApp.
const NG_PREFIXES = new Set([
  '701', '702', '703', '704', '705', '706', '707', '708', '709',
  '802', '803', '804', '805', '806', '807', '808', '809',
  '810', '811', '812', '813', '814', '815', '816', '817', '818', '819',
  '901', '902', '903', '904', '905', '906', '907', '908', '909',
  '911', '912', '913', '915', '916', '917', '918'
]);

// Collapses 0803…, +234803…, 234803… and 00234803… to one canonical 234XXXXXXXXXX.
// Signup dedupe hangs off this: without it the same person registers three times
// in three formats and walks away with three codes.
export function normalizePhone(input) {
  let digits = String(input || '').replace(/\D/g, '');

  if (digits.startsWith('00234')) digits = digits.slice(2);
  if (digits.startsWith('234')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);

  if (digits.length !== 10) return null;
  if (!NG_PREFIXES.has(digits.slice(0, 3))) return null;

  return `234${digits}`;
}

export const formatPhone = (normalized) =>
  normalized && normalized.length === 13
    ? `+${normalized.slice(0, 3)} ${normalized.slice(3, 6)} ${normalized.slice(6, 9)} ${normalized.slice(9)}`
    : String(normalized || '');
