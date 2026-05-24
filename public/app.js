const $ = (id) => document.getElementById(id);

$("btn").addEventListener("click", pesquisar);
$("query").addEventListener("keydown", (e) => {
  if (e.key === "Enter") pesquisar();
});

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderCards(cards) {
  const container = $("resultados");
  container.innerHTML = "";

  if (!cards || !cards.length) {
    container.innerHTML = `<div class="card"><p>Nenhum card válido. A regra atual exclui qualquer resultado que não contenha TODOS os argumentos obrigatórios.</p></div>`;
    return;
  }

  cards.forEach((card, index) => {
    const div = document.createElement("div");
    div.className = index >= 5 ? "card extra hidden" : "card";
    div.innerHTML = `
      <div class="card-top"><span>#${index + 1}</span><span>${escapeHtml(card.fonte || "Receita Federal")}</span></div>
      <div class="card-body">
        <h3>${escapeHtml(card.titulo || "Sem título")}</h3>
        <p>${escapeHtml(card.resumo || card.ementa || "")}</p>
        <a href="${escapeHtml(card.link || "#")}" target="_blank" rel="noopener">Abrir fonte oficial</a>
      </div>
    `;
    container.appendChild(div);
  });

  if (cards.length > 5) {
    const btn = document.createElement("button");
    btn.className = "expand";
    btn.innerText = `Expandir resultados (${cards.length - 5} adicionais)`;
    btn.onclick = () => {
      document.querySelectorAll(".card.extra").forEach(el => el.classList.remove("hidden"));
      btn.remove();
    };
    container.appendChild(btn);
  }
}

async function pesquisar() {
  const query = $("query").value.trim();
  if (!query) {
    $("status").innerText = "Digite uma pesquisa.";
    return;
  }

  $("status").innerText = "Pesquisando na Receita Federal...";
  $("btn").disabled = true;
  $("btn").innerText = "Pesquisando...";
  $("resultados").innerHTML = "";
  $("rag").innerText = "";
  $("interpretacao").innerText = "";
  $("debug").innerText = "";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 70000);

    const resp = await fetch("/api/pesquisar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal
    });
    clearTimeout(timer);

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Erro na pesquisa.");

    $("status").innerText = `Brutos extraídos: ${data.totalBruto} | Cards válidos: ${data.totalValidos} | RAG: ${data.totalValidos} item(ns), máximo 50`;
    $("statBrutos").innerText = data.totalBruto || 0;
    $("statValidos").innerText = data.totalValidos || 0;
    $("cardsBadge").innerText = data.totalValidos || 0;
    $("statTime").innerText = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    renderCards(data.cards || []);
    $("rag").innerText = data.rag || "RAG vazio.";
    $("interpretacao").innerText = data.interpretacao || "Sem interpretação.";

    if (data.debug) {
      const erros = Array.isArray(data.debug.errosReceita) && data.debug.errosReceita.length
        ? `\nAvisos da Receita:\n- ${data.debug.errosReceita.join("\n- ")}`
        : "";
      $("debug").innerText = `URL usada: ${data.debug.primeiraUrl}\n${data.debug.aviso || ""}${erros}`;
    }
  } catch (err) {
    const msg = err.name === "AbortError"
      ? "A pesquisa excedeu 70 segundos e foi cancelada pelo navegador. Tente termos mais simples ou verifique se a Receita está respondendo."
      : (err.message || "Erro inesperado.");
    $("status").innerText = msg;
    $("debug").innerText = msg;
  } finally {
    $("btn").disabled = false;
    $("btn").innerText = "Pesquisar";
  }
}

$("clearBtn").addEventListener("click", () => {
  $("query").value = "";
  $("status").innerText = "Digite uma pesquisa para iniciar.";
  $("resultados").innerHTML = `<div class="empty">Faça uma pesquisa para consultar a Receita Federal.</div>`;
  $("rag").innerText = "RAG vazio.";
  $("interpretacao").innerText = "A interpretação aparecerá aqui após a pesquisa.";
  $("debug").innerText = "—";
  $("statBrutos").innerText = "0";
  $("statValidos").innerText = "0";
  $("cardsBadge").innerText = "0";
  $("statTime").innerText = "—";
});

$("exemploBtn").addEventListener("click", () => {
  $("query").value = "crédito presumido E leite E PIS";
});

$("copyRag").addEventListener("click", async () => {
  const text = $("rag").innerText || "";
  await navigator.clipboard.writeText(text);
  $("copyRag").innerText = "Copiado";
  setTimeout(() => $("copyRag").innerText = "Copiar RAG", 1200);
});

document.querySelectorAll(".chip").forEach(chip => {
  chip.addEventListener("click", () => {
    $("query").value = chip.dataset.q;
    pesquisar();
  });
});
