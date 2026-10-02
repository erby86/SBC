import { BUILDING_CODES } from '@sbc-noc/shared';

export interface Logger {
  info(message: string): void;
}

/** Worker entry. Redis/BullMQ queues are wired in later modules. */
export function start(logger: Logger = console): void {
  logger.info(`sbc-noc worker started (buildings: ${BUILDING_CODES.length})`);
}
