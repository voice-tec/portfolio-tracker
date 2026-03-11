import { useState, useEffect, useMemo } from "react";
import { fetchAnalyst } from "../utils/api";

/**
 * Fetcha i settori per ogni ETF in portafoglio.
 * Ritorna { ticker: { sectorWeights: [{sector, weight}] } }
 */
export function useETFHoldings(stocks) {
  const [holdings, setHoldings] = useState({});
  const [loading, setLoading] = useState(false);

  // Lista ETF distinti nel portafoglio
  const etfTickers = useMemo(
    () => stocks.filter(s => s.sector === "ETF").map(s => s.ticker),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stocks.filter(s => s.sector === "ETF").map(s => s.ticker).join(",")]
  );

  useEffect(() => {
    if (etfTickers.length === 0) return;
    setLoading(true);

    Promise.all(
      etfTickers.map(ticker =>
        fetchAnalyst(ticker)
          .then(d => ({ ticker, sectorWeights: d.sectorWeights || [] }))
          .catch(() => ({ ticker, sectorWeights: [] }))
      )
    ).then(results => {
      const map = {};
      results.forEach(r => { map[r.ticker] = r; });
      setHoldings(map);
      setLoading(false);
    });
  }, [etfTickers.join(",")]);

  return { holdings, loading };
}
