import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type WithHierarchy<T> = T & Record<string, unknown>;

export function buildHierarchy<T extends { GRAU: number }>(
  data: T[],
  nameField: keyof T
): WithHierarchy<T>[] {
  const maxGrau = Math.max(...data.map((r) => r.GRAU), 0);
  const grauStack: Record<number, string> = {};

  return data.map((row) => {
    const g = row.GRAU;
    const name = row[nameField] as string;

    if (g === 1) {
      for (let i = 1; i <= maxGrau; i++) grauStack[i] = "";
    }
    grauStack[g] = name;
    for (let i = g + 1; i <= maxGrau; i++) grauStack[i] = "";

    const grauCols: Record<string, string> = {};
    for (let i = 1; i <= maxGrau; i++) {
      grauCols[`GRAU_${i}`] = grauStack[i] || "";
    }

    return { ...row, ...grauCols, _maxGrau: maxGrau } as WithHierarchy<T>;
  });
}

export const ESTADOS_BRASILEIROS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA",
  "MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN",
  "RS","RO","RR","SC","SP","SE","TO",
];
