import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCsv } from './csv.js';

export interface PrototypeShape {
  code: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
  floors: number;
  ring?: [number, number];
  area?: string;
  note?: string;
}

export interface PrototypeLayout {
  buildings: PrototypeShape[];
  areas: PrototypeShape[];
  fibers: { device: string; color: string; route: string }[];
  staff: string[];
  wan: { device: string; provider: string; label: string; priority: number }[];
}

export interface SeedFiles {
  buildings: Record<string, string>[];
  areas: Record<string, string>[];
  devices: Record<string, string>[];
  layout: PrototypeLayout;
}

/** Reads infra/seed (buildings.csv, areas.csv, devices.csv, prototype-layout.json). */
export async function readSeedFiles(dir: string): Promise<SeedFiles> {
  const csv = async (name: string) => parseCsv(await readFile(join(dir, name), 'utf8'));
  return {
    buildings: await csv('buildings.csv'),
    areas: await csv('areas.csv'),
    devices: await csv('devices.csv'),
    layout: JSON.parse(
      await readFile(join(dir, 'prototype-layout.json'), 'utf8'),
    ) as PrototypeLayout,
  };
}
