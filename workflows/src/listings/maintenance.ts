import {processListingOutbox,reconcileListingDeliveries,type ListingGateway} from './outbox';
import type {ListingRepository} from './repository';

export type ListingMaintenanceRepository=Pick<ListingRepository,'rpc'>;

export async function runListingMaintenance(repo:ListingMaintenanceRepository,gateway:ListingGateway){
 const reconciliation=await reconcileListingDeliveries(repo,gateway);
 const lifecycle=await repo.rpc<Record<string,unknown>>('dh_listing_tick');
 const outbox=await processListingOutbox(repo,gateway);
 return {...outbox,reconciliation,lifecycle};
}
