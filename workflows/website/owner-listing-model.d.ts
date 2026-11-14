export interface OwnerSelection { listingRole: string; listingPurpose: string; propertyCategory: string }
export interface OwnerDraft extends Record<string, unknown> { id: string; selection: OwnerSelection }
export function createOwnerDraft(selection: OwnerSelection): OwnerDraft;
export function validateOwnerDraft(draft: OwnerDraft, confirmations?: boolean): Array<{step: number; errors: Record<string,string>}>;
export function publicOwnerListing(draft: OwnerDraft): Record<string,unknown>;
