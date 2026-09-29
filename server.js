const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT = __dirname;
const API_KEY = process.env.GEMINI_API_KEY;

function send(res, status, type, body) {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
}

function translatePrompt(texts) {
  return `
You are the Marathi language editor for BHUMI, an agriculture website for farmers in Maharashtra.

Translate ALL HUMAN-READABLE WEBSITE CONTENT into simple, natural, modern Marathi.

The goal is to make the website feel like it was originally written in Marathi, NOT like English text translated mechanically.

IMPORTANT RULES:

1. Translate every human-readable word and sentence according to its meaning and context.

2. Translate website navigation, headings, buttons, descriptions, labels, placeholders, tooltips, card content and messages.

3. Translate district names into Marathi script:
   Sangli → सांगली
   Satara → सातारा
   Nashik → नाशिक

4. Convert visible Arabic numerals into Marathi numerals wherever they appear in user-facing content:
   3 → ३
   30 → ३०
   100 → १००
   9.6 → ९.६
   10 → १०

5. Preserve mathematical meaning, units and symbols while converting visible numbers:
   100% → १००%
   9.6 / 10 → ९.६ / १०
   50 kg/ha → ५० kg/ha

6. Translate common crop names into commonly used Marathi names:
   Turmeric → हळद
   Sugarcane → ऊस
   Pomegranate → डाळिंब
   Soybean → सोयाबीन
   Wheat → गहू
   Rice → तांदूळ
   Maize → मका
   Potato → बटाटा

7. Scientific names should remain unchanged.

8. Technical terms such as NPK and pH may remain unchanged when Marathi translation would reduce clarity.

9. Brand names such as BHUMI must remain exactly BHUMI.

10. Buttons and CTAs must sound natural and concise.
    "Let's Grow" → "चला, शेती करूया"
    "Let's Connect" → "चला, जोडूया"
    "View Full Dossier" → "संपूर्ण माहिती पहा"
    "Search by crop, scientific name, or soil..." → "पीक, वैज्ञानिक नाव किंवा माती शोधा..."

11. Do NOT use overly formal, literary or textbook Marathi.

12. Preserve emojis, punctuation and layout meaning.

13. Do NOT add explanations.

14. Do NOT remove information.

15. Return ONLY a JSON array.

16. Return exactly the same number of strings as the input and preserve their exact order.

17. IMPORTANT:
    Translate visible content only.
    Do NOT translate HTML, JavaScript, CSS, URLs, variable names, JSON keys, IDs, class names or programming syntax.

    NEVER translate or modify the brand name "BHUMI".
Always keep "BHUMI" exactly as "BHUMI".

Input strings:
${JSON.stringify(texts)}
`;
}

// Gemini request with automatic retry for temporary 503 errors
async function requestGemini(texts) {
  const maxAttempts = 3;
  const delays = [3000, 6000, 12000];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`GEMINI ATTEMPT ${attempt}/${maxAttempts}`);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(API_KEY)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: translatePrompt(texts)
                  }
                ]
              }
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.2
            }
          })
        }
      );

      const data = await response.json();

      // Retry only temporary server overload/unavailable errors
      if (response.status === 503 || response.status === 429) {
        console.log(
          `GEMINI TEMPORARILY UNAVAILABLE: ${response.status}`
        );

        if (attempt < maxAttempts) {
          console.log(`Retrying in ${delays[attempt - 1] / 1000} seconds...`);

          await new Promise(resolve =>
            setTimeout(resolve, delays[attempt - 1])
          );

          continue;
        }
      }

      if (!response.ok) {
        console.log('GEMINI ERROR:', data);

        throw new Error(
          data?.error?.message ||
          `Gemini API error ${response.status}`
        );
      }

      const raw =
        data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

      const translations = JSON.parse(raw);

      if (
        !Array.isArray(translations) ||
        translations.length !== texts.length
      ) {
        throw new Error('Invalid Gemini output');
      }

      return translations;

    } catch (err) {

      if (attempt === maxAttempts) {
        throw err;
      }

      console.log(`Gemini request failed: ${err.message}`);

      await new Promise(resolve =>
        setTimeout(resolve, delays[attempt - 1])
      );
    }
  }

  throw new Error('Gemini translation failed after all retry attempts.');
}

async function handleTranslate(req, res) {
  if (req.method !== 'POST') {
    return send(
      res,
      405,
      'application/json',
      JSON.stringify({ error: 'Method not allowed' })
    );
  }

  if (!API_KEY) {
    return send(
      res,
      500,
      'application/json',
      JSON.stringify({
        error: 'GEMINI_API_KEY is not set. Set it before starting the server.'
      })
    );
  }

  let body = '';

  req.on('data', chunk => {
    body += chunk;
  });

  req.on('end', async () => {
    try {

      const cleanBody = body.trim();

      console.log(
        'RAW BODY:',
        JSON.stringify(cleanBody)
      );

      const {
        texts,
        language = 'Marathi'
      } = JSON.parse(cleanBody);

      if (
        !Array.isArray(texts) ||
        texts.length === 0 ||
        texts.length > 25
      ) {
        return send(
          res,
          400,
          'application/json',
          JSON.stringify({
            error: 'texts must contain 1-25 items'
          })
        );
      }

      console.log(
        'TRANSLATING:',
        texts.length,
        'texts'
      );

      const translations = await requestGemini(texts);

      console.log('TRANSLATION SUCCESS');

      send(
        res,
        200,
        'application/json',
        JSON.stringify({
          translations,
          language
        })
      );

    } catch (err) {

      console.log(
        'TRANSLATION ERROR:',
        err.message
      );

      send(
        res,
        500,
        'application/json',
        JSON.stringify({
          error: err.message
        })
      );
    }
  });
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {

  console.log(
    'REQUEST:',
    req.method,
    JSON.stringify(req.url)
  );

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return send(
      res,
      204,
      'text/plain',
      ''
    );
  }

  // Translation API
  let requestPath = '';

  try {
    requestPath = new URL(
      req.url,
      `http://${req.headers.host}`
    ).pathname;
  } catch {
    return send(
      res,
      400,
      'text/plain',
      'Bad request'
    );
  }

  if (
    req.method === 'POST' &&
    requestPath === '/api/translate'
  ) {
    return handleTranslate(req, res);
  }

  // Static files
  let pathname;

  try {
    pathname = decodeURIComponent(requestPath);
  } catch {
    return send(
      res,
      400,
      'text/plain',
      'Bad request'
    );
  }

  const filePath = path.normalize(
    path.join(
      ROOT,
      pathname === '/'
        ? 'index.html'
        : pathname
    )
  );

  if (!filePath.startsWith(ROOT)) {
    return send(
      res,
      403,
      'text/plain',
      'Forbidden'
    );
  }

  fs.stat(filePath, (err, stat) => {

    if (err) {
      return send(
        res,
        404,
        'text/plain',
        'Not found'
      );
    }

    const target = stat.isDirectory()
      ? path.join(filePath, 'index.html')
      : filePath;

    fs.readFile(target, (e, data) => {

      if (e) {
        return send(
          res,
          404,
          'text/plain',
          'Not found'
        );
      }

      send(
        res,
        200,
        mime[
          path.extname(target).toLowerCase()
        ] || 'application/octet-stream',
        data
      );

    });

  });

});

server.listen(PORT, () => {

  console.log(
    `BHUMI running at http://localhost:${PORT}`
  );

  console.log(
    API_KEY
      ? 'Gemini API key detected.'
      : 'WARNING: GEMINI_API_KEY is not set.'
  );

});