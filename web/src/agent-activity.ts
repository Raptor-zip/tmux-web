export interface AgentTurn {
  agent: 'claude' | 'codex';
  project: string;
  start: number;
  end: number;
}

export const HOUR = 3_600_000;
export const agentLabel = { claude: 'Claude', codex: 'Codex' };

export function offsetDay(date: number, offset = 0) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + offset);
  return day.getTime();
}

export function activityDay(turns: AgentTurn[], from: number, to: number) {
  const blocks: { turn: AgentTurn; lane: number; top: number; height: number }[] = [];
  const laneEnds: number[] = [];
  let duration = 0;
  for (const turn of turns) {
    if (turn.end <= from || turn.start >= to) continue;
    const start = Math.max(from, turn.start);
    const end = Math.min(to, turn.end);
    const top = (start - from) / (to - from);
    const height = Math.min(1 - top, Math.max((end - start) / (to - from), 0.01));
    let lane = laneEnds.findIndex(previousEnd => previousEnd <= top);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = top + height;
    blocks.push({ turn, lane, top, height });
    duration += end - start;
  }
  return { blocks, lanes: laneEnds.length || 1, duration };
}
