import type { SalesforceConfig, SalesforceSession, SalesforceField } from "./salesforce";

export interface SfTransferPayload {
  sfObject: string;
  sfObjectLabel: string;
  sfFields: string[];
  sfAllFields: SalesforceField[];
  sfRows: Record<string, unknown>[];
  sfTotalSize: number;
  sfConfig: SalesforceConfig;
  sfSession: SalesforceSession;
}

// In-memory store — survives client-side navigation, cleared on page refresh.
// Avoids sessionStorage quota limits for large datasets.
let _payload: SfTransferPayload | null = null;

export function setSfTransfer(p: SfTransferPayload) {
  _payload = p;
}

export function getSfTransfer(): SfTransferPayload | null {
  return _payload;
}

export function clearSfTransfer() {
  _payload = null;
}
