import Papa from "papaparse";

export interface Instrument {
  instrument_token: number;
  exchange_token: number;
  tradingsymbol: string;
  name: string;
  last_price: number;
  expiry: string;
  strike: number;
  tick_size: number;
  lot_size: number;
  instrument_type: string;
  segment: string;
  exchange: string;
}

export interface StockInstrument {
  symbol: string;
  name: string;
  exchange: string;
  instrument_token: number;
  exchange_token: number;
  segment: string;
}

// Fetches all EQ instruments from NSE and BSE via the public Kite instruments endpoint.
// No auth required. Returns ~10k rows filtered down to equity only.
export async function fetchEquityInstruments(): Promise<StockInstrument[]> {
  const [nseText, bseText] = await Promise.all([
    fetch("https://api.kite.trade/instruments/NSE").then(r => r.text()),
    fetch("https://api.kite.trade/instruments/BSE").then(r => r.text()),
  ]);

  const parse = (csv: string, exchange: string): StockInstrument[] => {
    const { data } = Papa.parse<Instrument>(csv, { header: true, skipEmptyLines: true });
    return data
      .filter(row => row.instrument_type === "EQ")
      .map(row => ({
        symbol: row.tradingsymbol.trim(),
        name: row.name.trim(),
        exchange,
        instrument_token: Number(row.instrument_token),
        exchange_token: Number(row.exchange_token),
        segment: row.segment,
      }));
  };

  return [...parse(nseText, "NSE"), ...parse(bseText, "BSE")];
}
