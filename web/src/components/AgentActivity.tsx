import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { activityDay, agentLabel, HOUR, offsetDay, type AgentTurn } from '../agent-activity';
import { fetchAgentActivity } from '../api';
import type { Device } from '../devices';
import { Icon } from './Icon';
import { Modal } from './Modal';

const formatDate = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' });
const formatTime = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const time = (value: number) => formatTime.format(value);
function durationLabel(value: number) {
  if (value >= HOUR) return `${(value / HOUR).toFixed(1)} h`;
  if (value >= 60_000) return `${Math.floor(value / 60_000)} 分`;
  return `${Math.round(value / 1_000)} 秒`;
}

type DeviceTurn = AgentTurn & { deviceId: string };
type ActivityData = {
  key: string;
  turns: DeviceTurn[];
  failures: { deviceId: string; message: string }[];
  hasResults: boolean;
};
const agents = ['claude', 'codex'] as const;

export function AgentActivity({ devices, initialDevice, onClose }: { devices: Device[]; initialDevice: string; onClose(): void }) {
  const [device, setDevice] = useState(initialDevice);
  const [date, setDate] = useState(() => offsetDay(Date.now()));
  const [period, setPeriod] = useState<1 | 7>(() => window.matchMedia('(max-width: 640px)').matches ? 1 : 7);
  const [filter, setFilter] = useState<'all' | AgentTurn['agent']>('all');
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<DeviceTurn | null>(null);
  const [data, setData] = useState<ActivityData>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = offsetDay(now);
  const from = period === 1 ? date : offsetDay(date, -new Date(date).getDay());
  const to = offsetDay(from, period);
  const allDevices = device === 'all';
  const deviceId = allDevices || devices.some(item => item.id === device) ? device : 'local';
  const targetIds = allDevices ? devices.map(item => item.id).sort().join(',') : deviceId;
  const deviceName = (id: string) => devices.find(item => item.id === id)?.name ?? id;
  const key = `${targetIds}:${from}:${to}:${reload}`;
  useEffect(() => {
    const controller = new AbortController();
    const ids = targetIds.split(',').filter(Boolean);
    Promise.allSettled(ids.map(id => fetchAgentActivity(id, from, to, controller.signal)))
      .then(results => {
        if (controller.signal.aborted) return;
        const failures: ActivityData['failures'] = [];
        const turns: DeviceTurn[] = [];
        results.forEach((result, i) => {
          const deviceId = ids[i];
          if (result.status === 'fulfilled') {
            for (const turn of result.value) turns.push({ ...turn, deviceId });
          } else {
            failures.push({ deviceId, message: result.reason?.message ?? '稼働ログを取得できませんでした。' });
          }
        });
        turns.sort((a, b) => a.start - b.start);
        setData({ key, turns, failures, hasResults: failures.length < results.length });
      });
    return () => controller.abort();
  }, [key, targetIds, from, to]);
  const view = data?.key === key ? data : undefined;
  const days = useMemo(() => {
    const turns = view?.turns.filter(turn => filter === 'all' || turn.agent === filter) ?? [];
    return Array.from({ length: period }, (_, i) => {
      const start = offsetDay(from, i), end = offsetDay(from, i + 1);
      return { start, end, ...activityDay(turns, start, end) };
    });
  }, [filter, from, period, view]);
  const move = (amount: number) => { setDate(value => offsetDay(value, amount)); setSelected(null); };
  const total = days.reduce((sum, day) => sum + day.duration, 0);

  return <Modal title="Claude / Codex 稼働表" onClose={onClose} className="activity-modal">
    <div className="activity-toolbar">
      <div className="activity-nav">
        <button className="btn" aria-label="前の期間" onClick={() => move(-period)}><Icon name="chevron-left" /></button>
        <button className="btn" aria-label="次の期間" disabled={to > today} onClick={() => move(period)}><Icon name="chevron-right" /></button>
        <button className="btn" onClick={() => { setDate(offsetDay(Date.now())); setNow(Date.now()); setSelected(null); setReload(value => value + 1); }}>最新</button>
        <strong>{formatDate.format(from)}{period === 7 && ` – ${formatDate.format(offsetDay(to, -1))}`}</strong>
      </div>
      <div className="activity-filters">
        <div className="activity-nav" role="group" aria-label="表示期間">
          <button className="btn" aria-pressed={period === 7} onClick={() => { setPeriod(7); setSelected(null); }}>週</button>
          <button className="btn" aria-pressed={period === 1} onClick={() => { setPeriod(1); setSelected(null); }}>日</button>
        </div>
        <select aria-label="デバイス" value={deviceId} onChange={e => { setDevice(e.target.value); setSelected(null); }}>
          <option value="all">すべて</option>
          {devices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select aria-label="エージェント" value={filter} onChange={e => { setFilter(e.target.value as typeof filter); setSelected(null); }}>
          <option value="all">すべて</option>
          {agents.map(agent => <option key={agent} value={agent}>{agentLabel[agent]}</option>)}
        </select>
        <button className="btn" aria-label="稼働表を更新" title="稼働表を更新" onClick={() => { setSelected(null); setReload(value => value + 1); }}><Icon name="refresh" /></button>
      </div>
    </div>
    <div className="activity-summary">
      {agents.map(agent => <span key={agent} className={`activity-key ${agent}`}>{agentLabel[agent]}</span>)}
      {view?.hasResults && <strong>合計 {durationLabel(total)}</strong>}
      {selected && <span role="status">{agentLabel[selected.agent]} · {selected.project}{allDevices && ` · ${deviceName(selected.deviceId)}`} · {formatDate.format(selected.start)} {time(selected.start)} ～ {formatDate.format(selected.end)} {time(selected.end)}</span>}
    </div>
    {!!view?.failures.length && <ul className="activity-message" role="status">
      {view.failures.map(({ deviceId, message }) => <li key={deviceId}>{deviceName(deviceId)} · {message}</li>)}
    </ul>}
    {!view ? <p className="activity-message" role="status">稼働ログを読み込み中…</p>
      : !view.hasResults ? null
        : !days.some(day => day.blocks.length) ? <p className="activity-message">この期間の稼働記録はありません。</p>
          : <div className="activity-scroll" tabIndex={0} role="region" aria-label="時間別の稼働記録">
            <div className="activity-grid" style={{ '--activity-days': period } as CSSProperties}>
              {days.map(day => <section key={day.start} className="activity-day" aria-label={formatDate.format(day.start)}>
                <div className="activity-day-head">
                  <button className="btn" onClick={() => { setDate(day.start); setPeriod(1); setSelected(null); }}>{formatDate.format(day.start)}</button>
                  <span>{durationLabel(day.duration)}</span>
                </div>
                <div className="activity-track">
                  {Array.from({ length: Math.ceil((day.end - day.start) / HOUR) }, (_, i) =>
                    <div className="activity-hour" aria-hidden="true" key={i} style={{ top: `${i * HOUR / (day.end - day.start) * 100}%` }}>
                      {time(day.start + i * HOUR)}
                    </div>)}
                  {now >= day.start && now < day.end && <div className="activity-now" aria-hidden="true"
                    style={{ top: `${(now - day.start) / (day.end - day.start) * 100}%` }} />}
                  {day.blocks.map(({ turn, lane, top, height }, i) => {
                    const label = `${agentLabel[turn.agent]} ${turn.project}${allDevices ? ` · ${deviceName(turn.deviceId)}` : ''} ${time(turn.start)} ～ ${time(turn.end)}`;
                    return <button key={i} type="button" className={`activity-turn ${turn.agent}`}
                      aria-label={label} title={label} aria-pressed={selected === turn}
                      style={{ top: `${top * 100}%`, height: `${height * 100}%`, left: `${lane / day.lanes * 100}%`, width: `${100 / day.lanes}%` }}
                      onClick={() => setSelected(turn)}>
                      <span>{time(Math.max(day.start, turn.start))} · {turn.project}{allDevices && ` · ${deviceName(turn.deviceId)}`}</span>
                    </button>;
                  })}
                </div>
              </section>)}
            </div>
          </div>}
    <p className="activity-foot">応答やツール実行の記録から作業時間を推定します。入力待ちと記録の間隔が5分を超える区間を除き、並行作業はそれぞれ加算します。</p>
  </Modal>;
}
