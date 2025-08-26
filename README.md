# Urban Retail Visualizer

## Team Information
**Team Name:** Team Davies  
**Members:**  
- David Davies (@your-github-username)  
- [Other team members if any]

## Project Overview
**Problem Solved:**  
Identifies retail store clusters and areas of high store density in a city to help entrepreneurs and businesses make informed decisions on where to open new stores.

**How it Works:**  
1. User enters a location (e.g., Yaba, Lagos).  
2. App fetches store data from OpenStreetMap via Overpass API.  
3. Clusters of stores are identified using DBSCAN clustering.  
4. Heatmap visualizes store density.  
5. AI analyzes clusters and provides actionable insights for business opportunities.

**Unique/Innovative Features:**  
- Dynamic heatmap for visualizing retail density.  
- AI-driven insights on cluster characteristics and market opportunities.  
- Interactive cluster markers with detailed summaries.  

## Tech Stack
- **Backend:** Node.js (Express),  
- **Frontend:** React, TailwindCSS, Leaflet.js, Leaflet.markercluster, Leaflet.heat  
- **AI:** Gemini 1.5 (Google Generative AI)  

## Setup Instructions
1. Clone the repository:  
   ```bash
   git clone <your-repo-url>
   cd <repo-folder>
