// Reading lab results out of a report's text (lab extranet, change request 20 Nov 2026). Runs in the lab doctor's
// browser on text from pdf.js (PDFs with text) or Tesseract OCR (photos and scans); also imported by the tests.
// It finds lines that name a test the clinic knows (src/lib/lab-tests.json plus common abbreviations and the blood count
// parameters) and takes the value, unit and normal range from the same line. Lines with a value, unit and range but
// an unknown test name are kept too (marked unmatched). The lab doctor checks and corrects every row before saving.

// Other names labs print for the clinic's tests, by lab-tests.json key.
const SYNONYMS = {
  'liver.alt_gpt': ['ALT', 'SGPT', 'GPT', 'ALT/GPT', 'ALAT'],
  'liver.ast_got': ['AST', 'SGOT', 'GOT', 'AST/GOT', 'ASAT'],
  'liver.bilirubin_total': ['Total bilirubin', 'Bilirubin total', 'T. Bilirubin', 'T.Bil', 'TBIL', 'T-BIL'],
  'liver.bilirubin_direct': ['Direct bilirubin', 'Bilirubin direct', 'D. Bilirubin', 'D.Bil', 'DBIL', 'D-BIL'],
  'liver.alkaline_phosphatase': ['ALP', 'ALKP', 'Alk. phosphatase', 'Alk phos'],
  'liver.total_protein': ['TP', 'T. Protein', 'Protein total', 'TPRO'],
  'liver.albumin': ['ALB', 'Albumin serum'],
  'liver.globulin': ['GLOB', 'GLO'],
  'liver.a_g_ratio': ['A/G', 'Alb/Glob', 'ALB/GLOB'],
  'liver.ggt': ['Gamma GT', 'GGTP', 'γGT'],
  'kidney.urea_bun': ['Urea', 'BUN', 'Blood urea nitrogen', 'Blood urea'],
  'kidney.creatinine': ['CREA', 'CREAT', 'CRE', 'Creatinine serum'],
  'kidney.bun_creatinine_ratio': ['BUN/CREA', 'BUN/Creatinine', 'Urea/Creatinine'],
  'kidney.uric_acid': ['UA', 'Uric acid'],
  'lipid.cholesterol': ['CHOL', 'Total cholesterol'],
  'lipid.triglycerides': ['TG', 'TRIG', 'Triglyceride'],
  'heart.cpk_total': ['CK', 'CPK', 'Creatine kinase'],
  'minerals.calcium_total': ['Calcium', 'Ca', 'Total calcium', 'CA++'],
  'minerals.calcium_ionized': ['Ionized calcium', 'iCa', 'Ca ionized'],
  'minerals.phosphorus': ['PHOS', 'Inorganic phosphorus', 'Phosphate', 'P'],
  'minerals.potassium': ['K', 'K+'],
  'minerals.sodium': ['Na', 'Na+'],
  'minerals.chloride': ['Cl', 'Cl-'],
  'minerals.magnesium': ['Mg'],
  'minerals.iron': ['Fe', 'Serum iron'],
  'minerals.amylase': ['AMY', 'AMYL'],
  'minerals.lipase': ['LIPA', 'LIP'],
  'hormones.t4': ['TT4', 'Total T4', 'Thyroxine'],
  'hormones.ft4': ['Free T4', 'fT4'],
  'bloodSugar.glucose_rbs': ['Glucose', 'GLU', 'Blood glucose', 'Random blood sugar', 'RBS'],
  'bloodSugar.glucose_fbs': ['FBS', 'Fasting blood sugar', 'Fasting glucose'],
  'haematology.hb': ['Hb', 'HGB', 'Haemoglobin', 'Hemoglobin'],
};
// Blood count parameters (the clinic's sheet has "CBC" as one test): shown under these names.
const CBC = [
  ['WBC', ['WBC', 'WBCs', 'White blood cells', 'Leukocytes', 'TLC', 'Total leucocytic count']],
  ['RBC', ['RBC', 'RBCs', 'Red blood cells', 'Erythrocytes']],
  ['HCT', ['HCT', 'PCV', 'Haematocrit', 'Hematocrit']],
  ['MCV', ['MCV']], ['MCH', ['MCH']], ['MCHC', ['MCHC']], ['RDW', ['RDW', 'RDW-CV']],
  ['PLT', ['PLT', 'Platelets', 'Platelet count', 'Thrombocytes']], ['MPV', ['MPV']],
  ['Neutrophils', ['Neutrophils', 'NEU', 'NEUT', 'Segmented neutrophils', 'Segs']], ['Band neutrophils', ['Bands', 'Band neutrophils', 'Band cells']],
  ['Lymphocytes', ['Lymphocytes', 'LYM', 'LYMPH']], ['Monocytes', ['Monocytes', 'MONO', 'MON']],
  ['Eosinophils', ['Eosinophils', 'EOS']], ['Basophils', ['Basophils', 'BASO', 'BAS']], ['Reticulocytes', ['Reticulocytes', 'RETIC', 'RET']],
];
// Words on a line that is not a result (header, patient details, page footer).
const NOT_A_RESULT = /\b(date|time|age|tel|phone|mobile|page|patient|owner|client|doctor|dr\.|sample|specimen|collected|received|reported|printed|ref\.?\s*no|lab\s*no|id\b|weight|species|breed|sex|address|signature|e-?mail|www|http)/i;
const QUALITATIVE = /^(neg(ative)?|pos(itive)?|non[- ]?reactive|reactive|not detected|detected|nil|absent|present|normal|trace|\+{1,4})$/i;
const UNIT = /^(?:(?:x\s*)?10\^?\s*\d+\s*\/\s*[uµμ]?l|[kKmM]\/[uµμ]l|%|fl|fL|pg|g\/dl|g\/l|mg\/dl|mg\/l|µ?mol\/l|umol\/l|μmol\/l|mmol\/l|n?mol\/l|meq\/l|m?iu\/m?l|u\/l|iu\/l|ng\/ml|ng\/dl|pg\/ml|µg\/dl|ug\/dl|μg\/dl|µiu\/ml|uiu\/ml|cells\/[uµμ]l|\/[uµμ]l|\/hpf|\/lpf|mm\/hr?|sec|s|ratio|g%|mg%|[a-zµμ]{1,4}\/[a-zµμ]{1,3})$/i;
const FLAG = /^(h|l|hi|lo|high|low|\*|↑|↓|abnormal|critical)$/i;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NUM = '[<>≤≥]?\\s*-?\\d+(?:[.,]\\d+)?';

/** The names to look for: one entry per test, with every alias. */
export function buildCatalogue(labTests) {
  const out = [];
  for (const g of labTests.groups ?? []) {
    for (const t of g.tests) {
      if (t.key === 'haematology.cbc' || t.key === 'haematology.wbcs_total_diff') continue; // the parameters below instead
      const aliases = new Set([t.label]);
      const bare = t.label.replace(/\s*\(.*?\)\s*/g, ' ').trim();
      if (bare) aliases.add(bare);
      for (const m of t.label.matchAll(/\(([^)]+)\)/g)) if (/[A-Za-z]{2,}/.test(m[1]) && !/^(total|direct|qualitative|quantitative|f|t)$/i.test(m[1])) aliases.add(m[1]);
      for (const s of SYNONYMS[t.key] ?? []) aliases.add(s);
      out.push({ key: t.key, group: g.key, name: t.label, aliases: [...aliases] });
    }
  }
  for (const [name, aliases] of CBC) out.push({ key: null, group: 'haematology', name, aliases });
  // Longest alias first, so "Direct bilirubin" wins over "Bilirubin" and "MCHC" over "MCH".
  const all = out.flatMap((e) => e.aliases.map((a) => ({ entry: e, alias: a })));
  all.sort((x, y) => y.alias.length - x.alias.length);
  return all.map(({ entry, alias }) => ({
    entry,
    alias,
    // Short codes (Na, K, P, Ca, TP…) only in their exact letters and at the start of the line, to avoid false hits.
    re: alias.replace(/[^A-Za-z]/g, '').length <= 2
      ? new RegExp(`^\\s*${escape(alias)}(?![A-Za-z])`)
      : new RegExp(`(?:^|[^A-Za-z])${escape(alias)}(?![A-Za-z])`, 'i'),
  }));
}

function toNumber(s) {
  const t = s.replace(/\s+/g, '').replace(/^[<>≤≥]/, '');
  // "1,234" is a thousands separator; "1,5" a decimal comma.
  const n = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  return Number(n);
}

/** Value, unit and range from the text after the test's name. */
function readValues(rest) {
  // "0-48" is a range, not 0 and minus 48.
  const s = rest.replace(/[–—−]/g, '-').replace(/(\d)\s*-\s*(?=\d)/g, '$1 - ').replace(/\s+/g, ' ').trim();
  const nums = [...s.matchAll(new RegExp(NUM, 'g'))].map((m) => ({ text: m[0], at: m.index, end: m.index + m[0].length }));
  // A range is "a - b" or "a to b" (also "(a-b)").
  let range = null;
  for (let i = 0; i < nums.length - 1; i++) {
    const between = s.slice(nums[i].end, nums[i + 1].at);
    if (/^\s*(-|to)\s*$/i.test(between) && !/^[<>≤≥]/.test(nums[i].text)) {
      range = { lo: toNumber(nums[i].text), hi: toNumber(nums[i + 1].text), from: i, to: i + 1 };
      break;
    }
  }
  const inRange = (i) => range && (i === range.from || i === range.to);
  const vi = nums.findIndex((_, i) => !inRange(i));
  // "Up to 40" / "< 40" after the value: only an upper limit.
  if (!range) {
    const up = /(?:up\s*to|<|≤|less than)\s*(\d+(?:[.,]\d+)?)/i.exec(s.slice(vi >= 0 ? nums[vi].end : 0));
    if (up) range = { lo: null, hi: toNumber(up[1]) };
  }
  let value = null;
  let valueText = null;
  let after = '';
  if (vi >= 0) {
    const v = nums[vi];
    if (/^[<>≤≥]/.test(v.text)) valueText = v.text.replace(/\s+/g, '');
    else value = toNumber(v.text);
    after = s.slice(v.end);
  } else {
    const q = s.split(/\s+/).find((w) => QUALITATIVE.test(w.replace(/[(),.:]/g, '')));
    if (q) {
      valueText = q.replace(/[(),.:]/g, '');
      after = s.slice(s.indexOf(q) + q.length);
    }
  }
  let unit = null;
  for (const w of after.trim().split(/\s+/).slice(0, 3)) {
    const t = w.replace(/^[([]|[)\],;:]$/g, '');
    if (!t || FLAG.test(t)) continue;
    if (UNIT.test(t)) {
      unit = t.replace(/^ul$/i, 'µL').replace(/\/ul$/i, '/µL').replace(/umol/i, 'µmol').replace(/ug\//i, 'µg/');
      break;
    }
    if (/^\d/.test(t)) break;
  }
  return { value, valueText, unit, refLow: range?.lo ?? null, refHigh: range?.hi ?? null };
}

/**
 * Rows read from the text: { key, group, analyte, value, value_text, unit, ref_low, ref_high, matched, line }.
 * `catalogue` comes from buildCatalogue().
 */
export function parseLabText(text, catalogue) {
  const rows = [];
  const seen = new Set();
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.replace(/\t/g, ' ').replace(/\s{2,}/g, '  ').trim()).filter(Boolean);
  for (const line of lines) {
    if (line.length > 160) continue;
    let hit = null;
    for (const c of catalogue) {
      const m = c.re.exec(line);
      if (m && (!hit || m.index < hit.at)) hit = { c, at: m.index, end: m.index + m[0].length };
    }
    if (hit) {
      const { value, valueText, unit, refLow, refHigh } = readValues(line.slice(hit.end));
      if (value == null && !valueText) continue;
      const e = hit.c.entry;
      const id = e.key ?? e.name;
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({ key: e.key, group: e.group, analyte: e.name, value, value_text: valueText, unit, ref_low: refLow, ref_high: refHigh, matched: true, line });
      continue;
    }
    // A test the clinic's list doesn't have: "Name  value  unit  low - high".
    if (NOT_A_RESULT.test(line)) continue;
    const m = /^([A-Za-z][A-Za-z0-9 .()/+'-]{1,40}?)[\s:]+([<>≤≥]?\s*-?\d+(?:[.,]\d+)?)(.*)$/.exec(line);
    if (!m) continue;
    const name = m[1].replace(/[\s:.-]+$/, '').trim();
    const { value, valueText, unit, refLow, refHigh } = readValues(`${m[2]}${m[3]}`);
    if ((value == null && !valueText) || !unit || (refLow == null && refHigh == null)) continue;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    rows.push({ key: null, group: null, analyte: name, value, value_text: valueText, unit, ref_low: refLow, ref_high: refHigh, matched: false, line });
  }
  return rows;
}

/** pdf.js text items of one page → lines (same baseline = same line, left to right). */
export function linesFromPdfItems(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = it.transform[5];
    const x = it.transform[4];
    let row = rows.find((r) => Math.abs(r.y - y) <= Math.max(2, (it.height || 10) * 0.4));
    if (!row) rows.push((row = { y, parts: [] }));
    row.parts.push({ x, w: it.width || 0, s: it.str });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => {
      const parts = r.parts.sort((a, b) => a.x - b.x);
      let out = '';
      let end = null;
      for (const p of parts) {
        if (end != null) out += p.x - end > 12 ? '  ' : p.x - end > 1 ? ' ' : '';
        out += p.s;
        end = p.x + p.w;
      }
      return out.trim();
    })
    .join('\n');
}
