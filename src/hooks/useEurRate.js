import { useState, useEffect } from "react";

export function useEurRate() {
  const [eurRate, setEurRate] = useState(0.92);

  useEffect(() => {
    fetch("https://api.exchangerate-api.com/v4/latest/USD")
      .then(r => r.json())
      .then(d => { if (d.rates?.EUR) setEurRate(d.rates.EUR); })
      .catch(() => {}); // usa default 0.92
  }, []);

  return eurRate;
}
