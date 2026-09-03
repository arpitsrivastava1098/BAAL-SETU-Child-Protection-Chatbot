import http from "node:http";

const publicPort = Number(process.env.PORT || 3000);
const internalPort = publicPort + 1;
process.env.PORT = String(internalPort);

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 30;
const MAX_BODY_BYTES = 10 * 1024;
const clients = new Map();

function clientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return String(forwarded || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function reject(res, status, message) {
  securityHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: message }));
}

async function start() {
  try {
    await import("./server.js");
  } catch (error) {
    console.error("Application startup failed");
    process.exit(1);
  }

  const proxy = http.createServer((req, res) => {
    securityHeaders(res);
    res.removeHeader("X-Powered-By");

    const isChat = req.method === "POST" && req.url?.split("?")[0] === "/api/chat";

    if (!isChat) {
      return forward(req, res);
    }

    const now = Date.now();
    const key = clientKey(req);
    const previous = clients.get(key);
    if (!previous || now - previous.start >= WINDOW_MS) {
      clients.set(key, { start: now, count: 1 });
    } else {
      previous.count += 1;
      if (previous.count > MAX_REQUESTS) {
        return reject(res, 429, "बहुत अधिक requests हो गई हैं। कृपया कुछ देर बाद फिर प्रयास करें।");
      }
    }

    const declaredLength = Number(req.headers["content-length"] || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      req.resume();
      return reject(res, 413, "Request बहुत बड़ी है।");
    }

    const chunks = [];
    let total = 0;
    let tooLarge = false;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        tooLarge = true;
      } else {
        chunks.push(chunk);
      }
    });

    req.on("end", () => {
      if (tooLarge) {
        return reject(res, 413, "Request बहुत बड़ी है।");
      }
      forward(req, res, Buffer.concat(chunks));
    });

    req.on("error", () => reject(res, 400, "Invalid request."));
  });

  proxy.listen(publicPort, "0.0.0.0", () => {
    console.log(`Security proxy listening on port ${publicPort}`);
  });
}

function forward(req, res, body = null) {
  const headers = { ...req.headers, host: `127.0.0.1:${internalPort}` };
  delete headers["x-forwarded-for"];
  delete headers["x-forwarded-host"];
  delete headers["x-forwarded-proto"];

  if (body !== null) {
    headers["content-length"] = String(body.length);
  }

  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: internalPort,
      path: req.url,
      method: req.method,
      headers
    },
    (upstreamRes) => {
      securityHeaders(res);
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  upstream.on("error", () => {
    if (!res.headersSent) {
      reject(res, 502, "Service temporarily unavailable.");
    } else {
      res.destroy();
    }
  });

  if (body !== null) {
    upstream.end(body);
  } else {
    req.pipe(upstream);
  }
}

start();
