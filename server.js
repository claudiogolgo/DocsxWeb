const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

// Carrega o .env sempre a partir da pasta do server.js, mesmo que o Node seja executado
// de outro diretório. Também aceita ENV_PATH=/caminho/para/.env se você quiser apontar manualmente.
const ENV_PATH = process.env.ENV_PATH || path.join(__dirname, ".env");
const envResult = dotenv.config({ path: ENV_PATH });

const express = require("express");
const cors = require("cors");
const cheerio = require("cheerio");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;
const ENV_LOADED = !envResult.error && fs.existsSync(ENV_PATH);

const MAX_RESULTS = 50;
const RECEITA_URL = "https://normas.receita.fazenda.gov.br/sijut2consulta/consulta.action";
const RECEITA_TIMEOUT_MS = Number(process.env.RECEITA_TIMEOUT_MS || 12000);
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 25000);

app.use(cors());
app.use(express.json({ limit: "4mb" }));
app.use(express.static("public"));

function getOpenAIKey() {
  // Remove aspas acidentais, espaços invisíveis e prefixo "export" quando o .env foi colado como shell script.
  return String(process.env.OPENAI_API_KEY || "")
    .replace(/^export\s+/i, "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function chaveOpenAIConfigurada() {
  const key = getOpenAIKey();
  return Boolean(key && key.startsWith("sk-") && !key.includes("cole_sua_chave") && key.length > 40);
}

const openai = chaveOpenAIConfigurada()
  ? new OpenAI({ apiKey: getOpenAIKey() })
  : null;

function normalizarTexto(txt = "") {
  return String(txt)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extrairArgumentosObrigatorios(query = "") {
  const q = String(query || "").trim();
  if (!q) return [];

  // Se houver conector E/AND, cada bloco é obrigatório.
  if (/\s+(e|and)\s+/i.test(q)) {
    return q
      .split(/\s+(?:e|E|and|AND)\s+/)
      .map(s => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  }

  // Sem conector, cada termo relevante vira obrigatório.
  const stop = new Set(["de", "da", "do", "das", "dos", "a", "o", "as", "os", "em", "no", "na", "nos", "nas", "por", "para", "com", "sem", "sobre"]);
  const frases = [...q.matchAll(/"([^"]+)"/g)].map(m => m[1].trim()).filter(Boolean);
  const semFrases = q.replace(/"[^"]+"/g, " ");
  const termos = semFrases
    .split(/\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 2 && !stop.has(normalizarTexto(s)));

  return [...frases, ...termos];
}

function cardContemTodosArgumentos(card, argumentos) {
  const texto = normalizarTexto([
    card.titulo,
    card.resumo,
    card.ementa,
    card.textoCompleto,
    card.numero,
    card.orgao,
    card.assunto,
    card.link
  ].filter(Boolean).join(" "));

  return argumentos.every(arg => texto.includes(normalizarTexto(arg)));
}

function montarUrlReceita(query, pagina = 1) {
  const url = new URL(RECEITA_URL);
  url.searchParams.set("termoBusca", query);
  url.searchParams.set("tipoConsulta", "formulario");
  url.searchParams.set("p", String(pagina));
  url.searchParams.set("optOrdem", "relevancia");
  url.searchParams.set("tipoData", "2");
  // Solução de Consulta, Solução de Consulta Interna e Solução de Divergência.
  url.searchParams.set("tiposAtosSelecionados", "72;75;73");
  url.searchParams.set("lblTiposAtosSelecionados", "SC; SCI; SD");
  return url.toString();
}

async function baixarHtml(url, timeoutMs = RECEITA_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8"
      }
    });

    if (!resp.ok) throw new Error(`Erro ao consultar Receita Federal: HTTP ${resp.status}`);
    return await resp.text();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Timeout ao consultar Receita Federal após ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function textoLimpo($, el) {
  return $(el).text().replace(/\s+/g, " ").trim();
}

function absolutizarLink(href) {
  if (!href) return "";
  try {
    return new URL(href, RECEITA_URL).toString();
  } catch {
    return "";
  }
}

function extrairCardsDoHtml(html, urlOrigem) {
  const $ = cheerio.load(html);
  const cards = [];

  // Estratégia principal: links para atos/documentos, pegando o bloco pai como card.
  const links = $("a[href]").toArray();
  for (const a of links) {
    const href = $(a).attr("href") || "";
    const link = absolutizarLink(href);
    const textoA = textoLimpo($, a);
    const hrefNorm = href.toLowerCase();

    const pareceAto =
      /normasinternet|consulta|ato|exibir|visualizar|idato|id=|numero/i.test(href) ||
      /solu[cç][aã]o de consulta|solu[cç][aã]o de diverg[eê]ncia/i.test(textoA);

    if (!pareceAto) continue;

    let bloco = $(a).closest("li, tr, article, .resultado, .result, .card, .row, div");
    let raw = textoLimpo($, bloco);

    if (!raw || raw.length < 60) {
      raw = textoA;
      bloco = $(a).parent();
    }
    if (!raw || raw.length < 40) continue;

    const titulo =
      raw.match(/Solu[cç][aã]o de Consulta[^\n.;]{0,180}/i)?.[0] ||
      raw.match(/Solu[cç][aã]o de Diverg[eê]ncia[^\n.;]{0,180}/i)?.[0] ||
      textoA ||
      raw.slice(0, 160);

    cards.push({
      titulo,
      resumo: raw.slice(0, 900),
      ementa: raw,
      textoCompleto: raw,
      link: link || urlOrigem,
      fonte: "Receita Federal - SIJUT"
    });
  }

  // Fallback: quando o HTML vem sem links úteis, divide por blocos textuais com “Assunto:” ou “Solução”.
  if (cards.length === 0) {
    const body = $("body").text().replace(/\s+/g, " ").trim();
    const partes = body
      .split(/(?=SOLU[CÇ][AÃ]O DE CONSULTA|Solu[cç][aã]o de Consulta|Assunto:)/g)
      .map(s => s.trim())
      .filter(s => s.length > 80);

    for (const parte of partes.slice(0, MAX_RESULTS * 2)) {
      cards.push({
        titulo: parte.match(/Solu[cç][aã]o de Consulta[^.]{0,180}/i)?.[0] || parte.slice(0, 160),
        resumo: parte.slice(0, 900),
        ementa: parte,
        textoCompleto: parte,
        link: urlOrigem,
        fonte: "Receita Federal - SIJUT"
      });
    }
  }

  return cards;
}

async function buscarReceita(query) {
  const paginas = [1, 2, 3, 4, 5]; // tenta chegar a 50, mas sem travar.

  const resultados = await Promise.allSettled(
    paginas.map(async (pagina) => {
      const url = montarUrlReceita(query, pagina);
      const html = await baixarHtml(url);
      return extrairCardsDoHtml(html, url);
    })
  );

  const erros = resultados
    .filter(r => r.status === "rejected")
    .map(r => r.reason?.message || String(r.reason));

  const todos = resultados
    .filter(r => r.status === "fulfilled")
    .flatMap(r => r.value);

  const vistos = new Set();
  const cards = todos.filter(card => {
    const key = normalizarTexto(`${card.titulo}|${card.link}|${(card.resumo || "").slice(0, 180)}`);
    if (vistos.has(key)) return false;
    vistos.add(key);
    return true;
  });

  return { cards, erros };
}

function montarRag(cardsValidos) {
  return cardsValidos
    .slice(0, MAX_RESULTS)
    .map((card, i) => `[${i + 1}]\nFonte: ${card.fonte || "Receita Federal"}\nTítulo: ${card.titulo || ""}\nLink: ${card.link || ""}\nTexto:\n${card.textoCompleto || card.ementa || card.resumo || ""}`)
    .join("\n\n---\n\n");
}

async function interpretar(query, argumentos, rag) {
  if (!rag.trim()) return "RAG vazio: nenhum card encontrado contendo todos os argumentos obrigatórios.";
  if (!openai) {
    const detalhe = ENV_LOADED
      ? `Arquivo .env carregado de ${ENV_PATH}, mas OPENAI_API_KEY não passou na validação.`
      : `Arquivo .env não encontrado/carregado em ${ENV_PATH}.`;
    return `OPENAI_API_KEY ausente ou inválida. ${detalhe} O RAG foi montado normalmente, mas a interpretação automática não foi executada.`;
  }

  let completion;
  try {
    completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    temperature: 0.1,
    messages: [
      { role: "system", content: "Você é um assistente jurídico-tributário. Responda somente com base no RAG fornecido. Não invente. Se o RAG não for suficiente, diga objetivamente." },
      { role: "user", content: `Pesquisa: ${query}\n\nArgumentos obrigatórios:\n${argumentos.map(a => `- ${a}`).join("\n")}\n\nRAG:\n${rag}\n\nFaça uma interpretação objetiva, citando os itens do RAG entre colchetes quando relevantes.` }
    ]
  }, { timeout: OPENAI_TIMEOUT_MS });
  } catch (err) {
    console.error("Erro OpenAI:", err.message || err);
    return `Erro ao executar a interpretação automática pela OpenAI: ${err.message || "verifique a OPENAI_API_KEY e o modelo configurado"}. O RAG foi mantido abaixo para conferência.`;
  }

  return completion.choices?.[0]?.message?.content?.trim() || "";
}

app.get("/api/status", (req, res) => {
  const key = getOpenAIKey();
  res.json({
    envPath: ENV_PATH,
    envLoaded: ENV_LOADED,
    openaiKeyPresent: Boolean(key),
    openaiKeyValid: chaveOpenAIConfigurada(),
    openaiKeyPrefix: key ? key.slice(0, 8) + "..." : null,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini"
  });
});

app.post("/api/pesquisar", async (req, res) => {
  try {
    const query = String(req.body.query || "").trim();
    if (!query) return res.status(400).json({ error: "Informe a pesquisa." });

    const argumentos = extrairArgumentosObrigatorios(query);
    const resultadoReceita = await buscarReceita(query);
    const cardsBrutos = resultadoReceita.cards || [];

    const cardsValidos = cardsBrutos
      .filter(card => cardContemTodosArgumentos(card, argumentos))
      .slice(0, MAX_RESULTS);

    const rag = montarRag(cardsValidos);

    // A interpretação não pode travar a resposta. Se a OpenAI falhar/estourar timeout,
    // cards e RAG ainda voltam normalmente para a tela.
    const interpretacao = await interpretar(query, argumentos, rag);

    res.json({
      query,
      argumentos,
      totalBruto: cardsBrutos.length,
      totalValidos: cardsValidos.length,
      cards: cardsValidos,
      rag,
      interpretacao,
      debug: {
        primeiraUrl: montarUrlReceita(query, 1),
        errosReceita: resultadoReceita.erros || [],
        aviso: cardsValidos.length === 0
          ? "Nenhum resultado passou no filtro de TODOS os argumentos. Tente reduzir os termos obrigatórios ou usar conector E apenas entre termos essenciais."
          : "OK"
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Erro inesperado." });
  }
});

app.listen(PORT, () => {
  console.log(`App Receita SIJUT rodando em http://localhost:${PORT}`);
  console.log(`ENV_PATH: ${ENV_PATH}`);
  console.log(ENV_LOADED ? ".env carregado." : ".env não encontrado/carregado.");
  console.log(openai ? "OPENAI_API_KEY carregada: interpretação automática ativa." : "OPENAI_API_KEY não configurada: cards e RAG ativos; interpretação automática inativa.");
});
