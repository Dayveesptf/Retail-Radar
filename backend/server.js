/* eslint-disable no-undef */
import express from "express";
import fetch from "node-fetch"; // or global fetch if Node 18+
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// --- Load population.json manually ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);const populationData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data/population.json"), "utf-8")
);

const app = express();
app.use(
  cors({
    origin: ["https://retail-radar-dd.vercel.app", "http://localhost:5173"],
  })
);
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY missing in .env");
  process.exit(1);
}

app.post("/api/analyze", async (req, res) => {
  const { location, clusters } = req.body;

  if (!location || !clusters) {
    return res.status(400).json({ error: "Missing location or clusters" });
  }

  try {
    const minimalClusters = clusters.map((c) => ({
      id: c.id,
      storeCount: c.storeCount,
      types: c.types,
      sizes: c.sizes,
    }));

    // Match state in population data
    let popInfo = "";
    if (location.address) {
      const addr = location.address.toLowerCase();
      const matchedState = Object.keys(populationData).find((state) =>
        addr.includes(state.toLowerCase())
      );
      if (matchedState) {
        popInfo = `Population data for ${matchedState}: ${JSON.stringify(
          populationData[matchedState]
        )}`;
      }
    }

    const prompt = `You are a retail analyst AI.
      Analyze the following clusters for ${location.address}:
      ${JSON.stringify(minimalClusters, null, 2)}

      Population context:
      ${popInfo || "No population data available"}

      Focus only on these 4 sections and provide detailed analysis for each:

      Overall Store Density
      - Analyze the distribution and concentration of stores across clusters
      - Identify high-density and low-density areas

      Cluster Highlights  
      - Analyze each cluster individually (Cluster 1, Cluster 2, etc.)
      - Describe the main characteristics and dominant store types for each cluster
      - Identify specific opportunities for each cluster

      Store Type and Size Breakdown
      - Analyze the distribution of different store types across all clusters
      - Analyze the size distribution (small, medium, large stores)
      - Identify dominant categories and gaps

      Suggestions for Market Opportunities
      - Provide concrete, specific retail business opportunities
      - Suggest actual business types that would work well
      - Base recommendations on the cluster analysis above

      Important:
      1. Start directly with the analysis, no greetings or introductions
      2. Use clear section headers exactly as specified above
      3. For Cluster Highlights, analyze EACH cluster individually with specific opportunities
      4. Provide actionable business recommendations in Suggestions for Market Opportunities
      5. Do not use markdown symbols like ## or *
      6. Do not mention data limitations or need for further analysis
      `;

    console.log("📝 Sending prompt to Gemini...");
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Gemini API failed:", response.status, data);
      return res.status(500).json({
        error: "Gemini API request failed",
        status: response.status,
        details: data,
      });
    }

    // DEBUG: Log the full response structure
    console.log("🔍 Full Gemini Response Structure:");
    console.log(JSON.stringify(data, null, 2));
    
    // Check all possible response structures
    console.log("🔍 Checking response structure...");
    console.log("data.candidates:", data?.candidates);
    console.log("data.text:", data?.text);
    console.log("data.response:", data?.response);
    console.log("data.result:", data?.result);
    
    if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.log("✅ Found text in: data.candidates[0].content.parts[0].text");
    }
    if (data?.candidates?.[0]?.content?.text) {
      console.log("✅ Found text in: data.candidates[0].content.text");
    }
    if (data?.text) {
      console.log("✅ Found text in: data.text");
    }
    if (data?.response?.text) {
      console.log("✅ Found text in: data.response.text");
    }
    if (data?.result?.text) {
      console.log("✅ Found text in: data.result.text");
    }

    let insight = "<p>No insight returned.</p>";
    
    // Try all possible response structures
    if (data?.candidates?.length > 0) {
      const candidate = data.candidates[0];
      if (candidate?.content?.parts?.length > 0) {
        insight = candidate.content.parts[0].text;
        console.log("✅ Using candidate.content.parts[0].text");
      } else if (candidate?.content?.text) {
        insight = candidate.content.text;
        console.log("✅ Using candidate.content.text");
      }
    } 
    // New structure for Gemini 2.0+
    else if (data?.text) {
      insight = data.text;
      console.log("✅ Using data.text");
    }
    // Alternative structure
    else if (data?.response?.text) {
      insight = data.response.text;
      console.log("✅ Using data.response.text");
    }
    // Another common structure
    else if (data?.result?.text) {
      insight = data.result.text;
      console.log("✅ Using data.result.text");
    }
    // Deep search for any text content
    else {
      console.log("🔍 Deep searching for text content...");
      const searchForText = (obj, path = "") => {
        if (typeof obj === 'string' && obj.length > 50) { // Likely the insight text
          console.log(`✅ Found text at: ${path}`);
          return obj;
        }
        if (typeof obj === 'object' && obj !== null) {
          for (const key in obj) {
            const result = searchForText(obj[key], path ? `${path}.${key}` : key);
            if (result) return result;
          }
        }
        return null;
      };
      
      const foundText = searchForText(data);
      if (foundText) {
        insight = foundText;
      }
    }

    console.log("📊 Final insight:", insight);
    res.json({ insight });
  } catch (err) {
    console.error("🔥 AI analyze error:", err);
    res.status(500).json({
      error: "AI request failed",
      details: err.message,
      stack: err.stack,
    });
  }
});

// --- Geocode endpoint ---
app.get("/api/geocode", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Query missing" });

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      q
    )}&limit=1`;
    const response = await fetch(url, {
      headers: { "User-Agent": "hackathon-app" },
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Geocode error:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch geocode", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Example helper: get LGA population
function getPopulation(state, lga) {
  if (populationData[state] && populationData[state][lga]) {
    return populationData[state][lga];
  }
  return null;
}
