import {staticFile} from 'remotion';

export type SchoolMeta = {province: string; city: string};
export type FrameEntry = {n: string; s: number};
export type ContestEvent = {
  name: string;
  type: string;
  year: number;
  month: string; // "YYYY-MM"
};

export type Dataset = {
  months: string[]; // "YYYY-MM"
  schools: Record<string, SchoolMeta>;
  frames: FrameEntry[][];
  contests: ContestEvent[];
};

let cached: Dataset | null = null;

export const loadDataset = async (): Promise<Dataset> => {
  if (cached) return cached;
  const res = await fetch(staticFile('snapshots.json'));
  cached = (await res.json()) as Dataset;
  return cached;
};
