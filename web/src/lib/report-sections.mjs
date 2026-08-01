/**
 * report-sections.mjs — splitting a report body into its author-lettered
 * sections, and cleaning those headings for display.
 *
 * Plain .mjs (same pattern as clean-chips.mjs) so test-report-sections.mjs can
 * import it directly under Node, and so the two places that used to hard-code
 * the author-letter range can no longer drift apart: they were written as
 * `[A-G]` in report-view.tsx, which silently mis-handled `## H) Draft
 * Application Answers` — the heading rendered with its letter still attached
 * while every other section rendered clean, and splitSections reported
 * `letter: null` for it (#2324).
 *
 * The range is now any single letter. The `)` / `.` / `:` delimiter is what
 * keeps this from eating ordinary prose ("A Recommendation Was Requested"),
 * not the narrowness of the range — so widening it costs no safety, and a
 * block added past H is handled the day the core writes it.
 */

/** Single source of truth for what an author-letter prefix looks like. */
const AUTHOR_LETTER = "(?:Block\\s+)?([A-Z])";

/** Strips the prefix for display: needs a real delimiter, never a bare space. */
const HEADING_PREFIX = new RegExp(`^\\s*${AUTHOR_LETTER}[).:]\\s*`, "i");

/** Reads the letter: also accepts "Block A Role Summary" (spelled-out form). */
const HEADING_LETTER = new RegExp(`^${AUTHOR_LETTER}[).:\\s]`, "i");

/**
 * @typedef {{ heading: string, letter: string | null, content: string }} Section
 */

/**
 * Display form of a section heading: author-letter prefix and the trailing
 * "(lead)" / "(verdict)" marker removed. Falls back to the original when
 * stripping would leave nothing.
 * @param {string} h
 * @returns {string}
 */
export function cleanHeading(h) {
  const stripped = h
    .replace(HEADING_PREFIX, "")
    .replace(/\s*\((?:lead|verdict)\)\s*$/i, "")
    .trim();
  return stripped || h.trim();
}

/**
 * The author letter of a heading, uppercased, or null when it carries none.
 * @param {string} heading
 * @returns {string | null}
 */
export function authorLetter(heading) {
  return heading.match(HEADING_LETTER)?.[1]?.toUpperCase() ?? null;
}

/**
 * Split a report body on `## ` headings. Everything before the first one is
 * the intro.
 * @param {string} body
 * @returns {{ intro: string, sections: Section[] }}
 */
export function splitSections(body) {
  /** @type {string[]} */
  const intro = [];
  /** @type {Section[]} */
  const sections = [];
  /** @type {{ heading: string, letter: string | null, lines: string[] } | null} */
  let cur = null;
  for (const line of body.split("\n")) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) {
      if (cur) sections.push({ heading: cur.heading, letter: cur.letter, content: cur.lines.join("\n").trim() });
      const heading = h[1].trim();
      cur = { heading, letter: authorLetter(heading), lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    } else {
      intro.push(line);
    }
  }
  if (cur) sections.push({ heading: cur.heading, letter: cur.letter, content: cur.lines.join("\n").trim() });
  return { intro: intro.join("\n").trim(), sections };
}
