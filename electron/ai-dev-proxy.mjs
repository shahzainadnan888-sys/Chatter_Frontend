import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnvironment() {
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const current = process.env[match[1]];
    // Treat blank values as unset so an empty shell export cannot block .env.
    if (current !== undefined && current !== "") continue;
    process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadEnvironment();

const HOST = "127.0.0.1";
const PORT = Number(process.env.CHATTER_AI_PROXY_PORT || 4317);
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL =
  process.env.GROQ_CHAT_MODEL ||
  process.env.GROQ_MODEL ||
  "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:3000",
  "http://localhost:3000",
]);

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("At least one conversation message is required.");
  }
  return messages.slice(-50).map((message) => {
    const role =
      message?.role === "assistant"
        ? "assistant"
        : message?.role === "user"
          ? "user"
          : null;
    const content =
      typeof message?.content === "string"
        ? message.content.trim().slice(0, 20_000)
        : "";
    if (!role || !content) {
      throw new Error("The conversation contains an invalid message.");
    }
    return { role, content };
  });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("The request is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    json(res, 403, { message: "Origin not allowed." });
    return;
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
    });
    res.end();
    return;
  }
  if (req.method !== "POST" || req.url !== "/v1/chat") {
    json(res, 404, { message: "Not found." });
    return;
  }
  if (!GROQ_API_KEY) {
    json(res, 503, { message: "GROQ_API_KEY is not configured." });
    return;
  }

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const payload = await readJson(req);
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        stream: true,
        temperature: 0.65,
        messages: [
          {
            role: "system",
            content:
              "You are Chatter Intelligence, the helpful conversational AI inside Chatter. Be accurate, concise, warm, and practical. Use Markdown when it improves clarity. Never claim to have performed actions you cannot perform.",
          },
          ...normalizeMessages(payload?.messages),
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      const message =
        response.status === 401 || response.status === 403
          ? "Groq authentication failed."
          : response.status === 429
            ? "Groq is temporarily rate limited."
            : "Groq could not complete this response.";
      json(res, response.status || 502, { message });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (error) {
    if (controller.signal.aborted) return;
    json(res, 400, {
      message:
        error instanceof Error
          ? error.message
          : "Chatter Intelligence could not process the request.",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Chatter AI proxy ready on http://${HOST}:${PORT}`);
});
