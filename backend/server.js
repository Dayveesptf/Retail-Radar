/* eslint-disable no-undef */
import express from "express";
import fetch from "node-fetch"; // or global fetch if Node 18+
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";
import path from "path";

dotenv.config();

// --- Load population.json manually ---
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const populationData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data/population.json"), "utf-8")
);

const app = express();
app.use(
  cors({
    origin: "https://retail-radar-dd.vercel.app",
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

    Focus only on:
    - Overall store density
    - Cluster highlights
    - Store type and size breakdown
    - Suggestions for market opportunities

    Important:
    - Do NOT say "more demographic data is needed" or "insufficient data".
    - Use ONLY the clusters and population info provided above.
    - Give clear, actionable insights even if the data is limited.
    `;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          candidateCount: 1,
          maxOutputTokens: 1024,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: "Gemini API request failed",
        status: response.status,
        details: data,
      });
    }

    let insight = "<p>No insight returned.</p>";
    if (data?.candidates?.length > 0) {
      const candidate = data.candidates[0];
      if (candidate?.content?.parts?.length > 0) {
        insight = candidate.content.parts[0].text;
      } else if (candidate?.content?.text) {
        insight = candidate.content.text;
      }
    }

    res.json({ insight });
  } catch (err) {
    console.error("AI analyze error:", err);
    res
      .status(500)
      .json({ error: "AI request failed", details: err.message });
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

