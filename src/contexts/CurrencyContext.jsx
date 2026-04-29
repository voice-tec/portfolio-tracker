import { createContext, useContext, useEffect, useState } from "react";

const CurrencyContext = createContext(null);

const STORAGE_KEY = "tf_currency";

export function CurrencyProvider({ children }) {
  const [currency, setCurrencyRaw] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || "EUR";
    } catch {
      return "EUR";
    }
  });

  const [eurRate, setEurRate] = useState(1.08); // EUR -> USD fallback

  // Fetch tasso di cambio EUR/USD
  useEffect(() => {
    fetch("https://api.exchangerate-api.com/v4/latest/EUR")
      .then(r => r.json())
      .then(d => { if (d.rates?.USD) setEurRate(d.rates.USD); })
      .catch(() => {});
  }, []);

  const setCurrency = (c) => {
    setCurrencyRaw(c);
    try { localStorage.setItem(STORAGE_KEY, c); } catch {}
  };

  // Simbolo e tasso per conversione USD -> valuta scelta
  const sym = currency === "EUR" ? "€" : "$";
  const rate = currency === "EUR" ? (1 / eurRate) : 1;

  const value = { currency, setCurrency, sym, rate, eurRate };

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
  return ctx;
}
