/** Read-only history dialect observed in the reviewed 0.167 native terminal. */
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const text = (v, max = 128) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const require = value => { if (!value) throw Error('The selected native task history did not verify.'); };
const cursor = v => v === null || text(v, 2048);

export function createCodexEditorHistory(sessionId) {
  const turnCursors = new Set(), itemCursors = new Set(), turns = new Set();
  return Object.freeze({
    request(method, params) {
      const turnPage = method === 'thread/turns/list', cursors = turnPage ? turnCursors : itemCursors;
      require((turnPage || method === 'thread/items/list') && exact(params, turnPage ? ['threadId','cursor','limit','sortDirection','itemsView'] : ['threadId','turnId','cursor','limit','sortDirection'])
        && params.threadId === sessionId && Number.isSafeInteger(params.limit) && params.limit >= 1 && params.limit <= 100 && params.sortDirection === 'desc'
        && (turnPage ? params.itemsView === 'notLoaded' : params.turnId === null)
        && (params.cursor === null || cursors.has(params.cursor)));
    },
    response(method, params, result) {
      this.request(method, params);
      require(exact(result, ['data','nextCursor','backwardsCursor']) && Buffer.byteLength(JSON.stringify(result)) <= 1048576
        && Array.isArray(result.data) && result.data.length <= params.limit && cursor(result.nextCursor) && cursor(result.backwardsCursor));
      const turnPage = method === 'thread/turns/list', cursors = turnPage ? turnCursors : itemCursors;
      require(result.data.every(row => object(row) && (row.threadId === undefined || row.threadId === sessionId)
        && (turnPage ? text(row.id) && Array.isArray(row.items) && row.items.length === 0 && row.itemsView === 'notLoaded'
          && ['completed','interrupted','failed','inProgress'].includes(row.status)
          : text(row.turnId) && object(row.item) && text(row.item.id) && text(row.item.type)
            && (row.item.threadId === undefined || row.item.threadId === sessionId))));
      require(new Set(result.data.map(row => turnPage ? row.id : row.turnId + '\0' + row.item.id)).size === result.data.length);
      require(cursors.size <= 4094);
      if (turnPage) {
        require(turns.size + result.data.filter(turn => !turns.has(turn.id)).length <= 4096);
        for (const turn of result.data) turns.add(turn.id);
      }
      for (const value of [result.nextCursor,result.backwardsCursor]) if (value !== null) cursors.add(value);
    }
  });
}
