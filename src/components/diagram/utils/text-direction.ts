// Script direction of a run of text, decided by its FIRST strong character (the Unicode bidi
// rule for a paragraph). Hebrew, Arabic, Syriac, Thaana, N'Ko, Persian/Urdu extensions and the
// Arabic/Hebrew presentation-form blocks are right-to-left; a line that opens with a Latin, Greek
// or Cyrillic letter is left-to-right; a line with no letters at all (numbers, punctuation) is
// treated as left-to-right.
const RTL_RANGE = '\\u0590-\\u08FF\\uFB1D-\\uFDFF\\uFE70-\\uFEFF';
const LTR_RANGE = 'A-Za-z\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF';
const STRONG = new RegExp(`[${LTR_RANGE}${RTL_RANGE}]`);
const RTL = new RegExp(`^[${RTL_RANGE}]$`);

export function isRtlText(s: string): boolean {
  const m = STRONG.exec(s);
  return !!m && RTL.test(m[0]);
}
