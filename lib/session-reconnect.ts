/**
 * Whether a sample means the link reconnected since the open session's last
 * sample. Pure, so lib/sessions.ts can apply it inside its transaction and the
 * rule can be tested without a database.
 */

export interface OpenSessionState {
  session_key: string;
  started_at: Date;
  last_seen_at: Date;
  last_tx_counter: number;
  last_rx_counter: number;
}

export interface SessionSample {
  /** Router's identifier for the session, its `last-link-up-time` as text. May be empty. */
  sessionKey: string;
  /** That link-up time converted to server time, when usable. */
  linkUpAt: Date | null;
  txCounter: number;
  rxCounter: number;
  at: Date;
}

/** Clock jitter and a start that was clamped later than the real link-up. */
const SLACK_MS = 60_000;

export function reconnectedSince(session: OpenSessionState, sample: SessionSample): boolean {
  // A sample that is not newer than the last one is a retry or an overtaken
  // request. Its counters describe the past, so they must never be read as
  // evidence that the link reconnected.
  if (sample.at.getTime() <= session.last_seen_at.getTime()) return false;

  const countersReset =
    sample.txCounter < session.last_tx_counter || sample.rxCounter < session.last_rx_counter;

  // The router reporting a link-up later than this session began means the link
  // went down and came back. This is the only signal left when the router sends
  // no session id and the counters did not reset.
  const linkUpInPast = sample.linkUpAt !== null && sample.linkUpAt.getTime() <= sample.at.getTime() + SLACK_MS;
  const relinked = linkUpInPast && sample.linkUpAt!.getTime() > session.started_at.getTime() + SLACK_MS;

  // The key is the link-up time as text in the router's own clock. A router
  // without a battery clock boots with a stale time and has it set by /ip cloud
  // a few pushes later, which rewrites the text of the same link-up. So a new
  // key only counts when the link-up it describes did not stay put.
  const keyChanged = sample.sessionKey !== "" && session.session_key !== sample.sessionKey;
  const sameLinkUp = linkUpInPast && !relinked;

  return countersReset || relinked || (keyChanged && !sameLinkUp);
}
