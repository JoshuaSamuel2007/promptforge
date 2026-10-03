// Set GROQ_API_KEY in Vercel Dashboard -> Settings -> Environment Variables

const rateLimitMap = new Map();

const LENGTH_SETTINGS = {
  concise: {
    maxTokens: 220,
    instruction:
      'Keep the amplified prompt concise, targeting roughly 80–120 words while preserving the important context, objective, constraints, and response format.'
  },

  balanced: {
    maxTokens: 360,
    instruction:
      'Create a balanced amplified prompt, targeting roughly 150–220 words. Include useful context, objective, constraints, audience, and response format without unnecessary verbosity.'
  },

  detailed: {
    maxTokens: 520,
    instruction:
      'Create a detailed amplified prompt, targeting roughly 250–350 words. Add useful context, constraints, assumptions, audience, and a clear response format, but avoid filler.'
  },

  maximum: {
    maxTokens: 700,
    instruction:
      'Create a comprehensive amplified prompt, targeting roughly 350–450 words. Include relevant context, objective, constraints, audience, assumptions, quality requirements, and a clear response format. Do not add filler or repeat information.'
  }
};

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
  const ip =
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress ||
    'unknown-ip';

  const now = new Date();
  const dateKey = now.toISOString().split('T')[0];
  const userKey = `${ip}-${dateKey}`;

  const currentCount = rateLimitMap.get(userKey) || 0;

  if (currentCount >= 10) {
    return res
      .status(429)
      .json({ error: 'Daily limit reached. Come back tomorrow!' });
  }

  // Parse and validate request body
  const { prompt, length = 'balanced' } = req.body || {};

  if (
    !prompt ||
    typeof prompt !== 'string' ||
    prompt.trim() === ''
  ) {
    return res.status(400).json({
      error: 'Prompt cannot be empty.'
    });
  }

  // Prevent excessively large prompts
  if (prompt.trim().length > 5000) {
    return res.status(400).json({
      error: 'Prompt is too long. Please keep it under 5,000 characters.'
    });
  }

  // Safely select the requested output length
  const lengthKey = LENGTH_SETTINGS[length]
    ? length
    : 'balanced';

  const lengthSetting = LENGTH_SETTINGS[lengthKey];

  try {
    // Call the Groq API
    const groqResponse = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',

          max_tokens: lengthSetting.maxTokens,

          messages: [
            {
              role: 'system',
              content: `
You are a world-class prompt engineer with deep expertise in AI systems.

When given a rough or vague prompt, transform it into a highly detailed, optimized, and structured prompt using the CO-STAR framework (Context, Objective, Style, Tone, Audience, Response Format) combined with role-priming and clear instruction layering.

Analyze the user's intent internally, but output only the final amplified prompt.

${lengthSetting.instruction}

Do not include explanations, preambles, labels, or meta-commentary.

Make the result ready to paste directly into any AI tool.
              `.trim()
            },

            {
              role: 'user',
              content: prompt.trim()
            }
          ]
        })
      }
    );

    // Handle Groq API errors
    if (!groqResponse.ok) {
      const errorData = await groqResponse
        .json()
        .catch(() => ({}));

      console.error('Groq API Error:', errorData);

      throw new Error(
        errorData.error?.message ||
          `Groq API returned ${groqResponse.status}`
      );
    }

    // Parse response
    const data = await groqResponse.json();

    const amplifiedPrompt =
      data.choices?.[0]?.message?.content;

    if (!amplifiedPrompt) {
      throw new Error(
        'Invalid response format from Groq API'
      );
    }

    // Increment rate limit counter ONLY after successful generation
    rateLimitMap.set(
      userKey,
      currentCount + 1
    );

    return res.status(200).json({
      result: amplifiedPrompt
    });

  } catch (error) {
    console.error('Server error:', error);

    return res.status(500).json({
      error: 'Something went wrong. Try again.'
    });
  }
};
