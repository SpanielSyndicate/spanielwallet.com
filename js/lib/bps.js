// Basis-point math constant. Single source of truth for the BPS
// denominator used by every fee/share/discount calculation across the
// project (curve pricing, affiliate, rescue pool, marketplace fee,
// Packline payouts, buyer-referral discount).
//
// Pulling this into its own module avoids a four-way duplication
// (`referral.js`, `rescue.js`, `marketplace-math.js`, `packline.js`).
// 1 bp = 0.01%, so 100% = 10,000 bps.

export const BPS_DENOMINATOR = 10000;
