# Pulse Tracker

Pixel do Pulse (`p/v1.js`) e editor visual de eventos (`p/editor-v1.js`).

- **`p/v1.js`**: o script que o cliente instala em todas as páginas. É mínimo (~0,5 KB gzip).
  Ao abrir uma página com `#pulse_setup=<token>` (link gerado no Pulse), carrega o editor.
- **`p/editor-v1.js`**: o editor visual, baixado só no modo de configuração. Destaca o
  elemento sob o mouse, intercepta o clique e salva a regra (elemento → evento) na API.

O envio de eventos dos visitantes (modo normal) entra junto com o coletor.

## Testar localmente

1. **Backend** (`../backend/.env`):
   ```
   TRACKING_ALLOW_LOCAL_PAGES=true
   TRACKING_SCRIPT_URL=http://localhost:5174/p/v1.js
   ```
   Rode as migrations (`npm run migration:run`) e suba o backend (`npm run start:dev`).
2. **Tracker**: `npm install` e `npm run dev`. A página de demonstração fica em
   http://localhost:5174/ com o pixel já instalado.
3. **Front**: `npm run dev`. Em **Rastreamento**, ative o pixel, cole
   `http://localhost:5174/` e clique em **Abrir e configurar**.
4. Na nova aba, clique em **Selecionar elemento**, escolha um botão ou o formulário e salve
   o evento. Ao voltar para o Pulse, a página aparece em **Páginas configuradas**.

## Build

```
PULSE_API_URL=https://api.seudominio.com.br npm run build
```

Gera `dist/p/v1.js` e `dist/p/editor-v1.js`. `PULSE_API_URL` é o endereço da API usado pelo
script (padrão: `http://localhost:3001`). Em uma página, `data-api` no `<script>` sobrescreve.
