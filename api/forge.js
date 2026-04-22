// Set GROQ_API_KEY in Vercel Dashboard -> Settings -> Environment Variables

const rateLimitMap = new Map();

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Rate Limiting (10 requests per IP per day)
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';
  const now = new Date();
  const dateKey = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const userKey = `${ip}-${dateKey}`;

  const currentCount = rateLimitMap.get(userKey) || 0;
  if (currentCount >= 10) {
    return res.status(429).json({ error: 'Daily limit reached. Come back tomorrow!' });
  }

  // Parse and validate the request body
  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    return res.status(400).json({ error: 'Prompt cannot be empty.' });
  }

  try {
    // Call the Groq API
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1500,
        messages: [
          {
            role: 'system',
            content: 'You are a world-class prompt engineer with deep expertise in AI systems. When given a rough or vague prompt, transform it into a highly detailed, optimized, and structured prompt using the CO-STAR framework (Context, Objective, Style, Tone, Audience, Response Format) combined with role-priming and Chain-of-Thought instruction layering. Output ONLY the final amplified prompt — no explanations, no preamble, no labels, no meta-commentary. Make it ready to paste directly into any AI tool.'
          },
          {
            role: 'user',
            content: prompt.trim()
          }
        ]
      })
    });

    if (!groqResponse.ok) {
      const errorData = await groqResponse.json().catch(() => ({}));
      console.error('Groq API Error:', errorData);
      throw new Error(errorData.error?.message || `Groq API returned ${groqResponse.status}`);
    }

    const data = await groqResponse.json();
    const amplifiedPrompt = data.choices?.[0]?.message?.content;

    if (!amplifiedPrompt) {
      throw new Error('Invalid response format from Groq API');
    }

    // Increment rate limit counter ONLY on success
    rateLimitMap.set(userKey, currentCount + 1);

    return res.status(200).json({ result: amplifiedPrompt });
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
