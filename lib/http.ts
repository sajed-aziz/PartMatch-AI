export function privateJson(body: unknown, status: number) {
  return Response.json(body, { status, headers: {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return request.headers.get("sec-fetch-site") !== "cross-site" &&
    (!origin || origin === new URL(request.url).origin);
}
