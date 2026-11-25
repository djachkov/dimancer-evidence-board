import classic from "./cards-classic.mjs";
import parchment from "./cards-parchment.mjs";
import holo from "./cards-holo.mjs";

const PAINTERS = { classic, parchment, holo };

/** The painter of a card style (classic for an unknown one). */
export const cardPainter = style => PAINTERS[style] ?? classic;
