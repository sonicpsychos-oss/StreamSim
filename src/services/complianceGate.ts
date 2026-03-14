import { ComplianceConfig } from "../core/types.js";

export interface ComplianceReconcileResult {
  compliance: ComplianceConfig;
  versionChanged: boolean;
  acceptanceRecorded: boolean;
  acceptanceInvalidated: boolean;
}

export function reconcileComplianceUpdate(previous: ComplianceConfig, next: ComplianceConfig): ComplianceReconcileResult {
  const versionChanged = previous.eulaVersion !== next.eulaVersion;
  const acceptanceInvalidated = versionChanged && previous.eulaAccepted && next.eulaAccepted;

  const compliance: ComplianceConfig = {
    eulaVersion: next.eulaVersion,
    eulaAccepted: acceptanceInvalidated ? false : next.eulaAccepted
  };

  const acceptanceRecorded = !previous.eulaAccepted && compliance.eulaAccepted;

  return {
    compliance,
    versionChanged,
    acceptanceRecorded,
    acceptanceInvalidated
  };
}
