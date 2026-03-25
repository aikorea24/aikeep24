export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, DELETE", "Access-Control-Allow-Headers": "Content-Type, Authorization" }
      });
    }

    const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(HTML_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    const auth = request.headers.get("Authorization");
    if (auth !== `Bearer ${env.API_KEY}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    async function getUniqueName(db, fileName, content) {
      const existing = await db.prepare("SELECT file_name, content FROM notes WHERE file_name = ?").bind(fileName).first();
      if (!existing) return fileName;
      if (existing.content && existing.content.trim() === content.trim()) return fileName;
      const base = fileName.replace(/\.md$/, "");
      const rows = await db.prepare("SELECT file_name FROM notes WHERE file_name LIKE ?").bind(base + "%").all();
      const names = new Set((rows.results || []).map(r => r.file_name));
      let n = 1; let newName;
      do { newName = base + "-" + n + ".md"; n++; } while (names.has(newName));
      return newName;
    }

    if (url.pathname === "/api/upload" && request.method === "POST") {
      try {
        let { file_name, title, date, tags, frontmatter, content, folder } = await request.json();
        if (!file_name || !content) return Response.json({ error: "file_name과 content 필수" }, { status: 400, headers: corsHeaders });
        if (folder) file_name = folder + "/" + file_name;
        const uniqueName = await getUniqueName(env.DB, file_name, content);
        const finalTitle = title || uniqueName.replace(/\.md$/, "").split("/").pop();
        await env.DB.prepare(
          "INSERT INTO notes (file_name, title, date, tags, frontmatter, content, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(file_name) DO UPDATE SET title=excluded.title, date=excluded.date, tags=excluded.tags, frontmatter=excluded.frontmatter, content=excluded.content, synced_at=datetime('now')"
        ).bind(uniqueName, finalTitle, date || "", tags || "", frontmatter || "", content).run();
        const renamed = uniqueName !== file_name;
        return Response.json({ ok: true, file_name: uniqueName, renamed, original: renamed ? file_name : undefined }, { headers: corsHeaders });
      } catch (e) { return Response.json({ error: e.message }, { status: 500, headers: corsHeaders }); }
    }

    if (url.pathname === "/api/search" && request.method === "GET") {
      const q = url.searchParams.get("q") || "";
      const results = await env.DB.prepare(
        "SELECT file_name, title, date, tags, substr(content, 1, 200) as preview FROM notes WHERE content LIKE ? OR title LIKE ? ORDER BY synced_at DESC LIMIT 30"
      ).bind(`%${q}%`, `%${q}%`).all();
      return Response.json(results, { headers: corsHeaders });
    }

    if (url.pathname === "/api/notes" && request.method === "GET") {
      const results = await env.DB.prepare(
        "SELECT file_name, title, date, tags, synced_at FROM notes ORDER BY synced_at DESC LIMIT 50"
      ).all();
      return Response.json(results, { headers: corsHeaders });
    }

    if (url.pathname.startsWith("/api/noteid/") && request.method === "GET") {
      try {
        const nid = parseInt(url.pathname.replace("/api/noteid/", ""));
        const note = await env.DB.prepare("SELECT * FROM notes WHERE id = ?").bind(nid).first();
        if (!note) return Response.json({ error: "Not found id" }, { status: 404, headers: corsHeaders });
        return Response.json(note, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname.startsWith("/api/note/") && request.method === "GET") {
      const fname = decodeURIComponent(url.pathname.replace("/api/note/", ""));
      const result = await env.DB.prepare("SELECT * FROM notes WHERE file_name = ?").bind(fname).first();
      if (!result) return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
      return Response.json(result, { headers: corsHeaders });
    }

    if (url.pathname.startsWith("/api/note/") && request.method === "DELETE") {
      const fname = decodeURIComponent(url.pathname.replace("/api/note/", ""));
      await env.DB.prepare("DELETE FROM notes WHERE file_name = ?").bind(fname).run();
      return Response.json({ ok: true, deleted: fname }, { headers: corsHeaders });
    }

    // === Context Keeper: Session API ===

      if (url.pathname === "/api/vector-search" && request.method === "GET") {
      try {
        const q = url.searchParams.get("q") || "";
        const limit = parseInt(url.searchParams.get("limit") || "10");
        const projectFilter = url.searchParams.get("project") || "";
        const fromFilter = url.searchParams.get("from") || "";
        const toFilter = url.searchParams.get("to") || "";
        if (!q) return Response.json({ error: "q parameter required" }, { status: 400, headers: corsHeaders });

        const embResult = await env.AI.run("@cf/baai/bge-m3", { text: [q] });
        const queryVector = embResult.data[0];

        const vecOptions = { topK: Math.min(limit * 3, 50), returnMetadata: true };
        const matches = await env.VECTORIZE.query(queryVector, vecOptions);

        const results = [];
        for (const match of matches.matches || []) {
          const chunk = await env.DB.prepare("SELECT c.chunk_id, c.session_id, c.chunk_index, c.chunk_summary, c.chunk_checkpoint, c.chunk_topics, c.project, c.turn_start, c.turn_end, s.created_at FROM ext_chunks c JOIN ext_sessions s ON c.session_id = s.session_id WHERE c.chunk_id = ?").bind(match.id).first();
          if (chunk) {
            if (projectFilter && chunk.project !== projectFilter) continue;
            if (fromFilter && chunk.created_at < fromFilter) continue;
            if (toFilter && chunk.created_at > toFilter + " 23:59:59") continue;
            chunk.score = match.score;
            results.push(chunk);
            if (results.length >= limit) break;
          }
        }
        return Response.json({ results: results, total: results.length }, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === "/api/vector-test" && request.method === "GET") {
      try {
        const text = url.searchParams.get("q") || "test";
        const embedding = await env.AI.run("@cf/baai/bge-m3", { text: [text] });
        const dims = embedding.data[0].length;
        return Response.json({ dims: dims, first5: embedding.data[0].slice(0,5) }, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === "/api/session/chunk" && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/api/session/chunk" && request.method === "POST") {
      try {
      const body = await request.json();
      const { session_id, url: pageUrl, chunk_index, chunk_summary, chunk_checkpoint, turn_start, turn_end, raw_content, project, frontmatter } = body;
      if (!session_id) return Response.json({ error: "session_id required" }, { status: 400, headers: corsHeaders });

      const existing = await env.DB.prepare("SELECT session_id FROM ext_sessions WHERE session_id = ?").bind(session_id).first();
      if (!existing) {
        await env.DB.prepare(
          "INSERT INTO ext_sessions (session_id, url, project, status, summary, topics, key_decisions, tech_stack, total_turns, created_at, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))"
        ).bind(session_id, pageUrl || "", (frontmatter && frontmatter.project) || "in-progress", "진행중", "요약 진행중...", "[]", "[]", "[]", turn_end || 0).run();
      } else {
        await env.DB.prepare("UPDATE ext_sessions SET total_turns = ?, total_chunks = (SELECT COUNT(*) FROM ext_chunks WHERE session_id = ?), project = CASE WHEN ? != '' THEN ? ELSE project END, summary = CASE WHEN ? != '' THEN ? ELSE summary END, synced_at = datetime('now') WHERE session_id = ?").bind(turn_end || 0, project || "", project || "", chunk_summary || "", chunk_summary || "", session_id).run();
      }

      const chunkId = session_id + "-chunk-" + chunk_index;
      await env.DB.prepare(
        "INSERT INTO ext_chunks (chunk_id, session_id, chunk_index, chunk_summary, chunk_checkpoint, turn_start, turn_end, raw_content, project) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chunk_id) DO UPDATE SET chunk_summary=excluded.chunk_summary, chunk_checkpoint=excluded.chunk_checkpoint, raw_content=CASE WHEN length(excluded.raw_content) > length(ext_chunks.raw_content) THEN excluded.raw_content ELSE ext_chunks.raw_content END, project=excluded.project"
      ).bind(chunkId, session_id, chunk_index, chunk_summary || "", chunk_checkpoint || "", turn_start || 0, turn_end || 0, raw_content || "", project || "").run();

      // Vector embedding
      try {
        const textToEmbed = (chunk_summary || "") + " " + (chunk_checkpoint || "");
        if (textToEmbed.trim().length > 10) {
          const embResult = await env.AI.run("@cf/baai/bge-m3", { text: [textToEmbed] });
          if (embResult && embResult.data && embResult.data[0]) {
            await env.VECTORIZE.upsert([{
              id: chunkId,
              values: embResult.data[0],
              metadata: { session_id: session_id, chunk_index: chunk_index, project: project || "" }
            }]);
          }
        }
      } catch (vecErr) {
        console.error("Vector upsert error:", vecErr.message);
      }

      return Response.json({ ok: true, chunk_id: chunkId, chunk_index: chunk_index, vectorized: true }, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ error: e.message, stack: e.stack }, { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === "/api/session" && request.method === "POST") {
        try {
          const data = await request.json();
          const { source, title, url: sessionUrl, summary, topics, key_decisions, tools, project, status, checkpoint, chunks, total_turns } = data;

          if (!source) return Response.json({ error: "source is required" }, { status: 400, headers: corsHeaders });

          if (sessionUrl) {
            const existing = await env.DB.prepare("SELECT session_id FROM ext_sessions WHERE url = ?").bind(sessionUrl).first();
            if (existing) {
              // Reuse existing session_id instead of deleting
              // Update session metadata only, preserve chunks
              await env.DB.prepare("UPDATE ext_sessions SET summary=?, topics=?, key_decisions=?, tools=?, project=?, status=?, checkpoint=?, total_turns=?, synced_at=datetime('now') WHERE session_id=?")
                .bind(summary || "", JSON.stringify(topics || []), JSON.stringify(key_decisions || []), JSON.stringify(tools || []), project || "", status || "", checkpoint || "", total_turns || 0, existing.session_id).run();
              // Add new chunks without deleting old ones
              if (chunks && chunks.length > 0) {
                for (let i = 0; i < chunks.length; i++) {
                  const c2 = chunks[i];
                  const cid = existing.session_id + "-chunk-" + (c2.chunk_index || i);
                  await env.DB.prepare(
                    "INSERT INTO ext_chunks (chunk_id, session_id, chunk_index, turn_start, turn_end, chunk_summary, chunk_checkpoint, chunk_topics, chunk_key_decisions, raw_content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chunk_id) DO UPDATE SET chunk_summary=excluded.chunk_summary, chunk_checkpoint=excluded.chunk_checkpoint, raw_content=CASE WHEN length(excluded.raw_content) > length(ext_chunks.raw_content) THEN excluded.raw_content ELSE ext_chunks.raw_content END"
                  ).bind(cid, existing.session_id, c2.chunk_index || i, c2.turn_start || 0, c2.turn_end || 0, c2.summary || "", c2.checkpoint || "", JSON.stringify(c2.topics || []), JSON.stringify(c2.key_decisions || []), c2.raw_content || "").run();
                  // Vector embedding
                  try {
                    const textToEmbed = (c2.summary || "") + " " + (c2.checkpoint || "");
                    if (textToEmbed.trim().length > 10) {
                      const embResult = await env.AI.run("@cf/baai/bge-m3", { text: [textToEmbed] });
                      if (embResult && embResult.data && embResult.data[0]) {
                        await env.VECTORIZE.upsert([{ id: cid, values: embResult.data[0], metadata: { session_id: existing.session_id, chunk_index: c2.chunk_index || i, project: project || "" } }]);
                      }
                    }
                  } catch (vecErr) {}
                }
              }
              return Response.json({ ok: true, session_id: existing.session_id, chunks_saved: chunks ? chunks.length : 0, reused: true }, { headers: corsHeaders });
            }
          }

          const sessionId = crypto.randomUUID();
          const totalChunks = chunks ? chunks.length : 0;

          await env.DB.prepare(
            `INSERT INTO ext_sessions (session_id, title, source, url, summary, topics, key_decisions, tools, project, status, checkpoint, total_chunks, total_turns)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            sessionId,
            title || "Untitled",
            source,
            sessionUrl || "",
            summary || "",
            JSON.stringify(topics || []),
            JSON.stringify(key_decisions || []),
            JSON.stringify(tools || []),
            project || "",
            status || "진행중",
            checkpoint || "",
            totalChunks,
            total_turns || 0
          ).run();

          if (chunks && chunks.length > 0) {
            for (let i = 0; i < chunks.length; i++) {
              const c = chunks[i];
              await env.DB.prepare(
                `INSERT INTO ext_chunks (chunk_id, session_id, chunk_index, turn_start, turn_end, chunk_summary, chunk_checkpoint, chunk_topics, chunk_key_decisions, raw_content)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).bind(
                crypto.randomUUID(),
                sessionId,
                i,
                c.turn_start || 0,
                c.turn_end || 0,
                c.summary || "",
                c.checkpoint || "",
                JSON.stringify(c.topics || []),
                JSON.stringify(c.key_decisions || []),
                c.raw_content || ""
              ).run();

              // Vector embedding for backfill chunks
              try {
                const textToEmbed = (c.summary || "") + " " + (c.checkpoint || "");
                if (textToEmbed.trim().length > 10) {
                  const embResult = await env.AI.run("@cf/baai/bge-m3", { text: [textToEmbed] });
                  if (embResult && embResult.data && embResult.data[0]) {
                    await env.VECTORIZE.upsert([{
                      id: sessionId + "-chunk-" + i,
                      values: embResult.data[0],
                      metadata: { session_id: sessionId, chunk_index: i, project: project || "" }
                    }]);
                  }
                }
              } catch (vecErr) {
                console.error("Vector upsert error (backfill):", vecErr.message);
              }
            }
          }

          return Response.json({ ok: true, session_id: sessionId, chunks_saved: totalChunks }, { headers: corsHeaders });
        } catch (e) {
          return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
        }
      }

    if (url.pathname === "/api/sessions" && request.method === "GET") {
      try {
        const limit = parseInt(url.searchParams.get("limit") || "30");
        const results = await env.DB.prepare(
          "SELECT session_id, title, source, summary, project, status, total_chunks, total_turns, created_at FROM ext_sessions ORDER BY created_at DESC LIMIT ?"
        ).bind(limit).all();
        return Response.json(results, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
      }
    }


    // === SNAP API ===
    if (url.pathname === "/api/session/snap" && request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    if (url.pathname === "/api/session/snap" && request.method === "POST") {
      try {
        const body = await request.json();
        const { session_id, snapshot } = body;
        if (!session_id || !snapshot) {
          return Response.json({ error: "session_id and snapshot required" }, { status: 400, headers: corsHeaders });
        }
        await env.DB.prepare(
          "UPDATE ext_sessions SET checkpoint = ?, updated_at = datetime('now') WHERE session_id = ?"
        ).bind(snapshot, session_id).run();
        return Response.json({ ok: true, session_id, snapshot_length: snapshot.length }, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname.startsWith("/api/session/") && request.method === "GET") {
      try {
        const sid = decodeURIComponent(url.pathname.replace("/api/session/", ""));
        const session = await env.DB.prepare(
          "SELECT * FROM ext_sessions WHERE session_id = ?"
        ).bind(sid).first();
        if (!session) return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
        const chunks = await env.DB.prepare(
          "SELECT * FROM ext_chunks WHERE session_id = ? ORDER BY chunk_index"
        ).bind(sid).all();
        session.chunks = chunks.results || [];
        return Response.json(session, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
      }
    }


    // === Session Search API ===
    if (url.pathname === "/api/sessions/search" && request.method === "GET") {
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
          where.push("s.url = ?");
          binds.push(searchUrl);
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

        const stmt = env.DB.prepare(sql);
        const results = await stmt.bind(...binds).all();

        // 청크 검색도 포함
        let chunkResults = [];
        if (q) {
          const chunkSql = "SELECT c.chunk_id, c.session_id, c.chunk_index, c.chunk_summary, c.chunk_checkpoint, c.chunk_topics, c.chunk_key_decisions, c.turn_start, c.turn_end FROM ext_chunks c WHERE c.chunk_summary LIKE ? OR c.chunk_checkpoint LIKE ? OR c.chunk_topics LIKE ? OR c.chunk_key_decisions LIKE ? ORDER BY c.session_id, c.chunk_index LIMIT 50";
          const cResults = await env.DB.prepare(chunkSql).bind("%" + q + "%", "%" + q + "%", "%" + q + "%", "%" + q + "%").all();
          chunkResults = cResults.results || [];
        }

        return Response.json({ sessions: results.results || [], chunks: chunkResults, total: (results.results || []).length }, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
      }
    }

    // === Session Projects List ===
    if (url.pathname === "/api/sessions/projects" && request.method === "GET") {
      try {
        const results = await env.DB.prepare("SELECT project, COUNT(*) as cnt FROM ext_sessions WHERE project != '' GROUP BY project ORDER BY cnt DESC").all();
        return Response.json(results, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
      }
    }

    // === Latest session by project (for checkpoint chaining) ===
    if (url.pathname === "/api/sessions/latest" && request.method === "GET") {
      try {
        const project = url.searchParams.get("project") || "";
        if (!project) return Response.json({ error: "project parameter required" }, { status: 400, headers: corsHeaders });
        const result = await env.DB.prepare("SELECT * FROM ext_sessions WHERE project = ? ORDER BY created_at DESC LIMIT 1").bind(project).first();
        if (!result) return Response.json({ error: "No session found" }, { status: 404, headers: corsHeaders });
        const chunks = await env.DB.prepare("SELECT * FROM ext_chunks WHERE session_id = ? ORDER BY chunk_index").bind(result.session_id).all();
        result.chunks = chunks.results || [];
        return Response.json(result, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
      }
    }

        return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
  }
};

const HTML_PAGE = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AIKeep24</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',-apple-system,'Pretendard',sans-serif;background:#0D1117;color:#E6EDF3;padding:16px;max-width:640px;margin:0 auto}
  h1{font-size:1.5em;margin-bottom:14px;color:#7AA2F7;letter-spacing:-0.5px}
  .key-area{display:flex;gap:6px;align-items:center;margin-bottom:10px}
  .key-area input{flex:1;padding:10px;border:1px solid #30363D;border-radius:8px;background:#161B22;color:#E6EDF3;font-size:12px}
  .key-area button{width:auto;padding:10px 14px;font-size:12px;margin:0;white-space:nowrap}
  .key-status{font-size:11px;text-align:right;margin:-6px 0 10px;color:#565F89}
  .key-status.saved{color:#9ECE6A}
  .tab-bar{display:flex;gap:6px;margin-bottom:16px}
  .tab{flex:1;padding:11px;text-align:center;background:#161B22;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;color:#8B949E;transition:all .2s;border:1px solid transparent}
  .tab:hover{background:#1F2937;color:#C0CAF5}
  .tab.active{background:#7AA2F7;color:#fff;border-color:#7AA2F7}
  .section{display:none}.section.active{display:block}
  input,select{width:100%;padding:10px;margin:6px 0;border:1px solid #30363D;border-radius:8px;background:#161B22;color:#E6EDF3;font-size:14px;transition:border-color .2s}
  input:focus,select:focus{outline:none;border-color:#7AA2F7}
  button{width:100%;padding:12px;margin:8px 0;border:none;border-radius:8px;background:#7AA2F7;color:#fff;font-size:15px;font-weight:600;cursor:pointer;transition:background .2s}
  button:hover{background:#5D8BF4}
  button:active{background:#4C7CF0}
  .btn-sm{font-size:13px;padding:8px 12px;background:#161B22;border:1px solid #7AA2F7;color:#7AA2F7}
  .btn-sm:hover{background:#1F2937}
  .card{background:#161B22;padding:16px;margin:10px 0;border-radius:10px;cursor:pointer;transition:all .2s;border-left:4px solid #30363D}
  .card:hover{background:#1F2937;border-left-color:#7AA2F7;transform:translateX(2px)}
  .card h3{color:#E6EDF3;font-size:.95em;margin:0 0 8px 0;display:flex;justify-content:space-between;align-items:center}
  .card p{color:#8B949E;font-size:.85em;margin:4px 0}
  .card .project-badge{background:#7AA2F733;color:#7AA2F7;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;border:1px solid #7AA2F744}
  .card .status-badge{font-size:10px;padding:2px 8px;border-radius:8px;margin-left:6px}
  .card .status-badge.done{background:#1B4332;color:#9ECE6A}
  .card .status-badge.progress{background:#3D2E00;color:#E0AF68}
  .card .summary{color:#C0CAF5;font-size:13px;line-height:1.5;margin:6px 0 10px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .card .meta-row{display:flex;gap:12px;color:#565F89;font-size:11px;margin-top:8px;align-items:center}
  .card .meta-row span{display:flex;align-items:center;gap:3px}
  .chunk-card{background:#0D1117;padding:12px 16px;margin:6px 0;border-radius:8px;cursor:pointer;border-left:3px solid #E0AF68;transition:all .2s}
  .chunk-card:hover{background:#1A1F2E;transform:translateX(2px)}
  .chunk-card .chunk-label{color:#E0AF68;font-size:11px;font-weight:600;margin-bottom:4px}
  .chunk-card .chunk-summary{color:#8B949E;font-size:12px;line-height:1.4}
  .score-bar{display:inline-block;height:4px;border-radius:2px;margin-left:6px;vertical-align:middle}
  .ses-date-group{color:#565F89;font-size:12px;margin:16px 0 6px;padding-bottom:4px;border-bottom:1px solid #30363D}
  .msg{padding:10px;margin:8px 0;border-radius:8px;text-align:center}
  .msg.ok{background:#1B4332;color:#9ECE6A}.msg.err{background:#3D0000;color:#F7768E}
  .empty-state{text-align:center;padding:40px 20px;color:#565F89}
  .empty-state .icon{font-size:32px;margin-bottom:8px}
  .empty-state p{font-size:13px;line-height:1.5}
  .loading{text-align:center;padding:40px;color:#565F89}
  .filter-row{display:flex;gap:6px;margin-bottom:8px}
  .filter-row>*{flex:1}

  .modal-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.7);z-index:1000;justify-content:center;align-items:flex-start;padding:20px;overflow-y:auto}
  .modal-overlay.active{display:flex}
  .modal{background:#161B22;border-radius:12px;width:100%;max-width:600px;max-height:90vh;display:flex;flex-direction:column;margin:auto;border:1px solid #30363D}
  .modal-header{display:flex;justify-content:space-between;align-items:center;padding:16px;border-bottom:1px solid #30363D;flex-shrink:0}
  .modal-header h2{font-size:1.1em;color:#7AA2F7;flex:1;margin-right:10px;word-break:break-word}
  .modal-close{background:#30363D;border:none;color:#E6EDF3;width:36px;height:36px;border-radius:50%;font-size:18px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center}
  .modal-close:hover{background:#484F58}
  .modal-meta{padding:12px 16px;border-bottom:1px solid #30363D;font-size:12px;color:#565F89;flex-shrink:0}
  .modal-meta span{margin-right:12px}
  .modal-meta .tag{background:#7AA2F733;color:#7AA2F7;padding:2px 8px;border-radius:4px;font-size:11px}
  .modal-body{padding:16px;overflow-y:auto;flex:1}
  .modal-body pre{white-space:pre-wrap;word-break:break-word;font-family:'JetBrains Mono','Fira Code',monospace;font-size:13px;line-height:1.7;color:#C0CAF5}
  .modal-search{display:flex;align-items:center;gap:6px;padding:8px 16px;border-bottom:1px solid #30363D;flex-shrink:0}
  .modal-search input{flex:1;padding:8px;border:1px solid #30363D;border-radius:6px;background:#0D1117;color:#E6EDF3;font-size:13px}
  .modal-search-btn{width:32px;height:32px;border:1px solid #30363D;border-radius:6px;background:#0D1117;color:#E6EDF3;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0}
  .modal-actions{padding:12px 16px;border-top:1px solid #30363D;display:flex;gap:8px;flex-shrink:0}
  .modal-actions button{flex:1;padding:10px;font-size:13px;margin:0}
  .btn-secondary{background:#30363D;color:#8B949E}
  .btn-secondary:hover{background:#484F58}
  .btn-danger{background:#F7768E}.btn-danger:hover{background:#E5566E}
  mark.hl{background:#7AA2F755;color:#fff;border-radius:2px;padding:0 1px}
  mark.hl.current{background:#E0AF68;color:#000}
  #noteSearchCount{font-size:11px;color:#565F89;white-space:nowrap;min-width:40px;text-align:center}
</style>
</head>
<body>
<h1>AIKeep24</h1>

<div class="key-area">
  <input id="apiKey" type="password" placeholder="API Key" />
  <button class="btn-sm" onclick="toggleKey()">Show</button>
  <button class="btn-sm" onclick="saveKey()">Save</button>
</div>
<div class="key-status" id="keyStatus"></div>

<div class="tab-bar">
  <div class="tab active" onclick="showTab('search',this)">Search</div>
  <div class="tab" onclick="showTab('sessions',this)">Sessions</div>
</div>

<div id="search" class="section active">
  <input id="searchQ" placeholder="Search conversations..." onkeydown="if(event.key==='Enter')doSearch()" />
  <div class="filter-row">
    <select id="searchProject"><option value="">All Projects</option></select>
    <input id="searchFrom" type="date" style="font-size:12px" />
    <input id="searchTo" type="date" style="font-size:12px" />
  </div>
  <button onclick="doSearch()">Search</button>
  <div id="searchResults">
    <div class="empty-state"><div class="icon">&#128269;</div><p>Enter a keyword to search across all conversations using vector similarity.</p></div>
  </div>
</div>

<div id="sessions" class="section">
  <div class="filter-row">
    <input id="sesQ" placeholder="Keyword" style="flex:2" onkeydown="if(event.key==='Enter')loadSessions()" />
    <button class="btn-sm" onclick="loadSessions()" style="width:auto;padding:8px 14px;flex:0">Go</button>
  </div>
  <div class="filter-row">
    <select id="sesProject"><option value="">All Projects</option></select>
    <select id="sesStatus">
      <option value="">All Status</option>
      <option value="진행중">진행중</option>
      <option value="완료">완료</option>
      <option value="보류">보류</option>
    </select>
  </div>
  <div class="filter-row">
    <input id="sesFrom" type="date" style="font-size:12px" />
    <input id="sesTo" type="date" style="font-size:12px" />
  </div>
  <div id="sesResults">
    <div class="empty-state"><div class="icon">&#128203;</div><p>Click Go or enter a keyword to browse sessions.</p></div>
  </div>
</div>

<div class="modal-overlay" id="sessionModal" onclick="if(event.target===this)closeSessionModal()">
  <div class="modal">
    <div class="modal-header">
      <h2 id="smTitle">...</h2>
      <button class="modal-close" onclick="closeSessionModal()">&#10005;</button>
    </div>
    <div class="modal-meta" id="smMeta"></div>
    <div class="modal-body" id="smBody"><div class="loading">Loading...</div></div>
  </div>
</div>

<div class="modal-overlay" id="noteModal" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <div class="modal-header">
      <h2 id="modalTitle">...</h2>
      <button class="modal-close" onclick="closeModal()">&#10005;</button>
    </div>
    <div class="modal-meta" id="modalMeta"></div>
    <div class="modal-search">
      <input id="noteSearchInput" placeholder="Search in note..." oninput="highlightSearch()" />
      <span id="noteSearchCount"></span>
      <button class="modal-search-btn" onclick="jumpSearch(-1)">&#9650;</button>
      <button class="modal-search-btn" onclick="jumpSearch(1)">&#9660;</button>
    </div>
    <div class="modal-body" id="modalBody"><div class="loading">Loading...</div></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="copyContent()">Copy</button>
    </div>
  </div>
</div>

<script>
const BASE=location.origin;
let currentNoteName='';

const keyInput=document.getElementById('apiKey');
const keyStatusEl=document.getElementById('keyStatus');

function h(k){return{'Authorization':'Bearer '+k,'Content-Type':'application/json'}}
function getKey(){return keyInput.value.trim()||localStorage.getItem('ck_api_key')||''}
function saveKey(){const k=keyInput.value.trim();if(!k)return;localStorage.setItem('ck_api_key',k);keyStatusEl.textContent='Key saved';keyStatusEl.className='key-status saved';loadProjects()}
function toggleKey(){keyInput.type=keyInput.type==='password'?'text':'password'}

function showTab(id,el){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if(el)el.classList.add('active');
  if(id==='sessions')loadSessions();
}

async function loadProjects(){
  const k=getKey();if(!k)return;
  try{
    const r=await fetch(BASE+'/api/sessions/projects',{headers:h(k)});
    const d=await r.json();
    const projects=d.projects||d.results||[];
    ['searchProject','sesProject'].forEach(id=>{
      const sel=document.getElementById(id);
      const val=sel.value;
      sel.innerHTML='<option value="">All Projects</option>';
      projects.forEach(p=>{if(p&&p.project)sel.innerHTML+='<option value="'+p.project+'">'+p.project+'</option>'});
      sel.value=val;
    });
  }catch(e){console.error('loadProjects:',e)}
}

async function doSearch(){
  const k=getKey();if(!k){alert('Enter API key first');return}
  const q=document.getElementById('searchQ').value.trim();
  const project=document.getElementById('searchProject').value;
  const from=document.getElementById('searchFrom').value;
  const to=document.getElementById('searchTo').value;
  const resultsDiv=document.getElementById('searchResults');
  if(!q){resultsDiv.innerHTML='<div class="empty-state"><div class="icon">&#128269;</div><p>Enter a search term.</p></div>';return}
  resultsDiv.innerHTML='<div class="loading">Searching...</div>';
  try{
    let url=BASE+'/api/vector-search?q='+encodeURIComponent(q)+'&limit=15';
    if(project)url+='&project='+encodeURIComponent(project);
    if(from)url+='&from='+encodeURIComponent(from);
    if(to)url+='&to='+encodeURIComponent(to);
    const r=await fetch(url,{headers:h(k)});
    const d=await r.json();
    const results=d.results||[];
    if(!results.length){resultsDiv.innerHTML='<div class="empty-state"><div class="icon">&#128269;</div><p>No matching results. Try different keywords.</p></div>';return}
    let html='<div style="color:#565F89;font-size:12px;margin:8px 0">'+results.length+' results</div>';
    results.forEach(r=>{
      const score=r.score||0;
      const pct=Math.round(score*100);
      const barColor=score>0.6?'#9ECE6A':score>0.4?'#E0AF68':'#F7768E';
      html+='<div class="card" onclick="openSession(&quot;'+r.session_id+'&quot;)">'
        +'<h3><span>'+(r.project||r.session_id.substring(0,8))+'</span><span class="project-badge">'+pct+'% match</span></h3>'
        +'<div class="summary">'+escH(r.chunk_summary||'')+'</div>'
        +'<div class="meta-row"><span>Chunk '+(r.chunk_index+1)+'</span><span>Turns '+(r.turn_start||0)+'-'+(r.turn_end||0)+'</span>'
        +'<span><span class="score-bar" style="width:'+pct+'px;background:'+barColor+'"></span></span></div></div>';
    });
    resultsDiv.innerHTML=html;
  }catch(e){resultsDiv.innerHTML='<div class="msg err">Search error: '+e.message+'</div>'}
}

async function loadSessions(){
  const k=getKey();if(!k)return;
  const q=document.getElementById('sesQ').value.trim();
  const project=document.getElementById('sesProject').value;
  const status=document.getElementById('sesStatus').value;
  const from=document.getElementById('sesFrom').value;
  const to=document.getElementById('sesTo').value;
  const resultsDiv=document.getElementById('sesResults');
  resultsDiv.innerHTML='<div class="loading">Loading...</div>';
  try{
    let url=BASE+'/api/sessions/search?limit=50';
    if(q)url+='&q='+encodeURIComponent(q);
    if(project)url+='&project='+encodeURIComponent(project);
    if(status)url+='&status='+encodeURIComponent(status);
    if(from)url+='&from='+encodeURIComponent(from);
    if(to)url+='&to='+encodeURIComponent(to);
    const r=await fetch(url,{headers:h(k)});
    const d=await r.json();
    let sessions=d.sessions||[];
    if(!sessions.length){resultsDiv.innerHTML='<div class="empty-state"><div class="icon">&#128203;</div><p>No sessions found.</p></div>';return}
    let html='<div style="color:#565F89;font-size:12px;margin:8px 0">'+sessions.length+' sessions</div>';
    let lastDate='';
    sessions.forEach(s=>{
      const d=(s.created_at||'').substring(0,10);
      if(d!==lastDate){html+='<div class="ses-date-group">'+d+'</div>';lastDate=d}
      const statusClass=s.status==='완료'?'done':s.status==='보류'?'blocked':'progress';
      html+='<div class="card" onclick="openSession(&quot;'+s.session_id+'&quot;)">'
        +'<h3><span>'+(s.project||s.title||s.session_id.substring(0,8))+'</span>'
        +'<span><span class="status-badge '+statusClass+'">'+(s.status||'진행중')+'</span></span></h3>'
        +'<div class="summary">'+escH(s.summary||'')+'</div>'
        +'<div class="meta-row"><span>'+(s.total_turns||0)+' turns</span><span>'+(s.total_chunks||0)+' chunks</span></div></div>';
    });
    resultsDiv.innerHTML=html;
  }catch(e){resultsDiv.innerHTML='<div class="msg err">Error: '+e.message+'</div>'}
}

async function openSession(sid){
  const k=getKey();
  const modal=document.getElementById('sessionModal');
  const body=document.getElementById('smBody');
  const title=document.getElementById('smTitle');
  const meta=document.getElementById('smMeta');
  modal.classList.add('active');
  body.innerHTML='<div class="loading">Loading...</div>';
  try{
    const r=await fetch(BASE+'/api/session/'+sid,{headers:h(k)});
    const d=await r.json();
    title.textContent=d.project||d.title||sid.substring(0,12);
    meta.innerHTML='<span>'+d.status+'</span><span>'+(d.total_turns||0)+' turns</span><span>'+(d.created_at||'').substring(0,10)+'</span>'
      +(d.url?'<br><a href="'+escH(d.url)+'" target="_blank" style="color:#7AA2F7;font-size:11px;word-break:break-all;">'+escH(d.url)+'</a>':'');
    const chunks=(d.chunks||[]).sort((a,b)=>(a.chunk_index||0)-(b.chunk_index||0));
    if(!chunks.length){body.innerHTML='<div class="empty-state"><p>No chunks</p></div>';return}
    let html='';
    chunks.forEach((c,i)=>{
      const hasRaw=c.raw_content&&c.raw_content.length>0;
      const chunkDate=(d.created_at||'').substring(0,10);
      const srcUrl=d.url||'';
      html+='<div class="chunk-card" data-cidx="'+i+'">'
        +'<div class="chunk-label">Chunk '+(c.chunk_index+1)+' (turns '+(c.turn_start||0)+'-'+(c.turn_end||0)+') <span style="color:#565F89;font-size:10px">'+chunkDate+'</span>'+(hasRaw?' <span style="color:#9ECE6A;font-size:10px">[RAW '+c.raw_content.length+' chars]</span>':'')+'</div>'
        +'<div class="chunk-summary">'+escH(c.chunk_summary||'')+'</div>'
        +(srcUrl?'<div style="margin-top:4px;font-size:10px;"><a href="'+escH(srcUrl)+'" target="_blank" style="color:#7AA2F7;text-decoration:none;" title="Open source conversation">&#128279; source</a> <span style="color:#484F58;cursor:pointer;margin-left:6px" onclick="event.stopPropagation();navigator.clipboard.writeText(''+srcUrl.replace(/'/g,"\'")+'');this.textContent='copied!'">&#128203; copy URL</span></div>':'')
        +'</div>';
    });
    body.innerHTML=html;
    body.querySelectorAll('.chunk-card').forEach((el,i)=>{
      el.onclick=function(){
        const c=chunks[i];
        const text=c.raw_content||c.chunk_summary||'';
        navigator.clipboard.writeText(text).then(()=>{
          el.style.borderLeftColor='#9ECE6A';
          const label=el.querySelector('.chunk-label');
          if(label)label.textContent+=' (copied!)';
          setTimeout(()=>{el.style.borderLeftColor='#E0AF68'},1500);
        });
      };
    });
  }catch(e){body.innerHTML='<div class="msg err">'+e.message+'</div>'}
}

function closeSessionModal(){document.getElementById('sessionModal').classList.remove('active')}

function closeModal(){document.getElementById('noteModal').classList.remove('active')}

function escH(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

function copyContent(){
  const body=document.getElementById('modalBody');
  navigator.clipboard.writeText(body.innerText).then(()=>{
    const btn=document.querySelector('.modal-actions .btn-secondary');
    if(btn){btn.textContent='Copied!';setTimeout(()=>btn.textContent='Copy',1500)}
  });
}

let searchHits=[],searchIdx=-1;
function highlightSearch(){
  var q=document.getElementById('noteSearchInput').value.trim();
  var body=document.getElementById('modalBody');
  var counter=document.getElementById('noteSearchCount');
  var pre=body.querySelector('pre');
  if(!pre)return;
  var raw=pre.textContent||'';
  if(!q){pre.innerHTML=escH(raw);counter.textContent='';searchHits=[];return}
  var parts=raw.split(new RegExp('('+q+')','i'));
  var idx=0;searchHits=[];
  var html=parts.map(function(p,pi){if(pi%2===1){searchHits.push(idx);idx++;return'<mark class="hl" id="hl'+idx+'">'+escH(p)+'</mark>'}return escH(p)}).join('');
  pre.innerHTML=html;
  counter.textContent=searchHits.length?searchHits.length+' found':'0';
  searchIdx=-1;if(searchHits.length)jumpSearch(1);
}

function jumpSearch(dir){
  if(!searchHits.length)return;
  searchIdx+=dir;
  if(searchIdx>=searchHits.length)searchIdx=0;
  if(searchIdx<0)searchIdx=searchHits.length-1;
  document.querySelectorAll('mark.hl').forEach(m=>m.classList.remove('current'));
  const el=document.getElementById('hl'+(searchIdx+1));
  if(el){el.classList.add('current');el.scrollIntoView({block:'center'})}
  document.getElementById('noteSearchCount').textContent=(searchIdx+1)+'/'+searchHits.length;
}

(function init(){
  const saved=localStorage.getItem('ck_api_key');
  if(saved){keyInput.value=saved;keyStatusEl.textContent='Key loaded';keyStatusEl.className='key-status saved';loadProjects();loadSessions()}
})();
</script>
</body>
</html>`;

