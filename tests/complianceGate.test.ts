import { describe, expect, it } from "vitest";
import { reconcileComplianceUpdate } from "../src/services/complianceGate.js";

describe("compliance gate reconciliation", () => {
  it("records acceptance when first accepted", () => {
    const result = reconcileComplianceUpdate(
      { eulaAccepted: false, eulaVersion: "2026-01" },
      { eulaAccepted: true, eulaVersion: "2026-01" }
    );

    expect(result.compliance.eulaAccepted).toBe(true);
    expect(result.acceptanceRecorded).toBe(true);
    expect(result.versionChanged).toBe(false);
    expect(result.acceptanceInvalidated).toBe(false);
  });

  it("invalidates acceptance when EULA version changes", () => {
    const result = reconcileComplianceUpdate(
      { eulaAccepted: true, eulaVersion: "2026-01" },
      { eulaAccepted: true, eulaVersion: "2026-02" }
    );

    expect(result.versionChanged).toBe(true);
    expect(result.acceptanceInvalidated).toBe(true);
    expect(result.compliance.eulaAccepted).toBe(false);
    expect(result.acceptanceRecorded).toBe(false);
  });
});
