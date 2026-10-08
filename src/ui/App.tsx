import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { dayToDate, Game, SPEEDS, type Selection, type Snapshot, type Tool } from '../game/Game';
import { formatMoney, setLang, t, useLang } from '../i18n';
import { TRUCK } from '../sim/config';
import { loadModels } from '../render/assets';

const TOOLS: { id: Tool; icon: string; key: string }[] = [
  { id: 'select', icon: '👆', key: '1' },
  { id: 'road', icon: '🛣️', key: '2' },
  { id: 'bulldoze', icon: '🚧', key: '3' },
  { id: 'route', icon: '🚚', key: '4' },
];

export function App() {
  const canvasHost = useRef<HTMLDivElement>(null);
  const labelHost = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let g: Game | null = null;
    let cancelled = false;
    const seed = Number(new URLSearchParams(location.search).get('seed')) || 20261008;
    loadModels((done, total) => setProgress(done / total)).then((models) => {
      if (cancelled) return;
      g = new Game(canvasHost.current!, labelHost.current!, seed, models);
      setGame(g);
      (window as unknown as { game: Game }).game = g; // debug handle
    });
    return () => {
      cancelled = true;
      g?.dispose();
    };
  }, []);

  return (
    <div className="app">
      <div className="viewport" ref={canvasHost} />
      <div className="labels" ref={labelHost} />
      {game ? (
        <Hud game={game} />
      ) : (
        <div className="loading">
          <div>🚚 {t('loading')}</div>
          <div className="bar">
            <div style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function Hud({ game }: { game: Game }) {
  const s = useSyncExternalStore(game.subscribe, game.getSnapshot);
  useLang();
  return (
    <>
      <TopBar game={game} s={s} />
      <Toolbar game={game} s={s} />
      <SidePanel game={game} s={s} />
      {s.selection && <InfoCard game={game} sel={s.selection} />}
      <HintBar s={s} />
      <Toast s={s} />
    </>
  );
}

function TopBar({ game, s }: { game: Game; s: Snapshot }) {
  const date = dayToDate(s.day);
  const lang = useLang();
  return (
    <div className="topbar">
      <div className="brand">🚛 {t('app.title')}</div>
      <div className={`money ${s.money < 0 ? 'is-neg' : ''}`}>💰 {formatMoney(s.money)}</div>
      <div className="date">📅 {t('date.format', { day: date.day, month: date.month, year: date.year })}</div>
      <div className="speeds">
        {SPEEDS.map((sp) => (
          <button
            key={sp}
            className={s.speed === sp ? 'is-on' : ''}
            onClick={() => game.setSpeed(sp)}
            title={sp === 0 ? t('speed.pause') : `${sp}x`}
          >
            {sp === 0 ? '⏸' : '▶'.repeat(Math.min(sp, 3))}
          </button>
        ))}
      </div>
      <button className="lang" onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')}>
        {lang === 'vi' ? 'EN' : 'VI'}
      </button>
    </div>
  );
}

function Toolbar({ game, s }: { game: Game; s: Snapshot }) {
  return (
    <div className="toolbar">
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          className={s.tool === tool.id ? 'is-on' : ''}
          onClick={() => game.setTool(tool.id)}
          title={`${t(`tool.${tool.id}`)} (${tool.key})`}
        >
          <span className="icon">{tool.icon}</span>
          <span className="label">{t(`tool.${tool.id}`)}</span>
          <kbd>{tool.key}</kbd>
        </button>
      ))}
    </div>
  );
}

function SidePanel({ game, s }: { game: Game; s: Snapshot }) {
  const offers = s.contracts.filter((c) => c.status === 'offer');
  const active = s.contracts.filter((c) => c.status === 'active');
  return (
    <div className="side">
      <section>
        <h3>📜 {t('panel.contracts')}</h3>
        {offers.length + active.length === 0 && <p className="muted">{t('panel.noContracts')}</p>}
        {active.length > 0 && <h4>{t('panel.active')}</h4>}
        {active.map((c) => (
          <div key={c.id} className="card contract is-active">
            <div>{t('contract.line', { amount: c.amount, cargo: `cargo.${c.cargo}`, target: buildingKey(game, c.targetId) })}</div>
            <div className="bar">
              <div style={{ width: `${(c.delivered / c.amount) * 100}%` }} />
            </div>
            <div className="row muted">
              <span>
                {c.delivered}/{c.amount}
              </span>
              <span>{t('contract.daysLeft', { days: Math.max(0, c.deadlineDay - s.day) })}</span>
              <span className="good">{t('contract.reward', { reward: c.reward })}</span>
            </div>
          </div>
        ))}
        {offers.length > 0 && <h4>{t('panel.offers')}</h4>}
        {offers.map((c) => (
          <div key={c.id} className="card contract">
            <div>{t('contract.line', { amount: c.amount, cargo: `cargo.${c.cargo}`, target: buildingKey(game, c.targetId) })}</div>
            <div className="row muted">
              <span>{t('contract.duration', { days: c.durationDays })}</span>
              <span className="good">{t('contract.reward', { reward: c.reward })}</span>
            </div>
            <div className="row muted">
              <span>{t('contract.offerLeft', { days: Math.max(0, c.offerExpiresDay - s.day) })}</span>
              <button className="small" onClick={() => game.acceptContract(c.id)}>
                {t('contract.accept')}
              </button>
            </div>
          </div>
        ))}
      </section>

      <section>
        <h3>
          🚚 {t('panel.fleet')} <span className="muted">({s.trucks.length})</span>
        </h3>
        {s.trucks.length === 0 && <p className="muted">{t('panel.noTrucks')}</p>}
        {s.trucks.map((tr) => (
          <button key={tr.id} className="card truck" onClick={() => game.selectTruck(tr.id)}>
            <span className="swatch" style={{ background: `#${tr.color.toString(16).padStart(6, '0')}` }} />
            <span className="truck-text">
              <span>{t('truck.route', { from: tr.fromKey, to: tr.toKey })}</span>
              <span className={`muted ${tr.state === 'stuck' ? 'bad' : ''}`}>
                {t(`state.${tr.state}`)} · {tr.load}/{TRUCK.capacity} {t(`cargo.${tr.cargo}`)}
              </span>
            </span>
          </button>
        ))}
      </section>

      <section className="news">
        <h3>📰 {t('panel.messages')}</h3>
        {[...s.messages]
          .reverse()
          .slice(0, 6)
          .map((m) => (
            <p key={m.id} className={`msg msg--${m.tone}`}>
              {t(m.key, m.params)}
            </p>
          ))}
      </section>
    </div>
  );
}

function buildingKey(game: Game, id: number) {
  return game.sim.building(id)?.nameKey ?? '?';
}

function InfoCard({ game, sel }: { game: Game; sel: Selection }) {
  if (sel.type === 'truck') {
    const tr = sel.truck;
    return (
      <div className="info">
        <button className="close" onClick={() => game.clearSelection()}>
          ✕
        </button>
        <h3>🚚 {t('truck.route', { from: tr.fromKey, to: tr.toKey })}</h3>
        <p className={tr.state === 'stuck' ? 'bad' : ''}>{t(`state.${tr.state}`)}</p>
        <p>
          {t(`cargo.${tr.cargo}`)}: {tr.load}/{TRUCK.capacity}
        </p>
        <p className="good">{t('truck.earned', { money: tr.earned, trips: tr.trips })}</p>
        <button className="small danger" onClick={() => game.sellTruck(tr.id)}>
          {t('truck.sell')}
        </button>
      </div>
    );
  }
  const stock = Object.entries(sel.stock).filter(([, v]) => v !== undefined);
  return (
    <div className="info">
      <button className="close" onClick={() => game.clearSelection()}>
        ✕
      </button>
      <h3>{t(sel.nameKey)}</h3>
      <p className="muted">{t(`kind.${sel.kind}`)}</p>
      {sel.produces && <p>{t('info.produces', { cargo: `cargo.${sel.produces}` })}</p>}
      {sel.accepts.length > 0 && <p>{t('info.accepts', { cargo: sel.accepts.map((c) => t(`cargo.${c}`)).join(', ') })}</p>}
      {stock.length > 0 && (
        <p>
          {t('info.stock')}: {stock.map(([c, v]) => `${t(`cargo.${c}`)} ${Math.floor(v!)}`).join(' · ')}
        </p>
      )}
      <p className={sel.connected ? 'good' : 'bad'}>{sel.connected ? t('info.connected') : t('info.notConnected')}</p>
    </div>
  );
}

function HintBar({ s }: { s: Snapshot }) {
  let hint = t(`hint.${s.tool}`);
  if (s.tool === 'route') {
    hint = s.routeFrom ? t('hint.route.to', { cargo: `cargo.${s.routeFrom.cargo}` }) : t('hint.route.from');
  }
  return (
    <div className="hintbar">
      <div>
        {hint}
        {s.dragCost !== null && (
          <b className={s.dragCost > s.money ? 'bad' : ''}> · {t('hint.cost', { cost: s.dragCost })}</b>
        )}
        {s.tool === 'route' && <b> · {t('hint.cost', { cost: TRUCK.price })}</b>}
      </div>
      <div className="muted">{t('hint.camera')}</div>
    </div>
  );
}

function Toast({ s }: { s: Snapshot }) {
  const [visible, setVisible] = useState<Snapshot['toast']>(null);
  useEffect(() => {
    if (!s.toast) return;
    setVisible(s.toast);
    const timer = setTimeout(() => setVisible(null), 2500);
    return () => clearTimeout(timer);
  }, [s.toast?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!visible) return null;
  return <div className="toast">{visible.text}</div>;
}
