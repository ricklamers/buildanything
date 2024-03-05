import express from "express";
const app = express();
import path from "path";
import OpenAI from "openai";
import MemoryCache from "memory-cache";
import MistralClient from '@mistralai/mistralai'; // Import Mistral SDK

// Initialize cache
const cache = new MemoryCache.Cache();

app.use(express.json()); // Enable JSON body parsing
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// Handle fetching models for both OpenAI and Mistral
app.post("/models", async (req, res) => {
  if (!req.body || (!req.body.openai_api_key && !req.body.mistral_api_key)) {
    return res.status(400).json({ error: "API key for either OpenAI or Mistral is required in the JSON body" });
  }
  let models = [];

  // Handle OpenAI models
  if (req.body.openai_api_key) {
    const openaiApiKey = req.body.openai_api_key;
    const cacheKeyOpenAI = `models-openai-${openaiApiKey}`;
    const cachedModelsOpenAI = cache.get(cacheKeyOpenAI);

    if (!cachedModelsOpenAI) {
      const openai = new OpenAI({
        apiKey: openaiApiKey,
      });
      try {
        const modelsOpenAI = await openai.models.list();
        models = models.concat(modelsOpenAI.data.map(model => ({ id: model.id, provider: 'OpenAI' })));
        cache.put(cacheKeyOpenAI, modelsOpenAI, 3600000); // Cache for 1 hour
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    } else {
      models = models.concat(cachedModelsOpenAI.data.map(model => ({ id: model.id, provider: 'OpenAI' })));
    }
  }

  // Handle Mistral models
  if (req.body.mistral_api_key) {
    const mistralApiKey = req.body.mistral_api_key;
    const cacheKeyMistral = `models-mistral-${mistralApiKey}`;
    const cachedModelsMistral = cache.get(cacheKeyMistral);

    if (!cachedModelsMistral) {
      const mistralClient = new MistralClient(mistralApiKey);
      try {
        const listModelsResponse = await mistralClient.listModels();
        const modelsMistral = listModelsResponse.data.map(model => ({ id: model.id, provider: 'Mistral' }));
        models = models.concat(modelsMistral);
        cache.put(cacheKeyMistral, modelsMistral, 3600000); // Cache for 1 hour
      } catch (error) {
        return res.status(500).json({ error: "Failed to fetch models from Mistral: " + error.message });
      }
    } else {
      models = models.concat(cachedModelsMistral.map(model => ({ id: model.id, provider: 'Mistral' })));
    }
  }

  res.json(models);
});

// Route for generating text completions, handling both OpenAI and Mistral based on the provided model
app.post("/generate-completion", async (req, res) => {
  // Validation and setup
  if (!req.body || (!req.body.openai_api_key && !req.body.mistral_api_key) || typeof req.body.message !== "string") {
    return res.status(400).json({ error: "Bad request" });
  }
  const model = req.body.model;
  const provider = model.includes('Mistral') ? 'Mistral' : 'OpenAI'; // Determine provider based on model name

  const systemMessage = {
    role: "system",
    content:
      "You should generate HTML code. Generate HTML code directly, do not prefix or suffix it with anything as the code will directly be executed. The HTML code can contain JavaScript if applicable. Follow best practices. Generate succinct code that does the job.",
  };
  
  if (provider === 'OpenAI' && req.body.openai_api_key) {
    // OpenAI processing
    const apiKey = req.body.openai_api_key;
    const openai = new OpenAI({
      apiKey: apiKey,
    });
    try {
      const stream = await openai.chat.completions.create({
        model: model.replace('-OpenAI', ''), // Remove provider suffix
        messages: [systemMessage, { role: "user", content: req.body.message }],
        stream: true,
      });
      for await (const chunk of stream) {
        res.write(chunk.choices[0]?.delta?.content || '');
      }
      res.end();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  } else if (provider === 'Mistral' && req.body.mistral_api_key) {
    // Mistral processing
    const apiKey = req.body.mistral_api_key;
    const mistralClient = new MistralClient(apiKey);
    try {
      const chatStreamResponse = await mistralClient.chatStream({
        model: model.replace('-Mistral', ''), // Remove provider suffix
        messages: [systemMessage, {role: 'user', content: req.body.message}],
      });
      for await (const chunk of chatStreamResponse) {
        if (chunk.choices[0].delta.content !== undefined) {
          res.write(chunk.choices[0].delta.content);
        }
      }
      res.end();
    } catch (error) {
      res.status(500).json({ error: "Failed to generate completion with Mistral: " + error.message });
    }
  } else {
    res.status(400).json({ error: "Invalid request configuration" });
  }
});

