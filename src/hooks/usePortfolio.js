import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";
import { useAuth } from "../contexts/AuthContext";

const STORAGE_KEY = "tf_stocks";

function loadLocal() {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    return r ? JSON.parse(r) : [];
  } catch {
    return [];
  }
}

function saveLocal(stocks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stocks));
  } catch {}
}

export function usePortfolio() {
  const { user } = useAuth();
  const [stocks, setStocks] = useState(loadLocal);
  const [loading, setLoading] = useState(false);

  // Carica da Supabase quando l'utente fa login
  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    supabase
      .from("stocks")
      .select("*")
      .eq("user_id", user.id)
      .then(({ data, error }) => {
        if (!error && data) {
          const mapped = data.map(s => ({
            id: s.id,
            dbId: s.id,
            ticker: s.ticker,
            name: s.name,
            qty: s.qty,
            buyPrice: s.buy_price,
            currentPrice: s.current_price ?? s.buy_price,
            sector: s.sector,
            buyDate: s.buy_date,
          }));
          setStocks(mapped);
          saveLocal(mapped);
        }
        setLoading(false);
      });
  }, [user?.id]);

  // Sync localStorage ad ogni cambio
  useEffect(() => {
    saveLocal(stocks);
  }, [stocks]);

  const addStock = useCallback(async (stock) => {
    const newStock = { ...stock, id: stock.id || crypto.randomUUID() };
    setStocks(prev => [...prev, newStock]);

    if (user?.id) {
      const { data, error } = await supabase.from("stocks").insert({
        user_id: user.id,
        ticker: newStock.ticker,
        name: newStock.name,
        qty: newStock.qty,
        buy_price: newStock.buyPrice,
        current_price: newStock.currentPrice,
        sector: newStock.sector,
        buy_date: newStock.buyDate,
      }).select().single();
      if (!error && data) {
        setStocks(prev => prev.map(s => s.id === newStock.id ? { ...s, dbId: data.id } : s));
      }
    }
  }, [user?.id]);

  const updateStock = useCallback(async (id, updates) => {
    setStocks(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    const stock = stocks.find(s => s.id === id);
    if (user?.id && stock?.dbId) {
      await supabase.from("stocks").update({
        qty: updates.qty ?? stock.qty,
        buy_price: updates.buyPrice ?? stock.buyPrice,
        current_price: updates.currentPrice ?? stock.currentPrice,
      }).eq("id", stock.dbId);
    }
  }, [user?.id, stocks]);

  const removeStock = useCallback(async (id) => {
    const stock = stocks.find(s => s.id === id);
    setStocks(prev => prev.filter(s => s.id !== id));
    if (user?.id && stock?.dbId) {
      await supabase.from("stocks").delete().eq("id", stock.dbId);
    }
  }, [user?.id, stocks]);

  const clearAll = useCallback(async () => {
    setStocks([]);
    if (user?.id) {
      await supabase.from("stocks").delete().eq("user_id", user.id);
    }
  }, [user?.id]);

  return {
    stocks,
    setStocks,
    loading,
    addStock,
    updateStock,
    removeStock,
    clearAll,
  };
}
