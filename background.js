importScripts('config.js');
const API_KEY = CONFIG.GEMINI_API_KEY;
// Listas para as camadas 1 e 2
const ALLOWLIST = [
  // Big Techs e Infraestrutura
  'google.com',
  'google.com.br',
  'youtube.com',
  'microsoft.com',
  'apple.com',
  'amazon.com',
  'amazon.com.br',
  'github.com',
  'gitlab.com',

  // Redes Sociais e Profissionais
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'whatsapp.com',
  'x.com',

  // Grandes Portais de Conteúdo e Utilitários (Brasil)
  'globo.com',
  'uol.com.br',
  'wikipedia.org',

  // Infraestrutura de Pagamentos, Bancos e E-commerce Consolidados
  'mercadolivre.com.br',
  'mercadopago.com.br',
  'nubank.com.br',
  'inter.co',
  'caixa.gov.br',
  'bb.com.br',
  'itau.com.br',
  'bradesco.com.br',
];
let BLOCKLIST_DINAMICA = ['site-falso-exemplo.com.br', 'golpe-procon.net', 'ganhe-dinheiro-facil.xyz'];

async function atualizarBlocklistDoProcon() {
  const URL_JSON_PUBLICO =
    'https://raw.githubusercontent.com/leandrogalbarino/validador-url-blocklist/refs/heads/main/blocklist.json';

  try {
    const response = await fetch(URL_JSON_PUBLICO);
    if (response.ok) {
      const dados = await response.json();
      console.log(dados);
      if (Array.isArray(dados)) {
        // Normaliza cada entrada para domínio puro, descartando URLs malformadas
        BLOCKLIST_DINAMICA = dados.map((entrada) => extrairDominio(entrada) ?? entrada).filter(Boolean);
      }
    }
  } catch (error) {
    console.error('[Blocklist] Falha ao buscar lista atualizada, usando fallback:', error);
  }
}

// Função auxiliar para extrair o domínio principal
function extrairDominio(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analisar_url') {
    executarAnaliseEmCamadas(request.url)
      .then((resultado) => sendResponse(resultado))
      .catch((error) => {
        console.error('Erro detectado no background.js:', error);
        sendResponse({ erro: true, justificativa: 'Falha ao consultar a IA.' });
      });

    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  atualizarBlocklistDoProcon();
});

// 2. Atualiza sempre que o Service Worker acordar (Garante o "tempo real")
chrome.runtime.onStartup.addListener(() => {
  atualizarBlocklistDoProcon();
});

async function executarAnaliseEmCamadas(url) {
  const dominio = extrairDominio(url);

  if (!dominio) {
    return { score: 0, justificativa: 'Formato de URL inválido.', camada: 1 };
  }

  // --- Camada 1: Validação Institucional e Allowlist ---
  const regexInstitucionalSegura = /\.(gov|jus|leg|mil|mp)(\.[a-z]{2})?$/i;
  if (regexInstitucionalSegura.test(dominio) || ALLOWLIST.some((d) => dominio === d || dominio.endsWith('.' + d))) {
    return {
      score: 100,
      justificativa: 'Domínio institucional ou plataforma amplamente reconhecida e segura.',
      camada: 1,
    };
  }

  // --- Camada 2: Blocklist Estática & Cache Local ---

  // A) Verifica a Blocklist manual
  if (BLOCKLIST_DINAMICA.some((d) => dominio === d || dominio.endsWith('.' + d))) {
    return {
      score: 0,
      justificativa: 'Domínio classificado como golpe ou ameaça conhecida em banco de dados.',
      camada: 2,
    };
  }

  // B) VERIFICAÇÃO DO CACHE: O site já foi analisado antes?
  const cacheKey = `analise_${dominio}`;
  const dadosSalvos = await chrome.storage.local.get(cacheKey);

  if (dadosSalvos[cacheKey]) {
    console.log(`[Cache] Usando resultado salvo para: ${dominio}`);
    return {
      score: dadosSalvos[cacheKey].score,
      justificativa: dadosSalvos[cacheKey].justificativa,
      camada: 2, // Identifica que veio da camada de cache/histórico
    };
  }

  // --- Camada 3: Inteligência Artificial ---
  // Se chegou aqui, é porque o site é novo. Chamamos a IA.
  try {
    const resultadoIA = await consultarIAGemini(url);

    // SALVA NO CACHE: Guarda o resultado para as próximas vezes
    await chrome.storage.local.set({
      [cacheKey]: {
        score: resultadoIA.score,
        justificativa: resultadoIA.justificativa,
        timestamp: Date.now(), // Útil se quiser expirar o cache após alguns dias no futuro
      },
    });

    return resultadoIA; // Retorna camada 3 normalmente na primeira vez
  } catch (error) {
    throw error;
  }
}

async function consultarIAGemini(url) {
  const apiKey = API_KEY;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

  const promptTexto = `Aja como um Analista de Segurança da Informação e especialista em OSINT. 
  Sua tarefa é realizar uma auditoria rigorosa de confiabilidade e segurança para a seguinte URL: ${url}

  Metodologia: Cruze dados conhecidos do seu treinamento sobre Reclame Aqui, Procon, VirusTotal, reputação de domínio e SSL. Avalie também a eficácia funcional do site (ele entrega o que promete, mesmo operando em áreas cinzentas?).
  
  Critério de Classificação (0 a 100%):
  Balanceie a equação com:
  1. Segurança Institucional (Peso 70%): Risco de malwares, roubo de dados ou golpes.
  2. Cumprimento de Função (Peso 30%): Funcionalidade real para o usuário.

  MUITO IMPORTANTE: O sistema que fará a leitura desta resposta é um software automatizado. 
  Você deve retornar ESTRITAMENTE E APENAS um objeto JSON válido (sem crases de markdown, sem introduções) com as seguintes exatas duas chaves:
  "score": um número inteiro de 0 a 100 com o resultado da sua equação matemática.
  "justificativa": uma frase curta (máximo 15 a 20 palavras) unindo o seu Veredito (ex: Golpe, Seguro, Pirataria) com o motivo técnico da nota.`;

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptTexto }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || 'Erro na API do Google');
  }

  const iaRespostaTexto = data.candidates[0].content.parts[0].text;
  const resultadoJSON = JSON.parse(iaRespostaTexto);

  // Adicionamos o identificador de camada no retorno
  return {
    score: resultadoJSON.score,
    justificativa: resultadoJSON.justificativa,
    camada: 3,
  };
}
