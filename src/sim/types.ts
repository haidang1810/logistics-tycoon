import type { CargoId } from './config';

export type { CargoId };

export const Terrain = {
  Grass: 0,
  Water: 1,
} as const;

export type BuildingKind = 'farm' | 'orchard' | 'mill' | 'market' | 'house';

export interface Building {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** i18n key of the display name */
  nameKey: string;
  stock: Partial<Record<CargoId, number>>;
  /** Visual variety only */
  variant: number;
}

export type TruckState = 'toPickup' | 'loading' | 'toDropoff' | 'unloading' | 'stuck';

export interface Truck {
  id: number;
  fromId: number;
  toId: number;
  cargo: CargoId;
  state: TruckState;
  load: number;
  /** Tile indices; path[pathPos] is the tile the truck is on / leaving */
  path: number[];
  pathPos: number;
  /** 0..1 progress towards path[pathPos + 1] */
  progress: number;
  pathRoadVersion: number;
  waitTicks: number;
  /** World position in tile units (tile centre = integer + 0.5) */
  x: number;
  y: number;
  heading: number;
  trips: number;
  earned: number;
  color: number;
}

export type ContractStatus = 'offer' | 'active' | 'done' | 'failed' | 'expired';

export interface Contract {
  id: number;
  cargo: CargoId;
  targetId: number;
  amount: number;
  delivered: number;
  durationDays: number;
  /** Day the offer disappears if not accepted */
  offerExpiresDay: number;
  /** Set when accepted */
  deadlineDay: number;
  reward: number;
  penalty: number;
  status: ContractStatus;
}

export type MessageTone = 'info' | 'good' | 'bad';

export interface GameMessage {
  id: number;
  day: number;
  key: string;
  params: Record<string, string | number>;
  tone: MessageTone;
}

export interface WorldState {
  seed: number;
  width: number;
  height: number;
  terrain: Uint8Array;
  road: Uint8Array;
  tree: Uint8Array;
  /** Building id occupying the tile, or -1 */
  occupant: Int32Array;
  buildings: Building[];
  trucks: Truck[];
  contracts: Contract[];
  messages: GameMessage[];
  money: number;
  tick: number;
  rngState: number;
  nextId: number;
  /** Bumped whenever the road network changes */
  roadVersion: number;
}

export interface CommandResult {
  ok: boolean;
  /** i18n key explaining a failure */
  reason?: string;
  cost?: number;
}
