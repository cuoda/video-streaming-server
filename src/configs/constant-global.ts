import { LRUCache } from 'lru-cache';

const VERSION = 'v1';
const REDIS_HARD_TTL = 10 * 60;
const LRU_SOFT_TTL_MS = 5 * 60 * 1000;
const LAST_USED_DEBOUNCE_SEC = 60;
const LAST_USED_HASH = `vmx:api_key:last_used:${VERSION}`;

const DEFAULT_PLAYLIST_LIMIT = 10;

export {
  VERSION,
  REDIS_HARD_TTL,
  LRU_SOFT_TTL_MS,
  LAST_USED_DEBOUNCE_SEC,
  LAST_USED_HASH,
  DEFAULT_PLAYLIST_LIMIT,
};
