'use strict';
/* ===================== PRICING — EDIT THE NUMBERS HERE =====================
   `intro` is charged for the first INTRO_CYCLES months, then `regular` every month.
   The SERVER decides the amount, so a customer can never change the price from the browser.
   Add or remove currencies freely, as long as Flutterwave supports them on your account. */
const INTRO_CYCLES = 3;
const PRICES = {
  NGN: { intro: 3000, regular: 4000 },
  USD: { intro: 3,    regular: 4 },
  GHS: { intro: 35,   regular: 45 },
  KES: { intro: 350,  regular: 450 },
  ZAR: { intro: 45,   regular: 60 },
  GBP: { intro: 2.5,  regular: 3.5 },
  EUR: { intro: 3,    regular: 4 }
};
const LIMITS = {
  free:    { branches: 2,  staff: 3,  products: 200,     imports: 8 },
  premium: { branches: 10, staff: 50, products: 1000000, imports: 1000000 }
};
const supported = c => Object.prototype.hasOwnProperty.call(PRICES, String(c || '').toUpperCase());
const pickCurrency = (want, fallback) => supported(want) ? String(want).toUpperCase() : supported(fallback) ? String(fallback).toUpperCase() : 'USD';
const amountFor = (currency, cycle) => { const p = PRICES[currency]; return cycle < INTRO_CYCLES ? p.intro : p.regular; };
module.exports = { INTRO_CYCLES, PRICES, LIMITS, supported, pickCurrency, amountFor };
