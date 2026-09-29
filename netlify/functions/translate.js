exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { texts, language = "Marathi" } = JSON.parse(event.body || "{}");
    if (!Array.isArray(texts) || texts.length === 0 || texts.length > 25) {
      return { statusCode: 400, body: JSON.stringify({ error: "texts must contain 1-25 items" }) };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "GEMINI_API_KEY is not configured" }) };
    }

    const prompt = `Translate each UI/content string from English to simple, natural Marathi for ordinary Indian farmers. Return ONLY a JSON array of strings in the exact same order. Preserve crop names, district names, scientific names, numbers, units such as kg/ha, NPK, pH, emojis, punctuation where appropriate, and technical terms when they are clearer in English. Do not add explanations. Strings: ${JSON.stringify(texts)}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) return { statusCode: response.status, body: JSON.stringify({ error: data }) };

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    const translations = JSON.parse(raw);
    if (!Array.isArray(translations) || translations.length !== texts.length) throw new Error("Invalid Gemini output");

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ translations, language }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
