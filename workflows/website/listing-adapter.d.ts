import type { OwnerDraft } from './owner-listing-model.js';
export function ownerListingAdapter(draft: OwnerDraft, status?: string): Record<string,unknown>;
export function isPublicListing(property: Record<string,unknown>): boolean;
export function listingPrice(property: Record<string,unknown>, displayCurrency: string, formatter: (amount:number,currency:string,purpose:string)=>string): string;

export function isManagedListing(property: unknown): boolean;
