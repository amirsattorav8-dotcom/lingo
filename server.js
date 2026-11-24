// Подключаем встроенный модуль для создания сервера
const http = require("http");

// Модули для чтения файлов сайта
const fs = require("fs");
const path = require("path");

// Порт сервера (хостинг сам задаёт его, на компьютере будет 3000)
const PORT = process.env.PORT || 3000;

// Максимальная длина текста
const MAX_CHARS = 5000;

// Ключ Google (необязательно): GOOGLE_TRANSLATE_API_KEY=ключ node server.js
const API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY || "";

// Коды языков, которые мы поддерживаем
const languageCodes = [
  "ru", "en", "tg", "de", "fr", "es", "zh-CN", "ar", "it", "pt",
  "tr", "ja", "ko", "hi", "fa", "uz", "kk", "uk", "pl", "nl"
];

// Отправляем ответ браузеру в формате JSON
// Здесь же включаем CORS, чтобы страница из Live Server могла к нам обращаться
function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

// Отправляем файл сайта (index.html или style.css)
function sendFile(res, fileName, type) {
  fs.readFile(path.join(__dirname, fileName), function (error, content) {
    if (error) {
      sendJson(res, 404, { error: "Файл не найден." });
      return;
    }
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  });
}

// Бесплатный перевод Google (ключ не нужен)
async function translateFree(text, source, target) {
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=" + source + "&tl=" + target;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "q=" + encodeURIComponent(text),
    signal: AbortSignal.timeout(15000)
  });

  // Если Google ограничил запросы
  if (response.status === 429) {
    return { error: "Сервис перевода временно ограничил запросы. Попробуйте позже." };
  }
  if (!response.ok) {
    return { error: "Не удалось получить перевод. Попробуйте ещё раз." };
  }

  // Собираем перевод из частей
  const data = await response.json();
  let result = "";
  for (let i = 0; i < data[0].length; i++) {
    if (data[0][i] && data[0][i][0]) {
      result = result + data[0][i][0];
    }
  }
  return { translation: result, detected: data[2] };
}

// Официальный перевод Google Cloud (нужен ключ)
async function translateOfficial(text, source, target) {
  const url = "https://translation.googleapis.com/language/translate/v2?key=" + API_KEY;
  const body = { q: text, target: target, format: "text" };
  if (source !== "auto") {
    body.source = source;
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });

  // Если ключ не подошёл
  if (response.status === 400 || response.status === 403) {
    return { error: "Ошибка Google API. Проверьте ключ." };
  }
  if (!response.ok) {
    return { error: "Не удалось получить перевод. Попробуйте ещё раз." };
  }

  const data = await response.json();
  const item = data.data.translations[0];
  return { translation: item.translatedText, detected: item.detectedSourceLanguage || source };
}

// Обрабатываем запрос на перевод
async function handleTranslate(res, body) {
  // Превращаем текст запроса в объект
  let data = null;
  try {
    data = JSON.parse(body);
  } catch (error) {
    sendJson(res, 400, { error: "Некорректный запрос." });
    return;
  }

  const text = data.text;
  const source = data.source || "auto";
  const target = data.target;

  // Проверяем данные
  if (typeof text !== "string" || text.trim() === "") {
    sendJson(res, 400, { error: "Введите текст для перевода." });
    return;
  }
  if (text.length > MAX_CHARS) {
    sendJson(res, 400, { error: "Текст длиннее " + MAX_CHARS + " символов." });
    return;
  }
  if (languageCodes.indexOf(target) === -1) {
    sendJson(res, 400, { error: "Выберите язык перевода." });
    return;
  }
  if (source !== "auto" && languageCodes.indexOf(source) === -1) {
    sendJson(res, 400, { error: "Неизвестный исходный язык." });
    return;
  }

  // Переводим и отправляем результат
  try {
    let result = null;
    if (API_KEY !== "") {
      result = await translateOfficial(text, source, target);
    } else {
      result = await translateFree(text, source, target);
    }
    if (result.error) {
      sendJson(res, 502, { error: result.error });
    } else {
      sendJson(res, 200, { translation: result.translation, detected: result.detected });
    }
  } catch (error) {
    if (error.name === "TimeoutError") {
      sendJson(res, 504, { error: "Сервис перевода не ответил вовремя." });
    } else {
      sendJson(res, 502, { error: "Не удалось получить перевод. Проверьте интернет." });
    }
  }
}

// Создаём сервер и смотрим, какой запрос пришёл
const server = http.createServer(function (req, res) {
  // Браузер сначала спрашивает разрешение (CORS), отвечаем «можно»
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  // Адрес без лишнего после знака вопроса
  const address = req.url.split("?")[0];

  // Главная страница
  if (req.method === "GET" && (address === "/" || address === "/index.html")) {
    sendFile(res, "index.html", "text/html; charset=utf-8");
    return;
  }

  // Стили страницы
  if (req.method === "GET" && address === "/style.css") {
    sendFile(res, "style.css", "text/css; charset=utf-8");
    return;
  }

  // Отдаём JavaScript для страницы
  if (req.method === "GET" && address === "/script.js") {
    res.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(pageScript);
    return;
  }

  // Запрос на перевод
  if (req.method === "POST" && address === "/api/translate") {
    let body = "";
    req.on("data", function (part) {
      body = body + part;
      // Слишком большой запрос не принимаем
      if (body.length > 100000) {
        req.destroy();
      }
    });
    req.on("end", function () {
      handleTranslate(res, body);
    });
    return;
  }

  // Все остальные адреса не существуют
  sendJson(res, 404, { error: "Страница не найдена." });
});

// Запускаем сервер
server.listen(PORT, function () {
  console.log("Сервер перевода LINGO запущен: http://localhost:" + PORT);
});

// JavaScript для страницы index.html (отдаётся по адресу /script.js)
const pageScript = String.raw`
// Сервер на том же адресе, что и страница
var serverUrl = "";

// Названия языков
var languages = {
  "ru": "Русский", "en": "English", "tg": "Тоҷикӣ", "de": "Deutsch",
  "fr": "Français", "es": "Español", "zh-CN": "中文", "ar": "العربية",
  "it": "Italiano", "pt": "Português", "tr": "Türkçe", "ja": "日本語",
  "ko": "한국어", "hi": "हिन्दी", "fa": "فارسی", "uz": "Oʻzbek",
  "kk": "Қазақша", "uk": "Українська", "pl": "Polski", "nl": "Nederlands"
};

// Тексты интерфейса на трёх языках
var texts = {
  ru: {
    subtitle: "Переводчик", history: "История", inputPlaceholder: "Введите текст",
    outputPlaceholder: "Перевод появится здесь", translate: "Перевести", copy: "Скопировать",
    copied: "Скопировано ✓", clear: "Очистить", loading: "Переводим...", retry: "Повторить",
    auto: "Определить язык", detected: "Определён язык:", clearHistory: "Очистить историю",
    emptyHistory: "История пока пуста", errNetwork: "Нет связи с сервером. Запустите его командой: node server.js",
    errServer: "Ошибка сервера. Повторите попытку.", errSwap: "Сначала выполните перевод, чтобы определить язык.",
    errCopy: "Не удалось скопировать.", errEmpty: "Введите текст для перевода."
  },
  en: {
    subtitle: "Translator", history: "History", inputPlaceholder: "Enter text",
    outputPlaceholder: "Translation will appear here", translate: "Translate", copy: "Copy",
    copied: "Copied ✓", clear: "Clear", loading: "Translating...", retry: "Retry",
    auto: "Detect language", detected: "Detected language:", clearHistory: "Clear history",
    emptyHistory: "History is empty", errNetwork: "Can't reach the server. Start it with: node server.js",
    errServer: "Server error. Please try again.", errSwap: "Translate first so the language can be detected.",
    errCopy: "Couldn't copy.", errEmpty: "Enter text to translate."
  },
  tg: {
    subtitle: "Тарҷумон", history: "Таърих", inputPlaceholder: "Матнро ворид кунед",
    outputPlaceholder: "Тарҷума дар ин ҷо пайдо мешавад", translate: "Тарҷума кардан", copy: "Нусха гирифтан",
    copied: "Нусха шуд ✓", clear: "Тоза кардан", loading: "Тарҷума шуда истодааст...", retry: "Такрор кардан",
    auto: "Муайян кардани забон", detected: "Забони муайяншуда:", clearHistory: "Тоза кардани таърих",
    emptyHistory: "Таърих холӣ аст", errNetwork: "Бо сервер алоқа нест. Онро бо фармони node server.js оғоз кунед.",
    errServer: "Хатои сервер. Дубора кӯшиш кунед.", errSwap: "Аввал тарҷума кунед, то забон муайян шавад.",
    errCopy: "Нусха гирифта нашуд.", errEmpty: "Матнро ворид кунед."
  }
};

// Язык интерфейса берём из памяти браузера
var interfaceLanguage = localStorage.getItem("lingoInterface") || "ru";
if (!texts[interfaceLanguage]) {
  interfaceLanguage = "ru";
}

// Язык, который сервер определил сам
var detectedLanguage = "";

// История переводов берём из памяти браузера
var savedItems = [];
try {
  savedItems = JSON.parse(localStorage.getItem("lingoHistory")) || [];
} catch (error) {
  savedItems = [];
}

// Находим элементы на странице
var inputText = document.getElementById("inputText");
var outputText = document.getElementById("outputText");
var fromLang = document.getElementById("fromLang");
var toLang = document.getElementById("toLang");
var interfaceLang = document.getElementById("interfaceLang");
var counter = document.getElementById("counter");
var detectedText = document.getElementById("detectedText");
var loader = document.getElementById("loader");
var errorBox = document.getElementById("errorBox");
var errorText = document.getElementById("errorText");
var retryButton = document.getElementById("retryButton");
var translateButton = document.getElementById("translateButton");
var copyButton = document.getElementById("copyButton");
var historyPanel = document.getElementById("historyPanel");
var historyList = document.getElementById("historyList");
var shadow = document.getElementById("shadow");

// Картинки для значка: копирование и галочка
var copyIcon = "<svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='dimgray' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='3' y='9' width='12' height='12' rx='2'></rect><path d='M9 9V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4'></path></svg>";
var checkIcon = "<svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='green' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><path d='M5 13l4 4L19 7'></path></svg>";

// Кнопка копирования становится значком в углу перевода
copyButton.removeAttribute("data-text");
copyButton.className = "";
copyButton.innerHTML = copyIcon;
copyButton.style.cssText = "position: absolute; top: 10px; right: 10px; width: 36px; height: 36px; border-style: none; border-radius: 8px; background-color: transparent; cursor: pointer;";
copyButton.onmouseover = function () {
  copyButton.style.backgroundColor = "aliceblue";
};
copyButton.onmouseout = function () {
  copyButton.style.backgroundColor = "transparent";
};
outputText.parentNode.appendChild(copyButton);

// Кнопку «Очистить» убираем со страницы
document.getElementById("clearButton").remove();

// Берём текст на выбранном языке интерфейса
function t(key) {
  return texts[interfaceLanguage][key];
}

// Показываем название языка по коду
function langName(code) {
  return languages[code] || code;
}

// Меняем все надписи на странице
function applyInterface() {
  document.documentElement.lang = interfaceLanguage;
  var items = document.querySelectorAll("[data-text]");
  for (var i = 0; i < items.length; i++) {
    items[i].textContent = t(items[i].getAttribute("data-text"));
  }
  var fields = document.querySelectorAll("[data-placeholder]");
  for (var j = 0; j < fields.length; j++) {
    fields[j].placeholder = t(fields[j].getAttribute("data-placeholder"));
  }
  fromLang.options[0].textContent = t("auto");
  interfaceLang.value = interfaceLanguage;
  copyButton.title = t("copy");
  showDetected();
  showHistory();
}

// Заполняем списки языков
function fillLanguages() {
  var auto = document.createElement("option");
  auto.value = "auto";
  auto.textContent = t("auto");
  fromLang.appendChild(auto);
  for (var code in languages) {
    var option1 = document.createElement("option");
    option1.value = code;
    option1.textContent = languages[code];
    fromLang.appendChild(option1);
    var option2 = document.createElement("option");
    option2.value = code;
    option2.textContent = languages[code];
    toLang.appendChild(option2);
  }
  // Вспоминаем прошлый выбор языков
  var savedFrom = localStorage.getItem("lingoFrom");
  var savedTo = localStorage.getItem("lingoTo");
  if (savedFrom === "auto" || languages[savedFrom]) {
    fromLang.value = savedFrom;
  }
  toLang.value = languages[savedTo] ? savedTo : "en";
}

// Запоминаем выбранные языки
function saveLanguages() {
  localStorage.setItem("lingoFrom", fromLang.value);
  localStorage.setItem("lingoTo", toLang.value);
}

// Показываем, какой язык определился
function showDetected() {
  if (detectedLanguage !== "" && fromLang.value === "auto") {
    detectedText.textContent = t("detected") + " " + langName(detectedLanguage);
  } else {
    detectedText.textContent = "";
  }
}

// Считаем символы в поле
function updateCounter() {
  counter.textContent = inputText.value.length + " / 5000";
}

// Показываем ошибку (и кнопку «Повторить», если нужно)
function showError(message, canRetry) {
  errorText.textContent = message;
  retryButton.hidden = !canRetry;
  errorBox.hidden = false;
}

// Отправляем текст на сервер и показываем перевод
async function translateText() {
  var text = inputText.value.trim();
  if (text === "") {
    showError(t("errEmpty"), false);
    return;
  }
  errorBox.hidden = true;
  loader.hidden = false;
  translateButton.disabled = true;
  try {
    var response = await fetch(serverUrl + "/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text, source: fromLang.value, target: toLang.value })
    });
    var data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }
    if (!response.ok) {
      showError(data.error || t("errServer"), true);
    } else {
      outputText.value = data.translation;
      detectedLanguage = data.detected || "";
      showDetected();
      addToHistory(text, data.translation, detectedLanguage || fromLang.value, toLang.value);
    }
  } catch (error) {
    showError(t("errNetwork"), true);
  }
  loader.hidden = true;
  translateButton.disabled = false;
}

// Меняем языки и тексты местами
function swapLanguages() {
  var from = fromLang.value;
  if (from === "auto") {
    from = detectedLanguage;
  }
  if (!languages[from]) {
    showError(t("errSwap"), false);
    return;
  }
  errorBox.hidden = true;
  var to = toLang.value;
  fromLang.value = to;
  toLang.value = from;
  var oldText = inputText.value;
  inputText.value = outputText.value;
  outputText.value = oldText;
  detectedLanguage = "";
  showDetected();
  updateCounter();
  saveLanguages();
}

// Показываем галочку на секунду
function showCopied() {
  copyButton.innerHTML = checkIcon;
  setTimeout(function () {
    copyButton.innerHTML = copyIcon;
  }, 1500);
}

// Копируем перевод
async function copyText() {
  if (outputText.value === "") {
    return;
  }
  try {
    await navigator.clipboard.writeText(outputText.value);
    showCopied();
  } catch (error) {
    outputText.select();
    if (document.execCommand("copy")) {
      showCopied();
    } else {
      showError(t("errCopy"), false);
    }
  }
}

// Добавляем перевод в историю (не больше 50 записей)
function addToHistory(text, translation, from, to) {
  var item = { text: text, translation: translation, from: from, to: to };
  var newList = [item];
  for (var i = 0; i < savedItems.length; i++) {
    if (savedItems[i].text !== text || savedItems[i].to !== to) {
      newList.push(savedItems[i]);
    }
  }
  savedItems = newList.slice(0, 50);
  saveHistory();
}

// Сохраняем историю в браузере
function saveHistory() {
  localStorage.setItem("lingoHistory", JSON.stringify(savedItems));
  showHistory();
}

// Открываем запись из истории
function openItem(item) {
  inputText.value = item.text;
  outputText.value = item.translation;
  if (languages[item.from]) {
    fromLang.value = item.from;
  }
  toLang.value = item.to;
  detectedLanguage = "";
  showDetected();
  updateCounter();
  saveLanguages();
  closeHistory();
}

// Рисуем список истории
function showHistory() {
  historyList.innerHTML = "";
  if (savedItems.length === 0) {
    historyList.textContent = t("emptyHistory");
    return;
  }
  savedItems.forEach(function (item) {
    var box = document.createElement("div");
    box.className = "box22";
    var line1 = document.createElement("div");
    line1.className = "box23";
    line1.textContent = langName(item.from) + " → " + langName(item.to);
    var line2 = document.createElement("div");
    line2.className = "box24";
    line2.textContent = item.text;
    var line3 = document.createElement("div");
    line3.className = "box24 box25";
    line3.textContent = item.translation;
    box.appendChild(line1);
    box.appendChild(line2);
    box.appendChild(line3);
    box.onclick = function () {
      openItem(item);
    };
    historyList.appendChild(box);
  });
}

// Открываем панель истории
function openHistory() {
  historyPanel.classList.add("box20");
  shadow.hidden = false;
}

// Закрываем панель истории
function closeHistory() {
  historyPanel.classList.remove("box20");
  shadow.hidden = true;
}

// Кнопки перевода и повтора
translateButton.onclick = translateText;
retryButton.onclick = translateText;

// Кнопки смены языков и копирования
document.getElementById("swapButton").onclick = swapLanguages;
copyButton.onclick = copyText;

// Кнопки истории
document.getElementById("historyButton").onclick = openHistory;
document.getElementById("closeButton").onclick = closeHistory;
shadow.onclick = closeHistory;
document.getElementById("clearHistoryButton").onclick = function () {
  savedItems = [];
  saveHistory();
};

// Счётчик символов и перевод по Ctrl+Enter
inputText.oninput = updateCounter;
inputText.onkeydown = function (event) {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    translateText();
  }
};

// Выбор языков
fromLang.onchange = function () {
  detectedLanguage = "";
  showDetected();
  saveLanguages();
};
toLang.onchange = saveLanguages;

// Смена языка интерфейса
interfaceLang.onchange = function () {
  interfaceLanguage = interfaceLang.value;
  localStorage.setItem("lingoInterface", interfaceLanguage);
  applyInterface();
};

// Запуск страницы
fillLanguages();
applyInterface();
updateCounter();
`;
