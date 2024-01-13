const express = require("express");
const app = express();
const path = require("path");
const OpenAI = require("openai");
const MemoryCache = require("memory-cache");

// Initialize cache
const cache = new MemoryCache.Cache();

app.use(express.json()); // Enable JSON body parsing
app.use(express.static(path.join(__dirname, "public")));

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

app.post("/models", async (req, res) => {
  if (!req.body || !req.body.openai_api_key) {
    return res.status(400).json({ error: "API key is required in the JSON body" });
  }
  const apiKey = req.body.openai_api_key;
  const cacheKey = `models-${apiKey}`;
  const cachedModels = cache.get(cacheKey);

  if (cachedModels) {
    return res.json(cachedModels);
  }

  const openai = new OpenAI({
    apiKey: apiKey,
  });
  try {
    const models = await openai.models.list();
    // Cache the models before sending the response
    cache.put(cacheKey, models, 3600000); // Cache for 1 hour
    res.json(models);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


app.post("/generate-completion", async (req, res) => {
  if (!req.body || !req.body.openai_api_key || typeof req.body.message !== "string") {
    return res.status(400).json({ error: "Bad request" });
  }
  const apiKey = req.body.openai_api_key;
  const model = req.body.model || 'gpt-3.5-turbo';
  const openai = new OpenAI({
    apiKey: apiKey,
  });
  try {
    const stream = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content:
            "You should generate HTML code. Generate HTML code directly, do not prefix or suffix it with anything as the code will directly be executed. The HTML code can contain JavaScript if applicable. Follow best practices. Generate succinct code that does the job.",
        },
        { role: "user", content: req.body.message }
      ],
      stream: true,
    });
    for await (const chunk of stream) {
      res.write(chunk.choices[0]?.delta?.content || '');
    }
    res.end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
