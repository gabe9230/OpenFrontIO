/** Ordered from least to most cooperative; proposals move one stage at a time. */
export enum DiplomacyState {
  War = 0,
  ColdWar = 1,
  Neutral = 2,
  Allied = 3,
}

export const diplomacyKey = (state: DiplomacyState): string =>
  ["war", "cold_war", "neutral", "allied"][state];
