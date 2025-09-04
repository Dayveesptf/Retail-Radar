import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.heat";
import clustering from "density-clustering";
import "./index.css"

// Fix default marker icon paths (CDN)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
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
      tap: false,
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

    async function geocodeAddress(address) {
      // Try Nominatim first (restricted to Nigeria)
      try {
        const nomRes = await fetch(
          `https://retail-radar.onrender.com/api/geocode?q=${encodeURIComponent(address)}&countrycodes=ng`
        );

        const _resp = await fetch(`https://retail-radar.onrender.com/api/analyze`, {
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
      });

        if (nomRes.ok) {
          const nomJson = await nomRes.json();
          if (nomJson && nomJson.length > 0) {
            // Prefer Lagos if found
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

      // Fallback: Photon
      try {
        const photonRes = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(address)}&limit=5`
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

    setStatus("Fetching stores from Overpass...");

    const radius = 5000; // meters
    const overpassQL = `
      [out:json][timeout:25];
      (
        node["shop"](around:${radius},${center[0]},${center[1]});
        node["amenity"="marketplace"](around:${radius},${center[0]},${center[1]});
      );
      out center tags;
    `;
    const overpassUrl = "https://overpass-api.de/api/interpreter";
    const overpassRes = await fetch(overpassUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(overpassQL)}`,
    });
    const overpassJson = await overpassRes.json();
    const elements = overpassJson.elements || [];
    if (elements.length === 0) {
      setStatus("No stores found in that area.");
      return;
    }

    setStatus(`Found ${elements.length} places. Clustering...`);

    const fetchedStores = elements.map((el) => {
      const name = (el.tags && (el.tags.name || el.tags["brand"])) || "Unnamed";
      const type = el.tags && (el.tags.shop || el.tags.amenity || "shop");
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

    // 3) Run DBSCAN with Haversine (eps in meters). density-clustering expects an optional distance function
    const points = fetchedStores.map((s) => [s.lat, s.lng]);
    const dbscan = new clustering.DBSCAN();
    // We'll pass epsilon = 500 meters and minPts = 3 (adjustable)
    const eps = 500;
    const minPts = 3;
    const clusters = dbscan.run(points, eps, minPts, haversine);

    const noise = dbscan.noise || [];

    setStatus(`Found ${clusters.length} clusters (and ${noise.length} noise points). Rendering...`);

    mapRef.current.eachLayer((layer) => {
      if (!layer._url) mapRef.current.removeLayer(layer);
    });

    const heatData = fetchedStores.map((s) => [
      s.lat,
      s.lng,
      sizeWeight[s.size] || 0.5,
    ]);
    L.heatLayer(heatData, { radius: 25, blur: 15, maxZoom: 17 }).addTo(mapRef.current);

    // Marker cluster group for individual stores
    const markerCluster = L.markerClusterGroup({ chunkedLoading: true, showCoverageOnHover: true });

    // Add store markers (all)
    fetchedStores.forEach((s) => {
      const m = L.marker([s.lat, s.lng]).bindPopup(
        `<div class="p-2 bg-gray-200 rounded-md">
           <strong class="text-[#414296]">${s.name}</strong><br/>
           ${s.type || ""} • ${s.size}<br/>
           <small>id:${s.id}</small>
         </div>`
      );
      markerCluster.addLayer(m);
    });
    mapRef.current.addLayer(markerCluster);

    // Process clusters: compute centroid, radius (max dist), density (stores/km²), type breakdown
    const clustersSummary = clusters.map((clusterIndexes, idx) => {
      const clusterStores = clusterIndexes.map((i) => fetchedStores[i]);
      const latSum = clusterStores.reduce((s, it) => s + it.lat, 0);
      const lngSum = clusterStores.reduce((s, it) => s + it.lng, 0);
      const centroid = [latSum / clusterStores.length, lngSum / clusterStores.length];
      const maxDist = Math.max(
        ...clusterStores.map((cs) => haversine(centroid, [cs.lat, cs.lng]))
      );
      const radiusMeters = Math.max(maxDist, 100); // at least 100m
      const areaKm2 = Math.PI * (radiusMeters / 1000) ** 2;
      const densityPerKm2 = clusterStores.length / Math.max(areaKm2, 0.0001);

      // breakdown
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

    // draw cluster centroids and circles
    clustersSummary.forEach((c) => {
      const circle = L.circle(c.centroid, {
        radius: c.radiusMeters,
        color: "crimson",
        fillColor: "#f03",
        fillOpacity: 0.12,
        weight: 2,
      }).addTo(mapRef.current);

      const icon = L.divIcon({
        className: "cluster-centroid",
        html: `<div style="background:rgba(220,20,60,0.9);color:white;border-radius:999px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-weight:700">${c.storeCount}</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      L.marker(c.centroid, { icon })
        .bindPopup(`<strong>Cluster ${c.id + 1}</strong><br/>Stores: ${c.storeCount}<br/>Density score: ${c.densityScore}`)
        .addTo(mapRef.current)
        .on("click", () => {
          setClustersMeta([c]);
        });

      circle.on("mouseover", () => circle.setStyle({ fillOpacity: 0.25 }));
      circle.on("mouseout", () => circle.setStyle({ fillOpacity: 0.12 }));
    });

    // fit map bounds to data
    const allCoords = fetchedStores.map((s) => [s.lat, s.lng]);
    const bounds = L.latLngBounds(allCoords);
    mapRef.current.fitBounds(bounds.pad(0.2));

    // 4) send summary to backend AI endpoint
    try {
      setStatus("Requesting AI analysis...");
      const resp = await fetch("/api/analyze", {
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
      });
      if (resp.ok) {
        const body = await resp.json();
        setAiInsight(body.insight);
        setStatus("Done");
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

  const sections = raw.split("**").filter(Boolean); // Split by bold markers
  let html = "";

  sections.forEach((s) => {
    // Detect if it's a heading or regular paragraph
    if (s.toLowerCase().includes("overall store density") ||
        s.toLowerCase().includes("cluster highlights") ||
        s.toLowerCase().includes("store type and size breakdown") ||
        s.toLowerCase().includes("suggestions") ||
        s.toLowerCase().includes("conclusion")) {
      html += `<h3 class="text-base font-bold mb mt-8">${s.trim()}</h3>`;
    } else {
      const lines = s.split("\n\n").filter(Boolean);
      lines.forEach((line) => {
        html += `<p class="text-sm text-gray-700 mt-1">${line.replace(/^\*\s*/, "").trim()}</p>`;
      });
    }
  });

  return html;
};

  return (
    <div className="flex h-screen">
    <div className="flex flex-col w-3/5">
      <div className="flex justify-center analytics-panel p-6 mx-4 my-4 rounded-xl items-center">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter location (e.g., Yaba, Lagos)"
          className="w-72 mr-4 px-3 py-2 rounded-lg border-2 border-gray-200"
        />
        <button
          onClick={() => analyzeLocation(query || "Lagos, Nigeria")}
          className="bg-blue-400 py-2 px-3 rounded-md text-base hover:bg-blue-500"
        >
          Analyze
        </button>
        <div className="ml-4">{status}</div>
      </div>

      {/* Map container */}
      <div className="flex-1 w-full p-4">
        <div id="map" className="map-container h-full w-full" />
      </div>
    </div>

    {/* Right column: AI Insight + Cluster Summaries */}
    <div className="w-2/5 p-6 bg-gradient-to-b from-surface-muted to-surface overflow-y-auto">
      <h2 className="text-2xl font-bold text-[#484883] mb-6 text-gradient">AI Insight</h2>
      {aiInsight ? (
        <div className="fade-in">
          <div className="text-body" dangerouslySetInnerHTML={{ __html: formatAiInsight(aiInsight) }} />
        </div>
      ) : (
        <div className="">
          <p className="">No AI analysis yet. Click Analyze to get started.</p>
        </div>
      )}

      <div className="border-t border-border my-8"></div>
      <h3 className="text-lg mb-4 font-bold">Cluster Summaries</h3>
      {clustersMeta.length === 0 && (
        <div className="">
          <p className="">Click a cluster marker to view details here.</p>
        </div>
      )}
      {clustersMeta.map((c) => (
        <div key={c.id} className="my-4 slide-up">
          <div className="text-[#30327b] text-lg">Cluster {c.id + 1}:</div>
          <div className="mb-1 text-md">- {c.storeCount} Stores</div>
          <div className="text-body mb-3 text-md">- Density score: <span className="data-metric">{c.densityScore}/100</span></div>
          <div className="mb-4">
            <div className="" style={{width: `${c.densityScore}%`}}></div>
          </div>
          <div className="text-body">
            <div className="mb-2 text-md">- Store Types</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(c.types).map(([k, v]) => (
                <span key={k} className="inline-flex items-center px-4 py-1 rounded-full text-xs font-medium bg-blue-200 text-accent-blue border border-blue-500">
                  {k}: {v}
                </span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
  );
}
