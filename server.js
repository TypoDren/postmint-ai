import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");

try {
  const envText = await readFile(join(root, ".env"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (match) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
}

const port = Number(process.env.PORT || 4173);
const merchantAddress = String(process.env.MERCHANT_TON_ADDRESS || "").trim();
const priceTon = String(process.env.PRICE_TON || "0.1").trim();
const generationsPerPayment = Number(process.env.GENERATIONS_PER_PAYMENT || 10);
const freeGenerations = Number(process.env.FREE_GENERATIONS || 1);
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, "");
const sessions = new Map();
const orders = new Map();
const storePath = join(root, "data", "store.json");

try {
  const saved = JSON.parse(await readFile(storePath, "utf8"));
  for (const session of saved.sessions || []) {
    sessions.set(session.token, session);
  }
  for (const order of saved.orders || []) {
    orders.set(order.id, order);
  }
} catch {
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function cleanInput(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function toNano(tonValue) {
  const [whole, fraction = ""] = String(tonValue).replace(",", ".").split(".");
  return `${BigInt(whole || "0") * 1_000_000_000n + BigInt((fraction + "000000000").slice(0, 9))}`;
}

function getSession(token) {
  if (!token || !sessions.has(token)) {
    return null;
  }
  return sessions.get(token);
}

function createSession() {
  const token = randomUUID();
  const session = {
    token,
    credits: freeGenerations,
    createdAt: Date.now()
  };
  sessions.set(token, session);
  saveStore();
  return session;
}

async function saveStore() {
  try {
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(storePath, JSON.stringify({
      sessions: [...sessions.values()],
      orders: [...orders.values()]
    }, null, 2));
  } catch (error) {
    console.error(`Failed to save store: ${error.message}`);
  }
}

function buildPrompt({ niche, offer, audience, tone, platform }) {
  return [
    "Ты пишешь короткие продающие Telegram-посты на русском языке.",
    "Задача: дать готовый текст, который можно сразу опубликовать.",
    "Не обещай гарантированный доход, не используй агрессивный скам-стиль.",
    "Формат ответа:",
    "1. Заголовок",
    "2. Пост до 900 символов",
    "3. 3 коротких CTA",
    "4. 5 хештегов",
    "",
    `Ниша: ${niche}`,
    `Оффер: ${offer}`,
    `Аудитория: ${audience}`,
    `Тон: ${tone}`,
    `Площадка: ${platform}`
  ].join("\n");
}

function getProvider() {
  return String(process.env.AI_PROVIDER || "openrouter").trim().toLowerCase();
}

function demoGeneration({ niche, offer, audience, tone }) {
  return [
    "1. Заголовок",
    `Как получить больше заявок в нише "${niche || "ваш продукт"}" без сложной воронки`,
    "",
    "2. Пост до 900 символов",
    `Если у вас есть ${offer || "полезный продукт"}, но люди не понимают его ценность с первых секунд, проблема часто не в продукте, а в подаче.`,
    "",
    `Мы сделали простой формат для ${audience || "клиентов"}, где оффер объясняется человеческим языком: что человек получает, почему это важно сейчас и какой следующий шаг сделать.`,
    "",
    `Тон: ${tone || "деловой"}. Без лишнего шума, без обещаний легких денег, только понятная польза и быстрый вход.`,
    "",
    "3. CTA",
    "- Напишите «старт», если хотите пример под вашу нишу.",
    "- Заберите тестовый вариант сегодня.",
    "- Оставьте заявку, покажем первый результат.",
    "",
    "4. Хештеги",
    "#telegram #продажи #маркетинг #ai #ton"
  ].join("\n");
}

async function generateOpenAI(input) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { text: demoGeneration(input), demo: true };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      instructions: "Ты сильный direct-response копирайтер. Пиши конкретно, этично и без воды.",
      input: buildPrompt(input),
      max_output_tokens: 900
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401 || errorText.includes("insufficient_quota")) {
      return { text: demoGeneration(input), demo: true, warning: "OpenAI is unavailable. Demo text was returned instead." };
    }
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const text = data.output_text || data.output?.flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  return { text: text || "Не удалось прочитать ответ модели.", demo: false, provider: "openai" };
}

async function generateOpenRouter(input) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { text: demoGeneration(input), demo: true, warning: "OPENROUTER_API_KEY is missing. Demo text was returned instead." };
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
      "http-referer": publicBaseUrl,
      "x-title": "TON AI Post Generator"
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "openrouter/free",
      messages: [
        { role: "system", content: "Ты сильный direct-response копирайтер. Пиши конкретно, этично и без воды." },
        { role: "user", content: buildPrompt(input) }
      ],
      max_tokens: 900
    })
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return {
    text: data.choices?.[0]?.message?.content?.trim() || "Не удалось прочитать ответ модели.",
    demo: false,
    provider: "openrouter"
  };
}

async function generateGroq(input) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { text: demoGeneration(input), demo: true, warning: "GROQ_API_KEY is missing. Demo text was returned instead." };
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "Ты сильный direct-response копирайтер. Пиши конкретно, этично и без воды." },
        { role: "user", content: buildPrompt(input) }
      ],
      max_tokens: 900
    })
  });

  if (!response.ok) {
    throw new Error(`Groq API error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return {
    text: data.choices?.[0]?.message?.content?.trim() || "Не удалось прочитать ответ модели.",
    demo: false,
    provider: "groq"
  };
}

async function generateGemini(input) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { text: demoGeneration(input), demo: true, warning: "GEMINI_API_KEY is missing. Demo text was returned instead." };
  }

  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: `Ты сильный direct-response копирайтер. Пиши конкретно, этично и без воды.\n\n${buildPrompt(input)}` }]
        }
      ],
      generationConfig: { maxOutputTokens: 900 }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return {
    text: data.candidates?.[0]?.content?.parts?.map((part) => part.text).join("\n").trim() || "Не удалось прочитать ответ модели.",
    demo: false,
    provider: "gemini"
  };
}

async function generateOllama(input) {
  const response = await fetch(process.env.OLLAMA_URL || "http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || "llama3.1",
      prompt: `Ты сильный direct-response копирайтер. Пиши конкретно, этично и без воды.\n\n${buildPrompt(input)}`,
      stream: false
    })
  });

  if (!response.ok) {
    return { text: demoGeneration(input), demo: true, warning: "Ollama is not available. Demo text was returned instead." };
  }

  const data = await response.json();
  return {
    text: data.response?.trim() || "Не удалось прочитать ответ модели.",
    demo: false,
    provider: "ollama"
  };
}

async function generateWithProvider(input) {
  switch (getProvider()) {
    case "openai":
      return generateOpenAI(input);
    case "groq":
      return generateGroq(input);
    case "gemini":
      return generateGemini(input);
    case "ollama":
      return generateOllama(input);
    case "openrouter":
    default:
      return generateOpenRouter(input);
  }
}

function getConfig() {
  return {
    priceTon,
    generationsPerPayment,
    freeGenerations,
    paidEnabled: Boolean(merchantAddress),
    merchantAddress: merchantAddress ? `${merchantAddress.slice(0, 6)}...${merchantAddress.slice(-6)}` : "",
    provider: getProvider()
  };
}

async function handleSession(_req, res) {
  const session = createSession();
  sendJson(res, 200, { token: session.token, credits: session.credits, config: getConfig() });
}

async function handleConfig(_req, res) {
  sendJson(res, 200, getConfig());
}

async function handleCreateOrder(req, res) {
  const body = await readJson(req);
  const session = getSession(body.token);
  if (!session) {
    sendJson(res, 401, { error: "Сессия не найдена. Обнови страницу." });
    return;
  }

  if (!merchantAddress) {
    sendJson(res, 400, { error: "Для приема оплат нужно указать MERCHANT_TON_ADDRESS в .env." });
    return;
  }

  const orderId = randomUUID().slice(0, 8).toUpperCase();
  const comment = `AIPOST-${orderId}`;
  const amountNano = toNano(priceTon);
  const paymentUrl = `ton://transfer/${merchantAddress}?amount=${amountNano}&text=${encodeURIComponent(comment)}`;
  const order = {
    id: orderId,
    token: session.token,
    comment,
    amountNano,
    status: "pending",
    createdAt: Date.now()
  };
  orders.set(orderId, order);
  saveStore();

  sendJson(res, 200, {
    orderId,
    comment,
    amountTon: priceTon,
    amountNano,
    generations: generationsPerPayment,
    paymentUrl,
    expiresAt: order.createdAt + 30 * 60 * 1000
  });
}

function objectContainsPayment(value, comment, amountNano) {
  const text = JSON.stringify(value);
  if (!text.includes(comment)) {
    return false;
  }

  const expected = BigInt(amountNano);
  const amounts = [...text.matchAll(/"amount"\s*:\s*"?(\d+)"?/g)].map((match) => BigInt(match[1]));
  const values = [...text.matchAll(/"value"\s*:\s*"?(\d+)"?/g)].map((match) => BigInt(match[1]));
  return [...amounts, ...values].some((amount) => amount >= expected);
}

async function checkTonPayment(order) {
  if (!merchantAddress) {
    return false;
  }

  const headers = process.env.TONAPI_KEY ? { "authorization": `Bearer ${process.env.TONAPI_KEY}` } : {};
  const tonapiUrl = `https://tonapi.io/v2/accounts/${encodeURIComponent(merchantAddress)}/events?limit=30`;
  const tonapiResponse = await fetch(tonapiUrl, { headers });
  if (tonapiResponse.ok) {
    const data = await tonapiResponse.json();
    if (objectContainsPayment(data, order.comment, order.amountNano)) {
      return true;
    }
  }

  const toncenterUrl = `https://toncenter.com/api/v3/actions?account=${encodeURIComponent(merchantAddress)}&action_type=ton_transfer&limit=50&sort=desc&include_accounts=true`;
  const toncenterResponse = await fetch(toncenterUrl);
  if (toncenterResponse.ok) {
    const data = await toncenterResponse.json();
    return objectContainsPayment(data, order.comment, order.amountNano);
  }

  return false;
}

async function handleVerifyOrder(req, res) {
  try {
    const body = await readJson(req);
    const session = getSession(body.token);
    const order = orders.get(String(body.orderId || ""));

    if (!session || !order || order.token !== session.token) {
      sendJson(res, 404, { error: "Заказ не найден." });
      return;
    }

    if (order.status === "paid") {
      sendJson(res, 200, { paid: true, credits: session.credits, added: 0 });
      return;
    }

    const paid = await checkTonPayment(order);
    if (!paid) {
      sendJson(res, 200, { paid: false, credits: session.credits });
      return;
    }

    order.status = "paid";
    session.credits += generationsPerPayment;
    saveStore();
    sendJson(res, 200, { paid: true, credits: session.credits, added: generationsPerPayment });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Payment verification failed" });
  }
}

async function handleGenerate(req, res) {
  try {
    const body = await readJson(req);
    const session = getSession(body.token);
    if (!session) {
      sendJson(res, 401, { error: "Сессия не найдена. Обнови страницу." });
      return;
    }

    if (session.credits <= 0) {
      sendJson(res, 402, { error: "Закончились генерации. Купи пакет через TON.", credits: 0, config: getConfig() });
      return;
    }

    const input = {
      niche: cleanInput(body.niche, 120),
      offer: cleanInput(body.offer, 280),
      audience: cleanInput(body.audience, 180),
      tone: cleanInput(body.tone, 80),
      platform: cleanInput(body.platform, 80) || "Telegram"
    };

    if (!input.niche || !input.offer) {
      sendJson(res, 400, { error: "Заполни нишу и оффер." });
      return;
    }

    const generated = await generateWithProvider(input);
    session.credits -= 1;
    saveStore();
    sendJson(res, 200, { ...generated, credits: session.credits });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Generation failed" });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/session") {
    handleSession(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/config") {
    handleConfig(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/order") {
    handleCreateOrder(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/verify") {
    handleVerifyOrder(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/generate") {
    handleGenerate(req, res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
}).listen(port, () => {
  console.log(`AI post generator is running: http://localhost:${port}`);
});
