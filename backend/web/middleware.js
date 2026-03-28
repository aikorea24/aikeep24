export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json"
};

export function handleOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

export function checkAuth(request, env) {
  const auth = request.headers.get("Authorization");
  if (auth !== `Bearer ${env.API_KEY}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }
  return null;
}

export function jsonOk(data) {
  return Response.json(data, { headers: corsHeaders });
}

export function jsonError(msg, status) {
  return Response.json({ error: msg }, { status: status || 500, headers: corsHeaders });
}
