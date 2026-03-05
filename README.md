# Portfolio Tracker — Guida al Deploy

## Stack
- **Frontend**: React + Vite
- **Backend**: Vercel Serverless Functions (Node.js)
- **Prezzi**: Finnhub API (gratuita, 60 req/min)
- **Auth**: localStorage (demo) → Supabase (produzione)
- **Pagamenti**: Stripe Checkout (da integrare)

---

## 1. Ottieni la API key Finnhub (2 minuti)

1. Vai su https://finnhub.io/register
2. Crea un account gratuito
3. Copia la tua API key dalla dashboard
4. Il piano gratuito include:
   - 60 richieste/minuto
   - Prezzi in tempo reale (US markets)
   - Dati storici giornalieri
   - Ricerca simboli

---

## 2. Struttura del progetto

```
portfolio-tracker/
├── api/
│   ├── price.js       ← GET /api/price?symbol=AAPL
│   ├── history.js     ← GET /api/history?symbol=AAPL&days=30
│   └── search.js      ← GET /api/search?q=apple
├── src/
│   ├── utils/
│   │   └── priceApi.js  ← Chiamate al proxy dal frontend
│   └── ... (componenti React)
├── .env.example
├── vercel.json
├── vite.config.js
└── package.json
```

---

## 3. Deploy su Vercel (5 minuti)

### Opzione A — Vercel CLI (consigliata)

```bash
# Installa Vercel CLI
npm i -g vercel

# Nella root del progetto
cd portfolio-tracker
npm install

# Login e deploy
vercel login
vercel

# Aggiungi le variabili d'ambiente
vercel env add FINNHUB_API_KEY
# → inserisci la tua chiave quando richiesto

vercel env add ALLOWED_ORIGIN
# → inserisci https://tuo-progetto.vercel.app
```

### Opzione B — GitHub + Vercel Dashboard

1. Crea un repo GitHub e fai push del progetto
2. Vai su https://vercel.com/new
3. Importa il repo GitHub
4. In "Environment Variables" aggiungi:
   - `FINNHUB_API_KEY` = la tua chiave
   - `ALLOWED_ORIGIN` = `https://tuo-progetto.vercel.app`
5. Clicca Deploy

---

## 4. Sviluppo locale

```bash
npm install

# Crea il file .env.local
cp .env.example .env.local
# → apri .env.local e inserisci la tua FINNHUB_API_KEY

# Avvia il dev server (Vite + proxy locale)
npm run dev
```

Le funzioni serverless girano localmente tramite `vercel dev` oppure
vengono proxate da Vite verso `localhost:3000`.

---

## 5. Come usare priceApi.js nel componente React

```js
import { fetchPrice, fetchPrices, fetchHistory, searchTickers, startPricePolling } from './utils/priceApi';

// Prezzo singolo
const price = await fetchPrice('AAPL'); // → 213.49

// Prezzi multipli (batch)
const prices = await fetchPrices(['AAPL', 'MSFT', 'NVDA']);
// → { AAPL: 213.49, MSFT: 415.32, NVDA: 875.20 }

// Storico per grafico
const candles = await fetchHistory('AAPL', 30);
// → [{ date: "01 gen", price: 210.5 }, ...]

// Ricerca ticker (autocomplete)
const results = await searchTickers('apple');
// → [{ ticker: 'AAPL', name: 'Apple Inc', exchange: 'US' }, ...]

// Auto-refresh ogni 60s durante orario di borsa
useEffect(() => {
  const stop = startPricePolling(
    stocks.map(s => s.ticker),
    (prices) => {
      setStocks(prev => prev.map(s => ({
        ...s,
        currentPrice: prices[s.ticker] ?? s.currentPrice
      })));
    }
  );
  return stop; // cleanup on unmount
}, [stocks.length]);
```

---

## 6. Prossimi step (roadmap)

| Priorità | Task | Strumento |
|----------|------|-----------|
| 🔴 Alta | Autenticazione reale | Supabase Auth |
| 🔴 Alta | Database cloud | Supabase Postgres |
| 🟡 Media | Pagamenti | Stripe Billing |
| 🟡 Media | Notifiche email | Resend |
| 🟢 Bassa | Push notifications | Web Push API |
| 🟢 Bassa | Import CSV broker | Parser custom |

---

## 7. Costi stimati a regime

| Servizio | Piano | Costo |
|----------|-------|-------|
| Vercel | Hobby | €0 |
| Finnhub | Basic | €0 (60 req/min) |
| Supabase | Free | €0 (fino a 500MB) |
| Stripe | - | 1.5% + €0.25 per transazione |
| Resend | Free | €0 (3.000 email/mese) |
| **Totale** | **MVP** | **~€0** |

Con 100 utenti paganti a €12/mese → €1.200/mese di ricavi,
costi infrastruttura ancora €0 (tutti i tier free reggono).

---

## Note legali

- Aggiungere disclaimer MiFID II visibile in ogni pagina ✅ (già implementato)
- Privacy Policy GDPR obbligatoria prima del lancio pubblico
- Termini di Servizio con esclusione di responsabilità finanziaria
- Cookie banner per utenti EU
- Finnhub free tier: **solo uso non commerciale** → passare a piano "Starter" (€50/mese)
  prima di monetizzare, oppure valutare Polygon.io ($29/mese con licenza commerciale)
