# ⚡ Bitrix24 Dashboard — Relatórios de Atendimento

Dashboard multi-tenant de métricas de atendimento WhatsApp via Open Channels do Bitrix24.

---

## 📦 Requisitos

- Node.js 18+
- Acesso à VPS (porta 3000 liberada, ou via proxy reverso)
- Webhook Inbound configurado em cada conta Bitrix24

---

## 🚀 Instalação na VPS

```bash
# 1. Clone ou copie o projeto para a VPS
git clone <seu-repo> /opt/bitrix24-dashboard
cd /opt/bitrix24-dashboard

# 2. Instale as dependências
npm install

# 3. Configure o .env
cp .env.example .env
nano .env
# → Defina ADMIN_SECRET com uma senha forte

# 4. Inicie o servidor
npm start
```

### Rodando em background com PM2 (recomendado)

```bash
npm install -g pm2
pm2 start src/server.js --name bitrix24-dashboard
pm2 save
pm2 startup
```

---

## ⚙️ Configuração por Conta Bitrix24

### Passo 1 — Criar o Webhook Inbound no Bitrix24

1. Acesse seu Bitrix24
2. Vá em **Aplicativos → Webhooks → Adicionar Webhook de entrada**
3. Marque as permissões:
   - `imopenlines` — Open Channels
   - `user` — Usuários
   - `imbot` — (opcional)
4. Copie a URL gerada (ex: `https://empresa.bitrix24.com.br/rest/1/abc123token/`)

### Passo 2 — Cadastrar no painel Admin

1. Acesse `http://SUA_VPS:3000/admin`
2. Faça login com a senha definida em `ADMIN_SECRET`
3. Preencha:
   - **Nome da empresa**: Nome identificador
   - **Domínio Bitrix24**: `empresa.bitrix24.com.br`
   - **URL do Webhook**: A URL copiada no passo anterior
4. Clique em **+ Adicionar**

### Passo 3 — Registrar o App Local no Bitrix24

1. Acesse seu Bitrix24 → **Aplicativos → Desenvolvedores → Outros → App local**
2. Preencha:
   - **Nome**: Dashboard de Atendimento
   - **URL do Handler**: `http://SUA_VPS:3000/?domain=empresa.bitrix24.com.br`
   - **Permissões**: `imopenlines`, `user`
3. Salve e abra o app — ele aparecerá no menu lateral do Bitrix24

---

## 📊 Métricas calculadas

| Métrica | Descrição |
|---------|-----------|
| **Tempo de 1ª Resposta** | Tempo entre a 1ª mensagem do cliente e a 1ª resposta do operador |
| **Tempo Médio de Resposta** | Média do tempo de resposta do operador em toda a conversa |
| **Tempo Total de Atendimento** | Do início da sessão até o encerramento |
| **Tempo Médio de Atendimento** | Média do tempo total entre todas as conversas |

---

## 🔧 Variáveis de ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta do servidor | `3000` |
| `ADMIN_SECRET` | Senha do painel admin | `admin123` |
| `CACHE_TTL` | Cache em segundos | `60` |
| `NODE_ENV` | Ambiente | `development` |

---

## 🗂 Estrutura do projeto

```
bitrix24-dashboard/
├── src/
│   ├── server.js                  # Servidor Express principal
│   ├── routes/
│   │   ├── api.js                 # API de métricas e operadores
│   │   ├── admin.js               # Painel admin (CRUD de tenants)
│   │   └── dashboard.js           # Serve o HTML do dashboard
│   ├── services/
│   │   ├── tenantService.js       # Gerencia contas (tenants.json)
│   │   ├── bitrixService.js       # Chamadas à API do Bitrix24
│   │   └── metricsService.js      # Cálculo e agregação de métricas
│   └── middleware/
│       └── adminAuth.js           # Autenticação do painel admin
├── public/
│   └── dashboard.html             # Frontend do dashboard
├── data/
│   └── tenants.json               # Banco de dados local (auto-criado)
├── .env.example
├── package.json
└── README.md
```

---

## 🔒 Segurança

- O painel admin é protegido por senha via cookie
- Cada tenant só acessa seus próprios dados (isolamento por domínio)
- A URL do Webhook nunca é exposta ao frontend
- Use HTTPS na VPS (Nginx + Let's Encrypt recomendado)

### Nginx como proxy reverso (recomendado)

```nginx
server {
    listen 80;
    server_name dashboard.suaempresa.com.br;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 🐛 Troubleshooting

**Dashboard não carrega dados:**
- Verifique se o domínio no `?domain=` bate exatamente com o cadastrado no admin
- Teste o webhook diretamente: `curl https://empresa.bitrix24.com.br/rest/1/token/user.get`

**Erro de CORS:**
- Certifique-se que o Nginx não está bloqueando headers `frame-ancestors`
- O servidor já envia `Content-Security-Policy: frame-ancestors *`

**Dados desatualizados:**
- Clique em "Atualizar" para limpar o cache e buscar dados frescos
- O cache padrão é de 60 segundos (configurável em `CACHE_TTL`)
