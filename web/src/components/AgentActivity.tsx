import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { activityDay, agentLabel, HOUR, offsetDay, type AgentTurn } from '../agent-activity';
import { fetchAgentActivity } from '../api';
import type { Device } from '../devices';
import { PHONE_QUERY, useMedia } from '../phone';
import { Icon } from './Icon';
import { Modal } from './Modal';

const formatDate = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' });
const formatTime = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const formatTimeSeconds = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const time = (value: number) => formatTime.format(value);
function durationLabel(value: number) {
  if (value >= HOUR) return `${(value / HOUR).toFixed(1)} h`;
  if (value >= 60_000) return `${Math.floor(value / 60_000)} 分`;
  return value > 0 && value < 1_000 ? '1 秒未満' : `${Math.round(value / 1_000)} 秒`;
}

type DeviceTurn = AgentTurn & { deviceId: string };
type ActivityData = {
  key: string;
  turns: DeviceTurn[];
  failures: { deviceId: string; message: string }[];
  hasResults: boolean;
};
const agents = ['claude', 'codex'] as const;
const ALL_DEVICES = '*';

export function AgentActivity({ devices, initialDevice, onClose }: { devices: Device[]; initialDevice: string; onClose(): void }) {
  const compact = useMedia(PHONE_QUERY);
  const dateHeading = useRef<HTMLElement>(null);
  const [device, setDevice] = useState(initialDevice);
  const [date, setDate] = useState(() => offsetDay(Date.now()));
  const [period, setPeriod] = useState<1 | 7>(() => compact ? 1 : 7);
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
  const allDevices = device === ALL_DEVICES;
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
  const changePeriod = (value: 1 | 7) => { setPeriod(value); setSelected(null); };
  const showDay = (value: number) => { dateHeading.current?.focus(); setDate(value); changePeriod(1); };
  const move = (amount: number) => { setDate(value => offsetDay(value, amount)); setSelected(null); };
  const refresh = () => { setNow(Date.now()); setSelected(null); setReload(value => value + 1); };
  const total = days.reduce((sum, day) => sum + day.duration, 0);
  const latest = from <= today && today < to;

  return <Modal title="Claude / Codex 稼働表" onClose={onClose} className="activity-modal">
    <div className="activity-content">
      <div className="activity-toolbar">
        <div className="activity-period">
          <div className="activity-segments" role="group" aria-label="表示期間">
            <button className="btn" aria-pressed={period === 1} onClick={() => changePeriod(1)}>日</button>
            <button className="btn" aria-pressed={period === 7} onClick={() => changePeriod(7)}>週</button>
          </div>
          <button className="btn activity-today" disabled={latest} onClick={() => { setDate(offsetDay(Date.now())); refresh(); }}>今日</button>
          <button className="btn activity-control" aria-label="稼働表を更新" title="稼働表を更新" onClick={refresh}><Icon name="refresh" /></button>
        </div>
        <div className="activity-nav">
          <button className="btn activity-control" aria-label="前の期間" onClick={() => move(-period)}><Icon name="chevron-left" /></button>
          <strong ref={dateHeading} tabIndex={-1} aria-live="polite">{formatDate.format(from)}{period === 7 && ` – ${formatDate.format(offsetDay(to, -1))}`}</strong>
          <button className="btn activity-control" aria-label="次の期間" disabled={to > today} onClick={() => move(period)}><Icon name="chevron-right" /></button>
        </div>
        <div className="activity-filters">
          <label className="activity-filter">
            <span>デバイス</span>
            <select value={deviceId} onChange={e => { setDevice(e.target.value); setSelected(null); }}>
              <option value={ALL_DEVICES}>すべて</option>
              {devices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <Icon name="chevron-down" />
          </label>
          <label className="activity-filter">
            <span>エージェント</span>
            <select value={filter} onChange={e => { setFilter(e.target.value as typeof filter); setSelected(null); }}>
              <option value="all">すべて</option>
              {agents.map(agent => <option key={agent} value={agent}>{agentLabel[agent]}</option>)}
            </select>
            <Icon name="chevron-down" />
          </label>
        </div>
      </div>
      <div className="activity-summary">
        {view?.hasResults && <strong>合計 {durationLabel(total)}</strong>}
        {agents.filter(agent => filter === 'all' || filter === agent).map(agent =>
          <span key={agent} className={`activity-key ${agent}`}>{agentLabel[agent]}</span>)}
        {!compact && selected && <span role="status">{agentLabel[selected.agent]} · {selected.project}{allDevices && ` · ${deviceName(selected.deviceId)}`} · {formatDate.format(selected.start)} {time(selected.start)} ～ {formatDate.format(selected.end)} {time(selected.end)}</span>}
      </div>
      {!!view?.failures.length && <ul className="activity-message" role="status">
        {view.failures.map(({ deviceId, message }) => <li key={deviceId}>{deviceName(deviceId)} · {message}</li>)}
      </ul>}
      {!view ? <p className="activity-message" role="status">稼働ログを読み込み中…</p>
        : !view.hasResults ? null
          : compact && period === 7 ? <ActivityWeek days={days} today={today} showDay={showDay} />
          : !days.some(day => day.blocks.length) ? <p className="activity-message">この期間の稼働記録はありません。</p>
          : compact ? <ActivityAgenda day={days[0]} deviceName={deviceName} selected={selected} select={setSelected} />
          : <div className="activity-scroll" tabIndex={0} role="region" aria-label="時間別の稼働記録">
            <div className="activity-grid" style={{ '--activity-days': period } as CSSProperties}>
              {days.map(day => <section key={day.start} className="activity-day" aria-label={formatDate.format(day.start)}>
                <div className="activity-day-head">
                  <button className="btn" onClick={() => showDay(day.start)}>{formatDate.format(day.start)}</button>
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
    </div>
  </Modal>;
}

type ActivityDay = ReturnType<typeof activityDay<DeviceTurn>> & { start: number; end: number };

function ActivityWeek({ days, today, showDay }: { days: ActivityDay[]; today: number; showDay(day: number): void }) {
  const maximum = Math.max(1, ...days.map(day => day.duration));
  return <ul className="activity-list activity-week" aria-label="日別の作業時間">
    {days.map(day => {
      const durations = { claude: 0, codex: 0 };
      for (const { turn } of day.blocks) {
        durations[turn.agent] += Math.min(day.end, turn.end) - Math.max(day.start, turn.start);
      }
      return <li key={day.start}>
        <button className="activity-week-row" type="button" disabled={day.start > today}
          aria-current={day.start === today ? 'date' : undefined} onClick={() => showDay(day.start)}>
          <span>{formatDate.format(day.start)}</span>
          <span className="activity-week-track" aria-hidden="true">
            {agents.map(agent => <span key={agent} className={agent} style={{ width: `${durations[agent] / maximum * 100}%` }} />)}
          </span>
          <strong>{day.duration ? durationLabel(day.duration) : '—'}</strong>
          <Icon name="chevron-right" />
        </button>
      </li>;
    })}
  </ul>;
}

function ActivityAgenda({ day, deviceName, selected, select }: {
  day: ActivityDay; deviceName(id: string): string; selected: DeviceTurn | null; select(turn: DeviceTurn | null): void;
}) {
  return <ul className="activity-list activity-agenda" aria-label="作業記録">
    {day.blocks.map(({ turn }, index) => {
      const open = selected === turn;
      const start = Math.max(turn.start, day.start), end = Math.min(turn.end, day.end);
      return <li key={index} className={turn.agent}>
        <button className="activity-agenda-row" type="button" aria-expanded={open} onClick={() => select(open ? null : turn)}>
          <span className="activity-agenda-time">{time(start)}</span>
          <span className="activity-agenda-main">
            <strong>{turn.project}</strong>
            <span>{agentLabel[turn.agent]} · {deviceName(turn.deviceId)}</span>
          </span>
          <span className="activity-agenda-duration">{durationLabel(end - start)}</span>
          <Icon name="chevron-down" />
        </button>
        {open && <p className="activity-agenda-detail" role="status">
          {formatDate.format(turn.start)} {formatTimeSeconds.format(turn.start)} ～ {formatDate.format(turn.end)} {formatTimeSeconds.format(turn.end)}
        </p>}
      </li>;
    })}
  </ul>;
}
