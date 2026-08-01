// tests/merge-tracker.test.mjs — regression coverage for status validation.
//
// `validateStatus` is not exported and importing merge-tracker.mjs runs the CLI
// (top-level lock + merge), so this exercises the real merge path as a CLI
// integration test via the CAREER_OPS_TRACKER / CAREER_OPS_ADDITIONS env
// overrides the script already supports for test isolation.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nmerge-tracker.mjs — status validation');

const TRACKER_HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '',
].join('\n');

// One merge run in an isolated workspace. Returns the merged tracker text.
// `seedRows` pre-populates the tracker table so re-evaluation paths (which need
// an existing row to match against) can be exercised.
function runMerge(additions, seedRows = []) {
  const work = mkdtempSync(join(tmpdir(), 'cops-merge-'));
  try {
    const tracker = join(work, 'applications.md');
    const addsDir = join(work, 'adds');
    mkdirSync(addsDir, { recursive: true });
    writeFileSync(tracker, TRACKER_HEADER + seedRows.map(r => `${r}\n`).join(''));
    for (const [name, line] of Object.entries(additions)) {
      writeFileSync(join(addsDir, name), line);
    }
    const stdout = execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: addsDir },
    });
    return { text: readFileSync(tracker, 'utf-8'), stdout };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

try {
  // TSV column order is status-BEFORE-score (per the batch TSV contract).
  // "Hired" is canonical (states.yml) — the merge must keep it, not downgrade
  // it to "Evaluated" the way an unrecognized status would be.
  const hired = runMerge({
    '1-acme.tsv': '1\t2026-01-01\tAcme\tML Eng\tHired\t4.5/5\t✅\t[1](reports/1-acme-2026-01-01.md)\tlanded the job\n',
  });
  const hiredRow = hired.text.split('\n').find(l => /\bAcme\b/.test(l)) || '';
  if (/\|\s*Hired\s*\|/.test(hiredRow) && !/\|\s*Evaluated\s*\|/.test(hiredRow)) {
    pass('merge-tracker preserves the canonical Hired status (no silent downgrade)');
  } else {
    fail(`merge-tracker mishandled Hired: ${hiredRow.trim()}`);
  }

  // "accepted" is a states.yml alias of Hired — it must resolve to Hired.
  const accepted = runMerge({
    '2-globex.tsv': '2\t2026-01-02\tGlobex\tData Eng\taccepted\t4.0/5\t✅\t[2](reports/2-globex-2026-01-02.md)\toffer accepted\n',
  });
  const acceptedRow = accepted.text.split('\n').find(l => /\bGlobex\b/.test(l)) || '';
  if (/\|\s*Hired\s*\|/.test(acceptedRow)) {
    pass('merge-tracker resolves the "accepted" alias to Hired');
  } else {
    fail(`merge-tracker did not resolve accepted -> Hired: ${acceptedRow.trim()}`);
  }

  // --- Re-evaluation write-through, both directions -----------------------
  // A re-evaluation that scores LOWER used to hit a bare `else`: the row kept
  // its stale optimistic score, the new report was orphaned, and the TSV was
  // archived to merged/ as though it had landed.
  const SEED = '| 7 | 2026-02-01 | Initech | Payments PM | 3.8/5 | Evaluated | ✅ | [7](../reports/7-initech-2026-02-01.md) | Req R5639. stretch apply |';

  const down = runMerge({
    '8-initech.tsv': '8\t2026-03-01\tInitech\tPayments PM\tEvaluated\t3.0/5\t✅\t[8](reports/8-initech-2026-03-01.md)\tre-scored: req is 12 months old, rails gap is a gate\n',
  }, [SEED]);
  const downRow = down.text.split('\n').find(l => /\bInitech\b/.test(l)) || '';

  if (/\|\s*3\.0\/5\s*\|/.test(downRow) && !/\|\s*3\.8\/5\s*\|/.test(downRow)) {
    pass('re-evaluation with a LOWER score writes through (no silent skip)');
  } else {
    fail(`lower-scored re-eval did not write through: ${downRow.trim()}`);
  }

  if (/\[8\]/.test(downRow) && !/\[7\]\(/.test(downRow)) {
    pass('downgrade re-points the Report link at the newer report');
  } else {
    fail(`downgrade left a stale report link: ${downRow.trim()}`);
  }

  // The fuzzy matcher can mis-pair genuinely different roles (role-matcher.mjs
  // drops "Senior" and short tokens), so a downgrade must stay recoverable.
  if (/Superseded report \[7\] \(was 3\.8\/5\)/.test(downRow)) {
    pass('downgrade records the superseded report number in Notes');
  } else {
    fail(`downgrade did not record the superseded report: ${downRow.trim()}`);
  }

  if (/DOWNGRADE/.test(down.stdout) && /🔽/.test(down.stdout)) {
    pass('downgrade is announced on stdout, not merged silently');
  } else {
    fail(`downgrade was not announced: ${down.stdout.trim()}`);
  }

  if (/🔄1 updated/.test(down.stdout) && /⏭️0 skipped/.test(down.stdout)) {
    pass('downgrade counts as an update, not a skip');
  } else {
    fail(`downgrade counters wrong: ${down.stdout.trim()}`);
  }

  // An upgrade must keep behaving exactly as before this change.
  const up = runMerge({
    '9-initech.tsv': '9\t2026-03-01\tInitech\tPayments PM\tEvaluated\t4.5/5\t✅\t[9](reports/9-initech-2026-03-01.md)\tre-scored up after JD refresh\n',
  }, [SEED]);
  const upRow = up.text.split('\n').find(l => /\bInitech\b/.test(l)) || '';

  if (/\|\s*4\.5\/5\s*\|/.test(upRow) && /Re-eval 2026-03-01 \(3\.8→4\.5\)/.test(upRow)) {
    pass('re-evaluation with a HIGHER score still writes through unchanged');
  } else {
    fail(`upgrade path regressed: ${upRow.trim()}`);
  }

  if (!/Superseded report/.test(upRow) && !/DOWNGRADE/.test(up.stdout)) {
    pass('upgrade does not add the superseded-report marker');
  } else {
    fail(`upgrade wrongly marked as a downgrade: ${upRow.trim()}`);
  }
} catch (e) {
  fail(`merge-tracker.mjs tests crashed: ${e.message}`);
}
