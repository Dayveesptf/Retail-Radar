import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
// @ts-ignore - No type definitions available
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
// @ts-ignore - No type definitions available
import "leaflet.heat";
// @ts-ignore - No type definitions available
import clustering from "density-clustering";

const API_BASE =
  window.location.hostname === "localhost"
    ? "http://localhost:5000"
    : "https://retail-radar.onrender.com";

// Fix default marker icon paths (CDN)
// @ts-ignore - Extending Leaflet default icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

function haversine(p1, p2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(p2[0] - p1[0]);
  const dLon = toRad(p2[1] - p1[1]);
  const lat1 = toRad(p1[0]);
  const lat2 = toRad(p2[0]);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const sizeWeight = {
  small: 0.4,
  medium: 0.7,
  large: 1.0,
};

export default function StoreDensityMap() {
  const mapRef = useRef(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [aiInsight, setAiInsight] = useState(null);
  const [clustersMeta, setClustersMeta] = useState([]);

  useEffect(() => {
    mapRef.current = L.map("map", {
      center: [6.5244, 3.3792],
      zoom: 12,
      preferCanvas: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(mapRef.current);

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  async function analyzeLocation(address) {
    setStatus("Geocoding address...");
    setAiInsight(null);
    setClustersMeta([]);

    // ---------------- Geocoding ----------------
    async function geocodeAddress(address) {
      try {
        const nomRes = await fetch(
          `${API_BASE}/api/geocode?q=${encodeURIComponent(
            address
          )}&countrycodes=ng`
        );

        if (nomRes.ok) {
          const nomJson = await nomRes.json();
          if (nomJson && nomJson.length > 0) {
            const match =
              nomJson.find((r) => r.display_name.includes("Lagos")) ||
              nomJson.find((r) => r.display_name.includes("Nigeria")) ||
              nomJson[0];
            return { lat: match.lat, lon: match.lon };
          }
        }
      } catch (e) {
        console.warn("Nominatim failed:", e);
      }

      // fallback: Photon
      try {
        const photonRes = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(
            address
          )}&limit=5`
        );
        if (photonRes.ok) {
          const photonJson = await photonRes.json();
          if (photonJson && photonJson.features.length > 0) {
            const first = photonJson.features[0];
            return {
              lat: first.geometry.coordinates[1],
              lon: first.geometry.coordinates[0],
            };
          }
        }
      } catch (e) {
        console.warn("Photon failed:", e);
      }

      return null;
    }

    const geo = await geocodeAddress(address);

    if (!geo) {
      setStatus("Location not found.");
      return;
    }
    const center = [parseFloat(geo.lat), parseFloat(geo.lon)];
    mapRef.current.setView(center, 13);

    // ---------------- Overpass query ----------------
    setStatus("Fetching stores from Overpass...");
    const radius = 5000;
    const overpassQL = `
      [out:json][timeout:25];
      (
        node["shop"](around:${radius},${center[0]},${center[1]});
        node["amenity"="marketplace"](around:${radius},${center[0]},${center[1]});
      );
      out center tags;
    `;
    const overpassRes = await fetch(
      "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(overpassQL)}`,
      }
    );
    const overpassJson = await overpassRes.json();
    const elements = overpassJson.elements || [];
    if (elements.length === 0) {
      setStatus("No stores found in that area.");
      return;
    }

    setStatus(`Found ${elements.length} places. Clustering...`);

    // ---------------- Store processing ----------------
    const fetchedStores = elements.map((el) => {
      const name =
        (el.tags && (el.tags.name || el.tags["brand"])) || "Unnamed";
      const type =
        (el.tags && (el.tags.shop || el.tags.amenity)) || "shop";
      let size = "small";
      const bigKeywords = ["supermarket", "department_store", "mall"];
      const medKeywords = ["grocery", "chemist", "bakery", "convenience"];
      if (el.tags) {
        const allTags = Object.values(el.tags).join(" ").toLowerCase();
        if (bigKeywords.some((k) => allTags.includes(k))) size = "large";
        else if (medKeywords.some((k) => allTags.includes(k))) size = "medium";
      }
      return {
        id: el.id,
        name,
        lat: el.lat,
        lng: el.lon,
        type,
        size,
        raw: el.tags || {},
      };
    });

    // ---------------- Clustering ----------------
    const points = fetchedStores.map((s) => [s.lat, s.lng]);
    const dbscan = new clustering.DBSCAN();
    const eps = 500;
    const minPts = 3;
    const clusters = dbscan.run(points, eps, minPts, haversine);
    const noise = dbscan.noise || [];

    setStatus(
      `Found ${clusters.length} clusters (and ${noise.length} noise points). Rendering...`
    );

    // clear old layers
    mapRef.current.eachLayer((layer) => {
      if (!layer._url) mapRef.current.removeLayer(layer);
    });

    // heatmap
    const heatData = fetchedStores.map((s) => [
      s.lat,
      s.lng,
      sizeWeight[s.size] || 0.5,
    ]);
    // @ts-ignore - Leaflet heat extension
    L.heatLayer(heatData, { radius: 25, blur: 15, maxZoom: 17 }).addTo(
      mapRef.current
    );

    // cluster markers
    // @ts-ignore - Leaflet cluster extension
    const markerCluster = L.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: true,
    });
    fetchedStores.forEach((s) => {
      const m = L.marker([s.lat, s.lng]).bindPopup(
        `<div class="p-3 bg-surface-elevated rounded-lg border border-border">
           <strong class="text-primary text-base">${s.name}</strong><br/>
           <span class="text-foreground text-sm">${s.type || ""} • ${s.size}</span><br/>
           <small class="text-muted-foreground">id:${s.id}</small>
         </div>`
      );
      markerCluster.addLayer(m);
    });
    mapRef.current.addLayer(markerCluster);

    // ---------------- Summarize clusters ----------------
    const clustersSummary = clusters.map((clusterIndexes, idx) => {
      const clusterStores = clusterIndexes.map((i) => fetchedStores[i]);
      const latSum = clusterStores.reduce((s, it) => s + it.lat, 0);
      const lngSum = clusterStores.reduce((s, it) => s + it.lng, 0);
      const centroid = [
        latSum / clusterStores.length,
        lngSum / clusterStores.length,
      ];
      const maxDist = Math.max(
        ...clusterStores.map((cs) => haversine(centroid, [cs.lat, cs.lng]))
      );
      const radiusMeters = Math.max(maxDist, 100);
      const areaKm2 = Math.PI * (radiusMeters / 1000) ** 2;
      const densityPerKm2 =
        clusterStores.length / Math.max(areaKm2, 0.0001);

      const types = {};
      const sizes = {};
      clusterStores.forEach((s) => {
        types[s.type] = (types[s.type] || 0) + 1;
        sizes[s.size] = (sizes[s.size] || 0) + 1;
      });

      return {
        id: idx,
        centroid,
        radiusMeters,
        storeCount: clusterStores.length,
        densityPerKm2,
        densityScore: Math.round(Math.min(100, densityPerKm2 * 10)),
        types,
        sizes,
        stores: clusterStores,
      };
    });

    // draw clusters
    clustersSummary.forEach((c) => {
      const circle = L.circle(c.centroid, {
        radius: c.radiusMeters,
        color: "hsl(217 91% 60%)",
        fillColor: "hsl(217 91% 60%)",
        fillOpacity: 0.12,
        weight: 2,
      }).addTo(mapRef.current);

      const icon = L.divIcon({
        className: "cluster-centroid",
        html: `<div style="background:hsl(217 91% 60%);color:white;border-radius:999px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-weight:700;box-shadow:0 4px 12px hsl(217 91% 60% / 0.3)">${c.storeCount}</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      L.marker(c.centroid, { icon })
        .bindPopup(
          `<div class="p-3 bg-surface-elevated rounded-lg border border-border">
             <strong class="text-primary text-base">Cluster ${c.id}</strong><br/>
             <span class="text-foreground">Stores: ${c.storeCount}</span><br/>
             <span class="text-accent-green">Density score: ${c.densityScore}</span>
           </div>`
        )
        .addTo(mapRef.current)
        .on("click", () => {
          setClustersMeta([c]);
        });

      circle.on("mouseover", () =>
        circle.setStyle({ fillOpacity: 0.25 })
      );
      circle.on("mouseout", () =>
        circle.setStyle({ fillOpacity: 0.12 })
      );
    });

    const allCoords = fetchedStores.map((s) => [s.lat, s.lng]);
    const bounds = L.latLngBounds(allCoords);
    mapRef.current.fitBounds(bounds.pad(0.2));

    // ---------------- AI Analysis ----------------
    try {
      setStatus("Requesting AI analysis...");
      const resp = await fetch(
        `${API_BASE}/api/analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: { address, center, radiusMeters: radius },
            clusters: clustersSummary.map((c) => ({
              id: c.id,
              centroid: c.centroid,
              storeCount: c.storeCount,
              types: c.types,
              sizes: c.sizes,
            })),
          }),
        }
      );
      if (resp.ok) {
        const body = await resp.json();
        setAiInsight(body.insight);
        setStatus("Analysis complete");
      } else {
        setStatus("AI request failed");
      }
    } catch (err) {
      console.error(err);
      setStatus("AI request error");
    }

    console.log("Sending clusters to AI:", clustersSummary);
  }

  const formatAiInsight = (raw) => {
  if (!raw) return "<p>No insight available.</p>";

  let html = "";
  
  // Split by lines and process each one
  const lines = raw.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line) continue; // Skip empty lines

    // Handle headings (lines that end with colons and are likely section headers)
    if (line.match(/^[A-Za-z][^:]*:$/) || 
        line.toLowerCase().includes('overall store density') ||
        line.toLowerCase().includes('cluster highlights') ||
        line.toLowerCase().includes('store type and size breakdown') ||
        line.toLowerCase().includes('suggestions') ||
        line.toLowerCase().includes('recommendations') ||
        line.toLowerCase().includes('conclusion')) {
      
      html += `<h3 class="text-lg font-bold mb-3 mt-6 text-primary">${line.replace(':', '')}</h3>`;
    }
    // Handle table rows (lines with pipes)
    else if (line.includes('|') && line.split('|').length > 2) {
      // Check if this is the start of a table
      if (line.replace(/\|/g, '').replace(/-/g, '').trim() === '') {
        // This is a table separator line, skip it
        continue;
      }
      
      const cells = line.split('|').filter(cell => cell.trim() !== '');
      
      if (i === 0 || !lines[i-1].includes('|')) {
        // Start of table
        html += `<div class="overflow-x-auto my-4"><table class="min-w-full border border-border">`;
        html += `<thead><tr class="bg-surface-elevated">`;
        cells.forEach(cell => {
          html += `<th class="border border-border px-3 py-2 text-left text-sm font-semibold text-foreground">${cell.trim()}</th>`;
        });
        html += `</tr></thead><tbody>`;
      } else {
        // Table row
        html += `<tr class="hover:bg-surface-elevated/50">`;
        cells.forEach(cell => {
          html += `<td class="border border-border px-3 py-2 text-sm text-foreground">${cell.trim()}</td>`;
        });
        html += `</tr>`;
      }
      
      // Check if this is the end of the table
      if (i === lines.length - 1 || !lines[i+1].includes('|')) {
        html += `</tbody></table></div>`;
      }
    }
    // Handle bullet points
    else if (line.startsWith('* ') || line.startsWith('- ')) {
      if (i === 0 || (!lines[i-1].startsWith('* ') && !lines[i-1].startsWith('- '))) {
        html += `<ul class="list-disc list-inside mb-3 space-y-1">`;
      }
      html += `<li class="text-foreground text-sm">${line.substring(2).trim()}</li>`;
      
      if (i === lines.length - 1 || (!lines[i+1].startsWith('* ') && !lines[i+1].startsWith('- '))) {
        html += `</ul>`;
      }
    }
    // Handle numbered lists
    else if (line.match(/^\d+\./)) {
      if (i === 0 || !lines[i-1].match(/^\d+\./)) {
        html += `<ol class="list-decimal list-inside mb-3 space-y-1">`;
      }
      html += `<li class="text-foreground text-sm">${line.replace(/^\d+\.\s*/, '').trim()}</li>`;
      
      if (i === lines.length - 1 || !lines[i+1].match(/^\d+\./)) {
        html += `</ol>`;
      }
    }
    // Regular paragraphs
    else {
      // Check if this line is part of a continuing paragraph
      if (i > 0 && lines[i-1].trim() && !lines[i-1].match(/[:|*\\-]\s*$/) && 
          !lines[i-1].endsWith('</h3>') && !lines[i-1].endsWith('</li>')) {
        // Continue the previous paragraph
        html = html.replace(/(<p[^>]*>)(.*)$/, `$1$2 ${line}`);
      } else {
        html += `<p class="text-foreground text-sm leading-relaxed mb-3">${line}</p>`;
      }
    }
  }

  return html;
};

  return (
    <div className="analytics-container flex flex-col lg:flex-row min-h-screen">
      {/* Main Content Area - Fixed on large screens, normal on small */}
      <div className="flex flex-col w-full lg:w-3/5 lg:fixed lg:left-0 lg:top-0 lg:h-screen">
        {/* Controls Panel */}
        <div className="analytics-panel m-4 md:p-6 p-3 fade-in">
          <div className="flex justify-center flex-col sm:flex-row gap-4 items-center">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter location (e.g., Yaba, Lagos)"
              className="analytics-input flex-1 max-w-md"
            />
            <button
              onClick={() => analyzeLocation(query || "Lagos, Nigeria")}
              className="analytics-button md:px-6 md:py-3 md:text-base text-sm px-3 py-2"
            >
              Analyze Location
            </button>
          </div>
          {status && (
            <div className="analytics-status mt-4 text-center">
              <div className="inline-flex items-center gap-2">
                {status.includes("...") && (
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                )}
                {status}
              </div>
            </div>
          )}
        </div>

        {/* Map Container - Responsive sizing */}
        <div className="p-4 pb-6 md:w-5/6 mx-auto w-11/12">
          <div id="map" className="h-full min-h-[300px] md:min-h-[500px] slide-up" />
        </div>
      </div>

      {/* Spacer for small screens to prevent content overlap */}
      <div className="lg:hidden h-4"></div>

      {/* Sidebar: AI Insights & Cluster Data - Scrollable on large screens, normal on small */}
      <div className="lg:w-2/5 w-full lg:ml-auto bg-surface lg:border-l border-border lg:custom-scrollbar lg:overflow-y-auto lg:h-screen">
        <div className="p-6">
          {/* AI Insights Section */}
          <div className="mb-8">
            <h2 className="heading-xl mb-6 fade-in">AI Market Insights</h2>
            {aiInsight ? (
              <div className="insight-panel fade-in">
                <div 
                  className="text-body prose prose-sm max-w-none" 
                  dangerouslySetInnerHTML={{ __html: formatAiInsight(aiInsight) }} 
                />
              </div>
            ) : (
              <div className="insight-card fade-in">
                <div className="text-center py-8">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-elevated flex items-center justify-center">
                    <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <p className="text-caption">Enter a location and click "Analyze Location" to get AI-powered market insights.</p>
                </div>
              </div>
            )}
          </div>

          {/* Cluster Analysis Section */}
          <div>
            <h3 className="heading-lg mb-6 fade-in">Cluster Analysis</h3>
            {clustersMeta.length === 0 ? (
              <div className="insight-card fade-in">
                <div className="text-center py-8">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-elevated flex items-center justify-center">
                    <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <p className="text-caption">Click on cluster markers in the map to view detailed analysis here.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {clustersMeta.map((c) => (
                  <div key={c.id} className="cluster-card slide-up">
                    <div className="flex items-center justify-between mb-4">
                      <div className="data-label text-lg">Cluster {c.id}</div>
                      <div className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm font-semibold">
                        {c.storeCount} Stores
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-foreground text-sm">Density Score</span>
                          <span className="data-metric text-lg">{c.densityScore}/100</span>
                        </div>
                        <div className="progress-bar">
                          <div 
                            className="progress-fill" 
                            style={{width: `${c.densityScore}%`}}
                          ></div>
                        </div>
                      </div>

                      <div>
                        <div className="data-label mb-3">Store Categories</div>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(c.types).map(([k, v]) => (
                            <span key={k} className="store-tag">
                              {k}: {v}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="data-label mb-3">Size Distribution</div>
                        <div className="grid grid-cols-3 gap-2">
                          {Object.entries(c.sizes).map(([size, count]) => (
                            <div key={size} className="text-center p-2 bg-surface rounded-lg">
                              <div className="text-xs text-muted-foreground capitalize">{size}</div>
                              <div className="text-lg font-bold text-foreground">{count}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}