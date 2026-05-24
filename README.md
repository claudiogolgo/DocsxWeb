# DocsxWeb — Receita SIJUT + RAG

## Rodar no Mac

1. Descompacte o projeto.
2. Abra o Terminal dentro da pasta do projeto.
3. Crie o arquivo `.env` na mesma pasta do `server.js`:

```bash
cp .env.example .env
```

4. Edite o `.env` e cole sua chave real:

```txt
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o-mini
PORT=3000
```

5. Instale e rode:

```bash
npm install
npm start
```

6. Abra:

```txt
http://localhost:3000
```

## Teste do carregamento da chave

Abra no navegador:

```txt
http://localhost:3000/api/status
```

Deve aparecer:

```json
"envLoaded": true,
"openaiKeyPresent": true,
"openaiKeyValid": true
```

## Observação

O `.env` real não foi incluído no pacote por segurança. Coloque sua chave no `.env` local.

## Correção anti-travamento

Esta versão inclui:
- timeout de 12s por página consultada na Receita;
- consulta paralela das 5 páginas;
- timeout de 25s na OpenAI;
- retorno dos cards/RAG mesmo se a interpretação falhar;
- timeout de 70s no navegador para não ficar carregando indefinidamente.

Variáveis opcionais no `.env`:

```env
RECEITA_TIMEOUT_MS=12000
OPENAI_TIMEOUT_MS=25000
OPENAI_MODEL=gpt-4o-mini
```


## Upgrade no GitHub/Render

Nome padronizado desta versão: `docsxweb`.

Para atualizar o repositório já conectado ao Render:

```bash
git add .
git commit -m "upgrade docsxweb"
git push
```

No Render mantenha:

```txt
Build Command: npm install --omit=dev
Start Command: node server.js
NODE_VERSION: 22
```

