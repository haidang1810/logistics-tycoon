// All balance numbers live here. Money is in thousands of VND (1 = 1.000₫).

export const TICKS_PER_SECOND = 20;
export const TICKS_PER_DAY = 40; // 2 real seconds per in-game day at 1x
export const DAYS_PER_MONTH = 30;

export const MAP_SIZE = 48;

export const START_MONEY = 150_000;

export const ROAD_COST = 500;
export const BRIDGE_COST = 3_000;
export const TREE_CLEAR_COST = 200;
export const BULLDOZE_REFUND = 0.5;

export const TRUCK = {
  price: 25_000,
  capacity: 20,
  tilesPerTick: 0.15, // 3 tiles per real second at 1x
  runCostPerDay: 150,
  loadTicks: 20, // time to load/unload once at a stop
  maxWaitTicks: TICKS_PER_DAY * 3, // leave half-empty after waiting this long
};

export type CargoId = 'paddy' | 'rice' | 'fruit';
export const CARGOS: CargoId[] = ['paddy', 'rice', 'fruit'];

/** Base price per unit, multiplied by the distance factor on delivery. */
export const CARGO_PRICE: Record<CargoId, number> = {
  paddy: 60,
  rice: 140,
  fruit: 110,
};
/** Revenue multiplier = 1 + manhattanDistance / DISTANCE_DIVISOR */
export const DISTANCE_DIVISOR = 15;

export const PRODUCTION = {
  farmPaddyPerDay: 5,
  orchardFruitPerDay: 3,
  millPaddyToRicePerDay: 8,
  stockCap: 200,
};

export const CONTRACT = {
  maxOffers: 3,
  maxActive: 3,
  offerLifetimeDays: 12,
  refillEveryDays: 10, // top up the offer board between months too
  minDays: 30,
  maxDays: 50,
  rewardMultiplier: 1.6, // reward = amount * cargo price * this
  penaltyRatio: 0.25, // penalty = reward * this
};

export const MAX_MESSAGES = 40;
