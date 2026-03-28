import { corsHeaders, jsonOk, jsonError } from "../middleware.js";

export async function handleVectorSearch(url, env) {
  try {
    const q = url.searchParams.get("q") || "";
    const limit = parseInt(url.searchParams.get("limit") || "10");
    const projectFilter = url.searchParams.get("project") || "";
    const fromFilter = url.searchParams.get("from") || "";
    const toFilter = url.searchParams.get("to") || "";
    if (!q) return jsonError("q parameter required", 400);

    const embResult = await env.AI.run("@cf/baai/bge-m3", { text: [q] });
    const queryVector = embResult.data[0];
    const vecOptions = { topK: Math.min(limit * 3, 50), returnMetadata: true };
    const matches = await env.VECTORIZE.query(queryVector, vecOptions);

    const results = [];
    for (const match of matches.matches || []) {
      const chunk = await env.DB.prepare(
        "SELECT c.chunk_id, c.session_id, c.chunk_index, c.chunk_summary, c.chunk_checkpoint, c.chunk_topics, c.project, c.turn_start, c.turn_end, s.created_at FROM ext_chunks c JOIN ext_sessions s ON c.session_id = s.session_id WHERE c.chunk_id = ?"
      ).bind(match.id).first();
      if (chunk) {
        if (projectFilter && chunk.project !== projectFilter) continue;
        if (fromFilter && chunk.created_at < fromFilter) continue;
        if (toFilter && chunk.created_at > toFilter + " 23:59:59") continue;
        chunk.score = match.score;
        results.push(chunk);
        if (results.length >= limit) break;
      }
    }
    return jsonOk({ results, total: results.length });
  } catch (e) { return jsonError(e.message); }
}

export async function handleVectorTest(url, env) {
  try {
    const text = url.searchParams.get("q") || "test";
    const embedding = await env.AI.run("@cf/baai/bge-m3", { text: [text] });
    const dims = embedding.data[0].length;
    return jsonOk({ dims, first5: embedding.data[0].slice(0, 5) });
  } catch (e) { return jsonError(e.message); }
}

export async function handleSessionSearch(url, env) {
  try {
    const q = url.searchParams.get("q") || "";
    const project = url.searchParams.get("project") || "";
    const status = url.searchParams.get("status") || "";
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const limit = parseInt(url.searchParams.get("limit") || "30");
    const searchUrl = url.searchParams.get("url") || "";

    let where = [];
    let binds = [];

    if (searchUrl) {
      where.push("s.url = ?"); binds.push(searchUrl);
    } else if (q) {
      where.push("(s.summary LIKE ? OR s.topics LIKE ? OR s.key_decisions LIKE ? OR s.tools LIKE ? OR s.checkpoint LIKE ? OR s.title LIKE ?)");
      for (let i = 0; i < 6; i++) binds.push("%" + q + "%");
    }
    if (project) { where.push("s.project = ?"); binds.push(project); }
    if (status) { where.push("s.status = ?"); binds.push(status); }
    if (from) { where.push("s.created_at >= ?"); binds.push(from); }
    if (to) { where.push("s.created_at <= ?"); binds.push(to + " 23:59:59"); }

    const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";
    const sql = "SELECT s.session_id, s.title, s.source, s.url, s.summary, s.topics, s.key_decisions, s.tools, s.project, s.status, s.checkpoint, s.total_chunks, s.total_turns, s.created_at FROM ext_sessions s " + whereClause + " ORDER BY s.created_at DESC LIMIT ?";
    binds.push(limit);

    const results = await env.DB.prepare(sql).bind(...binds).all();

    let chunkResults = [];
    if (q) {
      const cResults = await env.DB.prepare(
        "SELECT c.chunk_id, c.session_id, c.chunk_index, c.chunk_summary, c.chunk_checkpoint, c.chunk_topics, c.chunk_key_decisions, c.turn_start, c.turn_end FROM ext_chunks c WHERE c.chunk_summary LIKE ? OR c.chunk_checkpoint LIKE ? OR c.chunk_topics LIKE ? OR c.chunk_key_decisions LIKE ? ORDER BY c.session_id, c.chunk_index LIMIT 50"
      ).bind("%" + q + "%", "%" + q + "%", "%" + q + "%", "%" + q + "%").all();
      chunkResults = cResults.results || [];
    }

    return jsonOk({ sessions: results.results || [], chunks: chunkResults, total: (results.results || []).length });
  } catch (e) { return jsonError(e.message); }
}

export async function handleListProjects(env) {
  try {
    const results = await env.DB.prepare(
      "SELECT project, COUNT(*) as cnt FROM ext_sessions WHERE project != '' GROUP BY project ORDER BY cnt DESC"
    ).all();
    return jsonOk(results);
  } catch (e) { return jsonError(e.message); }
}

export async function handleLatestSession(url, env) {
  try {
    const project = url.searchParams.get("project") || "";
    if (!project) return jsonError("project parameter required", 400);
    const result = await env.DB.prepare(
      "SELECT * FROM ext_sessions WHERE project = ? ORDER BY created_at DESC LIMIT 1"
    ).bind(project).first();
    if (!result) return jsonError("No session found", 404);
    const chunks = await env.DB.prepare(
      "SELECT * FROM ext_chunks WHERE session_id = ? ORDER BY chunk_index"
    ).bind(result.session_id).all();
    result.chunks = chunks.results || [];
    return jsonOk(result);
  } catch (e) { return jsonError(e.message); }
}
