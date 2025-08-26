# Urban Retail Visualizer

## Team Information
**Team Name:** Team Davies  
**Members:**  
- David Davies (Dayveesptf)  

## Project Overview
**Problem Solved:**  
This project identifies retail store clusters and areas of high store density within a city, providing valuable insights for entrepreneurs, investors, and business owners. By analyzing the spatial distribution of shops and marketplaces, the application helps users understand where retail activity is concentrated, which areas are underserved, and which locations present the best opportunities for opening new stores.

The system uses a combination of geocoding, OpenStreetMap data, and clustering algorithms to visualize retail density on an interactive map. Users can input a city or neighborhood, and the platform will highlight clusters, show store types and sizes, and generate AI-powered insights about market opportunities. This allows business owners to make data-driven decisions, minimize risks, and strategically select locations with high potential for success.

Unlike traditional market research tools, this solution combines live geographical data, density analysis, and AI-generated insights into a single platform, making it accessible, fast, and highly actionable. It’s particularly useful for identifying emerging hotspots, understanding competition, and optimizing retail expansion strategies.

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

2. Install backend dependencies:  
   ```bash
   cd backend
   npm install

3. create a .env file based on .env.example and add your Gemini API key
   
4. Install frontend dependencies:  
   ```bash
   cd ../frontend
   npm install

5. Run the project locally:  
   ```bash
   npm run dev #frontend app

   node server.js #backend server

6. Open http://localhost:5173 to view app

**Demo Link:** 
- https://drive.google.com/file/d/1-JMm0_WEJze7OhLr25c8zhc0agYQ4QoQ/view?usp=sharing

## Additional notes
- **Known Issues**:
    1. Google Maps Billing Restriction: Initially, the project used Google Maps for visualization. However, due to Google Maps requiring a billing account for API usage, this caused limitations during development and testing.  

    Current Solution: To work around the billing restriction, the project uses Leaflet with free OpenStreetMap tiles for map rendering. This allows the app to remain fully functional without incurring costs.

    2. AI response may take a few seconds depending on the number of clusters.

- **Future Improvements**:
    1. Add user authentication for personalized analysis.
    2. Support multiple cities and compare retail density across them.
    3. Advanced AI insights using demographic and foot traffic data.


