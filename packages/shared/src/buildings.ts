/** Building codes of SB School campus (ADR-0006 label prefix). */
export const BUILDING_CODES = ['sp', 'i2', 'i1', 'b1', 'b2', 's8', 'ba', 'bb'] as const;

export type BuildingCode = (typeof BUILDING_CODES)[number];
