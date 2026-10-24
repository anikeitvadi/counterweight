/** One-paragraph explanations shown from the ⓘ on each panel, written for a trader who has not met the term before. */
export const GLOSSARY: Record<string, { what: string; read: string }> = {
  heatmap: {
    what: 'Where leveraged positions would be force-closed if price got there. Each horizontal band is an estimated pile of liquidation orders; brighter means bigger. It is built from changes in open interest and typical leverage, not from anyone\'s real positions.',
    read: 'Bright bands act like magnets and like fuel: price often runs toward them, and when it arrives the forced orders push it through. Bands above price are shorts at risk, bands below are longs. Dots are liquidations that actually happened.',
  },
  ratio: {
    what: 'Put versus call open interest, written as a conviction ratio: the smaller side is 1 and the bigger side is the multiple, so 1 : 2.3 means 2.3× as much open interest on the bigger side. The order (puts : calls or calls : puts) names the sides. The classic put/call figure (puts ÷ calls) sits beside it; the volume version uses the last 24 hours of trading instead of all open positions.',
    read: 'Colour is the contrarian lean: red when puts are the thin side (the crowd is long, lean short), green when calls are thin (the crowd is hedged, lean long); near 1 : 1 is balanced. The bigger the multiple, the more one-sided the crowd. The header expiry scopes it (D1 = the nearest daily, which is what Delta\'s page shows); with All expiries the date buttons appear and a hedged front with call-heavy back months tells a different story from the single number. The 24h/7d changes and the trend are the whole-chain put/call recorded by this desk.',
  },
  oi: {
    what: 'How many option contracts are open at each strike. Green bars are calls, red bars are puts.',
    read: 'Big strikes act as walls where dealers hedge. Max pain is the price where option buyers as a group lose the most; price often drifts toward it into expiry, but it is a tendency, not a rule.',
  },
  gex: {
    what: 'Gamma exposure: how much dealers must buy or sell to stay hedged as price moves, per 1% move, assuming dealers are long calls and short puts.',
    read: 'Above the flip level dealers sell rallies and buy dips, which dampens moves. Below it they chase, which amplifies moves. Large positive bars near price pin it; large negative bars make it slippery.',
  },
  smile: {
    what: 'Implied volatility at each strike for one expiry. The curve usually smiles: wings cost more than the middle.',
    read: 'A steep left side (puts expensive) means the market is paying for crash protection. The 25-delta skew number in the title is that asymmetry in vol points: positive = puts bid, negative = calls bid.',
  },
  term: {
    what: 'At-the-money implied volatility for each expiry, against the volatility the market actually realised over the last week.',
    read: 'Upward sloping is normal. An inverted curve (near-term above far-term) means an event or stress is priced right now. IV far above realised means options are rich to sell; far below, cheap to buy.',
  },
  flow: {
    what: 'Which strikes traded the most in the last 24 hours and where open interest grew or shrank since yesterday.',
    read: 'New open interest at a strike is a fresh bet or hedge, not a closed one. Heavy call volume above price with growing OI is upside positioning; heavy put volume below is protection being bought.',
  },
  tiles: {
    what: 'The desk summary: perp price and funding, open interest, put/call ratio, implied versus realised volatility, IV rank, skew, max pain and the one-standard-deviation move the options price in for the front expiry.',
    read: 'Funding tells you who is paying to hold. IV rank tells you whether options are expensive versus the last year. The 1σ move is the range the market expects about two times in three.',
  },
  alerts: {
    what: 'Rules that watch the data for you and raise a notification, with sound, when something worth a look happens.',
    read: 'Enable the ones you care about and set thresholds in the asset\'s units. Alerts only fire while this tab is open.',
  },
};
