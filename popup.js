document.addEventListener('DOMContentLoaded', async () => {
  // Carrega a URL inicial assim que o popup abre
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  document.getElementById('site-url').innerText = tab.url || 'URL não disponível';
});

document.getElementById('analisar-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  const scoreEl = document.getElementById('score');
  const cardEl = document.getElementById('result-card');
  const camadaEl = document.getElementById('camada-info');

  cardEl.classList.remove('hidden');
  statusEl.innerText = 'Analisando com IA...';
  scoreEl.innerText = '⏳';
  scoreEl.style.color = '#333';
  camadaEl.innerText = '';

  // 1. Pega a aba atual
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.runtime.sendMessage({ action: 'analisar_url', url: tab.url }, (response) => {
    if (response.erro) {
      statusEl.innerText = 'Erro na análise.';
      scoreEl.innerText = '⚠️';
    } else {
      const pontuacao = response.score;
      scoreEl.innerText = `${pontuacao}%`;
      statusEl.innerText = response.justificativa;

      // Exibe qual camada deu o veredito
      const fontes = {
        1: 'Fonte: Lista de Sites Confiáveis',
        2: 'Fonte: Banco de Dados de Golpes',
        3: 'Fonte: Análise Avançada IA (Gemini)',
      };
      camadaEl.innerText = fontes[response.camada] || '';

      // Colore a pontuação baseada na segurança
      if (pontuacao >= 80) {
        scoreEl.style.color = '#198754'; // Verde
      } else if (pontuacao >= 50) {
        scoreEl.style.color = '#ffc107'; // Amarelo
      } else {
        scoreEl.style.color = '#dc3545'; // Vermelho
      }
    }
  });
});
