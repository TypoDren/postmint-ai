const form = document.querySelector("#generatorForm");
const result = document.querySelector("#result");
const status = document.querySelector("#status");
const button = document.querySelector("#generateButton");
const copyButton = document.querySelector("#copyButton");
const buyButton = document.querySelector("#buyButton");
const heroBuyButton = document.querySelector("#heroBuyButton");
const creditsCount = document.querySelector("#creditsCount");
const packGenerations = document.querySelector("#packGenerations");
const packPrice = document.querySelector("#packPrice");
const metricPack = document.querySelector("#metricPack");
const metricPrice = document.querySelector("#metricPrice");
const pricingBlock = document.querySelector("#pricingBlock");
const paymentDialog = document.querySelector("#paymentDialog");
const closePayment = document.querySelector("#closePayment");
const paymentAmount = document.querySelector("#paymentAmount");
const paymentComment = document.querySelector("#paymentComment");
const paymentLink = document.querySelector("#paymentLink");
const verifyButton = document.querySelector("#verifyButton");
const paymentStatus = document.querySelector("#paymentStatus");

let token = localStorage.getItem("postmint_session");
let activeOrder = null;

const templates = {
  phone: {
    niche: "Смартфон",
    offer: "iPhone 14 Pro 256 ГБ, темный, аккуратное состояние, Face ID работает, батарея держит день, коробка и кабель, цена 48 000 рублей, Москва",
    audience: "человек, который хочет надежный флагман без переплаты за новый",
    tone: "спокойный и доверительный",
    platform: "Avito"
  },
  clothes: {
    niche: "Женская одежда",
    offer: "платье миди, размер S-M, надето 1 раз, плотная ткань, хорошо садится по фигуре, можно примерить, цена 2500 рублей",
    audience: "девушка, которой нужен аккуратный образ на вечер или мероприятие",
    tone: "живой и дружелюбный",
    platform: "Telegram"
  },
  service: {
    niche: "Услуга ремонта",
    offer: "мастер по мелкому ремонту квартир: розетки, полки, смесители, сборка мебели, выезд по городу, оплата после результата",
    audience: "занятые люди, которым нужно быстро решить бытовую задачу без поиска нескольких мастеров",
    tone: "короткий и деловой",
    platform: "Avito"
  }
};

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Ошибка запроса");
  }
  return data;
}

function updateCredits(credits) {
  creditsCount.textContent = String(credits);
  buyButton.classList.toggle("pulse", Number(credits) <= 0);
}

function updateConfig(config) {
  packGenerations.textContent = config.generationsPerPayment;
  packPrice.textContent = config.priceTon;
  metricPack.textContent = config.generationsPerPayment;
  metricPrice.textContent = config.priceTon;

  if (!config.paidEnabled) {
    buyButton.disabled = true;
    buyButton.textContent = "Добавь TON-адрес в .env";
    pricingBlock.classList.add("disabled");
  }
}

async function initSession() {
  const config = await fetch("/api/config").then((response) => response.json());
  updateConfig(config);

  if (token) {
    creditsCount.textContent = localStorage.getItem("postmint_credits") || "...";
    return;
  }

  const session = await postJson("/api/session", {});
  token = session.token;
  localStorage.setItem("postmint_session", token);
  localStorage.setItem("postmint_credits", session.credits);
  updateCredits(session.credits);
}

function fillTemplate(name) {
  const template = templates[name];
  if (!template) {
    return;
  }

  for (const [field, value] of Object.entries(template)) {
    const input = form.elements[field];
    if (input) {
      input.value = value;
    }
  }

  document.querySelector("#generator").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function openPaymentDialog() {
  paymentStatus.textContent = "";

  try {
    activeOrder = await postJson("/api/order", { token });
    paymentAmount.textContent = activeOrder.amountTon;
    paymentComment.textContent = activeOrder.comment;
    paymentLink.href = activeOrder.paymentUrl;
    paymentDialog.showModal();
  } catch (error) {
    status.textContent = error.message;
  }
}

document.querySelectorAll("[data-template]").forEach((templateButton) => {
  templateButton.addEventListener("click", () => fillTemplate(templateButton.dataset.template));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(form).entries());

  button.disabled = true;
  button.querySelector("span").textContent = "Генерирую...";
  status.textContent = "";

  try {
    const data = await postJson("/api/generate", { ...payload, token });
    result.textContent = data.text;
    localStorage.setItem("postmint_credits", data.credits);
    updateCredits(data.credits);
    status.textContent = data.demo
      ? "Демо-ответ: провайдер AI недоступен."
      : `Сгенерировано через ${data.provider || "AI"}.`;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = "Сгенерировать объявление";
  }
});

buyButton.addEventListener("click", openPaymentDialog);
heroBuyButton.addEventListener("click", openPaymentDialog);

verifyButton.addEventListener("click", async () => {
  if (!activeOrder) {
    return;
  }

  verifyButton.disabled = true;
  paymentStatus.textContent = "Проверяю транзакции...";

  try {
    const data = await postJson("/api/verify", { token, orderId: activeOrder.orderId });
    updateCredits(data.credits);
    localStorage.setItem("postmint_credits", data.credits);

    if (data.paid) {
      paymentStatus.textContent = data.added
        ? `Оплата найдена. Добавлено генераций: ${data.added}.`
        : "Этот заказ уже был активирован.";
      setTimeout(() => paymentDialog.close(), 1200);
    } else {
      paymentStatus.textContent = "Пока не вижу оплату. Подожди 10-30 секунд и нажми проверку еще раз.";
    }
  } catch (error) {
    paymentStatus.textContent = error.message;
  } finally {
    verifyButton.disabled = false;
  }
});

closePayment.addEventListener("click", () => paymentDialog.close());

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(result.textContent);
  const previous = copyButton.textContent;
  copyButton.textContent = "Done";
  setTimeout(() => {
    copyButton.textContent = previous;
  }, 1200);
});

initSession().catch((error) => {
  status.textContent = error.message;
});
