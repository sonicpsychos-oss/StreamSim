import fs from "node:fs";
import path from "node:path";

const checklistPath = path.resolve(process.cwd(), "docs/development-checklist.md");
const checklist = fs.readFileSync(checklistPath, "utf8");

const requiredRows = [
  "onboarding UX checks",
  "compliance-loop failure states",
  "release checklist automation"
];

const missing = requiredRows.filter((row) => !checklist.toLowerCase().includes(row.toLowerCase()));
if (missing.length) {
  console.error(`Missing required polish evidence rows: ${missing.join(", ")}`);
  process.exit(1);
}

const stillPartialTone = /\[~\]\s+Tone signal available for pacing/i.test(checklist);
if (stillPartialTone) {
  console.error("Tone signal row still marked partial despite parity implementation.");
  process.exit(1);
}

console.log("Release checklist validation passed.");
