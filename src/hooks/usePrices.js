import { useState, useCallback } from "react";
import { API_BASE } from "../utils/api";

export function usePrices() {
  const [refreshing, setRefreshing] = useState(false);
  const [marketStates, setMarketStates] = useState({});

  const fetchPrice = useCallback(async (ticker) => {
    try {
      const r = await fetch(`${API_BASE}/api/price?symbol=${ticker}`);
      if (!r.ok) return null;
      const d = await r.json();
      return d.price ? { price: d.price, marketState: d.marketState || "CLOSED" } : null;
    } catch {
      return null;
    }
  }, []);

  const refreshAll = useCallback(async (stocks, onUpdate) => {
    if (!stocks || stocks.length === 0) return;
    setRefreshing(true);

    const promises = stocks.map(async (stock) => {
      const result = await fetchPrice(stock.ticker);
      if (result) {
        onUpdate(stock.id, {
          currentPrice: result.price,
          priceReal: true,
          marketState: result.marketState,
        });
        setMarketStates(prev => ({ ...prev, [stock.ticker]: result.marketState }));
      }
    });

    await Promise.all(promises);
    setRefreshing(false);
  }, [fetchPrice]);

  return {
    refreshing,
    marketStates,
    fetchPrice,
    refreshAll,
  };
}
