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
  // Voice search needs microphone access in the same page.
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
}

function reject(res, status, message) {
  securityHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: message }));
}

const voiceSearch = `
<style>
#voiceBtn{
  border:0;
  width:52px;
  min-width:52px;
  border-radius:14px;
  background:#6c63ff;
  color:#fff;
  font-size:22px;
  cursor:pointer;
  font-weight:900;
  box-shadow:0 4px 0 rgba(0,0,0,.12);
  transition:.2s;
}
#voiceBtn:hover{transform:translateY(-2px)}
#voiceBtn.listening{
  background:#e84c27;
  animation:voicePulse 1s infinite;
}
@keyframes voicePulse{
  0%,100%{box-shadow:0 0 0 0 rgba(232,76,39,.35)}
  50%{box-shadow:0 0 0 10px rgba(232,76,39,0)}
}
@media(max-width:500px){
  #voiceBtn{width:46px;min-width:46px;font-size:20px}
}
</style>
<script>
document.addEventListener("DOMContentLoaded",function(){
  const bar=document.querySelector(".inputbar");
  const input=document.getElementById("input");
  if(!bar || !input || document.getElementById("voiceBtn")) return;

  const btn=document.createElement("button");
  btn.id="voiceBtn";
  btn.type="button";
  btn.title="बोलकर सवाल पूछें";
  btn.setAttribute("aria-label","बोलकर सवाल पूछें");
  btn.textContent="🎤";
  bar.insertBefore(btn,input);

  const Recognition=window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!Recognition){
    btn.title="इस browser में voice search उपलब्ध नहीं है";
    btn.addEventListener("click",function(){
      alert("आपके browser में Voice Search support नहीं है। Chrome या Edge में फिर प्रयास करें।");
    });
    return;
  }

  const recognition=new Recognition();
  recognition.lang="hi-IN";
  recognition.interimResults=true;
  recognition.continuous=false;

  recognition.onstart=function(){
    btn.classList.add("listening");
    btn.textContent="🔴";
    btn.title="सुन रहा हूँ... बोलिए";
    input.placeholder="🎤 सुन रहा हूँ... अपना सवाल बोलिए";
  };

  recognition.onresult=function(event){
    let text="";
    for(let i=event.resultIndex;i<event.results.length;i++){
      text += event.results[i][0].transcript;
    }
    input.value=text.trim();
  };

  recognition.onerror=function(event){
    if(event.error==="not-allowed" || event.error==="service-not-allowed"){
      alert("Voice Search के लिए microphone permission allow करें।");
    }
  };

  recognition.onend=function(){
    btn.classList.remove("listening");
    btn.textContent="🎤";
    btn.title="बोलकर सवाल पूछें";
    input.placeholder="अपना सवाल लिखें...";
    input.focus();
  };

  btn.addEventListener("click",function(){
    if(btn.classList.contains("listening")){
      recognition.stop();
      return;
    }
    try{ recognition.start(); }
    catch(e){}
  });
});
</script>
`;

function injectVoiceSearch(html) {
  if (!html.includes("BAAL-SETU") || html.includes("id=\"voiceBtn\"")) return html;
  return html.replace("</head>", voiceSearch + "</head>");
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
      const contentType = String(upstreamRes.headers["content-type"] || "");
      const shouldInject = req.method === "GET" && contentType.includes("text/html");

      if (!shouldInject) {
        securityHeaders(res);
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
        return;
      }

      const parts = [];
      upstreamRes.on("data", (chunk) => parts.push(chunk));
      upstreamRes.on("end", () => {
        const html = Buffer.concat(parts).toString("utf8");
        const modified = injectVoiceSearch(html);
        const outHeaders = { ...upstreamRes.headers };
        delete outHeaders["content-length"];
        delete outHeaders["content-encoding"];
        outHeaders["content-length"] = Buffer.byteLength(modified, "utf8");

        securityHeaders(res);
        res.writeHead(upstreamRes.statusCode || 200, outHeaders);
        res.end(modified);
      });
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
