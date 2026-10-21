/** ペイン ID → claude.ai のセッション URL。起動監視やペイン走査で拾えたものを覚えておく。 */
export const rcUrls = new Map();
/** 起動直後のセッションの進捗メッセージ（UI のトースト表示用）。ペイン ID をキーにする。 */
export const spawnNotes = new Map();
export function note(paneId, text) {
    spawnNotes.set(paneId, { at: Date.now(), text });
}
