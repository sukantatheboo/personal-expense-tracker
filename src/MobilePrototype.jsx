import { Fragment, useRef, useState } from 'react';
import './MobilePrototype.css';

/* ───────────── constants ───────────── */
const CAT = {
  Food: ['🍜', '#e8873a'], Transport: ['🚌', '#3b82c4'], Bills: ['⚡', '#d6a31f'],
  Home: ['🏠', '#8a6fd1'], Shopping: ['🛍️', '#d9528a'], Health: ['💊', '#e0594f'],
  Entertainment: ['🎧', '#20a4a4'], Education: ['📚', '#5b73d9'], Savings: ['🐖', '#2f9a6b'],
  Other: ['✦', '#7d8a82'],
};
const ACC = { bkash: ['bKash', '#e2136e'], bank: ['Bank', '#2563a8'] };
const TABS = [['home', 'Home'], ['activity', 'Activity'], ['add'], ['accounts', 'Accounts'], ['plans', 'Plans']];

const BK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='-4 -4 128 122'%3E%3Cg fill='none'%3E%3Cpath fill='%23D12053' d='M96.58 62.45l-53.03-8.31 7.03 31.6z'/%3E%3Cpath fill='%23E2136E' d='M96.58 62.45L56.62 6.93 43.56 54.15z'/%3E%3Cpath fill='%23D12053' d='M42.32 53.51L.45 0l54.83 6.55z'/%3E%3Cpath fill='%239E1638' d='M23.25 31.15L0 9.24h6.12z'/%3E%3Cpath fill='%23D12053' d='M107.89 35.46l-9.84 26.69L82.1 40.09z'/%3E%3Cpath fill='%23E2136E' d='M56.77 84.14l38.61-15.51L97 63.7z'/%3E%3Cpath fill='%239E1638' d='M25.89 113.41l16.54-58.02 8.39 37.75z'/%3E%3Cpath fill='%23E2136E' d='M109.43 35.67l-4.06 11.02 14.64-.24z'/%3E%3C/g%3E%3C/svg%3E";

/* ───────────── icons ───────────── */
const ICONS = {
  home: <path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  activity: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  accounts: <path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-4v4M16 14h.01" />,
  plans: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  l: <path d="m15 18-6-6 6-6" />,
  r: <path d="m9 18 6-6-6-6" />,
  s: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  inc: <path d="M12 19V5M5 12l7-7 7 7" />,
  tr: <path d="M7 7h13l-4-4M17 17H4l4 4" />,
  adj: <><path d="M4 8h10M18 8h2M4 16h2M10 16h10" /><circle cx="16" cy="8" r="2" /><circle cx="8" cy="16" r="2" /></>,
  bank: <path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18" />,
};
const Icon = ({ n }) => <svg viewBox="0 0 24 24">{ICONS[n]}</svg>;

/* ───────────── helpers ───────────── */
const ld = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const ago = n => ld(new Date(Date.now() - n * 864e5));
const M = n => '৳' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const shift = (m, o) => { const [y, mo] = m.split('-').map(Number); return ld(new Date(y, mo - 1 + o, 1)).slice(0, 7); };
const fM = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
const fD = d => { const [y, m, x] = d.split('-').map(Number); return new Date(y, m - 1, x).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); };
const dayMonth = d => fD(d).split(' ').slice(1).join(' ');

const tot = (S, m) => S.exp.filter(e => e.date.startsWith(m) && e.amt != null).reduce((a, e) => a + e.amt, 0);
const monthExp = S => S.exp.filter(e => e.date.startsWith(S.m)).sort((a, b) => b.date.localeCompare(a.date));
function bal(S, id) {
  let b = S.start[id];
  for (const e of S.exp) if (e.acct === id && e.amt != null && e.date >= S.start.date && e.date <= ld()) b -= e.amt;
  for (const t of S.tx) {
    if (t.date < S.start.date) continue;
    if (t.type === 'income' && t.acct === id) b += t.amt;
    if (t.type === 'adjust' && t.acct === id) b += t.dir === 'up' ? t.amt : -t.amt;
    if (t.type === 'transfer') { if (t.acct === id) b -= t.amt; if (t.to === id) b += t.amt; }
  }
  return b;
}

/* ───────────── small shared pieces ───────────── */
const Seg = ({ value, options, onPick }) => (
  <div className="seg">
    {options.map(([x, l]) => (
      <button key={l} className={value === x ? 'on' : ''} onClick={() => onPick(x)}>{l}</button>
    ))}
  </div>
);

const MonthSwitch = ({ m, onShift }) => (
  <div className="mon">
    <button onClick={() => onShift(-1)}><Icon n="l" /></button>
    <b>{fM(m)}</b>
    <button onClick={() => onShift(1)}><Icon n="r" /></button>
  </div>
);

function ExpenseRow({ e, onOpen }) {
  const [em, c] = CAT[e.cat];
  return (
    <button className="ri" onClick={() => onOpen(e.id)}>
      <i className="ic" style={{ '--c': c }}>{em}</i>
      <span className="nm">
        <b>{e.desc}</b>
        <small>{e.cat}{e.acct ? ' · ' + ACC[e.acct][0] : ''}{e.rec ? ' · Recurring' : ''}</small>
      </span>
      {e.amt == null ? <em className="na">Add amount</em> : <b className="am">−{M(e.amt)}</b>}
    </button>
  );
}

function Sheet({ onClose, children }) {
  return (
    <div className="ov" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sh"><div className="grab" />{children}</div>
    </div>
  );
}

/* ───────────── screens ───────────── */
function Home({ S, onShift, onTab, onBudget, onOpen, onSettings }) {
  const t = tot(S, S.m), p = tot(S, shift(S.m, -1)), b = S.bud[S.m] || 0, d = t - p;
  const list = monthExp(S);
  const by = {};
  list.forEach(e => { if (e.amt != null) by[e.cat] = (by[e.cat] || 0) + e.amt; });
  const cs = Object.entries(by).sort((x, y) => y[1] - x[1]);
  const nx = S.rec.filter(r => r.on).sort((x, y) => x.next.localeCompare(y.next))[0];
  const h = new Date().getHours();

  return (
    <>
      <div className="bar2">
        <div className="brand">
          <span className="bm"><svg viewBox="0 0 64 64"><path d="M22 43 43 22M28 22h15v15" /></svg></span>Spend
        </div>
        <button className="av" aria-label="Settings" onClick={onSettings}>S</button>
      </div>

      <div className="hd">
        <div>
          <small>{h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}</small>
          <h1>{fM(S.m)}</h1>
        </div>
        <div className="mn">
          <button aria-label="Previous month" onClick={() => onShift(-1)}><Icon n="l" /></button>
          <button aria-label="Next month" onClick={() => onShift(1)}><Icon n="r" /></button>
        </div>
      </div>

      <section className="hero">
        <div className="row">
          <span>Spent this month</span>
          {p ? <span className="chip">{d > 0 ? '▲' : '▼'} {M(Math.abs(d))} vs last</span> : null}
        </div>
        <div className="big">{M(t)}</div>
        {b ? (
          <>
            <div className="bar"><i style={{ width: Math.min(100, t / b * 100) + '%' }} /></div>
            <div className="row">
              <span>{t <= b ? M(b - t) + ' left' : M(t - b) + ' over budget'}</span>
              <span>of {M(b)}</span>
            </div>
          </>
        ) : <button className="ghost" onClick={onBudget}>Set a monthly budget</button>}
      </section>

      <div className="mini">
        <div className="card"><small>Top category</small><b>{cs[0] ? CAT[cs[0][0]][0] + ' ' + cs[0][0] : '—'}</b></div>
        <div className="card"><small>Next recurring</small><b>{nx ? nx.desc + ' · ' + dayMonth(nx.next) : 'Nothing due'}</b></div>
      </div>

      {cs.length > 0 && (
        <div className="card">
          <h2>Where it went</h2>
          <div className="stack">
            {cs.map(([c, v]) => <i key={c} style={{ width: v / t * 100 + '%', background: CAT[c][1] }} />)}
          </div>
          {cs.slice(0, 4).map(([c, v]) => (
            <div className="leg" key={c}>
              <span className="dot" style={{ '--c': CAT[c][1] }} />
              <span>{c}</span>
              <b>{M(v)}</b>
              <em>{Math.round(v / t * 100)}%</em>
            </div>
          ))}
        </div>
      )}

      <div className="sec"><h2>Recent</h2><button onClick={() => onTab('activity')}>See all</button></div>
      <div className="card" style={{ margin: 0, padding: '6px 14px' }}>
        {list.length
          ? list.slice(0, 5).map(e => <ExpenseRow key={e.id} e={e} onOpen={onOpen} />)
          : <div className="emp">No expenses yet.<br />Tap + to add your first.</div>}
      </div>
    </>
  );
}

function Activity({ S, q, setQ, cf, setCf, onShift, onOpen }) {
  const l = monthExp(S).filter(e => (!cf || e.cat === cf) && (!q || e.desc.toLowerCase().includes(q.toLowerCase())));
  const g = {};
  l.forEach(e => (g[e.date] = g[e.date] || []).push(e));

  return (
    <>
      <div className="top"><h1>Activity</h1></div>
      <MonthSwitch m={S.m} onShift={onShift} />
      <label className="srch">
        <Icon n="s" />
        <input placeholder="Search expenses" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      <div className="chips">
        <button className={cf ? '' : 'on'} onClick={() => setCf('')}>All</button>
        {Object.keys(CAT).map(c => (
          <button key={c} className={cf === c ? 'on' : ''} onClick={() => setCf(c)}>{CAT[c][0]} {c}</button>
        ))}
      </div>
      <div>
        {!l.length ? <div className="emp">Nothing matches.</div> : Object.keys(g).sort().reverse().map(d => (
          <Fragment key={d}>
            <div className="day">
              <span>{d === ld() ? 'Today' : fD(d)}</span>
              <span>{M(g[d].reduce((a, e) => a + (e.amt || 0), 0))}</span>
            </div>
            <div className="card" style={{ margin: '6px 0 0', padding: '4px 14px' }}>
              {g[d].map(e => <ExpenseRow key={e.id} e={e} onOpen={onOpen} />)}
            </div>
          </Fragment>
        ))}
      </div>
    </>
  );
}

function Accounts({ S, onTx }) {
  const b1 = bal(S, 'bkash'), b2 = bal(S, 'bank');
  const act = [
    ...S.exp.filter(e => e.acct && e.amt != null).map(e => ({ d: e.date, t: e.desc, a: -e.amt, k: ACC[e.acct][0] })),
    ...S.tx.map(t => ({
      d: t.date,
      t: t.note || ({ income: 'Income', transfer: 'Transfer', adjust: 'Adjustment' })[t.type],
      a: t.type === 'transfer' ? t.amt : t.type === 'adjust' && t.dir === 'down' ? -t.amt : t.amt,
      k: t.type === 'transfer' ? ACC[t.acct][0] + ' → ' + ACC[t.to][0] : ACC[t.acct][0],
    })),
  ].sort((a, b) => b.d.localeCompare(a.d)).slice(0, 8);

  return (
    <>
      <div className="top"><h1>Accounts</h1></div>
      <div className="card" style={{ margin: 0 }}>
        <small className="lbl">Total balance</small>
        <div className="big" style={{ margin: '4px 0 0' }}>{M(b1 + b2)}</div>
      </div>

      <div className="two">
        {[['bkash', b1], ['bank', b2]].map(([i, v]) => (
          <div key={i} className="acc" style={{ background: `linear-gradient(145deg,${ACC[i][1]},color-mix(in srgb,${ACC[i][1]} 75%,#000))` }}>
            <div className="al">
              <span className={'lg ' + i}>{i === 'bkash' ? <img src={BK} alt="" /> : <Icon n="bank" />}</span>
              <small>{ACC[i][0]}</small>
            </div>
            <div className="big">{M(v)}</div>
          </div>
        ))}
      </div>

      <div className="acts">
        {[['income', 'inc', 'Income'], ['transfer', 'tr', 'Transfer'], ['adjust', 'adj', 'Adjust']].map(([t, i, l]) => (
          <button key={t} onClick={() => onTx(t)}><Icon n={i} />{l}</button>
        ))}
      </div>

      <div className="sec"><h2>Account activity</h2></div>
      <div className="card" style={{ margin: 0, padding: '6px 14px' }}>
        {act.map((x, i) => (
          <div className="ri" key={i}>
            <span className="nm"><b>{x.t}</b><small>{x.k} · {fD(x.d)}</small></span>
            <b className="am" style={{ color: x.a > 0 ? 'var(--g)' : 'inherit' }}>{x.a > 0 ? '+' : '−'}{M(Math.abs(x.a))}</b>
          </div>
        ))}
      </div>
    </>
  );
}

function Plans({ S, plan, setPlan, onShift, onBudget, onAddRec, onToggleRec, onRemoveRec }) {
  const b = S.bud[S.m] || 0, t = tot(S, S.m), pc = b ? t / b : 0, C = 2 * Math.PI * 62;
  const act = S.rec.filter(r => r.on);
  const est = act.reduce((a, r) => a + r.amt * (r.iv === 'weekly' ? 4 : 1), 0);

  const budget = (
    <>
      <MonthSwitch m={S.m} onShift={onShift} />
      <div className="card" style={{ marginTop: 0, textAlign: 'center' }}>
        {b ? (
          <>
            <div className="ring">
              <svg viewBox="0 0 150 150" style={{ width: 190, height: 190, transform: 'rotate(-90deg)' }}>
                <circle cx="75" cy="75" r="62" stroke="var(--line)" strokeWidth="14" />
                <circle cx="75" cy="75" r="62" stroke={pc > 1 ? 'var(--bad)' : 'var(--g)'} strokeWidth="14"
                  strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(pc, 1))} />
              </svg>
              <b>{Math.round(pc * 100)}%<small>used</small></b>
            </div>
            <div className="two" style={{ marginTop: 8 }}>
              <div><small className="lbl">Spent</small><div style={{ fontSize: 19, fontWeight: 800 }}>{M(t)}</div></div>
              <div><small className="lbl">Limit</small><div style={{ fontSize: 19, fontWeight: 800 }}>{M(b)}</div></div>
            </div>
            <p className="hint" style={{ marginTop: 14 }}>
              {t <= b ? M(b - t) + ' left — you’re within your limit.' : M(t - b) + ' over — spending is above your limit.'}
            </p>
          </>
        ) : <div className="emp">No budget for this month yet.</div>}
        <button className="btn" onClick={onBudget}>{b ? 'Edit budget' : 'Set monthly budget'}</button>
      </div>
    </>
  );

  const recurring = (
    <>
      <div className="two">
        <div className="card" style={{ margin: 0 }}>
          <small className="lbl">Active</small>
          <div className="big" style={{ fontSize: 30, margin: '2px 0 0' }}>{act.length}</div>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <small className="lbl">Monthly est.</small>
          <div className="big" style={{ fontSize: 26, margin: '6px 0 0' }}>{M(est)}</div>
        </div>
      </div>
      <div className="card" style={{ padding: '6px 14px' }}>
        {S.rec.length ? S.rec.map(r => (
          <div className="ri" key={r.id} style={{ opacity: r.on ? 1 : 0.55 }}>
            <i className="ic" style={{ '--c': CAT[r.cat][1] }}>{CAT[r.cat][0]}</i>
            <span className="nm">
              <b>{r.desc}</b>
              <small>
                {r.on ? (r.iv === 'weekly' ? 'Weekly' : 'Monthly') + ' · next ' + dayMonth(r.next) : 'Paused'} · {M(r.amt)}
              </small>
            </span>
            <button className={'sw ' + (r.on ? 'on' : '')} aria-label="Pause or resume" onClick={() => onToggleRec(r.id)} />
            <button className="remove-rec" aria-label="Remove" onClick={() => onRemoveRec(r.id)}>×</button>
          </div>
        )) : <div className="emp">No recurring expenses.</div>}
      </div>
      <button className="btn" onClick={onAddRec}>Add recurring expense</button>
    </>
  );

  return (
    <>
      <div className="top"><h1>Plans</h1></div>
      <div className="seg" style={{ marginBottom: 14, background: 'var(--card)' }}>
        <button className={plan === 'budget' ? 'on' : ''} onClick={() => setPlan('budget')}>Budget</button>
        <button className={plan === 'rec' ? 'on' : ''} onClick={() => setPlan('rec')}>Recurring</button>
      </div>
      {plan === 'budget' ? budget : recurring}
    </>
  );
}

/* ───────────── sheets ───────────── */
function AddSheet({ iv, onSave, onClose }) {
  const [f, setF] = useState({ amt: '', desc: '', cat: 'Food', date: ld(), acct: '', iv: iv || 'none' });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const custom = f.date !== ld() && f.date !== ago(1);

  return (
    <Sheet onClose={onClose}>
      <h3>New expense</h3>
      <div className="amt">
        <span>৳</span>
        <input inputMode="decimal" placeholder="0" value={f.amt} onChange={e => set('amt', e.target.value)} />
      </div>
      <p className="hint">{f.iv === 'none' ? 'Leave the amount blank to fill it in later.' : 'Recurring expenses need an amount.'}</p>

      <span className="lbl">What was it for?</span>
      <input className="in" maxLength={80} placeholder="e.g. Lunch" value={f.desc} onChange={e => set('desc', e.target.value)} />

      <span className="lbl">Category</span>
      <div className="cg">
        {Object.keys(CAT).map(c => (
          <button key={c} className={f.cat === c ? 'on' : ''} onClick={() => set('cat', c)}>{CAT[c][0]} {c}</button>
        ))}
      </div>

      <span className="lbl">Date</span>
      <div className="seg">
        <button className={f.date === ld() ? 'on' : ''} onClick={() => set('date', ld())}>Today</button>
        <button className={f.date === ago(1) ? 'on' : ''} onClick={() => set('date', ago(1))}>Yesterday</button>
        <input type="date" className={custom ? 'on' : ''} value={f.date}
          onChange={e => { if (e.target.value) set('date', e.target.value); }} />
      </div>

      <span className="lbl">Paid from</span>
      <Seg value={f.acct} onPick={v => set('acct', v)} options={[['', 'Cash'], ['bkash', 'bKash'], ['bank', 'Bank']]} />

      <span className="lbl">Repeat</span>
      <Seg value={f.iv} onPick={v => set('iv', v)} options={[['none', 'Once'], ['weekly', 'Weekly'], ['monthly', 'Monthly']]} />

      <button className="btn" onClick={() => onSave(f)}>Add expense</button>
    </Sheet>
  );
}

function TxSheet({ type, onSave, onClose }) {
  const [g, setG] = useState({ type, amt: '', acct: 'bank', dir: 'up', note: '' });
  const set = (k, v) => setG(x => ({ ...x, [k]: v }));
  const tr = g.type === 'transfer';

  return (
    <Sheet onClose={onClose}>
      <h3>Account activity</h3>
      <Seg value={g.type} onPick={v => set('type', v)} options={[['income', 'Income'], ['transfer', 'Transfer'], ['adjust', 'Adjust']]} />
      <div className="amt">
        <span>৳</span>
        <input inputMode="decimal" placeholder="0" value={g.amt} onChange={e => set('amt', e.target.value)} />
      </div>

      <span className="lbl">{tr ? 'From' : 'Account'}</span>
      <Seg value={g.acct} onPick={v => set('acct', v)} options={[['bkash', 'bKash'], ['bank', 'Bank']]} />
      {tr && <p className="hint" style={{ marginTop: 10 }}>→ to {g.acct === 'bank' ? 'bKash' : 'Bank'}</p>}

      {g.type === 'adjust' && (
        <>
          <span className="lbl">Correction</span>
          <Seg value={g.dir} onPick={v => set('dir', v)} options={[['up', 'Increase'], ['down', 'Decrease']]} />
        </>
      )}

      <span className="lbl">Note</span>
      <input className="in" maxLength={80} placeholder="e.g. Salary, cash deposit" value={g.note} onChange={e => set('note', e.target.value)} />
      <button className="btn" onClick={() => onSave(g)}>Save</button>
    </Sheet>
  );
}

function DetailSheet({ e, onSave, onDelete, onClose }) {
  const [v, setV] = useState(e.amt ?? '');
  return (
    <Sheet onClose={onClose}>
      <h3>{e.desc}</h3>
      <p className="hint" style={{ textAlign: 'left' }}>{e.cat} · {fD(e.date)}{e.acct ? ' · ' + ACC[e.acct][0] : ''}</p>
      <div className="amt">
        <span>৳</span>
        <input inputMode="decimal" placeholder="0" value={v} onChange={x => setV(x.target.value)} />
      </div>
      <button className="btn" onClick={() => onSave(e.id, parseFloat(v))}>Save amount</button>
      <button className="btn del" onClick={() => onDelete(e.id)}>Delete expense</button>
    </Sheet>
  );
}

function BudgetSheet({ S, onSave, onClear, onClose }) {
  const [v, setV] = useState(S.bud[S.m] || '');
  return (
    <Sheet onClose={onClose}>
      <h3>Monthly budget</h3>
      <p className="hint" style={{ textAlign: 'left' }}>{fM(S.m)}</p>
      <div className="amt">
        <span>৳</span>
        <input inputMode="decimal" placeholder="20000" value={v} onChange={x => setV(x.target.value)} />
      </div>
      <button className="btn" onClick={() => onSave(parseFloat(v))}>Save budget</button>
      {S.bud[S.m] ? <button className="btn del" onClick={onClear}>Clear budget</button> : null}
    </Sheet>
  );
}

function SettingsSheet({ S, onTheme, onReminder, onSignIn, onAdvanced, onClose }) {
  const dark = S.theme === 'dark';
  return (
    <Sheet onClose={onClose}>
      <h3>Settings</h3>
      <div className="ri">
        <i className="ic" style={{ '--c': '#2f7a5a' }}>S</i>
        <span className="nm"><b>Local profile</b><small>Data stays on this device</small></span>
      </div>
      <button className="ri" onClick={onTheme}>
        <span className="nm"><b>Dark mode</b><small>{dark ? 'On' : 'Off'}</small></span>
        <span className={'sw ' + (dark ? 'on' : '')} />
      </button>
      <div className="ri">
        <span className="nm"><b>Daily reminder</b><small>For recurring payments</small></span>
        <input type="time" className="in" style={{ width: 'auto' }} value={S.rt} onChange={e => onReminder(e.target.value)} />
      </div>
      <button className="ri" onClick={onAdvanced}>
        <span className="nm"><b>More app settings</b><small>Account setup, notifications and backups</small></span>
        <span aria-hidden="true">›</span>
      </button>
      <button className="btn" onClick={onSignIn}>Sign in to sync</button>
    </Sheet>
  );
}

/* The supplied prototype's screen components stay presentational. The app
   supplies its own data and persistence so the mobile design shares the same
   expenses, budgets, accounts, and recurring schedules as the desktop app. */
export default function MobilePrototype({
  S,
  legacyView = false,
  onShift,
  onExpenseSave,
  onAmountSave,
  onExpenseDelete,
  onBudgetSave,
  onBudgetClear,
  onTransactionSave,
  onToggleRec,
  onRemoveRec,
  onTheme,
  onReminder,
  onSignIn,
  onAdvanced,
}) {
  const [tab, setTab] = useState('home');
  const [plan, setPlan] = useState('budget');
  const [q, setQ] = useState('');
  const [cf, setCf] = useState('');
  const [sheet, setSheet] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const timer = useRef();

  const toast = (msg, undo) => {
    clearTimeout(timer.current);
    setToastMsg({ msg, undo });
    timer.current = setTimeout(() => setToastMsg(null), 4200);
  };
  const close = () => setSheet(null);
  const nav = t => { setTab(t); window.scrollTo(0, 0); };
  const openExpense = id => setSheet({ type: 'det', id });
  const openBudget = () => setSheet({ type: 'bud' });
  const detail = sheet?.type === 'det' ? S.exp.find(x => x.id === sheet.id) : null;

  const saveExpense = f => {
    const saved = onExpenseSave({
      description: f.desc.trim() || f.cat,
      amount: f.amt,
      category: f.cat,
      date: f.date,
      account: f.acct,
      interval: f.iv,
    });
    if (!saved) return toast(f.iv !== 'none' && !f.amt ? 'Recurring expenses need an amount.' : 'Check the expense details and try again.');
    close();
    toast('Expense added');
  };
  const saveAmount = (id, value) => {
    if (Number.isFinite(value) && value > 0) onAmountSave(id, value);
    close();
  };
  const deleteExpense = id => {
    const expense = S.exp.find(item => item.id === id);
    const undo = expense ? onExpenseDelete(expense) : undefined;
    close();
    toast('Expense removed', undo);
  };
  const saveBudget = value => {
    if (!Number.isFinite(value) || value <= 0) return toast('Enter a monthly budget.');
    onBudgetSave(value);
    close();
    toast('Budget saved');
  };
  const clearBudget = () => {
    const undo = onBudgetClear();
    close();
    toast('Budget cleared', undo);
  };
  const saveTransaction = value => {
    const saved = onTransactionSave(value);
    if (!saved) return toast('Enter a valid amount.');
    close();
    toast('Saved');
  };
  const removeRecurring = id => {
    const undo = onRemoveRec(id);
    toast('Recurring expense removed', undo);
  };
  const advanced = () => {
    close();
    onAdvanced?.();
  };
  const signIn = () => {
    close();
    onSignIn?.();
  };

  return (
    <div className="mobile-prototype" data-theme={S.theme} hidden={legacyView}>
      <div id="app">
        {tab === 'home' && (
          <Home S={S} onShift={onShift} onTab={nav} onBudget={openBudget} onOpen={openExpense} onSettings={() => setSheet({ type: 'set' })} />
        )}
        {tab === 'activity' && (
          <Activity S={S} q={q} setQ={setQ} cf={cf} setCf={setCf} onShift={onShift} onOpen={openExpense} />
        )}
        {tab === 'accounts' && <Accounts S={S} onTx={t => setSheet({ type: 'tx', t })} />}
        {tab === 'plans' && (
          <Plans S={S} plan={plan} setPlan={setPlan} onShift={onShift} onBudget={openBudget}
            onAddRec={() => setSheet({ type: 'add', iv: 'monthly' })} onToggleRec={onToggleRec} onRemoveRec={removeRecurring} />
        )}
      </div>

      {sheet?.type === 'add' && <AddSheet iv={sheet.iv} onSave={saveExpense} onClose={close} />}
      {sheet?.type === 'tx' && <TxSheet type={sheet.t} onSave={saveTransaction} onClose={close} />}
      {detail && <DetailSheet e={detail} onSave={saveAmount} onDelete={deleteExpense} onClose={close} />}
      {sheet?.type === 'bud' && <BudgetSheet S={S} onSave={saveBudget} onClear={clearBudget} onClose={close} />}
      {sheet?.type === 'set' && (
        <SettingsSheet S={S} onClose={close} onTheme={onTheme} onReminder={onReminder}
          onSignIn={signIn} onAdvanced={advanced} />
      )}

      {toastMsg && (
        <div className="toast">
          {toastMsg.msg}
          {toastMsg.undo && <button onClick={() => { toastMsg.undo(); setToastMsg(null); }}>Undo</button>}
        </div>
      )}

      <div className="tabs">
        <nav aria-label="Main navigation">
          {TABS.map(([t, l]) => t === 'add' ? (
            <button key={t} className="fab" aria-label="Add expense" onClick={() => setSheet({ type: 'add' })}><Icon n="plus" /></button>
          ) : (
            <button key={t} className={'t ' + (tab === t ? 'on' : '')} aria-label={l} onClick={() => nav(t)}>
              <Icon n={t} /><span>{l}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
