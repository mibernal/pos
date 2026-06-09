import { userKeys } from './userKeys';
import { inventoryKeys } from './inventoryKeys';
import { platformKeys } from './platformKeys';

export const queryKeys = {
  user: userKeys,
  inventory: inventoryKeys,
  platform: platformKeys,
};

export * from './platformKeys';
export * from './userKeys';
export * from './inventoryKeys';
