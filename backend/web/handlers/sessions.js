import { corsHeaders, jsonOk, jsonError } from "../middleware.js";

async function vectorizeChunk(env, chunkId, summary, checkpoint, metadata) {
  try {
    const textToEmbed = (summary || "") + " " + (checkpoint || "");
    if (textToEmbed.trim().length <= 10) return;
    const embResult = await env.AI.run("@cf/baai/bge-m3", { text: [textToEmbed] });
    if (embResult && embResult.data && embResult.data[0]) {
      await env.VECTORIZE.upsert([{ id: chunkId, values: embResult.data[0], metadata }]);
    }
  } catch (e) {
    console.error("Vector upsert error:", e.message);
  }
}

export async function handleSaveChunk(request, env) {
  try {
    const body = await request.json();
    const { session_id, url: pageUrl, chunk_index, chunk_summary, chunk_checkpoint, turn_start, turn_end, raw_content, project, frontmatter } = body;
    if (!session_id) return jsonError("session_id required", 400);

    const existing = await env.DB.prepare("SELECT session_id FROM ext_sessions WHERE session_id = ?").bind(session_id).first();
    if (!existing) {
      await env.DB.prepare(
        "INSERT INTO ext_sessions (session_id, url, project, status, summary, topics, key_decisions, tech_stack, total_turns, created_at, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))"
      ).bind(session_id, pageUrl || "", (frontmatter && frontmatter.project) || "in-progress", "진행중", "요약 진행중...", "[]", "[]", "[]", turn_end || 0).run();
    } else {
      await env.DB.prepare(
        "UPDATE ext_sessions SET total_turns = ?, total_chunks = (SELECT COUNT(*) FROM ext_chunks WHERE session_id = ?), project = CASE WHEN ? != '' THEN ? ELSE project END, summary = CASE WHEN ? != '' THEN ? ELSE summary END, synced_at = datetime('now') WHERE session_id = ?"
      ).bind(turn_end || 0, session_id, project || "", project || "", chunk_summary || "", chunk_summary || "", session_id).run();
    }

    const chunkId = session_id + "-chunk-" + chunk_index;
    await env.DB.prepare(
      "INSERT INTO ext_chunks (chunk_id, session_id, chunk_index, chunk_summary, chunk_checkpoint, turn_start, turn_end, raw_content, project) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chunk_id) DO UPDATE SET chunk_summary=excluded.chunk_summary, chunk_checkpoint=excluded.chunk_checkpoint, raw_content=CASE WHEN length(excluded.raw_content) > length(ext_chunks.raw_content) THEN excluded.raw_content ELSE ext_chunks.raw_content END, project=excluded.project"
    ).bind(chunkId, session_id, chunk_index, chunk_summary || "", chunk_checkpoint || "", turn_start || 0, turn_end || 0, raw_content || "", project || "").run();

    await vectorizeChunk(env, chunkId, chunk_summary, chunk_checkpoint, { session_id, chunk_index, project: project || "" });

    return jsonOk({ ok: true, chunk_id: chunkId, chunk_index, vectorized: true });
  } catch (e) { return jsonError(e.message + "\n" + e.stack); }
}

export async function handleSaveSession(request, env) {
  try {
    const data = await request.json();
    const { session_id: clientSessionId, source, title, url: sessionUrl, summary, topics, key_decisions, tools, project, status, checkpoint, chunks, total_turns } = data;
    if (!source) return jsonError("source is required", 400);

    // 클라이언트가 보낸 session_id 우선, 없으면 URL로 검색
    let existing = null;
    if (clientSessionId) {
      existing = await env.DB.prepare("SELECT session_id FROM ext_sessions WHERE session_id = ?").bind(clientSessionId).first();
    }
    if (!existing && sessionUrl) {
      existing = await env.DB.prepare("SELECT session_id FROM ext_sessions WHERE url = ?").bind(sessionUrl).first();
    }

    if (existing) {
      await env.DB.prepare(
        "UPDATE ext_sessions SET summary=?, topics=?, key_decisions=?, tools=?, project=?, status=?, checkpoint=?, total_turns=?, synced_at=datetime('now') WHERE session_id=?"
      ).bind(summary || "", JSON.stringify(topics || []), JSON.stringify(key_decisions || []), JSON.stringify(tools || []), project || "", status || "", checkpoint || "", total_turns || 0, existing.session_id).run();

      if (chunks && chunks.length > 0) {
        for (let i = 0; i < chunks.length; i++) {
          const c = chunks[i];
          const cid = existing.session_id + "-chunk-" + (c.chunk_index || i);
          await env.DB.prepare(
            "INSERT INTO ext_chunks (chunk_id, session_id, chunk_index, turn_start, turn_end, chunk_summary, chunk_checkpoint, chunk_topics, chunk_key_decisions, raw_content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chunk_id) DO UPDATE SET chunk_summary=excluded.chunk_summary, chunk_checkpoint=excluded.chunk_checkpoint, raw_content=CASE WHEN length(excluded.raw_content) > length(ext_chunks.raw_content) THEN excluded.raw_content ELSE ext_chunks.raw_content END"
          ).bind(cid, existing.session_id, c.chunk_index || i, c.turn_start || 0, c.turn_end || 0, c.summary || "", c.checkpoint || "", JSON.stringify(c.topics || []), JSON.stringify(c.key_decisions || []), c.raw_content || "").run();
          await vectorizeChunk(env, cid, c.summary, c.checkpoint, { session_id: existing.session_id, chunk_index: c.chunk_index || i, project: project || "" });
        }
      }
      return jsonOk({ ok: true, session_id: existing.session_id, chunks_saved: chunks ? chunks.length : 0, reused: true });
    }

    const sessionId = clientSessionId || crypto.randomUUID();
    const totalChunks = chunks ? chunks.length : 0;

    await env.DB.prepare(
      "INSERT INTO ext_sessions (session_id, title, source, url, summary, topics, key_decisions, tools, project, status, checkpoint, total_chunks, total_turns) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(sessionId, title || "Untitled", source, sessionUrl || "", summary || "", JSON.stringify(topics || []), JSON.stringify(key_decisions || []), JSON.stringify(tools || []), project || "", status || "진행중", checkpoint || "", totalChunks, total_turns || 0).run();

    if (chunks && chunks.length > 0) {
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const cid = clientSessionId ? (clientSessionId + "-chunk-" + i) : crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO ext_chunks (chunk_id, session_id, chunk_index, turn_start, turn_end, chunk_summary, chunk_checkpoint, chunk_topics, chunk_key_decisions, raw_content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chunk_id) DO UPDATE SET chunk_summary=excluded.chunk_summary, chunk_checkpoint=excluded.chunk_checkpoint, raw_content=CASE WHEN length(excluded.raw_content) > length(ext_chunks.raw_content) THEN excluded.raw_content ELSE ext_chunks.raw_content END"
          ).bind(cid, sessionId, i, c.turn_start || 0, c.turn_end || 0, c.summary || "", c.checkpoint || "", JSON.stringify(c.topics || []), JSON.stringify(c.key_decisions || []), c.raw_content || "").run();
        await vectorizeChunk(env, sessionId + "-chunk-" + i, c.summary, c.checkpoint, { session_id: sessionId, chunk_index: i, project: project || "" });
      }
    }

    return jsonOk({ ok: true, session_id: sessionId, chunks_saved: totalChunks });
  } catch (e) { return jsonError(e.message); }
}

export async function handleListSessions(url, env) {
  try {
    const limit = parseInt(url.searchParams.get("limit") || "30");
    const results = await env.DB.prepare(
      "SELECT session_id, title, source, summary, project, status, total_chunks, total_turns, created_at FROM ext_sessions ORDER BY created_at DESC LIMIT ?"
    ).bind(limit).all();
    return jsonOk(results);
  } catch (e) { return jsonError(e.message); }
}

export async function handleGetSession(url, env) {
  try {
    const sid = decodeURIComponent(url.pathname.replace("/api/session/", ""));
    const session = await env.DB.prepare("SELECT * FROM ext_sessions WHERE session_id = ?").bind(sid).first();
    if (!session) return jsonError("Not found", 404);
    const chunks = await env.DB.prepare("SELECT * FROM ext_chunks WHERE session_id = ? ORDER BY chunk_index").bind(sid).all();
    session.chunks = chunks.results || [];
    return jsonOk(session);
  } catch (e) { return jsonError(e.message); }
}

export async function handleSaveSnap(request, env) {
  try {
    const body = await request.json();
    const { session_id, snapshot } = body;
    if (!session_id || !snapshot) return jsonError("session_id and snapshot required", 400);
    await env.DB.prepare("UPDATE ext_sessions SET checkpoint = ?, updated_at = datetime('now') WHERE session_id = ?").bind(snapshot, session_id).run();
    return jsonOk({ ok: true, session_id, snapshot_length: snapshot.length });
  } catch (e) { return jsonError(e.message); }
}
