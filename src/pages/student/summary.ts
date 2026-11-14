/**
 * Plain-text summary of a group's game, for pasting into a chat (e.g. to get
 * feedback on one's strategy). Money is in USD millions, quantities in kb.
 */
import type { FinalResultsPayload, StudentState } from '@/lib/types';
import { COUNTRY_NAMES, COUNTRY_ORDER } from '@/lib/countries';

const n0 = (x: unknown) => (x == null || x === '' ? '-' : Math.round(Number(x)).toLocaleString('en-US'));
const n1 = (x: unknown) => (x == null || x === '' ? '-' : Number(x).toFixed(1));
const usd = (x: unknown) => (x == null ? '-' : `$${Number(x).toFixed(2)}`);
const m = (x: unknown) => (x == null ? '-' : `$${Math.round(Number(x)).toLocaleString('en-US')}M`);
const name = (c: string) => `${COUNTRY_NAMES[c as keyof typeof COUNTRY_NAMES]?.en ?? c} (${c})`;
const CARD: Record<string, string> = {
  eor: 'Enhanced Oil Recovery',
  capacity_expansion: 'Capacity Expansion',
  price_hedge: 'Price Hedge',
  audit: 'Audit',
};

export function buildSummary(s: StudentState, final?: FinalResultsPayload | null): string {
  const L: string[] = [];
  const st = s.state;
  const me = s.country.code;
  const worldOf = new Map((final?.worlds ?? []).map((w) => [w.id, w.code]));

  L.push('OPEC GAME SUMMARY (money in USD millions, quantities in thousand barrels = kb)');
  L.push(
    `Country: ${name(me)} | World ${s.world.code} | Group ${s.group.group_number} | ` +
      `Period ${s.session.current_period}/${s.session.total_periods} | status: ${s.session.status}`,
  );
  L.push(
    `Marginal cost ${usd(st.marginal_cost)}/bbl | capacity ${n0(st.capacity)} kb (start ${n0(st.base_capacity)}) | ` +
      `reserves start ${n0(st.original_reserves)} kb${Number(st.reserves_bonus) ? ` + EOR ${n0(st.reserves_bonus)}` : ''}, remaining ${n0(st.remaining_reserves)} kb`,
  );
  L.push(
    `Cumulative profit ${m(st.cumulative_profit)} | compounded profits ${m(st.cumulative_fv)} | card costs ${m(st.card_costs)} | ` +
      `estimated wealth ${m(st.estimated_wealth)}`,
  );

  // ---- periods
  L.push('', 'MY PERIODS');
  L.push('P | demand | event | world price | world total kb (share) | my kb | my % cap | my pledge % | auto | profit | hedge | card cost | remaining kb | est. wealth');
  const worldRes = new Map(s.world_results.map((w) => [w.period_number, w]));
  const myPledge = new Map(s.pledges.filter((p) => p.group_id === s.group.id).map((p) => [p.period_number, p]));
  for (const r of s.results) {
    const w = worldRes.get(r.period_number);
    const ev = s.events.find((e) => e.effective_period === r.period_number);
    L.push(
      [
        r.period_number,
        w?.demand_type ?? '-',
        ev ? `${ev.event_type} ${Math.round(Number(ev.demand_change) * 100)}%` : '-',
        usd(r.price),
        w ? `${n0(w.total_production)} (${n1(Number(w.production_share) * 100)}%)` : '-',
        n0(r.production),
        n1(r.production_pct),
        myPledge.get(r.period_number) ? n1(myPledge.get(r.period_number)!.pledge_pct) : '-',
        r.auto_submitted ? 'yes' : 'no',
        m(r.profit),
        Number(r.hedge_payout) ? m(r.hedge_payout) : '-',
        Number(r.card_cost) ? m(r.card_cost) : '-',
        n0(r.remaining_reserves),
        m(r.estimated_wealth),
      ].join(' | '),
    );
  }
  const open = s.periods.find((p) => p.status === 'open');
  if (open) {
    const sub = s.submissions.find((x) => x.period_number === open.number);
    const pl = myPledge.get(open.number);
    L.push(
      `Period ${open.number} is open (${open.demand_type} demand): ` +
        (sub ? `my submission ${n0(sub.production)} kb (${n1(sub.production_pct)}%)` : 'no submission yet') +
        (pl ? `, my pledge ${n1(pl.pledge_pct)}%` : ''),
    );
  }
  if (s.results.length === 0) L.push('(no closed periods yet)');

  // ---- pledges and revealed production in my world
  const pledgePeriods = [...new Set(s.pledges.map((p) => p.period_number))].sort((a, b) => a - b);
  if (pledgePeriods.length) {
    L.push('', `PUBLIC PLEDGES IN WORLD ${s.world.code} (% of capacity)`);
    for (const p of pledgePeriods) {
      L.push(
        `P${p}: ` +
          COUNTRY_ORDER.map((c) => {
            const x = s.pledges.find((y) => y.period_number === p && y.country_code === c);
            return `${c} ${x ? n1(x.pledge_pct) : '-'}`;
          }).join(', '),
      );
    }
  }
  if (s.jpr_reveals.length || s.audits.length) {
    L.push('', 'REVEALED ACTUAL PRODUCTION (% of capacity)');
    for (const p of [...new Set(s.jpr_reveals.map((r) => r.period_number))].sort((a, b) => a - b)) {
      L.push(
        `P${p} (Joint Production Review): ` +
          COUNTRY_ORDER.map((c) => `${c} ${n1(s.jpr_reveals.find((r) => r.period_number === p && r.country_code === c)?.production_pct)}`).join(', '),
      );
    }
    for (const a of s.audits) L.push(`Audit: ${name(a.target_country)} in P${a.target_period} = ${n1(a.production_pct)}%`);
  }

  // ---- cards, review, events
  L.push('', 'CARDS');
  if (s.cards.length === 0) L.push('none');
  for (const c of s.cards) {
    L.push(
      `${CARD[c.card_type] ?? c.card_type}: bought P${c.purchased_period}, cost ${m(c.cost)}` +
        (c.card_type === 'audit'
          ? ''
          : `, active from P${c.activation_period}${c.end_period ? ` to P${c.end_period}` : ''}`),
    );
  }
  const jpr = s.jpr_requests.map((r) => `${r.status} (yes ${r.yes_count}, no ${r.no_count}${r.revealed_periods?.length ? `, revealed P${r.revealed_periods.join(', P')}` : ''})`);
  L.push(`Joint Production Review in my world: ${jpr.length ? jpr.join('; ') : 'never requested'}`);
  L.push(`Events: ${s.events.length ? s.events.map((e) => `${e.event_type} ${Math.round(Number(e.demand_change) * 100)}% in P${e.effective_period}`).join('; ') : 'none'}`);

  // ---- after the game: twins and the rest of my world
  if (s.session.status === 'finished' && final) {
    L.push('', 'FINAL RESULTS');
    const twins = final.final_results.filter((f) => f.country_code === me).sort((a, b) => a.rank_in_country - b.rank_in_country);
    for (const f of twins) {
      L.push(
        `${name(me)} World ${worldOf.get(f.world_id) ?? '?'}${f.group_id === s.group.id ? ' (ME)' : ''}: final wealth ${m(f.final_wealth)} ` +
          `(compounded profits ${m(f.total_fv)} + oil left ${m(f.terminal_value)} - cards ${m(f.card_costs)}), rank ${f.rank_in_country} of ${twins.length}`,
      );
    }
    L.push('', 'WORLD AVERAGES (avg production share of capacity | avg price | total wealth of the 7 countries)');
    for (const w of final.worlds) {
      const wr = final.world_results.filter((x) => x.world_id === w.id);
      const share = wr.length ? (wr.reduce((a, x) => a + Number(x.production_share), 0) / wr.length) * 100 : null;
      const price = wr.length ? wr.reduce((a, x) => a + Number(x.price), 0) / wr.length : null;
      const total = final.final_results.filter((f) => f.world_id === w.id).reduce((a, f) => a + Number(f.final_wealth), 0);
      L.push(`World ${w.code}: ${n1(share)}% | ${usd(price)} | ${m(total)}`);
    }
    const mine = final.results.filter((r) => r.world_id === s.world.id);
    if (mine.length) {
      L.push('', `ACTUAL PRODUCTION IN WORLD ${s.world.code} (% of capacity, revealed after the game)`);
      const periods = [...new Set(mine.map((r) => r.period_number))].sort((a, b) => a - b);
      for (const c of COUNTRY_ORDER) {
        L.push(`${c}: ` + periods.map((p) => `P${p} ${n1(mine.find((r) => r.country_code === c && r.period_number === p)?.production_pct)}`).join(', '));
      }
    }
  }
  return L.join('\n');
}
