const GROQ_API_KEY = null; // désactivé temporairement
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_MODEL_FAST = 'llama-3.1-8b-instant';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

async function callGroq(messages, temperature = 0.7, maxTokens = 4096, fast=false) {
  const model = fast ? GROQ_MODEL_FAST : GROQ_MODEL;
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(600000)
  });
  if (!response.ok) throw new Error(`Groq error: ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

async function callOllama(prompt, temperature = 0.7, maxTokens = 4096, model = null, numCtx = null) {
  const m = model || OLLAMA_MODEL;
  const opts = { temperature, num_predict: maxTokens };
  if (numCtx) opts.num_ctx = numCtx;
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: m, prompt, stream: false, options: opts }),
    signal: AbortSignal.timeout(600000)
  });
  if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
  const data = await response.json();
  return data.response;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callGroqWithRetry(messages, temperature, maxTokens, retries=3, fast=false) {
  if (!GROQ_API_KEY) {
    const prompt = messages.map(m => m.content).join('\n\n');
    return await callOllama(prompt, temperature, 3000, 'gemma3:12b', 131072);
  }
  for (let i = 0; i < retries; i++) {
    try {
      return await callGroq(messages, temperature, maxTokens, fast);
    } catch(e) {
      if (e.message.includes('429') || e.message.includes('413') || e.message.includes('401')) {
        if (i < retries-1) {
          console.error('Groq rate limit, attente 15s...');
          await sleep(15000);
        } else {
          console.error('Groq rate limit persistant, fallback Ollama');
          const prompt = messages.map(m => m.content).join('\n\n');
          return await callOllama(prompt, temperature, 3000, 'gemma3:12b', 131072);
        }
      } else throw e;
    }
  }
}

async function summarizeChunk(text, chunkNum, totalChunks, prevSummary) {
  const contextMsg = prevSummary ? 'Resume de ce qui precede :\n' + prevSummary + '\n\n' : '';
  const messages = [
    { role: 'system', content: 'Tu es un scribe de campagne JDR. Tu resumes fidelement les evenements en francais. Style narratif immersif, noms et lieux conserves.' },
    { role: 'user', content: contextMsg + 'Voici la partie ' + chunkNum + '/' + totalChunks + ' de la session :\n\n' + text + '\n\nFais un resume detaille de cette partie.' }
  ];
  return await callGroqWithRetry(messages, 0.6, 2048, 3, true);
}

async function generateSummary(rawNotes) {
  const CHUNK_SIZE = 8000;
  const MAX_CHARS = 40000;
  let notesText = rawNotes || '';
  if (notesText.length > MAX_CHARS) notesText = notesText.slice(0, MAX_CHARS);

  let summaryResult;

  if (notesText.length <= CHUNK_SIZE) {
    const messages = [
      { role: 'system', content: 'Tu es un scribe de campagne JDR expert. Tu analyses les transcriptions et notes de session pour produire un compte-rendu structure et immersif en francais.' },
      { role: 'user', content: `Analyse cette session de JDR et produis un compte-rendu structure avec exactement ces sections :

## Résumé narratif
(2-3 paragraphes narratifs immersifs a la troisieme personne)

## Événements clés
(liste des moments importants dans l ordre chronologique)

## PNJ rencontrés
(nom, description courte, role dans la session)

## Décisions importantes
(choix significatifs des joueurs et leurs consequences)

## Révélations & mystères
(informations decouverts, questions en suspens)

## Fin de session
(situation des personnages en fin de session, accroche pour la suite)

Notes/Transcription :
` + notesText.slice(0, 15000) }
    ];
    summaryResult = await callGroqWithRetry(messages, 0.6, 3000, 3, true);
  } else {
    const chunks = [];
    for (let i = 0; i < notesText.length; i += CHUNK_SIZE) {
      chunks.push(notesText.slice(i, i + CHUNK_SIZE));
    }
    let prevSummary = '';
    const partialSummaries = [];
    for (let i = 0; i < chunks.length; i++) {
      const partial = await summarizeChunk(chunks[i], i + 1, chunks.length, prevSummary);
      partialSummaries.push(partial);
      prevSummary = partial;
      if (i < chunks.length - 1) await sleep(3000);
    }
    const allPartials = partialSummaries.join('\n\n---\n\n');
    const finalMessages = [
      { role: 'system', content: 'Tu es un scribe de campagne JDR expert. Tu produis des comptes-rendus structures et immersifs en francais.' },
      { role: 'user', content: `Synthetise ces resumes partiels en un compte-rendu complet et structure avec ces sections :

## Résumé narratif
## Événements clés
## PNJ rencontrés
## Décisions importantes
## Révélations & mystères
## Fin de session

Resumes partiels :
` + allPartials }
    ];
    summaryResult = await callGroqWithRetry(finalMessages, 0.6, 4096, 3, true);
  }

  return summaryResult;
}

async function generateSessionNotes(rawNotes) {
  try {
    let text;
    const systemPrompt = 'Tu es un assistant pour jeux de role. Genere un resume structure en JSON avec les champs summary (string avec points cles) et narrative (string, texte narratif immersif). Reponds UNIQUEMENT en JSON valide, sans markdown.';
    const userPrompt = 'A partir de ces notes de session JDR, genere un resume structure:\n\n' + rawNotes.slice(0, 60000);

    if (GROQ_API_KEY) {
      text = await callGroq([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], 0.7, 2048);
    } else {
      text = await callOllama(systemPrompt + '\n\n' + userPrompt, 0.7, 4096);
    }

    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        summary: Array.isArray(parsed.summary) ? parsed.summary.join('\n') : parsed.summary,
        narrative: parsed.narrative || '',
        ai_generated: true
      };
    }
    return { summary: text, narrative: '', ai_generated: true };
  } catch (err) {
    console.error('AI generation failed:', err.message);
    return null;
  }
}

async function askQuestion(question, allSessionsText, campaignTitle) {
  const systemPrompt = 'Tu es l\'archiviste de la campagne JDR "' + campaignTitle + '". Tu reponds aux questions en te basant uniquement sur les notes disponibles. Si l\'information n\'est pas dans les notes, dis-le clairement.';
  const userPrompt = 'Voici toutes les notes et resumes des sessions:\n' + allSessionsText.slice(0, 60000) + '\n\nQuestion: ' + question;
  try {
    if (GROQ_API_KEY) {
      return await callGroq([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], 0.7, 2048);
    } else {
      return await callOllama(systemPrompt + '\n\n' + userPrompt, 0.7, 4096);
    }
  } catch (err) {
    console.error('AI question failed:', err.message);
    return null;
  }
}

async function checkOllamaStatus() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return GROQ_API_KEY ? true : false;
  }
}

module.exports = { generateSessionNotes, generateSummary, askQuestion, checkOllamaStatus };
